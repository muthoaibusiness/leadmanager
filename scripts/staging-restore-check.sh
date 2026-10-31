#!/usr/bin/env bash
# Restore rehearsal for CR-001 (docs/runbooks/cr001-staging-and-auth.md, step 2).
# Loads a pg_dump backup (schema.sql + data.sql) into a NON-production
# Postgres, removes live credentials from the copy, re-applies 0053, and
# compares row counts with the dump. Read-only on the backup files.
#
#   STAGING_DB_URL=postgresql://...  BACKUP_DIR=~/wepro-backups/<stamp> \
#   CONFIRM_TARGET=<host:port of STAGING_DB_URL> scripts/staging-restore-check.sh
#
# Refuses: the production project ref anywhere in the URL, a missing
# CONFIRM_TARGET, or a target whose public schema already has tables (it never
# drops anything: point it at an empty database).
set -euo pipefail

PROD_REF="sbqmougcvnplgjgihpwe"
: "${STAGING_DB_URL:?set STAGING_DB_URL}"
: "${BACKUP_DIR:?set BACKUP_DIR}"
: "${CONFIRM_TARGET:?set CONFIRM_TARGET to the host:port of STAGING_DB_URL}"
case "$STAGING_DB_URL" in *"$PROD_REF"*) echo "refusing: STAGING_DB_URL names the production project" >&2; exit 1;; esac
host_port=$(printf '%s' "$STAGING_DB_URL" | sed -E 's#^[a-z]+://([^@]*@)?([^/?]+).*#\2#')
[ "$host_port" = "$CONFIRM_TARGET" ] || { echo "refusing: CONFIRM_TARGET $CONFIRM_TARGET does not match $host_port" >&2; exit 1; }

cd "$BACKUP_DIR"
sha256sum -c SHA256SUMS
existing=$(psql "$STAGING_DB_URL" -Atc "select count(*) from pg_tables where schemaname='public'")
[ "$existing" = "0" ] || { echo "refusing: target already has $existing public tables; use an empty database" >&2; exit 1; }
cd - >/dev/null

echo "== schema"; psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -q -f "$BACKUP_DIR/schema.sql"
echo "== data (public schema only; Auth and Storage rows are not restored)"
tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
python3 - "$BACKUP_DIR/data.sql" > "$tmp" <<'PY'
import sys
with open(sys.argv[1], encoding='utf-8') as f:
    in_copy = keep = False
    for line in f:
        if in_copy:
            if keep: sys.stdout.write(line)
            if line.rstrip('\n') == '\\.': in_copy = False
            continue
        if line.startswith('COPY '):
            in_copy, keep = True, line.startswith('COPY "public".')
            if keep: sys.stdout.write(line)
            continue
        if line.startswith('SELECT pg_catalog.setval('):
            if "'\"public\"." in line: sys.stdout.write(line)
            continue
        if line.startswith(('SET ', 'SELECT pg_catalog.set_config', 'RESET')): sys.stdout.write(line)
PY
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -q -f "$tmp"

echo "== remove live credentials and outbound switches from the copy"
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
update public.wa_secrets set api_token = null, webhook_secret = null;
update public.wa_bot_settings set meta_capi_enabled = false;
update public.ai_model_configs set key_secret_id = null, key_last4 = null, key_host = null;
update public.wa_settings set relay_url = '';
SQL

echo "== re-apply 0053 (the dump was taken while the dashboard lockdown was on)"
psql "$STAGING_DB_URL" -v ON_ERROR_STOP=1 -q -f supabase/migrations/0053_revert_dashboard_rls_lockdown.sql

echo "== row counts: dump vs restored"
fail=0
while IFS= read -r t; do
  dump=$(awk -v t="COPY \"public\".\"$t\" " 'index($0,t)==1{c=1;next} c&&/^\\\.$/{print n+0; exit} c{n++}' "$BACKUP_DIR/data.sql")
  got=$(psql "$STAGING_DB_URL" -Atc "select count(*) from public.\"$t\"")
  [ "${dump:-0}" = "$got" ] || { echo "MISMATCH $t dump=${dump:-0} restored=$got"; fail=1; }
done < <(psql "$STAGING_DB_URL" -Atc "select tablename from pg_tables where schemaname='public' order by 1")
for t in users leads activities teams companies notifications; do printf '%-14s %s\n' "$t" "$(psql "$STAGING_DB_URL" -Atc "select count(*) from public.$t")"; done
echo "users RLS: $(psql "$STAGING_DB_URL" -Atc "select relrowsecurity from pg_class where oid='public.users'::regclass") (expect f after 0053)"
echo "live tokens left: $(psql "$STAGING_DB_URL" -Atc "select count(*) from public.wa_secrets where coalesce(api_token,'')<>''") (expect 0)"
echo "Meta CAPI on: $(psql "$STAGING_DB_URL" -Atc "select count(*) from public.wa_bot_settings where meta_capi_enabled") (expect 0)"
[ "$fail" = 0 ] && echo "RESTORE CHECK PASS" || { echo "RESTORE CHECK FAIL"; exit 1; }
