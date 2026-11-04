# Verdict: **PASS, conditional on the runtime gates below**

This is a source-only review of the capture-window correction `c6205d7..d3e57fa`. It covers `crm_app_update.py` (d2832b58…) and `tests/test_crm_app_update.py` (7000f86d…), read against the previously reviewed helper, `crm_host.py`, the design's "Capture-only route variability correction" section and the prior re-audits. I made no tool calls and accessed no hosts, files or services. Nothing here is evidence of a successful capture, build or deployment.

Line references are diff-hunk or function anchors, because the source was supplied inline.

## What changed and whether it is sound

### 1. `verify_capture_window(before, route_window, after)` (new, around diff +367)

- **Protected state stays exact.** `caddy`, `containers`, `ownedAppGateway`, `networks` and `configFiles` must be identical before and after.
  - Container records include `id`, `startedAt` and `restartCount`, so a container restarting inside the window is caught even if it ends in the same state.
  - `ownedAppGateway` equality means the r9 app's ID, image and `healthy` status are re-proved after the window. `verify_current_r9` therefore does not need to run again.
- **Resource minimums** are now enforced on both snapshots. Before, only the later one was checked, so this is stricter.
- **The route baseline** is only the union of outcomes actually observed in `before`, the 120×5s window and `after`.
  - No status is invented or whitelisted.
  - Every row must have exactly the three keys, an integer status between 100 and 599, `tlsVerified is True`, and a location that is a string or null.
  - All 12 route keys must be present.
- **Later phases are unchanged.** `verify_build_guard`, `verify_app_only_result` and `verify_rollback_boundary` still require each sampled outcome to be in that captured set, so the widening is limited to capture.

### 2. `verify_capture_metadata`

- The read-only migration/schema proof is taken before and after the window.
- Both proofs are checked against the r9 journal and must be equal.
- The proof stored in genesis is now taken after a stability interval, not at one instant. This is an improvement.

### 3. Rebinding after the window (`revalidate_capture_inputs` and inline code in `capture`)

All of the following are re-verified after the window, before any file is written:

- The full candidate tree walk, in-process manifest check and manifest-map equality.
- QA bytes, freshness (the 24-hour limit is evaluated again) and the runtime projection.
- The static exclusion scan.
- The r9 tree and manifest equality.
- Live labels.
- The Docker context and the boundary that blocks static `env_file`.
- The identities of the three Compose files, the gateway pin and the `runtime.env` hash.

Because both manifests must equal the maps used for the earlier delta check, the r9 allowlist delta still holds without being recomputed.

### 4. Write ordering and the lock

- The operation directory and all artifacts are still created only after every check passes, so a refusal anywhere leaves no evidence directory.
- The shared lock is held for the whole roughly 10-minute capture.
- `status` remains lock-free.

### 5. App-only command, crash handling and rollback

Untouched by this diff. The prior PASS (8253011d…, carried forward through d283) stands for those areas.

I found **no material defect** in the correction.

## Non-blocking observations (all fail closed)

**N1. Transient failures seen during capture become accepted outcomes.**
- If any route, including `bambola.heili.cloud/`, returns for example a 502/503 or an unexpected redirect during the window, that outcome joins the baseline.
- `verify_app_only_result` would then accept the same outcome after activation.
- This matches the design ("union of outcomes actually observed"), and the app's own `healthy` status is still checked independently. However, the route check alone could then pass a degraded public root.
- This is covered by runtime gate R3.

**N2. Window-level metadata changes are detected only at the endpoints.**
- A protected config file edited and then reverted inside the window is not detected. Routes sampled during that period would still widen the baseline.
- The design states this explicitly ("pre/post checks; they do not claim continuous host observation"). Container restarts are not affected, because `startedAt` and `restartCount` reveal them.

**N3. Some TLS failures surface as a traceback instead of a refusal.**
- `crm_host.routes_snapshot` raises `crm_host.Refusal` on a TLS failure. That class does not inherit from `update.Refusal`, so `main()` prints a traceback rather than "release operation refused".
- The lock is still released by the `with` block, and nothing has been written yet. The same behaviour already existed for `current_baseline`.

