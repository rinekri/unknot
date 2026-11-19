"""QA renders for one exported GLB (headless Blender 5.x): an 8-view sheet, one contact sheet per animation clip (dark bg),
and a scale shot next to the hero. Run (from repo root):
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/qa_v2.py -- <asset.glb> <png dir> [--frames 8] [--no-hero]
Writes <dir>/<name>_views.png, <dir>/<name>_anim_<clip>.png, <dir>/<name>_hero.png (tiles montaged with ImageMagick)."""
import bpy, sys, os, re, math, subprocess, shutil
from mathutils import Vector
sys.path.insert(0, os.path.dirname(__file__))
import npc_lib as L

argv = sys.argv[sys.argv.index("--") + 1:]
GLB, OUT = argv[0], argv[1]
NF = int(argv[argv.index("--frames") + 1]) if "--frames" in argv else 8
HERO = "--no-hero" not in argv
NAME = os.path.splitext(os.path.basename(GLB))[0]
TMP = os.path.join(OUT, f"_tiles_{NAME}")
os.makedirs(TMP, exist_ok=True)
L.reset()
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
bpy.ops.import_scene.gltf(filepath=GLB)


def drop_shapes():  # the importer adds bone display shapes (an Icosphere mesh object): not part of the asset
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o.name.startswith("Icosphere") and not o.data.materials: bpy.data.objects.remove(o)


drop_shapes()
asset = list(bpy.context.scene.objects)
arms = [o for o in asset if o.type == "ARMATURE"]
clips = sorted({a.name for a in bpy.data.actions})
cam, tgt = L.qa_setup()
sc = bpy.context.scene
ls = sc.view_layers[0].freestyle_settings.linesets[0]
if "--soft-ink" in argv: ls.select_crease = False  # scanned (Tripo) meshes: creases everywhere would ink them black
noink = bpy.data.collections.new("noink"); sc.collection.children.link(noink)
ls.select_by_collection = True; ls.collection = noink; ls.collection_negation = "EXCLUSIVE"
bg = sc.world.node_tree.nodes["Background"]


