"""Scout rover: the one CAD source.

Run:  .venv/bin/python scout.py        (needs cadquery, see ../README.md)

Writes, into ../../twin/scout/cad/ (so the public page can serve them):
  scout.step        the whole assembly, for any CAD program
  scout.urdf        links, joints and limits, for a robot simulator
  scout.json        the same model for the web page: parts, joints, bill of materials
  meshes/*.stl      one mesh per unique part, in millimetres

Axes: X forward, Y left, Z up. Millimetres. Every part is drawn in the frame of
the link it is bolted to, so a link frame plus a joint angle places it.
"""
import json
import math
import pathlib

import cadquery as cq

OUT = pathlib.Path(__file__).resolve().parents[2] / "twin" / "scout" / "cad"
MESH = OUT / "meshes"

# ---------------------------------------------------------------- dimensions
WHEEL_R, WHEEL_W = 80.0, 70.0
AXLE_X = 240.0          # front and rear axles, from the middle axle
TRACK_Y = 235.0         # wheel centre, from the centre line
BODY_L, BODY_W, BODY_H = 440.0, 260.0, 100.0
PIVOT_Z = 235.0         # rocker pivot above the ground = origin of the body frame
ROCKER_Y = 169.0        # rocker plate centre
BOGIE_Y = 179.0         # bogie plate centre
BOGIE_X, BOGIE_Z = -120.0, 135.0   # bogie pivot, in the world at rest
PLATE_T = 8.0
DECK_Z = BODY_H / 2 + 3.0          # top of the lid, in the body frame
MAST_X, MAST_HINGE_Z = -150.0, DECK_Z + 30.0
MAST_LEN = 320.0
PAN_Z = MAST_LEN + 14.0            # pan axis seat, in the mast frame
TILT_Z = 40.0                      # tilt axis, above the pan seat
PROBE_PIVOT = (232.0, 90.0, -35.0)  # in the body frame
PROBE_LEN = 195.0

# densities in g/mm3, with the share of a printed part that is plastic
AL = 0.00270
PETG, PETG_FILL = 0.00127, 0.45
TPU, TPU_FILL = 0.00121, 0.60
CARBON = 0.00160

YELLOW, GRAPHITE, ALU, BLACK = "#D2A01E", "#34383C", "#B9BDC1", "#17181A"
TYRE, PCB, CELL, BRASS = "#1D1E20", "#2F6B45", "#2C5F86", "#B08D3C"
RED, AMBER, GLASS, LAMP, PALE = "#B3131F", "#E08A00", "#0E1A24", "#FFF3D6", "#D9DBD6"


# ---------------------------------------------------------------- helpers
def wp(solid):
    return cq.Workplane("XY").newObject([solid])


def cyl(r, h, p=(0, 0, 0), d=(0, 0, 1)):
    return wp(cq.Solid.makeCylinder(r, h, cq.Vector(*p), cq.Vector(*d)))


def box(lx, ly, lz, c=(0, 0, 0)):
    return cq.Workplane("XY").box(lx, ly, lz).translate(c)


def stand_up(flat, t):
    """A profile drawn in XY and extruded t along Z becomes a plate in XZ, centred on Y."""
    return flat.rotate((0, 0, 0), (1, 0, 0), 90).translate((0, t / 2, 0))


