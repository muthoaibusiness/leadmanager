# Porting the Meta ad-spend statement to another project

How WEPRO's "Meta invoice" works today, and how to rebuild only that part in a new project.

## 1. What it is

In WEPRO, a Meta statement is an **internal record of a Meta ad charge**. Its layout follows
Meta's own receipt (`Invoice-templates/Meta.pdf`) so it is easy to check against that receipt,
but it never claims to be Meta's document:

- The heading reads "Ad spend statement for <client>".
- The footer says "Prepared by WEPRO from Meta receipt."
- Any ID that WEPRO generated, not copied from Meta, prints under a "WEPRO internal …" label.
- A generated invoice number is always `WEPRO-INV-…`, never Meta's `FBADS-…` format.

Keep all four in the new project (see section 8). Without them, the output reads as a
counterfeit Meta receipt.

It lives inside the wider Finance module (budgets → expenses → statements). The new project
only needs the statement part, so the budget and expense links are optional below.

## 2. Where it lives in WEPRO

| Piece | File |
|---|---|
| Tables | `supabase/migrations/0023_finance.sql` (statements, lines, events), `0024` (category, `extra` on lines, append-only history), `0025` (unique number), `0026` and `0027` (issued-ID registry) |
| Server logic | `supabase/functions/_shared/finance-core.ts`: `layoutFrom`, `linesFrom`, `statementIds`, `invoiceSave`, `invoiceFinalize`, `invoiceShare`, `sharePage` |
| Edge Function entry | `supabase/functions/finance/index.ts` |
| Template and renderer (shared by preview, PDF and share page) | `supabase/functions/_shared/finance-doc.js`: `TEMPLATES.meta`, `adSpend()`, `renderStatement`, `paginateDoc`, ID generators, `adSetExtra` |
| Meta logo | `supabase/functions/_shared/logos/meta.js` (SVG source in `Invoice-templates/logos/`) |
| Editor | `src/components/finance/forms.jsx`: `AdCampaigns`, the Meta IDs block, CPM and billing fields |
| Preview and print | `src/components/finance/DocPreview.jsx` (iframe plus `paginateDoc`) |
| Sample receipt | `Invoice-templates/Meta.pdf` |

## 3. How it works, end to end

1. The user creates a statement and picks the category **Meta**. `templateForCategory('Meta')`
   returns `meta`, which loads the template defaults: USD, CPM 0.73, payment method "Prepaid
   balance", product type "Meta ads", a one-month period, and one empty campaign.
2. The user fills in the editor from the Meta receipt:
   - client name (Bill to), Account ID, payment date and time, payment method
   - Transaction ID, Reference ID and Invoice no.: pasted from the receipt, or left as the
     generated internal ones
   - billing amount, CPM, and the service period (from and to, plus an end time)
   - **campaigns**, each with its **ad sets** (a name and an amount each)
3. Impressions for each ad set are `round(1000 × amount ÷ CPM)` and marked estimated (`est:
   true`). Typing the real number from the receipt replaces the estimate (`est: false`), and
   clearing it brings the formula back. The server recomputes this on save (`adSetExtra`), so
   stored impressions always match the stored amount and CPM.
4. **Save** (server action `invoice.save`):
   - It cleans up the layout (`layoutFrom`) and the lines (`linesFrom`).
   - A new statement gets the next number after this year's highest: `EXP-2026-0001`. A unique
     index turns two saves at the same moment into an error instead of a duplicate.
   - **ID issuing** (`statementIds`): on the first save as Meta, the three IDs are written to
     `finance_statement_ids`, keyed `'<kind>:<value>'`. A value can be issued **once, ever**,
     across all companies. The rows are append-only, so even a deleted draft's IDs stay taken.
     - A generated ID that turns out to be taken is regenerated and retried, up to 5 times.
     - A typed ID that is already taken is refused (409, naming the statement that holds it).
     - All the IDs go in one insert, so either all are issued or none is.
     - From then on the IDs come from the table, whatever the editor sends.
       `layout.issuedIds` tells the editor to lock those fields.
   - The category is locked once saved, and a final statement can't be edited.
5. **Finalize** (`invoice.finalize`): it refuses if a line no longer matches its linked expense
   (`staleLines`; BDT only), then sets `status = FINAL` and creates a `share_token`.
6. **Share** (`invoice.share`): this returns `…/functions/v1/finance?share=<token>`. The
   function serves that link as a public HTML page with a Print / Save as PDF button. Passing
   `rotate: true` makes a new token, which kills the old link.
