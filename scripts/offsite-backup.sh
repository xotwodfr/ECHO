#!/usr/bin/env bash
# The newest nightly backup (echo-auto-<date>.db, admin-cli.ts nightlyBackup) copied off the box:
# out of the container, then to an rclone remote, keeping 30 days there. Use a crypt remote: the
# database's secrets are sealed with the master key, but its accounts, plays and the Wanted list
# are not. The master key never goes with it: keep that, and the crypt password, in your password
# manager (docs/SETTINGS_AND_SECURITY.md §11).
#   ECHO_OFFSITE_REMOTE=echo-crypt:backups scripts/offsite-backup.sh
set -euo pipefail
remote=${ECHO_OFFSITE_REMOTE:?set ECHO_OFFSITE_REMOTE, e.g. echo-crypt:backups}
container=${ECHO_CONTAINER:-echo}
keep=${ECHO_OFFSITE_KEEP:-30d}

# The image has no shell: node lists the folder.
name=$(docker exec "$container" /nodejs/bin/node -e \
  "console.log(require('fs').readdirSync('/data/backups').filter((f) => /^echo-auto-\d{4}-\d\d-\d\d\.db$/.test(f)).sort().pop() ?? '')")
[ -n "$name" ] || { echo "no nightly backup in $container:/data/backups" >&2; exit 1; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
docker cp "$container:/data/backups/$name" "$work/$name"
rclone copy "$work/$name" "$remote"
rclone delete "$remote" --min-age "$keep"
echo "copied $name to $remote"
