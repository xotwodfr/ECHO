# Security Policy

## Supported Versions

Only the latest release is supported with security updates.

| Version | Supported |
|---------|-----------|
| Latest  | ✅        |
| Older   | ❌        |

## Reporting a Vulnerability

**Do not open a public issue.** Security vulnerabilities should be reported privately.

Email: **security@folk3s.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional)

We aim to acknowledge within 48 hours and provide a fix timeline within 7 days.

## Security Model

ECHO is a self-hosted music player. The threat model assumes:

1. **Public exposure**: The server is reachable from the internet (via Cloudflare tunnel + Caddy)
2. **Trusted users**: Admin + invited users (family/friends)
3. **Untrusted network**: Clients may connect from any network
4. **Data sensitivity**: Navidrome credentials, listening history, session tokens

### Defenses in Depth

| Layer | Controls |
|-------|----------|
| **Network** | Cloudflare tunnel (DDoS, WAF), Caddy (TLS, rate limits), internal Docker networks |
| **Container** | Distroless runtime, read-only rootfs, non-root (uid 1000), dropped capabilities, no-new-privileges |
| **Application** | Argon2id password hashing, mandatory TOTP for admin, rate limiting, secure cookies (`__Host-`), CSP, signed stream URLs |
| **Data** | AES-256-GCM envelope encryption for secrets at rest, master key as Docker secret |
| **Isolation** | Per-user data scoping at query level, automated isolation test suite |
| **Supply Chain** | Digest-pinned base images, pnpm lockfile with release-age gate, Trivy scans in CI, gitleaks |

## Security-Related Configuration

- `ECHO_PUBLIC_ORIGIN` — required in production for Host/Origin validation
- `ECHO_TRUSTED_PROXY` — must be set to Caddy's address for `X-Forwarded-*` trust
- Master key — 32 random bytes base64, stored as Docker secret (`secrets/echo_master_key`), **back up separately from data volume**

## Disclosure Timeline

1. **Day 0**: Vulnerability reported
2. **Day 1–2**: Acknowledgement + initial assessment
3. **Day 3–7**: Fix developed and tested
4. **Day 7–14**: Patch release published
5. **Day 14+**: Public disclosure (after users have time to update)

## Out of Scope

- Vulnerabilities in dependencies with no practical exploit path in ECHO's threat model
- Issues requiring physical access to the host server
- Social engineering / phishing attacks on users
- Denial of service (self-hosted, owner controls infrastructure)

## Security Updates

Security fixes are released as patch versions (e.g., `0.8.1`). Subscribe to GitHub releases for notifications.