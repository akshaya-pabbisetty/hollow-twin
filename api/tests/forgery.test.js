// Forged readings are visible (CONTRACT.md section 4.1): a message with a wrong sig is still refused and never stored
// as a reading, but the refusal goes out on GET /live as `event: forgery` and into the public log at GET /forgeries.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeServer, readEvents } = require("./helper");
const S = require("../sign");

const KEY = "hollow-test-key-0001", WATCH_KEY = "another-secret";
const keysFile = path.join(os.tmpdir(), `ht-forgery-keys-${process.pid}.json`);
fs.writeFileSync(keysFile, JSON.stringify({ "relay-l8-bore-bend": KEY, "watch-0001": WATCH_KEY }));
const s = makeServer({ KEYS: keysFile }); // the default rate limit: 20 per device per second
before(() => s.start());
after(async () => { await s.cleanup(); fs.rmSync(keysFile, { force: true }); });

const b = "l8-bore-bend", relay = "relay-l8-bore-bend";
const power = (values) => s.R(relay, b, "power", values);
const forge = (m) => ({ ...m, sig: S.sign(m, "not-the-key") });
const log = () => s.get("/forgeries");

test("a forged reading is refused, sent on /live as event: forgery, logged at /forgeries, and never stored", async () => {
  const real = power({ battery_wh: 120, draw_w: 400, supply_w: 0 });           // the truth: 0.3 h left
  const fake = { ...real, values: { battery_wh: 9900, draw_w: 96, supply_w: 96 } }; // someone says all is well
  const live = readEvents(s.api + "/live", { want: 3 });
  const feed = readEvents(s.api + "/feed", { want: 1 });
  await new Promise((r) => setTimeout(r, 150));
  const t0 = Date.now();
  const r = await s.post("/ingest", { ...fake, sig: S.sign(real, KEY) }); // a real sig, lifted onto different values
  const t1 = Date.now();

  // still rejected, exactly as before
  assert.strictEqual(r.status, 422);
  assert.deepStrictEqual(r.body.accepted, 0);
  assert.match(r.body.rejected[0].problems[0], /^bad signature for relay-l8-bore-bend: sig does not match/);

  // the public log
  const l = await log();
  assert.deepStrictEqual([l.count, l.kept, l.rate_limited, l.forgeries.length], [1, 1, 0, 1]);
  const f = l.forgeries[0];
  assert.deepStrictEqual([f.n, f.device, f.block, f.kind, f.id, f.claimed_time, f.claimed_values, f.rejected],
    [1, relay, b, "power", fake.id, fake.time, fake.values, true]);
  assert.match(f.reason, /^bad signature for relay-l8-bore-bend/);
  assert.ok(Date.parse(f.time) >= t0 - 1000 && Date.parse(f.time) <= t1 + 1000, "time = when it was refused");
  assert.match(l.rule, /never stored as a reading/);

  // nothing of it is a reading: not in history, not latest, no forecast, no alert, not counted
  assert.ok(!(await s.get("/history")).some((m) => m.id === fake.id));
  assert.deepStrictEqual((await s.get(`/blocks/${b}/latest`)).latest, {});
  assert.strictEqual((await s.get(`/forecast?block=${b}`))[0].level, "unknown");
  assert.deepStrictEqual(await s.get("/history?kind=alert"), []);
  assert.strictEqual((await s.get("/status")).readings.total, 0);

  // the forger cannot burn the id: the genuine message with its real sig still gets in, and raises the real alarm
  assert.strictEqual((await s.post("/ingest", { ...real, sig: S.sign(real, KEY) })).body.accepted, 1);
  assert.strictEqual((await s.get(`/forecast?block=${b}`))[0].level, "alarm");

  // /live: the forgery (no id, so Last-Event-ID is untouched), then the genuine reading and its alert
  const ev = await live;
  assert.deepStrictEqual(ev.map((e) => e.event), ["forgery", "reading", "alert"]);
  assert.deepStrictEqual(ev[0].data, f, "the same entry as the log");
  assert.strictEqual(ev[0].id, undefined, "a forgery has no event id");
  assert.deepStrictEqual([ev[1].id, ev[1].data.id, ev[1].data.verified], [1, real.id, true]);
  // /feed (unnamed events, all of them records) never carries a forgery
  const fe = await feed;
  assert.deepStrictEqual([fe[0].event, fe[0].data.id], [undefined, real.id]);
});

