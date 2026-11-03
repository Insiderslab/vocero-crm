#!/usr/bin/env python3
"""Capture and verify a fresh, read-only Bambola release build baseline."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path('/opt/bambola-arm')
RELEASES = ROOT / 'releases'
EVIDENCE = ROOT / 'evidence' / 'crm-recovery'
SNAPSHOT = EVIDENCE / 'host-readonly-snapshot.json'
CADDY_CONFIG = Path('/opt/heili/app/infra/Caddyfile')
CADDY_NAME = 'second-brain-caddy-1'
APP_NAME = 'bambola-arm-app-1'
GATEWAY_NAME = 'bambola-arm-gateway-1'
BUILDER_NAME = 'buildx_buildkit_bambola-arm-builder0'
PROJECT = 'bambola-arm'
DOMAIN = 'bambola.heili.cloud'
SCHEMA_VERSION = 1
SHA_RE = re.compile(r'^[0-9a-f]{64}$')
ROUTES = [
    'hair.heili.cloud/oggi', 'app.heili.cloud/', 'api.heili.cloud/',
    'crm.heili.cloud/', 'whapi.heili.cloud/', 'openclaw.heili.cloud/',
    'dm.heili.cloud/', 'paperclip.heili.cloud/', 'look.hairextensionclinic.it/',
    'approve.heili.cloud/', 'work.heili.cloud/', DOMAIN + '/',
]


class Refusal(RuntimeError):
    """A stale, malformed, or changed baseline prevents the build."""


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def command(args: list[str], *, timeout: int = 15) -> str:
    try:
        result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as exc:
        raise Refusal('Unable to verify current host state.') from exc
    return result.stdout


def regular_file_hash(path: Path) -> dict[str, str]:
    if path.is_symlink() or not path.is_file():
        raise Refusal('A required safe configuration file is missing or not regular.')
    return {'path': str(path), 'sha256': sha(path.read_bytes())}


def safe_file_hashes(release: Path) -> dict[str, dict[str, str]]:
    paths = {
        'compose': release / 'deploy/marine/compose.ubuntu.yml',
        'pinnedBaseCompose': RELEASES / '20261102-r5/deploy/marine/compose.ubuntu.yml',
        'gatewayTemplate': release / 'deploy/marine/gateway.crm.Caddyfile.template',
        'runtimeGateway': ROOT / 'runtime/gateway.Caddyfile',
        'runtimeOverride': ROOT / 'runtime/panels-20261102.override.yml',
        'runtimeEnv': ROOT / 'runtime/runtime.env',
    }
    result = {}
    for key, path in paths.items():
        if key == 'runtimeOverride' and not path.exists():
            result[key] = {'path': str(path), 'absent': 'true'}
        else:
            result[key] = regular_file_hash(path)
    return result


def _network_fields(container: dict) -> dict:
    out = {}
    for name, info in sorted((container.get('NetworkSettings', {}).get('Networks') or {}).items()):
        out[name] = {
            'networkId': info.get('NetworkID'),
            'endpointId': info.get('EndpointID'),
            'aliases': sorted(info.get('Aliases') or []),
            'ipAddress': info.get('IPAddress'),
            'globalIPv6Address': info.get('GlobalIPv6Address'),
        }
    return out


def _port_fields(container: dict) -> dict:
    out = {}
    for port, bindings in sorted((container.get('NetworkSettings', {}).get('Ports') or {}).items()):
        out[port] = sorted(
            [{'hostIp': item.get('HostIp'), 'hostPort': item.get('HostPort')} for item in (bindings or [])],
            key=lambda item: (item['hostIp'] or '', item['hostPort'] or ''),
        )
    return out


def _container_record(container: dict) -> dict:
    name = container['Name'].lstrip('/')
    state = container.get('State', {})
    return {
        'name': name,
        'id': container.get('Id'),
        'imageId': container.get('Image'),
        'configuredImage': container.get('Config', {}).get('Image'),
        'startedAt': state.get('StartedAt'),
        'restartCount': container.get('RestartCount'),
        'running': state.get('Running'),
        'health': (state.get('Health') or {}).get('Status'),
        'ports': _port_fields(container),
        'networks': _network_fields(container),
        'runtime': container.get('Runtime', {}),
    }


def containers_snapshot() -> list[dict]:
    ids = command(['docker', 'ps', '-aq']).splitlines()
    if not ids:
        raise Refusal('No Docker containers were found.')
    template = (
        '{{json .Name}}\t{{json .Id}}\t{{json .Image}}\t{{json .Config.Image}}\t'
        '{{json .State.StartedAt}}\t{{json .RestartCount}}\t{{json .State.Running}}\t'
        '{{with index .State "Health"}}{{json .Status}}{{else}}null{{end}}\t'
        '{{json .NetworkSettings.Ports}}\t{{json .NetworkSettings.Networks}}\t'
        '{{json .Mounts}}\t{{json .HostConfig.ReadonlyRootfs}}\t{{json .HostConfig.CapDrop}}\t'
        '{{json .HostConfig.CapAdd}}\t{{json .HostConfig.SecurityOpt}}\t{{json .HostConfig.Memory}}\t'
        '{{json .HostConfig.NanoCpus}}\t{{json .HostConfig.PidsLimit}}\t{{json .HostConfig.CpuQuota}}\t'
        '{{json .HostConfig.CpuPeriod}}\t{{json .HostConfig.Privileged}}\t'
        '{{json .HostConfig.RestartPolicy.Name}}\t{{json .Config.User}}'
    )
    rendered = command(['docker', 'inspect', '--format', template, *ids], timeout=20)
    try:
        raw = []
        for line in rendered.splitlines():
            fields = line.split('\t')
            if len(fields) != 23:
                raise ValueError('field count')
            values = [json.loads(v) for v in fields]
            (name, container_id, image_id, configured_image, started, restarts, running, health,
             ports, networks, mounts, readonly, cap_drop, cap_add, security_opt, memory,
             nano_cpus, pids_limit, cpu_quota, cpu_period, privileged, restart_policy, user) = values
            raw.append({
                'Name': name, 'Id': container_id, 'Image': image_id, 'RestartCount': restarts,
                'Config': {'Image': configured_image},
                'State': {'StartedAt': started, 'Running': running, 'Health': {'Status': health} if health else None},
                'NetworkSettings': {'Ports': ports, 'Networks': networks},
                'Mounts': mounts,
                'Runtime': {
                    'readonlyRootfs': readonly, 'capDrop': cap_drop, 'capAdd': cap_add,
                    'securityOpt': security_opt, 'memory': memory, 'nanoCpus': nano_cpus,
                    'pidsLimit': pids_limit, 'cpuQuota': cpu_quota, 'cpuPeriod': cpu_period,
                    'privileged': privileged, 'restartPolicy': restart_policy, 'user': user,
                    'mounts': mounts,
                },
            })
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise Refusal('Docker container metadata is malformed.') from exc
    records = [_container_record(item) for item in raw]
    return sorted((item for item in records if item['name'] != BUILDER_NAME), key=lambda item: item['name'])


def networks_snapshot() -> list[dict]:
    ids = command(['docker', 'network', 'ls', '-q']).splitlines()
    if not ids:
        raise Refusal('No Docker networks were found.')
    template = (
        '{{json .Id}}\t{{json .Name}}\t{{json .Driver}}\t{{json .Scope}}\t'
        '{{json .Internal}}\t{{json .EnableIPv6}}\t{{json .IPAM.Config}}\t{{json .Containers}}'
    )
    rendered = command(['docker', 'network', 'inspect', '--format', template, *ids], timeout=20)
    try:
        raw = []
        for line in rendered.splitlines():
            fields = line.split('\t')
            if len(fields) != 8:
                raise ValueError('field count')
            network_id, name, driver, scope, internal, enable_ipv6, ipam, containers = [json.loads(v) for v in fields]
            raw.append({
                'Id': network_id, 'Name': name, 'Driver': driver, 'Scope': scope,
                'Internal': internal, 'EnableIPv6': enable_ipv6,
                'IPAM': {'Config': ipam}, 'Containers': containers,
            })
    except (json.JSONDecodeError, TypeError, ValueError) as exc:
        raise Refusal('Docker network metadata is malformed.') from exc
    records = []
    for network in raw:
        attached = {}
        for container_id, item in sorted((network.get('Containers') or {}).items()):
            if item.get('Name') == BUILDER_NAME:
                continue
            attached[container_id] = {
                'name': item.get('Name'),
                'endpointId': item.get('EndpointID'),
                'ipv4Address': item.get('IPv4Address'),
                'ipv6Address': item.get('IPv6Address'),
            }
        records.append({
            'id': network.get('Id'), 'name': network.get('Name'),
            'driver': network.get('Driver'), 'scope': network.get('Scope'),
            'internal': network.get('Internal'), 'enableIPv6': network.get('EnableIPv6'),
            'ipam': network.get('IPAM', {}), 'containers': attached,
        })
    return sorted(records, key=lambda item: item['name'] or '')


def route_probe(url: str) -> dict:
    host, path = url.split('/', 1)
    target = 'https://' + host + '/' + path
    fmt = '%{http_code}|%{ssl_verify_result}|%{redirect_url}'
    output = command([
        'curl', '-sS', '--max-time', '10', '--connect-timeout', '5',
        '--output', os.devnull, '--write-out', fmt, target,
    ], timeout=12).strip()
    parts = output.split('|', 2)
    if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit():
        raise Refusal('HTTPS route probe returned malformed metadata.')
    location = None
    if parts[2]:
        parsed = urlsplit(parts[2])
        location = f'{parsed.scheme}://{parsed.netloc}{parsed.path}'
    return {'status': int(parts[0]), 'tlsVerified': parts[1] == '0', 'location': location}


def routes_snapshot(samples: int = 10) -> dict[str, list[dict]]:
    observed = {url: set() for url in ROUTES}
    def probe(url: str) -> tuple[str, dict]:
        return url, route_probe(url)
    with ThreadPoolExecutor(max_workers=len(ROUTES)) as pool:
        for index in range(samples):
            for url, result in pool.map(probe, ROUTES):
                if not result['tlsVerified']:
                    raise Refusal('TLS verification failed for a baseline route.')
                observed[url].add(json.dumps(result, sort_keys=True))
            if index + 1 < samples:
                time.sleep(1)
    return {url: [json.loads(value) for value in sorted(values)] for url, values in observed.items()}


def resources_snapshot() -> dict[str, int]:
    try:
        available_kib = int(Path('/proc/meminfo').read_text().split('MemAvailable:')[1].split()[0])
        fields = subprocess.check_output(['df', '-Pk', '/opt'], text=True, timeout=5).splitlines()[1].split()
        free_kib = int(fields[3])
    except (OSError, subprocess.SubprocessError, ValueError, IndexError) as exc:
        raise Refusal('Host resource availability could not be captured.') from exc
    return {'memAvailableKiB': available_kib, 'optFreeKiB': free_kib}


def _caddy_record(containers: list[dict]) -> dict:
    hits = [item for item in containers if item['name'] == CADDY_NAME]
    if len(hits) != 1:
        raise Refusal('Shared Caddy container identity is missing or ambiguous.')
    return hits[0]


def _owned_services(containers: list[dict]) -> dict[str, dict]:
    by_name = {item['name']: item for item in containers}
    if APP_NAME not in by_name or GATEWAY_NAME not in by_name:
        raise Refusal('Current Bambola app or gateway container is missing.')
    return {'app': by_name[APP_NAME], 'gateway': by_name[GATEWAY_NAME]}


def current_snapshot_fields(release: Path, route_samples: int = 10) -> dict:
    containers = containers_snapshot()
    caddy_container = _caddy_record(containers)
    if CADDY_CONFIG.is_symlink() or not CADDY_CONFIG.is_file():
        raise Refusal('Shared Caddy configuration is missing or not regular.')
    caddy_bytes = CADDY_CONFIG.read_bytes()
    return {
        'caddy': {
            'container': caddy_container,
            'config': {'path': str(CADDY_CONFIG), 'inode': CADDY_CONFIG.stat().st_ino, 'sha256': sha(caddy_bytes)},
        },
        'containers': containers,
        'ownedAppGateway': _owned_services(containers),
        'networks': networks_snapshot(),
        'routes': routes_snapshot(route_samples),
        'configFiles': safe_file_hashes(release),
        'resources': resources_snapshot(),
    }


def _manifest_release(path: Path, digest: str) -> Path:
    if not SHA_RE.fullmatch(digest or ''):
        raise Refusal('A valid reviewed release manifest SHA-256 is required.')
    if path.is_symlink():
        raise Refusal('Release directory must not be a symlink.')
    try:
        release = path.resolve(strict=True)
        releases = RELEASES.resolve(strict=True)
    except OSError as exc:
        raise Refusal('Release directory is unavailable.') from exc
    if release.parent != releases or release.is_symlink():
        raise Refusal('Release must be a direct child of the fixed releases directory.')
    verify = release / 'deploy/marine/manifest.py'
    if verify.is_symlink() or not verify.is_file():
        raise Refusal('Release manifest verifier is missing.')
    command([sys.executable, str(verify), 'verify', str(release), digest], timeout=30)
    return release


def _snapshot_read(manifest_digest: str, snapshot_digest: str) -> dict:
    if ROOT.is_symlink() or (ROOT / 'evidence').is_symlink() or EVIDENCE.is_symlink() or SNAPSHOT.is_symlink() or not SNAPSHOT.is_file():
        raise Refusal('Fresh CRM recovery snapshot is missing or unsafe.')
    if os.name == 'posix' and ((SNAPSHOT.stat().st_mode & 0o777) != 0o600 or (EVIDENCE.stat().st_mode & 0o777) != 0o700):
        raise Refusal('Snapshot directory or file permissions are not private.')
    try:
        raw = SNAPSHOT.read_bytes()
        if not SHA_RE.fullmatch(snapshot_digest or '') or sha(raw) != snapshot_digest:
            raise Refusal('Pinned snapshot digest does not match.')
        data = json.loads(raw.decode('utf-8'))
    except Refusal:
        raise
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise Refusal('Snapshot JSON is malformed.') from exc
    expected_keys = {
        'schemaVersion', 'manifestSha256', 'capturedAt', 'target', 'caddy',
        'containers', 'ownedAppGateway', 'networks', 'routes', 'configFiles', 'resources',
    }
    if not isinstance(data, dict) or set(data) != expected_keys:
        raise Refusal('Snapshot schema is invalid.')
    if type(data['schemaVersion']) is not int or data['schemaVersion'] != SCHEMA_VERSION or data['manifestSha256'] != manifest_digest:
        raise Refusal('Snapshot schema or manifest does not match this build.')
    try:
        timestamp = datetime.fromisoformat(data['capturedAt'].replace('Z', '+00:00'))
    except (AttributeError, TypeError, ValueError) as exc:
        raise Refusal('Snapshot timestamp is invalid.') from exc
    if timestamp.tzinfo is None:
        raise Refusal('Snapshot timestamp must include a timezone.')
    if data['target'] != {'root': str(ROOT), 'project': PROJECT, 'domain': DOMAIN}:
        raise Refusal('Snapshot target is invalid.')
    return data


def _write_snapshot_exclusive(encoded: bytes) -> None:
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, 'O_NOFOLLOW'):
        flags |= os.O_NOFOLLOW
    fd = os.open(SNAPSHOT, flags, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(encoded)
        stream.flush()
        os.fsync(stream.fileno())
    if os.name == 'posix':
        os.chmod(SNAPSHOT, 0o600)


def verify_snapshot_state(record: dict, current: dict) -> None:
    for key in ('caddy', 'containers', 'ownedAppGateway', 'networks', 'configFiles'):
        if current[key] != record[key]:
            raise Refusal('Host, Caddy, network, container, or safe config baseline changed.')
    for url, observed in current['routes'].items():
        accepted = {json.dumps(item, sort_keys=True) for item in record['routes'].get(url, [])}
        if not observed or any(json.dumps(item, sort_keys=True) not in accepted for item in observed):
            raise Refusal('A trusted route status or TLS baseline changed.')
    if not current['resources']['memAvailableKiB'] or not current['resources']['optFreeKiB']:
        raise Refusal('Host resource availability could not be verified.')


def capture_baseline(release_path: Path, manifest_digest: str) -> dict:
    release = _manifest_release(release_path, manifest_digest)
    if ROOT.is_symlink() or (ROOT / 'evidence').is_symlink():
        raise Refusal('Fixed evidence parent must not be a symlink.')
    if EVIDENCE.exists() or EVIDENCE.is_symlink() or SNAPSHOT.exists() or SNAPSHOT.is_symlink():
        raise Refusal('Fresh snapshot path already exists; refusing reuse or overwrite.')
    fields = current_snapshot_fields(release)
    record = {
        'schemaVersion': SCHEMA_VERSION,
        'manifestSha256': manifest_digest,
        'capturedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        'target': {'root': str(ROOT), 'project': PROJECT, 'domain': DOMAIN},
        **fields,
    }
    EVIDENCE.mkdir(mode=0o700, parents=True, exist_ok=False)
    os.chmod(EVIDENCE, 0o700)
    encoded = (json.dumps(record, sort_keys=True, indent=2) + '\n').encode('utf-8')
    _write_snapshot_exclusive(encoded)
    return record


def check_current(manifest_digest: str, snapshot_digest: str) -> None:
    record = _snapshot_read(manifest_digest, snapshot_digest)
    # The manifest-bound release path is stored as safe metadata so current file hashes can be rechecked.
    release_path = Path(record['configFiles']['compose']['path']).parents[2]
    release = _manifest_release(release_path, manifest_digest)
    current = current_snapshot_fields(release, route_samples=1)
    verify_snapshot_state(record, current)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    baseline = sub.add_parser('baseline')
    baseline.add_argument('--release', required=True, type=Path)
    baseline.add_argument('--manifest-sha256', required=True)
    check = sub.add_parser('check')
    check.add_argument('--manifest-sha256', required=True)
    check.add_argument('--snapshot-sha256', required=True)
    args = parser.parse_args(argv)
    if args.action == 'baseline':
        capture_baseline(args.release, args.manifest_sha256)
        print('Fresh private read-only baseline captured; SHA-256: ' + sha(SNAPSHOT.read_bytes()))
    else:
        check_current(args.manifest_sha256, args.snapshot_sha256)
        print('Current host matches the fresh build baseline.')
    return 0


if __name__ == '__main__':
    os.umask(0o077)
    try:
        raise SystemExit(main())
    except Refusal as exc:
        print('CRM host guard refused operation: ' + str(exc), file=sys.stderr)
        raise SystemExit(2)
