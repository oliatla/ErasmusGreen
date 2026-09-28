/* ============================================================
   GREEN Worksheets — content.json + lang/<code>.json ⇄ Markdown

   Same idea as tools/write-docx.js, in plain text: one worksheet in
   one language becomes a Markdown file that can be read, corrected or
   translated in any editor (or pasted into an AI / Google Docs).

   Every translatable text carries its key as an invisible HTML
   comment, so a corrected file can be mapped back without guessing:

     ## <!--t1a2b3c4d--> Introduction            (marker first, text after it)
     - <!--t5e6f7a8b--> a bullet
     | <!--t0c1d2e3f--> cell | <!--t4a5b6c7d--> cell |
     <!--t9e8d7c6b-->                            (bare paragraph: marker on the
     Have you ever walked into …                  line above, text on the next)

   Everything that has no marker (headings the reader adds such as
   "Basic — ", task numbers, ▶ links, tables' rules, the notice) is
   layout and is ignored when the file is read back.

   No dependencies.
   ============================================================ */

const KEY = 't[0-9a-f]{8}';
const MARK = k => `<!--${k}-->`;
const cell = s => String(s ?? '').replace(/\|/g, '\\|');

/* ---------- worksheet → Markdown ---------- */
function buildMd(opts) {
  const { content, strings, ui, lang, slug, imgDir } = opts;
  const T = key => (key == null ? '' : (strings[key] ?? key));
  const levelName = l => (ui.levels && ui.levels[l]) || l || '';
  const out = [];
  const line = (s = '') => out.push(s);
  const seen = new Set();                                    // keys written (for the count)
  const note = k => { if (k) seen.add(k); return k; };

  /* a keyed text on one line, after some layout prefix: "- <!--k--> text" */
  const inline = (prefix, k, indent = '') => `${indent}${prefix}${MARK(note(k))} ${T(k)}`;
  /* a keyed paragraph: marker line, then the text */
  const bare = (k, indent = '') => { line(`${indent}${MARK(note(k))}`); line(`${indent}${T(k)}`); line(); };

  function table(head, rows) {
    const cols = (head || rows[0]).length;
    line('| ' + (head ? head.map(k => cell(inline('', k))) : Array(cols).fill(' ')).join(' | ') + ' |');
    line('|' + ' --- |'.repeat(cols));
    for (const r of rows) line('| ' + r.map(k => cell(inline('', k))).join(' | ') + ' |');
    line();
  }

  function block(b, ctx, quote = '') {
    const start = out.length;
    switch (b.t) {
      case 'h':
        line(inline('### ', b.text)); line();
        break;

      case 'p':
        bare(b.text);
        break;

      case 'ul':
        b.items.forEach(k => line(inline('- ', k))); line();
        break;

      case 'li':
        line(inline(`${b.n}. `, b.text)); line();
        break;

      case 'q':
        ctx.q += 1;
        line(inline(`${ctx.q}. `, b.text));
        (b.items || []).forEach(k => line(inline('- ', k, '   ')));
        (b.options || []).forEach((k, i) => line(inline(`- [ ${'ABCDE'[i] || '·'} ] `, k, '   ')));
        for (let i = 0; i < (b.lines || 0); i++) line('   ' + '\\_'.repeat(30));
        line();
        break;

      case 'lines':
        for (let i = 0; i < (b.n || 0); i++) line('\\_'.repeat(30));
        line();
        break;

      case 'box': {
        const inner = [];
        const saved = out.splice(0, out.length);             // render the box body on its own
        if (b.title) { line(inline('#### ', b.title)); line(); }
        b.blocks.forEach(x => block(x, ctx));
        inner.push(...out.splice(0, out.length));
        out.push(...saved);
        while (inner.length && inner[inner.length - 1] === '') inner.pop();
        inner.forEach(l => line(l ? `> ${l}` : '>'));
        line();
        break;
      }

      case 'table':
        table(b.head, b.rows.map(r => r.map(c => (c && typeof c === 'object') ? c.text : c)));
        break;

      case 'task':
        ctx.q = 0;
        ctx.task += 1;
        line(`#### ${ui.task || 'Task'} ${ctx.task}${b.title ? ' — ' + MARK(note(b.title)) + ' ' + T(b.title) : ''}`);
        line();
        b.blocks.forEach(x => block(x, ctx));
        break;

      case 'img':
        if (b.src) { line(`![](${encodeURI(`${imgDir}/${b.src}`)})`); line(); }
        if (b.caption) bare(b.caption);
        break;

      case 'video':
        line(`▶ https://youtu.be/${b.youtube}`); line();
        if (b.caption) bare(b.caption);
        break;

      case 'math': {
        // \text{@0} placeholders are translatable words: show the formula filled in, list the words with their keys
        const tex = b.tex.replace(/\\text\{@(\d+)\}/g, (_, i) => `\\text{${T(b.args && b.args[+i])}}`);
        line('$$'); line(tex); line('$$'); line();
        (b.args || []).forEach(k => line(inline('- ', k)));
        if (b.args && b.args.length) line();
        break;
      }

      default:
        if (b.text) bare(b.text);
    }
    return out.length - start;
  }

  /* ---------- front matter, title ---------- */
  line('---');
  line(`worksheet: ${slug}`);
  line(`language: ${lang}`);
  line('---');
  line();
  line(inline('# ', content.title)); line();
  const head = [ui.worksheet || 'Worksheet'];
  if (content.code) head.push(content.code);
  if (content.country && ui.countries && ui.countries[content.country]) head.push('· ' + ui.countries[content.country]);
  line(`*${head.join(' ')}*`); line();
  if (content.subtitle) bare(content.subtitle);
  if (opts.notice) { line(`> ${opts.notice}`); line(); }

  /* ---------- info table ---------- */
  const field = list => {
    if (typeof list === 'string') list = [{ text: list }];      // one text for every level
    if (!list || !list.length) return null;
    const oneForAll = list.length === 1 || new Set(list.map(x => x.text)).size === 1;
    if (oneForAll) return inline('', list[0].text);
    return list.map(x => `**${levelName(x.level)}:** ${inline('', x.text)}`).join('<br>');
  };
  const rows = [];
  for (const [label, list] of [
    [ui.topic || 'Topic', content.meta.topic],
    [ui.learningOutcomes || 'Learning outcomes', content.meta.outcomes],
    [ui.timeNeeded || 'Time needed', content.meta.time],
    [ui.resources || 'Resources', content.meta.resources]
  ]) {
    const f = field(list);
    if (f) rows.push(`| **${label}** | ${cell(f)} |`);
  }
  for (const extra of content.meta.extra || []) {
    rows.push(`| ${cell(inline('', extra.label))} | ${cell(inline('', extra.value))} |`);
  }
  if (rows.length) { line('|  |  |'); line('| --- | --- |'); rows.forEach(r => line(r)); line(); }

  /* ---------- levels ---------- */
  content.sections.forEach(section => {
    const name = section.kind === 'level' ? levelName(section.level).toUpperCase() : '';
    if (section.title) line(`## ${name ? name + ' — ' : ''}${MARK(note(section.title))} ${T(section.title)}`);
    else line(`## ${name}`);
    line();
    const ctx = { q: 0, task: 0 };
    section.blocks.forEach(b => block(b, ctx));
  });

  while (out[out.length - 1] === '') out.pop();
  return { text: out.join('\n') + '\n', keys: seen.size };
}

