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
  for (const r of [...routes, "/blocks/<block id>/latest", "/help/<message id>/assign"]) assert.ok(readme.includes(`${r}`), `README is missing ${r}`);
  for (const r of ["/live", "/help", "/broadcast"]) assert.ok(routes.includes(r), `the server has the contract endpoint ${r}`);
  assert.ok(server.includes("latest$/.exec(p)") && server.includes("assign$/.exec(p)"), "and the two with an id in the path");
  for (const p of ["/status", "/history", "/blocks", "/blocks/l8-bore-bend/latest", "/forecast", "/fairshare?supply_pct=60", "/help", "/queue", "/broadcast", "/truth", "/surface", "/surface/history", "/firstwave?n=20", "/limits"])
    assert.strictEqual((await s.getRaw(p)).status, 200, p);
});

test("the original endpoints and fields kept their shape", async () => {
  const b = "l8-bore-bend";
  await s.post("/ingest", s.R("relay", b, "power", { battery_wh: 412, draw_w: 96, supply_w: 40, grid_hz: 59.97 }));
  await s.post("/ingest", s.R("watch-0001", b, "button", { button: "help" }));
  await s.post("/official", { block: b, count: 2 });
  const has = (obj, keys, what) => { for (const k of keys) assert.ok(k in obj, `${what} lost the field ${k}`); };
  const hist = await s.get("/history");
  assert.ok(Array.isArray(hist));
  has(hist[0], ["id", "device", "block", "time", "kind", "values"], "a reading");
  has(hist.find((r) => r.kind === "alert").values, ["level", "text", "cause"], "an alert");
  assert.ok(Array.isArray(await s.get("/blocks")));
  has((await s.get(`/forecast?block=${b}`))[0], ["block", "battery_wh", "draw_w", "supply_w", "net_drain_w", "hours_left", "method", "level", "dark", "grid_hz", "grid_stress", "reasons"], "/forecast");
  const fair = await s.get("/fairshare?supply_w=9000");
  has(fair, ["directorate", "fair"], "/fairshare");
  has(fair.fair, ["policy", "supply_w", "blocks", "dark_blocks", "equity_index"], "/fairshare policy");
  has(fair.fair.blocks[0], ["block", "level", "served_w", "served_pct", "dark", "name", "people", "demand_w", "critical_w"], "/fairshare block");
  has(await s.get("/fairshare?supply_w=9000&policy=fair"), ["policy", "blocks"], "/fairshare?policy=");
  has((await s.get("/queue"))[0], ["id", "device", "block", "time", "score", "vitals"], "/queue");
  const truth = await s.get("/truth");
  has(truth, ["window_h", "residents_total", "official_total", "blocks"], "/truth");
  has(truth.blocks[0], ["block", "residents", "official", "gap"], "/truth block");
  has((await s.post("/ingest", s.R("relay", b, "power", { battery_wh: 400, draw_w: 96, supply_w: 40 }))).body, ["accepted", "duplicates", "rejected", "warnings"], "/ingest reply");
  has((await s.post("/dispatch", { responder: "rover-01" })).body, ["assigned"], "/dispatch reply");
  assert.deepStrictEqual((await s.post("/family", { group: "g", devices: ["watch-0001"] })).body, { ok: true });
  has((await s.get("/family?group=g"))[0], ["device", "last_ok", "block"], "/family");
  assert.ok(Array.isArray(await s.get("/inbox?device=watch-0001")));
});

test("CONTRACT.md: every field, kind and value the team agreed is still there; lane 1's additions are optional and in the changelog", () => {
  const c = fs.readFileSync(path.join(ROOT, "..", "CONTRACT.md"), "utf8");
  for (const field of ["id", "device", "block", "time", "kind", "values", "hops", "via"]) assert.ok(c.includes(`| \`${field}\` |`), field);
  for (const kind of ["power", "vitals", "button", "checkin", "water", "air", "flood", "tunnel", "surface"]) assert.ok(c.includes(`| \`${kind}\` |`), kind);
  for (const row of [
    "| `power` | relay box | `battery_wh`, `draw_w`, `supply_w` |",
    "| `vitals` | watch | `hr_bpm`, `spo2_pct`, `temp_c` |",
    "| `button` | watch | `button`: `help`, `symptom` or `ok` |",
    "| `checkin` | watch | `status`: `ok`; `family`: family group ID; `to`: list of watch IDs to reach |",
    "| `water` | sensor node | `tds_ppm`, `turbidity_ntu` |",
    "| `air` | sensor node | `co2_ppm`, `temp_c`, `humidity_pct` |",
    "| `flood` | sensor node | `depth_cm` |",
    "| `tunnel` | scout robot | `from_block`, `to_block`, `status`: `open` or `closed`, `reason`, `photo_url` |",
    "| `surface` | surface scout | `co2_ppm`, `temp_c`, `radiation_usv_h`, `photo_url` |",
  ]) assert.ok(c.includes(row), `the agreed row is untouched: ${row}`);
  const log = c.slice(c.indexOf("## Changelog (lane 1)"));
  assert.ok(c.includes("## Changelog (lane 1)") && log.length > 200, "the changelog section exists");
  for (const added of ["`source`", "`sig`", "`volunteer`", "`o2_pct`", "`pm25_ugm3`", "`alert`", "`warnings`"]) {
    assert.ok(c.includes(added), `CONTRACT.md documents ${added}`);
    assert.ok(log.includes(added), `the changelog lists ${added}`);
  }
});

test("the guides cover what each lane was promised", () => {
  const fw = read("docs/FIRMWARE.md"), tw = read("docs/TWIN.md");
  for (const w of ['"source": "live"', "ONE array", "mbedtls_md_hmac_starts", "/inbox?device=", "Before 2020-01-01", "time_estimated"]) assert.ok(fw.includes(w), `FIRMWARE.md: ${w}`);
  for (const w of ["new EventSource(", "lastEventId", "Last-Event-ID", "SIMULATED", "/surface/history", "/truth", "/firstwave", "broadcast page"]) assert.ok(tw.includes(w), `TWIN.md: ${w}`);
});

test("README numbers match what the server returns (fair share example)", async () => {
  const readme = read("README.md");
  assert.ok(readme.includes("GET /fairshare?supply_pct=60"), "the README shows this example request");
  const fair = await s.get("/fairshare?supply_pct=60&measured=0"); // the README shows a sector with no power readings yet
  const deep = fair.fair.blocks.find((x) => x.block === "l8-bore-bend");
  assert.ok(readme.includes(`"served_w": ${deep.served_w}, "served_pct": ${deep.served_pct}`), `README should show ${deep.served_w} W / ${deep.served_pct}%`);
  assert.ok(readme.includes(`"demand_total_w": ${fair.fair.demand_total_w}`), `README should show the sector demand ${fair.fair.demand_total_w}`);
  assert.ok(readme.includes(`"dark_blocks": [], "equity_index": ${fair.fair.equity_index}`), "README shows the fair-share outcome");
  assert.strictEqual(fair.directorate.dark_blocks.length, 18);
  assert.ok(readme.includes("18 blocks"), "README says how many blocks the Directorate's rule leaves dark");
});
