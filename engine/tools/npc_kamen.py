"""Kamen, the sleeping stone golem (npc.js kind 'golem'): stacked boulders, flat walkable back, rune head, 4 stubby limbs.
Run (from repo root):
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/npc_kamen.py -- assets/characters/npc/kamen.glb [--qa <png dir>]
Faces -Y here (+Z in glTF), origin = ground under the back's centre. Back top flat at BACK_H.
Bones: body (root) > head, limb_fl/fr/bl/br. Clips: sleep (4 s breathing loop), wake (1.5 s head lift, once), walk (1 s paddle loop),
twitch (0.58 s shudder from the sleep pose, once), standup (2 s sleep -> walk(0) pose, once), idle_awake (3 s loop: breathing + head turn).
Materials: stone (vertex coloured), rune (gold, emissive), eyes (dark; npc.js lights them), glyph_a/b/c (the name-stone glyphs carved
into the three back slabs, tail -> head = a, b, c; dim carved by default, code lights them gold)."""
import bpy, sys, os, math
from mathutils import Vector
sys.path.insert(0, os.path.dirname(__file__))
import npc_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
QA = argv[argv.index("--qa") + 1] if "--qa" in argv else None
L.reset()

BACK_H = 0.85
STONE, DARK, MOSS, LIGHT = L.lin("#9a9086"), L.lin("#5f5850"), L.lin("#8d9a6a"), L.lin("#c9bfae")
st = L.material("stone", vcol=True)
rune = L.material("rune", "#e9b85a", emit=("#e9b85a", 1.0))
eyes = L.material("eyes", "#3b342c")
glyphs = {k: L.material(f"glyph_{k}", "#5b554b") for k in "abc"}


def col(seed, moss=True):
    def f(co, n):
        k = 0.5 + 0.5 * math.sin(co.x * 3.1 + co.y * 2.3 + seed) * math.cos(co.z * 4.7 - seed)
        c = L.mix(DARK, STONE, 0.45 + 0.55 * min(1, co.z / 0.6 + 0.2))  # darker toward the ground
        c = L.mix(c, LIGHT, 0.25 * k)
        if moss and n.z > 0.55 and co.z > 0.45: c = L.mix(c, MOSS, min(1, (n.z - 0.55) * 2.5) * (0.35 + 0.4 * k))
        return c
    return f


parts = []
P = lambda nm, bm, g, m=st, c=None: parts.append(L.part(nm, bm, m, c or col(len(parts)), g))
# body: belly boulder + a back of three flat-topped slabs (seams read as stacked stones) + shoulder hump at the head end
P("belly", L.rock((0.84, 1.15, 0.4), (0, 0.05, 0.42), seed=1, bottom=0.14, top=BACK_H - 0.1), "body")
for i, (y0, y1) in enumerate(((-1.12, -0.42), (-0.38, 0.42), (0.46, 1.2))):
    w = (0.74, 0.8, 0.7)[i]
    P(f"back{i}", L.rock((w, (y1 - y0) / 2, 0.3), (0.03 * (i - 1), (y0 + y1) / 2, 0.64), seed=2 + i, box=0.4, rough=0.08, top=BACK_H, rot=0.04 * (i - 1)), "body")
for i, (x, y, z, s) in enumerate([(0.68, -0.6, 0.42, 0.36), (-0.66, -0.62, 0.44, 0.34), (0.66, 0.65, 0.42, 0.34), (-0.68, 0.62, 0.4, 0.36),
                                   (0.0, 1.1, 0.45, 0.38), (0.62, 0.0, 0.4, 0.3), (-0.62, 0.05, 0.4, 0.3)]):
    P(f"lump{i}", L.rock((s, s * 1.1, s * 0.85), (x, y, z), seed=10 + i, sub=1, top=BACK_H - 0.06, rot=i), "body")
for s in (1, -1):  # hunched shoulders: two boulders rising past the back at the head end (the rider stands behind them)
    P(f"shoulder{s}", L.rock((0.42, 0.34, 0.38), (0.42 * s, -1.2, 0.72), seed=15 + s, rot=0.3 * s, tilt=(-0.3, 0.2 * s)), "body")
