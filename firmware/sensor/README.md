# Lane 3: Sensor node

> **On hold (plan of Nov 17).** This is not on the path to the submission. The one hardware add-on still open is two ESP32 relays passing an "I'm OK" with Wi-Fi off; see [`docs/PLAN.md`](../../docs/PLAN.md).

An ESP32 with a TDS probe and a turbidity probe (water), a CO2 sensor such as the SCD40 (air), and an ultrasonic distance sensor (flood depth). Device ID `sensor-<block id>`.

- [ ] Send `water`, `air` and `flood` messages every minute through the relay (or straight to `/ingest` for testing).
- [ ] Calibrate the water probes with a clean cup and a salty cup, then agree the cut-offs with lane 1 (contract section 6).
- [ ] Flag a reading that jumps or drifts in a way that suggests a bad sensor.

Fallback: the two cups on camera are enough to show do-not-drink working.
