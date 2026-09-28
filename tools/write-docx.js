/* ============================================================
   GREEN Worksheets — content.json + lang/<code>.json → Word (.docx)

   The opposite direction of tools/parse-docx.js: a worksheet that has
   been read into JSON is written back out as a Word document in one
   language, so a partner school can read and correct its own text in
   the program it already knows.

   Every translated paragraph carries a Word bookmark named after its
   translation key (t1a2b3c4d). Bookmarks are invisible in Word and
   survive editing, so a corrected document can later be mapped back
   onto the JSON without guessing.

   No dependencies: the .docx (a ZIP of XML parts) is written by hand.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- ZIP ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function zip(entries) {
  const now = new Date();
  const time = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const date = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const local = [], central = [];
  let offset = 0;

  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const name = Buffer.from(e.name, 'utf8');

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(time, 10); lh.writeUInt16LE(date, 12);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    local.push(lh, name, comp);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(time, 12); ch.writeUInt16LE(date, 14);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    central.push(ch, name);

    offset += lh.length + name.length + comp.length;
  }

  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

/* ---------- XML ---------- */
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const GREEN = '1B6B3A';
const GREY = '5F6B76';
const RULE_COLOR = 'A9B4BF';
const BORDER = 'C8D2DC';
const LEVEL_COLOR = { basic: '2E7D32', medium: 'B26A00', advanced: '7B1FA2' };
const W_TOTAL = 9638;                                        // A4 minus 2 cm margins, in twips
const RULE = '_'.repeat(74);

/* run properties shared by a whole paragraph */
function rpr(o) {
  const p = [];
  if (o.mono) p.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  if (o.bold) p.push('<w:b/>');
  if (o.italic) p.push('<w:i/>');
  if (o.color) p.push(`<w:color w:val="${o.color}"/>`);
  if (o.size) p.push(`<w:sz w:val="${o.size}"/><w:szCs w:val="${o.size}"/>`);
  return p;
}

/* "**bold** and *italic*" → Word runs */
function runs(text, o = {}) {
  const base = rpr(o);
  const out = [];
  const push = (t, bold, italic) => {
    if (t === '') return;
    const props = (bold || italic) ? rpr({ ...o, bold: o.bold || bold, italic: o.italic || italic }) : base;
    const body = String(t).split('\n')
      .map((line, i) => (i ? '<w:br/>' : '') + `<w:t xml:space="preserve">${esc(line)}</w:t>`).join('');
    out.push(`<w:r>${props.length ? `<w:rPr>${props.join('')}</w:rPr>` : ''}${body}</w:r>`);
  };
  for (const piece of String(text ?? '').split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/g)) {
    if (!piece) continue;
    if (/^\*\*[^*]+\*\*$/.test(piece)) push(piece.slice(2, -2), true, false);
    else if (/^\*[^*]+\*$/.test(piece)) push(piece.slice(1, -1), false, true);
    else push(piece, false, false);
  }
  return out.join('');
}

