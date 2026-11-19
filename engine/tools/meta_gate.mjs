// R10 gate (dev server only): bot runs that prove each challenge, daily mods, cosmetics sheet, draw calls, menu PNGs.
// node tools/meta_gate.mjs <mode> [opts]   modes: run | challenges | daily | cosmetics | menus
//   run: --level l1 --profile mid --seed 1 [--q extra=1]  -> one bot run's meta.result
import { chromium } from 'playwright';
import fs from 'node:fs';
const A = Object.fromEntries(process.argv.slice(3).map((a, i, l) => a.startsWith('--') ? [a.slice(2), l[i + 1]?.startsWith('--') ? '1' : l[i + 1] ?? '1'] : null).filter(Boolean));
const BASE = A.url ?? 'http://localhost:5199', OUT = A.out ?? '../playtest/r10';
fs.mkdirSync(OUT, { recursive: true });
const mode = process.argv[2] ?? 'run';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function page(url, w = 1280, h = 720) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on('pageerror', (e) => errs.push(String(e)));
  pg.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await pg.goto(url);
  await pg.waitForFunction(() => window.__game?.state?.().player, null, { timeout: 120000 });
  return { pg, errs, ctx };
}
export async function botRun(...a) { // a dev-server reload (another agent saving a file) kills the page: wait, retry
  for (let k = 0; ; k++) try { return await botRun1(...a); } catch (e) { if (k >= 3) throw e; console.log(`retry (${String(e.message).split('\n')[0]})`); await new Promise((r) => setTimeout(r, 30000)); }
}
async function botRun1(level, profile = 'mid', seed = 1, extra = '') {
  const { pg, errs, ctx } = await page(`${BASE}/?test=1&bot=1&level=${level}&seed=${seed}&profile=${profile}&timeout=400${extra ? '&' + extra : ''}`); // l3 takes the mid bot ~290 s: past the game's default bot timeout
  let end = null, t = 0;
  for (; t < 400 && !end; t += 5) { await pg.evaluate(() => window.__game.advance(5)); end = await pg.evaluate(() => window.__game.state().end); }
  const res = await pg.evaluate(() => { const r = window.__game.registry().get('meta.result'); return r ? { ...r } : null; });
  const st = await pg.evaluate(() => ({ stats: window.__game.registry().get('stats') ?? null, perf: window.__game.state().perf, t: window.__game.state().t }));
  await ctx.close();
  return { level, profile, seed, extra, end, res, ...st, errs: errs.slice(0, 5) };
}
const r1 = (x) => x == null ? x : Math.round(x * 100) / 100;
const brief = (r) => r.res ? `t ${r1(r.res.t)} falls ${r.res.falls} frays ${r.res.frays} breath ${r1(r.res.breathUsed)} strikes ${r.res.strikes} hits ${r.res.hits} dashes ${r.res.dashes} jumps ${r.res.jumps} knocks ${r.res.knocks} broken ${r.res.broken} unbound ${r.res.unbound}/${r.res.enemies} met [${r.res.met}]` : `NO RESULT end=${r.end}`;

if (mode === 'run') {
  const r = await botRun(A.level ?? 'l1', A.profile ?? 'mid', +(A.seed ?? 1), A.q ?? '');
  console.log(`${r.level} ${r.profile} s${r.seed} ${r.extra}: end ${r.end} · ${brief(r)} · draws ${r.perf?.drawCalls} ${r.errs.length ? 'ERR ' + r.errs.join(' | ') : ''}`);
}

