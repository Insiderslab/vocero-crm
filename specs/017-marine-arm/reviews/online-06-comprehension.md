# What this proposes

The document proposes an isolated, single-app-instance online Bambola pilot at bambola.heili.cloud, using only synthetic data, a fresh database and credentials, strict gateway allowlisting, and a proven two-proxy client-IP chain. It freezes and reviews an exact source snapshot before a bounded build, bootstraps accounts privately, then adds an additive DNS/Caddy route and validates HTTPS, permissions, throttling, rollback, and Hair non-regression. It also adds a visible /nautica logout control using the existing authentication flow.

# How the existing system works, per this document

A tested local marine preview already exists inside the Orbit application, with Better Auth organization roles, tenant/token guards, marine APIs, and in-memory throttling that becomes per-IP only behind a trusted proxy. Hair runs separately on the same VPS behind a shared Caddy instance; Bambola currently has no online deployment code, public route, fresh online database, or real-data workflow. The marine contracts define the application behavior, while this cycle adds deployment packaging and one focused UI change without changing APIs, schemas, auth guards, or runtime dependencies.

## Complete findings from fresh reviewer

1. Blocker: production dependency audit5critical/13high has no executable triage owner/evidence/pass-fail gate. Define supported/reachable and disposition every relevant advisory before public routing.
2. Major: scope says deployment scripts only while planning UI logout. Include exact UI inputs/tests in ownership and frozen manifest.
3. Major: define "without touching Hair" operationally because additive shared-Caddy changes/reload affect shared ingress. Specify permitted state changes and unchanged invariants.
4. Major: provider/tool, snapshot meaning, missing DNS CAS and exact deletion semantics unspecified; restoring original Caddy after DNS creation can violate no-fallthrough. Define verified rollback order.
5. Major: protected local credential file lacks workstation/server boundaries, transfer, retention and deletion lifecycle.

Actual reads confirmed by reviewer: comprehension persona, Codex integration, target, contracts, DELIVERY, online-review-log, EGM policy/active note, InsidersLab README/client20, AGENTS, LEGGI, CLAUDE, GUIDA-HEILI. No source edits or remote action. Invocation5, native fresh app_code_reviewer. The stage completed before the last coordination-scope update was incorporated in its report; parent notified reviewer and resolves the scope finding in current target.

## Parent dispositions before stage7

All5 findings accepted and concrete text added to online-pilot.md: mandatory advisory-row gate and independent evidence; exclusive /nautica layout logout scope (shared marine component frozen); additive ingress only, Hair bytes/container invariants; Hostinger no-CAS/no-filter deletion limitation with maintenance503 installed BEFORE DNS, after-DNS rollback only to maintenance; SSH/SCP account-only transfer to ACL-protected Stefano workstation folder and explicit retention. No user permission inferred from silence; deployment permission was already explicit. No implementation yet.
