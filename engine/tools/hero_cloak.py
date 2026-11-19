"""The cand_s11 cloak (segmented Tripo parts: p1 hood + shoulder cape, p0 ragged lower cape) draped onto the idle-pose body,
then moved back to bind space for hero_rig. Replaces the hood/skirt that hero_assemble.py leaves in.
Run (from repo root), between hero_assemble.py and hero_rig.py:
  Blender -b --factory-startup --python engine/tools/hero_cloak.py -- in.glb seg_s11.glb out.glb [debug_idle.glb]
in.glb = hero_assemble output; seg_s11.glb = seg_s11/model_url.glb. out.glb = the same meshes and clips with hero_hood = p1,
hero_skirt = p0 (their own texture in the atlas cells the old hood/skirt used), the backpack seated on the cloak, the hair
trimmed under the hood, body faces hidden under the cloth deleted. debug_idle.glb: static idle-pose scene for a quick look.
World axes (Blender, after import): hero faces -Y, hero's left = +X, up = +Z."""
import bpy, bmesh, sys, os, math, colorsys
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

argv = sys.argv[sys.argv.index("--") + 1:]
SRC, SEG, OUT = argv[0], argv[1], argv[2]
DBG = argv[3] if len(argv) > 3 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in sc.objects if o.type == "ARMATURE")
OBJ = {o.name: o for o in sc.objects if o.type == "MESH"}
body, pack = OBJ["hero_body"], OBJ["gear_backpack"]
mat = OBJ["hero_skirt"].data.materials[0]
pack.data.transform(pack.matrix_world); pack.matrix_world = Matrix()
for n in ("hero_hood", "hero_skirt"): bpy.data.objects.remove(OBJ[n])
MW = arm.matrix_world.copy()
bw = lambda n: MW @ arm.data.bones[n].head_local

# ---------- backpack: side bulges pulled in (narrower across the back, about its own centre) ----------
PACK_W = 0.8
pc = sum((v.co for v in pack.data.vertices), Vector()) / len(pack.data.vertices)
for v in pack.data.vertices: v.co.x = pc.x + (v.co.x - pc.x) * PACK_W

# ---------- s11 cloak parts in the hero frame (as hero_assemble places the segmentation: 0.5 up, then -90 deg about Z, x1.3) ----------
old = set(sc.objects)
bpy.ops.import_scene.gltf(filepath=SEG)
seg = {int(o.name.rsplit("_", 1)[1]): o for o in set(sc.objects) - old if o.name.startswith("tripo_part_")}
for o in set(sc.objects) - old:
    if o not in (seg[0], seg[1]): bpy.data.objects.remove(o)  # the other parts (body, pack, ...) and helpers must not be exported
FR = Matrix.Scale(1.3, 4) @ Matrix.Rotation(math.radians(-90), 4, "Z") @ Matrix.Translation((0, 0, 0.5))
A, PAD = 2048, 3
img = next(n.image for n in mat.node_tree.nodes if n.type == "TEX_IMAGE")
atlas = np.array(img.pixels[:], np.float32).reshape(A, A, 4)
CELL = {1: (0, 1536, 512), 0: (512, 1536, 512)}  # the old hood / skirt cells
HD = bw("Head")
bm = bmesh.new()
part = bm.faces.layers.int.new("part")
uvl = bm.loops.layers.uv.new("UVMap")
for k in (1, 0):
    o = seg[k]
    X0, Y0, S = CELL[k]
    simg = next(n.image for n in o.data.materials[0].node_tree.nodes if n.type == "TEX_IMAGE")
    simg.scale(S - 2 * PAD, S - 2 * PAD)
    atlas[Y0 + PAD:Y0 + S - PAD, X0 + PAD:X0 + S - PAD] = np.array(simg.pixels[:], np.float32).reshape(S - 2 * PAD, S - 2 * PAD, 4)
    sb = bmesh.new(); sb.from_mesh(o.data); sb.transform(FR @ o.matrix_world)
    suv = sb.loops.layers.uv.active
    for f in sb.faces:
        for l in f.loops: u = l[suv].uv; l[suv].uv = ((X0 + PAD + u.x * (S - 2 * PAD)) / A, (Y0 + PAD + u.y * (S - 2 * PAD)) / A)
    bmesh.ops.remove_doubles(sb, verts=sb.verts, dist=0.0004)  # glTF splits vertices at UV seams: weld them back
    if k == 1:  # crown tears where the hair poked through: boundary loops centred 5 cm above the head bone are filled
        seen = set()
        for e in list(sb.edges):
            if not e.is_valid or not e.is_boundary or e in seen: continue
            loop, st = [], [e]; seen.add(e)
            while st:
                g = st.pop(); loop.append(g)
                for v in g.verts:
                    for h in v.link_edges:
                        if h.is_boundary and h not in seen: seen.add(h); st.append(h)
            if (sum((g.verts[0].co for g in loop), Vector()) / len(loop)).z > HD.z + 0.05:
                for f in bmesh.ops.holes_fill(sb, edges=loop, sides=len(loop))["faces"]:
                    for l in f.loops:  # UV of the same vertex in a neighbouring old face
                        l[suv].uv = next((m[suv].uv.copy() for m in l.vert.link_loops if m.face is not f), l[suv].uv)
    tmp = bpy.data.meshes.new("tmp"); sb.to_mesh(tmp); sb.free()
    n0 = len(bm.faces); bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    bm.faces.ensure_lookup_table()
    for f in bm.faces[n0:]: f[part] = k
    bpy.data.objects.remove(o)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0004)  # p1/p0 share their segmentation border
