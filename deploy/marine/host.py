#!/usr/bin/env python3
"""Fail-closed, fixed-target Caddy deployment state machine for Bambola."""
from __future__ import annotations
import argparse, hashlib, json, os, re, subprocess, sys, time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path
import stat
import tempfile

ROOT=Path('/opt/bambola-arm'); EVIDENCE=ROOT/'evidence'; RELEASES=ROOT/'releases'
CADDYFILE=Path('/opt/heili/app/infra/Caddyfile'); CADDY='second-brain-caddy-1'
DOMAIN='bambola.heili.cloud'; PROJECT='bambola-arm'
EXPECTED_BASE='4da4ca1fe5a6c3949016a2660d7fbef9bef26d49459ea262b35f8f4a128fb001'
IMAGE='sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648'
NODE_IMAGE='docker.io/library/node:22-alpine@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284'
ROUTES=['hair.heili.cloud/oggi','app.heili.cloud/','api.heili.cloud/','crm.heili.cloud/','whapi.heili.cloud/','openclaw.heili.cloud/','dm.heili.cloud/','paperclip.heili.cloud/','look.hairextensionclinic.it/','approve.heili.cloud/','work.heili.cloud/']

class Refusal(RuntimeError):
    """Invalid target or concurrent state: exit status 2, with no overwrite."""

def sha(data):
    return hashlib.sha256(data).hexdigest()


def private(path,data):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    path.write_bytes(data)
    path.chmod(0o600)


def run(args, **kw):
    return subprocess.run(args, check=True, text=True, capture_output=True, **kw).stdout


def state_path():
    return EVIDENCE / 'state.json'


def read_state():
    state=json.loads(state_path().read_text())
    if state.get('version')!=1 or state.get('root')!=str(ROOT) or state.get('project')!=PROJECT or state.get('domain')!=DOMAIN:
        raise Refusal('Deployment state target mismatch; refusing operation.')
    return state


def save_state(state):
    target = state_path()
    if target.is_symlink():
        raise Refusal('Deployment state must not be a symlink.')
    if target.exists():
        current = json.loads(target.read_text(encoding='utf-8'))
        if current.get('dns_intent') is True and state.get('dns_intent') is not True:
            raise Refusal('DNS intent is monotonic and cannot be cleared.')
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.state-', delete=False) as stream:
        temp_path = Path(stream.name)
        stream.write((json.dumps(state, sort_keys=True, indent=2) + '\n').encode())
        stream.flush()
        os.fsync(stream.fileno())
    temp_path.chmod(0o600)
    os.replace(temp_path, target)
    target.chmod(0o600)
    directory_fd = os.open(target.parent, os.O_RDONLY)
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def dns_marker_path():
    return EVIDENCE / 'dns-added.json'


def dns_marker_present():
    return os.path.lexists(dns_marker_path())


def require_dns_marker(state):
    path = dns_marker_path()
    if path.parent.is_symlink() or path.is_symlink():
        raise Refusal('DNS evidence must not be a symlink.')
    try:
        metadata = path.lstat()
    except FileNotFoundError as error:
        raise Refusal('DNS evidence is missing.') from error
    if not stat.S_ISREG(metadata.st_mode) or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise Refusal('DNS evidence must be a regular 0600 file.')
    try:
        marker = json.loads(path.read_text(encoding='utf-8'))
        timestamp = datetime.fromisoformat(marker['captured_at_iso'].replace('Z', '+00:00'))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError, KeyError, TypeError, ValueError, AttributeError) as error:
        raise Refusal('DNS evidence schema is invalid.') from error
    digest_keys = ('before_other_rrsets_sha256', 'after_other_rrsets_sha256',
                   'manifest_sha256', 'state_base_hash')
    if not isinstance(marker, dict) or set(marker) != {
            'version', 'domain', 'zone', 'name', 'type', 'address', 'ttl',
            *digest_keys, 'captured_at_iso'}:
        raise Refusal('DNS evidence schema is invalid.')
    if (type(marker['version']) is not int or marker['version'] != 1
            or marker['domain'] != DOMAIN or marker['zone'] != 'heili.cloud'
            or marker['name'] != 'bambola' or marker['type'] != 'A'
            or marker['address'] != '186.241.16.46' or type(marker['ttl']) is not int or marker['ttl'] != 300
            or marker['manifest_sha256'] != state['manifest_sha256']
            or marker['state_base_hash'] != state['base_hash']
            or marker['before_other_rrsets_sha256'] != marker['after_other_rrsets_sha256']
            or timestamp.tzinfo is None):
        raise Refusal('DNS evidence does not match the approved DNS change.')
    if any(not isinstance(marker[key], str) or not re.fullmatch(r'[0-9a-f]{64}', marker[key])
           for key in digest_keys):
        raise Refusal('DNS evidence digest is invalid.')
    return marker


