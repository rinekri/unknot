// R10 meta layer: per-level challenges, achievements (+ toasts), seeds of song, the Keeper's Loom and the daily trial (menus only).
// Cosmetic only: nothing here feeds the sim. The system watches run events, keeps a run record ('meta.result' at the goal) and,
// outside test / bot runs, saves to localStorage 'sw.meta.v1':
//   {v, ch: {'l1.gold': 1}, ach: {id: 1}, loom: {seed, n, pity, dust}, owned: {item: count}, eq: {slot: item}, daily: {date: {t, level, mod}},
//    count: {menhir, ...}}. Seeds of song are derived, never stored: challenges + achievements + daily days + echoes/4 - pulls.
// The main save (echoes, best, relics, endings, locks, requests, broken) is read through core/save.js (sw.save.v2), never written.
// Run record: clock from the first input (as hud.js), falls, frays (registry 'stats', player.js), breath used (segments spent),
// strikes, enemy hits, dashes, jumps, knocks, broken (save.broken growth + stats.broken), shards unbound / total. A checkpoint
// restart continues the record (the hero respawned at a checkpoint is the same walk).
// Toast: an embroidered patch (the achievement's badge) flies in at the top-left for TOAST_S with the 'chime' cue; queued, never during test / bot runs
// (window.__meta.toast(id) shows one for the visual check).
import { tr } from './hud.js';
import { POOL, ODDS, PITY, DUST_COST, SLOTS, byId, pull, newLoom } from './loom.js';
import * as loomScene from './loomscene.js';
import { drawItem } from './loomscene.js';
import { MODS, today, arm } from './daily.js';
import { seal, badge, island } from './menuart.js';
import { getSave, ECHOES, TALES } from '../core/save.js';

const KEY = 'sw.meta.v1', TOAST_S = 2;
const q = new URLSearchParams(globalThis.location?.search ?? '');
const memOnly = q.has('test') || q.has('bot') || typeof localStorage === 'undefined';
const L = (en, ru) => tr({ en, ru });

// ---- challenges: thresholds from the bots, seed 1 (tools/meta_gate.mjs challenges proves each one; playtest/r10/challenges.json) ----
// mid bot clock: l1 128.1 s, l2 162.9 s, l3 290.2 s (best 146 / 177.9 / 306.8). silver = generous, gold = the mid bot + ~4 %
// (mid is the fastest bot, so a gold under its clock could not be proven).
// breath = segments spent (running drains it too), the mid bot + a little. light = jumps (mid 44 / 34 / 56). peace: pacifist (no strike
// lands on a shard) or liberator (every shard unbound; the mid bot frees 3/3 on l2). l3 sixth: restorer (break nothing on the way).
// No dash-free challenge: every island needs the dash (a no-dash bot run times out).
export const CH_LEVELS = {
  l1: { silver: 150, gold: 134, breath: 18, jumps: 46, peace: 'pacifist' },
  l2: { silver: 200, gold: 170, breath: 36, jumps: 38, peace: 'liberator' },
  l3: { silver: 350, gold: 300, breath: 46, jumps: 58, peace: 'restorer' },
};
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
export function challenges(id) {
  const c = CH_LEVELS[id];
  if (!c) return [];
  return [
    { id: 'silver', name: { en: `Silver: under ${fmt(c.silver)}`, ru: `Серебро: быстрее ${fmt(c.silver)}` }, ok: (r) => r.t <= c.silver },
    { id: 'gold', name: { en: `Gold: under ${fmt(c.gold)}`, ru: `Золото: быстрее ${fmt(c.gold)}` }, ok: (r) => r.t <= c.gold },
    { id: 'breath', name: { en: `Breathless: ${c.breath} breath or less`, ru: `Без дыхания: не больше ${c.breath}` }, ok: (r) => r.breathUsed <= c.breath + 0.01 },
    { id: 'untouched', name: { en: 'Untouched: no falls, no frays', ru: 'Нетронутый: без падений и надрывов' }, ok: (r) => !r.falls && !r.frays },
    { id: 'light', name: { en: `Light step: ${c.jumps} jumps or fewer`, ru: `Лёгкий шаг: не больше ${c.jumps} прыжков` }, ok: (r) => r.jumps <= c.jumps },
    c.peace === 'pacifist'
      ? { id: 'pacifist', name: { en: 'Pacifist: never strike a shard', ru: 'Миротворец: ни одного удара по осколку' }, ok: (r) => !r.hits }
      : c.peace === 'liberator'
        ? { id: 'liberator', name: { en: 'Liberator: unbind every shard', ru: 'Освободитель: развяжи все осколки' }, ok: (r) => r.enemies > 0 && r.unbound >= r.enemies }
        : { id: 'restorer', name: { en: 'Restorer: break nothing', ru: 'Хранитель: ничего не сломать' }, ok: (r) => !r.broken },
  ];
}

