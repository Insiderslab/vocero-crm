#!/usr/bin/env python3
"""Run read-only Bambola inventory and isolated network reachability proofs."""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/opt/bambola-arm')
EVIDENCE = ROOT / 'evidence' / 'isolation.json'
APP = 'bambola-arm-app-1'
POSTGRES = 'bambola-arm-postgres-1'
GATEWAY = 'bambola-arm-gateway-1'
IMAGE_PACKAGES = {
    'vitest', 'tinypool', 'shell-quote', 'drizzle-kit', 'drizzle-orm', 'gel', 'postcss',
    'nanoid', 'source-map-js', 'vite', 'zod', 'better-auth', 'sharp',
}
JS_INVENTORY = r'''import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const wanted = new Set(JSON.parse(process.env.WANTED_PACKAGES));
const found = new Set();
const unknownVendoredPackages = new Map();
let scanComplete = true;
let packageRoot;
try { packageRoot = fs.realpathSync('/app/node_modules'); } catch { packageRoot = null; scanComplete = false; }
const stack = packageRoot ? [packageRoot] : [];
const visitedDirs = new Set();
let visited = 0;
function recordPackage(packageDir, expectedName) {
  let metadata;
  let text;
  try {
    text = fs.readFileSync(`${packageDir}/package.json`, 'utf8');
    metadata = JSON.parse(text);
  } catch { scanComplete = false; return; }
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata) || metadata.name !== expectedName) {
    scanComplete = false;
    return;
  }
  if (typeof metadata.version === 'string' && metadata.version.length > 0) {
    found.add(`${metadata.name}@${metadata.version}`);
    return;
  }
  const bundledPath = path.relative(packageRoot, fs.realpathSync(packageDir)).split(path.sep).join('/');
  const segments = bundledPath.split('/');
  const insidePackageRoot = bundledPath !== '' && !bundledPath.startsWith('../') && !path.isAbsolute(bundledPath);
  const directNextBundle = insidePackageRoot && segments.length === 4 && segments[0] === 'next'
    && segments[1] === 'dist' && segments[2] === 'compiled' && segments[3] === expectedName;
  const pnpmNextBundle = insidePackageRoot && segments.length === 7 && segments[0] === '.pnpm'
    && segments[1].startsWith('next@') && segments[1].length > 5 && segments[2] === 'node_modules'
    && segments[3] === 'next' && segments[4] === 'dist' && segments[5] === 'compiled' && segments[6] === expectedName;
  const nextPackageDir = directNextBundle ? `${packageRoot}/next`
    : pnpmNextBundle ? `${packageRoot}/.pnpm/${segments[1]}/node_modules/next` : null;
  let nextPackageValid = false;
  if (nextPackageDir) {
    try {
      const nextPackage = JSON.parse(fs.readFileSync(`${nextPackageDir}/package.json`, 'utf8'));
      nextPackageValid = nextPackage?.name === 'next' && typeof nextPackage.version === 'string' && nextPackage.version.length > 0;
    } catch { scanComplete = false; }
  }
  const exactNextBundle = (directNextBundle || pnpmNextBundle) && nextPackageValid;
  if (!Object.hasOwn(metadata, 'version') && exactNextBundle) {
    unknownVendoredPackages.set(bundledPath, {
      name: metadata.name,
      version: null,
      path: bundledPath,
      packageSha256: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
    });
    return;
  }
  scanComplete = false;
}
while (stack.length && visited < 30000) {
  const dir = stack.pop();
  if (visitedDirs.has(dir)) continue;
  visitedDirs.add(dir);
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { scanComplete = false; continue; }
  for (const entry of entries) {
    if (entry.name === '.bin') continue;
    const child = `${dir}/${entry.name}`;
    visited++;
    if (entry.isSymbolicLink()) {
      try {
        const target = fs.realpathSync(child);
        if (target === packageRoot || target.startsWith(`${packageRoot}/`)) {
          if (fs.statSync(target).isDirectory()) {
            if (wanted.has(entry.name)) {
              recordPackage(target, entry.name);
            }
            stack.push(target);
          } else {
            scanComplete = false;
          }
        } else {
          scanComplete = false;
        }
      } catch { scanComplete = false; }
      continue;
    }
    if (!entry.isDirectory()) continue;
    if (entry.name === 'node_modules') { stack.push(child); continue; }
    if (entry.name.startsWith('@')) { stack.push(child); continue; }
    if (wanted.has(entry.name)) {
      recordPackage(child, entry.name);
    }
    stack.push(child);
  }
}
if (stack.length || visited >= 30000) scanComplete = false;
const forbidden = ['/app/scripts/seed-demo.mjs', '/app/scripts/booking-worker.mjs',
                   '/app/seed-demo.mjs', '/app/booking-worker.mjs', '/app/dist/booking-worker.mjs'];
process.stdout.write(JSON.stringify({
  packages: [...found].sort().map((value) => { const i = value.lastIndexOf('@'); return {name: value.slice(0, i), version: value.slice(i + 1)}; }),
  unknownVendoredPackages: [...unknownVendoredPackages.values()].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
  forbiddenFiles: forbidden.filter((path) => fs.existsSync(path)),
  commandLooksLikeDevServer: process.env.APP_IS_DEV_SERVER === 'true',
  scannedEntries: visited,
  scanComplete,
}));
'''
JS_PROBE = r'''import net from 'node:net';
import http from 'node:http';
const targets = JSON.parse(process.env.TARGETS || '[]');
const results = {};
for (const target of targets) {
  results[target.label] = await new Promise((resolve) => {
    const socket = net.createConnection({host: target.host, port: target.port});
    const finish = (connected, outcome) => { socket.destroy(); resolve({connected, outcome}); };
    socket.setTimeout(2000, () => finish(false, 'timeout'));
    socket.once('connect', () => finish(true, 'connected'));
    socket.once('error', (error) => finish(false, error.code === 'ECONNREFUSED' ? 'refused' : 'error'));
  });
}
if (process.env.TEST_GATEWAY === '1') {
  results.gatewaySpoof = await new Promise((resolve) => {
    const req = http.get({host: 'bambola-arm-gateway', port: 8080, path: '/nautica', timeout: 2000,
      headers: {Host: 'bambola.heili.cloud', 'X-Forwarded-For': '203.0.113.10',
        Forwarded: 'for=203.0.113.10;proto=https', 'X-Real-IP': '203.0.113.10'}}, (res) => {
      res.resume(); resolve({status: res.statusCode});
    });
    req.once('timeout', () => { req.destroy(); resolve({status: 0}); });
    req.once('error', () => resolve({status: 0}));
  });
}
process.stdout.write(JSON.stringify(results));
'''


