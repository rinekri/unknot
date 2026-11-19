// Cutscenes and the title backdrop orbit (render-side camera work over a paused sim).
// level.json `cutscenes` = {name: {dur, keys, lines, events, hero}}:
//   keys   [{at, shot} | {at, pos, look} | {at, play: 1}, ease?]: camera path; pos and look each run on a centripetal CatmullRom curve
//          through the keys, paced by arc length (see pace: smooth speed through every key, `ease: 1` starts and stops the segment that
//          leaves that key at rest). play: the play camera's own pose on the hero at that time (playPose), for a hand-off mid-glide.
//   lines  [{at, dur, text: {en, ru}, who?, voice?}]: narrator lines, published as 'talk.line' {voice: 'whisper'} (hud.js subtitle box,
//          audio.js babble); who {en, ru} + voice: an NPC speaks it instead (Kamen, the Kestrel).
//   events [{at, cue} | {at, fire: switchId} | {at, duck: {db, seconds}} | {at, sun: [from, to, seconds]} | {at, fx: 'finale'} | {at, wake: [x, y, z]}]:
//          wake: a warm grass wave (and its flowers) runs out from there, as from a woken rune (level.js 'wakes', world.js);
//          {at, wind: windId}: 'cut.wind' (level.js wakes that wind at once; its streaks drift on while paused)
//          cue -> 'audio.cue'; fire -> 'cut.fire' (level.js fires it pre-settled, fire(sw, -100)); duck -> 'audio.duck';
//          sun / fx finale -> 'cut.world' {sun, fin} (world.js sunrise override, finale gust + cloud parting).
//   hero {clip: 'land' | 'land.hard', at: clip fraction, pose: [{at, land}]}: weight of that additive landing squat held at `at`
//          over idle, interpolated (player.js reads 'cut.pose'); mark [x, z, heading]: the hero is drawn there instead of where the
//          player stopped, eased in over the first MARK_S (render only, 'cut.world'.mark, kept after the cutscene like the dawn).
//          path [{at, pos: [x, y, z], heading, clip?}]: the hero drawn along it, `clip` looped while that segment runs ('cut.pose'.loop:
//          walk, air.updraft...); walk/run stretches go at constant speed with the clip phase from distance ('cut.pose'.dist), facing the
//          way he goes, feet snapped to the ground or a risen slab (see rawAt / groundY); the mark is dropped at the end unless hero.keep.
//          from: 'player': the path's opening keys (those at its first position) start where the player stands instead, on his
//          heading, when that is within FROM_R m: no jump from where he stopped to the scene's first mark.
//   actors [{glb, scale?, path: [{at, pos, clip}]}]: an animated model shown only from the first key to the last (the Kestrel leading the hero
//          up its wind), its own mixer on the cutscene clock; position on a CatmullRom through the keys (one segment per interval), nose
//          (+Z) along the way it flies, banked into turns; `clip` from each key on (loops wrap, one-shots hold their last frame).
//   rise   [{at, nodes: [names], stagger, dur, drop, away?, tilt?}]: world nodes hidden outside this cutscene, rising `drop` m into place one
//          after another while it plays (render only: the l1 rune bridge toward the next island); away: in place from the start, each
//          tips `tilt` rad about its local x (origin at its foot) and sinks `drop` m out of sight (the l1 hollow stone opening; hidden again at the end).
//          A flight (consecutive segments whose clip is glide or land.roll) is one move along a CatmullRom through its keys at constant
//          speed by arc length (the inner key times are only waypoints): it speeds up from rest over FLY_RAMP s unless the scene opens
//          in the air, a roll slows to rest over FLY_RAMP s, a glide that ends the path ends at cruise speed. A scene that is not kept
//          and ends in a glide hands over mid-air: 'player.place' {pos, vel, heading} (player.js) at its end, also on a skip.
//   ribbon {at, grow, pts: [[x, y, z]...], fade?: [t0, t1]} (or a list of them): the wind road, a braid of brush strokes, leaves and a
//          gold thread blowing along a CatmullRom through pts; it opens from pts[0] over `grow` s from `at`, dies over `fade`.
// Registry in: 'cut.play' = name (hud.js), 'menu.orbit' = true (title backdrop: slow orbit around the spawn).
// Registry out: 'cut.active' (bool), 'cut.done' = {name, skipped, cam: [x, y, z] (its last camera position, camera.js eases on from there)}, 'cut.world' {clock: s of render time added while the sim is
// paused (world.js water/clouds, fx.js grass), sun, fin}, 'cut.pose'.
// Playing sets 'paused' (sim stops; this system is whilePaused). Letterbox bars at 11vh, the subtitle box sits inside the bottom bar.
// Skip: hold Esc / Space / gamepad A for HOLD_S; a gold ring fills. Off in test/bot runs, except ?test=1&cut=<name>&cutT=<s>,
// which starts that cutscene at load and seeks to cutT (fires and lines up to then) for a still frame.
import * as THREE from 'three';
import { tr } from './hud.js';
import { strokeMesh, STREAK, STREAK2, LEAF } from './level.js';

