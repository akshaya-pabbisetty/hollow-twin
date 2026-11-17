// Task 4: the endpoints of CONTRACT.md section 4, exactly as the contract and tools/catcher.mjs describe them.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { makeServer, REPO } = require("./helper");

const s = makeServer();
const locked = makeServer({ INGEST_KEY: "s3cret" });
before(() => Promise.all([s.start(), locked.start()]));
after(() => Promise.all([s.cleanup(), locked.cleanup()]));
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Reads /live (or /feed) as raw server-sent events: [{ id, event, data }]. `event` is undefined for an unnamed event.
async function events(url, { headers = {}, want = 1, timeoutMs = 2000 } = {}) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), timeoutMs), out = [];
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const reader = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    while (out.length < want) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const ev = {};
        for (const line of buf.slice(0, i).split("\n")) {
          if (line.startsWith("id: ")) ev.id = Number(line.slice(4));
          if (line.startsWith("event: ")) ev.event = line.slice(7);
          if (line.startsWith("data: ")) ev.data = JSON.parse(line.slice(6));
        }
        buf = buf.slice(i + 2);
        if (ev.data !== undefined) out.push(ev);
      }
    }
  } catch (e) { if (e.name !== "AbortError") throw e; }
  clearTimeout(timer); ctrl.abort();
  return out;
}

test("POST /ingest returns { accepted, duplicates } with rejected reasons and warnings as extra keys", async () => {
  const b = "l8-bore-bend";
  const one = await s.post("/ingest", s.R("watch-0042", b, "vitals", { hr_bpm: 80, spo2_pct: 97, temp_c: 36.8 }));
  assert.deepStrictEqual([one.status, one.body], [200, { accepted: 1, duplicates: 0, rejected: [], warnings: [] }]);
  // an array: one new, one already seen, one broken, one accepted with a warning
  const again = s.R("watch-0042", b, "vitals", { hr_bpm: 81, spo2_pct: 97, temp_c: 36.8 });
  await s.post("/ingest", again);
  const odd = s.R("watch-7", b, "button", { button: "symptom" });
  const mixed = await s.post("/ingest", [s.R("watch-0042", b, "vitals", { hr_bpm: 82, spo2_pct: 97, temp_c: 36.8 }), again, { id: "bad-1", device: "watch-0042", kind: "smell" }, odd]);
  assert.strictEqual(mixed.status, 200);
  assert.deepStrictEqual([mixed.body.accepted, mixed.body.duplicates], [2, 1]);
  assert.deepStrictEqual(mixed.body.rejected, [{ id: "bad-1", problems: ["missing block", "missing time", "missing values", 'unknown kind "smell"'] }]);
  assert.deepStrictEqual(mixed.body.warnings.map((w) => w.id), [odd.id]);
  assert.match(mixed.body.warnings[0].warnings[0], /device id "watch-7" does not match CONTRACT\.md section 3/);
  // nothing usable: 422, like the catcher. Only duplicates: still 200.
  const none = await s.post("/ingest", [{ id: "bad-2" }]);
  assert.deepStrictEqual([none.status, none.body.accepted, none.body.duplicates, none.body.rejected.length], [422, 0, 0, 1]);
  const dup = await s.post("/ingest", again);
  assert.deepStrictEqual([dup.status, dup.body], [200, { accepted: 0, duplicates: 1, rejected: [], warnings: [] }]);
  const junk = await s.post("/ingest", "{not json");
  assert.deepStrictEqual([junk.status, junk.body], [400, { error: "body is not JSON" }]);
});

