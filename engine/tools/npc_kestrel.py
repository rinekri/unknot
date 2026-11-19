"""The tied kestrel (npc.js kind 'kestrel'): a folded paper bird, ~1 m wingspan, flat-shaded cream paper, darker fold faces.
Run (from repo root):
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/npc_kestrel.py -- assets/characters/npc/kestrel.glb [--qa <png dir>]
Flies, so the origin is the body's centre (between the wing roots); nose toward -Y here (+Z in glTF), its left = +X.
Bones: body (root) > wing_l, wing_r, tail. Empties tether_l / tether_r (children of body) = where the gold cords attach.
Clips: tethered (1 s loop: fast straining flaps, tugging), fly (2 s loop: two flaps, then a glide),
strain (1.21 s loop: hard pulls against the cords, nose up, body yanked back), flyoff (3 s once: cut free, burst up and away; ROOT MOTION on
body: ends 9 m forward, 5 m up in model space), circle (4 s loop: banked soar to the bird's left, in place; code moves it along the path), perch (3 s loop: wings folded, at rest
on a post: origin = body centre, so place it ~0.06 m above the perch top), perch_land (0.75 s once: ROOT MOTION, arrives from 1.6 m
behind / 0.7 m above and settles at the origin), perch_takeoff (0.75 s once: ROOT MOTION, ends 1.6 m forward, 0.8 m up; chain fly/flyoff).
Material: paper (double-sided, per-face colour: light/shade sides of each fold, inked wingtips and tail band)."""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(__file__))
import npc_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
QA = argv[argv.index("--qa") + 1] if "--qa" in argv else None
L.reset()
PAPER, SHADE, INK, RUST = L.lin("#f4ecdc"), L.lin("#ddd0b8"), L.lin("#6b5a48"), L.lin("#d8b48a")
paper = L.material("paper", vcol=True, double=True)


def sheet(name, verts, faces, tones, group):
    """faces as vertex-index tuples; tones[i] = colour of face i (per-corner, so folds stay crisp)."""
    bm = bmesh.new()
    vs = [bm.verts.new(v) for v in verts]
    fs = [bm.faces.new([vs[i] for i in f]) for f in faces]
    bm.normal_update()
    cols = {}
    for f, t in zip(fs, tones): cols[tuple(round(c, 4) for c in f.calc_center_median())] = t
    return L.part(name, bm, paper, lambda co, n: cols[min(cols, key=lambda k: (Vector(k) - co).length)], group, smooth=0, corner=True)


parts = []
# body: a folded diamond (ridge on top, keel below), head flap + beak at -Y
B = [(0, -0.22, 0.02), (0, -0.04, 0.075), (0, 0.16, 0.02), (0, -0.02, -0.055), (0.045, -0.05, 0.01), (-0.045, -0.05, 0.01),
     (0, -0.29, 0.1), (0.022, -0.26, 0.035), (-0.022, -0.26, 0.035), (0, -0.345, 0.05)]
BF = [(0, 4, 1), (0, 1, 5), (1, 4, 2), (1, 2, 5), (0, 3, 4), (0, 5, 3), (4, 3, 2), (5, 2, 3),
      (0, 7, 6), (0, 6, 8), (6, 7, 9), (6, 9, 8), (0, 8, 7)]
parts.append(sheet("body", B, BF, [PAPER, SHADE, SHADE, PAPER, SHADE, PAPER, RUST, RUST, PAPER, SHADE, PAPER, INK, SHADE], "body"))
# wings: swept, pointed kestrel wings with a mountain fold from root to tip; tips inked
for s, bn in ((1, "wing_l"), (-1, "wing_r")):
    W = [(0.035 * s, -0.11, 0.025), (0.035 * s, 0.07, 0.025), (0.22 * s, -0.05, 0.05), (0.24 * s, -0.11, 0.02),
         (0.27 * s, 0.1, 0.0), (0.5 * s, 0.08, 0.0), (0.4 * s, 0.03, 0.025)]
    F = [(0, 3, 2), (0, 2, 1), (2, 4, 1), (3, 6, 2), (2, 6, 4), (3, 5, 6), (6, 5, 4)]
    if s < 0: F = [f[::-1] for f in F]
    parts.append(sheet(bn, W, F, [PAPER, SHADE, SHADE, PAPER, SHADE, INK, INK], bn))
# tail: a folded fan with a dark band at its end
T = [(0, 0.12, 0.025), (0.035, 0.3, 0.01), (0, 0.32, 0.04), (-0.035, 0.3, 0.01), (0.075, 0.38, 0.0), (0, 0.4, 0.035), (-0.075, 0.38, 0.0)]
TF = [(0, 1, 2), (0, 2, 3), (1, 4, 5), (1, 5, 2), (3, 2, 5), (3, 5, 6)]
parts.append(sheet("tail", T, TF, [PAPER, SHADE, INK, INK, INK, INK], "tail"))

