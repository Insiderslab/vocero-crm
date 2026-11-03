import importlib.util
import json
import os
import tempfile
from types import SimpleNamespace
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

BASE = Path(__file__).parents[1]
for name in ('crm_host', 'crm_rollout'):
    spec = importlib.util.spec_from_file_location(name, BASE / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    import sys
    sys.modules[name] = module
    spec.loader.exec_module(module)
spec = importlib.util.spec_from_file_location('crm_capture_proven', BASE / 'crm_capture_proven.py')
capture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(capture)
spec = importlib.util.spec_from_file_location('build_crm', BASE / 'build_crm.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)


class ProvenCaptureTests(unittest.TestCase):
    def reader_fixture(self, root):
        host = capture.crm_host
        evidence = root / 'evidence' / 'crm-recovery'; evidence.mkdir(parents=True)
        release = root / 'releases' / 'r1'; release.mkdir(parents=True)
        app_url = 'app.heili.cloud/'
        app_routes = sorted([
            {'status': 200, 'tlsVerified': True, 'location': None},
            {'status': 307, 'tlsVerified': True, 'location': 'https://app.heili.cloud/dashboard'},
        ], key=lambda value: json.dumps(value, sort_keys=True))
        groups = {
            'caddy': {'id': 'caddy'}, 'containers': [{'name': 'app'}],
            'ownedAppGateway': {'app': {'id': 'app'}, 'gateway': {'id': 'gw'}}, 'networks': [{'id': 'net'}],
            'configFiles': {
                'compose': {'path': host.PRIOR_COMPOSE, 'sha256': 'a'*64},
                'gatewayTemplate': {'path': host.PRIOR_GATEWAY_TEMPLATE, 'sha256': 'b'*64},
            },
        }
        routes = {url: [{'status': 200, 'tlsVerified': True, 'location': None}] for url in host.ROUTES}
        routes[app_url] = app_routes
        now = datetime.now(timezone.utc).replace(microsecond=0)
        sources = []
        for index in range(2):
            path = root / f'proof-{index}.json'
            record = {
                'schemaVersion': 1, 'manifestSha256': 'd'*64,
                'capturedAt': (now.replace(minute=max(0, now.minute-1))).isoformat().replace('+00:00','Z'),
                'target': {'root': str(host.ROOT), 'project': host.PROJECT, 'domain': host.DOMAIN},
                **json.loads(json.dumps(groups)), 'routes': json.loads(json.dumps(routes)),
                'resources': {'memAvailableKiB': 100, 'optFreeKiB': 200},
            }
            path.write_bytes(capture.canonical(record))
            sources.append((path, host.sha(path.read_bytes()), 'd'*64))
        baseline_config = json.loads(json.dumps(groups['configFiles']))
        baseline_config['compose']['path'] = str(release / 'deploy/marine/compose.ubuntu.yml')
        baseline_config['gatewayTemplate']['path'] = str(release / 'deploy/marine/gateway.crm.Caddyfile.template')
        current_routes = json.loads(json.dumps(routes)); current_routes[app_url] = [app_routes[0]]
        baseline_routes = json.loads(json.dumps(routes))
        audit = {
            'schemaVersion': 1, 'capturedAt': now.isoformat().replace('+00:00','Z'),
            'manifestSha256': 'c'*64,
            'sources': [{'path': str(path), 'sha256': digest, 'manifestSha256': manifest} for path,digest,manifest in sources],
            'currentRoutes': current_routes, 'derivedAppRoutes': app_routes,
        }
        audit_path = evidence / 'route-source-proofs.json'; audit_path.write_bytes(capture.canonical(audit))
        baseline = {
            'schemaVersion': 2, 'manifestSha256': 'c'*64, 'capturedAt': audit['capturedAt'],
            'target': {'root': str(host.ROOT), 'project': host.PROJECT, 'domain': host.DOMAIN},
            **{key: groups[key] for key in ('caddy','containers','ownedAppGateway','networks')},
            'configFiles': baseline_config, 'routes': baseline_routes,
            'resources': {'memAvailableKiB': 100, 'optFreeKiB': 200}, 'routeEvidenceSha256': host.sha(audit_path.read_bytes()),
        }
        snapshot_path = evidence / 'host-readonly-snapshot.json'; snapshot_path.write_bytes(capture.canonical(baseline))
        return evidence, release, sources, snapshot_path, audit_path, baseline

    def test_schema2_reader_accepts_valid_bound_audit_and_rejects_missing_or_tampered(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td); evidence, release, sources, snapshot, audit_path, baseline = self.reader_fixture(root)
            host = capture.crm_host
            with patch.object(host, 'EVIDENCE', evidence), patch.object(host, 'SNAPSHOT', snapshot), \
                 patch.object(host, 'ROUTE_AUDIT', audit_path), patch.object(host, 'SOURCE_PROOFS', sources), \
                 patch.object(host, '_manifest_release', side_effect=lambda path, digest: Path(path)):
                self.assertEqual(host._snapshot_read('c'*64, host.sha(snapshot.read_bytes()))['schemaVersion'], 2)
                audit_path.unlink()
                with self.assertRaises(host.Refusal): host._snapshot_read('c'*64, host.sha(snapshot.read_bytes()))
                audit_path.write_text('{}', encoding='utf-8')
                baseline['routeEvidenceSha256'] = host.sha(audit_path.read_bytes())
                snapshot.write_bytes(capture.canonical(baseline))
                with self.assertRaises(host.Refusal): host._snapshot_read('c'*64, host.sha(snapshot.read_bytes()))

    def test_schema2_reader_rejects_source_metadata_and_current_route_changes(self):
        for change in ('source', 'route'):
            with self.subTest(change=change), tempfile.TemporaryDirectory() as td:
                root=Path(td); evidence, release, sources, snapshot, audit_path, baseline=self.reader_fixture(root)
                host=capture.crm_host
                if change == 'source':
                    source=json.loads(sources[0][0].read_text()); source['containers'][0]['name']='changed'
                    sources[0][0].write_text(json.dumps(source),encoding='utf-8')
                    sources[0]=(sources[0][0],host.sha(sources[0][0].read_bytes()),sources[0][2])
                    audit=json.loads(audit_path.read_text()); audit['sources'][0]['sha256']=sources[0][1]
                    audit_path.write_bytes(capture.canonical(audit))
                    baseline['routeEvidenceSha256']=host.sha(audit_path.read_bytes()); snapshot.write_bytes(capture.canonical(baseline))
                else:
                    audit=json.loads(audit_path.read_text()); audit['currentRoutes']['app.heili.cloud/']=[{'status':503,'tlsVerified':True,'location':None}]
                    audit_path.write_bytes(capture.canonical(audit)); baseline['routeEvidenceSha256']=host.sha(audit_path.read_bytes())
                    snapshot.write_bytes(capture.canonical(baseline))
                with patch.object(host, 'EVIDENCE', evidence), patch.object(host, 'SNAPSHOT', snapshot), \
                     patch.object(host, 'ROUTE_AUDIT', audit_path), patch.object(host, 'SOURCE_PROOFS', sources), \
                     patch.object(host, '_manifest_release', side_effect=lambda path, digest: Path(path)):
                    with self.assertRaises(host.Refusal): host._snapshot_read('c'*64, host.sha(snapshot.read_bytes()))

    def test_schema2_reader_negative_matrix_for_target_path_hash_time_and_resources(self):
        for case in ('target', 'path', 'audit_hash', 'baseline_time', 'source_age', 'resource_bool', 'resource_zero', 'source_hash', 'source_target', 'source_path', 'source_resources'):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as td:
                root=Path(td); evidence,release,sources,snapshot,audit,baseline=self.reader_fixture(root)
                host=capture.crm_host
                audit_data=json.loads(audit.read_text())
                if case == 'target': baseline['target']['domain']='wrong.example'
                elif case == 'path': baseline['configFiles']['compose']['path']=str(release/'other/compose.yml')
                elif case == 'audit_hash': baseline['routeEvidenceSha256']='f'*64
                elif case == 'baseline_time':
                    baseline['capturedAt']='2026-11-03T12:00:00+01:00'; audit_data['capturedAt']=baseline['capturedAt']
                    audit.write_bytes(capture.canonical(audit_data))
                elif case == 'source_age':
                    source=json.loads(sources[0][0].read_text()); source['capturedAt']='2026-11-01T00:00:00Z'
                    sources[0][0].write_bytes(capture.canonical(source)); sources[0]=(sources[0][0],host.sha(sources[0][0].read_bytes()),sources[0][2])
                    audit_data['sources'][0]['sha256']=sources[0][1]; audit.write_bytes(capture.canonical(audit_data))
                    baseline['routeEvidenceSha256']=host.sha(audit.read_bytes())
                elif case == 'resource_bool': baseline['resources']['memAvailableKiB']=True
                elif case == 'resource_zero': baseline['resources']['optFreeKiB']=0
                elif case == 'source_hash': sources[0][0].write_bytes(b'tampered')
                elif case in ('source_target','source_path','source_resources'):
                    source=json.loads(sources[0][0].read_text())
                    if case=='source_target': source['target']['domain']='wrong.example'
                    elif case=='source_path': source['configFiles']['compose']['path']='/opt/bambola-arm/releases/other/deploy/marine/compose.ubuntu.yml'
                    else: source['resources']['memAvailableKiB']=True
                    sources[0][0].write_bytes(capture.canonical(source)); sources[0]=(sources[0][0],host.sha(sources[0][0].read_bytes()),sources[0][2])
                    audit_data['sources'][0]['sha256']=sources[0][1]; audit.write_bytes(capture.canonical(audit_data))
                if case not in ('audit_hash','source_hash'): baseline['routeEvidenceSha256']=host.sha(audit.read_bytes())
                snapshot.write_bytes(capture.canonical(baseline))
                with patch.object(host,'EVIDENCE',evidence),patch.object(host,'SNAPSHOT',snapshot),patch.object(host,'ROUTE_AUDIT',audit), \
                     patch.object(host,'SOURCE_PROOFS',sources),patch.object(host,'_manifest_release',side_effect=lambda path,digest:Path(path)):
                    if case == 'baseline_time':
                        with self.assertRaisesRegex(host.Refusal, 'canonical UTC'):
                            host._snapshot_read('c'*64,host.sha(snapshot.read_bytes()))
                    else:
                        with self.assertRaises(host.Refusal): host._snapshot_read('c'*64,host.sha(snapshot.read_bytes()))

    def test_schema2_reader_rejects_private_mode_symlink_and_nonroot_snapshot(self):
        host=capture.crm_host
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); evidence,release,sources,snapshot,audit,baseline=self.reader_fixture(root)
            with patch.object(host,'EVIDENCE',evidence),patch.object(host,'SNAPSHOT',snapshot),patch.object(host,'ROUTE_AUDIT',audit), \
                 patch.object(host,'SOURCE_PROOFS',sources),patch.object(host,'_manifest_release',side_effect=lambda path,digest:Path(path)), \
                 patch.object(host.os,'name','posix'),patch.object(host,'_snapshot_modes_private',return_value=True), \
                 patch.object(host,'_snapshot_root_owned',return_value=False):
                with self.assertRaisesRegex(host.Refusal,'root-owned'):
                    host._snapshot_read('c'*64,host.sha(snapshot.read_bytes()))
            # Simulate POSIX file modes while keeping the snapshot and evidence directory private.
            original_stat=Path.stat
            def simulated_stat(path,*args,**kwargs):
                result=original_stat(path,*args,**kwargs)
                if Path(path)==audit: return SimpleNamespace(st_mode=0o100644,st_uid=0)
                if Path(path)==snapshot: return SimpleNamespace(st_mode=0o100600,st_uid=0)
                if Path(path)==evidence: return SimpleNamespace(st_mode=0o40700,st_uid=0)
                if Path(path) in [item[0] for item in sources]: return SimpleNamespace(st_mode=0o100600,st_uid=0)
                return result
            with patch.object(type(snapshot),'stat',autospec=True,side_effect=simulated_stat), \
                 patch.object(host,'EVIDENCE',evidence),patch.object(host,'SNAPSHOT',snapshot),patch.object(host,'ROUTE_AUDIT',audit), \
                 patch.object(host,'SOURCE_PROOFS',sources),patch.object(host,'_manifest_release',side_effect=lambda path,digest:Path(path)), \
                 patch.object(host.os,'name','posix'),patch.object(host,'_snapshot_modes_private',return_value=True):
                with self.assertRaisesRegex(host.Refusal,'unsafe ownership or permissions'):
                    host._snapshot_read('c'*64,host.sha(snapshot.read_bytes()))

    def test_schema2_reader_rejects_symlinked_audit(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); evidence,release,sources,snapshot,audit,baseline=self.reader_fixture(root)
            original=Path.is_symlink
            with patch.object(capture.crm_host,'EVIDENCE',evidence),patch.object(capture.crm_host,'SNAPSHOT',snapshot), \
                 patch.object(capture.crm_host,'ROUTE_AUDIT',audit),patch.object(capture.crm_host,'SOURCE_PROOFS',sources), \
                 patch.object(capture.crm_host,'_manifest_release',side_effect=lambda path,digest:Path(path)), \
                 patch.object(Path,'is_symlink',autospec=True,side_effect=lambda path: path==audit or original(path)):
                with self.assertRaises(capture.crm_host.Refusal): capture.crm_host._snapshot_read('c'*64,capture.crm_host.sha(snapshot.read_bytes()))

    def test_schema2_reader_rejects_nonprivate_source_proof_mode(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); evidence,release,sources,snapshot,audit,baseline=self.reader_fixture(root)
            original_stat=Path.stat
            def simulated_stat(path,*args,**kwargs):
                result=original_stat(path,*args,**kwargs)
                if Path(path)==sources[0][0]: return SimpleNamespace(st_mode=0o100644,st_uid=0)
                if Path(path)==audit: return SimpleNamespace(st_mode=0o100600,st_uid=0)
                return result
            with patch.object(capture.crm_host,'EVIDENCE',evidence),patch.object(capture.crm_host,'SNAPSHOT',snapshot), \
                 patch.object(capture.crm_host,'ROUTE_AUDIT',audit),patch.object(capture.crm_host,'SOURCE_PROOFS',sources), \
                 patch.object(capture.crm_host,'_manifest_release',side_effect=lambda path,digest:Path(path)), \
                 patch.object(capture.crm_host.os,'name','posix'),patch.object(capture.crm_host,'_snapshot_root_owned',return_value=True), \
                 patch.object(capture.crm_host,'_snapshot_modes_private',return_value=True), \
                 patch.object(type(snapshot),'stat',autospec=True,side_effect=simulated_stat):
                with self.assertRaisesRegex(capture.crm_host.Refusal,'unsafe ownership or permissions'):
                    capture.crm_host._snapshot_read('c'*64,capture.crm_host.sha(snapshot.read_bytes()))

    def test_schema2_reader_rejects_symlinked_source_proof(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); evidence,release,sources,snapshot,audit,baseline=self.reader_fixture(root)
            original=Path.is_symlink
            with patch.object(capture.crm_host,'EVIDENCE',evidence),patch.object(capture.crm_host,'SNAPSHOT',snapshot), \
                 patch.object(capture.crm_host,'ROUTE_AUDIT',audit),patch.object(capture.crm_host,'SOURCE_PROOFS',sources), \
                 patch.object(capture.crm_host,'_manifest_release',side_effect=lambda path,digest:Path(path)), \
                 patch.object(Path,'is_symlink',autospec=True,side_effect=lambda path:path==sources[0][0] or original(path)):
                with self.assertRaises(capture.crm_host.Refusal):
                    capture.crm_host._snapshot_read('c'*64,capture.crm_host.sha(snapshot.read_bytes()))

    def test_audit_write_failure_preserves_archive_and_creates_no_baseline(self):
        for failed_stage in ('audit','baseline'):
          with self.subTest(stage=failed_stage),tempfile.TemporaryDirectory() as td:
            root=Path(td); evidence,release,sources,snapshot,audit,baseline=self.reader_fixture(root)
            snapshot.write_bytes(b'old')
            source=json.loads(sources[0][0].read_text())
            current={key:source[key] for key in ('caddy','containers','ownedAppGateway','networks','configFiles')}
            current['configFiles']['compose']['path']=str(release/'deploy/marine/compose.ubuntu.yml')
            current['configFiles']['gatewayTemplate']['path']=str(release/'deploy/marine/gateway.crm.Caddyfile.template')
            write=capture._write
            def failed(path,data):
                if (failed_stage=='audit' and path==audit) or (failed_stage=='baseline' and path==snapshot):
                    raise OSError('disk write failed')
                write(path,data)
            with patch.object(capture.crm_host,'EVIDENCE',evidence),patch.object(capture.crm_host,'SNAPSHOT',snapshot), \
                 patch.object(capture.crm_host,'ROUTE_AUDIT',audit),patch.object(capture.crm_host,'SOURCE_PROOFS',sources), \
                 patch.object(capture,'PARENT',root/'evidence'),patch.object(capture,'ARCHIVE',root/'evidence'/'archive'), \
                 patch.object(capture,'OLD_SNAPSHOT_SHA',capture.crm_host.sha(b'old')),patch.object(capture,'_check_runtime_state'), \
                 patch.object(capture.crm_host,'_manifest_release',side_effect=lambda path,digest:Path(path)), \
                 patch.object(capture.crm_host,'current_snapshot_metadata',return_value=current), \
                 patch.object(capture.crm_host,'routes_snapshot',return_value=baseline['routes']), \
                 patch.object(capture.crm_host,'resources_snapshot',return_value=baseline['resources']), \
                 patch.object(capture,'_write',side_effect=failed),patch.object(capture.crm_rollout,'OP_LOCK',root/'lock'):
                with self.assertRaises(OSError): capture.capture_proven(release,'c'*64)
            self.assertTrue((root/'evidence'/'archive').is_dir())
            self.assertTrue(evidence.is_dir())
            self.assertFalse(snapshot.exists())
            self.assertEqual(audit.exists(),failed_stage=='baseline')

    def test_routes_are_derived_from_verified_source_records(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            evidence = root / 'evidence' / 'crm-recovery'
            evidence.mkdir(parents=True)
            snapshot = evidence / 'host-readonly-snapshot.json'
            snapshot.write_bytes(b'old')
            archive = root / 'evidence' / 'archive'
            release = root / 'releases' / 'r1'
            release.mkdir(parents=True)
            sources = []
            current = {
                'caddy': {'id': 'caddy'}, 'containers': [{'name': 'app'}],
                'ownedAppGateway': {'app': {'id': 'app'}, 'gateway': {'id': 'gw'}},
                'networks': [{'id': 'net'}],
                'configFiles': {
                    'compose': {'path': str(release / 'deploy/marine/compose.ubuntu.yml'), 'sha256': 'a'*64},
                    'gatewayTemplate': {'path': str(release / 'deploy/marine/gateway.crm.Caddyfile.template'), 'sha256': 'b'*64},
                },
            }
            old_config = json.loads(json.dumps(current))
            old_config['configFiles']['compose']['path'] = capture.crm_host.PRIOR_COMPOSE
            old_config['configFiles']['gatewayTemplate']['path'] = capture.crm_host.PRIOR_GATEWAY_TEMPLATE
            old_routes = {url: [{'status': 200, 'tlsVerified': True, 'location': None}] for url in capture.crm_host.ROUTES}
            app_url = 'app.heili.cloud/'
            old_routes[app_url] = [
                {'status': 200, 'tlsVerified': True, 'location': None},
                {'status': 307, 'tlsVerified': True, 'location': 'https://app.heili.cloud/dashboard'},
            ]
            old_routes[app_url] = sorted(old_routes[app_url], key=lambda value: json.dumps(value, sort_keys=True))
            for index in range(2):
                path = root / f'source-{index}.json'
                record = {
                    'schemaVersion': 1, 'manifestSha256': 'd'*64,
                    'capturedAt': datetime.now(timezone.utc).isoformat(),
                    'target': {'root': str(capture.crm_host.ROOT), 'project': capture.crm_host.PROJECT, 'domain': capture.crm_host.DOMAIN},
                    **json.loads(json.dumps(old_config)), 'routes': json.loads(json.dumps(old_routes)),
                    'resources': {'memAvailableKiB': 10, 'optFreeKiB': 20},
                }
                path.write_text(json.dumps(record), encoding='utf-8')
                sources.append((path, capture.crm_host.sha(path.read_bytes()), 'd'*64))
            (evidence / 'host-readonly-snapshot.json').write_bytes(b'old')
            routes = {url: [
                {'status': 307, 'tlsVerified': True, 'location': 'https://app.heili.cloud/dashboard'}
            ] if url == app_url else old_routes[url] for url in capture.crm_host.ROUTES}
            with patch.object(capture.crm_host, 'EVIDENCE', evidence), patch.object(capture.crm_host, 'SNAPSHOT', evidence/'host-readonly-snapshot.json'), \
                 patch.object(capture.crm_host, 'ROUTE_AUDIT', evidence/'route-source-proofs.json'), \
                 patch.object(capture.crm_host, 'SOURCE_PROOFS', sources), patch.object(capture.crm_host, 'ROUTES', list(capture.crm_host.ROUTES)), \
                 patch.object(capture.crm_host, 'DOMAIN', 'bambola.heili.cloud'), patch.object(capture, 'PARENT', root/'evidence'), \
                 patch.object(capture, 'ARCHIVE', archive), patch.object(capture, 'OLD_SNAPSHOT_SHA', capture.crm_host.sha(b'old')), patch.object(capture, '_check_runtime_state'), \
                 patch.object(capture.crm_host, '_manifest_release', side_effect=lambda path, digest: Path(path)), \
                 patch.object(capture.crm_host, 'current_snapshot_metadata', side_effect=[current, current]), \
                 patch.object(capture.crm_host, 'routes_snapshot', return_value=routes), \
                 patch.object(capture.crm_host, 'resources_snapshot', return_value={'memAvailableKiB': 10, 'optFreeKiB': 20}), \
                 patch.object(capture.crm_rollout, 'OP_LOCK', root/'lock'):
                result = capture.capture_proven(release, 'c'*64)
                baseline = json.loads((evidence/'host-readonly-snapshot.json').read_text())
                audit = json.loads((evidence/'route-source-proofs.json').read_text())
            self.assertEqual(baseline['schemaVersion'], 2)
            self.assertEqual({json.dumps(v, sort_keys=True) for v in baseline['routes'][app_url]}, {json.dumps(v, sort_keys=True) for v in old_routes[app_url]})
            self.assertEqual(audit['derivedAppRoutes'], baseline['routes'][app_url])
            self.assertEqual(result['auditSha256'], capture.crm_host.sha((evidence/'route-source-proofs.json').read_bytes()))
            self.assertEqual(result['baselineSha256'], capture.crm_host.sha((evidence/'host-readonly-snapshot.json').read_bytes()))
            self.assertTrue(archive.is_dir())

    def test_unknown_fresh_route_refuses_after_archive_and_before_baseline(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); evidence,release,sources,snapshot,audit,baseline=self.reader_fixture(root)
            snapshot.write_bytes(b'old')
            old_config=json.loads(sources[0][0].read_text())
            current={key:old_config[key] for key in ('caddy','containers','ownedAppGateway','networks','configFiles')}
            current['configFiles']['compose']['path']=str(release/'deploy/marine/compose.ubuntu.yml')
            current['configFiles']['gatewayTemplate']['path']=str(release/'deploy/marine/gateway.crm.Caddyfile.template')
            routes=json.loads(json.dumps(baseline['routes']))
            routes['hair.heili.cloud/oggi']=[{'status':503,'tlsVerified':True,'location':None}]
            lock=root/'operation.lock'
            import os
            real_rename=os.rename
            def locked_rename(source, destination):
                with patch.object(capture.crm_rollout, 'OP_LOCK', lock), patch.object(capture.crm_rollout, '_prepare') as prepare_body:
                    with self.assertRaises(capture.crm_rollout.Refusal): capture.crm_rollout.prepare(release,'a'*64,'b'*64,'sha256:'+'c'*64)
                    prepare_body.assert_not_called()
                with patch.object(capture.crm_rollout, 'OP_LOCK', lock), patch.object(capture.crm_rollout, '_activate') as activate_body:
                    with self.assertRaises(capture.crm_rollout.Refusal): capture.crm_rollout.activate('a'*64,'b'*64)
                    activate_body.assert_not_called()
                with patch.object(build.crm_rollout, 'OP_LOCK', lock), patch.object(build, '_main') as build_body:
                    with self.assertRaises(build.crm_rollout.Refusal): build.main()
                    build_body.assert_not_called()
                real_rename(source, destination)
            with patch.object(capture.crm_host, 'EVIDENCE', evidence), patch.object(capture.crm_host, 'SNAPSHOT', snapshot), \
                 patch.object(capture.crm_host, 'ROUTE_AUDIT', audit), patch.object(capture.crm_host, 'SOURCE_PROOFS', sources), \
                 patch.object(capture, 'PARENT', root/'evidence'), patch.object(capture, 'ARCHIVE', root/'evidence'/'archive'), \
                 patch.object(capture, 'OLD_SNAPSHOT_SHA', capture.crm_host.sha(b'old')), patch.object(capture, '_check_runtime_state'), \
                 patch.object(capture.crm_host, '_manifest_release', side_effect=lambda path, digest: Path(path)), \
                 patch.object(capture.crm_host, 'current_snapshot_metadata', return_value=current), \
                 patch.object(capture.crm_host, 'routes_snapshot', return_value=routes), \
                 patch.object(capture.os, 'rename', side_effect=locked_rename), \
                 patch.object(capture.crm_rollout, 'OP_LOCK', lock):
                with self.assertRaises(capture.crm_host.Refusal): capture.capture_proven(release, 'c'*64)
            self.assertTrue((root/'evidence'/'archive').exists())
            self.assertFalse(evidence.exists())

    def test_schema2_rejects_allowed_plus_extra_non_app_route_outcome(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); evidence,release,sources,snapshot,audit,baseline=self.reader_fixture(root)
            audit_data=json.loads(audit.read_text())
            route='hair.heili.cloud/oggi'
            self.assertIn(route,baseline['routes'])
            audit_data['currentRoutes'][route].append({'status':503,'tlsVerified':True,'location':None})
            audit_data['currentRoutes'][route]=sorted(audit_data['currentRoutes'][route],key=lambda value:json.dumps(value,sort_keys=True))
            audit.write_bytes(capture.canonical(audit_data))
            baseline['routeEvidenceSha256']=capture.crm_host.sha(audit.read_bytes())
            snapshot.write_bytes(capture.canonical(baseline))
            host=capture.crm_host
            with patch.object(host,'EVIDENCE',evidence),patch.object(host,'SNAPSHOT',snapshot),patch.object(host,'ROUTE_AUDIT',audit), \
                 patch.object(host,'SOURCE_PROOFS',sources),patch.object(host,'_manifest_release',side_effect=lambda path,digest:Path(path)):
                with self.assertRaisesRegex(host.Refusal,'non-app route'):
                    host._snapshot_read('c'*64,host.sha(snapshot.read_bytes()))

    def test_operation_lock_refuses_all_entrypoints_at_each_capture_checkpoint(self):
        checkpoints=('after_rename','metadata_before','routes','metadata_after','evidence_mkdir','audit_write','baseline_write')
        for checkpoint in checkpoints:
          with self.subTest(checkpoint=checkpoint),tempfile.TemporaryDirectory() as td:
            root=Path(td); evidence,release,sources,snapshot,audit,baseline=self.reader_fixture(root)
            snapshot.write_bytes(b'old')
            source=json.loads(sources[0][0].read_text())
            current={key:source[key] for key in ('caddy','containers','ownedAppGateway','networks','configFiles')}
            current['configFiles']['compose']['path']=str(release/'deploy/marine/compose.ubuntu.yml')
            current['configFiles']['gatewayTemplate']['path']=str(release/'deploy/marine/gateway.crm.Caddyfile.template')
            lock=root/'operation.lock'; seen=[]; held={'inode':None}
            def contend():
                self.assertTrue(lock.exists(),checkpoint)
                self.assertEqual(lock.stat().st_ino,held['inode'],checkpoint)
                with patch.object(capture.crm_rollout,'OP_LOCK',lock),patch.object(capture.crm_rollout,'_prepare') as body:
                    with self.assertRaises(capture.crm_rollout.Refusal): capture.crm_rollout.prepare(release,'a'*64,'b'*64,'sha256:'+'c'*64)
                    body.assert_not_called()
                with patch.object(capture.crm_rollout,'OP_LOCK',lock),patch.object(capture.crm_rollout,'_activate') as body:
                    with self.assertRaises(capture.crm_rollout.Refusal): capture.crm_rollout.activate('a'*64,'b'*64)
                    body.assert_not_called()
                with patch.object(build.crm_rollout,'OP_LOCK',lock),patch.object(build,'_main') as body:
                    with self.assertRaises(capture.crm_rollout.Refusal): build.main()
                    body.assert_not_called()
                self.assertEqual(lock.stat().st_ino,held['inode'])
            original_rename=os.rename
            def renamed(src,dst):
                self.assertTrue(lock.exists())
                held['inode']=lock.stat().st_ino
                original_rename(src,dst)
                self.assertTrue(lock.exists())
                self.assertEqual(lock.stat().st_ino,held['inode'])
                if checkpoint=='after_rename':
                    contend(); seen.append('after_rename')
            original_mkdir=Path.mkdir
            def mkdir(path,*args,**kwargs):
                result=original_mkdir(path,*args,**kwargs)
                if Path(path)==evidence and checkpoint=='evidence_mkdir':
                    contend(); seen.append('evidence_mkdir')
                return result
            original_write=capture._write
            def write(path,data):
                original_write(path,data)
                if Path(path)==audit and checkpoint=='audit_write':
                    contend(); seen.append('audit_write')
                if Path(path)==snapshot and checkpoint=='baseline_write':
                    contend(); seen.append('baseline_write')
            calls={'metadata':0}
            def metadata(_):
                calls['metadata']+=1
                key='metadata_before' if calls['metadata']==1 else 'metadata_after'
                if checkpoint==key:
                    contend(); seen.append(key)
                return current
            def routes_snapshot(**kwargs):
                if checkpoint=='routes':
                    contend(); seen.append('routes')
                return baseline['routes']
            with patch.object(capture.crm_host,'EVIDENCE',evidence),patch.object(capture.crm_host,'SNAPSHOT',snapshot), \
                 patch.object(capture.crm_host,'ROUTE_AUDIT',audit),patch.object(capture.crm_host,'SOURCE_PROOFS',sources), \
                 patch.object(capture,'PARENT',root/'evidence'),patch.object(capture,'ARCHIVE',root/'evidence'/'archive'), \
                 patch.object(capture,'OLD_SNAPSHOT_SHA',capture.crm_host.sha(b'old')),patch.object(capture,'_check_runtime_state'), \
                 patch.object(capture.crm_host,'_manifest_release',side_effect=lambda path,digest:Path(path)), \
                 patch.object(capture.crm_host,'current_snapshot_metadata',side_effect=metadata), \
                 patch.object(capture.crm_host,'routes_snapshot',side_effect=routes_snapshot), \
                 patch.object(capture.crm_host,'resources_snapshot',return_value=baseline['resources']), \
                 patch.object(capture.os,'rename',side_effect=renamed),patch.object(Path,'mkdir',autospec=True,side_effect=mkdir), \
                 patch.object(capture,'_write',side_effect=write),patch.object(capture.crm_rollout,'OP_LOCK',lock):
                capture.capture_proven(release,'c'*64)
            self.assertEqual(seen,[checkpoint])
            self.assertFalse(lock.exists())

    def test_invalid_schema2_audit_stops_build_and_prepare_before_mutation(self):
        for invalid in ('missing','tampered','incomplete'):
          with self.subTest(invalid=invalid),tempfile.TemporaryDirectory() as td:
            root=Path(td); evidence,fixture_release,sources,snapshot,audit,baseline=self.reader_fixture(root)
            if invalid=='missing': audit.unlink()
            elif invalid=='tampered': audit.write_bytes(audit.read_bytes()+b' ')
            else:
                audit.write_bytes(capture.canonical({}))
                baseline['routeEvidenceSha256']=capture.crm_host.sha(audit.read_bytes())
                snapshot.write_bytes(capture.canonical(baseline))
            digest=capture.crm_host.sha(snapshot.read_bytes())
            host=capture.crm_host
            release=root/'releases'/'r1'; (release/'deploy/marine').mkdir(parents=True)
            (release/'deploy/marine/Dockerfile').write_text('FROM scratch')
            build_lock=root/'build.lock'; op_lock=root/'rollout.lock'; plan=root/'activation-plan.json'
            calls=[]
            def command_runner(args,**kwargs):
                args=list(args); calls.append(args)
                if args[0]=='docker' and args[1:3]==['buildx','create']:
                    raise AssertionError('builder must not be created before schema 2 guard rejection')
                if len(args)>1 and args[1]==str(release/'deploy/marine/manifest.py'):
                    return SimpleNamespace(returncode=0)
                if len(args)>1 and args[1]==str(release/'deploy/marine/crm_host.py'):
                    host._snapshot_read('c'*64,digest)
                return SimpleNamespace(returncode=0)
            old_argv=__import__('sys').argv
            with patch.object(host,'EVIDENCE',evidence),patch.object(host,'SNAPSHOT',snapshot),patch.object(host,'ROUTE_AUDIT',audit), \
                 patch.object(host,'SOURCE_PROOFS',sources),patch.object(host,'_manifest_release',side_effect=lambda path,sha:Path(path)), \
                 patch.object(build,'ROOT',root),patch.object(build.crm_rollout,'OP_LOCK',build_lock), \
                 patch.object(build,'run',side_effect=command_runner),patch.object(__import__('sys'),'argv',[
                    'build_crm.py','--release',str(release),'--manifest-sha256','c'*64,'--host-snapshot-sha256',digest,
                    '--node-image',build.NODE_IMAGE]):
                with self.assertRaises(host.Refusal): build.main()
            self.assertFalse(any(args[:3]==['docker','buildx','create'] for args in calls))
            with patch.object(host,'EVIDENCE',evidence),patch.object(host,'SNAPSHOT',snapshot),patch.object(host,'ROUTE_AUDIT',audit), \
                 patch.object(host,'SOURCE_PROOFS',sources),patch.object(host,'_manifest_release',side_effect=lambda path,sha:Path(path)), \
                 patch.object(capture.crm_rollout,'OP_LOCK',op_lock),patch.object(capture.crm_rollout,'PLAN',plan), \
                 patch.object(capture.crm_rollout,'safe_run',side_effect=AssertionError('prepare command ran before guard')):
                with self.assertRaises(host.Refusal): capture.crm_rollout.prepare(release,'c'*64,digest,'sha256:'+'d'*64)
            self.assertFalse(plan.exists())


if __name__ == '__main__':
    unittest.main()
