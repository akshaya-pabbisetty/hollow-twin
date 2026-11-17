// End-to-end tests against a real running API. `node --test tests/`
// Each test maps to a shot in the demo video or a failure that would break it on camera.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const L = require("../logic");
const { BLOCK_IDS, deviceId } = require("./helper");

const PORT = 18787 + Math.floor(Math.random() * 1000);
const API = `http://localhost:${PORT}`;
const DATA = path.join(os.tmpdir(), `ht-test-${PORT}.jsonl`);
let proc, seq = 0;

function startServer() {
  return new Promise((res) => {
    proc = spawn("node", [path.join(__dirname, "../server.js")], { env: { ...process.env, PORT, DATA } });
    proc.stdout.on("data", (d) => d.toString().includes("API on") && res());
  });
}
const stopServer = () => new Promise((res) => { proc.on("exit", res); proc.kill(); });
const H = 3600e3;
const iso = (ms) => new Date(ms).toISOString();
const R = (device, block, kind, values, time = Date.now()) =>
  ({ id: `${deviceId(device, block)}-${++seq}`, device: deviceId(device, block), block, time: iso(time), kind, values, hops: 0, via: [] });
const post = (p, body) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (p) => fetch(API + p).then((r) => r.json());

before(async () => { fs.rmSync(DATA, { force: true }); await startServer(); });
after(async () => { await stopServer(); fs.rmSync(DATA, { force: true }); });

test("format: valid readings stored, bad ones rejected with a reason", async () => {
  const ok = await post("/ingest", R("sensor", "l2-chalk-gallery", "air", { co2_ppm: 900 }));
  assert.strictEqual(ok.body.added, 1);
  const b = "l2-chalk-gallery";
  const bad = await post("/ingest", [{ id: "x" }, { ...R("sensor", b, "smell", {}) }, { ...R("sensor", b, "air", {}), time: "yesterday" }]);
  assert.strictEqual(bad.status, 400);
  assert.deepStrictEqual(bad.body.errors.map((e) => e.err).sort(),
    ["missing device; missing block; missing time; missing kind; missing values", "time is not ISO 8601", 'unknown kind "smell"']);
  assert.strictEqual((await post("/ingest", "{not json")).status, 400);
  assert.strictEqual((await post("/ingest", [null])).status, 400);
});

test("shot 3, warning: hours left = battery_wh / (draw_w - supply_w); one warning under 24 h, one alarm under 8 h", async () => {
  const now = Date.now() - 20 * H, b = "l6-flint-face"; // the timeline ends at the real "now"
  const power = (battery_wh, draw_w, supply_w, hoursIn) => post("/ingest", R("relay", b, "power", { battery_wh, draw_w, supply_w }, now + hoursIn * H));
  const hours = async () => (await get(`/forecast?block=${b}`))[0];
  // mains still cover the block: nothing to forecast
  await power(3000, 100, 100, 0);
  let f = await hours();
  assert.deepStrictEqual([f.hours_left, f.level, f.method, f.net_drain_w], [null, "ok", "net drain", 0]);
  // supply drops to 40 W: 3000 Wh / (100 - 40) W = 50 h left
  await power(3000, 100, 40, 1);
  f = await hours();
  assert.deepStrictEqual([f.hours_left, f.level, f.battery_wh, f.draw_w, f.supply_w, f.net_drain_w], [50, "ok", 3000, 100, 40, 60]);
  assert.match(f.reasons[0], /battery 3000 Wh with draw 100 W and supply 40 W: net drain 60 W gives 50 h left/);
  // supply fails completely, and the battery runs down: 2300/100 = 23 h (warning), 2000/100 = 20 h, 700/100 = 7 h (alarm), 500/100 = 5 h
  for (const [wh, h] of [[2300, 8], [2000, 11], [700, 18], [500, 20]]) await power(wh, 100, 0, h);
  f = await hours();
  assert.deepStrictEqual([f.hours_left, f.level], [5, "alarm"]);
  const alerts = (await get(`/history?kind=alert&block=${b}`)).filter((a) => a.values.hours_left !== undefined);
  assert.deepStrictEqual(alerts.map((a) => [a.values.level, a.values.hours_left, a.values.text]),
    [["warn", 23, `${b} has about 23 h of battery left`], ["danger", 7, `${b} has about 7 h of battery left`]],
    "one warning under 24 h and one alarm under 8 h, not one on every reading");
  assert.deepStrictEqual(alerts.map((a) => a.values.limit.key), ["battery_warn_hours", "battery_alarm_hours"]);
});

