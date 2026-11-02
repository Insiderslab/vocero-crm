# Online code re-audits: r2 and r3

Date: 2 November 2026. These are actual independent reviewer results, not a coordinator self-review. Publication is still blocked by the incomplete mandatory Claude review.

## Invocation 16 — r2

Fresh native reviewer `bambola_online_reaudit_r2`, role `app_code_reviewer` (fixed GPT-5.6 Sol). Snapshot: `C:/Users/stefa/bambola-runtime/releases/20261102-r2`, 521 files, manifest `9909b64f44a39455cb69deccaab74b74073aafcb1ba1b1198227b7537fa04899`.

The four r1 P1 findings were materially addressed. One new P1 remained: `runtime.py` used `subprocess.run`, `PIPE` and `DEVNULL` without importing `subprocess`. The default image inspector therefore failed before runtime preparation; tests injected the inspector and missed the failure. Reviewer reproduced it. No P0 found. Reviewer reverified the manifest and reported 38 tests passed, one Windows symlink test skipped.

Resolution in source, second and final allowed code-fix cycle: add the missing import and a test exercising the default Docker image inspector, including rejection of a mismatched manifest label. The r2 snapshot was not modified.

## Invocation 18 — r3

Fresh native reviewer `bambola_online_reaudit_r3`, same fixed reviewer role. Snapshot: `C:/Users/stefa/bambola-runtime/releases/20261102-r3`, 521 files, manifest `ed29a574abd2b83b458ec3965e2908ff7d59381ff6e4aef61af647ccfd9c6b60`.

Scope: verify the exact r2-to-r3 delta, the missing-import correction and default-inspector regression, preserving the already-reviewed security guards. Only `deploy/marine/runtime.py` and `deploy/marine/tests/test_runtime.py` changed between snapshots. Reviewer verified the manifest and ran the focused/default-inspector and full runtime tests (14/14 passed).

Result: no supported P0/P1 in this scoped delta. The import fixes the real execution failure without weakening immutable image ID or source-manifest verification. Nonblocking nit: two identical definitions of the regression test have the same name, so Python collects one. Coverage still runs; no extra fix cycle or snapshot mutation was performed for this nit.

Completion follow-up within the same invocation confirmed actual full reads of repository `AGENTS.md`, `CLAUDE.md`, `docs/LEGGI-AI-CODING.md` and `.specify/memory/constitution.md`. Reviewer explicitly noted that the referenced `C:/Users/stefa/heili-platform/docs/GUIDA-HEILI.md` and `COORDINAMENTO-AGENTI.md` paths were absent in that checkout. This is a reported source limitation, not an invented reading. The scoped technical verdict did not change. This review does not replace Claude, runtime isolation, TLS or final usability checks.

## Coordinator evidence and remaining gates

- Python suite on r3: 39 tests collected, 38 passed, one Windows symlink test skipped.
- Local production build: `pnpm build` exit 0, log `C:/Users/stefa/bambola-runtime/evidence/local-build-r3.log`. Dedicated local preview restored by its launcher at port 3130, PID 66696. This is not a VPS image build or an online acceptance test.
- Invocation 17, the sole fresh Claude retry, failed with output-token truncation; no usable verdict. Initial invocation 15 also had no verdict. Both remain NOT COMPLETED, even though the first process returned exit 0.
- Total reviewer invocations: 18/20, including failed attempts. Two code-fix cycles used. Native Sol compute durations are unavailable; previously measured parent wall intervals and actual Claude durations remain separate, not a fabricated total.
- A targeted additional Claude attempt requires the owner extension already requested asynchronously. No third Claude attempt was made, and no dependent deployment was started while waiting.
- No remote Bambola application/root/accounts, DNS record or shared Caddy change has been created. Existing Hair container identity/start/restart/health and Caddy hash were unchanged at the last read-only checkpoint.
