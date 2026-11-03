# Agenda release: bounded app-only update from r9

## Feature

Publish the reviewed agenda UI to La Bambola on Ubuntu 186.241.16.46, replacing only `bambola-arm-app-1`. Preserve the exact running r9 image for rollback. This is a bounded r9-to-agenda procedure, not a general deployment platform. A later update from another baseline is outside this helper's accepted input. The owner has already authorized publication and ordinary app restart; no new permission is needed for this scope.

Keep gateway, shared Caddy, DNS, Hair, other services, provider settings, runtime environment, persistent volumes and published ports unchanged. No real-data import, message send, payment or purchase. Only dedicated temporary build/image-verification containers may be created and removed, with proven identity. Existing app startup executes its unchanged migration/reconciliation runner, which can read/write application records. Do not claim the database is untouched. The helper itself reads only migration/schema metadata, and introduces no new migration/reconciliation code or configuration.

Current verified r9 source is `/opt/bambola-arm/releases/20261103-crm-r9`, manifest `ef7bcab49494bf0577afec816dc239778db27cf4b470b596600a3cef96042bd7`, image `sha256:eb8d7abe3c23cb03363852d3c796bc82a49d8bf47965f114d78f23cd5b37cb88`. Evidence: `specs/017-marine-arm/CRM-RECOVERY-STATUS.md`; safe read-only Compose observation: `C:/Users/stefa/bambola-runtime/agenda-v1-qa/current-compose-evidence.jsonl`. Recheck the host, not just these dated reports.

The agenda changes exactly `src/components/marine/admin-panels.tsx` and `src/components/marine/marine-app.tsx` at runtime. The application/source review is `reviews/agenda-v1-postcode.md`. Actual browser acceptance must be completed before capture. Neither review nor a local build alone proves online readiness.

### Why this boundary

The existing recovery capture and rollout are pinned to a historical app-plus-gateway recovery. Do not edit their baseline constants or invoke them for this release. The earlier draft proposed a reusable operation lineage and recovery framework. That was unnecessarily broad for this release and introduced unclear future-chain and crash semantics; it is superseded by this bounded plan. A raw unreviewed Compose command would omit provenance, locking and rollback checks; this plan keeps those checks in a small reviewed helper. Building on the host retains the existing pinned base and resource guard, avoiding an unverified different build toolchain.

## Detailed Implementation Plan

### Owned files and reuse

Add `deploy/marine/crm_app_update.py` and focused tests. Modify `build_crm.py` only to expose its existing guarded build body as a callable accepting explicit guard callback, private evidence directory and verified held-lock identity. Keep its old public CLI and recovery defaults unchanged. Public legacy build owns the lock; app-update build owns it and calls the private body directly, never the locking CLI. Regression-test both paths.

Factor a small shared operation-lock primitive if needed, used by `crm_rollout.operation_lock()` and app-update. Same fixed lock path `/opt/bambola-arm/evidence/crm-recovery-operation.lock`; O_EXCL/O_NOFOLLOW, private parent/root ownership, mode0600, random token, PID, inode/device. Release only the same inode/device/token owned by this invocation. A replaced or stale lock is never unlinked. Preserve recovery orchestration and its tests. Do not add a generic deploy framework.

Reuse read-only `crm_host` collectors and manifest validation as functions. Do not call the recovery snapshot reader, capture writer, route-proof pins or old rollout activation. Do not change `crm_host`'s recovery defaults. App-update supplies its own immutable baseline to its comparison function and to the build callback. Never monkey-patch module constants.

### Canonical CLI and files

The public interface is `crm_app_update.py capture --release PATH --manifest-sha256 HEX --qa-sha256 HEX`, then `build|prepare|activate|rollback|status --operation-id ID`. Capture generates and prints `YYYYMMDDTHHMMSSZ-` plus12 random lowercase hex characters. All later paths, manifest/image identities and commands come from validated evidence; no caller-provided Compose, env, service, image tag or shell string. The candidate release must be a real directory and a direct child directory of `/opt/bambola-arm/releases`, never a symlink. Require root UID ownership and directory mode0700 or0755; every ancestor through `/opt` must be a nonsymlink root-owned directory without group/world write bits. Require each manifest input to be a regular nonsymlink root-owned file, mode0600 or0644. Reject path traversal and resolved paths outside the exact candidate directory.

