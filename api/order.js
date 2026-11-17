// Which stored message is "latest" (CONTRACT.md section 1.3): the greatest stored `time`, ties broken by `seq`.
// Every "latest per block and kind", "newest vitals", "newest photo" in the API goes through this one rule, so a relay
// backlog that arrives late (older real times, higher seq) can never take the place of a fresher reading, and a device
// whose clock runs ahead cannot hold "latest" either (its time is replaced by the receive time on the way in).
const t = (r) => Date.parse(r.time);
const seq = (r) => (typeof r.seq === "number" ? r.seq : 0);

// Oldest first. Use with Array.prototype.sort.
const byTime = (a, b) => t(a) - t(b) || seq(a) - seq(b);
// Newest first.
const newestFirst = (a, b) => byTime(b, a);
// true when `a` is newer than `b` (or there is no `b`).
const newer = (a, b) => !b || byTime(a, b) > 0;
// The newest message in a list, or undefined.
const newest = (list) => list.reduce((best, r) => (newer(r, best) ? r : best), undefined);

module.exports = { byTime, newestFirst, newer, newest };
