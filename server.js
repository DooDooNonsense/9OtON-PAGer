'use strict';
// Impollster: zero-dependency Node server. Rooms are keyed by a 6-character host code
// and a 4-character join code. Realtime updates go out over Server-Sent Events.
//
// Every item is its own poll: guests pick a tier for it. An item can also carry a text bubble or
// trivia questions. A text bubble appears under an item's placement once its results are revealed. Trivia runs live, one timed
// question at a time, started by the host; answers are recorded per player and graded on the server
// only when the host reveals the answer, so a correct answer never reaches a guest early.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildResultsPdf } = require('./pdf');
const { nameAllowed } = require('./censor');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const ROOM_TTL_MS = 60 * 24 * 3600 * 1000; // rooms idle this long are deleted
const DEFAULT_TIERS = [['S', '#ff4d5a'], ['A', '#ff8000'], ['B', '#ffe05a'], ['C', '#00cc70'], ['D', '#00c0ff'], ['E', '#8080ff'], ['F', '#e060ff']];
const MAX_TIERS = 12, MAXQ = 15, MAXP = 10, MAX_ITEMS = 300, MAX_IMG = 700000;
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
const IMG_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+\/=]+$/;

/* ---------- styled text (room, item and tier names, bubbles, trivia) ---------- */
// Stored as a small, safe subset of HTML: b, i, u, s, sup, sub and http(s)/mailto links.
// Multi-line fields (bubble pages, follow-up text) keep newline characters.
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' };
const TAGMAP = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', s: 's', strike: 's', del: 's', sup: 'sup', sub: 'sub', a: 'a' };
function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function unescText(s) { return String(s).replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, m => ENT[m]); }
function plainOf(html) { return unescText(String(html || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(); }
function cleanRich(input, maxPlain, multi) {
  const src = String(input == null ? '' : input).slice(0, maxPlain * 10 + 400);
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|(<)/g;
  const stack = [];
  let out = '', plain = 0, m;
  while ((m = re.exec(src))) {
    if (m[4] !== undefined || m[5] !== undefined) {
      let t = m[4] !== undefined ? unescText(m[4]) : '<';
      t = multi ? t.replace(/\r/g, '').replace(/\t+/g, ' ') : t.replace(/[\r\n\t]+/g, ' ');
      if (plain + t.length > maxPlain) t = t.slice(0, Math.max(0, maxPlain - plain));
      plain += t.length;
      out += escText(t);
      continue;
    }
    const closing = m[1] === '/', name = m[2].toLowerCase();
    if (name === 'br') { if (!closing && plain < maxPlain) { out += multi ? '\n' : ' '; plain++; } continue; }
    const tag = TAGMAP[name];
    if (!tag) continue;
    if (closing) {
      const idx = stack.lastIndexOf(tag);
      if (idx >= 0) while (stack.length > idx) out += '</' + stack.pop() + '>';
      continue;
    }
    if (stack.length >= 8) continue;
    if (tag === 'a') {
      const hm = /href\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[3]);
      const href = hm ? unescText(hm[1] !== undefined ? hm[1] : hm[2]).trim() : '';
      if (!/^(https?:\/\/|mailto:)/i.test(href) || href.length > 500) continue;
      out += '<a href="' + escText(href).replace(/"/g, '&quot;') + '">';
    } else out += '<' + tag + '>';
    stack.push(tag);
  }
  while (stack.length) out += '</' + stack.pop() + '>';
  out = out.trim();
  return multi ? out.replace(/\n{3,}/g, '\n\n') : out;
}

/* Tier Ranker files store styled text as **bold** *italic* __underline__ ~~strike~~ ^sup^ ~sub~ [text](url).
   This converts that markup to the HTML subset above so Tier Ranker lists open here. */
const ESCSYM = '*_~^[]()\\';
const MK = { '**': 'b', '*': 'i', '__': 'u', '~~': 's', '~': 'sb', '^': 'sp' };
const unescSym = s => s.replace(/[-]/g, c => ESCSYM[c.charCodeAt(0) - 0xE000]);
function safeUrl(u) {
  u = String(u || '').trim();
  if (!u || u.length > 2000 || /\s/.test(u)) return '';
  if (!/^https?:\/\//i.test(u)) {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(u) || /^(javascript|data|vbscript|mailto|tel|sms|file|blob|about):/i.test(u)) return '';
    u = 'https://' + u;
  }
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') && x.hostname.includes('.') ? x.href : ''; } catch (e) { return ''; }
}
function inlineParts(src, links, depth) {
  const toks = src.split(/(\*\*|\*|__|~~|~|\^)/).filter(t => t !== '');
  const isM = t => Object.prototype.hasOwnProperty.call(MK, t);
  const pair = new Array(toks.length).fill(false), open = {};
  const canOpen = i => i + 1 < toks.length && !/^\s/.test(toks[i + 1]);
  const canClose = i => i > 0 && !/\s$/.test(toks[i - 1]);
  toks.forEach((t, i) => {
    if (!isM(t)) return;
    const o = open[t];
    if (o === undefined) { if (canOpen(i)) open[t] = i; return; }
    if (!canClose(i)) { if (canOpen(i)) open[t] = i; return; }
    if ((t === '~' || t === '^') && !/^\S+$/.test(toks.slice(o + 1, i).join(''))) { if (canOpen(i)) open[t] = i; else delete open[t]; return; }
    pair[o] = pair[i] = true; delete open[t];
  });
  const st = { b: 0, i: 0, u: 0, s: 0, sb: 0, sp: 0 }, out = [];
  const flags = () => ({ b: !!st.b, i: !!st.i, u: !!st.u, s: !!st.s, sb: !!st.sb, sp: !!st.sp });
  toks.forEach((t, i) => {
    if (isM(t) && pair[i]) { st[MK[t]] = st[MK[t]] ? 0 : 1; return; }
    t.split(/(\d+)/).forEach(piece => {
      if (!piece) return;
      const m = /^(\d+)$/.exec(piece);
      if (m && depth === 0 && links[+m[1]]) {
        const L = links[+m[1]], f = flags();
        inlineParts(L.label, links, 1).forEach(p => {
          out.push({ t: p.t, b: p.b || f.b, i: p.i || f.i, u: p.u || f.u, s: p.s || f.s, sb: p.sb || f.sb, sp: p.sp || f.sp, href: L.href });
        });
      } else out.push(Object.assign({ t: unescSym(piece) }, flags()));
    });
  });
  return out;
}
function markupToHtml(text) {
  const links = [];
  let src = String(text == null ? '' : text).replace(/\\([*_~^\[\]()\\])/g, (m, c) => String.fromCharCode(0xE000 + ESCSYM.indexOf(c)));
  src = src.replace(/\[([^\[\]]+)\]\(((?:[^()\s]|\([^()\s]*\))+)\)/g, (m, label, url) => {
    const u = safeUrl(unescSym(url)); if (!u) return m;
    links.push({ label, href: u }); return '' + (links.length - 1) + '';
  });
  return inlineParts(src, links, 0).map(p => {
    let h = escText(p.t);
    [['sb', 'sub'], ['sp', 'sup'], ['s', 's'], ['u', 'u'], ['i', 'i'], ['b', 'b']].forEach(([k, tag]) => { if (p[k]) h = '<' + tag + '>' + h + '</' + tag + '>'; });
    if (p.href) h = '<a href="' + escText(p.href).replace(/"/g, '&quot;') + '">' + h + '</a>';
    return h;
  }).join('');
}
const hexColor = c => (typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)) ? c.toLowerCase() : '#888888';

/* ---------- item info: text bubbles and trivia ---------- */
const emptyRc = () => ({ kind: 'none', title: '', text: '', pages: [], qs: [] });
const bubbleTitle = (b, rc) => plainOf(rc && rc.title) ? rc.title : (plainOf(b.name) ? 'More on ' + b.name : 'More info');
function cleanRc(rc) {
  if (!rc || typeof rc !== 'object') return emptyRc();
  const kind = rc.kind === 'text' || rc.kind === 'trivia' ? rc.kind : 'none';
  const used = new Set();
  const qs = (Array.isArray(rc.qs) ? rc.qs : []).slice(0, MAXQ).filter(x => x && typeof x === 'object').map(x => {
    let id = typeof x.id === 'string' && /^q[a-f0-9]{6,12}$/.test(x.id) && !used.has(x.id) ? x.id : null;
    if (!id) do { id = 'q' + crypto.randomBytes(4).toString('hex'); } while (used.has(id));
    used.add(id);
    const opts = (Array.isArray(x.opts) ? x.opts : []).slice(0, 6).map(o => cleanRich(o, 200));
    while (opts.length < 2) opts.push('');
    return { id, q: cleanRich(x.q, 500), opts, correct: Number.isInteger(x.correct) && x.correct >= 0 && x.correct < opts.length ? x.correct : 0, expl: cleanRich(x.expl, 2000, true) };
  });
  return { kind, title: cleanRich(rc.title, 80), text: cleanRich(rc.text, 2000, true), pages: (Array.isArray(rc.pages) ? rc.pages : []).slice(0, MAXP).map(p => cleanRich(p, 2000, true)), qs };
}
function textPages(rc) { return [rc && rc.text].concat(rc && Array.isArray(rc.pages) ? rc.pages : []).map(x => String(x || '').trim()).filter(x => plainOf(x)); }
// Questions a guest can answer: question text, 2+ non-blank answers, and a correct answer that is not blank.
function readyQs(b) {
  const rc = b.rc;
  if (!rc || rc.kind !== 'trivia' || !Array.isArray(rc.qs)) return [];
  const out = [];
  rc.qs.forEach(x => {
    if (out.length >= MAXQ || !plainOf(x.q)) return;
    const opts = []; let correct = -1;
    x.opts.forEach((o, i) => { if (plainOf(o)) { if (i === x.correct) correct = opts.length; opts.push(o); } });
    if (opts.length < 2 || correct < 0) return;
    out.push({ id: x.id, q: x.q, opts, correct, expl: x.expl });
  });
  return out;
}
const infoReady = b => { const rc = b.rc; if (!rc) return false; return rc.kind === 'text' ? textPages(rc).length > 0 : rc.kind === 'trivia' ? readyQs(b).length > 0 : false; };

/* ---------- storage ---------- */
let rooms = {}; // hostCode -> room
const byJoin = {}; // joinCode -> room
try { rooms = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { rooms = {}; }
const HOST = '_host';
const TIE_METHODS = ['average', 'high', 'under', 'showdown', 'slots'];
const MAX_TIEQ = 20;
const defaultCfg = () => ({ reveal: false, timer: 30, hostScore: true, hostPlay: false, desc: '', hostVotes: false, hideNext: false, shuffle: true, pollTimer: 0, tie: 'average', tieFallback: 'average', tiers: DEFAULT_TIERS.map(([id, color]) => ({ id, label: id, color })) });
Object.values(rooms).forEach(r => {
  // Upgrade rooms saved by earlier versions of this app.
  if (r.bugs && !r.items) { r.items = r.bugs; delete r.bugs; }
  if (r.live && r.live.bugId !== undefined) r.live = { itemId: r.live.bugId, open: r.live.open };
  if (typeof r.name !== 'string') r.name = '';
  if (!r.v) { // names were plain text before styled names existed
    r.name = escText(r.name);
    (r.items || []).forEach(b => { b.name = escText(String(b.name || '')); });
  }
  if (!r.cfg || !Array.isArray(r.cfg.tiers) || !r.cfg.tiers.length) r.cfg = defaultCfg();
  if (!r.answers) r.answers = {};
  if (!r.players) r.players = {};
  if (!r.tdone) r.tdone = {};
  if (!r.tpres) r.tpres = {};
  if (typeof r.hostName !== 'string' || !r.hostName) r.hostName = 'Host';
  if (r.cfg.timer === undefined) r.cfg.timer = 60;
  if (r.cfg.hostScore === undefined) r.cfg.hostScore = true;
  if (r.cfg.hostPlay === undefined) r.cfg.hostPlay = false;
  if (r.peek === undefined) r.peek = null;
  delete r.cfg.bubble;
  if (!TIE_METHODS.includes(r.cfg.tie)) r.cfg.tie = 'average';
  if (r.cfg.tieFallback !== 'slots') r.cfg.tieFallback = 'average';
  if (!Array.isArray(r.tiePool)) r.tiePool = [];
  if (!Array.isArray(r.tieSpent)) r.tieSpent = [];
  if (typeof r.cfg.desc !== 'string') r.cfg.desc = '';
  if (r.cfg.hostVotes === undefined) r.cfg.hostVotes = false;
  if (r.cfg.hideNext === undefined) r.cfg.hideNext = false;
  if (r.cfg.shuffle === undefined) r.cfg.shuffle = true;
  if (r.cfg.pollTimer === undefined) r.cfg.pollTimer = 0;
  if ((r.v || 0) < 4) { r.answers = {}; r.tdone = {}; } // answers saved by older versions used a different shape
  if (!r.votes) r.votes = {};
  r.v = 5;
  byJoin[r.joinCode] = r;
  if ((r.v || 0) < 5) (r.items || []).forEach(b => { if (b.final) b.shown = true; });
  delete r.display; delete r.board;
  let seq = r.rankSeq || 0;
  (r.items || []).forEach(b => {
    if (!b.rc) b.rc = emptyRc();
    if (b.final && !b.rank) b.rank = ++seq;
    if (b.final && b.shown === undefined) b.shown = true;
  });
  r.rankSeq = seq;
});

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    fs.writeFile(DATA_FILE + '.tmp', JSON.stringify(rooms), err => {
      if (!err) fs.rename(DATA_FILE + '.tmp', DATA_FILE, () => {});
    });
  }, 1000);
}
function makeCode(n, taken) {
  for (;;) {
    const b = crypto.randomBytes(n);
    let s = '';
    for (let i = 0; i < n; i++) s += ALPHA[b[i] % ALPHA.length];
    if (!taken[s]) return s;
  }
}
const norm = s => String(s || '').trim().toUpperCase();
const tierIds = room => room.cfg.tiers.map(t => t.id);

