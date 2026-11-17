// Bad sensors (CONTRACT.md section 1.3): three checks on every device message before it is stored, with every number
// a design choice in shared/limits.json. A message that fails any of them is a sensor error: it is stored with
// "plausible": false, a "sensor_error" sentence and "sensor_flags" (one entry per failed check), raises no alert,
// and is left out of every forecast, verdict, queue and count. The device is told through the reply's warnings.
//
//   1. range: an impossible value (a blood-oxygen reading over 100 %, a negative flood depth).
//   2. jump:  a change faster than the sensor's world can change. The step is measured from the device's last usable
//             reading AND from its previous reading; it is a jump only when both are too far. So a one-off spike is
//             caught, and when the world really steps (a fire, a burst main) the next reading at the new level is
//             close to the flagged one and counts: one reading late, never locked out.
//   3. drift: the device's last readings move steadily away from the other sensors of its kind on its level.
//
// Ported from branch lane1-wip (sensors.js), where jumps and drift were only flagged and still counted.
const LIM = require("./limits");
const B = require("./blocks");

const t = (r) => Date.parse(r.time);
const isNum = (x) => typeof x === "number" && !Number.isNaN(x);
const LABEL = { hr_bpm: "pulse", spo2_pct: "SpO2", temp_c: "temperature", co2_ppm: "CO2", humidity_pct: "humidity", tds_ppm: "TDS",
  turbidity_ntu: "turbidity", depth_cm: "flood depth", battery_wh: "battery", battery_pct: "battery", draw_w: "draw", supply_w: "supply",
  grid_hz: "grid frequency", radiation_usv_h: "radiation", o2_pct: "oxygen", pm25_ugm3: "PM2.5" };
const label = (f) => LABEL[f] || f;

// The limits that apply to a kind, by prefix: plausible_<kind>_<value>, jump_<kind>_<value>, drift_<kind>_<value>.
const keysFor = (prefix, kind) => Object.keys(LIM.all).filter((k) => k.startsWith(`${prefix}_${kind}_`)).map((k) => [k, k.slice(prefix.length + kind.length + 2)]);
// a stored message whose values were impossible: never a baseline for a jump or a drift
const outOfRange = (r) => Array.isArray(r.sensor_flags) && r.sensor_flags.some((f) => f.type === "range");

// 1. Impossible values. Returns the flags (empty = every value is possible).
function implausible(kind, values) {
  return keysFor("plausible", kind).flatMap(([key, field]) => {
    const h = LIM.hits([[key, values[field], label(field)]]);
    return h.length ? [{ type: "range", field, value: values[field], limit: h[0].limit, reason: h[0].why }] : [];
  });
}

// 2. Jumps. `lastGood` is the device's newest usable message of this kind at or before rec's time, `prev` its newest
// message of any standing (except impossible values) at or before rec's time. Either may be undefined.
function jumps(rec, lastGood, prev) {
  if (!lastGood) return [];
  const gapMin = (t(rec) - t(lastGood)) / 60e3;
  if (!(gapMin >= 0) || gapMin > LIM.val("jump_max_gap_min")) return []; // too far apart to call it a jump
  const out = [];
  for (const [key, field] of keysFor("jump", rec.kind)) {
    const a = lastGood.values[field], b = rec.values[field];
    if (!isNum(a) || !isNum(b)) continue;
    const step = +Math.abs(b - a).toFixed(3);
    if (!LIM.crossed(key, step)) continue;
    // confirmed: the reading just before this one was already at (near) the new level, so the world moved
    if (prev && prev !== lastGood && isNum(prev.values[field]) && !LIM.crossed(key, +Math.abs(b - prev.values[field]).toFixed(3))) continue;
    const l = LIM.ref(key);
    out.push({ type: "jump", field, from: a, to: b, step, previous: lastGood.id, limit: l,
      reason: `${label(field)} jumped from ${a} to ${b} ${l.unit} in ${Math.round(gapMin * 60)} s: a step of ${step} ${l.unit} is above ${l.value} ${l.unit} (design choice: ${l.reason})` });
  }
  return out;
}

