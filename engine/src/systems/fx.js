// Juice: particles, render-only feel and ambient life. Nothing here touches sim state.
// Particles: one pool inside a single InstancedMesh (layer 1: no ink edges), evaluated analytically from their birth time
// (position = p + v * drag integral + gravity), so a render at any sim time is reproducible and test advance() shows them.
// Emission happens in event handlers / update() (sim time) and draws only from this system's own rng stream (ctx.rng).
// The same mesh also carries the ambient sprites: cloud wisps, far bird flocks, floating motes around the camera.
// Render feel (beforeRender, sim-time clock): 60 ms hit-stop on a rune strike (camera and character pose frozen), camera
// kick / shake, FOV punch when a wind starts near the player, squash and stretch through registry 'player.renderScale'
// (player.js reads it next frame). Wind sway of grass and trees lives in look.js; this system feeds its uniforms.
// Dash: 6 dust puffs + 8 speed streaks, 50 ms hit-stop, FOV +6 deg (tau 0.25 s, all FOV punches capped at +8), stretch
// [0.9, 0.95, 1.15] and 3 fading afterimages (a skinned clone of the hero, posed from the live model at 0 / 50 / 100 ms).
// Creatures (same sprite draw, own rng stream 'fx.life'): small birds perched beside the route flee when the hero comes within 6 m
// (sim decides the moment + 'birds' cue, render flies them off); cream wisps circle unwoken runes / totems (no lead to the next
// one: Sigh, npc.js, leads to the hidden instead). Mist puffs at the foot of each waterfall; the l3 finale ('world.finale') throws petals out.
// Events used: player.land / step / jump / strike / strikeHit / dash / respawn / singEnd, strike.target / sing.target / sing.done (level.js), end = 'goal'.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { surfaceOf } from '../core/collide.js';
import { lookUniforms } from './look.js';
import { windScale, springList, wallList } from './level.js';
import { gustList } from './marks.js';
import { SKY } from '../core/post.js';
import { mulberry32, hash } from '../core/rng.js';
import { GLYPH, STAGE_T, OVER, SONG_COL as SONGS_COL } from './songs.js';

const CAP = 960, POOL = 240, HOLD = 0.06; // instances, particle slots, hit-stop seconds
const DASH = { hold: 0.05, fov: 6, fovTau: 0.25, fovCap: 8, burst: 0.18, ghosts: 3, ghostEvery: 0.05, ghostLife: 0.3, ghostA: 0.4 }; // s, deg, s, deg, s, n, s, s, opacity
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const C = (hex) => new THREE.Color(hex);
const DUST = { grass: C('#ddd6a8'), stone: C('#d9d0c4'), slab: C('#d9d0c4'), rubble: C('#cfc4b2'), wood: C('#d8c7a6') }, GOLD = C('#ffd27a'), GLOW = C('#e9b85a'), CREAM = C('#fff3d0'), INK = C('#4d463b');
const SONG_COL = Object.fromEntries(Object.entries(SONGS_COL).map(([k, v]) => [k, C(v)])); // gift songs (songs.js); the cloak's song seams match
const CHIP = [C('#8b8590'), C('#d5c3a9'), C('#645d4f')], PETAL = [C('#ec5f8f'), C('#f598bd'), C('#f6c83a')]; // rose, pink, yellow: pale creams read white on the grass
const LEAF = [C('#8a9a52'), C('#a3a95a'), C('#c0a458'), C('#b98a5e'), C('#efe6cc'), C('#8a9a52')], BLADE = [C('#8f9a48'), C('#b8bc6a'), C('#cdd088')], RIBBON = [C('#b98a50'), C('#b0654f')], WIND_W = C('#fffaf0');
const AX_X = V(1, 0, 0), AX_Y = V(0, 1, 0), AX_Z = V(0, 0, 1);
const _m = new THREE.Matrix4(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _v = new THREE.Vector3(), _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const FLAT = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -Math.PI / 2);
const clamp = THREE.MathUtils.clamp, sstep = THREE.MathUtils.smoothstep;
const wrap = (v, size) => ((((v + size / 2) % size) + size) % size) - size / 2; // v folded into [-size/2, size/2)

const VERT = `
attribute vec2 aP; attribute float aShape;
varying vec2 vP; varying vec3 vC; varying vec2 vA; varying float vS;
void main() { vP = position.xy * 2.0; vC = instanceColor; vA = aP; vS = aShape; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`;
// shapes: 0 soft disc, 1 ring, 2 rune glyph, 3 bird (aP.y = flap -1..1), 4 light beam, 5 petal, 6 chip, 7 cloud wisp, 8 grass blade
const FRAG = `
varying vec2 vP; varying vec3 vC; varying vec2 vA; varying float vS;
void main() {
  vec2 p = vP; float r = length(p), a = 0.0; int s = int(vS + 0.5);
  if (s == 0) a = smoothstep(1.0, 0.15, r);
  else if (s == 1) a = smoothstep(0.2, 0.0, abs(r - 0.8));
  else if (s == 2) {
    vec2 q = abs(p);
    a = max(max(smoothstep(0.1, 0.0, abs(r - 0.72)), smoothstep(0.1, 0.0, abs(r - 0.24))), smoothstep(0.07, 0.0, min(q.x, q.y)) * step(0.24, r) * step(r, 0.68)) + 0.3 * smoothstep(1.0, 0.2, r);
  } else if (s == 3) a = smoothstep(0.12, 0.04, abs(p.y - 0.45 * vA.y * abs(p.x) + 0.1 * abs(p.x))) * (1.0 - smoothstep(0.8, 1.0, abs(p.x)));
  else if (s == 4) a = pow(max(1.0 - abs(p.x), 0.0), 1.6) * smoothstep(-1.0, -0.8, p.y) * (1.0 - smoothstep(0.1, 1.0, p.y));
  else if (s == 5) a = smoothstep(1.0, 0.6, length(p * vec2(1.0, 1.9)));
  else if (s == 6) a = smoothstep(1.0, 0.8, max(abs(p.x), abs(p.y)));
  else if (s == 8) { float t = p.y * 0.5 + 0.5; a = smoothstep(0.12, 0.0, abs(p.x) - 0.85 * (1.0 - t)); }
  else a = pow(smoothstep(1.0, 0.0, r), 2.0);
  a *= vA.x;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vC, a);
}`;

let S; // per-level state, rebuilt in init
const SING_T = 0.5; // s: player.js TUNING.singTime

function emit(o) { // o: shape p v g drag life s0 s1 h col a curve spin rot kind q
  const e = S.pool[S.head++ % POOL];
  Object.assign(e, { on: true, shape: 0, g: 0, drag: 0, h: 0, a: 1, curve: 0, spin: 0, rot: 0, kind: 'b', q: null, d: null }, o);
  e.p = o.p.clone(); e.v = o.v ? o.v.clone() : V();
  return e;
}
const rr = (a, b) => a + (b - a) * S.rng();
const spread = (n, f) => { for (let i = 0; i < n; i++) f(i); };

function puffs(t0, pos, n, { r = 0.3, speed = [0.8, 2], up = [0.3, 1], size = [0.12, 0.4], life = [0.5, 0.9], a = 0.5, col = DUST.stone } = {}) {
  spread(n, () => {
    const ang = rr(0, 6.283), sp = rr(...speed);
    emit({ t0, shape: 0, p: _p.set(pos[0] + Math.cos(ang) * r * 0.5, pos[1] + 0.08, pos[2] + Math.sin(ang) * r * 0.5), v: _v.set(Math.cos(ang) * sp, rr(...up), Math.sin(ang) * sp),
      g: -0.6, drag: 3, life: rr(...life), s0: size[0], s1: size[1], col, a });
  });
}
const surfaceAt = (pos) => surfaceOf(S.level.collide.groundAt(pos[0], pos[2], pos[1] + 0.2));
const kick = (t0, o) => S.kicks.push({ t0, f: 0, d: 0, s: 0, tau: 0.12, ...o });
const later = (t, fn) => S.jobs.push({ t, fn });

function dir(h) { return [Math.sin(h), Math.cos(h)]; }
// R3: the song's own glyph (songs.js GLYPH: gust open spiral + arrows, name ring of rune ticks, anchor + chain loop) traced in the air
// at c, facing along heading [dx, dz], dots spaced along its polylines over dur s; returns the dots (a wasted song fades them).
function traceGlyph(t, song, c, dx, dz, dur, col, a = 1, size = 0.5) {
  const pts = [];
  for (const line of GLYPH[song] ?? []) for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i], n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.11));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  const step = Math.max(1, Math.ceil(pts.length / 70)), out = [];
  for (let i = 0; i < pts.length; i += step) {
    const u = i / pts.length, [x, y] = pts[i];
    out.push(emit({ t0: t + u * dur, shape: 0, p: _p.set(c.x + dz * x * size, c.y + y * size, c.z - dx * x * size), v: _v.set(0, 0.05, 0), drag: 2, life: dur * (1 - u) + 0.8, s0: 0.1, s1: 0.05, col, a }));
  }
  return out;
}
function fizzle(t, pos, col) { // a song with nothing to take (or a wrong rhythm / slip / over-charge): a grey puff, the glyph scattered
  for (const o of S.glyph ?? []) { o.life = Math.min(o.life, t - o.t0 + 0.25); }
  S.glyph = null;
  puffs(t, pos, 8, { r: 0.4, speed: [0.4, 1.2], up: [0.2, 0.8], size: [0.12, 0.32], life: [0.4, 0.7], a: 0.45, col: INK });
  spread(5, () => emit({ t0: t, shape: 0, p: _p.set(pos[0] + rr(-0.3, 0.3), pos[1] + rr(0, 0.4), pos[2] + rr(-0.3, 0.3)), v: _v.set(rr(-0.6, 0.6), rr(-0.6, 0.1), rr(-0.6, 0.6)), g: -3, drag: 1, life: rr(0.4, 0.7), s0: 0.08, s1: 0.03, col, a: 0.6 }));
}
function unravel(t, at, n = 30) { // R3 Name: gold threads unravel off the target, spiralling up and out
  spread(n, (i) => {
    const a0 = (i / n) * 6.283, sp = rr(0.8, 1.6), up = rr(1.2, 2.6);
    emit({ t0: t + (i % 6) * 0.06, shape: 0, kind: 's', d: V(Math.cos(a0 + 1.2), 0.6, Math.sin(a0 + 1.2)), p: _p.set(at[0] + Math.cos(a0) * 0.35, at[1] + rr(-0.2, 0.4), at[2] + Math.sin(a0) * 0.35),
      v: _v.set(Math.cos(a0) * sp, up, Math.sin(a0) * sp), g: -0.4, drag: 1.2, life: rr(1.1, 1.8), s0: 0.16, s1: 0.06, h: 0.03, col: S.rng() < 0.75 ? GOLD : CREAM, a: 1, curve: 1 });
  });
  emit({ t0: t, shape: 2, p: _p.set(at[0], at[1] + 0.3, at[2]), life: 1.1, s0: 0.8, s1: 2.6, col: GOLD, a: 1 });
}

