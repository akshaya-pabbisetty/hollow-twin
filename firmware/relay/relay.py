#!/usr/bin/env python3
"""Hollow Twin relay box: carries a watch's messages to the API, and holds them while the network is down.

Runs on a Raspberry Pi (or any computer) with Python 3.7 or newer. Nothing to install.

    python3 relay.py --api http://192.168.1.20:8787

The watch is an Arduino on the USB cable running firmware/watch/watch.ino. When its button is pressed, this
relay writes a CONTRACT.md message (it adds the time, because the Arduino has no clock), signs it if it has
the watch's key, and posts it to the API. If the API cannot be reached it keeps every message in a file and
uploads the whole backlog in one request when the network is back, with the original times
(CONTRACT.md section 5). It also fetches the watch's alerts from the API and passes them down the cable.

Relay to relay (CONTRACT.md section 5, rules 2 and 3): start a relay with --listen and it accepts held messages
from its neighbours. Give a relay --peer and, while it cannot reach the API itself, it hands its held messages
to a neighbour that still can. The neighbour adds itself to `via`, adds 1 to `hops`, and uploads them. On the
bench the link between the two relays is the local network, standing in for the radio a real relay would use.

    # the neighbour, in the next block, still has a line out (no watch on it)
    python3 relay.py --api http://192.168.1.20:8787 --block l6-damp-court --no-watch --listen 8788
    # this block's relay, cut off: it passes the watch's messages to the neighbour
    python3 relay.py --api http://192.168.1.20:8787 --peer http://192.168.1.30:8788 --cut-file /tmp/cut
"""
import argparse
import glob
import hashlib
import hmac
import json
import os
import select
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

try:
    import termios
except ImportError:  # Windows: no serial port here, use --stdin
    termios = None


def now_iso():
    t = time.time()
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + ".%03dZ" % int((t % 1) * 1000)


def say(text):
    print(time.strftime("%H:%M:%S") + "  " + text, flush=True)


