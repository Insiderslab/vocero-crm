import importlib.util
import hashlib
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

SOURCE = Path(__file__).parents[1] / 'crm_host.py'
spec = importlib.util.spec_from_file_location('crm_host', SOURCE)
crm_host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(crm_host)


class CrmHostGuardTests(unittest.TestCase):
    def setUp(self):
        self.digest = 'a' * 64
        self.route = {'status': 200, 'tlsVerified': True, 'location': None}
        self.record = {
            'schemaVersion': 1,
            'manifestSha256': self.digest,
            'capturedAt': datetime.now(timezone.utc).isoformat(),
            'target': {'root': str(crm_host.ROOT), 'project': crm_host.PROJECT, 'domain': crm_host.DOMAIN},
            'caddy': {'container': {'id': 'caddy-id'}, 'config': {'inode': 42, 'sha256': 'b' * 64}},
            'containers': [
                {'name': 'second-brain-caddy-1', 'id': 'caddy-id', 'imageId': 'sha256:c'},
                {'name': 'hair-app-1', 'id': 'hair-id', 'imageId': 'sha256:h', 'restartCount': 0, 'health': 'healthy'},
                {'name': crm_host.APP_NAME, 'id': 'app-id', 'imageId': 'sha256:a'},
                {'name': crm_host.GATEWAY_NAME, 'id': 'gateway-id', 'imageId': 'sha256:g'},
            ],
            'ownedAppGateway': {'app': {'id': 'app-id'}, 'gateway': {'id': 'gateway-id'}},
            'networks': [{'id': 'network-id', 'name': 'edge', 'containers': {}}],
            'routes': {url: [self.route] for url in crm_host.ROUTES},
            'configFiles': {
                'compose': {'path': str(crm_host.RELEASES / 'r1' / 'deploy/marine/compose.ubuntu.yml'), 'sha256': 'd' * 64},
                'pinnedBaseCompose': {'path': str(crm_host.RELEASES / '20261102-r5/deploy/marine/compose.ubuntu.yml'), 'sha256': 'e' * 64},
                'runtimeEnv': {'path': str(crm_host.ROOT / 'runtime/runtime.env'), 'sha256': 'f' * 64},
            },
            'resources': {'memAvailableKiB': 1000000, 'optFreeKiB': 1000000},
        }

    def current(self):
        import copy
        result = copy.deepcopy(self.record)
        return {key: result[key] for key in ('caddy', 'containers', 'ownedAppGateway', 'networks', 'routes', 'configFiles', 'resources')}

    def test_same_host_snapshot_passes(self):
        crm_host.verify_snapshot_state(self.record, self.current())

    def test_manifest_schema_target_and_timestamp_are_checked(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / 'crm-recovery'
            evidence.mkdir(mode=0o700)
            snapshot = evidence / 'host-readonly-snapshot.json'
            with patch.object(crm_host, 'EVIDENCE', evidence), patch.object(crm_host, 'SNAPSHOT', snapshot):
                snapshot.write_text(json.dumps(self.record), encoding='utf-8')
                snapshot.chmod(0o600)
                pinned = hashlib.sha256(snapshot.read_bytes()).hexdigest()
                self.assertEqual(crm_host._snapshot_read(self.digest, pinned)['manifestSha256'], self.digest)
                with self.assertRaisesRegex(crm_host.Refusal, 'manifest'):
                    crm_host._snapshot_read('f' * 64, pinned)
                invalid = dict(self.record, schemaVersion=99)
                snapshot.write_text(json.dumps(invalid), encoding='utf-8')
                snapshot.chmod(0o600)
                with self.assertRaisesRegex(crm_host.Refusal, 'schema'):
                    crm_host._snapshot_read(self.digest, hashlib.sha256(snapshot.read_bytes()).hexdigest())
                invalid = dict(self.record, target={'root': '/wrong', 'project': crm_host.PROJECT, 'domain': crm_host.DOMAIN})
                snapshot.write_text(json.dumps(invalid), encoding='utf-8')
                snapshot.chmod(0o600)
                with self.assertRaisesRegex(crm_host.Refusal, 'target'):
                    crm_host._snapshot_read(self.digest, hashlib.sha256(snapshot.read_bytes()).hexdigest())

    def test_baseline_is_exclusive_and_private(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            releases = root / 'releases'
            release = releases / 'r1'
            (release / 'deploy/marine').mkdir(parents=True)
            (release / 'deploy/marine/manifest.py').write_text('# test verifier', encoding='utf-8')
            evidence = root / 'evidence' / 'crm-recovery'
            snapshot = evidence / 'host-readonly-snapshot.json'
            fields = {key: self.record[key] for key in ('caddy', 'containers', 'ownedAppGateway', 'networks', 'configFiles')}
            with patch.object(crm_host, 'ROOT', root), patch.object(crm_host, 'RELEASES', releases), \
                 patch.object(crm_host, 'EVIDENCE', evidence), patch.object(crm_host, 'SNAPSHOT', snapshot), \
                 patch.object(crm_host, 'command', return_value='verified'), \
                 patch.object(crm_host, 'current_snapshot_metadata', return_value=fields), \
                 patch.object(crm_host, 'routes_snapshot', return_value=self.record['routes']) as capture_routes, \
                 patch.object(crm_host, 'resources_snapshot', return_value=self.record['resources']):
                crm_host.capture_baseline(release, self.digest)
                capture_routes.assert_called_once_with(120, 5)
                record = json.loads(snapshot.read_text(encoding='utf-8'))
                self.assertEqual(set(record), set(self.record))
                self.assertEqual(record['routes'], self.record['routes'])
                if crm_host.os.name == 'posix':
                    self.assertEqual(snapshot.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(evidence.stat().st_mode & 0o777, 0o700)
                with self.assertRaisesRegex(crm_host.Refusal, 'already exists'):
                    crm_host.capture_baseline(release, self.digest)

    def test_baseline_refuses_nonpositive_resource_values_before_evidence_creation(self):
        for key in ('memAvailableKiB', 'optFreeKiB'):
            with self.subTest(key=key), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                release = root / 'releases' / 'r1'
                (release / 'deploy/marine').mkdir(parents=True)
                (release / 'deploy/marine/manifest.py').write_text('# test verifier', encoding='utf-8')
                evidence = root / 'evidence' / 'crm-recovery'
                snapshot = evidence / 'host-readonly-snapshot.json'
                metadata = {field: self.record[field] for field in ('caddy', 'containers', 'ownedAppGateway', 'networks', 'configFiles')}
                resources = dict(self.record['resources'], **{key: 0})
                with patch.object(crm_host, 'ROOT', root), patch.object(crm_host, 'RELEASES', root / 'releases'), \
                     patch.object(crm_host, 'EVIDENCE', evidence), patch.object(crm_host, 'SNAPSHOT', snapshot), \
                     patch.object(crm_host, 'command', return_value='verified'), \
                     patch.object(crm_host, 'current_snapshot_metadata', return_value=metadata), \
                     patch.object(crm_host, 'routes_snapshot', return_value=self.record['routes']), \
                     patch.object(crm_host, 'resources_snapshot', return_value=resources):
                    with self.assertRaisesRegex(crm_host.Refusal, 'resource availability'):
                        crm_host.capture_baseline(release, self.digest)
                self.assertFalse(evidence.exists())

    def test_metadata_drift_in_each_group_aborts_before_snapshot_creation(self):
        groups = ('caddy', 'containers', 'ownedAppGateway', 'networks', 'configFiles')
        for group in groups:
            with self.subTest(group=group), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                release = root / 'releases' / 'r1'
                (release / 'deploy/marine').mkdir(parents=True)
                (release / 'deploy/marine/manifest.py').write_text('# test verifier', encoding='utf-8')
                evidence = root / 'evidence' / 'crm-recovery'
                snapshot = evidence / 'host-readonly-snapshot.json'
                baseline = {key: self.record[key] for key in groups}
                changed = json.loads(json.dumps(baseline))
                changed[group] = {'changed': True}
                with patch.object(crm_host, 'ROOT', root), patch.object(crm_host, 'RELEASES', root / 'releases'), \
                     patch.object(crm_host, 'EVIDENCE', evidence), patch.object(crm_host, 'SNAPSHOT', snapshot), \
                     patch.object(crm_host, 'command', return_value='verified'), \
                     patch.object(crm_host, 'current_snapshot_metadata', side_effect=[baseline, changed]), \
                     patch.object(crm_host, 'routes_snapshot', return_value=self.record['routes']):
                    with self.assertRaisesRegex(crm_host.Refusal, 'metadata changed'):
                        crm_host.capture_baseline(release, self.digest)
                self.assertFalse(evidence.exists())

    def test_safe_file_hashes_pin_only_bambola_runtime_env_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            release = root / 'releases' / 'candidate'
            paths = {
                'compose': release / 'deploy/marine/compose.ubuntu.yml',
                'gatewayTemplate': release / 'deploy/marine/gateway.crm.Caddyfile.template',
                'runtimeGateway': root / 'runtime/gateway.Caddyfile',
                'runtimeOverride': root / 'runtime/panels-20261102.override.yml',
                'pinnedBaseCompose': root / 'releases/20261102-r5/deploy/marine/compose.ubuntu.yml',
                'runtimeEnv': root / 'runtime/runtime.env',
            }
            for path in paths.values():
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text('sensitive-but-hashed', encoding='utf-8')
            with patch.object(crm_host, 'ROOT', root), patch.object(crm_host, 'RELEASES', root / 'releases'):
                hashes = crm_host.safe_file_hashes(release)
            self.assertEqual(hashes['runtimeEnv']['path'], str(paths['runtimeEnv']))
            self.assertEqual(hashes['runtimeEnv']['sha256'], hashlib.sha256(b'sensitive-but-hashed').hexdigest())

    def test_snapshot_writer_uses_exclusive_create_without_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            snapshot = evidence / 'host-readonly-snapshot.json'
            with patch.object(crm_host, 'SNAPSHOT', snapshot):
                crm_host._write_snapshot_exclusive(b'first')
                with self.assertRaises(FileExistsError):
                    crm_host._write_snapshot_exclusive(b'second')
            self.assertEqual(snapshot.read_bytes(), b'first')

    def test_container_inspection_whitelists_fields_and_ignores_only_owned_builder(self):
        line = '\t'.join([
            json.dumps('/' + crm_host.BUILDER_NAME), json.dumps('builder-id'), json.dumps('sha256:b'),
            json.dumps('builder:image'), json.dumps('time'), json.dumps(0), json.dumps(True), json.dumps(None),
            json.dumps({}), json.dumps({}), json.dumps([]), json.dumps(True), json.dumps(['ALL']),
            json.dumps([]), json.dumps([]), json.dumps(1024), json.dumps(100000000), json.dumps(64),
            json.dumps(100000), json.dumps(100000), json.dumps(False), json.dumps('unless-stopped'), json.dumps(''),
        ])
        with patch.object(crm_host, 'command', side_effect=['builder-id\n', line]) as run:
            self.assertEqual(crm_host.containers_snapshot(), [])
        self.assertEqual(run.call_args_list[1].args[0][2], '--format')
        template = run.call_args_list[1].args[0][3]
        self.assertNotIn('Env', template)
        self.assertIn('with index .State "Health"', template)
        self.assertIn('.Mounts', template)

    def test_stopped_builder_without_health_metadata_is_valid(self):
        line = '\t'.join([
            json.dumps('/stopped-service'), json.dumps('id'), json.dumps('sha256:i'), json.dumps('image'),
            json.dumps('time'), json.dumps(0), json.dumps(False), 'null', json.dumps({}), json.dumps({}),
            json.dumps([]), json.dumps(True), json.dumps([]), json.dumps([]), json.dumps([]), json.dumps(1),
            json.dumps(1), json.dumps(1), json.dumps(1), json.dumps(1), json.dumps(False), json.dumps('no'), json.dumps(''),
        ])
        with patch.object(crm_host, 'command', side_effect=['id\n', line]):
            self.assertIsNone(crm_host.containers_snapshot()[0]['health'])

    def assert_changed(self, mutate, message):
        current = self.current()
        mutate(current)
        with self.assertRaisesRegex(crm_host.Refusal, message):
            crm_host.verify_snapshot_state(self.record, current)

    def test_changed_shared_caddy_hash_or_inode_aborts(self):
        self.assert_changed(lambda c: c['caddy']['config'].__setitem__('sha256', 'f' * 64), 'Caddy')
        self.assert_changed(lambda c: c['caddy']['config'].__setitem__('inode', 99), 'Caddy')

    def test_changed_hair_identity_health_container_set_or_port_aborts(self):
        self.assert_changed(lambda c: c['containers'][1].__setitem__('id', 'changed'), 'container')
        self.assert_changed(lambda c: c['containers'][1].__setitem__('health', 'unhealthy'), 'container')
        self.assert_changed(lambda c: c['containers'][1].__setitem__('ports', {'443/tcp': [{'hostPort': '9443'}]}), 'container')
        self.assert_changed(lambda c: c['containers'].append({'name': 'new-service'}), 'container')

    def test_changed_network_or_bambola_service_during_build_aborts(self):
        self.assert_changed(lambda c: c['networks'][0].__setitem__('id', 'changed-network'), 'network')
        self.assert_changed(lambda c: c['ownedAppGateway']['app'].__setitem__('id', 'new-app'), 'container')

    def test_untrusted_tls_or_route_status_aborts(self):
        self.assert_changed(lambda c: c['routes'][crm_host.ROUTES[0]].__setitem__(0, {'status': 200, 'tlsVerified': False}), 'route')
        self.assert_changed(lambda c: c['routes'][crm_host.ROUTES[0]].__setitem__(0, {'status': 503, 'tlsVerified': True}), 'route')
        self.assert_changed(lambda c: c['routes'][crm_host.ROUTES[0]].append({'status': 418, 'tlsVerified': True, 'location': None}), 'route')
        self.assert_changed(lambda c: c['routes'][crm_host.ROUTES[0]].append({'status': 307, 'tlsVerified': True, 'location': 'https://elsewhere.test/'}), 'route')

    def test_runtime_check_requests_one_route_round_without_sleep(self):
        with patch.object(crm_host, '_snapshot_read', return_value=self.record), \
             patch.object(crm_host, '_manifest_release', return_value=Path('/release')), \
             patch.object(crm_host, 'current_snapshot_fields', return_value=self.current()) as capture, \
             patch.object(crm_host, 'verify_snapshot_state'):
            crm_host.check_current(self.digest, 'b' * 64)
        capture.assert_called_once_with(Path('/release'), route_samples=1)

    def test_baseline_sampling_uses_five_second_spacing(self):
        class Pool:
            def __init__(self, **kwargs):
                self.max_workers = kwargs['max_workers']

            def __enter__(self):
                return self

            def __exit__(self, *args):
                return False

            def map(self, fn, urls):
                return [fn(url) for url in urls]

        with patch.object(crm_host, 'ROUTES', ['example.test/']), \
             patch.object(crm_host, 'ThreadPoolExecutor', Pool), \
             patch.object(crm_host, 'route_probe', return_value=self.route), \
             patch.object(crm_host.time, 'sleep') as sleep:
            observed = crm_host.routes_snapshot(3, 5)
        self.assertEqual(observed, {'example.test/': [self.route]})
        self.assertEqual([call.args[0] for call in sleep.call_args_list], [5, 5])


if __name__ == '__main__':
    unittest.main()