function strikeHit(t, pos, heading, target) {
  const [dx, dz] = dir(heading), tip = [pos[0] + dx * 1.1, pos[1] + 0.45, pos[2] + dz * 1.1];
  if (!target) { // swing into air: a few drifting motes and a tiny nudge, no ring/sparks (the whoosh is the strike cue)
    spread(4, () => emit({ t0: t, shape: 0, p: _p.set(...tip), v: _v.set(rr(-0.5, 0.5) + dx, rr(0.1, 0.6), rr(-0.5, 0.5) + dz), drag: 2.5, life: rr(0.4, 0.6), s0: 0.07, s1: 0.02, col: CREAM, a: 0.6 }));
    kick(t, { f: 0.02, tau: 0.1 });
    return;
  }
  emit({ t0: t, shape: 1, p: _p.set(...tip), life: 0.35, s0: 0.4, s1: 2.6, col: CREAM, a: 1 });
  spread(18, () => {
    const ang = rr(0, 6.283), el = rr(-0.3, 1), sp = rr(2.5, 6);
    emit({ t0: t, shape: 0, p: _p.set(...tip), v: _v.set(Math.cos(ang) * sp, el * sp, Math.sin(ang) * sp), g: -7, drag: 1.5, life: rr(0.35, 0.7), s0: 0.16, s1: 0.04, col: S.rng() < 0.5 ? GOLD : CREAM, a: 1 });
  });
  kick(t, { f: 0.04, tau: 0.1 });
  const { sw } = target, at = sw.pos.clone().add(V(0, 0.9, 0)), n = V(pos[0] - sw.pos.x, 0, pos[2] - sw.pos.z).normalize();
  emit({ t0: t, shape: 2, p: _p.copy(at), life: 0.7, s0: 1.0, s1: 2.2, col: GOLD, a: 1 });
  spread(9, () => {
    emit({ t0: t, shape: 6, p: _p.copy(at).add(_v.set(rr(-0.15, 0.15), rr(-0.15, 0.15), rr(-0.15, 0.15))),
      v: _v.copy(n).multiplyScalar(rr(1.5, 3.5)).add(V(rr(-1.5, 1.5), rr(1.5, 4), rr(-1.5, 1.5))), g: -16, drag: 0.4, life: rr(0.7, 1.1), s0: rr(0.05, 0.1), s1: 0.03,
      col: CHIP[Math.floor(S.rng() * 3)], a: 1, curve: 2, spin: rr(-12, 12), rot: rr(0, 6) });
  });
  kick(t, { f: 0.12, s: 0.018, tau: 0.14 });
  S.hit = { t, hold: HOLD };
}

function dashBurst({ t, pos, dir: [dx, dz], air }) {
  puffs(t, pos, 6, { r: 0.4, speed: [1, 2.4], up: [0.2, 0.7], size: [0.15, 0.45], life: [0.4, 0.7], a: air ? 0.3 : 0.45, col: air ? CREAM : DUST[surfaceAt(pos)] });
  const d = V(dx, 0, dz);
  spread(8, () => { // streaks along the path, born as the hero passes, drifting back
    const dt = rr(0, DASH.burst), along = 13 * dt + rr(-0.3, 0.3), side = rr(-0.45, 0.45);
    emit({ t0: t + dt, shape: 0, kind: 's', d, p: _p.set(pos[0] + dx * along + dz * side, pos[1] + rr(0.3, 1.5), pos[2] + dz * along - dx * side), v: _v.set(-dx * rr(1, 3), 0, -dz * rr(1, 3)),
      drag: 4, life: rr(0.2, 0.32), s0: 0.9, s1: 0.35, h: 0.035, col: CREAM, a: 0.7 });
  });
  if (!air) for (const f of S.level.flowers ?? []) if (Math.abs(f[0] - pos[0]) < 1.6 && Math.abs(f[2] - pos[2]) < 1.6 && Math.abs(f[1] - pos[1]) < 1) { // dashed through flowers: petals thrown up
    spread(10, () => emit({ t0: t + rr(0, DASH.burst), shape: 5, p: _p.set(pos[0] + dx * rr(0, 2) + rr(-0.4, 0.4), pos[1] + 0.2, pos[2] + dz * rr(0, 2) + rr(-0.4, 0.4)),
      v: _v.set(dx * rr(1, 3) + rr(-1, 1), rr(1, 2.5), dz * rr(1, 3) + rr(-1, 1)), g: -0.8, drag: 0.8, life: rr(1.5, 2.5), s0: rr(0.08, 0.14), s1: 0.1,
      col: PETAL[Math.floor(S.rng() * 3)], a: 1, curve: 2, spin: rr(-5, 5), rot: rr(0, 6) }));
    break;
  }
  S.hit = { t, hold: DASH.hold };
  S.dash = { t, n: 0 };
}

// Afterimages: cream, unlit, no ink edges (layer 1), never written to depth. Pose = the live model's local transforms, copied once.
function makeGhosts(model) {
  if (!model || !model.getObjectByProperty('isSkinnedMesh', true)) return [];
  return Array.from({ length: DASH.ghosts }, () => {
    const g = cloneSkinned(model), mat = new THREE.MeshBasicMaterial({ color: CREAM, transparent: true, depthWrite: false, fog: false });
    g.name = 'fx__ghost'; g.visible = false;
    g.traverse((o) => { o.layers.set(1); if (o.isMesh) { o.material = mat; o.frustumCulled = false; o.renderOrder = 1; } });
    const src = [], dst = [];
    model.traverse((o) => src.push(o)); g.traverse((o) => dst.push(o)); // clone() keeps child order
    return { g, mat, pairs: src.map((o, i) => [o, dst[i]]), t0: -9 };
  });
}
function ghosts(now) {
  const d = S.dash;
  S.ghosts.forEach((G, i) => {
    if (d && i >= d.n && now >= d.t + i * DASH.ghostEvery) { // capture this one now
      for (const [a, b] of G.pairs) { b.position.copy(a.position); b.quaternion.copy(a.quaternion); b.scale.copy(a.scale); }
      G.t0 = now; d.n = i + 1;
    }
    const age = now - G.t0;
    G.g.visible = age >= DASH.ghostEvery && age < DASH.ghostLife; // fresh capture sits on the hero: show once it trails
    if (G.g.visible) G.mat.opacity = DASH.ghostA * (1 - age / DASH.ghostLife) ** 2;
  });
}

function bridgeRise(t0, br) {
  const { stagger = 0, dur = 1 } = br.m;
  kick(t0 + 0.3, { s: 0.03, tau: 0.3 });
  br.bases.forEach((base, i) => later(t0 + i * stagger + dur * 0.6, () => {
    const t = t0 + i * stagger + dur * 0.6;
    puffs(t, base.toArray(), 9, { r: 1.6, speed: [0.8, 2.4], up: [0.3, 1], size: [0.3, 1.0], life: [0.7, 1.2], a: 0.5, col: DUST.stone });
    kick(t, { s: 0.012, tau: 0.2 });
  }));
}

function goalBurst(t, g) {
  const [x, y, z] = g.pos;
  emit({ t0: t, shape: 4, kind: 'y', p: _p.set(x, y + 8, z), life: 8, s0: 2.2, s1: 3, h: 16, col: GOLD, a: 0.55, curve: 1 });
  emit({ t0: t, shape: 4, kind: 'y', p: _p.set(x, y + 8, z), life: 8, s0: 0.8, s1: 1.1, h: 16, col: CREAM, a: 0.8, curve: 1 });
  emit({ t0: t, shape: 1, kind: 'f', q: FLAT, p: _p.set(x, y + 0.08, z), life: 1.6, s0: 0.5, s1: g.r * 2.6, col: GOLD, a: 0.9 });
  spread(70, () => {
    const ang = rr(0, 6.283), sp = rr(0.5, 3);
    emit({ t0: t, shape: 5, p: _p.set(x, y + 0.3, z), v: _v.set(Math.cos(ang) * sp, rr(2, 6), Math.sin(ang) * sp), g: -1.2, drag: 0.8, life: rr(3, 5), s0: rr(0.1, 0.2), s1: 0.12,
      col: PETAL[Math.floor(S.rng() * 3)], a: 1, curve: 2, spin: rr(-4, 4), rot: rr(0, 6) });
  });
  spread(30, () => {
    const ang = rr(0, 6.283), rad = rr(0, g.r * 0.9);
    emit({ t0: t, shape: 0, p: _p.set(x + Math.cos(ang) * rad, y + 0.1, z + Math.sin(ang) * rad), v: _v.set(0, rr(1, 4), 0), drag: 0.3, life: rr(1.5, 3), s0: 0.12, s1: 0.03, col: GOLD, a: 1 });
  });
}

