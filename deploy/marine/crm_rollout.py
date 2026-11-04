#!/usr/bin/env python3
"""Prepare, activate, or restore only Bambola CRM app and gateway services."""
from __future__ import annotations

import argparse
import copy
import hashlib
import ipaddress
import json
import os
import re
import subprocess
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import crm_host
from release_lock import LockRefusal, ReleaseLock

ROOT = Path('/opt/bambola-arm')
RUNTIME = ROOT / 'runtime'
RELEASES = ROOT / 'releases'
BASE_COMPOSE = RELEASES / '20261102-r5/deploy/marine/compose.ubuntu.yml'
ENV_FILE = RUNTIME / 'runtime.env'
PANEL_OVERRIDE = RUNTIME / 'panels-20261102.override.yml'
STATE_DIR = crm_host.EVIDENCE
PLAN = STATE_DIR / 'activation-plan.json'
LOCK = STATE_DIR / 'activation.lock'
OP_LOCK = ROOT / 'evidence' / 'crm-recovery-operation.lock'
APP = crm_host.APP_NAME
GATEWAY = crm_host.GATEWAY_NAME
CADDY = crm_host.CADDY_NAME
PROJECT = 'bambola-arm'
DOMAIN = 'bambola.heili.cloud'
FRONTEND_NETWORK = 'second-brain_frontend'
IMAGE_RE = re.compile(r'^sha256:[0-9a-f]{64}$')
SHA_RE = re.compile(r'^[0-9a-f]{64}$')

class Refusal(RuntimeError):
    pass


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def safe_run(args: list[str], *, timeout: int = 30) -> str:
    try:
        result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.SubprocessError) as exc:
        raise Refusal('A fixed Bambola verification command failed.') from exc
    return result.stdout


def private_file(path: Path, data: bytes, mode: int = 0o600) -> None:
    if path.exists() or path.is_symlink():
        raise Refusal('A planned release file already exists; refusing overwrite.')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), mode)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    if os.name == 'posix':
        os.chmod(path, mode)


def prepared_file(path: Path, data: bytes, mode: int) -> None:
    if path.exists() or path.is_symlink():
        if path.is_symlink() or not path.is_file() or path.read_bytes() != data:
            raise Refusal('A prepared Bambola artifact exists with unexpected contents.')
        if os.name == 'posix' and path.stat().st_mode & 0o777 != mode:
            raise Refusal('A prepared Bambola artifact has unsafe permissions.')
        return
    private_file(path,data,mode)


@contextmanager
def operation_lock():
    try:
        with ReleaseLock(OP_LOCK) as held:
            yield held
    except LockRefusal as exc:
        raise Refusal('Another Bambola rollout operation is in progress or its lock identity changed.') from exc


