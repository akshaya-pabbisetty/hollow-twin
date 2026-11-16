// Hollow Twin backend. No dependencies: `node server.js` (from the api folder)
// POST /ingest            one reading or an array (relay backlogs). Duplicates by id are dropped.
//                         Limits: 5 MB body, 20 single posts per device per second (an array is one request, never dropped),
//                         a time before 2020 or more than 5 min ahead is replaced by the receive time (time_estimated).
//                         Messages use the CONTRACT.md format; the old value names (hr, spo2, button type) are accepted as aliases.
//                         If the INGEST_KEY env var is set, every POST needs the header x-api-key.
//                         Optional "sig" (HMAC-SHA256, see sign.js): valid = stored verified:true, wrong = rejected,
//                         none = stored verified:false.
// GET  /feed              server-sent events: every new reading and alert, live. Each event has an id (the record's seq);
//                         reconnect with the Last-Event-ID header or ?lastEventId= to get everything missed, in order
// GET  /history           ?block=&kind=&since=&after_seq=  stored readings in time order (replays a network gap)
// GET  /blocks            latest reading per block and kind
// GET  /forecast          ?block=  battery hours left + grid frequency stress, per block
// GET  /fairshare         ?supply_w=&policy=directorate|fair  who gets power
// GET  /queue             open help requests ranked by triage score
// POST /dispatch          {responder, block}  sends the responder to the top request
// POST /family            {group, devices:[...]}  links watches into a family group
// GET  /inbox             ?device=&after_seq=  alerts addressed to this watch (relays fetch these for watches)
// POST /official          {block, count}  the Directorate's published case count
// GET  /truth             residents' count vs official count, per block
// GET  /surface           latest surface readings vs their limits, and the verdict: suits OK / sealed domes needed /
//                         stay underground / not enough data, with the exact reasons
// GET  /surface/history   append-only public record: every surface reading and every verdict change
// GET  /firstwave         ?n=20  who goes up first: healthy volunteers, never sole caregivers, needed skills first
// GET  /status            everything the twin needs in one poll: forecast per block, alerts in the last hour, help queue,
//                         truth totals, surface verdict, live vs simulated per block, verified vs unverified counts
// GET  /limits            every threshold in use, with its published source (shared/limits.json)
const http = require("http");
const fs = require("fs");
const path = require("path");
const B = require("./blocks");
const C = require("./contract");
const L = require("./logic");
const LIM = require("./limits");
const SIGN = require("./sign");
const SURF = require("./surface");

const PORT = process.env.PORT || 8787;
const DATA = process.env.DATA || path.join(__dirname, "readings.jsonl");
const INGEST_KEY = process.env.INGEST_KEY || "";       // when set, every POST needs header x-api-key
const RATE_LIMIT = Number(process.env.RATE_LIMIT) || LIM.val("ingest_rate_limit_per_s");
const MAX_BODY = LIM.val("ingest_max_body_bytes");
const MAX_FUTURE_MS = LIM.val("ingest_max_future_min") * 60e3;
const MIN_TIME = Date.parse(LIM.val("ingest_min_valid_time"));
const KEYS = SIGN.loadKeys();                          // device -> secret, for checking signed readings
// Who people are: skills and whether someone depends on them alone. Used only by /firstwave.
const PEOPLE = JSON.parse(fs.readFileSync(process.env.PEOPLE || path.join(__dirname, "shared/people.json"), "utf8"));

const readings = [];
const seen = new Set();
const clients = new Set();
const dispatched = new Set();
const families = {};   // group -> [devices]
const official = {};   // block -> count
const forecastWarned = new Set();
let surfaceVerdict = null; // the last verdict written to the public record
let lastSeq = 0;       // every stored record gets the next number; it is the SSE event id and is saved with the record

