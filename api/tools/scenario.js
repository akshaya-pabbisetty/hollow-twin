// Demo scenarios: one scripted video shot each, with narration.
//
//   node tools/scenario.js <name> [apiUrl] [--fast]        or, from the api folder:  npm run scenario -- <name> --fast
//
//   names: blackout, fairshare, networkcut, water, outbreak, care, surface, all
//   apiUrl defaults to http://localhost:8787. --fast removes the pauses (used by the tests).
//   If the backend needs an API key, set the INGEST_KEY environment variable before running.
//
// Every message is in the CONTRACT.md format, with real block ids from contract/blocks.json and device ids that fit
// section 3 (relay-l6-flint-face, watch-0042, sensor-l7-chalk-cut, rover-01, surface-01).
// Every message sent from here is tagged "source": "simulated": scripted data never claims to be live hardware.
// Each shot works against a fresh, empty server. Each ends with CHECK lines; a failed check exits with code 1.
const args = process.argv.slice(2);
// --fast on the command line. Some shells hand "--fast" to npm instead of to this script when it is run as
// `npm run scenario -- all --fast`; npm then sets npm_config_fast, so that is honoured too.
const FAST = args.includes("--fast") || process.env.npm_config_fast === "true";
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

// One contract message. hops and via are 0 and [] unless a relay carried it (see the networkcut shot).
const R = (device, block, kind, values, time = Date.now(), route = {}) =>
  ({ id: `${device}-${RUN}-${++counter}`, device, block, time: new Date(time).toISOString(), kind, values, hops: 0, via: [], ...route, source: "simulated" });

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

// Shot: the mains hum sags and the warning fires before any battery is used; then the mains fail and the forecast
// (battery_wh / (draw_w - supply_w)) counts down through the 24 h warning and the 8 h alarm.
shots.blackout = async () => {
  title("blackout: the grid warns us before the lights go out");
  // l6-flint-face: 723,000 people. The block draws 72.3 MW and its battery bank holds 1,800 MWh when full.
  const block = "l6-flint-face", dev = `relay-${block}`, DRAW = 72.3e6, FULL = 1800e6;
  const t0 = Date.now() - 18.5 * H, fail = t0 + 30 * MIN; // the story ends now; the mains fail half an hour in
  const MWh = (wh) => `${Math.round(wh / 1e6).toLocaleString("en-US")} MWh`;
  say(`Relay ${dev} reports the block's battery, draw and supply, and listens to the mains frequency.`);
  say("(Time is compressed: the last 18 hours of relay data are replayed, ending now.)");
  if ((await get(`/history?block=${block}&kind=power`)).length)
    say("NOTE: this server already holds power data for this block, so the forecast will mix two takes.\n    For a clean take, stop the server, delete its data file and start it again (see README, 'Reset between takes').");

  step("1. A normal day: the mains cover the block and the grid hums at 60 Hz");
  for (const [i, hz] of [60.0, 59.99, 60.01].entries()) {
    await send(R(dev, block, "power", { battery_wh: FULL, draw_w: DRAW, supply_w: DRAW, grid_hz: hz }, t0 + i * 5 * MIN));
    say(`grid ${hz.toFixed(2)} Hz, battery ${MWh(FULL)} (full), supply covers the draw`);
    await beat(1.2);
  }
  check((await alertsFor(block)).length === 0, "no alert while the grid is inside its normal band");
  await beat();

  step("2. The frequency sags: power plants are struggling");
  for (const [i, hz] of [59.95, 59.9].entries()) {
    await send(R(dev, block, "power", { battery_wh: FULL, draw_w: DRAW, supply_w: DRAW, grid_hz: hz }, t0 + (15 + i * 5) * MIN));
    say(`grid ${hz.toFixed(2)} Hz, battery ${MWh(FULL)} (full), supply covers the draw`);
    await beat(1.2);
  }
  const grid = (await alertsFor(block)).find((a) => /power cut likely/.test(a.values.text));
  if (grid) { say(`ALERT (${grid.values.level}): ${grid.values.text}`); say(`why: ${grid.values.why}`); }
  check(!!grid, "the grid warning fired while the battery was still full and not draining");
  await beat();

  step("3. The mains fail. The block runs on its battery: hours left = battery / (draw - supply)");
  let f;
  const told = new Set();
  for (const hour of [0, 1, 6, 12, 17, 18]) {
    const left = FULL - hour * DRAW;
    await send(R(dev, block, "power", { battery_wh: left, draw_w: DRAW, supply_w: 0 }, fail + hour * H));
    f = (await get(`/forecast?block=${block}`))[0];
    say(`${pad(`hour ${hour} on battery:`, 20)}${pad(MWh(left), 11)} left, drawing ${DRAW / 1e6} MW  ->  ${f.hours_left} h left  (${f.level})`);
    for (const a of (await alertsFor(block)).filter((x) => x.values.hours_left !== undefined && !told.has(x.id))) {
      told.add(a.id);
      say(`ALERT (${a.values.level}) to every watch in the block: ${a.values.text}`);
      say(`why: ${a.values.why}`);
    }
    await beat(1.8);
  }
  const battery = (await alertsFor(block)).filter((a) => a.values.hours_left !== undefined);
  const warn = battery.find((a) => a.values.level === "warn"), alarm = battery.find((a) => a.values.level === "danger");
  check(!!warn && warn.values.hours_left < 24, `the warning went out with about a day to go (${warn ? warn.values.hours_left : "?"} h left)`);
  check(!!alarm && alarm.values.hours_left < 8, `the alarm went out under 8 h (${alarm ? alarm.values.hours_left : "?"} h left)`);
  check(battery.length === 2, "one warning and one alarm, not one on every reading");
  check(f.method === "net drain" && f.level === "alarm" && f.hours_left < 8, `the forecast is ${f.hours_left} h, from battery_wh / (draw_w - supply_w)`);
  check(!!grid && !!warn && !!alarm && grid.seq < warn.seq && warn.seq < alarm.seq, "the grid warning came first, then the battery warning, then the alarm");
};

