#!/usr/bin/env python3
"""Create and restore a private synthetic-only Bambola database backup test."""
import hashlib
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path("/opt/bambola-arm")
RUNTIME = ROOT / "runtime"
EVIDENCE = ROOT / "evidence"
SOURCE_CONTAINER = "bambola-arm-postgres-1"
RESTORE_CONTAINER = "bambola-arm-restore-test"
IMAGE_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


def run(command, *, input_data=None, check=True, capture=False):
    return subprocess.run(command, input=input_data, check=check, stdout=subprocess.PIPE if capture else subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def query(container):
    migrations_result = run(["docker", "exec", container, "psql", "-XAt", "-U", "bambola_arm", "-d", "bambola_arm", "-c", "SELECT hash || ':' || created_at FROM drizzle.__drizzle_migrations ORDER BY created_at"], capture=True)
    tables_result = run(["docker", "exec", container, "psql", "-XAt", "-U", "bambola_arm", "-d", "bambola_arm", "-c", "SELECT schemaname || '.' || tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema') ORDER BY schemaname, tablename"], capture=True)
    migrations = ["migration:" + line for line in migrations_result.stdout.decode("utf-8").splitlines() if line]
    table_names = [line for line in tables_result.stdout.decode("utf-8").splitlines() if line]
    if not migrations or not table_names:
        raise RuntimeError("database verification returned incomplete metadata")
    tables = []
    for qualified in table_names:
        schema, table = qualified.split(".", 1)
        if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", schema) or not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", table):
            raise RuntimeError("unsafe database table identifier")
        count = run(["docker", "exec", container, "psql", "-XAt", "-U", "bambola_arm", "-d", "bambola_arm", "-c", f'SELECT count(*) FROM "{schema}"."{table}"'], capture=True).stdout.decode("ascii").strip()
        if not count.isdigit():
            raise RuntimeError("database count verification failed")
        tables.append(f"table:{qualified}:{count}")
    return {"migrations": migrations, "tables": tables, "countsSha256": hashlib.sha256("\n".join(tables).encode()).hexdigest()}


def backup_test(root=ROOT, evidence=EVIDENCE, runtime=RUNTIME):
    evidence.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(evidence, 0o700)
    runtime_values = {}
    for line in (runtime / "runtime.env").read_text(encoding="utf-8").splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            runtime_values[key] = value
    image = runtime_values.get("BAMBOLA_POSTGRES_IMAGE", "")
    if not IMAGE_RE.fullmatch(image):
        raise RuntimeError("pinned database image is missing")
    name = datetime.now(timezone.utc).strftime("backup-%Y%m%dT%H%M%SZ.dump")
    backup_path = evidence / name
    result_path = evidence / (name.removesuffix(".dump") + ".json")
    if backup_path.exists() or result_path.exists():
        raise FileExistsError("evidence already exists")
    created = False
    cleanup_failed = False
    report = {"version": 1, "ok": False}
    try:
        inspected = run(["docker", "inspect", SOURCE_CONTAINER], check=False)
        if inspected.returncode != 0:
            raise RuntimeError("fixed Bambola database container is unavailable")
        collision = run(["docker", "inspect", RESTORE_CONTAINER], check=False)
        if collision.returncode == 0:
            raise RuntimeError("restore test container name is already in use")
        source_state = query(SOURCE_CONTAINER)
        dump = run(["docker", "exec", SOURCE_CONTAINER, "pg_dump", "--format=custom", "--no-owner", "--no-acl", "-U", "bambola_arm", "-d", "bambola_arm"], capture=True)
        with backup_path.open("xb") as output:
            os.chmod(backup_path, 0o600)
            output.write(dump.stdout)
        run(["docker", "run", "--detach", "--name", RESTORE_CONTAINER, "--network", "none", "--memory", "384m", "--cpus", "0.5", "--tmpfs", "/var/lib/postgresql/data:rw,size=384m", "-e", "POSTGRES_USER=bambola_arm", "-e", "POSTGRES_DB=bambola_arm", "-e", "POSTGRES_PASSWORD=restore-only-unused", image])
        created = True
        for _ in range(30):
            ready = run(["docker", "exec", RESTORE_CONTAINER, "pg_isready", "-U", "bambola_arm", "-d", "bambola_arm"], check=False)
            if ready.returncode == 0:
                break
            import time
            time.sleep(1)
        else:
            raise RuntimeError("restore database did not become ready")
        run(["docker", "cp", str(backup_path), f"{RESTORE_CONTAINER}:/tmp/restore.dump"])
        run(["docker", "exec", RESTORE_CONTAINER, "pg_restore", "--exit-on-error", "--no-owner", "--no-acl", "-U", "bambola_arm", "-d", "bambola_arm", "/tmp/restore.dump"])
        restored = query(RESTORE_CONTAINER)
        if source_state != restored:
            raise RuntimeError("restored schema or table counts do not match")
        report = {"version": 1, "ok": True, "backupFile": name, "sha256": hashlib.sha256(backup_path.read_bytes()).hexdigest(), "migrationCount": len(source_state["migrations"]), "tableCount": len(source_state["tables"]), "countsSha256": source_state["countsSha256"]}
    finally:
        if created:
            try:
                cleanup = run(["docker", "rm", "--force", RESTORE_CONTAINER], check=False)
                cleanup_failed = cleanup.returncode != 0
            except Exception:
                cleanup_failed = True
            if cleanup_failed:
                report = {"version": 1, "ok": False, "error": "restore_container_cleanup_failed"}
        with result_path.open("x", encoding="utf-8") as output:
            os.chmod(result_path, 0o600)
            json.dump(report, output, separators=(",", ":"))
            output.write("\n")
        if cleanup_failed:
            raise RuntimeError("restore test cleanup failed")


def main(argv=None):
    if (argv if argv is not None else sys.argv[1:]) != ["test"]:
        print("Usage: backup.py test", file=sys.stderr)
        return 2
    try:
        backup_test()
    except Exception:
        print("Backup restore test failed; private redacted evidence was retained.", file=sys.stderr)
        return 1
    print("Backup restore test passed; private evidence retained.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