def canonical(m):
    """The exact string the API signs: id|device|block|time|kind|VALUES (api/sign.js)."""
    values = json.dumps(m["values"], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return "|".join([m["id"], m["device"], m["block"], m["time"], m["kind"], values])


def sign(m, key):
    return hmac.new(key.encode("utf-8"), canonical(m).encode("utf-8"), hashlib.sha256).hexdigest()


def find_port():
    for pattern in ("/dev/ttyACM*", "/dev/ttyUSB*", "/dev/cu.usbmodem*", "/dev/cu.usbserial*", "/dev/cu.wchusbserial*"):
        found = sorted(glob.glob(pattern))
        if found:
            return found[0]
    return None


def open_port(path):
    """A serial port at 9600 baud, 8 data bits, no parity, raw: what watch.ino speaks."""
    fd = os.open(path, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    if termios and os.isatty(fd):
        attrs = termios.tcgetattr(fd)
        attrs[0] = 0                                             # input: no translation
        attrs[1] = 0                                             # output: no translation
        attrs[2] = termios.CS8 | termios.CREAD | termios.CLOCAL  # 8N1, ignore modem lines
        attrs[3] = 0                                             # raw: no echo, no line editing
        attrs[4] = attrs[5] = termios.B9600
        termios.tcsetattr(fd, termios.TCSANOW, attrs)
    return fd


class Relay:
    def __init__(self, a):
        self.a = a
        self.api = a.api.rstrip("/")
        self.relay_id = a.relay or "relay-" + a.block
        self.run = "%x" % int(time.time())   # makes ids unique across restarts
        self.count = 0
        self.queue = []
        self.up = None                      # None = not tried yet
        self.after_seq = None
        self.fd = None
        self.buf = b""
        self.next_flush = self.next_inbox = self.next_status = self.next_open = self.quiet_until = 0.0
        self.lock = threading.Lock()        # guards self.incoming, which the listener thread fills
        self.incoming = []
        self.seen = set()                   # ids this relay has already carried (CONTRACT.md section 5, rule 3)
        if os.path.exists(a.queue):
            with open(a.queue) as f:
                self.queue = [json.loads(line) for line in f if line.strip()]
            if self.queue:
                say("%d message(s) were waiting from before the restart." % len(self.queue))

    # ---- the API ----
    def call(self, method, path, body=None):
        if self.a.cut_file and os.path.exists(self.a.cut_file):
            raise OSError("rehearsal: %s exists, pretending the network is down" % self.a.cut_file)
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(self.api + path, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.a.ingest_key:
            req.add_header("x-api-key", self.a.ingest_key)
        try:
            timeout = min(self.a.timeout, 1.5) if self.up is False else self.a.timeout
            with urllib.request.urlopen(req, timeout=timeout) as res:
                return res.status, json.loads(res.read().decode("utf-8") or "null")
        except urllib.error.HTTPError as e:   # the API answered, with an error status
            try:
                return e.code, json.loads(e.read().decode("utf-8") or "null")
            except ValueError:
                return e.code, None

    def set_up(self, up, why=""):
        if up == self.up:
            return
        self.up = up
        if up:
            say("NETWORK UP: the API at %s answers." % self.api)
        else:
            say("NETWORK DOWN: cannot reach the API (%s). Holding messages." % why)
        self.to_watch("NET %s %d" % ("up" if up else "down", len(self.queue)))

    def save_queue(self):
        tmp = self.a.queue + ".tmp"
        with open(tmp, "w") as f:
            for m in self.queue:
                f.write(json.dumps(m) + "\n")
        os.replace(tmp, self.a.queue)

    def flush(self):
        """Upload everything held as ONE array. True when the queue is empty afterwards."""
        if not self.queue:
            return True
        batch = list(self.queue)
        try:
            status, reply = self.call("POST", "/ingest", batch)
        except (OSError, urllib.error.URLError) as e:
            self.set_up(False, getattr(e, "reason", e))
            return self.forward()
        was_down = self.up is False
        self.set_up(True)
        if status in (200, 422):   # 422: nothing could be stored, and retrying the same messages will not help
            reply = reply or {}
            for r in reply.get("rejected", []):
                say("  the API REJECTED %s: %s" % (r.get("id"), "; ".join(r.get("problems", []))))
            for w in reply.get("warnings", []):
                say("  the API warns about %s: %s" % (w.get("id"), "; ".join(w.get("warnings", []))))
            sent = set(m["id"] for m in batch)
            self.seen |= sent
            self.queue = [m for m in self.queue if m["id"] not in sent]
            self.save_queue()
            if was_down or len(batch) > 1:
                say("Uploaded %d held message(s) in one request: accepted %s, duplicates %s." % (
                    len(batch), reply.get("accepted", 0), reply.get("duplicates", 0)))
            return True
        if status == 401:
            say("The API refused the key (401). Check --ingest-key. Holding messages.")
        elif status == 429:
            say("The API asked us to slow down (429). Trying again shortly.")
        else:
            say("The API answered %s. Holding messages." % status)
        return False

    # ---- neighbouring relays ----
    def peer_call(self, method, url, body=None):
        """Relay to relay. The --cut-file rehearsal does not apply: it cuts the Directorate's network, not this link."""
        data = None if body is None else json.dumps(body).encode("utf-8")
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header("Content-Type", "application/json")
        if self.a.ingest_key:
            req.add_header("x-api-key", self.a.ingest_key)
        with urllib.request.urlopen(req, timeout=2) as res:
            return json.loads(res.read().decode("utf-8") or "null")

    def forward(self):
        """Hand the held messages to a neighbour that still reaches the API. True when nothing is left here."""
        if not self.queue or not self.a.peer:
            return not self.queue
        for url in self.a.peer:
            url = url.rstrip("/")
            try:
                info = self.peer_call("GET", url + "/relay") or {}
                if not info.get("up"):
                    continue   # that relay cannot reach the API either
                batch = [m for m in self.queue if info.get("relay") not in (m.get("via") or [])]
                if not batch:
                    continue
                reply = self.peer_call("POST", url + "/relay", batch) or {}
            except (OSError, urllib.error.URLError, ValueError):
                continue
            if reply.get("accepted") is None:
                continue
            sent = set(m["id"] for m in batch)
            self.queue = [m for m in self.queue if m["id"] not in sent]
            self.save_queue()
            say("Passed %d held message(s) to %s in the next block, which still reaches the API." % (len(batch), info.get("relay")))
            if not self.queue:
                return True
        return not self.queue

    def listen(self, port):
        """Accept held messages from neighbouring relays: POST /relay [messages]. GET /relay says who we are."""
        relay = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, code, body):
                data = json.dumps(body).encode("utf-8")
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_GET(self):
                if self.path.rstrip("/") != "/relay":
                    return self.reply(404, {"error": "not found"})
                self.reply(200, {"relay": relay.relay_id, "block": relay.a.block, "up": relay.up is True, "held": len(relay.queue)})

            def do_POST(self):
                if self.path.rstrip("/") != "/relay":
                    return self.reply(404, {"error": "not found"})
                if relay.a.ingest_key and self.headers.get("x-api-key") != relay.a.ingest_key:
                    return self.reply(401, {"error": "wrong x-api-key"})
                try:
                    n = int(self.headers.get("Content-Length") or 0)
                    body = json.loads(self.rfile.read(min(n, 1 << 20)).decode("utf-8") or "null")
                except ValueError:
                    return self.reply(400, {"error": "not JSON"})
                msgs = [m for m in (body if isinstance(body, list) else [body])
                        if isinstance(m, dict) and isinstance(m.get("id"), str) and isinstance(m.get("device"), str)]
                with relay.lock:
                    relay.incoming.extend(msgs)
                self.reply(200, {"relay": relay.relay_id, "accepted": len(msgs)})

        srv = ThreadingHTTPServer(("0.0.0.0", port), Handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        say("Listening for neighbouring relays on port %d." % port)

    def take_incoming(self):
        with self.lock:
            got, self.incoming = self.incoming, []
        if not got:
            return
        held = set(m["id"] for m in self.queue)
        took = 0
        for m in got:
            if m["id"] in held or m["id"] in self.seen:
                continue   # already carried this one: drop it (rule 3)
            via = [v for v in (m.get("via") or []) if isinstance(v, str)]
            if self.relay_id not in via:
                via.append(self.relay_id)
                m["via"] = via
                m["hops"] = (m.get("hops") if isinstance(m.get("hops"), int) else len(via) - 1) + 1
            self.queue.append(m)
            held.add(m["id"])
            took += 1
        if not took:
            return
        self.save_queue()
        routes = sorted(set(" -> ".join(m["via"]) for m in self.queue[-took:]))
        say("Took %d message(s) from a neighbouring relay (%s)." % (took, "; ".join(routes)))
        if self.up is not False:
            self.flush()

    def probe(self):
        """A relay with no watch still needs to know whether it reaches the API, to tell its neighbours."""
        try:
            status, _ = self.call("GET", "/status")
            self.set_up(status == 200)
        except (OSError, urllib.error.URLError) as e:
            self.set_up(False, getattr(e, "reason", e))

    # ---- the watch ----
    def to_watch(self, line):
        if self.a.stdin:
            print("   to watch: " + line, flush=True)
        elif self.fd is not None and time.time() >= self.quiet_until:
            try:
                os.write(self.fd, (line + "\n").encode("ascii", "replace"))
            except OSError:
                pass

    def message(self, kind, values):
        self.count += 1
        m = {"id": "%s-%s-%d" % (self.a.watch, self.run, self.count), "device": self.a.watch, "block": self.a.block,
             "time": now_iso(), "kind": kind, "values": values,
             "hops": 1, "via": [self.relay_id],   # this relay carried it for the watch
             "source": "live"}
        if self.a.key:
            m["sig"] = sign(m, self.a.key)
        self.seen.add(m["id"])
        return m

    def pressed(self, name, n):
        if name == "ok":
            m = self.message("checkin", {"status": "ok", "family": self.a.family, "to": self.a.to})
            label = "I'M OK"
        elif name in ("help", "symptom"):
            m = self.message("button", {"button": name})
            label = name.upper()
        else:
            say("The watch sent a button this relay does not know: %s" % name)
            return
        self.queue.append(m)
        self.save_queue()
        # network known to be down: hold it at once, the loop keeps probing and uploads when it is back
        if self.up is not False and self.flush() and self.up:
            say("%s pressed %s  ->  sent to the API" % (self.a.watch, label))
            self.to_watch("ACK %s sent" % n)
        elif not self.queue or self.forward():
            say("%s pressed %s  ->  passed to the next block's relay" % (self.a.watch, label))
            self.to_watch("ACK %s relayed" % n)
        else:
            say("%s pressed %s  ->  HELD (%d waiting)" % (self.a.watch, label, len(self.queue)))
            self.to_watch("ACK %s held" % n)

    def watch_line(self, line):
        parts = line.split()
        if not parts:
            return
        if parts[0] == "HELLO":
            self.quiet_until = 0   # the sketch is running, so it is safe to talk to it
            say("The watch is connected.")
            self.to_watch("NET %s %d" % ("up" if self.up else "down", len(self.queue)))
        elif parts[0] == "BTN" and len(parts) >= 2:
            self.pressed(parts[1], parts[2] if len(parts) > 2 else "0")

    def read_watch(self, wait):
        if self.a.stdin:
            ready, _, _ = select.select([sys.stdin], [], [], wait)
            if ready:
                line = sys.stdin.readline()
                if line == "":
                    raise EOFError
                self.watch_line(line.strip())
            return
        if self.fd is None:
            time.sleep(wait)
            if time.time() >= self.next_open:
                self.next_open = time.time() + 2
                port = self.a.port or find_port()
                if port:
                    try:
                        self.fd = open_port(port)
                        self.quiet_until = time.time() + 2.5   # an Arduino resets when its port is opened
                        say("Listening to the watch on %s." % port)
                    except OSError as e:
                        say("Could not open %s: %s%s" % (port, e, "  (try: sudo usermod -aG dialout $USER, then log in again)" if e.errno == 13 else ""))
            return
        ready, _, _ = select.select([self.fd], [], [], wait)
        if not ready:
            return
        try:
            chunk = os.read(self.fd, 256)
        except BlockingIOError:
            return
        except OSError:
            chunk = b""
        if not chunk:
            say("The watch was unplugged. Waiting for it to come back.")
            try:
                os.close(self.fd)
            except OSError:
                pass
            self.fd = None
            return
        self.buf += chunk
        while b"\n" in self.buf:
            raw, self.buf = self.buf.split(b"\n", 1)
            self.watch_line(raw.decode("ascii", "ignore").strip())

    # ---- alerts coming back down ----
    def inbox(self):
        try:
            if self.after_seq is None:   # start from now: do not replay old alerts at the watch
                status, st = self.call("GET", "/status")
                self.after_seq = (st or {}).get("seq", 0) if status == 200 else 0
                self.set_up(True)
                self.check_clock((st or {}).get("time"))
                return
            status, alerts = self.call("GET", "/inbox?device=%s&after_seq=%d" % (self.a.watch, self.after_seq))
        except (OSError, urllib.error.URLError) as e:
            self.set_up(False, getattr(e, "reason", e))
            return
        self.set_up(True)
        if status != 200 or not isinstance(alerts, list):
            return
        for a in alerts:
            self.after_seq = max(self.after_seq, a.get("seq", 0))
            v = a.get("values", {})
            say("ALERT for %s (%s): %s" % (self.a.watch, v.get("level"), v.get("text")))
            self.to_watch("ALERT %s %s" % (v.get("level", "info"), str(v.get("text", ""))[:70]))

    def check_clock(self, api_time):
        """A Raspberry Pi has no clock battery: started without a network, its time can be hours off."""
        try:
            there = time.mktime(time.strptime(api_time[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
        except (TypeError, ValueError):
            return
        off = abs(time.time() - there)
        if off > 30:
            say("WARNING: this relay's clock is %d s away from the API's. Held messages would carry wrong times. "
                "Let it sync (timedatectl status) before cutting the network." % off)

    def register_family(self):
        if not self.a.family:
            return
        try:
            self.call("POST", "/family", {"group": self.a.family, "devices": [self.a.watch] + self.a.to})
        except (OSError, urllib.error.URLError):
            pass   # the API learns the family from the first check-in anyway

    def loop(self):
        who = "carrying for its neighbours, no watch" if self.a.no_watch else "for " + self.a.watch
        say("%s %s in block %s. API: %s%s" % (self.relay_id, who, self.a.block, self.api,
                                           "  (messages are signed)" if self.a.key and not self.a.no_watch else ""))
        if self.a.listen:
            self.listen(self.a.listen)
        if self.a.no_watch:
            self.probe()
        else:
            self.register_family()
        while True:
            if self.a.no_watch:
                time.sleep(0.2)
            else:
                self.read_watch(0.2)
            self.take_incoming()
            t = time.time()
            down = self.up is False
            if t >= self.next_flush:
                self.next_flush = t + (4 if down else 2)
                self.flush()
            if t >= self.next_inbox:
                self.next_inbox = t + (4 if down else 3)
                if self.a.no_watch:
                    self.probe()
                elif not down or not self.queue:   # with messages held, the upload attempt is the probe
                    self.inbox()
            if t >= self.next_status:
                self.next_status = t + 5
                self.to_watch("NET %s %d" % ("up" if self.up else "down", len(self.queue)))


def main():
    p = argparse.ArgumentParser(description="Hollow Twin relay box")
    p.add_argument("--api", default=os.environ.get("HOLLOW_API", "http://localhost:8787"), help="address of the API")
    p.add_argument("--port", help="serial port of the watch (found automatically if left out)")
    p.add_argument("--block", default="l6-flint-face", help="the block this relay serves, from contract/blocks.json")
    p.add_argument("--watch", default="watch-0012", help="device id of the watch on the cable (Dad, in the phone watch's family)")
    p.add_argument("--relay", help="device id of this relay (default: relay-<block>)")
    p.add_argument("--family", default="fam-0071", help="family group the watch checks in for (the phone watch's family)")
    p.add_argument("--to", action="append", default=None, help="watch id to deliver check-ins to (repeatable)")
    p.add_argument("--key", default=os.environ.get("HOLLOW_WATCH_KEY", ""), help="the watch's secret: messages are signed with it")
    p.add_argument("--ingest-key", default=os.environ.get("INGEST_KEY", ""), help="x-api-key, if the API needs one")
    p.add_argument("--queue", default="relay-queue.jsonl", help="file that holds messages while the network is down")
    p.add_argument("--cut-file", default="", help="rehearsal: while this file exists, behave as if the network is down")
    p.add_argument("--timeout", type=float, default=3.0, help="seconds to wait for the API")
    p.add_argument("--stdin", action="store_true", help="no watch: type its lines here instead (BTN ok 1)")
    p.add_argument("--no-watch", action="store_true", help="a relay with no watch on it, only carrying for its neighbours")
    p.add_argument("--listen", type=int, default=0, help="accept held messages from neighbouring relays on this port")
    p.add_argument("--peer", action="append", default=[], help="a neighbouring relay to pass held messages to, e.g. http://192.168.1.30:8788 (repeatable)")
    a = p.parse_args()
    a.to = a.to or ["watch-0071", "watch-0011"]   # Maya on the phone watch, Mom upstairs
    try:
        Relay(a).loop()
    except (KeyboardInterrupt, EOFError):
        print()


if __name__ == "__main__":
    main()
