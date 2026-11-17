# Twin and broadcast guide (lane 4)

How to read the real API from the browser, in the terms of [`CONTRACT.md`](../../CONTRACT.md). If the twin already
listens to `node tools/catcher.mjs`, it already works with the API: `GET /live` sends the same
`event: reading` with the message as `data`. Change the address and the port (8787 instead of 8788).

`API` is the API's address (`http://localhost:8787` on a laptop, or the deployed address). Every GET endpoint is
open and sends `Access-Control-Allow-Origin: *`, so the twin on `hollow-twin.vercel.app` can call it directly.
The twin needs no key to read. Only POSTs (assigning a help request) need the `x-api-key` header, and only if the
API was started with a key.

One thing to know before you start: `twin/README.md` suggests `python3 -m http.server 8787` to open the twin
locally, and the API also defaults to port 8787. Run one of them on another port.

## 1. Start-up: one call, then the live stream

1. `GET API/status` gives the whole current picture in one response (section 4).
2. Open `/live` from the `seq` that `/status` returned, so nothing between the two calls is missed.
3. From then on, every accepted message and every alert arrives on the stream within a second.

```js
const API = "https://hollow-twin-api.azurewebsites.net"; // or http://localhost:8787

let lastSeq = 0;          // id of the newest event this page has handled
const seen = new Set();   // message ids, so a replayed event is never drawn twice

async function start() {
  const status = await fetch(API + "/status").then((r) => r.json());
  drawStatus(status);                 // forecast, alerts, help queue, truth, surface, LIVE/SIMULATED tags
  lastSeq = status.seq;
  connect();
  setInterval(async () => drawStatus(await fetch(API + "/status").then((r) => r.json())), 5000);
}

function connect() {
  // ?lastEventId= tells the API where this page left off. It sends everything after it, in order, then
  // continues live. (A browser cannot set the Last-Event-ID header on the first connection, so we use the
  // query parameter. On its own automatic reconnects the browser sends the header for us; the header wins.)
  const live = new EventSource(`${API}/live?lastEventId=${lastSeq}`);
  const once = (e) => {
    const m = JSON.parse(e.data);     // a contract message, or an alert
    lastSeq = Number(e.lastEventId);  // same number as m.seq
    if (seen.has(m.id)) return null;
    seen.add(m.id);
    return m;
  };

  // CONTRACT.md section 4: every accepted message is sent as `event: reading`
  live.addEventListener("reading", (e) => { const m = once(e); if (m) updateBlock(m); });
  // lane 1 addition: the API's own warnings arrive on the same stream as `event: alert`
  live.addEventListener("alert", (e) => { const a = once(e); if (a) showAlert(a); });

  // The API's data file was wiped (a free-tier disk reset): forget everything and reload.
  live.addEventListener("reset", () => { seen.clear(); lastSeq = 0; live.close(); start(); });

  // EventSource reconnects by itself after a network drop (the API asks for a 2 s wait).
  // If the browser gives up (readyState CLOSED), open a new one from where we stopped.
  live.onerror = () => {
    if (live.readyState === EventSource.CLOSED) setTimeout(connect, 2000);
  };
}

start();
```

What the stream looks like on the wire:

```
: connected
retry: 2000

id: 41
event: reading
data: {"id":"watch-0042-000389","device":"watch-0042","block":"l8-bore-bend","time":"2026-11-18T20:00:00Z","kind":"checkin","values":{"status":"ok","family":"fam-0007","to":["watch-0110"]},"hops":2,"via":["relay-l8-bore-bend","relay-l8-gantry-bend"],"source":"live","verified":false,"seq":41}

id: 42
event: alert
data: {"id":"alert-watch-0042-000389-0","device":"backend","block":"l8-bore-bend","time":"2026-11-18T20:00:00.412Z","kind":"alert","values":{"level":"info","text":"watch-0042 is OK (l8-bore-bend)","cause":"watch-0042-000389","to":["watch-0110"],"family":"fam-0007","hops":2,"via":["relay-l8-bore-bend","relay-l8-gantry-bend"],"why":"watch-0042 checked in for family group fam-0007, to watch-0110, relayed over 2 hops (relay-l8-bore-bend > relay-l8-gantry-bend)"},"hops":0,"via":[],"source":"live","seq":42}

: ping
```

Rules you can rely on:

- `id` rises by exactly one per event and never repeats, even across API restarts.
- Reconnecting with id N delivers N+1, N+2, ... with no gap and no repeat, then live events.
- A first connection with no `lastEventId` gets live events only. `lastEventId=0` replays the entire history.
- A relay backlog (one array posted after a network cut) is played out oldest first, so the twin can replay the
  gap in order as the contract's section 5 says.
