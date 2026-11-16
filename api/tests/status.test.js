// Task 7: GET /status, the one call the twin polls every few seconds.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeServer } = require("./helper");
const S = require("../sign");

const keysFile = path.join(os.tmpdir(), `ht-status-keys-${process.pid}.json`);
fs.writeFileSync(keysFile, JSON.stringify({ "relay-07": "status-test-key" }));
const s = makeServer({ KEYS: keysFile });
before(() => s.start());
after(async () => { await s.cleanup(); fs.rmSync(keysFile, { force: true }); });
const H = 3600e3;

test("a fresh, empty server: every section is present and empty, nothing throws", async () => {
  const st = await s.get("/status");
  assert.deepStrictEqual(Object.keys(st).sort(), ["alerts", "blocks", "feed_clients", "forecast", "queue", "readings", "seq", "surface", "time", "truth"]);
  assert.deepStrictEqual(st.forecast, []);
  assert.deepStrictEqual(st.alerts, { window_min: 60, count: 0, by_level: { info: 0, warn: 0, danger: 0 }, latest: [] });
  assert.deepStrictEqual(st.queue, { length: 0, top: null });
  assert.deepStrictEqual([st.truth.residents_total, st.truth.official_total, st.truth.gap], [0, 0, 0]);
  assert.strictEqual(st.surface.verdict, "not enough data");
  assert.deepStrictEqual(st.blocks, {});
  assert.deepStrictEqual(st.readings, { total: 0, verified: 0, unverified: 0, live: 0, simulated: 0 });
  assert.strictEqual(st.seq, 0);
});

test("one poll shows forecast, alerts, queue, truth, surface, live vs simulated and verified counts", async () => {
  const now = Date.now(), deep = "L8-deepwell-03", market = "L2-market-01";
  // deepwell: a real relay, signed and live, draining 15 %/h with the grid sagging
  const power = [0, 1, 2, 3].map((i) => s.R("relay-07", deep, "power", { battery_pct: 60 - 15 * i, grid_hz: 59.9 }, now - (3 - i) * H, { source: "live" }));
  await s.post("/ingest", power.map((r) => ({ ...r, sig: S.sign(r, "status-test-key") })));
  // market: scripted (simulated, unsigned) air and a sick resident asking for help
  await s.post("/ingest", s.R("sensor-02", market, "air", { co2_ppm: 1500 }));
  await s.post("/ingest", s.R("watch-21", market, "vitals", { hr_bpm: 125, spo2_pct: 90, temp_c: 39.2 }));
  await s.post("/ingest", s.R("watch-21", market, "button", { button: "help" }));
  await s.post("/ingest", s.R("watch-22", market, "button", { button: "help" }));
  for (const d of ["watch-23", "watch-24"]) await s.post("/ingest", s.R(d, market, "button", { button: "symptom" }));
  await s.post("/official", { block: market, count: 1 });
  await s.post("/ingest", s.R("scout-01", "L0-crown-01", "surface", { co2_ppm: 430, o2_pct: 20.9, temp_c: 18, pm25_ugm3: 12, radiation_usv_h: 2.1 }));

  const st = await s.get("/status");
  // forecast per block
  const f = st.forecast.find((x) => x.block === deep);
  assert.ok(f.hours_left < 8 && f.grid_stress === true, JSON.stringify(f));
  // alerts in the last hour, newest first, with counts by level
  assert.strictEqual(st.alerts.count, st.alerts.latest.length);
  assert.strictEqual(st.alerts.count, st.alerts.by_level.info + st.alerts.by_level.warn + st.alerts.by_level.danger);
  const texts = st.alerts.latest.map((a) => a.values.text).join(" | ");
  assert.match(texts, /power cut likely soon/); assert.match(texts, /h of battery left/);
  assert.match(texts, /Air going stale/); assert.match(texts, /Help requested by watch-21/);
  assert.match(texts, /Surface verdict: sealed domes needed/);
  assert.ok(st.alerts.latest[0].seq > st.alerts.latest[st.alerts.latest.length - 1].seq, "newest first");
  // queue length and the top request (the sicker person), with its reasons
  assert.strictEqual(st.queue.length, 2);
  assert.strictEqual(st.queue.top.device, "watch-21");
  assert.ok(st.queue.top.reasons.length >= 3);
  // truth totals: watch-21 (low oxygen), 23 and 24 (symptoms) vs the official 1
  assert.deepStrictEqual([st.truth.residents_total, st.truth.official_total, st.truth.gap], [3, 1, 2]);
  // surface verdict with reasons
  assert.strictEqual(st.surface.verdict, "sealed domes needed");
  assert.match(st.surface.reasons[0], /radiation 2\.1 µSv\/h is above 1 µSv\/h/);
  // live vs simulated per block
  assert.strictEqual(st.blocks[deep].source, "live");
  assert.deepStrictEqual(st.blocks[deep].live_kinds, ["power"]);
  assert.strictEqual(st.blocks[market].source, "simulated");
  assert.deepStrictEqual(st.blocks[market].simulated_kinds, ["air", "button", "vitals"]);
  assert.strictEqual(st.blocks["L0-crown-01"].source, "simulated");
  // verified vs unverified (alerts are not counted: they are the backend's own)
  assert.deepStrictEqual(st.readings, { total: 11, verified: 4, unverified: 7, live: 4, simulated: 7 });
  assert.strictEqual(st.seq, (await s.get("/history")).length, "seq is the newest event id");
});

test("alerts older than an hour drop out of /status but stay in /history", async () => {
  // rewrite one alert in the data file to be 2 hours old, as if the server had been running that long
  const before = (await s.get("/status")).alerts.count;
  await s.stop();
  const lines = fs.readFileSync(s.data, "utf8").split("\n");
  const i = lines.findIndex((l) => l.includes('"kind":"alert"') && l.includes("Air going stale"));
  const a = JSON.parse(lines[i]);
  a.time = new Date(Date.now() - 2 * H).toISOString();
  lines[i] = JSON.stringify(a);
  fs.writeFileSync(s.data, lines.join("\n"));
  await s.start();
  const st = await s.get("/status");
  assert.strictEqual(st.alerts.count, before - 1);
  assert.ok(!st.alerts.latest.some((x) => /Air going stale/.test(x.values.text)));
  assert.ok((await s.get("/history?kind=alert")).some((x) => /Air going stale/.test(x.values.text)));
  assert.strictEqual(st.queue.length, 2, "and the rest of the state survived the restart");
  assert.strictEqual(st.readings.verified, 4);
});

test("/status stays fast with a large history (it is polled every few seconds)", async () => {
  const big = Array.from({ length: 3000 }, (_, i) => s.R("sensor-09", `L${i % 9}-load-01`, "air", { co2_ppm: 600 + (i % 30) }, Date.now() - i * 1000));
  await s.post("/ingest", big);
  const t0 = Date.now();
  const st = await s.get("/status");
  const ms = Date.now() - t0;
  assert.strictEqual(st.readings.total, 3011);
  assert.ok(ms < 1000, `/status took ${ms} ms`);
});
