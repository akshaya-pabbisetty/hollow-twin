// Task 5: signed readings. A valid sig is stored verified, no sig is stored unverified, a wrong sig is rejected.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeServer, ROOT } = require("./helper");
const S = require("../sign");

const KEY = "hollow-test-key-0001";
const keysFile = path.join(os.tmpdir(), `ht-keys-${process.pid}.json`);
fs.writeFileSync(keysFile, JSON.stringify({ _note: "test keys", "relay-07": KEY, "watch-01": "another-secret" }));
const s = makeServer({ KEYS: keysFile });
before(() => s.start());
after(async () => { await s.cleanup(); fs.rmSync(keysFile, { force: true }); });

// The fixed vector that docs/FIRMWARE.md publishes for the ESP32 code.
const VECTOR = {
  reading: { id: "relay-07-000123", device: "relay-07", block: "L8-deepwell-03", time: "2026-11-01T14:02:11Z",
    kind: "power", values: { battery_pct: 62, draw_w: 41.5, grid_hz: 59.97 } },
  canonical: 'relay-07-000123|relay-07|L8-deepwell-03|2026-11-01T14:02:11Z|power|{"battery_pct":62,"draw_w":41.5,"grid_hz":59.97}',
  sig: "179c1d3d9063acb856085095bd1556297c65e404aedb05024d3c10c748a18dd3",
};

test("test vector: fixed key + reading give the published canonical string and sig", () => {
  assert.strictEqual(S.canonical(VECTOR.reading), VECTOR.canonical);
  assert.strictEqual(S.sign(VECTOR.reading, KEY), VECTOR.sig);
  // computed independently of api/sign.js, straight from the documented rule
  assert.strictEqual(crypto.createHmac("sha256", KEY).update(VECTOR.canonical).digest("hex"), VECTOR.sig);
  // key order in the JSON the device sends does not matter: values keys are sorted before signing
  const shuffled = { ...VECTOR.reading, values: { grid_hz: 59.97, battery_pct: 62, draw_w: 41.5 } };
  assert.strictEqual(S.sign(shuffled, KEY), VECTOR.sig);
  assert.deepStrictEqual(S.TEST_VECTOR.sig, VECTOR.sig);
});

test("the same vector is printed in docs/FIRMWARE.md and by tools/sign.js", () => {
  const doc = fs.readFileSync(path.join(ROOT, "docs/FIRMWARE.md"), "utf8");
  assert.ok(doc.includes(VECTOR.sig), "FIRMWARE.md must contain the expected sig");
  assert.ok(doc.includes(VECTOR.canonical), "FIRMWARE.md must contain the canonical string");
  assert.ok(doc.includes(KEY), "FIRMWARE.md must contain the test key");
  const out = require("child_process").execFileSync(process.execPath, [path.join(ROOT, "tools/sign.js")]).toString();
  assert.ok(out.includes(VECTOR.sig));
});

test("valid sig: stored with verified true (the vector itself, posted to a real server)", async () => {
  const r = await s.post("/ingest", { ...VECTOR.reading, sig: VECTOR.sig, source: "live" });
  assert.deepStrictEqual([r.status, r.body.added], [200, 1]);
  const [got] = await s.get("/history?block=L8-deepwell-03&kind=power");
  assert.strictEqual(got.verified, true);
  assert.strictEqual(got.sig, VECTOR.sig, "the sig is kept so anyone holding the key can re-check the public record");
});

test("no sig: accepted but verified false, and a sender cannot just claim verified", async () => {
  const plain = s.R("relay-07", "L8-deepwell-03", "power", { battery_pct: 61, grid_hz: 60 });
  const liar = { ...s.R("relay-07", "L8-deepwell-03", "power", { battery_pct: 60, grid_hz: 60 }), verified: true };
  assert.strictEqual((await s.post("/ingest", [plain, liar])).body.added, 2);
  const hist = await s.get("/history?block=L8-deepwell-03&kind=power");
  assert.strictEqual(hist.find((r) => r.id === plain.id).verified, false);
  assert.strictEqual(hist.find((r) => r.id === liar.id).verified, false);
});

