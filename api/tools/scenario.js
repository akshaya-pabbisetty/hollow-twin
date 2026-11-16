// Demo scenarios: one scripted video shot each, with narration.
//
//   node tools/scenario.js <name> [apiUrl] [--fast]
//
//   names: blackout, fairshare, networkcut, water, outbreak, care, surface, all
//   apiUrl defaults to http://localhost:8787. --fast removes the pauses (used by the tests).
//   If the backend needs an API key, set the INGEST_KEY environment variable before running.
//
// Every reading sent from here is tagged "source": "simulated": scripted data never claims to be live hardware.
// Each shot works against a fresh, empty server. Each ends with CHECK lines; a failed check exits with code 1.
const args = process.argv.slice(2);
const FAST = args.includes("--fast");
const [NAME, URL_ARG] = args.filter((a) => !a.startsWith("--"));
const API = (URL_ARG || process.env.API || "http://localhost:8787").replace(/\/$/, "");
const KEY = process.env.INGEST_KEY || "";
const RUN = Date.now().toString(36); // makes ids unique per run, so a shot can be re-run on the same server

const H = 3600e3, MIN = 60e3;
let counter = 0, failed = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const beat = (seconds = 2.5) => (FAST ? null : sleep(seconds * 1000)); // the pause between steps on camera
const out = (s = "") => console.log(String(s).replace(/µ/g, "u"));    // plain ASCII for every terminal
const title = (s) => out(`\n${"=".repeat(72)}\n  SHOT: ${s}\n${"=".repeat(72)}`);
const step = (s) => out(`\n--- ${s}`);
const say = (s) => out(`    ${s}`);
function check(ok, text) { if (!ok) failed++; out(`    CHECK ${ok ? "ok    " : "FAILED"}: ${text}`); return ok; }

const R = (device, block, kind, values, time = Date.now()) =>
  ({ id: `${device}-${RUN}-${++counter}`, device, block, time: new Date(time).toISOString(), kind, values, source: "simulated" });

