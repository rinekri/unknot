"""Decor props (headless Blender 5.x, same look as props_story.py): pure set dressing, a separate family from the interactive
props. No glyphs, no gold, no spirals, no streamers: whatever wears those must react to a strike (rune / totem / stake / name stone).
Run (from repo root):
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/props_decor.py -- assets/props [--qa <png dir>]
Writes into <out dir>: menhir.glb, totem_stump.glb, knot_post.glb (axes as npc_lib: front -Y here, +Z glTF; origin = ground contact).
  menhir: a plain weathered standing stone, leaning, moss climbing from the foot (l1 spawn ring).
  totem_stump: a snapped, rotted pole stump with its broken length lying along -X (l2 spawn: the fallen totem).
  knot_post: two nodes, knot_post (charred post) + knot_rope (hemp wraps, frayed tails): Orren's binding posts (l3 crown);
  level.js moves each node on its own (the rope slips off, the post sinks) when Orren's matching rune is struck."""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix, noise
sys.path.insert(0, os.path.dirname(__file__))
import npc_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
QA = argv[argv.index("--qa") + 1] if "--qa" in argv else None
GREY, GREY_D, MOSS, LICHEN = L.lin("#8a8a80"), L.lin("#4f524b"), L.lin("#7f9157"), L.lin("#b9b7a2")
ROT, ROT_D, ROT_M, CHAR, CHAR_D = L.lin("#7a634d"), L.lin("#463829"), L.lin("#6f7a4c"), L.lin("#3e342c"), L.lin("#241e1a")
HEMP, HEMP_D = L.lin("#9b8a6c"), L.lin("#6a5c47")


def fresh():
    L.reset()
    for o in list(bpy.data.objects): bpy.data.objects.remove(o)


def report(name):
    for o in bpy.context.scene.objects:
        if o.type != "MESH": continue
        bb = [Vector(c) for c in o.bound_box]
        print(f"PROP {name}/{o.name} tris={sum(len(p.vertices) - 2 for p in o.data.polygons)} mats={[m.name for m in o.data.materials]} "
              f"bbox={[round(min(v[i] for v in bb), 2) for i in range(3)]}..{[round(max(v[i] for v in bb), 2) for i in range(3)]}")


def save(name, center, scale):
    report(name)
    L.export(f"{OUT}/{name}.glb")
    if not QA: return
    cam, tgt = L.qa_setup()
    L.shoot(f"{QA}/prop_{name}_34.png", cam, tgt, center, scale, yaw=35, el=22)
    L.shoot(f"{QA}/prop_{name}_front.png", cam, tgt, center, scale, yaw=0, el=6)


def part(name, bm, mat, color, smooth=0):  # L.part with outward normals (the tubes are built by hand, culling is on)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return L.part(name, bm, mat, color, smooth=smooth)


def tube(bm, rings, sides, rad, cap_top=True, cap_bottom=False, phase=0.0):
    """rings = [(centre Vector, radius scale)], one loop of `sides` verts per ring (axis ~Z), side faces between loops."""
    loops = [[bm.verts.new(c + Vector((rad * s * math.cos(2 * math.pi * j / sides + phase), rad * s * math.sin(2 * math.pi * j / sides + phase), 0)))
              for j in range(sides)] for c, s in rings]
    for a, b in zip(loops, loops[1:]):
        for j in range(sides): bm.faces.new((a[j], a[(j + 1) % sides], b[(j + 1) % sides], b[j]))
    if cap_top: bm.faces.new(loops[-1])
    if cap_bottom: bm.faces.new(list(reversed(loops[0])))
    return loops


