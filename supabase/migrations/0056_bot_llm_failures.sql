-- 0056 — bot LLM failure ledger. Each OpenRouter/provider failure in a bot's
-- AI turn is recorded here by the Edge Functions (service role only) so
-- failures can be counted and alerted on without reading bot logs.
--
-- RLS on, no anon/authenticated grant, service role only. Safe to re-run.
create table if not exists public.bot_llm_failures (
  id bigint generated always as identity primary key,
  bot text,
  kind text not null,               -- auth | provider | parse | network
  status int,
  message text,
  created_at timestamptz not null default now()
);

alter table public.bot_llm_failures enable row level security;

revoke all on public.bot_llm_failures from public, anon, authenticated;
grant select, insert on public.bot_llm_failures to service_role;
