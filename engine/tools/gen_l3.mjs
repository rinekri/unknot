// Level l3 "Crown of Winds" (0 -> -10 m -> +25 m, ~150 s). Beats:
//   0. a descent into the low ruins (-10 m): hops, then a crumble spiral (seven pads round a 240 deg arc, stepping down);
//   1. a timed bridge: a rune hidden four hops west of V raises it for a while (flicker + tick before it sinks); a nook below its foot;
//   2. crumble pads (0.5 s) and an air dash off the last one;
//   3. the dam: a cracked wall across the ledge; breaking it frees a tailwind over the gap and the updraft beyond (it feeds it);
//   4. the fork, both lanes asleep until two runes hidden west of Z sing in order (far A, then B: it wakes the lift and the
//      fast lane's updraft at once): safe = the lift and two hops; fast = a dash chain: an air dash onto fa, crumble pads into an air dash,
//      an updraft, two air dashes in one jump to CB (echo on its top);
//   5. the crown: five cycling updrafts spiral up, then a second timed bridge (stairs; its rune hidden four hops west of k5) to the
//      crown terrace (+25 m).
//   6. Orren's Remnant (npc.js): debris rings turn round the arch; three runes inside the pillar ring each unwind one ring
//      and play a line. The goal opens once the third talk's last line ends (goal.after npc.orren.free, set by its `end`).
// Writes ../assets/levels/l3/{level.json,world.glb,collider.glb,placement.json}. Usage: node tools/gen_l3.mjs   (npm run gen-l3)
import { makeKit, THREE, TUNING, jumpReach, RUNE, PILLAR, TREE, ARCH, STAIRS, SHRINE, RUBBLE, KNOT, r2, r2v, poly, facing } from './lib/kit.mjs';
import { makeR6 } from './lib/r6.mjs';

const SEED = 3301;
const K = makeKit(SEED, new URL('../../assets/levels/l3/', import.meta.url));
const { rr, isl, island, chain, rimGap, rimFar, rimNear } = K;
const rimE = (a) => a.x + a.rim(0), rimW = (a) => a.x - a.rim(Math.PI);

// ---------- layout ----------
const TAIL = 4, LIFT = 40, CYCLE = [3.5, 0.5, 1.5], HOLD = 14, HOLD2 = 14, CRD = 0.5; // tailwind m/s, updraft m/s^2, crown updraft cycle, bridge hold s, crumble delay s
const CR = { gap: 1.6, len: 3.0 };
isl.start = island('start', 0, 0, 0, 9);
chain('d1', isl.start, 2.6, 35, -1.2, 3.1);
chain('d2', isl.d1, 2.9, -30, -2.0, 2.5);
chain('d3', isl.d2, 2.6, 20, -1.5, 2.9);
chain('d4', isl.d3, 2.9, -35, -1.9, 2.4);
chain('d5', isl.d4, 2.7, 12, -1.4, 2.7);
chain('V', isl.d5, 2.8, 0, -1.5, 7);
const V = isl.V, BRIDGE_GAP = 9.5;
chain('nook', V, 2.0, 30, -1.0, 2.2); // below the bridge foot, beside it
chain('W', V, BRIDGE_GAP, 0, 0, 6);
const W = isl.W, NCR = 3, DGAP = 5.0;
chain('X', W, NCR * (CR.len + CR.gap) + DGAP, 0, 0, 6);
const X = isl.X, WGAP = 4.6;
chain('Y', X, WGAP, 0, 0, 7);
const Y = isl.Y;
const upY = K.tower('y', Y, [{ deg: 0, rise: 4, R: 7 }])[0];
const Z = isl.y1, LIFTUP = 4, PADGAP = 2.0;
// fork, safe lane: rune lift Z -> sa (+4 m), hops sa -> sb -> CB
isl.sa = island('sa', Z.x, 0, Z.y + LIFTUP, 3, { wallDown: LIFTUP + 0.8, depth: 4.5 });
isl.sa.z = rimFar(Z) + PADGAP + isl.sa.rim(-Math.PI / 2);
const SA = isl.sa;
chain('sb', SA, 2.8, 0, 0, 2.6);
chain('CB', isl.sb, 2.8, 0, 0, 6);
const CB = isl.CB;
// fork, fast lane (built back from CB): fu1 sits a dash gap east of CB, fb under it (updraft), crumbles from fa (a hop east of Z)
const FUR = 3, FBR = 3.5, FDGAP = 8.6, FRISE = LIFTUP + 1, ZDGAP = 5.0, FCDGAP = 5.0; // fu1 -> CB two dashes (1 m drop); Z -> fa and the last crumble -> fb one dash
const fuX = rimE(CB) + FDGAP + FUR;
isl.fb = island('fb', fuX, CB.z - (FBR * 0.38 + FUR), Z.y, FBR);
const upF = K.tower('fu', isl.fb, [{ deg: 0, rise: FRISE, R: FUR }])[0];
const FB = isl.fb, FU = isl.fu1;
isl.fa = island('fa', fuX, Z.z, Z.y, fuX - rimE(Z) - ZDGAP);
const FA = isl.fa;
const fspan = rimNear(FB) - rimFar(FA), NF = Math.round((fspan - FCDGAP) / (CR.len + CR.gap)), FLEN = (fspan - FCDGAP - NF * CR.gap) / NF;
if (FLEN < 2.6 || FLEN > 3.6) throw new Error(`fast crumble pads ${NF} x ${FLEN.toFixed(2)} m do not fit a running jump`);
// crown: five cycling updrafts spiralling up from CB, then two hops to the crown terrace (+25)
const crownT = K.tower('k', CB, [0, 90, 180, 270, 0].map((deg) => ({ deg, rise: 5, R: 4.5, cycle: CYCLE })));
chain('g1', isl.k5, 2.6, 0, 1, 2.6);
chain('crown', isl.g1, 2.6, 0, 1, 8);
const G = isl.crown, I = isl, K5 = isl.k5;
// crumble spiral d2 -> d4: d3 and g1 are placed (their seed draws and everything chained after them stay), then dropped
const spiral = (() => {
  const a = I.d2, b = I.d4, L = Math.hypot(b.x - a.x, b.z - a.z), ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, Rs = L / Math.sqrt(3); // 240 deg arc: chord = Rs * sqrt 3
  const c = [(a.x + b.x) / 2 + uz * Rs / 2, (a.z + b.z) / 2 - ux * Rs / 2], P = (t) => [c[0] + Rs * Math.cos(t), c[1] + Rs * Math.sin(t)]; // centre east of the chord
  const ta = Math.atan2(a.z - c[1], a.x - c[0]); let tb = Math.atan2(b.z - c[1], b.x - c[0]); if (tb < ta) tb += 2 * Math.PI;
  const off = (isl0, t, dir) => { while (Math.hypot(P(t)[0] - isl0.x, P(t)[1] - isl0.z) < isl0.rim(Math.atan2(P(t)[1] - isl0.z, P(t)[0] - isl0.x))) t += dir * 0.002; return t; };
  const t0 = off(a, ta, 1), t1 = off(b, tb, -1), arc = Rs * (t1 - t0), n = Math.round((arc - CR.gap) / (CR.len + CR.gap)), len = (arc - (n + 1) * CR.gap) / n;
  if (len < 2.6 || len > 3.6) throw new Error(`crumble spiral ${n} x ${len.toFixed(2)} m`);
  return Array.from({ length: n }, (_, i) => {
    const t = t0 + (CR.gap + len / 2 + i * (len + CR.gap)) / Rs, [x, z] = P(t);
    return { name: `mech_spiral_${i}`, x, z0: z - len / 2, z1: z + len / 2, w: 2.2, top: a.y + ((b.y - a.y) * (i + 1)) / (n + 1) + [0.03, 0.06, 0.02, 0.05, 0.04][i % 5] - 0.04, rotY: -t, t, len };
  });
})();
delete isl.d3; delete isl.g1;
// R7 hidden switches on their own seeded streams (the play layout keeps its draws): runeV four hops west of V, the lift/upF rune
// pair four hops west of Z (B on the way, A at the end: sing A, then B), runeK four hops west of k5. Veins: level.js.
const hops = (p, from, salt, R = 3) => K.own(salt, () => { const j = salt % 2 ? [[2.55, -74, 0.8, 3.0], [2.7, -44, 0.3, 2.2], [2.55, -130, 0.7, 2.8], [2.7, -80, 0.2, 2.1]] : [[2.7, -102, 0.3, 2.1], [2.55, -52, 0.8, 2.9], [2.7, -112, 0.2, 2.3], [2.55, -84, 0.7, 3.0]]; // no two hop chains alike
  j.forEach((a, i) => chain(`${p}${i + 1}`, i ? isl[`${p}${i}`] : from, ...a)); chain(`${p}H`, isl[`${p}4`], 2.6, -90, 0.5, R); });
