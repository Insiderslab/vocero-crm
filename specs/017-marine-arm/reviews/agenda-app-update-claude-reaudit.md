# Verdict: **PASS, conditional on the runtime checks below**

This is a source-only re-audit of the frozen hashes: `crm_app_update.py` 8253011d…, `build_crm.py` 7d8287fa…, `crm_rollout.py` 3ef0c843…, `release_lock.py` 48268a67…, and the four test files. It makes no claim of live success. Line references are function anchors because the source was supplied inline. I made no tool calls and accessed no files, hosts or services.

## Closure of prior findings

### Prior post-code finding (legacy build evidence): **closed**
- `build_update()` now writes `legacy_result_record` (exitCode, stoppedByGuard, passed=false) before raising.
  - This covers a nonzero exit, a monitor or post-build guard failure, and a missing identity.
- The update path still raises before any result is written when the build fails.
- `test_build_update_persists_legacy_failed_result_before_raising` covers both the `exit17` and `guard-after-build` cases.
- The legacy CLI keeps its lock (`crm_rollout.operation_lock`), its file names and its `crm_host check` guard.

### F1 (gateway pin): **closed**
- `GATEWAY_CONFIG` is now the fixed path `runtime/gateway-crm-ef7bcab49494.Caddyfile`.
- `capture()` records it as `compose.gatewayConfig` through `path_identity(..., mode=(0o444,))`, which checks root ownership, a non-symlink regular file and mode 0444.
- `verify_host_execution_boundary()` checks its ancestors.
- `validate_original_compose()` requires the rendered gateway mount `source == GATEWAY_CONFIG` and `read_only is True`.
- `validate_chain()` enforces the exact pin schema, including integer mode 0444.
- `verify_pinned_gateway()` re-hashes the file in `verify_pinned_inputs()` (build, prepare, activate, rollback) and in the periodic build guard lambda passed to `build_update`.
- `crm_host` defaults are unchanged.
- The happy-path fixture now mounts the pinned file, and a tamper test refuses a changed pin.

### F2 (release-tree trust boundary): **closed**
- `verify_release()` now runs these steps in order, before any verification code executes:
  1. Symlink and direct-child check.
  2. `_check_ancestors` up to `/opt`.
  3. A full top-down `os.walk` using `lstat`. Every directory must be root-owned with no `0o022` bits. Every file must be regular, root-owned, and 0600 or 0644.
- Only then is the helper's own sibling `manifest.py` loaded in-process under a private module name.
- The candidate's `manifest.py` is never executed. `test_release_tree_guard_checks_nested_directory_modes_before_manifest` proves this with an execution marker, and the same test exercises nested-directory mode, symlink, file mode and `chown` refusals.
- `manifest.py` and `crm_host.py` are outside `OPS_ALLOW`, so they must be byte-identical to r9.
- `build_update()` also uses its own sibling verifier.
- Because the tree is now root-only-writable, the time-of-check/time-of-use window before `buildx` reads the build context is closed against non-root writers.

### F3 (test gate): **closed for source review**
- The Linux root run (Python 3.12, umask 077) executed 125 tests with 1 skip, the Windows-only snapshot fixture. Real POSIX modes, `os.chown`, symlinks and replaced-inode locks were exercised.
- New negative tests cover:
  - wrong r9 image
  - arbitrary Compose labels
  - static `env_file` and a non-default Docker context
  - phase-sequence replay
  - an unexpected existing override
  - concurrent lock refusal through `main()`
  - stale QA before prepare
  - capture older than 24 hours
  - unknown app identity with no mutation
  - no-op rollback with no Compose call
  - activation timeout that keeps the `activating` intent
- Supporting evidence:
  - Real `docker compose config` rendering through `compose_prefix()` with a sentinel: PASS.
  - Real read-only SQL against a synthetic PostgreSQL database, with drift detected for each of the seven projection keys.
- The full helper render path remains a runtime gate; see checks 7 and 8.

## Regression review of the corrections

I found no new material defect. I checked:

- **Chain and artifact binding:** hash chain, canonical encoding, payload schemas, the repeated-`rolling_back` constraint, override byte equality, and binding of the build result, log, pre-activation and post-activation files.
- **Order of side effects:** the intent record is fsynced before each `up`. Compose uses `--no-deps --no-build --wait --wait-timeout 180 app` with a 210-second subprocess timeout. `activated` is appended only after the post-activation checks pass.
- **Rollback:** an unknown image is refused before any mutation. Shared Caddy, gateway, relevant-network and config drift block rollback. Unrelated drift is only recorded.
- **Subprocess environment:** `compose_env()` strips `DOCKER_*`, `COMPOSE_*` and proxy variables.
- **Metadata proof:** fixed literal SQL inside `BEGIN READ ONLY`, migration tuples only, matched one-to-one against the journal. The migration bundle hash must equal r9's at build, prepare and activate.

