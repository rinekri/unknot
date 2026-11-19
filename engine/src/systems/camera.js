// Third-person orbit on a spring arm. Follows registry 'camera.target' ({pos, vel, heading}).
// Publishes 'camera.yaw' (forward = (sin yaw, cos yaw)), 'camera.userYaw' (cumulative yaw the player turned by hand, unwrapped) and
// 'camera.epoch' (bumps whenever the camera snaps behind the hero) so input can freeze its movement frame while auto-align drifts.
// Modes (registry 'settings'.cameraMode): 'free' = mouse yaw+pitch (pointer lock, input.js); 'assist' = drag look. Either way the view
// eases behind the run once the camera input rests (settings.camAssist, U11 below). Scroll zooms 3-9 m. Test/bot runs (?test=1, bot.enabled) keep the original
// fixed auto-framing untouched. Non-legacy framing also leads the hero (velocity x AHEAD_T, <= AHEAD_MAX), holds its height at the
// last ground (jump arcs do not bob the camera; it follows down at once, and up once the hero is AIR_UP above it) and tips
// FALL_PITCH further down while falling faster than FALL_V. A ride (an updraft pushing up, or airborne RISE m over that ground line)
// springs the height to RIDE_DROP under the hero instead (hero in the upper-middle of the frame), drops the lead, and eases the arm
// RIDE_PULL longer (never dipping under an overhang) so the ledge above shows; a ride holds until the hero lands; the look point (and so look.js's lens-to-hero fade) rides along. ?shot=<name> pins the camera to level.shots (contracts.md) for fixed-camera captures.
import * as THREE from 'three';
import { lookUniforms } from './look.js';

const ARM = 6, PITCH = 0.27, FOCUS_Y = 1.4, AUTO_AFTER = 1.5; // m, rad, m, s
const AHEAD_T = 0.25, AHEAD_MAX = 1.5, AIR_UP = 2.5, FALL_V = -8, FALL_PITCH = 0.25; // s, m, m, m/s, rad
const RISE = 2, RIDE_DROP = 1.2, RIDE_PULL = 0.6; // m
const GIFT_S = 2, GIFT_K = 0.45; // s, share of the way the look point moves toward the giver
const ZOOM = [3, 9], PITCH_RANGE = [-0.15, 1.3], LOOK_K = 0.003, ASSIST_RATE = 1.5, ALIGN_AFTER = 0.8, ASSIST_K = { off: 0, low: 0.5, normal: 1 }; // m, rad, rad/px, 1/s, s
let yaw, targetYaw, idleT, shot, userYaw, snap, legacy, actT;
let gift = null; // {t, pos}: a gift line spoken, the view eases toward the giver for GIFT_S (render only)
let fadeW = 0, fadeT = 0; // occluder fade (look.js): eased 0..1 while an overhang is above the hero, render only
let groundY = null, fallP = 0, liftP = 0, rideK = 0, riding = false; // liftP: pitch added to clear an overhang / wall behind (eased, non-legacy)
let pitch = PITCH, dist = ARM, distT = ARM, epoch = 0; // kept across levels (the player's chosen framing)
const ahead = new THREE.Vector3(), prev = new THREE.Vector3(), cur = new THREE.Vector3(), focusPrev = new THREE.Vector3(), focus = new THREE.Vector3(), dir = new THREE.Vector3(), _v = new THREE.Vector3();
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const clamp = (v, [a, b]) => Math.min(b, Math.max(a, v));

function desired(reg, out) {
  const t = reg.get('camera.target');
  focus.copy(t.pos);
  if (!legacy) { // the lead stops 0.3 m short of a wall: a look point inside rock blocks every arm ray (the camera collapses onto the hero)
    focus.y = (groundY ?? t.pos.y) + FOCUS_Y;
    const a = ahead.length(), h = a > 1e-3 ? reg.get('level')?.collide?.raycast(focus, _d.copy(ahead).divideScalar(a), a + 0.3) : null;
    if (a > 1e-3) focus.addScaledVector(_d, h ? Math.max(0, h.dist - 0.3) : a);
  } else focus.y += FOCUS_Y;
  const pt = pitch + (legacy ? 0 : fallP + liftP), len = dist + (legacy ? 0 : RIDE_PULL * rideK);
  dir.set(-Math.sin(yaw) * Math.cos(pt), Math.sin(pt), -Math.cos(yaw) * Math.cos(pt));
  const free = legacy ? armFree(reg, focus, dir, len, 0) : armFree(reg, focus, dir, len, PROBE); // pull in when blocked
  return out.copy(focus).addScaledVector(dir, free < len ? Math.max(0.5, free - 0.2) : len);
}

