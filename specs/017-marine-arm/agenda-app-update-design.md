# APP-ONLY update design — La Bambola

## Feature

### Goal and fixed boundary

Specify repeatable publication of a new La Bambola app image on Ubuntu `186.241.16.46`, changing only `bambola-arm-app-1`, with rollback to the exact predecessor app image and captured Compose chain. Do not change gateway, shared Caddy, DNS, other containers/networks, provider settings, runtime env, ports, or introduce schema/migration assets. The owner already authorized continuing La Bambola and publication on this host.

Verified r9 release evidence (`specs/017-marine-arm/CRM-RECOVERY-STATUS.md`, 3 Nov 2026): manifest SHA-256 `ef7bcab49494bf0577afec816dc239778db27cf4b470b596600a3cef96042bd7`; active image `sha256:eb8d7abe3c23cb03363852d3c796bc82a49d8bf47965f114d78f23cd5b37cb88`. Agenda source review `specs/017-marine-arm/reviews/agenda-v1-postcode.md` records corrected candidate PASS; actual agenda-v1 browser acceptance remains pending and is a publication prerequisite.

Read-only `agenda-v1-qa/current-compose-evidence.jsonl` records the observed project/service/workdir and ordered chain: project `bambola-arm`, service `app`, workdir `/opt/bambola-arm/releases/20261102-r5/deploy/marine`; files `/opt/bambola-arm/releases/20261102-r5/deploy/marine/compose.ubuntu.yml`, `/opt/bambola-arm/runtime/panels-20261102.override.yml`, `/opt/bambola-arm/runtime/crm-ef7bcab49494.override.yml`. Treat as dated evidence and re-inspect every operation.

### Existing interfaces and minimal factoring

`crm_host.py` provides read-only snapshots, manifest, TLS route, resource, container and safe-file checks, but its baseline path/proof is recovery-specific. `crm_capture_proven.py` archives one historical snapshot once. `crm_rollout.py` operates app plus gateway. Do not invoke these recovery capture/prepare/activate/rollback paths for an app update or change their pins.

`build_crm.py` currently requires `--release`, `--manifest-sha256`, `--host-snapshot-sha256`, `--node-image`; it verifies manifest and fixed `crm_host.py check`, uses pinned Node base/resource limits/host monitor/builder identity/source label/cleanup/image check, and writes fixed evidence. Preserve this CLI unchanged. Add a mutually exclusive update mode requiring `--operation-id` and `--operation-baseline-sha256`; reject mixing old and new argument groups. The legacy mode and its defaults must remain regression-tested.

Factor only primitives actually shared: an exclusive lock with ownership proof, private exclusive file+directory fsync writer, and in-memory Compose delta validator if both helpers need them. Recovery orchestration/phase behavior stays unchanged. If touching the shared lock primitive, preserve its path and acquire/release semantics while recording owner PID plus random token and inode/device; release only if opened file identity and token still match. Never unlink a replacement lock. Test with real temporary filesystem races. Recovery regression tests must prove existing successful and refusal flows remain unchanged.

## Detailed Implementation Plan

### Operation state, CLI, locks, evidence

Add `deploy/marine/crm_app_update.py` and `deploy/marine/tests/test_crm_app_update.py`. Operation ID is UTC `YYYYMMDDTHHMMSSZ-` + 12 lowercase hex; reject anything else. CLI: `capture --release PATH --manifest-sha256 HEX`; `build --operation-id ID`; `prepare --operation-id ID --candidate-image-id sha256:HEX`; `activate --operation-id ID`; `rollback --operation-id ID`; `status --operation-id ID`. Later phases derive all paths and inputs from ID; no arbitrary Compose path, env path, project/service, tag or command arguments. `status` only verifies the record chain, reports durable phase and suggests manual action; it never repairs state or clears a lock.

