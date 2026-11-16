// Task 1: every threshold is sourced in shared/limits.json and every alert says which limit it crossed.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeServer, ROOT } = require("./helper");
const L = require("../logic");

const limits = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/limits.json"), "utf8")).limits;
const s = makeServer();
before(() => s.start());
after(() => s.cleanup());

test("limits.json: every safety fact has a source and url, every design choice has a reason", () => {
  for (const [key, l] of Object.entries(limits)) {
    assert.ok(l.value !== undefined && l.unit, `${key} needs value and unit`);
    assert.ok(["safety fact", "design choice"].includes(l.type), `${key} has type ${l.type}`);
    if (l.type === "safety fact") {
      assert.ok(l.source && /^https:\/\//.test(l.url), `${key} needs a source and an https url`);
      assert.strictEqual(typeof l.verified, "boolean", `${key} must say whether it was verified`);
    } else assert.ok(l.reason && l.reason.length > 10, `${key} needs a one-line reason`);
  }
});

test("no threshold is hard-coded in the server code: the numbers in the rules all come from limits.json", () => {
  for (const f of ["server.js", "logic.js", "surface.js", "contract.js"]) {
    const code = fs.readFileSync(path.join(ROOT, f), "utf8")
      .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    // a comparison of a reading field with a literal number, e.g. `v.co2_ppm > 2000` or `spo2_pct < 92`
    const hard = code.match(/\b(tds_ppm|turbidity_ntu|co2_ppm|depth_cm|grid_hz|spo2_pct|hr_bpm|spo2|hr|temp_c|humidity_pct|battery_wh|battery_pct|draw_w|supply_w|hours_left|o2_pct|pm25_ugm3|radiation_usv_h)\b\s*(-\s*\d+\s*\)\s*)?[<>]=?\s*-?\d/g);
    assert.strictEqual(hard, null, `${f} compares a reading with a literal: ${hard}`);
    assert.ok(!/WARN_HOURS\s*=\s*\d/.test(code), `${f} still defines WARN_HOURS`);
  }
});

test("GET /limits serves the same file the rules use", async () => {
  const served = await s.get("/limits");
  assert.deepStrictEqual(served, limits);
});

