"""Song-target props v2 (headless Blender 5.x, same flat vertex-coloured storybook look as props_story / the NPCs).
Run (from repo root), one asset per run, the asset is picked by the output file name:
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/props_v2.py -- assets/props/v2/<name>.glb
Names: gust_stone_a|b|c, name_totem_k2|k3|k4, anchor_slab, anchor_bridge, wind_cairn, motif_bird|eye|wave|spiralstar.
Axes as npc_lib: front = -Y here (+Z in glTF), up = +Z, 1 unit = 1 m. Origin = ground contact (slab / bridge: centre of the walk top).
Dim "light-me" materials (#5b554b, code swaps them to gold by name when sung to): groove, name_glyph, anchor_glyph, cairn_light, motif.
rope (gold cords) and iron are final colours. See assets/props/v2/manifest.json for node names and clips."""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(__file__))
import npc_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
NAME = os.path.splitext(os.path.basename(OUT))[0]
L.reset()
STONE, DARK, MOSS, LIGHT = L.lin("#9a9086"), L.lin("#5f5850"), L.lin("#8d9a6a"), L.lin("#c9bfae")
WOOD, WOOD_D = L.lin("#8a6a4a"), L.lin("#5e4632")
GOLD, GOLD_D = L.lin("#f2c66a"), L.lin("#c08a3a")
IRON, IRON_L = L.lin("#3f3c39"), L.lin("#6b655d")
DIM = "#5b554b"
WHITE = lambda co, n: (1, 1, 1)
st = L.material("stone", vcol=True)
R = L.rock


def col(seed, moss=0.6, h=1.0, z0=0.0):
    def f(co, n):
        k = 0.5 + 0.5 * math.sin(co.x * 3.1 + co.y * 2.3 + seed) * math.cos(co.z * 4.7 - seed)
        c = L.mix(DARK, STONE, 0.5 + 0.5 * min(1, max(0, (co.z - z0) / h)))
        c = L.mix(c, LIGHT, 0.3 * k)
        if n.z > moss: c = L.mix(c, MOSS, min(1, (n.z - moss) * 2.5) * (0.3 + 0.4 * k))
        return c
    return f


wcol = lambda co, n: L.mix(WOOD_D, WOOD, 0.5 + 0.5 * math.sin(co.z * 9 + co.x * 3))
icol = lambda co, n: L.mix(IRON, IRON_L, 0.25 + 0.5 * max(0, n.z))
rcol = lambda co, n: L.mix(GOLD_D, GOLD, 0.6 + 0.4 * max(0, n.z))


def merge(bms):
    out = bmesh.new()
    for b in bms:
        me = bpy.data.meshes.new("tmp"); b.to_mesh(me); b.free(); out.from_mesh(me); bpy.data.meshes.remove(me)
    return out


def strokes(name, segs):  # register a stroke set with npc_lib's glyph builder (one box bar per segment)
    L.GLYPHS[name] = segs
    return name


def polyline(pts, closed=False):
    return [(a, b) for a, b in zip(pts, pts[1:] + (pts[:1] if closed else []))]


def spiral(turns=2.2, n=26, r0=0.06, r1=0.5, ph=0.0):
    return polyline([((r0 + (r1 - r0) * i / n) * math.cos(ph + 2 * math.pi * turns * i / n),
                      (r0 + (r1 - r0) * i / n) * math.sin(ph + 2 * math.pi * turns * i / n)) for i in range(n + 1)])


def stamp(bm, kind, origin, direction, size, up=Vector((0, 0, 1)), depth=0.07, width=0.14):
    """glyph set into the surface of `bm` where the ray origin->direction hits it, facing out along the hit normal (props_story)."""
    hit, nrm, _, _ = BVHTree.FromBMesh(bm).ray_cast(Vector(origin), Vector(direction).normalized())
    assert hit, f"glyph ray missed: {origin} {direction}"
    z = nrm.normalized()
    x = up.cross(z).normalized() if abs(up.dot(z)) < 0.95 else Vector((1, 0, 0))
    M = Matrix((x, z.cross(x), z)).transposed().to_4x4()
    M.translation = hit - z * size * depth * 0.4
    return L.glyph(kind, size, M, width=width, depth=depth)


