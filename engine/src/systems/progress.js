// R6 / R8 progress: the bridge between a run and the save (core/save.js). Sim-side, deterministic: in test / bot runs the save is in
// memory (seeded by ?save=), so the same URL replays the same way.
// init: seeds flags from the save (relics 'song2.*' / 'tale.*' / 'thread.*', world flags as 'world.<k>'), reg 'threads' (cloak
//   threads: 3 = +1 breath, player.js), and re-opens what a past visit opened: lock and shortcut runes, fire settled ('cut.fire'; U14: a shortcut is a lift kept awake / a bridge kept up, hud.js New journey forgets them).
// listens: 'echo' (an echo or a relic), 'gift' (an NPC gift), 'flags' (a request stone sung -> its Song II + a world flag; a shortcut
//   or lock rune woken), 'player.fall', 'end' (best time, falls; things broken on the way: broken.<id> flags of non-breakable mechs).
import { getSave, addTo, setWorld, noteRun, threads, updateSave } from '../core/save.js';

const SONG2 = { kamen: 'song2.gust', sigh: 'song2.name' }; // a request answered: whose song grows
let seen, falls;

export default {
  name: 'progress', order: 11.5, deps: ['level'],
  init(ctx) {
    const reg = ctx.registry, data = reg.get('level')?.data, lv = data?.id, flags = reg.get('flags'), sv = getSave();
    if (!data || !flags) return;
    for (const r of sv.relics) flags[r] = true;
    for (const [k, v] of Object.entries(sv.world)) if (v) flags[`world.${k}`] = true;
    reg.set('flags', flags);
    reg.set('threads', threads());
    seen = new Set(Object.keys(flags).filter((k) => flags[k]));
    falls = 0;
    const mechs = data.mechanisms ?? [], key = (m) => `${lv}.${m.id}`;
    for (const m of mechs) if ((m.lock && sv.locks.includes(key(m))) || (m.shortcut && sv.shortcuts.includes(key(m)))) reg.set('cut.fire', m.id);

    reg.on('echo', (e) => {
      if (e.relic) { addTo('relics', e.relic); flags[e.relic] = true; reg.set('threads', threads()); } else addTo('echoes', e.key);
    });
    reg.on('gift', (g) => { if (!g.id.startsWith('song2.')) addTo('gifts', g.id); });
    reg.on('player.fall', () => { falls++; });
    reg.on('flags', (f) => {
      for (const m of mechs) {
        if (!f[`switch.${m.id}`] || seen.has(`switch.${m.id}`)) continue;
        seen.add(`switch.${m.id}`);
        if (m.shortcut) addTo('shortcuts', key(m));
        if (m.lock) addTo('locks', key(m));
        if (m.request && SONG2[m.request]) {
          const id = SONG2[m.request];
          updateSave((s) => { s.requests = [...new Set([...s.requests, m.request])]; s.relics = [...new Set([...s.relics, id])]; });
          setWorld(`${m.request}.home`);
          f[id] = f[`world.${m.request}.home`] = true;
          reg.set('gift', { t: ctx.game.t, id, npc: null, from: m.pos });
          reg.set('flags', f);
        } else if (m.request) { // a request answered for an NPC elsewhere (kamen.brother: his brother's name on the Crown, told back in l1)
          setWorld(m.request);
          f[`world.${m.request}`] = true;
          reg.set('flags', f);
        }
      }
    });
    reg.on('end', (e) => {
      if (e !== 'goal') return;
      const breakable = new Set(mechs.filter((m) => m.kind === 'breakable').map((m) => m.id));
      const broken = Object.keys(flags).filter((k) => flags[k] && k.startsWith('broken.') && !breakable.has(k.slice(7))).map((k) => `${lv}.${k.slice(7)}`);
      noteRun(lv, { t: +ctx.game.t.toFixed(2), falls });
      if (broken.length) addTo('broken', ...broken);
    });
  },
};
