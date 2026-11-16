// Signed readings: a device proves a reading is its own, so nobody (the Directorate included) can fake its data.
//
// sig = lowercase hex HMAC-SHA256, keyed with the device's secret, over this exact string:
//
//   id|device|block|time|kind|VALUES
//
// where VALUES is the values object as JSON with its keys sorted alphabetically and no spaces,
// and `time` is exactly the string the device sent. Example:
//
//   relay-07-000123|relay-07|L8-deepwell-03|2026-11-01T14:02:11Z|power|{"battery_pct":62,"draw_w":41.5,"grid_hz":59.97}
//
// Numbers are written the way JSON.stringify writes them: 62 not 62.0, 41.5 not 41.50, no exponent.
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// keys sorted at every level, so nested objects are stable too
const sorted = (v) => Array.isArray(v) ? v.map(sorted)
  : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;

const canonical = (r) => [r.id, r.device, r.block, r.time, r.kind, JSON.stringify(sorted(r.values))].join("|");
const sign = (r, key) => crypto.createHmac("sha256", key).update(canonical(r), "utf8").digest("hex");

function check(r, key) {
  if (typeof r.sig !== "string" || !/^[0-9a-fA-F]{64}$/.test(r.sig)) return false;
  const want = Buffer.from(sign(r, key), "hex"), got = Buffer.from(r.sig, "hex");
  return crypto.timingSafeEqual(want, got); // constant time: the comparison itself leaks nothing
}

// Device secrets: { "device-id": "secret", ... } from the DEVICE_KEYS env var (a JSON string, for hosts with no
// private files), else the file named by KEYS, else shared/keys.json (gitignored). No file = nothing can be verified.
function loadKeys() {
  let raw = {};
  try {
    if (process.env.DEVICE_KEYS) raw = JSON.parse(process.env.DEVICE_KEYS);
    else {
      const file = process.env.KEYS || path.join(__dirname, "shared/keys.json");
      if (fs.existsSync(file)) raw = JSON.parse(fs.readFileSync(file, "utf8"));
    }
  } catch (e) { console.error("could not read device keys, signatures will not be checked:", e.message); }
  return Object.fromEntries(Object.entries(raw).filter(([k, v]) => !k.startsWith("_") && typeof v === "string" && v));
}

// The published test vector: firmware must reproduce this sig exactly (see docs/FIRMWARE.md).
const TEST_VECTOR = {
  key: "hollow-test-key-0001",
  reading: { id: "relay-07-000123", device: "relay-07", block: "L8-deepwell-03", time: "2026-11-01T14:02:11Z",
    kind: "power", values: { battery_pct: 62, draw_w: 41.5, grid_hz: 59.97 } },
  canonical: 'relay-07-000123|relay-07|L8-deepwell-03|2026-11-01T14:02:11Z|power|{"battery_pct":62,"draw_w":41.5,"grid_hz":59.97}',
  sig: "179c1d3d9063acb856085095bd1556297c65e404aedb05024d3c10c748a18dd3",
};

module.exports = { canonical, sign, check, loadKeys, TEST_VECTOR };