Use `/opt/bambola-arm/evidence/app-updates/<id>/`, root-owned mode 0700, files root-owned 0600. `operation.json` is immutable genesis (schema, ID, capture time, release manifest, predecessor snapshot hash, exact predecessor image and sanitized Compose identity). All phase changes are new sequence-numbered append-only records with prior-record hash and exclusive create; never edit genesis or earlier records. Refuse unexpected files, symlinks, owner/mode mismatch, invalid hash chain, or existing ID. Fsync files and containing directory. Preserve all evidence indefinitely.

Hold the existing shared `/opt/bambola-arm/evidence/crm-recovery-operation.lock` across each command using `crm_rollout.operation_lock()` semantics/refactored safe primitive, preventing overlap with recovery rollout. On process crash, lock remains; `status` is read-only. Stale lock clearing requires documented manual proof of owner/process absence and inode/token match; helper never clears it automatically. Activation lock is not used.

Allowed transitions: absent→captured→building→built→prepared→activating→activated; activating/activated→rolling_back→rolled_back. Each phase command verifies the terminal record and phase. Repeated apply, phase replay, tamper or interrupted phase refuses mutation. Interrupted state proceeds only through read-only `status` plus explicit operator reconciliation based on preserved evidence; no automatic retry.

### Capture and guarded build

`capture` verifies immutable release package by `deploy/marine/manifest.py verify RELEASE HEX`. The baseline package is `/opt/bambola-arm/releases/20261103-crm-r9/release-manifest.json`, with the verified r9 digest above. Read-only snapshot uses `crm_host` primitives and binds operation ID, release manifest, capture time, all container/network safe metadata, app/gateway IDs/health/ports/mounts/runtime, TLS route outcomes, resources, exact Compose identity/ordered paths and hashes, and env hash. Require healthy expected app/gateway, no published app/gateway ports, stable before/after metadata, allowed TLS outcomes, and capture age ≤24h at build/prepare/activate. Re-capture after any host/config change. Initial cycle requires known r9 manifest/image; later cycles require predecessor to be the previously recorded verified app-only update.

Compose file identity uses a fixed allowlist only: the r5 base file and two exact runtime overrides above; refuse any other `com.docker.compose.project.config_files` chain, order, path, workdir or project. Each path must be regular, root-owned, not symlinked, and have reviewed permissions; no arbitrary label-derived path is opened. Future operations may append only the helper-generated override under `/opt/bambola-arm/evidence/app-updates/<id>/`, after validating exact parent namespace, ownership/modes and its recorded digest. Runtime chain must otherwise exactly equal the allowlist.

Add separate `crm_host.py capture-update/check-update` paths taking operation ID internally (never caller path), preserving old recovery defaults. A schema-versioned operation baseline is private, immutable and SHA-bound; checks recapture and compare current safe metadata/routes/resources and baseline age. Runtime env access is only the existing approved exact `/opt/bambola-arm/runtime/runtime.env` hash in `safe_file_hashes`; read bytes solely for SHA-256, never parse, log, persist, or access any other env file.

Add an additive `build_crm.py` update argument group; retain pinned Node base, builder identity, limits, monitor/guard, cleanup, manifest label and image ID verification. Update mode checks the operation baseline before/during/after build and writes only sanitized results to that operation directory. Keep image tag temporary; durable identity is image ID plus manifest label. Do not relax networking or resource constraints.

No new migration assets or schema changes are allowed. Exact r9 comparison baseline is `/opt/bambola-arm/releases/20261103-crm-r9/`: SHA-256 equality for `drizzle/*.sql`, all `drizzle/meta/*.json` including `_journal.json`, `scripts/migrate.mjs`, `scripts/migrate-channels.mjs`, and any imported migration runner modules identified by the manifest/source graph. Refuse added/removed files or any digest mismatch. Candidate and r9 manifest must prove the artifact sets. At preflight, inspect migration journal/schema version using read-only metadata checks only; after app starts, repeat read-only migration journal/schema metadata proof. Never query passenger/customer rows or read operational records. Normal app startup will execute the existing reviewed idempotent `node migrate.mjs && node server.js` runner unchanged; helper must not run migration commands separately or alter its inputs/config. If source graph or effects cannot be proven unchanged, refuse pending a separate design.

