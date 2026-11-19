// Echoes: the Keepers' remembered words, a gold rune shard floating 1 m over each level.echoSlots [{id, pos}] (pos = ground).
// Sim: within MAGNET m of the hero's chest a shard drifts toward it; within PICK m it is caught. A caught echo counts once the hero
// has stood on ground GROUND_S s in a row (a fall first sends it home). Counting sets flag echo.<id>, registry 'echoes' = echoes
// known before (registry 'echoes.known' = ['l1.echo_wall', ...], handed in by hud.js via game.start; never read from storage here,
// so bot/test runs start from none) + new ones; player.js grows breath from it. Publishes 'echo' {t, id, level, key, n, line}
// (npc.js: the Keeper speaks the line; hud.js: save + journal; bot.js: log).
// Render: gold sliver + faint glow, bob and spin; an echo known from an earlier walk is dimmer; a caught one circles the hero.
import * as THREE from 'three';
import { glow } from './npc.js';
import { getSave } from '../core/save.js';

const MAGNET = 1.5, PICK = 0.8, PULL = 5, GROUND_S = 0.3, FLOAT = 1;
const GOLD = new THREE.Color('#f2c46a');
// R6 relics: an echoSlot with `relic` ('tale.N' | 'thread.<lv>') is caught the same way but is not an echo (no breath, own colour):
// a tale shard is pale ember, a cloak thread a loose blue-white strand. Known relics come from the save (core/save.js).
const RELIC_COL = { tale: new THREE.Color('#ff9a62'), thread: new THREE.Color('#cfe4ff') };
// Journal order = this order. Lines in the story's voice: the Keepers sang the mountain into the sky; runes are the stones' names;
// the wind is the mountain's breath; Orren tied the knot; remembering is waking.
export const LINES = {
  'l1.echo_wall': { en: 'Before the sky there was a mountain. We Keepers sang to it, and it rose to listen.', ru: 'До неба была гора. Мы, Хранители, пели ей, и она поднялась, чтобы слушать.' },
  'l1.echo_dash': { en: 'Every rune is a name. Call a stone by its name and it remembers what it was.', ru: 'Каждая руна — это имя. Назови камень по имени, и он вспомнит, кем был.' },
  'l1.echo_branch': { en: 'The song broke the mountain into islands, and each island kept one verse of it.', ru: 'Песня расколола гору на острова, и каждый остров сберёг один её куплет.' },
  'l1.echo_shrine': { en: 'We turned the shrines to the sunrise, so the stones would wake with the first light.', ru: 'Мы обратили святилища к восходу, чтобы камни просыпались с первым светом.' },
  'l1.echo_far': { en: 'Kamen had a brother stone. When the song broke, it rolled to the edge and waited there for its name.', ru: 'У Камня был брат-камень. Когда песня раскололась, он укатился на край и ждал там своего имени.' },
  'l1.echo_gap': { en: 'We left the far stones for those who would learn to fly. We were patient people.', ru: 'Дальние камни мы оставили тем, кто научится летать. Мы были терпеливым народом.' },
  'l2.echo_dash': { en: 'The wind is the mountain breathing. Where it blows, the old song is still moving.', ru: 'Ветер — это дыхание горы. Где он дует, старая песня ещё движется.' },
  'l2.echo_branch': { en: 'Some of us became wind, some became birds. Some of us only waited, and were tied.', ru: 'Кто-то из нас стал ветром, кто-то птицей. А кто-то просто ждал, и его связали.' },
  'l2.echo_wall': { en: 'We sealed the workshop when the singing grew quiet. Our chisels still hum in the dark.', ru: 'Мы запечатали мастерскую, когда пение стихло. Наши резцы до сих пор гудят во тьме.' },
  'l2.echo_shrine': { en: 'Breathe with the wind and you breathe with the mountain. That is all a Keeper ever was.', ru: 'Дыши с ветром, и ты дышишь с горой. Больше Хранитель никогда и не был.' },
  'l2.echo_dust': { en: 'Dust is only forgetting that settled. A stronger breath remembers further.', ru: 'Пыль — это всего лишь осевшее забвение. Дыхание сильнее помнит дальше.' },
  'l3.echo_bridge': { en: 'Orren feared the islands would drift apart and forget each other, one by one.', ru: 'Оррен боялся, что острова разойдутся и забудут друг друга, один за другим.' },
  'l3.echo_dash': { en: 'So he tied a knot in the sky: every stone, every gust, bound fast to the crown.', ru: 'И он завязал на небе узел: каждый камень, каждый порыв накрепко привязан к короне.' },
  'l3.echo_branch': { en: 'A thing that is bound cannot forget. But it cannot wake either. Only sleep and hold.', ru: 'Связанное не может забыть. Но и проснуться не может. Только спать и держать.' },
  'l3.echo_shrine': { en: 'Remembering is waking. You have carried our names this far. Now the mountain dreams again.', ru: 'Вспомнить значит проснуться. Ты пронёс наши имена так далеко. Теперь гора снова видит сны.' },
  'l3.echo_far': { en: 'Orren wrote his own name at the edge of the Crown, too far for any voice but a returning one.', ru: 'Оррен вырезал своё имя на краю Короны, слишком далеко для любого голоса, кроме вернувшегося.' },
};
// R6 relics (progress.js saves them; hud.js journal): the five-part tale of Orren, and three cloak threads.
export const RELIC_LINES = {
  'tale.1': { en: 'I. Orren was the youngest Keeper. He could not sing loud, so he learned to tie.', ru: 'I. Оррен был младшим из Хранителей. Он не умел петь громко, и потому научился вязать.' },
  'tale.2': { en: 'II. He tied the falling stones with cords of wind, and they stopped falling. Everyone thanked him.', ru: 'II. Он связал падающие камни верёвками ветра, и они перестали падать. Все благодарили его.' },
  'tale.3': { en: 'III. Then he tied the winds themselves, so they could not leave. The sky grew still and grey.', ru: 'III. Потом он связал и сами ветры, чтобы они не ушли. Небо стало тихим и серым.' },
  'tale.4': { en: 'IV. Sigh asked him to let one wind go. He said: if I loosen one, all of it falls.', ru: 'IV. Вздох попросила его отпустить хоть один ветер. Он сказал: ослаблю один, и рухнет всё.' },
  'tale.5': { en: 'V. At last he tied himself into the middle of the knot, so no one could undo it. His full name is the last cord.', ru: 'V. В конце он вплёл в середину узла самого себя, чтобы никто не мог его развязать. Его полное имя — последняя верёвка.' },
  'thread.l1': { en: 'A loose thread of the Keepers\' weave, caught on the far stone. The cloak takes it in.', ru: 'Свободная нить ткани Хранителей зацепилась за дальний камень. Плащ вбирает её.' },
  'thread.l2': { en: 'A second thread, still smelling of the workshop dust.', ru: 'Вторая нить, ещё пахнущая пылью мастерской.' },
  'thread.l3': { en: 'The third thread. The weave is whole enough to hold one more breath.', ru: 'Третья нить. Ткань уже достаточно цела, чтобы удержать ещё один вдох.' },
};
let E;
const _v = new THREE.Vector3();

