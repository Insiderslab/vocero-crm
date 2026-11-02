# Independent dependency triage — invocation10

Fresh bambola_dependency_retry/app_code_reviewer completed source/advisory analysis. Raw audit: C:/Users/stefa/beauty-qa-runtime/marine-preview/dependency-audit-online.json,34 findings (5 critical,13 high,12 moderate,4 low). Audit exit1 remains failed. No runtime proof or vulnerability closure is claimed. All18 rows below are NR-static (no supported reachable path in inspected source), pending the stated final artifact/gateway checks. Any unresolved or reachable unmitigated high/critical blocks activation. Package presence alone neither proves exploitability nor closes a finding.

| Advisory (github.com/advisories/) | Severity / locked package | Preconditions and source evidence | Required runtime negative proof |
|---|---|---|---|
| GHSA-5xrq-8626-4rwp | Critical vitest2.1.9 | Vitest UI/API/Browser server; optional BetterAuth peer from devDependency, pnpm-lock117. Runtime command Nextserver, no srcimport | Linux runner inventory; no Vitest process/UI/API/HMR/WS exposed |
| GHSA-5gmw-xhrv-c9v3 | Critical tinypool1.1.1 | Polluted worker options + newTinypool; only Vitest chain, no srcimport | Inventory/no worker start under malformed JSON |
| GHSA-85c8-ppgw-ccpr | Critical tinypool1.1.1 | Polluted Object.prototype.filename + pool.run; absent source sink | Inventory/prototype-shaped input rejected, healthy process |
| GHSA-pqg4-j6r4-53mv | Critical shell-quote1.9.0 | Attacker tokens to quote then shell execution; optional drizzle-kit/gel buildchain, no srcimport | Runner inventory drizzle-kit/gel/shell-quote, no spawned shell from malformed public input |
| GHSA-965c-763c-88jm | Critical better-auth1.6.23 | MagicLink + social/GenericOAuth + DBstate; src/lib/auth/index.ts83,88 only emailpassword/organization | Missing plugins confirmed in compiled app; auth magic/social/callback/encoded routes404, no session |
| GHSA-gpj5-g38j-94v9 | High drizzle-orm0.38.4 | Untrusted sql.identifier/dynamic.as; source search no sinks, Marine value interpolation only | Delimiter strings rejected or literal; DB integrity and cross-tenant negative |
| GHSA-f88m-g3jw-g9cj | High sharp0.34.5 | Untrusted image processed/libvips; only candidate Nextoptimizer denied; QR Images unoptimized at marine-app203,pasajero19 | /_next/image and encoded/method variants404, no upload surface, health |
| GHSA-rgj7-g3m4-5g8c | High sharp0.34.5 | HEIF/libheif under glibc; same denied optimizer, runner Alpine/musl | HEIF image path/body probes blocked; stableprocess; record Sharp inventory |
| GHSA-wq5f-xc86-pv6w | High sharp0.34.5 | SVG/librsvg runtime conditions; same denied optimizer | SVG optimizer/encoded variants404, stableprocess |
| GHSA-6g55-p6wh-862q | High postcss8.4.31 | Untrusted CSS sourceMappingURL processing/exposed error; buildonly, no srcimport | Runner inventory; CSS/map payload cannot invoke processor or disclose markerfile |
| GHSA-r28c-9q8g-f849 | High postcss8.4.31/8.5.16 | Traversing prior-source-map auto-load; same buildonly boundary | Inventory and sourcemap traversal negative |
| GHSA-28wg-ghj8-5hjv | High nanoid3.3.15 | Nonsecure generator negative size; transitivePostCSS; directapp5.1.16 constant sizes20/22 | Vulnerableversion inventory, no public sizecontrol, nohang |
| GHSA-2v37-7h3g-55p8 | High nanoid3.3.15 | Custom generator size0; same transitivechain | Same inventory/fixedsize/nohang proof |
| GHSA-68fv-2mgg-jv7q | High source-map-js1.2.1 | Untrusted indexedmap maliciousoffsets parsed; build/testchainonly | Inventory; indexedmap JSON rejected/bounded, no eventloopstall |
| GHSA-587h-7wmj-h5pm | High vite5.4.21 | Windows launch-editor endpoint; UbuntuNext runner, no Vitesourceimport | NoVite/editorserver; editor/HMR/UI/WS paths404 |
| GHSA-mrhx-c7xc-m3w5 | High zod4.4.3/auditlisted3.25.76 | Huge failingarray unboundedissues; auth scalarlogin and Marine no requestarrays,16KiB streamcap | Declared/chunked >32KiB auth and >16KiB Marine return413, boundedRSS, subsequenthealth |
| GHSA-q84f-53jg-9ppm | High better-auth1.6.23 | deviceAuthorization enabled + approval; onlyorganizationconfigured | Devicecode/verify/approve/encoded404, no session/device record |
| GHSA-r4xp-prcw-77qf | High better-auth1.6.23 | OAuthProxy cookie state/reusedsecret/linking; pluginabsent | Proxy/callback/encoded404 and no session/link |

Primary sources were advisory pages linked by each exact GHSA ID; installed package/source/lock evidence supplied by independent reviewer. No actual hostile payload is copied from advisories into the release. Negative probes use bounded inert synthetic inputs.

Moderate/low:11 non-auth moderate and one Vite low are development/build-server issues (PostCSS/esbuild/Vite/Vitest/@vitest/mocker), same runner inventory and denied dev surfaces required. Three aliases of GHSA-44jh-23m7-hpcf concern BetterAuth PostgreSQL limiter race; prerequisite database-backed limiter is not configured (defaultmemory plus src/lib/rate-limit.ts inprocess map). Actual concurrentlogin/IPspoof proof still required. Windows-specific launch-editor/NTLM conditions do not match Ubuntu, but no devserver may run. If a supposedly build-only package is traced into final Next runtime, inspect its actual sink rather than asserting absence; unproven reachability remains blocked and must be independently assessed in final code review.

Reviewer made no code or remote changes. This matrix records the report, not parent-generated independent approval. Runtime results will be attached with exact release digest after implementation.