function load() {
  fs.mkdirSync(path.dirname(DATA), { recursive: true }); // e.g. DATA=/home/data/readings.jsonl on a fresh host
  if (!fs.existsSync(DATA)) return;
  const text = fs.readFileSync(DATA, "utf8");
  // a crash can leave half a line at the end: close it so the next append starts on a fresh line
  if (text.length && !text.endsWith("\n")) fs.appendFileSync(DATA, "\n");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let r;
    try { r = JSON.parse(line); } catch { console.error("skipping a damaged line in the data file"); continue; }
    if (!r || typeof r !== "object") continue;
    if (r._meta) { applyMeta(r._meta); continue; }
    if (!r.source) r.source = "simulated"; // lines written before the field existed
    if (r.verified === undefined && r.kind !== "alert") r.verified = false;
    // lines written before the contract: rename their values so everything served uses contract names
    if (r.kind !== "alert" && r.values && typeof r.values === "object") r.values = C.normalise(r.kind, r.values).values;
    r.seq = lastSeq = Math.max(lastSeq + 1, r.seq || 0); // older files have no seq: number them in file order
    readings.push(r); seen.add(r.id);
    if (r.kind === "alert" && r.values && r.values.surface_verdict) surfaceVerdict = r.values.surface_verdict;
  }
}
function applyMeta(m) {
  if (m.dispatched) dispatched.add(m.dispatched);
  if (m.family) families[m.family.group] = m.family.devices;
  if (m.official) official[m.official.block] = m.official.count;
}
function saveMeta(m) { applyMeta(m); fs.appendFileSync(DATA, JSON.stringify({ _meta: m }) + "\n"); }

// Turns what a device sent into the record we store ({ rec }), or the reasons for refusing it ({ id, problems }).
// The record uses contract names only: legacy value names are renamed here, on the way in.
function accept(r, now) {
  const bad = C.problems(r);
  if (r && typeof r.block === "string" && r.block && B.problem(r.block)) bad.push(B.problem(r.block)); // only blocks in contract/blocks.json, or "surface"
  if (bad.length) return { id: (r && typeof r === "object" && r.id) ?? null, problems: bad };
  // Signature: checked against exactly what the device sent (its own time string and value names), before we touch anything.
  let verified = false, sigUnchecked;
  if (r.sig !== undefined) {
    const key = KEYS[r.device];
    if (key) {
      if (!SIGN.check(r, key)) return { id: r.id, problems: [`bad signature for ${r.device}: sig does not match id|device|block|time|kind|values`] };
      verified = true;
    } else sigUnchecked = `no key on file for ${r.device}`; // cannot check it, so it is stored as unverified
  }
  const { values, renamed } = C.normalise(r.kind, r.values);
  const wrong = C.valueProblems(r.kind, values);
  if (wrong.length) return { id: r.id, problems: wrong };
  const route = C.route(r);
  // a device id that does not fit CONTRACT.md section 3 is noted on the record, never a reason to refuse it
  const warnings = [...route.warnings, ...B.deviceWarnings(r), ...B.messageWarnings({ ...r, values })];
  if (renamed.length) warnings.push(`old field names renamed to contract names: ${renamed.join(", ")}`);
  const rec = { ...r, values, hops: route.hops, via: route.via, source: r.source || "simulated" }; // honest default: only real hardware says "live"
  for (const f of ["seq", "time_estimated", "device_time", "verified", "sig_unchecked", "warnings"]) delete rec[f]; // these are ours to set, never the sender's
  rec.verified = verified;
  if (sigUnchecked) rec.sig_unchecked = sigUnchecked;
  // A time we cannot trust never reaches the timeline: the reading is kept, stamped with the receive time and marked.
  //   before 2020 = an ESP32 that has not synced its clock yet (it reports 1970)
  //   more than a few minutes ahead of this server = a wrong clock, a wrong time zone, or a fixed sample time
  const taken = Date.parse(r.time), early = taken < MIN_TIME, late = taken > now + MAX_FUTURE_MS;
  if (early || late) {
    rec.device_time = r.time;
    rec.time = new Date(now).toISOString();
    rec.time_estimated = true;
    warnings.push(early
      ? `time ${r.time} is before ${LIM.val("ingest_min_valid_time").slice(0, 4)} (device clock not set): stored with the receive time`
      : `time ${r.time} is more than ${LIM.val("ingest_max_future_min")} minutes in the future (server clock ${new Date(now).toISOString()}): stored with the receive time`);
  }
  if (warnings.length) rec.warnings = warnings;
  return { rec };
}

