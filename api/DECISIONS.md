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

---

# Moving into the team repository and speaking CONTRACT.md (branch `lane1-backend`)

Everything above was decided in the standalone backend. Everything below was decided while moving it into
`api/` of the team repository and making it speak `CONTRACT.md`. Where a note above mentions an old field name
(`hr`, `spo2`, `battery_pct`, button `type`), an old block id (`L8-deepwell-03`) or the old `/ingest` reply, the
sections below replace it.

## Step 0: the move

- The backend was copied in, not merged with its history. The standalone repository keeps the old history
  (its last commit is `f978607`); the team repository gets one commit for the move and one per task.
- Server code sits at the top of `api/` (`server.js`, `logic.js`, ...), so both `npm start` inside `api/` and
  `node api/server.js` from the repository root work. Hosts use the second form.
- `api/` has its own `.gitignore` (data file, `shared/keys.json`). The repository's own `.gitignore` is not mine to
  edit.
- The Docker ignore file is `api/Dockerfile.dockerignore`, because the image is built from the repository root
  (`docker build -f api/Dockerfile .`) and a `.dockerignore` there would be outside `api/`.

## Task 1: contract message format

- **Names.** Stored records and every response use the contract's value names. The old names are renamed on the way
  in: vitals `hr` -> `hr_bpm`, `spo2` -> `spo2_pct`; button `type` -> `button`; and an old "I'm OK" press whose `to`
  was a family group name becomes `family` (the contract's `to` is a list of watch ids). When both an old and a
  contract name arrive, the contract name wins. A renamed message carries a `warnings` line so firmware authors see
  it. Data files written before the contract are renamed the same way when the server loads them.
- **`alert` is no longer accepted on `/ingest`.** The contract has nine kinds and `alert` is not one of them; before,
  anyone could post an alert. Alerts are now written only by the API.
- **A time more than 5 minutes in the future is no longer rejected.** It is kept, stamped with the receive time and
  marked `time_estimated`, exactly like a 1970 time. Reason: the files in `contract/samples/` carry the fixed time
  `2026-11-18T20:00:00Z` and must be accepted unchanged, and until that moment passes they are in the future. The
  safety purpose of the old rule is kept (a future time still cannot reach the timeline or a forecast), and a
  device with a wrong clock no longer loses its readings. The device is told through `warnings`.
- **Signatures** are checked against exactly what the device sent, before any renaming. `hops` and `via` are not
  signed, because relays change them. One consequence: a signed message that used old names cannot be re-checked
  from the stored record (its values were renamed). Contract-named messages are not affected.
- **`hops` and `via`** are stored and passed through. Missing ones become `0` and `[]`. Wrong types are repaired with
  a warning instead of rejecting the message, so a relay bug cannot drop a help press.
- **Light checks on values:** a `button` must be `help`, `symptom`, `ok` or `volunteer`; a `tunnel` status must be
  `open` or `closed`; a `checkin` `to` must be a list. Anything else is rejected with the reason. Numeric values are
  not range-checked: a missing or non-numeric reading simply never crosses a limit.
- **Reasons for rejecting use the wording of `tools/catcher.mjs`** (`missing block`, `unknown kind "x"`,
  `time is not ISO 8601`) and list every problem, not only the first, so a device sees the same text from both.
- **Tunnel alerts** now name both ends, the rover's reason and the photo, and reach residents of both blocks.
- **The signing test vector changed** to contract ids and names (`relay-l8-bore-bend`, `battery_wh`, ...).
- `shared/FORMAT.md` was removed: `CONTRACT.md` is the one description of the format.
- Additions written into `CONTRACT.md` in this task: sections 1.1 to 1.3 and 2.1, and the changelog.

## Task 2: blocks

- The sector is `contract/blocks.json`, read from the repository (one level above `api/`), not a copy. A copy
  inside `api/` could drift from the file the twin and the firmware build against. The price: a host needs the
  `contract` folder as well as `api` (the Dockerfile copies both; `BLOCKS` can point at the file elsewhere).
- `shared/sector.json` (9 invented blocks) is gone. Fair share now runs over all 70 blocks. What a block needs
  comes from its people: 100 W per person demand, 45 W per person critical. Both are design choices in
  `shared/limits.json`. 45% critical is the same life-support floor the twin's own fair-share rule uses. With one
  figure per person for every block, fair share serves every resident equally (equity index 1).
- An unknown `block` is rejected, with a hint when only the case or spacing is wrong. `surface` is accepted for
  any kind; a `surface` reading filed under an ordinary block is kept with a warning.
- Device ids: the five patterns of section 3. A relay or sensor id must also name a real block, and the same block
  as the message. All mismatches are warnings on the stored record (`warnings`), never rejections.
- Not checked: whether a kind comes from the right type of device (for example `power` from a watch). Section 3
  only defines the id patterns, and the test tools post kinds from mixed devices.
- A tunnel's `from_block` / `to_block` that is not a block id is a warning, not a rejection: the rover's
  "closed" report is still worth having.
- `level` in responses is the contract's code (`"L8"`), as in `contract/blocks.json`. It used to be a number.
- The people register (`shared/people.json`) uses `watch-<4 digits>` ids (`watch-0051` to `watch-0060`).
- The demo scenarios got the minimum change needed to run against real block ids; their full update is task 7.

## Task 3: logic on contract data

- **Forecast.** Main method: `hours_left = battery_wh / (draw_w - supply_w)` from the latest `power` message, while
  the net drain is above 0. A missing `supply_w` counts as 0 (running on the battery alone). Supply at or above
  draw gives `hours_left: null` ("not draining"), never a fallback guess. The slope method is used only when the
  latest message cannot give a net drain (no `draw_w`, or only `battery_pct`); on `battery_wh` the fitted slope
  is itself a net drain in watts.
- **Levels** are CONTRACT.md section 6: warning under 24 h, alarm under 8 h or dark. My old single warning at 8 h
  was a design choice, not a sourced limit, so the contract's numbers replace it (`battery_warn_hours` 24,
  `battery_alarm_hours` 8, both marked design choices that cite the contract).