/* ---------- the document ---------- */
function buildDocx(opts) {
  const { content, strings, ui, lang, slug, dir } = opts;
  const T = key => (key == null ? '' : (strings[key] ?? key));
  const levelName = l => (ui.levels && ui.levels[l]) || l || '';

  const rels = [
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
  ];
  const media = [];
  const seen = new Map();                                    // key → how often it has been written
  let questionLists = 0, bookmarkId = 0;

  /* paragraphs are collected into the current target (a table cell has its own) */
  let out = [];
  const stack = [];
  const open = () => { stack.push(out); out = []; };
  const close = () => { const r = out; out = stack.pop(); return r; };

  function bookmark(key) {
    if (!key) return ['', ''];
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    const id = ++bookmarkId;
    return [`<w:bookmarkStart w:id="${id}" w:name="${key}${n > 1 ? `_${n}` : ''}"/>`, `<w:bookmarkEnd w:id="${id}"/>`];
  }

  function para(text, o = {}) {
    const ppr = [];                                          // schema order matters to Word
    if (o.style) ppr.push(`<w:pStyle w:val="${o.style}"/>`);
    if (o.keepNext) ppr.push('<w:keepNext/>');
    if (o.numId) ppr.push(`<w:numPr><w:ilvl w:val="${o.ilvl || 0}"/><w:numId w:val="${o.numId}"/></w:numPr>`);
    if (o.spacing) ppr.push(`<w:spacing ${o.spacing}/>`);
    if (o.ind) ppr.push(`<w:ind ${o.ind}/>`);
    if (o.jc) ppr.push(`<w:jc w:val="${o.jc}"/>`);
    const props = rpr(o);
    if (props.length) ppr.push(`<w:rPr>${props.join('')}</w:rPr>`);
    const [bs, be] = bookmark(o.key);
    const prefix = o.prefix ? runs(o.prefix + ' ', { bold: true, color: o.color }) : '';
    out.push(`<w:p>${ppr.length ? `<w:pPr>${ppr.join('')}</w:pPr>` : ''}${prefix}${bs}${runs(text, o)}${be}</w:p>`);
  }

  const gap = h => out.push(`<w:p><w:pPr><w:spacing w:after="0" w:line="${h}" w:lineRule="exact"/></w:pPr></w:p>`);

  /* a cell is a list of { key?, text?, bold?, prefix?, … } */
  function cell(items, o = {}) {
    open();
    for (const c of items) {
      para(c.text != null ? c.text : T(c.key), {
        key: c.key, bold: c.bold, italic: c.italic, color: c.color, prefix: c.prefix,
        keepNext: o.keepNext, spacing: 'w:before="20" w:after="20"'
      });
    }
    const body = close().join('');
    const w = o.width || Math.floor(W_TOTAL / (o.cols || 1));
    return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${o.shade ? `<w:shd w:val="clear" w:color="auto" w:fill="${o.shade}"/>` : ''}</w:tcPr>${body || '<w:p/>'}</w:tc>`;
  }

  function table(rows, o = {}) {
    const cols = rows[0].length;
    const widths = o.widths || rows[0].map(() => Math.floor(W_TOTAL / cols));
    const borders = `<w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map(s => `<w:${s} w:val="single" w:sz="4" w:space="0" w:color="${BORDER}"/>`).join('')}</w:tblBorders>`;
    const xml = [`<w:tbl><w:tblPr><w:tblW w:w="${W_TOTAL}" w:type="dxa"/>${borders}` +
      `<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="120" w:type="dxa"/>` +
      `<w:bottom w:w="60" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
      `<w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`];
    rows.forEach((row, ri) => {
      const head = o.head && ri === 0;
      xml.push(`<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}` +
        row.map((items, ci) => cell(items.map(c => ({ ...c, bold: c.bold || head })), {
          width: widths[ci],
          shade: head ? 'EAF3EC' : (o.labelColumn && ci === 0 ? 'F6F8FA' : null),
          keepNext: true
        })).join('') + '</w:tr>');
    });
    xml.push('</w:tbl>');
    out.push(xml.join(''));
    gap(120);
  }

  /* ---------- images ---------- */
  function imageSize(buf) {
    if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf[0] === 0xff && buf[1] === 0xd8) {                 // JPEG
      let i = 2;
      while (i < buf.length - 9) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
    if (buf.slice(0, 3).toString('latin1') === 'GIF') return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
    return null;
  }

  function image(src) {
    const file = path.join(dir, 'img', src || '');
    const ext = String(src || '').split('.').pop().toLowerCase();
    if (!src || !fs.existsSync(file) || !['png', 'jpg', 'jpeg', 'gif'].includes(ext)) return;
    const data = fs.readFileSync(file);
    const id = media.length + 1;
    const name = `image${id}.${ext}`;
    media.push({ name, data });
    rels.push(`<Relationship Id="rIdImg${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);

    const px = imageSize(data) || { w: 800, h: 500 };
    const max = 5400000;                                      // ~15 cm in EMU
    let w = px.w * 9525, h = px.h * 9525;
    if (w > max) { h = Math.round(h * max / w); w = max; }
    out.push(`<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="120" w:after="60"/></w:pPr><w:r><w:drawing>` +
      `<wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${w}" cy="${h}"/>` +
      `<wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${id}" name="Picture ${id}"/>` +
      `<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">` +
      `<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
      `<pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr>` +
      `<pic:blipFill><a:blip r:embed="rIdImg${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
      `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${w}" cy="${h}"/></a:xfrm>` +
      `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic>` +
      `</wp:inline></w:drawing></w:r></w:p>`);
  }

  const writeLines = n => {
    for (let i = 0; i < (n || 0); i++) {
      para(RULE, { color: RULE_COLOR, spacing: 'w:before="40" w:after="40"', ind: 'w:left="340"' });
    }
  };

  /* ---------- blocks ---------- */
  function block(b, ctx) {
    switch (b.t) {
      case 'h':
        para(T(b.text), { key: b.text, style: 'Heading2' });
        break;

      case 'p':
        para(T(b.text), { key: b.text });
        break;

      case 'ul':
        b.items.forEach(k => para(T(k), { key: k, style: 'ListParagraph', numId: 1 }));
        break;

      case 'li':
        para(`${b.n}. ${T(b.text)}`, { key: b.text, style: 'ListParagraph', ind: 'w:left="680" w:hanging="340"' });
        break;

      case 'q':
        para(T(b.text), { key: b.text, style: 'ListParagraph', numId: ctx.numId, keepNext: true });
        (b.items || []).forEach(k => para(T(k), { key: k, style: 'ListParagraph', ind: 'w:left="1080"' }));
        (b.options || []).forEach((k, i) => para(`[ ${'ABCDE'[i] || '·'} ]   ${T(k)}`, { key: k, style: 'ListParagraph', ind: 'w:left="1080"' }));
        writeLines(b.lines);
        break;

      case 'lines':
        writeLines(b.n);
        break;

      case 'box': {
        open();
        if (b.title) para(T(b.title), { key: b.title, bold: true, color: GREEN, keepNext: true, spacing: 'w:after="60"' });
        b.blocks.forEach(x => block(x, ctx));
        const inner = close().join('') || '<w:p/>';
        // a 1×1 table — the shape tools/parse-docx.js reads back as a highlighted box
        out.push(`<w:tbl><w:tblPr><w:tblW w:w="${W_TOTAL}" w:type="dxa"/>` +
          `<w:tblBorders>${['top', 'left', 'bottom', 'right'].map(s => `<w:${s} w:val="single" w:sz="8" w:space="0" w:color="${GREEN}"/>`).join('')}</w:tblBorders>` +
          `<w:tblCellMar><w:top w:w="140" w:type="dxa"/><w:left w:w="200" w:type="dxa"/>` +
          `<w:bottom w:w="140" w:type="dxa"/><w:right w:w="200" w:type="dxa"/></w:tblCellMar></w:tblPr>` +
          `<w:tblGrid><w:gridCol w:w="${W_TOTAL}"/></w:tblGrid><w:tr><w:tc>` +
          `<w:tcPr><w:tcW w:w="${W_TOTAL}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F2F8F3"/></w:tcPr>` +
          inner + '</w:tc></w:tr></w:tbl>');
        gap(160);
        break;
      }

      case 'table': {
        const rows = [];
        if (b.head) rows.push(b.head.map(k => [{ key: k }]));
        for (const r of b.rows) rows.push(r.map(c => [{ key: (c && typeof c === 'object') ? c.text : c }]));
        const widths = rows[0].length === 2 ? [Math.round(W_TOTAL * 0.32), W_TOTAL - Math.round(W_TOTAL * 0.32)] : null;
        table(rows, { head: !!b.head, widths });
        break;
      }

      case 'task': {
        const numId = 2 + questionLists++;
        const no = ctx.taskNo();
        para(`${ui.task || 'Task'} ${no}${b.title ? ' — ' + T(b.title) : ''}`, { key: b.title, style: 'Heading3' });
        b.blocks.forEach(x => block(x, { ...ctx, numId }));
        break;
      }

      case 'img':
        image(b.src);
        if (b.caption) para(T(b.caption), { key: b.caption, italic: true, color: GREY, size: 18, jc: 'center' });
        break;

      case 'video':
        para(`▶ ${b.caption ? T(b.caption) + ' — ' : ''}https://youtu.be/${b.youtube}`, { key: b.caption, italic: true, color: GREY });
        break;

      case 'math':
        para(b.tex, { mono: true, color: GREEN, jc: 'center' });
        break;

      default:
        if (b.text) para(T(b.text), { key: b.text });
    }
  }

  /* ---------- title ---------- */
  para(T(content.title), { key: content.title, style: 'Title' });
  const head = [ui.worksheet || 'Worksheet'];
  if (content.code) head.push(content.code);
  if (content.country && ui.countries && ui.countries[content.country]) head.push('· ' + ui.countries[content.country]);
  para(head.join(' '), { style: 'Subtitle' });
  if (opts.notice) para(opts.notice, { italic: true, color: GREY, size: 18, spacing: 'w:after="220"' });

  /* ---------- info table ---------- */
  const fieldCells = list => {
    if (typeof list === 'string') list = [{ text: list }];      // one text for every level
    if (!list || !list.length) return null;
    const oneForAll = list.length === 1 || new Set(list.map(x => x.text)).size === 1;
    if (oneForAll) return [{ key: list[0].text }];
    return list.map(x => ({ key: x.text, prefix: `${levelName(x.level)}:` }));
  };
  const metaRows = [];
  for (const [label, list] of [
    [ui.topic || 'Topic', content.meta.topic],
    [ui.learningOutcomes || 'Learning outcomes', content.meta.outcomes],
    [ui.timeNeeded || 'Time needed', content.meta.time],
    [ui.resources || 'Resources', content.meta.resources]
  ]) {
    const cells = fieldCells(list);
    if (cells) metaRows.push([[{ text: label, bold: true, color: GREEN }], cells]);
  }
  for (const extra of content.meta.extra || []) {
    metaRows.push([[{ key: extra.label, bold: true, color: GREEN }], [{ key: extra.value }]]);
  }
  if (metaRows.length) table(metaRows, { labelColumn: true, widths: [Math.round(W_TOTAL * 0.24), W_TOTAL - Math.round(W_TOTAL * 0.24)] });

  /* ---------- levels ---------- */
  content.sections.forEach((section, i) => {
    const name = section.kind === 'level' ? levelName(section.level).toUpperCase() : '';
    const title = section.title ? T(section.title) : '';
    para([name, title].filter(Boolean).join(' — '), {
      key: section.title, style: 'Heading1',
      color: LEVEL_COLOR[section.level] || GREEN,
      first: i === 0
    });
    let tasks = 0;
    section.blocks.forEach(b => block(b, { numId: 2, taskNo: () => ++tasks }));
  });

  /* ---------- parts ---------- */
  const numXml = XML +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>' +
    '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' +
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/>' +
    '<w:pPr><w:ind w:left="680" w:hanging="340"/></w:pPr></w:lvl></w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>' +
    Array.from({ length: Math.max(1, questionLists) }, (_, i) =>
      `<w:num w:numId="${i + 2}"><w:abstractNumId w:val="1"/>` +
      '<w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>').join('') +
    '</w:numbering>';

  const style = (id, name, o) =>
    `<w:style w:type="paragraph" ${o.default ? 'w:default="1" ' : ''}w:styleId="${id}">` +
    `<w:name w:val="${name}"/>${o.basedOn ? `<w:basedOn w:val="${o.basedOn}"/>` : ''}<w:qFormat/>` +
    `${o.ppr ? `<w:pPr>${o.ppr}</w:pPr>` : ''}${o.rpr ? `<w:rPr>${o.rpr}</w:rPr>` : ''}</w:style>`;

  const stylesXml = XML +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>' +
    `<w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="${esc(lang)}"/></w:rPr></w:rPrDefault>` +
    '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>' +
    style('Normal', 'Normal', { default: true }) +
    style('Title', 'Title', { basedOn: 'Normal', ppr: '<w:keepNext/><w:spacing w:after="40"/>', rpr: `<w:b/><w:color w:val="${GREEN}"/><w:sz w:val="44"/><w:szCs w:val="44"/>` }) +
    style('Subtitle', 'Subtitle', { basedOn: 'Normal', ppr: '<w:spacing w:after="120"/>', rpr: `<w:color w:val="${GREY}"/><w:sz w:val="20"/><w:szCs w:val="20"/>` }) +
    style('Heading1', 'heading 1', { basedOn: 'Normal', ppr: `<w:keepNext/><w:pageBreakBefore/><w:pBdr><w:bottom w:val="single" w:sz="12" w:space="4" w:color="${BORDER}"/></w:pBdr><w:spacing w:before="0" w:after="180"/>`, rpr: `<w:b/><w:color w:val="${GREEN}"/><w:sz w:val="32"/><w:szCs w:val="32"/>` }) +
    style('Heading2', 'heading 2', { basedOn: 'Normal', ppr: '<w:keepNext/><w:spacing w:before="260" w:after="80"/>', rpr: `<w:b/><w:color w:val="${GREEN}"/><w:sz w:val="26"/><w:szCs w:val="26"/>` }) +
    style('Heading3', 'heading 3', { basedOn: 'Normal', ppr: `<w:keepNext/><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="${BORDER}"/></w:pBdr><w:spacing w:before="280" w:after="100"/><w:ind w:left="120"/>`, rpr: '<w:b/><w:sz w:val="24"/><w:szCs w:val="24"/>' }) +
    style('ListParagraph', 'List Paragraph', { basedOn: 'Normal', ppr: '<w:ind w:left="720"/><w:contextualSpacing/>' }) +
    '</w:styles>';

  const docXml = XML +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
    'xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>' +
    out.join('') +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>';

  const core = XML +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${esc(T(content.title))}</dc:title>` +
    `<dc:subject>GREEN Erasmus+ · ${esc(slug)} · ${esc(lang)}</dc:subject>` +
    '<dc:creator>GREEN worksheet reader</dc:creator>' +
    `<cp:keywords>${esc(slug)};${esc(lang)}</cp:keywords>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created>` +
    '</cp:coreProperties>';

  const types = XML +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="png" ContentType="image/png"/>' +
    '<Default Extension="jpg" ContentType="image/jpeg"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Default Extension="gif" ContentType="image/gif"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '</Types>';

  const rootRels = XML +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '</Relationships>';

  return {
    buffer: zip([
      { name: '[Content_Types].xml', data: types },
      { name: '_rels/.rels', data: rootRels },
      { name: 'docProps/core.xml', data: core },
      { name: 'word/document.xml', data: docXml },
      { name: 'word/styles.xml', data: stylesXml },
      { name: 'word/numbering.xml', data: numXml },
      { name: 'word/_rels/document.xml.rels', data: XML + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>` },
      ...media.map(m => ({ name: `word/media/${m.name}`, data: m.data }))
    ]),
    bookmarks: bookmarkId,
    images: media.length
  };
}

module.exports = { buildDocx };