// Shot: the same supply, shared two ways.
shots.fairshare = async () => {
  title("fairshare: the same power, shared two ways");
  const MW = (w) => `${Math.round(w / 1e6).toLocaleString("en-US")} MW`;
  const r = await get("/fairshare?supply_pct=60"), need = r.fair, supply = r.fair.supply_w;
  say(`The sector's ${r.fair.blocks.length} blocks need ${MW(need.demand_total_w)}. Only ${MW(supply)} is available (60%). Who gets it?`);
  say(need.basis);
  step("1. The Directorate's rule");
  say(r.directorate.rule);
  await beat();
  step("2. The fair-share rule");
  say(r.fair.rule);
  await beat();
  step("3. Side by side, level by level (share of demand served; DARK = blocks without air fans or pumps)");
  say(`${pad("level", 7)}${pad("blocks", 8)}${pad("Directorate", 22)}fair share`);
  const cell = (rows) => {
    const served = rows.reduce((s, b) => s + b.served_w, 0), demand = rows.reduce((s, b) => s + b.demand_w, 0), dark = rows.filter((b) => b.dark).length;
    return `${Math.round((100 * served) / demand)}%${dark ? `  ${dark} DARK` : ""}`;
  };
  for (const level of [...new Set(r.directorate.blocks.map((b) => b.level))]) {
    const d = r.directorate.blocks.filter((b) => b.level === level), f = r.fair.blocks.filter((b) => b.level === level);
    say(`${pad(level, 7)}${pad(d.length, 8)}${pad(cell(d), 22)}${cell(f)}`);
    await beat(0.4);
  }
  await beat();
  const deepest = r.directorate.blocks[r.directorate.blocks.length - 1], same = r.fair.blocks.find((b) => b.block === deepest.block);
  say(`One block, ${deepest.name} (${deepest.block}, ${deepest.people.toLocaleString("en-US")} people):  Directorate ${deepest.served_pct}%${deepest.dark ? " DARK" : ""}  |  fair share ${same.served_pct}%${same.dark ? " DARK" : ""}`);
  if (r.measured.length) {
    say("Blocks with a real relay reporting (watts, kept apart from the estimate above):");
    for (const m of r.measured) say(`  ${pad(m.block, 18)} ${pad(m.tag, 10)} battery ${m.battery_wh} Wh, draw ${m.draw_w} W, supply ${m.supply_w} W  ->  ${m.hours_left === null ? "not draining" : m.hours_left + " h left"} (${m.level_name})`);
  }
  say(`Blocks without air fans or pumps:  Directorate ${r.directorate.dark_blocks.length}  |  fair share ${r.fair.dark_blocks.length}`);
  say(`Equity index (worst-served person / best-served person):  Directorate ${r.directorate.equity_index}  |  fair share ${r.fair.equity_index}`);
  check(r.fair.blocks.length === 70, "all 70 blocks of contract/blocks.json are in the comparison");
  check(r.directorate.dark_blocks.length >= 10, `the Directorate's rule leaves ${r.directorate.dark_blocks.length} deep blocks dark`);
  check(r.fair.dark_blocks.length === 0, "fair share keeps air and pumps running in every block");
  check(r.fair.equity_index > r.directorate.equity_index, "fair share is more equal");
};

