import importlib.util
import hashlib
import json
import os
import stat
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
    def test_private_build_log_ignores_process_umask(self):
        with tempfile.TemporaryDirectory() as td:
            path=Path(td)/'build.log'
            old=os.umask(0)
            try:
                with build.private_log(path) as stream: stream.write(b'private')
            finally:
                os.umask(old)
            if os.name=='posix': self.assertEqual(stat.S_IMODE(path.stat().st_mode),0o600)
            self.assertEqual(path.read_bytes(),b'private')

    def test_legacy_failure_and_guard_records_keep_json_contract(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as td:
            log=Path(td)/'build.log'; log.write_bytes(b'failed log')
            failed=build.legacy_result_record('1'*64,'2'*64,'bambola-arm:abc',None,None,False,log,SimpleNamespace(returncode=17),None)
            self.assertEqual(failed['exitCode'],17); self.assertIsNone(failed['stoppedByGuard']); self.assertFalse(failed['passed'])
            guarded=build.legacy_result_record('1'*64,'2'*64,'bambola-arm:abc',None,None,False,log,SimpleNamespace(returncode=0),'baseline drift')
            self.assertEqual(guarded['stoppedByGuard'],'baseline drift'); self.assertFalse(guarded['passed'])

    def test_build_update_persists_legacy_failed_result_before_raising(self):
        from types import SimpleNamespace
        digest='c'*64; operation='20261104T120000Z-'+'a'*12; builder_id='b'*64
        for mode in ('exit17','guard-after-build'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as td:
                root=Path(td); releases=root/'releases'; release=releases/'candidate'; marine=release/'deploy'/'marine'; marine.mkdir(parents=True)
                dockerfile=marine/'Dockerfile'; dockerfile.write_bytes(b'FROM scratch\n'); dockerfile.chmod(0o644)
                row={'path':'deploy/marine/Dockerfile','bytes':len(dockerfile.read_bytes()),'sha256':hashlib.sha256(dockerfile.read_bytes()).hexdigest()}
                manifest={'format':'heili-marine-release-source','version':1,'fileCount':1,'files':[row]}
                raw=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode()+b'\n'; (release/'release-manifest.json').write_bytes(raw); (release/'release-manifest.json').chmod(0o600)
                evidence=root/'evidence'; evidence.mkdir(mode=0o700); evidence.chmod(0o700)
                calls={'guard':0,'build':0}
                def guard():
                    calls['guard']+=1
                    if mode=='guard-after-build' and calls['build'] and calls['guard']==4: raise RuntimeError('synthetic baseline drift')
                def run(args,**kwargs): return SimpleNamespace(returncode=0)
                def output(args,**kwargs):
                    if args[1:3]==['ps','--filter']: return 'buildx_buildkit_bambola-arm-builder0\n'
                    if args[1:3]==['inspect','--format']: return builder_id+'\n'
                    if args[1:3]==['ps','-aq']: return ''
                    raise AssertionError('unexpected Docker output command: '+repr(args))
                def docker_run(args,**kwargs):
                    if 'buildx' in args and 'build' in args:
                        calls['build']+=1
                        return SimpleNamespace(returncode=17 if mode=='exit17' else 0)
                    raise AssertionError('unexpected Docker mutator: '+repr(args))
                with patch.object(build,'ROOT',root),patch.object(build,'run',side_effect=run),patch.object(build,'output',side_effect=output),patch.object(build.subprocess,'run',side_effect=docker_run),patch.object(build,'_isolated_bundle_hash',side_effect=AssertionError('legacy build must not run bundle proof')):
                    with self.assertRaisesRegex(RuntimeError,'Docker build failed|host baseline/resource guard failed'):
                        build.build_update(release,hashlib.sha256(raw).hexdigest(),operation,evidence,guard,
                                           image_tag='bambola-arm:legacy-test',legacy_snapshot_sha=digest,
                                           lock_handle=SimpleNamespace(assert_held=lambda:None))
                result_path=evidence/'build-result.json'
                self.assertTrue(result_path.is_file())
                record=json.loads(result_path.read_text(encoding='utf-8'))
                self.assertFalse(record['passed'])
                self.assertEqual(record['exitCode'],17 if mode=='exit17' else 0)
                self.assertEqual(record['stoppedByGuard'],'host baseline/resource guard failed' if mode=='guard-after-build' else None)
                self.assertEqual(record['hostSnapshotSha256'],digest)
                self.assertEqual(calls['build'],1)

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