Use `/opt/bambola-arm/evidence/agenda-app-update/<ID>/`, root-owned0700. Immutable genesis `operation.json` contains schema1, ID, capture time, candidate path/manifest, r9 path/manifest/image, QA digest, baseline digest, exact Compose file identities, and protected runtime hashes. `baseline.json` and sequence phase records are root-owned0600, exclusive-created, file+directory fsynced. Phase records have sequence, previous-record SHA256, phase and sanitized payload. Derive phase only from the verified chain; never edit genesis or earlier records. Allowed additional filenames are the two fixed overrides, build log/result, QA evidence copy and metadata-proof records named in genesis/schema. Refuse symlinks, unexpected records, wrong ownership/modes, broken chains, partial JSON and duplicate operation directories.

Mutating phase commands hold the shared lock from validation through final record. `status` is lock-free and read-only: read/validate the chain twice and require the terminal digest unchanged, then inspect only the fixed owned app/lock identity. It reports incomplete state and never clears locks or repairs records.

### Capture and browser proof

Capture is allowed only while app image and configured Compose chain equal the exact known r9 baseline. The only initial allowed files, in this order, are:

1. `/opt/bambola-arm/releases/20261102-r5/deploy/marine/compose.ubuntu.yml`
2. `/opt/bambola-arm/runtime/panels-20261102.override.yml`
3. `/opt/bambola-arm/runtime/crm-ef7bcab49494.override.yml`

Project is `bambola-arm`; workdir is `/opt/bambola-arm/releases/20261102-r5/deploy/marine`; service is `app`. Compare labels to this list before opening any paths. Files and ancestor directories must be nonsymlink, root-owned, not group/world writable; Compose files modes0600 or0644. Record hashes. Do not treat Docker labels as arbitrary file-read authority.

Package verification requires r9 manifest verification and complete candidate manifest verification, then equality of all r9 application/build inputs except the two reviewed UI paths. The complete non-UI difference allowlist is: `deploy/marine/crm_app_update.py`, `deploy/marine/release_lock.py`, `deploy/marine/build_crm.py`, `deploy/marine/crm_rollout.py`, `deploy/marine/tests/test_crm_app_update.py`, `deploy/marine/tests/test_release_lock.py`, `deploy/marine/tests/test_crm_build_lock.py`, `deploy/marine/tests/test_crm_rollout.py`, and `deploy/marine/agenda-browser-acceptance.json`. No other added, changed or removed manifest input is allowed. Tests must embed their synthetic fixtures rather than add unlisted paths. These files are Docker build-context bytes because the Dockerfile uses COPY . ., so do not claim they are outside the context. Verify the unchanged Dockerfile/package build scripts and the complete source import graph do not execute, import or read these paths inside the image build or app startup; reject any such reference. Python operational helpers execute only as the separately reviewed host-side deployment procedure. The Next build and migration bundler consume the unchanged application build scripts and runtime inputs, not these operational paths. Record this static reference/build-command check and compare the actual migration bundle. In particular package.json, lockfile, Dockerfile, all Drizzle SQL/meta files, migration scripts and all their imports, runtime config and provider code are identical. Reject added/deleted runtime files. Do not infer package immutability from a tag.

