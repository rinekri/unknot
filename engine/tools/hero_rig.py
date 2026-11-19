"""Hero rig + clip rebuild (headless Blender, reproducible).
Run (from repo root):
  B=/Applications/Blender.app/Contents/MacOS/Blender
  $B -b --factory-startup --python engine/tools/hero_rig.py -- assets/characters/hero/src/hero_v1.glb \
     assets/characters/hero/src/hero_rebuilt.glb [--qa playtest/hero_rig]
  $B -b --factory-startup --python ~/.claude/skills/video-to-game/scripts/merge_anims.py -- \
     assets/characters/hero/hero.glb assets/characters/hero/src/hero_rebuilt.glb --fps 24 --scale 1 \
     --once jump,land,slash,sing,dash,jump.b,land.hard,slash.b,slash.c,idle.look,idle.lean,idle.stretch,idle.kick,gift_receive,stumble,land.roll,land.crouch,skid,sit,land.crumple,slash.air,strike.down \
     $(for c in idle.look idle.lean idle.stretch idle.kick slash.b slash.c jump.b land.hard land.roll land.crouch run.sprint run.tired walk.careful air.updraft fall.long land.crumple slash.air strike.down glide.fall glide; do printf -- '--rename %s=%s ' $c $c; done) \
     --extras "$(cat assets/characters/hero/src/hero_rebuilt.extras.json)"
Source: hero_v1.glb = hero_rig.glb after blender_prep (rotate -90, 1.3 m baked into the Armature node) + the Tripo clips.
Input = hero_assemble.py output (separate body / hood / skirt / backpack / pouch / staff meshes on the Tripo humanoid rig).
Adds spring bones (cloak chains: back, sides, front flaps, hood tip; each chain ends in an unweighted *_end bone so the engine
reads link lengths from the rig), R_Prop (staff, 100 %) and L/R_Armpit correctives (keyed to half the upper arm's turn,
carrying part of the armpit skin's upper-arm weight). Hood + skirt form one double-sided skinned mesh (hero_cloak) weighted to
torso bones + Head + the spring chains, <= 0.1 upper arm (the rest on the collarbone), never forearm/hand. Backpack 100 %
Spine02, belt pouch 100 % Pelvis; with --qa every frame of every clip is checked for gear-to-body gaps (rep gear_gap_max).
The export's node transforms are idle frame 0, so the model loads standing as in idle. Clips: idle slowed back to
authored speed, run baked in place + loop seam spread over the cycle + phase-aligned to walk; jump/fall/land, the slash
(a forward staff thrust) and the dash (crouch, stretch, recover) authored procedurally, plus gift_receive / stumble (Tripo v3 biped presets have no jump-up/fall-loop/land, its slash raised the
arms over the head). Everything stays at 24 fps (glTF import default),
so merge_anims must get --fps 24 or clips are re-timed 1.25x. Writes <out>.extras.json (stride, events) for merge_anims.
World axes here (Blender, after import): hero faces -Y, hero's left = +X, up = +Z."""
import bpy, sys, os, json, math, colorsys
from mathutils import Vector, Matrix, Quaternion
from mathutils.kdtree import KDTree
from mathutils.bvhtree import BVHTree

POUCH_AT = -14  # deg left of straight ahead on the belt (negative: right of the buckle; U13 sweep 42 / 22 / 6 / -14 crossed the arms in 25 / 17 / 4 / 3 clips)
argv = sys.argv[sys.argv.index("--") + 1:]
SRC, OUT = argv[0], argv[1]
QA = argv[argv.index("--qa") + 1] if "--qa" in argv else None

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
FPS = sc.render.fps  # 24
bpy.ops.import_scene.gltf(filepath=SRC)
arm = next(o for o in sc.objects if o.type == "ARMATURE")
for o in {pb.custom_shape for pb in arm.pose.bones if pb.custom_shape}: bpy.data.objects.remove(o)  # Tripo bone display shape
OBJ = {o.name: o for o in sc.objects if o.type == "MESH"}
mesh, skirt, pack, pouch, staff_o = (OBJ[n] for n in ("hero_body", "hero_skirt", "gear_backpack", "gear_pouch", "hero_staff"))
hood = OBJ.get("hero_hood")
# fused input (P2 body): no hero_hood mesh; the body's faces with the "hero_cloak" material are the hood + capelet, weighted in place
FUSED = hood is None
if FUSED:
    CM = mesh.data.materials.find("hero_cloak")
    CV = sorted({i for p_ in mesh.data.polygons if p_.material_index == CM for i in p_.vertices})
ad = arm.animation_data
for t in list(ad.nla_tracks): ad.nla_tracks.remove(t)
SRC_ACTS = {a.name: a for a in bpy.data.actions}
BODY = [b.name for b in arm.data.bones]
MW = arm.matrix_world.copy()


def bw(n): return MW @ arm.data.bones[n].head_local


CX, CY = bw("Hip").x, bw("Hip").y  # body centre


