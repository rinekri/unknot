// R10 daily trial: one level + one modifier, picked from the local date (offline, no server). Armed from the title menu (meta.js
// showDaily -> arm), or in test runs by ?dmod=<mod> (any level). Disarmed by the title screen and the level select (hud.js).
// Mods (sim-side, only while armed; fixed per date so every walk of the day is the same):
//   gale       the level's winds push GALE x as hard (registry 'wind', scaled after level.js writes it, before enemies / player read it)
//   quickstone crumbling slabs hold for QUICK x their delay (level.json is fetched fresh per start: the change dies with the level)
// COMBOS = the (level, mod) pairs the mid bot clears (tools/meta_gate.mjs daily: all 6, seed 1); the date picks one.
// (A 'one breath less' mod was cut: the mid bot timed out on every island with it.)
import { hash } from '../core/rng.js';

export const GALE = 1.5, QUICK = 0.5;
export const MODS = {
  gale: { name: { en: 'Gale', ru: 'Шторм', pt: 'Vendaval' }, text: { en: 'the winds push half again as hard.', ru: 'ветра толкают в полтора раза сильнее.', pt: 'os ventos empurram mais metade.' } },
  quickstone: { name: { en: 'Quick stone', ru: 'Быстрый камень', pt: 'Pedra veloz' }, text: { en: 'crumbling slabs fall twice as fast.', ru: 'осыпи падают вдвое быстрее.', pt: 'as lajes que se desfazem caem duas vezes mais depressa.' } },
};
export const COMBOS = [['l1', 'gale'], ['l1', 'quickstone'], ['l2', 'gale'], ['l2', 'quickstone'], ['l3', 'gale'], ['l3', 'quickstone']];

const pad = (n) => String(n).padStart(2, '0');
export function today(d = new Date()) {
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, [level, mod] = COMBOS[hash(`sw.daily.${date}`) % COMBOS.length];
  return { date, level, mod };
}
let armed = null;
export const arm = (d) => { armed = d; };
export const disarm = () => { armed = null; };

let on = null;
export default {
  name: 'daily', order: 11.5, deps: ['level'], // after level (wind, mechanisms), before enemies / player
  init(ctx) {
    const mod = ctx.params.test ? ctx.params.get('dmod') : null;
    on = mod && MODS[mod] ? { date: 'test', level: ctx.game.levelId, mod } : armed?.level === ctx.game.levelId ? armed : null;
    ctx.registry.set('daily', on);
    if (on?.mod === 'quickstone') for (const m of ctx.registry.get('level')?.data.mechanisms ?? []) if (m.kind === 'crumble') m.delay *= QUICK;
  },
  update(ctx) {
    if (!on) return;
    if (on.mod === 'gale') ctx.registry.get('wind')?.multiplyScalar(GALE);
  },
};
