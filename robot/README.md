# Scout rover

> **Design only. Nothing in this folder has been built or tested.** The rover exists as a CAD model and as a simulation in the browser.

**See it: https://hollow-twin.vercel.app/scout/** ([`twin/scout/`](../twin/scout/)). The Mission tab drives it down a tunnel; the Parts tab pulls it apart. In the twin, the **Scout rover** button in the header opens it, and every block card has **Send the scout rover** with one button per tunnel leading out of the block.

The rover goes where nobody can safely walk after a blackout. It has three jobs:

- **Check a tunnel** (this page): drive it, decide if it is open, and report in the same message format as every other device (`kind: "tunnel"`, device `rover-01`, [`CONTRACT.md`](../CONTRACT.md) section 2). The API tells the residents of both blocks, and the twin marks the tunnel closed.
- **Carry supplies** to a help request: a battery pack, a med kit or water filters (shown in the main twin: "Send the rover" on a block card).
- **Carry messages**: its relay box stores what it hears and passes it on when it is back in range, so it can drive a held check-in out of a dead zone.

## What it is

| | |
| --- | --- |
| Size | 64 x 54 x 75 cm with the mast up, 38 cm tall folded |
| Mass | 11.9 kg |
| Drive | Six wheels, 16 cm, each with its own 12 V gearmotor and encoder |
| Suspension | Rocker-bogie with a differential: no springs, all six wheels stay on the ground, the body tilts half as much as either side |
| Joints | 15: six drive motors, mast fold, head pan and tilt, water probe, lidar (11 driven); two rockers and two bogies (free) |
| Sensors | Head camera and lamps, 360 degree lidar, CO2 / temperature / humidity, water probe with depth strip |
| Radio | The same relay box every block has, so the rover is also a relay that can drive to where the signal is |
| Battery | 216 Wh (4S3P 21700) |
| Parts | About $1,240 for one, at typical hobby-market prices |

Mass comes from the CAD volume times the material density for made parts, and from typical catalogue figures for bought parts. Runtime and current draw on the page come from a simple DC motor model. All of it is an estimate for a design.

## The mission on the page

Any tunnel: `scout/?from=<block id>&to=<block id>` (ids from [`contract/blocks.json`](../contract/blocks.json)), with `&play=1` to start at once. The default is Flint Face to Damp Court on L6. The scout climbs a rubble pile, folds its mast to pass under a fallen vent duct, reads the air, finds standing water, and wades in with the probe down until the water reaches 16 cm. That is over the 15 cm the API closes a tunnel at, so it photographs the water and marks the tunnel closed. It is out of radio range, so the report waits on its memory card until the rover is back near the starting block's relay. Then it goes on with `hops: 1` and `via: ["relay-<from block>"]`.

Where the report goes:

- **To a twin open in the same browser**, always: the page hands it over directly (a `BroadcastChannel` named `hollow-twin`) and keeps the last ten in `localStorage` (`hollow.scout`) for a twin opened later. The twin logs it, marks the tunnel closed, routes people around it, and shows that tunnel's button in red on the block card. Tested on the live site.
- **To the API**, when one is connected (`?api=<address>`, or the address the twin remembers): `POST /ingest`. Tested against the local API: it stores the message with its original measurement time and raises "Tunnel closed between ... use another route" for both blocks, and the twin shows that alert. With the API on, the twin takes the report from the API only.

Every message is tagged `"source": "simulated"`.

## Files

| File | What |
| --- | --- |
| [`cad/scout.py`](cad/scout.py) | The one source: every part, joint, joint limit and bill-of-materials line. Edit this |
| [`../twin/scout/cad/`](../twin/scout/cad/) | What it writes: `scout.step` (any CAD program), `scout.urdf` (robot simulators), `scout.json` and `meshes/*.stl` (the web page) |
| [`../twin/scout/rover.js`](../twin/scout/rover.js) | Builds the rover in three.js from `scout.json`, solves the rocker-bogie on uneven ground, motor model. The main twin loads it too (`loadRover`, `setLamps`, `poseOnGround`, `roll_`, `.object`, `.lamp`): keep those names |
| [`../twin/scout/index.html`](../twin/scout/index.html) | The tunnel, the mission, the parts view |

Rebuild after changing the design (needs Python 3.12 and [uv](https://docs.astral.sh/uv/)):

```sh
cd robot/cad
uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python cadquery
.venv/bin/python scout.py
```

## If someone builds it

The cheapest real version is a 6WD rocker-bogie kit chassis with an ESP32-CAM, posting `tunnel` messages from the firmware in [`../api/docs/FIRMWARE.md`](../api/docs/FIRMWARE.md). Fallback for a video: a phone taped to an RC car, with readings sent from `tools/replay.mjs`.
