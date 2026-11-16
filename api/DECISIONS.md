# Decisions

Choices made while finishing the backend without stopping to ask. Each one is the simplest reasonable option;
change any of them by editing the file named.

## Thresholds that changed when they moved to sourced limits (Task 1)

Every number now lives in `shared/limits.json`. Where the old hard-coded number had no published source, it was
replaced by the nearest published limit:

| Rule | Was | Now | Source |
|---|---|---|---|
| Water TDS, do-not-drink | above 600 ppm | above 1000 ppm | WHO: below 1000 mg/litre is "usually acceptable to consumers". WHO sets no health-based TDS value, so this is an acceptability limit and is labelled as such in the note |
| Water turbidity | above 4 NTU | above 5 NTU | US EPA: turbidity must at no time exceed 5 NTU |
| CO2, stale air | above 2000 ppm | above 1000 ppm (warn) | Health Canada residential long-term limit |
| CO2, unsafe air | (none) | above 5000 ppm (danger), a new alert | OSHA PEL / NIOSH REL |
| Flood depth, tunnel closed | above 10 cm | above 15 cm | US National Weather Service: 6 inches of moving water can knock over an adult |
| Grid frequency | more than 0.2 Hz from 60 | more than 0.036 Hz from 60 | NERC recommended maximum governor deadband: outside it the grid is actively correcting a disturbance |
| Triage, low oxygen | SpO2 below 95 | SpO2 below 94 | NEWS2 band 92-93 scores 2 |
| Triage, pulse | above 120 or below 45 | above 110 or below 41 | NEWS2 bands |
| Triage, fever | above 38.5 C | above 38.0 C | NEWS2 band 38.1-39.0 |

No existing test needed a new expected number because of these changes.

- The grid band is tight (0.036 Hz). A noisy home-made frequency sensor may trip it; if that happens with real
  hardware, average more samples on the relay before posting rather than widening the sourced limit.
- Limits are compared against single readings, although several sources define them over an averaging time
  (CO2 24-hour, PM2.5 24-hour, OSHA 8-hour). Each limit's note says so.
- Surface heat and cold limits come from NWS heat index and wind chill tables but are compared with plain air
  temperature, because the scout sends no humidity or wind. Noted on each limit.
- Surface radiation limits are the IAEA operational intervention levels (OIL3 = 1 µSv/h for "sealed domes",
  OIL2 = 25 µSv/h for "stay underground"). They are defined above background; the raw scout reading is compared
  without subtracting background, which errs on the safe side.
- Tunables that are not safety facts (forecast window, triage points, rate limit, body size, ping interval and so
  on) are in the same file as `"type": "design choice"` with a reason, so `api/` holds no numbers of its own.
- Alert `text` was left exactly as it was (watch screens and existing tests match on it). The limit and its source
  were added as new fields: `values.why`, `values.limit`, `values.limits`.
- `GET /limits` was added so the twin can show sources without bundling the file.

## One existing test was edited (Task 4)

`tests/api.test.js`, "shot 3, warning": it posted power readings stamped 1 to 3 hours in the future. Task 4
requires readings more than 5 minutes in the future to be rejected, so the two requirements cannot both hold.
The test's timeline was shifted 3 hours back (one line: `const now = Date.now() - 3 * H`). Its readings, spacing
and every assertion are unchanged.

## Live vs simulated (Task 2)

- A `source` other than `live` or `simulated` is rejected with a reason, rather than silently stored as simulated.
- An alert inherits the `source` of the reading that caused it.
- `/blocks` keeps its shape (an array of readings); each item gained `block_source`. A block's source is the
  source of its newest non-alert reading, so it flips back to simulated if scripted data arrives after live data.

## Live feed (Task 3)

- The sequence number is stored on every record as `seq` and is the SSE `id`. Old data files without `seq` are
  numbered in file order on load.
- A first connection with no `Last-Event-ID` gets live events only (as before). `lastEventId=0` replays everything.
- If a client's id is higher than the server's (the data file was wiped), the server sends `event: reset` and
  replays from the start.