def route_probe(url):
    p=subprocess.run(['curl','-sS','--max-time','10','-D','-','-o','/dev/null','-w','\nSTATUS:%{http_code}', 'https://'+url],text=True,capture_output=True)
    m=re.search(r'STATUS:(\d+)',p.stdout)
    loc=None
    for line in p.stdout.splitlines():
        if line.lower().startswith('location:'): loc=line.split(':',1)[1].strip()
    return {'status': int(m.group(1)) if m else 0, 'location': loc,
            'ok': p.returncode == 0 and bool(m)}


def routes_snapshot():
    with ThreadPoolExecutor(max_workers=len(ROUTES)) as pool:
        values=pool.map(route_probe,ROUTES)
    return dict(zip(ROUTES, values))


def containers_snapshot():
    ids=run(['docker','ps','-aq']).splitlines()
    if not ids:return []
    arr=json.loads(run(['docker','inspect',*ids]))
    snapshots = []
    for container in arr:
        name = container['Name'].lstrip('/')
        if name.startswith(PROJECT) or name == 'buildx_buildkit_bambola-arm-builder0':
            continue
        snapshots.append({
            'name': container['Name'],
            'id': container['Id'],
            'started': container['State']['StartedAt'],
            'restarts': container['RestartCount'],
            'running': container['State']['Running'],
            'health': container['State'].get('Health', {}).get('Status'),
        })
    return sorted(snapshots, key=lambda item: item['name'])


def verify_invariants(s, label):
    if containers_snapshot() != s['containers']:
        raise Refusal('Pre-existing container state changed; refusing mutation.')
    current_routes = routes_snapshot()
    baseline_routes = s['routes']
    for url, result in current_routes.items():
        if not result['ok']:
            raise RuntimeError('TLS or network probe failed: ' + url)
        if url == 'app.heili.cloud/':
            if result not in s['app_pairs'] or result['status'] not in (200, 307):
                raise Refusal('app.heili.cloud pair outside recorded preflight set.')
        elif result != baseline_routes[url]:
            raise Refusal('Pre-existing route changed: ' + url)
    evidence = json.dumps(current_routes, sort_keys=True, indent=2) + '\n'
    private(EVIDENCE / (label + '.json'), evidence.encode())
def baseline(manifest_digest):
    if not re.fullmatch(r'[0-9a-f]{64}',manifest_digest or ''):
        raise Refusal('A reviewed source manifest SHA-256 is required.')
    EVIDENCE.mkdir(mode=0o700,parents=True,exist_ok=True)
    EVIDENCE.chmod(0o700)
    if state_path().exists(): raise Refusal('Baseline already exists; refusing overwrite.')
    caddy=json.loads(run(['docker','inspect',CADDY]))[0]
    if caddy['Image']!=IMAGE: raise Refusal('Shared Caddy image does not match reviewed image.')
    raw=CADDYFILE.read_bytes()
    if sha(raw)!=EXPECTED_BASE: raise Refusal('Shared Caddy config differs from reviewed baseline.')
    samples=[]
    for i in range(10):
        samples.append(routes_snapshot())
        if i<9: time.sleep(1)
    app_pairs=[]
    for sample in samples:
        pair=sample['app.heili.cloud/']
        if not pair['ok'] or pair['status'] not in (200,307): raise RuntimeError('app.heili.cloud baseline invalid.')
        if pair not in app_pairs: app_pairs.append(pair)
    if any(not r['ok'] for row in samples for u,r in row.items() if u!='app.heili.cloud/'): raise RuntimeError('Route/TLS preflight failed.')
    env={}
    for item in caddy['Config'].get('Env',[]):
        k,_,v=item.partition('=')
        if k in ('APP_DOMAIN','API_DOMAIN','LETSENCRYPT_EMAIL'): env[k]=v
    if len(env)!=3: raise RuntimeError('Shared Caddy validation environment incomplete.')
    private(EVIDENCE/'Caddyfile.before',raw)
    private(EVIDENCE/'caddy-validation.env',''.join(k+'='+v+'\n' for k,v in env.items()).encode())
    s={'version':1,'phase':'baseline','root':str(ROOT),'project':PROJECT,'domain':DOMAIN,'manifest_sha256':manifest_digest,'dns_intent':False,'base_hash':sha(raw),'inode':CADDYFILE.stat().st_ino,'expected_hash':sha(raw),'containers':containers_snapshot(),'routes':{k:v for k,v in samples[-1].items() if k!='app.heili.cloud/'},'app_pairs':app_pairs,'image':IMAGE}
    s['routes']['app.heili.cloud/']=app_pairs[0]
    # Keep every observed pair while requiring each future pair be one of them.
    s['app_pairs']=app_pairs
    save_state(s)
    private(EVIDENCE/'preflight-routes.json',(json.dumps(samples,sort_keys=True,indent=2)+'\n').encode())
    print('Baseline captured; secrets and response bodies were not recorded.')
