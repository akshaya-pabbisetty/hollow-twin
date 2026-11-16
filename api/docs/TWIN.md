# Twin guide (Lane 4: the 3D twin and the public broadcast page)

Run every command in this guide from the `api` folder of the repository.

How to read the backend from the browser. `API` is the backend URL (`http://localhost:8787` on a laptop, or the
deployed URL). Every GET endpoint is open and sends `Access-Control-Allow-Origin: *`, so the twin on
`hollow-twin.vercel.app` can call it directly. The twin never needs the API key (only POSTs do).

## 1. Start-up: one call, then the live feed

1. `GET API/status` gives the whole current picture in one response (section 3).
2. Open the live feed from the `seq` that `/status` returned, so nothing between the two calls is missed.
3. From then on, every new reading and alert arrives on the feed within a second.

```js
const API = "https://hollow-twin-api.azurewebsites.net"; // or http://localhost:8787

let lastSeq = 0;          // id of the newest event this page has handled
const seen = new Set();   // reading ids, so a replayed event is never drawn twice

async function start() {
  const status = await fetch(API + "/status").then((r) => r.json());
  drawStatus(status);                 // forecast, alerts, queue, truth, surface, LIVE/SIMULATED tags
  lastSeq = status.seq;
  connect();
  setInterval(async () => drawStatus(await fetch(API + "/status").then((r) => r.json())), 5000);
}

function connect() {
  // ?lastEventId= tells the server where this page left off. The server sends everything after it, in order,
  // then continues live. (A browser cannot set the Last-Event-ID header on the first connection, so we use the
  // query parameter. On its own automatic reconnects the browser sends the header for us; the header wins.)
  const feed = new EventSource(`${API}/feed?lastEventId=${lastSeq}`);

  feed.onmessage = (e) => {
    const r = JSON.parse(e.data);     // a reading or an alert, in the shared format
    lastSeq = Number(e.lastEventId);  // same number as r.seq
    if (seen.has(r.id)) return;
    seen.add(r.id);
    if (r.kind === "alert") showAlert(r); else updateBlock(r);
  };

  // The server's data file was wiped (a free-tier disk reset): forget everything and reload.
  feed.addEventListener("reset", () => { seen.clear(); lastSeq = 0; feed.close(); start(); });

  // EventSource reconnects by itself after a network drop (the server asks for a 2 s wait).
  // If the browser gives up (readyState CLOSED), open a new one from where we stopped.
  feed.onerror = () => {
    if (feed.readyState === EventSource.CLOSED) setTimeout(connect, 2000);
  };
}

start();
```

What the stream looks like on the wire:

```
: connected
retry: 2000

id: 41
data: {"id":"sensor-03-17","device":"sensor-03","block":"L3-farms-04","time":"2026-11-17T14:02:11.000Z","kind":"water","values":{"tds_ppm":1450,"turbidity_ntu":1.1},"source":"live","verified":false,"seq":41}

id: 42
data: {"id":"alert-sensor-03-17-0","device":"backend","block":"L3-farms-04","time":"2026-11-17T14:02:11.412Z","kind":"alert","values":{"level":"danger","text":"Do not drink: tap water failing in L3-farms-04","cause":"sensor-03-17","cause_verified":false,"why":"TDS 1450 ppm is above 1000 ppm (WHO, ...)","limit":{"key":"water_tds_max_ppm","value":1000,"unit":"ppm","source":"WHO, ...","url":"https://..."}},"source":"live","seq":42}

: ping
```

Rules you can rely on:

- `id` rises by exactly one per event and never repeats, even across server restarts.
- Reconnecting with id N delivers N+1, N+2, ... with no gap and no repeat, then live events.
- A first connection with no `lastEventId` gets live events only. `lastEventId=0` replays the entire history.
- `: ping` comment lines arrive every 20 seconds; `EventSource` ignores them. They only keep proxies from closing
  the connection.
- No SSE available (a locked-down network)? Poll `GET API/history?after_seq=<lastSeq>` every few seconds: it
  returns the same records.

