VERDICT: **BLOCKED for activation-readiness. PASS-conditional for private build only** (`build_crm.py` with `crm_host.py check` against a fresh snapshot). The application overlay and gateway template show no material data-exposure defect. The rollout operator has four defects, and each one prevents a safe activation or rollback. Fix them in the open correction work unit before the final Sol review.

## Blockers (activation)

**B-R1 — The own-domain route is treated as an "external" invariant, so activation and rollback both deadlock.**
- `crm_host.py` `ROUTES` includes `DOMAIN + '/'`.
- `crm_rollout.py` `verify_external_unchanged()` requires every baseline route to remain within its accepted set.
- The metadata smoke shows the current root is `302 → https://bambola.heili.cloud/nautica`. The new template sets `redir @root_get /dashboard 302`.
- Result: `activate()` → `verify_services()` → `verify_external_unchanged()` always refuses after `compose up`. The phase is left at `activating` while the new containers are running.
- `rollback()` then runs `verify_external_unchanged()` as its first check, sees the same route change, and refuses. You end up with an unverified new deployment and no automated rollback.
- Fix:
  - Exclude `DOMAIN` from the external route comparison in rollout only. Keep it in the pre-activation build check.
  - Assert the own route separately: new state is 302 to `/dashboard` with TLS verified; rollback state is the baseline value (`/nautica`).

**B-R2 — There is no health wait after `compose up -d`.**
- `activate()` and `rollback()` call `docker compose … up -d --no-deps app gateway`, then immediately call `current_snapshot_fields()` and `verify_services()`.
- `verify_services()` requires `health == 'healthy'`. The app has `start_period: 40s` and a 15s interval, so the health state will typically still be `starting`.
- Result: verification fails deterministically.
- Fix: either use `up -d --wait --wait-timeout <bounded>`, or poll only the two own containers until healthy within a bound. Re-run the external-unchanged check on each iteration and fail closed on timeout.

**B-R3 — Rollback is non-functional.**
1. In `rollback()`, the `rollback_bytes` gateway line is `- "{oldGateway}:/etc/caddy/Caddyfile:ro\n`. The closing double quote is missing, so the YAML is invalid and `render_compose` refuses.
2. `private_file(rollback_path)` runs before validation and refuses to overwrite. After any failure, retrying is impossible without manual deletion.
3. The override pins `image: previousApp.imageId`. However, `verify_services(rollback=True)` expects `configuredImage == previousApp.configuredImage`. If r5 was started with a tag in `BAMBOLA_APP_IMAGE`, rollback verification always fails.
4. `APP_WORKSPACE: ""` is inconsistent between two modules:
   - `getWorkspaceProfile()` maps `""` to `standard`.
   - `env.ts` `workspaceProfileSchema.default("standard")` rejects `""`, because the default applies only to `undefined`.
   - Any future image with the new schema would fail `getEnv()` on rollback.
- Fix (simplest and safest): roll back by running `up --no-deps app gateway` with only base + panel (the exact pinned prior config, already validated in `prepare()` as matching the running services), with no rollback file. Then verify `configuredImage`/`imageId`, the old mount, and an absent profile.
- If an override must stay, fix the quoting, use `configuredImage`, and omit `APP_WORKSPACE` rather than setting it to `""`. Accept an existing rollback file only if its hash is identical.

**B-R4 — The test gate is missing for the rollout control flow.**
`test_crm_rollout.py` unit-tests helpers but never exercises `activate()` or `rollback()` end to end with mocked Docker. All of B-R1 to B-R3 would have been caught by such tests. The following are
required before activation (synthetic, no host access):
- Parse the rendered rollback YAML, or `compose config` against fixture files.
- `activate()` happy path where health goes `starting → healthy`, the own route changes `/nautica → /dashboard`, and externals are unchanged. Expect PASS.
- The same scenario with a Hair or shared Caddy change mid-poll. Expect refusal with no rollback of externals.
- `rollback()` from the `activating` phase while the own route is changed. Expect a restore of the prior app image, the prior gateway mount, and an absent or default profile.
- Rollback retry after a first failure. It must not be permanently locked out.
- Configured-image tag vs ID: the r5 value must survive rollback verification.

## Non-blocking findings (fix or record)