function alert(r, level, text, extra = {}, suffix = "0") {
  // an alert is as real as the reading that caused it: it inherits live/simulated
  return { id: `alert-${r.id}-${suffix}`, device: "backend", block: r.block,
    time: new Date().toISOString(), kind: "alert", values: { level, text, cause: r.id, cause_verified: r.verified === true, ...extra },
    hops: 0, via: [], source: r.source || "simulated" };
}

// Every rule compares a reading with a limit from shared/limits.json and says why it fired:
// alert.values.why is one sentence, .limit is the limit crossed (value, unit, source, url), .limits is all of them.
function rules(r) {
  const v = r.values, out = [];
  if (r.kind === "power") {
    if (typeof v.grid_hz === "number" && L.gridOff(v.grid_hz))
      out.push(alert(r, "danger", `Grid frequency ${v.grid_hz} Hz: power cut likely soon in ${r.block}`,
        { why: L.gridWhy(v.grid_hz), limit: LIM.ref("grid_band_hz"), limits: [LIM.ref("grid_band_hz"), LIM.ref("grid_nominal_hz")] }, "grid"));
    const f = L.forecast(readings, r.block);
    const low = LIM.hits([["battery_warn_hours", f.hours_left, "battery forecast"]]);
    if (low.length && !forecastWarned.has(r.block)) {
      forecastWarned.add(r.block);
      out.push(alert(r, "warn", `${r.block} has about ${Math.round(f.hours_left)} h of battery left`, { hours_left: f.hours_left, ...LIM.because(low) }, "fc"));
    }
    if (f.hours_left !== null && f.hours_left >= LIM.val("battery_warn_hours") + LIM.val("battery_rearm_margin_hours")) forecastWarned.delete(r.block);
  }
  if (r.kind === "water") {
    const h = LIM.hits([["water_tds_max_ppm", v.tds_ppm, "TDS"], ["water_turbidity_max_ntu", v.turbidity_ntu, "turbidity"]]);
    if (h.length) out.push(alert(r, "danger", `Do not drink: tap water failing in ${r.block}`, LIM.because(h)));
  }
  if (r.kind === "air") {
    const bad = LIM.hits([["air_co2_danger_ppm", v.co2_ppm, "CO2"]]), stale = LIM.hits([["air_co2_stale_ppm", v.co2_ppm, "CO2"]]);
    if (bad.length) out.push(alert(r, "danger", `Air unsafe in ${r.block}: CO2 ${v.co2_ppm} ppm`, LIM.because(bad)));
    else if (stale.length) out.push(alert(r, "warn", `Air going stale in ${r.block}: CO2 ${v.co2_ppm} ppm`, LIM.because(stale)));
  }
  if (r.kind === "flood") {
    const h = LIM.hits([["flood_depth_closed_cm", v.depth_cm, "flood depth"]]);
    if (h.length) out.push(alert(r, "warn", `Flooding in ${r.block}: tunnel closed`, LIM.because(h)));
  }
  if (r.kind === "surface") {
    // every verdict change goes on the record (and out on the feed) with the reading that caused it
    const sv = SURF.surface(readings);
    if (sv.verdict !== surfaceVerdict) {
      const level = sv.verdict === SURF.VERDICTS[2] ? "danger" : sv.verdict === SURF.VERDICTS[1] ? "warn" : "info";
      const crossed = sv.readings.filter((x) => x.status === sv.verdict).flatMap((x) => x.limits.filter((l) => LIM.crossed(l.key, x.value)));
      out.push(alert(r, level, `Surface verdict: ${sv.verdict}`, { surface_verdict: sv.verdict, previous: surfaceVerdict,
        reasons: sv.reasons, why: sv.reasons.join("; "), ...(crossed.length ? { limit: crossed[0], limits: crossed } : {}) }, "surface"));
      surfaceVerdict = sv.verdict;
    }
  }
  if (r.kind === "button" && v.button === "volunteer")
    out.push(alert(r, "info", `${r.device} volunteered for the first wave`, { to: [r.device], why: `${r.device} pressed the volunteer button` }, "vol"));
  if (r.kind === "tunnel" && v.status === "closed") {
    // a tunnel joins two blocks: residents of both are told (see /inbox), with the rover's reason and photo
    const ends = [v.from_block, v.to_block].filter((b) => typeof b === "string" && b);
    const where = ends.length === 2 ? `between ${ends[0]} and ${ends[1]}` : `in ${r.block}`;
    const reason = typeof v.reason === "string" && v.reason ? v.reason : null;
    out.push(alert(r, "warn", `Tunnel closed ${where}${reason ? ` (${reason})` : ""}: use another route`,
      { why: `${r.device} reported the tunnel ${where} closed${reason ? `: ${reason}` : ""}`, blocks: [...new Set([r.block, ...ends])],
        ...(ends.length === 2 ? { from_block: ends[0], to_block: ends[1] } : {}), ...(reason ? { reason } : {}),
        ...(v.photo_url ? { photo_url: v.photo_url } : {}) }));
  }
  if (r.kind === "button" && v.button === "help")
    out.push(alert(r, "danger", `Help requested by ${r.device} in ${r.block}`, { why: `${r.device} pressed the help button` }));
  if (r.kind === "button" && v.button === "ok" && v.family && families[v.family]) {
    const to = families[v.family].filter((d) => d !== r.device);
    out.push(alert(r, "info", `${r.device} is OK (${r.block})`, { to, family: v.family, sent: r.time, why: `${r.device} pressed OK for family group ${v.family}` }));
  }
  return out;
}