def read_plan(manifest: str, snapshot_hash: str) -> dict:
    if PLAN.is_symlink() or not PLAN.is_file() or (os.name == 'posix' and PLAN.stat().st_mode & 0o777 != 0o600):
        raise Refusal('Private activation plan is missing or unsafe.')
    try:
        plan = json.loads(PLAN.read_text(encoding='utf-8'))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise Refusal('Activation plan is malformed.') from exc
    required = {'schemaVersion','phase','createdAt','manifestSha256','snapshotSha256','release','imageId','imageLabel',
                'previousApp','previousGateway','sharedCaddyIP','oldGateway','newGateway','override','compose'}
    if not isinstance(plan, dict) or set(plan) != required or plan['schemaVersion'] != 1:
        raise Refusal('Activation plan schema is invalid.')
    if plan['manifestSha256'] != manifest or plan['snapshotSha256'] != snapshot_hash:
        raise Refusal('Activation plan is not bound to the supplied release and fresh baseline.')
    if plan['imageLabel'] != manifest or not IMAGE_RE.fullmatch(plan['imageId'] or ''):
        raise Refusal('Activation plan app image/manifest label is invalid.')
    snapshot=crm_host._snapshot_read(manifest, snapshot_hash)
    release=crm_host._manifest_release(Path(plan['release']),manifest)
    expected_release=Path(snapshot['configFiles']['compose']['path']).parents[2]
    if release != expected_release:
        raise Refusal('Activation plan release path differs from the snapshot-pinned source.')
    expected_compose={'base':str(BASE_COMPOSE),'baseSha256':snapshot['configFiles']['pinnedBaseCompose']['sha256'],
        'panel':str(PANEL_OVERRIDE),'panelSha256':snapshot['configFiles']['runtimeOverride'].get('sha256'),
        'env':str(ENV_FILE),'envSha256':snapshot['configFiles']['runtimeEnv']['sha256'],
        'envStat':plan['compose'].get('envStat')}
    if plan['compose'] != expected_compose:
        raise Refusal('Activation plan compose paths/hashes are not the fixed Bambola inputs.')
    st=ENV_FILE.stat()
    if (plan['compose']['envStat'] != {'inode':st.st_ino,'size':st.st_size,'mtimeNs':st.st_mtime_ns}
            or sha(ENV_FILE.read_bytes()) != plan['compose']['envSha256']):
        raise Refusal('Bambola runtime environment file identity changed.')
    for path,digest in ((BASE_COMPOSE,plan['compose']['baseSha256']),(PANEL_OVERRIDE,plan['compose']['panelSha256'])):
        if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != digest:
            raise Refusal('Pinned Bambola compose input changed.')
    if plan['previousApp'] != snapshot['ownedAppGateway']['app'] or plan['previousGateway'] != snapshot['ownedAppGateway']['gateway']:
        raise Refusal('Activation plan previous images differ from the pinned baseline.')
    if plan['sharedCaddyIP'] != frontend_caddy_ip(snapshot):
        raise Refusal('Activation plan trusted proxy address differs from snapshot metadata.')
    if plan['oldGateway'] != snapshot['configFiles']['runtimeGateway']:
        raise Refusal('Activation plan previous gateway config differs from the baseline.')
    if plan['newGateway']['path'] != str(RUNTIME / f'gateway-crm-{manifest[:12]}.Caddyfile') or plan['override']['path'] != str(RUNTIME / f'crm-{manifest[:12]}.override.yml'):
        raise Refusal('Activation plan config artifact paths are not the fixed release paths.')
    if not SHA_RE.fullmatch(plan['newGateway']['sha256']) or not SHA_RE.fullmatch(plan['override']['sha256']):
        raise Refusal('Activation plan config digests are malformed.')
    return plan


def frontend_caddy_ip(snapshot: dict) -> str:
    networks = [n for n in snapshot['networks'] if n.get('name') == FRONTEND_NETWORK]
    if len(networks) != 1:
        raise Refusal('The trusted shared frontend network is missing or ambiguous.')
    peers = [v for v in (networks[0].get('containers') or {}).values() if v.get('name') == CADDY]
    if len(peers) != 1 or not peers[0].get('ipv4Address'):
        raise Refusal('Shared Caddy IPv4 identity is missing or ambiguous.')
    try:
        addr = ipaddress.ip_interface(peers[0]['ipv4Address']).ip
    except ValueError as exc:
        raise Refusal('Shared Caddy IPv4 address is invalid.') from exc
    if addr.version != 4:
        raise Refusal('Shared Caddy address must be IPv4.')
    return str(addr)


def inspect_image(image_id: str, manifest: str) -> None:
    if not IMAGE_RE.fullmatch(image_id or '') or not SHA_RE.fullmatch(manifest or ''):
        raise Refusal('Built image or release manifest digest is invalid.')
    output = safe_run(['docker','image','inspect','--format','{{.Id}} {{index .Config.Labels "heili.source-manifest"}}',image_id])
    if output.strip().split() != [image_id, manifest]:
        raise Refusal('Built app image does not match the reviewed release manifest.')


