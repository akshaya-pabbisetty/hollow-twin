# Lane 1: Backend API

Owns this folder and [`CONTRACT.md`](../CONTRACT.md). The API takes every message the devices send, in the
contract's format, and turns it into what the twin and the broadcast page show: warnings before a blackout, a fair
split of power, the real outbreak count, a ranked help queue, family check-ins, and a verdict on the surface.

Every decision is an explicit rule that compares a reading with a limit and says why. There is no machine learning
and there are no AI calls. Every limit, with its published source, is in `shared/limits.json`.

It needs Node 20 or newer and nothing else. There are no packages to install.

## Lane 1 checklist

- [x] `POST /ingest`: one message or an array, drop duplicate ids, store everything.
- [x] `GET /live`: server-sent events, `event: reading` per accepted message (alerts as `event: alert`).
- [x] `GET /blocks/<block id>/latest`, `GET /help`, `POST /help/<id>/assign`, `GET /broadcast`.
- [x] Replay a backlog posted after a network cut in `time` order.
- [x] Move the blackout forecast out of `twin/index.html` and into the API (`GET /forecast`).
- [x] Move the fair-share allocation out of `twin/index.html` and into the API (`GET /fairshare`).
- [ ] Move the outbreak model out of `twin/index.html` and into the API. Partly done: the API counts the real
      outbreak from residents' watches against the official number (`GET /truth`). The twin's simulation of how an
      outbreak spreads from block to block is still in the twin.
- [ ] Deploy somewhere the devices and the twin can both reach. Not done: the instructions are written
      (`docs/DEPLOY.md`), nothing has been deployed.
- [x] The team's tools pass: `node tools/replay.mjs http://localhost:8787/ingest 1 3`, and every file in
      `contract/samples/` is accepted unchanged.
- [x] Agree the thresholds with the team: the sourced limits in `CONTRACT.md` section 6.1 are agreed, and the twin
      reads them from `GET /limits`.

## Guides

| Guide | For |
|---|---|
| [`../CONTRACT.md`](../CONTRACT.md) | Everyone: the message format, kinds, device ids, endpoints, thresholds |
| [`docs/FIRMWARE.md`](docs/FIRMWARE.md) | Lanes 2 and 3: what to POST, the replies, network cuts, signing, alerts for watches |
| [`docs/TWIN.md`](docs/TWIN.md) | Lane 4: the live stream, which endpoint feeds which layer, the broadcast page |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Azure App Service, Render, Docker |
| [`DECISIONS.md`](DECISIONS.md) | Choices made while building, and why |

## Run it

Each command goes on its own line (PowerShell, macOS and Linux). Start in this folder:

```
cd api
```

```
npm start
```

The API is now on http://localhost:8787. In a second terminal, from the top of the repository, send the team's
sample messages (three rounds, one second apart):

```
node tools/replay.mjs http://localhost:8787/ingest 1 3
```

Each round prints `200 {"accepted":9,"duplicates":0,"rejected":[],"warnings":[]}`. Open
http://localhost:8787/status in a browser for the whole picture, or http://localhost:8787/live to watch
messages stream in.

For endless fake devices that drift toward trouble (run from `api`):

```
node tools/replay.js
```

## Test it

```
npm test
```

End-to-end tests against real servers on random ports with temporary data files. They cover the contract format,
the 70 blocks, the logic, every endpoint, the thresholds, the team's tools and samples, every demo scenario, and
the docs.

## Demo scenarios (one per video shot)

Start the server, then in a second terminal (in `api`):

```
npm run scenario -- blackout
```

| Shot | What it shows |
|---|---|
| `blackout` | The mains frequency sags and the warning fires; then the battery forecast counts down through the 24 h warning and the 8 h alarm |
| `fairshare` | The Directorate's allocation against fair share for the same supply, across all 70 blocks |
| `networkcut` | A relay holds messages during a cut, the backlog hops to a neighbour and goes up, and the history has no gap |
| `water` | A clean cup, then a salty cup gives do-not-drink |
| `outbreak` | Residents' reports climb while the official count stays at 2 |
| `care` | Help requests ranked by need, then the top one assigned to the rover |
| `surface` | Scout readings arrive; the verdict, the broadcast text and the first-wave list update |
| `all` | Every shot in order |

