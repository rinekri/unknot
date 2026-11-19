// R4 / R5 trials: level.trials = [...] (gen_l*.mjs), procedural stone props with their own collide bodies. Sim-side, deterministic.
//   pillar {id, pos (base), h, r, fall: [dx, dz], deck: {a, b, w, t}}: a cracked load-bearing post under a deck (a bridge, top at a/b y).
//     A strike within r + STRIKE_R or a Gust cone on it: it creaks CREAK s (shake, dust, 'stones'), then topples along `fall`; the deck
//     swings down off its far hinge (b) and hangs there. Flag broken.<id> (kept through checkpoint respawn, cleared only by a level
//     restart; 'break' {by: 'topple'}). The way on never needs the deck (a fallback route stays: the R4 contract).
//     repair: true (U4): the post leans broken and the deck hangs from the start; Name sung within reach of the deck's far hinge (b,
//     songs.js pick) stands the post back up and swings the deck onto it (fixed.<id>, the gold glow in its seams seals). Knocked
//     down again: broken.<id>, and it can be Named up again from the far side.
//   bell {id, pos}: a hanging rune bell. 'player.pogo' over it (the hero's feet within BELL_R of it, above it) rings it: ev.hit = 'bell'.
//   slab {id, pos (top centre, hung), size: [w, t, d], stop (y the top passes at the walkway), near: [x, z], r, v, drop, hold}: a slab
//     hung on chains. The hero within r of `near`: it creaks, then lowers at v m/s through the gap, `drop` m, then falls away and
//     re-hangs after REHANG s. Anchor (songs.js pick: 'trials.anchor', m.free = no ring alignment, the skill is the moment) holds it
//     `hold` s where it is, then it lowers on. Respawn re-hangs it. R4 wasted anchor: held with nobody stepping on it, the strain
//     tells (the slab shudders, grit runs off its cracks, the chains jitter) and when the hold ends its chains snap: it drops for
//     good (broken.<id>, 'break'); the ledge beyond is optional and has its own way back.
// Render: bells and slabs hang on thin hemp rope / iron chain from a floating rock overhead (finite, no ink on rope), faded or
// hidden near the camera and where they would cross the camera's view of the hero.
// Registry: 'trials' = the live list (bot.js reads slab state), 'trials.anchor' = the slabs that can be anchored now.
import * as THREE from 'three';
import { getSave, addTo } from '../core/save.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const STRIKE_R = 1.6, CREAK = 0.55, TOPPLE = 1.1, MEND = 2.2, BELL_R = 1.1, REHANG = 2.5, GUST_CONE = 0.6, BELL_ROCK = 4.2, SLAB_ROCK = 3.4, LINK = 0.27;
let T, collide, stone, crack, flags, rope, rockMat, iron;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _h = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _x = new THREE.Vector3(1, 0, 0), ZERO = new THREE.Matrix4().makeScale(0, 0, 0), _q2 = new THREE.Quaternion(), TWIST = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2);
// how much a hanging line at a..b may show: 0 near the camera or across the camera's line to the hero, else 1
function veil(cam, hero, a, b) {
  let k = 1;
  for (let i = 0; i <= 8; i++) {
    _c.lerpVectors(a, b, i / 8);
    k = Math.min(k, THREE.MathUtils.smoothstep(_c.distanceTo(cam), 2, 4));
    _d.subVectors(hero, cam); const L = _d.length(), u = THREE.MathUtils.clamp(_h.subVectors(_c, cam).dot(_d) / (L * L), 0, 1);
    if (u < 0.97) k = Math.min(k, THREE.MathUtils.smoothstep(_h.copy(cam).addScaledVector(_d, u).distanceTo(_c), 0.35, 0.8));
  }
  return k;
}
function fade(o, k, ink = true) { // a mesh fades out on the colour layer (its ink line goes with it)
  const m = o.material; o.visible = k > 0.02;
  if (k < 0.99 || !ink) { o.layers.set(1); m.transparent = true; m.opacity = k; m.depthWrite = k > 0.99; } else { o.layers.set(0); m.transparent = false; m.opacity = 1; m.depthWrite = true; }
}
function floater(sx, sy, sz, seed) { // a small floating rock: a flattened, chipped lump with a hanging tip
  const g = new THREE.IcosahedronGeometry(1, 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), n = 0.82 + 0.18 * Math.sin(x * 5.1 + seed) * Math.cos(z * 4.3 + y * 3.7 + seed); p.setXYZ(i, x * sx * n, (y > 0 ? y * 0.55 : y * 1.25) * sy * n, z * sz * n); }
  g.computeVertexNormals(); return g;
}