test("water: alert at the sourced limit, carries the limit and its source", async () => {
  const b = "L3-farms-04", max = limits.water_tds_max_ppm.value;
  await s.post("/ingest", s.R("sensor-03", b, "water", { tds_ppm: max, turbidity_ntu: 1 }));
  assert.strictEqual((await s.get(`/history?kind=alert&block=${b}`)).length, 0, "exactly at the limit: no alert");
  await s.post("/ingest", s.R("sensor-03", b, "water", { tds_ppm: max + 1, turbidity_ntu: limits.water_turbidity_max_ntu.value + 1 }));
  const [a] = await s.get(`/history?kind=alert&block=${b}`);
  assert.match(a.values.text, /Do not drink/);
  assert.strictEqual(a.values.limit.key, "water_tds_max_ppm");
  assert.strictEqual(a.values.limit.value, max);
  assert.match(a.values.limit.source, /WHO/);
  assert.match(a.values.limit.url, /^https:/);
  assert.deepStrictEqual(a.values.limits.map((l) => l.key), ["water_tds_max_ppm", "water_turbidity_max_ntu"]);
  assert.match(a.values.why, new RegExp(`TDS ${max + 1} ppm is above ${max} ppm \\(WHO`));
  assert.match(a.values.why, /turbidity .* NTU is above .* NTU \(US EPA/);
});

test("air: stale warning at the Health Canada limit, danger at the OSHA limit", async () => {
  const b = "L2-market-01";
  await s.post("/ingest", s.R("sensor-02", b, "air", { co2_ppm: limits.air_co2_stale_ppm.value - 1 }));
  assert.strictEqual((await s.get(`/history?kind=alert&block=${b}`)).length, 0);
  await s.post("/ingest", s.R("sensor-02", b, "air", { co2_ppm: limits.air_co2_stale_ppm.value + 200 }));
  await s.post("/ingest", s.R("sensor-02", b, "air", { co2_ppm: limits.air_co2_danger_ppm.value + 500 }));
  const al = await s.get(`/history?kind=alert&block=${b}`);
  assert.deepStrictEqual(al.map((a) => a.values.level), ["warn", "danger"]);
  assert.match(al[0].values.text, /Air going stale/);
  assert.match(al[0].values.limit.source, /Health Canada/);
  assert.match(al[1].values.limit.source, /OSHA/);
});

test("flood and grid: alerts name their limit and source", async () => {
  const b = "L7-sump-03", nominal = limits.grid_nominal_hz.value, band = limits.grid_band_hz.value;
  await s.post("/ingest", s.R("sensor-07", b, "flood", { depth_cm: limits.flood_depth_closed_cm.value - 1 }));
  await s.post("/ingest", s.R("relay-07", b, "power", { battery_pct: 100, grid_hz: +(nominal - band / 2).toFixed(3) }));
  assert.strictEqual((await s.get(`/history?kind=alert&block=${b}`)).length, 0, "inside both limits: silent");
  await s.post("/ingest", s.R("sensor-07", b, "flood", { depth_cm: limits.flood_depth_closed_cm.value + 5 }));
  await s.post("/ingest", s.R("relay-07", b, "power", { battery_pct: 100, grid_hz: +(nominal - band * 2).toFixed(3) }));
  const al = await s.get(`/history?kind=alert&block=${b}`);
  const flood = al.find((a) => /Flooding/.test(a.values.text)), grid = al.find((a) => /power cut likely/.test(a.values.text));
  assert.match(flood.values.limit.source, /National Weather Service/);
  assert.strictEqual(grid.values.limit.key, "grid_band_hz");
  assert.match(grid.values.why, /outside the normal \+\/- 0\.036 Hz band \(NERC/);
  const f = (await s.get(`/forecast?block=${b}`))[0];
  assert.strictEqual(f.grid_stress, true);
  assert.match(f.reasons[0], /NERC/);
});

test("battery warning: design-choice limit is named as one, with its reason", async () => {
  const b = "L6-borebend-02", H = 3600e3, now = Date.now();
  await s.post("/ingest", [0, 1, 2, 3].map((i) => s.R("relay-06", b, "power", { battery_pct: 60 - 15 * i }, now - (3 - i) * H)));
  const a = (await s.get(`/history?kind=alert&block=${b}`)).find((x) => x.values.hours_left !== undefined);
  assert.strictEqual(a.values.limit.key, "battery_warn_hours");
  assert.strictEqual(a.values.limit.type, "design choice");
  assert.match(a.values.why, /is below 8 h \(design choice: /);
});

test("triage: NEWS2 bands drive the score and each point is explained", async () => {
  const lim = (k) => limits[k].value;
  const base = lim("triage_base_points");
  assert.strictEqual(L.triage({ hr_bpm: 70, spo2_pct: 98, temp_c: 36.8 }), base, "healthy vitals add nothing");
  assert.strictEqual(L.triage({ spo2_pct: lim("vitals_spo2_severe_below_pct") - 1 }), base + lim("triage_spo2_severe_points"));
  assert.strictEqual(L.triage({ spo2_pct: lim("vitals_spo2_low_below_pct") - 1 }), base + lim("triage_spo2_low_points"));
  assert.strictEqual(L.triage({ spo2_pct: lim("vitals_spo2_low_below_pct") }), base, "at the limit is not below it");
  assert.strictEqual(L.triage({ hr_bpm: lim("vitals_hr_high_above_bpm") + 1 }), base + lim("triage_hr_points"));
  assert.strictEqual(L.triage({ hr_bpm: lim("vitals_hr_low_below_bpm") - 1 }), base + lim("triage_hr_points"));
  assert.strictEqual(L.triage({ temp_c: lim("vitals_fever_above_c") + 0.1 }), base + lim("triage_fever_points"));
  assert.strictEqual(L.triage(undefined), base);
  await s.post("/ingest", s.R("watch-42", "L8-deepwell-03", "vitals", { hr_bpm: 130, spo2_pct: 89, temp_c: 39.0 }));
  await s.post("/ingest", s.R("watch-42", "L8-deepwell-03", "button", { button: "help" }));
  const q = await s.get("/queue");
  assert.strictEqual(q[0].reasons.length, 4);
  assert.match(q[0].reasons.join(" | "), /SpO2 89 % is below 92 % \(Royal College of Physicians.*pulse 130 bpm is above 110 bpm.*temperature 39 C is above 38 C/);
});
