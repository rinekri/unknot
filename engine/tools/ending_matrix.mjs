#!/usr/bin/env node
// R8 ending matrix: bot chains l1 -> l2 -> l3, the in-memory save (core/save.js, ?save=<json>) carried page to page, then
// endingFor() of the final save. Chains: worst -> bad, mid -> middle, best then revisit (every lock, with all gifts) -> true.
// Then stills of the three finale cutscenes (?cut=<name>&cutT=<s>) with their console errors. Exit 1 on any mismatch or error.
//   node tools/ending_matrix.mjs --url http://localhost:5199 --out <dir> [--chains worst,mid,true]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const url = arg('url', 'http://localhost:5199').replace(/\/$/, ''), out = path.resolve(arg('out', '../playtest/endings')), timeout = +arg('timeout', 360);
const CHAINS = { worst: { want: 'bad', passes: ['profile=worst'] }, mid: { want: 'middle', passes: ['profile=mid'] }, true: { want: 'true', passes: ['profile=best', 'profile=revisit&gifts=all'] } };
const pick = arg('chains', 'worst,mid,true').split(',').filter((c) => CHAINS[c]); // --chains none: the stills only
const pw = await import(createRequire(path.join(process.cwd(), 'x.js')).resolve('playwright'));
const browser = await (pw.default ?? pw).chromium.launch({ args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader'] });
fs.mkdirSync(out, { recursive: true });
let failed = false;

async function open(q) {
  for (let k = 0; ; k++) { // the dev server may hot-reload mid-run: retry the page
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } }), errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(e.message));
    try {
      await page.goto(`${url}/?test=1&seed=1&timeout=${timeout}&${q}`);
      await page.waitForFunction(() => window.__game, null, { timeout: 120000 });
      return { page, errors };
    } catch (e) { await page.close(); if (k >= 3) throw e; }
  }
}

for (const name of pick) {
  const c = CHAINS[name];
  let save = null, ok = true;
  for (const pass of c.passes) for (const lv of ['l1', 'l2', 'l3']) {
    let page, errors, st, got;
    for (let k = 0; !got; k++) { // a hot reload mid-run destroys the page: run the level again
      ({ page, errors } = await open(`level=${lv}&bot=1&${pass}${save ? `&save=${encodeURIComponent(JSON.stringify(save))}` : ''}`));
      try {
        do st = await page.evaluate(() => window.__game.advance(5).then(() => window.__game.state())); while (!st.end && st.t < timeout);
        got = await page.evaluate(() => window.__swSave.getSave());
      } catch (e) { await page.close(); if (k >= 3) throw e; }
    }
    save = got;
    const errs = [...new Set([...errors, ...st.errors])];
    console.log(`${name} ${pass} ${lv}: end=${st.end ?? 'timeout'} t=${Math.round(st.t)} falls=${st.falls} errors=${errs.length}`);
    if (st.end !== 'goal' || errs.length) { ok = false; errs.forEach((e) => console.log('  ' + e)); }
    await page.close();
  }
  const { page } = await open(`level=l3&save=${encodeURIComponent(JSON.stringify(save))}`);
  const [kind, h] = await page.evaluate(() => [window.__swSave.endingFor(), window.__swSave.harmony()]);
  await page.close();
  fs.writeFileSync(path.join(out, `save_${name}.json`), JSON.stringify(save, null, 2));
  const pass_ = ok && kind === c.want;
  console.log(`${name}: ending=${kind} (want ${c.want}) harmony=${h.score}/${h.max} ${JSON.stringify(h.parts)} ${pass_ ? 'OK' : 'FAIL'}`);
  if (!pass_) failed = true;
}

for (const cut of ['finale_bad', 'finale', 'finale_true']) { // stills: start, middle, last line
  const { page, errors } = await open(`level=l3&cut=${cut}&cutT=0`);
  const dur = await page.evaluate((n) => window.__game.cutscenes().find((c) => c.name === n)?.dur ?? 0, cut);
  await page.close();
  if (!dur) { console.log(`${cut}: missing`); failed = true; continue; }
  for (const t of [2, dur * 0.5, dur - 2]) {
    const g = await open(`level=l3&cut=${cut}&cutT=${t.toFixed(1)}`);
    await g.page.evaluate(() => window.__game.advance(1 / 60));
    const png = await g.page.evaluate(() => window.__game.png()), file = path.join(out, `${cut}_${String(Math.round(t)).padStart(2, '0')}.png`);
    fs.writeFileSync(file, Buffer.from(png.split(',')[1], 'base64'));
    console.log(`${cut} t=${t.toFixed(1)}: ${file} errors=${g.errors.length}`);
    if (g.errors.length) { failed = true; g.errors.forEach((e) => console.log('  ' + e)); }
    await g.page.close();
  }
  if (errors.length) failed = true;
}
await browser.close();
process.exit(failed ? 1 : 0);
