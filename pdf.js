'use strict';
// Minimal dependency-free PDF writer for the results printout (US Letter, Helvetica).
// Only Latin text is supported by the built-in PDF fonts; other characters print as "?".

const W = 612, H = 792, M = 54, FOOT = 40;

// Helvetica glyph widths (1/1000 em) for ASCII 32..126
const WR = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,
  667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  278,278,278,469,556,333,
  556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,
  334,260,334,584];
const WB = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,
  722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,
  333,278,333,584,556,333,
  556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,
  389,280,389,584];

const CP1252 = { '€': 0x80, '‚': 0x82, 'ƒ': 0x83, '„': 0x84, '…': 0x85, '†': 0x86, '‡': 0x87, 'ˆ': 0x88, '‰': 0x89,
  'Š': 0x8a, '‹': 0x8b, 'Œ': 0x8c, 'Ž': 0x8e, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96,
  '—': 0x97, '˜': 0x98, '™': 0x99, 'š': 0x9a, '›': 0x9b, 'œ': 0x9c, 'ž': 0x9e, 'Ÿ': 0x9f };

const TIER_RGB = {
  S: [0.925, 0.357, 0.373], A: [0.949, 0.576, 0.227], B: [0.925, 0.784, 0.122], C: [0.408, 0.749, 0.42],
  D: [0.271, 0.651, 0.863], E: [0.604, 0.51, 0.878], F: [0.604, 0.643, 0.706]
};
const TIERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
const INK = [0.07, 0.1, 0.16], GRAY = [0.4, 0.43, 0.49], LIGHT = [0.8, 0.83, 0.87];

function pdfByte(ch) {
  const c = ch.codePointAt(0);
  if (c < 32) return 32;
  if (c < 127) return c;
  if (c >= 160 && c <= 255) return c;
  return CP1252[ch] || 63;
}
function hex(s) {
  let o = '';
  for (const ch of String(s)) o += pdfByte(ch).toString(16).padStart(2, '0');
  return '<' + o + '>';
}
function textWidth(s, size, bold) {
  const t = bold ? WB : WR;
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    w += c >= 32 && c <= 126 ? t[c - 32] : 556;
  }
  return w * size / 1000;
}
function wrap(s, size, bold, maxW) {
  const out = [];
  let line = '';
  const push = () => { if (line) out.push(line); line = ''; };
  for (const w of String(s).split(/\s+/).filter(Boolean)) {
    let word = w;
    while (textWidth(word, size, bold) > maxW) {
      let cut = '';
      for (const ch of word) { if (textWidth(cut + ch, size, bold) > maxW) break; cut += ch; }
      if (!cut) cut = Array.from(word)[0];
      push();
      out.push(cut);
      word = word.slice(cut.length);
      if (!word) break;
    }
    if (!word) continue;
    const t = line ? line + ' ' + word : word;
    if (textWidth(t, size, bold) <= maxW) line = t; else { push(); line = word; }
  }
  push();
  return out.length ? out : [''];
}
const num = x => (Math.round(x * 100) / 100).toString();
const col = c => c.map(num).join(' ');

class Page {
  constructor() { this.ops = []; }
  text(x, y, s, o) {
    o = o || {};
    this.ops.push(col(o.color || INK) + ' rg BT /' + (o.bold ? 'F2' : 'F1') + ' ' + num(o.size || 11) + ' Tf ' +
      num(x) + ' ' + num(H - y) + ' Td ' + hex(s) + ' Tj ET');
  }
  rect(x, y, w, h, c) { this.ops.push(col(c) + ' rg ' + num(x) + ' ' + num(H - y - h) + ' ' + num(w) + ' ' + num(h) + ' re f'); }
  line(x1, y1, x2, y2, c, w) {
    this.ops.push(col(c) + ' RG ' + num(w || 0.75) + ' w ' + num(x1) + ' ' + num(H - y1) + ' m ' + num(x2) + ' ' + num(H - y2) + ' l S');
  }
}