/* ---------- tallies ---------- */
const conns = new Map(); // hostCode -> {hosts, guests}
function connsFor(room) {
  let c = conns.get(room.hostCode);
  if (!c) { c = { hosts: new Set(), guests: new Set() }; conns.set(room.hostCode, c); }
  return c;
}
function tally(room, itemId) {
  const ids = tierIds(room), known = new Set(ids), c = {};
  ids.forEach(t => { c[t] = 0; });
  let n = 0;
  const v = room.votes[itemId] || {};
  for (const cid in v) if (known.has(v[cid])) { c[v[cid]]++; n++; }
  return { c, n };
}
// Plurality wins. A tie goes to whichever tied tier sits closest to the average vote.
function finalTier(room, c, n) {
  if (!n) return null;
  const ids = tierIds(room);
  let mean = 0;
  ids.forEach((t, i) => { mean += i * c[t]; });
  mean /= n;
  const max = Math.max(...ids.map(t => c[t]));
  let best = null, bd = 1e9;
  ids.forEach((t, i) => { if (c[t] === max) { const d = Math.abs(i - mean); if (d < bd) { bd = d; best = t; } } });
  return best;
}
/* ---------- live trivia ---------- */
const pidOf = cid => crypto.createHash('sha1').update(String(cid)).digest('hex').slice(0, 10);
const answersFor = (room, b, q) => ((room.answers[b.id] || {})[q.id]) || {};
const doneSet = (room, b) => room.tdone[b.id] || {};
function tphase(room) {
  const t = room.trivia;
  if (!t) return null;
  if (t.pending) return 'hold';
  const now = Date.now();
  if (now < t.startAt) return 'countdown';
  if (now < t.endAt) return 'question';
  return t.revealed ? 'revealed' : 'results';
}
const counted = (room, cid) => cid !== HOST || (room.cfg.hostPlay && room.cfg.hostScore);
function qstats(room, b) {
  const done = doneSet(room, b);
  return readyQs(b).map(q => {
    const m = answersFor(room, b, q), s = { id: q.id, n: 0, right: 0, picks: q.opts.map(() => 0), revealed: !!done[q.id], host: done[q.id] && m[HOST] ? (m[HOST].pick === q.correct ? 'right' : 'wrong') : null };
    for (const cid in m) {
      if (!counted(room, cid) || !(m[cid].pick in s.picks)) continue;
      s.n++; s.picks[m[cid].pick]++;
      if (m[cid].pick === q.correct) s.right++;
    }
    return s;
  });
}
function scoreMap(room) {
  if (room._sc && room._scRev === room.rev) return room._sc;
  const sc = {};
  room.items.forEach(b => {
    const done = doneSet(room, b);
    readyQs(b).forEach(q => {
      if (!done[q.id]) return;
      const m = answersFor(room, b, q);
      for (const cid in m) if (counted(room, cid) && m[cid].pick === q.correct) sc[cid] = (sc[cid] || 0) + 1;
    });
  });
  room._sc = sc; room._scRev = room.rev;
  return sc;
}
function leaderboard(room, cid) {
  const sc = scoreMap(room), list = [];
  const bm = bonusMap(room);
  Object.keys(room.players).forEach(c => list.push({ cid: c, name: room.players[c], score: sc[c] || 0, bonus: bm[c] || 0, host: false }));
  if (room.cfg.hostPlay && room.cfg.hostScore) list.push({ cid: HOST, name: room.hostName, score: sc[HOST] || 0, bonus: 0, host: true });
  list.sort((a, b) => b.score - a.score || b.bonus - a.bonus || a.name.localeCompare(b.name));
  let rank = 0, last = null;
  list.forEach((e, i) => { const k = e.score + ':' + e.bonus; if (k !== last) { rank = i + 1; last = k; } e.rank = rank; });
  const me = cid ? list.find(e => e.cid === cid) : null;
  return { top: list.slice(0, 10).map(e => ({ rank: e.rank, name: e.name, score: e.score, bonus: e.bonus, host: e.host })), total: list.length, me: me ? { rank: me.rank, score: me.score, bonus: me.bonus } : null, all: list };
}
function connectedNamed(room) {
  const out = new Set();
  connsFor(room).guests.forEach(g => { if (room.players[g.cid]) out.add(g.cid); });
  return out;
}
// Guests who opened the link but have not picked a name yet.
function joiningCount(room) {
  const out = new Set();
  connsFor(room).guests.forEach(g => { if (!room.players[g.cid]) out.add(g.cid || g); });
  return out.size;
}
const triviaLive = room => { const ph = tphase(room); return ph === 'countdown' || ph === 'question' || ph === 'results' || ph === 'revealed'; };
// Start the countdown for a trivia question that was held for joining players.
function activateTrivia(room) {
  const t = room.trivia;
  if (!t || !t.pending) return;
  const now = Date.now();
  t.pending = false; t.startAt = now + 3000; t.endAt = now + 3000 + room.cfg.timer * 1000;
  t.pres = {}; t.held = {}; t.wait = {};
  connectedNamed(room).forEach(c => { t.pres[c] = true; });
  scheduleTrivia(room);
}
function maybeStartTrivia(room) {
  const t = room.trivia;
  if (t && t.pending && joiningCount(room) === 0) { activateTrivia(room); return true; }
  return false;
}
// A guest who shows up while a question is running waits on a hold screen until they choose to proceed.
function holdArrival(room, cid) {
  const t = room.trivia;
  if (t && triviaLive(room) && room.players[cid]) { (t.held || (t.held = {}))[cid] = true; }
}
// Everyone who can still answer has locked in: end the timer early.
function checkAllLocked(room) {
  const t = room.trivia;
  if (!t || tphase(room) !== 'question') return;
  const b = room.items.find(x => x.id === t.itemId);
  if (!b) return;
  const m = answersFor(room, b, { id: t.qid });
  const elig = [...connectedNamed(room)].filter(c => (t.pres || {})[c] && !(t.held || {})[c]);
  const guestsOk = elig.every(c => m[c] && m[c].locked);
  const hostOk = !t.hostPlay || (m[HOST] && m[HOST].locked);
  if ((elig.length || t.hostPlay) && guestsOk && hostOk) { t.endAt = Date.now(); }
}
/* ---------- tie breaking ---------- */
const TIE_MS = { average: 2800, high: 2400, under: 2400, slots: 5600 };
const TIE_BEAT = 3200;
const readyTie = room => readyQs({ rc: { kind: 'trivia', qs: room.tiePool || [] } });
// A tie-breaking question is spent the moment it is asked in any showdown; the pool is shared by the whole room.
const availTie = room => readyTie(room).filter(q => !(room.tieSpent || []).includes(q.id));
// Showdown quietly switches itself off when nothing is left: no questions at all means Average, spent ones mean the host's backup.
function tieSettle(room, b) {
  const t = b && b.tie;
  if (!t || t.phase !== 'wait' || t.method !== 'showdown' || availTie(room).length) return;
  if (readyTie(room).length) { t.method = room.cfg.tieFallback === 'slots' ? 'slots' : 'average'; t.sfb = true; }
  else { t.method = 'average'; t.sfb = false; }
}
function tqOf(room, t) {
  const b = room.items.find(x => x.id === t.itemId);
  if (!b) return {};
  const qs = t.tie ? readyTie(room) : readyQs(b);
  return { b, qs, q: qs.find(x => x.id === t.qid) };
}
function tieElig(room, b, cid) { return cid !== HOST && !!(b.tie && b.tie.tiers.includes((room.votes[b.id] || {})[cid])); }
function tieDist(room, b, q) {
  const m = answersFor(room, b, q), d = q.opts.map(() => 0);
  for (const cid in m) if (cid !== HOST && m[cid].pick in d) d[m[cid].pick]++;
  return d;
}
function tiedTiers(room, c, n) {
  if (!n) return [];
  const ids = tierIds(room), max = Math.max(...ids.map(t => c[t]));
  const t = ids.filter(x => c[x] === max);
  return t.length > 1 ? t : [];
}
function pickByMethod(room, tiers, method) {
  const ids = tierIds(room), idx = tiers.map(t => ids.indexOf(t)).sort((a, b) => a - b);
  if (method === 'high') return ids[idx[0]];
  if (method === 'under') return ids[idx[idx.length - 1]];
  if (method === 'slots') return ids[idx[crypto.randomInt(idx.length)]];
  const mean = idx.reduce((a, b) => a + b, 0) / idx.length;
  let i;
  if (Math.abs((mean % 1) - 0.5) < 1e-9) i = (idx.length === 2 && idx[0] === 0 && idx[1] === 1) ? 1 : Math.floor(mean); // halves go to the higher rank, except S and A which go to A
  else i = Math.round(mean);
  return ids[Math.max(0, Math.min(ids.length - 1, i))];
}
function finishTie(room, b, winner) {
  const t = b.tie;
  if (!t || t.phase === 'done' || !winner) return;
  b.final = winner; b.auto = winner; b.manual = false; b.rank = ++room.rankSeq;
  t.phase = 'done'; t.winner = winner;
  touch(room);
}
function scheduleTie(room, b) {
  const t = b.tie;
  if (!t || t.phase !== 'run') return;
  const id = b.id;
  setTimeout(() => { const x = room.items.find(i => i.id === id); if (x && x.tie === t && t.phase === 'run') { finishTie(room, x, t.winner); pushAll(room); } }, Math.max(0, t.resultAt - Date.now()) + 60);
}
function startTieRun(room, b, method, fb) {
  const t = b.tie, now = Date.now();
  const beat = fb && !t.sfb ? TIE_BEAT : 0; // a short message precedes a backup method that follows a spent showdown
  t.how = method; t.fb = !!fb; t.beat = beat; t.phase = 'run'; t.startAt = now + beat; t.resultAt = t.startAt + TIE_MS[method];
  t.winner = pickByMethod(room, t.tiers, method);
  scheduleTie(room, b);
}
function tieView(room, b) {
  const t = b.tie;
  if (!t) return null;
  tieSettle(room, b);
  const v = { tiers: t.tiers, method: t.method, phase: t.phase, how: t.how || null, fb: !!t.fb, startAt: t.startAt || 0, resultAt: t.resultAt || 0, now: Date.now(), left: availTie(room).length, sfb: !!t.sfb, beat: t.beat || 0 };
  if (t.phase === 'run' || t.phase === 'done') v.winner = t.winner;
  if (t.by) { v.by = room.players[t.by] || 'A guest'; v.ms = t.ms; }
  return v;
}
const bonusMap = room => { const m = {}; room.items.forEach(b => { if (b.tie && b.tie.by && b.tie.how === 'showdown') m[b.tie.by] = (m[b.tie.by] || 0) + 1; }); return m; };

