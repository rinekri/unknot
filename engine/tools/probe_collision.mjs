// Collision probe on the REAL game (player.js + collide.js + level colliders): for every decor prop of every level, teleports the
// player 3 m out on 8 sides and runs it at the prop through registry 'input' (test mode mutes keyboard input, bot stays off).
// Fails if: the hero's body axis ends up inside a prop's VISUAL mesh (walked into it; the original bug); walking in ends on top of a non-walkable prop (rubble is climbable via its slab); backing off for 1 s moves < 0.3 m (wedged; open ground gives ~1.5 m); stairs can't be climbed
// from any side. A second pass walks in at jog speed (run:false), a third jumps at each prop (wedge check only: landing on a prop by jumping is allowed).
// Usage: node tools/probe_collision.mjs [url]   (dev server, default http://localhost:5175)
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5175';
const browser = await chromium.launch();
const page = await browser.newPage();
const out = { fails: [], runs: 0 };
for (const lv of ['l1', 'l2', 'l3']) {
  await page.goto(`${URL}/?test=1&level=${lv}`);
  await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
  const r = await page.evaluate(async (lv) => {
    const G = window.__game, reg = G.registry(), collide = reg.get('level').collide, P = () => reg.get('player');
    const dir = `/assets/levels/${lv}/`;
    const [placement, level] = await Promise.all([fetch(dir + 'placement.json').then((r) => r.json()), fetch(dir + 'level.json').then((r) => r.json())]);
    const items = Object.entries(placement.props ?? {}).flatMap(([glb, l]) => l.map((e) => ({ glb, x: e[0], y: e[1], z: e[2], s: e[7] })));
    items.push(...(level.props ?? []).map((p) => ({ glb: p.glb, x: p.pos[0], y: p.pos[1], z: p.pos[2], s: p.scale ?? 1 })));
    reg.get('level').data.goal.r = -1; // the goal would pause the sim and load the next level mid-probe
    const calm = () => { for (const e of reg.get('enemies') ?? []) e.state = 'off'; }; // a squall's knock shoves the hero past the prop under test (l2 rubble by sqP read as wedged), a warden's ram or the boss's waves likewise: props only here (enemies: probe_enemies, probe_wedge)
    const res = { fails: [], runs: 0 };
    const T3 = G.THREE, decor = [];
    G.scene().traverse((o) => { if (o.isInstancedMesh && /__decor$/.test(o.name)) { o.material.side = T3.DoubleSide; decor.push(o); } });
    const rc = new T3.Raycaster(), mi = new T3.Matrix4(), nm = new T3.Matrix3(), dirs = [...Array(8)].map((_, j) => new T3.Vector3(Math.sin(j * Math.PI / 4), 0, Math.cos(j * Math.PI / 4)));
    // Axis point inside a visual mesh: most horizontal rays from it first hit a back face. Returns height above feet or 0.
    const inside = (p) => {
      for (const hy of [0.3, 0.8, 1.3]) {
        let back = 0;
        for (const d of dirs) {
          rc.set(new T3.Vector3(p.x, p.y + hy, p.z), d); rc.far = 2;
          const h = rc.intersectObjects(decor, false)[0];
          if (!h) continue;
          h.object.getMatrixAt(h.instanceId, mi); mi.premultiply(h.object.matrixWorld);
          if (h.face.normal.clone().applyMatrix3(nm.getNormalMatrix(mi)).dot(d) > 0) back++;
        }
        if (back >= 6) return hy;
      }
      return 0;
    };
    const place = (x, y, z) => { calm(); const p = P(); p.pos.set(x, y, z); p.vel.set(0, 0, 0); p.grounded = true; p.breath = p.breathMax; }; // full breath: every run is at run speed; grounded: the fall apex resets (a teleport is not a drop from the last run)
    const drive = async (dx, dz, sec, jump = false, each = () => {}, run = true) => { // 60 Hz steps; jump pressed for the first 0.2 s
      for (let i = 0; i < sec * 60; i++) { reg.set('input', { move: [dx, dz], run, jump: jump && i < 12 }); G.step(); each(); }
    };
    for (const it of items) {
      const name = it.glb.split('/').pop().replace('.glb', ''), stairs = /stairs/.test(name);
      if (/rubble/.test(name) && it.s < 0.75) continue; // small rubble is walk-through by design (kit.mjs)
      const base = collide.groundAt(it.x, it.z, it.y + 0.5)?.y ?? it.y;
      let climbed = false, reach = false; // reach: some side has floor (a far vista island has no collider: nothing to walk into)
      for (const [jump, run] of [[false, true], [false, false], [true, true]]) for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2, fit = (R) => [it.x + Math.sin(a) * R, it.z + Math.cos(a) * R];
        let [sx, sz] = fit(3), g0 = collide.groundAt(sx, sz, base + 1.5);
        if (!g0 && stairs) { [sx, sz] = fit(2); g0 = collide.groundAt(sx, sz, base + 1.5); } // low end may sit near an island rim
        if (!g0 || Math.abs(g0.y - base) > 0.4) continue; // no floor at this side (island edge or other prop)
        reach = true;
        const s0 = new G.THREE.Vector3(sx, g0.y, sz), T = P().tuning ?? { radius: 0.3, height: 1.7, stepUp: 0.35 }; // baseline player has no .tuning
        if (collide.sweepCapsule(s0, s0.clone().addScaledVector(new G.THREE.Vector3(-Math.sin(a), 0, -Math.cos(a)), 0.6), T.radius, T.height, T.stepUp).hitNormal) continue; // start touches a neighbour
        res.runs++;
        reg.set('input', { move: [0, 0] }); place(sx, g0.y + 0.05, sz); G.step(18);
        const falls0 = reg.get('falls') ?? 0;
        let onTop = false, top = 0, inAt = 0, n = 0;
        await drive(-Math.sin(a), -Math.cos(a), run ? 1.5 : 2.5, jump, () => { // reaches the prop centre at run (1.5 s) or jog (2.5 s) speed
          const q = P();
          if (!inAt && n++ % 3 === 0 && Math.hypot(q.pos.x - it.x, q.pos.z - it.z) < 2) inAt = inside(q.pos);
          if (q.grounded && q.pos.y - base > 0.6 && Math.hypot(q.pos.x - it.x, q.pos.z - it.z) < 1.5) { onTop = true; top = Math.max(top, q.pos.y - base); }
        }, run);
        const p = P(), label = `${lv} ${name} @${it.x.toFixed(1)},${it.z.toFixed(1)} dir${k}${jump ? ' jump' : run ? '' : ' jog'}`;
        if ((reg.get('falls') ?? 0) > falls0) continue; // ran off the island past the prop: not a prop contact
        if (inAt) res.fails.push(`${label}: walked into the prop mesh (axis inside at +${inAt} m)`);
        if (onTop && stairs) climbed = true;
        if (onTop && !stairs && !/rubble/.test(name) && !jump) res.fails.push(`${label}: walked onto top (y +${top.toFixed(2)})`);
        const at = p.pos.clone();
        await drive(Math.sin(a), Math.cos(a), 1);
        if (P().pos.distanceTo(at) < 0.3) res.fails.push(`${label}: wedged (moved ${P().pos.distanceTo(at).toFixed(2)} m backing off)`);
      }
      if (stairs && reach && !climbed) res.fails.push(`${lv} ${name} @${it.x.toFixed(1)},${it.z.toFixed(1)}: stairs not climbable from any side`);
    }
    return res;
  }, lv);
  out.runs += r.runs; out.fails.push(...r.fails);
}
await browser.close();
console.log(`runs=${out.runs} fails=${out.fails.length}`);
for (const f of out.fails) console.log(' ', f);
process.exit(out.fails.length ? 1 : 0);
