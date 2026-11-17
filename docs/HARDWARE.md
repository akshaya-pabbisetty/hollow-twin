# The watch and the relay box

One real watch and one real relay, built from an Arduino and a Raspberry Pi. Together they show three things on camera with real hardware: a warning reaching a device before the dark, an "I'm OK" held during a real network cut, and that same message delivered when the network returns.

| Part | What it is | Code |
| --- | --- | --- |
| Watch | Any Arduino with a USB port, one button (or a jumper wire) | [`firmware/watch/watch.ino`](../firmware/watch/watch.ino) |
| Relay box | A Raspberry Pi with Python 3. Nothing to install | [`firmware/relay/relay.py`](../firmware/relay/relay.py) |

The Arduino has no Wi-Fi and no clock. It sends button presses down the USB cable. The Pi adds the time, signs the message, and carries it to the API, or holds it in a file while the API cannot be reached.

## What has been tested

- The sketch compiles for the Uno, Nano, Mega and Leonardo (11% of an Uno's memory).
- The relay was run against the real API with a stand-in watch ([`firmware/relay/fake_watch.py`](../firmware/relay/fake_watch.py)) and a real network cut (the API was stopped and started again): one press delivered at once, two presses held, both uploaded in one request when the API came back, with their original times, as signed device messages that crossed one relay. Alerts came back down to the watch.
- **Not yet run on the physical boards.** The steps below are the first real test. Budget half an hour.

## 1. Flash the watch

Wire it first. Buttons go between the pin and GND; no resistors needed.

| Pin | Goes to | For |
| --- | --- | --- |
| 2 | button, then GND | "I'm OK" |
| 3 | button, then GND | "Help" (optional) |
| 8 | buzzer, then GND | warnings (optional) |

No button? Touch a jumper wire from pin 2 to GND.

Open `firmware/watch/watch.ino` in the Arduino IDE, pick your board and port, and upload. To check it alone: open the Serial Monitor at 9600 baud, press the button, and you should see `BTN ok 1`.

The on-board LED tells you the link: on = the relay reached the API, slow blink = the relay is holding messages, off = no relay listening, fast flicker = a warning just arrived.

## 2. Start the API on your laptop

Give the watch a secret so its messages count as verified. Any long random string works.

```sh
cd api
DEVICE_KEYS='{"watch-0042":"pick-a-long-secret"}' npm start      # http://localhost:8787
```

Find your laptop's address on the Wi-Fi (`ipconfig getifaddr en0` on a Mac). Below it is `LAPTOP`.

## 3. Start the relay on the Pi

Copy the `firmware/relay` folder to the Pi (`scp -r firmware/relay pi@raspberrypi.local:`), plug the Arduino into the Pi, then on the Pi:

```sh
cd relay
python3 relay.py --api http://LAPTOP:8787 --key pick-a-long-secret
```

It finds the Arduino by itself and prints what happens in plain words. Press the button: `watch-0042 pressed I'M OK  ->  sent to the API`. If it cannot open the port, add yourself to the serial group (`sudo usermod -aG dialout $USER`) and log in again.

The watch lives in the block Flint Face (L6 Undercroft) unless you pass `--block`. Block ids are in [`contract/blocks.json`](../contract/blocks.json).

## 4. Give the watch a family

There is one real watch, so the family member on the upper level is scripted, and tagged as scripted:

```sh
python3 upstairs.py --api http://LAPTOP:8787        # from the Pi or the laptop
```

The real watch gets "watch-0110 is OK", and its own check-ins are now delivered to watch-0110 in Winch Gallery (L1 Crown).

## 5. Open the twin

```sh
cd twin && python3 -m http.server 8080
# http://localhost:8080/?api=http://localhost:8787&intro=0
```

The header turns green: "API connected, N device readings". Flint Face gets a "Verified device" tag. Each press shows in the strip at the top left and travels up the lift as "I'm OK".

## What to film

1. **A warning before the dark.** Press the button once (so the API knows where the watch is), then on the laptop run `cd api && npm run scenario -- blackout`. The scenario is scripted, the delivery is real: the buzzer sounds and the LED flickers when "Flint Face has about 24 h of battery left" reaches the watch.
2. **The network cut.** Cut the network between the Pi and the laptop (below). The LED starts to blink slowly. Press "I'm OK". The relay prints `HELD (1 waiting)`. Nothing appears in the twin.
3. **Delivery.** Bring the network back. The relay prints `Uploaded 1 held message(s) in one request`, the LED goes solid, and the twin draws the check-in travelling to the family's level, "N s after it was sent".

### Cutting the network

- **Real, simplest:** turn the laptop's Wi-Fi off for twenty seconds, then on. The API and the twin are both on the laptop, so they keep running; only the Pi loses its way to them. If you are logged in to the Pi over SSH, start the relay inside `tmux` first so it survives your terminal freezing.
- **Real, on the Pi:** `sudo nmcli radio wifi off`, then `on` (`sudo ip link set wlan0 down`, then `up`, on older systems). Use a screen and keyboard on the Pi for this, not SSH.
- **Rehearsal, nothing really cut:** start the relay with `--cut-file /tmp/cut`. `touch /tmp/cut` makes it behave as if the network is down, `rm /tmp/cut` brings it back. Do not film this one as a network cut.

Let the Pi sync its clock before you cut anything. A Pi has no clock battery; started without a network, its time can be hours off, and held messages would carry wrong times. The relay warns you if its clock and the API's disagree.

## Run the relay whenever the Pi starts (optional)

```ini
# /etc/systemd/system/hollow-relay.service
[Unit]
Description=Hollow Twin relay
After=network-online.target

[Service]
User=pi
WorkingDirectory=/home/pi/relay
ExecStart=/usr/bin/python3 relay.py --api http://LAPTOP:8787 --key pick-a-long-secret
Restart=always

[Install]
WantedBy=multi-user.target
```

`sudo systemctl enable --now hollow-relay`, then `journalctl -fu hollow-relay` to watch it.

## Hosting the API on the Pi for the judging days (optional)

The public twin can only show "API connected" if the API has a public https address. A Pi that stays on can provide one.

```sh
# on the Pi: Node 20 or newer and a copy of the repo (the API needs api/ and contract/; the loop needs tools/)
cd api && npm start

# a public https address for it, no account needed (the address changes if this restarts)
cloudflared tunnel --url http://localhost:8787

# scripted traffic every 10 minutes, so there is always something arriving
node tools/demo-loop.mjs http://localhost:8787 10
```

Put the tunnel's address into `DEFAULT_API` in `twin/index.html` and redeploy. A named Cloudflare tunnel gives an address that does not change; use one if the Pi might restart during judging. Not tested yet.

## No Arduino to hand

`python3 fake_watch.py` opens a stand-in serial port and prints its path. Start the relay with `--port` set to that path, then type `ok` or `help` in the stand-in. It speaks the same lines as the real sketch.
