#!/usr/bin/env python3
"""Bounded, app-only r9 agenda update workflow."""
from __future__ import annotations
import argparse, copy, hashlib, importlib.util, json, os, re, secrets, stat, subprocess, sys, time
from datetime import datetime, timezone
from pathlib import Path
import crm_host
from release_lock import ReleaseLock, LockRefusal

ROOT=Path('/opt/bambola-arm'); RELEASES=ROOT/'releases'; OPS=ROOT/'evidence/agenda-app-update'
LOCK=ROOT/'evidence/crm-recovery-operation.lock'; APP='bambola-arm-app-1'; CADDY_NAME='second-brain-caddy-1'; PROJECT='bambola-arm'
R9=RELEASES/'20261103-crm-r9'; R9_MANIFEST='ef7bcab49494bf0577afec816dc239778db27cf4b470b596600a3cef96042bd7'; R9_IMAGE='sha256:eb8d7abe3c23cb03363852d3c796bc82a49d8bf47965f114d78f23cd5b37cb88'
WORKDIR=RELEASES/'20261102-r5/deploy/marine'; BASE=WORKDIR/'compose.ubuntu.yml'; PANELS=ROOT/'runtime/panels-20261102.override.yml'; CRM=ROOT/'runtime/crm-ef7bcab49494.override.yml'; ENV=ROOT/'runtime/runtime.env'; GATEWAY_CONFIG=ROOT/'runtime/gateway-crm-ef7bcab49494.Caddyfile'
QA_REL=Path('deploy/marine/agenda-browser-acceptance.json'); UI={'src/components/marine/admin-panels.tsx','src/components/marine/marine-app.tsx'}
OPS_ALLOW={'deploy/marine/crm_app_update.py','deploy/marine/release_lock.py','deploy/marine/build_crm.py','deploy/marine/crm_rollout.py','deploy/marine/tests/test_crm_app_update.py','deploy/marine/tests/test_release_lock.py','deploy/marine/tests/test_crm_build_lock.py','deploy/marine/tests/test_crm_rollout.py','deploy/marine/agenda-browser-acceptance.json'}
SCENARIOS={'admin-visible-entry','four-calendar-modes-and-selected-date','leap-day-and-month-end-navigation','create-future-tour-through-visible-controls-and-reload','Caracas-date-grouping-across-UTC-midnight','overlap-rejection-retains-draft','two-tour-selection-and-explicit-administration-action','slow-refresh-keeps-calendar-navigation-disabled','confirmed-create-with-following-read-failure','ambiguous-post-retry-reuses-same-command-id','crew-has-no-create-action','responsive-keyboard-and-zoom'}
SHA_RE=re.compile(r'^[0-9a-f]{64}$'); ID_RE=re.compile(r'^\d{8}T\d{6}Z-[0-9a-f]{12}$'); IMAGE_RE=re.compile(r'^sha256:[0-9a-f]{64}$')
class Refusal(RuntimeError): pass

def canonical(v): return (json.dumps(v,sort_keys=True,ensure_ascii=True,separators=(',',':'))+'\n').encode('utf-8')
def sha(b): return hashlib.sha256(b).hexdigest()
def utc(): return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
def fail(message): raise Refusal(message)
def valid_timestamp(value):
    try:
        parsed=datetime.strptime(value,'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
        if parsed.strftime('%Y-%m-%dT%H:%M:%SZ')!=value or (parsed-datetime.now(timezone.utc)).total_seconds()>60: return False
        return True
    except (TypeError,ValueError): return False
def valid_operation_id(value):
    if not isinstance(value,str) or not ID_RE.fullmatch(value): return False
    try:
        captured=datetime.strptime(value[:16],'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc)
        return (captured-datetime.now(timezone.utc)).total_seconds()<=60
    except ValueError: return False
def write_exclusive(path,data,mode=0o600):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),mode)
    try:
        with os.fdopen(fd,'wb',closefd=False) as f: f.write(data); f.flush(); os.fsync(fd)
        if os.name=='posix': os.fchmod(fd,mode); os.fsync(fd)
    finally: os.close(fd)
    fsync_dir(path.parent)
def write_fixed(path,data,mode=0o600):
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file() or path.read_bytes()!=data: fail('A fixed operation artifact already exists with different bytes.')
        if os.name=='posix' and stat.S_IMODE(path.stat().st_mode)!=mode: fail('A fixed operation artifact has the wrong mode.')
        return
    write_exclusive(path,data,mode)
def fsync_dir(path):
    if os.name=='posix':
        fd=os.open(path,os.O_RDONLY|getattr(os,'O_DIRECTORY',0));
        try: os.fsync(fd)
        finally: os.close(fd)
def safe_json(path):
    if path.is_symlink() or not path.is_file(): fail('A required operation artifact is missing or unsafe.')
    try: raw=path.read_bytes(); value=json.loads(raw.decode('utf-8'))
    except (OSError,UnicodeDecodeError,json.JSONDecodeError) as e: raise Refusal('An operation artifact is malformed.') from e
    if os.name=='posix' and (path.stat().st_uid!=0 or stat.S_IMODE(path.stat().st_mode)!=0o600): fail('An operation artifact has unsafe ownership or mode.')
    return value,raw
def operation_dir(op):
    if not ID_RE.fullmatch(op): fail('Invalid operation identifier.')
    path=OPS/op
    if path.is_symlink() or not path.is_dir(): fail('Operation directory is missing or unsafe.')
    if os.name=='posix' and Path('/opt') in path.absolute().parents:
        _check_ancestors(path,Path('/opt'))
        if OPS.is_symlink() or not OPS.is_dir() or OPS.stat().st_mode & 0o777 != 0o700 or OPS.stat().st_uid!=0: fail('Operation evidence root is unsafe.')
    if os.name=='posix' and (path.stat().st_uid!=0 or stat.S_IMODE(path.stat().st_mode)!=0o700): fail('Operation directory ownership or mode is unsafe.')
    return path
def path_identity(path,mode=(0o600,0o644)):
    if path.is_symlink() or not path.is_file(): fail('A pinned input is missing or not a regular file.')
    st=path.stat()
    if os.name=='posix' and (st.st_uid!=0 or stat.S_IMODE(st.st_mode) not in mode): fail('A pinned input has unsafe owner or mode.')
    return {'path':str(path),'sha256':sha(path.read_bytes()),'mode':stat.S_IMODE(st.st_mode)}
def verify_release(path,digest):
    if path.is_symlink() or not SHA_RE.fullmatch(digest or ''): fail('Invalid release directory or manifest digest.')
    resolved=path.resolve(strict=True)
    if resolved.parent!=RELEASES.resolve(strict=True) or resolved!=path: fail('Release must be a direct child of the fixed release root.')
    # Enforce the complete tree before invoking even the trusted in-process verifier.
    if os.name=='posix': _check_ancestors(resolved,Path('/opt'))
    for current,dirs,files in os.walk(resolved,topdown=True,followlinks=False):
        directory=Path(current); dst=directory.lstat()
        if stat.S_ISLNK(dst.st_mode) or not stat.S_ISDIR(dst.st_mode): fail('Release tree contains an unsafe directory.')
        if os.name=='posix' and (dst.st_uid!=0 or stat.S_IMODE(dst.st_mode)&0o022): fail('Release directory is not root-owned or is writable by group/other.')
        for name in list(dirs):
            child=directory/name; st=child.lstat()
            if stat.S_ISLNK(st.st_mode) or not stat.S_ISDIR(st.st_mode): fail('Release tree contains a symlink or non-directory.')
        for name in files:
            child=directory/name; st=child.lstat()
            if stat.S_ISLNK(st.st_mode) or not stat.S_ISREG(st.st_mode): fail('Release tree contains a symlink or non-regular file.')
            if os.name=='posix' and (st.st_uid!=0 or stat.S_IMODE(st.st_mode) not in (0o600,0o644)): fail('Release file owner or mode is unsafe.')
    verifier_path=Path(__file__).resolve().with_name('manifest.py')
    spec=importlib.util.spec_from_file_location('_trusted_marine_manifest',verifier_path)
    if spec is None or spec.loader is None: fail('Trusted in-process release verifier is unavailable.')
    verifier=importlib.util.module_from_spec(spec); spec.loader.exec_module(verifier)
    try: verifier.verify(resolved,digest)
    except (OSError,ValueError) as error: raise Refusal('Release manifest verification failed.') from error
    return resolved

