// The sector's blocks, read from contract/blocks.json: the same file the twin and the firmware lanes build against.
// 70 blocks on 9 levels, each with the number of people living there. This file also checks device ids against
// CONTRACT.md section 3.
//
// The contract folder sits beside api/ in the repository. A host that only has the api folder can point the
// BLOCKS environment variable at a copy of the file.
const fs = require("fs");
const path = require("path");

const FILE = process.env.BLOCKS || path.join(__dirname, "..", "contract", "blocks.json");
const raw = JSON.parse(fs.readFileSync(FILE, "utf8"));
const levels = Object.fromEntries(raw.levels.map((l) => [l.code, l]));

const SURFACE = "surface"; // the one block id that is not in the file: where the surface scout reports from
const depthOf = (code) => Number(String(code).replace(/^L/i, "")); // "L8" -> 8: how far down, for sorting

// One row per block, in the file's order. `level` stays the contract's code ("L8"); `depth` is its number.
const list = raw.blocks.map((b) => ({
  block: b.id, name: b.name, level: b.level, depth: depthOf(b.level),
  level_name: levels[b.level] ? levels[b.level].name : null, people: b.people,
}));
const byId = new Map(list.map((b) => [b.block, b]));

const get = (id) => byId.get(id) || null;
const known = (id) => id === SURFACE || byId.has(id);
// How deep a block is (0 = top level). Used to send the nearest responder. Unknown ids sort last.
const levelOf = (id) => (byId.has(id) ? byId.get(id).depth : id === SURFACE ? -1 : 99);

// Why a block id is refused, or null when it is fine.
function problem(id) {
  if (known(id)) return null;
  const close = typeof id === "string" ? id.trim().toLowerCase() : "";
  const hint = close !== id && known(close) ? ` Did you mean "${close}"?` : "";
  return `unknown block "${id}": not in contract/blocks.json (block ids look like ${list[0].block}; the surface scout uses "${SURFACE}").${hint}`;
}

// CONTRACT.md section 3. A device id that does not fit is a warning on the stored message, never a rejection:
// a mislabelled watch must still be able to call for help.
const FIXED = [/^watch-\d{4}$/, /^rover-\d{2}$/, /^surface-\d{2}$/];
const PATTERNS = "watch-<4 digits>, relay-<block id>, sensor-<block id>, rover-<2 digits>, surface-<2 digits>";
function deviceWarnings(m) {
  const d = m.device;
  if (FIXED.some((p) => p.test(d))) return [];
  const boxed = /^(relay|sensor)-(.+)$/.exec(d);
  if (!boxed) return [`device id "${d}" does not match CONTRACT.md section 3 (${PATTERNS})`];
  const [, type, block] = boxed;
  if (!byId.has(block)) return [`device id "${d}" does not match CONTRACT.md section 3: "${block}" is not a block id (${type}-<block id>)`];
  if (block !== m.block) return [`device ${d} is named for block ${block} but this message says block ${m.block}`];
  return [];
}

// Warnings about block ids inside a message that are not the message's own `block`.
function messageWarnings(m) {
  const out = [];
  if (m.kind === "surface" && m.block !== SURFACE) out.push(`surface readings belong to block "${SURFACE}" (CONTRACT.md section 1); this one says ${m.block}`);
  if (m.kind === "tunnel")
    for (const f of ["from_block", "to_block"])
      if (m.values[f] !== undefined && !byId.has(m.values[f])) out.push(`tunnel ${f} "${m.values[f]}" is not a block id`);
  return out;
}

module.exports = { FILE, SURFACE, list, levels: raw.levels, get, known, levelOf, problem, deviceWarnings, messageWarnings };