hops('hv', V, 801, 4); hops('hz', Z, 802); hops('hk', K5, 803); // hv: the gust stone's islet, bigger so it reads from V
// R2: the Name rune on its own seeded stream, out of reach 3.5 m above W's far rim beside the crumble row: sung awake from the rim
// (level.js NAME_R 6 m) it fills the breath (player.js breath.nearFar). best only: the Anchor [3] held over the row is the beat
K.own(804, () => chain('far', W, 2.0, -30, 3.5, 1.4));
const Far = I.far, spotW = [W.x - 0.5, rimFar(W) - 1.1];
if (Math.hypot(Far.x - spotW[0], Far.z - spotW[1]) > 5.8) throw new Error('R2: the far rune is out of the Name song reach from W rim');
// R5 hung slab (trials.js) on its own seeded stream: a 6.5 m gap east of the start, a slab on chains above it. Walk up and it creaks
// and lowers through the gap; Anchor it as its top passes the walkway and it holds a moment: walk across. The ledge (sl) is a dead
// end with a way back by two hops. The sky beyond: an air Gust's recoil.
const SLGAP = 6.5;
K.own(805, () => {
  chain('sl', I.start, SLGAP, 90, 0, 4.5); chain('sh1', I.sl, 2.8, 200, 0.2, 1.6);
  const b1 = I.sh1, st = I.start; chain('sh2', b1, 2.8, Math.atan2(st.x - b1.x, st.z - b1.z) * 180 / Math.PI, 0.2, (Math.hypot(st.x - b1.x, st.z - b1.z) - st.R - b1.R - 5.6) / 2);
});
const stacked = Object.values(I).flatMap((a) => Object.values(I).filter((b) => b.y - a.y >= 4).map((b) => [a.id, b.id])); // tower steps stand over lower islands
K.noOverlap([['V', 'nook'], ['y1', 'sa'], ['W', 'far'], ...stacked]); // far: 3.5 m above W, out of reach (R2 Name rune)

// pieces: timed bridge V -> W, crumbles W -> X and FA -> FB, lift Z -> SA
const bz0 = rimFar(V) - 0.7, bz1 = rimNear(W) + 0.7, NB = 5, OV = 0.05, BL = (bz1 - bz0 + OV * (NB - 1)) / NB;
const bridge = Array.from({ length: NB }, (_, i) => ({
  name: `mech_bridge_${i}`, x: V.x + rr(-0.15, 0.15), z0: bz0 + i * (BL - OV), z1: bz0 + i * (BL - OV) + BL, w: rr(1.7, 2.0),
  top: V.y + [0.02, 0.06, 0.03, 0.07, 0.04][i], rotY: rr(-0.05, 0.05),
}));
const crumbleRow = (prefix, a, n, len, k0) => Array.from({ length: n }, (_, i) => {
  const z0 = rimFar(a) + CR.gap + i * (len + CR.gap);
  return { name: `mech_${prefix}_${i}`, x: a.x + rr(-0.15, 0.15), z0, z1: z0 + len, w: rr(2.0, 2.3), top: a.y + [0.03, 0.06, 0.02, 0.05, 0.04][(i + k0) % 5], rotY: rr(-0.06, 0.06) };
});
const crW = crumbleRow('crumble', W, NCR, CR.len, 0);
// timed stair bridge k5 -> crown (runeK): rises 2 m in 7 even steps; down again HOLD2 s after it settles (the walk back from its rune)
const NB2 = 6, s2z0 = rimFar(K5) - 0.7, s2z1 = rimNear(G) + 0.7, SL2 = (s2z1 - s2z0 + OV * (NB2 - 1)) / NB2;
const stairs = Array.from({ length: NB2 }, (_, i) => ({ name: `mech_stairs_${i}`, x: K5.x, z0: s2z0 + i * (SL2 - OV), z1: s2z0 + i * (SL2 - OV) + SL2, w: 1.9, top: K5.y + ((G.y - K5.y) * (i + 1)) / (NB2 + 1), rotY: 0 }));
const crF = crumbleRow('crumblef', FA, NF, FLEN, 2);
const lift = { name: 'mech_lift', x: Z.x, z0: rimFar(Z) - 0.4, z1: rimNear(SA) + 0.1, w: 2.4, top: Z.y, rotY: 0 };
const liftC = [lift.x, (lift.z0 + lift.z1) / 2];
const damZ = rimFar(X) - 2.2;

// wind boxes: tailwind X -> Y and the Y updraft start still (the dam holds them); the fast-lane updraft always blows
const wTail = { min: [X.x - 2.5, X.y - 1.5, damZ + 0.4], max: [X.x + 2.5, X.y + 3.5, rimNear(Y) + 2.5] };

// props: runes face their strike spots (+Z front turned by rotY: pi/2 faces +X)
const endRune = (id, h) => ({ id, glb: RUNE, pos: [h.x - 1.2, h.y, h.z], rotY: Math.PI / 2 }); // at a detour's end hop, facing back east
const runeV = endRune('runeV', I.hvH), runeK = endRune('runeK', I.hkH), seqA = endRune('seqA', I.hzH);
const runeN = { id: 'runeN', glb: RUNE, pos: [Far.x, Far.y, Far.z], rotY: facing([Far.x, 0, Far.z], [spotW[0], 0, spotW[1]]) }; // faces the rim spot
const seqB = { id: 'seqB', glb: RUNE, pos: [I.hz2.x, I.hz2.y, I.hz2.z + 1.4], rotY: Math.PI }; // beside the path on the way out
const goalPos = [G.x, G.y, G.z + 1];
const ring = Array.from({ length: 7 }, (_, k) => { // broken ring of pillars round the crown, open to the south (the approach)
  const a = -Math.PI / 2 + 0.9 + k * ((2 * Math.PI - 1.8) / 6), r = rr(5.8, 6.6);
  return { id: `crown_${k}`, glb: PILLAR, pos: [goalPos[0] + Math.cos(a) * r, G.y, goalPos[2] + Math.sin(a) * r], rotY: rr(-3, 3), scale: rr(0.95, 1.4) };
});
ring[0].pos = [goalPos[0] + Math.cos(0.45) * 6.2, G.y, goalPos[2] + Math.sin(0.45) * 6.2]; // between crown_1 and crown_2: clear of Orren's plinth (> 3 m)
const props = [
  { id: 'pillar_s1', glb: PILLAR, pos: [-4.8, 0, -5.2], rotY: 0.4, scale: 1.2 },
  { id: 'pillar_s2', glb: PILLAR, pos: [4.6, 0, 1.5], rotY: 1.2, scale: 0.9 },
  runeV, seqA, seqB, runeK, runeN,
  { id: 'pillar_v1', glb: PILLAR, pos: [V.x + 4.2, V.y, V.z - 2.2], rotY: 0.6, scale: 1.1 },
  { id: 'pillar_w1', glb: PILLAR, pos: [W.x - 3.4, W.y, W.z + 1], rotY: 0.2 },
  { id: 'pillar_x1', glb: PILLAR, pos: [X.x + 3.6, X.y, X.z - 1.2], rotY: 1.4, scale: 1.2 },
  { id: 'pillar_y1', glb: PILLAR, pos: [Y.x - 4.2, Y.y, Y.z - 2.4], rotY: 0.9 },
  { id: 'pillar_cb', glb: PILLAR, pos: [CB.x - 3.6, CB.y, CB.z - 1.5], rotY: 0.3, scale: 1.1 },
  ...ring,
];

const SPAWN = [0, 0, -5];
const spotK = [runeK.pos[0] + 1.5, runeK.pos[2]], spotV = [runeV.pos[0] + 1.5, runeV.pos[2]], spotA = [seqA.pos[0] + 1.5, seqA.pos[2]], spotB = [I.hz2.x, I.hz2.z - 0.1], spotDam = [X.x, damZ - 1.4];
const at = (k) => [I[k].x, I[k].y, I[k].z];
const outBack = (p, spot, h, mid = []) => { const out = [at(`${p}1`), ...mid, at(`${p}3`), at(`${p}4`), [spot[0], h.y, spot[1]]]; return [...out, ...out.slice(0, -1).reverse()]; }; // a detour, there and back
const mid = (p) => [p.x, p.top, (p.z0 + p.z1) / 2];
// updraft climb (kit.tower step): walk to the near-rim updraft, ride it, step onto the upper island
const climb = ({ lo, hi, deg, near }) => {
  const ux = Math.round(Math.sin(deg * Math.PI / 180)), uz = Math.round(Math.cos(deg * Math.PI / 180)), o = (k) => [near[0] + ux * k, near[1] + uz * k];
  const a = o(-3), b = o(-0.9), c = o(1.8);
  return [[a[0], lo.y, a[1]], [b[0], lo.y, b[1]], [c[0], hi.y, c[1]], [hi.x, hi.y, hi.z]];
};
let route = [
  SPAWN, [-1, 0, 4], at('d1'), at('d2'), ...spiral.map(mid), at('d4'), at('d5'),
  [V.x, V.y, rimNear(V) + 1.5], [V.x - 3, V.y, V.z], ...outBack('hv', spotV, I.hvH, [at('hv2')]), [V.x - 2, V.y, V.z + 1], [V.x, V.y, rimFar(V) - 1.1],
  ...bridge.map(mid), [W.x, W.y, rimNear(W) + 1.5], [W.x, W.y, rimFar(W) - 1.1], ...crW.map(mid),
  [X.x, X.y, rimNear(X) + 1.5], [spotDam[0], X.y, spotDam[1]], [X.x, X.y, rimFar(X) - 1.1],
  [Y.x, Y.y, rimNear(Y) + 1.5], ...climb(upY), [Z.x - 3, Z.y, Z.z], ...outBack('hz', spotA, I.hzH, [[spotB[0], I.hz2.y, spotB[1]]]),
  [Z.x + 2, Z.y, Z.z], [rimE(Z) - 1.1, Z.y, Z.z], [rimW(FA) + 1.1, FA.y, FA.z], [FA.x, FA.y, FA.z], [FA.x, FA.y, rimFar(FA) - 1.1], ...crF.map(mid),
  [FB.x, FB.y, rimNear(FB) + 1.2], ...climb(upF), [rimW(FU) + 1.1, FU.y, FU.z], [rimE(CB) - 1.5, CB.y, CB.z],
  ...crownT.flatMap(climb), [K5.x - 2.5, K5.y, K5.z], ...outBack('hk', spotK, I.hkH, [at('hk2')]), [K5.x, K5.y, K5.z], [K5.x, K5.y, rimFar(K5) - 1.1], ...stairs.map(mid), [G.x, G.y, rimNear(G) + 1.5], goalPos,
].map((w) => [r2(w[0]), r2(w[1]), r2(w[2]), 0]);

