-- Renumbered from 0037_wa_followup_flow.sql, which shared 0037 with
-- 0037_ai_trainer.sql. Already applied to production by hand (not recorded in
-- supabase_migrations.schema_migrations); every statement is idempotent, so
-- running it again is a no-op.

-- Staged post-greeting follow-up flow (greeting -> ask/auto profile -> ask agent).
-- flow_stage: null | 'greeted' | 'asked_profile' | 'profile_sent' | 'asked_agent'.
-- stage_at: when the current stage was entered (the cron job's wait clock).
-- stage_msg_count: message_logs length snapshot taken at that same moment,
-- so the follow-up job can tell "no reply since" from "customer kept texting"
-- without a separate counter table.
alter table preleads add column if not exists flow_stage text;
alter table preleads add column if not exists stage_at timestamptz;
alter table preleads add column if not exists stage_msg_count int default 0;