export default {
  name: 'trials', order: 11, deps: ['level'],
  init(ctx) {
    const reg = ctx.registry, L = reg.get('level');
    T = []; collide = L?.collide; flags = reg.get('flags') ?? {};
    reg.set('trials', T); reg.set('trials.anchor', []);
    if (!L?.data.trials?.length) return;
    stone = new THREE.MeshStandardMaterial({ name: 'stone', color: 0xb9ad98, roughness: 0.95 });
    crack = new THREE.MeshBasicMaterial({ color: 0x1c1712 });
    rope = new THREE.MeshLambertMaterial({ color: 0xb08a55 }); iron = new THREE.MeshStandardMaterial({ color: 0x47433d, roughness: 0.6, metalness: 0.25 });
    for (const d of L.data.trials) if (d.repair && getSave().shortcuts.includes(`${L.data.id}.${d.id}`)) flags[`fixed.${d.id}`] = true; // U14: a deck mended on a past visit stays mended (the level's shortcut)
    for (const d of L.data.trials) {
      const o = { id: d.id, kind: d.kind, d, st: 0, state: 'idle' };
      if (d.kind === 'pillar') buildPillar(ctx, o);
      else if (d.kind === 'bell') buildBell(ctx, o);
      else if (d.kind === 'slab') buildSlab(ctx, o);
      else continue;
      T.push(o);
    }
    const hitPillar = (o, pos, by) => {
      if (o.kind !== 'pillar' || o.state !== 'idle') return false;
      o.state = 'creak'; o.st = 0; o.by = by;
      reg.set('crumble.warn', { t: ctx.game.t, pos: [o.d.pos[0], o.d.pos[1] + o.d.h, o.d.pos[2]] });
      reg.set('trial.creak', { t: ctx.game.t, pos: [o.d.pos[0], o.d.pos[1] + o.d.h - 0.9, o.d.pos[2]], n: 14 });
      reg.set('audio.cue', { name: 'stones', gain: 0.9 });
      return true;
    };
    reg.on('player.strikeHit', ({ pos }) => {
      const h = reg.get('player')?.heading ?? 0, fx = pos[0] + Math.sin(h), fz = pos[2] + Math.cos(h); // the staff's reach: 1 m ahead
      for (const o of T) {
        if (o.kind !== 'pillar') continue;
        const d = Math.hypot(fx - o.d.pos[0], fz - o.d.pos[2]);
        if (d <= o.d.r + STRIKE_R && pos[1] >= o.d.pos[1] - 1 && pos[1] <= o.d.pos[1] + o.d.h + 0.5) hitPillar(o, pos, 'strike');
      }
    });
    reg.on('song.cast', (c) => {
      if (c.song === 'gust') for (const o of T) {
        if (o.kind !== 'pillar' || o.state !== 'idle') continue;
        const dx = o.d.pos[0] - c.pos[0], dz = o.d.pos[2] - c.pos[2], d = Math.hypot(dx, dz), off = Math.atan2(dx, dz) - c.heading;
        if (d > c.reach + o.d.r || c.pos[1] < o.d.pos[1] - 1 || c.pos[1] > o.d.pos[1] + o.d.h + 0.5 || (d > 0.5 && Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) > GUST_CONE)) continue;
        if (hitPillar(o, c.pos, 'gust')) { c.hit ??= o.id; c.at ??= [...o.d.pos]; }
      }
      if (c.song === 'name' && c.target?.kind === 'trial') { // U4: the broken post is Named whole from the deck's far hinge
        const o = c.target.o; o.state = 'rise'; o.st = 0; c.hit = o.id; c.at = [...o.d.deck.b];
        delete flags[`broken.${o.id}`]; flags[`fixed.${o.id}`] = true; reg.set('flags', flags); addTo('shortcuts', `${L.data.id}.${o.id}`);
        reg.set('trial.creak', { t: c.t, pos: [o.d.pos[0], o.d.pos[1] + o.d.h - 0.9, o.d.pos[2]], n: 14 });
        reg.set('audio.cue', { name: 'stones', gain: 0.7 }); reg.set('audio.cue', { name: 'chime', gain: 0.8 });
      }
      if (c.song === 'anchor' && c.target?.kind === 'trial') {
        const o = c.target.o; if (o.state !== 'lower') return;
        o.state = 'held'; o.st = 0; o.used = false; c.hit = o.id; c.at = o.cur.toArray();
        reg.set('trials.anchor', []);
      }
    });
    reg.on('player.pogo', (ev) => {
      if (ev.hit) return;
      for (const o of T) {
        if (o.kind !== 'bell') continue;
        const [x, y, z] = o.d.pos, dy = ev.pos[1] - y;
        if (Math.hypot(ev.pos[0] - x, ev.pos[2] - z) > BELL_R || dy < -0.2 || dy > 1.4) continue;
        ev.hit = 'bell'; o.ring = ctx.game.t; o.n = (o.n ?? 0) + 1;
        reg.set('enemy.ring', { t: ctx.game.t, pos: [x, y, z] }); // fx: a ring of air off the bell
        reg.set('audio.cue', { name: 'chime', gain: 0.8 });
        reg.set('trial.bell', { t: ctx.game.t, id: o.id, n: o.n });
        return;
      }
    });
    reg.on('player.respawn', () => { for (const o of T) if (o.kind === 'slab') rehang(o); reg.set('trials.anchor', []); });
  },
  update(ctx, dt) {
    if (!T?.length) return;
    const reg = ctx.registry, p = reg.get('player'), t = ctx.game.t;
    flags = reg.get('flags') ?? flags;
    for (const o of T) {
      o.st += dt;
      if (o.kind === 'pillar') {
        if (o.state === 'idle' && p && Math.hypot(p.pos.x - o.d.pos[0], p.pos.z - o.d.pos[2]) < 3.5 && Math.abs(p.pos.y - o.d.pos[1] - o.d.h) < 3 && t - (o.dustT ?? -9) > 2.5) {
          o.dustT = t; reg.set('crumble.warn', { t, pos: [o.d.pos[0], o.d.pos[1] + o.d.h - 0.9, o.d.pos[2]] }); // grit trickles out of the crack
          reg.set('trial.creak', { t, pos: [o.d.pos[0], o.d.pos[1] + o.d.h - 0.9, o.d.pos[2]], n: 5 }); reg.set('audio.cue', { name: 'stones', gain: 0.35 }); // a creak, a breath of dust
        }
        if (o.state === 'creak' && o.st >= CREAK) topple(ctx, o);
        if (o.state === 'rise') { o.k = Math.max(0, 1 - o.st / MEND); posePillar(o); if (o.k <= 0) { o.state = 'idle'; o.mendT = t; flags[`raised.${o.id}`] = true; reg.set('flags', flags); reg.set('mech.dock', { t, pos: [...o.d.deck.a] }); } }
        if (o.state === 'fall') { o.k = Math.min(1, o.st / TOPPLE); posePillar(o); if (o.k >= 1) { o.state = 'down'; reg.set('mech.dock', { t, pos: [...o.d.deck.b] }); } }
      } else if (o.kind === 'slab') slab(ctx, o, dt, p, t);
    }
  },
  beforeRender(ctx) {
    if (!T?.length) return;
    const t = ctx.game.t, cam = ctx.camera.getWorldPosition(new THREE.Vector3()), hm = ctx.registry.get('player.model'), hero = hm ? _a.copy(hm.position).setY(hm.position.y + 0.9).clone() : null;
    for (const o of T) {
      if (o.kind === 'pillar' && o.vis) { const s = o.state === 'creak' ? 0.04 * Math.sin(t * 70) : 0; o.vis.position.set(s, 0, s * 0.6); }
      if (o.glow) { const u = t - (o.mendT ?? -9); o.glow.opacity = o.state === 'rise' ? 1 : o.state === 'idle' ? Math.max(0, 1 - u) : o.state === 'down' ? 0.45 + 0.2 * Math.sin(t * 2.2) : 0; o.glow.visible = o.glow.opacity > 0.01; } // the seams wait for their name; sealed, the glow goes
      if (o.kind === 'bell') {
        const u = t - (o.ring ?? -9), a = u < 1.5 ? 0.22 * Math.exp(-2.5 * u) * Math.sin(u * 14) : 0; o.vis.rotation.z = a + 0.02 * Math.sin(t * 1.3); o.glow.material.opacity = u < 0.8 ? 1 - u / 0.8 : 0.15;
        if (hero) { o.vis.updateMatrixWorld(true); const k = veil(cam, hero, o.rock.position, _b.set(0, -o.ropeL, 0).applyMatrix4(o.vis.matrixWorld)); fade(o.rope, k, false); fade(o.rock, Math.min(1, k * 1.5)); }
      }
      if (o.kind === 'slab' && o.vis) {
        const strain = o.state === 'held' && !o.used ? THREE.MathUtils.smoothstep(o.st, o.d.hold - 2, o.d.hold) : 0;
        const s = o.state === 'creak' ? 0.03 * Math.sin(t * 60) : strain * 0.035 * Math.sin(t * 47);
        o.vis.position.set(s, 0, strain * 0.02 * Math.sin(t * 31)); o.vis.rotation.z = o.state === 'snap' ? Math.min(0.5, o.st * 0.9) : 0;
        chains(o, t, cam, hero, strain);
      }
    }
  },
};

