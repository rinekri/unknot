// Level l2 "Wind Totems" (0 -> +20 m, ~120 s). Beats:
//   1. an updraft lifts you onto a +4 m ledge, then an air dash across to M;
//   2. three crosswind lanes over a slab corridor: a cracked wall stands across the way in (strike it or dash into it); the totem
//      behind it stills all three lanes (or dash across each lane while it blows);
//   3. a 12 m tower: three islands stacked +4 m apart, each climbed on a cycling updraft (on 3 s, off 2 s);
//   4. a lift on t3 (+3.3 m) to the summit S, woken by a two-rune sequence hidden east of t3: the far rune A, then B on the way back;
//   5. with both gifts (two air charges, wind fills breath): two dashes across a crosswind gap; crumble pads into two dashes;
//      a cycling updraft over the void into two dashes; a headwind gap: a totem hidden four hops west of W flips it to a tailwind (breath) and kills the updraft behind you;
//      then two dashes down to the goal island Z.
//   Branch: from M a side tailwind carries you to the echo island; two hops lead back to N (same checkpoint).
// Writes ../assets/levels/l2/{level.json,world.glb,collider.glb,placement.json}. Usage: node tools/gen_l2.mjs   (npm run gen-l2)
import { makeKit, THREE, TUNING, jumpReach, RUNE, TOTEM, STAKE, PILLAR, TREE, ARCH, RUBBLE, SHRINE, STAIRS, STUMP, DECOR, r2, r2v, poly, facing } from './lib/kit.mjs';
import { makeR6 } from './lib/r6.mjs';

const SEED = 2207;
const K = makeKit(SEED, new URL('../../assets/levels/l2/', import.meta.url));
const { rr, isl, island, chain, rimGap, rimFar, rimNear } = K;

// ---------- layout ----------
const TAIL = 4, LIFT = 40, CROSS = 7.5, CYCLE = [3, 0.5, 1.5]; // tailwind m/s, updraft m/s^2 (> gravity 24), crosswind m/s (> run 6.5)
isl.start = island('start', 0, 0, 0, 10);
chain('h1', isl.start, 2.8, 25, 0.3, 2.6);
chain('h2', isl.h1, 2.8, -20, 0.2, 2.5);
chain('U', isl.h2, 2.8, 0, 0, 7);
const U = isl.U, LEDGE = 4;
isl.L = island('L', U.x, U.z + 7.5, U.y + LEDGE, 6, { wallDown: LEDGE + 0.8, depth: 4 });
const L = isl.L;
const DGAP = 5.0; // L -> M: > jump reach, < 0.85 x dash reach
chain('M', L, DGAP, 0, 0, 6);
const M = isl.M;
chain('N', M, 2.8, 0, 0.2, 6);
const N = isl.N, WALLGAP = 6.0;
chain('Q', N, WALLGAP, 0, 0, 5);
const Q = isl.Q, PGAP = 8.5;
chain('P', Q, PGAP, 0, 0, 7);
const P = isl.P;
const tw = K.tower('t', P, [{ deg: 0, rise: 4, R: 5, cycle: CYCLE }, { deg: 90, rise: 4, R: 5, cycle: CYCLE }, { deg: 0, rise: 4, R: 5.5, cycle: CYCLE }]);
const T3 = isl.t3, LIFTUP = 3.3, PADGAP = 2.0;
isl.S = island('S', T3.x, 0, T3.y + LIFTUP, 8, { wallDown: LIFTUP + 0.8, depth: 5 });
isl.S.z = rimFar(T3) + PADGAP + isl.S.rim(-Math.PI / 2);
const S = isl.S;
// branch: side tailwind M -> echo (+X), then two hops back to N
const SGAP = 5.0;
chain('echo', M, SGAP, 90, 0, 3.5);
const E = isl.echo, back = Math.atan2(N.x - E.x, N.z - E.z) / (Math.PI / 180);
chain('e1', E, 2.8, back, 0.1, Math.max(1.8, (rimGap(E, N) - 5.6) / 2)); // sized so e1 -> N is ~2.8 m too
const I = isl;
// R7 hidden switches on their own seeded streams (the play layout keeps its draws): the lift's rune sequence east of t3 (B on the way, A at
// the end: sing A, then B), the flip totem four hops west of W. Veins run from each target to its switch (level.js).
K.own(702, () => { chain('v1', I.t3, 2.55, 76, 0.8, 3.0); chain('hB', I.v1, 2.7, 48, 0.3, 2.8); chain('v2', I.hB, 2.55, 130, 0.7, 2.1); chain('v3', I.v2, 2.7, 82, 0.2, 2.9); chain('hA', I.v3, 2.6, 90, 0.5, 3); });
const hA = I.hA, hB = I.hB;

// Slab path N -> Q (the wall across slab 1); corridor Q -> P under three crosswind lanes.
const slabsOf = (prefix, a, b, n, w, tops) => {
  const z0 = rimFar(a) - 0.6, z1 = rimNear(b) + 0.6, OV = 0.05, SL = (z1 - z0 + OV * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ name: `${prefix}_${i}`, x: a.x + rr(-0.1, 0.1), z0: z0 + i * (SL - OV), z1: z0 + i * (SL - OV) + SL, w: rr(w, w + 0.15), top: a.y + tops[i], rotY: rr(-0.03, 0.03) }));
};
const slabs = slabsOf('slab', N, Q, 4, 1.25, [0.02, 0.05, 0.03, 0.04]);
const corr = slabsOf('path', Q, P, 5, 1.0, [0.02, 0.05, 0.03, 0.05, 0.02]);
const wallZ = (slabs[1].z0 + slabs[1].z1) / 2;
const laneZ = [0.25, 0.5, 0.75].map((f) => rimFar(Q) + f * (rimNear(P) - rimFar(Q)));
const lanes = laneZ.map((z) => ({ min: [Q.x - 2.5, Q.y - 2, z - 0.7], max: [Q.x + 4, Q.y + 3, z + 0.7] }));
// Wind boxes: M ledge updraft, side tailwind, tower updrafts (kit.tower)
const wUp = { min: [U.x - 1.6, U.y - 0.5, rimNear(L) - 1.8], max: [U.x + 1.6, L.y + 0.8, rimNear(L) - 0.05] };
const wSide = { min: [M.x + M.rim(0) - 4.5, M.y - 1.5, M.z - 2.5], max: [E.x - 1, M.y + 3.5, M.z + 2.5] }; // run-up + arc (rim(0) = +X)
// Summit lift pad t3 -> S
const lift = { name: 'mech_lift', x: T3.x, z0: rimFar(T3) - 0.4, z1: rimNear(S) + 0.1, w: 2.4, top: T3.y, rotY: 0 };
const liftC = [lift.x, (lift.z0 + lift.z1) / 2];

// After the gifts (Phase Q): the summit S is a cairn now, the goal moved on. Every beat below uses both air charges.
const GUST = { gap: 9.0, drop: 1.5, lane: 3.0, x: 7 }; // S -> G1 over a crosswind lane (always on)
const CRU = { gap: 1.6, len: 3.0, n: 3, delay: 0.6 }, PADD = { gap: 8.0, drop: 1.8 }; // G1 -> crumble pads -> two dashes to G2
const UPV = { len: 4.5, w: 3.6, rise: 0, top: 2.0, gap: 6.6, cycle: [3, 0.5, 1.5] }; // G2 -> updraft over the void -> two dashes to W (level)
const WGAP = 5.2, ZGAP = { gap: 8.4, drop: 1.8 }; // W -> tailwind gap -> X -> two dashes to Z (the goal)
chain('G1', S, GUST.gap, 0, -GUST.drop, 6);
const G1 = isl.G1;
// R2: the Name rune (Sigh's song) on its own seeded stream, out of reach 3.5 m above G1's far rim, beside the crumble row: sung awake
// from the rim (level.js NAME_R 6 m) it fills the breath (player.js breath.nearFar), which pays for the Anchor [3] held over the row
K.own(704, () => chain('far', G1, 2.0, -30, 3.5, 1.4));
const Far = I.far, spotG = [G1.x - 0.5, rimFar(G1) - 1.2];
if (Math.hypot(Far.x - spotG[0], Far.z - spotG[1]) > 5.8) throw new Error('R2: the far rune is out of the Name song reach from G1 rim');
chain('G2', G1, CRU.n * CRU.len + CRU.n * CRU.gap + PADD.gap, 0, -PADD.drop, 5);
const G2 = isl.G2;
const gcr = Array.from({ length: CRU.n }, (_, i) => { const z0 = rimFar(G1) + CRU.gap + i * (CRU.len + CRU.gap); return { name: `mech_gcrumble_${i}`, x: G1.x + rr(-0.15, 0.15), z0, z1: z0 + CRU.len, w: rr(2.0, 2.3), top: G1.y + [0.03, 0.06, 0.02][i], rotY: rr(-0.06, 0.06) }; });
const vz0 = rimFar(G2) - 0.3, vz1 = rimFar(G2) + UPV.len;
chain('W', G2, rimFar(G2) + UPV.len + UPV.gap - rimFar(G2), 0, UPV.rise, 4.5);
const W = isl.W;
chain('X', W, WGAP, 0, 0, 4.5);
const X = isl.X;
chain('Z', X, ZGAP.gap, 0, -ZGAP.drop, 7);
const Z = isl.Z;
K.own(703, () => { chain('f1', I.W, 2.55, -74, 0.8, 3.0); chain('f2', I.f1, 2.7, -44, 0.3, 2.1); chain('f3', I.f2, 2.55, -130, 0.7, 2.8); chain('f4', I.f3, 2.7, -80, 0.2, 2.2); chain('hF', I.f4, 2.6, -90, 0.5, 3); });
const hF = I.hF;
// U19: the Name's and the Anchor's song-shrines stand on their own side islands (a hop, then a two-burst air dash): off the route, tall and lit
const SHGAP = 5.3; // between one burst's reach and 0.9 x two bursts'
K.own(705, () => { chain('n1', Q, 2.6, -50, 0.8, 2.6); chain('NS', isl.n1, SHGAP, -35, 0.3, 4.2); chain('a1', G1, 2.6, 50, 0.8, 2.6); chain('AS', isl.a1, SHGAP, 35, 0.3, 4.2); });
K.noOverlap([['U', 'L'], ['P', 't1'], ['t1', 't2'], ['t2', 't3'], ['t3', 'S'], ['P', 't2'], ['t1', 't3'], ['t2', 'S'], ['e1', 'N'], ['e1', 'M'], ['echo', 'N'], ['G1', 'far']]); // far: 3.5 m above G1, out of reach (R2 Name rune)
const wGust = { min: [S.x - GUST.x, G1.y - 4, rimFar(S) + (GUST.gap - GUST.lane) / 2], max: [S.x + GUST.x, S.y + 3, rimFar(S) + (GUST.gap + GUST.lane) / 2] };
const wUpV = { min: [G2.x - UPV.w / 2, G2.y - 4, vz0], max: [G2.x + UPV.w / 2, W.y + UPV.top, vz1] };
const wTailX = { min: [W.x - 2.2, W.y - 1.5, W.z - 1], max: [W.x + 2.2, W.y + 3.5, rimNear(X) + 0.5] };
// Updraft -> two dashes, simulated the way bot.js flies it (step off the rim at run speed, ride, first burst at the apex above
// W, the second once the cooldown is over); run speed outside the bursts. Returns the m flown past the updraft on W's level.
const updraftFlight = (charges) => {
  const T = TUNING, dt = 1 / 60;
  let z = rimFar(G2), y = G2.y, vy = 0, vz = T.run, dashT = 9, cd = 0, n = charges, fired = 0;
  for (let i = 0; i < 600; i++) {
    const inBox = z >= wUpV.min[2] && z <= wUpV.max[2] && y >= wUpV.min[1] && y <= wUpV.max[1];
    if (inBox) n = charges;
    if (n > 0 && cd <= 0 && vy <= 0 && (fired || y >= W.y + 0.5)) { n--; fired++; dashT = 0; cd = T.dashCooldown; }
    cd -= dt;
    if (dashT < T.dashTime) { vy = 0; vz = T.dashSpeed; dashT += dt; if (dashT >= T.dashTime) vz = T.run; }
    else { vy -= T.gravity * dt; if (inBox) vy = Math.max(vy, Math.min(vy + LIFT * dt, 5)); }
    y += vy * dt; z += vz * dt;
    if (vy < 0 && y <= W.y && (fired || z > wUpV.max[2])) return z - wUpV.max[2];
  }
  return 0;
};

