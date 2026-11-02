#!/usr/bin/env python3
"""Build against a fresh immutable CRM recovery host baseline."""
import argparse, json, os, re, subprocess, sys, threading, time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/opt/bambola-arm')
BUILDER = 'bambola-arm-builder'
NODE_IMAGE_RE = r'^docker\.io/library/node:22-alpine@sha256:[0-9a-f]{64}$'
NODE_IMAGE = 'docker.io/library/node:22-alpine@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284'

def run(args, **kwargs):
    return subprocess.run(args, check=True, **kwargs)


def builder_resource_update_args(container):
    return ['docker', 'update', '--cpu-period', '100000', '--cpu-quota', '100000',
            '--memory', '2g', container]


def parse_image_identity(output, manifest_digest):
    fields = output.strip().split()
    if len(fields) != 2:
        return None, None, False
    image_id, source_label = fields
    valid = bool(re.fullmatch(r'sha256:[0-9a-f]{64}', image_id)
                 and source_label == manifest_digest)
    return image_id, source_label, valid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release', required=True, type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    parser.add_argument('--host-snapshot-sha256', required=True)
    parser.add_argument('--node-image', required=True)
    args = parser.parse_args()
    release = args.release.resolve(strict=True)
    releases = (ROOT / 'releases').resolve(strict=True)
    if release.parent != releases:
        raise ValueError('Release must be a direct child of /opt/bambola-arm/releases.')
    if not re.fullmatch(r'[0-9a-f]{64}', args.manifest_sha256):
        raise ValueError('Invalid manifest digest.')
    if not re.fullmatch(NODE_IMAGE_RE, args.node_image) or args.node_image != NODE_IMAGE:
        raise ValueError('Node base must match the reviewed immutable linux/amd64 digest.')
    dockerfile = release / 'deploy/marine/Dockerfile'
    if not dockerfile.is_file():
        raise ValueError('Marine Dockerfile missing.')
    run([sys.executable, str(release / 'deploy/marine/manifest.py'),
         'verify', str(release), args.manifest_sha256])
    if not re.fullmatch(r'[0-9a-f]{64}', args.host_snapshot_sha256):
        raise ValueError('Invalid pinned host snapshot digest.')
    guard = [sys.executable, str(release / 'deploy/marine/crm_host.py'),
             'check', '--manifest-sha256', args.manifest_sha256,
             '--snapshot-sha256', args.host_snapshot_sha256]
    run(guard, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    evidence = ROOT / 'evidence'
    evidence.mkdir(mode=0o700, parents=True, exist_ok=True)
    evidence.chmod(0o700)
    status = {'done': False, 'stop': None}
    run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    log_path = evidence / f'build-{args.manifest_sha256[:12]}-{run_id}.log'
    result_path = evidence / f'build-{args.manifest_sha256[:12]}-{run_id}.json'
    low_samples = 0

    def monitor():
        nonlocal low_samples
        while not status['done']:
            try:
                mem_kib = int(Path('/proc/meminfo').read_text().split('MemAvailable:')[1].split()[0])
                disk_mb = int(subprocess.check_output(
                    ['df', '-Pm', '/opt'], text=True
                ).splitlines()[1].split()[3])
                low_samples = low_samples + 1 if mem_kib < 768 * 1024 else 0
                try:
                    subprocess.run(guard, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                   timeout=45)
                    guard_failed = False
                except Exception:
                    guard_failed = True
                if low_samples >= 3 or disk_mb < 10240 or guard_failed:
                    status['stop'] = 'resource or shared-service guard triggered'
                    subprocess.run(['docker', 'stop', 'buildx_buildkit_bambola-arm-builder0'],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                    return
            except Exception:
                status['stop'] = 'resource monitor could not verify host state'
                subprocess.run(['docker', 'stop', 'buildx_buildkit_bambola-arm-builder0'],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                return
            time.sleep(10)

    run(['docker', 'buildx', 'create', '--name', BUILDER, '--driver', 'docker-container',
         '--driver-opt', 'memory=2g,cpu-period=100000,cpu-quota=100000'],
        stdout=subprocess.DEVNULL)
    result = None
    image_id = None
    source_label = None
    image_identity_ok = False
    try:
        run(['docker', 'buildx', 'inspect', '--bootstrap', BUILDER], stdout=subprocess.DEVNULL)
        buildkit = subprocess.check_output(
            ['docker', 'ps', '--filter', 'name=buildx_buildkit_bambola-arm-builder', '--format', '{{.Names}}'], text=True
        ).splitlines()
        if len(buildkit) != 1 or buildkit[0] != 'buildx_buildkit_bambola-arm-builder0':
            raise RuntimeError('Dedicated builder container identity is ambiguous.')
        run(builder_resource_update_args(buildkit[0]), stdout=subprocess.DEVNULL)
        run(guard, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45)
        monitor_thread = threading.Thread(target=monitor, daemon=True)
        monitor_thread.start()
        command = ['docker', 'buildx', 'build', '--builder', BUILDER, '--load', '--progress', 'plain',
                   '--provenance=false', '--build-arg', 'NODE_IMAGE=' + args.node_image,
                   '--build-arg', 'SOURCE_MANIFEST_SHA256=' + args.manifest_sha256,
                   '--label', 'heili.source-manifest=' + args.manifest_sha256,
                   '-t', 'bambola-arm:' + args.manifest_sha256[:12], '-f', str(dockerfile), str(release)]
        with log_path.open('xb') as log:
            result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT)
        status['done'] = True
        monitor_thread.join(timeout=45)
        if monitor_thread.is_alive():
            status['stop'] = 'host baseline guard did not finish within its bound'
            subprocess.run(['docker', 'stop', 'buildx_buildkit_bambola-arm-builder0'],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        run(guard, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45)
        if result.returncode == 0:
            try:
                inspected = subprocess.check_output([
                    'docker', 'image', 'inspect', '--format',
                    '{{.Id}} {{index .Config.Labels "heili.source-manifest"}}',
                    'bambola-arm:' + args.manifest_sha256[:12],
                ], text=True)
                image_id, source_label, image_identity_ok = parse_image_identity(
                    inspected, args.manifest_sha256
                )
            except Exception:
                image_identity_ok = False
    finally:
        status['done'] = True
        subprocess.run(['docker', 'buildx', 'rm', BUILDER], stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
        remaining = subprocess.check_output(
            ['docker', 'ps', '-aq', '--filter', 'name=^/buildx_buildkit_bambola-arm-builder0$'], text=True
        ).splitlines()
        if remaining:
            raise RuntimeError('Dedicated build container was not removed.')
        run(guard, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45)
    result_record = {
        'version': 1,
        'manifestSha256': args.manifest_sha256,
        'hostSnapshotSha256': args.host_snapshot_sha256,
        'imageTag': 'bambola-arm:' + args.manifest_sha256[:12],
        'imageId': image_id,
        'sourceManifestLabel': source_label,
        'imageIdentityVerified': image_identity_ok,
        'log': log_path.name,
        'exitCode': result.returncode if result is not None else None,
        'stoppedByGuard': status['stop'],
        'passed': result is not None and result.returncode == 0 and status['stop'] is None and image_identity_ok,
    }
    with result_path.open('x', encoding='utf-8') as stream:
        json.dump(result_record, stream, sort_keys=True, indent=2)
        stream.write('\n')
    result_path.chmod(0o600)
    if status['stop']:
        raise RuntimeError(status['stop'])
    if result is None or result.returncode:
        raise RuntimeError('Docker build failed; private evidence retained.')
    if not image_identity_ok:
        raise RuntimeError('Built image ID or manifest label failed verification.')
    print('Reviewed image built; private result: ' + result_path.name)

if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        print('build operation failed (' + type(error).__name__ + '); private evidence retained.', file=sys.stderr)
        raise SystemExit(1)

