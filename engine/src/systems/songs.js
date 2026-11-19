// Songs (Phase S): every gift song is one hold-to-charge cast, deterministic and bot-scriptable. player.js takes the press
// ('player.songStart', breath.song spent) and holds the sing pose while 'songs.state' lives; this system refunds that breath at once
// and spends it again only when the song takes ('song.done' with an id) or is held too long.
//   charge  the key held: 'song.stage' {t, song, stage} as the charge passes STAGE_T (0.4 / 0.9 / 1.5 s: stage 1 / 2 / 3). Released
//           under STAGE_T[0] it is a quick weak tap (stage 0). Held past OVER s it fizzles ('song.fail' {why: 'over'}, breath spent).
//           In the air the hero hovers while charging and the song lets go by itself at AIR_MAX s.
//   release 'song.cast' {t, pos, heading, song, charge, stage, reach, hold, target, targets} -> level.js / trials.js / enemies.js
//           apply it and write c.hit / c.at, then 'song.done' {t, song, id, pos, stage}. Nothing taken: id null (a fizzle, free).
//   gust    a cone along the heading, GUST_REACH[stage] m (x GUST_X2 with Song II); pushes harder with the stage.
//   name    the nearest far rune / unbindable shard / broken repairable post (trials.js) within NAME_R x NAME_X[stage] (pick()); stage 3 unbinds every stunned shard in reach.
//           A rune still bound by its order (level.js sw.lock): 'song.reject' {t, id, pos} (level.js whirl flares, a dull note).
//   anchor  the nearest crumble / lift / raised bridge / slab / pulling squall within ANCHOR_R, held ANCHOR_HOLD[stage] s.
// Registry 'songs.state' = the live charge {song, t0, charge, stage} (render: fx glyph, marks, cloak).
// Shared shape language (fx air glyph, hud journal icons, marks): GLYPH[song] = polylines in unit coords (x right, y up).
import * as THREE from 'three';
import { hash } from '../core/rng.js';

export const STAGE_T = [0.4, 0.9, 1.5], OVER = 2.5, AIR_MAX = 0.6;
export const GUST_REACH = [2.5, 2.5, 4, 6], NAME_X = [1, 1, 1.3, 1.6], ANCHOR_HOLD = [0.6, 1, 2, 3.5]; // by stage (0 = a tap)
export const NAME_R = 6, ANCHOR_R = 8;
export const NAME_R2 = 9, GUST_X2 = 1.5; // R6 Song II (flags song2.name / song2.gust, progress.js): Name wakes from further, Gust blows further
export const SONG_COL = { gust: '#9fe3d0', name: '#ffcf6a', anchor: '#8fb2ff' };
export const stageOf = (charge) => STAGE_T.filter((x) => charge >= x - 1e-6).length;
export const gustReach = (charge) => GUST_REACH[stageOf(charge)];
export const LOCK_GUST = GUST_REACH[2]; // what a dusty R6 lock rune hears of a Gust, at any charge
const MOTIFS = ['SLS', 'LSS', 'SSL', 'LSL', 'SLL'];
export const motifOf = (id, m) => m?.motif ?? MOTIFS[hash(String(id)) % MOTIFS.length];
export const anchorOf = (id, m) => { const P = m?.period ?? 1.6; return { P, ph: ((hash(String(id)) % 997) / 997) * P }; };

