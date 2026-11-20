"""AR models for phones: the scout rover and the family watch as .glb files.

Run:  python3 tools/ar_models.py        (needs numpy, pygltflib and Pillow)

Reads what the CAD scripts already wrote, and writes into twin/ar/:
  scout.glb   the rover at real size, its link tree kept, with the wheels, lidar and head moving
  watch.glb   the watch at real size, with a picture of its home screen on the display

Both are in metres with Y up, the way glTF and phone AR viewers expect. The CAD stays the
source: change robot/cad/scout.py or firmware/watch/cad/watch.py, run them, then run this.
"""
import io
import json
import math
import pathlib
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from pygltflib import (GLTF2, Accessor, Animation, AnimationChannel, AnimationChannelTarget, AnimationSampler, Asset, Buffer,
                       BufferView, Image as GImage, Material, Mesh, Node, PbrMetallicRoughness, Primitive, Sampler, Scene,
                       Texture, TextureInfo)

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "twin" / "ar"
FINISH = {"paint": (0.15, 0.5), "metal": (0.85, 0.35), "plastic": (0.0, 0.6), "rubber": (0.0, 0.92),
          "carbon": (0.3, 0.36), "glass": (0.6, 0.08), "glow": (0.0, 0.4)}
CREASE = math.cos(math.radians(32))


def read_stl(path):
    data = path.read_bytes()
    n = struct.unpack_from("<I", data, 80)[0]
    rec = np.frombuffer(data, dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]), count=n, offset=84)
    tris = rec["v"].astype(np.float64)                              # (n, 3, 3) in millimetres
    fn = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    ln = np.linalg.norm(fn, axis=1, keepdims=True)
    keep = ln[:, 0] > 1e-12
    tris, fn = tris[keep], fn[keep] / ln[keep]
    # creased normals: average the face normals around a corner, but only across edges flatter than 32 degrees
    pos = tris.reshape(-1, 3)
    face = np.repeat(np.arange(len(tris)), 3)
    key = np.round(pos * 1000).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.reshape(-1)
    order = np.argsort(inv, kind="stable")
    normals = np.zeros_like(pos)
    starts = np.flatnonzero(np.r_[True, inv[order][1:] != inv[order][:-1]])
    ends = np.r_[starts[1:], len(order)]
    for s, e in zip(starts, ends):
        idx = order[s:e]
        fns = fn[face[idx]]
        sim = fns @ fns.T >= CREASE
        acc = sim.astype(np.float64) @ fns
        acc /= np.linalg.norm(acc, axis=1, keepdims=True)
        normals[idx] = acc
    return pos.astype(np.float32), normals.astype(np.float32)


def quat_axis(axis, ang):
    a = np.asarray(axis, float)
    a = a / np.linalg.norm(a)
    s = math.sin(ang / 2)
    return [a[0] * s, a[1] * s, a[2] * s, math.cos(ang / 2)]


