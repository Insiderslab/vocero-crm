#!/usr/bin/env python3
"""Build against a fresh immutable CRM recovery host baseline."""
import argparse, importlib.util, json, os, re, subprocess, sys, threading, time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
import crm_rollout
import crm_host

ROOT = Path('/opt/bambola-arm')
BUILDER = 'bambola-arm-builder'
NODE_IMAGE_RE = r'^docker\.io/library/node:22-alpine@sha256:[0-9a-f]{64}$'
NODE_IMAGE = 'docker.io/library/node:22-alpine@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284'
_HELD_LOCK = None

def run(args, **kwargs):
    kwargs.setdefault('env', docker_env())
    return subprocess.run(args, check=True, **kwargs)


def docker_env():
    env = {key: os.environ[key] for key in ('PATH', 'LANG', 'LC_ALL', 'LC_CTYPE') if key in os.environ}
    env['PATH'] = env.get('PATH', '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin')
    env['HOME'] = '/root'; env['LANG'] = 'C.UTF-8'; env['LC_ALL'] = 'C.UTF-8'
    return env


def output(args, **kwargs):
    kwargs.setdefault('env', docker_env())
    return subprocess.check_output(args, **kwargs)


@contextmanager
def private_log(path):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        if os.name == 'posix': os.fchmod(fd, 0o600)
        with os.fdopen(fd, 'wb', closefd=False) as stream:
            yield stream
            stream.flush(); os.fsync(fd)
    finally:
        os.close(fd)


def legacy_result_record(manifest_digest,legacy_snapshot_sha,image_tag,image_id,label,valid,log_path,result,stopped_by_guard):
    return {'version':1,'manifestSha256':manifest_digest,'hostSnapshotSha256':legacy_snapshot_sha,
            'imageTag':image_tag,'imageId':image_id,'sourceManifestLabel':label,
            'imageIdentityVerified':valid,'log':log_path.name,
            'exitCode':result.returncode if result is not None else None,
            'stoppedByGuard':stopped_by_guard,
            'passed':valid and result is not None and result.returncode==0 and stopped_by_guard is None}

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


