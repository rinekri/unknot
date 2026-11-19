// Knot Shards (R3): bound wind and stone. No HP: the threat is a push off an edge (void fall -> checkpoint respawn). Sim-side and
// deterministic (positions from sim time only, no rng); render reads the sim state. level.enemies = [{id, kind, pos: [x, y, z]
// (ground under it), ...}]:
//   squall  {r?, aggro?, motif?, boss?}: a knotted swirl of wind hovering HOVER m up. Player within aggro m (and r m of home): it
//           drifts to ~2.6 m, telegraphs SQ.tele s (glow + 'enemy.telegraph'), then charges SQ.chargeV m/s for SQ.charge s; contact
//           knocks the hero (a decaying horizontal push through registry 'wind' + a hop). A staff hit or a Gust *during the
//           telegraph* stuns it SQ.stun s ('enemy.stun'); stunned it is unbindable: the Name frees it into an updraft puff
//           (wind.y lift for PUFF_S s, breath refilled once). boss: a minion, active only in that boss's phase 1.
//   warden  {path: [[x, z], [x, z]], motif?}: a stone shard patrolling path at WD.speed. Hero in front within WD.aggro m: it
//           telegraphs WD.tele s (shakes), rams WD.ramV m/s for WD.ram s (stops at an edge). 3 staff hits within WD.comboWin s (or a
//           combo finisher) or a Gust that drives it into a wall or rim stagger it WD.stagger s; a hit flinches a telegraph.
//           Staggered + Name: it unbinds into a rune step (a kinematic body, 1.4 x 0.5 m).
//           demo: {flag, song, r?}: once that flag is set and the hero is within r m, it is stunned for him ('enemy.demo': the song sounds).
//   boss    {r, minions: [squall ids], motifs: [3]}: the Knot Warden. Phase 1 squall waves (all minions stunned once), 2 a ram
//           (3 hits), 3 rings (BOSS.rings shock rings at BOSS.ringV m/s: jump them); each ends in an unbind window (BOSS.window s,
//           Name -> next phase; missed -> the phase again). The last Name sets flag enemy.<id>.free (gen_l3: Orren's runes wait for
//           it). Progress (phase) survives a respawn. Readable state (render + flags, no HUD): gold threads run from its chest to
//           each minion still feeding it (phase 1; a stunned one drops its thread) and to every point in `ties` (Orren's runes,
//           until it is free); a song begun at a tied rune tugs the threads bright. Flags enemy.<id>.p<n> (phase begun),
//           .window (first unbind window) and .tied (a tied rune sung at) let an NPC speak about it (gen_l3 talk `on`).
//   squall variant 'thief' (a small cyan wisp): no shove. It darts through the hero and takes one breath thread (TH), then drifts
//           home slow and low with the gold thread in its eye for TH.carry s; a staff hit / Gust / pogo while it carries gives the
//           thread back (and stuns it: Name-able). Left alone it swallows the thread and comes again.
//   squall variant 'pull' (a big violet funnel, mouth down, that never leaves its post): hero within aggro: it flattens and draws a
//           ring out to its reach (PL.tele s), then inhales PL.pull s: a drag toward it through registry 'wind' (PL.v m/s: a jog
//           loses, a run or a dash wins). Its core takes a breath thread and throws the hero on through. Counters: the Anchor song
//           while it inhales (songs.js pick: it is an Anchor target then) chokes it; a Gust on its wind-up or a staff hit stuns it.
//   warden {guard: <switch id>, ties: [[x, y, z]]}: a dark Warden standing at that rune, a gold thread from its chest to the stone
//           and a ring shield held out front. While it stands the rune takes no song (flag enemy.<id>.open, the switch's `after`).
//           It turns to face the hero (GD.turn rad/s); in front within GD.reach it winds up and shoves (short, its heading
//           locked: step aside or back). Staff hits on the shield only ring; hits land from behind or while it recovers from a
//           shove; a Gust from the side or back, or into its wind-up / rest, staggers it at once (head-on at its post the
//           ring turns it). U23: staggered, the Name unbinds it like any Warden; only then the thread snaps and the rune is free.
// Stone shards (warden, boss) are solid to the hero (pushed out of their footprint each tick, tools/probe_enemies.mjs); squalls
// are wind: passable, but walking into one buffets the hero aside ('enemy.knock', no hop).
// Every free shard: flag enemy.<id>.free, 'enemy.unbind' {t, id, kind, pos}, a whispered "...I remember" ('talk.line').
// Events: enemy.telegraph / knock / stun / stagger / hit / unbind / phase / ring {t, id, pos, ...}. Registry 'enemies' = the live
// list (songs.js pick(): unbindable; bot.js counters). Songs: 'song.cast' (songs.js) gust -> stun / push, name -> unbind.
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { motifOf } from './songs.js';
import { tales, getSave, addTo } from '../core/save.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { bake } from './marks.js';

const HOVER = 1.3, PUFF_S = 7, PUFF_LIFT = 34, KNOCK_TAU = 0.22, GUST_CONE = 40 * (Math.PI / 180);
const SQ = { aggro: 5.5, r: 6, near: 2.6, speed: 3, tele: 0.85, charge: 0.35, chargeV: 10, recover: 2, spent: 1, stun: 3, counter: 4.5, flinch: 0.4, flinchWin: 2.5, calm: 9, knock: 8, lift: 4, hit: 1.0, strikeR: 2.4 };
const WD = { speed: 1.5, aggro: 4.5, tele: 0.8, ram: 0.6, ramV: 8, recover: 1.2, stagger: 3, knock: 10, lift: 5, hit: 1.15, strikeR: 2.1, comboWin: 2.5, flinch: 0.35 };
// R8: the tale of Orren (tale shards, core/save.js) loosens his Warden: each part known keeps its Name window open longer (+0.4 s),
// four or more cut the shock rings to two, all five slow the ram (the knot remembers being a Keeper).
const BOSS = { get window() { return 12 + 0.8 * tales(); }, tele: 0.9, ram: 0.7, get ramV() { return tales() >= 5 ? 7.5 : 9; }, recover: 1.6, knock: 10, lift: 5, hit: 1.8, strikeR: 2.8, get rings() { return tales() >= 4 ? 2 : 3; }, ringEvery: 2.4, ringV: 6, ringW: 0.45, ringKnock: 7 };
const TH = { tele: 0.5, v: 13, charge: 0.55, speed: 4.5, carry: 6, carryV: 1.4 };
const PL = { aggro: 6.5, tele: 1.1, pull: 3, v: 5.5, core: 1.3, rest: 2.5, choke: 4, knock: 7, lift: 6 };
const GD = { turn: 1.6, reach: 2.6, tele: 0.55, ram: 0.22, recover: 2.8, knock: 6, lift: 3.5 };
const BODY = { warden: 0.75, guard: 0.9, boss: 1.3, hero: 0.35 }; // solid footprints (m)
const teleOf = (e) => (e.d.variant === 'thief' ? TH.tele : e.d.variant === 'pull' ? PL.tele : e.kind === 'squall' ? SQ.tele : e.kind === 'boss' ? BOSS.tele : e.d.guard ? GD.tele : WD.tele);
// a stun on its telegraph / charge is a counter: longer, 'enemy.counter' (fx: flash + hit-stop)
const stunSquall = (ctx, e, counter = false) => { setState(ctx, e, 'stun', 'stun'); e.unbindable = true; e.stunned = true; e.stunS = counter ? SQ.counter : SQ.stun; e.fl = []; if (counter) ctx.registry.set('enemy.counter', { t: ctx.game.t, id: e.id, kind: e.kind, pos: e.pos.toArray() }); };
// any other blow / Gust: knocked back (e.kv decays in squall()) and flinching SQ.flinch s; the third within SQ.flinchWin s stuns it
function flinchSquall(ctx, e, t, ux, uz, k) {
  e.kv = [ux * k, uz * k]; e.fl = (e.fl ?? []).filter((q) => t - q < SQ.flinchWin); e.fl.push(t);
  if (e.fl.length >= 3) stunSquall(ctx, e); else setState(ctx, e, 'flinch', 'flinch');
}
// before the Name is known a stunned squall can only be blown off the island: no reward, back at its post after the next respawn
function disperse(ctx, e, ux, uz) { e.unbindable = false; e.kv = [ux * 11, uz * 11]; setState(ctx, e, 'blown', 'disperse'); }
const SQ_OPEN = ['hover', 'near', 'tele', 'charge', 'recover', 'pull', 'flinch']; // a squall a blow stuns
const LINE = { en: '…I remember', ru: '…я помню' };
// The squall's body: a small whirlwind (unit size, scaled 2 at render), three wind ribbons spiralling up a funnel that widens
// from a tight foot, a few thin outer wisps, and leaves caught in the spin; vertex-coloured, so the instance tint greys it when dazed.
function vortexGeo() {
  const parts = [], col = (g, hex) => { const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  const helix = (ph, r0, r1, turns, y0, y1) => new THREE.CatmullRomCurve3(Array.from({ length: 25 }, (_, i) => { const u = i / 24, a = ph + u * turns * 6.283, r = r0 + (r1 - r0) * u * u; return new THREE.Vector3(Math.cos(a) * r, y0 + (y1 - y0) * u, Math.sin(a) * r); }));
  for (let k = 0; k < 3; k++) parts.push(col(new THREE.TubeGeometry(helix(k * 2.094, 0.04, 0.34, 2.1, -0.42, 0.4), 48, 0.035 - 0.006 * k, 5), k ? '#e8f0f2' : '#ffffff'));
  for (let k = 0; k < 2; k++) parts.push(col(new THREE.TubeGeometry(helix(1 + k * 3.1, 0.3, 0.46, 0.45, 0.05 + 0.2 * k, 0.32 + 0.1 * k), 16, 0.016, 4), '#f4f7f8'));
  const leaf = new THREE.IcosahedronGeometry(1, 0);
  ['#8fae4e', '#c9a24a', '#7c9440', '#b5793c', '#a3b85a'].forEach((h, i) => {
    const a = i * 1.26 + 0.4, y = -0.3 + i * 0.16, r = 0.12 + 0.06 * i;
    parts.push(col(leaf.clone().scale(0.06, 0.015, 0.04).rotateX(0.4 * i).rotateY(a).translate(Math.cos(a) * r, y, Math.sin(a) * r), h));
  });
  return mergeGeometries(parts.map((g) => { g.deleteAttribute('uv'); return g.index ? g.toNonIndexed() : g; }));
}

const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler(), _c = new THREE.Color(), _c2 = new THREE.Color();
const _v2 = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0), TIE_N = 6; // boss threads: segments per sagging thread
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
let E, knock, lineT, R, collide, flags, RT, D, WH;
// rigged clips per sim state (render only); once = play through and hold
const ONCE = new Set(['ram_telegraph', 'flinch', 'stagger', 'unbind', 'recover', 'slam', 'unbind_1', 'unbind_2', 'unbind_final']);
const CORD_OFF = { unbind_1: 0.65, unbind_2: 0.65, unbind_final: 0.36 }, LAND = { unbind: 0.85, unbind_final: 0.9 };

