# Relay box

The relay box is built: [`relay.py`](relay.py), run on a Raspberry Pi with the Arduino watch on its USB cable. Set up, wiring and what to film: [`docs/HARDWARE.md`](../../docs/HARDWARE.md).

What it does today (CONTRACT.md section 5):

- [x] Takes the watch's button presses over USB, adds the time, signs them with the watch's key and posts them to `/ingest`.
- [x] With the API out of reach: keeps every message in a file, then posts the whole queue as one array, with the original times, when the API is back.
- [x] Relay to relay: with `--peer`, a cut-off relay hands its held messages to a neighbouring relay that still reaches the API. The neighbour (`--listen`) adds 1 to `hops` and its own id to `via`, drops ids it has already carried, and uploads them. On the bench the link between relays is the local network, standing in for radio.
- [x] Fetches the watch's alerts from `/inbox` and passes them down the cable: the buzzer sounds.
- [ ] Bluetooth from the watch to the relay. The Arduino uses the USB cable instead.
- [ ] A radio link between relays (LoRa, or ESP-NOW on an ESP32). The local network stands in for it.
- [ ] A current sensor (INA219) for the block's own `power` messages. Power readings in the demo are scripted.

Try two relays on one computer, no hardware:

```sh
cd api && npm start                                                   # the API, on :8787
python3 firmware/relay/relay.py --block l6-damp-court --no-watch --listen 8788 --queue /tmp/b.jsonl
touch /tmp/cut
python3 firmware/relay/relay.py --stdin --peer http://localhost:8788 --cut-file /tmp/cut --queue /tmp/a.jsonl
# then type: BTN ok 1
```
