#!/usr/bin/env node
/* ============================================================
   GREEN Worksheets — reader CLI

   node tools/reader.mjs folder <dir> [--force]
        Read every .docx under <dir> (one sub-folder per country),
        write ws/<country>-<title>/ for each and the overview page
        ws/new-format.html. Unchanged documents are skipped.

   node tools/reader.mjs docx <file.docx> --id <slug> [--country nl]
        One Word document → ws/<slug>/

   node tools/reader.mjs doc  <export.md> --id <slug> [--doc-id <id>] [--doc-title <t>]
        Google Doc (Markdown export) → ws/<slug>/

        Each writes ws/<slug>/content.json, lang/en.json, img/*,
        strings.csv, and index.html if it is missing.

   node tools/reader.mjs sheet-csv <slug> [--google] [--out file.csv]
        CSV for a new translation Google Sheet: one row per text,
        existing translations filled in, missing ones as
        =GOOGLETRANSLATE(…). --google adds "<lang> (Google)" columns.

   node tools/reader.mjs from-sheet <sheet.csv> --id <slug>
        Translation Sheet (CSV export) → ws/<slug>/lang/<lang>.json
        (and lang/google/<lang>.json for "(Google)" columns)

   node tools/reader.mjs check <slug>
        Per-language coverage: missing and obsolete texts.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { parseDoc } = require('./parse-doc.js');
const { parseDocx } = require('./parse-docx.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['is', 'pt', 'hr', 'tr', 'nl'];                 // targets; English is the source
const GT_CODE = { is: 'is', pt: 'pt-PT', hr: 'hr', tr: 'tr', nl: 'nl' };   // Portugal partner → European Portuguese
const COUNTRY = {
  holland: 'nl', netherlands: 'nl', nederland: 'nl', tyrkland: 'tr', turkey: 'tr', 'türkiye': 'tr',
  'ísland': 'is', iceland: 'is', 'króatía': 'hr', croatia: 'hr', 'portúgal': 'pt', portugal: 'pt'
};

/* ---------- CSV (RFC 4180) ---------- */
function csvParse(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
const csvCell = v => /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
const csvLine = cells => cells.map(v => csvCell(String(v ?? ''))).join(',');

/* ---------- .docx = zip ---------- */
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a .docx (zip) file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = {};
  for (let n = 0; n < count && buf.readUInt32LE(p) === 0x02014b50; n++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + size);
    files[name] = method === 8 ? zlib.inflateRawSync(data) : data;
    p += 46 + nameLen + extraLen + commentLen;
  }
  return files;
}

function readDocx(file) {
  const zip = unzip(fs.readFileSync(file));
  const xml = {}, media = {};
  for (const [name, data] of Object.entries(zip)) {
    if (/^word\/(document|styles|numbering)\.xml$|^word\/_rels\/document\.xml\.rels$/.test(name)) xml[name] = data.toString('utf8');
    else if (name.startsWith('word/media/')) media[name] = data;
  }
  if (!xml['word/document.xml']) throw new Error('no word/document.xml inside');
  return { xml, media };
}

/* ---------- helpers ---------- */
function args(argv) {
  const pos = [], opt = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      opt[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else pos.push(argv[i]);
  }
  return { pos, opt };
}
const wsDir = slug => path.join(ROOT, 'ws', slug);
const readJSON = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJSON = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2) + '\n'); };
const texts = o => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith('_')));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function slugify(s) {
  const base = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (base.length <= 40) return base;
  return base.slice(0, 40).replace(/-[^-]*$/, '');
}

