// Per-tile vote counts: last-three rows and the result card announce the winning tile's own votes.
const { chromium } = require('playwright');
const B = 'http://localhost:3147',
  CH = process.env.CHROME || '/usr/bin/google-chrome';
const j = async (m, u, b) => {
  const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return r.json().catch(() => ({}));
};
const snap = u =>
  new Promise(ok => {
    require('http').get(B + u, res => {
      let buf = '';
      res.on('data', d => {
        buf += String(d);
        const m = /data: (.*)\n/.exec(buf);
        if (m) {
          res.destroy();
          ok(JSON.parse(m[1]));
        }
      });
    });
  });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) fails++;
};
(async () => {
  const r = await j('POST', '/api/rooms', { name: 'Votes' }),
    H = r.hostCode,
    J = r.joinCode;
  const act = a => j('POST', '/api/host/' + H + '/action', a);
  await act({ type: 'cfg', tie: 'average' });
  await act({ type: 'add', items: ['Win', 'Tie'] });
  let hv = await snap('/api/host/' + H + '/events');
  const [w, t] = hv.items.map(i => i.id),
    T = hv.tiers.map(x => x.id);
  const cids = [1, 2, 3].map(n => 'cidv000000' + n);
  for (const [i, c] of cids.entries()) await j('POST', '/api/join/' + J + '/name', { cid: c, pw: 'test1234', name: 'P' + (i + 1) });
  const vote = (c, id, tier) => j('POST', '/api/join/' + J + '/vote', { cid: c, itemId: id, tier, lock: true });
  const br = await chromium.launch({ executablePath: CH, args: ['--no-sandbox'] });
  const g = await br.newPage({ viewport: { width: 390, height: 800 }, reducedMotion: 'reduce' });
  await g.goto(B + '/play#' + J);
  await g.fill('.gate input[aria-label="Your name"]', 'Zed');
  await g.fill('.gate input[aria-label="Password"]', 'test1234');
  await g.click('.gate button[type=submit]');
  await g.waitForSelector('.psub');
  // clear win: 2 of 3 votes (Zed is named, so 4 connected; close by hand)
  await act({ type: 'open', id: w });
  await vote(cids[0], w, T[0]);
  await vote(cids[1], w, T[0]);
  await vote(cids[2], w, T[1]);
  await act({ type: 'close' });
  await act({ type: 'reveal', id: w });
  await sleep(4500);
  const s1 = await g.locator('.status').allInnerTexts();
  ok(
    s1.some(x => /^With 2 votes, the room placed it in:/.test(x)),
    'result card uses the tile’s own count: ' + JSON.stringify(s1)
  );
  // tie broken by Average: S and C tied one vote each, lands in the middle with 0 votes
  await act({ type: 'open', id: t });
  await vote(cids[0], t, T[0]);
  await vote(cids[1], t, T[2]);
  await act({ type: 'close' });
  await act({ type: 'reveal', id: t });
  await act({ type: 'tiebreak', id: t }).catch(() => {});
  await sleep(6000);
  const s2 = await g.locator('.status').allInnerTexts();
  ok(
    s2.some(x => /^The room (placed it in|is tied):/.test(x)) && !s2.some(x => /With \d/.test(x)),
    'tie: no count in the sentence: ' + JSON.stringify(s2)
  );
  await act({ type: 'next' }).catch(() => {});
  await sleep(500);
  hv = await snap('/api/host/' + H + '/events');
  const lr = await snap('/api/join/' + J + '/events?cid=' + cids[0]);
  const rows = (lr.lr || []).map(x => ({ n: (x.counts || {})[x.final] || 0, tie: !!x.tie }));
  ok(
    rows.some(x => x.n === 2 && !x.tie),
    'row data: clear win has 2 own votes ' + JSON.stringify(rows)
  );
  ok(
    rows.every(x => !x.tie || x.n <= 1),
    'row data: a tie-broken tile shows its own count, never the total'
  );
  console.log(fails ? 'FAILED' : 'ALL PASS');
  await br.close();
  process.exit(fails ? 1 : 0);
})();
