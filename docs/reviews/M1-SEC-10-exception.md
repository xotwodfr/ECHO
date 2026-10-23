# SEC-10 exception: unfixed HIGH findings in the Debian 13 base image

| Field | Value |
|---|---|
| Status | **Accepted exception. SEC-10 is not passed.** |
| Decision | Accepted by the product owner, 2026-10-23, to close M1 and proceed to M2 |
| Owner | The product owner (decision, reassessment, renewal or rejection) |
| Scope | Exactly the 43 findings listed below, identified by severity, CVE, package and installed version. Machine-readable copy: [`M1-SEC-10-exception.txt`](M1-SEC-10-exception.txt) |
| Expires | At the **M9 SEC-10 re-check** (`IMPLEMENTATION_PLAN.md` M9). It is not renewed silently: at M9 SEC-10 either passes strictly or needs a new, explicit owner decision |
| Policy | Unchanged. The target stays **zero high/critical findings** (`ACCEPTANCE_CRITERIA.md` SEC-10, `SETTINGS_AND_SECURITY.md` §12). Nothing is suppressed in the scanner |

Background and the removal of the critical zlib finding: [`M1.md`](M1.md), "SEC-10".

## Scanner evidence

- Image: `echo:m1`, rebuilt from commit `a4a9843`, image ID
  `sha256:92bdb691b75d97eb25814dbffcd89b38e20c68d6e125b6e3571db01317480607`. Base
  `node:24.22.0-trixie-slim@sha256:a6155384446670e9719bdc4fd0ebe4d4b29fb32a8d6aa523da3547a6cfbcf22c`,
  Debian 13.7.
- Scanner: Trivy 0.75.0 (the digest pinned in CI), vulnerability DB updated 2026-10-23 01:18 UTC.
  Scan run 2026-10-23 07:00 UTC.
- `--severity HIGH,CRITICAL --ignore-unfixed`: **0** findings.
- `--severity HIGH,CRITICAL` (all): **43 HIGH, 0 CRITICAL**, all in Debian OS packages, none in
  Node packages. Debian status: 42 `affected` (no fix released), 1 `fix_deferred`.

## Findings

Nine CVEs, mapped by Trivy to 16 binary packages. Severity is HIGH in every case. "Source" is where
Trivy took the HIGH rating from (Debian assigns none for these).

| CVE | Packages (installed version) | Debian status | Source, CVSS 3.1 | Issue |
|---|---|---|---|---|
| CVE-2026-76642 | `util-linux`, `mount`, `libblkid1`, `libmount1`, `libsmartcols1`, `libuuid1`, `liblastlog2-2` (`2.41.5-0+deb13u1`); `bsdutils` (`1:2.41.5-0+deb13u1`); `login` (`1:4.16.0-2+really2.41.5-0+deb13u1`) | affected | Red Hat, 7.8 `AV:L/AC:L/PR:L/UI:N` | Failed external mount helper still runs privileged X-mount post-hooks |
| CVE-2026-78408 | same 9 util-linux packages and versions | affected | Red Hat, 7.9 `AV:L/AC:L/PR:L/UI:R/S:C` | `nsenter --join-cgroup` leaks root cgroup migration authority |
| CVE-2026-78409 | same 9 util-linux packages and versions | affected | Red Hat, 7.0 `AV:L/AC:H/PR:L/UI:N` | `X-mount.subdir` resolution can escape via intermediate symlinks |
| CVE-2026-78410 | same 9 util-linux packages and versions | affected | Red Hat, 7.8 `AV:L/AC:L/PR:L/UI:N` | Restricted bind mounts do not pin the source (`X-mount.owner/group/mode` redirection) |
| CVE-2025-69720 | `libtinfo6`, `ncurses-base`, `ncurses-bin` (`6.5+20250216-2`) | affected | NVD, 7.8 `AV:L/AC:L/PR:N/UI:R` | ncurses buffer overflow, possible code execution |
| CVE-2026-16742 | `libsystemd0`, `libudev1` (`257.13-1~deb13u1`) | affected | Red Hat, 8.8 `AV:L/AC:L/PR:L/UI:N/S:C` | systemd-homed: local privilege escalation via missing home-record signature check |
| CVE-2026-54369 | `libacl1` (`2.3.2-2+b1`) | affected | Red Hat, 7.1 `AV:L/AC:L/PR:L/UI:N` | Symlink traversal privilege escalation via libacl functions |
| CVE-2026-9538 | `perl-base` (`5.40.1-6+deb13u1`) | fix_deferred | NVD, 7.5 `AV:N/AC:L/PR:N/UI:N` | Archive::Tar denial of service via a crafted tar header |

4 × 9 + 3 + 2 + 1 + 1 = 43.

## Runtime reachability (verified 2026-10-23 on the OptiPlex 7010)

Method: the image above run with the production hardening from `compose.example.yaml`
(`--read-only --tmpfs /tmp --user 1000:1000 --cap-drop ALL --security-opt no-new-privileges:true`),
then inspected from inside the container.

