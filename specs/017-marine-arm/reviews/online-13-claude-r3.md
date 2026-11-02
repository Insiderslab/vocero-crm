# Invocation19 — authorized additional Claude review

Actual completed CLI review, model claude-opus-5-5; API duration151350ms, measured parent157.772s,1turn, exit0/no error. Target frozenr3 manifest ed29a574abd2b83b458ec3965e2908ff7d59381ff6e4aef61af647ccfd9c6b60. Fresh safe-mode/no tools. Raw evidence in bambola-runtime/reviews/claude-r3-authorized-*. No source edits by reviewer.

# Bambola r3 security review (invocation 19)

## STATIC VERDICT: PASS (private build and verification only)

I found no unresolved code vulnerability that should block a private build, private compose bring-up, private bootstrap or the backup/restore test.

This is a static reading of the 15 supplied files. I ran no tests, builds or probes. Public activation stays blocked for three reasons:
- The dependency audit is still failed (34 findings: 5 critical, 13 high). The reachability matrix only argues they are not reachable; it closes nothing.
- The findings below need fixes or runtime proof.
- None of the required runtime proofs exist yet.

## FINDINGS

No Critical or High code findings.

**M1 – Medium – `deploy/marine/host.py`, `mutate()` and the `rollback` write path**
- **Trigger:** the shared Caddyfile is rewritten in place (truncate, then write) to keep the bind-mount inode. If the process is killed, the disk fills, or an I/O error occurs between truncate and write, the shared file is left empty or partial.
- **Impact:** nothing breaks until shared Caddy next reloads or restarts. At that point Hair and every other heili.cloud site fail to load. This breaks the "preserve Hair" constraint.
- **Mitigation already present:** `Caddyfile.before` is kept in evidence. However, the `except` branch only restores the file when the hash equals the new content, so it does not cover a partial write.
- **Needed:** a documented manual restore step from `evidence/Caddyfile.before`, rehearsed before the `maintenance` step.

**M2 – Medium – `deploy/marine/host.py`, `activate` (process gap)**
- **Trigger:** activation checks only the DNS intent, the DNS marker, the maintenance phase and a TLS 503 probe. It does not check for `evidence/bootstrap.json`, a passing backup result, or any runtime-harness result.
- **Impact:** an operator can activate an instance that has not been bootstrapped or verified. Public sign-up is still blocked by the gateway allowlist, which does not route `/sign-up`, so this is not an account takeover. But the "blocked on runtime checks" policy relies on human discipline, not code.
- **Needed:** a manual gate or checklist sign-off before running `activate`.

**L1 – Low – `deploy/marine/gateway.Caddyfile.template`, trusted-peer check; `deploy/marine/runtime.py`, `--shared-ip`**
- **Trigger:** trust in `X-Forwarded-For` is tied to a dynamic Docker IP on the shared `second-brain_frontend` network. Nothing confirms that the operator-supplied IP really belongs to `second-brain-caddy-1`, and nothing pins it.
- **Impact:** a wrong input, or IP reuse after the shared Caddy is recreated, would let another container on that network spoof the client IP and dodge the per-IP login limit. In the opposite case (Caddy gets a new IP), Bambola just returns 403, which fails closed.
- **Partial mitigation:** `host.py` container snapshots would detect a shared-Caddy restart during host operations.

**L2 – Low – `deploy/marine/gateway.Caddyfile.template`, `header` block**
- **Trigger:** the response headers are set without `defer`, so headers coming back from the app can duplicate or conflict with them (for example `Cache-Control` on `/_next/static`).
- **Missing headers:** HSTS, `X-Content-Type-Options` and a `Permissions-Policy` are not set at either Caddy layer.
- **Impact:** weaker header posture; no direct exploit found.

**L3 – Low – `deploy/marine/compose.ubuntu.yml`, `app` service**
- **Trigger:** unlike the gateway, the app container has no `cap_drop: [ALL]`, no `no-new-privileges`, and no `read_only`/tmpfs. It runs as the non-root `vocero` user, but with default bounding capabilities.
- **Impact:** less defense in depth if the Next runtime is compromised, which matters while the dependency audit is open.

**L4 – Low – `deploy/marine/runtime.py` (`accounts.json`), `deploy/marine/backup.py` (dumps)**
- **Trigger:** plaintext passwords stay in `accounts.json` (0600, root) indefinitely. Database dumps pile up in `evidence/` with no retention rule.
- **Impact:** long-lived credential material on the host.
- **Needed:** define the credential handoff, then rotate and delete.

**L5 – Low – `src/lib/rate-limit.ts` (`clientIp`) with the shared Caddy block**
- **Trigger:** the per-IP limit is only correct if `remote.host` at the shared Caddy is the real client. If heili.cloud is proxied through a CDN (for example Cloudflare), every client looks like a few CDN IPs.
- **Impact:** legitimate users get locked out together, and attackers get spread-out rate-limit buckets.
- **Other limits:** the counter is in-process only and resets when the app restarts.

**I1 – Info – `deploy/marine/bootstrap.mjs`, result record**
- `ownerCreated: true` is written even when the owner already existed and the script fell back to login. This is misleading evidence, not a security flaw.

