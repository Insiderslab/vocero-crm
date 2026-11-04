import os
import tempfile
import unittest
from pathlib import Path

import sys
sys.path.insert(0, str(Path(__file__).parents[1]))
from release_lock import LockRefusal, ReleaseLock


class ReleaseLockTests(unittest.TestCase):
    def test_exclusive_and_release(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'release.lock'
            with ReleaseLock(path):
                self.assertTrue(path.exists())
                with self.assertRaises(LockRefusal):
                    ReleaseLock(path).acquire()
            self.assertFalse(path.exists())

    def test_stale_lock_is_never_cleared(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'release.lock'
            path.write_text('dead:stale:token', encoding='ascii')
            with self.assertRaises(LockRefusal):
                ReleaseLock(path).acquire()
            self.assertEqual(path.read_text(encoding='ascii'), 'dead:stale:token')

    @unittest.skipIf(os.name == 'nt', 'Windows does not permit replacing an open file by default')
    def test_replaced_inode_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'release.lock'
            lock = ReleaseLock(path).acquire()
            path.unlink()
            path.write_text('replacement\n', encoding='ascii')
            with self.assertRaises(LockRefusal):
                lock.release()
            self.assertEqual(path.read_text(encoding='ascii'), 'replacement\n')

    @unittest.skipUnless(hasattr(os, 'O_NOFOLLOW'), 'O_NOFOLLOW unavailable')
    def test_symlink_lock_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'target'
            target.write_text('owned', encoding='ascii')
            link = root / 'release.lock'
            link.symlink_to(target)
            with self.assertRaises(LockRefusal):
                ReleaseLock(link).acquire()
            self.assertEqual(target.read_text(encoding='ascii'), 'owned')


if __name__ == '__main__':
    unittest.main()
