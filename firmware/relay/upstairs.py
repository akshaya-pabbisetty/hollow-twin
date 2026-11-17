#!/usr/bin/env python3
"""The family member upstairs: a scripted watch on another level, so the real watch has someone to reach.

There is one real watch. Its family needs a second member for a check-in to be delivered to, so this posts
a check-in from a watch on an upper level. It is scripted and says so: the message is tagged "simulated".
The real watch then gets "watch-0110 is OK" as an alert, and its own check-ins are delivered to watch-0110.

    python3 upstairs.py --api http://192.168.1.20:8787
"""
import argparse
import json
import os
import time
import urllib.request

p = argparse.ArgumentParser()
p.add_argument("--api", default=os.environ.get("HOLLOW_API", "http://localhost:8787"))
p.add_argument("--watch", default="watch-0110", help="the scripted watch upstairs")
p.add_argument("--block", default="l1-winch-gallery", help="where it lives")
p.add_argument("--family", default="fam-0042")
p.add_argument("--to", default="watch-0042", help="the real watch downstairs")
p.add_argument("--ingest-key", default=os.environ.get("INGEST_KEY", ""))
a = p.parse_args()

t = time.time()
message = {
    "id": "%s-up-%x" % (a.watch, int(t * 1000)), "device": a.watch, "block": a.block,
    "time": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + ".%03dZ" % int((t % 1) * 1000),
    "kind": "checkin", "values": {"status": "ok", "family": a.family, "to": [a.to]},
    "hops": 0, "via": [], "source": "simulated",
}
req = urllib.request.Request(a.api.rstrip("/") + "/ingest", data=json.dumps(message).encode(), method="POST")
req.add_header("Content-Type", "application/json")
if a.ingest_key:
    req.add_header("x-api-key", a.ingest_key)
with urllib.request.urlopen(req, timeout=5) as res:
    print("%s in %s checked in for %s (scripted): %s" % (a.watch, a.block, a.family, res.read().decode()))
