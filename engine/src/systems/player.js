// Player: tuning table, state machine, capsule-vs-collider movement, GLB animation (extras contract).
// Sim (update, fixed DT) owns every clock the animation reads: locomotion phase, air/strike/land timers. Render
// (beforeRender) only samples clips at those clocks interpolated by alpha and fades weights,
// so animation never feeds back into the sim and replays stay deterministic.
// Variants: clips group by the name before the dot (jump, jump.b ...); the sim picks them, render only plays them. Strikes chain
// slash > slash.b > slash.c (a press within comboWindow s of the previous hit), jump.b (flip) every 2nd-3rd jump (ctx.rng),
// run.sprint / run.tired (breath 0) / walk.careful (slow, or a drop ahead) by state, air.updraft in a lift, fall.long after
// anim.fallLong s of falling, skid on a reversal at speed, land.roll (fast + high) / land.crouch (no speed) as full-body one-shots
// (land / land.hard stay additive), teeter at a drop, brace in a side wind, idle.* fidgets after a seeded 2.5-4 s (then 4-7 s) of
// untouched idle, sit after anim.sitAfter s; any input cancels a fidget and stands the hero up. Procedural layers (render only, ?layers=breath,look,lean picks a subset; default all): lean into turns and
// acceleration, breathing that speeds up after running, head look-at (unlit switch nearby > echo > camera direction).
// The staff is part of the hero GLB (hero_staff, 100 % on the R_Prop bone under R_Hand): the clips hold it, nothing solves it here.
// Events: player.jump {t,pos} · player.land {t,pos,impact} · player.step {t,pos,surface,foot} · player.strike {t,pos,heading}
// · player.singStart / player.sing {t,pos,heading} · player.singEnd {t,done} · player.strikeHit {t,pos,target:null} (switch hit tests live in level.js on 'player.strike') · player.fall {t,pos}
// · player.respawn {t,pos} · player.dash {t,pos,dir:[x,z],air} · player.breath {t,b,max,why} (whole segment gained/lost, or empty).
// · player.songStart / player.song {t,pos,heading,song} (R2 gift songs: level.js resolves the effect on player.song).
// Breath (sim): p.breath segments of p.breathMax (1, +1 per gift held, +1 per 4 echoes from registry 'echoes', cap 4). A dash costs 1,
// running (inp.run, grounded) drains it; empty = no dash, but the hero still runs (breath never gates base movement). Refill: passive
// regen while grounded and not running, only before gift.dash; B.wind per s inside a wind cairn's spring (registry 'spring', level.js;
// any gifts) — a plain checkpoint refills nothing: reaching one snapshots {b, max} and a respawn restores that b (capped at the max now), plus a third of the gap per repeat death there (full on the 4th; a new checkpoint resets the count);
// after gift.windbreath also inside an active wind volume and a full
// refill once per wake within 3 m of a woken rune/totem (then a trickle while near). ?breath=0 or the infinite
// air dash assist (never the bot) = endless breath. Render reads it: cloak threads (one per segment), limp cloak + heavy breathing at 0. Render hook: registry 'player.renderScale' = number or [x,y,z] (squash/stretch), read each frame.
import * as THREE from 'three';
import { surfaceOf } from '../core/collide.js';
import { GLYPH, SONG_COL } from './songs.js';
import { solidOut } from './enemies.js';
const DT = 1 / 60; // = engine.js DT; not imported: tools/lib/kit.mjs loads this file in node, where engine.js's import.meta.glob does not exist

// Every movement number lives here (architecture.md "Player"). tools/make_demo_level.mjs imports it for feasibility.
export const TUNING = {
  walk: 1.6, jog: 3.5, run: 6.5, sprint: 8, // m/s
  accelStart: 22, decel: 28, airControl: 0.35,
  gravity: 24, jumpHeight: 1.3, jumpCut: 0.45,
  coyote: 0.1, buffer: 0.15,
  stepUp: 0.35, stepDown: 0.6, maxSlopeDeg: 50,
  radius: 0.3, height: 1.7,
  turnRate: 12, turnRateFlip: 25, // rad/s; flip: a reversal once the hero has braked below skidSpeed (it keeps facing its motion until then)
  skidSpeed: 1, // m/s
  breath: { max: 1, cap: 4, perEchoes: 4, dash: 1, song: 1, run: 1, wind: 2, near: 3, nearFar: 6.5, trickle: 0.5, regen: 0.2 }, // segments (+1 per gift held, +1 per perEchoes echoes, up to cap); segments/s run drain, wind refill, near-rune trickle; m; segments/s grounded regen, only before gift.dash
  dashSpeed: 13, dashTime: 0.18, dashCooldown: 0.5, dashBuffer: 0.1, // m/s for s (~2.3 m), then horizontal speed = sprint, decaying to the input target; 1 air charge
  singTime: 0.5, // s the sing button is held before the rune answers
  songTime: 0.25, // s of the sing pose's wind-up a gift song shows (Phase S: the key is held to charge, songs.js; released = cast); costs breath.song
  songMove: 0.35, // x jog speed while a gift song charges in the air (U20: on the ground it plants)
  songHover: 0.65, // s an air song may hover while it charges (songs.js AIR_MAX auto-releases before it ends)
  strikeHitT: 0.2, strikeHold: 0.35, strikeCooldown: 0.55, strikeBuffer: 0.3, strikeAnimSpeed: 1.1, // s to contact (wind-up+thrust squeezed into it), contact + 0.15 s, s, x clip speed after contact (thrust clip is 0.92 s, hit at 0.41)
  comboWindow: 0.7, // s after a hit for the next press to chain the combo (sweep, backhand, slam)
  // animation (render only)
  runAt: 2.5, // m/s, walk/run state label
  walkRate: [0.8, 1.3], runRate: [0.8, 2.1], // clip speed clamp; run needs 2.1 at 6.5 m/s (clip stride 3.1 m/s) or the feet slide
  dashLean: 20, // deg, whole-model forward pitch at the burst, eased out over the clip
  fade: { default: 0.2, 'loco>dash': 0.04, 'jump>dash': 0.04, 'dash>loco': 0.15, 'loco>jump': 0.08, 'jump>fall': 0.3, 'fall>loco': 0.12, 'jump>loco': 0.1, 'loco>strike': 0.12, 'strike>loco': 0.3 }, // s
  fallLoopAfter: 0.35, // s airborne (or vy < -6) before the flail loop takes over from the jump tuck
  landFull: 14, // m/s impact for a full-weight landing squat
  // R9 falls (m from the apex): < hard normal; hard: lockHard s of no input; stagger: lockStagger s, -1 breath (a strike / dash press
  // <= roll s before touchdown rolls instead: no loss); >= fray: lockFray s, -1 breath max until the next checkpoint (a cloak thread
  // tears), limp x0.7 for limpT s. Soft (apex reset): updraft, pogo bounce, air song hover. flash: s before a >= stagger touchdown.
  fall: { hard: 4, stagger: 7, fray: 12, lockHard: 0.35, lockStagger: 0.9, lockFray: 1.6, roll: 0.15, limp: 0.7, limpT: 3, flash: 0.5 },
  // R5 air: an air strike halts the fall hang s (one per airtime: refreshed on landing, an updraft or a hit); pogo (down + strike in
  // the air) probes below for pogo s, a hit bounces pogoV m/s and refreshes the air dash; an air song hovers (vy 0) hover s
  air: { hang: 0.15, pogo: 0.3, pogoV: 6, hover: 0.25 },
  whooshVy: -9, // m/s, long-fall cue when falling this fast with no ground below
  // variant triggers: s falling; [m/s speed, m/s impact] roll above / crouch below; m probe ahead and m drop for an edge; s still to sit,
  // s to stand up (movement held); m/s side wind to brace; rad lean into a 7.5 m/s wind
  anim: { fallLong: 0.8, roll: [4, 11], crouch: [0.6, 4], skidCos: -0.5, edge: 0.45, edgeDrop: 1, sitAfter: 15, standUp: 0.45, brace: 2, windLean: 0.2 },
};
export const jumpVel = (T = TUNING) => Math.sqrt(2 * T.gravity * T.jumpHeight);
export function jumpReach(rise = 0, T = TUNING, speed = T.run) {
  const vy = jumpVel(T), disc = vy * vy - 2 * T.gravity * rise;
  return disc < 0 ? 0 : (speed * (vy + Math.sqrt(disc))) / T.gravity;
}
// Full jump + one air dash: gravity is off for dashTime, so the arc gains dashSpeed * dashTime of flat travel (dashed at the apex,
// where vy is already 0 and nothing is lost). The sprint carry after the burst is left out: a conservative bound.
export const dashReach = (rise = 0, T = TUNING) => (jumpReach(rise, T) > 0 ? jumpReach(rise, T) + T.dashSpeed * T.dashTime : 0);
// Two air dashes (gift.airdash): the first at the apex, the second once the cooldown is over (the fall in between is
// cooldown - dashTime s); each burst is dashTime s of flat dashSpeed and zeroes the fall speed. Run speed elsewhere (conservative).
// No second burst before the landing height = one dash.
export const dash2Reach = (rise = 0, T = TUNING) => {
  const tf = T.dashCooldown - T.dashTime, h = T.jumpHeight - rise - 0.5 * T.gravity * tf * tf; // height left when the 2nd charge is ready
  return h > 0 ? T.run * (jumpVel(T) / T.gravity + tf + Math.sqrt((2 * h) / T.gravity)) + 2 * T.dashSpeed * T.dashTime : dashReach(rise, T);
};

const HERO = 'assets/characters/hero/hero.glb'; // optional; ?hero=<path> overrides. Missing -> capsule.
const LIFT_MAX = 5; // m/s, updraft rise speed cap
const STEPS = [0.05, 0.55]; // footfall fallback when the clip has no step events

