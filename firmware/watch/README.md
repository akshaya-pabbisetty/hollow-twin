# Lane 2: Watch

Two watches are built:

| Watch | What it is | Guide |
| --- | --- | --- |
| [`watch.ino`](watch.ino) | An Arduino with I'm OK, help and I feel sick buttons and a buzzer, wired by USB to a Raspberry Pi relay ([`../relay/relay.py`](../relay/relay.py)) that signs its messages and holds them through a real network cut | [`docs/HARDWARE.md`](../../docs/HARDWARE.md) |
| [`web/index.html`](web/index.html) | The family watch on a phone: I'M OK, help, I feel sick, family status, its block's power, its help call, walkie-talkie presets and Morse. Its relays are simulated | below |

| [`cad/watch.py`](cad/watch.py) | The wearable in CAD (CadQuery): case, buttons, strap and everything inside. Shown in 3D at **https://hollow-twin.vercel.app/watch/device/**, with the phone watch running on its screen. | [The family watch in 3D](#the-family-watch-in-3d-twinwatchdevice) |

The ESP32 wrist watch described next is the original design. It is not built, but it is now drawn in CAD: see [the family watch in 3D](#the-family-watch-in-3d-twinwatchdevice).

An ESP32 board with a small screen and battery, a MAX30102 pulse and oxygen sensor, a temperature sensor, three buttons (help, symptom, I'm OK) and a buzzer, on a wrist strap.

- [ ] Read heart rate, blood oxygen and skin temperature every few minutes; send a `vitals` message.
- [ ] Send `button` messages for help and symptom, and a `checkin` for I'm OK.
- [ ] Send everything to the nearest relay box over Bluetooth Low Energy.
- [ ] Buzz and show the text of any warning the relay passes down.

Fallback if parts are late: a phone web page with the same three buttons that posts to `/ingest`.

## The family watch: [`web/index.html`](web/index.html)

The fallback, built. One file, no install: the watch's software on a phone, plus the family app it pairs with.

**On the watch** (three screens, tabs at the bottom):

- **Home:** a big **I'M OK** button, a **NEED HELP** button (two taps, so a bump doesn't call for help) and **I feel sick** (a `button` `symptom` message: it goes to the API, not the family, and counts toward the residents' sickness number in `GET /truth`). Under the clock: the hours of power the API forecasts for the wearer's block, coloured at the 24 h and 8 h lines.
- **Family:** who in the family is safe, who needs help, and who hasn't been heard from.
- **Talk:** walkie-talkie presets ("On my way", "Stay where you are", "Meet at the lift", "Need water") and a **Morse key**: tap for a dot, hold for a dash, a pause ends the letter. Morse that arrives is played back as beeps and vibration, with the dots and dashes on screen.

**In the family app** (next to the watch): **Your block** (the API's battery forecast for it, with the reason and whether the readings are scripted or from a device), **Your help call** (in the rescue queue and its place, then "Rover-01 is on the way", then "Rover-01 reached you: med kit", from `GET /help`), everyone's status with where and when they were last heard from, and the whole radio message history. When the rover is sent and when it arrives, the watch face says so too. Without an API none of this is shown, rather than guessed.

**When the Directorate cuts the network** (the **Cut network** button), every message still gets through, by radio: the screen shows it hop from the watch to its block's relay, to the next block's relay (which still has a line out), and up to the API. It arrives with `hops: 2` and `via` naming both relays (CONTRACT.md section 5); on L7 Chalk Cut that is the scenario's own route. **The relays are simulated** (a phone has no radio for this), and the screen says so. A real outage (no signal, API down) holds messages on the phone with their original `time` and posts them as one array when the API is back.

### How it uses the API

Every message is a contract `checkin` to `POST /ingest`, with `source: "live"` because a real person pressed it. The API already passes a check-in's `status` to everyone in the family group, so the status carries the message:

| `status` | Means |
| --- | --- |
| `ok` | I'm safe |
| `help` | I need help. A `button` `help` message goes out too, so the call also reaches the rescue queue (`GET /help`). |
| `msg:<text>` | A walkie-talkie preset |
| `morse:<text>` | A message keyed in Morse |

**For lane 1:** CONTRACT.md lists only `ok` for `status`. The API accepts the others today; if you agree, add these values to the contract (or say if you'd rather have a `message` kind).

Family news comes back from `GET /inbox` (each alert's `status`, `sent`, `hops` and `via`) and `GET /family` (who last said OK). The first time, the watch registers itself and its family with `POST /family`.

### Connected to the twin

The twin shows every watch message in its **Family check-ins** panel and its log: "watch-0071 in Chalk Cut needs help … It crossed 2 relays (Chalk Cut to Ash Wells)". A help call also shows in the help queue. A copy of this page is deployed with the twin at `/watch` (see [`twin/README.md`](../../twin/README.md)), and on that site a new watch uses the API the twin is connected to. Once the API is hosted, set `TWIN_API` near the top of the file to its `https://` address.

### Try it on your own (no API, no install)

Open the page with no API address and it runs in **local mode**: the messages stay in your browser, and Mom and Dad answer on their own (Mom says she's safe, or "On my way" when you call for help; Dad answers in Morse). Turn that off in Settings to play both sides yourself: open the page in a second tab with `#mom` on the end.

### Try it: two family members talking

```sh
cd api && npm start                       # the API on :8787
cd firmware/watch/web && python3 -m http.server 8000
```

- **Maya** on L7 (the default): http://localhost:8000/?api=http://localhost:8787
- **Mom** on L1, in another browser or a private window: http://localhost:8000/?api=http://localhost:8787&device=watch-0011&name=Mom&block=l1-winch-gallery&to=watch-0071=Maya,watch-0012=Dad

Dad never checks in, so he shows "No word". For two phones on the same Wi-Fi, use the laptop's address instead of `localhost` in both places. Every setting can go in the link: `api`, `device`, `name`, `block`, `family`, `to`.

On camera, say "watch and family app, prototyped on a phone, with simulated relays". Real ESP32 relays would carry the same messages; nothing else changes.

## The family watch in 3D: [`twin/watch/device/`](../../twin/watch/device/)

**https://hollow-twin.vercel.app/watch/device/** The wearable the prototypes become, built the same way as the scout rover: one CAD script, [`cad/watch.py`](cad/watch.py), writes `watch.step` (any CAD program), `watch.json` (parts, bill of materials) and a mesh per part into `twin/watch/device/cad/`. Run it again after a change: `pip install cadquery`, then `python3 firmware/watch/cad/watch.py`.

**What's in it:** a 45 mm nylon case with a sapphire glass and an aluminium bezel; a 1.28 in round touch screen; an ESP32-S3 (Wi-Fi and Bluetooth to the relay box); a **LoRa radio** (SX1262) with a flexible antenna along the case wall, for when the network is cut; a heart-rate and blood-oxygen sensor (MAX30102) behind a window in the back, a skin temperature sensor (MAX30208) and a motion sensor (BMI270) for falls; a vibration motor and a buzzer; a 260 mAh battery that charges from two pads on a relay box's dock. Three buttons: green **I'M OK** (2 o'clock), red **HELP** (4 o'clock, hold) and a blue **Morse key** (9 o'clock). 28 parts, about 48 g with the strap and $64 in parts. Each line of the parts list says what it does and which HackFest problem it serves.

**Wear it** (the first tab): the screen is the real watch. It is this folder's `web/index.html` in embed mode (`?embed=1`), so it talks to the API exactly as the phone watch does. The page around it plays the hardware:

- **The buttons** on the 3D watch (or the buttons in the panel, or O, hold H, Space) press the watch's I'M OK, HELP and Morse key. HELP needs a 1.5 second hold.
- **Cut the network** and messages go out by LoRa radio: the antenna lights up and radio rings spread from the watch.
- **The wearer**: heart rate, blood oxygen and temperature (presets: resting, working, lung sickness) go to the API as `vitals` every 30 seconds, tagged `source: simulated`. The API uses them to rank a help call: with "lung sickness" a help call scores 115 ("SpO2 89 % is below 92 %").
- **Fall**: the watch asks "Are you OK?" and calls for help by itself after 15 seconds with no answer.
- **Inside, right now** lights each part while it works (radio sending, motor buzzing, buzzer beeping), and the motor shakes the watch when an alert arrives.

**On your own wrist:** https://hollow-twin.vercel.app/ar/ puts this watch on your wrist through the phone's camera, with the same live screen. See [`twin/README.md`](../../twin/README.md#ar-at-ar).

**Parts** (the second tab): pull it apart, see inside the case, hide the strap, and click any part for what it is and what it's for.

With no API address the page runs in local mode, and the family answers on its own. With one (the address the twin uses, or `?api=`), every press reaches the API and the twin; sending needs the API key, typed once in **Connect**.

The case is a design: the working watches are the phone watch and the Arduino. The page says so in its header.

**Embed mode, for anyone building on it:** `web/index.html?embed=1` inside a same-origin frame shows only the round face, and talks to its parent with `postMessage`. It sends `{hollowWatch: 1, type}` with `tx` (radio `wifi` or `lora`, and the message), `alert`, `vibrate`, `beep`, `tone` and a `state` report every second. It takes `{hollowHw: 1, type}` with `button` (`ok` or `help`), `morse-down`, `morse-up`, `morse-send`, `cut` (`on`), `fall` and `config` (`api`, `key`).

