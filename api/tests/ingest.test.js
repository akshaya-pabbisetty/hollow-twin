// Task 4: nothing a device (or an attacker) sends to the API can crash it or corrupt the timeline.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { makeServer } = require("./helper");

const s = makeServer();
const slow = makeServer({ RATE_LIMIT: "5" });      // a tight limit so the rate test is quick and certain
const locked = makeServer({ INGEST_KEY: "s3cret" });
before(() => Promise.all([s.start(), slow.start(), locked.start()]));
after(() => Promise.all([s.cleanup(), slow.cleanup(), locked.cleanup()]));
const MIN = 60e3;

test("oversize body: 413 with a reason, and the server keeps serving", async () => {
  const huge = JSON.stringify({ id: "big-1", device: "relay-l1-winch-gallery", block: "l1-winch-gallery", time: new Date().toISOString(),
    kind: "air", values: { co2_ppm: 1, pad: "x".repeat(6e6) } }); // 6 MB, limit is 5 MB
  const r = await s.post("/ingest", huge);
  assert.strictEqual(r.status, 413);
  assert.match(r.body.error, /body too large/);
  assert.strictEqual(r.body.limit_bytes, 5000000);
  assert.strictEqual((await s.get("/history")).length, 0, "nothing from the oversize body was stored");
  assert.strictEqual((await s.post("/ingest", s.R("relay", "l1-winch-gallery", "air", { co2_ppm: 700 }))).body.accepted, 1);
});

test("malformed JSON on every POST endpoint: a 400 or 422 JSON answer, never a crash", async () => {
  for (const path of ["/ingest", "/dispatch", "/family", "/official"]) {
    for (const body of ["{not json", "", "null", "42", '"text"', "[1,2", "[[]]", "{\"a\":"]) {
      const r = await s.post(path, body);
      assert.ok(r.status === 400 || (path === "/ingest" && r.status === 422) || (path === "/dispatch" && r.status === 200), `${path} with ${JSON.stringify(body)} gave ${r.status}`);
      assert.strictEqual(typeof r.body, "object");
    }
  }
  const mixed = await s.post("/ingest", [null, 7, "x", [], {}, s.R("relay", "l1-winch-gallery", "air", { co2_ppm: 701 })]);
  assert.strictEqual(mixed.body.accepted, 1, "the one good reading in a batch of junk is still stored");
  assert.strictEqual(mixed.body.rejected.length, 5);
  assert.ok((await s.get("/history")).length >= 2, "server still alive");
});

test("unknown routes give 404 JSON", async () => {
  for (const p of ["/nope", "/ingest/extra", "/"]) {
    const r = await s.getRaw(p);
    assert.strictEqual(r.status, 404);
    assert.deepStrictEqual(r.body, { error: "not found" });
  }
  assert.strictEqual((await s.post("/nope", {})).status, 404);
});

