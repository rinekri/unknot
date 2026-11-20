// Level l1 "Waking Stones" (0 -> +10 m, ~100 s). Beats:
//   1. dash and breaking: a cracked wall across a narrow slab path (strike it or dash into it), then a 4.8 m dash gap over a
//      safety island (fall = a short climb back, not a death);
//   1b. the trial after the ride (breath 2 now: a cairn before each dash beat), kishotenketsu along +Z from C, on C's level:
//      teach: C -> X1, one dash gap over a safety island (a fall = a climb back to C); test: X1 -> crumble -> dash -> crumble -> X2
//      (0.6 s pads: the dash takes off from a shaking stone and lands on one); twist: X2 -> X3, a dash gap at 0.85 of the dash reach;
//      combine: runeS on X3 raises a timed bridge (HOLDS s) that ends a dash gap short of X4. k1 and all after it follow X4.
//   2. climb (three +0.8 m hops), then an air-dash gap at 0.85 of the dash reach (a cairn on k3 first: the breath is 2 now and
//      only cairns refill it);
//   3. a rune lift +4 m (its rune hidden four hops west of D, a vein leads there), then crumble pads (0.6 s: no standing still);
//   4. crumble + dash (an air dash off a crumbling pad), then a timed rune bridge: rune2 raises a stair bridge over the last
//      chasm for HOLD s, then it sinks (rune2 hides four hops east of G down a vein; sung again after a fall); cross it before it fades to reach the goal terrace.
//   NPC Kamen (npc.js): a sleeping rubble golem lying across B's far rim. Quest "Names": three name-stones (one on A, two on B,
//   behind the cracked wall) light the glyphs on its back; the third wakes it (npc.pebble.awake) and it gives the dash (gift.dash),
//   then ferries across the B -> C gap and back (a platform gated `after` that flag). Before the gift: jump, strike, walls only;
//   every dash beat (B -> C optional, k3 -> D, crumble -> G) comes after it (kit giftOrder).
//   Branch: off the lift island, two hops to an echo island (dead end, back to the same checkpoint).
// Writes ../assets/levels/l1/{level.json,world.glb,collider.glb,placement.json} (canonical; `npm run sync-assets` copies to public/).
// Builders live in tools/lib/kit.mjs (shared with gen_l2/gen_l3). Usage: node tools/gen_l1.mjs   (npm run gen-l1)
import { makeKit, THREE, TUNING, jumpReach, dashReach, RUNE, NAME, PILLAR, ARCH, RUBBLE, STAIRS, TREE, SHRINE, MENHIR, r2, r2v, poly, facing } from './lib/kit.mjs';
import { makeR6 } from './lib/r6.mjs';

const SEED = 1201;
const K = makeKit(SEED, new URL('../../assets/levels/l1/', import.meta.url));
const { rr, isl, island, chain, rimGap, rimFar, rimNear } = K;

// ---------- layout ----------
isl.start = island('start', 0, 0, 0, 11);
chain('hop1', isl.start, 2.8, 30, 0.3, 2.6);
chain('hop2', isl.hop1, 2.8, -15, 0.3, 2.5);
chain('A', isl.hop2, 2.8, 0, 0, 6);
const SLABGAP = 6.0; // A -> B over a narrow slab path, the cracked wall across its middle slab
chain('B', isl.A, SLABGAP, 0, 0, 5.5);
const DGAP = 4.8; // B -> C: > jump reach 4.28, < 0.85 x dash reach
chain('C', isl.B, DGAP, 0, 0, 6);
const I = isl, A = I.A, B = I.B, C = I.C;
// safety island 3 m under the dash gap; three +1 m hops lead back up to B
isl.safe = island('safe', B.x, (rimFar(B) + rimNear(C)) / 2, B.y - 3, 1.9, { depth: 3 });
chain('s1', isl.safe, 2.6, -90, 1.0, 2.2);
chain('s2', isl.s1, 2.6, 200, 1.0, 2.2);
// climb: three +0.8 m hops (low rise: a forgiving window right after the dash gift; 2.5 m rim gap is the noOverlap floor), then an air dash onto D
// the trial (1b): X1..X4 straight on along +Z at C's height; X4 has C's radius, so k1 sits off it as it sat off C
const TGAP = 4.8, QP = { len: 3.0, gap: 1.6, dgap: 5.0, delay: 0.6 }, TWGAP = 0.85 * dashReach(0), BSPAN = 7, NBS = 5, CBGAP = 5.0, HOLDS = 3.5;
chain('X1', C, TGAP, 0, 0, 4.5);
const X1 = I.X1;
isl.safe2 = island('safe2', C.x, (rimFar(C) + rimNear(X1)) / 2, C.y - 3, 1.9, { depth: 3 }); // under the teach gap; two +1 m hops back up to C
chain('s3', isl.safe2, 2.6, -90, 1.0, 2.2);
chain('s4', isl.s3, 2.6, 200, 1.0, 2.2);
const qpads = [rimFar(X1) + QP.gap, rimFar(X1) + QP.gap + QP.len + QP.dgap].map((z0, i) => ({ name: `mech_qcrumble_${i}`, x: X1.x + rr(-0.15, 0.15), z0, z1: z0 + QP.len, w: rr(2.0, 2.3), top: X1.y + [0.04, 0.02][i], rotY: rr(-0.05, 0.05) }));
isl.X2 = island('X2', X1.x, 0, X1.y, 4.5);
isl.X2.z = qpads[1].z1 + QP.gap + isl.X2.rim(-Math.PI / 2);
const X2 = I.X2;
chain('X3', X2, TWGAP, 0, 0, 5);
const X3 = I.X3, bz0 = rimFar(X3) - 0.6, SLS = (BSPAN + 0.05 * (NBS - 1)) / NBS;
const span = Array.from({ length: NBS }, (_, i) => ({ name: `mech_span_${i}`, x: X3.x, z0: bz0 + i * (SLS - 0.05), z1: bz0 + i * (SLS - 0.05) + SLS, w: 1.9, top: X3.y + [0.03, 0.06, 0.04, 0.07, 0.05][i], rotY: 0 }));
isl.X4 = island('X4', X3.x, 0, X3.y, 6);
isl.X4.z = span.at(-1).z1 + CBGAP + isl.X4.rim(-Math.PI / 2);
const X4 = I.X4;
chain('k1', X4, 2.6, 35, 0.8, 2.4);
chain('k2', isl.k1, 2.3, -25, 0.8, 2.7); // 0.3 m wider, same centre: its rims 0.3 m nearer (an early take-off off k1 still lands; 2.3 m < the noOverlap floor, allowed below)
chain('k3', isl.k2, 2.3, 15, 0.8, 2.6); // k3 (and all after it) stays where it was
const AGAP = 5.4; // 0.85 x dash reach (rise 0.3): the first real dash test, a cairn on k3 before it
chain('D', isl.k3, AGAP, 0, 0.3, 7);
const D = I.D, LIFT = 4, PADGAP = 2.0;
isl.E = island('E', D.x, 0, D.y + LIFT, 6, { wallDown: LIFT + 0.8, depth: 5 });
isl.E.z = rimFar(D) + PADGAP + isl.E.rim(-Math.PI / 2);
const E = I.E;
// branch: two hops east of D to the echo island (a dead end: back the same way, to D's checkpoint)
chain('br1', D, 2.8, 90, 0.4, 2.5);
chain('echo', isl.br1, 2.8, 50, 0.3, 3.6);
// crumble row E -> F: three pads, 1.6 m apart
const CR = { gap: 1.6, len: 3.0, n: 3, delay: 0.6 }; // pad length fits a running jump (~4.3 m flight lands ~3.9 m past the take-off rim)
chain('F', E, CR.n * CR.len + (CR.n + 1) * CR.gap, 0, 0, 5);
const F = I.F;
// crumble + dash: one pad past F, then an air dash to G
const pad4 = { z0: rimFar(F) + CR.gap, z1: rimFar(F) + CR.gap + CR.len };
const CDGAP = 5.0;
isl.G = island('G', F.x, 0, F.y + 0.3, 5.5);
isl.G.z = pad4.z1 + CDGAP + isl.G.rim(-Math.PI / 2);
const G = I.G, STEPRISE = 1.8, SPAN = 8.5, HOLD = 12; // timed stair bridge over the last chasm: rim gap m, s held once fully up
isl.goal = island('goal', G.x, 0, G.y + STEPRISE, 8, { wallDown: STEPRISE + 0.8, depth: 4 });
isl.goal.z = rimFar(G) + SPAN + isl.goal.rim(-Math.PI / 2);
const T = I.goal;
// The way on (cutscene-only, no collider): the outro raises a three-stone pier off the goal terrace along HX and the wind road opens
// from its end toward Orren's workshop (l2), whose silhouette stands NEXT_D m out on that heading; the beacon (the Crown) stands a
// little right of it.
const HX = 0.55, NEXT_D = 110, dirX = Math.sin(HX), dirZ = Math.cos(HX), rimX = T.rim(Math.PI / 2 - HX);
const exitSlabs = Array.from({ length: 3 }, (_, i) => {
  const d = rimX - 0.4 + i * 2.6 + 1.1, side = 0.25 * Math.sin(i * 2.1), cx = T.x + dirX * d + dirZ * side, cz = T.z + dirZ * d - dirX * side;
  return { name: `mech_exit_${i}`, x: cx, z0: cz - 1.1, z1: cz + 1.1, w: 1.6, top: T.y + 0.05 + i * 0.22, rotY: HX + 0.05 * Math.sin(i * 1.3) };
});
const exitAt = (i, up = 0) => [T.x + dirX * (rimX - 0.4 + i * 2.6 + 1.1), T.y + 0.05 + i * 0.22 + up, T.z + dirZ * (rimX - 0.4 + i * 2.6 + 1.1)];
const road = (d, up, k = 0) => [T.x + dirX * (rimX + d) - dirZ * k, T.y + up, T.z + dirZ * (rimX + d) + dirX * k]; // the wind road: d m off the rim, up m over the terrace, k m to its right
const nextIsl = { x: T.x + dirX * NEXT_D, z: T.z + dirZ * NEXT_D, y: T.y + 4, R: 18 };
// R7 hidden runes, on their own seeded stream (the play layout keeps its draws): rune1 (the lift) on a ledge four hops up west of D,
// rune2 (the timed stairs) on an island four hops down east of G. Veins run from each target to its rune.
K.own(701, () => {
  chain('w1', D, 2.55, -72, 0.9, 3.1); chain('w2', isl.w1, 2.7, -38, 0.3, 2.0); chain('w3', isl.w2, 2.55, -128, 0.8, 2.8); chain('w4', isl.w3, 2.7, -78, 0.4, 2.2); chain('H1', isl.w4, 2.6, -90, 0.6, 3);
  chain('g1', G, 2.6, 74, -1.0, 3.2); chain('g2', isl.g1, 3.0, 128, -0.3, 2.0); chain('g3', isl.g2, 2.7, 52, -0.9, 2.9); chain('g4', isl.g3, 3.0, 102, -0.2, 2.2); chain('H2', isl.g4, 2.8, 80, -0.6, 4); /* H2: the gust stone's islet, bigger so it reads from G */
});
const H1 = I.H1, H2 = I.H2;
// U19: the Gust's song-shrine stands on its own side island GS, south-west of D (a hop q1, then an air dash): off the route, tall and lit
K.own(719, () => { chain('q1', D, 2.6, -118, 1.0, 2.6); chain('GS', isl.q1, 5.3, -110, 0.3, 4.5); });
const GS = I.GS, toward = (a, b, inset) => { const an = Math.atan2(b.z - a.z, b.x - a.x), r = a.rim(an) - inset; return [a.x + Math.cos(an) * r, a.y, a.z + Math.sin(an) * r]; };
K.noOverlap([['safe2', 'C'], ['safe2', 'X1'], ['s3', 'C'], ['s4', 'C'], ['s3', 'X1'], ['s4', 'X1'], ['safe', 'B'], ['safe', 'C'], ['s2', 'B'], ['s1', 'B'], ['s1', 'C'], ['s2', 'C'], ['D', 'E'], ['G', 'goal'], ['k1', 'k2'], ['k2', 'k3']]);

