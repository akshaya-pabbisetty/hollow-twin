"""Family watch: the one CAD source for the wearable.

Run:  python3 watch.py        (needs cadquery: pip install cadquery)

Writes, into ../../../twin/watch/device/cad/ (so the public page can serve them):
  watch.step        the whole watch, for any CAD program
  watch.json        the same model for the web page: parts, bill of materials, what each part is for
  meshes/*.stl      one mesh per unique part, in millimetres

Axes: X toward 3 o'clock, Y toward 12 o'clock, Z out of the screen. Millimetres.
z = 0 is the back of the case, the side that sits on the skin.

The working prototypes are the phone watch (../web/) and the Arduino watch (../watch.ino).
This is the wearable they become: the same buttons, sensors and radio, in a 45 mm case.
"""
import json
import math
import pathlib

import cadquery as cq

OUT = pathlib.Path(__file__).resolve().parents[3] / "twin" / "watch" / "device" / "cad"
MESH = OUT / "meshes"

# ---------------------------------------------------------------- dimensions
CASE_R, CASE_IN, CASE_H = 22.5, 19.5, 12.6       # case: 45 mm across, 3 mm wall, back at z = 0
BACK_T = 2.0                                     # back cover, inside the case wall
WIN_R = 6.0                                      # sensor window in the back cover
BAT = (26.0, 20.0, 4.5)                          # LiPo pouch, x by y by thickness
BAT_C, BAT_Z = (0.0, 1.5), 2.9
PCB_R, PCB_Z, PCB_T = 18.6, 7.6, 1.0
DISP_R, DISP_Z, DISP_T = 17.75, 10.8, 1.8        # 1.28 in round display module, 35.5 mm across
GLASS_R, GLASS_Z, GLASS_T = 18.4, 12.7, 1.1
BEZEL_OUT, BEZEL_IN, BEZEL_Z, BEZEL_T = 23.0, 18.5, 12.6, 1.8
BTN_Z = 7.5
BUTTONS = {"ok": 30.0, "help": -30.0, "morse": 180.0}   # angle from 3 o'clock, counter-clockwise
LUG_Y, BAR_Z = 25.5, 5.5                         # spring bar position
STRAP_W, STRAP_T = 22.0, 2.4
WRIST_C, WRIST_R = -26.0, 30.0                   # strap centre line wraps this circle (YZ plane)

# densities in g/mm3, with the share of a printed part that is solid
PA12, PA12_FILL = 0.00101, 0.9                   # glass-filled nylon, printed and dyed
AL = 0.00270
GLASS_D = 0.00398                                # sapphire
FKM = 0.00185                                    # fluoroelastomer strap
STEEL = 0.00800

GRAPHITE, BLACK, ALU, PCB, GOLD = "#34383C", "#17181A", "#7E848A", "#2F6B45", "#C9A13B"
GREEN, RED, BLUE, CELL, GLASS, SCREEN, COPPER = "#3F9A57", "#C8102E", "#2D6FB7", "#2C5F86", "#0E1A24", "#06080A", "#B8733A"
SILVER, CHIP, STRAP, AMBER = "#C7CACD", "#222428", "#2B2E31", "#E08A00"


# ---------------------------------------------------------------- helpers
def wp(solid):
    return cq.Workplane("XY").newObject([solid])


def cyl(r, h, p=(0, 0, 0), d=(0, 0, 1)):
    return wp(cq.Solid.makeCylinder(r, h, cq.Vector(*p), cq.Vector(*d)))


def box(lx, ly, lz, c=(0, 0, 0)):
    return cq.Workplane("XY").box(lx, ly, lz).translate(c)


def ring(r_out, r_in, h, z=0.0):
    return cyl(r_out, h, (0, 0, z)).cut(cyl(r_in, h + 2, (0, 0, z - 1)))


def polar(r, deg):
    return r * math.cos(math.radians(deg)), r * math.sin(math.radians(deg))


