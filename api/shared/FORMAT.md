# Hollow Twin reading format (the contract every lane builds against)

Every device, relay, script and the twin use exactly this shape. Change it only with the whole team.

```json
{
  "id": "relay-07-000123",
  "device": "relay-07",
  "block": "L8-deepwell-03",
  "time": "2026-11-17T14:02:11Z",
  "kind": "power",
  "values": { "battery_pct": 62, "draw_w": 41.5, "grid_hz": 59.97 }
}
```

| Field | Rule |
|---|---|
| `id` | Unique per message: `<device>-<counter>`. Relays use it to drop duplicate copies during store-and-forward. |
| `device` | `watch-NN`, `relay-NN`, `sensor-NN`, `rover-NN`, `scout-NN` |
| `block` | Block id from the twin, e.g. `L8-deepwell-03` |
| `time` | When the reading was TAKEN (UTC ISO 8601), not when it was uploaded. Backlogs keep their original times. More than 5 minutes in the future = rejected. Before 2020 (no clock sync) = accepted, but the backend stores its own receive time and adds `"time_estimated": true` and `"device_time"` (what you sent). |
| `kind` | One of the kinds below |
| `values` | Numbers or strings, per kind |
| `source` | OPTIONAL. `"live"` (real hardware) or `"simulated"` (scripts, replays). Missing = `"simulated"`, so only a real device can claim to be live. |

## Kinds and their values

| kind | values | sent by |
|---|---|---|
| `power` | `battery_pct`, `draw_w`, `grid_hz` (mains frequency, the early warning) | relay |
| `vitals` | `hr`, `spo2`, `temp_c` | watch |
| `button` | `type`: `help` / `symptom` / `ok` / `volunteer` (added: offers to join the first wave to the surface), optional `to` (family group) | watch |
| `water` | `tds_ppm`, `turbidity_ntu` | sensor |
| `air` | `co2_ppm` | sensor |
| `flood` | `depth_cm` | sensor |
| `tunnel` | `status`: `open` / `closed`, `photo_url` | rover |
| `surface` | `co2_ppm`, `temp_c`, `radiation_usv_h` (simulated). Optional additions: `o2_pct` (oxygen, % by volume), `pm25_ugm3` (fine dust, µg/m3). Every value is optional: send the ones you measure. | scout |
| `alert` | `level`: `warn` / `danger`, `text` | backend (sent back down to watches) |
| `sig` | OPTIONAL. Lowercase hex HMAC-SHA256, keyed with this device's secret, over `id|device|block|time|kind|VALUES` where VALUES is the `values` JSON with keys sorted alphabetically and no spaces. Valid = stored with `"verified": true`. Missing = stored with `"verified": false`. Wrong = rejected. Exact rule, test vector and ESP32 code: `docs/FIRMWARE.md`. |

## Fields the backend adds (never send these; they are ignored if you do)

| Field | Meaning |
|---|---|
| `seq` | Server sequence number, rising by one per stored record. It is also the event id on `/feed`. |
| `time_estimated`, `device_time` | Present only when the device clock was unset (see `time`). |
| `verified` | `true` only when the reading carried a valid `sig` for a device whose secret the backend holds. |
