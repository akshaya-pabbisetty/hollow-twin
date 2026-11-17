# Firmware guide (lane 2: watch and relay, lane 3: sensors and robot)

Everything a device needs to talk to the real API. The message format itself is [`CONTRACT.md`](../../CONTRACT.md)
at the top of the repository; this guide only adds what the API does with it.

If your device already works against `node tools/catcher.mjs`, it works against the API: same `POST /ingest`, same
message, same reply shape. Change the address and the port (8787 instead of 8788).

`API` below is wherever the API runs: `http://<laptop-ip>:8787` on the bench, or the deployed address.
Commands in this guide run from the `api` folder of the repository.

## 1. What to POST

`POST API/ingest` with header `Content-Type: application/json` and one contract message as the body:

```json
{
  "id": "sensor-l7-chalk-cut-002201",
  "device": "sensor-l7-chalk-cut",
  "block": "l7-chalk-cut",
  "time": "2026-11-18T20:00:00Z",
  "kind": "water",
  "values": { "tds_ppm": 840, "turbidity_ntu": 6.5 },
  "hops": 0,
  "via": [],
  "source": "live"
}
```

- **`"source": "live"` is the one field to add to what the contract samples show.** It is optional in the contract
  (section 1.1), but without it the API stores your message as `"simulated"` and the twin tags your block
  SIMULATED. Scripts and replays never send `live`; only real hardware should.
- `id` must be unique per message (`<device>-<counter>`). Sending the same `id` twice is safe: the copy is counted
  in `duplicates` and dropped. Keep the counter in flash (Preferences / NVS) so it does not restart at 1 after a
  reboot.
- `block` must be one of the 70 ids in `contract/blocks.json` (for example `l8-bore-bend`), or `surface` for the
  surface scout. Anything else is rejected, with a hint when only the letter case is wrong.
- `device` follows section 3 of the contract: `watch-0042`, `relay-<block id>`, `sensor-<block id>`, `rover-01`,
  `surface-01`. A device id that does not fit is still accepted, and the reply carries a warning.
- If the API was started with `INGEST_KEY`, also send the header `x-api-key: <the key>`.

Reply (HTTP 200):

```json
{ "accepted": 1, "duplicates": 0, "rejected": [], "warnings": [] }
```

| Status | Meaning | What the device should do |
|---|---|---|
| 200 | Stored, or a duplicate (see `duplicates`). Anything listed in `rejected` was not stored | Delete it from the local buffer. Print `rejected` and `warnings` on Serial |
| 422 | Nothing in the request could be stored. `rejected[0].problems` says why (`missing block`, `unknown kind "x"`, `unknown block "x"`, `time is not ISO 8601`, `bad signature`) | Print it on Serial and fix the firmware. Do not retry the same message |
| 400 | The body is not JSON | Fix the firmware |
| 401 | Missing or wrong `x-api-key` | Fix the key |
| 413 | Body over 5 MB | Split the backlog into smaller arrays |
| 429 | More than 20 single posts per second from this device | Wait 1 second (`Retry-After: 1`), or send one array instead |
| no reply | Network is down | Keep the message and retry later (section 2) |

`warnings` lists messages that were stored but have something to fix:

```json
{ "accepted": 1, "duplicates": 0, "rejected": [],
  "warnings": [{ "id": "watch-42-000001", "warnings": ["device id \"watch-42\" does not match CONTRACT.md section 3 (watch-<4 digits>, relay-<block id>, sensor-<block id>, rover-<2 digits>, surface-<2 digits>)"] }] }
```

A starter sketch that posts one contract message every 10 seconds is in
[`examples/post_reading.ino`](examples/post_reading.ino).

## 2. Network cut: store, forward, then upload the backlog as ONE array

This is section 5 of the contract. A relay that cannot reach the API keeps every message (its own and the ones it
carries for watches and sensors), passes them to the relays it can hear, and whichever relay reaches the API first
uploads everything in a single POST whose body is a JSON array:

```json
[
  { "id": "watch-0042-000387", "device": "watch-0042", "block": "l8-bore-bend", "time": "2026-11-18T20:00:00Z", "kind": "vitals", "values": { "hr_bpm": 104, "spo2_pct": 93, "temp_c": 38.1 }, "hops": 2, "via": ["relay-l8-bore-bend", "relay-l8-gantry-bend"], "source": "live" },
  { "id": "watch-0042-000389", "device": "watch-0042", "block": "l8-bore-bend", "time": "2026-11-18T20:00:30Z", "kind": "checkin", "values": { "status": "ok", "family": "fam-0007", "to": ["watch-0110"] }, "hops": 2, "via": ["relay-l8-bore-bend", "relay-l8-gantry-bend"], "source": "live" }
]
```