function knockHero(ctx, e, dx, dz, k, lift) {
  const p = ctx.registry.get('player'), n = Math.hypot(dx, dz) || 1;
  knock.set((dx / n) * k, 0, (dz / n) * k);
  p.vel.y = Math.max(p.vel.y, lift); p.grounded = false; p.groundBody = null;
  ctx.registry.set('enemy.knock', { t: ctx.game.t, id: e.id, kind: e.kind, pos: p.pos.toArray(), dir: [dx / n, dz / n] });
  ctx.registry.set('audio.cue', { name: 'enemy_knock' });
}
function setState(ctx, e, s, ev) {
  e.state = s; e.st = 0; e.shat = 0;
  if (ev) ctx.registry.set(`enemy.${ev}`, { t: ctx.game.t, id: e.id, kind: e.kind, pos: e.pos.toArray() });
}
function free(ctx, e) {
  const reg = ctx.registry, t = ctx.game.t;
  e.unbindable = false; setState(ctx, e, e.kind === 'squall' ? 'puff' : 'free');
  flags[`enemy.${e.id}.free`] = true; reg.set('flags', flags);
  reg.set('enemy.unbind', { t, id: e.id, kind: e.kind, pos: e.pos.toArray() });
  if (e.kind === 'warden') { e.step.position.set(e.pos.x, e.ground + 0.25, e.pos.z); e.step.visible = e.body.enabled = true; e.body.update(); }
  // U8 drops: two breath motes; the first time in this save also a thread dust (and a seed of song from a Warden). A shattered shard leaves nothing.
  const key = `${ctx.game.levelId}.${e.id}`, had = getSave().drops ?? [];
  ['breath', 'breath', ...(had.includes(key) ? [] : ['dust']), ...(e.kind !== 'warden' || had.includes(`${key}.seed`) ? [] : ['seed'])].forEach((kind, i) => {
    const a = i * 2.4 + e.id.length;
    D.push({ kind, key: kind === 'seed' ? `${key}.seed` : key, pos: new THREE.Vector3(e.pos.x + Math.cos(a) * 0.8, e.ground + 1.1, e.pos.z + Math.sin(a) * 0.8), t0: t });
  });
  if (!reg.get('talk.line') || reg.get('talk.line').npc === 'shard') { reg.set('talk.line', { npc: 'shard', who: null, voice: 'whisper', text: LINE, dur: 1.8 }); lineT = t + 1.8; }
}
const groundY = (x, z, y) => collide.groundAt(x, z, y + 2)?.y ?? null;