// Per block: is its newest device reading live hardware or simulated? (alerts are ignored: they only echo their cause)
function blockSources() {
  const out = {};
  for (const r of readings) {
    if (r.kind === "alert") continue;
    const b = (out[r.block] ||= { source: r.source, latest_time: r.time, latest_device: r.device, live_kinds: new Set(), simulated_kinds: new Set() });
    if (Date.parse(r.time) >= Date.parse(b.latest_time)) { b.source = r.source; b.latest_time = r.time; b.latest_device = r.device; }
  }
  // a kind is live when that kind's newest reading in the block is live
  const newest = {};
  for (const r of readings) {
    if (r.kind === "alert") continue;
    const k = `${r.block}|${r.kind}`;
    if (!newest[k] || Date.parse(r.time) >= Date.parse(newest[k].time)) newest[k] = r;
  }
  for (const r of Object.values(newest)) out[r.block][`${r.source}_kinds`].add(r.kind);
  for (const b of Object.values(out)) { b.live_kinds = [...b.live_kinds].sort(); b.simulated_kinds = [...b.simulated_kinds].sort(); }
  return out;
}

const sse = (r) => `id: ${r.seq}\ndata: ${JSON.stringify(r)}\n\n`;

function store(r) {
  if (seen.has(r.id)) return false;
  seen.add(r.id);
  r.seq = ++lastSeq;
  readings.push(r);
  fs.appendFileSync(DATA, JSON.stringify(r) + "\n");
  const msg = sse(r);
  for (const c of clients) c.write(msg);
  return true;
}

