# Lane 1: Backend API

Owns this folder and `CONTRACT.md`. Everything lane 1 runs lives here: server, logic, shared data, tests, tools, docs.
Moved in from the standalone backend (80 tests). The work to make it speak `CONTRACT.md` exactly follows in the
next commits on this branch.

Run every command below from this folder:

```
cd api
```

The rule-based brain behind Hollow Twin, a live 3D model of one sector of the Hollow (Patriot HackFest Fall
2026, track "Life underground").

**In:** readings from residents' devices (watches, relay boxes, sensor nodes, scout robots), posted to `/ingest`,
directly or through relays that store and forward when the network is cut.

**Decisions:** explicit rules, no machine learning and no AI calls. Each rule compares a reading with a limit from
`shared/limits.json` (published safety limits with their sources, plus a few marked design choices) and returns
its reasons. It warns before failures, shares power fairly, tracks the real outbreak against the Directorate's
official numbers, routes "I'm OK" to family, ranks help requests, and judges whether the surface is safe.

**Out:** alerts back down to watches (`/inbox`), a live feed and status for the 3D twin (`/feed`, `/status`), and
public truth for the broadcast page (`/truth`, `/surface`, `/surface/history`, `/firstwave`).

Needs only Node 20 or newer. There are no packages to install.

| Guide | For |
|---|---|
| `docs/FIRMWARE.md` | Lanes 2 and 3: what to POST, batching, signing, alerts for watches |
| `docs/TWIN.md` | Lane 4: live feed code, which endpoint powers which layer, LIVE / SIMULATED tags |
| `docs/DEPLOY.md` | Azure App Service, Render, Docker |
| `shared/FORMAT.md` | The reading format every lane builds against |
| `shared/limits.json` | Every threshold, with its source |
| `DECISIONS.md` | Choices made while building, and why |

## Run it

Each command goes on its own line (PowerShell, macOS and Linux).

```
node server.js
```

In a second terminal, send endless fake device data (tagged simulated):

```
node tools/replay.js
```

Open http://localhost:8787/status in a browser, or http://localhost:8787/feed to watch readings stream in.

## Test it

```
npm test
```

End-to-end tests against real servers on random ports with temporary data files: the original 14, plus tests for
limits, live vs simulated, feed reconnects, ingest failures, signatures, surface, status, every demo scenario and
the docs.

## Demo scenarios (one per video shot)

Start the server, then in a second terminal:

```
node tools/scenario.js blackout
```

| Shot | What it shows |
|---|---|
| `blackout` | Grid frequency sags, the warning fires, then the battery forecast drops under 8 h |
| `fairshare` | The Directorate's allocation vs fair share for the same supply |
| `networkcut` | A relay holds readings during a cut, uploads the backlog, and the history has no gap |
| `water` | A clean cup, then a salty cup gives do-not-drink |
| `outbreak` | Residents' reports climb while the official count stays at 2 |
| `care` | Help requests ranked by need, then a robot dispatched |
| `surface` | Scout readings arrive; the verdict and the first-wave list update |
| `all` | Every shot in order |

Options: a second argument sets the backend URL, `--fast` removes the pauses.

```
node tools/scenario.js all http://localhost:8787 --fast
```

### Reset between takes

Shots are written for a fresh, empty server. For a clean take: stop the server (Ctrl+C), delete the data file,
start it again.

PowerShell:

```
Remove-Item readings.jsonl
```

macOS / Linux:

```
rm readings.jsonl
```

## Settings

| Environment variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `DATA` | `readings.jsonl` | The append-only data file (the whole database) |
| `INGEST_KEY` | unset | When set, every POST needs the header `x-api-key` |
| `DEVICE_KEYS` | unset | Device signing secrets as JSON, instead of the file `shared/keys.json` |
| `RATE_LIMIT` | `20` | Single posts per device per second |

PowerShell example (macOS / Linux: `INGEST_KEY=my-key node server.js`):

