// Shows registry 'hud.hint' text (shrine inscriptions, lore only) for a few sim-seconds. Outside test/bot runs it also owns the screen flow and the menus (DOM overlay):
//   boot -> title (live l1 backdrop, cutscene.js orbits the camera: 'menu.orbit'): Continue / New / Level select / Settings / Journal /
//   Credits -> loading card on the veil (numeral, title, one Echo line, held >= LOAD_MIN_MS) -> intro cutscene (first time only) ->
//   play (nameplate top-left PLATE_MS) -> pause (Esc / P / Start / pointer-lock loss): Resume / Settings / Journal / Restart /
//   Checkpoint / Quit -> goal: results card -> Continue: the level's outro cutscene -> loading card -> next level; after l3 the finale
//   cutscene -> ending text (+ a line when all 12 echoes are found) -> credits -> title. Retry / restart / level select never play one.
// Menus: pages of the Keeper's journal (one parchment panel in the left third over the live scene, blurred while paused; the art
// is inline SVG from menuart.js): level select = a map of the islands, journal and settings = tabbed pages, results = stamp, shards
// and wax seals. Gold marks focus only. Keyboard (arrows / Enter / Esc), mouse (hover
// focuses) and gamepad (own poll, runs while paused: d-pad / left stick, A, B, Start) move the focus; 'ui_click' cue on focus and on
// activate (audio.js clicks every button press). Left / right change the focused option or slider.
// R held 0.5 s = restart. Respawn = short veil flash. Level switches keep the new level paused behind the veil until it is warmed up.
// The DOM and key handlers persist across levels (this system is re-initialised per level); `cur` points at the live level.
// Subtitles: 'talk.line' {who, text, dur} (npc.js, cutscene.js) shows a box at the bottom (speaker in gold); inside the letterbox
// during a cutscene. null hides it.
// tr({en, ru} | string): the text in the player's language (settings.lang: ?lang=, else stored, else navigator), English as fallback.
// Run clock (settings.timer): mm:ss.cs per level, from the first input; paused sim = stopped clock. Results card: time, best (+ new),
// echoes as shards, falls, the challenge seals, then target (bot time - 10 %), delta and the assist flag -> Continue / Retry / Select.
// Saves (never in test/bot runs): localStorage 'sw.echoes' = found echo keys (handed to game.start, echo.js), 'sw.best' = {level: s},
// 'sw.progress' = the level Continue opens, 'skywanderer.seen.v1' = cutscenes seen ('l1.intro', ...; the journal replays them).
import { LINES, RELIC_LINES } from './echo.js';
import { getSave, updateSave, harmony, endingFor, setEnding, tales, TALES } from '../core/save.js';
import { ico, wordmark, island, shard, lock, knot, seal, stamp, echoArt, taleArt, songArt, pose, DEFS } from './menuart.js';
import * as meta from './meta.js'; // R10: challenges, achievements, loom, daily trial (menus)
import { disarm as disarmDaily } from './daily.js';
import { touchEnter } from './touch.js'; // phones: fullscreen + landscape on the first journey tap

