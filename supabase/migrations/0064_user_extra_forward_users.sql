-- 0064 — Let an account forward leads to specific agents outside its own team.
--
-- The Forward modal lists the people on the user's own team. extra_forward_user_ids adds the users named
-- here (user ids). Set per account, e.g. Barna (Marketing) can hand a lead to the four /fctg "initial" agents:
--   update users set extra_forward_user_ids = '["ux5b3euqcmoik96ib","ux6qk0dc6moil06m5","uxc8lz4f8mqqfjry6","uxoi9julpmoila7pj"]'::jsonb
--   where lower(email) = 'barna@p2p.com';
-- (Nasrin, Jannat, Afrina Rashid = the old "Maruf (intial)" account, and Any.)
-- Additive and safe to re-run. The app reads it on its own, so it works before this is run (no extra targets).
alter table public.users add column if not exists extra_forward_user_ids jsonb;