// Props. Totem and rune stone face their strike spots (+Z front).
const totemQ = { id: 'totemQ', glb: TOTEM, pos: [Q.x + 2.6, Q.y, Q.z + 0.4], rotY: -Math.PI / 2 };
const seqA = { id: 'seqA', glb: RUNE, pos: [hA.x + 1.2, hA.y, hA.z], rotY: -Math.PI / 2 }, spotA = [hA.x - 0.3, hA.z];
const seqB = { id: 'seqB', glb: RUNE, pos: [hB.x, hB.y, hB.z + 1.4], rotY: Math.PI }, spotB = [hB.x, hB.z - 0.1];
const runeN = { id: 'runeN', glb: RUNE, pos: [Far.x, Far.y, Far.z], rotY: facing([Far.x, 0, Far.z], [spotG[0], 0, spotG[1]]) }; // faces the rim spot
const totemW = { id: 'totemW', glb: TOTEM, pos: [hF.x - 1.2, hF.y, hF.z], rotY: Math.PI / 2 }, spotF = [hF.x + 0.3, hF.z];
const kBird = [totemQ.pos[0] + 0.3, Q.y + 1.6, totemQ.pos[2] - 2.6], ANCHOR_D = 1.4;
const anchors = [[Q.x + 2.4, Q.z - 3.2, -Math.PI / 2], [Q.x - 2.6, Q.z - 2.6, Math.PI / 2]].map(([x, z, rotY], i) =>
  ({ id: `anchor${'AB'[i]}`, glb: STAKE, pos: [x, Q.y, z], rotY, spot: [x + Math.sin(rotY) * ANCHOR_D, z + Math.cos(rotY) * ANCHOR_D] }));
// U18 song-shrines: old standing stones with their song carved on the face (marks.js), sung to from their spot. The Name's on Q
// (ribbons; its first use: the lane Squall sqQ, shown open), the Anchor's on G1 (chains; its first use: the crumble row gcr beside it).
const SHRINE_K = 1.9, toward = (a, b, inset) => { const an = Math.atan2(b.z - a.z, b.x - a.x), r = a.rim(an) - inset; return [a.x + Math.cos(an) * r, a.y, a.z + Math.sin(an) * r]; };
const sideShrine = (id, from, hop, home) => { // the stone at the island's far side from the dash in, facing back; the route's detour to it and back
  const d = Math.hypot(home.x - hop.x, home.z - hop.z), u = [(home.x - hop.x) / d, (home.z - hop.z) / d], spot = [home.x - u[0] * 0.3, home.z - u[1] * 0.3];
  const stone = { id, glb: PILLAR, pos: [home.x + u[0] * 1.8, home.y, home.z + u[1] * 1.8], rotY: Math.atan2(-u[0], -u[1]), scale: SHRINE_K };
  const out = toward(from, hop, 1.2), inn = toward(home, hop, 1.3), hopAt = [hop.x, hop.y, hop.z];
  return { stone, spot, inn, hopAt, cp: [home.x - u[0] * 1.6, home.y, home.z - u[1] * 1.6], route: [out, hopAt, inn, [spot[0], home.y, spot[1]], inn, hopAt, out] };
};
const shN = sideShrine('song_name', Q, I.n1, I.NS), shA = sideShrine('song_anchor', G1, I.a1, I.AS);
const nameSpot = shN.spot, anchorSpot = shA.spot, songName = shN.stone, songAnchor = shA.stone;
const props = [
  { id: 'pillar_s1', glb: PILLAR, pos: [-4.5, 0, 2.5], rotY: 0.4 },
  { id: 'pillar_s2', glb: PILLAR, pos: [4.6, 0, 4.2], rotY: 1.2, scale: 0.8 },
  totemQ, seqA, seqB, totemW, runeN, songName, songAnchor, ...anchors.map(({ spot, ...p }) => p),
  { id: 'pillar_u1', glb: PILLAR, pos: [U.x - 4.2, U.y, U.z - 1], rotY: 0.6, scale: 0.85 },
  { id: 'pillar_l1', glb: PILLAR, pos: [L.x - 3.4, L.y, L.z + 1.5], rotY: 0.2, scale: 1.1 },
  { id: 'pillar_n1', glb: PILLAR, pos: [N.x - 3.2, N.y, N.z + 1], rotY: 0.9, scale: 0.8 },
  { id: 'pillar_g1', glb: PILLAR, pos: [Z.x - 3, Z.y, Z.z + 2.6], rotY: 0.5 },
  { id: 'pillar_g2', glb: PILLAR, pos: [Z.x + 2.9, Z.y, Z.z + 2.1], rotY: -0.4, scale: 0.9 },
];

const SPAWN = [0, 0, -6];
const goalPos = [Z.x, Z.y, Z.z + 1];
const spotQ = [totemQ.pos[0] - 1.2, totemQ.pos[2]];
// NPCs (npc.js). Sigh: the wisp bound in totemQ, freed by its strike (gift.windbreath: wind and runes refill breath from here),
// then leads to what the path does not show (npc.js: the nearest unfound echo / breakable) and barks `found` on each one. Tied Kestrel: a paper bird on two gold ropes before totemQ, each tied to an anchor stake; each
// anchor's strike spot is outside the other anchor's and totemQ's reach. Both cut (gift.airdash: a second air dash), it releases
// an updraft (kUp, off the route), flies off and circles over it.
const kUp = { min: [totemQ.pos[0] - 0.3, Q.y - 0.5, totemQ.pos[2] - 2.0], max: [totemQ.pos[0] + 0.9, Q.y + 5, totemQ.pos[2] - 0.8] };
const at = (k) => [I[k].x, I[k].y, I[k].z];
// tower climb: walk to the near-rim updraft, ride it, step onto the upper island
const climb = tw.flatMap(({ lo, hi, deg, near }) => {
  const ux = Math.round(Math.sin(deg * Math.PI / 180)), uz = Math.round(Math.cos(deg * Math.PI / 180)), o = (k) => [near[0] + ux * k, near[1] + uz * k];
  const a = o(-3), b = o(-0.9), c = o(1.8);
  return [[a[0], lo.y, a[1]], [b[0], lo.y, b[1]], [c[0], hi.y, c[1]], [hi.x, hi.y, hi.z]];
});
const route = [
  SPAWN, [-6, 0, -4], [-6.5, 0, 4], [-1, 0, 7], at('h1'), at('h2'),
  [U.x - 2, U.y, U.z - 3], [U.x, U.y, rimNear(L) - 3], [U.x, U.y, rimNear(L) - 0.6], [L.x, L.y, rimNear(L) + 1.8],
  [L.x - 1.2, L.y, L.z], [L.x, L.y, rimFar(L) - 1.1], [M.x, M.y, rimNear(M) + 1.5], [M.x - 1, M.y, M.z + 1],
  [N.x, N.y, rimNear(N) + 1.5], [N.x, N.y, rimFar(N) - 2.5], [N.x, N.y, slabs[0].z0 + 0.4], [N.x, N.y, wallZ + 1.2], [Q.x, Q.y, rimNear(Q) + 1.2],
  [anchors[1].spot[0], Q.y, anchors[1].spot[1]], [anchors[0].spot[0], Q.y, anchors[0].spot[1]], [spotQ[0] - 0.6, Q.y, spotQ[1] - 1.0], [spotQ[0], Q.y, spotQ[1]], ...shN.route, [Q.x, Q.y, rimFar(Q) - 1.2],
  ...corr.map((p) => [p.x, p.top, (p.z0 + p.z1) / 2]), [P.x, P.y, rimNear(P) + 1.5],
  ...climb, [T3.x + 2.5, T3.y, T3.z], at('v1'), at('hB'), at('v2'), at('v3'), [spotA[0], hA.y, spotA[1]], at('v3'), at('v2'), [spotB[0], hB.y, spotB[1]], at('v1'), [T3.x + 2, T3.y, T3.z + 1],
  [T3.x - 1, T3.y, rimFar(T3) - 2], [liftC[0], T3.y, liftC[1]], [S.x, S.y, rimNear(S) + 1.5], [S.x - 1.5, S.y, S.z], [S.x, S.y, rimFar(S) - 1.5],
  [G1.x, G1.y, rimNear(G1) + 1.5], [G1.x, G1.y, G1.z], ...shA.route, [G1.x, G1.y, rimFar(G1) - 1.2], ...gcr.map((p) => [p.x, p.top, (p.z0 + p.z1) / 2]),
  [G2.x, G2.y, rimNear(G2) + 1.5], [G2.x, G2.y, G2.z], [G2.x, G2.y, rimFar(G2) - 1.4], [W.x, W.y, rimNear(W) + 1.5], [W.x - 2.5, W.y, W.z], at('f1'), at('f2'), at('f3'), at('f4'), [spotF[0], hF.y, spotF[1]], at('f4'), at('f3'), at('f2'), at('f1'), [W.x, W.y, W.z],
  [X.x, X.y, rimNear(X) + 1.2], [X.x, X.y, X.z], [X.x, X.y, rimFar(X) - 1.2], [Z.x, Z.y, rimNear(Z) + 1.5], goalPos,
].map((w) => [r2(w[0]), r2(w[1]), r2(w[2]), 0]);