test("future timestamp: any time ahead of the receive time never reaches the timeline (kept, stamped with the receive time, device_time kept, warned)", async () => {
  const b = "l4-coke-yard", t0 = Date.now();
  const future = s.R("sensor", b, "air", { co2_ppm: 800 }, t0 + 10 * MIN);
  const ahead = await s.post("/ingest", future);
  const t1 = Date.now();
  assert.deepStrictEqual([ahead.status, ahead.body.accepted], [200, 1], "kept: a wrong clock must not lose a reading");
  let got = (await s.get(`/history?block=${b}`)).find((r) => r.id === future.id);
  assert.strictEqual(got.time_estimated, true);
  assert.strictEqual(got.device_time, future.time, "what the device sent is kept beside it");
  // the receive time, give or take a second for two processes reading the clock (never 10 minutes ahead)
  assert.ok(Date.parse(got.time) >= t0 - 1000 && Date.parse(got.time) <= t1 + 1000, `time ${got.time} should be the receive time, not the future`);
  assert.match(got.warnings.join(" | "), /is ahead of the server's receive time .*stored with the receive time, the device's time kept as device_time/);
  // there is no tolerance any more: 2 minutes ahead (the old rule let anything up to 5 through) is replaced too
  const drift = s.R("sensor", b, "air", { co2_ppm: 801 }, Date.now() + 2 * MIN);
  assert.strictEqual((await s.post("/ingest", drift)).body.accepted, 1);
  got = (await s.get(`/history?block=${b}`)).find((r) => r.id === drift.id);
  assert.deepStrictEqual([got.time_estimated, got.device_time], [true, drift.time], "2 minutes ahead is a fast clock too");
  assert.ok(Date.parse(got.time) <= Date.now() + 1000);
  // under a second ahead (two honest clocks never agree to the millisecond): still replaced, but no warning to act on
  const jitter = s.R("sensor", b, "air", { co2_ppm: 805 }, Date.now() + 800);
  await s.post("/ingest", jitter);
  got = (await s.get(`/history?block=${b}`)).find((r) => r.id === jitter.id);
  assert.strictEqual(got.warnings, undefined, "no warning for clock jitter");
  assert.ok(Date.parse(got.time) <= Date.now() + 1000);
  if (got.time_estimated) assert.strictEqual(got.device_time, jitter.time, "if it was still ahead on arrival, it was replaced and the device's time kept");
  // a time at or before the receive time is left alone
  const past = s.R("sensor", b, "air", { co2_ppm: 802 }, Date.now() - 1000);
  await s.post("/ingest", past);
  got = (await s.get(`/history?block=${b}`)).find((r) => r.id === past.id);
  assert.deepStrictEqual([got.time, got.time_estimated, got.device_time, got.warnings], [past.time, undefined, undefined, undefined]);
  // a reading stamped far ahead cannot push itself to the end of the timeline or into a forecast
  await s.post("/ingest", [s.R("sensor", b, "air", { co2_ppm: 803 }), s.R("sensor", b, "air", { co2_ppm: 804 }, Date.now() + 48 * 3600e3)]);
  const hist = await s.get(`/history?block=${b}`);
  assert.strictEqual(hist.length, 6);
  assert.ok(hist.every((r) => Date.parse(r.time) <= Date.now() + 1000), "nothing stored is dated in the future");
});

test("1970 timestamp (ESP32 with no clock sync): accepted, stamped with the receive time, marked time_estimated", async () => {
  const b = "l5-rail-face", t0 = Date.now();
  const r1970 = { ...s.R("sensor", b, "flood", { depth_cm: 3 }), time: "1970-01-01T00:00:07Z" };
  assert.strictEqual((await s.post("/ingest", r1970)).body.accepted, 1);
  const [got] = await s.get(`/history?block=${b}`);
  assert.strictEqual(got.time_estimated, true);
  assert.strictEqual(got.device_time, "1970-01-01T00:00:07Z");
  assert.match(got.warnings[0], /is before 2020 \(device clock not set\): stored with the receive time/);
  assert.ok(Math.abs(Date.parse(got.time) - t0) < 5000, `time ${got.time} should be the receive time`);
  assert.strictEqual((await s.get(`/history?block=${b}&since=2020-01-01T00:00:00Z`)).length, 1, "it shows up in recent history, not in 1970");
  // a reading with a real clock is left alone, and a sender cannot set the flag itself
  await s.post("/ingest", { ...s.R("sensor", b, "flood", { depth_cm: 4 }, Date.now() - MIN), time_estimated: true, seq: 999999 });
  const real = (await s.get(`/history?block=${b}`)).find((r) => r.values.depth_cm === 4);
  assert.strictEqual(real.time_estimated, undefined);
  assert.notStrictEqual(real.seq, 999999);
  // a whole backlog with no clock keeps the order it was sent in
  const batch = [1, 2, 3, 4].map((i) => ({ ...s.R("sensor", "l0-rail-wells", "flood", { depth_cm: i }), time: `1970-01-01T00:00:0${i}Z` }));
  await s.post("/ingest", batch);
  assert.deepStrictEqual((await s.get("/history?block=l0-rail-wells")).map((r) => r.values.depth_cm), [1, 2, 3, 4]);
});

