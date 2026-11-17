# Hollow Twin

Patriot HackFest Fall 2026, Life Underground track.

A live 3D model of one sector of the Hollow, fed by residents' own devices: watches, relay boxes, sensor nodes and scout robots. It warns people before blackouts and air cuts, shares power fairly, tracks the real outbreak against the Directorate's numbers, and keeps working when the network is cut.

Live twin: **https://hollow-twin.vercel.app**

**Deadline: Fri Nov 20, 11:00 PM ET. No extensions. We aim to submit by 6 PM ET.**

## Who owns what

Four lanes, one folder each. Only edit your own folder. The one shared file is [`CONTRACT.md`](CONTRACT.md), and only the lane 1 owner edits it.

| Lane | Folder | Builds | Owner |
| --- | --- | --- | --- |
| 1. Backend | [`api/`](api/), `CONTRACT.md` | Ingest, live feed, history, the forecast, fair-share and outbreak logic | pick at the next call |
| 2. Watch and relay | [`firmware/watch/`](firmware/watch/), [`firmware/relay/`](firmware/relay/) | Bluetooth watch to relay, radio relay to relay, store-and-forward, family check-ins | pick at the next call |
| 3. Sensors and robot | [`firmware/sensor/`](firmware/sensor/), [`robot/`](robot/) | Water, CO2 and flood node; rover that checks tunnels | pick at the next call |
| 4. Twin and broadcast | [`twin/`](twin/), [`broadcast/`](broadcast/) | 3D twin on live data, help queue, public broadcast page, demo video | anudeep-bonagiri |

Each folder has a README with its task list.

## Start without waiting on anyone

You need Node 18 or newer. No installs.

```sh
# A stand-in API on http://localhost:8788 (POST /ingest, GET /live)
node tools/catcher.mjs

# In another terminal: send every sample message every 2 seconds
node tools/replay.mjs
```

- **Firmware lanes:** point your device at `http://<laptop ip>:8788/ingest`. The catcher prints each message and rejects bad ones with the reason.
- **Twin lane:** subscribe to `http://localhost:8788/live` and run `replay.mjs` for fake traffic.
- **Backend lane:** `replay.mjs` takes any URL, so aim it at your API to test it.

## Dates

| When (ET) | What |
| --- | --- |
| Mon Nov 16, morning | 30-minute call: lock `CONTRACT.md`, pick lanes, list parts to order |
| Wed Nov 18, 8 PM | Integration 1: one real device, through the API, lights up one block in the twin |
| Thu Nov 19, noon | Integration 2: full demo run-through |
| Thu Nov 19, 6 PM | Feature freeze |
| Fri Nov 20 | Record and edit the video, submit by 6 PM |

## Rules that matter

- Only the four of us contribute. AI tools are allowed.
- No coding after 11 PM ET on Nov 20.
- Pull requests touch only your own folder. Contract changes go through lane 1.
- `inspo/` reference images stay out of the repo; they are other people's work.