// decor: clear of the route, wind boxes, strike spots, the lift and the goal ring
const inBox = (x, z, b, m) => x > b.min[0] - m && x < b.max[0] + m && z > b.min[2] - m && z < b.max[2] + m;
const boxes = [wTail, upY.box, upF.box, ...crownT.map((t) => t.box)];
// the far totem stands clear: nothing in the sight line from 13 m out past the song spot to the totem
const sight = (x, z, r) => { const ax = Far.x, az = Far.z, dx = spotW[0] - ax, dz = spotW[1] - az, n = Math.hypot(dx, dz), bx = ax + dx / n * 13, bz = az + dz / n * 13;
  const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / 169)); return Math.hypot(x - ax - u * (bx - ax), z - az - u * (bz - az)) > r + 3; };
const keep = (x, z, r) => sight(x, z, r) && !boxes.some((b) => inBox(x, z, b, r + 0.5)) && [spotV, spotA, spotB, spotK, spotDam, liftC, spotW].every(([sx, sz]) => Math.hypot(x - sx, z - sz) > r + 1.8) && Math.hypot(x - liftC[0], z - liftC[1]) > r + 4.5 && // the lift's iron reads from the approach
  Math.hypot(x - goalPos[0], z - goalPos[2]) > r + 2.6 && !(Math.abs(x - X.x) < r + 2 && Math.abs(z - damZ) < r + 1.5);
const lean = (base) => (x, z, rd) => base + (rd() - 0.5) * 0.35;
const decor = K.decorate([
  { on: G, glb: ARCH, s: [1.0, 1.1] },
  { on: G, glb: SHRINE, s: [0.85, 0.9] }, { on: G, glb: TREE, s: [0.95, 1.1], yaw: lean(Math.PI) }, { on: G, glb: RUBBLE, n: 2, s: [0.85, 1.0] },
  { on: I.start, glb: TREE, s: [0.95, 1.05], yaw: lean(Math.PI) }, { on: I.start, glb: RUBBLE, s: [0.85, 1.0] },
  { on: V, glb: STAIRS, s: [0.85, 1.0] }, { on: V, glb: RUBBLE, s: [0.85, 1.0] },
  { on: W, glb: TREE, s: [0.9, 1.0], yaw: lean(Math.PI) }, { on: X, glb: RUBBLE, s: [0.85, 1.0] },
  { on: Y, glb: TREE, s: [0.85, 1.0], yaw: lean(Math.PI) }, { on: Z, glb: STAIRS, s: [0.8, 0.95] }, { on: Z, glb: RUBBLE, s: [0.85, 1.0] },
  { on: CB, glb: TREE, s: [0.9, 1.05], yaw: lean(Math.PI) }, { on: I.k2, glb: RUBBLE, s: [0.85, 1.0] }, { on: I.k4, glb: TREE, s: [0.8, 0.95], yaw: lean(Math.PI) },
], { route, props, keep });
const shrine = decor.find((d) => d.glb === SHRINE), arch = decor.find((d) => d.glb === ARCH);
// Orren's Remnant (orren.glb, npc.js) stands on the arch's spot (decor is placed first, so its seed draws stay), turned to face
// the gap between the route's approach and the goal. Its own boxes replace the arch's (plinth + step, pillars, figure, arch top);
// the arch itself is not written to placement. Rune i sits in its model (rune1 +x pillar, rune2 -x pillar, rune3 in the seated figure's face): the
// switch is the strike spot in front of it (local x, z below), r 1.15, > 2.3 m apart so one strike reaches one rune. The route
// visits them round the front (approach side first) before the goal.
const ORREN_SPOTS = { orren1: [2.2, 0.65], orren2: [-2.2, 0.65], orren3: [0, 1.9] }, ORREN_VISIT = ['orren2', 'orren3', 'orren1'];
const orrenAim = at('k4'); // faces the climb (c_k4): seen front-on from the approach, not edge-on
Object.assign(arch, { scale: 1, rotY: Math.atan2(orrenAim[0] - arch.pos[0], orrenAim[2] - arch.pos[2]),
  boxes: [[3.5, 0.26, 1.7, 0, 0], [1.8, 0.14, 0.6, 0.1, 1.0], [0.45, 2.6, 0.45, 1.25, 0], [0.45, 2.6, 0.45, -1.25, 0], [0.9, 1.75, 0.9, 0, 0, 0.26], [3.0, 0.6, 0.45, 0, 0, 3.6]] });
const orren = Object.entries(ORREN_SPOTS).map(([id, [lx, lz]]) => {
  const c = Math.cos(arch.rotY), s = Math.sin(arch.rotY), spot = [arch.pos[0] + lx * c + lz * s, arch.pos[2] - lx * s + lz * c];
  return { id, pos: [spot[0], G.y, spot[1]], spot };
});
for (const o of orren) if (Math.hypot(o.spot[0] - G.x, o.spot[1] - G.z) > 6.5) throw new Error(`${o.id} strike spot near the crown rim`);
for (const p of ring) if (Math.hypot(p.pos[0] - arch.pos[0], p.pos[2] - arch.pos[2]) < 4.8) throw new Error(`${p.id} crowds Orren`); // plinth half-width 1.75 + 3 m
const orrenVisit = ORREN_VISIT.map((id) => orren.find((o) => o.id === id));
route.splice(-1, 0, ...orrenVisit.map((o) => [r2(o.spot[0]), G.y, r2(o.spot[1]), 0]));
// R3 Knot Shards (enemies.js): a Warden patrolling Y across the way, a Squall over CB (the climb's foot), and the Knot Warden on
// the crown's west half (Orren's posts sit east) with its three Squalls for phase 1. Name motifs tighten: 2 notes -> 4.
const ENEMIES = [
  { id: 'wdY', kind: 'warden', pos: r2v([Y.x, Y.y, Y.z + 1]), path: [[Y.x - 3, Y.z + 1], [Y.x + 3, Y.z + 1]].map((q) => q.map(r2)), motif: 'SLS' },
  { id: 'sqCB', kind: 'squall', variant: 'pull', pos: r2v([CB.x + 2, CB.y, CB.z - 1.8]), aggro: 4.5, motif: 'LSL' }, // l3's pull squall, on the hub's arrival side: its drag brings the hero in, its throw lands him mid-hub (north, in up_k1's box, it threw him up the crown past both shards)
  { id: 'thCB', kind: 'squall', variant: 'thief', pos: r2v([CB.x - 2.5, CB.y, CB.z - 1.5]), r: 6.5, motif: 'SSL', behind: 'sqCB' }, // with the Squall: one shoves while the other takes the breath for the Gust
  { id: 'gdV', kind: 'warden', guard: 'runeV', pos: r2v([I.hvH.x - 0.6, I.hvH.y, I.hvH.z + 1.7]), path: [[r2(I.hvH.x - 0.6), r2(I.hvH.z + 1.7)], [r2(I.hvH.x - 0.6), r2(I.hvH.z + 1.7)]], motif: 'LSS', ties: [r2v([runeV.pos[0], runeV.pos[1] + 0.9, runeV.pos[2]])] }, // a rune guard on the bridge rune's islet (4 m: its shove is short)
  { id: 'kw', kind: 'boss', pos: r2v([G.x - 3.5, G.y, G.z + 2]), r: 5.5, minions: ['kw1', 'kw2', 'kw3'], motifs: ['SL', 'LSL', 'SLSL'], ties: orren.map((o) => r2v([o.pos[0], o.pos[1] + 0.9, o.pos[2]])) }, // wakes once the hero is past the stair head
  ...[[-5, 0.5], [-2, 4.5], [-3.5, 4]].map(([dx, dz], i) => ({ id: `kw${i + 1}`, kind: 'squall', boss: 'kw', pos: r2v([G.x + dx, G.y, G.z + dz]), r: 8, aggro: 8, motif: 'SL' })),
];
// Setpiece (appended: earlier decor keeps its seed draws): Orren's binding posts on the crown terrace (KNOT, not wind totems:
// a totem must answer a strike), turned in toward his knot. One per rune, the nearest free post to its strike spot. They are
// placed here as decor (spot rules, scatter clearing) but written as level props, two per post (post + rope node), each a
// one-shot platform (level.js mode 'once') that starts on switch.<rune>: the rope slips down to the foot, then the post sinks.
// No static collider: the moving post mesh is its own body (off the route, like the totems' boxes were).
const knot = (x, z) => Math.atan2(arch.pos[0] - x, arch.pos[2] - z);
decor.push(...K.decorate([{ on: G, glb: KNOT, n: 3, s: [0.8, 0.95], yaw: knot }], { route, props: [...props, ...decor],
  keep: (x, z, r) => keep(x, z, r) && orren.every((o) => Math.hypot(x - o.spot[0], z - o.spot[1]) > r + 1.8) }));