/* ---------- Markdown → { key: text } ---------- */
function parseMd(text) {
  const result = {};
  const conflicts = [];
  const put = (k, v) => {
    v = v.trim();
    if (!v) return;
    if (k in result && result[k] !== v) conflicts.push(k);
    else result[k] = v;
  };

  let front = {};
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n');
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) {
      for (const l of lines.slice(1, end)) { const m = l.match(/^(\w+):\s*(.*)$/); if (m) front[m[1]] = m[2].trim(); }
      lines.splice(0, end + 1);
    }
  }

  const inlineRe = new RegExp(`<!--(${KEY})-->`, 'g');
  const aloneRe = new RegExp(`^\\s*<!--(${KEY})-->\\s*$`);
  let pending = null;                                        // marker seen on its own line

  for (let raw of lines) {
    const l = raw.replace(/^(\s*>)+ ?/, '');                 // box quote prefix
    if (pending) {
      if (!l.trim()) continue;                               // blank line between marker and text
      put(pending, l);
      pending = null;
      continue;
    }
    const alone = l.match(aloneRe);
    if (alone) { pending = alone[1]; continue; }

    if (/^\s*\|/.test(l)) {                                  // table row: cells split on unescaped |
      for (const c of l.split(/(?<!\\)\|/)) {
        for (const part of c.split('<br>')) {
          const m = part.match(new RegExp(`<!--(${KEY})-->(.*)$`));
          if (m) put(m[1], m[2].replace(/\\\|/g, '|'));
        }
      }
      continue;
    }

    const m = inlineRe.exec(l);
    inlineRe.lastIndex = 0;
    if (m) put(m[1], l.slice(m.index + m[0].length));
  }
  return { texts: result, conflicts, front };
}

module.exports = { buildMd, parseMd };
