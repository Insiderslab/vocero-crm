# Evidence-bound baseline design

## Problem and scope

The existing external app.heili.cloud route resolves to two pre-existing web containers (DNS alias collision). One public response is200 withoutredirect, one307 to/dashboard. Long120roundsampling producedonly307 becausebackendchoicepersisted. No sourceorcontainer/rete/Caddy metadata changed acrossprevious snapshots. UserexplicitlyrequirespublishBambolawithouttouchingothers. Neverfixexternalrouting here. Reportitsrisk separately.

User did not impose the coordinator's proposed4review cap for this newtask. The four-call plan is exhausted; the coordinator now expands THIS same task within the applicable EGM default20calls/1800reviewseconds, without resettingcounts. Prior conservativeaccountedupperbound812.57s. Reserve5freshdesignstages at60seach plusClaude180s andSol150s =630s; cumulative<=1442.57s/1800,11calls/20. One bounded implementation workunit for this new writer only afterfullfive-stageprecode review. No unlimitedretry. The priorapplication/rolloutreviews remainvalidunchanged. This is a fullfive-stagepolicy review; do notclaim executionofeveryoptionalpluginrubric.

## Proposed solution

Add a dedicated evidence-bound baseline WRITER, not modify runtimeguard semantics. Existingcrm_host/build_crm/crm_rollout andapplication remainunchanged. New helper only writes a newbaseline once, after verifying two earlierimmutableprivate snapshots and currentmetadata. It never edits an existingbaseline or sharedservice. Both prior snapshots were gatheredfromrealpublicHTTPS and retainexactstatus/TLS/location; no synthetic allowlist values may be inserted.

Fixedpriorproofs under/opt/bambola-arm/evidence:
A crm-recovery-failed-r3-20261103T0038Z/host-readonly-snapshot.json SHA5096137bffd49af345d700784900146bafdec6e643f18c260c0eedffc6e34408.
B crm-recovery-before-r5-20261103/host-readonly-snapshot.json SHA4e5740855789715c015080e85af49d0f748898d8510d63f6fe5b86845c83e609.
Bothmanifestd4c1de657f7e866b024d5c6106ae2c28a035d000e8ec06bc5c56087be0849c76, source/opt/bambola-arm/releases/20261103-crm-r3. Currentreviewedapplicationr6manifest000dc64a6407720c5ab456b2a907a18a2acabfd97e2d19377628466c262e785c. Newwriter willbe included in newimmutablecandidate withsameapp/gateway/rollout.

## Implementation contract

1.Fixedpaths only; ROOT,archives,filesmustnotbesymlinks. Validateprivateowner/modes andbothexactsourceSHA, schema1,target,manifest,sourcepackage viaexistingmanifestverifier. RequireproofA/Bmetadataidentical for caddy,containers,ownedAppGateway,networks,configFiles. Everyrouteexceptapp.heili.cloud/ mustbeidentical singleobservation. Appunionmustbeexactlythetwo documentedTLS-validresponses already present in A/B; requiringthisshapeisvalidation, notinsertingit.
2.CapturecurrentmetadataBEFORE/AFTER ten freshpublicroute rounds (sameexistingprobe, noTLSbypass). Compareallfivegroups toA/B andeachother; only normalize the fixed release-internal source paths for configFiles.compose and gatewayTemplate fromoldr3tocurrentrelease, requiringthe samehash andexactknownrelativepaths. Runtimeenv/overrides/gateway/sharedfilesmustmatch exactly, with no pathnormalization elsewhere. Positiveintegersresources. Unknowncurrentroutevariant orotherchange refuses.
3.Newbaselineusescurrentmetadata andactualcurrentroutes; only app routeacceptedset is the exactunion extractedfromverifiedA/B. Actualfreshappobservationsmustbesubsetofthatunion; allotherroutevaluesmustmatcholdsingle. Thisbroader capturehistory is the deliberate reviewedcontractchange; no argument aboutshortwindowstability or blanket200/307 acceptance.
4.Write a private audit record listing sourcepaths/SHA, old/currentmanifest, currentactualobservations and mergedroutevalues. Create newfixedEVIDENCEdir exclusively, private600file, sameexistingbaseline schema1 viaexistingexclusivewriter. Audit records baselineSHA afterwrite. Nevermodifyoldstateoroldarchives. Ifpartialwrite/error, stopandpreserve; no automaticcleanup/overwrite. Operator pins exactnewbaselineSHA asbefore. Existingruntime verifier stillrequiresstrictmetadataequality plus exactobservedsetmembership, nowbackedby twoverifiedcapturewindows.
5.Beforeusingwriter archivecurrentNOT_READYf3286ea3bf310d4884be341f1d25025bbebea0809a6519ae776158b7498f6de0 undernewownunique pathafterhashcheck/noactiveplan/builder. Thisisallowedown-evidencepreservation, notpermissiontoweakenchecks.