Candidate package includes `deploy/marine/agenda-browser-acceptance.json`, a coordinator-produced immutable sanitized artifact. Required schema: version1, status`passed`, baselineManifestSha256, overlay list of the two source paths+SHA256s, unchangedRuntimeInputsSha256, local build ID, scenario results, source report SHA256 and capturedAt. Required scenarios cover modes/date navigation, actual create+reload+single persisted record, overlap draft retention, explicit A-to-B administration, chronological ordering, Caracas boundary, confirmed POST+failed GET, ambiguous POST+same payload/requestId retry, crew restrictions,320/390px and keyboard. Artifact must identify the exact candidate runtime file set, have no failed/blocked required case and be no older than24hours. Capture checks its explicit caller digest and file hash in the candidate manifest. Build output later binds the resulting image ID/manifest label to this same candidate manifest. No self-asserted acceptance generated by the deployment helper. Canonical unchangedRuntimeInputsSha256 is SHA256 of UTF-8 JSON for the sorted path-to-SHA256 map of candidate manifest entries, excluding only the two UI paths, the enumerated nine operational paths and .env.example; serialize with sorted keys, ASCII escapes and comma/colon separators without whitespace. It must equal the same r9 projection. Required result names exactly: admin-visible-entry; four-calendar-modes-and-selected-date; leap-day-and-month-end-navigation; create-future-tour-through-visible-controls-and-reload; Caracas-date-grouping-across-UTC-midnight; overlap-rejection-retains-draft; two-tour-selection-and-explicit-administration-action; slow-refresh-keeps-calendar-navigation-disabled; confirmed-create-with-following-read-failure; ambiguous-post-retry-reuses-same-command-id; crew-has-no-create-action; responsive-keyboard-and-zoom. Each appears once with status pass; the artifact source report digest binds the real QA report. This is 12 required scenarios, not physical Android validation. Activate repeats these checks; absent/stale/mismatched QA evidence refuses.

Capture before/after safe metadata and require stability: expected healthy app/gateway, exact other-container IDs/config hashes, network topology, shared Caddy identity/config hash, ports/mounts, safe runtime file hashes, TLS routes and resources. Use existing verified route probes. Capture multiple route samples and allow only observed outcomes; a later unobserved external outcome refuses activation rather than widening the allowlist. Record all outcomes. Fixed runtime env is hashed only by parent code; never read other projects' env or output env contents. Baseline age maximum24hours; any drift before activation refuses.

### Compose and secret boundary

For rendering/apply use an explicit argv, never a shell:
`docker compose --project-name bambola-arm --project-directory /opt/bambola-arm/releases/20261102-r5/deploy/marine --env-file /opt/bambola-arm/runtime/runtime.env -f BASE -f PANELS -f CRM [-f OWN_OVERRIDE] ...`.

Use a minimal allowlisted subprocess environment (PATH, HOME for root Docker configuration, locale); strip COMPOSE_*, DOCKER_HOST/CONTEXT and all interpolation variables from ambient environment. Require the local default Docker socket/context. Explicit env-file prevents implicit project .env discovery. Validate static Compose sources contain only the reviewed runtime env-file reference. Compose may read this one owned runtime.env internally for normal rendering/apply; helper Python only hashes it. Parsed render output stays in memory, never in logs, evidence or exception output. Test-only synthetic env uses a sentinel; production never substitutes the test fixture.

Render captured chain and candidate chain with `config --format json` and compare entire structures allowing exactly `services.app.image`. Create fixed immutable `candidate.override.yml` containing only candidate image ID; create `rollback.override.yml` containing only r9 image ID when needed. Both are beneath this operation directory and hashed. Candidate apply uses initial3files+candidate override. Rollback uses initial3files+rollback override, not both. Gateway's original3-file labels remain unchanged. This helper refuses a new capture after either outcome; future update support is explicitly out of scope.

### Build and migration behavior

Build retains pinned Node base, resource limits1CPU/2GB, exact dedicated builder name, manifest verification, guarded monitoring, source-manifest label, cleanup and exact image-ID validation from `build_crm.py`. The calling helper owns the lock and passes a handle checked by the private build function. Guard compares current host with this operation's baseline before/during/after the build; allow only the proven dedicated builder as temporary drift. Build failure never prepares or activates an image. Preserve private logs without environment values; no Docker secrets or production env are build inputs.

Record and verify the actual `/app/migrate.mjs` bundle SHA256 from the running r9 app (fixed Docker exec command outputs only hash). After build verify the candidate bundle in an isolated `--network none --read-only --cpus 0.25 --memory 128m --entrypoint node` temporary container, with no runtime env/mounts; it outputs only SHA256 and exits. Name/label tied to operation ID, refuse existing name, remove only proven ownership. It must equal r9. This binds the actual bundled Drizzle/migration implementation, not only a semver range. Local package/lock inputs remain byte-identical too.

