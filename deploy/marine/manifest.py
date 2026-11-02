#!/usr/bin/env python3
"""Verify an immutable Marine release snapshot without changing it."""
import argparse
import hashlib
import hmac
import json
import os
import re
import stat
import sys
from pathlib import Path, PurePosixPath

MANIFEST = "release-manifest.json"
FORMAT = "heili-marine-release-source"
SHA_RE = re.compile(r"^[0-9a-f]{64}$")


def _fail(message):
    raise ValueError(message)


def _safe_relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\x00" in value:
        _fail("invalid manifest path")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in path.parts) or str(path) != value:
        _fail("invalid manifest path")
    return path.parts


def verify(release_dir, expected_digest):
    if not SHA_RE.fullmatch(expected_digest):
        _fail("invalid expected manifest digest")
    root = Path(release_dir)
    if root.is_symlink() or not root.is_dir():
        _fail("release root must be a real directory")
    manifest_path = root / MANIFEST
    if manifest_path.is_symlink() or not manifest_path.is_file():
        _fail("release manifest is missing or not regular")
    raw = manifest_path.read_bytes()
    actual_digest = hashlib.sha256(raw).hexdigest()
    if not hmac.compare_digest(actual_digest, expected_digest):
        _fail("manifest digest mismatch")
    try:
        data = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError):
        _fail("invalid manifest JSON")
    if not isinstance(data, dict) or data.get("format") != FORMAT or data.get("version") != 1:
        _fail("unsupported manifest")
    entries = data.get("files")
    if not isinstance(entries, list) or data.get("fileCount") != len(entries):
        _fail("manifest file count mismatch")
    expected = {}
    ordered = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != {"path", "bytes", "sha256"}:
            _fail("invalid file entry")
        name = entry["path"]
        _safe_relative(name)
        if name in expected:
            _fail("duplicate manifest path")
        if not isinstance(entry["bytes"], int) or isinstance(entry["bytes"], bool) or entry["bytes"] < 0:
            _fail("invalid file size")
        if not isinstance(entry["sha256"], str) or not SHA_RE.fullmatch(entry["sha256"]):
            _fail("invalid file digest")
        expected[name] = entry
        ordered.append(name)
    if ordered != sorted(ordered):
        _fail("manifest paths are not sorted")

    actual_files = set()
    actual_dirs = set()
    for current, dirs, files in os.walk(root, topdown=True, followlinks=False):
        current_path = Path(current)
        for dirname in list(dirs):
            path = current_path / dirname
            relative = path.relative_to(root).as_posix()
            if path.is_symlink() or not path.is_dir():
                _fail("symlink or non-directory in release")
            actual_dirs.add(relative)
        for filename in files:
            path = current_path / filename
            relative = path.relative_to(root).as_posix()
            if path.is_symlink() or not stat.S_ISREG(path.lstat().st_mode):
                _fail("symlink or non-regular file in release")
            if relative != MANIFEST:
                actual_files.add(relative)
    if actual_files != set(expected):
        _fail("release files differ from manifest")
    implied_dirs = {"/".join(parts[:i]) for name in expected for parts in [_safe_relative(name)] for i in range(1, len(parts))}
    if actual_dirs != implied_dirs:
        _fail("release directories differ from manifest")

    for name, entry in expected.items():
        content = (root / Path(*_safe_relative(name))).read_bytes()
        if len(content) != entry["bytes"] or not hmac.compare_digest(hashlib.sha256(content).hexdigest(), entry["sha256"]):
            _fail(f"file verification failed: {name}")
    return {"manifestSha256": actual_digest, "fileCount": len(expected), "valid": True}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    command = subparsers.add_parser("verify")
    command.add_argument("release_dir")
    command.add_argument("expected_manifest_sha256")
    args = parser.parse_args(argv)
    try:
        result = verify(args.release_dir, args.expected_manifest_sha256)
    except (OSError, ValueError) as error:
        print(f"Manifest verification failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