// Shot: the network dies, the relay holds readings, then uploads the backlog. The history has no gap.
shots.networkcut = async () => {
  title("networkcut: the relay stores and forwards, nothing is lost");
  const block = "l7-chalk-cut", dev = `sensor-${block}`, relay = `relay-${block}`, next = "relay-l7-ash-wells", gap = 5000, n = 12;
  const watch = "watch-0071", family = "fam-0071", upstairs = "watch-0011"; // a resident down here, a relative on L1
  const t0 = Date.now() - n * gap; // 12 readings, 5 s apart, ending now
  const all = Array.from({ length: n }, (_, i) => R(dev, block, "air", { co2_ppm: 820 + i * 3, temp_c: 24.5, humidity_pct: 55 }, t0 + (i + 1) * gap));
  await send(R(upstairs, "l1-winch-gallery", "checkin", { status: "ok", family, to: [] }, t0)); // the relative is known to the family group
  say(`Sensor ${dev} reads the air every 5 seconds and sends it through its relay, ${relay}.`);

  step("1. Network up: readings arrive as they are taken");
  for (const r of all.slice(0, 4)) { await send(r); say(`sent  ${r.time.slice(11, 19)}  CO2 ${r.values.co2_ppm} ppm`); await beat(1); }

  step("2. NETWORK CUT. The relay keeps every reading");
  const held = [];
  for (const r of all.slice(4, 10)) { held.push(r); say(`held  ${r.time.slice(11, 19)}  CO2 ${r.values.co2_ppm} ppm   (relay is holding ${held.length})`); await beat(1); }
  // a resident presses "I'm OK" while the block is cut off: the relay holds that too
  const checkin = R(watch, block, "checkin", { status: "ok", family, to: [upstairs] }, all[7].time);
  say(`held  ${checkin.time.slice(11, 19)}  ${watch} presses "I'm OK" for family ${family}`);
  await beat(1);
  const during = (await get(`/history?block=${block}&kind=air`)).filter((r) => r.id.includes(RUN));
  say(`The backend has ${during.length} readings. The newest is ${during[during.length - 1].time.slice(11, 19)}: ${held.length * 5} seconds are missing.`);
  await beat();

  step(`3. ${relay} cannot reach the API, but ${next} can: the backlog hops across and goes up in ONE request`);
  // every message that crossed the gap carries the route it took: 2 hops, via both relays (CONTRACT.md section 5)
  const hop = (r) => ({ ...r, hops: 2, via: [relay, next] });
  const shuffled = [held[3], held[0], checkin, held[5], held[1], held[4], held[2], held[1]].map(hop); // out of order, with one duplicate
  const up = await send(shuffled);
  say(`backend answered: accepted ${up.accepted}, duplicates ${up.duplicates}, rejected ${up.rejected.length}`);
  await beat();
  for (const r of all.slice(10)) { await send(r); say(`sent  ${r.time.slice(11, 19)}  CO2 ${r.values.co2_ppm} ppm`); await beat(1); }

  step("4. The history, replayed in the order the readings were TAKEN");
  const hist = (await get(`/history?block=${block}&kind=air`)).filter((r) => r.id.includes(RUN));
  say(hist.map((r) => r.time.slice(14, 19)).join("  "));
  const gaps = hist.slice(1).map((r, i) => Date.parse(r.time) - Date.parse(hist[i].time));
  const told = (await get(`/inbox?device=${upstairs}`)).find((a) => a.values.cause === checkin.id);
  if (told) { say(`${upstairs} on L1 shows: ${told.values.text}`); say(`why: ${told.values.why}`); }
  check(up.accepted === 7 && up.duplicates === 1 && up.rejected.length === 0, "the whole backlog was stored and the duplicate was dropped");
  check(hist.filter((r) => r.hops === 2).length === 6 && hist.filter((r) => r.hops === 2).every((r) => r.via.join() === [relay, next].join()), "the six held readings kept their route: 2 hops, via both relays");
  check(!!told && told.values.hops === 2 && told.values.sent === checkin.time, "the check-in crossed the cut and reached the family upstairs, with its original time");
  check(hist.length === n, `all ${n} readings are in the history`);
  check(gaps.every((g) => g === gap), "no gap: every reading is exactly 5 s after the one before, with its original time");
  check(hist.every((r, i) => r.values.co2_ppm === 820 + i * 3), "and they are in the right order");
};