test("hum upgrade: grid frequency sag warns BEFORE any battery is used", async () => {
  const b = "l5-rail-face", steady = { battery_wh: 5000, draw_w: 120, supply_w: 120 };
  await post("/ingest", R("relay", b, "power", { ...steady, grid_hz: 60.01 }));
  assert.strictEqual((await get(`/history?kind=alert&block=${b}`)).length, 0, "normal hum: no alert");
  await post("/ingest", R("relay", b, "power", { ...steady, grid_hz: 59.71 }));
  const a = await get(`/history?kind=alert&block=${b}`);
  assert.strictEqual(a.length, 1);
  assert.match(a[0].values.text, /power cut likely soon/);
  const f = (await get(`/forecast?block=${b}`))[0];
  assert.deepStrictEqual([f.battery_wh, f.hours_left, f.level, f.grid_stress], [5000, null, "ok", true], "battery still full and not draining when the warning fires");
});

test("shot 4, fair share across all 70 contract blocks: Directorate darkens deep levels, fair share darkens none", async () => {
  // what the sector needs comes from the people in contract/blocks.json: 100 W each, 45 W of it critical
  // (measured=0: this server already holds power readings from the tests above; tests/logic.test.js covers those)
  const blocks = JSON.parse(fs.readFileSync(path.join(__dirname, "../../contract/blocks.json"), "utf8")).blocks;
  const people = blocks.reduce((s, b) => s + b.people, 0);
  const totals = (await get("/fairshare?supply_w=0&measured=0")).fair;
  assert.deepStrictEqual([totals.blocks.length, totals.demand_total_w, totals.critical_total_w], [70, people * 100, people * 45]);
  const supply = Math.round(totals.demand_total_w * 0.6); // only 60% of what the sector needs is available
  const r = await get(`/fairshare?supply_w=${supply}&measured=0`);
  assert.deepStrictEqual(r.fair.blocks.map((b) => b.block), blocks.map((b) => b.id), "every contract block, in the file's order");
  assert.ok(r.directorate.dark_blocks.length >= 10, `Directorate dark: ${r.directorate.dark_blocks}`);
  assert.ok(r.directorate.dark_blocks.every((b) => L.levelOf(b) >= 7), "only the deepest levels go dark");
  assert.ok(r.directorate.blocks.filter((b) => b.level === "L0").every((b) => b.served_pct === 100), "the top level is served in full");
  assert.deepStrictEqual(r.fair.dark_blocks, [], "fair share: nobody loses air or pumps");
  assert.ok(r.fair.equity_index > r.directorate.equity_index);
  assert.ok(Math.abs(r.fair.served_total_w - supply) <= 70, `fair share uses all supply, used ${r.fair.served_total_w} of ${supply}`);
  const deep = r.fair.blocks.find((b) => b.block === "l8-bore-bend");
  assert.deepStrictEqual([deep.name, deep.level, deep.people, deep.demand_w, deep.critical_w, deep.demand_source], ["Bore Bend", "L8", 772000, 77200000, 34740000, "people"]);
  assert.ok(deep.served_w >= deep.critical_w && deep.served_pct === 60, JSON.stringify(deep));
});

