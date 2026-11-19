"""Stone Warden (enemies.js kind 'warden', R3): a hunched rubble golem, ~1.9 m, knuckle-walker, a foreign (cold teal) rune in its chest.
Run (from repo root):
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/enemy_stone_warden.py -- assets/characters/stone_warden/stone_warden.glb
Axes as npc_lib: faces -Y here (+Z in glTF), origin = ground under the hips. Every stone is rigid on one bone (no stretch, no tearing).
Bones (all point up, roll 0: +X rot = top tips forward, a hanging limb swings back): root > hips > chest > head, arm_l > fore_l, arm_r >
fore_r; hips > leg_l, leg_r. Clips: idle (2 s loop), patrol_walk (1.25 s loop, in place, stride 1.0 m), ram_telegraph (0.8 s once =
WD.tele: rear back + shake), ram (0.5 s loop: head-down charge), flinch (0.35 s once), stagger (1 s once, ends in the dazed pose),
dazed (2 s loop), unbind (2.5 s once: crumbles into a low flat rubble step, chest face-up with the rune on top, ~0.55 m high).
Materials: stone (vertex coloured), rune_foreign (cold teal, emissive; code pulses it on the telegraph and fades it on unbind),
eyes (dark; code may light them), socket (dark stone behind the rune)."""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(__file__))
import npc_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
L.reset()
STONE, DARK, MOSS, LIGHT, VEIN = L.lin("#8e8a82"), L.lin("#4f4b46"), L.lin("#7f8f5a"), L.lin("#bdb5a5"), L.lin("#5d8f88")
RUNE_C = (0.0, -0.45, 1.06)  # where the rune sits (vein tint radiates from here)
st = L.material("stone", vcol=True)
rune = L.material("rune_foreign", "#9fe0d2", emit=("#7fd8c8", 1.6))
eyes = L.material("eyes", "#2e2a26")
sock = L.material("socket", "#3e3a35")
WHITE = lambda co, n: (1, 1, 1)


def col(seed, moss=0.55):
    def f(co, n):
        k = 0.5 + 0.5 * math.sin(co.x * 3.7 + co.y * 2.9 + seed) * math.cos(co.z * 5.1 - seed)
        c = L.mix(DARK, STONE, 0.4 + 0.6 * min(1, co.z / 1.3 + 0.15))
        c = L.mix(c, LIGHT, 0.22 * k)
        if n.z > moss: c = L.mix(c, MOSS, min(1, (n.z - moss) * 2.4) * (0.3 + 0.45 * k))
        d = (co - Vector(RUNE_C)).length  # the foreign rune's cold seeping into the stone around it
        if d < 0.55: c = L.mix(c, VEIN, 0.45 * (1 - d / 0.55) * (0.5 + 0.5 * math.sin(co.x * 23 + co.z * 17)))
        return c
    return f


parts = []
P = lambda nm, bm, g, m=st, c=None: parts.append(L.part(nm, bm, m, c or col(len(parts)), g))
R = L.rock
# hips + legs (short, thick), feet flat on the ground
P("hips", R((0.42, 0.32, 0.25), (0, 0.08, 0.74), seed=1, box=0.5), "hips")
for s, bn in ((1, "leg_l"), (-1, "leg_r")):
    P(bn + "_thigh", R((0.21, 0.23, 0.27), (0.3 * s, 0.06, 0.44), seed=3 + s, rot=0.2 * s), bn)
    P(bn + "_foot", R((0.24, 0.31, 0.13), (0.33 * s, -0.06, 0.12), seed=6 + s, box=0.45, bottom=0.0, rot=-0.1 * s), bn)
# chest: a big hunched boulder, a flat back slab, belly stone, shoulder boulders
P("chest", R((0.6, 0.44, 0.42), (0, 0.06, 1.2), seed=10, box=0.5, tilt=(-0.18, 0)), "chest")
P("back", R((0.48, 0.13, 0.36), (0, 0.46, 1.32), seed=11, box=0.3, rough=0.06, tilt=(0.3, 0)), "chest")
P("belly", R((0.34, 0.2, 0.2), (0, -0.08, 0.86), seed=12), "chest")
for s in (1, -1):
    P(f"shoulder{s}", R((0.29, 0.27, 0.25), (0.56 * s, 0.04, 1.47), seed=13 + s, rot=0.4 * s, tilt=(0.2, 0.25 * s)), "chest")