`--fast` removes the pauses. A second argument sets the API's address.

```
npm run scenario -- all --fast
```

```
node tools/scenario.js all https://your-api.example --fast
```

Every scenario message uses real block ids and device ids from the contract and is tagged `"source": "simulated"`.

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

## Deploy it

Nothing is deployed yet. [`docs/DEPLOY.md`](docs/DEPLOY.md) has the steps for Azure App Service, Render and Docker.
The short version, from the top of the repository, for Azure:

```
az webapp up --name hollow-twin-api --resource-group hollow-twin-rg --runtime "NODE:22-lts" --sku B1 --location eastus
```

```
az webapp config set --name hollow-twin-api --resource-group hollow-twin-rg --startup-file "node api/server.js"
```

Then check the deployed API (from `api`; this stores nothing):

```
node tools/check.js https://hollow-twin-api.azurewebsites.net
```

## Settings

| Environment variable | Default | Meaning |
|---|---|---|
| `PORT` | `8787` | Port to listen on |
| `DATA` | `readings.jsonl` beside `server.js` | The append-only data file (the whole database) |
| `INGEST_KEY` | unset | When set, every POST needs the header `x-api-key` |
| `DEVICE_KEYS` | unset | Device signing secrets as JSON, instead of the file `shared/keys.json` |
| `RATE_LIMIT` | `20` | Single posts per device per second |
| `BLOCKS` | `../contract/blocks.json` | The block list, for a host that only has the `api` folder |

PowerShell example (macOS / Linux: `INGEST_KEY=my-key npm start`):

```
$env:INGEST_KEY = "my-key"
```

```
npm start
```

## Endpoints

All responses are JSON, except the two event streams. All GET endpoints are open to any origin. Examples are
shortened with `...`.

### The contract endpoints (CONTRACT.md section 4)

| Method and path | Does |
|---|---|
| `POST /ingest` | One message or an array. Replies `{ "accepted": n, "duplicates": n, "rejected": [...], "warnings": [...] }` |
| `GET /live` | Server-sent events: `event: reading` per accepted message, `event: alert` per alert, with ids and `Last-Event-ID` replay |
| `GET /blocks/<block id>/latest` | The latest message of each kind for that block |
| `GET /help` | Open help requests, highest priority first |
| `POST /help/<message id>/assign` | Body `{ "to": "rover-01" }`. Marks the request as assigned |
| `GET /broadcast` | Latest surface readings against their limits, the verdict text, and a link to the history |

### Everything else

| Method and path | Does |
|---|---|
| `GET /status` | The whole picture in one call |
| `GET /history` | Stored messages in the order they were measured |
| `GET /blocks` | The latest message of each kind, for every block at once |
| `GET /forecast` | Battery hours left and mains-frequency stress, per block |
| `GET /fairshare` | The Directorate's rule against fair share, for a given supply |
| `GET /inbox` | The alerts for one watch |
| `POST /family`, `GET /family` | Family groups and who has checked in |
| `POST /official`, `GET /truth` | The official case count against the residents' count |
| `GET /surface`, `GET /surface/history` | The surface verdict in full, and its public record |
| `GET /firstwave` | Who goes up first |
| `GET /limits` | Every threshold, with its source |
| `GET /forgeries` | The public log of forged readings (wrong `sig`): refused, never stored as readings |
| `GET /feed`, `GET /queue`, `POST /dispatch` | Earlier names, kept working |

### POST /ingest

One message in the contract format, or an array of them (a relay backlog). Duplicates by `id` are dropped.

```
POST /ingest
{"id":"sensor-l3-ember-yard-000017","device":"sensor-l3-ember-yard","block":"l3-ember-yard","time":"2026-11-18T20:00:00Z","kind":"water","values":{"tds_ppm":1450,"turbidity_ntu":1.1},"hops":0,"via":[],"source":"live"}
```

```json
{ "accepted": 1, "duplicates": 0, "rejected": [], "warnings": [] }
```

A message that cannot be used comes back in `rejected` with every reason. A message that was stored but has
something the sender should fix comes back in `warnings`.