def docker(args, *, timeout=30):
    return subprocess.run(['docker', *args], check=True, text=True, capture_output=True, timeout=timeout)


def inspect_container(name):
    def field(template):
        return docker(['inspect', '--type', 'container', '--format', template, name]).stdout.strip()

    return {
        'Image': field('{{.Image}}'),
        'State': {
            'Running': field('{{.State.Running}}') == 'true',
            'Health': field('{{if .State.Health}}{{.State.Health.Status}}{{end}}'),
        },
        'Config': {
            'User': field('{{.Config.User}}'),
            'Entrypoint': json.loads(field('{{json .Config.Entrypoint}}') or 'null') or [],
            'Cmd': json.loads(field('{{json .Config.Cmd}}') or 'null') or [],
        },
        'HostConfig': {
            'PortBindings': json.loads(field('{{json .HostConfig.PortBindings}}') or '{}') or {},
            'CapDrop': json.loads(field('{{json .HostConfig.CapDrop}}') or '[]') or [],
            'CapAdd': json.loads(field('{{json .HostConfig.CapAdd}}') or '[]') or [],
            'ReadonlyRootfs': field('{{.HostConfig.ReadonlyRootfs}}') == 'true',
            'SecurityOpt': json.loads(field('{{json .HostConfig.SecurityOpt}}') or '[]') or [],
            'Tmpfs': json.loads(field('{{json .HostConfig.Tmpfs}}') or '{}') or {},
        },
        'NetworkSettings': {
            'Networks': json.loads(field('{{json .NetworkSettings.Networks}}') or '{}') or {},
        },
    }