P("hump", R((0.22, 0.2, 0.18), (0.12, 0.3, 1.66), seed=16, sub=1), "chest")
# head: small, low, thrust forward under the shoulders; brow ledge, eye slit
P("head", R((0.24, 0.23, 0.2), (0, -0.36, 1.56), seed=20, box=0.5), "head")
P("brow", R((0.27, 0.12, 0.08), (0, -0.5, 1.67), seed=21, box=0.4, tilt=(0.3, 0)), "head")
P("jaw", R((0.2, 0.17, 0.09), (0, -0.45, 1.41), seed=22, sub=1), "head")
for s in (1, -1):
    P(f"eye{s}", R((0.055, 0.03, 0.03), (0.1 * s, -0.58, 1.57), seed=23 + s, sub=1, box=0.9, rough=0.02), "head", m=eyes, c=WHITE)
# arms: upper, fore, heavy fist (knuckles near the ground)
for s, a, f in ((1, "arm_l", "fore_l"), (-1, "arm_r", "fore_r")):
    P(a + "_upper", R((0.19, 0.19, 0.28), (0.68 * s, -0.02, 1.18), seed=30 + s, rot=0.3 * s), a)
    P(f + "_fore", R((0.19, 0.2, 0.26), (0.72 * s, -0.12, 0.74), seed=33 + s, rot=-0.2 * s), f)
    P(f + "_fist", R((0.26, 0.27, 0.21), (0.74 * s, -0.2, 0.32), seed=36 + s, box=0.45), f)

# the foreign rune: a dark socket plate pressed into the chest front, an angular hooked glyph on it (not one of the Name glyphs)
bm = R((0.6, 0.44, 0.42), (0, 0.06, 1.2), seed=10, box=0.5, tilt=(-0.18, 0))  # same rock as "chest", rebuilt to ray-cast its surface
hit, nrm, _, _ = BVHTree.FromBMesh(bm).ray_cast(Vector((0, -2, 1.08)), Vector((0, 1, 0)))
bm.free()
z = nrm.normalized(); x = Vector((0, 0, 1)).cross(z).normalized(); y = z.cross(x)
M = Matrix((x, y, z)).transposed().to_4x4(); M.translation = hit
bm = R((0.21, 0.23, 0.035), (0, 0, 0), seed=40, sub=2, box=0.7, rough=0.04)
bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
P("socket", bm, "chest", m=sock, c=WHITE)
L.GLYPHS["foreign"] = [((-0.42, 0.42), (0.38, 0.5)), ((0.38, 0.5), (-0.28, -0.05)), ((-0.28, -0.05), (0.4, -0.5)), ((0.02, 0.48), (0.08, -0.3)),
                       ((-0.42, 0.42), (-0.46, 0.05))]
P("rune", L.glyph("foreign", 0.36, M @ Matrix.Translation((0, 0, 0.02)), width=0.2, depth=0.14), "chest", m=rune, c=WHITE)

body = L.join(parts, "stone_warden_body")
U = 0.25
arm = L.armature("stone_warden", [
    ("root", (0, 0, 0), (0, 0, U), None),
    ("hips", (0, 0.06, 0.74), (0, 0.06, 0.74 + U), "root"),
    ("chest", (0, 0.06, 0.95), (0, 0.06, 0.95 + U), "hips"),
    ("head", (0, -0.3, 1.45), (0, -0.3, 1.45 + U), "chest"),
    ("arm_l", (0.62, 0.0, 1.42), (0.62, 0.0, 1.42 + U), "chest"), ("fore_l", (0.7, -0.08, 0.95), (0.7, -0.08, 0.95 + U), "arm_l"),
    ("arm_r", (-0.62, 0.0, 1.42), (-0.62, 0.0, 1.42 + U), "chest"), ("fore_r", (-0.7, -0.08, 0.95), (-0.7, -0.08, 0.95 + U), "arm_r"),
    ("leg_l", (0.3, 0.06, 0.66), (0.3, 0.06, 0.66 + U), "hips"), ("leg_r", (-0.3, 0.06, 0.66), (-0.3, 0.06, 0.66 + U), "hips")])
L.skin(body, arm)

S = lambda t, k=1, ph=0: math.sin(2 * math.pi * (k * t + ph))
ease = lambda u: (lambda v: v * v * (3 - 2 * v))(max(0.0, min(1.0, u)))
HUNCH = 8  # chest leans forward at rest


def base(bob=0.0, lean=HUNCH, head=-6):
    return {"hips": ((0, 0, 0), (0, bob, 0), None), "chest": ((lean, 0, 0), None, None), "head": ((head, 0, 0), None, None)}


