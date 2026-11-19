"""Story props (headless Blender 5.x, same look as the NPC scripts: flat vertex-coloured stone, ink outline in QA).
Run (from repo root):
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/props_story.py -- assets/props [--qa <png dir>]
Writes into <out dir>: knot_chunk.glb, goal_circle.glb, anchor_stake.glb, rope_sag.glb, name_stone.glb, cairn.glb.
Axes as npc_lib: front = -Y here (+Z in glTF), up = +Z, origin = ground contact (knot chunks: their own centroid). 1 unit = 1 m.
Multi-variant files (knot_chunk: chunk_a..d, name_stone: name_a..c) hold one node per variant, every node at the origin.
Light-me materials default to the dim carved colour npc.js uses (#5b554b), so code swaps them by name to gold when lit:
glyph_a/b/c, goal_rune, cairn_light. rune_glow / rune / rope are gold from the start."""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(__file__))
import npc_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
QA = argv[argv.index("--qa") + 1] if "--qa" in argv else None
STONE, DARK, MOSS, LIGHT = L.lin("#9a9086"), L.lin("#5f5850"), L.lin("#8d9a6a"), L.lin("#c9bfae")
WOOD, WOOD_D = L.lin("#8a6a4a"), L.lin("#5e4632")
DIM, GOLD, PALE = "#5b554b", "#e9b85a", "#d8ccb4"
WHITE = lambda co, n: (1, 1, 1)


def col(seed, moss=0.6, h=1.0):
    def f(co, n):
        k = 0.5 + 0.5 * math.sin(co.x * 3.1 + co.y * 2.3 + seed) * math.cos(co.z * 4.7 - seed)
        c = L.mix(DARK, STONE, 0.5 + 0.5 * min(1, max(0, co.z / h)))
        c = L.mix(c, LIGHT, 0.3 * k)
        if n.z > moss: c = L.mix(c, MOSS, min(1, (n.z - moss) * 2.5) * (0.3 + 0.4 * k))
        return c
    return f


def stamp(bm, kind, origin, direction, size, up=Vector((0, 0, 1)), depth=0.07):
    """glyph bmesh set into the surface of `bm` where the ray origin->direction hits it, facing out along the hit normal."""
    hit, nrm, _, _ = BVHTree.FromBMesh(bm).ray_cast(Vector(origin), Vector(direction).normalized())
    assert hit, f"glyph ray missed: {origin} {direction}"
    z = nrm.normalized()
    x = up.cross(z).normalized() if abs(up.dot(z)) < 0.95 else Vector((1, 0, 0))
    y = z.cross(x)
    M = Matrix((x, y, z)).transposed().to_4x4()
    M.translation = hit - z * size * depth * 0.4
    return L.glyph(kind, size, M, depth=depth)


def fresh():
    L.reset()
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)


def report(name):
    for o in bpy.context.scene.objects:
        if o.type != "MESH": continue
        bb = [Vector(c) for c in o.bound_box]
        print(f"PROP {name}/{o.name} tris={sum(len(p.vertices) - 2 for p in o.data.polygons)} mats={[m.name for m in o.data.materials]} "
              f"bbox={[round(min(v[i] for v in bb), 2) for i in range(3)]}..{[round(max(v[i] for v in bb), 2) for i in range(3)]}")


def save(name, center, scale, spread=0.0):
    report(name)
    L.export(f"{OUT}/{name}.glb")
    if not QA: return
    cam, tgt = L.qa_setup()
    obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for i, o in enumerate(obs): o.location.x = (i - (len(obs) - 1) / 2) * spread  # side by side for the picture only (exported at 0)
    L.shoot(f"{QA}/prop_{name}_34.png", cam, tgt, center, scale, yaw=35, el=22, w=640 if spread else 480)
    L.shoot(f"{QA}/prop_{name}_front.png", cam, tgt, center, scale, yaw=0, el=6, w=640 if spread else 480)