7. **One renderer:** `renderStatement(statementDoc(...))` draws the in-app preview (in an
   iframe), the printed PDF and the share page, so all three are identical page for page.
   `paginateDoc` splits long campaign lists across A4 pages and repeats a campaign's header
   with "(continued)".
8. Every change writes an append-only `finance_events` row. A trigger blocks UPDATE, DELETE
   and TRUNCATE on that table, including for the service role.

## 4. Data model for a standalone project

This is a trimmed version of WEPRO's tables, without budgets. Add `budget_id` and `expense_id`
back if the new project has them.

```sql
create table public.meta_statements (
  id            text primary key,
  company_id    text not null,
  number        text not null,                      -- EXP-2026-0001
  status        text not null default 'DRAFT',      -- DRAFT | FINAL
  title         text not null default 'Meta ads',
  issued_on     date,
  bill_to       text not null default '',           -- first line = client name in the heading
  notes         text not null default '',
  layout        jsonb not null default '{}'::jsonb, -- see "layout fields" below
  share_token   text unique,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  finalized_at  timestamptz
);
create unique index meta_statements_company_number_key on public.meta_statements (company_id, number);

create table public.meta_statement_lines (          -- one row per AD SET
  id            text primary key,
  company_id    text not null,
  statement_id  text not null references public.meta_statements (id) on delete cascade,
  position      integer not null default 0,
  description   text not null default '',           -- ad set name
  qty           numeric not null default 1,         -- always 1 for ad sets
  unit_price    numeric not null default 0,         -- ad set amount
  extra         jsonb not null default '{}'::jsonb  -- { campaign, cid, impressions, cpm, est }
);

create table public.meta_statement_ids (            -- each ID issued once, ever
  id              text primary key,                 -- '<kind>:<value>'
  kind            text not null check (kind in ('transaction', 'reference', 'invoice')),
  value           text not null,
  company_id      text not null,
  statement_id    text not null,                    -- no FK: the row outlives a deleted draft
  statement_number text,
  source          text not null check (source in ('generated', 'receipt')),
  issued_by       text,
  issued_at       timestamptz not null default now()
);

create table public.meta_statement_events (         -- append-only audit trail
  id text primary key, company_id text not null, statement_id text not null,
  action text not null, data jsonb not null default '{}'::jsonb,
  user_id text, at timestamptz not null default now()
);

alter table public.meta_statements       enable row level security;  -- no policies:
alter table public.meta_statement_lines  enable row level security;  -- only the Edge Function
alter table public.meta_statement_ids    enable row level security;  -- (service role) reads
alter table public.meta_statement_events enable row level security;  -- or writes them
```

To make `meta_statement_ids` and `meta_statement_events` append-only, copy the
`finance_history_append_only()` trigger function and its triggers from migration 0024.

**Layout fields** (`layout` jsonb):
`template: 'meta'`, `currency` (USD), `accountId`, `paidOn`, `paidTime` (HH:MM),
`paymentMethod`, `productType`, `vendorRef` (Transaction ID), `paymentRef` (Reference ID),
`invoiceNo`, `vendorRefGen`, `paymentRefGen` and `invoiceNoGen` (true means generated, so it
prints as internal), `cpm`, `billingAmount`, `periodFrom`, `periodTo`, `periodToTime`,
`footer`, and `issuedIds` (set by the server only).

## 5. Server API

Use one Edge Function: POST `{ action, payload }` with the user's session, and GET
`?share=<token>` for the public page. Deploy it with `--no-verify-jwt` and check the session
yourself; WEPRO's `_shared/actor.ts` shows how.

| Action | Does |
|---|---|
| `statement.list` | The company's statements, with lines and share URLs |
| `statement.save` | Create or update a draft: clean the layout and lines, number it, issue IDs, log an event |
| `statement.finalize` | DRAFT to FINAL, create the share token |
| `statement.share` | Return the share URL; `rotate: true` makes a new token |
| `statement.delete` | Drafts only. Issued IDs stay taken |

Rules to keep on the server, not in the browser:
- Validate every field: length caps, `YYYY-MM-DD` dates, `HH:MM` times, no negative amounts,
  the period can't end before it starts, and at most 200 lines.
- Recompute impressions from the amount and CPM (`adSetExtra`); never trust the browser's
  number unless it is marked `est: false`.
- Run the ID-issuing logic exactly as in `statementIds` (section 3, step 4).
- Get the number as max + 1, not as a count (a count repeats once a draft is deleted), and
  rely on the unique index to catch a clash.

## 6. ID formats

These come from `finance-doc.js`:

