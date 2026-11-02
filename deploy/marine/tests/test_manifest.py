import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from deploy.marine.manifest import verify


class ManifestVerifierTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "release"
        self.root.mkdir()
        (self.root / "src").mkdir()
        self.file = self.root / "src" / "app.txt"
        self.file.write_text("pilot", encoding="utf-8")
        self.write_manifest()

    def tearDown(self):
        self.temp.cleanup()

    def write_manifest(self, entries=None):
        if entries is None:
            data = self.file.read_bytes()
            entries = [{"path": "src/app.txt", "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}]
        manifest = {"format": "heili-marine-release-source", "version": 1, "createdAt": "2026-11-02T00:00:00.000Z", "fileCount": len(entries), "files": entries}
        raw = json.dumps(manifest, indent=2).encode() + b"\n"
        (self.root / "release-manifest.json").write_bytes(raw)
        self.digest = hashlib.sha256(raw).hexdigest()

    def assert_rejected(self, *, expected=None):
        with self.assertRaises((ValueError, OSError)):
            verify(self.root, expected or self.digest)

    def test_accepts_exact_snapshot(self):
        self.assertEqual(verify(self.root, self.digest)["fileCount"], 1)

    def test_rejects_manifest_digest_mismatch_without_rewriting(self):
        before = (self.root / "release-manifest.json").read_bytes()
        self.assert_rejected(expected="0" * 64)
        self.assertEqual((self.root / "release-manifest.json").read_bytes(), before)

    def test_rejects_modified_file_hash_or_size(self):
        self.file.write_text("tampered", encoding="utf-8")
        self.assert_rejected()

    def test_rejects_extra_file_and_directory(self):
        (self.root / "extra.txt").write_text("unexpected", encoding="utf-8")
        self.assert_rejected()

    def test_rejects_unsafe_paths(self):
        self.write_manifest([{"path": "../outside", "bytes": 1, "sha256": "0" * 64}])
        self.assert_rejected()

    def test_rejects_unsorted_or_duplicate_paths(self):
        entry = {"path": "src/app.txt", "bytes": 5, "sha256": hashlib.sha256(b"pilot").hexdigest()}
        self.write_manifest([entry, entry])
        self.assert_rejected()

    def test_rejects_unsorted_paths(self):
        entries = [
            {"path": "z.txt", "bytes": 0, "sha256": hashlib.sha256(b"").hexdigest()},
            {"path": "src/app.txt", "bytes": 5, "sha256": hashlib.sha256(b"pilot").hexdigest()},
        ]
        self.write_manifest(entries)
        self.assert_rejected()

    def test_rejects_symlink(self):
        target = Path(self.temp.name) / "outside.txt"
        target.write_text("external", encoding="utf-8")
        link = self.root / "src" / "linked.txt"
        try:
            link.symlink_to(target)
        except (OSError, NotImplementedError):
            self.skipTest("symlinks unavailable")
        self.assert_rejected()


if __name__ == "__main__":
    unittest.main()
