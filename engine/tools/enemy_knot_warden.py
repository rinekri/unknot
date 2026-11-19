"""Knot Warden boss (enemies.js kind 'boss', R3): a stacked totem guardian, ~3.7 m, carved mask head with a stone crown, two heavy
stone arms, stumpy pillar legs; bound by three gold knot cords (hips, chest, neck) that the player unbinds one per phase.
Run (from repo root):
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/enemy_knot_warden.py -- assets/characters/knot_warden/knot_warden.glb
Axes as npc_lib: faces -Y here (+Z in glTF), origin = ground under the hips. Every stone is rigid on one bone.
Nodes: knot_warden_body (all stone, skinned) + cord_1 / cord_2 / cord_3 (separate skinned meshes, gold "rope": code hides cord_n
after the unbind_n clip, the clips themselves key every cord in place).
Bones (up, roll 0): root > hips > chest > head, arm_l > fore_l, arm_r > fore_r; hips > leg_l, leg_r, cord_1; chest > cord_2, cord_3.
Clips: idle (2 s loop), chase (1.5 s loop, in place, stride 1.6 m), ram_telegraph (0.9 s once = BOSS.tele), ram (0.5 s loop),
recover (1.5 s once), slam (1.5 s once, two-fist overhead slam, event impact), ring_cast (2.4 s loop = BOSS.ringEvery: ground pound,
event ring), stagger (1 s once, ends dazed), dazed (2 s loop, the unbind window), unbind_1 / unbind_2 (2.5 s once: cord n loosens,
slides down and drops, the guardian shudders and rises back to idle), unbind_final (4 s once: cord_3 slips, it sinks to its knees
and bows, mask to the ground; stays a ruin).
Materials: stone (vertex coloured), rope (gold #e9b85a: the cords are the song target), eyes (dark; code may light them)."""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(__file__))
import npc_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
L.reset()
STONE, DARK, MOSS, LIGHT = L.lin("#8a8379"), L.lin("#4a453f"), L.lin("#7f8f5a"), L.lin("#c9bda8")
GOLD, GOLD_D = L.lin("#f2c66a"), L.lin("#c9953f")
st = L.material("stone", vcol=True)
rope = L.material("rope", vcol=True)
eyes = L.material("eyes", "#2a2622")
WHITE = lambda co, n: (1, 1, 1)


def col(seed, moss=0.5):
    def f(co, n):
        k = 0.5 + 0.5 * math.sin(co.x * 3.1 + co.y * 2.3 + seed) * math.cos(co.z * 3.7 - seed)
        c = L.mix(DARK, STONE, 0.45 + 0.55 * min(1, co.z / 2.6 + 0.1))
        c = L.mix(c, LIGHT, 0.25 * k)
        if n.z > moss: c = L.mix(c, MOSS, min(1, (n.z - moss) * 2.2) * (0.35 + 0.45 * k))
        return c
    return f


parts = []
P = lambda nm, bm, g, m=st, c=None: parts.append(L.part(nm, bm, m, c or col(len(parts)), g))
R = L.rock
# legs: short pillar stumps, broad flat feet
for s, bn in ((1, "leg_l"), (-1, "leg_r")):
    P(bn + "_thigh", R((0.3, 0.3, 0.34), (0.5 * s, 0.03, 0.62), seed=2 + s, rot=0.15 * s), bn)
    P(bn + "_foot", R((0.36, 0.44, 0.17), (0.53 * s, -0.08, 0.15), seed=5 + s, box=0.45, bottom=0.0, rot=-0.1 * s), bn)
# the totem stack: hip drum, belly block, chest block, shoulders, collar
P("hips", R((0.78, 0.6, 0.28), (0, 0.02, 1.1), seed=10, box=0.6, rough=0.06), "hips")
P("belly", R((0.74, 0.56, 0.38), (0, 0, 1.62), seed=11, sub=3, box=0.7, rough=0.05), "hips")
P("chest", R((0.92, 0.64, 0.4), (0, 0.03, 2.3), seed=12, sub=3, box=0.7, rough=0.05, tilt=(-0.06, 0)), "chest")
P("back", R((0.6, 0.16, 0.32), (0, 0.62, 2.35), seed=13, box=0.4, tilt=(0.2, 0)), "chest")
for s in (1, -1):
    P(f"shoulder{s}", R((0.36, 0.34, 0.3), (1.0 * s, 0.03, 2.6), seed=14 + s, rot=0.3 * s, tilt=(0.1, 0.25 * s)), "chest")