def build_update(release, manifest_digest, operation_id, evidence_dir, guard, *, image_tag=None,
                 log_name='build.log', result_name='build-result.json', legacy_snapshot_sha=None,
                 lock_handle=None):
    """Run the existing pinned/resource-bounded builder for a release operation.

    The caller must already hold the shared release lock. This entry point takes
    a fresh-baseline guard and explicit private artifact paths, so it does not
    inherit the legacy recovery snapshot defaults or acquire a nested lock.
    """
    release = Path(release)
    if release.is_symlink() or release.resolve(strict=True).parent != (ROOT / 'releases').resolve(strict=True):
        raise RuntimeError('Release must be a direct child of the fixed release root.')
    if not re.fullmatch(r'[0-9a-f]{64}', manifest_digest):
        raise RuntimeError('Invalid manifest digest.')
    if not re.fullmatch(r'\d{8}T\d{6}Z-[0-9a-f]{12}', operation_id):
        raise RuntimeError('Invalid operation identifier.')
    if evidence_dir.is_symlink() or not evidence_dir.is_dir():
        raise RuntimeError('Private operation directory is missing or unsafe.')
    if lock_handle is None or not hasattr(lock_handle, 'assert_held'):
        raise RuntimeError('A verified held release lock handle is required.')
    lock_handle.assert_held()
    if os.name == 'posix' and (evidence_dir.stat().st_uid != 0 or (evidence_dir.stat().st_mode & 0o777) != 0o700):
        raise RuntimeError('Private operation directory ownership or mode is unsafe.')
    verifier_path=Path(__file__).resolve().with_name('manifest.py')
    spec=importlib.util.spec_from_file_location('_trusted_build_manifest',verifier_path)
    if spec is None or spec.loader is None: raise RuntimeError('Trusted release verifier is unavailable.')
    verifier=importlib.util.module_from_spec(spec); spec.loader.exec_module(verifier)
    try: verifier.verify(release,manifest_digest)
    except (OSError,ValueError) as error: raise crm_host.Refusal('Release manifest verification failed.') from error
    guard()
    log_path = evidence_dir / log_name
    result_path = evidence_dir / result_name
    image_tag = image_tag or ('bambola-arm:agenda-' + operation_id)
    if Path(log_path).exists() or Path(result_path).exists():
        raise RuntimeError('Build evidence already exists.')
    builder_container = 'buildx_buildkit_' + BUILDER + '0'
    build_status = {'failed': False}
    low_samples = 0
    stop = threading.Event()
    builder_id = None

    def stop_owned_builder():
        if builder_id is None: return
        try:
            current=output(['docker','inspect','--format','{{.Id}}',builder_container],text=True,timeout=10).strip()
            if current==builder_id:
                subprocess.run(['docker','stop',builder_id],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15,env=docker_env())
        except Exception:
            # An unknown/replaced builder is never stopped by name.
            return

    def monitor():
        nonlocal low_samples
        while not stop.wait(10):
            try:
                available = int(Path('/proc/meminfo').read_text().split('MemAvailable:')[1].split()[0])
                free_mb = int(output(['df', '-Pm', '/opt'], text=True, timeout=5).splitlines()[1].split()[3])
                low_samples = low_samples + 1 if available < 768 * 1024 else 0
                guard()
                if low_samples >= 3 or free_mb < 10240:
                    build_status['failed'] = True
                    stop_owned_builder()
                    return
            except Exception:
                build_status['failed'] = True
                stop_owned_builder()
                return

    guard()
    run(['docker', 'buildx', 'create', '--name', BUILDER, '--driver', 'docker-container',
         '--driver-opt', 'memory=2g,cpu-period=100000,cpu-quota=100000'])
    result = None
    try:
        run(['docker', 'buildx', 'inspect', '--bootstrap', BUILDER])
        found = output(['docker', 'ps', '--filter', 'name=buildx_buildkit_bambola-arm-builder', '--format', '{{.Names}}'], text=True, timeout=15).splitlines()
        if found != [builder_container]:
            raise RuntimeError('Dedicated builder container identity is ambiguous.')
        builder_id=output(['docker','inspect','--format','{{.Id}}',builder_container],text=True,timeout=15).strip()
        if not re.fullmatch(r'[0-9a-f]{64}',builder_id): raise RuntimeError('Dedicated builder ID is malformed.')
        run(builder_resource_update_args(builder_container))
        guard()
        thread = threading.Thread(target=monitor, daemon=True); thread.start()
        cmd = ['docker', 'buildx', 'build', '--builder', BUILDER, '--load', '--progress', 'plain',
               '--provenance=false', '--build-arg', 'NODE_IMAGE=' + NODE_IMAGE,
               '--build-arg', 'SOURCE_MANIFEST_SHA256=' + manifest_digest,
               '--label', 'heili.source-manifest=' + manifest_digest, '-t', image_tag,
               '-f', str(release / 'deploy/marine/Dockerfile'), str(release)]
        with private_log(log_path) as log:
            result = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, check=False, env=docker_env())
        stop.set(); thread.join(timeout=45)
        guard_failed=thread.is_alive() or build_status['failed']
        if not guard_failed:
            try: guard()
            except Exception:
                if legacy_snapshot_sha is None: raise
                guard_failed=True
        identity = ''
        if result.returncode==0 and not guard_failed:
            identity = output(['docker', 'image', 'inspect', '--format', '{{.Id}} {{index .Config.Labels "heili.source-manifest"}}', image_tag], text=True, timeout=15)
        image_id, label, valid = parse_image_identity(identity, manifest_digest)
        if legacy_snapshot_sha is None and (result.returncode or guard_failed or not valid):
            raise RuntimeError('Candidate image build or identity verification failed.')
        if legacy_snapshot_sha is None:
            bundle = _isolated_bundle_hash(image_id, operation_id)
            record = {'schemaVersion': 1, 'operationId': operation_id, 'sourceManifestSha256': manifest_digest,
                      'imageId': image_id, 'sourceManifestLabel': label, 'migrationBundleSha256': bundle,
                      'logSha256': __import__('hashlib').sha256(log_path.read_bytes()).hexdigest(), 'exitCode': result.returncode}
            encoded = (json.dumps(record, sort_keys=True, ensure_ascii=True, separators=(',', ':')) + '\n').encode('utf-8')
        else:
            record=legacy_result_record(manifest_digest,legacy_snapshot_sha,image_tag,image_id,label,valid,log_path,result,
                                        'host baseline/resource guard failed' if guard_failed else None)
            encoded = (json.dumps(record, sort_keys=True, indent=2) + '\n').encode('utf-8')
        with open(result_path, 'xb') as out:
            out.write(encoded)
            out.flush(); os.fsync(out.fileno())
        os.chmod(result_path, 0o600)
        if legacy_snapshot_sha is not None and not record['passed']:
            if record['stoppedByGuard']: raise RuntimeError(record['stoppedByGuard'])
            raise RuntimeError('Docker build failed; private evidence retained.')
        return record
    finally:
        stop.set()
        current=output(['docker','ps','-aq','--filter','name=^/'+builder_container+'$'],text=True,timeout=15).splitlines()
        if current:
            current_id=output(['docker','inspect','--format','{{.Id}}',current[0]],text=True,timeout=15).strip() if len(current)==1 else None
            if len(current)!=1 or current_id!=builder_id:
                raise RuntimeError('Builder identity changed; refusing to remove an unknown container.')
            subprocess.run(['docker', 'buildx', 'rm', BUILDER], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45, env=docker_env())
        remaining = output(['docker', 'ps', '-aq', '--filter', 'name=^/' + builder_container + '$'], text=True, timeout=15).splitlines()
        if remaining:
            raise RuntimeError('Dedicated build container was not removed.')
        guard()