async function call(method, path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, { method, headers: { "Content-Type": "application/json", ...(KEY ? { "x-api-key": KEY } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 429 && attempt < 5) { await sleep(1100); continue; } // rate limited: wait a second and retry
    const json = await res.json();
    if (res.status === 401) throw new Error("the backend needs an API key: set the INGEST_KEY environment variable");
    return json;
  }
}
const get = (path) => call("GET", path);
const post = (path, body) => call("POST", path, body);
const send = (r) => post("/ingest", r);
const alertsFor = async (block) => (await get(`/history?kind=alert&block=${block}`)).filter((a) => a.id.includes(RUN));
const pad = (s, n) => String(s).padEnd(n);

// ---------------------------------------------------------------------------------------------------------------
const shots = {};

// Shot: the mains hum sags, the warning fires before any battery is used, then the battery forecast drops under 8 h.
shots.blackout = async () => {
  title("blackout: the grid warns us before the lights go out");
  const block = "L6-borebend-02", dev = "relay-06", t0 = Date.now() - 4 * H;
  say(`Relay ${dev} in ${block} measures the mains frequency and its battery.`);
  say("(Time is compressed: the last 4 hours of relay data are replayed, ending now.)");
  if ((await get(`/history?block=${block}&kind=power`)).length)
    say("NOTE: this server already holds power data for this block, so the forecast will mix two takes.\n    For a clean take, stop the server, delete its data file and start it again (see README, 'Reset between takes').");

  step("1. A normal day: the grid hums at 60 Hz");
  for (const [i, hz] of [60.0, 59.99, 60.01].entries()) {
    await send(R(dev, block, "power", { battery_pct: 100, draw_w: 0, grid_hz: hz }, t0 + i * 5 * MIN));
    say(`grid ${hz.toFixed(2)} Hz, battery 100%`);
    await beat(1.2);
  }
  check((await alertsFor(block)).length === 0, "no alert while the grid is inside its normal band");
  await beat();

  step("2. The frequency sags: power plants are struggling");
  for (const [i, hz] of [59.95, 59.9].entries()) {
    await send(R(dev, block, "power", { battery_pct: 100, draw_w: 0, grid_hz: hz }, t0 + (15 + i * 5) * MIN));
    say(`grid ${hz.toFixed(2)} Hz, battery 100%`);
    await beat(1.2);
  }
  const grid = (await alertsFor(block)).find((a) => /power cut likely/.test(a.values.text));
  if (grid) { say(`ALERT (${grid.values.level}): ${grid.values.text}`); say(`why: ${grid.values.why}`); }
  check(!!grid, "the warning fired while the battery was still at 100%");
  await beat();

  step("3. The mains fail. The block runs on its battery");
  let f;
  for (const [i, pct] of [97, 90, 78, 62].entries()) {
    await send(R(dev, block, "power", { battery_pct: pct, draw_w: 80 + i * 15 }, t0 + (i + 1) * H));
    f = (await get(`/forecast?block=${block}`))[0];
    say(`hour ${i + 1}: battery ${pct}%  ->  forecast: ${f.hours_left === null ? "steady" : f.hours_left + " h left"}`);
    await beat(1.8);
  }
  const fc = (await alertsFor(block)).find((a) => a.values.hours_left !== undefined);
  if (fc) { say(`ALERT (${fc.values.level}) to every watch in the block: ${fc.values.text}`); say(`why: ${fc.values.why}`); }
  check(f.hours_left !== null && f.hours_left < 8, `battery forecast is under 8 h (${f.hours_left} h)`);
  check(!!fc, "the under-8-hours warning reached the block");
  check(!!grid && !!fc && grid.seq < fc.seq, "the grid warning came first, before the battery warning");
};

// Shot: the same supply, shared two ways.
shots.fairshare = async () => {
  title("fairshare: the same power, shared two ways");
  const supply = 9000;
  const r = await get(`/fairshare?supply_w=${supply}`);
  say(`The sector needs 16,000 W. Only ${supply} W is available. Who gets it?`);
  step("1. The Directorate's rule");
  say(r.directorate.rule);
  await beat();
  step("2. The fair-share rule");
  say(r.fair.rule);
  await beat();
  step("3. Side by side (percent of each block's demand that is served)");
  say(`${pad("block", 18)}${pad("Directorate", 16)}fair share`);
  for (const d of r.directorate.blocks) {
    const f = r.fair.blocks.find((b) => b.block === d.block);
    say(`${pad(d.block, 18)}${pad(`${d.served_pct}%${d.dark ? "  DARK" : ""}`, 16)}${f.served_pct}%${f.dark ? "  DARK" : ""}`);
    await beat(0.4);
  }
  await beat();
  say(`Blocks without air fans or pumps:  Directorate ${r.directorate.dark_blocks.length}  |  fair share ${r.fair.dark_blocks.length}`);
  say(`Equity index (worst-served person / best-served person):  Directorate ${r.directorate.equity_index}  |  fair share ${r.fair.equity_index}`);
  check(r.directorate.dark_blocks.length >= 3, `the Directorate's rule leaves ${r.directorate.dark_blocks.length} deep blocks dark: ${r.directorate.dark_blocks.join(", ")}`);
  check(r.fair.dark_blocks.length === 0, "fair share keeps air and pumps running in every block");
  check(r.fair.equity_index > r.directorate.equity_index, "fair share is more equal");
};

// Shot: the network dies, the relay holds readings, then uploads the backlog. The history has no gap.
shots.networkcut = async () => {
  title("networkcut: the relay stores and forwards, nothing is lost");
  const block = "L7-sump-03", dev = "sensor-07", gap = 5000, n = 12;
  const t0 = Date.now() - n * gap; // 12 readings, 5 s apart, ending now
  const all = Array.from({ length: n }, (_, i) => R(dev, block, "air", { co2_ppm: 820 + i * 3 }, t0 + (i + 1) * gap));
  say(`Sensor ${dev} in ${block} reads CO2 every 5 seconds and sends it through its relay.`);

  step("1. Network up: readings arrive as they are taken");
  for (const r of all.slice(0, 4)) { await send(r); say(`sent  ${r.time.slice(11, 19)}  CO2 ${r.values.co2_ppm} ppm`); await beat(1); }

  step("2. NETWORK CUT. The relay keeps every reading");
  const held = [];
  for (const r of all.slice(4, 10)) { held.push(r); say(`held  ${r.time.slice(11, 19)}  CO2 ${r.values.co2_ppm} ppm   (relay is holding ${held.length})`); await beat(1); }
  const during = (await get(`/history?block=${block}&kind=air`)).filter((r) => r.id.includes(RUN));
  say(`The backend has ${during.length} readings. The newest is ${during[during.length - 1].time.slice(11, 19)}: ${held.length * 5} seconds are missing.`);
  await beat();

  step("3. Network back: the relay uploads the backlog in ONE request (out of order, with a duplicate)");
  const shuffled = [held[3], held[0], held[5], held[1], held[4], held[2], held[1]];
  const up = await send(shuffled);
  say(`backend answered: added ${up.added}, duplicates dropped ${up.dupes}, errors ${up.errors.length}`);
  await beat();
  for (const r of all.slice(10)) { await send(r); say(`sent  ${r.time.slice(11, 19)}  CO2 ${r.values.co2_ppm} ppm`); await beat(1); }

  step("4. The history, replayed in the order the readings were TAKEN");
  const hist = (await get(`/history?block=${block}&kind=air`)).filter((r) => r.id.includes(RUN));
  say(hist.map((r) => r.time.slice(14, 19)).join("  "));
  const gaps = hist.slice(1).map((r, i) => Date.parse(r.time) - Date.parse(hist[i].time));
  check(up.added === 6 && up.dupes === 1, "the whole backlog was stored and the duplicate was dropped");
  check(hist.length === n, `all ${n} readings are in the history`);
  check(gaps.every((g) => g === gap), "no gap: every reading is exactly 5 s after the one before, with its original time");
  check(hist.every((r, i) => r.values.co2_ppm === 820 + i * 3), "and they are in the right order");
};

// Shot: a clean cup, then a salty cup.
shots.water = async () => {
  title("water: a clean cup, then a salty cup");
  const block = "L3-farms-04", sensor = "sensor-03", watch = "watch-31";
  await send(R(watch, block, "vitals", { hr_bpm: 74, spo2_pct: 98, temp_c: 36.7 }));
  say(`Sensor ${sensor} tests the tap water in ${block}. ${watch} is a resident's watch in the same block.`);
  const inboxNow = async () => (await get(`/inbox?device=${watch}`)).filter((a) => a.id.includes(RUN) && /Do not drink/.test(a.values.text));

  step("1. A clean cup");
  await send(R(sensor, block, "water", { tds_ppm: 240, turbidity_ntu: 0.8 }));
  say("dissolved solids 240 ppm, turbidity 0.8 NTU");
  await beat();
  check((await inboxNow()).length === 0, "clean water: the watch stays silent");
  await beat();

  step("2. A salty cup");
  await send(R(sensor, block, "water", { tds_ppm: 1450, turbidity_ntu: 1.1 }, Date.now() + 1));
  say("dissolved solids 1450 ppm, turbidity 1.1 NTU");
  await beat();
  const got = await inboxNow();
  if (got[0]) { say(`ALERT (${got[0].values.level}) on ${watch}: ${got[0].values.text}`); say(`why: ${got[0].values.why}`); say(`source: ${got[0].values.limit.url}`); }
  check(got.length === 1, "do-not-drink reached the watch in that block");
  check(!!got[0] && got[0].values.limit.key === "water_tds_max_ppm", "and it names the limit that was crossed, with its source");
};

// Shot: residents' reports climb while the official count stays at 2.
shots.outbreak = async () => {
  title("outbreak: the residents' count vs the Directorate's count");
  const block = "L8-deepwell-03";
  const row = async () => (await get("/truth")).blocks.find((b) => b.block === block) || { residents: 0, official: 0, gap: 0 };
  const start = (await row()).residents;
  await post("/official", { block, count: 2 });
  say(`The Directorate's bulletin for ${block}: 2 cases.`);
  await beat();
  let watchNo = 0, r;
  const waves = [["symptom", 3], ["symptom", 3], ["low oxygen", 3], ["symptom", 3]];
  for (const [i, [kind, count]] of waves.entries()) {
    step(`${i + 1}. ${count} more residents: ${kind === "symptom" ? "they press the symptom button" : "their watches measure low blood oxygen"}`);
    for (let k = 0; k < count; k++) {
      const dev = `watch-8${RUN.slice(-3)}${++watchNo}`;
      await send(kind === "symptom" ? R(dev, block, "button", { button: "symptom" }) : R(dev, block, "vitals", { hr_bpm: 104, spo2_pct: 90, temp_c: 38.4 }));
    }
    r = await row();
    say(`residents' count: ${pad(r.residents, 4)} official count: ${pad(r.official, 4)} hidden: ${r.gap}`);
    await beat();
  }
  await send(R(`watch-8${RUN.slice(-3)}1`, block, "button", { button: "symptom" }));
  r = await row();
  say("(One resident pressed twice: a person is only counted once.)");
  say((await get("/truth")).rule);
  check(r.residents === start + 12, `the residents' count rose by 12, to ${r.residents}`);
  check(r.official === 2, "the official count is still 2");
  check(r.gap === r.residents - 2, `${r.gap} cases are missing from the official number`);
};

// Shot: help requests ranked by need, then a robot dispatched.
shots.care = async () => {
  title("care: help requests ranked by need, then a robot is sent");
  const people = [
    ["watch-41", "L4-works-02", { hr_bpm: 78, spo2_pct: 98, temp_c: 36.8 }, "feels faint, vitals normal"],
    ["watch-42", "L8-deepwell-03", { hr_bpm: 132, spo2_pct: 89, temp_c: 39.2 }, "very low oxygen, racing pulse, high fever"],
    ["watch-43", "L5-rivet-01", { hr_bpm: 96, spo2_pct: 96, temp_c: 38.4 }, "fever"],
  ];
  const mine = async () => (await get("/queue")).filter((q) => q.id.includes(RUN));
  step("1. Three residents press HELP, in this order");
  for (const [dev, block, vitals, text] of people) {
    await send(R(dev, block, "vitals", vitals));
    await send(R(dev, block, "button", { button: "help" }));
    say(`${dev} in ${pad(block, 15)} ${text}`);
    await beat(1.2);
  }
  step("2. The queue is ranked by need, not by who pressed first");
  let q = await mine();
  for (const [i, item] of q.entries()) {
    say(`#${i + 1}  ${item.device}  score ${item.score}`);
    for (const why of item.reasons) say(`      ${why}`);
    await beat(1);
  }
  check(q.length === 3 && q[0].device === "watch-42", "the sickest person is first, although they pressed second");
  check(q.length === 3 && q[1].device === "watch-43" && q[2].device === "watch-41", "then the fever, then the normal vitals");
  await beat();

  step("3. Rover rover-01 is dispatched from L1-gallery-02");
  const d = await post("/dispatch", { responder: "rover-01", block: "L1-gallery-02" });
  say(d.assigned ? `rover-01 is sent to ${d.assigned.device} in ${d.assigned.block}` : "nothing to dispatch");
  await beat();
  const inbox = (await get("/inbox?device=watch-42")).filter((a) => /rover-01 sent/.test(a.values.text));
  if (inbox.length) say(`${"watch-42"} shows: ${inbox[inbox.length - 1].values.text}`);
  q = await mine();
  say(`Next in the queue: ${q[0] ? q[0].device : "nobody"}`);
  check(!!d.assigned && d.assigned.device === "watch-42", "the robot went to the top of the queue");
  check(inbox.length >= 1, "the resident was told help is coming");
  check(q.length === 2 && q[0].device === "watch-43", "the request left the queue and the next person moved up");
};

// Shot: scout readings arrive, the verdict and the first-wave list update.
shots.surface = async () => {
  title("surface: is it safe to go up, and who goes first?");
  const scout = "scout-01", up = "L0-crown-01", home = "L1-gallery-02";
  const show = async () => {
    const v = await get("/surface");
    say(`VERDICT: ${v.verdict.toUpperCase()}${v.missing.length ? `   (missing: ${v.missing.join(", ")})` : ""}`);
    return v;
  };
  say(`Scout robot ${scout} climbs to the surface and reports what it measures.`);
  step("1. The first readings arrive. The backend refuses to guess");
  await send(R(scout, up, "surface", { co2_ppm: 430, temp_c: 17.5 }));
  say("CO2 430 ppm, temperature 17.5 C");
  let v = await show();
  check(v.verdict !== "suits OK" || v.missing.length === 0, "with readings missing there is no 'safe' verdict");
  await beat();
  await send(R(scout, up, "surface", { o2_pct: 20.9, pm25_ugm3: 14 }, Date.now() + 1));
  say("oxygen 20.9 %, fine dust 14 ug/m3");
  await show();
  await beat();

  step("2. The radiation reading completes the picture");
  await send(R(scout, up, "surface", { radiation_usv_h: 0.3 }, Date.now() + 2));
  say("radiation 0.3 uSv/h");
  v = await show();
  for (const r of v.readings) say(`  ${pad(r.label, 12)} ${pad(`${r.value} ${r.unit}`, 14)} ${r.status}`);
  check(v.verdict === "suits OK", "all five readings are inside their limits: suits OK");
  await beat();

  step("3. Who goes up first? Residents volunteer from their watches");
  const OK = { hr_bpm: 70, spo2_pct: 98, temp_c: 36.7 };
  const volunteers = [
    ["watch-51", OK], ["watch-52", OK], ["watch-53", OK],
    ["watch-54", { hr_bpm: 118, spo2_pct: 93, temp_c: 38.6 }], ["watch-55", OK], ["watch-57", null],
  ];
  for (const [dev, vitals] of volunteers) {
    if (vitals) await send(R(dev, home, "vitals", vitals));
    await send(R(dev, home, "button", { button: "volunteer" }));
    say(`${dev} volunteers`);
    await beat(0.6);
  }
  let f = await get("/firstwave?n=20");
  say(f.rule);
  for (const p of f.ranked) { say(`#${p.rank}  ${pad(p.name, 16)} ${pad(p.skills.join(", "), 20)} score ${p.score}`); await beat(0.6); }
  say("Not going:");
  for (const p of f.excluded) say(`    ${pad(p.name || p.device, 16)} ${p.reasons[0]}`);
  check(f.ranked.length === 3 && f.ranked[0].device === "watch-52", "three healthy volunteers are ranked; the one with two needed skills goes first");
  check(f.excluded.some((p) => p.device === "watch-53" && /sole caregiver/.test(p.reasons[0])), "the sole caregiver is never sent");
  check(f.excluded.some((p) => p.device === "watch-54") && f.excluded.some((p) => p.device === "watch-57"), "unwell volunteers and volunteers with no vitals stay below");
  check(f.cleared === true, "the list is a go: the verdict allows people up");
  await beat();

  step("4. The scout moves on and radiation climbs");
  await send(R(scout, up, "surface", { radiation_usv_h: 2.1 }, Date.now() + 3));
  say("radiation 2.1 uSv/h");
  v = await show();
  say(`why: ${v.reasons[0]}`);
  await beat();
  const record = (await get("/surface/history")).filter((e) => e.type === "verdict" && e.id.includes(RUN));
  say("The public record of verdict changes (nobody can quietly rewrite it):");
  for (const e of record) say(`    ${e.time.slice(11, 19)}  ${e.previous || "(none)"}  ->  ${e.verdict}`);
  f = await get("/firstwave");
  check(v.verdict === "sealed domes needed", "radiation above the limit: sealed domes needed");
  check(/radiation 2\.1 .Sv\/h is above 1 .Sv\/h \(IAEA/.test(v.reasons[0]), "the verdict states the reading, the limit and its source");
  check(record.length >= 2 && record[record.length - 1].verdict === "sealed domes needed", "every verdict change is on the public record");
  check(f.surface_verdict === "sealed domes needed" && f.ranked.length === 3, "the first-wave list follows the new verdict");
};

// ---------------------------------------------------------------------------------------------------------------
const ORDER = ["blackout", "fairshare", "networkcut", "water", "outbreak", "care", "surface"];

async function main() {
  if (!NAME || (NAME !== "all" && !shots[NAME])) {
    out(`usage: node tools/scenario.js <${ORDER.join("|")}|all> [apiUrl] [--fast]`);
    process.exitCode = 2; return;
  }
  try { await get("/limits"); } catch (e) {
    out(`Cannot reach the backend at ${API}. Start it first (in the api folder):  npm start`);
    process.exitCode = 2; return;
  }
  out(`Backend: ${API}   (all scenario data is tagged "simulated")`);
  for (const name of NAME === "all" ? ORDER : [NAME]) {
    await shots[name]();
    if (NAME === "all") await beat(4);
  }
  out(`\n${failed ? `${failed} CHECK(S) FAILED` : "All checks passed."}`);
  // set the exit code and let Node finish on its own: process.exit() can cut off piped output on Windows
  process.exitCode = failed ? 1 : 0;
}
main().catch((e) => { out(`scenario stopped: ${e.message}`); process.exitCode = 1; });
