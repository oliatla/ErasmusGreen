/* ============================================================
   GREEN Worksheets — document reader ("lesari")

   Turns a worksheet document into a language-neutral structure
   + a table of English strings. Two front ends share one builder:

     parseDoc(markdown)   Google Docs Markdown export
     parseDocx(files)     Word .docx  (see parse-docx.js)

   Both produce a flat list of tokens (heading, para, ul, ol, table,
   box, img, video, math, lines); buildWorksheet() infers the
   structure: title, info table, Basic / Medium / Advanced sections,
   tasks, questions with answer lines, boxes, formulas, videos.

   Pure JavaScript with no Node or browser APIs.

     const { parseDoc } = require('./parse-doc.js');
     const { content, strings, images, warnings } = parseDoc(markdown);

   Keys are a hash of the English text, so inserting or moving
   paragraphs never breaks existing translations; a text that is
   edited gets a new key and shows up as "to translate".
   ============================================================ */
'use strict';

const LEVEL_WORDS = {
  basic:    /^(basic|grunnstig|básico|osnovn\w*|temel|basis)\b/i,
  medium:   /^(medium|intermediate|miðstig|intermédio|médio|srednj\w*|orta|gemiddeld)\b/i,
  advanced: /^(advanced|framhaldsstig|avançado|napredn\w*|ileri|gevorderd)\b/i
};
const LEVEL_ORDER = ['basic', 'medium', 'advanced'];

/* Headings that start with one of these become a highlighted box. */
const BOX_WORDS = /^(worked example|example|tip|hint|note|did you know|remember|peer[- ]to[- ]peer|what you should already know|target learning outcomes?|key formula)\b/i;

/* Section / task titles whose lists are questions with answer lines. */
const QUESTION_SECTIONS = /reflect|question|exercise|task|activit/i;

/* "Student activity 2", "Activity 1.1: Title", "Task 3 – Title" */
const TASK_RE = /^(?:student\s+activity|activity|task|exercise)\s*(\d+(?:\.\d+)?)\s*[:.\-–—]?\s*(.*)$/i;

/* Answer options: "[ A ] text", "A) text" */
const OPTION_RE = /^(?:\[\s*([A-Ea-e])\s*\]|([A-Ea-e])\))\s*(.+)$/;

/* A bullet inside a task is a question when it asks something or tells the student to do something. */
const TASK_VERB = /^(calculate|compute|determine|estimate|explain|describe|discuss|name|list|identify|compare|write|draw|sketch|design|find|propose|suggest|give|complete|fill|choose|circle|tick|mark|think|evaluate|analy[sz]e|research|investigate|create|plan|consider|predict|check|count|read|observe|measure|record|note|show|summari[sz]e|reflect|justify|critically|look|use|work out|convert|rank|sort|decide|imagine|prepare|present|search|visit|ask|interview|photograph|take|make|build|test|try|how|what|why|which|when|where|who|is|are|do|does|can|could|would|should|will)\b/i;

/* "Answer: ________" under a question = its answer line */
const ANSWER_LINE = /^(answer|svar|resposta|odgovor|cevap|antwoord)\s*:\s*_{3,}[\s._]*$/i;

const META_FIELDS = [
  ['name',      /^(student\s*name|name|date)\b/i],
  ['country',   /^(country|partner|land)\b/i],
  ['topic',     /^(topic|subject)\b/i],
  ['outcomes',  /^(learning outcomes?|learning objectives?|objectives|outcomes)\b/i],
  ['time',      /^(time)\b/i],
  ['resources', /^(resources|materials|equipment)\b/i],
  ['level',     /^(level)\b/i]
];

const COUNTRY_CODES = {
  iceland: 'is', portugal: 'pt', croatia: 'hr', turkey: 'tr', 'türkiye': 'tr', turkiye: 'tr',
  netherlands: 'nl', 'the netherlands': 'nl', holland: 'nl'
};

/* ---------- small text helpers ---------- */