// ---- render ----
// Phase S (songs.js 'songs.state', render only): while a song charges, its glyph is drawn stroke by stroke around the staff (all of it
// at stage 3, trembling and paling once over-held), the staff tip glows in the song's colour and wind stirs round the cloak.
// S.wraps: what a taken song does to its target: name = gold ribbons wind in round it, then unravel(); anchor = blue rings clamp
// round it with four chains and a frozen shimmer for the hold, blinking through its last 0.5 s.
const GP = {}, _tip = V(), _qf = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), -Math.PI / 2);
function glyphPts(song) {
  if (GP[song]) return GP[song];
  const pts = [];
  for (const line of GLYPH[song] ?? []) for (let i = 1; i < line.length; i++) {
    const [x0, y0] = line[i - 1], [x1, y1] = line[i], n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 0.09));
    for (let k = i === 1 ? 0 : 1; k <= n; k++) pts.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
  }
  return (GP[song] = pts);
}
// U12: a rune bound by its order stands wrapped in a wind knot (enemies.js draws it, the squall's own body). Freed ('rune.unlock'):
// a gold thread runs in from what woke it (TRAVEL s), then the knot blows away (wisps here, the body unwinding in enemies.js).
const TRAVEL = 0.7;
function whirls(now, cam, reg) {
  const sws = reg.get('level')?.targets?.switches; if (!sws) return;
  const q = cam.quaternion;
  S.unlocks = S.unlocks.filter((u) => now < u.t0 + TRAVEL);
  for (const sw of sws) {
    const u = S.unlocks.find((x) => x.id === sw.m.id);
        if (u?.from && now < u.t0 + TRAVEL) { // the thread on its way: a bright head and a tail of beads along a shallow arc
      const h = (now - u.t0) / TRAVEL;
      for (let i = 0; i < 22; i++) {
        const s = h - i * 0.022; if (s < 0) break;
        _p.fromArray(u.from).lerp(_tg.fromArray(sw.pos), s); _p.y += 1 + Math.sin(s * Math.PI) * 1.6;
        place(0, _p, q, 0.95 - i * 0.035, 0.95 - i * 0.035, i ? GOLD : CREAM, 0.95 - i * 0.04);
      }
    }
  }
}
function songFx(now, cam, reg) {
  const st = reg.get('songs.state'), hm = reg.get('player.model'), q = cam.quaternion;
  _cr.set(1, 0, 0).applyQuaternion(q); _cu.set(0, 1, 0).applyQuaternion(q);
  if (st && hm) {
    if (S.propOf !== hm) { S.propOf = hm; S.prop = hm.getObjectByName('R_Prop') ?? hm; }
    S.prop.getWorldPosition(_tip); _tip.y += 0.5;
    const col = SONG_COL[st.song] ?? GOLD, k = Math.min(1, st.charge / STAGE_T[2]), over = clamp((st.charge - STAGE_T[2]) / (OVER - STAGE_T[2]), 0, 1);
    const pts = glyphPts(st.song), n = Math.ceil(pts.length * k), size = 0.4 + 0.07 * st.stage;
    for (let i = 0; i < n; i++) {
      const [x, y] = pts[i], head = i > n - 4 && k < 1, j = over * 0.07;
      _p.copy(_tip).addScaledVector(_cr, x * size + j * Math.sin(now * 43 + i * 1.7)).addScaledVector(_cu, y * size + j * Math.cos(now * 37 + i * 2.3));
      place(0, _p, q, head ? 0.12 : 0.07, head ? 0.12 : 0.07, head ? CREAM : col, 0.95 - 0.6 * over);
    }
    const r = 0.3 + 0.16 * st.stage + 0.05 * Math.sin(now * (8 + 6 * st.stage));
    place(0, _tip, q, r, r, col, (0.5 + 0.15 * st.stage) * (1 - 0.7 * over));
    for (let j = 0; j < 3 + 2 * st.stage; j++) { // the cloak stirs: wind wisps circle the hero, more and faster with every stage
      const a = now * (3 + 1.5 * st.stage) + j * 2.1, rr2 = 0.45 + 0.12 * st.stage + 0.1 * Math.sin(j * 5.1);
      _p.set(hm.position.x + Math.cos(a) * rr2, hm.position.y + 0.25 + ((j * 0.37 + now * 0.7) % 1.2), hm.position.z + Math.sin(a) * rr2);
      place(0, _p, roll(q, 0.2 * Math.sin(a)), 0.34, 0.05, WIND_W, 0.4);
    }
  }
  // the Gust let go: wave fronts sweep the ground out to its reach (wider and further with the stage), wind streaks ride above them
  S.gusts = S.gusts.filter((g) => now < g.t0 + 0.55);
  for (const g of S.gusts) {
    const u = (now - g.t0) / 0.55; if (u < 0) continue;
    for (let f = 0; f < 2 + g.stage; f++) {
      const k = clamp(u * 1.5 - f * 0.14, 0, 1), d = 0.6 + (g.reach - 0.6) * (1 - (1 - k) * (1 - k)), al = (1 - u) * (k > 0 ? 1 : 0);
      for (let j = -3; j <= 3; j++) {
        const a = g.h + j * 0.105;
        _p.set(g.x + Math.sin(a) * d, g.y + 0.12 + 0.02 * f, g.z + Math.cos(a) * d);
        place(0, _p, _qa.setFromAxisAngle(AX_Y, a).multiply(_qf), 0.35 + d * 0.14, 0.5, f % 2 ? SONG_COL.gust : WIND_W, 0.85 * al);
        if (j % 2 === 0) { _p.y += 0.5 + 0.35 * ((j + f) & 3); _tg.set(Math.sin(a), 0.05, Math.cos(a)); place(0, _p, roll(q, Math.atan2(_tg.dot(_cu), _tg.dot(_cr))), 0.9, 0.07, WIND_W, 0.7 * al); }
      }
    }
  }
  S.wraps = S.wraps.filter((w) => now < w.t0 + w.dur);
  for (const w of S.wraps) {
    const u = now - w.t0; if (u < 0) continue;
    if (w.kind === 'name') {
      const k = u / w.dur;
      for (let j = 0; j < 3; j++) for (let i = 0; i < 12; i++) {
        const a = j * 2.094 + k * 10 - i * 0.2, rad = w.r * (2.4 - 1.6 * k) * (1 + i * 0.03);
        _p.set(w.at[0] + Math.cos(a) * rad, w.at[1] + 0.1 + j * 0.45 + i * 0.03 + 0.4 * k, w.at[2] + Math.sin(a) * rad);
        place(0, _p, q, 0.15 - i * 0.008, 0.15 - i * 0.008, i ? GOLD : CREAM, 1 - i * 0.05);
      }
    } else {
      const k = Math.min(1, u / 0.25), R = w.r * (2.2 - 1.2 * k), left = w.dur - u, blink = left < 0.5 ? 0.35 + 0.65 * (Math.sin(left * 50) > 0) : 1, col = SONG_COL.anchor;
      for (const dy of [0.15, 0.95]) { _p.set(w.at[0], w.at[1] + dy, w.at[2]); place(1, _p, _qf, R / 0.4, R / 0.4, col, blink); }
      for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) { // chains: links from the upper ring down to the ground outside it
        const a = j * 1.571 + 0.6, rad = R * (1 + i * 0.13);
        _p.set(w.at[0] + Math.cos(a) * rad, w.at[1] + 0.95 - i * 0.26, w.at[2] + Math.sin(a) * rad);
        place(i % 2 ? 1 : 6, _p, roll(q, a + i), 0.13, 0.13, col, blink * k);
      }
      for (let i = 0; i < 8; i++) { // frozen shimmer: still glints that twinkle in place
        const a = i * 2.4, tw = Math.max(0, Math.sin(now * 6 + i * 1.9));
        _p.set(w.at[0] + Math.cos(a) * R * 0.75, w.at[1] + 0.3 + (i % 4) * 0.25, w.at[2] + Math.sin(a) * R * 0.75);
        place(0, _p, q, 0.06 + 0.1 * tw, 0.06 + 0.1 * tw, CREAM, 0.9 * tw * k);
      }
    }
  }
}
function place(shape, pos, q, sx, sy, col, a, param = 0) {
  if (a < 0.004 || S.n >= CAP) return;
  _m.compose(pos, q, _s.set(sx, sy, 1)).toArray(S.mArr, S.n * 16);
  col.toArray(S.cArr, S.n * 3);
  S.pArr[S.n * 2] = a; S.pArr[S.n * 2 + 1] = param; S.sArr[S.n] = shape;
  S.n++;
}


// Wind cairns (level.js springList): a spiralling column of leaves and petals with wind streaks, a swaying grass ring and a fluttering ribbon on the cairn top.
const _cr = V(), _cu = V(), _tg = V();
function roll(q, a) { return _qa.copy(q).multiply(_qb.setFromAxisAngle(AX_Z, a)); }
function cairnFx(now, cam) {
  const q = cam.quaternion, cp = cam.position, inside = !!S.reg.get('spring');
  _cr.set(1, 0, 0).applyQuaternion(q); _cu.set(0, 1, 0).applyQuaternion(q);
  for (const sp of springList()) {
    const dc = Math.hypot(sp.pos[0] - cp.x, sp.pos[2] - cp.z), f = 1 - sstep(dc, 30, 45);
    if (f <= 0) continue;
    const [x, y, z] = sp.pos, bo = inside ? 1.25 : 1;
    place(4, _p.set(x, y + 1.7, z), q, 2.2, 3.4, CREAM, 0.5 * f * bo); // faint light column
    place(1, _p.set(x, y + 0.07, z), FLAT, 4.2, 4.2, GOLD, f * (0.2 + 0.07 * Math.sin(now * 1.6))); // glow ring on the ground
    for (let i = 0; i < 24; i++) { // leaves and petals spiralling up, widening as they rise
      const k = (i * 0.618) % 1, u = (now * (0.13 + 0.05 * k) + i / 24) % 1, r = (0.45 + 0.55 * k) * (0.75 + 0.45 * u), th = i * 2.4 + now * (1.5 + k) / (0.6 + r * 0.6);
      _p.set(x + Math.cos(th) * r, y + 0.15 + 2.9 * u, z + Math.sin(th) * r);
      place(5, _p, roll(q, now * (3 + k * 2) + i), 0.19, 0.19, LEAF[i % 6], f * 0.95 * sstep(u, 0, 0.12) * (1 - sstep(u, 0.82, 1)));
    }
    for (let i = 0; i < 14; i++) for (let j = 0; j < 3; j++) { // wind streaks: arcs on the orbit tangent, each with a fading tail
      const k = (i * 0.618) % 1, u = (now * 0.1 + i / 14) % 1, r = 0.8 + 0.5 * k, th = i * 1.7 + now * (2.2 + k) - j * 0.2;
      _p.set(x + Math.cos(th) * r, y + 0.4 + 2.4 * u + 0.15 * Math.sin(th * 2), z + Math.sin(th) * r);
      _tg.set(-Math.sin(th), 0.12, Math.cos(th));
      place(0, _p, roll(q, Math.atan2(_tg.dot(_cu), _tg.dot(_cr))), 0.8 - j * 0.15, 0.07, WIND_W, f * 0.85 * (1 - j * 0.22) * sstep(u, 0, 0.12) * (1 - sstep(u, 0.85, 1)));
    }
    for (let i = 0; i < 28; i++) { // grass ring: blades pivot at their foot, sway in a travelling wave
      const a = i / 28 * 6.283 + Math.sin(i * 12.9) * 0.08, r = 1.45 + 0.35 * Math.sin(i * 7.3), h = 0.34 + 0.14 * Math.sin(i * 3.1), sw = (0.28 + 0.15 * Math.sin(now * 1.8 + a * 2)) * -Math.sin(a) * _cr.x - (0.28 + 0.15 * Math.sin(now * 1.8 + a * 2)) * Math.cos(a) * _cr.z + 0.08 * Math.sin(now * 3.1 + i); // lean along the spiral tangent
      _p.set(x + Math.cos(a) * r, y, z + Math.sin(a) * r).addScaledVector(_cu, h * 0.5 * Math.cos(sw)).addScaledVector(_cr, -h * 0.5 * Math.sin(sw));
      place(8, _p, roll(q, sw), 0.07, h * 1.2, BLADE[i % 3], f * 0.95);
    }
    for (let m = 0; m < 1; m++) for (let j = 0; j < 16; j++) { // ribbon tied on the cairn top, streaming downwind
      const t = j / 15, ph = now * 6 - j * 1.1 + m * 2;
      _p.set(sp.top[0] + t * 1.3 + 0.05, sp.top[1] + 0.05 + 0.2 * Math.sin(ph) * t - 0.1 * t * t + m * 0.1, sp.top[2] + (m - 0.5) * 0.15 + 0.14 * Math.sin(ph * 0.7 + 1) * t);
      place(6, _p, roll(q, 0.5 * Math.sin(ph)), 0.13, 0.1 * (1.2 - 0.5 * t), RIBBON[j % 2], f);
    }
  }
  for (const b of wallList()) { // a thin trickle of dust and grit off an unbroken wall
    if (b.on || Math.hypot(b.m.pos[0] - cp.x, b.m.pos[2] - cp.z) > 30) continue;
    const c = Math.cos(b.m.rotY ?? 0), sn = Math.sin(b.m.rotY ?? 0), [w, h, d] = b.m.size;
    for (let i = 0; i < 10; i++) {
      const k = (i * 0.618) % 1, u = (now / (1.6 + k) + i * 0.37) % 1, lx = (k - 0.5) * w * 0.8 + 0.04 * Math.sin(now * 3 + i), lz = (i % 2 ? 1 : -1) * (d / 2 + 0.05);
      _p.set(b.m.pos[0] + lx * c + lz * sn, b.m.pos[1] + h * (0.75 - 0.75 * u * u), b.m.pos[2] - lx * sn + lz * c);
      place(0, _p, q, 0.07 + 0.04 * k, 0.07 + 0.04 * k, DUST.rubble, 0.8 * (1 - sstep(u, 0.8, 1)));
    }
  }
}

// Gust stones (marks.js gustList): in reach, leaves and grit trickle out of the plugged grooves; cleared, wind streams out of them.
const _go = V();
function ramFx(now, cam) { // a charging Warden / the boss: a short wake of grit and stone dust off its own flanks, never past 2 m behind it
  for (const e of S.reg.get('enemies') ?? []) {
    if (e.state !== 'ram' || e.kind === 'squall' || e.kind === 'minion') continue;
    _s.set(e.dir[0], 0, e.dir[1]).applyQuaternion(_qb.copy(cam.quaternion).invert());
    const q = _qb.copy(cam.quaternion).multiply(_qa.setFromAxisAngle(AX_Z, Math.atan2(_s.y, _s.x)));
    for (let i = 0; i < 6; i++) {
      const u = (now * 3 + i / 6) % 1, side = (i % 2 ? 1 : -1) * (0.5 + 0.15 * (i % 3)), b = 0.3 + 1.5 * u;
      _p.set(e.pos.x - e.dir[0] * b - e.dir[1] * side, e.ground + 0.25 + 0.35 * (i % 3), e.pos.z - e.dir[1] * b + e.dir[0] * side);
      place(0, _p, q, 0.6 * (1 - u), 0.05, i % 3 ? DUST.stone : DUST.rubble, 0.7 * (1 - u));
    }
  }
}