decor.forEach((d, i) => { d.id = `decor_${i}`; });
const freePosts = decor.filter((d) => d.glb === KNOT), postD = (p, o) => Math.hypot(p.pos[0] - o.spot[0], p.pos[2] - o.spot[1]);
const binds = orren.map((o) => freePosts.length && { o, p: freePosts.splice(freePosts.reduce((b, p, k) => (postD(p, o) < postD(freePosts[b], o) ? k : b), 0), 1)[0] }).filter(Boolean);
const knotProps = binds.flatMap(({ o, p }) => ['post', 'rope'].map((part) => ({ id: `knot_${o.id}_${part}`, glb: KNOT, mesh: `knot_${part}`, pos: p.pos, rotY: p.rotY, scale: p.scale })));
const knotMechs = binds.flatMap(({ o, p }) => [ // rope: 0.5 s slide to the foot; post: holds 1 s, then sinks 0.55 m over 1.2 s
  { id: `knot_${o.id}_rope`, kind: 'platform', node: `knot_${o.id}_rope`, path: [[0, 0, 0], [0, r2(-0.5 * p.scale), 0]], mode: 'once', period: 0.5, after: `switch.${o.id}` },
  { id: `knot_${o.id}_post`, kind: 'platform', node: `knot_${o.id}_post`, path: [[0, 0, 0], [0, 0, 0], [0, r2(-0.55 * p.scale), 0]], mode: 'once', period: 2.2, after: `switch.${o.id}` },
]);

// ---------- world.glb + collider.glb ----------
const world = new THREE.Scene();
const play = Object.values(I);
const rocks = K.islandMeshes(world, play);
// The way in: the wind road from Orren's workshop (l2, far below behind the back rim) climbs past the Kestrel's updraft (always on)
// and sets the hero down on the spawn.
const SH = facing(SPAWN, at('d1')), HB = SH + Math.PI, bX = Math.sin(HB), bZ = Math.cos(HB), rimB = isl.start.rim(Math.PI / 2 - HB);
const prevIsl = { x: bX * 200, z: bZ * 200, y: -14, R: 24 }; // far below (fog + small, its rock sinking into the cloud sea at killY - 6): still over the back rim from the arrival camera
const HAND_D = 1.6; // m: the arrive hand-off point behind the spawn (see the arrive cutscene)
const inAt = (d, up, k = 0) => [SPAWN[0] + bX * d + bZ * k, SPAWN[1] + up, SPAWN[2] + bZ * d - bX * k]; // the way in: d m behind the spawn on its heading, up m, k m to the left
const upA = [bX * (rimB + 2), bZ * (rimB + 2)];
const wArrive = { min: [upA[0] - 1.5, -14, upA[1] - 1.5], max: [upA[0] + 1.5, 2.5, upA[1] + 1.5] };
K.distantRing(world, new THREE.Vector3(CB.x / 2, 0, CB.z / 2), { n: 18, arch: 0.8, drift: { to: [goalPos[0], goalPos[2]], n: 4 }, clear: [[prevIsl.x, prevIsl.z, prevIsl.R * 1.8]] }); // finale: the 4 nearest drift in (world.js)
const farDecor = K.farIsland(world, { name: 'l2', kind: 'totems', ...prevIsl });
const falls = K.waterfalls(world, play, rocks, 4, route);
const inst = K.scatter(world, play, rocks, (x, z) => props.every((p) => Math.hypot(x - p.pos[0], z - p.pos[2]) > 0.55) && decor.every((p) => Math.hypot(x - p.pos[0], z - p.pos[2]) > 0.8 * p.scale) && Math.hypot(x - goalPos[0], z - goalPos[2]) > 1.6);
const collider = K.colliderBase(play, props, decor.filter((d) => d.glb !== KNOT));
K.pieces(world, collider, bridge, 0.7, 40);
K.pieces(world, collider, crW, 0.5, 10);
K.pieces(world, collider, spiral, 0.5, 50);
K.pieces(world, collider, stairs, 0.7, 60);
K.pieces(world, collider, crF, 0.5, 20);
K.pieces(world, collider, [lift], 0.7, 30);
const dam = K.wall(world, collider, { name: 'mech_dam', x: X.x, y: X.y, z: damZ, w: 3.2, h: 2.6, d: 0.6 });
K.markers(world, SPAWN, goalPos);

// ---------- feasibility ----------
K.gapChain([['sl', 'sh1'], ['sh1', 'sh2'], ['sh2', 'start'], ['start', 'd1'], ['d1', 'd2'], ['d4', 'd5'], ['d5', 'V'], ['V', 'nook'], ['nook', 'V'], ['sa', 'sb'], ['sb', 'CB'],
  ...[['V', 'hv'], ['y1', 'hz'], ['k5', 'hk']].flatMap(([a, p]) => [[a, `${p}1`], [`${p}1`, `${p}2`], [`${p}2`, `${p}3`], [`${p}3`, `${p}4`], [`${p}4`, `${p}H`]])]);
{ // spiral: pad ends along their tangents
  const ends = spiral.map((p) => [-1, 1].map((k) => [p.x - Math.sin(p.t) * k * p.len / 2, p.z0 + p.len / 2 + Math.cos(p.t) * k * p.len / 2]));
  const rimPt = (a, [x, z]) => Math.hypot(x - a.x, z - a.z) - a.rim(Math.atan2(z - a.z, x - a.x));
  K.gap('d2', spiral[0].name, rimPt(I.d2, ends[0][0]), spiral[0].top - I.d2.y);
  for (let i = 1; i < spiral.length; i++) K.gap(spiral[i - 1].name, spiral[i].name, Math.hypot(ends[i][0][0] - ends[i - 1][1][0], ends[i][0][1] - ends[i - 1][1][1]), spiral[i].top - spiral[i - 1].top);
  K.gap(spiral.at(-1).name, 'd4', rimPt(I.d4, ends.at(-1)[1]), I.d4.y - spiral.at(-1).top);
}
K.dashGap('y1', 'fa', rimGap(Z, FA), 0);
K.step('k5', stairs[0].name, stairs[0].top - K5.y, rimFar(K5) - stairs[0].z0);
for (let i = 1; i < NB2; i++) K.step(stairs[i - 1].name, stairs[i].name, stairs[i].top - stairs[i - 1].top, stairs[i - 1].z1 - stairs[i].z0);
K.step(stairs[NB2 - 1].name, 'crown', G.y - stairs[NB2 - 1].top, stairs[NB2 - 1].z1 - rimNear(G));
K.step('V', bridge[0].name, bridge[0].top - V.y, rimFar(V) - bridge[0].z0);
for (let i = 1; i < NB; i++) K.step(bridge[i - 1].name, bridge[i].name, bridge[i].top - bridge[i - 1].top, bridge[i - 1].z1 - bridge[i].z0);
K.step(bridge[NB - 1].name, 'W', W.y - bridge[NB - 1].top, bridge[NB - 1].z1 - rimNear(W));
for (const [row, a, b, dash] of [[crW, W, X, true], [crF, FA, FB, true]]) {
  K.gap(a.id, row[0].name, row[0].z0 - rimFar(a), row[0].top - a.y);
  for (let i = 1; i < row.length; i++) K.gap(row[i - 1].name, row[i].name, row[i].z0 - row[i - 1].z1, row[i].top - row[i - 1].top);
  (dash ? K.dashGap : K.gap)(row.at(-1).name, b.id, rimNear(b) - row.at(-1).z1, b.y - row.at(-1).top);
}
K.windGap('X', 'Y', rimGap(X, Y), Y.y - X.y, TAIL, 'broken.dam (wind.tail)');
K.dashGap('fu1', 'CB', rimGap(FU, CB), CB.y - FU.y, 2);
K.step('y1', lift.name, 0, rimFar(Z) - lift.z0);
K.step(`${lift.name}@top`, 'sa', 0, lift.z1 - rimNear(SA));
for (const t of [upY, upF, ...crownT]) if (t.box.max[1] - 0.5 < t.hi.y - TUNING.stepUp + 0.2) throw new Error(`updraft ${t.hi.id} does not clear its rim`);
if (LIFT <= TUNING.gravity || CYCLE[0] < 5 / 5 + 0.6) throw new Error('crown updraft too weak or too short');
if (rimGap(V, W) <= jumpReach(0) || LIFTUP <= TUNING.jumpHeight) throw new Error('bridge / lift is not a puzzle');
K.blocked.push({ from: 'V', to: 'W', dist: r2(rimGap(V, W)), reach: K.reach(0), needs: `raised.bridge (runeV, hold ${HOLD} s)` });
K.blocked.push({ from: 'X', to: 'Y', wall: dam.size, needs: 'broken.dam (strike or dash); frees wind.tail + wind.upY' });
K.blocked.push({ from: 'Y', to: 'y1', rise: 4, needs: 'wind.upY (after the dam)' });
K.blocked.push({ from: 'y1', to: 'sa', rise: LIFTUP, needs: 'switch.seqB (lift; runes A then B hidden west of Z) - safe lane' });
K.blocked.push({ from: 'fb', to: 'fu1', rise: FRISE, needs: 'wind.upF (switch.seqB) - fast lane' });
K.blocked.push({ from: 'k5', to: 'crown', dist: r2(rimGap(K5, G)), rise: r2(G.y - K5.y), needs: `raised.stairs (runeK, hold ${HOLD2} s)` });
for (const t of crownT) K.blocked.push({ from: t.lo.id, to: t.hi.id, rise: 5, needs: `wind.up_${t.hi.id} (cycle ${CYCLE.join('/')})` });

