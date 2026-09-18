/* ============================================================
   GREEN Worksheets — worksheet engine

   Renders a worksheet folder (content.json + lang/*.json, made by
   tools/reader.mjs from a Google Doc) as printable A4 pages:
   automatic page breaks, header/footer on every page, six
   languages, level filter (Basic / Medium / Advanced), B/W mode,
   KaTeX formulas and QR codes for videos in print.

   A worksheet page only needs:
     <body data-root="../../">  +  css/worksheet.css  +  this file
   URL options: ?lang=is  &level=basic  &mt=google
   ============================================================ */
(function () {
  'use strict';

  const ROOT = document.body.dataset.root || '../../';
  const LANGS = [
    { code: 'en', name: 'English' },
    { code: 'is', name: 'Íslenska' },
    { code: 'pt', name: 'Português' },
    { code: 'hr', name: 'Hrvatski' },
    { code: 'tr', name: 'Türkçe' },
    { code: 'nl', name: 'Nederlands' }
  ];
  const LEVELS = ['basic', 'medium', 'advanced'];
  const STORAGE_KEY = 'green-ws-lang';        // shared with the hand-made worksheets

  const params = new URLSearchParams(location.search);
  const state = {
    lang: pickLang(),
    level: LEVELS.includes(params.get('level')) ? params.get('level') : 'all',
    source: params.get('mt') === 'google' ? 'google' : 'main',
    content: null, en: {}, tr: {}, meta: {}, uiAll: {}, googleAvail: {}, missing: 0
  };

  function pickLang() {
    const codes = LANGS.map(l => l.code);
    let saved = null;
    try { saved = localStorage.getItem(STORAGE_KEY); } catch (_) {}
    return [params.get('lang'), saved, 'en'].find(c => codes.includes(c));
  }

  /* ---------- data ---------- */
  const cache = {};
  async function getJSON(url) {
    if (!(url in cache)) {
      cache[url] = fetch(url, { cache: 'no-cache' })
        .then(r => (r.ok ? r.json() : null))
        .catch(() => null);
    }
    return cache[url];
  }
  const strip = o => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith('_')));

  async function loadLanguage() {
    state.tr = {};
    state.meta = {};
    if (state.lang !== 'en') {
      const google = await getJSON(`lang/google/${state.lang}.json`);
      state.googleAvail[state.lang] = !!google;
      const main = await getJSON(`lang/${state.lang}.json`);
      const pick = state.source === 'google' && google ? google : main;
      state.tr = strip(pick);
      state.meta = (pick && pick._meta) || {};
    }
  }

  /* text for a key, falling back to English */
  function T(key, raw) {
    if (!key) return '';
    const t = state.tr[key];
    if (t) return raw ? t : inline(t);
    const en = state.en[key] || '';
    if (state.lang !== 'en') state.missing++;
    return raw ? en : (state.lang !== 'en' ? `<span class="untranslated">${inline(en)}</span>` : inline(en));
  }
  function ui(key) {
    const parts = key.split('.');
    const find = lang => parts.reduce((o, k) => (o == null ? undefined : o[k]), state.uiAll[lang]);
    return find(state.lang) ?? find('en') ?? key;
  }

  /* ---------- tiny inline markdown: **bold**, *italic*, [link](url) ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function inline(s) {
    // $…$ that contains LaTeX becomes a KaTeX formula; "$5 or $10" stays text
    return String(s).split(/(\$[^$\n]{1,300}\$)/).map(part => {
      const m = /^\$([^$]+)\$$/.exec(part);
      if (m && /[\\_^{}=]/.test(m[1]) && window.katex) {
        try { return window.katex.renderToString(m[1], { throwOnError: false }); } catch (_) {}
      }
      return esc(part)
        .replace(/\\\*/g, '&#42;')
        .replace(/\*\*\s*(.+?)\s*\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)/g, '$1<em>$2</em>')
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    }).join('');
  }
  /* Numbers in tables: decimal comma in every partner language. (Intl is not
     used because Chrome ships without Icelandic number data.) */
  function num(n) {
    return state.lang === 'en' ? n : n.replace('.', ',');
  }
  function h(tag, cls, html) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  }
  const bars = level => `<span class="bars">${[0, 1, 2].map(i => `<i class="${i <= LEVELS.indexOf(level) ? 'on' : ''}"></i>`).join('')}</span>`;
  const chip = level => `<span class="lvl lvl-${level}">${bars(level)}${esc(ui('levels.' + level))}</span>`;

  /* ---------- content → flow items ---------- */
  function build() {
    const c = state.content;
    const items = [];
    const push = (el, opt = {}) => {
      if (opt.keepNext) el.dataset.keepNext = '1';
      items.push({ el, breakBefore: !!opt.breakBefore });
      return el;
    };
    const show = level => state.level === 'all' || !level || level === state.level;
    const secLevels = sec => sec.levels || [sec.level];
    const levels = c.levels.filter(show);

    // title block
    const flag = c.country ? `<img src="${ROOT}img/flags/${c.country}.svg" alt="">` : '';
    push(h('div', 'title-block',
      `<div class="kicker">${flag}<span>${esc(ui('worksheet'))}${c.code ? ' ' + esc(c.code) : ''}${c.country ? ' · ' + esc(ui('countries.' + c.country)) : ''}</span></div>` +
      `<h1 class="title">${T(c.title)}</h1>` +
      (c.subtitle ? `<div class="subtitle">${T(c.subtitle)}</div>` : '') +
      `<div class="level-chips">${levels.map(chip).join('')}</div>`));

    // topic / outcomes / time / resources
    const rows = [];
    const m = c.meta;
    // one row per level (chip + its items); items without a level are a plain list
    const leveled = list => {
      const groups = [];
      for (const x of list.filter(x => show(x.level))) {
        const g = groups[groups.length - 1];
        if (g && x.level && g.level === x.level) g.items.push(x); else groups.push({ level: x.level, items: [x] });
      }
      if (!groups.length) return '';
      return `<ul>${groups.map(g => `<li>${g.level ? chip(g.level) : ''}<span>${g.items.map(x => T(x.text)).join('<br>')}</span></li>`).join('')}</ul>`;
    };
    const field = v => Array.isArray(v) ? leveled(v) : T(v);
    if (m.topic) rows.push([ui('topic'), field(m.topic)]);
    if (m.outcomes.length) rows.push([ui('learningOutcomes'), leveled(m.outcomes)]);
    if (m.time.length) rows.push([ui('timeNeeded'), leveled(m.time)]);
    if (m.resources) rows.push([ui('resources'), field(m.resources)]);
    for (const x of m.extra) rows.push([T(x.label), T(x.value)]);
    push(h('table', 'struct', `<tbody>${rows.filter(([, v]) => v).map(([k, v]) => `<tr><th>${esc(k).replace(/:$/, '')}</th><td>${v}</td></tr>`).join('')}</tbody>`));

    let rendered = 0;                                      // the first part may share page 1 with the title
    for (const sec of c.sections) {
      if (sec.kind === 'level') {
        if (state.level !== 'all' && !secLevels(sec).includes(state.level)) continue;
        const time = m.time.find(x => x.level === sec.level);
        push(h('div', `level-banner lvl-${sec.level}`,
          `${secLevels(sec).filter(show).map(chip).join('')}<span class="lvl-title">${sec.title ? T(sec.title) : ''}</span>` +
          (time ? `<span class="lvl-time">⏱ ${T(time.text)}</span>` : '')), { breakBefore: rendered++ > 0, keepNext: true });
        push(h('div', 'name-line', `<span>${esc(ui('name'))}</span><span>${esc(ui('class'))}</span><span>${esc(ui('date'))}</span>`), { keepNext: true });
        let taskNo = 0;
        const counter = { q: 0 };
        for (const b of sec.blocks) {
          if (b.t === 'task') {
            taskNo++;
            push(h('h3', `task-title lvl-${sec.level}`, `<span class="task-no">${esc(ui('task'))} ${taskNo}</span><span>${T(b.title)}</span>`), { keepNext: true });
            const qc = { q: 0 };
            b.blocks.forEach((x, i) => blockItems(x, push, qc, b.blocks[i + 1]));
          } else blockItems(b, push, counter, sec.blocks[sec.blocks.indexOf(b) + 1]);
        }
      } else {
        rendered++;
        if (sec.title) push(h('h2', 'section', T(sec.title)), { keepNext: true });
        const counter = { q: 0 };
        sec.blocks.forEach((b, i) => blockItems(b, push, counter, sec.blocks[i + 1]));
      }
    }
    return items;
  }

  /* An intro paragraph stays on the same page as what it introduces. */
  function introduces(p, next) {
    return !!next && (/:\s*$/.test(state.en[p.text] || '') || ['q', 'table'].includes(next.t));
  }

  function blockItems(b, push, counter, next) {
    switch (b.t) {
      case 'p': push(h('p', 'body', T(b.text)), { keepNext: introduces(b, next) }); break;
      case 'h': counter.q = 0; push(h('h3', 'subhead', T(b.text)), { keepNext: true }); break;
      case 'ul': b.items.forEach(k => push(h('div', 'li', T(k)))); break;
      case 'li': push(h('div', 'li ol', `<span class="n">${b.n}.</span>${T(b.text)}`)); break;
      case 'q': {
        counter.q++;
        push(h('div', 'q', `<span class="q-no">${counter.q}.</span><div class="q-main">${question(b)}</div>`));
        break;
      }
      case 'lines': push(h('div', 'lines', '<div class="write-line"></div>'.repeat(b.n))); break;
      case 'box': push(h('div', 'box-tip', (b.title ? `<h4>${T(b.title)}</h4>` : '') + b.blocks.map(innerHTML).join(''))); break;
      default: push(h('div', 'block', innerHTML(b)));
    }
  }

  /* question text + its parts (fill-in items, answer options) + answer lines */
  function question(b) {
    const items = b.items ? `<ul class="q-items">${b.items.map(k => `<li>${T(k)}</li>`).join('')}</ul>` : '';
    const options = b.options ? `<div class="q-options">${b.options.map((k, i) =>
      `<div class="opt"><span class="tick"></span><b>${'ABCDEFGH'[i]}</b><span>${T(k)}</span></div>`).join('')}</div>` : '';
    return `<div class="q-text">${T(b.text)}</div>${items}${options}${'<div class="write-line"></div>'.repeat(b.lines || 0)}`;
  }

  /* blocks that are always kept whole (also used inside boxes) */
  function innerHTML(b) {
    switch (b.t) {
      case 'p': return `<p>${T(b.text)}</p>`;
      case 'h': return `<h4>${T(b.text)}</h4>`;
      case 'ul': return b.items.map(k => `<div class="li">${T(k)}</div>`).join('');
      case 'li': return `<div class="li ol"><span class="n">${b.n}.</span>${T(b.text)}</div>`;
      case 'q': return `<div class="q"><span class="q-no">•</span><div class="q-main">${question(b)}</div></div>`;
      case 'lines': return '<div class="write-line"></div>'.repeat(b.n);
      case 'math': return `<div class="formula-block">${math(b)}</div>`;
      case 'img': {
        const size = b.w ? ` width="${b.w}" height="${b.h}"` : '';
        return `<figure class="media"><img src="${esc(b.src)}"${size} alt="">` +
          (b.caption ? `<figcaption>${T(b.caption)}</figcaption>` : '') + '</figure>';
      }
      case 'video': return video(b);
      case 'table': {
        const cell = (c, tag) => {
          const span = c && typeof c === 'object' && 'k' in c ? ` colspan="${c.span}"` : '';
          if (span) c = c.k;
          if (c === '') return `<${tag} class="blank"${span}></${tag}>`;
          if (c && c.n != null) return `<${tag} class="num"${span}>${num(c.n)}</${tag}>`;
          return `<${tag}${span}>${T(c)}</${tag}>`;
        };
        return `<table class="grid"><thead><tr>${b.head.map(c => cell(c, 'th')).join('')}</tr></thead>` +
          `<tbody>${b.rows.map(r => `<tr>${r.map(c => cell(c, 'td')).join('')}</tr>`).join('')}</tbody></table>`;
      }
      default: return '';
    }
  }

  function math(b) {
    const texEsc = s => s.replace(/[\\{}$&#^_%~]/g, c => (c === '\\' ? '\\textbackslash{}' : '\\' + c));
    const tex = b.tex.replace(/\\text\{@(\d+)\}/g, (_, i) => `\\text{${texEsc(T(b.args[+i], true))}}`);
    try { return window.katex.renderToString(tex, { displayMode: true, throwOnError: false }); }
    catch (_) { return `<code>${esc(tex)}</code>`; }
  }

  function video(b) {
    const url = `https://www.youtube.com/watch?v=${b.youtube}`;
    let qr = '';
    try {
      const q = window.qrcode(0, 'M');
      q.addData(url);
      q.make();
      qr = q.createSvgTag(4, 0);
    } catch (_) {}
    return `<div class="video-block">` +
      `<div class="video-embed" style="background-image:url('https://i.ytimg.com/vi/${b.youtube}/hqdefault.jpg')">` +
      `<button type="button" data-youtube="${b.youtube}">${esc(ui('playVideo'))}</button></div>` +
      `<div class="video-caption">${T(b.caption)}</div>` +
      `<div class="video-print"><div class="qr-code">${qr}</div><div><div class="qr-label">${esc(ui('scanVideo'))}</div>` +
      `<div class="qr-label">${T(b.caption)}</div><div class="qr-url">${url}</div></div></div></div>`;
  }

  /* ---------- pagination ---------- */
  function newPage(host) {
    const page = h('section', 'page',
      `<div class="r-header"><div class="logo-green"><img src="${ROOT}img/greenlogo.png" alt="GREEN">` +
      `<div class="proj-no">2025-1-HR01-KA220-VET-<br>000353056</div></div>` +
      `<div class="logo-eu"><img src="${ROOT}img/eufounded.png" alt="Co-funded by the European Union"></div></div>` +
      `<div class="page-body"></div>` +
      `<div class="r-footer"><div class="footer-left"><div class="proj-line">${esc(ui('projectLine'))}</div>` +
      `<div class="disclaimer">${esc(ui('disclaimer'))}</div>` +
      (machineTranslated() ? `<div class="mt-note">${esc(ui('machineShort'))} · ${esc(sourceName())}</div>` : '') +
      `</div><div class="pageno"></div></div>`);
    host.appendChild(page);
    return page.querySelector('.page-body');
  }

  function paginate(items, host) {
    host.innerHTML = '';
    let body = newPage(host);
    const overflows = () => body.scrollHeight > body.clientHeight + 1;
    for (const it of items) {
      if (it.breakBefore && body.childElementCount) body = newPage(host);
      body.appendChild(it.el);
      if (!overflows()) continue;
      // move the element, and any headings glued to it, to a fresh page
      const moving = [it.el];
      let prev = it.el.previousElementSibling;
      while (prev && prev.dataset.keepNext) { moving.unshift(prev); prev = prev.previousElementSibling; }
      if (moving.length === body.childElementCount) { console.warn('[worksheet] block taller than a page', it.el); continue; }
      body = newPage(host);
      moving.forEach(el => body.appendChild(el));
    }
    const pages = host.querySelectorAll('.page');
    pages.forEach((p, i) => {
      p.querySelector('.pageno').innerHTML = `${esc(ui('page'))} ${i + 1} ${esc(ui('of'))} ${pages.length}`;
    });
  }

  /* ---------- render ---------- */
  function machineTranslated() {
    return state.lang !== 'en' && state.meta.reviewed !== true;
  }
  function sourceName() {
    return state.source === 'google' ? ui('sourceGoogle') : (state.meta.engine || ui('sourceAI'));
  }

  let renderSeq = 0;
  async function render() {
    const seq = ++renderSeq;
    await loadLanguage();
    if (seq !== renderSeq) return;
    state.missing = 0;
    document.documentElement.lang = state.lang;

    const items = build();
    // lay everything out off-screen first so fonts, KaTeX and images are ready before measuring
    const measure = document.getElementById('measure');
    const body = h('div', 'page-body');
    measure.replaceChildren(body);
    items.forEach(it => body.appendChild(it.el));
    await document.fonts.ready;
    // wait for image sizes (load, not decode: decode never finishes in a background tab)
    await Promise.all([...body.querySelectorAll('img')].map(img => img.complete ? null :
      new Promise(done => { img.addEventListener('load', done); img.addEventListener('error', done); setTimeout(done, 3000); })));
    if (seq !== renderSeq) return;

    paginate(items, document.getElementById('pages'));
    measure.replaceChildren();
    updateToolbar();
    updateNotice();
    const title = state.content.title ? T(state.content.title, true) : '';
    document.title = `${title} — ${ui('worksheet')}`;
  }

  /* ---------- toolbar ---------- */
  function toolbar() {
    const bar = h('div', 'toolbar');
    bar.innerHTML =
      `<a class="back-btn" href="${ROOT}index.html"></a>` +
      `<div class="group"><span class="label" data-ui="language"></span><div class="flags">` +
      LANGS.map(l => `<button class="flag-btn" data-lang="${l.code}" title="${l.name}"><img src="${ROOT}img/flags/${l.code}.svg" alt="${l.code}"></button>`).join('') +
      `</div></div>` +
      `<div class="group"><span class="label" data-ui="show"></span><div class="seg" id="level-seg"></div></div>` +
      `<div class="group" id="source-group" hidden><span class="label" data-ui="translation"></span><div class="seg">` +
      `<button data-source="main"></button><button data-source="google"></button></div></div>` +
      `<div class="spacer"></div>` +
      `<button class="bw-toggle" aria-pressed="false"></button>` +
      `<button class="print-btn"></button>`;
    document.body.prepend(bar);

    bar.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.lang) {
        state.lang = b.dataset.lang;
        try { localStorage.setItem(STORAGE_KEY, state.lang); } catch (_) {}
      } else if (b.dataset.level) state.level = b.dataset.level;
      else if (b.dataset.source) state.source = b.dataset.source;
      else if (b.classList.contains('bw-toggle')) {
        b.setAttribute('aria-pressed', document.body.classList.toggle('bw-mode'));
        return;
      } else if (b.classList.contains('print-btn')) { window.print(); return; }
      else return;
      syncURL();
      render();
    });
  }

  function updateToolbar() {
    const bar = document.querySelector('.toolbar');
    bar.querySelector('.back-btn').textContent = ui('back');
    bar.querySelectorAll('[data-ui]').forEach(el => { el.textContent = ui(el.dataset.ui); });
    bar.querySelector('.bw-toggle').textContent = ui('bwToggle');
    bar.querySelector('.print-btn').textContent = ui('print');
    bar.querySelectorAll('.flag-btn').forEach(b => b.setAttribute('aria-pressed', b.dataset.lang === state.lang));
    const seg = bar.querySelector('#level-seg');
    seg.innerHTML = [['all', esc(ui('allLevels'))], ...state.content.levels.map(l => [l, bars(l) + esc(ui('levels.' + l))])]
      .map(([v, label]) => `<button data-level="${v}" aria-pressed="${state.level === v}">${label}</button>`).join('');
    const src = bar.querySelector('#source-group');
    src.hidden = !(state.lang !== 'en' && state.googleAvail[state.lang]);
    src.querySelector('[data-source="main"]').textContent = state.meta.engine && state.source !== 'google' ? state.meta.engine : ui('sourceAI');
    src.querySelector('[data-source="google"]').textContent = ui('sourceGoogle');
    src.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.source === state.source));
  }

  function updateNotice() {
    const n = document.getElementById('notice');
    const parts = [];
    if (machineTranslated()) parts.push(`⚠ ${esc(ui('machineNotice'))} (${esc(sourceName())})`);
    if (state.missing) parts.push(esc(ui('missing')).replace('{n}', state.missing));
    n.innerHTML = parts.join(' ');
    n.hidden = !parts.length;
  }

  function syncURL() {
    const p = new URLSearchParams(location.search);
    p.set('lang', state.lang);
    state.level === 'all' ? p.delete('level') : p.set('level', state.level);
    state.source === 'google' ? p.set('mt', 'google') : p.delete('mt');
    history.replaceState(null, '', `${location.pathname}?${p}`);
  }

  /* screen: shrink the A4 pages to fit narrow windows */
  function fitWidth() {
    const pageWidth = 210 * 96 / 25.4 + 24;
    document.documentElement.style.setProperty('--zoom', Math.min(1, window.innerWidth / pageWidth).toFixed(3));
  }

  /* click-to-play: YouTube is contacted only when the student asks for it */
  document.addEventListener('click', e => {
    const b = e.target.closest('.video-embed button[data-youtube]');
    if (!b) return;
    const frame = h('iframe');
    frame.src = `https://www.youtube-nocookie.com/embed/${b.dataset.youtube}?autoplay=1`;
    frame.allow = 'accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture';
    frame.allowFullscreen = true;
    b.replaceWith(frame);
  });

  async function init() {
    const notice = h('div', 'notice');
    const pages = h('div');
    const measure = h('div');
    notice.id = 'notice';
    notice.hidden = true;
    pages.id = 'pages';
    measure.id = 'measure';
    document.body.append(notice, pages, measure);
    toolbar();
    fitWidth();
    window.addEventListener('resize', fitWidth);

    const [content, en, uiAll] = await Promise.all([getJSON('content.json'), getJSON('lang/en.json'), getJSON(`${ROOT}lang/worksheet-ui.json`)]);
    if (!content || !en) {
      pages.innerHTML = '<p style="text-align:center;padding:40px">content.json / lang/en.json not found.</p>';
      return;
    }
    state.content = content;
    state.en = strip(en);
    state.uiAll = uiAll || {};
    await render();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
