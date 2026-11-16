// End-to-end tests against a real running API. `node --test tests/`
// Each test maps to a shot in the demo video or a failure that would break it on camera.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const L = require("../logic");

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
  ({ id: `${device}-${++seq}`, device, block, time: iso(time), kind, values });
const post = (p, body) => fetch(API + p, { method: "POST", headers: { "Content-Type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body) }).then(async (r) => ({ status: r.status, body: await r.json() }));
const get = (p) => fetch(API + p).then((r) => r.json());

before(async () => { fs.rmSync(DATA, { force: true }); await startServer(); });
after(async () => { await stopServer(); fs.rmSync(DATA, { force: true }); });

test("format: valid readings stored, bad ones rejected with a reason", async () => {
  const ok = await post("/ingest", R("sensor-01", "L2-market-01", "air", { co2_ppm: 900 }));
  assert.strictEqual(ok.body.added, 1);
  const bad = await post("/ingest", [{ id: "x" }, { ...R("s", "b", "smell", {}) }, { ...R("s", "b", "air", {}), time: "yesterday" }]);
  assert.strictEqual(bad.status, 400);
  assert.deepStrictEqual(bad.body.errors.map((e) => e.err).sort(), ["bad time", "missing device", "unknown kind smell"]);
  assert.strictEqual((await post("/ingest", "{not json")).status, 400);
  assert.strictEqual((await post("/ingest", [null])).status, 400);
});

test("shot 3, warning: battery drain gives hours left and a watch warning under 8 h", async () => {
  const now = Date.now() - 3 * H, b = "L6-borebend-02"; // timeline ends at the real "now": readings from the future are rejected
  // 80% -> 70% over the last 2 hours = 5%/h, so 70/5 = 14 h left: no warning yet
  await post("/ingest", [0, 1, 2].map((i) => R("relay-06", b, "power", { battery_pct: 80 - 5 * i, draw_w: 40 }, now - (2 - i) * H)));
  let f = (await get(`/forecast?block=${b}`))[0];
  assert.ok(Math.abs(f.hours_left - 14) < 0.5, `expected ~14 h, got ${f.hours_left}`);
  // drain speeds up: 70 -> 40 in 3 more hours
  await post("/ingest", [1, 2, 3].map((i) => R("relay-06", b, "power", { battery_pct: 70 - 10 * i, draw_w: 80 }, now + i * H)));
  f = (await get(`/forecast?block=${b}`))[0];
  assert.ok(f.hours_left < 8, `expected under 8 h, got ${f.hours_left}`);
  const alerts = (await get(`/history?kind=alert&block=${b}`)).filter((a) => a.values.hours_left !== undefined);
  assert.strictEqual(alerts.length, 1, "warns once, not on every reading");
  assert.match(alerts[0].values.text, /h of battery left/);
});

test("hum upgrade: grid frequency sag warns BEFORE any battery is used", async () => {
  const b = "L5-rivet-01";
  await post("/ingest", R("relay-05", b, "power", { battery_pct: 100, draw_w: 0, grid_hz: 60.01 }));
  assert.strictEqual((await get(`/history?kind=alert&block=${b}`)).length, 0, "normal hum: no alert");
  await post("/ingest", R("relay-05", b, "power", { battery_pct: 100, draw_w: 0, grid_hz: 59.71 }));
  const a = await get(`/history?kind=alert&block=${b}`);
  assert.strictEqual(a.length, 1);
  assert.match(a[0].values.text, /power cut likely soon/);
  assert.strictEqual((await get(`/forecast?block=${b}`))[0].battery_pct, 100, "battery still full when the warning fires");
});

test("shot 4, fair share: Directorate darkens deep levels, fair share darkens none", async () => {
  const r = await get("/fairshare?supply_w=9000"); // sector demand is 16,000 W, critical 4,750 W
  assert.ok(r.directorate.dark_blocks.length >= 3, `Directorate dark: ${r.directorate.dark_blocks}`);
  assert.ok(r.directorate.dark_blocks.every((b) => L.levelOf(b) >= 5), "only deep levels go dark");
  assert.deepStrictEqual(r.fair.dark_blocks, [], "fair share: nobody loses air or pumps");
  assert.ok(r.fair.equity_index > r.directorate.equity_index);
  const total = r.fair.blocks.reduce((s, b) => s + b.served_w, 0);
  assert.ok(Math.abs(total - 9000) <= 9, `fair share uses all supply, used ${total}`);
});

test("fair share edge cases: below critical, above demand, zero", () => {
  const S = JSON.parse(fs.readFileSync(path.join(__dirname, "../shared/sector.json"))).blocks;
  const low = L.allocate(S, 2000, "fair");               // less than critical load
  assert.ok(low.blocks.every((b) => b.served_w > 0), "everyone gets a share of what exists");
  const high = L.allocate(S, 50000, "fair");
  assert.ok(high.blocks.every((b) => b.served_pct === 100) && high.dark_blocks.length === 0);
  const zero = L.allocate(S, 0, "fair");
  assert.strictEqual(zero.dark_blocks.length, 9);
});

test("shot 5, network dies: relay backlog arrives late and out of order, copies dropped, gap replays in order", async () => {
  const b = "L7-sump-03", t0 = Date.now() - 30 * 60e3;
  const held = [0, 1, 2, 3, 4].map((i) => R("sensor-07", b, "air", { co2_ppm: 900 + i }, t0 + i * 60e3));
  const shuffled = [held[3], held[0], held[4], held[1], held[2]];
  const first = await post("/ingest", shuffled);
  assert.strictEqual(first.body.added, 5);
  const copy = await post("/ingest", [held[1], held[2]]); // the same messages arriving via a second relay
  assert.strictEqual(copy.body.dupes, 2);
  const hist = await get(`/history?block=${b}&kind=air`);
  assert.deepStrictEqual(hist.map((r) => r.values.co2_ppm), [900, 901, 902, 903, 904]);
  assert.strictEqual(hist[0].time, held[0].time, "original reading times kept");
});

test("shot 5, families: 'I'm OK' from L1 reaches family on L7 only", async () => {
  await post("/family", { group: "rao", devices: ["watch-11", "watch-71"] });
  await post("/ingest", R("watch-11", "L1-gallery-02", "button", { type: "ok", to: "rao" }));
  const inbox = await get("/inbox?device=watch-71");
  assert.ok(inbox.some((a) => /watch-11 is OK/.test(a.values.text)));
  const stranger = await get("/inbox?device=watch-99");
  assert.ok(!stranger.some((a) => /is OK/.test(a.values.text)), "not delivered to strangers");
  const fam = await get("/family?group=rao");
  assert.ok(fam.find((m) => m.device === "watch-11").last_ok);
});

test("shot 6, bad water: salty cup -> do-not-drink reaches watches in that block", async () => {
  const b = "L3-farms-04";
  await post("/ingest", R("watch-31", b, "vitals", { hr: 75, spo2: 98, temp_c: 36.7 }));
  await post("/ingest", R("sensor-03", b, "water", { tds_ppm: 240, turbidity_ntu: 0.8 }));
  assert.ok(!(await get("/inbox?device=watch-31")).some((a) => /Do not drink/.test(a.values.text)), "clean water: silent");
  await post("/ingest", R("sensor-03", b, "water", { tds_ppm: 1450, turbidity_ntu: 1.1 }));
  assert.ok((await get("/inbox?device=watch-31")).some((a) => /Do not drink/.test(a.values.text)));
});

test("shot 7, truth: residents' count vs the Directorate's count", async () => {
  const b = "L8-deepwell-03";
  for (let i = 0; i < 6; i++) await post("/ingest", R(`watch-8${i}`, b, "button", { type: "symptom" }));
  for (let i = 0; i < 3; i++) await post("/ingest", R(`watch-9${i}`, b, "vitals", { hr: 96, spo2: 91, temp_c: 38.1 }));
  await post("/ingest", R("watch-80", b, "button", { type: "symptom" })); // same person twice counts once
  await post("/official", { block: b, count: 2 });
  const row = (await get("/truth")).blocks.find((r) => r.block === b);
  assert.deepStrictEqual([row.residents, row.official, row.gap], [9, 2, 7]);
});

test("shot 8, care: help requests ranked by vitals, top one dispatched, nearest on ties", async () => {
  await post("/ingest", R("watch-41", "L4-works-02", "vitals", { hr: 80, spo2: 97, temp_c: 36.8 }));
  await post("/ingest", R("watch-42", "L8-deepwell-03", "vitals", { hr: 130, spo2: 89, temp_c: 39.0 }));
  await post("/ingest", R("watch-41", "L4-works-02", "button", { type: "help" }));
  await post("/ingest", R("watch-42", "L8-deepwell-03", "button", { type: "help" }));
  const q = await get("/queue");
  assert.strictEqual(q[0].device, "watch-42", "the sicker person is first");
  assert.ok(q[0].score > q[1].score);
  const d = await post("/dispatch", { responder: "rover-01", block: "L1-gallery-02" });
  assert.strictEqual(d.body.assigned.device, "watch-42");
  assert.ok((await get("/inbox?device=watch-42")).some((a) => /rover-01 sent/.test(a.values.text)));
  assert.strictEqual((await get("/queue"))[0].device, "watch-41", "dispatched request leaves the queue");
  // ties: equal scores -> nearest level to the responder
  const q2 = [{ id: "a", block: "L8-x", score: 50, time: iso(0) }, { id: "b", block: "L2-x", score: 50, time: iso(1) }];
  assert.strictEqual(L.pickRequest(q2, "L1-x").id, "b");
});

test("tunnels and floods close routes", async () => {
  await post("/ingest", R("rover-01", "L7-sump-03", "tunnel", { status: "closed", photo_url: "x.jpg" }));
  await post("/ingest", R("sensor-07", "L7-sump-03", "flood", { depth_cm: 22 }));
  const t = (await get("/history?kind=alert&block=L7-sump-03")).map((a) => a.values.text).join(" | ");
  assert.match(t, /Tunnel closed/); assert.match(t, /Flooding/);
});

test("live feed: the twin receives a reading within a second", async () => {
  const ctrl = new AbortController();
  const res = await fetch(API + "/feed", { signal: ctrl.signal });
  const reader = res.body.getReader();
  const r = R("sensor-02", "L2-market-01", "air", { co2_ppm: 777 });
  const t0 = Date.now();
  setTimeout(() => post("/ingest", r), 100);
  let buf = "";
  while (!buf.includes(r.id)) buf += new TextDecoder().decode((await reader.read()).value);
  assert.ok(Date.now() - t0 < 1000, `took ${Date.now() - t0} ms`);
  ctrl.abort();
});

test("load: 2,000-reading backlog and 50 relays posting at once", async () => {
  const big = Array.from({ length: 2000 }, (_, i) => R("relay-big", "L4-works-02", "air", { co2_ppm: 800 + (i % 50) }, Date.now() - i * 1000));
  let t0 = Date.now();
  const r = await post("/ingest", big);
  assert.strictEqual(r.body.added, 2000);
  const backlogMs = Date.now() - t0;
  t0 = Date.now();
  const rs = await Promise.all(Array.from({ length: 50 }, (_, i) => post("/ingest", R(`relay-p${i}`, "L0-crown-01", "air", { co2_ppm: 700 }))));
  assert.ok(rs.every((x) => x.body.added === 1));
  console.log(`    2,000 backlog: ${backlogMs} ms, 50 parallel posts: ${Date.now() - t0} ms`);
  assert.ok(backlogMs < 3000);
});

test("restart: readings, families, official counts and dispatches survive a crash", async () => {
  const before = (await get("/history")).length;
  await stopServer(); await startServer();
  assert.strictEqual((await get("/history")).length, before);
  assert.ok((await get("/family?group=rao")).length === 2);
  assert.strictEqual((await get("/truth")).blocks.find((r) => r.block === "L8-deepwell-03").official, 2);
  assert.ok(!(await get("/queue")).some((x) => x.device === "watch-42"), "dispatched stays dispatched");
  const old = (await get("/history?kind=air"))[0]; // a reading stored before the restart
  assert.strictEqual((await post("/ingest", old)).body.dupes, 1, "a relay re-sending after a restart is still dropped");
});