```json
{ "accepted": 1, "duplicates": 0,
  "rejected": [{ "id": "watch-0042-000390", "problems": ["unknown block \"L8-Bore-Bend\": not in contract/blocks.json (...). Did you mean \"l8-bore-bend\"?"] }],
  "warnings": [{ "id": "watch-42-000001", "warnings": ["device id \"watch-42\" does not match CONTRACT.md section 3 (...)"] }] }
```

| Situation | Result |
|---|---|
| At least one message stored, or all were duplicates | `200` |
| Nothing in the request could be stored | `422`, reasons in `rejected` |
| Body is not JSON | `400 {"error":"body is not JSON"}` |
| Body over 5 MB | `413 {"error":"body too large...","limit_bytes":5000000}` |
| More than 20 single posts per second from one device | `429` with `Retry-After: 1`. An array is one request and is never limited |
| `INGEST_KEY` set and `x-api-key` missing or wrong | `401` |
| `block` not in `contract/blocks.json` and not `surface` | rejected, with a hint when only the case is wrong |
| `device` does not fit CONTRACT.md section 3 | stored, with a warning |
| An impossible value, a jump or drift (sensor error, CONTRACT.md 1.3) | stored with `"plausible": false`, `sensor_error` and `sensor_flags`, with a warning; no alert, and left out of all logic |
| `time` before 2020, or ahead of the moment the API receives it | stored; `time` becomes the receive time, plus `"time_estimated": true`, `"device_time"` and a warning |
| `hops` / `via` missing | stored as `0` / `[]` |
| `source` missing | stored as `"simulated"`. Real hardware sends `"live"` |
| `sig` valid / missing / wrong | stored `"verified": true` / stored `"verified": false` / rejected: `bad signature for <device>` |
| Old value names (`hr`, `spo2`, button `type`) | stored under the contract names, with a warning |
| `kind` is `alert` | rejected: alerts are written by the API only |

A stored message looks like this (`seq`, `source`, `verified` are added by the API):

```json
{ "id": "sensor-l3-ember-yard-000017", "device": "sensor-l3-ember-yard", "block": "l3-ember-yard", "time": "2026-11-18T20:00:00Z",
  "kind": "water", "values": { "tds_ppm": 1450, "turbidity_ntu": 1.1 }, "hops": 0, "via": [], "source": "live", "verified": false, "seq": 41 }
```

### Alerts

Rules create alerts automatically. They are stored like messages with `kind: "alert"`, arrive on `/live` as
`event: alert`, appear in `/history`, `/inbox` and `/status`, and always say why:

```json
{ "id": "alert-sensor-l3-ember-yard-000017-0", "device": "backend", "block": "l3-ember-yard", "time": "2026-11-18T20:00:00.412Z",
  "kind": "alert", "hops": 0, "via": [], "source": "live", "seq": 42,
  "values": {
    "level": "danger",
    "text": "Do not drink: tap water failing in l3-ember-yard",
    "cause": "sensor-l3-ember-yard-000017", "cause_verified": false,
    "why": "TDS 1450 ppm is above 1000 ppm (WHO, Total dissolved solids in drinking-water (background document, 2003))",
    "limit": { "key": "water_tds_max_ppm", "value": 1000, "unit": "ppm", "op": ">", "type": "safety fact",
               "source": "WHO, Total dissolved solids in drinking-water (background document, 2003)", "url": "https://cdn.who.int/...", "verified": true },
    "limits": ["..."]
  } }
```

| Alert | Fires when | Level |
|---|---|---|
| Power cut likely soon | `grid_hz` more than 0.036 Hz from 60 Hz | danger |
| About N h of battery left | battery forecast under 24 h (once per slide down) | warn |
| About N h of battery left / is dark | battery forecast under 8 h, or battery empty with supply below draw | danger |
| Do not drink | `tds_ppm` above 1000 or `turbidity_ntu` above 5 | danger |
| Air going stale / Air unsafe | `co2_ppm` above 1000 / above 5000 | warn / danger |
| Dangerous heat / Extreme heat | heat index (from `temp_c` and `humidity_pct`) at 39.4 °C or more / 51.7 °C or more | warn / danger |
| Flooding: tunnel closed | `depth_cm` above 15 | warn |
| Tunnel closed between A and B | a rover reports `status: closed` (sent to residents of both blocks) | warn |
| Help requested | a watch sends button `help` | danger |
| X is OK | a `checkin` (sent to the watches in `to` and the family group only) | info |
| X sent to Y | a help request is assigned | info |
| Surface verdict | the surface verdict changes (suits: info, domes: warn, outposts and stay: danger) | info / warn / danger |

