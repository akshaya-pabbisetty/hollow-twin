// The API speaks CONTRACT.md: every kind in the contract's own field names, hops and via passed through,
// old field names accepted as aliases but never written back out.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { makeServer, readEvents } = require("./helper");

const s = makeServer();
before(() => s.start());
after(() => s.cleanup());

let n = 0;
// A message exactly as CONTRACT.md section 1 draws it: id, device, block, time, kind, values, hops, via.
const M = (device, block, kind, values, extra = {}) =>
  ({ id: `${device}-${String(++n).padStart(6, "0")}`, device, block, time: new Date().toISOString(), kind, values, hops: 0, via: [], ...extra });

const EVERY_KIND = () => [
  M("relay-l8-bore-bend", "l8-bore-bend", "power", { battery_wh: 9000, draw_w: 96, supply_w: 96 }),
  M("watch-0042", "l8-bore-bend", "vitals", { hr_bpm: 74, spo2_pct: 98, temp_c: 36.7 }),
  M("watch-0042", "l8-bore-bend", "button", { button: "symptom" }),
  M("watch-0042", "l8-bore-bend", "checkin", { status: "ok", family: "fam-0007", to: ["watch-0110"] },
    { hops: 2, via: ["relay-l8-bore-bend", "relay-l8-gantry-bend"] }),
  M("sensor-l7-chalk-cut", "l7-chalk-cut", "water", { tds_ppm: 240, turbidity_ntu: 0.8 }),
  M("sensor-l7-chalk-cut", "l7-chalk-cut", "air", { co2_ppm: 700, temp_c: 24.5, humidity_pct: 55 }),
  M("sensor-l6-flint-face", "l6-flint-face", "flood", { depth_cm: 3 }),
  M("rover-01", "l6-flint-face", "tunnel", { from_block: "l6-flint-face", to_block: "l6-rail-row", status: "open", reason: "clear", photo_url: "https://example.invalid/rover-01/1.jpg" }),
  M("surface-01", "surface", "surface", { co2_ppm: 430, temp_c: 17.5, radiation_usv_h: 0.31, photo_url: "https://example.invalid/surface-01/1.jpg" }),
];

test("one message of every contract kind is accepted, and comes back exactly as it was sent", async () => {
  const sent = EVERY_KIND();
  const r = await s.post("/ingest", sent);
  assert.deepStrictEqual([r.status, r.body.added, r.body.errors], [200, 9, []]);
  const hist = await s.get("/history");
  for (const m of sent) {
    const got = hist.find((x) => x.id === m.id);
    assert.ok(got, `${m.kind} was stored`);
    for (const f of ["id", "device", "block", "time", "kind", "values", "hops", "via"])
      assert.deepStrictEqual(got[f], m[f], `${m.kind}.${f} is passed through unchanged`);
    assert.strictEqual(got.warnings, undefined, `${m.kind}: a contract message needs no warning`);
    assert.deepStrictEqual([got.source, got.verified, typeof got.seq], ["simulated", false, "number"], "the API's own fields are added");
  }
});

test("hops and via: a relayed message keeps them, a message without them gets 0 and [], wrong types are repaired with a warning", async () => {
  const relayed = M("watch-0110", "l8-gantry-bend", "vitals", { hr_bpm: 80, spo2_pct: 97, temp_c: 36.9 }, { hops: 3, via: ["relay-l8-gantry-bend", "relay-l8-bore-bend", "relay-l7-chalk-cut"] });
  const bare = M("watch-0110", "l8-gantry-bend", "vitals", { hr_bpm: 81, spo2_pct: 97, temp_c: 36.9 });
  delete bare.hops; delete bare.via;
  const broken = M("watch-0110", "l8-gantry-bend", "vitals", { hr_bpm: 82, spo2_pct: 97, temp_c: 36.9 }, { hops: "two", via: "relay-l8-bore-bend" });
  const feed = readEvents(s.api + "/feed", { want: 3 });
  await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual((await s.post("/ingest", [relayed, bare, broken])).body.added, 3);
  const live = Object.fromEntries((await feed).map((e) => [e.data.id, e.data]));
  assert.deepStrictEqual([live[relayed.id].hops, live[relayed.id].via], [3, relayed.via], "the live feed carries hops and via too");
  assert.deepStrictEqual([live[bare.id].hops, live[bare.id].via], [0, []]);
  assert.deepStrictEqual([live[broken.id].hops, live[broken.id].via], [0, []]);
  assert.match(live[broken.id].warnings.join(" | "), /via was not a list of relay ids.*hops was not a whole number/);
  // the same message arriving again by another route (more hops) is a duplicate: the id decides
  const again = await s.post("/ingest", { ...relayed, hops: 5, via: [...relayed.via, "relay-l6-flint-face", "relay-l6-rail-row"] });
  assert.deepStrictEqual([again.body.added, again.body.dupes], [0, 1]);
});

