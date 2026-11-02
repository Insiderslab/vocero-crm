# Stage9 — implementation readiness

Invocations11–13: fresh app_code_reviewer personas implementation_readiness, codebase_details, style. Completed; actual persona/standards/Codex guide, target, EGM policy, AGENTS/clientcontext and relevant source reads confirmed by reports. First two apply implementation-readiness standard; style no standard. Parent measured batch interval189s including orchestration; no native compute figure. No edits or remote actions by reviewers.

## Findings and disposition

- Readiness Major: missing exhaustive deployment file/CLI/state ownership matrix. PROPOSE FIX applied: file/entrypoint table, fixed targets and state/exit conventions, exact mutation/checkpoint responsibilities. DNS stays parent connector only.
- Readiness Major: logout state lives in frozen sharedcomponent; no wrapper contract. PROPOSE FIX: exclusive layout/session-shell, pending disable, retain on failure, confirmed signOut unmount + fullsamepath reload; focused Playwright success/failure/oldcookie401.
- Readiness Major: backup/restore unspecified. PROPOSE FIX: fixed Bambola source, custom pg_dump/no-owner/no-acl, private immutable backup, temporary sameimage/networknone/tmpfs restorecontainer, schema/migration/counts check, scoped cleanup, retain backup/evidence.
- Codebase Major: inheritedDockerfile contains seed/worker artifacts. PROPOSE FIX: dedicated Marine Dockerfile omits build/copy of both, no worker service, inventory proof. Root source remains unchanged.
- Codebase Major: bootstrap must match actual env/auth. PROPOSE FIX: random inert META_WEBHOOK_VERIFY_TOKEN, no mock/provider/superadmin env; ALLOW_SIGNUP=false accepted by actual source; role endpoint raw member and fresh admin session verification specified.
- Style Major: ambiguous supported reachable. PROPOSE FIX: evidence-backed/confirmed reachable terminology.
- Style Major: unmeasurable phone/media acceptance. PROPOSE FIX:360x800/390x844portrait/nooverflow/44pxprimarycontrols, securecontext/APIpresence and simulateddenial/manualfallback. No physical acquisition claim.
- Style Major: before-real-data implies scope expansion. PROPOSE FIX: only synthetic data; separate authorization/scope required for realuse.
- Style Nit: existing Caddy facts in unknowns. DECLINE structural move: values remain explicitly marked verified and pending candidate validation remains identified; no operational ambiguity.
- Style Nit: compressedtokens. PROPOSE FIX for listed audit/status examples; prose spacing does not change commands or contracts.

Full five-stage design path now completed with recorded dispositions. Design readiness allows scoped implementation; failed audit/runtime isolation/TLS/access/independentcode+Claude security gates still prohibit claiming a completed online release. No re-audit invocation used for stage9; fixes are deterministic detail additions within reviewed scope.
