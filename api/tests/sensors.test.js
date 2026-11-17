// Bad sensors (ported from lane1-wip): impossible values, jumps and drift. A reading that fails a check is stored with
// plausible: false and a sensor_error reason, raises no alert, and is left out of all logic. Every range, step and
// drift limit is a design choice in shared/limits.json.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeServer, ROOT } = require("./helper");
const SENS = require("../sensors");

const limits = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/limits.json"), "utf8")).limits;
const s = makeServer({ RATE_LIMIT: "1000" });
before(() => s.start());
after(() => s.cleanup());
const MIN = 60e3;
const stored = async (id) => (await s.get("/history")).find((r) => r.id === id);
const alertsFor = async (b) => s.get(`/history?kind=alert&block=${b}`);
const causedBy = async (id) => (await s.get("/history?kind=alert")).filter((a) => a.values.cause === id);

test("every range, step and drift limit is a design choice with a reason, and covers the contract's numeric values", () => {
  const keys = Object.keys(limits).filter((k) => /^(plausible|jump|drift)_/.test(k));
  assert.ok(keys.length >= 36, `${keys.length} sensor limits`);
  for (const k of keys) assert.ok(limits[k].type === "design choice" && limits[k].reason.length > 20, k);
  for (const [kind, fields] of [["vitals", ["hr_bpm", "spo2_pct", "temp_c"]], ["air", ["co2_ppm", "temp_c", "humidity_pct"]], ["water", ["tds_ppm", "turbidity_ntu"]],
    ["flood", ["depth_cm"]], ["power", ["battery_wh", "draw_w", "supply_w", "grid_hz", "battery_pct"]], ["surface", ["co2_ppm", "temp_c", "radiation_usv_h", "o2_pct", "pm25_ugm3"]]])
    for (const f of fields) assert.ok(limits[`plausible_${kind}_${f}`], `plausible_${kind}_${f}`);
  assert.deepStrictEqual(SENS.keysFor("drift", "water").map((x) => x[1]).sort(), ["tds_ppm", "turbidity_ntu"]);
  assert.deepStrictEqual(limits.plausible_vitals_spo2_pct.value, [0, 100]);
  assert.strictEqual(limits.plausible_vitals_spo2_pct.op, "outside");
});