const FROM_R = 5; // m: hero.from
const HOLD_S = 0.8, MARK_S = 1.2, ORBIT = { r: 17, h: 5, ahead: 7, rate: 0.045 }; // s; m, m, m, rad/s
const sstep = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
let C = null, box, holdKeys = new Set(), listening = false;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), prevPos = new THREE.Vector3(), prevLook = new THREE.Vector3(), _v = new THREE.Vector3();

function ensureDom() {
  if (box) return;
  box = document.createElement('div');
  box.className = 'cut-box';
  box.innerHTML = '<div class="cut-bar top"></div><div class="cut-bar bottom"><div class="cut-skip"><svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" class="bg"/><circle cx="18" cy="18" r="15" class="fg" pathLength="100"/></svg><span></span></div></div>';
  document.body.append(box);
  if (!listening) {
    listening = true;
    const skipKey = (e) => e.code === 'Escape' || e.code === 'Space';
    addEventListener('keydown', (e) => { if (C?.play && skipKey(e)) { holdKeys.add(e.code); e.preventDefault(); } }, true);
    addEventListener('keyup', (e) => holdKeys.delete(e.code));
    addEventListener('blur', () => holdKeys.clear());
  }
}

function build(reg, name) {
  const data = reg.get('level')?.data, sc = data?.cutscenes?.[name];
  if (!sc) throw new Error(`cutscene '${name}' not in level.cutscenes`);
  const keys = sc.keys.map((k) => {
    if (k.play) return { at: k.at, ease: !!k.ease, play: true, pos: new THREE.Vector3(), look: new THREE.Vector3() }; // set below, once the hero path is known
    const s = k.shot ? data.shots?.find((x) => x.name === k.shot) : k;
    if (!s) throw new Error(`cutscene '${name}': shot '${k.shot}' not in level.shots`);
    return { at: k.at, ease: !!k.ease, pos: new THREE.Vector3(...s.pos), look: new THREE.Vector3(...s.look) };
  });
  let path = sc.hero?.path ?? [];
  const pl = reg.get('player'), p0 = path[0]?.pos;
  if (sc.hero?.from === 'player' && pl && Math.hypot(pl.pos.x - p0[0], pl.pos.z - p0[2]) < FROM_R && Math.abs(pl.pos.y - p0[1]) < 1.5) {
    const same = (k) => k.pos[0] === p0[0] && k.pos[1] === p0[1] && k.pos[2] === p0[2], n = path.findIndex((k) => !same(k));
    path = path.map((k, i) => (i < (n < 0 ? path.length : n) ? { ...k, pos: pl.pos.toArray(), ...(i === 0 && { heading: pl.heading }) } : k));
  }
  const c = {
    name, sc, keys,
    events: [...(sc.events ?? [])].sort((a, b) => a.at - b.at), lines: sc.lines ?? [], pose: sc.hero?.pose ?? [], path,
    rise: (sc.rise ?? []).flatMap((r) => r.nodes.map((n, i) => ({ r, i, o: reg.get('cut.scene')?.getObjectByName(n) })).filter((k) => k.o).map((k) => ({ ...k, base: (k.o.userData.riseBase ??= k.o.position.clone()) }))), // the placed pose, kept across replays
    ribbons: ribbons(reg.get('cut.scene'), sc.ribbon), t: 0, ev: 0, line: -1, hold: 0, play: true,
  };
  for (const k of keys) if (k.play) playPose(c, data.spawn, k);
  const at = keys.map((k) => k.at), still = keys.map((k, i) => k.ease || !!keys[i - 1]?.ease);
  c.posP = pace(keys.map((k) => k.pos), at, still); c.lookP = pace(keys.map((k) => k.look), at, still);
  return c;
}