- **N1 — Prepare dead-end.** `prepare()` writes `PLAN` in phase `plan` before compose validation. If validation fails, the plan and its artifacts persist and every re-prepare refuses. Write the plan only after validation, or document cleanup of own evidence/runtime artifacts only.
- **N2 — Docker alias semantics.** `verify_services()` compares per-network `Aliases`. On Docker engines before API 1.45, aliases include the short container ID, which changes on recreate. Record the engine version, or compare only the declared aliases (`bambola-arm-private-app`, `bambola-arm-gateway`).
- **N3 — External health flapping aborts both activation and rollback.** This is correct fail-closed behaviour. The operator runbook must still define a manual, own-services-only recovery (`up --no-deps app gateway` with base + panel) for when externals drift mid-deploy. That recovery must never touch shared Caddy or Hair.
- **N4 — Profile parser inconsistency** (see B-R3.4). Make `profile.ts` and `env.ts` agree. Recommended: `""` is treated as unset in both places, or rejected in both.
- **N5 — X-Forwarded-For passthrough.** `header_up X-Forwarded-For {http.request.header.X-Forwarded-For}` forwards the chain from shared Caddy. Confirm that the app's `MARINE_TRUST_PROXY_IP` and auth rate limiting use the shared-Caddy-appended (rightmost) hop, not the client-supplied leftmost one. The dependency triage already requires a public concurrent-login/IP-spoof proof; keep that as a gate.
- **N6 — Trivial dead condition.** `marine-app.tsx` `disabled={busy || !team}`: `team` is always an array, so `!team` is never true. It is harmless.
- **N7 — Owner account creation is exposed.** `/api/settings/team` POST is reachable online (owner-only via its existing guard). Confirm it sends no invite or email. App egress is internal, but record this rather than infer it.

## Accepted (no repeat)

- **API guard:** `withAuth` enforces `canAccessCrm` after membership resolution and before the handler. The stricter wrappers are layered on top.
- **SSE:** the events route denies before `subscribe`.
- **Media and my-orgs:** both are wrapped.
- **Branding:** GET is public but scoped to the session organization or the default.
- **Assignments:**
  - The `addService` membership check runs inside the transaction with `FOR KEY SHARE`, is org-scoped, and returns 422.
  - Validation rejects a nonempty legacy `assignedTo`.
  - The crew projection carries no money fields.
  - The roster contains only id and name.
- **Login:** the register link is hidden in the marine profile, and sign-up is not routed at the gateway.
- **Gateway:**
  - Default 404.
  - Provider 503 handlers come before the CRM allowlists.
  - `/api/templates` POST is also absent from `crm_post`.
  - No `/api/*` or `/api/auth/*` wildcards.
  - Peer IP trust is enforced before any non-health handler.
  - 32 KB body cap.
- **Automation and webhook watch:** both short-circuit without credentials.
- **Build guard:** `build_crm.py` and `crm_host.py check` are snapshot-bound, keep the env file hash-only, use exclusive writes, and abort on drift during the build.

## Practical test conditions before handoff (public, synthetic only)

1. **Fresh baseline:** run `crm_host.py baseline` after this review on a corrected release manifest. The manifest hash will change because of the B-R fixes. Never reuse old `state.json`.
2. **Activation:** expect `APP_WORKSPACE=marine` in the running app and the new image ID plus manifest label. The gateway mount hash must equal the plan, and the CAS phase must end at `activated`. Non-Bambola containers, networks, routes and shared Caddy inode/hash must be unchanged.
3. **Public HTTPS:**
   - TLS verified on `/`, with a 302 to `/dashboard`.
   - Owner, admin and member logins.
   - The member gets 403 on the full 58-method matrix through the public edge.
   - The member is redirected for each CRM page.
   - A forged `RSC: 1` / `Next-Router-State-Tree` request for each private page as a member returns no synthetic org-data markers.
4. **Provider denials:** each denied provider POST/PUT/DELETE returns `pilot_provider_disabled` with 503 for an owner. App logs show no handler invocation for those requests.
5. **Negative edge probes:** each of the following returns 404:
   - Sign-up, magic-link, social, device, OAuth-proxy and callback routes.
   - `/_next/image`, dev, HMR and launch-editor paths.
   - Encoded-slash and dot-segment variants of the allowlisted regexes.
   - HEAD on API paths.
6. **Body limits:** bodies over 32 KiB (declared and chunked) return 413, and the health check is stable afterwards. A marine body over 16 KiB returns 413.
7. **Cross-tenant:** a cross-tenant contact or trip lookup returns 404 or null.
8. **Rollback drill:** run one rollback on the corrected operator before handing off to staff, verify it, then re-activate. Alternatively, explicitly record that it was not run.

## Unverified limits (state in the handoff)

- **Device and offline:** physical Android camera and installability, offline reconciliation UI, keyboard-only navigation, 200% zoom, and human usability.
- **Dependency audit:** still FAILED (5 critical, 13 high). Only the static and runtime reachability triage exists, with no waiver.
- **Runtime proofs:** the RSC module-reference exposure is accepted only on the data-absence criterion. The XFF and rate-limit behaviour is unproven.
- **Database:** the pilot runs as the DB superuser. This is acceptable for synthetic data only; a least-privilege migration is required before any real passenger data.
- **Scope of this review:** I did not run code, inspect the host, or verify image contents. I give no production approval and no runtime-verified claim. The final independent Sol review remains required.