class Builder:
    def __init__(self):
        self.g = GLTF2(asset=Asset(generator="hollow-twin tools/ar_models.py", version="2.0"))
        self.blob = bytearray()
        self.mats = {}

    def view(self, data, target=None):
        while len(self.blob) % 4:
            self.blob += b"\0"
        off = len(self.blob)
        self.blob += data
        self.g.bufferViews.append(BufferView(buffer=0, byteOffset=off, byteLength=len(data), target=target))
        return len(self.g.bufferViews) - 1

    def accessor(self, arr, typ, minmax=False, target=34962):
        arr = np.ascontiguousarray(arr, dtype=np.float32)
        v = self.view(arr.tobytes(), target)
        kw = {}
        if minmax:
            kw = dict(min=arr.min(axis=0).tolist(), max=arr.max(axis=0).tolist())
        self.g.accessors.append(Accessor(bufferView=v, componentType=5126, count=len(arr), type=typ, **kw))
        return len(self.g.accessors) - 1

    def material(self, color, finish, texture=None):
        k = (color, finish, texture)
        if k in self.mats:
            return self.mats[k]
        r, g, b = (int(color[i:i + 2], 16) / 255 for i in (1, 3, 5))
        lin = [c ** 2.2 for c in (r, g, b)]
        metal, rough = FINISH.get(finish, FINISH["plastic"])
        pbr = PbrMetallicRoughness(baseColorFactor=[*lin, 1.0], metallicFactor=metal, roughnessFactor=rough)
        m = Material(pbrMetallicRoughness=pbr, doubleSided=False)
        if texture is not None:
            pbr.baseColorFactor = [1, 1, 1, 1]
            pbr.baseColorTexture = TextureInfo(index=texture)
            m.emissiveTexture = TextureInfo(index=texture)
            m.emissiveFactor = [0.9, 0.9, 0.9]
        if finish == "glow":
            m.emissiveFactor = [c * 0.35 for c in lin]
        if finish == "glass" and texture is None and color.lower() in ("#0e1a24",):
            pbr.baseColorFactor = [*lin, 0.35]
            m.alphaMode = "BLEND"
        self.g.materials.append(m)
        self.mats[k] = len(self.g.materials) - 1
        return self.mats[k]

    def mesh(self, pos, nrm, mat, uv=None):
        attrs = dict(POSITION=self.accessor(pos, "VEC3", minmax=True), NORMAL=self.accessor(nrm, "VEC3"))
        if uv is not None:
            attrs["TEXCOORD_0"] = self.accessor(uv, "VEC2")
        self.g.meshes.append(Mesh(primitives=[Primitive(attributes=attrs, material=mat)]))
        return len(self.g.meshes) - 1

    def node(self, **kw):
        self.g.nodes.append(Node(**kw))
        return len(self.g.nodes) - 1

    def texture_png(self, png):
        v = self.view(png)
        self.g.images.append(GImage(bufferView=v, mimeType="image/png"))
        self.g.samplers.append(Sampler(magFilter=9729, minFilter=9987))
        self.g.textures.append(Texture(source=len(self.g.images) - 1, sampler=len(self.g.samplers) - 1))
        return len(self.g.textures) - 1

    def save(self, path, root_children):
        root = self.node(name="ar_root", rotation=quat_axis([1, 0, 0], -math.pi / 2), scale=[0.001] * 3, children=root_children)
        self.g.scenes.append(Scene(nodes=[root]))
        self.g.scene = 0
        self.g.buffers.append(Buffer(byteLength=len(self.blob)))
        self.g.set_binary_blob(bytes(self.blob))
        self.g.save_binary(str(path))
        print(f"{path.relative_to(ROOT)}: {path.stat().st_size / 1e6:.1f} MB, {len(self.g.meshes)} meshes, {len(self.g.animations)} animation(s)")


def parts_into(b, spec, base, link_nodes, extra=None):
    cache = {}
    for p in spec["parts"]:
        if p["mesh"] not in cache:
            cache[p["mesh"]] = read_stl(base / p["mesh"])
        pos, nrm = cache[p["mesh"]]
        mi = b.mesh(pos, nrm, b.material(p["color"], p["finish"]))
        rot = quat_axis([0, 0, 1], math.radians(p["yaw"])) if p["yaw"] else None
        n = b.node(name=pathlib.Path(p["mesh"]).stem, mesh=mi, translation=list(map(float, p["xyz"])), **({"rotation": rot} if rot else {}))
        link_nodes[p["link"]].children.append(n)


def scout():
    base = ROOT / "twin" / "scout" / "cad"
    spec = json.loads((base / "scout.json").read_text())
    b = Builder()
    nodes, idx = {}, {}
    for name, L in spec["links"].items():
        idx[name] = b.node(name=name, translation=list(map(float, L["origin"])), children=[])
        nodes[name] = b.g.nodes[idx[name]]
    for name, L in spec["links"].items():
        if L["parent"]:
            nodes[L["parent"]].children.append(idx[name])
    parts_into(b, spec, base, nodes)

    # a 6 second loop: drive forward (wheels turn), the lidar spins, the head looks left and right
    T = 6.0
    times = np.linspace(0, T, 49).astype(np.float32)
    t_acc = b.accessor(times.reshape(-1, 1), "SCALAR", minmax=True, target=None)
    samplers, channels = [], []

    def track(link, axis, angles):
        q = np.array([quat_axis(axis, a) for a in angles], dtype=np.float32)
        for i in range(1, len(q)):                       # keep neighbouring keys on the same side for smooth slerp
            if np.dot(q[i], q[i - 1]) < 0:
                q[i] = -q[i]
        acc = b.accessor(q, "VEC4", target=None)
        samplers.append(AnimationSampler(input=t_acc, output=acc, interpolation="LINEAR"))
        channels.append(AnimationChannel(sampler=len(samplers) - 1, target=AnimationChannelTarget(node=idx[link], path="rotation")))

    turns = 0.3 * T / (2 * math.pi * spec["drive"]["wheel_radius_m"])   # 0.3 m/s
    for j in ("FL", "ML", "RL", "FR", "MR", "RR"):
        track(f"wheel_{j}", [0, 1, 0], [2 * math.pi * turns * t / T for t in times])
    track("lidar", [0, 0, 1], [2 * math.pi * 6 * t / T for t in times])
    track("pan", [0, 0, 1], [math.radians(40) * math.sin(2 * math.pi * t / T) for t in times])
    b.g.animations.append(Animation(name="patrol", samplers=samplers, channels=channels))
    b.save(OUT / "scout.glb", [idx["base"]])