// Distance along a curve through timed points: a cubic Hermite in arc length whose speed at each key is the harmonic mean of its two
// segments' average speeds (never overshoots a key; 0 where `still`; the ends keep their segment's speed). The speed is continuous
// through every key: no step where a slow segment meets a fast one (uniform u per key stepped it).
const DIV = 400; // arc-length table steps per key segment (getPointAt interpolates linearly between them: coarse steps wobble the speed at tight turns)
function pace(pts, at, still = []) {
  const n = pts.length, curve = new THREE.CatmullRomCurve3(n > 1 ? pts : [pts[0], pts[0]], false, 'centripetal');
  curve.arcLengthDivisions = DIV * Math.max(1, n - 1);
  const L = curve.getLengths(), cum = at.map((_, i) => L[i * DIV]);
  const d = cum.slice(1).map((x, i) => (x - cum[i]) / Math.max(1e-6, at[i + 1] - at[i]));
  const m = cum.map((_, i) => (still[i] || n < 2 ? 0 : i === 0 ? d[0] : i === n - 1 ? d[n - 2] : (2 * d[i - 1] * d[i]) / (d[i - 1] + d[i] || 1)));
  return { curve, at, cum, m };
}
function paceU(P, t) { // curve.getPointAt / getTangentAt parameter at time t
  const { at, cum, m } = P, n = at.length, len = cum[n - 1];
  if (n < 2 || len < 1e-6 || t <= at[0]) return 0;
  if (t >= at[n - 1]) return 1;
  let i = 0;
  while (t >= at[i + 1]) i++;
  const h = at[i + 1] - at[i], f = (t - at[i]) / h, f2 = f * f, f3 = f2 * f;
  return THREE.MathUtils.clamp(((2 * f3 - 3 * f2 + 1) * cum[i] + (f3 - 2 * f2 + f) * h * m[i] + (3 * f2 - 2 * f3) * cum[i + 1] + (f3 - f2) * h * m[i + 1]) / len, 0, 1);
}
// camera.js framing (ARM, PITCH, FOCUS_Y, AHEAD_T, AHEAD_MAX, AIR_UP) at the spawn's ground line; LAG: its 1 - exp(-10 dt) follow at 60 fps
// trails a steady move by v x 0.092 s. A play key is where the play camera would be on the hero at that time, so the hand-off is still.
const CAM = { arm: 6, pitch: 0.27, focusY: 1.4, aheadT: 0.25, aheadMax: 1.5, lag: 0.092, airUp: 2.5 }; // airUp: in the air its ground line trails the hero by at most that
function playPose(c, sp, k) {
  const a = rawAt(c, k.at - 0.021), b = rawAt(c, k.at - 0.001), vx = (b.x - a.x) / 0.02, vz = (b.z - a.z) / 0.02;
  const s = Math.min(CAM.aheadT, CAM.aheadMax / (Math.hypot(vx, vz) || 1)), cp = Math.cos(CAM.pitch);
  k.look.set(b.x + vx * s, Math.max(sp.pos[1], b.y - CAM.airUp) + CAM.focusY, b.z + vz * s);
  k.pos.set(k.look.x - Math.sin(sp.heading) * cp * CAM.arm - vx * CAM.lag, k.look.y + Math.sin(CAM.pitch) * CAM.arm, k.look.z - Math.cos(sp.heading) * cp * CAM.arm - vz * CAM.lag);
}

function camAt(c, t, outPos, outLook) {
  const k = c.keys, n = k.length;
  if (n === 1 || t <= k[0].at) return outPos.copy(k[0].pos), outLook.copy(k[0].look);
  if (t >= k[n - 1].at) return outPos.copy(k[n - 1].pos), outLook.copy(k[n - 1].look);
  c.posP.curve.getPointAt(paceU(c.posP, t), outPos); c.lookP.curve.getPointAt(paceU(c.lookP, t), outLook);
}