- `: ping` comment lines arrive every 20 seconds; `EventSource` ignores them. They only keep proxies from closing
  the connection.
- No SSE available (a locked-down network)? Poll `GET API/history?after_seq=<lastSeq>` every few seconds: it
  returns the same records.

### The twin's four tasks, in API terms

| Task in `twin/README.md` | How |
|---|---|
| Subscribe to `/live` and let real messages override the simulated values for their block | The code above. `m.block` is an id from `contract/blocks.json`; `m.kind` and `m.values` are the contract's. Use `m.source === "live"` to decide whether a message should override the simulation (section 2). To paint a block when the page opens, before any event arrives: `GET API/blocks/<block id>/latest` |
| Help queue from `button: help` messages, ranked by triage | `GET API/help` is already ranked, with the reasons. Assign with `POST API/help/<message id>/assign` and body `{ "to": "rover-01" }` |
| Show a relayed check-in arriving (the `hops` and `via` fields) when the network is cut | A `checkin` arrives as `event: reading` with its `hops` and `via`. The matching `event: alert` ("watch-0042 is OK") repeats them in `values.hops` and `values.via` and lists who it was delivered to in `values.to` |
| Hand the forecast, fair-share and outbreak logic to the API | `GET API/forecast` (or `status.forecast`) and `GET API/fairshare?supply_pct=<percent>`. Outbreak: the API has the residents' count against the official one (`GET API/truth`); the simulation of how an outbreak spreads stays in the twin |

## 2. LIVE and SIMULATED tags

Every message and alert carries `"source": "live"` or `"source": "simulated"`. Only real hardware sends `live`;
`tools/replay.mjs`, `api/tools/replay.js` and the demo scenarios are stored as `simulated`, and so is any message
with no `source`. An alert inherits the source of the message that caused it.

| Where | What to show |
|---|---|
| A block in the 3D model | `status.blocks[blockId].source` is the source of that block's newest message. Show a green **LIVE** tag or a grey **SIMULATED** tag on the block. No entry = the API has nothing for this block: keep the twin's own simulation and show no tag. |
| One sensor value inside a block panel | `status.blocks[blockId].live_kinds` / `.simulated_kinds` list which kinds (`power`, `air`, ...) are currently live in that block. A block can have a live water sensor and simulated power. |
| An alert toast or the alert list | The alert's own `source`. Label simulated alerts so nobody mistakes a rehearsal for a real emergency. |
| The surface panel | `broadcast.source`: `live`, `simulated`, or `mixed` (some readings from hardware, some scripted). |
| A footer for the judges | `status.readings`: `live` against `simulated`, and `verified` against `unverified`. |

Verified: `"verified": true` means the message carried a valid device signature. Show a small lock on verified
messages; `alert.values.cause_verified` says the same about the message behind an alert.

```js
function tagFor(blockId, status) {
  const b = status.blocks[blockId];
  if (!b) return null;                                   // no data for this block yet
  return b.source === "live" ? { text: "LIVE", color: "#1f9d55" } : { text: "SIMULATED", color: "#8a8f98" };
}
```

## 3. Which endpoint feeds which layer

### The 3D twin

