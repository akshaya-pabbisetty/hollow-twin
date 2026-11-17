// Task 7: every demo scenario runs clean in --fast mode against a fresh, empty server, speaks the contract, and leaves the
// outcome the video shot is meant to show.
const { test, after } = require("node:test");
const assert = require("node:assert");
const { execFile } = require("child_process");
const path = require("path");
const { makeServer, ROOT, BLOCK_IDS } = require("./helper");

const servers = [];
after(() => Promise.all(servers.map((s) => s.cleanup())));

// Starts a fresh server, runs `node tools/scenario.js <name> <url> --fast`, returns the server and the script's output.
async function run(name, env = {}, serverEnv = {}, fastFlag = true) {
  const s = await makeServer(serverEnv).start();
  servers.push(s);
  const { code, out } = await new Promise((res) =>
    execFile(process.execPath, [path.join(ROOT, "tools/scenario.js"), name, s.api, ...(fastFlag ? ["--fast"] : [])], { env: { ...process.env, INGEST_KEY: "", npm_config_fast: "", ...env } },
      (err, stdout, stderr) => res({ code: err ? err.code : 0, out: stdout + stderr })));
  return { s, code, out };
}
const clean = (r) => {
  assert.strictEqual(r.code, 0, `scenario exited with ${r.code}:\n${r.out}`);
  assert.ok(!/CHECK FAILED/.test(r.out), r.out);
  assert.match(r.out, /All checks passed\./);
};

test("blackout: grid warning first, then the battery forecast counts down through the 24 h warning and the 8 h alarm", async () => {
  const r = await run("blackout"); clean(r);
  const b = "l6-flint-face";
  const f = (await r.s.get(`/forecast?block=${b}`))[0];
  assert.deepStrictEqual([f.hours_left, f.level, f.method], [6.9, "alarm", "net drain"]);
  const alerts = await r.s.get(`/history?kind=alert&block=${b}`);
  const grid = alerts.find((a) => /power cut likely/.test(a.values.text)), battery = alerts.filter((a) => a.values.hours_left !== undefined);
  assert.deepStrictEqual(battery.map((a) => [a.values.level, a.values.hours_left]), [["warn", 23.9], ["danger", 7.9]], "one warning and one alarm");
  assert.ok(grid && grid.seq < battery[0].seq, "grid warning is stored before the battery warning");
  const atWarning = (await r.s.get(`/history?kind=power&block=${b}`)).find((p) => p.id === grid.values.cause).values;
  assert.deepStrictEqual([atWarning.battery_wh, atWarning.supply_w], [1800e6, atWarning.draw_w], "battery full and supply covering the draw when the grid warning fired");
  assert.ok((await r.s.get(`/history?kind=power&block=${b}`)).every((p) => p.device === `relay-${b}` && !p.warnings), "contract device id, no warnings");
});

