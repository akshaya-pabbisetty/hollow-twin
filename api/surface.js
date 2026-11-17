// Surface truth (track problems 13 and 14): is it safe to go up, and who goes first?
// Pure functions over the stored readings. Every limit comes from shared/limits.json with its source.
const LIM = require("./limits");

const t = (r) => Date.parse(r.time);
const VERDICTS = ["suits OK", "sealed domes needed", "stay underground"]; // mildest -> worst
const NO_DATA = "not enough data";

// One row per thing a scout can measure. "stay" limits mean nobody goes up; "domes" limits mean only sealed habitats.
const CHECKS = [
  { value: "radiation_usv_h", label: "radiation", stay: ["surface_radiation_stay_usv_h"], domes: ["surface_radiation_domes_usv_h"] },
  { value: "co2_ppm", label: "CO2", stay: ["surface_co2_stay_ppm"], domes: ["surface_co2_domes_ppm"] },
  { value: "o2_pct", label: "oxygen", stay: [], domes: ["surface_o2_low_pct", "surface_o2_high_pct"] },
  { value: "temp_c", label: "temperature", stay: ["surface_temp_stay_c"], domes: ["surface_temp_domes_c", "surface_temp_cold_c"] },
  { value: "pm25_ugm3", label: "PM2.5", stay: [], domes: ["surface_pm25_domes_ugm3"] },
];

// Latest value of each measurement across all scouts, each compared with its limits, plus the overall verdict.
function surface(readings) {
  const latest = {};
  for (const r of readings) {
    if (r.kind !== "surface") continue;
    for (const c of CHECKS) {
      const x = r.values[c.value];
      if (typeof x !== "number" || Number.isNaN(x)) continue;
      if (!latest[c.value] || t(r) >= t(latest[c.value].r)) latest[c.value] = { x, r };
    }
  }
  const rows = CHECKS.map((c) => {
    const limits = [...c.stay, ...c.domes].map(LIM.ref);
    const l = latest[c.value];
    if (!l) return { reading: c.value, label: c.label, value: null, status: "no data", reason: `no ${c.label} reading yet`, limits };
    const stay = LIM.hits(c.stay.map((k) => [k, l.x, c.label])), domes = LIM.hits(c.domes.map((k) => [k, l.x, c.label]));
    const status = stay.length ? VERDICTS[2] : domes.length ? VERDICTS[1] : "ok";
    const crossed = stay.length ? stay : domes;
    const reason = crossed.length ? crossed.map((h) => h.why).join("; ")
      : `${c.label} ${l.x} ${limits[0].unit} is inside every limit (${limits.map((x) => `${c.stay.includes(x.key) ? "stay underground" : "sealed domes"} if ${x.op} ${x.value} ${x.unit}: ${x.source}`).join("; ")})`;
    return { reading: c.value, label: c.label, value: l.x, unit: limits[0].unit, status, reason,
      time: l.r.time, device: l.r.device, block: l.r.block, source: l.r.source, verified: l.r.verified === true, limits };
  });
  const missing = rows.filter((r) => r.status === "no data");
  const bad = rows.filter((r) => VERDICTS.includes(r.status));
  let verdict, reasons;
  if (missing.length) {
    // never a guess: with a reading missing we do not call the surface safe OR unsafe
    verdict = NO_DATA;
    reasons = [...missing.map((r) => r.reason), ...bad.map((r) => `already known: ${r.reason}`)];
  } else if (bad.length) {
    verdict = bad.some((r) => r.status === VERDICTS[2]) ? VERDICTS[2] : VERDICTS[1];
    reasons = bad.filter((r) => r.status === verdict).map((r) => r.reason)
      .concat(bad.filter((r) => r.status !== verdict).map((r) => `also: ${r.reason}`));
  } else {
    verdict = VERDICTS[0];
    reasons = rows.map((r) => r.reason);
  }
  const live = rows.filter((r) => r.source === "live").length, have = rows.length - missing.length;
  return { verdict, reasons, missing: missing.map((r) => r.reading),
    source: !have ? null : live === have ? "live" : live === 0 ? "simulated" : "mixed", // is the verdict built on real hardware?
    readings: rows,
    rule: "Worst reading wins. Any 'stay' limit crossed = stay underground; any 'domes' limit crossed = sealed domes needed; all five readings present and inside every limit = suits OK; any reading missing = not enough data." };
}

// The public record: every surface reading and every verdict change, in the order the backend stored them.
function surfaceHistory(readings) {
  return readings.filter((r) => r.kind === "surface" || (r.kind === "alert" && r.values.surface_verdict)).map((r) => r.kind === "surface"
    ? { seq: r.seq, type: "reading", time: r.time, id: r.id, device: r.device, block: r.block, values: r.values, source: r.source, verified: r.verified === true }
    : { seq: r.seq, type: "verdict", time: r.time, id: r.id, verdict: r.values.surface_verdict, previous: r.values.previous,
      reasons: r.values.reasons, cause: r.values.cause, source: r.source });
}