```
$env:INGEST_KEY = "my-key"
```

```
node server.js
```

## Endpoints

All responses are JSON. All GET endpoints are open (CORS `*`). Examples are shortened with `...`.

### POST /ingest

One reading, or an array of readings (a relay backlog). Duplicates by `id` are dropped.

```
POST /ingest
{"id":"sensor-03-17","device":"sensor-03","block":"L3-farms-04","time":"2026-11-17T14:02:11Z","kind":"water","values":{"tds_ppm":1450,"turbidity_ntu":1.1},"source":"live"}
```

```json
{ "added": 1, "dupes": 0, "errors": [] }
```

Rejected readings come back with a reason (HTTP 400 when nothing in the request was stored):

```json
{ "added": 0, "dupes": 0, "errors": [{ "id": "sensor-03-18", "err": "unknown kind smell" }] }
```

| Rule | Result |
|---|---|
| Body over 5 MB | `413 {"error":"body too large...","limit_bytes":5000000}` |
| Body is not JSON | `400 {"error":"bad json"}` |
| More than 20 single posts per second from one device | `429` with `Retry-After: 1`. An array is one request and is never dropped |
| `time` more than 5 minutes in the future | rejected: `time ... is more than 5 minutes in the future` |
| `time` before 2020 (no clock sync) | accepted; `time` becomes the receive time, plus `"time_estimated": true` and `"device_time"` |
| `source` missing | stored as `"simulated"`. Real hardware sends `"live"` |
| `sig` valid / missing / wrong | stored `"verified": true` / stored `"verified": false` / rejected: `bad signature for <device>` |
| `INGEST_KEY` set and `x-api-key` missing or wrong | `401` |

A stored reading looks like this (`seq`, `source`, `verified` are added by the backend):

```json
{ "id": "sensor-03-17", "device": "sensor-03", "block": "L3-farms-04", "time": "2026-11-17T14:02:11Z", "kind": "water",
  "values": { "tds_ppm": 1450, "turbidity_ntu": 1.1 }, "source": "live", "verified": false, "seq": 41 }
```

### Alerts

Rules create alerts automatically. They are stored like readings with `kind: "alert"`, appear in `/feed`,
`/history`, `/inbox` and `/status`, and always say why:

```json
{ "id": "alert-sensor-03-17-0", "device": "backend", "block": "L3-farms-04", "time": "2026-11-17T14:02:11.412Z",
  "kind": "alert", "source": "live", "seq": 42,
  "values": {
    "level": "danger",
    "text": "Do not drink: tap water failing in L3-farms-04",
    "cause": "sensor-03-17", "cause_verified": false,
    "why": "TDS 1450 ppm is above 1000 ppm (WHO, Total dissolved solids in drinking-water (background document, 2003))",
    "limit": { "key": "water_tds_max_ppm", "value": 1000, "unit": "ppm", "op": ">", "type": "safety fact",
               "source": "WHO, Total dissolved solids in drinking-water (background document, 2003)", "url": "https://cdn.who.int/...", "verified": true },
    "limits": ["..."]
  } }
```

| Alert | Fires when | Level |
|---|---|---|
| Power cut likely soon | grid frequency more than 0.036 Hz from 60 Hz | danger |
| About N h of battery left | battery forecast under 8 h (once, re-arms at 10 h) | warn |
| Do not drink | TDS above 1000 ppm or turbidity above 5 NTU | danger |
| Air going stale / Air unsafe | CO2 above 1000 ppm / above 5000 ppm | warn / danger |
| Flooding: tunnel closed | water deeper than 15 cm | warn |
| Tunnel closed | a rover reports `status: closed` | warn |
| Help requested | a watch sends button `help` | danger |
| X is OK | a watch sends button `ok` with a family group (sent to that family only) | info |
| Surface verdict | the surface verdict changes | info / warn / danger |

### GET /feed