# ---------- menhir: tall plain standing stone (~1.6 m), narrowing and leaning, moss from the foot; shares 'stone' ----------
fresh()
st = L.material("stone", vcol=True)
bm = L.rock((0.27, 0.19, 0.82), (0, 0, 0.78), seed=111, sub=3, box=0.42, rough=0.13, bottom=0.0)
for v in bm.verts:
    k = max(0.0, v.co.z) / 1.6
    v.co.x *= 1 - 0.35 * k; v.co.y *= 1 - 0.3 * k   # thins upward, a blunt worn top
    v.co.z = min(v.co.z, 1.58 - 0.18 * v.co.y)
    v.co.x += 0.16 * k * k                          # leans off true (+X), like a stone settled in soft ground
def mcol(co, n):
    k = 0.5 + 0.5 * noise.noise(co * 3.3 + Vector((7, 1, 3)))
    c = L.mix(GREY_D, GREY, 0.35 + 0.5 * k)
    c = L.mix(c, LICHEN, 0.25 * max(0.0, noise.noise(co * 7.0)))
    m = max(0.0, 1 - co.z / 0.55) * 0.85 + (0.5 if n.z > 0.55 else 0.0)  # moss climbs from the foot and sits on the ledges
    return L.mix(c, MOSS, min(1.0, m * (0.55 + 0.45 * k)))
part("menhir", bm, st, mcol, smooth=0)
save("menhir", (0.05, 0, 0.8), 2.0)

# ---------- totem stump: a snapped, rotted pole (no carving, no base) and its broken length lying along -X; shares 'wood' ----------
fresh()
wd = L.material("wood", vcol=True)
SIDES = 9
bm = bmesh.new()
lo = tube(bm, [(Vector((0, 0, -0.05)), 1.12), (Vector((0, 0, 0.05)), 1.08), (Vector((0.005, 0, 0.3)), 1.0), (Vector((0.01, 0, 0.42)), 0.97)],
          SIDES, 0.13, cap_top=False)
top = lo[-1]
for j, v in enumerate(top): v.co.z += [0.16, 0.02, 0.09, -0.03, 0.12, 0.0, 0.2, 0.05, -0.02][j]  # splintered break
c = bm.verts.new(sum((v.co for v in top), Vector()) / SIDES + Vector((0, 0, -0.04)))
for j in range(SIDES): bm.faces.new((top[j], top[(j + 1) % SIDES], c))
parts = [bm]
bm = bmesh.new()  # the broken length: 1.45 m along -X, half sunk, its snapped end facing the stump
rings = [(Vector((-0.28 - 1.45 * u, 0.04 * math.sin(u * 4), 0.1 - 0.02 * u)), 0.95 - 0.12 * u) for u in (0, 0.02, 0.35, 0.7, 0.98, 1.0)]
lo = tube(bm, [(c_, s) for c_, s in rings], SIDES, 0.12, cap_top=False)
for loop in lo:  # turn the loops to face along X
    cen = sum((v.co for v in loop), Vector()) / SIDES
    for v in loop: d = v.co - cen; v.co = cen + Vector((0, d.y, d.x))
for j, v in enumerate(lo[0]): v.co.x += [0.12, 0.0, 0.07, -0.02, 0.1, 0.03, 0.15, 0.0, 0.05][j]  # its splintered end
bm.faces.new(list(reversed(lo[0]))); bm.faces.new(lo[-1])
parts.append(bm)
def wcol(co, n):
    k = 0.5 + 0.5 * math.sin(co.z * 21 + co.x * 13 + math.atan2(co.y, co.x) * 3)  # rough grain, no pattern
    c = L.mix(ROT_D, ROT, 0.3 + 0.5 * k)
    if n.z > 0.35 or co.z < 0.08: c = L.mix(c, ROT_M, 0.55)  # damp moss on the top surfaces and the foot
    return c
L.join([part("totem_stump", parts[0], wd, wcol, smooth=0), part("log", parts[1], wd, wcol, smooth=0)], "totem_stump")
save("totem_stump", (-0.75, 0, 0.2), 2.4)