// Decor: wind theme. Trees lean downwind. Clear of the route, wind boxes, strike spots, the lift and the goal ring.
const inBox = (x, z, b, m) => x > b.min[0] - m && x < b.max[0] + m && z > b.min[2] - m && z < b.max[2] + m;
const boxes = [wUp, wSide, kUp, ...lanes, ...tw.map((t) => t.box), wGust, wUpV, wTailX];
// the far totem stands clear: nothing in the sight line from 13 m out past the song spot to the totem
const sight = (x, z, r) => { const ax = Far.x, az = Far.z, dx = spotG[0] - ax, dz = spotG[1] - az, n = Math.hypot(dx, dz), bx = ax + dx / n * 13, bz = az + dz / n * 13;
  const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / 169)); return Math.hypot(x - ax - u * (bx - ax), z - az - u * (bz - az)) > r + 3; };
const keep = (x, z, r) => sight(x, z, r) && !boxes.some((b) => inBox(x, z, b, r + 0.5)) && [spotQ, ...anchors.map((a) => a.spot), liftC, spotA, spotB, spotF, spotG, ...[seqA, seqB, totemW].map((p) => [p.pos[0], p.pos[2]])].every(([sx, sz]) => Math.hypot(x - sx, z - sz) > r + 1.8) &&
  Math.hypot(x - goalPos[0], z - goalPos[2]) > r + 2.6;
const DOWN_Z = Math.PI, DOWN_X = -Math.PI / 2, lean = (base) => (x, z, rd) => base + (rd() - 0.5) * 0.35;
const route0 = route.filter((q) => ![...shN.route, ...shA.route].some((d) => r2(d[0]) === q[0] && r2(d[2]) === q[2])), /* U19: decor laid out as before the shrines' detours (the seed draws stay put) */ props0 = props.filter((p) => !p.id.startsWith('song_')); // U18: decor laid out as before the song-shrines (the seed draws stay put), cleared around them below
const decor = K.decorate([
  { on: I.start, glb: TREE, n: 2, s: [0.9, 1.05], yaw: lean(DOWN_Z) }, { on: I.start, glb: RUBBLE, s: [0.85, 1.0] },
  { on: U, glb: RUBBLE, n: 2, s: [0.85, 1.0] }, { on: L, glb: TREE, s: [0.85, 1.0], yaw: lean(DOWN_Z) },
  { on: M, glb: RUBBLE, s: [0.85, 1.0] }, { on: N, glb: TREE, s: [0.9, 1.0], yaw: lean(DOWN_Z) }, { on: E, glb: TREE, s: [0.95, 1.05], yaw: lean(DOWN_X) },
  { on: Q, glb: RUBBLE, s: [0.85, 1.0] }, { on: P, glb: TREE, n: 2, s: [0.9, 1.05], yaw: lean(DOWN_X) }, { on: P, glb: RUBBLE, s: [0.85, 1.0] },
  { on: I.t1, glb: RUBBLE, s: [0.85, 1.0] }, { on: I.t2, glb: TREE, s: [0.8, 0.95], yaw: lean(DOWN_Z) },
  { on: S, glb: ARCH, s: [1.0, 1.1] }, { on: S, glb: SHRINE, s: [0.8, 0.9] }, { on: S, glb: TREE, n: 2, s: [0.95, 1.1], yaw: lean(DOWN_Z) }, { on: S, glb: RUBBLE, s: [0.85, 1.0] },
  { on: G1, glb: TREE, s: [0.85, 1.0], yaw: lean(DOWN_X) }, { on: G2, glb: RUBBLE, s: [0.85, 1.0] }, { on: X, glb: RUBBLE, s: [0.8, 0.95] },
  { on: Z, glb: ARCH, s: [1.0, 1.1] }, { on: Z, glb: TREE, n: 2, s: [0.95, 1.1], yaw: lean(DOWN_Z) },
], { route: route0, props: props0, keep });
const shrine = decor.find((d) => d.glb === SHRINE);
// Setpieces (appended, each placed on its own: earlier decor keeps its seed draws). A totem fallen on the spawn island (a rubble
// footprint stands in for its length when clearing the spot; STUMP, not TOTEM: a dead totem must not look strikable), and the
// Keepers' sealed workshop behind the cracked wall on Q.
const place = (spec) => decor.push(...K.decorate([spec], { route: route0, props: [...props0, ...decor], keep }));
place({ on: I.start, glb: RUBBLE, s: [1, 1] });
const fallen = decor.at(-1), FY = DOWN_Z + 0.5; // lies along the wind
Object.assign(fallen, { glb: STUMP, rotY: FY, scale: 1, // stump at the shifted spot, its broken length back along local -X
  pos: [fallen.pos[0] + 0.9 * Math.cos(FY), fallen.pos[1], fallen.pos[2] - 0.9 * Math.sin(FY)] });
for (const glb of [PILLAR, PILLAR, STAIRS, RUBBLE]) place({ on: Q, glb, s: glb === PILLAR ? [0.75, 0.9] : [0.85, 1.0] });
decor.forEach((d, i) => { d.id = `decor_${i}`; });

// R5 bell-runes (trials.js): an optional crossing east of the start, 9.8 m rim to rim (no jump or dash makes it): two bells on cords
// over the gap, pogo (down + strike) on each to bounce on; from the far ledge two plain hops lead back to the start. A miss: the void.
const BELGAP = 9.8;
chain('bel', isl.start, BELGAP, 90, -0.5, 2.6);
chain('bh1', isl.bel, 2.8, 200, 0.2, 1.6);
{ const b1 = isl.bh1, st = isl.start, deg = Math.atan2(st.x - b1.x, st.z - b1.z) * 180 / Math.PI; chain('bh2', b1, 2.8, deg, 0.2, (Math.hypot(st.x - b1.x, st.z - b1.z) - st.R - b1.R - 5.6) / 2); }

// ---------- world.glb + collider.glb ----------
const world = new THREE.Scene();
const play = Object.values(I);
const rocks = K.islandMeshes(world, play);
// The way in: the wind road from the Keepers' quarry (l1, behind the back rim) sets the hero down on the spawn, over the three-stone
// pier at the rim. The way on: the freed Kestrel's updraft just off Z's rim lifts him into the wind road toward the Crown (the outro).
const SH = facing(SPAWN, at('h1')), HB = SH + Math.PI, bX = Math.sin(HB), bZ = Math.cos(HB), rimB = isl.start.rim(Math.PI / 2 - HB);
const prevIsl = { x: bX * 100, z: bZ * 100, y: -8, R: 16 };
const arrive = Array.from({ length: 3 }, (_, i) => {
  const d = rimB - 0.5 + i * 2.6 + 1.1;
  return { name: `arrive_${i}`, x: bX * d, z0: bZ * d - 1.1, z1: bZ * d + 1.1, w: 1.6, top: 0.04 - i * 0.22, rotY: HB + 0.05 * Math.sin(i * 1.3) };
});
const arriveAt = (i) => [bX * (rimB - 0.5 + i * 2.6 + 1.1), 0.04 - i * 0.22, bZ * (rimB - 0.5 + i * 2.6 + 1.1)];
const HAND_D = 1.6; // m: the arrive hand-off point behind the spawn (see the arrive cutscene)
const inAt = (d, up, k = 0) => [SPAWN[0] + bX * d + bZ * k, SPAWN[1] + up, SPAWN[2] + bZ * d - bX * k]; // the way in: d m behind the spawn on its heading, up m, k m to the left
const aside = [bX * (rimB - 1) - bZ * 1.3, 0.02, bZ * (rimB - 1) + bX * 1.3]; // the arrive walk steps round the rubble at the bridge end
K.distantRing(world, new THREE.Vector3(S.x / 2, 0, S.z / 2), { n: 15, clear: [[prevIsl.x, prevIsl.z, prevIsl.R * 1.8]] });
const farDecor = K.farIsland(world, { name: 'l1', kind: 'stones', ...prevIsl });
const beacon = K.landmark(world, { x: S.x / 2 + Math.sin(0.45) * 220, z: S.z / 2 + Math.cos(0.45) * 220, y: -10 }); // the Crown, nearer now
const HE = Math.atan2(beacon[0] - Z.x, beacon[2] - Z.z), eX = Math.sin(HE), eZ = Math.cos(HE), rimE = Z.rim(Math.PI / 2 - HE);
const exitP = (d, up) => [Z.x + eX * d, Z.y + up, Z.z + eZ * d];
const side = (p, k) => [p[0] + eZ * k, p[1], p[2] - eX * k]; // k m to the right of the way on
// the goal's 'onward' camera (4.5 m behind the goal, along HE) and the outro's side camera (its 3.6 s key, looking at Z's rim) see the
// hero and the Crown, not a trunk: no decor in their view cones
const outroCam = [goalPos[0] - eX * 6 + eZ * 3, goalPos[2] - eZ * 6 - eX * 3], outroAt = exitP(rimE + 2, 3);
for (const [ox, oz, tx, tz] of [[goalPos[0] - eX * 4.5, goalPos[2] - eZ * 4.5, goalPos[0] + eX, goalPos[2] + eZ], [...outroCam, outroAt[0], outroAt[2]]]) {
  const L = Math.hypot(tx - ox, tz - oz), cx = (tx - ox) / L, cz = (tz - oz) / L;
  for (let i = decor.length; i-- > 0;) {
    const d = decor[i], dx = d.pos[0] - ox, dz = d.pos[2] - oz, u = dx * cx + dz * cz, v = Math.abs(dx * cz - dz * cx);
    if (u > -1.5 && u < 45 && v < (DECOR[d.var ?? d.glb]?.r ?? 1) * d.scale + 1.5 + 0.5 * Math.max(0, u)) decor.splice(i, 1);
  }
}
const wExit = { min: [exitP(rimE + 1.8, 0)[0] - 1.5, Z.y - 6, exitP(rimE + 1.8, 0)[2] - 1.5], max: [exitP(rimE + 1.8, 0)[0] + 1.5, Z.y + 10, exitP(rimE + 1.8, 0)[2] + 1.5] };
const falls = K.waterfalls(world, play, rocks, 3, route);
// the tree that would stand in front of the summit rune guard (gdS, placed later on its own stream): it hid the guard's telegraph
// and squeezed the play camera into its back. The guard block below throws if a trunk is near it again.
{ const i = decor.findIndex((d) => d.glb === TREE && Math.hypot(d.pos[0] - 14.32, d.pos[2] - 137.69) < 0.5); if (i >= 0) decor.splice(i, 1); }
// one of two rubble heaps that closed a pocket behind the pillar on Q (probe_collision: the hero backing out of it moved 0.2 m in a second)
{ const i = decor.findIndex((d) => /rubble/.test(d.glb) && Math.hypot(d.pos[0] - 2.25, d.pos[2] - 89.79) < 0.5); if (i >= 0) decor.splice(i, 1); } // U19: the pillar (the Name's shrine) left Q; the heap may already be cleared off the way to n1
const offLine = (d, pts) => pts.slice(1).every((b, i) => { const a = pts[i], vx = b[0] - a[0], vz = b.at(-1) - a.at(-1), u = Math.max(0, Math.min(1, ((d.pos[0] - a[0]) * vx + (d.pos[2] - a.at(-1)) * vz) / (vx * vx + vz * vz || 1))); return Math.hypot(a[0] + vx * u - d.pos[0], a.at(-1) + vz * u - d.pos[2]) > 1.9; });
decor.splice(0, decor.length, ...decor.filter((d) => [[spotQ, shN.route[0], [Q.x, rimFar(Q) - 1.2]], [[G1.x, G1.z], shA.route[0], [G1.x, rimFar(G1) - 1.2]]].every((pts) => offLine(d, pts)))); // U19: clear along the ways to the shrines' side islands
const inst = K.scatter(world, play, rocks, (x, z) => props.every((p) => Math.hypot(x - p.pos[0], z - p.pos[2]) > 0.55) && decor.every((p) => Math.hypot(x - p.pos[0], z - p.pos[2]) > 0.8 * p.scale) && Math.hypot(x - goalPos[0], z - goalPos[2]) > 1.6);
const collider = K.colliderBase(play, props, decor);
K.pieces(world, collider, slabs, 0.6, 0);
K.pieces(world, collider, corr, 0.6, 10);
const wall1 = K.wall(world, collider, { name: 'mech_wall_q', x: slabs[1].x, y: slabs[1].top, z: wallZ, w: 2.2, h: 2.2, d: 0.5 });
K.pieces(world, collider, [lift], 0.7, 20);
K.pieces(world, collider, gcr, 0.5, 30);
K.slabMesh(world, collider, 'arrive__stone', arrive, 0.7, 70); // the wind road's pier (as on l1's goal terrace): one draw, walkable
K.markers(world, SPAWN, goalPos);

