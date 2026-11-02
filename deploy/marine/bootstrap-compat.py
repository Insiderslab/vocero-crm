#!/usr/bin/env python3
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path('/opt/bambola-arm')
RELEASE = ROOT / 'releases/20261102-r5'
OPS = ROOT / 'ops/20261102-compat'
IMAGE = 'sha256:cf918239b6e77893a1159c2bfcb30e9fe4fdc07826d6950502a5f85cb741b2fa'
DIGEST = '79ea9b06f1c718b017b2cba81ca089a8a2facfd161b892a46b0e06d80c251838'
RELEASE_BOOTSTRAP_SHA256 = '6d093689d70113f5ef4633a0a8aefde0e06b78644d75a4c9b99a7d99e12022f0'
RELEASE_MANIFEST_SHA256 = '71e5e7449f7bec68c2fa0b461413e38df7502653b7e47be0be3fce2823615a92'
SCRIPT_SHA256 = '27fc4ff9294d24c726580b6ce4913ca6c4325c4b1062526aeb7695fea87c8774'


def verify_pinned_file(path, expected_sha256, label):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError(f'{label} is missing or not a regular file')
    actual = hashlib.sha256(path.read_bytes()).hexdigest()
    if actual != expected_sha256:
        raise RuntimeError(f'{label} hash does not match the reviewed release')


def verify_ops_permissions(script):
    chain = (ROOT, ROOT / 'ops', OPS, script)
    for path in chain:
        info = path.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise RuntimeError('compatibility operations path ownership or permissions are unsafe')
    if not stat.S_ISDIR(chain[0].lstat().st_mode) or not stat.S_ISDIR(chain[1].lstat().st_mode) or not stat.S_ISDIR(chain[2].lstat().st_mode):
        raise RuntimeError('compatibility operations path is not a directory')
    script_info = script.lstat()
    if not stat.S_ISREG(script_info.st_mode) or stat.S_IMODE(script_info.st_mode) not in {0o400, 0o600}:
        raise RuntimeError('supplemental bootstrap must be a root-only regular file')


def execute_compat():
    if not hasattr(os, 'geteuid') or os.geteuid() != 0:
        raise RuntimeError('compatibility bootstrap requires host root')

    verify_pinned_file(RELEASE / 'deploy/marine/bootstrap.py', RELEASE_BOOTSTRAP_SHA256, 'r5 bootstrap.py')
    verify_pinned_file(RELEASE / 'deploy/marine/manifest.py', RELEASE_MANIFEST_SHA256, 'r5 manifest.py')
    script = OPS / 'bootstrap.mjs'
    verify_pinned_file(script, SCRIPT_SHA256, 'supplemental bootstrap.mjs')
    verify_ops_permissions(script)

    evidence = ROOT / 'evidence'
    output = evidence / 'bootstrap.json'
    provenance = evidence / 'bootstrap-compat-provenance.json'
    for path in (output, provenance):
        if path.exists() or path.is_symlink():
            raise FileExistsError('bootstrap evidence or provenance already exists')

    spec = importlib.util.spec_from_file_location('reviewed_bootstrap', RELEASE / 'deploy/marine/bootstrap.py')
    if spec is None or spec.loader is None:
        raise RuntimeError('reviewed r5 bootstrap cannot be loaded')
    bootstrap = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bootstrap)

    bootstrap.run([sys.executable, str(RELEASE / 'deploy/marine/manifest.py'), 'verify', str(RELEASE), DIGEST])
    bootstrap.verify_image(IMAGE, DIGEST)
    bootstrap.verify_edge_network()
    bootstrap.verify_runtime_binding(IMAGE, DIGEST)
    accounts = bootstrap.RUNTIME / 'accounts.json'
    bootstrap.check_private_accounts(accounts)

    stage = Path(tempfile.mkdtemp(prefix='.bootstrap-compat-', dir=bootstrap.RUNTIME))
    stage.chmod(0o700)
    name = 'bambola-arm-bootstrap-compat'
    try:
        command = [
            'docker', 'run', '--rm', '--name', name, '--network', bootstrap.EDGE_NETWORK,
            '--user', '0:0', '--memory', '128m', '--cpus', '0.2', '--pids-limit', '64',
            '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=8m',
            '--mount', f'type=bind,src={script},dst=/run/bambola-bootstrap.mjs,readonly',
            '--mount', f'type=bind,src={accounts},dst=/run/bambola-accounts.json,readonly',
            '--mount', f'type=bind,src={stage},dst=/run/bambola-evidence',
            '--entrypoint', 'node', IMAGE, '/run/bambola-bootstrap.mjs', '--accounts',
            '/run/bambola-accounts.json', '--result', '/run/bambola-evidence/bootstrap.json',
        ]
        bootstrap.run(command)
        result = stage / 'bootstrap.json'
        payload = bootstrap.validate_bootstrap_result(result)
        with output.open('xb') as stream:
            os.chmod(output, 0o600)
            stream.write(payload)
        record = {
            'sourceManifest': DIGEST,
            'appImage': IMAGE,
            'supplementalBootstrapSha256': SCRIPT_SHA256,
            'compatibilityWrapperSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'releaseBootstrapPySha256': RELEASE_BOOTSTRAP_SHA256,
            'releaseManifestPySha256': RELEASE_MANIFEST_SHA256,
            'existingAccountsReverified': True,
            'ownerCreatedSemantics': 'Owner present and role verified; this does not prove this run created the owner.',
            'compatibilityNote': 'Only changes from r5 bootstrap.mjs: shared auth pacing, exports for local pacing tests, and a direct-execution guard.',
            'passed': True,
        }
        with provenance.open('x', encoding='utf-8') as stream:
            os.chmod(provenance, 0o600)
            json.dump(record, stream, sort_keys=True)
            stream.write('\n')
        print('Paced bootstrap passed, roles verified; private evidence retained.')
    finally:
        subprocess.run(['docker', 'rm', '--force', name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shutil.rmtree(stage)


def main():
    try:
        execute_compat()
    except Exception:
        print('Private compatibility bootstrap failed; no credentials were printed.', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    os.umask(0o077)
    raise SystemExit(main())