# segmentation leftovers: faces textured as pack/strap leather (dark saturated brown) or shirt collar (pale, unsaturated)
# are not cloak; the gold brooch is bright and saturated, so it survives both tests
rgb = atlas[..., :3]
mx, mn = rgb.max(-1), rgb.min(-1)
sat = (mx - mn) / np.maximum(mx, 1e-6)
notcloak = []
for f in bm.faces:
    u = sum((l[uvl].uv for l in f.loops), Vector((0, 0))) / len(f.loops)
    y, x = min(A - 1, int(u.y * A)), min(A - 1, int(u.x * A))
    r, g, b = rgb[y, x]; h = colorsys.rgb_to_hsv(r, g, b)[0]
    leather = 0.02 < h < 0.11 and sat[y, x] > 0.45 and mx[y, x] < 0.6
    collar = sat[y, x] < 0.12 and mx[y, x] > 0.8 and f.calc_center_median().z < HD.z
    if leather or collar: notcloak.append(f)
print("NOT_CLOAK", len(notcloak))
bmesh.ops.delete(bm, geom=notcloak, context="FACES")
# loose shards (segmentation confetti, sleeve/cuff bits) go; the sheets stay
seen, kill, sizes = set(), [], []
for f in bm.faces:
    if f in seen: continue
    comp, st = [], [f]; seen.add(f)
    while st:
        g = st.pop(); comp.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h not in seen: seen.add(h); st.append(h)
    sizes.append(len(comp))
    if len(comp) < 150: kill += comp
print("SEG_ISLANDS", sorted(sizes)[::-1][:12], "n", len(sizes), "killed_faces", len(kill))
bmesh.ops.delete(bm, geom=kill, context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
# holes the segmentation left. Small ones (removed leather/collar faces) are filled; the face opening and the front
# opening, which runs round the sides into the bare patch s11's pack covered, are left. That bare back patch is covered by a
# 1 cm grid sheet laid 12 mm off the bind body wherever a ray from behind meets body before cloak; its border is welded to
# the nearest cloak boundary vertex within 2 cm. Fill and sheet are mapped planar onto a plain patch of the s11 cloak texture.
U0, V0, U1, V1 = 25 / A, 1 - 265 / A, 115 / A, 1 - 200 / A  # hood cell, a torn-free green panel (image px 25..115 x 200..265)


def planar_uv(fs):
    vs = {v for f in fs for v in f.verts}
    lo = Vector([min(v.co[k] for v in vs) for k in range(3)]); ext = Vector([max(v.co[k] for v in vs) for k in range(3)]) - lo
    a0, a1 = sorted(range(3), key=lambda k: -ext[k])[:2]
    for f in fs:
        f[part] = 0
        for l in f.loops:
            l[uvl].uv = (U0 + (U1 - U0) * (l.vert.co[a0] - lo[a0]) / max(ext[a0], 1e-6), V0 + (V1 - V0) * (l.vert.co[a1] - lo[a1]) / max(ext[a1], 1e-6))


loops, seen = [], set()
for e in bm.edges:
    if not e.is_boundary or e in seen: continue
    loop, st = [], [e]; seen.add(e)
    while st:
        g = st.pop(); loop.append(g)
        for v in g.verts:
            for h in v.link_edges:
                if h.is_boundary and h not in seen: seen.add(h); st.append(h)
    loops.append(loop)
for loop in loops:
    if len(loop) >= 100: continue
    fs = bmesh.ops.holes_fill(bm, edges=loop, sides=len(loop))["faces"]
    if fs: planar_uv(bmesh.ops.triangulate(bm, faces=fs, quad_method="BEAUTY", ngon_method="BEAUTY")["faces"])
cbvh = BVHTree.FromBMesh(bm)
bbvh = BVHTree.FromPolygons([body.matrix_world @ v.co for v in body.data.vertices], [list(p.vertices) for p in body.data.polygons])
px = [v.co.x for v in pack.data.vertices]
GX = np.arange(min(px) - 0.05, max(px) + 0.05, 0.01); GZ = np.arange(0.5, 1.03, 0.01)
gv = {}
for i, x in enumerate(GX):
    for j, z in enumerate(GZ):
        o = Vector((x, 0.5, z)); hb = bbvh.ray_cast(o, Vector((0, -1, 0)))[0]
        if hb is None: continue
        hc = cbvh.ray_cast(o, Vector((0, -1, 0)))[0]
        if hc is not None and hc.y > hb.y - 0.005: continue  # cloak already behind the body here
        gv[i, j] = bm.verts.new((x, hb.y + 0.012, z))
sheet = []
for (i, j), v in gv.items():
    q = [gv.get(k) for k in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))]
    if all(q): sheet.append(bm.faces.new(q[::-1]))  # wound to face +Y (outward, behind the hero)