P("collar", R((0.44, 0.38, 0.12), (0, 0.02, 2.8), seed=17, box=0.6), "chest")
# mask head: a flat carved face, heavy brow, two round eye hollows, nose ridge, mouth slit; crown of leaning standing stones
P("head", R((0.5, 0.36, 0.36), (0, 0.0, 3.18), seed=20, sub=3, box=0.75, rough=0.04), "head")
P("face", R((0.44, 0.07, 0.32), (0, -0.33, 3.16), seed=21, box=0.8, rough=0.02), "head", c=lambda co, n: L.mix(LIGHT, STONE, 0.35))
P("brow", R((0.46, 0.09, 0.065), (0, -0.37, 3.35), seed=22, box=0.5, tilt=(0.2, 0)), "head")
P("nose", R((0.06, 0.08, 0.13), (0, -0.42, 3.15), seed=23, sub=1, box=0.6), "head")
for s in (1, -1):
    P(f"eye{s}", R((0.095, 0.035, 0.095), (0.2 * s, -0.39, 3.22), seed=24 + s, sub=2, box=0.05, rough=0.0), "head", m=eyes, c=WHITE)
    P(f"cheek{s}", R((0.1, 0.06, 0.07), (0.3 * s, -0.37, 3.04), seed=26 + s, sub=1), "head")
P("mouth", R((0.2, 0.03, 0.035), (0, -0.4, 2.98), seed=28, sub=1, box=0.8, rough=0.0), "head", m=eyes, c=WHITE)
for i, (x, h, lean) in enumerate(((-0.34, 0.26, -0.35), (-0.17, 0.34, -0.15), (0, 0.42, 0), (0.17, 0.34, 0.15), (0.34, 0.26, 0.35))):
    bm = R((0.09, 0.08, h / 2), (0, 0, h / 2), seed=30 + i, sub=1, box=0.5, rough=0.08)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((x, 0.06, 3.46)) @ Matrix.Rotation(lean, 4, "Y"), verts=bm.verts)
    P(f"crown{i}", bm, "head")
# arms: upper, fore, big fist hanging at mid-thigh
for s, a, f in ((1, "arm_l", "fore_l"), (-1, "arm_r", "fore_r")):
    P(a + "_upper", R((0.27, 0.27, 0.36), (1.12 * s, 0.0, 2.2), seed=40 + s, rot=0.3 * s), a)
    P(f + "_fore", R((0.25, 0.26, 0.34), (1.18 * s, -0.06, 1.58), seed=43 + s, rot=-0.2 * s), f)
    P(f + "_fist", R((0.36, 0.36, 0.3), (1.2 * s, -0.12, 1.02), seed=46 + s, box=0.45), f)
body = L.join(parts, "knot_warden_body")


def cord(name, z, rx, ry, seed):
    """A gold rope ring hugging the stack at height z: wobbling torus (smooth gold tube), a knot lump at the front,
    two short tails hanging from the knot."""
    bm = bmesh.new()
    NU, NV, r = 36, 10, 0.085
    rings = []
    for i in range(NU):
        a = 2 * math.pi * i / NU
        c = Vector((math.sin(a) * rx, -math.cos(a) * ry, z + 0.04 * math.sin(3 * a + seed)))
        t = Vector((math.cos(a) * rx, math.sin(a) * ry, 0)).normalized(); nx = Vector((0, 0, 1)).cross(t).normalized(); nz = t.cross(nx)
        rings.append([bm.verts.new(c + (nx * math.cos(2 * math.pi * j / NV) + nz * math.sin(2 * math.pi * j / NV)) * r)
                      for j in range(NV)])
    for i in range(NU):
        for j in range(NV):
            bm.faces.new((rings[i][j], rings[(i + 1) % NU][j], rings[(i + 1) % NU][(j + 1) % NV], rings[i][(j + 1) % NV]))
    knot = []
    for k, (dx, dz, sz) in enumerate(((0, 0, 0.17), (-0.12, -0.06, 0.11), (0.12, 0.05, 0.11))):
        knot.append(R((sz, sz * 0.8, sz * 0.9), (dx, -ry - 0.09, z + dz), seed=seed * 7 + k, sub=1, box=0.3, rough=0.15))
    for s in (1, -1):  # tails: thin twisted strips hanging down from the knot
        tb = R((0.05, 0.04, 0.2), (0.07 * s, -ry - 0.12, z - 0.27), seed=seed * 5 + s, sub=1, box=0.2, rough=0.05, tilt=(0, 0.25 * s))
        knot.append(tb)
    for kb in knot:
        me = bpy.data.meshes.new("tmp"); kb.to_mesh(me); kb.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    bm.normal_update()
    o = L.part(name, bm, rope, lambda co, n: L.mix(GOLD_D, GOLD, 0.6 + 0.4 * max(0, n.z)), name, smooth=80)
    return o