test("rate limit: default allows 20 single posts a second per device", async () => {
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => s.post("/ingest", s.R("watch-0020", "l2-chalk-gallery", "vitals", { hr_bpm: 70 + i, spo2_pct: 98, temp_c: 36.6 }))));
  assert.ok(rs.every((r) => r.status === 200 && r.body.accepted === 1));
});

test("rate limit hit: 429 with Retry-After for single posts, but a 2,000-reading backlog array is never dropped", async () => {
  const one = () => slow.post("/ingest", slow.R("relay", "l8-bore-bend", "air", { co2_ppm: 600 }));
  const rs = await Promise.all(Array.from({ length: 12 }, one)); // limit is 5 per second here
  const ok = rs.filter((r) => r.status === 200), limited = rs.filter((r) => r.status === 429);
  assert.strictEqual(ok.length + limited.length, 12);
  assert.ok(ok.length >= 5 && limited.length >= 2, `expected some of each, got ${ok.length} ok and ${limited.length} limited`);
  assert.match(limited[0].body.error, /rate limit: more than 5 requests per second from relay-l8-bore-bend/);
  assert.strictEqual(limited[0].headers.get("retry-after"), "1");
  assert.strictEqual(limited[0].body.retry_after_s, 1);
  // other devices are not affected by that relay's flood
  assert.strictEqual((await slow.post("/ingest", slow.R("relay", "l8-gantry-bend", "air", { co2_ppm: 600 }))).status, 200);
  // the same relay, still over its limit, uploads a backlog as ONE array: all of it is stored
  await Promise.all(Array.from({ length: 8 }, one));
  const backlog = Array.from({ length: 2000 }, (_, i) => slow.R("relay", "l8-bore-bend", "air", { co2_ppm: 600 + (i % 40) }, Date.now() - i * 1000));
  const up = await slow.post("/ingest", backlog);
  assert.deepStrictEqual([up.status, up.body.accepted, up.body.rejected.length], [200, 2000, 0]);
  // and after a second the device may post singles again
  await new Promise((r) => setTimeout(r, 1100));
  assert.strictEqual((await one()).status, 200);
  const stored = (await slow.get("/history?block=l8-bore-bend")).filter((r) => r.device === "relay-l8-bore-bend").length;
  assert.ok(stored >= ok.length + 2000 + 1, `every accepted reading is in history (${stored})`);
});

test("INGEST_KEY: POST endpoints need x-api-key, GET endpoints stay open", async () => {
  const r = locked.R("sensor", "l1-winch-gallery", "air", { co2_ppm: 700 });
  const none = await locked.post("/ingest", r);
  assert.strictEqual(none.status, 401);
  assert.match(none.body.error, /x-api-key/);
  assert.strictEqual((await locked.post("/ingest", r, { "x-api-key": "wrong" })).status, 401);
  for (const [path, body] of [["/family", { group: "g", devices: ["watch-0001"] }], ["/official", { block: "l1-winch-gallery", count: 1 }], ["/dispatch", { responder: "rover-01" }]])
    assert.strictEqual((await locked.post(path, body)).status, 401, `${path} must need the key`);
  assert.deepStrictEqual(await locked.get("/history"), [], "nothing was stored without the key");
  const ok = await locked.post("/ingest", r, { "x-api-key": "s3cret" });
  assert.deepStrictEqual([ok.status, ok.body.accepted], [200, 1]);
  assert.strictEqual((await locked.get("/history")).length, 1, "reading needs no key");
  assert.strictEqual((await locked.getRaw("/blocks")).status, 200);
});