// The public broadcast page in one call (CONTRACT.md section 4, GET /broadcast): the latest surface readings, each
// against its human-safe limits, the verdict in plain words, the newest photo, and where the full record is.
const PLAIN = {
  [VERDICTS[0]]: "The latest surface readings support going up in suits: all five are inside their human-safe limits.",
  [VERDICTS[1]]: "The latest surface readings support living in sealed domes only: at least one is past its limit for open air.",
  [VERDICTS[2]]: "The latest surface readings do not support going up at all: at least one is past the limit where nobody should be on the surface.",
};
function broadcast(readings) {
  const sv = surface(readings);
  const have = sv.readings.filter((r) => r.value !== null);
  const photos = readings.filter((r) => r.kind === "surface" && typeof r.values.photo_url === "string" && r.values.photo_url).sort((a, b) => t(b) - t(a));
  const text = sv.verdict === NO_DATA
    ? `No verdict yet: ${sv.missing.length} of the ${sv.readings.length} surface readings ${sv.missing.length === 1 ? "has" : "have"} not been measured (${sv.missing.join(", ")}). The API does not guess.`
    : PLAIN[sv.verdict];
  return {
    verdict: sv.verdict, text, reasons: sv.reasons, missing: sv.missing, source: sv.source,
    time: have.length ? have.map((r) => r.time).sort().pop() : null, // when the newest reading behind the verdict was taken
    readings: sv.readings,
    photo: photos.length ? { url: photos[0].values.photo_url, time: photos[0].time, device: photos[0].device } : null,
    history: "/surface/history", // the append-only public record: every surface reading and every verdict change
    rule: sv.rule,
  };
}

// First wave: rank who goes up first. Rules, in order:
//   volunteers only; in the people register; never sole caregivers; no open help request;
//   latest vitals present, recent and inside the healthy ranges; then prefer needed skills, then who volunteered first.
const HEALTHY = [
  ["vitals_spo2_healthy_min_pct", "spo2_pct", "SpO2"],
  ["vitals_hr_healthy_min_bpm", "hr_bpm", "pulse"], ["vitals_hr_healthy_max_bpm", "hr_bpm", "pulse"],
  ["vitals_temp_healthy_min_c", "temp_c", "temperature"], ["vitals_temp_healthy_max_c", "temp_c", "temperature"],
];
function firstwave(readings, openHelp, register, n = LIM.val("firstwave_default_n"), now = Date.now()) {
  const people = Object.fromEntries((register.people || []).map((p) => [p.device, p]));
  const needed = register.needed_skills || [];
  const points = LIM.val("firstwave_skill_points"), maxAgeH = LIM.val("firstwave_vitals_max_age_h");
  const src = LIM.ref("vitals_spo2_healthy_min_pct").source;
  const volunteered = {}; // device -> first volunteer press
  for (const r of readings)
    if (r.kind === "button" && r.values.button === "volunteer" && (!volunteered[r.device] || t(r) < t(volunteered[r.device]))) volunteered[r.device] = r;
  const ranked = [], excluded = [];
  for (const [device, press] of Object.entries(volunteered)) {
    const p = people[device], out = [];
    const reasons = [`volunteered at ${press.time}`];
    if (!p) out.push("not in the people register (shared/people.json): skills and caregiver status unknown");
    else if (p.sole_caregiver) out.push("sole caregiver: never sent up");
    else reasons.push("not a sole caregiver");
    if (openHelp.has(device)) out.push("has an open help request"); else reasons.push("no open help request");
    const v = readings.filter((r) => r.device === device && r.kind === "vitals").sort((a, b) => t(b) - t(a))[0];
    if (!v) out.push("not enough data: no vitals on record");
    else if (now - t(v) > maxAgeH * 3600e3) out.push(`not enough data: latest vitals are older than ${maxAgeH} h`);
    else {
      const gaps = [...new Set(HEALTHY.map((h) => h[1]))].filter((f) => typeof v.values[f] !== "number");
      const off = LIM.hits(HEALTHY.map(([key, f, label]) => [key, v.values[f], label]));
      if (gaps.length) out.push(`not enough data: latest vitals have no ${gaps.join(", ")}`);
      else if (off.length) out.push(...off.map((h) => `vitals outside the healthy range: ${h.why}`));
      else reasons.push(`latest vitals healthy: SpO2 ${v.values.spo2_pct} %, pulse ${v.values.hr_bpm} bpm, temperature ${v.values.temp_c} C (${src})`);
    }
    const base = { device, name: p ? p.name : null, block: press.block, skills: p ? p.skills || [] : [], volunteered_at: press.time,
      vitals: v ? v.values : null, source: press.source };
    if (out.length) { excluded.push({ ...base, reasons: out }); continue; }
    const match = base.skills.filter((s) => needed.includes(s));
    for (const s of match) reasons.push(`+${points}: skill "${s}" is needed`);
    if (!match.length) reasons.push(`+0: none of the needed skills (${needed.join(", ") || "none listed"})`);
    ranked.push({ ...base, score: points * match.length, reasons });
  }
  ranked.sort((a, b) => b.score - a.score || Date.parse(a.volunteered_at) - Date.parse(b.volunteered_at) || a.device.localeCompare(b.device));
  excluded.sort((a, b) => a.device.localeCompare(b.device));
  return { n, needed_skills: needed, volunteers: Object.keys(volunteered).length, eligible: ranked.length,
    ranked: ranked.slice(0, n).map((r, i) => ({ rank: i + 1, ...r })), excluded,
    rule: "Volunteers only. Never sole caregivers. No open help request. Latest vitals inside the healthy ranges. Then most needed skills first; ties go to who volunteered first." };
}

module.exports = { surface, surfaceHistory, broadcast, firstwave, VERDICTS, NO_DATA, CHECKS };