// ---------- level.json ----------
K.checkRoute(route, [...bridge, ...crW, ...crF, lift, ...spiral, ...stairs], props.concat(decor));
const box = (b) => ({ kind: 'box', min: r2v(b.min), max: r2v(b.max) });
const WIND_CAIRNS = ['c_V', 'c_Z', 'c_fa', 'c_CB']; // checkpoints with a wind spring (level.js swirl, player.js refill); plain ones keep the breath you came with (kit breath budget)
const cp = (id, p, look) => ({ id, pos: r2v(p), r: 2.2, heading: facing(p, look), ...(WIND_CAIRNS.includes(id) && { wind: true }) });
const finMark = r2v([goalPos[0] - 0.5, goalPos[1], goalPos[2] - 1.5]), finMark2 = r2v([goalPos[0] - 0.5, goalPos[1], goalPos[2] - 1.15]), finHead = r2(Math.atan2(-0.35, 1)); // the hero in the finale
const level = {
  id: 'l3', title: 'Crown of Winds', next: null, seed: SEED,
  spawn: { pos: SPAWN, heading: facing(SPAWN, at('d1')) },
  goal: { kind: 'circle', pos: goalPos.map(r2), r: 1.4, after: 'npc.orren.free' },
  killY: -20,
  // high sun, clear air: far islands stay crisp; the finale parts the clouds (world.js)
  mood: { sky: { top: '#f5f2ea', horizon: '#f7f0e2', haze: '#efdcc0', sunGlow: '#fbe6b4', sunDisc: '#fffaf0', cloudLit: '#fbf1dc', cloudShade: '#e9ddd8' },
    sun: [[-0.4, 0.2, 1], [-0.35, 0.3, 1]], fog: { color: '#f7efe2', near: 50, far: [340, 400] }, hemi: { sky: '#eef1f2', ground: '#b4acba', i: 2.35 },
    light: { color: '#fff0d4', i: 1.85, y: 9 }, breeze: 1 },
  falls,
  sky: K.skyCastles({ x: CB.x / 2, z: CB.z / 2 }, [['assets/sky/castle1.png', 10, 370, 57, 202], ['assets/sky/castle2.png', -70, 340, 31, 150], ['assets/sky/castle2.png', 120, 360, 41, 172]]),
  props: [...props.filter((p) => p.glb !== PILLAR), ...knotProps].map((p) => ({ ...p, pos: p.pos.map(r2), rotY: +p.rotY.toFixed(4), ...(p.scale ? { scale: +p.scale.toFixed(2) } : {}) })),
  mechanisms: [
    { id: 'runeV', kind: 'switch', node: 'runeV', pos: runeV.pos.map(r2), r: 2.2, targets: ['bridge'], once: true, hidden: true, dust: true, after: 'enemy.gdV.open', // R2: dust hides it and its vein: the Gust [1] blows it clear
      vein: [[V.x, V.y, rimFar(V) - 0.8], [V.x - 2, V.y, V.z + 1], ...['hv1', 'hv2', 'hv3', 'hv4', 'hvH'].map(at), runeV.pos].map(r2v) },
    { id: 'bridge', kind: 'bridge', nodes: bridge.map((p) => p.name), offset: [0, -7, 0], dur: 2.0, stagger: 0.4, hold: HOLD },
    ...crW.map((p, i) => ({ id: `crumble${i}`, kind: 'crumble', node: p.name, delay: CRD, respawn: 3, group: 'crW' })), // the Anchor [3] holds the row
    { id: 'runeN', kind: 'switch', node: 'runeN', pos: runeN.pos.map(r2), r: 2.0, targets: [], once: true, far: true }, // out of reach: the Name song wakes it (and its breath)
    { id: 'dam', kind: 'breakable', ...dam, targets: ['tail', 'upY'] },
    { id: 'tail', kind: 'wind', area: box(wTail), force: [0, 0, TAIL], active: false },
    { id: 'upY', kind: 'wind', area: box(upY.box), force: [0, LIFT, 0], active: false },
    { id: 'seqA', kind: 'switch', node: 'seqA', pos: seqA.pos.map(r2), r: 2.2, targets: [], once: true, seq: 'fork', order: 1, hidden: true,
      vein: [[FA.x, FA.y, FA.z], [rimE(Z) - 0.8, Z.y, Z.z], [Z.x, Z.y, Z.z + 0.6], ...['hz1', 'hz2', 'hz3', 'hz4', 'hzH'].map(at), seqA.pos].map(r2v) },
    { id: 'seqB', kind: 'switch', node: 'seqB', pos: seqB.pos.map(r2), r: 2.2, targets: ['lift', 'upF'], once: true, seq: 'fork', order: 2, hidden: true, // one song, both lanes
      vein: [[liftC[0], Z.y, liftC[1] - 0.6], [Z.x - 1, Z.y, Z.z], at('hz1'), [I.hz2.x - 0.5, I.hz2.y, I.hz2.z], seqB.pos].map(r2v) },
    { id: 'lift', kind: 'platform', node: lift.name, path: [[0, 0, 0], [0, LIFTUP, 0]], mode: 'ride', period: 5, idle: true }, // U14: on demand (level.js rideStep): 2.5 s up, home 2 s after the hero leaves
    ...spiral.map((p, i) => ({ id: `spiral${i}`, kind: 'crumble', node: p.name, delay: CRD, respawn: 3 })),
    { id: 'runeK', kind: 'switch', node: 'runeK', pos: runeK.pos.map(r2), r: 2.2, targets: ['stairs'], once: true, hidden: true,
      vein: [[K5.x, K5.y, rimFar(K5) - 0.8], [K5.x - 1.5, K5.y, K5.z], ...['hk1', 'hk2', 'hk3', 'hk4', 'hkH'].map(at), runeK.pos].map(r2v) },
    { id: 'stairs', kind: 'bridge', nodes: stairs.map((p) => p.name), offset: [0, -7, 0], dur: 1.0, stagger: 0.25, hold: HOLD2 },
    ...crF.map((p, i) => ({ id: `crumblef${i}`, kind: 'crumble', node: p.name, delay: CRD, respawn: 3 })),
    { id: 'upF', kind: 'wind', area: box(upF.box), force: [0, LIFT, 0], active: false },
    ...crownT.map((t) => ({ id: `up_${t.hi.id}`, kind: 'wind', area: box(t.box), force: [0, LIFT, 0], cycle: CYCLE })),
    ...orren.map((o) => ({ id: o.id, kind: 'switch', pos: o.pos.map(r2), r: 1.15, once: true, after: 'enemy.kw.free' })), // R3: Orren's posts stay bound until the Knot Warden is unbound
    ...knotMechs,
    { id: 'shrine', kind: 'switch', pos: r2v([shrine.pos[0], G.y + 0.9, shrine.pos[2]]), r: 2.2, targets: [], once: true },
    { id: 'arriveUp', kind: 'wind', area: box(wArrive), force: [0, LIFT, 0] }, // the Kestrel's wind that brought the hero, off the back rim
  ],
  triggers: [
    { id: 't_bridge', shape: { kind: 'poly', pts: poly(V.x - 6, V.z - 6, V.x + 6, V.z - 2) }, teaches: 'timed_bridge', ifFlag: null, once: true },
    { id: 't_anchor', shape: { kind: 'poly', pts: poly(W.x - 3, rimFar(W) - 3, W.x + 3, rimFar(W)) }, ifFlag: null, once: true },
    { id: 't_dam', shape: { kind: 'poly', pts: poly(X.x - 5, rimNear(X) - 1, X.x + 5, X.z) }, teaches: 'dam', ifFlag: null, once: true },
    { id: 't_fork', shape: { kind: 'poly', pts: poly(Z.x - 6, Z.z - 6, Z.x + 6, Z.z) }, teaches: 'fork', ifFlag: null, once: true },
    { id: 't_shrine', shape: { kind: 'poly', pts: poly(shrine.pos[0] - 3.5, shrine.pos[2] - 3.5, shrine.pos[0] + 3.5, shrine.pos[2] + 3.5) }, ifFlag: 'switch.shrine', once: true,
      hint: { en: 'The last shrine reads: "Let the islands drift. What is remembered is never lost."', ru: 'На последнем святилище: «Пусть острова дрейфуют. Что помнят, то не потеряно».' } },
    { id: 't_stairs', shape: { kind: 'poly', pts: poly(K5.x - 4, K5.z - 3, K5.x + 4, K5.z + 3) }, teaches: null, ifFlag: null, once: true },
    { id: 't_crown', shape: { kind: 'poly', pts: poly(CB.x - 6, CB.z - 6, CB.x + 6, CB.z + 1) }, teaches: null, ifFlag: null, once: true },
  ],
  checkpoints: [
    cp('c_d2', at('d2'), mid(spiral[0])),
    cp('c_V', [V.x - 3, V.y, V.z], runeV.pos), // R2: on the route point where the Gust [1] clears runeV's vein
    cp('c_hv', [I.hvH.x + 1.5, I.hvH.y, I.hvH.z - 1.4], runeV.pos), // U21: clear of runeV's boulder and its rest spots // the hidden rune's island: the detour gets its own leg
    cp('c_W', [W.x, W.y, W.z], mid(crW[0])),
    cp('c_X', [X.x, X.y, X.z - 1], [X.x, 0, damZ]),
    cp('c_Z', [Z.x, Z.y, Z.z], at('fa')),
    cp('c_hz', [I.hzH.x, I.hzH.y, I.hzH.z], at('hz4')), // the far hidden rune's island: the detour gets its own leg
    cp('c_fa', at('fa'), mid(crF[0])),
    cp('c_fu', [FU.x, FU.y, FU.z], at('CB')),
    cp('c_sa', at('sa'), at('sb')),
    cp('c_CB', [CB.x, CB.y, CB.z - 1.5], at('k1')),
    cp('c_k2', at('k2'), at('k3')),
    cp('c_k4', at('k4'), at('k5')),
    cp('c_k5', [K5.x + 1, K5.y, K5.z], runeK.pos),
    cp('c_G', [G.x, G.y, rimNear(G) + 2.5], goalPos),
  ],
  route,
  enemies: [ // R3 Knot Shards (enemies.js): a Squall at the fork, a Warden on k4's terrace, the Knot Warden on the crown (all songs held: startGifts)
    ...ENEMIES,
  ],
  actions: [
    { at: [-15, -6], r: 1, do: 'go', drop: true, profiles: ['worst'] }, // worst: walks off the start island into the void first
    ...[at('nook'), [V.x - 3, V.y, V.z]].map((p) => ({ at: [p[0], p[2]].map(r2), r: 1, do: 'go', home: 14, y: V.y - 0.5, profiles: ['best'] })), // (home: follow the route until V) // best: the nook echo below the bridge foot
    { at: [-1, 4], r: 0.8, do: 'song', song: 'name', face: [-1, 10], profiles: ['worst'] }, // worst: a Name sung to no rune (wasted)
    { at: [V.x - 3, V.z].map(r2), y: V.y, r: 0.6, do: 'song', song: 'gust', face: [V.x - 7, V.z].map(r2) }, // at the cairn: blow the dust off runeV's vein
    { at: [I.hvH.x + 1, I.hvH.z - 1.8].map(r2), y: I.hvH.y, r: 4.6, do: 'fight', enemy: 'gdV' }, // the rune guard (U23): bait its shove, strike it as it recovers, Name it as it reels: only then is its rune free
    { at: spotV.map(r2), r: 0.6, do: 'sing', switch: 'runeV', until: 'switch.runeV' },
    { at: spotW.map(r2), y: W.y, r: 0.6, do: 'song', song: 'anchor', face: [crW[1].x, (crW[1].z0 + crW[1].z1) / 2].map(r2), profiles: ['mid', 'best'] }, // hold the crumble row...
    { at: spotW.map(r2), y: W.y, r: 0.6, do: 'song', song: 'name', face: [Far.x, Far.z].map(r2), profiles: ['best'] }, // ...best: and Name the far rune (breath)
    { at: [crW.at(-1).x, (crW.at(-1).z0 + crW.at(-1).z1) / 2].map(r2), r: 1.4, do: 'dash', air: true },
    { at: [X.x - 1.5, rimNear(X) + 1.5].map(r2), y: X.y, r: 0.5, do: 'wait', until: 'echo.echo_dash', home: 3 }, // echo detour
    { at: spotDam.map(r2), r: 0.6, do: 'strike', switch: 'dam', until: 'broken.dam' },
    { at: [Y.x - 9, Y.z].map(r2), r: 1, do: 'go', drop: true, profiles: ['worst'] }, // worst: wanders off Y's west rim (respawn at c_X)
    { at: [Y.x, Y.z - 2.5].map(r2), y: Y.y, r: 2, do: 'fight', enemy: 'wdY' }, // R3: three staff hits stagger the Warden, Name unbinds it
    { at: spotB.map(r2), r: 0.6, do: 'sing', switch: 'seqB', profiles: ['worst'] }, // worst: the near rune first: still bound, its whirl shoves back (U12)
    { at: spotA.map(r2), r: 0.6, do: 'sing', switch: 'seqA', until: 'switch.seqA' }, // the far rune first...
    { at: spotB.map(r2), r: 0.6, do: 'sing', switch: 'seqB', until: 'switch.seqB' }, // ...then the near one wakes both lanes
    { at: [r2(rimE(Z) - 0.6), r2(Z.z)], r: 0.8, do: 'dash', air: true },
    { at: [crF.at(-1).x, (crF.at(-1).z0 + crF.at(-1).z1) / 2].map(r2), r: 1.4, do: 'dash', air: true },
    { at: [FU.x + 0.8, FU.z + 1].map(r2), y: FU.y, r: 0.5, do: 'wait', until: 'echo.echo_branch', home: 3 }, // echo detour
    { at: [r2(rimW(FU) + 0.6), r2(FU.z)], r: 0.8, do: 'dash', air: 2 },
    { at: [CB.x, CB.z].map(r2), y: CB.y, r: 5.5, do: 'fight', enemy: 'sqCB' }, // R3: Gust the Squall on its telegraph, Name it (from range: its updraft does not take us yet)
    { at: [CB.x, CB.z].map(r2), y: CB.y, r: 5.5, do: 'fight', enemy: 'thCB' }, // then the thief: strike it, Name it, up on its updraft
    { at: spotK.map(r2), y: r2(I.hkH.y), r: 0.6, do: 'sing', switch: 'runeK', until: 'switch.runeK' },
    { at: [G.x - 1.5, G.z - 1].map(r2), y: G.y, r: 1.5, do: 'fight', enemy: 'kw' }, // R3: the Knot Warden before Orren (waves, ram, rings)
    ...['orren1', 'orren3', 'orren2'].map((id) => orren.find((o) => o.id === id)).map((o) => ({ at: o.spot.map(r2), r: 0.6, do: 'sing', switch: o.id, until: `switch.${o.id}`, home: 9 })), // R3: from the boss arena (west), the near post first, round Orren
    { at: [shrine.pos[0] + 1.2, shrine.pos[2]].map(r2), y: G.y, r: 0.5, do: 'wait', until: 'echo.echo_shrine', home: 7 }, // echo detour (Orren talks meanwhile)
  ],
  echoSlots: [
    { id: 'echo_branch', pos: r2v([FU.x + 0.8, FU.y, FU.z + 1]), note: 'fast lane top (crumble + updraft + dash)' },
    { id: 'echo_bridge', pos: r2v(at('nook')), note: 'nook below the timed bridge foot (drop from V, hop back)' },
    { id: 'echo_dash', pos: r2v([X.x - 1.5, X.y, rimNear(X) + 1.5]), note: 'landing of the crumble air dash' },
    { id: 'echo_shrine', pos: r2v([shrine.pos[0] + 1.2, G.y, shrine.pos[2]]), note: 'by the crown shrine' },
  ],
  startGifts: ['dash', 'windbreath', 'airdash', 'gust', 'name', 'anchor'], // all earlier gifts (l1 Kamen, l2 Sigh and Kestrel) and songs (their shrines on l1 and l2)
  npcSlots: [{ id: 'orren', pos: r2v([arch.pos[0], G.y, arch.pos[2] - 1.2]), note: "Orren's arch on the crown terrace (route: g1 -> crown)" }],
  npcs: [
    { id: 'narrator', kind: 'voice', voice: 'whisper', talk: [
      { id: 'n_orren', lines: [
        { en: 'Rings of stone turn round the arch. Three runes hold them, and gold threads tie the runes to a stone Warden.', ru: 'Кольца камня вращаются вокруг арки. Их держат три руны, а золотые нити тянутся от рун к каменному Стражу.' },
      ] },
    ] },
    { id: 'orren', kind: 'orren', name: { en: "Orren's Remnant", ru: 'Остаток Оррена' }, voice: 'orren', pos: r2v([arch.pos[0], G.y + 1.4, arch.pos[2]]),
      center: r2v([arch.pos[0], G.y + 1.4, arch.pos[2]]), rotY: +arch.rotY.toFixed(3), switches: orren.map((o) => o.id), lure: true, bark: { talk: 'n_orren', r: 8 }, talk: [
      { id: 'orren_kw1', on: 'enemy.kw.p1', lines: [
        { en: 'My Warden wakes. Three winds feed him: see the threads.', ru: 'Мой Страж проснулся. Три ветра питают его: видишь нити.' },
        { en: 'Still each wind as it rears to strike.', ru: 'Усмири каждый ветер, когда он встаёт на дыбы.' },
      ] },
      { id: 'orren_kww', on: 'enemy.kw.window', lines: [
        { en: 'His cords hang loose. Say his name before they tighten.', ru: 'Его путы ослабли. Назови его имя, пока они не затянулись.' },
      ] },
      { id: 'orren_kw2', on: 'enemy.kw.p2', lines: [
        { en: 'Now he comes himself. Step aside, then strike: three blows shake him.', ru: 'Теперь он идёт сам. Отступи и бей: три удара пошатнут его.' },
      ] },
      { id: 'orren_kw3', on: 'enemy.kw.p3', lines: [
        { en: 'He beats the ground. Leap each ring, and name him when he tires.', ru: 'Он бьёт землю. Перепрыгни каждое кольцо и назови его, когда он устанет.' },
      ] },
      { id: 'orren_tied', on: 'enemy.kw.tied', lines: [
        { en: 'My runes are tied to the Warden. Unbind him first.', ru: 'Мои руны привязаны к Стражу. Сначала развяжи его.' },
      ] },
      { id: 'orren_1', on: 'npc.orren.1', lines: [
        { en: 'Who loosens my knot? I tied it so the sky would hold together.', ru: 'Кто ослабляет мой узел? Я завязал его, чтобы небо держалось.' },
        { en: 'I was a Keeper. I am what is left of one.', ru: 'Я был Хранителем. Я то, что от него осталось.' },
      ] },
      { id: 'orren_2', on: 'npc.orren.2', lines: [
        { en: 'The stone, the wisp, the bird. I bound them all, out of fear of forgetting.', ru: 'Камень, вихрь, птица. Я связал их всех, боясь забыть.' },
        { en: 'But a knot does not remember. It only holds.', ru: 'Но узел не помнит. Он только держит.' },
      ] },
      { id: 'orren_3', on: 'npc.orren.3', end: ['npc.orren.free'], lines: [
        { en: 'Ah. So this is what letting go feels like.', ru: 'А. Вот каково это, отпустить.' },
        { en: 'Remembering is waking, little wind. Go on. The arch is open.', ru: 'Вспомнить значит проснуться, маленький ветер. Иди. Арка открыта.' },
      ] },
    ] },
  ],
  shots: [
    { name: 'arrival', pos: r2v([SPAWN[0] - bX * 4.5, 2.2, SPAWN[2] - bZ * 4.5]), look: r2v([SPAWN[0] + bX * 20, -4, SPAWN[2] + bZ * 20]) }, // the play camera turned round at the start: the updraft, the workshop far below
    { name: 'vista', pos: r2v([V.x + 30, 12, (V.z + CB.z) / 2 - 10]), look: r2v([CB.x, 0, (V.z + CB.z) / 2]) },
    { name: 'bridge', pos: r2v([V.x + 9, V.y + 4, (rimFar(V) + rimNear(W)) / 2 - 5]), look: r2v([V.x, V.y, (rimFar(V) + rimNear(W)) / 2]), fire: ['runeV'] },
    { name: 'spiral', pos: r2v([I.d2.x - 14, I.d2.y + 9, I.d2.z - 4]), look: r2v([(I.d2.x + I.d4.x) / 2 + 4, I.d4.y, (I.d2.z + I.d4.z) / 2]) },
    { name: 'stairs', pos: r2v([K5.x + 10, K5.y + 4, (rimFar(K5) + rimNear(G)) / 2 - 4]), look: r2v([K5.x, K5.y + 1, (rimFar(K5) + rimNear(G)) / 2]), fire: ['runeK'] },
    { name: 'crumble', pos: r2v([W.x + 8, W.y + 4, rimFar(W) + 2]), look: r2v([W.x, W.y, rimFar(W) + 6]) },
    { name: 'dam', pos: r2v([X.x + 4, X.y + 2.5, damZ - 5]), look: r2v([X.x, X.y + 1.2, damZ]) },
    { name: 'fork', pos: r2v([(Z.x + FU.x) / 2, Z.y + 30, (Z.z + CB.z) / 2]), look: r2v([(Z.x + FU.x) / 2, Z.y, (Z.z + CB.z) / 2 + 0.5]) },
    { name: 'crown', pos: r2v([CB.x - 22, CB.y + 14, CB.z + 4]), look: r2v([I.k3.x, I.k3.y, I.k3.z]) },
    ...[['V', 'hv', runeV], ['Z', 'hz', seqA], ['K', 'hk', runeK]].flatMap(([n, p, r]) => [
      { name: `vein_${n}`, pos: r2v([I[`${p}1`].x + 8, I[`${p}1`].y + 10, I[`${p}1`].z - 10]), look: r2v(at(`${p}2`)) },
      { name: `hidden_${n}`, pos: r2v([I[`${p}H`].x + 5, I[`${p}H`].y + 2.5, I[`${p}H`].z - 3]), look: r2v([r.pos[0], r.pos[1] + 0.8, r.pos[2]]) },
    ]),
    { name: 'goal', pos: r2v([G.x + 8, G.y + 5, G.z - 10]), look: r2v([goalPos[0], G.y + 1.5, goalPos[2]]) },
  ],
  cutscenes: { // cutscene.js; world.js plays the gust + cloud parting from fx 'finale', the sunrise from the sun ramp
    arrive: { // the wind road from the workshop: the hero climbs it after the Kestrel, crests the rim; control returns in the last glide over the
      // spawn (cutscene.js play keys + 'player.place'): he lands himself; the bird peels away and the wind dies
      dur: 7,
      keys: [
        { at: 0, pos: r2v(inAt(64, -3, -3)), look: r2v(inAt(40, -0.5)) }, // behind and below him on the road: the Crown's first island ahead, above
        { at: 3.4, pos: r2v(inAt(34, 5.5, -3.5)), look: r2v(inAt(14, 4)) },
        { at: 5.8, play: 1 }, { at: 7, play: 1 }, // the play camera's own pose on him (cutscene.js playPose): no jump at the hand-off
      ],
      lines: [
        { at: 0.8, dur: 5, text: { en: 'The Crown of Winds. Orren\'s knot is tied here, at the top.', ru: 'Корона Ветров. Узел Оррена завязан здесь, на вершине.' } },
      ],
      events: [
        { at: 0, duck: { db: -6, seconds: 7 } },
        { at: 0.2, cue: 'wind', gain: 0.8 },
      ],
      ribbon: { at: -6, grow: 1, fade: [4.6, 7], pts: [inAt(96, -12), inAt(52, -4.5), inAt(24, 4.2), inAt(9, 3.6), inAt(1, 1.3), inAt(-7, 1.6)].map(r2v) },
      hero: { path: [ // one flight at cruise speed; it ends HAND_D m short of the spawn, 1.4 m up: the player's fall from there touches down on it
        { at: 0, pos: r2v(inAt(52, -4.5)), heading: SH, clip: 'glide' },
        { at: 3, pos: r2v(inAt(24, 4.2)), heading: SH, clip: 'glide' },
        { at: 5, pos: r2v(inAt(9, 3.6)), heading: SH, clip: 'glide' },
        { at: 7, pos: r2v(inAt(HAND_D, 1.4)), heading: SH },
      ] },
      actors: [{ glb: 'assets/characters/kestrel/kestrel.glb', scale: 2.2, path: [ // the Kestrel leads up the road, then peels away over the island
        { at: 0, pos: r2v(inAt(40, -0.5, -0.8)), clip: 'fly' },
        { at: 2.6, pos: r2v(inAt(12, 6.5, -1)), clip: 'fly' },
        { at: 4.4, pos: r2v(inAt(-5, 9, 3)), clip: 'fly' },
        { at: 6.6, pos: r2v(inAt(-24, 17, 12)), clip: 'fly' },
      ] }],
    },
    finale: {
      dur: 25,
      keys: [
        { at: 0, shot: 'goal', ease: 1 },
        { at: 4, pos: [9.5, 28.5, 190], look: [6.4, 27.4, 194.8] },
        { at: 8, pos: [16, 33, 176], look: [5, 27, 198] },
        { at: 14, pos: [12, 27, 162], look: [-1, 36.7, 198.5] }, // low behind the crown, facing the climbing sun (mood.sun): crown at the bottom, sun up top
        { at: 19, pos: [8.5, 27.4, 182], look: [2.6, 28.5, 206] }, // slow push-in from behind: the hero (goal circle) against the risen sun
        { at: 25, pos: [2.6, 26.2, 193], look: [3.1, 26.9, 206] }, // ~5.5 m behind the hero (mark) at eye height, west of Orren's pillars, the sun just above the head, inside the letterbox
      ],
      lines: [
        { at: 1, dur: 5, text: { en: 'The song reaches the knot, and it loosens.', ru: 'Песня касается узла, и узел слабеет.' } },
        { at: 6.5, dur: 5.5, text: { en: 'Every wind Orren held goes home at once.', ru: 'Все ветры, что держал Оррен, разом летят домой.' } },
        { at: 12.6, dur: 5.6, text: { en: 'The sun climbs over the Crown for the first time in an age.', ru: 'Впервые за века солнце встаёт над Короной.' } },
        { at: 18.8, dur: 5.8, text: { en: 'And the islands, unbound, drift toward each other again.', ru: 'А острова, освобождённые, снова плывут друг к другу.' } },
      ],
      events: [
        { at: 0, duck: { db: -10, seconds: 25 } },
        { at: 0.6, cue: 'rune' },
        { at: 1, fire: 'orren1' },
        { at: 1, fire: 'orren2' },
        { at: 1, fire: 'orren3' },
        { at: 2, fx: 'finale' },
        { at: 2, cue: 'unbind' },
        { at: 2.4, cue: 'wind', gain: 1 },
        { at: 6, sun: [0, 1, 10] },
        { at: 9, cue: 'birds', gain: 0.7 },
        { at: 13, cue: 'hum', gain: 0.7 },
      ],
      ribbon: [0, 2.2, -2.2].map((a, i) => ({ at: 2.2 + 0.5 * i, grow: 5, pts: [[0, 2.5], [5, 6], [16, 11], [42, 15], [100, 9]].map(([d, up], k) => r2v([arch.pos[0] + Math.sin(HB + a + 0.25 * k) * d, G.y + up, arch.pos[2] + Math.cos(HB + a + 0.25 * k) * d])) })), // every wind goes home: three roads unwind from the knot, the first toward the workshop
      hero: { keep: true, from: 'player', clip: 'land', at: 0.3, pose: [{ at: 0, land: 0 }, { at: 2.1, land: 0 }, { at: 2.6, land: 0.6 }, { at: 4.4, land: 0 }], // he sings the knot loose, then braces as the gust breaks out
        path: [{ at: 0, pos: finMark, heading: finHead }, { at: 0.1, pos: finMark, heading: finHead, clip: 'walk' }, { at: 1, pos: finMark2, heading: finHead, clip: 'sing' }, { at: 2.2, pos: finMark2, heading: finHead }] }, // he steps up to the knot from where the player stopped; // inside the goal circle on the push-in's side (clear of Orren's pillar), facing the risen sun (mood.sun[1]); kept after, like the dawn
    },
  },
  feasibility: K.feasibility(),
};