// hero along hero.path at t: {x, y, z, heading, clip, dist, walk}. A walk/run stretch (consecutive segments whose clip is walk or run)
// is one move at constant speed by arc length through its keys (WALK_RAMP s to get going and to stop; the inner key times are only
// waypoints), its clip phase follows the distance walked (player.js: dist / stride, no foot slide), 'run' above RUN_AT m/s, and the
// hero faces where he is going (the travel direction over +-TURN_S, eased back to the key heading as he stops). Other segments
// (air.updraft...) smoothstep per segment, y too.
const WALK = /^(walk|run)/, WALK_RAMP = 0.35, FLY_RAMP = 1.2, RUN_AT = 2.4, TURN_S = 0.3, FLY = /^(glide|land\.roll)$/, ONCE = /^(land\.|sing$|wake$)/;
function stretches(p) { // [{i0, i1, t0, t1, len, cum: [arc length at each key]}]
  const out = [];
  for (let i = 0; i < p.length - 1; i++) {
    if (!WALK.test(p[i].clip ?? '')) continue;
    const s = out.at(-1)?.i1 === i ? out.at(-1) : (out.push({ i0: i, cum: [0], len: 0 }), out.at(-1));
    s.len += Math.hypot(p[i + 1].pos[0] - p[i].pos[0], p[i + 1].pos[2] - p[i].pos[2]);
    s.cum.push(s.len); s.i1 = i + 1;
  }
  for (const s of out) { s.t0 = p[s.i0].at; s.t1 = p[s.i1].at; }
  return out;
}
function flights(p) { // [{i0, i1, curve, len, T, a, b, v}]: a, b ramp s at the start / end, v cruise m/s
  const out = [];
  for (let i = 0; i < p.length - 1; i++) {
    if (!FLY.test(p[i].clip ?? '')) continue;
    if (out.at(-1)?.i1 === i) out.at(-1).i1 = i + 1; else out.push({ i0: i, i1: i + 1 });
  }
  for (const s of out) {
    const n = s.i1 - s.i0;
    s.curve = new THREE.CatmullRomCurve3(p.slice(s.i0, s.i1 + 1).map((k) => new THREE.Vector3(...k.pos)), false, 'centripetal');
    s.curve.arcLengthDivisions = DIV * n;
    s.len = s.curve.getLength(); s.T = p[s.i1].at - p[s.i0].at;
    s.a = s.i0 > 0 ? Math.min(FLY_RAMP, s.T / 3) : 0; s.b = p[s.i1 - 1].clip === 'glide' ? 0 : Math.min(FLY_RAMP, s.T / 3);
    s.v = s.len / (s.T - s.a / 2 - s.b / 2);
  }
  return out;
}
const ramp = (x) => x * x * x - (x * x * x * x) / 2; // distance under a smoothstep speed ramp 0..1 over 0..1
function flyDist(s, u) { // m along the flight u s into it: constant speed, smoothstep ramps at the ends
  if (u < s.a) return s.v * s.a * ramp(u / s.a);
  if (u > s.T - s.b) return s.len - s.v * s.b * ramp((s.T - u) / s.b);
  return s.v * (u - s.a / 2);
}
function rawAt(c, t) {
  const p = c.path;
  for (const s of (c.flights ??= flights(p))) {
    if (t < p[s.i0].at || t >= p[s.i1].at) continue;
    let i = 0;
    while (t >= p[s.i0 + i + 1].at) i++;
    const A = p[s.i0 + i], u = THREE.MathUtils.clamp(flyDist(s, t - p[s.i0].at) / s.len, 0, 1), q = s.curve.getPointAt(u, _f), tan = s.curve.getTangentAt(u, _g);
    return { x: q.x, y: q.y, z: q.z, heading: Math.hypot(tan.x, tan.z) > 0.05 ? Math.atan2(tan.x, tan.z) : A.heading, clip: A.clip, since: t - A.at, dist: 0, walk: false };
  }
  for (const s of (c.walks ??= stretches(p))) {
    if (t < s.t0 || t > s.t1) continue;
    const T = s.t1 - s.t0, a = Math.min(WALK_RAMP, T / 2), v = s.len / (T - a), u = t - s.t0;
    const d = u < a ? (v * u * u) / (2 * a) : u > T - a ? s.len - (v * (T - u) ** 2) / (2 * a) : v * (u - a / 2);
    let i = 0;
    while (i < s.cum.length - 2 && d > s.cum[i + 1]) i++;
    const A = p[s.i0 + i], B = p[s.i0 + i + 1], f = s.cum[i + 1] > s.cum[i] ? (d - s.cum[i]) / (s.cum[i + 1] - s.cum[i]) : 0;
    const dh = Math.atan2(Math.sin(B.heading - A.heading), Math.cos(B.heading - A.heading));
    return { x: A.pos[0] + (B.pos[0] - A.pos[0]) * f, y: A.pos[1] + (B.pos[1] - A.pos[1]) * f, z: A.pos[2] + (B.pos[2] - A.pos[2]) * f, heading: A.heading + dh * f,
      clip: t >= s.t1 ? null : v > RUN_AT ? 'run' : A.clip, dist: d, walk: true };
  }
  let i = 0;
  while (i < p.length - 1 && t >= p[i + 1].at) i++;
  const a = p[i], b = p[i + 1] ?? a, f = b === a ? 0 : sstep((t - a.at) / (b.at - a.at));
  const dh = Math.atan2(Math.sin(b.heading - a.heading), Math.cos(b.heading - a.heading));
  return { x: a.pos[0] + (b.pos[0] - a.pos[0]) * f, y: a.pos[1] + (b.pos[1] - a.pos[1]) * f, z: a.pos[2] + (b.pos[2] - a.pos[2]) * f, heading: a.heading + dh * f, clip: t < p[0].at || i === p.length - 1 ? null : a.clip ?? null, since: t - a.at, dist: 0, walk: false };
}
const _f = new THREE.Vector3(), _g = new THREE.Vector3();
function pathAt(c, t) {
  if (!c.path.length) return null;
  const h = rawAt(c, t), a = rawAt(c, t - TURN_S), b = rawAt(c, t + TURN_S), dx = b.x - a.x, dz = b.z - a.z, m = Math.hypot(dx, dz);
  if ((h.walk || a.walk || b.walk) && m > 1e-3) { // face the way he goes; blend back to the key heading as the move fades in or out
    const w = Math.min(1, m / (2 * TURN_S * 0.6)), dh = Math.atan2(Math.sin(Math.atan2(dx, dz) - h.heading), Math.cos(Math.atan2(dx, dz) - h.heading));
    h.heading += dh * w;
  }
  return h;
}