# ---------- 5. knot chunks: rune-carved stone shards for Orren's debris rings (InstancedMesh-ready, centred, r ~0.15) ----------
fresh()
st, rg = L.material("stone", vcol=True), L.material("rune_glow", GOLD, emit=(GOLD, 1.5))
for i, (k, size, top, rot) in enumerate((("a", (0.16, 0.13, 0.15), 0.08, 0.3), ("b", (0.14, 0.16, 0.16), 0.07, 1.1),
                                         ("c", (0.18, 0.12, 0.13), 0.06, 2.0), ("x", (0.13, 0.13, 0.17), 0.09, 0.7))):
    bm = L.rock(size, seed=70 + i * 3, sub=2, box=0.45, rough=0.22, top=top, bottom=-size[2] * 0.75, rot=rot, tilt=(0.25 * i, 0.15))
    for v in bm.verts:  # two more fracture planes (sheared, so no two shards share a silhouette)
        v.co.x = min(v.co.x, size[0] * 0.55 + 0.25 * v.co.z * (1 if i % 2 else -1))
        v.co.y = max(v.co.y, -size[1] * 0.6 + 0.3 * v.co.x * (1 if i < 2 else -1))
    c = sum((v.co for v in bm.verts), Vector()) / len(bm.verts)
    bmesh.ops.translate(bm, verts=bm.verts, vec=-c)
    g = stamp(bm, k, (-0.02, 0.01, 0.5), (0, 0, -1), 0.12, depth=0.12)
    ob = L.join([L.part(f"chunk_{'abcd'[i]}", bm, st, col(i, moss=0.75, h=0.2)), L.part("g", g, rg, WHITE)], f"chunk_{'abcd'[i]}")
save("knot_chunk", (0, 0, 0), 1.6, spread=0.45)

# ---------- 6. goal circle: low carved ring, 2.4 m across, 8 rune notches, flat centre disc ----------
fresh()
st, gr, gc = L.material("stone", vcol=True), L.material("goal_rune", DIM), L.material("goal_core", PALE)
N, RI, RO, H = 32, 0.92, 1.2, 0.14
bm = bmesh.new()
rings = []
for r, z in ((RO + 0.03, 0.0), (RO, H * 0.85), (RO - 0.05, H), (RI + 0.04, H), (RI, H * 0.8), (RI - 0.02, 0.0)):
    ring = []
    for j in range(N):
        a = 2 * math.pi * j / N
        notch = abs(((j + 0.5) % (N / 8)) - N / 16) < 0.6  # every 4th segment pair dips: the carved notch around each rune
        jit = 0.012 * math.sin(7 * a + r * 9) + 0.008 * math.cos(13 * a)
        zz = z - (0.035 if notch and z == H else 0) + (jit * 0.6 if z > 0 else 0)
        ring.append(bm.verts.new(((r + jit) * math.cos(a), (r + jit) * math.sin(a), zz)))
    rings.append(ring)
for r0, r1 in zip(rings, rings[1:]):
    for j in range(N): bm.faces.new((r0[j], r0[(j + 1) % N], r1[(j + 1) % N], r1[j]))
parts = [L.part("ring", bm, st, col(3, moss=0.85, h=0.3), smooth=0)]
for k in range(8):  # glyphs in the notches (radial: glyph top points outward), a/b/c/x cycling
    a = 2 * math.pi * (k * N / 8 + N / 16) / N
    M = Matrix.Translation(((RI + RO) / 2 * math.cos(a), (RI + RO) / 2 * math.sin(a), H - 0.045)) @ Matrix.Rotation(a - math.pi / 2, 4, "Z")
    parts.append(L.part(f"rune{k}", L.glyph("abcx"[k % 4], 0.2, M, width=0.16, depth=0.25), gr, WHITE))
bm = bmesh.new()
bmesh.ops.create_circle(bm, cap_ends=True, segments=16, radius=0.78)
bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.03))
parts.append(L.part("core", bm, gc, WHITE, smooth=0))
L.join(parts, "goal_circle")
save("goal_circle", (0, 0, 0.1), 3.0)