## 2. LIVE vs SIMULATED tags

Every reading and alert carries `"source": "live"` or `"source": "simulated"`. Only real hardware sends `live`;
`tools/replay.js` and `tools/scenario.js` always send `simulated`; a reading with no `source` is stored as
`simulated`. An alert inherits the source of the reading that caused it.

| Where | What to show |
|---|---|
| A block in the 3D model | `status.blocks[blockId].source` is the source of that block's newest reading. Show a green **LIVE** tag or a grey **SIMULATED** tag on the block. No entry = no data yet: show nothing. |
| One sensor value inside a block panel | `status.blocks[blockId].live_kinds` / `.simulated_kinds` list which kinds (`power`, `air`, ...) are currently live in that block. A block can have a live water sensor and simulated power. |
| An alert toast or the alert list | The alert's own `source`. Label simulated alerts so nobody mistakes a rehearsal for a real emergency. |
| The surface panel | `surface.source`: `live`, `simulated`, or `mixed` (some readings from hardware, some scripted). |
| A footer for the judges | `status.readings`: `live` vs `simulated` and `verified` vs `unverified` counts. |

Verified: `"verified": true` means the reading carried a valid device signature. Show a small lock on verified
readings; `alert.values.cause_verified` says the same about the reading behind an alert.

```js
function tagFor(blockId, status) {
  const b = status.blocks[blockId];
  if (!b) return null;                                   // no data for this block yet
  return b.source === "live" ? { text: "LIVE", color: "#1f9d55" } : { text: "SIMULATED", color: "#8a8f98" };
}
```

## 3. Which endpoint powers which layer

### The 3D twin

| Twin layer | Endpoint | Fields to use |
|---|---|---|
| Whole-sector refresh (poll every 5 s) | `GET /status` | everything below in one call |
| Power layer: battery bar and hours left per block | `status.forecast[]` or `GET /forecast?block=` | `battery_pct`, `hours_left` (null = not draining), `drain_pct_per_h`, `reasons[]` |
| Power layer: "grid unstable" halo | same | `grid_stress` (true/false), `grid_hz` |
| Fair-share overlay (the two-colour comparison) | `GET /fairshare?supply_w=9000` | `directorate.blocks[]` vs `fair.blocks[]`: `served_pct`, `dark`; plus `dark_blocks`, `equity_index`, `rule` |
| Water / air / flood / tunnel state of a block | `GET /blocks` (latest reading per block and kind), then the feed | `values`, `source`, `block_source` |
| Alert markers on blocks, alert list | `status.alerts.latest[]` (last hour, newest first), then feed events with `kind: "alert"` | `values.level` (`info` / `warn` / `danger`), `values.text`, `values.why`, `values.limit` |
| "Why?" popover on an alert | the alert itself | `values.why` (one sentence), `values.limit.value` + `.unit` + `.source` + `.url` |
| Care layer: help requests | `GET /queue` (or `status.queue.top` + `.length`) | `device`, `block`, `score`, `vitals`, `reasons[]` |
| Dispatch button | `POST /dispatch {"responder":"rover-01","block":"L1-gallery-02"}` (needs `x-api-key` if the backend has a key) | `assigned` |
| Family check-in panel | `GET /family?group=rao` | per device: `last_ok`, `block` |
| Surface layer: sky colour / gate state | `GET /surface` (or `status.surface`) | `verdict`, `reasons[]`, `readings[]` (each with `value`, `unit`, `status`, `limits[]`) |
| First-wave roster | `GET /firstwave?n=20` | `ranked[]` (`rank`, `name`, `skills`, `score`, `reasons[]`), `excluded[]`, `cleared`, `note` |
| Scrub back in time / replay a network gap | `GET /history?block=&kind=&since=` | readings in the order they were TAKEN |
| LIVE / SIMULATED tags | `status.blocks` | section 2 |
| Legend: "where do these limits come from?" | `GET /limits` | `value`, `unit`, `type`, `source`, `url`, `verified` |