// data: { title, date, items: [{ name, status: 'ranked'|'open'|'novotes'|'pending', final, counts, votes }] }
function buildResultsPdf(data) {
  const items = data.items || [];
  const pages = [];
  let pg, y;
  const limit = () => H - M - FOOT / 2;
  const newPage = () => { pg = new Page(); pages.push(pg); y = M; };
  newPage();

  /* header */
  const title = String(data.title || '').trim() || 'Tier Poll';
  wrap(title, 22, true, W - 2 * M).forEach(l => { pg.text(M, y + 20, l, { size: 22, bold: true }); y += 27; });
  pg.text(M, y + 10, 'Results' + (data.date ? '  ·  ' + data.date : ''), { size: 11, color: GRAY });
  y += 22;
  const ranked = items.filter(i => i.status === 'ranked').length;
  const totalVotes = items.reduce((s, i) => s + (i.votes || 0), 0);
  pg.text(M, y + 10, ranked + ' of ' + items.length + ' items ranked  ·  ' + totalVotes + ' votes cast', { size: 11, color: GRAY });
  y += 18;
  pg.line(M, y, W - M, y, INK, 1.2);
  y += 22;

  /* final tiers */
  pg.text(M, y + 13, 'Final tiers', { size: 14, bold: true });
  y += 26;
  TIERS.forEach(t => {
    const names = items.filter(i => i.status === 'ranked' && i.final === t).map(i => i.name);
    const lines = names.length ? wrap(names.join('  •  '), 11, false, W - 2 * M - 52) : ['—'];
    if (y + 44 > limit()) newPage();
    let idx = 0;
    for (;;) {
      const fit = Math.max(1, Math.floor((limit() - y - 12) / 15));
      const chunk = lines.slice(idx, idx + fit);
      const hgt = Math.max(32, chunk.length * 15 + 12);
      pg.rect(M, y, 38, hgt - 4, TIER_RGB[t]);
      pg.text(M + 19 - textWidth(t, 18, true) / 2, y + hgt / 2 + 2, t, { size: 18, bold: true, color: [0.06, 0.09, 0.12] });
      chunk.forEach((l, i) => pg.text(M + 50, y + 15 + i * 15, l, { size: 11, color: names.length ? INK : GRAY }));
      y += hgt;
      pg.line(M + 50, y - 2, W - M, y - 2, LIGHT, 0.5);
      idx += chunk.length;
      if (idx >= lines.length) break;
      newPage();
    }
  });
  y += 16;

  /* vote breakdown table */
  const X_ITEM = M, X_TIER = M + 218, X_VOTES = M + 262, X_T0 = M + 304, CW = (W - M - X_T0) / 7;
  const header = () => {
    pg.text(X_ITEM, y + 10, 'Item', { size: 9, bold: true, color: GRAY });
    pg.text(X_TIER, y + 10, 'Result', { size: 9, bold: true, color: GRAY });
    pg.text(X_VOTES, y + 10, 'Votes', { size: 9, bold: true, color: GRAY });
    TIERS.forEach((t, i) => pg.text(X_T0 + i * CW + CW / 2 - textWidth(t, 9, true) / 2, y + 10, t, { size: 9, bold: true, color: GRAY }));
    y += 16;
    pg.line(M, y, W - M, y, INK, 1);
    y += 2;
  };
  if (y + 90 > limit()) newPage();
  pg.text(M, y + 13, 'Vote breakdown', { size: 14, bold: true });
  y += 26;
  header();
  items.forEach(it => {
    const lines = wrap(it.name, 10.5, false, 208);
    const hgt = Math.max(22, lines.length * 13 + 9);
    if (y + hgt > limit()) { newPage(); header(); }
    lines.forEach((l, i) => pg.text(X_ITEM, y + 14 + i * 13, l, { size: 10.5 }));
    if (it.status === 'ranked' || it.status === 'novotes') {
      if (it.final) {
        pg.rect(X_TIER, y + 3, 24, 16, TIER_RGB[it.final]);
        pg.text(X_TIER + 12 - textWidth(it.final, 10.5, true) / 2, y + 15, it.final, { size: 10.5, bold: true, color: [0.06, 0.09, 0.12] });
      } else pg.text(X_TIER + 6, y + 14, '—', { size: 10.5, color: GRAY });
      pg.text(X_VOTES, y + 14, String(it.votes || 0), { size: 10.5 });
      TIERS.forEach((t, i) => {
        const n = (it.counts && it.counts[t]) || 0;
        const s = String(n), top = it.final === t;
        pg.text(X_T0 + i * CW + CW / 2 - textWidth(s, 10.5, top) / 2, y + 14, s, { size: 10.5, bold: top, color: n ? INK : LIGHT });
      });
    } else {
      pg.text(X_TIER, y + 14, it.status === 'open' ? 'Poll in progress' : 'Not ranked yet', { size: 10.5, color: GRAY });
    }
    y += hgt;
    pg.line(M, y - 1, W - M, y - 1, LIGHT, 0.5);
  });
  if (!items.length) pg.text(X_ITEM, y + 16, 'No items were added to this room.', { size: 10.5, color: GRAY });

  /* footers */
  pages.forEach((p, i) => {
    const s = 'Page ' + (i + 1) + ' of ' + pages.length;
    p.text(W / 2 - textWidth(s, 9, false) / 2, H - 28, s, { size: 9, color: GRAY });
  });

  return assemble(pages, title);
}

function assemble(pages, title) {
  const parts = [];
  const offsets = [];
  let len = 0;
  const push = b => { const buf = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); parts.push(buf); len += buf.length; };
  const obj = (n, body) => { offsets[n] = len; push(n + ' 0 obj\n'); push(body); push('\nendobj\n'); };

  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const first = 6; // object numbers: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then page/content pairs
  const kids = pages.map((_, i) => (first + i * 2) + ' 0 R').join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, '<< /Type /Pages /Kids [' + kids + '] /Count ' + pages.length + ' >>');
  obj(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  obj(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const u16 = 'FEFF' + Array.from(String(title).slice(0, 100)).map(ch => {
    const c = ch.codePointAt(0);
    if (c > 0xffff) { const v = c - 0x10000; return (0xd800 + (v >> 10)).toString(16).padStart(4, '0') + (0xdc00 + (v & 1023)).toString(16).padStart(4, '0'); }
    return c.toString(16).padStart(4, '0');
  }).join('');
  obj(5, '<< /Title <' + u16 + '> /Producer (Tier Poll) >>');
  pages.forEach((p, i) => {
    const pn = first + i * 2, cn = pn + 1;
    const stream = Buffer.from(p.ops.join('\n'), 'latin1');
    obj(pn, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ' + cn + ' 0 R >>');
    offsets[cn] = len;
    push(cn + ' 0 obj\n<< /Length ' + stream.length + ' >>\nstream\n');
    push(stream);
    push('\nendstream\nendobj\n');
  });
  const total = first + pages.length * 2;
  const xref = len;
  let x = 'xref\n0 ' + total + '\n0000000000 65535 f \n';
  for (let n = 1; n < total; n++) x += String(offsets[n]).padStart(10, '0') + ' 00000 n \n';
  push(x);
  push('trailer\n<< /Size ' + total + ' /Root 1 0 R /Info 5 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
  return Buffer.concat(parts);
}

module.exports = { buildResultsPdf };
