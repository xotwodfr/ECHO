#!/usr/bin/env bash
# SEC-10 exception gate (docs/reviews/M1-SEC-10-exception.md). Input: a Trivy JSON report of ALL
# high/critical findings, fixed and unfixed. Fails on any finding that is not on the accepted list,
# so a new CVE, a CRITICAL, or a package version change (base-image rebuild) forces reassessment.
# It never reports SEC-10 as passing: accepted findings are listed, not hidden.
#   scripts/sec10-exception-check.sh trivy-all.json
set -euo pipefail

list="$(dirname "$0")/../docs/reviews/M1-SEC-10-exception.txt"
found=$(jq -r '.Results[]?.Vulnerabilities[]? | "\(.Severity) \(.VulnerabilityID) \(.PkgName) \(.InstalledVersion)"' "$1" | sort -u)
accepted=$(grep -v -e '^#' -e '^$' "$list" | sort -u)

new=$(comm -23 <(printf '%s\n' "$found" | sed '/^$/d') <(printf '%s\n' "$accepted"))
gone=$(comm -13 <(printf '%s\n' "$found" | sed '/^$/d') <(printf '%s\n' "$accepted"))
count=$(printf '%s\n' "$found" | sed '/^$/d' | wc -l)

while read -r f; do [ -n "$f" ] && echo "::error::Not covered by the SEC-10 exception: $f"; done <<<"$new"
while read -r f; do [ -n "$f" ] && echo "::notice::No longer reported, shrink the SEC-10 exception: $f"; done <<<"$gone"

if [ -n "$new" ]; then
  status="FAIL: $(printf '%s\n' "$new" | wc -l) finding(s) outside the accepted exception"
elif [ "$count" -eq 0 ]; then
  status="no high/critical findings left: retire the exception and re-check SEC-10"
else
  status="ACCEPTED EXCEPTION, NOT PASS: $count unfixed HIGH finding(s) accepted until the M9 re-check"
fi
echo "::warning::SEC-10 (zero high/critical): $status. See docs/reviews/M1-SEC-10-exception.md"
[ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "**SEC-10:** $status ([exception](docs/reviews/M1-SEC-10-exception.md))" >>"$GITHUB_STEP_SUMMARY"
[ -z "$new" ]
