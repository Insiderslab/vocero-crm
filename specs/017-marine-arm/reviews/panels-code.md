# Panels/calendar independent code review

Fresh native app_code_reviewer /root/marine_panels_final_review, fork_turns none, configured GPT-5.6 Sol. Third reviewer invocation in this UI cycle. Read AGENTS, CLAUDE, laws/method/memory, design, prior review, both exact frozen manifests and files, tests and browser evidence.

Code verdict PASS: no material code finding; verified manifest 07ac97fdd0638d631339b32fd075a1120c83b3dceaae95a59c992de463789ec2, exactly two UI files changed from frozen r5, preview bytes identical.

One P2 evidence gap before deployment: browser tests only used immediate HTTP200 detail GETs, leaving slow/error/out-of-order selection untested. Reviewer requires delayed A, new B selection, old reply out-of-order, then error and recovery; loading/no stale detail/back-to-panels/zero writes. QA assigned this scenario. Build may prepare the code-reviewed artifact while evidence closes; deployment must wait for passing additional test and re-audit.

Existing checks: typecheck and48marine unit tests PASS; targeted ESLint PASS. Repository-wide ESLint fails due to pre-existing unused argument in deploy/marine/bootstrap.mjs (not changed and not part of source delta), with one pre-existing booking img warning. Do not claim global lint clean. Six browser scenarios passed on synthetic intercepts; these do not prove actual Android camera or live backend flows.

Rollout remains app-only: existing r5 compose plus nonsecret app-image override, same runtime env, --no-deps app. No credentials rotation, gateway/DNS changes or other service restarts. Actual online smoke and baseline invariant comparison required after rollout; rollback only app image if unsuccessful.

## Evidence re-audit
Fresh reviewer /root/marine_panels_evidence_reaudit (fourth invocation), fork_turns none, PASS. Read final harness, seven-scenario report, source hashes and recovered-state screenshot. Confirmed delayed/out-of-order requests, loading, stale protection, GET503, back-to-panels and successful recovery with zero writes. Runtime/repository harness bytes match. Frozen source unchanged. Gap closed before rollout. No five-stage review claim; scoped UI path only.

## Build and rollout
Actual bounded build PASS, image sha256:c2993abcfdbf446ac8b3f3b3527b6e2fba40d5e7adb98de6fe8be7b816937e12, source label 07ac97fdd0638d631339b32fd075a1120c83b3dceaae95a59c992de463789ec2. App recreated alone 2026-11-02T12:58:04Z, healthy by12:58:13Z. Compared environment hash/networks/mounts/ports with before baseline; identical. Bambola DB/gateway, Hair three containers and shared Caddy retain IDs/start times/restart counts/health. Host helper also verified other baseline routes. No DNS/Caddy edits. Actual public browser smoke still pending at this entry.

## Actual public verification
At 2026-11-02T12:58:48Z, actual HTTPS browser smoke passed30checks with administrator and crew1 logins. Four marine GET requests, zero marine writes, two paced logins and two confirmed UI logouts. Checked all seven panels, actual backend roles, the three crew tabs, pending labels, calendar360px overflow and44px day controls. Separate masked screenshot inspected. Default Chromium certificate validation retained. host.py check after smoke again passed existing-route/container baseline. No physical Android camera test or full registration lifecycle was repeated in this UI-only update; historical full lifecycle proof applies to unchanged base APIs.