def smooth(e0, e1, x):
    t = min(1.0, max(0.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


def P(x, y, z): return Vector((x, y, z))


wco = lambda o: [o.matrix_world @ v.co for v in o.data.vertices]
az = lambda c: math.degrees(math.atan2(c.x - CX, c.y - CY))  # 0 = straight behind, +90 = hero's left, +-180 = front
HCO = [mesh.matrix_world @ mesh.data.vertices[i].co for i in CV] if FUSED else wco(hood)
SCO = wco(skirt)


def mean_near(pts, zk, dz=0.03):
    s = [c for c in pts if abs(c.z - zk) < dz] or sorted(pts, key=lambda c: abs(c.z - zk))[:5]
    return sum(s, Vector()) / len(s)


# ---------- 1. bones: spring chains placed from the cloak geometry ----------
PACK_IN = 0.035  # m the backpack is moved toward the spine (hero faces -Y)
ZC = 0.70  # skirt chains start under the backpack (its bottom ~0.68): above, the skirt rides the torso, so a swing never meets the pack
CHAINS, PARENT = {}, {}
for ch, A in (("Cloak_B", 0), ("Cloak_L", 55), ("Cloak_R", -55)):
    col = [c for c in SCO if abs(az(c) - A) < 10]
    hem = min(c.z for c in col)
    zs = [ZC + (hem + 0.01 - ZC) * k / 3 for k in range(4)]
    CHAINS[ch] = [mean_near(col, z) for z in zs]
    PARENT[ch] = "Spine01"
# front flaps: the capelet's front panels left/right of the chest, from below the collarbone to their lowest edge; a panel
# that ends high at the front (Tripo capelets are not symmetric) widens its sector toward the side until it hangs 8 cm
FLAP_AZ = {}
for ch, sg in (("Cloak_FL", 1), ("Cloak_FR", -1)):
    top = bw(f"{'L' if sg > 0 else 'R'}_Clavicle").z - 0.04
    for lo in (125, 120, 115, 110, 105, 100):
        col = [c for c in HCO if abs(az(c)) > lo and sg * (c.x - CX) > 0.05]
        if min(c.z for c in col) < top - 0.08: break
    FLAP_AZ[ch] = lo
    bot = min(c.z for c in col) + 0.01
    CHAINS[ch] = [mean_near(col, top + (bot - top) * k / 2, 0.025) for k in range(3)]
    PARENT[ch] = "Spine02"
# hood tip: the peak above the skull
HEADG = mesh.vertex_groups["Head"].index
CVS = set(CV) if FUSED else set()
HT = max((mesh.matrix_world @ v.co).z for v in mesh.data.vertices if v.index not in CVS and any(g.group == HEADG and g.weight > 0.5 for g in v.groups))
tip = max(HCO, key=lambda c: c.z)
h0 = mean_near([c for c in HCO if c.z > HT - 0.05], HT, 0.015)
CHAINS["Hood"] = [h0, h0.lerp(tip, 0.5), tip]
PARENT["Hood"] = "Head"

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode="EDIT")
eb = arm.data.edit_bones
inv = MW.inverted()
NEW = {}
for ch, pts in CHAINS.items():
    parent, names = eb[PARENT[ch]], []
    n = len(pts) - 1
    for i in range(n + 1):
        nm = f"{ch}{i + 1}" if n > 1 else ch
        if i == n: nm = f"{ch}_end"
        b = eb.new(nm)
        b.head = inv @ pts[i]
        tail = pts[i + 1] if i < n else pts[i] + (pts[i] - pts[i - 1]).normalized() * 0.05
        b.tail = inv @ tail
        b.parent = parent
        b.use_connect = i > 0
        b.use_deform = i < n
        parent = b
        names.append(nm)
    NEW[ch] = names
hb = eb["R_Hand"]
pb_ = eb.new("R_Prop")  # the staff's bone: unkeyed child of the hand, so the staff is one rigid piece
pb_.head = hb.head; pb_.tail = hb.head + (hb.tail - hb.head) * 0.5; pb_.roll = hb.roll; pb_.parent = hb; pb_.use_deform = True
PIT = {}  # armpit correctives: copy of the upper arm on the collarbone, keyed to half the upper arm's turn (apply/write)
for sd in "LR":
    ua = eb[f"{sd}_Upperarm"]; h_ = eb.new(f"{sd}_Armpit")
    h_.head, h_.tail, h_.roll, h_.parent, h_.use_deform = ua.head, ua.tail, ua.roll, ua.parent, True
    PIT[h_.name] = ua.name
bpy.ops.object.mode_set(mode="OBJECT")


def chain_w(ch, z):
    """weights of a chain's bones from height: linear between bone midpoints, clamped at the ends"""
    zs = [p.z for p in CHAINS[ch]]
    mids = [(zs[i] + zs[i + 1]) / 2 for i in range(len(zs) - 1)]
    if z >= mids[0]: return [1.0] + [0.0] * (len(mids) - 1)
    if z <= mids[-1]: return [0.0] * (len(mids) - 1) + [1.0]
    out = [0.0] * len(mids)
    for i in range(len(mids) - 1):
        if mids[i] >= z >= mids[i + 1]:
            t = (mids[i] - z) / (mids[i] - mids[i + 1]); out[i], out[i + 1] = 1 - t, t
    return out


# ---------- 2. weights: every part is its own mesh; nothing shares a vertex with an arm ----------
ARMP, LEGP = ("Forearm", "Hand", "Thumb", "Index", "Mid", "Ring", "Pinky", "Elbow"), ("Thigh", "Calf", "Knee", "Foot", "Toe")
BCO = wco(mesh)
GN = {g.index: g.name for g in mesh.vertex_groups}
BWT = [{GN[g.group]: g.weight for g in v.groups if g.weight > 1e-4} for v in mesh.data.vertices]
LIMBW = lambda d: sum(w for n, w in d.items() if "Upperarm" in n or any(t in n for t in ARMP + LEGP))
TORSO = [i for i, d in enumerate(BWT) if LIMBW(d) < 0.5]  # cloth copies torso skin only: a hanging hand never drags the skirt
bkd = KDTree(len(TORSO))
for i in TORSO: bkd.insert(BCO[i], i)
bkd.balance()
UCAP = 0.1  # cloth over a shoulder follows the upper arm at most this much (the rest stays on the collarbone)



def transfer(c):
    """weights of the nearest torso skin (residual forearm/hand weight goes up to the upper arm, leg weight to the pelvis),
    upper arm capped (the excess rides the collarbone) -- cloth never follows a forearm, and never jumps weights"""
    acc = {}
    for _, i, d in bkd.find_n(c, 8):
        for n, w in BWT[i].items():
            if any(t in n for t in ARMP): n = n[:2] + "Upperarm"
            elif any(t in n for t in LEGP): n = "Pelvis"
            acc[n] = acc.get(n, 0) + w / (d + 0.01)
    s = sum(acc.values())
    acc = {n: w / s for n, w in acc.items()}
    for sd in "LR":
        u = acc.get(f"{sd}_Upperarm", 0)
        if u > UCAP: acc[f"{sd}_Upperarm"] = UCAP; acc[f"{sd}_Clavicle"] = acc.get(f"{sd}_Clavicle", 0) + u - UCAP
    return acc


def relax(o, ws, n=4, idx=None):
    """average each vertex's weights with its mesh neighbours' (no sharp weight steps = no stretched faces);
    idx: ws covers only these vertices of o (neighbours outside idx are ignored)"""
    pos = {v: k for k, v in enumerate(idx)} if idx is not None else None
    nb = [[] for _ in ws]
    for e in o.data.edges:
        a, b = e.vertices
        if pos is not None:
            if a not in pos or b not in pos: continue
            a, b = pos[a], pos[b]
        nb[a].append(b); nb[b].append(a)
    for _ in range(n):
        out = []
        for i, d in enumerate(ws):
            acc = {k: 0.5 * w for k, w in d.items()}
            if not nb[i]: out.append(d); continue
            for j in nb[i]:
                for k, w in ws[j].items(): acc[k] = acc.get(k, 0) + 0.5 * w / len(nb[i])
            s = sum(acc.values()); out.append({k: w / s for k, w in acc.items() if w / s > 1e-3})
        ws = out
    return ws


def twin_avg(o, idx, ws):
    """the glTF import split the mesh at UV seams and relax / ring distances walk edges, so seam twins (same position)
    end up with different weights and the skin opens along the seam when posed: give each twin set their mean"""
    tw = {}
    for k, i in enumerate(idx): tw.setdefault(tuple(round(x, 5) for x in o.data.vertices[i].co), []).append(k)
    ws = list(ws)
    for ks in tw.values():
        if len(ks) > 1:
            avg = {}
            for k in ks:
                for n, w in ws[k].items(): avg[n] = avg.get(n, 0) + w / len(ks)
            for k in ks: ws[k] = avg
    return ws


def put(o, ws):
    for i, d in enumerate(ws):
        for n, w in d.items():
            if w > 1e-4: (o.vertex_groups.get(n) or o.vertex_groups.new(name=n)).add([i], w, "REPLACE")


ZN, ZH = bw("NeckTwist02").z, bw("Head").z
hw = []
for c in HCO:  # hood + capelet: torso skin weights -> Head from the neck up -> hood tip chain, front flap chains
    d = transfer(c)
    fh = smooth(ZN, ZH + 0.02, c.z)
    d = {n: w * (1 - fh) for n, w in d.items()}; d["Head"] = d.get("Head", 0) + fh
    ft = smooth(HT, HT + 0.05, c.z) * smooth(0.0, 0.02, (c - h0).length)
    if ft > 0:
        d = {n: w * (1 - ft) for n, w in d.items()}
        for nm, w in zip(NEW["Hood"], chain_w("Hood", c.z)): d[nm] = d.get(nm, 0) + ft * w
    for ch, sg in (("Cloak_FL", 1), ("Cloak_FR", -1)):
        ff = smooth(FLAP_AZ[ch], FLAP_AZ[ch] + 20, abs(az(c))) * smooth(0.03, 0.06, sg * (c.x - CX)) * smooth(CHAINS[ch][0].z, CHAINS[ch][0].z - 0.06, c.z)
        if ff > 0:
            d = {n: w * (1 - ff) for n, w in d.items()}
            for nm, w in zip(NEW[ch], chain_w(ch, c.z)): d[nm] = d.get(nm, 0) + ff * w
    hw.append(d)
SA = [(-55, "Cloak_R"), (0, "Cloak_B"), (55, "Cloak_L")]
sw = []
for c in SCO:  # skirt: torso above ZC, then the back/side chains blended by angle around the body
    a = max(-55, min(55, az(c)))
    k = 0 if a <= 0 else 1
    t = (a - SA[k][0]) / 55
    fc = smooth(ZC + 0.02, ZC - 0.08, c.z)
    d = {n: w * (1 - fc) for n, w in transfer(c).items()}
    for ch, wc in ((SA[k][1], 1 - t), (SA[k + 1][1], t)):
        for nm, w in zip(NEW[ch], chain_w(ch, c.z)): d[nm] = d.get(nm, 0) + fc * wc * w
    sw.append(d)
sw = twin_avg(skirt, range(len(sw)), relax(skirt, sw, 10))
if FUSED:
    # blend into the body's own (heat) weights: 0 on the cloth's border rings (the glTF seam twins of body vertices keep
    # identical weights, so nothing tears), the cloth weights from 4 rings in
    hw = relax(mesh, hw, 10, CV)
    nb = {i: [] for i in CV}
    for e in mesh.data.edges:
        a, b = e.vertices
        if a in CVS and b in CVS: nb[a].append(b); nb[b].append(a)
    bkd_all = KDTree(len(mesh.data.vertices) - len(CV))
    for v in mesh.data.vertices:
        if v.index not in CVS: bkd_all.insert(v.co, v.index)
    bkd_all.balance()
    ring = {i: 0 for i in CV if bkd_all.find(mesh.data.vertices[i].co)[2] < 1e-5}
    fr = list(ring)
    while fr:
        nx = []
        for i in fr:
            for j in nb[i]:
                if j not in ring: ring[j] = ring[i] + 1; nx.append(j)
        fr = nx
    BGN = {g.index: g.name for g in mesh.vertex_groups}
    D = []
    for k, i in enumerate(CV):
        f = min(1.0, ring.get(i, 99) / 4)
        d = {n: (1 - f) * w for n, w in ((BGN[g.group], g.weight) for g in mesh.data.vertices[i].groups)}
        for n, w in hw[k].items(): d[n] = d.get(n, 0) + f * w
        D.append(d)
    D = twin_avg(mesh, CV, D)
    for k, i in enumerate(CV):
        d = D[k]; v = mesh.data.vertices[i]
        for g in list(v.groups): mesh.vertex_groups[g.group].remove([i])
        for n, w in d.items():
            if w > 1e-4: (mesh.vertex_groups.get(n) or mesh.vertex_groups.new(name=n)).add([i], w, "REPLACE")
    print("FUSED cloth verts", len(CV), "seam", sum(1 for r in ring.values() if r == 0), "unreached", len(CV) - len(ring))
else:
    hw = relax(hood, hw, 10)
    put(hood, hw)
put(skirt, sw)
for v in pack.data.vertices: v.co = pack.matrix_world.inverted() @ (pack.matrix_world @ v.co + Vector((0, -PACK_IN, 0)))  # sunk into the back: with the cloak blown off it (jump, fall) no air shows between pack and torso
put(pack, [{"Spine02": 1.0}] * len(pack.data.vertices))  # rigid: one bone, nothing to smear
# U13: the belt pouch sat behind the hip, in the arm's swing: turned about the body axis to the front of the belt (POUCH_AT deg
# left of straight ahead, now just right of the buckle), then slid along that radius until its innermost point is 3 mm off the skin
_pw = [pouch.matrix_world @ v.co for v in pouch.data.vertices]; _pc = sum(_pw, Vector()) / len(_pw)
_ta = math.radians(POUCH_AT); _to = Vector((math.sin(_ta), -math.cos(_ta), 0))
_R = Matrix.Rotation(math.atan2(_to.y, _to.x) - math.atan2(_pc.y - CY, _pc.x - CX), 4, "Z")
_pw = [_R @ (w - Vector((CX, CY, 0))) + Vector((CX, CY, 0)) for w in _pw]
_bb = BVHTree.FromPolygons([mesh.matrix_world @ v.co for v in mesh.data.vertices], [list(p_.vertices) for p_ in mesh.data.polygons])
for _ in range(200):  # signed gap to the skin (the body's normals point out)
    _g = min((w - n_[0]).dot(n_[1]) for w in _pw for n_ in (_bb.find_nearest(w),))
    if abs(_g - 0.003) < 0.0005: break
    _pw = [w + _to * (0.003 - _g) * 0.7 for w in _pw]
for v, w in zip(pouch.data.vertices, _pw): v.co = pouch.matrix_world.inverted() @ w
print("POUCH moved to", [round(x, 3) for x in sum(_pw, Vector()) / len(_pw)], "skin gap", round(_g, 4))
put(pouch, [{"Pelvis": 1.0}] * len(pouch.data.vertices))
for o, k in ((pack, 1), (pouch, 2)):  # gear island id, kept through the join for the gear-distance check (not exported)
    o.data.attributes.new("gear", "INT", "POINT").data.foreach_set("value", [k] * len(o.data.vertices))
# armpit: skin blending between the torso and the upper arm moves part of its upper-arm weight onto the half-turn helper,
# so the armpit fold follows half the arm swing instead of stretching between 0 and 100 %
pit_w = 0
for sd in "LR":
    gu = mesh.vertex_groups[f"{sd}_Upperarm"]; gp = mesh.vertex_groups.new(name=f"{sd}_Armpit")
    for v in mesh.data.vertices:
        u = next((g.weight for g in v.groups if g.group == gu.index), 0)
        if 0.02 < u < 0.98:
            m_ = 0.5 * u * 4 * u * (1 - u)
            gu.add([v.index], u - m_, "REPLACE"); gp.add([v.index], m_, "REPLACE"); pit_w += 1
weighted = {nm: sum(1 for d in hw + sw if d.get(nm, 0) > 0.05) for ch in NEW for nm in NEW[ch][:-1]}

# ---------- 2b. one skinned body (body + gear; the staff joins after the clips) and one double-sided cloak (hood + skirt) ----------
if FUSED:
    cm = mesh.data.materials[CM]; mat = mesh.data.materials[1 - CM]
else:
    mat = mesh.data.materials[0]; cm = mat.copy(); cm.name = "hero_cloak"
cm.use_backface_culling = False  # glTF doubleSided; player.js finds the cloak by this name
cloths = [skirt] if FUSED else [hood, skirt]
for o in cloths: o.data.materials.clear(); o.data.materials.append(cm)
with bpy.context.temp_override(active_object=mesh, selected_editable_objects=[mesh, *cloths, pack, pouch]):
    bpy.ops.object.join()
bpy.context.view_layer.objects.active = mesh
for o in sc.objects: o.select_set(o == mesh)
bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT"); bpy.ops.mesh.separate(type="MATERIAL"); bpy.ops.object.mode_set(mode="OBJECT")
for o in [o for o in sc.objects if o.type == "MESH" and o != staff_o]:
    bpy.context.view_layer.objects.active = o
    with bpy.context.temp_override(object=o, active_object=o): bpy.ops.object.material_slot_remove_unused()
cloak = next(o for o in sc.objects if o.type == "MESH" and o.data.materials[0].name == "hero_cloak")
mesh = next(o for o in sc.objects if o.type == "MESH" and o not in (cloak, staff_o))
cloak.name = cloak.data.name = "hero_cloak"; mesh.name = mesh.data.name = "hero_body"
for o in (mesh, cloak):
    used = {o.vertex_groups[gg.group].name for v in o.data.vertices for gg in v.groups if gg.weight > 0}
    for g in [g for g in o.vertex_groups if g.name not in used]: o.vertex_groups.remove(g)  # smaller skin per part
tri = lambda o: sum(len(p_.vertices) - 2 for p_ in o.data.polygons)
rep_parts = {"body_gear_tris": tri(mesh), "cloak_tris": tri(cloak), "staff_tris": tri(staff_o), "HT": round(HT, 3),
             "chains": {ch: [[round(x, 3) for x in p_] for p_ in pts] for ch, pts in CHAINS.items()}}

# ---------- 3. clips ----------
def use(act):
    ad.action = act
    if hasattr(act, "slots") and len(act.slots): ad.action_slot = act.slots[0]


def pose_at(f):
    sc.frame_set(int(math.floor(f)), subframe=f - math.floor(f))
    return {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in arm.pose.bones if pb.name in BODY}


def sample(act, n=None, stretch=1.0):
    """n+1 evenly spaced poses over the action (first..last key), optionally time-stretched"""
    use(act)
    a0, a1 = act.frame_range
    n = n or int(round((a1 - a0) * stretch))
    return [pose_at(a0 + (a1 - a0) * k / n) for k in range(n + 1)]


def spread_seam(frames):
    """loop: make last == first by distributing the end mismatch linearly over the clip"""
    n = len(frames) - 1
    f0, fn = frames[0], frames[-1]
    for k, fr in enumerate(frames):
        t = k / n
        for b, (loc, q) in fr.items():
            dq = f0[b][1] @ fn[b][1].inverted()
            if dq.w < 0: dq.negate()
            fr[b] = (loc + (f0[b][0] - fn[b][0]) * t, Quaternion().slerp(dq, t) @ q)
    return frames


def move(b, v):
    pb = arm.pose.bones[b]
    bpy.context.view_layer.update()
    m = MW @ pb.matrix
    pb.matrix = MW.inverted() @ (Matrix.Translation(v) @ m)


def grab():
    bpy.context.view_layer.update()
    return {pb.name: (pb.location.copy(), pb.rotation_quaternion.copy()) for pb in arm.pose.bones if pb.name in BODY}


def in_place(frames, mean=False):
    """bake root motion out: hold the Hip head at its rest x/y (world horizontal), keep the vertical bob;
    mean: only remove the clip's average offset (keeps the sway)"""
    rest = MW @ arm.data.bones["Hip"].head_local
    hs = []
    for fr in frames:
        apply(fr); hs.append((MW @ arm.pose.bones["Hip"].head).copy())
    avg = sum(hs, Vector()) / len(hs)
    out = []
    for fr, h in zip(frames, hs):
        apply(fr)
        c = avg if mean else h
        move("Hip", Vector((rest.x - c.x, rest.y - c.y, 0)))
        out.append(grab())
    return out


def half(q):  # half of a rotation, the short way round
    return Quaternion().slerp(q if q.w >= 0 else -q, 0.5)


def apply(fr):
    if ad.action: ad.action = None
    for b, (loc, q) in fr.items():
        pb = arm.pose.bones[b]; pb.location = loc; pb.rotation_quaternion = q; pb.scale = (1, 1, 1)
    for h_, ua in PIT.items(): arm.pose.bones[h_].rotation_quaternion = half(arm.pose.bones[ua].rotation_quaternion)
    bpy.context.view_layer.update()


def foot_track(frames):
    """world foot heads per frame (L, R)"""
    out = []
    for fr in frames:
        apply(fr)
        out.append(tuple(MW @ arm.pose.bones[f"{s}_Foot"].head for s in "LR"))
    return out


def strikes(track, side):
    """normalized times where the foot is most forward (min world y) -> heel strike, one per gait cycle"""
    n = len(track) - 1
    ys = [p[side].y for p in track[:-1]]
    return [k / n for k in range(n) if ys[k] <= ys[k - 1] and ys[k] < ys[(k + 1) % n] and ys[k] < sum(ys) / n]


def stride(track, dur):
    """meters per clip = mean backward speed of the planted foot x clip duration"""
    n = len(track) - 1
    sp = []
    for s in (0, 1):
        zmin = min(p[s].z for p in track)
        for k in range(n):
            if track[k][s].z < zmin + 0.012 and track[k + 1][s].z < zmin + 0.012:
                sp.append((track[k + 1][s].y - track[k][s].y) * FPS)
    return sum(sp) / len(sp) * dur


def write(name, frames):
    act = bpy.data.actions.new(name)
    use(act)
    frames = [{**fr, **{h_: (Vector(), half(fr[ua][1])) for h_, ua in PIT.items()}} for fr in frames]
    for b in BODY + list(PIT):
        locs = [fr[b][0] for fr in frames]
        qs, prev = [], None
        for fr in frames:  # sign continuity
            q = fr[b][1].copy()
            if prev is not None and prev.dot(q) < 0: q.negate()
            qs.append(q); prev = q
        for path, vals, nidx in ((f'pose.bones["{b}"].location', locs, 3), (f'pose.bones["{b}"].rotation_quaternion', qs, 4)):
            for i in range(nidx):
                fc = act.fcurve_ensure_for_datablock(arm, path, index=i)
                fc.keyframe_points.add(len(frames))
                flat = []
                for k, v in enumerate(vals): flat += [k, v[i]]
                fc.keyframe_points.foreach_set("co", flat)
                for kp in fc.keyframe_points: kp.interpolation = "LINEAR"
                fc.update()
    return act


rep = {"weighted_verts": weighted, "parts": rep_parts, "armpit_verts": pit_w}
clips = {}

idle = in_place(sample(SRC_ACTS["idle"]), mean=True)  # Tripo idle preset at its own speed (369 frames); it stands ~16 cm off the root
clips["idle"] = idle

walk = in_place(spread_seam(sample(SRC_ACTS["walk"], stretch=0.8)), mean=True)  # seam first (takes the root motion out), then centre: the other order left the hip 0.94 m ahead;  # Tripo presets are slower than the old clips: same cadence (walk 46 f, run 25 f)
clips["walk"] = walk

run = spread_seam(in_place(sample(SRC_ACTS["run"], stretch=0.8)))
# phase-align run to walk: rotate run so its first left heel strike lands on walk's (shared normalized time)
wt, rt = foot_track(walk), foot_track(run)
wl, rl = strikes(wt, 0), strikes(rt, 0)
n = len(run) - 1
shift = int(round(((wl[0] - rl[0]) % 0.5) * n))  # both clips hold 2 gait cycles
run = [run[(k - shift) % n] for k in range(n)]
run.append(dict(run[0]))
clips["run"] = run


def max_jump(frames, bones):
    best = (0, 0, "")
    for k in range(1, len(frames)):
        for b in bones:
            d = math.degrees(frames[k][b][1].rotation_difference(frames[k - 1][b][1]).angle); d = min(d, 360 - d)  # q and -q: same turn
            if d > best[0]: best = (d, k, b)
    return best


# ---------- procedural clips (world-space rotations about each bone head) ----------
X, Y, Z = Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))
BASE = idle[0]