### Prepare, app-only activation, exact rollback

`prepare` re-inspects live containers and allowlisted Compose files; predecessor image, ordered chain, hashes, project/workdir/service must match captured baseline. Render base chain and candidate chain in memory using hermetic Compose rendering with a secret fixture; compare parsed structures allowing only `services.app.image`. Never write, log, persist or retain rendered config/output. Evidence stores source hashes, image IDs and digest of a canonical redacted diff that contains only the permitted field. Any other delta refuses. Create one exclusive immutable override setting only app image to candidate digest.

Before activation recheck manifest, operation hash/phase/age, migration artifact hashes and read-only journal proof, all baseline container/network/route/port/env fields and exact Compose chain. Run only captured ordered Compose args plus operation override and `up -d --no-deps --no-build app`. Verify app has exact candidate image ID/manifest label and healthy status; gateway and every non-app container/network/runtime field, env hash, ports and TLS routes remain unchanged. Record sanitized result as next chained phase record. Any failure stops and retains evidence; rollback is explicit.

`rollback` accepts activating/activated evidence only after read-only `status` confirms the app is this operation's candidate and the recorded predecessor image is present locally. Re-render in memory and validate only app image differs; create a new immutable predecessor-ID override and run the same app-only command. Verify exact predecessor image/health and unchanged external state plus read-only migration journal/schema proof. Never use a tag, rebuild r9, manually run migrations, restore DB, or touch gateway/Caddy. Ambiguous ownership/state refuses without mutation.

### Tests and gates

Use hermetic Compose CLI render with secret fixture but no Docker daemon mutation. Use mocked Docker inspect, HTTP and build subprocesses otherwise. Use real temporary filesystem tests for lock races/replacement ownership, modes, symlink refusal, exclusive writes, fsync and append-only hash chains. Recovery helper lock refactor must pass its existing regression tests.

| Case | Expected |
|---|---|
| Valid r9 capture; manifest/image/TLS/health as expected | Genesis and first immutable snapshot created |
| Invalid ID, wrong/stale manifest, changed host/chain/container/network/route/ports | Refuse before build/mutation |
| Secret fixture in env/Compose interpolation | Secret absent from every file/stdout/stderr; only approved env hash and redacted diff persist |
| Non-allowlisted label path, symlink, wrong owner/mode, extra override | Refuse before reading/rendering it |
| Builder/base/resource/provenance/cleanup failure | No prepare/activation; durable evidence retained |
| Added/changed/removed SQL, journal, snapshot, runner or migration import | Refuse before prepare |
| Read-only migration metadata proof differs before/after | Stop; no further action; never read passenger rows |
| Compose delta beyond app image | Refuse; render exists only in memory |
| Lock contention/replacement/stale lock | Refuse; never unlink non-owned/replacement lock |
| Valid apply and rollback | Only app service targeted; exact candidate/predecessor image verified; external state unchanged |
| Crash, replay, tampered chain, duplicate apply | `status` read-only; no implicit resume/overwrite |
| Recovery lock regression tests | Prior recovery orchestration behavior unchanged |

### Alternatives, known facts, and boundaries

Reusing `crm_rollout.activate/rollback` is rejected because it updates app plus gateway using recovery-specific evidence. Patching pins or reusing `capture_proven` is rejected because it conflates one-shot recovery proof with per-update evidence. Manual Compose/tag rollback is rejected because exact predecessor and locking cannot be demonstrated.

Known: r9 hashes/status and agenda source review are recorded; browser acceptance remains pending. The Compose chain is a dated observation and must be recaptured. Existing startup runner is `scripts/migrate.mjs`, invoked from Dockerfile as `node migrate.mjs && node server.js`; its existing idempotent behavior remains part of normal restart. This design permits no new migration/schema artifacts. No actual browser or host operation is claimed.

Before implementation, complete all five EGM design stages and a fresh Claude security review; after code, obtain separate fresh diff/proof review. Preserve current authorization; these are review gates, not a request to reauthorize La Bambola publication.