planar_uv(sheet)
edge = [v for v in gv.values() if v.link_faces and any(e.is_boundary for e in v.link_edges)]
bnd = [v for v in bm.verts if v not in gv.values() and any(e.is_boundary for e in v.link_edges)]
bk = KDTree(len(bnd))
for k, v in enumerate(bnd): bk.insert(v.co, k)
bk.balance()
tm = {v: bnd[k] for v in edge for _, k, d in [bk.find(v.co)] if d < 0.02}
bmesh.ops.weld_verts(bm, targetmap=tm)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
print("BACK_SHEET", {"faces": len(sheet), "welded": len(tm), "border": len(edge)})
bmesh.ops.triangulate(bm, faces=bm.faces)
me = bpy.data.meshes.new("hero_cloth"); bm.to_mesh(me); bm.free()
for im in [i for i in bpy.data.images if i != img]: bpy.data.images.remove(im)
cloth = bpy.data.objects.new("hero_cloth", me); sc.collection.objects.link(cloth)
NT = int(os.environ.get("CLOTH_TRIS", 17000))
m = cloth.modifiers.new("d", "DECIMATE"); m.ratio = min(1.0, NT / len(me.polygons))
with bpy.context.temp_override(object=cloth, active_object=cloth): bpy.ops.object.modifier_apply(modifier=m.name)
me.materials.clear(); me.materials.append(mat)
# ---------- face skin toward the s11 tone: pale texels inside the head's UV triangles, x SKIN (s11 / ours, lit render) ----------
SKIN = np.array((1.03, 0.92, 0.79), np.float32)
hg = {g.index for g in body.vertex_groups if g.name in ("Head", "NeckTwist01", "NeckTwist02")}
headv = [sum(g.weight for g in v.groups if g.group in hg) > 0.5 for v in body.data.vertices]
buv = body.data.uv_layers.active.data
skin = np.zeros((A, A), bool)
for p in body.data.polygons:
    if not all(headv[i] for i in p.vertices): continue
    t = np.array([tuple(buv[i].uv) for i in p.loop_indices]) * A
    x0, y0 = np.floor(t.min(0)).astype(int); x1, y1 = np.ceil(t.max(0)).astype(int)
    X, Y = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
    for k in range(1, len(t) - 1):  # fan
        a, b, c = t[0], t[k], t[k + 1]
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-9: continue
        l1 = ((b[1] - c[1]) * (X - c[0]) + (c[0] - b[0]) * (Y - c[1])) / den
        l2 = ((c[1] - a[1]) * (X - c[0]) + (a[0] - c[0]) * (Y - c[1])) / den
        ins = (l1 >= -0.05) & (l2 >= -0.05) & (1 - l1 - l2 >= -0.05)
        yy, xx = np.clip(Y[ins].astype(int), 0, A - 1), np.clip(X[ins].astype(int), 0, A - 1)
        skin[yy, xx] = True