Server-sent events: every new reading and alert, live. Every event has an `id` (the record's `seq`). Reconnect
with the `Last-Event-ID` header, or `?lastEventId=`, to receive everything missed, in order. See `docs/TWIN.md`.

```
GET /feed?lastEventId=41
```

```
id: 42
data: {"id":"alert-sensor-03-17-0","device":"backend","kind":"alert",...,"seq":42}
```

### GET /status

One call for the whole twin: forecast per block, alerts in the last hour, queue length and top request, truth
totals, surface verdict, live vs simulated per block, verified vs unverified counts.

```
GET /status
```

```json
{ "time": "2026-11-17T14:05:00.000Z", "seq": 187,
  "forecast": [{ "block": "L6-borebend-02", "battery_pct": 62, "hours_left": 7, "grid_stress": false, "...": "..." }],
  "alerts": { "window_min": 60, "count": 14, "by_level": { "info": 3, "warn": 5, "danger": 6 }, "latest": ["..."] },
  "queue": { "length": 2, "top": { "device": "watch-43", "score": 65, "...": "..." } },
  "truth": { "window_h": 24, "residents_total": 12, "official_total": 2, "gap": 10, "blocks": ["..."] },
  "surface": { "verdict": "sealed domes needed", "reasons": ["radiation 2.1 µSv/h is above 1 µSv/h (IAEA, ...)"], "missing": [], "source": "simulated" },
  "blocks": { "L3-farms-04": { "source": "live", "latest_time": "...", "latest_device": "sensor-03", "live_kinds": ["water"], "simulated_kinds": ["vitals"] } },
  "readings": { "total": 96, "verified": 12, "unverified": 84, "live": 20, "simulated": 76 },
  "feed_clients": 2 }
```

### GET /history

Stored readings and alerts in the order they were TAKEN. Filters: `block`, `kind`, `since` (ISO time),
`after_seq` (everything stored after that sequence number).

```
GET /history?block=L7-sump-03&kind=air&since=2026-11-17T14:00:00Z
```

```json
[ { "id": "sensor-07-1", "device": "sensor-07", "block": "L7-sump-03", "time": "2026-11-17T14:00:05.000Z", "kind": "air",
    "values": { "co2_ppm": 820 }, "source": "simulated", "verified": false, "seq": 12 } ]
```

### GET /blocks

The latest reading per block and kind. `block_source` says whether that block's newest data is live or simulated.

```
GET /blocks
```

```json
[ { "id": "sensor-03-17", "block": "L3-farms-04", "kind": "water", "values": { "tds_ppm": 1450, "turbidity_ntu": 1.1 },
    "source": "live", "block_source": "live", "...": "..." } ]
```

### GET /forecast

Battery hours left and grid-frequency stress, per block (`?block=` for one).

```
GET /forecast?block=L6-borebend-02
```

```json
[ { "block": "L6-borebend-02", "battery_pct": 62, "drain_pct_per_h": -8.88, "hours_left": 7, "grid_hz": 59.97, "grid_stress": false,
    "reasons": ["battery 62% falling 8.88 %/h gives 7 h left", "forecast 7 h is below 8 h (design choice: ...)"] } ]
```

### GET /fairshare

Who gets power for a given supply: the Directorate's rule and fair share side by side. `?policy=directorate` or
`?policy=fair` returns just one.

```
GET /fairshare?supply_w=9000
```

```json
{ "directorate": { "policy": "directorate", "supply_w": 9000, "rule": "Directorate: upper levels are served in full first; ...",
                   "blocks": [{ "block": "L8-deepwell-03", "level": 8, "served_w": 0, "served_pct": 0, "dark": true }, "..."],
                   "dark_blocks": ["L6-borebend-02", "L7-sump-03", "L8-deepwell-03"], "equity_index": 0 },
  "fair": { "policy": "fair", "supply_w": 9000, "rule": "Fair share: every block's critical load ... first, then the rest split per person.",
            "blocks": [{ "block": "L8-deepwell-03", "level": 8, "served_w": 1513, "served_pct": 69, "dark": false }, "..."],
            "dark_blocks": [], "equity_index": 0.75 } }
```

### GET /queue and POST /dispatch

Open help requests ranked by a triage score, with the reasons for every point. Dispatch sends a responder to the
top request (among equal scores, the one nearest the responder's level) and tells the resident.

```
GET /queue
```

```json
[ { "id": "watch-42-9", "device": "watch-42", "block": "L8-deepwell-03", "time": "2026-11-17T14:03:00.000Z", "score": 115,
    "vitals": { "hr": 132, "spo2": 89, "temp_c": 39.2 },
    "reasons": ["help pressed: 50 points", "+30: SpO2 89 % is below 92 % (Royal College of Physicians, ...)",
                "+20: pulse 132 bpm is above 110 bpm (...)", "+15: temperature 39.2 C is above 38 C (...)"] } ]
```

```
POST /dispatch
{"responder":"rover-01","block":"L1-gallery-02"}
```

```json
{ "assigned": { "id": "watch-42-9", "device": "watch-42", "block": "L8-deepwell-03", "score": 115, "...": "..." } }
```

`{"assigned": null}` when the queue is empty.

### POST /family, GET /family, GET /inbox

Family groups route "I'm OK" presses to family watches only. `/inbox` is what a relay fetches for a watch: alerts
for the watch's block plus alerts addressed to it. `&after_seq=` returns only newer ones.

```
POST /family
{"group":"rao","devices":["watch-11","watch-71"]}
```

```json
{ "ok": true }
```

```
GET /family?group=rao
```

```json
[ { "device": "watch-11", "last_ok": "2026-11-17T14:02:00.000Z", "block": "L1-gallery-02" },
  { "device": "watch-71", "last_ok": null, "block": null } ]
```

```
GET /inbox?device=watch-71&after_seq=40
```

```json
[ { "id": "alert-watch-11-5-0", "kind": "alert", "block": "L1-gallery-02", "seq": 44, "source": "live",
    "values": { "level": "info", "text": "watch-11 is OK (L1-gallery-02)", "to": ["watch-71"], "group": "rao", "...": "..." } } ]
```

### POST /official and GET /truth

The Directorate's published case count per block, against the residents' own count (distinct people who pressed
`symptom` or whose watch measured low blood oxygen in the last 24 hours).

```
POST /official
{"block":"L8-deepwell-03","count":2}
```

```json
{ "ok": true }
```

```
GET /truth
```

```json
{ "window_h": 24, "residents_total": 12, "official_total": 2,
  "blocks": [{ "block": "L8-deepwell-03", "residents": 12, "official": 2, "gap": 10 }],
  "rule": "A resident counts once if, in the last 24 h, their watch sent a symptom press or SpO2 below 94% (Royal College of Physicians, ...)." }
```

### GET /surface

The latest value of each surface reading (`co2_ppm`, `o2_pct`, `temp_c`, `pm25_ugm3`, `radiation_usv_h`)
compared with its limits, and a verdict: `suits OK`, `sealed domes needed`, `stay underground`, or
`not enough data` when any of the five readings is missing (never a guess).

```
GET /surface
```

```json
{ "verdict": "sealed domes needed",
  "reasons": ["radiation 2.1 µSv/h is above 1 µSv/h (IAEA, Operational Intervention Levels for Reactor Emergencies (EPR-NPP-OILs 2017), OIL3)"],
  "missing": [], "source": "simulated",
  "readings": [
    { "reading": "radiation_usv_h", "label": "radiation", "value": 2.1, "unit": "µSv/h", "status": "sealed domes needed",
      "reason": "radiation 2.1 µSv/h is above 1 µSv/h (IAEA, ...)", "time": "...", "device": "scout-01", "block": "L0-crown-01",
      "source": "simulated", "verified": false, "limits": [{ "key": "surface_radiation_stay_usv_h", "value": 25, "...": "..." }, { "key": "surface_radiation_domes_usv_h", "value": 1, "...": "..." }] },
    { "reading": "o2_pct", "label": "oxygen", "value": 20.9, "unit": "%", "status": "ok", "reason": "oxygen 20.9 % is inside every limit (...)", "...": "..." },
    "..."
  ],
  "rule": "Worst reading wins. ..." }
```

### GET /surface/history

The append-only public record: every surface reading and every verdict change, in stored order.

```
GET /surface/history
```

```json
[ { "seq": 90, "type": "reading", "time": "...", "id": "scout-01-3", "device": "scout-01", "block": "L0-crown-01",
    "values": { "radiation_usv_h": 2.1 }, "source": "simulated", "verified": false },
  { "seq": 91, "type": "verdict", "time": "...", "id": "alert-scout-01-3-surface", "verdict": "sealed domes needed", "previous": "suits OK",
    "reasons": ["radiation 2.1 µSv/h is above 1 µSv/h (IAEA, ...)"], "cause": "scout-01-3", "source": "simulated" } ]
```

### GET /firstwave

Ranks who goes up first (`?n=20`). Rules: volunteers only (button type `volunteer`); listed in
`shared/people.json`; never sole caregivers; no open help request; latest vitals (within 24 h) inside the healthy
ranges; then most needed skills first, ties to who volunteered first. Everyone carries their reasons, including
the people who were left out.

```
GET /firstwave?n=20
```

```json
{ "surface_verdict": "suits OK", "cleared": true, "note": "Surface verdict is \"suits OK\": this is the order people go up.",
  "n": 20, "needed_skills": ["medic", "engineer", "farmer"], "volunteers": 6, "eligible": 3,
  "ranked": [
    { "rank": 1, "device": "watch-52", "name": "Tobin Okafor", "block": "L1-gallery-02", "skills": ["engineer", "farmer"], "score": 20,
      "volunteered_at": "...", "vitals": { "hr": 70, "spo2": 98, "temp_c": 36.7 }, "source": "simulated",
      "reasons": ["volunteered at ...", "not a sole caregiver", "no open help request",
                  "latest vitals healthy: SpO2 98 %, pulse 70 bpm, temperature 36.7 C (Royal College of Physicians, ...)",
                  "+10: skill \"engineer\" is needed", "+10: skill \"farmer\" is needed"] } ],
  "excluded": [{ "device": "watch-53", "name": "Mirela Stoica", "reasons": ["sole caregiver: never sent up"], "...": "..." }],
  "rule": "Volunteers only. Never sole caregivers. ..." }
```

### GET /limits

Every threshold in use, straight from `shared/limits.json`.

```
GET /limits
```

```json
{ "water_tds_max_ppm": { "value": 1000, "unit": "ppm", "op": ">", "type": "safety fact", "source": "WHO, ...", "url": "https://...", "verified": true, "note": "..." },
  "battery_warn_hours": { "value": 8, "unit": "h", "op": "<", "type": "design choice", "reason": "..." },
  "...": "..." }
```

### Anything else

```json
{ "error": "not found" }
```

with HTTP 404.

## Files

```
server.js          HTTP endpoints, ingest pipeline, alert rules, live feed
logic.js           forecast, fair share, help queue, truth check
surface.js         surface verdict, surface record, first wave
limits.js          loads shared/limits.json
sign.js            reading signatures (HMAC-SHA256)
shared/            FORMAT.md, limits.json, sector.json, people.json, keys.example.json
tools/scenario.js  demo shots        tools/replay.js  endless fake devices
tools/sign.js      signing helper    tools/check.js   checks a running or deployed backend
tests/             end-to-end tests (npm test)
docs/              FIRMWARE.md, TWIN.md, DEPLOY.md, examples/post_reading.ino
```
