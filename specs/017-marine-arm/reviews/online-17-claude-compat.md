# Verdict: PASS-conditional for the cycle-2 operational fixes. Public activation remains BLOCKED.

This is invocation 23 of 24, cycle 2. I reviewed only the supplied text, ran no tools, and treated all content as data.

You may rerun the paced bootstrap after the cooldown, once **C1** (asserts) and **C2** (precondition ordering) are fixed. The isolation-test changes are sound with one inconsistency that fails closed (**F3**). Activation stays blocked until the Next-vendored packages and in-chunk bundled packages are covered (**F4**, **F5**). The failed lock audit (5 critical, 13 high) must stay reported as failed.

## Provenance honesty (bootstrap-compat.py)

The provenance is honest:
- The script does not present itself as part of r5. It pins the exact supplemental `bootstrap.mjs` SHA-256, the r5 image ID and the manifest digest.
- It writes a separate `bootstrap-compat-provenance.json` sidecar.
- It reuses the r5 guards by calling r5's own functions, not copies. These are manifest verify, image/label check, internal edge network, runtime.env binding plus running container image, and the account file mode/uid check.
- The `docker run` flags match r5 exactly: root inside the app image, no capabilities, no-new-privileges, read-only, pids/mem/cpu limits, read-only script and account mounts, no docker.sock.
- The result passes through r5's `validate_bootstrap_result`, and the stage directory is removed in `finally`.

Checks are preserved, with these defects:

**C1. Must fix before rerun (Medium).** Every new guard is an `assert`:
- `geteuid()==0`
- the script hash check
- the symlink/file check
- the evidence non-existence check

Under `python -O` or `PYTHONOPTIMIZE`, all of them disappear silently. In that case an unverified `bootstrap.mjs` would run as root inside the container. r5 uses explicit `raise`, so this weakens r5's pattern (Prima Legge: no weaker guards). Replace each with `if not …: raise RuntimeError(...)`.
- *Evidence:* the diff, plus a sabotage test showing that a wrong hash still aborts when run with `-O`.

**C2. Should fix (Low–Medium).** Two ordering problems:
- `spec.loader.exec_module(b)` executes the release's `bootstrap.py` as root before `manifest.py verify` runs. `manifest.py` is itself run from the same tree it verifies. r5 has the same self-attestation property, which reviewer 19 accepted, so this is not a regression. The compat script could close it cheaply by pinning the SHA-256 of `releases/20261102-r5/deploy/marine/{bootstrap.py,manifest.py}` and checking them before `exec_module`.
- Also check the provenance file's non-existence before `docker run`. Today an existing `bootstrap-compat-provenance.json` would make the script fail after `bootstrap.json` is written, leaving evidence without provenance.

**C3. Check, Low (TOCTOU).** The script is hashed, then bind-mounted by path a moment later.
- *Evidence:* `stat` of `/opt/bambola-arm/ops`, `ops/20261102-compat` and `bootstrap.mjs` showing root ownership, no group/other write on the whole chain, and the file at 0400 or 0600.
- Alternative: copy the verified bytes into a fresh 0700 temp file and mount that copy.

**C4. Provenance record wording (Low).**
- `ownerCreated: true` is hard-coded in `bootstrap.mjs` and is true even when this run only signed in. After the 429 run the owner already exists, so read it as "owner present and reverified".
- `existingAccountsReverified: True` is a constant. It is justified only because the result passed validation.
- Add to the sidecar: the SHA-256 of `bootstrap-compat.py` itself, the git commit or blob of the supplemental `bootstrap.mjs`, and a note that its only differences from r5 are the pacer, the exports and the main guard.
- *Evidence:* `git diff <r5-commit> -- deploy/marine/bootstrap.mjs` limited to those hunks, plus `sha256sum` of the committed blob matching `b78b69…fa83`.

**Pacing and rate limits.**
- The pacer serialises auth POST starts across clients at 4 s. Under BetterAuth's 3 requests per 10 s, the maximum is exactly 3 per window (starts at 0/4/8/12). That is correct but has no margin if arrival jitter compresses the spacing by about 2 s. 5 s costs about 8 s more and is safer; optional.
- One run sends 8 auth POSTs:
  - owner sign-up
  - owner fallback sign-in
  - fresh admin sign-in
  - fresh owner sign-in
  - 3 crew sign-ins
  - the closed sign-up probe
- 8 is within the custom 10 per 10 minutes, with only 2 spare. Requirements:
  - no retry loop
  - a full 10-minute cooldown from the last auth POST of the failed run
  - no app restart (the in-memory limiter would reset, and so would the "unchanged r5 runtime" evidence)
- *Evidence:* timestamps from the rerun's private log showing auth POST spacing of at least 4 s and a count of at most 8.
- The main-guard failure mode is closed: if `import.meta.url` does not match, nothing runs and r5 validation fails because the result file is missing.