test("bad signature: rejected with a reason and not stored", async () => {
  const base = s.R("relay-07", "L8-deepwell-03", "power", { battery_pct: 10, grid_hz: 60 });
  const good = S.sign(base, KEY);
  const cases = {
    "sig made with the wrong key": { ...base, sig: S.sign(base, "not-the-key") },
    "values changed after signing (a faked reading)": { ...base, values: { battery_pct: 99, grid_hz: 60 }, sig: good },
    "block changed after signing": { ...base, block: "L0-crown-01", sig: good },
    "time changed after signing": { ...base, time: new Date(Date.now() - 5000).toISOString(), sig: good },
    "sig is not hex": { ...base, sig: "zz-not-a-signature" },
    "sig is the wrong type": { ...base, sig: 12345 },
    "sig is empty": { ...base, sig: "" },
  };
  for (const [name, r] of Object.entries(cases)) {
    const res = await s.post("/ingest", r);
    assert.strictEqual(res.status, 400, name);
    assert.match(res.body.errors[0].err, /^bad signature for relay-07/, name);
  }
  assert.ok(!(await s.get("/history")).some((r) => r.id === base.id), "none of the forgeries were stored");
  // the untouched original with its real sig is fine
  assert.strictEqual((await s.post("/ingest", { ...base, sig: good })).body.added, 1);
});

test("a signed reading with no clock (1970) verifies against the time the device sent", async () => {
  const r = { ...s.R("watch-01", "L1-gallery-02", "vitals", { hr: 72, spo2: 98, temp_c: 36.6 }), time: "1970-01-01T00:01:00Z" };
  assert.strictEqual((await s.post("/ingest", { ...r, sig: S.sign(r, "another-secret") })).body.added, 1);
  const got = (await s.get("/history?block=L1-gallery-02"))[0];
  assert.deepStrictEqual([got.verified, got.time_estimated, got.device_time], [true, true, "1970-01-01T00:01:00Z"]);
});

test("sig from a device with no key on file: stored, but unverified and marked unchecked", async () => {
  const r = s.R("sensor-99", "L2-market-01", "air", { co2_ppm: 640 });
  assert.strictEqual((await s.post("/ingest", { ...r, sig: S.sign(r, "whatever") })).body.added, 1);
  const got = (await s.get("/history?block=L2-market-01"))[0];
  assert.strictEqual(got.verified, false);
  assert.match(got.sig_unchecked, /no key on file for sensor-99/);
});

test("alerts say whether the reading that caused them was verified; verified survives a restart", async () => {
  const bad = s.R("relay-07", "L8-deepwell-03", "power", { battery_pct: 59, grid_hz: 59.5 });
  await s.post("/ingest", { ...bad, sig: S.sign(bad, KEY) });
  const unsigned = s.R("relay-08", "L7-sump-03", "power", { battery_pct: 59, grid_hz: 59.5 });
  await s.post("/ingest", unsigned);
  await s.restart();
  const alerts = await s.get("/history?kind=alert");
  assert.strictEqual(alerts.find((a) => a.values.cause === bad.id).values.cause_verified, true);
  assert.strictEqual(alerts.find((a) => a.values.cause === unsigned.id).values.cause_verified, false);
  assert.strictEqual((await s.get("/history?kind=power")).find((r) => r.id === bad.id).verified, true);
});

test("keys.json is gitignored and an example is committed", () => {
  assert.match(fs.readFileSync(path.join(ROOT, ".gitignore"), "utf8"), /^shared\/keys\.json$/m);
  const ex = JSON.parse(fs.readFileSync(path.join(ROOT, "shared/keys.example.json"), "utf8"));
  assert.strictEqual(ex["relay-07"], KEY, "the example holds the test-vector key so the docs can be tried as written");
});
