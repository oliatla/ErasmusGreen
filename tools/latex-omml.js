/* ============================================================
   GREEN Worksheets — LaTeX → Word equation (OMML)

   The opposite of omml() in tools/parse-docx.js, for the small LaTeX
   the worksheets use: \text{…}, \frac / \dfrac, x_{…}, x^{…},
   \times \cdot \div \pm \approx \le \ge \sum, Greek letters, ( ) [ ].
   Anything unknown is written as plain text, never dropped.
   ============================================================ */

const SYMBOL = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', approx: '≈', neq: '≠', ne: '≠', le: '≤', leq: '≤', ge: '≥', geq: '≥',
  sum: '∑', prod: '∏', infty: '∞', degree: '°', circ: '°', to: '→', rightarrow: '→', leftarrow: '←', lceil: '⌈', rceil: '⌉',
  lfloor: '⌊', rfloor: '⌋', ldots: '…', cdots: '⋯', percent: '%', '%': '%', '$': '$', '{': '{', '}': '}', '_': '_', ',': ' ', ';': ' ', quad: ' ', qquad: '  ',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', Delta: 'Δ', epsilon: 'ε', eta: 'η', theta: 'θ', lambda: 'λ', mu: 'μ',
  pi: 'π', rho: 'ρ', sigma: 'σ', Sigma: 'Σ', tau: 'τ', phi: 'φ', Phi: 'Φ', omega: 'ω', Omega: 'Ω'
};

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* m:r — "plain" for words (\text, numbers), italic for single letters as Word does */
function mr(text, plain) {
  if (!text) return '';
  return `<m:r>${plain ? '<m:rPr><m:sty m:val="p"/></m:rPr>' : ''}<w:rPr><w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/></w:rPr>` +
    `<m:t xml:space="preserve">${esc(text)}</m:t></m:r>`;
}

function parse(src) {
  let i = 0;
  const peek = () => src[i];

  function group() {                                   // {…} or a single atom
    skipSpace();
    if (peek() === '{') {
      i++;
      const out = seq('}');
      i++;                                             // the closing brace
      return out;
    }
    return atom();
  }
  function skipSpace() { while (src[i] === ' ') i++; }
  function rawGroup() {                                // {text} without parsing
    skipSpace();
    if (peek() !== '{') return '';
    let depth = 0, start = ++i;
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}') { if (!depth) break; depth--; }
    }
    return src.slice(start, i++);
  }

  function atom() {
    const c = peek();
    if (c === undefined) return '';
    if (c === '\\') {
      const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
      i += m[0].length;
      const name = m[1];
      if (name === 'text' || name === 'mathrm' || name === 'textrm' || name === 'operatorname' || name === 'mbox') return mr(rawGroup(), true);
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
        const num = group(), den = group();
        return `<m:f><m:num>${num}</m:num><m:den>${den}</m:den></m:f>`;
      }
      if (name === 'sqrt') return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${group()}</m:e></m:rad>`;
      if (name === 'left' || name === 'right' || name === 'displaystyle' || name === 'big' || name === 'Big') return '';
      if (name in SYMBOL) return mr(SYMBOL[name], true);
      return mr(name, true);                           // unknown command: keep its name visible
    }
    if (c === '{') return group();
    i++;
    if (/[0-9.,]/.test(c)) {                           // a whole number is one plain run
      let n = c;
      while (/[0-9.,]/.test(src[i] || '')) n += src[i++];
      return mr(n, true);
    }
    if (c === ' ') return '';
    return mr(c, !/[A-Za-z]/.test(c));
  }

  /* atoms with their sub- and superscripts, until `end` */
  function seq(end) {
    let out = '';
    while (i < src.length && peek() !== end) {
      if (peek() === '}') { i++; continue; }          // stray brace
      let base = atom();
      for (;;) {
        skipSpace();
        if (peek() === '_' || peek() === '^') {
          const kind = src[i++];
          const arg = group();
          let other = null;
          skipSpace();
          if ((kind === '_' && peek() === '^') || (kind === '^' && peek() === '_')) { i++; other = group(); }
          if (other != null) {
            const [sub, sup] = kind === '_' ? [arg, other] : [other, arg];
            base = `<m:sSubSup><m:e>${base}</m:e><m:sub>${sub}</m:sub><m:sup>${sup}</m:sup></m:sSubSup>`;
          } else base = kind === '_'
            ? `<m:sSub><m:e>${base}</m:e><m:sub>${arg}</m:sub></m:sSub>`
            : `<m:sSup><m:e>${base}</m:e><m:sup>${arg}</m:sup></m:sSup>`;
          continue;
        }
        break;
      }
      out += base;
    }
    return out;
  }
  return seq(undefined);
}

/* inline equation (inside a paragraph) */
function ommlInline(tex) {
  return `<m:oMath>${parse(String(tex))}</m:oMath>`;
}

/* an equation on its own line, centred */
function ommlBlock(tex) {
  return `<m:oMathPara><m:oMathParaPr><m:jc m:val="center"/></m:oMathParaPr><m:oMath>${parse(String(tex))}</m:oMath></m:oMathPara>`;
}

module.exports = { ommlInline, ommlBlock };