export default {
  name: 'echo', order: 11, deps: ['level'], // after level (flags), before npc (the Keeper's bark starts the same step)
  init(ctx) {
    const reg = ctx.registry, data = reg.get('level')?.data, known = new Set([...(reg.get('echoes.known') ?? []), ...getSave().relics]);
    E = { list: [], found: known, groundT: 0, n: 0 };
    reg.set('echoes', [...known].filter((k) => !/^(tale|thread)\./.test(k)).length);
    for (const s of data?.echoSlots ?? []) {
      const key = s.relic ?? `${data.id}.${s.id}`, home = new THREE.Vector3(s.pos[0], s.pos[1] + FLOAT, s.pos[2]);
      const g = new THREE.Group(), was = known.has(key), col = s.relic ? RELIC_COL[s.relic.split('.')[0]] : GOLD;
      const sliver = new THREE.Mesh(new THREE.OctahedronGeometry(0.12).scale(0.6, 1.8, 0.25), new THREE.MeshBasicMaterial({ color: col, transparent: was, opacity: was ? 0.5 : 1 }));
      const halo = glow(col, 0.6, was ? 0.15 : 0.35); // a faint glow on the shard itself, no glyph plane (read as a floating icon from afar)
      sliver.layers.set(1);
      g.add(sliver, halo);
      g.position.copy(home);
      ctx.add(g);
      E.list.push({ id: s.id, key, relic: s.relic ?? null, home, pos: home.clone(), state: 'free', g, gotT: 0 });
    }
    reg.on('player.fall', () => { for (const e of E.list) if (e.state === 'held') { e.state = 'free'; e.pos.copy(e.home); } E.groundT = 0; });
  },
  update(ctx, dt) {
    const reg = ctx.registry, p = reg.get('player');
    if (!p || !E.list.length) return;
    const chest = new THREE.Vector3(p.pos.x, p.pos.y + 0.9, p.pos.z);
    let held = 0;
    for (const e of E.list) {
      if (e.state === 'free') {
        const d = e.pos.distanceTo(chest);
        if (d < PICK) { e.state = 'held'; reg.set('audio.cue', { name: 'echo' }); }
        else if (d < MAGNET) e.pos.addScaledVector(_v.subVectors(chest, e.pos).normalize(), Math.min(d, PULL * dt));
      }
      if (e.state === 'held') held++;
    }
    E.groundT = held && p.grounded ? E.groundT + dt : 0;
    if (E.groundT < GROUND_S - 1e-9) return;
    const flags = reg.get('flags');
    for (const e of E.list) {
      if (e.state !== 'held') continue;
      e.state = 'got'; e.gotT = ctx.game.t; E.n++;
      flags[`echo.${e.id}`] = true;
      E.found.add(e.key);
      reg.set('flags', flags);
      reg.set('echoes', [...E.found].filter((k) => !/^(tale|thread)\./.test(k)).length);
      reg.set('audio.cue', { name: 'echo_got' });
      reg.set('echo', { t: +ctx.game.t.toFixed(3), id: e.id, level: reg.get('level').data.id, key: e.key, relic: e.relic, n: E.n, line: LINES[e.key] ?? RELIC_LINES[e.key] ?? null });
    }
    E.groundT = 0;
  },
  beforeRender(ctx) {
    const t = ctx.game.t, p = ctx.registry.get('player');
    let k = 0;
    for (const e of E.list) {
      if (e.state === 'got') { const u = Math.min(1, (t - e.gotT) / 0.5); e.g.scale.setScalar(1 - u); e.g.position.y += 0.03; e.g.visible = u < 1; continue; }
      if (e.state === 'held' && p) { // circles the hero's head until it counts
        const a = t * 3 + k++ * 2.1;
        e.g.position.set(p.pos.x + 0.55 * Math.sin(a), p.pos.y + 1.9 + 0.08 * Math.sin(t * 5), p.pos.z + 0.55 * Math.cos(a));
        e.g.scale.setScalar(0.6);
      } else { e.g.position.copy(e.pos); e.g.position.y += 0.12 * Math.sin(t * 1.8 + e.home.x); e.g.scale.setScalar(1); }
      e.g.rotation.y = t * 1.2 + e.home.z;
    }
  },
};
