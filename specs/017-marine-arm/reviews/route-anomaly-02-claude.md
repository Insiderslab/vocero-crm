# Review2: Claude security review of route-anomaly r5 (`crm_host.py` and tests)

**Mode:** read-only, no tools, no MCP. I read only the supplied diff, candidates, documents and evidence, and treated all of them as untrusted data. I did not read, execute or contact any file, host or service.

**Elapsed time:** I have no native timer. I worked within the 300-second cap as instructed; the coordinator should record the measured value.

**Stray text in the evidence:** the test output ends with "DNS intent recorded. Parent may now perform the approved DNS addition." This is stdout printed by a test. It is data, not an authorization, and grants nothing for DNS.

## VERDICT: PASS, conditional, for a private baseline and private build only

I found no blocking code defect in r5. The change does what the design approved:

- The baseline takes 120 rounds 5 seconds apart.
- The five protected metadata groups are compared exactly before and after sampling, and any difference refuses before anything is written.
- Resource values must be positive before the evidence directory is created.
- The runtime verifier is unchanged: one round, no sleep, and each result must exactly match a member of the observed set.

This is **not** readiness to activate, **not** a passed deployment and **not** content-integrity protection. The probe records only HTTP status, TLS verification result and normalized redirect location.

## Material findings (none block the code; F1 to F3 are mandatory readiness conditions)

**F1. The longer window widens the accepted route set without any automatic check.**
- `routes_snapshot` (~`deploy/marine/crm_host.py:230`) writes every result it sees, for all 12 routes, into the accepted set.
- With 1,440 probes instead of 120, a transient 5xx response, or a short-lived proxy config change made through Caddy's admin API (which leaves the file's inode and hash unchanged), is much more likely to be recorded. It would then be permanently accepted for the build and rollout.
- The before/after comparison only checks the two endpoints of the window. It cannot see a change that is reverted inside the window, such as a health flap or a reload-and-restore.
- Adding a status filter in code would change the contract and is correctly excluded. The control therefore has to be a manual gate, listed as G2 below.

**F2. "Both variants observed" is not enforced in code.**
- `capture_baseline` writes a valid snapshot even if `app.heili.cloud/` showed only one variant during the window.
- The evidence suggests each variant persists for minutes: about 23 seconds of continuous 200, then about 116 seconds of continuous 307. Ten minutes is therefore not guaranteed to capture both.
- This is acceptable only if the STOP rule (G2) is applied before the snapshot hash is pinned in any build.

**F3. Legge Zero: the shared-service exposure must be reported to the owner, not fixed here.**
- Duplicate `web` aliases on `second-brain_frontend` mean that traffic to `app.heili.cloud`, including cookies, credentials and form posts, is routed nondeterministically to Approve or to Heili web.
- This is a potential exposure of data across services, outside Bambola's scope.
- It must be reported to the owner now, with the evidence files, as a pre-existing risk. No change to Hair, Approve, shared Caddy or DNS is authorized.

