# Firmware guide (Lane 2: watch + relay, Lane 3: sensors + robot)

Run every command in this guide from the `api` folder of the repository.

Everything an ESP32 needs to talk to the backend. The message format itself is `CONTRACT.md` at the top of the repository.

`API` below is wherever the backend runs: `http://<laptop-ip>:8787` on the bench, or the deployed URL.

## 1. What to POST

`POST API/ingest` with header `Content-Type: application/json` and one reading as the body:

```json
{
  "id": "sensor-01-000042",
  "device": "sensor-01",
  "block": "L8-deepwell-03",
  "time": "2026-11-17T14:02:11Z",
  "kind": "water",
  "values": { "tds_ppm": 250, "turbidity_ntu": 1.2 },
  "source": "live"
}
```

- **`"source": "live"` is required from real hardware.** If you leave it out the backend stores the reading as
  `"simulated"` and the twin tags your block SIMULATED. Scripts and replays never send `live`.
- `id` must be unique per message (`<device>-<counter>`). Sending the same `id` twice is safe: the copy is dropped.
  Keep the counter in flash (Preferences / NVS) so it does not restart at 1 after a reboot.
- If the backend was started with `INGEST_KEY`, also send the header `x-api-key: <the key>`.

Reply (HTTP 200):

```json
{ "added": 1, "dupes": 0, "errors": [] }
```

| Status | Meaning | What the device should do |
|---|---|---|
| 200 | Stored (or a duplicate, see `dupes`) | Delete it from the local buffer |
| 400 | Rejected. `errors[0].err` says why (`missing block`, `unknown kind`, `bad signature`, `time ... in the future`) | Print it on Serial and fix the firmware. Do not retry the same message |
| 401 | Missing or wrong `x-api-key` | Fix the key |
| 413 | Body over 5 MB | Split the backlog into smaller arrays |
| 429 | More than 20 single posts per second from this device | Wait 1 second (`Retry-After: 1`), or send one array instead |
| no reply | Network is down | Keep the reading and retry later (section 2) |

## 2. Network cut: batch the backlog as ONE array

A relay that loses its uplink keeps every reading (its own and the ones it carries for watches) and, when the
link returns, uploads them in a single POST whose body is a JSON array:

```json
[
  { "id": "watch-01-000007", "device": "watch-01", "block": "L8-deepwell-03", "time": "2026-11-17T14:02:11Z", "kind": "vitals", "values": { "hr_bpm": 81, "spo2_pct": 97, "temp_c": 36.8 }, "source": "live" },
  { "id": "watch-01-000008", "device": "watch-01", "block": "L8-deepwell-03", "time": "2026-11-17T14:02:41Z", "kind": "vitals", "values": { "hr_bpm": 83, "spo2_pct": 96, "temp_c": 36.8 }, "source": "live" }
]
```

- One array counts as **one request** for the rate limit and is **never dropped**, however long it is (up to 5 MB,
  roughly 30,000 readings). Posting a backlog one reading at a time is what gets rate limited.
- Keep each reading's original `time` (when it was taken). The backend sorts the batch, so order does not matter.
- If two relays carry the same message, both may upload it: the second copy is counted in `dupes` and ignored.
- A batch can be partly accepted: `{"added": 48, "dupes": 2, "errors": [{"id": "...", "err": "..."}]}`. Everything
  not listed in `errors` is safely stored, so the relay can clear its buffer.

## 3. The clock rule (read this if your times say 1970)

- `time` is UTC, ISO 8601, e.g. `2026-11-17T14:02:11Z`. Call `configTime(0, 0, "pool.ntp.org")` after WiFi connects.
- **Before 2020-01-01** (an ESP32 that has not synced reports 1970): the reading is still accepted. The backend
  replaces `time` with the moment it received the reading, and adds `"time_estimated": true` and
  `"device_time": "<what you sent>"`. So a device with no clock still works live, but a backlog from it loses its
  real timing (every reading gets the upload time). Sync the clock before you rely on store-and-forward.
- **More than 5 minutes in the future**: rejected with `time ... is more than 5 minutes in the future`. That is a
  wrong time zone or a broken RTC. Send UTC.

## 4. Signing readings (so nobody can fake your device)

Optional, but a signed reading is stored with `"verified": true` and the twin can show it as proven.

| You send | Backend does |
|---|---|
| no `sig` | accepts it, stores `"verified": false` |
| a correct `sig` | accepts it, stores `"verified": true` |
| a wrong `sig` | **rejects it** (HTTP 400, `bad signature for <device>`) |
| a `sig`, but the backend has no key for your device | accepts it, stores `"verified": false` and `"sig_unchecked"` |