// ---- achievements (25) ----
const G = { story: { en: 'Story', ru: 'История' }, mastery: { en: 'Mastery', ru: 'Мастерство' }, explore: { en: 'Explorer', ru: 'Исследователь' }, secret: { en: 'Secrets', ru: 'Тайны' }, speed: { en: 'Speed', ru: 'Скорость' }, loom: { en: 'Loom and trials', ru: 'Ткацкий стан и испытания' } };
const a = (id, g, en, ru, len, lru, ok, secret = false) => ({ id, g, name: { en, ru }, lore: { en: len, ru: lru }, ok, secret });
const ends = (s) => [s.ending?.last, s.ending?.best];
const allCh = (m, pred) => Object.keys(CH_LEVELS).every((lv) => challenges(lv).filter(pred).every((c) => m.ch[`${lv}.${c.id}`]));
export const ACH = [
  a('first', 'story', 'First crossing', 'Первая переправа', 'The quarry wakes behind you.', 'Каменоломня просыпается за спиной.', (x) => x.best.l1 != null || x.run?.level === 'l1'),
  a('end_bad', 'story', 'A quiet sky', 'Тихое небо', 'You came empty, and the wind was kind anyway.', 'Ты пришёл с пустыми руками, и ветер всё равно был добр.', (x) => ends(x.s).includes('bad')),
  a('end_middle', 'story', 'Half a song', 'Полпесни', 'The knot loosened. Not all of it.', 'Узел ослаб. Не весь.', (x) => ends(x.s).includes('middle') || ends(x.s).includes('true')),
  a('end_true', 'story', 'The mountain remembers', 'Гора помнит', 'Every name sung back to its stone.', 'Каждое имя вернулось к своему камню.', (x) => ends(x.s).includes('true')),
  a('tales', 'story', 'Five tales', 'Пять сказаний', 'The Keepers\' story, whole again.', 'История Хранителей снова целая.', (x) => x.tales >= TALES),
  a('roll10', 'mastery', 'Ten soft landings', 'Десять мягких посадок', 'Ten rolls in a row. The ground forgave you.', 'Десять перекатов подряд. Земля простила.', (x) => x.m.count.rollStreak >= 10),
  a('pogo3', 'mastery', 'Bell-ringer', 'Звонарь', 'Three bounces, never touching ground.', 'Три отскока, не касаясь земли.', (x) => x.m.count.pogoChain >= 3),
  a('boss_clean', 'mastery', 'Untangled', 'Распутанный', 'The Knot Warden freed without a single knock.', 'Узловой Страж освобождён без единого удара.', (x) => x.run?.level === 'l3' && x.run.bossFree && !x.run.knocks),
  a('true_clean', 'mastery', 'Light feet', 'Лёгкие ноги', 'The true ending, the Crown walked without a fall.', 'Истинный финал, Корона пройдена без падений.', (x) => ends(x.s).includes('true') && x.m.count.crownClean),
  a('echoes', 'explore', 'Every echo', 'Всё эхо', 'All the voices the wind kept.', 'Все голоса, что сохранил ветер.', (x) => x.echoes >= ECHOES),
  a('locks', 'explore', 'Old doors', 'Старые двери', 'Every Keeper lock opened.', 'Все замки Хранителей открыты.', (x) => (x.s.locks?.length ?? 0) >= 3),
  a('requests', 'explore', 'Good neighbour', 'Добрый сосед', 'Every request answered.', 'Ответил на все просьбы.', (x) => (x.s.requests?.length ?? 0) >= 2),
  a('songs', 'explore', 'Full voice', 'Полный голос', 'All six gifts in one throat.', 'Все шесть даров в одном горле.', (x) => (x.s.gifts?.length ?? 0) >= 6),
  a('liberator', 'explore', 'Wind set loose', 'Ветер на свободе', 'Every shard on the Crown unbound in one walk.', 'Все осколки на Короне развязаны за один путь.', (x) => x.run?.level === 'l3' && x.run.enemies > 0 && x.run.unbound >= x.run.enemies),
  a('brother', 'secret', 'Kamen\'s brother', 'Брат Камня', 'He was here the whole time, standing very still.', 'Он всё время был здесь, просто стоял очень тихо.', (x) => !!(x.s.world?.['kamen.brother'] || x.s.relics?.includes('kamen.brother')), true),
  a('menhir', 'secret', 'Persistent', 'Настойчивый', 'You sang to the menhir ten times. It is still a rock.', 'Ты пел менгиру десять раз. Он всё ещё камень.', (x) => x.m.count.menhir >= 10, true),
  a('nojump', 'secret', 'Gravity\'s friend', 'Друг притяжения', 'Reached the end of an island without a single jump.', 'Дошёл до конца острова, ни разу не прыгнув.', (x) => x.run && !x.run.jumps, true),
  a('daily1', 'secret', 'First trial', 'Первое испытание', 'The day\'s wind, walked.', 'Пройден ветер дня.', (x) => Object.keys(x.m.daily).length >= 1),
  a('silver', 'speed', 'Quick feet', 'Быстрые ноги', 'Silver on every island.', 'Серебро на каждом острове.', (x) => allCh(x.m, (c) => c.id === 'silver')),
  a('gold', 'speed', 'Wind-runner', 'Бегущий с ветром', 'Gold on every island.', 'Золото на каждом острове.', (x) => allCh(x.m, (c) => c.id === 'gold')),
  a('ch10', 'loom', 'Ten threads', 'Десять нитей', 'Ten challenges met.', 'Выполнено десять испытаний.', (x) => Object.keys(x.m.ch).length >= 10),
  a('ch_all', 'loom', 'Master weaver', 'Мастер-ткач', 'Every challenge on every island.', 'Все испытания на всех островах.', (x) => allCh(x.m, () => true)),
  a('pull1', 'loom', 'First thread', 'Первая нить', 'The loom sang back.', 'Стан запел в ответ.', (x) => x.m.loom.n >= 1),
  a('legend', 'loom', 'Golden thread', 'Золотая нить', 'A legendary weave.', 'Легендарное плетение.', (x) => Object.keys(x.m.owned).some((k) => byId(k)?.rarity === 'legendary')),
  a('daily7', 'loom', 'Seven winds', 'Семь ветров', 'Seven daily trials walked.', 'Пройдено семь испытаний дня.', (x) => Object.keys(x.m.daily).length >= 7),
];