// Glyphs (greyscale-readable silhouettes): gust an open spiral with three outward arrows; name a closed ring of rune ticks;
// anchor an anchor (shank, stock, flukes) with a chain loop.
const arc = (cx, cy, r0, r1, a0, a1, n = 24) => Array.from({ length: n + 1 }, (_, i) => { const u = i / n, a = a0 + (a1 - a0) * u, r = r0 + (r1 - r0) * u; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; });
const arrow = (a, r0, r1) => { const c = Math.cos(a), s = Math.sin(a), x = c * r1, y = s * r1; return [[[c * r0, s * r0], [x, y]], [[x - c * 0.22 + s * 0.14, y - s * 0.22 - c * 0.14], [x, y], [x - c * 0.22 - s * 0.14, y - s * 0.22 + c * 0.14]]]; };
export const GLYPH = {
  gust: [arc(0, 0, 0.08, 0.6, 0, Math.PI * 3.2, 40), ...[0.3, 2.4, 4.5].flatMap((a) => arrow(a, 0.68, 1.0))],
  name: [arc(0, 0, 0.75, 0.75, 0, Math.PI * 2, 36), ...Array.from({ length: 8 }, (_, i) => { const a = (i / 8) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); return i % 2 ? [[c * 0.5, s * 0.5], [c * 0.75, s * 0.75]] : [[c * 0.45, s * 0.45], [c * 0.62, s * 0.62], [c * 0.55 - s * 0.1, s * 0.55 + c * 0.1]]; })],
  anchor: [[[0, 0.62], [0, -0.75]], [[-0.38, 0.38], [0.38, 0.38]], arc(0, -0.2, 0.62, 0.62, Math.PI * 1.05, Math.PI * 1.95, 18), [[-0.6, -0.2], [-0.72, -0.05]], [[0.6, -0.2], [0.72, -0.05]], arc(0, 0.8, 0.17, 0.17, 0, Math.PI * 2, 14)],
};

// The target `song` cast at pos would take (name / anchor), or null. Name: an unwoken far rune (2D <= reach) or an unbindable
// shard (enemies.js, 3D <= reach + its body radius); anchor: a touched crumble, a moving lift or a raised timed bridge (3D <= ANCHOR_R).
export const nameReach = (reg, stage = 1) => (reg.get('flags')?.['song2.name'] ? NAME_R2 : NAME_R) * NAME_X[stage];
export function pick(reg, song, pos, reach) {
  const L = reg.get('level')?.targets; if (!L) return null;
  let best = song === 'name' ? reach ?? nameReach(reg) : ANCHOR_R, out = null;
  if (song === 'name') {
    for (const sw of L.switches) {
      const d = Math.hypot(sw.pos[0] - pos[0], sw.pos[2] - pos[2]);
      if (!sw.m.far || sw.on || sw.dusty || d > best || sw.lock || (sw.m.lock && d > nameReach(reg))) continue; // an R6 lock rune hears the plain reach only: a charge does not stand in for Name II
      best = d; out = { kind: 'switch', o: sw, id: sw.m.id, m: sw.m, pos: sw.pos };
    }
    for (const e of reg.get('enemies') ?? []) {
      const d = e.kind === 'boss' ? Math.hypot(e.pos.x - pos[0], e.pos.z - pos[2]) - 4 : Math.hypot(e.pos.x - pos[0], e.pos.y - pos[1], e.pos.z - pos[2]); // the Knot Warden is big: named from anywhere near its feet
      if (!e.unbindable || d > best) continue;
      best = d; out = { kind: 'enemy', o: e, id: e.id, m: {}, pos: e.pos.toArray() };
    }
    for (const o of reg.get('trials') ?? []) { // U4 trials.js: a broken load-bearing post, Named from its deck's far hinge
      if (o.kind !== 'pillar' || !o.d.repair || o.state !== 'down') continue;
      const d = Math.hypot(o.d.deck.b[0] - pos[0], o.d.deck.b[2] - pos[2]);
      if (d <= best) { best = d; out = { kind: 'trial', o, id: o.id, m: {}, pos: o.d.deck.b }; }
    }
  } else if (song === 'anchor') {
    const near = (o, q, id, m, kind) => { const d = Math.hypot(q.x - pos[0], q.y - pos[1], q.z - pos[2]); if (d <= best) { best = d; out = { kind, o, id, m, pos: q.toArray() }; } };
    for (const k of L.mechs) {
      if (k.m.kind === 'crumble' && k.body.enabled) near(k, k.cur, k.m.group ?? k.m.id, k.m, 'mech');
      if (k.m.kind === 'platform' && k.m.id !== 'golem' && !((k.m.idle || k.m.after) && k.start === undefined) && k.m.mode !== 'once') near(k, k.cur, k.m.id, k.m, 'mech');
    }
    for (const br of Object.values(L.bridges)) if (br.m.hold != null && br.start !== null) for (const k of br.pieces) near(br, k.cur, br.m.id, br.m, 'bridge');
    for (const e of reg.get('enemies') ?? []) if (e.state === 'pull') near(e, e.pos, e.id, { free: true }, 'enemy'); // a pull squall mid-inhale (enemies.js): rooted against it, it chokes
    for (const k of reg.get('trials.anchor') ?? []) near(k, k.cur, k.id, k.m, 'trial'); // R5 trials.js: a falling slab (m.free: no ring alignment, the skill is the moment)
  }
  return out;
}

