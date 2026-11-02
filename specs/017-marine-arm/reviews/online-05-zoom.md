# Online pilot — initial Zoom Out

Fresh native app_code_reviewer bambola_online_zoom_retry, invocation4 (single retry of failed invocation3). Required EGM zoom_out persona, zoom-out-standard and Codex integration read, along with actual target/contracts/DELIVERY/method/clientcontext and referenced source. Review completed; not a parent-simulated Goldfish. No deployment code had been written.

## Reviewer findings

- Blocker: target line9 required proven proxy/IP chain for publication but line23 still permitted global fallback online. Marine falls back to a shared780-attempt bucket when trust mode is off, while auth always derives clientIP from forwarded headers. Publication policy must fail closed and spoofed-XFF proof must precede enabling trust.
- Major: review did not bind the reviewed source to the package. Dirty/untracked inputs can change between review and packing; a generated transfer manifest alone does not prove review provenance. Require frozen reviewed snapshot/manifest digest before transfer and abort on modified input, with a deliberate tamper test.
- Major: rollback omitted the new DNS A record, potentially leaving shared-host fallthrough. Require explicit concurrency-safe DNS handling. Reviewer suggested exact-record deletion only if unchanged; actual discovered Hostinger delete schema lacks a filter, so parent chose an explicit safer maintenance-first ordering instead.

## Resolution

Proxy proof now mandatory, global fallback private diagnostics only. Snapshot freezes before independent review and exact digest is checked before archive/build and after transfer. A validated inert Bambola TLS503 block is installed before DNS; after DNS exists rollback only returns to that block and preserves unrelated routes, rather than relying on unsupported DNS deletion. Simulated concurrent-edit refusal and failed-publication rollback are required tests. Earlier distributed-limiter suggestion was withdrawn by reviewer after the explicit single-process synthetic-pilot decision.

Actual reads confirmed: persona, standard, Codex guide; latest target, contracts, DELIVERY, both EGM method references, InsidersLab README/client20, repo AGENTS/README, Hair compose/publisher, relevant auth/limiter/team/env/Marine UI/package/preview sources. No edits, tests, secrets or remote actions by reviewer.