def face_png(size=1024):
    """The watch's home screen, drawn flat, for the display in AR."""
    s = size
    im = Image.new("RGB", (s, s), (13, 17, 23))
    d = ImageDraw.Draw(im)

    def font(px, bold=True):
        for f in ("DejaVuSans-Bold.ttf" if bold else "DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"):
            try:
                return ImageFont.truetype(f, px)
            except OSError:
                pass
        return ImageFont.load_default()

    def centred(y, text, f, fill):
        w = d.textlength(text, font=f)
        d.text(((s - w) / 2, y), text, font=f, fill=fill)

    centred(s * 0.19, "12:00", font(int(s * 0.075)), (230, 237, 243))
    centred(s * 0.285, "L7 · CHALK CUT · MAYA", font(int(s * 0.03), False), (139, 148, 158))
    r = s * 0.16
    d.ellipse([s / 2 - r - 16, s * 0.47 - r - 16, s / 2 + r + 16, s * 0.47 + r + 16], fill=(25, 60, 35))
    d.ellipse([s / 2 - r, s * 0.47 - r, s / 2 + r, s * 0.47 + r], fill=(46, 160, 67))
    centred(s * 0.47 - s * 0.04, "I'M OK", font(int(s * 0.07)), (255, 255, 255))
    w, h = s * 0.25, s * 0.06
    d.rounded_rectangle([s / 2 - w / 2, s * 0.67, s / 2 + w / 2, s * 0.67 + h], radius=h / 2, outline=(218, 54, 51), width=4, fill=(60, 20, 20))
    centred(s * 0.677, "NEED HELP", font(int(s * 0.032)), (255, 180, 173))
    centred(s * 0.77, "Tap to tell your family you're safe.", font(int(s * 0.027), False), (139, 148, 158))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, s, s], fill=255)
    out = Image.new("RGB", (s, s), (5, 6, 7))
    out.paste(im, (0, 0), mask)
    buf = io.BytesIO()
    out.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def watch():
    base = ROOT / "twin" / "watch" / "device" / "cad"
    spec = json.loads((base / "watch.json").read_text())
    b = Builder()
    w = b.node(name="watch", children=[])
    parts_into(b, spec, base, {"watch": b.g.nodes[w]})
    # the screen: a disc with the home screen on it, just above the display module
    S, R, n = spec["size"], spec["size"]["active_r"], 96
    ang = np.linspace(0, 2 * math.pi, n + 1)
    pos, uv = [], []
    for i in range(n):
        for a in (None, ang[i], ang[i + 1]):
            x, y = (0.0, 0.0) if a is None else (R * math.cos(a), R * math.sin(a))
            pos.append([x, y, S["screen_z"] + 0.08])
            uv.append([0.5 + x / (2 * R), 0.5 - y / (2 * R)])
    pos = np.array(pos, np.float32)
    nrm = np.tile(np.array([0, 0, 1], np.float32), (len(pos), 1))
    tex = b.texture_png(face_png())
    mi = b.mesh(pos, nrm, b.material("#ffffff", "plastic", texture=tex), uv=np.array(uv, np.float32))
    b.g.nodes[w].children.append(b.node(name="screen", mesh=mi))
    b.save(OUT / "watch.glb", [w])


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    scout()
    watch()
