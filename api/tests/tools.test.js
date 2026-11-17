// Task 6: the team's own files and tools work against this API, unedited.
//   contract/samples/*.json  every sample is accepted exactly as it is in the repository
//   tools/replay.mjs         every round is accepted
//   tools/catcher.mjs        this API answers in the same shapes (the catcher itself is not started here: it
//                            appends to tools/received.ndjson, and tools/ is not lane 1's folder to write in)
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { makeServer, readEvents, REPO } = require("./helper");

const dir = path.join(REPO, "contract", "samples");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
const s = makeServer();
before(() => s.start());
after(() => s.cleanup());
// posts the file's bytes, untouched
const postFile = (f) => fetch(s.api + "/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body: fs.readFileSync(path.join(dir, f)) })
  .then(async (r) => ({ status: r.status, body: await r.json() }));

test("contract/samples has one sample of every contract kind", () => {
  assert.strictEqual(files.length, 9, files.join(", "));
  const kinds = files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).kind).sort();
  assert.deepStrictEqual(kinds, ["air", "button", "checkin", "flood", "power", "surface", "tunnel", "vitals", "water"]);
});

test("every file in contract/samples/ is accepted unchanged, stored as sent, and never warned about its ids", async () => {
  for (const f of files) {
    const sent = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const r = await postFile(f);
    assert.deepStrictEqual([r.status, r.body.accepted, r.body.duplicates, r.body.rejected], [200, 1, 0, []], `${f}: ${JSON.stringify(r.body)}`);
    const got = (await s.get(`/history?kind=${sent.kind}`)).find((m) => m.id === sent.id);
    assert.ok(got, `${f} is in the history`);
    for (const k of ["id", "device", "block", "kind", "values", "hops", "via"]) assert.deepStrictEqual(got[k], sent[k], `${f}: ${k} is stored exactly as sent`);
    // The samples carry a fixed time. While that moment is still ahead of the server's receive time the message is
    // kept with the receive time and says so (CONTRACT.md 1.3); once it has passed, the time is stored as sent.
    if (got.time_estimated) {
      assert.strictEqual(got.device_time, sent.time, f);
      assert.ok(Date.parse(got.time) < Date.parse(sent.time), `${f}: replaced only because it was ahead`);
    } else assert.deepStrictEqual([got.time, got.device_time], [sent.time, undefined], f);
    const other = (got.warnings || []).filter((w) => !/ahead of the server's receive time/.test(w));
    assert.deepStrictEqual(other, [], `${f}: block and device ids fit the contract`);
  }
  // sending the same files again: every one is a duplicate, nothing is stored twice
  for (const f of files) assert.deepStrictEqual((await postFile(f)).body.duplicates, 1, f);
  assert.strictEqual((await s.get("/status")).readings.total, 9);
});

test("the samples drive the contract endpoints: latest per block, the help queue, the family check-in, the broadcast", async () => {
  const latest = (await s.get("/blocks/l8-bore-bend/latest")).latest;
  assert.deepStrictEqual(Object.keys(latest).sort(), ["button", "checkin", "power", "vitals"]);
  assert.deepStrictEqual(latest.power.values, { battery_wh: 412, draw_w: 96, supply_w: 40 });
  assert.deepStrictEqual([latest.checkin.hops, latest.checkin.via], [2, ["relay-l8-bore-bend", "relay-l8-gantry-bend"]]);
  const [help] = await s.get("/help");
  assert.deepStrictEqual([help.id, help.device, help.block], ["watch-0042-000388", "watch-0042", "l8-bore-bend"]);
  assert.deepStrictEqual(help.vitals, { hr_bpm: 104, spo2_pct: 93, temp_c: 38.1 }, "triage used the vitals sample");
  assert.ok((await s.get("/inbox?device=watch-0110")).some((a) => a.values.text === "watch-0042 is OK (l8-bore-bend)"), "the check-in reached the watch in `to`");
  const page = await s.get("/broadcast");
  assert.deepStrictEqual([page.verdict, page.not_measured.sort(), page.photo.url], ["suits OK", ["o2_pct", "pm25_ugm3"], "https://example.invalid/surface-01/000012.jpg"], "the surface sample alone gives a real verdict");
  assert.strictEqual((await s.get("/forecast?block=l8-bore-bend"))[0].hours_left, 7.4);
});

test("node tools/replay.mjs <api>/ingest: every round is accepted (the team's tool, run unedited)", async () => {
  const live = readEvents(s.api + "/feed", { want: 27, timeoutMs: 8000 });
  await new Promise((r) => setTimeout(r, 100));
  const out = await new Promise((res, rej) => execFile(process.execPath, [path.join(REPO, "tools", "replay.mjs"), `${s.api}/ingest`, "0.1", "3"],
    { timeout: 15000 }, (err, stdout, stderr) => (err ? rej(new Error(`${err.message}\n${stdout}\n${stderr}`)) : res(stdout))));
  const rounds = out.trim().split("\n");
  assert.strictEqual(rounds.length, 3, out);
  for (const [i, line] of rounds.entries()) {
    const m = /^round (\d+): (\d+) (.*)$/.exec(line.trim());
    assert.ok(m, line);
    const reply = JSON.parse(m[3]);
    assert.deepStrictEqual([Number(m[1]), Number(m[2]), reply.accepted, reply.duplicates, reply.rejected, reply.warnings], [i + 1, 200, 9, 0, [], []], line);
  }
  const readings = (await live).filter((e) => e.data.kind !== "alert").map((e) => e.data);
  assert.ok(readings.length >= 18 && readings.every((m) => /-replay-\d-/.test(m.id)), "the replayed messages went out on the live stream");
});

test("the replies have the catcher's shapes: same keys, same reasons, same status codes", async () => {
  const post = (body) => fetch(s.api + "/ingest", { method: "POST", headers: { "Content-Type": "application/json" }, body })
    .then(async (r) => ({ status: r.status, body: await r.json() }));
  // what tools/catcher.mjs answers to these three requests (checked by hand against the real catcher)
  const bad = await post('[{"id":"x1","device":"watch-0042","kind":"smell","time":"nope"}]');
  assert.strictEqual(bad.status, 422);
  assert.deepStrictEqual({ accepted: bad.body.accepted, duplicates: bad.body.duplicates, rejected: bad.body.rejected },
    { accepted: 0, duplicates: 0, rejected: [{ id: "x1", problems: ["missing block", "missing values", 'unknown kind "smell"', "time is not ISO 8601"] }] });
  const junk = await post("{oops");
  assert.deepStrictEqual([junk.status, junk.body], [400, { error: "body is not JSON" }]);
  const noId = await post('[{"device":"watch-0042"}]');
  assert.strictEqual(noId.body.rejected[0].id, null, "a message without an id is reported with id null, as the catcher does");
  // the catcher's own source still describes the shapes this test pins down
  const catcher = fs.readFileSync(path.join(REPO, "tools", "catcher.mjs"), "utf8");
  for (const piece of ["JSON.stringify({ accepted, duplicates, rejected })", "event: reading\\ndata: ", "rejected.length && !accepted ? 422 : 200", '{"error":"body is not JSON"}'])
    assert.ok(catcher.includes(piece), `tools/catcher.mjs changed: ${piece}`);
});
