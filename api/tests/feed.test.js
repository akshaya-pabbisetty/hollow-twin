// Task 3: the live feed never loses an event across a reconnect or a server restart.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const { makeServer, readEvents } = require("./helper");

const s = makeServer();
before(() => s.start());
after(() => s.cleanup());
const air = (n) => s.R("sensor", "l2-chalk-gallery", "air", { co2_ppm: 700 + n });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test("every event has an id that rises by one, and the proxy headers are set", async () => {
  const res = await fetch(s.api + "/feed");
  assert.strictEqual(res.headers.get("content-type"), "text/event-stream");
  assert.strictEqual(res.headers.get("x-accel-buffering"), "no");
  assert.match(res.headers.get("cache-control"), /no-cache/);
  await res.body.cancel();
  const feed = readEvents(s.api + "/feed", { want: 3 });
  await pause(100);
  for (let i = 0; i < 3; i++) await s.post("/ingest", air(i));
  const ev = await feed;
  assert.deepStrictEqual(ev.map((e) => e.id), [1, 2, 3]);
  assert.deepStrictEqual(ev.map((e) => e.data.seq), [1, 2, 3], "the id is also stored on the record as seq");
});

test("reconnect with Last-Event-ID receives exactly the missed events, in order, then continues live", async () => {
  // the twin saw events up to id 3, then its connection dropped
  const missed = [air(10), air(11), air(12), air(13)];
  for (const r of missed) await s.post("/ingest", r);
  const feed = readEvents(s.api + "/feed", { headers: { "Last-Event-ID": "3" }, want: 5 });
  await pause(150);
  const liveOne = air(14);
  await s.post("/ingest", liveOne); // arrives after the reconnect
  const ev = await feed;
  assert.deepStrictEqual(ev.map((e) => e.id), [4, 5, 6, 7, 8], "no gap, no repeat");
  assert.deepStrictEqual(ev.map((e) => e.data.id), [...missed.map((r) => r.id), liveOne.id]);
  // nothing older than the id is re-sent, and nothing extra arrives
  const again = await readEvents(s.api + "/feed", { headers: { "Last-Event-ID": "8" }, want: 1, timeoutMs: 300 });
  assert.strictEqual(again.length, 0, "fully caught up: nothing to replay");
});

test("?lastEventId= works for clients that cannot set headers; without either, only live events arrive", async () => {
  const viaQuery = await readEvents(s.api + "/feed?lastEventId=6", { want: 2, timeoutMs: 1000 });
  assert.deepStrictEqual(viaQuery.map((e) => e.id), [7, 8]);
  const fresh = await readEvents(s.api + "/feed", { want: 1, timeoutMs: 300 });
  assert.strictEqual(fresh.length, 0, "a first connection gets no replay (use /history or /status for the past)");
  const all = await readEvents(s.api + "/feed?lastEventId=0", { want: 8, timeoutMs: 1000 });
  assert.deepStrictEqual(all.map((e) => e.id), [1, 2, 3, 4, 5, 6, 7, 8], "lastEventId=0 replays everything");
});

test("sequence numbers survive a restart, so a reconnect after a crash still gets what it missed", async () => {
  await s.restart();
  const afterRestart = air(20);
  await s.post("/ingest", afterRestart);
  const ev = await readEvents(s.api + "/feed", { headers: { "Last-Event-ID": "7" }, want: 2, timeoutMs: 1000 });
  assert.deepStrictEqual(ev.map((e) => e.id), [8, 9], "numbering continued from the file, it did not restart at 1");
  assert.strictEqual(ev[1].data.id, afterRestart.id);
  assert.deepStrictEqual((await s.get("/history?after_seq=7")).map((r) => r.seq), [8, 9], "/history?after_seq= gives the same catch-up over plain HTTP");
});

test("restart after a crash that left half a line in the data file: nothing else is lost", async () => {
  const before = (await s.get("/history")).length;
  await s.stop();
  fs.appendFileSync(s.data, '{"id":"torn-1","device":"sensor-l2-chalk-gallery","blo'); // power died mid-write
  await s.start();
  assert.strictEqual((await s.get("/history")).length, before, "the torn line is skipped, every whole line is kept");
  const next = air(30);
  assert.strictEqual((await s.post("/ingest", next)).body.accepted, 1);
  await s.restart();
  const hist = await s.get("/history");
  assert.strictEqual(hist.length, before + 1, "the reading written after the torn line was not glued onto it");
  assert.strictEqual(hist.find((r) => r.id === next.id).seq, before + 1);
});

test("a client that is ahead of the server (data file wiped) is told to reset and gets everything", async () => {
  const res = await fetch(s.api + "/feed?lastEventId=99999");
  const reader = res.body.getReader();
  let buf = "";
  while (!buf.includes("event: reset")) buf += new TextDecoder().decode((await reader.read()).value);
  await reader.cancel();
  assert.match(buf, /event: reset\ndata: \{"seq":\d+\}/);
});