def rot(b, axis, deg):
    pb = arm.pose.bones[b]
    bpy.context.view_layer.update()
    m = MW @ pb.matrix
    h = m.translation.copy()
    pb.matrix = MW.inverted() @ (Matrix.Translation(h) @ Matrix.Rotation(math.radians(deg), 4, axis) @ Matrix.Translation(-h) @ m)
    pb.scale = (1, 1, 1)  # the matrix setter can leave float scale/shear behind, which compounds down the chain


def add(spine=0, thigh=(0, 0), calf=(0, 0), foot=(0, 0), arm_fwd=(0, 0), arm_out=(0, 0), fore=(0, 0), clav=(0, 0), hip=0, head=0, leg_out=(0, 0), wrist=(0, 0), turn=0,
        twist=0, side=0, arm_yaw=(0, 0), body=0):
    """rotations on top of the current pose (see pose); twist + = torso turned to the hero's left (spine about up, after the arms, so
    the arms ride it); side + = torso leaned to the hero's left; arm_yaw + = upper arm swung toward the hero's left about up;
    body + = whole body pitched forward about the hip (flips, rolls)"""
    if hip: move("Hip", Vector((0, 0, -hip)))
    if body: rot("Hip", X, body)
    rot("Spine01", X, spine * 0.5); rot("Spine02", X, spine * 0.5); rot("Head", X, head)
    if side: rot("Spine01", Y, side * 0.5); rot("Spine02", Y, side * 0.5)
    if turn: rot("Head", Z, turn)
    for i, s in enumerate("LR"):
        sg = 1 if s == "L" else -1  # hero's left is +X
        rot(f"{s}_Thigh", Y, -sg * leg_out[i]); rot(f"{s}_Thigh", X, -thigh[i])
        rot(f"{s}_Calf", X, calf[i]); rot(f"{s}_Foot", X, -foot[i])
        rot(f"{s}_Clavicle", Y, -sg * clav[i])
        rot(f"{s}_Upperarm", Y, -sg * arm_out[i]); rot(f"{s}_Upperarm", X, -arm_fwd[i])
        rot(f"{s}_Forearm", X, -fore[i]); rot(f"{s}_Hand", X, -wrist[i])
        if arm_yaw[i]: rot(f"{s}_Upperarm", Z, arm_yaw[i])
    if twist: rot("Spine01", Z, twist * 0.5); rot("Spine02", Z, twist * 0.5)
    return grab()


def pose(**kw):
    """hero-relative degrees: spine + = lean forward; thigh + = knee forward; calf + = knee bend; arm_fwd + = hand forward;
    arm_out + = arm raised sideways; fore + = elbow bend; clav + = shoulder up; leg_out + = leg apart; hip = m down (< 0 up);
    wrist + = hand pitched forward (the staff tips forward with it); turn + = head turned to the hero's left"""
    apply(BASE)
    return add(**kw)


def mod(frames, **kw):
    """the same rotations added on every frame of a clip (locomotion variants keep the base clip's timing and phase)"""
    out = []
    for fr in frames:
        apply(fr); out.append(add(**kw))
    return out


def lerp_pose(a, b, t):
    return {bn: (a[bn][0].lerp(b[bn][0], t), a[bn][1].slerp(b[bn][1], t)) for bn in BODY}


def keys(spec, n):
    """spec: [(frame, pose)] -> n+1 frames, smoothstep between keys"""
    out = []
    for k in range(n + 1):
        for (f0, p0), (f1, p1) in zip(spec, spec[1:]):
            if f0 <= k <= f1:
                out.append(lerp_pose(p0, p1, smooth(0, 1, (k - f0) / max(1, f1 - f0)))); break
        else:
            out.append(spec[-1][1])
    return out


# arm limits for every procedural clip: left arm_out <= 0 (in by the body, under the cloak); the right arm is the cane pose (set below)
# jump (0.5 s, once): stretched take-off -> knees-up tuck, spine leaning in
take = pose(spine=-6, foot=(-25, -25), arm_fwd=(30, 35), arm_out=(-8, 25), fore=(30, 20), clav=(6, 6), head=-4)
tuck = pose(spine=14, thigh=(60, 45), calf=(85, 75), foot=(10, 10), arm_fwd=(25, 25), arm_out=(-5, 30), fore=(50, 45), clav=(4, 4), head=6)
hold = pose(spine=10, thigh=(45, 35), calf=(65, 60), foot=(10, 10), arm_fwd=(20, 20), arm_out=(-5, 28), fore=(45, 35), clav=(3, 3), head=4)
clips["jump"] = keys([(0, take), (6, tuck), (12, hold)], 12)

# fall (1 s loop): small arm flail (L/R out of phase), legs paddle, head level-to-forward (never tipped back)
fall = []
n = 24
for k in range(n + 1):
    a = 2 * math.pi * k / n
    fall.append(pose(spine=2, thigh=(20 + 12 * math.sin(a), 20 - 12 * math.sin(a)), calf=(35 + 10 * math.sin(a + 1), 35 - 10 * math.sin(a + 1)),
                     leg_out=(8, 8), foot=(15, 15), arm_out=(-4 + 4 * math.sin(2 * a), 27 + 7 * math.sin(2 * a + math.pi)),
                     arm_fwd=(20 + 15 * math.sin(a), 20 - 15 * math.sin(a)), fore=(35 + 15 * math.sin(2 * a + 0.8), 35 + 15 * math.sin(2 * a + 0.8 + math.pi)),
                     clav=(4 + 3 * math.sin(2 * a), 4 + 3 * math.sin(2 * a + math.pi)), head=-1 + 5 * math.sin(a)))
clips["fall"] = fall

idle0 = pose()
HIT = 9  # strike contact frame, shared by the three combo strikes (player.js times every strike to it)

# land (0.5 s, once, played ADDITIVE over locomotion; frame 0 = BASE so its delta starts at 0): squat and recover
neutral = pose()
squat = pose(hip=0.09, spine=18, thigh=(38, 38), calf=(70, 70), foot=(32, 32), arm_out=(-5, 0), arm_fwd=(10, 0), fore=(20, 0), head=-6)
clips["land"] = keys([(0, neutral), (2, squat), (5, lerp_pose(squat, neutral, 0.35)), (12, neutral)], 12)