Each device has its own secret. The backend owner puts it in `shared/keys.json` (copy `shared/keys.example.json`;
the real file is gitignored) and you flash the same secret into the device.

### The exact rule

`sig` = lowercase hex of HMAC-SHA256, keyed with the device secret, over this string (the "canonical string"):

```
id|device|block|time|kind|VALUES
```

- The six parts are joined with the pipe character `|`, no spaces.
- `id`, `device`, `block`, `time`, `kind` are exactly the strings you put in the JSON. `time` is the string you send,
  even if it is 1970.
- `VALUES` is the `values` object as JSON: **keys sorted alphabetically (plain ASCII order), no spaces**, strings in
  double quotes.
- **Numbers must be written the way JavaScript writes them**: `412` not `412.0`, `96.5` not `96.50`, `60` not `60.00`,
  no exponent, no leading `+`. The backend parses your JSON and re-prints the numbers before checking, so `60.00`
  in your body becomes `60` on its side and the sig will not match unless you also signed `60`. Use the `num()`
  helper below for every number and this cannot go wrong.
- Keep strings in `values` to plain ASCII without `"` or `\`.
- `source`, `sig`, `hops` and `via` are not part of the signed string (relays change `hops` and `via` on the way).

### Test vector (your code must reproduce this exactly)

```
key:       hollow-test-key-0001
reading:   {"id":"relay-l8-bore-bend-000123","device":"relay-l8-bore-bend","block":"l8-bore-bend","time":"2026-11-01T14:02:11Z","kind":"power","values":{"battery_wh":412,"draw_w":96.5,"supply_w":40,"grid_hz":59.97}}
canonical: relay-l8-bore-bend-000123|relay-l8-bore-bend|l8-bore-bend|2026-11-01T14:02:11Z|power|{"battery_wh":412,"draw_w":96.5,"grid_hz":59.97,"supply_w":40}
sig:       7c9356baf24afb1dc3ab1d01b4abb9e1e7b3135569c75edbe010c44b33c40aea
```

Print the vector from the backend's own code at any time:

```
node tools/sign.js
```

Sign any reading saved in a file (to compare with what your board prints):

```
node tools/sign.js hollow-test-key-0001 reading.json
```

### ESP32 Arduino code (mbedtls ships with the ESP32 core, nothing to install)

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include "mbedtls/md.h"

const char* API        = "http://192.168.1.50:8787/ingest";
const char* DEVICE     = "relay-l8-bore-bend";
const char* BLOCK      = "l8-bore-bend";
const char* DEVICE_KEY = "hollow-test-key-0001";   // this device's secret, same as in shared/keys.json
unsigned long seq = 0;

// Prints a number the way the backend does: no trailing zeros, no trailing dot. 62.0 -> "62", 41.50 -> "41.5"
String num(double v, int decimals) {
  String s = String(v, decimals);
  if (s.indexOf('.') >= 0) {
    while (s.endsWith("0")) s.remove(s.length() - 1);
    if (s.endsWith(".")) s.remove(s.length() - 1);
  }
  if (s == "-0") s = "0";
  return s;
}

// Lowercase hex HMAC-SHA256 of msg, keyed with key.
String hmacSha256Hex(const char* key, const String& msg) {
  unsigned char mac[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 1);   // 1 = HMAC
  mbedtls_md_hmac_starts(&ctx, (const unsigned char*)key, strlen(key));
  mbedtls_md_hmac_update(&ctx, (const unsigned char*)msg.c_str(), msg.length());
  mbedtls_md_hmac_finish(&ctx, mac);
  mbedtls_md_free(&ctx);
  char hex[65];
  for (int i = 0; i < 32; i++) sprintf(hex + 2 * i, "%02x", mac[i]);
  hex[64] = 0;
  return String(hex);
}

String isoNow() {
  struct tm t;
  if (!getLocalTime(&t)) return "1970-01-01T00:00:00Z";   // no clock yet: the backend will estimate the time
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

// Builds one signed power reading. The values JSON is built ONCE, keys in alphabetical order,
// and that same string goes into both the canonical string and the body.
String signedPowerReading(double batteryWh, double drawW, double supplyW, double gridHz) {
  String id     = String(DEVICE) + "-" + String(++seq);
  String time   = isoNow();
  String values = String("{\"battery_wh\":") + num(batteryWh, 0) +
                  ",\"draw_w\":" + num(drawW, 1) +
                  ",\"grid_hz\":" + num(gridHz, 2) +
                  ",\"supply_w\":" + num(supplyW, 1) + "}";      // b < d < g < s: alphabetical
  String canonical = id + "|" + DEVICE + "|" + BLOCK + "|" + time + "|power|" + values;
  String sig = hmacSha256Hex(DEVICE_KEY, canonical);
  return String("{\"id\":\"") + id + "\",\"device\":\"" + DEVICE + "\",\"block\":\"" + BLOCK +
         "\",\"time\":\"" + time + "\",\"kind\":\"power\",\"values\":" + values +
         ",\"source\":\"live\",\"sig\":\"" + sig + "\"}";
}

void setup() {
  Serial.begin(115200);
  // Self-test against the published vector before trusting anything else:
  String canonical = "relay-l8-bore-bend-000123|relay-l8-bore-bend|l8-bore-bend|2026-11-01T14:02:11Z|power|"
                     "{\"battery_wh\":412,\"draw_w\":96.5,\"grid_hz\":59.97,\"supply_w\":40}";
  String sig = hmacSha256Hex("hollow-test-key-0001", canonical);
  Serial.println(sig == "7c9356baf24afb1dc3ab1d01b4abb9e1e7b3135569c75edbe010c44b33c40aea"
                 ? "sign self-test OK" : "sign self-test FAILED: " + sig);
  WiFi.begin("YOUR_WIFI", "YOUR_PASSWORD");
  while (WiFi.status() != WL_CONNECTED) delay(500);
  configTime(0, 0, "pool.ntp.org");
}

void loop() {
  HTTPClient http;
  http.begin(API);
  http.addHeader("Content-Type", "application/json");
  int code = http.POST(signedPowerReading(412, 96.5, 40, 59.97));
  Serial.printf("POST %d: %s\n", code, http.getString().c_str());
  http.end();
  delay(10000);
}
```

