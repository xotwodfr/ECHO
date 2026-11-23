# Contributing to ECHO

Thanks for contributing! This guide covers the development workflow, coding standards, and PR process.

## Development Setup

### Prerequisites
- **Node 24.22** (`.node-version`; `fnm use` or `nvm use`)
- **pnpm 12.11.2** via corepack: `corepack enable`
- **Docker** with Compose v2
- **Git** with gitleaks hook: `git config core.hooksPath .githooks`

### Quick Start
```bash
pnpm install
pnpm dev            # Vite (client, HMR) + server with --watch
```

Server runs on `ECHO_PORT` (default 8080). Vite proxies `/api` to it.

### Environment Variables
Copy `.env.example` to `.env.local` or export in your shell. Key variables:
- `ECHO_PUBLIC_ORIGIN` — required for Host/Origin checks in production
- `ECHO_TRUSTED_PROXY` — Caddy's address for `X-Forwarded-*` trust
- `ECHO_MASTER_KEY_FILE` — path to master key (Docker secret in prod)

See `.env.example` for full list. Invalid values stop the server at startup.

## Code Style

### TypeScript
- Strict mode enabled (`tsconfig.json`)
- Run `pnpm typecheck` before committing
- No `any` unless unavoidable (use `unknown` + narrowing)
- Prefer `interface` over `type` for object shapes

### Formatting & Linting
- **Biome** for format/lint/imports (`biome.json`)
- Run `pnpm lint` (checks) or `pnpm format` (fixes)
- 2-space indent, 100 char line width, single quotes

### Commits
Use [Conventional Commits](https://www.conventionalcommits.org/):
```
feat: add crossfade setting
fix: handle empty playlist in queue
chore: update dependencies
docs: update TECHNICAL_ARCHITECTURE.md
refactor: extract palette service
test: add unit tests for lyric parser
```

Pre-commit hook runs Biome, gitleaks, pnpm audit, typecheck.

## Testing

| Command | What |
|---------|------|
| `pnpm test` | Vitest unit tests |
| `pnpm test:e2e` | Playwright E2E (Chromium + Firefox) |
| `scripts/e2e-container.sh` | E2E in Playwright's Ubuntu image (like CI) |
| `pnpm check` | typecheck + lint + test + build |

### Writing Tests
- **Unit**: `*.test.ts` next to source, Vitest
- **E2E**: `tests/e2e/*.spec.ts`, Playwright
- Test behavior, not implementation
- Use fixtures in `tests/e2e/fixtures/`

## Pull Request Process

1. **Branch** from `main` with descriptive name: `feat/crossfade`, `fix/queue-reorder`
2. **Develop** with `pnpm dev`, write tests
3. **Verify** locally: `pnpm check && pnpm test:e2e`
4. **Push** and open PR using the template
5. **Review** — address feedback, keep commits clean (squash if needed)
6. **Merge** — fast-forward preferred; PR auto-closes linked issue

### PR Requirements
- `pnpm check` passes
- `pnpm test:e2e` passes
- No new gitleaks/Trivy findings
- Docs updated if user-facing change
- Conventional commit messages

## Architecture Overview

```
ECHO (this repo)
├── src/server/     # Node 24 + Hono: auth, Navidrome proxy, lyrics, palette, queue
├── src/client/     # React 19 shell + Stage (three.js, imperative)
├── src/shared/     # Types, OKLab, YouTube types
├── Android/        # Kotlin, Compose, Media3 (full app)
├── Linux/          # Rust, GTK 4, GStreamer (baseline)
├── Windows/        # C#, Avalonia 12, .NET 10 (baseline)
├── macOS/ iOS/     # Swift, SwiftUI, AVPlayer (baselines)
├── stems/          # Python + ONNX (karaoke stem separation)
├── motion/         # Python + ONNX + ffmpeg (animated covers)
└── docs/           # Source of truth (architecture, plan, criteria)
```

Key docs:
- `docs/TECHNICAL_ARCHITECTURE.md` — system design, stack, data flow
- `docs/IMPLEMENTATION_PLAN.md` — milestones, tasks, progress
- `docs/ACCEPTANCE_CRITERIA.md` — testable criteria (IDs like PLAY-01, LYR-05)
- `docs/SETTINGS_AND_SECURITY.md` — auth, encryption, backup, threat model

## Adding Features

1. Check `docs/IMPLEMENTATION_PLAN.md` for current milestone
2. Review `docs/ACCEPTANCE_CRITERIA.md` for related criteria
3. Follow existing patterns in `src/server/` and `src/client/`
4. Add unit + E2E tests
5. Update relevant docs

## Security

- Never commit secrets (master key, Spicy Lyrics key, tokens)
- Run `pnpm audit --prod --audit-level high` regularly
- Report vulnerabilities to **security@folk3s.com** (see `SECURITY.md`)

## License

AGPL-3.0-only. By contributing, you agree your contributions are licensed under AGPL-3.0.

## Questions?

Open a [Discussion](https://github.com/folk3s/echo/discussions) or check existing issues.