# ---------------------------------------------------------------- parts
def case():
    c = ring(CASE_R, CASE_IN, CASE_H)
    c = c.faces(">Z").edges().fillet(0.8)
    c = c.union(ring(CASE_IN + 0.01, CASE_IN - 0.8, 1.2, 0.0))          # ledge the back cover screws to
    for sx in (-1, 1):                                                   # four lugs
        for sy in (-1, 1):
            lug = box(4.0, 7.0, 7.0, (sx * 12.0, sy * (CASE_R + 1.2), 6.0)).edges("|X").fillet(1.4)
            c = c.union(lug)
    for sy in (-1, 1):                                                   # spring bar holes
        c = c.cut(cyl(0.9, 30, (-15, sy * LUG_Y, BAR_Z), (1, 0, 0)))
    for a in BUTTONS.values():                                           # button bores
        x, y = polar(CASE_IN - 1, a)
        dx, dy = polar(1, a)
        c = c.cut(cyl(1.65, 6, (x, y, BTN_Z), (dx, dy, 0)))
    x, y = polar(CASE_IN - 1, -90)                                       # buzzer port at 6 o'clock
    c = c.cut(cyl(0.8, 6, (x, y, 4.2), (0, -1, 0)))
    return c


def back_cover():
    b = cyl(CASE_IN - 0.05, BACK_T)
    b = b.cut(cyl(WIN_R, BACK_T + 2, (0, 0, -1)))
    for x in (-4, 4):                                                    # pogo pin holes
        b = b.cut(cyl(1.7, BACK_T + 2, (x, -12, -1)))
    for a in (45, 135, 225, 315):                                        # four screw heads
        x, y = polar(17.2, a)
        b = b.union(cyl(1.1, 0.4, (x, y, -0.4)))
    return b


def sensor_window():
    w = cyl(WIN_R - 0.05, BACK_T + 0.9, (0, 0, -0.9))
    return w.faces("<Z").edges().fillet(0.8)


def pogo_pads():
    return cyl(1.6, BACK_T + 0.4, (-4, -12, -0.3)).union(cyl(1.6, BACK_T + 0.4, (4, -12, -0.3)))


def screws():
    s = None
    for a in (45, 135, 225, 315):
        x, y = polar(17.2, a)
        c = cyl(0.8, 2.4, (x, y, -0.3))
        s = c if s is None else s.union(c)
    return s


def ppg_sensor():                         # MAX30102: two LEDs and a photodiode, behind the window
    return box(5.6, 3.3, 1.55, (0, 0, 0.9 + 0.775))


def ppg_board():
    return cyl(6.6, 0.6, (0, 0, 2.15))


def temp_sensor():                        # MAX30208 on a thermal pad against the back cover
    return box(2.0, 2.0, 0.75, (-12.0, 2.0, BACK_T + 0.375)).union(box(3.4, 3.4, 0.3, (-12.0, 2.0, BACK_T + 0.15)))


def battery():
    b = box(*BAT, (BAT_C[0], BAT_C[1], BAT_Z + BAT[2] / 2)).edges("|Z").fillet(2.0)
    return b.edges(">Z").fillet(0.8)


def vibration_motor():                    # 10 mm coin motor
    return cyl(5.0, 2.7, (0, -14.0, BAT_Z))


def main_board():
    b = cyl(PCB_R, PCB_T, (0, 0, PCB_Z))
    for a in BUTTONS.values():                                           # notches for the button switches
        x, y = polar(PCB_R, a)
        b = b.cut(box(3.0, 3.0, 4, (x, y, PCB_Z + 0.5)))
    return b


TOP = PCB_Z + PCB_T


def esp32():                              # ESP32-S3-MINI-1 module, shield can
    m = box(15.4, 20.5, 0.8, (-5.0, 2.5, TOP + 0.4))
    return m.union(box(13.8, 15.0, 1.6, (-5.0, 4.6, TOP + 0.8 + 0.8)))


def lora():                               # SX1262 radio and its RF match, under a shield can
    return box(10.0, 10.0, 1.8, (9.5, -3.0, TOP + 0.9))


def imu():                                # BMI270
    return box(2.5, 3.0, 0.8, (6.0, 9.5, TOP + 0.4))


def charger():                            # BQ25180 charger and the 3.3 V regulator
    return box(2.5, 2.5, 0.9, (11.0, 5.5, TOP + 0.45)).union(box(2.0, 2.0, 0.9, (12.5, 9.0, TOP + 0.45)))


def buzzer():                             # 8.5 mm magnetic buzzer, port toward 6 o'clock
    return box(8.5, 8.5, 2.0, (-4.0, -12.0, TOP + 1.0))


