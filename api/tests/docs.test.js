// Task 10: the docs teammates rely on stay true to the code.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { makeServer, ROOT } = require("./helper");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const DOCS = ["README.md", "docs/DEPLOY.md", "docs/FIRMWARE.md", "docs/TWIN.md", "DECISIONS.md"];
const s = makeServer();
before(() => s.start());
after(() => s.cleanup());

test("commands are one per line, never chained with && (PowerShell 5 cannot run that)", () => {
  for (const f of DOCS) {
    const blocks = [...read(f).matchAll(/```(\w*)\n([\s\S]*?)```/g)].filter((m) => !["js", "cpp", "json", "html"].includes(m[1]));
    for (const [, , body] of blocks) assert.ok(!body.includes("&&"), `${f} has a chained command:\n${body}`);
  }
});

test("README documents every endpoint the server has, and every documented GET really answers", async () => {
  const readme = read("README.md"), server = read("server.js");
  const routes = [...new Set([...server.matchAll(/p === "(\/[a-z/]+)"/g)].map((m) => m[1]))];
  assert.ok(routes.length >= 17, `found ${routes.length} routes`);
  for (const r of routes) assert.ok(readme.includes(`${r}`), `README is missing ${r}`);
  for (const p of ["/status", "/history", "/blocks", "/forecast", "/fairshare?supply_w=9000", "/queue", "/truth", "/surface", "/surface/history", "/firstwave?n=20", "/limits"])
    assert.strictEqual((await s.getRaw(p)).status, 200, p);
});

test("the original endpoints and fields kept their shape", async () => {
  const b = "L8-deepwell-03";
  await s.post("/ingest", s.R("relay-07", b, "power", { battery_pct: 62, draw_w: 41.5, grid_hz: 59.97 }));
  await s.post("/ingest", s.R("watch-01", b, "button", { type: "help" }));
  await s.post("/official", { block: b, count: 2 });
  const has = (obj, keys, what) => { for (const k of keys) assert.ok(k in obj, `${what} lost the field ${k}`); };
  const hist = await s.get("/history");
  assert.ok(Array.isArray(hist));
  has(hist[0], ["id", "device", "block", "time", "kind", "values"], "a reading");
  has(hist.find((r) => r.kind === "alert").values, ["level", "text", "cause"], "an alert");
  assert.ok(Array.isArray(await s.get("/blocks")));
  has((await s.get(`/forecast?block=${b}`))[0], ["block", "battery_pct", "hours_left", "grid_hz", "grid_stress"], "/forecast");
  const fair = await s.get("/fairshare?supply_w=9000");
  has(fair, ["directorate", "fair"], "/fairshare");
  has(fair.fair, ["policy", "supply_w", "blocks", "dark_blocks", "equity_index"], "/fairshare policy");
  has(fair.fair.blocks[0], ["block", "level", "served_w", "served_pct", "dark"], "/fairshare block");
  has(await s.get("/fairshare?supply_w=9000&policy=fair"), ["policy", "blocks"], "/fairshare?policy=");
  has((await s.get("/queue"))[0], ["id", "device", "block", "time", "score", "vitals"], "/queue");
  const truth = await s.get("/truth");
  has(truth, ["window_h", "residents_total", "official_total", "blocks"], "/truth");
  has(truth.blocks[0], ["block", "residents", "official", "gap"], "/truth block");
  has((await s.post("/ingest", s.R("relay-07", b, "power", { battery_pct: 61 }))).body, ["added", "dupes", "errors"], "/ingest reply");
  has((await s.post("/dispatch", { responder: "rover-01" })).body, ["assigned"], "/dispatch reply");
  assert.deepStrictEqual((await s.post("/family", { group: "g", devices: ["watch-01"] })).body, { ok: true });
  has((await s.get("/family?group=g"))[0], ["device", "last_ok", "block"], "/family");
  assert.ok(Array.isArray(await s.get("/inbox?device=watch-01")));
});

test("FORMAT.md: every original field and kind is still there, new ones are marked optional", () => {
  const f = read("shared/FORMAT.md");
  for (const field of ["id", "device", "block", "time", "kind", "values"]) assert.ok(f.includes(`| \`${field}\` |`), field);
  for (const kind of ["power", "vitals", "button", "water", "air", "flood", "tunnel", "surface", "alert"]) assert.ok(f.includes(`| \`${kind}\` |`), kind);
  for (const v of ["battery_pct", "draw_w", "grid_hz", "hr", "spo2", "temp_c", "tds_ppm", "turbidity_ntu", "co2_ppm", "depth_cm", "photo_url", "radiation_usv_h"]) assert.ok(f.includes(v), v);
  assert.match(f, /`source` \| OPTIONAL/); assert.match(f, /`sig` \| OPTIONAL/);
  assert.match(f, /Optional additions: `o2_pct`.*`pm25_ugm3`/);
});

test("the guides cover what each lane was promised", () => {
  const fw = read("docs/FIRMWARE.md"), tw = read("docs/TWIN.md");
  for (const w of ['"source": "live"', "ONE array", "mbedtls_md_hmac_starts", "/inbox?device=", "Before 2020-01-01", "time_estimated"]) assert.ok(fw.includes(w), `FIRMWARE.md: ${w}`);
  for (const w of ["new EventSource(", "lastEventId", "Last-Event-ID", "SIMULATED", "/surface/history", "/truth", "/firstwave", "broadcast page"]) assert.ok(tw.includes(w), `TWIN.md: ${w}`);
});

test("README numbers match what the server returns (fair share example)", async () => {
  const fair = await s.get("/fairshare?supply_w=9000");
  const deep = fair.fair.blocks.find((x) => x.block === "L8-deepwell-03");
  assert.ok(read("README.md").includes(`"served_w": ${deep.served_w}, "served_pct": ${deep.served_pct}`), `README should show ${deep.served_w} W / ${deep.served_pct}%`);
  assert.strictEqual(fair.fair.equity_index, 0.75);
});