const END_S = 1.5, SHOW_S = 4, HOLD_R_MS = 500, LOAD_MIN_MS = 1200, PLATE_MS = 2000, PAD_REPEAT = [0.38, 0.13]; // s results delay after the goal touch, s, ms, ms, ms, s first / next
const TEXT_SIZE = { S: 1.1, M: 1.25, L: 1.5 }; // CSS zoom on the HUD text (M reads ~20 px hints at 1080p)
let el, hideAt, ui, cur, sub;
export let LANG = /^ru/i.test(new URLSearchParams(globalThis.location?.search ?? '').get('lang') ?? globalThis.navigator?.language ?? '') ? 'ru' : 'en';
export const tr = (s) => (s == null || typeof s === 'string' ? s ?? '' : s[LANG] ?? s.en ?? '');
function applyUi(s) { // language + text size, live
  LANG = s.lang === 'ru' ? 'ru' : 'en';
  document.documentElement.lang = LANG;
  const compact = innerHeight < 520 && (ui?.device === 'touch' || document.body.classList.contains('touch') || matchMedia('(pointer: coarse)').matches); // a phone held sideways: menus one step smaller
  document.documentElement.classList.toggle('compact', compact);
  document.documentElement.style.setProperty('--ts', (TEXT_SIZE[s.textSize] ?? 1) * (compact ? 0.8 : 1));
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtCs = (s) => { const c = Math.floor(s * 100); return `${String(Math.floor(c / 6000)).padStart(2, '0')}:${String(Math.floor(c / 100) % 60).padStart(2, '0')}.${String(c % 100).padStart(2, '0')}`; };
const L = (en, ru) => tr({ en, ru });
const SAVED = { 'sw.echoes': 'echoes', 'sw.gifts': 'gifts', 'sw.best': 'best', 'sw.progress': 'progress' }; // R6: these live in core/save.js (sw.save.v2)
const store = { // saves are optional (private windows throw)
  get(k, d) { if (SAVED[k]) return structuredClone(getSave()[SAVED[k]] ?? d); try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { if (SAVED[k]) { updateSave((s) => { s[SAVED[k]] = v; }); return; } try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* not saved */ } },
};
const LEVELS = [
  { id: 'l1', n: 'I', title: { en: 'Waking Stones', ru: 'Пробуждение камней' }, sub: { en: 'The Keepers\' sleeping quarry. The stones still know their names.', ru: 'Спящая каменоломня Хранителей. Камни ещё помнят свои имена.' }, bot: 65 },
  { id: 'l2', n: 'II', title: { en: 'Wind Totems', ru: 'Тотемы ветра' }, sub: { en: 'Orren\'s workshop, where the winds were bound to totems.', ru: 'Мастерская Оррена, где ветры привязали к тотемам.' }, bot: 80 },
  { id: 'l3', n: 'III', title: { en: 'Crown of Winds', ru: 'Корона ветров' }, sub: { en: 'The knot itself, at the top of the sky.', ru: 'Сам узел, на вершине неба.' }, bot: 110 },
]; // bot = the playtest bot's time (s); target = bot - 10 %
const SCENES = [ // journal replay order (level.json cutscenes)
  { id: 'l1.intro', title: { en: 'The hollow stone', ru: 'Полый камень' } },
  { id: 'l1.outro', title: { en: 'Names remembered', ru: 'Вспомненные имена' } },
  { id: 'l2.arrive', title: { en: 'The wind road', ru: 'Дорога ветра' } },
  { id: 'l2.outro', title: { en: 'Toward the Crown', ru: 'К Короне' } },
  { id: 'l3.arrive', title: { en: 'On the Kestrel\'s wind', ru: 'На ветре Пустельги' } },
  { id: 'l3.finale', title: { en: 'The knot loosens', ru: 'Узел развязан' } },
  { id: 'l3.finale_bad', title: { en: 'The grey dawn', ru: 'Серый рассвет' } },
  { id: 'l3.finale_true', title: { en: 'Orren, named', ru: 'Оррен, названный' } },
];
const QUESTS = [ // journal 'Requests': the NPC asks that give gifts (npc.js); done = the gift saved in 'sw.gifts'; n = flag prefix counted live
  { lv: 'l1', gift: 'dash', n: 'npc.pebble.', of: 3, met: ['seen.t_call', 'npc.pebble.1', 'npc.pebble.2', 'npc.pebble.3'], text: { en: 'Kamen: sing to the three name-stones', ru: 'Камень: спой трём камням-именам' } },
  { lv: 'l2', gift: 'windbreath', n: 'npc.sigh.', of: 1, text: { en: 'Sigh: wake the first totem', ru: 'Вздох: разбуди первый тотем' } },
  { lv: 'l2', gift: 'airdash', n: 'npc.kestrel.', of: 2, text: { en: 'Kestrel: sing both cord anchors loose', ru: 'Пустельга: спой обоим якорям верёвок' } },
];
const ASKS2 = [ // R6 request stones (progress.js): sung, the asker's song grows (Song II); open once that level is reached
  { lv: 'l1', id: 'kamen', text: { en: 'Kamen: find the name-stone he lost past the quarry', ru: 'Камень: найди потерянный камень-имя за каменоломней' } },
  { lv: 'l2', id: 'sigh', text: { en: 'Sigh: sing back the breath she left on the far islet', ru: 'Вздох: верни песней дыхание, оставленное на дальнем островке' } },
];
const SONGS = [ // journal 'Songs': the gift songs held (R2; player.js casts them, level.js resolves them)
  { id: 'gust', key: '1', text: { en: 'Gust (the stone with the carved wind): hold to gather it, let go: three swells, each blows further and harder; held too long, the wind tears. Clears dust, wakes still winds, shoves a Squall back. Caught as it gathers itself, the Squall hangs open; a second Gust then blows it off the island', ru: 'Порыв (камень с высеченным ветром): держи, чтобы набрать, и отпусти: три волны, каждая бьёт дальше и сильнее; передержишь — ветер рвётся. Сдувает пыль, будит застывший ветер, отбрасывает Шквал. Пойманный, пока копит силу, Шквал раскрывается; второй Порыв сдувает его с острова' } },
  { id: 'name', key: '2', text: { en: 'Name (the stone with the carved ribbons): a tap is enough up close; held, it carries further, and at full swell it frees every opened Shard in reach. Wakes a far rune (one wrapped in a whirl waits for its elder), frees an opened Knot Shard, mends a cracked post from its far side', ru: 'Имя (камень с высеченными лентами): вблизи хватит короткой ноты; чем дольше держишь, тем дальше летит, а на полной волне освобождает все раскрытые Осколки вокруг. Будит дальнюю руну (обвитая вихрем ждёт старшую), освобождает раскрытый Осколок Узла, чинит треснувшую опору с дальней стороны' } },
  { id: 'anchor', key: '3', text: { en: 'Anchor (the stone with the carved chains): the longer the swell, the longer it holds. Stills a crumbling slab, a bridge, a lift or a falling stone; chokes a Squall that drinks the air', ru: 'Якорь (камень с высеченными цепями): чем дольше волна, тем дольше держит. Останавливает осыпь, мост, подъёмник или падающий камень; душит Шквал, что тянет воздух' } },
];
const NEED_DASH = { gift: 'dash', text: { en: 'needs the dash', ru: 'нужен рывок' } }; // echoes past a dash gap: out of reach without Kamen's gift
const NEEDS = { 'l1.echo_branch': NEED_DASH, 'l1.echo_shrine': NEED_DASH };
const level = (id) => LEVELS.find((l) => l.id === id);
const found = () => store.get('sw.echoes', []);
const seen = () => store.get('skywanderer.seen.v1', []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lockPointer = () => { if (cur.game.settings.cameraMode === 'free') try { cur.game.renderer.domElement.requestPointerLock()?.catch?.(() => {}); } catch { /* optional */ } };
const mk = (tag, cls, text) => Object.assign(document.createElement(tag), cls ? { className: cls } : {}, text != null ? { textContent: text } : {});

function fade(on, ms) { // veil to/from cream
  ui.veil.style.transitionDuration = `${ms}ms`;
  ui.veil.classList.toggle('on', on);
  return sleep(ms);
}

// ---- panel + navigation ----
// buttons: [label, fn, disabled?, icon?, half?] (icon: menuart.js ico; half = a tile, two per row). back: Esc / gamepad B.
// extra: element(s) placed above the buttons; an element with [data-first] in it takes the first focus.
const WIDE = ['select'], SHARP = ['title', 'results', 'end', 'credits', 'error']; // SHARP: never blur the scene behind
function setPanel(mode, html, buttons, extra, back = null) {
  ui.panel?.remove();
  ui.mode = mode; ui.back = back;
  const p = ui.panel = mk('div', `hud-panel${WIDE.includes(mode) ? ' wide' : ''}`);
  p.innerHTML = html;
  const box = mk('div', 'hud-buttons'), halves = [];
  for (const [label, fn, off, icon, half] of buttons) {
    const b = Object.assign(mk('button', half ? 'half' : null), { onclick: fn, disabled: !!off });
    b.innerHTML = icon ? ico(icon) : '';
    b.append(mk('span', null, label));
    if (half) (halves.length && halves.at(-1).length < 2 ? halves.at(-1) : halves[halves.push([]) - 1]).push(b);
    box.append(b);
  }
  gridNav(halves.map((r) => r.filter((b) => !b.disabled)).filter((r) => r.length));
  p.append(...[extra ?? []].flat(), box);
  document.body.append(p);
  document.body.classList.toggle('hud-blur', !SHARP.includes(mode) && !cur.reg.get('menu.orbit'));
  quietFocus(p.querySelector('[data-first]') ?? box.querySelector('button:not(:disabled)'));
  return p;
}
function clearPanel() { ui.panel?.remove(); ui.panel = null; ui.mode = 'none'; ui.back = null; document.body.classList.remove('hud-blur'); }
// Rows of buttons as a grid: left / right along the row, up / down to the row above / below (same column), past the ends to the neighbour in page order.
function gridNav(rows) {
  rows.forEach((row, r) => row.forEach((b, c) => {
    b.cycle = (d) => row[(c + d + row.length) % row.length].focus();
    b.step = (d) => { const t = rows[r + d], f = focusables(); (t ? t[Math.min(c, t.length - 1)] : f.at((f.indexOf(d > 0 ? row.at(-1) : row[0]) + d) % f.length))?.focus(); return true; };
  }));
}
function tabRow(defs, on, pick) { // [id, icon, label]: left / right turn the page, down enters it
  const tabs = mk('div', 'hud-tabs');
  defs.forEach(([id, icon, label], i) => {
    const b = mk('button', id === on ? 'on' : '');
    b.innerHTML = ico(icon); b.append(mk('span', null, label));
    b.onclick = () => pick(id);
    b.cycle = (d) => pick(defs[(i + d + defs.length) % defs.length][0]);
    b.step = (d) => { if (d < 0) return false; const f = focusables(); f[f.indexOf(tabs.lastChild) + 1]?.focus(); return true; };
    if (id === on) b.dataset.first = '';
    tabs.append(b);
  });
  return tabs;
}
const focusables = () => (ui.panel ? [...ui.panel.querySelectorAll('button:not(:disabled), input')] : []);
function quietFocus(e) { if (!e) return; ui.quiet = true; e.focus({ preventScroll: false }); ui.quiet = false; }
function nav(d) {
  const f = focusables(), i = f.indexOf(document.activeElement);
  if (!f.length || (d && typeof f[i]?.step === 'function' && f[i].step(d))) return; // a card grid moves by rows (meta.js)
  f[i < 0 ? 0 : (i + d + f.length) % f.length].focus();
}
function adjust(d) { // left / right on an option or a slider
  const e = document.activeElement;
  if (!ui.panel?.contains(e)) return false;
  if (e.cycle) { e.cycle(d); return true; }
  if (e.type === 'range') { e.value = +e.value + d * +e.step; e.dispatchEvent(new Event('input')); cue(); return true; }
  return false;
}
const cue = () => cur?.reg.set('audio.cue', { name: 'hover', gain: 0.6 }); // focus moved (mouse hover focuses too): a soft tick
function activate() { const e = document.activeElement; if (ui.panel?.contains(e) && e.tagName === 'BUTTON') e.click(); else nav(0); }

// ---- cards ----
function plate(lv) { // nameplate top-left for PLATE_MS
  ui.plate.replaceChildren(mk('b', null, lv.n), mk('span', null, tr(lv.title)));
  ui.plate.classList.add('on');
  clearTimeout(ui.plateT);
  ui.plateT = setTimeout(() => ui.plate.classList.remove('on'), PLATE_MS);
}
function loadCard(lv) { // on the veil: the island, numeral, title, what the island is, one of the level's echo lines (a found one first), its challenges
  const keys = Object.keys(LINES).filter((k) => k.startsWith(`${lv.id}.`)), have = keys.filter((k) => found().includes(k));
  const pool = have.length ? have : keys, line = LINES[pool[Math.floor(Math.random() * pool.length)]]; // UI only, never the sim
  ui.load.innerHTML = island(lv.id, lv.id === 'l3' ? getSave().ending.best : null);
  ui.load.append(mk('b', null, lv.n), mk('h2', null, tr(lv.title)), mk('p', null, tr(lv.sub)), ...(line ? [mk('i', null, `“${tr(line)}”`)] : []), meta.challengeList(lv.id, mk));
  ui.load.insertAdjacentHTML('beforeend', wordmark(LANG));
  ui.load.classList.add('on');
}

// ---- level switch ----
// Keeps the new level paused and the veil up until it is fully loaded and warmed up. card: loading card; cut: a cutscene of the new
// level to play before control returns; title: show the title over it instead of playing.
async function goTo(levelId, { checkpoint, outMs = 1000, inMs = 800, card = false, reset = false, cut = null, title = false, then = null } = {}) {
  if (ui.busy) return;
  ui.busy = true; ui.titled = false;
  const { game } = cur, lv = level(levelId);
  clearPanel();
  ui.timer.style.display = 'none';
  if (!title) touchEnter();
  if (!title && !cut) lockPointer(); // before any await: the lock needs the click's user gesture (input.js retries on the next click)
  game.registry.set('paused', true);
  try {
    await fade(true, outMs);
    if (reset) ui.stats = { falls: 0, time: 0 };
    ui.endAt = null;
    if (!checkpoint) ui.lv = { t: 0, on: false, falls: 0 }; // a fresh walk of the level: the clock waits for the first input
    if (card && lv) loadCard(lv);
    await Promise.all([game.start(levelId, { checkpoint, echoes: found(), gifts: store.get('sw.gifts', []) }), card && lv ? sleep(LOAD_MIN_MS) : null]);
    ui.load.classList.remove('on');
    if (title) { showTitle(); await fade(false, inMs); return; }
    if (!then && lv) store.set('sw.progress', levelId);
    if (cut && cur.reg.get('level')?.data.cutscenes?.[cut]) {
      const done = fade(false, inMs);
      const played = playCut(cut);
      await done;
      ui.busy = false; // the cutscene runs on its own; the flow continues when it ends
      await played;
      if (then) return then();
    }
    clearPanel();
    game.registry.set('paused', false);
    const done = fade(false, inMs);
    if (card && lv) plate(lv);
    await done;
  } catch (e) { // stay paused behind a retry panel instead of a stuck veil
    console.error('[hud] level load failed', e);
    ui.load.classList.remove('on');
    fade(false, 200);
    setPanel('error', `<h1>${L('Could not load the level', 'Не удалось загрузить уровень')}</h1><p>${String(e?.message ?? e).replace(/[<&]/g, ' ')}</p>`, [
      [L('Retry', 'Ещё раз'), () => { ui.busy = false; goTo(levelId, { checkpoint, outMs, inMs, card, reset }); }],
      [L('Quit to title', 'Выйти в меню'), () => { ui.busy = false; quitToTitle(); }],
    ]);
  } finally { ui.busy = false; }
}

// Plays a cutscene of the live level (cutscene.js); resolves when it ends or is skipped, false when the level has none.
function playCut(name) {
  const reg = cur.reg, id = `${cur.game.levelId}.${name}`;
  if (!reg.get('level')?.data.cutscenes?.[name]) return Promise.resolve(false);
  clearPanel();
  ui.mode = 'cut';
  ui.timer.style.display = 'none';
  try { document.exitPointerLock(); } catch { /* not locked */ }
  return new Promise((res) => {
    const off = reg.on('cut.done', () => {
      off();
      store.set('skywanderer.seen.v1', [...new Set([...seen(), id])]);
      if (ui.mode === 'cut') ui.mode = 'none';
      res(true);
    });
    reg.set('cut.play', name);
    if (!reg.get('cut.active')) { off(); ui.mode = 'none'; res(false); } // cutscene system missing: carry on
  });
}

const restart = (checkpoint) => goTo(cur.game.levelId, { checkpoint, outMs: 350, inMs: 350 });
const quitToTitle = () => goTo('l1', { title: true, outMs: 500, inMs: 600 });

function openPause() {
  if (ui.busy || ui.mode !== 'none') return;
  cur.reg.set('paused', true);
  try { document.exitPointerLock(); } catch { /* not locked */ }
  showPause();
}
function showPause() { // the live scene out of focus (body.hud-blur, setPanel) behind the page
  const cp = cur.reg.get('checkpoint');
  setPanel('pause', `${wordmark(LANG, null, 'sm')}<h1>${L('Paused', 'Пауза')}</h1>`, [
    [L('Resume', 'Продолжить'), resume, false, 'play'],
    [L('Settings', 'Настройки'), () => showSettings(showPause), false, 'gear'],
    [L('Journal', 'Журнал'), () => showJournal(showPause), false, 'book'],
    [L('Scenes', 'Сцены'), () => showScenes(showPause), false, 'scene'],
    [L('Restart level', 'Начать уровень заново'), () => restart(), false, 'loop'],
    [L('Last checkpoint', 'С контрольной точки'), () => restart(cp), !cp, 'flag'],
    [L('Quit to title', 'Выйти в меню'), quitToTitle, false, 'door'],
  ], null, resume);
}
function showScenes(back) { // the cutscene gallery: seen scenes replay (reloads that level, then the title); unseen = a locked tile, no title
  const saw = seen();
  setPanel('scenes', `<h1>${L('Scenes', 'Сцены')} <small class="hud-note">${SCENES.filter((c) => saw.includes(c.id)).length}/${SCENES.length}</small></h1>`, [
    ...SCENES.map((c) => saw.includes(c.id) ? [tr(c.title), () => { const [lid, name] = c.id.split('.'); goTo(lid, { card: true, cut: name, then: quitToTitle }); }, false, 'scene', true] : ['? ? ?', null, true, 'scene', true]),
    [L('Back', 'Назад'), back, false, 'back'],
  ], null, back);
}
function resume() { clearPanel(); cur.reg.set('paused', false); lockPointer(); }

const metaUi = () => ({ setPanel, mk, goTo, focus: quietFocus, reg: () => cur?.reg }); // R10 meta.js panels
function showTitle() {
  disarmDaily();
  ui.timer.style.display = 'none';
  cur.reg.set('paused', true);
  cur.reg.set('menu.orbit', true);
  const prog = store.get('sw.progress', null), best = store.get('sw.best', {}), first = !ui.titled;
  ui.titled = true; // the wordmark is drawn in once per visit to the title (goTo resets it)
  setPanel('title', `${wordmark(LANG, first ? 'live' : 'loose')}<p class="hud-tag"><i>${getSave().ending.best === 'true' ? L('The mountain is awake. Orren keeps the winds now, untied, and the islands drift closer every dawn.', // R8: the title remembers the true ending
    'Гора проснулась. Оррен теперь хранит ветры, не связывая их, и с каждым рассветом острова ближе.') : L('Long ago the Keepers sang a mountain into the sky. Its stones still sleep, and the wind still carries their names.',
    'Давным-давно Хранители песней подняли гору в небо. Её камни всё ещё спят, а ветер всё ещё носит их имена.')}</i></p>`, [
    ...(level(prog) ? [[`${L('Continue', 'Продолжить')} · ${level(prog).n}`, () => goTo(prog, { reset: true, card: true }), false, 'play']] : []),
    [L('New journey', 'Новый путь'), () => (store.set('sw.gifts', []), updateSave((s) => { s.shortcuts = []; }), goTo('l1', { reset: true, card: true, cut: seen().includes('l1.intro') ? null : 'intro' })), false, 'sprout'], // a new journey earns the gifts again (echoes, seeds, wardrobe stay)
    [L('Select level', 'Выбор уровня'), () => showSelect(showTitle), !Object.keys(best).length, 'map', true],
    [L('Journal', 'Журнал'), () => showJournal(showTitle), false, 'book', true],
    [L('Daily trial', 'Испытание дня'), () => meta.showDaily(metaUi(), showTitle, LEVELS), false, 'sun', true],
    [L('Keeper\'s Loom', 'Стан Хранителей'), () => meta.showLoom(metaUi(), showTitle), false, 'loom', true],
    [L('Scenes', 'Сцены'), () => showScenes(showTitle), false, 'scene', true],
    [L('Settings', 'Настройки'), () => showSettings(showTitle), false, 'gear', true],
    [L('Credits', 'Авторы'), () => showCredits(showTitle), false, 'quill', true],
    SUPPORT(), // U24
  ]);
  for (const a of ui.panel.querySelectorAll('animate')) a.beginElementAt(2.2); // the knot loosens once the letters are inked
}

const LOCKS = { l1: ['lockA'], l2: ['lockN', 'lockD'], l3: ['lockO'] }; // level.json mechanisms saved in save.locks once opened
const MAP_SKY = '<svg viewBox="0 0 300 120" preserveAspectRatio="none" aria-hidden="true"><g fill="#fff" opacity=".75"><ellipse cx="44" cy="24" rx="28" ry="5"/><ellipse cx="62" cy="19" rx="16" ry="5"/><ellipse cx="150" cy="13" rx="22" ry="4"/><ellipse cx="236" cy="100" rx="30" ry="5"/><ellipse cx="118" cy="108" rx="20" ry="4"/></g><path d="M52 84C84 66 112 80 150 64S220 54 250 40" fill="none" stroke="#b5452f" stroke-width="1.3" stroke-dasharray="5 4" vector-effect="non-scaling-stroke"/></svg>';
// The islands as a painted map rising to the Crown. On each: its echoes as shards (lit = found), its locks (open = gold), its requests
// as knots (undone = granted). Walked islands (a best time saved) can be entered; the rest stay in the haze. The Crown is dark until
// the true ending (gold), grey after a lesser one; after any ending l3 reads 'Return to the Crown'.
function showSelect(back) {
  const best = store.get('sw.best', {}), sv = getSave(), have = found(), end = sv.ending.best, gifts = store.get('sw.gifts', []);
  disarmDaily();
  const map = mk('div', 'hud-map'), cap = mk('div', 'hud-cap'), row = [];
  map.innerHTML = MAP_SKY;
  for (const l of LEVELS) {
    const open = best[l.id] != null, b = mk('button');
    const marks = Object.keys(LINES).filter((k) => k.startsWith(`${l.id}.`)).map((k) => shard(have.includes(k))).join('') + LOCKS[l.id].map((k) => lock(sv.locks.includes(`${l.id}.${k}`))).join('')
      + [...ASKS2.filter((q) => q.lv === l.id).map((q) => sv.requests.includes(q.id)), ...QUESTS.filter((q) => q.lv === l.id).map((q) => gifts.includes(q.gift))].map(knot).join('');
    b.innerHTML = `${island(l.id, l.id === 'l3' ? end : null)}<span class="hud-marks">${open ? marks : ''}</span>`;
    b.append(mk('span', null, open ? `${l.id === 'l3' && end ? L('Return to the Crown', 'Вернуться к Короне') : `${l.n} · ${tr(l.title)}`} · ${fmtCs(best[l.id])}` : l.n));
    b.disabled = !open;
    b.onclick = () => goTo(l.id, { reset: true, card: true, outMs: 400 });
    b.addEventListener('focus', () => cap.replaceChildren(mk('b', null, `${l.n} · ${tr(l.title)}`), mk('p', 'hud-note', `${tr(l.sub)} ${L('Falls', 'Падения')}: ${sv.falls[l.id] ?? 0}.`), meta.challengeList(l.id, mk)));
    if (open) row.push(b);
    map.append(b);
  }
  if (row[0]) row[0].dataset.first = '';
  gridNav([row]);
  setPanel('select', `<h1>${L('Select level', 'Выбор уровня')}</h1>`, [[L('Back', 'Назад'), back, false, 'back']], [map, cap], back);
}

// The journal's pages: echoes (a drawing each, inked once found), the tale of Orren (illuminated panels), requests (knots, undone once
// granted), the songs held (their marks), the cloak's weave, and from the title the scenes seen (a replay reloads that level).
let jTab = 'echoes';
function showJournal(back, tab = jTab) {
  const have = new Set(found()), fromTitle = back === showTitle, saw = seen(), sv = getSave();
  const flags = fromTitle ? {} : cur.reg.get('flags') ?? {}, gifts = new Set([...store.get('sw.gifts', []), ...Object.keys(flags).filter((f) => flags[f] && f.startsWith('gift.')).map((f) => f.slice(5))]);
  const reached = LEVELS.findIndex((l) => l.id === (fromTitle ? store.get('sw.progress', 'l1') : cur.reg.get('level')?.data.id));
  const scenes = fromTitle ? SCENES.filter((s) => saw.includes(s.id)) : [];
  const TABS = [['echoes', 'shard', L('Echoes', 'Эхо')], ['tale', 'scroll', L('Tale', 'Сказка')], ['asks', 'knot', L('Requests', 'Просьбы')], ['songs', 'note', L('Songs', 'Песни')], ['weave', 'weave', L('Weave', 'Узор')], ...(scenes.length ? [['scenes', 'scene', L('Scenes', 'Сцены')]] : [])];
  if (!TABS.some((t) => t[0] === tab)) tab = 'echoes';
  jTab = tab;
  const page = mk('div', 'hud-page'), cap = mk('p', 'hud-cap'), rows = [];
  const cards = (head, cls, list) => { // [art, text, on, lit]: a row of drawings; the focused one's words show below
    const g = mk('div', `hud-cards ${cls}`), row = list.map(([art, text, on, lit]) => {
      const b = mk('button', on ? '' : 'no');
      b.innerHTML = art;
      b.addEventListener('focus', () => { cap.className = `hud-cap${on ? '' : ' no'}${on && lit ? ' lit' : ''}`; cap.textContent = text; });
      b.onclick = () => on && cur.reg.set('audio.cue', { name: 'echo_got', gain: 0.4 });
      return b;
    });
    g.append(...row); page.append(mk('h2', null, head), g); rows.push(row);
  };
  if (tab === 'echoes') {
    for (const lv of LEVELS) cards(`${lv.n} · ${tr(lv.title)}`, '', Object.keys(LINES).filter((k) => k.startsWith(`${lv.id}.`)).map((k) => {
      const need = !have.has(k) && NEEDS[k] && !gifts.has(NEEDS[k].gift);
      return [echoArt(k), have.has(k) ? `“${tr(LINES[k])}”` : need ? `… (${tr(NEEDS[k].text)})` : '…', have.has(k)];
    }));
  } else if (tab === 'tale') { // R6: the tale of Orren, in order; missing parts stay blank
    cards(L('The tale of Orren', 'Сказка об Оррене'), 'five', Object.keys(RELIC_LINES).filter((k) => k.startsWith('tale.')).map((k, n) => [taleArt(n, sv.relics.includes(k)), sv.relics.includes(k) ? tr(RELIC_LINES[k]).replace(/^[IVX]+\.\s*/, '') : '…', sv.relics.includes(k), true]));
  } else if (tab === 'songs') { // the gift songs held (R2); the mark is the shape on the song's targets and the cloak (songs.js GLYPH)
    cards(L('Songs (1 breath when it takes)', 'Песни (1 дыхание, если удалась)'), 'five', SONGS.map((g) => [songArt(g.id), gifts.has(g.id) ? `${g.key} · ${tr(g.text)}` : '…', gifts.has(g.id)]));
  } else if (tab === 'asks') { // open requests: asked in person (met), or the level reached
    const asks = QUESTS.filter((q) => { const lv = LEVELS.findIndex((l) => l.id === q.lv); return gifts.has(q.gift) || lv < reached || (lv === reached && (!q.met || q.met.some((f) => flags[f]))); });
    const asks2 = ASKS2.filter((q) => sv.requests.includes(q.id) || LEVELS.findIndex((l) => l.id === q.lv) <= reached), ul = mk('ul', 'hud-list');
    const li = (done, text) => { const e = mk('li', done ? '' : 'no'); e.innerHTML = knot(done); e.append(mk('span', null, text)); ul.append(e); };
    for (const q of asks2) li(sv.requests.includes(q.id), tr(q.text));
    for (const q of asks) {
      const done = gifts.has(q.gift), n = Object.keys(flags).filter((f) => flags[f] && f.startsWith(q.n) && /^\d+$/.test(f.slice(q.n.length))).length;
      li(done, `${tr(q.text)}${done ? '' : n ? ` ${n}/${q.of}` : ''}`);
    }
    page.append(mk('h2', null, L('Requests', 'Просьбы')), ul.children.length ? ul : mk('p', 'hud-note', L('No one has asked for anything yet.', 'Пока никто ни о чём не просил.')));
  } else if (tab === 'weave') { // R8: the mountain's memory (harmony) as the cloak's weave, never a number
    const w = mk('div', 'hud-weave'); w.append(weave()); page.append(w);
  } else {
    page.classList.add('hud-form');
    for (const s of scenes) {
      const b = mk('button', 'hud-opt'); b.innerHTML = ico('scene'); b.append(mk('span', null, tr(s.title)));
      b.style.justifyContent = 'flex-start';
      b.onclick = () => { const [lid, name] = s.id.split('.'); goTo(lid, { card: true, cut: name, then: quitToTitle }); };
      page.append(b);
    }
  }
  if (rows.length) { page.append(cap); gridNav(rows); }
  const again = () => showJournal(back);
  setPanel('journal', `<h1>${L('Journal', 'Журнал')} <small class="hud-note">· ${L('Echoes', 'Эхо')} ${have.size}/${Object.keys(LINES).length}</small></h1>`, [
    [L('Achievements', 'Достижения'), () => meta.showAchievements(metaUi(), again), false, 'badge', true],
    [L('Keeper\'s Loom', 'Стан Хранителей'), () => meta.showLoom(metaUi(), again), false, 'loom', true],
    [L('Back', 'Назад'), back, false, 'back'],
  ], [tabRow(TABS, tab, (id) => showJournal(back, id)), page], back);
  rows[0]?.find((b) => !b.classList.contains('no'))?.dispatchEvent(new Event('focus')); // the caption opens on the first found drawing
}

// The cloak's weave: harmony (core/save.js) woven left to right, row by row; the rest hangs as loose warp. No number, no label.
function weave() {
  const h = harmony(), f = Math.max(0, Math.min(1, h.score / h.max)), W = 12, H = 6, cell = 14, woven = Math.round(f * W * H), el = mk('div');
  let d = '', g = '', loose = '';
  for (let x = 0; x < W; x++) d += `M${x * cell + 7} 4V${H * cell + 4}`;
  for (let i = 0; i < W * H; i++) {
    const r = Math.floor(i / W), c = r % 2 ? W - 1 - i % W : i % W, x = c * cell, y = r * cell + 11, over = (c + r) % 2;
    if (i < woven) g += `<path d="M${x} ${y}h${cell}" stroke-width="${over ? 4.2 : 2.4}" opacity="${over ? 1 : 0.55}"/>`;
    else if (i === woven) loose = `<path d="M${x + (r % 2 ? cell : 0)} ${y}q${r % 2 ? -10 : 10} 14 ${r % 2 ? -4 : 4} 30" fill="none" stroke-width="2.4"/>`;
  }
  el.innerHTML = `<svg viewBox="-4 0 ${W * cell + 8} ${H * cell + 28}" width="210" height="${((H * cell + 28) * 210) / (W * cell + 8)}" style="display:block;margin:6px 0">
    <path d="${d}" stroke="#b7aa92" stroke-width="1.2" stroke-dasharray="${f >= 1 ? '0' : '2 3'}" fill="none"/>
    <g stroke="#c8a24a" stroke-linecap="round">${g}${loose}</g></svg>`;
  return el;
}

function showResults(data) { // the level's stamp, the time, echoes as shards slotting in, the challenges as wax seals (new ones are stamped)
  const { game } = cur, lv = ui.lv, id = data.id, best = store.get('sw.best', {}), prev = best[id], isNew = prev == null || lv.t < prev;
  if (isNew) { best[id] = lv.t; store.set('sw.best', best); }
  store.set('sw.progress', data.next ?? id);
  const s = game.settings, assist = cur.ctx.params.get('breath') === '0' || s.infiniteAirDash || s.allGifts || !s.breath || s.gameSpeed < 1;
  const target = (level(id)?.bot ?? 0) * 0.9, got = found().filter((k) => k.startsWith(`${id}.`)).length, slots = Object.keys(LINES).filter((k) => k.startsWith(`${id}.`)).length, fresh = cur.reg.get('meta.result')?.fresh ?? [];
  const notes = [s.timer ? `${L('Target', 'Цель')} ${fmtCs(target)}${lv.t <= target ? ` · ${L('beaten', 'побита')}` : ''}` : null,
    prev == null ? null : `${L('Delta', 'Разница')} ${lv.t <= prev ? '−' : '+'}${Math.abs(lv.t - prev).toFixed(2)}`, assist ? L('Assist on', 'Помощь вкл') : null, meta.resultLine()].filter(Boolean).join(' · ');
  setPanel('results', `${wordmark(LANG, null, 'sm')}<h1>${level(id)?.n ?? ''} · ${tr(level(id)?.title ?? data.title)}</h1>
    <div class="hud-res">${stamp(level(id)?.n ?? '✓')}<div><div class="hud-time">${fmtCs(lv.t)}${isNew ? `<span class="new">${L('new', 'рекорд')}</span>` : ''}</div>
      <small>${L('Best', 'Лучшее')} ${fmtCs(best[id])} &nbsp;·&nbsp; ${L('Falls', 'Падения')} ${lv.falls}</small></div></div>
    <div class="hud-slots">${Array.from({ length: slots }, (_, i) => shard(i < got).replace('<svg', `<svg style="--i:${i}"`)).join('')}<span>${L('Echoes', 'Эхо')} ${got}/${slots}</span></div>
    <div class="hud-seals">${meta.challenges(id).map((c, i) => { const on = !!meta.meta.ch[`${id}.${c.id}`]; return `<div class="${on ? 'on' : ''}" style="--i:${i}">${seal(c.id, on, fresh.includes(c.id))}${tr(c.name).split(':')[0]}</div>`; }).join('')}</div>
    <p class="hud-note">${notes}</p>`, [
    [L('Continue', 'Дальше'), () => onward(data), false, 'play'],
    [L('Retry', 'Ещё раз'), () => goTo(id, { card: true, outMs: 500 }), false, 'loop', true],
    [L('Select level', 'Выбор уровня'), () => showSelect(() => showResults(data)), false, 'map', true],
  ]);
}
async function onward(data) { // results -> outro cutscene -> next level (its arrival), or (l3) finale -> ending -> credits
  if (ui.busy) return;
  const first = (id) => !seen().includes(id); // the journey between islands plays once; the journal replays it
  if (data.next) {
    if (first(`${data.id}.outro`)) await playCut('outro');
    goTo(data.next, { card: true, outMs: 900, cut: first(`${data.next}.arrive`) ? 'arrive' : null });
    return;
  }
  const kind = endingFor(); // R8: bad | middle | true (core/save.js harmony + tales)
  setEnding(kind);
  if (!(await playCut(kind === 'middle' ? 'finale' : `finale_${kind}`))) await playCut('finale');
  showEnd(kind);
}

let sTab = 'game';
function showSettings(back, tab = sTab) { // pages: game, assist, sound, picture, controls
  sTab = tab;
  const s = cur.game.settings, apply = () => { cur.game.applySettings(); applyUi(s); };
  const form = mk('div', 'hud-form hud-page');
  const onOff = [[true], [false]];
  const opt = (label, opts, get, set) => { // a button row: label + a switch (on / off) or pips; click / right = next, left = previous
    const b = mk('button', 'hud-opt'), val = mk('span', opts === onOff ? 'sw' : 'seg');
    b.append(mk('span', null, label), val);
    const show = () => { if (opts === onOff) val.classList.toggle('on', !!get()); else val.innerHTML = opts.map(([v, t]) => `<i class="${v === get() ? 'on' : ''}">${t}</i>`).join(''); };
    b.cycle = (d) => {
      const i = opts.findIndex(([v]) => v === get());
      set(opts[(i + d + opts.length) % opts.length][0]); apply(); show();
      if (label === ui.langLabel) showSettings(back); // the menu redraws in the new language
    };
    b.onclick = () => b.cycle(1);
    show(); form.append(b);
    return b;
  };
  const range = (label, min, max, step, get, set) => {
    const r = mk('label', 'hud-range'), c = Object.assign(mk('input'), { type: 'range', min, max, step, value: get() });
    const fill = () => c.style.setProperty('--v', `${((c.value - min) / (max - min)) * 100}%`);
    c.oninput = () => { set(+c.value); apply(); fill(); };
    fill(); r.append(mk('span', null, label), c); form.append(r);
  };
  ui.langLabel = L('Language', 'Язык');
  if (tab === 'game') {
    opt(ui.langLabel, [['ru', 'Русский'], ['en', 'English']], () => s.lang, (v) => { s.lang = v; });
    opt(L('Text size', 'Размер текста'), [['S', 'S'], ['M', 'M'], ['L', 'L']], () => s.textSize, (v) => { s.textSize = v; });
    opt(L('Timer', 'Таймер'), onOff, () => s.timer, (v) => { s.timer = v; });
  } else if (tab === 'assist') {
    opt(L('Game speed', 'Скорость игры'), [[0.7, '70%'], [0.85, '85%'], [1, '100%']], () => s.gameSpeed, (v) => { s.gameSpeed = v; });
    opt(L('Infinite air dash', 'Бесконечный рывок'), onOff, () => s.infiniteAirDash, (v) => { s.infiniteAirDash = v; });
    opt(L('All gifts', 'Все дары'), onOff, () => s.allGifts, (v) => { s.allGifts = v; }); // applies from the next level start (level.js)
    opt(L('Breath limit', 'Предел дыхания'), onOff, () => s.breath, (v) => { s.breath = v; });
    opt(L('Reduce motion', 'Меньше движения'), onOff, () => s.reduceMotion, (v) => { s.reduceMotion = v; });
  } else if (tab === 'sound') {
    const VOL = { master: L('Master', 'Общая'), sfx: L('Effects', 'Эффекты'), music: L('Music', 'Музыка'), voice: L('Voices', 'Голоса'), ambience: L('Ambience', 'Окружение') };
    for (const k of Object.keys(VOL)) range(VOL[k], 0, 100, 5, () => Math.round(s.volume[k] * 100), (v) => { s.volume[k] = v / 100; });
  } else if (tab === 'picture') {
    opt(L('Camera', 'Камера'), [['assist', L('Assist', 'Помощь')], ['free', L('Free (mouse lock)', 'Свободная (захват мыши)')]], () => s.cameraMode, (v) => { s.cameraMode = v; });
    opt(L('Camera follow', 'Доводка камеры'), [['off', L('Off', 'Выкл')], ['low', L('Low', 'Слабая')], ['normal', L('Normal', 'Обычная')]], () => s.camAssist, (v) => { s.camAssist = v; });
    range(L('Sensitivity', 'Чувствительность'), 0.3, 3, 0.1, () => s.sensitivity, (v) => { s.sensitivity = v; });
    opt(L('Invert Y', 'Инверсия Y'), onOff, () => s.invertY, (v) => { s.invertY = v; });
    range(L('Field of view', 'Поле зрения'), 40, 90, 1, () => s.fov, (v) => { s.fov = v; });
    opt(L('Graphics', 'Графика'), [['low', L('Low', 'Низкая')], ['medium', L('Medium', 'Средняя')], ['high', L('High', 'Высокая')]], () => s.quality, (v) => { s.quality = v; });
  } else {
    const touchOpts = () => {
      opt(L('Touch controls', 'Сенсорное управление'), [['auto', L('Auto', 'Авто')], ['on', L('On', 'Вкл')], ['off', L('Off', 'Выкл')]], () => s.touchControls, (v) => { s.touchControls = v; });
      opt(L('Button size', 'Размер кнопок'), [['S', 'S'], ['M', 'M'], ['L', 'L']], () => s.touchSize, (v) => { s.touchSize = v; });
      opt(L('Left-handed (swap sides)', 'Для левши (поменять стороны)'), onOff, () => s.leftHanded, (v) => { s.leftHanded = v; });
    };
    const first = document.body.classList.contains('touch'); // desktop keeps the key list on top
    if (first) touchOpts();
    ui.keys = mk('div', 'hud-keys');
    form.append(ui.keys);
    drawKeys();
    if (!first) touchOpts();
  }
  const focusLang = ui.mode === 'settings' && document.activeElement?.cycle && tab === 'game' && document.activeElement.classList.contains('hud-opt'); // redraw after a language change keeps that row focused
  const tabs = tabRow([['game', 'gear', L('Game', 'Игра')], ['assist', 'hand', L('Assist', 'Помощь')], ['sound', 'note', L('Sound', 'Звук')], ['picture', 'eye', L('Picture', 'Картинка')], ['keys', 'keys', L('Controls', 'Управление')]], tab, (id) => showSettings(back, id));
  setPanel('settings', `<h1>${L('Settings', 'Настройки')}</h1>`, [[L('Back', 'Назад'), back, false, 'back']], [tabs, form], back);
  if (focusLang) quietFocus(form.querySelector('.hud-opt'));
}
const keycaps = (s) => s.split(' / ').map((part) => part.split(' + ').map((k) => { const m = k.match(/^(.* )?([ABXY])$/); return m ? `${m[1] ?? ''}<kbd class="pad ${m[2]}">${m[2]}</kbd>` : `<kbd>${k}</kbd>`; }).join('+')).join(' ');
function drawKeys() { // the controls page: a pose per action (it moves while focused) + the glyphs of the last-used device
  const pad = ui.device === 'pad', tch = ui.device === 'touch';
  const rows = tch ? [
    ['move', L('Move', 'Идти'), L('Left thumb: stick', 'Левый палец: стик')],
    ['run', L('Run', 'Бег'), L('Push the stick to its edge', 'Тяни стик до края')],
    ['jump', L('Jump (hold: higher)', 'Прыжок (держи — выше)'), L('Big button', 'Большая кнопка')],
    ['dash', L('Dash', 'Рывок'), L('Dash button', 'Кнопка рывка')],
    ['sing', L('Sing to a rune (hold)', 'Спеть руне (держи)'), L('Sing button (hold)', 'Кнопка пения (держи)')],
    ['strike', L('Strike with the staff', 'Удар посохом'), L('Strike button', 'Кнопка удара')],
    ['gust', L('Song: Gust (hold: stronger)', 'Песня: Порыв (держи — сильнее)'), L('Song buttons', 'Кнопки песен')],
    ['name', L('Song: Name (hold: stronger)', 'Песня: Имя (держи — сильнее)'), L('Song buttons', 'Кнопки песен')],
    ['anchor', L('Song: Anchor (hold: stronger)', 'Песня: Якорь (держи — сильнее)'), L('Song buttons', 'Кнопки песен')],
    ['look', L('Look', 'Обзор'), L('Drag the right side', 'Тяни справа')],
    ['pause', L('Pause', 'Пауза'), L('Pause button', 'Кнопка паузы')],
    ['skip', L('Skip a scene', 'Пропустить сцену'), L('Long press', 'Долгое нажатие')],
  ] : [
    ['move', L('Move', 'Идти'), pad ? L('Left stick', 'Левый стик') : L('WASD / arrows', 'WASD / стрелки')],
    ['run', L('Run', 'Бег'), pad ? 'RB' : 'Shift'],
    ['jump', L('Jump (hold: higher)', 'Прыжок (держи — выше)'), pad ? 'A' : L('Space', 'Пробел')],
    ['dash', L('Dash', 'Рывок'), pad ? 'B' : L('Q / right click', 'Q / правый клик')],
    ['sing', L('Sing to a rune (hold)', 'Спеть руне (держи)'), pad ? 'Y' : 'E'],
    ['strike', L('Strike with the staff', 'Удар посохом'), pad ? 'X' : L('F / click', 'F / клик')],
    ['gust', L('Song: Gust (hold: stronger)', 'Песня: Порыв (держи — сильнее)'), pad ? 'LB + X' : '1'],
    ['name', L('Song: Name (hold: stronger)', 'Песня: Имя (держи — сильнее)'), pad ? 'LB + Y' : '2'],
    ['anchor', L('Song: Anchor (hold: stronger)', 'Песня: Якорь (держи — сильнее)'), pad ? 'LB + B' : '3'],
    ['look', L('Look', 'Обзор'), pad ? L('Right stick', 'Правый стик') : L('Drag / mouse', 'Тяни / мышь')],
    ...(pad ? [] : [['zoom', L('Zoom', 'Приближение'), L('Wheel', 'Колесо')], ['restart', L('Restart', 'Заново'), L('Hold R', 'Держи R')]]),
    ['pause', L('Pause', 'Пауза'), pad ? 'Start' : 'Esc / P'],
    ['skip', L('Skip a scene', 'Пропустить сцену'), pad ? L('Hold A', 'Держи A') : L('Hold Esc / Space', 'Держи Esc / Пробел')],
  ];
  const cards = rows.map(([art, a, k]) => { const b = mk('button'); b.innerHTML = `${pose(art)}<span></span><em>${keycaps(k)}</em>`; b.querySelector('span').textContent = a; return b; });
  ui.keys.replaceChildren(mk('p', 'hud-note', tch ? L('Touch', 'Касания') : pad ? L('Gamepad', 'Геймпад') : L('Keyboard and mouse', 'Клавиатура и мышь')), ...cards);
  gridNav(cards.reduce((r, b, i) => { (r[i >> 1] ??= []).push(b); return r; }, []));
}
function setDevice(d) { if (ui.device === d) return; ui.device = d; if (ui.mode === 'settings' && ui.keys?.isConnected) drawKeys(); }

function showEnd(kind = getSave().ending.last ?? 'middle') { // R8: three endings (core/save.js endingFor)
  const { falls, time } = ui.stats, n = found().length, all = Object.keys(LINES).length;
  cur.reg.set('paused', true);
  const END = {
    bad: [L('The knot is loosened, but the sky stays grey.', 'Узел ослаб, но небо осталось серым.'),
      L('Orren let go, and no one remembered his name. The islands hang where they are, far apart, and the winds wander without a way home.',
        'Оррен отпустил, и никто не вспомнил его имени. Острова висят, где висели, далеко друг от друга, и ветры бродят, не зная дороги домой.'),
      L('The mountain remembers too little. Walk the islands again: their stones, their friends, the tale of the youngest Keeper.',
        'Гора помнит слишком мало. Пройди острова ещё раз: их камни, их друзей, сказку о младшем Хранителе.')],
    middle: [L('The knot is loosened.', 'Узел развязан.'),
      L('Orren let go, and the islands did not fall. They drift a little closer every dawn, and remember each other by the wind between them.',
        'Оррен отпустил, и острова не упали. С каждым рассветом они чуть ближе друг к другу и помнят друг друга по ветру между ними.'),
      tales() < TALES ? L('Something of Orren is still missing: his tale is not whole.', 'Чего-то от Оррена всё ещё не хватает: его сказка не целая.') : null],
    true: [L('Orren is named.', 'Оррен назван.'),
      L('His whole tale was known, so his name could be sung: the last cord came loose by itself. The youngest Keeper stands on the Crown again, and the mountain wakes.',
        'Вся его сказка была известна, и его имя смогли спеть: последняя верёвка развязалась сама. Младший Хранитель снова стоит на Короне, и гора просыпается.'),
      L('Kamen, Sigh and Kestrel sing the dawn in.', 'Камень, Вздох и Пустельга поют рассвет.')],
  }[kind] ?? [];
  setPanel('end', `<div class="hud-end">${island('l3', kind)}</div><h1>${END[0]}</h1>
    <p>${END[1]}</p>
    ${END[2] ? `<p><i>${END[2]}</i></p>` : ''}
    <p class="hud-note">${L('Echoes', 'Эхо')} ${n}/${all} &nbsp;·&nbsp; ${falls} ${L(falls === 1 ? 'fall' : 'falls', 'падений')} &nbsp;·&nbsp; ${fmtTime(time)}</p>`,
  [[L('Credits', 'Авторы'), () => showCredits(quitToTitle), false, 'quill'], [L('Journal', 'Журнал'), () => showJournal(() => showEnd(kind)), false, 'book']]);
}
const SUPPORT = () => [L('Support the game', 'Поддержать игру'), () => window.open('https://rinekri.itch.io/unknot', '_blank', 'noopener'), false, 'hand', true]; // U24: title + credits only
function showCredits(back) { // a slow roll; Back (or the end of the roll after the finale) returns
  const roll = mk('div', 'hud-roll'), inner = mk('div');
  const sec = (h, ...lines) => { inner.append(mk('h2', null, h)); for (const l of lines) inner.append(mk('p', null, l)); };
  inner.insertAdjacentHTML('beforeend', wordmark(LANG, 'loose'));
  inner.append(mk('p', null, L('A walk across the islands of a sleeping mountain.', 'Прогулка по островам спящей горы.')));
  sec(L('Made by', 'Сделано'), L('One wanderer, a laptop and a lot of wind.', 'Одним странником, ноутбуком и большим количеством ветра.'),
    L('Made with AI assistance: parts of the art and the code were produced with generative tools.', 'Создано с помощью ИИ: часть графики и кода сделана генеративными инструментами.'));
  sec(L('Story', 'История'), L('The Keepers, Kamen, Sigh, Kestrel and Orren', 'Хранители, Камень, Вздох, Пустельга и Оррен'));
  sec(L('Built with', 'Инструменты'), 'three.js · Vite · Blender · WebAudio');
  sec(L('Textures', 'Текстуры'), 'ambientCG — Rock030 (CC0)');
  sec(L('Sound', 'Звук'), L('Synthesised in the browser: every voice is babble, every word is a subtitle.', 'Синтезирован в браузере: каждый голос — лепет, каждое слово — субтитр.'));
  sec(L('Thank you for walking', 'Спасибо, что прошли путь'), L('The islands drift a little closer every dawn.', 'С каждым рассветом острова чуть ближе.'));
  inner.append(mk('p', null, L('If the walk was worth it, you can support the game: rinekri.itch.io/unknot', 'Если путь того стоил, игру можно поддержать: rinekri.itch.io/unknot'))); // U24, the button below opens it
  roll.append(inner);
  inner.addEventListener('animationend', () => { if (ui.panel?.contains(roll)) back(); });
  setPanel('credits', `<h1>${L('Credits', 'Авторы')}</h1>`, [[L('Back', 'Назад'), back, false, 'back', true], SUPPORT()], roll, back);
}

// ---- input for menus: keyboard + gamepad (own poll, works while the sim is paused) ----
function padLoop() {
  requestAnimationFrame(padLoop);
  const pad = navigator.getGamepads?.().find(Boolean);
  if (!pad || !ui) return;
  const b = (i) => !!pad.buttons[i]?.pressed, ax = (i) => pad.axes[i] ?? 0, now = performance.now() / 1000;
  const dir = b(12) || ax(1) < -0.5 ? 'up' : b(13) || ax(1) > 0.5 ? 'down' : b(14) || ax(0) < -0.5 ? 'left' : b(15) || ax(0) > 0.5 ? 'right' : null;
  const P = ui.pad, edge = (k, on) => { const e = on && !P[k]; P[k] = on; return e; };
  if (pad.buttons.some((x) => x?.pressed) || pad.axes.some((v) => Math.abs(v) > 0.3)) setDevice('pad');
  const a = edge('a', b(0)), back = edge('b', b(1)), start = edge('start', b(9));
  let step = false;
  if (dir !== P.dir) { P.dir = dir; P.next = now + PAD_REPEAT[0]; step = !!dir; } else if (dir && now >= P.next) { P.next = now + PAD_REPEAT[1]; step = true; }
  if (ui.mode === 'cut') return; // cutscene.js reads A (hold to skip)
  if (ui.panel) {
    if (step && (dir === 'up' || dir === 'down')) nav(dir === 'up' ? -1 : 1);
    if (step && (dir === 'left' || dir === 'right')) adjust(dir === 'left' ? -1 : 1);
    if (a) activate();
    if (back) ui.back?.();
    if (start && ui.mode === 'pause') resume();
  } else if (start && ui.mode === 'none') openPause();
}

function install() { // once: DOM, key handlers, gamepad poll
  const add = (cls) => document.body.appendChild(mk('div', cls));
  document.body.insertAdjacentHTML('beforeend', DEFS); // the hand-drawn wobble filter of the menu art
  const veil = add('hud-veil'), load = add('hud-load'), plate = add('hud-plate'), timer = add('hud-timer');
  ui = { veil, load, plate, timer, panel: null, mode: 'none', back: null, busy: false, device: 'kb', pad: {}, stats: { falls: 0, time: 0 }, lv: { t: 0, on: false, falls: 0 } };
  let rTimer = 0, lastUnlock = 0;
  addEventListener('keydown', (e) => {
    if (e.isTrusted && e.code !== 'Escape' && e.code !== 'Space') setDevice('kb'); // touch.js sends synthetic keys
    if (ui.mode === 'cut') return; // cutscene.js owns Esc / Space (hold to skip)
    if (ui.panel && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
      if (e.code === 'ArrowUp' || e.code === 'ArrowDown') nav(e.code === 'ArrowUp' ? -1 : 1);
      else adjust(e.code === 'ArrowLeft' ? -1 : 1);
      return;
    }
    if (ui.panel && (e.code === 'Enter' || e.code === 'Space') && !ui.panel.contains(document.activeElement)) { e.preventDefault(); activate(); return; }
    if (e.repeat) return;
    if (e.code === 'KeyR' && !rTimer && ui.mode === 'none') rTimer = setTimeout(() => { rTimer = 0; if (!ui.busy && ui.mode === 'none') restart(); }, HOLD_R_MS);
    if (e.code === 'Escape' || e.code === 'KeyP') {
      if (performance.now() - lastUnlock < 200 && ui.mode === 'pause') return; // the same Esc that released the pointer lock
      if (ui.mode === 'pause') resume();
      else if (ui.mode === 'none') openPause();
      else ui.back?.();
    }
  });
  addEventListener('keyup', (e) => { if (e.code === 'KeyR') { clearTimeout(rTimer); rTimer = 0; } });
  addEventListener('blur', () => { clearTimeout(rTimer); rTimer = 0; });
  let touchAt = -1e4;
  addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { touchAt = performance.now(); setDevice('touch'); applyUi(cur.game.settings); } }, true);
  addEventListener('mousedown', () => { if (performance.now() - touchAt > 1000) setDevice('kb'); }); // a tap also fires a compat mousedown
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement) lastUnlock = performance.now(); });
  document.addEventListener('focusin', (e) => { if (!ui.quiet && ui.panel?.contains(e.target)) cue(); });
  document.addEventListener('mousemove', (e) => { // hover = focus (one gold mark for mouse, keys and pad); a resting cursor never steals it
    const t = e.target.closest?.('.hud-panel button:not(:disabled), .hud-panel input');
    if (t && t !== document.activeElement) t.focus({ preventScroll: true });
  });
  addEventListener('resize', () => applyUi(cur.game.settings));
  requestAnimationFrame(padLoop);
  showTitle();
}