body = L.join(parts, "kestrel_body")
arm = L.armature("kestrel", [("body", (0, 0.05, 0), (0, -0.1, 0), None), ("wing_l", (0.035, 0.0, 0.025), (0.035, -0.1, 0.025), "body"),
                             ("wing_r", (-0.035, 0.0, 0.025), (-0.035, -0.1, 0.025), "body"), ("tail", (0, 0.13, 0.025), (0, 0.03, 0.025), "body")])
L.skin(body, arm)
for s, nm in ((1, "tether_l"), (-1, "tether_r")):  # under the wing roots, where the cords tie on
    e = bpy.data.objects.new(nm, None)
    bpy.context.scene.collection.objects.link(e)
    e.empty_display_size = 0.03
    e.parent = arm; e.parent_type = "BONE"; e.parent_bone = "body"
    e.matrix_world = Matrix.Translation((0.04 * s, -0.04, -0.02))

# bones point -Y (roll 0): local Y rotation rolls about the body axis (+ lifts wing_l, - lifts wing_r); local X pitches
S = lambda t, k=1, ph=0: math.sin(2 * math.pi * (k * t + ph))


def flap(a, dih=10): return {"wing_l": ((0, a + dih, 0), None, None), "wing_r": ((0, -(a + dih), 0), None, None)}


def tethered(t):
    a = 38 * S(t, 5) + 6 * S(t, 2, 0.3)  # fast, ragged straining flaps
    p = flap(a, 12)
    p["body"] = ((-8 + 6 * S(t, 1), 6 * S(t, 2, 0.1), 5 * S(t, 1, 0.3)), (0, 0, 0.02 * S(t, 5, 0.2)), None)
    p["tail"] = ((10 * S(t, 5, 0.25), 0, 8 * S(t, 2)), None, None)
    return p


def fly(t):
    a = 45 * math.sin(4 * math.pi * t) if t < 0.5 else 4 * math.sin(2 * math.pi * (t - 0.5))  # two flaps, then a glide
    p = flap(a, 8)
    p["body"] = ((-4 * (math.sin(4 * math.pi * t) if t < 0.5 else 0), 0, 0), (0, 0, 0.03 * S(t)), None)
    p["tail"] = ((4 * S(t, 2, 0.2), 0, 0), None, None)
    return p


def strain(t):  # 3 heavy beats per loop, each beat yanks the body back against the cords then it surges forward
    a = 50 * S(t, 3) + 8
    p = flap(a, 14)
    pull = 0.5 - 0.5 * math.cos(2 * math.pi * 3 * t)
    p["body"] = ((22 + 8 * S(t, 3, 0.15), 5 * S(t, 1), 6 * S(t, 1, 0.25)), (0, -0.06 * pull, 0.03 * S(t, 3, 0.1)), None)
    p["tail"] = ((-14 + 10 * S(t, 3, 0.3), 0, 10 * S(t, 1, 0.4)), None, None)
    return p


def flyoff(t):  # 0-0.12 crouch (wings high), then fast power flaps easing into a glide; climbs nose-up, levels out away
    u = max(0, (t - 0.12) / 0.88)
    k = 3 * u + 4 * u * u * (1 - 0.35 * u)  # flap phase, decelerating
    a = 55 * math.sin(2 * math.pi * k) * (1 - 0.75 * u * u) if t > 0.12 else 55 * math.sin(math.pi / 2 * t / 0.12)
    p = flap(a, 10)
    climb = u * u * (3 - 2 * u)
    p["body"] = ((-6 * (1 - t / 0.12) if t < 0.12 else 28 * math.sin(math.pi * min(1, u * 1.4)) * (1 - 0.6 * u), 0, 4 * math.sin(math.pi * u)),
                 (0, 9 * u ** 1.6, -0.05 * (1 - t / 0.12) if t < 0.12 else 5 * climb), None)
    p["tail"] = ((10 * S(t, 6, 0.2) * (1 - u) - 6 * u, 0, 0), None, None)
    return p


def circle(t):  # constant bank, glide with one soft double flap per loop, small pitch swell
    a = 30 * math.sin(4 * math.pi * min(1, t / 0.25)) * math.sin(math.pi * min(1, t / 0.25)) + 3 * S(t, 2)
    p = flap(a, 6)
    p["body"] = ((3 * S(t, 1, 0.1), 26 + 3 * S(t, 2), 0), (0, 0, 0.04 * S(t, 1, 0.3)), None)  # +Y roll = left wing down = turning left
    p["tail"] = ((3 * S(t, 2), 0, -6), None, None)
    return p


FOLD = -58  # wings raised over the back like a resting paper crane (folding down would sink them into the perch)


def folded(k=1.0, sweep=1.0):
    return {"wing_l": ((0, -FOLD * k, 30 * sweep * k), None, None), "wing_r": ((0, FOLD * k, -30 * sweep * k), None, None)}