// Shot: a clean cup, then a salty cup.
shots.water = async () => {
  title("water: a clean cup, then a salty cup");
  const block = "l3-ember-yard", sensor = `sensor-${block}`, watch = "watch-0031";
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
  const block = "l8-bore-bend";
  const row = async () => (await get("/truth")).blocks.find((b) => b.block === block) || { residents: 0, official: 0, gap: 0 };
  const start = (await row()).residents;
  await post("/official", { block, count: 2 });
  say(`The Directorate's bulletin for ${block}: 2 cases.`);
  await beat();
  // twelve watches, numbered from the clock so a second take on the same server uses twelve different people
  const first = 1000 + (Math.floor(Date.now() / 1000) % 8000);
  let watchNo = 0, r;
  const waves = [["symptom", 3], ["symptom", 3], ["low oxygen", 3], ["symptom", 3]];
  for (const [i, [kind, count]] of waves.entries()) {
    step(`${i + 1}. ${count} more residents: ${kind === "symptom" ? "they press the symptom button" : "their watches measure low blood oxygen"}`);
    for (let k = 0; k < count; k++) {
      const dev = `watch-${first + watchNo++}`;
      await send(kind === "symptom" ? R(dev, block, "button", { button: "symptom" }) : R(dev, block, "vitals", { hr_bpm: 104, spo2_pct: 90, temp_c: 38.4 }));
    }
    r = await row();
    say(`residents' count: ${pad(r.residents, 4)} official count: ${pad(r.official, 4)} hidden: ${r.gap}`);
    await beat();
  }
  await send(R(`watch-${first}`, block, "button", { button: "symptom" }));
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
    ["watch-0041", "l4-coke-yard", { hr_bpm: 78, spo2_pct: 98, temp_c: 36.8 }, "feels faint, vitals normal"],
    ["watch-0042", "l8-bore-bend", { hr_bpm: 132, spo2_pct: 89, temp_c: 39.2 }, "very low oxygen, racing pulse, high fever"],
    ["watch-0043", "l5-rail-face", { hr_bpm: 96, spo2_pct: 96, temp_c: 38.4 }, "fever"],
  ];
  const mine = async () => (await get("/help")).filter((q) => q.id.includes(RUN));
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
  check(q.length === 3 && q[0].device === "watch-0042", "the sickest person is first, although they pressed second");
  check(q.length === 3 && q[1].device === "watch-0043" && q[2].device === "watch-0041", "then the fever, then the normal vitals");
  await beat();

  step("3. The top request is assigned to rover-01");
  const d = q[0] ? await post(`/help/${encodeURIComponent(q[0].id)}/assign`, { to: "rover-01" }) : {};
  say(d.assigned ? `rover-01 is sent to ${d.assigned.device} in ${d.assigned.block}` : "nothing to assign");
  await beat();
  const inbox = (await get("/inbox?device=watch-0042")).filter((a) => /rover-01 sent/.test(a.values.text));
  if (inbox.length) say(`${"watch-0042"} shows: ${inbox[inbox.length - 1].values.text}`);
  q = await mine();
  say(`Next in the queue: ${q[0] ? q[0].device : "nobody"}`);
  const jobs = (await get("/help?status=assigned&to=rover-01")).filter((x) => x.id.includes(RUN));
  check(!!d.assigned && d.assigned.device === "watch-0042" && d.assigned.assigned_to === "rover-01", "the robot went to the top of the queue");
  check(jobs.length === 1 && jobs[0].device === "watch-0042", "the rover can read its own job from GET /help?status=assigned&to=rover-01");
  check(inbox.length >= 1, "the resident was told help is coming");
  check(q.length === 2 && q[0].device === "watch-0043", "the request left the queue and the next person moved up");
};