export default {
  name: 'hud', order: 60,
  init(ctx) {
    el = Object.assign(document.createElement('div'), { className: 'hud-hint' });
    document.body.append(el);
    hideAt = 0;
    const reg = ctx.registry, stillCut = ctx.params.test && ctx.params.get('cut'); // ?test=1&cut=: the subtitle box for the still
    applyUi(ctx.game.settings);
    reg.on('hud.hint', (text) => { el.textContent = tr(text); el.style.opacity = 1; hideAt = ctx.game.t + SHOW_S; }); // shrine inscriptions only (lore): mechanics are taught by the world, never by text
    if ((ctx.params.test || ctx.params.bot) && !stillCut) return; // playtests never pause or advance on their own
    sub = mk('div', 'hud-sub');
    document.body.append(sub);
    reg.on('talk.line', (l) => {
      sub.classList.toggle('on', !!l);
      if (l) sub.replaceChildren(...(l.who ? [mk('b', null, tr(l.who))] : []), tr(l.text));
    });
    if (stillCut) return;
    cur = { ctx, reg, game: ctx.game };
    if (!ui) install();
    if (ui.busy) reg.set('paused', true); // held until goTo has faded back in
    reg.on('settings', applyUi);
    reg.on('input.unlock', () => { if (ctx.game.settings.cameraMode === 'free') openPause(); });
    reg.on('player.fall', () => { ui.stats.falls++; ui.lv.falls++; flash(); });
    reg.on('player.respawn', flash);
    reg.on('end', (e) => { // the run clock stops at the touch; the card follows END_S later (goal flare + gift_receive play first)
      if (e !== 'goal' || ui.busy) return;
      const data = reg.get('level')?.data;
      reg.set('level.goal', { level: data?.id, t: ctx.game.t, next: data?.next ?? null, falls: ui.stats.falls, time: ui.stats.time });
      ui.endAt = { t: ctx.game.t + END_S, data };
    });
  },
  update(ctx, dt) {
    if (ui && cur) { // paused sim skips update(): menus and transitions do not count
      ui.stats.time += dt;
      const i = ctx.registry.get('input'), lv = ui.lv;
      if (!lv.on && i && (i.move?.[0] || i.move?.[1] || i.jump || i.dash || i.strike || i.sing || i.song)) { lv.on = true; }
      if (lv.on && !ctx.registry.get('end')) lv.t += dt;
      if (ui.endAt && ctx.game.t >= ui.endAt.t) {
        const { data } = ui.endAt; ui.endAt = null;
        ctx.registry.set('paused', true); // sim stops, rendering and the camera go on
        try { document.exitPointerLock(); } catch { /* not locked */ }
        showResults(data);
      }
      ui.timer.style.display = ctx.game.settings.timer ? '' : 'none';
      ui.timer.textContent = fmtCs(lv.t);
    }
    if (hideAt && ctx.game.t > hideAt) { el.style.opacity = 0; hideAt = 0; }
  },
  dispose() { el.remove(); sub?.remove(); sub = null; },
};

let flashing = false;
async function flash() { // short veil on respawn
  if (!ui || ui.busy || flashing) return;
  flashing = true;
  await fade(true, 160);
  if (!ui.busy) await fade(false, 320);
  flashing = false;
}
