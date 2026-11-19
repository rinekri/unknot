"""Hero v3 assembly (headless Blender): Tripo P2 multiview body + P2 pack + v2 staff/pouch -> one GLB, one 2048 JPEG atlas.
  Blender -b --factory-startup --python hero_assemble.py -- <hero2 dir> <out.glb>
Inputs (Tripo, see tripo_log.md): p2_body/model_url.fbx (P2 multiview from the ref3 A-pose views: one body with hood + capelet,
the long back cape its own island), p2_pack/model_url.fbx (P2 image-to-model of the s11 pack), retarget_s11/model_url.glb
(Tripo rig v3 humanoid skeleton + idle/walk/run), v4/hero_v2.glb (hero_staff, gear_pouch of the v2 build, hero frame).
Rig: the s11 skeleton is fitted to the P2 body (spine/legs at cross-section centres, arms along the sleeve axis, wrist and
hand tip from the hand islands), the body gets heat weights, is posed back to the s11 bone orientations and that pose becomes
the rest, so the Tripo clips (local rotations) play unchanged on the new body.
Out meshes: hero_body (skinned; its hood + capelet faces carry the second material "hero_cloak", which hero_rig re-weights
in place), hero_skirt (the back cape, static), gear_backpack, gear_pouch, hero_staff (static, world space).
Frame out: like blender_prep --rotate-z -90 --height 1.3: hero faces -Y, hero's left +X, 1.3 baked into the Armature node."""
import bpy, bmesh, sys, os, math, colorsys
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

