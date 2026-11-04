# Verdict: **BLOCKED**

This is a source-only review of the supplied frozen hashes (`crm_app_update.py` 2d61270e…, `build_crm.py` 568eb6d9…, `crm_rollout.py` 3ef0c843…, `release_lock.py` 48268a67…, plus tests). It makes no claim of live success. Line numbers are given as function anchors because the source was supplied inline.

The lock primitive, the hash-chained phase records, the app-only argv, the intent-before-side-effect ordering, the stripped subprocess environment, the read-only metadata proof and the migration-bundle binding are sound in design and mostly in code. Two material defects and one material test gap remain.

---

## F1 (material): the gateway Caddyfile pin is wrong, so capture refuses and the live gateway config is unprotected

**Evidence:**
- `crm_app_update.py` `validate_original_compose()` requires the rendered gateway mount source to equal `baseline['configFiles']['runtimeGateway']['path']`.
- `crm_host.safe_file_hashes()` fixes that path to `/opt/bambola-arm/runtime/gateway.Caddyfile`.
- The r9 chain's third file, `crm-ef7bcab49494.override.yml`, was produced by `crm_rollout.write_plan_files()`. That function writes the gateway volume as `RUNTIME/gateway-crm-{manifest[:12]}.Caddyfile`, which is `gateway-crm-ef7bcab49494.Caddyfile`. `read_plan()` enforces the same path.

**Consequences:**
1. **Capture fails.** The rendered three-file chain mounts `gateway-crm-ef7bcab49494.Caddyfile`, so capture refuses with "Pinned Compose gateway mount differs…". This fails closed but blocks the release.
2. **Integrity gap.** No snapshot, genesis record or phase hashes the bytes of the Caddyfile the gateway actually serves. `configFiles.runtimeGateway` hashes the old, unused `gateway.Caddyfile`. The gateway container record compares only the mount Source path, not the content. So the build guard, `verify_app_only_result` and `verify_rollback_boundary` cannot detect a content change to the live gateway config. That contradicts the "unchanged Bambola gateway" invariant.
3. **The test hid it.** `test_capture_build_prepare_activate_mocked_happy_path_app_only` sets `runtimeGateway.path` and the rendered mount source to the same synthetic `gateway.Caddyfile`, so it encodes the wrong model.

**Required fix:**
- Pin the fixed path `RUNTIME/'gateway-crm-ef7bcab49494.Caddyfile'`.
- Check it the same way as the other pinned inputs: non-symlink, root-owned, not group/world writable, mode 0444 per `prepared_file`.
- Record its SHA-256 in genesis, either under `compose` or in a new exact key.
- Require the rendered gateway mount to equal that path with `read_only: true`.
- Re-hash it in `verify_pinned_inputs()`, which covers build, prepare, activate and rollback.
- Fix the fixture to match the real three-file chain.
- Leave `crm_host` defaults unchanged, as the design requires.

## F2 (material): the release-tree trust boundary is checked after execution and misses subdirectories

**Evidence: `verify_release()` runs checks in this order:**
1. Release directory owner and mode.
2. **`crm_host._manifest_release()`**, which runs `sys.executable <release>/deploy/marine/manifest.py verify …` through `crm_host.command()`. That call uses the **ambient environment** (no `env=`) and no `-I`, so the script's directory `deploy/marine/` is first on `sys.path`.
3. Only then `_check_ancestors()` and the per-file owner/mode loop.

Capture calls this on the candidate before the r9-equality diff check, so the candidate's own `manifest.py` runs as root before anything proves it equals r9. `manifest.py` is also self-verifying: the code that checks the tree comes from the tree. Any module dropped into `deploy/marine/` (for example `json.py` or `hashlib.py`) runs on import, before the walk rejects it as an extra file.

**Gap in directory checks:** `_check_ancestors()` walks only upward from the release root. **No directory inside the release is checked** for root ownership or group/world-write bits. Root-owned 0644 files inside a group-writable subdirectory can be renamed or replaced. That defeats the per-file ownership check, and it opens a time-of-check/time-of-use window between `manifest.py verify` in `build_update()` and the moment `docker buildx build` reads the context. The "exact image ↔ manifest" binding then holds only by assumption.

**Required fix:**
- Before any execution, walk the entire candidate and r9 trees with `lstat`. Require every directory to be root-owned, not a symlink and without `0o022` bits, and every file to be root-owned, regular and 0600 or 0644.
- Run the verifier without importing from the tree. Either:
  - call `manifest.verify()` in-process from the helper's own reviewed module, or
  - run `python -I` with `compose_env()` and a verifier whose bytes are hash-pinned to a constant.

The legacy `crm_host` CLI can keep its behaviour. Only the app-update call path needs to change.

## F3 (material, test gate): POSIX security guards are never exercised and required negative tests are missing