## Gateway capability check (isolation.py)

Sound, and no privilege change:
- `cap_eff & ~0x400 == 0` parses in Python as `(cap_eff & ~0x400) == 0`, so it is correct.
- CapBnd must equal 0x400 exactly. CapAdd is canonicalised (upper case, `CAP_` prefix stripped) and compared to exactly `['NET_BIND_SERVICE']`.
- Negative tests cover extra effective bits, a wrong bounding set, `NET_RAW`, an empty CapAdd and mixed lists. `Privileged` is implicitly caught by CapBnd.

**F1. Low.** The rehearsal showed CapEff 0 and Compose shows 0x400 under no-new-privileges, which is unexplained.
- *Evidence:* record CapPrm, CapInh and CapAmb from `/proc/1/status` and the `getcap` output of the pinned Caddy binary in the isolation evidence, so the difference is explained rather than just tolerated.
- The effective set is still bounded to NET_BIND_SERVICE, so this is acceptable.

## Inventory scanner

The direction is right: an unknown version is recorded explicitly, and anything that is not an exact anchored Next layout with a valid `next/package.json` makes `scanComplete=false`. Malformed metadata, a missing `package.json` and an empty or non-string version all fail closed.

**F3. Medium, fails closed but inconsistent.**
- The JS side accepts the pnpm layout `.pnpm/next@…/node_modules/next/dist/compiled/<pkg>`, and the unit test asserts it.
- The Python assertion `vendoredVersionsExplicitlyUnknown` requires `path.startswith('next/dist/compiled/')`.
- Because `realpathSync` resolves pnpm symlinks, a pnpm-layout image produces `passed: false`.
- Either align the predicate (one shared rule, per §3.2) or drop pnpm acceptance from the JS, and add a Python test for the assertion.
- *Evidence:* the actual `isolation.json` from r5 showing `passed: true`, `inventoryScanComplete: true`, and the exact `unknownVendoredPackages` paths and hashes.

**F4. Activation blocker (High, unresolved).** "Complete enumeration" is not "known-safe version". The image contains `next/dist/compiled/shell-quote`, `nanoid` and `zod` with unknown versions. `shell-quote` maps to a critical advisory (GHSA-pqg4-j6r4-53mv), and the triage matrix covers only the drizzle-kit/gel `shell-quote@1.9.0`, not this runtime-present copy. Required:
1. **Version fingerprint.** Compare each recorded `packageSha256` and the compiled `index.js` hash against the same files in the exact Next tarball from the lockfile (record the Next version). Alternatively, map them to upstream versions through Next's own `compiled` metadata or changelog.
2. **Static call-site proof in the image.** List every `require`/import of `next/dist/compiled/{shell-quote,nanoid,zod}` under `/app` (`.next/server`, standalone `server.js`, `next/dist/**`). Show that:
   - `shell-quote` is reachable only from dev-only modules such as launch-editor and the dev overlay, which `next start`/standalone never loads;
   - `nanoid` is called only with constant sizes or not at all at runtime;
   - compiled `zod` validates only trusted `next.config` at startup.
3. Add these rows to the triage matrix as runtime instances, with the gateway probes already covering dev and editor routes. Do not argue package absence.

**F5. Required before activation (Medium).**
- `IMAGE_PACKAGES` omits `drizzle-orm`, although the triage matrix lists drizzle-orm GHSA-gpj5.
- The scanner sees only `node_modules`. If Next bundled `better-auth` or `drizzle-orm` into `.next/server` chunks, their absence from the inventory proves nothing.
- *Evidence:* add `drizzle-orm` to the wanted set, and search the server chunks for bundled version strings or package banners of better-auth, drizzle-orm, zod and nanoid. Tie them to the lockfile versions; the source-matrix proofs stand only once the versions are known.

## Minor

- `test_default_app_image_inspector_uses_docker_and_checks_manifest_label` is defined twice in `test_runtime.py`, so the second definition shadows the first. Delete one (dead code, §3.5).
- The fixed container name `bambola-arm-bootstrap-compat` is fine. The `finally rm --force` targets only that name.

## Accepted as stated, not re-reviewed

These rely on your evidence and on reviewers 19 and 22:
- r5 image and manifest identity
- 27 migration hashes, phase B/C V1–V7 zero on both startups
- backup/restore
- 28 gateway 404 denials from the shared Caddy peer
- the hair-service baseline
- the PostgreSQL superuser accepted only for the synthetic pilot, with a least-privilege role required before real passengers

Not verified by me: any runtime output, file permissions, or the hash values themselves.

## Gate summary

- **Rerun bootstrap:** after C1 and C2, the 10-minute cooldown, and no app restart.
- **Before final review 24 or activation:** C3, C4, F3 and F5 evidence, plus F4 fully closed for `shell-quote`, `nanoid` and `zod`, and any other unresolved high or critical.