function poseAt(c, t) {
  const p = c.pose, h = pathAt(c, t);
  const once = h?.clip && ONCE.test(h.clip) ? h.since : null; // a one-shot runs from its segment's start (player.js)
  if (!p.length) return h?.clip ? { land: 0, loop: h.clip, t, once, dist: h.walk ? h.dist : null } : null;
  let w = p[0].land;
  for (let i = 0; i < p.length; i++) {
    if (t >= p[i].at) w = p[i].land;
    if (p[i + 1] && t >= p[i].at && t < p[i + 1].at) { w = THREE.MathUtils.lerp(p[i].land, p[i + 1].land, sstep((t - p[i].at) / (p[i + 1].at - p[i].at))); break; }
  }
  return { land: w, clip: c.sc.hero.clip ?? 'land', at: c.sc.hero.at ?? 0.3, t, loop: h?.clip ?? null, once, dist: h?.walk ? h.dist : null };
}

// a walking hero's feet on what is under him: the collider ground or a risen (cutscene-only, no collider) bridge slab, the higher
// within SNAP m of the path's own y; nothing there keeps the path y
const SNAP = 1.0, _ray = new THREE.Raycaster(), _down = new THREE.Vector3(0, -1, 0);
function groundY(reg, h) {
  let y = reg.get('level')?.collide?.groundAt(h.x, h.z, h.y + SNAP)?.y ?? -Infinity;
  _ray.set(_v.set(h.x, h.y + SNAP, h.z), _down); _ray.far = 2 * SNAP;
  for (const k of C.rise) if (k.o.visible) for (const hit of _ray.intersectObject(k.o, true)) { y = Math.max(y, hit.point.y); break; }
  return y >= h.y - SNAP ? y : h.y;
}

// the walking feet's height at t: groundY along the path, max-filtered then triangle-averaged over +-STEP_S s (one tap per 60 Hz frame), so
// a step onto or off a slab is a short smooth climb that never dips below the ground (a pure function of t: a seek lands on the same frame)
const STEP_S = 0.2, _g24 = [];
function stepY(reg, c, t) {
  for (let i = 0; i <= 48; i++) { const q = rawAt(c, t + ((i - 24) * STEP_S) / 12); _g24[i] = q.walk ? groundY(reg, q) : q.y; }
  let y = 0, w = 0;
  for (let i = 12; i <= 36; i++) { const k = 13 - Math.abs(i - 24); y += k * Math.max(..._g24.slice(i - 12, i + 13)); w += k; }
  return y / w;
}

// world look at time t: the latest sun ramp and the finale gust, both pure functions of t (a seek lands on the same frame)
function worldAt(c, t, world) {
  for (const e of c.events) {
    if (e.at > t) break;
    if (e.sun) world.sun = THREE.MathUtils.lerp(e.sun[0], e.sun[1], sstep((t - e.at) / (e.sun[2] || 1)));
    if (e.fx === 'finale') world.fin = t - e.at;
    if (e.fx === 'grey') world.grey = t - e.at; // bad ending: world.js greys the sky, parts the islands, turns the hero to a totem
  }
}

