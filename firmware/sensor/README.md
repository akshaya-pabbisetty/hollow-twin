# Lane 3: Sensor node

> **Not part of the submission's claim** ([`docs/PLAN.md`](../../docs/PLAN.md), Nov 17: we claim problems 1, 2, 7, 8 and the rover). Built Nov 18 as an add-on so the water, air and flood layers can run on a real device if someone has the parts. **Tested on a laptop against the real API; not yet run on a board.** See [What is tested](#what-is-tested).

One ESP32 per block watches the tap water, the air and the tunnel floor, and tells the API in the contract's own messages. It answers three of the brief's problems from the device side: bad water (4), flooded tunnels (5) and hot, stale air in the deep levels (3).

## What it does

Every 2 seconds it reads its sensors. Then:

- **It sends a message** for each kind (`water`, `air`, `flood`, [`CONTRACT.md`](../../CONTRACT.md) section 2) once a minute, or **at once** (at most every 3 s) when a value moves. A salty cup reaches the API seconds after it goes in, while a quiet tap line costs one message a minute.
- **Every message is signed** with the node's key (HMAC-SHA256, the rule in [`api/sign.js`](../../api/sign.js)). The API stores it as **verified, live**. A reading forged in the node's name is refused and shown on `/live` as `event: forgery`.
- **When the network is cut it keeps going.** Messages wait in memory (up to 300, over an hour of all sensors), then go up as one array with their original times when the API answers again (`CONTRACT.md` section 5). An upload whose reply was lost is safe to repeat: the API drops the copies.
- **It warns the block itself, network or not.** A red LED and a buzzer use the **API's own published limits** (`GET /limits`: WHO, US EPA, Health Canada, OSHA/NIOSH, US NWS), refreshed every 30 minutes and kept in flash. Danger (water unsafe to drink, dangerous air): red on, beep every 2 s. Warning (stale air, flooded tunnel): red blinking.
- **Its message ids never repeat**, even across reboots, so the API never drops a real reading as a duplicate.

It needs **no Arduino libraries**: the CO2 sensor is driven from its datasheet commands, so no library version can break the build.

## Parts

| Part | For | Notes |
| --- | --- | --- |
| ESP32 DevKit (any ESP32-WROOM board) | the node | Arduino core 2.x or 3.x |
| DFRobot Gravity TDS (SEN0244) or clone | `tds_ppm` | Rated 0 to 1000 ppm, +/- 10% of full scale. Power from 3.3 V (output 0 to 2.3 V) |
| DFRobot turbidity (SEN0189) or clone | `turbidity_ntu` | 5 V, output up to 4.5 V: **needs a divider** (below). Hobby-grade: treat the number as an indication |
| Sensirion SCD40 (or SCD41) breakout | `co2_ppm`, `temp_c`, `humidity_pct` | I2C. SCD40 is specified 400 to 2000 ppm; SCD41 to 5000 ppm. Both report beyond that, less exactly |
| HC-SR04, or waterproof JSN-SR04T | `depth_cm` | 5 V, echo **needs a divider**. JSN-SR04T cannot see closer than about 25 cm |
| Red LED + 220 Ohm resistor, active buzzer module | local alarm | An *active* buzzer beeps by itself when its pin is high |
| Resistors: 10k + 20k (turbidity), 1k + 2k (echo) | dividers | |

Any sensor you do not have: set its `HAS_...` to `0` in [`sensor_node/config.h`](sensor_node/config.h). The node sends the rest.

## Wiring (ESP32 DevKit)

| From | To | |
| --- | --- | --- |
| TDS board VCC, GND, signal | 3V3, GND, **GPIO 34** | |
| Turbidity VCC, GND | 5V (VIN), GND | |
| Turbidity signal | **10k** to **GPIO 35**, and **20k** from GPIO 35 to GND | 4.5 V becomes 3.0 V. Different resistors: change `TURBIDITY_DIVIDER` |
| SCD40 VDD, GND, SDA, SCL | 3V3, GND, **GPIO 21**, **GPIO 22** | |
| Ultrasonic VCC, GND, Trig | 5V (VIN), GND, **GPIO 5** | |
| Ultrasonic Echo | **1k** to **GPIO 18**, and **2k** from GPIO 18 to GND | 5 V becomes 3.3 V |
| Red LED (+ via 220 Ohm), buzzer + | **GPIO 25**, **GPIO 26** | other legs to GND |

The analog sensors are on ADC1 pins (32 to 39) on purpose: the ESP32's ADC2 stops working while Wi-Fi is on. The DevKit's blue LED (GPIO 2) shows the link: steady when the API has everything, blinking while it holds messages.

## Set it up

1. **Arduino IDE**: install the board package **esp32 by Espressif** (Boards Manager). Board: *ESP32 Dev Module*.
2. Open `sensor_node/sensor_node.ino`. Copy `secrets.example.h` to **`secrets.h`** in the same folder (git ignores it) and fill in Wi-Fi, `API_URL` (`http://<laptop-ip>:8787` on the bench, or the hosted address) and a long random `DEVICE_KEY`.
3. In `config.h`, set `BLOCK_ID` to the block the node is in (one of the 70 ids in [`contract/blocks.json`](../../contract/blocks.json)). The device id becomes `sensor-<block id>`.
4. Give the API the same key, so it can verify the node: start it with
   `DEVICE_KEYS={"sensor-l7-chalk-cut":"<the same secret>"}` (on Render: an environment variable), or put the pair in `api/shared/keys.json`.
5. Upload, open the Serial Monitor at **115200 baud, newline**, type `status`.

