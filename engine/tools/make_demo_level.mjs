// Writes public/assets/levels/l1/{level.json,world.glb,collider.glb,placement.json}.
// Real GLBs (not runtime geometry) so the demo exercises the same loader path as generated levels.
// Usage: node tools/make_demo_level.mjs
import fs from 'node:fs';
import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TUNING, jumpReach } from '../src/systems/player.js';

// GLTFExporter wants FileReader; node only has Blob.
globalThis.FileReader = class { readAsArrayBuffer(b) { b.arrayBuffer().then((r) => { this.result = r; this.onloadend(); }); } };

const MAX_FRAC = 0.85; // every gap <= 0.85 x reach (playtest.md); real generators aim for 0.60-0.75
const out = new URL('../public/assets/levels/l1/', import.meta.url);
// [id, cx, topY, cz, sx, sz] boxes 0.5 m thick; route runs along +Z
const pads = [
  ['start', 0, 0.0, 0, 6, 6],
  ['plat_a', 0, 0.3, 7, 3, 3],
  ['plat_b', 0, 0.6, 12.5, 3, 3],
  ['plat_c', 0, 0.9, 22.5, 3, 3],
  ['goal_pad', 0, 0.9, 29.5, 6, 6],
  ['ledge', 0, 1.2, 30.75, 6, 3.5], // step-up (rise <= stepUp), no jump
];
const lift = ['mech_lift', 0, 0.6, 17.5, 3, 3]; // moves on X, gaps stay in reach
const box = ([, x, top, z, sx, sz]) => new THREE.BoxGeometry(sx, 0.5, sz).translate(x, top - 0.25, z);
const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 });

const world = new THREE.Scene();
for (const p of pads) world.add(Object.assign(new THREE.Mesh(box(p), mat(p[0] === 'goal_pad' || p[0] === 'ledge' ? 0xe0c070 : 0x9aa0a8)), { name: `${p[0]}__stone` }));
const liftNode = new THREE.Group(); liftNode.name = 'mech_lift'; liftNode.position.set(lift[1], 0, lift[3]);
liftNode.add(Object.assign(new THREE.Mesh(box([, 0, lift[2], 0, lift[4], lift[5]]), mat(0xb07040)), { name: 'lift__wood' }));
world.add(liftNode);
world.add(Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2).translate(0, -4, 15), mat(0x3a6f8f)), { name: 'sea__water' }));
world.add(Object.assign(new THREE.Mesh(new THREE.ConeGeometry(0.6, 2.2, 7).translate(0, 1.1, 0), mat(0x2f6b3a)), { name: 'pine_a' }));
for (const n of ['spawn', 'goal']) world.add(Object.assign(new THREE.Object3D(), { name: n }));
world.getObjectByName('goal').position.set(0, 1.2, 31.5);

const collider = new THREE.Scene();
collider.add(Object.assign(new THREE.Mesh(mergeGeometries(pads.map(box))), { name: 'walk_surface' }));
const liftCol = new THREE.Group(); liftCol.name = 'mech_lift'; liftCol.position.copy(liftNode.position);
liftCol.add(new THREE.Mesh(box([, 0, lift[2], 0, lift[4], lift[5]])));
collider.add(liftCol);

const glb = async (scene, file) => fs.writeFileSync(new URL(file, out), Buffer.from(await new GLTFExporter().parseAsync(scene, { binary: true })));
await glb(world, 'world.glb');
await glb(collider, 'collider.glb');

const q = (h) => [0, Math.sin(h / 2), 0, Math.cos(h / 2)];
fs.writeFileSync(new URL('placement.json', out), JSON.stringify({
  instances: { pine_a: [[-2.3, 0, -2.3, ...q(0.3), 1], [2.3, 0, -2, ...q(1.1), 0.8], [-2.4, 1.2, 31.8, ...q(2), 1.2], [2.2, 1.2, 32, ...q(0.7), 0.9]] },
  points: {},
  solid: ['pine_a'], // pines block the player (collision from the instance transforms)
}, null, 1));

const gaps = [];
const all = [...pads.slice(0, 3), lift, ...pads.slice(3, 5)];
for (let i = 1; i < all.length; i++) {
  const [a, b] = [all[i - 1], all[i]];
  const dist = +((b[3] - b[5] / 2) - (a[3] + a[5] / 2)).toFixed(2), rise = +(b[2] - a[2]).toFixed(2);
  if (dist > MAX_FRAC * jumpReach(rise)) throw new Error(`gap ${a[0]}->${b[0]} ${dist} m exceeds ${MAX_FRAC} x reach ${jumpReach(rise).toFixed(2)}`);
  gaps.push({ from: a[0], to: b[0], dist, rise });
}
const steps = [{ from: 'goal_pad', to: 'ledge', rise: +(pads[5][2] - pads[4][2]).toFixed(2) }];
for (const st of steps) if (st.rise > TUNING.stepUp) throw new Error(`step ${st.from}->${st.to} ${st.rise} m exceeds stepUp ${TUNING.stepUp}`);
fs.writeFileSync(new URL('level.json', out), JSON.stringify({
  id: 'l1', title: 'Demo', next: null,
  spawn: { pos: [0, 0, 0], heading: 0 },
  goal: { kind: 'circle', pos: [0, 1.2, 31.5], r: 1.2 },
  killY: -3,
  mechanisms: [
    { id: 'm1', kind: 'platform', node: 'mech_lift', path: [[-1, 0, 0], [1, 0, 0]], mode: 'ping', period: 4 },
    { id: 'm2', kind: 'wind', area: { kind: 'box', min: [-3, 0, 20], max: [3, 4, 25] }, force: [1.5, 0, 0], cycle: [5, 1, 2] },
  ],
  checkpoints: [{ id: 'c1', pos: [0, 0.6, 12.5], r: 1.5 }],
  triggers: [{ id: 't1', shape: { kind: 'poly', pts: [[-3, 1], [3, 1], [3, 3], [-3, 3]] }, hint: 'Space to jump - hold for height', teaches: 'jump_hold', ifFlag: null, once: true }],
  shots: [{ name: 'vista', pos: [7, 6, -6], look: [0, 0.5, 14] }, { name: 'goal', pos: [-5, 4, 22], look: [0, 1, 30] }],
  route: [[0, 0, 0, 0], [0, 0, 2.5, 0], [0, 0.3, 7, 0], [0, 0.6, 12.5, 0], [0, 0.6, 17.5, 0], [0, 0.9, 22.5, 0], [0, 0.9, 27.5, 0], [0, 1.2, 31.5, 0]],
  feasibility: { jumpReach: +jumpReach(0).toFixed(2), jumpRise: TUNING.jumpHeight, speed: TUNING.run, maxFrac: MAX_FRAC, gaps, steps },
}, null, 1));
console.log('wrote', out.pathname, gaps, steps);