let shadow, T, p, prevPos, prevHeading, model, mixer, actions, extras, falls, jumpHeld, bufferT, coyoteT, cut, flatGround, strikeHeld, strikeT, strikeCd, strikeBuf, singT, sung, song, songHeld; // song: the gift song being cast (singT is its clock), songHeld: the song key held last tick
let breathOn, woke, emptyCue, snap, dashOn, dashHeld, dashBufT, dashT, dashCd, dashCharge, dashDir;
let phase, prevPhase, airT, landT, impact, whooshed, hitSent, steps, loco, group, fadeT, renderT;
let pose = null; // registry 'cut.pose' {land: weight, clip: 'land' | 'land.hard', at: clip fraction, t: s} from cutscene.js (render only): a held squat over idle
let threads, vars, pick, idleT, fidgetAt, fidget, fidgetT, prevVel, layers, proc, lookAts, lay;
let combo, jumpN, flipAt, fallT, upT, act1, act1T, edge, brace, runVar, walkVar, windH, windY, stillT, fidgetN, sitting, sitT, standT, endless; // sim: variant state (see header)
let songMarks; // render: the three song marks on the pack (packMarks)
let wLean = [0, 0]; // render: eased wind lean
let apexY, lockT, limpT, fray, dieN, rollAt, airStrikes, airHover, hangT, pogoT, hoverT, hoverMax, softFalls, voidT; // R9 / R5 sim state (see TUNING.fall / .air)
const LOCKED = { move: [0, 0] }; // input while a hard landing / stagger / fray holds the hero
const clipOf = (...n) => n.find((x) => actions?.[x]) ?? n.at(-1); // a clip still to be authored falls back to the next name
const ADD = (n) => n.split('.')[0] === 'land' && n !== 'land.roll' && n !== 'land.crouch' && n !== 'land.crumple'; // additive squats (full-body roll/crouch are not)
let talkAt, stumbleT, receiveT, puffAt, oneW = 0; // render only: the speaking NPC (head-look), a dash press before the gift (stumble clip), a gift line (gift_receive clip); one-shot weight

// State machine: enter/update/exit per state, transitions decided only in nextState().
const STATES = {
  idle: {}, walk: {}, run: {}, fall: {}, jump: {}, dash: {}, sing: {},
  strike: { enter: (ctx) => ctx.registry.set('audio.cue', { name: 'strike' }) },
  land: { enter: (ctx) => ctx.registry.set('audio.cue', { name: 'land', gain: THREE.MathUtils.clamp(impact / T.landFull, 0.3, 1), surface: surfaceUnder(ctx.registry) }) },
};
const surfaceUnder = (reg) => surfaceOf(reg.get('level')?.collide?.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.1)); // jump/land play step samples of this surface
function nextState() {
  if (dashT < T.dashTime) return 'dash';
  if (!p.grounded && strikeT < T.strikeHold) return 'strike'; // R5 air strike / pogo: the swing lands its hit ('player.strikeHit') in the air too
  if (!p.grounded) return p.vel.y > 0 ? 'jump' : 'fall';
  if (p.state === 'jump' || p.state === 'fall') return 'land';
  if (strikeT < T.strikeHold) return 'strike';
  if (singT >= 0) return 'sing';
  if (p.state === 'land' && p.stateT < 0.12) return 'land';
  const sp = Math.hypot(p.vel.x, p.vel.z);
  return sp < 0.2 ? 'idle' : sp < T.runAt ? 'walk' : 'run';
}

function spawn(reg) {
  const s = reg.get('checkpoint') ?? reg.get('level')?.data.spawn ?? { pos: [0, 0, 0], heading: 0 };
  p.pos.fromArray(s.pos); p.vel.set(0, 0, 0); p.heading = prevHeading = s.heading ?? 0;
  const col = reg.get('level')?.collide;
  if (col) { // U21: a spawn point inside a solid (a gust boulder stood on its checkpoint) moves to the nearest free ground: rings of 0.6 m, 8 ways, the first free one
    const y = s.pos[1], free = (x, z) => { const g = col.groundAt(x, z, y + 1.9), q = new THREE.Vector3(x, y, z); return g && Math.abs(g.y - y) < 0.6 && !col.sweepCapsule(q, q, 0.6, T.height, T.stepUp).hitNormals.length; }; // ponytail: a 0.6 m probe (the hero's own radius misses a wall it stands deep inside); a solid thicker than 1.2 m wants a real inside test
    search: for (let r = 0; r <= 3; r += 0.6) for (let k = 0; k < (r ? 8 : 1); k++) { const x = s.pos[0] + Math.sin(k * Math.PI / 4) * r, z = s.pos[2] + Math.cos(k * Math.PI / 4) * r; if (free(x, z)) { p.pos.set(x, y, z); break search; } }
  }
  p.grounded = false; p.groundBody = null; prevPos.copy(p.pos);
  airT = 0; whooshed = false; dashT = Infinity; dashCd = 0; dashCharge = 1; dashBufT = 0;
  act1 = null; sitting = false;
  apexY = p.pos.y; hangT = pogoT = hoverT = Infinity; hoverMax = T.air.hover; voidT = 0; airStrikes = airHover = 1;
  // respawn: the breath the checkpoint was reached with, plus a third of what is missing per repeat death there (full on the 4th)
  p.breath = snap ? Math.min(p.breathMax, snap.b + Math.ceil((p.breathMax - snap.b) * Math.min(1, Math.max(0, dieN - 1) / 3))) : p.breathMax;
  if (dieN > 1 && threads) threads.pulse.value = 1; // the cloak's threads flash as the extra ones light
}

// Breath max: 1 + one segment per gift held + one per perEchoes echoes, capped. Gifts persist (level.js seeds them), so a later
// level starts with the max the earlier ones earned.
function breathMaxOf(reg) {
  const B = T.breath, fl = reg.get('flags') ?? {}, gifts = +!!fl['gift.dash'] + !!fl['gift.windbreath'] + !!fl['gift.airdash'];
  return Math.max(1, Math.min(B.cap, B.max + gifts + Math.floor((reg.get('echoes') ?? 0) / B.perEchoes) + ((reg.get('threads') ?? 0) >= 3 ? 1 : 0)) - (fray ?? 0)); // threads: R6 cloak threads (progress.js), +1 at 3 // a torn thread (R9) until the next checkpoint
}
// Breath (sim only). Returns true when breath is endless (flag off, or the assist for a human player).
// Regen only before gift.dash; after it breath comes back from cairns, and (gift.windbreath) wind and woken runes.
function breathTick(ctx, dt, running) {
  const reg = ctx.registry, B = T.breath, b0 = p.breath, max = breathMaxOf(reg);
  if (max > p.breathMax) p.breath = max; // a gift / echo stripe arrives with a full breath
  p.breathMax = max;
  if (!breathOn || ((reg.get('settings')?.infiniteAirDash || reg.get('settings')?.breath === false) && !reg.get('bot.enabled'))) { p.breath = p.breathMax; return true; }
  let why = null;
  const flags = reg.get('flags') ?? {}, windbreath = flags['gift.windbreath'];
  if (running) p.breath -= B.run * dt;
  else if (p.grounded && p.breath < p.breathMax && !flags['gift.dash']) { p.breath += B.regen * dt; why = 'regen'; }
  if (windbreath && (reg.get('wind')?.lengthSq() ?? 0) > 0.01 && !(ctx.game.t - p.foulT < 0.1)) { p.breath += B.wind * dt; why = 'wind'; }
  p.spring = !!reg.get('spring');
  if (p.spring) { p.breath += B.wind * dt; why = 'spring'; } // a wind cairn's spring (level.js): the hero breathes it in
  for (const m of windbreath ? lookAts : []) {
    if (m.kind !== 'switch') continue;
    if (!flags[`switch.${m.id}`]) { woke.delete(m.id); continue; } // a totem struck off can wake again
    if (Math.hypot(p.pos.x - m.pos.x, p.pos.z - m.pos.z) > (m.far ? B.nearFar : B.near) || !m.far && Math.abs(p.pos.y - m.pos.y) > 2) continue; // far (R2 Name runes, out of reach): felt from where the song reached it
    if (!woke.has(m.id)) { woke.add(m.id); p.breath = p.breathMax; why = 'rune'; }
    else { p.breath += B.trickle * dt; why ??= 'rune'; }
  }
  p.breath = THREE.MathUtils.clamp(p.breath, 0, p.breathMax);
  breathEvent(ctx, b0, why ?? (running ? 'run' : null));
  return false;
}
// R9 fray: one cloak thread tears (breath max -1, min 1) until the next checkpoint; the hero limps for fall.limpT s
function tearThread(ctx, limp = true) {
  const reg = ctx.registry, b0 = p.breath;
  if (breathMaxOf(reg) > 1) fray++;
  p.breathMax = breathMaxOf(reg); p.breath = Math.min(p.breath, p.breathMax); if (limp) limpT = T.fall.limpT;
  const st = reg.get('stats') ?? {}; st.frays = (st.frays ?? 0) + 1; reg.set('stats', st);
  if (threads) threads.pulse.value = 1;
  reg.set('player.fray', { t: ctx.game.t, pos: p.pos.toArray(), max: p.breathMax });
  breathEvent(ctx, b0, 'fray');
}
function breathEvent(ctx, b0, why) { // whole segments changed: log + cues (empty sigh, refill chime)
  const reg = ctx.registry, b = p.breath;
  if (Math.floor(b) === Math.floor(b0) && !(b === 0 && b0 > 0)) return;
  reg.set('player.breath', { t: ctx.game.t, b: +b.toFixed(2), max: p.breathMax, why });
  if (b === 0 && b0 > 0) { if (!emptyCue) reg.set('audio.cue', { name: 'breath_out' }); emptyCue = true; }
  else if (b > b0) { reg.set('audio.cue', { name: 'breath_in', at: why === 'rune' ? 0.1 : 0, gain: (b >= p.breathMax ? 1 : 0.6) * (why === 'regen' ? 0.45 : 1) }); emptyCue = false; }
}