def bbox(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    pts = []
    for o in objs:
        if o.type != "MESH": continue
        e = o.evaluated_get(dg); m = e.to_mesh()
        pts += [e.matrix_world @ v.co for v in m.vertices]
        e.to_mesh_clear()
    lo = Vector([min(p[i] for p in pts) for i in range(3)]); hi = Vector([max(p[i] for p in pts) for i in range(3)])
    return lo, hi


def montage(tiles, out, cols, bgcol):
    subprocess.run(["montage", *sum((["-label", lb, f] for f, lb in tiles), []), "-tile", f"{cols}x", "-geometry", "+3+3",
                    "-background", bgcol, "-fill", "#888" if bgcol != "white" else "black", "-pointsize", "13", out], check=True)
    print("QA_SHEET", out)


def set_clip(name, t):
    for a in arms:
        ad = a.animation_data or a.animation_data_create()
        for tr in ad.nla_tracks: tr.mute = True
        act = bpy.data.actions[name]; ad.action = act
        if hasattr(act, "slots") and len(act.slots): ad.action_slot = act.slots[0]
        f0, f1 = act.frame_range
        sc.frame_set(round(f0 + t * (f1 - f0)))


def rest():
    for a in arms:
        ad = a.animation_data
        if ad:
            ad.action = None
            for tr in ad.nla_tracks: tr.mute = True
        for pb in a.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
    sc.frame_set(0)


if "--pose" in argv:  # debug: big 4-view of one clip time, then stop
    c, t = argv[argv.index("--pose") + 1], float(argv[argv.index("--pose") + 2]); set_clip(c, t)
    lo, hi = bbox(asset); tiles = []
    for yaw, el in ((35, 18), (90, 0), (0, 0), (0, 85)):
        p = f"{TMP}/p{yaw}_{el}.png"; L.shoot(p, cam, tgt, (lo + hi) / 2, max(hi - lo) * 1.3, yaw=yaw, el=el, w=400, h=400); tiles.append((p, f"{c} {t} yaw {yaw} el {el}"))
    print(f"QA_POSE lo={[round(x, 2) for x in lo]} hi={[round(x, 2) for x in hi]}")
    montage(tiles, f"{OUT}/{NAME}_pose.png", 4, "white"); shutil.rmtree(TMP, ignore_errors=True); sys.exit(0)
rest()
lo, hi = bbox(asset)
ctr, ext = (lo + hi) / 2, hi - lo
S = max(ext) * 1.25
print(f"QA_BBOX {NAME} lo={[round(x, 3) for x in lo]} hi={[round(x, 3) for x in hi]}")

# 1. 8 views, cream bg
tiles = []
for i in range(8):
    p = f"{TMP}/v{i}.png"; L.shoot(p, cam, tgt, ctr, S, yaw=i * 45, el=12 if i % 2 == 0 else 28, w=360, h=360); tiles.append((p, f"yaw {i * 45}"))
montage(tiles, f"{OUT}/{NAME}_views.png", 4, "white")

# 2. per clip contact sheet, dark viewer-like bg; frame from the union bbox over the clip (root motion stays in view)
bg.inputs[0].default_value = (*L.lin("#22252b"), 1)
for c in clips:
    pts = []
    for k in range(NF):
        set_clip(c, k / (NF - 1)); pts += list(bbox(asset))
    clo = Vector([min(p[i] for p in pts) for i in range(3)]); chi = Vector([max(p[i] for p in pts) for i in range(3)])
    print(f"QA_CLIP {c} minz={[round(pts[k][2], 2) for k in range(0, len(pts), 2)]}")  # per frame lowest point: < -0.03 = sinks
    tiles = []
    for yaw, el, tag in ((35, 18, ""), (90, 3, " side")):  # row 1: 3/4 view, row 2: side (ground contact, depth)
        for k in range(NF):
            t = k / (NF - 1); set_clip(c, t)
            p = f"{TMP}/{c}_{k}_{yaw}.png"; L.shoot(p, cam, tgt, (clo + chi) / 2, max(chi - clo) * 1.2, yaw=yaw, el=el, w=260, h=260)
            tiles.append((p, f"{c} t={t:.2f}{tag}"))
    montage(tiles, f"{OUT}/{NAME}_anim_{c}.png", NF, "#22252b")
bg.inputs[0].default_value = (*L.lin("#efe6d6"), 1)
rest()

# 3. next to the hero (idle frame 0), on a ground disk, front 3/4 and side
if HERO:
    before, acts0 = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.gltf(filepath=os.path.join(os.path.dirname(__file__), "../../assets/characters/hero/hero.glb"))
    drop_shapes()
    hero = [o for o in bpy.data.objects if o not in before]
    for o in hero:
        for c in o.users_collection: c.objects.unlink(o)
        noink.objects.link(o)
    harm = [o for o in hero if o.type == "ARMATURE"]
    for a in harm:
        ad = a.animation_data or a.animation_data_create()
        for tr in ad.nla_tracks: tr.mute = True
        idle = [a for a in bpy.data.actions if a not in acts0 and re.fullmatch(r"idle(\.\d{3})?", a.name)]
        if idle:
            ad.action = idle[0]
            if len(ad.action.slots): ad.action_slot = ad.action.slots[0]
    sc.frame_set(1)
    root = [o for o in hero if o.parent is None]
    hlo, hhi = bbox(hero)
    for o in root: o.location.x += lo.x - 0.5 - hhi.x
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=max(ext.x, ext.y) + 1.6, fill_type="NGON", location=(ctr.x - 0.6, ctr.y, -0.002))
    disk = bpy.context.object; disk.data.materials.append(L.material("ground", "#cfc6a8"))
    hlo, hhi = bbox(hero)
    print(f"QA_HERO height={hhi.z - hlo.z:.2f} asset height={ext.z:.2f} ratio={ext.z / (hhi.z - hlo.z):.2f} asset_minz={lo.z:.3f}")
    a2 = Vector((min(lo.x, hlo.x), min(lo.y, hlo.y), 0)); b2 = Vector((max(hi.x, hhi.x), max(hi.y, hhi.y), max(hi.z, hhi.z)))
    tiles = []
    for i, (yaw, el) in enumerate(((20, 12), (0, 2), (90, 4))):
        p = f"{TMP}/h{i}.png"; L.shoot(p, cam, tgt, (a2 + b2) / 2, max(b2 - a2) * 1.45, yaw=yaw, el=el, w=480, h=360); tiles.append((p, f"hero scale yaw {yaw}"))
    montage(tiles, f"{OUT}/{NAME}_hero.png", 3, "white")
shutil.rmtree(TMP, ignore_errors=True)
