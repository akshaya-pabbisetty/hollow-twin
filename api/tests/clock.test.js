// The clock rule (CONTRACT.md section 1.3): a time ahead of the receive time is replaced by the receive time, and
// "latest" per block and kind is the greatest stored time, ties broken by seq. So a device with a fast clock cannot
// hold "latest", and a relay backlog that arrives late with older real times never replaces a fresher reading.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { makeServer } = require("./helper");
const O = require("../order");

const s = makeServer({ RATE_LIMIT: "1000" });
before(() => s.start());
after(() => s.cleanup());
const MIN = 60e3;
const vitals = (watch, b, spo2, time) => s.R(watch, b, "vitals", { hr_bpm: 80, spo2_pct: spo2, temp_c: 36.8 }, time);
const power = (b, battery, draw, supply, time) => s.R("relay", b, "power", { battery_wh: battery, draw_w: draw, supply_w: supply }, time);
const latestOf = async (b) => (await s.get(`/blocks/${b}/latest`)).latest;
const inBlocks = async (b, kind) => (await s.get("/blocks")).find((r) => r.block === b && r.kind === kind);

test("order.js: greatest time first, then the higher seq", () => {
  const a = { time: "2026-11-17T10:00:00Z", seq: 5 }, b = { time: "2026-11-17T10:00:00Z", seq: 9 }, c = { time: "2026-11-17T09:59:59Z", seq: 12 };
  assert.deepStrictEqual([c, b, a].sort(O.byTime), [c, a, b]);
  assert.deepStrictEqual([a, c, b].sort(O.newestFirst), [b, a, c]);
  assert.strictEqual(O.newest([a, b, c]), b, "equal times: the one stored last");
  assert.strictEqual(O.newest([b, a, c]), b, "whatever the array order");
  assert.ok(O.newer(a, undefined) && !O.newer(c, a) && O.newer(b, a) && !O.newer(a, b));
  assert.strictEqual(O.newest([]), undefined);
});

test("a fast-clock device cannot hold \"latest\": its time becomes the receive time, so the next honest reading wins", async () => {
  const b = "l3-ember-yard";
  // 4 minutes fast: under the old 5-minute tolerance this reading kept its time and was "latest" for 4 minutes
  const fast = vitals("watch-0701", b, 97, Date.now() + 4 * MIN);
  const sent = Date.now();
  await s.post("/ingest", fast);
  const got = (await s.get(`/history?block=${b}`)).find((r) => r.id === fast.id);
  assert.deepStrictEqual([got.time_estimated, got.device_time], [true, fast.time]);
  assert.ok(Date.parse(got.time) >= sent - 1000 && Date.parse(got.time) <= Date.now() + 1000, "stored with the receive time");
  // an honest watch measures after that (never before the fast reading's stored time; an equal time goes to the higher seq)
  const honest = vitals("watch-0702", b, 91, Math.max(Date.now(), Date.parse(got.time)));
  await s.post("/ingest", honest);
  assert.strictEqual((await latestOf(b)).vitals.id, honest.id, "/blocks/<id>/latest");
  assert.strictEqual((await inBlocks(b, "vitals")).id, honest.id, "/blocks");
  assert.strictEqual((await s.get("/status")).blocks[b].latest_device, "watch-0702", "/status");

  // the same for a relay whose clock was fast and is then fixed: the forecast follows the honest reading
  const c = "l3-flint-row";
  const wrong = power(c, 100, 500, 0, Date.now() + 4 * MIN);  // would be 0.2 h left: an alarm
  await s.post("/ingest", wrong);
  const wrongAt = Date.parse((await s.get(`/history?block=${c}`)).find((r) => r.id === wrong.id).time);
  const right = power(c, 9000, 100, 100, Math.max(Date.now(), wrongAt)); // not draining
  await s.post("/ingest", right);
  const f = (await s.get(`/forecast?block=${c}`))[0];
  assert.deepStrictEqual([f.battery_wh, f.level], [9000, "ok"]);
  assert.strictEqual((await latestOf(c)).power.id, right.id);
});

