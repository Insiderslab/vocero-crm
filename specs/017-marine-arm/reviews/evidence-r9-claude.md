# Verdict: **PASS, conditional on host runtime gates**

This review covers the supplied r9 text only. I did not independently recompute manifest `ef7bcab4…42bd7` or rerun the tests. The supplied test log matches the stated count: 94 run, 93 pass, 1 skipped (symlink test on Windows). I found no implementation defect that breaks the Stage 9 contract or weakens a security boundary.

## Contract conformance

| Stage 9 clause | Status | Reference |
|---|---|---|
| Writer owns archival inside the shared parent lock, and the lock is taken before any state check | ✅ | `crm_capture_proven.py` `capture_proven`: `with crm_rollout.operation_lock(): _check_runtime_state()` |
| Lock sits at a fixed parent path, outside the renamed directory | ✅ | `crm_rollout.py` `OP_LOCK = ROOT/'evidence'/'crm-recovery-operation.lock'` |
| prepare, activate, rollback and build all use the same lock, with no nesting | ✅ | `prepare`, `activate` and `rollback` wrappers; `build_crm.main`. Build's guard subprocesses don't take the lock. |
| Pre-archive checks: exact single snapshot with the pinned SHA, no legacy state, no builder, parent root-owned with mode 0700 | ✅ | `_check_runtime_state` |
| Snapshot hash rechecked after rename | ✅ | `capture_proven`, after `os.rename` |
| Current metadata captured before and after 10 fresh TLS-verified rounds, all five groups compared exactly | ✅ | `capture_proven`, `_normalize_source_metadata` |
| Only the compose and gatewayTemplate paths are normalized, and their hashes must match | ✅ | Writer `_normalize_source_metadata`; reader `_validate_route_evidence` config loop |
| App union is extracted from verified A/B bytes, not taken from constants. Constants are only a shape assertion. | ✅ | `_sources` and `capture_proven` (`derived_app` from `source['routes']`) |
| Audit is written and fsynced first; baseline is schema 2 and carries the audit SHA; no circular SHA | ✅ | `_write(ROUTE_AUDIT…)` precedes `_write(SNAPSHOT…)` |
| Writer self-validates before the baseline write | ✅ | `crm_host._validate_route_evidence(baseline)` runs before `_write(SNAPSHOT…)` |
| Reader requires root ownership, mode 0600/0700 and no symlinks on the snapshot, audit, source files and every directory component | ✅ | `_snapshot_read` (`_snapshot_root_owned`, `_snapshot_modes_private`); `_private_root_file` directory walk |
| Reader checks exact audit keys, int types, canonical bytes, UTC, manifest and timestamp binding | ✅ | `_validate_route_evidence` |
| Source identity is exact; `zip` truncation is caught by the length-2 check | ✅ | Same function, `len(source_records) != 2 …` |
| Non-app routes: single value, identical across A, B, fresh capture and baseline; an extra outcome refuses | ✅ | Last loop of `_validate_route_evidence`; test `…allowed_plus_extra_non_app…` |
| Source age must be ≤ 24h before capture, compared at capture time rather than read time | ✅ | Source timestamp loop |
| Bool and float `schemaVersion` values are rejected; malformed provenance becomes a `Refusal` | ✅ | `type(...) is not int`; the `except (KeyError, TypeError, …)` wrapper |
| Schema 1 is still accepted, and no historical-union writer ever produces schema 1 | ✅ | The operator SHA pin prevents a silent downgrade |
| Failure preserves the archive and partial output, with no cleanup or retry | ✅ | Test `test_audit_write_failure_preserves_archive…` |
| App, gateway and runtime config are unchanged | ✅ (per the diff scope supplied) | |

The r8 Sol findings are resolved:
- **Snapshot root ownership:** checked by `_snapshot_root_owned`.
- **Checkpoint/consumer negative tests:** a 7-checkpoint matrix confirms the lock inode persists across the rename, all three consumers refuse with their bodies never called, and invalid schema-2 audits stop both build and prepare before builder creation or plan write.

## Mandatory runtime gates

These must be verified on the host before and after running the writer. Stop on any failure, and do not patch around one.

1. **24-hour source window. This could already be closed.** `_validate_route_evidence` refuses if `capturedAt` minus the older source's `capturedAt` exceeds 24h.
   - Source A's directory is stamped `20261103T0038Z`, and its snapshot `capturedAt` is likely earlier than that.
   - The writer only checks this window after `os.rename` and after the audit write. A late run therefore leaves the archive renamed and an audit-only `EVIDENCE`. That is fail-closed but requires manual operator recovery.
   - **Read both source `capturedAt` values before execution.** If the deadline has passed, STOP. Under the contract this is a design-level refusal, not something to work around.
2. **Ownership and modes of the source-proof directories.** `_private_root_file` requires root ownership and mode 0700 on the A and B archive directories and on `/opt/bambola-arm/evidence`, and root/0600 on both proof files. The tests simulate POSIX ownership on Windows, so this must be confirmed on the real host.
3. **The r3 release still verifies.** The reader runs `_manifest_release` against `/opt/bambola-arm/releases/20261103-crm-r3`, which executes r3's `manifest.py` as root on every check. It must exist unchanged, be root-owned, and verify under manifest `d4c1de65…9c76`.
4. **Compose and gatewayTemplate SHAs match between r3 and the current release.** The writer refuses otherwise.
5. **Preconditions:** the lock file is absent, no legacy scripts are running, the builder is absent, and the current snapshot SHA is `f3286ea3…6de0`.
6. **Downstream gates, all unclaimed here:**
   - private build with image/label/cleanup guard;
   - `prepare` and `activate` for Bambola app and gateway only;
   - public TLS, auth, roles, provider, RSC, body, XFF, cross-org and UI checks;
   - Hair and the other routes unchanged afterwards.

## Non-blocking observations

None of these change the verdict.

- **Late time-window check in the writer:** this is the gate 1 issue. A future revision should run the source-age and full reader shape checks inside `_sources` before the rename, so a refusal leaves no state to recover from.
- **Missing pre-rename checkpoint test:** the checkpoint matrix patches out `_check_runtime_state`, so no test covers the window between lock acquisition and the rename. Code inspection shows correct ordering.
- **Duplicated validation code:**
  - `canonical` duplicates `_canonical`.
  - The outcome-record validator appears three times.
  - The non-app and app checks are duplicated between the writer and the reader.

  This is a maintainability debt under LEGGI §3.2. The reader is the authoritative gate, so there is no security impact.
- **Small cleanups:**
  - `subprocess` is an unused import in `crm_capture_proven.py`.
  - `_normalize_source_metadata` mutates the source records in place. This is harmless here.
- **Pre-existing limitations, not regressions:**
  - `operation_lock` unlinks by path in `finally`.
  - The `stat`-then-read in `_private_root_file` is not fd-bound.
  - Both are mitigated by root-only 0700 directories.
- **External risk stays unfixed and should be reported separately:** the `app.heili.cloud` duplicate-alias misrouting is accepted only as the two observed outcomes.

**Result:** PASS for the code under the exact Stage 9 contract. There is no claim of deployment, capture, build, activation or public-test success. Check gate 1 first, because it may already block execution.
