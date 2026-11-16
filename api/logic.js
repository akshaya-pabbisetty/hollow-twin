// Hollow Twin logic moved out of the browser: forecast, fair share, help queue, family check-ins, truth check.
// Pure functions over the stored readings, so they are easy to test and the twin just displays results.
// Every number comes from shared/limits.json (via ./limits); nothing here is a hard-coded threshold.
const LIM = require("./limits");

const HOUR = 3600e3;
const t = (r) => Date.parse(r.time);

// Grid frequency outside the normal band around nominal (both from limits.json).
const gridDev = (hz) => +Math.abs(hz - LIM.val("grid_nominal_hz")).toFixed(3);
const gridOff = (hz) => LIM.crossed("grid_band_hz", gridDev(hz));
function gridWhy(hz) {
  const band = LIM.ref("grid_band_hz");
  return `grid frequency ${hz} Hz is ${gridDev(hz)} Hz from ${LIM.val("grid_nominal_hz")} Hz, outside the normal +/- ${band.value} Hz band (${band.source})`;
}

// 1. Blackout forecast: battery slope per block -> hours left. Grid frequency gives the early warning.
function forecast(readings, block) {
  const pts = readings.filter((r) => r.block === block && r.kind === "power" && r.values.battery_pct !== undefined)
    .sort((a, b) => t(a) - t(b)).slice(-LIM.val("forecast_points"));
  const last = pts[pts.length - 1];
  const hz = readings.filter((r) => r.block === block && r.kind === "power" && r.values.grid_hz !== undefined)
    .sort((a, b) => t(a) - t(b)).slice(-LIM.val("forecast_grid_avg_points")).map((r) => r.values.grid_hz);
  const grid_hz = hz.length ? +(hz.reduce((a, b) => a + b, 0) / hz.length).toFixed(3) : null;
  const grid_stress = grid_hz !== null && gridOff(grid_hz);
  const reasons = [];
  if (grid_stress) reasons.push(gridWhy(grid_hz));
  if (pts.length < 2) return { block, battery_pct: last ? last.values.battery_pct : null, hours_left: null, grid_hz, grid_stress, reasons };
  // least-squares slope of battery % per hour
  const x0 = t(pts[0]);
  const xs = pts.map((p) => (t(p) - x0) / HOUR), ys = pts.map((p) => p.values.battery_pct);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (ys[i] - my); den += (x - mx) ** 2; });
  const slope = den ? num / den : 0; // % per hour
  const hours_left = slope < -LIM.val("forecast_min_drain_pct_per_h") ? +(last.values.battery_pct / -slope).toFixed(1) : null;
  if (hours_left !== null) {
    reasons.push(`battery ${last.values.battery_pct}% falling ${(-slope).toFixed(2)} %/h gives ${hours_left} h left`);
    if (LIM.crossed("battery_warn_hours", hours_left)) reasons.push(LIM.why("forecast", hours_left, "battery_warn_hours"));
  }
  return { block, battery_pct: last.values.battery_pct, drain_pct_per_h: +slope.toFixed(2), hours_left, grid_hz, grid_stress, reasons };
}

// 2. Fair share vs Directorate priority for a given supply (watts).
// Directorate: serve upper levels fully first; deep levels get what is left.
// Fair share: every block's critical load first (air, pumps, medical), then the rest per person.
function allocate(blocks, supply_w, policy) {
  const out = blocks.map((b) => ({ ...b, served_w: 0 }));
  let left = supply_w;
  if (policy === "directorate") {
    for (const b of [...out].sort((a, c) => a.level - c.level)) {
      b.served_w = Math.min(b.demand_w, left); left -= b.served_w;
    }
  } else {
    const crit = out.reduce((s, b) => s + b.critical_w, 0);
    const k = Math.min(1, left / crit);
    out.forEach((b) => { b.served_w = b.critical_w * k; });
    left -= crit * k;
    // water-fill the remainder by population, capped at each block's demand
    let open = out.filter((b) => b.served_w < b.demand_w);
    while (left > 0.01 && open.length) {
      const pop = open.reduce((s, b) => s + b.population, 0);
      let used = 0;
      for (const b of open) {
        const give = Math.min(left * (b.population / pop), b.demand_w - b.served_w);
        b.served_w += give; used += give;
      }
      left -= used;
      open = out.filter((b) => b.demand_w - b.served_w > 0.01);
      if (used < 0.01) break;
    }
  }
  for (const b of out) {
    b.served_w = Math.round(b.served_w);
    b.served_pct = Math.round((100 * b.served_w) / b.demand_w);
    b.dark = b.served_w < b.critical_w; // air or pumps not covered
  }
  const per = out.map((b) => b.served_w / b.population);
  return {
    policy, supply_w,
    rule: policy === "directorate"
      ? "Directorate: upper levels are served in full first; deeper levels get whatever is left."
      : "Fair share: every block's critical load (air, pumps, medical) first, then the rest split per person.",
    blocks: out.map(({ block, level, served_w, served_pct, dark }) => ({ block, level, served_w, served_pct, dark })),
    dark_blocks: out.filter((b) => b.dark).map((b) => b.block),
    equity_index: +(Math.min(...per) / Math.max(...per)).toFixed(2),
  };
}