# dash (0.42 s, once): crouch -> stretch (rear leg long, left arm swept back, head down into it) -> recover to a run lean.
# player.js also pitches the whole model forward during the burst, so the spine lean here stays moderate.
crouch = pose(hip=0.07, spine=16, thigh=(45, 35), calf=(70, 60), foot=(20, 20), arm_fwd=(-10, 0), arm_out=(-4, 0), fore=(35, 0), head=-6)
stretch = pose(spine=14, thigh=(-30, 50), calf=(15, 75), foot=(-25, 15), arm_fwd=(-40, 0), arm_out=(-6, 0), fore=(10, 0), head=-10)
recover = pose(spine=8, thigh=(18, 10), calf=(30, 20), foot=(5, 5), arm_fwd=(5, 0), arm_out=(-3, 0), fore=(25, 0), head=-3)
clips["dash"] = keys([(0, crouch), (2, stretch), (5, stretch), (10, recover)], 10)

# land.hard (0.75 s, additive like land, frame 0 neutral): deep squat, left hand reaching down, slower recovery
squat_h = pose(hip=0.15, spine=30, thigh=(60, 55), calf=(100, 95), foot=(40, 40), arm_fwd=(35, 0), arm_out=(-5, 0), fore=(15, 0), head=-10)
clips["land.hard"] = keys([(0, neutral), (2, squat_h), (6, squat_h), (10, lerp_pose(squat_h, neutral, 0.4)), (18, neutral)], 18)

# ---------- story clips (once; hand-authored right arm, so they stay out of the cane override below) ----------
# gift_receive (1.6 s): head drops to the cloak seam at the left shoulder, left hand up to touch it, then a small staff raise, settle
CANE = dict(arm_fwd=(0, 15), arm_out=(0, -5), fore=(0, 50))
g_idle = pose(**CANE)
g_look = pose(head=24, spine=8, turn=22, arm_fwd=(30, 15), arm_out=(-4, -5), fore=(85, 50), clav=(4, 0))
g_raise = pose(head=-4, spine=-3, turn=4, arm_fwd=(12, 50), arm_out=(-3, 0), fore=(40, 35), clav=(0, 8), wrist=(0, -10))
clips["gift_receive"] = keys([(0, g_idle), (9, g_look), (17, g_look), (24, g_raise), (29, g_raise), (38, g_idle)], 38)
# stumble (0.5 s): a failed dash, the push-off fizzles, the hero lurches forward onto the left foot, arms out, and catches
s_push = pose(hip=0.05, spine=12, thigh=(30, 20), calf=(45, 35), foot=(10, 10), arm_fwd=(-10, 15), arm_out=(-4, -5), fore=(35, 50), head=-4)
s_lurch = pose(hip=0.08, spine=30, thigh=(50, -15), calf=(55, 20), foot=(20, -10), arm_fwd=(45, 40), arm_out=(-6, 20), fore=(20, 30), clav=(6, 6), head=-12)
s_catch = pose(hip=0.06, spine=18, thigh=(35, 5), calf=(50, 25), foot=(15, 5), arm_fwd=(25, 25), arm_out=(-5, 10), fore=(30, 45), head=-6)
clips["stumble"] = keys([(0, g_idle), (2, s_push), (5, s_lurch), (8, s_catch), (12, g_idle)], 12)

# ---------- variants (player.js): the engine groups clips by the name before the dot; each one is meant to read from the play camera ----------
# strike combo (0.92 s each, contact at HIT): 1 slash = forehand sweep right -> left, 2 slash.b = backhand left -> right,
# 3 slash.c = two-handed overhead slam off a small hop. The torso turns 40+ deg each way, the staff (rigid in the fist) sweeps flat.
# U13: the arms pass over / out round the belt pouch: bump() adds a sine-weighted lift between two keys (0 at both ends, so the keyed
# poses, the timing and the hit frame stay as they were)
def bump(frames, k0, k1, **kw):
    for k in range(k0 + 1, k1):
        s = math.sin(math.pi * (k - k0) / (k1 - k0))
        apply(frames[k]); frames[k] = add(**{a: tuple(s * x for x in v) if isinstance(v, tuple) else s * v for a, v in kw.items()})
    return frames


s1_wind = pose(twist=-45, turn=30, spine=-4, side=-4, thigh=(12, -6), calf=(18, 12), leg_out=(6, 6), arm_fwd=(55, 25), arm_out=(-5, 70), fore=(85, 45), wrist=(0, -10), arm_yaw=(0, -25))
s1_hit = pose(twist=45, turn=-35, spine=12, side=4, hip=0.05, thigh=(-12, 32), calf=(12, 25), foot=(0, 8), leg_out=(6, 6), arm_fwd=(-25, 85), arm_out=(-5, 15), fore=(30, 5), wrist=(0, 45), arm_yaw=(0, 60))
s1_over = pose(twist=55, turn=-40, spine=14, side=5, hip=0.06, thigh=(-12, 32), calf=(12, 25), foot=(0, 8), leg_out=(6, 6), arm_fwd=(-25, 75), arm_out=(-5, 10), fore=(30, 10), wrist=(0, 45), arm_yaw=(0, 85))
clips["slash"] = bump(bump(keys([(0, g_idle), (5, s1_wind), (HIT, s1_hit), (13, s1_over), (22, g_idle)], 22), 13, 22, arm_fwd=(0, 40), fore=(0, 15)),
                      2, HIT, arm_out=(15, 0), arm_fwd=(15, 0))  # staff hand back to the cane over the pouch; left hand out round it
s2_wind = pose(twist=45, turn=-35, spine=8, thigh=(15, -5), calf=(20, 10), leg_out=(4, 6), arm_fwd=(25, 75), arm_out=(-5, 10), fore=(45, 25), wrist=(0, 40), arm_yaw=(0, 85))
# the backhand stays in front of the chest: staff from across the left side out to forward-right, never round behind the back or the pack
s2_hit = pose(twist=-45, turn=35, spine=8, side=-6, hip=0.06, thigh=(20, -10), calf=(25, 15), leg_out=(4, 16), arm_fwd=(-20, 75), arm_out=(-5, 40), fore=(30, 5), wrist=(0, 45), arm_yaw=(0, -15))
s2_over = pose(twist=-55, turn=40, spine=8, side=-7, hip=0.06, thigh=(20, -10), calf=(25, 15), leg_out=(4, 16), arm_fwd=(-20, 65), arm_out=(-5, 50), fore=(30, 8), wrist=(0, 45), arm_yaw=(0, -35))
clips["slash.b"] = bump(keys([(0, g_idle), (5, s2_wind), (HIT, s2_hit), (13, s2_over), (22, g_idle)], 22), 0, 5, arm_fwd=(0, 45), fore=(0, 20))  # staff hand up before it crosses
s3_up = pose(hip=-0.16, spine=-16, head=-12, thigh=(40, 40), calf=(70, 70), foot=(-15, -15), arm_fwd=(165, 165), arm_out=(-8, 5), fore=(20, 20), wrist=(-30, -60), clav=(10, 10), arm_yaw=(-10, 10))
s3_hit = pose(hip=0.2, spine=40, head=12, thigh=(60, -20), calf=(80, 40), foot=(25, -10), arm_fwd=(85, 90), arm_out=(-10, 0), fore=(10, 5), wrist=(25, 55), arm_yaw=(-25, 20))  # U13: +15 fwd / -15 wrist: hands off the pouch, same staff line
clips["slash.c"] = bump(keys([(0, g_idle), (4, s3_up), (6, s3_up), (HIT, s3_hit), (14, s3_hit), (22, g_idle)], 22), 14, 22, arm_fwd=(30, 30))
# jump.b (0.58 s): a tucked front flip, the whole body turned once about the hip between frames 2 and 11
jb_tuck = dict(spine=30, thigh=(95, 90), calf=(120, 115), foot=(20, 20), arm_fwd=(60, 40), arm_out=(-5, 10), fore=(80, 60), head=10)
clips["jump.b"] = [pose(body=360 * smooth(2, 11, k), **{key: (tuple(v * smooth(0, 3, k) * (1 - 0.6 * smooth(10, 14, k)) for v in val) if isinstance(val, tuple)
                   else val * smooth(0, 3, k) * (1 - 0.6 * smooth(10, 14, k))) for key, val in jb_tuck.items()}) for k in range(15)]
# air.updraft (1.5 s loop): arms and staff spread wide, chest open, legs dangling; a slow float of the arms
clips["air.updraft"] = [pose(spine=-10, head=-12, thigh=(12, 8), calf=(25, 20), foot=(25, 25), leg_out=(10, 10),
                             arm_out=(75 + 8 * math.sin(2 * math.pi * k / 36), 75 + 8 * math.sin(2 * math.pi * k / 36)), arm_fwd=(10, 10), fore=(10, 10), wrist=(0, -20),
                             clav=(6 + 4 * math.sin(2 * math.pi * k / 36), 6 + 4 * math.sin(2 * math.pi * k / 36))) for k in range(37)]
# fall.long (0.8 s loop): flailing, big out-of-phase arm circles, legs bicycling, head down at the drop
clips["fall.long"] = [pose(spine=4, head=12, hip=-0.03, leg_out=(10, 10), thigh=(30 + 35 * math.sin(2 * math.pi * k / 20), 30 - 35 * math.sin(2 * math.pi * k / 20)),
                           calf=(50 + 30 * math.sin(2 * math.pi * k / 20 + 1), 50 - 30 * math.sin(2 * math.pi * k / 20 + 1)),
                           arm_out=(55 + 30 * math.sin(2 * math.pi * k / 10), 55 + 30 * math.sin(2 * math.pi * k / 10 + math.pi)),
                           arm_fwd=(60 * math.cos(2 * math.pi * k / 10), 60 * math.cos(2 * math.pi * k / 10 + math.pi)), fore=(30, 30), clav=(8, 8)) for k in range(21)]
# land.roll (0.62 s, full body, not additive): touch down low, one forward roll about the hip, come up running
lr_tuck = dict(spine=55, head=25, thigh=(100, 95), calf=(130, 125), foot=(20, 20), arm_fwd=(50, 40), arm_out=(-5, 5), fore=(90, 70))
lr = []
for k in range(16):
    t = smooth(0, 3, k) * (1 - smooth(11, 15, k))
    lr.append(pose(body=360 * smooth(1, 11, k), hip=0.42 * t, **{key: (tuple(v * t for v in val) if isinstance(val, tuple) else val * t) for key, val in lr_tuck.items()}))