def write_plan_files(release: Path, manifest: str, image_id: str, snapshot: dict, snapshot_hash: str) -> dict:
    template_path = release / 'deploy/marine/gateway.crm.Caddyfile.template'
    template = template_path.read_text(encoding='utf-8')
    ip = frontend_caddy_ip(snapshot)
    if template.count('__SHARED_IPV4__') != 1:
        raise Refusal('Gateway template placeholder count is invalid.')
    gateway_bytes = template.replace('__SHARED_IPV4__', ip).encode('utf-8')
    tag = manifest[:12]
    gateway_path = RUNTIME / f'gateway-crm-{tag}.Caddyfile'
    override_path = RUNTIME / f'crm-{tag}.override.yml'
    runtime_gateway = snapshot['configFiles']['runtimeGateway']
    old_gateway_path = Path(runtime_gateway['path'])
    if str(old_gateway_path) != str(RUNTIME / 'gateway.Caddyfile') or sha(old_gateway_path.read_bytes()) != runtime_gateway['sha256']:
        raise Refusal('Previous Bambola gateway configuration does not match the baseline pin.')
    new_gateway_sha = sha(gateway_bytes)
    override = (
        'services:\n'
        '  app:\n'
        f'    image: "{image_id}"\n'
        '    environment:\n'
        '      APP_WORKSPACE: marine\n'
        '  gateway:\n'
        '    volumes:\n'
        f'      - "{gateway_path}:/etc/caddy/Caddyfile:ro"\n'
    ).encode('utf-8')
    prepared_file(gateway_path, gateway_bytes, 0o444)
    prepared_file(override_path, override, 0o600)
    old_app, old_gateway = snapshot['ownedAppGateway']['app'], snapshot['ownedAppGateway']['gateway']
    if not IMAGE_RE.fullmatch(old_app.get('imageId') or '') or not IMAGE_RE.fullmatch(old_gateway.get('imageId') or ''):
        raise Refusal('Previous Bambola image IDs are not immutable SHA-256 identities.')
    base_hash = sha(BASE_COMPOSE.read_bytes())
    panel_hash = sha(PANEL_OVERRIDE.read_bytes())
    if (base_hash != snapshot['configFiles']['pinnedBaseCompose']['sha256']
            or str(BASE_COMPOSE) != snapshot['configFiles']['pinnedBaseCompose']['path']
            or str(PANEL_OVERRIDE) != snapshot['configFiles']['runtimeOverride']['path']
            or panel_hash != snapshot['configFiles']['runtimeOverride'].get('sha256')
            or sha(ENV_FILE.read_bytes()) != snapshot['configFiles']['runtimeEnv']['sha256']):
        raise Refusal('The pinned r5 compose or current panel override differs from the fresh baseline.')
    return {
        'schemaVersion':1,'phase':'plan','createdAt':datetime.now(timezone.utc).isoformat(),
        'manifestSha256':manifest,'snapshotSha256':snapshot_hash,'release':str(release),'imageId':image_id,'imageLabel':manifest,
        'previousApp':old_app,'previousGateway':old_gateway,'sharedCaddyIP':ip,
        'oldGateway':{'path':str(old_gateway_path),'sha256':runtime_gateway['sha256']},
        'newGateway':{'path':str(gateway_path),'sha256':new_gateway_sha},
        'override':{'path':str(override_path),'sha256':sha(override)},
        'compose':{'base':str(BASE_COMPOSE),'baseSha256':base_hash,'panel':str(PANEL_OVERRIDE),'panelSha256':panel_hash,
            'env':str(ENV_FILE),'envSha256':snapshot['configFiles']['runtimeEnv']['sha256'],
            'envStat':{'inode':ENV_FILE.stat().st_ino,'size':ENV_FILE.stat().st_size,'mtimeNs':ENV_FILE.stat().st_mtime_ns}},
    }


def compose_prefix(plan: dict, overrides: list[str]) -> list[str]:
    args = ['docker','compose','--project-name',PROJECT,'--env-file',plan['compose']['env'],
            '-f',plan['compose']['base'],'-f',plan['compose']['panel']]
    for override in overrides:
        args += ['-f', override]
    return args


