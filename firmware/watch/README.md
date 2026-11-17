# Lane 2: Watch

> **On hold (plan of Nov 17).** This is not on the path to the submission. The one hardware add-on still open is two ESP32 relays passing an "I'm OK" with Wi-Fi off; see [`docs/PLAN.md`](../../docs/PLAN.md).

An ESP32 board with a small screen and battery, a MAX30102 pulse and oxygen sensor, a temperature sensor, three buttons (help, symptom, I'm OK) and a buzzer, on a wrist strap.

- [ ] Read heart rate, blood oxygen and skin temperature every few minutes; send a `vitals` message.
- [ ] Send `button` messages for help and symptom, and a `checkin` for I'm OK.
- [ ] Send everything to the nearest relay box over Bluetooth Low Energy.
- [ ] Buzz and show the text of any warning the relay passes down.

Fallback if parts are late: a phone web page with the same three buttons that posts to `/ingest`.