lr[-1] = pose(spine=12, thigh=(20, 0), calf=(30, 20), **CANE)
lr = [pose(spine=12, thigh=(20, 0), calf=(30, 20), **CANE)] + lr  # frame 0 = a running lean, so the fade-in reads as a dive
clips["land.roll"] = lr
# land.crouch (0.75 s, full body): stuck landing on the spot, deep crouch, left palm to the ground, staff planted, rise
lc = pose(hip=0.36, spine=30, head=-8, thigh=(80, 75), calf=(125, 120), foot=(40, 40), arm_fwd=(60, 25), arm_out=(-5, -5), fore=(5, 40))
clips["land.crouch"] = keys([(0, g_idle), (2, lc), (10, lc), (18, g_idle)], 18)
# skid (0.46 s): sharp reversal at speed: lean back, feet braced ahead, left arm out front, staff dug in
sk = pose(body=-18, hip=0.14, spine=-6, head=10, thigh=(55, 25), calf=(45, 70), foot=(-25, 0), leg_out=(8, 8), arm_fwd=(70, 45), arm_out=(-5, 25), fore=(20, 20), wrist=(0, 30))
clips["skid"] = keys([(0, pose(spine=10, thigh=(15, 0), calf=(25, 20), **CANE)), (2, sk), (8, sk), (11, g_idle)], 11)
# idle fidgets (once, any input cancels): look around (head + torso), lean on the staff, stretch, kick a pebble
lookL = pose(twist=30, turn=45, head=-4, spine=-3, **CANE)
lookR = pose(twist=-30, turn=-45, head=2, spine=-2, **CANE)
clips["idle.look"] = keys([(0, g_idle), (14, lookL), (32, lookL), (46, lookR), (62, lookR), (74, g_idle)], 74)
lean = pose(side=-14, spine=12, hip=0.05, head=6, turn=-12, thigh=(4, 0), leg_out=(-6, 8), calf=(8, 4), arm_fwd=(45, 30), arm_out=(-15, 10), fore=(80, 20), wrist=(0, 10))
clips["idle.lean"] = keys([(0, g_idle), (16, lean), (56, lean), (72, g_idle)], 72)
st_up = pose(spine=-14, head=-16, hip=-0.03, foot=(-15, -15), arm_fwd=(170, 15), arm_out=(10, -5), fore=(15, 50), clav=(14, 8))
st_side = pose(side=-18, spine=-4, head=-6, turn=-10, arm_fwd=(165, 15), arm_out=(30, -5), fore=(25, 50), clav=(14, 6), arm_yaw=(-20, 0))
clips["idle.stretch"] = keys([(0, g_idle), (14, st_up), (26, st_up), (40, st_side), (52, st_side), (66, g_idle)], 66)
k_back = pose(head=14, spine=6, thigh=(-30, 6), calf=(55, 10), foot=(10, 0), arm_fwd=(15, 15), arm_out=(-6, -5), fore=(30, 50))
k_kick = pose(head=4, spine=-6, thigh=(55, 6), calf=(5, 10), foot=(-25, 0), arm_fwd=(-30, 15), arm_out=(-6, -5), fore=(20, 50))
k_watch = pose(head=-8, spine=-2, turn=6, arm_fwd=(0, 15), arm_out=(0, -5), fore=(10, 50))
clips["idle.kick"] = keys([(0, g_idle), (8, pose(head=16, spine=6, **CANE)), (14, k_back), (18, k_kick), (22, k_kick), (30, k_watch), (42, k_watch), (50, g_idle)], 50)
# sit (1.5 s, once, the last pose held while seated): kneel, then sit back on the ground, legs out, left palm behind, staff upright
kneel = pose(hip=0.36, spine=18, thigh=(75, 75), calf=(120, 120), foot=(35, 35), arm_fwd=(30, 25), arm_out=(-5, -5), fore=(20, 45))
seat = pose(hip=0.6, spine=-12, head=6, thigh=(80, 70), calf=(25, 40), foot=(-10, -5), leg_out=(6, 6), arm_fwd=(-40, 30), arm_out=(-8, -5), fore=(5, 40))
clips["sit"] = keys([(0, g_idle), (12, kneel), (28, seat), (36, seat)], 36)
# teeter (1.2 s loop): at a drop, balance: arms windmill out of phase, the torso rocks over the edge and back, eyes down
clips["teeter"] = [pose(spine=10 + 12 * math.sin(2 * math.pi * k / 28), head=18, hip=0.03, foot=(-8, -8),
                        arm_out=(60 + 25 * math.sin(4 * math.pi * k / 28), 50 + 25 * math.sin(4 * math.pi * k / 28 + math.pi)),
                        arm_fwd=(35 * math.cos(4 * math.pi * k / 28), 35 * math.cos(4 * math.pi * k / 28 + math.pi)), fore=(25, 25), clav=(8, 8)) for k in range(29)]
# brace (1.6 s loop): crosswind, wide low stance leaning in, left forearm up across the face, staff planted ahead (player.js tilts it into the wind)
clips["brace"] = [pose(spine=24 + 3 * math.sin(2 * math.pi * k / 38), head=-4, hip=0.1, thigh=(30, -12), calf=(40, 20), foot=(5, 0), leg_out=(10, 10),
                       arm_fwd=(75, 40), arm_out=(-10, -5), fore=(115, 30), clav=(6, 4)) for k in range(39)]

# sing (1.4 s, once, the last pose held while the button is held): chin up, chest open, the staff raised high and upright in front,
# left palm open toward the rune; from frame 10 (~0.4 s) the staff head traces one slow circle (the glyph fx.js draws). Nothing like
# the strikes: no torso twist, no step, feet planted, the arm goes up not across.
sg_up = dict(spine=-8, head=-16, hip=-0.02, leg_out=(4, 4), arm_out=(-4, 4), fore=(30, 20), clav=(6, 12), wrist=(0, -25))
clips["sing"] = [lerp_pose(g_idle, pose(arm_fwd=(55, 125), **sg_up), smooth(0, 10, k)) if k <= 10 else
                 pose(arm_fwd=(55, 125 + 12 * math.sin(2 * math.pi * (k - 10) / 24)), arm_yaw=(0, 18 * math.cos(2 * math.pi * (k - 10) / 24) - 18), **sg_up)
                 for k in range(35)]

# ---------- hands: right fist on the staff in every clip, cane arm in idle/walk/run, calmer left arm swing in walk/run ----------
def curl_q(bone, axis_w, deg):
    """local quaternion that turns `bone` by deg about a rest-world axis"""
    m = (MW.to_3x3() @ arm.data.bones[bone].matrix_local.to_3x3()).inverted()
    return Quaternion((m @ axis_w).normalized(), math.radians(deg))


rb = lambda n: MW @ arm.data.bones[n].head_local
rt_ = lambda n: MW @ arm.data.bones[n].tail_local
knuck = (rb("R_Index1") - rb("R_Pinky1")).normalized()
palm = (rb("R_Hand") - rb("R_Mid1")).cross(knuck).normalized()  # palm side of the right hand (toward the thigh at rest)
if palm.x < 0: palm.negate()
FIST = {}
for f, degs in (("Index", (70, 80, 60)), ("Mid", (70, 80, 60)), ("Ring", (70, 80, 60)), ("Pinky", (70, 80, 60)), ("Thumb", (35, 30, 25))):
    for j, deg in enumerate(degs):
        b = f"R_{f}{j + 1}"
        d = (rt_(b) - rb(b)).normalized()
        ax = d.cross(palm).normalized()  # turns the bone's tip toward the palm
        FIST[b] = curl_q(b, ax, deg)
R_ARM = [b for b in BODY if b.startswith(("R_Clavicle", "R_Upperarm", "R_Forearm", "R_Elbow", "R_Hand"))]
L_ARM = [b for b in BODY if b.startswith(("L_Upperarm", "L_Forearm"))]
apply(BASE)
for b in R_ARM: arm.pose.bones[b].location = (0, 0, 0); arm.pose.bones[b].rotation_quaternion = (1, 0, 0, 0)  # from the A-pose: the Tripo idle folds this arm across the belly
cane = add(arm_fwd=(0, 15), arm_out=(0, 5), fore=(0, 50))  # elbow by the body, right hand at hip height out to the side, a little forward: holding a walking stick


def mean_q(qs):
    acc = Quaternion((0, 0, 0, 0))
    for q in qs: acc = acc + (q if q.dot(qs[0]) >= 0 else -q)
    return acc.normalized()


for nm in ("idle", "walk", "run", "jump", "fall", "dash", "idle.look", "idle.kick", "jump.b"):  # air too: the left arm stays close in, the right hand keeps the staff
    fr = clips[nm]
    if nm in ("walk", "run"):  # left arm swing x0.6 around its mean, so it pushes the cloak instead of cutting through it
        mq = {b: mean_q([f[b][1] for f in fr]) for b in L_ARM}
        for f in fr:
            for b in L_ARM: f[b] = (f[b][0], mq[b].slerp(f[b][1], 0.6))
    lt = strikes(foot_track(fr), 0)[0] if nm in ("walk", "run") else 0
    out = []
    for k, f in enumerate(fr):  # cane arm + small swing, right hand forward as the left foot strikes (2 gait cycles per clip)
        f = dict(f)
        for b in R_ARM: f[b] = cane[b]
        if nm in ("walk", "run"):
            apply(f)
            rot("R_Upperarm", X, -10 * math.cos(2 * math.pi * 2 * (k / (len(fr) - 1) - lt)))
            f = grab()
        out.append(f)
    clips[nm] = out
# locomotion variants: the base cycle (same frames, same phase, cane arm) with a body attitude on top; player.js blends them by state
clips["run.sprint"] = mod(clips["run"], spine=24, head=-18, hip=0.02, arm_fwd=(0, -60), fore=(0, -30))  # deep lean, staff hand trailing back
clips["run.tired"] = mod(clips["run"], spine=36, head=40, hip=0.07, calf=(20, 20), clav=(-14, -14), arm_fwd=(-25, 0), fore=(-30, 0))  # slumped, head down, heavy
clips["walk.careful"] = mod(clips["walk"], hip=0.05, spine=16, head=20, thigh=(12, 12), calf=(22, 22), arm_out=(30, 0), arm_fwd=(25, 0), fore=(20, 0))  # crouched, eyes on the feet, left arm out


# ---------- IK-authored clips (land.crumple, slash.air, strike.down, glide.fall): feet / knee / palm / fist placed at world targets ----------
def hd(b):
    bpy.context.view_layer.update()
    return (MW @ arm.pose.bones[b].matrix).translation.copy()


def aim3(b, child, target):  # smallest world turn of b about its head that puts child's head on the line to target
    pb = arm.pose.bones[b]
    bpy.context.view_layer.update(); m = MW @ pb.matrix
    h = m.translation.copy()
    q = (hd(child) - h).rotation_difference(target - h)
    pb.matrix = MW.inverted() @ (Matrix.Translation(h) @ q.to_matrix().to_4x4() @ Matrix.Translation(-h) @ m)
    pb.scale = (1, 1, 1)


def ik2(a, b, c, target, pole):  # two-bone IK: a's head fixed, the joint b bends toward pole, c's head on target (clamped to reach)
    H = hd(a); L1 = (hd(b) - H).length; L2 = (hd(c) - hd(b)).length
    d = target - H; dist = max(abs(L1 - L2) + 1e-3, min(d.length, (L1 + L2) * 0.999)); dn = d.normalized()
    ang = math.acos(max(-1.0, min(1.0, (L1 * L1 + dist * dist - L2 * L2) / (2 * L1 * dist))))
    p = (pole - dn * pole.dot(dn)).normalized()
    aim3(a, b, H + dn * L1 * math.cos(ang) + p * L1 * math.sin(ang)); aim3(b, c, H + dn * dist)


apply(clips["idle"][0])  # cane idle: the staff stands on the floor below the fist
FLOOR = min(v.z for v in (lambda e: [e.matrix_world @ v.co for v in e.to_mesh().vertices])(mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())))
mesh.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh_clear()
FL0, FR0, LH0, RH0, HIP0 = (hd(b) for b in ("L_Foot", "R_Foot", "L_Hand", "R_Hand", "Hip"))
TOE = {s: hd(f"{s}_ToeBase") - hd(f"{s}_Foot") for s in "LR"}
LFING = hd("L_Mid1") - LH0
HC = (MW @ arm.pose.bones["R_Hand"].matrix).to_3x3()
FIST0 = sum((hd(f"R_{f}1") for f in ("Index", "Mid", "Ring", "Pinky")), Vector()) / 4
OFFF = HC.inverted() @ (FIST0 - RH0)  # fist centre in hand space
GRIPH = FIST0.z - FLOOR  # fist height that stands the staff foot on the floor
SH = hd("R_Upperarm"); ARML = (hd("R_Forearm") - SH).length + (RH0 - hd("R_Forearm")).length + (HC @ OFFF).length
reach = lambda d, k=0.9, o=Vector(): SH + o + d.normalized() * ARML * k  # fist target on a sphere about the idle shoulder
SDIR = Vector((0, 0, -1))  # idle staff: straight down from the fist (4 deg tilt ignored)
CLAMPG = {i for i, g in enumerate(mesh.vertex_groups) if g.name.startswith(("L_Hand", "L_Thumb", "L_Index", "L_Mid", "L_Ring", "L_Pinky", "L_Foot", "L_Toe", "R_Foot", "R_Toe"))}
CLAMPV = [v.index for v in mesh.data.vertices if sum(g.weight for g in v.groups if g.group in CLAMPG) < 0.5]  # IK'd ends excluded


