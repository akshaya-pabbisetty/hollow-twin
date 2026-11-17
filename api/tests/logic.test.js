// Task 3: the logic runs on contract data. Forecast from battery_wh / (draw_w - supply_w) with the slope fallback,
// the optional grid_hz warning, fair share with measured draw, and check-ins routed to `to` and the family group.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { makeServer, readEvents } = require("./helper");
const L = require("../logic");

const s = makeServer();
before(() => s.start());
after(() => s.cleanup());
const H = 3600e3;
const forecast = async (b) => (await s.get(`/forecast?block=${b}`))[0];
const batteryAlerts = async (b) => (await s.get(`/history?kind=alert&block=${b}`)).filter((a) => a.values.hours_left !== undefined);
const power = (b, values, hoursAgo = 0, extra = {}) => s.post("/ingest", s.R("relay", b, "power", values, Date.now() - hoursAgo * H, extra));

test("forecast, main method: the contract's power sample gives 412 / (96 - 40) = 7.4 h, an alarm", async () => {
  const b = "l8-bore-bend";
  await power(b, { battery_wh: 412, draw_w: 96, supply_w: 40 });
  const f = await forecast(b);
  assert.deepStrictEqual([f.battery_wh, f.draw_w, f.supply_w, f.net_drain_w, f.hours_left, f.method, f.level, f.dark], [412, 96, 40, 56, 7.4, "net drain", "alarm", false]);
  const [a] = await batteryAlerts(b);
  assert.deepStrictEqual([a.values.level, a.values.text, a.values.forecast_level, a.values.method], ["danger", `${b} has about 7 h of battery left`, "alarm", "net drain"]);
  assert.strictEqual((await batteryAlerts(b)).length, 1, "straight to the alarm: no separate warning for the same reading");
});

test("forecast: supply covering the draw means not draining; an empty battery with supply short means dark", async () => {
  const b = "l8-gantry-bend";
  await power(b, { battery_wh: 800, draw_w: 90, supply_w: 120 }, 3);
  let f = await forecast(b);
  assert.deepStrictEqual([f.hours_left, f.level, f.net_drain_w], [null, "ok", -30]);
  assert.match(f.reasons[0], /supply 120 W covers the draw of 90 W: the battery is not draining/);
  assert.strictEqual((await batteryAlerts(b)).length, 0);
  await power(b, { battery_wh: 0, draw_w: 90, supply_w: 30 }, 0);
  f = await forecast(b);
  assert.deepStrictEqual([f.hours_left, f.level, f.dark], [0, "alarm", true]);
  const [a] = await batteryAlerts(b);
  assert.deepStrictEqual([a.values.level, a.values.text, a.values.dark], ["danger", `${b} is dark: its battery is empty`, true]);
  assert.match(a.values.why, /battery empty and supply 30 W is below the draw of 90 W: the block is dark/);
  // no supply_w at all = running on the battery alone
  const c = "l8-winch-wells";
  await power(c, { battery_wh: 3000, draw_w: 100 });
  assert.deepStrictEqual([(await forecast(c)).hours_left, (await forecast(c)).supply_w], [30, null]);
});

test("forecast: each level is told once per slide down, and again only after a clear recovery", async () => {
  const b = "l7-pylon-yard";
  const step = async (battery_wh, supply_w, hoursAgo) => { await power(b, { battery_wh, draw_w: 100, supply_w }, hoursAgo); return (await batteryAlerts(b)).length; };
  assert.strictEqual(await step(2300, 0, 12), 1, "23 h: warning");
  assert.strictEqual(await step(2250, 0, 11.5), 1, "22.5 h: still the same warning");
  assert.strictEqual(await step(2450, 0, 11), 1, "24.5 h: back over the line but inside the 2 h margin, so not re-armed");
  assert.strictEqual(await step(2350, 0, 10.5), 1, "23.5 h: hovering at the line does not warn again");
  assert.strictEqual(await step(700, 0, 8), 2, "7 h: alarm");
  assert.strictEqual(await step(650, 0, 7.5), 2, "6.5 h: still the same alarm");
  assert.strictEqual(await step(650, 150, 7), 2, "supply is back: no alert for recovering");
  assert.strictEqual(await step(600, 0, 3), 3, "supply lost again at 6 h: a fresh alarm, because the block had recovered in between");
  assert.deepStrictEqual((await batteryAlerts(b)).map((a) => a.values.level), ["warn", "danger", "danger"]);
});