test("fair share edge cases: below critical, above demand, zero", () => {
  const S = L.sector(); // no readings: every block is sized from its people
  const crit = S.reduce((s, b) => s + b.critical_w, 0), demand = S.reduce((s, b) => s + b.demand_w, 0);
  const low = L.allocate(S, crit / 2, "fair");            // less than the critical load
  assert.ok(low.blocks.every((b) => b.served_w > 0), "everyone gets a share of what exists");
  assert.strictEqual(low.dark_blocks.length, 70, "and it is said plainly that nobody's critical load is covered");
  const high = L.allocate(S, demand * 2, "fair");
  assert.ok(high.blocks.every((b) => b.served_pct === 100) && high.dark_blocks.length === 0);
  const zero = L.allocate(S, 0, "fair");
  assert.strictEqual(zero.dark_blocks.length, 70);
});

test("shot 5, network dies: relay backlog arrives late and out of order, copies dropped, gap replays in order", async () => {
  const b = "l7-chalk-cut", t0 = Date.now() - 30 * 60e3;
  const held = [0, 1, 2, 3, 4].map((i) => R("sensor", b, "air", { co2_ppm: 900 + i }, t0 + i * 60e3));
  const shuffled = [held[3], held[0], held[4], held[1], held[2]];
  const first = await post("/ingest", shuffled);
  assert.strictEqual(first.body.added, 5);
  const copy = await post("/ingest", [held[1], held[2]]); // the same messages arriving via a second relay
  assert.strictEqual(copy.body.dupes, 2);
  const hist = await get(`/history?block=${b}&kind=air`);
  assert.deepStrictEqual(hist.map((r) => r.values.co2_ppm), [900, 901, 902, 903, 904]);
  assert.strictEqual(hist[0].time, held[0].time, "original reading times kept");
});

test("shot 5, families: an \"I'm OK\" check-in from L1 reaches family on L7 only", async () => {
  await post("/family", { group: "fam-0011", devices: ["watch-0011", "watch-0071"] });
  await post("/ingest", R("watch-0011", "l1-winch-gallery", "checkin", { status: "ok", family: "fam-0011", to: [] }));
  const inbox = await get("/inbox?device=watch-0071");
  assert.ok(inbox.some((a) => /watch-0011 is OK/.test(a.values.text)));
  const stranger = await get("/inbox?device=watch-0099");
  assert.ok(!stranger.some((a) => /is OK/.test(a.values.text)), "not delivered to strangers");
  const fam = await get("/family?group=fam-0011");
  assert.ok(fam.find((m) => m.device === "watch-0011").last_ok);
});

test("shot 6, bad water: salty cup -> do-not-drink reaches watches in that block", async () => {
  const b = "l3-ember-yard";
  await post("/ingest", R("watch-0031", b, "vitals", { hr_bpm: 75, spo2_pct: 98, temp_c: 36.7 }));
  await post("/ingest", R("sensor", b, "water", { tds_ppm: 240, turbidity_ntu: 0.8 }));
  assert.ok(!(await get("/inbox?device=watch-0031")).some((a) => /Do not drink/.test(a.values.text)), "clean water: silent");
  await post("/ingest", R("sensor", b, "water", { tds_ppm: 1450, turbidity_ntu: 1.1 }));
  assert.ok((await get("/inbox?device=watch-0031")).some((a) => /Do not drink/.test(a.values.text)));
});

test("shot 7, truth: residents' count vs the Directorate's count", async () => {
  const b = "l8-bore-bend";
  for (let i = 0; i < 6; i++) await post("/ingest", R(`watch-008${i}`, b, "button", { button: "symptom" }));
  for (let i = 0; i < 3; i++) await post("/ingest", R(`watch-009${i}`, b, "vitals", { hr_bpm: 96, spo2_pct: 91, temp_c: 38.1 }));
  await post("/ingest", R("watch-0080", b, "button", { button: "symptom" })); // same person twice counts once
  await post("/official", { block: b, count: 2 });
  const row = (await get("/truth")).blocks.find((r) => r.block === b);
  assert.deepStrictEqual([row.residents, row.official, row.gap], [9, 2, 7]);
});