def compose_up_args(plan: dict, overrides: list[str]) -> list[str]:
    return compose_prefix(plan, overrides) + ['up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'app', 'gateway']


def render_compose(plan: dict, overrides: list[str]) -> dict:
    result = subprocess.run(compose_prefix(plan, overrides)+['config','--format','json'],
                            check=False,capture_output=True,text=True,timeout=45)
    if result.returncode:
        raise Refusal('Bambola compose configuration could not be validated.')
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise Refusal('Bambola compose configuration is malformed.') from exc


def find_volume(config: dict, service: str) -> dict:
    volumes = config['services'][service].get('volumes', [])
    hits = [v for v in volumes if v.get('target') == '/etc/caddy/Caddyfile'] if service == 'gateway' else []
    if service != 'gateway' or len(hits) != 1:
        raise Refusal('Gateway must have exactly one Caddyfile mount.')
    return hits[0]


def validate_network_safety(config: dict) -> None:
    services, networks = config.get('services', {}), config.get('networks', {})
    if set(services) != {'app','gateway','postgres'}:
        raise Refusal('Compose service inventory changed.')
    for name in ('app','gateway'):
        service = services[name]
        if service.get('ports'):
            raise Refusal('Bambola app/gateway may not publish host ports.')
        if service.get('privileged') or service.get('network_mode') == 'host':
            raise Refusal('Bambola app/gateway isolation changed.')
    if not networks.get('bambola_edge',{}).get('internal') or not networks.get('bambola_data',{}).get('internal'):
        raise Refusal('Bambola edge/data networks must remain internal.')
    if networks.get('second-brain_frontend',{}).get('external') is not True:
        raise Refusal('Only the existing shared frontend network may be external.')
    if set(services['app'].get('networks',{})) != {'bambola_edge','bambola_data'}:
        raise Refusal('App must remain only on its private edge and data networks.')
    if set(services['gateway'].get('networks',{})) != {'bambola_edge','second-brain_frontend'}:
        raise Refusal('Gateway must remain on private edge and existing shared frontend only.')
    if set(services['postgres'].get('networks',{})) != {'bambola_data'}:
        raise Refusal('Database must remain only on the private data network.')


def validate_compose_delta(old: dict, candidate: dict, *, expected_image: str, expected_gateway: str, profile: str) -> None:
    validate_network_safety(candidate)
    if old.get('services',{}).get('app',{}).get('environment',{}).get('APP_WORKSPACE') not in (None,''):
        raise Refusal('The recorded pre-release profile was not the expected default.')
    if candidate['services']['app'].get('image') != expected_image:
        raise Refusal('Compose app image does not match the pinned image ID.')
    if candidate['services']['app'].get('environment',{}).get('APP_WORKSPACE') != profile:
        raise Refusal('Compose workspace profile is not the expected value.')
    old_mount, new_mount = find_volume(old,'gateway'), find_volume(candidate,'gateway')
    if Path(new_mount.get('source','')) != Path(expected_gateway) or new_mount.get('read_only') is not True:
        raise Refusal('Gateway Caddyfile mount does not match the immutable plan.')
    old_norm,new_norm = copy.deepcopy(old),copy.deepcopy(candidate)
    old_norm['services']['app']['image'] = new_norm['services']['app']['image'] = '<expected-app-image>'
    for config in (old_norm,new_norm):
        config['services']['app'].get('environment',{}).pop('APP_WORKSPACE',None)
    old_find,new_find=find_volume(old_norm,'gateway'),find_volume(new_norm,'gateway')
    old_find['source']=new_find['source']='<expected-gateway-file>'
    if old_norm != new_norm:
        raise Refusal('Effective Compose config changes settings outside app image/profile and gateway file mount.')


def _prepare(release_path: Path, manifest: str, snapshot_hash: str, image_id: str) -> dict:
    if PLAN.exists() or PLAN.is_symlink():
        raise Refusal('Activation plan already exists; refusing overwrite.')
    release = crm_host._manifest_release(release_path, manifest)
    snapshot = crm_host._snapshot_read(manifest, snapshot_hash)
    crm_host.check_current(manifest, snapshot_hash)
    for path in (RUNTIME,ENV_FILE,BASE_COMPOSE,PANEL_OVERRIDE):
        if path.is_symlink() or (path == RUNTIME and not path.is_dir()) or (path != RUNTIME and not path.is_file()):
            raise Refusal('A fixed Bambola runtime/compose input is missing or unsafe.')
    if os.name == 'posix' and (ENV_FILE.stat().st_mode & 0o777 != 0o600 or RUNTIME.stat().st_mode & 0o777 != 0o700):
        raise Refusal('The Bambola runtime directory/environment file must remain private.')
    inspect_image(image_id, manifest)
    plan = write_plan_files(release,manifest,image_id,snapshot,snapshot_hash)
    old_config = render_compose(plan, [])
    new_config = render_compose(plan, [plan['override']['path']])
    if old_config['services']['app'].get('image') != plan['previousApp']['configuredImage'] or old_config['services']['gateway'].get('image') != plan['previousGateway']['configuredImage']:
        raise Refusal('Pinned Compose images differ from the running Bambola services.')
    validate_network_safety(old_config)
    if Path(find_volume(old_config,'gateway').get('source','')) != Path(plan['oldGateway']['path']):
        raise Refusal('Current Compose gateway mount differs from the snapshot-pinned prior config.')
    validate_compose_delta(old_config,new_config,expected_image=image_id,expected_gateway=plan['newGateway']['path'],profile='marine')
    if sha(Path(plan['newGateway']['path']).read_bytes()) != plan['newGateway']['sha256'] or sha(Path(plan['override']['path']).read_bytes()) != plan['override']['sha256']:
        raise Refusal('Prepared config digest changed before activation plan creation.')
    private_file(PLAN,(json.dumps(plan,sort_keys=True,indent=2)+'\n').encode(),0o600)
    return _phase_update(plan,'plan','prepared')


def prepare(release_path: Path, manifest: str, snapshot_hash: str, image_id: str) -> dict:
    with operation_lock():
        return _prepare(release_path, manifest, snapshot_hash, image_id)


def _remove_own(records: list[dict]) -> list[dict]:
    return [r for r in records if r.get('name') not in (APP,GATEWAY)]


def verify_external_unchanged(baseline: dict, current: dict) -> None:
    if current['caddy'] != baseline['caddy']:
        raise Refusal('Shared Caddy changed; refusing to continue or restore.')
    if _remove_own(baseline['containers']) != _remove_own(current['containers']):
        raise Refusal('An external or non-target container changed; refusing to continue or restore.')
    def stripped(networks: list[dict]) -> list[dict]:
        result=copy.deepcopy(networks)
        for net in result:
            net['containers']={k:v for k,v in net.get('containers',{}).items() if v.get('name') not in (APP,GATEWAY)}
        return result
    if stripped(baseline['networks']) != stripped(current['networks']):
        raise Refusal('An external network or endpoint changed; refusing to continue or restore.')
    if baseline.get('configFiles') != current.get('configFiles'):
        raise Refusal('A baseline-pinned source or prior runtime config file changed.')
    resources=current.get('resources',{})
    if resources.get('memAvailableKiB',0) < 768*1024 or resources.get('optFreeKiB',0) < 10*1024*1024:
        raise Refusal('Host resources are below the reviewed minimum.')
    for url, accepted in baseline['routes'].items():
        if url == DOMAIN + '/':
            continue
        now=current['routes'].get(url,[])
        if not now or any(v not in accepted for v in now):
            raise Refusal('A trusted route status/TLS baseline changed; refusing to continue or restore.')


def verify_services(plan: dict, baseline: dict, current: dict, *, rollback: bool = False) -> None:
    verify_external_unchanged(baseline,current)
    expected_app=plan['previousApp'] if rollback else None
    expected_gateway=plan['previousGateway'] if rollback else None
    for key,name,expected_image,expected_configured in (
        ('app',APP,plan['previousApp']['imageId'] if rollback else plan['imageId'],
         plan['previousApp']['configuredImage'] if rollback else plan['imageId']),
        ('gateway',GATEWAY,plan['previousGateway']['imageId'] if rollback else plan['previousGateway']['imageId'],
         plan['previousGateway']['configuredImage']),
    ):
        current_service=current['ownedAppGateway'][key]
        base=baseline['ownedAppGateway'][key]
        if current_service['imageId'] != expected_image or current_service['configuredImage'] != expected_configured:
            raise Refusal(f'Bambola {key} image identity is unexpected.')
        if not current_service['running'] or current_service['health'] != 'healthy':
            raise Refusal(f'Bambola {key} is not healthy.')
        if current_service['ports'] != base['ports'] or any(v for binds in current_service['ports'].values() for v in binds):
            raise Refusal(f'Bambola {key} ports changed or became published.')
        old_networks={n:v['aliases'] for n,v in base['networks'].items()}
        new_networks={n:v['aliases'] for n,v in current_service['networks'].items()}
        if new_networks != old_networks:
            raise Refusal(f'Bambola {key} network attachments or aliases changed.')
        old_runtime=copy.deepcopy(base['runtime'])
        new_runtime=copy.deepcopy(current_service['runtime'])
        if key == 'gateway' and not rollback:
            matching=[m for m in new_runtime.get('mounts',[]) if m.get('Destination') == '/etc/caddy/Caddyfile']
            if len(matching) != 1 or matching[0].get('Source') != plan['newGateway']['path']:
                raise Refusal('New gateway Caddyfile mount is not the pinned file.')
            for mount in old_runtime.get('mounts',[]):
                if mount.get('Destination') == '/etc/caddy/Caddyfile':
                    mount['Source']=plan['newGateway']['path']
        if new_runtime != old_runtime:
            raise Refusal(f'Bambola {key} capabilities, resources, mounts, or runtime settings changed unexpectedly.')
    if rollback:
        profile = safe_run(['docker','exec',APP,'node','-e',"process.stdout.write(process.env.APP_WORKSPACE || '')"],timeout=10)
        if profile.strip():
            raise Refusal('Rollback did not restore the default workspace profile.')
        own_route=current.get('routes',{}).get(DOMAIN+'/',[])
        accepted=baseline.get('routes',{}).get(DOMAIN+'/',[])
        if not own_route or any(item not in accepted for item in own_route):
            raise Refusal('Bambola root route did not return to its recorded baseline.')
    else:
        profile = safe_run(['docker','exec',APP,'node','-e',"process.stdout.write(process.env.APP_WORKSPACE || '')"],timeout=10)
        if profile.strip() != 'marine':
            raise Refusal('Runtime APP_WORKSPACE is not marine.')
        own_route=current.get('routes',{}).get(DOMAIN+'/',[])
        if not own_route or any(item.get('status') != 302 or item.get('tlsVerified') is not True
                                or item.get('location') != 'https://'+DOMAIN+'/dashboard' for item in own_route):
            raise Refusal('Bambola root route did not reach the reviewed CRM dashboard redirect.')


def _phase_update(plan: dict, expected: str, target: str) -> dict:
    try:
        fd=os.open(LOCK,os.O_WRONLY|os.O_CREAT|os.O_EXCL|getattr(os,'O_NOFOLLOW',0),0o600)
    except FileExistsError as exc:
        raise Refusal('Another rollout action holds the activation lock.') from exc
    os.close(fd)
    try:
        raw=PLAN.read_bytes()
        current=json.loads(raw.decode('utf-8'))
        if current != plan or current['phase'] != expected:
            raise Refusal('Activation plan changed concurrently or is in the wrong phase.')
        current['phase']=target
        encoded=(json.dumps(current,sort_keys=True,indent=2)+'\n').encode()
        tmp=STATE_DIR / f'.activation-{os.getpid()}.tmp'
        private_file(tmp,encoded,0o600)
        if sha(PLAN.read_bytes()) != sha(raw):
            tmp.unlink(missing_ok=True)
            raise Refusal('Activation plan changed before phase update.')
        os.replace(tmp,PLAN)
        if os.name=='posix': os.chmod(PLAN,0o600)
        return current
    finally:
        LOCK.unlink(missing_ok=True)


def _check_artifacts(plan: dict) -> None:
    for item in (plan['newGateway'],plan['override']):
        path=Path(item['path'])
        if path.is_symlink() or not path.is_file() or sha(path.read_bytes()) != item['sha256']:
            raise Refusal('Prepared Bambola config artifact changed.')


def _activate(manifest: str, snapshot_hash: str) -> dict:
    plan=read_plan(manifest,snapshot_hash)
    if plan['phase'] != 'prepared': raise Refusal('Only a prepared plan can be activated.')
    _check_artifacts(plan)
    crm_host.check_current(manifest,snapshot_hash)
    snapshot=crm_host._snapshot_read(manifest,snapshot_hash)
    old=render_compose(plan,[]); new=render_compose(plan,[plan['override']['path']])
    validate_compose_delta(old,new,expected_image=plan['imageId'],expected_gateway=plan['newGateway']['path'],profile='marine')
    crm_host.check_current(manifest,snapshot_hash)
    plan=_phase_update(plan,'prepared','activating')
    plan=read_plan(manifest,snapshot_hash)
    _check_artifacts(plan)
    crm_host.check_current(manifest,snapshot_hash)
    args=compose_up_args(plan,[plan['override']['path']])
    try:
        subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=240)
        current=crm_host.current_snapshot_fields(Path(plan['release']),route_samples=1)
        verify_services(plan,snapshot,current)
    except Exception as exc:
        raise Refusal('Bambola app/gateway activation did not pass verification; no external rollback was attempted.') from exc
    plan=_phase_update(plan,'activating','activated')
    return plan