def switches():                           # three side-actuated tactile switches
    s = None
    for a in BUTTONS.values():
        x, y = polar(PCB_R - 2.0, a)
        c = box(3.5, 3.0, 1.6, (x, y, TOP + 0.8)).rotate((x, y, 0), (x, y, 1), a)
        s = c if s is None else s.union(c)
    return s


def antenna():                            # LoRa flex antenna along the inside of the case wall
    a0, a1 = 200, 340
    arc = (cq.Workplane("XY").workplane(offset=TOP)
           .moveTo(*polar(19.0, a0)).threePointArc(polar(19.0, (a0 + a1) / 2), polar(19.0, a1))
           .lineTo(*polar(19.25, a1)).threePointArc(polar(19.25, (a0 + a1) / 2), polar(19.25, a0)).close()
           .extrude(3.2))
    return arc


def display():
    d = cyl(DISP_R, DISP_T, (0, 0, DISP_Z))
    return d.union(box(10, 6, 0.3, (0, -DISP_R + 1, DISP_Z - 0.15)))     # flex tail to the board


def cover_glass():
    g = cyl(GLASS_R, GLASS_T, (0, 0, GLASS_Z))
    return g.faces(">Z").edges().chamfer(0.4)


def bezel():
    b = ring(BEZEL_OUT, BEZEL_IN, BEZEL_T, BEZEL_Z)
    b = b.faces(">Z").edges().chamfer(0.5)
    for i in range(12):                                                  # hour marks
        x, y = polar((BEZEL_OUT + BEZEL_IN) / 2, 90 - i * 30)
        b = b.cut(box(0.6 if i % 3 else 1.0, 2.2, 1.0, (x, y, BEZEL_Z + BEZEL_T)).rotate((x, y, 0), (x, y, 1), 90 - i * 30 + 90))
    return b


def button(deg):
    x, y = polar(CASE_IN - 0.6, deg)
    dx, dy = polar(1, deg)
    stem = cyl(1.45, 4.4, (x, y, BTN_Z), (dx, dy, 0))
    ox, oy = polar(CASE_R + 2.2, deg)
    cap = cyl(2.4, 1.8, (ox, oy, BTN_Z), (dx, dy, 0))
    return stem.union(cap).union(cyl(2.4, 0.6, (ox - dx * 0.0, oy - dy * 0.0, BTN_Z), (dx, dy, 0)))