test("GET /live: `event: reading` per accepted message with the message as data, alerts as `event: alert`, each with an id", async () => {
  const b = "l7-chalk-cut";
  const res = await fetch(s.api + "/live");
  assert.strictEqual(res.headers.get("content-type"), "text/event-stream");
  assert.strictEqual(res.headers.get("access-control-allow-origin"), "*");
  await res.body.cancel();
  const live = events(s.api + "/live", { want: 3 });
  await pause(100);
  const clean = s.R("sensor", b, "water", { tds_ppm: 240, turbidity_ntu: 0.8 }, Date.now() - 2000, { hops: 1, via: ["relay-l7-chalk-cut"] });
  const salty = s.R("sensor", b, "water", { tds_ppm: 1450, turbidity_ntu: 1.1 }, Date.now() - 1000);
  await s.post("/ingest", [salty, clean, { id: "rejected-1" }]); // sent newest first: the stream still plays them in time order
  const ev = await live;
  assert.deepStrictEqual(ev.map((e) => e.event), ["reading", "reading", "alert"]);
  assert.deepStrictEqual(ev.map((e) => e.data.id), [clean.id, salty.id, `alert-${salty.id}-0`]);
  for (const f of ["id", "device", "block", "time", "kind", "values", "hops", "via"]) assert.deepStrictEqual(ev[0].data[f], clean[f], `reading.${f} is the message as sent`);
  assert.deepStrictEqual(ev.map((e) => e.id), ev.map((e) => e.data.seq), "the SSE id is the message's seq");
  assert.ok(ev[1].id === ev[0].id + 1 && ev[2].id === ev[1].id + 1, "ids rise by one");
  assert.match(ev[2].data.values.text, /Do not drink/);
  assert.ok(!JSON.stringify(ev).includes("rejected-1"), "a rejected message is never sent");
});

test("GET /live: Last-Event-ID (or ?lastEventId=) replays exactly what was missed, in order, then continues live", async () => {
  const b = "l6-rail-row";
  const seq0 = (await s.get("/status")).seq;
  const missed = [1, 2, 3].map((i) => s.R("sensor", b, "flood", { depth_cm: i }));
  for (const m of missed) await s.post("/ingest", m);
  const live = events(s.api + "/live", { headers: { "Last-Event-ID": String(seq0) }, want: 4 });
  await pause(150);
  const next = s.R("sensor", b, "flood", { depth_cm: 4 });
  await s.post("/ingest", next);
  const ev = await live;
  assert.deepStrictEqual(ev.map((e) => e.id), [seq0 + 1, seq0 + 2, seq0 + 3, seq0 + 4], "no gap, no repeat");
  assert.deepStrictEqual(ev.map((e) => [e.event, e.data.id]), [...missed, next].map((m) => ["reading", m.id]));
  const viaQuery = await events(`${s.api}/live?lastEventId=${seq0 + 2}`, { want: 2, timeoutMs: 1000 });
  assert.deepStrictEqual(viaQuery.map((e) => e.id), [seq0 + 3, seq0 + 4]);
  assert.strictEqual((await events(s.api + "/live", { want: 1, timeoutMs: 300 })).length, 0, "a first connection gets live events only");
  // the older /feed stream carries the same events, unnamed, so existing onmessage code keeps working
  const feed = await events(`${s.api}/feed?lastEventId=${seq0 + 2}`, { want: 2, timeoutMs: 1000 });
  assert.deepStrictEqual(feed.map((e) => [e.id, e.event]), [[seq0 + 3, undefined], [seq0 + 4, undefined]]);
  // a client that is ahead of the server (the data file was wiped) is told to start over
  const raw = await fetch(`${s.api}/live?lastEventId=99999999`);
  const reader = raw.body.getReader();
  let text = "";
  while (!text.includes("event: reset")) text += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  assert.match(text, /event: reset\ndata: \{"seq":\d+\}/);
});

