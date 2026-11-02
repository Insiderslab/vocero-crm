import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HOST = Path(__file__).parents[1] / 'host.py'
spec = importlib.util.spec_from_file_location('marine_host', HOST)
host = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host)
BUILD = Path(__file__).parents[1] / 'build.py'
build_spec = importlib.util.spec_from_file_location('marine_build', BUILD)
build = importlib.util.module_from_spec(build_spec)
build_spec.loader.exec_module(build)

class HostContractTests(unittest.TestCase):
    def baseline_state(self):
        routes = {url: {'status': 200, 'location': None, 'ok': True} for url in host.ROUTES}
        routes['app.heili.cloud/'] = {'status': 200, 'location': None, 'ok': True}
        return {'containers': [], 'routes': routes,
                'app_pairs': [routes['app.heili.cloud/'],
                              {'status': 307, 'location': '/login', 'ok': True}]}

    def test_observed_app_alternation_passes_but_new_pair_fails(self):
        state = self.baseline_state()
        routes = dict(state['routes'])
        routes['app.heili.cloud/'] = state['app_pairs'][1]
        with patch.object(host, 'containers_snapshot', return_value=[]), \
             patch.object(host, 'routes_snapshot', return_value=routes), \
             patch.object(host, 'EVIDENCE', Path(tempfile.mkdtemp())):
            host.verify_invariants(state, 'alternating')
        routes['app.heili.cloud/'] = {'status': 302, 'location': '/login', 'ok': True}
        with patch.object(host, 'containers_snapshot', return_value=[]), \
             patch.object(host, 'routes_snapshot', return_value=routes), \
             patch.object(host, 'EVIDENCE', Path(tempfile.mkdtemp())):
            with self.assertRaisesRegex(RuntimeError, 'outside recorded preflight'):
                host.verify_invariants(state, 'unseen-pair')

    def test_route_status_location_and_tls_are_strict(self):
        state = self.baseline_state()
        routes = dict(state['routes'])
        routes['hair.heili.cloud/oggi'] = {'status': 302, 'location': '/x', 'ok': True}
        with patch.object(host, 'containers_snapshot', return_value=[]), \
             patch.object(host, 'routes_snapshot', return_value=routes):
            with self.assertRaisesRegex(RuntimeError, 'hair.heili.cloud'):
                host.verify_invariants(state, 'changed-route')
        routes['hair.heili.cloud/oggi'] = {'status': 200, 'location': None, 'ok': False}
        with patch.object(host, 'containers_snapshot', return_value=[]), \
             patch.object(host, 'routes_snapshot', return_value=routes):
            with self.assertRaisesRegex(RuntimeError, 'TLS or network'):
                host.verify_invariants(state, 'failed-tls')

    def test_container_change_stops_before_route_probes(self):
        with patch.object(host, 'containers_snapshot', return_value=[{'id': 'changed'}]), \
             patch.object(host, 'routes_snapshot') as probes:
            with self.assertRaisesRegex(RuntimeError, 'container state changed'):
                host.verify_invariants(self.baseline_state(), 'container-change')
            probes.assert_not_called()

    def test_append_preserves_original_bytes_and_one_new_route(self):
        original = b'{env}\nsite old.example { respond 200 }\n'
        block = b'bambola.heili.cloud { respond 503 }\n'
        result = original + b'\n\n' + block.rstrip() + b'\n'
        self.assertTrue(result.startswith(original + b'\n\n'))
        self.assertEqual(result.count(b'bambola.heili.cloud'), 1)

    def test_cas_hashes_differ_after_concurrent_edit(self):
        self.assertNotEqual(host.sha(b'approved config'), host.sha(b'operator edit'))

    def test_mutate_rechecks_cas_after_route_probes(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / 'evidence'
            evidence.mkdir()
            original = b'baseline bytes\n'
            candidate = original + b'\n\nbambola.heili.cloud { reverse_proxy gateway:8080 }\n'
            (evidence / 'Caddyfile.before').write_bytes(original)
            (evidence / 'Caddyfile.active').write_bytes(candidate)
            target = Path(directory) / 'Caddyfile'
            target.write_bytes(original)
            state = {'base_hash': host.sha(original), 'active_hash': host.sha(candidate),
                     'inode': target.stat().st_ino, 'expected_hash': host.sha(original),
                     'containers': [], 'routes': {}, 'app_pairs': []}

            def external_edit(*_args):
                target.write_bytes(b'concurrent operator edit')

            with patch.object(host, 'EVIDENCE', evidence), patch.object(host, 'CADDYFILE', target), \
                 patch.object(host, 'read_state', return_value=state), patch.object(host, 'preserve_maintenance', return_value=False), \
                 patch.object(host, 'verify_invariants', side_effect=external_edit):
                with self.assertRaisesRegex(RuntimeError, 'Concurrent Caddy edit'):
                    host.mutate('active', 'active')
            self.assertEqual(target.read_bytes(), b'concurrent operator edit')

    def test_tampered_maintenance_fallback_blocks_mutation(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / 'evidence'
            evidence.mkdir()
            original = b'baseline bytes\n'
            active = original + b'\n\nbambola.heili.cloud { reverse_proxy gateway:8080 }\n'
            (evidence / 'Caddyfile.before').write_bytes(original)
            (evidence / 'Caddyfile.active').write_bytes(active)
            (evidence / 'Caddyfile.maintenance').write_bytes(b'tampered')
            target = Path(directory) / 'Caddyfile'
            target.write_bytes(original)
            state = {'base_hash': host.sha(original), 'active_hash': host.sha(active),
                     'maintenance_hash': host.sha(original + b'\n\nbambola.heili.cloud { respond 503 }\n'),
                     'inode': target.stat().st_ino, 'expected_hash': host.sha(original)}
            with patch.object(host, 'EVIDENCE', evidence), patch.object(host, 'CADDYFILE', target), \
                 patch.object(host, 'read_state', return_value=state), patch.object(host, 'preserve_maintenance', return_value=True):
                with self.assertRaisesRegex(RuntimeError, 'maintenance candidate failed integrity'):
                    host.mutate('active', 'active')
            self.assertEqual(target.read_bytes(), original)

    def test_container_snapshot_parses_line_separated_ids(self):
        ids = 'container-a\ncontainer-b\n'
        inspected = [
            {'Name': '/service-a', 'Id': 'a', 'State': {'StartedAt': 't1', 'Running': True}, 'RestartCount': 0},
            {'Name': '/service-b', 'Id': 'b', 'State': {'StartedAt': 't2', 'Running': True}, 'RestartCount': 1},
        ]
        with patch.object(host, 'run', side_effect=[ids, __import__('json').dumps(inspected)]):
            result = host.containers_snapshot()
        self.assertEqual([item['id'] for item in result], ['a', 'b'])

    def test_post_dns_rollback_selects_maintenance_only(self):
        with patch.object(host, 'read_state', return_value={'phase': 'active', 'dns_intent': True}), \
             patch.object(host, 'preserve_maintenance', return_value=True), \
             patch.object(host, 'mutate') as mutate, \
             patch('sys.argv', ['host.py', 'rollback']):
            host.main()
        mutate.assert_called_once_with('maintenance', 'maintenance')

    def dns_marker(self, base_hash):
        return {
            'version': 1, 'domain': 'bambola.heili.cloud', 'zone': 'heili.cloud',
            'name': 'bambola', 'type': 'A', 'address': '186.241.16.46', 'ttl': 300,
            'before_other_rrsets_sha256': 'a' * 64,
            'after_other_rrsets_sha256': 'a' * 64,
            'manifest_sha256': 'b' * 64, 'state_base_hash': base_hash,
            'captured_at_iso': '2026-11-02T10:00:00+00:00',
        }

    def test_dns_marker_requires_exact_private_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            marker_path = evidence / 'dns-added.json'
            state = {'manifest_sha256': 'b' * 64, 'base_hash': 'c' * 64}
            valid = self.dns_marker(state['base_hash'])
            marker_path.write_text(json.dumps(valid), encoding='utf-8')
            marker_path.chmod(0o600)
            with patch.object(host, 'EVIDENCE', evidence), patch.object(host.stat, 'S_IMODE', return_value=0o600):
                self.assertEqual(host.require_dns_marker(state), valid)
                marker_path.write_text('', encoding='utf-8')
                marker_path.chmod(0o600)
                with self.assertRaisesRegex(host.Refusal, 'schema is invalid'):
                    host.require_dns_marker(state)
                mismatched = self.dns_marker(state['base_hash'])
                mismatched['address'] = '192.0.2.1'
                marker_path.write_text(json.dumps(mismatched), encoding='utf-8')
                marker_path.chmod(0o600)
                with self.assertRaisesRegex(host.Refusal, 'does not match'):
                    host.require_dns_marker(state)
                marker_path.unlink()
                with self.assertRaisesRegex(host.Refusal, 'missing'):
                    host.require_dns_marker(state)
                fake_path = unittest.mock.Mock()
                fake_path.is_symlink.return_value = True
                with patch.object(host, 'dns_marker_path', return_value=fake_path):
                    with self.assertRaisesRegex(host.Refusal, 'must not be a symlink'):
                        host.require_dns_marker(state)

    def test_activate_refuses_missing_malformed_or_mismatched_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            state = {'dns_intent': True, 'phase': 'maintenance', 'manifest_sha256': 'b' * 64,
                     'base_hash': 'c' * 64}
            marker_path = evidence / 'dns-added.json'
            cases = [None, '', json.dumps({**self.dns_marker(state['base_hash']), 'address': '192.0.2.1'})]
            for content in cases:
                marker_path.unlink(missing_ok=True)
                if content is not None:
                    marker_path.write_text(content, encoding='utf-8')
                    marker_path.chmod(0o600)
                with patch.object(host, 'EVIDENCE', evidence), \
                     patch.object(host, 'read_state', return_value=state), \
                     patch('sys.argv', ['host.py', 'activate']):
                    with self.assertRaises(host.Refusal):
                        host.main()

    def test_deleted_marker_after_dns_intent_keeps_rollback_on_maintenance(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            (evidence / 'dns-added.json').unlink(missing_ok=True)
            state = {'dns_intent': True, 'phase': 'active'}
            with patch.object(host, 'EVIDENCE', evidence), \
                 patch.object(host, 'read_state', return_value=state), \
                 patch.object(host, 'mutate') as mutate, \
                 patch('sys.argv', ['host.py', 'rollback']):
                host.main()
            mutate.assert_called_once_with('maintenance', 'maintenance')

    def test_any_marker_presence_keeps_rollback_on_maintenance(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory)
            (evidence / 'dns-added.json').write_text('', encoding='utf-8')
            state = {'dns_intent': False, 'phase': 'active'}
            with patch.object(host, 'EVIDENCE', evidence), \
                 patch.object(host, 'read_state', return_value=state), \
                 patch.object(host, 'mutate') as mutate, \
                 patch.object(host, 'save_state') as save, \
                 patch('sys.argv', ['host.py', 'rollback']):
                host.main()
            mutate.assert_called_once_with('maintenance', 'maintenance')
            self.assertTrue(state['dns_intent'])
            save.assert_called_once_with(state)

    def test_activation_refuses_symlinked_dns_marker(self):
        state = {'dns_intent': True, 'phase': 'maintenance', 'manifest_sha256': 'b' * 64,
                 'base_hash': 'c' * 64}
        fake_path = unittest.mock.Mock()
        fake_path.is_symlink.return_value = True
        with patch.object(host, 'dns_marker_path', return_value=fake_path), \
             patch.object(host, 'read_state', return_value=state), \
             patch('sys.argv', ['host.py', 'activate']):
            with self.assertRaisesRegex(host.Refusal, 'must not be a symlink'):
                host.main()

    def test_dns_intent_requires_live_maintenance_candidate(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / 'evidence'
            evidence.mkdir()
            original = b'baseline\n'
            candidate = original + b'\n\nbambola.heili.cloud { respond 503 }\n'
            (evidence / 'Caddyfile.before').write_bytes(original)
            (evidence / 'Caddyfile.maintenance').write_bytes(candidate)
            target = Path(directory) / 'Caddyfile'
            target.write_bytes(candidate)
            state = {'phase': 'maintenance', 'dns_intent': False,
                     'maintenance_hash': host.sha(candidate), 'base_hash': host.sha(original),
                     'expected_hash': host.sha(candidate), 'inode': target.stat().st_ino}
            with patch.object(host, 'EVIDENCE', evidence), patch.object(host, 'CADDYFILE', target), \
                 patch.object(host, 'read_state', return_value=state), patch.object(host, 'save_state') as save:
                host.record_dns_intent()
            self.assertTrue(state['dns_intent'])
            save.assert_called_once_with(state)

    def test_saved_dns_intent_cannot_be_cleared(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'state.json'
            target.write_text(json.dumps({'dns_intent': True}), encoding='utf-8')
            target.chmod(0o600)
            with patch.object(host, 'state_path', return_value=target):
                with self.assertRaisesRegex(host.Refusal, 'cannot be cleared'):
                    host.save_state({'dns_intent': False})

    def test_build_image_identity_is_bound_to_manifest(self):
        digest = 'a' * 64
        other_digest = 'd' * 64
        image_id = 'sha256:' + 'c' * 64
        self.assertEqual(build.parse_image_identity(f'{image_id} {digest}', digest),
                         (image_id, digest, True))
        self.assertEqual(build.parse_image_identity(f'{image_id} {other_digest}', digest),
                         (image_id, other_digest, False))

if __name__ == '__main__':
    unittest.main()