// ---------- feasibility ----------
K.gapChain([['bel', 'bh1'], ['bh1', 'bh2'], ['bh2', 'start'], ['start', 'h1'], ['h1', 'h2'], ['h2', 'U'], ['M', 'N'], ['echo', 'e1'], ['e1', 'N'], ['t3', 'v1'], ['v1', 'hB'], ['hB', 'v2'], ['v2', 'v3'], ['v3', 'hA'], ['W', 'f1'], ['f1', 'f2'], ['f2', 'f3'], ['f3', 'f4'], ['f4', 'hF']]);
K.dashGap('L', 'M', rimGap(L, M), M.y - L.y);
K.windGap('M', 'echo', rimGap(M, E), E.y - M.y, TAIL, 'wind.side (always on)');
for (const [list, a, b] of [[slabs, N, Q], [corr, Q, P]]) {
  K.step(a.id, list[0].name, list[0].top - a.y, rimFar(a) - list[0].z0);
  for (let i = 1; i < list.length; i++) K.step(list[i - 1].name, list[i].name, list[i].top - list[i - 1].top, list[i - 1].z1 - list[i].z0);
  K.step(list.at(-1).name, b.id, b.y - list.at(-1).top, list.at(-1).z1 - rimNear(b));
}
K.step('t3', lift.name, 0, rimFar(T3) - lift.z0);
K.step(`${lift.name}@top`, 'S', 0, lift.z1 - rimNear(S));
const exitFeet = wUp.max[1] - 0.5;
if (exitFeet < L.y - TUNING.stepUp + 0.2 || LIFT <= TUNING.gravity) throw new Error('updraft does not clear the ledge');
for (const t of tw) if (t.box.max[1] - 0.5 < t.hi.y - TUNING.stepUp + 0.2) throw new Error(`tower updraft ${t.hi.id} does not clear its rim`);
if (CYCLE[0] < 4 / 5 + 0.6) throw new Error('tower updraft on-time shorter than the 4 m ride');
if (rimGap(Q, P) <= jumpReach(0) || CROSS <= TUNING.run || LIFTUP <= TUNING.jumpHeight) throw new Error('corridor / lift is not a puzzle');
K.blocked.push({ from: 'U', to: 'L', rise: LEDGE, jumpHeight: TUNING.jumpHeight, needs: 'wind.up' });
K.blocked.push({ from: 'N', to: 'Q', wall: wall1.size, needs: 'broken.wallQ (strike or dash)' });
K.blocked.push({ from: 'Q', to: 'P', crosswind: CROSS, run: TUNING.run, lanes: 3, needs: 'not wind.lane* (totemQ) or a dash across each lane' });
for (const t of tw) K.blocked.push({ from: t.lo.id, to: t.hi.id, rise: 4, needs: `wind.up_${t.hi.id} (cycle ${CYCLE.join('/')})` });
K.blocked.push({ from: 't3', to: 'S', rise: LIFTUP, needs: 'switch.seqB (lift; rune A then rune B, hidden east of t3)' });
K.dashGap('S', 'G1', rimGap(S, G1), G1.y - S.y, 2);
K.gapChain([['Q', 'n1'], ['G1', 'a1']]); K.dashGap('n1', 'NS', rimGap(I.n1, I.NS), 0.3); K.dashGap('a1', 'AS', rimGap(I.a1, I.AS), 0.3); // U19: the shrines' side islands
K.blocked.push({ from: 'S', to: 'G1', crosswind: CROSS, lane: GUST.lane, needs: 'two air dashes (gift.airdash) across wind.gust' });
K.gap('G1', gcr[0].name, gcr[0].z0 - rimFar(G1), gcr[0].top - G1.y);
for (let i = 1; i < CRU.n; i++) K.gap(gcr[i - 1].name, gcr[i].name, gcr[i].z0 - gcr[i - 1].z1, gcr[i].top - gcr[i - 1].top);
K.dashGap(gcr[CRU.n - 1].name, 'G2', rimNear(G2) - gcr[CRU.n - 1].z1, G2.y - gcr[CRU.n - 1].top, 2);
K.updraftDash('G2', 'W', rimNear(W) - wUpV.max[2], updraftFlight(2), updraftFlight(1));
K.blocked.push({ from: 'G2', to: 'W', rise: UPV.rise, needs: `wind.upV (cycle ${UPV.cycle.join('/')}) + two air dashes` });
K.windGap('W', 'X', rimGap(W, X), X.y - W.y, TAIL, 'wind.tailX flipped by totemW (hidden west of W; starts as a headwind; fills breath)');
K.dashGap('X', 'Z', rimGap(X, Z), Z.y - X.y, 2);