// Stone is solid: player.js passes the point it is about to move to, and it is pushed out of every Warden / guard / boss footprint
// (before its own sweep, so the push can not put him through a wall).
export function solidOut(to) {
  for (const e of E ?? []) {
    if (e.kind === 'squall' || e.state === 'free' || e.state === 'gone') continue;
    const rr = (e.kind === 'boss' ? BODY.boss : e.d.guard ? BODY.guard : BODY.warden) + BODY.hero, ox = to.x - e.pos.x, oz = to.z - e.pos.z, od = Math.hypot(ox, oz);
    if (od < rr && to.y > e.ground - 0.5 && to.y < e.ground + (e.kind === 'boss' ? 3.2 : 1.9)) { to.x = e.pos.x + (od > 1e-3 ? ox / od : 0) * rr; to.z = e.pos.z + (od > 1e-3 ? oz / od : 1) * rr; }
  }
}
export default {
  name: 'enemies', order: 12, deps: ['level', 'player'], // after level (wind reset), before player (reads wind)
  async init(ctx) {
    const reg = ctx.registry, level = reg.get('level');
    E = []; D = []; knock = new THREE.Vector3(); lineT = null; R = null; collide = level?.collide;
    const list = level?.data.enemies ?? [];
    reg.set('enemies', E);
    if (!list.length) return;
    for (const d of list) {
      const home = new THREE.Vector3(...d.pos), e = { id: d.id, kind: d.kind, d, home, pos: home.clone(), prev: home.clone(), state: 'idle', st: 0, unbindable: false, ground: d.pos[1], dir: [0, 1], cd: 0, hits: [], motif: motifOf(d.id, d) };
      if (d.kind === 'squall') { e.pos.y += d.sleep ? 0.45 : HOVER; e.prev.copy(e.pos); e.state = d.boss || d.sleep ? 'off' : 'hover'; }
      if (d.kind === 'warden') { e.leg = 1; e.pos.set(d.path[0][0], d.pos[1], d.path[0][1]); e.prev.copy(e.pos); e.state = 'patrol'; }
      if (d.kind === 'boss') { e.phase = 0; e.rings = []; e.state = 'idle'; }
      E.push(e);
    }
    // render: squall cores (baked instances), rigged wardens / boss (SkeletonUtils clones + clips), gold cords (the Name marks, only
    // while unbindable: one per motif note, thick = long), boss shock rings
    const n = (k) => E.filter((e) => k.includes(e.kind)).length;
    const mk = (geo, mat, count, ink = true) => { const im = new THREE.InstancedMesh(geo, mat, Math.max(1, count)); im.count = 0; im.frustumCulled = false; if (!ink) im.layers.set(1); ctx.add(im); return im; };
    const [wG, bG, sG] = await Promise.all([['warden', 'characters/stone_warden/stone_warden'], ['boss', 'characters/knot_warden/knot_warden'], ['squall', 'characters/squall/squall_core']]
      .map(([k, f]) => (n([k]) ? ctx.assets.gltf(`assets/${f}.glb`) : null)));
    const core = (name, ink) => { const m = sG.scene.getObjectByName(name); return mk(bake(m), m.material, n(['squall', 'boss']), ink); };
    R = {
      sq: sG && mk(vortexGeo(), sG.scene.getObjectByName('squall').material, n(['squall']) + (level.data.mechanisms ?? []).filter((m) => m.kind === 'switch').length), eye: sG && core('squall_eye', false), // + 1 eye per boss: its open core
      cord: mk(new THREE.TorusGeometry(1, 0.05, 5, 28), new THREE.MeshBasicMaterial({ color: '#ffffff' }), E.length * 9, false), // cords + drop motes (<= 4 an enemy)
      tie: mk(new THREE.CylinderGeometry(0.03, 0.03, 1, 5).translate(0, 0.5, 0), new THREE.MeshBasicMaterial({ color: '#ffffff' }), E.reduce((a, e) => a + (e.d.ties?.length ?? 0) + (e.d.minions?.length ?? 0), 0) * TIE_N, false),
      ring: mk(new THREE.TorusGeometry(1, 0.07, 4, 64), new THREE.MeshBasicMaterial({ color: '#fff0c8', transparent: true, opacity: 0.85, depthWrite: false }), BOSS.rings, false),
    };
    RT = null;
    for (const e of E) if (e.kind !== 'squall') { // stone parts carry the ink line; eyes / rune / socket / cords are small: colour pass only
      const g = e.kind === 'boss' ? bG : wG, root = cloneSkinned(g.scene), mixer = new THREE.AnimationMixer(root), acts = {};
      for (const c of g.animations) { const a = acts[c.name] = mixer.clipAction(c); if (ONCE.has(c.name)) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; } }
      let eyes = null;
      root.traverse((o) => { if (!o.isMesh) return; if (o.material.name !== 'stone') o.layers.set(1); if (o.material.name === 'eyes') { o.material = o.material.clone(); eyes = o.material; } });
      if (e.d.guard) { root.scale.setScalar(1.2); root.traverse((o) => { if (o.isMesh && o.material.name === 'stone') { o.material = o.material.clone(); o.material.color.multiplyScalar(0.55); } }); } // the guard: bigger, dark basalt
      e.rig = { root, mixer, acts, cur: null, eyes, glow: eyes?.emissiveIntensity ?? 1, cords: [1, 2, 3].map((k) => root.getObjectByName(`cord_${k}`)).filter(Boolean) };
      ctx.add(root);
    }
    for (const e of E) if (e.kind === 'warden') { // its rune step once free: collider only (the unbind clip ends as the rubble step)
      e.step = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.5, 1.4)); e.step.visible = false; e.step.name = `step_${e.id}`; e.step.layers.disableAll();
      e.step.position.set(e.pos.x, e.ground - 3, e.pos.z); e.step.updateMatrixWorld(true); ctx.add(e.step);
      e.body = collide.addBody(e.step); e.body.enabled = false;
    }
    flags = reg.get('flags');
    reg.on('player.singStart', ({ t, pos }) => { // a song at a rune the Warden still holds: its threads pull taut and flash (the rune's own answer is the thread)
      for (const e of E) if (!['free', 'gone'].includes(e.state) && e.d.ties?.some((q) => Math.hypot(q[0] - pos[0], q[2] - pos[2]) < 3)) {
        e.tugT = t; flags[`enemy.${e.id}.tied`] = true; reg.set('flags', flags); reg.set('audio.cue', { name: 'enemy_tele', kind: 'boss' });
      }
    });
    WH = { flare: {}, unl: {} }; // U12 wind knots on bound runes (render): last flare t, unwinding from t
    reg.on('rune.unlock', ({ t, id, from }) => { WH.unl[id] = t + (from ? 0.7 : 0); }); // fx.js: the gold thread arrives first
    reg.on('song.reject', ({ t, id, pos }) => { WH.flare[id] = t; const p = reg.get('player'), dx = p.pos.x - pos[0], dz = p.pos.z - pos[2], n = Math.hypot(dx, dz) || 1; if (n < 6) knock.set((dx / n) * 4, 0, (dz / n) * 4); }); // U12: a bound rune's whirl shoves the singer back
    for (const e of E) if (flags[`enemy.${e.id}.free`] || flags[`broken.${e.id}`]) e.state = 'gone'; // freed, or shattered (R4: until a level restart)
    reg.on('player.pogo', (ev) => { // R5 pogo: a shard under the feet is struck from above (squall stunned, warden hit); either way a bounce
      for (const e of E) {
        if (['gone', 'off', 'puff', 'free', 'blown', 'away'].includes(e.state) || flat(_v.fromArray(ev.pos), e.pos) > 1.3) continue;
        const dy = ev.pos[1] - e.pos.y; if (dy < 0 || dy > (e.kind === 'squall' ? 1.6 : 2.6)) continue;
        if (e.kind === 'squall' && SQ_OPEN.includes(e.state)) stunSquall(ctx, e);
        else if (e.kind === 'warden' && ['patrol', 'tele', 'recover', 'flinch'].includes(e.state)) reg.set('enemy.hit', { t: ev.t, id: e.id, kind: e.kind, pos: e.pos.toArray(), n: 1 });
        ev.hit = 'enemy'; return;
      }
    });
    reg.on('player.strikeHit', ({ t, pos, combo }) => {
      const p = reg.get('player'), h = p.heading;
      for (const e of E) {
        if (e.unbindable && e.kind !== 'boss' && (e.state === 'stun' || e.state === 'stagger') && flat(_v.set(pos[0], 0, pos[2]), e.pos) < 2.2 && Math.abs(e.pos.y - pos[1]) < 2.5) { // R4: striking a stunned shard cracks it; the third blow shatters it (no updraft / step)
          e.shat = (e.shat ?? 0) + 1; e.st = Math.min(e.st, 0.3); // a blow holds it down
          reg.set('enemy.crack', { t, id: e.id, kind: e.kind, pos: e.pos.toArray(), n: e.shat });
          if (e.shat >= 3) { if (e.kind === 'squall' && !flags['gift.name']) disperse(ctx, e, Math.sin(h), Math.cos(h)); else shatter(ctx, e); }
          continue;
        }
        const r = e.kind === 'squall' ? SQ.strikeR : e.kind === 'boss' ? BOSS.strikeR : WD.strikeR, dx = e.pos.x - pos[0], dz = e.pos.z - pos[2], d = Math.hypot(dx, dz);
        const off = Math.atan2(dx, dz) - h;
        if (d > r || Math.abs(e.pos.y - pos[1] - (e.kind === 'squall' ? HOVER : 0.5)) > 1.8 || (d > 0.6 && Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > Math.PI / 3)) continue;
        if (e.kind === 'squall' && SQ_OPEN.includes(e.state)) { // U9: on its wind-up / charge a counter; spent, carrying or a maw: stunned; else knocked back, flinching
          const tele = e.state === 'tele' || e.state === 'charge';
          if (tele || e.d.variant === 'pull' || e.loot || (e.state === 'recover' && e.st < SQ.spent && e.cd < 9)) stunSquall(ctx, e, tele);
          else flinchSquall(ctx, e, t, dx / (d || 1), dz / (d || 1), 7);
          continue;
        }
        if (e.d.guard && ['patrol', 'tele'].includes(e.state) && -dx * e.dir[0] - dz * e.dir[1] > 0.3 * d) { // on its shield: the blow only rings
          e.blockT = t; reg.set('enemy.block', { t, id: e.id, kind: e.kind, pos: e.pos.toArray() }); reg.set('audio.cue', { name: 'enemy_block' }); continue;
        }
        const hurtable = e.kind === 'warden' ? ['patrol', 'tele', 'recover', 'flinch'].includes(e.state) : e.phase === 2 && ['chase', 'tele', 'recover', 'flinch'].includes(e.state);
        if (!hurtable) { if (!['free', 'gone', 'stagger', 'window'].includes(e.state)) { e.shrugT = t; reg.set('enemy.shrug', { t, id: e.id, kind: e.kind, pos: e.pos.toArray() }); } continue; } // the blow lands on bound stone: it only shudders
        e.hitT = t;
        e.hits = e.hits.filter((ht) => t - ht < WD.comboWin); e.hits.push(t);
        reg.set('enemy.hit', { t, id: e.id, kind: e.kind, pos: e.pos.toArray(), n: e.hits.length });
        if (e.hits.length >= 3 || combo === 3) { e.hits = []; if (e.kind === 'warden') { setState(ctx, e, 'stagger', 'stagger'); e.unbindable = true; } else window_(ctx, e); }
        else if (e.state === 'tele') { setState(ctx, e, 'flinch'); reg.set('enemy.counter', { t, id: e.id, kind: e.kind, pos: e.pos.toArray() }); } // caught on its wind-up: the ram breaks off (flash, hit-stop)
      }
    });
    reg.on('song.cast', (c) => {
      const t = c.t;
      if (c.song === 'gust') {
        for (const e of E) {
          const dx = e.pos.x - c.pos[0], dz = e.pos.z - c.pos[2], d = Math.hypot(dx, dz), off = Math.atan2(dx, dz) - c.heading;
          if (d > c.reach + 0.5 || Math.abs(e.ground - c.pos[1]) > 3 || (d > 0.5 && Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > GUST_CONE)) continue;
          const ux = Math.sin(c.heading), uz = Math.cos(c.heading), kb = [5, 7, 10, 14][c.stage], sq = e.kind === 'squall', maw_ = e.d.variant === 'pull';
          if (sq && e.state === 'stun') { if (flags['gift.name']) e.kv = [ux * kb * 0.5, uz * kb * 0.5]; else disperse(ctx, e, ux, uz); } // U9: no Name yet: blown off the island
          else if (sq && (e.state === 'tele' || (!maw_ && e.state === 'charge'))) stunSquall(ctx, e, true);
          else if (sq && !maw_ && ['hover', 'near', 'recover', 'flinch'].includes(e.state)) flinchSquall(ctx, e, t, ux, uz, kb); // blown back, harder with the stage
          else if (e.d.guard && ['patrol', 'tele', 'recover', 'flinch'].includes(e.state)) { // U23: the ring shield turns a Gust met head-on; from the side or back, or into its wind-up / rest, it reels
            if (e.state === 'patrol' && -ux * e.dir[0] - uz * e.dir[1] > 0.3) { e.blockT = t; reg.set('enemy.block', { t, id: e.id, kind: e.kind, pos: e.pos.toArray() }); reg.set('audio.cue', { name: 'enemy_block' }); continue; }
            setState(ctx, e, 'stagger', 'stagger'); e.unbindable = true; e.hits = [];
          }
          else if (e.kind === 'warden' && ['patrol', 'tele', 'recover', 'flinch'].includes(e.state)) { // driven along the push: a wall or the rim staggers it
            const sx = Math.sin(c.heading), sz = Math.cos(c.heading), push = c.reach * 0.6;
            let moved = 0, hitWall = false;
            for (; moved < push; moved += 0.25) {
              const nx = e.pos.x + sx * 0.25, nz = e.pos.z + sz * 0.25, g = groundY(nx, nz, e.ground), wall = collide.raycast(_v.set(e.pos.x, e.ground + 0.6, e.pos.z), _s.set(sx, 0, sz), 0.9);
              if (g === null || g > e.ground + 0.4 || g < e.ground - 0.4 || (wall && wall.body !== e.body)) { hitWall = true; break; }
              e.pos.x = nx; e.pos.z = nz;
            }
            if (hitWall) { setState(ctx, e, 'stagger', 'stagger'); e.unbindable = true; e.hits = []; }
          } else continue;
          c.hit ??= e.id; c.at ??= e.pos.toArray();
        }
      } else if (c.song === 'anchor' && c.target?.kind === 'enemy') { // the hero roots himself against the inhale: the pull squall chokes on it
        const e = c.target.o;
        if (e.state === 'pull') { c.hit = e.id; c.at = e.pos.toArray(); stunSquall(ctx, e); }
      } else if (c.song === 'name') {
        const held = (o) => o.d.behind && !flags[`enemy.${o.d.behind}.free`] && !flags[`broken.${o.d.behind}`]; // `behind`: no Name takes it while that other shard still stands (l3: the thief's updraft is no way round the maw)
        for (const o of c.targets) if (o.unbindable && o.kind !== 'boss' && !held(o)) { c.hit ??= o.id; c.at ??= o.pos.toArray(); free(ctx, o); } // stage 3: every stunned shard in reach
        const e = c.target?.kind === 'enemy' ? c.target.o : null;
        if (!e?.unbindable || held(e)) return;
        c.hit = e.id; c.at = e.pos.toArray();
        const pl = reg.get('player');
        if (e.kind === 'squall' && !pl.grounded) { e.pos.set(pl.pos.x, pl.pos.y - 1, pl.pos.z); e.ground = pl.pos.y - 1.5; } // R5 Name in the air: the updraft opens under the hero
        if (e.kind !== 'boss') return free(ctx, e);
        e.unbindable = false; e.unbN = e.phase; e.unbT = t; // render: unbind_<n> clip
        reg.set('enemy.phase', { t, id: e.id, kind: e.kind, pos: e.pos.toArray(), phase: e.phase, freed: true });
        if (e.phase >= 3) return free(ctx, e);
        e.phase++; startPhase(ctx, e);
      }
    });
    // R4 wrong note: a squall with `sleep: <seq>` lies coiled on that sequence's rune (small, grey, slow: the tell); a rune of the
    // sequence sung out of order wakes it, the sequence completed lets it unwind and go
    reg.on('sing.done', ({ t, id, ok, wrong }) => {
      const sws = level.targets.switches, seq = sws.find((w) => w.m.id === id)?.m.seq, fl = reg.get('flags') ?? {};
      if (!seq) return;
      for (const e of E) {
        if (e.kind !== 'squall' || e.d.sleep !== seq || e.state !== 'off') continue;
        if (wrong) { e.woke = true; e.pos.copy(e.home); e.pos.y += HOVER; e.prev.copy(e.pos); setState(ctx, e, 'hover'); reg.set('trial.creak', { t, pos: e.home.toArray(), n: 10 }); reg.set('audio.cue', { name: 'rattle', gain: 0.8 }); }
        else if (ok && sws.filter((w) => w.m.seq === seq).every((w) => fl[`switch.${w.m.id}`])) { setState(ctx, e, 'gone'); reg.set('trial.creak', { t, pos: e.home.toArray(), n: 8 }); }
      }
    });
    // U9: a song that takes nothing still gets an answer from the nearest shard in earshot: it tightens (render) + 'enemy.shrug' (a dull note)
    reg.on('song.done', ({ t, id }) => {
      if (id) return;
      const p = reg.get('player'), e = E.filter((q) => !['gone', 'off', 'puff', 'free', 'blown', 'away'].includes(q.state) && flat(p.pos, q.pos) < (q.kind === 'boss' ? 14 : 7) && Math.abs(p.pos.y - q.ground) < 4).sort((a, b) => flat(p.pos, a.pos) - flat(p.pos, b.pos))[0];
      if (e) { e.shrugT = t; reg.set('enemy.shrug', { t, id: e.id, kind: e.kind, pos: e.pos.toArray() }); }
    });
    reg.on('player.respawn', () => {
      knock.set(0, 0, 0);
      for (const e of E) {
        if (e.kind === 'squall' && !['puff', 'gone', 'off'].includes(e.state)) { e.pos.copy(e.home); e.pos.y += HOVER; e.prev.copy(e.pos); setState(ctx, e, 'hover'); e.unbindable = false; e.loot = 0; e.kv = null; e.fl = []; }
        if (e.kind === 'warden' && e.state !== 'free' && e.state !== 'gone') { e.pos.set(e.d.path[0][0], e.ground, e.d.path[0][1]); e.prev.copy(e.pos); e.leg = 1; setState(ctx, e, 'patrol'); e.unbindable = false; }
        if (e.kind === 'boss' && e.phase > 0 && e.state !== 'free') { e.pos.copy(e.home); e.prev.copy(e.pos); e.rings = []; startPhase(ctx, e); } // progress kept: the phase starts over
      }
    });
  },
  update(ctx, dt) {
    if (!E.length) return;
    const reg = ctx.registry, t = ctx.game.t + dt, p = reg.get('player'), wind = reg.get('wind');
    flags = reg.get('flags');
    if (lineT !== null && t >= lineT) { lineT = null; if (reg.get('talk.line')?.npc === 'shard') reg.set('talk.line', null); }
    if (!p) return;
    const hero = _v.set(p.pos.x, p.pos.y + 0.9, p.pos.z);
    for (const e of E) {
      e.prev.copy(e.pos); e.st += dt;
      if (e.d.demo && !e.demoed && flags[e.d.demo.flag] && SQ_OPEN.includes(e.state) && hero.distanceTo(e.pos) < (e.d.demo.r ?? 6)) { // U9: shown once: the song's glyph hangs over it (fx.js) and it hangs open for the hero's own song
        e.demoed = true; stunSquall(ctx, e, true); reg.set('enemy.demo', { t, id: e.id, song: e.d.demo.song, pos: e.pos.toArray(), to: p.pos.toArray() });
      }
      if (e.kind === 'squall') squall(ctx, e, dt, t, p, hero, wind);
      else if (e.kind === 'warden') warden(ctx, e, dt, t, p, hero);
      else boss(ctx, e, dt, t, p, hero);
      if (e.d.guard) { const k = `enemy.${e.id}.open`, open = ['free', 'gone'].includes(e.state); /* U23: one rule for every Warden: stagger it, Name it; only then its thread snaps and the rune is free */ if (!!flags[k] !== open) { flags[k] = open; reg.set('flags', flags); } }
    }
    if (wind && knock.lengthSq() > 1e-4) { wind.x += knock.x; wind.z += knock.z; knock.multiplyScalar(Math.exp(-dt / KNOCK_TAU)); }
    for (let i = D.length - 1; i >= 0; i--) { // drop motes: hang where the shard came apart, fly to the hero inside 1.5 m
      const o = D[i]; hero.set(p.pos.x, p.pos.y + 0.9, p.pos.z);
      const d = hero.distanceTo(o.pos);
      if (t - o.t0 < 0.6 || d > 1.5) continue;
      o.pos.lerp(hero, Math.min(1, dt * 10));
      if (d > 0.5) continue;
      D.splice(i, 1);
      if (o.kind === 'breath') { if (p.breath < p.breathMax) { p.breath = Math.min(p.breathMax, p.breath + 1); reg.set('player.breath', { t, b: +p.breath.toFixed(2), max: p.breathMax, why: 'drop' }); } }
      else addTo('drops', o.key); // once per save
      reg.set('drop.pick', { t, kind: o.kind, pos: o.pos.toArray() }); // meta.js: dust / seed into the purse; audio / fx
    }
  },
  beforeRender(ctx, alpha) {
    if (!R) return;
    const now = ctx.game.t - (1 - alpha) / 60, cnt = { sq: 0, eye: 0, cord: 0, ring: 0, tie: 0 }, rdt = RT === null ? 0 : Math.min(0.1, Math.max(0, now - RT)); RT = now;
    const put = (k, pos, q, s, col) => { const im = R[k], i = cnt[k]++; im.setMatrixAt(i, _m.compose(pos, q, s)); im.setColorAt(i, col); };
    for (const e of E) {
      if (e.rig) e.rig.root.visible = e.state !== 'gone';
      if (e.state === 'off' && e.kind === 'squall' && e.d.sleep) { // asleep on its rune: a grey knot coiled round the stone itself (wider than it), slowly turning, breathing
        const s = 1.6 + 0.08 * Math.sin(now * 1.1 + e.id.length);
        _q.setFromEuler(_e.set(0.08, now * 0.5, 0.05));
        put('sq', _v.copy(e.pos).setY(e.pos.y + 0.15), _q, _s.set(s, 1, s), _c.set('#8f9aa6'));
        continue;
      }
      if (e.state === 'gone' || e.state === 'away' || e.state === 'off' && e.kind === 'squall') continue;
      const at = _v.lerpVectors(e.prev, e.pos, alpha).clone(), ph = e.id.length * 1.7;
      const tele = e.state === 'tele' ? Math.min(1, e.st / teleOf(e)) : 0, dazed = e.unbindable, vr = e.d.variant;
      const jolt = Math.max(0, 1 - (now - Math.max(e.shrugT ?? -9, e.hitT ?? -9)) / 0.35); // a blow / a song that took nothing: it tightens for a moment
      // loose: 0 bound .. 1 the knot fully open (stunned / staggered / the boss's window); it opens fast and pulls shut again over its last moments
      const left = e.state === 'stun' ? (vr === 'pull' ? PL.choke : e.stunS ?? SQ.stun) - e.st : e.state === 'stagger' ? WD.stagger - e.st : e.state === 'window' ? (BOSS.window - e.st) / 3 : 0, loose = dazed ? Math.min(1, e.st / 0.25, Math.max(0, left / 0.9)) : 0;
      if (e.kind === 'squall') { // knotted wind: spins (faster winding up, whips on the charge), droops grey when dazed, shrinks away when unbound (fx unravel)
        const u = e.state === 'puff' ? Math.min(1, e.st / 0.5) : 0;
        if (u >= 1) continue;
        const spent = e.state === 'recover' && e.st < SQ.spent && e.cd < 9, spin = dazed || spent ? now * 0.6 : now * (e.state === 'charge' ? 12 : 1.6 + 6 * tele), fl = e.state === 'flinch' ? 1 - Math.min(1, e.st / SQ.flinch) : 0, s = 2 * (1 + 0.25 * tele + 0.05 * Math.sin(now * 9 + ph)) * (1 - u) * (1 - 0.3 * jolt) * (e.state === 'blown' ? Math.max(0, 1 - e.st / 0.7) : 1), wide = 1 + 0.5 * loose + 0.35 * fl, low = 1 - 0.4 * loose - 0.3 * fl, core = _c.set('#ffcf6a').multiplyScalar(0.75 + 0.45 * Math.sin(now * 7)).clone(), coreS = 1 + loose * (0.9 + 0.35 * Math.sin(now * 7)); // stunned: unspooled wide and low, its gold core open and pulsing
        if (dazed) at.y -= 0.15 + 0.08 * Math.sin(now * 2);
        _q.setFromEuler(_e.set(dazed ? 0.5 : 0.25 * Math.sin(now * 2 + ph), spin, dazed ? 0.3 : 0));
        if (tele && vr !== 'pull') { // the wind-up: it rears back and up away from the hero, leaning like a drawn sling, then whips through
          const L = Math.hypot(e.dir[0], e.dir[1]) || 1, k = tele * tele;
          at.x -= (e.dir[0] / L) * 0.9 * k; at.z -= (e.dir[1] / L) * 0.9 * k; at.y += 0.45 * k;
          _q.premultiply(_q2.setFromAxisAngle(_s.set(-e.dir[1] / L, 0, e.dir[0] / L), 0.6 * k));
        }
        if (vr === 'thief') { // a small quick wisp, cyan; the stolen thread glows gold in its eye, and flies back as a gold ring when struck
          const k = s * 0.5 * wide, gold = e.loot ? 1 : 0;
          if (!dazed) { at.x += 0.2 * Math.sin(now * 7 + ph); at.y += 0.12 * Math.sin(now * 11 + ph); }
          _q.setFromEuler(_e.set(0.5 * Math.sin(now * 5 + ph), spin * 2.2, 0));
          put('sq', at, _q, _s.set(k, k * 1.3, k), _c.set(dazed ? '#8fa6b0' : '#6fe6ff'));
          put('eye', at, _q, _s.setScalar(k * (1.2 + 1.3 * gold + 0.6 * tele) * coreS), dazed ? _c.copy(core) : _c.set(gold ? '#ffcf6a' : '#d8fbff').lerp(_c.clone().set('#ffffff'), tele));
          const back = (now - (e.backT ?? -9)) / 0.45, hp = ctx.registry.get('player')?.pos;
          if (back < 1 && hp) put('cord', _v2.set(hp.x, hp.y + 1.1, hp.z).lerp(at, 1 - back).clone(), _q2.setFromEuler(_e.set(now * 9, now * 7, 0)), _s.setScalar(0.22), _c.set('#ffcf6a'));
        } else if (vr === 'pull') { // a big violet funnel, mouth down; flattens and draws its reach on the ground, then rings run in to it while it inhales
          const on = e.state === 'pull', k = s * 1.35, reach = e.d.aggro ?? PL.aggro, gy = e.ground + 0.12;
          _q.setFromEuler(_e.set(Math.PI + (dazed ? 0.5 : 0), dazed ? now * 0.6 : -now * (on ? 11 : 1.2 + 5 * tele), 0));
          put('sq', at, _q, _s.set(k * (1 + 0.45 * tele + (on ? 0.25 : 0)), k * (1 - 0.3 * tele), k * (1 + 0.45 * tele + (on ? 0.25 : 0))), _c.set(dazed ? '#8d8aa0' : '#9a78e8'));
          put('eye', at, _q, _s.setScalar(k * coreS), dazed ? _c.copy(core) : _c.set('#3a1f6a').lerp(_c.clone().set('#e9d8ff'), tele));
          _q2.setFromEuler(_e.set(Math.PI / 2, 0, 0));
          if (tele) put('cord', _v2.set(e.pos.x, gy, e.pos.z).clone(), _q2, _s.set(reach * tele, reach * tele, 1.5), _c.set('#cbb4ff'));
          if (on) for (let i = 0; i < 3; i++) { const u = (now * 0.7 + i / 3) % 1, r = reach * (1 - u) + 0.4; put('cord', _v2.set(e.pos.x, gy, e.pos.z).clone(), _q2, _s.set(r, r, 1.5), _c.set('#cbb4ff').multiplyScalar(0.35 + 0.65 * u)); }
        } else {
          put('sq', at, _q, _s.set(s * wide, s * low, s * wide), _c.set(dazed ? '#9aa8b4' : '#ffffff'));
          put('eye', at, _q, _s.setScalar(s * coreS), dazed ? _c.copy(core) : _c.set('#ffffff').lerp(_c.clone().set('#fff2c0'), tele));
        }
        if (dazed) cords(e, at, 0.55, now, put, loose);
        continue;
      }
      const r = e.rig, boss = e.kind === 'boss';
      let clip, time = null;
      if (!boss) clip = { patrol: 'patrol_walk', tele: 'ram_telegraph', ram: 'ram', recover: 'idle', flinch: 'flinch', stagger: e.st < 1 ? 'stagger' : 'dazed', free: 'unbind' }[e.state] ?? 'idle';
      else if (e.unbN && (e.state === 'free' || now - e.unbT < r.acts[e.unbN === 3 ? 'unbind_final' : `unbind_${e.unbN}`].getClip().duration)) { clip = e.unbN === 3 ? 'unbind_final' : `unbind_${e.unbN}`; time = now - e.unbT; }
      else if (e.state === 'rings') { // the slam's impact lands the first ring (st 1.2), then each ring_cast 'ring' beat (0.5) one more
        const st = e.st + (now - ctx.game.t);
        if (st < 0.42) clip = 'idle';
        else if (st < 1.92) { clip = 'slam'; time = st - 0.42; }
        else { clip = 'ring_cast'; time = ((((st - 1.2) / BOSS.ringEvery) % 1) + 0.5) % 1 * r.acts.ring_cast.getClip().duration; }
      } else clip = { tele: 'ram_telegraph', ram: 'ram', recover: 'recover', flinch: 'recover', window: e.st < 1 ? 'stagger' : 'dazed', free: 'unbind_final' }[e.state] ?? 'idle';
      const a = r.acts[clip];
      if (r.cur !== clip) { if (r.cur) r.acts[r.cur].fadeOut(0.15); a.reset().fadeIn(0.15).play(); r.cur = clip; e.landed = false; }
      a.timeScale = clip === 'patrol_walk' ? WD.speed * a.getClip().duration / 1.0 : 1; // stride 1.0 m per loop
      if (time !== null) a.time = Math.min(time, a.getClip().duration);
      r.mixer.update(rdt);
      const k = a.time / a.getClip().duration;
      if (LAND[clip] && k >= LAND[clip] && !e.landed) { e.landed = true; ctx.registry.set('mech.dock', { t: ctx.game.t, pos: [at.x, e.ground + 0.1, at.z] }); }
      if (boss) { // cord_n drops at unbind_n 'cord_off'
        const freed = e.state === 'free' ? 3 : Math.max(0, e.phase - 1);
        r.cords.forEach((c, i) => { c.visible = i + 1 > freed || (i + 1 === freed && clip in CORD_OFF && k < CORD_OFF[clip]); });
      }
      r.root.position.set(at.x - e.dir[0] * 0.18 * jolt, e.ground + (clip.startsWith('unbind_') ? 0.07 : 0), at.z - e.dir[1] * 0.18 * jolt);
      r.root.rotation.y = Math.atan2(e.dir[0], e.dir[1]);
      if (r.eyes) r.eyes.emissiveIntensity = r.glow * (dazed ? 0.35 : 1 + 2 * tele + 4 * jolt);
      if (e.state === 'free') continue;
      if (e.d.guard && ['patrol', 'tele'].includes(e.state)) { // its ring shield, held out front (white for a moment when a blow rings on it)
        const L = Math.hypot(e.dir[0], e.dir[1]) || 1, fl = now - (e.blockT ?? -9) < 0.2;
        put('cord', _v2.set(at.x + (e.dir[0] / L) * 0.95, e.ground + 1.15, at.z + (e.dir[1] / L) * 0.95).clone(), _q.setFromUnitVectors(_s.set(0, 0, 1), _v2.set(e.dir[0] / L, 0, e.dir[1] / L)), _s.set(0.7, 0.7, 2.4).clone(), fl ? _c.set('#ffffff') : _c.setRGB(1, 0.78, 0.3).multiplyScalar(0.8 + 0.5 * tele));
        cords(e, _s.set(at.x - (e.dir[0] / L) * 0.8, e.ground + 1.25, at.z - (e.dir[1] / L) * 0.8).clone(), 0.34, now, put, 0); // U23: the knot it is bound by sits bare on its back, where the ring cannot cover it
      }
      if (e.d.ties) { // gold threads: chest -> each rune it holds shut, and (phase 1) -> each wind still feeding it; sagging, pulsing toward the chest
        const tug = Math.max(0, 1 - (now - (e.tugT ?? -9)) / 0.9), ends = (e.d.ties ?? []).map((q) => _v2.fromArray(q).clone());
        if (e.state === 'waves') for (const m of E) if (e.d.minions?.includes(m.id) && !m.stunned && m.state !== 'off') ends.push(_v2.lerpVectors(m.prev, m.pos, alpha).clone());
        const a0 = _s.set(at.x, e.ground + (boss ? 2.5 : 1.4), at.z).clone();
        for (const b of ends) for (let i = 0; i < TIE_N; i++) {
          const pt = (u) => _v2.lerpVectors(a0, b, u).setY(Math.max(e.ground + 0.1, a0.y + (b.y - a0.y) * u - 1.7 * (1 - tug) * 4 * u * (1 - u))).clone(), p0 = pt(i / TIE_N), p1 = pt((i + 1) / TIE_N), len = p0.distanceTo(p1);
          const g = 0.4 + 0.6 * tug + 0.2 * Math.sin(now * 5 + i * 1.1);
          put('tie', p0, _q.setFromUnitVectors(UP, p1.sub(p0).divideScalar(len)), _s.set(1 + 2 * tug, len, 1 + 2 * tug), _c.setRGB(g + 0.1, 0.78 * g + 0.05, 0.3 * g));
        }
      }
      if (dazed) cords(e, _s.set(at.x, e.ground + (boss ? 2 : 0.95), at.z).clone(), boss ? 1.3 : 0.62, now, put, loose);
      const hp = ctx.registry.get('player')?.pos;
      if (boss && dazed && R.eye && hp) { // U10 the window: its chest knot hangs open, the gold core bared on the hero's side, beating (brighter when a song reaches it)
        const L = Math.hypot(hp.x - at.x, hp.z - at.z) || 1, b = 0.5 + 0.5 * Math.sin(now * 5);
        put('eye', _v2.set(at.x + ((hp.x - at.x) / L) * 1.25, e.ground + 2, at.z + ((hp.z - at.z) / L) * 1.25).clone(), _q.identity(), _s.setScalar((3 + 1.2 * b + 2 * jolt) * loose).clone(), _c.set('#ffcf6a').multiplyScalar(0.8 + 0.5 * b + jolt));
      }
      for (const rg of e.rings ?? []) put('ring', new THREE.Vector3(e.home.x, e.ground + 0.25, e.home.z), _q.setFromEuler(_e.set(Math.PI / 2, 0, 0)), new THREE.Vector3(rg.r, rg.r, 3), _c.set('#fff0c8'));
    }
    for (const o of D) { // drop motes: small turning rings (all gold, U8: breath pale gold, thread dust deep gold, a seed of song larger and doubled)
      const k = o.kind === 'breath' ? 0.13 : o.kind === 'dust' ? 0.17 : 0.26, y = 0.12 * Math.sin(now * 3 + o.pos.x), col = o.kind === 'breath' ? '#ffe9b0' : '#ffcf6a';
      put('cord', _v2.set(o.pos.x, o.pos.y + y, o.pos.z).clone(), _q.setFromEuler(_e.set(now * 2.3, now * 3.1, 0)), _s.set(k, k, 3).clone(), _c.set(col));
      if (o.kind === 'seed') put('cord', _v2.set(o.pos.x, o.pos.y + y, o.pos.z).clone(), _q.setFromEuler(_e.set(now * 3.1, 0, now * 2.3)), _s.set(k * 0.6, k * 0.6, 3).clone(), _c.set('#fff2c0'));
    }
    // U12: every rune still bound by its order (level.js sw.lock) stands wrapped in a grey wind knot, slowly turning (the squall's body).
    // Sung while bound it flares wide and pale; freed, it widens, lifts and thins away over 0.9 s.
    if (R.sq) for (const sw of ctx.registry.get('level')?.targets?.switches ?? []) {
      if (sw.lock) delete WH.unl[sw.m.id]; // bound again (its guard back on its feet)
      const u = WH.unl[sw.m.id], k = u === undefined ? 0 : THREE.MathUtils.clamp((now - u) / 0.9, 0, 1);
      if (sw.lock ? false : u === undefined || k >= 1) continue;
      const fl = THREE.MathUtils.clamp(1 - (now - (WH.flare[sw.m.id] ?? -9)) / 0.7, 0, 1), s = (3.3 + 0.12 * Math.sin(now * 1.1)) * (1 + 0.6 * fl + 1.4 * k);
      _q.setFromEuler(_e.set(Math.PI * (1 - k) + 0.06, now * 0.5 + 5 * Math.sin(fl * 1.57) + 7 * k * k, 0.05)); // upside down: wide round the foot, tight at the stone's head; it rights itself as it lets go
      put('sq', _v.set(sw.pos[0], sw.pos[1] + 0.85 + 1.6 * k, sw.pos[2]), _q, _s.set(s, 1.9 * (1 - k * k), s), _c.set('#8f9aa6').lerp(_c2.set('#ffffff'), Math.max(fl, k)));
    }
    for (const k of Object.keys(cnt)) { const im = R[k]; if (!im) continue; im.count = cnt[k]; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; }
  },
  dispose() { E = []; R = null; },
};
// gold knot-cords (Name marks): one per motif note, a long note a thicker cord. Bound: tight, dim; unbindable: loose, pulsing, fraying
function cords(e, at, r, now, put, open = 1) {
  const motif = e.motif, dazed = e.unbindable;
  [...motif].forEach((n, i) => {
    const k = motif.length > 1 ? i / (motif.length - 1) - 0.5 : 0, loose = dazed ? 1 + (0.35 + 0.1 * Math.sin(now * 6 + i)) * open : 1, w = n === 'L' ? 2.2 : 1;
    const pulse = dazed ? 0.75 + 0.25 * Math.sin(now * 6 - i * 1.3) : 0.45;
    _q.setFromEuler(_e.set(Math.PI / 2 + k * 0.9, now * (dazed ? 0.4 : 0), k * 0.5));
    put('cord', new THREE.Vector3(at.x, at.y + k * r * 0.9, at.z), _q, new THREE.Vector3(r * loose * (1 - Math.abs(k) * 0.5), r * loose * (1 - Math.abs(k) * 0.5), w), _c.setRGB(1 * pulse + 0.1, 0.78 * pulse + 0.05, 0.3 * pulse));
  });
}

