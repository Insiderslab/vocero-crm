# Claude security review

Call15 incomplete output,133.65s; not accepted. Fresh rerun call16,86.20s, complete streamed text below. Total review budget1629.85/1800seconds,16/20calls. Local progression conditional only; no deployment approval.

VERDICT: **PASS-conditional for local code progression only.** Deployment and live activation remain **BLOCKED**: there is no fresh-baseline operator, the shared Caddy/Hair baseline is unverified, and the dependency audit still fails. No finding below blocks local progression. Findings B1–B4 block staff handoff or activation until fixed and proven.

## Blocking before handoff/activation

**B1. CRM page guard sits only in the layout.** The check is in `src/app/(app)/layout.tsx`. Next.js layouts are not guaranteed to re-render on RSC/soft navigation. A marine `member` could send `RSC: 1` (or `?_rsc=`) to an allowlisted page path. Caddy's `path` matcher ignores the query, so the request reaches the app and may receive page-segment output without the layout check. Pages that read data server-side are exposed this way: `/inbox` (`isListeningMode`), the settings pages and `/dashboard`.
- **Fix:** enforce `canAccessCrm` in middleware, or in a shared `requireCrmPage()` called by every `(app)` page.
- **Test:** a member sending a GET with `RSC: 1` and a router-state header to each of the 18 CRM page paths gets a redirect or 403 and no org data.

**B2. Some CRM API routes may bypass the guard.** The marine CRM guard lives only in `withAuth`, plus a hand-coded check in `/api/events`. Any allowlisted route that calls `requireSession` directly bypasses it. Suspects are `/api/my-orgs`, `/api/media/[id]` and `/api/settings/branding` GET.
- **Required:** a static guardrail test that every route file in the Caddy CRM inventory uses `withAuth`, `withAdminAuth` or `withOwnerAuth`, or calls `canAccessCrm` before any DB read.
- **Plus:** a runtime test that a marine member gets 403 on every allowlisted CRM GET, PUT, PATCH, DELETE and POST.

**B3. Missing profile setting fails open.** `getWorkspaceProfile()` defaults to `standard` when `APP_WORKSPACE` is unset or empty. In that case a marine deployment silently gives members full CRM access.
- **Required:** the deploy verifier asserts `APP_WORKSPACE=marine` in the running app env.
- **Required:** a startup or health assertion fails the marine artifact if the profile is not `marine`.

**B4. Background provider paths are not gated by the gateway.** `POST /api/automations` and `PATCH /api/automations/[id]` are proxied. `startAutomationScheduler` and `startWebhookRouteGuard` always run. An owner can create or enable an automation, and the scheduler will then attempt sends, possibly writing failed message or contact state.
- **Fix:** disable the scheduler and the webhook route guard when the profile is `marine`, or deny automation create/enable at the gateway.
- **Test:** with no secrets and no egress, an enabled synthetic automation makes no egress attempt and leaves no DB side effects.

## Non-blocking findings / conditions

- **C1. Diff/file mismatch.** In the EXACTDIFF, `start-conversation` sits in `@crm_post` and is proxied. In the FILE, it sits in `@provider_post` and returns 503. Only the FILE version is acceptable. Regenerate the frozen diff and hash so the reviewed artifact equals the built one. Then prove that owner `POST /api/contacts/x/start-conversation` returns 503 and never reaches the app.
- **C2. Assignment logic is sound.** The membership check is org-scoped, role-restricted and uses `FOR KEY SHARE` inside the advisory-locked transaction. Legacy `assignedTo` never authorizes. Replay keeps the stored hash.
  - **Required:** `assertPayloadBounds` must accept the new `assignedMemberId` key on services, including old payloads that lack it.
  - **Required tests:**
    - a cross-org membership id returns 422;
    - a deleted membership returns 422;
    - assignment on a terminal trip returns 409;
    - concurrent delete vs. assign serializes correctly.
- **C3. Roster exposure to crew.** `readMarine` returns membership ids and names to crew members, not names only. Either accept this explicitly or project `team` only for owner/admin. A null `u.name` becomes the string `"null"`.
- **C4. SSE.** The guard runs before `subscribe`, and cleanup is idempotent. Existing streams survive a role downgrade, which is pre-existing behavior. Check that the Caddy `header Cache-Control "no-store"` does not duplicate or break the upstream SSE headers, and that streaming survives longer than 60s through both proxies.
- **C5. Gateway.** Ordering is correct: provider 503 rules precede the CRM allowlists, and anything else returns 404. Still required:
  - negative tests for encoded `%2F` and `%2e`, trailing slash, and double slash;
  - HEAD on API paths;
  - a chunked body over 32KiB returning 413.
- **C6. Member flow.** In an E2E run, a member logs in, is redirected to `/nautica`, and sees no 403s. `NauticaSessionShell` must not call any `withAuth` route.
- **C7. Standard-profile regressions.** These are UI-only:
  - the "Clientes y ARM", "Agencias" and "Equipo" informational panels are removed for all profiles;
  - the legacy header text changed.

  Confirm both are intended. `disabled={busy || !team}` is a dead condition, since `team` is always an array.
- **C8. Assets.** `/marine/icon-192.png` and `/marine/icon-512.png` must exist in the build, or the manifest will reference 404 icons.

## Unverified (do not infer)

None of the following has been shown to me: production build, synthetic API/UI runs, Caddy runtime behavior, route-file guard coverage, `assertPayloadBounds` behavior, or `NauticaSessionShell`. The 16 + 48 passing unit tests cover only `withAuth`/SSE and assignment parsing. They do not cover page guards, gateway behavior, or tenant isolation at the DB layer.

This review does not replace the final independent diff/evidence review and does not approve deployment.