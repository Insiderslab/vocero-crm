# Agenda v1 — verified local candidate

Updated 4 November 2026. Published pilot is still r9; this agenda increment has not yet been published. The calendar implementation and its independent post-code review are complete. The isolated app-only release helper is being implemented after the five-stage design review passed.

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

Existing crm_capture_proven.py and crm_rollout.py are historical recovery tools, not reusable app-only updates. The reviewed bounded r9-to-agenda release design is agenda-app-update-design.md. Final Stage9 PASS is preserved in reviews/agenda-app-update-readiness-final.md. Implementation, independent post-code review, Claude security review and live release checks still remain. Existing owner permission to publish is valid; no new permission request is needed.
