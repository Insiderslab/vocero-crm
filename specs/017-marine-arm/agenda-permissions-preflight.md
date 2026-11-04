# Bambola source permissions — bounded release prerequisite

Read-only inspection found all542 files in the r9 source snapshot (541manifest inputs plus the manifest) at0666 and255 directories writable by group/other. The r5 base Compose file is0666. Their `/opt/bambola-arm` and `releases` ancestors are private0700; this observation alone does not demonstrate an exposure. The new release-tree guard must refuse these modes. Do not weaken it.

Only these targets may be normalized:

- `/opt/bambola-arm/releases/20261103-crm-r9`: root directory0700, descendant directories0755, regular files0644.
- `/opt/bambola-arm/releases/20261102-r5/deploy/marine/compose.ubuntu.yml`:0644.

The r5 ancestor directories are already0700. Runtime overrides and runtime.env are0600; the actual gateway configuration is root-owned0444. Leave all of those untouched.

Before mutation, acquire the existing fixed Bambola operation lock exclusively without following symlinks. Require its parent to be root-owned0700; do not clear a stale or foreign lock. Preserve the lock's random token and inode/device identity and remove it only if all still match this invocation.

Verify the complete r9 manifest against the externally pinned SHA256 `ef7bcab49494bf0577afec816dc239778db27cf4b470b596600a3cef96042bd7`, using only already loaded standard-library code. Check exact file/directory inventories, no symlinks, regular files/root ownership, sizes and every content hash before chmod. Paths must remain strictly within the literal r9 directory, except the one explicit r5 base file. Require the r5 file's bytes to match r9's manifest entry for `deploy/marine/compose.ubuntu.yml`. No scripts from the target tree may execute to establish trust.

Save a private before-record of modes and hashes beneath the dedicated Bambola QA evidence directory, then apply only the mode changes above. Verify all contents still match the same manifest and the r5 content hash is unchanged. Check root ownership, exact final modes and unchanged service container IDs. Save the after-record. If any check fails, stop; do not restore unsafe broad permissions or mutate application state. This is an authorized repair to the Bambola source snapshot, not a new application release.

No runtime environment contents, databases, DNS, shared Caddy, Hair or other services are modified. No container restart is needed. The operation precedes capture of the new release baseline; it must be reviewed alongside the F2 correction before execution. It has not yet been performed.
