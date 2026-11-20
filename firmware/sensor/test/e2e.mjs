// End-to-end test of the sensor node's logic against the REAL API, with no board attached.
//
//   node e2e.mjs            (from firmware/sensor/test; needs Node 20+ and g++ or clang++)
//
// 1. Builds and runs the unit tests (core_test.cpp).
// 2. Builds sim.cpp: the same hollow_core.h the ESP32 runs, driven from text, standing in for the board.
// 3. Checks 2,000 random numbers: the node writes each exactly as JSON.stringify would, or signatures would fail.
// 4. Starts api/server.js with a device key for the node, and plays the sensor node's day through it:
//    clean water, a salty cup, stale air, a flooded tunnel, a network cut with a backlog, a re-sent backlog,
//    a forged reading, an unsigned node. Every message is built by the node's own code.
// Exits 1 on the first failure.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const tmp = mkdtempSync(join(tmpdir(), 'hollow-sensor-'));
const DEVICE = 'sensor-l7-chalk-cut', BLOCK = 'l7-chalk-cut', KEY = 'test-only-sensor-secret-0001';
let passed = 0;
const ok = (name) => { passed++; console.log(`ok  ${name}`); };

function compiler() {
  for (const c of ['g++', 'clang++']) if (spawnSync(c, ['--version']).status === 0) return c;
  throw new Error('needs g++ or clang++ (on Windows: use WSL, or skip this test; the unit tests are the same)');
}
function build(src, out) {
  const r = spawnSync(compiler(), ['-std=c++11', '-Wall', '-Wextra', '-Werror', '-pedantic', '-I', join(here, '..', 'sensor_node'), join(here, src), '-o', out], { encoding: 'utf8' });
  assert.equal(r.status, 0, `build ${src} failed:\n${r.stderr}`);
}
// Runs the stand-in node over some command lines and returns its output lines.
function sim(lines, key = KEY, device = DEVICE) {
  const r = spawnSync(join(tmp, 'sim'), [device, BLOCK, key || '-'], { input: lines.join('\n') + '\n', encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim().split('\n');
}

// ---- 1, 2: unit tests and the stand-in node
build('core_test.cpp', join(tmp, 'core_test'));
const unit = spawnSync(join(tmp, 'core_test'), { encoding: 'utf8' });
assert.equal(unit.status, 0, unit.stdout);
ok(`unit tests: ${unit.stdout.trim()}`);
build('sim.cpp', join(tmp, 'sim'));

// ---- 3: numbers, exactly as JSON.stringify writes them
{
  let seed = 20261118;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const cases = [];
  for (let i = 0; i < 2000; i++) {
    const mag = [1, 10, 100, 1000, 50000][i % 5];
    cases.push([(rand() - 0.2) * mag, i % 4]);
  }
  const out = sim(cases.map(([v, d]) => `fmt ${v.toPrecision(17)} ${d}`));
  cases.forEach(([v, d], i) => {
    const text = out[i];
    assert.equal(JSON.stringify(JSON.parse(text)), text, `${v} at ${d} decimals was written ${text}`);
    assert.ok(Math.abs(Number(text) - v) <= 0.5 * 10 ** -d + 1e-9, `${v} at ${d} decimals rounded to ${text}`);
  });
  ok('2,000 random readings are written exactly as JSON.stringify writes them');
}

// ---- 4: the real API
const api = spawn(process.execPath, [join(root, 'api', 'server.js')], {
  env: { ...process.env, PORT: '0', DATA: join(tmp, 'readings.jsonl'), DEVICE_KEYS: JSON.stringify({ [DEVICE]: KEY }) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const API = await new Promise((resolve, reject) => {
  let log = '';
  api.stdout.on('data', (d) => { log += d; const m = log.match(/http:\/\/localhost:(\d+)/); if (m) resolve(`http://localhost:${m[1]}`); });
  api.on('exit', (c) => reject(new Error(`API exited (${c}): ${log}`)));
  setTimeout(() => reject(new Error(`API did not start: ${log}`)), 10000);
});
const post = async (body) => {
  const r = await fetch(`${API}/ingest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
  return { status: r.status, body: await r.json() };
};
const get = async (p) => (await fetch(API + p)).json();

try {
  const now = Math.floor(Date.now() / 1000) - 5;
  let n = 0;
  const msg = (t, kind, values, key) => JSON.parse(sim([`msg ${++n} ${t} ${kind} ${values}`], key)[0]);

  // the API's own limits, read by the node's limit reader
  {
    const lim = await get('/limits');
    writeFileSync(join(tmp, 'limits.json'), JSON.stringify(lim));
    const [found, tds, ntu, stale, danger, flood] = sim([`limits ${join(tmp, 'limits.json')}`])[0].split(' ').map(Number);
    assert.equal(found, 5);
    assert.deepEqual([tds, ntu, stale, danger, flood], [lim.water_tds_max_ppm.value, lim.water_turbidity_max_ntu.value,
      lim.air_co2_stale_ppm.value, lim.air_co2_danger_ppm.value, lim.flood_depth_closed_cm.value]);
    const alarms = sim([`limits ${join(tmp, 'limits.json')}`, 'alarm 240 0.8 800 2', 'alarm 1450 1 800 2', 'alarm 240 0.8 1200 2', 'alarm 240 0.8 800 16']).slice(1);
    assert.deepEqual(alarms, ['0', '2', '1', '1']);
    ok(`the node reads the API's five limits from GET /limits (${tds} ppm, ${ntu} NTU, ${stale}/${danger} ppm CO2, ${flood} cm) and alarms on the same lines`);
  }

  // clean water: stored as a verified live reading, no alert
  const clean = msg(now - 400, 'water', 'tds_ppm=240.4:0 turbidity_ntu=0.84:1');
  let r = await post(JSON.stringify(clean));
  assert.equal(r.status, 200); assert.equal(r.body.accepted, 1);
  let stored = (await get(`/history?block=${BLOCK}&kind=water`)).find((x) => x.id === clean.id);
  assert.equal(stored.verified, true); assert.equal(stored.source, 'live');
  assert.deepEqual(stored.values, { tds_ppm: 240, turbidity_ntu: 0.8 });
  assert.ok(!(await get(`/history?block=${BLOCK}&kind=alert`)).some((a) => a.values.cause === clean.id));
  ok('clean water: stored as a verified, live reading, no alert');

  // the salty cup: do-not-drink, on the first reading (a 1,210 ppm step is under the API's 5,000 ppm jump check)
  const salty = msg(now - 390, 'water', 'tds_ppm=1450:0 turbidity_ntu=1.0:1');
  r = await post(JSON.stringify(salty));
  assert.equal(r.body.accepted, 1);
  let alerts = await get(`/history?block=${BLOCK}&kind=alert`);
  const dnd = alerts.find((a) => a.values.cause === salty.id);
  assert.ok(dnd && /Do not drink/.test(dnd.values.text), 'no do-not-drink alert');
  stored = (await get(`/history?block=${BLOCK}&kind=water`)).find((x) => x.id === salty.id);
  assert.notEqual(stored.plausible, false, 'the salty cup was taken for a sensor error');
  ok(`salty cup: "${dnd.values.text}" on the first reading`);

  // stale air and a flooded tunnel
  const air = msg(now - 380, 'air', 'co2_ppm=1200:0 temp_c=31.04:1 humidity_pct=60.2:1');
  const flood = msg(now - 370, 'flood', 'depth_cm=16.2:1');
  r = await post(JSON.stringify([air, flood]));
  assert.equal(r.body.accepted, 2);
  alerts = await get(`/history?block=${BLOCK}&kind=alert`);
  assert.ok(alerts.some((a) => a.values.cause === air.id && /Air going stale/.test(a.values.text)));
  assert.ok(alerts.some((a) => a.values.cause === flood.id && /tunnel closed/.test(a.values.text)));
  ok('air at 1,200 ppm CO2: "Air going stale"; 16.2 cm of water: "tunnel closed"');

  // network cut: five readings held, then uploaded as ONE array, out of order, with their original times
  const held = [300, 240, 180, 120, 60].map((ago) => msg(now - ago, 'water', `tds_ppm=${250 + ago / 10}:0 turbidity_ntu=0.9:1`));
  r = await post(JSON.stringify([held[3], held[0], held[4], held[1], held[2]]));
  assert.equal(r.body.accepted, 5); assert.equal(r.body.duplicates, 0);
  const hist = (await get(`/history?block=${BLOCK}&kind=water`)).filter((x) => held.some((h) => h.id === x.id));
  assert.deepEqual(hist.map((x) => x.id), held.map((h) => h.id), 'history is not in time order');
  assert.ok(hist.every((x, i) => x.time === held[i].time && x.verified === true && !x.time_estimated));
  ok('network cut: a 5-reading backlog in one request, stored in time order with original times, all verified');

  // the same backlog sent again (an upload whose reply was lost): nothing doubles
  r = await post(JSON.stringify(held));
  assert.equal(r.body.accepted, 0); assert.equal(r.body.duplicates, 5);
  ok('re-sent backlog: 5 duplicates, nothing stored twice');

  // a forged reading: a signed message whose value is changed afterwards
  {
    const ctrl = new AbortController();
    const live = await fetch(`${API}/live`, { signal: ctrl.signal });
    const reader = live.body.getReader();
    const forged = msg(now - 30, 'water', 'tds_ppm=1450:0 turbidity_ntu=1.0:1');
    forged.values.tds_ppm = 120; // "the water is fine"
    r = await post(JSON.stringify(forged));
    assert.equal(r.body.accepted, 0);
    assert.ok(r.body.rejected.some((x) => x.id === forged.id));
    let text = '';
    const deadline = Date.now() + 5000;
    while (!/event: forgery/.test(text) && Date.now() < deadline) text += new TextDecoder().decode((await reader.read()).value);
    ctrl.abort();
    assert.match(text, /event: forgery/);
    assert.ok((await get('/forgeries')).forgeries.some((f) => f.device === DEVICE && f.block === BLOCK));
    assert.ok(!(await get(`/history?block=${BLOCK}&kind=water`)).some((x) => x.id === forged.id), 'the forgery was stored');
    ok('forged reading (value changed after signing): refused, never stored, shown on /live as event: forgery');
  }

  // a node with no key: still accepted, honestly marked unverified
  {
    const unsigned = JSON.parse(sim([`msg 1 ${now - 20} water tds_ppm=260:0 turbidity_ntu=1:1`], '', 'sensor-l6-chalk-bend')[0]);
    unsigned.block = 'l6-chalk-bend';
    assert.equal(unsigned.sig, undefined);
    r = await post(JSON.stringify(unsigned));
    assert.equal(r.body.accepted, 1);
    const u = (await get('/history?block=l6-chalk-bend&kind=water')).find((x) => x.id === unsigned.id);
    assert.equal(u.verified, false); assert.equal(u.source, 'live');
    ok('unsigned node: accepted, stored as live but unverified');
  }

  console.log(`\n${passed} end-to-end checks passed`);
} catch (e) {
  console.error(`\nFAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  api.kill();
  rmSync(tmp, { recursive: true, force: true });
}