cords = [cord("cord_1", 1.62, 0.84, 0.66, 1), cord("cord_2", 2.42, 1.02, 0.76, 2), cord("cord_3", 2.84, 0.5, 0.44, 3)]
U = 0.3
arm = L.armature("knot_warden", [
    ("root", (0, 0, 0), (0, 0, U), None),
    ("hips", (0, 0.02, 0.95), (0, 0.02, 0.95 + U), "root"),
    ("chest", (0, 0.03, 2.0), (0, 0.03, 2.0 + U), "hips"),
    ("head", (0, 0.0, 2.85), (0, 0.0, 2.85 + U), "chest"),
    ("arm_l", (1.02, 0.0, 2.62), (1.02, 0.0, 2.62 + U), "chest"), ("fore_l", (1.15, -0.04, 1.9), (1.15, -0.04, 1.9 + U), "arm_l"),
    ("arm_r", (-1.02, 0.0, 2.62), (-1.02, 0.0, 2.62 + U), "chest"), ("fore_r", (-1.15, -0.04, 1.9), (-1.15, -0.04, 1.9 + U), "arm_r"),
    ("leg_l", (0.5, 0.03, 0.9), (0.5, 0.03, 0.9 + U), "hips"), ("leg_r", (-0.5, 0.03, 0.9), (-0.5, 0.03, 0.9 + U), "hips"),
    ("cord_1", (0, 0, 1.62), (0, 0, 1.62 + U), "hips"), ("cord_2", (0, 0, 2.42), (0, 0, 2.42 + U), "chest"),
    ("cord_3", (0, 0, 2.84), (0, 0, 2.84 + U), "chest")])
for o in [body] + cords: L.skin(o, arm)

S = lambda t, k=1, ph=0: math.sin(2 * math.pi * (k * t + ph))
ease = lambda u: (lambda v: v * v * (3 - 2 * v))(max(0.0, min(1.0, u)))


def blend(a, b, w):
    out = {}
    for k in set(a) | set(b):
        ra, la, sa = a.get(k, ((0, 0, 0), None, None)); rb, lb, sb = b.get(k, ((0, 0, 0), None, None))
        la, lb = la or (0, 0, 0), lb or (0, 0, 0)
        sa, sb = sa or 1, sb or 1
        out[k] = (tuple(x + (y - x) * w for x, y in zip(ra, rb)), tuple(x + (y - x) * w for x, y in zip(la, lb)), sa + (sb - sa) * w)
    return out


def idle(t):  # slow heavy breath: the stack sways, head turns, cords swing a little behind
    p = {"hips": ((0, 0, 0), (0, -0.02 * (1 - math.cos(2 * math.pi * t)) / 2, 0), None),
         "chest": ((3 + 2 * S(t), 0, 2 * S(t, 1, 0.25)), None, None), "head": ((-2 + 3 * S(t, 1, 0.15), 8 * S(t, 1, 0.3), 0), None, None)}
    for s, a, f in ((1, "arm_l", "fore_l"), (-1, "arm_r", "fore_r")):
        p[a] = ((-2 * S(t, 1, 0.1), 0, 4 * s + 2 * s * S(t, 1, 0.2)), None, None)
        p[f] = ((-6 - 3 * S(t, 1, 0.3), 0, 0), None, None)
    for i in (1, 2, 3): p[f"cord_{i}"] = ((1.5 * S(t, 1, 0.2 * i), 0, 1.5 * S(t, 1, 0.1 * i + 0.25)), None, None)
    return p