def hold_staff(P_, d):  # right fist at P_, staff foot pointing along d
    M = SDIR.rotation_difference(d.normalized()).to_matrix() @ HC
    ik2("R_Upperarm", "R_Forearm", "R_Hand", P_ - M @ OFFF, Vector((-0.5, 0.6, -0.3)))
    pb = arm.pose.bones["R_Hand"]; h = hd("R_Hand")
    pb.matrix = MW.inverted() @ (Matrix.Translation(h) @ M.to_4x4()); pb.scale = (1, 1, 1)


def low():  # lowest body skin (IK'd hands / feet excluded) in the current pose
    e = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get()); me = e.to_mesh()
    z = min((e.matrix_world @ me.vertices[i].co).z for i in CLAMPV); e.to_mesh_clear(); return z


def lerpv(a, b, t):
    if isinstance(a, tuple): return tuple(x + (y - x) * t for x, y in zip(a, b))
    return a.lerp(b, t) if isinstance(a, Vector) else a + (b - a) * t


def track(spec, n):  # [(frame, {param: value})] -> n+1 param dicts, smoothstep between keys (later keys may set only what changes)
    full = []
    for f, d in spec: full.append((f, {**(full[-1][1] if full else {}), **d}))
    out = []
    for k in range(n + 1):
        for (f0, p0), (f1, p1) in zip(full, full[1:]):
            if f0 <= k <= f1:
                t = smooth(0, 1, (k - f0) / max(1, f1 - f0)); out.append({key: lerpv(p0[key], p1[key], t) for key in p0}); break
        else: out.append(full[-1][1])
    return out


POSEK = ("hip", "spine", "head", "side", "twist", "thigh", "calf", "foot", "leg_out", "arm_fwd", "arm_out", "fore", "clav")


def build(p):
    pose(**{k: p[k] for k in POSEK if k in p})
    if "lf" in p:
        for s, sg in (("L", 1), ("R", -1)):
            ik2(f"{s}_Thigh", f"{s}_Calf", f"{s}_Foot", p[s.lower() + "f"], Vector((0.15 * sg, -1, 0)))
            aim3(f"{s}_Foot", f"{s}_ToeBase", hd(f"{s}_Foot") + p[s.lower() + "toe"])
    if "lh" in p:
        ik2("L_Upperarm", "L_Forearm", "L_Hand", p["lh"], Vector((0.5, 0.6, -0.3)))
        aim3("L_Hand", "L_Mid1", hd("L_Hand") + p["lfing"])
    fist, sd = p["fist"], p["sd"]
    if p.get("pw"):  # planted staff: upright, foot just on the floor, the fist at grip height out along `plant` from the shoulder
        sh = hd("R_Upperarm"); dz = FLOOR + GRIPH + 0.01 - sh.z; o = p["plant"]
        h = min(o.length, math.sqrt(max(0.0, (ARML * 0.93) ** 2 - dz * dz)))
        fist, sd = fist.lerp(sh + o.normalized() * h + Vector((0, 0, dz)), p["pw"]), sd.lerp(SDIR, p["pw"])
    hold_staff(fist, sd); p["_fist"] = fist
    e = REACH.setdefault(CLIP[0], [0, 0, 0])  # IK miss (m): fist, left palm, feet
    e[0] = max(e[0], (hd("R_Hand") + (MW @ arm.pose.bones["R_Hand"].matrix).to_3x3() @ OFFF - p["_fist"]).length)
    if "lh" in p: e[1] = max(e[1], (hd("L_Hand") - p["lh"]).length)
    if "lf" in p: e[2] = max(e[2], (hd("L_Foot") - p["lf"]).length, (hd("R_Foot") - p["rf"]).length)
    if "spin" in p: rot("Hip", Z, p["spin"])
    if "roll" in p: rot("Hip", X, p["roll"])
    return grab()


REACH, CLIP = {}, [""]


def planted(p):  # build, then lift the hip until no non-IK skin is under the floor (feet / palm stay on their targets)
    p = dict(p)
    for _ in range(8):
        fr = build(p); dz = FLOOR - low()
        if dz < 0.002: break
        p["hip"] -= dz + 0.002
    return fr


# land.crumple (1.58 s, full body): touch down hard, stagger a step into one knee (right knee + toes down, left foot ahead), left palm on
# the ground, staff planted upright at the right side; 0.9 s of breathing in the stagger, then push off the left knee and stand
fx, fy = FIST0.x, FIST0.y
fwd = lambda v, y, z=0: Vector((v.x, v.y - y, v.z + z))
kneel = dict(hip=0.42, spine=34, head=14, side=4, lf=fwd(FL0, 0.24), rf=Vector((FR0.x, FR0.y + 0.44, FLOOR + 0.10)), rtoe=Vector((0, 0.06, -0.07)),
             lh=Vector((FL0.x + 0.16, FL0.y - 0.16, FLOOR + 0.06)), lfing=Vector((0.01, -0.06, -0.01)), pw=1.0, plant=Vector((-0.28, -0.22, 0)))
cr = track([
    (0, dict(hip=0.06, spine=8, head=-4, side=0, twist=0, lf=FL0.copy(), ltoe=TOE["L"].copy(), rf=FR0.copy(), rtoe=TOE["R"].copy(),
             lh=Vector((LH0.x + 0.22, LH0.y - 0.05, LH0.z + 0.30)), lfing=LFING.copy(), fist=Vector((fx - 0.12, fy, FIST0.z + 0.18)), sd=Vector((-0.35, 0, -1)), pw=0.0, plant=Vector((-0.28, -0.22, 0)))),
    (3, dict(hip=0.30, spine=40, head=6, lf=fwd(FL0, 0.10, 0.06), rf=Vector((FR0.x, FR0.y + 0.12, FR0.z + 0.05)), lh=Vector((FL0.x + 0.20, FL0.y - 0.18, FLOOR + 0.22)),
             pw=0.8)),
    (7, kneel),
    (12, dict(spine=36, head=18, hip=0.44)),
    (17, dict(spine=32, head=12, hip=0.42)),
    (21, dict(spine=30, head=4, hip=0.42)),  # looks up: the stagger ends
    (27, dict(hip=0.30, spine=26, head=2, lf=fwd(FL0, 0.14), rf=Vector((FR0.x, FR0.y + 0.10, FR0.z + 0.08)), rtoe=TOE["R"].copy(),
              lh=Vector((LH0.x + 0.08, FL0.y - 0.12, FLOOR + 0.48)), plant=Vector((-0.24, -0.16, 0)))),
    (30, dict(pw=1.0, fist=FIST0.copy(), sd=SDIR)),
    (33, dict(hip=0.06, spine=8, head=0, side=0, lf=FL0.copy(), rf=FR0.copy(), lh=LH0.copy(), lfing=LFING.copy(), pw=0.0)),
    (38, dict(hip=0.0, spine=0, head=0)),
], 38)
CLIP[0] = "land.crumple"; cr = [planted(p) for p in cr]
for k in range(33, 39): cr[k] = lerp_pose(cr[k], clips["idle"][0], smooth(33, 38, k))  # ends exactly on cane idle
clips["land.crumple"] = cr

# slash.air (0.46 s, airborne): legs tucked, one full turn to the left about the hip with the staff held flat out at the right side,
# so it sweeps a horizontal circle; contact as the staff crosses the front (spin 45 deg)
SA_N = 11
sa_spin = lambda k: -60 + 420 * smooth(1, 8, k)
sa = track([
    (0, dict(spine=8, head=-2, thigh=(40, 35), calf=(70, 65), foot=(10, 10), arm_fwd=(20, 0), arm_out=(-4, 0), fore=(60, 0),
             fist=reach(Vector((-1, 0.1, 0.35))), sd=Vector((-0.45, -1, -0.05)))),
    (2, dict(spine=14, thigh=(75, 70), calf=(115, 110), foot=(20, 20), arm_fwd=(30, 0), fore=(85, 0),
             fist=reach(Vector((-1, -0.35, 0.1)), 0.95), sd=Vector((-0.45, -1, -0.05)))),
    (8, dict()),
    (11, dict(spine=6, thigh=(35, 30), calf=(60, 55), foot=(10, 10), arm_fwd=(20, 0), fore=(50, 0), fist=Vector((fx - 0.08, fy, FIST0.z + 0.15)), sd=Vector((-0.2, 0.1, -1)))),
], SA_N)
for k, p in enumerate(sa): p["spin"] = sa_spin(k)
CLIP[0] = "slash.air"; clips["slash.air"] = [build(p) for p in sa]
SA_HIT = next(k - 1 + (45 - sa_spin(k - 1)) / (sa_spin(k) - sa_spin(k - 1)) for k in range(1, SA_N + 1) if sa_spin(k) >= 45)

# strike.down (0.33 s, airborne pogo): knees pulled up, the staff driven straight down past the feet at the right side, a small recoil
SD_N, SD_HIT = 8, 3
sd = track([
    (0, dict(spine=4, head=2, thigh=(45, 45), calf=(70, 70), foot=(10, 10), leg_out=(6, 6), arm_fwd=(25, 0), arm_out=(-4, 0), fore=(45, 0),
             fist=reach(Vector((-0.5, -0.4, 0.6))), sd=Vector((-0.1, -0.35, -1)))),
    (SD_HIT, dict(spine=24, head=20, thigh=(100, 95), calf=(125, 120), foot=(15, 15), leg_out=(10, 10), arm_fwd=(40, 0), fore=(70, 0),
                  fist=reach(Vector((-0.8, -0.35, -0.6)), 0.95, Vector((0, -0.04, -0.10))), sd=Vector((-0.12, 0.04, -1)))),
    (5, dict()),
    (8, dict(spine=18, head=14, thigh=(85, 80), calf=(110, 105), fist=Vector((fx - 0.10, fy - 0.10, FIST0.z + 0.08)))),
], SD_N)
CLIP[0] = "strike.down"; clips["strike.down"] = [build(p) for p in sd]

# glide.fall (1.5 s loop, cutscenes): a calm drop, arms a little out, legs loose together, staff hanging out at the side; slow sway
GN = 36
CLIP[0] = "glide.fall"
clips["glide.fall"] = [build(dict(spine=-2 + 2 * math.sin(2 * math.pi * k / GN), head=-6 + 3 * math.sin(2 * math.pi * k / GN + 0.6),
                                  thigh=(16 + 4 * math.sin(2 * math.pi * k / GN), 10 - 4 * math.sin(2 * math.pi * k / GN)), calf=(28, 22), foot=(22, 22), leg_out=(4, 4),
                                  arm_out=(22 + 4 * math.sin(2 * math.pi * k / GN + 1), 0), arm_fwd=(8, 0), fore=(18, 0),
                                  fist=Vector((fx + 0.04 - 0.02 * math.sin(2 * math.pi * k / GN + 1), fy + 0.02, FIST0.z + 0.04)), sd=Vector((-0.25, 0.05, -1))))
                       for k in range(GN + 1)]
# glide (1.5 s loop, the wind road): the whole body tipped forward on the wind, arms and staff spread wide as the cloak's spars, legs
# trailing together, head up at the way ahead; a slow float of the arms and a small scissor of the legs
CLIP[0] = "glide"
clips["glide"] = [pose(body=58, spine=-12, head=-34, thigh=(5 + 3 * math.sin(2 * math.pi * k / GN), 1 - 3 * math.sin(2 * math.pi * k / GN)), calf=(10, 14), foot=(40, 40), leg_out=(3, 3),
                       arm_out=(80 + 5 * math.sin(2 * math.pi * k / GN), 80 + 5 * math.sin(2 * math.pi * k / GN)), arm_fwd=(-8, -8), fore=(6, 6), wrist=(0, -20),
                       clav=(8 + 3 * math.sin(2 * math.pi * k / GN), 8 + 3 * math.sin(2 * math.pi * k / GN))) for k in range(GN + 1)]