| Twin layer | Endpoint | Fields to use |
|---|---|---|
| Whole-sector refresh (poll every 5 s) | `GET /status` | everything below in one call |
| One block, when its panel opens | `GET /blocks/<block id>/latest` | `latest.power`, `latest.air`, `latest.water`, `latest.flood`, `latest.vitals`, ... each a full contract message; `source` |
| Power layer: hours left per block | `status.forecast[]` or `GET /forecast?block=` | `hours_left` (null = not draining), `level` (`ok` / `warn` / `alarm` / `unknown`), `dark`, `battery_wh`, `draw_w`, `supply_w`, `reasons[]` |
| Power layer: "grid unstable" halo | same | `grid_stress` (true/false), `grid_hz` |
| Fair-share overlay (the one switch) | `GET /fairshare?supply_pct=60` | `directorate.blocks[]` against `fair.blocks[]`: `served_pct`, `dark`; `levels[]` for a per-level summary; plus `dark_blocks`, `equity_index`, `rule`. All 70 blocks, in the order of `contract/blocks.json` |
| A block with a real relay | same, `measured[]` | the relay's own `battery_wh`, `draw_w`, `supply_w`, `hours_left`, `level_name`, with `tag` `LIVE` or `SIMULATED`. Show it beside the block, never in place of the table's estimate |
| Air, heat, water, flood state of a block | `/live` events with `kind` `air`, `water`, `flood` | `values`, `source` |
| Tunnels | `/live` events with `kind: "tunnel"` | `values.from_block`, `values.to_block`, `values.status`, `values.reason`, `values.photo_url` |
| Alert markers and the alert list | `status.alerts.latest[]` (last hour, newest first), then `event: alert` | `values.level` (`info` / `warn` / `danger`), `values.text`, `values.why`, `values.limit` |
| "Why?" popover on an alert | the alert itself | `values.why` (one sentence), `values.limit.value` + `.unit` + `.source` + `.url` |
| Help queue | `GET /help` (or `status.queue.top` + `.length`) | `id`, `device`, `block`, `score`, `vitals`, `reasons[]` |
| Assign button | `POST /help/<message id>/assign` with `{"to":"rover-01"}` (needs `x-api-key` if the API has a key) | `assigned` |
| Who is on the way | `GET /help?status=assigned` | `assigned_to`, `assigned_at` |
| Family check-in panel | `GET /family?family=fam-0007` | per watch: `last_ok`, `block`, `hops`, `via` |
| First-wave roster | `GET /firstwave?n=20` | `ranked[]` (`rank`, `name`, `skills`, `score`, `reasons[]`), `excluded[]`, `cleared`, `note` |
| Scrub back in time, replay a network gap | `GET /history?block=&kind=&since=` | messages in the order they were measured |
| LIVE / SIMULATED tags | `status.blocks` | section 2 |
| Legend: "where do these limits come from?" | `GET /limits` | `value`, `unit`, `type`, `source`, `url`, `verified` |

Suggested colours for `values.level`: `info` blue, `warn` amber, `danger` red.

