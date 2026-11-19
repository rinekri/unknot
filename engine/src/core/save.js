// The one save: localStorage 'sw.save.v2' (R6/R8). Other modules read and write it only through these helpers.
// API (stable, for hud.js, progress.js, the meta layer):
//   getSave()                -> the live save object (do not mutate; use the helpers)
//   updateSave(fn)           -> fn(draft) mutates a copy; saved and returned
//   addTo(list, ...ids)      -> adds ids to an array field (echoes, gifts, shortcuts, locks, requests, relics, broken)
//   setWorld(flag, v = true) -> world flags that persist across levels and runs ('kamen.home', 'l2.cord', ...)
//   noteRun(level, {t, falls}) -> best time and fewest falls for a level (falls: best run counts)
//   harmony(save?)           -> {score, max, parts}: the mountain's memory (never shown as a number; the journal draws a weave)
//   endingFor(save?)         -> 'bad' | 'middle' | 'true'
//   setEnding(kind)          -> records last and best ending
//   tales(save?)             -> number of tale parts found (0..5); threads(save?) -> cloak threads (0..3)
//   resetSave()              -> fresh v2 save (New game)
// Schema v2: {v, echoes[], gifts[], best{lv: s}, progress, world{}, shortcuts[], locks[], requests[], relics[], broken[],
//   falls{lv: n}, ending{last, best}, drops[]}. drops: '<level>.<enemy>' (its thread dust taken), '<level>.<enemy>.seed' (enemies.js, once per save). relics: 'tale.1'..'tale.5', 'thread.l1'.., 'song2.gust'.. (pickups, progress.js).
// v1 keys ('sw.echoes', 'sw.gifts', 'sw.best', 'sw.progress') are migrated once on first load and left in place.
// Test / bot runs (?test or ?bot) never touch localStorage: an in-memory save, seeded by ?save=all|<json> (testapi), so the sim stays
// deterministic and the ending matrix can chain levels in one page (globalThis.__swSave).
const KEY = 'sw.save.v2';
const RANK = { bad: 0, middle: 1, true: 2 };
export const TALES = 5, THREADS = 3, ECHOES = 16;
const fresh = () => ({ v: 2, echoes: [], gifts: [], best: {}, progress: null, world: {}, shortcuts: [], locks: [], requests: [], relics: [], broken: [], drops: [], falls: {}, ending: { last: null, best: null } });
const q = new URLSearchParams(globalThis.location?.search ?? '');
const memOnly = q.has('test') || q.has('bot') || typeof localStorage === 'undefined';
const ls = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window: not saved */ } },
};
function normalize(s) {
  const f = fresh();
  if (!s || typeof s !== 'object') return f;
  for (const k of Object.keys(f)) if (s[k] != null && typeof s[k] === typeof f[k] && Array.isArray(s[k]) === Array.isArray(f[k])) f[k] = s[k];
  if (typeof s.progress === 'string') f.progress = s.progress;
  f.ending = { last: s.ending?.last ?? null, best: s.ending?.best ?? null };
  return f;
}
function load() {
  if (memOnly) {
    const seed = q.get('save');
    if (seed === 'all') return normalize({ gifts: ['dash', 'windbreath', 'airdash', 'gust', 'name', 'anchor'], relics: ['song2.gust', 'song2.name'] });
    try { return normalize(seed ? JSON.parse(seed) : null); } catch { return fresh(); }
  }
  const v2 = ls.get(KEY);
  if (v2) return normalize(v2);
  const s = normalize({ echoes: ls.get('sw.echoes') ?? [], gifts: ls.get('sw.gifts') ?? [], best: ls.get('sw.best') ?? {}, progress: ls.get('sw.progress') });
  ls.set(KEY, s);
  return s;
}
let save = load();
const write = () => { if (!memOnly) ls.set(KEY, save); };

export const getSave = () => save;
export function updateSave(fn) {
  const d = structuredClone(save);
  fn(d);
  save = normalize(d);
  write();
  return save;
}
export const addTo = (list, ...ids) => updateSave((s) => { s[list] = [...new Set([...(s[list] ?? []), ...ids.filter(Boolean)])]; });
export const setWorld = (flag, v = true) => updateSave((s) => { s.world[flag] = v; });
export const noteRun = (level, { t, falls } = {}) => updateSave((s) => {
  if (t != null && !(s.best[level] <= t)) s.best[level] = t;
  if (falls != null && !(s.falls[level] <= falls)) s.falls[level] = falls;
});
export const resetSave = () => { save = fresh(); write(); return save; };
export const tales = (s = save) => s.relics.filter((r) => r.startsWith('tale.')).length;
export const threads = (s = save) => s.relics.filter((r) => r.startsWith('thread.')).length;
// harmony = echoes + requests answered + tales - things broken - 1 per 3 falls per level (fewest falls of any run).
export function harmony(s = save) {
  const fallPen = Object.values(s.falls).reduce((a, n) => a + Math.floor(n / 3), 0);
  const parts = { echoes: s.echoes.length, requests: s.requests.length, tales: tales(s), broken: -s.broken.length, falls: -fallPen };
  return { score: Object.values(parts).reduce((a, b) => a + b, 0), max: ECHOES + 2 + TALES, parts };
}
// true: all 5 tales and harmony >= 75 % of max; bad: harmony < 4 (came empty, broke what it met); else middle.
export function endingFor(s = save) {
  const h = harmony(s);
  if (tales(s) >= TALES && h.score >= Math.ceil(0.75 * h.max)) return 'true';
  return h.score < 4 ? 'bad' : 'middle';
}
export const setEnding = (kind) => updateSave((s) => { s.ending.last = kind; if (!(RANK[s.ending.best] >= RANK[kind])) s.ending.best = kind; });
if (memOnly) globalThis.__swSave = { getSave, updateSave, addTo, setWorld, noteRun, harmony, endingFor, setEnding, resetSave, tales, threads };