def ribbon(bm, pts, origin, size, width=0.05, lift=0.012):
    """flat strip following the 2D polyline pts (unit scale, x right / y up) projected onto the -Y face of bm around origin."""
    bvh = BVHTree.FromBMesh(bm)
    out = bmesh.new()
    prev = None
    for i, (x, y) in enumerate(pts):
        a, b = pts[max(0, i - 1)], pts[min(len(pts) - 1, i + 1)]
        t = Vector((b[0] - a[0], b[1] - a[1])).normalized(); nn = Vector((-t.y, t.x)) * width / 2
        pair = []
        for side in (-1, 1):
            o = Vector((origin[0] + (x + nn.x * side / size) * size, -2, origin[2] + (y + nn.y * side / size) * size))
            hit, nrm, _, _ = bvh.ray_cast(o, Vector((0, 1, 0)))
            assert hit, f"ribbon ray missed {o}"
            pair.append(out.verts.new(hit + nrm * lift))
        if prev: out.faces.new((prev[0], prev[1], pair[1], pair[0]))
        prev = pair
    out.normal_update()
    out.faces.ensure_lookup_table()
    if out.faces and out.faces[0].normal.y > 0: bmesh.ops.reverse_faces(out, faces=out.faces)  # face the viewer (-Y)
    return out


def dense(segs, n=4):  # polyline segments -> point list, subdivided so the ribbon follows the stone's curve
    pts = []
    for (a, b) in segs:
        for k in range(n): pts.append((a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n))
    pts.append(segs[-1][1])
    return pts


def chains(segs):  # segment list -> connected point lists (a new list wherever a segment does not continue the last one)
    out = []
    for a, b in segs:
        if out and out[-1][-1] == a: out[-1].append(b)
        else: out.append([a, b])
    return out