function squall(ctx, e, dt, t, p, hero, wind) {
  const d = e.d, reach = d.aggro ?? SQ.aggro, leash = d.r ?? SQ.r, dist = hero.distanceTo(e.pos), inRange = flat(p.pos, e.home) <= leash && Math.abs(p.pos.y - e.ground) < 3;
  const bob = e.ground + HOVER + 0.15 * Math.sin(t * 2 + e.id.length);
  const toward = (target, sp) => { _s.subVectors(target, e.pos); const L = _s.length(); if (L > 1e-3) e.pos.addScaledVector(_s, Math.min(L, sp * dt) / L); };
  const thief = d.variant === 'thief';
  if (e.kv) { e.pos.x += e.kv[0] * dt; e.pos.z += e.kv[1] * dt; const k = Math.exp(-dt / 0.15); e.kv = Math.hypot(...e.kv) < 0.2 ? null : [e.kv[0] * k, e.kv[1] * k]; }
  if (['hover', 'near', 'tele', 'recover', 'stun'].includes(e.state) && dist < 0.8 && t - (e.brushT ?? -9) > 0.8) { // wind, not stone: walking into it buffets the hero aside
    e.brushT = t; const bx = p.pos.x - e.pos.x, bz = p.pos.z - e.pos.z, L = Math.hypot(bx, bz) || 1;
    knock.set((bx / L) * 4, 0, (bz / L) * 4); ctx.registry.set('enemy.knock', { t, id: e.id, kind: e.kind, pos: p.pos.toArray(), dir: [bx / L, bz / L] }); ctx.registry.set('audio.cue', { name: 'enemy_charge' });
  }
  if (d.variant === 'pull' && ['hover', 'tele', 'pull', 'recover'].includes(e.state)) return maw(ctx, e, dt, t, p, wind);
  switch (e.state) {
    case 'off': case 'away': return;
    case 'blown': e.kv = [e.kv[0] / Math.exp(-dt / 0.15), e.kv[1] / Math.exp(-dt / 0.15)]; e.pos.y += 2 * dt; if (e.st >= 0.7) { e.kv = null; setState(ctx, e, 'away'); } return; // carried off whole, thinning
    case 'flinch': if (e.st >= SQ.flinch) { e.cd = Math.max(e.cd, 0.5); setState(ctx, e, inRange ? 'near' : 'hover'); } return;
    case 'hover':
      toward(_s.copy(e.home).setY(bob), SQ.speed * 0.5);
      if (inRange && dist < reach && p.grounded) setState(ctx, e, 'near');
      return;
    case 'near': {
      if (!inRange) return setState(ctx, e, 'hover');
      let dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, L = Math.hypot(dx, dz) || 1;
      if (d.tame && flat(p.pos, e.home) > 0.8) { const ox = p.pos.x - e.home.x, oz = p.pos.z - e.home.z, k = L / Math.hypot(ox, oz); dx = ox * k; dz = oz * k; } // the first one met: it comes round to the hero's rim side, so its charge can only throw him inland
      const tx = p.pos.x + (dx / L) * SQ.near, tz = p.pos.z + (dz / L) * SQ.near;
      toward(new THREE.Vector3(tx, p.pos.y + 1.0, tz), thief ? TH.speed : SQ.speed);
      e.cd -= dt;
      if (e.cd <= 0 && Math.hypot(e.pos.x - tx, e.pos.z - tz) < 0.5) { setState(ctx, e, 'tele', 'telegraph'); ctx.registry.set('audio.cue', { name: thief ? 'thief_tele' : 'enemy_tele' }); }
      return;
    }
    case 'tele':
      e.dir = [p.pos.x - e.pos.x, p.pos.z - e.pos.z];
      if (e.st >= teleOf(e)) { const L = Math.hypot(...e.dir) || 1; e.dir = [e.dir[0] / L, e.dir[1] / L]; setState(ctx, e, 'charge'); ctx.registry.set('audio.cue', { name: 'enemy_charge' }); }
      return;
    case 'charge':
      if (thief) { // darts through: a breath thread goes with it (no shove)
        e.pos.x += e.dir[0] * TH.v * dt; e.pos.z += e.dir[1] * TH.v * dt; e.pos.y += (p.pos.y + 0.9 - e.pos.y) * Math.min(1, dt * 8);
        if (!e.loot && p.breath >= 1 && hero.distanceTo(e.pos) < SQ.hit) { e.loot = 1; p.breath -= 1; ctx.registry.set('player.breath', { t, b: +p.breath.toFixed(2), max: p.breathMax, why: 'thief' }); ctx.registry.set('enemy.steal', { t, id: e.id, pos: p.pos.toArray() }); ctx.registry.set('audio.cue', { name: 'thief_take' }); e.st = Math.max(e.st, TH.charge - 0.1); } // it stops just past him, the thread trailing
        if (e.st >= TH.charge) { setState(ctx, e, 'recover'); e.cd = 1.5; }
        return;
      }
      e.pos.x += e.dir[0] * SQ.chargeV * dt; e.pos.z += e.dir[1] * SQ.chargeV * dt; e.pos.y += (p.pos.y + 0.9 - e.pos.y) * Math.min(1, dt * 8);
      if (hero.distanceTo(e.pos) < SQ.hit) { knockHero(ctx, e, e.dir[0], e.dir[1], SQ.knock, SQ.lift); setState(ctx, e, 'recover'); e.cd = 3; }
      else if (e.st >= SQ.charge) { setState(ctx, e, 'recover'); e.cd = 1.2; }
      return;
    case 'recover':
      if (e.loot) { // heavy with the stolen thread: slow and low on its way home, in staff reach
        toward(_s.copy(e.home).setY(e.ground + 1.0), TH.carryV);
        if (e.st >= TH.carry) { e.loot = 0; setState(ctx, e, 'hover'); }
        return;
      }
      if (e.st < SQ.spent && !e.unbindable && e.cd < 9) e.pos.y += (e.ground + 1.0 - e.pos.y) * Math.min(1, dt * 5); // spent after its charge: it sags to staff height where it stopped (the opening)
      else toward(_s.copy(e.home).setY(bob), SQ.speed);
      if (e.st >= SQ.recover) setState(ctx, e, 'hover');
      return;
    case 'stun':
      if (e.loot) { e.loot = 0; e.backT = t; p.breath = Math.min(p.breathMax, p.breath + 1); ctx.registry.set('player.breath', { t, b: +p.breath.toFixed(2), max: p.breathMax, why: 'thief.back' }); ctx.registry.set('audio.cue', { name: 'thief_back' }); } // struck while it carries: the thread flies back
      e.pos.y += (e.ground + 0.9 - e.pos.y) * Math.min(1, dt * 3);
      if (e.st >= (d.variant === 'pull' ? PL.choke : e.stunS ?? SQ.stun)) { e.unbindable = false; setState(ctx, e, 'recover'); e.cd = SQ.calm; } // not Named in time: cowed, it keeps its distance a long while before it dares again
      return;
    case 'puff':
      if (e.st < PUFF_S && flat(p.pos, e.pos) < 1.4 && p.pos.y > e.ground - 0.5 && p.pos.y < e.ground + 6) {
        if (wind) wind.y += PUFF_LIFT;
        if (!e.refilled && p.breath < p.breathMax) { e.refilled = true; p.breath = p.breathMax; ctx.registry.set('player.breath', { t, b: +p.breath.toFixed(2), max: p.breathMax, why: 'puff' }); }
      }
      if (e.st >= PUFF_S) setState(ctx, e, 'gone');
  }
}

