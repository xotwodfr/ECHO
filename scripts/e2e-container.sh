#!/usr/bin/env bash
# Runs the E2E suite the way CI's e2e job does: in Playwright's pinned Ubuntu 24.04 image, under
# xvfb-run (so Firefox gets WebGL 2 on llvmpipe). Works on a copy of the tree (tracked and new
# files), so the host's node_modules and test-results are left alone.
#   scripts/e2e-container.sh [playwright args…]
set -euo pipefail
image=mcr.microsoft.com/playwright:v1.64.0-noble@sha256:06a9939e57531807f8d5fd76ce44b53165ffb7d7501d87ab10e285c20b1e971f
root=$(cd "$(dirname "$0")/.." && pwd)
work=${ECHO_E2E_DIR:-${TMPDIR:-/tmp}/echo-e2e}
mkdir -p "$work/tree" "$work/home"
# Mirror the tree; node_modules inside the copy are the container's own and survive between runs.
(cd "$root" && git ls-files -co --exclude-standard -z) |
  rsync -a --delete --from0 --files-from=- --exclude node_modules "$root/" "$work/tree/"
# --init: as PID 1, xvfb-run never receives the "server ready" signal from Xvfb and hangs.
docker run --rm --init --user "$(id -u):$(id -g)" --ipc=host -e CI=1 -e HOME=/home/ci \
  -v "$work/tree:/repo" -v "$work/home:/home/ci" -w /repo "$image" bash -c '
    set -e
    mkdir -p /home/ci/bin && corepack enable --install-directory /home/ci/bin pnpm
    export PATH=/home/ci/bin:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
    pnpm install --frozen-lockfile --reporter=silent
    xvfb-run -a pnpm exec playwright test "$@"' bash "$@"
