// CONTRACT.md in code: the message kinds, the fields every message carries, and the checks on them.
// The repository's CONTRACT.md is the source of truth; this file only mirrors it.
// It also holds the field names this backend used BEFORE the contract. Those are still accepted on the way in
// (as aliases) and renamed at once, so everything stored and everything sent back out uses contract names.

// Section 2 of the contract. "alert" is not here: alerts are written by the API, never accepted from a device.
const KINDS = ["power", "vitals", "button", "checkin", "water", "air", "flood", "tunnel", "surface"];
const REQUIRED = ["id", "device", "block", "time", "kind", "values"];
const SOURCES = ["live", "simulated"];
// help, symptom and ok are the contract's; volunteer is a lane 1 addition (offers to join the first wave up).
const BUTTONS = ["help", "symptom", "ok", "volunteer"];
const TUNNEL_STATUS = ["open", "closed"];

// Old name -> contract name, per kind.
const ALIASES = {
  vitals: { hr: "hr_bpm", spo2: "spo2_pct" },
  button: { type: "button" },
};

// The basic shape of a message. Same wording as tools/catcher.mjs, so a device sees the same reasons from both.
function problems(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return ["not a JSON object"];
  const out = [];
  for (const f of REQUIRED) if (m[f] === undefined) out.push(`missing ${f}`);
  for (const f of ["id", "device", "block", "kind"])
    if (m[f] !== undefined && (typeof m[f] !== "string" || !m[f])) out.push(`${f} must be a non-empty string`);
  if (m.kind === "alert") out.push('kind "alert" is written by the API, never sent by a device');
  else if (typeof m.kind === "string" && m.kind && !KINDS.includes(m.kind)) out.push(`unknown kind "${m.kind}"`);
  if (m.time !== undefined && (typeof m.time !== "string" || Number.isNaN(Date.parse(m.time)))) out.push("time is not ISO 8601");
  if (m.values !== undefined && (typeof m.values !== "object" || m.values === null || Array.isArray(m.values))) out.push("values must be an object");
  if (m.source !== undefined && !SOURCES.includes(m.source)) out.push("source must be live or simulated");
  return out;
}

// Renames legacy value names to contract names. A contract name that is already present always wins.
// Returns the new values object and the list of renames that were applied ("hr -> hr_bpm").
function normalise(kind, values) {
  const out = { ...values }, renamed = [];
  for (const [old, name] of Object.entries(ALIASES[kind] || {})) {
    if (!(old in out)) continue;
    if (!(name in out)) out[name] = out[old];
    delete out[old];
    renamed.push(`${old} -> ${name}`);
  }
  // Before the contract, "I'm OK" was a button press with `to` holding the family group. The contract's `to` is a
  // list of watch ids (on `checkin`), so a string `to` on an ok press is the old family group.
  if (kind === "button" && out.button === "ok" && typeof out.to === "string") {
    if (out.family === undefined) out.family = out.to;
    delete out.to;
    renamed.push("to -> family");
  }
  return { values: out, renamed };
}

// Checks that only make sense once the values carry contract names.
function valueProblems(kind, v) {
  const out = [];
  if (kind === "button" && !BUTTONS.includes(v.button))
    out.push(v.button === undefined ? "button message needs values.button" : `unknown button "${v.button}" (use ${BUTTONS.join(", ")})`);
  if (kind === "tunnel" && !TUNNEL_STATUS.includes(v.status))
    out.push(v.status === undefined ? "tunnel message needs values.status" : `unknown tunnel status "${v.status}" (use open or closed)`);
  if (kind === "checkin" && v.to !== undefined && !(Array.isArray(v.to) && v.to.every((d) => typeof d === "string")))
    out.push("checkin values.to must be a list of watch ids");
  return out;
}

// hops and via travel with the message (section 1 and 5). A message that leaves them out was sent by the device
// that measured it. Wrong types are repaired and noted, never a reason to drop a reading.
function route(m) {
  const warnings = [];
  let via = m.via, hops = m.hops;
  if (via === undefined) via = [];
  else if (!Array.isArray(via) || via.some((x) => typeof x !== "string")) { warnings.push("via was not a list of relay ids: stored as []"); via = []; }
  if (hops === undefined) hops = via.length;
  else if (!Number.isInteger(hops) || hops < 0) { warnings.push(`hops was not a whole number of 0 or more: stored as ${via.length}`); hops = via.length; }
  return { hops, via, warnings };
}

module.exports = { KINDS, REQUIRED, SOURCES, BUTTONS, ALIASES, problems, normalise, valueProblems, route };