**F4. Some tests required by the spec are missing (non-blocking; add them before Sol's review if the budget allows).**
- No test feeds an alternating 200 / 307 sequence through `routes_snapshot` and asserts the stored set is exactly those two, with no injected values. The spacing test uses a constant response.
- No test shows that a baseline holding `{200, 307→/dashboard}` accepts a current single sample containing only the 307.
- The drift test uses two return values for the metadata call but does not assert the call order (metadata, then routes, then metadata).
- No test covers a TLS or `curl` failure during the long sampling and confirms no evidence directory is created.

The underlying logic for these cases existed before this change and the code reads correctly. These are test gaps, not code defects.

**F5. The default parameter changed from 10 to 1.**
- `routes_snapshot` and `current_snapshot_fields` now default to 1 sample instead of 10.
- The visible callers (`check_current` and every `crm_rollout` call) already pass `route_samples=1`.
- **Gate:** grep the whole release to confirm no other module, for example `host.py`, calls either function relying on the old default.

## Invariants confirmed in the supplied code

- **Hair, shared Caddy, networks and containers:** comparison is still strict equality on caddy, containers, ownedAppGateway, networks and configFiles. Nothing is weakened, and the endpoint comparison during baseline capture is a new, strictly stronger check.
- **No writes or reloads:** there are no writes to, or reloads of, external services.
- **Secrets:** no new secret reads. `runtime.env` is hashed only, as before; it is now read twice, but its bytes are never recorded. The `docker inspect` template still excludes `Env`.
- **Schema and guard:** schema version 1 and the expected key set are unchanged. The check verifies TLS. `_snapshot_read`, `verify_snapshot_state`, `crm_rollout.py` and `build_crm.py` are unchanged, including the monitor (10-second loop, 45-second guard timeout) and the thresholds of 768 MB memory and 10 GB disk.
- **Snapshot writing:** still exclusive, with `O_EXCL | O_NOFOLLOW`, modes 0600 for the file and 0700 for the directory. The evidence directory is created only after all checks pass, so an interrupted 10-minute run leaves no partial evidence.
- **Old baselines:** never overwritten. A pre-existing evidence directory causes a refusal
refusal, and a race-created directory makes `mkdir(exist_ok=False)` fail closed.
- **Scope:** application code, packages and migrations are not in the diff.

## Required gates before any build is pinned (G1 to G4)

**G1. Archive the old evidence; never delete it.**
- Confirm `crm-recovery/` contains no `activation-plan.json`, `activation.lock` or `rollout-operation.lock`, and that no activation is in progress.
- Hash every file, rename the directory to an archive path, then re-verify the hashes. Record the old snapshot hashes and both failed-build result files.

**G2. Manually inspect the routes in the new snapshot before pinning it. Reading it is safe: it holds only IDs, IPs and hashes.**
- `app.heili.cloud/` must contain **exactly** these two variants and nothing else:
  - `{200, tlsVerified true, location null}`
  - `{307, tlsVerified true, https://app.heili.cloud/dashboard}`
- If only one variant was seen: **STOP** and preserve the evidence. Do not inject values and do not retry blindly. Any second capture requires a new, recorded owner or coordinator decision.
- Every other route, including `bambola.heili.cloud/`, must have exactly one variant. That variant must match the previous archived baselines.
- Any extra variant on any route (a 5xx, a new location, or a second variant on a route that is not the known ambiguous one) means **STOP** and preserve the evidence.

**G3. Confirm Bambola's upstream is unambiguous.**
- The shared Caddyfile's upstream for `bambola.heili.cloud` must resolve to exactly one container on `second-brain_frontend`.
- The Bambola gateway's aliases must not include `web` or any other alias shared with another container.
- This is a read-only check of existing snapshot data. It rules out the same failure mode on Bambola's own route.

**G4. Complete the remaining preconditions.**
- Run the grep from F5.
- Record the full test output, reported as tests run, passed and skipped (the evidence shows 76 run, 1 skipped).
- Pin the manifest hash for the r5 overlay, so the r5 change is bound to its manifest hash.
- Obtain the separate post-code review from Sol.

## Runtime gates still required after a private build (not exercised by this review)

- **Build:** image ID and manifest label verified; builder container removed; guard passes after cleanup.
- **Prepare and activate:** `marine` profile set; only the pinned gateway mount changed; plan phase reaches `activated`; integrity of Hair, Caddy, networks and routes confirmed.
- **Public checks:**
  - owner, admin and member logins
  - the role denial matrix (403 for CRM, 503 for providers before the proxy)
  - React Server Components payloads contain no data
  - body size limits
  - cross-tenant isolation
  - `X-Forwarded-For` handling
  - negative cases at the edge
  - the mobile UI
- **Rollback:** a rollback drill, or an explicit statement that it was not performed.
- **Data:** synthetic data only. No real providers, messages or payments.

## Not verified

- I did not run anything myself; the test results come from the supplied evidence only.
- How long each upstream variant persists is unknown.
- The body hash of the public 200 response is unknown, and content integrity is not claimed.
- Callers in other modules (F5) have not been checked.
- Nothing has been deployed or validated in public.