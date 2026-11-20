// GET /family for a group nobody has registered or checked in for yet: an empty list, not an error.
// The phone watch polls it every 2.5 s from the moment it opens, before its first "I'm OK" registers the group.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { makeServer } = require("./helper");

const s = makeServer();
before(() => s.start());
after(() => s.cleanup());

test("a family nobody has joined yet is an empty list, under either parameter name", async () => {
  for (const q of ["family=fam-0901", "group=fam-0901"]) {
    const r = await s.getRaw(`/family?${q}`);
    assert.strictEqual(r.status, 200, `?${q}`);
    assert.deepStrictEqual(r.body, []);
  }
});

test("asking without naming a family is a client error that says what is missing", async () => {
  const r = await s.getRaw("/family");
  assert.strictEqual(r.status, 400);
  assert.match(r.body.error, /family/);
});

test("the family fills in as soon as a watch checks in naming it", async () => {
  await s.post("/ingest", { id: "watch-0901-000001", device: "watch-0901", block: "l7-chalk-cut", time: new Date().toISOString(),
    kind: "checkin", values: { status: "ok", family: "fam-0902" }, hops: 0, via: [] });
  const fam = await s.get("/family?family=fam-0902");
  assert.strictEqual(fam.length, 1);
  assert.strictEqual(fam[0].device, "watch-0901");
  assert.strictEqual(fam[0].block, "l7-chalk-cut");
  assert.ok(fam[0].last_ok);
});
