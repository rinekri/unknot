"""Shared helpers for the NPC model scripts (engine/tools/npc_*.py), headless Blender 5.x.
Blender axes as in hero_rig.py: the model faces -Y (glTF +Z after export_yup), its left = +X, up = +Z, origin = ground contact.
Materials: Principled BSDF, roughness 0.9 / metallic 0 like the props; stone/paper take the 'Col' color attribute (COLOR_0) as
albedo, which look.js reads as vertex-coloured (watercolor blotches) and, for the name 'stone', patches with the Rock030 detail."""
import bpy, bmesh, math, os
from mathutils import Vector, Matrix, noise

FPS = 24


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.fps = FPS
    return sc


def lin(h):  # '#rrggbb' sRGB -> linear rgb
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def mix(a, b, t): return tuple(x + (y - x) * t for x, y in zip(a, b))


def material(name, color="#ffffff", vcol=False, emit=None, alpha=1.0, double=False):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*lin(color), 1)
    b.inputs["Roughness"].default_value = 0.9
    b.inputs["Metallic"].default_value = 0.0
    if vcol:
        a = nt.nodes.new("ShaderNodeVertexColor"); a.layer_name = "Col"
        nt.links.new(a.outputs["Color"], b.inputs["Base Color"])
    if emit:
        b.inputs["Emission Color"].default_value = (*lin(emit[0]), 1)
        b.inputs["Emission Strength"].default_value = emit[1]
    if alpha < 1:
        b.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    m.use_backface_culling = not double
    return m