function coverage(slug) {
  const dir = wsDir(slug);
  const en = texts(readJSON(path.join(dir, 'lang', 'en.json')));
  const keys = Object.keys(en);
  const report = [];
  for (const sub of ['', 'google']) {
    for (const lang of LANGS) {
      const f = path.join(dir, 'lang', sub, `${lang}.json`);
      if (!fs.existsSync(f)) continue;
      let t;
      try { t = texts(readJSON(f)); }
      catch (e) { report.push({ lang: (sub ? sub + '/' : '') + lang, error: e.message }); continue; }
      const missing = keys.filter(k => !t[k]).length;
      const obsolete = Object.keys(t).filter(k => !(k in en)).length;
      report.push({ lang: (sub ? sub + '/' : '') + lang, done: keys.length - missing, total: keys.length, missing, obsolete });
    }
  }
  return report;
}
const coverageLines = slug => coverage(slug).map(r => r.error
  ? `  ${r.lang}: INVALID JSON — ${r.error}`
  : `  ${r.lang}: ${r.done}/${r.total} translated` + (r.missing ? `, ${r.missing} missing` : '') + (r.obsolete ? `, ${r.obsolete} obsolete` : ''));

function walk(blocks, fn) {
  for (const b of blocks) { fn(b); if (b.blocks) walk(b.blocks, fn); }
}

function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {                   // JPEG: find the SOF marker
    for (let i = 2; i < buf.length - 9;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

/* ---------- write one worksheet folder ---------- */
function writeWorksheet(slug, result, source) {
  const { content, strings, images, warnings } = result;
  const dir = wsDir(slug);
  content.id = slug;
  content.source = source;

  // images: content-addressed file names, so re-reading never duplicates them
  for (const im of images) {
    const buf = Buffer.from(im.base64, 'base64');
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }[im.mime] || 'bin';
    const name = `img/${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 10)}.${ext}`;
    fs.mkdirSync(path.join(dir, 'img'), { recursive: true });
    fs.writeFileSync(path.join(dir, name), buf);
    im.block.src = name;
    const size = imageSize(buf);
    if (size) Object.assign(im.block, size);
  }

  writeJSON(path.join(dir, 'content.json'), content);
  const en = { _meta: { language: 'en', source: source.type, readAt: source.readAt } };
  for (const s of strings) en[s.key] = s.en;
  writeJSON(path.join(dir, 'lang', 'en.json'), en);
  fs.writeFileSync(path.join(dir, 'strings.csv'), [csvLine(['key', 'where', 'en']), ...strings.map(s => csvLine([s.key, s.where, s.en]))].join('\n') + '\n');
  if (!fs.existsSync(path.join(dir, 'index.html'))) fs.copyFileSync(path.join(ROOT, 'tools', 'worksheet-index.html'), path.join(dir, 'index.html'));

  let tasks = 0, qs = 0;
  for (const s of content.sections) walk(s.blocks, b => { if (b.t === 'task') tasks++; if (b.t === 'q') qs++; });
  return {
    slug, title: strings.find(s => s.key === content.title)?.en || slug, code: content.code, country: content.country,
    levels: content.levels, texts: strings.length, sections: content.sections.length, tasks, questions: qs, images: images.length, warnings
  };
}

function printSummary(r) {
  console.log(`✔ ws/${r.slug}: ${r.texts} texts, ${r.sections} sections, levels [${r.levels.join(', ')}], ${r.tasks} tasks, ${r.questions} questions, ${r.images} images`);
  for (const w of r.warnings) console.log(`  ⚠ ${w}`);
}

/* ---------- commands ---------- */
function cmdDoc(file, opt) {
  if (!opt.id) throw new Error('--id <slug> is required');
  const source = { type: 'gdoc', id: opt['doc-id'] || null, title: opt['doc-title'] || null, readAt: new Date().toISOString() };
  const r = writeWorksheet(opt.id, parseDoc(fs.readFileSync(file, 'utf8'), { country: opt.country }), source);
  printSummary(r);
  for (const line of coverageLines(opt.id)) console.log(line);
}

function cmdDocx(file, opt) {
  if (!opt.id) throw new Error('--id <slug> is required');
  const r = writeWorksheet(opt.id, parseDocx(readDocx(file), { country: opt.country }), docxSource(file));
  printSummary(r);
  for (const line of coverageLines(opt.id)) console.log(line);
}

function docxSource(file) {
  return { type: 'docx', file: path.relative(ROOT, file).split(path.sep).join('/'), modified: fs.statSync(file).mtime.toISOString(), readAt: new Date().toISOString() };
}

function cmdFolder(dir, opt) {
  const files = [];
  (function find(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) find(p);
      else if (/\.docx$/i.test(e.name) && !e.name.startsWith('~$')) files.push(p);
    }
  })(dir);
  files.sort();

  // earlier reads, so unchanged documents keep their folder and are skipped
  const known = {};
  for (const e of fs.readdirSync(path.join(ROOT, 'ws'), { withFileTypes: true })) {
    const f = path.join(ROOT, 'ws', e.name, 'content.json');
    if (!e.isDirectory() || !fs.existsSync(f)) continue;
    const c = readJSON(f);
    if (c.source && c.source.type === 'docx') known[c.source.file] = { slug: e.name, modified: c.source.modified };
  }

  const rows = [], used = new Set();
  let read = 0, skipped = 0, failed = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const folder = path.basename(path.dirname(file));
    const country = COUNTRY[folder.toLowerCase()] || null;
    const prev = known[rel];
    const modified = fs.statSync(file).mtime.toISOString();
    try {
      if (prev && prev.modified === modified && !opt.force) {
        const c = readJSON(path.join(wsDir(prev.slug), 'content.json'));
        const en = texts(readJSON(path.join(wsDir(prev.slug), 'lang', 'en.json')));
        let tasks = 0, qs = 0;
        for (const s of c.sections) walk(s.blocks, b => { if (b.t === 'task') tasks++; if (b.t === 'q') qs++; });
        rows.push({ slug: prev.slug, title: en[c.title] || prev.slug, code: c.code, country: c.country, levels: c.levels,
          texts: Object.keys(en).length, sections: c.sections.length, tasks, questions: qs, images: 0, warnings: c._warnings || [], file: rel, unchanged: true });
        used.add(prev.slug);
        skipped++;
        continue;
      }
      const result = parseDocx(readDocx(file), { country });
      const title = result.strings.find(s => s.key === result.content.title)?.en || path.basename(file, '.docx');
      let slug = prev ? prev.slug : `${country || 'xx'}-${slugify(title)}`;
      // never write into a folder that belongs to something else (ws01, the demo, another document)
      for (let n = 2; used.has(slug) || (!prev && fs.existsSync(wsDir(slug))); n++) slug = `${country || 'xx'}-${slugify(title)}-${n}`;
      used.add(slug);
      result.content._warnings = result.warnings;
      const r = writeWorksheet(slug, result, docxSource(file));
      r.file = rel;
      rows.push(r);
      printSummary(r);
      read++;
    } catch (e) {
      console.log(`✖ ${rel}: ${e.message}`);
      rows.push({ slug: null, title: path.basename(file), file: rel, country, error: e.message, levels: [], warnings: [] });
      failed++;
    }
  }
  writeOverview(rows);
  console.log(`\n${read} read, ${skipped} unchanged, ${failed} failed → ws/new-format.html`);
}

