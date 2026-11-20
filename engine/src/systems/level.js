// Loads assets/levels/<id>/{level.json, world.glb, collider.glb, placement.json}.
// Publishes 'level' = {data, collide}, 'wind' (push velocity, m/s); runs mechanisms, triggers, goal.
// level.props = [{id, glb, pos, rotY, scale}] are loaded and placed (collision lives in collider.glb).
// placement.props = {glb: [[x, y, z, qx, qy, qz, qw, s], ...]}: decor GLBs drawn as one InstancedMesh per GLB mesh.
// level.sky = [{tex, pos, w}]: far castle sprites (layer 1, fog-tinted by their alpha against the painted sky in core/post.js).
// switch (rune): sung awake (hold E within SING_R, see 'player.singStart') -> flag switch.<id>, starts its targets. bridge: nodes rise from base+offset over dur,
// staggered; hidden and non-solid until started; flag raised.<id> when all are up.
// wind: box area, force m/s (x/z = position push, y = updraft acceleration, see player.js), optional cycle, active (default
// true). A switch targeting winds (a totem) toggles them each song: toggle 'onoff' (default) or 'flip' (reverse force).
// Level ramps over ~0.4 s; drifting streak/leaf particles show it; flag wind.<id> = on. Totem streamers glow when sung on.
// bridge.hold = s: a timed bridge. Up for `hold` s after its last slab settles, flickering and ticking for the last HOLD_WARN s,
// then it sinks and its rune(s) re-arm (dim, singable again). Permanent bridges (no hold) and their runes stay woken.
// platform {node, path: [offsets], mode, period, idle?}: moves along path. idle: parked at path[0] until a switch targeting it
// fires (a rune lift), then runs from that moment. mode 'once': runs the path once and stays (Orren's knot posts sinking). Flags top.<id> / bottom.<id> = at its highest / lowest offset (bot waits on them).
// after: flag (platform, wind, goal): a platform stays parked at path[0] and a wind stays off until that flag is set (npc.js talk
// `set`), then the platform runs from that moment / the wind turns on for good; a goal with `after` only counts once the flag is set.
// switch glow: false = no ground ring / floating gem (an NPC's rune: npc.js draws its own).
// crumble: shakes CRUMBLE_SHAKE m for `delay` s after first touch, falls, returns after `respawn` s.
// breakable {node, pos (bottom centre), size [w, h, d], rotY, targets?}: a cracked wall. A strike (within STRIKE_R of its face,
// inside a STRIKE_CONE cone of the heading) or a dash touching it breaks it: prop hidden, collider off, flag switch.<id> (and
// broken.<id>), its targets fire like a switch's (break the wall, release the wind), 'break' {t, id, pos, size, by} is published
// (fx.js debris, player.js refreshes the air dash). Broken stays broken.
// Gift songs (R2; R3: songs.js 'song.cast' {t, pos, heading, song, reach, target}, after its skill check; this writes c.hit / c.at):
//   gust: a reach m cone (GUST_CONE half-angle) ahead: clears the dust off a switch with dust: true (its vein shows, it can be sung;
//     flag clear.<id>) when the switch or its vein is in the cone; restarts a wind with stalled: true (a dead vane: on for good).
//   name: wakes the nearest sleeping switch with far: true within NAME_R m (2D: through a wall, across a gap, any tier), as a song would.
//   anchor: the nearest crumble slab, timed bridge (raised) or moving platform within ANCHOR_R m stands still c.hold s (frozen; songs.js ANCHOR_HOLD by charge stage).
//   A crumble with m.group freezes its whole row (every crumble of that group).
// On 'player.respawn' crumble slabs and timed bridges reset (runes, totems and breakables keep their state).
// Update order inside one 60 Hz tick (level 10 -> bot 15 -> player 20), which keeps collider changes deterministic:
//   1. level.update: moves platforms/bridges/crumbles and calls body.update(); a dash touch found here (the player's state from the
//      previous tick is 'dash' and its capsule is flush with the wall) breaks the wall now, so this tick's player sweep is clear.
//   2. player.update: a strike press resolves its target at once ('player.strike', below), but the wall breaks on 'player.strikeHit'
//      (strikeHitT later), emitted at the end of player.update after its sweep: the wall is gone from the next tick's sweep on.
//   Nothing else changes a collider mid-tick, so every sweep sees one consistent set of bodies.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { createCollision } from '../core/collide.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { LOCK_GUST, GUST_X2, LEVEL_SONG, levelEarned, rejectFeedback } from './songs.js';
import { getSave } from '../core/save.js';

let cairns = []; // checkpoint cairns: {id, mat (cairn_light clone), litT, o, inked (meshes with an ink pass up close)}
let chimes = [], chimeT = null; // wind cairns' chime rigs: {sp (its spring), mixer, ring (chime_ring action), inside}
let springs = []; // wind cairns (checkpoint.wind): {c, pos (swirl centre between the checkpoint and its cairn), top (cairn top)}; fx.js draws the swirl
let trigY = new Map(); // sim: trigger id -> ground y under it
let windClock = null; // render: the cutscene clock the wind streaks last drifted to (paused sim)
let grinding = false; // a lift/bridge slab moved this tick (audio.js grind loop)
let goal; // goal_circle materials + when it opened / the hero stepped on it (render only)
let data, mechs, winds, flags, switches, bridges, breakables, pendingBreak, breakIt, sinkReset, wakes;
const skyTex = {}; // castle sprite textures, kept across levels
const SKY_TINT = new THREE.Color('#ece6ee'); // pale lavender wash: far castles sit in the haze
const WIND_RAMP = 2.5; // level units per s
export const STREAK = new THREE.Color('#fffaf0'), STREAK2 = new THREE.Color('#d9c6a6'), LEAF = new THREE.Color('#9fb07a');
const GLOW = new THREE.Color('#e9b85a'), GOAL_DIM = new THREE.Color('#5b554b');
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
// a switch's note: semitones above A3 on a minor pentatonic (2 octaves), seeded by its id (audio.js sings it, bot.js reads it)
const PENTA = [0, 3, 5, 7, 10, 12, 15, 17, 19, 22];
export const noteOf = (id) => { let h = 2166136261; for (const c of String(id)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return PENTA[(h >>> 0) % PENTA.length]; };
const GUST_CONE = 40 * (Math.PI / 180); // reach: songs.js (gustReach, NAME_R, ANCHOR_R)
const HOLD_WARN = 1.5, SINK = 0.6, CRUMBLE_SHAKE = 0.03, STRIKE_R = 1.6, SING_R = 3, STRIKE_CONE = (100 / 2) * (Math.PI / 180), DASH_TOUCH = 0.15;

// Breakable footprint: 2D distance from (x, z) to the wall's rotated box, and the nearest point on it.
function boxDist(m, x, z) {
  const c = Math.cos(m.rotY ?? 0), s = Math.sin(m.rotY ?? 0), dx = x - m.pos[0], dz = z - m.pos[2];
  const lx = dx * c - dz * s, lz = dx * s + dz * c; // world -> wall local (rotation.y = rotY)
  const qx = THREE.MathUtils.clamp(lx, -m.size[0] / 2, m.size[0] / 2), qz = THREE.MathUtils.clamp(lz, -m.size[2] / 2, m.size[2] / 2);
  return { d: Math.hypot(lx - qx, lz - qz), x: m.pos[0] + qx * c + qz * s, z: m.pos[2] - qx * s + qz * c };
}

// Breakable look: a cracked wall per wall (fixed seed): dark branching fissures from an off-centre impact, two missing bricks (dark
// recesses with a lit lip), two bricks pulled out of the face and rubble chips at the base. Decal: layer 1 = no ink edges.
function crackedWall(vis, [w, h, d]) {
  let a = 7; const rnd = () => ((a = (a * 16807) % 2147483647) / 2147483647);
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), rows = Math.round(h / 0.55), cols = Math.max(2, Math.round(w / 0.8)), bw = S / cols, bh = S / rows;
  const brick = (r, c) => [(c - (r % 2) * 0.5) * bw, S - (r + 1) * bh, bw, bh]; // canvas rect of a brick (running bond, as kit.mjs wall())
  const mid = [1, Math.max(1, rows - 2)], gone = mid.map((r, i) => brick(r, 1 + i + (r % 2))), pulled = [[Math.min(2, rows - 1), 1], [0, cols - 1]];
  for (const [x, y, bx, by] of gone) { // missing bricks: shadowed recess, lit lower lip
    g.fillStyle = 'rgba(40,31,22,0.88)'; g.fillRect(x + 3, y + 3, bx - 6, by - 6);
    g.fillStyle = 'rgba(236,226,206,0.85)'; g.fillRect(x + 3, y + by - 8, bx - 6, 5);
  }
  g.lineCap = g.lineJoin = 'round';
  const crack = (x, y, ang, len, lw, depth) => {
    const pts = [[x, y]];
    for (let i = 0; i < 6; i++) { ang += (rnd() - 0.5) * 0.9; x += Math.cos(ang) * len / 6; y += Math.sin(ang) * len / 6; pts.push([x, y]); if (depth && rnd() < 0.35) crack(x, y, ang + (rnd() < 0.5 ? 0.8 : -0.8), len * 0.45, lw * 0.6, depth - 1); }
    for (const [dx, col, wd] of [[2.5, 'rgba(236,226,206,0.55)', lw], [0, 'rgba(24,19,14,0.95)', lw]]) { g.strokeStyle = col; g.lineWidth = wd; g.beginPath(); pts.forEach(([px, py], i) => g[i ? 'lineTo' : 'moveTo'](px + dx, py + dx)); g.stroke(); }
  };
  for (let k = 0; k < 7; k++) crack(S * 0.46, S * 0.42, (k / 7) * 6.283 + rnd() * 0.6, S * (0.34 + rnd() * 0.2), 8, 2);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const stone = vis.children.find((c) => c.isMesh), col = [0.63, 0.59, 0.54], parts = [];
  const box = (sx, sy, sz, x, y, z, rx, ry, rz, shade) => {
    const bg = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed().applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(new THREE.Euler(rx, ry, rz)), _s.set(1, 1, 1)));
    const n = bg.attributes.position.count;
    bg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).map((_, i) => col[i % 3] * shade), 3));
    bg.setAttribute('aFade', new THREE.BufferAttribute(new Uint8Array(n).fill(1), 1));
    parts.push(bg);
  };
  for (const side of [1, -1]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    m.position.set(0, h * 0.5, side * (d / 2 + 0.065)); m.rotation.y = side > 0 ? 0 : Math.PI;
    m.layers.set(1); m.name = `${vis.name}__crack`;
    vis.add(m);
    for (const [r, c] of pulled) { // a brick pulled half out of the face, slightly askew
      const [x, y, bx, by] = brick(r, c);
      box((bx / S) * w * 0.88, (by / S) * h * 0.82, 0.16, side * ((x + bx / 2) / S * w - w / 2 + 0.1), (1 - (y + by / 2) / S) * h, side * (d / 2 + 0.07), 0, 0, 0.06 * side, 1.1);
    }
    for (let i = 0; i < 9; i++) { // rubble at the foot
      const z = side * (d / 2 + 0.12 + rnd() * 0.3), sz = 0.09 + rnd() * 0.15;
      box(sz * 1.3, sz, sz * 1.1, (rnd() - 0.5) * w * 1.15, sz * 0.45, z, rnd(), rnd() * 3, rnd(), 0.8 + rnd() * 0.4);
    }
  }
  if (stone) { const m = new THREE.Mesh(mergeGeometries(parts), stone.material); m.name = `${vis.name}__rubble`; vis.add(m); }
}