Before activation and after start/rollback, obtain a metadata-only proof inside the fixed owned app container using its existing DATABASE_URL internally, never printed/copied. Use a read-only transaction. Allowed reads: `drizzle.__drizzle_migrations` fields id,hash,created_at and deterministic pg_catalog schema metadata (names/types/nullability/defaults/constraints/index definitions, excluding volatile OIDs/counters and operational table contents). Hash canonical schema metadata, retain migration tuples only. No passenger/contact/conversation/message rows are queried by the helper.

Expected migration tuples follow installed pinned Drizzle0.38.4 `migrator.js/readMigrationFiles`: each `_journal.json` entry tag maps to `drizzle/{tag}.sql`; hash SHA256 of full UTF-8 decoded SQL string before statement splitting; created_at is entry.when normalized to a base10 integer string. Require a complete one-to-one hash/time set; ids are positive unique monotonic SERIAL values, not journal indexes. Pre/post tuples including ids and canonical schema digest must match. Normal unchanged startup still executes its existing checks/reconciliation and may write application rows; no additional standalone migration command is run.

### Phase order and crash behavior

Transitions: captured → building → built → prepared → activating → activated. Rollback from activating/activated may produce rolling_back → rolled_back. Before every side effect, append and fsync its intent record. Specific order:

- Build: lock, validate, fsync building, run guarded build, verify exact image/bundle and cleanup, fsync built.
- Prepare: lock, validate QA/build/baseline, write candidate override, render+validate diff, fsync prepared. No application mutation.
- Activate: lock, fully revalidate baseline/QA/files/env/migration proof, fsync activating, run exact Compose argv with `up -d --no-deps --no-build app`, inspect candidate image/health/config and all invariants, fsync activated only on complete success.
- Rollback: lock, inspect owned state, validate original3files/env/overrides/r9image availability, fsync rolling_back, run initial3files+rollback override with the same app-only flags, verify r9 local health/config and report public/external state, fsync rolled_back with explicit external-check results.

No command implicitly retries apply. A failed/interrupted phase retains its last durable intent. `status` reports:

| Durable state / observed app | Allowed next action |
|---|---|
| captured/built/prepared, exact r9 healthy | Resume only the next normal phase, after full validation |
| building | No resume build; inspect owned builder and lock, preserve evidence; a new operation only after proven cleanup and unchanged r9 |
| activating, exact candidate with expected config | Explicit rollback allowed |
| activating, exact r9 healthy and config unchanged | Rollback verifies r9 and appends a no-op rolled_back record; no Compose mutation |
| rolling_back, exact candidate and expected config | Explicit rollback may retry only this exact predecessor restoration after new full owned-boundary check |
| rolling_back, exact r9 healthy with expected original or rollback chain | Verify and append rolled_back without mutation |
| any state, missing app or unknown image/config | Refuse mutation and report manual recovery required |

A stale lock is never automatically cleared. Operator recovery must prove PID absent, no matching builder/apply subprocess remains, and exact recorded inode/token before removing only that lock. It is not a normal phase path. Tests cover each boundary, including fsync before launch, crash after launch and before terminal record.

### Rollback when an unrelated service drifts

Pre-activation drift always blocks. After application replacement, an unrelated container restart or external-route failure is recorded and prevents success, but does not by itself prevent restoring r9. Rollback still requires exact ownership and expected candidate app configuration, unchanged Bambola gateway, relevant Docker networks, original Compose inputs, own runtime env/mounts/ports, and available r9 image. Shared Caddy/config or relevant network changes make routing safety unknown and block mutation. Other non-app container ID/health or unrelated URL outcome changes are recorded, not silently accepted and not automatically repaired. After restoring r9, local app health/image must pass; any public/external failure remains an explicit unsuccessful external verification, never reported as a clean release.

### Required tests and release gates

Use real temporary files for lock replacement, stale lock, symlink/permission failures, exclusive files, hash chain and crash fsync boundaries. Mock Docker/network commands for negative mutation tests. Run hermetic real Compose rendering with a synthetic secret sentinel (no daemon mutation), checking whole-structure delta and absence of secret output. Keep old recovery/build tests passing.