function gustFx(now, cam) {
  const q = cam.quaternion, cp = cam.position;
  _cr.set(1, 0, 0).applyQuaternion(q); _cu.set(0, 1, 0).applyQuaternion(q);
  for (const s of gustList()) {
    if (!s.state || Math.hypot(s.pos.x - cp.x, s.pos.z - cp.z) > 30) continue;
    s.vents.forEach((v, j) => {
      _go.set(v.x - s.pos.x, 0, v.z - s.pos.z).normalize();
      for (let i = 0; i < 4; i++) {
        const k = ((j * 4 + i) * 0.618) % 1;
        if (s.state === 1) { // a trickle: leaves and grit work loose, drift out and drop; a draught shimmers across the groove
          const u = (now / (0.9 + k) + k * 3) % 1;
          if (i === 3) { _p.copy(v).addScaledVector(s.up, 0.1 * Math.sin(now * 2 + j)); place(0, _p, roll(q, 0.3 + j), 0.7, 0.07, WIND_W, 0.6 + 0.3 * Math.sin(now * 5 + j * 2)); continue; }
          _p.copy(v).addScaledVector(_go, 0.6 * u).add(_tg.set(0.08 * Math.sin(now * 3 + j + i), 0.1 * u - 1.6 * u * u, 0));
          place(i ? 0 : 5, _p, roll(q, now * 4 + i + j), i ? 0.08 : 0.2, i ? 0.08 : 0.2, i ? INK : LEAF[(i + j) % 6], 0.95 * (1 - sstep(u, 0.8, 1)));
        } else { // open: wind streams out of the grooves and curls up, carrying a leaf now and then
          const u = (now * 0.8 + k) % 1;
          _tg.copy(_go).multiplyScalar(0.9).addScaledVector(s.up, 0.7 + 0.3 * u);
          _p.copy(v).addScaledVector(_tg, 1.7 * u);
          place(0, _p, roll(q, Math.atan2(_tg.dot(_cu), _tg.dot(_cr))), 0.75 - 0.2 * k, 0.07, WIND_W, 0.8 * sstep(u, 0, 0.15) * (1 - sstep(u, 0.65, 1)));
          if (i === 0) place(5, _p.addScaledVector(_tg, 0.3), roll(q, now * 5 + j), 0.15, 0.15, LEAF[j % 6], 0.9 * sstep(u, 0, 0.1) * (1 - sstep(u, 0.8, 1)));
        }
      }
    });
  }
}

const _sun = new THREE.Vector3(), _side = new THREE.Vector3();
const FIN_FLOCKS = [[7.5, 1, 0.4], [11, -1, -0.6], [15, 1, 0.8]]; // [finale s, direction across the sun, height offset]
function ambient(now, cam) {
  const cp = cam.position;
  cairnFx(now, cam); gustFx(now, cam); ramFx(now, cam);
  for (const c of S.clouds) { // wisps drift and wrap around the camera; faded near it
    _p.set(cp.x + wrap(c.home.x + c.vx * now - cp.x, 480), c.home.y, cp.z + wrap(c.home.z + c.vz * now - cp.z, 480));
    place(7, _p, cam.quaternion, c.w, c.w * 0.18, c.col, c.a * sstep(_p.distanceTo(cp), 40, 110));
  }
  for (const f of S.flocks) for (const b of f.birds) {
    const th = f.w * now + b.ph, rad = f.r * b.k;
    _p.set(f.c.x + Math.cos(th) * rad, f.c.y + 2 * Math.sin(now * 0.5 + b.ph), f.c.z + Math.sin(th) * rad);
    place(3, _p, cam.quaternion, 2.6, 2.6, INK, 0.8, Math.sin(now * 5 + b.ph * 3));
  }
  const cw = S.reg.get('cut.world'), fin = cw?.fin ?? (S.finT === null ? -1 : now - S.finT);
  if (fin > 0) { // l3 finale: three small flocks cross the sun disc (placed ~70 m out along the sun direction, 4.5 s each)
    _sun.set(...SKY.sun).normalize(); _side.set(_sun.z, 0, -_sun.x).normalize();
    FIN_FLOCKS.forEach(([t0, dir, dy], j) => {
      const u = (fin - t0) / 4.5;
      if (u < 0 || u > 1) return;
      for (let i = 0; i < 6; i++) {
        const back = Math.ceil(i / 2) * 1.6, lat = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 1.3;
        _p.copy(cp).addScaledVector(_sun, 70 + lat).addScaledVector(_side, dir * ((u - 0.5) * 70 - back));
        _p.y += dy + 0.6 * Math.sin(i * 2.1 + j);
        place(3, _p, cam.quaternion, 1.8, 1.8, INK, 0.85 * sstep(u, 0, 0.1) * (1 - sstep(u, 0.9, 1)), Math.sin(now * 6 + i * 1.7 + j));
      }
    });
  }
  for (const m of S.motes) { // fixed-size box around the camera
    _p.set(cp.x + wrap(m.h[0] + 0.25 * now + 0.5 * Math.sin(now * 0.6 + m.ph) - cp.x, 18), cp.y + 1.5 + wrap(m.h[1] + 0.12 * now - cp.y, 9), cp.z + wrap(m.h[2] + 0.2 * now + 0.5 * Math.cos(now * 0.5 + m.ph) - cp.z, 18));
    const e = 1 - sstep(_p.distanceTo(cp), 5, 9);
    place(0, _p, cam.quaternion, m.s, m.s, GOLD, e * (0.35 + 0.25 * Math.sin(now * 1.7 + m.ph)));
  }
}

const BIRD = C('#5d554b'), MIST = C('#f6f2ec');
function life(now, cam) {
  const q = cam.quaternion, flags = S.reg.get('flags') ?? {};
  for (const g of S.perch) for (const b of g.birds) {
    const back = g.ret != null && now >= g.ret ? 3 - (now - g.ret) : null; // returning: the flight path run backwards over 3 s
    const age = back !== null ? Math.max(0, back * 2 - b.delay * 0.5) : g.t0 === null ? -1 : now - g.t0 - b.delay;
    if (age < 0) { // perched: a hop or a peck now and then
      const hop = Math.max(0, Math.sin(now * 1.3 + b.ph * 5)) ** 12;
      _p.copy(g.pos).add(b.o); _p.y += 0.12 + 0.15 * hop;
      place(3, _p, q, 0.34, 0.34, BIRD, 1, 0.3 + 0.5 * hop);
    } else if (age < 6) {
      _p.copy(g.pos).add(b.o).addScaledVector(b.d, age * 7);
      _p.y += 0.12 + age * 2.2 + age * age * 0.9;
      place(3, _p, q, 0.36 + age * 0.05, 0.36 + age * 0.05, BIRD, back !== null ? 1 : 1 - sstep(age, 4, 6), Math.sin(now * 22 + b.ph * 6));
    }
  }
  const open = S.sws.filter((w) => w.m.node && !flags[`switch.${w.m.id}`]);
  for (const w of open) for (let k = 0; k < 3; k++) { // a slow orbit around each rune still asleep
    const th = now * (0.7 + 0.15 * k) + k * 2.094, r = 0.95 + 0.15 * Math.sin(now * 0.9 + k);
    _p.set(w.pos.x + Math.cos(th) * r, w.pos.y + 1.1 + 0.35 * Math.sin(now * 1.3 + k * 1.7), w.pos.z + Math.sin(th) * r);
    place(0, _p, q, 0.13, 0.13, CREAM, 0.75 * sstep(now, 0, 1));
  }
  const gift = S.gifts.findLast((g) => now >= g.t && now < g.t + 3.2), gp = gift && S.reg.get('player'), ga = gp ? now - gift.t : -1;
  if (ga >= 0 && ga < 3.2) for (let k = 0; k < 8; k++) for (let j = 0; j < 5; j++) { // gift: 8 gold threads (5 beads each) arc from the NPC into the hero's back
    const u = clamp((ga - k * 0.12 - j * 0.04) / 1.6, 0, 1);
    if (u <= 0 || u >= 1) continue;
    const e = u * u * (3 - 2 * u), a = k * 0.785 + ga * 2;
    _v.set(gp.pos.x, gp.pos.y + 0.85, gp.pos.z);
    _p.lerpVectors(gift.from, _v, e); _p.y += Math.sin(e * Math.PI) * 1.6;
    _p.x += Math.cos(a) * 0.9 * (1 - e); _p.z += Math.sin(a) * 0.9 * (1 - e);
    place(0, _p, q, 0.3 - j * 0.04, 0.3 - j * 0.04, j ? GLOW : GOLD, (1 - j * 0.15) * sstep(u, 0, 0.1) * (1 - sstep(u, 0.9, 1)));
  }
  const sp = S.reg.get('spring'), sh = sp && S.reg.get('player');
  if (sh && sh.breath < sh.breathMax) for (let k = 0; k < 8; k++) for (let j = 0; j < 6; j++) { // wind cairn spring: gold beads spiral from the swirl into the cloak while it refills
    const u = (now * 0.8 + k / 8 - j * 0.03) % 1, e = u * u * (3 - 2 * u), a = k * 0.785 + now * 1.5;
    _v.set(sh.pos.x, sh.pos.y + 0.85, sh.pos.z);
    _p.set(sp.pos[0] + Math.cos(a) * 1.1, sp.pos[1] + 0.4 + 1.2 * ((k * 0.37) % 1), sp.pos[2] + Math.sin(a) * 1.1).lerp(_v, e);
    place(0, _p, q, 0.42 - j * 0.05, 0.42 - j * 0.05, j ? GLOW : GOLD, (1 - j * 0.12) * sstep(u, 0, 0.15) * (1 - sstep(u, 0.85, 1)));
  }
  for (const f of S.falls) for (let k = 0; k < 6; k++) { // mist rolling off the fall's fading end
    const u = (now / 3 + k / 6 + f.ph) % 1, a = k * 1.047 + f.ph * 6;
    _p.set(f.pos[0] + Math.cos(a) * (0.6 + 2.2 * u), f.pos[1] - 1 + 2.5 * u, f.pos[2] + Math.sin(a) * (0.6 + 2.2 * u));
    place(0, _p, q, 1.2 + 2.6 * u, 1.2 + 2.6 * u, MIST, 0.3 * sstep(u, 0, 0.2) * (1 - u));
  }
}

function particles(now, cam) {
  const cp = cam.position;
  for (const o of S.pool) {
    if (!o.on) continue;
    const age = now - o.t0, u = age / o.life;
    if (u >= 1) { o.on = false; continue; }
    if (age < 0) continue;
    const f = o.drag > 0 ? (1 - Math.exp(-o.drag * age)) / o.drag : age;
    _p.copy(o.p).addScaledVector(o.v, f); _p.y += 0.5 * o.g * age * age;
    const a = o.a * (o.curve === 1 ? sstep(u, 0, 0.15) * (1 - sstep(u, 0.7, 1)) : o.curve === 2 ? 1 - sstep(u, 0.6, 1) : (1 - u) * (1 - u)), sz = o.s0 + (o.s1 - o.s0) * (1 - (1 - u) * (1 - u));
    const near = sstep(_p.distanceTo(cp), 1.2, 3); // nothing smears across the lens: a sprite fades out before it reaches the camera
    if (near <= 0) continue;
    let q = cam.quaternion;
    if (o.kind === 'f') q = o.q;
    else if (o.kind === 'y') q = _qa.setFromAxisAngle(AX_Y, Math.atan2(cp.x - _p.x, cp.z - _p.z));
    else if (o.kind === 's') { // billboard whose long axis follows the streak's world direction on screen
      _s.copy(o.d).applyQuaternion(_qb.copy(cam.quaternion).invert());
      q = _qb.copy(cam.quaternion).multiply(_qa.setFromAxisAngle(AX_Z, Math.atan2(_s.y, _s.x)));
    }
    else if (o.rot || o.spin) q = _qb.copy(cam.quaternion).multiply(_qa.setFromAxisAngle(AX_Z, o.rot + o.spin * age));
    place(o.shape, _p, q, sz, o.h || sz, o.col, a * near);
  }
}