- If both the header and `?lastEventId=` are present, the header wins (it is the browser's own, newer value).
- A half-written last line in the data file (a crash mid-write) is skipped on start instead of stopping the server.
- Added `after_seq` to `/history` and `/inbox` as a plain-HTTP way to catch up.

## Ingest (Task 4)

- Rate limit: counted per device (the reading's `device`, or an `x-device` header) in one-second windows. Arrays
  are counted but never refused. Default 20, env `RATE_LIMIT` overrides.
- An oversize body is drained and answered with 413 rather than cutting the connection, so the device sees the
  reason.
- Pre-2020 readings keep what the device sent in `device_time`. A whole backlog with no clock gets the same
  receive time and keeps the order it was sent in.
- `INGEST_KEY` protects every POST (`/ingest`, `/dispatch`, `/family`, `/official`). GETs stay open so the twin and
  the public broadcast page need no secret.
- A request that hits a bug answers 500 and the server keeps running; uncaught errors are logged, not fatal.
- The server now prints the real port it listens on (so `PORT=0` works for tests).

## Signatures (Task 5)

- The signature covers the `time` string the device sent, even when the backend then replaces a pre-2020 time.
- A `sig` from a device the backend holds no key for is accepted as `verified: false` with a `sig_unchecked`
  note, not rejected. Rejecting it would drop real data whenever a deployment is missing `shared/keys.json`
  (which is gitignored and so absent on a fresh host), and it gives a forger nothing: unsigned readings are
  accepted as unverified anyway.
- Keys can also come from the `DEVICE_KEYS` env var (JSON), for hosts with no private files.
- The published test vector uses a fixed past time (2026-11-01) so posting it to a server never trips the
  future-time rule.
- `sig` is kept on the stored record so anyone holding the key can re-check the public record.

## Surface (Task 6)

- The verdict needs all five readings. If any is missing the verdict is "not enough data", even when a reading
  already present is over a limit; that reading is listed under "already known". This follows the brief literally
  ("missing readings give not enough data, never a guess").
- Readings are taken sector-wide (the latest value of each across all scouts), with no expiry: an old reading
  stays in force until a newer one replaces it. Its time is shown so the twin can display its age.
- Oxygen and PM2.5 have a "sealed domes" limit only; no published limit was used to invent a "stay underground"
  level for them.
- A verdict change is stored as an alert (so it is on the feed and survives restarts). `/surface/history` is the
  surface readings plus those alerts, in stored order. Nothing in the backend can edit or delete a stored line.
- First wave: a volunteer who is not in `shared/people.json` is excluded (caregiver status unknown). Vitals must
  be from the last 24 hours and inside NEWS2's zero-score bands. Score = 10 points per needed skill; ties go to
  who volunteered first. `needed_skills` lives in `shared/people.json`.
- `/firstwave` always ranks, and adds `cleared: false` when the verdict is "stay underground" or "not enough data".
- `shared/people.json` holds invented demo people.

## Status, scenarios, deployment (Tasks 7 to 9)

- `/status` counts verified and live readings over device readings only; the backend's own alerts are not counted.
- Scenario data is backdated so it ends "now" (the blackout shot replays 4 hours of relay data). Nothing is ever
  stamped in the future.
- Scenario ids include a per-run tag so a shot can be re-run on the same server; the blackout shot still wants a
  fresh data file for a clean forecast and says so when it finds old data.
- `tools/scenario.js` sets its exit code instead of calling `process.exit()`: on Windows that call crashed Node
  and cut off piped output.
- `tools/check.js` and `tools/sign.js` were added as small helpers; neither was in the brief.
- Azure instructions use a code deploy (`az webapp up`) rather than the Dockerfile, because it needs no registry.
  The Dockerfile is for Render, local Docker, or Azure custom containers.
- Nothing was deployed and nothing was pushed to a remote.