Every ownership, mode and ancestor guard sits behind `os.name=='posix'`. The 42-test focused run was on Windows: Python 3.14, `C:/Users/…`, two skips matching `test_replaced_inode_is_preserved` and `test_symlink_lock_refused`. So none of these were executed:
- `safe_json` uid/mode
- `operation_dir`
- `path_identity`
- `_check_ancestors`
- `verify_host_execution_boundary`
- the mode-0700 parent check in `ReleaseLock._validate_parent`
- the `O_NOFOLLOW` lock refusal
- the replaced-inode lock refusal

The design explicitly forbids mock-only claims about filesystem ownership.

Also absent:
- Refusal tests for wrong r9, arbitrary Compose labels, `env_file` in static sources, and a non-default Docker context.
- Phase replay or out-of-order transitions beyond one payload tamper case.
- An unexpected pre-existing override.
- Concurrent lock refusal through `crm_app_update.main`.
- Metadata-projection drift per catalog key.
- Real Compose rendering through `compose_prefix()`. The fixture proof is labelled `sourceHelperIntegrated: false`.

The 117-test "full operational" run does not state its platform.

**Required:** a Linux (root) run of the suites with real temporary directories for each refusal above, plus a real `docker compose config` render through `compose_prefix()` with a synthetic `--env-file` sentinel.

---

## Non-blocking observations

- **Liveness bugs (fail closed):**
  - If `_activate` crashes after `pre-activation.json` is written but before the `activating` record, the operation can never activate, because `write_fixed` compares against new snapshot bytes.
  - A `rolling_back` retry that finds r9 already restored records `noOp: true` even though a mutation happened.
  - Document both outcomes in the status table.
- **Malformed QA input crashes instead of refusing:** `qa_validate` raises uncaught `ValueError`/`TypeError` for a malformed `capturedAt` or a non-string `sourceReportSha256`. It still fails closed, but with a traceback. Treat it as a `Refusal` instead.
- **Uncaught subprocess errors:** `main()` catches only `Refusal`/`LockRefusal`. Compose `CalledProcessError`/`TimeoutExpired` and `build_crm` `RuntimeError` propagate as tracebacks. The lock is still released and no secrets appear in argv, but output is noisy.
- **`PATH` is inherited from the caller.** Running as root with sudo `secure_path` is acceptable, but a fixed `PATH` would be stricter.
- **Builder cleanup leak:** if `buildx inspect --bootstrap` fails before `builder_id` is set, `build_update`'s `finally` refuses to remove the builder, which then needs operator cleanup. This fails safe.
- **`sourceReportSha256` is only format-checked.** Binding it to the real QA report is a coordinator responsibility.

---

## Runtime checks still required after F1–F3 are fixed (before any PASS)

1. **Host tree permissions:**
   - `/opt`, `/opt/bambola-arm`, `releases`, the candidate and r9 trees (every directory), `runtime`, and `evidence` are root-owned with no group/other write.
   - `evidence` is 0700.
   - `runtime.env` is 0600.
2. **Live labels and paths:**
   - Live app and gateway labels equal the exact three-file chain and workdir.
   - The gateway mount is `gateway-crm-ef7bcab49494.Caddyfile`, read-only, and its hash matches the pin.
3. **Docker context:** `docker context show` is `default` on the local socket under `HOME=/root`.
4. **r9 identity:**
   - The app runs `R9_IMAGE` and is healthy.
   - `docker image inspect` resolves `R9_IMAGE` locally for rollback.
   - The r9 `/app/migrate.mjs` hash is recorded.
5. **Metadata proof:** `require('postgres')` resolves inside the r9 container from `/app`. The proof query succeeds in `BEGIN READ ONLY` and matches the 27-entry r9 journal.
6. **Candidate build:**
   - Manifest label equals the candidate manifest.
   - The isolated bundle hash equals r9's.
   - Builder and proof containers are removed.
   - The guard stayed clean throughout.
7. **Compose delta:** a real `config` render shows the candidate chain differing only at `services.app.image`.
8. **Post-activation:**
   - Exact candidate image, healthy.
   - Gateway, Caddy, other containers, relevant networks and config files unchanged.
   - Route outcomes stay within the baseline.
   - Metadata proof unchanged.
   - Gateway labels still the three-file chain.
9. **Rollback readiness:** demonstrated or rehearsed under the same invariants. `status` reports a consistent chain.
10. **QA artifact:** `passed`, all 12 scenarios, under 24 hours old, overlay hashes equal the candidate UI bytes, and the source-report digest matches the real report.
11. **Functional checks:** TLS, auth and roles, registration/QR with synthetic data, and calendar behaviour. Physical Android testing remains a separate item, not covered by viewport tests.

I made no tool calls and accessed no files, hosts or services.