def chase(t):  # stomping waddle: the whole stack rocks side to side onto each planted foot
    p = idle(t)
    p["root"] = ((0, 0, 6 * S(t)), None, None)
    p["hips"] = ((0, 0, 0), (0, -0.04 + 0.06 * abs(S(t, 2, 0.25)), 0), None)
    p["chest"] = ((8 + 2 * S(t, 2), 5 * S(t), -3 * S(t)), None, None)
    for s, bn, ph in ((1, "leg_l", 0.0), (-1, "leg_r", 0.5)):
        sw = S(t, 1, ph)
        p[bn] = ((-24 * sw, 0, 0), (0, 0.16 * max(0.0, S(t, 1, ph + 0.25)) + 0.36 * abs(math.sin(math.radians(24 * sw))), 0), None)
    for s, a, f, ph in ((1, "arm_l", "fore_l", 0.5), (-1, "arm_r", "fore_r", 0.0)):
        p[a] = ((-16 * S(t, 1, ph), 0, 8 * s), None, None)
        p[f] = ((-14 - 8 * S(t, 1, ph + 0.1), 0, 0), None, None)
    return p


def telegraph(t):  # rears back, fists drawn back and out, shudders, then drops the shoulders
    u = ease(t / 0.55); sh = math.sin(math.pi * min(1, t / 0.9)) * S(t, 10)
    p = idle(0)
    p["hips"] = ((0, 0, 0), (0, -0.1 * u, 0), None)
    p["chest"] = ((3 - 18 * u + 28 * ease((t - 0.65) / 0.35) + 2 * sh, 0, 2 * sh), None, None)
    p["head"] = ((-10 * u + 16 * ease((t - 0.65) / 0.35), 0, 0), None, None)
    p["root"] = ((0, 0, 2 * sh), (0.03 * sh, 0, 0), None)
    for s, a, f in ((1, "arm_l", "fore_l"), (-1, "arm_r", "fore_r")):
        p[a] = ((45 * u, 0, 18 * s * u), None, None)
        p[f] = ((-30 * u, 0, 0), None, None)
    for s, bn in ((1, "leg_l"), (-1, "leg_r")): p[bn] = ((-12 * u * s, 0, 0), (0, 0.45 * math.sin(math.radians(12 * u)), 0), None)
    return p


def ram(t):  # shoulders-first charge, head tucked, legs churning
    p = idle(t)
    p["hips"] = ((0, 0, 0), (0, -0.08 + 0.06 * abs(S(t, 2)), 0), None)
    p["chest"] = ((28 + 3 * S(t, 2), 0, 0), None, None); p["head"] = ((14, 0, 0), None, None)
    p["root"] = ((0, 0, 3 * S(t)), None, None)
    for s, bn, ph in ((1, "leg_l", 0.0), (-1, "leg_r", 0.5)):
        p[bn] = ((-30 * S(t, 1, ph), 0, 0), (0, 0.18 * max(0, S(t, 1, ph + 0.25)) + 0.36 * abs(math.sin(math.radians(30 * S(t, 1, ph)))), 0), None)
    for s, a, f in ((1, "arm_l", "fore_l"), (-1, "arm_r", "fore_r")):
        p[a] = ((50 + 5 * S(t, 2), 0, 12 * s), None, None); p[f] = ((-25, 0, 0), None, None)
    for i in (1, 2, 3): p[f"cord_{i}"] = ((-8, 0, 0), None, None)  # trailing in the rush
    return p


def recover(t):  # pulls out of the charge, shakes the head, settles to idle
    k = 1 - ease(t / 0.8)
    p = blend(idle(t), ram(0), k * 0.8)
    r, l, s = p["head"]; p["head"] = ((r[0], r[1] + 14 * S(t, 2.5) * math.sin(math.pi * min(1, t / 0.7)), r[2]), l, s)
    return p


