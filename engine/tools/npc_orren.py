"""Orren's Remnant (npc.js kind 'orren'): a weathered stone arch (~4 m) with a hooded figure seated inside, 3 rune sockets.
Run (from repo root):
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/npc_orren.py -- assets/characters/npc/orren.glb [--qa <png dir>]
Faces -Y here (+Z in glTF); origin = ground under the arch's centre. Debris rings stay procedural (npc.js).
Minimal rig: root (arch, plinth, runes; never animated) > body (seated figure, pivot at the seat) > head (hood), arm_l, arm_r (sleeves; the
folded hands are shared 50/50). Clips (once each, hold the last frame): lift1/lift2/lift3 (1 s: the head lifts a step per rune struck,
cumulative: lift2 starts where lift1 ends), exhale (3 s, from the lift3 end pose: a breath in, then sinks, slumps and settles when freed).
Materials: stone (vertex coloured; moss on top faces, dark hood cavity), rune1 (left pillar), rune2 (right pillar), rune3 (set in the
hood's face cavity, on the head bone: the stone struck from the front, at strike height), all gold + emissive so npc.js can light them one per strike."""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(__file__))
import npc_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
QA = argv[argv.index("--qa") + 1] if "--qa" in argv else None
L.reset()
STONE, DARK, MOSS, LIGHT, VOID = L.lin("#9a9086"), L.lin("#5f5850"), L.lin("#8d9a6a"), L.lin("#c9bfae"), L.lin("#2e2924")
st = L.material("stone", vcol=True)
runes = [L.material(f"rune{i}", "#e9b85a", emit=("#e9b85a", 1.0)) for i in (1, 2, 3)]


def col(seed, dark=0.0):
    def f(co, n):
        k = 0.5 + 0.5 * math.sin(co.x * 2.1 + co.y * 1.7 + seed) * math.cos(co.z * 2.9 - seed)
        c = L.mix(DARK, STONE, 0.5 + 0.5 * min(1, co.z / 1.5))
        c = L.mix(c, LIGHT, 0.3 * k)
        if n.z > 0.6: c = L.mix(c, MOSS, min(1, (n.z - 0.6) * 2.5) * (0.4 + 0.4 * k))
        return L.mix(c, DARK, dark)
    return f


parts = []
GROUP = ["root"]  # bone that the next parts ride on
P = lambda nm, bm, m=st, c=None: parts.append(L.part(nm, bm, m, c or col(len(parts)), GROUP[0]))
# plinth + broken step in front
P("plinth", L.rock((1.75, 0.85, 0.16), (0, 0, 0.12), seed=1, box=0.35, rough=0.06, bottom=0.0, top=0.26))
P("step", L.rock((0.9, 0.3, 0.09), (0.1, -1.0, 0.06), seed=2, box=0.35, rough=0.1, bottom=0.0, rot=0.05))
# pillars: three stacked blocks each, a little off-true; PX = pillar centre x
PX, PH = 1.25, 2.55
for s in (1, -1):
    z = 0.26
    for j, h in enumerate((0.95, 0.8, 0.8)):
        w = 0.36 - 0.02 * j
        P(f"pillar{s}{j}", L.rock((w, 0.34, h / 2), (s * PX + 0.03 * math.sin(3 * j + s), 0.02 * j * s, z + h / 2 - 0.02), seed=10 + j + 5 * s,
                                  box=0.3, rough=0.07, rot=0.06 * (j - 1) * s))
        z += h
    P(f"cap{s}", L.rock((0.44, 0.4, 0.12), (s * PX, 0, PH + 0.18), seed=20 + s, box=0.3, rough=0.06))
# arch: voussoirs on a half circle over the capitals; one missing on the right (weathered), the keystone larger
R, CZ, N = PX, PH + 0.3, 9
for i in range(N):
    if i == 2: continue  # fallen block
    a0, a1 = math.pi * i / N, math.pi * (i + 1) / N
    a = (a0 + a1) / 2
    key = i == N // 2
    rad = R + (0.05 if key else 0)
    P(f"vous{i}", L.rock((0.3 if key else 0.26, 0.3, 0.22 if key else 0.19), (rad * math.cos(a), 0, CZ + rad * math.sin(a)), seed=30 + i,
                         box=0.3, rough=0.08, tilt=(0, math.pi / 2 - a)))
# a chunk of the fallen block on the plinth, right of the figure
P("fallen", L.rock((0.22, 0.2, 0.16), (-0.85, -0.45, 0.4), seed=41, rot=0.7, tilt=(0.3, 0.4)))
# seated hooded figure: robe (cone-ish rock), knees, folded hands, shoulders, hood with a dark face cavity
GROUP[0] = "body"
P("robe", L.rock((0.42, 0.38, 0.55), (0, 0.15, 0.78), seed=50, box=0.7, rough=0.08, bottom=0.26))
P("knees", L.rock((0.4, 0.3, 0.17), (0, -0.25, 0.52), seed=51, box=0.6, rough=0.08, bottom=0.26))
GROUP[0] = lambda co: [("arm_l", 0.5), ("arm_r", 0.5)]
P("hands", L.rock((0.14, 0.11, 0.1), (0, -0.42, 0.72), seed=52, sub=1, box=0.8))
GROUP[0] = "body"
P("shoulders", L.rock((0.5, 0.3, 0.2), (0, 0.1, 1.3), seed=53, box=0.7, rough=0.06))
for s_ in (1, -1):  # sleeves from the shoulders down to the folded hands
    GROUP[0] = "arm_l" if s_ > 0 else "arm_r"
    P(f"sleeve{s_}", L.rock((0.15, 0.3, 0.15), (0.3 * s_, -0.15, 1.0), seed=57 + s_, sub=1, box=0.7, tilt=(0.75, -0.35 * s_)))