// ---------- R5: the hung slab (layout above), R4: wardens / squalls shattered by worst ----------
{
  const st = I.start, sl = I.sl, x0 = rimE(st), x1 = rimW(sl), len = x1 - x0 + 1.2, cx = r2((x0 + x1) / 2), z = r2(st.z);
  level.trials = [...(level.trials ?? []), { id: 'slabS', kind: 'slab', pos: [cx, r2(st.y + 3), z], size: [r2(len), 0.5, 2.2], stop: r2(st.y), near: [r2(x0 - 1.6), z], r: 2, v: 1.2, drop: 4.5, hold: 4 }];
  const spot = [r2(x0 - 1.4), z];
  level.actions.splice(1, 0, // best, first thing: Anchor the slab, cross, an air Gust on the ledge, back by the hops
    { at: spot, r: 0.8, do: 'go', home: 30, profiles: ['best'] },
    { at: spot, r: 1, do: 'song', song: 'anchor', slab: 'slabS', face: [cx, z], home: 30, profiles: ['best'] },
    { at: [r2(sl.x + 2.5), z], r: 0.8, do: 'go', home: 30, profiles: ['best'] },
    { at: [r2(sl.x + 2.5), z], r: 1, do: 'airsong', song: 'gust', face: [r2(sl.x + 9), z], charge: 0.3, home: 30, profiles: ['best'] }, // gust at the sky: the recoil throws the hero back in
    ...[I.sh1, I.sh2, { x: st.x + st.rim(-0.6) - 2, z: st.z - 3 }].map((h) => ({ at: [h.x, h.z].map(r2), r: 0.8, do: 'go', home: 30, profiles: ['best'] })),
    // R4 wasted anchor: worst holds the slab and never steps on; it strains, its chains snap, it is gone for good (the ledge is optional)
    { at: spot, r: 0.8, do: 'go', home: 30, profiles: ['worst'] },
    { at: spot, r: 1, do: 'song', song: 'anchor', slab: 'slabS', face: [cx, z], home: 30, profiles: ['worst'] });
  for (const id of ['wdY', 'sqCB']) { // worst strikes the stunned shard to pieces instead of Naming it
    const i = level.actions.findIndex((x) => x.do === 'fight' && x.enemy === id);
    level.actions.splice(i, 1, { ...level.actions[i], profiles: ['mid', 'best'] }, { ...level.actions[i], shatter: true, profiles: ['worst'] });
  }
  // R9: up the crown spiral worst steps off k4 down to the hub CB (20 m: a fray) and climbs again.
  const fi = level.actions.findIndex((x) => x.do === 'fight' && x.enemy === 'sqCB' && x.shatter) + 1;
  const drop = (k, onto, profiles) => { // the first bearing off k's rim with onto's top below and open sky between
    const inside = (a, x, z, m) => Math.hypot(x - a.x, z - a.z) < a.rim(Math.atan2(z - a.z, x - a.x)) + m;
    for (let i = 0; i < 72; i++) {
      const th = (i * 5 * Math.PI) / 180, e = k.rim(th) + 0.8, x = k.x + Math.cos(th) * e, z = k.z + Math.sin(th) * e;
      if (!inside(onto, x, z, -1) || Object.values(I).some((o) => o !== onto && o !== k && o.y > onto.y && inside(o, x, z, 0.6))) continue;
      return [{ at: [k.x, k.z].map(r2), y: r2(k.y), r: 1.5, do: 'go', home: 4, profiles }, { at: [x, z].map(r2), r: 0.6, do: 'go', drop: true, profiles }];
    }
    throw new Error(`R9: no clear drop off ${k.id} onto ${onto.id}`);
  };
  level.actions.splice(fi, 0, ...drop(I.k4, CB, ['worst'])); // 20 m: a fray (mid / best: l2's tower, 8 m, rolled)
}

