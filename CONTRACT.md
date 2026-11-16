# Contract

Every device, the API and the twin agree on what is in this file. Build against it and you never have to wait for someone else's code.

**Changing it:** only the lane 1 (backend) owner edits this file. Ask in the group chat first, then everyone pulls. Adding a new field is fine any time; renaming or removing one needs everyone's OK.

## 1. Message format

Every reading, button press and status update is one JSON message:

```json
{
  "id": "watch-0042-000387",
  "device": "watch-0042",
  "block": "l8-bore-bend",
  "time": "2026-11-18T20:00:00Z",
  "kind": "vitals",
  "values": { "hr_bpm": 104, "spo2_pct": 93, "temp_c": 38.1 },
  "hops": 0,
  "via": []
}
```

| Field | Meaning |
| --- | --- |
| `id` | Unique per message: `<device>-<counter>`. Relays and the API drop a message whose `id` they have already seen. |
| `device` | Device ID, see section 3. |
| `block` | Block ID from [`contract/blocks.json`](contract/blocks.json), or `surface` for the surface scout. |
| `time` | When it was measured, ISO 8601 in UTC. Real wall-clock time; the twin maps it onto the story clock. |
| `kind` | One of the kinds in section 2. |
| `values` | The reading itself. Fields depend on `kind`. |
| `hops` | How many relays have forwarded it. The device that measured it sends `0`. |
| `via` | Relay device IDs it passed through, in order. |

One sample of every kind is in [`contract/samples/`](contract/samples/).

## 2. Kinds

| Kind | Sent by | `values` |
| --- | --- | --- |
| `power` | relay box | `battery_wh`, `draw_w`, `supply_w` |
| `vitals` | watch | `hr_bpm`, `spo2_pct`, `temp_c` |
| `button` | watch | `button`: `help`, `symptom` or `ok` |
| `checkin` | watch | `status`: `ok`; `family`: family group ID; `to`: list of watch IDs to reach |
| `water` | sensor node | `tds_ppm`, `turbidity_ntu` |
| `air` | sensor node | `co2_ppm`, `temp_c`, `humidity_pct` |
| `flood` | sensor node | `depth_cm` |
| `tunnel` | scout robot | `from_block`, `to_block`, `status`: `open` or `closed`, `reason`, `photo_url` |
| `surface` | surface scout | `co2_ppm`, `temp_c`, `radiation_usv_h`, `photo_url` |

## 3. Device IDs

| Device | ID pattern | Example |
| --- | --- | --- |
| Watch | `watch-<4 digits>` | `watch-0042` |
| Relay box | `relay-<block id>` | `relay-l8-bore-bend` |
| Sensor node | `sensor-<block id>` | `sensor-l7-chalk-cut` |
| Scout robot | `rover-<2 digits>` | `rover-01` |
| Surface scout | `surface-<2 digits>` | `surface-01` |

## 4. API endpoints (lane 1 builds these)

| Method and path | Does |
| --- | --- |
| `POST /ingest` | Takes one message or an array. Drops duplicate `id`s. Returns `{ "accepted": <n>, "duplicates": <n> }`. |
| `GET /live` | Server-sent events. Every accepted message is sent as `event: reading` with the message as `data`. |
| `GET /blocks/<block id>/latest` | The latest message of each kind for that block. |
| `GET /help` | Open help requests, highest priority first. |
| `POST /help/<message id>/assign` | Body `{ "to": "rover-01" }`. Marks a request as assigned. |
| `GET /broadcast` | Latest `surface` readings plus the verdict text, for the public page. |

Until the real API is up, `node tools/catcher.mjs` serves `POST /ingest` and `GET /live` on port 8788 with the same shapes.

## 5. When the Directorate cuts the network

1. A relay that can't reach the API keeps every message in a queue on the device.
2. It forwards each message to the relays it can hear, adding 1 to `hops` and its own ID to `via`.
3. Any relay that has seen an `id` before drops it.
4. When any relay reaches the API again, it posts its whole queue to `POST /ingest` as one array, with the original `time` values. The twin replays the gap in order.

## 6. Thresholds the twin uses today

| Reading | Warning | Alarm |
| --- | --- | --- |
| Battery left (from `power`) | under 24 h, or brownout | dark, or under 8 h |
| CO2 | over 2,000 ppm | over 4,000 ppm |
| Air temperature | over 39 °C | over 43 °C |
| Flood depth | over 25 cm | over 45 cm (tunnel closes) |

Water is still open: lanes 1 and 3 pick the `tds_ppm` and `turbidity_ntu` cut-offs after calibrating the probe with a clean cup and a salty cup.