// ---- meta state ----
const fresh = () => ({ v: 1, ch: {}, ach: {}, loom: newLoom((Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0), owned: {}, eq: {}, daily: {}, count: {} }); // loom seed: UI-time entropy, once
function load() {
  let m = null;
  if (!memOnly) try { m = JSON.parse(localStorage.getItem(KEY)); } catch { /* private window */ }
  const f = fresh();
  if (!m || typeof m !== 'object') return f;
  for (const k of Object.keys(f)) if (m[k] && typeof m[k] === typeof f[k]) f[k] = m[k];
  return f;
}
export const meta = load();
const persist = () => { if (!memOnly) try { localStorage.setItem(KEY, JSON.stringify(meta)); } catch { /* not saved */ } };
const mainSave = () => { try { return getSave() ?? {}; } catch { return {}; } };
export function seeds() {
  const s = mainSave();
  return Object.keys(meta.ch).length + Object.keys(meta.ach).length + Object.keys(meta.daily).length + Math.floor((s.echoes?.length ?? 0) / 4) + (meta.count.seedDrop ?? 0) - meta.loom.n;
}
export function equip(slot, id) { meta.eq[slot] = id || null; persist(); cur?.registry.set('cosmetic.equip', { ...meta.eq }); }

// ---- achievements check + toasts ----
let cur = null, run = null, lastNew = [], toastQ = [], toastOn = false;
function checkAch(withRun) {
  const s = mainSave(), x = { s, m: meta, run: withRun ? run : null, best: s.best ?? {}, echoes: s.echoes?.length ?? 0, tales: (s.relics ?? []).filter((r) => r.startsWith('tale.')).length };
  for (const k of ['rollStreak', 'pogoChain', 'menhir']) meta.count[k] ??= 0;
  const got = [];
  for (const ach of ACH) if (!meta.ach[ach.id]) { let ok = false; try { ok = ach.ok(x); } catch { /* missing data */ } if (ok) { meta.ach[ach.id] = 1; got.push(ach); } }
  if (got.length) { persist(); for (const g of got) toast(g); }
  return got;
}
function style() {
  if (document.getElementById('meta-css')) return;
  const st = Object.assign(document.createElement('style'), { id: 'meta-css' });
  st.textContent = `
  .meta-toast { position: fixed; top: 72px; left: 22px; display: flex; align-items: center; gap: 10px; padding: 7px 18px 8px 9px; border-radius: 26px 8px 8px 26px;
    background: linear-gradient(#f8efdd, #ecdcbf); outline: 1.5px dashed #b5452f; outline-offset: -5px; color: var(--ink); font: italic 16px Georgia, serif; pointer-events: none; z-index: 6; zoom: var(--ts);
    animation: meta-fly ${TOAST_S}s ease both; box-shadow: 0 0 0 1.5px var(--line), 0 5px 16px rgba(52,45,36,.3); }
  .meta-toast .badge { width: 40px; height: 40px; flex: none; }
  .meta-toast.low { top: 22px; left: auto; right: 22px; }
  .meta-toast small { display: block; font: 12px Georgia, serif; font-style: normal; color: var(--line); letter-spacing: .04em; }
  @keyframes meta-fly { 0% { opacity: 0; transform: translate(-40px, -26px) rotate(-8deg); } 16% { opacity: 1; transform: none; } 84% { opacity: 1; transform: none; } 100% { opacity: 0; transform: translate(-10px, -8px); } }
  .meta-ch { margin: 4px 0 0; padding: 0; list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 2px 14px; font-size: 13px; line-height: 1.25; color: var(--line); text-align: left; }
  .meta-ch li { display: flex; align-items: center; gap: 6px; margin: 0; padding: 0; } .meta-ch li.ok { color: var(--ink); } .meta-ch .seal { width: 20px; height: 20px; }
  .hud-load .meta-ch { margin: 18px auto 0; width: max-content; max-width: 100%; }
  .meta-ach .badge { width: 100%; aspect-ratio: 1; display: block; } .hud-panel .meta-ach .meta-card { background: none; border-color: transparent; } .meta-ach .meta-card.locked { background: none; }
  .meta-ach .meta-card > span { font-size: 9.5px; line-height: 1.1; height: 3.3em; overflow-wrap: break-word; letter-spacing: -.01em; justify-content: center; width: 100%; text-align: center; } .meta-lore { min-height: 2.8em; margin: 2px 0 0; font-size: 13.5px; font-style: italic; color: var(--line); }
  .meta-odds { font-size: 13px; color: var(--line); margin-top: 8px; padding: 8px 12px; border-radius: 6px; background: rgba(233,210,180,.35); } .meta-odds b { color: var(--ink); font-weight: normal; } .meta-odds b.rare { color: #3f6f96; } .meta-odds b.legendary { color: #a8742a; }
  .meta-purse { display: flex; gap: 18px; align-items: flex-end; margin: 4px 0 2px; } .meta-purse small { display: block; margin-top: 3px; font-size: 12px; color: var(--line); letter-spacing: .03em; }
  .meta-seeds { display: flex; flex-wrap: wrap; gap: 1px; min-height: 26px; } .meta-seeds i { width: 22px; height: 26px; animation: meta-seed 2.3s ease-in-out infinite; } .meta-seeds svg { width: 100%; height: 100%; filter: drop-shadow(0 0 5px rgba(233,184,90,.95)); }
  .meta-seeds i.none { animation: none; opacity: .3; } .meta-seeds i.none svg { filter: grayscale(1); }
  @keyframes meta-seed { 50% { transform: translateY(-2px) scale(1.07); filter: brightness(1.15); } }
  .meta-dust { display: flex; gap: 4px; align-items: center; min-height: 26px; } .meta-dust i { width: 15px; height: 15px; border-radius: 50%; border: 1.5px solid var(--line); box-sizing: border-box; background: repeating-linear-gradient(35deg, transparent 0 2px, rgba(100,93,79,.25) 2px 3px); }
  .meta-dust i.on { border-color: var(--ink); background: repeating-linear-gradient(35deg, var(--gold) 0 2px, #c8963c 2px 3px); box-shadow: 0 0 6px rgba(233,184,90,.8); }
  .meta-weave { display: flex; flex-direction: column; align-items: center; gap: 5px; margin: 6px 0 8px; } .meta-weave canvas { width: 120px; height: 120px; border-radius: 4px; box-shadow: 0 3px 12px rgba(52,45,36,.25); animation: meta-pop .5s ease both; }
  .meta-weave em { font-size: 21px; } .meta-weave small { color: var(--line); letter-spacing: .08em; text-transform: uppercase; font-size: 12px; }
  .meta-weave.rare em { color: #3f6f96; } .meta-weave.rare canvas { box-shadow: 0 0 0 2px #6fa3cf, 0 0 18px rgba(111,163,207,.8); }
  .meta-weave.legendary em { color: #a8742a; } .meta-weave.legendary canvas { box-shadow: 0 0 0 2px var(--gold), 0 0 26px var(--gold); }
  @keyframes meta-pop { 0% { transform: scale(.6) rotate(-6deg); opacity: 0; } 70% { transform: scale(1.08); opacity: 1; } 100% { transform: none; } }
  .meta-tabs { display: grid; grid-template-columns: repeat(5, 1fr); gap: 4px; margin: 8px 0 0; border-bottom: 2px solid var(--line); }
  .hud-panel .meta-tabs button { display: flex; flex-direction: column; align-items: center; gap: 1px; padding: 6px 2px 4px; border-radius: 8px 8px 0 0; border-bottom: 0; background: rgba(233,210,180,.4); color: var(--line); font-size: 11.5px; text-align: center; line-height: 1.1; }
  .hud-panel .meta-tabs button.on { background: var(--cream); color: var(--ink); box-shadow: 0 2px 0 var(--cream); } .meta-tabs svg { width: 26px; height: 26px; }
  .hud-panel .meta-tabs button:focus { box-shadow: 0 0 0 2px var(--gold), inset 0 4px 0 var(--gold); }
  .meta-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; margin: 4px -4px 0; padding: 6px 4px 4px; max-height: calc((100vh - 40px) / var(--ts) - 290px); overflow-y: auto; }
  .hud-panel .meta-card { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 5px 3px 4px; border-radius: 8px; background: linear-gradient(#fbf6ee, #f0e2cc); border: 1.5px solid var(--line); text-align: center; min-width: 0; transition: transform .12s; }
  .meta-card > span { font-size: 11.5px; line-height: 1.15; height: 2.3em; overflow: hidden; display: flex; align-items: center; } .meta-card img, .meta-card canvas, .meta-card .meta-v { width: 100%; aspect-ratio: 1; border-radius: 5px; display: block; }
  .meta-card img { background: radial-gradient(circle at 50% 60%, #fff8e8, #ead9bd); } .meta-card.rare { border-color: #4f83ad; } .meta-card.legendary { border-color: #c8963c; background: linear-gradient(#fff7e0, #f3dba6); }
  .meta-card.rare::before, .meta-card.legendary::before { content: ''; position: absolute; top: -5px; left: 50%; width: 9px; height: 9px; transform: translateX(-50%) rotate(45deg); background: #6fa3cf; border: 1.5px solid var(--ink); } .meta-card.legendary::before { background: var(--gold); }
  .meta-card.on::after { content: '✦'; position: absolute; top: 1px; right: 4px; color: #a8742a; font-size: 15px; text-shadow: 0 0 4px #fff; } .meta-card.on { background: linear-gradient(#fff3d0, #f1d79c); }
  .meta-card.locked img { filter: brightness(0) opacity(.3); background: none; } .meta-card.locked .meta-v { filter: grayscale(1) contrast(.5) opacity(.4); animation-play-state: paused; } .meta-card.locked { background: repeating-linear-gradient(45deg, #efe6d6 0 6px, #e9dfcc 6px 12px); } .meta-card.locked .meta-v * , .meta-card.locked .meta-v::before, .meta-card.locked .meta-v::after { animation-play-state: paused; } .meta-card.locked > span { color: #9a9284; }
  .hud-panel .meta-card:focus { box-shadow: 0 0 0 3px var(--gold), 0 4px 10px rgba(52,45,36,.25); transform: translateY(-2px); } .meta-card.shake { animation: meta-shake .3s; }
  @keyframes meta-shake { 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
  .meta-name { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; min-height: 3.2em; margin: 2px 0 0; } .meta-name em { font-size: 17px; line-height: 1.25; } .meta-name small { color: var(--line); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; text-align: right; }
  .meta-v { position: relative; overflow: hidden; background: radial-gradient(circle at 50% 60%, #fff8e8, #ead9bd); }
  .meta-v.trail::before { content: ''; position: absolute; left: -60%; top: 44%; width: 70%; height: 12%; border-radius: 50%; background: linear-gradient(90deg, transparent, var(--c)); box-shadow: 0 0 8px var(--c); outline: 1px solid rgba(52,45,36,.0); animation: meta-streak 1.5s cubic-bezier(.5,0,.5,1) infinite; }
  .meta-v.trail { background: linear-gradient(#cfd9e2, #9fb2c4); }
  @keyframes meta-streak { 0% { left: -70%; top: 62%; transform: rotate(-14deg); } 100% { left: 110%; top: 26%; transform: rotate(-14deg); } }
  .meta-v.voice { display: flex; align-items: center; justify-content: center; gap: 7%; } .meta-v.voice b { width: 9%; height: 30%; border-radius: 4px; background: var(--c); animation: meta-wave .9s ease-in-out infinite; }
  .meta-v.voice b:nth-child(2) { animation-delay: -.15s; } .meta-v.voice b:nth-child(3) { animation-delay: -.3s; } .meta-v.voice b:nth-child(4) { animation-delay: -.45s; } .meta-v.voice b:nth-child(5) { animation-delay: -.6s; }
  @keyframes meta-wave { 50% { height: 72%; } }
  .meta-v.backdrop { background: linear-gradient(color-mix(in srgb, var(--c) 70%, #8f9fc0), var(--c) 55%, #f6d9a8); }
  .meta-v.backdrop::before { content: ''; position: absolute; left: 50%; bottom: 22%; width: 30%; aspect-ratio: 1; transform: translateX(-50%); border-radius: 50%; background: #fff6d8; box-shadow: 0 0 12px #fff6d8; }
  .meta-v.backdrop::after { content: ''; position: absolute; inset: auto 0 0 0; height: 30%; background: #7f7a86; clip-path: polygon(0 100%, 0 45%, 22% 10%, 40% 55%, 62% 0, 80% 50%, 100% 25%, 100% 100%); }
  body.loom-on .hud-timer, body.loom-on .hud-plate, body.loom-on .hud-hint { display: none; } body.loom-on canvas { cursor: grab; }
  .meta-day { margin: 8px 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px; background: rgba(233,210,180,.35); }
  .meta-day .isle { float: right; width: 130px; margin: -8px -6px 0 8px; } .meta-day::after { content: ''; display: block; clear: both; }
  .meta-day b { font: 22px Georgia, serif; color: var(--line); margin-right: 8px; } .meta-day h2 { display: inline; font: italic 21px Georgia, serif; }
  .meta-day p { margin: 6px 0 0; font-size: 15px; } .meta-day .mod { color: var(--ink); } .meta-day .mod::before { content: '✦ '; color: var(--gold); }`;
  document.head.append(st);
}
export function toast(ach) {
  if (typeof document === 'undefined' || !ach) return;
  if (memOnly && !toast.force) return;
  toastQ.push(ach);
  if (!toastOn) nextToast();
}
function nextToast() {
  const ach = toastQ.shift();
  if (!ach) { toastOn = false; return; }
  toastOn = true; style();
  const el = document.createElement('div');
  el.className = document.querySelector('.hud-panel') ? 'meta-toast low' : 'meta-toast'; // a menu is open (left column): sit top-right, clear of its header
  el.innerHTML = `${badge(ach.g)}<span><small>${L('Achievement', 'Достижение')}</small>${tr(ach.name)}</span>`;
  document.body.append(el);
  cur?.registry.set('audio.cue', { name: 'chime', gain: 0.5 });
  setTimeout(() => { el.remove(); nextToast(); }, TOAST_S * 1000 + 150);
}

// ---- the run record ----
function newRun(ctx) {
  const s = mainSave();
  return { level: ctx.game.levelId, t: 0, on: false, falls: 0, frays: 0, breathUsed: 0, strikes: 0, hits: 0, dashes: 0, jumps: 0, knocks: 0, broken: 0, unbound: 0, enemies: 0, bossFree: false, broken0: s.broken?.length ?? 0, stats0: 0 };
}
const assistOn = (ctx) => { const s = ctx.game.settings ?? {}; return ctx.params?.get?.('breath') === '0' || !!s.infiniteAirDash || !!s.allGifts || s.breath === false || s.gameSpeed < 1; };
let prevB, prevMax, rollStreak, pogoChain;

function finish(ctx) {
  const reg = ctx.registry, flags = reg.get('flags') ?? {}, en = reg.get('enemies') ?? [];
  const live = en.filter((e) => !e.d?.sleep || e.woke); // a wrong-note squall never woken was never met
  run.enemies = live.length; run.unbound = live.filter((e) => flags[`enemy.${e.id}.free`]).length;
  run.bossFree = !!flags['enemy.kw.free'];
  run.broken = Math.max(0, (mainSave().broken?.length ?? 0) - run.broken0) + Math.max(0, ((reg.get('stats') ?? {}).broken ?? 0) - run.stats0);
  run.assist = assistOn(ctx); run.daily = reg.get('daily') ?? null;
  const met = run.assist || run.daily ? [] : challenges(run.level).filter((c) => c.ok(run)).map((c) => c.id);
  const fresh = met.filter((id) => !meta.ch[`${run.level}.${id}`]);
  const r = { ...run, met, fresh };
  reg.set('meta.result', r);
  for (const id of met) meta.ch[`${run.level}.${id}`] = 1;
  if (run.level === 'l3' && !run.falls) meta.count.crownClean = 1;
  if (run.daily && !run.assist) { const d = meta.daily[run.daily.date]; if (!d || run.t < d.t) meta.daily[run.daily.date] = { t: run.t, level: run.level, mod: run.daily.mod }; }
  lastNew = fresh;
  persist();
  checkAch(true);
  return r;
}
export const resultLine = () => { // results card note: the daily trial walked, seeds earned (the seals themselves are drawn by hud.js)
  const r = cur?.registry.get('meta.result');
  return [r?.daily ? `${L('Daily trial', 'Испытание дня')} · ${tr(MODS[r.daily.mod]?.name)}` : '', lastNew.length ? `+${lastNew.length} ${L('seed', 'семя')}` : ''].filter(Boolean).join(' · ');
};

// ---- menu panels (hud.js passes its helpers: h = {setPanel, mk, goTo, reg}) ----
export function challengeList(levelId, mk) { // a wax seal each, pressed once met; the loading card and the level select
  style();
  const ul = mk('ul', 'meta-ch');
  for (const c of challenges(levelId)) { const on = !!meta.ch[`${levelId}.${c.id}`], li = mk('li', on ? 'ok' : ''); li.innerHTML = seal(c.id, on); li.append(mk('span', null, tr(c.name))); ul.append(li); }
  return ul;
}
export function showAchievements(h, back) { // embroidered badges, one colour and emblem per group; unearned = the bare outline, secrets = '?'
  style();
  const lore = h.mk('p', 'meta-lore'), page = h.mk('div', 'hud-page');
  const [grid, name] = cardGrid(h, [...Object.keys(G)].flatMap((g) => ACH.filter((x) => x.g === g)).map((x) => {
    const got = !!meta.ach[x.id], hide = x.secret && !got, v = h.mk('i');
    v.innerHTML = badge(x.g, got, x.secret);
    return { key: x.id, visual: v, locked: !got, label: hide ? '? ? ?' : tr(x.name), note: tr(G[x.g]), lore: hide ? L('A secret of the mountain.', 'Тайна горы.') : tr(x.lore) };
  }), { onFocus: (c) => { lore.textContent = c.lore; }, onPick: () => cueOf(h)('tick', 0.3) });
  grid.classList.add('meta-ach'); grid.firstChild.dataset.first = '';
  page.append(grid);
  h.setPanel('achievements', `<h1>${L('Achievements', 'Достижения')} <small class="hud-note">${Object.keys(meta.ach).length}/${ACH.length}</small></h1>`, [[L('Back', 'Назад'), back, false, 'back']], [page, name, lore], back);
}

const RAR = { common: { en: 'common', ru: 'обычное' }, rare: { en: 'rare', ru: 'редкое' }, legendary: { en: 'legendary', ru: 'легендарное' } };
const SLOT = { pattern: { en: 'Cloak', ru: 'Плащ' }, tip: { en: 'Staff tip', ru: 'Навершие' }, trail: { en: 'Trail', ru: 'След' }, voice: { en: 'Voice', ru: 'Голос' }, backdrop: { en: 'Title sky', ru: 'Небо меню' } };
// ---- the Keeper's Loom and the wardrobe: a shrine in the scene (loomscene.js) beside the panel ----
const st = () => ({ pity: meta.loom.pity / PITY, dust: Math.min(1, meta.loom.dust / DUST_COST) });
const cueOf = (h) => (name, gain = 0.6) => h.reg()?.set('audio.cue', { name, gain });
const openScene = (h, mode) => { style(); if (cur) loomScene.open(cur, mode, st(), { cue: cueOf(h), thumb: (k, url) => { for (const i of document.querySelectorAll(`.meta-card img[data-k="${k}"]`)) i.src = url; } }); };
const leave = (back) => () => { loomScene.close(); cur?.registry.set('cosmetic.equip', { ...meta.eq }); back(); };
const SEED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5c4.6 4 6.6 7.8 6.6 11.3a6.6 6.6 0 0 1-13.2 0C5.4 10.3 7.4 6.5 12 2.5z" fill="var(--gold)" stroke="var(--ink)" stroke-width="1.2"/><path d="M12 8.500c1.8 2 2.6 3.7 2.6 5.3" fill="none" stroke="var(--cream)" stroke-width="1.4" stroke-linecap="round"/></svg>';
const ICON = { // tab glyphs, ink on cream
  pattern: '<path d="M12 2.5c-2.3 0-3.7 1.8-3.7 4 0 1.3-.7 2.4-1.7 3.600C4.9 12.3 4.3 15.5 4.3 19.500c5 2.4 10.4 2.4 15.4 0 0-4-.6-7.2-2.3-9.4-1-1.2-1.7-2.3-1.7-3.6 0-2.2-1.4-4-3.7-4z"/><path d="M7.5 13.500c3 1.1 6 1.1 9 0M6.5 17c3.6 1.3 7.4 1.3 11 0"/>',
  tip: '<path d="M12 10.500V22"/><path d="M12 2l3.6 4.600L12 10.8 8.4 6.600z"/>',
  trail: '<path d="M3 18c3-6 6 1 9-4s6-3 9-9"/><path d="M5 8.500l.01 0M17 17l.01 0"/>',
  voice: '<circle cx="6" cy="12" r="2.3"/><path d="M11 8.500a5 5 0 0 1 0 7M14.5 6a8.5 8.5 0 0 1 0 12M18 3.800a12 12 0 0 1 0 16.4"/>',
  backdrop: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><circle cx="12" cy="15" r="3.5"/><path d="M2.5 15h6M15.5 15h6"/>',
};
const icon = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICON[k]}</svg>`;
function purse(h) { // seeds of song as glowing seeds, thread dust as the spindle's five turns
  const n = seeds(), d = meta.loom.dust, el = h.mk('div', 'meta-purse');
  el.innerHTML = `<div title="${L('Seeds of song', 'Семена песни')}"><span class="meta-seeds">${n > 0 ? Array.from({ length: Math.min(n, 10) }, (_, i) => `<i style="animation-delay:${-i * 0.23}s">${SEED}</i>`).join('') : `<i class="none">${SEED}</i>`}</span><small>${L('Seeds of song', 'Семена песни')} · ${n}</small></div>
    <div title="${L('Thread dust', 'Нитяная пыль')}"><span class="meta-dust">${Array.from({ length: DUST_COST }, (_, i) => `<i class="${i < d ? 'on' : ''}"></i>`).join('')}</span><small>${L('Thread dust', 'Нитяная пыль')} · ${d}/${DUST_COST}</small></div>`;
  return el;
}
const pic = (it, px = 96) => { const c = Object.assign(document.createElement('canvas'), { width: px * 2, height: px * 2 }); drawItem(c.getContext('2d'), px * 2, it); return c; };
let oddsOpen = false;
export function showLoom(h, back) {
  openScene(h, 'loom');
  loomScene.endPull(); loomScene.setState(st()); loomScene.preview({ ...meta.eq });
  const n = seeds(), L0 = meta.loom, out = leave(back), again = () => showLoom(h, back), info = h.mk('div', 'meta-odds');
  info.hidden = !oddsOpen;
  info.innerHTML = `<p><b>${L('common', 'обычное')} ${ODDS.common * 100}%</b> · <b class="rare">${L('rare', 'редкое')} ${ODDS.rare * 100}%</b> · <b class="legendary">${L('legendary', 'легендарное')} ${ODDS.legendary * 100}%</b></p>
    <p>${L(`A legendary is certain by the ${PITY}th pull (about 9% of pulls overall): the tapestry on the loom grows with every pull and is finished in gold.`, `Легендарное гарантировано к ${PITY}-й попытке (около 9% в среднем): гобелен на стане растёт с каждой попыткой и завершается золотом.`)}
    ${L('Pulls since the last legendary', 'С последнего легендарного')}: ${L0.pity}/${PITY}. ${L(`A duplicate unravels into thread dust; ${DUST_COST} dust weaves a common of your choice.`, `Повтор распускается в пыль; ${DUST_COST} пыли = обычное на выбор.`)}</p>
    <p>${L('Looks only: the loom never changes how the game plays. Seeds come from challenges, achievements, daily trials and echoes; never from money.', 'Только внешний вид: стан не меняет игру. Семена дают испытания, достижения, испытания дня и эхо; никогда не деньги.')}</p>`;
  h.setPanel('loom', `<h1>${L('Keeper\'s Loom', 'Стан Хранителей')}</h1>`, [
    [L('Sing to the loom · 1 seed', 'Спеть стану · 1 семя'), () => weave(h, back), n < 1, 'note'],
    [L(`Weave a common · ${DUST_COST} dust`, `Соткать обычное · ${DUST_COST} пыли`), () => showDust(h, again), L0.dust < DUST_COST],
    [L('Wardrobe', 'Гардероб'), () => showWardrobe(h, again), false, 'cloak', true],
    [L('Odds', 'Шансы'), () => { oddsOpen = !oddsOpen; again(); }, false, 'eye', true],
    [L('Back', 'Назад'), out, false, 'back'],
  ], [purse(h), info], out);
}
let weaveTok = 0;
export function weave(h, back) { // one pull: the ritual plays on the loom (skippable), then the woven piece is shown
  if (seeds() < 1) return showLoom(h, back);
  openScene(h, 'loom');
  loomScene.endPull();
  const r = pull(meta.loom, meta.owned), it = r.item, tok = ++weaveTok, home = () => { weaveTok++; showLoom(h, back); };
  persist();
  h.setPanel('loom-weave', `<h1>${L('Keeper\'s Loom', 'Стан Хранителей')}</h1><p class="hud-note">${L('the loom is weaving…', 'стан ткёт…')}</p>`, [[L('Skip', 'Пропустить'), loomScene.skip, false, 'skip']], purse(h), loomScene.skip);
  loomScene.pull(r, st(), () => {
    if (tok !== weaveTok) return;
    if (!r.dupe) loomScene.preview({ ...meta.eq, [it.slot]: it.id }, { trail: it.slot === 'trail' ? it.col : null }); // the hero tries it on
    checkAch(false);
    const box = h.mk('div', `meta-weave ${r.rarity}`);
    box.append(pic(it));
    box.insertAdjacentHTML('beforeend', `<small>${tr(RAR[r.rarity])} · ${tr(SLOT[it.slot])}</small><em>${tr(it.name)}</em><small>${r.dupe ? L('already yours: it unravels into thread dust', 'уже есть: распускается в нитяную пыль') : L('new', 'новое')}</small>`);
    h.setPanel('loom-weave', `<h1>${L('Keeper\'s Loom', 'Стан Хранителей')}</h1>`, [
      [L('Wear it', 'Надеть'), () => { equip(it.slot, it.id); home(); loomScene.flourish(); cueOf(h)('cloth', 0.7); }, false, 'check'],
      [L('Sing again · 1 seed', 'Спеть ещё · 1 семя'), () => weave(h, back), seeds() < 1, 'note'],
      [L('Back', 'Назад'), home, false, 'back'],
    ], [box, purse(h)], home);
  });
}
const COLS = 5;
// A grid of item cards under optional tabs. Focus = look (preview), click = take. Up / down move by rows, left / right along the row.
function cardGrid(h, items, { tabs = null, onFocus, onPick, focusId }) {
  const grid = h.mk('div', 'meta-grid'), name = h.mk('p', 'meta-name'), cards = [];
  items.forEach((c, j) => {
    const b = h.mk('button', `meta-card ${c.rarity ?? ''}${c.locked ? ' locked' : ''}${c.on ? ' on' : ''}`);
    b.append(c.visual, h.mk('span', null, c.label));
    b.addEventListener('focus', () => { b.scrollIntoView({ block: 'nearest' }); name.innerHTML = `<em>${c.label}</em><small>${c.note}</small>`; onFocus?.(c); });
    b.onclick = () => onPick(c, b);
    b.cycle = (d) => cards[(j + d + cards.length) % cards.length].focus();
    b.step = (d) => { const k = j + d * COLS, t = k < 0 ? tabs?.querySelector('.on') : cards[k] ?? (d > 0 && Math.floor(j / COLS) < Math.floor((cards.length - 1) / COLS) ? cards.at(-1) : null); t?.focus(); return !!t; };
    cards.push(b); grid.append(b);
    if (c.key === focusId) queueMicrotask(() => h.focus(b));
  });
  if (tabs) for (const t of tabs.children) t.step = (d) => { if (d > 0) { (cards.find((b) => b.classList.contains('on')) ?? cards[0]).focus(); return true; } return false; };
  return [...(tabs ? [tabs] : []), grid, name];
}
const visual = (h, slot, it, key) => { // the card's picture: cloak / staff tip rendered on the hero with the real shader; trail, voice and sky drawn live
  if (slot === 'pattern' || slot === 'tip') { const i = Object.assign(h.mk('img'), { alt: '', src: loomScene.thumb(key) ?? 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==' }); i.dataset.k = key; return i; }
  const v = h.mk('i', `meta-v ${slot}`);
  if (slot === 'trail') v.style.setProperty('--c', it?.col ?? '#fff3d0');
  if (slot === 'backdrop') v.style.setProperty('--c', it?.sky ?? '#f6eadb');
  if (slot === 'voice') { v.innerHTML = '<b></b><b></b><b></b><b></b><b></b>'; v.style.setProperty('--c', it ? '#5b86a8' : '#b07a52'); }
  return v;
};
let wardTab = 'pattern';
function showWardrobe(h, back, focusId = null) {
  openScene(h, 'wardrobe');
  const slot = wardTab, out = () => { loomScene.preview({ ...meta.eq }); back(); }, cue = cueOf(h);
  const tabs = h.mk('div', 'meta-tabs');
  SLOTS.forEach((s, i) => {
    const b = h.mk('button', s === slot ? 'on' : '');
    b.innerHTML = `${icon(s)}<span>${tr(SLOT[s])}</span>`;
    b.cycle = (d) => { wardTab = SLOTS[(i + d + SLOTS.length) % SLOTS.length]; showWardrobe(h, back, 'tab'); };
    b.onclick = () => { wardTab = s; showWardrobe(h, back, 'tab'); };
    tabs.append(b);
  });
  const plain = `plain.${slot}`, items = [null, ...POOL.filter((i) => i.slot === slot)].map((it) => {
    const own = !it || !!meta.owned[it.id], key = it?.id ?? plain;
    return { it, key, locked: !own, on: (meta.eq[slot] ?? null) === (it?.id ?? null), rarity: it?.rarity, visual: visual(h, slot, own ? it : null, own ? key : plain),
      label: it ? tr(it.name) : L('Plain', 'Простой'), note: it ? `${tr(RAR[it.rarity])}${own ? '' : ` · ${L('not yet woven', 'ещё не соткано')}`}` : L('as the mountain made it', 'как создала гора') };
  });
  if (slot === 'pattern' || slot === 'tip') loomScene.wantThumbs(items.filter((c) => !c.locked).map((c) => ({ key: c.key, eq: c.it ? { [slot]: c.it.id } : {}, kind: slot })));
  const show = (c) => {
    const id = c.locked ? meta.eq[slot] : c.it?.id ?? null, tcol = byId(slot === 'trail' ? id : meta.eq.trail)?.col;
    loomScene.preview({ ...meta.eq, [slot]: id }, { trail: slot === 'trail' ? tcol ?? '#fff3d0' : null, zoom: slot === 'tip' ? 'tip' : null });
    if (slot === 'voice' && !c.locked) { const reg = h.reg(); reg?.set('talk.line', { voice: 'wisp', text: L('La li lo, the wind remembers', 'Ла ли ло, ветер помнит'), dur: 1.3 }); reg?.set('talk.line', null); }
  };
  const pick = (c, b) => {
    if (c.locked) { cue('deny', 0.5); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); return; }
    equip(slot, c.it?.id ?? null);
    for (const x of b.parentNode.children) x.classList.toggle('on', x === b);
    loomScene.flourish(); cue('cloth', 0.7); cue('chime', 0.35);
  };
  const p = h.setPanel('wardrobe', `<h1>${L('Wardrobe', 'Гардероб')}</h1><p class="hud-note">${L('Woven', 'Соткано')} ${Object.keys(meta.owned).length}/${POOL.length} · ${L('drag the hero to turn', 'тяни героя, чтобы повернуть')}</p>`,
    [[L('Back', 'Назад'), out, false, 'back']], cardGrid(h, items, { tabs, onFocus: show, onPick: pick, focusId: focusId === 'tab' ? null : focusId ?? (meta.eq[slot] ?? plain) }), out);
  if (focusId === 'tab') h.focus(p.querySelector('.meta-tabs .on'));
  if (focusId === 'tab') show(items.find((c) => c.on) ?? items[0]);
}
function showDust(h, back) {
  openScene(h, 'loom');
  const can = meta.loom.dust >= DUST_COST;
  const items = POOL.filter((i) => i.rarity === 'common' && !meta.owned[i.id]).map((it) => ({ it, key: it.id, rarity: it.rarity, visual: pic(it, 48), label: tr(it.name), note: tr(SLOT[it.slot]) }));
  const pick = (c) => {
    if (meta.loom.dust < DUST_COST) return cueOf(h)('deny', 0.5);
    meta.loom.dust -= DUST_COST; meta.owned[c.it.id] = 1; persist();
    cueOf(h)('chime', 0.6); back();
  };
  h.setPanel('dust', `<h1>${L('Weave a common', 'Соткать обычное')}</h1><p class="hud-note">${can ? L('The spindle is full: choose a thread.', 'Веретено полно: выбери нить.') : L('The spindle is not full yet.', 'Веретено ещё не полно.')}</p>`,
    [[L('Back', 'Назад'), back, false, 'back']], [purse(h), ...(items.length ? cardGrid(h, items, { onPick: pick, focusId: items[0].key }) : [h.mk('p', 'hud-note', L('Every common is already yours.', 'Все обычные уже есть.'))])], back);
}
export function showDaily(h, back, levels) {
  style();
  const d = today(), lv = levels.find((l) => l.id === d.level), best = meta.daily[d.date], card = h.mk('div', 'meta-day');
  card.innerHTML = `${island(d.level)}<b>${lv?.n ?? ''}</b><h2>${tr(lv?.title ?? d.level)}</h2><p class="mod">${tr(MODS[d.mod].name)}: ${tr(MODS[d.mod].text)}</p>
    <p>${best ? `${L('Today\'s best', 'Лучшее сегодня')}: ${fmtCs(best.t)}` : L('Not yet walked today.', 'Сегодня ещё не пройдено.')}</p>
    <p class="hud-note">${best ? L('Today\'s seed is yours. Walk again for a better time.', 'Семя дня получено. Можно улучшить время.') : L('Reach the end once today for a seed of song.', 'Дойди до конца сегодня, чтобы получить семя песни.')}</p>`;
  h.setPanel('daily', `<h1>${L('Daily trial', 'Испытание дня')}</h1><p class="hud-note">${d.date}</p>`, [
    [L('Begin', 'Начать'), () => { arm(d); h.goTo(d.level, { reset: true, card: true, outMs: 500 }); }, false, 'play'],
    [L('Back', 'Назад'), back, false, 'back'],
  ], card, back);
}
const fmtCs = (s) => { const c = Math.floor(s * 100); return `${String(Math.floor(c / 6000)).padStart(2, '0')}:${String(Math.floor(c / 100) % 60).padStart(2, '0')}.${String(c % 100).padStart(2, '0')}`; };

export default {
  name: 'meta', order: 62, deps: ['player'],
  init(ctx) {
    const reg = ctx.registry, cont = run && run.level === ctx.game.levelId && reg.get('checkpoint') && !run.done;
    loomScene.close(); // a level change under an open shrine
    cur = ctx;
    if (!cont) run = newRun(ctx);
    run.stats0 = (reg.get('stats') ?? {}).broken ?? 0;
    prevB = prevMax = null; rollStreak = 0; pogoChain = 0;
    reg.set('cosmetic.equip', { ...meta.eq });
    reg.on('player.fall', () => { run.falls++; });
    reg.on('player.strike', () => { run.strikes++; });
    reg.on('enemy.hit', () => { run.hits++; });
    reg.on('enemy.knock', () => { run.knocks++; });
    reg.on('player.dash', () => { run.dashes++; });
    reg.on('player.jump', () => { run.jumps++; });
    reg.on('player.fray', () => { run.frays++; });
    reg.on('player.landing', (e) => { // R9 landing kinds: a roll streak breaks on any hard landing
      if (!e?.kind) return;
      rollStreak = e.kind === 'roll' ? rollStreak + 1 : 0;
      if (rollStreak > (meta.count.rollStreak ?? 0)) { meta.count.rollStreak = rollStreak; if (rollStreak >= 10) checkAch(false); }
    });
    reg.on('player.bounce', () => { pogoChain++; if (pogoChain > (meta.count.pogoChain ?? 0)) { meta.count.pogoChain = pogoChain; if (pogoChain >= 3) checkAch(false); } });
    reg.on('player.land', () => { pogoChain = 0; });
    reg.on('song.done', (e) => { if (e?.id && /menhir/i.test(e.id)) { meta.count.menhir = (meta.count.menhir ?? 0) + 1; checkAch(false); } });
    reg.on('drop.pick', ({ kind }) => { if (kind === 'dust') meta.loom.dust++; else if (kind === 'seed') meta.count.seedDrop = (meta.count.seedDrop ?? 0) + 1; else return; persist(); }); // U8: an unbound shard's thread dust / a Warden's seed of song
    reg.on('end', (e) => { if (e === 'goal' && !run.done) { run.done = true; finish(ctx); } });
    if (!memOnly) checkAch(false); // endings / tales / echoes from the main save (the title start sees them)
    if (q.get('test') === '1') window.__meta = { meta, run: () => run, challenges, ACH, seeds, checkAch, toast: (id) => { toast.force = true; toast(ACH.find((x) => x.id === id) ?? ACH[0]); }, equip, pull: () => pull(meta.loom, meta.owned), POOL };
  },
  beforeRender() { loomScene.frame(); }, // the loom shrine / dressing plinth own the camera while their panel is open (last system)
  update(ctx, dt) {
    const reg = ctx.registry, i = reg.get('input'), p = reg.get('player');
    if (!run.on && i && (i.move?.[0] || i.move?.[1] || i.jump || i.dash || i.strike || i.sing || i.song)) run.on = true;
    if (run.on && !reg.get('end')) run.t += dt;
    if (p) { // breath spent: every drop of the gauge, except a fray tearing the gauge itself
      if (prevB != null && p.breath < prevB && p.breathMax >= prevMax) run.breathUsed += prevB - p.breath;
      prevB = p.breath; prevMax = p.breathMax;
    }
  },
};