// The pull squall's own states (stun / puff are the squall's): it never leaves its post.
function maw(ctx, e, dt, t, p, wind) {
  const reg = ctx.registry, reach = e.d.aggro ?? PL.aggro, dx = e.pos.x - p.pos.x, dz = e.pos.z - p.pos.z, dist = Math.hypot(dx, dz) || 1, level = Math.abs(p.pos.y - e.ground) < 3;
  e.pos.y = e.ground + HOVER + 0.1 * Math.sin(t * 1.3);
  switch (e.state) {
    case 'hover':
      e.cd -= dt;
      if (level && dist < reach && e.cd <= 0) { e.bit = false; setState(ctx, e, 'tele', 'telegraph'); reg.set('audio.cue', { name: 'pull_tele' }); }
      return;
    case 'tele': if (e.st >= PL.tele) { setState(ctx, e, 'pull'); reg.set('audio.cue', { name: 'pull_on' }); } return;
    case 'pull':
      if (level && dist < reach + 1.5) {
        if (wind && dist > 0.4) { const k = PL.v * Math.min(1, (reach + 1.5 - dist) / 1.5); wind.x += (dx / dist) * k; wind.z += (dz / dist) * k; p.foulT = t; } // foulT: a maw's draw is no wind to breathe (player.js breathTick)
        if (dist < PL.core && !e.bit) { // swallowed: a breath thread gone, thrown on through and out the far side
          e.bit = true;
          if (p.breath >= 1) { p.breath -= 1; reg.set('player.breath', { t, b: +p.breath.toFixed(2), max: p.breathMax, why: 'pull' }); }
          knockHero(ctx, e, dx, dz, PL.knock, PL.lift);
        }
      }
      if (e.st >= PL.pull) { setState(ctx, e, 'recover'); e.cd = PL.rest; }
      return;
    case 'recover': if (e.st >= 1) setState(ctx, e, 'hover');
  }
}