for _ in range(2):  # 2 px past the island edges, so filtering at UV seams does not pull white back in
    skin[1:] |= skin[:-1]; skin[:-1] |= skin[1:]; skin[:, 1:] |= skin[:, :-1]; skin[:, :-1] |= skin[:, 1:]
rgb = atlas[..., :3]; mx, mn = rgb.max(-1), rgb.min(-1)
skin &= ((mx - mn) / np.maximum(mx, 1e-6) < 0.25) & (mx > 0.55)  # pale skin only: hair (saturated brown) and eyes (dark) stay
atlas[skin, :3] = np.clip(atlas[skin, :3] * SKIN, 0, 1)
print("SKIN_TEXELS", int(skin.sum()))
jpg = os.path.join(os.path.dirname(os.path.abspath(OUT)), "hero_atlas_cloak.jpg")
out = bpy.data.images.new("hero_atlas", A, A); out.pixels.foreach_set(atlas.ravel())
sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = 90; sc.render.image_settings.color_mode = "RGB"
out.save_render(jpg); bpy.data.images.remove(out)
atl = bpy.data.images.load(jpg); atl.pack()
for n in mat.node_tree.nodes:
    if n.type == "TEX_IMAGE": n.image = atl
bpy.data.images.remove(img)

# ---------- idle frame 0 pose ----------
ad = arm.animation_data
for t in ad.nla_tracks: t.mute = True
ad.action = bpy.data.actions["idle"]
sc.frame_set(int(ad.action.frame_range[0]))
bpy.context.view_layer.update()
dep = bpy.context.evaluated_depsgraph_get()
pb_ev = body.evaluated_get(dep)
PB = [body.matrix_world @ v.co for v in pb_ev.data.vertices]  # posed body, same vertex order as body
BB = [body.matrix_world @ v.co for v in body.data.vertices]  # bind body
BF = [list(p.vertices) for p in body.data.polygons]
DEF = {pb.name: MW @ pb.matrix @ pb.bone.matrix_local.inverted() @ MW.inverted() for pb in arm.pose.bones}  # bind -> idle
PK = DEF["Spine02"]  # the pack rides Spine02 (100 % in hero_rig)
gname = {g.index: g.name for g in body.vertex_groups}
LIMB = ("arm", "Hand", "Elbow", "Pinky", "Ring", "Mid", "Index", "Thumb", "Thigh", "Calf", "Foot", "Toe")
head_w = lambda v: sum(g.weight for g in v.groups if gname[g.group] in ("Head", "NeckTwist01", "NeckTwist02"))
HEADV = [PB[v.index] for v in body.data.vertices if head_w(v) > 0.5]
HB = MW @ arm.pose.bones["Head"].head
HC = Vector((HB.x, sum(c.y for c in HEADV) / len(HEADV), HB.z + 0.068))  # skull centre

# ---------- pre-pose: each cloth vertex rides the torso skin of the nearest bind body vertices (arms excluded) ----------
TW = [{gname[g.group]: g.weight for g in v.groups if gname[g.group] in DEF and not any(t in gname[g.group] for t in LIMB)} for v in body.data.vertices]
kd = KDTree(len(BB))
for i, c in enumerate(BB):
    if sum(TW[i].values()) > 0.5: kd.insert(c, i)
kd.balance()
ZERO = Matrix.Diagonal((0, 0, 0, 0))
MV = []
for v in me.vertices:
    acc = {}
    for _, i, d in kd.find_n(v.co, 6):
        for n, w in TW[i].items(): acc[n] = acc.get(n, 0) + w / (d + 0.01)
    s = sum(acc.values())
    MV.append(sum((DEF[n] * (w / s) for n, w in acc.items()), ZERO.copy()) if s else DEF["Spine02"])
P0 = [M @ v.co for M, v in zip(MV, me.vertices)]

# ---------- drape: position-based cloth on a smooth proxy of the posed body; yoke, hood, rim and face opening pinned ----------
# proxy: voxel remesh of the posed body (the Tripo shell has overlapping hair/skin layers and thin gaps), cut below the chin
col = bpy.data.meshes.new("collider"); col.from_pydata(PB, [], BF); col.update()
co = bpy.data.objects.new("collider", col); sc.collection.objects.link(co)
for t, kw in (("REMESH", {"mode": "VOXEL", "voxel_size": 0.008}), ("SMOOTH", {"factor": 0.5, "iterations": 4})):
    m = co.modifiers.new(t, t)
    for k, v in kw.items(): setattr(m, k, v)
    with bpy.context.temp_override(object=co, active_object=co): bpy.ops.object.modifier_apply(modifier=m.name)