test("GET /blocks/<block id>/latest: the latest message of each kind for that block", async () => {
  const b = "l5-seam-row", t0 = Date.now();
  const empty = await s.getRaw(`/blocks/${b}/latest`);
  assert.deepStrictEqual([empty.status, empty.body], [200, { block: b, name: "Seam Row", level: "L5", people: 422000, source: null, latest: {} }]);
  const old = s.R("sensor", b, "air", { co2_ppm: 700, temp_c: 24, humidity_pct: 50 }, t0 - 60e3);
  const air = s.R("sensor", b, "air", { co2_ppm: 720, temp_c: 24.5, humidity_pct: 51 }, t0 - 10e3, { source: "live" });
  const water = s.R("sensor", b, "water", { tds_ppm: 1200, turbidity_ntu: 1 }, t0 - 30e3);
  const vit = s.R("watch-0301", b, "vitals", { hr_bpm: 70, spo2_pct: 98, temp_c: 36.6 }, t0 - 20e3);
  const other = s.R("sensor", "l5-sump-bend", "air", { co2_ppm: 999, temp_c: 20, humidity_pct: 40 }, t0);
  await s.post("/ingest", [air, old, water, vit, other]); // out of order on purpose
  const got = await s.get(`/blocks/${b}/latest`);
  assert.deepStrictEqual(Object.keys(got.latest).sort(), ["air", "vitals", "water"], "one entry per kind; the alert the water raised is not a device kind");
  assert.deepStrictEqual([got.latest.air.id, got.latest.water.id, got.latest.vitals.id], [air.id, water.id, vit.id]);
  assert.deepStrictEqual(got.latest.air.values, air.values);
  assert.strictEqual(got.source, "live", "the block's newest message came from live hardware");
  // the surface scout's block works too; an unknown block is a 404 with the reason
  await s.post("/ingest", s.R("surface-01", "surface", "surface", { co2_ppm: 430, temp_c: 17.5, radiation_usv_h: 0.31 }));
  const up = await s.get("/blocks/surface/latest");
  assert.deepStrictEqual([up.block, up.name, up.level, Object.keys(up.latest)], ["surface", "Surface", null, ["surface"]]);
  const bad = await s.getRaw("/blocks/l9-nowhere/latest");
  assert.strictEqual(bad.status, 404);
  assert.match(bad.body.error, /unknown block "l9-nowhere"/);
  assert.ok(Array.isArray(await s.get("/blocks")), "GET /blocks (every block at once) still answers");
});