function pathAt(path, mode, period, t) { // mode 'ping' = there and back, 'once' = along it once (eased in) and stay at the end, else loop
  let u = mode === 'once' ? Math.min(t / period, 1) ** 2 : (t / period) % 1;
  const pts = mode === 'ping' || mode === 'once' ? path : [...path, path[0]];
  if (mode === 'ping') u = 1 - Math.abs(1 - 2 * u);
  const f = u * (pts.length - 1), i = Math.min(Math.floor(f), pts.length - 2), k = f - i;
  return _p.fromArray(pts[i]).lerp(new THREE.Vector3().fromArray(pts[i + 1]), k);
}

// U14 platform mode 'ride': on demand. Rests at path[0]; the hero standing on it RIDE_SETTLE s sends it to the far end (period / 2 s);
// it waits there, and goes home RIDE_BACK s after he steps off (or carries him back if he steps off and on again). k.u = 0..1 along the path.
export const RIDE_SETTLE = 0.4, RIDE_BACK = 2;
export function rideStep(k, on, dt) {
  k.u ??= 0; k.dir ??= 0; k.armed ??= true;
  if (!on) k.armed = true; // one ride per boarding: step off and on again to go back
  k.onT = on ? (k.onT ?? 0) + dt : 0; k.offT = on ? 0 : (k.offT ?? 0) + dt;
  if (!k.dir && on && k.armed && k.onT >= RIDE_SETTLE) k.dir = k.u < 0.5 ? 1 : -1;
  else if (!k.dir && k.u > 0 && k.offT >= RIDE_BACK) k.dir = -1;
  if (!k.dir) return;
  k.u = Math.min(1, Math.max(0, k.u + (k.dir * dt * 2) / k.m.period));
  if (k.u === 0 || k.u === 1) { k.dir = 0; k.armed = !on; k.offT = Math.min(k.offT, 0); } // a called lift (offT < 0) waits longer
}
// wind.cycle = [on, fade, off] s: 1 for on, linear to 0 over fade, 0 for off, repeat. No cycle = always on.
export function windScale(cycle, t) {
  if (!Array.isArray(cycle) || cycle.length < 3) return 1;
  const u = t % (cycle[0] + cycle[1] + cycle[2]);
  return u < cycle[0] ? 1 : Math.max(0, 1 - (u - cycle[0]) / Math.max(cycle[1], 1e-4));
}