// The wind road (render only): strokes, leaves and gold thread dashes drift along the curve, braided round its axis; nothing shows
// past the opening front. Seeded by index: a seek lands on the same frame.
const RIB = [], GOLD = new THREE.Color('#e8b84a'), RIB_V = 9, _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _X = new THREE.Vector3(1, 0, 0), _a = new THREE.Vector3(), _b = new THREE.Vector3();
const hash = (i, k) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };
function clearRibbons() { for (const r of RIB.splice(0)) { r.im.removeFromParent(); r.im.geometry.dispose(); r.im.material.dispose(); } }
function ribbons(scene, list) {
  clearRibbons();
  for (const d of list && scene ? [list].flat() : []) {
    const curve = new THREE.CatmullRomCurve3(d.pts.map((q) => new THREE.Vector3(...q)), false, 'centripetal'), len = curve.getLength();
    const n = THREE.MathUtils.clamp(Math.round(len * 1.6), 40, 300), im = strokeMesh(n);
    for (let i = 0; i < n; i++) im.setColorAt(i, i % 6 === 0 ? GOLD : i % 4 === 1 ? LEAF : i % 2 ? STREAK : STREAK2);
    im.name = 'cut_ribbon__fx'; im.visible = false;
    scene.add(im);
    RIB.push({ d, curve, len, im });
  }
  return [...RIB];
}
function ribbonAt(r, t, cam) {
  const { d, curve, len, im } = r, a = t - d.at, front = len * sstep(a / (d.grow || 1)), k = d.fade ? 1 - sstep((t - d.fade[0]) / (d.fade[1] - d.fade[0])) : 1;
  im.visible = a > 0 && k > 0.01;
  if (!im.visible) return;
  im.material.opacity = 0.9 * k;
  for (let i = 0; i < im.count; i++) {
    const gold = i % 6 === 0, leaf = !gold && i % 4 === 1, sp = 0.7 + 0.6 * hash(i, 1);
    const s = (hash(i, 2) * len + RIB_V * sp * t) % len, u = s / len, p = curve.getPointAt(u, _f), tan = curve.getTangentAt(u, _g);
    _a.set(tan.z, 0, -tan.x).normalize(); _b.crossVectors(_a, tan); // across and up from the way it blows
    const ang = hash(i, 3) * 6.283 + s * 0.3 + t * 0.8, rad = gold ? 0.25 : 0.5 + 1.3 * hash(i, 4);
    p.addScaledVector(_a, Math.cos(ang) * rad).addScaledVector(_b, Math.sin(ang) * rad * 0.7);
    const w = sstep((front - s) / 4) * sstep(s / 3) * sstep((len - s) / 6) * THREE.MathUtils.smoothstep(p.distanceTo(cam), 1.5, 4); // nothing past the front, soft ends, no smear across the lens
    const th = (leaf ? 3 : gold ? 1.6 : 2.2) * w;
    im.setMatrixAt(i, _m.compose(p, _q.setFromUnitVectors(_X, tan), _s.set((leaf ? 0.16 : gold ? 3.2 : 1.2 + 1.6 * hash(i, 5)) * w, th, th)));
  }
  im.instanceMatrix.needsUpdate = true;
}

// events crossed up to t, in order; `quiet` (a seek) skips sounds
const ACT = {}; // cutscene name -> [{d, g, mixer, acts, curve}], loaded at level init
function actorAt(a, t) {
  const p = a.d.path, on = t >= p[0].at && t <= p.at(-1).at;
  a.g.visible = on;
  if (!on) return;
  let i = 0;
  while (i < p.length - 2 && t >= p[i + 1].at) i++;
  const u = paceU(a.P, t), tan = a.P.curve.getTangentAt(u, _v);
  a.P.curve.getPointAt(u, a.g.position);
  const yaw = Math.atan2(tan.x, tan.z), turn = Math.atan2(Math.sin(yaw - (a.yaw ?? yaw)), Math.cos(yaw - (a.yaw ?? yaw)));
  a.bank = THREE.MathUtils.lerp(a.bank ?? 0, THREE.MathUtils.clamp(-turn * 12, -0.6, 0.6), 0.15); a.yaw = yaw;
  a.g.rotation.set(-0.5 * Math.asin(THREE.MathUtils.clamp(tan.y, -1, 1)), yaw, a.bank, 'YXZ');
  let j = i;
  while (j > 0 && (p[j - 1].clip ?? 'fly') === (p[i].clip ?? 'fly')) j--;
  const name = p[i].clip ?? 'fly', act = a.acts[name];
  for (const [k, x] of Object.entries(a.acts)) x.setEffectiveWeight(k === name ? 1 : 0);
  if (act) { const d = act.getClip().duration; act.time = act.loop === THREE.LoopOnce ? Math.min(t - p[j].at, d - 1e-3) : (t - p[j].at) % d; }
  a.mixer.update(0);
}

function fireEvents(c, reg, t, quiet, now) { // now: world.js clock (game time + cut.world clock)
  while (c.ev < c.events.length && c.events[c.ev].at <= t) {
    const e = c.events[c.ev++];
    if (e.fire) reg.set('cut.fire', e.fire);
    if (e.wake) reg.get('wakes')?.push({ id: `${c.name}.wake`, pos: new THREE.Vector3(...e.wake), t: now - (t - e.at) });
    if (e.wind) reg.set('cut.wind', e.wind);
    if (quiet) continue;
    if (e.cue) reg.set('audio.cue', { name: e.cue, gain: e.gain ?? 1 });
    if (e.duck) reg.set('audio.duck', e.duck);
  }
}

function lineAt(c, t) {
  let idx = -1;
  c.lines.forEach((l, i) => { if (t >= l.at && t < l.at + l.dur) idx = i; });
  return idx;
}

