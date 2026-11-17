# Lane 2: Relay box

An ESP32 with a LoRa radio module (or ESP-NOW on the ESP32's own radio for short range), an INA219 current sensor and a battery. One per block; the device ID is `relay-<block id>`.

- [ ] Collect watch and sensor messages over Bluetooth; post them to `/ingest` over Wi-Fi.
- [ ] Send a `power` message every minute (battery, draw, supply).
- [ ] With Wi-Fi gone: queue every message, forward to relays in range (`hops` + 1, add own id to `via`), drop ids already seen.
- [ ] When Wi-Fi returns: post the whole queue as one array with the original times.

Contract section 5 has the exact rules. Fallback: two ESP32s on a desk passing messages with Wi-Fi off is enough to film.