function windState(ctx, now, dt, snap) {
  const flags = ctx.registry.get('flags') ?? {}, pl = ctx.registry.get('player');
  S.winds.forEach((w, i) => {
    const on = flags[`wind.${w.id}`] ? 1 : 0, target = on * windScale(w.cycle, now);
    w.lv = snap || w.lv === undefined ? target : w.lv + clamp(target - w.lv, -2.5 * dt, 2.5 * dt);
    if (w.prev !== undefined && w.prev < 0.1 && w.lv >= 0.1 && pl && Math.hypot(pl.pos.x - (w.min[0] + w.max[0]) / 2, pl.pos.z - (w.min[2] + w.max[2]) / 2) < 25) S.punch = now;
    w.prev = w.lv;
    if (i < 4) { lookUniforms.wa.value[i].set(w.min[0], w.min[1], w.min[2], Math.max(Math.abs(w.lv), on && w.cycle ? 0.22 : 0)); lookUniforms.wb.value[i].set(...w.max); } // U5: grass and cloth keep breathing between gusts, like the streaks (level.js rest)
  });
}

function snapshot(ctx) {
  const cam = ctx.camera, model = ctx.registry.get('player.model'), objs = [];
  model?.traverse((o) => { if (o !== model) objs.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]); }); // root is posed by player.js from sim state
  return { pos: cam.position.clone(), quat: cam.quaternion.clone(), fov: cam.fov, objs };
}
function restore(ctx, f) {
  ctx.camera.position.copy(f.pos); ctx.camera.quaternion.copy(f.quat);
  for (const [o, p, q, s] of f.objs) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); }
}

