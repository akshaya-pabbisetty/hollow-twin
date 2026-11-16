// Task 2: live vs simulated, so the demo never passes scripted data off as real hardware.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { makeServer, readEvents } = require("./helper");

const s = makeServer();
before(() => s.start());
after(() => s.cleanup());

test("source: missing means simulated, live is kept, anything else is rejected with a reason", async () => {
  const b = "L2-market-01";
  const plain = s.R("sensor-02", b, "air", { co2_ppm: 700 });
  const live = s.R("sensor-02", b, "air", { co2_ppm: 710 }, Date.now(), { source: "live" });
  const sim = s.R("sensor-02", b, "air", { co2_ppm: 720 }, Date.now(), { source: "simulated" });
  assert.strictEqual((await s.post("/ingest", [plain, live, sim])).body.added, 3);
  const hist = await s.get(`/history?block=${b}&kind=air`);
  const by = Object.fromEntries(hist.map((r) => [r.id, r.source]));
  assert.deepStrictEqual([by[plain.id], by[live.id], by[sim.id]], ["simulated", "live", "simulated"]);
  const bad = await s.post("/ingest", s.R("sensor-02", b, "air", { co2_ppm: 1 }, Date.now(), { source: "real" }));
  assert.strictEqual(bad.status, 400);
  assert.strictEqual(bad.body.errors[0].err, "source must be live or simulated");
});

test("source travels through /feed, and an alert inherits the source of the reading that caused it", async () => {
  const b = "L3-farms-04";
  const live = s.R("sensor-03", b, "water", { tds_ppm: 1500, turbidity_ntu: 1 }, Date.now(), { source: "live" });
  const sim = s.R("sensor-03", b, "water", { tds_ppm: 1600, turbidity_ntu: 1 }, Date.now() + 5);
  const feed = readEvents(s.api + "/feed", { want: 4 });
  await new Promise((r) => setTimeout(r, 100));
  await s.post("/ingest", live);
  await s.post("/ingest", sim);
  const ev = (await feed).map((e) => e.data);
  assert.deepStrictEqual(ev.map((r) => [r.kind, r.source]), [["water", "live"], ["alert", "live"], ["water", "simulated"], ["alert", "simulated"]]);
});

test("/blocks says per block whether its latest data is live or simulated", async () => {
  const now = Date.now();
  // block A: simulated first, then real hardware takes over
  await s.post("/ingest", s.R("sensor-05", "L5-rivet-01", "air", { co2_ppm: 800 }, now - 60e3));
  await s.post("/ingest", s.R("sensor-05", "L5-rivet-01", "flood", { depth_cm: 1 }, now - 30e3, { source: "live" }));
  // block B: only scripted data
  await s.post("/ingest", s.R("sensor-06", "L6-borebend-02", "air", { co2_ppm: 800 }, now - 10e3));
  const blocks = await s.get("/blocks");
  const of = (block, kind) => blocks.find((r) => r.block === block && r.kind === kind);
  assert.strictEqual(of("L5-rivet-01", "air").source, "simulated", "the reading keeps its own tag");
  assert.strictEqual(of("L5-rivet-01", "air").block_source, "live", "the block's newest data is live");
  assert.strictEqual(of("L5-rivet-01", "flood").block_source, "live");
  assert.strictEqual(of("L6-borebend-02", "air").block_source, "simulated");
  // a newer simulated reading flips the block back: the tag always describes the latest data
  await s.post("/ingest", s.R("sensor-05", "L5-rivet-01", "air", { co2_ppm: 810 }, now));
  assert.strictEqual((await s.get("/blocks")).find((r) => r.block === "L5-rivet-01" && r.kind === "air").block_source, "simulated");
});

test("source survives a restart, and other endpoints pass it through", async () => {
  await s.post("/ingest", s.R("watch-41", "L4-works-02", "button", { type: "help" }, Date.now(), { source: "live" }));
  const d = await s.post("/dispatch", { responder: "rover-01", block: "L4-works-02" });
  assert.strictEqual(d.body.assigned.device, "watch-41");
  await s.restart();
  const inbox = await s.get("/inbox?device=watch-41");
  assert.ok(inbox.length >= 2);
  assert.ok(inbox.every((a) => a.source === "live"), "help alert and dispatch alert are both tagged live");
  assert.strictEqual((await s.get("/history?block=L6-borebend-02"))[0].source, "simulated");
});