- Each relay that forwards a message adds 1 to `hops` and appends its own id to `via`. The API stores both and
  passes them on to the twin, which draws the route. `device`, `block`, `time` and `values` stay exactly as the
  measuring device wrote them.
- One array counts as **one request** for the rate limit and is **never dropped**, however long it is (up to 5 MB,
  roughly 20,000 messages). Posting a backlog one message at a time is what gets rate limited.
- Keep each message's original `time` (when it was measured). The API sorts the array itself, so order does not
  matter, and the twin replays the gap in order.
- If two relays carry the same message, both may upload it: the second copy is counted in `duplicates` and
  ignored, whatever its `hops` and `via` say. The `id` decides.
- An array can be partly accepted: `{"accepted": 48, "duplicates": 2, "rejected": [{"id": "...", "problems": ["..."]}]}`.
  Everything not listed in `rejected` is safely stored, so the relay can clear its buffer.

## 3. The clock rule (read this if your times say 1970)

- `time` is UTC, ISO 8601, for example `2026-11-18T20:00:00Z`. Call `configTime(0, 0, "pool.ntp.org")` after WiFi
  connects.
- **Before 2020-01-01** (an ESP32 that has not synced reports 1970): the message is still accepted. The API
  replaces `time` with the moment it received the message, and adds `"time_estimated": true`,
  `"device_time": "<what you sent>"` and a warning. So a device with no clock still works live, but a backlog
  from it loses its real timing (every message gets the upload time). Sync the clock before you rely on
  store-and-forward.
- **Ahead of the moment the API receives it** (even by a second): the same treatment (kept, stamped with the
  receive time, `device_time` keeps what you sent, warned when it is more than 1 second ahead). Nothing can be measured after it arrives, so a time
  ahead is a fast clock, a wrong time zone or a broken RTC. Send UTC and sync with NTP. This is also why the files
  in `contract/samples/` are accepted before their fixed time of 2026-11-18 20:00 UTC has arrived.
- **"Latest"** for a block and kind is the message with the greatest stored `time`; equal times go to the one
  stored last. So a relay backlog posted late, with its real older times, fills in history but never replaces a
  fresher reading, and a fast clock cannot hold "latest" either.

## 4. Kinds and values, per device

Exactly the contract's section 2, plus the optional additions of section 2.1.

| Device | kind | values | Optional additions |
|---|---|---|---|
| relay box | `power` | `battery_wh`, `draw_w`, `supply_w` | `grid_hz` (mains frequency), `battery_pct` |
| watch | `vitals` | `hr_bpm`, `spo2_pct`, `temp_c` | |
| watch | `button` | `button`: `help`, `symptom` or `ok` | `volunteer` (offers to join the first wave up) |
| watch | `checkin` | `status`: `ok`; `family`; `to`: list of watch ids | |
| sensor node | `water` | `tds_ppm`, `turbidity_ntu` | |
| sensor node | `air` | `co2_ppm`, `temp_c`, `humidity_pct` | |
| sensor node | `flood` | `depth_cm` | |
| scout robot | `tunnel` | `from_block`, `to_block`, `status`: `open` or `closed`, `reason`, `photo_url` | |
| surface scout | `surface` (block `surface`) | `co2_ppm`, `temp_c`, `radiation_usv_h`, `photo_url` | `o2_pct`, `pm25_ugm3` |

What the API does with each:

| You send | The API |
|---|---|
| `power` | Works out hours left: `battery_wh / (draw_w - supply_w)`. Warns the block under 24 h, raises an alarm under 8 h or when the battery is empty with supply below draw. With `grid_hz`, warns of a likely power cut when the frequency is more than 0.036 Hz from 60 Hz, before any battery is used |
| `vitals` | Keeps the latest per watch for the help queue's triage. Blood oxygen under 94 % counts the wearer in the outbreak total |
| `button: help` | Adds the wearer to the help queue (`GET /help`), ranked by their latest vitals |
| `button: symptom` | Counts the wearer once in the outbreak total (`GET /truth`) |
| `checkin` | Tells the watches in `to` and everyone in the `family` group "watch-0042 is OK", with the route it took |
| `water` | "Do not drink" for the block when `tds_ppm` is over 1,000 or `turbidity_ntu` is over 5 |
| `air` | "Air going stale" over 1,000 ppm CO2, "Air unsafe" over 5,000 ppm. Heat alerts from the heat index of `temp_c` and `humidity_pct` (39.4 °C and 51.7 °C) |
| `flood` | "Flooding: tunnel closed" over 15 cm |
| `tunnel` | `closed` tells residents of both `from_block` and `to_block`, with the `reason` and the photo |
| `surface` | Feeds the surface verdict and the broadcast page (`GET /broadcast`) |

Notes for lane 3:

- **Water cut-offs.** 1,000 ppm (WHO) and 5 NTU (US EPA) are lane 1's proposal in the contract's section 6.2. Once
  the probes are calibrated with the clean cup and the salty cup, check that the salty cup reads over 1,000 ppm
  and the clean cup well under; say so in the group chat either way.
