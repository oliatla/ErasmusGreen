/* ============================================================
   GREEN Worksheets — Word (.docx) front end for the reader

     const { parseDocx } = require('./parse-docx.js');
     parseDocx({ xml: { 'word/document.xml': '…', … }, media: { 'word/media/image1.png': Buffer|base64 } }, opts)

   Reads paragraphs, heading styles, font size and bold (for headings
   that are only formatted, not styled), Word lists, tables (1×1 tables
   become boxes), text boxes, images, hyperlinks and equations (OMML →
   LaTeX), and hands a token list to buildWorksheet() in parse-doc.js.

   Pure JavaScript; unzipping the .docx is left to the caller.
   ============================================================ */
'use strict';

const { buildWorksheet } = require('./parse-doc.js');

/* ---------- tiny XML parser (enough for OOXML) ---------- */

const ENT = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (all, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? all));
}

function parseXML(src) {
  const root = { name: '#root', attrs: {}, children: [] };
  const stack = [root];
  const re = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|([^<]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const top = stack[stack.length - 1];
    if (m[6] !== undefined) {
      if (/\S/.test(m[6]) || top.name === 'w:t' || top.name === 'm:t') top.children.push(decode(m[6]));
    } else if (m[5] !== undefined) top.children.push(m[5]);
    else if (m[2]) {
      if (m[1]) { if (stack.length > 1) stack.pop(); continue; }
      const attrs = {};
      m[3].replace(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (a, k, v1, v2) => { attrs[k] = decode(v1 ?? v2); });
      const el = { name: m[2], attrs, children: [] };
      top.children.push(el);
      if (!m[4]) stack.push(el);
    }
  }
  return root;
}

const els = el => el.children.filter(c => typeof c === 'object');
const kid = (el, name) => el && els(el).find(c => c.name === name);
const kids = (el, name) => el ? els(el).filter(c => c.name === name) : [];
const val = (el, attr = 'w:val') => el && el.attrs[attr];
function* walk(el) {
  for (const c of els(el)) { yield c; yield* walk(c); }
}
const textOf = el => el.children.map(c => typeof c === 'string' ? c : '').join('');

/* ---------- document context: styles, numbering, relationships ---------- */

function loadContext(files) {
  const xml = name => files.xml[name] ? parseXML(files.xml[name]) : null;
  const styles = {};
  let defaultSize = 22;
  const st = xml('word/styles.xml');
  if (st) {
    const s = kid(st, 'w:styles');
    const dflt = kid(kid(kid(kid(s, 'w:docDefaults'), 'w:rPrDefault'), 'w:rPr'), 'w:sz');
    if (dflt) defaultSize = +val(dflt) || defaultSize;
    for (const el of kids(s, 'w:style')) {
      const ppr = kid(el, 'w:pPr'), rpr = kid(el, 'w:rPr');
      const num = kid(ppr, 'w:numPr');
      styles[val(el, 'w:styleId')] = {
        name: (val(kid(el, 'w:name')) || '').toLowerCase(),
        basedOn: val(kid(el, 'w:basedOn')),
        isDefault: el.attrs['w:default'] === '1' && el.attrs['w:type'] === 'paragraph',
        numId: num && val(kid(num, 'w:numId')),
        bold: rpr && boolProp(kid(rpr, 'w:b')),
        size: rpr && kid(rpr, 'w:sz') ? +val(kid(rpr, 'w:sz')) : undefined
      };
    }
    const normal = Object.values(styles).find(x => x.isDefault);
    if (normal && normal.size) defaultSize = normal.size;
  }
  const numFmt = {};
  const nb = xml('word/numbering.xml');
  if (nb) {
    const n = kid(nb, 'w:numbering');
    const abs = {};
    for (const a of kids(n, 'w:abstractNum')) {
      abs[val(a, 'w:abstractNumId')] = kids(a, 'w:lvl').map(l => val(kid(l, 'w:numFmt')) || 'bullet');
    }
    for (const num of kids(n, 'w:num')) numFmt[val(num, 'w:numId')] = abs[val(kid(num, 'w:abstractNumId'))] || ['bullet'];
  }
  const rels = {};
  const rx = xml('word/_rels/document.xml.rels');
  if (rx) for (const r of kids(kid(rx, 'Relationships'), 'Relationship')) rels[r.attrs.Id] = { target: r.attrs.Target, external: r.attrs.TargetMode === 'External' };
  return { styles, defaultSize, numFmt, rels, media: files.media || {}, fields: [] };
}