This sketch has not been compiled on a board yet (no hardware when it was written). The HMAC call sequence is the
standard mbedtls one; the self-test line in `setup()` tells you on first boot whether it matches the backend.

If the backend answers `bad signature`: print `canonical` on Serial, save the same reading to a file, run
`node tools/sign.js <key> reading.json`, and compare the two canonical strings character by character. It is almost
always a number format (`60.00` vs `60`) or key order.

## 5. How a watch gets its alerts (through its relay)

Watches have no WiFi, so the relay fetches for them:

```
GET API/inbox?device=watch-01
```

returns every alert addressed to that watch, oldest first:

```json
[
  {
    "id": "alert-sensor-03-17-0", "device": "backend", "block": "L3-farms-04", "time": "2026-11-17T14:02:12.101Z",
    "kind": "alert", "seq": 58, "source": "live",
    "values": {
      "level": "danger",
      "text": "Do not drink: tap water failing in L3-farms-04",
      "cause": "sensor-03-17",
      "why": "TDS 1450 ppm is above 1000 ppm (WHO, Total dissolved solids in drinking-water (background document, 2003))"
    }
  }
]
```

- A watch receives: alerts for its own block (water, air, flood, tunnel, power), plus alerts sent to it by name
  (family "I'm OK" messages, "responder sent to you"). The backend knows a watch's block from the readings it posts.
- Poll every few seconds per connected watch. To fetch only what is new, remember the largest `seq` you have
  forwarded and ask `GET API/inbox?device=watch-01&after_seq=58`.
- Show `values.text` on the watch screen and use `values.level` for the buzz pattern: `info`, `warn`, `danger`.
  `values.why` is the longer explanation with the limit and its source, if there is room to scroll.
- "I'm OK" to family: the watch sends `{"kind":"button","values":{"type":"ok","to":"<family group>"}}`. Groups are
  created once with `POST API/family {"group":"rao","devices":["watch-11","watch-71"]}`.
- Other button types: `help` (joins the ranked help queue), `symptom` (counted in the outbreak truth check),
  `volunteer` (offers to join the first wave to the surface).

## 6. Kinds and values, per device

| Device | kind | values |
|---|---|---|
| relay | `power` | `battery_pct`, `draw_w`, `grid_hz` |
| watch | `vitals` | `hr`, `spo2`, `temp_c` |
| watch | `button` | `type`: `help` / `symptom` / `ok` / `volunteer`, optional `to` |
| sensor | `water` | `tds_ppm`, `turbidity_ntu` |
| sensor | `air` | `co2_ppm` |
| sensor | `flood` | `depth_cm` |
| rover | `tunnel` | `status`: `open` / `closed`, `photo_url` |
| scout | `surface` | any of `co2_ppm`, `o2_pct`, `temp_c`, `pm25_ugm3`, `radiation_usv_h` (send what you measure) |

The limits each value is checked against, with their sources, are in `shared/limits.json` (also `GET API/limits`).

## 7. Try it without hardware

```
node server.js
```

In a second terminal:

```
node tools/replay.js
```
