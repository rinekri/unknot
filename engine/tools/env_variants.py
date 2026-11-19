"""Environment variants v2: Blender deforms of the existing Tripo props (same mesh + same 1024 texture, no new generation).
Run (from repo root), one variant per run, picked by the output file name:
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/env_variants.py -- assets/props/v2/<name>.glb
Names: ruin_pillar_b|c, ruin_arch_b|c, wind_tree_b|c, rubble_b|c. Origin stays at the ground centre, +Z up here (glTF +Y).
Cuts are capped (bisect fill) and the caps borrow the UV of the nearest original vertex, so a broken face shows the same stone."""
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
NAME = os.path.splitext(os.path.basename(OUT))[0]
SRC = NAME.rsplit("_", 1)[0]
# scale xyz, lean (deg about X, Y), bend (deg, SimpleDeform about X over the height), cuts [(plane point, plane normal pointing at the part to drop)], yaw deg
V = {
    "ruin_pillar_b": dict(scale=(1.1, 1.1, 0.9), lean=(0, 5), cuts=[((0, 0, 1.45), (0.35, 0.1, 1))], yaw=70),          # snapped short, slanted break
    "ruin_pillar_c": dict(scale=(0.95, 0.95, 1.12), lean=(-8, 3), cuts=[((0, 0, 2.55), (-0.2, 0, 1))], yaw=200),  # tall, leaning, chipped crown
    "ruin_arch_b": dict(scale=(1, 1, 1), cuts=[((0, 0.9, 1.5), (0, 0.35, 1))], yaw=0),                              # one shoulder of the arch fallen
    "ruin_arch_c": dict(scale=(1.05, 1.3, 0.92), lean=(0, 0), bend=-6, yaw=180),                                         # wider, sagging span
    "wind_tree_b": dict(scale=(0.85, 0.85, 0.85), bend=-22, yaw=0),                                                      # young tree, bent hard downwind
    "wind_tree_c": dict(scale=(-1.1, 1.1, 1.18), bend=8, yaw=0),                                                         # tall, mirrored, straighter
    "rubble_b": dict(scale=(-1.25, 0.85, 0.75), yaw=40),                                                                 # long low spill
    "rubble_c": dict(scale=(0.7, 0.66, 0.8), yaw=150),                                                                  # small heap
}[NAME]

for o in list(bpy.data.objects): bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=f"assets/props/{SRC}/{SRC}.glb")
ob = [o for o in bpy.data.objects if o.type == "MESH"][0]
bpy.context.view_layer.objects.active = ob
ob.select_set(True)
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = ob.data

bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)  # glTF splits verts at UV seams: weld them so only real cut edges are open
bm.verts.index_update()
uv = bm.loops.layers.uv.active
kd = KDTree(len(bm.verts))
for v in bm.verts: kd.insert(v.co, v.index)
kd.balance()
orig_uv = {}
for f in bm.faces:
    for l in f.loops: orig_uv.setdefault(l.vert.index, l[uv].uv.copy())
for p, n in V.get("cuts", []):
    old = set(bm.faces)
    r = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), plane_co=p, plane_no=Vector(n).normalized(),
                               clear_outer=True)
    cut = [e for e in r["geom_cut"] if isinstance(e, bmesh.types.BMEdge)]
    if cut:
        fill = bmesh.ops.holes_fill(bm, edges=[e for e in cut if e.is_valid and e.is_boundary], sides=0)
        new = set(fill["faces"])
        bmesh.ops.triangulate(bm, faces=list(new))
        for f in [f for f in bm.faces if f not in old]:
            for l in f.loops:
                _, i, _ = kd.find(l.vert.co)
                l[uv].uv = orig_uv.get(i, l[uv].uv)
if V.get("cuts"):  # a cut can leave chips with nothing under them: drop small pieces that touch no other piece
    seen, comps = set(), []
    for f in bm.faces:
        if f in seen: continue
        stack, comp = [f], set()
        while stack:
            g = stack.pop()
            if g in comp: continue
            comp.add(g)
            stack += [h for e in g.edges for h in e.link_faces if h not in comp]
        seen |= comp; comps.append(comp)
    total = len(bm.faces)
    for comp in comps:
        vs = {v for f in comp for v in f.verts}
        if len(comp) > 0.04 * total or min(v.co.z for v in vs) < 0.05: continue
        others = KDTree(len(bm.verts) - len(vs))
        for v in bm.verts:
            if v not in vs: others.insert(v.co, v.index)
        others.balance()
        if min(others.find(v.co)[2] for v in vs) > 0.03:
            bmesh.ops.delete(bm, geom=list(comp), context="FACES")
            print(f"ENV dropped floating chip faces={len(comp)}")
bm.normal_update()
bm.to_mesh(me); bm.free()

S = Matrix.Diagonal((*V.get("scale", (1, 1, 1)), 1))
ln = V.get("lean", (0, 0))
Lm = Matrix.Rotation(math.radians(ln[0]), 4, "X") @ Matrix.Rotation(math.radians(ln[1]), 4, "Y")
me.transform(Matrix.Rotation(math.radians(V.get("yaw", 0)), 4, "Z") @ Lm @ S)
if S.determinant() < 0: me.flip_normals()
if V.get("bend"):  # bend about X, growing with height^2 (positive tips the top toward -Y)
    h = max(v.co.z for v in me.vertices)
    a = math.radians(V["bend"])
    for v in me.vertices:
        k = max(0.0, v.co.z) / h
        th = a * k * k
        y, z = v.co.y, v.co.z
        v.co.y, v.co.z = y * math.cos(th) - z * math.sin(th), y * math.sin(th) + z * math.cos(th)  # progressive rotation = bend
me.update()
zmin = min(v.co.z for v in me.vertices)
for v in me.vertices: v.co.z -= zmin  # back on the ground
ob.name = me.name = f"{NAME}__{ob.name.split('__')[-1]}"
tris = sum(len(p.vertices) - 2 for p in me.polygons)
print(f"ENV {NAME} tris={tris} dims={[round(x, 2) for x in ob.dimensions]}")
print(f"NPC_EXPORT {OUT} tris={tris}")
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_image_format="JPEG", export_animations=False)