/* FNV-1a over UTF-16 code units → "t" + 8 hex chars. Deterministic everywhere.
   The letter keeps all-digit hashes from being reordered inside JSON objects. */
function hashKey(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return 't' + h.toString(16).padStart(8, '0');
}

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/* Google escapes most punctuation (\=, \(, \_, \[ …). Undo that, but keep
   \* so a literal asterisk is never mistaken for bold/italic later. */
function unescapeText(s) {
  return s.replace(/\\([\\`_{}\[\]()#+\-.!|<>=~^$&%'":;,?@])/g, '$1');
}
function unescapeAll(s) {
  return s.replace(/\\([\\`*_{}\[\]()#+\-.!|<>=~^$&%'":;,?@])/g, '$1');
}

/* "**Title**" → "Title" (Google wraps imported headings in bold). */
function unwrapBold(s) {
  const t = s.trim();
  const m = /^\*\*(.+)\*\*$/.exec(t);
  return m && !m[1].includes('**') ? m[1].trim() : t;
}

/* text without inline markers, for pattern matching */
function plain(s) {
  return normalize(unescapeText(s).replace(/\*\*|(^|\s)\*|\*(\s|$)/g, '$1$2').replace(/\*/g, ''));
}

function levelOf(text) {
  for (const lvl of LEVEL_ORDER) if (LEVEL_WORDS[lvl].test(text)) return lvl;
  return null;
}

/* "Basic — Observe", "Basic level: Sensors…", "LEVEL 2: MEDIUM (The audit)" → { level, rest } */
function splitLevelHeading(text) {
  const t = text.replace(/^level\s*\d+\s*[:.\-–—]?\s*/i, '');
  const numbered = t !== text;                                  // "LEVEL 3: ADVANCED ENGINEERING" is always a level
  const level = levelOf(t);
  if (!level) return null;
  const after = t.replace(LEVEL_WORDS[level], '');
  // "Advanced PV engineering" is a normal heading; "Advanced", "Advanced level …", "Advanced — …" are levels
  if (!numbered && !/^\s*($|(level|stig|nível|razina|seviye|niveau)\b|[:—–\-(])/i.test(after)) return null;
  const rest = after
    .replace(/^\s*(level|stig|nível|razina|seviye|niveau)?\s*[—–:\-.]?\s*/i, '')
    .replace(/^\((.*)\)$/, '$1');
  return { level, rest: rest.trim() };
}

/* "Basic/intermediate", "BASIC", "Medium & Advanced" → ['basic', 'medium'] */
function levelsIn(text) {
  const out = [];
  for (const part of text.split(/[\/,&+]|\band\b/i)) {
    const lv = levelOf(part.trim());
    if (lv && !out.includes(lv)) out.push(lv);
  }
  return out;
}

/* "Basic: A. Medium level – B." → [{level:'basic', text:'A.'}, …]; no prefixes → one item. */
function splitByLevelPrefix(text) {
  // only at the start or after a separator, so "For the Advanced level: …" stays one sentence
  const re = /(^|\n|[.;·,•|\/]\s*)(basic|medium|intermediate|advanced)(?:\s+level)?\s*[:\-–—]\s*/gi;
  const marks = [];
  let m;
  while ((m = re.exec(text))) marks.push({ at: m.index + m[1].length, after: re.lastIndex, level: levelOf(m[2]) });
  if (!marks.length) return [{ level: null, text: text.trim() }];
  const out = [];
  if (marks[0].at > 0 && text.slice(0, marks[0].at).trim()) out.push({ level: null, text: text.slice(0, marks[0].at).trim() });
  marks.forEach((mk, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].at : text.length;
    const piece = text.slice(mk.after, end).replace(/[\s·;,]+$/, '').trim();
    if (piece) out.push({ level: mk.level, text: piece });
  });
  return out;
}

function short(s, n = 40) {
  const t = s.replace(/\*\*|\*/g, '');
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ---------- front end 1: Google Docs Markdown → tokens ---------- */

function tokenizeMarkdown(md) {
  const lines = md.replace(/\r\n?/g, '\n').split('\n');
  const refs = {};
  const body = [];
  for (const line of lines) {
    const ref = /^\[([^\]]+)\]:\s*<?(data:[^>\s]+|https?:[^>\s]+)>?\s*$/.exec(line);
    if (ref) refs[ref[1]] = ref[2];
    else body.push(line);
  }

  const tokens = [];
  let i = 0;
  while (i < body.length) {
    const line = body[i].replace(/^>\s?/, '');          // Google exports indented text as blockquote
    if (!line.trim()) { i++; continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { tokens.push({ type: 'heading', depth: h[1].length, text: unwrapBold(h[2]) }); i++; continue; }

    if (/^\s*\|/.test(line)) {
      const rows = [];
      while (i < body.length && /^\s*\|/.test(body[i].replace(/^>\s?/, ''))) {
        const r = body[i].replace(/^>\s?/, '').trim();
        if (!/^\|(\s*:?-{2,}:?\s*\|)+$/.test(r)) rows.push(splitRow(r));
        i++;
      }
      tokens.push({ type: 'table', rows });
      continue;
    }

    const li = /^\s*([*+\-]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const items = [];
      while (i < body.length) {
        const l = body[i].replace(/^>\s?/, '');
        const m = /^\s*([*+\-]|\d+[.)])\s+(.*)$/.exec(l);
        if (!m || /\d/.test(m[1]) !== ordered) break;
        items.push(m[2].replace(/\s+$/, ''));
        i++;
      }
      tokens.push({ type: ordered ? 'ol' : 'ul', items });
      continue;
    }

    const text = line.replace(/\s+$/, '').replace(/\\$/, '');
    tokens.push({ type: 'para', text, boldAll: /^\*\*[^*]+\*\*$/.test(text.trim()) });
    i++;
  }
  return { tokens, refs };
}

function splitRow(r) {
  const cells = [];
  let cur = '';
  for (let k = 1; k < r.length; k++) {           // skip the leading pipe
    const c = r[k];
    if (c === '\\' && r[k + 1] === '|') { cur += '|'; k++; continue; }
    if (c === '|') { cells.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  return cells;
}

/* ---------- token clean-up shared by both front ends ---------- */

/* Paragraph that is formatted like a heading: large or all-bold, short, no sentence end. */
function headingLike(tok) {
  if (tok.type !== 'para' || !(tok.boldAll || (tok.size || 1) >= 1.25)) return false;
  const t = plain(tok.text);
  return t.length > 0 && t.length <= 90 && !/[.!;,:]$/.test(t) && !/_{3,}/.test(t) && !OPTION_RE.test(t);
}

function classifyHeading(tok) {
  const text = plain(tok.text);
  if (tok.depth === undefined || tok.depth <= 2) {
    const lv = splitLevelHeading(text);
    if (lv) {
      tok.level = lv.level;
      tok.rest = lv.rest;
      return tok;
    }
  }
  const task = TASK_RE.exec(text);
  if (task) { tok.task = task[1]; tok.rest = task[2]; }
  return tok;
}

function prepare(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'heading') { out.push(classifyHeading(tok)); continue; }
    if (tok.type !== 'para') { out.push(tok); continue; }

    const t = plain(tok.text);
    if (!t) continue;

    // a row of underscores = an answer line
    if (/^[_\s.…]+$/.test(t) && /_{5,}/.test(t)) {
      const last = out[out.length - 1];
      if (last && last.type === 'lines') last.n++;
      else out.push({ type: 'lines', n: 1 });
      continue;
    }
    if (headingLike(tok)) {
      out.push(classifyHeading({ type: 'heading', auto: true, text: unwrapBold(tok.text) }));
      continue;
    }
    // hand-made lists: "• text", "1. text", "1- text", "1) text"
    const bullet = /^\s*(?:\*\*)?(?:[•·▪◦‣●○■□](?:\*\*)?\s*|[–-](?:\*\*)?\s+)(.*)$/.exec(tok.text);
    const numbered = /^\s*(?:\*\*)?(\d{1,2})\s*[.)\-–]\s*(?=\S)(?!\d)(.*)$/.exec(tok.text);
    if (bullet || numbered) {
      const type = bullet ? 'ul' : 'ol';
      let item = bullet ? bullet[1] : numbered[2];
      if (/^\*\*/.test(tok.text.trim()) && !/^\*\*/.test(item)) item = '**' + item;   // keep a bold run that started before the number
      const last = out[out.length - 1];
      if (last && last.type === type && last.manual) last.items.push(item);
      else out.push({ type, items: [item], manual: true });
      continue;
    }
    out.push(tok);
  }
  return out;
}

/* ---------- builder: tokens → worksheet ---------- */

function buildWorksheet(input, opts = {}) {
  const tokens = prepare(input.tokens);
  const refs = input.refs || {};
  const strings = [];
  const byKey = {};
  const warnings = [];
  const images = [];

  function str(text, where) {
    const t = normalize(unescapeText(text));
    if (!t) return null;
    let key = hashKey(t);
    while (byKey[key] !== undefined && byKey[key] !== t) key = hashKey(key + t);   // collision guard
    if (byKey[key] === undefined) { byKey[key] = t; strings.push({ key, where, en: t }); }
    return key;
  }

  const content = {
    schema: 1,
    id: opts.id || null,
    source: opts.source || null,
    country: opts.country || null,
    code: null,
    title: null,
    subtitle: null,
    levels: [],
    meta: { topic: null, outcomes: [], time: [], resources: null, extra: [] },
    sections: []
  };

  function setTitle(text) {
    let t = plain(text);
    const ws = /^worksheet\s*([\w.]*)\s*[:–—-]\s*(.+)$/i.exec(t);
    if (ws) { content.code = ws[1] || content.code; t = ws[2]; }
    const num = /^(\d+(?:\.\d+)*)\.?\s+(.+)$/.exec(t);
    if (num) { content.code = content.code || num[1]; t = num[2]; }
    content.title = str(t, 'Title');
  }

  // --- front matter: title, subtitle, "Level:" line, info table
  const hasLevelHeadings = tokens.some(t => t.type === 'heading' && t.level);
  let declared = [];
  let metaDone = false;
  let k = 0;
  for (; k < tokens.length; k++) {
    const b = tokens[k];
    const text = b.text !== undefined ? plain(b.text) : '';
    const isHeading = b.type === 'heading';
    if (isHeading && (b.level || b.task)) break;
    if (isHeading && !b.auto && b.depth >= 2) break;
    if (isHeading && b.auto && metaDone) break;
    if ((isHeading || b.type === 'para') && /^level\s*[:\-–—]/i.test(text)) {
      declared = levelsIn(text.replace(/^level\s*[:\-–—]\s*/i, ''));
      continue;
    }
    if (isHeading || b.type === 'para') {
      const label = /^worksheet\s*([\w.]*)$/i.exec(text);
      if (label && !content.title) { content.code = label[1] || null; continue; }
      if (!content.title) { setTitle(b.text); continue; }
      if (!content.subtitle && !metaDone) { content.subtitle = str(b.text, 'Subtitle'); continue; }
      break;                                                   // the body starts here
    }
    if (b.type === 'table' && !metaDone && isMetaTable(b.rows)) { readMeta(b.rows); metaDone = true; continue; }
    break;
  }
  if (!content.title) warnings.push('No title found.');

  function cellText(c) { return (c && typeof c === 'object' ? c.text : c) || ''; }

  function isMetaTable(rows) {
    const labels = rows.map(r => plain(cellText(r[0])));
    return labels.filter(l => META_FIELDS.some(([, re]) => re.test(l))).length >= 2;
  }

  function readMeta(rows) {
    for (const row of rows.map(r => r.map(cellText))) {
      if (row.length < 2) continue;
      const label = plain(row[0]).replace(/:$/, '');
      const value = row.slice(1).filter(c => plain(c)).join('\n').trim();
      const field = (META_FIELDS.find(([, re]) => re.test(label)) || [null])[0];
      const where = `Info › ${label}`;
      if (field === 'name' || !value) continue;               // the engine prints its own name/date line
      if (field === 'country') {
        const v = plain(value).toLowerCase().replace(/\(.*\)/, '').trim();
        content.country = /^[a-z]{2}$/.test(v) ? v : (COUNTRY_CODES[v] || v.slice(0, 2));
      } else if (field === 'level') {
        declared = declared.length ? declared : levelsIn(plain(value));
      } else if (field === 'topic' || field === 'resources') {
        const parts = leveled(value);
        content.meta[field] = parts.some(p => p.level) || parts.length > 1
          ? parts.map(p => ({ level: p.level, text: str(p.text, `${where}${p.level ? ' › ' + p.level : ''}`) }))
          : str(parts[0].text, where);
      } else if (field === 'outcomes' || field === 'time') {
        let parts = leveled(value);
        // "60 – 90 – 150 min": one time per level
        const three = /^(\d+)\s*[–—-]\s*(\d+)\s*[–—-]\s*(\d+)\s*(min\w*|h\w*)$/i.exec(plain(value));
        if (field === 'time' && three) parts = LEVEL_ORDER.map((level, i) => ({ level, text: `${three[i + 1]} ${three[4]}` }));
        content.meta[field] = parts.map(p => ({ level: p.level, text: str(p.text, `${where}${p.level ? ' › ' + p.level : ''}`) }));
      } else content.meta.extra.push({ label: str(label, where), value: str(value, where) });
    }
  }

  /* a cell with "Basic level:" prefixes (inline or on their own lines) → leveled parts */
  function leveled(value) {
    const lines = value.split('\n').map(l => l.trim()).filter(l => plain(l));
    const out = [];
    let level = null;
    for (const line of lines) {
      const only = /^(?:\*\*)?(basic|medium|intermediate|advanced)(?:\s+level)?\s*[:\-–—]?\s*(?:\*\*)?$/i.exec(line);
      if (only) { level = levelOf(only[1]); continue; }
      const bullet = /^[•·▪◦‣●○■□–-]\s*/.test(line);             // each bullet is its own item
      for (const p of splitByLevelPrefix(unescapeText(line.replace(/^[•·▪◦‣●○■□–-]\s*/, '')))) {
        const lv = p.level || level;
        const prev = out[out.length - 1];
        if (prev && prev.level === lv && !p.level && lv && !bullet) prev.text += ' ' + p.text;   // continuation line
        else out.push({ level: lv, text: p.text });
      }
    }
    return out.length ? out : [{ level: null, text: value }];
  }

  // --- sections
  let section = null, task = null, box = null, taskNo = 0, ctx = '';
  const target = () => (box || task || section).blocks;

  function openCommon(title) {
    task = null; taskNo = 0; box = null;
    const name = title ? short(plain(title), 24) : 'Section';
    section = { kind: 'common', title: title ? str(title, `${name} › heading`) : null, blocks: [], _name: name };
    content.sections.push(section);
    ctx = title || '';
  }
  function openLevel(level, title, also) {
    task = null; taskNo = 0; box = null;
    section = { kind: 'level', level, title: title ? str(title, `${cap(level)} › heading`) : null, blocks: [], _name: cap(level) };
    if (also && also.length > 1) section.levels = also;
    for (const lv of also && also.length ? also : [level]) if (!content.levels.includes(lv)) content.levels.push(lv);
    content.sections.push(section);
    ctx = title || '';
  }
  function openTask(title) {
    box = null;
    taskNo++;
    task = { t: 'task', title: str(title, `${section._name} › Task ${taskNo} › title`), blocks: [], _name: `${section._name} › Task ${taskNo}` };
    section.blocks.push(task);
    ctx = title;
  }

  if (!hasLevelHeadings && declared.length && k < tokens.length) openLevel(declared[0], null, declared);

  for (; k < tokens.length; k++) {
    const b = tokens[k];
    if (b.type === 'heading') {
      box = null;
      const text = unescapeText(b.text);
      if (b.level) {
        let title = b.rest || null;
        const next = tokens[k + 1];                                  // "LEVEL 3: ADVANCED" + "RISK ANALYSIS"
        if (!title && next && next.type === 'heading' && next.auto && !next.level && !next.task && !BOX_WORDS.test(plain(next.text))) {
          title = plain(next.text);
          k++;
        }
        openLevel(b.level, title);
        continue;
      }
      if (b.task) {
        let title = b.rest;
        const next = tokens[k + 1];
        if (!title && next && next.type === 'heading' && !next.level) {   // "Student activity 1" + bold title line
          title = next.task ? next.rest || plain(next.text) : plain(next.text);
          k++;
        }
        title = title || plain(text);
        if (!section) openCommon(null);
        if (section.kind === 'level') openTask(title);
        else { task = null; section.blocks.push({ t: 'h', text: str(title, `${section._name} › subheading`) }); ctx = title; }
        continue;
      }
      if (b.depth === 1 && !b.auto) {
        if (!content.title) setTitle(text); else openCommon(text);
        continue;
      }
      if (!section) {
        if (BOX_WORDS.test(plain(text))) openCommon(null); else { openCommon(text); continue; }
      }
      if (BOX_WORDS.test(plain(text))) {
        box = { t: 'box', title: str(text, `${section._name} › box`), blocks: [], _name: short(text, 24) };
        (task || section).blocks.push(box);
        continue;
      }
      if (b.auto) {
        if (section.kind === 'level') {
          task = null;
          section.blocks.push({ t: 'h', text: str(text, `${section._name} › subheading`) });
          ctx = text;
        } else openCommon(text);
        continue;
      }
      if (b.depth <= 2) {
        const lv = splitLevelHeading(plain(text));
        if (lv) openLevel(lv.level, lv.rest || null); else openCommon(text);
      } else if (section.kind === 'level' && b.depth === 3) openTask(text);
      else {
        task = null;
        section.blocks.push({ t: 'h', text: str(text, `${section._name} › subheading`) });
        ctx = text;
      }
      continue;
    }
    if (!section) openCommon(null);
    const where = (box && `${(task || section)._name} › ${box._name}`) || (task && task._name) || section._name;
    addBlock(b, where, target());
  }

  function isQuestion(item, explicitLines, ordered) {
    const t = plain(item);
    if (explicitLines) return true;
    const verbAfterComma = new RegExp('[,;:]\\s+' + TASK_VERB.source.slice(1), 'i');   // "Using the savings, calculate …"
    const asks = /\?/.test(t) || /_{4,}|\[\s*\]/.test(t) || (t.length <= 40 && /:$/.test(t))
      || TASK_VERB.test(t.replace(/^[^:]{2,60}:\s*/, '')) || TASK_VERB.test(t) || verbAfterComma.test(t);
    if (task) return ordered || asks;
    if (QUESTION_SECTIONS.test(ctx)) return asks || ordered;
    return /\?\s*$/.test(t);
  }

  function addBlock(b, where, out) {
    const last = out[out.length - 1];

    if (b.type === 'lines') {
      if (last && last.t === 'q' && !last._lines) { last.lines = b.n; last._lines = true; }
      else out.push({ t: 'lines', n: b.n });
      return;
    }
    if (b.type === 'para') {
      const text = b.text.trim();
      const math = /^\$\$([\s\S]+)\$\$$/.exec(text);
      if (math) { out.push(mathBlock(unescapeAll(math[1]).trim(), where)); return; }

      const img = /^!\[([^\]]*)\]\[([^\]]+)\]\s*$/.exec(text) || /^!\[([^\]]*)\]\((data:[^)]+|https?:[^)]+)\)\s*$/.exec(text);
      if (img) {
        const src = refs[img[2]] || img[2];
        const data = /^data:(image\/[\w+.-]+);base64,(.+)$/.exec(src || '');
        addImage({ mime: data && data[1], base64: data && data[2], src: data ? null : src }, out, where);
        return;
      }
      const italic = /^\*([^*].*[^*]|[^*])\*$/.exec(text);
      if (italic && last && last.t === 'img' && !last.caption) { last.caption = str(italic[1], `${where} › image caption`); return; }

      const yt = /\[([^\]]+)\]\((https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})[^)]*)\)/.exec(text);
      if (yt) { out.push({ t: 'video', youtube: yt[3], caption: str(yt[1], `${where} › video`) }); return; }

      const opt = OPTION_RE.exec(plain(text));
      if (opt && last && last.t === 'q') {
        (last.options = last.options || []).push(str(opt[3], `${where} › Q option`));
        if (!last._lines) last.lines = 0;
        return;
      }
      if (ANSWER_LINE.test(plain(text)) && last && last.t === 'q') { last.lines = 1; last._lines = true; return; }
      out.push({ t: 'p', text: str(text, where) });
      return;
    }
    if (b.type === 'ul' || b.type === 'ol') {
      b.items.forEach((raw, n) => {
        const m = /\s*\\?\[(\d+)\\?\]\s*$/.exec(raw);
        const item = m ? raw.slice(0, m.index) : raw;
        const text = plain(item);
        if (!text) return;
        const prev = out[out.length - 1];
        // an intro line inside a list ("For each location, write …:")
        if (/:$/.test(text) && text.length > 40 && b.items.length > 1 && n === 0) { out.push({ t: 'p', text: str(item, where) }); return; }
        // a separate bullet list right under a question that ends with ":" = parts of that question
        if (b.type === 'ul' && prev && prev.t === 'q' && prev._token !== b && prev._subOk && (/_{4,}/.test(text) || text.length <= 80)) {
          (prev.items = prev.items || []).push(str(item, `${where} › Q item`));
          if (/_{4,}/.test(text) && !prev._lines) prev.lines = 0;
          return;
        }
        const opt = OPTION_RE.exec(text);
        if (opt && prev && prev.t === 'q') { (prev.options = prev.options || []).push(str(opt[3], `${where} › Q option`)); if (!prev._lines) prev.lines = 0; return; }
        if (isQuestion(item, !!m, b.type === 'ol')) {
          const lines = m ? +m[1] : /_{4,}|\[\s*\]/.test(text) ? 0 : text.length <= 40 ? 1 : 2;
          out.push({ t: 'q', text: str(item, `${where} › Q`), lines, _subOk: /:$/.test(text), _token: b });
        } else if (b.type === 'ol') out.push({ t: 'li', ordered: true, n: n + 1, text: str(item, `${where} › item ${n + 1}`) });
        else if (prev && prev.t === 'ul') prev.items.push(str(item, `${where} › bullet ${prev.items.length + 1}`));
        else out.push({ t: 'ul', items: [str(item, `${where} › bullet 1`)] });
      });
      return;
    }
    if (b.type === 'table') {
      if (b.rows.length === 1 && b.rows[0].length === 1) {        // 1×1 table from Google Docs → box
        const [first, ...rest] = b.rows[0][0].split('\n');
        const box = { t: 'box', title: null, blocks: [] };
        splitBoxTitle(box, [{ type: 'para', text: first }, ...rest.map(r => ({ type: 'para', text: r }))], where);
        out.push(box);
        return;
      }
      const [head, ...rows] = b.rows;
      const cell = (c, r, col) => {
        const span = typeof c === 'object' && c ? c.span : 0;
        const t = unwrapBold(typeof c === 'object' && c ? c.text : c).replace(/\n+/g, ' ').trim();
        let v;
        if (!t || /^_{3,}$/.test(plain(t))) v = '';
        else if (/^[-+]?\d+([.,]\d+)?$/.test(t)) v = { n: t.replace(',', '.') };
        else v = str(t, `${where} › table r${r}c${col}`);
        return span > 1 ? { k: v, span } : v;
      };
      out.push({
        t: 'table',
        head: head.map((c, col) => cell(c, 0, col + 1)),
        rows: rows.map((row, r) => row.map((c, col) => cell(c, r + 1, col + 1)))
      });
      return;
    }
    if (b.type === 'box') {
      const box = { t: 'box', title: null, blocks: [] };
      splitBoxTitle(box, prepare(b.tokens), where);
      if (box.title || box.blocks.length) out.push(box);
      return;
    }
    if (b.type === 'img') { addImage(b, out, where); return; }
    if (b.type === 'video') { out.push({ t: 'video', youtube: b.youtube, caption: b.caption ? str(b.caption, `${where} › video`) : null }); return; }
    if (b.type === 'math') { out.push(mathBlock(b.tex, where)); return; }
    if (b.type === 'heading') { out.push({ t: 'h', text: str(b.text, `${where} › subheading`) }); }
  }

  /* first bold line (or "**Title:** text") of a box becomes its title */
  function splitBoxTitle(box, toks, where) {
    const first = toks[0];
    if (first && (first.type === 'para' || first.type === 'heading')) {
      const lead = /^\*\*([^*]{2,80}?)[:\s]*\*\*\s*[:—–-]?\s*(.*)$/.exec(first.text.trim());
      if (lead) {
        box.title = str(lead[1].replace(/[:\s]+$/, ''), `${where} › box`);
        if (lead[2]) toks[0] = { type: 'para', text: lead[2] }; else toks = toks.slice(1);
      } else if (first.type === 'heading' || (plain(first.text).length <= 60 && BOX_WORDS.test(plain(first.text)))) {
        box.title = str(plain(first.text).replace(/:$/, ''), `${where} › box`);
        toks = toks.slice(1);
      }
    }
    const inner = box.title ? `${where} › ${short(plain(byKey[box.title] || ''), 24)}` : where;
    for (const t of toks) addBlock(t.type === 'heading' ? { type: 'para', text: `**${t.text}**` } : t, inner, box.blocks);
  }

  function addImage(im, out, where) {
    const block = { t: 'img', src: im.src || null, caption: im.caption ? str(im.caption, `${where} › image caption`) : null };
    if (im.w) { block.w = im.w; block.h = im.h; }
    if (im.base64) images.push({ mime: im.mime, base64: im.base64, block });
    else if (!im.src) { warnings.push('Image without data.'); return; }
    out.push(block);
  }

  /* Words inside \text{…} are translated; short unit names (kWh, W, h) are not. */
  function mathBlock(tex, where) {
    const args = [];
    const out = tex.replace(/\\text\{([^{}]*)\}/g, (all, inner) => {
      if (!/\s/.test(inner.trim()) && inner.trim().length <= 4) return all;
      args.push(str(inner, `${where} › formula text`));
      return `\\text{@${args.length - 1}}`;
    });
    return args.length ? { t: 'math', tex: out, args } : { t: 'math', tex: out };
  }

  // strip helper fields
  (function clean(blocks) {
    for (const b of blocks) {
      for (const f of ['_name', '_lines', '_subOk', '_token']) delete b[f];
      if (b.blocks) clean(b.blocks);
    }
  })(content.sections);
  for (const s of content.sections) delete s._name;

  if (!content.levels.length) warnings.push('No Basic / Medium / Advanced sections found.');
  content.levels.sort((a, b) => LEVEL_ORDER.indexOf(a) - LEVEL_ORDER.indexOf(b));
  let tasks = 0;
  (function count(bl) { for (const b of bl) { if (b.t === 'task') tasks++; if (b.blocks) count(b.blocks); } })(content.sections.flatMap(s => s.blocks));
  if (content.levels.length && !tasks) warnings.push('Level sections found, but no tasks ("Student activity N" / Heading 3).');

  return { content, strings, images, warnings };
}

function parseDoc(md, opts = {}) {
  return buildWorksheet(tokenizeMarkdown(md), opts);
}

module.exports = { parseDoc, buildWorksheet, tokenizeMarkdown, hashKey, splitByLevelPrefix, plain };