Test refusal for wrong r9, arbitrary labels/path/env, stale/tampered QA/source/build image, dependency/bundle/migration changes, external drift, resource guard failure, concurrent/replaced lock, phase replay, unexpected existing overrides, unknown current app. Test exactly one app-only command, no gateway/DB/DNS/Caddy mutations, exact rollback both after ordinary activation and after unrelated drift. Test no-op rollback and crash branches. No mock-only success claim for actual Compose rendering or filesystem ownership.

Before implementation complete remaining EGM stages7-9 with all recorded findings resolved. After implementation require fresh independent diff/proof review plus Claude security review. Then freeze the package, run the bounded procedure, and verify TLS/authentication/roles, registration/QR with synthetic data, correct calendar, exact non-app integrity and rollback readiness. Automated mobile viewport tests are not physical Android tests. Never publish or claim ready with failed or unknown essential checks.



## Stage 9 implementation contract (authoritative wire details)

The following exact schema overrides shorthand field descriptions above. Canonical JSON means `json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":")) + "\n"`, encoded UTF-8 without BOM. Hashes are lowercase SHA256 of those exact stored bytes. Timestamps are UTC strings `%Y-%m-%dT%H:%M:%SZ`, reject invalid dates or >60seconds in the future. Reject unknown/missing keys and wrong types (a boolean is not an integer). IDs/hashes/paths use the validators already specified.

Genesis exact keys: `schemaVersion` integer1, `id` string, `capturedAt` timestamp, `candidate` object `{path,manifestSha256}`, `predecessor` object `{path,manifestSha256,imageId,migrationBundleSha256}`, `baselineSha256` hash, `qaSha256` hash, `runtimeInputsSha256` hash, `compose` object `{project,workdir,files}`; files is exactly the initial3 ordered objects `{path,sha256,mode}` with mode integer0600 or0644. Baseline is the existing safe `crm_host.current_snapshot_fields` projection plus `metadataProof`; collector fields are validated by the existing comparison logic and the new fixed owned-app invariants. No raw Docker inspect Env is persisted.

A metadataProof has exactly `{migrations,schemaSha256}`. `migrations` is an ascending-created_at array of objects `{id,hash,createdAt}`: positive unique integer id,64hex hash, decimal-integer string createdAt. Verify strictly increasing timestamps and positive monotonic IDs plus complete expected journal tuple set. `schemaSha256` hashes the canonical schema projection specified below.

Phase filename is `%04d-PHASE.json`, starting `0001-captured.json`, with no gaps/duplicates, maximum9999. Exact keys `{schemaVersion,operationId,sequence,previousSha256,phase,at,payload}`. First previousSha256 is genesis hash; each later previousSha256 is previous phase file hash. Validate filename sequence/phase agree with contents and allowed transition. Exact payloads:

- captured: `{}`.
- building: `{}`.
- built: `{imageId,sourceManifestSha256,buildResultSha256,migrationBundleSha256}`; build result in fixed `build-result.json`, log `build.log`. Private guarded build body accepts explicit artifact paths for update mode; legacy names/defaults remain unchanged.
- prepared: `{candidateOverrideSha256,composeDeltaSha256}`; image ID must equal built payload.
- activating: `{preflightSnapshotSha256,metadataProof,qaSha256}`; fixed `pre-activation.json` stores the safe snapshot, written/fsynced before this intent record.
- activated: `{appImageId,appContainerId,metadataProof,postSnapshotSha256,externalChecksPassed}`; exact candidate image,64hex container ID, externalChecksPassed must be true. Safe post snapshot is `post-activation.json`.
- rolling_back: `{observedImageId,noOp}`; observed image must be candidate or r9, noOp true only for r9. A second rolling_back record is allowed only for the explicitly defined verified-candidate rollback retry.
- rolled_back: `{appImageId,appContainerId,metadataProof,externalChecksPassed,externalDrift,noOp}`; exact r9 image, boolean flags, externalDrift array drawn only from `other-container-drift`, `unrelated-route-drift`, `public-route-failed`. Failed local app/owned-network/config checks cannot produce rolled_back. Record externalChecksPassed=false when any externalDrift remains; never claim clean overall success.

