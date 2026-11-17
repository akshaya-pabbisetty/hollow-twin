// Task 2: the sector is contract/blocks.json. Unknown blocks are refused with a reason ("surface" is allowed);
// device ids are checked against CONTRACT.md section 3 and a mismatch is a warning on the record, never a rejection.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeServer, REPO, BLOCK_IDS } = require("./helper");
const B = require("../blocks");

const file = JSON.parse(fs.readFileSync(path.join(REPO, "contract", "blocks.json"), "utf8"));
const s = makeServer();
before(() => s.start());
after(() => s.cleanup());
const stored = async (id) => (await s.get("/history")).find((r) => r.id === id);

test("the registry is contract/blocks.json: 70 blocks, 9 levels, the people in each", () => {
  assert.strictEqual(B.list.length, 70);
  assert.strictEqual(B.levels.length, 9);
  assert.deepStrictEqual(B.list.map((b) => b.block), file.blocks.map((b) => b.id));
  assert.deepStrictEqual(B.get("l8-bore-bend"), { block: "l8-bore-bend", name: "Bore Bend", level: "L8", depth: 8, level_name: "Deepwell", people: 772000 });
  assert.strictEqual(B.list.reduce((n, b) => n + b.people, 0), file.blocks.reduce((n, b) => n + b.people, 0));
  assert.deepStrictEqual([B.levelOf("l0-rail-wells"), B.levelOf("l8-bore-bend")], [0, 8]);
  assert.ok(!fs.existsSync(path.join(__dirname, "..", "shared", "sector.json")), "the old 9-block sector.json is gone");
});

test("every one of the 70 blocks accepts a message", async () => {
  const r = await s.post("/ingest", BLOCK_IDS.map((b) => s.R("sensor", b, "flood", { depth_cm: 1 })));
  assert.deepStrictEqual([r.status, r.body.accepted, r.body.rejected], [200, 70, []]);
  assert.ok((await s.get("/history?kind=flood")).every((m) => m.warnings === undefined), "sensor-<block id> in its own block needs no warning");
});

test("an unknown block is rejected with a reason; the old demo ids and wrong case get a hint", async () => {
  for (const [block, why] of [
    ["L8-deepwell-03", /^unknown block "L8-deepwell-03": not in contract\/blocks\.json \(block ids look like l0-rail-wells; the surface scout uses "surface"\)\.$/],
    ["l8-bore-bnd", /^unknown block "l8-bore-bnd"/],
    ["L8-Bore-Bend", /Did you mean "l8-bore-bend"\?$/],
    [" l7-chalk-cut ", /Did you mean "l7-chalk-cut"\?$/],
    ["Surface", /Did you mean "surface"\?$/],
  ]) {
    const r = await s.post("/ingest", s.R("watch-0042", block, "vitals", { hr_bpm: 70, spo2_pct: 98, temp_c: 36.6 }));
    assert.strictEqual(r.status, 422, block);
    assert.match(r.body.rejected[0].problems.join("; "), why);
  }
  assert.ok(!(await s.get("/history")).some((m) => m.device === "watch-0042"), "nothing from an unknown block is stored");
  // in a batch only the bad one is refused
  const mix = await s.post("/ingest", [s.R("watch-0042", "l8-bore-bend", "button", { button: "symptom" }), s.R("watch-0042", "nowhere", "button", { button: "symptom" })]);
  assert.deepStrictEqual([mix.status, mix.body.accepted, mix.body.rejected.length], [200, 1, 1]);
});

test('"surface" is the one block that is not in the file', async () => {
  const m = s.R("surface-01", "surface", "surface", { co2_ppm: 430, temp_c: 17.5, radiation_usv_h: 0.31 });
  assert.strictEqual((await s.post("/ingest", m)).body.accepted, 1);
  assert.strictEqual((await stored(m.id)).warnings, undefined);
  // a surface reading filed under an ordinary block is kept, with a note
  const odd = s.R("surface-01", "l0-rail-wells", "surface", { co2_ppm: 431 });
  await s.post("/ingest", odd);
  assert.match((await stored(odd.id)).warnings[0], /surface readings belong to block "surface"/);
});

test("device ids that fit CONTRACT.md section 3 pass silently", async () => {
  const ok = [
    s.R("watch-0042", "l8-bore-bend", "vitals", { hr_bpm: 70, spo2_pct: 98, temp_c: 36.6 }),
    s.R("relay-l8-bore-bend", "l8-bore-bend", "power", { battery_wh: 9000, draw_w: 90, supply_w: 90 }),
    s.R("sensor-l7-chalk-cut", "l7-chalk-cut", "air", { co2_ppm: 700, temp_c: 24, humidity_pct: 50 }),
    s.R("rover-01", "l6-flint-face", "tunnel", { from_block: "l6-flint-face", to_block: "l6-rail-row", status: "open", reason: "clear" }),
    s.R("surface-01", "surface", "surface", { co2_ppm: 430 }),
  ];
  assert.strictEqual((await s.post("/ingest", ok)).body.accepted, 5);
  for (const m of ok) assert.strictEqual((await stored(m.id)).warnings, undefined, m.device);
});

test("a device id that does not fit is a warning on the record, not a rejection", async () => {
  const b = "l8-bore-bend";
  const cases = [
    ["watch-42", /device id "watch-42" does not match CONTRACT\.md section 3 \(watch-<4 digits>, relay-<block id>, sensor-<block id>, rover-<2 digits>, surface-<2 digits>\)/],
    ["watch-00042", /does not match CONTRACT\.md section 3/],
    ["relay-07", /device id "relay-07" does not match CONTRACT\.md section 3: "07" is not a block id \(relay-<block id>\)/],
    ["sensor-l7-chalk-cut", /device sensor-l7-chalk-cut is named for block l7-chalk-cut but this message says block l8-bore-bend/],
    ["rover-1", /does not match CONTRACT\.md section 3/],
    ["scout-01", /does not match CONTRACT\.md section 3/],
    ["Watch-0042", /does not match CONTRACT\.md section 3/],
  ];
  for (const [device, why] of cases) {
    const m = s.R(device, b, "button", { button: "help" });
    const r = await s.post("/ingest", m);
    assert.deepStrictEqual([r.status, r.body.accepted], [200, 1], `${device} must still be stored`);
    const got = await stored(m.id);
    assert.match(got.warnings.join(" | "), why);
  }
  // and the message still did its job: a mislabelled watch can call for help
  const q = await s.get("/queue");
  assert.ok(cases.every(([device]) => q.some((x) => x.device === device)), "every one of them is in the help queue");
});

test("a tunnel end that is not a block is noted; the message is kept", async () => {
  const m = s.R("rover-01", "l6-flint-face", "tunnel", { from_block: "l6-flint-face", to_block: "l6-nowhere", status: "open", reason: "clear" });
  assert.strictEqual((await s.post("/ingest", m)).body.accepted, 1);
  assert.deepStrictEqual((await stored(m.id)).warnings, ['tunnel to_block "l6-nowhere" is not a block id']);
});

test("the people register uses contract watch ids", () => {
  const people = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "shared", "people.json"), "utf8")).people;
  assert.ok(people.length >= 10 && people.every((p) => /^watch-\d{4}$/.test(p.device)), people.map((p) => p.device).join(" "));
});