const dur = (n) => actions?.[n]?.a.getClip().duration ?? 1;
const groupOf = (n) => n.split('.')[0];
// sim only: one of the group's clips (minus `skip`), never the previous pick; the rng is drawn only when there is a choice
function choose(ctx, g, skip) {
  const opts = (vars?.[g] ?? [g]).filter((n) => n !== skip && n !== pick[g]);
  pick[g] = opts.length > 1 ? opts[Math.floor(ctx.rng() * opts.length)] : opts[0] ?? pick[g];
  return pick[g];
}
function setupModel(gltf) {
  extras = gltf.scene.userData ?? {};
  model = gltf.scene;
  model.scale.setScalar(extras.scale ?? 1); // hero.glb: 1 (the 1.3 m height is baked into the Armature node)
  model.traverse((o) => { if (o.isSkinnedMesh) o.frustumCulled = false; });
  mixer = new THREE.AnimationMixer(model);
  actions = {}; vars = {};
  for (const c of gltf.animations) {
    if (ADD(c.name)) { // squat delta over whatever is playing, weight = impact
      // GLTFLoader shares accessor arrays between clips and makeClipAdditive edits in place: copy first, or the
      // shared constant tracks (scale, root position) of the other clips get zeroed
      for (const t of c.tracks) { t.times = t.times.slice(); t.values = t.values.slice(); }
      THREE.AnimationUtils.makeClipAdditive(c);
    }
    const a = mixer.clipAction(c);
    a.play(); a.timeScale = 0; a.setEffectiveWeight(0); // times are set from sim clocks, weights by hand
    actions[c.name] = { a, w: 0 };
    (vars[groupOf(c.name)] ??= []).push(c.name);
  }
  if (actions.idle) actions.idle.w = 1;
  const ev = extras.events?.walk ?? {};
  steps = Object.entries(ev).filter(([k]) => k.startsWith('step')).map(([k, at]) => ({ at, foot: k[5] ?? '' }));
  if (!steps.length) steps = STEPS.map((at, i) => ({ at, foot: 'lr'[i] }));
  const cloak = model.getObjectByName('hero_cloak');
  if (cloak?.material) cloakThreads(cloak);
  songMarks = packMarks(model.getObjectByName('Spine02'));
  mixer.update(0);
  // bones the procedural layers rotate: their animated pose is restored before every mixer.update, because the mixer only
  // rewrites a binding whose value changed (a held pose, a pause) and the layers would otherwise pile up frame after frame
  const B = (n) => model.getObjectByName(n);
  const names = ['Spine02', 'NeckTwist01', 'Head', 'L_Clavicle', 'R_Clavicle'];
  proc = names.map(B).filter(Boolean).map((b) => ({ b, q: b.quaternion.clone() }));
  lay = { bone: Object.fromEntries(names.map((n) => [n, B(n)])), leanV: new THREE.Vector2(), lean: new THREE.Vector2(),
    breath: 0, exert: 0, gasp: 0, inhale: 0, inPh: 0, look: new THREE.Vector2(), lookW: 0 };
}

// Breath threads (render only): gold bands stitched round the cloak in bind space, one per breath segment of breathMax, from the
// hem up. Lit = full segment (a partial one glows dimmer), unlit = dull thread; a refill flashes them. Uniforms set in beforeRender.
// A gift's new stripe waits for its gold threads (fx.js, ~2.6 s after 'gift') to land, then stitches in over ~0.7 s.
const THREAD = { y0: 0.27, gap: 0.055, w: 0.0022, hem: 0.225, hemGap: 0.014 }; // share of the cloak's bind height (hem ~0.21), thread half-width (a hair: gold threads, not bands); gift seams
function cloakThreads(mesh) {
  const g = mesh.geometry;
  g.computeBoundingBox();
  const y0 = g.boundingBox.min.y, h = g.boundingBox.max.y - y0, m = mesh.material, f = (v) => v.toFixed(4);
  threads = { b: { value: p.breath }, max: { value: p.breathMax }, pulse: { value: 0 }, t: { value: 0 }, gifts: { value: 0 }, songs: { value: new THREE.Vector3() }, flash: { value: 0 }, shown: p.breath, land: [] };
  m.userData.cacheKey = '-threads';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { thB: threads.b, thMax: threads.max, thPulse: threads.pulse, thT: threads.t, thGift: threads.gifts, thSong: threads.songs, thFlash: threads.flash });
    sh.vertexShader = 'varying float vThY;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vThY = (position.y - ${f(y0)}) / ${f(h)};`);
    sh.fragmentShader = 'varying float vThY;\nuniform float thB, thMax, thPulse, thT, thGift, thFlash;\nuniform vec3 thSong;\n' + sh.fragmentShader.replace('#include <tonemapping_fragment>', `
  float thL = 0.0, thG = 0.0, thH = 0.0, thAA = fwidth(vThY);
  for (int i = 0; i < 4; i++) {
    float wgt = clamp(thMax - float(i), 0.0, 1.0); // a new stripe (gift / echoes) stitches in: grows from a hair to full width
    if (wgt <= 0.0) break;
    float d = abs(vThY - (${f(THREAD.y0)} + float(i) * ${f(THREAD.gap)})), lit = clamp(thB - float(i), 0.0, 1.0) * wgt;
    float line = (1.0 - smoothstep(${f(THREAD.w)} * wgt, ${f(THREAD.w)} * wgt + thAA, d)) * wgt;
    thL = max(thL, line); thG = max(thG, line * lit); thH = max(thH, lit * exp(-d * d / ${f(16 * THREAD.w * THREAD.w)}));
  }
  gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * 1.2 + 0.02, (thL - thG) * 0.3); // a spent thread: a faint pale stitch, never a dark band
  vec3 thGold = vec3(0.78, 0.55, 0.16); // muted gold, mixed in, not added: added light tonemaps to white
  gl_FragColor.rgb = mix(gl_FragColor.rgb, thGold * (1.0 + 0.1 * sin(thT * 3.0 + vThY * 60.0)), thG * 0.5);
  gl_FragColor.rgb += thGold * (thH * 0.05 + thG * 0.8 * thPulse);
  gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(vec3(0.95, 0.25, 0.12), vec3(1.0, 0.72, 0.25), 0.5 + 0.5 * sin(thT * 40.0)), thFlash * 0.6); // R9: red-gold before a hard touchdown
  for (int i = 0; i < 3; i++) { // gift stitches (npc.js gifts): one fine gold seam at the hem per gift held
    if (float(i) >= thGift) break;
    float gd = abs(vThY - (${f(THREAD.hem)} + float(i) * ${f(THREAD.hemGap)}));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.78, 0.58, 0.24), (1.0 - smoothstep(${f(THREAD.w * 0.6)}, ${f(THREAD.w * 0.6)} + thAA, gd)) * 0.4);
  }
  vec3 thSC[3]; thSC[0] = vec3(0.45, 0.95, 0.82); thSC[1] = vec3(1.0, 0.81, 0.42); thSC[2] = vec3(0.45, 0.65, 1.0); // song seams: gust, name, anchor
  for (int i = 0; i < 3; i++) { // between the gift seams: one coloured stitch per gift song known
    if (thSong[i] < 0.5) continue;
    float sd = abs(vThY - (${f(THREAD.hem)} + (float(i) + 0.5) * ${f(THREAD.hemGap)}));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, thSC[i] * (0.9 + (thSong[i] > 1.5 ? 0.45 : 0.1) * sin(thT * 2.0 + float(i) * 2.1)), (1.0 - smoothstep(${f(THREAD.w * 0.6)}, ${f(THREAD.w * 0.6)} + thAA, sd)) * 0.4);
  }
#include <tonemapping_fragment>`);
  };
  m.needsUpdate = true;
}

const UP = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();

// Song marks (render only): the three song glyphs (songs.js GLYPH) branded on the back of the pack, left to right in key order
// (gust, name, anchor). A song not yet given is a dark empty brand; an owned one glows in its song colour; the held song's mark
// flares before the cast, and a new gift flares its mark as it lands. Pose in Spine02 space, measured on hero.glb (pack back = -x).
const MARK = { x: [-0.257, -0.27, -0.28], y: 0.0, z: -0.027, gap: 0.052, r: 0.03, w: 0.14 }; // x per mark: the pack's back is rounded (each 6 mm off the leather)
function packMarks(bone) {
  return Object.keys(GLYPH).map((id, i) => {
    const pos = [];
    for (const line of GLYPH[id]) for (let k = 1; k < line.length; k++) { // each stroke a flat ribbon
      const [x0, y0] = line[k - 1], [x1, y1] = line[k], l = Math.hypot(x1 - x0, y1 - y0) || 1, nx = -(y1 - y0) / l * MARK.w, ny = (x1 - x0) / l * MARK.w;
      pos.push(0, y0 + ny, x0 + nx, 0, y0 - ny, x0 - nx, 0, y1 + ny, x1 + nx, 0, y1 + ny, x1 + nx, 0, y0 - ny, x0 - nx, 0, y1 - ny, x1 - nx);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
    m.position.set(MARK.x[i], MARK.y, MARK.z + (i - 1) * MARK.gap); m.layers.set(1); m.name = 'player.mark.' + id; bone.add(m);
    return { id, m, col: new THREE.Color(SONG_COL[id]), own: null, flare: 0 };
  });
}
const MARK_OFF = new THREE.Color('#8a8068'), WHITE = new THREE.Color('#ffffff');

// Blob shadow (render-only): soft disc on the ground under the hero, smaller and fainter with height; layer 1 = no ink edges
function makeShadow() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(50,42,34,0.75)'); grad.addColorStop(0.6, 'rgba(50,42,34,0.45)'); grad.addColorStop(1, 'rgba(60,50,40,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false, fog: false, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.layers.set(1); m.renderOrder = 1; m.name = 'player.shadow';
  return m;
}
function placeShadow(reg) {
  const x = model.position.x, z = model.position.z, g = reg.get('level')?.collide?.groundAt(x, z, model.position.y + 0.1);
  const h = g ? model.position.y - g.y : Infinity;
  shadow.visible = h < 8;
  if (!shadow.visible) return;
  const k = 1 - Math.min(1, h / 8);
  shadow.position.set(x, g.y + 0.02, z);
  shadow.scale.setScalar(0.9 * (0.5 + 0.5 * k));
  shadow.material.opacity = 0.25 + 0.75 * k;
}

// Sim side of the animation: locomotion phase + footstep/strike events, all from fixed-step clocks.
const touchedOf = (reg, inp) => inp.move[0] || inp.move[1] || inp.jump || inp.strike || inp.sing || inp.song || inp.dash || inp.face || reg.get('input.look') || reg.get('input.lookY');
const fwdSpeed = () => Math.max(0, p.vel.x * Math.sin(p.heading) + p.vel.z * Math.cos(p.heading)); // legs follow motion along facing only
function animTick(ctx, dt, inp) {
  const reg = ctx.registry, sp = fwdSpeed();
  // idle fidgets: any input (or leaving idle) cancels; the wait is drawn once per idle stretch
  // edge ahead (teeter / careful walk): no ground, or ground more than edgeDrop below, at edge m ahead or 35 deg either side
  const A = T.anim, col = reg.get('level')?.collide;
  edge = !!col && p.grounded && sp < T.runAt && [0, 0.6, -0.6].some((a) => {
    const h = p.heading + a, g = col.groundAt(p.pos.x + Math.sin(h) * A.edge, p.pos.z + Math.cos(h) * A.edge, p.pos.y + 0.3);
    return !g || g.y < p.pos.y - A.edgeDrop;
  });
  brace = p.grounded && Math.hypot(windH[0], windH[1]) > A.brace;
  runVar = !endless && p.breath <= 0 ? 'run.tired' : sp > T.jog + 1 ? 'run.sprint' : 'run';
  walkVar = edge || sp < 1 ? 'walk.careful' : 'walk';
  fallT = !p.grounded && p.vel.y < 0 ? fallT + dt : 0;
  upT = !p.grounded && windY > 0 ? 0 : upT + dt;
  act1T += dt; sitT += dt; standT += dt;
  if (act1 && (!p.grounded || p.state === 'strike' || p.state === 'dash' || (act1 === 'land.crouch' && sp > 1.5))) { // cut short: fade out from here
    if (act1T < dur(act1) - 0.15) act1T = dur(act1) - 0.15;
  }
  if (act1 && act1T >= dur(act1)) act1 = null;
  // idle fidgets (any input or leaving idle cancels; first wait 2.5-4 s, then 4-7 s), sit after sitAfter s of stillness
  if (p.state !== 'idle' || touchedOf(reg, inp)) { idleT = stillT = fidgetN = 0; fidget = null; fidgetAt = null; }
  else {
    stillT += dt;
    if (fidget) { fidgetT += dt; if (fidgetT >= dur(fidget)) { fidget = null; idleT = 0; fidgetAt = null; } }
    else if (stillT >= A.sitAfter) { if (!sitting) { sitting = true; sitT = 0; } }
    else if (vars?.idle?.length > 1 && !edge && !brace) {
      idleT += dt;
      fidgetAt ??= fidgetN ? 4 + 3 * ctx.rng() : 2.5 + 1.5 * ctx.rng();
      if (idleT >= fidgetAt) { fidget = choose(ctx, 'idle', 'idle'); fidgetT = 0; fidgetN++; }
    }
  }
  prevPhase = phase;
  airT = p.grounded ? 0 : airT + dt;
  landT += dt;
  const dw = dur('walk'), dr = dur('run'), vw = (extras?.stride?.walk ?? 1) / dw, vr = (extras?.stride?.run ?? 1) / dr;
  loco = vr > vw ? THREE.MathUtils.clamp((sp - vw) / (vr - vw), 0, 1) : 0; // no model: default clip stats, events still fire
  if (p.grounded && sp > 0.05 && p.state !== 'strike') {
    const rw = THREE.MathUtils.clamp(sp / vw, ...T.walkRate) / dw, rr = THREE.MathUtils.clamp(sp / vr, ...T.runRate) / dr;
    const u0 = phase;
    phase = (phase + THREE.MathUtils.lerp(rw, rr, loco) * dt) % 1;
    for (const s of steps) if (u0 <= phase ? u0 < s.at && phase >= s.at : u0 < s.at || phase >= s.at) {
      const g = reg.get('level')?.collide?.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.1);
      reg.set('player.step', { t: ctx.game.t, pos: p.pos.toArray(), surface: surfaceOf(g), foot: s.foot });
      reg.set('audio.cue', { name: 'step', gain: sp > T.runAt ? 0.6 : 0.7, run: sp > T.runAt, foot: s.foot });
    }
  }
  if (p.state === 'strike' && !hitSent && strikeT >= T.strikeHitT) {
    hitSent = true;
    reg.set('player.strikeHit', { t: ctx.game.t, pos: p.pos.toArray(), target: null, combo });
    if (combo === 3) reg.set('audio.cue', { name: 'land', gain: 0.8, surface: surfaceUnder(reg) }); // the slam thuds into the ground
  }
}

