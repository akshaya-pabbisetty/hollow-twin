// CONTRACT.md section 6: the sourced limits in 6.1 are agreed by the team, the twin's old table is gone, and every
// number written there is the one the API (and, through GET /limits, the twin) really uses.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeServer, ROOT, REPO } = require("./helper");
const HEAT = require("../heat");

const limits = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/limits.json"), "utf8")).limits;
const contract = fs.readFileSync(path.join(REPO, "CONTRACT.md"), "utf8").replace(/\r\n/g, "\n");
const sample = (name) => JSON.parse(fs.readFileSync(path.join(REPO, "contract", "samples", name), "utf8"));
const s = makeServer();
before(() => s.start());
after(() => s.cleanup());
const alertsFor = async (b) => (await s.get(`/history?kind=alert&block=${b}`));

test("CONTRACT.md section 6: the agreed table, every row sourced, and the twin's old table gone", () => {
  const six = contract.slice(contract.indexOf("## 6. Thresholds"), contract.indexOf("### 6.2"));
  const agreed = contract.slice(contract.indexOf("### 6.1 Agreed limits"), contract.indexOf("### 6.2"));
  assert.ok(six.startsWith("## 6. Thresholds (agreed by the team)"), "section 6 says the limits are agreed");
  assert.ok(agreed.length > 0, "6.1 is the agreed table");
  // the old twin-numbers table and its open item are gone, and nothing in 6.1 is still only a proposal
  for (const old of [
    "| Battery left (from `power`) | under 24 h, or brownout | dark, or under 8 h |",
    "| CO2 | over 2,000 ppm | over 4,000 ppm |",
    "| Air temperature | over 39 °C | over 43 °C |",
    "| Flood depth | over 25 cm | over 45 cm (tunnel closes) |",
    "Water is still open:",
    "Thresholds the twin uses today",
    "not agreed yet",
    "Twin today",
  ]) assert.ok(!contract.includes(old), `removed: ${old}`);
  assert.ok(!agreed.includes("proposed by lane 1"), "no row in 6.1 is still a proposal");
  // the agreed table, row by row: reading, limit (the number the API uses) and status (agreed, with its source)
  const n = (x) => x.toLocaleString("en-US");
  const rows = agreed.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Reading") && !l.startsWith("| ---"));
  const table = rows.map((l) => l.slice(2, -2).split(" | "));
  const expected = [
    ["Battery left (`power`)", `warning under ${limits.battery_warn_hours.value} h, alarm under ${limits.battery_alarm_hours.value} h or dark`, "agreed by the team; a design choice"],
    ["CO2, warning", `over ${n(limits.air_co2_stale_ppm.value)} ppm`, "agreed by the team, source: Health Canada"],
    ["CO2, alarm", `over ${n(limits.air_co2_danger_ppm.value)} ppm`, "agreed by the team, source: OSHA PEL / NIOSH REL"],
    ["Air temperature, warning", `heat index ${limits.air_heat_warn_c.value} °C or more`, "agreed by the team, source: US National Weather Service"],
    ["Air temperature, alarm", `heat index ${limits.air_heat_danger_c.value} °C or more`, "agreed by the team, source: US National Weather Service"],
    ["Flood depth", `tunnel closed over ${limits.flood_depth_closed_cm.value} cm (one level)`, "agreed by the team, source: US National Weather Service"],
    ["Mains frequency", `power cut likely when more than ${limits.grid_band_hz.value} Hz from ${limits.grid_nominal_hz.value} Hz`, "agreed by the team, source: NERC"],
  ];
  assert.strictEqual(table.length, expected.length, rows.join("\n"));
  for (const [i, [reading, limit, status]] of expected.entries()) {
    const [r, l, st] = table[i];
    assert.ok(r.replace("from ", "").startsWith(reading), `row ${i + 1}: ${r}`);
    assert.strictEqual(l, limit, `row ${i + 1} (${reading}): the number the API uses`);
    assert.ok(st.startsWith(status), `row ${i + 1} (${reading}): ${st}`);
  }
  // every sourced limit in the table is a verified safety fact with a link; battery hours are a design choice
  for (const key of ["air_co2_stale_ppm", "air_co2_danger_ppm", "air_heat_warn_c", "air_heat_danger_c", "flood_depth_closed_cm", "grid_band_hz"])
    assert.deepStrictEqual([limits[key].type, limits[key].verified, /^https:/.test(limits[key].url)], ["safety fact", true, true], key);
  for (const key of ["battery_warn_hours", "battery_alarm_hours"]) assert.match(limits[key].reason, /CONTRACT\.md section 6\.1, agreed by the team/, key);
  // 6.2 water: still lane 1's proposal until lane 3 checks the calibrated probe, with its numbers right
  const water = contract.slice(contract.indexOf("### 6.2"), contract.indexOf("## Changelog (lane 1)"));
  for (const text of [`over ${n(limits.water_tds_max_ppm.value)} ppm`, `over ${limits.water_turbidity_max_ntu.value} NTU`, "WHO", "US EPA"]) assert.ok(water.includes(text), text);
  // the change is in the changelog
  assert.ok(contract.includes("| 2026-11-17 | 6, 6.1 | The sourced limits in 6.1 are agreed by the team; the twin reads them from `GET /limits`. **Removed:** the twin's old thresholds table"), "changelog row");
});

