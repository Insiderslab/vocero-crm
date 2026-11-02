# Bambola ARM — deployment helper

This directory contains the isolated deployment tooling for the synthetic La Bámbola pilot. Fixed targets are `/opt/bambola-arm`, Compose project `bambola-arm`, and `bambola.heili.cloud`. These helpers do not manage DNS or credentials and must not be retargeted to Hair or another installation.

## Host state helper

Run `python3 /opt/bambola-arm/releases/<release>/deploy/marine/host.py baseline --manifest-sha256 <reviewed-sha256>` before any mutation. It captures the reviewed source digest, Caddy baseline, container identities and ten route samples. The exact `app.heili.cloud/` status/Location pairs observed during those samples are the only accepted pairs for later checks. Run `prepare`, then `maintenance` to append/reload the 503-only Bambola block. Immediately before the parent adds DNS, run `dns-intent`; this durably marks the one-way boundary. Parent orchestration then adds the DNS record and writes strictly validated `evidence/dns-added.json`. `activate` requires that marker, DNS intent, maintenance phase and a live TLS 503 check. After DNS intent, `rollback` can only select the reviewed maintenance candidate, even if the evidence marker is missing or invalid. Before intent, rollback restores the original config. Every edit checks the saved expected hash and inode and reloads Caddy with SIGUSR1.

The parent writes `dns-added.json` only after confirming that the added record is exactly Bambola A `186.241.16.46`, TTL 300, and every other RRset is unchanged. The file must be a nonsymlink regular file with mode 0600 and this exact schema: `{"version":1,"domain":"bambola.heili.cloud","zone":"heili.cloud","name":"bambola","type":"A","address":"186.241.16.46","ttl":300,"before_other_rrsets_sha256":"<64 lowercase hex>","after_other_rrsets_sha256":"<same 64 lowercase hex>","manifest_sha256":"<reviewed digest>","state_base_hash":"<captured Caddy baseline hash>","captured_at_iso":"<timezone-aware ISO 8601 timestamp>"}`. The host helper performs no DNS operations.

Evidence is written with restrictive permissions under `/opt/bambola-arm/evidence`. Never add credentials, cookies, response bodies, or runtime environment values to evidence or logs. Parent orchestration owns Hostinger DNS and SSH/SCP operations.

## Build helper

Build only a transferred, frozen release folder directly under `/opt/bambola-arm/releases`. Verify its complete manifest digest locally and after transfer. Invoke `build.py --release <absolute-release-path> --manifest-sha256 <reviewed-sha256> --node-image docker.io/library/node:22-alpine@sha256:025b8e975a61d94e33abeafaad1255ef44e4898cf1a1b6446860009c72e6d284`. This exact Node 22 Alpine linux/amd64 digest was verified by the coordinator. No mutable tag fallback is permitted. The helper creates and removes only its dedicated `bambola-arm-builder`; it monitors available memory, `/opt` free space, existing routes and service state while building, and stops only its own BuildKit container when a guard trips. Each run retains a private timestamped log and result JSON. The result contains the immutable image ID and verified `heili.source-manifest` label; use that image ID for runtime preparation and bootstrap.

## Private bootstrap

Run as host root, after transferring and verifying the same frozen release and preparing the protected runtime accounts file:

```sh
python3 /opt/bambola-arm/releases/<release>/deploy/marine/bootstrap.py run \
  --app-image sha256:<inspected-image-id> \
  --manifest-sha256 <reviewed-64-hex-digest>
```

The helper validates the release manifest and image ID/label before it launches. It starts only its fixed one-shot bootstrap container on `bambola-arm_bambola_edge`, using the same app image, `--user 0:0`, 128 MiB, 0.2 CPU, 64 PIDs, read-only root, dropped capabilities, `no-new-privileges`, and an 8 MiB noexec/nosuid `/tmp`. It mounts only `bootstrap.mjs` and root-owned `accounts.json` read-only plus its unique root-only result staging directory. It does not mount the Docker socket, runtime env, database volume, or provider credentials. It validates the result, writes exclusive 0600 `evidence/bootstrap.json`, and removes only its own staging directory. It does not print account data or passwords.

## Pilot access and limits

The release is synthetic test data only. Do not load passenger records, connect providers, send invitations, or use WordPress. Staff credentials are handed off separately through the protected local file described by the coordinator; never print or paste passwords. The pilot is single-instance and in-memory throttling resets on app restart. Physical Android camera acquisition and live passenger use are not verified by these helpers.

## Verification status

Host changes in this workunit are local code only. They have not been run against the VPS, shared Caddy, DNS, or runtime secrets. Publication remains gated on parent-managed private bootstrap, dependency reachability review, network isolation proofs, HTTPS checks, backup/restore, full workflow verification, and independent code/security reviews. A failed package audit must continue to be reported as failed even when an isolated route is proven unreachable.

Gateway capability note: the pinned official Caddy binary carries a NET_BIND_SERVICE file capability. Dropping that capability from the bounding set prevents execution (actual isolated validation returned EPERM). The gateway therefore drops ALL and adds only NET_BIND_SERVICE to the bounding set, with UID65532 and no-new-privileges. An actual isolated Caddy process reported CapEff=0, CapBnd=0x400, NoNewPrivs=1 and served HTTP200 on8080. The release isolation test requires these exact effective/bounding values; NET_RAW remains absent. No other capability or privileged mode is permitted. The gateway config has no secrets and is0444 under a0700 host parent so the nonroot gateway can read its single read-only bind mount; accounts and runtime.env stay0600.