P("tail", L.rock((0.22, 0.22, 0.18), (0.05, 1.32, 0.28), seed=20, sub=1, bottom=0.1), "body")
# head: heavy, low, resting on its chin; the neck pivot sits under the shoulders
P("neck", L.rock((0.36, 0.3, 0.3), (0, -1.3, 0.5), seed=30, sub=1), "head")
P("head", L.rock((0.55, 0.46, 0.42), (0, -1.62, 0.48), seed=31, box=0.5), "head")
P("brow", L.rock((0.5, 0.22, 0.15), (0, -1.78, 0.8), seed=32, tilt=(0.25, 0)), "head")
P("jaw", L.rock((0.44, 0.3, 0.14), (0, -1.84, 0.2), seed=33, sub=1, bottom=0.08), "head")
for s in (1, -1):  # ear stones / brow horns, tilted out
    P(f"horn{s}", L.rock((0.12, 0.12, 0.2), (0.4 * s, -1.54, 0.86), seed=36 + s, sub=1, tilt=(0.3, 0.6 * s)), "head")
# rune socket in the forehead: a dark ring + a gold diamond inset, facing forward and a little up
import bmesh
from mathutils import Matrix
FH = Vector((0, -2.03, 0.62))
P("socket", L.rock((0.23, 0.06, 0.22), FH + Vector((0, 0.03, 0)), seed=34, sub=1, box=0.8, rough=0.05, tilt=(-0.35, 0)), "head",
  c=lambda co, n: DARK)
bm = bmesh.new()
bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.16, radius2=0.0, depth=0.08)
for v in bm.verts: v.co = Vector((v.co.x, v.co.z, v.co.y * 1.4))  # flat diamond in the XZ plane, point toward -Y
bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(-0.35, 3, "X"))
bmesh.ops.translate(bm, verts=bm.verts, vec=FH + Vector((0, -0.02, 0)))
P("rune", bm, "head", m=rune, c=lambda co, n: (1, 1, 1))
for s in (1, -1):  # eye slits under the brow, either side of the jaw line
    P(f"eye{s}", L.rock((0.08, 0.04, 0.035), (0.3 * s, -1.98, 0.44), seed=40 + s, sub=1, box=0.9, rough=0.02, rot=-0.3 * s), "head", m=eyes,
      c=lambda co, n: (1, 1, 1))
# limbs: stubby boulders at the corners, pivot at the shoulder/hip
LIMBS = {"limb_fl": (0.82, -0.85), "limb_fr": (-0.82, -0.85), "limb_bl": (0.82, 0.85), "limb_br": (-0.82, 0.85)}
for i, (bn, (x, y)) in enumerate(LIMBS.items()):
    P(bn, L.rock((0.3, 0.32, 0.32), (x * 1.08, y - 0.05, 0.3), seed=50 + i, bottom=0.0), bn)
    P(bn + "_toe", L.rock((0.2, 0.16, 0.1), (x * 1.1, y - 0.32, 0.09), seed=60 + i, sub=1, bottom=0.0), bn)

# name glyphs carved into the flat back, one per slab (npc.js marks sit at the same spots: y = +0.75, 0, -0.75), top toward the head
from mathutils import Matrix as _M
for k, y in zip("abc", (0.75, 0.0, -0.75)):
    P(f"glyph_{k}", L.glyph(k, 0.5, _M.Translation((0.03 * (1 - "abc".index(k)), y, BACK_H - 0.012)) @ _M.Rotation(math.pi, 4, "Z"), depth=0.04),
      "body", m=glyphs[k], c=lambda co, n: (1, 1, 1))

body = L.join(parts, "kamen_body")
arm = L.armature("kamen", [("body", (0, 0, 0.45), (0, 0, 0.75), None), ("head", (0, -1.2, 0.5), (0, -1.2, 0.8), "body")] +
                 [(bn, (x, y, 0.5), (x, y, 0.8), "body") for bn, (x, y) in LIMBS.items()])
L.skin(body, arm)

# rotation X on a bone pointing up (roll 0) pitches about the creature's side axis; negative = head up / limb forward
S = lambda t, k=1, ph=0: math.sin(2 * math.pi * (k * t + ph))
REST = lambda: {}
L.clip(arm, "sleep", 96, lambda t: {"body": ((0, 0, 0), (0, 0.012 * (1 - math.cos(2 * math.pi * t)) / 2, 0), None),  # bone Y = world up
                                    "head": ((-2 * (1 - math.cos(2 * math.pi * (t - 0.08))) / 2, 0, 0), None, None)})
LIFT = -28
ease = lambda u: u * u * (3 - 2 * u)
L.clip(arm, "wake", 36, lambda t: {"body": ((0, 0, 0), (0, 0.04 * ease(min(1, t * 1.5)), 0), None),
                                   "head": ((LIFT * ease(min(1, max(0, (t - 0.1) / 0.9))) + 4 * math.sin(math.pi * min(1, t * 2)), 0, 0), None, None)}, loop=False)