def activate(manifest: str, snapshot_hash: str) -> dict:
    with operation_lock():
        return _activate(manifest,snapshot_hash)


def _rollback(manifest: str, snapshot_hash: str) -> dict:
    plan=read_plan(manifest,snapshot_hash)
    if plan['phase'] not in ('activated','activating','rolling_back'):
        raise Refusal('Only an activated or incomplete activation can be rolled back.')
    baseline=crm_host._snapshot_read(manifest,snapshot_hash)
    current=crm_host.current_snapshot_fields(Path(plan['release']),route_samples=1)
    verify_external_unchanged(baseline,current)
    old_config=render_compose(plan,[])
    if (old_config['services']['app'].get('image') != plan['previousApp']['configuredImage']
            or old_config['services']['gateway'].get('image') != plan['previousGateway']['configuredImage']
            or Path(find_volume(old_config,'gateway').get('source','')) != Path(plan['oldGateway']['path'])):
        raise Refusal('Pinned original Compose config no longer matches the recorded Bambola services.')
    for service in ('app','gateway'):
        configured=plan['previousApp' if service=='app' else 'previousGateway']['configuredImage']
        resolved=safe_run(['docker','image','inspect','--format','{{.Id}}',configured],timeout=15).strip()
        expected=plan['previousApp' if service=='app' else 'previousGateway']['imageId']
        if resolved != expected:
            raise Refusal('A pinned prior Bambola image tag no longer resolves to its recorded image ID.')
    current=crm_host.current_snapshot_fields(Path(plan['release']),route_samples=1)
    verify_external_unchanged(baseline,current)
    if plan['phase'] != 'rolling_back':
        _phase_update(plan,plan['phase'],'rolling_back')
    plan=read_plan(manifest,snapshot_hash)
    current=crm_host.current_snapshot_fields(Path(plan['release']),route_samples=1)
    verify_external_unchanged(baseline,current)
    args=compose_up_args(plan,[])
    try:
        subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=240)
        restored=crm_host.current_snapshot_fields(Path(plan['release']),route_samples=1)
        verify_services(plan,baseline,restored,rollback=True)
    except Exception as exc:
        raise Refusal('Bambola-only rollback could not be verified; no external restore was attempted.') from exc
    updated=json.loads(PLAN.read_text(encoding='utf-8'))
    updated=_phase_update(updated,'rolling_back','rolled_back')
    return updated