def bar(a, b, w, t):
    """A round-ended flat bar from a to b (2D points), w wide, t thick, lying in XY."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(dx, dy)
    return (cq.Workplane("XY").center((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            .slot2D(length + w, w, math.degrees(math.atan2(dy, dx))).extrude(t))


def holes_along(a, b, n, d, t, skip_ends=0.18):
    out = None
    for i in range(n):
        f = skip_ends + (1 - 2 * skip_ends) * (i / (n - 1) if n > 1 else 0.5)
        c = cyl(d / 2, t + 2, (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, -1))
        out = c if out is None else out.union(c)
    return out


# ---------------------------------------------------------------- parts
def chassis_tub():
    tub = box(BODY_L, BODY_W, BODY_H).edges("|Z").fillet(24)
    tub = tub.faces("<Z").edges().fillet(9)
    tub = tub.faces(">Z").shell(-2.0)
    for y in (-1, 1):  # holes for the rocker half shafts
        tub = tub.cut(cyl(9, 12, (0, y * (BODY_W / 2 + 4), 0), (0, -y, 0)))
    return tub


def deck_lid():
    lid = box(BODY_L, BODY_W, 3).edges("|Z").fillet(24).translate((0, 0, BODY_H / 2 + 1.5))
    pts = [(x, y) for x in (-190, -95, 0, 95, 190) for y in (-116, 116)] + [(-206, y) for y in (-60, 60)] + [(206, y) for y in (-60, 60)]
    for x, y in pts:
        lid = lid.union(cyl(3.2, 1.6, (x, y, DECK_Z)))
    return lid


def bearing_block():
    b = cyl(25, 33, (0, BODY_W / 2, 0), (0, 1, 0))
    b = b.union(box(70, 6, 70, (0, BODY_W / 2 + 3, 0)).edges("|Y").fillet(10))
    return b.cut(cyl(8, 40, (0, BODY_W / 2 - 2, 0), (0, 1, 0)))


def differential():
    d = box(60, 74, 60).edges("|Y").fillet(8)
    d = d.union(cyl(7, 2 * ROCKER_Y - 8, (0, -(ROCKER_Y - 4), 0), (0, 1, 0)))
    return d.union(cyl(20, 12, (0, 0, 30)))


def battery_pack():
    pack = None
    for i in range(6):
        for j in range(2):
            c = cyl(10.6, 70, (-55 + i * 22, -11 + j * 22, -35))
            pack = c if pack is None else pack.union(c)
    for z in (-37, 34):
        pack = pack.union(box(138, 50, 3, (0, 0, z + 1.5)))
    return pack.translate((-105, 0, -11))


def main_board():
    return box(130, 100, 1.6, (95, 0, -40))


def board_parts():
    p = box(26, 18, 3.2, (130, 28, -37.6))                      # ESP32-S3 module can
    p = p.union(box(15, 12, 2, (132, -6, -38.2)))                # microSD socket
    p = p.union(box(10, 10, 1.4, (104, 30, -38.5)))              # IMU
    for y in (-34, 0, 34):                                        # screw terminals
        p = p.union(box(8, 22, 10, (36, y, -34.2)))
    return p


def motor_drivers():
    d = None
    for y in (-30, 0, 30):
        m = box(44, 24, 3, (70, y, -37.7)).union(box(22, 20, 9, (74, y, -31.7)))
        for k in range(5):
            m = m.cut(box(2, 20, 6, (66 + k * 4, y, -29.5)))     # heat sink fins
        d = m if d is None else d.union(m)
    return d


def power_board():
    b = box(70, 46, 1.6, (-105, 84, -40))
    b = b.union(box(20, 20, 12, (-122, 84, -33.2))).union(box(24, 10, 8, (-92, 92, -35.2)))
    return b.union(cyl(5, 12, (-88, 74, -39.2)))


def relay_box():
    r = box(150, 80, 46, (-10, -75, DECK_Z + 23)).edges("|Z").fillet(6)
    r = r.union(box(154, 84, 4, (-10, -75, DECK_Z + 40)).edges("|Z").fillet(7))
    for x, y in [(-78, -109), (58, -109), (-78, -41), (58, -41)]:
        r = r.union(cyl(2.6, 1.5, (x, y, DECK_Z + 46)))
    return r.union(cyl(7, 14, (65, -75, DECK_Z + 18), (1, 0, 0)))  # cable gland


def relay_light():
    return cyl(4.5, 2.2, (-60, -75, DECK_Z + 46))


def gas_pod():
    g = box(60, 46, 32, (40, 80, DECK_Z + 16)).edges("|Z").fillet(5)
    for k in range(5):
        g = g.cut(box(40, 60, 2.4, (40, 80, DECK_Z + 7 + k * 5)))
    return g.union(box(20, 20, 30, (40, 80, DECK_Z + 16)))


def estop_base():
    return cyl(21, 18, (-185, 85, DECK_Z)).union(cyl(13, 26, (-185, 85, DECK_Z)))


def estop_button():
    return cyl(18, 9, (-185, 85, DECK_Z + 26)).faces(">Z").edges().fillet(4)


def antenna():
    """A short whip clamped to the back of the mast, so it rises with the camera and folds with it."""
    a = box(14, 20, 14, (-14, 0, 150)).union(cyl(4, 22, (-17, 0, 157)))
    return a.union(cyl(2, 130, (-17, 0, 179))).union(cyl(3, 5, (-17, 0, 309)))


def beacon_base():
    return cyl(14, 12, (-190, -45, DECK_Z))


def beacon_dome():
    return cyl(12, 22, (-190, -45, DECK_Z + 12)).faces(">Z").edges().fillet(8)


def bumper():
    x = BODY_L / 2 + 20
    b = cyl(7, 232, (x, -116, 0), (0, 1, 0))
    for y in (-80, 80):
        b = b.union(box(26, 10, 14, (BODY_L / 2 + 9, y, 0)))
    h = cyl(6, 132, (-BODY_L / 2 - 30, -66, 22), (0, 1, 0))   # rear carry handle
    for y in (-60, 60):
        h = h.union(cyl(6, 32, (-BODY_L / 2 + 1, y, 22), (-1, 0, 0)))
    return b.union(h)


def charge_contacts():
    c = None
    for y in (-30, 30):
        p = box(3, 34, 16, (-BODY_L / 2 - 1.5, y, -22)).edges("|X").fillet(4)
        c = p if c is None else c.union(p)
    return c


def mast_base():
    m = box(64, 64, 6, (MAST_X, 0, DECK_Z + 3))
    for y in (-24, 24):
        ear = box(34, 8, 44, (MAST_X, y, DECK_Z + 24)).edges("|Y").fillet(9)
        m = m.union(ear)
    return m.cut(cyl(4, 70, (MAST_X, -35, MAST_HINGE_Z), (0, 1, 0)))


def servo_std(c, axis="y"):
    """A standard servo body (40 x 20 x 38) with its output boss."""
    if axis == "y":
        return box(40, 38, 20, c).union(cyl(6, 6, (c[0] - 10, c[1] - 19, c[2]), (0, -1, 0)))
    return box(38, 40, 20, c).union(cyl(6, 6, (c[0] + 19, c[1], c[2]), (1, 0, 0)))


def mast_servo():
    return servo_std((MAST_X + 10, 47, MAST_HINGE_Z))


def rocker(side=1):
    f, b = (AXLE_X, WHEEL_R - PIVOT_Z), (BOGIE_X, BOGIE_Z - PIVOT_Z)
    p = bar((0, 0), f, 34, PLATE_T).union(bar((0, 0), b, 34, PLATE_T))
    p = p.union(cyl(30, PLATE_T)).union(cyl(21, PLATE_T, (b[0], b[1], 0)))
    p = p.cut(holes_along((0, 0), f, 4, 15, PLATE_T, 0.24)).cut(holes_along((0, 0), b, 2, 13, PLATE_T, 0.36))
    p = stand_up(p, PLATE_T)
    ring = cyl(31, 20, (f[0], -6, f[1]), (0, 1, 0))                      # clamp for the front drive unit
    p = p.union(ring).cut(cyl(22.2, 40, (f[0], -12, f[1]), (0, 1, 0)))
    p = p.union(cyl(13, 6, (0, PLATE_T / 2, 0), (0, 1, 0)))               # pivot nut
    p = p.union(cyl(9, 16, (b[0], -PLATE_T / 2 - 2, b[1]), (0, 1, 0)))    # bogie pivot pin
    return p if side == 1 else p.mirror("XZ")


def bogie(side=1):
    m, r = (-BOGIE_X, WHEEL_R - BOGIE_Z), (-AXLE_X - BOGIE_X, WHEEL_R - BOGIE_Z)
    p = bar((0, 0), m, 32, PLATE_T).union(bar((0, 0), r, 32, PLATE_T)).union(cyl(22, PLATE_T))
    p = p.cut(holes_along((0, 0), m, 2, 12, PLATE_T, 0.34)).cut(holes_along((0, 0), r, 2, 12, PLATE_T, 0.34))
    p = stand_up(p, PLATE_T)
    for e in (m, r):
        p = p.union(cyl(31, 20, (e[0], -16, e[1]), (0, 1, 0))).cut(cyl(22.2, 44, (e[0], -22, e[1]), (0, 1, 0)))
    p = p.union(cyl(12, 5, (0, PLATE_T / 2, 0), (0, 1, 0)))
    return p if side == 1 else p.mirror("XZ")


def drive_unit():
    """Sealed pod around the gearmotor, drawn about the wheel centre; the wheel side is +Y."""
    d = cyl(22, 80, (0, -77, 0), (0, 1, 0))
    d = d.union(cyl(24.5, 7, (0, -77, 0), (0, 1, 0)))                     # sealed end cap
    d = d.union(cyl(24, 4, (0, -1, 0), (0, 1, 0)))                        # shaft seal carrier
    d = d.union(cyl(4, 12, (0, 3, 0), (0, 1, 0)))                         # output shaft
    return d.union(cyl(5, 14, (0, -84, 9), (0, -1, 0)))                   # cable gland


def rim():
    r = cyl(64, WHEEL_W, (0, 0, -WHEEL_W / 2))
    r = r.cut(cyl(60, WHEEL_W - 8, (0, 0, -WHEEL_W / 2)))
    r = r.union(cyl(16, 22, (0, 0, 5)))
    for k in range(5):
        a = math.radians(72 * k + 18)
        r = r.cut(cyl(14, 12, (38 * math.cos(a), 38 * math.sin(a), 24)))
    r = r.cut(cyl(4.1, 40, (0, 0, 0)))
    return r.rotate((0, 0, 0), (1, 0, 0), -90)                            # the spoked face ends up at +Y


def tyre():
    t = cq.Workplane("XY").circle(74).circle(64).extrude(WHEEL_W).translate((0, 0, -WHEEL_W / 2))
    for k in range(20):
        g = box(8.5, 12, WHEEL_W, (76.5, 0, 0)).edges("|Z and >X").fillet(2.5)
        t = t.union(g.rotate((0, 0, 0), (0, 0, 1), 18 * k))
    return t.rotate((0, 0, 0), (1, 0, 0), -90)


def mast_tube():
    m = cyl(11, MAST_LEN - 6, (0, 0, 6)).cut(cyl(9.5, MAST_LEN, (0, 0, 20)))
    m = m.union(cyl(15, 38, (0, -19, 0), (0, 1, 0)))                      # hinge barrel
    return m.union(cyl(16, 8, (0, 0, MAST_LEN - 2)))                      # top collar


def pan_servo():
    return box(24, 13, 22, (0, 0, MAST_LEN + 3)).union(cyl(4, 6, (0, 0, MAST_LEN + 8)))


def yoke():
    y = cyl(20, 6).union(box(30, 124, 6, (0, 0, 9)))
    for s in (-1, 1):
        ear = box(30, 6, 46, (0, s * 58, 31)).edges("|Y").fillet(8)
        y = y.union(ear)
    return y.cut(cyl(3, 140, (0, -70, TILT_Z), (0, 1, 0)))


def tilt_servo():
    return box(24, 13, 22, (0, 67.5, TILT_Z - 4))


def head_housing():
    h = box(64, 104, 56, (6, 0, 0)).edges().fillet(7)
    h = h.cut(cyl(13.5, 6, (33, 0, 4), (1, 0, 0)))                        # lens seat
    return h.union(cyl(22, 10, (6, 0, 28)))                               # lidar seat


def head_lens():
    return cyl(15, 12, (32, 0, 4), (1, 0, 0)).cut(cyl(11, 4, (41, 0, 4), (1, 0, 0)))


def head_glass():
    g = cyl(11, 1.2, (40, 0, 4), (1, 0, 0))
    return g.union(box(1.2, 34, 10, (38.4, 0, -18)))                      # range sensor window


def lamp_bezel():
    b = None
    for y in (-34, 34):
        c = cyl(12, 8, (36, y, 4), (1, 0, 0)).cut(cyl(9, 4, (41, y, 4), (1, 0, 0)))
        b = c if b is None else b.union(c)
    return b


def lamp_lens():
    b = None
    for y in (-34, 34):
        c = cyl(9, 1.5, (40.5, y, 4), (1, 0, 0))
        b = c if b is None else b.union(c)
    return b


def lidar_rotor():
    r = cyl(20, 20).cut(box(14, 26, 12, (16, 0, 11)))
    return r.union(cyl(21, 3, (0, 0, 20)))


def probe_flange():
    x, y, z = PROBE_PIVOT
    return cyl(16, x - BODY_L / 2 - 5, (BODY_L / 2, y, z), (1, 0, 0)).union(box(4, 44, 30, (BODY_L / 2 + 2, y, z)))


def probe_arm():
    a = cyl(12, 10, (-5, 0, 0), (1, 0, 0))
    a = a.union(box(6, PROBE_LEN - 25, 14, (0, -(PROBE_LEN - 25) / 2, 0)))
    a = a.union(cyl(6, 22, (0, -(PROBE_LEN - 24), 0), (0, -1, 0)))
    for z in (-3, 3):
        a = a.union(cyl(1, 8, (0, -(PROBE_LEN - 4), z), (0, -1, 0)))
    return a


def probe_strip():
    return box(1.2, PROBE_LEN - 60, 8, (3.4, -(PROBE_LEN - 60) / 2 - 22, 0))


# ---------------------------------------------------------------- the model
# links: name -> (parent, joint origin in the parent frame, joint)
J = lambda name, kind, axis, lo, hi, drive, note: dict(name=name, type=kind, axis=axis, lower=lo, upper=hi, actuator=drive, note=note)
R = math.radians
LINKS = {"base": dict(parent=None, origin=(0, 0, PIVOT_Z))}
for s, sy in (("L", 1), ("R", -1)):
    side = "left" if sy == 1 else "right"
    LINKS[f"rocker_{s}"] = dict(parent="base", origin=(0, sy * ROCKER_Y, 0), joint=J(
        f"rocker_{side}", "revolute", (0, 1, 0), R(-28), R(28), None,
        "Free pivot. The two rockers are tied through the differential, so the body sits at their average angle."))
    LINKS[f"bogie_{s}"] = dict(parent=f"rocker_{s}", origin=(BOGIE_X, sy * (BOGIE_Y - ROCKER_Y), BOGIE_Z - PIVOT_Z), joint=J(
        f"bogie_{side}", "revolute", (0, 1, 0), R(-32), R(32), None, "Free pivot. Lets the middle and rear wheels follow the ground."))
    wy = sy * (TRACK_Y - ROCKER_Y)
    LINKS[f"wheel_F{s}"] = dict(parent=f"rocker_{s}", origin=(AXLE_X, wy, WHEEL_R - PIVOT_Z), joint=J(
        f"drive_front_{side}", "continuous", (0, 1, 0), None, None, "drive", "Drive motor."))
    by = sy * (TRACK_Y - BOGIE_Y)
    LINKS[f"wheel_M{s}"] = dict(parent=f"bogie_{s}", origin=(-BOGIE_X, by, WHEEL_R - BOGIE_Z), joint=J(
        f"drive_mid_{side}", "continuous", (0, 1, 0), None, None, "drive", "Drive motor."))
    LINKS[f"wheel_R{s}"] = dict(parent=f"bogie_{s}", origin=(-AXLE_X - BOGIE_X, by, WHEEL_R - BOGIE_Z), joint=J(
        f"drive_rear_{side}", "continuous", (0, 1, 0), None, None, "drive", "Drive motor."))
LINKS["mast"] = dict(parent="base", origin=(MAST_X, 0, MAST_HINGE_Z), joint=J(
    "mast_fold", "revolute", (0, 1, 0), 0.0, R(90), "mast", "0 is upright. 90 degrees lays the mast forward along the deck."))
LINKS["pan"] = dict(parent="mast", origin=(0, 0, PAN_Z), joint=J(
    "head_pan", "revolute", (0, 0, 1), R(-150), R(150), "micro", "Turns the camera head left and right."))
LINKS["head"] = dict(parent="pan", origin=(0, 0, TILT_Z), joint=J(
    "head_tilt", "revolute", (0, 1, 0), R(-100), R(50), "micro", "Positive looks down. Reaches -90 so the head stays level when the mast is folded."))
LINKS["lidar"] = dict(parent="head", origin=(6, 0, 38), joint=J(
    "lidar_spin", "continuous", (0, 0, 1), None, None, "lidar", "The lidar's own motor, about 10 turns a second."))
LINKS["probe"] = dict(parent="base", origin=PROBE_PIVOT, joint=J(
    "probe_arm", "revolute", (1, 0, 0), 0.0, R(90), "standard", "0 is stowed across the bumper. 90 degrees points the probe straight down."))

ACTUATORS = {
    "drive": dict(name="12 V planetary gearmotor with encoder, 36 mm, about 1:100", count=6,
                  no_load_rpm=75, rated_torque_nm=1.8, stall_torque_nm=6.0, no_load_a=0.3, stall_a=8.0, volts=12),
    "mast": dict(name="High-torque servo, 25 kg cm class", count=1, stall_torque_nm=2.4, volts=6),
    "standard": dict(name="Standard servo, 10 kg cm class", count=1, stall_torque_nm=1.0, volts=6),
    "micro": dict(name="Metal-gear micro servo, 2 kg cm class", count=2, stall_torque_nm=0.2, volts=5),
    "lidar": dict(name="Motor inside the lidar", count=1, volts=5),
}

# bill of materials: id -> line. mass_g None = worked out from the CAD volume.
BOM = [
    dict(id="chassis", group="Body", name="Chassis tub", what="2 mm 5052 aluminium sheet, cut and bent, painted", cost=85, mass_g=None,
         does="Holds the battery, the controller and the differential. The underside sits 18.5 cm off the floor."),
    dict(id="lid", group="Body", name="Deck lid", what="3 mm 5052 aluminium plate", cost=38, mass_g=None,
         does="Seals the tub with a gasket and carries everything mounted on top."),
    dict(id="bumper", group="Body", name="Front bumper and rear handle", what="14 mm aluminium tube", cost=18, mass_g=None,
         does="The bumper protects the folded probe. The handle is for carrying: the rover weighs about as much as a full backpack."),
    dict(id="bearing", group="Suspension", name="Rocker bearing block", what="Machined aluminium, two ball bearings each", cost=16, mass_g=None,
         does="Carries a rocker's half shaft through the side of the tub."),
    dict(id="diff", group="Suspension", name="Differential", what="Three bevel gears in a printed housing, two 14 mm half shafts", cost=45, mass_g=390,
         does="Ties the two rockers together: when one side climbs, the other pushes down, and the body tilts only half as much."),
    dict(id="rocker", group="Suspension", name="Rocker arm", what="8 mm 6061 aluminium plate, waterjet cut", cost=38, mass_g=None,
         does="Joins the front wheel to the bogie. Pivots freely on the body."),
    dict(id="bogie", group="Suspension", name="Bogie arm", what="8 mm 6061 aluminium plate, waterjet cut", cost=30, mass_g=None,
         does="Carries the middle and rear wheels and rocks about its own pivot, so all six wheels stay on the ground."),
    dict(id="drive", group="Drive", name="Drive unit", what="12 V planetary gearmotor with encoder in a sealed pod", cost=46, mass_g=420,
         does="One per wheel, inside the wheel hub. The pod's shaft seal is what lets the rover wade."),
    dict(id="rim", group="Drive", name="Wheel rim", what="Printed PETG", cost=4, mass_g=None,
         does="Cup-shaped so the drive unit sits inside it."),
    dict(id="tyre", group="Drive", name="Tyre", what="Printed TPU, 20 cleats", cost=6, mass_g=None,
         does="160 mm across. Soft enough to grip wet rock, cleated for loose rubble."),
    dict(id="drivers", group="Drive", name="Motor drivers", what="Three dual-channel drivers, 10 A a channel", cost=14, mass_g=22,
         does="One channel per wheel, so each wheel's speed and current are controlled and measured separately."),
    dict(id="battery", group="Power", name="Battery", what="12 x 21700 Li-ion cells, 4S3P, 14.4 V 15 Ah, with a protection board", cost=110, mass_g=960,
         does="216 Wh. Mounted low and to the rear to balance the mast."),
    dict(id="power", group="Power", name="Power board", what="Fuse, cut-off relay, 12 V and 5 V regulators, current sensor", cost=28, mass_g=90,
         does="Measures what the rover draws, so it reports its own hours left the same way a block relay does."),
    dict(id="estop", group="Power", name="Emergency stop", what="Latching mushroom button", cost=9, mass_g=60,
         does="Cuts motor power. Anyone in the tunnel can stop it by hand."),
    dict(id="contacts", group="Power", name="Charging contacts", what="Two sprung brass pads", cost=6, mass_g=30,
         does="The rover backs onto a dock beside a block's relay box to charge."),
    dict(id="controller", group="Compute and radio", name="Controller", what="ESP32-S3 module on a carrier board, IMU, microSD card", cost=32, mass_g=85,
         does="Drives the motors, reads the sensors, and keeps every message on the card until it has been passed on."),
    dict(id="relay", group="Compute and radio", name="Relay box", what="ESP32 with a LoRa radio: the same box every block has", cost=30, mass_g=210,
         does="Stores messages and forwards them. On the rover it becomes a relay that can drive to where the signal is."),
    dict(id="antenna", group="Compute and radio", name="Antenna", what="Short whip clamped to the mast", cost=8, mass_g=25,
         does="Rides on the mast, so it goes up with the camera and lies flat when the mast folds."),
    dict(id="beacon", group="Compute and radio", name="Beacon", what="Amber LED", cost=7, mass_g=40,
         does="So people in a dark tunnel see it coming."),
    dict(id="mast", group="Mast and head", name="Mast", what="22 mm carbon tube, printed hinge", cost=14, mass_g=None,
         does="Lifts the camera to see over rubble, and folds forward along the deck to get under a low roof."),
    dict(id="mastbase", group="Mast and head", name="Mast hinge and yoke", what="Printed PETG brackets", cost=6, mass_g=None,
         does="The hinge at the deck and the fork that holds the head."),
    dict(id="mastservo", group="Mast and head", name="Mast servo", what="High-torque servo, 25 kg cm class", cost=18, mass_g=65,
         does="Raises and folds the mast."),
    dict(id="microservo", group="Mast and head", name="Pan and tilt servos", what="Metal-gear micro servos", cost=6, mass_g=14,
         does="Aim the head. Tilt reaches straight up so the head stays level when the mast is down."),
    dict(id="head", group="Mast and head", name="Head housing", what="Printed PETG, gasketed", cost=7, mass_g=None,
         does="Holds the camera, the lamps and the range sensor."),
    dict(id="camera", group="Sensors", name="Camera", what="5 MP wide-angle module", cost=14, mass_g=12,
         does="Takes the photo that goes out with every tunnel report."),
    dict(id="lamps", group="Sensors", name="Lamps", what="Two 3 W LEDs", cost=8, mass_g=24,
         does="The tunnel lights are off in a blackout. These are the rover's own."),
    dict(id="lidar", group="Sensors", name="Lidar", what="360 degree scanner, 12 m range class", cost=85, mass_g=50,
         does="Measures the tunnel's cross-section, so the rover can tell a roof fall from a clear bore."),
    dict(id="air", group="Sensors", name="Air sensor", what="CO2, temperature and humidity (photoacoustic CO2 sensor)", cost=48, mass_g=20,
         does="Reads the air along the tunnel, in the same units a block's sensor node reports."),
    dict(id="probe", group="Sensors", name="Water probe", what="Folding arm with a depth strip and two electrodes", cost=22, mass_g=70,
         does="Swings down to measure how deep standing water is and how much is dissolved in it."),
    dict(id="probeservo", group="Sensors", name="Probe servo", what="Standard servo behind a sealed flange", cost=12, mass_g=55,
         does="Lowers and stows the probe."),
    dict(id="hardware", group="Body", name="Fasteners, bearings, wiring, gaskets", what="Not drawn", cost=60, mass_g=450,
         does="Everything too small to model. Weight and cost are allowances."),
]

# parts: mesh, link, colour, finish, BOM line, density (or None), how far it moves in the exploded view
PARTS = []


def part(mesh, shape, link, color, bom, finish="paint", dens=None, fill=1.0, xyz=(0, 0, 0), yaw=0.0, ex=(0, 0, 0)):
    PARTS.append(dict(mesh=mesh, shape=shape, link=link, color=color, bom=bom, finish=finish, dens=dens, fill=fill, xyz=xyz, yaw=yaw, explode=ex))


part("chassis_tub", chassis_tub, "base", YELLOW, "chassis", dens=AL)
part("deck_lid", deck_lid, "base", YELLOW, "lid", dens=AL, ex=(0, 0, 150))
part("bumper", bumper, "base", GRAPHITE, "bumper", "metal", dens=AL * 0.35, ex=(0, 0, -70))
part("bearing_block", bearing_block, "base", ALU, "bearing", "metal", dens=AL * 0.7, ex=(0, 60, 0))
part("bearing_block", bearing_block, "base", ALU, "bearing", "metal", dens=AL * 0.7, yaw=180, ex=(0, -60, 0))
part("differential", differential, "base", GRAPHITE, "diff", "plastic", ex=(0, 0, 75))
part("battery_pack", battery_pack, "base", CELL, "battery", "plastic", ex=(0, 0, 80))
part("main_board", main_board, "base", PCB, "controller", "plastic", ex=(0, 0, 60))
part("board_parts", board_parts, "base", ALU, "controller", "metal", ex=(0, 0, 60))
part("motor_drivers", motor_drivers, "base", BLACK, "drivers", "plastic", ex=(0, 0, 60))
part("power_board", power_board, "base", PCB, "power", "plastic", ex=(0, 0, 60))
part("relay_box", relay_box, "base", GRAPHITE, "relay", "plastic", ex=(0, -60, 250))
part("relay_light", relay_light, "base", "#57D17A", "relay", "glow", ex=(0, -60, 250))
part("gas_pod", gas_pod, "base", PALE, "air", "plastic", ex=(0, 60, 250))
part("estop_base", estop_base, "base", YELLOW, "estop", ex=(0, 40, 230))
part("estop_button", estop_button, "base", RED, "estop", "plastic", ex=(0, 40, 245))
part("beacon_base", beacon_base, "base", GRAPHITE, "beacon", "plastic", ex=(-40, 0, 230))
part("beacon_dome", beacon_dome, "base", AMBER, "beacon", "glow", ex=(-40, 0, 245))
part("charge_contacts", charge_contacts, "base", BRASS, "contacts", "metal", ex=(-70, 0, 0))
part("mast_base", mast_base, "base", GRAPHITE, "mastbase", "plastic", dens=PETG, fill=PETG_FILL, ex=(0, 0, 210))
part("mast_servo", mast_servo, "base", BLACK, "mastservo", "plastic", ex=(0, 50, 210))
part("probe_flange", probe_flange, "base", GRAPHITE, "probeservo", "plastic", ex=(60, 0, 0))
for s, sy in (("L", 1), ("R", -1)):
    yaw = 0 if sy == 1 else 180
    part(f"rocker_{s}", (lambda sy=sy: rocker(sy)), f"rocker_{s}", GRAPHITE, "rocker", "metal", dens=AL, ex=(0, sy * 90, 0))
    part(f"bogie_{s}", (lambda sy=sy: bogie(sy)), f"bogie_{s}", GRAPHITE, "bogie", "metal", dens=AL, ex=(0, sy * 150, 0))
    part("drive_unit", drive_unit, f"rocker_{s}", ALU, "drive", "metal", xyz=LINKS[f"wheel_F{s}"]["origin"], yaw=yaw, ex=(0, sy * 215, 0))
    for w in ("M", "R"):
        part("drive_unit", drive_unit, f"bogie_{s}", ALU, "drive", "metal", xyz=LINKS[f"wheel_{w}{s}"]["origin"], yaw=yaw, ex=(0, sy * 215, 0))
    for w in ("F", "M", "R"):
        part("rim", rim, f"wheel_{w}{s}", YELLOW, "rim", "plastic", dens=PETG, fill=PETG_FILL, yaw=yaw, ex=(0, sy * 300, 0))
        part("tyre", tyre, f"wheel_{w}{s}", TYRE, "tyre", "rubber", dens=TPU, fill=TPU_FILL, yaw=yaw, ex=(0, sy * 390, 0))
part("mast_tube", mast_tube, "mast", BLACK, "mast", "carbon", dens=CARBON, ex=(0, 0, 170))
part("antenna", antenna, "mast", BLACK, "antenna", "plastic", ex=(-70, 0, 170))
part("pan_servo", pan_servo, "mast", BLACK, "microservo", "plastic", ex=(0, 0, 200))
part("yoke", yoke, "pan", GRAPHITE, "mastbase", "plastic", dens=PETG, fill=PETG_FILL, ex=(0, 0, 230))
part("tilt_servo", tilt_servo, "pan", BLACK, "microservo", "plastic", ex=(0, 60, 230))
part("head_housing", head_housing, "head", YELLOW, "head", dens=PETG, fill=0.3, ex=(0, 0, 280))
part("head_lens", head_lens, "head", BLACK, "camera", "plastic", ex=(60, 0, 280))
part("head_glass", head_glass, "head", GLASS, "camera", "glass", ex=(75, 0, 280))
part("lamp_bezel", lamp_bezel, "head", ALU, "lamps", "metal", ex=(60, 0, 280))
part("lamp_lens", lamp_lens, "head", LAMP, "lamps", "glow", ex=(75, 0, 280))
part("lidar_rotor", lidar_rotor, "lidar", BLACK, "lidar", "plastic", ex=(0, 0, 340))
part("probe_arm", probe_arm, "probe", PALE, "probe", "plastic", ex=(110, 0, 0))
part("probe_strip", probe_strip, "probe", BRASS, "probe", "metal", ex=(125, 0, 0))


# ---------------------------------------------------------------- build
def world_origin(link):
    x = y = z = 0.0
    while link:
        o = LINKS[link]["origin"]
        x, y, z = x + o[0], y + o[1], z + o[2]
        link = LINKS[link]["parent"]
    return (x, y, z)


def main():
    MESH.mkdir(parents=True, exist_ok=True)
    shapes, vol, bbox = {}, {}, {}
    for p in PARTS:
        m = p["mesh"]
        if m in shapes:
            continue
        s = p["shape"]()
        solid = s.val() if len(s.vals()) == 1 else cq.Compound.makeCompound(s.vals())
        shapes[m], vol[m] = s, solid.Volume()
        b = solid.BoundingBox()
        bbox[m] = [[round(b.xmin, 1), round(b.ymin, 1), round(b.zmin, 1)], [round(b.xmax, 1), round(b.ymax, 1), round(b.zmax, 1)]]
        cq.exporters.export(s, str(MESH / f"{m}.stl"), tolerance=0.08, angularTolerance=0.2)
        print(f"  {m:16s} {vol[m] / 1000:8.1f} cm3")

    # mass: worked out from the CAD where a density is given, else the BOM's catalogue figure
    lines = {b["id"]: dict(b, qty=0, mass_cad=0.0) for b in BOM}
    seen = {}
    for p in PARTS:
        line = lines[p["bom"]]
        if p["dens"]:
            line["mass_cad"] += vol[p["mesh"]] * p["dens"] * p["fill"]
        key = (p["bom"], p["mesh"])
        seen[key] = seen.get(key, 0) + 1
    for (bid, _), n in seen.items():
        lines[bid]["qty"] = max(lines[bid]["qty"], n)
    lines["microservo"]["qty"] = 2      # two different meshes, one each
    lines["rocker"]["qty"] = 2          # left and right are mirror images: two meshes, one part each
    lines["bogie"]["qty"] = 2
    lines["mastbase"]["qty"] = 1        # hinge and yoke are one line
    lines["hardware"]["qty"] = 1
    bom_out, total_g, total_cost = [], 0.0, 0.0
    for b in BOM:
        line = lines[b["id"]]
        qty = line["qty"]
        if b["mass_g"] is None:
            each, src = line["mass_cad"] / qty, "CAD volume x density"
        else:
            each, src = float(b["mass_g"]), "typical for the part"
        total_g += each * qty
        total_cost += b["cost"] * qty
        bom_out.append(dict(id=b["id"], group=b["group"], name=b["name"], what=b["what"], does=b["does"], qty=qty,
                            mass_g=round(each), mass_from=src, cost_usd=b["cost"]))
    link_mass = {k: 0.0 for k in LINKS}
    for p in PARTS:
        line = next(x for x in bom_out if x["id"] == p["bom"])
        n = sum(1 for q in PARTS if q["bom"] == p["bom"])
        link_mass[p["link"]] += line["mass_g"] * line["qty"] / n
    link_mass["base"] += lines["hardware"]["mass_g"]

    # overall size at rest, mast up and mast folded
    def extent(fold):
        lo, hi = [1e9] * 3, [-1e9] * 3
        for p in PARTS:
            o = world_origin(p["link"])
            (a, b) = bbox[p["mesh"]]
            cs = [(x, y, z) for x in (a[0], b[0]) for y in (a[1], b[1]) for z in (a[2], b[2])]
            for c in cs:
                c = (c[0] + p["xyz"][0], c[1] + p["xyz"][1], c[2] + p["xyz"][2]) if p["yaw"] == 0 else (-c[0] + p["xyz"][0], -c[1] + p["xyz"][1], c[2] + p["xyz"][2])
                if fold and p["link"] in ("mast", "pan", "head", "lidar"):
                    h = world_origin("mast")
                    rel = [o[i] + c[i] - h[i] for i in range(3)]
                    if p["link"] in ("head", "lidar"):   # the head stays level: only its pivot swings
                        hp = [world_origin("head")[i] - h[i] for i in range(3)]
                        off = [rel[i] - hp[i] for i in range(3)]
                        w = (h[0] + hp[2] + off[0], h[1] + hp[1] + off[1], h[2] - hp[0] + off[2])
                    else:
                        w = (h[0] + rel[2], h[1] + rel[1], h[2] - rel[0])
                else:
                    w = tuple(o[i] + c[i] for i in range(3))
                for i in range(3):
                    lo[i], hi[i] = min(lo[i], w[i]), max(hi[i], w[i])
        return [round(hi[i] - lo[i]) for i in range(3)], [round(v) for v in lo], [round(v) for v in hi]

    up, up_lo, up_hi = extent(False)
    down, _, _ = extent(True)
    d = ACTUATORS["drive"]
    top_speed = d["no_load_rpm"] * 2 * math.pi / 60 * WHEEL_R / 1000
    spec = dict(
        name="Scout rover", device="rover-01", units="mm", axes="X forward, Y left, Z up",
        status="Design only. Nothing here has been built or tested.",
        size=dict(length=up[0], width=up[1], height_mast_up=up[2], height_mast_folded=down[2], lo=up_lo, hi=up_hi,
                  camera_height=round(world_origin("head")[2] + 4),
                  wheel_diameter=2 * WHEEL_R, ground_clearance=PIVOT_Z - BODY_H / 2, wheelbase=2 * AXLE_X, track=2 * TRACK_Y),
        mass_g=round(total_g), cost_usd=round(total_cost),
        links={k: dict(parent=v["parent"], origin=list(v["origin"]), joint=v.get("joint"), mass_g=round(link_mass[k])) for k, v in LINKS.items()},
        parts=[dict(mesh=f"meshes/{p['mesh']}.stl", link=p["link"], color=p["color"], finish=p["finish"], bom=p["bom"],
                    xyz=list(p["xyz"]), yaw=p["yaw"], explode=list(p["explode"]), bbox=bbox[p["mesh"]]) for p in PARTS],
        bom=bom_out, actuators=ACTUATORS,
        drive=dict(wheel_radius_m=WHEEL_R / 1000, track_m=2 * TRACK_Y / 1000, top_speed_ms=round(top_speed, 2), cruise_ms=0.5,
                   rolling_resistance=0.10, battery_wh=216, usable_share=0.85, electronics_w=4.5, lamps_w=6.0,
                   wade_limit_cm=16, wade_note="Set by the drive pods' shaft seals. The underside of the body is at 18.5 cm."),
    )
    (OUT / "scout.json").write_text(json.dumps(spec, indent=1))

    # STEP: one assembly, a sub-assembly per link
    hexrgb = lambda h: cq.Color(int(h[1:3], 16) / 255, int(h[3:5], 16) / 255, int(h[5:7], 16) / 255)
    subs = {k: cq.Assembly(name=k) for k in LINKS}
    count = {}
    for p in PARTS:
        count[p["mesh"]] = count.get(p["mesh"], 0) + 1
        loc = cq.Location(cq.Vector(*p["xyz"]), cq.Vector(0, 0, 1), p["yaw"])
        subs[p["link"]].add(shapes[p["mesh"]], name=f"{p['mesh']}_{count[p['mesh']]}", loc=loc, color=hexrgb(p["color"]))
    root = cq.Assembly(name="scout_rover")
    for k in LINKS:
        root.add(subs[k], name=k, loc=cq.Location(cq.Vector(*world_origin(k))))
    root.save(str(OUT / "scout.step"))

    write_urdf(spec, bbox)
    print(f"\n{len(PARTS)} parts, {len(shapes)} meshes, {total_g / 1000:.1f} kg, about ${total_cost:.0f}")
    print(f"size {up[0]} x {up[1]} x {up[2]} mm mast up, {down[2]} mm folded; top speed {top_speed:.2f} m/s")


def write_urdf(spec, bbox):
    m = lambda v: f"{v / 1000:.4f}"
    out = ['<?xml version="1.0"?>',
           "<!-- Scout rover (rover-01). Written by robot/cad/scout.py: edit that, not this. Design only, never built. -->",
           '<robot name="scout_rover">']
    mats = {}
    for p in spec["parts"]:
        mats.setdefault(p["color"], f"c{len(mats)}")
    for hexc, name in mats.items():
        r, g, b = (int(hexc[i:i + 2], 16) / 255 for i in (1, 3, 5))
        out.append(f'  <material name="{name}"><color rgba="{r:.3f} {g:.3f} {b:.3f} 1"/></material>')
    for name, link in spec["links"].items():
        parts = [p for p in spec["parts"] if p["link"] == name]
        lo, hi = [1e9] * 3, [-1e9] * 3
        for p in parts:
            for i in range(3):
                a, b = p["bbox"][0][i], p["bbox"][1][i]
                if p["yaw"] and i < 2:
                    a, b = -b, -a
                lo[i], hi[i] = min(lo[i], a + p["xyz"][i]), max(hi[i], b + p["xyz"][i])
        size = [max(hi[i] - lo[i], 1.0) / 1000 for i in range(3)]
        com = [(hi[i] + lo[i]) / 2 for i in range(3)]
        kg = max(link["mass_g"], 1) / 1000
        ixx, iyy, izz = (kg / 12 * (size[1] ** 2 + size[2] ** 2), kg / 12 * (size[0] ** 2 + size[2] ** 2), kg / 12 * (size[0] ** 2 + size[1] ** 2))
        out.append(f'  <link name="{name}">')
        out.append(f'    <inertial><origin xyz="{m(com[0])} {m(com[1])} {m(com[2])}"/><mass value="{kg:.3f}"/>'
                   f'<inertia ixx="{ixx:.6f}" ixy="0" ixz="0" iyy="{iyy:.6f}" iyz="0" izz="{izz:.6f}"/></inertial>')
        for p in parts:
            yaw = math.pi if p["yaw"] else 0
            out.append(f'    <visual><origin xyz="{m(p["xyz"][0])} {m(p["xyz"][1])} {m(p["xyz"][2])}" rpy="0 0 {yaw:.5f}"/>'
                       f'<geometry><mesh filename="{p["mesh"]}" scale="0.001 0.001 0.001"/></geometry><material name="{mats[p["color"]]}"/></visual>')
        if name.startswith("wheel_"):
            out.append(f'    <collision><origin rpy="1.5708 0 0"/><geometry><cylinder radius="{m(WHEEL_R)}" length="{m(WHEEL_W)}"/></geometry></collision>')
        elif name == "base":
            out.append(f'    <collision><geometry><box size="{m(BODY_L)} {m(BODY_W)} {m(BODY_H)}"/></geometry></collision>')
        out.append("  </link>")
    for name, link in spec["links"].items():
        j = link["joint"]
        if not j:
            continue
        o = link["origin"]
        out.append(f'  <joint name="{j["name"]}" type="{j["type"]}">')
        out.append(f'    <parent link="{link["parent"]}"/><child link="{name}"/>')
        out.append(f'    <origin xyz="{m(o[0])} {m(o[1])} {m(o[2])}"/><axis xyz="{j["axis"][0]} {j["axis"][1]} {j["axis"][2]}"/>')
        a = spec["actuators"].get(j["actuator"]) if j["actuator"] else None
        effort = (a.get("stall_torque_nm") or 0.1) if a else 0
        vel = 7.85 if j["actuator"] == "drive" else 3.0
        if j["type"] == "revolute":
            out.append(f'    <limit lower="{j["lower"]:.4f}" upper="{j["upper"]:.4f}" effort="{effort}" velocity="{vel}"/>')
        elif a:
            out.append(f'    <limit effort="{effort}" velocity="{vel}"/>')
        if j["name"] == "rocker_right":
            out.append('    <mimic joint="rocker_left" multiplier="-1"/>  <!-- the differential -->')
        out.append("  </joint>")
    out.append("</robot>")
    (OUT / "scout.urdf").write_text("\n".join(out) + "\n")


if __name__ == "__main__":
    main()
