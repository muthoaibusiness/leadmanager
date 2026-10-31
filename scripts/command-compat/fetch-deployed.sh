#!/usr/bin/env bash
# Downloads the deployed wa-bot-eyad and wa-bot-dubai source (read-only) into
# /tmp/deployed for deployed-parity.test.ts. Needs SUPABASE_ACCESS_TOKEN.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?set SUPABASE_ACCESS_TOKEN}"
ref="${SUPABASE_PROJECT_REF:?set SUPABASE_PROJECT_REF}"
rm -rf /tmp/deployed && mkdir -p /tmp/deployed
for f in wa-bot-eyad wa-bot-dubai; do
  npx --no-install supabase functions download "$f" --project-ref "$ref" --use-api --workdir /tmp/deployed >/dev/null
done
echo "downloaded to /tmp/deployed/supabase/functions"
