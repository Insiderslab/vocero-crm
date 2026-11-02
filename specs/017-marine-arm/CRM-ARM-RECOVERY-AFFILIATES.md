# La Bambola: restore CRM focus, simplify crew work, add affiliates

Owner decisions, 2 November 2026. This is a working concept and acceptance brief, not an implemented feature or an approved release design.

## Confirmed outcome

Stefano and Rosanni need the full CRM/ARM as their main workspace: contacts, conversations, agent proposals, automations, calendar/tours, affiliates and administration. The boat workflow is a connected module. The recently published nautical panel selector did not satisfy this outcome; informational placeholders must not be presented as the integrated ARM.

Crew members need a substantially simpler screen, especially QR scanning. Tourism agencies in Venezuela must be able to apply themselves, be recorded in the CRM, receive dedicated offers/materials when eligible, and access their own sales area.

Two explicit owner answers in this chat:

- Commission is 10% of the tour amount actually collected, excluding extras such as paella and floating mattresses.
- Registration is automatic; access is activated only after approval by La Bambola.

No commission payout, live WhatsApp campaign, provider connection or import of real passenger data is authorized by this implementation brief.

## Three separate user journeys

### Administrator: CRM/ARM first

Preserve the existing CRM navigation pattern with clear entries for Clients, Conversations, Agent Heili, Automations, Calendar and tours, Affiliates, Commissions, Team/settings. Start in the CRM overview. Do not substitute explanatory cards for working feature screens. Display connection/listening/inactive states inside the actual feature, with a clear distinction between a draft and a sent message.

### Crew: one task at a time

Home shows only the selected tour, current operation and aboard count, then a large Scan ticket button and a secondary Search passenger action. Tour details, services and help are secondary. No CRM, money or administration menus.

Target scan journey: tap Scan, allow the browser camera if necessary, read the ticket, show passenger name and tour validation, tap one clearly named confirmation, show success and Scan next. Prefer the rear camera; keep manual code/name lookup available. Browser permission and device camera operation cannot be guaranteed by the mockup.

The scan itself never registers boarding. The final confirmation must name the movement. Wrong-tour, incomplete registration, already-boarded, closed-tour, unavailable network and unknown-result cases have clear text and no misleading success state. Repeated scans cannot create duplicate movements. Existing idempotency and reconciliation must remain authoritative. The operation mode for final disembarkation and stop/return needs explicit design; do not infer a departure merely because an aboard passenger was scanned.

### Affiliate: apply, wait, then access own area

Public application collects the minimum agency/contact details and WhatsApp contact. Promotional permission is a separate unchecked choice, not inferred from registration. Existing commercial contacts must not be silently duplicated or granted access based only on a submitted phone number.

Create the candidate record and linked CRM contact once, with a candidate tag. Show Pending approval. Approval is an audited action by an authorized administrator; the account/contact must also be verified before private access. An existing agency can be onboarded by an administrator after identity confirmation, without importing real records during the pilot.

Approved affiliates see only their agency's tours/offers/materials, bookings, group registration progress and commission statement. They can distribute individual registration links or enter passenger data on the passenger's behalf, with actor/source recorded. The reserved-seat limit remains enforced. Each passenger still has a separate ticket.

Tagging and access permission are different. A CRM tag never grants a session or exposes bookings. Do not reuse the crew membership role for an external agency, because it sees the salon/boat organization's operational data. Agency scope must be enforced server-side on every object read/write, export, file and registration link. Pending/rejected/suspended agencies must fail closed.

## CRM segmentation and messages

Candidate, active and suspended agency tags drive lists and reporting. They should be generated from authoritative affiliate status, not be the authority for access. Suggested segment: approved agency AND verified contact AND opted in AND not opted out/suspended.

Intended flows: application receipt, approved-affiliate welcome, sales-material delivery, approved commercial offers, and booking reminders. Drafts, approval, queue, delivery outcome and failure must be distinct. A rejected or revoked affiliate is removed from eligible promotional recipients; opt-out is checked again at send time. Use deduplication so retries do not repeat a welcome or offer. No real messages are sent by the interactive proposal.

The existing engine is periodic tag/template re-engagement, not a complete event-based affiliate onboarding or bulk campaign system. Its current code skips organizations in listening mode, missing/reconnect-required credentials and contacts in an open service window. Existing template validation supports at most the contact-name variable. These limits require deliberate integration and tests; simply assigning a tag does not implement the requested workflow. Provider requirements must be rechecked against official documentation before enabling the channel.

## Commission accounting

Confirmed example: tour collected 100 USD plus extras collected 20 USD yields commission 10 USD, not 12 USD. A booking that is not collected has no collected-tour commission. Record the currency and the tour allocation of each receipt separately from extras; never add USD and VES without an agreed conversion rule.

Design proposal for review: retain an immutable commission rate snapshot and ledger entries tied to agency, booking, receipt and eligible tour amount. Separate calculated, reviewed, payable and paid states. Make receipt processing idempotent. Refunds/corrections create traceable adjustments rather than erasing settled entries. Refund treatment, settlement timing and tax/discount allocation remain policy details to define before payout; no automatic payout is part of this task.

## Verified reuse and gaps