# ---------- 7a. kestrel anchor stake: tapered octagonal post, rune band, iron ring on top ----------
fresh()
wd, rn, rg_ = L.material("wood", vcol=True), L.material("rune", GOLD, emit=(GOLD, 1.0)), L.material("ring", "#4a4038")
wcol = lambda co, n: L.mix(WOOD_D, WOOD, 0.4 + 0.6 * (0.5 + 0.5 * math.sin(co.z * 9 + math.atan2(co.y, co.x) * 2)) * min(1, co.z / 0.4 + 0.3))
bm = bmesh.new()
lv = [(-0.05, 0.085), (0.0, 0.085), (0.75, 0.072), (1.02, 0.062), (1.08, 0.035)]
rs = [[bm.verts.new(((r + 0.006 * math.sin(3 * j + z * 5)) * math.cos(math.pi * j / 4 + 0.39), (r + 0.006 * math.sin(3 * j + z * 5)) * math.sin(math.pi * j / 4 + 0.39), z))
       for j in range(8)] for z, r in lv]
for r0, r1 in zip(rs, rs[1:]):
    for j in range(8): bm.faces.new((r0[j], r0[(j + 1) % 8], r1[(j + 1) % 8], r1[j]))
bm.faces.new(rs[-1])
parts = [L.part("post", bm, wd, wcol, smooth=0)]
bm = bmesh.new()  # rune band: a proud octagonal collar
bmesh.ops.create_cone(bm, cap_ends=False, segments=8, radius1=0.084, radius2=0.08, depth=0.1)
bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0), matrix=Matrix.Rotation(0.39, 3, "Z"))
bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.82))
parts.append(L.part("band", bm, rn, WHITE, smooth=0))
parts.append(L.part("band_glyph", L.glyph("a", 0.13, Matrix.Translation((0, -0.078, 0.6)) @ Matrix.Rotation(math.pi / 2, 4, "X"), depth=0.25), rn, WHITE))
tor = bmesh.new()  # ring: in the XZ plane, through the stake top

RM, Rm, NU, NV = 0.065, 0.016, 10, 4
vv = [[tor.verts.new(((RM + Rm * math.cos(2 * math.pi * v / NV)) * math.cos(2 * math.pi * u / NU), Rm * math.sin(2 * math.pi * v / NV),
                      1.13 + (RM + Rm * math.cos(2 * math.pi * v / NV)) * math.sin(2 * math.pi * u / NU))) for v in range(NV)] for u in range(NU)]
for u in range(NU):
    for v in range(NV): tor.faces.new((vv[u][v], vv[(u + 1) % NU][v], vv[(u + 1) % NU][(v + 1) % NV], vv[u][(v + 1) % NV]))
parts.append(L.part("ring", tor, rg_, WHITE, smooth=60))
L.join(parts, "anchor_stake")
e = bpy.data.objects.new("tie", None); bpy.context.scene.collection.objects.link(e); e.location = (0, 0, 1.13)  # cord attach point
save("anchor_stake", (0, 0, 0.62), 1.5)

# ---------- 7b. rope sag: one cord segment 1 m along -Y here (+Z glTF), sagging 0.12 m mid-span; scale Z for length ----------
fresh()
rp = L.material("rope", GOLD, emit=(GOLD, 0.4))
bm = bmesh.new()
SEG, SIDES, RR = 7, 3, 0.014
vs = []
for i in range(SEG + 1):
    s = i / SEG
    c = Vector((0, -s, -0.48 * s * (1 - s)))
    tang = Vector((0, -1, -0.48 * (1 - 2 * s))).normalized()
    side = Vector((1, 0, 0)); upn = side.cross(tang).normalized()
    vs.append([bm.verts.new(c + RR * (math.cos(2 * math.pi * k / SIDES) * side + math.sin(2 * math.pi * k / SIDES) * upn)) for k in range(SIDES)])
for r0, r1 in zip(vs, vs[1:]):
    for k in range(SIDES): bm.faces.new((r0[k], r0[(k + 1) % SIDES], r1[(k + 1) % SIDES], r1[k]))
L.part("rope_sag", bm, rp, WHITE, smooth=0)
save("rope_sag", (0, -0.5, -0.1), 1.3)