```js
newReferenceId   = () => 10 random chars from A–Z0–9         // REFERENCE_ID_RE = /^[A-Z0-9]{10}$/
newTransactionId = () => `${digits(17)}-${digits(17)}`        // TRANSACTION_ID_RE = /^[1-9]\d{16}-[1-9]\d{16}$/
newInvoiceNo     = () => `WEPRO-INV-${digits(9)}`             // INVOICE_NO_RE = /^WEPRO-INV-[1-9]\d{8}$/
```

Use `crypto.getRandomValues` for these, never `Math.random`. Change the `WEPRO` prefix to the
new project's own name.

## 7. Renderer: the `adSpend` layout

Port `finance-doc.js` (it is plain JS that runs in Deno, Node and Vite). The parts you need:

- `TEMPLATES.meta`: vendor block (Meta Platforms Ireland Limited, Merrion Road, Dublin 4, D04
  X2K5, Ireland), the "to" lines, the accent `#0866FF`, the logo, and the defaults.
- `statementDoc()`: turns the database rows into one plain object for the renderer.
- `adSpend(d, t)`, from top to bottom:
  - **Header:** "Ad spend statement for <client>", the Account ID, and the Meta logo on the right.
  - **Payment block:** payment date and time, payment method with its reference number,
    Transaction ID, and product type. On the right, a large "Paid <total>" and "Ads spend
    since <from>".
  - **Campaigns:** ad sets grouped by `extra.campaign`. Each campaign shows its name, its
    period ("From 1 Oct 2026, 00:00 to 31 Oct 2026, 23:59") and its total. Each ad set row
    shows its name, impressions (with "(est.)" when estimated) and amount.
  - **Footer:** the vendor address on the left, the "to" lines and the invoice number on the
    right, then "Prepared by <you> from Meta receipt."
- `renderStatement(doc, { chrome })`: the full HTML page. `chrome: true` adds the
  print bar and the pagination script (used for the share page).
- `paginateDoc()`: A4 pagination driven by `data-pg` attributes (`keep`, `list`, `group`,
  `tail`), with a repeated "(continued)" campaign header.
- Helpers: `fmtMoney`, `docDate`, `time12`, `esc`. Escape every text value, and check the
  accent colour against a hex pattern.

In the browser, put the same HTML in an `<iframe srcdoc>` for the preview, then call
`iframe.contentWindow.print()` to make a PDF. No PDF library is needed. See `DocPreview.jsx`.

## 8. Safeguards to keep

These are what make it a legitimate internal record and not a copy of a Meta receipt:

1. The heading is your own ("Ad spend statement for …"), never "Receipt" or "Invoice" in
   Meta's name.
2. The footer always says "Prepared by <your company> from Meta receipt."
3. Generated IDs print under "<You> internal transaction ref." / "internal reference" /
   "internal invoice no.". Only values copied from Meta's real receipt print under Meta's own
   labels.
4. A generated invoice number never uses `FBADS-`.
5. Estimated impressions print with "(est.)".
6. An ID is used once, ever (the registry), so no two statements can share one.
7. Final statements can't be edited; corrections are new events, not edits.

## 9. Build order

1. Write the migration (section 4) and the append-only trigger.
2. Copy `finance-doc.js` and `logos/meta.js`. Keep only `default` and `meta` in `TEMPLATES`,
   `adSpend`, `renderStatement`, `paginateDoc` and the helpers.
3. Write the Edge Function: session check, `save`, `finalize`, `share`, `delete`, and the
   share page. Port `layoutFrom`, `linesFrom`, `statementIds` and the numbering from
   `finance-core.ts`.
4. Build the editor: header fields, the IDs block (locked once `issuedIds` is set), CPM and
   billing amount, period buttons, campaign cards with their ad sets (`AdCampaigns`), and the
   live preview iframe.
5. Build the list page: number, client, total, Draft/Final, and Share / Print / Delete.
6. Write tests (WEPRO's run under `node --test`):
   - impressions math, and an estimate replaced by a typed number
   - each ID format against its regex
   - a taken typed ID is refused, and a taken generated ID is retried
   - numbering after a deleted draft
   - a final statement is read-only
   - text is escaped in the renderer
   - a long campaign list paginates
7. Deploy the database first, then the function, then the app.

## 10. Simplifications worth making

- Without budgets and expenses, drop `staleLines`, the payment status and the budget footer.
- One currency (USD) is enough for Meta; keep `fmtMoney` general anyway.
- If statements are never shared publicly, skip `share_token` and the GET page; Print / PDF
  from the iframe still works.