def perch(t):  # 3 s loop at rest on a post: breathing bob, two head-tilt looks, a tail flick, one half wing-shuffle
    p = folded(1 - 0.25 * max(0, S(t, 1, 0.6)) ** 8)
    look = 14 * math.sin(math.pi * min(1, max(0, (t - 0.1) / 0.25))) - 10 * math.sin(math.pi * min(1, max(0, (t - 0.55) / 0.2)))
    p["body"] = ((4 + 2 * S(t, 2), look * 0.4, look), (0, 0, 0.006 * S(t, 3)), None)
    p["tail"] = ((6 + 14 * max(0, S(t, 1, 0.8)) ** 12, 0, 0), None, None)
    return p


def perch_land(t):  # 0.75 s once: arrives from behind-above in a glide, brakes nose-up with fast beats, settles and folds
    u = 1 - (1 - t) ** 2
    a = 50 * math.sin(2 * math.pi * 3 * t) * (1 - t) if t < 0.8 else 0
    p = blend_wings(flap(a, 20), folded(), ease((t - 0.7) / 0.3))
    p["body"] = ((-30 * math.sin(math.pi * min(1, t / 0.8)) + 4 * ease((t - 0.8) / 0.2), 0, 0), (0, -1.6 * (1 - u), 0.7 * (1 - u) ** 1.5), None)
    p["tail"] = ((-20 * math.sin(math.pi * min(1, t / 0.8)), 0, 0), None, None)
    return p


def perch_takeoff(t):  # 0.75 s once: crouch, spring, power beats; ends 1.6 m forward, 0.8 m up (ROOT MOTION on body), mid-flap
    c = math.sin(math.pi * min(1, t / 0.18))
    u = max(0.0, (t - 0.15) / 0.85)
    p = blend_wings(folded(), flap(50 * math.sin(2 * math.pi * 2.5 * u), 12), ease(t / 0.2))
    p["body"] = ((6 * c - 22 * math.sin(math.pi * min(1, u * 1.3)), 0, 0), (0, 1.6 * u ** 1.5, -0.03 * c + 0.8 * u * u), None)
    p["tail"] = ((10 * c - 10 * u, 0, 0), None, None)
    return p


ease = lambda u: (lambda v: v * v * (3 - 2 * v))(max(0.0, min(1.0, u)))


def blend_wings(a, b, w):
    return {k: (tuple(x + (y - x) * w for x, y in zip(a[k][0], b[k][0])), None, None) for k in ("wing_l", "wing_r")}


L.clip(arm, "tethered", 24, tethered)
L.clip(arm, "fly", 48, fly)
L.clip(arm, "strain", 29, strain)
L.clip(arm, "flyoff", 72, flyoff, loop=False)
L.clip(arm, "circle", 96, circle)
L.clip(arm, "perch", 72, perch)
L.clip(arm, "perch_land", 18, perch_land, loop=False)
L.clip(arm, "perch_takeoff", 18, perch_takeoff, loop=False)
L.export(OUT)
bb = [Vector(c) for c in body.bound_box]
print("KESTREL bbox", [round(min(v[i] for v in bb), 2) for i in range(3)], [round(max(v[i] for v in bb), 2) for i in range(3)])

if QA:
    cam, tgt = L.qa_setup()
    c = (0, 0.02, 0.02)
    for nm, t in (("fly", 0.75), ("fly", 0.125), ("tethered", 0.15)):
        L.pose_at(arm, nm, t)
        L.shoot(f"{QA}/kestrel_{nm}_{int(t * 1000)}_34.png", cam, tgt, c, 1.2, yaw=35, el=25)
    for nm, t in (("strain", 0.0), ("strain", 0.5), ("circle", 0.1), ("circle", 0.6)):
        L.pose_at(arm, nm, t)
        L.shoot(f"{QA}/kestrel_{nm}_{int(t * 1000)}_34.png", cam, tgt, c, 1.2, yaw=35, el=25)
    for t in (0.06, 0.3, 0.6, 1.0):  # root motion: follow the body
        L.pose_at(arm, "flyoff", t)
        bpy.context.view_layer.update()
        L.shoot(f"{QA}/kestrel_flyoff_{int(t * 1000)}_34.png", cam, tgt, arm.matrix_world @ arm.pose.bones["body"].head, 1.2, yaw=35, el=25)
    L.pose_at(arm, "flyoff", 1.0); bpy.context.view_layer.update()
    print("KESTREL flyoff end body", [round(x, 2) for x in arm.matrix_world @ arm.pose.bones["body"].head])
    L.pose_at(arm, "fly", 0.75)
    L.shoot(f"{QA}/kestrel_side.png", cam, tgt, c, 1.2, yaw=90, el=5)
    L.shoot(f"{QA}/kestrel_top.png", cam, tgt, c, 1.2, yaw=0, el=80)
    L.shoot(f"{QA}/kestrel_small.png", cam, tgt, c, 2.2, yaw=150, el=25, w=300, h=200)