## Alternatives and risks

- Fixexternalalias: architecturallycorrect, outsideuserpermission.
- Repeatlongsampling: alreadyfailed, no blindretry; cache/connectiondwellunknown.
- Drop externalroute oracceptarbitrarysuccessrange: rejected, weakensdetection.
- Reuseonly307snapshot: rejected, losesalreadyobservedstate andcontradictsapprovedreadiness.
- Fingerprintbodies: newunnecessarycontract/sourcebody200hashnotcaptured; no contentintegrityclaim.
Historicalresponsescouldbestale; exacthash/sourcepackage/target/allprotectedmetadata plusfreshsubset andbefore/aftercomparison boundthisrisk. RuntimeCaddyAPIreloadnotcapturedbyconfigfilehash is anexistinglimitation; no broaderclaim. Pre-existingexternalmisroutingrisk isnotfixedorhidden. No requestcookies/secrets/realdata read.

## Tests and release

Testsourcehash/schema/target/mode/symlinkrefusal, missingproof/extraoutcome, differentprotectedmetadata, onlytwoexactsourcepathnormalizationsallowed, freshunknownvariant andotherroute change refusebeforewrite, resourcesrejectbool/string/nonpositive, unionderivednotinjected, exclusivewrite+partialfailurepreservation, auditSHAmatchesbaseline; existingfullguardsuite. Newhelper/testonly, no dependencies/migrations. FreshClaude security andSol exactdiff/tests beforebuild. Thenprivatebuildimage/label/cleanupguard, ownapp/gatewayactivation, publicTLS/auth/roles/provider/RSC/body/XFF/crossorg/UI gates. Syntheticdataonly. No activation untilallrequiredpreconditionsactuallypass. Ifthisdesignisrejected orproofmetadata differs:STOP, do not patcharoundit.

## Concrete interfaces and ownership (stage 6 clarification)