function triviaView(room, cid) {
  const t = room.trivia;
  if (!t) return null;
  const { b, qs, q } = tqOf(room, t);
  if (!b || !q) return null;
  const ph = tphase(room), host = !cid, done = doneSet(room, b);
  const m = answersFor(room, b, q);
  const tieUsed = (b.tie && b.tie.used) || [];
  const hasNext = t.tie ? availTie(room).some(x => x.id !== q.id) : qs.some(x => !done[x.id] && x.id !== q.id);
  if (ph === 'hold') return host ? { itemId: b.id, qid: q.id, qi: 0, n: qs.length, phase: 'hold', joining: joiningCount(room), now: Date.now(), name: b.name, hasNext: false, tie: !!t.tie } : null;
  if (!host && ((room.trivia.held || {})[cid])) return null;
  const v = { itemId: b.id, qid: q.id, qi: t.tie ? 0 : qs.findIndex(x => x.id === q.id), n: qs.length, phase: ph, startAt: t.startAt, endAt: t.endAt, now: Date.now(), name: b.name, hasNext, tie: !!t.tie };
  if (t.tie) {
    v.tiers = b.tie.tiers;
    if (!host) v.elig = tieElig(room, b, cid);
    if (t.win) v.win = { name: room.players[t.win.cid] || 'A guest', ms: t.win.ms, tier: (room.votes[b.id] || {})[t.win.cid] || null, mine: !host && t.win.cid === cid };
  }
  if (ph !== 'countdown') { v.q = q.q; v.opts = q.opts; }
  if (host) {
    v.count = Object.keys(m).filter(c => c !== HOST).length;
    v.hostPlay = !!t.hostPlay;
    v.hostPick = t.hostPlay && m[HOST] ? m[HOST].pick : null;
    v.hostLocked = !!(t.hostPlay && m[HOST] && m[HOST].locked);
    const here = [...connectedNamed(room)].filter(c => (t.pres || {})[c] && !(t.held || {})[c]);
    v.ready = here.length; v.lockedN = here.filter(c => m[c] && m[c].locked).length;
  } else { v.mine = m[cid] ? m[cid].pick : null; v.locked = !!(m[cid] && m[cid].locked); }
  if (ph === 'results' || ph === 'revealed') {
    if (host) { v.dist = t.tie ? tieDist(room, b, q) : qstats(room, b).find(x => x.id === q.id).picks; }
  }
  if (ph === 'revealed') {
    v.correct = q.correct; v.more = !!t.more; v.expl = host || t.more ? q.expl : ''; // guests only get the follow-up once the host opens it
    if (!host) { v.dist = t.tie ? tieDist(room, b, q) : qstats(room, b).find(x => x.id === q.id).picks; v.result = v.mine == null ? 'none' : (v.mine === q.correct ? 'right' : 'wrong'); }
    else if (v.hostPick != null) v.hostResult = v.hostPick === q.correct ? 'right' : 'wrong';
  }
  return v;
}
function scheduleTrivia(room) {
  const t = room.trivia;
  if (!t) return;
  const now = Date.now();
  [t.startAt, t.endAt].forEach(at => { if (at > now) setTimeout(() => { if (room.trivia === t) pushAll(room); }, at - now + 40); });
}
// two names clash when they match ignoring capitalization, spacing, punctuation and accents
function nameKey(n) { return String(n).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''); }
const TAKEN_MSG = 'That name is already taken. Please try another.';
function nameTaken(room, n, selfCid) {
  const k = nameKey(n);
  if (!k) return false;
  if (selfCid !== HOST && nameKey(room.hostName) === k) return true;
  return Object.keys(room.players).some(c => c !== selfCid && nameKey(room.players[c]) === k);
}
function playerName(room, raw) {
  let n = String(raw == null ? '' : raw).normalize('NFC').replace(/\s+/g, ' ').trim();
  const chars = Array.from(n);
  if (!chars.length || chars.length > 10) throw new Error('Pick a name of 1 to 10 characters.');
  if (!/^[\p{L}\p{N} _.\-]+$/u.test(n)) throw new Error('Use letters, numbers, spaces, dots, dashes or underscores.');
  if (!nameAllowed(n)) throw new Error('Please pick a different name.');
  return n;
}
function guestInfo(room, b, cid) {
  if (!b.shown) return null; // the text bubble appears with the placement
  const rc = b.rc || emptyRc();
  if (rc.kind === 'text') { const pages = textPages(rc); return pages.length ? { kind: 'text', title: bubbleTitle(b, rc), pages } : null; }
  return null;
}