Suggested colours for `values.level`: `info` blue, `warn` amber, `danger` red.
Surface verdicts: `suits OK` green, `sealed domes needed` amber, `stay underground` red, `not enough data` grey.

### The public broadcast page

| Panel | Endpoint | Fields to use |
|---|---|---|
| The truth counter: residents' count vs the Directorate's | `GET /truth` (or `status.truth`) | `residents_total`, `official_total`, per block `residents`, `official`, `gap`; `rule` explains how a resident is counted |
| Surface verdict banner | `GET /surface` | `verdict`, `reasons[0]` |
| Surface public record (the tamper-evident timeline) | `GET /surface/history` | entries with `type: "reading"` (`values`, `device`, `source`) and `type: "verdict"` (`previous`, `verdict`, `reasons`) in stored order |
| Who goes up first | `GET /firstwave` | `ranked[]` with `reasons[]`; show the reasons, that is the point |
| Power: who is kept in the dark | `GET /fairshare?supply_w=<today's supply>` | `directorate.dark_blocks` vs `fair.dark_blocks` |
| Live ticker | `GET /feed` | events with `kind: "alert"`: `values.text` |
| "Is this real?" footer | `status.readings` | `live`, `simulated`, `verified`, `unverified` |

## 4. The `/status` response, annotated

```json
{
  "time": "2026-11-17T14:05:00.000Z",
  "seq": 187,
  "forecast": [
    { "block": "L6-borebend-02", "battery_pct": 62, "drain_pct_per_h": -8.88, "hours_left": 7, "grid_hz": 59.97,
      "grid_stress": false, "reasons": ["battery 62% falling 8.88 %/h gives 7 h left", "forecast 7 h is below 8 h (design choice: ...)"] }
  ],
  "alerts": {
    "window_min": 60, "count": 14, "by_level": { "info": 3, "warn": 5, "danger": 6 },
    "latest": [ { "id": "alert-...", "kind": "alert", "block": "L6-borebend-02", "seq": 186, "source": "simulated",
                  "values": { "level": "warn", "text": "L6-borebend-02 has about 7 h of battery left", "why": "...", "limit": { "...": "..." } } } ]
  },
  "queue": { "length": 2, "top": { "id": "watch-43-...", "device": "watch-43", "block": "L5-rivet-01", "score": 65, "vitals": { "hr_bpm": 96, "spo2_pct": 96, "temp_c": 38.4 }, "reasons": ["help pressed: 50 points", "+15: temperature 38.4 C is above 38 C (...)"] } },
  "truth": { "window_h": 24, "residents_total": 12, "official_total": 2, "gap": 10,
             "blocks": [ { "block": "L8-deepwell-03", "residents": 12, "official": 2, "gap": 10 } ] },
  "surface": { "verdict": "sealed domes needed", "reasons": ["radiation 2.1 µSv/h is above 1 µSv/h (IAEA, ...)"], "missing": [], "source": "simulated" },
  "blocks": {
    "L6-borebend-02": { "source": "simulated", "latest_time": "2026-11-17T14:04:58.000Z", "latest_device": "relay-06", "live_kinds": [], "simulated_kinds": ["power"] },
    "L3-farms-04":    { "source": "live", "latest_time": "2026-11-17T14:04:59.000Z", "latest_device": "sensor-03", "live_kinds": ["water"], "simulated_kinds": ["vitals"] }
  },
  "readings": { "total": 96, "verified": 12, "unverified": 84, "live": 20, "simulated": 76 },
  "feed_clients": 2
}
```

- `seq` is the newest event id. Open the feed with `?lastEventId=<seq>`.
- `alerts.count` is the full number in the last hour; `latest` holds at most the 100 newest.
- `forecast` only lists blocks that have sent power readings.

## 5. Try it without hardware

Start the backend, then fill it with one video shot at a time and watch the twin react:

```
node server.js
```

```
node tools/scenario.js blackout
```

Shots: `blackout`, `fairshare`, `networkcut`, `water`, `outbreak`, `care`, `surface`, or `all`.
