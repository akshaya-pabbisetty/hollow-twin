# Lane 3: Scout robot

A small robot car kit with an ESP32-CAM, plus the sensor node's gas and distance sensors. Device ID `rover-01`; outdoors it reports as `surface-01`.

- [ ] Drive a stretch of "tunnel" and send a `tunnel` message: open or closed, the reason, a photo URL.
- [ ] Outdoors, send `surface` readings and a photo for the broadcast page.
- [ ] Stretch: drive to a help request when `/help` assigns it.

Fallback: a phone taped to an RC car for the video, readings sent from `tools/replay.mjs`.
