import importlib.util
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

BASE = Path(__file__).parents[1]
for name in ('crm_host', 'crm_rollout'):
    spec = importlib.util.spec_from_file_location(name, BASE / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
spec = importlib.util.spec_from_file_location('build_crm', BASE / 'build_crm.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
rollout = build.crm_rollout


class BuildOperationLockTests(unittest.TestCase):
    def test_build_body_runs_inside_shared_lock_and_lock_releases(self):
        with tempfile.TemporaryDirectory() as td:
            lock = Path(td) / 'parent-operation.lock'
            observed = []
            with patch.object(rollout, 'OP_LOCK', lock):
                def body():
                    for phase in ('build', 'cleanup', 'result-write'):
                        observed.append((phase, lock.is_file()))
                    return 7
                with patch.object(build, '_main', side_effect=body):
                    self.assertEqual(build.main(), 7)
            self.assertEqual(observed, [('build',True),('cleanup',True),('result-write',True)])
            self.assertFalse(lock.exists())

    def test_existing_shared_lock_refuses_before_build_body(self):
        with tempfile.TemporaryDirectory() as td:
            lock = Path(td) / 'parent-operation.lock'
            lock.write_text('held', encoding='utf-8')
            with patch.object(rollout, 'OP_LOCK', lock), patch.object(build, '_main') as body:
                with self.assertRaises(rollout.Refusal):
                    build.main()
            body.assert_not_called()

    def test_build_exception_releases_lock(self):
        with tempfile.TemporaryDirectory() as td:
            lock = Path(td) / 'parent-operation.lock'
            with patch.object(rollout, 'OP_LOCK', lock), patch.object(build, '_main', side_effect=RuntimeError('failed')):
                with self.assertRaisesRegex(RuntimeError, 'failed'):
                    build.main()
            self.assertFalse(lock.exists())


if __name__ == '__main__':
    unittest.main()