test("forecast, fallback: with no draw_w the battery level is fitted over time (slope), in Wh or in the optional percent", async () => {
  const wh = "l7-rivet-row", pct = "l7-ember-wells", one = "l7-flint-yard";
  // 900 -> 600 Wh over 3 hours = 100 W, so 600 / 100 = 6 h left
  for (const [i, level] of [900, 800, 700, 600].entries()) await power(wh, { battery_wh: level }, 3 - i);
  let f = await forecast(wh);
  assert.deepStrictEqual([f.method, f.hours_left, f.net_drain_w, f.level, f.draw_w], ["slope", 6, 100, "alarm", null]);
  assert.match(f.reasons[0], /battery 600 Wh falling 100\.00 Wh\/h over the last 4 readings gives 6 h left/);
  // a relay that only knows its charge in percent: 90% -> 60% over 3 hours = 10 %/h, so 6 h left
  for (const [i, level] of [90, 80, 70, 60].entries()) await power(pct, { battery_pct: level }, 3 - i);
  f = await forecast(pct);
  assert.deepStrictEqual([f.method, f.hours_left, f.battery_pct, f.drain_pct_per_h, f.battery_wh], ["slope", 6, 60, -10, null]);
  assert.strictEqual((await batteryAlerts(pct)).filter((a) => a.values.method === "slope").length >= 1, true, "the fallback raises the same alerts");
  // one reading with no draw is not enough for either method
  await power(one, { battery_wh: 500 });
  f = await forecast(one);
  assert.deepStrictEqual([f.method, f.hours_left, f.level, f.battery_wh], [null, null, "unknown", 500]);
  // the main method takes over as soon as a reading carries draw_w
  await power(wh, { battery_wh: 600, draw_w: 50, supply_w: 0 }, 0);
  f = await forecast(wh);
  assert.deepStrictEqual([f.method, f.hours_left], ["net drain", 12]);
});

test("grid hum: the optional grid_hz on a contract power message still gives the early warning", async () => {
  const b = "l6-seam-wells", steady = { battery_wh: 5000, draw_w: 120, supply_w: 120 };
  await power(b, { ...steady, grid_hz: 59.99 }, 0.3);
  await power(b, steady, 0.2); // a relay without the hum sensor: nothing to say
  assert.strictEqual((await s.get(`/history?kind=alert&block=${b}`)).length, 0);
  await power(b, { ...steady, grid_hz: 59.9 }, 0.1);
  const [a] = await s.get(`/history?kind=alert&block=${b}`);
  assert.match(a.values.text, /Grid frequency 59\.9 Hz: power cut likely soon/);
  assert.strictEqual(a.values.limit.key, "grid_band_hz");
  const f = await forecast(b);
  assert.deepStrictEqual([f.grid_stress, f.hours_left, f.level], [true, null, "ok"], "warned while the battery is full and not draining");
  assert.strictEqual(typeof f.grid_hz, "number");
});

test("fair share: a block with a power reading uses its measured draw_w instead of the per-person estimate", async () => {
  const b = "l5-ash-court"; // 397,000 people: 39.7 MW by the estimate
  const before = (await s.get("/fairshare?supply_pct=60&measured=0")).fair;
  const est = before.blocks.find((x) => x.block === b);
  assert.deepStrictEqual([est.demand_w, est.critical_w, est.demand_source], [39700000, 17865000, "people"]);
  const m = s.R("relay", b, "power", { battery_wh: 9e9, draw_w: 50000000, supply_w: 50000000 }, Date.now(), { source: "live" });
  await s.post("/ingest", m);
  const r = await s.get("/fairshare?supply_pct=60");
  const row = r.fair.blocks.find((x) => x.block === b);
  assert.deepStrictEqual([row.demand_w, row.critical_w, row.demand_source], [50000000, 22500000, "power reading"], "measured draw, and the same 45% of it is critical");
  assert.deepStrictEqual(row.demand_reading, { id: m.id, device: m.device, time: m.time, source: "live" });
  assert.ok(r.fair.measured_blocks.includes(b));
  assert.ok(r.fair.blocks.filter((x) => x.block.startsWith("l0-")).every((x) => x.demand_source === "people"), "blocks without a reading keep the estimate");
  // a newer reading replaces it; measured=0 ignores readings altogether
  await s.post("/ingest", s.R("relay", b, "power", { battery_wh: 9e9, draw_w: 30000000, supply_w: 30000000 }, Date.now() + 1000));
  assert.strictEqual((await s.get("/fairshare?supply_pct=60")).fair.blocks.find((x) => x.block === b).demand_w, 30000000);
  assert.deepStrictEqual((await s.get("/fairshare?supply_pct=60&measured=0")).fair.blocks.find((x) => x.block === b), est);
});