**I2 – Info – `deploy/marine/runtime.py`, `deploy/marine/backup.py`**
- Neither script sets `umask`, so files exist briefly with default permissions before `chmod`. This is harmless only because the parent directories are 0700 and root-owned.

**I3 – Info – `deploy/marine/Dockerfile`, `corepack enable`**
- Corepack fetches pnpm at build time. Whether `packageManager` in `package.json` is pinned with an integrity hash is unverified (`package.json` was not supplied).

## REQUIRED RUNTIME PROOFS (none done by me)

1. **Caddy reload:** on the exact pinned shared-Caddy image, prove that SIGUSR1 actually reloads the config from the bind-mounted file. If it is ignored, `mutate` reports success while serving the old config.
2. **Trusted peer:** `docker inspect` must show the `--shared-ip` value equals `second-brain-caddy-1`'s address on `second-brain_frontend`. Then:
   - from another container on that network: 403;
   - spoofed `X-Forwarded-For` through the public path: overwritten.
3. **Gateway allowlist** (encoded, case-variant and method variants), each must return 404/403:
   - `/api/auth/sign-up/*`, `/api/auth/organization/*`, magic-link, social, device, OAuth-proxy and callback routes;
   - `/_next/image`, `/api/settings/*`, `/api/admin/*`, `/api/dev/*`, `/api/bot/*`, `/api/events`, webhook;
   - POST to page paths (server actions).
4. **Body limits:** declared and chunked bodies over 32 KiB (auth) and over 16 KiB (`/api/marine`) return 413; memory stays bounded; health is still green afterwards.
5. **Bootstrap:**
   - closed sign-up returns 403;
   - role checks pass for owner, admin and 3 crew;
   - fresh-session role checks pass;
   - cross-tenant denial is proven with a second synthetic org created privately.
6. **Backup/restore:** `backup.py test` passes; evidence permissions are 0600.
7. **Public TLS:** maintenance returns 503 before DNS and activation; after activation, check the exact response headers (L2), the login 429 at the 11th attempt per real client IP (L5), and logout/stale-session behaviour on mobile.
8. **Runner inventory** in the final image: no Vitest, Vite, PostCSS, drizzle-kit or shell-quote process or reachable code path; Sharp is unreachable; only email/password and organization Better Auth plugins are present in the compiled app.
9. **Shared services:** route and container invariants for Hair and other services are unchanged after `maintenance`, `activate` and `rollback`. Rehearse M1 recovery.
10. **Isolation:** the app has no egress; postgres is reachable only on `bambola_data`; `MARINE_TRUST_PROXY_IP` behaviour is checked (its code was not supplied).

## SCOPE READ

**Read in full:**
- `deploy/marine/runtime.py`
- `deploy/marine/compose.ubuntu.yml`
- `deploy/marine/gateway.Caddyfile.template`
- `deploy/marine/Dockerfile`
- `deploy/marine/bootstrap.mjs`
- `deploy/marine/bootstrap.py`
- `deploy/marine/host.py`
- `deploy/marine/build.py`
- `deploy/marine/backup.py`
- `deploy/marine/manifest.py`
- `scripts/marine-release-pack.mjs`
- `src/app/nautica/session-shell.tsx`
- `src/lib/auth/index.ts`
- `src/lib/rate-limit.ts`
- `src/server/marine/http.ts`
- `src/lib/marine/validation.ts`
- the three policy documents
- the dependency triage matrix

**UNKNOWN (not supplied):**
- marine route handlers and repository
- the `MARINE_TRUST_PROXY_IP` consumer
- `registration.ts` and `on-signup.ts`
- `package.json` / `pnpm-lock.yaml`
- `next.config.ts`
- the runtime harness
- the shared production Caddyfile
- the shared Caddy and gateway image versions

I did not verify the manifest digest or the per-file SHA256 values. This review does not approve the project, accept risk, or authorize production.

## Coordinator disposition before dependent work

Static PASS permits private transfer/build/bootstrap/tests only. No public readiness claim. M1: document and rehearse recovery on a disposable exact-image Caddy fixture before any shared-file write, preserving inode and validating full saved bytes; never overwrite concurrent changes. M2: written gate evidence required before activate, with bootstrap/roles/private isolation/backup and prior independent reviews; external-only checks immediately after activation, rollback to maintenance on failure before handoff. L1: inspect actual shared Caddy IP immediately before runtime generation and route changes, require exact observed container identity. L2: test actual response headers and deny paths; missing optional headers is a recorded low hardening issue, conflicting required headers blocks handoff. L3: nonroot app and private internal networks must be proved; further hardening is a future change, not silently applied to frozenr3. L4: existing scope already requires protected local credential handoff and deletion of server delivery copy after all tests; keep synthetic DB backup private for pilot recovery, review retention and rotate/revoke before real-use transition. L5: DNS directA and real-IP behavior must be verified. I1: do not use ownerCreated field to claim an initial creation on rerun. I2: enforce parent umask077/root0700. I3: inspect packageManager pin and verify frozen-lock install build; no unrequested dependency upgrade. Reviewer says15 files but its actual scope list contains16. All UNKNOWNs remain explicit; no additional Claude invocation or replacement. Final review is still pending, budget19/20.