// Procedural layers (render only), applied after the mixer. rotWorld turns a bone about a world axis.
const _pq = new THREE.Quaternion(), _pi = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _ax = new THREE.Vector3(), _ax2 = new THREE.Vector3(), _wq = new THREE.Quaternion(), _hv = new THREE.Vector3();
function rotWorld(b, axis, ang) {
  if (!b || !ang) return;
  b.parent.getWorldQuaternion(_pq);
  b.quaternion.premultiply(_rq.setFromAxisAngle(axis, ang).premultiply(_pi.copy(_pq).invert()).multiply(_pq));
}
const LEAN = { hz: 6, damp: 0.7, roll: 0.012, rollMax: 0.2, pitch: 0.05, pitchMax: 0.12 }; // spring; rad per (m/s * rad/s); rad; rad per m/s^2 / g... (x a/g); rad
const BREATH = { hz: [0.22, 0.5], deg: [0.8, 2], rise: 4, decay: 10, gasp: 1.5 }; // rest -> exerted; s; extra depth share at 0 breath (rate x1.5)
const LOOK = { range: 6, yaw: 70, pitch: 30, neck: 0.4, rate: 4, wRate: 6 }; // m, deg, deg, share, 1/s, 1/s
// lean target from the last sim step: roll into the turn (speed x turn rate), pitch with forward acceleration; spring-smoothed
function leanRender(dt) {
  const L = lay, calm = p.state !== 'strike' && p.state !== 'dash' && p.grounded;
  const sp = Math.hypot(p.vel.x, p.vel.z), w = Math.atan2(Math.sin(p.heading - prevHeading), Math.cos(p.heading - prevHeading)) / DT;
  const s = Math.sin(p.heading), c = Math.cos(p.heading), af = ((p.vel.x - prevVel.x) * s + (p.vel.z - prevVel.z) * c) / DT;
  const tx = calm ? THREE.MathUtils.clamp(LEAN.pitch * af / 9.81, -LEAN.pitchMax, LEAN.pitchMax) * (1 - THREE.MathUtils.clamp((Math.abs(w) - 4) / 4, 0, 1)) : 0; // no pitch into a snap turn: the leaned hips, off the yaw axis, swung 4 cm a frame round it on a turning tap
  // banking belongs to a running curve: a snap turn from standstill (12 rad/s at walk speed) threw the hips 7 cm a frame sideways, so the
  // turn rate is capped at a curve's and the roll fades in with speed
  const tz = calm ? THREE.MathUtils.clamp(-LEAN.roll * sp * THREE.MathUtils.clamp(w, -4, 4) * Math.min(1, sp / T.runAt), -LEAN.rollMax, LEAN.rollMax) : 0; // +x is the hero's left: turning left (w > 0) rolls toward +x
  const om = 2 * Math.PI * LEAN.hz;
  for (let i = 0, n = Math.ceil(dt * 120), h = dt / Math.max(1, n); i < n; i++) {
    L.leanV.x += ((tx - L.lean.x) * om * om - 2 * LEAN.damp * om * L.leanV.x) * h; L.leanV.y += ((tz - L.lean.y) * om * om - 2 * LEAN.damp * om * L.leanV.y) * h;
    L.lean.x += L.leanV.x * h; L.lean.y += L.leanV.y * h;
  }
}
function bodyLayers(reg, dt) {
  const L = lay, B = L.bone, right = _ax.set(1, 0, 0).applyQuaternion(model.getWorldQuaternion(_q)); // model +x: pitch-forward axis
  if (layers.has('breath')) { // chest pitch, faster and deeper after running
    const run = p.grounded && Math.hypot(p.vel.x, p.vel.z) > T.runAt;
    L.exert += ((run ? 1 : 0) - L.exert) * (1 - Math.exp(-dt / (run ? BREATH.rise : BREATH.decay)));
    L.gasp += ((p.breath <= 0 ? 1 : 0) - L.gasp) * (1 - Math.exp(-dt / (p.breath <= 0 ? 0.4 : 1.5))); // out of breath: heaving
    const ex = Math.max(L.exert, L.gasp);
    L.breath = (L.breath + dt * THREE.MathUtils.lerp(...BREATH.hz, ex) * (1 + 0.5 * L.gasp)) % 1;
    rotWorld(B.Spine02, right, -THREE.MathUtils.degToRad(THREE.MathUtils.lerp(...BREATH.deg, ex) * (1 + BREATH.gasp * L.gasp)) * Math.sin(2 * Math.PI * L.breath)); // inhale: chest up and back
    // in a wind cairn's spring while refilling: slow deep breaths (0.4 Hz), chest lifts and shoulders rise
    L.inhale += ((p.spring && p.breath < p.breathMax ? 1 : 0) - L.inhale) * (1 - Math.exp(-dt / 0.35));
    L.inPh = (L.inPh + dt * 0.4) % 1;
    const lift = L.inhale * (0.5 - 0.5 * Math.cos(2 * Math.PI * L.inPh)), fwd = _ax2.set(0, 0, 1).applyQuaternion(model.getWorldQuaternion(_wq));
    if (lift > 0.001) {
      rotWorld(B.Spine02, right, -THREE.MathUtils.degToRad(7) * lift);
      rotWorld(B.L_Clavicle, fwd, THREE.MathUtils.degToRad(9) * lift); rotWorld(B.R_Clavicle, fwd, -THREE.MathUtils.degToRad(9) * lift);
    }
  }
  if (layers.has('look') && B.Head) {
    const head = B.Head.getWorldPosition(_hv), flags = reg.get('flags') ?? {}, fwdX = Math.sin(p.heading), fwdZ = Math.cos(p.heading);
    let yaw = null, pitch = 0, best = 2 * LOOK.range; // echoes rank after every switch (k = d + range)
    if (talkAt && Math.hypot(talkAt.x - head.x, talkAt.z - head.z) < 2 * LOOK.range && !(Math.hypot(p.vel.x, p.vel.z) > 1 && (talkAt.x - head.x) * fwdX + (talkAt.z - head.z) * fwdZ < 0)) { // a speaking NPC first (any side while standing; walking away the head stays forward)
      yaw = Math.atan2(talkAt.x - head.x, talkAt.z - head.z) - p.heading; pitch = Math.atan2(talkAt.y + 1 - head.y, Math.hypot(talkAt.x - head.x, talkAt.z - head.z)); best = -1;
    }
    for (const m of lookAts) { // nearest unlit switch in front, else an uncollected echo
      if (flags[`${m.kind}.${m.id}`]) continue;
      const dx = m.pos.x - head.x, dz = m.pos.z - head.z, d = Math.hypot(dx, dz), k = d + (m.kind === 'echo' ? LOOK.range : 0);
      if (d > LOOK.range || dx * fwdX + dz * fwdZ <= 0 || k >= best) continue;
      best = k; yaw = Math.atan2(dx, dz) - p.heading; pitch = Math.atan2(m.pos.y + 1 - head.y, d);
    }
    if (yaw === null) yaw = (reg.get('camera.yaw') ?? p.heading) - p.heading; // where the camera looks
    yaw = THREE.MathUtils.clamp(Math.atan2(Math.sin(yaw), Math.cos(yaw)), -THREE.MathUtils.degToRad(LOOK.yaw), THREE.MathUtils.degToRad(LOOK.yaw));
    pitch = THREE.MathUtils.clamp(pitch, -THREE.MathUtils.degToRad(LOOK.pitch), THREE.MathUtils.degToRad(LOOK.pitch));
    const e = 1 - Math.exp(-LOOK.rate * dt);
    L.look.x += (yaw - L.look.x) * e; L.look.y += (pitch - L.look.y) * e;
    L.lookW += ((p.state === 'strike' || p.state === 'dash' || oneW > 0.5 ? 0 : 1) - L.lookW) * (1 - Math.exp(-LOOK.wRate * dt));
    for (const [b, k] of [[B.NeckTwist01, LOOK.neck], [B.Head, 1 - LOOK.neck]]) {
      rotWorld(b, UP, L.look.x * L.lookW * k);
      rotWorld(b, right, -L.look.y * L.lookW * k); // up = pitch back
    }
  }
}