test("GET /help: open help requests, highest priority first; POST /help/<message id>/assign marks one as assigned", async () => {
  const mild = s.R("watch-0401", "l4-coke-yard", "button", { button: "help" }, Date.now() - 3000);
  const sick = s.R("watch-0402", "l8-canary-bend", "button", { button: "help" }, Date.now() - 2000, { hops: 1, via: ["relay-l8-canary-bend"] });
  const fever = s.R("watch-0403", "l5-ash-yard", "button", { button: "help" }, Date.now() - 1000);
  await s.post("/ingest", [
    s.R("watch-0401", "l4-coke-yard", "vitals", { hr_bpm: 78, spo2_pct: 98, temp_c: 36.8 }, Date.now() - 9000),
    s.R("watch-0402", "l8-canary-bend", "vitals", { hr_bpm: 132, spo2_pct: 89, temp_c: 39.2 }, Date.now() - 8000),
    s.R("watch-0403", "l5-ash-yard", "vitals", { hr_bpm: 96, spo2_pct: 96, temp_c: 38.4 }, Date.now() - 7000),
    mild, sick, fever]);
  const mine = (list) => list.filter((x) => [mild.id, sick.id, fever.id].includes(x.id));
  let help = mine(await s.get("/help"));
  assert.deepStrictEqual(help.map((x) => x.id), [sick.id, fever.id, mild.id], "ranked by need, not by who pressed first");
  assert.ok(help[0].score > help[1].score && help[1].score > help[2].score);
  assert.deepStrictEqual([help[0].device, help[0].block, help[0].status, help[0].assigned_to, help[0].hops, help[0].via], ["watch-0402", "l8-canary-bend", "open", null, 1, sick.via]);
  assert.deepStrictEqual(help[0].vitals, { hr_bpm: 132, spo2_pct: 89, temp_c: 39.2 });
  assert.ok(help[0].reasons.length === 4, "every point is explained");
  assert.deepStrictEqual(mine(await s.get("/queue")).map((x) => x.id), help.map((x) => x.id), "/queue is the same list under its old name");

  // assign the top request to the rover, exactly as the contract writes it
  const r = await s.post(`/help/${encodeURIComponent(sick.id)}/assign`, { to: "rover-01" });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([r.body.assigned.id, r.body.assigned.status, r.body.assigned.assigned_to], [sick.id, "assigned", "rover-01"]);
  assert.ok(!Number.isNaN(Date.parse(r.body.assigned.assigned_at)));
  help = mine(await s.get("/help"));
  assert.deepStrictEqual(help.map((x) => x.id), [fever.id, mild.id], "an assigned request is no longer open");
  assert.ok((await s.get("/inbox?device=watch-0402")).some((a) => a.values.text === "rover-01 sent to watch-0402 in l8-canary-bend"), "the resident is told who is coming");
  // the rover can ask what it was given; the twin can ask for everything
  const jobs = await s.get("/help?status=assigned&to=rover-01");
  assert.deepStrictEqual(jobs.map((x) => [x.id, x.assigned_to]), [[sick.id, "rover-01"]]);
  assert.deepStrictEqual(mine(await s.get("/help?status=all")).map((x) => [x.id, x.status]), [[sick.id, "assigned"], [fever.id, "open"], [mild.id, "open"]]);

  // what cannot be assigned says why
  const twice = await s.post(`/help/${encodeURIComponent(sick.id)}/assign`, { to: "rover-02" });
  assert.deepStrictEqual([twice.status, twice.body.error], [409, "already assigned to rover-01"]);
  assert.strictEqual((await s.post("/help/no-such-message/assign", { to: "rover-01" })).status, 404);
  assert.strictEqual((await s.post(`/help/${encodeURIComponent(fever.id)}/assign`, {})).status, 400);
  assert.strictEqual((await s.post(`/help/${encodeURIComponent(fever.id)}/assign`, "{not json")).status, 400);
  assert.strictEqual((await s.getRaw("/help?status=closed")).status, 400);
  // the original POST /dispatch still works and takes the next one in the queue
  const d = await s.post("/dispatch", { responder: "rover-02", block: "l5-ash-yard" });
  assert.deepStrictEqual([d.body.assigned.id, d.body.assigned.assigned_to], [fever.id, "rover-02"]);
  // assignments survive a restart
  await s.restart();
  assert.deepStrictEqual(mine(await s.get("/help?status=all")).map((x) => [x.id, x.assigned_to]), [[sick.id, "rover-01"], [fever.id, "rover-02"], [mild.id, null]]);
});

test("POST /help/<id>/assign needs the API key when one is set; GET /help, /live and /broadcast stay open", async () => {
  const h = locked.R("watch-0001", "l1-ash-hollow", "button", { button: "help" });
  await locked.post("/ingest", h, { "x-api-key": "s3cret" });
  assert.strictEqual((await locked.post(`/help/${encodeURIComponent(h.id)}/assign`, { to: "rover-01" })).status, 401);
  assert.strictEqual((await locked.post(`/help/${encodeURIComponent(h.id)}/assign`, { to: "rover-01" }, { "x-api-key": "s3cret" })).status, 200);
  for (const p of ["/help", "/broadcast", "/blocks/l1-ash-hollow/latest"]) assert.strictEqual((await locked.getRaw(p)).status, 200, p);
  const live = await fetch(locked.api + "/live");
  assert.strictEqual(live.status, 200);
  await live.body.cancel();
});

