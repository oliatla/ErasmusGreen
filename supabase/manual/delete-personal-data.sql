-- ============================================================
-- Run ONCE, by hand, in the Supabase SQL editor when the translation
-- phase is over — at the latest 31 January 2027.
-- NOT a migration: it must never run automatically.
--
-- Before running: export the corrections into the JSON files
--   node tools/reader.mjs from-supabase
-- and commit them. The corrections themselves stay in the database,
-- without any link to a person.
-- ============================================================

begin;

-- every translator's sign-in account; profiles go with it (cascade),
-- corrections, history, reviews and notes keep their text but lose the person
delete from auth.users where id in (select user_id from public.translators);

-- any account that signed up but never finished its profile
delete from auth.users u
where not exists (select 1 from public.translators t where t.user_id = u.id);

commit;

-- check: should be 0 and 0
select (select count(*) from auth.users) as accounts, (select count(*) from public.translators) as profiles;