function cracks(parent, w, h, n, seed, th = 0.035, seg = 0.18, steps = 4) { // dark jagged fissures on a face, joined end to end (the visible tell: this one is weak)
  const bar = (x, y, ang, len, tw) => { const m = new THREE.Mesh(new THREE.BoxGeometry(tw, len + tw * 0.8, th * 0.8), crack); m.position.set(x + Math.sin(ang) * len / 2, y + Math.cos(ang) * len / 2, 0); m.rotation.z = -ang; parent.add(m); };
  for (let i = 0; i < n; i++) {
    let x = ((i % 3) - (n > 1 ? 1 : 0)) * w * 0.3 + 0.03 * ((seed * 5 + i) % 3 - 1), y = (0.05 + 0.25 * ((seed * 7 + i * 3) % 4) / 4) * h - h / 2;
    for (let k = 0; k < steps; k++) {
      const len = seg * (0.8 + 0.25 * ((seed + k + i) % 3)), ang = (k % 2 ? 1 : -1) * (0.3 + 0.15 * ((seed + i + k) % 3)), tw = th * (1 - 0.55 * k / steps);
      bar(x, y, ang, len, tw);
      if (k === 1) bar(x + Math.sin(ang) * len * 0.5, y + Math.cos(ang) * len * 0.5, ang + (ang > 0 ? -1.1 : 1.1), len * 0.6, tw * 0.6); // a branch
      x += Math.sin(ang) * len; y += Math.cos(ang) * len;
    }
  }
}
function bakeCracks(root) { // the fissures under root, baked into one draw (they never move against it)
  root.updateMatrixWorld(true); const inv = root.matrixWorld.clone().invert(), parts = [], drop = [];
  root.traverse((q) => { if (q.isMesh && q.material === crack) { parts.push(q.geometry.applyMatrix4(q.matrixWorld.clone().premultiply(inv))); drop.push(q); } });
  for (const q of drop) q.removeFromParent();
  if (parts.length) { const m = new THREE.Mesh(mergeGeometries(parts), crack); root.add(m); return m; }
}