// Render side: target weights per state group, per-transition fades, weights normalized to 1, clips sampled at sim time.
function animRender(dt, alpha) {
  const back = (1 - alpha) * DT, sp = fwdSpeed();
  const want = {};
  const st = p.state;
  const dA = Math.max(0, dashT - back), dashing = actions.dash && dA < dur('dash') && st !== 'jump'; // the clip outlives the 0.18 s burst
  const flipping = !p.grounded && pick.jump === 'jump.b' && airT < dur('jump.b'); // the flip plays out before the fall loop takes over (airT is 0 on the ground: grounded never flips)
  const g = st === 'strike' ? 'strike' : st === 'sing' && actions.sing ? 'sing' : dashing ? 'dash' : !p.grounded && upT < 0.35 ? 'air' : st === 'jump' || flipping ? 'jump' : st === 'fall' ? (airT > T.fallLoopAfter || p.vel.y < -6 ? 'fall' : 'jump') : 'loco';
  if (g !== group) { fadeT = T.fade[`${group}>${g}`] ?? T.fade.default; group = g; }
  const standing = !sitting && standT < T.anim.standUp;
  if (g === 'loco') {
    const m = THREE.MathUtils.clamp(sp / 0.6, 0, 1), slot = sitting || standing ? 'sit' : edge && st === 'idle' ? 'teeter' : brace ? 'brace' : fidget ?? 'idle';
    want[slot] = 1 - m; want[walkVar] = m * (1 - loco); want[runVar] = (want[runVar] ?? 0) + m * loco;
  } else want[g === 'strike' ? pick.slash : g === 'air' ? 'air.updraft' : g === 'fall' && fallT > T.anim.fallLong ? 'fall.long' : pick[g] ?? g] = 1; // jump/slash play the sim's pick
  // all weights travel the same fraction of their way per frame (the furthest one at 1 / fadeT): each on its own linear ramp let the small
  // ones hit 0 first, and the normalised blend then snapped to the remaining clip (a 5 cm hips pop two frames after a short tap)
  let sum = 0, far = 0;
  for (const [n, s] of Object.entries(actions)) if (!ADD(n)) far = Math.max(far, Math.abs((want[n] ?? 0) - s.w));
  const k = far > 0 ? Math.min(1, dt / fadeT / far) : 1;
  for (const [n, s] of Object.entries(actions)) {
    if (ADD(n)) continue;
    s.w += ((want[n] ?? 0) - s.w) * k;
    sum += s.w;
  }
  const ph = ((prevPhase + (((phase - prevPhase) % 1) + 1) % 1 * alpha) % 1);
  const sn = pick.slash, hitC = (extras?.events?.[sn]?.hit ?? 0.5) * dur(sn), sT = Math.max(0, strikeT - back);
  const tAt = { idle: ((pose ? pose.t : renderT) % dur('idle')), walk: ph * dur('walk'), run: ph * dur('run'), slash: Math.min(sT < T.strikeHitT ? sT / T.strikeHitT * hitC : hitC + (sT - T.strikeHitT) * T.strikeAnimSpeed, dur(sn)),
    jump: Math.min(Math.max(0, airT - back), dur(pick.jump)), dash: Math.min(dA, dur('dash')), fall: Math.max(0, airT - T.fallLoopAfter - back) % dur('fall'), land: Math.min(Math.max(0, landT - back), dur(pick.land)), sing: Math.min(Math.max(0, singT - back) * (song ? T.singTime / T.songTime : 1), dur('sing')) }; // a gift song plays the sing clip's raise twice as fast
  const fT = Math.max(0, fidgetT - back), loop = (n) => (renderT % dur(n));
  const tN = { 'air.updraft': loop('air.updraft'), teeter: loop('teeter'), brace: loop('brace'), 'fall.long': Math.max(0, fallT - T.anim.fallLong - back) % dur('fall.long'),
    sit: sitting ? Math.min(Math.max(0, sitT - back), dur('sit')) : dur('sit') * (1 - THREE.MathUtils.clamp(Math.max(0, standT - back) / T.anim.standUp, 0, 1)) }; // standing up = the sit played back
  for (const [n, s] of Object.entries(actions)) {
    const gp = groupOf(n);
    if (ADD(n) && pose) { s.a.setEffectiveWeight(n === (pose.clip ?? 'land') ? pose.land : 0); s.a.time = dur(n) * (pose.at ?? 0.3); continue; }
    if (ADD(n)) s.a.setEffectiveWeight(n === pick.land && landT < dur(n) ? THREE.MathUtils.clamp(impact / T.landFull, 0.25, 1) : 0);
    else s.a.setEffectiveWeight(sum > 0 ? s.w / sum : 0);
    if (n in tN) s.a.time = tN[n];
    else if (n === fidget) s.a.time = Math.min(fT, dur(n));
    else if (n === gp || gp !== 'idle') s.a.time = tAt[gp] ?? 0; // a fidget fading out keeps its last frame
  }
  if (pose?.loop && actions[pose.loop]) for (const [n, s] of Object.entries(actions)) { // a cutscene path's clip, looped on the cutscene clock
    if (ADD(n)) continue;
    s.a.setEffectiveWeight(n === pose.loop ? 1 : 0);
    if (n === pose.loop) s.a.time = pose.dist != null && extras?.stride?.[n] ? ((pose.dist / extras.stride[n]) % 1) * dur(n) : pose.once != null ? Math.min(pose.once, dur(n) - 1e-3) : pose.t % dur(n); // walking: the phase follows the distance (no foot slide); a one-shot (roll, sing) runs from its segment's start
  }
  // one-shots over everything, timed by sim clocks: stumble (denied dash, 'player.puff') before gift_receive (a gift line) before
  // the sim's skid / land.roll / land.crouch
  const os = renderT - stumbleT, ot = renderT - receiveT, at1 = Math.max(0, act1T - back);
  const one = actions.stumble && os >= 0 && os < dur('stumble') ? ['stumble', os] : actions.gift_receive && ot >= 0 && ot < dur('gift_receive') ? ['gift_receive', ot]
    : act1 && actions[act1] && at1 < dur(act1) ? [act1, at1] : null;
  oneW = 0;
  if (one) {
    const [n, t] = one;
    oneW = THREE.MathUtils.clamp(Math.min(t / 0.1, (dur(n) - t) / 0.15), 0, 1); // 0.1 s in, 0.15 s out
    for (const [m, s] of Object.entries(actions)) if (!ADD(m)) s.a.setEffectiveWeight(m === n ? oneW : s.a.getEffectiveWeight() * (1 - oneW));
    actions[n].a.time = t;
  }
  let top = 0;
  for (const [n, s] of Object.entries(actions)) {
    const w = ADD(n) ? 0 : s.a.getEffectiveWeight();
    if (w > top) { top = w; model.userData.clip = n; } // the clip on screen (debug / tests read it)
  }
  for (const r of proc) r.b.quaternion.copy(r.q); // back to last frame's animated pose (see setupModel)
  mixer.update(0);
  for (const r of proc) r.q.copy(r.b.quaternion);
}