test("a late relay backlog with older real times never overwrites a fresher reading", async () => {
  const b = "l5-ash-court", now = Date.now();
  const fresh = { power: power(b, 9000, 100, 100, now - 1 * MIN), vitals: vitals("watch-0801", b, 98, now - 1 * MIN),
    surface: s.R("surface-01", "surface", "surface", { co2_ppm: 420, temp_c: 18, radiation_usv_h: 0.1 }, now - 1 * MIN) };
  await s.post("/ingest", Object.values(fresh));
  assert.strictEqual((await s.get("/surface")).verdict, "suits OK");
  const before = (await s.get("/history?kind=alert")).length;

  // the relay comes back online and posts its queue: older, real times, and every one of them worse than now
  const backlog = [30, 20, 10].flatMap((m) => [
    power(b, 50, 500, 0, now - m * MIN),
    vitals("watch-0801", b, 84, now - m * MIN),
    s.R("surface-01", "surface", "surface", { co2_ppm: 420, temp_c: 18, radiation_usv_h: 30 }, now - m * MIN),
  ]);
  const r = await s.post("/ingest", backlog);
  assert.strictEqual(r.body.accepted, 9);

  // stored and replayable in time order, after the fresh readings by seq but before them by time
  const hist = await s.get(`/history?block=${b}`);
  assert.deepStrictEqual(hist.filter((x) => x.kind === "power").map((x) => x.id), [...backlog.filter((x) => x.kind === "power").map((x) => x.id), fresh.power.id]);
  assert.ok(hist.find((x) => x.id === backlog[0].id).seq > hist.find((x) => x.id === fresh.power.id).seq);

  // but "latest" is still the fresh reading, everywhere
  const latest = await latestOf(b);
  assert.deepStrictEqual([latest.power.id, latest.vitals.id], [fresh.power.id, fresh.vitals.id], "/blocks/<id>/latest");
  assert.deepStrictEqual([(await inBlocks(b, "power")).id, (await inBlocks(b, "vitals")).id], [fresh.power.id, fresh.vitals.id], "/blocks");
  const f = (await s.get(`/forecast?block=${b}`))[0];
  assert.deepStrictEqual([f.battery_wh, f.level, f.time], [9000, "ok", fresh.power.time], "/forecast");
  assert.strictEqual((await s.get("/status")).blocks[b].latest_time, fresh.power.time, "/status");
  assert.strictEqual((await s.get("/fairshare?supply_pct=50")).measured.find((m) => m.block === b).battery_wh, 9000, "/fairshare measured");
  const sv = await s.get("/surface");
  assert.strictEqual(sv.verdict, "suits OK", "an old radiation reading does not change today's verdict");
  assert.strictEqual(sv.readings.find((x) => x.reading === "radiation_usv_h").value, 0.1);
  // and the backlog raised no battery alarm and no verdict change: both judge the latest reading, which is still fresh
  const alerts = (await s.get("/history?kind=alert")).slice(before);
  assert.deepStrictEqual(alerts.filter((a) => a.values.forecast_level || a.values.surface_verdict), []);

  // a help press is triaged with the newest vitals at the time of the press, not the backlog's
  await s.post("/ingest", s.R("watch-0801", b, "button", { button: "help" }));
  assert.strictEqual((await s.get("/help")).find((x) => x.device === "watch-0801").vitals.spo2_pct, 98);
});

test("equal times: the reading stored last (higher seq) is latest, in every view", async () => {
  const b = "l6-seam-wells", time = Date.now() - 5 * MIN;
  const first = power(b, 1000, 100, 100, time), second = power(b, 2000, 100, 100, time);
  await s.post("/ingest", first);
  await s.post("/ingest", second);
  assert.strictEqual((await latestOf(b)).power.id, second.id, "/blocks/<id>/latest");
  assert.strictEqual((await inBlocks(b, "power")).id, second.id, "/blocks (it used to keep the first on a tie)");
  assert.strictEqual((await s.get(`/forecast?block=${b}`))[0].battery_wh, 2000, "/forecast");
  const hist = (await s.get(`/history?block=${b}`)).map((x) => x.id);
  assert.deepStrictEqual(hist, [first.id, second.id], "/history: equal times in seq order");
});