if (mode === 'challenges') { // per level: the proof runs; a challenge is proven when any proof run of that level meets it
  const lv = (A.levels ?? 'l1,l2,l3').split(','), runs = (A.runs ?? 'mid,best,mid:dash=0').split(',');
  const out = {};
  for (const l of lv) {
    out[l] = [];
    for (const spec of runs) {
      const [profile, extra = ''] = spec.split(':');
      if (extra === 'dash=0' && l === 'l3') continue;
      const r = await botRun(l, profile, +(A.seed ?? 1), extra);
      out[l].push(r);
      console.log(`${l} ${profile}${extra ? ' ' + extra : ''}: end ${r.end} · ${brief(r)}${r.errs.length ? ' ERR ' + r.errs[0] : ''}`);
    }
    const met = new Set(out[l].filter((r) => r.end === 'goal').flatMap((r) => r.res?.met ?? []));
    console.log(`${l} proven: [${[...met]}]`);
  }
  fs.writeFileSync(`${OUT}/challenges.json`, JSON.stringify(out, null, 1));
}
if (mode === 'daily') {
  const combos = (A.combos ?? 'l1:gale,l1:quickstone,l2:gale,l2:quickstone,l3:gale,l3:quickstone').split(',');
  for (const c of combos) {
    const [l, m] = c.split(':'), r = await botRun(l, 'mid', 1, `dmod=${m}`);
    console.log(`daily ${l} ${m}: end ${r.end} · ${brief(r)} · daily ${JSON.stringify(r.res?.daily)}${r.errs.length ? ' ERR ' + r.errs[0] : ''}`);
  }
}
if (mode === 'menus') { // real (non-test) title page with a seeded save: every R10 panel + loom pull frames + a toast
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const seedMeta = { v: 1, ch: { 'l1.silver': 1, 'l1.untouched': 1, 'l1.pacifist': 1, 'l2.silver': 1, 'l2.breath': 1, 'l3.untouched': 1 },
    ach: { first: 1, roll10: 1, pogo3: 1, echoes: 1, silver: 1, pull1: 1, nojump: 1 }, loom: { seed: 12345, n: 3, pity: 3, dust: 2 },
    owned: { p_dawn_stripes: 1, t_river: 1, r_rose: 1 }, eq: { pattern: 'p_dawn_stripes', tip: 't_river' }, daily: {}, count: {} };
  const seedSave = { echoes: ['l1.a', 'l1.b', 'l2.a', 'l2.b', 'l3.a', 'l3.b', 'l1.c', 'l2.c'], gifts: ['dash', 'windbreath', 'airdash'], best: { l1: 126.8, l2: 150.2, l3: 190.4 }, progress: 'l2' };
  await ctx.addInitScript(([m, sv]) => { if (!sessionStorage.getItem('r10seeded')) { localStorage.setItem('sw.meta.v1', JSON.stringify(m)); localStorage.setItem('sw.save.v2', JSON.stringify(sv)); sessionStorage.setItem('r10seeded', '1'); } }, [seedMeta, seedSave]);
  const pg = await ctx.newPage(), errs = [], wait = (ms) => pg.waitForTimeout(ms);
  pg.on('pageerror', (e) => errs.push(String(e)));
  const click = async (re) => { await pg.locator('.hud-panel button', { hasText: re }).first().click(); await wait(500); };
  const shot = async (name) => { await pg.screenshot({ path: `${OUT}/${name}.png` }); console.log(`${OUT}/${name}.png`); };
  await pg.goto(BASE + '/');
  await pg.locator('.hud-panel button', { hasText: 'Daily trial' }).waitFor({ timeout: 120000 }); await wait(2500);
  await shot('menu_title');
  await click('Daily trial'); await shot('daily_card'); await click(/^Back/);
  await click("Keeper's Loom"); await shot('loom_panel');
  await pg.locator('.hud-panel button', { hasText: 'Sing to the loom' }).first().click(); // the ritual runs, then the reveal pops (waited on below, not timed)
  await wait(150); await shot('loom_pull_1'); await wait(550); await shot('loom_pull_2'); await wait(600); await shot('loom_pull_3');
  await pg.locator('.hud-panel button', { hasText: 'Wear it' }).waitFor({ timeout: 15000 }); await wait(900); await shot('loom_pull_4_reveal'); // the pull lasts 3.4 s (4.7 legendary: loomscene.js pull()); the 'Wear it' panel is the reveal
  await click(/^Back/); await click('Wardrobe'); await shot('loom_wardrobe'); await click(/^Back/); await click(/^Back/);
  await click('Journal'); await click('Achievements'); await shot('achievements'); await click(/^Back/); await click(/^Back/);
  await click('Select level'); await shot('select_challenges');
  await pg.locator('.hud-panel button', { hasText: /·.*·/ }).first().click(); await wait(1200); await shot('level_card');
  await ctx.close();
  const tp = await page(`${BASE}/?test=1&level=l1&seed=1`);
  await tp.pg.evaluate(() => window.__meta.toast('gold')); await tp.pg.waitForTimeout(500); await tp.pg.screenshot({ path: `${OUT}/toast.png` }); console.log(`${OUT}/toast.png`);
  await tp.ctx.close();
  console.log(`errors ${errs.length} ${errs.slice(0, 3).join(' | ')}`);
}
if (mode === 'cosmetics') { // hero shot per equipped set -> one contact sheet; draw calls with and without cosmetics
  const { pg, errs, ctx } = await page(`${BASE}/?test=1&level=l1&seed=1&shot=hero`, 1280, 960);
  await pg.evaluate(() => window.__game.advance(1));
  const sets = JSON.parse(A.sets ?? 'null') ?? await pg.evaluate(() => {
    const P = window.__meta.POOL, pat = P.filter((i) => i.slot === 'pattern'), tip = P.filter((i) => i.slot === 'tip'), tr = P.filter((i) => i.slot === 'trail');
    return [{}, ...pat.map((p, i) => ({ pattern: p.id, tip: tip[i % tip.length].id, trail: tr[i % tr.length].id }))];
  });
  const shots = [];
  for (const eq of sets) {
    await pg.evaluate((eq) => { window.__game.registry().set('cosmetic.equip', eq); }, eq);
    await pg.evaluate(() => window.__game.advance(0.1));
    const png = await pg.evaluate(() => window.__game.png()), dc = await pg.evaluate(() => window.__game.state().perf.drawCalls);
    shots.push({ eq, png, dc });
  }
  // dash afterimage (trail colour): play camera (follows), dash sideways, grab the frame while the ghosts trail
  const tp = await page(`${BASE}/?test=1&level=l1&seed=1&save=all`, 1280, 960), trails = [];
  await tp.pg.evaluate(() => window.__game.advance(2));
  for (const id of JSON.parse(A.trails ?? '["r_sand","r_sage","r_sky","r_rose","r_dusk","r_gold"]')) {
    await tp.pg.evaluate((id) => { const r = window.__game.registry(); r.set('cosmetic.equip', { trail: id }); r.set('bot.enabled', false); }, id);
    await tp.pg.evaluate(() => { const r = window.__game.registry(); for (let i = 0; i < 8; i++) { r.set('input', { move: [1, 0], dash: i < 2 }); window.__game.step(1); } });
    trails.push({ eq: { trail: id }, png: await tp.pg.evaluate(() => window.__game.png()) });
    await tp.pg.evaluate(() => { window.__game.registry().set('input', { move: [0, 0] }); window.__game.advance(1.5); });
  }
  await tp.ctx.close();
  const sheet = await pg.evaluate(async ({ shots, cols, title }) => { // crop round the hero (hero shot framing), trails a wider crop
    const ims = await Promise.all(shots.map((s) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = s.png; })));
    const w = 240, h = 330, c = document.createElement('canvas'), rows = Math.ceil(ims.length / cols);
    c.width = w * cols; c.height = h * rows + 30;
    const g = c.getContext('2d'); g.fillStyle = '#f9f3ec'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = '#342d24'; g.font = 'italic 18px Georgia'; g.fillText(title, 10, 21);
    ims.forEach((im, k) => {
      const x = (k % cols) * w, y = 30 + Math.floor(k / cols) * h, W = im.width, H = im.height, tr = shots[k].trail;
      const [sx, sy, sw, sh] = tr ? [W * 0.34, H * 0.3, W * 0.32, H * 0.5] : [W * 0.36, H * 0.3, W * 0.24, H * 0.5];
      g.drawImage(im, sx, sy, sw, sh, x, y, w, h);
      g.fillStyle = 'rgba(249,243,236,.85)'; g.fillRect(x, y + h - 20, w, 20); g.fillStyle = '#342d24'; g.font = '12px Georgia';
      g.fillText((tr ? 'dash trail: ' : '') + (Object.values(shots[k].eq).join(' · ') || 'plain'), x + 6, y + h - 6);
    });
    return c.toDataURL('image/png');
  }, { shots: [...shots, ...trails.map((t) => ({ ...t, trail: 1 }))], cols: 8, title: 'Keeper\'s Loom cosmetics: cloak patterns, staff tips, dash trails (hero shot, l1)' });
  fs.writeFileSync(`${OUT}/cosmetics_sheet.png`, Buffer.from(sheet.split(',')[1], 'base64'));
  console.log(`draw calls: plain ${shots[0].dc} · with cosmetics ${[...new Set(shots.slice(1).map((s) => s.dc))].join('/')} · errors ${errs.length ? errs.join(' | ') : 0}`);
  await ctx.close();
}

await browser.close();
