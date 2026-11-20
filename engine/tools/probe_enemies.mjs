// Enemy solidity probe on the REAL game (enemies.js + player.js): every enemy of every level, hero placed 3.5 m out on 8 sides
// and run straight at it for 1.6 s through registry 'input' (test mode: keyboard and bot off).
// Stone (warden / guard / boss): logs the deepest penetration of the hero's axis into the body footprint (enemies.js BODY + hero
// radius), measured after every sim step. Fails over TOL (one step of run speed: the push-out runs before the hero's own move).
// Wind (squall, thief, pull): passable by design; fails if the hero crosses it (< 0.8 m) with no contact effect at all
// (knock, breath taken, or its wind on him).
// Usage: node tools/probe_enemies.mjs [url]   (dev server, default http://localhost:5199)
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5199';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let fails = 0;
for (const lv of ['l1', 'l2', 'l3']) {
  await page.goto(`${URL}/?test=1&level=${lv}`);
  await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
  const rows = await page.evaluate(() => {
    const G = window.__game, reg = G.registry(), collide = reg.get('level').collide, P = () => reg.get('player');
    const BODY = { warden: 0.75, guard: 0.9, boss: 1.3, hero: 0.35 }, TOL = 0.13; // BODY: as enemies.js
    reg.get('level').data.goal.r = -1;
    const all = reg.get('enemies') ?? [], rows = [];
    for (const e of all) {
      if (e.state === 'off') continue; // the boss's minions: asleep until its waves
      const others = all.filter((o) => o !== e && o.kind === 'squall' && o.state !== 'off');
      for (const o of others) o.state = 'off';
      const solid = e.kind !== 'squall', rr = solid ? (e.kind === 'boss' ? BODY.boss : e.d.guard ? BODY.guard : BODY.warden) + BODY.hero : 0.8;
      const type = e.d.variant ?? (e.d.guard ? 'guard' : e.kind), row = { id: e.id, type, solid, dirs: 0, pen: 0, minDist: 99, noEffect: 0 };
      for (let j = 0; j < 8; j++) {
        reg.set('player.respawn', { t: 0 }); // enemy back at its post
        const a = (j * Math.PI) / 4, x = e.pos.x + Math.sin(a) * 3.5, z = e.pos.z + Math.cos(a) * 3.5, g = collide.groundAt(x, z, e.ground + 1.5);
        if (!g || Math.abs(g.y - e.ground) > 0.4) continue; // no floor on this side
        const p = P(); p.pos.set(x, g.y, z); p.vel.set(0, 0, 0); p.grounded = true; p.breath = p.breathMax;
        const b0 = p.breath, k0 = reg.get('enemy.knock')?.t;
        let min = 99, effect = false;
        for (let i = 0; i < 96; i++) {
          const q = P(), dx = e.pos.x - q.pos.x, dz = e.pos.z - q.pos.z, L = Math.hypot(dx, dz) || 1;
          reg.set('input', { move: [dx / L, dz / L], run: true });
          G.step();
          const d = Math.hypot(e.pos.x - P().pos.x, e.pos.z - P().pos.z);
          if ((solid || P().grounded) && Math.abs(P().pos.y - e.ground) < 1.5) min = Math.min(min, d); // U25: wind on its floor only: run off a rim, the hero falls under a wisp hovering past it (l1 thF side 5), which is no crossing
          if (P().breath < b0 - 0.9 || reg.get('enemy.knock')?.t !== k0 || e.state === 'pull') effect = true;
        }
        row.dirs++; row.minDist = Math.min(row.minDist, min);
        if (solid) row.pen = Math.max(row.pen, rr - min);
        else if (min < rr && !effect) row.noEffect++;
      }
      row.pen = +Math.max(0, row.pen).toFixed(3); row.minDist = +row.minDist.toFixed(2);
      row.fail = row.dirs === 0 || (solid ? row.pen > TOL : row.noEffect > 0);
      rows.push(row);
      for (const o of others) o.state = 'hover';
    }
    return rows;
  });
  for (const r of rows) {
    console.log(`${lv} ${r.id} [${r.type}] ${r.solid ? `solid: max penetration ${r.pen} m` : `wind: passable, closest ${r.minDist} m, passes without effect ${r.noEffect}`} (${r.dirs}/8 sides with floor) ${r.fail ? 'FAIL' : 'ok'}`);
    if (r.fail) fails++;
  }
}
console.log(`probe_enemies: ${fails} fails, ${errors.length} page errors`);
errors.slice(0, 5).forEach((e) => console.log('  ' + e));
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