def rock(size, loc=(0, 0, 0), seed=0, sub=2, box=0.55, rough=0.12, top=None, bottom=None, rot=0.0, tilt=(0, 0)):
    """Boxy noisy boulder (superellipsoid-ish icosphere). size = half extents; top/bottom clamp z (flat cut faces)."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1)
    R = Matrix.Rotation(rot, 3, "Z") @ Matrix.Rotation(tilt[0], 3, "X") @ Matrix.Rotation(tilt[1], 3, "Y")
    o = Vector((seed * 1.37, seed * 2.11, seed * 0.73))
    for v in bm.verts:
        d = v.co.normalized()
        p = Vector([math.copysign(abs(c) ** box, c) for c in d])
        p *= 1 + rough * noise.noise(d * 1.6 + o) + rough * 0.4 * noise.noise(d * 4.0 + o)
        v.co = R @ Vector((p.x * size[0], p.y * size[1], p.z * size[2])) + Vector(loc)
        if top is not None: v.co.z = min(v.co.z, top)
        if bottom is not None: v.co.z = max(v.co.z, bottom)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
    return bm


def part(name, bm, mat, color, group=None, smooth=35, corner=False):
    """bmesh -> object. color(co, normal) -> linear rgb, per vertex (or per face corner when corner=True, flat-shaded paper).
    group: vertex group (bone name) weighting the whole part 1.0, or a callable(co) -> [(bone, w), ...]."""
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(mat)
    if smooth:
        for p in me.polygons: p.use_smooth = True
        me.set_sharp_from_angle(angle=math.radians(smooth))
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER" if corner else "POINT")
    if corner:
        for p in me.polygons:
            c = color(p.center, p.normal)
            for li in p.loop_indices: ca.data[li].color = (*c, 1)
    else:
        for v in me.vertices: ca.data[v.index].color = (*color(v.co, v.normal), 1)
    if group:
        if callable(group):
            for v in me.vertices:
                for bn, w in group(v.co):
                    if w > 0: (ob.vertex_groups.get(bn) or ob.vertex_groups.new(name=bn)).add([v.index], w, "REPLACE")
        else:
            ob.vertex_groups.new(name=group).add(list(range(len(me.vertices))), 1.0, "REPLACE")
    return ob


def join(objs, name):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = ob.data.name = name
    ob.data.color_attributes.active_color = ob.data.color_attributes["Col"]
    return ob


def armature(name, bones):
    """bones = [(name, head, tail, parent|None)]; roll 0. Returns the armature object."""
    a = bpy.data.armatures.new(name)
    ob = bpy.data.objects.new(name, a)
    bpy.context.scene.collection.objects.link(ob)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode="EDIT")
    for bn, h, t, par in bones:
        e = a.edit_bones.new(bn); e.head = h; e.tail = t; e.roll = 0
        if par: e.parent = a.edit_bones[par]
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ob.pose.bones: pb.rotation_mode = "XYZ"
    return ob


def skin(mesh, arm):
    mesh.parent = arm
    mesh.modifiers.new("Armature", "ARMATURE").object = arm


def clip(arm, name, frames, fn, loop=True):
    """fn(t in [0,1]) -> {bone: (rot_deg_xyz, loc|None, scale|None)}; every bone keyed every frame (no leaks between clips)."""
    ad = arm.animation_data or arm.animation_data_create()
    act = bpy.data.actions.new(name)
    ad.action = act
    for f in range(frames + 1):
        pose = fn(f / frames)
        for pb in arm.pose.bones:
            r, l, s = pose.get(pb.name, ((0, 0, 0), None, None))
            pb.rotation_euler = [math.radians(x) for x in r]
            pb.location = l or (0, 0, 0)
            pb.scale = (s, s, s) if isinstance(s, (int, float)) else (s or (1, 1, 1))
            for p in ("rotation_euler", "location", "scale"): pb.keyframe_insert(p, frame=f)
    tr = ad.nla_tracks.new(); tr.name = name
    st = tr.strips.new(name, 0, act)
    if hasattr(act, "slots") and len(act.slots): st.action_slot = act.slots[0]
    ad.action = None
    CLIPS[name] = {"frames": frames + 1, "loop": loop}
    return act


CLIPS = {}


def export(path, facing="+z"):
    sc = bpy.context.scene
    sc["fps"] = FPS; sc["facing"] = facing; sc["scale"] = 1
    if CLIPS: sc["clips"] = CLIPS
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for ob in sc.objects:
        if ob.type == "ARMATURE":
            for pb in ob.pose.bones: pb.rotation_euler = (0, 0, 0); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_extras=True,
                              export_animation_mode="NLA_TRACKS" if CLIPS else "ACTIONS", export_animations=bool(CLIPS),
                              export_force_sampling=True, export_vertex_color="MATERIAL")
    tris = sum(len(p.vertices) - 2 for o in sc.objects if o.type == "MESH" for p in o.data.polygons)
    print(f"NPC_EXPORT {path} tris={tris}")


# ---------- QA renders (EEVEE + freestyle ink, cream world) ----------
def qa_setup():
    sc = bpy.context.scene
    try: sc.render.engine = "BLENDER_EEVEE"
    except TypeError: sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.use_freestyle = True
    sc.render.line_thickness = 1.3
    fs = sc.view_layers[0].freestyle_settings
    ls = fs.linesets[0] if len(fs.linesets) else fs.linesets.new("ink")
    ls.linestyle = ls.linestyle or bpy.data.linestyles.new("ink")
    ls.linestyle.color = lin("#342d24")
    sc.world = sc.world or bpy.data.worlds.new("w")
    if not sc.world.node_tree: sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (*lin("#efe6d6"), 1); bg.inputs[1].default_value = 0.9
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = "ORTHO"
    tgt = bpy.data.objects.new("tgt", None); sc.collection.objects.link(tgt)
    c = cam.constraints.new("TRACK_TO"); c.target = tgt; c.track_axis = "TRACK_NEGATIVE_Z"; c.up_axis = "UP_Y"
    return cam, tgt


def shoot(path, cam, tgt, center, scale, yaw=40, el=20, w=480, h=480):
    sc = bpy.context.scene
    a, e = math.radians(yaw), math.radians(el)
    tgt.location = center
    cam.location = Vector(center) + 10 * Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))
    cam.data.ortho_scale = scale
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


def pose_at(arm, name, t):
    """Pose the armature at clip `name`, normalized time t (NLA tracks muted)."""
    ad = arm.animation_data
    for tr in ad.nla_tracks: tr.mute = True
    act = bpy.data.actions[name]
    ad.action = act
    if hasattr(act, "slots") and len(act.slots): ad.action_slot = act.slots[0]
    bpy.context.scene.frame_set(round(t * (CLIPS[name]["frames"] - 1)))


# ---------- name glyphs (shared by Kamen's back and the name stones / knot chunks / goal circle) ----------
# strokes in a unit square [-0.5, 0.5]^2, x right, y up: a = Algiz-like fork, b = Othala-like crossed diamond, c = Dagaz bow-tie, x = cross
GLYPHS = {
    "a": [((0, -0.5), (0, 0.5)), ((0, 0.05), (-0.36, 0.45)), ((0, 0.05), (0.36, 0.45))],
    "b": [((0, 0.5), (0.32, 0.16)), ((0, 0.5), (-0.32, 0.16)), ((0.32, 0.16), (-0.3, -0.5)), ((-0.32, 0.16), (0.3, -0.5))],
    "c": [((-0.36, -0.45), (-0.36, 0.45)), ((0.36, -0.45), (0.36, 0.45)), ((-0.36, 0.45), (0.36, -0.45)), ((-0.36, -0.45), (0.36, 0.45))],
    "x": [((-0.4, -0.4), (0.4, 0.4)), ((-0.4, 0.4), (0.4, -0.4))],
}


def glyph(kind, size, M=Matrix(), width=0.14, depth=0.06):
    """Glyph `kind` as one box bar per stroke (12 tris each) in the local XY plane, z = 0 .. depth*size (raised face +Z),
    then transformed by the 4x4 M. width/depth are fractions of size."""
    bm = bmesh.new()
    w, d = width * size / 2, depth * size
    for (x0, y0), (x1, y1) in GLYPHS[kind]:
        a, b = Vector((x0, y0)) * size, Vector((x1, y1)) * size
        t = (b - a).normalized()
        a, b = a - t * w * 0.6, b + t * w * 0.6  # overlap the joints a little
        nrm = Vector((-t.y, t.x)) * w
        vs = [bm.verts.new((p.x, p.y, z)) for z in (-d * 0.5, d) for p in (a - nrm, b - nrm, b + nrm, a + nrm)]
        for f in ((0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            bm.faces.new([vs[i] for i in f])
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    return bm
