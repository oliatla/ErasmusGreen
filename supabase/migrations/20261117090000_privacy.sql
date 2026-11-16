-- ============================================================
-- GREEN translations — privacy
--
-- * Translators see only their OWN profile row (name, email). Others
--   see a display name through translator_names, and only if the
--   translator chose to show it; otherwise "anonymous" + language.
-- * Consent is recorded (consented_at).
-- * "Delete me": a translator removes their account. Their corrections
--   stay (they are part of the worksheets) but no longer point to a
--   person — only the language remains.
-- * All personal data is deleted after the translation phase, at the
--   latest 31 January 2027 (supabase/manual/delete-personal-data.sql).
-- ============================================================

alter table public.translators
  add column anonymous    boolean not null default true,     -- privacy by default: name hidden from others
  add column consented_at timestamptz;

-- profiles: your own row only (it holds your email)
drop policy "read translators" on public.translators;
create policy "read own profile" on public.translators for select to authenticated
  using (user_id = auth.uid());
grant update (name, lang, anonymous, consented_at) on public.translators to authenticated;

-- the names other translators may see (null = anonymous)
create view public.translator_names as
  select user_id, lang, case when anonymous then null else name end as name
  from public.translators where not blocked;
revoke all on public.translator_names from anon, public;
grant select on public.translator_names to authenticated;

-- when an account is deleted, its corrections stay but lose the link to the person
alter table public.translations drop constraint translations_updated_by_fkey,
  add constraint translations_updated_by_fkey foreign key (updated_by) references auth.users on delete set null;
alter table public.revisions drop constraint revisions_changed_by_fkey,
  add constraint revisions_changed_by_fkey foreign key (changed_by) references auth.users on delete set null;
alter table public.reviews drop constraint reviews_reviewed_by_fkey,
  add constraint reviews_reviewed_by_fkey foreign key (reviewed_by) references auth.users on delete set null;
alter table public.notes drop constraint notes_author_fkey,
  add constraint notes_author_fkey foreign key (author) references auth.users on delete set null;

-- "Delete me": removes the sign-in account and the profile (cascade)
create function public.delete_me() returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;
revoke all on function public.delete_me() from public, anon;
grant execute on function public.delete_me() to authenticated;
