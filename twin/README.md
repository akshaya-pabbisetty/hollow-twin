# The twin

`index.html` is the whole twin: a three.js cutaway of the sector, a built-in simulation, the guided story and the panels. No build step. It deploys to https://hollow-twin.vercel.app with `vercel deploy --prod` from this folder.

## Run it

```sh
python3 -m http.server 8080        # then open http://localhost:8080
```

| Address | What you get |
| --- | --- |
| `/` | The intro card, then the built-in simulation |
| `/?api=http://localhost:8787` | Connected to the API. The address is remembered; `?api=off` forgets it |
| `/?story=1` | Starts the 75-second story straight away (useful for recording) |
| `/?intro=0` | Skips the intro card |

`DEFAULT_API` near the top of the API section in `index.html` is the address the public site connects to with no `?api=`. It is empty until the API is hosted.

## What it does with the API

- Loads `/status`, `/blocks` and `/limits`, then follows `/live`.
- A block the API has data for shows the API's values and the API's battery forecast; every other block keeps the simulation. Each reading says which it is: twin simulation, scripted data through the API, or a device (verified or unverified).
- Power allocation comes from `GET /fairshare`, so the Directorate and fair-share comparison is the API's model.
- A check-in the API delivers is drawn travelling from the sender's block to the family's block and listed on the right.
- The thresholds are the API's (`GET /limits`); the simulation uses the same numbers when it runs alone.

## Still open

- [ ] Set `DEFAULT_API` once the API is hosted.
- [ ] Help requests: the count shows; a ranked list with an assign button does not.
- [ ] Phone layout: usable, not tuned.

## The family watch at `/watch`

`watch/index.html` is the lane 2 family watch, deployed with the twin so a phone can open https://hollow-twin.vercel.app/watch. It is a copy of [`firmware/watch/web/index.html`](../firmware/watch/web/index.html), which is the one to edit; copy it over before deploying:

```sh
cp firmware/watch/web/index.html twin/watch/index.html
```

The 3D watch is at `/watch/device/` ([`watch/device/`](watch/device/)): the CAD model, with the watch above running on its screen. Its `cad/` folder is written by `firmware/watch/cad/watch.py`.

A new watch uses the API this browser's twin is connected to (`hollow.api`), or `TWIN_API` in the watch file. Once the API is hosted, set `TWIN_API` there as well as `DEFAULT_API` here.

## AR at `/ar`

[`ar/`](ar/) is two things to do with a phone, at https://hollow-twin.vercel.app/ar/:

- **Try on the watch** (`/ar/#watch`): the camera and hand tracking (MediaPipe Hand Landmarker, running in the browser, so nothing from the camera leaves the phone) put the family watch on your wrist. It follows the wrist as it turns, the strap goes behind the arm, and the screen is the real watch (the phone watch in embed mode). The buttons under the picture press I'M OK and HELP, cut the network (radio rings spread from the wrist) and simulate a fall. Show the back of your wrist to the camera. **Flip camera** switches front and back, and **Size** sets the wrist size. **No camera? Watch a demo instead** shows the watch turning without a camera.
- **Robot in your room** (`/ar/#robot`): the scout rover at real size, and the watch, through `<model-viewer>`. **View in your room** opens Quick Look on an iPhone, and Scene Viewer or WebXR on Android. On Android the rover's wheels turn, the lidar spins and the head looks round. On a laptop the page shows a QR code to open it on a phone.

`ar/scout.glb` and `ar/watch.glb` are written by [`tools/ar_models.py`](../tools/ar_models.py) from the two CAD exports (`scout/cad/`, `watch/device/cad/`). Run it after either CAD script: `pip install numpy pygltflib pillow`, then `python3 tools/ar_models.py`. Both pass the Khronos glTF validator with no errors or warnings.

The camera needs HTTPS (the Vercel site) or `localhost`.

