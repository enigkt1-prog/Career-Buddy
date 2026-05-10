#!/usr/bin/env bash
# Hard-reload curl smoke for the Cloudflare Workers SPA fallback.
# Hits /, /profile, /cv, /buddy, /jobs and asserts each returns 200.
#
# Tests the deployed Worker's SPA routing — NOT the Vite dev server.
# Vite's preview already serves index.html for any unknown path; the
# Worker uses an explicit assetManifest fallback that we want to keep
# under regression coverage.
#
# Usage:
#   bash scripts/smoke-routes.sh                              # default localhost:8788
#   bash scripts/smoke-routes.sh https://career-buddy.enigkt1.workers.dev
#
# Pre-req: a running worker (`bun run dev:worker` for local, or the
# live Cloudflare deploy URL).
set -euo pipefail

BASE_URL="${1:-http://localhost:8788}"
ROUTES=("/" "/profile" "/cv" "/buddy" "/jobs")
fail=0

echo "→ Smoke-testing $BASE_URL"
for r in "${ROUTES[@]}"; do
  status=$(curl -s -o /dev/null -L -w "%{http_code}" "$BASE_URL$r")
  if [[ "$status" == "200" ]]; then
    printf "  ✓ %-10s HTTP %s\n" "$r" "$status"
  else
    printf "  ✗ %-10s HTTP %s\n" "$r" "$status"
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  echo "✗ smoke failed — at least one route did not return 200."
  exit 1
fi
echo "✓ all routes returned 200."