Repository: C:/Users/stefa/vocero-bambola-arm. Reuse deploy/marine/crm_host.py:
- ROOT = /opt/bambola-arm; RELEASES = /opt/bambola-arm/releases.
- EVIDENCE = /opt/bambola-arm/evidence/crm-recovery, mode0700, root-owned; SNAPSHOT = that directory/host-readonly-snapshot.json, mode0600, root-owned. New audit: same directory/route-source-proofs.json, mode0600, root-owned. Runtime execution is root; reject any source archive/file not owned byroot. Parent and every path component under the fixed root must be regular/non-symlink. No arbitrary CLI proof paths.
- _manifest_release(path,digest) verifies a direct immutable release child with deploy/marine/manifest.py. current_snapshot_metadata(release) returns the exact five groups. routes_snapshot(samples=10,interval_seconds=1) uses TLS-verified curl without redirects and returns sorted/deduplicated lists of route outcomes. resources_snapshot() returns memAvailableKiB and optFreeKiB; type must be exactint and >0. _write_snapshot_exclusive(bytes) uses O_EXCL/O_NOFOLLOW and0600. Reuse sha() and fixedtarget constants. Do not monkeypatch constants/helpers to validate archived snapshots.
- Schema1 exact keys: schemaVersion,manifestSha256,capturedAt,target,caddy,containers,ownedAppGateway,networks,routes,configFiles,resources. target is {root:'/opt/bambola-arm',project:'bambola-arm',domain:'bambola.heili.cloud'}. capturedAt is timezone-awareUTC ISO. Runtime _snapshot_read binds the complete bytes to the SHA supplied by the operator; verify_snapshot_state enforces metadata equality and exact membership. No baseline source-schema changes.
- Route outcome exact fields: status(integer),tlsVerified(boolean),location(null or normalized absolute scheme://host/path with query/fragment removed). Compare canonical JSON with sorted keys; list order is not semantic, generated sets sorted canonically. No body/header integrity claim.
- Required source-derived app set: {status:200,tlsVerified:true,location:null} and {status:307,tlsVerified:true,location:'https://app.heili.cloud/dashboard'}. This is a validation assertion; the values written MUST be extracted from proof records, never constructed from these constants. Every other route is an exact single observation common to both proofs and freshcapture.
- Only release source path adjustments allowed: configFiles.compose.path from /opt/bambola-arm/releases/20261103-crm-r3/deploy/marine/compose.ubuntu.yml to currentrelease/deploy/marine/compose.ubuntu.yml, and configFiles.gatewayTemplate.path analogously gateway.crm.Caddyfile.template. Both SHA values must match; do not normalize any other value or path. All original runtime/Caddy file identities are exact.

Archival is an explicit operator step, not automatic in the writer: verify current snapshot SHA f3286ea3bf310d4884be341f1d25025bbebea0809a6519ae776158b7498f6de0 and directory contains exactly host-readonly-snapshot.json; assert no active builder named buildx_buildkit_bambola-arm-builder0 and no rollout operation/process/plan/locks. Rename only /opt/bambola-arm/evidence/crm-recovery to previously nonexistent /opt/bambola-arm/evidence/crm-recovery-single-r6-20261103, preserve mode and recheck hash. Any ambiguity stops. New writer requires EVIDENCE absent; mkdir(exist_ok=False) wins concurrency exclusively, and partial directory remains on failure. Source archives are never altered.

Deployment remains the existing reviewed crm_rollout.py sequence, ONLY Docker Compose project bambola-arm services app and gateway (containers bambola-arm-app-1,bambola-arm-gateway-1). It changes the app image/profile marine and the mount of its private gateway configuration. No sharedCaddy reload, no Hair/Approve/web changes, no ports/DNS/DB migrations/provider actions. The new writer cannot execute Compose or build; separate reviewed commands use its exact snapshot SHA. Bambola frontend alias bambola-arm-gateway is unambiguous and unique; no web alias on it.

Stage5 actual completedPASS; stage6 completed comprehension with the above missing interfaces, now resolved beforecritique. Nativeelapsed unavailable. Conservatively reserve180s forstage5 and60s forstage6 ratherthanclaim theirrequested caps areactualtimings; total upperaccounting1052.57s of1800. Remaining stages will be timed by the parent clock. Previous4calls remaincounted; current6calls.

## Stage 7 resolutions (supersede writer-only limitations above)

The critic found two real gaps. The design now includes narrowly scoped consumer changes; application, gateway rules, DB and service configuration remain unchanged.

1. Completion binding: write and fsync the private audit FIRST. It contains the two fixed source paths/SHA values, source manifest, current manifest, fresh actual route outcomes and the derived union. Then write the final baseline once with schemaVersion2 and an additional routeEvidenceSha256 field holding the SHA of the complete audit. The audit cannot contain the baselineSHA (that would be circular). Its filename is fixed at EVIDENCE/route-source-proofs.json. crm_host._snapshot_read must accept ordinary schema1 as before, but schema2 requires this exact audit file, private owner/mode, correctSHA and matching currentmanifest/sourceidentities/derivedroutevalues. Missing,partial,modified orwrong audit refuses before any build/prepare/activation. A crash before baseline write leaves no consumable snapshot; after snapshot fsync the audit was already complete. Preserve partial artifacts on error. No historical-route union is ever written as schema1.

2. Shared operation lock: move the existing exclusive operation lock from inside the movable state directory to fixed /opt/bambola-arm/evidence/crm-recovery-operation.lock (root0600). Use the same operation_lock context for prepare, activate, rollback, build and the new archive/capture writer. Only the lock path and prepare/build wrappers change; the service commands and runtime invariants do not. The writer acquires it before checking process/state/hash and keeps it through archive, source/current verification and exclusive newbaseline/audit writes. Another operation fails before state access/mutation. No code deletes an existing lock automatically; stale-lock recovery remains explicit with process verification. Parent lock directory already exists. The lock stays outside the renamed directory throughout, eliminating check/rename races.

Implementation ownership therefore includes new deploy/marine/crm_capture_proven.py and its tests; crm_host.py/audit-schema reader and tests; crm_rollout.py sharedlockpath/preparewrapper and tests; build_crm.py sharedlockwrapper with boundedtests. Reuse crm_rollout.operation_lock from newwriter andbuild to avoid a second implementation. Runtime reader audit validation can be a small crm_host helper, reusing fixedsourceproof constants ratherthanarbitrary path input. No implicit approval for other changes.

New tests: fail audit write/missing/mismatch after each phase and ensure reader/build/prepare reject; schema1 backwardcompatibility for ordinary observed-only baselines; schema2 mandatoryauditbinding; concurrentarchive/prepare/build/activate fail on sharedO_EXCL lock before mutations, including archival checkpoints; existing rollbackretry unaffected. Full5stage review continues atstage8 on these changes beforecode. No deployment attempted.

## Stage 9 exact contract (supersedes earlier archive/operator wording)

### Command and state machine

New CLI: python3 -B <release>/deploy/marine/crm_capture_proven.py --release <release> --manifest-sha256 <64hex>. Function capture_proven(release:Path,manifest:str)->dict. Exit0 prints only baselineSHA/auditSHA/archive path; Refusal exits2 with sanitized reason. Unexpected exceptions print class only and exit1. Fixed paths/constants only; no CLI proof paths, injected outcomes or cleanup flags.

The WRITER owns archival inside the shared parent operation_lock. Ordering: acquire /opt/bambola-arm/evidence/crm-recovery-operation.lock exclusively0600; verify release and proofs; require current EVIDENCE contains exactly one snapshot with SHA f3286ea3bf310d4884be341f1d25025bbebea0809a6519ae776158b7498f6de0; reject legacy EVIDENCE/activation.lock, EVIDENCE/rollout-operation.lock or activation-plan.json. The writer's own PARENT lock is expected and excluded from absence checks. Check exact own builder container absent and coordinator has no other Bambola operation running. All authorized operations must use the updated shared lock; do not launch legacy scripts. Rename only EVIDENCE to fixed nonexistent /opt/bambola-arm/evidence/crm-recovery-single-r6-20261103 and reverify original snapshot hash. Capture/validate current data, create new EVIDENCE exclusively0700, write/fsync audit0600 exclusively, then write/fsync final baseline0600 exclusively. Retain shared lock through final result and release in finally. Any failure preserves archive/partial output and stops; no automatic retry or deletion.

The build CLI acquires that same lock before parsing/running any operational body and retains it through builder cleanup, guard and result write. prepare is split into existing body _prepare plus public prepare wrapper holding the same lock; activate/rollback already wrap their body. New writer uses existing crm_rollout.operation_lock. No nested acquisition. The operation_lock implementation stays unchanged except fixedparentpath. Existing stale-lock recovery applies only after verified no active authorized operation.

### Exact audit JSON and validation

Canonical serialization for audit and baseline: UTF8 json.dumps(value,sort_keys=True,indent=2)+'\n'. Audit exact keys:
- schemaVersion: integer1;
- capturedAt: timezone-aware UTC ISO string, identical to baseline capturedAt;
- manifestSha256: current release digest, identical to baseline manifestSha256;
- sources: ordered list A thenB, each object exact keys path,sha256,manifestSha256, with the fixed values documented above;
- currentRoutes: object with exactly crm_host.ROUTES keys, each a nonempty deduplicated canonical-sorted list of exact {status:int,tlsVerified:bool,location:null|string} records actually returned by the fresh probes;
- derivedAppRoutes: the canonically sorted set-union extracted from the verified A/B app route lists.

Schema2 baseline exact schema1 keys plus routeEvidenceSha256 (64lowercasehex), schemaVersion2. Existing ordinary schema1 remains supported unchanged and has no historical-union writer. Audit is written first; baseline stores SHA256 of its complete canonical bytes. Audit never stores baselineSHA. At capture completion the CLI may print baselineSHA; the separate operator log records it.

Reader algorithm for schema2: require regular/private/root-owned non-symlink fixed audit; hash its raw bytes against routeEvidenceSha256; validate exact audit keys/types/canonical bytes, currentmanifest and capturedAt equality; reload both fixedprivate source files and verify exactdocumentedSHAs/schema1/target/source manifest and source package; require their five protectedmetadata groups identical. Normalize only the two exact source-release paths as specified, deriving currentrelease from baseline configFiles.compose.path and validating it is a direct reviewed release child with its manifest. Require normalized source metadata equals the five baseline groups. Validate all source/audit/baseline route maps have exact routekeys and typed outcome records; allTLSvalues true; every nonapp source/audit/baseline list is the same single value. Derive appunion from verified source bytes; require exact documentedtwo-tuple shape; auditderivedAppRoutes and baseline.routes.app equal thatderivedset, auditcurrentRoutes.app is a nonempty subset. Reject missing/extra/mismatched fields, malformed timestamps/hex/types, wrongsource path/hash, or alteredmetadata. Validate source capturedAt <= auditcapturedAt and atmost24hours prior; compare age at capture time, not wallclock on everyread. This makes old immutable provenance verifiable without an expiry that would later stop a running deployment.

The sourceSHA pins already identify exact provenance; shape checks prevent implementation/schema confusion. No body/header integrity claim. No content or route outcomes may be invented. The only data merged across windows is the source-derived app route set.

### Owned files and tests

Code: deploy/marine/crm_capture_proven.py (new), crm_host.py (schema2audit reader/constants/helper), crm_rollout.py (parentlockpath+preparewrapper), build_crm.py (whole-main sharedlock wrapper). Tests: deploy/marine/tests/test_crm_capture_proven.py(new), test_crm_host.py, test_crm_rollout.py, test_crm_build_lock.py(new). No other source, tests, package, migration or application changes.

Tests must prove auditwritefailure leaves no consumablebaseline; incomplete/missing/tamperedaudit is rejected by _snapshot_read and before build/prepare commands; schema1 remains ordinary-compatible; schema2 and exactderivedunion pass; source/metadata/target/path/hash/mode/symlink/time/resource tampering refuses; extraotherroute outcomes refuse. Concurrency: hold sharedparentlock at each archive/capture checkpoint and attempt updatedbuild/prepare/activate, asserting refusal before operationalbody/mutation; lock survives directoryrename. Test fullbuildwrapper holdslock through cleanup/result-writing and normal/exceptionrelease; existingrollbackretry tests remain passing. No destructiveorremote tests. Validate actual onhostproofs/modes again beforeexecution.