// Slab path A -> B: 4 slabs ~1.3 m wide; the wall stands across slab 1 (2.2 m wide: no way round, 2.2 m tall: no way over).
const sz0 = rimFar(A) - 0.6, sz1 = rimNear(B) + 0.6, NSL = 4, OV = 0.05, SL = (sz1 - sz0 + OV * (NSL - 1)) / NSL;
const slabs = Array.from({ length: NSL }, (_, i) => ({ name: `slab_${i}`, x: A.x + rr(-0.1, 0.1), z0: sz0 + i * (SL - OV), z1: sz0 + i * (SL - OV) + SL, w: rr(1.25, 1.4), top: A.y + [0.02, 0.05, 0.03, 0.04][i], rotY: rr(-0.03, 0.03) }));
const wallZ = (slabs[1].z0 + slabs[1].z1) / 2;
// Lift pad D -> E (idle until rune1; then up/down 4 m), crumble pads, stairs
const lift = { name: 'mech_lift', x: D.x, z0: rimFar(D) - 0.4, z1: rimNear(E) + 0.1, w: 2.4, top: D.y, rotY: 0 };
const crumbles = [...Array.from({ length: CR.n }, (_, i) => rimFar(E) + CR.gap + i * (CR.len + CR.gap)), pad4.z0].map((z0, i) => ({ name: `mech_crumble_${i}`, x: E.x + rr(-0.2, 0.2), z0, z1: z0 + CR.len, w: rr(2.0, 2.3), top: E.y + [0.03, 0.06, 0.02, 0.05][i], rotY: rr(-0.06, 0.06) }));
const tw = rimNear(T), NS = 6, STEP = STEPRISE / (NS + 1), sz0b = rimFar(G) - 0.6, SLEN = (tw + 0.6 - sz0b) / NS; // a rising stair bridge: 6 slabs over the chasm
const stairs = Array.from({ length: NS }, (_, i) => ({ name: `mech_stair_${i}`, x: T.x, z0: sz0b + i * SLEN, z1: sz0b + (i + 1) * SLEN + (i === NS - 1 ? 0 : 0.05), w: 1.9, top: G.y + STEP * (i + 1), rotY: 0 }));

// Kamen the golem (kamen.glb, npc.js): lies across B's far rim, its flat back = this collider (U22: 2.28 m along z, head toward C, 1.45 m wide; only
// 0.2 m past the rim: asleep it is no bridge). Asleep it is sunk 0.5 m (back at stepUp); woken it rises GOLEM_UP and carries its
// rider GOLEM_D m to C's near rim and back. Its rune head sits off its east end (strike from its back).
// KAMEN_BACK (npc.js) 0.85: the back stands 0.85 m over its feet, so the collider top is B.y + 0.85 (feet on the turf). It lies
// back from the rim so a jump off its higher back still falls short of C (checked below).
const golem = { name: 'mech_golem', x: B.x, z0: rimFar(B) - 2.78, z1: rimFar(B) - 0.5, w: 1.45, top: B.y + 0.85, rotY: 0 } /* U22: he lies head toward C, the way he walks (2.28 m along z) */, GOLEM_UP = 0.24;
const GOLEM_D = rimNear(C) + 0.1 - golem.z1, golemC = [golem.x, (golem.z0 + golem.z1) / 2], golemHead = [golem.x, B.y, golemC[1] + 1.55];
// Name-stones (Kamen's quest): name_stone.glb meshes name_a/b/c (glyph a/b/c = the glyph_a/b/c slabs on Kamen's back), each struck
// from its spot NAME_D m in front of its glyph face.
const NAME_D = 1.4, names = [[A.x - 2.6, A.y, A.z - 0.5, Math.PI / 2], [B.x + 2.8, B.y, B.z, -Math.PI / 2], [B.x - 2.8, B.y, B.z + 1.2, Math.PI / 2]]
  .map(([x, y, z, rotY], i) => ({ id: `name${i + 1}`, glb: NAME, mesh: `name_${'abc'[i]}`, pos: [x, y, z], rotY, scale: 0.85, spot: [x + Math.sin(rotY) * NAME_D, z + Math.cos(rotY) * NAME_D] }));
// Props. rotY turns the prop's +Z front (the glyph face) toward the strike spot.
const liftC = [lift.x, (lift.z0 + lift.z1) / 2];
const rune1 = { id: 'rune1', glb: RUNE, pos: [H1.x - 1.2, H1.y, H1.z], rotY: Math.PI / 2 }, spot1 = [H1.x + 0.3, H1.z];
const runeS = { id: 'runeS', glb: RUNE, pos: [X3.x + 2.4, X3.y, rimFar(X3) - 2.0], rotY: -Math.PI / 2 }, spotS = [runeS.pos[0] - 1.2, runeS.pos[2]];
const rune2 = { id: 'rune2', glb: RUNE, pos: [H2.x + 1.2, H2.y, H2.z], rotY: -Math.PI / 2 };
// U18 the Gust's song-shrine on D (before the first Squall on E and rune2's dust): an old standing stone, a wind cone carved on its face
// (marks.js); sung to from shrineSpot it answers and gives the Gust.
// U19: on GS, at its far side from the dash in; its first use is the boulder on rune1 (H1), carved with the same wind cone (marks.js).
const gsU = ((d) => [(GS.x - I.q1.x) / d, (GS.z - I.q1.z) / d])(Math.hypot(GS.x - I.q1.x, GS.z - I.q1.z)), SHRINE_K = 1.9; // SHRINE_K: a song-shrine stands near twice a ruin pillar
const shrineSpot = [GS.x - gsU[0] * 0.3, GS.z - gsU[1] * 0.3], gust1Spot = [H1.x - 0.6, H1.z + 1.8], breathSpot = [H1.x + 1.7, H1.z]; // U25: the Gust is sung from north of the boulder, facing south-east past it: the shrine on GS stands in the play camera's frame (kit songGates); the breath is drawn at the cairn first
const songGust = { id: 'song_gust', glb: PILLAR, pos: [GS.x + gsU[0] * 1.8, GS.y, GS.z + gsU[1] * 1.8], rotY: 0, scale: SHRINE_K }; songGust.rotY = facing(songGust.pos, [shrineSpot[0], 0, shrineSpot[1]]);
const dQ = toward(D, I.q1, 1.2), gsIn = toward(GS, I.q1, 1.3), q1At = [I.q1.x, I.q1.y, I.q1.z], qRoute = [[D.x + 0.8, D.y, D.z + 1.0], dQ, q1At, gsIn, [shrineSpot[0], GS.y, shrineSpot[1]], gsIn, q1At, dQ];
const props = [
  { id: 'pillar_s1', glb: PILLAR, pos: [-4.2, 0, 1.2], rotY: 0.3 },
  { id: 'pillar_s2', glb: PILLAR, pos: [2.2, 0, 2.6], rotY: 1.1, scale: 0.8 },
  rune1, rune2, runeS, songGust, ...names.map(({ spot, ...p }) => p),
  { id: 'pillar_a1', glb: PILLAR, pos: [A.x - 3.6, A.y, A.z + 1.5], rotY: 0.7, scale: 0.8 },
  { id: 'pillar_c1', glb: PILLAR, pos: [C.x + 3.8, C.y, C.z + 1.2], rotY: 0.2, scale: 0.9 },
  { id: 'pillar_d1', glb: PILLAR, pos: [D.x - 4.2, D.y, D.z + 1.5], rotY: 0.4, scale: 0.85 },
  { id: 'pillar_g1', glb: PILLAR, pos: [T.x - 3.2, T.y, T.z + 3.4], rotY: 0.5 },
  { id: 'pillar_g2', glb: PILLAR, pos: [T.x + 3.1, T.y, T.z + 2.9], rotY: -0.4, scale: 0.9 },
];