function warden(ctx, e, dt, t, p, hero) {
  const d = e.d, fwd = (sp) => { // move along e.dir on the ground; false at the rim / a step
    const nx = e.pos.x + e.dir[0] * sp * dt, nz = e.pos.z + e.dir[1] * sp * dt, g = groundY(nx, nz, e.ground);
    if (g === null || Math.abs(g - e.ground) > 0.4) return false;
    e.pos.x = nx; e.pos.z = nz; return true;
  };
  const dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z, dist = Math.hypot(dx, dz), front = (dx * e.dir[0] + dz * e.dir[1]) / (dist || 1) > 0.3;
  if (d.guard && e.state === 'patrol') { // at its post: back to it if blown off, turning to face the hero; in front and close: the shove
    const hx = e.home.x - e.pos.x, hz = e.home.z - e.pos.z, hl = Math.hypot(hx, hz);
    if (hl > 0.05) { const k = Math.min(hl, WD.speed * dt) / hl; e.pos.x += hx * k; e.pos.z += hz * k; }
    if (dist < 9 && dist > 0.1) { const cur = Math.atan2(e.dir[0], e.dir[1]), da = Math.atan2(dx, dz) - cur, a = cur + THREE.MathUtils.clamp(Math.atan2(Math.sin(da), Math.cos(da)), -GD.turn * dt, GD.turn * dt); e.dir = [Math.sin(a), Math.cos(a)]; }
    if (dist < GD.reach && front && Math.abs(p.pos.y - e.ground) < 1.5 && e.cd <= 0) { setState(ctx, e, 'tele', 'telegraph'); ctx.registry.set('audio.cue', { name: 'enemy_tele', kind: 'warden' }); }
    e.cd -= dt;
    return;
  }
  const G = d.guard ? GD : null;
  switch (e.state) {
    case 'patrol': {
      const tgt = d.path[e.leg], tx = tgt[0] - e.pos.x, tz = tgt[1] - e.pos.z, L = Math.hypot(tx, tz);
      if (L < 0.2) { e.leg = 1 - e.leg; return; }
      e.dir = [tx / L, tz / L]; fwd(WD.speed);
      if (dist < WD.aggro && front && Math.abs(p.pos.y - e.ground) < 1.5 && e.cd <= 0) { setState(ctx, e, 'tele', 'telegraph'); ctx.registry.set('audio.cue', { name: 'enemy_tele', kind: 'warden' }); }
      e.cd -= dt;
      return;
    }
    case 'tele':
      if (dist > 0.1 && !G) e.dir = [dx / dist, dz / dist]; // the guard's shove goes where it faced when it wound up
      if (e.st >= teleOf(e)) { setState(ctx, e, 'ram'); ctx.registry.set('audio.cue', { name: 'enemy_charge', kind: 'warden' }); }
      return;
    case 'ram':
      if (G) { // the guard never leaves its post: one shield bash over its reach, where it faced
        if (e.st <= dt + 1e-6 && dist < GD.reach + 0.3 && front && Math.abs(p.pos.y - e.ground) < 1.5) knockHero(ctx, e, e.dir[0], e.dir[1], GD.knock, GD.lift);
        if (e.st >= GD.ram) { setState(ctx, e, 'recover'); e.cd = 1.5; }
        return;
      }
      if (!fwd(WD.ramV) || e.st >= (G ?? WD).ram) { setState(ctx, e, 'recover'); e.cd = 1; }
      else if (hero.distanceTo(_s.set(e.pos.x, e.ground + 0.9, e.pos.z)) < WD.hit + (G ? 0.2 : 0)) { knockHero(ctx, e, e.dir[0], e.dir[1], (G ?? WD).knock, (G ?? WD).lift); setState(ctx, e, 'recover'); e.cd = 1.5; }
      return;
    case 'flinch': if (e.st >= WD.flinch) setState(ctx, e, 'patrol'); return;
    case 'recover': if (e.st >= (G ?? WD).recover) setState(ctx, e, 'patrol'); return;
    case 'stagger': if (e.st >= WD.stagger) { e.unbindable = false; setState(ctx, e, 'patrol'); e.cd = 1; } return;
  }
}

