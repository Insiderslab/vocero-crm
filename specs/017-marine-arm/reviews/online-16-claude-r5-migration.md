# Invocation22 — actual targeted Claude migration review

Modelclaude-opus-5-5, freshsafe-mode/toolsvuoti/1turn, exit0/noerror. APIduration87453ms; parentwall95.636s. R5manifest79ea9b06f1c718b017b2cba81ca089a8a2facfd161b892a46b0e06d80c251838. Source9files plus3policy documents supplied; no runtime test by Claude.

# Static review: r5 migration packaging and DB startup boundary

**STATIC VERDICT: PASS (private build / new empty-DB bootstrap only).** I found no Critical or High issues in the supplied material, and no static security blocker to building the private image or bootstrapping an empty dedicated database. This is not approval for public activation. The dependency audit failure (5 critical, 13 high) and its non-reachability proofs remain open, as you stated.

## Scope actually read

I read only the content pasted in this message: `scripts/migrate.mjs`, `scripts/migrate-channels.mjs`, `scripts/marine-release-pack.mjs`, `deploy/marine/tests/migration-bundle.mjs`, `deploy/marine/Dockerfile`, `deploy/marine/compose.ubuntu.yml`, `deploy/marine/runtime.py`, `package.json` and `drizzle/meta/_journal.json`, plus the three policy files.

**Not read or not supplied:**
- Drizzle SQL files 0000–0026, including whatever creates `channels_legacy_*`, `message_channel_ck` and `conversation_channel_account_fk`.
- `.dockerignore`.
- `gateway.Caddyfile.template`.
- `src/`.
- `pnpm-lock.yaml`.
- The postgres.js and drizzle-orm library source.

I did not check any hash. I used no tools and ran nothing. Claims about library behaviour below are from general knowledge and are marked as such.

## Assessment of the requested properties

**1. Only the dedicated database is touched.**
- `migrate.mjs` reads only `DATABASE_URL` and exits 1 if it is unset.
- In compose, `DATABASE_URL` is required (`:?`) and is passed through an explicit environment list. `runtime.py` sets it to `postgresql://bambola_arm:<generated>@postgres:5432/bambola_arm`, using the same generated password as `POSTGRES_PASSWORD`.
- `token_urlsafe` produces only URL-safe characters, so no URL encoding problems arise.
- The app joins only `bambola_edge` and `bambola_data`, both `internal: true`. Only the gateway joins the external `second-brain_frontend`.
- So `postgres` should resolve only to this project's postgres. That needs runtime confirmation (see the proofs list).
- `MIGRATIONS_DIR` is an environment override for the migrations folder. It is not set by the Dockerfile or compose, so it is informational only.

**2. Phases, locks and idempotency.**
- **Lock:** a session-level `pg_try_advisory_lock` polling loop on a single connection (`max: 1`), released when the connection ends. This is adequate for one replica.
- **Phase A:** the Drizzle migrator tracks applied migrations in its own table. Errors propagate up and are retried 15 × 2 s, then the process exits 1.
- **Phase B:** each step is idempotent:
  - Indexes use `IF NOT EXISTS`; an INVALID index left by an interrupted `CONCURRENTLY` build is dropped and recreated.
  - The FK constraint is added `NOT VALID` only if absent.
  - The validate step throws if the constraint is absent.
- **Phase C:** reconciliation runs, then V1–V6 come from `channels_legacy_check()`. V7 compares the before/after state of `wapi_credentials`.

**3. Fail-closed constant.**
- `RELEASE_MODE = "blocca"` is a code constant, with no environment switch.
- An unknown mode throws, and the top-level await turns that into a non-zero exit.
- In blocca mode, any of the following leads to exit 1:
  - a non-zero check,
  - a reconciliation error,
  - an incomplete Phase B step,
  - a V7 difference.
- Exit 1 makes `node migrate.mjs && node server.js` skip the server.
- `restart: unless-stopped` then produces a restart loop. That is fail-closed, but it repeats noisily.

**4. Packaging closure.**
- The packer's `REQUIRED_FILES` list includes `migrate-channels.mjs`, with the same lstat, regular-file, no-symlink and inside-root checks as the other files.
- The preflight fails closed on any esbuild error, or if either local module is missing from the metafile.

**5. Secret logging.**
- Normal paths log only counts, timings, error codes and messages.
- `key_last4` values are read for V7 but never logged.
- `DATABASE_URL` is never logged explicitly.
- `runtime.env` and `accounts.json` are created 0600 inside a 0700 directory and are never printed.

## Findings