export default {
  name: 'fx', order: 60, deps: ['level', 'player'],
  init(ctx) {
    const reg = ctx.registry, level = reg.get('level'), data = level?.data;
    S = { rng: ctx.rng, level, pool: Array.from({ length: POOL }, () => ({ on: false })), head: 0, jobs: [], kicks: [], wraps: [], gusts: [], unlocks: [], n: 0, hit: null, freeze: null, punch: -9, tLand: -9, kLand: 0, tJump: -9,
      clouds: [], flocks: [], motes: [], winds: [], sws: [], perch: [], falls: [], goal: null, finT: null, reg, bridges: {}, prevNow: null, scaled: false, fov: null, debris: null, dash: null, ghosts: [], gifts: [] };
    if (!data) return;
    const base = data.spawn?.pos?.[1] ?? 0, route = data.route ?? [];

    // sprite mesh: pool + ambient in one draw call
    const geo = new THREE.PlaneGeometry(1, 1);
    S.mArr = new Float32Array(CAP * 16); S.cArr = new Float32Array(CAP * 3); S.pArr = new Float32Array(CAP * 2); S.sArr = new Float32Array(CAP);
    const attrs = { aP: new THREE.InstancedBufferAttribute(S.pArr, 2), aShape: new THREE.InstancedBufferAttribute(S.sArr, 1) };
    for (const [k, a] of Object.entries(attrs)) { a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(k, a); }
    const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: false });
    const im = S.im = new THREE.InstancedMesh(geo, mat, CAP);
    im.instanceMatrix = new THREE.InstancedBufferAttribute(S.mArr, 16).setUsage(THREE.DynamicDrawUsage);
    im.instanceColor = new THREE.InstancedBufferAttribute(S.cArr, 3).setUsage(THREE.DynamicDrawUsage);
    im.layers.set(1); im.frustumCulled = false; im.name = 'fx__sprites'; im.renderOrder = 2;
    ctx.add(im);

    // ambient layout (own rng stream, fixed per level)
    for (let i = 0; i < 12; i++) S.clouds.push({ home: V(rr(-240, 240), base + (i % 3 ? rr(-45, -12) : rr(20, 45)), rr(-240, 240)), vx: rr(0.6, 2), vz: rr(-0.4, 0.4), w: rr(50, 100), a: rr(0.25, 0.4), col: i % 2 ? C('#fff8ec') : C('#e6d3d3') });
    for (let i = 0; i < 36; i++) S.motes.push({ h: [rr(0, 18), rr(0, 9), rr(0, 18)], ph: rr(0, 6.283), s: rr(0.05, 0.11) });
    for (const at of [0.3, 0.75]) {
      const pt = route[Math.floor((route.length - 1) * at)] ?? [0, 0, 0], side = at < 0.5 ? 55 : -55;
      S.flocks.push({ c: V(pt[0] + side, pt[1] + 22, pt[2] + 10), r: rr(16, 26), w: rr(0.12, 0.2) * (at < 0.5 ? 1 : -1), birds: Array.from({ length: 7 }, () => ({ ph: rr(0, 6.283), k: rr(0.6, 1.1) })) });
    }
    for (const m of data.mechanisms ?? []) {
      if (m.kind === 'wind' && m.area?.kind === 'box') S.winds.push({ id: m.id, min: m.area.min, max: m.area.max, cycle: m.cycle });
      if (m.kind === 'switch') {
        const pos = m.pos ?? ctx.scene.getObjectByName(m.node)?.position.toArray();
        if (pos) S.sws.push({ m, pos: V(...pos) });
      }
      if (m.kind === 'bridge') S.bridges[m.id] = { m, bases: (m.nodes ?? []).map((n) => ctx.scene.getObjectByName(n)?.getWorldPosition(V())).filter(Boolean) };
    }

    // creatures: own stream, so the layout above and emission draws stay as they were
    const lr = mulberry32((ctx.params.seed ^ hash('fx.life')) >>> 0), lrr = (a, b) => a + (b - a) * lr();
    S.falls = (data.falls ?? []).map((f) => ({ pos: f.pos, ph: lr() }));
    for (const at of [0.12, 0.35, 0.58, 0.8]) {
      const i = Math.floor((route.length - 1) * at), pt = route[i], nx = route[i + 1];
      if (!pt || !nx) continue;
      const hx = nx[0] - pt[0], hz = nx[2] - pt[2], hl = Math.hypot(hx, hz) || 1, side = lr() < 0.5 ? -1 : 1, off = lrr(2.5, 4);
      const x = pt[0] - (hz / hl) * side * off, z = pt[2] + (hx / hl) * side * off, g = level.collide.groundAt(x, z, pt[1] + 3);
      if (!g || Math.abs(g.y - pt[1]) > 2.5) continue;
      const n = 3 + Math.floor(lr() * 3), away = Math.atan2(-hz * side, hx * side); // they flee off the route's side
      S.perch.push({ pos: V(x, g.y, z), t0: null, birds: Array.from({ length: n }, () => {
        const a = away + lrr(-0.9, 0.9);
        return { o: V(lrr(-0.7, 0.7), 0, lrr(-0.7, 0.7)), ph: lr(), delay: lrr(0, 0.35), d: V(Math.sin(a), 0, Math.cos(a)) };
      }) });
    }

    // floating debris: small stones bobbing in free air beside the route (lit and outlined like the level; look.js styles them)
    const geoD = new THREE.DodecahedronGeometry(1, 0), matD = new THREE.MeshStandardMaterial({ color: '#b9b0b8', roughness: 1, flatShading: true });
    matD.name = 'stone';
    const N = 28, debris = S.debris = { im: new THREE.InstancedMesh(geoD, matD, N), items: [] };
    for (let tries = 0; debris.items.length < N && tries < 400 && route.length; tries++) {
      const pt = route[Math.floor(rr(0, route.length))], side = S.rng() < 0.5 ? -1 : 1, x = pt[0] + side * rr(4, 12), z = pt[2] + rr(-5, 5), y = pt[1] + rr(0.5, 7), g = level.collide.groundAt(x, z, y + 40);
      if (g && g.y > y - 3.5) continue; // inside or just above an island
      debris.items.push({ h: V(x, y, z), amp: rr(0.15, 0.35), per: rr(4, 7), ph: rr(0, 6.283), s: V(rr(0.15, 0.5), rr(0.1, 0.35), rr(0.15, 0.5)), spin: rr(-0.3, 0.3), yaw: rr(0, 6.283) });
    }
    debris.im.count = debris.items.length; debris.im.frustumCulled = false; debris.im.name = 'fx__debris';
    ctx.add(debris.im);
    reg.set('look.refresh');

    // events
    reg.on('player.land', ({ t, pos, impact }) => {
      if (impact < 2.5) return;
      const k = clamp(impact / 14, 0.15, 1), kind = surfaceAt(pos);
      puffs(t, pos, 4 + Math.round(10 * k), { r: 0.5, speed: [0.8 * (0.5 + k), 2.2 * (0.5 + k)], up: [0.3, 0.3 + k], size: [0.2, 0.45 + 0.4 * k], a: 0.45 + 0.2 * k, col: DUST[kind] });
      S.tLand = t; S.kLand = k;
      for (let i = 0; i < 6; i++) { // landed near an edge: a few pebbles kicked off it, tumbling into the clouds
        const a = (i / 6) * 6.283, ex = pos[0] + Math.cos(a) * 1.1, ez = pos[2] + Math.sin(a) * 1.1, g = S.level.collide.groundAt(ex, ez, pos[1] + 0.5);
        if (g && g.y > pos[1] - 1.5) continue;
        spread(3 + Math.round(3 * k), () => emit({ t0: t, shape: 6, p: _p.set(pos[0] + Math.cos(a) * 0.5, pos[1] + 0.05, pos[2] + Math.sin(a) * 0.5),
          v: _v.set(Math.cos(a) * rr(1, 2.5) + rr(-0.4, 0.4), rr(1, 2.5), Math.sin(a) * rr(1, 2.5) + rr(-0.4, 0.4)), g: -12, drag: 0.2, life: rr(1.2, 1.8), s0: rr(0.05, 0.1), s1: 0.04,
          col: CHIP[Math.floor(S.rng() * 3)], a: 1, curve: 2, spin: rr(-10, 10), rot: rr(0, 6) }));
        break;
      }
      if (impact > 9) kick(t, { d: 0.1 * k, tau: 0.18 });
    });
    reg.on('player.step', ({ t, pos, surface }) => { if (surface === 'grass') puffs(t, pos, 2, { r: 0.25, speed: [0.3, 0.8], up: [0.1, 0.4], size: [0.1, 0.26], life: [0.35, 0.6], a: 0.35, col: DUST.grass }); });
    reg.on('player.jump', ({ t, pos }) => { puffs(t, pos, 5, { r: 0.4, speed: [0.6, 1.4], up: [0.2, 0.6], size: [0.12, 0.34], a: 0.4, col: DUST[surfaceAt(pos)] }); S.tJump = t; });
    reg.on('player.strike', ({ t }) => {
      const st = reg.get('strike.target'), sw = st?.t === t && st.id ? S.sws.find((w) => w.m.id === st.id) : null; // level.js resolved it first
      const target = sw ? { sw } : null;
      const br = target && st.stones && (sw.m.targets ?? []).map((id) => S.bridges[id]).find(Boolean);
      if (br) bridgeRise(t, br);
      S.pending = { t, target };
    });
    // singing: the staff tip traces a gold glyph in the air over SING_T s (a ring, then a stroke down its middle), facing the
    // rune in reach (or ahead); released early it is wiped. The rune answering ('sing.done' ok): the strike-hit burst on the rune.
    reg.on('sing.target', ({ t, id }) => {
      const pl = reg.get('player'), sw = id ? S.sws.find((w) => w.m.id === id) : null; if (!pl) return;
      const h = sw ? Math.atan2(sw.pos.x - pl.pos.x, sw.pos.z - pl.pos.z) : pl.heading, [dx, dz] = dir(h), c = V(pl.pos.x + dx * 0.75, pl.pos.y + 1.75, pl.pos.z + dz * 0.75);
      S.glyph = [];
      for (let i = 0; i < 28; i++) {
        const u = i / 28, ring = i < 20, a = (ring ? i / 20 : 0) * 6.283, k = ring ? 0 : (i - 20) / 7, x = ring ? Math.sin(a) * 0.38 : 0, y = ring ? Math.cos(a) * 0.38 : 0.38 - 0.76 * k;
        S.glyph.push(emit({ t0: t + u * SING_T, shape: 0, p: _p.set(c.x + dz * x, c.y + y, c.z - dx * x), v: _v.set(0, 0.05, 0), drag: 2, life: SING_T * (1 - u) + 0.9, s0: 0.11, s1: 0.05, col: GOLD, a: sw ? 1 : 0.5 }));
      }
    });
    // gift songs: the same glyph traced twice as fast in the song's colour; 'song.done' (level.js) shows what it did: gust a cone of
    // streaks ahead (and dust blown off the rune it bared), name the rune burst, anchor a blue ring around what it holds, a wasted
    // song only fades
    reg.on('song.stage', ({ t, stage, song }) => { // a stage reached: a ring bursts off the staff tip, wider each time
      const pl = reg.get('player'); if (!pl) return;
      emit({ t0: t, shape: 1, p: _p.set(pl.pos.x, pl.pos.y + 1.9, pl.pos.z), life: 0.35, s0: 0.3, s1: 1 + 0.5 * stage, col: SONG_COL[song] ?? GOLD, a: 0.9 });
      spread(3 * stage, () => { const a2 = rr(0, 6.283); emit({ t0: t, shape: 0, p: _p.set(pl.pos.x, pl.pos.y + 1.9, pl.pos.z), v: _v.set(Math.cos(a2) * 1.5, rr(0.2, 1.4), Math.sin(a2) * 1.5), drag: 2.5, life: rr(0.3, 0.5), s0: 0.09, s1: 0.03, col: CREAM, a: 0.9 }); });
    });
    reg.on('song.cast', (c) => { S.cast = c; });
    // no glyph hung in the air over the opened knot ('enemy.demo') or before an answering shrine: it read as a hint icon. The knot hangs open and the song sounds; the stone's own carving glows.
    reg.on('shrine.answer', ({ t, song, pos }) => { // level.js U18: the stone sings back: a ring off its face and motes of the song's colour rising out of the carving
      const pl = reg.get('player'), to = pl ? pl.pos.toArray() : [pos[0], pos[1], pos[2] + 2], dx = to[0] - pos[0], dz = to[2] - pos[2], L = Math.hypot(dx, dz) || 1, col = SONG_COL[song] ?? GOLD;
      emit({ t0: t, shape: 1, p: _p.set(pos[0], pos[1] + 1.4, pos[2]), life: 0.6, s0: 0.4, s1: 2.6, col, a: 0.8 });
      spread(30, () => { const a = rr(0, 6.283), r = rr(0.3, 0.6); emit({ t0: t + rr(0, 1.2), shape: 0, p: _p.set(pos[0] + Math.cos(a) * r, pos[1] + rr(0.3, 2.2), pos[2] + Math.sin(a) * r), v: _v.set(Math.cos(a) * 0.3, rr(0.4, 1.0), Math.sin(a) * 0.3), drag: 1.2, life: rr(0.9, 1.6), s0: 0.1, s1: 0.03, col: S.rng() < 0.7 ? col : CREAM, a: 0.85 }); });
    });
    reg.on('song.fail', ({ t, song, pos }) => { const pl = reg.get('player'); fizzle(t, pl ? [pl.pos.x, pl.pos.y + 1.2, pl.pos.z] : pos, SONG_COL[song] ?? CREAM); });
    reg.on('song.done', ({ t, song, id, pos: at }) => {
      const pl = reg.get('player'); if (!pl) return;
      const col = SONG_COL[song], h = pl.heading, [dx, dz] = dir(h);
      if (!id && song !== 'gust') return fizzle(t, [pl.pos.x, pl.pos.y + 1.2, pl.pos.z], col);
      if (song === 'gust') { // streaks fanning out in the 40-degree cone as far as the charge reached (songs.js gustReach), dust off the ground
        const reach = S.cast?.t === t ? S.cast.reach : 4;
        if (!id) puffs(t, [pl.pos.x + dx * 0.8, pl.pos.y, pl.pos.z + dz * 0.8], 6, { r: 0.6, speed: [0.5, 1.2], up: [0.1, 0.4], size: [0.15, 0.4], life: [0.4, 0.7], a: 0.35, col: DUST[surfaceAt(pl.pos.toArray())] });
        spread(10, (i) => { const a = h + (i / 9 - 0.5) * 0.7, sp = reach * 1.6; emit({ t0: t + rr(0, 0.05), shape: 0, p: _p.set(pl.pos.x + dx * 0.6, pl.pos.y + 0.12, pl.pos.z + dz * 0.6), v: _v.set(Math.sin(a) * sp, 0.3, Math.cos(a) * sp), drag: 1.6, life: rr(0.6, 0.9), s0: 0.18, s1: 0.5, col: DUST.stone, a: 0.4 }); });
        spread(26, () => {
          const a = h + rr(-0.35, 0.35), sp = rr(1.2, 2.2) * reach;
          emit({ t0: t, shape: 0, p: _p.set(pl.pos.x + dx * 0.6, pl.pos.y + rr(0.4, 1.4), pl.pos.z + dz * 0.6), v: _v.set(Math.sin(a) * sp, rr(-0.2, 0.6), Math.cos(a) * sp), drag: 2.2, life: rr(0.5, 0.8), s0: 0.12, s1: 0.03, col: S.rng() < 0.6 ? col : CREAM, a: 0.8 });
        });
        if (at) puffs(t, at, 18, { r: 1.2, speed: [1.2, 3], up: [0.3, 1.2], size: [0.2, 0.55], life: [0.7, 1.2], a: 0.5, col: DUST.stone });
        const stg = S.cast?.t === t ? S.cast.stage : 1;
        S.gusts.push({ t0: t, x: pl.pos.x, y: pl.pos.y, z: pl.pos.z, h, reach, stage: stg }); // leaves, petals and torn grass ride the cone: more of them with every stage
        spread(3 + 4 * stg, (i) => { const a = h + rr(-0.33, 0.33), sp = rr(0.9, 1.7) * reach; emit({ t0: t + rr(0, 0.08), shape: i % 3 ? 5 : 8, p: _p.set(pl.pos.x + dx * 0.7, pl.pos.y + rr(0.1, 1.1), pl.pos.z + dz * 0.7), v: _v.set(Math.sin(a) * sp, rr(0.2, 1.4), Math.cos(a) * sp), g: -2.5, drag: 1.5, life: rr(0.7, 1.2), s0: i % 3 ? 0.16 : 0.22, s1: 0.1, col: i % 3 ? LEAF[i % 6] : BLADE[i % 3], a: 1, curve: 2, spin: rr(-9, 9) }); });
        spread(2 + 2 * stg, (i) => { const u = (i + 1) / (3 + 2 * stg); emit({ t0: t + 0.03 * i, shape: 0, kind: 's', d: V(dx, 0, dz), p: _p.set(pl.pos.x + dx * (0.6 + reach * u * 0.5), pl.pos.y + rr(0.3, 1.5), pl.pos.z + dz * (0.6 + reach * u * 0.5)), v: _v.set(dx * reach * 1.3, 0, dz * reach * 1.3), drag: 2.4, life: rr(0.3, 0.5), s0: 0.9, s1: 0.4, h: 0.05, col: WIND_W, a: 0.75 }); });
        kick(t, { f: 0.02 + 0.015 * stg, tau: 0.12 });
        return;
      }
      if (!id || !at) { for (const o of S.glyph ?? []) o.life = Math.min(o.life, 0.3); return; }
      if (song === 'name') { const sw = S.sws.find((w) => w.m.id === id); if (sw) { strikeHit(t, pl.pos.toArray(), Math.atan2(sw.pos.x - pl.pos.x, sw.pos.z - pl.pos.z), { sw }); S.wraps.push({ kind: 'name', t0: t, dur: 0.4, at, r: 0.6 }); later(t + 0.4, () => unravel(t + 0.4, at, 18)); } }
      if (song === 'anchor') S.wraps.push({ kind: 'anchor', t0: t, dur: S.cast?.t === t ? S.cast.hold : 1, at, r: 1.3 });
      if (song === 'anchor') spread(12, (i) => { const a = (i / 12) * 6.283; emit({ t0: t + i * 0.02, shape: 6, p: _p.set(at[0] + Math.cos(a) * 1.3, at[1] + 0.4, at[2] + Math.sin(a) * 1.3), v: _v.set(-Math.cos(a) * 0.6, 0.1, -Math.sin(a) * 0.6), drag: 2, life: 1.6, s0: 0.12, s1: 0.1, col: SONG_COL.anchor, a: 1, curve: 2, rot: a }); });
      emit({ t0: t, shape: song === 'anchor' ? 1 : 2, p: _p.set(at[0], at[1] + 0.3, at[2]), life: song === 'anchor' ? 2 : 0.8, s0: 1.4, s1: song === 'anchor' ? 1.8 : 2.6, col, a: 1 });
      spread(10, () => emit({ t0: t, shape: 0, p: _p.set(at[0] + rr(-1, 1), at[1] + rr(0, 0.6), at[2] + rr(-1, 1)), v: _v.set(0, rr(0.2, 0.6), 0), drag: 1.5, life: rr(1, 1.8), s0: 0.1, s1: 0.03, col, a: 0.9 }));
    });
    reg.on('player.singEnd', ({ done }) => { if (!done) for (const o of S.glyph ?? []) o.life = 1e-6; S.glyph = null; });
    reg.on('sing.done', ({ t, id, ok, stones }) => {
      const sw = id ? S.sws.find((w) => w.m.id === id) : null, pl = reg.get('player'); if (!sw || !pl) return;
      if (!ok) { for (const o of S.glyph ?? []) o.life = 1e-6; return; }
      strikeHit(t, pl.pos.toArray(), Math.atan2(sw.pos.x - pl.pos.x, sw.pos.z - pl.pos.z), { sw });
      const br = stones && (sw.m.targets ?? []).map((k) => S.bridges[k]).find(Boolean);
      if (br) bridgeRise(t, br);
    });
    reg.on('player.strikeHit', ({ t, pos, combo }) => {
      const pend = S.pending, heading = reg.get('player')?.heading ?? 0;
      strikeHit(t, pos, heading, pend && t - pend.t < 1.5 ? pend.target : null);
      if (combo === 3) { // overhead slam: the staff hits the ground ahead, a ring of dust and a heavier jolt
        const [dx, dz] = dir(heading), at = [pos[0] + dx * 0.9, pos[1], pos[2] + dz * 0.9];
        puffs(t, at, 12, { r: 0.6, speed: [1.2, 3], up: [0.2, 0.9], size: [0.15, 0.5], life: [0.5, 0.9], a: 0.5, col: DUST[surfaceAt(at)] });
        kick(t, { d: 0.08, s: 0.03, tau: 0.15 });
      }
    });
    reg.on('player.dash', dashBurst); reg.on('npc.dash', dashBurst); // npc.js: a giver shows the dash / airdash once
    // R3 Knot Shards (enemies.js): telegraph flare, knock (hit-stop + kick + dust), stun / stagger bursts, the shock rings, the unbind
    const at = (pos, dy = 0) => [pos[0], pos[1] + dy, pos[2]];
    reg.on('enemy.telegraph', ({ t, pos, kind }) => { emit({ t0: t, shape: 1, p: _p.set(...at(pos, kind === 'squall' ? 0 : 1)), life: kind === 'squall' ? 0.6 : 0.8, s0: 2.2, s1: 0.6, col: CREAM, a: 0.9, curve: 1 });
      const h = reg.get('player')?.pos; // a squall's wind-up drags the dust off the ground along the line it will take
      if (kind === 'squall' && h) for (let i = 1; i <= 4; i++) { const u = i / 5, q = [pos[0] + (h.x - pos[0]) * u, h.y + 0.05, pos[2] + (h.z - pos[2]) * u]; puffs(t + 0.12 * i, q, 3, { r: 0.25, speed: [0.3, 0.9], up: [0.3, 0.9], size: [0.15, 0.35], life: [0.5, 0.8], a: 0.4, col: DUST[surfaceAt(q)] }); }
    });
    reg.on('enemy.knock', ({ t, pos, dir: [kx, kz] }) => {
      S.hit = { t, hold: 0.07 }; kick(t, { f: 0.1, s: 0.05, d: 0.06, tau: 0.18 });
      spread(8, () => { const sp = rr(1, 2.2); emit({ t0: t, shape: 0, kind: 's', d: V(kx, 0.2, kz), p: _p.set(pos[0] - kx * 0.7, pos[1] + rr(0.6, 1.4), pos[2] - kz * 0.7), v: _v.set(kx * sp + rr(-0.5, 0.5), rr(0, 0.6), kz * sp + rr(-0.5, 0.5)), drag: 3, life: rr(0.2, 0.32), s0: 0.2, s1: 0.05, h: 0.04, col: CREAM, a: 0.9 }); });
      puffs(t, pos, 8, { r: 0.5, speed: [1, 2.5], up: [0.2, 0.7], size: [0.15, 0.4], life: [0.4, 0.7], a: 0.45, col: DUST[surfaceAt(pos)] });
    });
    const daze = ({ t, pos, kind }) => {
      S.hit = { t, hold: HOLD }; kick(t, { f: 0.08, s: 0.02, tau: 0.14 });
      const c = at(pos, kind === 'squall' ? 0 : 1.1);
      emit({ t0: t, shape: 1, p: _p.set(...c), life: 0.4, s0: 0.5, s1: 2.4, col: CREAM, a: 1 });
      spread(12, () => { const a = rr(0, 6.283), sp = rr(2, 4.5); emit({ t0: t, shape: 0, p: _p.set(...c), v: _v.set(Math.cos(a) * sp, rr(0.5, 2.5), Math.sin(a) * sp), g: -6, drag: 1.5, life: rr(0.35, 0.6), s0: 0.14, s1: 0.04, col: S.rng() < 0.5 ? GOLD : CREAM, a: 1 }); });
      if (kind !== 'squall') puffs(t, pos, 12, { r: 1, speed: [1, 2.4], up: [0.2, 0.8], size: [0.25, 0.6], life: [0.6, 1], a: 0.45, col: DUST.rubble });
    };
    reg.on('enemy.stun', daze); reg.on('enemy.stagger', daze);
    reg.on('enemy.hit', ({ t, pos }) => { S.hit = { t, hold: 0.04 }; spread(6, () => emit({ t0: t, shape: 6, p: _p.set(pos[0], pos[1] + 1, pos[2]), v: _v.set(rr(-2, 2), rr(1, 3), rr(-2, 2)), g: -14, drag: 0.4, life: rr(0.5, 0.8), s0: 0.08, s1: 0.03, col: CHIP[Math.floor(S.rng() * 3)], a: 1, curve: 2, spin: rr(-12, 12) })); });
    reg.on('enemy.ring', ({ t, pos }) => { kick(t, { s: 0.02, tau: 0.2 }); puffs(t, pos, 10, { r: 1.6, speed: [2, 4], up: [0.1, 0.4], size: [0.3, 0.7], life: [0.6, 1], a: 0.4, col: DUST.stone }); });
    reg.on('enemy.unbind', ({ t, pos, kind }) => { // the Name: gold ribbons wind in round the knot, then it unravels
      const c = at(pos, kind === 'squall' || kind === 'minion' ? 0 : 1), big = kind === 'boss';
      S.wraps.push({ kind: 'name', t0: t, dur: 0.4, at: [c[0], c[1] - 0.6, c[2]], r: big ? 1.8 : kind === 'warden' ? 1 : 0.6 });
      later(t + 0.35, () => { unravel(t + 0.35, c, big ? 40 : 26); kick(t + 0.35, { f: 0.06, tau: 0.3 }); });
    });
    // U9: every blow and song answers. flinch = a puff knocked off the knot; counter (hit in its telegraph) = a white flash + 80 ms
    // slow-down; shrug (nothing to take) = the knot pulls tight, a dull ink ring closing; disperse = blown away in wisps; rebind =
    // the open knot closes again; shatter = shards and a dark burst (no gold: nothing was freed); drop.pick = a gold glint.
    reg.on('enemy.flinch', ({ t, pos }) => { S.hit = { t, hold: 0.03 }; puffs(t, pos, 7, { r: 0.4, speed: [1.2, 2.6], up: [0.2, 0.9], size: [0.15, 0.4], life: [0.3, 0.55], a: 0.6, col: WIND_W }); emit({ t0: t, shape: 1, p: _p.set(...pos), life: 0.25, s0: 0.6, s1: 1.6, col: CREAM, a: 0.8 }); });
    reg.on('enemy.counter', ({ t, pos, kind }) => {
      const c = at(pos, kind === 'squall' ? 0 : 1.1);
      S.hit = { t, hold: 0.08 }; kick(t, { f: 0.1, s: 0.03, tau: 0.16 });
      emit({ t0: t, shape: 0, p: _p.set(...c), life: 0.22, s0: 4.5, s1: 1.2, col: CREAM, a: 1 });
      emit({ t0: t, shape: 1, p: _p.set(...c), life: 0.5, s0: 0.8, s1: 4.2, col: GOLD, a: 1 });
    });
    reg.on('song.reject', ({ t, pos, motif, half }) => { // U25 by motif: boulder shudders dust, cords flutter gold, slab sheds grit; half: a faint gold swell
      if (half) return emit({ t0: t, shape: 1, p: _p.set(pos[0], pos[1] + 0.8, pos[2]), q: _qf, life: 1.2, s0: 1, s1: 3, col: GOLD, a: 0.5 });
      if (motif) puffs(t, [pos[0], pos[1] + 0.6, pos[2]], 8, { r: 0.8, speed: [0.6, 1.6], up: [0.2, 1], size: [0.15, 0.4], life: [0.5, 0.8], a: 0.5, col: motif === 'cords' ? GOLD : motif === 'slab' ? DUST.rubble : DUST.stone });
      for (let i = 0; i < 2; i++) emit({ t0: t + i * 0.08, shape: 1, p: _p.set(pos[0], pos[1] + 0.5 + i * 0.6, pos[2]), q: _qf, life: 0.4, s0: 2, s1: 7, col: WIND_W, a: 0.8 }); kick(t, { f: 14, s: 0.05, d: 0.25, tau: 0.1 }); });
    reg.on('rune.unlock', (u) => { S.unlocks.push({ ...u, t0: u.t }); later(u.t + (u.from ? TRAVEL : 0), () => { for (let i = 0; i < 10; i++) emit({ t0: u.t + (u.from ? TRAVEL : 0), shape: 7, p: _p.set(u.pos[0], u.pos[1] + 0.5 + i * 0.15, u.pos[2]), v: _tg.set(Math.sin(i * 2.4) * 2.5, 1.5 + (i % 3), Math.cos(i * 2.4) * 2.5), g: -0.5, drag: 1.2, life: 0.9, s0: 0.5, s1: 1.1, col: WIND_W, a: 0.7 }); }); });
    reg.on('enemy.shrug', ({ t, pos, kind }) => { const c = at(pos, kind === 'squall' || kind === 'minion' ? 0 : 1.1); emit({ t0: t, shape: 1, p: _p.set(...c), life: 0.3, s0: kind === 'boss' ? 5 : 2.4, s1: 0.8, col: INK, a: 0.9, curve: 1 }); puffs(t, c, 4, { r: 0.3, speed: [0.3, 0.8], up: [0, 0.3], size: [0.12, 0.3], life: [0.3, 0.5], a: 0.4, col: INK }); });
    reg.on('enemy.rebind', ({ t, pos }) => { emit({ t0: t, shape: 1, p: _p.set(...at(pos, 1.2)), life: 0.6, s0: 5, s1: 1, col: INK, a: 0.9, curve: 1 }); kick(t, { s: 0.02, tau: 0.2 }); });
    reg.on('enemy.disperse', ({ t, pos }) => { const pl = reg.get('player'), L = Math.hypot(pos[0] - pl.pos.x, pos[2] - pl.pos.z) || 1, ux = (pos[0] - pl.pos.x) / L, uz = (pos[2] - pl.pos.z) / L;
      spread(14, () => { const sp = rr(3, 7); emit({ t0: t + rr(0, 0.2), shape: 0, kind: 's', d: V(ux, 0.2, uz), p: _p.set(pos[0] + rr(-0.5, 0.5), pos[1] + rr(-0.5, 0.5), pos[2] + rr(-0.5, 0.5)), v: _v.set(ux * sp + rr(-1, 1), rr(0, 1.5), uz * sp + rr(-1, 1)), drag: 1.2, life: rr(0.5, 0.9), s0: 0.6, s1: 0.15, h: 0.06, col: S.rng() < 0.3 ? INK : WIND_W, a: 0.8 }); }); });
    reg.on('enemy.shatter', ({ t, pos }) => { S.hit = { t, hold: HOLD }; kick(t, { f: 0.08, s: 0.04, tau: 0.2 }); emit({ t0: t, shape: 0, p: _p.set(pos[0], pos[1] + 0.5, pos[2]), life: 0.35, s0: 1, s1: 3.6, col: INK, a: 0.8 }); puffs(t, pos, 14, { r: 0.6, speed: [1, 3], up: [0.2, 1], size: [0.25, 0.6], life: [0.7, 1.2], a: 0.55, col: INK }); });
    reg.on('drop.pick', ({ t, pos, kind }) => { emit({ t0: t, shape: 1, p: _p.set(...pos), life: 0.35, s0: 0.2, s1: 1.2, col: kind === 'breath' ? CREAM : GOLD, a: 1 }); spread(6, () => emit({ t0: t, shape: 0, p: _p.set(...pos), v: _v.set(rr(-1, 1), rr(0.6, 2), rr(-1, 1)), g: -3, drag: 1.5, life: rr(0.4, 0.7), s0: 0.1, s1: 0.03, col: GOLD, a: 1 })); });
    reg.on('enemy.phase', ({ t, pos }) => { emit({ t0: t, shape: 1, p: _p.set(...at(pos, 1.2)), life: 0.9, s0: 1, s1: 5, col: GOLD, a: 0.9 }); kick(t, { s: 0.03, tau: 0.25 }); });
    reg.on('player.puff', ({ t, pos }) => { // dash press before Kamen's gift: a breath of cream at the chest, scuffed dust at the feet
      puffs(t, [pos[0], pos[1] + 0.6, pos[2]], 3, { r: 0.2, speed: [0.3, 0.7], up: [0.1, 0.4], size: [0.08, 0.2], life: [0.3, 0.5], a: 0.35, col: CREAM });
      puffs(t, pos, 5, { r: 0.35, speed: [0.5, 1.2], up: [0.1, 0.35], size: [0.12, 0.3], life: [0.4, 0.7], a: 0.4, col: DUST[surfaceAt(pos)] });
    });
    reg.on('mech.dock', ({ t, pos }) => puffs(t, [pos[0], pos[1] - 0.1, pos[2]], 12, { r: 2.2, speed: [0.6, 1.6], up: [0.1, 0.5], size: [0.25, 0.6], life: [0.6, 1.0], a: 0.4, col: DUST.stone })); // lift arrives (level.js)
    reg.on('crumble.warn', ({ t, pos }) => spread(5, () => emit({ t0: t + rr(0, 0.5), shape: 6, p: _p.set(pos[0] + rr(-1, 1), pos[1] - 0.2, pos[2] + rr(-1, 1)), v: _v.set(rr(-0.3, 0.3), rr(-0.5, 0), rr(-0.3, 0.3)),
      g: -12, drag: 0.3, life: rr(0.6, 0.9), s0: rr(0.04, 0.08), s1: 0.03, col: CHIP[Math.floor(S.rng() * 3)], a: 1, curve: 2, spin: rr(-8, 8), rot: rr(0, 6) }))); // grit trickles from under the slab
    reg.on('trial.creak', ({ t, pos, n }) => puffs(t, pos, n, { r: 0.5, speed: [0.3, 1.1], up: [-0.2, 0.4], size: [0.15, 0.4], life: [0.6, 1.1], a: 0.45, col: DUST.stone })); // trials.js: the cracked pillar creaks, dust breathes out of its fissures
    reg.on('npc.standup', ({ t, pos }) => puffs(t + 0.25, pos, 16, { r: 1.6, speed: [0.6, 1.8], up: [0.2, 0.8], size: [0.3, 0.7], life: [0.7, 1.2], a: 0.5, col: DUST.rubble })); // Kamen heaves up
    reg.on('wake', ({ t }) => { for (const g of S.perch) if (g.t0 !== null && t - g.t0 > 6) g.ret = t; }); // a rune wakes: fled birds fly back
    reg.on('gift', ({ t, from }) => { // npc.js / a song-shrine (level.js): gold threads stream into the cloak; a second gift waits for the first to land
      const g = { t: Math.max(t, (S.gifts.at(-1)?.t ?? -9) + 2.8), from: V(...from) };
      S.gifts.push(g); kick(g.t, { f: 0.05, tau: 0.3 });
    });
    reg.on('break', ({ t, pos, size: [w, h], rotY }) => { // wall gives way (level.js): stone chips flung out both faces, dust at its foot
      const ax = [Math.cos(rotY), -Math.sin(rotY)], nz = [Math.sin(rotY), Math.cos(rotY)]; // wall's local x and its face normal
      spread(28, () => {
        const u = rr(-0.5, 0.5) * w, y = pos[1] + rr(-0.5, 0.5) * h, side = S.rng() < 0.5 ? -1 : 1, sp = rr(1, 4.5);
        emit({ t0: t, shape: 6, p: _p.set(pos[0] + ax[0] * u, y, pos[2] + ax[1] * u), v: _v.set(nz[0] * side * sp + rr(-1.2, 1.2), rr(1, 4), nz[1] * side * sp + rr(-1.2, 1.2)),
          g: -16, drag: 0.4, life: rr(0.8, 1.3), s0: rr(0.08, 0.2), s1: 0.04, col: CHIP[Math.floor(S.rng() * 3)], a: 1, curve: 2, spin: rr(-10, 10), rot: rr(0, 6) });
      });
      puffs(t, [pos[0], pos[1] - h / 2, pos[2]], 14, { r: w, speed: [0.8, 2.6], up: [0.3, 1.2], size: [0.3, 1.0], life: [0.8, 1.3], a: 0.5, col: DUST.stone });
      kick(t, { s: 0.03, tau: 0.25 });
    });
    S.ghosts = makeGhosts(reg.get('player.model'));
    for (const G of S.ghosts) ctx.add(G.g);
    reg.on('player.respawn', () => { S.tLand = S.tJump = -9; S.dash = null; });
    reg.on('end', (v) => { if (v === 'goal') goalBurst(ctx.game.t, data.goal); });
    reg.on('world.finale', ({ t, pos }) => { // l3: the last Keeper freed, a ring of petals blown out from the crown
      S.finT = t;
      spread(60, () => {
        const ang = rr(0, 6.283), sp = rr(5, 11);
        emit({ t0: t + rr(0, 0.3), shape: 5, p: _p.set(pos[0] + Math.cos(ang) * 1.5, pos[1] + rr(0.5, 2.5), pos[2] + Math.sin(ang) * 1.5), v: _v.set(Math.cos(ang) * sp, rr(1, 4), Math.sin(ang) * sp),
          g: -0.8, drag: 0.6, life: rr(3, 4.5), s0: rr(0.12, 0.22), s1: 0.14, col: PETAL[Math.floor(S.rng() * 3)], a: 1, curve: 2, spin: rr(-5, 5), rot: rr(0, 6) });
      });
    });
  },
  dispose() { // the engine only detaches ctx.add objects: free the GPU resources here
    for (const m of [S?.im, S?.debris?.im]) { m?.geometry.dispose(); m?.material.dispose(); m?.dispose(); }
    for (const G of S?.ghosts ?? []) G.mat.dispose(); // geometry and skeleton bind data are shared with the hero
    S = null;
  },
  update(ctx) { // sim time: perched birds take off, scheduled emissions (bridge slabs arriving)
    if (!S) return;
    const t = ctx.game.t, pl = ctx.registry.get('player');
    for (const g of S.perch) if (g.ret != null && t >= g.ret + 3) { g.t0 = null; g.ret = null; } // landed back on the perch
    const fast = pl && Math.hypot(pl.vel.x, pl.vel.z) > pl.tuning.jog + 0.5; // running/sprinting startles them from further off
    if (pl) for (const g of S.perch) if (g.t0 === null && Math.hypot(pl.pos.x - g.pos.x, pl.pos.z - g.pos.z) < (fast ? 10 : 6) && Math.abs(pl.pos.y - g.pos.y) < 4) {
      g.t0 = t; ctx.registry.set('audio.cue', { name: 'birds' });
    }
    if (!S.jobs.length) return;
    S.jobs = S.jobs.filter((j) => { if (j.t > t) return true; j.fn(); return false; });
  },
  beforeRender(ctx, alpha) {
    if (!S?.im) return;
    const cam = ctx.camera, reg = ctx.registry, now = ctx.game.t - (1 - alpha) / 60, dt = S.prevNow === null ? 0 : now - S.prevNow;
    S.prevNow = now;
    const hm = reg.get('player.model'); if (hm) lookUniforms.hero.value.copy(hm.position); // grass parts around the feet (look.js)
    lookUniforms.time.value = now + (reg.get('cut.world')?.clock ?? 0); // grass keeps swaying under menus and cutscenes (cutscene.js)
    windState(ctx, now, clamp(dt, 0, 0.1), dt < 0 || dt > 0.1);

    // squash / stretch (player.js applies it on its next render)
    const la = now - S.tLand, ja = now - S.tJump;
    const lk = la >= 0 && la < 0.8 ? S.kLand * Math.exp(-9 * la) * Math.cos(la * 24) : 0, jk = ja >= 0 && ja < 0.8 ? Math.exp(-9 * ja) : 0;
    const da = S.dash ? now - S.dash.t : -1, dk = da < 0 || da > 0.6 ? 0 : da < DASH.burst ? 1 : Math.exp(-(da - DASH.burst) * 14); // dash stretch, local z = forward
    if (lk || jk || dk || S.scaled) {
      const y = 1 - 0.14 * lk + 0.14 * jk, xz = 1 + 0.07 * lk - 0.05 * jk;
      reg.set('player.renderScale', [xz * (1 - 0.1 * dk), y * (1 - 0.05 * dk), xz * (1 + 0.15 * dk)]);
      S.scaled = !!(lk || jk || dk);
    }

    // camera feel: hit-stop freezes camera and pose; otherwise kick, shake and FOV punch are added on top of camera.js
    const rm = reg.get('settings')?.reduceMotion ? 0.25 : 1; // reduce motion: shake, kicks, FOV punch and hit-stop at a quarter
    const frozen = S.hit && now >= S.hit.t && now < S.hit.t + S.hit.hold * rm;
    if (frozen) { if (S.freeze) restore(ctx, S.freeze); else S.freeze = snapshot(ctx); }
    else {
      S.freeze = null;
      let f = 0, d = 0, s = 0;
      S.kicks = S.kicks.filter((k) => now - k.t0 < k.tau * 6);
      for (const k of S.kicks) { const age = now - k.t0; if (age < 0) continue; const e = rm * Math.exp(-age / k.tau); f += k.f * e; d += k.d * e; s += k.s * e; }
      f = Math.min(f, 0.15); d = Math.min(d, 0.12); s = Math.min(s, 0.06); // stacked knocks never shove the lens into the scene
      if (f || d || s) {
        cam.getWorldDirection(_v);
        cam.position.addScaledVector(_v, f).addScaledVector(AX_Y, -d);
        _p.crossVectors(_v, AX_Y).normalize();
        cam.position.addScaledVector(_p, Math.sin(now * 71) * s).addScaledVector(AX_Y, Math.sin(now * 57 + 2) * s);
      }
    }
    const base = reg.get('settings')?.fov ?? cam.fov; // live: the settings menu can change it
    const pa = now - S.punch, wp = pa >= 0 ? 5 * Math.exp(-pa * 3.5) * (1 - Math.exp(-pa * 30)) : 0;
    const dp = da >= 0 ? DASH.fov * Math.exp(-da / DASH.fovTau) * (1 - Math.exp(-da * 30)) : 0;
    const fov = frozen && S.freeze ? S.freeze.fov : base + rm * Math.min(DASH.fovCap, wp + dp);
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    cam.updateMatrixWorld();

    ghosts(now);
    S.n = 0;
    ambient(now, cam);
    life(now, cam);
    songFx(now, cam, reg); whirls(now, cam, reg);
    particles(now, cam);
    const im = S.im;
    im.count = S.n; im.visible = S.n > 0;
    im.instanceMatrix.needsUpdate = im.instanceColor.needsUpdate = im.geometry.attributes.aP.needsUpdate = im.geometry.attributes.aShape.needsUpdate = true;

    const dm = S.debris;
    dm.items.forEach((o, i) => {
      _p.copy(o.h); _p.y += o.amp * Math.sin((now / o.per) * 6.283 + o.ph);
      _qa.setFromEuler(new THREE.Euler(o.spin * now * 0.7, o.yaw + o.spin * now, o.spin * now * 0.4));
      dm.im.setMatrixAt(i, _m.compose(_p, _qa, o.s));
    });
    dm.im.instanceMatrix.needsUpdate = true;
  },
};
