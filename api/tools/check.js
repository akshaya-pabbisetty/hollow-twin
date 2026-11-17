// Checks a running API (local or deployed), without storing anything.
//   node tools/check.js [apiUrl]
// 1. GET /status answers. 2. GET /live starts streaming straight away (a proxy that buffers would hold it back).
const API = (process.argv[2] || "http://localhost:8787").replace(/\/$/, "");

async function main() {
  let ok = true;
  const t0 = Date.now();
  const st = await fetch(API + "/status").then((r) => r.json());
  console.log(`status: ok in ${Date.now() - t0} ms. ${st.readings.total} readings (${st.readings.live} live, ${st.readings.simulated} simulated), newest event id ${st.seq}, surface: ${st.surface.verdict}`);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  const t1 = Date.now();
  try {
    const res = await fetch(API + "/live", { signal: ctrl.signal });
    const first = await res.body.getReader().read();
    const text = new TextDecoder().decode(first.value);
    console.log(`live:   first bytes after ${Date.now() - t1} ms (${JSON.stringify(text.split("\n")[0])}), X-Accel-Buffering: ${res.headers.get("x-accel-buffering")}`);
    if (!text.includes("connected")) { ok = false; console.log("live:   unexpected first bytes"); }
  } catch (e) {
    ok = false;
    console.log("live:   NOTHING arrived within 8 s. A proxy in front of the API is buffering the stream (see docs/DEPLOY.md, 'Making the live stream work').");
  }
  clearTimeout(timer); ctrl.abort();
  console.log(ok ? "All good." : "Problems found.");
  process.exitCode = ok ? 0 : 1;
}
main().catch((e) => { console.log(`Cannot reach ${API}: ${e.message}`); process.exitCode = 1; });
