#!/usr/bin/env python3
"""Mom, upstairs: a scripted watch on another level, so the family always has someone at home.

The family is Maya (the phone watch, L7 Chalk Cut), Dad (the Arduino on the relay, L6 Flint Face) and Mom
(this script, L1 Winch Gallery). Mom is scripted and says so: her message is tagged "simulated".
Dad's watch then gets "watch-0011 is OK" as an alert, and the phone shows Mom as safe.

    python3 upstairs.py --api http://192.168.1.20:8787
"""
import argparse
import json
import os
import time
import urllib.request

p = argparse.ArgumentParser()
p.add_argument("--api", default=os.environ.get("HOLLOW_API", "http://localhost:8787"))
p.add_argument("--watch", default="watch-0011", help="the scripted watch upstairs (Mom)")
p.add_argument("--block", default="l1-winch-gallery", help="where it lives")
p.add_argument("--family", default="fam-0071")
p.add_argument("--to", default="watch-0012,watch-0071", help="who hears it: Dad on the Arduino, Maya on the phone")
p.add_argument("--ingest-key", default=os.environ.get("INGEST_KEY", ""))
a = p.parse_args()

t = time.time()
message = {
    "id": "%s-up-%x" % (a.watch, int(t * 1000)), "device": a.watch, "block": a.block,
    "time": time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(t)) + ".%03dZ" % int((t % 1) * 1000),
    "kind": "checkin", "values": {"status": "ok", "family": a.family, "to": [w.strip() for w in a.to.split(",") if w.strip()]},
    "hops": 0, "via": [], "source": "simulated",
}
req = urllib.request.Request(a.api.rstrip("/") + "/ingest", data=json.dumps(message).encode(), method="POST")
req.add_header("Content-Type", "application/json")
if a.ingest_key:
    req.add_header("x-api-key", a.ingest_key)
with urllib.request.urlopen(req, timeout=5) as res:
    print("%s in %s checked in for %s (scripted): %s" % (a.watch, a.block, a.family, res.read().decode()))