**N4. New guards lack negative tests.**
The new tests cover protected-section drift, resource drift, catalog drift, stale or changed QA after the window, the route union, and later rejection of an unseen 503. They do not cover:
- `_add_route_observation` rejecting `tlsVerified: false`, a status out of range, or extra or missing keys;
- a `route_window` with a missing URL key or an empty list;
- refusal after the window when the Compose or gateway pin, `runtime.env`, labels or the r9 manifest drift (this code is inline in `capture()`).

These checks are simple equality and type tests, so this is not a security defect. The project's sabotage-test rule (Prima Legge) still argues for adding them in the authorised correction cycle. If they are added, the hash freeze and test reruns must be repeated.

**N5. Expected liveness cost.**
- The build monitor runs the guard about every 10 seconds, each time sampling routes 3 times. Over a long build, an outcome missed by the 10-minute window can still refuse the operation.
- This is correct fail-closed behaviour. The response is a fresh capture, never a widened allowlist.

**N6. The test still runs one Windows-only fixture.**
- `test_real_sanitized_crm_host_snapshot_matches_projection` reads a Windows path. On Linux it skips, which is expected.

## Runtime gates (required before any claim of success)

**R0. Linux root rerun of all four operational suites** at the frozen hashes, umask 077.
- Report tests run, skips and failures exactly: "N run, k skipped", not "passed plus skipped".
- The Windows result of 129 run / 4 skipped does not cover the POSIX guards.

**R1. New package provenance.**
- The helper and test bytes changed, so the candidate manifest digest changes. The earlier `cad4ea43…` is invalid for this package.
- Rebuild and freeze the candidate tree.
- Confirm the eight operational files match the frozen hashes, and that `manifest.py`, `crm_host.py` and all runtime inputs are byte-identical to r9.
- Confirm the QA artifact's `unchangedRuntimeInputsSha256` still equals the r9 projection (operational paths are excluded from it, so it should).

**R2. Fresh QA artifact.**
- The prior browser acceptance has expired. The new artifact must have `passed`, all 12 scenarios exactly once, be under 24 hours old **at the end of capture**, have overlay hashes equal to the candidate UI bytes, and have `sourceReportSha256` bound by the coordinator to the real report.

**R3. Operator review of the captured route union**, before running `build`.
- Inspect `baseline.json` routes.
- Abort and recapture if any route, especially `bambola.heili.cloud/`, contains a 5xx, a TLS anomaly or an unexpected redirect target.
- This closes N1 operationally.

**R4. Permission normalization.** The normalization in `agenda-permissions-preflight.md` must be done and verified under the lock. Required modes:
- r9 root directory 0700, subdirectories 0755, files 0644.
- r5 `compose.ubuntu.yml` 0644.
- `runtime.env` 0600.
- The gateway Caddyfile root-owned 0444.
- The evidence directory 0700.
- Every ancestor up to `/opt` root-owned with no group or other write.

**R5. Host state at capture.**
- `docker context show` returns `default` on the local socket.
- Live labels show the exact three-file chain and working directory.
- The app runs exactly `R9_IMAGE` and is healthy; `R9_IMAGE` resolves locally.
- `require('postgres')` works inside the r9 container, and the proof matches the r9 journal.
- The r9 `/app/migrate.mjs` hash is recorded.

**R6. Capture completes** with no refusal.
- If a later guard still refuses on an unseen outcome, do not widen anything. Start a new capture or stop.

**R7. Build.**
- The image label equals the new candidate manifest.
- The isolated bundle hash equals r9's.
- The builder and proof containers are removed.
- The guard stays clean throughout.

**R8. Prepare.** The real helper render differs only at `services.app.image`.

**R9. Activate.**
- Exactly one app-only `up` command runs.
- The candidate image is healthy.
- Gateway, Caddy, other containers, relevant networks and config files are unchanged.
- Routes stay within the reviewed union.
- The metadata proof is unchanged.
- The gateway still carries its three-file labels.
- After activation, re-hash the gateway pin and confirm `status` reports a consistent chain.

**R10. Rollback readiness.** The r9 image is present and the original chain still resolves to r9.

**R11. Functional checks.**
- TLS, authentication and roles, and tenant isolation.
- Registration/QR with synthetic data only.
- Calendar behaviour.
- Physical Android testing remains separate and is not covered by viewport tests.

This PASS approves only the bounded r9-to-agenda source path with this correction. It does not authorise or demonstrate publication until R0–R11 are evidenced.