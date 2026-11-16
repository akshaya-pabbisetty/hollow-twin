// Shared by the test files: starts a real server on a random free port with its own temp data file.
// (Not a test itself: `node --test` only runs *.test.js.)
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let n = 0;

function makeServer(env = {}) {
  const data = path.join(os.tmpdir(), `ht-${process.pid}-${Date.now()}-${++n}.jsonl`);
  const s = { api: null, data, proc: null, seq: 0, out: "" };
  s.start = () => new Promise((res, rej) => {
    s.out = "";
    // PORT 0 = the OS picks a free port, so parallel test files never collide
    s.proc = spawn(process.execPath, [path.join(ROOT, "server.js")],
      { env: { ...process.env, INGEST_KEY: "", RATE_LIMIT: "", DEVICE_KEYS: env.KEYS ? "" : "{}", PORT: "0", DATA: data, ...env } });
    s.proc.stdout.on("data", (d) => {
      s.out += d;
      const m = s.out.match(/API on (http:\/\/localhost:\d+)/);
      if (m) { s.api = m[1]; res(s); }
    });
    s.proc.stderr.on("data", (d) => process.stderr.write(d));
    s.proc.on("error", rej);
  });
  s.stop = () => new Promise((res) => { if (!s.proc || s.proc.exitCode !== null) return res(); s.proc.on("exit", res); s.proc.kill(); });
  s.restart = async () => { await s.stop(); await s.start(); };
  s.cleanup = async () => { await s.stop(); fs.rmSync(data, { force: true }); };
  s.R = (device, block, kind, values, time = Date.now(), extra = {}) =>
    ({ id: `${device}-${++s.seq}`, device, block, time: new Date(time).toISOString(), kind, values, ...extra });
  s.post = (p, body, headers = {}) => fetch(s.api + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json() }));
  s.get = (p) => fetch(s.api + p).then((r) => r.json());
  s.getRaw = (p) => fetch(s.api + p).then(async (r) => ({ status: r.status, headers: r.headers, body: await r.json() }));
  return s;
}

// Reads server-sent events from /feed until `want` events have arrived (or timeout). Returns [{id, event, data}].
async function readEvents(url, { headers = {}, want = 1, timeoutMs = 3000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const events = [];
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (events.length < want) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = {};
        for (const line of chunk.split("\n")) {
          if (line.startsWith("id: ")) ev.id = Number(line.slice(4));
          if (line.startsWith("event: ")) ev.event = line.slice(7);
          if (line.startsWith("data: ")) ev.data = JSON.parse(line.slice(6));
        }
        if (ev.data !== undefined) events.push(ev);
      }
    }
  } catch (e) { if (e.name !== "AbortError") throw e; }
  clearTimeout(timer); ctrl.abort();
  return events;
}

module.exports = { makeServer, readEvents, ROOT };