// ---------- level.json ----------
K.checkRoute(route, [...slabs, ...corr, lift, ...gcr], props.concat(decor));
const box = (b) => ({ kind: 'box', min: r2v(b.min), max: r2v(b.max) });
const WIND_CAIRNS = ['c_L', 'c_N', 'c_NS', 'c_S', 'c_G1', 'c_AS', 'c_G2']; // checkpoints with a wind spring (level.js swirl, player.js refill); plain ones keep the breath you came with (kit breath budget)
const cp = (id, p, look) => ({ id, pos: r2v(p), r: 2.2, heading: facing(p, look), ...(WIND_CAIRNS.includes(id) && { wind: true }) });
const level = {
  id: 'l2', title: 'Wind Totems', next: 'l3', seed: SEED,
  spawn: { pos: SPAWN, heading: facing(SPAWN, at('h1')) },
  goal: { kind: 'circle', pos: goalPos.map(r2), r: 1.3 },
  killY: -14,
  // lavender-grey, uneasy, the air almost still; the breeze comes back in steps: part way with the Kestrel freed, fully at the totem (world.js)
  mood: { sky: { top: '#ebe6ee', horizon: '#e4dee8', haze: '#d8ccd8', sunGlow: '#e9d8c4', sunDisc: '#f6efe2', cloudLit: '#eee6e6', cloudShade: '#cfc6d4' },
    sun: [[-0.5, 0.1, 1], [-0.5, 0.16, 1]], fog: { color: '#e6dfe8', near: 30, far: [230, 300] }, hemi: { sky: '#e2e3ee', ground: '#a19caf', i: 2.25 },
    light: { color: '#f2dcc6', i: 1.2, y: 4.5 }, breeze: 0.12, breezeFree: 1, breezeAfter: 'npc.kestrel.free' },
  beacon: { pos: beacon },
  falls,
  sky: K.skyCastles({ x: S.x / 2, z: S.z / 2 }, [['assets/sky/castle2.png', 30, 360, 46, 180], ['assets/sky/castle1.png', -100, 340, 33, 157], ['assets/sky/castle1.png', 150, 380, 39, 165]]),
  props: props.filter((p) => p.glb !== PILLAR || p.id.startsWith('song_')).map((p) => ({ ...p, pos: p.pos.map(r2), rotY: +p.rotY.toFixed(4) })),
  mechanisms: [
    { id: 'up', kind: 'wind', area: box(wUp), force: [0, LIFT, 0] },
    { id: 'side', kind: 'wind', area: box(wSide), force: [TAIL, 0, 0] },
    { id: 'wallQ', kind: 'breakable', ...wall1 },
    ...lanes.map((b, i) => ({ id: `lane${i}`, kind: 'wind', area: box(b), force: [CROSS, 0, 0] })),
    { id: 'song_name', kind: 'switch', node: 'song_name', pos: songName.pos.map(r2), r: 2.2, targets: [], once: true, gift: 'name' }, // U18: sung to, they give their song (level.js)
    { id: 'song_anchor', kind: 'switch', node: 'song_anchor', pos: songAnchor.pos.map(r2), r: 2.2, targets: [], once: true, gift: 'anchor' },
    { id: 'totemQ', kind: 'switch', node: 'totemQ', pos: totemQ.pos.map(r2), r: 2.2, targets: lanes.map((_, i) => `lane${i}`), toggle: 'onoff', once: false },
    ...tw.map((t) => ({ id: `up_${t.hi.id}`, kind: 'wind', area: box(t.box), force: [0, LIFT, 0], cycle: CYCLE })),
    ...anchors.map((a) => ({ id: a.id, kind: 'switch', node: a.id, pos: a.pos.map(r2), r: 2.0, targets: [], once: true })),
    { id: 'kestrelUp', kind: 'wind', area: box(kUp), force: [0, LIFT, 0], active: false, after: 'npc.kestrel.free' },
    { id: 'seqA', kind: 'switch', node: 'seqA', pos: seqA.pos.map(r2), r: 3.2, targets: [], once: true, seq: 'lift', order: 1, hidden: true,
      vein: [[liftC[0], T3.y, liftC[1] - 1], [T3.x + 2.5, T3.y, T3.z], at('v1'), at('hB'), at('v2'), at('v3'), at('hA'), seqA.pos].map(r2v) },
    { id: 'seqB', kind: 'switch', node: 'seqB', pos: seqB.pos.map(r2), r: 3.2, targets: ['lift'], once: true, seq: 'lift', order: 2, hidden: true,
      vein: [[liftC[0] + 0.6, T3.y, liftC[1] - 1], [T3.x + 3, T3.y, T3.z + 0.6], at('v1'), [hB.x - 0.4, hB.y, hB.z], seqB.pos].map(r2v) },
    { id: 'lift', kind: 'platform', node: lift.name, path: [[0, 0, 0], [0, LIFTUP, 0]], mode: 'ride', period: 5, idle: true }, // U14: on demand (level.js rideStep): 2.5 s up, home 2 s after the hero leaves
    { id: 'shrine', kind: 'switch', pos: r2v([shrine.pos[0], S.y + 0.9, shrine.pos[2]]), r: 2.2, targets: [], once: true },
    { id: 'gust', kind: 'wind', area: box(wGust), force: [CROSS, 0, 0] },
    ...gcr.map((p, i) => ({ id: `gcrumble${i}`, kind: 'crumble', node: p.name, delay: CRU.delay, respawn: 3, group: 'gcr' })), // the Anchor [3] holds the row
    { id: 'runeN', kind: 'switch', node: 'runeN', pos: runeN.pos.map(r2), r: 2.0, targets: [], once: true, far: true }, // out of reach: the Name song wakes it (and its breath)
    { id: 'upV', kind: 'wind', area: box(wUpV), force: [0, LIFT, 0], cycle: UPV.cycle },
    { id: 'tailX', kind: 'wind', area: box(wTailX), force: [0, 0, -TAIL] }, // a headwind until totemW flips it
    { id: 'totemW', kind: 'switch', node: 'totemW', pos: totemW.pos.map(r2), r: 2.2, targets: ['tailX', 'upV'], toggle: 'flip', once: false, hidden: true, // help here, hinder there: the updraft behind dies
      vein: [[X.x, X.y, rimNear(X) + 0.8], [W.x, W.y, W.z + 1], [W.x - 3, W.y, W.z], at('f1'), at('f2'), at('f3'), at('f4'), at('hF'), totemW.pos].map(r2v) },
    { id: 'exitUp', kind: 'wind', area: box(wExit), force: [0, LIFT, 0], active: false, after: 'npc.kestrel.free' }, // the Kestrel's wind home, off Z's rim
  ],
  triggers: [
    { id: 't_up', shape: { kind: 'poly', pts: poly(U.x - 6, U.z - 6, U.x + 6, U.z - 2) }, teaches: 'updraft', ifFlag: null, once: true },
    { id: 't_lanes', shape: { kind: 'poly', pts: poly(N.x - 5, rimFar(N) - 5, N.x + 5, rimFar(N) - 1) }, teaches: 'lanes', ifFlag: null, once: true },
    { id: 't_shrine', shape: { kind: 'poly', pts: poly(shrine.pos[0] - 3.5, shrine.pos[2] - 3.5, shrine.pos[0] + 3.5, shrine.pos[2] + 3.5) }, ifFlag: 'switch.shrine', once: true,
      hint: { en: 'Carved on the shrine: "The wind remembers every name we gave it."', ru: 'Вырезано на святилище: «Ветер помнит каждое имя, что мы ему дали».' } },
    { id: 't_gust', shape: { kind: 'poly', pts: poly(S.x - 5, rimFar(S) - 5, S.x + 5, rimFar(S)) }, teaches: 'airdash2', ifFlag: null, once: true },
    { id: 't_anchor', shape: { kind: 'poly', pts: poly(G1.x - 3, rimFar(G1) - 3, G1.x + 3, rimFar(G1)) }, ifFlag: 'gift.anchor', once: true },
    { id: 't_upV', shape: { kind: 'poly', pts: poly(G2.x - 4, rimFar(G2) - 4, G2.x + 4, rimFar(G2)) }, teaches: 'updraftDash', ifFlag: null, once: true },
    { id: 't_lift', shape: { kind: 'poly', pts: poly(T3.x - 4, T3.z - 4, T3.x + 4, T3.z + 1) }, ifFlag: null, once: true },
    { id: 't_flip', shape: { kind: 'poly', pts: poly(W.x - 4, rimNear(W) - 1, W.x + 4, W.z - 1) }, ifFlag: null, once: true },
    { id: 't_tailX', shape: { kind: 'poly', pts: poly(W.x - 4, W.z - 3, W.x + 4, W.z + 1) }, teaches: 'windRoute', ifFlag: null, once: true },
    { id: 't_tower', shape: { kind: 'poly', pts: poly(P.x - 5, P.z - 4, P.x + 5, P.z + 1) }, teaches: 'cycle', ifFlag: null, once: true },
  ],
  checkpoints: [
    cp('c_U', [U.x, U.y, U.z - 2], at('L')),
    cp('c_L', [L.x, L.y, L.z], at('M')),
    cp('c_N', [N.x, N.y, N.z], [N.x, 0, wallZ]),
    cp('c_Q', [Q.x - 1.2, Q.y, Q.z - 1], [Q.x, 0, rimFar(Q)]),
    cp('c_NS', shN.cp, songName.pos), // U19: the shrines' islands: breath for the dash back
    cp('c_AS', shA.cp, songAnchor.pos),
    cp('c_P', [P.x, P.y, P.z], at('t1')),
    cp('c_t2', at('t2'), at('t3')),
    cp('c_t3', [T3.x, T3.y, T3.z - 0.5], [liftC[0], 0, liftC[1]]),
    cp('c_lift', [T3.x - 1, T3.y, rimFar(T3) - 2], [liftC[0], 0, liftC[1]]), // back from the hidden runes: the detour and the lift wait get a leg each
    cp('c_S', [S.x, S.y, rimFar(S) - 3], at('G1')),
    cp('c_G1', at('G1'), [gcr[0].x, 0, gcr[0].z1]),
    cp('c_G2', at('G2'), at('W')),
    cp('c_W', [W.x, W.y, W.z - 0.5], at('X')),
    cp('c_hF', [hF.x, hF.y, hF.z], at('f4')), // the hidden totem's island: the detour gets its own leg
  ],
  route,
  enemies: [ // R3 Knot Shards (enemies.js): two Squalls at the crosswind lanes (gust: startGifts), a Warden on the summit S (after gift.name)
    { id: 'sqQ', kind: 'squall', pos: r2v([Q.x + 0.5, Q.y, laneZ[0]]), r: 4.5, motif: 'SL', demo: { flag: 'gift.name', song: 'name', r: 6 } }, // U18: the Name's first use, after its shrine on Q: the shard hangs open once under the Name's glyph, the hero's own Name frees it
    { id: 'sqP', kind: 'squall', pos: r2v([P.x + 2, P.y, rimNear(P) + 2]), r: 4.5, motif: 'LS' },
    { id: 'plP', kind: 'squall', variant: 'pull', pos: r2v([P.x - 2.5, P.y, P.z + 1]), aggro: 4.5, motif: 'SLS' }, // the first pull squall, inland on wide P (its drag only brings the hero in): Anchor against the inhale, then Name it
    { id: 'wdS', kind: 'warden', pos: r2v([S.x, S.y, S.z + 1]), path: [[S.x - 3, S.z + 1], [S.x + 3, S.z + 1]].map((q) => q.map(r2)), motif: 'SLS' },
  ],
  actions: [
    { at: [-15, -6], r: 1, do: 'go', drop: true, profiles: ['worst'] }, // worst: walks off the start island into the void first
    { at: [-6, -4], r: 0.8, do: 'song', song: 'gust', face: [-12, -4], profiles: ['worst'] }, // worst: a Gust into empty air (wasted)
    { at: [L.x, r2(rimFar(L) - 0.6)], r: 0.8, do: 'dash', air: true },
    { at: [M.x + 1.5, rimNear(M) + 1.5].map(r2), y: M.y, r: 0.5, do: 'wait', until: 'echo.echo_dash', home: 3 }, // echo detour
    { at: [M.x + 1, M.z].map(r2), r: 0.8, do: 'go', profiles: ['best'] }, // into the wind lane (it starts at x = M.x + 1.8)
    ...['echo', 'e1', 'N'].map((k) => ({ at: [I[k].x, I[k].z].map(r2), r: 1, do: 'go', leap: k === 'echo', profiles: ['best'] })), // best: leap into the side tailwind to the branch echo, two hops back to N
    { at: [N.x, r2(wallZ - 1.6)], r: 0.6, do: 'dash' },
    ...anchors.slice().reverse().map((a) => ({ at: a.spot.map(r2), r: 0.6, do: 'sing', switch: a.id, until: `switch.${a.id}` })),
    { at: spotQ.map(r2), r: 0.6, do: 'sing', switch: 'totemQ', until: 'switch.totemQ' },
    { at: (([x, , z]) => [x, z])(toward(I.n1, I.NS, 0.6)).map(r2), r: 1.2, do: 'dash', air: true }, // U19: off Q to the Name's shrine island (a hop, two bursts), before the lane Squall
    { at: nameSpot.map(r2), r: 0.6, do: 'sing', switch: 'song_name', until: 'switch.song_name' },
    { at: (([x, , z]) => [x, z])(toward(I.NS, I.n1, 0.6)).map(r2), r: 1.2, do: 'dash', air: true },
    { at: [Q.x - 2, Q.z + 1.5].map(r2), y: Q.y, r: 0.5, do: 'wait', until: 'echo.echo_wall', home: 4 }, // echo detour
    { at: [Q.x, rimFar(Q) - 1.2].map(r2), y: Q.y, r: 1, do: 'fight', enemy: 'sqQ' }, // R3: Gust the lane Squall on its telegraph from Q's rim, Name it
    { at: [P.x, rimNear(P) + 1.5].map(r2), y: P.y, r: 1.2, do: 'fight', enemy: 'sqP' }, // ...and its twin at the lanes' far end
    { at: [P.x, P.z - 0.5].map(r2), y: P.y, r: 5, do: 'fight', enemy: 'plP' }, // the pull squall: Anchor as it inhales (worst: swallowed once first), Name it
    { at: spotB.map(r2), r: 0.6, do: 'sing', switch: 'seqB', profiles: ['worst'] }, // worst: the near rune first: still bound, its whirl shoves back (U12)
    { at: spotA.map(r2), r: 0.6, do: 'sing', switch: 'seqA', until: 'switch.seqA' }, // the far rune first...
    { at: spotB.map(r2), r: 0.6, do: 'sing', switch: 'seqB', until: 'switch.seqB' }, // ...then the near one wakes the lift
    { at: [T3.x - 1, rimFar(T3) - 2].map(r2), y: T3.y, r: 0.6, do: 'wait', until: 'bottom.lift' }, // board it down
    { at: liftC.map(r2), r: 0.6, do: 'wait', until: 'top.lift', ride: true, home: 4 },
    { at: [S.x, S.z - 1.5].map(r2), y: S.y, r: 2, do: 'fight', enemy: 'wdS' }, // R3: the Warden on the summit: three hits, then Name
    { at: [shrine.pos[0] + 1.2, shrine.pos[2]].map(r2), y: S.y, r: 0.5, do: 'wait', until: 'echo.echo_shrine', home: 6.5 }, // echo detour
    { at: [S.x, r2(rimFar(S) - 0.6)], r: 0.8, do: 'dash', air: 2 },
    { at: (([x, , z]) => [x, z])(toward(I.a1, I.AS, 0.6)).map(r2), r: 1.2, do: 'dash', air: true }, // U19: off G1 to the Anchor's shrine island, before the crumble row
    { at: anchorSpot.map(r2), r: 0.6, do: 'sing', switch: 'song_anchor', until: 'switch.song_anchor' },
    { at: (([x, , z]) => [x, z])(toward(I.AS, I.a1, 0.6)).map(r2), r: 1.2, do: 'dash', air: true },
    { at: spotG.map(r2), y: G1.y, r: 0.6, do: 'song', song: 'anchor', face: [gcr[1].x, (gcr[1].z0 + gcr[1].z1) / 2].map(r2), profiles: ['mid', 'best'] }, // hold the crumble row...
    { at: spotG.map(r2), y: G1.y, r: 0.6, do: 'song', song: 'name', face: [Far.x, Far.z].map(r2), profiles: ['mid', 'best'] }, // ...and Name the far rune: its breath pays the Anchor back
    { at: [gcr[CRU.n - 1].x, (gcr[CRU.n - 1].z0 + gcr[CRU.n - 1].z1) / 2].map(r2), r: 1.4, do: 'dash', air: 2 },
    { at: [G2.x, r2(rimFar(G2) - 1.4)], y: G2.y, r: 0.5, do: 'wait', wind: 'upV', lead: 0.3 },
    { at: [G2.x, r2((vz0 + vz1) / 2)], r: 6, do: 'dash', air: 2, minY: r2(W.y + 0.5) },
    { at: [W.x + 7, W.z].map(r2), r: 1, do: 'go', drop: true, profiles: ['worst'] }, // worst: wanders off W's east rim (respawn at c_W)
    { at: spotF.map(r2), r: 0.6, do: 'sing', switch: 'totemW', until: 'switch.totemW' }, // flip the headwind
    { at: [X.x, r2(rimFar(X) - 0.9)], r: 0.8, do: 'dash', air: 2 },
  ],
  echoSlots: [
    { id: 'echo_branch', pos: r2v(at('echo')), note: 'branch: side tailwind from M, two hops back to N' },
    { id: 'echo_wall', pos: r2v([Q.x - 2, Q.y, Q.z + 1.5]), note: 'behind the cracked wall, by the lane totem' },
    { id: 'echo_dash', pos: r2v([M.x + 1.5, M.y, rimNear(M) + 1.5]), note: 'landing of the L -> M air dash' },
    { id: 'echo_shrine', pos: r2v([shrine.pos[0] + 1.2, S.y, shrine.pos[2]]), note: 'by the summit shrine' },
  ],
  startGifts: ['dash', 'gust'], // Kamen's (l1)
  gifts: [{ id: 'airdash', at: r2v([anchors[0].spot[0], Q.y, anchors[0].spot[1]]), npc: 'kestrel' }, { id: 'windbreath', at: r2v([spotQ[0], Q.y, spotQ[1]]), npc: 'sigh' }, { id: 'name', at: r2v([nameSpot[0], I.NS.y, nameSpot[1]]), shrine: 'song_name', via: ['n1', 'NS'] }, { id: 'anchor', at: r2v([anchorSpot[0], I.AS.y, anchorSpot[1]]), shrine: 'song_anchor', via: ['a1', 'AS'] }], // kit giftOrder / breathBudget
  npcSlots: [{ id: 'kestrel', pos: r2v(kBird), note: 'kestrel tethered to two anchor stones behind the cracked wall (route: N -> wall -> Q)' }],
  npcs: [
    { id: 'sigh', kind: 'wisp', name: { en: 'Sigh', ru: 'Вздох' }, voice: 'wisp', pos: r2v([totemQ.pos[0], Q.y + 1.9, totemQ.pos[2]]), switches: ['totemQ'], show: 'npc.sigh.free', found: 'sigh_found', talk: [
      { id: 'sigh_free', on: 'npc.sigh.1', set: ['npc.sigh.free', 'gift.windbreath'], lines: [
        { en: 'Ah... air! Take my breath: winds and runes will fill you.', ru: 'Ах... воздух! Возьми моё дыхание: ветра и руны наполнят тебя.', gift: true }, // U16: two short lines (~6 s); the flavour is sigh_tale / sigh_knew, further up the road
        { en: 'Fly from wind to wind now. I will not hold you.', ru: 'Лети теперь от ветра к ветру. Я тебя не держу.' }, // U18: one gift per moment; the Name waits at its shrine on Q
      ] },
      { id: 'sigh_tale', lines: [
        { en: 'The Keepers bound me in that totem to turn the winds. Follow me: I show what the path does not.', ru: 'Хранители заперли меня в тотеме, чтобы я поворачивал ветра. Следуй за мной: я покажу то, чего не покажет тропа.' },
      ] },
      { id: 'sigh_knew', lines: [{ en: 'You sang it as if you knew me. Maybe you did, once.', ru: 'Ты спел так, будто знал меня. Может, когда-то и знал.' }] },
      { id: 'sigh_found', once: false, lines: [
        { en: 'Hee! You found what they hid. Remembering is waking, even for wind.', ru: 'Хи! Ты нашёл то, что они спрятали. Вспомнить значит проснуться, даже ветру.' },
      ] },
    ] },
    { id: 'kestrel', kind: 'kestrel', name: { en: 'Tied Kestrel', ru: 'Привязанная Пустельга' }, voice: 'kestrel', pos: r2v(kBird), rotY: -1.2, switches: anchors.map((a) => a.id), free: 'npc.kestrel.free', lure: true,
      bark: { talk: 'kestrel_call', r: 8, until: 'npc.kestrel.free', every: 15 },
      rise: r2v([(kUp.min[0] + kUp.max[0]) / 2, Q.y, (kUp.min[2] + kUp.max[2]) / 2]), talk: [
      { id: 'kestrel_call', once: false, lines: [
        { en: 'Kree! Two cords, two stones... sing to the stones, wanderer!', ru: 'Кри! Два шнура, два камня... спой камням, странник!' },
      ] },
      { id: 'kestrel_1', on: 'npc.kestrel.1', lines: [{ en: 'Kree! One! The other one, quick!', ru: 'Кри! Один! Теперь второй, скорее!' }] },
      { id: 'kestrel_cut', on: 'npc.kestrel.2', set: ['npc.kestrel.free', 'gift.airdash'], lines: [
        { en: 'Kree! Free! Take my wings: push off twice in the air.', ru: 'Кри! Свобода! Прими крылья: в воздухе оттолкнись дважды.', gift: true }, // U16: two short lines; the flavour is kestrel_tale, further up the road
        { en: 'Kree! Up, up, as high as the wind goes!', ru: 'Кри! Вверх, вверх, до самого ветра!' }, // U18: one gift per moment; the Anchor waits at its shrine on G1
      ] },
      { id: 'kestrel_tale', lines: [{ en: 'Kree... Orren\'s knots. He tied everything he loved so it could not leave.', ru: 'Кри... Узлы Оррена. Он привязывал всё, что любил, чтобы оно не ушло.' }] },
    ] },
  ],
  shots: [
    { name: 'vista', pos: r2v([N.x - 22, N.y + 16, N.z - 8]), look: r2v([P.x, P.y + 6, P.z]) },
    { name: 'shrine_name', pos: r2v([shN.cp[0], I.NS.y + 2.6, shN.cp[2]]), look: r2v([shN.stone.pos[0], I.NS.y + 2.2, shN.stone.pos[2]]) },
    { name: 'shrine_name_sung', pos: r2v([shN.cp[0], I.NS.y + 2.6, shN.cp[2]]), look: r2v([shN.stone.pos[0], I.NS.y + 2.2, shN.stone.pos[2]]), fire: ['song_name'] },
    { name: 'shrine_anchor', pos: r2v([shA.cp[0], I.AS.y + 2.6, shA.cp[2]]), look: r2v([shA.stone.pos[0], I.AS.y + 2.2, shA.stone.pos[2]]) },
    { name: 'shrine_anchor_sung', pos: r2v([shA.cp[0], I.AS.y + 2.6, shA.cp[2]]), look: r2v([shA.stone.pos[0], I.AS.y + 2.2, shA.stone.pos[2]]), fire: ['song_anchor'] },
    { name: 'updraft', pos: r2v([U.x + 9, U.y + 5.5, rimNear(L) - 8]), look: r2v([U.x, U.y + 2.2, rimNear(L) - 0.5]) },
    { name: 'wall', pos: r2v([N.x + 3, N.y + 2, wallZ - 4]), look: r2v([N.x, N.y + 1, wallZ]) },
    { name: 'lanes', pos: r2v([Q.x - 7, Q.y + 4, rimFar(Q) - 3]), look: r2v([Q.x + 1, Q.y, (rimFar(Q) + rimNear(P)) / 2]) },
    { name: 'tower', pos: r2v([P.x - 16, P.y + 9, I.t2.z]), look: r2v([I.t2.x, I.t2.y, I.t2.z]) },
    { name: 'fork', pos: r2v([(M.x + E.x) / 2, M.y + 22, M.z + 1]), look: r2v([(M.x + E.x) / 2, M.y, M.z + 1.5]) },
    { name: 'gust', pos: r2v([S.x - 12, S.y + 5, (rimFar(S) + rimNear(G1)) / 2 - 2]), look: r2v([S.x, G1.y, (rimFar(S) + rimNear(G1)) / 2 + 1]) },
    { name: 'crumble', pos: r2v([G1.x + 9, G1.y + 4, rimFar(G1) + 3]), look: r2v([G1.x, G1.y, rimFar(G1) + 7]) },
    { name: 'updraft2', pos: r2v([G2.x - 11, G2.y + 4, vz1]), look: r2v([G2.x, W.y, (vz1 + rimNear(W)) / 2]) },
    { name: 'windroute', pos: r2v([W.x + 10, W.y + 6, W.z - 4]), look: r2v([X.x, X.y, rimFar(X) + 3]) },
    { name: 'vein_lift', pos: r2v([T3.x - 6, T3.y + 9, T3.z - 6]), look: r2v([hB.x, hB.y, hB.z]) },
    { name: 'hidden_seq', pos: r2v([hB.x - 4, hB.y + 3, hB.z - 5]), look: r2v([(hA.x + hB.x) / 2, hA.y + 0.6, (hA.z + hB.z) / 2]) },
    { name: 'vein_flip', pos: r2v([W.x + 6, W.y + 8, W.z - 6]), look: r2v([hF.x, hF.y, hF.z]) },
    { name: 'hidden_flip', pos: r2v([hF.x + 5, hF.y + 2.5, hF.z - 3]), look: r2v([totemW.pos[0], hF.y + 0.8, totemW.pos[2]]) },
    { name: 'goal', pos: r2v([Z.x - 8, Z.y + 5.5, Z.z - 7]), look: r2v([goalPos[0], Z.y + 0.8, goalPos[2]]) },
    { name: 'onward', pos: r2v([goalPos[0] - eX * 4.5, goalPos[1] + 2.2, goalPos[2] - eZ * 4.5]), look: r2v([goalPos[0] + eX * 20, goalPos[1] + 3, goalPos[2] + eZ * 20]) }, // the play camera at the goal: the Crown ahead
    { name: 'arrival', pos: r2v([SPAWN[0] - bX * 4.5, 2.2, SPAWN[2] - bZ * 4.5]), look: r2v([SPAWN[0] + bX * 20, 0, SPAWN[2] + bZ * 20]) }, // the play camera turned round at the start: the bridge end, the quarry behind
  ],
  cutscenes: { // cutscene.js
    arrive: { // the wind road from the quarry: the workshop grows ahead, the hero comes down along the road; control returns in the last glide
      // over the spawn (cutscene.js play keys + 'player.place'): he lands himself, the road fades
      dur: 7,
      keys: [
        { at: 0, pos: r2v(inAt(62, 12.5, 3)), look: r2v(inAt(40, 7.5)) }, // behind and above him on the road: the island ahead, small
        { at: 3.4, pos: r2v(inAt(33, 9, 3.5)), look: r2v(inAt(14, 3.5)) },
        { at: 5.8, play: 1 }, { at: 7, play: 1 }, // the play camera's own pose on him (cutscene.js playPose): no jump at the hand-off
      ],
      lines: [
        { at: 0.8, dur: 5, text: { en: 'Orren\'s workshop. Here the winds were bound to totems.', ru: 'Мастерская Оррена. Здесь ветры привязали к тотемам.' } },
      ],
      events: [
        { at: 0, duck: { db: -6, seconds: 7 } },
        { at: 0.2, cue: 'wind', gain: 0.8 },
      ],
      ribbon: { at: -6, grow: 1, fade: [4.6, 7], pts: [[bX * 84, -4, bZ * 84], inAt(52, 9), inAt(24, 6.5), inAt(9, 3.2), inAt(1, 1.3), inAt(-7, 1.6)].map(r2v) },
      hero: { path: [ // one flight at cruise speed; it ends HAND_D m short of the spawn, 1.4 m up: the player's fall from there touches down on it
        { at: 0, pos: r2v(inAt(52, 9)), heading: SH, clip: 'glide' },
        { at: 3, pos: r2v(inAt(24, 6.5)), heading: SH, clip: 'glide' },
        { at: 5, pos: r2v(inAt(9, 3.2)), heading: SH, clip: 'glide' },
        { at: 7, pos: r2v(inAt(HAND_D, 1.4)), heading: SH },
      ] },
    },
    outro: { // the freed winds braid into the road to the Crown: the Kestrel calls from it, its updraft lifts the hero off Z's rim and he rides after the bird
      dur: 12,
      keys: [
        { at: 0, shot: 'goal', ease: 1 },
        { at: 3.6, pos: r2v([goalPos[0] - eX * 6 + eZ * 3, goalPos[1] + 2.4, goalPos[2] - eZ * 6 - eX * 3]), look: r2v(exitP(rimE + 2, 3)), ease: 1 },
        { at: 6.6, pos: r2v([goalPos[0] - eX * 2 + eZ * 6, goalPos[1] + 4.6, goalPos[2] - eZ * 2 - eX * 6]), look: r2v(exitP(rimE + 3, 3.5)), ease: 1 }, // side-on at the rim: the crouch and the lift
        { at: 9.2, pos: r2v([goalPos[0] - eX * 3 + eZ * 5.5, goalPos[1] + 7.5, goalPos[2] - eZ * 3 - eX * 5.5]), look: r2v(exitP(rimE + 14, 9.5)), ease: 1 },
        { at: 12, pos: r2v([goalPos[0] - eX * 4 + eZ * 5, goalPos[1] + 10, goalPos[2] - eZ * 4 - eX * 5]), look: r2v(exitP(rimE + 40, 19)) }, // he shrinks after the bird, the Crown's spire beyond on the same heading
      ],
      lines: [
        { at: 0.6, dur: 3.8, text: { en: 'The totems let go. The winds remember the way home.', ru: 'Тотемы отпустили. Ветры помнят дорогу домой.' } },
        { at: 4.6, dur: 4.2, who: { en: 'Kestrel', ru: 'Пустельга' }, voice: 'kestrel', text: { en: 'Kree! All winds lead to the Crown. Ride mine, wanderer!', ru: 'Кррии! Все ветры ведут к Короне. Лети на моём, странник!' } },
      ],
      events: [
        { at: 0, duck: { db: -8, seconds: 12 } },
        { at: 0.3, fire: 'seqB' },
        { at: 0.6, cue: 'wind', gain: 0.8 },
        { at: 1, wind: 'exitUp' },
        { at: 5.5, cue: 'hum', gain: 0.6 },
        { at: 6.2, cue: 'wind', gain: 1 },
      ],
      ribbon: { at: 1.4, grow: 4.5, pts: [exitP(rimE - 1.5, 0.9), exitP(rimE + 1.8, 2.2), exitP(rimE + 9, 7.2), exitP(rimE + 26, 14.4), exitP(rimE + 52, 22), exitP(rimE + 110, 34)].map(r2v) },
      hero: { keep: true, from: 'player', clip: 'land', at: 0.3, pose: [{ at: 0, land: 0 }, { at: 5, land: 0 }, { at: 5.6, land: 0.7 }, { at: 6, land: 0 }], path: [ // the level changes after: the hero stays on the road
        { at: 0, pos: r2v(goalPos), heading: HE },
        { at: 0.9, pos: r2v(goalPos), heading: HE, clip: 'walk' }, // 6.7 m in 3.9 s: a walk (cutscene.js RUN_AT)
        { at: 4.8, pos: r2v(exitP(rimE - 0.5, 0)), heading: HE }, // the rim: he crouches into the updraft (pose above)
        { at: 5.8, pos: r2v(exitP(rimE - 0.5, 0)), heading: HE, clip: 'glide' }, // lifted: one flight after the bird, pace by the key times
        { at: 6.8, pos: r2v(exitP(rimE + 1.8, 2.2)), heading: HE, clip: 'glide' },
        { at: 8.2, pos: r2v(exitP(rimE + 9, 7.2)), heading: HE, clip: 'glide' },
        { at: 10.2, pos: r2v(exitP(rimE + 26, 14.4)), heading: HE, clip: 'glide' },
        { at: 12, pos: r2v(exitP(rimE + 52, 22)), heading: HE },
      ] },
      actors: [{ glb: 'assets/characters/kestrel/kestrel.glb', scale: 2.2, path: [ // the Kestrel swoops in over the hero, calls at the rim, then leads him along the road
        { at: 0.8, pos: r2v(side(exitP(rimE + 16, 10), 7)), clip: 'fly' },
        { at: 3.0, pos: r2v(side(exitP(rimE + 3, 3.5), -2.5)), clip: 'circle' },
        { at: 5.2, pos: r2v(side(exitP(rimE + 1.2, 4.5), 2)), clip: 'fly' },
        { at: 6.8, pos: r2v(side(exitP(rimE + 8, 7.5), 1)), clip: 'fly' },
        { at: 8.2, pos: r2v(side(exitP(rimE + 19, 12.4), 0.8)), clip: 'fly' },
        { at: 10.2, pos: r2v(side(exitP(rimE + 40, 19.5), 0.5)), clip: 'fly' },
        { at: 12, pos: r2v(side(exitP(rimE + 70, 27.5), 0.5)), clip: 'fly' },
      ] }],
    },
  },
  feasibility: K.feasibility(),
};

