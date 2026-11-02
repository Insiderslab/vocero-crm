#!/usr/bin/env python3
"""Create a fresh, private Bambola runtime. Never print generated credentials."""
import argparse
import base64
import ipaddress
import json
import os
import re
import secrets
import subprocess
import sys
from pathlib import Path

RUNTIME_DIR = Path("/opt/bambola-arm/runtime")
DOMAIN = "bambola.heili.cloud"
IMAGE_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


def verify_app_image(image_id, manifest_sha256, *, inspect=None):
    if not IMAGE_RE.fullmatch(image_id) or not SHA_RE.fullmatch(manifest_sha256):
        raise ValueError("invalid app image or manifest digest")
    inspect = inspect or (lambda image: subprocess.run(
        ["docker", "image", "inspect", "--format", '{{.Id}} {{index .Config.Labels "heili.source-manifest"}}', image],
        check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    ).stdout.strip())
    try:
        identity, label = inspect(image_id).split()
    except Exception:
        raise RuntimeError("app image identity could not be verified") from None
    if identity != image_id or label != manifest_sha256:
        raise ValueError("app image does not match the reviewed manifest")


def create(target, shared_ip, caddy_image, postgres_image, app_image, manifest_sha256, *, inspect_image=None, allow_non_posix_for_test=False):
    ip = ipaddress.ip_address(shared_ip)
    if ip.version != 4 or not IMAGE_RE.fullmatch(caddy_image) or not IMAGE_RE.fullmatch(postgres_image):
        raise ValueError("invalid runtime input")
    verify_app_image(app_image, manifest_sha256, inspect=inspect_image)
    path = Path(target)
    if path.exists() or path.is_symlink():
        raise FileExistsError("runtime already exists")
    if os.name != "posix" and not allow_non_posix_for_test:
        raise RuntimeError("runtime generation requires POSIX permissions")
    path.mkdir(mode=0o700, parents=True, exist_ok=False)
    os.chmod(path, 0o700)
    try:
        db_password = secrets.token_urlsafe(36)
        auth_secret = secrets.token_urlsafe(48)
        encryption_key = base64.b64encode(secrets.token_bytes(32)).decode("ascii")
        webhook_token = secrets.token_urlsafe(32)
        users = [
            ("Stefano — OWNER PRUEBA", "owner"),
            ("Rosanni — PRUEBA", "admin"),
            ("Tripulación 1 — PRUEBA", "crew1"),
            ("Tripulación 2 — PRUEBA", "crew2"),
            ("Tripulación 3 — PRUEBA", "crew3"),
        ]
        accounts = [{"name": name, "email": f"bambola-{role}@example.invalid", "password": secrets.token_urlsafe(24), "role": role} for name, role in users]
        values = {
            "APP_BASE_URL": f"https://{DOMAIN}",
            "DATABASE_URL": f"postgresql://bambola_arm:{db_password}@postgres:5432/bambola_arm",
            "BETTER_AUTH_SECRET": auth_secret,
            "ENCRYPTION_KEY": encryption_key,
            "META_WEBHOOK_VERIFY_TOKEN": webhook_token,
            "MEDIA_DIR": "/data/media",
            "ALLOW_SIGNUP": "false",
            "MARINE_TRUST_PROXY_IP": "true",
            "NODE_ENV": "production",
            "BAMBOLA_RUNTIME_DIR": str(path),
            "BAMBOLA_POSTGRES_IMAGE": postgres_image,
            "BAMBOLA_CADDY_IMAGE": caddy_image,
            "BAMBOLA_APP_IMAGE": app_image,
            "BAMBOLA_SOURCE_MANIFEST_SHA256": manifest_sha256,
            "BAMBOLA_POSTGRES_PASSWORD": db_password,
        }
        (path / "runtime.env").write_text("".join(f"{k}={v}\n" for k, v in values.items()), encoding="utf-8")
        template = Path(__file__).with_name("gateway.Caddyfile.template").read_text(encoding="utf-8")
        (path / "gateway.Caddyfile").write_text(template.replace("__SHARED_IPV4__", str(ip)), encoding="utf-8")
        (path / "accounts.json").write_text(json.dumps({"accounts": accounts}, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        os.chmod(path / "runtime.env", 0o600)
        os.chmod(path / "accounts.json", 0o600)
        os.chmod(path / "gateway.Caddyfile", 0o444)
        return ("runtime.env", "gateway.Caddyfile", "accounts.json")
    except Exception:
        for child in path.iterdir():
            child.unlink()
        path.rmdir()
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    prepare = sub.add_parser("prepare")
    prepare.add_argument("--shared-ip", required=True)
    prepare.add_argument("--caddy-image", required=True)
    prepare.add_argument("--postgres-image", required=True)
    prepare.add_argument("--app-image", required=True)
    prepare.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        files = create(RUNTIME_DIR, args.shared_ip, args.caddy_image, args.postgres_image, args.app_image, args.manifest_sha256)
    except (ValueError, FileExistsError):
        print("Invalid input or runtime already exists.", file=sys.stderr)
        return 2
    except Exception:
        print("Runtime preparation failed.", file=sys.stderr)
        return 1
    print("Created private runtime: " + ", ".join(files))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