test("impossible values: stored with plausible false and a sensor_error, no alert, left out of all logic", async () => {
  const b = "l5-ash-court";
  const cases = [
    s.R("watch-0501", b, "vitals", { hr_bpm: 80, spo2_pct: 104, temp_c: 36.7 }),
    s.R("watch-0502", b, "vitals", { hr_bpm: 300, spo2_pct: 98, temp_c: 36.7 }),
    s.R("sensor", b, "flood", { depth_cm: -3 }),
    s.R("sensor", b, "water", { tds_ppm: 1450, turbidity_ntu: -1 }), // over the do-not-drink line, but the probe is broken
    s.R("sensor", b, "air", { co2_ppm: 9000, temp_c: 24, humidity_pct: 140 }),
    s.R("relay", b, "power", { battery_wh: -5, draw_w: 100, supply_w: 0 }),
    s.R("surface-01", "surface", "surface", { co2_ppm: 430, temp_c: 17, radiation_usv_h: -0.2 }),
  ];
  const r = await s.post("/ingest", cases);
  assert.deepStrictEqual([r.status, r.body.accepted, r.body.rejected], [200, 7, []], "kept, not rejected");
  assert.strictEqual(r.body.warnings.length, 7);
  assert.match(r.body.warnings[0].warnings[0], /^sensor error, stored but not used: SpO2 104 % is outside 0 to 100 % \(design choice: /);
  for (const m of cases) {
    const got = await stored(m.id);
    assert.strictEqual(got.plausible, false, m.id);
    assert.ok(got.sensor_error.includes("outside"), got.sensor_error);
    assert.strictEqual(got.sensor_flags[0].type, "range", m.id);
  }
  assert.match((await stored(cases[3].id)).sensor_error, /turbidity -1 NTU is outside 0 to 4000 NTU/);
  // no alert of any kind came from them: no do-not-drink, no air, no flood, no battery
  assert.deepStrictEqual(await alertsFor(b), []);
  assert.deepStrictEqual(await alertsFor("surface"), []);
  // and nothing downstream saw them
  const nothing = async () => {
    assert.deepStrictEqual((await s.get(`/blocks/${b}/latest`)).latest, {}, "not the latest message of any kind");
    assert.ok(!(await s.get("/blocks")).some((x) => x.block === b), "/blocks");
    assert.deepStrictEqual(await s.get(`/forecast?block=${b}`), [{ block: b, battery_wh: null, draw_w: null, supply_w: null, net_drain_w: null, hours_left: null, method: null, level: "unknown", dark: false, grid_hz: null, grid_stress: false, reasons: [], time: null, source: null }]);
    assert.strictEqual((await s.get("/surface")).verdict, "not enough data", "a broken radiation reading does not count");
    assert.strictEqual((await s.get("/fairshare?supply_pct=60")).measured.length, 0);
    const st = await s.get("/status");
    assert.deepStrictEqual([st.readings.total, st.readings.implausible, st.blocks[b]], [7, 7, undefined]);
  };
  await nothing();
  // the broken watch's wearer: not sick (spo2 104 is not "low oxygen"), and a help press is triaged without the bad vitals
  await s.post("/ingest", s.R("watch-0501", b, "button", { button: "help" }));
  const q = (await s.get("/help")).find((x) => x.device === "watch-0501");
  assert.deepStrictEqual([q.vitals, q.score], [null, limits.triage_base_points.value]);
  assert.strictEqual((await s.get("/truth")).residents_total, 0);
  // the record still shows them, marked
  const rec = (await s.get("/surface/history")).find((e) => e.id === cases[6].id);
  assert.deepStrictEqual([rec.plausible, typeof rec.sensor_error], [false, "string"]);
  // a sender cannot clear the mark itself, nor mark a good reading
  const liar = { ...s.R("watch-0503", b, "vitals", { hr_bpm: 80, spo2_pct: 101, temp_c: 36.7 }), plausible: true };
  const framed = { ...s.R("watch-0504", "l5-rail-face", "vitals", { hr_bpm: 80, spo2_pct: 97, temp_c: 36.7 }), plausible: false, sensor_error: "x" };
  await s.post("/ingest", [liar, framed]);
  assert.strictEqual((await stored(liar.id)).plausible, false);
  assert.deepStrictEqual([(await stored(framed.id)).plausible, (await stored(framed.id)).sensor_error], [undefined, undefined]);
  // after a restart, the same: still stored, still left out
  await s.restart();
  assert.strictEqual((await stored(cases[0].id)).plausible, false);
  assert.deepStrictEqual((await s.get(`/blocks/${b}/latest`)).latest.button.device, "watch-0501");
  assert.deepStrictEqual(Object.keys((await s.get(`/blocks/${b}/latest`)).latest), ["button"]);
});

test("jumps: a step faster than the world changes is a sensor error; a second reading at the new level confirms it", async () => {
  const b = "l4-pitch-row", t0 = Date.now() - 120 * MIN;
  const w = (spo2, min) => s.R("watch-0601", b, "vitals", { hr_bpm: 80, spo2_pct: spo2, temp_c: 36.7 }, t0 + min * MIN);
  const latestVitals = async () => (await s.get(`/blocks/${b}/latest`)).latest.vitals.id;
  const sick = async () => ((await s.get("/truth")).blocks.find((x) => x.block === b) || { residents: 0 }).residents;
  const [a1, a2, a3] = [w(97, 0), w(96, 1), w(70, 2)];
  const r = await s.post("/ingest", [a1, a2, a3]);
  assert.strictEqual((await stored(a2.id)).plausible, undefined, "a one-point change is not a jump");
  const got = await stored(a3.id);
  assert.strictEqual(got.plausible, false);
  assert.match(got.sensor_error, /^SpO2 jumped from 96 to 70 % in 60 s: a step of 26 % is above 15 % \(design choice: /);
  const f = got.sensor_flags[0];
  assert.deepStrictEqual([f.type, f.field, f.from, f.to, f.step, f.previous, f.limit.key], ["jump", "spo2_pct", 96, 70, 26, a2.id, "jump_vitals_spo2_pct"]);
  assert.match(r.body.warnings.find((x) => x.id === a3.id).warnings[0], /^sensor error, stored but not used: SpO2 jumped from 96 to 70/);
  // left out: not latest, not counted as low oxygen, no alert
  assert.strictEqual(await latestVitals(), a2.id);
  assert.strictEqual(await sick(), 0);
  assert.deepStrictEqual(await alertsFor(b), []);

  // a spike: the next reading is back near the last good one and counts
  const a4 = w(95, 3);
  await s.post("/ingest", a4);
  assert.strictEqual((await stored(a4.id)).plausible, undefined);
  assert.strictEqual(await latestVitals(), a4.id);

  // a real step: the first reading at the new level is held back, the second (close to it) confirms it and counts
  const [a5, a6] = [w(70, 4), w(71, 5)];
  await s.post("/ingest", a5);
  assert.strictEqual((await stored(a5.id)).plausible, false, "the first reading after the step");
  await s.post("/ingest", a6);
  assert.strictEqual((await stored(a6.id)).plausible, undefined, "confirmed by the reading before it: the world moved");
  assert.deepStrictEqual([await latestVitals(), await sick()], [a6.id, 1], "the wearer now counts as low oxygen");
  // a reading more than an hour after the last good one is never a jump
  const late = w(40, 5 + 61);
  await s.post("/ingest", late);
  assert.strictEqual((await stored(late.id)).plausible, undefined, "more than jump_max_gap_min apart: not consecutive");

  // a backlog that arrives out of order is judged in time order
  const c = "l4-flint-gallery";
  const air = (co2, min) => s.R("sensor", c, "air", { co2_ppm: co2, temp_c: 24, humidity_pct: 50 }, t0 + min * MIN);
  const [b1, b2, b3] = [air(800, 0), air(850, 1), air(9000, 2)];
  await s.post("/ingest", [b3, b1, b2]);
  assert.strictEqual((await stored(b2.id)).plausible, undefined);
  assert.match((await stored(b3.id)).sensor_error, /^CO2 jumped from 850 to 9000 ppm/);
  assert.deepStrictEqual(await alertsFor(c), [], "the held-back reading raised no air alert");
  // a fire is real: the next reading confirms it, and the danger alert goes out one reading late
  const b4 = air(9100, 3);
  await s.post("/ingest", b4);
  assert.strictEqual((await stored(b4.id)).plausible, undefined);
  assert.ok((await causedBy(b4.id)).some((a) => /Air unsafe/.test(a.values.text)));

  // the clean-cup, salty-cup demo is not a jump
  const d = "l3-ember-yard";
  await s.post("/ingest", [s.R("sensor", d, "water", { tds_ppm: 240, turbidity_ntu: 0.8 }, t0), s.R("sensor", d, "water", { tds_ppm: 1450, turbidity_ntu: 1.1 }, t0 + 1)]);
  assert.ok((await alertsFor(d)).some((a) => /Do not drink/.test(a.values.text)));
  // the step limits are the ones in limits.json: exactly the limit is not above it (jumps(new reading, last good one);
  // lane1-wip's version of this line passed them the other way round, so it could never fail)
  assert.strictEqual(SENS.jumps(air(800 + limits.jump_air_co2_ppm.value, 1), air(800, 0)).length, 0);
  assert.strictEqual(SENS.jumps(air(801 + limits.jump_air_co2_ppm.value, 1), air(800, 0)).length, 1);
});

test("drift: a sensor moving steadily away from the other sensors of its kind on its level is a sensor error", async () => {
  // L6: four air sensors reading about 900 ppm; the one in l6-chalk-bend climbs 400 ppm a reading
  const peers = ["l6-seam-wells", "l6-damp-court", "l6-pitch-face", "l6-flint-face"], odd = "l6-chalk-bend", t0 = Date.now() - 30 * MIN;
  const air = (b, co2, min, extra = {}) => s.R("sensor", b, "air", { co2_ppm: co2, temp_c: 25, humidity_pct: 60, ...extra }, t0 + min * MIN);
  await s.post("/ingest", peers.flatMap((b, i) => [air(b, 880 + i * 10, 0), air(b, 890 + i * 10, 5)]));
  const steps = [900, 1300, 1700, 2100, 2500].map((co2, i) => air(odd, co2, i * 5));
  for (const m of steps.slice(0, 3)) await s.post("/ingest", m);
  for (const m of steps.slice(0, 3)) assert.strictEqual((await stored(m.id)).plausible, undefined, "three readings are not enough to call it drift");
  await s.post("/ingest", steps[3]);
  const got = await stored(steps[3].id);
  assert.strictEqual(got.plausible, false);
  const f = got.sensor_flags[0];
  assert.deepStrictEqual([f.type, f.field, f.value, f.level_median, f.others, f.deviation, f.readings, f.limit.key], ["drift", "co2_ppm", 2100, 905, 4, 1195, 4, "drift_air_co2_ppm"]);
  assert.match(got.sensor_error, /^CO2 has moved away from the other 4 air sensors on L6 over its last 4 readings \(900 -> 1300 -> 1700 -> 2100 against their median 905 ppm\): 1195 ppm off is above 500 ppm \(design choice: /);
  assert.deepStrictEqual(await causedBy(steps[3].id), [], "no alert: not the stale-air warning, not a sensor alert");
  assert.strictEqual((await s.get(`/blocks/${odd}/latest`)).latest.air.id, steps[2].id, "the last reading before the drift is still the latest");
  // still climbing: still an error; the peers themselves are fine
  await s.post("/ingest", steps[4]);
  assert.strictEqual((await stored(steps[4].id)).plausible, false);
  for (const b of peers) assert.ok((await s.get(`/history?block=${b}&kind=air`)).every((m) => m.plausible === undefined), b);
  // a sensor that is far off but steady, or moving back toward the others, is not drifting
  const steady = "l6-slag-face";
  for (let i = 0; i < 5; i++) await s.post("/ingest", air(steady, 1600, i * 5));
  assert.ok((await s.get(`/history?block=${steady}&kind=air`)).every((m) => m.plausible === undefined), "far off but not moving: not drift");
  const back = "l6-rail-row";
  for (const [i, co2] of [2500, 2100, 1700, 1300].entries()) await s.post("/ingest", air(back, co2, i * 5));
  assert.ok((await s.get(`/history?block=${back}&kind=air`)).every((m) => m.plausible === undefined), "moving toward the others is not drift");
  // with no other sensor of that kind on the level there is nothing to drift from
  const alone = "l0-rail-wells";
  for (const [i, co2] of [900, 1400, 1900, 2400].entries()) await s.post("/ingest", air(alone, co2, i * 5));
  assert.ok((await s.get(`/history?block=${alone}&kind=air`)).every((m) => m.plausible === undefined));
  const st = await s.get("/status");
  assert.ok(st.readings.implausible >= 2, `sensor errors are counted (${st.readings.implausible})`);
});
