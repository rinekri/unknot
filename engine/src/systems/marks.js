// Song targets as objects (R3, render only; no sim state is written): the target itself shows its state and the song it wants,
// with no signs, plates or icons beside it (assets/props/v2, light-me materials #5b554b lerp to the song colour / gold):
//   anchor  every crumble slab, moving lift and timed-bridge piece is a slab (anchor_slab, instanced; its flat glyph node
//           stripped). A lift still waiting for its rune is bound: iron rings pinned to its sides. The rune wakes: the rings
//           burst off and fall away, and from then on four stone shards circle it slowly (it flies on its own; songs.js anchorOf:
//           the moment a press takes, the shards glint). A crumble slab has no rings: it is broken, two halves with a gap and
//           rubble jammed in the crack; the Anchor pulls the halves shut on a gold seam, and it breaks open again when the hold ends.
//           Anchored (frozen): the shards stop dead, a thin forged-iron chain shoots up from each corner with a gold rune glow
//           running up it, and the slab locks level with a dust puff; when the hold ends the chains shrink away.
//   name    a far rune is a 2.3 m totem bound by thick gold cords (name_totem_k<motif length>): one tied cord per note (wraps, a
//           knot and two tails), a long note three wraps. In reach the knots shiver and glint; each right note slackens one;
//           freed, the cords drop to its foot and lie in rings on the ground; the carved name warms faintly.
//   gust    a dusty switch has a boulder (gust_stone_a/b/c) standing in front of its carved face, leaning on it: the rune is
//           covered. Its spiral grooves are stuffed with grit, twigs and leaves. In reach the grooves shimmer and leaves and dust
//           trickle out (fx.js gustFx); the Gust blows the plug out, the boulder slides aside off the rune (the carving is bared)
//           and wind streams out of the open grooves.
// A switch and its target share no sign: they hum the same note (audio.js humAt), and the target answers in the world.
// Registry 'marks.res' = [gust, name, anchor] 0/1: a target of that song resonates now (player.js cloak seam brightens with it).
// Draw calls: 2 instanced meshes for every anchor slab (stone + iron), ~5 per gust stone, 4 + knots per totem.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { SONG_COL, NAME_R, ANCHOR_R, gustReach, anchorOf, motifOf } from './songs.js';

const SONGS = ['gust', 'name', 'anchor'];
const COL = Object.fromEntries(SONGS.map((s) => [s, new THREE.Color(SONG_COL[s])]));
const GOLD = new THREE.Color('#ffcf6a'), DIM = new THREE.Color('#5b554b'), MOSS = new THREE.Color('#6d7552');
const SLAB = { x: 2.41, z: 1.62, h: 0.56 }, SWAY = 0.35, TOTEM_S = 1.5, STONE_H = 2.7, STONE_W = 1.35, LINKS = 16, LINK_D = 0.2, RING_S = 1.8;
const ROPE = new THREE.Color('#d6a23e'), IRON = new THREE.Color('#2e2a27'), GRIT = [new THREE.Color('#5e5446'), new THREE.Color('#6d7552'), new THREE.Color('#8a7a52'), new THREE.Color('#4a4237'), new THREE.Color('#a08a58')];
const _v = new THREE.Vector3(), _u = new THREE.Matrix4(), _m = new THREE.Matrix4(), _f = new THREE.Matrix4(), _r = new THREE.Matrix4(), _c = new THREE.Color(), _b = new THREE.Box3(), _i = new THREE.Matrix4(), _q = new THREE.Quaternion(), _a = new THREE.Vector3();
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), WARM = new THREE.Color('#8c6a3a'), AXY = new THREE.Vector3(0, 1, 0);
const _e = new THREE.Euler(), _s0 = new THREE.Vector3(), _n = new THREE.Vector3(), _x = new THREE.Vector3(), _A = new THREE.Vector3(), _B = new THREE.Vector3(), _h = new THREE.Vector3(), _d = new THREE.Vector3(), _t = new THREE.Vector3();
const _c0 = new THREE.Vector3(), _c1 = new THREE.Vector3(), _s = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), _x0 = new THREE.Vector3(1, 0, 0), _lq = new THREE.Quaternion(), _rq = new THREE.Quaternion();
const _qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), _roll = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);

// a (quantized) GLB mesh as float geometry in its scene's space, for instancing
export function bake(mesh) {
  const s = mesh.geometry, g = new THREE.BufferGeometry(), get = ['getX', 'getY', 'getZ', 'getW'];
  for (const k of Object.keys(s.attributes)) {
    const a = s.attributes[k]; if (!a) continue;
    const n = a.itemSize, arr = new Float32Array(a.count * n);
    for (let i = 0; i < a.count; i++) for (let j = 0; j < n; j++) arr[i * n + j] = a[get[j]](i);
    g.setAttribute(k, new THREE.BufferAttribute(arr, n));
  }
  if (s.index) g.setIndex(Array.from(s.index.array));
  mesh.updateWorldMatrix(true, false);
  return g.applyMatrix4(mesh.matrixWorld);
}
// light-me material: a per-instance 'glow' attribute adds as emissive (vertex colours untouched)
function glowInst(mat, key) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 glow;\nvarying vec3 vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vGlow;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vGlow;');
  };
  mat.userData.cacheKey = key;
  return mat;
}
const matOf = (scene, name) => { let m = null; scene.traverse((o) => { if (o.isMesh && o.material?.name === name) m = o; }); return m; };

let M = null;
export const gustList = () => M?.stones ?? []; // fx.js: groove vents of each gust stone (state 0 dormant, 1 in reach, 2 cleared)