// Rune glyph glow: the carved wheel (ring, hub, four arrow spokes, four dots) on the stone's +Z face, as an additive decal.
// GLYPH = centre height, x offset and outer radius in prop units, measured on rune_stone.glb.
const GLYPH = { y: 0.525, x: 0.02, r: 0.175 };
let glyphTex;
export const springList = () => springs; // fx.js: wind cairns {c, pos (swirl centre), top (cairn top)}
export const wallList = () => breakables; // fx.js: dust trickle at unbroken walls
export const windState = () => winds ?? []; // audio.js: wind loops read {m, min, max, k, inside} live
export const getGlyphTex = () => (glyphTex ??= makeGlyphTexture()); // echo shards, Kamen's head rune
function makeGlyphTexture() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d'), c = S / 2, R = S * 0.36;
  g.strokeStyle = g.fillStyle = '#fff'; g.lineCap = 'round'; g.shadowColor = '#fff';
  for (const [blur, a] of [[10, 0.4], [3, 1]]) { // soft halo pass, then the crisp glyph
    g.shadowBlur = blur; g.globalAlpha = a; g.lineWidth = S * 0.035;
    g.beginPath(); g.arc(c, c, R, 0, 6.283); g.stroke();
    g.beginPath(); g.arc(c, c, R * 0.33, 0, 6.283); g.stroke();
    for (let k = 0; k < 4; k++) {
      const a0 = k * Math.PI / 2, ux = Math.cos(a0), uy = Math.sin(a0), px = -uy, py = ux;
      g.beginPath(); g.moveTo(c + ux * R * 0.33, c + uy * R * 0.33); g.lineTo(c + ux * R * 0.9, c + uy * R * 0.9); g.stroke();
      g.beginPath(); g.moveTo(c + ux * R * 0.95, c + uy * R * 0.95); g.lineTo(c + ux * R * 0.62 + px * R * 0.12, c + uy * R * 0.62 + py * R * 0.12);
      g.lineTo(c + ux * R * 0.62 - px * R * 0.12, c + uy * R * 0.62 - py * R * 0.12); g.closePath(); g.fill();
      const b = a0 + Math.PI / 4;
      g.beginPath(); g.arc(c + Math.cos(b) * R * 0.62, c + Math.sin(b) * R * 0.62, S * 0.028, 0, 6.283); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
const _ray = new THREE.Raycaster();
export function glyphDecal(prop) { // decal projected straight along the stone's facing (one triangle's normal on the rough face skewed it off the carving); layer 1 = no ink edges
  if (!prop) return null;
  getGlyphTex(); prop.updateWorldMatrix(true, true);
  const s = prop.getWorldScale(new THREE.Vector3()).x, fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(prop.getWorldQuaternion(new THREE.Quaternion()));
  const o = prop.localToWorld(new THREE.Vector3(GLYPH.x, GLYPH.y, 2));
  _ray.set(o, fwd.clone().negate());
  const hit = _ray.intersectObject(prop, true)[0];
  if (!hit?.face) return null;
  const aim = new THREE.Object3D();
  aim.position.copy(hit.point); aim.lookAt(hit.point.clone().add(fwd)); // world up keeps the glyph upright
  const w = GLYPH.r / 0.36 * s; // the texture's ring sits at 0.36 of its width: the lit ring lands on the carved one
  const m = new THREE.Mesh(new DecalGeometry(hit.object, hit.point, aim.rotation, new THREE.Vector3(w, w, 0.3 * s)),
    new THREE.MeshBasicMaterial({ map: glyphTex, color: GLOW, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -4 }));
  m.layers.set(1);
  m.name = `${prop.name}__glyph`;
  return m;
}

// Totem streamers: the cloth strips that hang off the pole (measured on wind_totem.glb: y 0.65..1.25, off-axis toward -x/-z).
function streamerGlow(prop) {
  let src = null;
  prop?.traverse((o) => { if (o.isMesh && !src) src = o; });
  if (!src) return null;
  src.updateMatrix(); // meshopt quantization moves the mesh's scale/offset onto its node: work in the parent's space
  const pos = src.geometry.attributes.position, idx = src.geometry.index, out = [], v = new THREE.Vector3();
  const at = (i) => v.fromBufferAttribute(pos, i).applyMatrix4(src.matrix);
  const inStreamer = (i) => { const { x, y, z } = at(i); return y > 0.65 && y < 1.25 && (x < -0.08 || z < -0.05); };
  for (let i = 0; i < idx.count; i += 3) {
    const k3 = [idx.getX(i), idx.getX(i + 1), idx.getX(i + 2)];
    if (k3.every(inStreamer)) k3.forEach((k) => out.push(...at(k).toArray()));
  }
  if (!out.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: GLOW, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.layers.set(1);
  m.name = `${prop.name}__streamers`;
  src.parent.add(m);
  return m;
}

// n crossed brush strokes as one InstancedMesh (unit length along +X, fat head, thin tail), layer 1 (no ink); also the wind road (cutscene.js)
export function strokeMesh(n) {
  const H = 0.02, lens = [[-0.5, 0], [-0.15, H], [0.2, H * 0.8], [0.5, 0], [0.2, -H * 0.8], [-0.15, -H]];
  const pos = [...lens.flatMap(([x, y]) => [x, y, 0]), ...lens.flatMap(([x, y]) => [x, 0, y])], fan = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];
  const both = new THREE.BufferGeometry();
  both.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  both.setIndex([...fan, ...fan.map((k) => k + 6)]);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, forceSinglePass: true, fog: false });
  const im = new THREE.InstancedMesh(both, mat, n);
  im.layers.set(1); im.frustumCulled = false;
  return im;
}

// Wind particles: one InstancedMesh of crossed brush strokes per box (pointed lens shapes; cream and warm-sand streaks so
// they read on both grass and the paper sky, some sage leaves), layer 1 (no ink).
function windFx(w, rng) {
  const size = w.max.map((v, i) => v - w.min[i]), n = THREE.MathUtils.clamp(Math.round(size[0] * size[1] * size[2] * 0.35), 24, 90);
  const im = strokeMesh(n), mat = im.material;
  im.name = `wind_${w.m.id}__fx`;
  const f = new THREE.Vector3().fromArray(w.m.force), dir = f.lengthSq() ? f.clone().normalize() : new THREE.Vector3(1, 0, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir);
  const parts = Array.from({ length: n }, (_, i) => {
    const leaf = i % 4 === 0;
    im.setColorAt(i, leaf ? LEAF : i % 2 ? STREAK : STREAK2);
    return { p: new THREE.Vector3(...w.min.map((v, k) => v + rng() * size[k])), len: leaf ? 0.14 : 0.9 + rng() * 1.1, leaf, ph: rng() * 6.28, sp: 0.7 + rng() * 0.6 };
  });
  return { im, mat, parts, q, dir, size, speed: f.length() };
}

function windStreaks(w, t, dt, cut = 0, cp = null) { // render only: q.p never feeds the sim; cut = 1: a cutscene rides it (wider, brighter strokes, read from afar)
  const fx = w.fx, rest = w.m.cycle && w.level > 0.5 ? 0.22 : 0, a = Math.max(Math.abs(w.k), rest), kk = Math.abs(w.k) >= rest ? w.k : rest; // U5: a cycling wind between gusts still breathes (faint, slow strokes): the way up stays readable
  fx.mat.opacity = (0.5 + 0.4 * cut) * a;
  fx.im.visible = a > 0.01;
  if (!fx.im.visible) return;
  fx.parts.forEach((q, i) => { // drift along the force, wrap inside the box, small cross-wobble
    q.p.addScaledVector(fx.dir, (0.8 * fx.speed + 1.5) * q.sp * kk * dt);
    for (let c = 0; c < 3; c++) q.p.setComponent(c, w.min[c] + THREE.MathUtils.euclideanModulo(q.p.getComponent(c) - w.min[c], fx.size[c]));
    _p.copy(q.p);
    if (Math.abs(fx.dir.y) > 0.7) _p.x += 0.15 * Math.sin(t * 1.9 + q.ph); else _p.y += 0.15 * Math.sin(t * 1.9 + q.ph);
    const k = cp ? THREE.MathUtils.smoothstep(_p.distanceTo(cp), 1.5, 4) : 1; // a stroke shrinks away before it can smear across the lens
    const s = (q.leaf ? 2.6 : 1.0) * (1 + 2 * cut) * k;
    fx.im.setMatrixAt(i, _m.compose(_p, fx.q, _s.set(q.len * (1 + 0.6 * cut) * k, s, s)));
  });
  fx.im.instanceMatrix.needsUpdate = true;
}

function inPoly(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++)
    if ((pts[i][1] > z) !== (pts[j][1] > z) && x < ((pts[j][0] - pts[i][0]) * (z - pts[i][1])) / (pts[j][1] - pts[i][1]) + pts[i][0]) inside = !inside;
  return inside;
}