a = sys.argv[sys.argv.index("--") + 1:]
D, OUT = a[0], a[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
vl = bpy.context.view_layer
HERO = Matrix.Scale(1.3, 4) @ Matrix.Rotation(math.radians(-90), 4, "Z")  # Tripo frame (faces +X, left +Y, 1 tall) -> hero frame


def imp(path):
    old = set(sc.objects)
    if path.endswith(".fbx"): bpy.ops.import_scene.fbx(filepath=os.path.join(D, path))
    else: bpy.ops.import_scene.gltf(filepath=os.path.join(D, path))
    new = set(sc.objects) - old
    shapes = {pb.custom_shape for o in new if o.type == "ARMATURE" for pb in o.pose.bones if pb.custom_shape}
    keep = [o for o in new if o not in shapes]
    for o in shapes: bpy.data.objects.remove(o)
    return keep


def flat(o, m=Matrix()):  # static mesh: bake its transform (then m) into the vertices, unparent
    vl.update()
    o.data.transform(m @ o.matrix_world)
    o.modifiers.clear(); o.parent = None; o.matrix_world = Matrix()


def tex(o):
    return next(n.image for n in o.data.materials[0].node_tree.nodes if n.type == "TEX_IMAGE")


def islands(me):
    bm = bmesh.new(); bm.from_mesh(me); bm.faces.ensure_lookup_table()
    seen, out = set(), []
    for f in bm.faces:
        if f.index in seen: continue
        st, comp = [f], []; seen.add(f.index)
        while st:
            g = st.pop(); comp.append(g.index)
            for e in g.edges:
                for h in e.link_faces:
                    if h.index not in seen: seen.add(h.index); st.append(h)
        out.append(comp)
    bm.free()
    return sorted(out, key=len, reverse=True)


def pixels(img):
    w, h = img.size
    return np.array(img.pixels[:], np.float32).reshape(h, w, 4)


def face_rgb(o, px):
    h, w = px.shape[:2]
    uv = o.data.uv_layers.active.data
    out = []
    for p in o.data.polygons:
        u = sum(uv[i].uv.x for i in p.loop_indices) / p.loop_total
        v = sum(uv[i].uv.y for i in p.loop_indices) / p.loop_total
        out.append(px[min(h - 1, max(0, int(v * h))), min(w - 1, max(0, int(u * w))), :3])
    return out


def split_faces(o, faces, name):  # faces -> their own object
    for x in sc.objects: x.select_set(x == o)
    vl.objects.active = o
    old = set(sc.objects)
    bpy.ops.object.mode_set(mode="EDIT")
    bm = bmesh.from_edit_mesh(o.data); bm.faces.ensure_lookup_table()
    for f in bm.faces: f.select_set(False)
    for i in faces: bm.faces[i].select_set(True)
    bmesh.update_edit_mesh(o.data)
    bpy.ops.mesh.separate(type="SELECTED"); bpy.ops.object.mode_set(mode="OBJECT")
    n = next(iter(set(sc.objects) - old)); n.name = n.data.name = name
    return n


# ---------- body: Tripo frame, feet on z 0; the back cape island -> hero_skirt; hood + capelet faces flagged ----------
body = next(o for o in imp("p2_body/model_url.fbx") if o.type == "MESH")
flat(body)
z0 = min(v.co.z for v in body.data.vertices)
body.data.transform(Matrix.Translation((0, 0, -z0)))
body.name = body.data.name = "hero_body"
body_img = tex(body)
SAGE = [colorsys.rgb_to_hsv(*c) for c in face_rgb(body, pixels(body_img))]
green = [0.12 < h < 0.40 and s > 0.2 for h, s, _ in SAGE]
isl = islands(body.data)
cape = max(isl[1:], key=lambda c: sum(green[i] for i in c) - 0.5 * len(c))  # the second big island, all cloth
assert sum(green[i] for i in cape) > 0.95 * len(cape) and len(cape) > 1000, "no cape island"
# cloth faces: connected sage regions of >= 150 faces (stray sage-ish texels on the trousers stay body)
cape_set = set(cape)
gf = {i for i, g in enumerate(green) if g and i not in cape_set}
bm = bmesh.new(); bm.from_mesh(body.data); bm.faces.ensure_lookup_table()
cloth, seen = set(), set()
for i in gf:
    if i in seen: continue
    st, comp = [i], []; seen.add(i)
    while st:
        j = st.pop(); comp.append(j)
        for e in bm.faces[j].edges:
            for h in e.link_faces:
                if h.index in gf and h.index not in seen: seen.add(h.index); st.append(h.index)
    if len(comp) >= 150: cloth |= set(comp)
bm.free()
skirt = split_faces(body, cape_set, "hero_skirt")
# split_faces keeps face order for the rest: re-derive the cloth flag on the remaining faces by their old index order
keep = [i for i in range(len(green)) if i not in cape_set]
cloth_new = [k for k, i in enumerate(keep) if i in cloth]
hands = [c for c in islands(body.data) if 300 < len(c) < 900]
print("BODY faces", len(body.data.polygons), "cape", len(skirt.data.polygons), "cloth", len(cloth_new), "hand islands", [len(c) for c in hands])

# ---------- skeleton: s11 Tripo rig fitted to the P2 body ----------
s11 = imp("retarget_s11/model_url.glb")
arm = next(o for o in s11 if o.type == "ARMATURE")
for o in s11:
    if o.type == "MESH": bpy.data.objects.remove(o)
vl.update()
assert arm.matrix_world == Matrix(), "s11 armature not at identity"
arm.animation_data.action = None
for t in list(arm.animation_data.nla_tracks): arm.animation_data.nla_tracks.remove(t)
for pb in arm.pose.bones: pb.matrix_basis.identity()
B = {b.name: (b.head_local.copy(), b.tail_local.copy(), b.matrix_local.to_3x3().copy()) for b in arm.data.bones}
PAR = {b.name: b.parent.name if b.parent else None for b in arm.data.bones}

co = np.array([v.co[:] for v in body.data.vertices])
vcloth = np.zeros(len(co), bool)
for k in cloth_new:
    for vi in body.data.polygons[k].vertices: vcloth[vi] = True
main = np.zeros(len(co), bool)
for k in islands(body.data)[0]:
    for vi in body.data.polygons[k].vertices: main[vi] = True
skin = main & ~vcloth  # body surface, no hood/capelet


def centre(mask, z, dz=0.01):
    s = co[mask & (np.abs(co[:, 2] - z) < dz)]
    return Vector(s.mean(0)) if len(s) > 5 else None


def torso_at(z):
    return centre(skin & (np.abs(co[:, 1]) < 0.08), z)


hz, cz = B["Hip"][0].z, B["Spine02"][0].z
th, tc = torso_at(hz), torso_at(cz)
d_hip = Vector((th.x - B["Hip"][0].x, -B["Hip"][0].y, 0))  # the body is mirror-symmetric about y 0
d_chest = Vector((tc.x - B["Spine02"][0].x, -B["Spine02"][0].y, 0))


def d_spine(z):
    t = min(1.0, max(0.0, (z - hz) / (cz - hz)))
    return d_hip.lerp(d_chest, t)


SEG = {}  # key bone -> (A, B) in s11 and (A', B') fitted: points of that chain map by the similarity A->A', B->B'
for sd, sg in (("L", 1), ("R", -1)):
    side = co[:, 1] * sg > 0
    # legs: knee and ankle at the leg's cross-section centre; hip joint keeps its s11 offset from the pelvis
    hip = B[f"{sd}_Thigh"][0] + d_spine(B[f"{sd}_Thigh"][0].z)
    knee = centre(skin & side & (np.abs(co[:, 1]) > 0.01), B[f"{sd}_Calf"][0].z)
    ank = centre(skin & side & (np.abs(co[:, 1]) > 0.01), B[f"{sd}_Foot"][0].z)
    knee.z, ank.z = B[f"{sd}_Calf"][0].z, B[f"{sd}_Foot"][0].z
    SEG[f"{sd}_Thigh"] = (B[f"{sd}_Thigh"][0], B[f"{sd}_Calf"][0], hip, knee)
    SEG[f"{sd}_Calf"] = (B[f"{sd}_Calf"][0], B[f"{sd}_Foot"][0], knee, ank)
    foot = co[skin & side & (co[:, 2] < 0.04)]
    tip = Vector(foot[foot[:, 0] > np.percentile(foot[:, 0], 97)].mean(0))
    ft0, ft1 = B[f"{sd}_Foot"][0], B[f"{sd}_ToeBase"][1]
    h0 = Vector((ft1.x - ft0.x, ft1.y - ft0.y, 0)); h1 = Vector((tip.x - ank.x, tip.y - ank.y, 0))
    yaw = math.atan2(h1.y, h1.x) - math.atan2(h0.y, h0.x)
    SEG[f"{sd}_Foot"] = (ft0, ft0 + Matrix.Rotation(-yaw, 3, "Z") @ Vector((1, 0, 0)), ank, ank + Vector((1, 0, 0)))  # yaw + move only
    # arms: shoulder keeps its s11 offset from the chest; wrist/hand tip from the hand island; elbow on the sleeve axis
    sh = B[f"{sd}_Upperarm"][0] + d_spine(B[f"{sd}_Upperarm"][0].z)
    hi = max(hands, key=lambda c: sg * co[list(body.data.polygons[c[0]].vertices)[0], 1])
    hv = np.array(sorted({vi for k in hi for vi in body.data.polygons[k].vertices}))
    hp = co[hv]; dist = np.linalg.norm(hp - np.array(sh[:]), axis=1)
    wr = Vector(hp[dist < np.percentile(dist, 12)].mean(0))
    htip = Vector(hp[dist > np.percentile(dist, 95)].mean(0))
    el_s = B[f"{sd}_Forearm"][0]; wr_s = B[f"{sd}_Hand"][0]; sh_s = B[f"{sd}_Upperarm"][0]
    fe = (el_s - sh_s).length / ((el_s - sh_s).length + (wr_s - el_s).length)
    ax = wr - sh
    t = (co - np.array(sh[:])) @ np.array(ax[:]) / ax.length_squared
    perp = np.linalg.norm((co - np.array(sh[:])) - t[:, None] * np.array(ax[:]), axis=1)
    sl = co[skin & (np.abs(t - fe) < 0.05) & (perp < 0.06)]
    el = Vector(sl.mean(0)) if len(sl) > 5 else sh.lerp(wr, fe)
    SEG[f"{sd}_Clavicle"] = (B[f"{sd}_Clavicle"][0], sh_s, B[f"{sd}_Clavicle"][0] + d_spine(B[f"{sd}_Clavicle"][0].z), sh)
    SEG[f"{sd}_Upperarm"] = (sh_s, el_s, sh, el)
    SEG[f"{sd}_Forearm"] = (el_s, wr_s, el, wr)
    SEG[f"{sd}_Hand"] = (wr_s, B[f"{sd}_Mid3"][1], wr, htip)
    print("FIT", sd, "hip", hip, "knee", knee, "ankle", ank, "toe", tip, "shoulder", sh, "elbow", el, "wrist", wr, "tip", htip)


def xform(key):
    if key is None or key not in SEG:  # spine chain and anything above it: move with the torso centre
        return lambda p: p + d_spine(p.z), Matrix.Identity(3)
    a0, b0, a1, b1 = SEG[key]
    q = (b0 - a0).rotation_difference(b1 - a1).to_matrix()
    s = (b1 - a1).length / (b0 - a0).length
    if key.endswith("Foot"): s = 1.0
    return lambda p: a1 + s * (q @ (p - a0)), q


def key_of(n):
    while n is not None and n not in SEG: n = PAR[n]
    return n


for x in sc.objects: x.select_set(x == arm)
vl.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
for eb in arm.data.edit_bones:
    h, t, r = B[eb.name]
    f, q = xform(key_of(eb.name))
    h1, t1 = f(h), f(t)
    eb.matrix = Matrix.Translation(h1) @ (q @ r).to_4x4()
    eb.length = max(1e-3, (t1 - h1).length)
bpy.ops.object.mode_set(mode="OBJECT")

# heat weights on the body (hood/capelet included; hero_rig re-weights the cloth faces)
NODEF = [b for b in arm.data.bones if b.name in ("BoneRoot",)]
for b in NODEF: b.use_deform = False
for x in sc.objects: x.select_set(x in (body, arm))
vl.objects.active = arm
bpy.ops.object.parent_set(type="ARMATURE_AUTO")
for b in NODEF: b.use_deform = True
# heat leaves a few small islands (eyes, hair tufts) empty: they take the weights of the nearest weighted vertex
zero = [v.index for v in body.data.vertices if sum(g.weight for g in v.groups) < 1e-3]
wkd = KDTree(len(body.data.vertices) - len(zero)); zs = set(zero)
for v in body.data.vertices:
    if v.index not in zs: wkd.insert(v.co, v.index)
wkd.balance()
for i in zero:
    src = body.data.vertices[wkd.find(body.data.vertices[i].co)[1]]
    for g in src.groups: body.vertex_groups[g.group].add([i], g.weight, "REPLACE")
print("HEAT unweighted verts", len(zero), "of", len(body.data.vertices), "(filled from nearest)")

# pose back to the s11 bone orientations, bake that into the body, make it the rest
bpy.ops.object.mode_set(mode="POSE")
depth = lambda n: 0 if PAR[n] is None else 1 + depth(PAR[n])
for n in sorted(B, key=depth):
    vl.update()
    pb = arm.pose.bones[n]
    pb.matrix = Matrix.Translation(pb.head) @ B[n][2].to_4x4()
vl.update()
bpy.ops.object.mode_set(mode="OBJECT")
vl.objects.active = body
mod = next(m for m in body.modifiers if m.type == "ARMATURE")
bpy.ops.object.modifier_apply(modifier=mod.name)
vl.objects.active = arm
bpy.ops.object.mode_set(mode="POSE")
bpy.ops.pose.armature_apply(selected=False)
bpy.ops.object.mode_set(mode="OBJECT")
mod = body.modifiers.new("Armature", "ARMATURE"); mod.object = arm
err = max(min(x, 2 * math.pi - x) for x in (b.matrix_local.to_3x3().to_quaternion().rotation_difference(B[b.name][2].to_quaternion()).angle for b in arm.data.bones))
print("REST orientation err deg", round(math.degrees(err), 3))
bw = lambda n: arm.data.bones[n].head_local

# ---------- gear ----------
bbvh = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
sv = [v.co for v in skirt.data.vertices]
sbvh = BVHTree.FromPolygons(sv, [list(p.vertices) for p in skirt.data.polygons])
# backpack: P2 model of the s11 pack (its image is the pack seen from behind, so it faces +X: turn it to face back, -X)
bp = next(o for o in imp("p2_pack/model_url.fbx") if o.type == "MESH"); flat(bp)
bp.name = bp.data.name = "gear_backpack"
pv = [v.co for v in bp.data.vertices]
lo = Vector([min(c[i] for c in pv) for i in range(3)]); hi_ = Vector([max(c[i] for c in pv) for i in range(3)])
PH = 0.25  # pack height (Tripo units: hero = 1); bottom above the cape chains' start (hero_rig ZC 0.70 / 1.3 = 0.54)
k = PH / (hi_.z - lo.z)
ctr = (lo + hi_) / 2
top = bw("Spine02").z + 0.15
base = [Vector((-(v.co - ctr).x * k, -(v.co - ctr).y * k, (v.co - ctr).z * k)) for v in bp.data.vertices]
# seat it on the cape: for each tilt (top toward the back), start far behind and move forward (+X) until the first
# pack vertex is 6 mm off the cape/body along X; keep the tilt whose front face then sits closest overall
best = None
for tilt in range(0, 31, 3):
    R = Matrix.Rotation(math.radians(tilt), 3, "Y")
    pts = [R @ c + Vector((-0.6, bw("Spine02").y, top - PH / 2)) for c in base]
    run = 1e9
    for c in pts:
        for tree in (bbvh, sbvh):
            h = tree.ray_cast(c, Vector((1, 0, 0)), 1.0)
            if h[0] is not None: run = min(run, h[3])
    pts = [c + Vector((run - 0.006, 0, 0)) for c in pts]
    xf = max(c.x for c in pts) - 0.35 * PH
    gaps = sorted(min(bbvh.find_nearest(c)[3], sbvh.find_nearest(c)[3]) for c in pts[::4] if c.x > xf)
    score = gaps[len(gaps) // 2]
    if best is None or score < best[0]: best = (score, tilt, pts)
for v, c in zip(bp.data.vertices, best[2]): v.co = c
shift = best[1]
pack_gap = min(min(bbvh.find_nearest(v.co)[3], sbvh.find_nearest(v.co)[3]) for v in bp.data.vertices)
print("PACK tilt", shift, "median front gap", round(best[0], 4), "gap", round(pack_gap, 4), "dims", [round(x, 3) for x in (hi_ - lo) * k])
v2 = {o.name: o for o in imp("v4/hero_v2.glb")}
INV = HERO.inverted()
pouch, staff = v2["gear_pouch"], v2["hero_staff"]
for o in (pouch, staff): flat(o, INV)
for n, o in v2.items():
    if o not in (pouch, staff) and n in bpy.data.objects: bpy.data.objects.remove(o)
pouch.name = pouch.data.name = "gear_pouch"; staff.name = staff.data.name = "hero_staff"
v2img = tex(pouch)
# belt pouch: moved along the skin normal under it until its innermost point is 3 mm off the skin (in or out)
pc = sum((v.co for v in pouch.data.vertices), Vector()) / len(pouch.data.vertices)
n_, nn = bbvh.find_nearest(pc)[:2]
d_in = min((v.co - n_).dot(nn) for v in pouch.data.vertices)
for v in pouch.data.vertices: v.co += nn * (0.003 - d_in)
for _ in range(30):  # curved hip: push on until no vertex is under the skin
    if all((v.co - bbvh.find_nearest(v.co)[0]).dot(bbvh.find_nearest(v.co)[1]) > 0.002 for v in pouch.data.vertices): break
    for v in pouch.data.vertices: v.co += nn * 0.002
inside = sum(1 for v in pouch.data.vertices if (v.co - bbvh.find_nearest(v.co)[0]).dot(bbvh.find_nearest(v.co)[1]) < 0)
gap = min(bbvh.find_nearest(v.co)[3] for v in pouch.data.vertices)
print("POUCH inside", inside)
print("POUCH gap", round(gap, 4), "staff len", round(max(v.co.z for v in staff.data.vertices), 3))

# ---------- atlas: one 2048 JPEG (body 1536^2; pack, staff, pouch 512 cells) ----------
A = 2048
atlas = np.zeros((A, A, 4), np.float32); atlas[..., 3] = 1


def place(o, img, x, y, s, pad=4):
    """the image region under o's UVs -> an s x s cell at (x, y); UVs remapped into it"""
    px = pixels(img); h, w = px.shape[:2]
    uv = o.data.uv_layers.active.data
    us = np.array([d.uv[:] for d in uv])
    u0, v0 = np.clip(us.min(0), 0, 1); u1, v1 = np.clip(us.max(0), 0, 1)
    x0, x1 = int(u0 * w), max(int(u0 * w) + 1, int(math.ceil(u1 * w))); y0, y1 = int(v0 * h), max(int(v0 * h) + 1, int(math.ceil(v1 * h)))
    crop = px[y0:y1, x0:x1]
    iy = np.clip((np.arange(s) + 0.5) / s * (y1 - y0), 0, y1 - y0 - 1).astype(int)
    ix = np.clip((np.arange(s) + 0.5) / s * (x1 - x0), 0, x1 - x0 - 1).astype(int)
    atlas[y:y + s, x:x + s] = crop[iy][:, ix]
    for d in uv:
        u, v = d.uv
        uu = ((u * w - x0) / (x1 - x0)); vv = ((v * h - y0) / (y1 - y0))
        d.uv = ((x + pad + min(1, max(0, uu)) * (s - 2 * pad)) / A, (y + pad + min(1, max(0, vv)) * (s - 2 * pad)) / A)


def scaled(img, s):
    im = img.copy(); im.scale(s, s); px = pixels(im); bpy.data.images.remove(im); return px


atlas[0:1536, 0:1536] = scaled(body_img, 1536)
for o in (body, skirt):
    for d in o.data.uv_layers.active.data: d.uv = (min(1, max(0, d.uv.x)) * 1536 / A, min(1, max(0, d.uv.y)) * 1536 / A)
atlas[0:512, 1536:2048] = scaled(tex(bp), 512)
for d in bp.data.uv_layers.active.data: d.uv = ((1536 + 2 + min(1, max(0, d.uv.x)) * 508) / A, (2 + min(1, max(0, d.uv.y)) * 508) / A)
place(staff, v2img, 1536, 512, 512)
place(pouch, v2img, 1536, 1024, 512)
img = bpy.data.images.new("hero_atlas", A, A)
img.pixels.foreach_set(atlas.ravel())
jpg = os.path.join(os.path.dirname(OUT), "hero_atlas.jpg")
sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = 90; sc.render.image_settings.color_mode = "RGB"
img.save_render(jpg)
bpy.data.images.remove(img)
atl = bpy.data.images.load(jpg)
mat = bpy.data.materials.new("hero"); mat.use_nodes = True
nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = atl
nt.links.new(tn.outputs["Color"], bsdf.inputs["Base Color"])
bsdf.inputs["Roughness"].default_value = 0.9
if "Specular IOR Level" in bsdf.inputs: bsdf.inputs["Specular IOR Level"].default_value = 0.2
cm = mat.copy(); cm.name = "hero_cloak"  # hood + capelet faces of the body; hero_rig finds them by this name

# ---------- materials, frame, export ----------
for o in (body, skirt, bp, pouch, staff):
    o.data.materials.clear(); o.data.materials.append(mat)
    o.data.polygons.foreach_set("use_smooth", [True] * len(o.data.polygons))
body.data.materials.append(cm)
for k in cloth_new: body.data.polygons[k].material_index = 1
arm.matrix_world = HERO @ arm.matrix_world
for o in (skirt, bp, pouch, staff): o.data.transform(HERO)
for o in list(bpy.data.images):
    if o != atl: bpy.data.images.remove(o)
for o in list(bpy.data.actions):
    if o.name not in ("idle", "walk", "run"): bpy.data.actions.remove(o)
for o in sc.objects: o.select_set(o in (arm, body, skirt, bp, pouch, staff))
bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", use_selection=True, export_image_format="JPEG", export_animations=True,
                          export_animation_mode="ACTIONS", export_yup=True)
tri = lambda o: sum(len(p.vertices) - 2 for p in o.data.polygons)
print("ASSEMBLED", {o.name: tri(o) for o in (body, skirt, bp, pouch, staff)}, "total", sum(tri(o) for o in (body, skirt, bp, pouch, staff)))