test("shot 8, care: help requests ranked by vitals, top one dispatched, nearest on ties", async () => {
  await post("/ingest", R("watch-0041", "l4-coke-yard", "vitals", { hr_bpm: 80, spo2_pct: 97, temp_c: 36.8 }));
  await post("/ingest", R("watch-0042", "l8-bore-bend", "vitals", { hr_bpm: 130, spo2_pct: 89, temp_c: 39.0 }));
  await post("/ingest", R("watch-0041", "l4-coke-yard", "button", { button: "help" }));
  await post("/ingest", R("watch-0042", "l8-bore-bend", "button", { button: "help" }));
  const q = await get("/queue");
  assert.strictEqual(q[0].device, "watch-0042", "the sicker person is first");
  assert.ok(q[0].score > q[1].score);
  const d = await post("/dispatch", { responder: "rover-01", block: "l1-winch-gallery" });
  assert.strictEqual(d.body.assigned.device, "watch-0042");
  assert.ok((await get("/inbox?device=watch-0042")).some((a) => /rover-01 sent/.test(a.values.text)));
  assert.strictEqual((await get("/queue"))[0].device, "watch-0041", "dispatched request leaves the queue");
  // ties: equal scores -> nearest level to the responder
  const q2 = [{ id: "a", block: "l8-bore-bend", score: 50, time: iso(0) }, { id: "b", block: "l2-chalk-gallery", score: 50, time: iso(1) }];
  assert.strictEqual(L.pickRequest(q2, "l1-winch-gallery").id, "b");
});

test("tunnels and floods close routes", async () => {
  await post("/ingest", R("rover-01", "l7-chalk-cut", "tunnel", { status: "closed", photo_url: "x.jpg" }));
  await post("/ingest", R("sensor", "l7-chalk-cut", "flood", { depth_cm: 22 }));
  const t = (await get("/history?kind=alert&block=l7-chalk-cut")).map((a) => a.values.text).join(" | ");
  assert.match(t, /Tunnel closed/); assert.match(t, /Flooding/);
});

test("live feed: the twin receives a reading within a second", async () => {
  const ctrl = new AbortController();
  const res = await fetch(API + "/feed", { signal: ctrl.signal });
  const reader = res.body.getReader();
  const r = R("sensor", "l2-chalk-gallery", "air", { co2_ppm: 777 });
  const t0 = Date.now();
  setTimeout(() => post("/ingest", r), 100);
  let buf = "";
  while (!buf.includes(r.id)) buf += new TextDecoder().decode((await reader.read()).value);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  ctrl.abort();
});

test("load: 2,000-reading backlog and 50 relays posting at once", async () => {
  const big = Array.from({ length: 2000 }, (_, i) => R("relay", "l4-coke-yard", "air", { co2_ppm: 800 + (i % 50) }, Date.now() - i * 1000));
  let t0 = Date.now();
  const r = await post("/ingest", big);
  assert.strictEqual(r.body.added, 2000);
  const backlogMs = Date.now() - t0;
  t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => post("/ingest", R("sensor", BLOCK_IDS[i], "air", { co2_ppm: 700 }))));
  assert.ok(rs.every((x) => x.body.added === 1));
  console.log(`    2,000 backlog: ${backlogMs} ms, 50 parallel posts: ${Date.now() - t0} ms`);
  assert.ok(backlogMs < 3000);
});

test("restart: readings, families, official counts and dispatches survive a crash", async () => {
  const before = (await get("/history")).length;
  await stopServer(); await startServer();
  assert.strictEqual((await get("/history")).length, before);
  assert.ok((await get("/family?group=fam-0011")).length === 2);
  assert.strictEqual((await get("/truth")).blocks.find((r) => r.block === "l8-bore-bend").official, 2);
  assert.ok(!(await get("/queue")).some((x) => x.device === "watch-0042"), "dispatched stays dispatched");
  const old = (await get("/history?kind=air"))[0]; // a reading stored before the restart
  assert.strictEqual((await post("/ingest", old)).body.dupes, 1, "a relay re-sending after a restart is still dropped");
});