def idle(t):
    p = base(-0.015 * (1 - math.cos(2 * math.pi * t)) / 2, HUNCH + 2 * S(t), -6 + 3 * S(t, 1, 0.15))
    p["head"] = ((-6 + 3 * S(t, 1, 0.15), 10 * S(t * 0.5 + 0.0), 0), None, None)
    for s, a, f in ((1, "arm_l", "fore_l"), (-1, "arm_r", "fore_r")):
        p[a] = ((-2 * S(t, 1, 0.1), 0, 3 * s * S(t, 1, 0.2)), None, None)
        p[f] = ((-3 * S(t, 1, 0.3) - 4, 0, 0), None, None)
    return p


def walk(t):  # heavy lumber: the planted leg pushes back, the free one lifts and swings forward; arms counter-swing, knuckles brush
    p = base(-0.03 + 0.04 * abs(S(t, 2, 0.25)), HUNCH + 3, -8)
    p["hips"] = ((0, 0, 0), (0, p["hips"][1][1], 0), None)
    p["root"] = ((0, 0, 5 * S(t)), None, None)  # whole-body sway onto the planted foot
    p["chest"] = ((HUNCH + 3 + 2 * S(t, 2), 4 * S(t), -3 * S(t)), None, None)
    for s, bn, ph in ((1, "leg_l", 0.0), (-1, "leg_r", 0.5)):
        sw = S(t, 1, ph)  # +1 = leg forward
        lift = max(0.0, S(t, 1, ph + 0.25))
        p[bn] = ((-26 * sw, 0, 0), (0, 0.12 * lift, 0), None)
    for s, a, f, ph in ((1, "arm_l", "fore_l", 0.5), (-1, "arm_r", "fore_r", 0.0)):
        p[a] = ((-18 * S(t, 1, ph), 0, 4 * s), None, None)
        p[f] = ((-10 - 8 * S(t, 1, ph + 0.1), 0, 0), None, None)
    return p


def telegraph(t):  # rear back over 0.55, shiver, then drop the head for the charge
    u = ease(t / 0.55); sh = math.sin(math.pi * min(1, t / 0.9)) * S(t, 9)
    p = base(-0.08 * u, HUNCH - 20 * u + 3 * sh, -6 + 18 * ease((t - 0.6) / 0.4))
    p["root"] = ((0, 0, 2.5 * sh), (0.02 * sh, 0, 0), None)
    for s, a, f in ((1, "arm_l", "fore_l"), (-1, "arm_r", "fore_r")):
        p[a] = ((40 * u - 10 * ease((t - 0.6) / 0.4), 0, 14 * s * u), None, None)  # fists drawn back and out
        p[f] = ((-25 * u, 0, 0), None, None)
    for s, bn in ((1, "leg_l"), (-1, "leg_r")):
        p[bn] = ((-14 * u * s, 0, 0), None, None)  # stance spreads: one foot forward, one back
    return p


def ram(t):  # head-down, shoulders first, legs churning
    p = base(-0.05 + 0.04 * abs(S(t, 2)), 34 + 3 * S(t, 2), 14)
    p["root"] = ((0, 0, 3 * S(t)), None, None)
    for s, bn, ph in ((1, "leg_l", 0.0), (-1, "leg_r", 0.5)):
        p[bn] = ((-34 * S(t, 1, ph), 0, 0), (0, 0.15 * max(0, S(t, 1, ph + 0.25)), 0), None)
    for s, a, f in ((1, "arm_l", "fore_l"), (-1, "arm_r", "fore_r")):
        p[a] = ((45 + 6 * S(t, 2), 0, 10 * s), None, None)
        p[f] = ((-20, 0, 0), None, None)
    return p


def flinch(t):
    k = math.sin(math.pi * t)
    p = base(-0.02 * k, HUNCH - 12 * k, -6 - 14 * k)
    p["root"] = ((0, 0, 0), (0, 0, 0.06 * k), None)
    for a in ("arm_l", "arm_r"): p[a] = ((-12 * k, 0, 0), None, None)
    return p


DAZE = lambda t: {"hips": ((0, 0, 0), (0, -0.04, 0), None), "chest": ((-6 + 3 * S(t), 9 * S(t), 6 * S(t, 1, 0.25)), None, None),
                  "head": ((22 + 4 * S(t, 1, 0.2), -12 * S(t), 8 * S(t, 1, 0.3)), None, None),
                  "arm_l": ((6, 0, 6 + 3 * S(t)), None, None), "arm_r": ((10, 0, -8 - 3 * S(t, 1, 0.3)), None, None),
                  "fore_l": ((-6, 0, 0), None, None), "fore_r": ((-10, 0, 0), None, None),
                  "leg_l": ((-8, 0, -6), None, None), "leg_r": ((10, 0, 6), None, None)}