function buildPillar(ctx, o) {
  const d = o.d, reg = ctx.registry;
  // the post: hinge group at its base (topples about it), the visual inside (render shake only)
  o.hinge = new THREE.Group(); o.hinge.position.set(...d.pos); ctx.add(o.hinge);
  o.vis = new THREE.Group(); o.hinge.add(o.vis);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 0.85, d.r, d.h, 9), stone); post.position.y = d.h / 2; post.name = `trial_${d.id}`;
  o.vis.add(post);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 1.15, d.r * 0.9, 0.3, 9), stone); cap.position.y = d.h - 0.15; o.vis.add(cap);
  // the deck: hinged at b (the far end), its near end resting on the post
  const a = new THREE.Vector3(...d.deck.a), b = new THREE.Vector3(...d.deck.b), len = a.distanceTo(b), t = d.deck.t ?? 0.45;
  o.deckHinge = new THREE.Group(); o.deckHinge.position.copy(b); o.deckHinge.rotation.order = 'YXZ'; o.deckHinge.rotation.y = Math.atan2(a.x - b.x, a.z - b.z); ctx.add(o.deckHinge);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(d.deck.w, t, len), stone); deck.position.set(0, (a.y - b.y) / 2 - t / 2, len / 2); deck.name = `trial_${d.id}_deck`;
  deck.rotation.x = -Math.atan2(a.y - b.y, len); o.deckHinge.add(deck);
  const joints = []; for (let i = 1; i < Math.floor(len / 1.4); i++) joints.push(new THREE.BoxGeometry(d.deck.w * 1.01, 0.02, 0.05).translate(0, t / 2 + 0.002, -len / 2 + i * 1.4));
  if (d.repair) o.glow = new THREE.MeshBasicMaterial({ color: '#ffcf6a', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }); // Name's gold
  if (joints.length) deck.add(new THREE.Mesh(mergeGeometries(joints), o.glow ?? crack)); // slab joints, one draw
  o.hinge.updateMatrixWorld(true); o.deckHinge.updateMatrixWorld(true);
  o.body = collide.addBody(o.hinge); o.deckBody = collide.addBody(o.deckHinge);
  // big dark fissures round the post (render only, added after the collider): the tell that this one is weak
  for (let k = 0; k < 9; k++) { const f = new THREE.Group(); f.rotation.y = (k + 0.5) * Math.PI * 2 / 9; f.position.y = d.h - 1.25 + 0.3 * ((k * 5) % 3) / 2; const g = new THREE.Group(); g.position.z = d.r * 0.8; f.add(g); cracks(g, 0.3, 0.9, 1, k + 1, 0.08, 0.26, 5); o.vis.add(f); } // one per facet, flush (9-sided post)
  bakeCracks(o.vis);
  if (o.glow) { const band = new THREE.Mesh(new THREE.CylinderGeometry(d.r * 0.9, d.r * 0.93, 0.07, 9, 1, true), o.glow); band.position.y = d.h - 1.1; band.rotation.z = 0.12; o.vis.add(band); } // the break line
  o.k = 0;
  if (flags[`broken.${d.id}`] || (d.repair && !flags[`fixed.${d.id}`])) { o.state = 'down'; o.k = 1; posePillar(o); } // R4: a mistake kept (checkpoint restart; only a level restart clears it)
  reg.set('look.refresh');
}
function posePillar(o) {
  const k = o.k, e = k * k; // falls faster as it goes
  const [fx, fz] = o.d.fall, ax = new THREE.Vector3(fz, 0, -fx).normalize();
  o.hinge.quaternion.setFromAxisAngle(ax, e * Math.PI * 0.5 * (o.d.repair ? 0.3 : 0.92)); // a repairable post only leans out from under its deck
  o.deckHinge.rotation.x = Math.min(1, k * 1.25) ** 2 * 1.25; // swings down off its far hinge, hangs there
  o.hinge.updateMatrixWorld(true); o.deckHinge.updateMatrixWorld(true);
  o.body.enabled = o.deckBody.enabled = k <= 0;
}
function topple(ctx, o) {
  const reg = ctx.registry, d = o.d;
  o.state = 'fall'; o.st = 0; o.body.enabled = o.deckBody.enabled = false;
  flags[`broken.${d.id}`] = true; delete flags[`fixed.${d.id}`]; delete flags[`raised.${d.id}`]; reg.set('flags', flags);
  reg.set('break', { t: ctx.game.t, id: d.id, pos: [d.pos[0], d.pos[1] + d.h * 0.6, d.pos[2]], size: [d.r * 2, d.h * 0.8], rotY: 0, by: 'topple' });
  reg.set('audio.cue', { name: 'crack', gain: 1 });
}

