-- 0023 · Finance: internal budgets, expenses and expense statements
-- (Admin → Inventory). Internal money only — not property inventory and not
-- customer billing.
--
-- Requested, approved, committed and spent are kept as SEPARATE records:
--   finance_budgets           the envelope and its workflow status
--   finance_budget_requests   one immutable row per submitted version
--   finance_budget_approvals  one row per decision (the only source of an
--                             approved amount)
--   finance_expenses          one row per spend line, kind COMMITTED or PAID
-- so a requested figure can never read as approved, and an expense is never
-- counted twice (it moves from COMMITTED to PAID in place).
--
-- Access: row level security is ON and there is deliberately NO policy for
-- anon or authenticated. Only the service role — i.e. the `finance` Edge
-- Function — can read or write these tables. The browser never talks to them
-- over PostgREST. See supabase/functions/finance.
--
-- Safe to run more than once. Apply in the Supabase SQL editor.

create table if not exists public.finance_budgets (
  id               text primary key,
  company_id       text not null,
  title            text not null,
  purpose          text not null default '',
  notes            text not null default '',
  property_id      text,                       -- project (properties.id), optional
  property_name    text not null default '',
  team_id          text,                       -- responsible team (teams.id), optional
  team_name        text not null default '',
  draft_amount     numeric not null default 0, -- the figure being prepared; becomes a request on submit
  status           text not null default 'DRAFT', -- DRAFT | SUBMITTED | APPROVED | REJECTED | REVISION
  created_by       text,
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists finance_budgets_company_idx on public.finance_budgets (company_id, status);

create table if not exists public.finance_budget_requests (
  id                 text primary key,
  company_id         text not null,
  budget_id          text not null references public.finance_budgets (id) on delete cascade,
  version            integer not null,
  requested_amount   numeric not null,
  note               text not null default '',
  submitted_by       text,
  submitted_by_name  text not null default '',
  submitted_at       timestamptz not null default now(),
  unique (budget_id, version)
);

create table if not exists public.finance_budget_approvals (
  id               text primary key,
  company_id       text not null,
  budget_id        text not null references public.finance_budgets (id) on delete cascade,
  request_id       text not null references public.finance_budget_requests (id) on delete cascade,
  decision         text not null,              -- APPROVED | REJECTED | REVISION
  approved_amount  numeric,                    -- APPROVED only; may differ from the requested amount
  note             text not null default '',
  decided_by       text,
  decided_by_name  text not null default '',
  decided_at       timestamptz not null default now()
);
create index if not exists finance_budget_approvals_budget_idx on public.finance_budget_approvals (budget_id, decided_at);

create table if not exists public.finance_expenses (
  id              text primary key,
  company_id      text not null,
  budget_id       text not null references public.finance_budgets (id) on delete cascade,
  amount          numeric not null,
  spent_on        date not null,
  category        text not null default '',
  description     text not null default '',
  payment_method  text not null default '',
  kind            text not null default 'PAID', -- COMMITTED (ordered, not yet paid) | PAID (actual)
  spent_by        text,                         -- responsible team member (users.id)
  spent_by_name   text not null default '',
  lead_id         text,                         -- optional link to a lead / customer
  lead_name       text not null default '',
  property_id     text,                         -- optional link to a project
  property_name   text not null default '',
  attachments     jsonb not null default '[]'::jsonb, -- [{ path, name, mime, size }] in the finance-media bucket
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists finance_expenses_budget_idx on public.finance_expenses (budget_id, spent_on);

create table if not exists public.finance_invoices (
  id               text primary key,
  company_id       text not null,
  budget_id        text not null references public.finance_budgets (id) on delete cascade,
  number           text not null,
  title            text not null default 'Expense statement',
  status           text not null default 'DRAFT', -- DRAFT | FINAL
  issued_on        date,
  from_name        text not null default '',
  bill_to          text not null default '',
  notes            text not null default '',
  layout           jsonb not null default '{}'::jsonb, -- { accent, showQty, showUnit, footer }
  share_token      text unique,                 -- unguessable; the public statement page key
  created_by       text,
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  finalized_at     timestamptz
);
create index if not exists finance_invoices_budget_idx on public.finance_invoices (budget_id);

create table if not exists public.finance_invoice_lines (
  id           text primary key,
  company_id   text not null,                   -- denormalised, so every finance table filters the same way
  invoice_id   text not null references public.finance_invoices (id) on delete cascade,
  expense_id   text references public.finance_expenses (id) on delete set null,
  is_final     boolean not null default false,  -- mirrors the invoice status, for the index below
  position     integer not null default 0,
  description  text not null default '',
  qty          numeric not null default 1,
  unit_price   numeric not null default 0
);
-- An expense can sit on at most ONE final statement.
create unique index if not exists finance_invoice_lines_one_final_per_expense
  on public.finance_invoice_lines (expense_id) where is_final and expense_id is not null;

create table if not exists public.finance_comments (
  id           text primary key,
  company_id   text not null,
  entity_type  text not null,                   -- budget | expense | invoice
  entity_id    text not null,
  body         text not null,
  mentions     jsonb not null default '[]'::jsonb, -- [users.id]
  attachments  jsonb not null default '[]'::jsonb, -- [{ path, name, mime, size }]
  user_id      text,
  user_name    text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists finance_comments_entity_idx on public.finance_comments (entity_type, entity_id, created_at);

-- Append-only audit trail of every change and decision.
create table if not exists public.finance_events (
  id           text primary key,
  company_id   text not null,
  entity_type  text not null,
  entity_id    text not null,
  action       text not null,                   -- created | updated | submitted | decided | deleted | finalized | shared | …
  data         jsonb not null default '{}'::jsonb,
  user_id      text,
  user_name    text not null default '',
  at           timestamptz not null default now()
);
create index if not exists finance_events_entity_idx on public.finance_events (entity_type, entity_id, at);

-- Lock every finance table down to the service role.
alter table public.finance_budgets          enable row level security;
alter table public.finance_budget_requests  enable row level security;
alter table public.finance_budget_approvals enable row level security;
alter table public.finance_expenses         enable row level security;
alter table public.finance_invoices         enable row level security;
alter table public.finance_invoice_lines    enable row level security;
alter table public.finance_comments         enable row level security;
alter table public.finance_events           enable row level security;

-- Receipts and attachments: a PRIVATE bucket. The Edge Function uploads with
-- the service role and hands out short-lived signed URLs; nothing is public.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('finance-media', 'finance-media', false, 10485760,
        array['image/png', 'image/jpeg', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
