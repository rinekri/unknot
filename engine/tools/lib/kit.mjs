// Shared level-generator kit (l1, l2, l3): seeded noise, floating islands, rock/grass/scatter/distant builders,
// slab pieces, collider, feasibility checks and the writer. Every layout builder draws from ONE seeded stream, so a level
// generator must call them in a fixed order to stay reproducible; ambient builders (distant ring, landmark, waterfalls) run
// on their own streams via own().
// Usage: const K = makeKit(seed, outUrl); K.island(...); ... await K.write({ world, collider, inst, level });
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TUNING, jumpReach, dashReach, dash2Reach } from '../../src/systems/player.js';
import { mulberry32 } from '../../src/core/rng.js';

globalThis.FileReader ??= class { readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend(); }); } };

export const MAX_FRAC = 0.9, AIM = [0.6, 0.75];
export const PAL = { moss: '#8f9a4e', cloak: '#5f6f5c', stoneL: '#d5c3a9', stoneS: '#645d4f', haze: '#e9d2b4', ink: '#342d24', distant: '#b4adb8' };
export const col = (h) => new THREE.Color(h); // sRGB hex -> linear (ColorManagement)
export const RUNE = 'assets/props/rune_stone/rune_stone.glb', PILLAR = 'assets/props/ruin_pillar/ruin_pillar.glb', TOTEM = 'assets/props/wind_totem/wind_totem.glb';
export const NAME = 'assets/props/name_stone.glb', STAKE = 'assets/props/anchor_stake.glb'; // NAME: one of its meshes per prop (`mesh`)
export const PROP_BOX = { [PILLAR]: [0.62, 2.5, 0.62], [RUNE]: [0.62, 1.0, 0.56], [TOTEM]: [0.46, 1.8, 0.46], [STAKE]: [0.2, 1.21, 0.2, 0, 0.015], // [w, h, d, offX, offZ]: the mesh bounds
  [`${NAME}#name_a`]: [0.68, 1.64, 0.45, 0, 0.005], [`${NAME}#name_b`]: [1.15, 0.96, 0.86, -0.005, -0.02], [`${NAME}#name_c`]: [0.88, 1.38, 0.73, 0.02, 0.005] };
export const TREE = 'assets/props/wind_tree/wind_tree.glb', ARCH = 'assets/props/ruin_arch/ruin_arch.glb', STAIRS = 'assets/props/broken_stairs/broken_stairs.glb',
  SHRINE = 'assets/props/shrine/shrine.glb', RUBBLE = 'assets/props/rubble/rubble.glb';
// Pure decor (tools/props_decor.py): a different family from the props that react to a strike. KNOT: Orren's binding posts,
// two nodes (knot_post / knot_rope), placed as level props so level.js can sink them (gen_l3).
export const MENHIR = 'assets/props/menhir.glb', STUMP = 'assets/props/totem_stump.glb', KNOT = 'assets/props/knot_post.glb';
// Interactive models: anything wearing these must do something when struck/touched. Decor never uses them, and a level prop
// that does must be a switch (mechanism node or NPC switch); write() throws otherwise.
export const INTERACTIVE = [RUNE, NAME, TOTEM, STAKE, 'assets/props/cairn.glb', 'assets/props/goal_circle.glb', 'assets/props/knot_chunk.glb'];
// Decor (instanced from placement.json `props`): r = footprint radius at scale 1, boxes = collider [w, h, d, offX, offZ, offY=0],
// measured from the GLBs (height-map + vertex slices). Boxes follow the visuals: no wall where there is air, no air where there is a wall.
// minScale: smaller instances get no collider (rubble below ~0.5 m is decoration, the walkable 0.35 m step-up would hop it).
// The tree's crown spans z -0.8..1.15 from y 1.1 (head height: collider); the arch is walked through
// along X (legs at +-Z, lintel from y 2.2); the stairs descend along +X from a 1.0 m back, six <= 0.2 m risers (walkable).
const V2 = 'assets/props/v2/';
const STAIR_STEPS = [[-0.95, -0.45, 1.0], [-0.45, -0.05, 0.8], [-0.05, 0.15, 0.7], [0.15, 0.45, 0.5], [0.45, 0.65, 0.4], [0.65, 0.95, 0.2]]; // [x0, x1, top]
export const DECOR = {
  [TREE]: { r: 1.2, boxes: [[0.9, 0.5, 1.2, 0.05, 0.25], [0.5, 1.2, 0.7, 0.1, 0.25], [0.55, 1.5, 1.95, -0.03, 0.15, 1.1]] }, // roots, trunk, crown (z -0.8..1.15 from y 1.1: head height)
  [ARCH]: { r: 1.45, boxes: [[0.9, 2.8, 0.6, 0, -1.05], [0.9, 2.8, 0.6, 0, 1.05], [0.8, 0.6, 2.7, 0, 0, 2.2]] },
  [STAIRS]: { r: 1.1, boxes: [...STAIR_STEPS.map(([x0, x1, h]) => [x1 - x0, h, 1.1, (x0 + x1) / 2, 0]), [0.4, 1.65, 0.35, -0.75, -0.12]] }, // + broken wall post on the back (to 1.6 m)
  [SHRINE]: { r: 0.9, boxes: [[1.7, 0.4, 1.7, 0, 0], [1.3, 1.2, 1.3, 0, 0]] },
  [RUBBLE]: { r: 1.0, minScale: 0.75, boxes: [[1.05, 0.9, 1.7, -0.175, 0], [0.5, 0.4, 1.1, 0.55, -0.3]] }, // main pile + low slab (a step). Pile box 0.9 (mesh 0.8): at minScale its top must stay above the grounded low sphere centre (stepUp + radius = 0.65 m) or a capsule stepping off the slab drops into it
  [PILLAR]: { r: 0.4, boxes: [[0.62, 2.5, 0.62, 0, 0]] }, [RUNE]: { r: 0.4, boxes: [[0.62, 1.0, 0.56, 0, 0]] }, [TOTEM]: { r: 0.4, boxes: [[0.46, 1.8, 0.46, 0, 0]] },
  // v2 variants (assets/props/v2, same tripo textures, reshaped): decorate() swaps a TREE/ARCH/RUBBLE/PILLAR spot for one by a
  // position hash (VARIANT) into `var`: `glb` stays the base, so a generator can still find its arch. Boxes from height slices: arch_b lost its lintel (one leg to 1.75 m), arch_c is wider (legs at +-1.25).
  [`${V2}ruin_pillar_b.glb`]: { r: 0.45, boxes: [[0.66, 1.42, 0.66, -0.01, -0.06]] },
  [`${V2}ruin_pillar_c.glb`]: { r: 0.5, boxes: [[0.6, 1.5, 0.62, 0, 0.05], [0.6, 1.35, 0.62, 0, 0.3, 1.5]] }, // leans toward +z
  [`${V2}ruin_arch_b.glb`]: { r: 1.45, boxes: [[0.8, 1.75, 0.8, 0, -1.0], [0.85, 2.2, 0.75, 0, 0.95]] },
  [`${V2}ruin_arch_c.glb`]: { r: 1.85, boxes: [[0.9, 2.0, 1.0, 0, -1.25], [0.9, 2.0, 1.0, 0, 1.2], [0.8, 0.6, 3.2, 0, 0, 1.95]] },
  [`${V2}wind_tree_b.glb`]: { r: 1.3, boxes: [[0.9, 0.4, 1.2, 0, 0.2], [0.45, 1.0, 0.6, 0.08, 0.3], [0.55, 1.08, 2.1, -0.03, -0.25, 1.0]] },
  [`${V2}wind_tree_c.glb`]: { r: 1.4, boxes: [[1.1, 0.5, 1.3, 0, 0.25], [0.5, 1.0, 0.8, -0.1, 0.4], [0.7, 1.8, 2.4, 0.03, 0.12, 1.2]] },
  [`${V2}rubble_b.glb`]: { r: 1.15, minScale: 0.75, boxes: [[1.6, 0.85, 1.5, 0.2, -0.1], [2.1, 0.3, 1.7, 0.05, -0.06]] }, // pile + a low skirt (a step)
  [`${V2}rubble_c.glb`]: { r: 0.75, minScale: 0.75, boxes: [[1.2, 0.85, 1.15, 0.05, 0.05]] },
  [MENHIR]: { r: 0.4, boxes: [[0.5, 1.55, 0.36, 0.02, 0]] }, [STUMP]: { r: 0.4, boxes: [[0.3, 0.65, 0.3, 0, 0], [1.45, 0.24, 0.26, -1.0, 0]] }, [KNOT]: { r: 0.4, boxes: [[0.22, 1.5, 0.22, 0, 0]] }, // stump box 0.65 (mesh 0.62): above log top + stepUp, or the log is a stair onto it
};
const VARIANT = { [TREE]: 'wind_tree', [ARCH]: 'ruin_arch', [RUBBLE]: 'rubble', [PILLAR]: 'ruin_pillar' }; // base, _b, _c: a third each
export const r2 = (v) => +v.toFixed(2);
export const r2v = (v) => v.map(r2);
export const facing = (from, to) => r2(Math.atan2(to[0] - from[0], to[2] - from[2])); // heading (forward = sin, cos) from a point toward the next objective
export const poly = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]].map((p) => p.map(r2));
const D2R = Math.PI / 180;
const GRASS = { base: col('#b3c584'), wash: col('#dbe0a0'), dark: col('#7f9468'), dry: col('#d6c98c'), cool: col('#93b98f'), stone: col('#c9c2b6') };
const ROCK = { l: '#ddd6cc', s: '#8b8590' }; // stone albedo: renders as STYLE stone light/shadow under the warm ramp + cool fill