test("fair share: supply_pct is a share of what the sector needs; bad requests are refused", async () => {
  const r = await s.get("/fairshare?supply_pct=60&measured=0");
  assert.strictEqual(r.fair.supply_w, Math.round(r.fair.demand_total_w * 0.6));
  assert.deepStrictEqual([r.fair.dark_blocks.length, r.directorate.dark_blocks.length], [0, 18]);
  assert.strictEqual((await s.get("/fairshare?supply_pct=100&measured=0&policy=directorate")).dark_blocks.length, 0);
  for (const bad of ["/fairshare", "/fairshare?supply_w=-5", "/fairshare?supply_pct=abc", "/fairshare?supply_pct=60&policy=mine"])
    assert.strictEqual((await s.getRaw(bad)).status, 400, bad);
  assert.strictEqual(L.sector([], true).every((b) => b.demand_source === "people"), true);
});

test("checkin: routed to the watches in `to` and to its family group, with hops and via, and to nobody else", async () => {
  const far = "l8-bore-bend";
  // watch-0110 is named directly; watch-0111 is registered in the family; watch-0112 joined by checking in itself
  await s.post("/family", { group: "fam-0007", devices: ["watch-0042", "watch-0111"] });
  await s.post("/ingest", s.R("watch-0112", "l2-damp-bend", "checkin", { status: "ok", family: "fam-0007", to: [] }, Date.now() - 60e3));
  const feed = readEvents(s.api + "/feed", { want: 2 });
  await new Promise((r) => setTimeout(r, 100));
  const c = s.R("watch-0042", far, "checkin", { status: "ok", family: "fam-0007", to: ["watch-0110"] }, Date.now(),
    { hops: 2, via: ["relay-l8-bore-bend", "relay-l8-gantry-bend"] });
  assert.strictEqual((await s.post("/ingest", c)).body.added, 1);
  const [msg, alert] = (await feed).map((e) => e.data);
  assert.deepStrictEqual([msg.kind, msg.hops, msg.via], ["checkin", 2, c.via], "the check-in itself goes out on the feed with its route");
  assert.strictEqual(alert.values.text, `watch-0042 is OK (${far})`);
  assert.deepStrictEqual(alert.values.to.slice().sort(), ["watch-0110", "watch-0111", "watch-0112"]);
  assert.deepStrictEqual([alert.values.family, alert.values.status, alert.values.hops, alert.values.via, alert.values.sent], ["fam-0007", "ok", 2, c.via, c.time]);
  assert.match(alert.values.why, /watch-0042 checked in for family group fam-0007, to watch-0110, relayed over 2 hops \(relay-l8-bore-bend > relay-l8-gantry-bend\)/);
  for (const w of ["watch-0110", "watch-0111", "watch-0112"]) assert.ok((await s.get(`/inbox?device=${w}`)).some((a) => a.id === alert.id), `${w} receives it`);
  for (const w of ["watch-0042", "watch-0999"]) assert.ok(!(await s.get(`/inbox?device=${w}`)).some((a) => a.id === alert.id), `${w} does not`);
  // the family view shows who has checked in, from where, and by what route
  const fam = Object.fromEntries((await s.get("/family?family=fam-0007")).map((m) => [m.device, m]));
  assert.deepStrictEqual(Object.keys(fam).sort(), ["watch-0042", "watch-0111", "watch-0112"]);
  assert.deepStrictEqual([fam["watch-0042"].last_ok, fam["watch-0042"].block, fam["watch-0042"].hops, fam["watch-0042"].via], [c.time, far, 2, c.via]);
  assert.strictEqual(fam["watch-0111"].last_ok, null);
  // a check-in with only `to` (no family) still reaches those watches; with nobody to tell, it is just stored
  const direct = s.R("watch-0500", "l3-flint-row", "checkin", { status: "ok", to: ["watch-0501"] });
  const alone = s.R("watch-0600", "l3-flint-row", "checkin", { status: "ok", family: "fam-0600", to: [] });
  await s.post("/ingest", [direct, alone]);
  assert.ok((await s.get("/inbox?device=watch-0501")).some((a) => a.values.cause === direct.id));
  assert.ok(!(await s.get("/history?kind=alert")).some((a) => a.values.cause === alone.id));
  // learned family members survive a restart (they are rebuilt from the stored check-ins)
  await s.restart();
  assert.deepStrictEqual((await s.get("/family?group=fam-0007")).map((m) => m.device).sort(), ["watch-0042", "watch-0111", "watch-0112"]);
});
