/* ============================================================
   GREEN Worksheets — translation editor (loaded by worksheet.js
   when the URL has ?edit=1)

   A signed-in translator clicks any text on the worksheet, sees the
   English original and the machine translation, and types the
   correction. It is saved to Supabase about a second after typing
   stops. Everyone working on the same language sees the change live.
   The JSON files are not touched: `node tools/reader.mjs from-supabase`
   writes the corrections back at the end of the translation phase.
   ============================================================ */
(async function () {
  'use strict';
  const api = window.greenWorksheet;
  if (!api || !window.greenSupabase) return;
  const ROOT = document.body.dataset.root || '../../';
  const st = api.state;
  const t = k => api.ui('edit.' + k);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  /* ---------- look ---------- */
  const css = document.createElement('style');
  css.textContent = `
    .tk { cursor: text; border-radius: 2px; transition: background .12s, box-shadow .12s; }
    body.tr-on .tk:hover { background: #fff6c2; box-shadow: 0 0 0 2px #fff6c2; }
    body.tr-on .tk-changed { background: #e3f4e8; box-shadow: 0 0 0 1px #9fd3ae; }
    body.tr-on .tk.tk-active { background: #ffe58a; box-shadow: 0 0 0 2px #e0b400; }
    .tr-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 50; display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
      padding: 8px 16px; background: #1b6b3a; color: #fff; font: 14px/1.4 "Open Sans", system-ui, sans-serif; box-shadow: 0 -2px 10px rgba(0,0,0,.15); }
    .tr-bar a { color: #fff; }
    .tr-bar .tr-hint { flex: 1 1 260px; opacity: .92; }
    .tr-bar button { font: inherit; border: 1px solid rgba(255,255,255,.6); background: transparent; color: #fff; border-radius: 6px; padding: 5px 12px; cursor: pointer; }
    .tr-bar button[aria-pressed="true"] { background: #fff; color: #1b6b3a; font-weight: 700; }
    .tr-panel { position: fixed; top: 64px; right: 16px; width: min(420px, calc(100vw - 32px)); max-height: calc(100vh - 140px); overflow: auto; z-index: 60;
      background: #fff; color: #1a1d27; border-radius: 10px; box-shadow: 0 8px 30px rgba(0,0,0,.25); padding: 14px 16px 16px; font: 14px/1.45 "Open Sans", system-ui, sans-serif; }
    .tr-panel[hidden] { display: none; }
    .tr-panel h4 { margin: 10px 0 4px; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #5f6b76; }
    .tr-panel .tr-src { background: #f4f5f7; border-radius: 6px; padding: 8px 10px; white-space: pre-wrap; }
    .tr-panel textarea { width: 100%; min-height: 110px; box-sizing: border-box; font: 15px/1.45 "Open Sans", system-ui, sans-serif; padding: 8px 10px;
      border: 2px solid #1b6b3a; border-radius: 6px; resize: vertical; }
    .tr-panel .tr-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; font-size: 13px; }
    .tr-panel .tr-status { color: #5f6b76; }
    .tr-panel .tr-status.err { color: #b00020; font-weight: 600; }
    .tr-panel button { font: inherit; font-size: 13px; border: 1px solid #c1c7d0; background: #fff; border-radius: 6px; padding: 4px 10px; cursor: pointer; }
    .tr-panel .tr-close { float: right; border: 0; font-size: 18px; line-height: 1; padding: 0 4px; }
    .tr-history { font-size: 13px; }
    .tr-h { border-left: 3px solid #dfe1e6; padding: 4px 0 6px 10px; margin: 6px 0; }
    .tr-h.now { border-left-color: #1b6b3a; }
    .tr-h-meta { color: #5f6b76; font-size: 12px; }
    .tr-h-text { white-space: pre-wrap; margin: 2px 0 4px; }
    .tr-panel .tr-use { font-size: 12px; padding: 2px 8px; }
    .tr-note { display: flex; gap: 8px; flex: 1 1 320px; }
    .tr-note input { flex: 1; font: inherit; padding: 5px 8px; border-radius: 6px; border: 0; }
    #pages { padding-bottom: 80px; }
    @media print { .tr-bar, .tr-panel { display: none !important; } .tk { background: none !important; box-shadow: none !important; } }`;
  document.head.appendChild(css);

  const bar = document.createElement('div');
  bar.className = 'tr-bar';
  document.body.appendChild(bar);
  const say = html => { bar.innerHTML = html; };

  /* ---------- who is this? ---------- */
  let sb, me, session;
  try {
    sb = await window.greenSupabase();
    ({ data: { session } } = await sb.auth.getSession());
  } catch (e) {
    say(`⚠ ${esc(e.message)}`);
    return;
  }
  const home = `${ROOT}translations/`;
  if (!session) {
    say(`<span class="tr-hint">✏️ ${esc(t('signIn'))}</span>
         <a href="${home}?next=${encodeURIComponent(location.href)}"><button>${esc(t('signInBtn'))}</button></a>`);
    return;
  }
  ({ data: me } = await sb.from('translators').select('*').eq('user_id', session.user.id).maybeSingle());
  if (!me) {
    say(`<span class="tr-hint">✏️ ${esc(t('noProfile'))}</span> <a href="${home}?next=${encodeURIComponent(location.href)}"><button>${esc(t('home'))}</button></a>`);
    return;
  }
  if (me.blocked) { say(`<span class="tr-hint">${esc(t('blocked'))}</span>`); return; }

  /* the translator always works in their own language */
  const slug = st.content && st.content.id;
  const keys = Object.keys(st.en);
  if (st.lang !== me.lang) await api.setLang(me.lang);
  document.body.classList.add('tr-on');

  /* ---------- corrections already made ---------- */
  async function loadOverrides() {
    const map = {};
    for (let i = 0; i < keys.length; i += 150) {                 // keep the URL short
      const { data, error } = await sb.from('translations').select('key,text').eq('lang', me.lang).in('key', keys.slice(i, i + 150));
      if (error) throw error;
      for (const r of data) map[r.key] = r.text;
    }
    return map;
  }
  try { await api.setOverrides(await loadOverrides()); }
  catch (e) { say(`⚠ ${esc(e.message)}`); return; }

  /* ---------- the bar at the bottom ---------- */
  let reviewed = false;
  {
    const { data } = await sb.from('reviews').select('worksheet').eq('worksheet', slug).eq('lang', me.lang).maybeSingle();
    reviewed = !!data;
  }
  function drawBar() {
    say(`<span class="tr-hint">✏️ ${esc(t('hint'))} · ${esc(t('signedInAs'))} ${esc(me.name || session.user.email)} (${me.lang.toUpperCase()}) · <a href="${home}">${esc(t('home'))}</a></span>
      <form class="tr-note"><input name="note" maxlength="4000" placeholder="${esc(t('note'))}"><button>${esc(t('sendNote'))}</button></form>
      <button class="tr-review" aria-pressed="${reviewed}">${esc(reviewed ? t('reviewedDone') : t('reviewed'))}</button>`);
  }
  drawBar();
  bar.addEventListener('click', async e => {
    if (!e.target.closest('.tr-review')) return;
    const want = !reviewed;
    const { error } = want
      ? await sb.from('reviews').upsert({ worksheet: slug, lang: me.lang })
      : await sb.from('reviews').delete().eq('worksheet', slug).eq('lang', me.lang);
    if (error) { alert(error.message); return; }
    reviewed = want;
    drawBar();
  });
  bar.addEventListener('submit', async e => {
    e.preventDefault();
    const input = e.target.querySelector('input');
    const body = input.value.trim();
    if (!body) return;
    const { error } = await sb.from('notes').insert({ worksheet: slug, lang: me.lang, key: current, body });
    if (error) { alert(error.message); return; }
    input.value = '';
    input.placeholder = t('noteSent');
  });

  /* ---------- the editing panel ---------- */
  const panel = document.createElement('div');
  panel.className = 'tr-panel';
  panel.hidden = true;
  document.body.appendChild(panel);
  let current = null, timer = null, saving = Promise.resolve();

  function open(key) {
    flush();
    current = key;
    document.querySelectorAll('.tk-active').forEach(el => el.classList.remove('tk-active'));
    document.querySelectorAll(`.tk[data-k="${key}"]`).forEach(el => el.classList.add('tk-active'));
    const ai = st.base[key];
    const now = st.tr[key] != null ? st.tr[key] : '';
    panel.innerHTML = `
      <button class="tr-close" title="${esc(t('close'))}">×</button>
      <h4>${esc(t('english'))}</h4><div class="tr-src">${esc(st.en[key] || '')}</div>
      ${ai != null && st.overrides[key] != null ? `<h4>${esc(t('ai'))}</h4><div class="tr-src">${esc(ai)}</div>` : ''}
      <h4>${esc(t('yours'))}</h4><textarea spellcheck="true" lang="${me.lang}">${esc(now)}</textarea>
      <div class="tr-row"><span class="tr-status"></span>
        ${ai != null ? `<button class="tr-revert">${esc(t('revert'))}</button>` : ''}</div>
      <h4>${esc(t('history'))}</h4><div class="tr-history">…</div>`;
    panel.hidden = false;
    loadHistory(key);
    const ta = panel.querySelector('textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    ta.addEventListener('input', () => {
      status(t('saving'));
      api.setText(key, ta.value);                  // shows on the page at once
      clearTimeout(timer);
      timer = setTimeout(() => save(key, ta.value), 900);
    });
  }
  /* every saved version of this text, newest first, with who and when */
  const names = {};
  async function loadHistory(key) {
    const box = panel.querySelector('.tr-history');
    if (!box) return;
    const { data: rows, error } = await sb.from('revisions')
      .select('id,text,changed_by,changed_at').eq('lang', me.lang).eq('key', key)
      .order('changed_at', { ascending: false }).limit(50);
    if (key !== current) return;                     // another text was opened meanwhile
    if (error) { box.textContent = error.message; return; }
    const missing = [...new Set(rows.map(r => r.changed_by).filter(id => id && !(id in names)))];
    if (missing.length) {
      const { data: people } = await sb.from('translators').select('user_id,name,email').in('user_id', missing);
      for (const p of people || []) names[p.user_id] = p.name || p.email;
    }
    const when = d => new Date(d).toLocaleString(me.lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const item = (text, meta, isNow) => `<div class="tr-h${isNow ? ' now' : ''}">
        <div class="tr-h-meta">${meta}${isNow ? ` · <b>${esc(t('current'))}</b>` : ''}</div>
        <div class="tr-h-text">${text == null ? `<i>${esc(t('reverted'))}</i>` : esc(text)}</div>
        ${!isNow && text != null ? `<button class="tr-use" data-text="${esc(text)}">${esc(t('restore'))}</button>` : ''}</div>`;
    const nowText = st.overrides[key] != null ? st.overrides[key] : null;
    let html = rows.map((r, i) => item(r.text, `${esc(when(r.changed_at))} · ${esc(names[r.changed_by] || '?')}`,
      i === 0 && (r.text === nowText || (r.text == null && nowText == null)))).join('');
    if (st.base[key] != null) html += item(st.base[key], esc(t('original')), !rows.length || (rows[0].text == null && nowText == null));
    box.innerHTML = rows.length || st.base[key] != null ? html : esc(t('noHistory'));
  }

  function status(text, err) {
    const s = panel.querySelector('.tr-status');
    if (s) { s.textContent = text; s.classList.toggle('err', !!err); }
  }
  function flush() {
    if (!timer || !current) return;
    clearTimeout(timer);
    timer = null;
    const ta = panel.querySelector('textarea');
    if (ta) save(current, ta.value);
  }
  function save(key, text) {
    timer = null;
    const value = text.trim();
    saving = saving.then(async () => {
      // the same as the machine translation (or empty) = no correction
      const res = (!value || value === st.base[key])
        ? await sb.from('translations').delete().eq('lang', me.lang).eq('key', key)
        : await sb.from('translations').upsert({ lang: me.lang, key, text: value, worksheet: slug });
      if (res.error) { status(`${t('error')}: ${res.error.message}`, true); return; }
      api.setText(key, (!value || value === st.base[key]) ? null : value);
      if (key === current) { status(t('saved')); loadHistory(key); }
    });
    return saving;
  }
  function close() {
    flush();
    panel.hidden = true;
    current = null;
    document.querySelectorAll('.tk-active').forEach(el => el.classList.remove('tk-active'));
    saving.then(() => api.render());                // lay the pages out again with the new lengths
  }

  panel.addEventListener('click', e => {
    const use = e.target.closest('.tr-use');
    if (use && current) {
      const ta = panel.querySelector('textarea');
      ta.value = use.dataset.text;
      api.setText(current, ta.value);
      status(t('saving'));
      save(current, ta.value);
      return;
    }
    if (e.target.closest('.tr-close')) close();
    else if (e.target.closest('.tr-revert') && current) {
      const ta = panel.querySelector('textarea');
      ta.value = st.base[current];
      save(current, ta.value).then(() => open(current));
    }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.hidden) close(); });

  document.addEventListener('click', e => {
    const el = e.target.closest('.tk');
    if (!el || st.lang !== me.lang) return;
    e.preventDefault();                              // a link inside a text should not navigate while editing
    open(el.dataset.k);
  }, true);

  // after a re-render keep the open text highlighted
  document.addEventListener('ws:rendered', () => {
    if (current) document.querySelectorAll(`.tk[data-k="${current}"]`).forEach(el => el.classList.add('tk-active'));
  });

  /* ---------- live: other translators of the same language ---------- */
  sb.channel('tr-' + me.lang)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'translations', filter: `lang=eq.${me.lang}` }, p => {
      const row = p.new && p.new.key ? p.new : p.old;
      if (!row || !row.key || !(row.key in st.en) || row.key === current) return;
      api.setText(row.key, p.eventType === 'DELETE' ? null : p.new.text);
    })
    .subscribe();

  window.addEventListener('beforeunload', e => { if (timer) { flush(); e.preventDefault(); } });
})();
