// Mover gate on the REAL game (U14: lifts ride on demand, shortcuts are kept by the save).
// Per level, on a fresh save:
//  1. 20 s of sim with the hero idle at the start: every gated platform (idle / after) has not started and has not moved.
//  2. Every 'ride' platform, woken: 5 s alone it stays home; the hero on it 4 s: carried to the far end; it waits there under him;
//     2 s after he is taken off it is back home.
// And on a save with the level's shortcut taken on a past visit: l1 the deck is mended (fixed.pillarE), l2 the lift is awake,
// l3 the crown stairs are up and still up 30 s later (pinned).
// Usage: node tools/probe_movers.mjs [url]   (dev server, default http://localhost:5199)
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'http://localhost:5199';
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
let fails = 0;
const SC = { l1: ['l1.pillarE', 'fixed.pillarE'], l2: ['l2.sc', null], l3: ['l3.sc', 'raised.stairs'] };
for (const lv of ['l1', 'l2', 'l3']) {
  for (const save of ['', encodeURIComponent(JSON.stringify({ best: { [lv]: 100 }, shortcuts: [SC[lv][0]] }))]) {
    await page.goto(`${URL}/?test=1&level=${lv}${save ? `&save=${save}` : ''}`);
    await page.waitForFunction(() => window.__game, null, { timeout: 60000 });
    const rows = await page.evaluate(([revisit, flag]) => {
      const G = window.__game, reg = G.registry(), L = reg.get('level'), p = reg.get('player'), run = (n) => { for (let i = 0; i < n; i++) G.step(); };
      const gated = L.targets.mechs.filter((k) => k.m.kind === 'platform' && (k.m.idle || k.m.after));
      for (const e of reg.get('enemies') ?? []) e.state = 'off';
      reg.set('input', { move: [0, 0] });
      G.step(); // platforms take their rest pose on the first step
      const at0 = gated.map((k) => k.cur.clone()), home = p.pos.clone();
      run(1800);
      if (revisit) return [{ id: flag ?? 'lift awake', ok: flag ? !!reg.get('flags')[flag] : L.targets.mechs.find((k) => k.m.id === 'lift').start !== undefined }];
      const rows = gated.map((k, i) => ({ id: k.m.id, ok: k.cur.distanceTo(at0[i]) === 0 && k.start === undefined, note: 'asleep before its switch' }));
      for (const k of gated.filter((q) => q.m.mode === 'ride')) {
        const y0 = k.cur.y, rise = k.m.path.at(-1)[1], far = () => Math.abs(k.cur.y - y0 - rise) < 0.02 && k.u === 1, row = (ok, note) => rows.push({ id: k.m.id, ok, note });
        k.start = 0; run(300); row(k.u === 0 || k.u === undefined, 'woken, alone: stays home');
        const board = () => { p.pos.copy(k.cur); p.pos.y += 0.6; p.vel.set(0, 0, 0); };
        board(); run(Math.round(60 * (k.m.period / 2 + 1.5))); row(far() && p.groundBody === k.body, `carries the hero ${rise} m`);
        run(300); row(far(), 'waits under him');
        p.pos.copy(home); p.vel.set(0, 0, 0); run(60); row(far(), 'still there 1 s after he left');
        run(Math.round(60 * (k.m.period / 2 + 2))); row(k.u === 0, 'back home');
      }
      return rows;
    }, [!!save, SC[lv][1]]);
    for (const r of rows) {
      console.log(`${lv} ${save ? 'revisit' : 'fresh'} ${r.id}: ${r.note ?? 'kept by the save'} ${r.ok ? 'ok' : 'FAIL'}`);
      if (!r.ok) fails++;
    }
  }
}
console.log(`probe_movers: ${fails} fails, ${errors.length} page errors`);
errors.slice(0, 5).forEach((e) => console.log('  ' + e));
await browser.close();
process.exit(fails || errors.length ? 1 : 0);