def overhead(u, d, reach=(0, 0, 0)):
    """u: wind-up 0..1 (fists overhead), d: smash 0..1 (bent over, fists on the ground in front). reach = tuning (root, chest, arm)."""
    p = idle(0); e = u * (1 - d)
    p["root"] = ((RT * d, 0, 0), (0, 0, 0), None)
    p["hips"] = ((0, 0, 0), (0, -0.06 * e - HD * d, 0), None)
    p["chest"] = ((3 - 14 * e + CL * d, 0, 0), None, None)
    p["head"] = ((-12 * e + 6 * d, 0, 0), None, None)
    for s, a, f in ((1, "arm_l", "fore_l"), (-1, "arm_r", "fore_r")):
        p[a] = ((-165 * e + AR * d, 0, (6 - 4 * e) * s), None, None)
        p[f] = ((-20 * e - 6 * d, 0, -8 * s * e), None, None)
    for s, bn in ((1, "leg_l"), (-1, "leg_r")): p[bn] = ((-RT * d, 0, -6 * s * d), None, None)
    for i in (1, 2, 3): p[f"cord_{i}"] = ((6 * e - 8 * d, 0, 0), (0, 0.02 * e, 0), None)
    return p


RT, HD, CL, AR = 10, 0.3, 38, -55  # smash pose: whole-body pitch, hip drop, chest lean, arm angle (fists to the ground)


def slam(t):  # 0-0.45 raise both fists, 0.45-0.55 smash, hold/shudder, 0.75-1 rise back
    back = 1 - ease((t - 0.75) / 0.25)
    p = overhead(ease(t / 0.45) * back, ease((t - 0.45) / 0.1) * back)
    if 0.55 < t < 0.75:
        sh = S(t, 12) * (1 - (t - 0.55) / 0.2)
        r, l, s = p["chest"]; p["chest"] = ((r[0] + 2 * sh, r[1], r[2] + 1.5 * sh), l, s)
    return p


def ring_cast(t):  # loop: rise onto the toes with arms spread, then pound the ground (ring spawns at the impact, t=0.5)
    up = ease(t / 0.42) * (1 - ease((t - 0.45) / 0.06))
    d = ease((t - 0.44) / 0.06) * (1 - ease((t - 0.7) / 0.3))
    p = overhead(up, d)
    p["root"] = ((0, 0, 0), (0, 0.12 * up, 0), None)
    for s, a in ((1, "arm_l"), (-1, "arm_r")):
        r, l, sc = p[a]; p[a] = ((r[0], r[1], r[2] + 30 * s * up), l, sc)  # spread wide on the rise
    return p


def DAZE(t):
    return {"hips": ((0, 0, 0), (0, -0.16, 0), None), "chest": ((14 + 2 * S(t), 6 * S(t), 4 * S(t, 1, 0.25)), None, None),
            "head": ((18 + 4 * S(t, 1, 0.2), -10 * S(t), 6 * S(t, 1, 0.3)), None, None),
            "arm_l": ((12, 0, 4 + 2 * S(t)), None, None), "arm_r": ((16, 0, -6 - 2 * S(t, 1, 0.3)), None, None),
            "fore_l": ((-8, 0, 0), None, None), "fore_r": ((-12, 0, 0), None, None),
            "leg_l": ((-6, 0, -5), (0, 0.07, 0), None), "leg_r": ((8, 0, 5), (0, 0.07, 0), None),
            "cord_1": ((2 * S(t, 1, 0.1), 0, 0), None, None), "cord_2": ((2 * S(t, 1, 0.3), 0, 0), None, None),
            "cord_3": ((-3 * S(t, 1, 0.5), 0, 0), None, None)}


def stagger(t):  # knocked back, totters, sags into the daze
    k = math.sin(math.pi * min(1, t / 0.35))
    hit = {"chest": ((-20, 6, -5), None, None), "head": ((-18, 8, 0), None, None), "root": ((0, 0, 0), (0, 0, 0.18), None),
           "arm_l": ((-35, 0, 25), None, None), "arm_r": ((-30, 0, -25), None, None), "hips": ((0, 0, 0), (0, -0.05, 0), None)}
    return blend(blend(idle(0), hit, k), DAZE(0), ease((t - 0.3) / 0.7))


# a cord loosens (scale up, wobble), slides straight down the stack and lies on the ground as a flattened slack loop.
# cord_2/3 hang off the (leaning) chest: their drop is solved in the chest's frame from the pose itself (p) so they land level.
CZ = {1: 1.62, 2: 2.42, 3: 2.84}