- Existing CRM routes: `/contacts`, `/inbox`, `/pipeline`, `/agent`, `/automations`, `/dashboard`, `/settings` in `src/app/(app)`. Existing shell/nav components can restore a familiar experience, but they are shared work surfaces.
- Contacts and tags: existing tables, tag editor, scoped tag APIs and contact filters. Reuse them for segmentation.
- Existing automation rules: `src/app/api/automations/route.ts`, `src/server/automations/engine.ts`. These are not an affiliate campaign subsystem yet.
- Nautical code already contains trip/calendar summaries, bookings, per-passenger registration links, QR tickets, movements and services. Booking `agency` is currently free text; it is not an authenticated affiliate relation.
- Missing: affiliate applications/approval/identity lifecycle, protected partner portal, structured agency-booking attribution, commission ledger and settlement workflow, approved materials access, event-based/deduplicated affiliate communications, and the complete CRM/nautical integration.
- The public gateway currently allows only nautical/public-passenger routes and the minimal login/session API. The existing CRM screens are not publicly accessible. Opening them changes the exposed application surface and invalidates a blanket reuse of the narrow nautical dependency review.

## Implementation order and gates

1. Reconcile shared ownership and the current frozen release; restore one coherent CRM navigation and administrator entry point. Preserve existing working boat operations and a rollback image.
2. Simplify the crew workflow and test actual scanning on representative Android devices, plus desktop/mobile browser, denied camera, manual fallback and offline uncertainty cases.
3. Implement affiliate applications, administrator approval, independent access guards and CRM tagging. Prove cross-agency isolation with two agencies and an unrelated organization.
4. Add own-agency bookings, passenger registration and sales materials; implement the commission ledger with the confirmed tour-only 10% base and documented remaining policies.
5. Integrate message drafts/queues in the CRM/ARM, connect and verify WhatsApp separately, then test eligible-recipient selection, approval, consent revocation, suspension and retry behavior before any real send.

This is a cross-module/data/authentication change: full pre-code EGM design review is required, followed by independent code review and Claude review for security-critical changes. Those reviews have NOT been performed for this brief. The UI-only review from the preceding release does not cover this expansion.

## Current coordination blocker

`node scripts/coordina.mjs verifica` reports overlap with `modalita-ascolto` on `src/components/marine/` and `tests/unit/marine/`. The remote `claude/ascolto-orbit` declaration claims the broad `src/components/` and `tests/unit/` directories; CRM shell/nav also overlap the beauty package. Do not edit, reset or overwrite those shared files, change another tool's branch, weaken the checker, or treat a different worktree as permission to bypass ownership. Prepare design/reuse evidence independently; resolve the assignments before implementation. No shared application files or deployment settings were changed while preparing this brief.

## Inspectable proposal

Interactive conversation mockup: `C:/Users/stefa/.codex/visualizations/2026/11/01/01a198be-f68f-7c30-8ff8-4e05ee72b604/bambola-tre-accessi.html`. It simulates crew scan/confirmation, the restored CRM navigation, affiliate registration/pending/approval, and the confirmed commission example. All data is fictional; it makes no network requests, creates no account, sends no message and changes no live platform state.

## Proposal verification

The interactive proposal passed 15 browser checks: scan/confirmation and duplicate handling within the simulation, pending access, administrator approval, CRM tag state, no promotional opt-in by default, the 100+20 USD commission example, and no horizontal overflow for all three views at 360 and 320 pixels. No JavaScript errors. Screenshots were inspected. These are prototype checks, not authentication, real camera, payment or live messaging tests. Evidence: `C:/Users/stefa/bambola-runtime/qa/bambola-proposal-checks.json`.

## Owner correction: preserve the existing CRM, add modules only

Confirmed latest direction: retain the original CRM feature screens, including automations and WhatsApp connection/settings. Add nautical and affiliate sections; do not replace the CRM shell with a second dashboard or informative mock panels. Clientify is the interaction reference already researched on23September2026, not source code to copy. Read reference: C:/Users/stefa/.codex/knowledge/insiderslab/progetti/clientify-crm-benchmark-2026-09-23/README.md.

Use role names in visible interface labels: Administración, Tripulación, Agencias/Afiliados. Do not use a staff member's name to identify a section or permission level. A person's actual name remains appropriate only where it identifies an assigned task or actual account.

Preserve existing screens/routes for contacts, inbox/conversations, pipeline, dashboards, agent, automations, laboratory and settings including WhatsApp, templates, team and listening mode. Staff get a simpler entry point, not access to the administrator CRM via an alternate URL. Connecting WhatsApp must use the original functioning configuration flow, with real connection status; merely showing a button does not establish a connected provider.

Add Calendar/tours with a practical trip detail: departure/time, passengers, equipment such as inflatable/floating mattress, meals/preparation, who is assigned to cooking and other tasks, and task completion. An assignment must identify a valid member of this organization; a display string is not an authorization rule. Crew view contains calendar -> tour -> own/crew tasks, and a prominent QR action with the existing safe confirmation semantics. Avoid extra daily dashboards and duplicate calendars for the same tour.

Provide an installable mobile web-app entry for crew on the same service, rather than promising a native store app. HTTPS, manifest/icons/start entry, actual Android installation/camera and mobile usability require verification. Do not cache passenger records or authenticated CRM responses in a public service-worker cache; disconnected operations must not silently claim server confirmation.

### Concrete coordination request

The previous explicit unification assignment covered Hair/beauty. A scoped assignment for this La Bambola integration was requested in chat because the registry still reports a conflict. Requested authority: coordinate the necessary shared CRM files on the Codex branch, preserve Claude's listening-mode changes, and avoid any Hair deployment or service change. Do not change another tool's branch or modify the checker to hide a conflict.

Candidate change surfaces to reconcile before edits: src/components/app-nav.tsx, src/components/app-shell.tsx, src/app/(app)/layout.tsx, marine UI and new crew/calendar routes, settings navigation only if necessary, isolated marine deployment/public-route rules and scoped tests. Existing authentication/tenant guards must be preserved; widening public CRM access requires a fresh security review and negative-role tests. Review that the crew cannot reach CRM APIs directly, not just that its menu is hidden.

No shared application code was modified while awaiting this assignment. The work is not represented as a completed CRM restoration.
