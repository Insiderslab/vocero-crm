# Route anomaly recovery — scoped operational investigation

Owner instruction 3 November 2026: investigate the anomaly, unblock and publish Bambola without modifying Hair or other services. This is a new, bounded corrective task for the newly reproduced route anomaly; it does not reopen application features or waive the completed r3 reviews. Keep prior cycle counts/evidence unchanged. Proposed budget: at most 4 fresh reviews, 15 reviewer minutes, one implementation work unit. If a guard-contract change needs the full five-stage design, do that before code within a separately documented budget; do not claim a reduced path is full EGM.

## Facts

r3 app/gateway/rollout is reviewed PASS static/local; manifest d4c1de657f7e866b024d5c6106ae2c28a035d000e8ec06bc5c56087be0849c76. Builds stopped before any activation. Existing guard captures ten HTTPS observations about one second apart and records the observed status/TLS/normalized redirect set. No automatic success-code range.

Read-only new evidence in C:/Users/stefa/bambola-runtime/crm-qa/route-anomaly-*.jsonl: DNS app.heili.cloud resolves only186.241.16.46; shared Caddy file has reverse_proxy web:3000. Both second-brain-web-1 and approve-web-1 have alias web on second-brain_frontend. Direct unauthenticated public-root requests to their container IPs yield respectively200/Heili by3Runes and307/dashboard/Approve byHeili, matching both public variants. No .env or secrets read; no external files/processes/configuration changed. This is a pre-existing ambiguous upstream, not a Bambola app defect. It must be reported, not fixed without authority for the other services.

## Decision to review BEFORE implementation

Smallest option: extend only baseline observation duration sufficiently to observe existing variants, while retaining the same strict equality comparison, exact set of observed outcomes, all container/network/config/route integrity checks and immutable snapshot binding. Do not inject 200/307, ignore the route, or rewrite an existing snapshot. Existing method permits multiple observed outcomes; a longer sample window would not change the verifier contract. Need independently assess whether this is a configuration-only reduced EGM change or changes the safety contract and therefore requires full design review. Capture success must exclude unrelated metadata drift across the longer interval. Evidence must show both outputs are pre-existing and not new faults introduced by deployment. No change to Hair/Approve/shared Caddy/DNS. Unknown: full response body hashes stability across both public outputs (measurement running).

Alternative if reduced path is insufficient: explicit manifest-pinned response fingerprints and endpoint/metadata checks for this one known ambiguous route. That changes contract and requires full pre-code design, separate Claude and final Sol review. Do not implement before the design decision.

## Invariants and verification

Only Bambola deploy helper/test files may change; application/package/DB immutable. Every new baseline is a new exclusive file; previous directories archived with verified hash and no activation underway. Preserve TLS certificate validation. Unexpected status/location/TLS outside the actually observed baseline set, any other metadata drift, insufficientresources, unknown services/aliases, or failed checks stops build/deploy. No reload/restart of shared components. Full public auth/role/provider/RSC/body/XFF/UI gates remain mandatory after actualactivation. Synthetic data only. No provider/messages/payments.

## Design decision, before implementation

Fresh reviewer route_anomaly_design (app_code_reviewer GPT-5.6 Sol, fork_turns:none) completed. Reduced EGM is appropriate for this circumscribed capture bug: sampler already records an observed set and verification already requires exact membership. This is not a new exception/allowlist. Full five-stage design is not claimed. Source-body integrity is NOT part of the existing or proposed route probe; the misleading content wording above is corrected. No fingerprints will be introduced.

Approved minimal implementation: baseline120rounds,5second spacing (nominal10minutes); runtime checks1round/noextra sleep. Compare the same five protected metadata groups before/after long sampling and refuse before writing if any differ. Keep final positive resources, exclusiveprivate snapshot, schema, TLS and comparisons. Readiness requires the new snapshot to contain both actually observed public variants; otherwise stop and preserve the evidence. Do not inject values or retry blindly. Two separate post-code reviews required: Claude security and independent Sol.

Tests: exact union without injection; baseline-only extended timing; all five metadata drift cases refuse before snapshot write; stable same-schema snapshot; unknown third status/location and invalidTLS rejected; all existing host/build/rollout regression checks. Maximum cache dwell is UNKNOWN: ten minutes is a bounded observation, not a guarantee of collecting both variants.

Review1 complete; conservatively reserve240seconds from900second new-task reviewerbudget (native elapsed not available). Remaining two required reviews capped together660seconds. Prior cycle counters remain unchanged. Worker owns only crm_host.py and test_crm_host.py; no application or externalservice writes.

Implementation work unit: first local r4 frozen e209a0a9a2e6ae1e9a29acd2803335ffa58178f3dc35016c110c535c295abb97, not uploaded or reviewed post-code. Parent acceptance check caught missing positive-resource assertion before snapshot creation; same work unit is completing that requirement and restoring no final unnecessary sampler sleep. r4 will remain immutable; final candidate r5 forthcoming. Actual suite output says75tests total with1skip (74passed), not75passed plus1skip.

