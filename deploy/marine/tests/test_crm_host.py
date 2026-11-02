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
        self.route = {'status': 200, 'tlsVerified': True}
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
            'configFiles': {'compose': {'path': str(crm_host.RELEASES / 'r1' / 'deploy/marine/compose.ubuntu.yml'), 'sha256': 'd' * 64}},
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
            fields = {key: self.record[key] for key in ('caddy', 'containers', 'ownedAppGateway', 'networks', 'routes', 'configFiles', 'resources')}
            with patch.object(crm_host, 'ROOT', root), patch.object(crm_host, 'RELEASES', releases), \
                 patch.object(crm_host, 'EVIDENCE', evidence), patch.object(crm_host, 'SNAPSHOT', snapshot), \
                 patch.object(crm_host, 'command', return_value='verified'), \
                 patch.object(crm_host, 'current_snapshot_fields', return_value=fields):
                crm_host.capture_baseline(release, self.digest)
                if crm_host.os.name == 'posix':
                    self.assertEqual(snapshot.stat().st_mode & 0o777, 0o600)
                    self.assertEqual(evidence.stat().st_mode & 0o777, 0o700)
                with self.assertRaisesRegex(crm_host.Refusal, 'already exists'):
                    crm_host.capture_baseline(release, self.digest)

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
            json.dumps({}), json.dumps({}),
        ])
        with patch.object(crm_host, 'command', side_effect=['builder-id\n', line]) as run:
            self.assertEqual(crm_host.containers_snapshot(), [])
        self.assertEqual(run.call_args_list[1].args[0][2], '--format')
        self.assertNotIn('Env', run.call_args_list[1].args[0][3])

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


if __name__ == '__main__':
    unittest.main()