## Non-blocking observations

These carry over or are new. All fail closed.

1. **Activation retry cannot resume.** If `_activate` crashes after `pre-activation.json` is written but before the `activating` record, the retry fails because `write_fixed` compares against freshly captured snapshot bytes. Recovery is a new operation. Document this in the status table.
2. **Misleading no-op flag.** A `rolling_back` retry that finds r9 already restored records `noOp: true` in `rolled_back`, even though an earlier attempt did mutate the app. The earlier `rolling_back noOp:false` record still shows this in the chain.
3. **Malformed QA input raises a traceback instead of a `Refusal`.** In `qa_validate`, a malformed `capturedAt` or a non-string `sourceReportSha256` raises `ValueError` or `TypeError`. Separately, `main()` does not catch `CalledProcessError`, `TimeoutExpired` or `RuntimeError` from `build_crm`. The lock is still released and no secrets appear in argv.
4. **Brief default-mode window for the build result.** `crm_app_update.main()` does not set `os.umask(0o077)`. `build_update` creates `build-result.json` with `open('xb')` and then calls `chmod 0600`. The content is hashes only, inside a root-only 0700 directory, so there is no exposure.
5. **`runtime.env` mode is looser than designed.** `path_identity(ENV)` accepts 0644 as well as 0600, while the design requires 0600. Check 1 enforces this at runtime.
6. **Docker queried before the context check.** `verify_compose_labels()` runs `docker inspect` before `verify_host_execution_boundary()` checks the Docker context. A wrong context is still refused before any write or mutation.
7. **Gateway pin not re-hashed after `up`.** The pin is not checked again after activation. The helper never writes that file, and the pre-checks plus `--no-deps` leave the gateway untouched. Check 9 covers it.
8. **Helper trusts its sibling modules without hashing them.** The helper loads `build_crm`, `manifest`, `crm_host` and `release_lock` from its own directory. Integrity of those files relies on the coordinator, as the design states. Check 2 makes this explicit.
9. **Builder leak on early failure.** If bootstrap fails before `builder_id` is set, the builder remains and needs operator cleanup. This is fail-safe.

## Runtime checks required before publication can be claimed

1. **Permissions.**
   - Perform the reviewed normalization in `agenda-permissions-preflight.md` under the lock: r9 root directory 0700, subdirectories 0755, files 0644, and r5 `compose.ubuntu.yml` 0644.
   - Verify the after-record.
   - Confirm the candidate tree (546 files, manifest `cad4ea43…`) is root-owned under the same rules.
   - Confirm `/opt` through `evidence` are root-owned with no group/other write, `evidence` is 0700, `runtime.env` is 0600, and the gateway Caddyfile is root-owned 0444.
2. **Helper provenance.**
   - Invoke the helper as root from the verified candidate tree or an equivalent root-only location.
   - First confirm that the eight operational files match the frozen hashes, and that `manifest.py` and `crm_host.py` are identical to r9.
3. **Docker context.** `docker context show` returns `default` on the local Unix socket with `HOME=/root`.
4. **Live services.**
   - App and gateway labels equal the exact three-file chain and workdir.
   - The app runs `R9_IMAGE` and is healthy.
   - `R9_IMAGE` resolves locally.
5. **Metadata proof.**
   - `require('postgres')` resolves inside the r9 container.
   - The read-only proof succeeds and matches the 27-entry r9 journal.
   - The r9 `/app/migrate.mjs` hash is recorded.
6. **Build.**
   - The image label equals manifest `cad4ea43…`.
   - The isolated bundle hash equals r9's.
   - The builder and proof containers are removed.
   - The guard stayed clean throughout.
7. **Prepare.** The real helper render differs only at `services.app.image`.
8. **Activate.**
   - Exactly one app-only `up` runs.
   - The candidate image is healthy.
   - Gateway, Caddy, other containers, relevant networks and config files are unchanged.
   - Route outcomes stay within the baseline.
   - The metadata proof is unchanged.
   - The gateway still carries its three-file labels.
9. **After activation.** The gateway pin hash and `status` chain are consistent. Rollback readiness is confirmed: r9 is present and the original chain still resolves to r9.
10. **QA artifact.** `fdbd9bd3…` shows `passed` with all 12 scenarios, is under 24 hours old, and its overlay matches the candidate UI bytes. The coordinator confirms that `sourceReportSha256` binds the real QA report.
11. **Functional checks.** TLS, authentication and roles, tenant isolation, registration/QR with synthetic data, and calendar behaviour. Physical Android testing remains separate and is not covered by viewport tests.

This PASS approves the source for the bounded procedure only. It is not evidence of a successful deployment.