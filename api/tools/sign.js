// Signing helper for firmware work. Prints the canonical string and the sig the backend expects.
//   node tools/sign.js                      prints the published test vector
//   node tools/sign.js <key> <reading.json> signs the reading in that file with that key
const fs = require("fs");
const S = require("../sign");

const [key, file] = process.argv.slice(2);
if (!key) {
  console.log("Test vector (your firmware must produce exactly this sig):\n");
  console.log("key:      ", S.TEST_VECTOR.key);
  console.log("canonical:", S.TEST_VECTOR.canonical);
  console.log("sig:      ", S.sign(S.TEST_VECTOR.reading, S.TEST_VECTOR.key));
} else {
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log("canonical:", S.canonical(r));
  console.log("sig:      ", S.sign(r, key));
}
