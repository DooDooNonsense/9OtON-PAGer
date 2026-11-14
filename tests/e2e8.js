// Restart test: rooms saved to DATA_FILE must load again when the server starts (it once crashed on load).
const { spawn } = require('child_process');
const path = require('path'),
  fs = require('fs'),
  os = require('os');
const ROOT = path.join(__dirname, '..'),
  PORT = 3146,
  B = 'http://localhost:' + PORT;
const DATA = path.join(os.tmpdir(), 'impollster-restart-' + process.pid + '.json');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const j = async (m, u, b) => {
  const r = await fetch(B + u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
  return r.json().catch(() => ({}));
};
let fails = 0;
const ok = (c, m) => {
  console.log((c ? 'PASS ' : 'FAIL ') + m);
  if (!c) fails++;
};
const start = () => spawn('node', ['server.js'], { cwd: ROOT, env: { ...process.env, PORT, DATA_FILE: DATA }, stdio: 'ignore' });
(async () => {
  try {
    fs.unlinkSync(DATA);
  } catch (e) {}
  let s = start();
  await sleep(900);
  const r = await j('POST', '/api/rooms', { name: 'Persist' });
  await j('POST', '/api/host/' + r.hostCode + '/action', { type: 'add', items: ['A', 'B'] });
  await j('POST', '/api/host/' + r.hostCode + '/action', { type: 'cfg', tie: 'grab' });
  await sleep(600);
  s.kill();
  await sleep(300);
  s = start();
  await sleep(900);
  const alive = await fetch(B + '/')
    .then(x => x.ok)
    .catch(() => false);
  ok(alive, 'server starts with a saved room');
  const hv = await new Promise(res =>
    require('http').get(B + '/api/host/' + r.hostCode + '/events', q => {
      let buf = '';
      q.on('data', d => {
        buf += String(d);
        const m = /data: (.*)\n/.exec(buf);
        if (m) {
          q.destroy();
          res(JSON.parse(m[1]));
        }
      });
    })
  );
  ok(hv.items && hv.items.length === 2 && hv.cfg.tie === 'grab', 'room and settings survive a restart');
  s.kill();
  try {
    fs.unlinkSync(DATA);
  } catch (e) {}
  console.log(fails ? 'FAILED' : 'ALL PASSED');
  process.exit(fails ? 1 : 0);
})();