function shatter(ctx, e) { // R4 mistake: the shard is gone for good (broken.<id> persists through respawn), no updraft / rune step
  const reg = ctx.registry;
  e.unbindable = false; setState(ctx, e, 'gone', 'shatter');
  flags[`broken.${e.id}`] = true; reg.set('flags', flags);
  reg.set('break', { t: ctx.game.t, id: e.id, pos: [e.pos.x, e.pos.y + 0.5, e.pos.z], size: [1.2, 1.2], rotY: 0, by: 'shatter' });
}
function window_(ctx, e) { e.rings = []; setState(ctx, e, 'window', 'stagger'); e.unbindable = true; flags[`enemy.${e.id}.window`] = true; ctx.registry.set('flags', flags); }
function startPhase(ctx, e) {
  e.unbindable = false; e.rings = []; e.ringN = 0; e.hits = []; e.motif = e.d.motifs?.[e.phase - 1] ?? motifOf(`${e.id}${e.phase}`);
  setState(ctx, e, e.phase === 1 ? 'waves' : e.phase === 2 ? 'chase' : 'rings');
  flags[`enemy.${e.id}.p${e.phase}`] = true; ctx.registry.set('flags', flags);
  ctx.registry.set('enemy.phase', { t: ctx.game.t, id: e.id, kind: 'boss', pos: e.pos.toArray(), phase: e.phase });
  for (const m of E) if (e.d.minions?.includes(m.id)) {
    m.stunned = false; m.unbindable = false; m.pos.copy(m.home); m.pos.y += HOVER; m.prev.copy(m.pos);
    setState(ctx, m, e.phase === 1 ? 'hover' : 'off');
  }
}
function boss(ctx, e, dt, t, p, hero) {
  const d = e.d, dx = p.pos.x - e.pos.x, dz = p.pos.z - e.pos.z, dist = Math.hypot(dx, dz), inArena = flat(p.pos, e.home) < d.r && Math.abs(p.pos.y - e.ground) < 3;
  switch (e.state) {
    case 'idle': if (inArena) { e.phase = 1; startPhase(ctx, e); } return;
    case 'waves': {
      const ms = E.filter((m) => d.minions?.includes(m.id));
      if (ms.every((m) => m.stunned)) { for (const m of ms) { m.unbindable = false; setState(ctx, m, 'off'); ctx.registry.set('enemy.unbind', { t, id: m.id, kind: 'minion', pos: m.pos.toArray() }); } window_(ctx, e); }
      return;
    }
    case 'chase': { // phase 2: turn to the hero, telegraph, ram across the crown
      if (dist > 0.1) e.dir = [dx / dist, dz / dist];
      e.cd -= dt;
      if (e.cd <= 0 && inArena) { setState(ctx, e, 'tele', 'telegraph'); ctx.registry.set('audio.cue', { name: 'enemy_tele', kind: 'boss' }); }
      return;
    }
    case 'tele': if (e.st >= BOSS.tele) { setState(ctx, e, 'ram'); ctx.registry.set('audio.cue', { name: 'enemy_charge', kind: 'boss' }); } return;
    case 'ram': {
      const nx = e.pos.x + e.dir[0] * BOSS.ramV * dt, nz = e.pos.z + e.dir[1] * BOSS.ramV * dt, g = groundY(nx, nz, e.ground);
      const stop = g === null || Math.abs(g - e.ground) > 0.5 || Math.hypot(nx - e.home.x, nz - e.home.z) > d.r - 1.5;
      if (!stop) { e.pos.x = nx; e.pos.z = nz; }
      if (hero.distanceTo(_s.set(e.pos.x, e.ground + 0.9, e.pos.z)) < BOSS.hit) { knockHero(ctx, e, e.dir[0], e.dir[1], BOSS.knock, BOSS.lift); setState(ctx, e, 'recover'); }
      else if (stop || e.st >= BOSS.ram) setState(ctx, e, 'recover');
      return;
    }
    case 'flinch': if (e.st >= WD.flinch) { setState(ctx, e, 'chase'); e.cd = 1; } return;
    case 'recover': if (e.st >= BOSS.recover) { setState(ctx, e, 'chase'); e.cd = 0.6; } return;
    case 'rings': { // phase 3: back at the centre, a shock ring every ringEvery s; grounded in its band = knocked outward
      e.pos.lerp(e.home, Math.min(1, dt * 2));
      if (e.ringN < BOSS.rings && e.st >= 1.2 + e.ringN * BOSS.ringEvery) { e.rings.push({ r: 0.8, hit: false }); e.ringN++; ctx.registry.set('enemy.ring', { t, id: e.id, pos: e.home.toArray() }); ctx.registry.set('audio.cue', { name: 'enemy_ring' }); }
      const hd = flat(p.pos, e.home);
      for (const r of e.rings) {
        r.r += BOSS.ringV * dt;
        if (!r.hit && Math.abs(hd - r.r) < BOSS.ringW && p.pos.y < e.ground + 0.35 && Math.abs(p.pos.y - e.ground) < 1.5) { r.hit = true; knockHero(ctx, e, p.pos.x - e.home.x, p.pos.z - e.home.z, BOSS.ringKnock, 4); }
      }
      e.rings = e.rings.filter((r) => r.r < d.r + 3);
      if (e.ringN >= BOSS.rings && !e.rings.length) window_(ctx, e);
      return;
    }
    case 'window': if (e.st >= BOSS.window) { ctx.registry.set('enemy.rebind', { t, id: e.id, kind: e.kind, pos: e.pos.toArray() }); startPhase(ctx, e); } return; // missed: the knot pulls shut (render: its cords tighten over the last 3 s), the phase again
  }
}