// Shot: scout readings arrive, the verdict and the first-wave list update.
shots.surface = async () => {
  title("surface: is it safe to go up, and who goes first?");
  const scout = "surface-01", up = "surface", home = "l1-winch-gallery";
  // GET /broadcast is what the public page shows: the verdict, one plain sentence, every reading against its limits
  const show = async () => {
    const v = await get("/broadcast");
    say(`VERDICT: ${v.verdict.toUpperCase()}${v.missing.length ? `   (missing: ${v.missing.join(", ")})` : ""}`);
    say(`the broadcast page says: ${v.text}`);
    return v;
  };
  say(`The surface scout ${scout} climbs out and reports what it measures, as block "${up}".`);
  step("1. The first message arrives with two of the contract's three readings. The API refuses to guess");
  await send(R(scout, up, "surface", { co2_ppm: 430, temp_c: 17.5, photo_url: `https://example.invalid/${scout}/000001.jpg` }));
  say("CO2 430 ppm, temperature 17.5 C");
  let v = await show();
  check(v.verdict === "not enough data" && v.missing.join() === "radiation_usv_h", "no radiation reading yet, so no verdict, and the page says what is missing");
  await beat();

  step("2. The radiation reading completes the contract's three");
  await send(R(scout, up, "surface", { radiation_usv_h: 0.3 }, Date.now() + 2));
  say("radiation 0.3 uSv/h");
  v = await show();
  for (const r of v.readings) say(`  ${pad(r.label, 12)} ${pad(r.value === null ? "-" : `${r.value} ${r.unit}`, 14)} ${r.status}`);
  check(v.verdict === "suits OK", "the three contract readings are inside their limits: suits OK");
  check(v.not_measured.join() === "o2_pct,pm25_ugm3", "oxygen and fine dust are optional: listed as not measured, the verdict does not wait for them");
  await beat();

  step("3. Who goes up first? Residents volunteer from their watches");
  const OK = { hr_bpm: 70, spo2_pct: 98, temp_c: 36.7 };
  const volunteers = [
    ["watch-0051", OK], ["watch-0052", OK], ["watch-0053", OK],
    ["watch-0054", { hr_bpm: 118, spo2_pct: 93, temp_c: 38.6 }], ["watch-0055", OK], ["watch-0057", null],
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
  check(f.ranked.length === 3 && f.ranked[0].device === "watch-0052", "three healthy volunteers are ranked; the one with two needed skills goes first");
  check(f.excluded.some((p) => p.device === "watch-0053" && /sole caregiver/.test(p.reasons[0])), "the sole caregiver is never sent");
  check(f.excluded.some((p) => p.device === "watch-0054") && f.excluded.some((p) => p.device === "watch-0057"), "unwell volunteers and volunteers with no vitals stay below");
  check(f.cleared === true, "the list is a go: the verdict allows people up");
  await beat();

  step("4. The scout moves on and radiation climbs");
  await send(R(scout, up, "surface", { radiation_usv_h: 2.1 }, Date.now() + 3));
  say("radiation 2.1 uSv/h");
  v = await show();
  say(`why: ${v.reasons[0]}`);
  await beat();
  const record = (await get(v.history)).filter((e) => e.type === "verdict" && e.id.includes(RUN)); // the link the broadcast page gives
  say("The public record of verdict changes (nobody can quietly rewrite it):");
  for (const e of record) say(`    ${e.time.slice(11, 19)}  ${e.previous || "(none)"}  ->  ${e.verdict}`);
  f = await get("/firstwave");
  check(v.verdict === "sealed outposts needed", "radiation above the IAEA food and water limit: nothing grown up there can be eaten, so sealed outposts only");
  check(/radiation 2\.1 .Sv\/h is above 1 .Sv\/h \(IAEA/.test(v.reasons[0]), "the verdict states the reading, the limit and its source");
  check(record.length >= 2 && record[record.length - 1].verdict === "sealed outposts needed", "every verdict change is on the public record");
  check(f.surface_verdict === "sealed outposts needed" && f.ranked.length === 3 && f.cleared === false, "the first-wave list follows the new verdict: ranked, but nobody goes up to hold an outpost yet");
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
