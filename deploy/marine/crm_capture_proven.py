#!/usr/bin/env python3
"""Archive the superseded capture and write a proof-bound CRM baseline."""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import crm_host
import crm_rollout

PARENT = crm_host.ROOT / 'evidence'
ARCHIVE = PARENT / 'crm-recovery-single-r6-20261103'
OLD_SNAPSHOT_SHA = 'f3286ea3bf310d4884be341f1d25025bbebea0809a6519ae776158b7498f6de0'
SOURCE_GROUPS = ('caddy', 'containers', 'ownedAppGateway', 'networks', 'configFiles')
APP_PROOF_ROUTE = 'app.heili.cloud/'


def canonical(value: object) -> bytes:
    return (json.dumps(value, sort_keys=True, indent=2) + '\n').encode('utf-8')


def private_bytes(path: Path) -> bytes:
    return crm_host._private_root_file(path)


def _sources() -> list[dict]:
    records = []
    for path, digest, manifest in crm_host.SOURCE_PROOFS:
        raw = private_bytes(path)
        if crm_host.sha(raw) != digest:
            raise crm_host.Refusal('A pinned route source proof digest changed.')
        try:
            record = json.loads(raw.decode('utf-8'))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise crm_host.Refusal('A pinned route source proof is malformed.') from exc
        if record.get('schemaVersion') != 1 or record.get('manifestSha256') != manifest or record.get('target') != {'root': str(crm_host.ROOT), 'project': crm_host.PROJECT, 'domain': crm_host.DOMAIN}:
            raise crm_host.Refusal('A pinned source proof schema, target, or manifest is invalid.')
        if os.name == 'posix' and path.stat().st_uid != 0:
            raise crm_host.Refusal('A pinned source proof is not root-owned.')
        source_release = Path(record['configFiles']['compose']['path']).parents[2]
        crm_host._manifest_release(source_release, manifest)
        if not isinstance(record.get('routes'), dict) or set(record['routes']) != set(crm_host.ROUTES):
            raise crm_host.Refusal('Pinned source proof route keys are invalid.')
        for url in crm_host.ROUTES:
            outcomes = record['routes'][url]
            if not isinstance(outcomes, list) or not outcomes or outcomes != sorted(outcomes, key=lambda value: json.dumps(value, sort_keys=True)):
                raise crm_host.Refusal('Pinned source proof has no route outcomes.')
            for outcome in outcomes:
                if not isinstance(outcome, dict) or set(outcome) != {'status', 'tlsVerified', 'location'} or type(outcome['status']) is not int or outcome['tlsVerified'] is not True or type(outcome['tlsVerified']) is not bool or (outcome['location'] is not None and not isinstance(outcome['location'], str)):
                    raise crm_host.Refusal('Pinned source proof contains a malformed route outcome.')
        records.append(record)
        records[-1]['_source'] = {'path': str(path), 'sha256': digest, 'manifestSha256': manifest}
    if len(records) != 2 or any(records[0][key] != records[1][key] for key in SOURCE_GROUPS):
        raise crm_host.Refusal('The two pinned route proofs have different host metadata.')
    app = APP_PROOF_ROUTE
    union = sorted({json.dumps(route, sort_keys=True) for record in records for route in record['routes'][app]})
    app_routes = [json.loads(item) for item in union]
    shape = [
        {'status': 200, 'tlsVerified': True, 'location': None},
        {'status': 307, 'tlsVerified': True, 'location': 'https://app.heili.cloud/dashboard'},
    ]
    if {json.dumps(item, sort_keys=True) for item in app_routes} != {json.dumps(item, sort_keys=True) for item in shape}:
        raise crm_host.Refusal('The verified source app routes do not match the reviewed two-outcome shape.')
    return records


def _normalize_source_metadata(source: dict, current: dict) -> dict:
    expected = {key: source[key] for key in SOURCE_GROUPS}
    old_files = expected['configFiles']
    new_files = current['configFiles']
    for key, old_path, new_path in (
        ('compose', crm_host.PRIOR_COMPOSE, new_files['compose']['path']),
        ('gatewayTemplate', crm_host.PRIOR_GATEWAY_TEMPLATE, new_files['gatewayTemplate']['path']),
    ):
        if old_files.get(key, {}).get('path') != old_path or old_files[key].get('sha256') != new_files[key].get('sha256'):
            raise crm_host.Refusal('A release-internal source path or digest differs from the reviewed proof.')
        old_files[key]['path'] = new_path
    return expected