def _isolated_bundle_hash(image_id, operation_id):
    name = 'crm-migration-proof-' + operation_id
    existing = output(['docker', 'ps', '-aq', '--filter', 'name=^/' + name + '$'], text=True, timeout=15).splitlines()
    if existing:
        raise RuntimeError('Migration proof container name already exists.')
    label = 'heili.crm-operation=' + operation_id
    cid = output(['docker', 'create', '--name', name, '--label', label, '--network', 'none',
                                   '--read-only', '--cpus', '0.25', '--memory', '128m', '--entrypoint', 'node',
                                   image_id, '-e', "const f=require('node:fs'),c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(f.readFileSync('/app/migrate.mjs')).digest('hex'))"], text=True, timeout=20).strip()
    try:
        proof = output(['docker', 'inspect', '--format', '{{.Id}} {{index .Config.Labels "heili.crm-operation"}} {{.Image}}', cid], text=True, timeout=15).strip().split()
        if len(proof) != 3 or proof[0] != cid or proof[1] != operation_id or proof[2] != image_id:
            raise RuntimeError('Migration proof container identity is not owned by this operation.')
        subprocess.run(['docker', 'start', cid], check=True, stdout=subprocess.DEVNULL, timeout=15, env=docker_env())
        status = output(['docker', 'wait', cid], text=True, timeout=30).strip()
        bundle_hash = output(['docker', 'logs', cid], text=True, timeout=15).strip()
        if status != '0' or not re.fullmatch(r'[0-9a-f]{64}', bundle_hash):
            raise RuntimeError('Isolated migration bundle proof failed.')
        return bundle_hash
    finally:
        inspect = output(['docker', 'inspect', '--format', '{{.Id}} {{index .Config.Labels "heili.crm-operation"}}', cid], text=True, timeout=15).strip().split()
        if len(inspect) == 2 and inspect[0] == cid and inspect[1] == operation_id:
            subprocess.run(['docker', 'rm', cid], check=True, stdout=subprocess.DEVNULL, timeout=15, env=docker_env())


def _main():
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
    if not (release / 'deploy/marine/Dockerfile').is_file():
        raise ValueError('Marine Dockerfile missing.')
    if not re.fullmatch(r'[0-9a-f]{64}', args.host_snapshot_sha256):
        raise ValueError('Invalid pinned host snapshot digest.')
    guard_command = [sys.executable, str(release / 'deploy/marine/crm_host.py'),
                     'check', '--manifest-sha256', args.manifest_sha256,
                     '--snapshot-sha256', args.host_snapshot_sha256]
    def guard():
        run(guard_command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=45)
    evidence = ROOT / 'evidence'
    evidence.mkdir(mode=0o700, parents=True, exist_ok=True)
    if os.name == 'posix': evidence.chmod(0o700)
    run_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    operation_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + __import__('secrets').token_hex(6)
    log_path = evidence / f'build-{args.manifest_sha256[:12]}-{run_id}.log'
    result_path = evidence / f'build-{args.manifest_sha256[:12]}-{run_id}.json'
    build_update(release, args.manifest_sha256, operation_id, evidence, guard,
                 image_tag='bambola-arm:' + args.manifest_sha256[:12],
                 log_name=log_path.name, result_name=result_path.name,
                 legacy_snapshot_sha=args.host_snapshot_sha256, lock_handle=_HELD_LOCK)
    print('Reviewed image built; private result: ' + result_path.name)

def main():
    global _HELD_LOCK
    with crm_rollout.operation_lock() as held:
        _HELD_LOCK = held
        try: return _main()
        finally: _HELD_LOCK = None

if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        print('build operation failed (' + type(error).__name__ + '); private evidence retained.', file=sys.stderr)
        raise SystemExit(1)