def torus(c, Rr, r, M=Matrix(), nu=16, nv=6):
    """ring of radius Rr in the local XZ plane (hole along local Y), tube radius r, rotated by 3x3 M, centred at c."""
    bm = bmesh.new()
    rings = []
    for i in range(nu):
        a = 2 * math.pi * i / nu
        ca = Vector((math.cos(a), 0, math.sin(a)))
        rings.append([bm.verts.new(Vector(c) + M @ (ca * (Rr + r * math.cos(2 * math.pi * j / nv)) + Vector((0, r * math.sin(2 * math.pi * j / nv), 0))))
                      for j in range(nv)])
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((rings[i][j], rings[i][(j + 1) % nv], rings[(i + 1) % nu][(j + 1) % nv], rings[(i + 1) % nu][j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def cord(z, rx, ry, seed, r=0.05, nu=28, nv=8, ka=0.0):
    """gold rope ring hugging a post at height z, a knot lump at the front and two short tails (boss cord, scaled down)."""
    bm = bmesh.new()
    rings = []
    for i in range(nu):
        a = 2 * math.pi * i / nu
        c = Vector((math.sin(a) * rx, -math.cos(a) * ry, z + 0.025 * math.sin(3 * a + seed)))
        t = Vector((math.cos(a) * rx, math.sin(a) * ry, 0)).normalized(); nx = Vector((0, 0, 1)).cross(t).normalized(); nz = t.cross(nx)
        rings.append([bm.verts.new(c + (nx * math.cos(2 * math.pi * j / nv) + nz * math.sin(2 * math.pi * j / nv)) * r) for j in range(nv)])
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((rings[i][j], rings[(i + 1) % nu][j], rings[(i + 1) % nu][(j + 1) % nv], rings[i][(j + 1) % nv]))
    knot = [R((sz, sz * 0.8, sz * 0.9), (dx, -ry - 0.05, z + dz), seed=seed * 7 + k, sub=1, box=0.3, rough=0.15)
            for k, (dx, dz, sz) in enumerate(((0, 0, 0.1), (-0.07, -0.035, 0.065), (0.07, 0.03, 0.065)))]
    knot += [R((0.03, 0.025, 0.12), (0.04 * s, -ry - 0.07, z - 0.16), seed=seed * 5 + s, sub=1, box=0.2, rough=0.05, tilt=(0, 0.25 * s))
             for s in (1, -1)]
    for kb in knot:  # swing the knot round the ring to angle ka (0 = front), following the ellipse
        for v in kb.verts:
            a = ka + v.co.x / rx; r0 = -v.co.y / ry
            v.co.x, v.co.y = math.sin(a) * rx * r0, -math.cos(a) * ry * r0
    out = merge([bm] + knot)
    bmesh.ops.recalc_face_normals(out, faces=out.faces)
    return out


def chain(top, links=3, lr=0.06, r=0.016):  # chain stub hanging from `top`: links alternate 90 deg, each threaded through the last
    out = []
    for k in range(links):
        M = Matrix.Rotation(math.pi / 2 * (k % 2), 3, "Z") @ Matrix.Diagonal((0.7, 1, 1.15))
        out.append(torus(Vector(top) - Vector((0, 0, lr * 1.15 * (1 + 1.45 * k))), lr, r, M, nu=10, nv=5))
    return out


def plate_M(zc, y):  # glyph local XY -> the plate's front face (world XZ), raised toward -Y
    return Matrix(((1, 0, 0, 0), (0, 0, -1, y), (0, 1, 0, zc), (0, 0, 0, 1)))


def export():
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            bb = [Vector(c) for c in o.bound_box]
            print(f"PROP {NAME}/{o.name} tris={sum(len(p.vertices) - 2 for p in o.data.polygons)} mats={[m.name for m in o.data.materials]} "
                  f"z={min(v.z for v in bb):.2f}..{max(v.z for v in bb):.2f}")
    L.export(OUT)


# ---------- gust stones: standing stones with a carved spiral, teetering on a cracked foot. 'stone' topples, 'base' stays ----------
def gust_stone(size, lean, seed, grooves, foot):
    gr = L.material("groove", DIM)
    # the cracked base: two halves of a low plinth with a dark split between them, chips at the foot
    base = [R((0.42 * foot, 0.36 * foot, 0.13), (0.215 * s * foot, 0, 0.1), seed=seed + 3 + s, sub=2, box=0.45, rough=0.1,
              bottom=0.0, top=0.2, rot=0.05 * s) for s in (1, -1)]
    for v in base[0].verts: v.co.x = max(v.co.x, 0.015)
    for v in base[1].verts: v.co.x = min(v.co.x, -0.015); v.co.z *= 0.92  # one half settled lower: the stone tips that way
    base += [R((0.07, 0.06, 0.05), (0.42 * foot * c, -0.36 * foot * s2, 0.04), seed=seed + 9 + i, sub=1, bottom=0.0)
             for i, (c, s2) in enumerate(((0.9, 0.7), (-0.6, 0.95), (0.2, -1.05)))]
    L.part("base", merge(base), st, col(seed, h=0.3))
    # the stone: narrowing to a pinched foot so it visibly teeters, leaning by `lean` (rad about Y) over the low half
    w, d, h = size
    bm = R((w, d, h / 2), (0, 0, 0.18 + h / 2), seed=seed, sub=3, box=0.4, rough=0.08)
    for v in bm.verts:
        k = (v.co.z - 0.18) / h
        pinch = 0.45 + 0.55 * min(1, k * 2.2)          # the foot narrows: it stands on a small contact
        v.co.x *= pinch; v.co.y *= pinch * (1 - 0.12 * k)
        v.co.z = max(v.co.z, 0.17)
    bmesh.ops.transform(bm, matrix=Matrix.Rotation(lean, 4, "Y"), verts=bm.verts, space=Matrix.Translation((0, 0, -0.18)))
    zc = 0.18 + h * 0.58
    gs = [ribbon(bm, dense(L.GLYPHS[kind]), (math.sin(lean) * (zc - 0.18) + dx, 0, zc + dz), sz, width=0.045)
          for kind, dx, dz, sz in grooves]
    L.part("stone", bm, st, col(seed + 1, h=h))
    L.part("groove", merge(gs), gr, WHITE, smooth=0)


SP1 = strokes("spiral1", spiral(2.3, 30))
SP2 = strokes("spiral2", spiral(1.6, 18, 0.05, 0.42))
SPT = strokes("spiral_tail", spiral(1.8, 22, 0.05, 0.36) + [((0.36 * math.cos(2 * math.pi * 1.8), 0.36 * math.sin(2 * math.pi * 1.8)), (0.2, -0.9))])

# ---------- name totems: carved post bound by n gold knots (knot_1 lowest), each knot its own node so code unties them one by one ----------
def name_totem(n):
    gl = L.material("name_glyph", DIM)
    rope = L.material("rope", "#f2c66a", vcol=True)
    blocks = [R((0.36, 0.32, 0.16), (0, 0, 0.12), seed=60, sub=2, box=0.45, bottom=0.0)]  # footing stone
    for wx, wy, z0, z1, sd in ((0.32, 0.26, 0.2, 0.99, 61), (0.29, 0.24, 0.93, 1.58, 62), (0.31, 0.26, 1.52, 2.1, 63)):  # overlapping
        blocks.append(R((wx, wy, (z1 - z0) / 2), (0, 0, (z0 + z1) / 2), seed=sd, sub=2, box=0.32, rough=0.05))
    blocks.append(R((0.36, 0.3, 0.06), (0, -0.02, 2.1), seed=64, sub=2, box=0.3, rough=0.04))                  # brow ledge
    for s in (1, -1):                                                                                            # wind fins
        blocks.append(R((0.2, 0.05, 0.12), (0.4 * s, 0.02, 1.98), seed=65 + s, sub=1, box=0.3, rough=0.05, tilt=(0, -0.5 * s)))
    blocks.append(R((0.12, 0.1, 0.12), (0, 0, 2.27), seed=67, sub=1, box=0.4))                                 # cap knob
    body = merge(blocks)
    face = [stamp(body, "eye_l", (0.11, -2, 1.98), (0, 1, 0), 0.12, depth=0.25, width=0.4), stamp(body, "eye_l", (-0.11, -2, 1.98), (0, 1, 0), 0.12, depth=0.25, width=0.4)]
    glyph = stamp(body, "a", (0, -2, 1.27), (0, 1, 0), 0.3, depth=0.09, width=0.16)
    L.part("totem", body, st, col(60, h=2.2))
    L.part("name_glyph", merge([glyph]), gl, WHITE, smooth=0)
    L.part("eyes", merge(face), L.material("eyes", "#2e2a26"), WHITE, smooth=0)
    zs = {2: (0.96, 1.55), 3: (0.5, 0.96, 1.55), 4: (0.42, 0.72, 0.96, 1.55)}[n]   # on the block seams / lower block
    for i, z in enumerate(zs):
        rx = 0.36 if z < 1.2 else 0.34
        L.part(f"knot_{i + 1}", cord(z, rx, rx * 0.86, i + 1, ka=0.75 * (1 if i % 2 else -1)), rope, rcol, smooth=80)


strokes("eye_l", [((-0.5, 0), (0.5, 0))])

# ---------- anchor slab / bridge: flat stone you can walk on, iron rings sunk into the sides with chain stubs ----------
def iron_ring(p, side):  # eye bolt plate + vertical ring sticking out of a side face (side = outward unit X or Y), chain stub hanging
    ax = Vector(side)
    M = Matrix.Rotation(math.pi / 2, 3, "Z") if abs(ax.x) > 0.5 else Matrix()  # ring plane contains the outward axis
    p = Vector(p)
    parts = [R((0.07 if abs(ax.y) > 0.5 else 0.03, 0.07 if abs(ax.x) > 0.5 else 0.03, 0.07), p, seed=3, sub=1, box=0.25, rough=0.0),
             torus(p + ax * 0.11 - Vector((0, 0, 0.05)), 0.1, 0.022, M, nu=14, nv=6)]
    return parts + chain(p + ax * 0.11 - Vector((0, 0, 0.13)), 2)


def anchor_slab():
    ag = L.material("anchor_glyph", DIM)
    iron = L.material("iron", vcol=True)
    bm = R((1.2, 0.8, 0.3), (0, 0, -0.26), seed=80, sub=3, box=0.3, rough=0.06, top=0.0)
    for v in bm.verts:
        if v.co.z < -0.3: v.co.xy *= 0.75 + 0.25 * (v.co.z + 0.56) / 0.26   # tapers below like a floating island chip
    g = stamp(bm, "anchor", (0, 0, 2), (0, 0, -1), 0.7, up=Vector((0, 1, 0)), depth=0.05, width=0.1)
    L.part("slab", bm, st, col(80, moss=0.75, h=0.5, z0=-0.5))
    L.part("anchor_glyph", merge([g]), ag, WHITE, smooth=0)
    rings = []
    for p, s in (((1.17, 0, -0.16), (1, 0, 0)), ((-1.17, 0, -0.16), (-1, 0, 0)), ((0, -0.78, -0.16), (0, -1, 0))):
        rings += iron_ring(p, s)
    L.part("iron", merge(rings), iron, icol, smooth=50)


def anchor_bridge():
    ag = L.material("anchor_glyph", DIM)
    iron = L.material("iron", vcol=True)
    segs = []
    for i, (x, dz, rot) in enumerate(((-1.75, -0.01, 0.03), (0, 0.0, -0.02), (1.75, -0.015, 0.02))):
        b = R((0.86, 0.62, 0.22), (x, 0, -0.2 + dz), seed=90 + i, sub=3, box=0.28, rough=0.05, top=dz, rot=rot)
        for v in b.verts:
            if v.co.z < -0.2: v.co.y *= 0.8
        segs.append(b)
    bm = merge(segs)
    g = stamp(bm, "anchor", (0, 0, 2), (0, 0, -1), 0.6, up=Vector((0, 1, 0)), depth=0.05, width=0.1)
    L.part("bridge", bm, st, col(90, moss=0.75, h=0.4, z0=-0.4))
    L.part("anchor_glyph", merge([g]), ag, WHITE, smooth=0)
    rings = []
    for x in (-2.45, 2.45):
        for y in (-0.6, 0.6):
            rings += iron_ring((x, y, -0.13), (0, math.copysign(1, y), 0))
    L.part("iron", merge(rings), iron, icol, smooth=50)


strokes("anchor", [((0, -0.5), (0, 0.42)), ((-0.24, 0.24), (0.24, 0.24))] +
        polyline([(0.4 * math.cos(a), -0.12 + 0.4 * math.sin(a)) for a in [math.pi + i * math.pi / 6 for i in range(7)]]) +
        [((0, 0.42), (0, 0.5))])

# ---------- wind cairn: stacked stones, a leaning post with an arm, 4 hanging chimes (bones chime_1..4) ----------
def wind_cairn():
    wood = L.material("wood", vcol=True)
    cl = L.material("cairn_light", DIM)
    stones = [R((0.42, 0.36, 0.16), (0, 0, 0.14), seed=100, box=0.45, bottom=0.0),
              R((0.33, 0.29, 0.14), (0.03, 0.01, 0.42), seed=101, box=0.45, rot=0.4),
              R((0.25, 0.22, 0.12), (-0.02, 0.0, 0.66), seed=102, box=0.45, rot=-0.3),
              R((0.16, 0.15, 0.1), (0.02, 0.0, 0.85), seed=103, box=0.5, rot=0.8)]
    L.part("cairn", merge(stones), st, col(100, h=0.9))
    L.part("cairn_light", R((0.09, 0.08, 0.07), (0.01, 0, 0.99), seed=104, sub=2, box=0.4), cl, WHITE)
    # post rising behind the stack, an arm reaching forward over it
    post = [R((0.06, 0.06, 0.95), (0, 0.32, 0.95), seed=105, sub=2, box=0.15, rough=0.04, bottom=0.0, tilt=(0.05, 0)),
            R((0.05, 0.62, 0.05), (0, -0.13, 1.84), seed=106, sub=2, box=0.15, rough=0.03, tilt=(0, 0))]
    L.part("post", merge(post), wood, wcol)
    bones = [("root", (0, 0, 0), (0, 0, 0.3), None)]
    for i, (x, y, ln) in enumerate(CHIMES):
        top = Vector((x, y, 1.8))
        bones.append((f"chime_{i + 1}", tuple(top), tuple(top + Vector((0, 0, 0.15))), "root"))
        string = R((0.008, 0.008, ln / 2), top - Vector((0, 0, ln / 2)), seed=1, sub=1, box=0.1, rough=0)
        tube = R((0.035, 0.035, 0.1 + 0.02 * i), top - Vector((0, 0, ln + 0.08 + 0.02 * i)), seed=110 + i, sub=2, box=0.12, rough=0.02)
        L.part(f"chime_{i + 1}", merge([string, tube]), wood if i % 2 else st, wcol if i % 2 else col(110 + i), f"chime_{i + 1}", smooth=40)
    arm = L.armature("wind_cairn", bones)
    for o in [o for o in bpy.context.scene.objects if o.type == "MESH"]:
        if o.name.startswith("chime_"): L.skin(o, arm)
    S = lambda t, k, ph: math.sin(2 * math.pi * (k * t + ph))
    L.clip(arm, "chime_idle", 72, lambda t: {f"chime_{i + 1}": ((5 * S(t, 1, 0.23 * i), 0, 3 * S(t, 2, 0.4 * i)), None, None) for i in range(4)})
    def ring(t):  # struck by the wind: a big swing that decays, chimes slightly out of phase
        return {f"chime_{i + 1}": ((26 * math.exp(-3.2 * t) * S(t, 3.5, 0.08 * i), 0, 12 * math.exp(-3 * t) * S(t, 3, 0.25 + 0.1 * i)), None, None)
                for i in range(4)}
    L.clip(arm, "chime_ring", 48, ring, loop=False)


CHIMES = [(0.0, -0.08, 0.28), (0.0, -0.24, 0.36), (0.0, -0.4, 0.3), (0.0, -0.56, 0.4)]

# ---------- motif plates: upright carved stone tablets, one motif each (dim 'motif' strokes, code lights the matching pair) ----------
MOTIFS = {
    "bird": polyline([(-0.5, -0.05), (-0.36, 0.14), (-0.18, 0.2), (0, 0.02), (0.18, 0.2), (0.36, 0.14), (0.5, -0.05)])
             + [((0, 0.02), (0, -0.22)), ((0, -0.22), (-0.13, -0.38)), ((0, -0.22), (0.13, -0.38))],
    "eye": polyline([(0.5 * math.cos(a), 0.26 * math.sin(a) * abs(math.sin(a)) ** 0.3) for a in [2 * math.pi * i / 16 for i in range(16)]], True)
           + polyline([(0.13 * math.cos(a), 0.13 * math.sin(a)) for a in [2 * math.pi * i / 8 for i in range(8)]], True),
    "wave": polyline([(-0.5 + i / 12, 0.2 + 0.12 * math.sin(i / 12 * 2 * math.pi * 1.5)) for i in range(13)])
            + polyline([(-0.5 + i / 12, -0.2 + 0.12 * math.sin(i / 12 * 2 * math.pi * 1.5 + 1.2)) for i in range(13)]),
    "spiralstar": spiral(1.4, 16, 0.09, 0.27) + [((0.33 * math.cos(a), 0.33 * math.sin(a)), (0.5 * math.cos(a), 0.5 * math.sin(a)))
                                                 for a in [math.pi / 4 + i * math.pi / 2 for i in range(4)]],
}


def motif(kind):
    mo = L.material("motif", DIM)
    plate = R((0.46, 0.09, 0.5), (0, 0, 0.62), seed=120 + len(kind), sub=3, box=0.25, rough=0.04)
    foot = R((0.4, 0.22, 0.1), (0, 0.02, 0.09), seed=125, sub=2, box=0.4, bottom=0.0)
    strokes(kind, MOTIFS[kind])
    g = [ribbon(plate, dense(polyline(c), 3), (0, 0, 0.64), 0.62, width=0.055) for c in chains(MOTIFS[kind])]
    L.part("plate", merge([plate, foot]), st, col(120, h=1.1))
    L.part("motif", merge(g), mo, WHITE, smooth=0)


# ---------- squall core: a (2,3) knotted-wind tube around a small pale eye; origin = centre (it hovers), ~0.7 m across ----------
def squall_core():
    wind = L.material("squall", "#e8f4f0", vcol=True, alpha=0.75, double=True)
    eye = L.material("squall_eye", "#c8f0e6", emit=("#bff3e6", 1.2))
    bm = bmesh.new()
    NU, NV, r = 120, 8, 0.045
    pts = [Vector(((0.22 + 0.1 * math.cos(3 * a)) * math.cos(2 * a), (0.22 + 0.1 * math.cos(3 * a)) * math.sin(2 * a), 0.1 * math.sin(3 * a)))
           for a in [2 * math.pi * i / NU for i in range(NU)]]
    up = Vector((0, 0, 1))
    rings = []
    for i, c in enumerate(pts):
        t = (pts[(i + 1) % NU] - pts[i - 1]).normalized(); nx = t.cross(up).normalized(); nz = nx.cross(t)
        rr = r * (0.75 + 0.25 * math.sin(6 * 2 * math.pi * i / NU))  # gusty swell along the tube
        rings.append([bm.verts.new(c + (nx * math.cos(2 * math.pi * j / NV) + nz * math.sin(2 * math.pi * j / NV)) * rr) for j in range(NV)])
    for i in range(NU):
        for j in range(NV):
            bm.faces.new((rings[i][j], rings[(i + 1) % NU][j], rings[(i + 1) % NU][(j + 1) % NV], rings[i][(j + 1) % NV]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    L.part("squall", bm, wind, lambda co, n: L.mix(L.lin("#9fd6cc"), L.lin("#f4fbf8"), 0.5 + 0.5 * n.z), smooth=80)
    L.part("squall_eye", R((0.09, 0.09, 0.09), (0, 0, 0), seed=7, sub=2, box=0.9, rough=0.05), eye, WHITE, smooth=80)


if NAME.startswith("gust_stone_"):
    gust_stone(*{"a": ((0.34, 0.24, 1.55), 0.19, 10, [(SP1, 0, 0.02, 0.5)], 1.0),
                 "b": ((0.48, 0.4, 1.05), -0.24, 20, [(SP2, -0.13, 0.12, 0.36), (SP2, 0.15, -0.12, 0.32)], 1.15),
                 "c": ((0.26, 0.22, 1.95), 0.14, 30, [(SPT, 0, 0.1, 0.42)], 0.9)}[NAME[-1]])
elif NAME.startswith("name_totem_k"): name_totem(int(NAME[-1]))
elif NAME == "anchor_slab": anchor_slab()
elif NAME == "anchor_bridge": anchor_bridge()
elif NAME == "wind_cairn": wind_cairn()
elif NAME.startswith("motif_"): motif(NAME[6:])
elif NAME == "squall_core": squall_core()
else: raise SystemExit(f"unknown prop {NAME}")
export()