// ---------- R6: a lock for a later visit (level select), a shortcut ----------
// lockO: Orren's own name, cut on a stone off the crown's rim, too far for plain Name (Name II: Sigh's breath, l2): an echo, the last
// tale shard, the third cloak thread. Shortcut (U14): a rune at the crown's stair head pins the timed stairs k5 -> crown up for good.
K.own(1603, () => {
  const R = makeR6(K, { world, collider, level, salt: 1603 }), OTH = 0;
  const lo = R.nameLock({ id: 'lockO', from: G, th: OTH, out: 7, side: 2.5, up: 1.5, gap: 10.6, kind: 'name2', rewards: [{ id: 'echo_far' }, { id: 'tale5', relic: 'tale.5' }, { id: 'thread_l3', relic: 'thread.l3' }] });
  const kb = R.requestStone('kamen_brother', lo.islet, OTH + Math.PI / 2, 'kamen.brother'); // Kamen's request (l1): his brother's name, cut out here
  const sc = R.shortcut({ lower: K5, upper: G, at: [K5.x - 2.8, rimNear(G) + 1.5], targets: ['stairs'] });
  R.finish();
  level.mechanisms.push(...lo.mechanisms, kb.mechanism, ...sc.mechanisms);
  level.echoSlots.push(...lo.rewards.map(({ relic, ...e }) => ({ ...e, ...(relic && { relic }), note: 'R6 lock reward' })));
  const v = (pts) => pts.map((p) => p.map(r2));
  const rimF = R.standAt(G, OTH, 0.3), rimI = R.standAt(lo.islet, OTH + Math.PI, 0.3), back = [G.x, G.z], face = [lo.rune.pos[0], lo.rune.pos[2]].map(r2);
  const visit = [
    ...v([back, R.standAt(G, OTH + 0.25, 0.8)]).map((p) => ({ at: p, r: 0.5, do: 'go' })), // along the rim to the stand spot
    { at: lo.stand, r: 0.5, do: 'go' },
    { at: lo.stand, r: 0.6, do: 'song', song: 'name', face, until: 'switch.lockO' },
    { at: lo.stand, r: 0.8, do: 'wait', until: 'raised.lockO_br' },
    ...v([rimF, rimI, [lo.islet.x, lo.islet.z]]).map((p) => ({ at: p, r: 0.5, do: 'go' })),
    ...lo.rewards.map((e) => ({ at: [e.pos[0], e.pos[2]], r: 0.4, do: 'go' })),
    { at: kb.spot, r: 0.6, do: 'sing', switch: 'kamen_brother', until: 'switch.kamen_brother' },
    ...v([rimI, rimF, back]).map((p) => ({ at: p, r: 0.5, do: 'go' })),
  ].map((a) => ({ ...a, profiles: ['revisit'] }));
  const after = (pred, acts) => level.actions.splice(level.actions.findIndex(pred) + 1, 0, ...acts);
  after((a) => a.until === 'echo.echo_shrine', visit);
  after((a) => a.do === 'fight' && a.enemy === 'kw', [{ at: sc.spot, r: 0.6, do: 'sing', switch: 'sc', until: 'switch.sc', home: 9 }]);
  const cam = [G.x + Math.cos(OTH) * 2 - Math.sin(OTH) * 9, G.y + 5, G.z + Math.sin(OTH) * 2 + Math.cos(OTH) * 9];
  level.shots.push(
    { name: 'lockO', pos: r2v(cam), look: r2v([lo.rune.pos[0], G.y + 1, lo.rune.pos[2]]) },
    { name: 'lockO_open', pos: r2v(cam), look: r2v([lo.rune.pos[0], G.y + 1, lo.rune.pos[2]]), fire: ['lockO'] },
    { name: 'shortcut', pos: r2v([K5.x + 10, G.y + 4, rimNear(G) - 4]), look: r2v([K5.x, K5.y + 1, rimNear(G) - 1]), fire: ['runeK', 'sc'] },
  );
});

