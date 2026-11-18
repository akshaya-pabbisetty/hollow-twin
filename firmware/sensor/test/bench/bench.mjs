// The virtual bench session: the REAL sensor_node.ino on a simulated ESP32 (board/), talking real HTTP to the real
// api/server.js. It plays what a person would do with the parts on a desk, then checks the board's lights and
// serial output (in bench_main) and everything the API stored (here).
//
//   node bench.mjs        (from firmware/sensor/test/bench; Linux, macOS or WSL with g++ or clang++ and Node 20+)
//
// What is simulated: the sensors' physics (a TDS probe that reads 8% high until calibrated, a turbidity probe that
// gives 4.0 V in clear water, the speed of sound, the SCD40's I2C protocol), the router, the clock and the flash.
// What is real: the sketch's code, the HTTP traffic and the API. What this cannot prove: that the real ESP32 core
// compiles the sketch, and that real parts behave like their datasheets. Build it in the Arduino IDE for that.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, copyFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const node = join(here, '..', '..', 'sensor_node');
const tmp = mkdtempSync(join(tmpdir(), 'hollow-bench-'));
const DEVICE = 'sensor-l7-chalk-cut', BLOCK = 'l7-chalk-cut', KEY = 'bench-only-sensor-secret-0001';
let passed = 0;
const ok = (s) => { passed++; console.log(`API OK     ${s}`); };

// ---- build the real sketch against the simulated board (secrets come from the bench, never from a secrets.h)
const src = join(tmp, 'src');
spawnSync('mkdir', ['-p', src]);
for (const f of ['sensor_node.ino', 'hollow_core.h', 'config.h']) copyFileSync(join(node, f), join(src, f));
const cxx = ['g++', 'clang++'].find((c) => spawnSync(c, ['--version']).status === 0);
assert.ok(cxx, 'needs g++ or clang++');
const b = spawnSync(cxx, ['-std=gnu++17', '-Wall', '-Wextra', '-Werror', '-Wno-unused-function', '-I', src, '-I', join(here, 'board'),
  join(here, 'bench_main.cpp'), '-o', join(tmp, 'bench')], { encoding: 'utf8' });
assert.equal(b.status, 0, b.stderr);
console.log('built: the real sensor_node.ino on the simulated board, warning-free');