bm = bmesh.new(); bm.from_mesh(co.data)
ZCUT = HC.z - 0.07
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z > ZCUT], context="VERTS")
bm.to_mesh(co.data); bm.free()
sbv = BVHTree.FromPolygons([v.co for v in co.data.vertices], [list(p.vertices) for p in co.data.polygons])
bpy.data.objects.remove(co)
CLEAR = float(os.environ.get("CLEAR", 0.009))


def sdist(c):
    n = sbv.find_nearest(c)
    return (c - n[0]).dot(n[1]) if n[0] is not None else 1


def push(c, lim=0.15):
    n = sbv.find_nearest(c, lim)
    return n[0] + n[1] * CLEAR if n[0] is not None and (c - n[0]).dot(n[1]) < CLEAR else c


SHZ = (MW @ arm.pose.bones["L_Upperarm"].head).z + 0.03  # above the shoulder joint: yoke + hood, pinned (keeps the s11 shape)
NV = len(P0)
pin = np.array([c.z > SHZ for c in P0])
cut = [i for i in range(NV) if P0[i].z < ZCUT]
pre = [sdist(P0[i]) for i in cut]
print("PRE_SD", {"inside": sum(1 for d in pre if d < 0), "lt_clear": sum(1 for d in pre if d < CLEAR), "n": len(cut)})
for _ in range(3):  # start collision-free (pinned yoke included): within CLEAR of the proxy -> out along its normal
    for i in cut: P0[i] = push(P0[i])
P = np.array([tuple(c) for c in P0])
E = np.array([tuple(e.vertices) for e in me.edges])
ef = {}  # bending: the two far corners of each pair of triangles sharing an edge
for p in me.polygons:
    for k in range(3): ef.setdefault(tuple(sorted((p.vertices[k], p.vertices[(k + 1) % 3]))), []).append(p.vertices[(k + 2) % 3])
bend = np.array([f for f in ef.values() if len(f) == 2])
KB = float(os.environ.get("KBEND", 0.8))
CI = np.concatenate([E[:, 0], bend[:, 0]]); CJ = np.concatenate([E[:, 1], bend[:, 1]])
CK = np.concatenate([np.ones(len(E)), np.full(len(bend), KB)])
CL = np.linalg.norm(P[CJ] - P[CI], axis=1)
w = (~pin).astype(float)
ws = w[CI] + w[CJ]; act = ws > 0; CI, CJ, CK, CL, ws = CI[act], CJ[act], CK[act], CL[act], ws[act]
cnt = np.bincount(CI, minlength=NV) + np.bincount(CJ, minlength=NV)
free = [i for i in range(NV) if not pin[i] and P0[i].z < ZCUT]
# tethers (long-range attachments, Kim et al. 2012): a free vertex never gets farther from its nearest pinned vertex than at
# the start -- the cloth cannot sag or stretch away from the yoke, whatever the solver's iteration count
pk = KDTree(int(pin.sum()))
for i in np.flatnonzero(pin): pk.insert(P0[i], int(i))
pk.balance()
TA = np.array([pk.find(P0[i])[1] if not pin[i] else i for i in range(NV)])
TD = np.linalg.norm(P[TA] - P, axis=1)
G, DT, SIMF = np.array((0, 0, -9.81)) * float(os.environ.get("GSCALE", 0.3)), 1 / 60, int(os.environ.get("SIMF", 45))
prev = P.copy(); start = P.copy()
for step in range(SIMF):
    vel = (P - prev) * 0.9
    sp = np.linalg.norm(vel, axis=1, keepdims=True); vel *= np.minimum(1, 0.004 / np.maximum(sp, 1e-9))
    prev = P.copy(); P = P + (vel + G * DT * DT) * w[:, None]
    for it in range(16):
        d = P[CJ] - P[CI]; l = np.maximum(np.linalg.norm(d, axis=1), 1e-9)
        corr = d * (CK * (l - CL) / (l * ws))[:, None]
        dP = np.zeros_like(P)
        np.add.at(dP, CI, corr * w[CI, None]); np.add.at(dP, CJ, -corr * w[CJ, None])
        P += 1.6 * dP / np.maximum(cnt, 1)[:, None]
        t = P - P[TA]; tl = np.linalg.norm(t, axis=1); over = tl > TD
        P[over] = P[TA[over]] + t[over] * (TD[over] / tl[over])[:, None]
        if it % 4 == 3:
            for i in free: P[i] = push(Vector(P[i]))