GROUP[0] = "head"
P("hood", L.rock((0.29, 0.31, 0.34), (0, 0.04, 1.64), seed=54, box=0.8, rough=0.05, tilt=(0.2, 0)))
P("hood_tip", L.rock((0.1, 0.14, 0.14), (0, 0.22, 1.9), seed=55, sub=1, tilt=(0.6, 0)))
P("cowl", L.rock((0.25, 0.09, 0.07), (0, -0.25, 1.86), seed=59, sub=1, box=0.7, tilt=(-0.4, 0)))
P("face", L.rock((0.15, 0.06, 0.18), (0, -0.22, 1.58), seed=56, sub=1, box=0.9, rough=0.03), c=lambda co, n: VOID)


def diamond(center, r, mat, facing=-0.0):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=r, radius2=0.0, depth=0.07)
    for v in bm.verts: v.co = Vector((v.co.x, v.co.z, v.co.y * 1.4))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(facing, 3, "X"))
    bmesh.ops.translate(bm, verts=bm.verts, vec=center)
    P(mat.name, bm, m=mat, c=lambda co, n: (1, 1, 1))
    P(mat.name + "_socket", L.rock((r * 1.5, 0.05, r * 1.6), Vector(center) + Vector((0, 0.035, 0)), seed=60, sub=1, box=0.8, rough=0.04),
      c=lambda co, n: DARK)


GROUP[0] = "root"
diamond((PX, -0.37, 1.35), 0.13, runes[0])
diamond((-PX, -0.37, 1.35), 0.13, runes[1])
GROUP[0] = "head"
diamond((0, -0.3, 1.58), 0.11, runes[2])  # fills the face cavity (not the keystone: out of reach)

ob = L.join(parts, "orren")
arm = L.armature("orren_rig", [("root", (0, 0, 0), (0, 0, 0.26), None), ("body", (0, 0.15, 0.3), (0, 0.15, 0.9), "root"),
                               ("head", (0, 0.06, 1.42), (0, 0.06, 1.8), "body"), ("arm_l", (0.32, 0.08, 1.28), (0.32, 0.08, 1.5), "body"),
                               ("arm_r", (-0.32, 0.08, 1.28), (-0.32, 0.08, 1.5), "body")])
L.skin(ob, arm)
# up bones: rot X + = lean forward / head bows, - = head lifts; rot Y = turn; location Y = up
ease = lambda u: u * u * (3 - 2 * u)
STEP = -7  # head lift per rune
for k in (1, 2, 3):
    L.clip(arm, f"lift{k}", 24, lambda t, k=k: (lambda h: {"head": ((h, 0, 0), None, None), "body": ((h * 0.15, 0, 0), None, None),
                                                          "arm_l": ((-1.5 * k * ease(t), 0, 0), None, None), "arm_r": ((-1.5 * k * ease(t), 0, 0), None, None)})(
        STEP * (k - 1 + ease(t)) + 2.5 * math.sin(math.pi * t)), loop=False)


def exhale(t):  # breath in (0-0.25), long out-breath sinking (0.25-0.8), settle (0.8-1)
    H0 = STEP * 3
    i = ease(min(1, t / 0.25)) * (1 - ease(min(1, max(0, (t - 0.25) / 0.3))))  # in-breath bump
    o = ease(min(1, max(0, (t - 0.25) / 0.6)))  # out-breath / settle
    b = 0.6 * math.sin(math.pi * max(0, (t - 0.85) / 0.15)) * (t > 0.85)  # tiny settling bob
    return {"body": ((H0 * 0.15 * (1 - o) + 7 * o - 2 * i + b, 0, 0), (0, 0.025 * i - 0.06 * o, 0), None),
            "head": ((H0 * (1 - o) - 4 * i + 12 * o + b, 0, 3 * o), None, None),
            "arm_l": ((-4.5 * (1 - o) - 2 * i + 6 * o, 0, 0), (0, -0.02 * o, 0), None),
            "arm_r": ((-4.5 * (1 - o) - 2 * i + 6 * o, 0, 0), (0, -0.02 * o, 0), None)}


L.clip(arm, "exhale", 72, exhale, loop=False)
L.export(OUT)
bb = [Vector(c) for c in ob.bound_box]
print("ORREN bbox", [round(min(v[i] for v in bb), 2) for i in range(3)], [round(max(v[i] for v in bb), 2) for i in range(3)])

if QA:
    cam, tgt = L.qa_setup()
    c = (0, 0, 2.0)
    L.shoot(f"{QA}/orren_34.png", cam, tgt, c, 5.0, yaw=35, el=15)
    for nm, t in (("lift1", 1.0), ("lift3", 1.0), ("exhale", 0.2), ("exhale", 1.0)):
        L.pose_at(arm, nm, t)
        L.shoot(f"{QA}/orren_{nm}_{int(t * 100)}_34.png", cam, tgt, (0, 0, 1.1), 2.2, yaw=25, el=8)
    L.pose_at(arm, "exhale", 1.0)
    L.shoot(f"{QA}/orren_front.png", cam, tgt, c, 5.0, yaw=0, el=8)
    L.shoot(f"{QA}/orren_side.png", cam, tgt, c, 5.0, yaw=90, el=5)
    L.shoot(f"{QA}/orren_small.png", cam, tgt, c, 7.0, yaw=-30, el=20, w=300, h=200)
