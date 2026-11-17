// Task 9: the deployment files match what the server really does (no real deploy is made).
const { test, after } = require("node:test");
const assert = require("node:assert");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { makeServer, ROOT } = require("./helper");

const read = (f) => fs.readFileSync(path.join(ROOT, f), "utf8");
const CODE = fs.readdirSync(ROOT).filter((x) => x.endsWith(".js")); // server.js, logic.js, ... at the top of api/
const dir = path.join(os.tmpdir(), `ht-deploy-${process.pid}`);
const s = makeServer({ DATA: path.join(dir, "nested", "data", "readings.jsonl") });
after(async () => { await s.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

test("zero dependencies: package.json has none and the code only requires Node built-ins or its own files", () => {
  const pkg = JSON.parse(read("package.json"));
  assert.strictEqual(pkg.dependencies, undefined);
  assert.strictEqual(pkg.devDependencies, undefined);
  assert.deepStrictEqual(pkg.scripts, { start: "node server.js", test: "node --test" });
  const builtin = new Set(require("module").builtinModules);
  for (const f of CODE.concat(["tools/scenario.js", "tools/replay.js", "tools/sign.js", "tools/check.js"]))
    for (const m of read(f).matchAll(/require\("([^"]+)"\)/g))
      assert.ok(m[1].startsWith(".") || builtin.has(m[1].replace(/^node:/, "")), `${f} requires ${m[1]}`);
  assert.ok(!/\b(openai|anthropic|llm|gpt)\b/i.test(CODE.map(read).join("\n")), "no AI calls in the server code");
});

test("DATA in a folder that does not exist yet (a fresh persistent mount): the server creates it and persists there", async () => {
  await s.start();
  assert.strictEqual((await s.post("/ingest", s.R("sensor", "l1-winch-gallery", "air", { co2_ppm: 700 }))).body.accepted, 1);
  await s.restart();
  assert.strictEqual((await s.get("/history")).length, 1);
  assert.ok(fs.existsSync(path.join(dir, "nested", "data", "readings.jsonl")));
});

test("tools/check.js passes against a running server and stores nothing", async () => {
  const before = (await s.get("/status")).seq;
  const r = await new Promise((res) => execFile(process.execPath, [path.join(ROOT, "tools/check.js"), s.api], (err, out) => res({ code: err ? err.code : 0, out })));
  assert.strictEqual(r.code, 0, r.out);
  assert.match(r.out, /status: ok/); assert.match(r.out, /feed: {3}first bytes after \d+ ms/); assert.match(r.out, /All good\./);
  assert.strictEqual((await s.get("/status")).seq, before);
});

test("Dockerfile and DEPLOY.md describe the real server", () => {
  const docker = read("Dockerfile"), doc = read("docs/DEPLOY.md");
  assert.match(docker, /CMD \["node", "api\/server\.js"\]/);
  assert.ok(!/npm (install|ci)/.test(docker), "nothing to install");
  assert.match(read("Dockerfile.dockerignore"), /shared\/keys\.json/, "device secrets never go into the image");
  for (const v of ["PORT", "DATA", "INGEST_KEY"]) {
    assert.ok(doc.includes(`\`${v}\``), `DEPLOY.md documents ${v}`);
    assert.ok(read("server.js").includes(`process.env.${v}`), `the server reads ${v}`);
  }
  for (const word of ["Azure App Service", "Render", "X-Accel-Buffering", "Always On", "Last-Event-ID", "ephemeral"]) assert.ok(doc.includes(word), `DEPLOY.md covers ${word}`);
});