// a tied cord round a post of radius R: wraps, a knot on the front (+z), two loose tails
function cordGeo(R, wraps) {
  const parts = [], tube = 0.085;
  for (let w = 0; w < wraps; w++) { const g = new THREE.TorusGeometry(R + tube * 0.5, tube, 6, 28); g.rotateX(Math.PI / 2); g.rotateX((w - (wraps - 1) / 2) * 0.1); g.translate(0, (w - (wraps - 1) / 2) * tube * 1.8, 0); parts.push(g); }
  const k = new THREE.TorusKnotGeometry(0.13, 0.065, 48, 6); k.translate(0, 0, R + 0.16); parts.push(k);
  for (const sd of [-1, 1]) { const t = new THREE.CylinderGeometry(0.04, 0.03, 0.45, 5); t.translate(0, -0.22, 0); t.rotateZ(sd * 0.3); t.translate(sd * 0.07, -0.06, R + 0.14); parts.push(t); }
  return mergeGeometries(parts);
}

const LOD = 55; // m: past this a totem's cords and a gust stone's plug and grooves are a few pixels; skip their draw calls
export default {
  name: 'marks', order: 61, deps: ['level', 'enemies'],
  async init(ctx) {
    const reg = ctx.registry, L = reg.get('level'), data = L?.data;
    M = null;
    if (!L) return;
    const gl = (p) => ctx.assets.gltf(`assets/props/v2/${p}.glb`).then((g) => g.scene);
    const owned = (s) => !!reg.get('flags')?.[`gift.${s}`];
    const anchors = [], totems = [], stones = [];

    // anchor slabs: crumbles, moving lifts, timed bridges
    const pieces = L.targets.mechs.filter((k) => k.m.kind === 'crumble' || (k.m.kind === 'platform' && k.m.id !== 'golem' && k.m.mode !== 'once' && !/knot_/.test(k.vis.name)) || (k.br && k.br.m.hold != null));
    if (pieces.length) {
      const src = await gl('anchor_slab');
      const slab = matOf(src, 'stone'), iron = matOf(src, 'iron');
      const ironMat = glowInst(iron.material.clone(), 'ironglow');
      const mk = (mesh, mat, layer, n = pieces.length) => { const im = new THREE.InstancedMesh(bake(mesh), mat, n); im.name = `anchor_slab__${mesh.material.name}`; im.frustumCulled = false; if (layer) im.layers.set(1); ctx.add(im); return im; };
      const sIM = mk(slab, slab.material, 0, pieces.length + pieces.filter((k) => k.m.kind === 'crumble').length), iIM = mk(iron, ironMat, 0, pieces.length * 3); // a crumble slab draws as two halves
      { // one forged ring (the asset's +x one, origin moved to the slab's end face) per instance, three a slab: a long slab stretches its stone, never its iron
        const g = iIM.geometry.toNonIndexed(), q = g.attributes.position, keep = [];
        for (let v = 0; v < q.count; v += 3) if (q.getX(v) > 0.9 && q.getX(v + 1) > 0.9 && q.getX(v + 2) > 0.9) keep.push(v, v + 1, v + 2);
        for (const n of Object.keys(g.attributes)) { const at = g.attributes[n], out = new at.array.constructor(keep.length * at.itemSize); keep.forEach((v, j) => { for (let c = 0; c < at.itemSize; c++) out[j * at.itemSize + c] = at.array[v * at.itemSize + c]; }); g.setAttribute(n, new THREE.BufferAttribute(out, at.itemSize, at.normalized)); }
        g.translate(-SLAB.x / 2, 0, 0); iIM.geometry = g;
      }
      ironMat.color.setRGB(1.7, 1.5, 1.3); // hammered grey iron, not black rubber
      iIM.geometry.setAttribute('glow', new THREE.InstancedBufferAttribute(new Float32Array(pieces.length * 9), 3));
      for (const k of pieces) {
        k.vis.updateWorldMatrix(true, true);
        _i.copy(k.vis.matrixWorld).invert(); _b.makeEmpty();
        k.vis.traverse((o) => {
          if (!o.isMesh) return;
          o.geometry.computeBoundingBox(); _b.union(o.geometry.boundingBox.clone().applyMatrix4(_m.multiplyMatrices(_i, o.matrixWorld)));
          o.layers.disableAll(); // the iron-bound slab replaces the plain stone (collider unchanged)
        });
        const sz = _b.getSize(new THREE.Vector3()), c = _b.getCenter(new THREE.Vector3()), rot = sz.z > sz.x;
        const lx = rot ? sz.z : sz.x, lz = rot ? sz.x : sz.z;
        const fit = new THREE.Matrix4().makeTranslation(c.x, _b.max.y, c.z).multiply(_r.makeRotationY(rot ? Math.PI / 2 : 0)).multiply(_m.makeScale(lx / SLAB.x, Math.min(1.6, sz.y / SLAB.h), lz / SLAB.z));
        const crumble = k.m.kind === 'crumble', id = crumble ? k.m.group ?? k.m.id : k.br ? k.br.m.id : k.m.id, mm = k.br ? k.br.m : k.m;
        const pin = new THREE.Matrix4().makeTranslation(c.x, _b.max.y, c.z).multiply(_r.makeRotationY(rot ? Math.PI / 2 : 0)); // fit without its stretch
        const rings = [[lx / 2, 0, 0], [-lx / 2, 0, Math.PI], [0, lz / 2, -Math.PI / 2]].map(([x, z, a]) => pin.clone().multiply(_r.makeTranslation(x, 0, z)).multiply(_r.makeRotationY(a)).multiply(_m.makeScale(RING_S, RING_S, RING_S)));
        anchors.push({ k, fit, rings, id, mm, crumble, half: crumble ? pieces.length + anchors.filter((q) => q.crumble).length : -1, taut: 0, was: false, sx: lx / SLAB.x, rise: k.m.kind === 'platform' && !k.br ? Math.max(0, ...(k.m.path ?? []).map((q) => q[1])) : 0 });
      }
      // thin forged-iron chains (only while a slab is held) and the stone shards that circle a loose slab: one draw each + ink
      const chainMat = glowInst(new THREE.MeshStandardMaterial({ color: IRON, roughness: 0.55, metalness: 0.4 }), 'chainglow');
      const link = new THREE.TorusGeometry(0.075, 0.024, 4, 8); link.scale(1.7, 1, 1);
      const shard = new THREE.IcosahedronGeometry(0.17, 0); shard.scale(1.25, 0.7, 0.9);
      const imk = (geo, n, name, mat = chainMat) => { const im = new THREE.InstancedMesh(geo, mat, n); im.name = name; im.frustumCulled = false; geo.setAttribute('glow', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3)); ctx.add(im); return im; };
      const lIM = imk(link, pieces.length * 4 * LINKS, 'anchor_chain__links'), rIM = imk(shard, pieces.length * 4, 'anchor_chain__shards', glowInst(new THREE.MeshStandardMaterial({ color: '#9a917f', roughness: 0.95, flatShading: true }), 'shardglow'));
      M = { sIM, iIM, lIM, rIM };
    }

    // name totems at far runes
    for (const sw of L.targets.switches) {
      if (!sw.m.far || sw.m.menhir) continue; // the menhir is only a rock (the l1 joke): no totem
      const motif = motifOf(sw.m.id, sw.m), K = THREE.MathUtils.clamp(motif.length, 2, 4);
      const o = await gl(`name_totem_k${K}`), prop = ctx.scene.getObjectByName(sw.m.node);
      if (prop) { prop.updateWorldMatrix(true, false); prop.traverse((q) => q.isMesh && q.layers.disableAll()); o.quaternion.copy(prop.getWorldQuaternion(_q)); }
      if (sw.glyph) sw.glyph.visible = false;
      o.position.set(sw.pos[0], sw.pos[1], sw.pos[2]); o.scale.setScalar(TOTEM_S); o.name = `totem_${sw.m.id}`;
      const t = { sw, motif, knots: [], far: [], glyph: null, eyes: null, onAt: null };
      const post = o.getObjectByName('totem'), pp = post.geometry.attributes.position, rope = o.getObjectByName('knot_1').material;
      o.traverse((q) => {
        if (!q.isMesh) return;
        const n = q.material.name;
        if (n === 'name_glyph' || n === 'eyes') { q.material = q.material.clone(); q.material.emissive = GOLD.clone(); q.material.emissiveIntensity = 0; q.layers.set(1); t[n === 'eyes' ? 'eyes' : 'glyph'] = q.material; t.far.push(q); }
      });
      post.updateMatrix(); t.R0 = 0.2;
      for (let j = 0; j < pp.count; j++) { _v.fromBufferAttribute(pp, j).applyMatrix4(post.matrix); if (_v.y < 0.25) t.R0 = Math.max(t.R0, Math.hypot(_v.x - post.position.x, _v.z - post.position.z)); }
      for (let i = 0; i < K; i++) { // the GLB's thin knot bands give way to thick tied cords at the same heights
        const src = o.getObjectByName(`knot_${i + 1}`); src.visible = false;
        src.geometry.computeBoundingBox(); const kc = src.geometry.boundingBox.getCenter(new THREE.Vector3()).applyMatrix4(src.matrix);
        post.updateMatrix(); let R = 0.15, cx = 0, cz = 0, cn = 0;
        for (let j = 0; j < pp.count; j++) { _v.fromBufferAttribute(pp, j).applyMatrix4(post.matrix); if (Math.abs(_v.y - kc.y) < 0.12) { cx += _v.x; cz += _v.z; cn++; } }
        cx /= cn || 1; cz /= cn || 1;
        for (let j = 0; j < pp.count; j++) { _v.fromBufferAttribute(pp, j).applyMatrix4(post.matrix); if (Math.abs(_v.y - kc.y) < 0.12) R = Math.max(R, Math.hypot(_v.x - cx, _v.z - cz)); }
        const mat = rope.clone(); mat.vertexColors = false; mat.color.copy(ROPE); mat.emissive = GOLD.clone(); mat.emissiveIntensity = 0;
        const c = new THREE.Mesh(cordGeo(R, motif[i] === 'L' ? 3 : 2), mat); c.name = `cord_${i + 1}`;
        c.position.set(cx, kc.y, cz); o.add(c);
        t.knots[i] = { o: c, base: c.position.clone(), mat, seed: i * 1.7, R };
      }
      ctx.add(o); totems.push(t);
    }

    // U19 the Gust's carved motion: five streaks fanning up out of one point, a curl at the mouth (the shrine's face, and every gust boulder's)
    const windCone = (H, y0, zf) => { const parts = [];
      for (let i = 0; i < 5; i++) { const g = new THREE.CylinderGeometry(0.06, 0.04, H * 0.5, 5); g.translate(0, H * 0.25, 0); g.rotateZ((i / 4 - 0.5) * 0.75); g.translate(0, y0 + H * 0.25, zf); parts.push(g); }
      const c = new THREE.TorusGeometry(H * 0.08, 0.05, 5, 16, 4.4); c.translate(0, y0 + H * 0.8, zf); parts.push(c); return parts; };
    const reliefMat = (song) => new THREE.MeshStandardMaterial({ color: '#6f685c', roughness: 0.9, flatShading: true, emissive: COL[song].clone(), emissiveIntensity: 0 });
    // gust stones: a boulder covering each dusty rune's face, its grooves plugged
    const chunk = new THREE.IcosahedronGeometry(1, 0), plugMat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    for (const sw of L.targets.switches) {
      if (!sw.m.dust) continue;
      const prop = ctx.scene.getObjectByName(sw.m.node), v = 'abc'[[...sw.m.id].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 3];
      const o = await gl(`gust_stone_${v}`);
      o.updateWorldMatrix(true, true); _b.setFromObject(o);
      const sc = STONE_H / (_b.max.y - _b.min.y), hw = (_b.max.x - _b.min.x) * sc * STONE_W / 2, hd = (_b.max.z - _b.min.z) * sc * STONE_W / 2;
      const yaw = prop ? new THREE.Euler().setFromQuaternion(prop.getWorldQuaternion(_q), 'YXZ').y : 0;
      const side = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), out = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)); // rune local +x, +z (its carved face)
      const off = 0.35 + hw;
      const spot = [1, -1].map((sd) => { // where it comes to rest once blown aside: beside the rune, on its ledge
        const x = sw.pos[0] + side.x * off * sd + out.x * 0.2, z = sw.pos[2] + side.z * off * sd + out.z * 0.2, g = L.collide.groundAt(x, z, sw.pos[1] + 1.5);
        return { sd, x, z, g };
      }).find((q) => q.g && Math.abs(q.g.y - sw.pos[1]) < 0.6) ?? { sd: 1, x: sw.pos[0] + side.x * off, z: sw.pos[2] + side.z * off, g: null };
      const gx = sw.pos[0] + out.x * (hd + 0.25), gz = sw.pos[2] + out.z * (hd + 0.25), gy = L.collide.groundAt(gx, gz, sw.pos[1] + 1.5)?.y ?? sw.pos[1]; // in front of the carved face
      o.position.set(gx, gy - 0.05, gz); o.rotation.y = yaw; o.scale.set(sc * STONE_W, sc, sc * STONE_W); o.name = `guststone_${sw.m.id}`;
      const stone = o.getObjectByName('stone'), groove = o.getObjectByName('groove');
      stone.geometry.computeBoundingBox();
      const foot = new THREE.Vector3(stone.position.x, stone.position.y + stone.geometry.boundingBox.min.y * stone.scale.y, stone.position.z);
      const pivot = new THREE.Group(); pivot.position.copy(foot); o.add(pivot);
      for (const q of [stone, groove]) { q.position.sub(foot); pivot.add(q); }
      groove.material = groove.material.clone(); groove.material.color.copy(MOSS); groove.material.emissive = COL.gust.clone(); groove.material.emissiveIntensity = 0; groove.layers.set(1);
      // the plug: grit, twigs and leaf clumps stuffed along the grooves (pivot space, so they lean with the stone)
      groove.updateMatrix(); const gp = groove.geometry.attributes.position, N = 22, vents = [];
      const plug = new THREE.InstancedMesh(chunk, plugMat, N); plug.name = `guststone_plug_${sw.m.id}`; plug.frustumCulled = false; pivot.add(plug);
      const bits = [];
      for (let i = 0; i < N; i++) {
        const p = new THREE.Vector3().fromBufferAttribute(gp, Math.floor((i + 0.5) / N * gp.count)).applyMatrix4(groove.matrix), kind = i % 3; // 0 grit, 1 twig, 2 leaves
        const s0 = (kind === 1 ? new THREE.Vector3(0.035, 0.035, 0.24) : kind === 2 ? new THREE.Vector3(0.13, 0.07, 0.11) : new THREE.Vector3(0.1, 0.08, 0.09)).multiplyScalar((0.6 + 0.3 * ((i * 0.618) % 1)) / sc);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(i * 1.3, i * 2.1, i * 0.7));
        bits.push({ p, s0, q, out: p.clone().sub(new THREE.Vector3(0, p.y, 0)).normalize() });
        plug.setColorAt(i, GRIT[kind === 2 ? (i % 2 ? 1 : 4) : kind === 1 ? 3 : (i % 2 ? 0 : 2)]);
        if (i % 4 === 0) vents.push(new THREE.Vector3());
      }
      // U19: the shrine's wind cone cut on the boulder's face (world-sized under the stone's stretch; it leans and rolls with it)
      const cone = new THREE.Mesh(mergeGeometries(windCone(STONE_H * 0.8, 0, 0).map((g) => g.toNonIndexed())), reliefMat('gust')); cone.name = `guststone_cone_${sw.m.id}`;
      cone.scale.set(1 / (sc * STONE_W), 1 / sc, 1 / (sc * STONE_W)); cone.position.z = hd * 0.93 / (sc * STONE_W); cone.rotation.x = -0.2; pivot.add(cone);
      ctx.add(o); o.updateWorldMatrix(true, true);
      stones.push({ sw, o, pivot, plug, bits, cone: cone.material, groove: groove.material, grooveO: groove, lean: new THREE.Vector3(-1, 0, 0), rest: new THREE.Vector3(spot.x, (spot.g?.y ?? sw.pos[1]) - 0.05, spot.z), dir: null, clearT: null, state: 0, vents, ventP: bits.filter((_, i) => i % 4 === 0).map((b) => b.p), up: new THREE.Vector3(), pos: new THREE.Vector3(gx, gy + STONE_H / 2, gz), sc });
    }
    // song-shrines (U18, level.js sw.m.gift): an old standing stone with its song's motion carved in relief on its +z face (gust a
    // cone of wind streaks, name ribbons wrapped round it, anchor two chains); stone-coloured, it glows in the song's colour once sung
    const shrines = [];
    for (const sw of L.targets.switches) {
      const song = sw.m.gift, prop = song && ctx.scene.getObjectByName(sw.m.node); if (!prop) continue;
      prop.updateWorldMatrix(true, true); _i.copy(prop.matrixWorld).invert(); _b.makeEmpty();
      prop.traverse((o) => { if (o.isMesh) { o.geometry.computeBoundingBox(); _b.union(o.geometry.boundingBox.clone().applyMatrix4(_m.multiplyMatrices(_i, o.matrixWorld))); } });
      const H = _b.max.y - _b.min.y, y0 = _b.min.y, zf = _b.max.z * 0.8 + 0.02, R = Math.max(_b.max.x - _b.min.x, _b.max.z - _b.min.z) / 2 + 0.03, parts = [];
      if (song === 'gust') parts.push(...windCone(H, y0, zf));
      else if (song === 'name') { // three ribbons wrapped round the stone, crossing on its face
        for (let i = 0; i < 3; i++) { const g = new THREE.TorusGeometry(R, 0.06, 5, 28); g.scale(1, 1, 0.9); g.rotateX(Math.PI / 2 + (i % 2 ? 0.3 : -0.3)); g.translate(0, y0 + H * (0.3 + 0.2 * i), 0); parts.push(g); }
      } else { // two chains hanging down its face
        const n = Math.max(6, Math.round(H * 0.55 / 0.17));
        for (const x of [-0.13, 0.13]) for (let i = 0; i < n; i++) { const g = new THREE.TorusGeometry(0.065, 0.03, 4, 8); g.scale(1, 1.5, 1); if (i % 2) g.rotateY(Math.PI / 2); g.translate(x, y0 + H * 0.85 - i * 0.17, zf); parts.push(g); }
      }
      const mat = reliefMat(song);
      const o = new THREE.Mesh(mergeGeometries(parts.map((g) => g.toNonIndexed())), mat); o.name = `shrine_relief_${sw.m.id}`;
      // U19: motes of the song's colour drift up off the stone: seen from the route, asleep or awake
      const motes = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(36), 3)), new THREE.PointsMaterial({ color: COL[song], size: 0.42, transparent: true, opacity: 0.8, depthWrite: false }));
      motes.name = `shrine_motes_${sw.m.id}`; motes.frustumCulled = false;
      prop.add(o, motes); shrines.push({ sw, song, mat, o, motes, H, y0, R });
    }
    if (pieces.length || totems.length || stones.length) reg.set('look.refresh', true); // look.js: Rock030 detail on the new stone

    reg.on('song.cast', (c) => { // the gust that cleared a stone's rune: it topples away from where it came from
      if (c.song !== 'gust') return;
      for (const s of stones) if (s.clearT === null && s.sw.dusty) s.from = c.pos.slice();
    });
    M = { ...(M ?? {}), anchors, totems, stones, shrines, res: [0, 0, 0], owned };
    reg.set('marks.res', M.res);
  },
  beforeRender(ctx, alpha) {
    if (!M) return;
    const reg = ctx.registry, p = reg.get('player')?.pos; if (!p) return;
    const now = ctx.game.t - (1 - alpha) / 60, S = reg.get('songs.state'), flags = reg.get('flags') ?? {}, owned = M.owned;
    M.res.fill(0);

    // anchors
    if (M.sIM) {
      const docked = new Set(), sm = THREE.MathUtils.smoothstep;
      const zero = (i, a) => { M.sIM.setMatrixAt(i, ZERO); if (a.crumble) M.sIM.setMatrixAt(a.half, ZERO); for (let j = 0; j < 3; j++) M.iIM.setMatrixAt(i * 3 + j, ZERO); for (let j = 0; j < 4 * LINKS; j++) M.lIM.setMatrixAt(i * 4 * LINKS + j, ZERO); for (let j = 0; j < 4; j++) M.rIM.setMatrixAt(i * 4 + j, ZERO); };
      M.anchors.forEach((a, i) => {
        const k = a.k, br = k.br, hidden = !k.vis.visible || (br && br.start === null);
        if (hidden) { zero(i, a); return; }
        const frozen = (br ? br.frozen : k.frozen) > now;
        if (frozen !== a.was) { // the lock: chains snap taut, slab drops level with a puff; released: chains fall slack again
          a.was = frozen; a.t0 = now;
          if (frozen && !docked.has(a.id)) { docked.add(a.id); reg.set('mech.dock', { t: ctx.game.t, pos: k.cur.toArray() }); }
        }
        const taut = frozen ? sm(now - (a.t0 ?? -9), 0, 0.3) : 1 - sm(now - (a.t0 ?? -9), 0, 0.6), loose = 1 - taut;
        k.vis.updateWorldMatrix(true, false);
        _m.copy(k.vis.matrixWorld);
        if (frozen && a.crumble && k.timer >= 0 && k.timer < k.m.delay) _m.setPosition(_v.copy(k.base).applyMatrix4(k.vis.parent.matrixWorld)); // locked still: no shake
        if (loose > 0) _m.multiply(_r.makeRotationFromEuler(_e.set(0.045 * loose * Math.sin(now * 1.7 + i * 1.3), 0, 0.04 * loose * Math.sin(now * 1.2 + i * 2.1)))); // unbound: it rocks
        _u.copy(_m); _m.multiply(a.fit);
        if (a.crumble) { // broken in two: halves apart and askew; held, they pull shut
          const g = 0.235 + 0.035 * loose;
          M.sIM.setMatrixAt(i, _f.copy(_m).multiply(_r.makeTranslation(-g * SLAB.x, 0, 0)).multiply(_r.makeRotationFromEuler(_e.set(0, 0.05 * loose, -0.07 * loose))).multiply(_r.makeScale(0.47, 1, 1)));
          M.sIM.setMatrixAt(a.half, _f.copy(_m).multiply(_r.makeTranslation(g * SLAB.x, -0.05 * loose, 0)).multiply(_r.makeRotationFromEuler(_e.set(0.03 * loose, -0.06 * loose, 0.11 * loose))).multiply(_r.makeScale(0.47, 0.94, 1)));
        } else M.sIM.setMatrixAt(i, _m);
        const bound = !a.crumble && !br && (k.m.idle || k.m.after) && k.start === undefined; // a lift asleep until its rune: ringed
        if (!bound && a.bound) a.burst = now;
        a.bound = bound;
        const bu = a.burst === undefined ? 9 : (now - a.burst) / 0.8; // rings burst off: thrown outward, swinging up, then falling away
        const near = Math.hypot(p.x - k.cur.x, p.y - k.cur.y, p.z - k.cur.z) <= ANCHOR_R, res = owned('anchor') && near;
        const { P, ph } = anchorOf(a.id, a.mm), u = THREE.MathUtils.euclideanModulo(now + ph, P) / P;
        const ang = frozen ? 0 : SWAY * Math.sin(Math.PI * u) * (1 + 0.15 * Math.sin(now * 5 + i)); // back in line once per period
        a.rings.forEach((rm, j) => {
          if (bound) M.iIM.setMatrixAt(i * 3 + j, _f.multiplyMatrices(_u, rm));
          else if (bu < 1) M.iIM.setMatrixAt(i * 3 + j, _f.multiplyMatrices(_u, rm).multiply(_r.makeTranslation(1.6 * bu, 2.2 * bu - 5 * bu * bu, 0)).multiply(_i.makeRotationZ(-5 * bu)));
          else M.iIM.setMatrixAt(i * 3 + j, ZERO);
        });
        if (res) M.res[2] = 1;
        if (frozen) _c.copy(COL.anchor).multiplyScalar(0.5 * taut);
        else if (res) _c.copy(COL.anchor).multiplyScalar(0.25 + 0.1 * Math.sin(now * 2));
        else _c.setRGB(0, 0, 0);
        if (br && !frozen && br.m.hold != null && br.start !== null) { // a timed bridge about to sink: the iron flickers out
          const left = br.start + (br.pieces.length - 1) * (br.m.stagger ?? 0) + (br.m.dur ?? 1) + br.m.hold - now;
          if (left >= 0 && left < 2.5 && Math.floor(left * (left < 0.6 ? 12 : 6)) % 2 === 0) _c.copy(COL.anchor).multiplyScalar(0.5);
        }
        for (let j = 0; j < 3; j++) M.iIM.geometry.attributes.glow.setXYZ(i * 3 + j, _c.r, _c.g, _c.b);
        // loose: four stone shards circle the slab (it flies on its own); held: they stop dead and a thin iron chain shoots up from each corner.
        // A crumble's four are the rubble in its crack; held, they stretch into the gold seam.
        const grow = bound ? 0 : sm(bu, 0.6, 1.4);
        a.orb = (a.orb ?? i) + Math.min(0.1, now - (a.tPrev ?? now)) * 0.45 * loose; a.tPrev = now;
        for (let e = 0; e < 4; e++) {
          const th = a.orb + e * Math.PI / 2 + 0.5 * Math.sin(i + e * 1.9), bob = 0.14 * loose * Math.sin(now * 1.3 + i * 1.1 + e * 2.3);
          if (a.crumble) {
            _c0.set(0.05 * Math.sin(e * 2.3 + i) * loose, 0.03 * taut - (0.06 + 0.04 * e) * loose, ((e - 1.5) / 4 + 0.06 * Math.sin(e * 1.7 + i) * loose) * SLAB.z);
            _lq.setFromEuler(_e.set((i + e * 1.7) * loose, e * 2.1 * loose, e * loose));
            M.rIM.setMatrixAt(i * 4 + e, _f.copy(_m).multiply(_r.compose(_c0, _lq, _s.set(0.3 + (0.4 + 0.12 * e) * loose, 0.3 + 0.5 * loose, 1.25 - (0.55 - 0.1 * e) * loose))));
            M.rIM.geometry.attributes.glow.setXYZ(i * 4 + e, Math.max(_c.r, GOLD.r * 1.6 * taut), Math.max(_c.g, GOLD.g * 1.6 * taut), Math.max(_c.b, GOLD.b * 1.6 * taut));
          } else {
            _c0.set(1.62 * Math.cos(th), -0.3 + bob, 1.2 * Math.sin(th)).applyMatrix4(_m);
            M.rIM.setMatrixAt(i * 4 + e, _f.compose(_c0, _lq.setFromEuler(_e.set(a.orb * 1.3 + e * 1.7, i + e * 2.1, a.orb + e)), _s.setScalar(grow * (0.75 + 0.45 * ((i * 7 + e * 5) % 4) / 3))));
            M.rIM.geometry.attributes.glow.setXYZ(i * 4 + e, _c.r, _c.g, _c.b);
          }
          const base = i * 4 * LINKS + e * LINKS;
          if (taut < 0.02) { // U19: unheld, three broken links hang off each corner (the Anchor shrine's chains): the song's own mark on its target
            _h.set(e < 2 ? -1.02 : 1.02, 0, e % 2 ? -0.64 : 0.64).applyMatrix4(_m); _lq.setFromUnitVectors(_x0, _c0.set(0, -1, 0));
            const gl = 0.1 + 0.08 * Math.sin(now * 1.3 + i);
            for (let j = 0; j < LINKS; j++) { if (j < 3) { M.lIM.setMatrixAt(base + j, _f.compose(_c0.copy(_h).setY(_h.y - (j + 0.5) * LINK_D), j % 2 ? _rq.copy(_lq).multiply(_roll) : _lq, _s.setScalar(1))); M.lIM.geometry.attributes.glow.setXYZ(base + j, COL.anchor.r * gl, COL.anchor.g * gl, COL.anchor.b * gl); } else M.lIM.setMatrixAt(base + j, ZERO); }
            continue;
          }
          _h.set(e < 2 ? -1.02 : 1.02, 0, e % 2 ? -0.64 : 0.64).applyMatrix4(_m);
          _lq.setFromUnitVectors(_x0, AXY);
          for (let j = 0; j < LINKS; j++) {
            const tip = Math.min(1, (LINKS - j) / 8); // the top links thin away into the air / the rock above
            M.lIM.setMatrixAt(base + j, _f.compose(_c0.copy(_h).addScaledVector(AXY, (j + 0.5) * LINK_D * taut), j % 2 ? _rq.copy(_lq).multiply(_roll) : _lq, _s.setScalar(taut * (0.35 + 0.65 * tip))));
            const gl = taut * tip * (0.14 + 0.26 * Math.max(0, Math.sin(now * 3.2 - j * 0.7 + e))); // a gold rune glow runs up the iron
            M.lIM.geometry.attributes.glow.setXYZ(base + j, GOLD.r * gl, GOLD.g * gl, GOLD.b * gl);
          }
        }
      });
      for (const im of [M.sIM, M.iIM, M.lIM, M.rIM]) im.instanceMatrix.needsUpdate = true;
      for (const im of [M.iIM, M.lIM, M.rIM]) im.geometry.attributes.glow.needsUpdate = true;
    }

    // name totems
    for (const t of M.totems) {
      const sw = t.sw, d = Math.hypot(p.x - sw.pos[0], p.z - sw.pos[2]), live = !sw.on && (!sw.m.after || flags[sw.m.after]);
      const res = owned('name') && live && d <= NAME_R + 9; // the bound totem stirs as the singer comes within sight of it (sung from NAME_R)
      if (res) M.res[1] = 1;
      if (sw.on && t.onAt === null) t.onAt = now;
      for (const q of t.far) q.visible = d < LOD; for (const k of t.knots) k.o.visible = d < LOD; // ponytail: distance cut for the cords (thin at range), a merged far mesh if they must read past LOD
      if (!sw.on) t.onAt = null;
      let n = 0; // right notes so far in a live call to this totem
      if (S?.song === 'name' && S.target?.id === sw.m.id) while (n < S.notes.length && S.notes[n] === t.motif[n]) n++;
      t.knots.forEach((kn, i) => {
        const o = kn.o;
        o.position.copy(kn.base); o.scale.set(1, 1, 1); o.rotation.set(0, 0, 0); kn.mat.color.copy(ROPE);
        if (t.onAt !== null) { // freed: the cords loosen, drop down the post and lie in rings round its foot
          const tt = now - t.onAt - (t.knots.length - 1 - i) * 0.12, u1 = THREE.MathUtils.clamp(tt / 0.3, 0, 1), u2 = THREE.MathUtils.clamp((tt - 0.25) / 0.5, 0, 1), e = u2 * u2;
          const wide = Math.max(1.45, (t.R0 + 0.12) / kn.R);
          o.scale.set(1 + (wide - 1) * u1, 1 - 0.3 * e, 1 + (wide - 1) * u1);
          o.position.y = THREE.MathUtils.lerp(kn.base.y, 0.07 + i * 0.06, e) + (u2 >= 1 ? 0.05 * Math.exp(-(tt - 0.75) * 9) * Math.abs(Math.sin((tt - 0.75) * 22)) : 0);
          o.position.x += 0.08 * Math.sin(kn.seed * 3) * e; o.position.z += 0.08 * Math.cos(kn.seed * 3) * e;
          o.rotation.set(0.12 * Math.sin(kn.seed * 5) * e, kn.seed * e, 0.1 * Math.cos(kn.seed * 4) * e);
          kn.mat.color.lerp(_c.set('#8f7444'), 0.5 * e); kn.mat.emissiveIntensity = 0.3 * (1 - u1);
        } else if (i < n) { // this note answered: the cord slackens and slips
          o.scale.set(1.15, 1, 1.15); o.position.y -= 0.12; o.rotation.z = 0.1;
          kn.mat.emissiveIntensity = 0.45;
        } else if (res) { // in reach: the knots shiver and glint
          o.rotation.set(0.03 * Math.sin(now * 27 + kn.seed * 2), 0, 0.045 * Math.sin(now * 31 + kn.seed));
          o.position.y += 0.015 * Math.sin(now * 43 + kn.seed);
          const g = Math.max(0, Math.sin(now * 3.2 - i * 1.1)) ** 2; kn.mat.color.lerp(_c.set('#ffe9a8'), 0.35 + 0.4 * g); kn.mat.emissiveIntensity = 0.55 + 0.6 * g;
        } else kn.mat.emissiveIntensity = 0;
      });
      const f = t.onAt === null ? 0 : THREE.MathUtils.smoothstep(now - t.onAt, 0.6, 2.0); // the carved name warms, faintly
      if (t.glyph) { t.glyph.color.lerpColors(DIM, WARM, f); t.glyph.emissiveIntensity = f * 0.12; }
      if (t.eyes) t.eyes.emissiveIntensity = f * 0.15;
    }

    // gust stones
    for (const s of M.stones) {
      s.cone.emissiveIntensity = 0.5 + 0.25 * Math.sin(now * 1.3); // U19: the same slow breath as the shrine
      const sw = s.sw, d = Math.hypot(p.x - s.pos.x, p.z - s.pos.z), pv = s.pivot;
      s.plug.visible = s.grooveO.visible = d < LOD;
      s.foot ??= pv.position.clone();
      if (!sw.dusty && s.clearT === null) { // the Gust took: the plug blows out, the boulder slides aside off the rune
        s.clearT = now;
        const from = s.from ?? [p.x, p.y, p.z];
        pv.updateWorldMatrix(true, false);
        s.dirL = _v.set(s.pos.x - from[0], 0, s.pos.z - from[2]).normalize().transformDirection(_i.copy(pv.matrixWorld).invert()).clone();
        reg.set('mech.dock', { t: ctx.game.t, pos: [s.pos.x, s.pos.y - STONE_H / 2 + 0.1, s.pos.z] }); // dust burst + thud (fx / audio)
        s.slide = pv.parent.worldToLocal(s.rest.clone()).sub(pv.parent.worldToLocal(_v.copy(s.o.position))); // pivot-parent space: from the rune's face to its rest beside it
        s.pos.set(s.rest.x, s.rest.y + STONE_H / 2, s.rest.z);
      }
      pv.position.copy(s.foot);
      if (s.clearT === null) {
        const res = owned('gust') && d <= gustReach(1) + 4, charged = res && S?.song === 'gust' && gustReach(S.charge) + 0.5 >= d;
        if (res) M.res[0] = 1;
        s.state = res ? 1 : 0;
        pv.quaternion.setFromAxisAngle(s.lean, 0.22 + (charged ? 0.012 * Math.sin(now * 40) : 0)); // leaning on the rune's face
        s.bits.forEach((b, i) => { // the plug; in reach it tugs in the draught
          const j = res ? (charged ? 0.05 : 0.025) * Math.sin(now * (9 + i % 5) + i) / s.sc : 0;
          s.plug.setMatrixAt(i, _f.compose(_a.copy(b.p).addScaledVector(b.out, j), b.q, b.s0));
        });
        s.groove.color.copy(MOSS).lerp(COL.gust, res ? 0.75 : 0); // in reach the draught lights the grooves between the plug
        s.groove.emissiveIntensity = charged ? 1.3 + 0.3 * Math.sin(now * 14) : res ? 0.9 + 0.3 * Math.sin(now * 2.2) : 0;
      } else {
        const tt = now - s.clearT, u = THREE.MathUtils.clamp(tt / 1.1, 0, 1), e = 1 - (1 - u) * (1 - u);
        s.state = 2;
        pv.position.addScaledVector(s.slide, e); // shoved aside off the rune: the carved face is bared
        const rock = -0.12 * Math.sin(Math.PI * u) - (u >= 1 ? 0.05 * Math.exp(-(tt - 1.1) * 4) * Math.sin((tt - 1.1) * 14) : 0) - 0.04 * e;
        pv.quaternion.setFromAxisAngle(_x0, 0).multiply(_q.setFromAxisAngle(AXY, 0.35 * e)).multiply(_lq.setFromAxisAngle(s.lean, 0.22 + rock));
        s.bits.forEach((b, i) => { // blown out of the grooves, tumbling, gone
          const k = Math.max(0, 1 - tt / 1.3), v = (2 + (i % 4) * 0.6) / s.sc;
          _a.copy(b.p).addScaledVector(b.out, v * 0.5 * tt).addScaledVector(s.dirL, v * tt).add(_t.set(0, (1.6 * tt - 4.9 * tt * tt) / s.sc, 0));
          s.plug.setMatrixAt(i, k > 0 ? _f.compose(_a, _lq.copy(b.q).multiply(_rq.setFromAxisAngle(_x0, tt * (6 + i))), _s.copy(b.s0).multiplyScalar(k)) : ZERO);
        });
        const f = THREE.MathUtils.smoothstep(tt, 0, 0.5);
        s.groove.color.lerpColors(MOSS, DIM, f).lerp(COL.gust, f * 0.5); // the grooves clean and sing, then settle to a soft glow
        s.groove.emissiveIntensity = 0.2 + 0.8 * Math.exp(-tt / 1.5);
      }
      s.plug.instanceMatrix.needsUpdate = true;
      pv.updateMatrixWorld(true);
      s.ventP.forEach((q, j) => s.vents[j].copy(q).applyMatrix4(pv.matrixWorld));
      s.up.set(0, 1, 0).transformDirection(pv.matrixWorld);
    }

    // song-shrines: asleep the carving is plain stone (a slow breath of its colour with the hero near); sung, it glows
    for (const s of M.shrines) {
      const d = Math.hypot(p.x - s.sw.pos[0], p.z - s.sw.pos[2]), on = !!flags[`switch.${s.sw.m.id}`];
      s.on ??= on ? -9 : null; if (on && s.on === null) s.on = now;
      const k = s.on === null ? 0 : THREE.MathUtils.smoothstep(now - s.on, 0, 1.5);
      s.mat.color.set('#6f685c').lerp(COL[s.song], 0.3 + 0.3 * k); // asleep it is already tinted: the pale sky washes a grey carving out
      // U19: asleep it still calls: a slow dim breath of its colour, seen from the route; awake a steady bright glow
      s.mat.emissiveIntensity = k ? 0.7 + 0.15 * Math.sin(now * 1.6) + 1.2 * Math.exp(-(now - s.on) / 1.2) * (s.on > 0 ? 1 : 0) : 0.5 + 0.25 * Math.sin(now * 1.3);
      const mp = s.motes.geometry.attributes.position;
      for (let i = 0; i < 12; i++) { const u = (now * 0.12 + i * 0.618) % 1, a = i * 2.4 + now * 0.4; mp.setXYZ(i, Math.cos(a) * (s.R + 0.15 + 0.3 * u), s.y0 + s.H * (0.2 + 1.7 * u), Math.sin(a) * (s.R + 0.15 + 0.3 * u)); }
      mp.needsUpdate = true; s.motes.material.opacity = k ? 0.95 : 0.75;
    }

    // enemies: the cloak seam answers a squall's telegraph (gust) and an unbindable shard (name)
    for (const e of reg.get('enemies') ?? []) {
      const d = Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
      if (e.kind === 'squall' && e.state === 'tele' && owned('gust') && d <= gustReach(1) + 2) M.res[0] = 1;
      if (e.unbindable && owned('name') && d <= NAME_R + 1) M.res[1] = 1;
    }
  },
  dispose() { M = null; },
};