for i in cut:  # every collidable vertex (pinned yoke too); in a crease (hand by hip) a push off one face can land in the other
    c = Vector(P[i])
    for _ in range(8):
        c = push(c)
        if sdist(c) >= CLEAR - 1e-4: break
    P[i] = c
ID = [Vector(c) for c in P]
post = [sdist(ID[i]) for i in cut]
L0 = np.linalg.norm(start[E[:, 1]] - start[E[:, 0]], axis=1); ok = L0 > 0.001
st = np.abs(np.linalg.norm(P[E[ok, 1]] - P[E[ok, 0]], axis=1) / L0[ok] - 1)
mv = np.linalg.norm(P - start, axis=1)[~pin]
print("WORST", [(round(post[k]*1000,1), tuple(round(x, 3) for x in ID[cut[k]]), bool(pin[cut[k]])) for k in np.argsort(post)[:8]])
print("POST_SD", {"lt5mm": sum(1 for d in post if d < 0.005), "min_mm": round(min(post) * 1000, 1), "pinned": int(pin.sum()), "free": len(free)})
print("SIM", {"stretch_p99": round(float(np.percentile(st, 99)), 3), "stretch_max": round(float(st.max()), 3),
              "move_p50": round(float(np.median(mv)), 4), "move_p99": round(float(np.percentile(mv, 99)), 4), "move_max": round(float(mv.max()), 4)})
for v, c in zip(me.vertices, ID): v.co = c
me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
cloth_idle = cloth.copy(); cloth_idle.data = me.copy(); sc.collection.objects.link(cloth_idle)  # debug view only

# body faces hidden under the cloth: torso/neck faces whose normal ray and four rays tilted 45 deg all meet the cloth within 6 cm
hbvh = BVHTree.FromPolygons(ID, [list(p.vertices) for p in me.polygons])
hidden = []
for p in body.data.polygons:
    vs = [body.data.vertices[i] for i in p.vertices]
    if any(sum(g.weight for g in v.groups if any(t in gname[g.group] for t in LIMB)) > 0.05 for v in vs): continue
    c = sum((PB[i] for i in p.vertices), Vector()) / len(vs)
    n = (PB[p.vertices[1]] - PB[p.vertices[0]]).cross(PB[p.vertices[2]] - PB[p.vertices[0]])
    if n.length < 1e-12: continue
    n.normalize(); t1 = n.orthogonal().normalized(); t2 = n.cross(t1)
    if all(hbvh.ray_cast(c + n * 0.001, d.normalized(), 0.06)[0] is not None for d in (n, n + t1, n - t1, n + t2, n - t2)): hidden.append(p.index)

# ---------- pack seated on the cloak: pushed straight back until every pack vertex is >= 5 mm behind the cloth ----------
PP = [PK @ v.co for v in pack.data.vertices]
back, GAP, shift = Vector((0, 1, 0)), 0.005, 0.0
for c in PP:
    hit = hbvh.ray_cast(c, back, 0.3)  # cloth behind the pack vertex: pack is inside the cloak by that much
    need = hit[3] + GAP if hit[0] is not None else 0.0
    hit = hbvh.ray_cast(c, -back, 0.3)  # cloth in front of it: keep GAP
    if not need and hit[0] is not None: need = max(0.0, GAP - hit[3])
    shift = max(shift, need)
for v in pack.data.vertices: v.co += PK.inverted().to_3x3() @ (back * shift)
PP = [PK @ v.co for v in pack.data.vertices]
pack_gap = min(hbvh.find_nearest(c)[3] for c in PP)

# ---------- back to bind space with the same per-vertex skin as the pre-pose ----------
for v, M in zip(me.vertices, MV): v.co = M.inverted() @ v.co
me.update()