export function makeKit(seed, out) {
  fs.mkdirSync(out, { recursive: true });
  let stream = mulberry32(seed);
  const rnd = () => stream();
  const rr = (a, b) => a + (b - a) * rnd();
  const own = (salt, fn) => { // run fn on its own seeded stream: ambient builders never shift the play layout's draws
    const main = stream;
    stream = mulberry32((seed * 131 + salt) >>> 0);
    try { return fn(); } finally { stream = main; }
  };

  // 3D value noise for displacement (seeded lattice).
  const LAT = Array.from({ length: 4096 }, () => rnd());
  const lat = (x, y, z) => LAT[(((x * 73856093) ^ (y * 19349663) ^ (z * 83492791)) >>> 0) % 4096];
  function vnoise(x, y, z) {
    const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z), fx = x - ix, fy = y - iy, fz = z - iz;
    const s = (t) => t * t * (3 - 2 * t), u = s(fx), v = s(fy), w = s(fz), L = (a, b, t) => a + (b - a) * t;
    return L(L(L(lat(ix, iy, iz), lat(ix + 1, iy, iz), u), L(lat(ix, iy + 1, iz), lat(ix + 1, iy + 1, iz), u), v),
      L(L(lat(ix, iy, iz + 1), lat(ix + 1, iy, iz + 1), u), L(lat(ix, iy + 1, iz + 1), lat(ix + 1, iy + 1, iz + 1), u), v), w) * 2 - 1;
  }

  // ---------- layout ----------
  // Islands: id, x, z, top y, radius. Rim radius r(theta) = R * (1 + RIM * sum of seeded sines).
  // Each island also gets a look `st` from its own id-seeded stream (the layout stream never sees it): an underside family that
  // differs from the two islands made before it, visual depth, strata size and tilt, rock tone, grass hue, bare stone, lushness.
  const RIM = 0.07, FAMS = ['cone', 'mesa', 'terraced', 'keel', 'spike'], lastFam = [];
  function styleOf(id) {
    let h = seed >>> 0; for (const ch of String(id)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
    const q = mulberry32(h), u = (a, b) => a + (b - a) * q(), pool = FAMS.filter((f) => !lastFam.includes(f)), fam = pool[Math.floor(q() * pool.length)];
    lastFam.push(fam); if (lastFam.length > 2) lastFam.shift();
    return { fam, vd: { cone: u(0.9, 1.25), mesa: u(0.5, 0.7), terraced: u(0.95, 1.2), keel: u(1.0, 1.35), spike: u(1.45, 1.9) }[fam], sz: u(0.6, 1.6), tilt: [u(-0.16, 0.16), u(-0.16, 0.16)], lean: u(0.6, 2),
      tone: u(-0.1, 0.1), warm: u(-1, 1), hue: u(-1, 1), hueK: u(0.15, 0.5), bare: q() < 0.3 ? u(0.25, 0.6) : 0, lush: u(0.45, 1.3), flower: u(0.04, 0.42), slabs: u(0, 3), ph: u(0, 6.28) };
  }
  function island(id, x, z, y, R, opt = {}) {
    const ph = [rr(0, 6.28), rr(0, 6.28), rr(0, 6.28)], st = styleOf(id);
    const rim = (th) => R * (1 + RIM * (0.6 * Math.sin(2 * th + ph[0]) + 0.3 * Math.sin(3 * th + ph[1]) + 0.25 * Math.sin(5 * th + ph[2])));
    return { id, x, z, y, R, rim, st, depth: opt.depth ?? R * rr(1.3, 1.7), wallDown: opt.wallDown ?? 2.5 };
  }
  const rimToward = (a, b) => a.rim(Math.atan2(b.z - a.z, b.x - a.x));
  const rimGap = (a, b) => Math.hypot(b.x - a.x, b.z - a.z) - rimToward(a, b) - rimToward(b, a);
  const isl = {};
  const chain = (id, from, gap, deg, dy, R, opt) => { // place island `gap` m rim-to-rim from `from`, heading `deg` (0 = +Z, 90 = +X)
    const ux = Math.sin(deg * D2R), uz = Math.cos(deg * D2R), t = island(id, 0, 0, from.y + dy, R, opt);
    let s = from.R + gap + R;
    for (let k = 0; k < 40; k++) { // solve the exact rim-to-rim gap with the noisy rims
      t.x = from.x + ux * s; t.z = from.z + uz * s;
      const d = Math.hypot(t.x - from.x, t.z - from.z) - rimToward(from, t) - rimToward(t, from);
      if (Math.abs(d - gap) < 0.005) return (isl[id] = t);
      s += gap - d;
    }
    throw new Error(`could not place ${id}`);
  };
  const noOverlap = (allowed = []) => { // islands must not merge (pairs in `allowed` sit on each other by design)
    for (const a of Object.values(isl)) for (const b of Object.values(isl))
      if (a.id < b.id && !allowed.some(([p, q]) => (a.id === p && b.id === q) || (a.id === q && b.id === p)) && rimGap(a, b) < 2.5) throw new Error(`islands ${a.id} and ${b.id} overlap`);
  };
  const rimFar = (a) => a.z + a.rim(Math.PI / 2), rimNear = (a) => a.z - a.rim(-Math.PI / 2);

  // ---------- geometry ----------
  function vcolor(g, fn) { // per-vertex color from position
    const p = g.attributes.position, c = new Float32Array(p.count * 3), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v, i).toArray(c, i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return g;
  }
  const nonIdx = (g) => { const n = g.index ? g.toNonIndexed() : g; n.deleteAttribute('uv'); n.deleteAttribute('normal'); n.computeVertexNormals(); return n; };

  // Grass cap: center fan + rings, then a mossy lip: overhang ring past the rim and scalloped skirt draping down the rock.
  // Albedos are biased cool/light: look.js multiplies them by the warm STYLE ramp, so lit grass lands on soft sage/yellow-green.
  function capGeo(s, N = 48, J = 6) {
    const pos = [], idx = [], R = J + 3; // rings 1..J top, J+1 overhang, J+2 skirt bottom
    pos.push(s.x, s.y + 0.01, s.z);
    for (let j = 1; j < R; j++) for (let i = 0; i < N; i++) {
      const th = (i / N) * Math.PI * 2, r = s.rim(th) * (j <= J ? j / J : j === J + 1 ? 1.035 : 1.025);
      const x = s.x + Math.cos(th) * r, z = s.z + Math.sin(th) * r;
      const drop = 0.18 + 0.22 * Math.max(0, vnoise(x * 1.7, 1.7, z * 1.7)) * Math.min(1, s.R / 4);
      const y = j <= J ? s.y + 0.012 + 0.012 * vnoise(x * 0.8, 3.1, z * 0.8) - (j === J ? 0.02 : 0) : j === J + 1 ? s.y - 0.05 : s.y - drop;
      pos.push(x, y, z);
    }
    const at = (j, i) => 1 + (j - 1) * N + (i % N);
    for (let i = 0; i < N; i++) idx.push(0, at(1, i + 1), at(1, i));
    for (let j = 1; j < R - 1; j++) for (let i = 0; i < N; i++) idx.push(at(j, i), at(j, i + 1), at(j + 1, i + 1), at(j, i), at(j + 1, i + 1), at(j + 1, i));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return vcolor(g, (v) => {
      const n = vnoise(v.x * 0.3, 0.5, v.z * 0.3), w = vnoise(v.x * 0.9 + 4, 2.5, v.z * 0.9);
      const c = GRASS.base.clone().lerp(n > 0 ? GRASS.wash : GRASS.dark, Math.abs(n) * 0.9).lerp(GRASS.wash, Math.max(0, w) * 0.5);
      c.lerp(s.st.hue > 0 ? GRASS.dry : GRASS.cool, Math.abs(s.st.hue) * s.st.hueK); // the island's own meadow: sun-dried or cool sage
      if (s.st.bare && v.y > s.y - 0.03 && vnoise(v.x * 0.45 + s.st.ph, 11.3, v.z * 0.45) > 0.55 - s.st.bare) c.lerp(GRASS.stone, 0.8); // worn through to the stone
      return v.y < s.y - 0.03 ? c.lerp(GRASS.dark, 0.45) : c; // lip in shade
    });
  }
  // Rock underside: stacked strata. Each stratum = jutting top ring + undercut bottom ring, split into blocks around the
  // circumference; the band between strata is a ledge (faces up: moss). Positions are continuous, but every block and
  // band gets its own smooth normals, so creases (and ink lines) fall on block seams and strata, not on every facet.
  // Lobed taper toward an offset tip. Colors: stone light -> shadow with depth, per-block tone, dark crevices and
  // undercuts, moss on ledges, ivy strands from the lip. Returns { geo, ivy: [[x,y,z]...], hang: [geo...] }.
  function rockGeo(s, N = THREE.MathUtils.clamp(Math.round(s.R * 5), 24, 60), strata = 0) { // strata > 0: about that many strata, scaled to the depth
    const st = s.st, fam = st.fam, vis = { ...s, depth: s.depth * st.vd }; s = vis; // the look's depth: the layout keeps its own
    const sz = (strata ? s.depth * 1.08 / strata : THREE.MathUtils.clamp(s.R / 5, 0.55, 1.8)) * st.sz;
    const lob = [rr(0, 6.28), rr(0, 6.28)], tip = [rr(-0.2, 0.2) * s.R * st.lean, rr(-0.2, 0.2) * s.R * st.lean];
    const lobeD = fam === 'keel' ? (th) => (1 + 0.5 * Math.sin(2 * th + lob[1]) + 0.12 * Math.sin(th + lob[0])) / 1.25 // a blade: deep along one axis
      : (th) => (1 + 0.3 * Math.sin(th + lob[0]) + 0.14 * Math.sin(2 * th + lob[1])) / 1.25;
    const prof = (f) => f >= 1 ? 0.05 : Math.max(0.05, fam === 'mesa' ? Math.sqrt(1 - Math.pow(f, 5)) * (1 - 0.18 * f) // a blunt slab
      : fam === 'terraced' ? Math.sqrt(1 - Math.pow(Math.min(0.97, Math.floor(f * 3 + 0.2) / 3 + 0.08 * f), 1.5)) // three broad steps
        : fam === 'spike' ? 0.12 + 0.88 * Math.pow(1 - f, 1.9) // a root: thins fast, hangs long
          : Math.sqrt(1 - Math.pow(f, 1.5)));
    const rings = [{ d: 0.02, off: -0.01 * s.R, blocks: [0], tone: 0 }];
    for (let d = 0.1 * sz; d < s.depth * 1.12;) {
      const t = rr(0.4, 1.5) * sz, blocks = Array.from({ length: Math.round(rr(4, 9)) }, () => rr(-1, 1)), tone = rr(-1, 1);
      rings.push({ d, off: rings.length === 1 ? -0.05 : rr(-0.1, 0.25) * t, blocks, tone }, { d: d + t, off: -rr(0.1, 0.3) * t, blocks, tone, under: 1, t });
      d += t + rr(0.04, 0.14) * sz;
    }
    const grid = rings.map((r, j) => {
      const fr = Math.min(1, r.d / s.depth), cx = s.x + tip[0] * fr, cz = s.z + tip[1] * fr, K = r.blocks.length;
      return Array.from({ length: N }, (_, i) => {
        const th = (i / N) * Math.PI * 2, f = r.d / (s.depth * lobeD(th)), P = prof(f);
        const u = (i / N) * K, b0 = Math.floor(u), q = u - b0, amp = Math.min(1, f * 4);
        const blk = q < 0.75 ? r.blocks[b0 % K] : THREE.MathUtils.lerp(r.blocks[b0 % K], r.blocks[(b0 + 1) % K], (q - 0.75) / 0.25);
        const rad = Math.max(0.1, s.rim(th) * P * (1 + amp * (0.16 * blk + 0.08 * vnoise(Math.cos(th) * 1.5 + s.x, r.d * 0.4, Math.sin(th) * 1.5 + s.z))) + r.off * Math.min(1, P * 2));
        return new THREE.Vector3(cx + Math.cos(th) * rad, s.y - r.d + (j ? 0.12 * sz * vnoise(th * 3, r.d, s.z) : 0) - (r.under ? 0.4 * r.t * (blk * 0.5 + 0.5) * amp : 0) + amp * rad * (st.tilt[0] * Math.cos(th) + st.tilt[1] * Math.sin(th)), cz + Math.sin(th) * rad); // tilted strata; // jutting blocks hang lower
      });
    });
    const tipV = new THREE.Vector3(s.x + tip[0] * 1.1, s.y - s.depth * (fam === 'mesa' ? 1.14 : 1.2), s.z + tip[1] * 1.1);
    const L = col(ROCK.l), S = col(ROCK.s), WARM = col('#d9c3a0'), COOL = col('#a9a8c2'), M = GRASS.dark.clone().lerp(GRASS.base, 0.4), ML = GRASS.base, ivy = [], parts = [];
    const color = (v, nrm, extra) => { // extra: block tone + crevice/undercut darkening
      const d = s.y - v.y, f = THREE.MathUtils.clamp(d / s.depth, 0, 1), n = vnoise(v.x * 0.5, v.y * 0.5, v.z * 0.5);
      const cc = L.clone().lerp(S, THREE.MathUtils.clamp(0.05 + f * 0.8 + n * 0.2 + extra + st.tone, 0, 1)).lerp(st.warm > 0 ? WARM : COOL, Math.abs(st.warm) * 0.16);
      const th = Math.atan2(v.z - s.z, v.x - s.x), arc = (th + Math.PI) * s.R;
      const len = s.depth * (0.15 + 0.45 * (vnoise(arc * 0.35, 9.1, s.z) * 0.5 + 0.5)), strand = vnoise(arc * 0.9, 3.3, s.x);
      if (nrm.y > 0.3 && d > 0.3) cc.lerp(vnoise(v.x * 0.4, v.y * 0.7, v.z * 0.4) > -0.1 ? M : L, THREE.MathUtils.smoothstep(nrm.y, 0.3, 0.7) * 0.85); // moss (or bare lit stone) on ledges
      else if (strand > 0.15 && d < len) { cc.lerp(n > 0 ? ML : M, 0.8 * (1 - 0.6 * d / len)); if (d > 0.2 && rnd() < 0.5) ivy.push([v.x + nrm.x * 0.05, v.y, v.z + nrm.z * 0.05]); }
      else if (d < 0.5) cc.lerp(M, 0.6);
      return cc;
    };
    const band = (rowA, rowB, i0, i1, extra) => { // quads between two rings over columns i0..i1 (wrapping), own normals
      const pos = [], idx = [], n = i1 - i0;
      for (let c = 0; c <= n; c++) for (const row of [rowA, rowB]) pos.push(...(Array.isArray(row) ? row[(i0 + c) % N] : row).toArray());
      for (let c = 0; c < n; c++) { const a = c * 2; idx.push(a, a + 2, a + 3, a, a + 3, a + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      const P = g.attributes.position, Nm = g.attributes.normal, c = new Float32Array(P.count * 3), v = new THREE.Vector3(), nv = new THREE.Vector3();
      for (let k = 0; k < P.count; k++) color(v.fromBufferAttribute(P, k), nv.fromBufferAttribute(Nm, k), extra((k >> 1) / Math.max(1, n), k & 1)).toArray(c, k * 3);
      g.setAttribute('color', new THREE.BufferAttribute(c, 3));
      parts.push(g.toNonIndexed());
    };
    for (let j = 0; j < rings.length - 1; j++) {
      const r = rings[j], amp = Math.min(1, r.d / s.depth * 4);
      if (!r.under && j > 0) { // stratum: split into blocks; crevice darkening at each block's leading seam, undercut row darker
        const K = r.blocks.length, cuts = Array.from({ length: K + 1 }, (_, b) => Math.round((b / K) * N));
        for (let b = 0; b < K; b++) { const tone = rr(-1, 1); band(grid[j], grid[j + 1], cuts[b], cuts[b + 1], (q, row) => amp * (0.14 * tone + 0.08 * r.tone + (q < 0.18 ? 0.22 : 0) + row * 0.12)); }
      } else band(grid[j], grid[j + 1], 0, N, (q, row) => (j ? amp * (0.1 + row * -0.05) : 0)); // lip band / ledge between strata
    }
    band(grid[rings.length - 1], tipV, 0, N, () => 0.2);
    // hanging chunks: knobs of rock clinging to the underside
    const hang = Array.from({ length: Math.round((2 + s.R * 0.4) * (fam === 'spike' ? 2 : 1)) }, () => {
      const j = 2 + Math.floor(rnd() * (rings.length - 3)), i = Math.floor(rnd() * N), p = grid[j][i], sc = rr(0.25, 0.6) * sz;
      return rockColors(nonIdx(chunk(sc, p.x - Math.cos(i / N * 6.283) * sc * 0.4, p.y - sc * 0.5, p.z - Math.sin(i / N * 6.283) * sc * 0.4, 1.6)), s.y, s.depth);
    });
    return { geo: mergeGeometries(parts), ivy, hang, grid };
  }
  const rockColors = (g, topY, depth) => {
    const L = col(ROCK.l), S = col(ROCK.s);
    return vcolor(g, (v) => L.clone().lerp(S, THREE.MathUtils.clamp((topY - v.y) / depth * 0.9 + vnoise(v.x * 0.6, v.y * 0.6, v.z * 0.6) * 0.25, 0, 1)));
  };
  function chunk(size, x, y, z, tall = 1) { // debris rock
    const g = new THREE.IcosahedronGeometry(size, 0), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * rr(0.75, 1.2), p.getY(i) * rr(0.6, 1.0) * tall, p.getZ(i) * rr(0.75, 1.2));
    g.rotateY(rr(0, 6.28)).rotateX(rr(-0.4, 0.4)).translate(x, y, z);
    return g;
  }
  function debris(s, n) {
    return Array.from({ length: n }, () => {
      const th = rr(0, 6.28), r = s.R * rr(0.5, 1.45), d = rr(0.8, s.depth * 1.4);
      return rockColors(nonIdx(chunk(rr(0.1, 0.5) * Math.min(1.4, s.R / 4), s.x + Math.cos(th) * r, s.y - d, s.z + Math.sin(th) * r)), s.y, s.depth);
    });
  }
  // Cut stone slab (bridge piece / stair / pad): rough-hewn block around local origin. Flat walkable top with chipped edges,
  // underside tapering like a broken rock chunk; colored like the island rock (light top -> shadow below, moss on top).
  // The taper/chip pass uses vnoise only, so the shared seeded stream sees the same draws as before.
  function slabGeo(p, thick, seedTop) {
    const g = new THREE.BoxGeometry(p.w, thick, p.z1 - p.z0, 3, 2, 3), a = g.attributes.position;
    for (let i = 0; i < a.count; i++) if (a.getY(i) < thick / 2 - 1e-4) a.setXYZ(i, a.getX(i) * rr(0.93, 1.04), a.getY(i), a.getZ(i) * rr(0.95, 1.02));
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i), y = a.getY(i), z = a.getZ(i), f = THREE.MathUtils.clamp((thick / 2 - y) / thick, 0, 1); // 0 top .. 1 bottom
      const k = 1 - 0.24 * f * f + 0.05 * vnoise(x * 2 + seedTop, y * 2, z * 2);
      a.setXYZ(i, x * k, y - (f > 0.99 ? 0.25 * thick * (vnoise(x * 1.5, seedTop, z * 1.5) * 0.5 + 0.5) : 0), z * k);
    }
    g.translate(0, -thick / 2, 0);
    const geo = nonIdx(g);
    const L = col(ROCK.l), S = col(ROCK.s), M = GRASS.dark.clone().lerp(GRASS.base, 0.4);
    return vcolor(geo, (v) => {
      const f = THREE.MathUtils.clamp(-v.y / thick, 0, 1), n = vnoise(v.x * 1.3 + seedTop, v.y * 1.3, v.z * 1.3);
      const c = L.clone().lerp(S, THREE.MathUtils.clamp(0.06 + f * 0.75 + n * 0.18, 0, 1));
      if (v.y > -0.01) return vnoise(v.x * 1.4 + seedTop, 1, v.z * 1.4) > 0.3 ? c.lerp(M, 0.65) : c;
      return v.y > -0.14 ? c.lerp(M, 0.3) : c; // mossy lip under the top edge
    });
  }

  // ---------- world.glb ----------
  const mat = (name) => Object.assign(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }), { name });
  const mesh = (name, geo, m) => Object.assign(new THREE.Mesh(geo, m), { name });
  const grassM = mat('grass'), rockM = mat('rock'), stoneM = mat('stone');
  function islandMeshes(world, play, avoid = []) { // avoid [[x, z, r]]: no middle-distance islet there // grass caps + rock undersides (with hanging chunks and debris); returns rocks (ivy points)
    const rocks = play.map((s, i) => own(3000 + i, () => rockGeo(s))); // own stream each: a new look never shifts the rest
    // Depth layers (own stream, no collider, same two meshes): boulders hanging low beside the big islands, and a middle distance of
    // islets in ones, pairs and triplets, 22 m or more from any island of the route (out of every reach) and off its corridors.
    const caps = [], more = [];
    own(3999, () => {
      const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
      const seg = (q, a, b) => { const dx = b.x - a.x, dz = b.z - a.z, t = THREE.MathUtils.clamp(((q.x - a.x) * dx + (q.z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1); return Math.hypot(q.x - a.x - dx * t, q.z - a.z - dz * t); };
      const lanes = play.flatMap((a, i) => play.slice(i + 1).filter((b) => flat(a, b) - a.R - b.R < 16).map((b) => [a, b]));
      for (const s of play) if (s.R >= 4) for (let k = Math.round(rr(1, 3.4)); k-- > 0;) {
        const th = rr(0, 6.28), d = s.R * rr(1.25, 1.8) + 1.5, sc = rr(0.5, 1.3) * Math.min(1.6, s.R / 5), q = { x: s.x + Math.cos(th) * d, z: s.z + Math.sin(th) * d }, y = s.y - rr(2, Math.max(3, s.depth * 0.9));
        const g = rockColors(nonIdx(chunk(sc, q.x, y, q.z, rr(0.8, 2))), s.y, s.depth);
        if (play.every((o) => flat(q, o) > o.R + sc + 2.5) && lanes.every(([a, b]) => seg(q, a, b) > sc + 4)) more.push(g);
      }
      for (let k = 0; k < 12; k++) {
        const o = play[Math.floor(rnd() * play.length)], th = rr(0, 6.28), d = rr(28, 70), R = rr(2.5, 7.5), n = rnd() < 0.4 ? 1 : rnd() < 0.65 ? 2 : 3;
        const group = [island(`mid${k}`, o.x + Math.cos(th) * d, o.z + Math.sin(th) * d, o.y + rr(-20, 9), R, { depth: R * rr(1.2, 1.8) })];
        for (let j = 1; j < n; j++) { const t = rr(0, 6.28), r = R * rr(0.3, 0.6), dd = R + r + rr(1, 4); group.push(island(`mid${k}_${j}`, group[0].x + Math.cos(t) * dd, group[0].z + Math.sin(t) * dd, group[0].y + rr(-R * 0.7, R * 0.4), r)); }
        const geos = group.flatMap((q) => { const r = rockGeo(q, 22); caps.push(nonIdx(capGeo(q, 22, 3))); return [r.geo, ...r.hang, ...debris(q, 2)]; }); // draws kept when it is dropped
        if (group.every((q) => play.every((p) => flat(q, p) - p.R - q.R > 22) && !avoid.some(([x, z, r]) => Math.hypot(q.x - x, q.z - z) < r + q.R))) more.push(...geos); else caps.length -= n;
      }
    });
    world.add(mesh('islands__grass', mergeGeometries([...play.map((s) => nonIdx(capGeo(s))), ...caps]), grassM));
    world.add(mesh('islands__rock', mergeGeometries([...play.flatMap((s, i) => [rocks[i].geo, ...rocks[i].hang, ...debris(s, Math.round(rr(5, 10)))]), ...more]), rockM));
    return rocks;
  }

  // Distant ring (own stream): the rock generator at low detail, unlit, shading baked in pale lavender-grey so fog fades them.
  // Strata scale with R (3-4 per island); each island is squashed / stretched and tilted, with 1-3 small satellites; some carry
  // ruined arch silhouettes (opt.arch = chance, opt.n = island count).
  const SUN_BAKE = new THREE.Vector3(-0.5, 0.35, 1).normalize();
  const bake = (geos, dark, light) => { const D = col(dark), L = col(light); for (const g of geos) { const n = g.attributes.normal; vcolor(g, (v, i) => D.clone().lerp(L, THREE.MathUtils.clamp(0.55 + 0.45 * (n.getX(i) * SUN_BAKE.x + n.getY(i) * SUN_BAKE.y + n.getZ(i) * SUN_BAKE.z), 0, 1))); } return geos; };
  // Two-tone: a grass cap on the upward faces near the island top, a pale lit rim band just under it, darker rock sides, the underside cooler below
  const D_TOP = col('#a7b783'), D_RIM = col('#ece4d8'), D_SIDE = col('#8f8796'), D_UNDER = col('#7f7990');
  const tint = (geos, top) => { for (const g of geos) { const p = g.attributes.position, n = g.attributes.normal, c = g.attributes.color, k = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) - top, ny = n.getY(i); k.fromBufferAttribute(c, i);
      k.lerp(D_SIDE, 0.45 * (1 - THREE.MathUtils.smoothstep(ny, 0.2, 0.6)) * THREE.MathUtils.smoothstep(-y, 1.5, 4));
      k.lerp(D_TOP, 0.92 * THREE.MathUtils.smoothstep(ny, 0.45, 0.8) * THREE.MathUtils.smoothstep(y, -2.5, -0.5));
      k.lerp(D_RIM, 0.5 * (1 - THREE.MathUtils.smoothstep(Math.abs(y + 1.2), 0, 0.9)) * (1 - THREE.MathUtils.smoothstep(ny, 0.3, 0.6)));
      k.lerp(D_UNDER, 0.55 * THREE.MathUtils.smoothstep(-y, 4, 16));
      k.toArray(c.array, i * 3);
    } } };
  const rockBlob = (s, N) => { const r = rockGeo(s, N, rr(3, 4)); return [nonIdx(capGeo(s, N, 2)), r.geo, ...r.hang]; };
  const box = (w, h, d, x, y, z, ry) => nonIdx(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).rotateY(ry).translate(x, y, z));
  function arch(s, k) { // two pillars and a lintel, sometimes broken (short pillar, no lintel)
    const span = s.R * rr(0.3, 0.55) * k, h = s.R * rr(0.45, 0.85) * k, w = span * 0.13, ry = rr(0, 3.14), ox = s.x + rr(-0.3, 0.3) * s.R, oz = s.z + rr(-0.3, 0.3) * s.R;
    const c = Math.cos(ry), sn = Math.sin(ry), broken = rnd() < 0.4, h2 = broken ? h * rr(0.35, 0.7) : h;
    const out = [box(w, h, w, ox + c * span / 2, s.y - 0.3, oz - sn * span / 2, ry), box(w, h2, w, ox - c * span / 2, s.y - 0.3, oz + sn * span / 2, ry)];
    if (!broken) out.push(box(span + w * 1.6, w * 0.9, w * 1.2, ox, s.y - 0.3 + h, oz, ry));
    return out;
  }
  function distantRing(world, CEN, opt = {}) {
    own(101, () => {
      const far = [], isl = [], n = opt.n ?? 13, archP = opt.arch ?? 0.5, m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + rr(-0.15, 0.15), d = rr(125, 210), R = rr(6, 18);
        const s = island(`far${k}`, CEN.x + Math.cos(a) * d, CEN.z + Math.sin(a) * d, rr(-30, 8), R, { depth: R * rr(1.1, 1.9) });
        const geos = [...rockBlob(s, 18), ...debris(s, 4)];
        for (let j = Math.floor(rr(1, 4)); j-- > 0;) { // satellites: small rocks hanging beside the big one
          const t = rr(0, 6.28), r2 = rr(1.2, Math.max(1.6, R * 0.28)), dd = R * rr(1.2, 1.8);
          geos.push(...rockBlob(island(`far${k}s${j}`, s.x + Math.cos(t) * dd, s.z + Math.sin(t) * dd, s.y + rr(-R * 0.6, R * 0.25), r2), 10));
        }
        if (rnd() < archP) for (let j = rnd() < 0.4 ? 2 : 1; j-- > 0;) geos.push(...arch(s, j ? 0.7 : 1));
        // non-uniform scale + tilt about the island's top centre
        m.compose(new THREE.Vector3(s.x, s.y, s.z), q.setFromEuler(e.set(rr(-0.16, 0.16), rr(0, 6.28), rr(-0.16, 0.16))), new THREE.Vector3(rr(0.8, 1.35), rr(0.75, 1.3), rr(0.8, 1.35)))
          .multiply(new THREE.Matrix4().makeTranslation(-s.x, -s.y, -s.z));
        bake(geos, opt.dark ?? '#a9a3b3', opt.light ?? '#d8d3dc');
        tint(geos, s.y);
        if (opt.clear?.some(([x, z, r]) => Math.hypot(s.x - x, s.z - z) < r + R)) continue; // a neighbour island stands there (farIsland); draws kept
        isl.push({ x: s.x, y: s.y, z: s.z, geos: geos.map((g) => g.applyMatrix4(m)) });
      }
      // opt.drift {to: [x, z], n}: the n islands nearest `to` become their own meshes 'distant__drift<i>' (origin = island top centre),
      // moved by world.js in the l3 finale; the rest stay one merged mesh
      const drift = opt.drift ? [...isl].sort((a, b) => Math.hypot(a.x - opt.drift.to[0], a.z - opt.drift.to[1]) - Math.hypot(b.x - opt.drift.to[0], b.z - opt.drift.to[1])).slice(0, opt.drift.n) : [];
      const mat = Object.assign(new THREE.MeshBasicMaterial({ vertexColors: true }), { name: 'distant' });
      for (const it of isl) if (!drift.includes(it)) far.push(...it.geos);
      world.add(mesh('distant__haze', mergeGeometries(far), mat));
      drift.forEach((it, i) => { const o = mesh(`distant__drift${i}`, mergeGeometries(it.geos).translate(-it.x, -it.y, -it.z), mat); o.position.set(it.x, it.y, it.z); world.add(o); });
    });
  }

  // Neighbour island (own stream): the level before or after, seen across the gap. Built like a play island at lower detail, lit
  // and fogged like one (look.js: 'grass' cap in the level's tint, 'rock' strata with the triplanar detail): two meshes
  // 'distant__<name>__grass' / '__rock' (cap + underside, debris, 3 satellites). Its ruins are real prop GLBs at ~2.4x, returned as
  // decor entries ({far: true}) for write({decor}) only (no collider; an interactive GLB is allowed there, nothing can reach it).
  // kind 'totems' = Orren's workshop (l2): wind totems, trees, a shrine, pillars; 'stones' = the Keepers' quarry (l1): a menhir
  // ring, an arch, stairs off the rim, rubble.
  function farIsland(world, { name, x, z, y, R, kind }) {
    return own(404, () => {
      const s = island(name, x, z, y, R, { depth: R * 1.5 }), parts = [s];
      for (let j = 0; j < 3; j++) { const t = rr(0, 6.28), dd = R * rr(1.25, 1.6); parts.push(island(`${name}s${j}`, x + Math.cos(t) * dd, z + Math.sin(t) * dd, y + rr(-R * 0.5, R * 0.1), R * rr(0.15, 0.25), { depth: R * 0.3 })); }
      const rocks = parts.map((q, i) => rockGeo(q, i ? 14 : 36, i ? 2 : 4));
      world.add(mesh(`distant__${name}__grass`, mergeGeometries(parts.map((q, i) => nonIdx(capGeo(q, i ? 14 : 36, i ? 2 : 4)))), grassM));
      world.add(mesh(`distant__${name}__rock`, mergeGeometries(parts.flatMap((q, i) => [rocks[i].geo, ...rocks[i].hang, ...debris(q, i ? 1 : 6)])), rockM));
      const out = [], K = 2.4, top = y - 0.05, put = (glb, r, a, k = K, rotY = rr(0, 6.28)) => out.push({ id: `far_${name}_${out.length}`, glb, far: true, pos: [x + Math.cos(a) * s.rim(a) * r, top, z + Math.sin(a) * s.rim(a) * r], rotY, scale: k * rr(0.9, 1.1) });
      if (kind === 'totems') {
        for (let i = 0; i < 5; i++) put(TOTEM, rr(0.2, 0.55), (i / 5) * 6.283 + rr(-0.3, 0.3), K * 1.15);
        put(SHRINE, 0.05, 0, K * 1.1);
        for (const a of [1.0, 3.6]) put(TREE, 0.72, a);
        for (const a of [2.3, 5.1]) put(PILLAR, 0.7, a);
      } else {
        for (let i = 0; i < 8; i++) if (i !== 5) { const a = (i / 8) * 6.283; put(MENHIR, 0.4, a, K * 1.1, -a - Math.PI / 2); }
        put(ARCH, 0.05, 0, K);
        { const a = rr(0, 6.28); put(STAIRS, 0.85, a, K, -a + Math.PI); } // climbing out over the rim into nothing
        for (const a of [0.9, 2.6, 4.4]) put(RUBBLE, 0.72, a);
      }
      return out;
    });
  }

  // Crown beacon (own stream): a far spire on a big rock with a ring of floating debris. Unlit pale stone with a warm lit side;
  // the runtime (world.js) turns fog off on it, spins 'landmark_ring' and adds the faint gold beam. Returns the spire top.
  function landmark(world, { x, z, y = -30, R = 16, h = 100 }) {
    return own(202, () => {
      const s = island('landmark', x, z, y, R, { depth: R * 1.6 }), parts = rockBlob(s, 28);
      let r0 = R * 0.32, yy = y - 0.5;
      for (const f of [0.26, 0.22, 0.18, 0.14, 0.12, 0.08]) { // tapering tiers, each a little off-axis, with a lip
        const th = h * f, r1 = r0 * rr(0.72, 0.82), ox = rr(-0.4, 0.4), oz = rr(-0.4, 0.4);
        parts.push(nonIdx(new THREE.CylinderGeometry(r1, r0, th, 7).translate(x + ox, yy + th / 2, z + oz)), nonIdx(new THREE.CylinderGeometry(r1 * 1.15, r1 * 1.15, th * 0.06, 7).translate(x + ox, yy + th, z + oz)));
        yy += th; r0 = r1;
      }
      for (let i = 0; i < 6; i++) { const t = (i / 6) * 6.283, hh = rr(6, 11); parts.push(nonIdx(new THREE.ConeGeometry(r0 * 0.35, hh, 5).translate(x + Math.cos(t) * r0, yy + hh / 2, z + Math.sin(t) * r0))); } // crown points
      parts.push(nonIdx(new THREE.ConeGeometry(r0 * 0.4, 16, 6).translate(x, yy + 8, z)));
      const ring = [];
      for (let i = 0; i < 30; i++) { const t = (i / 30) * 6.283 + rr(-0.08, 0.08), rad = R * rr(1.5, 2.1); ring.push(rockColors(nonIdx(chunk(rr(0.6, 2.2), Math.cos(t) * rad, rr(-3, 3), Math.sin(t) * rad)), 3, 6)); }
      const matB = Object.assign(new THREE.MeshBasicMaterial({ vertexColors: true }), { name: 'beacon' }), g = new THREE.Group(), rg = new THREE.Group();
      g.name = 'landmark'; rg.name = 'landmark_ring'; rg.position.set(x, y + h * 0.42, z);
      g.add(mesh('landmark__spire', mergeGeometries(bake(parts, '#b7aec2', '#f4e4c8')), matB));
      rg.add(mesh('landmark__debris', mergeGeometries(bake(ring, '#b7aec2', '#efe0c8')), matB));
      g.add(rg);
      world.add(g);
      return r2v([x, yy + 16, z]);
    });
  }

  // Waterfalls (own stream): ribbons off the side rims of play islands, following the rock hull down and falling free below it;
  // uv = (across 0..1, metres down / 30: kept in 0..1 for meshopt), vertex color = fade (1 at the lip .. 0 at the end). world.js swaps in the streak shader.
  // Skips spots whose ribbon would cross another island or the route. Returns [{ top, pos (mist point), len }].
  function waterfalls(world, play, rocks, n, route = []) {
    return own(303, () => {
      const pos = [], uv = [], cl = [], idx = [], out = [];
      const cand = play.map((s, i) => ({ s, rk: rocks[i] })).filter((c) => c.s.R >= 4);
      for (let tries = 0; out.length < n && tries < 60 && cand.length; tries++) {
        const { s, rk } = cand[Math.floor(rnd() * cand.length)], N = rk.grid[0].length;
        const th0 = (rnd() < 0.5 ? 0 : Math.PI) + rr(-0.6, 0.6), ci = ((Math.round((th0 / (2 * Math.PI)) * N) % N) + N) % N, th = (ci / N) * 2 * Math.PI;
        const cx = Math.cos(th), sz = Math.sin(th), L = rr(14, 26), w = rr(0.7, 1.6), hull = rk.grid.map((row) => ({ y: row[ci].y, r: (row[ci].x - s.x) * cx + (row[ci].z - s.z) * sz }));
        const rows = [0, 0.3, 0.8, 1.6, 2.6, 4, 6, 8.5, 11.5, 15, 19, 23, 26].filter((d) => d < L).concat(L);
        const pts = rows.map((d) => { const yy = s.y - d, hr = Math.max(0, ...hull.filter((p) => p.y >= yy - 1.5).map((p) => p.r)); return { d, y: yy, r: Math.max(hr + 0.4, s.rim(th) + 0.15 + 0.7 * Math.sqrt(d)) }; });
        const end = pts[pts.length - 1], ex = s.x + cx * end.r, ez = s.z + sz * end.r;
        if (play.some((o) => o !== s && o.y < s.y + 1 && Math.hypot(o.x - ex, o.z - ez) < o.R * 1.3 + 2)) continue; // falls onto / through a lower island
        if (route.some((p) => p[1] < s.y + 0.5 && Math.hypot(p[0] - ex, p[2] - ez) < 4)) continue;
        if (out.some((f) => Math.hypot(f.top[0] - (s.x + cx * s.R), f.top[2] - (s.z + sz * s.R)) < 6)) continue;
        const base = pos.length / 3;
        pts.forEach((p, k) => {
          const hw = (w * (1 + 0.05 * p.d)) / 2, x = s.x + cx * p.r, z = s.z + sz * p.r, f = 1 - THREE.MathUtils.smoothstep(p.d / L, 0.45, 1);
          pos.push(x - sz * hw, p.y, z + cx * hw, x + sz * hw, p.y, z - cx * hw);
          uv.push(0, p.d / 30, 1, p.d / 30); cl.push(f, f, f, f, f, f);
          if (k) { const a = base + (k - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
        });
        const mid = pts[Math.floor(pts.length * 0.6)];
        out.push({ top: r2v([s.x + cx * pts[0].r, s.y, s.z + sz * pts[0].r]), pos: r2v([s.x + cx * mid.r, mid.y, s.z + sz * mid.r]), len: r2(L) });
      }
      if (!out.length) return out;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cl, 3));
      g.setIndex(idx); g.computeVertexNormals();
      world.add(mesh('waterfalls', g, Object.assign(new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide }), { name: 'waterfall' })));
      return out;
    });
  }

  // Scatter: instanced via placement.json (no collision, skipped by the ink-edge pass via placement.noEdges).
  // Sources live at the origin; the loader swaps each for an InstancedMesh. clear(x, z) = false keeps a spot bare.
  function scatter(world, play, rocks, clear) {
    const scatterM = Object.assign(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, side: THREE.DoubleSide }), { name: 'scatter' });
    function tris(verts, cols, up = true) { // flat triangle soup; up = soft upward normals (painted, not per-blade facets)
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols.flatMap((c) => c.toArray()), 3));
      if (up) g.setAttribute('normal', new THREE.Float32BufferAttribute(verts.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3)); else g.computeVertexNormals();
      return g;
    }
    function blades(n, h, v, c, tipC, w = 0.035) {
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.283 + rr(-0.4, 0.4), hh = h * rr(0.6, 1.1), lean = rr(0.2, 0.5), px = -Math.sin(a) * w, pz = Math.cos(a) * w;
        v.push(px, 0, pz, -px, 0, -pz, Math.cos(a) * lean * hh, hh, Math.sin(a) * lean * hh);
        c.push(GRASS.dark, GRASS.dark, tipC);
      }
    }
    // Tuft = painted clump: a low dark mound (merges the blade bases into one mass) under broad, overlapping leaf blades
    // whose tips wash from sage to pale; reads as one brush dab, not a fan of paper blades.
    const tv = [], tc = [], MID = GRASS.dark.clone().lerp(GRASS.base, 0.45);
    for (let k = 0; k < 7; k++) { const a0 = (k / 7) * 6.283, a1 = ((k + 1) / 7) * 6.283; tv.push(0, 0.12, 0, Math.cos(a1) * 0.15, 0, Math.sin(a1) * 0.15, Math.cos(a0) * 0.15, 0, Math.sin(a0) * 0.15); tc.push(MID, GRASS.dark, GRASS.dark); }
    blades(6, 0.2, tv, tc, GRASS.base, 0.1); blades(4, 0.15, tv, tc, GRASS.wash, 0.085);
    const fv = [], fc = []; blades(4, 0.2, fv, fc, GRASS.base);
    [[0.05, 0.22, 0.02, '#ec5f8f'], [-0.04, 0.18, 0.05, '#f6c83a'], [0.0, 0.25, -0.05, '#f598bd']].forEach(([x, y, z, h]) => { // flower heads: two crossed diamonds; rose, yellow, pink as fx.js PETAL (pale creams read white on the grass)
      const r = 0.03, cc = col(h);
      fv.push(x - r, y, z, x + r, y, z, x, y + r, z, x - r, y, z, x, y - r, z, x + r, y, z, x, y, z - r, x, y, z + r, x, y + r, z, x, y, z - r, x, y - r, z, x, y, z + r);
      fc.push(...Array(12).fill(cc));
    });
    const lv = [], lc = []; // ivy leaf cluster: small diamonds facing out
    for (let k = 0; k < 6; k++) {
      const o = [rr(-0.12, 0.12), rr(-0.25, 0.05), rr(-0.12, 0.12)], a = rr(0, 6.28), s = rr(0.06, 0.1), dx = Math.cos(a) * s, dz = Math.sin(a) * s, cc = rnd() < 0.5 ? GRASS.base : GRASS.dark.clone().lerp(GRASS.base, 0.3);
      lv.push(o[0] - dx, o[1], o[2] - dz, o[0] + dx, o[1], o[2] + dz, o[0], o[1] + s * 1.3, o[2], o[0] - dx, o[1], o[2] - dz, o[0], o[1] - s, o[2], o[0] + dx, o[1], o[2] + dz);
      lc.push(...Array(6).fill(cc));
    }
    const slab = chunk(0.5, 0, 0, 0); slab.scale(1, 0.35, 0.8);
    const SC = { scatter_tuft: tris(tv, tc), scatter_flower: tris(fv, fc), scatter_leaf: tris(lv, lc, false) };
    for (const [k, g] of Object.entries(SC)) world.add(mesh(k, g, scatterM));
    // weathered mid-grey stone with a moss-dark top (a pale top read as a white oval on the grass)
    world.add(mesh('scatter_slab', vcolor(nonIdx(slab), (v) => col(ROCK.l).lerp(col(ROCK.s), 0.45).lerp(GRASS.dark, v.y > 0.08 ? 0.55 : 0.1)), stoneM));
    const inst = { scatter_tuft: [], scatter_flower: [], scatter_leaf: [], scatter_slab: [] }, _q = new THREE.Quaternion(), _e = new THREE.Euler();
    const put = (key, x, y, z, s, tilt = 0.25) => inst[key].push([...[x, y, z].map((n) => +n.toFixed(3)), ..._q.setFromEuler(_e.set(rr(-tilt, tilt), rr(0, 6.28), rr(-tilt, tilt))).toArray().map((n) => +n.toFixed(4)), +s.toFixed(2)]);
    for (const s of play) {
      const n = Math.round(Math.PI * s.R * s.R * 3.4 * s.st.lush);
      for (let k = 0; k < n; k++) {
        const th = rr(0, 6.283), e = Math.sqrt(rnd()), x = s.x + Math.cos(th) * e * s.rim(th) * 0.97, z = s.z + Math.sin(th) * e * s.rim(th) * 0.97;
        if (vnoise(x * 0.3, 7.7, z * 0.3) < 0.05 - 0.8 * e * e || !clear(x, z)) continue; // clumps, denser toward the rim
        if (rnd() < s.st.flower) put('scatter_flower', x, s.y, z, rr(0.8, 1.3)); else put('scatter_tuft', x, s.y, z, rr(0.6, 1.4));
      }
      for (let k = 0; k < Math.round(s.R * 10); k++) { // undergrowth: a denser, more tilted band of tufts along the rim
        const th = rr(0, 6.283), e = rr(0.86, 0.98), x = s.x + Math.cos(th) * e * s.rim(th), z = s.z + Math.sin(th) * e * s.rim(th);
        if (clear(x, z)) put(rnd() < 0.12 ? 'scatter_flower' : 'scatter_tuft', x, s.y, z, rr(0.9, 1.6), 0.4);
      }
      for (let k = 0; k < Math.round(s.R * 0.5 * s.st.slabs); k++) { // half-sunk flat stones
        const th = rr(0, 6.283), e = rr(0.3, 0.85), x = s.x + Math.cos(th) * e * s.rim(th), z = s.z + Math.sin(th) * e * s.rim(th);
        if (clear(x, z)) put('scatter_slab', x, s.y - 0.09, z, rr(0.6, 1.3), 0.22); // tilted: one edge lifts out of the turf
      }
    }
    rocks.forEach((r) => r.ivy.forEach(([x, y, z]) => rnd() < 0.7 && put('scatter_leaf', x, y, z, rr(0.8, 1.5), 3)));
    return inst;
  }

  // Slab piece {name, x, z0, z1, w, top, rotY} (runs along Z): visual node in world, box node in collider.
  const pieceAt = {}; // piece name -> {x, z} (its middle), so beats between pieces can be placed on the route
  const addPiece = (world, p, thick, seedTop) => {
    pieceAt[p.name] = { x: p.x, z: (p.z0 + p.z1) / 2 };
    const node = new THREE.Group();
    node.name = p.name; node.position.set(p.x, p.top, (p.z0 + p.z1) / 2); node.rotation.y = p.rotY;
    node.add(mesh(`${p.name.slice(5)}__stone`, slabGeo(p, thick, seedTop), stoneM));
    world.add(node);
    return node;
  };
  const addPieceCollider = (collider, p, thick) => {
    const node = new THREE.Group();
    node.name = p.name; node.position.set(p.x, p.top, (p.z0 + p.z1) / 2); node.rotation.y = p.rotY;
    node.add(new THREE.Mesh(new THREE.BoxGeometry(p.w, thick, p.z1 - p.z0).translate(0, -thick / 2, 0)));
    collider.add(node);
  };
  // Breakable wall (level.js kind 'breakable'): stacked rough blocks, origin = bottom centre, spanning local x (w) and z (d).
  // World node + collider box share the mech_ name (addStatic skips it; level.js makes it a body). Returns the mechanism fields.
  const wall = (world, collider, { name, x, y, z, w, h, d, rotY = 0 }) => {
    const parts = [], rows = Math.round(h / 0.55), cols = Math.max(2, Math.round(w / 0.8)), bh = h / rows, bw = w / cols;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols + (r % 2); c++) { // running bond: odd rows offset half a block
      const x0 = Math.max(-w / 2, -w / 2 + (c - (r % 2) * 0.5) * bw), x1 = Math.min(w / 2, -w / 2 + (c + 1 - (r % 2) * 0.5) * bw);
      if (x1 - x0 < 0.1) continue;
      const g = new THREE.BoxGeometry((x1 - x0) * rr(0.9, 0.97), bh * rr(0.88, 0.96), d * rr(0.86, 1.0), 2, 2, 1), a = g.attributes.position;
      for (let i = 0; i < a.count; i++) a.setXYZ(i, a.getX(i) * rr(0.95, 1.05), a.getY(i) * rr(0.94, 1.04), a.getZ(i) * rr(0.92, 1.06));
      parts.push(nonIdx(g.translate((x0 + x1) / 2, (r + 0.5) * bh, rr(-0.04, 0.04))));
    }
    const node = new THREE.Group();
    node.name = name; node.position.set(x, y, z); node.rotation.y = rotY;
    node.add(mesh(`${name.slice(5)}__stone`, rockColors(mergeGeometries(parts), h, h * 1.6), stoneM));
    world.add(node);
    const cnode = new THREE.Group();
    cnode.name = name; cnode.position.set(x, y, z); cnode.rotation.y = rotY;
    cnode.add(new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0)));
    collider.add(cnode);
    return { node: name, pos: r2v([x, y, z]), size: r2v([w, h, d]), rotY: +rotY.toFixed(4) };
  };
  // Tower: islands climbing `rise` m per step from `base`, each overhanging the one below along an axis direction (deg 0 = +Z,
  // 90 = +X, 180 = -Z, 270 = -X); an updraft box against each upper island's wall lifts you over its rim (l2 updraft rule:
  // exit feet = box top - 0.5 clear the rim). Returns [{lo, hi, box, near, deg}] (near = upper rim point toward the lower island).
  const tower = (prefix, base, steps) => steps.map(({ deg, rise, R, cycle }, i, all) => {
    const lo = i ? isl[`${prefix}${i}`] : base, ux = Math.round(Math.sin(deg * D2R)), uz = Math.round(Math.cos(deg * D2R));
    const hi = island(`${prefix}${i + 1}`, 0, 0, lo.y + rise, R, { wallDown: rise + 0.8, depth: Math.max(rise + 1, R * 1.3) });
    const dist = lo.R * 0.38 + R;
    hi.x = lo.x + ux * dist; hi.z = lo.z + uz * dist; isl[hi.id] = hi;
    const nr = rimToward(hi, lo), near = [hi.x - ux * nr, hi.z - uz * nr], a0 = -1.8, a1 = -0.05; // along u from the near rim
    const lim = (k, c) => [Math.min(c + k * a0, c + k * a1), Math.max(c + k * a0, c + k * a1)];
    const [x0, x1] = ux ? lim(ux, near[0]) : [near[0] - 1.6, near[0] + 1.6], [z0, z1] = uz ? lim(uz, near[1]) : [near[1] - 1.6, near[1] + 1.6];
    if (Math.hypot(near[0] - ux * 1.8 - lo.x, near[1] - uz * 1.8 - lo.z) > lo.rim(Math.atan2(near[1] - lo.z, near[0] - lo.x)) - 0.3) throw new Error(`tower ${hi.id}: updraft foot off ${lo.id}`);
    return { lo, hi, deg, near, cycle, box: { min: [x0, lo.y - 0.5, z0], max: [x1, hi.y + 0.8, z1] } };
  });
  // Crumble pads / lift pads etc. are plain pieces with a mech_ name (addPiece + addPieceCollider); this adds both.
  // static slabs merged into one mesh (one draw), each its own collider box; own stream: the layout keeps its draws
  const slabMesh = (world, collider, name, list, thick, seed0) => own(seed0, () => {
    world.add(mesh(name, mergeGeometries(list.map((p, i) => slabGeo(p, thick, seed0 + i).rotateY(p.rotY).translate(p.x, p.top, (p.z0 + p.z1) / 2))), stoneM));
    for (const p of list) addPieceCollider(collider, p, thick);
  });
  const pieces = (world, collider, list, thick, seed0) => list.forEach((p, i) => { addPiece(world, p, thick, seed0 + i); addPieceCollider(collider, p, thick); });
  const markers = (world, spawn, goal) => {
    for (const n of ['spawn', 'goal']) world.add(Object.assign(new THREE.Object3D(), { name: n }));
    world.getObjectByName('spawn').position.fromArray(spawn);
    world.getObjectByName('goal').position.fromArray(goal);
  };

  // ---------- collider.glb ----------
  // Flat island tops + vertical rim walls (so jumps into a side slide off, never clip in), prop boxes.
  function topAndWall(s, N = 48) {
    const top = [], wall = [];
    for (let i = 0; i < N; i++) {
      const t0 = (i / N) * Math.PI * 2, t1 = ((i + 1) / N) * Math.PI * 2;
      const a = [s.x + Math.cos(t0) * s.rim(t0), s.z + Math.sin(t0) * s.rim(t0)], b = [s.x + Math.cos(t1) * s.rim(t1), s.z + Math.sin(t1) * s.rim(t1)];
      top.push(s.x, s.y, s.z, b[0], s.y, b[1], a[0], s.y, a[1]); // CCW from above -> normal +Y
      const lo = s.y - s.wallDown;
      wall.push(a[0], s.y, a[1], b[0], s.y, b[1], b[0], lo, b[1], a[0], s.y, a[1], b[0], lo, b[1], a[0], lo, a[1]);
    }
    const mk = (arr) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); return g; };
    return [mk(top), mk(wall)];
  }
  function colliderBase(play, props, decor = []) {
    const collider = new THREE.Scene();
    const tw2 = play.map((s) => topAndWall(s));
    const box = (p, [w, h, d, ox = 0, oz = 0, oy = 0], k = p.scale ?? 1) => new THREE.BoxGeometry(w * k, h * k, d * k).translate(ox * k, (h * k) / 2 + oy * k, oz * k).rotateY(p.rotY).translate(...p.pos).deleteAttribute('uv').deleteAttribute('normal');
    const propBoxes = [...props.map((p) => box(p, PROP_BOX[p.mesh ? `${p.glb}#${p.mesh}` : p.glb])), ...decor.filter((p) => (p.scale ?? 1) >= (DECOR[p.var ?? p.glb].minScale ?? 0)).flatMap((p) => (p.boxes ?? DECOR[p.var ?? p.glb].boxes).map((b) => box(p, b)))];
    collider.add(mesh('walk_surface', mergeGeometries(tw2.map((t) => t[0])), undefined));
    collider.add(mesh('wall_islands', mergeGeometries(tw2.map((t) => t[1])), undefined));
    collider.add(mesh('wall_props', mergeGeometries(propBoxes), undefined));
    return collider;
  }

  // ---------- feasibility ----------
  const reach = (rise) => +jumpReach(rise).toFixed(2);
  const gaps = [], steps = [], blocked = [], windGaps = [], dashGaps = [];
  const gap = (from, to, dist, rise) => {
    dist = +dist.toFixed(2); rise = +rise.toFixed(2);
    const frac = +(dist / jumpReach(rise)).toFixed(2);
    if (!(frac <= MAX_FRAC)) throw new Error(`gap ${from}->${to} ${dist} m exceeds ${MAX_FRAC} x reach ${reach(rise)}`);
    gaps.push({ from, to, dist, rise, reach: reach(rise), frac, inAim: frac >= AIM[0] && frac <= AIM[1] });
  };
  const step = (from, to, rise, overlap) => {
    rise = +rise.toFixed(3);
    if (rise > TUNING.stepUp || -rise > TUNING.stepDown || overlap < 0) throw new Error(`step ${from}->${to} rise ${rise} overlap ${overlap} not walkable`);
    steps.push({ from, to, rise, overlap: +overlap.toFixed(2) });
  };
  const gapChain = (pairs) => pairs.forEach(([a, b]) => gap(a, b, rimGap(isl[a], isl[b]), isl[b].y - isl[a].y));
  // Wind-assisted gap: a tailwind `w` m/s along the jump adds w * airtime to the reach (wind is a position push, not
  // stored velocity, so air control cannot eat it). Must be impossible without wind and within MAX_FRAC with it.
  const windGap = (from, to, dist, rise, w, needs) => {
    dist = +dist.toFixed(2); rise = +rise.toFixed(2);
    const still = jumpReach(rise), withW = jumpReach(rise, TUNING, TUNING.run + w), frac = +(dist / withW).toFixed(2);
    if (dist <= still) throw new Error(`wind gap ${from}->${to} ${dist} m is jumpable without wind (reach ${still.toFixed(2)})`);
    if (!(frac <= MAX_FRAC)) throw new Error(`wind gap ${from}->${to} ${dist} m exceeds ${MAX_FRAC} x wind reach ${withW.toFixed(2)}`);
    windGaps.push({ from, to, dist, rise, wind: w, reachStill: reach(rise), reachWind: +withW.toFixed(2), frac, margin: +(MAX_FRAC * withW - dist).toFixed(2), needs });
  };

  // Dash gap (jump + one air dash; charges 2: two, beyond one): must be beyond the reach with one charge less, and within MAX_FRAC x its reach. Only for optional routes and
  // time saves, and only where the bot has a do:'dash' action (bot.js).
  // Updraft + air dashes: the flight is simulated by the generator; reachWith / reachLess = the distance flown with `charges` /
  // one charge less (m past the take-off line of `dist`).
  const updraftDash = (from, to, dist, reachWith, reachLess, charges = 2) => {
    dist = +dist.toFixed(2);
    const frac = +(dist / reachWith).toFixed(2);
    if (dist <= reachLess) throw new Error(`updraft gap ${from}->${to} ${dist} m is crossable with ${charges - 1} dash(es) (reach ${reachLess.toFixed(2)})`);
    if (!(frac <= MAX_FRAC)) throw new Error(`updraft gap ${from}->${to} ${dist} m exceeds ${MAX_FRAC} x reach ${reachWith.toFixed(2)}`);
    dashGaps.push({ from, to, dist, updraft: true, reachDash: +reachWith.toFixed(2), frac, margin: +(MAX_FRAC * reachWith - dist).toFixed(2), charges });
  };
  const dashGap = (from, to, dist, rise, charges = 1) => { // charges 2 = two air dashes in one airtime (gift.airdash)
    dist = +dist.toFixed(2); rise = +rise.toFixed(2);
    const still = charges > 1 ? dashReach(rise) : jumpReach(rise), withD = charges > 1 ? dash2Reach(rise) : dashReach(rise), frac = +(dist / withD).toFixed(2);
    if (dist <= still) throw new Error(`dash gap ${from}->${to} ${dist} m is crossable with ${charges - 1} dash(es) (reach ${still.toFixed(2)})`);
    if (!(frac <= MAX_FRAC)) throw new Error(`dash gap ${from}->${to} ${dist} m exceeds ${MAX_FRAC} x dash reach ${withD.toFixed(2)}`);
    dashGaps.push({ from, to, dist, rise, reachJump: reach(rise), reachDash: +withD.toFixed(2), frac, margin: +(MAX_FRAC * withD - dist).toFixed(2), ...(charges > 1 ? { charges } : {}) });
  };

  // Breath budget (player.js TUNING.breath): walk level.route from the spawn at full breath. The max at each route point is
  // breath.max + 1 per gift held there (startGifts from the spawn, the others from their route point; a gift fills the breath;
  // echoes are not counted). A plain checkpoint refills nothing and respawn restores the breath it was reached with, so the walk
  // sets breath 0 there (worst arrival: no softlock). A refill point (wind cairn: checkpoint {wind: true}, any gift; after gift.windbreath also a wind box or within breath.near of a
  // rune/totem) fills it; between route points the bot jogs, so breath regens at breath.regen per s of jog time until gift.dash, then not at all. Each jump gap costs its sprint run-up (BOT_RUNUP m at run
  // speed x the run drain, floored at 0: an empty hero still runs), a dash gap needs one whole dash left after that run-up. Beats sit at
  // the route point nearest the middle of their two ends (islands or slab pieces). A two-charge dash gap costs two dashes.
  // A dash beat short of breath throws. R2 songs: each level.actions {do:'song'} costs breath.song at the route point nearest its spot
  // (walked once per bot profile: actions without `profiles` are required, the others count for their profiles); a song short of
  // breath throws (it would fizzle). A Name song within breath.nearFar of a far rune fills it (after gift.windbreath). giftOrder: a song action before its gift throws.
  // Gifts (npc.js): level.startGifts are held from the spawn; level.gifts = [{id, at}] are given at the route point nearest `at`.
  const BOT_RUNUP = 2.5; // m, = bot.js RUNUP
  const routeIdx = (route, x, z) => route.reduce((bi, p, i) => (Math.hypot(p[0] - x, p[2] - z) < Math.hypot(route[bi][0] - x, route[bi][2] - z) ? i : bi), 0);
  const giftIdx = (level, id) => { const g = level.gifts?.find((x) => x.id === id); return level.startGifts?.includes(id) ? -1 : g ? routeIdx(level.route, g.at[0], g.at[2]) : Infinity; };
  function breathBudget(level) {
    const B = TUNING.breath, runUp = (BOT_RUNUP / TUNING.run) * B.run, route = level.route ?? [], mech = level.mechanisms ?? [], wb = giftIdx(level, 'windbreath'), di = giftIdx(level, 'dash');
    const gi = ['dash', 'windbreath', 'airdash'].map((id) => giftIdx(level, id)), maxAt = (i) => Math.min(B.cap, B.max + gi.filter((g) => g <= i).length);
    const inCp = ([x, y, z], wind) => (level.checkpoints ?? []).find((c) => !!c.wind === wind && Math.hypot(x - c.pos[0], y - c.pos[1], z - c.pos[2]) <= c.r);
    let lastCp = null; // the plain checkpoint the walk last passed (named in the error: make it a wind cairn)
    const refill = ([x, y, z], i) => inCp([x, y, z], true) || i >= wb &&
      mech.some((m) => (m.kind === 'wind' && [x, y + 0.5, z].every((v, i) => v >= m.area.min[i] && v <= m.area.max[i])) ||
        (m.kind === 'switch' && m.pos && Math.hypot(x - m.pos[0], z - m.pos[2]) <= B.near && Math.abs(y - m.pos[1]) <= 2));
    const end = (n) => isl[n] ?? pieceAt[n], near = (a, b) => routeIdx(route, (end(a).x + end(b).x) / 2, (end(a).z + end(b).z) / 2); // route index nearest the gap's middle
    const beats = route.map(() => []);
    // U19: a song-shrine's detour is walked out and back, the walk below counts its dash once: the breath must be full where the
    // detour leaves the route. ponytail: one of the 3 route points before it is a refill; walk both legs if a detour ever needs more
    for (const g of level.gifts ?? []) if (g.via) {
      const on = (q) => g.via.some((n) => isl[n] && Math.hypot(q[0] - isl[n].x, q[2] - isl[n].z) < isl[n].R + 1), f = route.findIndex(on);
      if (f < 0 || ![1, 2, 3].some((k) => f - k >= 0 && (inCp(route[f - k], true) || refill(route[f - k], f - k)))) throw new Error(`breath: the detour to ${g.shrine} leaves the route with no refill just before it (route[${f}])`);
    }
    const yOf = (n) => isl[n]?.y ?? null, visited = (n) => !isl[n] || route.some(([x, y, z]) => Math.abs(y - isl[n].y) < 1 && Math.hypot(x - isl[n].x, z - isl[n].z) < isl[n].R);
    const onRoute = (a, b, i) => { // gaps of side paths (a safety island's climb back) are not on the route: both ends level with it and walked by it
      const ys = [yOf(a), yOf(b)].filter((y) => y !== null);
      return (!ys.length || Math.abs(ys.reduce((s, y) => s + y, 0) / ys.length - route[i][1]) < 2.5) && visited(a) && visited(b);
    };
    for (const [list, dash] of [[gaps, false], [dashGaps, true]]) for (const g of list) if (end(g.from) && end(g.to) && route.length) { const i = near(g.from, g.to); if (dash || onRoute(g.from, g.to, i)) beats[i].push({ dash, n: g.charges ?? 1, id: `${g.from}->${g.to}` }); }
    const songsOf = (pr) => (level.actions ?? []).filter((a) => a.do === 'song' && (!a.profiles || a.profiles.includes(pr))).map((a) => ({ i: routeIdx(route, a.at[0], a.at[1]), id: `song ${a.song}`, song: a.song }));
    for (const pr of ['mid', 'best', 'worst']) {
    const songAt = route.map(() => []);
    for (const sg of songsOf(pr)) songAt[sg.i].push(sg);
    let b = maxAt(0), low = Infinity, lowAt = null; lastCp = null;
    const maxes = [];
    route.forEach((p, i) => {
      const max = maxAt(i);
      if (i > 0) b = Math.min(max, b + (i < di ? B.regen * Math.hypot(p[0] - route[i - 1][0], p[2] - route[i - 1][2]) / TUNING.jog : 0));
      if (i > 0 && inCp(p, false)) { b = 0; lastCp = inCp(p, false).id; } // a plain checkpoint keeps the breath you came with (player.js snapshot): assume none, so no softlock
      if (i === 0 || refill(p, i) || max > maxAt(i - 1)) b = max; // a gift / wind cairn fills it
      if (maxes.at(-1)?.[1] !== max) maxes.push([i, max]);
      for (const bt of beats[i]) {
        b = Math.max(0, b - runUp);
        if (!bt.dash) continue;
        if (b < B.dash * bt.n) throw new Error(`breath: dash ${bt.id} at route[${i}] has ${b.toFixed(2)} < ${B.dash * bt.n} segments (max ${max}): put a wind, rune or wind cairn ({wind: true} checkpoint) before it (after plain ${lastCp})`);
        if (b < low) { low = b; lowAt = bt.id; }
        b -= B.dash * bt.n;
      }
      for (const sg of songAt[i]) {
        if (b < B.song) throw new Error(`breath (${pr}): ${sg.id} at route[${i}] has ${b.toFixed(2)} < ${B.song} segments (max ${max}): it would fizzle (after plain ${lastCp})`);
        if (b < low) { low = b; lowAt = sg.id; }
        b -= B.song;
        if (sg.song === 'name' && i >= wb && mech.some((m) => m.far && Math.hypot(p[0] - m.pos[0], p[2] - m.pos[2]) <= B.nearFar)) b = max; // a far rune woken from here fills it
      }
    });
    console.log(`breath ${pr}: max by route index ${maxes.map(([i, m]) => `[${i}]=${m}`).join(' ')}; lowest before a dash/song ${low === Infinity ? '-' : `${low.toFixed(2)} (${lowAt})`}; songs ${songsOf(pr).length}`);
    }
  }

  // Route checks: every waypoint on an island (or on a slab piece), every segment 1.1 m clear of every prop.
  function checkRoute(route, pieces, props, extraOk = () => false) {
    for (const [x, , z] of route) if (!Object.values(isl).some((a) => Math.hypot(x - a.x, z - a.z) < a.rim(Math.atan2(z - a.z, x - a.x)) - 1) && !pieces.some((b) => Math.abs(x - b.x) < 1.2 && z > b.z0 - 0.5 && z < b.z1 + 0.5) && !extraOk(x, z))
      throw new Error(`route point ${x.toFixed(1)},${z.toFixed(1)} is off every island`);
    for (let i = 1; i < route.length; i++) for (const pr of props) {
      const [ax, , az] = route[i - 1], [bx, , bz] = route[i], vx = bx - ax, vz = bz - az;
      const u = THREE.MathUtils.clamp(((pr.pos[0] - ax) * vx + (pr.pos[2] - az) * vz) / (vx * vx + vz * vz), 0, 1);
      if (Math.hypot(ax + vx * u - pr.pos[0], az + vz * u - pr.pos[2]) < 1.1) throw new Error(`route segment ${i} passes through ${pr.id}`);
    }
  }

  // Decor placement on its own seeded stream (the main stream would shift the whole layout). An entry may carry `tilt` (radians
  // about its own z, after rotY: a toppled piece) and its own collision `boxes`. spec items:
  // { on: island, glb, n, s: [min, max] scale, at?: [x, z] fixed spot, yaw?: (x, z, rd) => rotY }. A spot must sit inside
  // the rim, keep r + 1.1 m off every route segment (route = run lines and jump arcs), clear every prop/decor, and pass keep(x, z, r).
  // Fixed spots that fail throw; random ones retry (up to 300 tries per item).
  function decorate(spec, { route, props, keep = () => true }) {
    const rd = mulberry32(seed * 31 + 7), out = [], foot = (p) => (DECOR[p.var ?? p.glb]?.r ?? 0.5) * (p.scale ?? 1);
    const segD = (x, z) => Math.min(...route.slice(1).map((b, i) => {
      const a = route[i], vx = b[0] - a[0], vz = b[2] - a[2], u = THREE.MathUtils.clamp(((x - a[0]) * vx + (z - a[2]) * vz) / (vx * vx + vz * vz || 1), 0, 1);
      return Math.hypot(a[0] + vx * u - x, a[2] + vz * u - z);
    }));
    for (const sp of spec) for (let k = 0, tries = 0; k < (sp.n ?? 1) && tries < 300; tries++) {
      const sc = sp.s ? sp.s[0] + (sp.s[1] - sp.s[0]) * rd() : 1, isl0 = sp.on;
      const r = DECOR[sp.glb].r * sc;
      let x, z;
      if (sp.at) [x, z] = sp.at;
      else { const th = rd() * 6.283, e = 0.25 + 0.75 * Math.sqrt(rd()), R = isl0.rim(th) - r - 0.35; if (R <= 0.3) continue; x = isl0.x + Math.cos(th) * e * R; z = isl0.z + Math.sin(th) * e * R; }
      const v = VARIANT[sp.glb] ? Math.floor(mulberry32((seed * 977 + Math.round(x * 10) * 7919 + Math.round(z * 10) * 104729) >>> 0)() * 3) : 0; // own hash: rd's draws stay put
      const glb = v ? `${V2}${VARIANT[sp.glb]}_${'bc'[v - 1]}.glb` : sp.glb; // spacing keeps the base r: the layout does not move
      const ok = Math.hypot(x - isl0.x, z - isl0.z) < isl0.rim(Math.atan2(z - isl0.z, x - isl0.x)) - r - 0.3 && segD(x, z) >= r + 1.1 &&
        [...props, ...out].every((p) => Math.hypot(x - p.pos[0], z - p.pos[2]) >= r + foot(p) + 0.4) && keep(x, z, r);
      if (!ok) { if (sp.at) throw new Error(`decor ${sp.glb} at ${sp.at} is blocked`); continue; }
      out.push({ id: `decor_${out.length}`, glb: sp.glb, ...(v ? { var: glb } : {}), pos: [x, isl0.y - 0.03, z], rotY: sp.rotY ?? (sp.yaw ? sp.yaw(x, z, rd) : sp.glb === STAIRS ? Math.atan2(z - isl0.z, isl0.x - x) + (rd() - 0.5) * 0.4 : rd() * 6.283), scale: sc });
      k++;
    }
    return out;
  }
  // Far sky castles: camera-facing sprites well behind the distant ring (level.json `sky`, drawn by systems/level.js).
  function skyCastles(CEN, list) {
    return list.map(([tex, deg, dist, y, w]) => ({ tex, pos: r2v([CEN.x + Math.sin(deg * D2R) * dist, y, CEN.z + Math.cos(deg * D2R) * dist]), w }));
  }

  // Gift order: every required dash gap sits at or after the gift.dash point along level.route (two-charge gaps: gift.airdash).
  function giftOrder(level) {
    const route = level.route ?? [], dash = giftIdx(level, 'dash'), air = giftIdx(level, 'airdash');
    for (const g of dashGaps) {
      const a = isl[g.from] ?? pieceAt[g.from], b = isl[g.to] ?? pieceAt[g.to], need = g.charges > 1 ? air : dash;
      const p = a && b ? routeIdx(route, (a.x + b.x) / 2, (a.z + b.z) / 2) : null;
      if (p === null) throw new Error(`gift order: dash gap ${g.from}->${g.to} has no known ends`);
      if (route.length && p < need) throw new Error(`gift order: dash gap ${g.from}->${g.to} (route[${p}]) comes before gift.${g.charges > 1 ? 'airdash' : 'dash'} (route[${need}])`);
    }
    // U18 one gift per moment: an NPC gives only a movement gift; a song comes from its song-shrine (a switch with gift: <song>), and
    // level.gifts names that shrine and stands at it (so giftIdx is the shrine's route point)
    for (const n of level.npcs ?? []) for (const t of n.talk ?? []) for (const f of t.set ?? []) if (/^gift\.(gust|name|anchor)$/.test(f)) throw new Error(`gift order: npc ${n.id} talk ${t.id} gives ${f} (songs come from song-shrines)`);
    for (const n of level.npcs ?? []) for (const t of n.talk ?? []) if ((t.set ?? []).filter((f) => f.startsWith('gift.')).length > 1) throw new Error(`gift order: npc ${n.id} talk ${t.id} gives more than one gift`);
    const shrines = (level.mechanisms ?? []).filter((m) => m.kind === 'switch' && m.gift);
    for (const g of level.gifts ?? []) if (['gust', 'name', 'anchor'].includes(g.id)) {
      const m = shrines.find((k) => k.id === g.shrine);
      if (!m || m.gift !== g.id) throw new Error(`gift order: song ${g.id} has no song-shrine switch '${g.shrine}' with gift '${g.id}'`);
      if (Math.hypot(g.at[0] - m.pos[0], g.at[2] - m.pos[2]) > 2.5) throw new Error(`gift order: song ${g.id} given ${Math.hypot(g.at[0] - m.pos[0], g.at[2] - m.pos[2]).toFixed(1)} m from its shrine`);
    }
    for (const g of level.gifts ?? []) if (g.shrine) { // U19 (R7): a song-shrine stands off the route, on side islands `via`: 15-40 m from every other route point, or 4+ m above / below the nearest
      const m = shrines.find((k) => k.id === g.shrine), on = (q) => (g.via ?? []).some((id) => isl[id] && Math.hypot(q[0] - isl[id].x, q[2] - isl[id].z) < isl[id].R + 1);
      const rest = route.filter((q) => !on(q)), near = rest.reduce((b, q) => (Math.hypot(q[0] - m.pos[0], q[2] - m.pos[2]) < Math.hypot(b[0] - m.pos[0], b[2] - m.pos[2]) ? q : b), rest[0]), d = Math.hypot(near[0] - m.pos[0], near[2] - m.pos[2]);
      if (!g.via?.length || !((d >= 15 && d <= 40) || (Math.abs(near[1] - m.pos[1]) >= 4 && d <= 40))) throw new Error(`gift order: song-shrine ${m.id} is ${d.toFixed(1)} m from the route (${(m.pos[1] - near[1]).toFixed(1)} m up): wants 15-40 m off it or 4+ m above / below, on side islands (gifts[].via)`);
      g.off = +d.toFixed(1);
    }
    for (const m of shrines) if (!(level.gifts ?? []).some((g) => g.shrine === m.id)) throw new Error(`gift order: song-shrine ${m.id} is not in level.gifts`);
    for (const m of shrines) if (!(level.props ?? []).some((p) => p.id === m.node)) throw new Error(`gift order: song-shrine ${m.id} stone '${m.node}' is not a named prop (marks.js carves its relief on it)`);
    for (const a of level.actions ?? []) if (a.do === 'song' && !(a.profiles?.length === 1 && a.profiles[0] === 'revisit')) { // R6 revisit: gifts from the save
      const p = routeIdx(route, a.at[0], a.at[1]), need = giftIdx(level, a.song);
      if (!['gust', 'name', 'anchor'].includes(a.song)) throw new Error(`gift order: unknown song '${a.song}'`);
      if (p < need) throw new Error(`gift order: song ${a.song} at route[${p}] comes ${need === Infinity ? 'with no gift in the level' : `before gift.${a.song} (route[${need}])`}`);
    }
    for (const e of level.enemies ?? []) if (e.guard) { // U23: a rune guard falls like any Warden (stagger, then the Name), so the Name is held before it; its rune waits on the unbinding
      const p = routeIdx(route, e.pos[0], e.pos[2]), need = giftIdx(level, 'name'), m = (level.mechanisms ?? []).find((x) => x.id === e.guard);
      if (p < need) throw new Error(`gift order: rune guard ${e.id} (route[${p}]) stands before gift.name (${need === Infinity ? 'not in the level' : `route[${need}]`})`);
      if (m?.after !== `enemy.${e.id}.open`) throw new Error(`gift order: rune ${e.guard} of guard ${e.id} wants after 'enemy.${e.id}.open'`);
    }
  }

  // R7: a hidden switch sits >= 12 m from its obstacle (vein[0]: the target end of the Gust dust path, else the target's spot);
  // checkpoints (and the spawn) stay <= 20 s of route apart at run speed, detours included (waits and rides not counted).
  const obstacleOf = (level, m) => { const t = (level.mechanisms ?? []).find((k) => k.id === m.targets?.[0] || (m.seq && k.seq === m.seq && k.targets?.length)); return m.vein?.[0] ?? t?.vein?.[0] ?? t?.pos ?? t?.path?.[0] ?? null; };
  function hiddenSwitches(level) {
    for (const m of level.mechanisms ?? []) if (m.kind === 'switch' && m.hidden) {
      const o = obstacleOf(level, m), d = o && Math.hypot(o[0] - m.pos[0], o[2] - m.pos[2]);
      if (!o) throw new Error(`hidden switch ${m.id}: no obstacle to pair with`);
      if (d < 12) throw new Error(`hidden switch ${m.id}: ${d.toFixed(1)} m from its target (< 12)`);
    }
    const cps = level.checkpoints ?? [], route = level.route ?? [];
    let run = 0, worst = 0;
    route.forEach((p, i) => {
      if (i) run += Math.hypot(p[0] - route[i - 1][0], p[1] - route[i - 1][1], p[2] - route[i - 1][2]);
      const q = route[Math.max(0, i - 1)], segHit = (c) => { // closest point of the leg q -> p to the checkpoint
        const v = [0, 1, 2].map((j) => p[j] - q[j]), u = THREE.MathUtils.clamp([0, 1, 2].reduce((a, j) => a + (c.pos[j] - q[j]) * v[j], 0) / (v.reduce((a, x) => a + x * x, 0) || 1), 0, 1);
        return Math.hypot(...[0, 1, 2].map((j) => q[j] + v[j] * u - c.pos[j])) <= c.r + 0.5;
      };
      if (cps.some(segHit) || i === route.length - 1) {
        if (run / TUNING.run > 20) throw new Error(`checkpoints: ${(run / TUNING.run).toFixed(1)} s of route before route[${i}] (> 20)`);
        worst = Math.max(worst, run / TUNING.run); run = 0;
      }
    });
    console.log(`R7: ${(level.mechanisms ?? []).filter((m) => m.hidden).length} hidden switches; longest checkpoint leg ${worst.toFixed(1)} s`);
  }

  // R3: no enemy on a required beat before its counter song's gift (squall: Gust; warden / boss: Name, which unbinds them).
  function enemyOrder(level) {
    const route = level.route ?? [], counter = { squall: 'gust', warden: 'name', boss: 'name' };
    for (const e of level.enemies ?? []) {
      const need = counter[e.kind], p = routeIdx(route, e.pos[0], e.pos[2]), g = giftIdx(level, need);
      if (!need) throw new Error(`enemy ${e.id}: unknown kind '${e.kind}'`);
      if (p < g) throw new Error(`enemy order: ${e.kind} ${e.id} at route[${p}] comes ${g === Infinity ? 'with no' : 'before'} gift.${need}${g === Infinity ? '' : ` (route[${g}])`}`);
    }
    if (level.enemies?.length) console.log(`R3: ${level.enemies.length} enemies after their counter gifts`);
  }

  // R3 motif pairs (no veins): each switch with targets (a seq set counts once) shares one carved mark with its obstacle (marks.js);
  // marks are unique per level. A hidden switch must not be in plain sight from its obstacle: the eye line (1.6 m up) to it is
  // blocked by rock, or it is past the 28 m the play camera's haze reads at. A seq set counts by its first rune (order 1): the
  // later ones sit on the way back by design (sung first they only dim the set).
  const MARKS = ['bird', 'eye', 'wave', 'spiral', 'star', 'moon', 'leaf', 'fish'];
  function motifPairs(level, collider) {
    const sws = (level.mechanisms ?? []).filter((m) => m.kind === 'switch' && (m.targets?.length || m.seq)), key = (m) => (m.seq ? `seq:${m.seq}` : m.id), byKey = {};
    for (const m of sws) if (m.mark) byKey[key(m)] ??= m.mark;
    let i = 0;
    for (const m of sws) { if (!byKey[key(m)]) { while (Object.values(byKey).includes(MARKS[i])) i++; byKey[key(m)] = MARKS[i]; } m.mark = byKey[key(m)]; }
    const seen = {};
    for (const [k, mk] of Object.entries(byKey)) { if (!MARKS.includes(mk)) throw new Error(`motif pair ${k}: unknown mark '${mk}'`); if (seen[mk]) throw new Error(`motif pair: ${k} and ${seen[mk]} share '${mk}'`); seen[mk] = k; }
    collider.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(), a = new THREE.Vector3(), b = new THREE.Vector3(), out = [];
    for (const m of sws.filter((x) => x.hidden && !(x.seq && x.order > 1))) {
      const o = obstacleOf(level, m);
      a.set(o[0], o[1] + 1.6, o[2]); b.set(m.pos[0], m.pos[1] + 1.0, m.pos[2]);
      const L = a.distanceTo(b); ray.set(a, b.clone().sub(a).normalize()); ray.far = L - 0.8;
      const blocked = ray.intersectObject(collider, true).some((h) => h.distance > 0.8);
      if (!blocked && L < 28) throw new Error(`hidden switch ${m.id}: in plain sight from its obstacle (${L.toFixed(1)} m, eye line clear)`);
      out.push(`${m.id} ${L.toFixed(0)} m ${blocked ? 'occluded' : 'hazed'}`);
    }
    console.log(`R3 marks: ${Object.entries(byKey).map(([k, v]) => `${k}=${v}`).join(' ')}; hidden: ${out.join(', ')}`);
  }

  // cutscene walks stay clear of props and decor: each walking segment (clip walk/run) of every hero.path, sampled every 0.25 m
  // against footprints (decor r x scale, prop box half-diagonal) + the hero's 0.3 m; a hit throws (route the path round it)
  function cutPaths(level, decor) {
    const foot = [...(level.props ?? []).map((p) => { const b = PROP_BOX[p.mesh ? `${p.glb}#${p.mesh}` : p.glb] ?? [0.6, 0, 0.6]; return { id: p.id, pos: p.pos, r: (Math.hypot(b[0], b[2]) / 2) * (p.scale ?? 1) }; }),
      ...decor.map((d) => ({ id: `${(d.var ?? d.glb).split('/').pop()}@${d.pos.map((n) => n.toFixed(1))}`, pos: d.pos, r: (DECOR[d.var ?? d.glb]?.r ?? 0.5) * (d.scale ?? 1) }))];
    for (const [name, sc] of Object.entries(level.cutscenes ?? {})) {
      const path = sc.hero?.path ?? [];
      for (let i = 0; i + 1 < path.length; i++) {
        if (!/walk|run/.test(path[i].clip ?? '')) continue;
        const a = path[i].pos, b = path[i + 1].pos, n = Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / 0.25);
        for (let k = 0; k <= n; k++) {
          const x = a[0] + ((b[0] - a[0]) * k) / n, y = a[1] + ((b[1] - a[1]) * k) / n, z = a[2] + ((b[2] - a[2]) * k) / n;
          const hit = foot.find((f) => Math.abs(f.pos[1] - y) < 2.5 && Math.hypot(f.pos[0] - x, f.pos[2] - z) < f.r + 0.3);
          if (hit) throw new Error(`cutscene ${name}: hero.path segment ${i} walks through ${hit.id} at ${x.toFixed(1)},${z.toFixed(1)}`);
        }
      }
    }
  }

  // U21: no spawn point (the spawn, every checkpoint) inside a solid in any state: prop and decor boxes, and a dusty rune's gust boulder
  // (level.js: 1.5 x 1.1 m, 0.8 m before the carved face; blown aside it rests 1.1 m to either side). The hero is a 0.3 m capsule.
  function spawnClear(level, decor) {
    const rects = [];
    const add = (id, [x, , z], rotY, [w, , d, ox = 0, oz = 0], k = 1) => { const c = Math.cos(rotY), sn = Math.sin(rotY); rects.push({ id, x: x + (ox * c + oz * sn) * k, z: z + (-ox * sn + oz * c) * k, c, sn, hw: w * k / 2, hd: d * k / 2 }); };
    for (const p of level.props ?? []) { const b = PROP_BOX[p.mesh ? `${p.glb}#${p.mesh}` : p.glb]; if (b) add(p.id, p.pos, p.rotY, b, p.scale ?? 1); }
    for (const p of decor) if (!p.far && (p.scale ?? 1) >= (DECOR[p.var ?? p.glb]?.minScale ?? 0)) for (const b of p.boxes ?? DECOR[p.var ?? p.glb]?.boxes ?? []) if (b[1] + (b[5] ?? 0) > TUNING.stepUp / (p.scale ?? 1)) add(p.id, p.pos, p.rotY, b, p.scale ?? 1);
    for (const m of level.mechanisms ?? []) if (m.dust) { const r = (level.props ?? []).find((p) => p.id === m.node)?.rotY ?? 0; for (const [ox, oz] of [[0, 0.8], [1.1, 0.2], [-1.1, 0.2]]) add(`${m.id} boulder`, m.pos, r, [1.5, 0, 1.1, ox, oz]); }
    for (const c of [{ id: 'spawn', pos: level.spawn.pos }, ...(level.checkpoints ?? [])]) for (const q of rects) {
      const dx = c.pos[0] - q.x, dz = c.pos[2] - q.z, lx = Math.abs(dx * q.c - dz * q.sn) - q.hw, lz = Math.abs(dx * q.sn + dz * q.c) - q.hd;
      if (Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) < 0.45) throw new Error(`spawn point ${c.id} stands in ${q.id} (move the checkpoint: a respawn there is walled in)`);
    }
  }
  async function write({ world, collider, inst, level, decor = [] }) {
    cutPaths(level, decor);
    spawnClear(level, decor);
    for (const d of decor) if (!d.far && INTERACTIVE.includes(d.glb)) throw new Error(`decor ${d.id} uses interactive ${d.glb}: decor takes MENHIR/STUMP/KNOT/...`);
    const sw = new Set([...(level.mechanisms ?? []).filter((m) => m.kind === 'switch').map((m) => m.node ?? m.id), ...(level.npcs ?? []).flatMap((n) => n.switches ?? [])]);
    for (const p of level.props ?? []) if (INTERACTIVE.includes(p.glb) && !sw.has(p.id)) throw new Error(`prop ${p.id} uses interactive ${p.glb} but no switch wakes it`);
    breathBudget(level);
    giftOrder(level);
    enemyOrder(level);
    hiddenSwitches(level);
    motifPairs(level, collider);
    const glb = async (scene, file) => fs.writeFileSync(new URL(file, out), Buffer.from(await new GLTFExporter().parseAsync(scene, { binary: true })));
    await glb(world, 'world.glb');
    await glb(collider, 'collider.glb');
    const props = {}, q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    for (const d of decor) (props[d.var ?? d.glb] ??= []).push([...d.pos.map((n) => +n.toFixed(3)), ...(d.tilt ? q.setFromEuler(new THREE.Euler(0, d.rotY, d.tilt, 'YXZ')) : q.setFromAxisAngle(Y, d.rotY)).toArray().map((n) => +n.toFixed(4)), +d.scale.toFixed(2)]);
    fs.writeFileSync(new URL('placement.json', out), JSON.stringify({ instances: inst, props, noEdges: ['scatter_tuft', 'scatter_flower', 'scatter_leaf'], points: {} }));
    if (decor.length) console.log('decor', Object.fromEntries(Object.entries(props).map(([k, v]) => [k.split('/').pop(), v.length])));
    fs.writeFileSync(new URL('level.json', out), JSON.stringify(level, null, 1));
    console.log('wrote', out.pathname);
    console.table(gaps);
    if (steps.length) console.table(steps);
    if (windGaps.length) console.table(windGaps);
    if (dashGaps.length) console.table(dashGaps);
    if (blocked.length) console.table(blocked);
  }
  const feasibility = () => ({ jumpReach: reach(0), jumpRise: TUNING.jumpHeight, speed: TUNING.run, stepUp: TUNING.stepUp, maxFrac: MAX_FRAC, aim: AIM, gaps, steps, blocked, dashReach: +dashReach(0).toFixed(2), ...(windGaps.length ? { windGaps } : {}), ...(dashGaps.length ? { dashGaps } : {}) });

  return {
    rnd, rr, own, vnoise, isl, island, chain, rimToward, rimGap, rimFar, rimNear, noOverlap,
    vcolor, nonIdx, capGeo, rockGeo, rockColors, chunk, debris, slabGeo, mat, mesh, stoneM,
    islandMeshes, distantRing, farIsland, landmark, waterfalls, scatter, addPiece, addPieceCollider, wall, tower, pieces, slabMesh, markers, topAndWall, colliderBase,
    reach, gap, step, gapChain, windGap, dashGap, updraftDash, blocked, checkRoute, decorate, skyCastles, feasibility, write,
  };
}
export { THREE, TUNING, jumpReach, dashReach, dash2Reach };