/* ---------- views ---------- */
const isOver = b => !!(b.final && b.manual && b.final !== (b.auto || null));
function itemView(b, withResults, room) {
  const v = { id: b.id, name: b.name, img: b.img ? (b.imgV || 1) : 0 };
  if (withResults) { v.final = b.final || null; v.counts = b.counts || null; v.votes = b.votes || 0; v.over = isOver(b); v.auto = b.auto || null; v.revealAt = b.revealAt || 0; v.tie = room ? tieView(room, b) : null; }
  return v;
}
function hostItem(room, b) {
  const v = itemView(b, true, room);
  if (b.ord === undefined) b.ord = Math.random();
  v.rank = b.rank || 0; v.shown = !!b.shown; v.manual = !!b.manual; v.ord = b.ord;
  const kind = (b.rc && b.rc.kind) || 'none';
  v.info = { kind, ready: infoReady(b), pages: kind === 'text' ? textPages(b.rc).length : 0, qs: kind === 'trivia' ? readyQs(b).length : 0, inc: kind === 'trivia' ? Math.max(0, ((b.rc && b.rc.qs) || []).length - readyQs(b).length) : 0 };
  if (kind === 'trivia') v.tstats = qstats(room, b);
  return v;
}
function hostView(room) {
  return {
    joinCode: room.joinCode,
    name: room.name || '',
    tiers: room.cfg.tiers,
    cfg: { timer: room.cfg.timer, hostScore: !!room.cfg.hostScore, hostPlay: !!room.cfg.hostPlay, tie: room.cfg.tie, tieFallback: room.cfg.tieFallback, tieQs: readyTie(room).length, tieLeft: availTie(room).length, desc: room.cfg.desc || '', hostVotes: !!room.cfg.hostVotes, hideNext: !!room.cfg.hideNext, shuffle: room.cfg.shuffle !== false, pollTimer: room.cfg.pollTimer || 0 },
    now: Date.now(),
    peek: room.peek || null,
    hvote: room.live.itemId && room.live.open ? ((room.votes[room.live.itemId] || {})[HOST] || null) : null,
    hostName: room.hostName,
    tr: triviaView(room, null),
    lb: (() => { const l = leaderboard(room); return { top: l.top, total: l.total }; })(),
    tpool: room.tiePool || [],
    tspent: room.tieSpent || [],
    players: Object.keys(room.players).map(c => ({ pid: pidOf(c), name: room.players[c], score: scoreMap(room)[c] || 0, bonus: bonusMap(room)[c] || 0 })),
    live: room.live,
    items: room.items.map(b => hostItem(room, b)),
    voted: room.live.itemId && room.live.open ? tally(room, room.live.itemId).n : 0
  };
}
// Guests only receive the item that is currently open plus the items they have voted on,
// and only receive results when the host has them turned on.
// One guest's result on each of an item's questions: right, wrong (also when time ran out), or miss (skipped or not there).
function qResults(room, b, cid) {
  const done = doneSet(room, b), pres = (room.tpres && room.tpres[b.id]) || {};
  return readyQs(b).map(q => {
    if (!done[q.id]) return 'miss';
    const a = answersFor(room, b, q)[cid];
    if (a) return a.pick === q.correct ? 'right' : 'wrong';
    return (pres[q.id] || {})[cid] ? 'wrong' : 'miss';
  });
}
function guestView(room, cid) {
  const mine = {}, tres = {};
  for (const id in room.votes) if (room.votes[id][cid]) mine[id] = room.votes[id][cid];
  const items = room.items.filter(b => b.id === room.live.itemId || mine[b.id]);
  const info = {};
  items.forEach(b => {
    if (!mine[b.id]) return;
    const rc = b.rc || emptyRc();
    if (rc.kind === 'trivia') tres[b.id] = qResults(room, b, cid);
    else if (rc.kind === 'text' && textPages(rc).length) tres[b.id] = 'text';
  });
  const live = room.live.itemId ? room.items.find(b => b.id === room.live.itemId) : null;
  if (live) { const gi = guestInfo(room, live, cid); if (gi) info[live.id] = gi; }
  const t = room.trivia, ph = tphase(room);
  let hold = null;
  if (t && (t.held || {})[cid] && room.players[cid]) {
    const asking = (ph === 'countdown' || ph === 'question') && !(t.wait || {})[cid];
    hold = { state: asking ? 'ask' : 'wait', startAt: t.startAt, endAt: t.endAt, now: Date.now() };
  }
  const lr = room.items.filter(b => b.final && b.shown).sort((a, b) => (b.seq || 0) - (a.seq || 0)).slice(0, 3).map(b => {
    const rc = b.rc || emptyRc(), o = { id: b.id, name: b.name, img: b.img ? (b.imgV || 1) : 0, final: b.final, over: isOver(b), votes: b.votes || 0, kind: 'none', mine: (room.votes[b.id] || {})[cid] || null, counts: b.counts || null, tie: b.tie && b.tie.phase === 'done' ? tieView(room, b) : null, revealAt: b.revealAt || 0 };
    if (rc.kind === 'trivia' && readyQs(b).length) { o.kind = 'trivia'; o.segs = qResults(room, b, cid); }
    else if (rc.kind === 'text' && textPages(rc).length) o.kind = 'text';
    return o;
  });
  return {
    joinCode: room.joinCode,
    name: room.name || '',
    desc: room.cfg.desc || '',
    now: Date.now(),
    tiers: room.cfg.tiers,
    live: room.live,
    liveShown: !!(live && live.shown),
    peek: (() => { const pb = room.cfg.hideNext && room.peek && room.items.find(x => x.id === room.peek && !x.final && x.id !== room.live.itemId); return pb ? { id: pb.id, name: pb.name, img: pb.img ? (pb.imgV || 1) : 0 } : null; })(),
    items: items.map(b => itemView(b, !!b.shown, room)),
    placed: room.items.filter(b => b.final && b.shown).sort((a, b) => (a.rank || 0) - (b.rank || 0)).map(b => ({ id: b.id, name: b.name, img: b.img ? (b.imgV || 1) : 0, final: b.final, over: isOver(b), auto: b.auto || null, rank: b.rank || 0, seq: b.seq || 0, votes: b.votes || 0, counts: b.counts || null, tie: b.tie && b.tie.phase === 'done' ? tieView(room, b) : null })),
    mine, tres, info, hold, lr,
    me: { name: room.players[cid] || null, score: scoreMap(room)[cid] || 0, bonus: bonusMap(room)[cid] || 0 },
    lb: (() => { const l = leaderboard(room, cid); return { top: l.top, total: l.total, me: l.me }; })(),
    tr: triviaView(room, cid), timer: room.cfg.timer
  };
}
function send(res, obj) { res.write('data: ' + JSON.stringify(obj) + '\n\n'); }
function pushHosts(room) {
  const c = connsFor(room);
  if (!c.hosts.size) return;
  const v = hostView(room);
  c.hosts.forEach(res => send(res, v));
}
function pushGuests(room) {
  const c = connsFor(room);
  c.guests.forEach(g => send(g.res, guestView(room, g.cid)));
}
function pushAll(room) { pushHosts(room); pushGuests(room); }
function pushGuestsWithCid(room, cid) {
  connsFor(room).guests.forEach(g => { if (g.cid === cid) send(g.res, guestView(room, cid)); });
}
setInterval(() => {
  conns.forEach(c => {
    c.hosts.forEach(r => r.write(': ping\n\n'));
    c.guests.forEach(g => g.res.write(': ping\n\n'));
  });
  const now = Date.now();
  Object.values(rooms).forEach(r => {
    const c = conns.get(r.hostCode), busy = c && (c.hosts.size || c.guests.size);
    if (now - r.touched > ROOM_TTL_MS && !busy) {
      delete rooms[r.hostCode]; delete byJoin[r.joinCode]; conns.delete(r.hostCode); save();
    }
  });
}, 25000);
function openStream(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive', 'X-Accel-Buffering': 'no'
  });
  res.write('retry: 2000\n\n');
}