export default {
  name: 'level', order: 10,
  async init(ctx) {
    const dir = `assets/levels/${ctx.levelId}/`;
    const [lvl, world, col, placement] = await Promise.all([
      ctx.assets.json(dir + 'level.json'), ctx.assets.gltf(dir + 'world.glb'), ctx.assets.gltf(dir + 'collider.glb'), ctx.assets.json(dir + 'placement.json'),
    ]);
    data = lvl;
    ctx.add(world.scene);
    const fadeable = (root) => root.traverse((o) => { if (o.isMesh && !o.geometry.attributes.aFade) o.geometry.setAttribute('aFade', new THREE.BufferAttribute(new Uint8Array(o.geometry.attributes.position.count).fill(1), 1)); });
    fadeable(world.scene); // look.js: camera occluder fade (islands, scatter; props and decor below too)
    const collide = createCollision({ maxSlopeDeg: 50 });
    collide.addStatic(col.scene, (n) => /^mech_/.test(n.name));

    const solidKeys = new Set(placement.solid ?? []); // optional: placement keys that block the player
    const noEdges = new Set(placement.noEdges ?? []); // optional: keys drawn on layer 1 only (color pass, no ink edges; core/post.js)
    const density = ctx.registry.get('settings')?.scatterDensity ?? 1; // render-only thinning of non-solid scatter (applies on level load)
    for (let [key, list] of Object.entries(placement.instances ?? {})) {
      if (!solidKeys.has(key) && density < 1) list = list.filter((_, i) => Math.floor((i + 1) * density) > Math.floor(i * density));
      const src = world.scene.getObjectByName(key);
      if (!src?.isMesh) { console.warn(`[level] placement '${key}' has no source mesh in world.glb`); continue; }
      const im = new THREE.InstancedMesh(src.geometry, src.material, list.length);
      src.updateMatrix(); // meshopt quantization moves the mesh's scale/offset onto its node; keep it per instance
      list.forEach((e, i) => im.setMatrixAt(i, _m.compose(_p.fromArray(e, 0), _q.fromArray(e, 3), _s.setScalar(e[7])).multiply(src.matrix)));
      im.name = `${key}__instances`;
      im.userData.src = src.matrix; // world.js wake flowers reuse scatter_flower's geometry with the same node transform
      if (solidKeys.has(key)) { // one collision copy of the source mesh per instance
        const g = new THREE.Group();
        for (let i = 0; i < list.length; i++) { const c = g.add(new THREE.Mesh(src.geometry)).children[i]; im.getMatrixAt(i, _m); _m.decompose(c.position, c.quaternion, c.scale); }
        collide.addStatic(g);
      }
      if (noEdges.has(key)) im.layers.set(1);
      src.removeFromParent();
      ctx.add(im);
    }

    const glbs = {}, load = (glb) => (glbs[glb] ??= ctx.assets.gltf(glb).then((g) => { // look.js sways only trees, the stone props stay put
      if (/wind_tree/.test(glb)) g.scene.traverse((o) => [o.material].flat().forEach((m) => m && (m.userData.sway = true)));
      fadeable(g.scene);
      return g;
    }));
    for (const [glb, list] of Object.entries(placement.props ?? {})) {
      const src = (await load(glb)).scene;
      src.updateMatrixWorld(true);
      src.traverse((o) => {
        if (!o.isMesh) return;
        const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
        list.forEach((e, i) => im.setMatrixAt(i, _m.compose(_p.fromArray(e, 0), _q.fromArray(e, 3), _s.setScalar(e[7])).multiply(o.matrixWorld)));
        im.computeBoundingSphere();
        im.name = `${glb.split('/').pop().replace('.glb', '')}__decor`;
        ctx.add(im);
      });
    }
    for (const c of data.sky ?? []) {
      skyTex[c.tex] ??= ctx.assets.arrayBuffer(c.tex).then(async (buf) => {
        const t = new THREE.Texture(await createImageBitmap(new Blob([buf]), { imageOrientation: 'flipY' }));
        t.colorSpace = THREE.SRGBColorSpace; t.flipY = false; t.needsUpdate = true;
        return t;
      });
      const tex = await skyTex[c.tex], sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color: SKY_TINT, opacity: 0.62, fog: false, depthWrite: false }));
      sp.scale.set(c.w, (c.w * tex.image.height) / tex.image.width, 1);
      sp.position.fromArray(c.pos);
      sp.layers.set(1); sp.renderOrder = -1; sp.name = 'sky_castle';
      ctx.add(sp);
    }
    for (const pr of data.props ?? []) {
      const o = (await load(pr.glb)).scene.clone();
      o.name = pr.id; o.position.fromArray(pr.pos); o.rotation.y = pr.rotY ?? 0; o.scale.setScalar(pr.scale ?? 1);
      if (pr.mesh) o.children.filter((c) => c.name !== pr.mesh).forEach((c) => c.removeFromParent()); // one mesh of a multi-mesh GLB (name_stone)
      o.userData.glb = pr.glb;
      ctx.add(o);
    }
    glyphTex ??= makeGlyphTexture();
    cairns = []; springs = []; chimes = []; trigY = new Map(); chimeT = null;
    const cairnSrc = (data.checkpoints ?? []).length ? (await load('assets/props/cairn.glb')).scene : null;
    const windG = (data.checkpoints ?? []).some((c) => c.wind) ? await load('assets/props/v2/wind_cairn.glb') : null; // wind springs: a chime cairn
    const cairnH = cairnSrc ? new THREE.Box3().setFromObject(cairnSrc).max.y : 0;
    const windH = windG ? new THREE.Box3().setFromObject(windG.scene.getObjectByName('cairn_light')).max.y : 0;
    for (const c of data.checkpoints ?? []) { // a small cairn beside each checkpoint (off the route, on solid ground); its light stone glows once reached
      const h = c.heading ?? data.spawn.heading, gy = c.pos[1] - 0.6;
      const side = [1, -1].map((sd) => [c.pos[0] + Math.cos(h) * 1.9 * sd, c.pos[2] - Math.sin(h) * 1.9 * sd])
        .map(([x, z]) => ({ x, z, g: collide.groundAt(x, z, gy + 1.5) })).find((q) => q.g && Math.abs(q.g.y - gy) < 0.6);
      if (c.wind) { // wind spring: the swirl, grass ring and ribbon are fx.js sprites (reads springList), wind-chime (audio.js), refill (player.js)
        const ctr = side ? [(c.pos[0] + side.x) / 2, side.g.y, (c.pos[2] + side.z) / 2] : [c.pos[0], gy, c.pos[2]];
        springs.push({ c, pos: ctr, top: side ? [side.x, side.g.y + windH, side.z] : [ctr[0], ctr[1] + windH, ctr[2]] });
      }
      if (!side) continue;
      const o = c.wind ? cloneSkinned(windG.scene) : cairnSrc.clone(), small = [], inked = []; let mat = null;
      o.traverse((m) => {
        if (!m.isMesh) return;
        if (m.material?.name === 'cairn_light') { m.material = mat = m.material.clone(); mat.emissive = GLOW.clone(); mat.emissiveIntensity = 0.05; }
        if (c.wind && m.name !== 'cairn') { m.layers.set(1); small.push(m); } // chimes, post, light: small, no ink pass
        else inked.push(m);
      });
      if (c.wind) { // chimes sway in the wind; ring when the hero steps into the spring (refill)
        const mixer = new THREE.AnimationMixer(o), clip = (n) => mixer.clipAction(windG.animations.find((a) => a.name === n));
        clip('chime_idle').play();
        chimes.push({ sp: springs[springs.length - 1], o, small, mixer, ring: clip('chime_ring').setLoop(THREE.LoopOnce, 1), inside: false });
      }
      o.position.set(side.x, side.g.y, side.z); o.rotation.y = h; o.name = `cairn_${c.id}`;
      ctx.add(o);
      if (mat) cairns.push({ id: c.id, mat, litT: null, o, inked });
    }

    mechs = []; winds = []; switches = []; bridges = {}; breakables = []; pendingBreak = null; wakes = []; grinding = false;
    ctx.registry.set('wakes', wakes); // [{id, pos, t}] runes woken, in order (world.js grass wave)
    for (const m of data.mechanisms ?? []) {
      if (m.kind === 'wind') {
        if (m.area?.kind !== 'box') { console.warn(`[level] wind ${m.id}: area kind '${m.area?.kind}' not supported, ignored`); continue; }
        const w = { m, min: m.area.min, max: m.area.max, inside: false, pushed: 0, on: m.active !== false, sign: 1 };
        w.level = w.on ? 1 : 0;
        w.fx = windFx(w, ctx.rng);
        ctx.add(w.fx.im);
        winds.push(w);
        continue;
      }
      if (m.kind === 'switch') {
        const pos = m.pos ?? ctx.scene.getObjectByName(m.node)?.position.toArray();
        if (!pos) { console.warn(`[level] switch ${m.id}: no pos and node '${m.node}' missing`); continue; }
        const totem = (m.targets ?? []).some((id) => data.mechanisms.find((x) => x.id === id)?.kind === 'wind');
        const prop = ctx.scene.getObjectByName(m.node);
        let glyph = null, streamers = null;
        if (totem) streamers = streamerGlow(prop); // the streamers are the light
        else if (/rune_stone/.test(prop?.userData.glb) && (glyph = glyphDecal(prop))) ctx.add(glyph); // name stones / stakes carry their own glyph (npc.js)
        let stone = null;
        if (m.dust && prop) { // the gust boulder marks.js draws is solid: before the carved face, then (blown aside) beside the rune. A 1.5 x 2.1 x 1.1 box (unit box, scaled) until marks.js fits it to the boulder it draws
          const yaw = new THREE.Euler().setFromQuaternion(prop.getWorldQuaternion(new THREE.Quaternion()), 'YXZ').y, sx = Math.cos(yaw), sz = -Math.sin(yaw), ox = Math.sin(yaw), oz = Math.cos(yaw);
          const node = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)); node.scale.set(1.5, 2.1, 1.1); node.rotation.y = yaw; node.position.set(pos[0] + ox * 0.8, pos[1] + 1.05, pos[2] + oz * 0.8); node.updateMatrixWorld(true);
          const rest = [1, -1].map((sd) => [pos[0] + sx * 1.1 * sd + ox * 0.2, pos[2] + sz * 1.1 * sd + oz * 0.2]); // marks.js picks the side with ground the same way
          stone = { node, body: collide.addBody(node), rest: rest.find(([x, z]) => Math.abs((collide.groundAt(x, z, pos[1] + 1.5)?.y ?? 1e9) - pos[1]) < 0.6) ?? rest[0] };
        }
        switches.push({ m, pos, glyph, streamers, stone, on: false, dusty: !!m.dust });
        continue;
      }
      if (m.kind === 'bridge') {
        const br = bridges[m.id] = { m, start: null, done: false, pieces: [] };
        (m.nodes ?? []).forEach((name, i) => {
          const vis = world.scene.getObjectByName(name);
          if (!vis) return console.warn(`[level] bridge ${m.id}: node '${name}' missing`);
          const node = col.scene.getObjectByName(name) ?? vis.clone();
          const k = { m, br, i, vis, node, body: collide.addBody(node), base: vis.position.clone(), colBase: node.position.clone(), prev: new THREE.Vector3(), cur: new THREE.Vector3() };
          k.cur.copy(k.base).add(_p.fromArray(m.offset ?? [0, -5, 0])); k.prev.copy(k.cur);
          node.position.copy(k.colBase).add(_p);
          vis.visible = k.body.enabled = false;
          k.body.update();
          br.pieces.push(k); mechs.push(k);
        });
        continue;
      }
      if (m.kind === 'breakable') {
        const vis = world.scene.getObjectByName(m.node);
        if (!vis || !m.pos || !m.size) { console.warn(`[level] breakable ${m.id}: node '${m.node}', pos or size missing`); continue; }
        crackedWall(vis, m.size);
        breakables.push({ m, vis, body: collide.addBody(col.scene.getObjectByName(m.node) ?? vis.clone()), on: false });
        continue;
      }
      if (m.kind !== 'platform' && m.kind !== 'crumble') { console.warn(`[level] mechanism kind '${m.kind}' (${m.id}) not supported, ignored`); continue; }
      const vis = world.scene.getObjectByName(m.node) ?? ctx.scene.getObjectByName(m.node); // or a level prop (gen_l3 knot posts)
      if (!vis) { console.warn(`[level] mechanism ${m.id}: node '${m.node}' missing`); continue; }
      const node = col.scene.getObjectByName(m.node) ?? vis.clone();
      mechs.push({ m, vis, node, body: collide.addBody(node), base: vis.position.clone(), colBase: node.position.clone(), prev: vis.position.clone(), cur: vis.position.clone(), timer: -1 });
    }

    const g = data.goal, gc = (await load('assets/props/goal_circle.glb')).scene.clone(); // render only, no collider (0.15 m tall)
    goal = { rune: null, core: null, openT: null, onT: null };
    gc.traverse((o) => {
      if (/^goal_(rune|core)$/.test(o.material?.name)) o.layers.set(1); // colour pass only (no ink pass draw: the draw budget); the stone base inks them
      if (o.material?.name === 'goal_rune') o.material = goal.rune = new THREE.MeshBasicMaterial({ color: GOAL_DIM.clone() }); // 8 notches: dim until the goal opens
      else if (o.material?.name === 'goal_core') { o.material = goal.core = o.material.clone(); goal.core.emissive = GLOW.clone(); goal.core.emissiveIntensity = 0; }
    });
    gc.position.set(g.pos[0], g.pos[1] - 0.1, g.pos[2]); gc.scale.setScalar((g.r * 2) / 2.46); gc.name = 'goal_circle';
    ctx.add(gc);

    // R3: no vein trails (m.vein is only the Gust's dust path now); a switch and its target share a carved motif (marks.js)

    const level = { data, collide, targets: { switches, mechs, bridges, winds }, flowers: placement.instances?.scatter_flower ?? [], tufts: placement.instances?.scatter_tuft ?? [] }; // flowers: fx.js petals when dashing through them; tufts: world.js wake flowers
    sinkReset = (br) => { // timed bridge back down: hidden, non-solid, its runes re-armed
      br.start = null; br.done = false; br.tick = null;
      for (const k of br.pieces) { k.cur.copy(k.base).add(_p.fromArray(k.m.offset ?? [0, -5, 0])); k.prev.copy(k.cur); k.node.position.copy(k.colBase).add(_p); k.vis.visible = k.body.enabled = false; k.body.update(); }
      flags[`raised.${br.m.id}`] = false;
      for (const sw of switches) if (sw.m.targets?.includes(br.m.id)) { sw.on = false; flags[`switch.${sw.m.id}`] = false; }
      ctx.registry.set('flags', flags);
    };
    flags = {};
    for (const w of winds) flags[`wind.${w.m.id}`] = w.on;
    // NPC gifts (player.js reads gift.*): only what was earned (U25: no free gifts): the save's gifts (hud.js / engine.js, ?gifts=a,b in
    // tests), the song and NPC gifts of every earlier level already completed (a pre-U25 save got them from startGifts; a New journey keeps `best`), or all (?gifts=all / settings)
    const LV = Object.keys(LEVEL_SONG), done = LV.slice(0, Math.max(0, LV.indexOf(data.id))).filter((lv) => getSave().best[lv] != null).flatMap(levelEarned); // U25: its song and its NPC gifts
    const gifts = ctx.registry.get('settings')?.allGifts ? ['dash', 'windbreath', 'airdash', 'gust', 'name', 'anchor'] : [...(ctx.registry.get('gifts.known') ?? []), ...done];
    for (const g of gifts) flags[`gift.${g}`] = true;
    ctx.registry.set('flags', flags);
    const fire = (sw, t) => {
      sw.on = sw.m.once !== false || !sw.on; // re-singable switches (totems) toggle
      flags[`switch.${sw.m.id}`] = sw.on;
      const song = sw.m.gift; // U18 song-shrine: sung to, the stone answers with its song (fx / audio 'shrine.answer') and gives it: the same 'gift' an NPC's is (threads, save)
      if (song && sw.on) { // U19: a song already known still wakes the stone (it sings back), it only has nothing left to give
        const had = flags[`gift.${song}`]; flags[`gift.${song}`] = true;
        if (t >= 0) ctx.registry.set('shrine.answer', { t, song, pos: sw.pos });
        if (t >= 0 && !had) { ctx.registry.set('gift', { t: t + 1.6, id: song, npc: null, from: [sw.pos[0], sw.pos[1] + 1.6, sw.pos[2]] }); ctx.registry.set('audio.cue', { name: 'gift', at: 1.95 }); }
      }
      let cue = 'rune', stones = false;
      for (const id of sw.m.targets ?? []) {
        const w = winds.find((x) => x.m.id === id);
        const lift = mechs.find((k) => k.m.id === id && k.m.kind === 'platform');
        if (bridges[id]) { stones ||= bridges[id].start === null; bridges[id].start ??= t; if (sw.m.shortcut) bridges[id].pin = true; } // U14: a shortcut rune holds a timed bridge up for good
        else if (lift) { stones ||= lift.start === undefined; lift.start ??= t; if (lift.m.mode === 'ride' && sw.m.shortcut && !lift.dir && !lift.u) { lift.dir = 1; lift.offT = -6; } } // U14: a call rune brings the lift up to the singer (it waits 8 s)
        else if (w) {
          cue = 'wind';
          if (sw.m.toggle === 'flip') w.sign = -w.sign; else w.on = !w.on;
          if (t < 0) w.level = w.on ? w.sign : 0; // fixed shots: already settled
          flags[`wind.${id}`] = w.on;
        } else console.warn(`[level] switch ${sw.m.id}: target '${id}' is not a bridge or wind`);
      }
      if (sw.on && (sw.glyph || sw.streamers) && !sw.woke) { // a rune wakes for good: the Keepers' hum, the grass wave and the wisps start from here
        sw.woke = true;
        wakes.push({ id: sw.m.id, pos: new THREE.Vector3(...sw.pos), t });
        if (t >= 0) ctx.registry.set('audio.cue', { name: 'hum', at: 0.25 });
        if (t >= 0) ctx.registry.set('wake', wakes[wakes.length - 1]); // fx.js: fled birds return
      }
      ctx.registry.set('flags', flags);
      ctx.registry.set('audio.cue', { name: cue, at: 0.05 }); // staggered after the strike swing (0), breath_in (0.1), hum (0.25), stones (0.3): no one-frame pile-up
      if (stones && t >= 0) ctx.registry.set('audio.cue', { name: 'stones', at: 0.3 });
      return stones;
    };
    const reg = ctx.registry;
    breakIt = (b, t, by) => {
      b.vis.visible = b.body.enabled = false;
      flags[`broken.${b.m.id}`] = true;
      if (b.m.targets?.length) fire(b, t); else { b.on = flags[`switch.${b.m.id}`] = true; reg.set('flags', flags); }
      reg.set('audio.cue', { name: 'crack' });
      reg.set('break', { t, id: b.m.id, pos: [b.m.pos[0], b.m.pos[1] + b.m.size[1] / 2, b.m.pos[2]], size: b.m.size, rotY: b.m.rotY ?? 0, by });
    };
    // Singing (player.js): the press picks the nearest switch a song can wake: within SING_R m (2D), same tier (no rune woken from an
    // island below it), not woken for good -> 'sing.target' {t, id, note, pos} (audio.js sings its note, fx.js traces the glyph), or
    // {t, id: null} (a song into the air). Held singTime s ('player.sing'): it fires as a strike once did -> 'sing.done' {t, id, ok,
    // wrong, stones}; ok false: nothing in reach, or (wrong) a rune of a sequence (seq: group id, order: 1..n) sung out of turn: the
    // group dims again. Only the last rune of a sequence carries its targets. Strikes only break walls (and fire their targets).
    let singing = null, bound = null, dull = null; // dull (U25): a dust-choked rune in reach, sung plain: it refuses (no silent runes); bound (U12): the rune in reach still wrapped by its order (sw.lock, see update)
    reg.on('song.reject', ({ t, id, half }) => { const sw = half && switches.find((q) => q.m.id === id); if (sw) sw.halfT = t; }); // U25: right song, condition unmet: the glyph half-lights and fades
    reg.on('player.singStart', ({ t, pos }) => {
      let best = Infinity, dullD = Infinity; singing = dull = null;
      for (const sw of switches) {
        const d = Math.hypot(pos[0] - sw.pos[0], pos[2] - sw.pos[2]);
        if (sw.dusty && !sw.lock && !sw.on && d <= SING_R && d < dullD && Math.abs(pos[1] - sw.pos[1]) <= 2.5) { dull = sw; dullD = d; } // U25: the nearest dusty rune
        if (sw.on && sw.m.once !== false || (sw.dusty && !sw.lock) || d > SING_R || Math.abs(pos[1] - sw.pos[1]) > 2.5 || d >= best) continue;
        best = d; singing = sw;
      }
      bound = singing?.lock ? singing : null; if (bound) singing = null;
      reg.set('sing.target', { t, id: singing?.m.id ?? null, note: singing ? noteOf(singing.m.id) : null, pos: singing?.pos ?? null });
    });
    reg.on('player.sing', ({ t }) => {
      const sw = singing; singing = null;
      if (bound) { reg.set('song.reject', { t, id: bound.m.id, pos: bound.pos }); bound = null; } // its whirl flares and shoves the singer back, a dull note (fx / audio / enemies.js)
      else if (!sw && dull) rejectFeedback({ id: dull.m.id, pos: dull.pos, motif: 'boulder' }, null); // U25: dust on it: a dull thud, the motif pulses
      let ok = !!sw, wrong = false, stones = false;
      if (sw?.m.seq) {
        const grp = switches.filter((w) => w.m.seq === sw.m.seq), next = grp.filter((w) => w.on).length + 1;
        if (sw.m.order !== next) { // R4 wrong note: the pair dims, any timed bridge standing sinks (enemies.js wakes the knot sleeping on the rune)
          ok = false; wrong = true; for (const w of grp) w.on = flags[`switch.${w.m.id}`] = false; reg.set('flags', flags);
          for (const br of Object.values(bridges)) if (br.m.hold != null && !br.pin && br.start !== null) sinkReset(br);
        }
        else if (next < grp.length) { sw.on = flags[`switch.${sw.m.id}`] = true; reg.set('flags', flags); reg.set('audio.cue', { name: 'rune', at: 0.05 }); }
        else stones = fire(sw, t);
      } else if (sw) stones = fire(sw, t);
      reg.set('sing.done', { t, id: sw?.m.id ?? null, ok, wrong, stones, note: sw ? noteOf(sw.m.id) : null });
    });
    reg.on('player.singEnd', () => { singing = bound = dull = null; });
    reg.on('song.cast', (c) => { // songs.js: a song that took its skill check (gust charge, name rhythm, anchor timing)
      const { t, pos, heading, song, reach, target } = c;
      let hit = null, at = null;
      const flat = (q) => Math.hypot(q[0] - pos[0], q[2] - pos[2]);
      if (song === 'gust') {
        const inCone = (q, r = reach) => { const d = flat(q), off = Math.atan2(q[0] - pos[0], q[2] - pos[2]) - heading; return Math.abs(q[1] - pos[1]) < 3 && d <= r && (d < 0.5 || Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) <= GUST_CONE); };
        for (const sw of switches) {
          if (!sw.dusty) continue;
          const v = [sw.pos, ...(sw.m.vein ?? [])], pts = [sw.pos];
          for (let i = 1; i < v.length; i++) for (let s = 0, L = Math.hypot(v[i][0] - v[i - 1][0], v[i][2] - v[i - 1][2]); s <= L; s += 0.5) pts.push(v[i - 1].map((c, j) => c + (v[i][j] - c) * (s / (L || 1))));
          const q = pts.find((p) => inCone(p, sw.m.lock ? Math.min(reach, LOCK_GUST * (flags['song2.gust'] ? GUST_X2 : 1)) : reach)); // an R6 lock rune: the plain reach only, a charge does not stand in for Gust II (tools/lib/r6.mjs)
          if (!q) continue;
          sw.dusty = false; flags[`clear.${sw.m.id}`] = true; hit ??= sw.m.id; at ??= q;
          if (sw.stone) { sw.stone.node.position.x = sw.stone.rest[0]; sw.stone.node.position.z = sw.stone.rest[1]; sw.stone.body.update(); sw.stone.body.delta.identity(); }
        }
        for (const w of winds) {
          if (!w.m.stalled || w.on) continue;
          const q = [0, 1, 2].map((i) => THREE.MathUtils.clamp(pos[i] + (i === 1 ? 1 : 0), w.min[i], w.max[i]));
          if (!inCone(q)) continue;
          w.on = w.woke = flags[`wind.${w.m.id}`] = true; hit ??= w.m.id; at ??= q;
          reg.set('audio.cue', { name: 'wind', at: 0.1 });
        }
        if (hit) reg.set('flags', flags);
      } else if (song === 'name') {
        if (target?.kind === 'switch') {
          fire(target.o, t); hit = target.id; at = target.pos;
          if (target.m.menhir) { target.o.on = false; reg.set('trial.creak', { t, pos: target.pos, n: 6 }); } // only a rock: a little dust, sing it again (meta.js counts)
        }
      } else if (song === 'anchor' && target && target.kind !== 'enemy') {
        const tgt = target.o;
        for (const k of tgt.m.group ? mechs.filter((k) => k.m.kind === 'crumble' && k.m.group === tgt.m.group) : [tgt]) k.frozen = t + c.hold;
        hit = tgt.m.id; at = target.pos; reg.set('audio.cue', { name: 'stones', at: 0.05 });
      }
      c.hit ??= hit; c.at ??= at;
    });
    // a strike breaks the wall in STRIKE_R of its face, inside STRIKE_CONE of the heading: 'strike.target' = {t, id} of that wall, or
    // {t, id: null} on a miss (fx.js reads it). The wall breaks on the swing's hit ('player.strikeHit'), see the update order above.
    reg.on('player.strike', ({ pos, heading }) => {
      let best = Infinity, hit = { t: ctx.game.t, id: null, stones: false };
      pendingBreak = null;
      for (const b of breakables) {
        if (b.on || pos[1] < b.m.pos[1] - 1 || pos[1] > b.m.pos[1] + b.m.size[1]) continue;
        const n = boxDist(b.m, pos[0], pos[2]), off = Math.atan2(n.x - pos[0], n.z - pos[2]) - heading;
        if (n.d > STRIKE_R || (n.d > 0.05 && Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > STRIKE_CONE) || n.d >= best) continue;
        best = n.d; hit = { t: ctx.game.t, id: b.m.id, stones: false }; pendingBreak = b;
      }
      reg.set('strike.target', hit);
    });
    reg.on('checkpoint', (cp) => { const c = cairns.find((q) => q.id === cp?.id); if (c && c.litT === null) c.litT = ctx.game.t; });
    reg.on('player.strikeHit', ({ t }) => { if (pendingBreak && !pendingBreak.on) breakIt(pendingBreak, t, 'strike'); pendingBreak = null; });
    reg.on('player.respawn', () => { // crumble slabs and timed bridges reset; woken runes, totems and broken walls stay
      for (const k of mechs) if (k.m.kind === 'crumble') { k.timer = -1; k.cur.copy(k.base); k.prev.copy(k.base); k.vis.visible = k.body.enabled = true; k.node.position.copy(k.colBase); k.body.update(); }
      for (const br of Object.values(bridges)) if (br.m.hold != null && !br.pin && br.start !== null) sinkReset(br);
    });
    const shot = data.shots?.find((s) => s.name === ctx.params.get('shot')); // fixed shots can show mechanisms already done
    for (const id of shot?.fire ?? []) { const sw = switches.find((w) => w.m.id === id); if (sw) fire(sw, -100); }
    reg.on('cut.wind', (id) => { const w = winds.find((x) => x.m.id === id); if (w) { w.on = w.woke = flags[`wind.${id}`] = true; w.level = w.sign; w.k = w.level; } }); // cutscene.js: awake at once
    reg.on('cut.fire', (id) => { const sw = switches.find((w) => w.m.id === id); if (sw && !sw.on) fire(sw, -100); }); // cutscene.js events: shown settled
    ctx.registry.set('wind', new THREE.Vector3());
    reg.set('level', level);
  },
  update(ctx, dt) {
    const reg = ctx.registry, t = ctx.game.t + dt, player = reg.get('player');
    let moving = false;
    // U12 one lock for every order-gated rune: sw.lock = the flag it waits for (m.after unmet, or the rune before it in its sequence
    // still asleep), null when free. The moment it frees: 'rune.unlock' {t, id, pos, from} (from = where the waking came from; fx.js
    // sends a gold thread from there and unravels the whirl). Sung while locked: 'song.reject'.
    for (const sw of switches) {
      const prev = sw.m.seq && sw.m.order > 1 ? switches.find((w) => w.m.seq === sw.m.seq && w.m.order === sw.m.order - 1) : null;
      const by = sw.on ? null : sw.m.after && !flags[sw.m.after] ? sw.m.after : prev && !prev.on ? `switch.${prev.m.id}` : null;
      if (sw.lock && !by && !sw.on) {
        const [kind, id] = sw.lock.split('.');
        const from = kind === 'switch' ? switches.find((w) => w.m.id === id)?.pos : reg.get('enemies')?.find((e) => e.id === id)?.pos.toArray();
        reg.set('rune.unlock', { t, id: sw.m.id, pos: sw.pos, from: from ?? null });
      }
      sw.lock = by;
    }
    for (const br of Object.values(bridges)) if (br.frozen > t && br.start !== null) br.start += dt; // anchored: the timer holds
    for (const k of mechs) {
      k.prev.copy(k.cur);
      if (k.m.kind === 'platform' && k.frozen > t && !((k.m.idle || k.m.after) && k.start === undefined)) k.start = (k.start ?? 0) + dt;
      if (k.m.kind === 'platform') {
        const ride = k.m.mode === 'ride', on = player?.groundBody === k.body;
        if (k.m.after && k.start === undefined && flags[k.m.after] && (ride || !k.m.ride || on)) k.start = t; // ride: waits for the hero on it
        const asleep = (k.m.idle || k.m.after) && k.start === undefined;
        if (ride && !asleep && !(k.frozen > t)) rideStep(k, on, dt);
        const off = asleep ? _s.fromArray(k.m.path[0]) : ride ? pathAt(k.m.path, 'ping', 2, k.u ?? 0) : pathAt(k.m.path, k.m.mode, k.m.period, t - (k.start ?? 0));
        k.cur.copy(k.base).add(off);
        k.node.position.copy(k.colBase).add(off);
        const ys = k.m.path.map((q) => q[1]), top = off.y >= Math.max(...ys) - 0.01, bottom = off.y <= Math.min(...ys) + 0.01;
        const moved = k.cur.distanceTo(k.prev);
        if (k.m.id === 'golem') { // Kamen's footfalls: a thud every ~1.1 m walked, heard near the player only
          k.walk = (k.walk ?? 0) + moved;
          if (k.walk >= 1.1) { k.walk = 0; if (player && player.pos.distanceTo(k.cur) < 22) reg.set('golem.step', { t, pos: k.cur.toArray() }); }
        } else if (moved > 1e-4) moving = true;
        if (flags[`top.${k.m.id}`] !== top || flags[`bottom.${k.m.id}`] !== bottom) {
          if ((top && flags[`top.${k.m.id}`] === false) || (bottom && flags[`bottom.${k.m.id}`] === false)) reg.set('mech.dock', { t, pos: k.cur.toArray() }); // arrived: dust + thud
          flags[`top.${k.m.id}`] = top; flags[`bottom.${k.m.id}`] = bottom; reg.set('flags', flags);
        }
      } else if (k.m.kind === 'bridge') {
        if (k.br.start === null) continue;
        let u = THREE.MathUtils.clamp((t - k.br.start - k.i * (k.m.stagger ?? 0)) / (k.m.dur ?? 1), 0, 1);
        const left = k.m.hold != null && !k.br.pin ? k.br.start + (k.br.pieces.length - 1) * (k.m.stagger ?? 0) + (k.m.dur ?? 1) + k.m.hold - t : Infinity; // timed: s until it sinks
        if (left < 0) u = Math.min(u, Math.max(0, 1 + left / SINK));
        const off = _s.fromArray(k.m.offset ?? [0, -5, 0]).multiplyScalar((1 - u) ** 3);
        k.cur.copy(k.base).add(off);
        k.node.position.copy(k.colBase).add(off);
        k.vis.visible = k.body.enabled = u > 0;
        if (u > 0 && u < 1) moving = true;
        const warn = left >= 0 && left < HOLD_WARN, blink = warn && Math.floor(left * (left < 0.6 ? 12 : 6)) % 2 === 0; // flicker, faster near the end
        if (warn) k.cur.y += 0.02 * Math.sin(t * 50 + k.i); // shudder (visual only)
      } else { // crumble: shakes for `delay` s after first touch, drops, returns after `respawn` s
        if (k.timer < 0 && player?.groundBody === k.body) { k.timer = 0; reg.set('crumble.warn', { t, pos: k.cur.toArray() }); }
        if (k.timer >= 0) {
          if (!(k.frozen > t)) k.timer += dt;
          const fall = k.timer - k.m.delay, gone = fall >= 0 && fall < k.m.respawn;
          k.body.enabled = !gone;
          k.cur.copy(k.base);
          if (fall < 0) k.cur.add(_s.set(CRUMBLE_SHAKE * Math.sin(t * 71), 0, CRUMBLE_SHAKE * Math.cos(t * 53))); // telegraph (visual only)
          else if (gone) k.cur.y -= 4.9 * fall * fall; // drops away; hidden once well below
          k.vis.visible = !gone || fall < 0.7;
          if (fall >= k.m.respawn) k.timer = -1;
        }
      }
      k.body.update();
    }
    if (moving !== grinding) reg.set('mech.grind', (grinding = moving));
    for (const br of Object.values(bridges)) {
      if (br.start === null) continue;
      const up = br.start + (br.pieces.length - 1) * (br.m.stagger ?? 0) + (br.m.dur ?? 1);
      if (br.m.hold != null && !br.pin) {
        const left = up + br.m.hold - t;
        if (left < -SINK) { sinkReset(br); continue; }
        const tick = left >= 0 && left < HOLD_WARN ? Math.ceil(left / 0.5) : null; // three ticks: 1.5, 1.0, 0.5 s left
        if (tick !== null && tick !== br.tick) reg.set('audio.cue', { name: 'tick' });
        br.tick = tick;
      }
      if (br.done || t < up) continue;
      br.done = true;
      flags[`raised.${br.m.id}`] = true;
      reg.set('flags', flags);
    }
    if (player?.state === 'dash') for (const b of breakables) { // dash touch (state from the previous tick: see the update order above)
      if (!b.on && player.pos.y > b.m.pos[1] - 1 && player.pos.y < b.m.pos[1] + b.m.size[1] && boxDist(b.m, player.pos.x, player.pos.z).d <= player.tuning.radius + DASH_TOUCH) breakIt(b, t, 'dash');
    }
    for (const sw of switches) { // slow dim pulse until sung awake, then steady gold
      const k = 0.5 + 0.5 * Math.sin(t * 1.6);
      const half = sw.halfT == null ? 0 : 0.5 * Math.max(0, 1 - (t - sw.halfT) / 1.6); // U25 half-light: up to 0.5 over the idle pulse, gone in 1.6 s
      if (sw.glyph) sw.glyph.material.opacity = sw.on ? 0.9 : Math.max(half, sw.dusty ? 0.06 : 0.15 + 0.4 * k);
      if (sw.streamers) sw.streamers.material.opacity = sw.on ? 0.7 : 0.15 + 0.4 * k;
    }
    for (const w of winds) {
      if (w.m.after && !w.woke && flags[w.m.after]) { w.woke = w.on = flags[`wind.${w.m.id}`] = true; reg.set('flags', flags); reg.set('audio.cue', { name: 'wind' }); }
      w.level += THREE.MathUtils.clamp((w.on ? w.sign : 0) - w.level, -WIND_RAMP * dt, WIND_RAMP * dt);
      w.k = windScale(w.m.cycle, t) * w.level;
      windStreaks(w, t, dt, 0, ctx.camera.position);
    }
    if (!player) return;
    const [x, y, z] = player.pos.toArray();
    const push = reg.get('wind').set(0, 0, 0);
    for (const w of winds) { // box test at hip height (feet + 0.5)
      const inside = [x, y + 0.5, z].every((v, i) => v >= w.min[i] && v <= w.max[i]);
      if (inside) {
        const k = w.k;
        push.x += w.m.force[0] * k; push.y += w.m.force[1] * k; push.z += w.m.force[2] * k;
        w.pushed += Math.hypot(...w.m.force) * Math.abs(k) * dt;
      } else if (w.inside) { reg.set('wind.exit', { id: w.m.id, pushed: +w.pushed.toFixed(2) }); w.pushed = 0; }
      w.inside = inside;
    }
    for (const tr of data.triggers ?? []) {
      if ((tr.once !== false && flags[`seen.${tr.id}`]) || (tr.ifFlag && !flags[tr.ifFlag]) || (tr.ifNot && flags[tr.ifNot])) continue;
      if (tr.shape?.kind !== 'poly' || !inPoly(x, z, tr.shape.pts)) continue;
      if (!trigY.has(tr.id)) { // ground under the poly (centroid, then corners): a trigger only fires within 3 m of it, never from the void below
        const pts = tr.shape.pts, cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cz = pts.reduce((a, q) => a + q[1], 0) / pts.length;
        trigY.set(tr.id, [[cx, cz], ...pts].map(([qx, qz]) => reg.get('level').collide.groundAt(qx, qz, 300)).find(Boolean)?.y ?? null);
      }
      const ty = trigY.get(tr.id);
      if (ty !== null && Math.abs(y - ty) >= 3) continue;
      flags[`seen.${tr.id}`] = true;
      if (tr.teaches) flags[tr.teaches] = true;
      reg.set('flags', flags);
      if (tr.hint) reg.set('hud.hint', tr.hint);
      reg.set('trigger', { id: tr.id, t });
    }
    let spring = null;
    for (const c of data.checkpoints ?? []) { // entering the sphere makes it the respawn point (no refill: player.js snapshots breath); a wind cairn's sphere is its spring
      if (Math.hypot(x - c.pos[0], y - c.pos[1], z - c.pos[2]) > c.r) continue;
      if (reg.get('checkpoint')?.id !== c.id) reg.set('checkpoint', { id: c.id, pos: c.pos, heading: c.heading ?? data.spawn.heading });
      if (c.wind) spring = springs.find((q) => q.c === c) ?? { pos: c.pos };
    }
    if ((reg.get('spring') ?? null) !== spring) reg.set('spring', spring); // player.js refills at the wind rate inside it; fx.js threads, audio.js
    const g = data.goal, open = !g.after || !!flags[g.after], on = Math.hypot(x - g.pos[0], z - g.pos[2]) <= g.r && Math.abs(y - g.pos[1]) < 2;
    if (open && goal.openT === null) goal.openT = t;
    if (on !== (goal.onT !== null)) goal.onT = on ? t : null;
    if (!reg.get('end') && open && on) reg.set('end', 'goal');
  },
  beforeRender(ctx, alpha) {
    for (const k of mechs) k.vis.position.lerpVectors(k.prev, k.cur, alpha);
    const cw = ctx.registry.get('cut.active') && ctx.registry.get('cut.world')?.clock; // a cutscene pauses the sim: wind streaks drift on its clock
    if (cw != null && windClock != null) for (const w of winds) windStreaks(w, cw, THREE.MathUtils.clamp(cw - windClock, 0, 0.1), 1, ctx.camera.position);
    windClock = cw || null;
    const now = ctx.game.t - (1 - alpha) / 60;
    if (goal.rune && goal.openT !== null) goal.rune.color.lerpColors(GOAL_DIM, GLOW, THREE.MathUtils.smoothstep(now - goal.openT, 0, 0.8) * (0.8 + 0.2 * Math.sin(now * 3))); // gold pulse once open
    if (goal.core) goal.core.emissiveIntensity = goal.onT === null ? 0 : 1.2 * THREE.MathUtils.smoothstep(now - goal.onT, 0, 0.3);
    const sp = ctx.registry.get('spring'), cdt = chimeT === null ? 0 : THREE.MathUtils.clamp(now - chimeT, 0, 0.1); chimeT = now;
    for (const ch of chimes) {
      if (sp === ch.sp && !ch.inside) ch.ring.reset().play();
      ch.inside = sp === ch.sp;
      const near = ch.o.position.distanceToSquared(ctx.camera.position) < 40 * 40; // past 40 m the chimes are specks: hide them (6 draws per cairn)
      for (const m of ch.small) m.visible = near;
      if (near) ch.mixer.update(cdt);
    }
    for (const c of cairns) { // past 35 m a cairn's ink line is thinner than a pixel: skip its edge pass (2 draws each)
      const layer = c.o.position.distanceToSquared(ctx.camera.position) < 35 * 35 ? 0 : 1;
      for (const m of c.inked) m.layers.set(layer);
    }
    for (const c of cairns) c.mat.emissiveIntensity = c.litT === null ? 0.05 : 0.05 + 1.4 * THREE.MathUtils.smoothstep(now - c.litT, 0, 0.6) * (0.85 + 0.15 * Math.sin(now * 2.2));
  },
};
