// Every threshold comes from shared/limits.json: the code holds no safety numbers of its own.
// val(key) -> the number. ref(key) -> the number with its source, for alerts and reasons.
const fs = require("fs");
const path = require("path");

const FILE = process.env.LIMITS || path.join(__dirname, "shared/limits.json");
const all = JSON.parse(fs.readFileSync(FILE, "utf8")).limits;

const OPS = {
  ">": [(x, v) => x > v, "above"],
  ">=": [(x, v) => x >= v, "at or above"],
  "<": [(x, v) => x < v, "below"],
  "<=": [(x, v) => x <= v, "at or below"],
};

function ref(key) {
  const l = all[key];
  if (!l) throw new Error(`limit "${key}" is missing from shared/limits.json`);
  return { key, ...l };
}
const val = (key) => ref(key).value;
// "design choice" limits have no published source; say so instead of leaving a blank.
const sourceOf = (l) => l.source || `design choice: ${l.reason}`;

// true when a numeric reading crosses the limit. Missing or non-numeric readings never cross.
function crossed(key, x) {
  const l = ref(key);
  return typeof x === "number" && !Number.isNaN(x) && OPS[l.op][0](x, l.value);
}
// "TDS 1450 ppm is above 1000 ppm (WHO, ...)"
function why(label, x, key) {
  const l = ref(key);
  return `${label} ${x} ${l.unit} is ${OPS[l.op][1]} ${l.value} ${l.unit} (${sourceOf(l)})`;
}
// [[key, reading, label], ...] -> the ones that crossed, each with its sourced limit and a sentence
function hits(checks) {
  return checks.filter(([key, x]) => crossed(key, x))
    .map(([key, x, label]) => ({ limit: ref(key), why: why(label, x, key) }));
}
// alert fields that tell the twin why: one sentence, the first limit crossed, and all of them
function because(h) {
  return { why: h.map((x) => x.why).join("; "), limit: h[0].limit, limits: h.map((x) => x.limit) };
}

module.exports = { all, ref, val, crossed, why, hits, because, sourceOf, FILE };