test("heat index: the NWS equation reproduces the NWS chart", () => {
  // chart values (air temperature F, relative humidity %) -> heat index F, from weather.gov/ama/heatindex
  for (const [f, rh, chart] of [[90, 70, 105], [96, 65, 121], [100, 50, 118], [86, 90, 105], [104, 40, 119]])
    assert.ok(Math.abs(HEAT.heatIndexF(f, rh) - chart) <= 1.5, `${f} F at ${rh}%: got ${HEAT.heatIndexF(f, rh).toFixed(1)}, chart says ${chart}`);
  assert.deepStrictEqual(HEAT.feelsLike(24, 50), { c: 24, label: "air temperature", detail: "air 24 C at 50 % humidity, below the range of the heat index" });
  assert.strictEqual(HEAT.feelsLike(40.2, undefined).label, "air temperature");
  assert.strictEqual(HEAT.feelsLike(undefined, 60), null);
  assert.ok(HEAT.feelsLike(39, 20).c >= 39, "never cooler than the air itself");
  assert.ok(HEAT.feelsLike(33, 70).c > 39.4 && HEAT.feelsLike(33, 70).label === "heat index", "humid air is dangerous well below 39 C");
});

test("air heat: warning at the NWS Danger level, top alert at Extreme Danger, on the heat index when humidity is sent", async () => {
  const b = "l7-drift-heading";
  const air = (temp_c, humidity_pct) => s.post("/ingest", s.R("sensor", b, "air", { co2_ppm: 600, temp_c, ...(humidity_pct === undefined ? {} : { humidity_pct }) }));
  await air(30, 50);  // feels like about 31 C
  await air(38, 10);  // hot but dry: under the Danger line
  assert.strictEqual((await alertsFor(b)).length, 0);
  await air(33, 70);  // feels like about 43.5 C
  await air(40.2, 71); // the contract sample's values
  await air(41, undefined); // no humidity: the thermometer itself
  const al = await alertsFor(b);
  assert.deepStrictEqual(al.map((a) => [a.values.level, a.values.limit.key]), [["warn", "air_heat_warn_c"], ["danger", "air_heat_danger_c"], ["warn", "air_heat_warn_c"]]);
  assert.match(al[0].values.text, /^Dangerous heat in l7-drift-heading: feels like 4\d C$/);
  assert.match(al[0].values.why, /heat index 43\.\d C is at or above 39\.4 C \(US National Weather Service, heat index classification: Danger.*; air 33 C at 70 % humidity/);
  assert.match(al[1].values.text, /^Extreme heat in l7-drift-heading/);
  assert.match(al[1].values.why, /is at or above 51\.7 C \(US National Weather Service, heat index classification: Extreme Danger/);
  assert.match(al[2].values.why, /air temperature 41 C is at or above 39\.4 C .*no humidity reading/);
  assert.match(al[0].values.limit.url, /^https:\/\/www\.weather\.gov/);
});

test("every contract sample against the API's limits: what each one raises today", async () => {
  const fresh = (name) => ({ ...sample(name), time: new Date().toISOString() });
  const r = await s.post("/ingest", ["air.json", "water.json", "flood.json", "power.json"].map(fresh));
  assert.strictEqual(r.body.accepted, 4);
  const air = (await alertsFor("l7-chalk-cut")).map((a) => a.values.text);
  assert.deepStrictEqual(air.sort(), [
    "Air going stale in l7-chalk-cut: CO2 2350 ppm",          // 2,350 ppm: over 1,000 (warning), under 5,000
    "Do not drink: tap water failing in l7-chalk-cut",        // 840 ppm is fine, 6.5 NTU is over 5
    "Extreme heat in l7-chalk-cut: feels like 74 C",          // 40.2 C at 71 % humidity
  ]);
  const water = (await alertsFor("l7-chalk-cut")).find((a) => /Do not drink/.test(a.values.text));
  assert.deepStrictEqual(water.values.limits.map((l) => l.key), ["water_turbidity_max_ntu"]);
  assert.match(water.values.why, /turbidity 6\.5 NTU is above 5 NTU \(US EPA/);
  const flood = await alertsFor("l6-flint-face");
  assert.deepStrictEqual(flood.map((a) => a.values.text), ["Flooding in l6-flint-face: tunnel closed"]); // 31 cm: over 15
  const power = await alertsFor("l8-bore-bend");
  assert.deepStrictEqual(power.map((a) => [a.values.level, a.values.text]), [["danger", "l8-bore-bend has about 7 h of battery left"]]); // 412 / (96 - 40) = 7.4 h
});