- **Dark** means: battery at 0 and supply below draw. **Brownout** (the twin's other warning case) cannot be told
  from a `power` message, which carries no demand figure; `/fairshare` shows it instead (`served_pct` under 100).
- One warning and one alarm per slide down. A level re-arms when the forecast is back above it by 2 h, or the
  battery stops draining. A block that starts under 8 h gets the alarm only. This state is in memory, as before:
  after a restart the next power message can repeat an alert.
- `/forecast` rows now carry `battery_wh`, `draw_w`, `supply_w`, `net_drain_w`, `method`, `level`, `dark`.
  `battery_pct` and `drain_pct_per_h` appear only for a relay that sends percent.
- **`battery_pct` was added to CONTRACT.md as optional**, next to the requested `grid_hz`. It keeps the old
  percent-based forecast working and makes `battery_pct` a contract name rather than a hidden alias.
- **Fair share, measured draw.** A block with a `power` message uses its latest `draw_w` as demand; its critical
  load keeps the 45% share. Live and simulated readings both count (the row says which, in `demand_reading`).
  Caution for the demo: a desk relay reporting 96 W replaces a 77 MW estimate for its block, so that block looks
  almost free to serve. `?measured=0` gives the people-only table, and the fair-share demo shot uses it.
- `/fairshare` also takes `supply_pct` (percent of sector demand), because absolute watts for 70 blocks are
  unwieldy and the twin's own supply is not in watts.
- **Check-ins.** A `checkin` goes to the watches in `to` plus everyone in its `family` group, minus the sender. A
  family group is the watches registered with `POST /family` plus every watch that has itself checked in naming the
  group (rebuilt from stored messages on restart), so relatives find each other without a setup step. The alert
  carries `hops` and `via` so the twin can draw the relayed route. A check-in with nobody to tell is stored and
  raises no alert.
- The blackout demo shot was rewritten on contract power values at block scale (72.3 MW draw, 1,800 MWh battery).

## Task 4: contract endpoints

- **`POST /ingest` reply** is now `{ accepted, duplicates, rejected, warnings }`. The old keys (`added`, `dupes`,
  `errors`) are gone rather than kept beside the new ones: only my own tools used them, and two names for one
  number invite mistakes. `rejected` has the catcher's shape (`{ id, problems: [...] }`). `warnings` lists stored
  messages the sender should fix.
- **Status codes follow the catcher:** `422` when nothing in the request could be stored (it was `400`), `400` only
  for a body that is not JSON, with the catcher's message `body is not JSON`.
- **`GET /live`** names its events (`reading`, `alert`). **`GET /feed` is kept** with unnamed events, so code written
  against it (`EventSource.onmessage`) still works. Both share ids, replay and `event: reset`.
- A backlog array is sorted by `time` before storing, so `/live` plays the gap in order.
- **`GET /blocks/<block id>/latest`** returns `{ block, name, level, people, source, latest: { <kind>: message } }`.
  Alerts are not in `latest` (they are not a device kind). Unknown block: `404`.
- **`GET /help`** lists open requests only, as the contract says. `?status=assigned|all` and `&to=` were added so a
  rover can find its own job and the twin can show who is on the way. `/queue` is the same list.
- **`POST /help/<message id>/assign`**: `404` unknown id, `409` already assigned, `400` without `to`. It needs the
  API key when one is set, like every POST. `POST /dispatch` (send a responder to the top request) is kept and
  uses the same code. Assignments are stored with who and when; older data files that only recorded "dispatched"
  load as assigned to nobody in particular.
- **`GET /broadcast`** is `GET /surface` plus a one-sentence `text`, the newest `photo` and the `history` link. The
  verdict logic is unchanged, which has one consequence worth knowing: the contract's surface message carries three
  of the five readings the verdict needs (no oxygen, no fine dust), so with contract-only data the page says
  `not enough data` until a scout also sends `o2_pct` and `pm25_ugm3` (both now optional in the contract).
- The contract's lane 4 wording for the return options is "suits, domes or sealed outposts". The API's verdicts are
  `suits OK`, `sealed domes needed`, `stay underground`. I did not invent a mapping for "sealed outposts".
