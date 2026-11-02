import subprocess
import sys
from pathlib import Path

HARNESS = r'''
import hashlib
import importlib.util
import tempfile
from pathlib import Path
import sys

wrapper_path = Path(r"PLACEHOLDER_WRAPPER")
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("compat_test", wrapper_path)
compat = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compat)
with tempfile.TemporaryDirectory() as temporary:
    root = Path(temporary) / "bambola-arm"
    release = root / "releases/20261102-r5/deploy/marine"
    ops = root / "ops/20261102-compat"
    release.mkdir(parents=True)
    ops.mkdir(parents=True)
    bootstrap_py = release / "bootstrap.py"
    manifest_py = release / "manifest.py"
    bootstrap_py.write_text("raise RuntimeError('must not execute')", encoding="utf-8")
    manifest_py.write_text("raise RuntimeError('must not execute')", encoding="utf-8")
    (ops / "bootstrap.mjs").write_text("modified synthetic fixture", encoding="utf-8")
    compat.ROOT = root
    compat.RELEASE = release.parents[1]
    compat.OPS = ops
    compat.RELEASE_BOOTSTRAP_SHA256 = hashlib.sha256(bootstrap_py.read_bytes()).hexdigest()
    compat.RELEASE_MANIFEST_SHA256 = hashlib.sha256(manifest_py.read_bytes()).hexdigest()
    compat.SCRIPT_SHA256 = "0" * 64
    compat.os.geteuid = lambda: 0
    def forbidden_process(*_args, **_kwargs):
        raise RuntimeError("Docker or subprocess must not be invoked by this sabotage test")
    compat.subprocess.run = forbidden_process
    try:
        compat.execute_compat()
    except RuntimeError as error:
        if str(error) != "supplemental bootstrap.mjs hash does not match the reviewed release":
            raise
    else:
        raise RuntimeError("wrong supplemental script hash was accepted under python -O")
print("PASS optimized-mode wrong-hash sabotage stopped before Docker or release imports")
'''.replace("PLACEHOLDER_WRAPPER", str(Path(__file__).with_name("bootstrap-compat.py")).replace("\\", "/"))

result = subprocess.run(
    [sys.executable, "-O", "-c", HARNESS], check=True, text=True,
    capture_output=True, timeout=20,
)
print(result.stdout, end="")
