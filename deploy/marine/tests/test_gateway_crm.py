"""Static gateway boundary regression checks; not an HTTP or TLS claim."""
from pathlib import Path
import re
import unittest

TEMPLATE = Path(__file__).resolve().parents[1] / 'gateway.crm.Caddyfile.template'
TEXT = TEMPLATE.read_text(encoding='utf-8')


def crm_rule(method, path):
    for name, body in re.findall(r'^\s*@(provider_\w+|crm_\w+)\s*\{([^}]+)\}', TEXT, re.M):
        verb = re.search(r'method\s+(\w+)', body).group(1)
        expression = re.search(r'path_regexp\s+\w+\s+(\S+)', body).group(1)
        if method == verb and re.fullmatch(expression, path):
            return 503 if name.startswith('provider_') else 200
    return 404


class GatewayBoundaryTests(unittest.TestCase):
    def test_crew_data_paths_preserved_explicitly(self):
        self.assertRegex(TEXT, r'@marine\s*\{\s*path /api/marine /api/public/marine\s*method GET POST\s*\}')

    def test_crm_reads_allowed_and_provider_effects_disabled(self):
        for path in ['/api/contacts', '/api/conversations/test/messages', '/api/settings/whatsapp', '/api/events', '/api/settings/team']:
            with self.subTest(path=path):
                self.assertEqual(crm_rule('GET', path), 200)
        for method, path in [('POST','/api/contacts/test/start-conversation'),('POST','/api/conversations/test/messages'),('POST','/api/templates/sync'),('POST','/api/lab/runs'),('PUT','/api/settings/whatsapp'),('POST','/api/settings/whatsapp/embedded-signup'),('DELETE','/api/settings/whatsapp/wapi-key')]:
            with self.subTest(path=path):
                self.assertEqual(crm_rule(method,path),503)

    def test_unknown_paths_and_methods_fail_closed(self):
        for method,path in [('GET','/api/contacts/x/anything'),('POST','/api/events'),('GET','/api/settings/team/extra'),('GET','/api/export/contacts'),('POST','/api/auth/sign-up/email'),('GET','/api/dev/wa-mock/outbox'),('GET','/api/admin/orgs'),('GET','/api/media/a/b'),('GET','/_next/image'),('PUT','/api/settings/branding/favicon')]:
            with self.subTest(path=path,method=method):
                self.assertEqual(crm_rule(method,path),404)

    def test_trust_body_auth_and_default_deny_preserved(self):
        self.assertIn('not remote_ip __SHARED_IPV4__/32',TEXT)
        self.assertLess(TEXT.index('respond @not_shared_caddy 403'),TEXT.index('handle @crm_get'))
        self.assertIn('max_size 32KB',TEXT)
        self.assertIn('request_header -Forwarded',TEXT)
        self.assertIn('Referrer-Policy "no-referrer"',TEXT)
        self.assertIn('redir @root_get /dashboard 302',TEXT)
        self.assertNotIn('/api/auth/*',TEXT)
        self.assertNotIn('path /api/*',TEXT)
        self.assertIn('respond 404\n}',TEXT)
        self.assertLess(TEXT.index('handle @provider_post'),TEXT.index('handle @crm_post'))


if __name__ == '__main__':
    unittest.main()