export default {
  name: 'cutscene', order: 35, whilePaused: true, deps: ['level'],
  init(ctx) {
    const reg = ctx.registry, test = ctx.params.test || ctx.params.bot, seek = ctx.params.get('cut');
    C = null; this.on = false; this.held = false;
    clearRibbons();
    reg.set('cut.scene', ctx.scene);
    for (const sc of Object.values(reg.get('level')?.data.cutscenes ?? {})) for (const r of sc.rise ?? []) for (const n of r.nodes) { const o = ctx.scene.getObjectByName(n); if (o) o.visible = false; } // cutscene-only pieces
    this.clock = 0; this.world = { clock: 0 }; this.orbitT = 0;
    for (const k in ACT) delete ACT[k];
    const lvl = reg.get('level')?.data;
    for (const [name, sc] of Object.entries(lvl?.cutscenes ?? {})) for (const d of sc.actors ?? []) ctx.assets.gltf(d.glb).then((gl) => {
      if (reg.get('level')?.data !== lvl) return; // the level changed while it loaded
      const mixer = new THREE.AnimationMixer(gl.scene), once = new Set(Object.entries(gl.scene.userData?.clips ?? {}).filter(([, c]) => !c.loop).map(([k]) => k));
      const acts = Object.fromEntries(gl.animations.map((c) => { const a = mixer.clipAction(c); if (once.has(c.name)) a.setLoop(THREE.LoopOnce); a.play(); a.timeScale = 0; a.setEffectiveWeight(0); return [c.name, a]; }));
      gl.scene.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
      gl.scene.visible = false; gl.scene.scale.setScalar(d.scale ?? 1);
      ctx.add(gl.scene);
      (ACT[name] ??= []).push({ d, g: gl.scene, mixer, acts, P: pace(d.path.map((k) => new THREE.Vector3(...k.pos)), d.path.map((k) => k.at)) });
    });
    if (test && !seek) return; // playtests never see cutscenes or menus
    ensureDom();
    this.on = true;
    const start = (name) => {
      C = build(reg, name); this.held = false;
      reg.set('paused', true);
      reg.set('talk.line', null);
      reg.set('cut.active', true);
      document.body.classList.add('cut');
      box.querySelector('.cut-skip span').textContent = tr({ en: 'hold to skip', ru: 'держи, чтобы пропустить' });
      camAt(C, 0, camPos, camLook); prevPos.copy(camPos); prevLook.copy(camLook);
    };
    reg.on('cut.play', (name) => start(name));
    reg.on('menu.orbit', (on) => { if (on) { this.orbitT = 0; this.orbit(reg, 0); prevPos.copy(camPos); prevLook.copy(camLook); } });
    if (seek) { // ?test=1&cut=<name>&cutT=<s>: a still at cutT
      start(seek);
      C.t = Math.max(0, +(ctx.params.get('cutT') ?? 0));
      fireEvents(C, reg, C.t, true, ctx.game.t + this.clock);
      C.line = -2; // the line at cutT goes up on the first frame (hud.js subscribes after this init)
      this.apply(ctx);
      prevPos.copy(camPos); prevLook.copy(camLook);
    }
  },
  apply(ctx) { // camera target, hero pose and world state for C.t
    const reg = ctx.registry;
    prevPos.copy(camPos); prevLook.copy(camLook);
    camAt(C, C.t, camPos, camLook);
    reg.set('cut.pose', poseAt(C, C.t));
    const w = { clock: this.clock };
    worldAt(C, C.t, w);
    for (const k of C.rise) { // rune bridge: each node rises from `drop` m below in turn
      const u = THREE.MathUtils.clamp((C.t - k.r.at - k.i * (k.r.stagger ?? 0.3)) / (k.r.dur ?? 1), 0, 1);
      if (k.r.away) { // tips `tilt` rad about its own x (its origin is its foot), then sinks out of sight
        k.o.visible = u < 1; k.o.quaternion.copy(k.o.userData.riseQ ??= k.o.quaternion.clone()).multiply(_q.setFromAxisAngle(_X, (k.r.tilt ?? 1) * sstep(Math.min(1, u * 1.6))));
        k.o.position.copy(k.base).y -= (k.r.drop ?? 1) * u ** 3;
      } else {
        k.o.visible = u > 0;
        k.o.position.copy(k.base).y -= (k.r.drop ?? 6) * (1 - u) ** 3;
      }
      k.o.updateMatrixWorld(true);
    }
    const m = C.sc.hero?.mark, h = pathAt(C, C.t);
    if (m) w.mark = { x: m[0], z: m[1], heading: m[2], w: sstep(C.t / MARK_S) };
    if (h) w.mark = { x: h.x, y: h.walk ? stepY(reg, C, C.t) : h.y, z: h.z, heading: h.heading, w: 1 };
    for (const a of ACT[C.name] ?? []) actorAt(a, C.t);
    for (const r of C.ribbons) ribbonAt(r, C.t, camPos);
    this.world = w;
    reg.set('cut.world', w);
  },
  finish(ctx, skipped, over = 0, rdt = 1) { // over: s run past dur this frame (this frame shows the hand-off, moved on by that much: no still frame)
    const reg = ctx.registry, name = C.name, p = C.path, e = p.at(-1);
    if (!C.sc.hero?.keep && p.at(-2)?.clip === 'glide') { // the hand-off mid-glide: the player goes on from the path's end at its speed
      const a = rawAt(C, e.at - 0.021), b = rawAt(C, e.at - 0.001), v = [(b.x - a.x) / 0.02, (b.y - a.y) / 0.02, (b.z - a.z) / 0.02];
      reg.set('player.place', { pos: e.pos.map((x, i) => x + v[i] * over), vel: v, heading: e.heading ?? b.heading });
    }
    if (!skipped) camPos.addScaledVector(_v.subVectors(camPos, prevPos), over / rdt);
    for (const k of C.rise) if (k.r.away) k.o.visible = false; // skipped mid-scene: the opened stone is gone either way
    if (C.path.length && !C.sc.hero.keep) { const { mark, ...w } = this.world; this.world = w; reg.set('cut.world', w); } // control returns: the hero is drawn where the player is
    for (const a of ACT[name] ?? []) a.g.visible = false;
    if (!C.sc.hero?.keep) clearRibbons(); // the level changes after a kept scene: the road stays up through the fade
    this.held = !!C.sc.hero?.keep; // and so does its last frame (no cut back to the play camera under the fade or the ending card)
    prevPos.copy(camPos); prevLook.copy(camLook);
    C = null; holdKeys.clear();
    document.body.classList.remove('cut');
    box?.style.setProperty('--hold', 0);
    reg.set('talk.line', null);
    reg.set('cut.pose', null);
    reg.set('cut.active', false);
    reg.set('cut.done', { name, skipped, cam: skipped ? null : camPos.toArray() }); // 'cut.world' keeps its last sun / gust until the level changes (the finale's dawn stays)
  },
  update(ctx, dt) {
    if (!this.on) return;
    const reg = ctx.registry, rdt = ctx.params.test ? dt : dt / (ctx.game.settings.gameSpeed || 1); // real seconds, whatever the assist speed
    if (reg.get('paused')) { // render clock for water, clouds and grass while the sim stands still (menus, cutscenes)
      this.clock += rdt;
      this.world = { ...this.world, clock: this.clock };
      reg.set('cut.world', this.world);
    }
    if (!C) {
      if (reg.get('menu.orbit')) { this.orbitT += rdt; prevPos.copy(camPos); prevLook.copy(camLook); this.orbit(reg, this.orbitT); }
      return;
    }
    if (C.line === -2) C.line = -1; // seek: the first step only puts up the line at cutT
    else C.t += rdt;
    const pad = navigator.getGamepads?.().find(Boolean);
    const holding = holdKeys.size > 0 || !!pad?.buttons[0]?.pressed;
    C.hold = holding ? C.hold + rdt : 0;
    box?.style.setProperty('--hold', Math.min(1, C.hold / HOLD_S));
    box?.classList.toggle('holding', holding);
    if (C.hold >= HOLD_S) return this.finish(ctx, true);
    fireEvents(C, reg, C.t, false, ctx.game.t + this.clock);
    const li = lineAt(C, C.t);
    if (li !== C.line) {
      C.line = li;
      const l = C.lines[li];
      reg.set('talk.line', l ? { npc: 'narrator', who: l.who ?? null, voice: l.voice ?? 'whisper', text: l.text, dur: l.dur } : null);
    }
    if (C.t >= C.sc.dur && !ctx.params.test) return this.finish(ctx, false, C.t - C.sc.dur, rdt);
    this.apply(ctx);
  },
  orbit(reg, t) { // title backdrop: the camera circles a point a little ahead of the spawn, looking at the stone ring
    const data = reg.get('level')?.data, sp = data?.spawn;
    if (!sp) return;
    const cx = sp.pos[0] + Math.sin(sp.heading) * ORBIT.ahead, cz = sp.pos[2] + Math.cos(sp.heading) * ORBIT.ahead, a = sp.heading + Math.PI * 1.5 + t * ORBIT.rate; // opens side-on: the path of islands and the sun behind the start, not the grass from above
    camPos.set(cx + Math.sin(a) * ORBIT.r, sp.pos[1] + ORBIT.h, cz + Math.cos(a) * ORBIT.r);
    camLook.set(cx, sp.pos[1] + 2.5, cz);
  },
  beforeRender(ctx, alpha) {
    if (!this.on || (!C && !ctx.registry.get('menu.orbit') && !(this.held && ctx.registry.get('paused')))) return;
    ctx.camera.position.lerpVectors(prevPos, camPos, alpha);
    ctx.camera.lookAt(_v.lerpVectors(prevLook, camLook, alpha));
  },
  dispose() {
    if (C) document.body.classList.remove('cut');
    C = null; this.on = false;
  },
};
