# Agenda v1 — progress and evidence

3 November 2026. Calendar increment currently in implementation; published pilot remains r9. Design and five-stage readiness review recorded in agenda-v1-design.md and reviews/agenda-v1-register.md.

Scope: four calendar modes, Caracas dates, creation from selected date, explicit trip-specific administration shortcut, failure/retry behavior and mobile readability. Existing 50-tour response is explicitly limited. Group registration, date of birth, affiliate portal, conversation extraction and quantity editing are not included in this increment.

Candidate test root: C:/Users/stefa/bambola-runtime/agenda-v1-qa/app, loopback3143, existing synthetic database55437. No changes to personal preview3130/3142 or public services.

Release prerequisite identified by code inspection: existing crm_capture_proven.py is intentionally pinned to the one-time r6 archival and historical r3 sources; crm_rollout.py pins previous panel compose/gateway configuration. Do not invoke these helpers against an already activated r9 as if they were generic updates, monkey-patch constants, or overwrite old evidence. A separately reviewed update procedure must support current r9 as rollback baseline before this new UI can be published. Current release authorization remains valid; this is a technical prerequisite, not a permission request.
