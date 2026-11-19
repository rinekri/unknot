// R10 gate: 10k simulated Keeper's Loom pulls. Base roll rates must match ODDS (pity-forced pulls excluded), no legendary drought
// over PITY pulls, the overall legendary rate must match the capped-geometric expectation, and a replay from the same seed is identical.
// node tools/loom_stats.mjs [seeds=5]
import { readFileSync } from 'node:fs';
import { pull, newLoom, ODDS, PITY, POOL, DUST_COST } from '../src/systems/loom.js';
const N = 10000, seeds = +(process.argv[2] ?? 5);
let fail = false;
const expectL = 1 / ((1 - (1 - ODDS.legendary) ** PITY) / ODDS.legendary); // 1 / E[pulls per legendary] with the pity cap
for (let s = 1; s <= seeds; s++) {
  const L = newLoom(0xC0FFEE * s), owned = {}, base = { common: 0, rare: 0, legendary: 0 }, all = { common: 0, rare: 0, legendary: 0 }, hits = {};
  let free = 0, gap = 0, maxGap = 0, forced = 0;
  for (let i = 0; i < N; i++) {
    const r = pull(L, owned);
    all[r.rarity]++; hits[r.item.id] = (hits[r.item.id] ?? 0) + 1;
    if (r.pity) forced++; else { base[r.rarity]++; free++; }
    gap = r.rarity === 'legendary' ? 0 : gap + 1; maxGap = Math.max(maxGap, gap);
  }
  const rate = (k) => base[k] / free, z = (k) => (rate(k) - ODDS[k]) / Math.sqrt(ODDS[k] * (1 - ODDS[k]) / free);
  const zl = (all.legendary / N - expectL) / Math.sqrt(expectL * (1 - expectL) / N);
  let same = true;
  const L3 = newLoom(0xC0FFEE * s), o3 = {}, L4 = newLoom(0xC0FFEE * s), o4 = {};
  for (let i = 0; i < 500; i++) if (pull(L3, o3).item.id !== pull(L4, o4).item.id) same = false;
  const unseen = POOL.filter((p) => !hits[p.id]).map((p) => p.id);
  const ok = ['common', 'rare', 'legendary'].every((k) => Math.abs(z(k)) < 3.5) && Math.abs(zl) < 3.5 && maxGap < PITY && same && !unseen.length;
  if (!ok) fail = true;
  console.log(`seed ${s}: base common ${(rate('common') * 100).toFixed(2)}% rare ${(rate('rare') * 100).toFixed(2)}% legendary ${(rate('legendary') * 100).toFixed(2)}% (z ${['common', 'rare', 'legendary'].map((k) => z(k).toFixed(2)).join('/')}) · overall legendary ${(all.legendary / N * 100).toFixed(2)}% vs ${(expectL * 100).toFixed(2)}% (z ${zl.toFixed(2)}) · pity-forced ${forced} · longest drought ${maxGap} (< ${PITY}) · dust ${L.dust} · replay ${same ? 'identical' : 'DIFFERENT'} · unseen ${unseen.length} ${ok ? 'OK' : 'FAIL'}`);
}
// U8 drop economy: every shard gives one thread dust once per save (a Warden also one seed of song): a whole save of drops must stay a side income, <= 4 chosen commons
const foes = ['l1', 'l2', 'l3'].flatMap((l) => JSON.parse(readFileSync(new URL(`../../assets/levels/${l}/level.json`, import.meta.url))).enemies ?? []);
const seedDrops = foes.filter((e) => e.kind === 'warden').length;
console.log(`drops: ${foes.length} dust (${(foes.length / DUST_COST).toFixed(1)} chosen commons), ${seedDrops} seeds, once per save`);
if (!foes.length || foes.length > 4 * DUST_COST || seedDrops > 6) fail = true;
console.log(fail ? 'LOOM STATS: FAIL' : 'LOOM STATS: PASS');
process.exit(fail ? 1 : 0);