// ---------- R5: the bell crossing (built in the layout above), R4: shards shattered by worst ----------
{
  const st = I.start, bl = I.bel, x0 = st.x + st.rim(0) - 0.3, by = r2(st.y - 0.8);
  const bells = [x0 + 4.4, x0 + 7.65].map((x, i) => ({ id: `bell${i + 1}`, kind: 'bell', pos: [r2(x), by, r2(st.z)] }));
  level.trials = [...(level.trials ?? []), ...bells];
  for (const id of ['sqQ', 'sqP']) { // worst strikes the stunned squall to pieces instead of Naming it: no updraft from it, the long way round
    const i = level.actions.findIndex((x) => x.do === 'fight' && x.enemy === id);
    level.actions.splice(i, 1, { ...level.actions[i], profiles: ['mid', 'best'] }, { ...level.actions[i], shatter: true, profiles: ['worst'] });
  }
  { // R9: from t2 the hero steps off back down onto P, 8 m (worst lands it: a stagger; mid / best roll), and climbs the tower again
    const k = I.t2, o = I.P, inside = (a, x, z, m) => Math.hypot(x - a.x, z - a.z) < a.rim(Math.atan2(z - a.z, x - a.x)) + m;
    const th = Array.from({ length: 72 }, (_, i) => (i * 5 * Math.PI) / 180).find((t) => { const e = k.rim(t) + 0.8, x = k.x + Math.cos(t) * e, z = k.z + Math.sin(t) * e;
      return inside(o, x, z, -1) && !Object.values(I).some((q) => q !== o && q !== k && q.y > o.y && inside(q, x, z, 0.6)); });
    if (th == null) throw new Error('R9: no clear drop off t2 onto P');
    const e = k.rim(th) + 0.8, fi = level.actions.findLastIndex((x) => x.do === 'fight' && x.enemy === 'plP') + 1;
    level.actions.splice(fi, 0, { at: [k.x, k.z].map(r2), y: r2(k.y), r: 1.5, do: 'go', home: 4 }, { at: [k.x + Math.cos(th) * e, k.z + Math.sin(th) * e].map(r2), y: r2(o.y), r: 1.5, do: 'go', drop: true }, { at: [k.x, k.z].map(r2), y: r2(k.y), r: 1.5, do: 'go', home: 4 }); // done once down on P (re-finds the route there), then climbs back
  }
  const near = [r2(x0 - 2.5), r2(st.z)];
  level.actions.splice(1, 0, // best, first thing: over the bells and back
    { at: near, r: 1, do: 'go', home: 30, profiles: ['best'] },
    { at: near, r: 1.2, do: 'airstrike', face: [r2(bl.x), r2(bl.z)], home: 30, profiles: ['best'] }, // a swing in the air, then the bells
    { at: [r2(x0 + 0.3), r2(st.z)], r: 1.2, do: 'pogo', aim: true, to: [r2(bl.x), r2(bl.z)], home: 30, profiles: ['best'] },
    ...[I.bh1, I.bh2, { x: st.x + st.rim(-0.6) - 2, z: st.z - 3 }].map((h) => ({ at: [h.x, h.z].map(r2), r: 0.8, do: 'go', home: 30, profiles: ['best'] }))); // back by the hops
}