test("only a wrong sig is a forgery: no sig, a sig with no key on file, and other refusals are not", async () => {
  const before = (await log()).count;
  const m = s.R("sensor", "l2-chalk-gallery", "air", { co2_ppm: 640 });
  assert.strictEqual((await s.post("/ingest", m)).body.accepted, 1, "unsigned");
  const n = s.R("sensor", "l2-chalk-gallery", "air", { co2_ppm: 650 });
  assert.strictEqual((await s.post("/ingest", forge(n))).body.accepted, 1, "no key on file: stored unverified");
  assert.strictEqual((await s.post("/ingest", { ...power({ battery_wh: 1 }), block: "l8-borebend", sig: "00" })).status, 422, "unknown block");
  assert.strictEqual((await log()).count, before);
});

test("rate-limited like ingest: at most 20 logged per device per second, also inside one array", async () => {
  await new Promise((res) => setTimeout(res, 1100)); // start in a fresh one-second window (the first test forged as this relay)
  const start = await log();
  // one array of 30 forgeries from the relay, and 3 from a watch, in the same second
  const many = Array.from({ length: 30 }, (_, i) => forge(power({ battery_wh: 9000 + i, draw_w: 1, supply_w: 1 })));
  const few = Array.from({ length: 3 }, () => forge(s.R("watch-0001", b, "vitals", { hr_bpm: 70, spo2_pct: 99, temp_c: 36.6 })));
  const r = await s.post("/ingest", [...many, ...few]);
  assert.deepStrictEqual([r.status, r.body.rejected.length], [422, 33], "every one is still refused, and the reply says so");
  let l = await log();
  assert.strictEqual(l.count - start.count, 23, "20 from the relay, 3 from the watch");
  assert.strictEqual(l.rate_limited - start.rate_limited, 10);
  const relayed = l.forgeries.filter((f) => f.n > start.count && f.device === relay);
  assert.deepStrictEqual(relayed.map((f) => f.claimed_values.battery_wh), Array.from({ length: 20 }, (_, i) => 9000 + i), "the first 20, in order");
  // ?after= returns only newer entries
  assert.deepStrictEqual((await s.get(`/forgeries?after=${start.count + 20}`)).forgeries.map((f) => f.device), ["watch-0001", "watch-0001", "watch-0001"]);
  // a second later the window is open again
  await new Promise((res) => setTimeout(res, 1100));
  await s.post("/ingest", forge(power({ battery_wh: 1, draw_w: 1, supply_w: 1 })));
  l = await log();
  assert.strictEqual(l.count - start.count, 24);
});

test("a large claim is replaced by its size; the log survives a restart and never enters the record", async () => {
  const big = forge(power({ battery_wh: 1, draw_w: 1, supply_w: 1, note: "x".repeat(5000) }));
  await s.post("/ingest", big);
  let l = await log();
  const f = l.forgeries[l.forgeries.length - 1];
  assert.deepStrictEqual([f.id, f.claimed_values, f.via], [big.id, null, []]);
  assert.ok(f.claimed_bytes > 5000);
  assert.ok(JSON.stringify(f).length < 1000, "the public entry stays small");

  const count = l.count, seqBefore = (await s.get("/status")).seq;
  await s.restart();
  l = await log();
  assert.deepStrictEqual([l.count, l.forgeries[l.forgeries.length - 1].n], [count, count], "same log after a restart");
  assert.strictEqual((await s.get("/status")).seq, seqBefore, "forgeries take no seq");
  assert.strictEqual((await s.get(`/history?block=${b}&kind=power`)).length, 1, "of all the relay's power messages, only the genuine one is a reading");
  // a full replay of /live is records only
  const replay = await readEvents(s.api + "/live?lastEventId=0", { want: seqBefore });
  assert.ok(replay.length === seqBefore && replay.every((e) => e.event === "reading" || e.event === "alert"));
  // numbering continues
  await s.post("/ingest", forge(power({ battery_wh: 2, draw_w: 1, supply_w: 1 })));
  assert.strictEqual((await log()).count, count + 1);
});