function buildBell(ctx, o) {
  const d = o.d;
  o.rock = new THREE.Mesh(floater(0.75, 0.6, 0.65, d.pos[0]), new THREE.MeshStandardMaterial({ color: 0xa79c88, roughness: 0.95 })); o.rock.position.set(d.pos[0], d.pos[1] + BELL_ROCK, d.pos[2]); o.rock.rotation.y = d.pos[0]; o.rock.name = `trial_${d.id}_rock`; ctx.add(o.rock);
  o.vis = new THREE.Group(); o.vis.position.set(d.pos[0], d.pos[1] + BELL_ROCK - 0.55, d.pos[2]); ctx.add(o.vis); // it swings from the rock's underside
  o.ropeL = BELL_ROCK - 0.55 - 0.95; // to the bell's crown (0.95 m over its rim)
  const rg = mergeGeometries([new THREE.CylinderGeometry(0.03, 0.03, o.ropeL, 5).translate(0, -o.ropeL / 2, 0), new THREE.TorusGeometry(0.07, 0.03, 5, 10).translate(0, -o.ropeL + 0.02, 0), new THREE.TorusGeometry(0.06, 0.028, 5, 10).rotateY(Math.PI / 2).translate(0, -0.05, 0)]);
  o.rope = new THREE.Mesh(rg, rope.clone()); o.rope.layers.set(1); o.vis.add(o.rope); // hemp: thin, no ink line
  const by = -o.ropeL - 0.95, lip = new THREE.TorusGeometry(0.6, 0.05, 6, 16).rotateX(Math.PI / 2).translate(0, by + 0.02, 0);
  const bell = new THREE.Mesh(mergeGeometries([new THREE.CylinderGeometry(0.28, 0.62, 0.95, 10, 1, true).translate(0, by + 0.48, 0), lip]), new THREE.MeshStandardMaterial({ name: 'stone', color: 0x8d8a83, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide }));
  o.vis.add(bell);
  o.glow = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.04, 6, 16), new THREE.MeshBasicMaterial({ color: 0xffd47a, transparent: true, opacity: 0.15, depthWrite: false }));
  o.glow.rotation.x = Math.PI / 2; o.glow.position.y = by + 0.97; o.glow.layers.set(1); o.vis.add(o.glow); // the rune band: flares when struck
  ctx.registry.set('look.refresh');
}

