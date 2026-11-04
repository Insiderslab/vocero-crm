import copy, hashlib, json, os, sys, tempfile, unittest
from contextlib import ExitStack
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

MARINE=Path(__file__).parents[1]
sys.path.insert(0,str(MARINE))
import crm_app_update as update

class SimpleLock:
    def assert_held(self): return None

class AppUpdateTests(unittest.TestCase):
    def op_fixture(self,root):
        opid=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+'a'*12
        d=Path(root)/opid; d.mkdir(mode=0o700)
        proof={'migrations':[{'id':1,'hash':'1'*64,'createdAt':'100'}],'schemaSha256':'2'*64}
        snapshot=self.safe_snapshot()
        baseline_raw=update.canonical(snapshot); update.write_exclusive(d/'baseline.json',baseline_raw)
        update.write_exclusive(d/'qa.json',b'{}')
        files=[{'path':str(p),'sha256':str(i)*64,'mode':0o600} for i,p in enumerate((update.BASE,update.PANELS,update.CRM),1)]
        op={'schemaVersion':1,'id':opid,'capturedAt':datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
            'candidate':{'path':'/opt/bambola-arm/releases/candidate','manifestSha256':'3'*64},
            'predecessor':{'path':str(update.R9),'manifestSha256':update.R9_MANIFEST,'imageId':update.R9_IMAGE,'migrationBundleSha256':'4'*64},
            'baselineSha256':update.sha(baseline_raw),'qaSha256':update.sha(b'{}'),'runtimeInputsSha256':'5'*64,
            'compose':{'project':update.PROJECT,'workdir':str(update.WORKDIR),'files':files,'gatewayConfig':{'path':str(update.GATEWAY_CONFIG),'sha256':'9'*64,'mode':0o444}}}
        op_raw=update.canonical(op); update.write_exclusive(d/'operation.json',op_raw)
        phase,head=update.append_phase(d,op,[],update.sha(op_raw),'captured',{})
        return d,op,[phase],head,snapshot

    def prepared_fixture(self,root,final='activating'):
        d,op,phases,head,baseline=self.op_fixture(root); image='sha256:'+'e'*64; bundle=op['predecessor']['migrationBundleSha256']
        log=b'private synthetic log'; update.write_exclusive(d/'build.log',log)
        result={'schemaVersion':1,'operationId':op['id'],'sourceManifestSha256':op['candidate']['manifestSha256'],'imageId':image,'sourceManifestLabel':op['candidate']['manifestSha256'],'migrationBundleSha256':bundle,'logSha256':update.sha(log),'exitCode':0}
        result_raw=update.canonical(result); update.write_exclusive(d/'build-result.json',result_raw)
        phase,head=update.append_phase(d,op,phases,head,'building',{}); phases.append(phase)
        payload={'imageId':image,'sourceManifestSha256':op['candidate']['manifestSha256'],'buildResultSha256':update.sha(result_raw),'migrationBundleSha256':bundle}
        phase,head=update.append_phase(d,op,phases,head,'built',payload); phases.append(phase)
        if final!='built':
            override=f'services:\n  app:\n    image: "{image}"\n'.encode(); update.write_exclusive(d/'candidate.override.yml',override,0o644)
            old_config={'services':{'app':{'image':update.R9_IMAGE}}}; new_config={'services':{'app':{'image':image}}}
            delta=update.sha(update.canonical({'before':old_config,'after':new_config}))
            phase,head=update.append_phase(d,op,phases,head,'prepared',{'candidateOverrideSha256':update.sha(override),'composeDeltaSha256':delta}); phases.append(phase)
        if final in ('activating','activated','rolling_back','rolled_back'):
            proof=baseline['metadataProof']; safe=copy.deepcopy(baseline); safe.pop('metadataProof'); pre={'snapshot':safe,'metadataProof':proof}; pre_raw=update.canonical(pre); update.write_exclusive(d/'pre-activation.json',pre_raw)
            phase,head=update.append_phase(d,op,phases,head,'activating',{'preflightSnapshotSha256':update.sha(pre_raw),'metadataProof':proof,'qaSha256':op['qaSha256']}); phases.append(phase)
        return d,op,phases,head,baseline,image

    def test_release_tree_guard_checks_nested_directory_modes_before_manifest(self):
        if os.name!='posix': self.skipTest('POSIX owner/mode checks require Linux QA')
        with tempfile.TemporaryDirectory(dir='/opt',prefix='crm-release-guard-') as td:
            root=Path(td); releases=root/'releases'; releases.mkdir(mode=0o700); release=releases/'candidate'; sub=release/'deploy'; sub.mkdir(parents=True,mode=0o700)
            source=sub/'safe.py'; source.write_bytes(b'pass\n'); source.chmod(0o600)
            candidate_dir=release/'deploy'/'marine'; candidate_dir.mkdir(mode=0o700)
            marker=root/'candidate-executed'
            candidate_code=(f"from pathlib import Path\nPath({str(marker)!r}).write_text('executed')\n").encode()
            candidate_script=candidate_dir/'manifest.py'; candidate_script.write_bytes(candidate_code); candidate_script.chmod(0o600)
            entries=[{'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in [('deploy/safe.py',b'pass\n'),('deploy/marine/manifest.py',candidate_code)]]
            entries.sort(key=lambda row:row['path'])
            manifest={'format':'heili-marine-release-source','version':1,'fileCount':len(entries),'files':entries}
            raw=json.dumps(manifest,sort_keys=True,separators=(',',':')).encode(); mp=release/'release-manifest.json'; mp.write_bytes(raw+b'\n'); mp.chmod(0o600)
            release.chmod(0o700); releases.chmod(0o700); root.chmod(0o700)
            with patch.object(update,'RELEASES',releases):
                self.assertEqual(update.verify_release(release,hashlib.sha256(raw+b'\n').hexdigest()),release)
                self.assertFalse(marker.exists(),'candidate-owned manifest.py must never execute')
                sub.chmod(0o775)
                with self.assertRaisesRegex(update.Refusal,'directory'):
                    update.verify_release(release,hashlib.sha256(raw+b'\n').hexdigest())
                sub.chmod(0o700)
                (release/'evil-link').symlink_to('/tmp',target_is_directory=True)
                with self.assertRaisesRegex(update.Refusal,'symlink'):
                    update.verify_release(release,hashlib.sha256(raw+b'\n').hexdigest())
                (release/'evil-link').unlink()
                source.chmod(0o666)
                with self.assertRaisesRegex(update.Refusal,'file owner or mode'):
                    update.verify_release(release,hashlib.sha256(raw+b'\n').hexdigest())
                source.chmod(0o600)
                os.chown(source,65534,65534)
                with self.assertRaisesRegex(update.Refusal,'file owner or mode'):
                    update.verify_release(release,hashlib.sha256(raw+b'\n').hexdigest())

    def test_gateway_pin_and_compose_mount_are_fixed_and_read_only(self):
        rendered={'services':{'app':{'image':update.R9_IMAGE},'gateway':{'image':'sha256:'+'b'*64,'volumes':[{'source':str(update.GATEWAY_CONFIG),'target':'/etc/caddy/Caddyfile','read_only':True}]}},'networks':{}}
        with patch.object(update.crm_host,'current_snapshot_fields',return_value=self.safe_snapshot()):
            import crm_rollout
            with patch.object(crm_rollout,'validate_network_safety'):
                update.validate_original_compose(rendered,self.safe_snapshot())
                rendered['services']['gateway']['volumes'][0]['source']='/opt/bambola-arm/runtime/gateway.Caddyfile'
                with self.assertRaises(update.Refusal): update.validate_original_compose(rendered,self.safe_snapshot())
        with tempfile.TemporaryDirectory() as td:
            d,op,phases,head,baseline=self.op_fixture(td); op['compose']['gatewayConfig']['sha256']='0'*64
            raw=update.canonical(op); (d/'operation.json').write_bytes(raw)
            with self.assertRaises(update.Refusal): update.validate_chain(d)

    def test_wrong_r9_image_identity_is_refused(self):
        snapshot=self.safe_snapshot(); snapshot['ownedAppGateway']['app']['imageId']='sha256:'+'f'*64
        with self.assertRaises(update.Refusal): update.verify_current_r9(snapshot)

    def test_static_env_file_and_nondefault_docker_context_refuse(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); paths=[root/'base.yml',root/'panels.yml',root/'crm.yml',root/'runtime.env',root/'gateway.Caddyfile']
            for p in paths: p.write_text('services: {}\n',encoding='utf-8')
            paths[4].chmod(0o444)
            (paths[0]).write_text('services:\n  app:\n    env_file: /tmp/secret\n',encoding='utf-8')
            with patch.object(update,'os',SimpleNamespace(name='posix')),patch.object(update,'BASE',paths[0]),patch.object(update,'PANELS',paths[1]),patch.object(update,'CRM',paths[2]),patch.object(update,'ENV',paths[3]),patch.object(update,'GATEWAY_CONFIG',paths[4]),patch.object(update,'_check_ancestors'),patch.object(update,'path_identity',return_value={'path':'fixed','sha256':'0'*64,'mode':0o600}),patch.object(update,'run') as run:
                with self.assertRaisesRegex(update.Refusal,'env files'): update.verify_host_execution_boundary()
                run.assert_not_called()
                paths[0].write_text('services: {}\n',encoding='utf-8')
                run.side_effect=['remote','']
                with self.assertRaisesRegex(update.Refusal,'context'): update.verify_host_execution_boundary()

    def test_compose_labels_reject_arbitrary_or_candidate_file_chains(self):
        labels=[{'com.docker.compose.project':update.PROJECT,'com.docker.compose.service':name,'com.docker.compose.project.working_dir':str(update.WORKDIR),'com.docker.compose.project.config_files':str(update.BASE)+','+str(update.PANELS)+','+str(update.CRM)} for name in ('app','gateway')]
        with patch.object(update,'run',return_value='\n'.join(json.dumps(x) for x in labels)):
            update.verify_compose_labels()
        labels[1]['com.docker.compose.project.config_files']='/tmp/arbitrary.yml'
        with patch.object(update,'run',return_value='\n'.join(json.dumps(x) for x in labels)):
            with self.assertRaises(update.Refusal): update.verify_compose_labels()

    def test_phase_replay_and_existing_override_are_refused(self):
        with tempfile.TemporaryDirectory() as td:
            d,op,phases,head,baseline=self.op_fixture(td)
            phase=json.loads((d/'0001-captured.json').read_bytes()); phase['sequence']=2; (d/'0001-captured.json').write_bytes(update.canonical(phase))
            with self.assertRaises(update.Refusal): update.validate_chain(d)
        with tempfile.TemporaryDirectory() as td:
            d,op,phases,head,baseline,image=self.prepared_fixture(td,final='built')
            override=d/'candidate.override.yml'; override.write_bytes(b'services: {}\n')
            with patch.object(update,'OPS',Path(td)),patch.object(update,'verify_pinned_inputs'),patch.object(update,'_verify_manifest_and_qa',return_value=(Path('/candidate'),{})),patch.object(update,'current_baseline',return_value=baseline),patch.object(update,'run') as command:
                with self.assertRaises(update.Refusal): update._prepare(op['id'])
            self.assertFalse(any(call.args and call.args[0][1:2]==['compose'] for call in command.call_args_list))

    def test_main_refuses_concurrent_lock_before_phase_work(self):
        with patch.object(update,'lock_context',side_effect=update.LockRefusal('held')),patch('builtins.print'):
            self.assertEqual(update.main(['build','--operation-id','20261104T000000Z-'+'a'*12]),2)

    def test_canonical_chain_roundtrip_and_tamper_refusal(self):
        with tempfile.TemporaryDirectory() as td:
            d,op,phases,head,baseline=self.op_fixture(td)
            self.assertEqual(update.canonical(json.loads((d/'operation.json').read_bytes())),(d/'operation.json').read_bytes())
            loaded,chain,digest=update.validate_chain(d)
            self.assertEqual(loaded,op); self.assertEqual(chain[0]['phase'],'captured'); self.assertEqual(digest,head)
            phase=d/'0001-captured.json'; data=json.loads(phase.read_bytes()); data['payload']['extra']='tampered'; phase.write_bytes(update.canonical(data))
            with self.assertRaises(update.Refusal): update.validate_chain(d)

    def test_canonical_bytes_and_exclusive_file_fsync(self):
        with tempfile.TemporaryDirectory() as td:
            p=Path(td)/'intent.json'; value={'z':'é','a':1}
            update.write_exclusive(p,update.canonical(value))
            self.assertEqual(p.read_bytes(),b'{"a":1,"z":"\\u00e9"}\n')
            with self.assertRaises(FileExistsError): update.write_exclusive(p,b'{}')

    def test_compose_argv_has_only_three_pinned_files_and_app_override(self):
        op={'compose':{'workdir':str(update.WORKDIR),'files':[{'path':str(p)} for p in (update.BASE,update.PANELS,update.CRM)]}}
        args=update.compose_prefix(op,(Path('/private/op/candidate.override.yml'),))
        self.assertEqual(args,['docker','compose','--project-name',update.PROJECT,'--project-directory',str(update.WORKDIR),'--env-file',str(update.ENV),'-f',str(update.BASE),'-f',str(update.PANELS),'-f',str(update.CRM),'-f',str(Path('/private/op/candidate.override.yml'))])
        apply=args+['up','-d','--no-deps','--no-build','--wait','--wait-timeout','180','app']
        self.assertEqual(apply[-1],'app'); self.assertNotIn('gateway',apply); self.assertNotIn('db',apply)

    def test_subprocess_environment_drops_docker_and_proxy_overrides(self):
        with patch.dict(os.environ,{'PATH':'/bin','DOCKER_HOST':'tcp://evil','DOCKER_CONTEXT':'remote','COMPOSE_FILE':'/tmp/x','HTTPS_PROXY':'http://proxy','SECRET_SENTINEL':'secret'},clear=True):
            env=update.compose_env()
        self.assertEqual(env['PATH'],'/bin'); self.assertEqual(env['HOME'],'/root')
        for key in ('DOCKER_HOST','DOCKER_CONTEXT','COMPOSE_FILE','HTTPS_PROXY','SECRET_SENTINEL'): self.assertNotIn(key,env)

    def test_app_environment_comparison_is_in_memory_and_redacts_failure(self):
        secret='SYNTHETIC_SECRET_SENTINEL'; rendered={'services':{'app':{'environment':{'NODE_ENV':'production','DATABASE_URL':secret}}}}
        with patch.object(update,'run',side_effect=[json.dumps(['NODE_ENV=production']),json.dumps(['NODE_ENV=production','DATABASE_URL='+secret])]):
            update.verify_app_environment(rendered,'sha256:'+'a'*64)
        with patch.object(update,'run',side_effect=[json.dumps(['NODE_ENV=production']),json.dumps(['NODE_ENV=production','DATABASE_URL=wrong'])]):
            with self.assertRaises(update.Refusal) as caught: update.verify_app_environment(rendered,'sha256:'+'a'*64)
        self.assertNotIn(secret,str(caught.exception)); self.assertNotIn(secret,str(caught.exception.__cause__))

    def test_qa_schema_projection_and_duplicate_scenario_refusal(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); path=root/update.QA_REL; path.parent.mkdir(parents=True)
            manifest={p:'6'*64 for p in sorted(update.UI)}
            manifest['src/app.ts']='7'*64
            q={'version':1,'status':'passed','baselineManifestSha256':update.R9_MANIFEST,
               'overlay':[{'path':p,'sha256':manifest[p]} for p in sorted(update.UI)],
               'unchangedRuntimeInputsSha256':update.sha(update.canonical({'src/app.ts':'7'*64})),
               'buildId':'synthetic-build','scenarios':[{'name':n,'status':'pass'} for n in sorted(update.SCENARIOS)],
               'sourceReportSha256':'8'*64,'capturedAt':datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
            raw=update.canonical(q); path.write_bytes(raw); manifest[update.QA_REL.as_posix()]=update.sha(raw)
            accepted,copy_bytes,runtime=update.qa_validate(root,update.sha(raw),manifest)
            self.assertEqual(copy_bytes,raw); self.assertEqual(runtime,q['unchangedRuntimeInputsSha256'])
            q['scenarios'][-1]=q['scenarios'][0]; raw=update.canonical(q); path.write_bytes(raw); manifest[update.QA_REL.as_posix()]=update.sha(raw)
            with self.assertRaises(update.Refusal): update.qa_validate(root,update.sha(raw),manifest)

    def test_migration_hash_preserves_crlf_bytes(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); (root/'drizzle/meta').mkdir(parents=True); (root/'drizzle/0001_init.sql').write_bytes(b'CREATE TABLE x (id int);\r\n')
            (root/'drizzle/meta/_journal.json').write_text(json.dumps({'entries':[{'tag':'0001_init','when':123}]}),encoding='utf-8')
            expected=update.expected_migrations(root)
            self.assertEqual(expected,[(123,hashlib.sha256(b'CREATE TABLE x (id int);\r\n').hexdigest())])
            proof={'migrations':[{'id':1,'hash':expected[0][1],'createdAt':'123'}]}
            update.verify_migration_set(proof,root)
            proof['migrations'][0]['hash']='9'*64
            with self.assertRaises(update.Refusal): update.verify_migration_set(proof,root)

    def safe_snapshot(self):
        app={'name':update.APP,'id':'a'*64,'imageId':update.R9_IMAGE,'configuredImage':update.R9_IMAGE,'startedAt':'t','restartCount':0,'running':True,'health':'healthy','ports':{},'networks':{'edge':{'aliases':['app']}},'runtime':{'mounts':[]}}
        gateway={'name':'bambola-arm-gateway-1','id':'b'*64,'imageId':'sha256:'+'b'*64,'configuredImage':'sha256:'+'b'*64,'startedAt':'t','restartCount':0,'running':True,'health':'healthy','ports':{},'networks':{'edge':{'aliases':['gateway']}},'runtime':{'mounts':[]}}
        caddy={'name':update.CADDY_NAME,'id':'c'*64,'imageId':'sha256:'+'c'*64,'configuredImage':'sha256:'+'c'*64,'startedAt':'t','restartCount':0,'running':True,'health':'healthy','ports':{},'networks':{'edge':{'aliases':['caddy']}},'runtime':{'mounts':[]}}
        hair={'name':'hair-app-1','id':'d'*64,'imageId':'sha256:'+'d'*64,'configuredImage':'sha256:'+'d'*64,'startedAt':'t','restartCount':0,'running':True,'health':'healthy','ports':{},'networks':{'hair':{'aliases':['hair']}},'runtime':{'mounts':[]}}
        proof={'migrations':[{'id':1,'hash':'1'*64,'createdAt':'1'}],'schemaSha256':'2'*64}
        networks=[{'id':'edge-id','name':'edge','driver':'bridge','scope':'local','internal':False,'enableIPv6':False,'ipam':{},'containers':{'a'*64:{'name':update.APP},'b'*64:{'name':'bambola-arm-gateway-1'},'c'*64:{'name':update.CADDY_NAME}}},{'id':'hair-id','name':'hair','driver':'bridge','scope':'local','internal':False,'enableIPv6':False,'ipam':{},'containers':{'d'*64:{'name':'hair-app-1'}}}]
        route={'status':200,'tlsVerified':True,'location':None}
        return {'caddy':{'container':caddy,'config':{'path':'/opt/caddy','inode':1,'sha256':'3'*64}},'containers':[app,gateway,caddy,hair],
            'ownedAppGateway':{'app':app,'gateway':gateway},'networks':networks,
            'configFiles':{'compose':{},'pinnedBaseCompose':{},'gatewayTemplate':{},'runtimeGateway':{},'runtimeOverride':{},'runtimeEnv':{}},
            'routes':{url:[route] for url in __import__('crm_host').ROUTES},'resources':{'memAvailableKiB':1024*1024,'optFreeKiB':20*1024*1024},'metadataProof':proof}

    def test_app_only_comparison_rejects_gateway_runtime_and_route_drift(self):
        baseline=self.safe_snapshot(); candidate=json.loads(json.dumps(baseline)); app=candidate['ownedAppGateway']['app']
        app['imageId']='sha256:'+'e'*64; app['configuredImage']=app['imageId']; app['id']='e'*64
        candidate['containers'][0]=app
        update.verify_app_only_result(baseline,candidate,app['imageId'])
        candidate['ownedAppGateway']['gateway']['runtime']['changed']=True
        with self.assertRaises(update.Refusal): update.verify_app_only_result(baseline,candidate,app['imageId'])

    def test_rollback_boundary_allows_unrelated_restart_but_blocks_relevant_network(self):
        baseline=self.safe_snapshot(); current=json.loads(json.dumps(baseline)); hair=current['containers'][3]
        hair['id']='f'*64; hair['startedAt']='new'; hair['restartCount']=1; hair['networks']['hair']['aliases']=['hair']
        current['networks'][1]['containers']={'f'*64:{'name':'hair-app-1'}}
        self.assertEqual(update.verify_rollback_boundary(baseline,current),['other-container-drift'])
        current['networks'][0]['id']='changed-edge'
        with self.assertRaises(update.Refusal): update.verify_rollback_boundary(baseline,current)

    def test_real_sanitized_crm_host_snapshot_matches_projection(self):
        path=Path(r'C:\Users\stefa\bambola-runtime\agenda-release-validation\current-safe-snapshot.json')
        if not path.exists(): self.skipTest('Parent sanitized snapshot unavailable')
        snapshot=json.loads(path.read_text(encoding='utf-8-sig'))
        update.validate_safe_snapshot(snapshot,False)

    def test_status_uses_only_fixed_app_inspect_and_lock_presence(self):
        with tempfile.TemporaryDirectory() as td:
            d,op,phases,head,baseline=self.op_fixture(td)
            with patch.object(update,'OPS',Path(td)),patch.object(update,'load',return_value=(d,op,phases,head,baseline)),patch.object(update,'validate_chain',return_value=(op,phases,head)),patch.object(update,'inspect_app_health',return_value=('a'*64,update.R9_IMAGE,update.R9_IMAGE,True,'healthy')),patch('builtins.print') as out:
                update._status(op['id'])
            payload=json.loads(out.call_args.args[0]); self.assertEqual(payload['appHealth'],'healthy'); self.assertEqual(payload['lockPresent'],False)

    def test_unknown_app_identity_refuses_rollback_without_compose_mutation(self):
        with tempfile.TemporaryDirectory() as td:
            d,op,phases,head,baseline,image=self.prepared_fixture(td)
            current=copy.deepcopy(baseline); app=current['ownedAppGateway']['app']; app['imageId']='sha256:'+'f'*64; app['configuredImage']=app['imageId']; current['containers'][0]=app
            with patch.object(update,'OPS',Path(td)),patch.object(update,'verify_pinned_inputs'),patch.object(update,'verify_compose_labels'),patch.object(update,'current_baseline',return_value=current),patch.object(update.subprocess,'run') as mutate:
                with self.assertRaises(update.Refusal): update._rollback(op['id'])
            mutate.assert_not_called()

    def test_noop_rollback_polls_only_fixed_r9_app_and_never_runs_compose(self):
        with tempfile.TemporaryDirectory() as td:
            d,op,phases,head,baseline,image=self.prepared_fixture(td)
            safe=copy.deepcopy(baseline); safe.pop('metadataProof')
            with patch.object(update,'OPS',Path(td)),patch.object(update,'verify_pinned_inputs'),patch.object(update,'verify_compose_labels'),patch.object(update,'verify_app_environment'),patch.object(update,'current_baseline',side_effect=[safe,safe]),patch.object(update,'verify_migration_set'),patch.object(update,'metadata_proof',return_value=baseline['metadataProof']),patch.object(update,'run') as run,patch.object(update.subprocess,'run') as mutate:
                def fixed_run(args,**kwargs):
                    if args[-3:]==['config','--format','json']: return json.dumps({'services':{'app':{'image':update.R9_IMAGE}}})
                    if args[:3]==['docker','image','inspect']: return update.R9_IMAGE+'\n'
                    return 'a'*64+'|'+update.R9_IMAGE+'|'+update.R9_IMAGE+'|true|healthy'
                run.side_effect=fixed_run
                update._rollback(op['id'])
            mutate.assert_not_called()
            self.assertEqual(run.call_args_list[-1].args[0][:3],['docker','inspect','--format'])
            self.assertEqual(update.validate_chain(d)[1][-1]['payload']['noOp'],True)

    def test_activation_timeout_keeps_intent_and_never_records_activated(self):
        with tempfile.TemporaryDirectory() as td:
            d,op,phases,head,baseline,image=self.prepared_fixture(td,final='prepared')
            safe=copy.deepcopy(baseline); safe.pop('metadataProof')
            proof=baseline['metadataProof']; old={'services':{'app':{'image':update.R9_IMAGE}}}; new={'services':{'app':{'image':image}}}
            calls={'render':0}
            def fake_run(args,**kwargs):
                calls['render']+=1
                return json.dumps(new if str(d/'candidate.override.yml') in args else old)
            with patch.object(update,'OPS',Path(td)),patch.object(update,'verify_pinned_inputs'),patch.object(update,'_verify_manifest_and_qa',return_value=(Path('/candidate'),{})),patch.object(update,'verify_build_guard'),patch.object(update,'current_baseline',side_effect=[safe,safe]),patch.object(update,'metadata_proof',return_value=proof),patch.object(update,'verify_migration_set'),patch.object(update,'migration_bundle_hash',return_value=op['predecessor']['migrationBundleSha256']),patch.object(update,'run',side_effect=fake_run),patch.object(update,'verify_app_environment'),patch.object(update,'verify_compose_labels'),patch.object(update.subprocess,'run',side_effect=__import__('subprocess').TimeoutExpired(['docker','compose'],210)):
                with self.assertRaises(__import__('subprocess').TimeoutExpired): update._activate(op['id'])
            chain=update.validate_chain(d)[1]
            self.assertEqual(chain[-1]['phase'],'activating')
            self.assertFalse((d/'0006-activated.json').exists())

    def test_stale_qa_refusal_happens_before_prepare_or_apply(self):
        with tempfile.TemporaryDirectory() as td:
            d,op,phases,head,baseline,image=self.prepared_fixture(td,final='built')
            with patch.object(update,'OPS',Path(td)),patch.object(update,'verify_pinned_inputs'),patch.object(update,'_verify_manifest_and_qa',side_effect=update.Refusal('stale QA')),patch.object(update,'run') as command:
                with self.assertRaisesRegex(update.Refusal,'stale QA'): update._prepare(op['id'])
            command.assert_not_called(); self.assertFalse((d/'candidate.override.yml').exists())

    def test_old_capture_is_refused_for_forward_work(self):
        with tempfile.TemporaryDirectory() as td:
            d,op,phases,head,baseline,image=self.prepared_fixture(td,final='built')
            op['capturedAt']='2026-10-01T00:00:00Z'
            with self.assertRaisesRegex(update.Refusal,'older than 24 hours'):
                update._verify_manifest_and_qa(op,d)

    def test_capture_build_prepare_activate_mocked_happy_path_app_only(self):
        with tempfile.TemporaryDirectory() as td:
            root=Path(td); releases=root/'releases'; releases.mkdir(); candidate=releases/'agenda'; r9=releases/'r9'
            for rel in (candidate,r9): (rel/'deploy/marine').mkdir(parents=True); (rel/'src/components/marine').mkdir(parents=True); (rel/'scripts').mkdir()
            common={'package.json':b'{"scripts":{"build":"next build"}}','pnpm-lock.yaml':b'lock','deploy/marine/Dockerfile':b'RUN pnpm build\nRUN pnpm exec esbuild scripts/migrate.mjs --bundle',
                    'deploy/marine/compose.ubuntu.yml':b'compose','scripts/migrate.mjs':b'export const migration = true;','src/app.ts':b'export const app=true;','.env.example':b'PLACEHOLDER'}
            for rel in (candidate,r9):
                for name,data in common.items(): p=rel/name; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(data)
            old_ui={'src/components/marine/admin-panels.tsx':b'old-admin','src/components/marine/marine-app.tsx':b'old-app'}
            new_ui={'src/components/marine/admin-panels.tsx':b'new-admin','src/components/marine/marine-app.tsx':b'new-app'}
            for name,data in old_ui.items(): (r9/name).write_bytes(data)
            for name,data in new_ui.items(): (candidate/name).write_bytes(data)
            ops={name:b'operational helper' for name in update.OPS_ALLOW if name!=update.QA_REL.as_posix()}
            for name,data in ops.items(): p=candidate/name; p.parent.mkdir(parents=True,exist_ok=True); p.write_bytes(data)
            image='sha256:'+'e'*64; proof={'migrations':[{'id':1,'hash':'1'*64,'createdAt':'100'}],'schemaSha256':'2'*64}; bundle='4'*64
            def write_manifest(rel,entries):
                rows=[{'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in sorted(entries.items())]
                raw=json.dumps({'format':'heili-marine-release-source','version':1,'fileCount':len(rows),'files':rows},sort_keys=True,separators=(',',':')).encode()
                (rel/'release-manifest.json').write_bytes(raw); return hashlib.sha256(raw).hexdigest(),{x['path']:x['sha256'] for x in rows}
            old_entries={**common,**old_ui}; new_entries={**common,**new_ui,**ops}
            r9_hash,r9_map=write_manifest(r9,old_entries)
            runtime_projection={k:hashlib.sha256(v).hexdigest() for k,v in new_entries.items() if k not in update.UI|update.OPS_ALLOW|{'.env.example'}}
            q={'version':1,'status':'passed','baselineManifestSha256':r9_hash,
               'overlay':[{'path':p,'sha256':hashlib.sha256(new_ui[p]).hexdigest()} for p in sorted(update.UI)],
               'unchangedRuntimeInputsSha256':update.sha(update.canonical(runtime_projection)),'buildId':'mock-build',
               'scenarios':[{'name':n,'status':'pass'} for n in sorted(update.SCENARIOS)],'sourceReportSha256':'8'*64,
               'capturedAt':datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}
            qraw=update.canonical(q); (candidate/update.QA_REL).parent.mkdir(parents=True,exist_ok=True); (candidate/update.QA_REL).write_bytes(qraw); new_entries[update.QA_REL.as_posix()]=qraw
            candidate_hash,candidate_map=write_manifest(candidate,new_entries)
            compose_files=[root/'base.yml',root/'panels.yml',root/'crm.yml']
            for path in (*compose_files,root/'runtime.env',root/'gateway-crm-ef7bcab49494.Caddyfile'): path.write_text('fixed fixture',encoding='utf-8')
            (root/'gateway-crm-ef7bcab49494.Caddyfile').chmod(0o444)
            baseline=self.safe_snapshot(); baseline.pop('metadataProof'); baseline['configFiles']={'compose':{},'pinnedBaseCompose':{},'gatewayTemplate':{},'runtimeGateway':{'path':str(root/'gateway.Caddyfile'),'sha256':'9'*64},'runtimeOverride':{},'runtimeEnv':{'path':str(root/'runtime.env'),'sha256':hashlib.sha256(b'fixed fixture').hexdigest()}}
            old_render={'services':{'app':{'image':update.R9_IMAGE,'networks':{'bambola_edge':{},'bambola_data':{}}},'gateway':{'image':'sha256:'+'b'*64,'networks':{'bambola_edge':{},'second-brain_frontend':{}},'volumes':[{'target':'/etc/caddy/Caddyfile','source':str(root/'gateway-crm-ef7bcab49494.Caddyfile'),'read_only':True}]},'postgres':{'image':'sha256:'+'c'*64,'networks':{'bambola_data':{}}}},'networks':{'bambola_edge':{'internal':True},'bambola_data':{'internal':True},'second-brain_frontend':{'external':True}}}
            candidate_render=copy.deepcopy(old_render); candidate_render['services']['app']['image']=image
            with ExitStack() as stack:
                for item in (patch.object(update,'RELEASES',releases),patch.object(update,'R9',r9),patch.object(update,'R9_MANIFEST',r9_hash),patch.object(update,'OPS',root/'operations'),
                    patch.object(update,'BASE',compose_files[0]),patch.object(update,'PANELS',compose_files[1]),patch.object(update,'CRM',compose_files[2]),patch.object(update,'ENV',root/'runtime.env'),patch.object(update,'GATEWAY_CONFIG',root/'gateway-crm-ef7bcab49494.Caddyfile'),
                    patch.object(update,'_check_ancestors'),patch.object(update,'verify_host_execution_boundary'),patch.object(update,'verify_compose_labels'),patch.object(update.crm_host,'_manifest_release'),
                    patch.object(update,'current_baseline',return_value=baseline),patch.object(update,'metadata_proof',return_value=proof),patch.object(update,'verify_migration_set'),patch.object(update,'migration_bundle_hash',return_value=bundle),patch.object(update,'verify_app_environment'),
                    patch.object(update,'path_identity',side_effect=lambda p,**kw:{'path':str(p),'sha256':hashlib.sha256(Path(p).read_bytes()).hexdigest(),'mode':(kw.get('mode',(0o600,))[0] if kw.get('mode') else 0o600)})):
                    stack.enter_context(item)
                run=stack.enter_context(patch.object(update,'run'))
                printed=stack.enter_context(patch('builtins.print'))
                run.side_effect=lambda args,**kw: (update.R9_IMAGE+'\n') if args[:3]==['docker','image','inspect'] else json.dumps(candidate_render if str(candidate/'candidate.override.yml') in args else old_render)
                update.capture(candidate,candidate_hash,update.sha(qraw))
                opid=printed.call_args.args[0]; operation_dir=root/'operations'/opid
                record={'schemaVersion':1,'operationId':opid,'sourceManifestSha256':candidate_hash,'imageId':image,'sourceManifestLabel':candidate_hash,'migrationBundleSha256':bundle,'logSha256':'0'*64,'exitCode':0}
                def fake_build(release,manifest,operation_id,evidence,guard,**kwargs):
                    update.write_exclusive(evidence/'build.log',b'mock log')
                    record['logSha256']=update.sha(b'mock log')
                    update.write_exclusive(evidence/'build-result.json',update.canonical(record))
                    return record
                with patch.object(update,'load_trusted_builder',return_value=type('Builder',(),{'build_update':staticmethod(fake_build)})()),patch.object(update,'verify_pinned_inputs'),patch.object(update,'_verify_manifest_and_qa',return_value=(candidate,candidate_map)),patch.object(update,'verify_build_guard'),patch.object(update,'current_baseline',return_value=baseline):
                    update._build(opid,SimpleLock())
                built_snapshot=list(update.validate_chain(operation_dir)[1])
                run.side_effect=lambda args,**kw: (image+' '+candidate_hash) if args[:3]==['docker','image','inspect'] else json.dumps(candidate_render if str(operation_dir/'candidate.override.yml') in args else old_render)
                with patch.object(update,'verify_pinned_inputs'),patch.object(update,'_verify_manifest_and_qa',return_value=(candidate,candidate_map)),patch.object(update,'verify_build_guard'),patch.object(update,'current_baseline',return_value=baseline):
                    update._prepare(opid)
                candidate_state=copy.deepcopy(baseline); app=candidate_state['ownedAppGateway']['app']; app['imageId']=image; app['configuredImage']=image; app['id']='e'*64; candidate_state['containers'][0]=app
                command_seen=[]
                def compose_apply(args,**kwargs):
                    self.assertEqual(args[-1],'app'); self.assertIn('--wait',args); self.assertIn('--no-build',args); command_seen.append(args)
                    self.assertEqual(update.validate_chain(operation_dir)[1][-1]['phase'],'activating')
                snapshots=[baseline,baseline,candidate_state]
                with patch.object(update,'verify_pinned_inputs'),patch.object(update,'_verify_manifest_and_qa',return_value=(candidate,candidate_map)),patch.object(update,'verify_build_guard'),patch.object(update,'verify_app_only_result'),patch.object(update,'verify_compose_labels'),patch.object(update,'current_baseline',side_effect=snapshots),patch.object(update,'metadata_proof',return_value=proof),patch.object(update,'verify_migration_set'),patch.object(update,'migration_bundle_hash',return_value=bundle),patch.object(update.subprocess,'run',side_effect=compose_apply):
                    update._activate(opid)
                self.assertEqual(len(command_seen),1)
                self.assertEqual(update.validate_chain(operation_dir)[1][-1]['phase'],'activated')
                restored=copy.deepcopy(baseline); old_app=restored['ownedAppGateway']['app']; old_app['id']='f'*64; old_app['imageId']=update.R9_IMAGE; old_app['configuredImage']=update.R9_IMAGE; restored['containers'][0]=old_app
                run.side_effect=lambda args,**kw: (json.dumps(candidate_render) if str(operation_dir/'candidate.override.yml') in args else json.dumps(old_render)) if args[-3:]==['config','--format','json'] else (update.R9_IMAGE+'\n' if args[:3]==['docker','image','inspect'] else ('f'*64+'|'+update.R9_IMAGE+'|'+update.R9_IMAGE+'|true|healthy'))
                rollback_commands=[]
                def rollback_apply(args,**kwargs):
                    self.assertEqual(args[-1],'app'); self.assertIn('--wait',args); self.assertNotIn('gateway',args); rollback_commands.append(args)
                    self.assertEqual(update.validate_chain(operation_dir)[1][-1]['phase'],'rolling_back')
                with patch.object(update,'verify_pinned_inputs'),patch.object(update,'verify_compose_labels'),patch.object(update,'verify_app_environment'),patch.object(update,'current_baseline',side_effect=[candidate_state,restored]),patch.object(update,'verify_migration_set'),patch.object(update,'metadata_proof',return_value=proof),patch.object(update.subprocess,'run',side_effect=rollback_apply):
                    update._rollback(opid)
                self.assertEqual(len(rollback_commands),1)
                self.assertEqual(update.validate_chain(operation_dir)[1][-1]['phase'],'rolled_back')

if __name__=='__main__': unittest.main(verbosity=2)