# ---------- hair under the hood (bind space): head vertices past the cloth are pulled inside it ----------
HCb = bw("Head") + Vector((0, HC.y - HB.y, 0.068))
hb = BVHTree.FromPolygons([v.co for v in me.vertices], [list(p.vertices) for p in me.polygons])
bimg = atl
W, Hh = bimg.size
px = np.array(bimg.pixels[:], np.float32).reshape(Hh, W, 4)
uv = body.data.uv_layers.active.data
hairv = np.zeros(len(body.data.vertices), bool)
for p in body.data.polygons:
    u = sum(uv[i].uv.x for i in p.loop_indices) / p.loop_total; t = sum(uv[i].uv.y for i in p.loop_indices) / p.loop_total
    h, s_, val = colorsys.rgb_to_hsv(*px[min(Hh - 1, int(t % 1 * Hh)), min(W - 1, int(u % 1 * W)), :3])
    if 0.03 < h < 0.13 and s_ > 0.35 and val > 0.2: hairv[list(p.vertices)] = True
pulled = 0
for v in body.data.vertices:
    if head_w(v) < 0.5: continue
    c = body.matrix_world @ v.co; d = c - HCb; L = d.length
    if L < 1e-6 or c.z < bw("Head").z: continue  # neck/collar stay: the hood's chin drape is not hair to tuck in
    hit = hb.ray_cast(HCb, d / L, L + 0.02)
    if hit[0] is not None: r = hit[3] - 0.012
    elif hairv[v.index] and d.y / L > -0.75: r = (hb.find_nearest(c)[0] - HCb).length - 0.012  # hair in the face opening, not the fringe
    else: continue
    if r < L: v.co = body.matrix_world.inverted() @ (HCb + d * (max(0.02, r) / L)); pulled += 1

bm = bmesh.new(); bm.from_mesh(body.data); bm.faces.ensure_lookup_table()
bmesh.ops.delete(bm, geom=[bm.faces[i] for i in hidden], context="FACES")
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
bm.to_mesh(body.data); bm.free()

# islands of the whole cloak (p1 + p0 welded)
bm = bmesh.new(); bm.from_mesh(me); seen, isl = set(), 0
for f in bm.faces:
    if f in seen: continue
    isl += 1; st = [f]; seen.add(f)
    while st:
        g = st.pop()
        for e in g.edges:
            for h in e.link_faces:
                if h not in seen: seen.add(h); st.append(h)
bm.free()

# ---------- split: hero_hood = p1 (hood + shoulder cape), hero_skirt = p0 (lower cape); double-sided in hero_rig ----------
parts = {}
for k, name in ((1, "hero_hood"), (0, "hero_skirt")):
    bm = bmesh.new(); bm.from_mesh(me); lay = bm.faces.layers.int["part"]
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[lay] != k], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    md = bpy.data.meshes.new(name); bm.to_mesh(md); bm.free()
    md.attributes.remove(md.attributes["part"]); md.materials.append(mat)
    o = bpy.data.objects.new(name, md); sc.collection.objects.link(o); parts[name] = o
bpy.data.objects.remove(cloth)

# ---------- export (bind space; the clips ride along) ----------
ad.action = None
for t in ad.nla_tracks: t.mute = False
for o in sc.objects: o.select_set(o.type in ("ARMATURE", "MESH") and o != cloth_idle)
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_image_format="JPEG", export_animations=True,
                          export_animation_mode="ACTIONS", export_yup=True)
tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
print("CLOAK", {"hood_tris": tri(parts["hero_hood"]), "skirt_tris": tri(parts["hero_skirt"]), "body_tris": tri(body), "hidden_body_faces": len(hidden),
                "hair_pulled": pulled, "cloak_islands": isl, "pack_w": PACK_W, "pack_shift_mm": round(shift * 1000, 1), "pack_cloak_min_mm": round(pack_gap * 1000, 1)})
if DBG:  # idle-pose static scene: posed body + draped cloth + pack
    for o in list(sc.objects):
        if o.type == "MESH" and o not in (body, pack, cloth_idle): bpy.data.objects.remove(o)
    ad.action = bpy.data.actions["idle"]; sc.frame_set(int(ad.action.frame_range[0])); bpy.context.view_layer.update()
    dep = bpy.context.evaluated_depsgraph_get()
    pbm = bpy.data.meshes.new_from_object(body.evaluated_get(dep)); pbm.transform(body.matrix_world)
    pbo = bpy.data.objects.new("idle_body", pbm); sc.collection.objects.link(pbo)
    pack.data.transform(PK)
    for o in sc.objects: o.select_set(o in (pbo, pack, cloth_idle))
    bpy.ops.export_scene.gltf(filepath=DBG, export_format="GLB", use_selection=True, export_image_format="JPEG", export_animations=False, export_yup=True)