**The API's limits are not the twin's numbers yet.** The twin colours a block from its own thresholds (the table in
the contract's section 6); the API alerts from sourced limits (section 6.1). Until the team agrees one set, a
block can be amber in the twin while the API has raised no alert, or the other way round. The cases:

| Reading | Twin | API |
|---|---|---|
| CO2 | warning over 2,000 ppm, alarm over 4,000 | warning over 1,000 ppm, alarm over 5,000 |
| Air temperature | warning over 39 °C, alarm over 43 °C | heat index (temperature and humidity together) 39.4 °C and 51.7 °C |
| Flood | warning over 25 cm, tunnel closes over 45 cm | tunnel closed over 15 cm |
| Battery | warning under 24 h, alarm under 8 h or dark | the same |
| Water | simulated contamination index 25 / 50 | `tds_ppm` over 1,000 or `turbidity_ntu` over 5 |

The simplest way to show one truth is to colour from the API's alerts and `forecast[].level` rather than from the
raw values.

**Fair share.** The API's table is in watts: 100 W per person, 45 W of it critical, from the people in
`contract/blocks.json` (3,212 MW for the sector). The twin's own units are different, so pass the supply as a
share: `GET /fairshare?supply_pct=60`. Shot 4 of the video is two calls with the same supply: show
`directorate.blocks[]` (Deepwell's blocks dark), then `fair.blocks[]` (none dark). A desk relay's real 96 W never
changes that table; its numbers are in `measured[]`, to show beside its block with the `LIVE` tag.

### The public broadcast page

`broadcast/README.md` asks for four things. One call covers three of them:

```js
const page = await fetch(API + "/broadcast").then((r) => r.json());
```

| Task in `broadcast/README.md` | Fields |
|---|---|
| Live video or the latest rover photo | `page.photo` (`url`, `time`, `device`), or `null` when no scout has sent a `photo_url` |
| Each `surface` reading against its human-safe limit | `page.readings[]`: `label`, `value`, `unit`, `status` (`ok`, one of the four verdicts, `no data`, `not measured`), `required`, `reason`, and `limits[]` with each limit's `value`, `unit`, `source` and `url` |
| A plain-language verdict | `page.verdict` and `page.text` (one sentence), with `page.reasons[]` |
| A history of past readings so anyone can check old claims | `GET API + page.history` (`/surface/history`): every surface reading (`type: "reading"`) and every verdict change (`type: "verdict"`, with `previous`, `verdict`, `reasons`) in stored order. Nothing in the API can edit or delete an entry |

Three things to know about the verdict:

- It is one of the return options in `broadcast/README.md`, worst reading wins: `suits OK` (suits), `sealed domes
  needed` (domes), `sealed outposts needed` (sealed outposts), or `stay underground` (none of them); or
  `not enough data`. Suggested colours: green, amber, orange, red, grey. `CONTRACT.md` section 4.3 says what each
  one means and which readings lead to it.
- It needs the contract's three readings (`co2_ppm`, `temp_c`, `radiation_usv_h`). The contract's own surface
  sample gives `suits OK` on its own. Until all three have arrived the page gets `not enough data` and
  `page.missing` names what is missing. Show that as it is; the API never guesses.
- `o2_pct` and `pm25_ugm3` are optional (contract section 2.1). Until a scout sends them they are listed in
  `page.not_measured` and their rows have `status: "not measured"`; once measured they can make the verdict worse.

More panels for the broadcast page, all open GETs:

| Panel | Endpoint | Fields to use |
|---|---|---|
| The truth counter: residents' count against the Directorate's | `GET /truth` (or `status.truth`) | `residents_total`, `official_total`, per block `residents`, `official`, `gap`; `rule` explains how a resident is counted. The official number is set with `POST /official {"block":"l8-bore-bend","count":2}` |
| Who goes up first | `GET /firstwave` | `ranked[]` with `reasons[]`; show the reasons, that is the point |
| Power: who is kept in the dark | `GET /fairshare?supply_pct=<today's supply>` | `directorate.dark_blocks` against `fair.dark_blocks` |
| Live ticker | `GET /live` | `event: alert`: `values.text` |
| "Is this real?" footer | `status.readings` | `live`, `simulated`, `verified`, `unverified` |

## 4. The `/status` response, annotated

```json
{
  "time": "2026-11-18T20:05:00.000Z",
  "seq": 187,
  "forecast": [
    { "block": "l6-flint-face", "battery_wh": 498600000, "draw_w": 72300000, "supply_w": 0, "net_drain_w": 72300000,
      "hours_left": 6.9, "method": "net drain", "level": "alarm", "dark": false, "grid_hz": 59.97, "grid_stress": false,
      "reasons": ["battery 498600000 Wh with draw 72300000 W and supply 0 W: net drain 72300000 W gives 6.9 h left", "forecast 6.9 h is below 8 h (design choice: CONTRACT.md section 6, ...)"],
      "time": "2026-11-18T20:04:58.000Z", "source": "simulated" }
  ],
  "alerts": {
    "window_min": 60, "count": 14, "by_level": { "info": 3, "warn": 5, "danger": 6 },
    "latest": [ { "id": "alert-...", "kind": "alert", "block": "l6-flint-face", "seq": 186, "source": "simulated",
                  "values": { "level": "danger", "text": "l6-flint-face has about 8 h of battery left", "hours_left": 7.9, "why": "...", "limit": { "...": "..." } } } ]
  },
  "queue": { "length": 2, "top": { "id": "watch-0043-...", "device": "watch-0043", "block": "l5-rail-face", "score": 65, "vitals": { "hr_bpm": 96, "spo2_pct": 96, "temp_c": 38.4 }, "reasons": ["help pressed: 50 points", "+15: temperature 38.4 C is above 38 C (...)"], "status": "open" } },
  "truth": { "window_h": 24, "residents_total": 14, "official_total": 2, "gap": 12,
             "blocks": [ { "block": "l8-bore-bend", "residents": 13, "official": 2, "gap": 11 } ] },
  "surface": { "verdict": "sealed outposts needed", "reasons": ["radiation 2.1 µSv/h is above 1 µSv/h (IAEA, ...)"], "missing": [], "not_measured": [], "source": "simulated" },
  "blocks": {
    "l6-flint-face": { "source": "simulated", "latest_time": "2026-11-18T20:04:58.000Z", "latest_device": "relay-l6-flint-face", "live_kinds": [], "simulated_kinds": ["power"] },
    "l3-ember-yard": { "source": "live", "latest_time": "2026-11-18T20:04:59.000Z", "latest_device": "sensor-l3-ember-yard", "live_kinds": ["water"], "simulated_kinds": ["vitals"] }
  },
  "readings": { "total": 96, "verified": 12, "unverified": 84, "live": 20, "simulated": 76 },
  "feed_clients": 2
}
```

- `seq` is the newest event id. Open the stream with `?lastEventId=<seq>`.
- `alerts.count` is the full number in the last hour; `latest` holds at most the 100 newest.
- `forecast` only lists blocks that have sent `power` messages. `blocks` only lists blocks that have sent
  anything. For the other blocks the twin keeps its own simulation.

## 5. Try it without hardware

Run these from the `api` folder. Start the API:

```
npm start
```

Then fill it with one video shot at a time and watch the twin react:

```
npm run scenario -- blackout
```

Shots: `blackout`, `fairshare`, `networkcut`, `water`, `outbreak`, `care`, `surface`, or `all`. The `networkcut`
shot is the one that sends a relayed check-in with `hops` and `via`. Or send the team's fixed samples, from the
top of the repository:

```
node tools/replay.mjs http://localhost:8787/ingest
```