function slabGeo(w, t, dd) { // a weathered slab: bevelled, its edges chipped (deterministic jitter), top at y 0
  const r = 0.12, sh = new THREE.Shape(), x = w / 2 - r, z = dd / 2 - r;
  sh.moveTo(-x, -z - r); sh.lineTo(x, -z - r); sh.quadraticCurveTo(x + r, -z - r, x + r, -z); sh.lineTo(x + r, z); sh.quadraticCurveTo(x + r, z + r, x, z + r);
  sh.lineTo(-x, z + r); sh.quadraticCurveTo(-x - r, z + r, -x - r, z); sh.lineTo(-x - r, -z); sh.quadraticCurveTo(-x - r, -z - r, -x, -z - r);
  const g = new THREE.ExtrudeGeometry(sh, { depth: t - 0.16, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.09, bevelSegments: 1, curveSegments: 2 });
  g.rotateX(Math.PI / 2); g.translate(0, -0.08, 0); // shape on xz, extruded down: top bevel at 0, bottom at -t
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const px = p.getX(i), py = p.getY(i), pz = p.getZ(i), edge = Math.abs(px) > w / 2 - 0.15 || Math.abs(pz) > dd / 2 - 0.15;
    const n = Math.sin(px * 7.3 + pz * 3.1) * Math.cos(px * 2.2 - pz * 5.7 + py * 4);
    if (edge) p.setXYZ(i, px * (1 - 0.025 * Math.abs(n)), py - (py > -0.05 && n > 0.45 ? 0.07 : 0), pz * (1 - 0.04 * Math.abs(n)));
  }
  g.computeVertexNormals(); return g;
}
function buildSlab(ctx, o) {
  const d = o.d, [w, t, dd] = d.size;
  o.node = new THREE.Group(); ctx.add(o.node);
  o.vis = new THREE.Group(); o.node.add(o.vis);
  const box = new THREE.Mesh(new THREE.BoxGeometry(w, t, dd)); box.position.y = -t / 2; box.name = `trial_${d.id}`; box.layers.disableAll(); o.node.add(box); // the collider
  o.cur = new THREE.Vector3(...d.pos); o.m = { free: true, id: d.id };
  o.node.position.copy(o.cur); o.node.updateMatrixWorld(true);
  o.body = collide.addBody(o.node);
  // render only (added after the collider): the weathered slab, its cracks, four iron rings, chains up to a floating rock
  const g = slabGeo(w, t, dd);
  o.vis.add(new THREE.Mesh(g, stone));
  const top = new THREE.Group(); top.rotation.x = -Math.PI / 2; top.position.y = 0.006; top.scale.z = 0.12; o.vis.add(top); cracks(top, w * 0.9, dd * 0.9, 3, 5, 0.07, 0.3, 5);
  for (const sd of [-1, 1]) { const f = new THREE.Group(); f.position.set(0, -t / 2, sd * (dd / 2 + 0.01)); f.rotation.y = sd > 0 ? 0 : Math.PI; f.scale.z = 0.3; o.vis.add(f); cracks(f, w, t * 1.6, 2, sd + 4, 0.06, 0.16, 3); }
  bakeCracks(o.vis).layers.set(1); // fissures cut into the stone, no ink line (inked they read as sticks)
  o.rings = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => new THREE.Vector3(sx * (w / 2 - 0.35), 0.14, sz * (dd / 2 - 0.3))));
  o.vis.add(new THREE.Mesh(mergeGeometries(o.rings.map((r) => new THREE.TorusGeometry(0.17, 0.05, 6, 14).translate(r.x, r.y, r.z))), iron));
  o.rock = new THREE.Mesh(floater(w * 0.42, 0.9, dd * 0.5, d.pos[2]), new THREE.MeshStandardMaterial({ color: 0xa79c88, roughness: 0.95 })); o.rock.name = `trial_${d.id}_rock`;
  o.rock.position.set(d.pos[0], d.pos[1] + SLAB_ROCK, d.pos[2]); ctx.add(o.rock);
  o.hooks = o.rings.map((r) => new THREE.Vector3(d.pos[0] + r.x * 0.55, d.pos[1] + SLAB_ROCK - 0.55, d.pos[2] + r.z * 0.6));
  o.nLinks = Math.ceil((SLAB_ROCK + d.drop + 0.6) / LINK) + 1;
  const link = new THREE.TorusGeometry(0.1, 0.034, 5, 10); link.scale(1.45, 1, 1);
  o.links = new THREE.InstancedMesh(link, iron, 4 * o.nLinks); o.links.frustumCulled = false; o.links.name = `trial_${d.id}_chain`; ctx.add(o.links);
  rehang(o);
  ctx.registry.set('look.refresh');
}
// the four chains, ring to hook, a link every LINK m (hidden near the camera and across its view of the hero); strain: they jitter
function chains(o, t, cam, hero, strain) {
  const up = o.node.visible && o.state !== 'broken';
  if (up) o.vis.updateMatrixWorld(true);
  let kRock = 1;
  if (hero) _h.subVectors(hero, cam);
  const HL = _h.length();
  o.rings.forEach((r, ci) => {
    const a = _a.copy(r).applyMatrix4(o.vis.matrixWorld), b = o.hooks[ci], L = a.distanceTo(b), n = Math.min(o.nLinks, Math.ceil(L / LINK));
    _d.subVectors(b, a).normalize(); _q.setFromUnitVectors(_x, _d);
    for (let j = 0; j < o.nLinks; j++) {
      if (!up || j >= n) { o.links.setMatrixAt(ci * o.nLinks + j, ZERO); continue; }
      _c.copy(a).addScaledVector(_d, (j + 0.5) * L / n);
      // each link: gone within a few metres of the camera and where it would cross the camera's view of the hero
      let k = THREE.MathUtils.smoothstep(_c.distanceTo(cam), 3.5, 6);
      if (hero) { const u = THREE.MathUtils.clamp(_s.subVectors(_c, cam).dot(_h) / (HL * HL), 0, 1); if (u < 0.97) k = Math.min(k, THREE.MathUtils.smoothstep(_s.copy(cam).addScaledVector(_h, u).distanceTo(_c), 0.4, 0.9)); }
      if (j === n - 1) kRock = Math.min(kRock, k);
      if (k < 0.05) { o.links.setMatrixAt(ci * o.nLinks + j, ZERO); continue; }
      if (strain) _c.x += strain * 0.03 * Math.sin(t * 53 + j * 1.7 + ci);
      const q = j % 2 ? _q2.copy(_q).multiply(TWIST) : _q;
      o.links.setMatrixAt(ci * o.nLinks + j, _m.compose(_c, q, _s.set(Math.min(1.3, L / n / 0.2) * k, k, k)));
    }
  });
  o.links.instanceMatrix.needsUpdate = true;
  if (hero) fade(o.rock, Math.min(1, (up ? kRock : 1) * 1.5));
}
function rehang(o) { if (flags[`broken.${o.id}`]) { o.state = 'broken'; o.node.visible = false; o.body.enabled = false; return; } o.state = 'idle'; o.st = 0; o.cur.fromArray(o.d.pos); o.node.visible = true; o.node.position.copy(o.cur); o.body.enabled = true; o.body.update(); }
function slab(ctx, o, dt, p, t) {
  const reg = ctx.registry, d = o.d;
  if (o.state === 'idle' && p && Math.hypot(p.pos.x - d.near[0], p.pos.z - d.near[1]) < d.r) { o.state = 'creak'; o.st = 0; reg.set('crumble.warn', { t, pos: o.cur.toArray() }); reg.set('audio.cue', { name: 'stones', gain: 0.7 }); }
  else if (o.state === 'creak' && o.st >= 0.6) { o.state = 'lower'; o.st = 0; reg.set('trials.anchor', [o]); }
  else if (o.state === 'lower') {
    o.cur.y -= d.v * dt;
    if (d.pos[1] - o.cur.y >= d.drop) { o.state = 'gone'; o.st = 0; o.body.enabled = false; o.node.visible = false; reg.set('trials.anchor', []); reg.set('mech.dock', { t, pos: o.cur.toArray() }); }
  } else if (o.state === 'held') {
    if (p?.groundBody === o.body) o.used = true;
    if (!o.used && o.st > d.hold - 2 && t - (o.dustT ?? -9) > 0.7) { o.dustT = t; reg.set('crumble.warn', { t, pos: o.cur.toArray() }); } // the strain: grit runs off it
    if (o.st >= d.hold && !o.used) { // R4 wasted anchor: held for nobody, its chains give: it drops for good
      o.state = 'snap'; o.st = 0; o.body.enabled = false; reg.set('trials.anchor', []);
      flags[`broken.${d.id}`] = true; reg.set('flags', flags);
      reg.set('break', { t, id: d.id, pos: [o.cur.x, o.cur.y - 0.25, o.cur.z], size: [d.size[0], 0.6], rotY: Math.PI / 2, by: 'snap' });
      reg.set('audio.cue', { name: 'crack', gain: 1 });
    } else if (o.st >= d.hold) { o.state = 'lower'; o.st = 0; reg.set('trials.anchor', [o]); }
  } else if (o.state === 'snap') { o.cur.y -= (2 + 9.8 * o.st) * dt; o.node.position.copy(o.cur); if (o.st > 1.6) { o.state = 'broken'; o.node.visible = false; } }
  else if (o.state === 'gone' && o.st >= REHANG && !(p && Math.hypot(p.pos.x - d.near[0], p.pos.z - d.near[1]) < d.r)) rehang(o);
  if (o.state === 'lower' || o.state === 'idle') { o.node.position.copy(o.cur); o.body.update(); }
}