These are the limits the team agreed (`CONTRACT.md` section 6.1). The twin uses the same numbers, read from `GET /limits`.

### GET /live

Server-sent events. `event: reading` for every accepted message, `event: alert` for every alert. Every event has an
`id` (the message's `seq`). Reconnect with the `Last-Event-ID` header, or `?lastEventId=`, to receive everything
missed, in order. See `docs/TWIN.md`. A message refused for a wrong `sig` is sent as `event: forgery` (no `id`, never
replayed; see `GET /forgeries`).

```
GET /live?lastEventId=41
```

```
id: 42
event: alert
data: {"id":"alert-sensor-l3-ember-yard-000017-0","device":"backend","kind":"alert",...,"seq":42}
```

`GET /feed` is the same stream with unnamed events (the name the API used before the contract).

### GET /blocks/<block id>/latest

```
GET /blocks/l7-chalk-cut/latest
```

```json
{ "block": "l7-chalk-cut", "name": "Chalk Cut", "level": "L7", "people": 784000, "source": "simulated",
  "latest": {
    "air": { "id": "sensor-l7-chalk-cut-002202", "device": "sensor-l7-chalk-cut", "block": "l7-chalk-cut", "time": "...", "kind": "air",
             "values": { "co2_ppm": 853, "temp_c": 24.5, "humidity_pct": 55 }, "hops": 0, "via": [], "source": "simulated", "verified": false, "seq": 30 },
    "checkin": { "id": "watch-0071-000025", "kind": "checkin", "values": { "status": "ok", "family": "fam-0071", "to": ["watch-0011"] },
                 "hops": 2, "via": ["relay-l7-chalk-cut", "relay-l7-ash-wells"], "...": "..." } } }
```

`source` says whether the block's newest message is `live` or `simulated` (`null` when it has sent nothing).
`404` for a block that is not in `contract/blocks.json`. `surface` works too. `GET /blocks` returns the same
latest messages for every block at once, as one list.

### GET /help and POST /help/<message id>/assign

Open help requests ranked by a triage score, with the reason for every point.

```
GET /help
```

```json
[ { "id": "watch-0042-000388", "device": "watch-0042", "block": "l8-bore-bend", "time": "2026-11-18T20:00:00Z", "score": 115,
    "vitals": { "hr_bpm": 132, "spo2_pct": 89, "temp_c": 39.2 },
    "reasons": ["help pressed: 50 points", "+30: SpO2 89 % is below 92 % (Royal College of Physicians, ...)",
                "+20: pulse 132 bpm is above 110 bpm (...)", "+15: temperature 39.2 C is above 38 C (...)"],
    "status": "open", "assigned_to": null, "assigned_at": null, "hops": 0, "via": [], "source": "simulated" } ]
```

`?status=assigned` or `?status=all` also lists requests somebody was sent to; `&to=rover-01` narrows that to one
responder (this is how the rover finds its job).

```
POST /help/watch-0042-000388/assign
{"to":"rover-01"}
```

```json
{ "assigned": { "id": "watch-0042-000388", "device": "watch-0042", "block": "l8-bore-bend", "score": 115,
                "status": "assigned", "assigned_to": "rover-01", "assigned_at": "2026-11-18T20:01:10.000Z", "...": "..." } }
```

The request leaves the open list and the watch receives "rover-01 sent to watch-0042 in l8-bore-bend". `404` for an
unknown id, `409` if it is already assigned, `400` without `to`.

`GET /queue` is `GET /help` under its earlier name. `POST /dispatch` with `{"responder":"rover-01","block":"l1-winch-gallery"}`
assigns the top request (among equal scores, the one nearest the responder's level) and replies in the same shape;
`{"assigned": null}` when the queue is empty.

### GET /broadcast

Everything the public page shows.

```
GET /broadcast
```

```json
{ "verdict": "sealed outposts needed",
  "text": "The latest surface readings support sealed outposts only: the surface itself is past a limit for living off it, so only small sealed outposts supplied from the Hollow can be held, with no work outside.",
  "reasons": ["radiation 2.1 µSv/h is above 1 µSv/h (IAEA, Operational Intervention Levels for Reactor Emergencies (EPR-NPP-OILs 2017), OIL3)",
              "not measured: oxygen, PM2.5 (optional readings; the verdict rests on what was measured)"],
  "missing": [], "not_measured": ["o2_pct", "pm25_ugm3"], "source": "simulated", "time": "2026-11-18T20:00:00Z",
  "readings": [
    { "reading": "radiation_usv_h", "label": "radiation", "required": true, "value": 2.1, "unit": "µSv/h", "status": "sealed outposts needed",
      "reason": "radiation 2.1 µSv/h is above 1 µSv/h (IAEA, ...)", "time": "...", "device": "surface-01", "block": "surface",
      "source": "simulated", "verified": false,
      "limits": [{ "key": "surface_radiation_stay_usv_h", "value": 25, "unit": "µSv/h", "option": "stay underground", "source": "IAEA, ...", "url": "https://...", "...": "..." },
                 { "key": "surface_radiation_domes_usv_h", "value": 1, "option": "sealed outposts needed", "...": "..." }] },
    { "reading": "o2_pct", "label": "oxygen", "required": false, "value": null, "status": "not measured", "reason": "oxygen has not been measured (optional: the verdict does not wait for it)", "...": "..." },
    "..."
  ],
  "photo": { "url": "https://example.invalid/surface-01/000012.jpg", "time": "...", "device": "surface-01" },
  "history": "/surface/history",
  "rule": "Worst reading wins. ..." }
```

The verdict is the return option the readings support, worst reading wins:

| Verdict | Means |
|---|---|
| `suits OK` | an open settlement: people work on the surface in suits |
| `sealed domes needed` | the open air is unfit (CO2, oxygen, dust or heat): sealed domes with scrubbed air, farming under cover |
| `sealed outposts needed` | the surface itself is unfit to live off (radiation past the IAEA food and water level, or lethal heat or cold): small sealed outposts supplied from the Hollow, no work outside |
| `stay underground` | nobody goes up (radiation past the IAEA relocation level, or CO2 at the IDLH level) |
| `not enough data` | one of the contract's three readings (`co2_ppm`, `temp_c`, `radiation_usv_h`) has not been sent yet; `text` names it |

`o2_pct` and `pm25_ugm3` are optional: when measured they can only make the verdict worse, and until then they are
listed in `not_measured`. The contract's own surface sample gives `suits OK` on its own. Each entry in `limits`
says which option (`option`) crossing it leads to; `CONTRACT.md` section 4.3 has the table and the reasons.

### GET /status

One call for the whole twin.

```
GET /status
```

```json
{ "time": "2026-11-18T20:05:00.000Z", "seq": 187,
  "forecast": [{ "block": "l6-flint-face", "battery_wh": 498600000, "draw_w": 72300000, "supply_w": 0, "net_drain_w": 72300000,
                 "hours_left": 6.9, "method": "net drain", "level": "alarm", "dark": false, "grid_hz": 59.97, "grid_stress": false, "...": "..." }],
  "alerts": { "window_min": 60, "count": 14, "by_level": { "info": 3, "warn": 5, "danger": 6 }, "latest": ["..."] },
  "queue": { "length": 2, "top": { "device": "watch-0043", "score": 65, "...": "..." } },
  "truth": { "window_h": 24, "residents_total": 14, "official_total": 2, "gap": 12, "blocks": ["..."] },
  "surface": { "verdict": "sealed outposts needed", "reasons": ["radiation 2.1 µSv/h is above 1 µSv/h (IAEA, ...)"], "missing": [], "not_measured": [], "source": "simulated" },
  "blocks": { "l6-flint-face": { "source": "simulated", "latest_time": "...", "latest_device": "relay-l6-flint-face", "live_kinds": [], "simulated_kinds": ["power"] } },
  "readings": { "total": 61, "verified": 0, "unverified": 61, "implausible": 0, "live": 0, "simulated": 61 },
  "feed_clients": 2 }
```

### GET /history

Stored messages and alerts in the order they were measured. Filters: `block`, `kind`, `since` (ISO time),
`after_seq` (everything stored after that sequence number).

```
GET /history?block=l7-chalk-cut&kind=air&since=2026-11-18T20:00:00Z
```

```json
[ { "id": "sensor-l7-chalk-cut-002202", "device": "sensor-l7-chalk-cut", "block": "l7-chalk-cut", "time": "2026-11-18T20:00:00Z", "kind": "air",
    "values": { "co2_ppm": 2350, "temp_c": 40.2, "humidity_pct": 71 }, "hops": 0, "via": [], "source": "simulated", "verified": false, "seq": 12 } ]
```

### GET /forecast

Battery hours left per block (`?block=` for one). `hours_left = battery_wh / (draw_w - supply_w)` while the block
draws more than it is supplied. `level` is `ok`, `warn` (under 24 h), `alarm` (under 8 h, or dark) or `unknown`.

```
GET /forecast?block=l8-bore-bend
```

```json
[ { "block": "l8-bore-bend", "battery_wh": 412, "draw_w": 96, "supply_w": 40, "net_drain_w": 56, "hours_left": 7.4,
    "method": "net drain", "level": "alarm", "dark": false, "grid_hz": null, "grid_stress": false,
    "reasons": ["battery 412 Wh with draw 96 W and supply 40 W: net drain 56 W gives 7.4 h left", "forecast 7.4 h is below 8 h (design choice: CONTRACT.md section 6, ...)"],
    "time": "2026-11-18T20:00:00Z", "source": "simulated" } ]
```

`hours_left` is `null` when supply covers the draw. If a relay sends no `draw_w` (or only the optional
`battery_pct`), the battery level is fitted over its latest readings instead and `method` is `slope`.

### GET /fairshare

Who gets power for a given supply, across all 70 blocks of `contract/blocks.json`: the Directorate's rule and fair
share side by side. `?policy=directorate` or `?policy=fair` returns just one. A block's demand is 100 W per person
and its critical load (air, pumps, medical) 45 W per person; both are design choices in `shared/limits.json`.

Give the supply in watts (`supply_w`) or as a share of what the sector needs (`supply_pct`).

The 70-block table is one consistent model: every block is sized from its people, in megawatts. What a real relay
measures (watts) never goes into that table. It is reported beside it, under `measured`: one entry per block with a
relay, with its battery, draw, supply and the hours left worked out from them, tagged `LIVE` or `SIMULATED`.

The example asks for 60% of what the sector needs. The Directorate's rule serves levels L0 to L6 in full and leaves
18 blocks on L7 and L8 dark; fair share leaves none dark. `levels` sums the comparison per level.

```
GET /fairshare?supply_pct=60
```

```json
{ "directorate": { "policy": "directorate", "supply_w": 1927020000, "demand_total_w": 3211700000, "critical_total_w": 1445265000,
                   "rule": "Directorate: upper levels are served in full first; ...",
                   "blocks": [{ "block": "l8-bore-bend", "name": "Bore Bend", "level": "L8", "people": 772000, "demand_w": 77200000,
                                "critical_w": 34740000, "served_w": 0, "served_pct": 0, "dark": true }, "..."],
                   "levels": [{ "level": "L0", "blocks": 4, "people": 428000, "served_pct": 100, "dark_blocks": 0 }, "...", { "level": "L8", "blocks": 10, "people": 7425000, "served_pct": 0, "dark_blocks": 10 }],
                   "dark_blocks": ["l7-ember-wells", "...", "l8-drift-hollow"], "equity_index": 0 },
  "fair": { "policy": "fair", "supply_w": 1927020000, "demand_total_w": 3211700000, "critical_total_w": 1445265000,
            "rule": "Fair share: every block's critical load ... first, then the rest split per person.",
            "blocks": [{ "block": "l8-bore-bend", "name": "Bore Bend", "level": "L8", "people": 772000, "demand_w": 77200000,
                         "critical_w": 34740000, "served_w": 46320000, "served_pct": 60, "dark": false }, "..."],
            "levels": ["..."], "dark_blocks": [], "equity_index": 1 },
  "measured": [
    { "block": "l8-bore-bend", "name": "Bore Bend", "level": "L8", "people": 772000, "tag": "LIVE", "source": "live", "device": "relay-l8-bore-bend",
      "time": "2026-11-18T20:00:00Z", "verified": false, "battery_wh": 412, "draw_w": 96, "supply_w": 40, "net_drain_w": 56,
      "hours_left": 7.4, "level_name": "alarm", "dark": false, "served_pct": 42,
      "note": "What this block's own relay measured, in watts. The per-person table estimates the whole sector in megawatts; the two are never mixed." } ] }
```

`dark` means the block's critical load is not covered. A block with `served_pct` under 100 that is not dark is in
brownout. `measured[].served_pct` is the relay's own supply over its own draw.

### POST /family, GET /family, GET /inbox

A `checkin` goes to the watches in its `to` list and to everyone in its `family` group. A family group is the
watches registered here plus every watch that has itself checked in naming the group. `/inbox` is what a relay
fetches for a watch: alerts for the watch's block plus alerts addressed to it. `&after_seq=` returns only newer ones.

```
POST /family
{"group":"fam-0007","devices":["watch-0042","watch-0110"]}
```

```json
{ "ok": true }
```

```
GET /family?family=fam-0007
```

```json
[ { "device": "watch-0042", "last_ok": "2026-11-18T20:00:00Z", "block": "l8-bore-bend", "hops": 2, "via": ["relay-l8-bore-bend", "relay-l8-gantry-bend"] },
  { "device": "watch-0110", "last_ok": null, "block": null, "hops": null, "via": null } ]
```

A group nobody has registered or checked in for yet returns `[]`, and no `?family=` at all returns 400.

```
GET /inbox?device=watch-0110&after_seq=40
```

```json
[ { "id": "alert-watch-0042-000389-0", "kind": "alert", "block": "l8-bore-bend", "seq": 44, "source": "live",
    "values": { "level": "info", "text": "watch-0042 is OK (l8-bore-bend)", "to": ["watch-0110"], "family": "fam-0007",
                "sent": "2026-11-18T20:00:00Z", "hops": 2, "via": ["relay-l8-bore-bend", "relay-l8-gantry-bend"], "...": "..." } } ]
```

### POST /official and GET /truth

The Directorate's published case count per block, against the residents' own count (distinct people who pressed
`symptom` or whose watch measured low blood oxygen in the last 24 hours).

```
POST /official
{"block":"l8-bore-bend","count":2}
```

```json
{ "ok": true }
```

```
GET /truth
```

```json
{ "window_h": 24, "residents_total": 12, "official_total": 2,
  "blocks": [{ "block": "l8-bore-bend", "residents": 12, "official": 2, "gap": 10 }],
  "rule": "A resident counts once if, in the last 24 h, their watch sent a symptom press or SpO2 below 94% (Royal College of Physicians, ...)." }
```

### GET /surface and GET /surface/history

`GET /surface` is the verdict part of `/broadcast` (verdict, reasons, missing, readings, rule).
`GET /surface/history` is the append-only public record: every surface reading and every verdict change, in stored
order.

```
GET /surface/history
```

```json
[ { "seq": 79, "type": "reading", "time": "...", "id": "surface-01-000013", "device": "surface-01", "block": "surface",
    "values": { "radiation_usv_h": 2.1 }, "source": "simulated", "verified": false },
  { "seq": 80, "type": "verdict", "time": "...", "id": "alert-surface-01-000013-surface", "verdict": "sealed outposts needed", "previous": "suits OK",
    "reasons": ["radiation 2.1 µSv/h is above 1 µSv/h (IAEA, ...)"], "cause": "surface-01-000013", "source": "simulated" } ]
```

### GET /firstwave

Ranks who goes up first (`?n=20`). Rules: volunteers only (button `volunteer`); listed in `shared/people.json`;
never sole caregivers; no open help request; latest vitals (within 24 h) inside the healthy ranges; then most
needed skills first, ties to who volunteered first. Everyone carries their reasons, including the people who were
left out.

```
GET /firstwave?n=20
```

```json
{ "surface_verdict": "suits OK", "cleared": true, "note": "Surface verdict is \"suits OK\": this is the order people go up.",
  "n": 20, "needed_skills": ["medic", "engineer", "farmer"], "volunteers": 6, "eligible": 3,
  "ranked": [
    { "rank": 1, "device": "watch-0052", "name": "Tobin Okafor", "block": "l1-winch-gallery", "skills": ["engineer", "farmer"], "score": 20,
      "volunteered_at": "...", "vitals": { "hr_bpm": 70, "spo2_pct": 98, "temp_c": 36.7 }, "source": "simulated",
      "reasons": ["volunteered at ...", "not a sole caregiver", "no open help request",
                  "latest vitals healthy: SpO2 98 %, pulse 70 bpm, temperature 36.7 C (Royal College of Physicians, ...)",
                  "+10: skill \"engineer\" is needed", "+10: skill \"farmer\" is needed"] } ],
  "excluded": [{ "device": "watch-0053", "name": "Mirela Stoica", "reasons": ["sole caregiver: never sent up"], "...": "..." }],
  "rule": "Volunteers only. Never sole caregivers. ..." }
```

### GET /limits

Every threshold in use, straight from `shared/limits.json`.

```
GET /limits
```

```json
{ "water_tds_max_ppm": { "value": 1000, "unit": "ppm", "op": ">", "type": "safety fact", "source": "WHO, ...", "url": "https://...", "verified": true, "note": "..." },
  "battery_warn_hours": { "value": 24, "unit": "h", "op": "<", "type": "design choice", "reason": "CONTRACT.md section 6, ..." },
  "...": "..." }
```

### GET /forgeries

The public log of forged readings: messages whose `sig` does not match the key on file for their device. Each one
is refused on `POST /ingest` (`bad signature for <device>`) and never stored as a reading; it is logged here and
sent on `GET /live` as `event: forgery`. At most 20 per device per second are logged (`ingest_rate_limit_per_s`,
counting every message, also inside an array); the rest are counted in `rate_limited` (since the server started).
The newest 1,000 are kept here (`forgery_log_max`); the data file keeps all. A claim over 2 KB
(`forgery_max_values_bytes`) is replaced by `claimed_bytes`. `?after=<n>` returns only newer entries.

```
GET /forgeries?after=6
```

```json
{ "count": 7, "rate_limited": 0, "kept": 7,
  "forgeries": [{ "time": "2026-11-17T20:03:11.402Z", "device": "relay-l8-bore-bend", "block": "l8-bore-bend", "kind": "power",
    "id": "relay-l8-bore-bend-000124", "claimed_time": "2026-11-17T20:03:10Z", "claimed_values": { "battery_wh": 9900, "draw_w": 96, "supply_w": 96 },
    "hops": 0, "via": [], "reason": "bad signature for relay-l8-bore-bend: sig does not match id|device|block|time|kind|values", "rejected": true, "n": 7 }],
  "rule": "A message whose sig does not match the key on file for its device is refused and never stored as a reading. ..." }
```

### Anything else

```json
{ "error": "not found" }
```

with HTTP 404.

## Files

```
server.js          HTTP endpoints, ingest pipeline, alert rules, live stream
contract.js        the CONTRACT.md message format: kinds, checks, old-name aliases
blocks.js          the 70 blocks of ../contract/blocks.json, device-id checks
logic.js           forecast, fair share, help queue, truth check
surface.js         surface verdict, broadcast, surface record, first wave
heat.js            the heat index (US National Weather Service equation)
limits.js          loads shared/limits.json
sign.js            message signatures (HMAC-SHA256)
shared/            limits.json, people.json, keys.example.json
tools/scenario.js  demo shots        tools/replay.js  endless fake devices
tools/sign.js      signing helper    tools/check.js   checks a running or deployed API
tests/             end-to-end tests (npm test)
docs/              FIRMWARE.md, TWIN.md, DEPLOY.md, examples/post_reading.ino
```