def walk(t):
    p = {"body": ((0, 0, 1.2 * S(t, 2)), (0, 0.04 + 0.015 * abs(S(t, 2)), 0), None),
         "head": ((LIFT + 3 * S(t, 2, 0.2), 0, 2 * S(t)), None, None)}
    for bn, ph in (("limb_fl", 0), ("limb_br", 0), ("limb_fr", 0.5), ("limb_bl", 0.5)):
        p[bn] = ((28 * S(t, 1, ph), 0, 0), (0, 0.06 * max(0, S(t, 1, ph + 0.25)), 0), None)
    return p


L.clip(arm, "walk", 24, walk)

# twitch (once, from and back to the sleep rest pose): a decaying shudder, the head jerks up a little, the limbs clench
L.clip(arm, "twitch", 14, lambda t: (lambda d: {"body": ((2.5 * d * S(t, 4.5), 0, 3 * d * S(t, 4.5, 0.25)), (0, 0.015 * d * abs(S(t, 4.5)), 0), None),
                                                "head": ((-7 * d * (0.5 + 0.5 * S(t, 4.5, 0.1)), 0, 3 * d * S(t, 3.5)), None, None),
                                                **{bn: ((-6 * d * abs(S(t, 4.5, 0.3 * i)), 0, 0), None, None) for i, bn in enumerate(LIMBS)}})(
    math.sin(math.pi * min(1, t * 4)) if t < 0.125 else (1 - t) ** 1.5 / 0.875 ** 1.5), loop=False)


# standup (once): front pushes up (nose high), the hind end follows, overshoot, settle exactly into walk(0)
def standup(t):
    W = walk(0)
    u = ease(min(1, t / 0.85))
    front = ease(min(1, t / 0.4)) * (1 - ease(min(1, max(0, (t - 0.35) / 0.4))))  # 0 -> 1 -> 0: nose-up phase
    lift = W["body"][1][1] * u + 0.05 * math.sin(math.pi * min(1, t / 0.7)) + 0.4 * front  # head and shoulders heave ~0.4 m up mid-rise
    p = {"body": ((-7 * front, 0, 0), (0, lift, 0), None),
         "head": ((W["head"][0][0] * u - 6 * front, 0, 0), None, None)}
    for bn in LIMBS:  # feet stay planted while the body rises, then step into the walk's start pose
        r0, l0, _ = W[bn]
        step = ease(min(1, max(0, (t - 0.75) / 0.25)))
        plant = -lift + (0.04 * front if bn.startswith("limb_f") else 0)
        p[bn] = ((r0[0] * step, 0, 0), (0, plant * (1 - step) + l0[1] * step, 0), None)
    return p


L.clip(arm, "standup", 48, standup, loop=False)
# idle_awake (loop): standing (walk height, head up), slow breaths, the head looks left, then right
L.clip(arm, "idle_awake", 72, lambda t: {"body": ((0.8 * S(t, 2), 0, 0), (0, 0.04 + 0.012 * (1 - math.cos(4 * math.pi * t)) / 2, 0), None),
                                         "head": ((LIFT + 2 * S(t, 2, 0.1), 16 * S(t), 2 * S(t, 1, 0.1)), None, None)})
L.export(OUT)

# report: back top flat area
ys = [v.co for v in body.data.vertices if abs(v.co.z - BACK_H) < 1e-4]
print(f"KAMEN back_h={BACK_H} flat_x=[{min(v.x for v in ys):.2f},{max(v.x for v in ys):.2f}] flat_y=[{min(v.y for v in ys):.2f},{max(v.y for v in ys):.2f}]")
bb = [body.matrix_world @ Vector(c) for c in body.bound_box]
print("KAMEN bbox", [round(min(v[i] for v in bb), 2) for i in range(3)], [round(max(v[i] for v in bb), 2) for i in range(3)])

if QA:
    cam, tgt = L.qa_setup()
    c = (0, -0.3, 0.5)
    for nm, t in (("sleep", 0.0), ("wake", 1.0), ("walk", 0.25), ("twitch", 0.1), ("standup", 0.3), ("standup", 1.0), ("idle_awake", 0.25),
                  ("idle_awake", 0.75)):
        L.pose_at(arm, nm, t)
        L.shoot(f"{QA}/kamen_{nm}_{int(t * 100)}_34.png", cam, tgt, c, 4.4, yaw=40, el=22)
        L.shoot(f"{QA}/kamen_{nm}_{int(t * 100)}_side.png", cam, tgt, c, 4.4, yaw=90, el=5)
        if nm == "sleep":
            L.shoot(f"{QA}/kamen_top.png", cam, tgt, c, 4.2, yaw=20, el=70)
        if nm == "walk": L.shoot(f"{QA}/kamen_small.png", cam, tgt, c, 4.6, yaw=-140, el=30, w=300, h=200)
