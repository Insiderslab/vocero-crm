# Reduced EGM pre-code review — route acquisition

Reviewer route_anomaly_design, GPT-5.6 Sol, fresh context, read-only.

PASS design after clarification: longer baseline collection and exact protected metadata comparison before/after preserve the existing verifier contract. It is a circumscribed acquisition bug, not literally a configuration-only change. Schema and acceptance relation remain unchanged. No baseline injection or exclusion is permitted.

Material ambiguity corrected before implementation: content fingerprints are not checked by the existing probe; do not promise content integrity. Actual accepted metadata is HTTP status, certificate verification and normalized redirect. The new baseline must actually observe both pre-existing variants before build readiness; otherwise stop. Fresh Claude security and Sol diff reviews required.

Read: AGENTS; Heili EGM policy; anomaly recovery spec; complete crm_host.py/test; latest release status; r3 final review; private root-cause and public fingerprint JSONLs; InsidersLab README/client20; build_crm/rollout call sites. Unknown: max proxy/DNS dwell; public200 body hash. No codewrites or remoteactions by reviewer.

Required tests are recorded in route-anomaly-recovery.md. Implementation owns only the two capture helper/test files. This reduced review does not claim a five-stage plugin cycle or public runtime validation.
