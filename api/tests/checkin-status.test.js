// CONTRACT.md 2.2: a checkin's status is ok, help, msg:<text> or morse:<text>, and reaches the family unchanged.
const { test, before, after } = require("node:test");
const assert = require("node:assert");
const { makeServer } = require("./helper");

const s = makeServer();
before(() => s.start());
after(() => s.cleanup());

let n = 0;
const C = (status) => ({ id: `watch-0301-${String(++n).padStart(6, "0")}`, device: "watch-0301", block: "l7-chalk-cut",
  time: new Date().toISOString(), kind: "checkin", values: { status, family: "fam-0301", to: ["watch-0302"] }, hops: 0, via: [] });

test("every checkin status in CONTRACT.md 2.2 reaches the family with its status unchanged", async () => {
  const sent = ["ok", "help", "msg:On my way", "morse:SOS"].map(C);
  assert.strictEqual((await s.post("/ingest", sent)).body.accepted, 4);
  const inbox = await s.get("/inbox?device=watch-0302");
  for (const m of sent) {
    const a = inbox.find((x) => x.values.cause === m.id);
    assert.ok(a, `no alert reached the family for status ${m.values.status}`);
    assert.strictEqual(a.values.status, m.values.status);
    assert.strictEqual(a.values.family, "fam-0301");
  }
  // ok keeps the exact wording the twin and the tools already match on
  assert.strictEqual(inbox.find((x) => x.values.cause === sent[0].id).values.text, "watch-0301 is OK (l7-chalk-cut)");
});

test("typed text is stored as text, never interpreted", async () => {
  const m = C("msg:<b>hi</b>");
  await s.post("/ingest", m);
  const a = (await s.get("/inbox?device=watch-0302")).find((x) => x.values.cause === m.id);
  assert.strictEqual(a.values.status, "msg:<b>hi</b>");
});
