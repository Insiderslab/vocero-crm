# Stage7 — design, structural and style

Invocations6–8: fresh app_code_reviewer agents bambola_online_critic, bambola_online_structure, bambola_online_style; gpt-5.6-sol. All completed with required persona/standard reads (style has no standard), target, EGM method, dated client context and relevant referenced sources. No implementation or remote writes. Parent measured concurrent batch interval240 seconds, including orchestration; native compute time unavailable. Read-command wall times reported19.2s,5.3s,5.9s respectively, not total reviewer time.

## Findings and resolution (EGM resolve, full feature range)

| ID | Reviewer / severity | Finding | Resolution |
|---|---|---|---|
| C1 | design / Blocker | Credential handoff in beauty-qa-runtime crosses the immutable client boundary | PROPOSE FIX: dedicated C:/Users/stefa/bambola-runtime/accessi root; no Hair artifacts or parent ACL changed |
| C2 | design / Major | Gateway shares database network | PROPOSE FIX: edge gateway/app and data app/database internal networks; frontend only on gateway; negative connectivity proof |
| C3 | design / Major | No clickjacking protection for authenticated controls | PROPOSE FIX: exact CSP frame-ancestors 'none', external framing negative |
| C4 | design / Major | Dependency activation blocker only appears in detailed section | PROPOSE FIX: feature risk/acceptance table explicitly states failed audit and unresolved high/critical activation gate |
| S1 | structural / Major | Missing explicit problem/goals/non-goals/acceptance/risks structure | PROPOSE FIX: concise sections and observable criteria added, architecture unchanged except C2 |
| S2 | structural / Major | Alternatives not consolidated | PROPOSE FIX: table of existing rejected/deferred choices and decision reasons |
| S3 | structural / Major | Whole-file byte equality contradicts append | PROPOSE FIX: exact pre-existing prefix bytes/hash, appended block only differs |
| S4 | structural / Major | Rosanni vs historical Rosanny identity inconsistent | PROPOSE FIX: document current user spelling, display Rosanni—PRUEBA and role-based synthetic login; no identity matching/invitation. No need to wake user about spelling for a test slot |
| T1 | style / Major | Resource/route stop thresholds lack interval/source and byte-invariant meaning | PROPOSE FIX: /proc MemAvailable and df every10s, three low-memory samples, disk<10GiB; explicit route status/Location no-redirect probes every30s and two failures; S3 prefix invariant |
| T2 | style / Major | Response-header shorthand conflates names/values | PROPOSE FIX: exact named Cache-Control, Referrer-Policy, X-Robots-Tag and CSP values |
| T3 | style / Nit | Contradictory scope clarification chain | PROPOSE FIX: one authoritative scripts/deployment/logout scope paragraph |
| T4 | style / Nit | Budget total/per-stage unclear | PROPOSE FIX: total20 invocations/30minutes reviewer time for cycle; measured parent intervals recorded separately |

All proposed edits applied under authorized uninterrupted workflow. Also reconciled detailed step5 with maintenance-first rollback and removed obsolete trusted-IP-false wording. New semantic boundary: line70, feature1–69, detailed70–87. No claim that downstream implementation/runtime gates have passed.