## Calibrate (5 minutes, saved in flash)

**The turbidity probe and the flood sensor send nothing until they are calibrated.** That is on purpose: most turbidity probes read clean water at 3.9 to 4.1 V, where the maker's curve says 360 to 1,000 NTU (the limit is 5), and a flood sensor with the wrong height reports a dry floor as flooded. An uncalibrated node would tell a block not to drink clean water. `status` says which sensors are still waiting. The TDS probe starts on the maker's own factor and is better after `cal tds`.

| Command | Do this first | What it sets |
| --- | --- | --- |
| `cal tds 707` | TDS probe in a **1413 uS/cm** conductivity standard (about 707 ppm). Any solution of known ppm works: give its value | The probe's factor, as the maker's own library does it |
| `cal clear` | Turbidity probe in clean, clear water | The probe's clear-water voltage; cloudier water reads above 0 NTU |
| `cal floor` | Ultrasonic in place, pointing at a **dry** floor | The sensor's height; depth = height minus distance |
| `watertemp 21` | Measure the water | TDS compensation (2% per degree; default 22 C) |

`cal reset` undoes all of it. `send` sends every reading now. `mute` silences the buzzer (the LED still shows danger).

## The demo shot (problem 4, "catch bad water before people drink it")

0. Calibrate first (above). Without `cal clear` the node sends TDS only, which is still enough for the salty cup.
1. Probe in a cup of tap water: `status` shows a few hundred ppm; the twin's block shows a **verified device** reading.
2. Move it to a **cup of salted water** (a pinch of salt in a glass is plenty; above about 1,000 ppm the probe still rises but is past its rated range). Within seconds the red LED and buzzer go, and the API raises **"Do not drink: tap water failing"**, citing the WHO limit.
3. **Unplug the router.** The red light keeps working: the limits are on the node. Put the probe back and forth; the blue LED blinks while messages wait.
4. **Plug it back in.** The held readings arrive in one request, in order, with their real times.

A step under 5,000 ppm is not treated as a sensor fault by the API (`jump_water_tds_ppm`), so the salty cup alarms on its first reading.

## What is tested

From `firmware/sensor/test`, on any machine with Node 20+ and g++ or clang++ (Linux, macOS, WSL):

```
node e2e.mjs
```
```
./check_sketch.sh
```

| Check | What it proves | Result (Nov 18) |
| --- | --- | --- |
| `core_test.cpp`: 116 unit checks | SHA-256 and HMAC (FIPS 180-4 and RFC 4231 vectors), **the API's published signature test vector**, number formatting, dates, sensor maths, SCD40 CRC (the datasheet's example), **an uncalibrated turbidity probe or flood sensor reports nothing rather than a false alarm**, when to send, ids across reboots, the backlog, limits | all pass, g++ and clang++ |
| `e2e.mjs`: 10 checks against the **real** `api/server.js` | 2,000 random readings written exactly as `JSON.stringify` writes them (or signatures would fail); the node reads the API's five limits; clean water stored **verified, live**; salty cup raises "Do not drink" on the first reading; stale air and a flooded tunnel raise their alerts; a 5-reading backlog uploaded in one request lands in time order with original times; the same backlog re-sent stores nothing twice; a reading changed after signing is refused, never stored and shown as `event: forgery`; an unsigned node is accepted as unverified | all pass |
| `check_sketch.sh` | The sketch compiles, warning-free, in 7 sensor combinations and two C++ standards, **against stand-in headers** for the ESP32 core | passes |

**Not tested:** the sketch has not been built with the real ESP32 core (no Arduino toolchain in the build environment) and has not run on a board or with real sensors. The first person with the parts should build it in the Arduino IDE, run the calibration, and do the demo shot once. Everything that decides anything lives in [`sensor_node/hollow_core.h`](sensor_node/hollow_core.h), which the tests above compile unchanged; the sketch only reads pins and talks over Wi-Fi.

## Honest limits

- **TDS** is rated to 1000 ppm, and the WHO limit is 1000 ppm, so "unsafe" sits at the top of the probe's range: the alarm is right, the exact number above it is not.
- **Turbidity** probes in this price range are indicators, not lab instruments. The clear-cup calibration makes clear water read 0; the EPA's 5 NTU line is near the probe's resolution.
- **Water temperature** is a setting, not a measurement (no water thermometer on the node).
- **While the board waits on the network** (at most about 8 s when the API is down but Wi-Fi is up), it does not sample; the buzzer is silenced first so it can never stick on. With Wi-Fi down it never waits.
- **The backlog is in RAM**: if the node loses power during a network cut, what it was holding is lost. Its ids are not reused.
- **HTTPS is not certificate-checked** on the node. The signature, not TLS, is what proves a reading is the node's; a man in the middle can delay or drop messages but not forge them.

## Files

| File | What |
| --- | --- |
| [`sensor_node/sensor_node.ino`](sensor_node/sensor_node.ino) | The sketch: pins, Wi-Fi, HTTP, lights, serial commands |
| [`sensor_node/hollow_core.h`](sensor_node/hollow_core.h) | Every decision, no hardware: signing, messages, sensor maths, when to send, ids, backlog, limits |
| [`sensor_node/config.h`](sensor_node/config.h) | Block, fitted sensors, pins, reporting choices |
| [`sensor_node/secrets.example.h`](sensor_node/secrets.example.h) | Copy to `secrets.h`: Wi-Fi, API address, device key |
| [`test/`](test/) | Unit tests, the end-to-end test against the API, the sketch syntax check and its stand-in headers |
