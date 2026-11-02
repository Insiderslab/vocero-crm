#!/usr/bin/env python3
"""Run the manifest-verified bootstrap in a restricted disposable app container."""
import argparse
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path

ROOT = Path("/opt/bambola-arm")
RUNTIME = ROOT / "runtime"
EVIDENCE = ROOT / "evidence"
EDGE_NETWORK = "bambola-arm_bambola_edge"
APP_CONTAINER = "bambola-arm-app-1"
IMAGE_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
MANIFEST_RE = re.compile(r"^[0-9a-f]{64}$")


def run(command, *, capture=False, check=True):
    return subprocess.run(command, check=check, stdout=subprocess.PIPE if capture else subprocess.DEVNULL, stderr=subprocess.DEVNULL, text=capture, timeout=180)


def verify_image(image_id, manifest_sha256):
    if not IMAGE_RE.fullmatch(image_id) or not MANIFEST_RE.fullmatch(manifest_sha256):
        raise ValueError("invalid app image or manifest digest")
    result = run(["docker", "image", "inspect", "--format", '{{.Id}} {{index .Config.Labels "heili.source-manifest"}}', image_id], capture=True)
    parts = result.stdout.strip().split()
    if len(parts) != 2 or parts[0] != image_id or parts[1] != manifest_sha256:
        raise ValueError("app image does not match the reviewed manifest")


def verify_edge_network():
    result = run(["docker", "network", "inspect", "--format", "{{.Internal}}", EDGE_NETWORK], capture=True)
    if result.stdout.strip() != "true":
        raise RuntimeError("private Bambola edge network is not internal")


def verify_runtime_binding(image_id, manifest_sha256):
    runtime_values = {}
    runtime_env = RUNTIME / "runtime.env"
    if runtime_env.is_symlink() or not runtime_env.is_file() or os.name == "posix" and stat.S_IMODE(runtime_env.stat().st_mode) != 0o600:
        raise RuntimeError("private runtime file permissions are unsafe")
    for line in runtime_env.read_text(encoding="utf-8").splitlines():
        key, sep, value = line.partition("=")
        if sep:
            runtime_values[key] = value
    if runtime_values.get("BAMBOLA_APP_IMAGE") != image_id or runtime_values.get("BAMBOLA_SOURCE_MANIFEST_SHA256") != manifest_sha256:
        raise RuntimeError("runtime does not match the reviewed app image")
    running_image = run(["docker", "inspect", "--type", "container", "--format", "{{.Image}}", APP_CONTAINER], capture=True).stdout.strip()
    if running_image != image_id:
        raise RuntimeError("running app container is not the reviewed image")


def check_private_accounts(path):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("private account file is unavailable")
    mode = stat.S_IMODE(path.stat().st_mode)
    if os.name == "posix" and (mode != 0o600 or path.stat().st_uid != 0):
        raise RuntimeError("private account file permissions are unsafe")


def validate_bootstrap_result(path):
    if path.is_symlink() or not path.is_file() or os.name == "posix" and stat.S_IMODE(path.stat().st_mode) != 0o600 or path.stat().st_size > 4096:
        raise RuntimeError("bootstrap result is invalid")
    result = json.loads(path.read_text(encoding="utf-8"))
    expected = {"version": 1, "ok": True, "ownerCreated": True, "rosanniRole": "admin", "crewCount": 3, "signupClosed": True}
    if any(result.get(key) != value for key, value in expected.items()) or not isinstance(result.get("sampleTourId"), str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", result["sampleTourId"]):
        raise RuntimeError("bootstrap checks did not pass")
    return path.read_bytes()


def execute(release, image_id, manifest_sha256, *, root_required=True):
    if root_required and (not hasattr(os, "geteuid") or os.geteuid() != 0):
        raise RuntimeError("bootstrap runner requires host root")
    release = Path(release).resolve(strict=True)
    manifest_script = release / "deploy" / "marine" / "manifest.py"
    bootstrap_script = release / "deploy" / "marine" / "bootstrap.mjs"
    if not MANIFEST_RE.fullmatch(manifest_sha256):
        raise ValueError("invalid manifest digest")
    run([sys.executable, str(manifest_script), "verify", str(release), manifest_sha256])
    verify_image(image_id, manifest_sha256)
    verify_edge_network()
    verify_runtime_binding(image_id, manifest_sha256)

    accounts = RUNTIME / "accounts.json"
    check_private_accounts(accounts)
    EVIDENCE.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(EVIDENCE, 0o700)
    evidence_file = EVIDENCE / "bootstrap.json"
    if evidence_file.exists() or evidence_file.is_symlink():
        raise FileExistsError("bootstrap evidence already exists")

    stage = Path(tempfile.mkdtemp(prefix=".bootstrap-", dir=RUNTIME))
    os.chmod(stage, 0o700)
    container_name = "bambola-arm-bootstrap-" + uuid.uuid4().hex[:12]
    stage_output = stage / "bootstrap.json"
    try:
        command = [
            "docker", "run", "--rm", "--name", container_name,
            "--network", EDGE_NETWORK, "--user", "0:0",
            "--memory", "128m", "--cpus", "0.2", "--pids-limit", "64",
            "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true",
            "--tmpfs", "/tmp:rw,noexec,nosuid,size=8m",
            "--mount", f"type=bind,src={bootstrap_script},dst=/run/bambola-bootstrap.mjs,readonly",
            "--mount", f"type=bind,src={accounts},dst=/run/bambola-accounts.json,readonly",
            "--mount", f"type=bind,src={stage},dst=/run/bambola-evidence",
            "--entrypoint", "node", image_id,
            "/run/bambola-bootstrap.mjs", "--accounts", "/run/bambola-accounts.json",
            "--result", "/run/bambola-evidence/bootstrap.json",
        ]
        run(command)
        payload = validate_bootstrap_result(stage_output)
        with evidence_file.open("xb") as output:
            os.chmod(evidence_file, 0o600)
            output.write(payload)
        return evidence_file
    finally:
        shutil.rmtree(stage)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    execute_parser = sub.add_parser("run")
    execute_parser.add_argument("--app-image", required=True)
    execute_parser.add_argument("--manifest-sha256", required=True)
    args = parser.parse_args(argv)
    try:
        release = Path(__file__).resolve().parents[2]
        result = execute(release, args.app_image, args.manifest_sha256)
    except Exception:
        print("Private bootstrap failed; no credentials were printed.", file=sys.stderr)
        return 1
    print("Private bootstrap completed; evidence: " + result.name)
    return 0


if __name__ == "__main__":
    os.umask(0o077)
    raise SystemExit(main())