| Check | Result |
|---|---|
| Libraries mapped by the server process (PID 1, `node src/server/index.ts`) | `ld-linux`, `libc`, `libdl`, `libgcc_s`, `libm`, `libpthread`, `libstdc++`. **No affected library** |
| Libraries mapped with every native module loaded and exercised (better-sqlite3 query, sharp JPEG → resize, `crypto.argon2Sync`) | the above plus `libresolv` and sharp's bundled `libvips-cpp`. **No affected library** |
| `ldd` of `node` and every `.node`/`.so` file under `/app/node_modules` | glibc, libstdc++, libgcc, libresolv, bundled libvips (plus unused musl prebuilds). **None of the 16 packages** |
| Processes started by ECHO | ECHO's code (`src/`, `scripts/`) never imports `child_process`. With `child_process` instrumented, loading and using sharp and better-sqlite3 spawned **nothing** |
| Processes in the running container | only `node src/server/index.ts` |
| setuid binaries (`mount`, `umount`, `su`, `passwd`, …) | present on disk, but neutralised: `CapEff`/`CapPrm`/`CapBnd` are all 0 and `NoNewPrivs` is 1. `mount` as uid 1000 fails ("must be superuser"); `su` fails |
| systemd-homed / `homectl` | not installed. Only the client libraries `libsystemd0`/`libudev1` are present |
| Archive::Tar | not installed (`perl-base` ships no `Archive/Tar.pm`); `perl` itself is present but never run |
| Binaries that do link the affected libraries | Debian tooling only: apt, bash, coreutils (`cp`, `mv`, `install`), `sed`, `tar`, util-linux tools, ncurses tools, shadow tools. ECHO runs none of them |

**Conclusion:** no affected component is loaded or executed by ECHO's production runtime as built
today, and the privilege-escalation CVEs (util-linux mount helpers, systemd-homed, libacl) have no
privilege to escalate to under the container hardening.

**What is not established, stated explicitly:**

- **After code execution in the container**, the vulnerable binaries are on disk and an attacker
  could run them. The verification shows they are not *reachable from ECHO*, not that they are
  *absent*. The hardening (no capabilities, no-new-privileges, read-only root) is what limits them
  then, and that depends on the deployment actually using the compose settings.
- **Dependency fallback paths:** `detect-libc` (used by sharp) can shell out to
  `getconf GNU_LIBC_VERSION; ldd --version` through `/bin/sh` when it cannot read `/usr/bin/ldd`.
  It did not happen in the test. Those tools come from `libc-bin` and `dash`, which are not in the
  affected list, so this path would not reach the affected packages either. Other rarely taken paths
  in third-party code were not exhaustively audited.
- **Future code:** sharp and better-sqlite3 are not yet used by the server (M4/M5). They were
  exercised directly for this check. Code added from M2 on is not covered by this verification.
- **CVE details:** for the 2026 CVEs the assessment relies on the Trivy/vendor descriptions and the
  component analysis above, not on a review of the upstream patches.

## Mitigations in place

- Container: non-root uid 1000, read-only root filesystem, `/tmp` tmpfs, `cap_drop: ALL`,
  `no-new-privileges`, no published ports (only Caddy reaches it).
- Image: base pinned by digest; npm and corepack removed from the runtime stage.
- CI (`.github/workflows/ci.yml`, job `security`): any **fixable** HIGH/CRITICAL fails the build. A
  second step scans **all** findings and runs `scripts/sec10-exception-check.sh`, which fails on any
  finding not listed in `M1-SEC-10-exception.txt` (a new CVE, any CRITICAL, or a changed package
  version) and always prints "ACCEPTED EXCEPTION, NOT PASS" to the log and job summary. CI green
  therefore never means SEC-10 passes.

## Reassessment triggers

The owner reassesses the exception, and either shrinks it, renews it explicitly or rejects it, when:

1. **The monthly base-image rebuild** (`SETTINGS_AND_SECURITY.md` §12) or a Node security release
   moves the base digest. Package versions change, so the CI exception check fails until the list is
   updated deliberately.
2. **A fix becomes available** for any listed finding. The fixable-findings CI step fails on it
   automatically; the fix is taken by rebuilding, not by extending the exception.
3. **A runtime dependency or ECHO code starts loading or executing** any affected library or tool
   (e.g. spawning processes, or a native module that links one of them). The reachability checks
   above are repeated.
4. **Before the service is exposed on its public domain**, at the latest at the first public
   deployment in M5 and again in the pre-share review (SEC-19, M8).
5. **M9**, where the exception expires.

Each reassessment updates this document (date, scan, decision). Any base-image change made to
resolve findings must be justified on its own merits and verified on the OptiPlex 7010 (native
modules, Argon2id timing, healthy container) before adoption; images are not swapped only to
improve scanner output.

## Reassessment log

| Date | Trigger | Scan | Decision |
|---|---|---|---|
| 2026-10-23 | M1 close | 43 HIGH, 0 CRITICAL, 0 fixable | Accepted until M9 |