/* ---------- helpers ---------- */
const fails = new Map();
function ipOf(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function blocked(req) {
  const f = fails.get(ipOf(req));
  return f && Date.now() - f.t < 600000 && f.n > 40;
}
function noteFail(req) {
  const ip = ipOf(req), f = fails.get(ip);
  if (!f || Date.now() - f.t > 600000) fails.set(ip, { n: 1, t: Date.now() });
  else f.n++;
}
function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function httpErr(code, msg) { const e = new Error(msg); e.status = code; return e; }
function readBody(req, max) {
  return new Promise((ok, bad) => {
    let n = 0, big = false; const c = [];
    req.on('data', d => { n += d.length; if (n > max) { big = true; c.length = 0; return; } if (!big) c.push(d); }); // keep draining so the client gets its answer
    req.on('end', () => {
      if (big) return bad(httpErr(413, 'That request is too large.'));
      let v; try { v = JSON.parse(Buffer.concat(c).toString() || '{}'); } catch (e) { return bad(httpErr(400, 'Bad request')); }
      if (!v || typeof v !== 'object' || Array.isArray(v)) return bad(httpErr(400, 'Bad request'));
      ok(v);
    });
    req.on('error', bad);
  });
}
const touch = room => { room.touched = Date.now(); room.rev = (room.rev || 0) + 1; save(); };
const newId = () => 'b' + crypto.randomBytes(5).toString('hex');
function sendImage(res, b) {
  const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(b.img);
  res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400' });
  return res.end(Buffer.from(m[2], 'base64'));
}

/* ---------- host actions ---------- */
function closePoll(room) {
  const id = room.live.itemId;
  const b = room.items.find(x => x.id === id);
  if (!b || !room.live.open) return;
  const t = tally(room, id);
  const tied = tiedTiers(room, t.c, t.n);
  b.counts = t.c; b.votes = t.n;
  b.manual = false; b.tie = null; delete b.revealAt;
  b.shown = false; // the host reveals the result on stage
  if (tied.length) { // a tie waits for the host to break it; the item stays unplaced until then
    b.final = null; b.auto = null; b.rank = 0;
    b.tie = { tiers: tied, method: room.cfg.tie, phase: 'wait', used: [] };
    tieSettle(room, b);
  } else {
    b.final = finalTier(room, t.c, t.n); b.auto = b.final;
    if (b.final) b.rank = ++room.rankSeq;
  }
  room.live = { itemId: id, open: false };
}
function schedulePoll(room) {
  const l = room.live;
  if (!l || !l.open || !l.endAt) return;
  const id = l.itemId;
  setTimeout(() => {
    if (room.live.open && room.live.itemId === id && room.live.endAt && Date.now() >= room.live.endAt - 50) { closePoll(room); touch(room); save(); pushAll(room); }
  }, Math.max(0, l.endAt - Date.now()) + 60);
}
function clearPlacement(room, b) {
  const old = b.final;
  b.final = null; b.counts = null; b.votes = 0; b.shown = false; b.manual = false; b.rank = 0; delete b.auto; delete b.revealAt; b.tie = null;
  if (room.trivia && room.trivia.tie && room.trivia.itemId === b.id) room.trivia = null;
  if (old) renumber(room, old);
}
// Put an item at a position in a tier (or back to unranked when tier is null), keeping per-tier order dense.
function placeItem(room, b, tier, index) {
  const old = b.final;
  if (!tier) { b.final = null; b.shown = false; b.manual = false; b.rank = 0; delete b.auto; if (old) renumber(room, old); return; }
  const row = room.items.filter(x => x.final === tier && x !== b).sort((x, y) => (x.rank || 0) - (y.rank || 0));
  const i = Math.max(0, Math.min(row.length, Number.isInteger(index) ? index : row.length));
  row.splice(i, 0, b);
  b.final = tier; b.shown = true; b.manual = true;
  if (!b.counts) { b.counts = {}; tierIds(room).forEach(t => { b.counts[t] = 0; }); b.votes = 0; }
  row.forEach((x, k) => { x.rank = k + 1; });
  if (old && old !== tier) renumber(room, old);
}
function renumber(room, tier) {
  room.items.filter(x => x.final === tier).sort((x, y) => (x.rank || 0) - (y.rank || 0)).forEach((x, k) => { x.rank = k + 1; });
}
function addItem(room, raw, seen, order) {
  const isObj = raw && typeof raw === 'object';
  const html = cleanRich(isObj ? raw.name : raw, 120);
  const text = plainOf(html).toLowerCase();
  let img = null;
  if (isObj && raw.image) {
    if (typeof raw.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(raw.image) || raw.image.length > MAX_IMG) throw new Error('That image could not be used.');
    img = raw.image;
  }
  if (room.items.length >= MAX_ITEMS) return false;
  if (!text && !img) return false;
  if (text) { if (seen.has(text)) return false; seen.add(text); }
  const b = { id: newId(), name: html, order, final: null, rc: emptyRc() };
  if (img) { b.img = img; b.imgV = 1; }
  room.items.push(b);
  return true;
}
function pruneAnswers(room, b) {
  const byQ = room.answers[b.id];
  if (!byQ) return;
  const keep = new Set(readyQs(b).map(q => q.id));
  Object.keys(byQ).forEach(k => { if (!keep.has(k)) delete byQ[k]; });
  const d = room.tdone[b.id];
  if (d) Object.keys(d).forEach(k => { if (!keep.has(k)) delete d[k]; });
  if (room.trivia && room.trivia.itemId === b.id && !keep.has(room.trivia.qid)) room.trivia = null;
}
function clearTrivia(room, id) {
  delete room.answers[id]; delete room.tdone[id]; if (room.tpres) delete room.tpres[id];
  if (room.trivia && room.trivia.itemId === id) room.trivia = null;
}
function hostAction(room, a) {
  switch (a.type) {
    case 'add': {
      const seen = new Set(room.items.map(b => plainOf(b.name).toLowerCase()).filter(Boolean));
      let order = room.items.reduce((m, b) => Math.max(m, b.order || 0), 0);
      const raws = Array.isArray(a.items) ? a.items.slice(0, MAX_ITEMS) : (Array.isArray(a.names) ? a.names.map(escText) : []);
      raws.forEach(raw => { if (addItem(room, raw, seen, order + 1)) order++; });
      return;
    }
    case 'open': {
      const b = room.items.find(x => x.id === a.id);
      if (!b) throw new Error('No such item');
      if (room.trivia) { if (tphase(room) === 'revealed') room.trivia = null; else throw new Error('Finish or close the running trivia question first.'); }
      if (room.live.open && room.live.itemId !== b.id) throw new Error('Close the current poll first.');
      const cur = room.live.itemId && room.items.find(x => x.id === room.live.itemId);
      if (cur && cur !== b && !room.live.open && (cur.final || cur.tie) && !cur.shown) throw new Error('Reveal the current results first.');
      if (cur && cur !== b && !room.live.open && cur.tie && cur.tie.phase !== 'done') throw new Error('Break the tie first.');
      clearPlacement(room, b);
      delete room.votes[b.id]; // a fresh poll starts from zero
      clearTrivia(room, b.id);
      room.live = { itemId: b.id, open: true };
      room.peek = null;
      if (room.cfg.pollTimer > 0) { room.live.endAt = Date.now() + room.cfg.pollTimer * 1000; schedulePoll(room); }
      return;
    }
    case 'peek': room.peek = a.id ? String(a.id) : null; return;
    case 'close': closePoll(room); return;
    case 'reset': {
      const b = room.items.find(x => x.id === a.id);
      if (!b) throw new Error('No such item');
      clearPlacement(room, b);
      delete room.votes[b.id];
      clearTrivia(room, b.id);
      if (room.live.itemId === b.id) room.live = { itemId: null, open: false };
      return;
    }
    case 'reveal': {
      const b = room.items.find(x => x.id === a.id);
      if (!b || room.live.itemId !== b.id || room.live.open) throw new Error('Close the poll first.');
      b.shown = true; // with no votes there is nothing to place, but the stage can still show the result
      b.revealAt = Date.now();
      room.seqN = (room.seqN || 0) + 1; b.seq = room.seqN;
      return;
    }
    case 'place': {
      const b = room.items.find(x => x.id === a.id);
      if (!b) throw new Error('No such item');
      if (room.live.open && room.live.itemId === b.id) throw new Error('Close the poll before moving this item.');
      if (a.tier !== null && !tierIds(room).includes(a.tier)) throw new Error('Unknown tier');
      placeItem(room, b, a.tier, a.index);
      return;
    }
    case 'rename': room.name = cleanRich(a.name, 60); return;
    case 'cfg': {
      if (a.hostScore !== undefined) room.cfg.hostScore = !!a.hostScore;
      if (a.hostPlay !== undefined) room.cfg.hostPlay = !!a.hostPlay;
      if (a.tie !== undefined) { if (!TIE_METHODS.includes(a.tie)) throw new Error('Unknown tie-breaking method.'); room.cfg.tie = a.tie; }
      if (a.tieFallback !== undefined) room.cfg.tieFallback = a.tieFallback === 'slots' ? 'slots' : 'average';
      if (a.hostVotes !== undefined) room.cfg.hostVotes = !!a.hostVotes;
      if (a.hideNext !== undefined) room.cfg.hideNext = !!a.hideNext;
      if (a.shuffle !== undefined) room.cfg.shuffle = !!a.shuffle;
      if (a.shuffle !== undefined || a.hideNext !== undefined) room.peek = null;
      if (a.desc !== undefined) room.cfg.desc = cleanRich(a.desc, 760, true);
      if (a.pollTimer !== undefined) { const n = Math.floor(Number(a.pollTimer)); if (!(n === 0 || (n >= 5 && n <= 3600))) throw new Error('The poll timer must be off or 5 to 3600 seconds.'); room.cfg.pollTimer = n; }
      if (a.timer !== undefined) { const n = Math.floor(Number(a.timer)); if (!(n >= 5 && n <= 600)) throw new Error('The timer must be between 5 and 600 seconds.'); room.cfg.timer = n; }
      return;
    }
    case 'hostname': { const hn = playerName(room, a.name); if (nameTaken(room, hn, HOST)) throw new Error(TAKEN_MSG); room.hostName = hn; return; }
    case 'kick': {
      const cid = Object.keys(room.players).find(c => pidOf(c) === a.pid);
      if (cid) delete room.players[cid];
      return;
    }
    case 'tstart': {
      const b = room.items.find(x => x.id === a.id);
      if (!b) throw new Error('No such item');
      if (room.live.open) throw new Error('Close the open poll before starting trivia.');
      const qs = readyQs(b);
      if (!qs.length) throw new Error('This item has no trivia questions.');
      if (room.trivia && tphase(room) !== 'revealed') throw new Error('A trivia question is already running.');
      const done = doneSet(room, b), q = qs.find(x => !done[x.id]);
      if (!q) throw new Error('All of this item\u2019s trivia questions are done.');
      if (room.answers[b.id]) delete room.answers[b.id][q.id];
      const now = Date.now();
      room.trivia = { itemId: b.id, qid: q.id, pending: true, startAt: 0, endAt: 0, revealed: false, hostPlay: !!room.cfg.hostPlay, pres: {}, held: {}, wait: {} };
      maybeStartTrivia(room); // held while someone is still on the name screen
      return;
    }
    case 'tgo': { if (room.trivia && room.trivia.pending) activateTrivia(room); return; }
    case 'tend': { if (tphase(room) === 'question') room.trivia.endAt = Date.now(); return; }
    case 'treveal': {
      if (tphase(room) !== 'results') throw new Error('Wait for the timer to finish.');
      const t = room.trivia;
      t.revealed = true;
      if (t.tie) return; // tie-breaking questions never count toward the trivia record or points
      (room.tdone[t.itemId] || (room.tdone[t.itemId] = {}))[t.qid] = true;
      ((room.tpres || (room.tpres = {}))[t.itemId] || (room.tpres[t.itemId] = {}))[t.qid] = Object.assign({}, t.pres || {});
      return;
    }
    case 'tdismiss': room.trivia = null; return;
    case 'tmore': { if (room.trivia && tphase(room) === 'revealed') room.trivia.more = true; return; }
    case 'tiebreak': {
      const b = room.items.find(x => x.id === a.id), t = b && b.tie;
      tieSettle(room, b);
      if (!t || t.phase !== 'wait' || t.method === 'showdown') throw new Error('There is no tie to break.');
      startTieRun(room, b, t.method, !!t.sfb);
      return;
    }
    case 'tshowdown': {
      const b = room.items.find(x => x.id === a.id), t = b && b.tie;
      if (!t || (t.phase !== 'wait' && t.phase !== 'show')) throw new Error('There is no tie to break.');
      if (room.trivia && tphase(room) !== 'revealed') throw new Error('A question is already running.');
      room.trivia = null;
      const q = availTie(room)[Math.floor(Math.random() * availTie(room).length)];
      if (!q) { startTieRun(room, b, room.cfg.tieFallback === 'slots' ? 'slots' : 'average', true); return; }
      (t.used || (t.used = [])).push(q.id); (room.tieSpent || (room.tieSpent = [])).push(q.id); t.phase = 'show'; delete t.by; delete t.ms;
      if (room.answers[b.id]) delete room.answers[b.id][q.id];
      room.trivia = { itemId: b.id, qid: q.id, tie: true, pending: true, startAt: 0, endAt: 0, revealed: false, hostPlay: false, pres: {}, held: {}, wait: {} };
      maybeStartTrivia(room);
      return;
    }
    case 'tshowdone': {
      const tr = room.trivia;
      if (!tr || !tr.tie || !tr.win || tphase(room) !== 'revealed') throw new Error('There is no winner yet.');
      const b = room.items.find(x => x.id === tr.itemId);
      const tier = b && (room.votes[b.id] || {})[tr.win.cid];
      room.trivia = null;
      if (b && b.tie && tier) { b.tie.how = 'showdown'; finishTie(room, b, tier); }
      return;
    }
    case 'tpool': {
      const old = {}; (room.tiePool || []).forEach(x => { old[x.id] = JSON.stringify([x.q, x.opts, x.correct, x.expl]); });
      const again = Array.isArray(a.reinclude) ? a.reinclude : [];
      room.tiePool = cleanRc({ kind: 'trivia', qs: Array.isArray(a.qs) ? a.qs : [] }).qs;
      const keep = new Set();
      room.tiePool.forEach(x => { if (!(room.tieSpent || []).includes(x.id)) return; if (old[x.id] !== JSON.stringify([x.q, x.opts, x.correct, x.expl]) && again.includes(x.id)) return; keep.add(x.id); });
      room.tieSpent = (room.tieSpent || []).filter(id => keep.has(id));
      if (a.fallback !== undefined) room.cfg.tieFallback = a.fallback === 'slots' ? 'slots' : 'average';
      return;
    }
    case 'treset': clearTrivia(room, a.id); return;
    case 'hvote': {
      if (!room.cfg.hostVotes) throw new Error('Host voting is off.');
      if (!room.live.open || room.live.itemId !== a.id) throw new Error('That poll is closed.');
      if (!tierIds(room).includes(a.tier)) throw new Error('Unknown tier');
      (room.votes[a.id] || (room.votes[a.id] = {}))[HOST] = a.tier;
      return;
    }
    case 'hanswer': {
      const ph = tphase(room);
      if (ph !== 'question' && ph !== 'results') throw new Error('Trivia is not taking answers.');
      const t = room.trivia, b = room.items.find(x => x.id === t.itemId), q = b && readyQs(b).find(x => x.id === t.qid);
      if (!t.hostPlay) throw new Error('Play Along Trivia is off.');
      if (!q || !Number.isInteger(a.pick) || a.pick < 0 || a.pick >= q.opts.length) throw new Error('Bad answer');
      const byQ = room.answers[b.id] || (room.answers[b.id] = {});
      const mm = byQ[q.id] || (byQ[q.id] = {});
      if (mm[HOST] && mm[HOST].locked) throw new Error('Your answer is locked in.');
      mm[HOST] = { pick: a.pick, at: Date.now(), locked: !!a.lock };
      if (a.lock) checkAllLocked(room);
      return;
    }
    case 'tiers': {
      const list = Array.isArray(a.tiers) ? a.tiers.slice(0, MAX_TIERS).filter(t => t && typeof t === 'object') : [];
      if (!list.length) throw new Error('Keep at least one tier.');
      const old = new Set(tierIds(room)), used = new Set(), next = [];
      list.forEach((t, i) => {
        let id = typeof t.id === 'string' && old.has(t.id) && !used.has(t.id) ? t.id : null;
        if (!id) do { id = 't' + crypto.randomBytes(4).toString('hex'); } while (used.has(id) || old.has(id));
        used.add(id);
        const label = cleanRich(t.label, 24);
        next.push({ id, label: plainOf(label) ? label : escText('Tier ' + (i + 1)), color: hexColor(t.color) });
      });
      const keep = new Set(next.map(t => t.id));
      room.items.forEach(b => { if (b.final && !keep.has(b.final)) { clearPlacement(room, b); if (room.live.itemId === b.id) room.live = { itemId: null, open: false }; } });
      room.items.forEach(b => {
        if (!b.tie || b.tie.phase === 'done') return;
        b.tie.tiers = b.tie.tiers.filter(x => keep.has(x));
        if (b.tie.tiers.length < 2) { clearPlacement(room, b); if (room.live.itemId === b.id) room.live = { itemId: null, open: false }; }
      });
      room.cfg.tiers = next;
      room.items.forEach(b => { if (b.counts) { const c = {}; next.forEach(t => { c[t.id] = b.counts[t.id] || 0; }); b.counts = c; } });
      return;
    }
    case 'edit': {
      const b = room.items.find(x => x.id === a.id);
      if (!b) throw new Error('No such item');
      let name = b.name;
      if (a.name !== undefined) name = cleanRich(a.name, 120);
      let img = b.img, imgChanged = false;
      if (a.image !== undefined && a.image !== null) {
        if (typeof a.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(a.image) || a.image.length > MAX_IMG) throw new Error('That image could not be used.');
        img = a.image; imgChanged = true;
      } else if (a.removeImage) { img = undefined; imgChanged = true; }
      if (!plainOf(name) && !img) throw new Error('Give the item a name or a photo.');
      b.name = name;
      if (imgChanged) { if (img) b.img = img; else delete b.img; b.imgV = (b.imgV || 0) + 1; }
      if (a.rc !== undefined) { b.rc = cleanRc(a.rc); pruneAnswers(room, b); }
      return;
    }
    case 'remove': {
      const gone = room.items.find(x => x.id === a.id);
      room.items = room.items.filter(x => x.id !== a.id);
      if (gone && gone.final) renumber(room, gone.final);
      delete room.votes[a.id]; clearTrivia(room, a.id);
      if (room.live.itemId === a.id) room.live = { itemId: null, open: false };
      return;
    }
    case 'import': { applyImport(room, parseImport(a.file)); return; }
    default: throw new Error('Unknown action');
  }
}

/* ---------- save and open files ---------- */
function exportFile(room, kind) {
  const full = kind === 'progress';
  const items = room.items.map(b => {
    const o = { id: b.id, name: b.name || '', rc: b.rc || emptyRc() };
    if (b.img) o.img = b.img;
    if (full) { o.final = b.final || null; o.counts = b.counts || null; o.votes = b.votes || 0; o.rank = b.rank || 0; o.shown = !!b.shown; o.manual = !!b.manual; if (b.auto) o.auto = b.auto; }
    return o;
  });
  return { app: 'impollster', v: 1, kind, savedAt: new Date().toISOString(), cfg: { name: room.name || '', reveal: !!room.cfg.reveal, tiers: room.cfg.tiers, tiePool: room.tiePool || [], tieSpent: room.tieSpent || [] }, items };
}
// Opens an Impollster file, or a Tier Ranker list file (its markup text is converted).
function parseImport(f) {
  const bad = 'That is not an Impollster or Tier Ranker file.';
  if (!f || typeof f !== 'object' || !Array.isArray(f.items) || !f.cfg || !Array.isArray(f.cfg.tiers)) throw new Error(bad);
  const ranker = f.app === 'tier-ranker', poll = f.app === 'tier-poll' || f.app === 'impollster';
  if (!ranker && !poll) throw new Error(bad);
  if (f.kind !== 'template' && f.kind !== 'progress') throw new Error(bad);
  const full = f.kind === 'progress';
  const conv = s => ranker ? (f.v >= 3 ? markupToHtml(s) : escText(String(s == null ? '' : s))) : String(s == null ? '' : s);
  const one = (s, max) => cleanRich(conv(s), max), many = (s, max) => cleanRich(conv(s), max, true);
  const safeId = (v, fb) => (String(v == null ? '' : v).replace(/[^\w-]/g, '').slice(0, 20)) || fb;
  const tiers = [], tierMap = {}, used = new Set();
  f.cfg.tiers.slice(0, MAX_TIERS).forEach((t, i) => {
    if (!t || typeof t !== 'object') return;
    let id = safeId(t.id, 't' + i); while (used.has(id)) id += 'x'; used.add(id);
    tierMap[String(t.id)] = id;
    const label = one(t.label, 24);
    tiers.push({ id, label: plainOf(label) ? label : escText('Tier ' + (tiers.length + 1)), color: hexColor(t.color) });
  });
  if (!tiers.length) throw new Error('This file has no tiers.');
  const items = [], idMap = {};
  f.items.slice(0, MAX_ITEMS).forEach((o, i) => {
    if (!o || typeof o !== 'object') return;
    let img = null, name = '';
    if (ranker) {
      if (o.type === 'img' && typeof o.src === 'string' && o.src.length <= MAX_IMG && IMG_RE.test(o.src)) img = o.src;
      name = o.text ? one(o.text, 120) : '';
    } else {
      if (typeof o.img === 'string' && o.img.length <= MAX_IMG && IMG_RE.test(o.img)) img = o.img;
      name = one(o.name, 120);
    }
    if (!plainOf(name) && !img) return;
    const r = o.rc && typeof o.rc === 'object' ? o.rc : {};
    const rc = cleanRc({
      kind: r.kind, title: one(r.title, 80), text: many(r.text, 2000),
      pages: (Array.isArray(r.pages) ? r.pages : []).slice(0, MAXP).map(p => many(p, 2000)),
      qs: (Array.isArray(r.qs) ? r.qs : []).slice(0, MAXQ).filter(x => x && typeof x === 'object').map(x => ({
        id: poll ? x.id : undefined, q: one(x.q, 500), opts: (Array.isArray(x.opts) ? x.opts : []).slice(0, 6).map(t => one(t, 200)), correct: x.correct, expl: many(x.expl, 2000)
      }))
    });
    items.push({ oldId: String(o.id), name, img, rc, src: o });
  });
  if (!items.length) throw new Error('This file has no items.');
  const tiePool = poll && Array.isArray(f.cfg.tiePool) ? cleanRc({ kind: 'trivia', qs: f.cfg.tiePool.slice(0, MAXQ).filter(x => x && typeof x === 'object').map(x => ({ id: x.id, q: one(x.q, 500), opts: (Array.isArray(x.opts) ? x.opts : []).slice(0, 6).map(t => one(t, 200)), correct: x.correct, expl: many(x.expl, 2000) })) }).qs : [];
  const tieSpent = poll && Array.isArray(f.cfg.tieSpent) ? f.cfg.tieSpent.filter(x => typeof x === 'string').slice(0, 60) : [];
  return { tiePool, tieSpent, name: one(f.cfg.title !== undefined ? f.cfg.title : f.cfg.name, 60), reveal: !!f.cfg.reveal, tiers, tierMap, items, full, ranker, file: f };
}
function applyImport(room, p) {
  room.cfg = Object.assign({}, room.cfg, { reveal: p.reveal, tiers: p.tiers }); room.trivia = null; room.tdone = {}; room.tpres = {}; room.tiePool = p.tiePool || []; room.tieSpent = p.tieSpent || [];
  if (plainOf(p.name)) room.name = p.name;
  const idMap = {};
  room.items = p.items.map((it, i) => {
    const b = { id: newId(), name: it.name, order: i + 1, final: null, rc: it.rc };
    if (it.img) { b.img = it.img; b.imgV = 1; }
    idMap[it.oldId] = b;
    return b;
  });
  room.votes = {}; room.answers = {}; room.live = { itemId: null, open: false }; room.peek = null; room.rankSeq = 0;
  if (!p.full) return;
  const ids = p.tiers.map(t => t.id), zero = () => { const c = {}; ids.forEach(t => { c[t] = 0; }); return c; };
  if (p.ranker) {
    // Tier Ranker progress: the rankings were placed by hand, so they open as manual placements.
    const ft = p.file.tiers && typeof p.file.tiers === 'object' ? p.file.tiers : {};
    Object.keys(p.tierMap).forEach(orig => {
      (Array.isArray(ft[orig]) ? ft[orig] : []).forEach(oid => {
        const b = idMap[String(oid)];
        if (!b || b.final) return;
        b.final = p.tierMap[orig]; b.rank = ++room.rankSeq; b.shown = true; b.manual = true; b.auto = b.final; b.counts = zero(); b.votes = 0;
      });
    });
  } else {
    p.items.forEach(it => {
      const b = idMap[it.oldId], o = it.src, t = p.tierMap[String(o.final)];
      if (!b || !t) return;
      b.final = t; b.rank = Number.isInteger(o.rank) ? o.rank : ++room.rankSeq; b.shown = o.shown !== false; b.manual = !!o.manual; b.auto = p.tierMap[String(o.auto)] || b.final;
      const c = zero(); Object.keys(o.counts && typeof o.counts === 'object' ? o.counts : {}).forEach(k => { const nt = p.tierMap[k]; if (nt) c[nt] = Math.max(0, Math.floor(Number(o.counts[k]) || 0)); });
      b.counts = c; b.votes = Math.max(0, Math.floor(Number(o.votes) || 0));
      room.rankSeq = Math.max(room.rankSeq, b.rank);
    });
  }
  ids.forEach(t => renumber(room, t));
}
function answersCsv(room) {
  const esc = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const who = cid => cid === HOST ? room.hostName + ' (host)' : (room.players[cid] || 'Unnamed guest');
  const rows = [['Item', 'Question', 'Player', 'Picked', 'Correct answer', 'Result', 'Revealed'].map(esc).join(',')];
  room.items.forEach(b => {
    const done = doneSet(room, b);
    readyQs(b).forEach((q, qi) => {
      const m = answersFor(room, b, q);
      Object.keys(m).forEach(cid => {
        const p = m[cid].pick;
        rows.push([plainOf(b.name) || 'Picture', 'Q' + (qi + 1) + ': ' + plainOf(q.q), who(cid), String.fromCharCode(65 + p) + ': ' + plainOf(q.opts[p]),
          String.fromCharCode(65 + q.correct) + ': ' + plainOf(q.opts[q.correct]), p === q.correct ? 'Correct' : 'Incorrect', done[q.id] ? 'Yes' : 'No'].map(esc).join(','));
      });
    });
  });
  return rows.join('\r\n') + '\r\n';
}

/* ---------- routing ---------- */
const PUB = name => path.join(__dirname, 'public', name);
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  const page = (file, ref) => {
    const h = { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' };
    if (ref) h['Referrer-Policy'] = 'no-referrer';
    res.writeHead(200, h);
    return fs.createReadStream(PUB(file)).pipe(res);
  };
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) return page('index.html');
    const ASSET = { '/common.js': 'application/javascript', '/common.css': 'text/css', '/host.js': 'application/javascript', '/play.js': 'application/javascript' };
    if (req.method === 'GET' && ASSET[url.pathname]) {
      res.writeHead(200, { 'Content-Type': ASSET[url.pathname] + '; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(PUB(url.pathname.slice(1))).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/host') return page('host.html', true);
    if (req.method === 'GET' && url.pathname === '/play') return page('play.html', true);
    if (parts[0] !== 'api') { res.writeHead(404); return res.end('Not found'); }

    if (req.method === 'POST' && parts[1] === 'rooms' && parts.length === 2) {
      if (Object.keys(rooms).length > 5000) return json(res, 503, { error: 'Server is full' });
      const hostCode = makeCode(6, rooms), joinCode = makeCode(4, byJoin);
      let name = '';
      try { name = cleanRich((await readBody(req, 6000)).name, 60); } catch (e) { name = ''; }
      const room = { v: 5, players: {}, tdone: {}, hostName: 'Host', hostCode, joinCode, name, created: Date.now(), touched: Date.now(), cfg: defaultCfg(), items: [], live: { itemId: null, open: false }, votes: {}, answers: {}, rankSeq: 0 };
      rooms[hostCode] = room; byJoin[joinCode] = room; save();
      return json(res, 200, { hostCode, joinCode });
    }

    if (parts[1] === 'host' && parts[2]) {
      if (blocked(req)) return json(res, 429, { error: 'Too many tries. Wait a few minutes.' });
      const room = rooms[norm(parts[2])];
      if (!room) { noteFail(req); return json(res, 404, { error: 'No room with that host code.' }); }
      const sub = parts[3];
      if (req.method === 'GET' && sub === 'check') return json(res, 200, { ok: true, joinCode: room.joinCode });
      if (req.method === 'GET' && sub === 'events') {
        openStream(req, res);
        const c = connsFor(room);
        c.hosts.add(res);
        send(res, hostView(room));
        req.on('close', () => c.hosts.delete(res));
        return;
      }
      if (req.method === 'GET' && sub === 'item' && parts[4]) { // full text/trivia of one item, for the editor and the bubble viewer
        const b = room.items.find(x => x.id === parts[4]);
        if (!b) return json(res, 404, { error: 'No such item' });
        return json(res, 200, { rc: b.rc || emptyRc(), tstats: (b.rc && b.rc.kind === 'trivia') ? qstats(room, b) : [] });
      }
      if (req.method === 'GET' && sub === 'stats' && parts[4]) { // who voted and answered what, for the Stats popup
        const b = room.items.find(x => x.id === parts[4]);
        if (!b) return json(res, 404, { error: 'No such item' });
        const who = c => c === HOST ? room.hostName : (room.players[c] || 'A guest'), ids = tierIds(room), vv = room.votes[b.id] || {};
        const voters = Object.keys(vv).filter(c => ids.includes(vv[c])).map(c => ({ name: who(c), tier: vv[c], host: c === HOST }))
          .sort((x, y) => ids.indexOf(x.tier) - ids.indexOf(y.tier) || x.name.localeCompare(y.name));
        const poll = { votes: b.votes || 0, counts: b.counts || null, voters, final: b.final || null, over: isOver(b), auto: b.auto || null, tie: tieView(room, b), shown: !!b.shown };
        const done = doneSet(room, b), st = qstats(room, b);
        const trivia = readyQs(b).map((q, i) => {
          const m = answersFor(room, b, q), answers = Object.keys(m).filter(c => m[c].pick in q.opts).map(c => ({ name: who(c), pick: m[c].pick, host: c === HOST }));
          return { n: i + 1, q: q.q, opts: q.opts, correct: q.correct, revealed: !!done[q.id], dist: st[i].picks, total: st[i].n, hostPick: m[HOST] ? m[HOST].pick : null, answers, has: !!done[q.id] || answers.length > 0 };
        });
        return json(res, 200, { poll, trivia });
      }
      if (req.method === 'GET' && sub === 'export') {
        const kind = url.searchParams.get('kind') === 'progress' ? 'progress' : 'template';
        const body = JSON.stringify(exportFile(room, kind));
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': 'attachment; filename="impollster-' + kind + '.json"', 'Cache-Control': 'no-store' });
        return res.end(body);
      }
      if (req.method === 'GET' && sub === 'answers.csv') {
        res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="impollster-trivia-answers.csv"', 'Cache-Control': 'no-store' });
        return res.end('﻿' + answersCsv(room));
      }
      if (req.method === 'GET' && sub === 'results.pdf') {
        const live = room.live;
        const items = room.items.map(b => {
          let status = 'pending';
          if (live.open && live.itemId === b.id) status = 'open';
          else if (b.tie && !b.final) status = 'pending';
          else if (b.counts) status = b.final ? 'ranked' : 'novotes';
          return { name: plainOf(b.name) || 'Picture', status, final: b.final || null, counts: b.counts || null, votes: b.votes || 0 };
        });
        const tiers = room.cfg.tiers.map(t => ({ id: t.id, label: plainOf(t.label), color: t.color }));
        const pdf = buildResultsPdf({ title: plainOf(room.name), date: String(url.searchParams.get('date') || '').slice(0, 60), items, tiers });
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="impollster-results.pdf"', 'Cache-Control': 'no-store', 'Content-Length': pdf.length });
        return res.end(pdf);
      }
      if (req.method === 'POST' && sub === 'action') {
        const body = await readBody(req, 40 * 1024 * 1024);
        try { hostAction(room, body); } catch (e) { return json(res, 400, { error: e.message }); }
        touch(room); pushAll(room);
        return json(res, 200, { ok: true });
      }
    }

    if (parts[1] === 'join' && parts[2]) {
      if (blocked(req)) return json(res, 429, { error: 'Too many tries. Wait a few minutes.' });
      const room = byJoin[norm(parts[2])];
      if (!room) { noteFail(req); return json(res, 404, { error: 'No room with that code.' }); }
      const sub = parts[3];
      if (req.method === 'GET' && sub === 'check') return json(res, 200, { ok: true });
      if (req.method === 'GET' && sub === 'events') {
        const cid = String(url.searchParams.get('cid') || '').slice(0, 64);
        openStream(req, res);
        const c = connsFor(room);
        const g = { res, cid };
        c.guests.add(g);
        holdArrival(room, cid); // a guest arriving mid-question waits on a hold screen
        send(res, guestView(room, cid));
        if (room.trivia) pushHosts(room);
        req.on('close', () => {
          c.guests.delete(g);
          if (room.trivia) { maybeStartTrivia(room); checkAllLocked(room); pushAll(room); }
        });
        return;
      }
      if (req.method === 'GET' && sub === 'img' && parts[4]) {
        const b = room.items.find(x => x.id === parts[4]);
        if (!b || !b.img) { res.writeHead(404); return res.end(); }
        return sendImage(res, b);
      }
      if (req.method === 'GET' && sub === 'info' && parts[4]) { // text or trivia for an item the guest already voted on
        const cid = String(url.searchParams.get('cid') || '');
        const b = room.items.find(x => x.id === parts[4]);
        const gi = b && /^[A-Za-z0-9-]{8,64}$/.test(cid) ? guestInfo(room, b, cid) : null;
        if (!gi) return json(res, 404, { error: 'Nothing to show for that item.' });
        return json(res, 200, gi);
      }
      if (req.method === 'GET' && sub === 'review' && parts[4]) { // one guest's trivia results on an item, revealed questions only
        const cid = String(url.searchParams.get('cid') || '');
        const b = room.items.find(x => x.id === parts[4]);
        if (!b || !b.shown || !/^[A-Za-z0-9-]{8,64}$/.test(cid)) return json(res, 404, { error: 'Nothing to show for that item.' });
        const done = doneSet(room, b), pres = (room.tpres && room.tpres[b.id]) || {}, out = [];
        readyQs(b).forEach((q, i) => {
          if (!done[q.id]) return;
          const a = answersFor(room, b, q)[cid];
          if (!a && !(pres[q.id] || {})[cid]) { out.push({ n: i + 1, state: 'miss' }); return; }
          out.push({ n: i + 1, state: a ? (a.pick === q.correct ? 'right' : 'wrong') : 'none', q: q.q, opts: q.opts, correct: q.correct, pick: a ? a.pick : null, expl: q.expl });
        });
        return json(res, 200, { name: b.name, qs: out });
      }
      if (req.method === 'POST' && sub === 'vote') {
        const body = await readBody(req, 4096);
        const cid = String(body.cid || '');
        if (!/^[A-Za-z0-9-]{8,64}$/.test(cid) || typeof body.tier !== 'string' || !tierIds(room).includes(body.tier)) return json(res, 400, { error: 'Bad vote' });
        if (!room.live.open || room.live.itemId !== body.itemId) return json(res, 409, { error: 'That poll is closed.' });
        const v = room.votes[body.itemId] || (room.votes[body.itemId] = {});
        if (!v[cid] && Object.keys(v).length >= 20000) return json(res, 429, { error: 'Poll is full' });
        v[cid] = body.tier;
        touch(room); pushHosts(room); pushGuestsWithCid(room, cid);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && sub === 'name') {
        const body = await readBody(req, 2048);
        const cid = String(body.cid || '');
        if (!/^[A-Za-z0-9-]{8,64}$/.test(cid)) return json(res, 400, { error: 'Bad request' });
        let n;
        try { n = playerName(room, body.name); } catch (e) { return json(res, 400, { error: e.message }); }
        if (!room.players[cid] && Object.keys(room.players).length >= 20000) return json(res, 429, { error: 'Room is full' });
        if (nameTaken(room, n, cid)) return json(res, 409, { error: TAKEN_MSG });
        const final = n;
        const isNew = !room.players[cid];
        room.players[cid] = final;
        if (isNew) holdArrival(room, cid); // naming in during a question lands on the hold screen
        const started = maybeStartTrivia(room);
        touch(room); pushHosts(room); pushGuestsWithCid(room, cid);
        if (started) pushGuests(room);
        return json(res, 200, { ok: true, name: final });
      }
      if (req.method === 'POST' && sub === 'answer') {
        const body = await readBody(req, 4096);
        const cid = String(body.cid || '');
        if (!/^[A-Za-z0-9-]{8,64}$/.test(cid)) return json(res, 400, { error: 'Bad answer' });
        if (!room.players[cid]) return json(res, 403, { error: 'Pick a name first.' });
        const t = room.trivia;
        if (!t || tphase(room) !== 'question' || t.itemId !== body.itemId || t.qid !== body.qid) return json(res, 409, { error: 'That question is closed.' });
        const { b, q } = tqOf(room, t);
        if (!q) return json(res, 404, { error: 'No such question.' });
        if ((t.held || {})[cid]) return json(res, 409, { error: 'Press Proceed to join this question first.' });
        if (!Number.isInteger(body.pick) || body.pick < 0 || body.pick >= q.opts.length) return json(res, 400, { error: 'Bad answer' });
        const byQ = room.answers[b.id] || (room.answers[b.id] = {});
        const m = byQ[q.id] || (byQ[q.id] = {});
        if (!m[cid] && Object.keys(m).length >= 20000) return json(res, 429, { error: 'Question is full' });
        if (m[cid] && m[cid].locked) return json(res, 409, { error: 'Your answer is locked in.' });
        const lock = !!body.lock || !!t.tie; // showdown answers lock the moment they are tapped
        m[cid] = { pick: body.pick, at: Date.now(), locked: lock };
        if (t.tie && !t.win && tieElig(room, b, cid) && body.pick === q.correct) {
          t.win = { cid, at: m[cid].at, ms: Math.max(0, m[cid].at - t.startAt) };
          t.endAt = Date.now() - 1; t.revealed = true;
          b.tie.by = cid; b.tie.ms = t.win.ms; b.tie.how = 'showdown';
        }
        if (lock) checkAllLocked(room);
        touch(room); pushHosts(room); if (tphase(room) !== 'question') pushGuests(room); else pushGuestsWithCid(room, cid);
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && (sub === 'proceed' || sub === 'wait')) {
        const body = await readBody(req, 2048);
        const cid = String(body.cid || '');
        if (!/^[A-Za-z0-9-]{8,64}$/.test(cid) || !room.players[cid]) return json(res, 400, { error: 'Bad request' });
        const t = room.trivia, ph = tphase(room);
        if (t && (t.held || {})[cid]) {
          if (sub === 'wait') { (t.wait || (t.wait = {}))[cid] = true; delete (t.pres || {})[cid]; }
          else if (ph === 'countdown' || ph === 'question') { delete t.held[cid]; (t.pres || (t.pres = {}))[cid] = true; if (t.wait) delete t.wait[cid]; }
          else return json(res, 409, { error: 'That question has ended.' });
        }
        touch(room); pushHosts(room); pushGuestsWithCid(room, cid);
        return json(res, 200, { ok: true });
      }
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    if (e && e.status) { if (!res.headersSent) json(res, e.status, { error: e.message }); return; }
    console.error(e && e.stack);
    if (!res.headersSent) json(res, 500, { error: 'Server error' });
  }
});
Object.values(rooms).forEach(schedulePoll);
Object.values(rooms).forEach(r => r.items.forEach(b => { if (b.tie && b.tie.phase === 'run') scheduleTie(r, b); }));
Object.values(rooms).forEach(r => { if (r.trivia && r.trivia.pending) activateTrivia(r); });
server.listen(PORT, () => console.log('Impollster listening on ' + PORT));