Allowed non-phase files only: `operation.json`, `baseline.json`, `qa.json`, `build.log`, `build-result.json`, `candidate.override.yml`, `rollback.override.yml`, `pre-activation.json`, `post-activation.json`. QA copy bytes equal the manifest-bound acceptance artifact. No partially written final-name file is accepted; exclusive write+fsync ordering is tested. Additional snapshots can be retained in memory or in phase payloads only; do not invent files or write arbitrary exception text. `status` returns an in-memory sanitized summary, not a repair file.

### Exact metadata projection

Inside the owned app, use installed `postgres` client resolved by the existing application. Validate its availability before apply. In one `BEGIN READ ONLY` transaction execute the fixed migration query `SELECT id, hash, created_at::text AS created_at FROM drizzle.__drizzle_migrations ORDER BY created_at, id` and the seven queries below. No parameters are derived from user input. Missing schema/table/module or failed query refuses. No table content other than the migration journal is read. Map migration created_at into normalized base10 integer string and id into an integer.

The schema projection is an object with keys `relations`, `columns`, `constraints`, `indexes`, `enums`, `sequences`, `views`; each value is the result rows from the corresponding query below in their returned order. Values preserve catalog strings exactly; no whitespace rewriting of definitions. Null remains null, PostgreSQL boolean stays boolean, numeric catalog values become JSON integers. Canonicalize with the JSON encoding above before hashing. This is the stated catalog projection, not a checksum of all database contents or every PostgreSQL object.

```sql
-- relations
SELECT n.nspname AS schema_name,c.relname,c.relkind
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f','S')
ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",c.relkind;
-- columns
SELECT n.nspname AS schema_name,c.relname,a.attnum,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod) AS type_name,a.attnotnull,a.attidentity,a.attgenerated,pg_catalog.pg_get_expr(d.adbin,d.adrelid,false) AS default_expr
FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped
ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",a.attnum;
-- constraints
SELECT n.nspname AS schema_name,c.relname,k.conname,k.contype,k.condeferrable,k.condeferred,k.convalidated,pg_catalog.pg_get_constraintdef(k.oid,false) AS definition
FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",k.conname COLLATE "C";
-- indexes
SELECT n.nspname AS schema_name,c.relname,i.relname AS index_name,x.indisvalid,x.indisready,pg_catalog.pg_get_indexdef(i.oid,0,false) AS definition
FROM pg_catalog.pg_index x JOIN pg_catalog.pg_class c ON c.oid=x.indrelid JOIN pg_catalog.pg_class i ON i.oid=x.indexrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C",i.relname COLLATE "C";
-- enums
SELECT n.nspname AS schema_name,t.typname,e.enumsortorder::text AS enum_order,e.enumlabel
FROM pg_catalog.pg_enum e JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
ORDER BY n.nspname COLLATE "C",t.typname COLLATE "C",e.enumsortorder;
-- sequences (configuration only, never last_value)
SELECT n.nspname AS schema_name,c.relname,s.seqstart::text,s.seqincrement::text,s.seqmax::text,s.seqmin::text,s.seqcache::text,s.seqcycle
FROM pg_catalog.pg_sequence s JOIN pg_catalog.pg_class c ON c.oid=s.seqrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema'
ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C";
-- views
SELECT n.nspname AS schema_name,c.relname,pg_catalog.pg_get_viewdef(c.oid,false) AS definition
FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname !~ '^pg_' AND n.nspname<>'information_schema' AND c.relkind IN ('v','m')
ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C";
```

Text-cast sequence/enum values remain strings as selected, avoiding driver bigint/float variation. Tests use deterministic synthetic catalog rows, verify order/type/hash stability and drift in each projection. Separately test the SQL against a disposable synthetic database; never test writes against production.

### Health convergence

Both mutation commands append `--wait --wait-timeout 180` to `up -d --no-deps --no-build` before final service argument `app`. The Python subprocess timeout is210seconds. A timeout/nonzero exit leaves the intent phase intact and requires status/explicit rollback; it never appends activated. After Compose reports success, independently inspect exact app image ID, expected config and Docker health status `healthy`, then validate metadata and external invariants. Rollback uses the same wait flags/bound. A no-op rollback separately polls only the fixed r9 app health every2seconds for at most180seconds, refuses unknown/replaced identity immediately, and records success only after exact r9 health is observed. No unrelated service is waited on or restarted.