function send(res, code, body) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}
// Reads a JSON body. Answers 401 (wrong key) and 413 (too large) itself; bad JSON goes to cb("bad json").
function readBody(req, res, cb) {
  const chunks = []; let size = 0, tooBig = false;
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) { tooBig = true; chunks.length = 0; if (size > LIM.val("ingest_drain_factor") * MAX_BODY) req.destroy(); return; } // keep draining, keep nothing
    chunks.push(c);
  });
  req.on("error", () => {});
  req.on("end", () => {
    if (INGEST_KEY && req.headers["x-api-key"] !== INGEST_KEY) return send(res, 401, { error: "missing or wrong x-api-key header" });
    if (tooBig) return send(res, 413, { error: `body too large: the limit is ${MAX_BODY} bytes. Split the backlog into smaller arrays.`, limit_bytes: MAX_BODY });
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return guard(res, () => cb("bad json")); }
    guard(res, () => cb(null, body));
  });
}
// A bug in one request must never take the server down: answer 500 and keep serving.
function guard(res, fn) {
  try { fn(); } catch (e) {
    console.error("request failed:", e);
    if (!res.headersSent) send(res, 500, { error: "internal error" }); else res.end();
  }
}

// Per-device rate limit for single posts. A relay backlog sent as ONE array is one request and is never dropped.
const rate = new Map(); // device -> { start, count } for the current one-second window
function overLimit(req, body, now) {
  const first = Array.isArray(body) ? body[0] : body;
  const device = req.headers["x-device"] || (first && typeof first.device === "string" ? first.device : null);
  if (!device) return null;
  if (rate.size > LIM.val("ingest_rate_table_max")) rate.clear();
  let w = rate.get(device);
  if (!w || now - w.start >= 1000) rate.set(device, (w = { start: now, count: 0 }));
  w.count++;
  return !Array.isArray(body) && w.count > RATE_LIMIT ? device : null;
}