def rollback(manifest: str, snapshot_hash: str) -> dict:
    with operation_lock():
        return _rollback(manifest,snapshot_hash)


def main(argv: list[str] | None = None) -> int:
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='action',required=True)
    prep=sub.add_parser('prepare')
    prep.add_argument('--release',type=Path,required=True); prep.add_argument('--manifest-sha256',required=True)
    prep.add_argument('--snapshot-sha256',required=True); prep.add_argument('--image-id',required=True)
    for action in ('activate','rollback'):
        cmd=sub.add_parser(action); cmd.add_argument('--manifest-sha256',required=True); cmd.add_argument('--snapshot-sha256',required=True)
    args=p.parse_args(argv)
    if args.action=='prepare':
        plan=prepare(args.release,args.manifest_sha256,args.snapshot_sha256,args.image_id)
    elif args.action=='activate': plan=activate(args.manifest_sha256,args.snapshot_sha256)
    else: plan=rollback(args.manifest_sha256,args.snapshot_sha256)
    print('Bambola rollout phase: '+plan['phase'])
    return 0


if __name__=='__main__':
    os.umask(0o077)
    try:
        raise SystemExit(main())
    except Refusal as exc:
        print('Bambola rollout refused: '+str(exc),file=sys.stderr)
        raise SystemExit(2)