test("old field names still work as aliases, but everything stored and served uses the contract names", async () => {
  const b = "l5-rail-row";
  const vit = M("watch-0077", b, "vitals", { hr: 128, spo2: 90, temp_c: 39.1 });
  const help = M("watch-0077", b, "button", { type: "help" });
  await s.post("/family", { group: "fam-0077", devices: ["watch-0077", "watch-0078"] });
  const ok = M("watch-0077", b, "button", { type: "ok", to: "fam-0077" });
  assert.strictEqual((await s.post("/ingest", [vit, help, ok])).body.added, 3);
  const hist = Object.fromEntries((await s.get(`/history?block=${b}`)).map((r) => [r.id, r]));
  assert.deepStrictEqual(hist[vit.id].values, { temp_c: 39.1, hr_bpm: 128, spo2_pct: 90 });
  assert.deepStrictEqual(hist[help.id].values, { button: "help" });
  assert.deepStrictEqual(hist[ok.id].values, { button: "ok", family: "fam-0077" });
  assert.match(hist[vit.id].warnings[0], /old field names renamed to contract names: hr -> hr_bpm, spo2 -> spo2_pct/);
  assert.match(hist[ok.id].warnings[0], /type -> button, to -> family/);
  // the logic ran on them: triage saw the vitals, the family got the message
  const q = (await s.get("/queue")).find((x) => x.device === "watch-0077");
  assert.deepStrictEqual(q.vitals, { temp_c: 39.1, hr_bpm: 128, spo2_pct: 90 });
  assert.ok(q.score > 100, `low oxygen, fast pulse and fever were all scored (${q.score})`);
  assert.ok((await s.get("/inbox?device=watch-0078")).some((a) => /watch-0077 is OK/.test(a.values.text) && a.values.family === "fam-0077"));
  const everything = JSON.stringify(await s.get("/history")) + JSON.stringify(await s.get("/queue")) + JSON.stringify(await s.get("/status"));
  for (const old of ['"hr":', '"spo2":', '"type":"help"', '"type":"ok"']) assert.ok(!everything.includes(old), `an output still uses the old name ${old}`);
  // a contract name always wins over its alias
  const both = M("watch-0079", b, "vitals", { hr: 1, hr_bpm: 71, spo2_pct: 98, temp_c: 36.6 });
  await s.post("/ingest", both);
  assert.strictEqual((await s.get(`/history?block=${b}`)).find((r) => r.id === both.id).values.hr_bpm, 71);
});

test("what the contract does not allow is refused with a reason", async () => {
  const b = "l8-bore-bend";
  const cases = [
    [{ ...M("watch-0042", b, "alert", { level: "danger", text: "fake" }), device: "backend" }, /kind "alert" is written by the API, never sent by a device/],
    [M("watch-0042", b, "button", { button: "panic" }), /unknown button "panic" \(use help, symptom, ok, volunteer\)/],
    [M("watch-0042", b, "button", {}), /button message needs values\.button/],
    [M("rover-01", b, "tunnel", { from_block: b, to_block: "l8-gantry-bend", status: "blocked" }), /unknown tunnel status "blocked" \(use open or closed\)/],
    [M("watch-0042", b, "checkin", { status: "ok", family: "fam-0007", to: "watch-0110" }), /checkin values\.to must be a list of watch ids/],
    [M("watch-0042", b, "vitals", [70, 98]), /values must be an object/],
    [{ ...M("watch-0042", b, "vitals", {}), time: "yesterday" }, /time is not ISO 8601/],
    [{ ...M("watch-0042", b, "vitals", {}), id: 42 }, /id must be a non-empty string/],
  ];
  for (const [msg, why] of cases) {
    const r = await s.post("/ingest", msg);
    assert.strictEqual(r.status, 400, JSON.stringify(msg));
    assert.match(r.body.errors[0].err, why);
  }
  assert.ok(!(await s.get("/history")).some((r) => r.values.text === "fake"), "nobody outside the API can plant an alert");
});

test("tunnel: a closed tunnel names both ends, the reason and the photo, and reaches residents of both blocks", async () => {
  const from = "l4-drift-yard", to = "l4-ash-hollow";
  await s.post("/ingest", [M("watch-0201", from, "vitals", { hr_bpm: 70, spo2_pct: 98, temp_c: 36.6 }), M("watch-0202", to, "vitals", { hr_bpm: 70, spo2_pct: 98, temp_c: 36.6 })]);
  await s.post("/ingest", M("rover-01", from, "tunnel", { from_block: from, to_block: to, status: "open", reason: "clear", photo_url: "https://example.invalid/a.jpg" }));
  assert.strictEqual((await s.get(`/history?kind=alert&block=${from}`)).length, 0, "an open tunnel is not an alert");
  await s.post("/ingest", M("rover-01", from, "tunnel", { from_block: from, to_block: to, status: "closed", reason: "standing water", photo_url: "https://example.invalid/b.jpg" }));
  const [a] = await s.get(`/history?kind=alert&block=${from}`);
  assert.strictEqual(a.values.text, `Tunnel closed between ${from} and ${to} (standing water): use another route`);
  assert.deepStrictEqual([a.values.from_block, a.values.to_block, a.values.reason, a.values.photo_url], [from, to, "standing water", "https://example.invalid/b.jpg"]);
  for (const w of ["watch-0201", "watch-0202"]) assert.ok((await s.get(`/inbox?device=${w}`)).some((x) => x.id === a.id), `${w} is told`);
});