# land.roll, rebuilt (same 17 frames): the old roll turned about a fixed hip and sank 0.46 m into the floor with the staff swinging
# free. Now the staff is tucked across the chest along the roll axis (it never sweeps the ground) and every frame is lifted so the
# rolling ball just touches the floor
def lowall():
    e = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get()); me = e.to_mesh()
    z = min((e.matrix_world @ v.co).z for v in me.vertices); e.to_mesh_clear(); return z


CLIP[0] = "land.roll"; lr = [clips["land.roll"][0]]
for k in range(16):
    t = smooth(0, 3, k) * (1 - smooth(11, 15, k))
    p = {key: (tuple(v * t for v in val) if isinstance(val, tuple) else val * t) for key, val in lr_tuck.items()}
    p.update(hip=0.42 * t, fist=FIST0, sd=SDIR)
    for _ in range(4):  # the staff is placed against the shins unrolled, then carried round with the hip by the roll
        build(dict(p, roll=0)); kn = hd("R_Calf"); M0 = MW @ arm.pose.bones["Hip"].matrix
        build(dict(p, roll=360 * smooth(1, 11, k))); R = MW @ arm.pose.bones["Hip"].matrix @ M0.inverted()
        fr = build(dict(p, roll=360 * smooth(1, 11, k), fist=R @ FIST0.lerp(kn + Vector((-0.16, -0.14, -0.04)), t),
                        sd=R.to_3x3() @ SDIR.lerp(Vector((1, 0, -0.04)), t))); dz = FLOOR - lowall()
        if dz < 0.002: break
        p["hip"] -= dz + 0.002
    lr.append(fr)
lr[-1] = clips["land.roll"][-1]
clips["land.roll"] = lr
# sleep (2 s loop) / wake (3 s, once): the l1 intro (U17a). Curled on his left side in the hollow stone, knees up, the staff hugged along
# the body, slow breathing; wake: he stirs, props up on the left arm, rolls onto his knees, crouches and stands, ending on idle frame 0.
# FK poses turned about the hip's forward axis (lie = 90 deg: his left side down), every frame set down so its lowest point is on the floor.
def on_floor(kw, lie):
    pose(**kw)
    if lie: rot("Hip", Y, lie)
    move("Hip", Vector((0, 0, FLOOR - lowall())))
    return grab()


curl = dict(hip=0.3, spine=50, head=26, thigh=(105, 95), calf=(130, 135), foot=(30, 30), leg_out=(4, 0), arm_fwd=(55, 65), arm_out=(-5, 10), fore=(115, 95), clav=(4, 4))
clips["sleep"] = [on_floor(dict(curl, spine=curl["spine"] + 3 * math.sin(2 * math.pi * k / 48), head=curl["head"] + 2 * math.sin(2 * math.pi * k / 48 - 0.6)), 88) for k in range(49)]
stir = dict(curl, spine=40, head=6, thigh=(95, 90), calf=(125, 130))
prop = dict(hip=0.3, spine=34, head=-4, side=-10, thigh=(95, 80), calf=(130, 125), foot=(30, 30), arm_fwd=(60, 45), arm_out=(-10, 10), fore=(60, 90), clav=(10, 4))
knees = dict(hip=0.42, spine=28, head=-6, thigh=(80, 80), calf=(125, 125), foot=(35, 35), arm_fwd=(45, 30), arm_out=(-5, -5), fore=(20, 50))
crouch = dict(hip=0.3, spine=24, head=-10, thigh=(80, 70), calf=(115, 110), foot=(35, 35), arm_fwd=(30, 15), arm_out=(-5, -5), fore=(10, 50))
nil = lambda v: tuple(0 for _ in v) if isinstance(v, tuple) else 0  # a param a key leaves out is at rest
WK = [(0, curl, 88), (12, stir, 86), (30, prop, 50), (44, knees, 0), (54, crouch, 0)]
wk = []
for k in range(55):
    for (f0, p0, l0), (f1, p1, l1) in zip(WK, WK[1:]):
        if f0 <= k <= f1:
            t = smooth(0, 1, (k - f0) / (f1 - f0)); wk.append(on_floor({key: lerpv(*(q.get(key, nil(p0.get(key, p1.get(key)))) for q in (p0, p1)), t) for key in set(p0) | set(p1)}, lerpv(l0, l1, t))); break
for k in range(55, 73): wk.append(lerp_pose(wk[54], clips["idle"][0], smooth(54, 72, k)))  # stands: ends exactly on idle frame 0
clips["wake"] = wk
NEWC = ("land.crumple", "slash.air", "strike.down", "glide.fall", "land.roll")
FLOORC = {"land.crumple", "land.roll", "sleep", "wake"}  # the staff solver also keeps the shaft above the floor in these
for nm, fr in clips.items():
    for f in fr:
        for b, q in FIST.items(): f[b] = (f[b][0], f[b][1] @ q)
BASE = clips["idle"][0]

# ---------- 4. staff: posed in the idle fist, moved back to bind space through the hand, 100 % on R_Prop ----------
STAFF_TILT = math.radians(float(os.environ.get("STAFF_TILT", 4)))  # foot leans out
ad.action = None; apply(BASE); bpy.context.view_layer.update()
pbh = arm.pose.bones["R_Hand"]
fist = sum((MW @ arm.pose.bones[f"R_{f}1"].head + MW @ arm.pose.bones[f"R_{f}1"].tail for f in ("Index", "Mid", "Ring", "Pinky")), Vector()) / 8
sco = wco(staff_o)
z0 = min(c.z for c in sco)
STAFF_GRIP = fist.z - 0.01  # gripped so the foot just touches the ground in idle
band = [c for c in sco if abs(c.z - z0 - STAFF_GRIP) < 0.03]
g0 = sum(band, Vector()) / len(band)  # shaft centre at the grip
tilt = Matrix.Rotation(-STAFF_TILT, 4, "Y")  # foot toward the hero's right (-X), head toward the body
to_rest = MW @ arm.data.bones["R_Hand"].matrix_local @ pbh.matrix.inverted() @ MW.inverted()
me_s = staff_o.data
inv_o = staff_o.matrix_world.inverted()
for v, c in zip(me_s.vertices, sco): v.co = inv_o @ (to_rest @ (fist + (tilt @ (c - g0).to_4d()).to_3d()))
put(staff_o, [{"R_Prop": 1.0}] * len(me_s.vertices))
staff_o.data.materials.clear(); staff_o.data.materials.append(mesh.data.materials[0])
with bpy.context.temp_override(active_object=mesh, selected_editable_objects=[mesh, staff_o]): bpy.ops.object.join()
rep["staff"] = {"fist": [round(x, 3) for x in fist], "foot_z": round((fist + (tilt @ Vector((0, 0, z0 - g0.z, 0))).to_3d()).z, 3)}

# staff clearance, baked: per frame, turn the wrist (world X/Y about the wrist) by the smallest angle that keeps the staff out of
# the body, gear and cloak (spring chains at bind); greedy in time, so the turn changes smoothly. Replaces the runtime staff IK.
SHAFT = []  # (bind-space point on the shaft axis, radius)
for k in range(61):
    zk = z0 + 0.01 + k / 60 * (max(c.z for c in sco) - z0 - 0.02)
    sl, wd = [], 0.035
    while not sl: sl = [c for c in sco if abs(c.z - zk) < wd]; wd += 0.02  # the plain shaft has long gaps between vertex rings
    ctr = sum(sl, Vector()) / len(sl)
    SHAFT.append((to_rest @ (fist + (tilt @ (ctr - g0).to_4d()).to_3d()), max(max((Vector((c.x - ctr.x, c.y - ctr.y, 0))).length for c in sl), 0.015)))
SG = mesh.vertex_groups
FISTG = {SG[n].index for n in SG.keys() if n.startswith(("R_Hand", "R_Thumb", "R_Index", "R_Mid", "R_Ring", "R_Pinky", "R_Prop"))}
FREE = [p_.index for p_ in mesh.data.polygons if all(sum(g.weight for g in mesh.data.vertices[v].groups if g.group in FISTG) < 0.3 for v in p_.vertices)]
FOREG = {SG[n].index for n in SG.keys() if n.startswith("R_Forearm")} | FISTG  # incl. the Tripo twist bones (wrist skin)
NEAR = [i for i in FREE if all(sum(g.weight for g in mesh.data.vertices[v].groups if g.group in FOREG) < 0.3 for v in mesh.data.polygons[i].vertices)]
GRIPD = [(p_ - to_rest @ fist).length for p_, _ in SHAFT]  # near the grip the staff is only checked against skin that is not the wrist
CANDS = sorted([(ax, ay) for ax in range(-90, 91, 15) for ay in range(-90, 91, 15)], key=lambda a: abs(a[0]) + abs(a[1]))


def posed(o):
    dg = bpy.context.evaluated_depsgraph_get(); ev = o.evaluated_get(dg); me = ev.to_mesh()
    r = [ev.matrix_world @ v.co for v in me.vertices], [list(p_.vertices) for p_ in me.polygons]
    ev.to_mesh_clear(); return r


def staff_hits(fr, cand_list, prev, ab=(0, 0)):
    apply(fr)
    if ab[0]: rot("R_Upperarm", Y, ab[0])  # swing the arm out to the side (about the forward axis)
    if ab[1]: rot("R_Upperarm", X, ab[1])  # ... and forward/back
    bv, bp = posed(mesh); cv, cpo = posed(cloak)
    tb = BVHTree.FromPolygons(bv, [bp[i] for i in FREE]); tn = BVHTree.FromPolygons(bv, [bp[i] for i in NEAR]); tc = BVHTree.FromPolygons(cv, cpo)
    hm = MW @ pbh.matrix; h = hm.translation.copy()
    D = hm @ arm.data.bones["R_Hand"].matrix_local.inverted() @ MW.inverted()
    best = None
    for ax, ay in cand_list:
        R = Matrix.Translation(h) @ Matrix.Rotation(math.radians(ay), 4, "Y") @ Matrix.Rotation(math.radians(ax), 4, "X") @ Matrix.Translation(-h) @ D  # = rot X, then rot Y
        hit = 0
        for (p_, r), gd in zip(SHAFT, GRIPD):  # the fist's own faces are not in FREE, so the grip never counts
            q = R @ p_
            n_ = (tn if gd < 0.15 else tb).find_nearest(q)
            if n_[0] is not None and (n_[3] < r + 0.01 or (q - n_[0]).dot(n_[1]) < 0 and n_[3] < 0.12): hit += 1
            n_ = tc.find_nearest(q)
            if n_[0] is not None and n_[3] < r + 0.01: hit += 1
            if FLOORS[0] and q.z < FLOOR - 0.01: hit += 1  # shaft under the floor (FLOORC clips)
        cost = hit * 1000 + abs(ax - prev[0]) + abs(ay - prev[1]) + abs(ab[0] - prev[2][0]) + abs(ab[1] - prev[2][1]) + 0.3 * (abs(ax) + abs(ay)) + 2 * (abs(ab[0]) + abs(ab[1]))
        if best is None or cost < best[0]: best = (cost, hit, (ax, ay, ab))
    return best