def _check_ancestors(path,boundary):
    current=Path(path)
    while True:
        if current.is_symlink() or not current.is_dir(): fail('A fixed path ancestor is missing or unsafe.')
        if os.name=='posix' and (current.stat().st_uid!=0 or current.stat().st_mode & 0o022): fail('A fixed path ancestor is not root-owned or is writable by group/other.')
        if current==boundary: return
        if boundary not in current.parents: fail('A fixed path escaped its trusted boundary.')
        current=current.parent

def verify_host_execution_boundary():
    if os.name!='posix': return
    for path in (BASE,PANELS,CRM,ENV,GATEWAY_CONFIG):
        _check_ancestors(path.parent,Path('/opt'))
        path_identity(path,mode=(0o444,) if path==GATEWAY_CONFIG else (0o600,0o644))
    for path in (BASE,PANELS,CRM):
        try: source=path.read_text(encoding='utf-8')
        except (OSError,UnicodeDecodeError) as e: raise Refusal('A fixed Compose source is unreadable.') from e
        if re.search(r'(?m)^\s*env_file\s*:',source): fail('Static Compose sources may not select implicit env files.')
    if run(['docker','context','show'],timeout=10).strip()!='default': fail('Docker context is not the local default context.')
    endpoint=run(['docker','context','inspect','default','--format','{{(index .Endpoints "docker").Host}}'],timeout=10).strip()
    if endpoint not in ('unix:///var/run/docker.sock','unix:///run/docker.sock'): fail('Docker default context does not use the local socket.')
def manifest_map(release):
    # manifest.py is the authority for file enumeration; JSON is read only after verification.
    p=release/'release-manifest.json'
    if p.is_symlink() or not p.is_file(): fail('Verified manifest index is unavailable.')
    raw=p.read_bytes(); value=json.loads(raw.decode('utf-8'))
    entries=value.get('files') if isinstance(value,dict) else None
    if not isinstance(entries,list): fail('Verified manifest index has an unsupported schema.')
    result={}
    for row in entries:
        if not isinstance(row,dict) or set(row)!={'path','bytes','sha256'}: fail('Manifest entry is malformed.')
        rel=row['path']; digest=row['sha256']
        if not isinstance(rel,str) or rel.startswith('/') or '..' in Path(rel).parts or not SHA_RE.fullmatch(digest or ''): fail('Manifest entry path or hash is invalid.')
        result[rel]=digest
    return result
