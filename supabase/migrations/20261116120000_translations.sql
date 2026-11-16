-- ============================================================
-- GREEN translations — review phase
--
-- The worksheets' JSON files (ws/<slug>/lang/<code>.json) stay the
-- baseline: the AI translation. This database only holds what the
-- translators CHANGE, plus who reviewed what. At the end of the phase
-- `node tools/reader.mjs from-supabase` writes the changes back into
-- the JSON files and they are committed to git.
--
-- Keys are content hashes of the English text, so the same English
-- sentence has the same key in every worksheet: a fix is a fix
-- everywhere. That is why translations are keyed by (lang, key) and
-- not by worksheet.
-- ============================================================

-- ---------- translators: who may edit which language ----------
create table public.translators (
  user_id    uuid primary key references auth.users on delete cascade,
  email      text,
  name       text,
  lang       text not null check (lang in ('is', 'pt', 'hr', 'tr', 'nl')),
  blocked    boolean not null default false,          -- set by an admin only
  created_at timestamptz not null default now()
);

-- the language the signed-in user may edit (null if none or blocked)
create function public.my_lang() returns text
language sql stable security definer set search_path = public as $$
  select lang from public.translators where user_id = auth.uid() and not blocked
$$;

-- ---------- translations: the current corrected text ----------
create table public.translations (
  lang       text not null check (lang in ('is', 'pt', 'hr', 'tr', 'nl')),
  key        text not null check (key ~ '^t[0-9a-f]{8}$'),
  text       text not null,
  worksheet  text,                                     -- where it was edited (for the record only)
  updated_by uuid references auth.users,
  updated_at timestamptz not null default now(),
  primary key (lang, key)
);

-- ---------- revisions: every save, append-only ----------
create table public.revisions (
  id         bigint generated always as identity primary key,
  lang       text not null,
  key        text not null,
  text       text,                                     -- null = reverted to the AI translation
  worksheet  text,
  changed_by uuid references auth.users,
  changed_at timestamptz not null default now()
);
create index revisions_lang_key on public.revisions (lang, key, changed_at desc);

-- ---------- reviews: "I have checked this worksheet" ----------
create table public.reviews (
  worksheet   text not null,
  lang        text not null check (lang in ('is', 'pt', 'hr', 'tr', 'nl')),
  reviewed_by uuid references auth.users,
  reviewed_at timestamptz not null default now(),
  primary key (worksheet, lang)
);

-- ---------- notes: e.g. "the English text is wrong too" ----------
create table public.notes (
  id         bigint generated always as identity primary key,
  worksheet  text not null,
  lang       text,
  key        text,
  body       text not null check (length(body) between 1 and 4000),
  author     uuid references auth.users default auth.uid(),
  created_at timestamptz not null default now(),
  resolved   boolean not null default false
);

-- ---------- triggers: stamp the author, keep the history ----------
create function public.stamp_translation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

create trigger translations_stamp before insert or update on public.translations
  for each row execute function public.stamp_translation();

create function public.log_revision() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.revisions (lang, key, text, worksheet, changed_by)
  values (new.lang, new.key, new.text, new.worksheet, new.updated_by);
  return new;
end $$;

create trigger translations_history after insert or update on public.translations
  for each row execute function public.log_revision();

create function public.log_revert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.revisions (lang, key, text, worksheet, changed_by)
  values (old.lang, old.key, null, old.worksheet, auth.uid());
  return old;
end $$;

create trigger translations_revert after delete on public.translations
  for each row execute function public.log_revert();

create function public.stamp_review() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  return new;
end $$;

create trigger reviews_stamp before insert or update on public.reviews
  for each row execute function public.stamp_review();

-- ---------- row level security ----------
alter table public.translators  enable row level security;
alter table public.translations enable row level security;
alter table public.revisions    enable row level security;
alter table public.reviews      enable row level security;
alter table public.notes        enable row level security;

-- translators: everyone signed in sees who works on what; you create
-- and edit only your own row, and never the "blocked" flag
create policy "read translators"  on public.translators for select to authenticated using (true);
create policy "join as translator" on public.translators for insert to authenticated
  with check (user_id = auth.uid() and blocked = false);
create policy "edit own profile"  on public.translators for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.translators from authenticated;
grant update (name, lang) on public.translators to authenticated;

-- translations: read all languages, write only your own (English is never here)
create policy "read translations" on public.translations for select to authenticated using (true);
create policy "write own language" on public.translations for insert to authenticated
  with check (lang = public.my_lang());
create policy "update own language" on public.translations for update to authenticated
  using (lang = public.my_lang()) with check (lang = public.my_lang());
create policy "undo own language" on public.translations for delete to authenticated
  using (lang = public.my_lang());

-- revisions: read only; written by the trigger
create policy "read revisions" on public.revisions for select to authenticated using (true);

-- reviews: mark or unmark your own language
create policy "read reviews" on public.reviews for select to authenticated using (true);
create policy "review own language" on public.reviews for insert to authenticated
  with check (lang = public.my_lang());
create policy "re-review own language" on public.reviews for update to authenticated
  using (lang = public.my_lang()) with check (lang = public.my_lang());
create policy "unreview own language" on public.reviews for delete to authenticated
  using (lang = public.my_lang());

-- notes: anyone signed in as a translator may write; authors see theirs, all read
create policy "read notes"  on public.notes for select to authenticated using (true);
create policy "write notes" on public.notes for insert to authenticated
  with check (author = auth.uid() and public.my_lang() is not null);

-- ---------- realtime: see other translators' saves live ----------
alter publication supabase_realtime add table public.translations, public.reviews;
