# Post-code review r1

Invocation14 fresh bambola_online_code_review/app_code_reviewer completed against immutable release20261102-r1,520files,manifest5ba6500404f8dd902008e6a20982bf9f137aba526bf2da815299925c33ab1ddd. Reviewer independently verified manifest and ran27Python tests with1Windows symlink skip. NoP0 supported. FourP1 findings block publicactivation:

1. build.py label/tag not bound to Compose launched image; runtime.py accepts arbitrary mutabletag. Retagging anotherlocalimage could bypass sourceprovenance. Fix required: immutable inspectedimageID+exactmanifestlabel beforelaunch/bootstrap.
2. dns-added.json onlyexistenceflag; emptyfile permitsactivation, deletingmarkerafterDNS allowsunsafeoriginalconfigrollback. Fix required: strictregularprivatefile/schema tieddomain/IP/manifest/baseline/RRsetproof plus monotonic DNSintent preservedbeforemutation, missing/deletedmarker cannotundo maintenance requirement.
3. Same-image bootstrap is not runnable as nonroot with root0600 accountfile and script notcopiedinimage; exactmounts/user/network/resultownership missing. Fix required: explicit isolatedephemeralhelper invocation with reviewedro scripts/accounts and scopedresultwrite, notmainappprivilege escalation.
4. Publicgateway defaultsroot/normalDocker caps onsharedfrontend; noeffectiveUID/capguard. Fix required: nonrootgateway, cap_dropALL especiallyNET_RAW, no-new-privileges/read-onlyroot, onlyneededtmpfs andeffectiveinspectiontest.

Assigned source-only fixes to originalruntime/hostLuna workers with exclusivepaths. Frozenr1 remainsunaltered. This is codefixcycle1 ofmax2. Nextsnapshotrequiresindependentre-audit.

Invocation15 Claude CLI safe-mode, strictMCPempty, toolsnone, nosessionpersistence exited0,is_errorfalse,duration48705ms, BUT result explicitly states previousreplywas cutoff, no usablefindings/verdict. It is NOT a completedsecurityreview; gate remainsopen. Rawinput/output in C:/Users/stefa/bambola-runtime/reviews/claude-r1-*. Singlefreshretry to use bounded r2 sourcebundle, no modelchange/fakeapproval. Calls consumed15/20.