const SPAWN = [0, 0, -8];
const goalPos = [T.x, T.y, T.z + 2];
const at = (k) => [I[k].x, I[k].y, I[k].z], mid = (p) => [p.x, p.top, (p.z0 + p.z1) / 2];
const wallSpot = [A.x, wallZ - 1.05], rune2Spot = [H2.x - 0.3, H2.z];
const route = [
  SPAWN, [-6, 0, -4], [-6.5, 0, 4], [-1, 0, 7], at('hop1'), at('hop2'),
  [A.x, A.y, A.z - 3], [names[0].spot[0], A.y, names[0].spot[1]], [A.x + 1.2, A.y, A.z + 1], [A.x, A.y, rimFar(A) - 1.5], [A.x, A.y, slabs[0].z0 + 0.6], [wallSpot[0], A.y, wallSpot[1]], [A.x, A.y, wallZ + 1.2], [A.x, A.y, rimNear(B) + 1.2],
  [B.x + 1.8, B.y, rimNear(B) + 1.4], [names[1].spot[0], B.y, names[1].spot[1]], [names[2].spot[0], B.y, names[2].spot[1]], [B.x, B.y, rimFar(B) - 3.6], [golemC[0], golem.top, golemC[1]], [C.x, C.y, rimNear(C) + 1.5], [C.x, C.y, C.z], [C.x, C.y, rimFar(C) - 1.5],
  [X1.x, X1.y, rimNear(X1) + 1.5], [X1.x, X1.y, X1.z + 1], ...qpads.map(mid), [X2.x, X2.y, rimNear(X2) + 1.1], [X2.x, X2.y, X2.z + 1],
  [X3.x, X3.y, rimNear(X3) + 1.5], [X3.x, X3.y, X3.z], [spotS[0], X3.y, spotS[1]], [X3.x, X3.y, rimFar(X3) - 1.0], ...span.map(mid), [X4.x, X4.y, rimNear(X4) + 1.5], [X4.x - 1, X4.y, X4.z],
  at('k1'), at('k2'), at('k3'), [D.x, D.y, rimNear(D) + 1.5], ...qRoute, [D.x - 1.5, D.y, D.z], [D.x - 4.5, D.y, D.z - 0.5], at('w1'), at('w2'), at('w3'), at('w4'), [breathSpot[0], H1.y, breathSpot[1]], [gust1Spot[0], H1.y, gust1Spot[1]], [spot1[0], H1.y, spot1[1]], at('w4'), at('w3'), at('w2'), at('w1'), [D.x - 3, D.y, D.z - 2], [D.x - 0.5, D.y, rimFar(D) - 2], [liftC[0], D.y, liftC[1]],
  [E.x, E.y, rimNear(E) + 1.5], [E.x + 1, E.y, E.z], [E.x, E.y, rimFar(E) - 1.5],
  ...crumbles.slice(0, CR.n).map((p) => [p.x, p.top, (p.z0 + p.z1) / 2]), [F.x, F.y, rimNear(F) + 1.1], [F.x, F.y, F.z], [crumbles[3].x, crumbles[3].top, (crumbles[3].z0 + crumbles[3].z1) / 2],
  [G.x, G.y, rimNear(G) + 1.5], [G.x + 0.5, G.y, G.z], [G.x + 3.5, G.y, G.z - 0.5], at('g1'), at('g2'), at('g3'), at('g4'), [rune2Spot[0], H2.y, rune2Spot[1]], at('g4'), at('g3'), at('g2'), at('g1'), [G.x + 2.5, G.y, G.z + 1.5], [T.x, G.y, stairs[0].z0 - 1.2],
  ...stairs.map((p) => [p.x, p.top, (p.z0 + p.z1) / 2]), [T.x, T.y, tw + 1.5], [T.x - 1.5, T.y, T.z - 2], goalPos,
].map((w) => [r2(w[0]), r2(w[1]), r2(w[2]), 0]);

// Decor (instanced, collision boxes): ruins theme. Off the route, the strike spots, the lift and the stairs.
const keep = (x, z, r) => Math.hypot(x - goalPos[0], z - goalPos[2]) > r + 2.6 && [spotS, rune2Spot, liftC, [rune1.pos[0], rune1.pos[2]], golemC, [golemHead[0], golemHead[2]], ...names.map((n) => n.spot)].every(([sx, sz]) => Math.hypot(x - sx, z - sz) > r + 2) &&
  !(Math.abs(x - T.x) < r + 1.6 && z > stairs[0].z0 - r - 1.5 && z < tw + r + 0.5) && !(Math.abs(x - X3.x) < r + 1.6 && z > bz0 - r - 1.5 && z < rimNear(X4) + r + 1) &&
  outroClear(x, z, r);