def qa_validate(release,digest,manifest):
    path=release/QA_REL
    if path.is_symlink() or not path.is_file(): fail('Acceptance artifact is missing or unsafe.')
    raw=path.read_bytes()
    if sha(raw)!=digest or manifest.get(QA_REL.as_posix())!=digest: fail('Acceptance artifact digest is not manifest-bound.')
    try: q=json.loads(raw.decode('utf-8'))
    except (UnicodeDecodeError,json.JSONDecodeError) as e: raise Refusal('Acceptance artifact is malformed.') from e
    keys={'version','status','baselineManifestSha256','overlay','unchangedRuntimeInputsSha256','buildId','scenarios','sourceReportSha256','capturedAt'}
    if set(q)!=keys or type(q['version']) is not int or q['version']!=1 or q['status']!='passed' or q['baselineManifestSha256']!=R9_MANIFEST: fail('Acceptance artifact schema or baseline is invalid.')
    if not SHA_RE.fullmatch(q['sourceReportSha256'] or '') or not isinstance(q['buildId'],str) or not q['buildId']: fail('Acceptance provenance is invalid.')
    actual=[{'path':p,'sha256':manifest.get(p)} for p in sorted(UI)]
    if q['overlay']!=actual: fail('Acceptance overlay does not bind the candidate UI bytes.')
    scenarios=q['scenarios']
    if not isinstance(scenarios,list) or len(scenarios)!=len(SCENARIOS) or any(not isinstance(x,dict) or set(x)!={'name','status'} for x in scenarios) or {x['name'] for x in scenarios}!=SCENARIOS or any(x['status']!='pass' for x in scenarios): fail('Acceptance scenarios are incomplete or not passing.')
    at=datetime.strptime(q['capturedAt'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    now=datetime.now(timezone.utc)
    if (now-at).total_seconds()>86400 or (at-now).total_seconds()>60: fail('Acceptance artifact is stale or future-dated.')
    projected={p:h for p,h in manifest.items() if p not in UI|OPS_ALLOW|{'.env.example'}}
    runtime_digest=sha(canonical(projected))
    if q['unchangedRuntimeInputsSha256']!=runtime_digest: fail('Acceptance unchanged runtime projection differs from candidate manifest.')
    return q,raw,runtime_digest

def verify_static_update_exclusion(release,manifest):
    # The Dockerfile copies the full context. Prove the runtime/build entrypoints
    # do not import or inspect the host-side release helpers or QA evidence.
    forbidden=(b'crm_app_update.py',b'release_lock.py',b'build_crm.py',b'crm_rollout.py',b'agenda-browser-acceptance.json',b'test_crm_app_update.py')
    checked=[]
    for name in manifest:
        if name.startswith(('src/','scripts/','drizzle/')) and name.endswith(('.ts','.tsx','.js','.mjs','.cjs','.json')):
            path=release/name
            try: data=path.read_bytes()
            except OSError as e: raise Refusal('A static build/runtime source is unreadable.') from e
            if any(token in data for token in forbidden): fail('A runtime/build source references an operational release helper or acceptance artifact.')
            checked.append(name)
    package=json.loads((release/'package.json').read_text(encoding='utf-8'))
    if package.get('scripts',{}).get('build')!='next build': fail('The reviewed application build command changed.')
    dockerfile=(release/'deploy/marine/Dockerfile').read_text(encoding='utf-8')
    if 'RUN pnpm build' not in dockerfile or 'pnpm exec esbuild scripts/migrate.mjs --bundle' not in dockerfile: fail('The reviewed Docker build/migration entrypoint changed.')
    # Return only a boolean/count: never persist source contents or parsed secrets.
    return {'passed':True,'scannedFiles':len(checked)}
def validate_chain(directory):
    op,opraw=safe_json(directory/'operation.json')
    required={'schemaVersion','id','capturedAt','candidate','predecessor','baselineSha256','qaSha256','runtimeInputsSha256','compose'}
    if set(op)!=required or type(op['schemaVersion']) is not int or op['schemaVersion']!=1: fail('Operation genesis schema is invalid.')
    if not valid_operation_id(op['id']) or directory.name!=op['id']: fail('Operation identity mismatch.')
    if not valid_timestamp(op['capturedAt']) or canonical(op)!=opraw: fail('Operation genesis timestamp or canonical encoding is invalid.')
    if set(op['candidate'])!={'path','manifestSha256'} or set(op['predecessor'])!={'path','manifestSha256','imageId','migrationBundleSha256'}: fail('Operation release identity schema is invalid.')
    if not all(SHA_RE.fullmatch(op[k] or '') for k in ('baselineSha256','qaSha256','runtimeInputsSha256')): fail('Operation genesis contains a malformed digest.')
    if op['predecessor']!={'path':str(R9),'manifestSha256':R9_MANIFEST,'imageId':R9_IMAGE,'migrationBundleSha256':op['predecessor']['migrationBundleSha256']} or not SHA_RE.fullmatch(op['predecessor']['migrationBundleSha256'] or ''): fail('Operation is not pinned to the approved r9 predecessor.')
    if op['compose'].get('project')!=PROJECT or op['compose'].get('workdir')!=str(WORKDIR) or set(op['compose'])!={'project','workdir','files','gatewayConfig'}: fail('Compose operation identity is invalid.')
    pin=op['compose']['gatewayConfig']
    if not isinstance(pin,dict) or set(pin)!={'path','sha256','mode'} or pin.get('path')!=str(GATEWAY_CONFIG) or type(pin.get('mode')) is not int or pin['mode']!=0o444 or not SHA_RE.fullmatch(pin.get('sha256') or ''): fail('Live gateway configuration pin is malformed.')
    expected_paths=[str(BASE),str(PANELS),str(CRM)]; comp_files=op['compose']['files']
    if not isinstance(comp_files,list) or len(comp_files)!=3: fail('Compose file chain is malformed.')
    for item,path in zip(comp_files,expected_paths):
        if set(item)!={'path','sha256','mode'} or item['path']!=path or not SHA_RE.fullmatch(item['sha256'] or '') or type(item['mode']) is not int or item['mode'] not in (0o600,0o644): fail('Compose file identity is invalid.')
    prev=sha(opraw); phases=[]
    files=sorted(directory.glob('[0-9][0-9][0-9][0-9]-*.json'))
    allowed={'captured':['building'],'building':['built'],'built':['prepared'],'prepared':['activating'],'activating':['activated','rolling_back'],'activated':['rolling_back'],'rolling_back':['rolling_back','rolled_back']}
    current=None
    for seq,p in enumerate(files,1):
        if p.is_symlink() or not p.is_file() or p.name[:4]!=f'{seq:04d}': fail('Phase sequence has a gap or unsafe file.')
        record,raw=safe_json(p)
        keys={'schemaVersion','operationId','sequence','previousSha256','phase','at','payload'}
        if set(record)!=keys or type(record['schemaVersion']) is not int or record['schemaVersion']!=1 or type(record['sequence']) is not int or record['sequence']!=seq or record['operationId']!=op['id'] or record['previousSha256']!=prev or p.name!=f'{seq:04d}-{record["phase"]}.json': fail('Phase hash chain or filename is invalid.')
        if not valid_timestamp(record['at']) or canonical(record)!=raw or not SHA_RE.fullmatch(record['previousSha256'] or ''): fail('Phase timestamp or canonical encoding is invalid.')
        if seq==1 and record['phase']!='captured' or seq>1 and record['phase'] not in allowed.get(current,[]): fail('Phase transition is invalid.')
        payload_keys={'captured':set(),'building':set(),'built':{'imageId','sourceManifestSha256','buildResultSha256','migrationBundleSha256'},'prepared':{'candidateOverrideSha256','composeDeltaSha256'},'activating':{'preflightSnapshotSha256','metadataProof','qaSha256'},'activated':{'appImageId','appContainerId','metadataProof','postSnapshotSha256','externalChecksPassed'},'rolling_back':{'observedImageId','noOp'},'rolled_back':{'appImageId','appContainerId','metadataProof','externalChecksPassed','externalDrift','noOp'}}
        if record['phase'] not in payload_keys or not isinstance(record['payload'],dict) or set(record['payload'])!=payload_keys[record['phase']]: fail('Phase payload schema is invalid.')
        payload=record['payload']; phase=record['phase']
        if phase=='built' and (not IMAGE_RE.fullmatch(payload['imageId'] or '') or payload['sourceManifestSha256']!=op['candidate']['manifestSha256'] or any(not SHA_RE.fullmatch(payload[k] or '') for k in ('buildResultSha256','migrationBundleSha256'))): fail('Built phase identity is invalid.')
        if phase=='prepared' and any(not SHA_RE.fullmatch(payload[k] or '') for k in payload): fail('Prepared phase digest is invalid.')
        if phase=='activating' and (payload['qaSha256']!=op['qaSha256'] or not SHA_RE.fullmatch(payload['preflightSnapshotSha256'] or '') or not valid_metadata_proof(payload['metadataProof'])): fail('Activation intent payload is invalid.')
        if phase=='activated' and (payload['appImageId']!=result_image(directory) or not re.fullmatch(r'[0-9a-f]{64}',payload['appContainerId'] or '') or type(payload['externalChecksPassed']) is not bool or payload['externalChecksPassed'] is not True or not SHA_RE.fullmatch(payload['postSnapshotSha256'] or '') or not valid_metadata_proof(payload['metadataProof'])): fail('Activated phase payload is invalid.')
        if phase=='rolling_back' and (payload['observedImageId'] not in (R9_IMAGE,result_image(directory)) or type(payload['noOp']) is not bool or payload['noOp']!=(payload['observedImageId']==R9_IMAGE)): fail('Rollback intent payload is invalid.')
        if phase=='rolled_back' and (payload['appImageId']!=R9_IMAGE or not re.fullmatch(r'[0-9a-f]{64}',payload['appContainerId'] or '') or type(payload['noOp']) is not bool or type(payload['externalChecksPassed']) is not bool or not isinstance(payload['externalDrift'],list) or any(x not in {'other-container-drift','unrelated-route-drift','public-route-failed'} for x in payload['externalDrift']) or payload['externalChecksPassed']!=(not payload['externalDrift']) or not valid_metadata_proof(payload['metadataProof'])): fail('Rolled-back phase payload is invalid.')
        if phase=='rolling_back' and seq>1 and phases[-1]['phase']=='rolling_back':
            prior=phases[-1]['payload']
            if prior['observedImageId']!=result_image(directory) or prior['noOp'] is not False or payload['observedImageId']!=result_image(directory) or payload['noOp'] is not False: fail('A repeated rollback intent is allowed only for an exact candidate retry.')
        phases.append(record); current=record['phase']; prev=sha(raw)
    if not phases or phases[0]['phase']!='captured': fail('The durable capture phase is missing.')
    actual={p.name for p in directory.iterdir()}
    allowed_files={'operation.json','baseline.json','qa.json','build.log','build-result.json','candidate.override.yml','rollback.override.yml','pre-activation.json','post-activation.json'}|{p.name for p in files}
    if actual!=allowed_files.intersection(actual) or any(n not in allowed_files for n in actual): fail('Operation directory contains an unrecognized artifact.')
    for name in actual:
        path=directory/name
        if path.is_symlink() or not path.is_file(): fail('An operation artifact is not a regular file.')
        mode=0o644 if name.endswith('.yml') else 0o600
        if os.name=='posix' and (path.stat().st_uid!=0 or stat.S_IMODE(path.stat().st_mode)!=mode): fail('An operation artifact has unsafe ownership or mode.')
    if current in ('built','prepared','activating','activated','rolling_back','rolled_back'):
        built=next((p for p in phases if p['phase']=='built'),None)
        if not built or not {'build.log','build-result.json'}.issubset(actual): fail('Built state lacks fixed build evidence files.')
        result,result_raw=safe_json(directory/'build-result.json')
        if canonical(result)!=result_raw or sha(result_raw)!=built['payload']['buildResultSha256'] or result.get('imageId')!=built['payload']['imageId'] or result.get('migrationBundleSha256')!=built['payload']['migrationBundleSha256'] or result.get('logSha256')!=sha((directory/'build.log').read_bytes()): fail('Build result or log is not bound to the built phase.')
    prepared=next((p for p in phases if p['phase']=='prepared'),None)
    if current in ('prepared','activating','activated','rolling_back','rolled_back') and 'candidate.override.yml' not in actual: fail('Prepared state lacks its fixed app-only override.')
    if prepared:
        expected_override=f'services:\n  app:\n    image: "{result_image(directory)}"\n'.encode('ascii')
        if (directory/'candidate.override.yml').read_bytes()!=expected_override or sha(expected_override)!=prepared['payload']['candidateOverrideSha256']: fail('Candidate override is not the exact immutable app image file.')
    if current in ('activating','activated','rolling_back','rolled_back') and 'pre-activation.json' not in actual: fail('Activation intent lacks its preflight snapshot.')
    activating=next((p for p in phases if p['phase']=='activating'),None)
    if activating:
        pre,pre_raw=safe_json(directory/'pre-activation.json')
        if canonical(pre)!=pre_raw or set(pre)!={'snapshot','metadataProof'} or sha(pre_raw)!=activating['payload']['preflightSnapshotSha256'] or pre['metadataProof']!=activating['payload']['metadataProof'] or not valid_metadata_proof(pre['metadataProof']): fail('Pre-activation snapshot is not bound to its intent.')
        validate_safe_snapshot(pre['snapshot'],False)
    if current=='activated' and 'post-activation.json' not in actual: fail('Activated state lacks its post snapshot.')
    activated=next((p for p in phases if p['phase']=='activated'),None)
    if activated:
        post,post_raw=safe_json(directory/'post-activation.json')
        if canonical(post)!=post_raw or set(post)!={'snapshot','metadataProof'} or sha(post_raw)!=activated['payload']['postSnapshotSha256'] or post['metadataProof']!=activated['payload']['metadataProof'] or activated['payload']['metadataProof']!=activating['payload']['metadataProof']: fail('Post-activation snapshot is not bound to the successful intent.')
        validate_safe_snapshot(post['snapshot'],False)
    if 'rollback.override.yml' in actual and (directory/'rollback.override.yml').read_bytes()!=f'services:\n  app:\n    image: "{R9_IMAGE}"\n'.encode('ascii'): fail('Rollback override is not the exact fixed r9 app image file.')
    rolled=next((p for p in phases if p['phase']=='rolled_back'),None)
    captured_baseline,_=safe_json(directory/'baseline.json')
    if rolled and rolled['payload']['metadataProof']!=captured_baseline['metadataProof']: fail('Rollback metadata proof differs from capture.')
    if 'baseline.json' in actual:
        baseline,braw=safe_json(directory/'baseline.json')
        if canonical(baseline)!=braw or sha(braw)!=op['baselineSha256']: fail('Baseline canonical bytes or digest is invalid.')
    if 'qa.json' in actual and sha((directory/'qa.json').read_bytes())!=op['qaSha256']: fail('Copied QA artifact digest is invalid.')
    return op,phases,prev

def valid_metadata_proof(value):
    if not isinstance(value,dict) or set(value)!={'migrations','schemaSha256'} or not SHA_RE.fullmatch(value['schemaSha256'] or '') or not isinstance(value['migrations'],list) or not value['migrations']: return False
    previous_time=-1; previous_id=0
    for item in value['migrations']:
        if not isinstance(item,dict) or set(item)!={'id','hash','createdAt'} or type(item['id']) is not int or item['id']<=previous_id or not SHA_RE.fullmatch(item['hash'] or '') or not isinstance(item['createdAt'],str) or not re.fullmatch(r'-?\d+',item['createdAt']): return False
        if int(item['createdAt'])<=previous_time: return False
        previous_time=int(item['createdAt']); previous_id=item['id']
    return True
def append_phase(directory,op,phases,previous,phase,payload):
    seq=len(phases)+1
    if seq>9999: fail('Phase record limit reached.')
    rec={'schemaVersion':1,'operationId':op['id'],'sequence':seq,'previousSha256':previous,'phase':phase,'at':utc(),'payload':payload}
    encoded=canonical(rec); write_exclusive(directory/f'{seq:04d}-{phase}.json',encoded); return rec,sha(encoded)
def compose_env():
    env={k:v for k,v in os.environ.items() if k in ('PATH','HOME','LANG','LC_ALL','LC_CTYPE')}
    if 'PATH' not in env: env['PATH']='/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin'
    env['HOME']='/root'; env['LANG']='C.UTF-8'; env['LC_ALL']='C.UTF-8'
    return env
def run(args,timeout=45,quiet=False,extra_env=None):
    env=compose_env(); env.update(extra_env or {})
    try: result=subprocess.run(args,check=False,capture_output=True,text=True,timeout=timeout,env=env)
    except (OSError,subprocess.SubprocessError) as e: raise Refusal('A fixed verification command failed or timed out.') from e
    if result.returncode: raise Refusal('A fixed verification command returned failure.')
    return result.stdout

def verify_compose_labels(app_extras=(None,)):
    # Labels are metadata only; they are checked against fixed paths before any
    # Docker-reported path is opened or used as command authority.
    raw=run(['docker','inspect','--format','{{json .Config.Labels}}',APP,crm_host.GATEWAY_NAME],timeout=15)
    try: labels=[json.loads(line) for line in raw.splitlines()]
    except json.JSONDecodeError as e: raise Refusal('Running Compose labels are malformed.') from e
    if len(labels)!=2 or any(not isinstance(x,dict) for x in labels): fail('App/gateway Compose labels are missing.')
    base=','.join((str(BASE),str(PANELS),str(CRM)))
    expected_apps={base+(','+str(extra) if extra else '') for extra in app_extras}
    for record,service in zip(labels,('app','gateway')):
        files=record.get('com.docker.compose.project.config_files')
        if record.get('com.docker.compose.project')!=PROJECT or record.get('com.docker.compose.service')!=service or record.get('com.docker.compose.project.working_dir')!=str(WORKDIR) or files not in (expected_apps if service=='app' else {base}):
            fail('Running Compose labels do not match the reviewed fixed file chain.')
def compose_prefix(op,extra=()):
    files=sum((['-f',x['path']] for x in op['compose']['files']),[])
    return ['docker','compose','--project-name',PROJECT,'--project-directory',op['compose']['workdir'],'--env-file',str(ENV),*files,*sum((['-f',str(p)] for p in extra),[])]
def current_baseline(release):
    return validate_safe_snapshot(crm_host.current_snapshot_fields(release,route_samples=3),False)

def validate_safe_snapshot(value,with_proof):
    keys={'caddy','containers','ownedAppGateway','networks','configFiles','routes','resources'}|({'metadataProof'} if with_proof else set())
    if not isinstance(value,dict) or set(value)!=keys: fail('Safe host snapshot schema is invalid.')
    caddy=value['caddy']
    if not isinstance(caddy,dict) or set(caddy)!={'container','config'} or caddy['container'].get('name')!=CADDY_NAME or set(caddy['config'])!={'path','inode','sha256'} or not SHA_RE.fullmatch(caddy['config']['sha256'] or '') or type(caddy['config']['inode']) is not int: fail('Safe Caddy snapshot is malformed.')
    containers=value['containers']; record_keys={'name','id','imageId','configuredImage','startedAt','restartCount','running','health','ports','networks','runtime'}
    if not isinstance(containers,list) or len({c.get('name') for c in containers if isinstance(c,dict)})!=len(containers): fail('Container snapshot is malformed.')
    for c in containers:
        if not isinstance(c,dict) or set(c)!=record_keys or not isinstance(c['name'],str) or not isinstance(c['id'],str) or not re.fullmatch(r'[0-9a-f]{64}',c['id']) or not isinstance(c['imageId'],str) or type(c['running']) is not bool: fail('Container snapshot contains unsafe or malformed fields.')
    owned=value['ownedAppGateway']
    if not isinstance(owned,dict) or set(owned)!={'app','gateway'}: fail('Owned service projection is malformed.')
    by_name={c['name']:c for c in containers}
    if owned['app']!=by_name.get(APP) or owned['gateway']!=by_name.get(crm_host.GATEWAY_NAME): fail('Owned services differ from container records.')
    networks=value['networks']
    if not isinstance(networks,list) or any(not isinstance(n,dict) or set(n)!={'id','name','driver','scope','internal','enableIPv6','ipam','containers'} or not isinstance(n['containers'],dict) for n in networks): fail('Network snapshot is malformed.')
    configs=value['configFiles']
    expected_config_keys={'compose','pinnedBaseCompose','gatewayTemplate','runtimeGateway','runtimeOverride','runtimeEnv'}
    if not isinstance(configs,dict) or set(configs)!=expected_config_keys: fail('Protected configuration snapshot is malformed.')
    routes=value['routes']
    if not isinstance(routes,dict) or set(routes)!=set(crm_host.ROUTES): fail('Route snapshot keys are invalid.')
    for outcomes in routes.values():
        if not isinstance(outcomes,list) or not outcomes: fail('Route outcome sample is missing.')
        for route in outcomes:
            if not isinstance(route,dict) or set(route)!={'status','tlsVerified','location'} or type(route['status']) is not int or type(route['tlsVerified']) is not bool or route['tlsVerified'] is not True or (route['location'] is not None and not isinstance(route['location'],str)): fail('Route outcome is malformed or TLS is unverified.')
    resources=value['resources']
    if not isinstance(resources,dict) or set(resources)!={'memAvailableKiB','optFreeKiB'} or any(type(x) is not int or x<=0 for x in resources.values()): fail('Resource snapshot is malformed.')
    if with_proof and not valid_metadata_proof(value['metadataProof']): fail('Metadata proof schema is malformed.')
    return value
def verify_current_r9(snapshot):
    app=snapshot['ownedAppGateway']['app']
    if app.get('name')!=APP or app.get('imageId')!=R9_IMAGE or app.get('configuredImage')!=R9_IMAGE or not app.get('running') or app.get('health')!='healthy': fail('Current app is not the exact healthy r9 predecessor.')

def validate_original_compose(rendered,baseline):
    import crm_rollout
    try: crm_rollout.validate_network_safety(rendered)
    except crm_rollout.Refusal as e: raise Refusal('Pinned Compose network/service safety check failed.') from e
    services=rendered['services']; app=services['app']; gateway=services['gateway']
    if app.get('image')!=R9_IMAGE or gateway.get('image')!=baseline['ownedAppGateway']['gateway']['configuredImage']: fail('Pinned Compose app/gateway images differ from the healthy r9 baseline.')
    if app.get('ports') or gateway.get('ports'): fail('Pinned Compose app/gateway ports must remain unpublished.')
    mount=crm_rollout.find_volume(rendered,'gateway')
    if mount.get('source')!=str(GATEWAY_CONFIG) or mount.get('read_only') is not True: fail('Pinned Compose gateway mount differs from the fixed live Caddy file.')

def _environment_map(rows):
    if not isinstance(rows,list): fail('Owned app environment metadata is malformed.')
    values={}
    for entry in rows:
        if not isinstance(entry,str) or '=' not in entry: fail('Owned app environment metadata is malformed.')
        key,value=entry.split('=',1)
        if not key or key in values: fail('Owned app environment metadata is ambiguous.')
        values[key]=value
    return values

def verify_app_environment(rendered,image_id,container=APP):
    """Compare full app env in memory; never persist, print, or log the values."""
    service=rendered.get('services',{}).get('app',{})
    declared=service.get('environment',{})
    if not isinstance(declared,dict) or not IMAGE_RE.fullmatch(image_id or ''): fail('Owned app environment source is malformed.')
    image_raw=run(['docker','image','inspect','--format','{{json .Config.Env}}',image_id],timeout=15)
    actual_raw=run(['docker','inspect','--format','{{json .Config.Env}}',container],timeout=15)
    try: image_values=json.loads(image_raw); actual_values=json.loads(actual_raw)
    except json.JSONDecodeError as e: raise Refusal('Owned app environment metadata is malformed.') from e
    expected=_environment_map(image_values)
    for key,value in declared.items():
        if value is None: expected.pop(key,None)
        elif not isinstance(value,str): fail('Owned app Compose environment is malformed.')
        else: expected[key]=value
    if _environment_map(actual_values)!=expected: fail('Owned app runtime environment differs from the pinned image and Compose inputs.')

def verify_build_guard(baseline,current):
    # Container/network/Caddy and immutable config state must remain exact; routes may
    # only return outcomes already observed by capture, and resources must stay safe.
    for key in ('caddy','ownedAppGateway','configFiles'):
        if current.get(key)!=baseline.get(key): fail('Protected host identity/configuration drifted during build.')
    def without_builder(rows): return [x for x in rows if x.get('name')!='buildx_buildkit_bambola-arm-builder0']
    if without_builder(current.get('containers',[]))!=without_builder(baseline.get('containers',[])): fail('A non-builder container changed during build.')
    if current.get('networks')!=baseline.get('networks'): fail('Docker network topology changed during build.')
    for url,observed in baseline.get('routes',{}).items():
        if any(x not in observed for x in current.get('routes',{}).get(url,[])): fail('A route outcome outside the capture set appeared during build.')
    resources=current.get('resources',{})
    if resources.get('memAvailableKiB',0)<768*1024 or resources.get('optFreeKiB',0)<10*1024*1024: fail('Host resources are below the reviewed build minimum.')

def _without_app_network(records):
    result=copy.deepcopy(records)
    for network in result:
        network['containers']={key:value for key,value in network.get('containers',{}).items() if value.get('name')!=APP}
    return result

def _relevant_networks(records):
    names=set()
    for network in records:
        if any(peer.get('name') in (APP,crm_host.GATEWAY_NAME,CADDY_NAME) for peer in network.get('containers',{}).values()): names.add(network.get('name'))
    result=[]
    for network in records:
        if network.get('name') not in names: continue
        item=copy.deepcopy(network)
        item['containers']={key:value for key,value in item.get('containers',{}).items() if value.get('name')!=APP}
        result.append(item)
    return result

def verify_app_only_result(baseline,current,image_id):
    if current['caddy']!=baseline['caddy'] or current['ownedAppGateway']['gateway']!=baseline['ownedAppGateway']['gateway']:
        fail('Shared Caddy or Bambola gateway changed during the app-only update.')
    if current.get('configFiles')!=baseline.get('configFiles'): fail('A pinned runtime configuration changed during the app-only update.')
    if _without_app_network(current.get('networks',[]))!=_without_app_network(baseline.get('networks',[])): fail('A protected Docker network or non-app endpoint changed.')
    old_app=baseline['ownedAppGateway']['app']; app=current['ownedAppGateway']['app']
    if app.get('imageId')!=image_id or app.get('configuredImage')!=image_id or not app.get('running') or app.get('health')!='healthy': fail('Updated app image or health is not exact and healthy.')
    for key in ('ports','runtime'):
        if app.get(key)!=old_app.get(key): fail('Updated app ports or runtime settings changed.')
    old_aliases={name:value.get('aliases') for name,value in old_app.get('networks',{}).items()}
    new_aliases={name:value.get('aliases') for name,value in app.get('networks',{}).items()}
    if new_aliases!=old_aliases: fail('Updated app network attachment or aliases changed.')
    other_before=[x for x in baseline['containers'] if x.get('name') not in (APP,crm_host.BUILDER_NAME)]
    other_after=[x for x in current['containers'] if x.get('name') not in (APP,crm_host.BUILDER_NAME)]
    if other_before!=other_after: fail('A non-app container changed during the app-only update.')
    for url,observed in baseline.get('routes',{}).items():
        outcomes=current.get('routes',{}).get(url,[])
        if not outcomes or any(item not in observed for item in outcomes): fail('A route outcome outside the captured baseline appeared.')
    resources=current.get('resources',{})
    if resources.get('memAvailableKiB',0)<768*1024 or resources.get('optFreeKiB',0)<10*1024*1024: fail('Host resources are below the reviewed minimum.')

def verify_rollback_boundary(baseline,current):
    if current.get('caddy')!=baseline.get('caddy'): fail('Shared Caddy changed; rollback is unsafe.')
    if current['ownedAppGateway']['gateway']!=baseline['ownedAppGateway']['gateway']: fail('Bambola gateway changed; rollback is unsafe.')
    if current.get('configFiles')!=baseline.get('configFiles'): fail('Pinned Compose, runtime environment, or Caddy input changed; rollback is unsafe.')
    if _relevant_networks(current.get('networks',[]))!=_relevant_networks(baseline.get('networks',[])): fail('A relevant Bambola/Caddy Docker network changed; rollback is unsafe.')
    for key in ('ports','runtime'):
        if current['ownedAppGateway']['app'].get(key)!=baseline['ownedAppGateway']['app'].get(key): fail('Bambola app runtime or ports changed; rollback is unsafe.')
    old_aliases={n:v.get('aliases') for n,v in baseline['ownedAppGateway']['app'].get('networks',{}).items()}
    new_aliases={n:v.get('aliases') for n,v in current['ownedAppGateway']['app'].get('networks',{}).items()}
    if old_aliases!=new_aliases: fail('Bambola app network attachment changed; rollback is unsafe.')
    drift=[]
    before={x['name']:x for x in baseline.get('containers',[]) if x.get('name') not in (APP,crm_host.BUILDER_NAME,CADDY_NAME)}
    after={x['name']:x for x in current.get('containers',[]) if x.get('name') not in (APP,crm_host.BUILDER_NAME,CADDY_NAME)}
    if set(before)!=set(after): fail('A non-target container appeared or disappeared; rollback is unsafe.')
    observed={'id','startedAt','restartCount','running','health'}
    for name,old in before.items():
        new=after[name]
        if any(old.get(k)!=new.get(k) for k in set(old)|set(new) if k not in observed): fail('A non-target container configuration changed; rollback is unsafe.')
        if any(old.get(k)!=new.get(k) for k in observed): drift.append('other-container-drift')
    for url,accepted in baseline.get('routes',{}).items():
        current_routes=current.get('routes',{}).get(url,[])
        if not current_routes or any(item not in accepted for item in current_routes):
            drift.append('public-route-failed' if url==crm_host.DOMAIN+'/' else 'unrelated-route-drift')
    return sorted(set(drift))
def capture(release_path,manifest_digest,qa_digest):
    verify_compose_labels()
    release=verify_release(release_path,manifest_digest); r9=verify_release(R9,R9_MANIFEST)
    candidate=manifest_map(release); predecessor=manifest_map(r9)
    verify_static_update_exclusion(release,candidate)
    q,qraw,runtime_digest=qa_validate(release,qa_digest,candidate)
    # Restrict complete package delta to the two runtime UI files and nine operational inputs.
    if (set(candidate)^set(predecessor)) - OPS_ALLOW: fail('Candidate adds or removes files outside the release allowlist.')
    for path in set(candidate)&set(predecessor):
        if candidate[path]!=predecessor[path] and path not in UI|OPS_ALLOW: fail('Candidate changes a runtime input outside the reviewed UI overlay.')
    if any(candidate.get(p)!=predecessor.get(p) for p in ('.env.example','package.json','pnpm-lock.yaml','deploy/marine/Dockerfile','deploy/marine/compose.ubuntu.yml')): fail('Pinned build or runtime inputs changed.')
    qa_validate(release,qa_digest,candidate)
    # Recheck the fixed original three Compose identities, but never follow arbitrary labels.
    verify_host_execution_boundary()
    files=[path_identity(BASE),path_identity(PANELS),path_identity(CRM)]
    gateway_pin=path_identity(GATEWAY_CONFIG,mode=(0o444,))
    if any(x['mode'] not in (0o600,0o644) for x in files): fail('Compose input mode is invalid.')
    before=current_baseline(release); verify_current_r9(before)
    # Render current chain and require current model to agree with live app/gateway labels.
    tmp={'compose':{'workdir':str(WORKDIR),'files':files}}
    rendered=json.loads(run(compose_prefix(tmp)+['config','--format','json']))
    validate_original_compose(rendered,before)
    verify_app_environment(rendered,R9_IMAGE)
    after=current_baseline(release)
    verify_build_guard(before,after)
    baseline={**before,'metadataProof':None}
    # Metadata proof is mandatory; obtain only through a fixed read-only node client query.
    proof=metadata_proof(APP); verify_migration_set(proof,r9)
    baseline['metadataProof']=proof
    validate_safe_snapshot(baseline,True)
    # Recompute baseline with proof included, bind it immutably.
    opid=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')+'-'+secrets.token_hex(6)
    OPS.mkdir(mode=0o700,parents=True,exist_ok=True)
    if os.name=='posix': os.chmod(OPS,0o700)
    d=OPS/opid; d.mkdir(mode=0o700); fsync_dir(OPS)
    write_exclusive(d/'baseline.json',canonical(baseline))
    write_exclusive(d/'qa.json',qraw)
    op={'schemaVersion':1,'id':opid,'capturedAt':utc(),'candidate':{'path':str(release),'manifestSha256':manifest_digest},'predecessor':{'path':str(r9),'manifestSha256':R9_MANIFEST,'imageId':R9_IMAGE,'migrationBundleSha256':migration_bundle_hash(APP)},'baselineSha256':sha(canonical(baseline)),'qaSha256':qa_digest,'runtimeInputsSha256':runtime_digest,'compose':{'project':PROJECT,'workdir':str(WORKDIR),'files':files,'gatewayConfig':gateway_pin}}
    write_exclusive(d/'operation.json',canonical(op)); _,chain=append_phase(d,op,[],sha(canonical(op)),'captured',{})
    print(opid)
def metadata_proof(container):
    queries={}
    # Catalog SQL literals are fixed, scoped to schema metadata, and exclude application rows.
    queries['relations']='SELECT n.nspname AS schema_name,c.relname,c.relkind FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ \'^pg_\' AND n.nspname<>\'information_schema\' AND c.relkind IN (\'r\',\'p\',\'v\',\'m\',\'f\',\'S\') ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",c.relkind'
    queries['columns']='SELECT n.nspname AS schema_name,c.relname,a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type_name,a.attnotnull,a.attidentity,a.attgenerated,pg_catalog.pg_get_expr(d.adbin,d.adrelid,false) AS default_expr FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE n.nspname !~ \'^pg_\' AND n.nspname<>\'information_schema\' AND c.relkind IN (\'r\',\'p\',\'v\',\'m\',\'f\') AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",a.attnum'
    queries['constraints']='SELECT n.nspname AS schema_name,c.relname,k.conname,k.contype,k.condeferrable,k.condeferred,k.convalidated,pg_catalog.pg_get_constraintdef(k.oid,false) AS definition FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ \'^pg_\' AND n.nspname<>\'information_schema\' ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",k.conname COLLATE "C"'
    queries['indexes']='SELECT n.nspname AS schema_name,c.relname,i.relname AS index_name,x.indisvalid,x.indisready,pg_catalog.pg_get_indexdef(i.oid,0,false) AS definition FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class c ON c.oid=x.indrelid JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ \'^pg_\' AND n.nspname<>\'information_schema\' ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",i.relname COLLATE "C"'
    queries['enums']='SELECT n.nspname AS schema_name,t.typname,e.enumsortorder::text AS enum_order,e.enumlabel FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ \'^pg_\' AND n.nspname<>\'information_schema\' ORDER BY n.nspname COLLATE "C",t.typname COLLATE "C",e.enumsortorder'
    queries['sequences']='SELECT n.nspname AS schema_name,c.relname,s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,s.seqcache::text,s.seqcycle FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid=s.seqrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ \'^pg_\' AND n.nspname<>\'information_schema\' ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"'
    queries['views']='SELECT n.nspname AS schema_name,c.relname,pg_catalog.pg_get_viewdef(c.oid,false) AS definition FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname !~ \'^pg_\' AND n.nspname<>\'information_schema\' AND c.relkind IN (\'v\',\'m\') ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"'
    # Queries are fixed source text; DATABASE_URL is read inside the app only.
    query_json=json.dumps(queries,sort_keys=True,separators=(',',':'))
    script="const postgres=require('postgres');const q="+query_json+";(async()=>{const sql=postgres(process.env.DATABASE_URL,{max:1});try{await sql.unsafe('BEGIN READ ONLY');const m=await sql.unsafe('SELECT id, hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id');const s={};for(const [k,v] of Object.entries(q))s[k]=await sql.unsafe(v);await sql.unsafe('COMMIT');process.stdout.write(JSON.stringify({migrations:m.map(x=>({id:Number(x.id),hash:x.hash,createdAt:String(BigInt(x.created_at))})),schema:s}))}finally{await sql.end()}})().catch(()=>process.exit(2));"
    payload=run(['docker','exec',container,'node','-e',script],timeout=30)
    try: data=json.loads(payload)
    except json.JSONDecodeError as e: raise Refusal('Metadata proof output is malformed.') from e
    migrations=data.get('migrations'); schema=data.get('schema')
    if not isinstance(migrations,list) or set(schema or {})!=set(queries): fail('Metadata proof is incomplete.')
    prev=-1; prev_id=0; ids=set()
    for row in migrations:
        if set(row)!={'id','hash','createdAt'} or type(row['id']) is not int or row['id']<1 or row['id'] in ids or not SHA_RE.fullmatch(row['hash'] or '') or not re.fullmatch(r'-?\d+',row['createdAt']): fail('Migration metadata is malformed.')
        if int(row['createdAt'])<=prev or row['id']<=prev_id: fail('Migration timestamps or IDs are not strictly increasing.')
        prev=int(row['createdAt']); prev_id=row['id']; ids.add(row['id'])
    proof={'migrations':migrations,'schemaSha256':sha(canonical(schema))}
    return proof

def migration_bundle_hash(container):
    script="const fs=require('node:fs'),c=require('node:crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync('/app/migrate.mjs')).digest('hex'))"
    value=run(['docker','exec',container,'node','-e',script],timeout=15).strip()
    if not SHA_RE.fullmatch(value): fail('Installed migration bundle hash is unavailable.')
    return value

def expected_migrations(release):
    journal_path=release/'drizzle/meta/_journal.json'
    if journal_path.is_symlink() or not journal_path.is_file(): fail('Drizzle journal is missing or unsafe.')
    try: journal=json.loads(journal_path.read_text(encoding='utf-8'))
    except (OSError,UnicodeDecodeError,json.JSONDecodeError) as e: raise Refusal('Drizzle journal is malformed.') from e
    entries=journal.get('entries') if isinstance(journal,dict) else None
    if not isinstance(entries,list) or not entries: fail('Drizzle journal has no migrations.')
    expected=[]
    for entry in entries:
        if not isinstance(entry,dict) or not isinstance(entry.get('tag'),str) or type(entry.get('when')) is not int: fail('Drizzle migration journal entry is malformed.')
        sql_path=release/'drizzle'/f"{entry['tag']}.sql"
        if sql_path.is_symlink() or not sql_path.is_file(): fail('A journal migration SQL file is missing or unsafe.')
        try: text=sql_path.read_bytes().decode('utf-8')
        except (OSError,UnicodeDecodeError) as e: raise Refusal('A migration SQL file is not valid UTF-8.') from e
        expected.append((entry['when'],sha(text.encode('utf-8'))))
    expected.sort()
    if len({when for when,_ in expected})!=len(expected): fail('Migration timestamps are duplicated.')
    return expected

def verify_migration_set(proof,release):
    expected=expected_migrations(release)
    actual=[(int(row['createdAt']),row['hash']) for row in proof['migrations']]
    if actual!=expected: fail('Installed migration journal differs from the verified source journal.')

def load(opid):
    d=operation_dir(opid); op,phases,head=validate_chain(d)
    baseline,braw=safe_json(d/'baseline.json')
    if sha(braw)!=op['baselineSha256']: fail('Baseline digest differs from immutable genesis.')
    validate_safe_snapshot(baseline,True)
    qraw=(d/'qa.json').read_bytes()
    if sha(qraw)!=op['qaSha256']: fail('Copied QA artifact digest differs from genesis.')
    return d,op,phases,head,baseline

def lock_context():
    return ReleaseLock(LOCK)

def _verify_manifest_and_qa(op,d):
    captured=datetime.strptime(op['capturedAt'],'%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=timezone.utc)
    if (datetime.now(timezone.utc)-captured).total_seconds()>24*60*60: fail('Captured host baseline is older than 24 hours; capture a new operation.')
    release=verify_release(Path(op['candidate']['path']),op['candidate']['manifestSha256'])
    manifest=manifest_map(release); qa_validate(release,op['qaSha256'],manifest); verify_static_update_exclusion(release,manifest)
    if (d/'qa.json').read_bytes()!=(release/QA_REL).read_bytes(): fail('Saved QA bytes differ from candidate artifact.')
    return release,manifest

def verify_pinned_gateway(op):
    if path_identity(GATEWAY_CONFIG,mode=(0o444,))!=op['compose']['gatewayConfig']: fail('The live gateway Caddy configuration changed.')

def verify_pinned_inputs(op,baseline,app_extras=(None,)):
    verify_compose_labels(app_extras)
    verify_host_execution_boundary()
    for item in op['compose']['files']:
        now=path_identity(Path(item['path']))
        if now!=item: fail('A captured Compose input changed.')
    verify_pinned_gateway(op)
    env_identity=path_identity(ENV)
    runtime=baseline.get('configFiles',{}).get('runtimeEnv',{})
    if env_identity['path']!=str(ENV) or env_identity['sha256']!=runtime.get('sha256'): fail('The fixed runtime environment changed.')

def load_trusted_builder():
    spec=importlib.util.spec_from_file_location('_trusted_build_crm',Path(__file__).resolve().with_name('build_crm.py'))
    if spec is None or spec.loader is None: fail('Trusted builder module is unavailable.')
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module

def _build(opid,lock_handle):
    lock_handle.assert_held()
    d,op,phases,head,baseline=load(opid)
    if phases[-1]['phase']!='captured': fail('Build requires captured state.')
    verify_pinned_inputs(op,baseline)
    release,manifest=_verify_manifest_and_qa(op,d)
    verify_build_guard(baseline,current_baseline(release))
    _,head=append_phase(d,op,phases,head,'building',{}); phases=phases+[{'phase':'building'}]
    build_crm=load_trusted_builder()
    record=build_crm.build_update(release,op['candidate']['manifestSha256'],opid,d,
                                  lambda: (verify_pinned_gateway(op),verify_build_guard(baseline,current_baseline(release))),lock_handle=lock_handle)
    if record['migrationBundleSha256']!=op['predecessor']['migrationBundleSha256']:
        fail('Candidate migration bundle differs from the running r9 bundle.')
    result_path=d/'build-result.json'; result_raw=result_path.read_bytes()
    verify_build_guard(baseline,current_baseline(release))
    payload={'imageId':record['imageId'],'sourceManifestSha256':record['sourceManifestSha256'],
             'buildResultSha256':sha(result_raw),'migrationBundleSha256':record['migrationBundleSha256']}
    append_phase(d,op,phases,head,'built',payload)

def record_sha(path):
    return sha(path.read_bytes())

def _prepare(opid):
    d,op,phases,head,baseline=load(opid)
    if phases[-1]['phase']!='built': fail('Prepare requires a verified built image.')
    verify_pinned_inputs(op,baseline)
    release,manifest=_verify_manifest_and_qa(op,d)
    result,_=safe_json(d/'build-result.json')
    image=result.get('imageId')
    built=next((p for p in phases if p['phase']=='built'),None)
    result_raw=(d/'build-result.json').read_bytes(); log_raw=(d/'build.log').read_bytes()
    if not built or sha(result_raw)!=built['payload']['buildResultSha256'] or not IMAGE_RE.fullmatch(image or '') or result.get('sourceManifestSha256')!=op['candidate']['manifestSha256'] or result.get('migrationBundleSha256')!=built['payload']['migrationBundleSha256'] or result.get('logSha256')!=sha(log_raw): fail('Build evidence does not bind the candidate image, source, or log.')
    inspected=run(['docker','image','inspect','--format','{{.Id}} {{index .Config.Labels "heili.source-manifest"}}',image],timeout=15).strip().split()
    if inspected!=[image,op['candidate']['manifestSha256']]: fail('Candidate image ID or source-manifest label changed.')
    if built['payload']['migrationBundleSha256']!=op['predecessor']['migrationBundleSha256']: fail('Candidate migration bundle differs from r9.')
    before=current_baseline(release)
    verify_build_guard(baseline,before)
    candidate_override=b'services:\n  app:\n    image: "'+image.encode('ascii')+b'"\n'
    path=d/'candidate.override.yml'; write_fixed(path,candidate_override,0o644)
    old=json.loads(run(compose_prefix(op)+['config','--format','json']))
    new=json.loads(run(compose_prefix(op,(path,))+['config','--format','json']))
    expected=copy.deepcopy(old); expected.setdefault('services',{}).setdefault('app',{})['image']=image
    if new!=expected: fail('Rendered Compose differs beyond services.app.image.')
    _,head=append_phase(d,op,phases,head,'prepared',{'candidateOverrideSha256':sha(candidate_override),'composeDeltaSha256':sha(canonical({'before':old,'after':new}))})

def _activate(opid):
    d,op,phases,head,baseline=load(opid)
    if phases[-1]['phase']!='prepared': fail('Activate requires prepared state.')
    verify_pinned_inputs(op,baseline)
    release,manifest=_verify_manifest_and_qa(op,d)
    override=d/'candidate.override.yml'
    if sha(override.read_bytes())!=phases[-1]['payload']['candidateOverrideSha256']: fail('Candidate override changed.')
    prepared=next((p for p in phases if p['phase']=='prepared'),None)
    old=json.loads(run(compose_prefix(op)+['config','--format','json']))
    new=json.loads(run(compose_prefix(op,(override,))+['config','--format','json']))
    image=result_image(d); expected=copy.deepcopy(old); expected.setdefault('services',{}).setdefault('app',{})['image']=image
    if new!=expected or sha(canonical({'before':old,'after':new}))!=prepared['payload']['composeDeltaSha256']: fail('Compose config changed after prepare or differs outside services.app.image.')
    verify_app_environment(old,R9_IMAGE)
    verify_build_guard(baseline,current_baseline(release))
    before=current_baseline(release); verify_build_guard(baseline,before)
    preproof=metadata_proof(APP); verify_migration_set(preproof,release)
    if preproof!=baseline['metadataProof'] or migration_bundle_hash(APP)!=op['predecessor']['migrationBundleSha256']: fail('Pre-activation migration/schema proof differs from r9.')
    pre={'snapshot':before,'metadataProof':preproof}
    write_fixed(d/'pre-activation.json',canonical(pre))
    _,head=append_phase(d,op,phases,head,'activating',{'preflightSnapshotSha256':sha(canonical(pre)),'metadataProof':pre['metadataProof'],'qaSha256':op['qaSha256']})
    subprocess.run(compose_prefix(op,(override,))+['up','-d','--no-deps','--no-build','--wait','--wait-timeout','180','app'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=210,env=compose_env())
    after=current_baseline(release); app=after['ownedAppGateway']['app']
    verify_app_only_result(baseline,after,image)
    verify_compose_labels((override,))
    verify_app_environment(new,image)
    proof=metadata_proof(APP); verify_migration_set(proof,release)
    if proof!=pre['metadataProof']: fail('Migration/schema metadata changed during activation.')
    post={'snapshot':after,'metadataProof':proof}; write_exclusive(d/'post-activation.json',canonical(post))
    _,head=append_phase(d,op,phases+[{'phase':'activating'}],head,'activated',{'appImageId':image,'appContainerId':app['id'],'metadataProof':proof,'postSnapshotSha256':sha(canonical(post)),'externalChecksPassed':True})

def result_image(d):
    result,_=safe_json(d/'build-result.json'); return result['imageId']
def _rollback(opid):
    d,op,phases,head,baseline=load(opid)
    state=phases[-1]['phase']
    if state not in ('activating','activated','rolling_back'): fail('Rollback requires an activation intent or activated state.')
    candidate_extra=operation_dir(opid)/'candidate.override.yml'; rollback_extra=operation_dir(opid)/'rollback.override.yml'
    verify_pinned_inputs(op,baseline,(None,candidate_extra,rollback_extra))
    release=Path(op['candidate']['path']); current=current_baseline(release); app=current['ownedAppGateway']['app']
    image=app.get('imageId')
    if image not in (R9_IMAGE,result_image(d)): fail('Unknown app image/configuration; manual recovery is required.')
    verify_compose_labels((None,candidate_extra,rollback_extra) if image==R9_IMAGE else (candidate_extra,))
    drift=verify_rollback_boundary(baseline,current)
    original=json.loads(run(compose_prefix(op)+['config','--format','json']))
    if original.get('services',{}).get('app',{}).get('image')!=R9_IMAGE: fail('Original Compose chain no longer resolves to exact r9.')
    current_config=original
    if image!=R9_IMAGE:
        candidate_config=json.loads(run(compose_prefix(op,(candidate_extra,))+['config','--format','json']))
        candidate_expected=copy.deepcopy(original); candidate_expected['services']['app']['image']=result_image(d)
        if candidate_config!=candidate_expected: fail('Candidate Compose chain changed outside the app image.')
        current_config=candidate_config
    verify_app_environment(current_config,image)
    resolved=run(['docker','image','inspect','--format','{{.Id}}',R9_IMAGE],timeout=15).strip()
    if resolved!=R9_IMAGE: fail('Exact r9 predecessor image is unavailable.')
    no_op=image==R9_IMAGE
    payload={'observedImageId':image,'noOp':no_op}
    if state!='rolling_back' or not no_op:
        phase,head=append_phase(d,op,phases,head,'rolling_back',payload); phases=phases+[phase]
    if not no_op:
        rollback_override=d/'rollback.override.yml'
        if not rollback_override.exists(): write_exclusive(rollback_override,('services:\n  app:\n    image: "'+R9_IMAGE+'"\n').encode(),0o644)
        elif rollback_override.read_bytes()!=('services:\n  app:\n    image: "'+R9_IMAGE+'"\n').encode(): fail('Rollback override was modified.')
        subprocess.run(compose_prefix(op,(rollback_override,))+['up','-d','--no-deps','--no-build','--wait','--wait-timeout','180','app'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=210,env=compose_env())
    deadline=time.monotonic()+180; pinned_id=app['id'] if no_op else None
    while True:
        app_id,image_id,configured,running,health=inspect_app_health()
        if image_id!=R9_IMAGE or configured!=R9_IMAGE: fail('Restored app identity is not the exact r9 image.')
        if pinned_id is None: pinned_id=app_id
        elif app_id!=pinned_id: fail('r9 app identity changed while health was converging.')
        if running and health=='healthy': break
        if time.monotonic()>=deadline: fail('r9 app health did not converge within 180 seconds.')
        time.sleep(2)
    restored=current_baseline(release); app=restored['ownedAppGateway']['app']
    verify_rollback_boundary(baseline,restored)
    verify_app_environment(original,R9_IMAGE)
    if not no_op: verify_compose_labels((rollback_extra,))
    proof=metadata_proof(APP); verify_migration_set(proof,release)
    if proof!=baseline['metadataProof']: fail('Migration/schema metadata differs after rollback.')
    drift=verify_rollback_boundary(baseline,restored)
    _,head=append_phase(d,op,phases,head,'rolled_back',{'appImageId':R9_IMAGE,'appContainerId':app['id'],'metadataProof':proof,'externalChecksPassed':not drift,'externalDrift':drift,'noOp':no_op})

def _status(opid):
    d,op,phases,head,baseline=load(opid); first=head
    app_id,image_id,configured,running,health=inspect_app_health()
    _,again,head2=validate_chain(d)
    if head2!=first: fail('Operation changed while status was read.')
    lock_present=LOCK.exists() or LOCK.is_symlink()
    print(json.dumps({'operationId':opid,'phase':phases[-1]['phase'],'appId':app_id,'appImageId':image_id,'configuredImage':configured,'appRunning':running,'appHealth':health,'lockPresent':lock_present,'nextAction':{'captured':'build','building':'manual-recovery','built':'prepare','prepared':'activate','activating':'rollback','activated':'rollback','rolling_back':'rollback','rolled_back':'none'}.get(phases[-1]['phase'],'manual-recovery')},sort_keys=True))

def inspect_app_health():
    output=run(['docker','inspect','--format','{{.Id}}|{{.Image}}|{{.Config.Image}}|{{.State.Running}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}',APP],timeout=10).strip()
    fields=output.split('|')
    if len(fields)!=5 or not re.fullmatch(r'[0-9a-f]{64}',fields[0]) or not IMAGE_RE.fullmatch(fields[1]) or fields[3] not in ('true','false') or fields[4] not in ('healthy','unhealthy','starting','none'): fail('Owned app health inspection returned malformed metadata.')
    return fields[0],fields[1],fields[2],fields[3]=='true',fields[4]

def main(argv=None):
    p=argparse.ArgumentParser(description=__doc__); sub=p.add_subparsers(dest='action',required=True)
    c=sub.add_parser('capture'); c.add_argument('--release',type=Path,required=True); c.add_argument('--manifest-sha256',required=True); c.add_argument('--qa-sha256',required=True)
    for action in ('build','prepare','activate','rollback','status'):
        x=sub.add_parser(action); x.add_argument('--operation-id',required=True)
    a=p.parse_args(argv)
    try:
        if a.action=='status': return _status(a.operation_id)
        with lock_context() as held:
            if a.action=='capture': return capture(a.release,a.manifest_sha256,a.qa_sha256)
            if a.action=='build': return _build(a.operation_id,held)
            return {'prepare':_prepare,'activate':_activate,'rollback':_rollback}[a.action](a.operation_id)
    except (Refusal,LockRefusal) as e:
        print('release operation refused: '+str(e),file=sys.stderr); return 2
if __name__=='__main__': raise SystemExit(main())