## Final candidate and actual checks

r5 immutable directory C:/Users/stefa/bambola-runtime/releases/20261103-crm-r5;538files; SHA45264e6856db1c76130712963043ddf98ea075c85b86e1eeb809b85a28c929b3. Only crm_host.py/test_crm_host.py differ from reviewed r3. Positive-resource assertion added before freeze; no last unnecessary sampler sleep. Parent rerun:76tests total,75passed,1skipped (Windows symlink). No actualDNS mutation: the test suite's 'DNS intent recorded' output is from a synthetic unit fixture.

Fresh Claude review2 started01:03UTC with300second process cap; fresh Sol review3 started concurrently with300second cap. Budget reserve240+300+300=840seconds below900; no double counting or claim of native token cost. No remote build/activation before both verdicts. Immutable source upload is preparation only.

Claude review2 completed92.57seconds, exit0, streamedresultsuccess/nonerror. PASSconditional forbaseline/privatebuild; complete report reviews/route-anomaly-02-claude.md. Coordinator confirmed no unknown callers rely on old defaults: frozenrelease matches onlycrm_host,crm_rollout,theirtests, plus unrelated legacyhost.py ownfunction. G3 satisfied read-only: Caddy upstream bambola-arm-gateway:8080; all gateway frontendaliases(bambola-arm-gateway,bambola-arm-gateway-1,gateway) each owned by exactly one container. No webalias onBambola. G1/G2 wrapper prepared to archiveverifiedsnapshot only, rejectactiveplan/builder, requireexactactuallyobservedroot200+307 andeveryotherrouteexactoldsingle; no write/injection ofoutcomes.

Owner informed ofpre-existingpotentialcross-service requestmisrouting at app.heili.cloud; no claim ofconfirmed credentialdisclosure, no externalfix attempted. Reducedpath preservesroute metadata verification only, notbodycontentintegrity.

## Re-audit correction and interrupted observation

Solreview3 foundresource truthiness acceptednegative values; its realreproducer supersedes the worker's claim ofstrictpositive. Noapplicationorserviceactivated. Samecorrectionworkunit nowexplicitlyrequires type(value)isint andvalue>0 inbothsnapshotverificationandcapture, withzero/negative/bool/string regressions. Actualsamplerunion/subsetregressionsadded. r5preserved; newr6manifest000dc64a6407720c5ab456b2a907a18a2acabfd97e2d19377628466c262e785c,538files. AuthoritativeFROZENr6suite77run76passed1skip. Inheritedrepo and frozen test_runtime differ by one test; repository counts must not be attributed to artifact.

r5read-onlyobservation had alreadyarchivedoldbaseline, then stopped on curltimeout28 forwhapi.heili.cloud beforecreatingthe newevidencedirectory. Noactivebuilder/capture andno newsnapshot. No deploy orsecret exposure. Evidence r5-baseline-capture.log. Coordinator explicitly permits ONE newcapture afterr6review (different correctedcandidate); no blindretryloop. ArchivedoldSHA4e574085... preserved in crm-recovery-before-r5-20261103. r6wrapperverifiesarchivehash+protectedmetadata andrequiresevidencedirectoryabsent. SameG2exactactualobservationsgatebeforebuild.

FreshSolre-auditcall4/4 started01:09UTC, cap240seconds. No more reviewcalls assumed. Source/operationalguards remainintact. Claude's earlierconditional securityverdict applies to unchangedsampling/securitydesign; r6delta onlystrengthenspositivechecks andtests, tobeverifiedbyfinalSol.

FinalSolcall4 completedPASSconditionalcapture; exactreport route-anomaly-04-r6-sol.md. No morecallsassumed. Conservativebudget upperreserve240+92.57+240+240=812.57seconds <900; actualnativeSoltime unavailable. r6observation started01:11:34UTC followingreview. Privatebrowserharness corrected beforepublicuse againstfrozenUI: localecontrolcycles(doesnotopenmenu), SpanishnavAgente, fixturedate/member nestedpaths; scriptnowexitsnonzeroifanyUIjourneyfails. Thischangesonlyprivateverification, notcandidateorapplication. No publicauthentication/mutation yet.

Privateharness consistency corrected against exactfrozenrelease beforepublicexecution: healthHEADexplicitlyallowedbyreviewedgateway(expected200, otherHEADAPI404); negativeverdictsectionmatchesheadingratherthanwrongitemnumber; cookiesreadasvalidatedheaderstrings aswrittenbyAPIharness, notspreadintochars. No realrequests orcredentialsprinted. Rawencoded-path404expectationsretained forhonestobservation; anynormalizationdifferencewillnotbeupgradedtoPASSwithoutassessment.