def _check_runtime_state() -> None:
    if crm_host.ROOT.is_symlink() or PARENT.is_symlink() or not PARENT.is_dir() or (os.name == 'posix' and (PARENT.stat().st_uid != 0 or PARENT.stat().st_mode & 0o777 != 0o700)):
        raise crm_host.Refusal('The fixed evidence parent is missing or unsafe.')
    if any((crm_host.EVIDENCE / name).exists() or (crm_host.EVIDENCE / name).is_symlink()
           for name in ('activation.lock', 'rollout-operation.lock', 'activation-plan.json')):
        raise crm_host.Refusal('Legacy rollout state exists; refusing archive.')
    if ARCHIVE.exists() or ARCHIVE.is_symlink():
        raise crm_host.Refusal('The fixed evidence archive already exists.')
    if crm_host.EVIDENCE.is_symlink() or not crm_host.EVIDENCE.is_dir():
        raise crm_host.Refusal('The current evidence directory is missing or unsafe.')
    entries = list(crm_host.EVIDENCE.iterdir())
    if os.name == 'posix' and (crm_host.EVIDENCE.stat().st_uid != 0 or crm_host.EVIDENCE.stat().st_mode & 0o777 != 0o700):
        raise crm_host.Refusal('The current evidence directory has unsafe ownership or permissions.')
    if len(entries) != 1 or entries[0] != crm_host.SNAPSHOT:
        raise crm_host.Refusal('The current evidence directory contains unexpected state.')
    if crm_host.sha(private_bytes(crm_host.SNAPSHOT)) != OLD_SNAPSHOT_SHA:
        raise crm_host.Refusal('The current snapshot is not the reviewed superseded baseline.')
    builders = crm_rollout.safe_run(['docker', 'ps', '-aq', '--filter', 'name=^/' + crm_host.BUILDER_NAME + '$', '--format', '{{.Names}}']).splitlines()
    if builders:
        raise crm_host.Refusal('The dedicated Bambola builder is still running.')


def _write(path: Path, data: bytes) -> None:
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    if os.name == 'posix':
        os.chmod(path, 0o600)


def capture_proven(release: Path, manifest: str) -> dict:
    with crm_rollout.operation_lock():
        _check_runtime_state()
        release = crm_host._manifest_release(release, manifest)
        sources = _sources()
        source_a, source_b = sources
        os.rename(crm_host.EVIDENCE, ARCHIVE)
        if crm_host.sha(private_bytes(ARCHIVE / 'host-readonly-snapshot.json')) != OLD_SNAPSHOT_SHA:
            raise crm_host.Refusal('Archived snapshot digest changed during the rename.')
        before = crm_host.current_snapshot_metadata(release)
        fresh_routes = crm_host.routes_snapshot(samples=10, interval_seconds=1)
        after = crm_host.current_snapshot_metadata(release)
        source_metadata = _normalize_source_metadata(source_a, before)
        _normalize_source_metadata(source_b, after)
        if before != after or any(source_metadata[key] != before[key] for key in SOURCE_GROUPS):
            raise crm_host.Refusal('Current metadata differs from the pinned proof windows.')
        resources = crm_host.resources_snapshot()
        if any(type(value) is not int or value <= 0 for value in resources.values()):
            raise crm_host.Refusal('Host resource availability could not be verified.')
        app_url = APP_PROOF_ROUTE
        derived_app = sorted({json.dumps(value, sort_keys=True) for source in sources for value in source['routes'][app_url]})
        derived_app = [json.loads(value) for value in derived_app]
        for url in crm_host.ROUTES:
            outcomes = fresh_routes.get(url, [])
            allowed = derived_app if url == app_url else source_a['routes'][url]
            if url != app_url and (source_a['routes'][url] != source_b['routes'][url] or len(source_a['routes'][url]) != 1):
                raise crm_host.Refusal('A non-app route differs between the pinned source proofs.')
            if not outcomes or any(value not in allowed for value in outcomes):
                raise crm_host.Refusal('A fresh route outcome is outside the verified source evidence.')
        stamp = datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')
        crm_host.EVIDENCE.mkdir(mode=0o700, exist_ok=False)
        os.chmod(crm_host.EVIDENCE, 0o700)
        audit = {
            'schemaVersion': 1, 'capturedAt': stamp, 'manifestSha256': manifest,
            'sources': [item['_source'] for item in sources], 'currentRoutes': fresh_routes,
            'derivedAppRoutes': derived_app,
        }
        audit_raw = canonical(audit)
        audit_sha = crm_host.sha(audit_raw)
        _write(crm_host.ROUTE_AUDIT, audit_raw)
        baseline = {
            'schemaVersion': 2, 'manifestSha256': manifest, 'capturedAt': stamp,
            'target': {'root': str(crm_host.ROOT), 'project': crm_host.PROJECT, 'domain': crm_host.DOMAIN},
            **after, 'routes': {**fresh_routes, app_url: derived_app}, 'resources': resources,
            'routeEvidenceSha256': audit_sha,
        }
        baseline_raw = canonical(baseline)
        crm_host._validate_route_evidence(baseline)
        _write(crm_host.SNAPSHOT, baseline_raw)
        return {'baselineSha256': crm_host.sha(baseline_raw), 'auditSha256': audit_sha, 'archive': str(ARCHIVE)}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', required=True, type=Path)
    parser.add_argument('--manifest-sha256', required=True)
    args = parser.parse_args(argv)
    try:
        result = capture_proven(args.release, args.manifest_sha256)
    except (crm_host.Refusal, crm_rollout.Refusal) as exc:
        print('Proven CRM baseline refused: ' + str(exc), file=sys.stderr)
        return 2
    except Exception as exc:
        print('Proven CRM baseline failed (' + type(exc).__name__ + ').', file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    os.umask(0o077)
    raise SystemExit(main())