test("fairshare: Directorate vs fair numbers for the same supply", async () => {
  const r = await run("fairshare"); clean(r);
  assert.match(r.out, /The sector's 70 blocks need 3,212 MW\. Only 1,927 MW is available/);
  assert.match(r.out, /L0\s+4\s+100%\s+60%/, "the top level is served in full by the Directorate");
  assert.match(r.out, /L8\s+10\s+0% {2}10 DARK\s+60%/, "the table shows the deepest level dark under the Directorate and served under fair share");
  assert.match(r.out, /Directorate 18\s+\|\s+fair share 0/);
  assert.strictEqual((await r.s.get("/history")).length, 0, "this shot only reads: it stores nothing");
});

test("networkcut: relay holds readings and a check-in, the backlog hops to a neighbour and goes up, history shows no gap", async () => {
  const r = await run("networkcut"); clean(r);
  const hist = await r.s.get("/history?block=l7-chalk-cut&kind=air");
  assert.strictEqual(hist.length, 12);
  assert.deepStrictEqual(hist.map((x) => x.hops), [0, 0, 0, 0, 2, 2, 2, 2, 2, 2, 0, 0], "the held readings carry the two hops they travelled");
  assert.deepStrictEqual(hist[5].via, ["relay-l7-chalk-cut", "relay-l7-ash-wells"]);
  const told = (await r.s.get("/inbox?device=watch-0011")).find((a) => /watch-0071 is OK \(l7-chalk-cut\)/.test(a.values.text));
  assert.ok(told && told.values.hops === 2 && told.values.family === "fam-0071", "the relayed check-in reached the relative on L1");
  const gaps = hist.slice(1).map((x, i) => Date.parse(x.time) - Date.parse(hist[i].time));
  assert.ok(gaps.every((g) => g === 5000), `gaps: ${gaps}`);
  assert.deepStrictEqual(hist.map((x) => x.values.co2_ppm), Array.from({ length: 12 }, (_, i) => 820 + i * 3), "in the order they were taken");
  assert.match(r.out, /accepted 7, duplicates 1, rejected 0/, "the backlog went up as one request and the duplicate was dropped");
});

test("water: clean cup is silent, salty cup gives do-not-drink", async () => {
  const r = await run("water"); clean(r);
  const inbox = (await r.s.get("/inbox?device=watch-0031")).filter((a) => /Do not drink/.test(a.values.text));
  assert.strictEqual(inbox.length, 1);
  assert.strictEqual(inbox[0].values.limit.key, "water_tds_max_ppm");
  assert.strictEqual((await r.s.get("/history?kind=water")).length, 2);
});

test("outbreak: residents' reports climb while the official count stays at 2", async () => {
  const r = await run("outbreak"); clean(r);
  const row = (await r.s.get("/truth")).blocks.find((b) => b.block === "l8-bore-bend");
  assert.deepStrictEqual([row.residents, row.official, row.gap], [12, 2, 10]);
  const counts = [...r.out.matchAll(/residents' count: (\d+)\s+official count: (\d+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepStrictEqual(counts, [[3, 2], [6, 2], [9, 2], [12, 2]], "the narration shows the climb step by step");
});

test("care: help requests ranked, then a robot dispatched", async () => {
  const r = await run("care"); clean(r);
  const q = await r.s.get("/queue");
  assert.deepStrictEqual(q.map((x) => x.device), ["watch-0043", "watch-0041"], "the dispatched request left the queue");
  assert.ok((await r.s.get("/inbox?device=watch-0042")).some((a) => /rover-01 sent to watch-0042/.test(a.values.text)));
});

test("surface: readings arrive, the verdict and the first-wave list update", async () => {
  const r = await run("surface"); clean(r);
  const v = await r.s.get("/surface");
  assert.strictEqual(v.verdict, "sealed outposts needed");
  const record = (await r.s.get("/surface/history")).filter((e) => e.type === "verdict").map((e) => e.verdict);
  assert.deepStrictEqual(record, ["not enough data", "suits OK", "sealed outposts needed"]);
  const f = await r.s.get("/firstwave");
  assert.deepStrictEqual(f.ranked.map((p) => p.device), ["watch-0052", "watch-0051", "watch-0055"]);
  assert.strictEqual(f.cleared, false, "nobody is sent up to hold an outpost yet");
});

test("all: every shot in order against one fresh server, and everything it sent is tagged simulated", async () => {
  const r = await run("all"); clean(r);
  const shots = [...r.out.matchAll(/SHOT: (\w+):/g)].map((m) => m[1]);
  assert.deepStrictEqual(shots, ["blackout", "fairshare", "networkcut", "water", "outbreak", "care", "surface"]);
  const st = await r.s.get("/status");
  assert.strictEqual(st.readings.live, 0, "scripted data never claims to be live");
  assert.ok(st.readings.simulated > 50);
  assert.ok(Object.values(st.blocks).every((b) => b.source === "simulated"));
  assert.strictEqual(st.surface.verdict, "sealed outposts needed");
  assert.ok(st.forecast.find((f) => f.block === "l6-flint-face").hours_left < 8);
  // every message the scenarios sent is a clean contract message: real block ids, device ids that fit section 3
  const blocks = new Set([...BLOCK_IDS, "surface"]);
  const sent = (await r.s.get("/history")).filter((m) => m.kind !== "alert");
  assert.ok(sent.length > 50);
  for (const m of sent) {
    assert.ok(blocks.has(m.block), `${m.id}: block ${m.block}`);
    assert.match(m.device, /^(watch-\d{4}|rover-\d{2}|surface-\d{2}|(relay|sensor)-l\d-[a-z-]+)$/, m.id);
    assert.strictEqual(m.warnings, undefined, `${m.id}: ${JSON.stringify(m.warnings)}`);
    assert.ok(Number.isInteger(m.hops) && Array.isArray(m.via), `${m.id} carries hops and via`);
  }
  for (const d of ["relay-l6-flint-face", "sensor-l7-chalk-cut", "sensor-l3-ember-yard", "watch-0042", "surface-01"]) assert.ok(sent.some((m) => m.device === d), d);
});

test("npm run scenario is wired up, and --fast is honoured even when npm swallows the flag", async () => {
  const pkg = JSON.parse(require("fs").readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.strictEqual(pkg.scripts.scenario, "node tools/scenario.js");
  const t0 = Date.now();
  const r = await run("water", { npm_config_fast: "true" }, {}, false); // no --fast argument, as when npm keeps it for itself
  clean(r);
  assert.ok(Date.now() - t0 < 4000, "no on-camera pauses");
});

test("scenarios send the API key when INGEST_KEY is set, and explain themselves when it is missing", async () => {
  const withKey = await run("water", { INGEST_KEY: "demo-key" }, { INGEST_KEY: "demo-key" }); clean(withKey);
  const without = await run("water", {}, { INGEST_KEY: "demo-key" });
  assert.strictEqual(without.code, 1);
  assert.match(without.out, /set the INGEST_KEY environment variable/);
});

test("replay.js tags its messages simulated (static check: it runs forever, so it is not executed here)", () => {
  const src = require("fs").readFileSync(path.join(ROOT, "tools/replay.js"), "utf8");
  assert.match(src, /source: "simulated"/);
});