// ---------- R6: locks for a later visit (level select), a shortcut ----------
// lockN: a Name lock off the start's south rim (Name is Sigh's, later in the level): a tale shard, and one of Sigh's breaths caught in
// a stone (her request: sung, it flies home; she sings Name further, song2.name). lockD: a dusty rune off the summit, out of plain
// Gust: Gust II (Kamen's, l1) bares it, Name wakes it: an echo, a tale shard, a cloak thread. Shortcut (U14): a call rune at the lift's head on S: it keeps the lift awake for good (no pair hunt on a later visit) and calls it up.
K.own(1602, () => {
  const R = makeR6(K, { world, collider, level, salt: 1602 }), st = I.start;
  const ln = R.nameLock({ id: 'lockN', from: st, th: -Math.PI / 2, out: 4.3, side: 2.4, up: 2.4, gap: 10.6, rewards: [{ id: 'tale4', relic: 'tale.4' }] });
  const sb = R.requestStone('sigh_breath', ln.islet, -Math.PI / 2, 'sigh');
  const DTH = -2.75; // south-west: clear of the shrine (west) and the lift (south)
  const ld = R.nameLock({ id: 'lockD', from: S, th: DTH, out: 5.4, side: 0, up: 2.8, gap: 10.6, kind: 'gust2', rewards: [{ id: 'echo_dust' }, { id: 'tale3', relic: 'tale.3' }, { id: 'thread_l2', relic: 'thread.l2' }] });
  const sc = R.shortcut({ lift, lower: T3, upper: S, rise: LIFTUP, side: 1, targets: ['lift'], once: false });
  R.finish();
  // the first rune guard (enemies.js): a dark Warden holding the shortcut rune on the wide summit (optional: a safe place to learn it)
  const gd = [sc.prop.pos[0] + 0.2, S.y, sc.prop.pos[2] + 1.7];
   if (decor.some((d) => d.glb === TREE && Math.hypot(d.pos[0] - gd[0], d.pos[2] - gd[2]) < 4.5)) throw new Error('gdS: a tree stands in front of the rune guard');
  level.enemies.push({ id: 'gdS', kind: 'warden', guard: 'sc', pos: r2v(gd), path: [[gd[0], gd[2]], [gd[0], gd[2]]].map((q) => q.map(r2)), motif: 'LSS', ties: [r2v([sc.prop.pos[0], S.y + 0.9, sc.prop.pos[2]])] });
  sc.mechanisms[0].after = 'enemy.gdS.open';
  level.mechanisms.push(...ln.mechanisms, sb.mechanism, ...ld.mechanisms, ...sc.mechanisms);
  level.echoSlots.push(...[...ln.rewards, ...ld.rewards].map(({ relic, ...e }) => ({ ...e, ...(relic && { relic }), note: 'R6 lock reward' })));
  const tb = (id, s, talk, ifFlag, more) => ({ id, shape: { kind: 'poly', pts: poly(s.x - 3, s.z - 3, s.x + 3, s.z + 3) }, talk, ifFlag, once: true, ...more }); // U16: flavour and asks as barks further up the road, not behind the gift
  level.triggers.push(tb('t_sigh_tale', P, 'sigh_tale', 'npc.sigh.free'), tb('t_kestrel_tale', I.t2, 'kestrel_tale', 'npc.kestrel.free'), tb('t_sigh_knew', T3, 'sigh_knew', 'npc.sigh.free'), tb('t_sigh_lost', S, 'sigh_lost', 'npc.sigh.free', { ifNot: 'world.sigh.home' }));
  level.npcs[0].talk.push({ id: 'sigh_lost', lines: [
    { en: 'One of my breaths is still caught... in a stone past the cliff where you woke. Sing it loose, some day?', ru: 'Один мой вздох всё ещё в плену... в камне за обрывом, где ты проснулся. Освободишь его когда-нибудь?' },
  ] }, { id: 'sigh_home', on: 'switch.sigh_breath', lines: [
    { en: 'Hee... it found me. Now my Name carries further: farther runes will hear you.', ru: 'Хи... он нашёл меня. Теперь моё Имя летит дальше: тебя услышат и дальние руны.' },
  ] });
  const v = (pts) => pts.map((p) => p.map(r2));
  const after = (pred, acts) => level.actions.splice(level.actions.findIndex(pred) + 1, 0, ...acts.map((a) => ({ profiles: ['revisit'], ...a })));
  const visit = (lk, back) => [
    ...v([back, ...lk.via]).map((p) => ({ at: p, r: 0.5, do: 'go' })),
    { at: lk.l.stand, r: 0.5, do: 'go' },
    ...(lk.gust ? [{ at: lk.l.stand, r: 0.6, do: 'song', song: 'gust', face: [lk.l.rune.pos[0], lk.l.rune.pos[2]].map(r2) }] : []),
    { at: lk.l.stand, r: 0.6, do: 'song', song: 'name', face: [lk.l.rune.pos[0], lk.l.rune.pos[2]].map(r2), until: `switch.${lk.id}` },
    { at: lk.l.stand, r: 0.8, do: 'wait', until: `raised.${lk.id}_br` },
    ...v([lk.rimF, lk.rimI, [lk.l.islet.x, lk.l.islet.z]]).map((p) => ({ at: p, r: 0.5, do: 'go' })),
    ...lk.l.rewards.map((e) => ({ at: [e.pos[0], e.pos[2]], r: 0.4, do: 'go' })),
    ...(lk.extra ?? []),
    ...v([lk.rimI, lk.rimF, back]).map((p) => ({ at: p, r: 0.5, do: 'go' })),
  ];
  const lN = { id: 'lockN', l: ln, via: [], rimF: R.standAt(st, -Math.PI / 2, 0.3), rimI: R.standAt(ln.islet, Math.PI / 2, 0.3), extra: [{ at: sb.spot, r: 0.6, do: 'sing', switch: 'sigh_breath', until: 'switch.sigh_breath' }] };
  const lD = { id: 'lockD', l: ld, via: [R.standAt(S, DTH + 0.25, 0.8)], // along the rim to the stand spot: no run-out over it
    gust: true, rimF: R.standAt(S, DTH, 0.3), rimI: R.standAt(ld.islet, DTH + Math.PI, 0.3) };
  level.actions.splice(0, 0, ...visit(lN, [st.x, st.z]).map((a) => ({ profiles: ['revisit'], ...a })));
  after((a) => a.enemy === 'wdS', [{ at: [S.x + 0.95, S.z + 5.05].map(r2), r: 0.6, do: 'wait', until: 'breath', home: 9, profiles: undefined }, { at: [gd[0] - 2.8, gd[2] - 0.3].map(r2), y: S.y, r: 4.6, home: 12, do: 'fight', enemy: 'gdS', profiles: undefined }, { at: sc.spot, r: 0.6, do: 'sing', switch: 'sc', until: 'switch.sc', home: 9, profiles: undefined }]);
  after((a) => a.until === 'echo.echo_shrine', visit(lD, [S.x, S.z]));
  level.shots.push(
    { name: 'lockN', pos: r2v([st.x + 8, st.y + 5, st.z - 4]), look: r2v([ln.rune.pos[0], st.y + 1, ln.rune.pos[2]]) },
    { name: 'lockN_open', pos: r2v([st.x + 8, st.y + 5, st.z - 4]), look: r2v([ln.rune.pos[0], st.y + 1, ln.rune.pos[2]]), fire: ['lockN'] },
    { name: 'lockD', pos: r2v([S.x + 4, S.y + 4.5, S.z + 3]), look: r2v([ld.rune.pos[0], S.y + 1, ld.rune.pos[2]]) },
    { name: 'lockD_open', pos: r2v([S.x + 4, S.y + 4.5, S.z + 3]), look: r2v([ld.rune.pos[0], S.y + 1, ld.rune.pos[2]]), fire: ['lockD'] },
    { name: 'shortcut', pos: r2v([sc.prop.pos[0] + 7, S.y + 4, sc.prop.pos[2] + 5]), look: r2v([lift.x, S.y, sc.prop.pos[2] - 2]) },
    { name: 'shortcut_open', pos: r2v([sc.prop.pos[0] + 7, S.y + 4, sc.prop.pos[2] + 5]), look: r2v([lift.x, S.y, sc.prop.pos[2] - 2]), fire: ['sc'] },
  );
});

await K.write({ world, collider, inst, level, decor: [...decor, ...farDecor, ...props.filter((p) => p.glb === PILLAR && !p.id.startsWith('song_')).map((p) => ({ ...p, scale: p.scale ?? 1 }))] }); // pillars: decor (one draw), collide; the song-shrines stay named props (marks.js carves them)
