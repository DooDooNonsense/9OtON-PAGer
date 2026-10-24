'use strict';
// Tier Poll: zero-dependency Node server. Rooms are keyed by a 6-character host code
// and a 4-character join code. Realtime updates go out over Server-Sent Events.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildResultsPdf } = require('./pdf');

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const ROOM_TTL_MS = 60 * 24 * 3600 * 1000; // rooms idle this long are deleted
const TIERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

/* ---------- styled text (room and item names) ---------- */
// Names are stored as a small, safe subset of HTML: b, i, u, s, sup, sub and http(s)/mailto links.
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&#39;': "'", '&nbsp;': ' ' };
const TAGMAP = { b: 'b', strong: 'b', i: 'i', em: 'i', u: 'u', s: 's', strike: 's', del: 's', sup: 'sup', sub: 'sub', a: 'a' };
function escText(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function unescText(s) { return String(s).replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, m => ENT[m]); }
function plainOf(html) { return unescText(String(html || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(); }
function cleanRich(input, maxPlain) {
  const src = String(input == null ? '' : input).slice(0, maxPlain * 10 + 400);
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>|([^<]+)|(<)/g;
  const stack = [];
  let out = '', plain = 0, m;
  while ((m = re.exec(src))) {
    if (m[4] !== undefined || m[5] !== undefined) {
      let t = m[4] !== undefined ? unescText(m[4]) : '<';
      t = t.replace(/[\r\n\t]+/g, ' ');
      if (plain + t.length > maxPlain) t = t.slice(0, Math.max(0, maxPlain - plain));
      plain += t.length;
      out += escText(t);
      continue;
    }
    const closing = m[1] === '/', name = m[2].toLowerCase();
    if (name === 'br') { if (!closing && plain < maxPlain) { out += ' '; plain++; } continue; }
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
  return out.trim();
}

/* ---------- storage ---------- */
let rooms = {}; // hostCode -> room
const byJoin = {}; // joinCode -> room
const byToken = {}; // display token -> room
try { rooms = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { rooms = {}; }
Object.values(rooms).forEach(r => {
  // Upgrade rooms saved by earlier versions of this app.
  if (r.bugs && !r.items) { r.items = r.bugs; delete r.bugs; }
  if (r.live && r.live.bugId !== undefined) r.live = { itemId: r.live.bugId, open: r.live.open };
  if (typeof r.name !== 'string') r.name = '';
  if (!r.v) { // names were plain text before styled names existed
    r.name = escText(r.name);
    (r.items || []).forEach(b => { b.name = escText(String(b.name || '')); });
    r.v = 2;
  }
  byJoin[r.joinCode] = r;
  if (r.display && r.display.on && r.display.token) byToken[r.display.token] = r;
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

/* ---------- realtime ---------- */
const conns = new Map(); // hostCode -> {hosts:Set<res>, guests:Set<{res,cid}>}
function connsFor(room) {
  let c = conns.get(room.hostCode);
  if (!c) { c = { hosts: new Set(), guests: new Set(), displays: new Set() }; conns.set(room.hostCode, c); }
  return c;
}
function tally(room, itemId) {
  const c = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0, F: 0 };
  let n = 0;
  const v = room.votes[itemId] || {};
  for (const cid in v) if (TIERS.includes(v[cid])) { c[v[cid]]++; n++; }
  return { c, n };
}
function finalTier(c, n) {
  if (!n) return null;
  let mean = 0;
  TIERS.forEach((t, i) => { mean += i * c[t]; });
  mean /= n;
  const max = Math.max(...TIERS.map(t => c[t]));
  let best = null, bd = 1e9;
  TIERS.forEach((t, i) => { if (c[t] === max) { const d = Math.abs(i - mean); if (d < bd) { bd = d; best = t; } } });
  return best;
}
function itemView(b, withResults) {
  const v = { id: b.id, name: b.name, img: b.img ? (b.imgV || 1) : 0 };
  if (withResults) { v.final = b.final || null; v.counts = b.counts || null; v.votes = b.votes || 0; }
  return v;
}
function hostView(room) {
  return {
    joinCode: room.joinCode,
    name: room.name || '',
    showResults: room.showResults !== false,
    display: room.display && room.display.on ? { on: true, mode: room.display.mode, token: room.display.token, unblinded: room.display.unblinded || null } : { on: false, mode: (room.display && room.display.mode) || 'blind' },
    live: room.live,
    items: room.items.map(b => itemView(b, true)),
    tally: room.live.itemId ? tally(room, room.live.itemId) : null
  };
}
// Guests only receive the item that is currently open plus the items they have voted on,
// and only receive results when the host has them turned on.
function guestView(room, cid) {
  const mine = {};
  for (const id in room.votes) if (room.votes[id][cid]) mine[id] = room.votes[id][cid];
  const show = room.showResults !== false;
  return {
    joinCode: room.joinCode,
    name: room.name || '',
    showResults: show,
    live: room.live,
    items: room.items.filter(b => b.id === room.live.itemId || mine[b.id]).map(b => itemView(b, show)),
    mine
  };
}
// What the on-screen display link may see. Blind mode never includes counts until the host unblinds.
function displayView(room) {
  const d = room.display, live = room.live;
  const b = live.itemId ? room.items.find(x => x.id === live.itemId) : null;
  const v = { name: room.name || '', mode: d.mode, state: 'idle', item: null };
  if (!b) return v;
  v.item = { id: b.id, name: b.name, img: b.img ? (b.imgV || 1) : 0 };
  v.state = live.open ? 'open' : 'closed';
  const reveal = d.mode === 'open' || (!live.open && d.unblinded === b.id);
  if (reveal) {
    if (live.open) { const t = tally(room, b.id); v.counts = t.c; v.votes = t.n; }
    else { v.counts = b.counts || null; v.votes = b.votes || 0; v.final = b.final || null; }
    v.revealed = true;
  } else v.revealed = false;
  return v;
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
function pushDisplays(room) {
  const c = connsFor(room);
  if (!c.displays.size) return;
  const v = room.display && room.display.on ? displayView(room) : { off: true };
  c.displays.forEach(res => send(res, v));
}
function pushAll(room) { pushHosts(room); pushGuests(room); pushDisplays(room); }
function pushGuestsWithCid(room, cid) {
  connsFor(room).guests.forEach(g => { if (g.cid === cid) send(g.res, guestView(room, cid)); });
}
setInterval(() => {
  conns.forEach(c => {
    c.hosts.forEach(r => r.write(': ping\n\n'));
    c.guests.forEach(g => g.res.write(': ping\n\n'));
    c.displays.forEach(r => r.write(': ping\n\n'));
  });
  const now = Date.now();
  Object.values(rooms).forEach(r => {
    if (now - r.touched > ROOM_TTL_MS && !(conns.get(r.hostCode) && (connsFor(r).hosts.size || connsFor(r).guests.size || connsFor(r).displays.size))) {
      if (r.display && r.display.token) delete byToken[r.display.token]; delete rooms[r.hostCode]; delete byJoin[r.joinCode]; conns.delete(r.hostCode); save();
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
function readBody(req, max) {
  return new Promise((ok, bad) => {
    let n = 0; const c = [];
    req.on('data', d => { n += d.length; if (n > max) { bad(new Error('too big')); req.destroy(); return; } c.push(d); });
    req.on('end', () => { try { ok(JSON.parse(Buffer.concat(c).toString() || '{}')); } catch (e) { bad(e); } });
    req.on('error', bad);
  });
}
const touch = room => { room.touched = Date.now(); save(); };

/* ---------- host actions ---------- */
function closePoll(room) {
  const id = room.live.itemId;
  const b = room.items.find(x => x.id === id);
  if (!b || !room.live.open) return;
  const t = tally(room, id);
  b.final = finalTier(t.c, t.n);
  b.counts = t.c; b.votes = t.n;
  room.live = { itemId: id, open: false };
}
function hostAction(room, a) {
  switch (a.type) {
    case 'add': {
      const seen = new Set(room.items.map(b => plainOf(b.name).toLowerCase()));
      let order = room.items.reduce((m, b) => Math.max(m, b.order || 0), 0);
      const raws = Array.isArray(a.items) ? a.items.slice(0, 300) : (Array.isArray(a.names) ? a.names.map(escText) : []);
      raws.forEach(raw => {
        const html = cleanRich(raw, 120); // styled text from the add box
        const text = plainOf(html).toLowerCase();
        if (!text || seen.has(text) || room.items.length >= 300) return;
        seen.add(text);
        room.items.push({ id: 'b' + crypto.randomBytes(5).toString('hex'), name: html, order: ++order, final: null });
      });
      return;
    }
    case 'open': {
      const b = room.items.find(x => x.id === a.id);
      if (!b) throw new Error('No such item');
      if (room.live.open && room.live.itemId !== b.id) closePoll(room);
      b.final = null; b.counts = null; b.votes = 0;
      delete room.votes[b.id]; // a fresh poll starts from zero
      if (room.display) room.display.unblinded = null;
      room.live = { itemId: b.id, open: true };
      return;
    }
    case 'close': closePoll(room); return;
    case 'reset': {
      const b = room.items.find(x => x.id === a.id);
      if (!b) throw new Error('No such item');
      b.final = null; b.counts = null; b.votes = 0;
      delete room.votes[b.id];
      if (room.display && room.display.unblinded === b.id) room.display.unblinded = null;
      if (room.live.itemId === b.id) room.live = { itemId: null, open: false };
      return;
    }
    case 'display': {
      const d = room.display || (room.display = { on: false, mode: 'blind', token: null, unblinded: null });
      if (a.on) {
        if (!d.on) {
          d.mode = a.mode === 'open' ? 'open' : 'blind';
          d.token = crypto.randomBytes(12).toString('base64url');
          d.unblinded = null; d.on = true;
          byToken[d.token] = room;
        }
      } else if (d.on) {
        delete byToken[d.token];
        d.on = false; d.token = null; d.unblinded = null;
        // viewers of the old link are told it is off
      }
      return;
    }
    case 'unblind': {
      const d = room.display;
      if (!d || !d.on) throw new Error('Turn the results link on first.');
      d.unblinded = a.value === false ? null : (room.live.itemId && !room.live.open ? room.live.itemId : d.unblinded);
      return;
    }
    case 'rename': room.name = cleanRich(a.name, 60); return;
    case 'results': room.showResults = !!a.value; return;
    case 'edit': {
      const b = room.items.find(x => x.id === a.id);
      if (!b) throw new Error('No such item');
      let name = b.name;
      if (a.name !== undefined) {
        name = cleanRich(a.name, 120);
        if (!plainOf(name)) throw new Error('Give the item a name.');
      }
      if (a.image !== undefined && a.image !== null) {
        if (typeof a.image !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(a.image) || a.image.length > 700000) throw new Error('That image could not be used.');
        b.img = a.image; b.imgV = (b.imgV || 0) + 1;
      } else if (a.removeImage) { delete b.img; b.imgV = (b.imgV || 0) + 1; }
      b.name = name;
      return;
    }
    case 'remove': {
      room.items = room.items.filter(x => x.id !== a.id);
      delete room.votes[a.id];
      if (room.display && room.display.unblinded === a.id) room.display.unblinded = null;
      if (room.live.itemId === a.id) room.live = { itemId: null, open: false };
      return;
    }
    default: throw new Error('Unknown action');
  }
}

/* ---------- routing ---------- */
const INDEX = path.join(__dirname, 'public', 'index.html');
const DISPLAY = path.join(__dirname, 'public', 'display.html');
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return fs.createReadStream(INDEX).pipe(res);
    }
    if (req.method === 'GET' && parts[0] === 'display' && parts.length === 2) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', 'Referrer-Policy': 'no-referrer' });
      return fs.createReadStream(DISPLAY).pipe(res);
    }
    if (parts[0] !== 'api') { res.writeHead(404); return res.end('Not found'); }

    if (req.method === 'POST' && parts[1] === 'rooms' && parts.length === 2) {
      if (Object.keys(rooms).length > 5000) return json(res, 503, { error: 'Server is full' });
      const hostCode = makeCode(6, rooms), joinCode = makeCode(4, byJoin);
      let name = '';
      try { name = cleanRich((await readBody(req, 6000)).name, 60); } catch (e) { name = ''; }
      const room = { v: 2, hostCode, joinCode, name, showResults: true, created: Date.now(), touched: Date.now(), items: [], live: { itemId: null, open: false }, votes: {} };
      rooms[hostCode] = room; byJoin[joinCode] = room; save();
      return json(res, 200, { hostCode, joinCode });
    }

    if (parts[1] === 'display' && parts[2]) {
      if (blocked(req)) return json(res, 429, { error: 'Too many tries.' });
      const room = byToken[parts[2]];
      if (!room || !room.display || !room.display.on) { noteFail(req); return json(res, 404, { error: 'This results link is not active.' }); }
      if (req.method === 'GET' && parts[3] === 'events') {
        openStream(req, res);
        const c = connsFor(room);
        c.displays.add(res);
        send(res, displayView(room));
        req.on('close', () => c.displays.delete(res));
        return;
      }
      if (req.method === 'GET' && parts[3] === 'img' && parts[4]) {
        const b = room.items.find(x => x.id === parts[4]);
        if (!b || !b.img || b.id !== room.live.itemId) { res.writeHead(404); return res.end(); }
        const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(b.img);
        res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400' });
        return res.end(Buffer.from(m[2], 'base64'));
      }
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
      if (req.method === 'GET' && sub === 'results.pdf') {
        const live = room.live;
        const items = room.items.map(b => {
          let status = 'pending';
          if (live.open && live.itemId === b.id) status = 'open';
          else if (b.counts) status = b.final ? 'ranked' : 'novotes';
          return { name: plainOf(b.name), status, final: b.final || null, counts: b.counts || null, votes: b.votes || 0 };
        });
        const pdf = buildResultsPdf({ title: plainOf(room.name), date: String(url.searchParams.get('date') || '').slice(0, 60), items });
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="tier-poll-results.pdf"', 'Cache-Control': 'no-store', 'Content-Length': pdf.length });
        return res.end(pdf);
      }
      if (req.method === 'POST' && sub === 'action') {
        const body = await readBody(req, 1000000);
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
        send(res, guestView(room, cid));
        req.on('close', () => c.guests.delete(g));
        return;
      }
      if (req.method === 'GET' && sub === 'img' && parts[4]) {
        const b = room.items.find(x => x.id === parts[4]);
        if (!b || !b.img) { res.writeHead(404); return res.end(); }
        const m = /^data:(image\/[a-z]+);base64,(.*)$/.exec(b.img);
        res.writeHead(200, { 'Content-Type': m[1], 'Cache-Control': 'public, max-age=86400' });
        return res.end(Buffer.from(m[2], 'base64'));
      }
      if (req.method === 'POST' && sub === 'vote') {
        const body = await readBody(req, 4096);
        const cid = String(body.cid || '');
        if (!/^[A-Za-z0-9-]{8,64}$/.test(cid) || !TIERS.includes(body.tier)) return json(res, 400, { error: 'Bad vote' });
        if (!room.live.open || room.live.itemId !== body.itemId) return json(res, 409, { error: 'That poll is closed.' });
        const v = room.votes[body.itemId] || (room.votes[body.itemId] = {});
        if (!v[cid] && Object.keys(v).length >= 20000) return json(res, 429, { error: 'Poll is full' });
        v[cid] = body.tier;
        touch(room); pushHosts(room); pushGuestsWithCid(room, cid); pushDisplays(room);
        return json(res, 200, { ok: true });
      }
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    if (!res.headersSent) json(res, 500, { error: 'Server error' });
  }
});
server.listen(PORT, () => console.log('Tier Poll listening on ' + PORT));