def strap_points(side, n=70):
    """Centre line of one strap half in the YZ plane: from the spring bar outward and down, then round the wrist."""
    th0 = math.radians(62)                                   # where it meets the wrist circle, from the top
    t0 = (math.sin(th0) * WRIST_R, WRIST_C + math.cos(th0) * WRIST_R)
    d0 = (math.cos(th0), -math.sin(th0))
    p0 = (LUG_Y, BAR_Z)
    pts = []
    # a cubic from the bar (leaving outward and a little down) into the circle, tangent to it
    c1 = (p0[0] + 4.0, p0[1] - 1.5)
    c2 = (t0[0] - d0[0] * 7.0, t0[1] - d0[1] * 7.0)
    for i in range(18):
        u = i / 18
        a, b, c, d = (1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3
        pts.append((a * p0[0] + b * c1[0] + c * c2[0] + d * t0[0], a * p0[1] + b * c1[1] + c * c2[1] + d * t0[1]))
    th1 = math.radians(172 if side > 0 else 176)
    for i in range(n + 1):
        th = th0 + (th1 - th0) * i / n
        pts.append((math.sin(th) * WRIST_R, WRIST_C + math.cos(th) * WRIST_R))
    return [(side * y, z) for y, z in pts]


def strap(side):
    pts = strap_points(side)
    inner, outer = [], []
    for i, (y, z) in enumerate(pts):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        ty, tz = b[0] - a[0], b[1] - a[1]
        L = math.hypot(ty, tz) or 1
        ny, nz = tz / L, -ty / L                              # normal, pointing away from the wrist for side > 0
        if side < 0:
            ny, nz = -ny, -nz
        inner.append((y - ny * STRAP_T / 2, z - nz * STRAP_T / 2))
        outer.append((y + ny * STRAP_T / 2, z + nz * STRAP_T / 2))
    poly = outer + inner[::-1]
    s = cq.Workplane("YZ").polyline(poly).close().extrude(STRAP_W / 2, both=True)
    # the loop round the spring bar
    s = s.union(cyl(1.7, STRAP_W, (-STRAP_W / 2, side * LUG_Y, BAR_Z), (1, 0, 0)))
    s = s.cut(cyl(0.95, STRAP_W + 2, (-STRAP_W / 2 - 1, side * LUG_Y, BAR_Z), (1, 0, 0)))
    if side < 0:                                              # the holes for the buckle pin, near the end
        for k in range(5):
            th = math.radians(148 + k * 5.5)
            ry, rz = -math.sin(th), math.cos(th)              # outward from the wrist
            y, z = ry * WRIST_R, WRIST_C + rz * WRIST_R
            s = s.cut(cyl(0.9, 8, (0, y + ry * 4, z + rz * 4), (0, -ry, -rz)))
    return s


def spring_bars():
    return cyl(0.8, 24.5, (-12.25, LUG_Y, BAR_Z), (1, 0, 0)).union(cyl(0.8, 24.5, (-12.25, -LUG_Y, BAR_Z), (1, 0, 0)))


def buckle():
    z = WRIST_C - WRIST_R
    frame = box(STRAP_W + 4, 9, 2.6, (0, 2.0, z)).cut(box(STRAP_W + 0.4, 5.4, 4, (0, 2.0, z)))
    pin = cyl(0.6, 7.2, (0, 2.0 + 2.7, z), (0, -1, 0))
    return frame.union(pin).edges("|Y").fillet(0.6)


# ---------------------------------------------------------------- the model
# part: mesh name -> (builder, bom line, color, finish, explode vector)
PARTS = [
    dict(mesh="case", fn=case, bom="case", color=GRAPHITE, finish="plastic", explode=(0, 0, 0)),
    dict(mesh="back_cover", fn=back_cover, bom="back", color=GRAPHITE, finish="plastic", explode=(0, 0, -20)),
    dict(mesh="screws", fn=screws, bom="back", color=SILVER, finish="metal", explode=(0, 0, -26)),
    dict(mesh="sensor_window", fn=sensor_window, bom="window", color=GLASS, finish="glass", explode=(0, 0, -30)),
    dict(mesh="pogo_pads", fn=pogo_pads, bom="pogo", color=GOLD, finish="metal", explode=(0, 0, -24)),
    dict(mesh="ppg_sensor", fn=ppg_sensor, bom="ppg", color=CHIP, finish="plastic", explode=(0, 0, -12)),
    dict(mesh="ppg_board", fn=ppg_board, bom="ppg", color=PCB, finish="plastic", explode=(0, 0, -9)),
    dict(mesh="temp_sensor", fn=temp_sensor, bom="temp", color=CHIP, finish="plastic", explode=(-6, 0, -14)),
    dict(mesh="battery", fn=battery, bom="battery", color=CELL, finish="plastic", explode=(0, 0, -3)),
    dict(mesh="vibration_motor", fn=vibration_motor, bom="motor", color=SILVER, finish="metal", explode=(0, -8, -3)),
    dict(mesh="main_board", fn=main_board, bom="pcb", color=PCB, finish="plastic", explode=(0, 0, 6)),
    dict(mesh="esp32", fn=esp32, bom="esp32", color=SILVER, finish="metal", explode=(0, 0, 11)),
    dict(mesh="lora", fn=lora, bom="lora", color=SILVER, finish="metal", explode=(4, 0, 11)),
    dict(mesh="imu", fn=imu, bom="imu", color=CHIP, finish="plastic", explode=(2, 4, 11)),
    dict(mesh="charger", fn=charger, bom="power", color=CHIP, finish="plastic", explode=(4, 3, 11)),
    dict(mesh="buzzer", fn=buzzer, bom="buzzer", color=BLACK, finish="plastic", explode=(0, -4, 11)),
    dict(mesh="switches", fn=switches, bom="switches", color=SILVER, finish="metal", explode=(0, 0, 8)),
    dict(mesh="antenna", fn=antenna, bom="antenna", color=COPPER, finish="glow", explode=(0, -10, 9)),
    dict(mesh="display", fn=display, bom="display", color=SCREEN, finish="glass", explode=(0, 0, 19)),
    dict(mesh="cover_glass", fn=cover_glass, bom="glass", color=GLASS, finish="glass", explode=(0, 0, 25)),
    dict(mesh="bezel", fn=bezel, bom="bezel", color=ALU, finish="metal", explode=(0, 0, 31)),
    dict(mesh="button_ok", fn=lambda: button(BUTTONS["ok"]), bom="btn_ok", color=GREEN, finish="paint", explode=(*polar(10, 30), 0)),
    dict(mesh="button_help", fn=lambda: button(BUTTONS["help"]), bom="btn_help", color=RED, finish="paint", explode=(*polar(10, -30), 0)),
    dict(mesh="button_morse", fn=lambda: button(BUTTONS["morse"]), bom="btn_morse", color=BLUE, finish="paint", explode=(*polar(10, 180), 0)),
    dict(mesh="spring_bars", fn=spring_bars, bom="strap", color=SILVER, finish="metal", explode=(0, 0, 0)),
    dict(mesh="strap_top", fn=lambda: strap(1), bom="strap", color=STRAP, finish="rubber", explode=(0, 14, 0)),
    dict(mesh="strap_bottom", fn=lambda: strap(-1), bom="strap", color=STRAP, finish="rubber", explode=(0, -14, 0)),
    dict(mesh="buckle", fn=buckle, bom="strap", color=SILVER, finish="metal", explode=(0, 14, -6)),
]

# One line per thing you would buy or make. mass_g None = from the CAD volume. solves = the HackFest problems it serves.
BOM = [
    # Case
    dict(id="case", group="Case", name="Case", mass_g=None, density=PA12 * PA12_FILL, cost=6,
         what="Glass-filled nylon (PA12), printed and dyed, 45 mm across, 12.6 mm thick",
         does="Holds everything, takes the knocks of tunnel work, and seals with an O-ring under the bezel and the back.", solves=[]),
    dict(id="bezel", group="Case", name="Bezel", mass_g=None, density=AL, cost=4,
         what="6061 aluminium ring, anodised, with hour marks",
         does="Clamps the cover glass and protects its edge. The marks make the time readable with the screen off.", solves=[]),
    dict(id="glass", group="Case", name="Cover glass", mass_g=None, density=GLASS_D, cost=5,
         what="Sapphire, 36.8 mm, 1.1 mm",
         does="Scratch-proof window over the screen and the touch layer.", solves=[]),
    dict(id="back", group="Case", name="Back cover and screws", mass_g=None, density=PA12 * PA12_FILL, cost=2,
         what="Same nylon as the case, four M1.4 stainless screws",
         does="Closes the watch against the skin, with the sensor window and charging pads through it.", solves=[]),
    dict(id="window", group="Case", name="Sensor window", mass_g=None, density=GLASS_D, cost=2,
         what="Sapphire dome, 12 mm",
         does="Lets the heart-rate sensor's light into the skin and back out, and presses the sensor against the wrist.", solves=[9, 10]),
    dict(id="strap", group="Case", name="Strap, buckle and spring bars", mass_g=None, density=FKM, cost=5,
         what="22 mm fluoroelastomer (FKM) strap, stainless buckle and quick-release bars",
         does="Stays on through sweat, dust and water. Quick-release bars, so a strap is swapped in seconds.", solves=[]),
    # Controls
    dict(id="btn_ok", group="Controls", name="I'M OK button (2 o'clock)", mass_g=0.4, cost=0.5,
         what="Green aluminium push button on a sealed stem",
         does="One press tells the whole family you are safe, even with the screen dark.", solves=[8]),
    dict(id="btn_help", group="Controls", name="HELP button (4 o'clock)", mass_g=0.4, cost=0.5,
         what="Red push button, recessed so a knock can't press it",
         does="Hold two seconds to call for help: the family is told and the call joins the rescue queue with your vitals.", solves=[8, 10]),
    dict(id="btn_morse", group="Controls", name="Morse key (9 o'clock)", mass_g=0.4, cost=0.5,
         what="Blue push button with a short throw",
         does="Tap a dot, hold a dash. Sends a message by feel when you can't look at the screen or speak.", solves=[7, 8]),
    dict(id="switches", group="Controls", name="Button switches", mass_g=0.2, cost=0.6,
         what="Three side-actuated tactile switches on the main board",
         does="What each button presses.", solves=[]),
    # Brain and radio
    dict(id="esp32", group="Brain and radio", name="ESP32-S3 module", mass_g=1.6, cost=3.5,
         what="ESP32-S3-MINI-1: two 240 MHz cores, Wi-Fi, Bluetooth LE",
         does="Runs the watch: the screen, the buttons, the family list. Talks to the block's relay box over Bluetooth, and straight to the API over Wi-Fi when the network is up.", solves=[7, 8]),
    dict(id="lora", group="Brain and radio", name="LoRa radio", mass_g=0.8, cost=4.5,
         what="Semtech SX1262, 915 MHz, up to 22 dBm, under a shield can",
         does="The radio the Directorate can't switch off. When the network is cut, check-ins, help calls and Morse go out by radio to the nearest relay, which passes them on.", solves=[7, 8]),
    dict(id="antenna", group="Brain and radio", name="LoRa antenna", mass_g=0.2, cost=1.5,
         what="Flexible printed antenna, curved along the inside of the case wall",
         does="Puts the radio's signal through the case. Along the wall it stays clear of the battery and the wrist.", solves=[7]),
    dict(id="pcb", group="Brain and radio", name="Main board", mass_g=None, density=0.00185, cost=6,
         what="Round 4-layer board, 37 mm, made and assembled to order",
         does="Joins everything. Has notches for the three button switches.", solves=[]),
    dict(id="imu", group="Brain and radio", name="Motion sensor", mass_g=0.05, cost=2,
         what="Bosch BMI270, accelerometer and gyroscope",
         does="Notices a fall or a sudden stop and no movement after it, then asks the wearer if they are OK. No answer in 30 seconds and it calls for help by itself.", solves=[10]),
    # Body sensors
    dict(id="ppg", group="Body sensors", name="Heart rate and blood oxygen", mass_g=0.4, cost=3,
         what="Maxim MAX30102 on its own small board, behind the window",
         does="Red and infrared light through the skin gives heart rate and blood oxygen. Low oxygen is the first sign of the lung sickness, so readings feed the outbreak map.", solves=[9, 10]),
    dict(id="temp", group="Body sensors", name="Skin temperature", mass_g=0.05, cost=2,
         what="Maxim MAX30208 (0.1 C accuracy) on a thermal pad against the back",
         does="Spots a fever. With the heart rate, it sets how urgent a help call is.", solves=[9, 10]),
    # Screen and sound
    dict(id="display", group="Screen and sound", name="Round display", mass_g=3.0, cost=8,
         what="1.28 in round 240 x 240 IPS screen (GC9A01) with touch",
         does="Shows the time, the family, alerts and the Morse being typed. This page runs the real watch software on it.", solves=[8]),
    dict(id="motor", group="Screen and sound", name="Vibration motor", mass_g=0.9, cost=0.8,
         what="10 mm coin motor",
         does="Buzzes Morse and alerts into the wrist, so a message gets through in the dark or in noise.", solves=[7, 8]),
    dict(id="buzzer", group="Screen and sound", name="Buzzer", mass_g=0.6, cost=0.7,
         what="8.5 mm magnetic buzzer, port at 6 o'clock",
         does="Beeps alerts and plays Morse out loud. Loud enough to help a rescuer find someone.", solves=[10]),
    # Power
    dict(id="battery", group="Power", name="Battery", mass_g=5.5, cost=4,
         what="LiPo pouch, 3.7 V, 260 mAh (0.96 Wh), 26 x 20 x 4.5 mm",
         does="About 4 days with vitals every 5 minutes and the radio listening; weeks with only check-ins.", solves=[1]),
    dict(id="power", group="Power", name="Charger and regulator", mass_g=0.05, cost=1.5,
         what="TI BQ25180 charger and a 3.3 V regulator",
         does="Charges from the two pads on the back, and reports battery level with every message so the twin can warn before a watch dies.", solves=[1]),
    dict(id="pogo", group="Power", name="Charging pads", mass_g=0.1, cost=0.6,
         what="Two gold-plated contacts through the back cover",
         does="Charge from any relay box's dock: no socket to let water or dust in.", solves=[]),
]

# how the page's battery estimate is worked out: draw in milliamps for each state
POWER = dict(battery_mah=260, sleep_ma=0.08, screen_on_ma=28, ble_ma=3.5, lora_tx_ma=118, lora_rx_ma=5.3, ppg_ma=1.2,
             note="Typical datasheet currents at 3.7 V. An estimate for a design, not a measurement.")


def main():
    MESH.mkdir(parents=True, exist_ok=True)
    shapes, vol, bbox = {}, {}, {}
    for p in PARTS:
        s = p["fn"]()
        solid = s.val() if hasattr(s, "val") else s
        shapes[p["mesh"]], vol[p["mesh"]] = s, solid.Volume()
        b = solid.BoundingBox()
        bbox[p["mesh"]] = [[round(b.xmin, 2), round(b.ymin, 2), round(b.zmin, 2)], [round(b.xmax, 2), round(b.ymax, 2), round(b.zmax, 2)]]
        cq.exporters.export(s, str(MESH / f"{p['mesh']}.stl"), tolerance=0.02, angularTolerance=0.15)
        print(f"  {p['mesh']:<16} {vol[p['mesh']]:9.1f} mm3")

    total_g, total_cost, bom_out = 0.0, 0.0, []
    for b in BOM:
        meshes = [p["mesh"] for p in PARTS if p["bom"] == b["id"]]
        if b["mass_g"] is None:
            each, src = sum(vol[m] for m in meshes) * b["density"], "CAD volume x density"
        else:
            each, src = float(b["mass_g"]), "typical for the part"
        total_g += each
        total_cost += b["cost"]
        bom_out.append(dict(id=b["id"], group=b["group"], name=b["name"], what=b["what"], does=b["does"], solves=b["solves"],
                            qty=1, mass_g=round(each, 1), mass_from=src, cost_usd=b["cost"]))

    lo = [min(bbox[p["mesh"]][0][i] for p in PARTS if not p["mesh"].startswith(("strap", "buckle"))) for i in range(3)]
    hi = [max(bbox[p["mesh"]][1][i] for p in PARTS if not p["mesh"].startswith(("strap", "buckle"))) for i in range(3)]
    spec = dict(
        name="Family watch", device="watch-0071", units="mm", axes="X toward 3 o'clock, Y toward 12 o'clock, Z out of the screen",
        status="Design for the wearable. The working prototypes are the phone watch and the Arduino watch; this case has not been built.",
        size=dict(across=round(2 * CASE_R, 1), lug_to_lug=round(hi[1] - lo[1], 1), thick=round(hi[2] - lo[2], 1), strap_width=STRAP_W,
                  display_mm=round(2 * DISP_R, 1), display_px=240, lo=lo, hi=hi,
                  screen_z=round(DISP_Z + DISP_T, 2), glass_z=round(GLASS_Z + GLASS_T, 2), active_r=16.2),
        mass_g=round(total_g, 1), mass_body_g=round(total_g - next(x["mass_g"] for x in bom_out if x["id"] == "strap"), 1),
        cost_usd=round(total_cost, 2),
        links={"watch": dict(parent=None, origin=[0, 0, 0], joint=None)},
        parts=[dict(mesh=f"meshes/{p['mesh']}.stl", link="watch", color=p["color"], finish=p["finish"], bom=p["bom"],
                    xyz=[0, 0, 0], yaw=0.0, explode=[round(v, 2) for v in p["explode"]], bbox=bbox[p["mesh"]]) for p in PARTS],
        bom=bom_out, buttons={k: dict(angle=a, z=BTN_Z) for k, a in BUTTONS.items()}, power=POWER,
    )
    (OUT / "watch.json").write_text(json.dumps(spec, indent=1))

    hexrgb = lambda h: cq.Color(int(h[1:3], 16) / 255, int(h[3:5], 16) / 255, int(h[5:7], 16) / 255)
    root = cq.Assembly(name="family_watch")
    for p in PARTS:
        root.add(shapes[p["mesh"]], name=p["mesh"], color=hexrgb(p["color"]))
    root.save(str(OUT / "watch.step"))
    print(f"\n{len(PARTS)} parts, {total_g:.1f} g with the strap, about ${total_cost:.0f}")
    print(f"{2 * CASE_R:.0f} mm across, {hi[2] - lo[2]:.1f} mm thick, {hi[1] - lo[1]:.1f} mm lug to lug")


if __name__ == "__main__":
    main()