def slip(n, t, p, s=1):
    loose = ease(t / 0.25); fall = ease((t - 0.25) / 0.4) ** 1.6
    wob = S(t, 6) * (1 - ease((t - 0.25) / 0.3)) * min(1, t / 0.1)
    hy = p["hips"][1][1] if p.get("hips") and p["hips"][1] else 0
    th = 0 if n == 1 else p["chest"][0][0]
    rad = math.radians(th)
    D = (CZ[1] + hy if n == 1 else 2.0 + hy + (CZ[n] - 2.0) * math.cos(rad)) - 0.1
    k = 1 + 0.18 * loose + 0.22 * fall
    return ((-th * fall + 10 * wob, 0, 8 * wob * (1 - fall)), (0, -D * math.cos(rad) * fall, s * D * math.sin(rad) * fall),
            (k, (1 + 0.18 * loose) * (1 - 0.7 * fall), k))


def unbind(n):
    def f(t):  # from the daze: the cord slips off (0-0.65), the guardian shudders free and rises back to idle (0.65-1)
        p = blend(DAZE(0), idle(0), ease((t - 0.62) / 0.38))
        sh = S(t, 9) * math.sin(math.pi * min(1, max(0, (t - 0.3) / 0.45)))
        r, l, s = p["chest"]; p["chest"] = ((r[0] - 6 * sh, r[1] + 3 * sh, r[2]), l, s)
        for i in range(1, n + 1): p[f"cord_{i}"] = slip(i, t if i == n else 1.0, p)  # earlier cords already lie there (hidden by code)
        return p
    return f


KNEEL = {"root": ((0, 0, 0), (0, 0, 0), None), "hips": ((0, 0, 0), (0, -0.42, 0), None),
         "leg_l": ((0, 0, 72), (0, -0.02, 0), None), "leg_r": ((0, 0, -72), (0, -0.02, 0), None),
         "chest": ((34, 0, 0), None, None), "head": ((42, 0, 0), None, None),
         "arm_l": ((-22, 0, 16), None, None), "arm_r": ((-18, 0, -18), None, None),
         "fore_l": ((-24, 0, 0), None, None), "fore_r": ((-30, 0, 0), None, None)}


def unbind_final(t):  # last cord slips, a long shudder, then it sinks to its knees and bows, fists on the ground
    w = ease((t - 0.45) / 0.45)
    p = blend(DAZE(0), KNEEL, w)
    sh = S(t, 11) * math.sin(math.pi * min(1, t / 0.5)) * (1 - w)
    r, l, s = p["chest"]; p["chest"] = ((r[0] + 3 * sh, r[1] + 4 * sh, r[2]), l, s)
    for i in (1, 2, 3): p[f"cord_{i}"] = slip(i, min(1, t / 0.55) if i == 3 else 1.0, p)
    return p


def grounded(fn, k=lambda t: 1.0):
    def g(t):
        p = fn(t); hy = (p.get("hips", ((0, 0, 0), None, None))[1] or (0, 0, 0))[1] * k(t)
        for b in ("leg_l", "leg_r"):
            r, l, sc = p.get(b, ((0, 0, 0), None, None)); l = l or (0, 0, 0)
            p[b] = (r, (l[0], l[1] - hy, l[2]), sc)
        return p
    return g


G = grounded  # applied once to each final pose (composition stays on the raw poses)
L.clip(arm, "idle", 48, G(idle))
L.clip(arm, "chase", 36, G(chase))
L.clip(arm, "ram_telegraph", 22, G(telegraph), loop=False)
L.clip(arm, "ram", 12, G(ram))
L.clip(arm, "recover", 36, G(recover), loop=False)
L.clip(arm, "slam", 36, G(slam), loop=False)
L.clip(arm, "ring_cast", 58, G(ring_cast))
L.clip(arm, "stagger", 24, G(stagger), loop=False)
L.clip(arm, "dazed", 48, G(DAZE))
L.clip(arm, "unbind_1", 60, G(unbind(1)), loop=False)
L.clip(arm, "unbind_2", 60, G(unbind(2)), loop=False)
L.clip(arm, "unbind_final", 96, G(unbind_final, lambda t: 1 - ease((t - 0.45) / 0.45)), loop=False)  # the kneel sinks on purpose
bpy.context.scene["events"] = {"chase": {"step_l": 0.25, "step_r": 0.75}, "slam": {"impact": 0.52}, "ring_cast": {"ring": 0.5},
                               "unbind_1": {"cord_off": 0.65}, "unbind_2": {"cord_off": 0.65}, "unbind_final": {"cord_off": 0.36, "land": 0.9}}
bpy.context.scene["stride"] = {"chase": 1.6}
L.export(OUT)
