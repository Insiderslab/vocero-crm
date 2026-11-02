import importlib.util
import hashlib
import json
import os
import re
import stat
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("marine_runtime", HERE / "runtime.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)
backup_spec = importlib.util.spec_from_file_location("marine_backup", HERE / "backup.py")
backup = importlib.util.module_from_spec(backup_spec)
backup_spec.loader.exec_module(backup)
tenant_spec = importlib.util.spec_from_file_location("marine_tenant_proof", HERE / "tenant_proof.py")
tenant_proof = importlib.util.module_from_spec(tenant_spec)
tenant_spec.loader.exec_module(tenant_proof)
bootstrap_spec = importlib.util.spec_from_file_location("marine_bootstrap", HERE / "bootstrap.py")
bootstrap = importlib.util.module_from_spec(bootstrap_spec)
bootstrap_spec.loader.exec_module(bootstrap)
isolation_spec = importlib.util.spec_from_file_location("marine_isolation", HERE / "tests" / "isolation.py")
isolation = importlib.util.module_from_spec(isolation_spec)
isolation_spec.loader.exec_module(isolation)


class RuntimeTests(unittest.TestCase):
    def test_fresh_runtime_is_private_and_contains_only_synthetic_accounts(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "runtime"
            app_id, manifest = "sha256:" + "d" * 64, "e" * 64
            files = runtime.create(target, "172.29.0.4", "sha256:" + "a" * 64, "sha256:" + "b" * 64, app_id, manifest, inspect_image=lambda image: f"{app_id} {manifest}", allow_non_posix_for_test=True)
            self.assertEqual(set(files), {"runtime.env", "gateway.Caddyfile", "accounts.json"})
            if os.name == "posix":
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o700)
                self.assertEqual(stat.S_IMODE((target / "runtime.env").stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE((target / "accounts.json").stat().st_mode), 0o600)
                self.assertEqual(stat.S_IMODE((target / "gateway.Caddyfile").stat().st_mode), 0o444)
            env = (target / "runtime.env").read_text()
            for required in ("ALLOW_SIGNUP=false", "MARINE_TRUST_PROXY_IP=true", "APP_BASE_URL=https://bambola.heili.cloud", f"BAMBOLA_APP_IMAGE={app_id}", f"BAMBOLA_SOURCE_MANIFEST_SHA256={manifest}"):
                self.assertIn(required, env)
            for forbidden in ("OPENROUTER", "META_APP_SECRET", "WA_MOCK", "SUPERADMIN", "WAPI_"):
                self.assertNotIn(forbidden, env)
            accounts = json.loads((target / "accounts.json").read_text())["accounts"]
            self.assertEqual([a["role"] for a in accounts], ["owner", "admin", "crew1", "crew2", "crew3"])
            self.assertTrue(all(a["email"].endswith("@example.invalid") and "PRUEBA" in a["name"] for a in accounts))
            self.assertEqual(len({a["password"] for a in accounts}), 5)
            with self.assertRaises(FileExistsError):
                runtime.create(target, "172.29.0.4", "sha256:" + "a" * 64, "sha256:" + "b" * 64, app_id, manifest, inspect_image=lambda image: f"{app_id} {manifest}", allow_non_posix_for_test=True)

    def test_rejects_invalid_peer_or_mutable_image_without_creating_target(self):
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "runtime"
            app_id, manifest = "sha256:" + "d" * 64, "e" * 64
            with self.assertRaises(ValueError):
                runtime.create(target, "172.29.0.4/24", "sha256:" + "a" * 64, "sha256:" + "b" * 64, app_id, manifest, inspect_image=lambda image: f"{app_id} {manifest}", allow_non_posix_for_test=True)
            with self.assertRaises(ValueError):
                runtime.create(target, "172.29.0.4", "caddy:latest", "sha256:" + "b" * 64, app_id, manifest, inspect_image=lambda image: f"{app_id} {manifest}", allow_non_posix_for_test=True)
            self.assertFalse(target.exists())

    def test_runtime_refuses_mismatched_image_id_or_manifest_label(self):
        image_id, manifest = "sha256:" + "d" * 64, "e" * 64
        with self.assertRaises(ValueError):
            runtime.verify_app_image(image_id, manifest, inspect=lambda image: "sha256:" + "f" * 64 + " " + manifest)
        with self.assertRaises(ValueError):
            runtime.verify_app_image(image_id, manifest, inspect=lambda image: image_id + " " + "f" * 64)

    def test_default_app_image_inspector_uses_docker_and_checks_manifest_label(self):
        image_id, manifest = "sha256:" + "d" * 64, "e" * 64
        expected_command = ["docker", "image", "inspect", "--format", '{{.Id}} {{index .Config.Labels "heili.source-manifest"}}', image_id]
        with patch.object(runtime.subprocess, "run", return_value=subprocess.CompletedProcess(expected_command, 0, image_id + " " + manifest + "\n")) as inspect:
            runtime.verify_app_image(image_id, manifest)
            inspect.assert_called_once_with(expected_command, check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)

        with patch.object(runtime.subprocess, "run", return_value=subprocess.CompletedProcess(expected_command, 0, image_id + " " + "f" * 64 + "\n")):
            with self.assertRaisesRegex(ValueError, "does not match"):
                runtime.verify_app_image(image_id, manifest)

    def test_bootstrap_runner_uses_reviewed_image_and_restricted_root_mounts(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            release = base / "release"
            (release / "deploy/marine").mkdir(parents=True)
            (release / "deploy/marine/manifest.py").write_text("fixture")
            (release / "deploy/marine/bootstrap.mjs").write_text("fixture")
            runtime_dir, evidence = base / "runtime", base / "evidence"
            image_id, manifest = "sha256:" + "d" * 64, "e" * 64
            runtime_dir.mkdir()
            evidence.mkdir()
            (runtime_dir / "runtime.env").write_text(f"BAMBOLA_APP_IMAGE={image_id}\nBAMBOLA_SOURCE_MANIFEST_SHA256={manifest}\n")
            if os.name == "posix":
                (runtime_dir / "runtime.env").chmod(0o600)
            accounts = runtime_dir / "accounts.json"
            accounts.write_text('{"accounts":[]}')
            if os.name == "posix":
                accounts.chmod(0o600)
            commands = []

            def fake_run(command, *, capture=False, check=True):
                commands.append(command)
                if command[:4] == ["docker", "inspect", "--type", "container"]:
                    return subprocess.CompletedProcess(command, 0, image_id)
                if command[:2] == ["docker", "run"]:
                    output_mount = next(arg for arg in command if arg.startswith("type=bind") and "dst=/run/bambola-evidence" in arg)
                    output_dir = Path(output_mount.split("src=", 1)[1].split(",dst=", 1)[0])
                    result = output_dir / "bootstrap.json"
                    result.write_text(json.dumps({"version": 1, "ok": True, "ownerCreated": True, "rosanniRole": "admin", "crewCount": 3, "signupClosed": True, "sampleTourId": "synthetic-tour-id"}))
                    if os.name == "posix":
                        result.chmod(0o600)
                return subprocess.CompletedProcess(command, 0, "" if capture else None)

            with patch.object(bootstrap, "RUNTIME", runtime_dir), patch.object(bootstrap, "EVIDENCE", evidence), patch.object(bootstrap, "run", side_effect=fake_run), patch.object(bootstrap, "verify_image"), patch.object(bootstrap, "verify_edge_network"):
                result_path = bootstrap.execute(release, image_id, manifest, root_required=False)
            self.assertEqual(result_path, evidence / "bootstrap.json")
            self.assertTrue(json.loads(result_path.read_text())["ok"])
            run_command = next(command for command in commands if command[:2] == ["docker", "run"])
            for flag in ("--network", bootstrap.EDGE_NETWORK, "--user", "0:0", "--memory", "128m", "--cpus", "0.2", "--pids-limit", "64", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true"):
                self.assertIn(flag, run_command)
            self.assertIn(image_id, run_command)
            self.assertNotIn("/var/run/docker.sock", " ".join(run_command))
            self.assertFalse(list(runtime_dir.glob(".bootstrap-*")))

    def test_isolation_accepts_only_the_allowed_gateway_effective_capability(self):
        def status(effective, bounding=0x400):
            return ("Name:\tcaddy\nUid:\t65532\t65532\t65532\t65532\n"
                    f"CapEff:\t{effective:016x}\nCapBnd:\t{bounding:016x}\nNoNewPrivs:\t1\n")

        def gateway(cap_add):
            return {"HostConfig": {"CapDrop": ["ALL"], "CapAdd": cap_add, "ReadonlyRootfs": True,
                                    "SecurityOpt": ["no-new-privileges:true"],
                                    "Tmpfs": {"/tmp": "rw,noexec,nosuid,size=8m"}}}

        for spelling in ("NET_BIND_SERVICE", "CAP_NET_BIND_SERVICE"):
            for effective in (0, 0x400):
                with self.subTest(spelling=spelling, effective=effective):
                    process_status = status(effective)
                    def docker_ok(args):
                        output = "65532\n" if args[1:3] == [isolation.GATEWAY, "id"] else process_status
                        return subprocess.CompletedProcess(args, 0, output)
                    with patch.object(isolation, "docker", side_effect=docker_ok):
                        uid, checks = isolation.verify_gateway_privileges(gateway([spelling]))
                    self.assertEqual(uid, "65532")
                    self.assertTrue(all(checks.values()))

        for effective in (0x2000, 0x2400, 0x1):
            with self.subTest(unallowed_effective=effective):
                process_status = status(effective)
                def docker_extra_cap(args):
                    output = "65532\n" if args[1:3] == [isolation.GATEWAY, "id"] else process_status
                    return subprocess.CompletedProcess(args, 0, output)
                with patch.object(isolation, "docker", side_effect=docker_extra_cap):
                    with self.assertRaisesRegex(RuntimeError, "privilege boundary"):
                        isolation.verify_gateway_privileges(gateway(["CAP_NET_BIND_SERVICE"]))

        for bounding in (0, 0x401, 0x2400):
            with self.subTest(unexpected_bounding=bounding):
                process_status = status(0x400, bounding)
                def docker_bad_bound(args):
                    output = "65532\n" if args[1:3] == [isolation.GATEWAY, "id"] else process_status
                    return subprocess.CompletedProcess(args, 0, output)
                with patch.object(isolation, "docker", side_effect=docker_bad_bound):
                    with self.assertRaisesRegex(RuntimeError, "privilege boundary"):
                        isolation.verify_gateway_privileges(gateway(["NET_BIND_SERVICE"]))

        for cap_add in (["NET_RAW"], ["NET_BIND_SERVICE", "NET_RAW"], []):
            with self.subTest(unexpected_cap_add=cap_add):
                process_status = status(0x400)
                def docker_bad_add(args):
                    output = "65532\n" if args[1:3] == [isolation.GATEWAY, "id"] else process_status
                    return subprocess.CompletedProcess(args, 0, output)
                with patch.object(isolation, "docker", side_effect=docker_bad_add):
                    with self.assertRaisesRegex(RuntimeError, "privilege boundary"):
                        isolation.verify_gateway_privileges(gateway(cap_add))

    def test_inventory_records_only_exact_next_vendored_missing_versions(self):
        def scan(root):
            script = isolation.JS_INVENTORY.replace("/app/node_modules", str(root).replace("\\", "/"))
            result = subprocess.run(
                ["node", "--input-type=module", "-e", script], check=True, text=True,
                capture_output=True, timeout=20,
                env={**os.environ, "WANTED_PACKAGES": json.dumps(["nanoid"])},
            )
            return json.loads(result.stdout)

        for package_base, expected_path in (
            (Path("next"), "next/dist/compiled/nanoid"),
            (Path(".pnpm/next@15.5.28_peer_fixture/node_modules/next"),
             ".pnpm/next@15.5.28_peer_fixture/node_modules/next/dist/compiled/nanoid"),
        ):
            with self.subTest(next_layout=expected_path), tempfile.TemporaryDirectory() as temp:
                root = Path(temp) / "node_modules"
                next_package = root / package_base
                (next_package / "dist/compiled/nanoid").mkdir(parents=True)
                (next_package / "package.json").write_text('{"name":"next","version":"15.5.28"}', encoding="utf-8")
                vendored = next_package / "dist" / "compiled" / "nanoid"
                (vendored / "package.json").write_text('{"name":"nanoid"}', encoding="utf-8")
                inventory = scan(root)
                self.assertTrue(inventory["scanComplete"])
                self.assertEqual(inventory["unknownVendoredPackages"], [{
                    "name": "nanoid", "version": None, "path": expected_path,
                    "packageSha256": hashlib.sha256((vendored / "package.json").read_bytes()).hexdigest(),
                }])
                self.assertTrue(isolation.vendored_package_records_valid(inventory["unknownVendoredPackages"]))
                mismatched = [{**inventory["unknownVendoredPackages"][0], "name": "shell-quote"}]
                self.assertFalse(isolation.vendored_package_records_valid(mismatched))

        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "node_modules"
            arbitrary = root / "nanoid"
            arbitrary.mkdir(parents=True)
            (arbitrary / "package.json").write_text('{"name":"nanoid"}', encoding="utf-8")
            inventory = scan(root)
            self.assertFalse(inventory["scanComplete"])
            self.assertEqual(inventory["unknownVendoredPackages"], [])

    def test_compose_is_two_internal_isolated_networks_and_gateway_only_frontend_peer(self):
        compose = (HERE / "compose.ubuntu.yml").read_text()
        self.assertIn("internal: true", compose)
        self.assertIn("second-brain_frontend", compose)
        self.assertIn("BAMBOLA_APP_IMAGE", compose)
        self.assertNotRegex(compose, r"(?m)^\s+ports:")
        self.assertNotIn("booking-worker", compose)
        self.assertNotIn("/var/run/docker.sock", compose)
        app_block = compose.split("  app:\n", 1)[1].split("  gateway:\n", 1)[0]
        gateway_block = compose.split("  gateway:\n", 1)[1].split("\nvolumes:", 1)[0]
        self.assertIn("bambola_edge", app_block)
        self.assertIn("bambola_data", app_block)
        self.assertNotIn("second-brain_frontend", app_block)
        self.assertIn("second-brain_frontend", gateway_block)
        self.assertNotIn("bambola_data", gateway_block)
        for restriction in ('user: "65532:65532"', "read_only: true", "cap_drop: [ALL]", "cap_add: [NET_BIND_SERVICE]", 'security_opt: ["no-new-privileges:true"]', 'tmpfs: ["/tmp:rw,noexec,nosuid,size=8m"]'):
            self.assertIn(restriction, gateway_block)

    def test_gateway_has_exact_allowlist_caps_and_header_boundary(self):
        gateway = (HERE / "gateway.Caddyfile.template").read_text()
        for contract in ("__SHARED_IPV4__/32", "max_size 32KB", "request_header -Forwarded", "request_header -X-Real-IP", "header_up X-Forwarded-For {http.request.header.X-Forwarded-For}", "Cache-Control \"no-store\"", "Referrer-Policy \"no-referrer\"", "X-Robots-Tag \"noindex\"", "frame-ancestors 'none'", "path /api/auth/get-session", "path /api/auth/sign-in/email /api/auth/sign-out", "path /api/marine /api/public/marine", "respond 404"):
            self.assertIn(contract, gateway)
        self.assertNotIn("request_header X-Forwarded-For", gateway)
        self.assertRegex(gateway, r"(?s):8080 \{\s+route \{.*respond @not_shared_caddy 403.*handle @health_shared.*handle @page_get.*respond 404")
        loopback = gateway.split("@health_loopback", 1)[1].split("\n\t}", 1)[0]
        self.assertIn("path /api/health", loopback)
        self.assertIn("method GET HEAD", loopback)
        self.assertNotIn("/_next/image", gateway)
        self.assertNotIn("/api/auth/*", gateway)
        self.assertNotIn("log {", gateway)
        self.assertIn("storage file_system /tmp/caddy-data", gateway)

    def test_backup_is_only_fixed_test_command_and_uses_no_network_restore(self):
        source = (HERE / "backup.py").read_text()
        self.assertIn('SOURCE_CONTAINER = "bambola-arm-postgres-1"', source)
        self.assertIn('RESTORE_CONTAINER = "bambola-arm-restore-test"', source)
        self.assertIn('"--network", "none"', source)
        self.assertIn('"--tmpfs", "/var/lib/postgresql/data:rw,size=384m"', source)
        self.assertIn('"--format=custom", "--no-owner", "--no-acl"', source)
        self.assertIn('"--exit-on-error", "--no-owner", "--no-acl"', source)
        self.assertIn('"docker", "rm", "--force", RESTORE_CONTAINER', source)
        self.assertIn("SELECT hash || ':' || created_at FROM drizzle.__drizzle_migrations ORDER BY created_at", source)

    def test_backup_mock_restores_and_removes_only_its_disposable_container(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            evidence, runtime_dir = base / "evidence", base / "runtime"
            runtime_dir.mkdir()
            (runtime_dir / "runtime.env").write_text("BAMBOLA_POSTGRES_IMAGE=sha256:" + "c" * 64 + "\n")
            calls = []

            def fake_run(command, *, input_data=None, check=True, capture=False):
                calls.append(command)
                if command[:3] == ["docker", "inspect", backup.RESTORE_CONTAINER]:
                    return subprocess.CompletedProcess(command, 1, b"")
                if command[:3] == ["docker", "exec", backup.SOURCE_CONTAINER] and "pg_dump" in command:
                    return subprocess.CompletedProcess(command, 0, b"synthetic-custom-dump")
                return subprocess.CompletedProcess(command, 0, b"")

            state = {"migrations": ["migration:0026_marine_arm"], "tables": ["table:public.marine_trip:1"], "countsSha256": "abc"}
            with patch.object(backup, "run", side_effect=fake_run), patch.object(backup, "query", return_value=state):
                backup.backup_test(base, evidence, runtime_dir)
            created = [c for c in calls if c[:2] == ["docker", "run"]]
            removed = [c for c in calls if c[:3] == ["docker", "rm", "--force"]]
            self.assertEqual(len(created), 1)
            self.assertIn("--network", created[0])
            self.assertEqual(removed, [["docker", "rm", "--force", backup.RESTORE_CONTAINER]])
            dump = next(evidence.glob("*.dump"))
            report = json.loads(next(evidence.glob("*.json")).read_text())
            self.assertEqual(dump.read_bytes(), b"synthetic-custom-dump")
            self.assertTrue(report["ok"])
            self.assertEqual(report["tableCount"], 1)

    def test_backup_cleanup_failure_is_redacted_failure_and_not_success(self):
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            evidence, runtime_dir = base / "evidence", base / "runtime"
            runtime_dir.mkdir()
            (runtime_dir / "runtime.env").write_text("BAMBOLA_POSTGRES_IMAGE=sha256:" + "c" * 64 + "\n")

            def fake_run(command, *, input_data=None, check=True, capture=False):
                if command[:3] == ["docker", "inspect", backup.RESTORE_CONTAINER]:
                    return subprocess.CompletedProcess(command, 1, b"")
                if command[:3] == ["docker", "exec", backup.SOURCE_CONTAINER] and "pg_dump" in command:
                    return subprocess.CompletedProcess(command, 0, b"synthetic-custom-dump")
                if command[:3] == ["docker", "rm", "--force"]:
                    return subprocess.CompletedProcess(command, 1, b"")
                return subprocess.CompletedProcess(command, 0, b"")

            state = {"migrations": ["migration:abc:123"], "tables": ["table:public.marine_trip:1"], "countsSha256": "abc"}
            with patch.object(backup, "run", side_effect=fake_run), patch.object(backup, "query", return_value=state):
                with self.assertRaises(RuntimeError):
                    backup.backup_test(base, evidence, runtime_dir)
            report = json.loads(next(evidence.glob("*.json")).read_text())
            self.assertFalse(report["ok"])
            self.assertEqual(report["error"], "restore_container_cleanup_failed")

    def test_tenant_fixture_reads_then_mutates_wrong_org_and_restores_owner_session(self):
        class FixtureClient:
            def __init__(self, private_url):
                self.active = "org-original"
                self.calls = []
                self.cookies = {"session": "redacted-fixture"}

            def request(self, path, *, private=False, method="GET", body=None):
                self.calls.append((path, private, method, body))
                if path == "/api/auth/sign-in/email":
                    return 200, {"ok": True}
                if path == "/api/auth/get-session":
                    return 200, {"session": {"activeOrganizationId": self.active}}
                if path == "/api/marine?tripId=trip-synthetic":
                    if method == "POST":
                        return (404, {"error": "not_found"}) if self.active == "org-other" else (422, {})
                    if self.active == "org-other":
                        return 200, {"role": "owner", "organizationId": self.active, "trip": None, "trips": []}
                    return 200, {"role": "owner", "organizationId": self.active, "trip": {"id": "trip-synthetic", "title": "Synthetic PRUEBA"}, "trips": []}
                if path == "/api/auth/organization/create":
                    return 200, {"id": "org-other"}
                if path == "/api/auth/organization/set-active":
                    self.active = body["organizationId"]
                    return 200, {"id": self.active}
                if path == "/api/marine" and method == "POST":
                    return 404, {"error": "not_found"}
                if path == "/api/auth/sign-out":
                    return 200, {"ok": True}
                raise AssertionError(path)

        with tempfile.TemporaryDirectory() as temp:
            accounts = Path(temp) / "accounts.json"
            bootstrap_result = Path(temp) / "bootstrap.json"
            accounts.write_text(json.dumps({"accounts": [{"role": "owner", "email": "synthetic@example.invalid", "password": "private-test-secret"}]}))
            bootstrap_result.write_text(json.dumps({"sampleTourId": "trip-synthetic"}))
            fixture_client = FixtureClient
            result_path = Path(temp) / "tenant-proof.json"
            with patch.object(tenant_proof, "validate_app_ip", return_value=("10.0.0.2", "sha256:" + "d" * 64)), patch.object(tenant_proof, "Client", side_effect=lambda url: fixture_client(url)):
                tenant_proof.prove("10.0.0.2", accounts, bootstrap_result, result_path)
            report = json.loads(result_path.read_text())
            self.assertTrue(report["ok"])
            self.assertEqual(report["base"], "https://bambola.heili.cloud")
            self.assertEqual(report["sourceAppImageId"], "sha256:" + "d" * 64)
            self.assertTrue(all(report["checks"].values()))

    def test_tenant_fixture_accepts_only_inspected_app_alias_on_internal_edge(self):
        container = [{"NetworkSettings": {"Networks": {"bambola-arm_bambola_edge": {"IPAddress": "10.0.0.2", "Aliases": ["bambola-arm-private-app"]}}}}]

        def inspect_internal(*args, **kwargs):
            payload = container if args[0][2] == tenant_proof.APP_CONTAINER else [{"Internal": True}]
            if args[0][2] == tenant_proof.APP_CONTAINER:
                payload[0]["Image"] = "sha256:" + "a" * 64
            return subprocess.CompletedProcess(args[0], 0, json.dumps(payload))

        with patch.object(tenant_proof.subprocess, "run", side_effect=inspect_internal):
            self.assertEqual(tenant_proof.validate_app_ip("10.0.0.2"), ("10.0.0.2", "sha256:" + "a" * 64))

        def inspect_external(*args, **kwargs):
            payload = container if args[0][2] == tenant_proof.APP_CONTAINER else [{"Internal": False}]
            if args[0][2] == tenant_proof.APP_CONTAINER:
                payload[0]["Image"] = "sha256:" + "a" * 64
            return subprocess.CompletedProcess(args[0], 0, json.dumps(payload))

        with patch.object(tenant_proof.subprocess, "run", side_effect=inspect_external):
            with self.assertRaisesRegex(RuntimeError, "address is not"):
                tenant_proof.validate_app_ip("10.0.0.2")

    def test_tenant_fixture_restores_and_logs_out_when_cross_org_write_is_not_denied(self):
        class UnsafeFixture:
            def __init__(self, private_url):
                self.active = "org-original"
                self.cookies = {"session": "redacted-fixture"}

            def request(self, path, *, private=False, method="GET", body=None):
                if path == "/api/auth/sign-in/email" or path == "/api/auth/sign-out":
                    return 200, {"ok": True}
                if path == "/api/auth/get-session":
                    return 200, {"session": {"activeOrganizationId": self.active}}
                if path == "/api/marine?tripId=trip-synthetic":
                    if self.active == "org-other":
                        return 200, {"role": "owner", "organizationId": self.active, "trip": None, "trips": []}
                    return 200, {"role": "owner", "organizationId": self.active, "trip": {"id": "trip-synthetic", "title": "Synthetic PRUEBA"}, "trips": []}
                if path == "/api/auth/organization/create":
                    return 200, {"id": "org-other"}
                if path == "/api/auth/organization/set-active":
                    self.active = body["organizationId"]
                    return 200, {"id": self.active}
                if path == "/api/marine" and method == "POST":
                    return 200, {"ok": True}
                raise AssertionError(path)

        with tempfile.TemporaryDirectory() as temp:
            accounts, bootstrap_result = Path(temp) / "accounts.json", Path(temp) / "bootstrap.json"
            accounts.write_text(json.dumps({"accounts": [{"role": "owner", "email": "synthetic@example.invalid", "password": "private-test-secret"}]}))
            bootstrap_result.write_text(json.dumps({"sampleTourId": "trip-synthetic"}))
            instances = []

            def make_client(url):
                instance = UnsafeFixture(url)
                instances.append(instance)
                return instance

            result_path = Path(temp) / "tenant-proof.json"
            with patch.object(tenant_proof, "validate_app_ip", return_value=("10.0.0.2", "sha256:" + "d" * 64)), patch.object(tenant_proof, "Client", side_effect=make_client):
                with self.assertRaisesRegex(RuntimeError, "proof failed"):
                    tenant_proof.prove("10.0.0.2", accounts, bootstrap_result, result_path)
            self.assertEqual(instances[0].active, "org-original")
            report = json.loads(result_path.read_text())
            self.assertFalse(report["ok"])
            self.assertFalse(report["checks"]["writeIsolation"])
            self.assertTrue(report["checks"]["sessionRestored"])
            self.assertTrue(report["checks"]["logout"])


if __name__ == "__main__":
    unittest.main()