// Free arm length from `from` along `d`: the centre ray, plus 4 rays offset by r across the arm (a thin box, so the lens never
// pokes through an overhang's edge between two ticks).
const DECOR = 'wall_props', PROBE = 0.35, LIFTS = [0, 0.3, 0.6, 0.9, -0.12], _d = new THREE.Vector3(), _o = new THREE.Vector3(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);
function armFree(reg, from, d, len, r) {
  const col = reg.get('level')?.collide;
  if (!col) return len;
  let free = col.raycast(from, d, len, DECOR)?.dist ?? len; // U6: the arm passes through decor (pillars, rubble; look.js fades them): a column behind the hero tipped the view top-down for no visible reason
  if (!r) return free;
  _a.crossVectors(d, UP).normalize(); _b.crossVectors(_a, d).normalize();
  for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const side = _o.copy(_a).multiplyScalar(x).addScaledVector(_b, y);
    if (col.raycast(from, side, r)) continue; // a wall within r of the hero on that side: a probe started inside it reads 0 and collapses the arm onto the hero
    free = Math.min(free, col.raycast(side.multiplyScalar(r).add(from), d, len, DECOR)?.dist ?? len);
  }
  return free;
}
function liftFor(reg) { // the extra pitch that frees the arm best (0 unless the arm is cut short), favouring small changes
  const base = pitch + fallP, len = dist + RIDE_PULL * rideK, free = (lp) => armFree(reg, focus, _v.set(-Math.sin(yaw) * Math.cos(base + lp), Math.sin(base + lp), -Math.cos(yaw) * Math.cos(base + lp)), len, 0);
  if (free(0) >= len * 0.9) return 0; // clear again: settle back
  if (liftP && free(liftP) >= len * 0.8) return liftP; // hysteresis: keep the current lift while it still works
  let best = 0, bs = -Infinity;
  for (const lp of LIFTS) { if (riding && lp < 0) continue; const f = Math.min(free(lp), len) - 5 * Math.abs(lp); /* a lift must buy a lot of arm: at 1.5 a statue 3 m behind the hero (l3 arena, Orren) tipped the view top-down instead of pulling in */ if (f > bs + 0.25) { bs = f; best = lp; } }
  return best;
}

function snapBehind(reg, t) { // behind the hero's heading, no easing
  yaw = targetYaw = t.heading; idleT = AUTO_AFTER;
  ahead.set(0, 0, 0); groundY = t.pos.y; fallP = rideK = 0; riding = false;
  desired(reg, cur); prev.copy(cur); focusPrev.copy(focus);
  reg.set('camera.epoch', ++epoch);
}