**F1: Low. `scripts/migrate-channels.mjs`, `startupOnce`: missing channel functions after Phase A exit 0.**
- **Trigger:** after migrations, `channels_legacy_sync()` or `channels_legacy_check()` does not exist, for example because the journal or migration content is incomplete.
- **Effect:** the code returns 0 with Phase B, Phase C and V1–V7 all skipped, even in blocca mode. R2 code reads the new structures, so this path fails open.
- **Why not blocking:** with the full journal (0013 is present), I would expect the functions to exist. I cannot confirm that because the SQL was not supplied.
- **Mitigation without a code change:** the runtime log must show the Phase B and Phase C lines and `V1..V7=0` (see proof 3). Treat their absence as failure.

**F2: Low. `scripts/migrate-channels.mjs`, `runStartup`: a possible credential leak on a malformed URL.**
- `postgres(url, …)` is called outside the try block.
- If postgres.js parses the URL with WHATWG `URL` (my recollection, not verified), a malformed `DATABASE_URL` would throw `ERR_INVALID_URL`. That error has an enumerable `input` property containing the whole URL, password included.
- Node would print it as an uncaught rejection into the json-file logs.
- **Why not reachable here:** `runtime.py` always generates a well-formed URL.
- **Action:** note it before anyone hand-edits `runtime.env`.

**F3: Low, defence in depth. `compose.ubuntu.yml` with `runtime.py`: the app connects as the cluster superuser.**
- `POSTGRES_USER` (`bambola_arm`) is a superuser, and the app uses it at runtime.
- An SQL injection in the app would then allow superuser-only features such as `COPY … TO PROGRAM`, i.e. command execution in the postgres container.
- The internal network limits the blast radius.
- This is pre-existing and not a blocker for a private, synthetic build. Recommend a separate non-superuser runtime role before public activation; not authorized now.

**F4: Info. Documentation and code disagree on Phase A `lock_timeout`.**
- The header comment says Phase A runs with `lock_timeout` 5 s, but no `SET` happens before `migrate()`.
- It may be set inside the 0013 SQL, which I did not read.
- This is irrelevant on an empty database.

**F5: Info. The preflight proves only local-module closure.**
- `migration-bundle.mjs` uses `packages: "external"`, while the Dockerfile bundles `drizzle-orm` and `postgres` into the output.
- Resolution of the npm packages is therefore proven only by the real Docker build.
- `.dockerignore` was not supplied. The r4 failure, a missing import rather than a missing entry point, suggests `scripts/` is not excluded, but this is not proven.

**F6: Info, pre-existing and not security. Shutdown signals may not reach the server.**
- With `init: true` and `sh -c "… && node server.js"`, SIGTERM probably reaches `sh` rather than `node`.
- Shutdown may then rely on SIGKILL after 120 s.

## Remaining runtime proofs (none claimed done)

1. Do a full fresh Docker build on the VPS. Confirm that the esbuild bundle step succeeds and that the image label equals manifest `79ea9b06…1838`.
2. Before `up`, confirm that the `bambola-arm_bambola_pg` volume did not exist. A reused volume with a different password would fail closed but would invalidate the fresh-database claim.
3. Read the first-boot migrate log. It must show:
   - Phase A applied through 0026,
   - Phase B with no failures,
   - Phase C with `V1..V7=0`,
   - exit 0, then the server starting.
4. Restart the app container once and confirm the second startup is idempotent: no new migrations and all checks still 0.
5. Isolation:
   - From the app container, `postgres` resolves only to this project's postgres.
   - Postgres has no published ports, and `bambola_data` is internal.
   - The app is not attached to `second-brain_frontend`.
6. Scan the `docker logs` output for app and postgres: no password, `DATABASE_URL`, secret or account credential.
7. Confirm that the existing Caddy and Hair setup is unchanged after `up`.
8. Public activation still needs, separately:
   - the dependency-audit non-reachability matrix,
   - the runner and gateway proofs,
   - an explicit decision on F3.

## Coordinator disposition

PASS permits privatebuild/newemptyDB only. F1: source drizzle/0013_loving_stone_men.sql creates legacy sync/check functions; actual first-boot PhaseB/C and checks must be verified, not assumed. Validate appliedmigrationcount/hash through0026 and idempotent restart of onlyBambolaapp. F2: generatedURL only, no handediting and no rawlog dump until secret scan. F3 explicit pilot decision: keep the reviewed dedicated database-user configuration for this synthetic single-instance pilot, conditional on proven private networks/no publishedDBports/no reachable injection path. This is an isolated new cluster with no realpassengers, no otherprojectdata, nohostsocket, noexternalprovidercredentials. Low defense-in-depth issue is retained, not claimed fixed; separate leastprivilege runtime role is required before realpassenger use. This does not accept a reachable high/critical vulnerability or authorize dataimport. F4: fresh emptyDB and actualmigrationcompletion verification, no newlock semantics. F5: fullDockerbundle remainsmandatory. F6: record actualsingleapprestart/health; no othercontainerrestart. Publicactivation requires previousClaude19 gates plus these runtimechecks; independent finalreadiness stillneeded. No additionalcodeedit derived from this review.