load();
const server = http.createServer((req, res) => guard(res, () => route(req, res)));
function route(req, res) {
  let url;
  try { url = new URL(req.url, "http://x"); } catch { return send(res, 400, { error: "bad url" }); }
  const q = Object.fromEntries(url.searchParams);
  const p = url.pathname;
  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type, Last-Event-ID, x-api-key, x-device",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
    return res.end();
  }
  if (req.method === "POST" && p === "/ingest") return readBody(req, res, (e, body) => {
    if (e) return send(res, 400, { error: e });
    const now = Date.now(), limited = overLimit(req, body, now);
    if (limited) {
      res.setHeader("Retry-After", "1");
      return send(res, 429, { error: `rate limit: more than ${RATE_LIMIT} requests per second from ${limited}. Wait a second, or send the readings as one array.`, retry_after_s: 1 });
    }
    let added = 0, dupes = 0; const errors = [];
    // backlogs may arrive out of order: process oldest first so forecasts see true order
    const recs = [];
    for (const r of [].concat(body)) {
      const a = accept(r, now);
      if (a.problems) errors.push({ id: a.id, err: a.problems.join("; ") }); else recs.push(a.rec);
    }
    recs.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    for (const r of recs) {
      if (store(r)) { added++; rules(r).forEach(store); } else dupes++;
    }
    send(res, errors.length && !added ? 400 : 200, { added, dupes, errors });
  });
  if (p === "/feed") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive", "Access-Control-Allow-Origin": "*",
      "X-Accel-Buffering": "no" }); // tells nginx-style proxies (Azure, Render) not to hold events back
    res.write(`: connected\nretry: ${LIM.val("feed_retry_ms")}\n\n`);
    // Reconnect: the browser sends the last id it saw; send everything after it, in order, then go live.
    // This block has no awaits, so no event can slip between the replay and joining the live set.
    const lastRaw = req.headers["last-event-id"] ?? q.lastEventId;
    if (lastRaw !== undefined && lastRaw !== "") {
      let last = Number(lastRaw);
      if (!(last >= 0)) last = 0;
      if (last > lastSeq) { // the client is ahead of us: our data file was reset (e.g. a free-tier disk wipe)
        res.write(`event: reset\ndata: ${JSON.stringify({ seq: lastSeq })}\n\n`);
        last = 0;
      }
      for (const r of readings) if (r.seq > last) res.write(sse(r));
    }
    clients.add(res);
    const ping = setInterval(() => res.write(": ping\n\n"), LIM.val("feed_ping_s") * 1000); // keeps proxies from closing it
    req.on("close", () => { clients.delete(res); clearInterval(ping); });
    return;
  }
  if (p === "/history") {
    const since = q.since ? Date.parse(q.since) : 0, afterSeq = Number(q.after_seq) || 0;
    return send(res, 200, readings
      .filter((r) => (!q.block || r.block === q.block) && (!q.kind || r.kind === q.kind) && Date.parse(r.time) >= since && r.seq > afterSeq)
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time)));
  }
  if (p === "/blocks") {
    const latest = {};
    for (const r of readings) {
      const k = `${r.block}|${r.kind}`;
      if (!latest[k] || Date.parse(r.time) > Date.parse(latest[k].time)) latest[k] = r;
    }
    const src = blockSources();
    return send(res, 200, Object.values(latest).map((r) => ({ ...r, block_source: src[r.block] ? src[r.block].source : r.source })));
  }
  if (p === "/forecast") {
    const blocks = q.block ? [q.block] : [...new Set(readings.filter((r) => r.kind === "power").map((r) => r.block))];
    return send(res, 200, blocks.map((b) => L.forecast(readings, b)));
  }
  if (p === "/fairshare") {
    const supply = Number(q.supply_w);
    if (!(supply >= 0)) return send(res, 400, { error: "supply_w required" });
    const sector = L.sector();
    if (q.policy) return send(res, 200, L.allocate(sector, supply, q.policy));
    return send(res, 200, { directorate: L.allocate(sector, supply, "directorate"), fair: L.allocate(sector, supply, "fair") });
  }
  if (p === "/queue") return send(res, 200, L.queue(readings, dispatched));
  if (req.method === "POST" && p === "/dispatch") return readBody(req, res, (e, b) => {
    if (e || !b || typeof b !== "object") return send(res, 400, { error: e || "need a JSON object" });
    const pick = L.pickRequest(L.queue(readings, dispatched), b.block);
    if (!pick) return send(res, 200, { assigned: null });
    saveMeta({ dispatched: pick.id });
    const a = alert(readings.find((r) => r.id === pick.id) || { id: pick.id, block: pick.block }, "info", `${b.responder || "responder"} sent to ${pick.device} in ${pick.block}`,
      { to: [pick.device], responder: b.responder }, "dispatch");
    store(a);
    send(res, 200, { assigned: pick });
  });
  if (req.method === "POST" && p === "/family") return readBody(req, res, (e, b) => {
    if (e || !b || !b.group || !Array.isArray(b.devices)) return send(res, 400, { error: "need group and devices[]" });
    saveMeta({ family: { group: b.group, devices: b.devices } });
    send(res, 200, { ok: true });
  });
  if (p === "/family") {
    const devs = families[q.group];
    if (!devs) return send(res, 404, { error: "unknown group" });
    return send(res, 200, devs.map((d) => {
      const last = readings.filter((r) => r.device === d && r.kind === "button" && r.values.button === "ok")
        .sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
      return { device: d, last_ok: last ? last.time : null, block: last ? last.block : null };
    }));
  }
  if (p === "/inbox") {
    if (!q.device) return send(res, 400, { error: "device required" });
    const afterSeq = Number(q.after_seq) || 0; // relays pass the last seq they forwarded to get only new alerts
    return send(res, 200, readings.filter((r) => r.kind === "alert" && r.seq > afterSeq &&
      ((r.values.to && r.values.to.includes(q.device)) ||
       (!r.values.to && readings.some((x) => x.device === q.device && (x.block === r.block || (r.values.blocks || []).includes(x.block)))))));
  }
  if (req.method === "POST" && p === "/official") return readBody(req, res, (e, b) => {
    if (e || !b || !b.block || typeof b.count !== "number") return send(res, 400, { error: "need block and count" });
    saveMeta({ official: { block: b.block, count: b.count } });
    send(res, 200, { ok: true });
  });
  if (p === "/surface") return send(res, 200, SURF.surface(readings));
  if (p === "/surface/history") return send(res, 200, SURF.surfaceHistory(readings));
  if (p === "/firstwave") {
    const n = q.n === undefined ? LIM.val("firstwave_default_n") : Math.floor(Number(q.n));
    if (!(n >= 1)) return send(res, 400, { error: "n must be a whole number of 1 or more" });
    const sv = SURF.surface(readings);
    const openHelp = new Set(L.queue(readings, dispatched).map((x) => x.device));
    // the list is always ranked, but it is only a go when the surface verdict allows people up at all
    const cleared = sv.verdict === SURF.VERDICTS[0] || sv.verdict === SURF.VERDICTS[1];
    return send(res, 200, { surface_verdict: sv.verdict, cleared,
      note: cleared ? `Surface verdict is "${sv.verdict}": this is the order people go up.`
        : `Surface verdict is "${sv.verdict}": nobody goes up yet. This is the order they would go.`,
      ...SURF.firstwave(readings, openHelp, PEOPLE, n) });
  }
  if (p === "/status") {
    const now = Date.now(), windowMin = LIM.val("status_alert_window_min");
    const recent = readings.filter((r) => r.kind === "alert" && Date.parse(r.time) >= now - windowMin * 60e3);
    const queue = L.queue(readings, dispatched, now);
    const truth = L.truth(readings, official, now);
    const sv = SURF.surface(readings);
    const data = readings.filter((r) => r.kind !== "alert"); // what devices sent; alerts are ours
    const count = (f) => data.filter(f).length;
    return send(res, 200, {
      time: new Date(now).toISOString(),
      seq: lastSeq, // the newest event id: pass it to /feed?lastEventId= or /history?after_seq= to continue from here
      forecast: [...new Set(readings.filter((r) => r.kind === "power").map((r) => r.block))].sort().map((b) => L.forecast(readings, b)),
      alerts: { window_min: windowMin, count: recent.length,
        by_level: { info: 0, warn: 0, danger: 0, ...Object.fromEntries(["info", "warn", "danger"].map((l) => [l, recent.filter((a) => a.values.level === l).length])) },
        latest: recent.slice(-LIM.val("status_alert_max")).reverse() }, // newest first
      queue: { length: queue.length, top: queue[0] || null },
      truth: { window_h: truth.window_h, residents_total: truth.residents_total, official_total: truth.official_total,
        gap: truth.residents_total - truth.official_total, blocks: truth.blocks },
      surface: { verdict: sv.verdict, reasons: sv.reasons, missing: sv.missing, source: sv.source },
      blocks: blockSources(), // per block: is its newest data live hardware or simulated?
      readings: { total: data.length, verified: count((r) => r.verified === true), unverified: count((r) => r.verified !== true),
        live: count((r) => r.source === "live"), simulated: count((r) => r.source !== "live") },
      feed_clients: clients.size,
    });
  }
  if (p === "/limits") return send(res, 200, LIM.all);
  if (p === "/truth") return send(res, 200, L.truth(readings, official, q.now ? Date.parse(q.now) : Date.now()));
  send(res, 404, { error: "not found" });
}
process.on("uncaughtException", (e) => console.error("uncaught error (server keeps running):", e));
server.listen(PORT, () => console.log(`Hollow Twin API on http://localhost:${server.address().port}`));
module.exports = server;