let S, refund;
export default {
  name: 'songs', order: 21, deps: ['level', 'player'], // after player (the press), before fx / hud (render)
  init(ctx) {
    const reg = ctx.registry;
    S = null; refund = 0;
    reg.set('songs.state', null);
    reg.on('player.breath', (b) => { if (b.why === 'song') refund = reg.get('player').tuning.breath.song; });
    reg.on('player.songStart', ({ t, song }) => {
      const p = reg.get('player');
      S = { song, t0: t, charge: 0, stage: 0, paid: refund };
      if (refund) { p.breath = Math.min(p.breathMax, p.breath + refund); refund = 0; } // breath is spent only when the song takes
      reg.set('songs.state', S);
    });
    reg.on('player.respawn', () => { S = null; reg.set('songs.state', null); });
  },
  update(ctx, dt) {
    if (!S) return;
    const reg = ctx.registry, p = reg.get('player');
    if (reg.get('input')?.song !== S.song || (!p.grounded && S.charge >= AIR_MAX)) return cast(ctx);
    S.charge += dt;
    const st = stageOf(S.charge);
    if (st > S.stage) { S.stage = st; reg.set('song.stage', { t: ctx.game.t, song: S.song, stage: st, pos: p.pos.toArray() }); }
    if (S.charge > OVER) { // held too long: the song tears, its breath is gone
      spend(ctx);
      reg.set('song.fail', { t: ctx.game.t, song: S.song, why: 'over', id: null, pos: p.pos.toArray() });
      S = null; reg.set('songs.state', null);
    }
  },
};
function spend(ctx) {
  const reg = ctx.registry, p = reg.get('player'), b0 = p.breath;
  if (!S.paid) return;
  p.breath = Math.max(0, p.breath - S.paid);
  if (p.breath !== b0) reg.set('player.breath', { t: ctx.game.t, b: +p.breath.toFixed(2), max: p.breathMax, why: 'song.cost' });
}
function cast(ctx) {
  const reg = ctx.registry, p = reg.get('player'), pos = p.pos.toArray(), stage = stageOf(S.charge), song = S.song;
  const c = { t: ctx.game.t, pos, heading: p.heading, song, charge: S.charge, stage, reach: GUST_REACH[stage] * (reg.get('flags')?.['song2.gust'] ? GUST_X2 : 1), hold: ANCHOR_HOLD[stage], target: null, targets: [], hit: null, at: null };
  if (song === 'name') {
    c.reach = nameReach(reg, stage);
    c.target = pick(reg, 'name', pos, c.reach);
    if (stage >= 3) c.targets = (reg.get('enemies') ?? []).filter((e) => e.unbindable && e !== c.target?.o && Math.hypot(e.pos.x - pos[0], e.pos.y - pos[1], e.pos.z - pos[2]) <= c.reach);
    if (!c.target) { // a rune bound by its order answers with a refusal
      const sw = (reg.get('level')?.targets?.switches ?? []).find((q) => q.m.far && !q.on && q.lock && Math.hypot(q.pos[0] - pos[0], q.pos[2] - pos[2]) <= c.reach);
      if (sw) reg.set('song.reject', { t: c.t, id: sw.m.id, pos: sw.pos });
    }
  } else if (song === 'anchor') c.target = pick(reg, 'anchor', pos);
  reg.set('song.cast', c); // level.js / trials.js / enemies.js resolve it
  if (c.hit) spend(ctx); // the song took: now it costs its breath
  reg.set('song.done', { t: c.t, song, id: c.hit ?? null, pos: c.at ?? null, stage });
  S = null; reg.set('songs.state', null);
}