def blend(a, b, w):
    out = {}
    for k in set(a) | set(b):
        ra, la, _ = a.get(k, ((0, 0, 0), None, None)); rb, lb, _ = b.get(k, ((0, 0, 0), None, None))
        la, lb = la or (0, 0, 0), lb or (0, 0, 0)
        out[k] = (tuple(x + (y - x) * w for x, y in zip(ra, rb)), tuple(x + (y - x) * w for x, y in zip(la, lb)), None)
    return out


def stagger(t):  # knocked back on its heels, wobble, then sag into the dazed pose
    k = math.sin(math.pi * min(1, t / 0.35))
    hit = {"hips": ((0, 0, 0), (0, -0.04, 0), None), "chest": ((-24, 6, -6), None, None), "head": ((-22, 10, 0), None, None),
           "arm_l": ((-35, 0, 25), None, None), "arm_r": ((-30, 0, -25), None, None), "root": ((0, 0, 0), (0, 0, 0.12), None),
           "leg_l": ((10, 0, 0), None, None), "leg_r": ((-10, 0, 0), None, None)}
    return blend(blend(idle(0), hit, k), DAZE(0), ease((t - 0.3) / 0.7))


# unbind: the stones loosen (shiver), the legs give, the chest topples back onto them face-up (rune on top), arms and head roll aside.
# End pose ~0.55 m high, ~1.5 x 1.2 m footprint (enemies.js shows its own 1.4 x 0.5 rune step at the same spot).
END = {"root": ((0, 0, 0), (0, 0.2, 0), None),
       "hips": ((0, 0, 0), (0, -0.5, -0.05), None),
       "chest": ((-92, 0, 0), (0, 0.1, -0.45), None),            # on its back, rune face up (chest local Z = world up here)
       "head": ((25, 0, 35), (0.55, -1.0, -0.42), None),          # rolled off to the front-left, resting on the ground
       "arm_l": ((0, 0, 20), None, None), "arm_r": ((0, 0, -20), None, None),
       "fore_l": ((-10, 0, 8), None, None), "fore_r": ((-10, 0, -8), None, None),
       "leg_l": ((0, 0, 80), (0, -0.05, 0), None), "leg_r": ((0, 0, -80), (0, -0.05, 0), None)}


def unbind(t):
    sh = (1 - ease((t - 0.35) / 0.2)) * S(t, 14) * min(1, t / 0.15)
    start = DAZE(0)
    w = ease((t - 0.3) / 0.55)
    p = blend(start, END, w)
    bounce = math.sin(math.pi * min(1, max(0, (t - 0.82) / 0.12))) * (1 - w * 0.0)
    r, l, _ = p["chest"]; p["chest"] = ((r[0] + 3 * sh + 5 * bounce, r[1], r[2] + 2 * sh), l, None)
    r, l, _ = p["head"]; p["head"] = ((r[0], r[1] + 4 * sh, r[2]), (l[0], l[1] + 0.05 * bounce, l[2]), None)
    return p


def grounded(fn, k=lambda t: 1.0):  # legs hang off hips: counter any hip drop on the leg bones so the feet stay planted
    def g(t):
        p = fn(t); hy = (p.get("hips", ((0, 0, 0), None, None))[1] or (0, 0, 0))[1] * k(t)
        for b in ("leg_l", "leg_r"):
            r, l, sc = p.get(b, ((0, 0, 0), None, None)); l = l or (0, 0, 0)
            tip = (0.36 * abs(math.sin(math.radians(r[0]))) + 0.26 * abs(math.sin(math.radians(r[2])))) * k(t)  # a swung rigid leg digs its toe/heel in
            p[b] = (r, (l[0], l[1] - hy + tip, l[2]), sc)
        return p
    return g


G = grounded
L.clip(arm, "idle", 48, G(idle))
L.clip(arm, "patrol_walk", 30, G(walk))
L.clip(arm, "ram_telegraph", 19, G(telegraph), loop=False)
L.clip(arm, "ram", 12, G(ram))
L.clip(arm, "flinch", 8, G(flinch), loop=False)
L.clip(arm, "stagger", 24, G(stagger), loop=False)
L.clip(arm, "dazed", 48, G(DAZE))
L.clip(arm, "unbind", 60, G(unbind, lambda t: 1 - ease((t - 0.3) / 0.55)), loop=False)  # the collapse sinks on purpose
bpy.context.scene["events"] = {"patrol_walk": {"step_l": 0.25, "step_r": 0.75}, "ram": {"step_l": 0.25, "step_r": 0.75}, "unbind": {"land": 0.85}}
bpy.context.scene["stride"] = {"patrol_walk": 1.0}
L.export(OUT)
