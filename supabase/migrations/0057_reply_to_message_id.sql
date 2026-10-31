-- Reply correlation (migration 0057). Additive: adds one nullable column to
-- wa_messages. Links an outbound bot/agent reply back to the inbound trigger
-- it answers, so a transcript can show the pairing. Nullable: legacy rows and
-- automated sends with no single trigger keep NULL. No backfill — linkage is
-- only written by senders that know the exact inbound message id, never guessed.
alter table public.wa_messages
  add column if not exists reply_to_message_id text;
create index if not exists wa_messages_reply_to_idx
  on public.wa_messages (conversation_id, reply_to_message_id);
