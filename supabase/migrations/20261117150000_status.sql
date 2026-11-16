-- ============================================================
-- GREEN translations — public status (translations/status.html)
--
-- Anyone, signed in or not, may see HOW FAR the review has come:
-- per worksheet and language, whether it is reviewed and how many
-- corrections were made; per language, how many translators there
-- are. No names, no emails, no texts — only counts.
-- ============================================================

create function public.translation_status()
returns table (worksheet text, lang text, reviewed boolean, reviewed_at timestamptz, corrections bigint)
language sql stable security definer set search_path = public as $$
  with c as (
    select t.worksheet, t.lang, count(*) as n
    from public.translations t where t.worksheet is not null
    group by t.worksheet, t.lang
  )
  select coalesce(c.worksheet, r.worksheet), coalesce(c.lang, r.lang),
         r.worksheet is not null, r.reviewed_at, coalesce(c.n, 0)
  from c full join public.reviews r on r.worksheet = c.worksheet and r.lang = c.lang
$$;

create function public.translator_counts()
returns table (lang text, translators bigint)
language sql stable security definer set search_path = public as $$
  select lang, count(*) from public.translators where not blocked group by lang
$$;

revoke all on function public.translation_status() from public;
revoke all on function public.translator_counts() from public;
grant execute on function public.translation_status() to anon, authenticated;
grant execute on function public.translator_counts() to anon, authenticated;