// ---- the API, with this node's key on file
const api = spawn(process.execPath, [join(root, 'api', 'server.js')], {
  env: { ...process.env, PORT: '0', DATA: join(tmp, 'readings.jsonl'), DEVICE_KEYS: JSON.stringify({ [DEVICE]: KEY }) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const API = await new Promise((res, rej) => {
  let log = '';
  api.stdout.on('data', (d) => { log += d; const m = log.match(/localhost:(\d+)/); if (m) res(`http://127.0.0.1:${m[1]}`); });
  setTimeout(() => rej(new Error('API did not start: ' + log)), 10000);
});
const get = async (p) => (await fetch(API + p)).json();

// One power-on of a board. `flash` is the board's flash file: the same file = the same board after a reboot.
let clock = Math.floor(Date.now() / 1000) - 4 * 3600; // the bench session happened in the last few hours
function board(name, script, { flash, key }) {
  const elapsed = join(tmp, `${name}.elapsed`);
  console.log(`\n######## ${name} ########`);
  const r = spawnSync(join(tmp, 'bench'), [], {
    input: script, encoding: 'utf8', maxBuffer: 64 << 20,
    env: { ...process.env, BENCH_API: API, BENCH_KEY: key, BENCH_FLASH: join(tmp, flash), BENCH_UNIX_BASE: String(clock), BENCH_ELAPSED: elapsed },
  });
  const out = r.stdout;
  // the bench's verdicts, and the lines that show what the node did
  for (const l of out.split('\n')) if (/^(BENCH|== |> |\[bench\])|refused|calibrated|limits from|message\(s\)/.test(l)) console.log(l);
  const start = clock;
  clock += Number(readFileSync(elapsed, 'utf8')) + 30;
  assert.equal(r.status, 0, `${name}: a bench check failed`);
  return { out, start, end: clock - 30 };
}

try {
  // ======== 1. First power-on, calibration, and a day's events
  const s1 = board('board A, first power-on', `
say First power-on: nothing calibrated. Tap water (240 ppm) in the cup, dry floor, ordinary air
mark
boot
watch 20
expect log limits from the API
expect log NOT SENT until you run cal clear
expect log NOT SENT until you run cal floor
expect alarm clear
expect status solid
say Calibrate: TDS probe into the 1413 uS/cm (707 ppm) standard, turbidity probe in clear water, flood sensor over the dry floor
set tds 707
run 4
mark
serial cal tds 707
expect log TDS calibrated
serial cal clear
expect log turbidity calibrated: clear water = 4.00 V
serial cal floor
expect log flood sensor: 45.0 cm above the dry floor
say Back into tap water, now calibrated
set tds 240
watch 70
expect alarm clear
expect status solid
say The salty cup
set tds 1450
react 2.6 danger
watch 6
expect alarm danger
say Back to clean water
set tds 240
react 2.6 clear
watch 6
expect alarm clear
say Muddy water: the turbidity probe drops to 3.8 V
set turbidity_v 3.8
react 7 danger
watch 6
expect alarm danger
set turbidity_v 4.0
react 7 clear
watch 6
expect alarm clear
say The Directorate unplugs the router. Then the salty cup again
wifi down
watch 2
expect status blinking
set tds 1450
react 2.6 danger
watch 10
expect alarm danger
expect status blinking
set tds 240
run 100
set tds 1450
run 20
set tds 240
react 2.6 clear
watch 20
expect alarm clear
expect status blinking
say The router comes back
mark
wifi up
watch 10
expect log message(s) sent
expect status solid
say Water rises in the tunnel, then drains
set depth 20
react 2.6 warn
watch 10
expect alarm warn
set depth 0
run 10
say A crowded block: CO2 climbs
set co2 1250
react 7 warn
watch 12
expect alarm warn
set co2 650
run 12
say The API goes down while Wi-Fi stays up (connections refused), and the salty cup goes in
api down
set tds 1450
react 2.6 danger
watch 20
expect alarm danger
expect status blinking
say The API is back: the node retries on its backoff (at most 60 s) and catches up
api up
set tds 240
react 2.6 clear
run 60
watch 10
expect alarm clear
expect status solid
`, { flash: 'boardA.flash', key: KEY });

  // ======== 2. The same board loses power and comes back
  const s2 = board('board A, after a power cut', `
say Power-on again: calibration, limits and the id counter come back from flash
boot
mark
watch 15
expect nolog NOT SENT until you run cal clear
expect nolog NOT SENT until you run cal floor
expect alarm clear
expect status solid
`, { flash: 'boardA.flash', key: KEY });

  // ======== 3. A board claiming to be this node, without its key: the Directorate faking "the water is fine"
  const s3 = board('board B, a forger with the wrong key', `
say Another board says it is ${DEVICE}, signed with the wrong key
boot
mark
watch 10
expect log refused
`, { flash: 'boardB.flash', key: 'the-directorate-guessed-wrong' });

  // ======== what the API holds
  const queued = (out) => [...out.matchAll(/queued (\S+) (\w+) (\{[^\n]*\})/g)].map((m) => ({ id: m[1], kind: m[2], values: JSON.parse(m[3]) }));
  const q1 = queued(s1.out), q2 = queued(s2.out), q3 = queued(s3.out);
  const hist = (await get(`/history?block=${BLOCK}`)).filter((r) => r.kind !== 'alert');
  const byId = new Map(hist.map((r) => [r.id, r]));
  const jumps = [];

  // every message board A queued is stored once, verified and live; nothing else is stored
  for (const m of [...q1, ...q2]) {
    const r = byId.get(m.id);
    assert.ok(r, `${m.id} was queued but never stored`);
    assert.equal(r.verified, true, `${m.id} is not verified`);
    assert.equal(r.source, 'live');
    if (r.plausible === false) {
      // only a real sudden step (the API's jump check), confirmed by this device's next reading within seconds
      assert.ok(r.sensor_flags.every((f) => f.type === 'jump'), `${m.id}: ${r.sensor_error}`);
      const next = hist.find((x) => x.kind === r.kind && Date.parse(x.time) > Date.parse(r.time));
      assert.ok(next && next.plausible !== false && Date.parse(next.time) - Date.parse(r.time) <= 6000, `${m.id}: no confirmation within 6 s`);
      jumps.push(`${r.values.turbidity_ntu ?? r.values.tds_ppm} (confirmed ${(Date.parse(next.time) - Date.parse(r.time)) / 1000} s later)`);
    }
    assert.deepEqual(r.values, m.values);
  }
  assert.equal(hist.length, q1.length + q2.length, 'the API holds messages the board never sent, or lost some');
  assert.ok(jumps.length <= 2);
  ok(`all ${q1.length + q2.length} messages from board A stored exactly once, verified and live. The API held back only the muddy cup going in and out as possible probe faults (steps over its 50 NTU jump check), each confirmed by the node's next reading: ${jumps.join(', ')}`);

  // ids never repeat across the power cut
  const n = (id) => Number(id.split('-').pop());
  assert.ok(Math.min(...q2.map((m) => n(m.id))) > Math.max(...q1.map((m) => n(m.id))));
  ok(`after the power cut the ids continue (${q1.at(-1).id} -> ${q2[0].id}); nothing was dropped as a duplicate`);

  // before calibration: TDS only, no turbidity, no flood; after: all of them, and TDS accurate
  // before calibration (by what the board printed): TDS only, no turbidity, no flood; after: all of them, accurate
  const at = (text) => s1.out.indexOf(text);
  const queuedAt = [...s1.out.matchAll(/queued (\S+) (\w+) (\{[^\n]*\})/g)].map((m) => ({ id: m[1], kind: m[2], values: JSON.parse(m[3]), pos: m.index }));
  const calClear = at('turbidity calibrated'), calFloor = at('flood sensor:');
  assert.ok(calClear > 0 && calFloor > 0);
  assert.ok(queuedAt.filter((m) => m.pos < calClear).every((m) => m.values.turbidity_ntu === undefined), 'turbidity sent before calibration');
  assert.ok(queuedAt.filter((m) => m.pos < calFloor).every((m) => m.kind !== 'flood'), 'flood sent before calibration');
  const firstTds = hist.find((r) => r.kind === 'water').values.tds_ppm;
  assert.ok(Math.abs(firstTds - 240 * 1.08) <= 4, `uncalibrated TDS ${firstTds}`);
  const calTds = at('TDS calibrated');
  const after = hist.filter((r) => queuedAt.some((m) => m.id === r.id && m.pos > calTds) || q2.some((m) => m.id === r.id));
  const tap = after.filter((r) => r.kind === 'water' && r.values.tds_ppm < 400).map((r) => r.values.tds_ppm);
  const salty = after.filter((r) => r.kind === 'water' && r.values.tds_ppm > 1000).map((r) => r.values.tds_ppm);
  assert.ok(tap.length && tap.every((v) => Math.abs(v - 240) <= 240 * 0.02), `calibrated tap water: ${tap}`);
  assert.ok(salty.length && salty.every((v) => Math.abs(v - 1450) <= 1450 * 0.02), `calibrated salty cup: ${salty}`);
  const water = after.filter((r) => r.kind === 'water' && r.values.turbidity_ntu !== undefined);
  const ntu = water.filter((r) => r.values.turbidity_ntu < 100).map((r) => r.values.turbidity_ntu);
  const muddy = water.filter((r) => r.values.turbidity_ntu >= 100).map((r) => r.values.turbidity_ntu);
  assert.ok(ntu.length && ntu.every((v) => v < 5), `clean water crossed the 5 NTU line: ${ntu}`);
  assert.ok(muddy.length, 'the muddy water was never reported');
  // steady clean water costs about one water message a minute, not one every few seconds
  const steady = queuedAt.filter((m) => m.kind === 'water' && m.pos > at('now calibrated') && m.pos < at('The salty cup'));
  assert.ok(steady.length <= 3, `${steady.length} water messages in 70 s of unchanged tap water`);
  ok(`uncalibrated: TDS only (${firstTds} ppm, the probe's 8% error), no turbidity, no flood. Calibrated: tap ${Math.min(...tap)}-${Math.max(...tap)} ppm, salty ${Math.min(...salty)}-${Math.max(...salty)} ppm (true 240 and 1450); clean water at most ${Math.max(...ntu)} NTU over ${ntu.length} readings (limit 5), muddy water ${Math.min(...muddy)}-${Math.max(...muddy)} NTU; ${steady.length} water message(s) in 70 s of steady tap water`);

  // alerts: do-not-drink for the salty cup (online, offline and API-down alike), nothing before calibration
  const alerts = await get(`/history?block=${BLOCK}&kind=alert`);
  const dnd = alerts.filter((a) => /Do not drink/.test(a.values.text));
  const saltyIds = hist.filter((r) => r.kind === 'water' && r.plausible !== false && (r.values.tds_ppm > 1000 || r.values.turbidity_ntu > 5)).map((r) => r.id);
  assert.ok(saltyIds.every((id) => dnd.some((a) => a.values.cause === id)), 'a salty or muddy reading without a do-not-drink alert');
  assert.ok(dnd.every((a) => saltyIds.includes(a.values.cause)), 'a do-not-drink alert on clean water');
  assert.ok(!alerts.some((a) => queuedAt.some((m) => m.id === a.values.cause && m.pos < calTds)), 'an alert before calibration');
  ok(`${dnd.length} "Do not drink" alerts, one for every salty or muddy reading and none for clean water; no alert before calibration`);
  const flood = alerts.find((a) => /tunnel closed/.test(a.values.text)), air = alerts.find((a) => /Air going stale/.test(a.values.text));
  assert.ok(flood && air);
  const depth = hist.find((r) => r.id === flood.values.cause).values.depth_cm;
  assert.ok(Math.abs(depth - 20) <= 0.5, `flood depth ${depth}`);
  ok(`"${flood.values.text}" at ${depth} cm (true 20); "${air.values.text}"`);

  // the network cut: what the board held arrived later, in order, with the times it was measured
  const times = hist.map((r) => Date.parse(r.time));
  assert.ok(times.every((t, i) => i === 0 || t >= times[i - 1]), 'history out of time order');
  const batches = [...s1.out.matchAll(/API 200: (\d+) message\(s\) sent/g)].map((m) => Number(m[1]));
  assert.ok(Math.max(...batches) >= 5, `largest upload ${Math.max(...batches)}`);
  const heldSalty = hist.filter((r) => r.kind === 'water' && r.values.tds_ppm > 1000).map((r) => r.time);
  assert.ok(new Set(heldSalty).size === heldSalty.length);
  ok(`network cut: the board uploaded its backlog in one request of ${Math.max(...batches)} messages; every reading kept the time it was measured, in order`);

  // the forger: refused, never stored, public
  const forged = (await get('/forgeries')).forgeries.filter((f) => f.device === DEVICE);
  assert.ok(q3.length > 0 && forged.length >= q3.length);
  assert.ok(q3.every((m) => !byId.has(m.id) || byId.get(m.id).verified === true));
  ok(`a board with the wrong key: all ${q3.length} of its messages refused, none stored, ${forged.length} shown in GET /forgeries and on /live`);

  console.log(`\nVIRTUAL BENCH PASSED: every board check above, and ${passed} API checks`);
} catch (e) {
  console.error(`\nVIRTUAL BENCH FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  api.kill();
  rmSync(tmp, { recursive: true, force: true });
}
