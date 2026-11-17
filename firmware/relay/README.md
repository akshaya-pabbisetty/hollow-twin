# Lane 2: Relay box

> **On hold (plan of Nov 17).** This is not on the path to the submission. The one hardware add-on still open is two ESP32 relays passing an "I'm OK" with Wi-Fi off; see [`docs/PLAN.md`](../../docs/PLAN.md).

An ESP32 with a LoRa radio module (or ESP-NOW on the ESP32's own radio for short range), an INA219 current sensor and a battery. One per block; the device ID is `relay-<block id>`.

- [ ] Collect watch and sensor messages over Bluetooth; post them to `/ingest` over Wi-Fi.
- [ ] Send a `power` message every minute (battery, draw, supply).
- [ ] With Wi-Fi gone: queue every message, forward to relays in range (`hops` + 1, add own id to `via`), drop ids already seen.
- [ ] When Wi-Fi returns: post the whole queue as one array with the original times.

Contract section 5 has the exact rules. Fallback: two ESP32s on a desk passing messages with Wi-Fi off is enough to film.