/* overview page of every document read from the folder */
function writeOverview(rows) {
  const levelName = { basic: 'Basic', medium: 'Medium', advanced: 'Advanced' };
  const tr = rows.map(r => {
    if (r.error) return `<tr class="bad"><td>${r.country ? `<img src="../img/flags/${r.country}.svg" alt="">` : ''}</td><td>${esc(r.title)}<div class="file">${esc(r.file)}</div></td><td colspan="4">✖ ${esc(r.error)}</td></tr>`;
    const cov = r.slug ? coverage(r.slug).filter(c => !c.lang.includes('/')) : [];
    const langs = ['en', ...LANGS].map(l => {
      const c = cov.find(x => x.lang === l);
      const state = l === 'en' ? 'ok' : !c ? 'none' : c.missing ? 'part' : 'ok';
      return `<a class="lang ${state}" href="${r.slug}/?lang=${l}" title="${l}${c ? ` ${c.done}/${c.total}` : ''}">${l}</a>`;
    }).join('');
    const lv = r.levels.map(l => `<span class="lvl lvl-${l}">${levelName[l]}</span>`).join(' ') || '<span class="muted">–</span>';
    const warn = r.warnings.length ? `<details><summary>⚠ ${r.warnings.length}</summary><ul>${r.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></details>` : '✔';
    return `<tr><td>${r.country ? `<img src="../img/flags/${r.country}.svg" alt="${r.country}">` : ''}</td>` +
      `<td><a href="${r.slug}/">${esc(r.title)}</a>${r.code ? ` <span class="muted">(${esc(r.code)})</span>` : ''}<div class="file">${esc(r.file)}</div></td>` +
      `<td>${lv}</td><td class="num">${r.tasks} / ${r.questions}</td><td class="num">${r.texts}</td><td>${langs}</td><td>${warn}</td></tr>`;
  }).join('\n');
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>New-format worksheets</title>
<link rel="icon" href="../img/favicon.svg" type="image/svg+xml">
<!-- Generated by tools/reader.mjs folder — do not edit by hand. -->
<style>
  body { font: 14px/1.5 "Open Sans", system-ui, sans-serif; margin: 0; padding: 24px 16px; background: #f4f6f3; color: #1a1a1a; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font: 400 26px "Lato", system-ui, sans-serif; margin: 0 0 4px; }
  p.lede { margin: 0 0 18px; color: #555; }
  .wrap { overflow-x: auto; background: #fff; border-radius: 10px; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
  table { border-collapse: collapse; width: 100%; min-width: 760px; }
  th, td { padding: 8px 10px; border-bottom: 1px solid #e3e6e1; text-align: left; vertical-align: top; }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .05em; color: #555; background: #eef3ea; }
  td img { width: 24px; height: 17px; box-shadow: 0 0 0 1px rgba(0,0,0,.12); margin-top: 2px; }
  a { color: #1d6437; }
  .file { font-size: 11.5px; color: #777; }
  .muted { color: #888; }
  .num { white-space: nowrap; }
  .lvl { display: inline-block; font-size: 11px; font-weight: 700; padding: 1px 7px; border-radius: 99px; border: 1px solid; margin: 1px 0; }
  .lvl-basic { color: #2e7d4f; background: #e6f1da; } .lvl-medium { color: #a45a00; background: #fbeedb; } .lvl-advanced { color: #334a9e; background: #e4e8f7; }
  .lang { display: inline-block; min-width: 24px; text-align: center; font-size: 11.5px; font-weight: 700; padding: 1px 4px; margin: 1px; border-radius: 4px; text-decoration: none; }
  .lang.ok { background: #1d6437; color: #fff; } .lang.part { background: #f3c85c; color: #3a2a00; } .lang.none { background: #eee; color: #999; }
  details summary { cursor: pointer; color: #8a5a00; } details ul { margin: 6px 0 0; padding-left: 18px; font-size: 12.5px; }
  tr.bad td { background: #fff1f0; }
</style>
</head>
<body>
<main>
<h1>New-format worksheets</h1>
<p class="lede">Read from Word documents by <code>node tools/reader.mjs folder</code> · ${rows.length} documents · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.
Language buttons: green = translated, yellow = partly, grey = not yet.</p>
<div class="wrap"><table>
<thead><tr><th></th><th>Worksheet</th><th>Levels</th><th>Tasks / questions</th><th>Texts</th><th>Languages</th><th>Check</th></tr></thead>
<tbody>
${tr}
</tbody></table></div>
</main>
</body>
</html>
`;
  fs.writeFileSync(path.join(ROOT, 'ws', 'new-format.html'), html);
}

function cmdSheetCsv(slug, opt) {
  const dir = wsDir(slug);
  const strings = csvParse(fs.readFileSync(path.join(dir, 'strings.csv'), 'utf8')).slice(1).filter(r => r[0]);
  const have = {};
  for (const lang of LANGS) {
    const f = path.join(dir, 'lang', `${lang}.json`);
    have[lang] = fs.existsSync(f) ? texts(readJSON(f)) : {};
  }
  const header = ['key', 'where', 'en'];
  for (const lang of LANGS) header.push(lang, ...(opt.google ? [`${lang} (Google)`] : []));
  // row 2: a teacher sets their language to TRUE once the whole column is checked
  const reviewed = ['_reviewed', 'TRUE when a teacher has checked the whole column', ''];
  for (const lang of LANGS) {
    const f = path.join(dir, 'lang', `${lang}.json`);
    reviewed.push(fs.existsSync(f) && readJSON(f)._meta?.reviewed ? 'TRUE' : 'FALSE', ...(opt.google ? [''] : []));
  }
  const lines = [csvLine(header), csvLine(reviewed)];
  const last = strings.length + 2;
  strings.forEach(([key, where, en], i) => {
    const row = i + 3;
    // missing texts: one formula per cell, so a teacher can overwrite each one
    const gt = lang => `=GOOGLETRANSLATE($C${row},"en","${GT_CODE[lang]}")`;
    // "(Google)" comparison columns: one formula fills the whole column
    const gtColumn = lang => i === 0 ? `=BYROW(C3:C${last},LAMBDA(r,IF(r="","",GOOGLETRANSLATE(r,"en","${GT_CODE[lang]}"))))` : '';
    const cells = [key, where, en];
    for (const lang of LANGS) {
      cells.push(have[lang][key] || gt(lang));
      if (opt.google) cells.push(gtColumn(lang));
    }
    lines.push(csvLine(cells));
  });
  const out = lines.join('\n') + '\n';
  if (opt.out) { fs.writeFileSync(opt.out, out); console.log(`✔ ${opt.out}: ${strings.length} rows`); }
  else process.stdout.write(out);
}

function cmdFromSheet(file, opt) {
  if (!opt.id) throw new Error('--id <slug> is required');
  const dir = wsDir(opt.id);
  const en = texts(readJSON(path.join(dir, 'lang', 'en.json')));
  const [header, ...rows] = csvParse(fs.readFileSync(file, 'utf8'));
  const col = name => header.findIndex(h => h.trim().toLowerCase() === name);
  const keyCol = col('key');
  if (keyCol < 0) throw new Error('No "key" column in the sheet');
  const bad = /^(#VALUE!|#N\/A|#ERROR!|#NAME\?|Loading\.\.\.)$/;

  for (const [sub, suffix] of [['', ''], ['google', ' (google)']]) {
    for (const lang of LANGS) {
      const c = col(lang + suffix);
      if (c < 0) continue;
      const flag = rows.find(r => r[keyCol] === '_reviewed');
      const out = { _meta: {
        language: lang,
        source: sub ? 'google' : 'sheet',
        reviewed: !sub && /^(true|yes|já|ja|sim|da|evet)$/i.test((flag && flag[c] || '').trim()),
        readAt: new Date().toISOString()
      } };
      let n = 0, errors = 0;
      for (const r of rows) {
        const key = r[keyCol], val = (r[c] || '').trim();
        if (!key || !(key in en)) continue;
        if (!val || bad.test(val)) { if (val) errors++; continue; }
        out[key] = val; n++;
      }
      writeJSON(path.join(dir, 'lang', sub, `${lang}.json`), out);
      console.log(`✔ ${path.join('lang', sub, lang + '.json')}: ${n}/${Object.keys(en).length}` + (errors ? ` (${errors} cells with errors)` : ''));
    }
  }
}

/* ---------- main ---------- */
const [cmd, ...rest] = process.argv.slice(2);
const { pos, opt } = args(rest);
try {
  if (cmd === 'folder') cmdFolder(path.resolve(pos[0] || path.join(ROOT, 'New Worksheets septemeber 2026')), opt);
  else if (cmd === 'docx') cmdDocx(pos[0], opt);
  else if (cmd === 'doc') cmdDoc(pos[0], opt);
  else if (cmd === 'sheet-csv') cmdSheetCsv(pos[0], opt);
  else if (cmd === 'from-sheet') cmdFromSheet(pos[0], opt);
  else if (cmd === 'check') { console.log(pos[0]); for (const l of coverageLines(pos[0])) console.log(l); }
  else { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 32).join('\n')); process.exit(cmd ? 1 : 0); }
} catch (e) {
  console.error('✖ ' + e.message);
  process.exit(1);
}