// the outro walk (goal circle -> rim -> rune bridge, along HX) stays clear: kit.write checks every cutscene path against decor
function outroClear(x, z, r) {
  const ax = goalPos[0], az = goalPos[2], bx = T.x + dirX * (rimX + 1), bz = T.z + dirZ * (rimX + 1), vx = bx - ax, vz = bz - az;
  const u = THREE.MathUtils.clamp(((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(ax + vx * u - x, az + vz * u - z) > r + 1.0;
}
const route0 = route.filter((q) => ![...qRoute, [gust1Spot[0], 0, gust1Spot[1]], [breathSpot[0], 0, breathSpot[1]]].some((d) => r2(d[0]) === q[0] && r2(d[2]) === q[2])), /* U19: decor laid out as before the shrines' detours (the seed draws stay put) */ props0 = props.filter((p) => p !== songGust); // U18: decor laid out as before the song-shrine (the seed draws stay put), cleared around it below
const decor = K.decorate([
  { on: I.start, glb: ARCH, s: [0.95, 1.1] }, { on: I.start, glb: RUBBLE, n: 2, s: [0.85, 1.0] }, { on: I.start, glb: TREE, s: [0.9, 1.0] },
  { on: A, glb: RUBBLE, s: [0.85, 1.0] }, { on: B, glb: RUBBLE, s: [0.85, 1.0] }, { on: C, glb: ARCH, s: [0.9, 1.0] }, { on: C, glb: RUBBLE, s: [0.85, 1.0] },
  { on: D, glb: STAIRS, s: [0.8, 1.0] }, { on: D, glb: RUBBLE, s: [0.85, 1.0] }, { on: E, glb: PILLAR, s: [0.7, 0.9] }, { on: E, glb: RUBBLE, s: [0.85, 1.0] },
  { on: I.echo, glb: TREE, s: [0.9, 1.0] }, { on: I.safe, glb: RUBBLE, s: [0.85, 1.0] },
  { on: F, glb: RUBBLE, s: [0.85, 1.0] }, { on: G, glb: PILLAR, s: [0.6, 0.8] },
  { on: X2, glb: RUBBLE, s: [0.85, 1.0] }, { on: X4, glb: PILLAR, s: [0.7, 0.9] }, { on: X4, glb: RUBBLE, s: [0.85, 1.0] },
  { on: T, glb: ARCH, s: [1.0, 1.15] }, { on: T, glb: RUBBLE, n: 2, s: [0.85, 1.0] }, { on: T, glb: TREE, s: [0.95, 1.05] }, { on: T, glb: SHRINE, s: [0.8, 0.9] },
], { route: route0, props: props0, keep });
const shrine = decor.find((d) => d.glb === SHRINE);
// Setpieces (fixed spots, each placed on its own so a blocked one is just left out; appended: earlier decor keeps its seed draws).
// A broken ring of plain standing stones (menhirs: decor, never rune stones) round the spawn, stairs climbing out over the rim into nothing, the shrine turned to the sunrise.
const SUN_YAW = Math.atan2(-0.5, 1); // post.js SKY.sun (x, z): the low sun the sky is lit from
const place = (spec) => { try { decor.push(...K.decorate([spec], { route: route0, props: [...props0, ...decor], keep })); } catch { /* spot blocked: no stone there */ } };
for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.283; place({ on: I.start, glb: MENHIR, at: [4.2 + Math.cos(a) * 2.8, -4.5 + Math.sin(a) * 2.8], rotY: -a - Math.PI / 2, s: [0.75, 0.75] }); }
place({ on: I.start, glb: STAIRS, at: [7.2, 3.4], rotY: Math.atan2(3.4, -7.2), s: [1.15, 1.15] });
{ // rim rocks ahead of the spawn heading: a held W from the spawn stops here instead of walking off the island
  const a0 = Math.atan2(-1.7, -9.5);
  for (const da of [-0.25, 0, 0.25]) { const a = a0 + da; place({ on: I.start, glb: RUBBLE, at: [Math.cos(a) * 9.6, Math.sin(a) * 9.6], rotY: -a, s: [0.95, 0.95] }); }
}
const offLine = (d, pts) => pts.slice(1).every((b, i) => { const a = pts[i], vx = b[0] - a[0], vz = b.at(-1) - a.at(-1), u = Math.max(0, Math.min(1, ((d.pos[0] - a[0]) * vx + (d.pos[2] - a.at(-1)) * vz) / (vx * vx + vz * vz || 1))); return Math.hypot(a[0] + vx * u - d.pos[0], a.at(-1) + vz * u - d.pos[2]) > 1.9; });
decor.splice(0, decor.length, ...decor.filter((d) => [[[D.x, rimNear(D) + 1.5], [D.x + 0.8, D.z + 1.0], dQ, [D.x - 1.5, D.z]], [gust1Spot, spot1], [shrineSpot, songGust.pos]].every((pts) => offLine(d, pts)))); // U19: clear along the ways to the shrines' side islands
decor.forEach((d, i) => { d.id = `decor_${i}`; });
shrine.rotY = SUN_YAW;

// ---------- world.glb + collider.glb ----------
const world = new THREE.Scene();
const play = Object.values(I);
const rocks = K.islandMeshes(world, play, [[nextIsl.x, nextIsl.z, nextIsl.R * 1.8]], route);
K.distantRing(world, new THREE.Vector3(G.x / 2, 0, G.z / 2), { route, clear: [[nextIsl.x, nextIsl.z, nextIsl.R * 1.8], [T.x, T.z, 60]] }); // and none within 60 m of the goal terrace: the low-detail haze rock read as a flat pale slab up close
const farDecor = K.farIsland(world, { name: 'l2', kind: 'totems', ...nextIsl }); // Orren's workshop, the next level, seen from the goal
const beacon = K.landmark(world, { x: G.x / 2 + Math.sin(0.5) * 340, z: G.z / 2 + Math.cos(0.5) * 340 }); // the Crown, far ahead
const falls = K.waterfalls(world, play, rocks, 3, route);
const inst = K.scatter(world, play, rocks, (x, z) => props.every((p) => Math.hypot(x - p.pos[0], z - p.pos[2]) > 0.55) && decor.every((p) => Math.hypot(x - p.pos[0], z - p.pos[2]) > 0.8 * p.scale) && Math.hypot(x - goalPos[0], z - goalPos[2]) > 1.6);
const collider = K.colliderBase(play, props, decor);
K.pieces(world, collider, slabs, 0.6, 0);
const wall1 = K.wall(world, collider, { name: 'mech_wall_1', x: slabs[1].x, y: slabs[1].top, z: wallZ, w: 2.2, h: 2.2, d: 0.5 });
K.pieces(world, collider, [lift], 0.7, 5);
K.pieces(world, collider, crumbles, 0.5, 10);
K.pieces(world, collider, [golem], 0.7, 30);
world.getObjectByName(golem.name).clear(); // keep the seeded draws; Kamen's model (npc.js) is the visible body
K.pieces(world, collider, stairs, 0.7, 20);
K.pieces(world, collider, qpads, 0.5, 40);
K.pieces(world, collider, span, 0.7, 45);
K.own(707, () => exitSlabs.forEach((p, i) => K.addPiece(world, p, 0.7, 60 + i))); // the pier: world only, shown by the outro
// The hollow stone (cutscene-only, no collider): six slabs leaning in over the spawn, a closed shell the hero sleeps in; the intro tips
// them open and sinks them (cutscene.js rise away). Each node's origin is its foot on the ring (the tilt turns about it).
const shell = [];
K.own(708, () => { for (let i = 0; i < 6; i++) {
  const a = (i / 6) * 6.283 + 0.3, g = new THREE.Group();
  g.name = `mech_shell_${i}`; g.position.set(SPAWN[0] + Math.cos(a) * 1.35, SPAWN[1] - 0.12, SPAWN[2] + Math.sin(a) * 1.35);
  g.rotation.set(-1.05, Math.atan2(-Math.cos(a), -Math.sin(a)), 0, 'YXZ'); // leans in: its length runs up toward the middle
  K.addPiece(g, { name: `mech_shellslab_${i}`, x: 0, z0: 0, z1: 2.4, w: 1.6, top: 0, rotY: 0 }, 0.28, 80 + i);
  world.add(g); shell.push(g.name);
} });
K.markers(world, SPAWN, goalPos);

// ---------- feasibility ----------
K.gapChain([['start', 'hop1'], ['hop1', 'hop2'], ['hop2', 'A'], ['X4', 'k1'], ['k1', 'k2'], ['k2', 'k3'], ['D', 'br1'], ['br1', 'echo'], ['safe', 's1'], ['s1', 's2'], ['s2', 'B'], ['safe2', 's3'], ['s3', 's4'], ['s4', 'C'], ['D', 'w1'], ['w1', 'w2'], ['w2', 'w3'], ['w3', 'w4'], ['w4', 'H1'], ['G', 'g1'], ['g1', 'g2'], ['g2', 'g3'], ['g3', 'g4'], ['g4', 'H2']]);
K.dashGap('C', 'X1', rimGap(C, X1), 0); // teach
K.gap('X1', qpads[0].name, qpads[0].z0 - rimFar(X1), qpads[0].top - X1.y); // test
K.dashGap(qpads[0].name, qpads[1].name, qpads[1].z0 - qpads[0].z1, qpads[1].top - qpads[0].top);
K.gap(qpads[1].name, 'X2', rimNear(X2) - qpads[1].z1, X2.y - qpads[1].top);
K.dashGap('X2', 'X3', rimGap(X2, X3), 0); // twist
K.step('X3', span[0].name, span[0].top - X3.y, rimFar(X3) - span[0].z0); // combine
for (let i = 1; i < NBS; i++) K.step(span[i - 1].name, span[i].name, span[i].top - span[i - 1].top, span[i - 1].z1 - span[i].z0);
K.dashGap(span.at(-1).name, 'X4', rimNear(X4) - span.at(-1).z1, X4.y - span.at(-1).top);
K.step('A', slabs[0].name, slabs[0].top - A.y, rimFar(A) - slabs[0].z0);
for (let i = 1; i < NSL; i++) K.step(slabs[i - 1].name, slabs[i].name, slabs[i].top - slabs[i - 1].top, slabs[i - 1].z1 - slabs[i].z0);
K.step(slabs[NSL - 1].name, 'B', B.y - slabs[NSL - 1].top, slabs[NSL - 1].z1 - rimNear(B));
K.dashGap('B', 'C', rimGap(B, C), C.y - B.y);
K.dashGap('k3', 'D', rimGap(I.k3, D), D.y - I.k3.y);
K.gapChain([['D', 'q1']]); K.dashGap('q1', 'GS', rimGap(I.q1, GS), GS.y - I.q1.y); // U19: the Gust shrine's side island
K.gap('B', golem.name, 0.3, golem.top - B.y); // a hop up onto the 0.85 m back
K.gap(`${golem.name}@C`, 'C', 0.1, C.y - golem.top - GOLEM_UP); // carried to C's rim: a short drop off the back
if (rimGap(B, C) - (golem.z1 - rimFar(B)) <= jumpReach(C.y - golem.top)) throw new Error('the sleeping golem bridges the dash gap');
K.step('D', lift.name, 0, rimFar(D) - lift.z0);
K.step(`${lift.name}@top`, 'E', 0, lift.z1 - rimNear(E));
K.gap('E', crumbles[0].name, crumbles[0].z0 - rimFar(E), crumbles[0].top - E.y);
for (let i = 1; i < CR.n; i++) K.gap(crumbles[i - 1].name, crumbles[i].name, crumbles[i].z0 - crumbles[i - 1].z1, crumbles[i].top - crumbles[i - 1].top);
K.gap(crumbles[CR.n - 1].name, 'F', rimNear(F) - crumbles[CR.n - 1].z1, F.y - crumbles[CR.n - 1].top);
K.gap('F', crumbles[3].name, crumbles[3].z0 - rimFar(F), crumbles[3].top - F.y);
K.dashGap(crumbles[3].name, 'G', rimNear(G) - crumbles[3].z1, G.y - crumbles[3].top);
K.step('G', stairs[0].name, stairs[0].top - G.y, 0);
for (let i = 1; i < NS; i++) K.step(stairs[i - 1].name, stairs[i].name, stairs[i].top - stairs[i - 1].top, stairs[i - 1].z1 - stairs[i].z0);
K.step(stairs[NS - 1].name, 'goal', T.y - stairs[NS - 1].top, stairs[NS - 1].z1 - tw);
if (rimGap(D, E) <= 0 || LIFT <= TUNING.jumpHeight || STEPRISE <= TUNING.jumpHeight) throw new Error('lift / steps are jumpable');
K.blocked.push({ from: 'A', to: 'B', wall: wall1.size, needs: 'broken.wall1 (strike or dash)' });
K.blocked.push({ from: 'D', to: 'E', rise: LIFT, jumpHeight: TUNING.jumpHeight, needs: 'switch.rune1 (lift; the rune hides on H1, four hops west)' });
K.blocked.push({ from: 'X3', to: 'X4', dist: +rimGap(X3, X4).toFixed(2), needs: `raised.span (runeS, hold ${HOLDS} s), then a dash off its end` });
K.blocked.push({ from: 'G', to: 'goal', dist: +rimGap(G, T).toFixed(2), rise: STEPRISE, needs: `raised.stairs (rune2 on H2, four hops east; hold ${HOLD} s)` });

// ---------- level.json ----------
K.checkRoute(route, [...slabs, lift, golem, ...crumbles, ...stairs, ...qpads, ...span], props.concat(decor));
const WIND_CAIRNS = ['c_C', 'c_X1', 'c_X2', 'c_X3', 'c_D', 'c_GS', 'c_H1', 'c_E', 'c_k3', 'c_F', 'c_G']; // c_D (U18): breath for the Gust's first use at its shrine // checkpoints with a wind spring (level.js swirl, player.js refill); plain ones keep the breath you came with (kit breath budget)
const SH0 = facing(SPAWN, route[1]); // the spawn heading (the intro hands the camera over behind it)
const cp = (id, p, look) => ({ id, pos: r2v(p), r: 2.2, heading: facing(p, look), ...(WIND_CAIRNS.includes(id) && { wind: true }) });
const level = {
  id: 'l1', title: 'Waking Stones', next: 'l2', seed: SEED,
  spawn: { pos: SPAWN, heading: SH0 }, // into the island along the first leg: held W meets the rim rocks, not the hop1 gap
  goal: { kind: 'circle', pos: goalPos.map(r2), r: 1.3 },
  killY: -12,
  // dawn: low warm sun that climbs and a morning haze that thins as the player gets on (world.js, by route progress)
  mood: { sky: { top: '#f9f3ec', horizon: '#f4eee6', haze: '#e9d2b4', sunGlow: '#f7d79c', sunDisc: '#fdf0c8', cloudLit: '#f8e7c4', cloudShade: '#e6d3d3' },
    sun: [[-0.5, 0.03, 1], [-0.5, 0.2, 1]], fog: { color: '#f6eadb', near: 40, far: [290, 380] }, hemi: { sky: '#e6edf2', ground: '#aaa4b6', i: 2.3 },
    light: { color: '#ffd29a', i: 1.6, y: 4.5 }, breeze: 1 },
  beacon: { pos: beacon },
  falls,
  sky: K.skyCastles({ x: G.x / 2, z: G.z / 2 }, [['assets/sky/castle1.png', 38, 360, 52, 180], ['assets/sky/castle2.png', -80, 330, 28, 142], ['assets/sky/castle2.png', 160, 380, 39, 165]]),
  props: props.map((p) => ({ ...p, pos: p.pos.map(r2), rotY: +p.rotY.toFixed(4) })),
  mechanisms: [
    { id: 'wall1', kind: 'breakable', ...wall1 },
    { id: 'rune1', kind: 'switch', node: 'rune1', pos: rune1.pos.map(r2), r: 3.2, targets: ['lift'], once: true, hidden: true, dust: true, // U19: the Gust's first use, a boulder carved with its shrine's wind cone
      vein: [[liftC[0], D.y, rimFar(D) - 1], [D.x - 2, D.y, D.z + 1], [D.x - 5.5, D.y, D.z], at('w1'), at('w2'), at('w3'), at('w4'), at('H1'), rune1.pos].map(r2v) },
    { id: 'lift', kind: 'platform', node: lift.name, path: [[0, 0, 0], [0, LIFT, 0]], mode: 'ride', period: 5, idle: true }, // U14: on demand (level.js rideStep): 2.5 s up, home 2 s after the hero leaves
    ...crumbles.map((p, i) => ({ id: `crumble${i}`, kind: 'crumble', node: p.name, delay: CR.delay, respawn: 3 })),
    ...names.map((n) => ({ id: n.id, kind: 'switch', node: n.id, pos: n.pos.map(r2), r: 2.0, targets: [], once: true })),
    { id: 'golem', kind: 'platform', node: golem.name, path: [[0, 0, 0], [0, GOLEM_UP - 0.04, 0], [0, GOLEM_UP - 0.04, r2(GOLEM_D)], [0, GOLEM_UP, r2(GOLEM_D)], [0, GOLEM_UP, r2(GOLEM_D)]], mode: 'ride', period: 20, after: 'npc.pebble.awake' }, // 'top.golem' only once he has arrived (the last 4 cm settle)
    ...qpads.map((p, i) => ({ id: `qcrumble${i}`, kind: 'crumble', node: p.name, delay: QP.delay, respawn: 3 })),
    { id: 'runeS', kind: 'switch', node: 'runeS', pos: runeS.pos.map(r2), r: 2.2, targets: ['span'], once: true },
    { id: 'span', kind: 'bridge', nodes: span.map((p) => p.name), offset: [0, -7, 0], dur: 1.0, stagger: 0.25, hold: HOLDS },
    { id: 'rune2', kind: 'switch', node: 'rune2', pos: rune2.pos.map(r2), r: 2.2, targets: ['stairs'], once: true, hidden: true, dust: true, // R2: dust hides it (no vein, no song) until a Gust bares it
      vein: [[T.x, G.y, stairs[0].z0 - 0.4], [G.x + 1.5, G.y, G.z + 1.5], [G.x + 4.5, G.y, G.z], at('g1'), at('g2'), at('g3'), at('g4'), at('H2'), rune2.pos].map(r2v) },
    { id: 'stairs', kind: 'bridge', nodes: stairs.map((p) => p.name), offset: [0, -7, 0], dur: 1.0, stagger: 0.25, hold: HOLD },
    { id: 'shrine', kind: 'switch', pos: r2v([shrine.pos[0], T.y + 0.9, shrine.pos[2]]), r: 2.2, targets: [], once: true },
    { id: 'song_gust', kind: 'switch', node: 'song_gust', pos: songGust.pos.map(r2), r: 2.2, targets: [], once: true, gift: 'gust' }, // U18: sung to, it gives the Gust (level.js)
  ],
  triggers: [
    { id: 't_move', shape: { kind: 'poly', pts: poly(-3, -9.5, 3, -6) }, teaches: 'jump_hold', ifFlag: null, once: true },
    { id: 't_call', shape: { kind: 'poly', pts: poly(B.x - 4, wallZ + 2, B.x + 4, wallZ + 6) }, talk: 'pebble_call', ifFlag: null, once: true }, // Kamen's first words: past the wall, with him in view 10 m ahead (from hop2, 30 m off behind the wall, it read as a stone talking before they met)
    { id: 't_wall', shape: { kind: 'poly', pts: poly(A.x - 4, rimFar(A) - 4, A.x + 4, rimFar(A)) }, teaches: 'break', ifFlag: null, once: true },
    { id: 't_dash', shape: { kind: 'poly', pts: poly(B.x - 4, rimFar(B) - 4, B.x + 4, rimFar(B)) }, teaches: 'air_dash', ifFlag: 'gift.dash', once: true },
    { id: 't_trial', shape: { kind: 'poly', pts: poly(C.x - 4, rimFar(C) - 4, C.x + 4, rimFar(C)) }, teaches: null, ifFlag: 'gift.dash', once: true },
    { id: 't_span', shape: { kind: 'poly', pts: poly(X3.x - 4, X3.z - 3, X3.x + 4, rimFar(X3)) }, teaches: null, ifFlag: null, once: true },
    { id: 't_lift', shape: { kind: 'poly', pts: poly(D.x - 4, rimFar(D) - 4, D.x + 4, rimFar(D)) }, teaches: 'rune_lift', ifFlag: null, once: true },
    { id: 't_stairs', shape: { kind: 'poly', pts: poly(G.x - 5, G.z - 5, G.x + 5, G.z + 1) }, teaches: 'timed_bridge', ifFlag: null, once: true },
    { id: 't_crumble', shape: { kind: 'poly', pts: poly(E.x - 4, rimFar(E) - 4, E.x + 4, rimFar(E)) }, teaches: 'crumble', ifFlag: null, once: true },
    { id: 't_shrine', shape: { kind: 'poly', pts: poly(shrine.pos[0] - 3.5, shrine.pos[2] - 3.5, shrine.pos[0] + 3.5, shrine.pos[2] + 3.5) }, ifFlag: 'switch.shrine', once: true,
      hint: { en: 'Carved under the sunrise: "We woke first, so that we could wake the others."', ru: 'Вырезано под восходом: «Мы проснулись первыми, чтобы будить других».', pt: 'Gravado sob o nascente: "Despertámos primeiro, para podermos despertar os outros."' } },
  ],
  checkpoints: [
    cp('c_A', [A.x, A.y, A.z - 2], [A.x, 0, rimFar(A)]),
    cp('c_B', [B.x, B.y, B.z], [B.x, 0, rimFar(B)]),
    cp('c_C', [C.x, C.y, C.z], at('X1')), // teach: refill after the ride
    cp('c_X1', [X1.x, X1.y, X1.z + 1], mid(qpads[0])), // test
    cp('c_X2', [X2.x, X2.y, X2.z + 1], at('X3')), // twist
    cp('c_X3', [X3.x, X3.y, X3.z], runeS.pos), // combine
    cp('c_k3', at('k3'), at('D')), // the 0.85 dash: refill (breath 2, no regen after the gift) and a short way back
    cp('c_D', [D.x, D.y, D.z], liftC.length && [liftC[0], 0, liftC[1]]),
    cp('c_GS', [GS.x - gsU[0] * 1.6, GS.y, GS.z - gsU[1] * 1.6], songGust.pos), // the shrine's island: breath for the dash back
    cp('c_H1', [H1.x + 1.5, H1.y, H1.z - 1.4], rune1.pos), // U21: clear of rune1's boulder and its rest spots // the hidden rune's island: the detour gets its own leg
    cp('c_E', [E.x, E.y, E.z], [E.x, 0, rimFar(E)]),
    cp('c_F', [F.x, F.y, F.z], [crumbles[3].x, 0, crumbles[3].z1]), // before the crumble + dash
    cp('c_G', [G.x, G.y, G.z], rune2.pos),
    cp('c_H2', [H2.x - 1.9, H2.y, H2.z - 1.6], rune2.pos), // U21: it stood inside rune2's boulder (the respawn was walled in)
  ],
  route,
  enemies: [ // R3 Knot Shards (enemies.js): one Squall on the wide island E, after the dash gift and the Gust's shrine on D (kit enemyOrder)
    { id: 'sqE', kind: 'squall', pos: r2v([E.x - 2.5, E.y, E.z + 2]), r: 6, motif: 'SL', tame: true },
    { id: 'thF', kind: 'squall', variant: 'thief', pos: r2v([F.x + 2.4, F.y, F.z + 2.8]), r: 6, motif: 'LS' }, // the first breath thief, on F by its checkpoint, before the air dash that needs the breath: strike it and the thread comes back
  ],
  actions: [
    { at: [-15, -6], r: 1, do: 'go', drop: true, profiles: ['worst'] }, // worst: walks off the spawn island into the void first
    { at: names[0].spot.map(r2), r: 0.6, do: 'sing', switch: 'name1', until: 'switch.name1' },
    { at: wallSpot.map(r2), r: 0.6, do: 'strike', switch: 'wall1', until: 'switch.wall1' },
    { at: [B.x + 1.8, rimNear(B) + 1.4].map(r2), y: B.y, r: 0.5, do: 'wait', until: 'echo.echo_wall', home: 3.5 }, // echo detour
    { at: names[1].spot.map(r2), r: 0.6, do: 'sing', switch: 'name2', until: 'switch.name2' },
    { at: names[2].spot.map(r2), r: 0.6, do: 'sing', switch: 'name3', until: 'switch.name3' },
    { at: [B.x + 1.6, rimFar(B) - 0.6].map(r2), r: 0.5, do: 'go', profiles: ['best'] }, // best: past Kamen's side, down to the safety island's echo, climb back
    { at: [B.x + 0.8, I.safe.z].map(r2), r: 0.6, do: 'go', drop: true, profiles: ['best'] },
    ...['s1', 's2'].map((k) => ({ at: [I[k].x, I[k].z].map(r2), r: 0.8, do: 'go', profiles: ['best'] })),
    { at: [B.x, rimFar(B) - 3.4].map(r2), r: 1, do: 'go', profiles: ['best'] },
    { at: golemC.map(r2), r: 0.6, do: 'wait', until: 'top.golem', ride: true }, // ride Kamen across; done at C's rim
    { at: [C.x, rimFar(C) - 0.6].map(r2), r: 1.2, do: 'dash', air: true }, // trial: teach
    { at: [qpads[0].x, (qpads[0].z0 + qpads[0].z1) / 2].map(r2), r: 1.4, do: 'dash', air: true }, // test
    { at: [X2.x, rimFar(X2) - 0.6].map(r2), r: 1.2, do: 'dash', air: true }, // twist
    { at: spotS.map(r2), r: 0.6, do: 'sing', switch: 'runeS', until: 'raised.span' }, // combine: then straight over
    { at: [span.at(-1).x, (span.at(-1).z0 + span.at(-1).z1) / 2].map(r2), r: 1.4, do: 'dash', air: true },
    { at: [I.k3.x, r2(I.k3.z + 0.5)].map(r2), r: 2.2, do: 'dash', air: true },
    { at: [D.x - 0.5, D.z - 1.2].map(r2), r: 1, do: 'go', profiles: ['best'] }, // best: the echo branch east of D, and back (hops centre to centre)
    { at: [I.br1.x, I.br1.z].map(r2), r: 1, do: 'go', profiles: ['best'] },
    { at: [I.echo.x, I.echo.z].map(r2), r: 0.6, do: 'go', profiles: ['best'] },
    { at: [I.br1.x, I.br1.z].map(r2), r: 1, do: 'go', profiles: ['best'] },
    { at: [D.x + 1.5, D.z - 1.2].map(r2), r: 1, do: 'go', profiles: ['best'] },
    { at: (([x, , z]) => [x, z])(toward(I.q1, GS, 0.6)).map(r2), r: 1.2, do: 'dash', air: true }, // U19: off D to the Gust's shrine island: a hop, an air dash
    { at: shrineSpot.map(r2), r: 0.6, do: 'sing', switch: 'song_gust', until: 'switch.song_gust' },
    { at: (([x, , z]) => [x, z])(toward(GS, I.q1, 0.6)).map(r2), r: 1.2, do: 'dash', air: true }, // and back
    { at: breathSpot.map(r2), y: H1.y, r: 0.6, do: 'wait', until: 'breath' }, // at the cairn c_H1: a full breath for the song
    { at: gust1Spot.map(r2), y: H1.y, r: 0.6, do: 'song', song: 'gust', face: [rune1.pos[0], rune1.pos[2]].map(r2), until: 'clear.rune1' }, // the Gust's first use: the boulder off rune1
    { at: spot1.map(r2), r: 0.6, do: 'sing', switch: 'rune1', until: 'switch.rune1' }, // hidden: four hops west
    { at: [D.x - 0.5, rimFar(D) - 2].map(r2), y: D.y, r: 0.6, do: 'wait', until: 'bottom.lift' }, // the lift waits down once woken
    { at: liftC.map(r2), r: 0.6, do: 'wait', until: 'top.lift', ride: true, home: 4 },
    { at: [E.x + 1, E.z].map(r2), y: E.y, r: 1.2, do: 'fight', enemy: 'sqE', stun: true }, // R3: the first Squall, on safe island E: Gust it on its telegraph (no Name yet)
    { at: [F.x, F.z].map(r2), y: F.y, r: 4.6, do: 'fight', enemy: 'thF', stun: true }, // the breath thief: strike it (worst: lets it take a thread first, then strikes it back out)
    { at: [crumbles[3].x, (crumbles[3].z0 + crumbles[3].z1) / 2].map(r2), r: 1.4, do: 'dash', air: true },
    { at: [G.x + 0.5, G.z].map(r2), y: G.y, r: 0.6, do: 'song', song: 'gust', face: [G.x + 1.5, G.z + 1.5].map(r2) }, // R2 required: blow the dust off rune2's vein
    { at: rune2Spot.map(r2), r: 0.6, do: 'sing', switch: 'rune2', until: 'switch.rune2' }, // hidden, four hops east: then back and over, HOLD s once up
    { at: [I.g1.x, I.g1.z].map(r2), r: 1, do: 'go', profiles: ['worst'] }, // worst: dawdles on the way back, the stairs sink; it falls, respawns at c_G, sings again
    { at: [H2.x, H2.z].map(r2), r: 1, do: 'go', profiles: ['worst'] },
    { at: [I.g1.x, I.g1.z].map(r2), r: 1, do: 'go', profiles: ['worst'] },
    { at: [H2.x, H2.z].map(r2), r: 1, do: 'go', profiles: ['worst'] },
    { at: [shrine.pos[0] + 1.2, shrine.pos[2]].map(r2), y: T.y, r: 0.5, do: 'wait', until: 'echo.echo_shrine', home: 6.5 }, // echo detour
  ],
  echoSlots: [
    { id: 'echo_branch', pos: r2v(at('echo')), note: 'branch: two hops east of D, a dead end back to c_D' },
    { id: 'echo_wall', pos: r2v([B.x + 1.8, B.y, rimNear(B) + 1.4]), note: 'just past the cracked wall' },
    { id: 'echo_dash', pos: r2v(at('safe')), note: 'safety island under the B -> C dash gap' },
    { id: 'echo_shrine', pos: r2v([shrine.pos[0] + 1.2, T.y, shrine.pos[2]]), note: 'by the goal shrine' },
  ],
  gifts: [{ id: 'dash', at: r2v([golemC[0], golem.top, golemC[1]]), npc: 'pebble' }, { id: 'gust', at: r2v([shrineSpot[0], GS.y, shrineSpot[1]]), shrine: 'song_gust', via: ['q1', 'GS'] }], // kit giftOrder: Kamen's dash, given on its back
  npcSlots: [{ id: 'golem', pos: r2v([C.x + 1.5, C.y, rimNear(C) + 2]), note: 'golem across the B -> C dash gap: in view from B before the first air dash' }],
  npcs: [
    { id: 'pebble', kind: 'golem', name: { en: 'Kamen', ru: 'Камень', pt: 'Kamen' }, voice: 'golem', node: golem.name, pos: r2v(golemHead), switches: names.map((n) => n.id), lure: true,
      bark: { talk: 'pebble_ask', r: 8, until: 'npc.pebble.awake', every: 15 }, talk: [ // re-asks while near until it wakes
      { id: 'pebble_ask', once: false, lines: [
        { en: '...my names... carved on three stones, near... sing to them... and I will remember...', ru: '...мои имена... вырезаны на трёх камнях, рядом... спой им... и я вспомню...', pt: '...os meus nomes... gravados em três pedras, perto... canta-lhes... e eu recordarei...' },
      ] },
      { id: 'pebble_call', until: 'npc.pebble.awake', lines: [ // t_call: on B, past the wall
        { en: '...little wind... over here... my names... on the stones... sing to them...', ru: '...ветерок... сюда... мои имена... на камнях... спой им...', pt: '...pequeno vento... aqui... os meus nomes... nas pedras... canta-lhes...' },
      ] },
      { id: 'pebble_1', on: 'npc.pebble.1', r: 13, lines: [{ en: '...one name. Yes... that was mine.', ru: '...одно имя. Да... это было моё.', pt: '...um nome. Sim... esse era meu.' }] },
      { id: 'pebble_2', on: 'npc.pebble.2', lines: [{ en: '...two. One more, and I wake.', ru: '...два. Ещё одно, и я проснусь.', pt: '...dois. Mais um, e eu acordo.' }] },
      { id: 'pebble_wake', on: 'npc.pebble.3', set: ['npc.pebble.awake', 'gift.dash'], lines: [
        { en: 'Take this, little wind: the Dash. Fall like a stone.', ru: 'Возьми, ветерок: Рывок. Срывайся, как камень.', pt: 'Toma, pequeno vento: o Impulso. Cai como uma pedra.', gift: true }, // U16: two short lines (~6 s); the flavour moved to pebble_far
        { en: 'Now climb on. I will carry you over.', ru: 'Теперь забирайся. Я перенесу тебя.', pt: 'Agora sobe. Eu levo-te para o outro lado.' }, // U18: one gift per moment; the Gust waits at its shrine on D
      ] },
      { id: 'pebble_far', on: 'top.golem', if: 'npc.pebble.awake', lines: [
        { en: 'No one had said my names for a very long time. I was a bridge for the Keepers.', ru: 'Давно никто не звал меня по именам. Я был мостом для Хранителей.', pt: 'Há muito tempo que ninguém dizia os meus nomes. Eu era uma ponte para os Zeladores.' },
        { en: 'Orren tied the knot above us. Go and see what is left of him.', ru: 'Оррен завязал узел над нами. Иди, посмотри, что от него осталось.', pt: 'Orren atou o nó por cima de nós. Vai ver o que resta dele.' },
      ] },
    ] },
  ],
  shots: [
    { name: 'vista', pos: r2v([B.x + 22, 18, B.z - 10]), look: r2v([C.x, 4, C.z + 10]) },
    { name: 'hero', pos: [SPAWN[0] + 1.6, 1.5, SPAWN[2] + 2.4], look: [SPAWN[0], 0.85, SPAWN[2]] },
    { name: 'shrine_gust', pos: r2v([shrineSpot[0] - gsU[0] * 3.2, GS.y + 2.4, shrineSpot[1] - gsU[1] * 3.2]), look: r2v([songGust.pos[0], GS.y + 2.2, songGust.pos[2]]) }, // U19: the wind cone on its face
    { name: 'shrine_gust_sung', pos: r2v([shrineSpot[0] - gsU[0] * 3.2, GS.y + 2.4, shrineSpot[1] - gsU[1] * 3.2]), look: r2v([songGust.pos[0], GS.y + 2.2, songGust.pos[2]]), fire: ['song_gust'] },
    { name: 'wall', pos: r2v([A.x + 3, A.y + 2, wallZ - 4]), look: r2v([A.x, A.y + 1, wallZ]) },
    { name: 'dash_gap', pos: r2v([B.x + 10, B.y + 3, (rimFar(B) + rimNear(C)) / 2 - 2]), look: r2v([B.x, B.y - 1, (rimFar(B) + rimNear(C)) / 2]) },
    { name: 'trial_teach', pos: r2v([C.x + 9, C.y + 4, rimFar(C) - 3]), look: r2v([C.x, C.y - 1, rimNear(X1)]) },
    { name: 'trial_test', pos: r2v([X1.x + 8, X1.y + 4, rimFar(X1) + 2]), look: r2v([X1.x, X1.y, qpads[1].z0]) },
    { name: 'trial_span', pos: r2v([X3.x + 9, X3.y + 4, rimFar(X3) + 1]), look: r2v([X3.x, X3.y, span.at(-1).z1 + 1]), fire: ['runeS'] },
    { name: 'lift', pos: r2v([D.x + 9, D.y + 5, rimFar(D) - 5]), look: r2v([D.x, D.y + 2, rimFar(D) + 1]), fire: ['rune1'] },
    { name: 'vein1', pos: r2v([D.x + 4, D.y + 9, rimFar(D) + 3]), look: r2v([D.x - 6, D.y, D.z]) },
    { name: 'hidden1', pos: r2v([H1.x + 5, H1.y + 2.5, H1.z - 3]), look: r2v([rune1.pos[0], H1.y + 0.6, rune1.pos[2]]) },
    { name: 'vein2', pos: r2v([G.x - 3, G.y + 8, G.z + 7]), look: r2v([G.x + 9, G.y - 1, G.z - 1]) },
    { name: 'hidden2', pos: r2v([H2.x - 5, H2.y + 2.5, H2.z - 3]), look: r2v([rune2.pos[0], H2.y + 0.6, rune2.pos[2]]) },
    { name: 'crumble', pos: r2v([E.x + 8, E.y + 4, rimFar(E) + 2]), look: r2v([E.x, E.y, rimFar(E) + 6]) },
    { name: 'fork', pos: r2v([D.x + 4, D.y + 22, D.z + 1]), look: r2v([D.x + 4, D.y, D.z + 1.5]) },
    { name: 'goal', pos: r2v([T.x - 8, T.y + 5.5, T.z - 7]), look: r2v([goalPos[0], T.y + 0.8, goalPos[2]]), fire: ['rune2'] },
    { name: 'onward', pos: r2v([goalPos[0] - dirX * 4.5, goalPos[1] + 2.2, goalPos[2] - dirZ * 4.5]), look: r2v([goalPos[0] + dirX * 20, goalPos[1] + 1.5, goalPos[2] + dirZ * 20]) }, // the play camera at the goal: Orren's workshop ahead
  ],
  cutscenes: { // cutscene.js: camera keys (shot name or pos/look), narrator lines, events, hero pose
    intro: { // the tale, then the call: the sealed stone first; the hero sleeps curled inside it; the Keepers' hum wakes the stone ring, the
      // stone tips open on 'Wake', he uncurls to a crouch and rises, and the camera settles behind him
      dur: 21.5,
      keys: [
        { at: 0, pos: [SPAWN[0] - 3.4, 1.4, SPAWN[2] - 4.6], look: [SPAWN[0], 1, SPAWN[2]], ease: 1 }, // the sealed stone
        { at: 4.5, pos: [-17, 2.5, -27], look: [0, 0.5, -8] }, // backs away: the island in the sky
        { at: 7.9, pos: [-7, 2.6, -2.5], look: [0, 0.8, -8] }, // round the stone, never through it
        { at: 9.8, pos: [4.5, 1.8, -0.5], look: [0, 0.6, -8] },
        { at: 11.6, shot: 'hero' },
        { at: 15.2, pos: [SPAWN[0] + 3.4, 2, SPAWN[2] + 4.6], look: [SPAWN[0], 0.5, SPAWN[2]], ease: 1 }, // holds on the stone through the call,
        { at: 17.4, pos: [SPAWN[0] + 2.7, 1.6, SPAWN[2] + 3.6], look: [SPAWN[0], 0.8, SPAWN[2]] }, // eases in as it opens and he uncurls; pulls back as he stands
        { at: 19.4, pos: r2v([SPAWN[0] - Math.sin(SH0) * 7.5, SPAWN[1] + 4.2, SPAWN[2] - Math.cos(SH0) * 7.5]), look: r2v([SPAWN[0] + Math.sin(SH0) * 6, SPAWN[1] + 1.2, SPAWN[2] + Math.cos(SH0) * 6]), ease: 1 }, // behind him, up at the way ahead
        { at: 21.5, pos: r2v([SPAWN[0] - Math.sin(SH0) * 5.8, SPAWN[1] + 3, SPAWN[2] - Math.cos(SH0) * 5.8]), look: r2v([SPAWN[0], SPAWN[1] + 1.4, SPAWN[2]]) }, // where the play camera takes over (camera.js ARM, PITCH, FOCUS_Y)
      ],
      lines: [
        { at: 0.4, dur: 4.6, text: { en: 'The Keepers sang a mountain into the sky…', ru: 'Хранители песней подняли гору в небо…', pt: 'Os Zeladores cantaram uma montanha até ao céu…' } },
        { at: 5.2, dur: 4.4, text: { en: 'Its stones had names, and the winds knew them all…', ru: 'У её камней были имена, и ветры знали их все…', pt: 'As suas pedras tinham nomes, e os ventos conheciam-nos todos…' } },
        { at: 10, dur: 4.6, text: { en: 'Then Orren tied every wind into one knot, and the stones fell asleep.', ru: 'Потом Оррен связал все ветры в один узел, и камни уснули.', pt: 'Depois Orren atou todos os ventos num só nó, e as pedras adormeceram.' } },
        { at: 15, dur: 5.2, text: { en: 'Wake, child of the last Keeper. Climb to the Crown and loosen the knot.', ru: 'Проснись, дитя последнего Хранителя. Поднимись к Короне и ослабь узел.', pt: 'Acorda, filho do último Zelador. Sobe à Coroa e afrouxa o nó.' } },
      ],
      events: [
        { at: 0, duck: { db: -9, seconds: 21.5 } },
        { at: 0.2, cue: 'wind', gain: 0.6 },
        { at: 9.6, cue: 'stones', gain: 0.5 },
        { at: 14.8, cue: 'hum', gain: 0.7 }, // the call
        { at: 14.8, wake: [4.2, 0, -4.5] }, // the stone ring wakes: the warm wave and its flowers run out over the grass
        { at: 15.4, wake: SPAWN },
        { at: 18.4, cue: 'wind', gain: 0.8 },
      ],
      rise: [{ at: 15.2, nodes: shell, stagger: 0.12, dur: 2.6, drop: 2.6, away: 1, tilt: -1.3 }], // the stone opens like petals (light falls in), then sinks
      hero: { path: [{ at: 0, pos: SPAWN, heading: SH0, clip: 'sleep' }, { at: 15.6, pos: SPAWN, heading: SH0, clip: 'wake' }, { at: 21.5, pos: SPAWN, heading: SH0 }] }, // curled asleep; on 'Wake' he uncurls, crouches, stands (hero_rig.py)
    },
    outro: { // the wind road: the freed rune raises a pier off the goal terrace, the wind opens along it toward Orren's workshop, the hero spreads the cloak and rides it
      dur: 12,
      keys: [
        { at: 0, shot: 'goal', ease: 1 },
        { at: 3.2, pos: r2v(road(-11, 2.6, 2)), look: r2v(road(3, 1)), ease: 1 }, // behind the hero: the pier rising, the road opening beyond it
        { at: 5.2, pos: r2v(road(-5, 3.2, 8.5)), look: r2v(road(2, 1.2)) }, // out round the terrace ruins
        { at: 7, pos: r2v(road(1, 2.4, 7)), look: r2v(road(6, 1.6)), ease: 1 }, // side-on at the pier end: the crouch and the lift
        { at: 9.5, pos: r2v(road(0, 3.6, 6)), look: r2v(road(18, 4.5)), ease: 1 },
        { at: 12, pos: r2v(road(-1, 4.4, 5)), look: r2v([nextIsl.x, nextIsl.y + 2, nextIsl.z]) }, // he shrinks along the road, the workshop ahead
      ],
      lines: [
        { at: 0.6, dur: 4.2, who: { en: 'Kamen', ru: 'Камень', pt: 'Kamen' }, voice: 'golem', text: { en: 'The stones remember their names. The wind remembers the road: it will carry you, as I carried the Keepers.', ru: 'Камни помнят свои имена. Ветер помнит дорогу: он понесёт тебя, как я носил Хранителей.', pt: 'As pedras recordam os seus nomes. O vento recorda o caminho: levar-te-á, como eu levei os Zeladores.' } },
        { at: 5.2, dur: 4.4, who: { en: 'Kamen', ru: 'Камень', pt: 'Kamen' }, voice: 'golem', text: { en: 'The winds are bound beyond — to Orren\'s totems. Set them loose.', ru: 'Дальше ветры привязаны к тотемам Оррена. Отпусти их.', pt: 'Os ventos estão atados mais adiante, nos totens de Orren. Solta-os.' } },
      ],
      events: [
        { at: 0, duck: { db: -8, seconds: 12 } },
        { at: 0.3, fire: 'rune2' },
        { at: 0.5, cue: 'hum', gain: 0.6 },
        { at: 1.2, cue: 'stones', gain: 0.6 },
        { at: 2.4, cue: 'wind', gain: 0.8 },
        { at: 7.6, cue: 'wind', gain: 1 },
      ],
      rise: [{ at: 1, nodes: exitSlabs.map((p) => p.name), stagger: 0.35, dur: 1.1, drop: 7 }],
      ribbon: { at: 2.4, grow: 4, pts: [exitAt(1, 0.9), road(6.4, 1.6), road(14, 3.6), road(30, 6.2), road(54, 8.2), road(NEXT_D - nextIsl.R - rimX, 7)].map(r2v) },
      hero: { keep: true, from: 'player', clip: 'land', at: 0.3, pose: [{ at: 0, land: 0 }, { at: 6.9, land: 0 }, { at: 7.5, land: 0.7 }, { at: 7.9, land: 0 }], path: [ // the level changes after: the hero stays on the road
        { at: 0, pos: r2v(goalPos), heading: HX },
        { at: 1.6, pos: r2v(goalPos), heading: HX, clip: 'walk' }, // 11.8 m in 5.2 s: a walk (cutscene.js RUN_AT), the pier is up by 2.8 s
        { at: 4.6, pos: r2v([T.x + dirX * (rimX - 0.6), T.y, T.z + dirZ * (rimX - 0.6)]), heading: HX, clip: 'walk' },
        { at: 6.8, pos: r2v(exitAt(2)), heading: HX }, // the pier end: he crouches into the wind (pose above)
        { at: 7.7, pos: r2v(exitAt(2)), heading: HX, clip: 'glide' }, // the road takes him: one flight, pace by the key times
        { at: 8.5, pos: r2v(road(7.6, 1.5)), heading: HX, clip: 'glide' },
        { at: 9.6, pos: r2v(road(14, 3.6)), heading: HX, clip: 'glide' },
        { at: 10.8, pos: r2v(road(30, 6.2)), heading: HX, clip: 'glide' },
        { at: 12, pos: r2v(road(48, 7.8)), heading: HX },
      ] },
    },
  },
  feasibility: K.feasibility(),
};

// ---------- R6 backtracking (own stream): two locks and the shortcut lift ----------
// L1a west of A: a rune on a floating stone past the rim, too far to sing; Name (l2) wakes it and a bridge rises to an islet with an
// echo, the first tale shard and Kamen's lost name-stone (his request: sung, it answers with Gust II). L1b east of C: an islet two
// air-dash bursts out (airdash, l3), with an echo, a tale shard and a cloak thread, and a wind cairn for the way back.
// Shortcut (U14): the old deck E <-> F mended with Name from F (trials below, fixed.pillarE; kept in the save by trials.js).
K.own(1601, () => {
  const R = makeR6(K, { world, collider, level, salt: 1601 });
  const la = R.nameLock({ id: 'lockA', from: A, th: Math.PI, out: 4.3, side: 2.4, up: 2.4, gap: 10.6, rewards: [{ id: 'echo_far' }, { id: 'tale1', relic: 'tale.1' }] });
  const ka = R.requestStone('kamen_name', la.islet, Math.PI, 'kamen');
  const lb = R.dashLock({ id: 'lockB', from: C, th: 0.5, gap: 7.9, dy: -1.1, rewards: [{ id: 'echo_gap' }, { id: 'tale2', relic: 'tale.2' }, { id: 'thread_l1', relic: 'thread.l1' }] });
  const S2 = K.isl.safe2, [bx, bz] = [S2.x - lb.islet.x, S2.z - lb.islet.z], bl = Math.hypot(bx, bz), bm = lb.islet.R + (bl - lb.islet.R - S2.R) / 2; // a stone down to safe2
  const st = R.stone('lockB_st', lb.islet.x + (bx / bl) * bm, lb.islet.z + (bz / bl) * bm, lb.islet.y - 1.6);
  R.finish();
  const LB = lb.islet, LA = la.islet, rimA = R.standAt(A, Math.PI, 0.3), rimLA = R.standAt(LA, 0, 0.3);
  level.mechanisms.push(...la.mechanisms, ka.mechanism);
  level.echoSlots.push(...[...la.rewards, ...lb.rewards].map(({ relic, ...e }) => ({ ...e, ...(relic && { relic }), note: 'R6 lock reward' })));
  level.checkpoints.push({ id: 'c_lockB', pos: r2v([LB.x, LB.y, LB.z]), r: 2.2, heading: facing([LB.x, 0, LB.z], [C.x, 0, C.z]), wind: true });
  level.triggers.push({ id: 't_kamen_lost', shape: { kind: 'poly', pts: poly(A.x - 4, A.z - 3, A.x + 4, A.z + 3) }, talk: 'pebble_lost', ifFlag: 'gift.name', once: true });
  level.npcs[0].talk.push({ id: 'pebble_lost', lines: [
    { en: '...one of my names... the wind took it west, past the edge... a stone on a stone. Sing it home?', ru: '...одно моё имя... ветер унёс его на запад, за край... камень на камне. Споёшь ему дорогу домой?', pt: '...um dos meus nomes... o vento levou-o para oeste, além da beira... uma pedra sobre uma pedra. Cantas-lho de volta?' },
  ] }, { id: 'pebble_home', on: 'switch.kamen_name', lines: [
    { en: '...I hear it. All my names. Take my Gust again, little wind: it carries further now.', ru: '...Слышу. Все мои имена. Возьми мой Порыв снова, ветерок: теперь он летит дальше.', pt: '...ouço-o. Todos os meus nomes. Toma outra vez a minha Rajada, pequeno vento: agora chega mais longe.' },
    { en: '...my brother\'s name is cut somewhere on the Crown. If you pass it... sing it for me.', ru: '...имя моего брата высечено где-то на Короне. Если пройдёшь мимо... спой его для меня.', pt: '...o nome do meu irmão está gravado algures na Coroa. Se passares por ele... canta-o por mim.' },
  ] }, { id: 'brother_home', on: 'world.kamen.brother', lines: [
    { en: '...you sang his name. Up on the Crown, he heard. He was never lost: just standing very still.', ru: '...ты спел его имя. Там, на Короне, он услышал. Он не терялся: просто стоял очень тихо.', pt: '...cantaste o nome dele. Lá em cima, na Coroa, ele ouviu. Nunca esteve perdido: estava só muito quieto.' },
  ] }, { id: 'menhir_joke', on: 'switch.menhir_l1', lines: [
    { en: '...that one is only a rock, little wind. I sang to it for a century. Good listener, though.', ru: '...это просто камень, ветерок. Я пел ему сто лет. Зато хорошо слушает.', pt: '...essa é só uma rocha, pequeno vento. Cantei-lhe durante um século. Mas é boa ouvinte.' },
  ] });
  { // a singable menhir in the spawn ring (Name, again and again): it never answers (meta.js 'menhir' secret counts the songs)
    const mh = decor.find((d) => d.glb === MENHIR);
    if (mh) {
      level.mechanisms.push({ id: 'menhir_l1', kind: 'switch', pos: mh.pos, r: 2.0, targets: [], once: false, far: true, menhir: true });
      const c = [I.start.x + 4.2, I.start.z - 4.5].map(r2); // the ring's middle: revisit sings it ten times first (meta 'menhir' secret)
      level.actions.unshift({ at: c, r: 0.6, do: 'go', home: 12, profiles: ['revisit'] }, ...Array.from({ length: 10 }, () => ({ at: c, r: 1, do: 'song', song: 'name', face: [mh.pos[0], mh.pos[2]].map(r2), profiles: ['revisit'] })));
    }
  }
  const v = (pts) => pts.map((p) => p.map(r2));
  const after = (pred, acts) => level.actions.splice(level.actions.findIndex(pred) + 1, 0, ...acts.map((a) => ({ profiles: ['revisit'], ...a })));
  const roundA = [A.x - 2.2, A.z - 2.4]; // round name1's stone and the pillar
  after((a) => a.switch === 'name1', [
    { at: v([roundA])[0], r: 0.5, do: 'go' },
    { at: la.stand, r: 0.5, do: 'go' },
    { at: la.stand, r: 0.6, do: 'song', song: 'name', face: [la.rune.pos[0], la.rune.pos[2]].map(r2), until: 'switch.lockA' },
    { at: la.stand, r: 0.8, do: 'wait', until: 'raised.lockA_br' },
    ...v([rimA, rimLA, [LA.x, LA.z]]).map((p) => ({ at: p, r: 0.5, do: 'go' })),
    ...la.rewards.map((e) => ({ at: [e.pos[0], e.pos[2]], r: 0.4, do: 'go' })),
    { at: ka.spot, r: 0.6, do: 'sing', switch: 'kamen_name', until: 'switch.kamen_name' },
    ...v([rimLA, rimA, roundA]).map((p) => ({ at: p, r: 0.5, do: 'go' })),
  ]);
  after((a) => a.until === 'top.golem', [
    ...v([[C.x, C.z], [C.x + 1.5, C.z + 3.5]]).map((p) => ({ at: p, r: 0.6, do: 'go' })), // north of pillar_c1
    { at: v([[C.x + 1.5, C.z + 3.5]])[0], r: 0.8, do: 'dash', air: 2, to: v([[LB.x, LB.z]])[0] },
    ...lb.rewards.map((e) => ({ at: [e.pos[0], e.pos[2]], r: 0.4, do: 'go' })),
    { at: v([[LB.x, LB.z]])[0], r: 0.5, do: 'go' }, // the way back: down to safe2, its hops up to C
    ...v([[st.x, st.z], [S2.x, S2.z], [K.isl.s3.x, K.isl.s3.z], [K.isl.s4.x, K.isl.s4.z], [C.x, C.z]]).map((p) => ({ at: p, r: 0.6, do: 'go' })),
  ]);
  level.shots.push(
    { name: 'lockA', pos: r2v([A.x + 2, A.y + 4.5, A.z - 9]), look: r2v([la.rune.pos[0], A.y + 1, la.rune.pos[2]]) },
    { name: 'lockA_open', pos: r2v([A.x + 2, A.y + 4.5, A.z - 9]), look: r2v([la.rune.pos[0], A.y + 1, la.rune.pos[2]]), fire: ['lockA'] },
    { name: 'lockB', pos: r2v([C.x - 3, C.y + 5, C.z - 10]), look: r2v([LB.x, LB.y, LB.z]) },
  );
});

// ---------- R4 / U4: the load-bearing pillar (trials.js) ----------
// An old stone deck ran beside the crumble row E -> F on a cracked pillar standing in the void past E's rim. The pillar leans broken
// and the deck hangs off its far hinge on F: the first way over is the crumble row (kit-checked above). From F, Name (a return
// visit: it is Sigh's gift) stands the pillar up and the deck swings back onto it: the way back, fixed.pillarE. A staff hit or a
// Gust on the mended pillar drops it again (broken.pillarE). revisit mends it and walks the deck there and back.
{
  const DX = 3.5, out = (isl0, z) => Math.hypot(DX, z - isl0.z) > isl0.rim(Math.atan2(z - isl0.z, DX));
  let zE = E.z; while (!out(E, zE)) zE += 0.05;
  let zF = F.z; while (!out(F, zF)) zF -= 0.05;
  const a = [E.x + DX, E.y, zE - 0.3].map(r2), b = [F.x + DX, F.y, zF + 0.6].map(r2), post = [r2(a[0] + 1.2), r2(E.y - 7), r2(a[2] + 0.9)];
  level.shots.push({ name: 'shortcut', pos: r2v([a[0] + 10, E.y + 5, (a[2] + b[2]) / 2 - 3]), look: r2v([a[0], E.y, (a[2] + b[2]) / 2]) });
  level.trials = [{ id: 'pillarE', kind: 'pillar', repair: true, pos: post, h: r2(E.y + 1.6 - post[1]), r: 0.55, fall: [1, 0.3], deck: { a, b, w: 2, t: 0.5 } }];
  { // U4: with the E deck down from the start, the R4 mistake of a first visit is a lookout stub off G's west rim on its own cracked post: worst Gusts the post (broken.pillarG)
    const ux = -0.985, uz = 0.17, rim = G.rim(Math.atan2(uz, ux)), at = (k, s = 0) => [G.x + ux * (rim + k) - uz * s, G.y, G.z + uz * (rim + k) + ux * s].map(r2);
    const gb = at(-0.5), ga = at(2.4), gp = at(1.6, 1.2);
    level.trials.push({ id: 'pillarG', kind: 'pillar', pos: [gp[0], r2(G.y - 7), gp[2]], h: 8.6, r: 0.55, fall: [ux, uz], deck: { a: ga, b: gb, w: 1.6, t: 0.5 } });
    level.actions.splice(level.actions.findIndex((x) => x.song === 'gust' && x.at[0] === r2(G.x + 0.5)), 0,
      { at: [gb[0], gb[2]], y: G.y, r: 0.6, do: 'song', song: 'gust', face: [gp[0], gp[2]], home: 6, profiles: ['worst'] }); // home 6: the stub is ~5 m off the route over G
  }
  const fi = level.actions.findIndex((x) => x.enemy === 'thF'), far = [b[0], b[2] + 1.5].map(r2); // revisit, once over the crumbles and before the thief on F
  level.actions.splice(fi, 0,
    { at: far, r: 0.6, do: 'song', song: 'name', face: [b[0], b[2] - 3].map(r2), until: 'fixed.pillarE', home: 8, profiles: ['revisit'] },
    { at: far, r: 0.8, do: 'wait', until: 'raised.pillarE', profiles: ['revisit'] },
    ...[[a[0], a[2] - 0.8], far].map((q) => ({ at: q.map(r2), r: 0.7, do: 'go', home: 30, profiles: ['revisit'] }))); // over the mended deck and back
}

// U25 the Anchor revisit lock (lockC): a row of sinking stones off k1's east rim to a far islet with a shard of echo; each stone
// drops at a touch, the Anchor (l3) holds the row. lockA (Name, the corded totem above) stays the cord-bound cave; no second Name lock.
K.own(1604, () => {
  const R = makeR6(K, { world, collider, level, salt: 1604 }), K1 = K.isl.k1;
  const lc = R.anchorLock({ id: 'lockC', from: K1, th: 0, gap: 16, rewards: [{ id: 'echo_hold' }] });
  R.finish();
  level.mechanisms.push(...lc.mechanisms);
  level.echoSlots.push(...lc.rewards.map((e) => ({ ...e, note: 'R6 lock reward (Anchor)' })));
  const rim = R.standAt(K1, 0, 0.3), isl = [lc.islet.x, lc.islet.z].map(r2), back = R.standAt(lc.islet, Math.PI, 1.2); // U25: 1.2 in, an overshoot at 0.3 stepped on the crumble row and fell
  const visit = [{ at: [K1.x, K1.z].map(r2), r: 0.6, do: 'go' }, { at: lc.stand, r: 0.5, do: 'go' },
    { at: lc.stand, r: 0.6, do: 'song', song: 'anchor', face: rim.map(r2), hold: 1.6 }, { at: isl, r: 0.6, do: 'go' },
    ...lc.rewards.map((e) => ({ at: [e.pos[0], e.pos[2]], r: 0.4, do: 'go' })),
    { at: back.map(r2), r: 0.5, do: 'go' }, { at: back.map(r2), r: 0.6, do: 'song', song: 'anchor', face: lc.stand, hold: 1.6 }, { at: lc.stand, r: 0.6, do: 'go' }, { at: [K1.x, K1.z].map(r2), r: 0.6, do: 'go' }];
  const k3 = level.actions.findIndex((a) => a.do === 'dash' && a.air && Math.hypot(a.at[0] - K.isl.k3.x, a.at[1] - K.isl.k3.z) < 3); // before the k3 -> D dash
  level.actions.splice(k3, 0, ...visit.map((a) => ({ profiles: ['revisit'], ...a })));
  level.shots.push({ name: 'lockC', pos: r2v([K1.x - 3, K1.y + 4, K1.z - 6]), look: r2v([lc.islet.x, K1.y, lc.islet.z]) });
});

await K.write({ world, collider, inst, level, gates: [{ song: 'gust', edges: [['D', 'E']], nodes: ['mech_lift'] }], decor: [...decor, ...farDecor] });