- **Surface verdict.** It needs five readings: the contract's three plus `o2_pct` and `pm25_ugm3`. With only the
  contract's three, the broadcast page says `not enough data` and names what is missing. If the rover has no
  oxygen or dust sensor, send simulated values for those two from a script (tagged `"source": "simulated"`) and
  the page will show the verdict as `mixed`.
- **Every limit and its source** is in `shared/limits.json`, also served at `GET API/limits`. The ones in the
  contract's section 6.1 are agreed by the team, and the twin uses the same numbers.

Old field names from before the contract (`hr`, `spo2`, button `type`) are still accepted and renamed, with a
warning. Do not use them in new firmware.

## 5. How a watch gets its alerts (through its relay)

Watches have no WiFi, so the relay fetches for them:

```
GET API/inbox?device=watch-0042
```

returns every alert addressed to that watch, oldest first:

```json
[
  {
    "id": "alert-sensor-l8-bore-bend-000017-0", "device": "backend", "block": "l8-bore-bend", "time": "2026-11-18T20:00:12.101Z",
    "kind": "alert", "hops": 0, "via": [], "seq": 58, "source": "live",
    "values": {
      "level": "danger",
      "text": "Do not drink: tap water failing in l8-bore-bend",
      "cause": "sensor-l8-bore-bend-000017",
      "why": "TDS 1450 ppm is above 1000 ppm (WHO, Total dissolved solids in drinking-water (background document, 2003))"
    }
  }
]
```

- A watch receives: alerts for its own block (water, air, heat, flood, tunnel, power), plus alerts sent to it by
  name (family check-ins, "rover-01 sent to you"). The API knows a watch's block from the messages it posts.
- Poll every few seconds per connected watch. To fetch only what is new, remember the largest `seq` you have
  forwarded and ask `GET API/inbox?device=watch-0042&after_seq=58`.
- Show `values.text` on the watch screen and use `values.level` for the buzz pattern: `info`, `warn`, `danger`.
  `values.why` is the longer explanation with the limit and its source, if there is room to scroll.
- A family check-in alert also carries `values.hops` and `values.via`: how far the "I'm OK" travelled.

For the rover's stretch goal (drive to a help request): poll `GET API/help?status=assigned&to=rover-01`. Each item
has the `block` to drive to and the `device` that asked.

## 6. Signing messages (so nobody can fake your device)

Optional (contract section 1.1), but a signed message is stored with `"verified": true` and the twin can show it
as proven.

| You send | The API does |
|---|---|
| no `sig` | accepts it, stores `"verified": false` |
| a correct `sig` | accepts it, stores `"verified": true` |
| a wrong `sig` | **rejects it** (`bad signature for <device>`) |
| a `sig`, but the API has no key for your device | accepts it, stores `"verified": false` and `"sig_unchecked"` |

Each device has its own secret. The API owner puts it in `shared/keys.json` (copy `shared/keys.example.json`;
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
  double quotes. Lists (the `to` of a check-in) keep their order.
- **Numbers must be written the way JavaScript writes them**: `412` not `412.0`, `96.5` not `96.50`, `60` not `60.00`,
  no exponent, no leading `+`. The API parses your JSON and re-prints the numbers before checking, so `60.00`
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

Print the vector from the API's own code at any time:

```
node tools/sign.js
```

Sign any message saved in a file (to compare with what your board prints):

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

// Prints a number the way the API does: no trailing zeros, no trailing dot. 412.0 -> "412", 96.50 -> "96.5"
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
  if (!getLocalTime(&t)) return "1970-01-01T00:00:00Z";   // no clock yet: the API will estimate the time
  char buf[25];
  strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", &t);
  return String(buf);
}

// Builds one signed power message. The values JSON is built ONCE, keys in alphabetical order,
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
         ",\"hops\":0,\"via\":[],\"source\":\"live\",\"sig\":\"" + sig + "\"}";
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

This sketch has not been compiled on a board (no hardware when it was written). The HMAC call sequence is the
standard mbedtls one; the self-test line in `setup()` tells you on first boot whether it matches the API.

If the API answers `bad signature`: print `canonical` on Serial, save the same message to a file, run
`node tools/sign.js <key> reading.json`, and compare the two canonical strings character by character. It is almost
always a number format (`60.00` against `60`) or key order.

## 7. Try it without hardware

Start the API:

```
npm start
```

In a second terminal, endless fake devices for block `l8-bore-bend` that drift toward trouble:

```
node tools/replay.js
```

Or the team's fixed samples, from the top of the repository:

```
node tools/replay.mjs http://localhost:8787/ingest
```

Then look at what the API made of them: http://localhost:8787/blocks/l8-bore-bend/latest and
http://localhost:8787/status.