export default {
  name: 'camera', order: 30, whilePaused: true,
  init(ctx) {
    const reg = ctx.registry, name = ctx.params.get('shot');
    shot = name ? reg.get('level')?.data.shots?.find((s) => s.name === name) : null;
    if (name && !shot) throw new Error(`shot '${name}' not in level.shots`);
    const t = reg.get('camera.target');
    legacy = !!ctx.params.test && ctx.params.get('cam') !== 'play'; // ?cam=play: player framing in test mode (screenshot checks)
    if (legacy) { pitch = PITCH; dist = distT = ARM; }
    yaw = targetYaw = t?.heading ?? 0; idleT = AUTO_AFTER; userYaw = 0; snap = false;
    ahead.set(0, 0, 0); groundY = t?.pos.y ?? null; fallP = liftP = rideK = 0; riding = false;
    reg.set('camera.yaw', yaw); reg.set('camera.userYaw', 0); reg.set('camera.epoch', ++epoch);
    if (t) { desired(reg, cur); prev.copy(cur); focusPrev.copy(focus); }
    actT = 0;
    reg.on('player.strike', () => { actT = 0; }); reg.on('player.singStart', () => { actT = 0; }); reg.on('player.songStart', () => { actT = 0; });
    reg.on('player.dash', () => { actT = 0; });
    reg.on('player.fall', () => { snap = true; });
    reg.on('player.respawn', () => { snap = true; });
    reg.on('cut.done', (d) => { // U17b: an arrive scene ends on the play pose mid-glide (cutscene.js play keys): carry on from its last frame
      const t = reg.get('camera.target');
      if (!d?.cam || !t || legacy) return;
      ahead.set(t.vel.x * AHEAD_T, 0, t.vel.z * AHEAD_T).clampLength(0, AHEAD_MAX);
      cur.fromArray(d.cam); prev.copy(cur); desired(reg, _v); focusPrev.copy(focus);
    });
    gift = null; fadeW = 0; fadeT = ctx.game.t;
    reg.on('talk.line', (l) => { if (l?.text?.gift && l.pos && !legacy && !reg.get('settings')?.reduceMotion) gift = { t: ctx.game.t, pos: new THREE.Vector3().fromArray(l.pos) }; });
  },
  update(ctx, dt) {
    const reg = ctx.registry, t = reg.get('camera.target');
    if (!t || shot) return;
    legacy = ctx.params.get('cam') !== 'play' && (!!ctx.params.test || !!reg.get('bot.enabled')); // same rule as init: ?cam=play keeps player framing in test mode
    const speed = Math.hypot(t.vel.x, t.vel.z);
    if (legacy) {
      const look = reg.get('input.look') ?? 0;
      if (look) { targetYaw -= look * 0.005; idleT = 0; } else idleT += dt;
      if (idleT >= AUTO_AFTER && speed > 1) targetYaw = t.heading; // drift behind when moving
      yaw += angDiff(targetYaw, yaw) * (1 - Math.exp(-6 * dt));
    } else {
      const S = reg.get('settings') ?? {}, lx = reg.get('input.look') ?? 0, ly = reg.get('input.lookY') ?? 0, k = LOOK_K * (S.sensitivity ?? 1);
      if (snap) { snap = false; snapBehind(reg, t); }
      if (lx || ly) {
        const d = -lx * k;
        yaw += d; targetYaw += d; userYaw += d; idleT = 0;
        pitch = clamp(pitch + ly * k * (S.invertY ? -1 : 1), PITCH_RANGE);
      } else idleT += dt;
      distT = clamp(distT + (reg.get('input.zoom') ?? 0) * 0.01, ZOOM);
      dist += (distT - dist) * (1 - Math.exp(-8 * dt));
      const ax = reg.get('input.axes') ?? [0, 0];
      // U11 assist (settings.camAssist off / low / normal): ALIGN_AFTER s after the last camera input the view eases behind the
      // movement direction, on the ground and in the air; the rate grows with speed and is strongest running away from the lens
      // (running at it the view holds: it never whips round). Never within 0.6 s of a strike / dash or while a song charges.
      actT += dt;
      const ak = ASSIST_K[S.camAssist] ?? 1, move = Math.atan2(t.vel.x, t.vel.z);
      // ?bot=1&cam=play: the bot has no look input, so the view follows its run the way a player keeps it (capture reviews only)
      if (reg.get('bot.enabled') && t.grounded && speed > 1) {
        targetYaw = t.heading;
        yaw += angDiff(targetYaw, yaw) * (1 - Math.exp(-ASSIST_RATE * dt));
      } else if (ak && speed > 1 && idleT >= ALIGN_AFTER && actT >= 0.6 && !reg.get('songs.state') && t.state !== 'strike' && t.state !== 'dash') {
        targetYaw = move;
        const d = angDiff(move, yaw);
        yaw += d * (1 - Math.exp(-ASSIST_RATE * ak * clamp(speed / 5, [0.4, 1.6]) * ((1 + Math.cos(d)) / 2) * dt));
      } else targetYaw = yaw;
      const e = (r) => 1 - Math.exp(-r * dt);
      groundY ??= t.pos.y;
      const ride = riding = !t.grounded && (riding || (reg.get('wind')?.y ?? 0) > 0 || t.pos.y - groundY > RISE); // an ordinary jump (1.3 m) never counts
      rideK += ((ride ? 1 : 0) - rideK) * e(2);
      ahead.lerp(ride ? _v.set(0, 0, 0) : _v.set(t.vel.x * AHEAD_T, 0, t.vel.z * AHEAD_T).clampLength(0, AHEAD_MAX), e(ride ? 8 : 3));
      const gy = t.grounded ? t.pos.y : Math.max(Math.min(groundY, t.pos.y), t.pos.y - (ride ? RIDE_DROP : AIR_UP));
      groundY = !t.grounded && gy < groundY ? gy : groundY + (gy - groundY) * e(ride ? 14 : 6); // a ride keeps the hero at one place in the frame: a slow follow made the view pump with every bob in the updraft // falls below the ground line: follow at once
      fallP += ((!t.grounded && t.vel.y < FALL_V ? FALL_PITCH : 0) - fallP) * e(4);
      liftP += (liftFor(reg) - liftP) * e(2.5); // eased: the camera rises over / under an obstacle, never jumps
    }
    prev.copy(cur); focusPrev.copy(focus);
    cur.lerp(desired(reg, _v), 1 - Math.exp(-(riding ? 16 : 10) * dt));
    reg.set('camera.yaw', yaw); reg.set('camera.userYaw', userYaw);
  },
  beforeRender(ctx, alpha) {
    const fade = lookUniforms.fade.value;
    if (shot) { fade.w = -1; ctx.camera.position.fromArray(shot.pos); ctx.camera.lookAt(_v.fromArray(shot.look)); return; }
    const fov = ctx.registry.get('settings')?.fov;
    if (!legacy && fov && ctx.camera.fov !== fov) { ctx.camera.fov = fov; ctx.camera.updateProjectionMatrix(); }
    ctx.camera.position.lerpVectors(prev, cur, alpha);
    lookUniforms.fadeCam.value.copy(ctx.camera.position); // look.js fades occluders only for a render from here
    _v.lerpVectors(focusPrev, focus, alpha);
    // Overhang: a ray up from the look point, or from 3 / 6 m ahead in view (reached without a wall in between: an island above,
    // not a cliff face), hits level geometry within 25 m (the collider holds the island tops). look.js then dithers the rock from head
    // clearance up to that top, and always what sits between the lens and the hero. The region follows the interpolated look point;
    // the amount and the top ease on game time (no jitter).
    const col = ctx.registry.get('level')?.collide, dt = Math.min(Math.max(ctx.game.t - fadeT, 0), 0.1), fy = lookUniforms.fadeY;
    let top = -Infinity;
    for (const k of [0, 3, 6]) {
      if (!col || (k && col.raycast(_v, _a.set(Math.sin(yaw), 0, Math.cos(yaw)), k))) break;
      const h = col.raycast(_o.set(_v.x + Math.sin(yaw) * k, _v.y, _v.z + Math.cos(yaw) * k), UP, 25);
      if (h) top = Math.max(top, _o.y + h.dist);
    }
    const over = top > -Infinity;
    if (over) fy.value = fadeW < 0.02 ? top : fy.value + (top - fy.value) * (1 - Math.exp(-6 * dt));
    fadeT = ctx.game.t; fadeW += ((over ? 1 : 0) - fadeW) * (1 - Math.exp(-4 * dt));
    fade.set(_v.x, Math.max(_v.y, (ctx.registry.get('camera.target')?.pos.y ?? -Infinity) + FOCUS_Y), _v.z, ctx.registry.get('cut.active') ? -1 : fadeW); // never under the hero's real head: the look point lags below on a climb, and the island just landed on would dither away
    const hp = ctx.registry.get('camera.target')?.pos;
    if (gift && hp && (Math.hypot(hp.x - gift.pos.x, hp.z - gift.pos.z) > 6 || (gift.hp && Math.hypot(hp.x - gift.hp.x, hp.z - gift.hp.z) > 0.6))) gift = null; // the hero walked off: never pull the view back to a speaker behind
    else if (gift && hp && !gift.hp) gift.hp = hp.clone();
    if (gift) { // frame the giver: the look point eases part-way toward them and back (no camera move, so no clipping)
      const a = ctx.game.t - gift.t, w = THREE.MathUtils.smoothstep(a, 0, 0.5) * (1 - THREE.MathUtils.smoothstep(a, GIFT_S - 0.6, GIFT_S));
      if (a > GIFT_S) gift = null; else _v.lerp(_o.set(gift.pos.x, gift.pos.y + 1.2, gift.pos.z), GIFT_K * w);
    }
    // a short arm (blocked, or zoomed in) cannot afford the ride's 1.2 m look lag: the hero would leave the top of the frame ...
    const tp = ctx.registry.get('camera.target')?.pos;
    if (tp && !legacy) { // ... and not the full lead either
      const d = Math.hypot(ctx.camera.position.x - tp.x, ctx.camera.position.z - tp.z), k = Math.min(1, d / 4);
      _v.set(tp.x + (_v.x - tp.x) * k, Math.max(_v.y, tp.y + FOCUS_Y - 0.2 * d), tp.z + (_v.z - tp.z) * k);
    }
    ctx.camera.lookAt(_v);
  },
};
