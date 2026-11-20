#!/usr/bin/env python3
"""A stand-in for the Arduino watch, for testing the relay with no hardware.

It opens a pseudo serial port, prints its path, and speaks the same lines as firmware/watch/watch.ino.

    python3 fake_watch.py                      # then type: ok   or   help   and press Enter
    python3 fake_watch.py --press 3:ok --press 8:help --for 20

Start the relay on the path it prints:   python3 relay.py --port /dev/ttys012 --api http://localhost:8787
"""
import argparse
import os
import pty
import select
import sys
import time

p = argparse.ArgumentParser()
p.add_argument("--press", action="append", default=[], help="SECONDS:BUTTON, for example 3:ok (repeatable)")
p.add_argument("--for", dest="seconds", type=float, default=0, help="stop after this many seconds (0 = run until Ctrl-C)")
p.add_argument("--path-file", default="", help="also write the port's path to this file")
a = p.parse_args()

master, slave = pty.openpty()
path = os.ttyname(slave)
print("fake watch on %s" % path, flush=True)
if a.path_file:
    with open(a.path_file, "w") as f:
        f.write(path)

plan = sorted((float(x.split(":")[0]), x.split(":")[1]) for x in a.press)
start = time.time()
count = 0
os.write(master, b"HELLO watch\n")


def press(name):
    global count
    count += 1
    os.write(master, ("BTN %s %d\n" % (name, count)).encode())
    print("%6.1fs  pressed %s" % (time.time() - start, name), flush=True)


buf = b""
try:
    while not a.seconds or time.time() - start < a.seconds:
        while plan and time.time() - start >= plan[0][0]:
            press(plan.pop(0)[1])
        ready, _, _ = select.select([master] + ([] if plan or a.seconds else [sys.stdin]), [], [], 0.1)
        if master in ready:
            buf += os.read(master, 256)
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                text = line.decode("ascii", "ignore").strip()
                if text and not text.startswith("NET "):
                    print("%6.1fs  relay says: %s" % (time.time() - start, text), flush=True)
        if sys.stdin in ready:
            word = sys.stdin.readline().strip()
            if word:
                press(word)
except KeyboardInterrupt:
    pass