def exec_app(image, script, env=None):
    args = ['run', '--rm', '--name', 'bambola-arm-isolation-inventory-' + uuid.uuid4().hex[:8],
            '--network', 'none', '--memory', '64m', '--cpus', '0.2', '--read-only',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=8m', '--entrypoint', 'node']
    for key, value in (env or {}).items():
        args += ['-e', f'{key}={value}']
    args += [image, '--input-type=module', '-e', script]
    return docker(args, timeout=60).stdout


def peer_run(name, image, network, script, *, env=None):
    args = ['run', '--rm', '--name', name, '--network', network,
            '--memory', '64m', '--cpus', '0.2', '--read-only',
            '--tmpfs', '/tmp:rw,noexec,nosuid,size=8m', '--entrypoint', 'node']
    for key, value in (env or {}).items():
        args += ['-e', f'{key}={value}']
    args += [image, '--input-type=module', '-e', script]
    return docker(args, timeout=20).stdout


def write_evidence(result):
    if EVIDENCE.parent.is_symlink():
        raise RuntimeError('Evidence directory must not be a symlink')
    EVIDENCE.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    EVIDENCE.parent.chmod(0o700)
    payload = (json.dumps(result, sort_keys=True, indent=2) + '\n').encode()
    with EVIDENCE.open('xb') as stream:
        stream.write(payload)
    EVIDENCE.chmod(0o600)


def parse_process_security(status):
    fields = {}
    for line in status.splitlines():
        key, sep, value = line.partition(':')
        if sep and key in {'CapEff', 'CapBnd', 'NoNewPrivs'}:
            fields[key] = value.strip()
    if not re.fullmatch(r'[0-9a-fA-F]+', fields.get('CapEff', '')) or not re.fullmatch(r'[0-9a-fA-F]+', fields.get('CapBnd', '')) or fields.get('NoNewPrivs') not in {'0', '1'}:
        raise RuntimeError('Gateway process security state is unavailable')
    cap_eff = int(fields['CapEff'], 16)
    return {'capEffAllowedOnly': cap_eff & ~0x400 == 0,
            'capBndNetBindServiceOnly': int(fields['CapBnd'], 16) == 0x400,
            'noNewPrivs': fields['NoNewPrivs'] == '1'}


def canonical_capability(value):
    if not isinstance(value, str):
        return None
    capability = value.upper()
    return capability[4:] if capability.startswith('CAP_') else capability


def vendored_package_records_valid(records):
    if not isinstance(records, list):
        return False
    for item in records:
        if not isinstance(item, dict) or item.get('version') is not None:
            return False
        name = item.get('name')
        package_path = item.get('path')
        fingerprint = item.get('packageSha256')
        if not isinstance(name, str) or not isinstance(package_path, str) or not isinstance(fingerprint, str):
            return False
        segments = package_path.split('/')
        direct = len(segments) == 4 and segments[:3] == ['next', 'dist', 'compiled'] and segments[3] == name
        pnpm = (len(segments) == 7 and segments[0] == '.pnpm' and segments[1].startswith('next@')
                and len(segments[1]) > 5 and segments[2:6] == ['node_modules', 'next', 'dist', 'compiled']
                and segments[6] == name)
        if name not in IMAGE_PACKAGES or not (direct or pnpm) or not re.fullmatch(r'[0-9a-f]{64}', fingerprint):
            return False
    return True


def verify_gateway_privileges(gateway):
    gateway_uid = docker(['exec', GATEWAY, 'id', '-u']).stdout.strip()
    process_security = parse_process_security(docker(['exec', GATEWAY, 'cat', '/proc/1/status']).stdout)
    gateway_host = gateway.get('HostConfig', {})
    security_opts = gateway_host.get('SecurityOpt', [])
    checks = {
        'uid65532': gateway_uid == '65532',
        'capDropAll': gateway_host.get('CapDrop') == ['ALL'],
        'capAddNetBindServiceOnly': [canonical_capability(value) for value in gateway_host.get('CapAdd', [])] == ['NET_BIND_SERVICE'],
        'capEffAllowedOnly': process_security['capEffAllowedOnly'],
        'capBndNetBindServiceOnly': process_security['capBndNetBindServiceOnly'],
        'readonlyRootfs': gateway_host.get('ReadonlyRootfs') is True,
        'noNewPrivilegesHostConfig': 'no-new-privileges:true' in security_opts,
        'noNewPrivilegesProcess': process_security['noNewPrivs'],
        'tmpfsPresent': '/tmp' in gateway_host.get('Tmpfs', {}),
    }
    if not all(checks.values()):
        raise RuntimeError('Gateway runtime privilege boundary is not enforced')
    return gateway_uid, checks


def main():
    if sys.platform != 'linux':
        raise RuntimeError('Linux host required')
    if docker(['info', '--format', '{{.OSType}}']).stdout.strip() != 'linux':
        raise RuntimeError('Linux Docker engine required')

    inspected = {name: inspect_container(name) for name in (APP, POSTGRES, GATEWAY)}
    app, database, gateway = (inspected[APP], inspected[POSTGRES], inspected[GATEWAY])
    if any(item['State']['Running'] is not True or item['State']['Health'] != 'healthy'
           for item in inspected.values()):
        raise RuntimeError('Bambola services are not all running and healthy')
    app_id = app['Image']
    app_config = app['Config']
    app_networks = app['NetworkSettings']['Networks']
    db_networks = database['NetworkSettings']['Networks']
    gateway_networks = gateway['NetworkSettings']['Networks']
    if len(app_networks) != 2 or len(db_networks) != 1 or len(gateway_networks) != 2:
        raise RuntimeError('Unexpected Bambola network count')

    edge = next((name for name in app_networks if name in gateway_networks), None)
    data = next((name for name in app_networks if name in db_networks and name != edge), None)
    frontend = next((name for name in gateway_networks if name != edge), None)
    if not edge or not data or not frontend or data in gateway_networks:
        raise RuntimeError('Bambola network membership is not isolated')
    if frontend in app_networks or frontend in db_networks or edge not in gateway_networks:
        raise RuntimeError('Bambola frontend membership is not isolated')

    app_bindings = app.get('HostConfig', {}).get('PortBindings') or {}
    db_bindings = database.get('HostConfig', {}).get('PortBindings') or {}
    gateway_bindings = gateway.get('HostConfig', {}).get('PortBindings') or {}
    if app_bindings or db_bindings or gateway_bindings:
        raise RuntimeError('Bambola container publishes host ports')
    # Config.User may be a name; inspect the effective UID instead.
    effective_uid = docker(['exec', APP, 'id', '-u']).stdout.strip()
    if not effective_uid.isdigit() or int(effective_uid) == 0:
        raise RuntimeError('App is running as root')
    gateway_uid, gateway_security = verify_gateway_privileges(gateway)

    edge_internal = docker(['network', 'inspect', '--format', '{{.Internal}}', edge]).stdout.strip()
    data_internal = docker(['network', 'inspect', '--format', '{{.Internal}}', data]).stdout.strip()
    if edge_internal != 'true' or data_internal != 'true':
        raise RuntimeError('Bambola edge/data network must be internal')
    app_edge_ip = app_networks[edge]['IPAddress']
    db_data_ip = db_networks[data]['IPAddress']
    if not app_edge_ip or not db_data_ip:
        raise RuntimeError('Missing private service address')

    app_command = ' '.join([*(app_config.get('Entrypoint') or []), *(app_config.get('Cmd') or [])])
    is_dev_server = bool(re.search(r'(^|\s)(next|npm|pnpm|yarn)\s+(dev|run\s+dev)(\s|$)', app_command.lower()))
    inventory = json.loads(exec_app(app_id, JS_INVENTORY, {
        'WANTED_PACKAGES': json.dumps(sorted(IMAGE_PACKAGES)),
        'APP_IS_DEV_SERVER': str(is_dev_server).lower(),
    }))
    forbidden_files = inventory['forbiddenFiles']
    if forbidden_files or inventory['commandLooksLikeDevServer'] or not inventory['scanComplete']:
        raise RuntimeError('Runner contains a dev server or forbidden seed/worker artifact')

    suffix = uuid.uuid4().hex[:8]
    frontend_result = json.loads(peer_run(
        'bambola-arm-isolation-frontend-' + suffix, app_id, frontend, JS_PROBE,
        env={'TARGETS': json.dumps([
            {'label': 'app_edge_3000', 'host': app_edge_ip, 'port': 3000},
            {'label': 'database_data_5432', 'host': db_data_ip, 'port': 5432},
        ]), 'TEST_GATEWAY': '1'}))
    edge_result = json.loads(peer_run(
        'bambola-arm-isolation-edge-' + suffix, app_id, edge, JS_PROBE,
        env={'TARGETS': json.dumps([
            {'label': 'app_edge_3000', 'host': app_edge_ip, 'port': 3000},
            {'label': 'database_data_5432', 'host': db_data_ip, 'port': 5432},
        ])}))
    data_result = json.loads(peer_run(
        'bambola-arm-isolation-data-' + suffix, app_id, data, JS_PROBE,
        env={'TARGETS': json.dumps([
            {'label': 'database_data_5432', 'host': db_data_ip, 'port': 5432},
        ])}))

    assertions = {
        'linuxDocker': True,
        'servicesRunningHealthy': True,
        'appNonRoot': int(effective_uid) > 0,
        'gatewayUid65532': gateway_security['uid65532'],
        'gatewayCapDropAll': gateway_security['capDropAll'],
        'gatewayCapAddNetBindServiceOnly': gateway_security['capAddNetBindServiceOnly'],
        'gatewayCapEffAllowedOnly': gateway_security['capEffAllowedOnly'],
        'gatewayCapBndNetBindServiceOnly': gateway_security['capBndNetBindServiceOnly'],
        'gatewayReadOnlyRootfs': gateway_security['readonlyRootfs'],
        'gatewayNoNewPrivileges': gateway_security['noNewPrivilegesHostConfig'] and gateway_security['noNewPrivilegesProcess'],
        'gatewayTmpfsPresent': gateway_security['tmpfsPresent'],
        'noHostPorts': True,
        'appNotFrontend': frontend not in app_networks,
        'gatewayNotData': data not in gateway_networks,
        'databaseNotFrontend': frontend not in db_networks,
        'edgeDataInternal': True,
        'noSeedOrWorkerFiles': not forbidden_files,
        'notDevServer': not inventory['commandLooksLikeDevServer'],
        'inventoryScanComplete': inventory['scanComplete'],
        'vendoredVersionsExplicitlyUnknown': vendored_package_records_valid(inventory['unknownVendoredPackages']),
        'frontendCannotReachApp': not frontend_result['app_edge_3000']['connected'],
        'frontendCannotReachDatabase': not frontend_result['database_data_5432']['connected'],
        'frontendSpoofGets403': frontend_result.get('gatewaySpoof', {}).get('status') == 403,
        'edgeCanReachApp': edge_result['app_edge_3000']['connected'],
        'edgeCannotReachDatabase': not edge_result['database_data_5432']['connected'],
        'dataCanReachDatabase': data_result['database_data_5432']['connected'],
    }
    result = {
        'version': 1,
        'checkedAt': datetime.now(timezone.utc).isoformat(),
        'containers': {name: {'imageId': item['Image'], 'networks': sorted(item['NetworkSettings']['Networks'])}
                       for name, item in inspected.items()},
        'packageInventory': inventory['packages'],
        'unknownVendoredPackages': inventory['unknownVendoredPackages'],
        'assertions': assertions,
        'probes': {'frontend': frontend_result, 'edge': edge_result, 'data': data_result},
        'passed': all(assertions.values()),
    }
    write_evidence(result)
    print(json.dumps({'passed': result['passed'], 'evidence': str(EVIDENCE),
                      'failedChecks': [name for name, passed in assertions.items() if not passed]},
                     sort_keys=True))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    os.umask(0o077)
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as error:
        print(json.dumps({'passed': False, 'error': type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