export default {
  name: 'player', order: 20, deps: ['level'],
  async init(ctx) {
    T = TUNING; falls = 0; strikeHeld = false; strikeT = Infinity; singT = -1; sung = false; song = songHeld = null; strikeCd = 0; strikeBuf = 0; mixer = null; extras = null; jumpHeld = false; bufferT = 0; coyoteT = 0; cut = true; model = null;
    dashOn = ctx.params.get('dash') !== '0'; dashHeld = false; dashDir = [0, 1];
    breathOn = ctx.params.get('breath') !== '0'; woke = new Set(); emptyCue = false; snap = null;
    fray = 0; dieN = 0; lockT = limpT = 0; rollAt = -1e9; softFalls = ctx.params.get('softfalls') === '1'; // assist: no stagger / fray (default off; the bot never sets it)
    talkAt = null; stumbleT = receiveT = puffAt = -1e9;
    ctx.registry.on('gift', (g) => ['dash', 'windbreath', 'airdash'].includes(g.id) && threads?.land.push(g.t + 2.6)); // render only: when the gift's fx threads reach the cloak (g.t already waits for a 1st gift); songs add no breath stripe
    ctx.registry.on('talk.line', (l) => { talkAt = l?.pos ? new THREE.Vector3().fromArray(l.pos) : null; if (l?.text?.gift) receiveT = ctx.game.t; });
    ctx.registry.on('end', (e) => { if (e === 'goal') receiveT = ctx.game.t; }); // goal touch: the hero takes in the light (gift_receive) before the results card
    ctx.registry.on('player.puff', ({ t, breath }) => { stumbleT = t; if (breath && threads) threads.pulse.value = 1; });
    phase = prevPhase = 0; airT = 0; landT = Infinity; impact = 0; whooshed = false; hitSent = true; loco = 0; group = 'loco'; fadeT = T.fade.default; renderT = null; steps = STEPS.map((at, i) => ({ at, foot: 'lr'[i] }));
    prevPos = new THREE.Vector3(); prevVel = new THREE.Vector3();
    threads = null; vars = null; pick = { jump: 'jump', slash: 'slash', land: 'land' }; idleT = 0; fidgetAt = null; fidget = null; fidgetT = 0; proc = []; lay = null;
    combo = 0; jumpN = 0; flipAt = 2; fallT = 0; upT = 9; act1T = 9; edge = brace = false; runVar = 'run'; walkVar = 'walk'; windH = [0, 0]; windY = 0;
    stillT = fidgetN = 0; sitT = 0; standT = 9; endless = true; wLean = [0, 0];
    const ly = ctx.params.get('layers');
    layers = new Set(ly != null ? ly.split(',') : ['breath', 'look', 'lean']);
    lookAts = [...(ctx.registry.get('level')?.data.mechanisms ?? []), ...(ctx.registry.get('level')?.data.echoSlots ?? []).map((e) => ({ ...e, kind: 'echo' }))].filter((m) => m.kind === 'switch' || m.kind === 'echo').map((m) => {
      const pos = m.pos ?? ctx.scene.getObjectByName(m.node)?.position.toArray();
      return pos && { id: m.id, kind: m.kind, far: !!m.far, pos: new THREE.Vector3().fromArray(pos) };
    }).filter(Boolean);
    p = { pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, grounded: false, groundBody: null, state: 'idle', stateT: 0, breath: 0, breathMax: 0, tuning: T, jumpReach: (rise) => jumpReach(rise, T) };
    p.breath = p.breathMax = breathMaxOf(ctx.registry);
    spawn(ctx.registry);
    const gltf = await ctx.assets.gltf(ctx.params.get('hero') || HERO, true);
    if (gltf) setupModel(gltf);
    else { // fallback: capsule with a nose so facing is visible
      model = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color: 0xd8553a });
      model.add(new THREE.Mesh(new THREE.CapsuleGeometry(T.radius, T.height - 2 * T.radius, 6, 12).translate(0, T.height / 2, 0), mat));
      model.add(new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.3).translate(0, T.height * 0.75, T.radius), mat));
    }
    model.name = 'player'; model.rotation.order = 'YXZ'; // yaw, then the dash lean
    ctx.add(model);
    shadow = makeShadow(); ctx.add(shadow);
    flatGround = { groundAt: () => ({ y: 0, normal: new THREE.Vector3(0, 1, 0), kind: 'solid', body: null }), sweepCapsule: (a, b) => ({ pos: b.clone(), hitNormal: null }), walkCos: 0.6 };
    ctx.registry.set('falls', 0);
    ctx.registry.set('player', p);
    ctx.registry.set('player.model', model);
    ctx.registry.set('camera.target', p);
    ctx.registry.on('player.place', (s) => { p.pos.fromArray(s.pos); p.vel.fromArray(s.vel); p.heading = prevHeading = s.heading; prevPos.copy(p.pos); prevVel.copy(p.vel); p.grounded = false; p.groundBody = null; apexY = p.pos.y; }); // U17b: an arrive scene hands over mid-glide (cutscene.js)
    ctx.registry.on('checkpoint', () => { dieN = 0; if (fray) { fray = 0; p.breathMax = breathMaxOf(ctx.registry); } snap = { b: p.breath, max: p.breathMax }; }); // a new checkpoint mends torn threads (no refill)
    for (const k of ['enemy.hit', 'enemy.stun', 'break']) ctx.registry.on(k, () => { airStrikes = 1; }); // a hit refreshes the air strike
    ctx.registry.on('song.cast', (c) => { if (c.song === 'gust' && p && !p.grounded) { dashDir = [-Math.sin(c.heading), -Math.cos(c.heading)]; dashT = 0; ctx.registry.set('player.recoil', { t: ctx.game.t, pos: p.pos.toArray(), dir: [...dashDir] }); } }); // R5: an air Gust recoils ~2.3 m opposite the aim (a free dash burst) // no refill: respawn restores this (spawn)
    ctx.registry.on('break', () => { dashCharge = Math.max(dashCharge, 1); }); // breaking a wall (level.js) refreshes the air dash: dash through, dash on
  },
  update(ctx, dt) {
    const reg = ctx.registry, level = reg.get('level'), collide = level?.collide ?? flatGround;
    const inp = lockT > 0 ? LOCKED : reg.get('input') ?? { move: [0, 0] };
    lockT -= dt; limpT -= dt; hangT += dt; pogoT += dt; hoverT += dt;
    prevPos.copy(p.pos); prevHeading = p.heading; prevVel.copy(p.vel);
    if (p.grounded && p.groundBody && dashT >= T.dashTime) p.groundBody.carry(p.pos); // a dash ignores the platform's motion

    if (sitting && touchedOf(reg, inp)) { sitting = false; standT = 0; } // any input: stand up (movement held for anim.standUp s)

    // strike (E / click / bot): grounded only, one per cooldown (a press up to strikeBuffer s early waits for it, so mashing chains);
    // resolves immediately ('player.strike'). A strike within comboWindow s of the last hit chains the combo: sweep (slash),
    // backhand (slash.b), overhead slam (slash.c), then again
    // R9 roll: a strike / dash press while falling from >= stagger - 1 m, <= fall.roll s before touchdown, is a roll (no strike, no dash)
    const gy = !p.grounded && p.vel.y < 0 ? collide.groundAt(p.pos.x, p.pos.z, p.pos.y)?.y : undefined;
    const rollPress = gy !== undefined && (p.pos.y - gy) / -p.vel.y <= T.fall.roll && apexY - gy >= T.fall.stagger && ((inp.strike && !strikeHeld) || (inp.dash && !dashHeld));
    if (rollPress) rollAt = ctx.game.t;
    const strikePressed = inp.strike && !strikeHeld && !rollPress;
    strikeHeld = !!inp.strike; strikeT += dt; strikeCd -= dt; strikeBuf = strikePressed ? T.strikeBuffer : strikeBuf - dt;
    if (strikeBuf > 0 && strikeCd <= 0 && !p.grounded && airStrikes > 0 && singT < 0 && dashT >= T.dashTime) { // R5 air strike / pogo
      strikeBuf = 0; airStrikes--; combo = 1; strikeT = 0; strikeCd = T.strikeCooldown; hitSent = false;
      const pogo = !!(inp.pogo || inp.down);
      if (pogo) { pogoT = 0; pick.slash = clipOf('strike.down', 'slash.c'); } else { hangT = 0; pick.slash = clipOf('slash.air', 'slash'); }
      reg.set('player.strike', { t: ctx.game.t, pos: p.pos.toArray(), heading: p.heading, air: true, pogo });
    }
    if (strikeBuf > 0 && strikeCd <= 0 && p.grounded && dashT >= T.dashTime) {
      strikeBuf = 0;
      combo = strikeT <= T.strikeHitT + T.comboWindow ? (combo % 3) + 1 : 1;
      strikeT = 0; strikeCd = T.strikeCooldown; hitSent = false; pick.slash = ['slash', 'slash.b', 'slash.c'][combo - 1];
      reg.set('player.strike', { t: ctx.game.t, pos: p.pos.toArray(), heading: p.heading });
    }
    // sing (hold E / pad Y / bot): grounded, not mid-strike or dash; the hero stands, raises the staff and traces a glyph. Press:
    // 'player.singStart' (level.js picks the rune within its reach and its note); held singTime s: 'player.sing' (level.js wakes it);
    // release or interruption: 'player.singEnd' {done}. Free: no breath, no cooldown. A sung song needs a release before the next.
    // gift songs (1 / 2 / 3, pad LB + X / Y / B, bot): a press, grounded and free, with the song's gift held: breath.song is spent and
    // the hero sings for songTime s in the sing pose ('player.songStart', fx.js glyph in the song's colour), then 'player.song' (level.js
    // applies it). Short of breath: a failed note ('player.puff' {song}: puff, stumble, fizzle cue), nothing else.
    const songPressed = inp.song && inp.song !== songHeld;
    songHeld = inp.song ?? null;
        if (songPressed && !song && singT < 0 && (p.grounded || airHover > 0) && dashT >= T.dashTime && !(strikeT < T.strikeHold) && reg.get('flags')?.[`gift.${inp.song}`]) {
      if (!endless && p.breath < T.breath.song) {
        if (ctx.game.t - puffAt > 0.6) { puffAt = ctx.game.t; reg.set('player.puff', { t: ctx.game.t, pos: p.pos.toArray(), heading: p.heading, breath: true, song: inp.song }); }
      } else {
        if (!endless) { const b0 = p.breath; p.breath -= T.breath.song; breathEvent(ctx, b0, 'song'); }
        song = inp.song; singT = 0;
        if (!p.grounded) { airHover--; hoverT = 0; hoverMax = T.songHover; } // R5 air song: hovers while it charges
        reg.set('player.songStart', { t: ctx.game.t, pos: p.pos.toArray(), heading: p.heading, song });
      }
    }
    if (song) {
      singT += dt;
      if (!reg.get('songs.state')) { // songs.js: released (cast), fizzled or over-held
        if (!p.grounded) hoverT = Infinity;
        reg.set('player.song', { t: ctx.game.t, pos: p.pos.toArray(), heading: p.heading, song });
        reg.set('player.singEnd', { t: ctx.game.t, done: true, song });
        song = null; singT = -1;
      }
    } else if (inp.sing && (p.grounded || hoverT < T.air.hover || (singT < 0 && airHover > 0)) && dashT >= T.dashTime && !(strikeT < T.strikeHold)) { // R5: sung in the air at the hover's end
      if (singT < 0) { singT = 0; sung = false; if (!p.grounded) { airHover--; hoverT = 0; hoverMax = T.air.hover; } reg.set('player.singStart', { t: ctx.game.t, pos: p.pos.toArray(), heading: p.heading }); }
      else singT += dt;
      if (!sung && (singT >= T.singTime || (!p.grounded && singT >= T.air.hover - dt / 2))) { sung = true; reg.set('player.sing', { t: ctx.game.t, pos: p.pos.toArray(), heading: p.heading }); }
    } else if (singT >= 0) { reg.set('player.singEnd', { t: ctx.game.t, done: sung }); singT = -1; }
    const aimCam = song && !inp.face && !reg.get('bot.enabled') && !(inp.move[0] || inp.move[1]); // a charging song with no stick: the aim is the camera's
    const aimStick = song && p.grounded && !inp.face && (inp.move[0] || inp.move[1]); // U20: on the ground a charging song plants the hero, the stick only turns the aim
    if ((inp.face || aimCam || aimStick) && strikeT >= T.strikeHold) { // bot: turn in place toward a direction
      const want = aimStick ? Math.atan2(inp.move[0], inp.move[1]) : aimCam ? reg.get('camera.yaw') ?? p.heading : Math.atan2(inp.face[0], inp.face[1]), diff = Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading));
      p.heading += THREE.MathUtils.clamp(diff, -T.turnRate * dt, T.turnRate * dt);
    }

    // dash (Q / RMB / pad B / bot): rising edge buffered dashBuffer s; ground cooldown, 1 air charge (refilled on landing and in an
    // updraft); cancels a strike only after its hit. Direction = stick (camera-relative) or facing, horizontal only.
    // Gifts (npc.js, level.js): no gift.dash = a press only puffs the cloak (no breath); gift.airdash = a 2nd air charge.
    const gifts = reg.get('flags') ?? {}, canDash = !!gifts['gift.dash'], airCharges = gifts['gift.airdash'] ? 2 : 1;
    const dashPressed = inp.dash && !dashHeld;
    dashHeld = !!inp.dash; dashT += dt; dashCd -= dt;
    if (dashPressed && dashOn && !canDash) reg.set('player.puff', { t: ctx.game.t, pos: p.pos.toArray(), heading: p.heading });
    const noBreath = breathOn && p.breath < T.breath.dash && !reg.get('settings')?.infiniteAirDash && reg.get('settings')?.breath !== false;
    if (dashPressed && dashOn && canDash && noBreath && ctx.game.t - puffAt > 0.6) { // empty breath: the same refusal (puff, deny, stumble), threads pulse; rate-limited
      puffAt = ctx.game.t; reg.set('player.puff', { t: ctx.game.t, pos: p.pos.toArray(), heading: p.heading, breath: true });
    }
    dashBufT = dashPressed && dashOn && canDash && !rollPress ? T.dashBuffer : Math.max(0, dashBufT - dt);
    if (p.grounded || (reg.get('wind')?.y ?? 0) > 0) { dashCharge = airCharges; airStrikes = airHover = 1; }
    if (dashT >= T.dashTime && dashT - dt < T.dashTime) { // burst over: exit at sprint along the dash, the approach below decays it
      p.vel.x = dashDir[0] * T.sprint; p.vel.z = dashDir[1] * T.sprint;
    }
    const [mx0, mz0] = inp.move, moving = Math.hypot(mx0, mz0) > 0.01;
    endless = breathTick(ctx, dt, inp.run && moving && p.grounded && dashT >= T.dashTime && !(strikeT < T.strikeHold));
    if (dashBufT > 0 && dashCd <= 0 && dashT >= T.dashTime && (p.grounded || dashCharge > 0) && !(strikeT < T.strikeHitT) && (endless || p.breath >= T.breath.dash)) {
      const [ix, iz] = inp.move, im = Math.hypot(ix, iz);
      dashDir = im > 0.01 ? [ix / im, iz / im] : [Math.sin(p.heading), Math.cos(p.heading)];
      if (!p.grounded && !(reg.get('settings')?.infiniteAirDash && !reg.get('bot.enabled'))) dashCharge--; // assist: endless air dashes (never the bot)
      if (!endless) { const b0 = p.breath; p.breath -= T.breath.dash; breathEvent(ctx, b0, 'dash'); }
      dashT = 0; dashCd = T.dashCooldown; dashBufT = 0; strikeT = Infinity; cut = true;
      p.heading = Math.atan2(dashDir[0], dashDir[1]);
      reg.set('player.dash', { t: ctx.game.t, pos: p.pos.toArray(), dir: [...dashDir], air: !p.grounded });
      reg.set('audio.cue', { name: 'dash' });
    }
    const dashing = dashT < T.dashTime;

    // horizontal: approach target velocity (accel or decel), reduced in air; planted while striking
    const [mx, mz] = (strikeT < T.strikeHold && p.grounded) || (singT >= 0 && !song) || (song && p.grounded) || standT < T.anim.standUp ? [0, 0] : inp.move, mag = Math.min(1, Math.hypot(mx, mz)), top = (song ? T.jog * T.songMove : inp.run ? T.run : T.jog) * (limpT > 0 ? T.fall.limp : 1); // breath never gates the run; a fray limps
    const dx = mx * top - p.vel.x, dz = mz * top - p.vel.z, d = Math.hypot(dx, dz);
    const rate = (mag > 0.01 ? T.accelStart : T.decel) * (p.grounded ? 1 : T.airControl);
    if (dashing) { p.vel.x = dashDir[0] * T.dashSpeed; p.vel.z = dashDir[1] * T.dashSpeed; }
    else if (d > 1e-6) { const k = Math.min(d, rate * dt) / d; p.vel.x += dx * k; p.vel.z += dz * k; }
    if (mag > 0.01 && !dashing) {
      // reversal (input > 100 deg off the motion): keep facing the motion while braking, else the body faces the new way and
      // slides backwards (worst in the air, where vel turns at airControl); once slow, flip fast
      const want = Math.atan2(mx, mz), diff = Math.atan2(Math.sin(want - p.heading), Math.cos(want - p.heading));
      const sp = Math.hypot(p.vel.x, p.vel.z), cosA = (p.vel.x * mx + p.vel.z * mz) / (sp * mag + 1e-9), back = cosA < -0.17;
      if (p.grounded && sp > T.runAt + 1 && cosA < T.anim.skidCos && act1 !== 'skid') { act1 = 'skid'; act1T = 0; } // hard reversal at speed
      const r = back && sp > T.skidSpeed ? 0 : Math.abs(diff) > 1.75 ? T.turnRateFlip : T.turnRate;
      p.heading += THREE.MathUtils.clamp(diff, -r * dt, r * dt);
    }

    // jump: buffer + coyote, release cuts upward velocity once
    const pressed = inp.jump && !jumpHeld;
    jumpHeld = !!inp.jump;
    bufferT = pressed ? T.buffer : Math.max(0, bufferT - dt);
    coyoteT = p.grounded ? T.coyote : Math.max(0, coyoteT - dt);
    if (bufferT > 0 && coyoteT > 0 && standT >= T.anim.standUp) { // the press that stands the hero up is spent on standing
      if (dashT < T.dashTime) { dashT = T.dashTime; p.vel.x = dashDir[0] * T.sprint; p.vel.z = dashDir[1] * T.sprint; } // dash-jump leaves at sprint
      strikeT = Infinity; p.vel.y = jumpVel(T); p.grounded = false; p.groundBody = null; bufferT = coyoteT = 0; cut = false;
      if (++jumpN >= flipAt) { jumpN = 0; flipAt = 2 + (ctx.rng() < 0.5 ? 1 : 0); pick.jump = 'jump.b'; } else pick.jump = 'jump'; // a flip every 2nd-3rd jump
      reg.set('player.jump', { t: ctx.game.t, pos: p.pos.toArray() });
      reg.set('audio.cue', { name: 'jump', surface: surfaceUnder(reg) });
    }
    if (!cut && !inp.jump && p.vel.y > 0) { p.vel.y *= T.jumpCut; cut = true; }
    if (dashT < T.dashTime || hangT < T.air.hang || (!p.grounded && hoverT < hoverMax)) p.vel.y = 0; // gravity (and updraft) off for the burst, an air strike's hang, an air song's hover
    else p.vel.y -= T.gravity * dt;

    // wind x/z is a push velocity: moves the player, never stored in vel. wind y is an updraft acceleration (m/s^2,
    // > gravity lifts), capped at LIFT_MAX so the rise stays readable.
    const wind = reg.get('wind');
    windH = [wind?.x ?? 0, wind?.z ?? 0]; windY = wind?.y ?? 0;
    if (wind?.y && dashT >= T.dashTime) p.vel.y = Math.max(p.vel.y, Math.min(p.vel.y + wind.y * dt, LIFT_MAX));
    if (!p.grounded && pogoT < T.air.pogo && p.vel.y <= 0) { // R5 pogo: enemies.js / trials.js mark a target under the feet (ev.hit)
      const ev = { t: ctx.game.t, pos: p.pos.toArray(), hit: null };
      reg.set('player.pogo', ev);
      if (ev.hit) { p.vel.y = T.air.pogoV; pogoT = Infinity; dashCharge = airCharges; airStrikes = airHover = 1; apexY = p.pos.y; cut = true; reg.set('player.bounce', { t: ctx.game.t, pos: p.pos.toArray(), hit: ev.hit }); }
    }
    const to = p.pos.clone().addScaledVector(p.vel, dt);
    if (wind) { to.x += wind.x * dt; to.z += wind.z * dt; }
    solidOut(to);
    const was = p.grounded, vy = p.vel.y;
    const hit = collide.sweepCapsule(p.pos, to, T.radius, T.height, was ? T.stepUp : 0.05, p.vel); // projects vel on every contact plane
    p.pos.copy(hit.pos);

    // Ground hint = stepUp + 5 cm only when grounded (was). Airborne it stays at stepUp: +5 cm there drops the bot off l1/l2 ledges it
    // lands just below. Grounded, the extra 5 cm lets a top the lowest sphere just clears be stood on, not fallen into.
    const g = collide.groundAt(p.pos.x, p.pos.z, p.pos.y + T.stepUp + (was ? 0.05 : 0));
    p.grounded = !!g && p.vel.y <= 0 && g.normal.y >= collide.walkCos && g.y >= p.pos.y - (was ? T.stepDown : 0);
    if (p.grounded) { p.pos.y = g.y; p.vel.y = 0; p.groundBody = g.body; cut = true; } else p.groundBody = null;
    if (p.grounded && !was && airT > 0) {
      impact = -vy; landT = 0; whooshed = false; pick.jump = 'jump'; // the flip ends with its airtime: a later walk-off fall plays the plain jump
      pick.land = impact > T.landFull && actions?.['land.hard'] ? 'land.hard' : 'land';
      const hs = Math.hypot(p.vel.x, p.vel.z), A = T.anim, one = hs > A.roll[0] && impact > A.roll[1] ? 'land.roll' : hs < A.crouch[0] && impact > A.crouch[1] ? 'land.crouch' : null;
      if (one) { act1 = one; act1T = 0; pick.land = null; } // full-body one-shot instead of the additive squat
      reg.set('player.land', { t: ctx.game.t, pos: p.pos.toArray(), impact: +impact.toFixed(3) });
      // R9: the drop from the apex decides the landing
      const h = apexY - p.pos.y, F = T.fall;
      let kind = h < F.hard ? null : h < F.stagger ? 'hard' : h < F.fray && ctx.game.t - rollAt <= F.roll ? 'roll' : h < F.fray ? 'stagger' : 'fray';
      if (softFalls && (kind === 'stagger' || kind === 'fray')) kind = 'hard';
      if (kind === 'roll') { act1 = 'land.roll'; act1T = 0; pick.land = null; }
      else if (kind) {
        lockT = F[{ hard: 'lockHard', stagger: 'lockStagger', fray: 'lockFray' }[kind]]; p.vel.x *= 0.2; p.vel.z *= 0.2;
        if (kind === 'hard') { pick.land = clipOf('land.hard', 'land'); act1 = null; }
        else if (actions?.['land.crumple']) { act1 = 'land.crumple'; act1T = 0; pick.land = null; }
        else { act1 = null; pick.land = clipOf('land.hard', 'land'); impact = Math.max(impact, T.landFull); } // until land.crumple is authored: the full-weight squat
        if (kind === 'stagger' && !endless) { const b0 = p.breath; p.breath = Math.max(0, p.breath - 1); breathEvent(ctx, b0, 'stagger'); }
        if (kind === 'fray') tearThread(ctx);
      }
      if (kind) {
        const st = reg.get('stats') ?? {}; st[kind] = (st[kind] ?? 0) + 1; reg.set('stats', st);
        reg.set('player.landing', { t: ctx.game.t, pos: p.pos.toArray(), h: +h.toFixed(2), kind });
        if (kind !== 'roll') reg.set('audio.cue', { name: 'land_hard', gain: +THREE.MathUtils.clamp(h / F.fray, 0.4, 1).toFixed(2) }); // U7: the drop's height is heard
      }
    }
    apexY = p.grounded || (wind?.y ?? 0) > 0 || hoverT < hoverMax ? p.pos.y : Math.max(apexY, p.pos.y); // R9: soft = the apex resets
    p.apex = apexY;

    // U7: the fall cue (whoosh + the hero's cry) only once the fall is certain: falling fast, and no ground under him, along his
    // arc for the next 1.5 s, or within air-steer reach (3 m around) - a leap that lands on a bridge edge stays silent
    if (!p.grounded && !whooshed && p.vel.y < T.whooshVy) {
      let land = false;
      for (let i = 0; i <= 10 && !land; i++) { const s = i * 0.15; land = !!collide.groundAt(p.pos.x + p.vel.x * s, p.pos.z + p.vel.z * s, p.pos.y); }
      for (let i = 0; i < 8 && !land; i++) land = !!collide.groundAt(p.pos.x + Math.sin(i * 0.785) * 3, p.pos.z + Math.cos(i * 0.785) * 3, p.pos.y);
      voidT = land ? 0 : voidT + dt;
      if (voidT > 0.2) { whooshed = true; reg.set('audio.cue', { name: 'fall_whoosh' }); reg.set('audio.cue', { name: 'scream' }); }
    } else if (p.grounded) voidT = 0;
    if ((p.grounded && g.kind === 'kill') || p.pos.y < (level?.data.killY ?? -10)) {
      reg.set('falls', ++falls);
      dieN++; // deaths since the last new checkpoint
      if (!softFalls && dieN === 1) tearThread(ctx, false); // R9: the void tears a thread too (no limp: the respawn run-up must still clear its gap); only the first fall from a checkpoint
      if (dieN >= 4 && fray) { fray = 0; p.breathMax = breathMaxOf(reg); } // the 4th fall there: the cloak comes back whole
      reg.set('player.fall', { t: ctx.game.t, pos: p.pos.toArray() });
      spawn(reg);
      reg.set('player.respawn', { t: ctx.game.t, pos: p.pos.toArray() }); // hud.js fades on it
      reg.set('audio.cue', { name: 'respawn' });
    }

    const next = nextState();
    p.stateT += dt;
    if (next !== p.state) { STATES[p.state].exit?.(ctx); p.state = next; p.stateT = 0; STATES[next].enter?.(ctx); }
    STATES[p.state].update?.(ctx, dt);
    animTick(ctx, dt, inp);
  },
  beforeRender(ctx, alpha) {
    // render clock = sim time interpolated by alpha: real loop and test advance()/png() agree, paused -> dt 0
    const now = ctx.game.t - (1 - alpha) * DT, dt = renderT === null ? 0 : THREE.MathUtils.clamp(now - renderT, 0, 0.1);
    renderT = now;
    model.position.lerpVectors(prevPos, p.pos, alpha);
    const dh = Math.atan2(Math.sin(p.heading - prevHeading), Math.cos(p.heading - prevHeading));
    // dash lean: whole model pitched forward about the feet (order YXZ = pitch after yaw), held for the burst, eased out over 0.2 s
    const dA = Math.max(0, dashT - (1 - alpha) * DT), lean = THREE.MathUtils.degToRad(T.dashLean) * (1 - THREE.MathUtils.smoothstep(dA, T.dashTime, T.dashTime + 0.2));
    const flip = extras?.facing === '-z', sx = flip ? -1 : 1;
    if (lay && layers.has('lean')) leanRender(dt);
    const lx = lay && layers.has('lean') ? lay.lean.x : 0, lz = lay && layers.has('lean') ? lay.lean.y : 0;
    let hd = prevHeading + dh * alpha;
    const mk = ctx.registry.get('cut.world')?.mark; // a cutscene's hero mark (render only): drawn there, not where the player stopped
    if (mk) {
      model.position.x += (mk.x - model.position.x) * mk.w; model.position.z += (mk.z - model.position.z) * mk.w;
      if (mk.y != null) model.position.y += (mk.y - model.position.y) * mk.w; // a cutscene path flies or walks the hero
      hd += Math.atan2(Math.sin(mk.heading - hd), Math.cos(mk.heading - hd)) * mk.w;
    }
    // wind brace (render only): grounded in a side/tail wind, the body leans upwind, up to anim.windLean rad at 7.5 m/s
    const wl = Math.hypot(windH[0], windH[1]), wk = p.grounded && wl > T.anim.brace ? T.anim.windLean * Math.min(1, wl / 7.5) / wl : 0, hs = Math.sin(hd), hc = Math.cos(hd), we = 1 - Math.exp(-4 * dt);
    wLean[0] += (-wk * (windH[0] * hs + windH[1] * hc) - wLean[0]) * we; wLean[1] += (wk * (windH[0] * hc - windH[1] * hs) - wLean[1]) * we; // Euler XYZ: +x tips the head to +z, +z tips it to -x (local, before the heading): both lean upwind
    model.rotation.set(sx * (lean + lx + wLean[0]), hd + (flip ? Math.PI : 0), sx * (lz + wLean[1])); // all 3 axes: a quaternion write (fx hit-stop) can leave x=z=PI
    const rs = ctx.registry.get('player.renderScale'), base = extras?.scale ?? 1;
    if (Array.isArray(rs)) model.scale.set(base * rs[0], base * rs[1], base * rs[2]);
    else model.scale.setScalar(base * (rs ?? 1));
    placeShadow(ctx.registry);
    if (threads) { // eased toward the sim value; a gained whole segment flashes
      if (Math.floor(p.breath) > Math.floor(threads.shown)) threads.pulse.value = 1;
      threads.shown += (p.breath - threads.shown) * (1 - Math.exp(-8 * dt));
      while (threads.land.length && threads.land[0] <= now) threads.land.shift();
      const mx0 = threads.max.value, maxTo = Math.max(p.breathMax - threads.land.length, Math.min(mx0, p.breathMax)); // stripes of gifts still in flight stay hidden
      threads.max.value = maxTo > mx0 ? Math.min(maxTo, mx0 + dt / 0.7) : maxTo;
      if (Math.ceil(threads.max.value) > Math.ceil(mx0) || (threads.max.value > mx0 && threads.max.value === maxTo)) threads.pulse.value = 1;
      threads.b.value = threads.shown; threads.t.value = now;
      const fl = ctx.registry.get('flags') ?? {}; threads.gifts.value = +!!fl['gift.dash'] + !!fl['gift.windbreath'] + !!fl['gift.airdash']; const rs = ctx.registry.get('marks.res') ?? [0, 0, 0]; threads.songs.value.set(+!!fl['gift.gust'] * (1 + rs[0]), +!!fl['gift.name'] * (1 + rs[1]), +!!fl['gift.anchor'] * (1 + rs[2])); // R3: 2 = a target resonates (marks.js), the seam pulses with it
      threads.pulse.value *= Math.exp(-3 * dt);
      const held = ctx.registry.get('input')?.song ?? song;
      for (const k of songMarks) {
        const own = !!fl['gift.' + k.id];
        if (own && k.own === false) k.flare = 2.5; // the gift lands: its mark lights
        k.m.visible = own; // U19: an unearned song leaves no brand (the dark empty one read as a song already owned)
        k.own = own; k.flare = Math.max(own && held === k.id ? 1 : 0, k.flare - dt);
        const f = Math.min(1, k.flare);
        k.m.material.color.copy(own ? k.col : MARK_OFF).lerp(WHITE, own ? 0.55 * f * (0.7 + 0.3 * Math.sin(now * 14)) : 0);
        k.m.scale.setScalar(MARK.r * (1 + 0.45 * f));
      }
      const gF = !p.grounded && p.vel.y < 0 ? ctx.registry.get('level')?.collide.groundAt(p.pos.x, p.pos.z, p.pos.y) : null; // R9 flash: a >= stagger drop, <= fall.flash s from touchdown
      threads.flash.value = gF && apexY - gF.y >= T.fall.stagger && (p.pos.y - gF.y) / -p.vel.y <= T.fall.flash ? 1 : Math.max(0, threads.flash.value - dt * 4);
    }
    if (!mixer) return;
    pose = ctx.registry.get('cut.pose') ?? null;
    // the hero moves on mid gift_receive (stepping off Kamen during the gift line): fade it out, the frozen pose slid and fell like flying
    if (actions?.gift_receive && (!p.grounded || fwdSpeed() > 0.6) && !ctx.registry.get('end') && renderT - receiveT < dur('gift_receive') - 0.15) receiveT = renderT - dur('gift_receive') + 0.15 * oneW;
    animRender(dt, alpha);
    model.updateMatrixWorld(true);
    if (lay) bodyLayers(ctx.registry, dt);
  },
};