// What the checks need from what is stored, kept as it grows so a check never scans everything (a 2,000-reading
// backlog must not cost 2,000 x 2,000 comparisons): each device's messages of each kind, sorted oldest first by time
// (then seq), and per kind and level the devices that report it. Times are parsed once, on the way in.
function index() {
  const byDevice = new Map(); // "device|kind" -> [{ r, ms }] oldest first
  const byLevel = new Map();  // "kind|level" -> Set of "device|kind"
  // first position whose time is after `ms` (so everything before it is at or before `ms`)
  const after = (a, ms) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m].ms <= ms) lo = m + 1; else hi = m; } return lo; };
  return {
    add(r) {
      if (r.kind === "alert" || !r.values || typeof r.values !== "object") return;
      const k = `${r.device}|${r.kind}`, ms = t(r);
      let a = byDevice.get(k);
      if (!a) byDevice.set(k, (a = []));
      a.splice(after(a, ms), 0, { r, ms }); // stored last among equal times = the higher seq
      const b = B.get(r.block);
      if (b) { const lk = `${r.kind}|${b.level}`; if (!byLevel.has(lk)) byLevel.set(lk, new Set()); byLevel.get(lk).add(k); }
    },
    // the device's messages of rec's kind at or before rec's time, newest first, as a lazy walk
    *back(rec, key = `${rec.device}|${rec.kind}`) {
      const a = byDevice.get(key) || [];
      for (let i = after(a, t(rec)) - 1; i >= 0; i--) yield a[i].r;
    },
    // the other devices reporting rec's kind on rec's level
    peers(rec) {
      const b = B.get(rec.block), own = `${rec.device}|${rec.kind}`;
      return b ? [...(byLevel.get(`${rec.kind}|${b.level}`) || [])].filter((k) => k !== own) : [];
    },
  };
}
const first = (gen, ok) => { for (const r of gen) if (ok(r)) return r; return undefined; };
function take(gen, ok, n) { const out = []; if (n <= 0) return out; for (const r of gen) if (ok(r) && out.push(r) >= n) break; return out; }

// 3. Drift. The device's last N readings up to rec (rec included) must move steadily away from the median of the
// newest usable readings of the other sensors of the same kind on the same level, and end further from it than the
// drift limit. `idx` is an index() of what is stored (rec is not in it yet).
function drift(rec, idx) {
  const b = B.get(rec.block);
  const keys = keysFor("drift", rec.kind);
  if (!b || !keys.length) return [];
  const n = LIM.val("drift_readings");
  const last = [...take(idx.back(rec), (r) => !outOfRange(r), n - 1).reverse(), rec];
  if (last.length < n) return [];
  const peers = idx.peers(rec);
  const out = [];
  for (const [key, field] of keys) {
    if (!last.every((r) => isNum(r.values[field]))) continue;
    // the newest usable reading, at or before rec's time, of each OTHER sensor of this kind on this level
    const others = peers.map((k) => first(idx.back(rec, k), (r) => r.plausible !== false && isNum(r.values[field]))).filter(Boolean);
    const vals = others.map((r) => r.values[field]).sort((x, y) => x - y);
    if (!vals.length) continue;
    const median = vals.length % 2 ? vals[(vals.length - 1) / 2] : (vals[vals.length / 2 - 1] + vals[vals.length / 2]) / 2;
    // steadily: every step in the same direction; away: ending on the side it is moving toward, further out than it started
    const vs = last.map((r) => r.values[field]), steps = vs.slice(1).map((v, i) => Math.sign(v - vs[i]));
    const dir = steps[0];
    const lastDev = vs[vs.length - 1] - median, firstDev = vs[0] - median;
    const away = dir !== 0 && steps.every((d) => d === dir) && Math.sign(lastDev) === dir && Math.abs(lastDev) > Math.abs(firstDev);
    const off = +Math.abs(lastDev).toFixed(3);
    if (!away || !LIM.crossed(key, off)) continue;
    const l = LIM.ref(key), k = others.length;
    out.push({ type: "drift", field, value: rec.values[field], level_median: median, others: k, deviation: off, readings: n, limit: l,
      reason: `${label(field)} has moved away from the other ${k} ${rec.kind} sensor${k === 1 ? "" : "s"} on ${b.level} over its last ${n} readings (${vs.join(" -> ")} against their median ${median} ${l.unit}): ${off} ${l.unit} off is above ${l.value} ${l.unit} (design choice: ${l.reason})` });
  }
  return out;
}

// All three, in order, against an index() of what is stored. An impossible value is reported alone (comparing it
// with anything says nothing more).
function check(rec, idx) {
  const range = implausible(rec.kind, rec.values);
  if (range.length) return range;
  const lastGood = first(idx.back(rec), (r) => r.plausible !== false);
  const prev = first(idx.back(rec), (r) => !outOfRange(r));
  return [...jumps(rec, lastGood, prev), ...drift(rec, idx)];
}

module.exports = { check, index, implausible, jumps, drift, keysFor, label };
