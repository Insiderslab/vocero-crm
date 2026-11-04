# Agenda v1 — verified local candidate

Updated 4 November 2026. Published pilot is still r9; this agenda increment has not yet been published. The calendar implementation and its independent post-code review are complete. The isolated app-only release helper passed the five-stage design, native post-code and Claude security reviews. The actual release attempt stopped before building because an unrelated public route varied outside the short capture set.

## What is implemented

Spanish calendar views Hoy, 3 días, 7 días and Mes; Caracas dates and month-end navigation; new tour from a chosen day with default 09:00–17:00 times; explicit access to that tour's operations or Reservas y servicios; chronological cards; draft retention and same-command retry after uncertain writes; separate read-error recovery after a confirmed save. Existing API response remains limited to 50 tours and the UI labels that limit.

Group registration, birth date, affiliate portal, automatic conversation extraction and service quantity editing are not part of this increment.

## Source and tests

Source commits b757691 and fcc0e40, branch codex/bambola-arm. Runtime overlay:
- src/components/marine/admin-panels.tsx: 830eab777ed30af8d952e8beb10223c0c7fb687564a5907e18ce3b03c3cf4f93
- src/components/marine/marine-app.tsx: 2ecc2fdc985fe9b1dcadf8d3250b26d0a87f0f8e682f3058bdef4dfa0bc4bf32

54 marine unit tests passed; targeted lint and TypeScript checks passed. Final isolated production build passed in166.98seconds, build ID WDJmvjJpPTeYjcDCQ6_ID. Known unrelated build warnings were retained, not changed.

All12 browser scenarios passed on this same frozen build, aggregated from the full run and a focused retry case. This is not a claim of a single all-green run. Earlier harness failures remain in the evidence, including wrong global field selectors, assumptions about navigation after reload, and capture during responsive transitions. Corrected diagnostic proved the pending create form was disabled, two requests used identical payload/requestId, and exactly one tour persisted.

Evidence: C:/Users/stefa/bambola-runtime/agenda-v1-qa/qa-summary.json, SHA256 ab831790628106d716ece3ae092301908d6804c3165f57976b782aaea8c6c210. Parent independently verified the source-report hashes, case outcomes, screenshots,541baselinefiles,540QA-sourcefiles and two runtime overlays. Acceptance artifact deploy/marine/agenda-browser-acceptance.json SHA256 fdbd9bd3e4650b8c8c96272a5087b9294858735c8784d979ba372a10133f26ba.

Browser proof uses synthetic data, desktop Chromium,320/390px viewports, keyboard and CSS200%zoom. Physical Android and real camera checks are not claimed. Local QA is isolated at127.0.0.1:3143, source C:/Users/stefa/bambola-runtime/agenda-v1-qa/app. User previews3130/3142 and Hair were not changed.

## Release prerequisite

Existing crm_capture_proven.py and crm_rollout.py are historical recovery tools, not reusable app-only updates. The reviewed bounded r9-to-agenda release design is agenda-app-update-design.md. Final Stage9 PASS is preserved in reviews/agenda-app-update-readiness-final.md. Implementation and both independent source reviews passed for helper8253011d (commit c6205d7). Existing owner permission to publish remains valid. Live build and activation have not happened; a capture-sampling correction is being prepared locally, requiring its own verified review closure before use.

## Actual release attempt, 4 November

Installed only the verified source candidate /opt/bambola-arm/releases/20261104-agenda-r4, manifest cad4ea43c1ecc1f7276689656f0627f753714fc3f641204c8a3f7df36f644a05. Reviewed source permissions normalization passed without byte changes. Exact packaged Linux suite125tests/1skip passed; Windows suite126tests/4skips passed. Real helper metadata/Compose proofs passed with their documented scopes.

Operations20261104T084749Z-4d99178d3fc8 and20261104T084958Z-77bb369e7f61 remain in captured state. Both build commands were refused before creating a builder or changing the app. app.heili.cloud alternates between verifiedTLS200 and verifiedTLS307-to-dashboard; each short capture saw one and the subsequent guard observed the other. Neither guard nor immutable baseline was edited. A longer empirical capture window is the proposed correction; no changes to app.heili.cloud are in scope.

After-attempt integrity: all container records, gateway, shared Caddy and safe config hashes match both baselines. Existing r9 image eb8d7abe remains healthy. Bambola root302-to-dashboard and Hair307-to-login both verifyTLS. Evidence /opt/bambola-arm/qa/agenda-update-20261104-r4/post-attempt-integrity.json. New calendar is NOT online; no physical Android test performed.

Capture-only correction is now locally implemented and passes129Windows tests with4platformskips. New helper d2832b58 differs from approved8253011; it is not deployed or reviewed. It records a longer actual observationwindow with invariant/QA freshness checks and preserves strict laterguards. A bounded EGM review extension is required because the sole re-audits have already completed; do not reuse their PASS for the new diff. Exact patch/tests and design appendix are versioned. All production data/services remain on r9.