def candidate(kind):
    s=read_state()
    old=(EVIDENCE/'Caddyfile.before').read_bytes()
    if sha(old)!=s['base_hash']:
        raise Refusal('Saved Caddy baseline hash mismatch.')
    blocks={
        'active': b'''bambola.heili.cloud {
    reverse_proxy bambola-arm-gateway:8080 {
        header_up -Forwarded
        header_up -X-Real-IP
        header_up X-Forwarded-For {http.request.remote.host}
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host bambola.heili.cloud
        header_up Host bambola.heili.cloud
    }
}''',
        'maintenance': b'''bambola.heili.cloud {
    respond "Maintenance" 503
}'''
    }
    if kind not in blocks: raise RuntimeError('Unknown candidate type.')
    add=blocks[kind]
    if b'bambola.heili.cloud' in old.lower(): raise Refusal('Bambola route already exists in shared config.')
    new=old+b'\n\n'+add.rstrip()+b'\n'
    path=EVIDENCE/('Caddyfile.'+kind)
    private(path,new)
    p=subprocess.run(['docker','run','--rm','--network','none','--memory','128m','--cpus','0.2','--env-file',str(EVIDENCE/'caddy-validation.env'),'-v',str(path)+':/etc/caddy/Caddyfile:ro',IMAGE,'caddy','validate','--config','/etc/caddy/Caddyfile','--adapter','caddyfile'],capture_output=True)
    private(EVIDENCE/('validate-'+kind+'.log'),p.stdout+p.stderr)
    if p.returncode: raise RuntimeError('Caddy candidate validation failed.')
    s[kind+'_hash']=sha(new); s['phase']='prepared'; save_state(s)
def prepared(kind):
    s=read_state(); p=EVIDENCE/('Caddyfile.'+kind); data=p.read_bytes()
    original=(EVIDENCE/'Caddyfile.before').read_bytes()
    if sha(original)!=s['base_hash'] or not data.startswith(original+b'\n\n') or sha(data)!=s.get(kind+'_hash'):
        raise Refusal('Prepared candidate integrity failure.')
    return s,data
def assert_current(s):
    if CADDYFILE.stat().st_ino!=s['inode'] or sha(CADDYFILE.read_bytes())!=s['expected_hash']:
        raise Refusal('Concurrent Caddy edit; refusing overwrite.')
    original=(EVIDENCE/'Caddyfile.before').read_bytes()
    if sha(original)!=s['base_hash']:
        raise Refusal('Saved Caddy baseline hash mismatch.')


def preserve_maintenance(state):
    return state.get('dns_intent') is True or dns_marker_present()


def require_maintenance_candidate(state):
    candidate = (EVIDENCE / 'Caddyfile.maintenance').read_bytes()
    original = (EVIDENCE / 'Caddyfile.before').read_bytes()
    if (sha(candidate) != state.get('maintenance_hash')
            or sha(original) != state['base_hash']
            or not candidate.startswith(original + b'\n\n')):
        raise Refusal('Recorded maintenance candidate failed integrity check.')
    return candidate


def record_dns_intent():
    state = read_state()
    if state.get('phase') != 'maintenance':
        raise Refusal('DNS intent requires the maintenance phase.')
    if dns_marker_present() and state.get('dns_intent') is not True:
        raise Refusal('DNS evidence appeared before intent was recorded.')
    candidate = require_maintenance_candidate(state)
    assert_current(state)
    if state['expected_hash'] != sha(candidate):
        raise Refusal('DNS intent requires the validated maintenance config to be live.')
    state['dns_intent'] = True
    state['dns_intent_recorded_at'] = datetime.now().astimezone().isoformat()
    save_state(state)
    print('DNS intent recorded. Parent may now perform the approved DNS addition.')


def require_maintenance_tls503():
    result = route_probe(DOMAIN + '/')
    if not result['ok'] or result['status'] != 503:
        raise Refusal('Bambola TLS route must return 503 before activation.')