// ---------- R8: the three endings (hud.js picks one by core/save.js endingFor: bad | middle = 'finale' | true) ----------
// bad: the knot loosens but the islands came half-remembered: no sunrise (the sun ramp stays low), the clouds never part and the islands
// do not drift closer (no fx 'finale'), Orren fades unanswered.
// true: every name spoken and his whole tale known: the sun climbs, Orren is named back into a Keeper, the three friends answer.
{
  const F = level.cutscenes.finale, line = (at, dur, en, ru) => ({ at, dur, text: { en, ru } });
  // the bad ending: one wind road only, and it frays
  level.cutscenes.finale_bad = { ...F, dur: 21, ribbon: [{ ...F.ribbon[0], fade: [8, 13] }], keys: F.keys.map((k) => (k.at === 19 ? { ...k, at: 16.5 } : k.at === 25 ? { ...k, at: 21 } : k)), // ends close behind the hero: the totem
    lines: [
      line(1, 5, 'The song reaches the knot. It loosens, slowly, unwillingly.', 'Песня касается узла. Он слабеет медленно, нехотя.'),
      line(6.5, 5.5, 'The winds go home, but many have forgotten the way.', 'Ветры летят домой, но многие забыли дорогу.'),
      line(12.6, 6.5, 'Orren fades without a word. No one here remembers his name.', 'Оррен тает без слова. Здесь никто не помнит его имени.'),
    ],
    events: [...F.events.filter((e) => !e.sun && !e.fx && e.cue !== 'birds').map((e) => (e.duck ? { ...e, duck: { ...e.duck, seconds: 21 } } : e)), { at: 6, sun: [0, 0.2, 12] }, { at: 1.5, fx: 'grey' }].sort((a, b) => a.at - b.at) };
  level.cutscenes.finale_true = { ...F, dur: 31, keys: [...F.keys, { at: 31, pos: [2.6, 27.4, 188], look: [3.1, 30, 206] }],
    lines: [
      ...F.lines,
      line(25, 5.6, 'Orren, youngest of the Keepers. Named, he lets go of the last cord: himself.', 'Оррен, младший из Хранителей. Названный по имени, он отпускает последнюю верёвку: себя.'),
    ],
    events: [...F.events.map((e) => (e.duck ? { ...e, duck: { ...e.duck, seconds: 31 } } : e)), { at: 24.6, cue: 'rune' }, { at: 25.2, cue: 'birds', gain: 1 }] };
}

await K.write({ world, collider, inst, level, decor: [...decor.filter((d) => d !== arch && d.glb !== KNOT), ...farDecor, ...props.filter((p) => p.glb === PILLAR).map((p) => ({ ...p, scale: p.scale ?? 1 }))] }); // pillars: decor (one draw), collider via props
