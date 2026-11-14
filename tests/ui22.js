// Reveal: numbers stay hidden until their bar starts, count up in step with it, and end exactly on the final text.
// Also: the host's Lock It In button is centered.
const { chromium } = require('playwright');
const B = 'http://localhost:3149',
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
  const r = await j('POST', '/api/rooms', { name: 'Count' }),
    H = r.hostCode,
    J = r.joinCode;
  const act = a => j('POST', '/api/host/' + H + '/action', a);
  await act({ type: 'cfg', hostVotes: true });
  await act({ type: 'add', items: ['Item'] });
  let hv = await snap('/api/host/' + H + '/events');
  const id = hv.items[0].id,
    T = hv.tiers.map(x => x.id);
  const cids = [1, 2, 3, 4].map(n => 'cidc000000' + n);
  for (const [i, c] of cids.entries()) await j('POST', '/api/join/' + J + '/name', { cid: c, pw: 'test1234', name: 'P' + (i + 1) });
  const br = await chromium.launch({ executablePath: CH, args: ['--no-sandbox'] });
  const p = await br.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(B + '/host#' + H);
  await p.waitForSelector('.qcircle');
  await act({ type: 'open', id });
  // centered lock button (host picks, then Lock It In)
  await p.locator('.tier-btn').first().click();
  await p.waitForSelector('.lockbtn');
  const geo = await p.evaluate(() => {
    const b = document.querySelector('.lockbtn').getBoundingClientRect(),
      c = document.querySelector('.lockbtn').closest('.card').getBoundingClientRect();
    return { bc: b.left + b.width / 2, cc: c.left + c.width / 2 };
  });
  ok(Math.abs(geo.bc - geo.cc) < 3, 'host Lock It In is centered (' + Math.round(geo.bc) + ' vs ' + Math.round(geo.cc) + ')');
  for (const [i, c] of cids.entries()) await j('POST', '/api/join/' + J + '/vote', { cid: c, itemId: id, tier: T[i < 3 ? 0 : 1] });
  await act({ type: 'close' });
  await act({ type: 'reveal', id });
  await p.waitForSelector('.res-row');
  const samples = [];
  const t0 = Date.now();
  while (Date.now() - t0 < 3200) {
    samples.push(
      await p.evaluate(() =>
        [...document.querySelectorAll('.res-row')].slice(0, 2).map(r => ({
          op: getComputedStyle(r.querySelector('.res-n')).opacity,
          txt: r.querySelector('.res-n').textContent,
          w: r.querySelector('.res-fill').getBoundingClientRect().width / r.querySelector('.res-track').getBoundingClientRect().width
        }))
      )
    );
    await sleep(40);
  }
  const first = samples[0][0];
  ok(parseFloat(first.op) === 0, 'numbers hidden before their bar starts');
  const mid = samples.filter(s => s[0].w > 0.05 && s[0].w < 0.6 && parseFloat(s[0].op) > 0);
  ok(mid.length > 2, 'numbers visible while the bar is mid-fill (' + mid.length + ' samples)');
  const pct = s => parseInt((/·\s*(\d+)%/.exec(s) || [0, 0])[1], 10);
  ok(
    mid.every(s => Math.abs(pct(s[0].txt) - s[0].w * 100) <= 6),
    'percent tracks the bar: ' +
      mid
        .slice(0, 4)
        .map(s => pct(s[0].txt) + '%@' + Math.round(s[0].w * 100))
        .join(' ')
  );
  const last = samples[samples.length - 1];
  ok(last[0].txt === '4 · 80%' && last[1].txt === '1 · 20%', 'final text exact: ' + last.map(x => x.txt).join(' | '));
  // second bar starts later than the first (staggered)
  const firstVis = k => samples.findIndex(s => parseFloat(s[k].op) > 0);
  ok(firstVis(1) > firstVis(0), 'second tier’s number appears after the first');

  // reduced motion: bars are plain; numbers fade in at their final value on their bar's turn
  await act({ type: 'add', items: ['Second'] });
  hv = await snap('/api/host/' + H + '/events');
  const id2 = hv.items.find(x => x.id !== id).id;
  const rctx = await br.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  const rp = await rctx.newPage();
  await rp.goto(B + '/host#' + H);
  await rp.waitForSelector('.qcircle');
  await act({ type: 'open', id: id2 });
  for (const [i, c] of cids.entries()) await j('POST', '/api/join/' + J + '/vote', { cid: c, itemId: id2, tier: T[i < 3 ? 2 : 3] });
  await act({ type: 'close' });
  await act({ type: 'reveal', id: id2 });
  await rp.waitForSelector('.res-row');
  const rs = await rp.evaluate(() =>
    [...document.querySelectorAll('.res-row')].slice(0, 4).map(r => r.querySelector('.res-n').textContent)
  );
  await sleep(2500);
  const re = await rp.evaluate(() =>
    [...document.querySelectorAll('.res-row .res-n')]
      .map(n => [getComputedStyle(n).opacity, n.textContent])
      .filter(x => x[1].startsWith('3') || x[1].startsWith('1'))
  );
  ok(
    rs.some(x => x.startsWith('3 · 75%')) && re.every(x => x[0] === '1'),
    'reduced motion: final numbers, faded in, no counting: ' + JSON.stringify(re)
  );
  console.log(fails ? 'FAILED' : 'ALL PASS');
  await br.close();
  process.exit(fails ? 1 : 0);
})();
