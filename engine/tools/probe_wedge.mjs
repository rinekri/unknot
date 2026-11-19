// node tools/probe_wedge.mjs : squall knocks near props never wedge the hero. Every squall-kind enemy of every level: hero walks in from 8 sides
// (3.5 m out, as probe_enemies), takes the knock (up to 8 s), then walks back to where he started for 1.5 s. Fail: on the ground and moved < 0.6 m.
import { chromium } from 'playwright';
const b = await chromium.launch(), pg = await b.newPage(); let fails = 0;
for (const lv of ['l1', 'l2', 'l3']) {
  await pg.goto(`http://localhost:5199/?test=1&level=${lv}`); await pg.waitForFunction(() => window.__game, null, { timeout: 180000 });
  const rows = await pg.evaluate(() => { const G = window.__game, reg = G.registry(), collide = reg.get('level').collide, P = () => reg.get('player'), rows = [];
    reg.get('level').data.goal.r = -1;
    for (const e of reg.get('enemies') ?? []) { if (e.kind !== 'squall' || e.state === 'off') continue; const row = { id: e.id, knocks: 0, stuck: 0, fell: 0 };
      for (let j = 0; j < 8; j++) { reg.set('player.respawn', { t: 0 }); const a = j * Math.PI / 4, x = e.pos.x + Math.sin(a) * 3.5, z = e.pos.z + Math.cos(a) * 3.5, g = collide.groundAt(x, z, e.ground + 1.5);
        if (!g || Math.abs(g.y - e.ground) > 0.4) continue; const p = P(); p.pos.set(x, g.y, z); p.vel.set(0, 0, 0); p.grounded = true; const k0 = reg.get('enemy.knock')?.t; let hit = false;
        for (let i = 0; i < 480 && !hit; i++) { const q = P(), ex = e.pos.x - q.pos.x, ez = e.pos.z - q.pos.z, D = Math.hypot(ex, ez) || 1; reg.set('input', D > 1.3 ? { move: [ex / D, ez / D] } : { move: [0, 0] }); G.step(); hit = reg.get('enemy.knock')?.t !== k0; }
        if (!hit) continue; row.knocks++; for (let i = 0; i < 60; i++) { reg.set('input', { move: [0, 0] }); G.step(); } // the knock plays out
        const q = P(); if (Math.abs(q.pos.y - e.ground) > 1.5) { row.fell++; continue; } // off the edge: a fall, not a wedge
        const s = q.pos.clone(), dx = x, dz = z, L = Math.hypot(dx - s.x, dz - s.z) || 1;
        for (let i = 0; i < 90; i++) { reg.set('input', { move: [(dx - s.x) / L, (dz - s.z) / L] }); G.step(); } // input is consumed every step
        const mv = Math.hypot(P().pos.x - s.x, P().pos.z - s.z); (row.dbg ??= []).push([+mv.toFixed(2), +L.toFixed(2), P().state, +(P().pos.y - e.ground).toFixed(2)]); if (mv < Math.min(0.6, L - 0.3)) row.stuck++; }
      rows.push(row); }
    return rows; });
  for (const r of rows) { console.log(lv, r.id, `knocks ${r.knocks}, fell ${r.fell}, wedged ${r.stuck}`, r.stuck ? 'FAIL' : 'ok'); if (r.stuck) fails++; }
}
console.log(`wedge: ${fails} fails`); await b.close(); process.exit(fails ? 1 : 0);
