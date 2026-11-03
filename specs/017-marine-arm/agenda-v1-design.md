# Calendar usability increment — 3 November 2026

## Scope and user outcome

Stefano asks to continue the published La Bambola platform. This increment makes the existing calendar useful on a phone: Hoy, 3 días, 7 días and Mes; a clear selected date; creation from that date; direct access to existing tour operations and services. The complete CRM remains available. Crew retain their restricted view. Spanish interface, America/Caracas dates, no new dependency.

The current API returns at most 50 prioritized tours. This increment does not change that contract or claim complete availability. Keep the explicit non-exhaustive warning in every calendar view. Empty days say “Sin paseos en esta vista”. Future empty months remain navigable so administration can create a tour there; server overlap checks remain authoritative. Range-based exhaustive querying, tour rescheduling/editing, group registration links, DOB, affiliates, automated WhatsApp and booking-derived service totals remain separate increments, not delivered by this one.

## Behavior

- Calendar modes: Hoy (one day), 3 días, 7 días, Mes. Default one-day view for crew and administration; all views use the selected Caracas date. Switching modes keeps that date. Hoy selects today's Caracas date. Previous/next moves 1/3/7 days or one month, respectively. Month stepping clamps the selected day at month end; no browser-local timezone calculations.
- The short views display chronological day sections and readable tour cards rather than seven narrow columns. Show start/end local time, status, public/private, reserved/capacity and registered count from existing summaries; no fabricated service totals.
- Month remains Monday-first with selectable days and the selected day's tour list. Navigation can reach empty months. Clearly label both the range and selected date, with Spanish labels and semantic buttons/aria-pressed.
- Administration has “Nuevo tour” for the selected day (or per-day button in range view). Crew receives no create callback/button, including an owner inspecting crew view. Clicking a month day selects it; the visible selected-day action opens creation. No implicit save on clicking a date.
- Reuse the existing CreateTrip fields and existing command pipeline. Prefill selected date with 09:00–17:00 Caracas. Title, date/time, public/private and capacity remain editable. Capacity is not passenger count; label accordingly. No initial booking is created silently. Server validations for overlap, duration and cap 130 remain untouched.
- Creation form is inline in the calendar with a heading and focus on title. Closing before submission cancels only the draft. Once an operation is uncertain, prevent closing/date/mode/tour changes until the existing retry resolves it. Keep draft on known failure. On confirmed creation close the form and open the new tour's administration so the seller can add a reservation and services. No fabricated success while a request is uncertain. Ensure existing no-tour and administration forms still work.
- Keep existing tour-selection callback and detail-loading protections. Add an explicit administration shortcut from calendar cards for reservations and services if useful; crew only opens its tour. “Volver al calendario” should be clear. Do not remount the MarineApp mutation owner.
- No refresh loop or polling in this increment. Existing command success/online/manual refresh remains source of updates; do not claim cross-device live synchronization.

## Safety and acceptance

No authentication, authorization, data projection, API, database, provider, gateway or deployment helper changes. No customer data, messages, payments or external service changes. Synthetic local tests only before review. Existing published r9 is the release baseline; never package the dirty working tree wholesale. Preserve unrelated changes and Hair.

Acceptance: four usable modes; correct Caracas UTC-boundary grouping, leap-day/month-end navigation, chronological ordering; create from an empty future date through UI and persist after reload; title/dates kept on a rejected overlapping tour; uncertain POST retry uses the same existing operation and prevents navigation; crew has no create action; 320/390 px and desktop without horizontal overflow; keyboard focus and 200% zoom; existing ticket/manual-scan flows unaffected. Clearly retain 50-tour warning for empty/truncated data.

## Detailed Implementation Plan

Owned implementation paths: src/components/marine/admin-panels.tsx, src/components/marine/marine-app.tsx; optional src/components/marine/calendar-model.ts and src/components/marine/create-trip-form.tsx; tests/unit/marine/calendar.test.ts plus focused adjacent calendar tests. Documentation under specs/017-marine-arm/ only. Existing marine-arm ownership covers these paths; prior explicit shared-file coordination authorization remains valid. Checker overlaps are recorded, not suppressed.

Pure helpers can own range calculation, navigation and grouping. Existing calendar exports should stay compatible or their callers/tests be updated deliberately. Luxon already exists. UI state stays local and drafts must not reset from a successful data refresh or unrelated render. Keep hooks unconditional.

Read existing command/create form before editing. Returning Promise<boolean> from CreateTrip submit allows clearing only on confirmed success; avoid fire-and-forget. Resolve retry success at the MarineApp owner so it also closes calendar creation and opens the created trip; do not create a second request ID. Keep the original mutation error/retry mechanism. If these changes require backend contracts, stop and expand the design before implementing.

QA uses an isolated copy of the exact r9 app plus this reviewed overlay, existing lockfile/runtime and synthetic local database. Do not modify the user's 3130 preview. Record copied file hashes, build ID and process ownership. Existing local QA at 3142 can be reused only after confirming no active writer/test and ownership. Browser scenarios start from visible controls; fixtures can be seeded separately. Tests cover real creation and reload; mocked network failure is limited to the isolated browser.

Run targeted unit tests, TypeScript/lint and production build on the coherent candidate. Follow with independent post-code review and actual browser tests. No new security contract is intended; if auth/tenant/provider boundaries change, require separate security review before release. Publishing remains authorized but is contingent on candidate integrity and existing release checks. Deployment is only Bambola app/gateway; Hair and all other services invariant.

## Review protocol and budget

Fresh-context EGM design stages 5–9 in sequence; target this document, source code above and the previous AGENDA-AUTOMATICA-PLAN.md. Apply installed personas/standards. This is a bounded five-stage Heili policy review, not a claim to run every optional plugin rubric. Uninterrupted operation is covered by user authorization to execute autonomously; no new architectural decision delegated to the user. Detailed boundary is the heading above. After readiness, leave design-only workflow and implement with GPT-6 Luna; independent GPT-5.6 Sol diff review. New feature cycle budget 20 calls / 1,800 reviewer seconds, separate from completed r9 release. Record measured or conservative upper-bound elapsed time; no fictional review completion.