# ---------- knot post: weathered grey post bound with hemp rope (wraps + frayed tails); nodes knot_post / knot_rope ----------
fresh()
wd, rp = L.material("wood", vcol=True), L.material("cord", vcol=True)
bm = bmesh.new()
lo = tube(bm, [(Vector((0, 0, -0.08)), 1.1), (Vector((0, 0, 0.0)), 1.08), (Vector((0.01, 0, 0.6)), 1.0), (Vector((0.02, 0, 1.2)), 0.9), (Vector((0.025, 0, 1.42)), 0.82)],
          7, 0.1, cap_top=False, phase=0.3)
top = lo[-1]
for j, v in enumerate(top): v.co.z += [0.06, -0.04, 0.1, 0.0, -0.06, 0.08, 0.02][j]  # split, burnt top
c = bm.verts.new(sum((v.co for v in top), Vector()) / 7 + Vector((0, 0, 0.05)))
for j in range(7): bm.faces.new((top[j], top[(j + 1) % 7], c))
WEA, WEA_D = L.lin("#9a8f7c"), L.lin("#5f5648")  # weathered, sun-bleached wood (not char: no black rods on the terrace)
pcol = lambda co, n: L.mix(WEA_D, WEA, 0.35 + 0.4 * (0.5 + 0.5 * math.sin(co.z * 17 + math.atan2(co.y, co.x) * 2)) * min(1, co.z / 1.2 + 0.2))
post = part("knot_post", bm, wd, pcol, smooth=0)
L.join([post], "knot_post")
ropes = []
RR, NU, NV = 0.02, 10, 3
for i, (z, tilt) in enumerate(((0.78, 0.12), (0.88, -0.1), (0.98, 0.14), (1.07, -0.06))):  # four tight, uneven wraps
    tor = bmesh.new()
    R0 = 0.1 * (1.0 - 0.1 * (z - 0.6) / 0.6) + RR * 0.6
    vv = [[tor.verts.new(Matrix.Rotation(tilt, 3, "X") @ Matrix.Rotation(0.4 * i, 3, "Z") @ Vector(((R0 + RR * math.cos(2 * math.pi * v / NV)) * math.cos(2 * math.pi * u / NU),
                                                                                             (R0 + RR * math.cos(2 * math.pi * v / NV)) * math.sin(2 * math.pi * u / NU), RR * math.sin(2 * math.pi * v / NV)))
                             + Vector((0.012, 0, z))) for v in range(NV)] for u in range(NU)]
    for u in range(NU):
        for v in range(NV): tor.faces.new((vv[u][v], vv[(u + 1) % NU][v], vv[(u + 1) % NU][(v + 1) % NV], vv[u][(v + 1) % NV]))
    ropes.append(tor)
for x0, sway, ln in ((0.115, 0.05, 0.42), (0.1, -0.06, 0.3)):  # two frayed tails hanging off the knot on the front-right
    bm = bmesh.new()
    pts = [Vector((x0 + sway * s * s, -0.06 - 0.03 * s, 1.0 - ln * s)) for s in (0, 0.33, 0.66, 1.0)]
    loops = [[bm.verts.new(p + Vector((RR * 0.8 * math.cos(2 * math.pi * k / 3), RR * 0.8 * math.sin(2 * math.pi * k / 3), 0))) for k in range(3)] for p in pts]
    for a, b in zip(loops, loops[1:]):
        for k in range(3): bm.faces.new((a[k], a[(k + 1) % 3], b[(k + 1) % 3], b[k]))
    for k in range(3): loops[-1][k].co += Vector((0.025 * math.cos(2.1 * k), 0.025 * math.sin(2.1 * k), -0.03 * k))  # splayed, frayed end
    bm.faces.new(list(reversed(loops[-1])))
    ropes.append(bm)
rcol = lambda co, n: L.mix(HEMP_D, HEMP, 0.45 + 0.4 * (0.5 + 0.5 * math.sin(co.z * 60 + math.atan2(co.y, co.x) * 6)))
L.join([part(f"r{i}", b, rp, rcol, smooth=40) for i, b in enumerate(ropes)], "knot_rope")
save("knot_post", (0, 0, 0.72), 1.7)
