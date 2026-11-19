"""Sigh, the wind wisp (npc.js kind 'wisp'): a cream translucent teardrop core with 4 trailing ribbon tails, ~0.6 m long.
Run (from repo root):
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/npc_sigh.py -- assets/characters/npc/sigh.glb [--qa <png dir>]
Floats, so the origin is the core's centre (no ground contact); the round head leads toward -Y here (+Z in glTF), tails trail behind.
Bones: core (root) > tail{a..d}1 > 2 > 3. Clip: float (2 s loop, tails undulate with a travelling phase, core bobs).
Materials: wisp_core, wisp_tail (cream, alpha blended, emissive, tails double-sided)."""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
sys.path.insert(0, os.path.dirname(__file__))
import npc_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
QA = argv[argv.index("--qa") + 1] if "--qa" in argv else None
L.reset()
CREAM, WARM = L.lin("#fff3d0"), L.lin("#f2d9a6")
core_m = L.material("wisp_core", "#fff3d0", vcol=True, emit=("#fff3d0", 0.8), alpha=0.8)
tail_m = L.material("wisp_tail", "#fff3d0", vcol=True, emit=("#fff3d0", 0.6), alpha=0.55, double=True)

# core: a teardrop, round head at -Y, tapering to a point at +Y
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=9, radius=0.1)
bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"))  # poles on the Y axis
for v in bm.verts:
    if v.co.y > 0:
        k = v.co.y / 0.1
        v.co.y *= 1 + 1.7 * k
        v.co.x *= 1 - 0.6 * k; v.co.z *= 1 - 0.6 * k
parts = [L.part("core", bm, core_m, lambda co, n: L.mix(CREAM, WARM, max(0, co.y) * 3), "core")]

TAILS, SEG, LEN = "abcd", 10, 0.42
bones = [("core", (0, -0.05, 0), (0, 0.08, 0), None)]
for k, nm in enumerate(TAILS):
    a = math.radians(45 + 90 * k)
    r0 = Vector((math.cos(a), 0, math.sin(a))) * 0.03  # ring of roots round the tapering tail of the core
    length = LEN * (1.0, 0.8, 0.95, 0.7)[k]
    start = Vector((0, 0.14, 0)) + r0
    path = lambda s, k=k, a=a, start=start, length=length: start + Vector((math.cos(a), 0, math.sin(a))) * (0.07 * s) + \
        Vector((0.05 * math.sin(4 * s + 1.7 * k), length * s, 0.05 * math.cos(4 * s + 1.7 * k)))  # splays out and curls a little
    bm = bmesh.new()
    rows = []
    for i in range(SEG + 1):
        s = i / SEG
        side = Matrix.Rotation(a + 1.5 * s, 3, "Y") @ Vector((0, 0, 1)) * (0.04 * (1 - s) ** 0.7 + 0.003)  # ribbon twists along its length
        c = path(s)
        rows.append((bm.verts.new(c + side), bm.verts.new(c - side)))
    for i in range(SEG): bm.faces.new((rows[i][0], rows[i][1], rows[i + 1][1], rows[i + 1][0]))
    names = [f"tail{nm}{j + 1}" for j in range(3)]
    for j in range(3):
        bones.append((names[j], tuple(path(j / 3)), tuple(path((j + 1) / 3)), "core" if j == 0 else names[j - 1]))

    def weights(co, path=path, names=names):
        s = min(range(SEG * 4 + 1), key=lambda i: (path(i / (SEG * 4)) - co).length) / (SEG * 4)
        u = min(2.0, max(0.0, s * 3 - 0.5)); i0 = min(1, int(u)); f = u - i0
        return [(names[i0], 1 - f), (names[i0 + 1], f)]
    parts.append(L.part(f"tail{nm}", bm, tail_m, lambda co, n: L.mix(CREAM, WARM, 0.4), weights, smooth=80))

body = L.join(parts, "sigh_body")
arm = L.armature("sigh", bones)
L.skin(body, arm)


def float_(t):
    w = lambda ph: math.sin(2 * math.pi * (t * 2 - ph))  # 2 waves per loop
    p = {"core": ((4 * math.sin(2 * math.pi * t), 0, 3 * math.cos(2 * math.pi * t)), (0, 0, 0.02 * math.sin(2 * math.pi * t * 2)), None)}
    for k, nm in enumerate(TAILS):
        for j in range(3):
            ph = 0.18 * j + 0.25 * k
            p[f"tail{nm}{j + 1}"] = ((8 * (1 + 0.3 * j) * w(ph), 0, 6 * (1 + 0.3 * j) * w(ph + 0.25)), None, None)
    return p


L.clip(arm, "float", 48, float_)
L.export(OUT)
bb = [Vector(c) for c in body.bound_box]
print("SIGH bbox", [round(min(v[i] for v in bb), 2) for i in range(3)], [round(max(v[i] for v in bb), 2) for i in range(3)])

if QA:
    cam, tgt = L.qa_setup()
    c = (0, 0.25, 0)
    for j, t in enumerate((0.0, 0.25)):
        L.pose_at(arm, "float", t)
        L.shoot(f"{QA}/sigh_34_{j}.png", cam, tgt, c, 0.8, yaw=40, el=20)
    L.shoot(f"{QA}/sigh_side.png", cam, tgt, c, 0.8, yaw=90, el=5)
    L.shoot(f"{QA}/sigh_small.png", cam, tgt, c, 1.2, yaw=150, el=25, w=300, h=200)