/* page numbers are computed by Word and mean nothing on the web
   (the text of a TOC field is kept: one worksheet lists its levels that way) */
const HIDDEN_FIELD = /^\s*(PAGEREF|PAGE|NUMPAGES|SECTIONPAGES)\b/i;
const hiddenField = ctx => ctx.fields.some(f => f.result && HIDDEN_FIELD.test(f.instr));

function boolProp(el) {
  return !!el && !['0', 'false', 'off'].includes(val(el) || '');
}

function styleChain(ctx, id) {
  const out = [];
  for (let s = ctx.styles[id], guard = 0; s && guard < 10; s = ctx.styles[s.basedOn], guard++) out.push(s);
  return out;
}

/* ---------- inline content → markdown-ish text ---------- */

const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const YT = /(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/;

/* Collect runs of one paragraph. Returns { lines: [[seg…]…], images: [], boxes: [], maths: [] } */
function readParagraph(p, ctx, pStyleBold, pStyleSize) {
  const lines = [[]];
  const res = { lines, images: [], boxes: [], displayMath: [], link: null };
  const push = seg => lines[lines.length - 1].push(seg);

  function run(r, link) {
    const rpr = kid(r, 'w:rPr');
    const bold = rpr && kid(rpr, 'w:b') ? boolProp(kid(rpr, 'w:b')) : !!pStyleBold;
    const italic = rpr && boolProp(kid(rpr, 'w:i'));
    const size = rpr && kid(rpr, 'w:sz') ? +val(kid(rpr, 'w:sz')) : pStyleSize;
    const va = rpr && val(kid(rpr, 'w:vertAlign'));
    for (const c of els(r)) {
      if (c.name === 'w:fldChar') {
        const type = val(c, 'w:fldCharType');
        if (type === 'begin') ctx.fields.push({ instr: '', result: false });
        else if (type === 'separate' && ctx.fields.length) ctx.fields[ctx.fields.length - 1].result = true;
        else if (type === 'end') ctx.fields.pop();
        continue;
      }
      if (c.name === 'w:instrText') { if (ctx.fields.length) ctx.fields[ctx.fields.length - 1].instr += textOf(c); continue; }
      if (hiddenField(ctx)) continue;
      if (c.name === 'w:t') {
        let t = textOf(c);
        if (va === 'subscript' && /^\d+$/.test(t)) t = t.replace(/\d/g, d => SUB[d]);
        if (va === 'superscript' && /^\d+$/.test(t)) t = t.replace(/\d/g, d => SUP[d]);
        push({ t, bold, italic, size, link });
      } else if (c.name === 'w:tab') push({ t: ' ', bold, italic, size, link });
      else if (c.name === 'w:br' || c.name === 'w:cr') { if (val(c, 'w:type') !== 'page') lines.push([]); }
      else if (c.name === 'w:noBreakHyphen') push({ t: '-', bold, italic, size, link });
      else if (c.name === 'w:drawing' || c.name === 'w:pict' || c.name === 'mc:AlternateContent') drawing(c, link);
    }
  }

  function drawing(el, link) {
    // mc:AlternateContent carries the same object twice; read only the first choice
    if (el.name === 'mc:AlternateContent') { const ch = kid(el, 'mc:Choice'); if (ch) for (const c of els(ch)) drawing(c, link); return; }
    let clickLink = null;
    for (const d of walk(el)) {
      if (d.name === 'a:hlinkClick' && d.attrs['r:id'] && ctx.rels[d.attrs['r:id']]) clickLink = ctx.rels[d.attrs['r:id']].target;
    }
    for (const d of walk(el)) {
      if (d.name === 'w:txbxContent') { res.boxes.push(d); return; }
    }
    let cx = 0, cy = 0;
    for (const d of walk(el)) if (d.name === 'wp:extent') { cx = +d.attrs.cx; cy = +d.attrs.cy; }
    for (const d of walk(el)) {
      const id = d.name === 'a:blip' ? d.attrs['r:embed'] : d.name === 'v:imagedata' ? d.attrs['r:id'] : null;
      if (!id || !ctx.rels[id]) continue;
      const path = 'word/' + ctx.rels[id].target.replace(/^\/?word\//, '').replace(/^\.\//, '');
      res.images.push({ path, w: Math.round(cx / 9525) || undefined, h: Math.round(cy / 9525) || undefined, link: clickLink || link });
      return;
    }
  }

  function inline(el, link) {
    for (const c of els(el)) {
      if (c.name === 'w:r') run(c, link);
      else if (c.name === 'w:hyperlink') {
        const rel = c.attrs['r:id'] && ctx.rels[c.attrs['r:id']];
        const url = rel ? rel.target : null;
        if (url && YT.test(url)) res.link = url;
        inline(c, url || link);
      } else if (c.name === 'm:oMathPara') { for (const om of kids(c, 'm:oMath')) res.displayMath.push(omml(om)); }
      else if (c.name === 'm:oMath') push({ t: `$${omml(c)}$`, math: true });
      else if (c.name === 'w:fldSimple' && HIDDEN_FIELD.test(c.attrs['w:instr'] || '')) continue;
      else if (['w:ins', 'w:smartTag', 'w:customXml', 'w:fldSimple', 'w:sdt', 'w:sdtContent', 'w:dir', 'w:bdo'].includes(c.name)) inline(c, link);
    }
  }
  inline(p, null);
  return res;
}

/* segments → text with **bold** / *italic* / [link](url), trimming spaces out of markers */
function segText(segs) {
  const merged = [];
  for (const s of segs) {
    const prev = merged[merged.length - 1];
    const blank = !s.t.trim();
    if (prev && !s.math && !prev.math && (blank || (prev.bold === s.bold && prev.italic === s.italic && prev.link === s.link))) prev.t += s.t;
    else merged.push({ ...s });
  }
  let out = '';
  for (const s of merged) {
    if (s.math) { out += s.t; continue; }
    const lead = /^\s*/.exec(s.t)[0], trail = /\s*$/.exec(s.t)[0];
    let core = s.t.trim();
    if (!core) { out += s.t; continue; }
    core = core.replace(/\*/g, '\\*');
    if (s.link && /^https?:/.test(s.link)) core = `[${core}](${s.link})`;
    if (s.italic) core = `*${core}*`;
    if (s.bold) core = `**${core}**`;
    out += lead + core + trail;
  }
  return out.replace(/\*\*\s*\*\*/g, ' ').replace(/[  ]+/g, ' ').trim();
}

/* ---------- OMML (Word equations) → LaTeX, common parts only ---------- */

function omml(el) {
  const inner = e => e ? els(e).map(omml).join('') : '';
  switch (el.name) {
    case 'm:oMath': case 'm:e': case 'm:num': case 'm:den': case 'm:sub': case 'm:sup': case 'm:deg': case 'm:fName': case 'm:lim':
      return els(el).map(omml).join('');
    case 'm:r': {
      const t = kids(el, 'm:t').map(textOf).join('');
      const rpr = kid(el, 'm:rPr');
      const normal = rpr && (kid(rpr, 'm:nor') || val(kid(rpr, 'm:sty'), 'm:val') === 'p');
      return normal && /[A-Za-z]{2,}/.test(t) ? `\\text{${t}}` : t.replace(/×/g, '\\times ').replace(/÷/g, '\\div ').replace(/·/g, '\\cdot ');
    }
    case 'm:f': return `\\frac{${inner(kid(el, 'm:num'))}}{${inner(kid(el, 'm:den'))}}`;
    case 'm:sSub': return `{${inner(kid(el, 'm:e'))}}_{${inner(kid(el, 'm:sub'))}}`;
    case 'm:sSup': return `{${inner(kid(el, 'm:e'))}}^{${inner(kid(el, 'm:sup'))}}`;
    case 'm:sSubSup': return `{${inner(kid(el, 'm:e'))}}_{${inner(kid(el, 'm:sub'))}}^{${inner(kid(el, 'm:sup'))}}`;
    case 'm:rad': { const deg = inner(kid(el, 'm:deg')); return deg ? `\\sqrt[${deg}]{${inner(kid(el, 'm:e'))}}` : `\\sqrt{${inner(kid(el, 'm:e'))}}`; }
    case 'm:d': {
      const pr = kid(el, 'm:dPr');
      const beg = val(kid(pr, 'm:begChr'), 'm:val') ?? '(', end = val(kid(pr, 'm:endChr'), 'm:val') ?? ')';
      const esc = c => ({ '{': '\\{', '}': '\\}', '': '.' }[c] ?? c);
      return `\\left${esc(beg)}${kids(el, 'm:e').map(inner).join(',')}\\right${esc(end)}`;
    }
    case 'm:nary': {
      const chr = val(kid(kid(el, 'm:naryPr'), 'm:chr'), 'm:val') || '∫';
      const op = { '∑': '\\sum', '∏': '\\prod', '∫': '\\int' }[chr] || chr;
      const sub = inner(kid(el, 'm:sub')), sup = inner(kid(el, 'm:sup'));
      return `${op}${sub ? `_{${sub}}` : ''}${sup ? `^{${sup}}` : ''}{${inner(kid(el, 'm:e'))}}`;
    }
    case 'm:func': return `${inner(kid(el, 'm:fName'))}{${inner(kid(el, 'm:e'))}}`;
    case 'm:bar': case 'm:acc': case 'm:box': case 'm:borderBox': case 'm:groupChr': case 'm:limLow': case 'm:limUpp':
      return inner(kid(el, 'm:e'));
    default:
      return els(el).filter(c => !/Pr$/.test(c.name)).map(omml).join('');
  }
}

/* ---------- body → tokens ---------- */

function tokenizeDocx(files) {
  const ctx = loadContext(files);
  const doc = parseXML(files.xml['word/document.xml']);
  const body = kid(kid(doc, 'w:document'), 'w:body');

  function blockTokens(container, inCell) {
    const out = [];
    for (const el of els(container)) {
      if (el.name === 'w:p') out.push(...paragraphTokens(el, inCell));
      else if (el.name === 'w:tbl') out.push(tableToken(el));
      else if (el.name === 'w:sdt') out.push(...blockTokens(kid(el, 'w:sdtContent') || el, inCell));
      else if (el.name === 'w:customXml' || el.name === 'w:ins') out.push(...blockTokens(el, inCell));
    }
    return out;
  }

  function paragraphTokens(p, inCell) {
    const ppr = kid(p, 'w:pPr');
    const styleId = val(kid(ppr, 'w:pStyle'));
    const chain = styleChain(ctx, styleId);
    const styleName = chain.length ? chain[0].name : '';
    const styleBold = chain.find(s => s.bold !== undefined)?.bold;
    const styleSize = chain.find(s => s.size !== undefined)?.size;
    const numPr = kid(ppr, 'w:numPr');
    let numId = numPr ? val(kid(numPr, 'w:numId')) : chain.find(s => s.numId)?.numId;
    const ilvl = numPr ? +(val(kid(numPr, 'w:ilvl')) || 0) : 0;
    if (numId === '0') numId = null;
    const fmt = numId ? (ctx.numFmt[numId] || ['bullet'])[ilvl] || 'bullet' : null;

    const r = readParagraph(p, ctx, styleBold, styleSize);
    const out = [];

    // hyperlinked picture or a YouTube link → video
    const videoUrl = r.images.map(i => i.link).find(l => l && YT.test(l)) || r.link;
    const text = segText(r.lines.flat());
    if (videoUrl && YT.test(videoUrl) && text.replace(/\*|\[|\]|\(.*?\)/g, '').length < 150) {
      out.push({ type: 'video', youtube: YT.exec(videoUrl)[1], caption: text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*/g, '').trim() || null });
    } else {
      let first = true;                                          // a line break may come before the text
      r.lines.forEach(segs => {
        const t = segText(segs);
        if (!t) return;
        const n = first ? 0 : 1;
        first = false;
        const textSegs = segs.filter(s => s.t.trim() && !s.math);
        const boldAll = textSegs.length > 0 && textSegs.every(s => s.bold);
        const size = Math.max(0, ...textSegs.map(s => s.size || styleSize || ctx.defaultSize)) / ctx.defaultSize;
        if (n === 0 && !inCell) {
          if (styleName === 'title') { out.push({ type: 'heading', depth: 1, text: t.replace(/\*\*/g, '') }); return; }
          const h = /^heading (\d)$/.exec(styleName);
          if (h) { out.push({ type: 'heading', depth: Math.min(6, +h[1] + 1), text: t.replace(/\*\*/g, '') }); return; }
          if (styleName === 'subtitle') { out.push({ type: 'para', text: t }); return; }
        }
        if (fmt && fmt !== 'none' && n === 0) {
          out.push({ type: fmt === 'bullet' ? 'ul' : 'ol', items: [t.replace(/^\s*[•·▪◦‣●○■□]\s*/, '')], word: true, level: ilvl });
        } else if (styleName === 'list paragraph' && !inCell && !/^[_\s.…*]+$/.test(t) && !/^(\*\*)?\s*[•·▪◦‣●○■□\d]/.test(t)) {
          // an indented "List Paragraph" whose numbering was lost: still a list item
          out.push({ type: 'ul', items: [t], word: true, level: ilvl, lostNumbering: true });
        } else out.push({ type: 'para', text: t, boldAll, size });
      });
      for (const img of r.images) {
        const m = ctx.media[img.path];
        if (!m) continue;
        const ext = img.path.split('.').pop().toLowerCase();
        const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' }[ext];
        if (!mime) continue;                                     // EMF/WMF cannot be shown in a browser
        out.push({ type: 'img', mime, base64: typeof m === 'string' ? m : m.toString('base64'), w: img.w, h: img.h });
      }
    }
    for (const tex of r.displayMath) out.push({ type: 'math', tex });
    for (const box of r.boxes) out.push({ type: 'box', tokens: blockTokens(box, true) });
    return mergeLists(out);
  }

  function cellText(tc) {
    const lines = [];
    for (const t of blockTokens(tc, true)) {
      if (t.type === 'para' || t.type === 'heading') lines.push(t.text);
      else if (t.type === 'ul' || t.type === 'ol') lines.push(...t.items.map(i => (t.type === 'ul' ? '• ' : '') + i));
      else if (t.type === 'table') lines.push(...t.rows.map(r => r.map(c => typeof c === 'object' ? c.text : c).join(' | ')));
    }
    return lines.join('\n');
  }

  function tableToken(tbl) {
    const rows = kids(tbl, 'w:tr').map(tr => kids(tr, 'w:tc').map(tc => {
      const span = +(val(kid(kid(tc, 'w:tcPr'), 'w:gridSpan')) || 1);
      const text = cellText(tc);
      return span > 1 ? { text, span } : text;
    }));
    if (rows.length === 1 && rows[0].length === 1) {              // 1×1 table = a highlighted box
      return { type: 'box', tokens: blockTokens(kids(kids(tbl, 'w:tr')[0], 'w:tc')[0], true) };
    }
    return { type: 'table', rows };
  }

  return { tokens: mergeLists(blockTokens(body, false)), refs: {} };
}

/* consecutive Word list paragraphs of the same kind → one list token */
function mergeLists(tokens) {
  const out = [];
  for (const t of tokens) {
    const prev = out[out.length - 1];
    if ((t.type === 'ul' || t.type === 'ol') && prev && prev.type === t.type && prev.word && t.word && prev.level === t.level) prev.items.push(...t.items);
    else out.push(t);
  }
  return out;
}

function parseDocx(files, opts = {}) {
  return buildWorksheet(tokenizeDocx(files), opts);
}

module.exports = { parseDocx, tokenizeDocx, parseXML, omml };