rep["staff_turn"] = {}
RAMP = 4
LOOPS = {"sleep", "idle", "walk", "run", "fall", "air.updraft", "fall.long", "run.sprint", "run.tired", "walk.careful", "teeter", "brace", "glide.fall", "glide"}  # the rest play once (merge_anims --once)
FLOORS = [False]
for nm, fr in clips.items():
    FLOORS[0] = nm in FLOORC
    prev, out, worst, turn, sol = (0, 0, (0, 0)), [], 0, [0, 0], []
    SW = [(y, x) for y in (0, -15, 15, -30, 30, -45, 45) for x in (0, -15, 15, -30, 30, -45, 45)]
    for k, f in enumerate(fr):
        c0 = min(staff_hits(f, [(0, 0), prev[:2]], prev, ab) for ab in {(0, 0), prev[2]})
        if c0[1]:  # blocked: wider wrist turns first, then the arm swung as well (smallest swing that clears)
            for ab in sorted(set(SW) | {prev[2]}, key=lambda a: abs(a[0]) + abs(a[1])):
                c0 = min(c0, staff_hits(f, CANDS, prev, ab))
                if not c0[1]: break
        prev = c0[2]; worst = max(worst, c0[1]); sol.append((prev[0], prev[1], prev[2][0], prev[2][1]))
    # ease in/out: every turn ramps over RAMP frames on each side, so the wrist never snaps (a blocked frame keeps its own turn)
    for k in range(len(fr)):
        js = [(j % (len(fr) - 1), abs(k - j)) for j in range(k - RAMP + 1, k + RAMP)] if nm in LOOPS else [(j, abs(k - j)) for j in range(max(0, k - RAMP + 1), min(len(fr), k + RAMP))]
        t = [max(((1 - d / RAMP) * sol[j][c] for j, d in js), key=abs) for c in range(4)]
        if t != list(sol[k]) and staff_hits(fr[k], [tuple(t[:2])], (0, 0, (0, 0)), tuple(t[2:]))[1]: t = list(sol[k])  # the eased turn touches: keep the solved one
        turn = [max(turn[0], abs(t[0]) + abs(t[1])), max(turn[1], abs(t[2]) + abs(t[3]))]
        apply(fr[k])
        if t[2]: rot("R_Upperarm", Y, t[2])
        if t[3]: rot("R_Upperarm", X, t[3])
        rot("R_Hand", X, t[0]); rot("R_Hand", Y, t[1]); out.append(grab())
    clips[nm] = out
    rep["staff_turn"][nm] = turn + [worst]  # wrist deg, arm swing deg, staff samples still touching
    print("STAFF", nm, rep["staff_turn"][nm], flush=True)

# measure
dur = lambda fr: (len(fr) - 1) / FPS
wt, rt = foot_track(clips["walk"]), foot_track(clips["run"])
rep["stride"] = {"walk": round(stride(wt, dur(clips["walk"])), 3), "run": round(stride(rt, dur(clips["run"])), 3)}
rep["natural_speed"] = {k: round(v / dur(clips[k]), 3) for k, v in rep["stride"].items()}
ev = {}
for nm, tr in (("walk", wt), ("run", rt)):
    e = {}
    for s, side in ((0, "l"), (1, "r")):
        for i, t in enumerate(strikes(tr, s)): e[f"step_{side}{i + 1}"] = round(t, 3)
    ev[nm] = e
ev["slash"] = ev["slash.b"] = ev["slash.c"] = {"hit": round(HIT / (len(clips["slash"]) - 1), 3)}  # combo strikes: contact on the same frame
ev["land.roll"] = {"land": 0.0}
ev["land.crumple"] = {"land": 0.0, "knee": round(7 / (len(clips["land.crumple"]) - 1), 3), "rise": round(21 / (len(clips["land.crumple"]) - 1), 3)}  # touchdown, knee hits, stagger over
ev["slash.air"] = {"hit": round(SA_HIT / SA_N, 3)}
ev["strike.down"] = {"hit": round(SD_HIT / SD_N, 3)}
rep["events"] = ev
rep["seams_deg"] = {nm: round(max(math.degrees(clips[nm][0][b][1].rotation_difference(clips[nm][-1][b][1]).angle) for b in BODY), 2) for nm in ("idle", "walk", "run", "fall")}
rep["max_frame_jump"] = {nm: [round(max_jump(clips[nm], BODY)[0], 1), max_jump(clips[nm], BODY)[2]] for nm in clips}
rep["durations"] = {nm: round(dur(f), 3) for nm, f in clips.items()}
rep["reach"] = {k: [round(x, 3) for x in v] for k, v in REACH.items()}
rep["floor"] = {}  # grounded full-body clips: lowest body+gear+staff / cloak point vs the idle sole (m, < 0 = under the floor), worst frame
for nm in ("land.crumple", "land.roll", "land.crouch", "sit", "sleep", "wake"):
    w = (9.0, 0, 9.0)
    for k, f in enumerate(clips[nm]):
        apply(f); vb = posed(mesh)[0]; i = min(range(len(vb)), key=lambda j: vb[j].z); zb = vb[i].z - FLOOR; zc = min(v.z for v in posed(cloak)[0]) - FLOOR
        if zb < w[0]: w = (zb, k, w[2], mesh.vertex_groups[max(mesh.data.vertices[i].groups, key=lambda g: g.weight).group].name)
        w = (w[0], w[1], min(w[2], zc)) + tuple(w[3:])
    rep["floor"][nm] = [round(w[0], 3), w[1], round(w[2], 3)] + list(w[3:])

for a in list(bpy.data.actions): bpy.data.actions.remove(a)
for nm, fr in clips.items():
    act = write(nm, fr)
    tr = ad.nla_tracks.new(); tr.name = nm
    st = tr.strips.new(nm, 0, act)
    if hasattr(act, "slots") and len(act.slots): st.action_slot = act.slots[0]
ad.action = None
for t in ad.nla_tracks: t.mute = True  # the exporter evaluates frame 0 with every unmuted track stacked; muted, the nodes keep idle 0
apply(BASE)

bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_extras=True,
                          export_animation_mode="NLA_TRACKS", export_force_sampling=True,
                          export_rest_position_armature=False)  # node TRS = the current pose (idle frame 0): the model loads standing as in idle
json.dump({"stride": rep["stride"], "events": rep["events"]}, open(os.path.splitext(OUT)[0] + ".extras.json", "w"))

# ---------- QA renders ----------
if QA:
    os.makedirs(QA, exist_ok=True)
    for t in ad.nla_tracks: t.mute = True  # else the NLA strips override the posed frames at render time
    # gear distance: every frame of every clip, each gear island's closest vertex to the rest of the body or the cloak (m)
    GA = [0] * len(mesh.data.vertices); mesh.data.attributes["gear"].data.foreach_get("value", GA)
    ISL = {1: "backpack", 2: "pouch"}
    IDX = {gi: [i for i in range(len(GA)) if GA[i] == gi] for gi in ISL}
    REST = [p_.index for p_ in mesh.data.polygons if not any(GA[v] for v in p_.vertices)]
    gd = {nm: (0.0, "", 0) for nm in ISL.values()}
    # U13 arm clearance: every frame of every clip, the closest arm vertex (upper arm .. fingers) to the pouch's surface (-1 = the surfaces cross)
    ARMG = {g.index for g in mesh.vertex_groups if g.name[:2] in ("L_", "R_") and any(k in g.name for k in ("Upperarm", "Forearm", "Elbow", "Hand", "Pinky", "Ring", "Mid", "Index", "Thumb"))}
    ARMV = [v.index for v in mesh.data.vertices if not GA[v.index] and v.groups and max(v.groups, key=lambda g: g.weight).group in ARMG]
    _av = set(ARMV); ARMP = [p_.index for p_ in mesh.data.polygons if all(v in _av for v in p_.vertices)]
    PPOLY = [p_.index for p_ in mesh.data.polygons if all(GA[v] == 2 for v in p_.vertices)]
    pclear = {}
    for cn, fr in clips.items():
        for k, f in enumerate(fr):
            apply(f)
            bv, bpo = posed(mesh); cv, cpo = posed(cloak)
            tb = BVHTree.FromPolygons(bv, [bpo[i] for i in REST]); tc = BVHTree.FromPolygons(cv, cpo)
            for gi, nm in ISL.items():
                d = min(min(tb.find_nearest(bv[i])[3], tc.find_nearest(bv[i])[3]) for i in IDX[gi])
                if d > gd[nm][0]: gd[nm] = (round(d, 4), cn, k)
            tp = BVHTree.FromPolygons(bv, [bpo[i] for i in PPOLY])
            d = -1.0 if tp.overlap(BVHTree.FromPolygons(bv, [bpo[i] for i in ARMP])) else min(tp.find_nearest(bv[i])[3] for i in ARMV)  # surfaces cross: -1
            if cn not in pclear or d < pclear[cn][0]: pclear[cn] = (round(d, 4), k)
    rep["gear_gap_max"] = gd  # worst frame per island: (gap m, clip, frame); limit 0.015
    rep["pouch_arm_clear"] = pclear  # per clip: (closest arm-to-pouch distance m, frame); must stay > 0
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "FLAT"
    sc.display.shading.color_type = "TEXTURE"
    sc.render.resolution_x = sc.render.resolution_y = 320
    sc.render.film_transparent = False
    sc.world = bpy.data.worlds.new("w") if not sc.world else sc.world
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = "ORTHO"; cam.data.ortho_scale = 1.6

    FOCUS = [None, 0.25]  # bone to centre a close-up on, its ortho scale

    def shoot(path, yaw):
        a = math.radians(yaw)
        c = MW @ arm.pose.bones[FOCUS[0]].head if FOCUS[0] else Vector((CX, 0, 0.7))
        cam.data.ortho_scale = FOCUS[1] if FOCUS[0] else 1.6
        cam.location = (c.x + 3 * math.sin(a), c.y - 3 * math.cos(a), c.z)
        cam.rotation_euler = (math.radians(90), 0, a)
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)

    def sheet(name, frames, yaw):
        paths = []
        for j, fr in enumerate(frames):
            apply(fr) if isinstance(fr, dict) else fr()
            p = f"{QA}/_{name}_{j}.png"; shoot(p, yaw); paths.append(p)
        imgs = [bpy.data.images.load(p) for p in paths]
        w, h = imgs[0].size
        out = bpy.data.images.new(name, w * len(imgs), h)
        buf = [0.0] * (w * len(imgs) * h * 4)
        for j, im in enumerate(imgs):
            pxs = list(im.pixels)
            for row in range(h):
                buf[(row * w * len(imgs) + j * w) * 4:(row * w * len(imgs) + (j + 1) * w) * 4] = pxs[row * w * 4:(row + 1) * w * 4]
        out.pixels = buf
        out.filepath_raw = f"{QA}/{name}.png"; out.file_format = "PNG"; out.save()
        for p in paths: os.remove(p)

    pick = lambda fr, k=6: [fr[int(i * (len(fr) - 1) / (k - 1))] for i in range(k)]
    for nm in [n for n in clips if n not in ("idle", "walk", "run")] + ["idle", "walk", "run"]:
        for yaw in (20, 160):
            sheet(f"clip_{nm}_{yaw}", pick(clips[nm], 8 if nm in ("slash",) else 6), yaw)
    def bind():
        for pb in arm.pose.bones: pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.scale = (1, 1, 1)
        bpy.context.view_layer.update()
    FOCUS[:] = ["Pelvis", 0.9]  # U13: the pouch at each clip's closest arm pass (bind pose first), front / 3-4 / side
    close = [bind] + [clips[cn][pclear[cn][1]] for cn in sorted(pclear)]
    for yaw in (0, 45, 90):
        for i in range(0, len(close), 12): sheet(f"pouch_{yaw}_{i // 12}", close[i:i + 12], yaw)
    FOCUS[:] = ["R_Hand", 0.25]
    for nm in ("idle", "walk"):
        for yaw in (-60, 20, 120):
            sheet(f"hand_{nm}_{yaw}", pick(clips[nm], 4), yaw)
    FOCUS[0] = None
    for o, nm in ((cloak, "body"), (mesh, "cloak")):  # each part alone: holes in the body / cloak coverage
        o.hide_render = True
        for y in (0, 90, 180, 270): sheet(f"part_{nm}_{y}", [BASE, clips["fall"][6], clips["slash"][HIT]], y)
        o.hide_render = False

    def swung(deg):
        def f():
            apply(BASE)
            for ch, axis in (("Cloak_B", X), ("Cloak_L", Y), ("Cloak_R", Y), ("Cloak_FL", X), ("Cloak_FR", X)):
                for i, nm in enumerate(NEW[ch][:-1]): rot(nm, axis, (deg if ch != "Cloak_R" else -deg) * (0.6 + 0.2 * i))
            rot("Hood1", X, deg)
        return f
    for yaw in (0, 90, 180, 270):
        sheet(f"tear_{yaw}", [BASE, swung(25), swung(-25), swung(45)], yaw)

print("BEGIN_REPORT" + json.dumps(rep) + "END_REPORT")