// 3. Help queue: help presses ranked by a triage score from the wearer's latest vitals.
// Vital-sign limits are NEWS2 bands; the points per sign are design choices (all in limits.json).
function triageDetail(v) {
  let score = LIM.val("triage_base_points");
  const reasons = [`help pressed: ${score} points`];
  const add = (key, pointsKey, x, label) => {
    if (!LIM.crossed(key, x)) return false;
    score += LIM.val(pointsKey);
    reasons.push(`+${LIM.val(pointsKey)}: ${LIM.why(label, x, key)}`);
    return true;
  };
  if (v) {
    add("vitals_spo2_severe_below_pct", "triage_spo2_severe_points", v.spo2, "SpO2") ||
      add("vitals_spo2_low_below_pct", "triage_spo2_low_points", v.spo2, "SpO2");
    add("vitals_hr_high_above_bpm", "triage_hr_points", v.hr, "pulse") ||
      add("vitals_hr_low_below_bpm", "triage_hr_points", v.hr, "pulse");
    add("vitals_fever_above_c", "triage_fever_points", v.temp_c, "temperature");
  } else reasons.push("no vitals on record for this watch");
  return { score, reasons };
}
const triage = (v) => triageDetail(v).score;

function queue(readings, dispatched, now = Date.now()) {
  const helps = readings.filter((r) => r.kind === "button" && r.values.type === "help" && !dispatched.has(r.id));
  const grace = LIM.val("triage_vitals_grace_s") * 1000, per = LIM.val("triage_wait_minutes_per_point");
  return helps.map((h) => {
    const v = readings.filter((r) => r.device === h.device && r.kind === "vitals" && t(r) <= t(h) + grace)
      .sort((a, b) => t(b) - t(a))[0];
    const wait_min = Math.max(0, (now - t(h)) / 60e3);
    const d = triageDetail(v && v.values);
    const waited = Math.min(LIM.val("triage_wait_max_points"), Math.floor(wait_min / per)); // waiting long raises priority
    if (waited) d.reasons.push(`+${waited}: waited ${Math.floor(wait_min)} min (1 point per ${per} min, design choice)`);
    return { id: h.id, device: h.device, block: h.block, time: h.time, score: d.score + waited, vitals: v ? v.values : null, reasons: d.reasons };
  }).sort((a, b) => b.score - a.score || t(a) - t(b));
}

const levelOf = (block) => Number((block.match(/^L(\d+)/) || [0, 99])[1]);

// Pick the top-priority request; among equal scores, the one nearest the responder's level.
function pickRequest(q, responderBlock) {
  if (!q.length) return null;
  const top = q.filter((r) => r.score === q[0].score);
  if (!responderBlock) return top[0];
  const L = levelOf(responderBlock);
  return top.sort((a, b) => Math.abs(levelOf(a.block) - L) - Math.abs(levelOf(b.block) - L))[0];
}

// 4. Truth check: residents' count (symptom presses or low oxygen, distinct people) vs official count.
function truth(readings, official, now = Date.now(), windowH = LIM.val("truth_window_h")) {
  const since = now - windowH * HOUR;
  const sick = {};
  for (const r of readings) {
    if (t(r) < since) continue;
    const isSick = (r.kind === "button" && r.values.type === "symptom") ||
      (r.kind === "vitals" && LIM.crossed("vitals_spo2_low_below_pct", r.values.spo2));
    if (isSick) (sick[r.block] ||= new Set()).add(r.device);
  }
  const blocks = new Set([...Object.keys(sick), ...Object.keys(official)]);
  const rows = [...blocks].map((b) => {
    const residents = sick[b] ? sick[b].size : 0, off = official[b] ?? 0;
    return { block: b, residents, official: off, gap: residents - off };
  }).sort((a, b) => b.gap - a.gap);
  const tot = (k) => rows.reduce((s, r) => s + r[k], 0);
  const low = LIM.ref("vitals_spo2_low_below_pct");
  return { window_h: windowH, residents_total: tot("residents"), official_total: tot("official"), blocks: rows,
    rule: `A resident counts once if, in the last ${windowH} h, their watch sent a symptom press or SpO2 below ${low.value}% (${low.source}).` };
}

module.exports = { forecast, allocate, triage, triageDetail, queue, pickRequest, truth, levelOf, gridOff, gridWhy };
