-- 2026-11-12 — Move 11 accounts to their official email addresses.
-- Run in the Supabase SQL editor (one run). The users_sync_auth_email trigger
-- (migration 0070) copies each new email to the account's sign-in (auth.users),
-- so CRM and login change together. From now on each person signs in with the
-- NEW email; the password stays the same. Matched by account id, not by name.
-- Already correct, not touched: Obaidullah Bin Faruk, Any.

begin;
update public.users set email = 'hillol.chy@wecon.com.bd'       where id = 'uxq7rggalmoil8gzg'; -- Hillol Chowdhury   (was hillolchowdhury844@gmail.com)
update public.users set email = 'md.mashud@p2pfamily.com'       where id = 'ux5j3ti0qmoigze60'; -- Masud Chowdhury    (was weconmashud@gmail.com)
update public.users set email = 'shabbir.newaz@wecon.com.bd'    where id = 'ux703jvd0moih02qu'; -- Shabbir Newaz      (was Rawa8414@gmail.com)
update public.users set email = 'maruful.alam@wecon.com.bd'     where id = 'uxmapzew2moih1lay'; -- Maruf Alam         (was marufulbd@gmail.com)
update public.users set email = 'parves.uddin@wecon.com.bd'     where id = 'uxbhghgm1moil2yyl'; -- Parvez             (was md.parvesuddin1989@gmail.com)
update public.users set email = 'shariful.shoaib@wecon.com.bd'  where id = 'ux1nozxggmoikc9kq'; -- Shoaib             (was sharifulislam.shoaib95@gmail.com)
update public.users set email = 'mohidul.islam@wecon.com.bd'    where id = 'uxbqs1taimoilp3ur'; -- Mohidul            (was mohidul.wecon@gmail.com)
update public.users set email = 'kamrul.islam@wecon.com.bd'     where id = 'uxl45jk7emo6692jz'; -- Kamrul Shikdar     (was kamrul@wecon.com.bd)
update public.users set email = 'afrina.rashid@wecon.com.bd'    where id = 'uxc8lz4f8mqqfjry6'; -- Afrina Rashid      (was Maruf.intial@gmail.com)
update public.users set email = 'shamima.jannat@wecon.com.bd'   where id = 'ux6qk0dc6moil06m5'; -- Jannat             (was shamemajannat@gmail.com)
update public.users set email = 'nasrin.akhter@wecon.com.bd'    where id = 'ux5b3euqcmoik96ib'; -- Nasrin             (was nasrinwecon@gmail.com)
commit;

-- Check: every account, CRM email vs sign-in email. Expect "ok" on every row.
select u.name, u.email as crm_email, a.email as sign_in_email,
       case when lower(a.email) = lower(btrim(u.email)) then 'ok' else 'MISMATCH' end as status
  from public.users u join auth.users a on a.id::text = u.auth_user_id::text
 where u.id in ('uxq7rggalmoil8gzg','ux5j3ti0qmoigze60','ux703jvd0moih02qu','uxmapzew2moih1lay','uxbhghgm1moil2yyl',
                'ux1nozxggmoikc9kq','uxbqs1taimoilp3ur','uxl45jk7emo6692jz','uxc8lz4f8mqqfjry6','ux6qk0dc6moil06m5',
                'ux5b3euqcmoik96ib','ux215biixmqrxj25a','uxoi9julpmoila7pj')
 order by u.name;
