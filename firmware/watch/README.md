# Lane 2: Watch

An ESP32 board with a small screen and battery, a MAX30102 pulse and oxygen sensor, a temperature sensor, three buttons (help, symptom, I'm OK) and a buzzer, on a wrist strap.

- [ ] Read heart rate, blood oxygen and skin temperature every few minutes; send a `vitals` message.
- [ ] Send `button` messages for help and symptom, and a `checkin` for I'm OK.
- [ ] Send everything to the nearest relay box over Bluetooth Low Energy.
- [ ] Buzz and show the text of any warning the relay passes down.

Fallback if parts are late: a phone web page with the same three buttons that posts to `/ingest`.

## The phone watch: [`web/index.html`](web/index.html)

The fallback, built. One file, no install. It is the watch's software running on a phone: a round watch face with one **I'M OK** button.

- **I'M OK** sends a `checkin` (CONTRACT.md section 2) to `POST /ingest`, with `source: "live"` because a real person pressed it. The first time, it also registers the watch and its family with `POST /family`.
- **Cut network** plays the Directorate switching the network off. The check-in still gets through, by radio: the screen shows it hop from the watch to its block's relay, to the next block's relay (which still has a line out), and up to the API, and it arrives with `hops: 2` and `via` naming both relays (section 5). On L7 Chalk Cut that is `relay-l7-chalk-cut` then `relay-l7-ash-wells`, the same route as the scenario. **The relays are simulated** (a phone has no radio for this), and the screen says so.
- **A real outage** (no signal, API down) holds check-ins on the phone with their original `time` and posts them as one array when the API is reachable again.
- **Alerts** come back from `GET /inbox`, the way a relay would fetch them for a watch. Battery warnings and family check-ins cover the face and vibrate the phone.
- **Settings** set the API address, the watch, its block and family. Defaults match the network-cut beat in `api/tools/scenario.js`: `watch-0071` on L7 Chalk Cut, family `fam-0071`, reaching `watch-0011` on L1.

Try it locally:

```sh
cd api && npm start                       # the API on :8787
cd firmware/watch/web && python3 -m http.server 8000
# open http://localhost:8000/?api=http://localhost:8787
```

For a phone on the same Wi-Fi, use the laptop's address in both places (for example `http://192.168.1.20:8000/?api=http://192.168.1.20:8787`). Every setting can go in the link: `api`, `device`, `block`, `family`, `to`.

On camera, say "watch, prototyped on a phone, with simulated relays". Real ESP32 relays would carry the same message; nothing else changes.