test("GET /broadcast: the latest surface readings, each against its limit, the verdict text and a link to the history", async () => {
  const b = makeServer();
  await b.start();
  try {
    const scout = (values, ms = 0) => b.post("/ingest", b.R("surface-01", "surface", "surface", values, Date.now() + ms));
    let page = await b.get("/broadcast");
    assert.deepStrictEqual([page.verdict, page.photo, page.time, page.history], ["not enough data", null, null, "/surface/history"]);
    assert.match(page.text, /^No verdict yet: 3 of the 3 surface readings the contract requires have not been measured \(radiation_usv_h, co2_ppm, temp_c\)/);
    // the contract's own surface sample, exactly as it is in contract/samples/surface.json: a real verdict on its own
    const sample = JSON.parse(require("fs").readFileSync(require("path").join(REPO, "contract", "samples", "surface.json"), "utf8"));
    assert.strictEqual((await b.post("/ingest", sample)).body.accepted, 1);
    page = await b.get("/broadcast");
    assert.deepStrictEqual([page.verdict, page.missing, page.not_measured.sort()], ["suits OK", [], ["o2_pct", "pm25_ugm3"]], "the contract's three readings give a verdict");
    assert.strictEqual(page.text, "The latest surface readings support going up in suits: every reading measured is inside its human-safe limit, so an open settlement is possible.");
    assert.match(page.reasons[page.reasons.length - 1], /^not measured: oxygen, PM2\.5 \(optional/);
    assert.strictEqual(page.photo.url, "https://example.invalid/surface-01/000012.jpg");
    const rad = page.readings.find((r) => r.reading === "radiation_usv_h");
    assert.deepStrictEqual([rad.value, rad.unit, rad.status, rad.device, rad.required], [0.31, "µSv/h", "ok", "surface-01", true]);
    assert.ok(rad.limits.length === 2 && rad.limits.every((l) => l.value && l.source && /^https:/.test(l.url) && l.option), "each reading comes with its sourced limits and the option each leads to");
    assert.deepStrictEqual(page.readings.filter((r) => r.status === "not measured").map((r) => r.reading).sort(), ["o2_pct", "pm25_ugm3"]);
    // the two optional readings, when measured, can only make it worse
    await scout({ o2_pct: 20.9, pm25_ugm3: 14 }, 5);
    page = await b.get("/broadcast");
    assert.deepStrictEqual([page.verdict, page.not_measured], ["suits OK", []]);
    assert.ok(page.readings.every((r) => r.status === "ok" && /is inside every limit/.test(r.reason)));
    await scout({ co2_ppm: 6000 }, 8);
    page = await b.get("/broadcast");
    assert.strictEqual(page.verdict, "sealed domes needed");
    assert.match(page.text, /support sealed domes: the open air is past a limit for living in it/);
    await scout({ co2_ppm: 430, radiation_usv_h: 2.1, photo_url: "https://example.invalid/surface-01/000013.jpg" }, 10);
    page = await b.get("/broadcast");
    assert.strictEqual(page.verdict, "sealed outposts needed");
    assert.match(page.text, /support sealed outposts only: the surface itself is past a limit for living off it/);
    assert.match(page.reasons[0], /radiation 2\.1 µSv\/h is above 1 µSv\/h \(IAEA/);
    assert.strictEqual(page.photo.url, "https://example.invalid/surface-01/000013.jpg", "the newest photo");
    await scout({ radiation_usv_h: 40 }, 15);
    page = await b.get("/broadcast");
    assert.deepStrictEqual([page.verdict, page.source], ["stay underground", "simulated"]);
    assert.match(page.text, /do not support going up at all/);
    // the link really is the public record, and it holds every reading and verdict change
    const record = await b.get(page.history);
    assert.strictEqual(record.filter((e) => e.type === "reading").length, 5);
    assert.deepStrictEqual(record.filter((e) => e.type === "verdict").map((e) => e.verdict), ["suits OK", "sealed domes needed", "sealed outposts needed", "stay underground"]);
    assert.deepStrictEqual((await b.get("/surface")).verdict, page.verdict, "GET /surface agrees");
  } finally { await b.cleanup(); }
});