def mutate(kind,phase):
    s,data=prepared(kind)
    if preserve_maintenance(s):
        require_maintenance_candidate(s)
    verify_invariants(s,'routes-before-'+phase)
    assert_current(s)
    with CADDYFILE.open('wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
    run(['docker','kill','--signal=SIGUSR1',CADDY])
    try:
        if CADDYFILE.stat().st_ino!=s['inode']: raise Refusal('Caddy bind inode changed.')
        time.sleep(3); verify_invariants(s,'routes-after-'+phase)
        if sha(CADDYFILE.read_bytes())!=sha(data): raise Refusal('Concurrent Caddy edit after reload.')
    except Exception:
        if CADDYFILE.stat().st_ino==s['inode'] and sha(CADDYFILE.read_bytes())==sha(data):
            if preserve_maintenance(s):
                fallback=require_maintenance_candidate(s)
            else:
                fallback=(EVIDENCE/'Caddyfile.before').read_bytes()
                if sha(fallback)!=s['base_hash']:
                    raise Refusal('Saved Caddy baseline hash mismatch.')
            with CADDYFILE.open('wb') as f: f.write(fallback); f.flush(); os.fsync(f.fileno())
            run(['docker','kill','--signal=SIGUSR1',CADDY])
            s['expected_hash']=sha(fallback); s['phase']='maintenance' if preserve_maintenance(s) else 'baseline'; save_state(s)
            verify_invariants(s, 'routes-after-failed-mutation-rollback')
        raise
    s=read_state(); s['expected_hash']=sha(data); s['phase']=phase; save_state(s)
    print(phase+' config applied with SIGUSR1; existing services checked.')
def main():
    ap=argparse.ArgumentParser(); ap.add_argument('action',choices=['baseline','check','prepare','maintenance','dns-intent','activate','rollback']); ap.add_argument('--manifest-sha256'); a=ap.parse_args()
    if a.action=='baseline': baseline(a.manifest_sha256); return
    s=read_state()
    if a.action=='check':
        assert_current(s)
        verify_invariants(s,'routes-check')
        if preserve_maintenance(s):
            if s.get('dns_intent') is not True:
                raise Refusal('DNS evidence exists without a recorded DNS intent.')
            require_dns_marker(s)
        if s.get('dns_intent') is True and s['phase'] in ('maintenance','active'):
            own=route_probe(DOMAIN+'/')
            expected=503 if s['phase']=='maintenance' else (200,302,307)
            if not own['ok'] or (own['status']!=expected if isinstance(expected,int) else own['status'] not in expected):
                raise RuntimeError('Bambola public route does not match recorded phase.')
        print('Existing routes and containers match baseline.')
        return
    if a.action=='prepare': candidate('active'); candidate('maintenance'); return
    if a.action=='maintenance': mutate('maintenance','maintenance'); return
    if a.action=='dns-intent': record_dns_intent(); return
    if a.action=='activate':
        if s.get('dns_intent') is not True: raise Refusal('DNS intent is missing; activation refused.')
        require_dns_marker(s)
        if s['phase']!='maintenance': raise Refusal('Activation requires validated maintenance phase.')
        require_maintenance_tls503()
        mutate('active','active'); return
    if a.action=='rollback':
        if preserve_maintenance(s):
            if s.get('dns_intent') is not True and dns_marker_present():
                s['dns_intent'] = True
                s['dns_intent_recorded_at'] = datetime.now().astimezone().isoformat()
                save_state(s)
            mutate('maintenance','maintenance')
            return
        if containers_snapshot()!=s['containers']:
            raise Refusal('Pre-existing container state changed; refusing rollback.')
        data=(EVIDENCE/'Caddyfile.before').read_bytes()
        assert_current(s)
        if sha(data)!=s['base_hash']:
            raise Refusal('Saved Caddy baseline hash mismatch.')
        with CADDYFILE.open('wb') as f: f.write(data); f.flush(); os.fsync(f.fileno())
        run(['docker','kill','--signal=SIGUSR1',CADDY]); verify_invariants(s,'routes-after-rollback')
        s['expected_hash']=sha(data); s['phase']='baseline'; save_state(s)
        print('Original config restored before DNS; shared Caddy not restarted.')
if __name__=='__main__':
    os.umask(0o077)
    try: main()
    except Refusal as e:
        print('host operation refused: '+str(e),file=sys.stderr); raise SystemExit(2)
    except Exception as e:
        print('host operation failed ('+type(e).__name__+'); private evidence retained.',file=sys.stderr)
        raise SystemExit(1)