# ---------- 8. name stones: tall wedge (a), split boulder (b), leaning plinth (c); glyph on the front (-Y here, +Z glTF) ----------
fresh()
st = L.material("stone", vcol=True)
gm = {k: L.material(f"glyph_{k}", DIM) for k in "abc"}
# a: tall wedge, the top sheared off at a slant, thinning upward
bm = L.rock((0.36, 0.24, 0.85), (0, 0, 0.82), seed=81, box=0.28, rough=0.07, bottom=0.0)
for v in bm.verts:
    v.co.y *= 1 - 0.45 * v.co.z / 1.7; v.co.x *= 1 - 0.2 * v.co.z / 1.7
    v.co.z = min(v.co.z, 1.62 - 0.45 * v.co.x)
g = stamp(bm, "a", (0, -1, 0.95), (0, 1, 0), 0.42)
L.join([L.part("name_a", bm, st, col(1, h=1.6), smooth=0), L.part("g", g, gm["a"], WHITE)], "name_a")
# b: split boulder, two halves leaning apart, the glyph on the bigger left half
halves = []
for s, seed in ((1, 82), (-1, 83)):
    bm = L.rock((0.52, 0.42, 0.5), (0, 0, 0.45), seed=seed, box=0.5, rough=0.1, bottom=0.0)
    for v in bm.verts: v.co.x = s * max(s * v.co.x, 0.0) + s * 0.08
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-3)
    bmesh.ops.rotate(bm, verts=bm.verts, cent=(s * 0.08, 0, 0), matrix=Matrix.Rotation(-0.1 * s, 3, "Y") @ Matrix.Rotation(0.12 * s, 3, "Z"))
    halves.append(bm)
g = stamp(halves[0], "b", (0.3, -1, 0.5), (0, 1, 0), 0.36)
L.join([L.part("name_b", halves[0], st, col(2, h=0.9), smooth=0), L.part("b2", halves[1], st, col(5, h=0.9), smooth=0),
        L.part("g", g, gm["b"], WHITE)], "name_b")
# c: leaning plinth on a low base slab
base = L.rock((0.42, 0.36, 0.1), (0, 0, 0.08), seed=84, box=0.3, rough=0.08, bottom=0.0)
bm = L.rock((0.24, 0.2, 0.68), (0, 0, 0.7), seed=85, box=0.22, rough=0.05, bottom=0.12, top=1.36)
bmesh.ops.rotate(bm, verts=bm.verts, cent=(0, 0, 0.14), matrix=Matrix.Rotation(0.2, 3, "Y") @ Matrix.Rotation(-0.08, 3, "X"))
g = stamp(bm, "c", (0.12, -1, 0.85), (0, 1, 0), 0.3, up=Vector((math.sin(0.2), 0, math.cos(0.2))))
L.join([L.part("name_c", bm, st, col(3, h=1.3), smooth=0), L.part("base", base, st, col(4, h=0.3), smooth=0),
        L.part("g", g, gm["c"], WHITE)], "name_c")
save("name_stone", (0, 0, 0.8), 3.2, spread=1.3)

# ---------- 9. checkpoint cairn: six stacked flat stones, ~1 m, the top one cairn_light ----------
fresh()
st, cl = L.material("stone", vcol=True), L.material("cairn_light", PALE)
parts, z = [], 0.0
for i, (sx, sy, sz) in enumerate(((0.4, 0.34, 0.13), (0.31, 0.28, 0.11), (0.25, 0.22, 0.1), (0.19, 0.17, 0.09), (0.14, 0.13, 0.08), (0.11, 0.1, 0.1))):
    top = i == 5
    off = (0.025 * math.sin(2.3 * i), 0.025 * math.cos(1.7 * i))
    bm = L.rock((sx, sy, sz), (off[0], off[1], z + sz * 0.9), seed=90 + i, sub=2, box=0.5 if not top else 0.7, rough=0.1,
                rot=0.9 * i, tilt=(0.06 * math.sin(i), 0.06 * math.cos(i)), bottom=0.0 if i == 0 else None)
    parts.append(L.part(f"s{i}", bm, cl if top else st, WHITE if top else col(i, moss=0.7, h=1.0), smooth=0))
    z += sz * 1.75
L.join(parts, "cairn")
save("cairn", (0, 0, 0.5), 1.4)
