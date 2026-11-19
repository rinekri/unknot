#!/usr/bin/env node
// walkthrough.mjs: one offline RU walkthrough (engine/walkthrough/index.html, tabs l1-l3) + lN.png maps.
// Everything comes from level.json, the engine constants (regex-read from src) and bot runs recorded here through ?test=1,
// so it regenerates after level edits:  node tools/walkthrough.mjs --url http://localhost:5203 [--bots dir] [--strips dir] [--out dir]
//   --bots   dir with <profile>/lN.json bot results (official clock table only; routes are recorded by this script)
//   --strips dir with <level>.<cut>/tNN.NN.png cutscene frames (downscaled into img/cut/)
//   --reuse  skip the bot runs, take the last recording from the cache (layout iterations)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import * as THREE from 'three';

const ENGINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1]; };
const URL0 = arg('url', 'http://localhost:5203'), OUT = path.resolve(arg('out', path.join(ENGINE, 'walkthrough')));
const BOTS = arg('bots'), STRIPS = arg('strips'), REUSE = process.argv.includes('--reuse');
const LEVELS = arg('levels', 'l1,l2,l3').split(','), PPM = +arg('ppm', 8), TIMEOUT = +arg('timeout', 420);
const PROFILES = ['mid', 'best', 'worst'], CACHE = path.join(os.tmpdir(), 'unknot-walkthrough-cache.json');
const GPU = process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] : [];
const warns = [], warn = (s) => { warns.push(s); console.warn('WARN', s); };

// ---------- helpers
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (n) => (typeof n === 'number' ? +n.toFixed(1) : n), f2 = (n) => (typeof n === 'number' ? +n.toFixed(2) : n);
const P3 = (p) => (Array.isArray(p) ? p : p ? [p.x, p.y, p.z] : [0, 0, 0]);
const xz = (p) => (p.length === 2 ? p : [p[0], p[2]]);
const d2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const ruen = (t) => (t == null ? '' : typeof t === 'string' ? esc(t) : `${esc(t.ru)}<br><i class="en">${esc(t.en)}</i>`);
const pos3 = (p) => (p ? `[${P3(p).map(f1).join(', ')}]` : '');
const code = (s) => `<code>${esc(s)}</code>`;
const tbl = (head, rows, cls = '') => (rows.length ? `<table class="${cls}"><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr>${rows.map((r) => `<tr>${r.map((c) => `<td>${c ?? ''}</td>`).join('')}</tr>`).join('')}</table>` : '<p class="dim">нет в данных уровня</p>');
const GIFT = { dash: 'Рывок (Q / ПКМ)', airdash: 'Воздушный рывок (Q в воздухе, 2 заряда)', windbreath: 'Дыхание ветра (дыхание пополняется в ветре и у разбуженных рун)', gust: 'песня Порыв (1)', name: 'песня Имя (2)', anchor: 'песня Якорь (3)' };
const SONG = { gust: 'Порыв (1)', name: 'Имя (2)', anchor: 'Якорь (3)' };
const LOCK = { name: 'песня Имя', name2: 'Имя II (song2.name: спеть камню-просьбе Камня, l1)', gust2: 'Порыв II (song2.gust: камень-просьба Вздоха, l2) + Имя', airdash: 'Воздушный рывок (два рывка в воздухе)' };
const CUT_RU = { 'l1.intro': 'Полый камень', 'l1.outro': 'Вспомненные имена', 'l2.arrive': 'Дорога ветра', 'l2.outro': 'К Короне', 'l3.arrive': 'На ветре Пустельги', 'l3.finale': 'Узел развязан', 'l3.finale_bad': 'Серый рассвет', 'l3.finale_true': 'Оррен, названный' };
const CUT_WHEN = { // hud.js: showTitle / onward()
  intro: 'Старт: «Новое путешествие» с титула, пока l1.intro не просмотрена (потом — из журнала).',
  outro: 'Старт: герой вошёл в круг цели → карточка итогов → «Дальше». Играет один раз (первое прохождение), затем загрузка следующего уровня.',
  arrive: 'Старт: первый вход на уровень после outro предыдущего (goTo … cut: arrive). Один раз.',
  finale: 'Старт: цель l3 → итоги → «Дальше», если endingFor() = middle (также запасной вариант, если нужной концовки нет в данных).',
  finale_bad: 'Старт: цель l3 → «Дальше», если endingFor() = bad (гармония < 4).',
  finale_true: 'Старт: цель l3 → «Дальше», если endingFor() = true (все сказания и гармония ≥ 75 % максимума).',
};

// ---------- engine constants (read from source text so the cards follow the tuning)
const src = (f) => { try { return fs.readFileSync(path.join(ENGINE, 'src', f), 'utf8'); } catch { warn(`no source ${f}`); return ''; } };
function grab(text, name) {
  const m = text.match(new RegExp(`\\b${name} = (.+)`)); if (!m) return undefined;
  let s = m[1][0] === '{' ? m[1].slice(0, m[1].lastIndexOf('}') + 1) : m[1].match(/^(\[[^\]]*\]|[-\d.]+)/)?.[1];
  s = s?.replace(/get (\w+)\(\) \{ return ([^;]+); \}/g, (_, k, e) => `${k}: ${JSON.stringify(e.replace(/tales\(\)/g, 'сказаний'))}`);
  try { return new Function(`return (${s})`)(); } catch { return undefined; }
}
const soft = (o, n) => { if (o == null) warn(`constant ${n} not found in source: cards show "?"`); return typeof o === 'object' || o == null ? new Proxy(o ?? {}, { get: (t, k) => t[k] ?? '?' }) : o; };
const eSrc = src('systems/enemies.js'), sSrc = src('systems/songs.js'), lSrc = src('systems/level.js'), svSrc = src('core/save.js');
const K = Object.fromEntries([['SQ', eSrc], ['WD', eSrc], ['BOSS', eSrc], ['TH', eSrc], ['PL', eSrc], ['GD', eSrc], ['PUFF_S', eSrc], ['STAGE_T', sSrc], ['OVER', sSrc], ['AIR_MAX', sSrc], ['GUST_REACH', sSrc],
  ['NAME_X', sSrc], ['ANCHOR_HOLD', sSrc], ['NAME_R', sSrc], ['ANCHOR_R', sSrc], ['NAME_R2', sSrc], ['GUST_X2', sSrc], ['SING_R', lSrc], ['STRIKE_R', lSrc], ['HOLD_WARN', lSrc], ['TALES', svSrc], ['ECHOES', svSrc]]
  .map(([n, t]) => [n, soft(grab(t, n), n)]));
if (typeof grab('const SQ = { tele: 0.85, r: 6 };', 'SQ')?.tele !== 'number' || grab('x BOSS = { get w() { return 1 + tales(); }, a: 2 };', 'BOSS')?.a !== 2) throw new Error('grab() self-check failed');

// ---------- level data
const levels = Object.fromEntries(LEVELS.map((id) => [id, JSON.parse(fs.readFileSync(path.join(ENGINE, 'public/assets/levels', id, 'level.json'), 'utf8'))]));
const shotOf = (L, name) => (Array.isArray(L.shots) ? L.shots.find((s) => s.name === name) : L.shots?.[name]);
const talkOf = (L, id) => { for (const n of L.npcs ?? []) for (const t of n.talk ?? []) if (t.id === id) return { npc: n, t }; return null; };
const linesOf = (t) => (t?.lines ?? []).map(ruen).join('<br>');

function bounds(L) { // core content bbox + margin; cutscene points may stretch it by up to 60 m
  const core = [], far = [];
  const add = (p, to = core) => p && to.push(xz(p));
  add(L.spawn?.pos); add(L.goal?.pos); (L.route ?? []).forEach((p) => add(p)); (L.checkpoints ?? []).forEach((c) => add(c.pos));
  for (const m of L.mechanisms ?? []) { add(m.pos); if (m.area) { add(m.area.min); add(m.area.max); } (m.vein ?? []).forEach((p) => add(p)); }
  for (const t of L.triggers ?? []) (t.shape?.pts ?? []).forEach((p) => add(p));
  for (const k of ['enemies', 'echoSlots', 'npcs', 'npcSlots', 'trials']) (L[k] ?? []).forEach((e) => add(e.pos));
  for (const c of Object.values(L.cutscenes ?? {})) {
    for (const k of c.keys ?? []) { const s = k.shot ? shotOf(L, k.shot) : k; add(s?.pos, far); }
    (c.hero?.path ?? []).forEach((p) => add(p.pos, far)); (c.ribbon?.pts ?? []).forEach((p) => add(p, far)); (c.actors ?? []).forEach((a) => (a.path ?? []).forEach((p) => add(p.pos, far)));
  }
  const bb = (pts) => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const c = bb(core), f = far.length ? bb(far) : c, CAP = 60, M = 10;
  return [Math.max(Math.min(c[0], f[0]), c[0] - CAP) - M, Math.max(Math.min(c[1], f[1]), c[1] - CAP) - M, Math.min(Math.max(c[2], f[2]), c[2] + CAP) + M + 12, Math.min(Math.max(c[3], f[3]), c[3] + CAP) + M].map(Math.round);
}

// ---------- browser side: map render + bot runs
async function openGame(browser, q) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('pageerror', (e) => warn(`page error (${q}): ${e.message}`));
  await page.goto(`${URL0}/?test=1&seed=1&${q}`);
  await page.waitForFunction(() => window.__game, null, { timeout: 90000 });
  return page;
}
async function renderMap(browser, id, L, B) {
  const page = await openGame(browser, `level=${id}`);
  await page.evaluate(() => window.__game.advance(0.2));
  const names = [...(L.mechanisms ?? []).flatMap((m) => [m.node, ...(m.nodes ?? [])]), ...(L.npcs ?? []).map((n) => n.node)].filter(Boolean);
  const ppm = Math.min(PPM, 4096 / Math.max(B[2] - B[0], B[3] - B[1]));
  const r = await page.evaluate(([[x0, z0, x1, z1], k, names]) => {
    const G = window.__game, T = G.THREE, scene = G.scene(), w = Math.round((x1 - x0) * k), h = Math.round((z1 - z0) * k);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const R = new T.WebGLRenderer({ canvas: cv, antialias: true, preserveDrawingBuffer: true });
    R.setSize(w, h, false); R.outputColorSpace = T.SRGBColorSpace;
    const cam = new T.OrthographicCamera(x0, x1, -z0, -z1, 0.1, 1000); // looking down, up = -z: screen right = +x, screen down = +z
    cam.up.set(0, 0, -1); cam.position.set(0, 400, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const fog = scene.fog, bg = scene.background; scene.fog = null; scene.background = new T.Color('#cfd8e3');
    R.render(scene, cam); scene.fog = fog; scene.background = bg;
    const url = cv.toDataURL('image/jpeg', 0.86); R.dispose();
    const nodes = {}, box = new T.Box3();
    for (const n of names) { const o = scene.getObjectByName(n); if (!o) continue; box.setFromObject(o); if (!box.isEmpty()) nodes[n] = [box.min.x, box.min.z, box.max.x, box.max.z, box.max.y]; }
    return { url, nodes };
  }, [B, ppm, names]);
  await page.close();
  return r;
}
async function runBot(browser, id, profile) { // route (pos every 0.25 s) + log; mid also keeps a play-camera frame every second
  const thumbs = profile === 'mid', page = await openGame(browser, `level=${id}&profile=${profile}&bot=1&timeout=${TIMEOUT}${thumbs ? '&cam=play' : ''}`);
  const pts = [], frames = []; let st;
  for (let i = 0; ; i++) {
    st = await page.evaluate(async (shot) => {
      const G = window.__game; await G.advance(0.25); const s = G.state(), p = s.player.pos;
      const o = { t: s.t, pos: Array.isArray(p) ? p : [p.x, p.y, p.z], end: s.end, falls: s.falls };
      if (shot) { const im = new Image(); im.src = G.png(); await im.decode(); const c = document.createElement('canvas'); c.width = 320; c.height = 180; c.getContext('2d').drawImage(im, 0, 0, 320, 180); o.shot = c.toDataURL('image/jpeg', 0.72); }
      return o;
    }, thumbs && i % 4 === 3);
    pts.push([f2(st.t), ...st.pos.map(f2)]);
    if (st.shot) frames.push([f2(st.t), st.shot]);
    if (st.end || st.t >= TIMEOUT) break;
  }
  const log = await page.evaluate(() => window.__game.botLog());
  await page.close();
  console.log(`  ${id} ${profile}: end=${st.end} t=${f1(st.t)}s falls=${st.falls}`);
  if (st.end !== 'goal') warn(`${id} ${profile}: bot run ended with "${st.end}" at ${f1(st.t)} s: its route stops there`);
  return { profile, end: st.end, t: st.t, falls: st.falls, pts, frames, log };
}
async function shrinkStrips(browser) { // cutscene frame strips -> img/cut/<level>.<cut>/tNN.NN.jpg
  const out = {};
  if (!STRIPS || !fs.existsSync(STRIPS)) { warn(`--strips ${STRIPS ?? '(not given)'}: no cutscene frame strips`); return out; }
  const page = await browser.newPage();
  for (const dir of fs.readdirSync(STRIPS).sort()) {
    const files = fs.readdirSync(path.join(STRIPS, dir)).filter((f) => /^t[\d.]+\.png$/.test(f)).sort(); if (!files.length) continue;
    fs.mkdirSync(path.join(OUT, 'img/cut', dir), { recursive: true }); out[dir] = [];
    for (const f of files) {
      const b64 = fs.readFileSync(path.join(STRIPS, dir, f)).toString('base64');
      const url = await page.evaluate(async (b) => { const im = new Image(); im.src = `data:image/png;base64,${b}`; await im.decode(); const c = document.createElement('canvas'); c.width = 240; c.height = 135; c.getContext('2d').drawImage(im, 0, 0, 240, 135); return c.toDataURL('image/jpeg', 0.7); }, b64);
      const name = f.replace('.png', '.jpg'); fs.writeFileSync(path.join(OUT, 'img/cut', dir, name), Buffer.from(url.split(',')[1], 'base64'));
      out[dir].push([parseFloat(f.slice(1)), `img/cut/${dir}/${name}`]);
    }
  }
  await page.close();
  return out;
}

// ---------- beats from the mid run
const at = (pts, t) => { let i = pts.findIndex((p) => p[0] >= t); if (i < 0) i = pts.length - 1; return pts[i].slice(1); };
const START = new Set(['checkpoint', 'sing', 'break', 'gift', 'unbind', 'shatter', 'bell', 'echo', 'goal', 'fall', 'song']);
function beatsOf(run) {
  const beats = []; let cur = null, pend = [];
  for (const e of run.log) {
    if (e.event === 'summary' || e.event === 'breath' || e.event === 'drop' || e.event === 'landing' || e.event === 'bounce') continue;
    if (e.event === 'talk' && String(e.detail?.id).startsWith('echo.')) continue;
    if (e.event === 'song' && (e.detail?.wasted || !e.detail?.id)) { pend.push(e); continue; }
    if (!START.has(e.event)) { pend.push(e); continue; }
    const p = e.event === 'fall' && e.detail?.pos ? at(run.pts, e.t - 1.5) : at(run.pts, e.t);
    if (cur && d2(xz(p), xz(cur.pos)) < 5 && e.t - cur.t1 < 8 && Math.abs(p[1] - cur.pos[1]) < 4) { cur.items.push(e); cur.t1 = e.t; cur.pre.push(...pend); }
    else { cur = { t: e.t, t1: e.t, pos: p, items: [e], pre: pend }; beats.push(cur); }
    pend = [];
  }
  if (cur) cur.pre.push(...pend);
  return beats;
}

// ---------- prose for mechanisms / events
function mechPos(L, m, nodes) {
  if (m.pos) return xz(m.pos);
  if (m.area) return [(m.area.min[0] + m.area.max[0]) / 2, (m.area.min[2] + m.area.max[2]) / 2];
  const b = mechBox(m, nodes); return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null;
}
function mechBox(m, nodes) {
  const bs = [m.node, ...(m.nodes ?? [])].map((n) => nodes[n]).filter(Boolean); if (!bs.length) return null;
  return [Math.min(...bs.map((b) => b[0])), Math.min(...bs.map((b) => b[1])), Math.max(...bs.map((b) => b[2])), Math.max(...bs.map((b) => b[3]))];
}
const byId = (L, id) => (L.mechanisms ?? []).find((m) => m.id === id);
function targetText(L, id) {
  const m = byId(L, id); if (!m) return code(id);
  if (m.kind === 'bridge') return `мост ${code(id)} поднимается${m.hold ? ` на <b>${m.hold} с</b> (таймер; за ${K.HOLD_WARN} с до конца дрожит, потом тонет — пой руну заново)` : ' навсегда'}`;
  if (m.kind === 'platform') return `подъёмник ${code(id)} (${f1(Math.max(...m.path.map((p) => p[1])))} м вверх, период ${m.period} с)`;
  if (m.kind === 'wind') return `ветер ${code(id)}`;
  return `${m.kind} ${code(id)}`;
}
function switchKind(L, m) {
  const npc = (L.npcs ?? []).find((n) => n.switches?.includes(m.id));
  if (m.gift) return `Святилище песни «${SONG[m.gift] ?? m.gift}»`;
  if (m.lock) return `Замок-руна R6 (нужно: ${LOCK[m.lock] ?? m.lock})`;
  if (m.request) return `Камень-просьба (${m.request}) — считается в гармонию`;
  if (m.menhir) return 'Менгир-шутка';
  if (m.toggle) return `Тотем ветра (${m.toggle === 'flip' ? 'переключает: один ветер гаснет, другой включается' : 'вкл/выкл ветров'})`;
  if (m.seq) return `Руна последовательности «${m.seq}», нота №${m.order}`;
  if (m.shortcut) return 'Руна короткого пути';
  if (npc) return `Камень просьбы NPC ${npc.name?.ru ?? npc.id} (${npc.switches.indexOf(m.id) + 1}/${npc.switches.length})`;
  if (/^shrine/.test(m.id)) return 'Святилище (руна без целей)';
  return 'Руна';
}
function switchHow(L, m) {
  const o = [`Петь: держи <kbd>E</kbd> рядом (r ${m.r} м; общий радиус пения ${K.SING_R} м).`];
  if (m.far) o.push(`Будится издалека песней Имя <kbd>2</kbd> (до ${K.NAME_R} м × множитель стадии; Имя II — ${K.NAME_R2} м).`);
  if (m.dust) o.push('Занесена пылью: сначала сдуй Порывом <kbd>1</kbd>.');
  if (m.hidden) o.push('Спрятана в стороне от маршрута: к ней ведёт светящаяся жила (на карте — пунктир от основного пути).');
  if (m.after) o.push(`Молчит, пока не стоит флаг ${code(m.after)}.`);
  if (m.lock) o.push(`Замок: ${LOCK[m.lock] ?? m.lock}.`);
  if (m.targets?.length) o.push(`Результат: ${m.targets.map((t) => targetText(L, t)).join('; ')}.`);
  if (m.shortcut) o.push('Короткий путь: держит мост на таймере поднятым / вызывает подъёмник.');
  if (m.seq) o.push('<span class="bad">Ошибка (R4):</span> спеть не по порядку = фальшивая нота: пара гаснет, мост на таймере тонет, спящий шквал просыпается.');
  if (m.gift) o.push(`Даёт ${GIFT[m.gift] ?? m.gift}.`);
  if (!m.once) o.push('Можно петь повторно.');
  return o.join(' ');
}
function itemText(L, id, e, ctx) {
  const d = e.detail, cp = (L.checkpoints ?? []).find((c) => c.id === d);
  switch (e.event) {
    case 'checkpoint': return `<b>Чекпоинт ${code(d)}</b>: ${cp?.wind ? 'ветряной каирн — пополняет дыхание' : 'обычный — дыхание не пополняет, после падения возвращает сюда'}.`;
    case 'sing': { const m = byId(L, d.id); return `<b>${m ? switchKind(L, m) : 'Руна'} ${code(d.id)}</b>${d.wrong ? ' <span class="bad">ФАЛЬШИВАЯ НОТА</span>' : d.ok ? '' : ' (не допета)'}. ${m ? switchHow(L, m) : ''}`; }
    case 'break': { const tr = (L.trials ?? []).find((t) => t.id === d.id), m = byId(L, d.id);
      return tr ? `<b>Столб ${code(d.id)} повален</b> (${d.by}) — <span class="bad">R4: настил падает, broken.${d.id}, −1 гармония.</span>` : `<b>Преграда ${code(d.id)}</b>: бей посохом <kbd>F</kbd>/ЛКМ или пробей рывком <kbd>Q</kbd> (бот: ${esc(d.by)}).${m?.targets?.length ? ` Освобождает: ${m.targets.map((t) => targetText(L, t)).join(', ')}.` : ''}`; }
    case 'gift': return `<b>Дар: ${GIFT[d.id] ?? d.id}</b>${d.npc ? ` — от ${esc(d.npc)}` : ''}.`;
    case 'unbind': return `<b>Развязан ${code(d)}</b> песней Имя — см. <a href="#${id}-f-${d}">карточку боя</a>.`;
    case 'shatter': return `<b class="bad">Разбит ${code(d)}</b> (R4: без награды, −1 гармония).`;
    case 'song': return `Песня <b>${SONG[d.song] ?? d.song}</b> → ${code(d.id)}.`;
    case 'bell': return `<b>Колокол ${code(typeof d === 'string' ? d : d?.id ?? '')}</b>: прыжок сверху (pogo) звонит.`;
    case 'echo': { const s = (L.echoSlots ?? []).find((x) => x.id === d); return `<b>Эхо ${code(d)}</b>${s?.relic ? ` (реликвия ${code(s.relic)})` : ''}${s?.note ? `: ${esc(s.note)}` : ''}.`; }
    case 'fall': return `<span class="bad">Бот здесь упал</span>${d?.enemy ? ` (сбил ${code(d.enemy)})` : ''} — возврат на чекпоинт.`;
    case 'goal': return `<b>Цель</b>: войти в круг${L.goal?.after ? ` (открыт после ${code(L.goal.after)})` : ''}. Время бота ${f1(ctx.t)} с.`;
    default: return esc(e.event);
  }
}
function preText(L, pre) {
  const n = (k, f = () => true) => pre.filter((e) => e.event === k && f(e)), o = [];
  const dash = n('dash'); if (dash.length) o.push(`рывков: ${dash.length}${dash.some((e) => e.detail?.air) ? ` (в воздухе ${dash.filter((e) => e.detail?.air).length})` : ''}`);
  const wind = [...new Set(n('wind').map((e) => e.detail?.id))]; if (wind.length) o.push(`ветер: ${wind.map(code).join(', ')}`);
  if (n('hit').length) o.push(`ударов посохом: ${n('hit').length}`);
  const kn = [...new Set(n('knock').map((e) => e.detail?.id ?? e.detail))]; if (kn.length) o.push(`<span class="bad">отброшен</span>: ${kn.map(code).join(', ')}`);
  const tr = n('trigger').map((e) => e.detail?.id ?? e.detail); if (tr.length) o.push(`зоны: ${tr.map(code).join(', ')}`);
  const tk = n('talk'); if (tk.length) o.push(`реплики: ${tk.map((e) => code(e.detail?.id)).join(', ')}`);
  for (const k of ['song', 'songfail', 'fizzle', 'reject', 'fray']) if (n(k).length) o.push(`${k} ×${n(k).length}${k === 'song' ? ' (впустую)' : ''}`);
  return o.join(' · ');
}
const beatTitle = (L, b) => { const e = b.items.find((x) => x.event !== 'checkpoint') ?? b.items[0], d = e.detail; return `${{ checkpoint: 'чекпоинт', sing: 'руна', break: 'преграда', gift: 'дар', unbind: 'бой', shatter: 'бой', song: 'песня', bell: 'колокол', echo: 'эхо', fall: 'падение', goal: 'цель' }[e.event]} ${typeof d === 'string' ? d : d?.id ?? ''}`; };

// ---------- fight cards
function fightCard(L, id, e, all) {
  const { SQ, WD, BOSS, TH, PL, GD } = K, v = e.kind === 'boss' ? 'boss' : e.guard ? 'guard' : e.kind === 'warden' ? 'warden' : e.variant ?? 'squall';
  const name = { squall: 'Шквал (осколок Узла)', thief: 'Шквал-вор', pull: 'Шквал-втягиватель', warden: 'Страж (каменный)', guard: 'Страж со щитом (сторож руны)', boss: 'Узел — босс (каменный Страж Оррена)' }[v];
  const finish = `<b>Добить:</b> Имя <kbd>2</kbd> рядом с оглушённым (до ${K.NAME_R} м; полная стадия развязывает всех оглушённых вокруг) → освобождён: восходящий поток на ${K.PUFF_S} с и награда. <span class="bad">R4:</span> три удара посохом по оглушённому = разбит (${code(`broken.${e.id}`)}, награды нет, −1 гармония).`;
  const rows = {
    squall: [['Телеграф', `Замечает в ${e.aggro ?? SQ.aggro} м (поводок ${e.r ?? SQ.r} м от поста), сжимается ${SQ.tele} с.`], ['Атака', `Бросок ${SQ.charge} с на ${SQ.chargeV} м/с; сбивает (толчок ${SQ.knock}, подброс ${SQ.lift}) — у края это падение. Потом отдыхает ${SQ.recover} с.`],
      ['Контр / оглушение', `Удар посохом <kbd>F</kbd> (радиус ${SQ.strikeR} м) или Порыв <kbd>1</kbd> во время телеграфа/броска = оглушение ${SQ.counter} с. В другое время только вздрагивает (${SQ.flinch} с); 3 вздрагивания за ${SQ.flinchWin} с = оглушение ${SQ.stun} с. Прыжок сверху (pogo) тоже считается ударом.`],
      ['Оглушён', 'Висит раскрытым клубком, не атакует — можно развязать.'], ['Финал', `${finish} Без дара Имя (l1): второй Порыв сдувает раскрытого с острова — вернётся после респауна.`], ['Награда', '2 искры дыхания; в первый раз — пыль нити.']],
    thief: [['Телеграф', `${TH.tele} с, поводок ${e.r ?? SQ.r} м.`], ['Атака', `Рывок ${TH.v} м/с (${TH.charge} с): крадёт нить дыхания и уносит её ${TH.carry} с (скорость ${TH.speed}).`], ['Контр / оглушение', 'Пока несёт нить: удар посохом, Порыв или pogo — возвращает нить и оглушается.'],
      ['Оглушён', 'Раскрыт, нить возвращена.'], ['Финал', finish], ['Награда', '2 искры дыхания; пыль нити в первый раз.']],
    pull: [['Телеграф', `Не покидает пост. Замечает в ${e.aggro ?? PL.aggro} м, замах ${PL.tele} с.`], ['Атака', `Втягивает воздух ${PL.pull} с (тянет ${PL.v} м/с); ядро ${PL.core} м бьёт (толчок ${PL.knock}, подброс ${PL.lift}). Отдых ${PL.rest} с.`],
      ['Контр / оглушение', `Якорь <kbd>3</kbd> во время вдоха — давится, оглушён ${PL.choke} с. Порыв на замахе или удар посохом — тоже оглушение.`], ['Оглушён', 'Раскрыт.'], ['Финал', finish], ['Награда', '2 искры дыхания; пыль нити в первый раз.']],
    warden: [['Телеграф', `Патрулирует отрезок (на карте), скорость ${WD.speed}; замечает в ${WD.aggro} м; замах ${WD.tele} с.`], ['Атака', `Таран ${WD.ram} с на ${WD.ramV} м/с (толчок ${WD.knock}, подброс ${WD.lift}); отдых ${WD.recover} с.`],
      ['Контр / оглушение', `3 удара за ${WD.comboWin} с, финишер комбо или Порыв, вбивающий его в стену / за край = шатается ${WD.stagger} с.`], ['Оглушён', 'Шатается, раскрыт.'], ['Финал', `Имя <kbd>2</kbd> → освобождён и застывает ступенью-руной. ${finish.split('<span')[1] ? `<span${finish.split('<span')[1]}` : ''}`], ['Награда', '2 искры дыхания, пыль нити и семя.']],
    guard: [['Телеграф', `Стоит у руны ${code(e.guard)}, щитом к герою (поворот ${GD.turn} рад/с). Замах ${GD.tele} с, достаёт на ${GD.reach} м.`], ['Атака', `Удар щитом ${GD.ram} с (толчок ${GD.knock}, подброс ${GD.lift}); после — отдых ${GD.recover} с (окно).`],
      ['Контр / оглушение', 'Спереди щит-кольцо: удары и Порыв в лоб только звенят (белая вспышка). Три удара со спины / сбоку или пока отдыхает после толчка; Порыв сбоку, со спины, на замахе или на отдыхе шатает сразу.'], ['Оглушён', 'Шатается, узел на груди распущен; нить к руне ещё держит.'], ['Финал', `Как любой Страж: спой Имя, пока шатается → нить рвётся, ставит ${code(`enemy.${e.id}.open`)}: руна ${code(e.guard)} оживает.`], ['Награда', `Доступ к руне ${code(e.guard)}.`]],
    boss: [['Старт', `Герой в ${e.r} м от дома босса. Миньоны: ${(e.minions ?? []).map(code).join(', ')}. Мотивы фаз: ${(e.motifs ?? []).map(code).join(' → ')}.`],
      ['Фаза 1 — волны', `Миньоны-шквалы (поводок ${all.find((x) => x.boss === e.id)?.r ?? '?'} м): оглуши всех (контр как у шквала) → окно.`],
      ['Фаза 2 — таран', `Замах ${BOSS.tele} с, таран ${BOSS.ram} с на ${BOSS.ramV} м/с (толчок ${BOSS.knock}); 3 удара посохом (радиус ${BOSS.strikeR}) в отдыхе ${BOSS.recover} с → окно.`],
      ['Фаза 3 — кольца', `Ударные кольца: ${BOSS.rings} шт., каждые ${BOSS.ringEvery} с, скорость ${BOSS.ringV} м/с — перепрыгивай (толчок ${BOSS.ringKnock}) → окно.`],
      ['Окно развязывания', `${BOSS.window} с: Имя <kbd>2</kbd> → следующая фаза. Пропустил окно — фаза повторяется.`], ['Нужный дар', 'Песня Имя (на l3 выдана на старте).'],
      ['Финал', `Третье Имя ставит ${code(`enemy.${e.id}.free`)}: оживают руны Оррена → спеть все → ${code('npc.orren.free')} → цель открыта.`]],
  }[v];
  const extra = [e.tame && 'tame: первый встреченный — заходит со стороны края, бросок толкает героя вглубь острова', e.demo && `demo: показывает песню ${e.demo.song} при флаге ${e.demo.flag} в ${e.demo.r} м`, e.behind && `behind: нельзя назвать, пока стоит ${e.behind}`,
    e.sleep && `sleep: спит на руне последовательности ${e.sleep}, просыпается от фальшивой ноты`, e.motif && `мотив ${e.motif}`, e.path && `патруль ${JSON.stringify(e.path)}`, e.ties && `нити к ${e.ties.length} точк.`].filter(Boolean);
  return `<div class="card" id="${id}-f-${e.id}"><h4>${name} ${code(e.id)} <small>${pos3(e.pos)}</small></h4>${tbl(['', ''], rows, 'kv')}${extra.length ? `<p class="dim">${extra.map(esc).join(' · ')}</p>` : ''}</div>`;
}

// ---------- cutscenes
function cutGeom(L, c) {
  const keys = (c.keys ?? []).map((k, i) => { const s = k.shot ? shotOf(L, k.shot) : k; return { i: i + 1, at: k.at, ease: k.ease, shot: k.shot, play: k.play, pos: s?.pos, look: s?.look }; });
  const cam = keys.filter((k) => k.pos), curve = cam.length > 1 ? new THREE.CatmullRomCurve3(cam.map((k) => new THREE.Vector3(...k.pos)), false, 'centripetal').getPoints(cam.length * 16).map((p) => [p.x, p.z]) : [];
  return { keys, cam, curve, hero: (c.hero?.path ?? []).filter((p) => p.pos), ribbon: c.ribbon?.pts ?? [], actors: (c.actors ?? []).map((a) => (a.path ?? []).filter((p) => p.pos)) };
}
const poly = (pts) => pts.map((p) => `${f2(p[0])},${f2(p[1])}`).join(' ');
function cutSvg(g, col, label) {
  let s = '';
  if (g.ribbon.length) s += `<polyline class="ribbon" points="${poly(g.ribbon.map(xz))}"><title>${esc(label)}: дорога ветра (ribbon)</title></polyline>`;
  if (g.hero.length) s += `<polyline class="hero" points="${poly(g.hero.map((p) => xz(p.pos)))}"><title>${esc(label)}: путь героя</title></polyline>` + g.hero.map((p) => `<circle class="herop" cx="${p.pos[0]}" cy="${p.pos[2]}" r=".45"><title>${esc(label)}: герой t=${p.at} с ${esc(p.clip ?? '')}</title></circle>`).join('');
  for (const a of g.actors) if (a.length) s += `<polyline class="actor" points="${poly(a.map((p) => xz(p.pos)))}"><title>${esc(label)}: актёр</title></polyline>`;
  if (g.curve.length) s += `<polyline class="campath" style="stroke:${col}" points="${poly(g.curve)}"><title>${esc(label)}: путь камеры</title></polyline>`;
  for (const k of g.cam) {
    const [x, z] = xz(k.pos), l = xz(k.look), d = d2([x, z], l) || 1, n = Math.min(d, 7), tx = x + ((l[0] - x) / d) * n, tz = z + ((l[1] - z) / d) * n;
    s += `<line class="look" style="stroke:${col}" x1="${x}" y1="${z}" x2="${f2(tx)}" y2="${f2(tz)}" marker-end="url(#arr)"/><g><title>${esc(label)}: ключ ${k.i}, t=${k.at} с${k.shot ? `, shot ${k.shot}` : ''}; камера ${pos3(k.pos)} смотрит на ${pos3(k.look)}</title><circle cx="${x}" cy="${z}" r="1.05" fill="${col}" stroke="#fff" stroke-width=".15"/><text class="num" x="${x}" y="${z + 0.45}">${k.i}</text></g>`;
  }
  return s;
}
function cutTable(L, c) {
  const rows = new Map(), put = (t, col, s) => { const r = rows.get(t) ?? rows.set(t, ['', '', '', '', '']).get(t); r[col] += (r[col] ? '<br>' : '') + s; };
  const g = cutGeom(L, c);
  g.keys.forEach((k, i) => {
    const p = g.keys[i - 1]; let mv = '';
    if (p?.pos && k.pos) { const dp = Math.hypot(...k.pos.map((v, j) => v - p.pos[j])), dl = Math.hypot(...k.look.map((v, j) => v - p.look[j])); mv = ` ← за ${f1(k.at - p.at)} с: ${dp < 0.3 ? 'камера стоит' : `проезд ${f1(dp)} м (Δy ${f1(k.pos[1] - p.pos[1])})`}, ${dl < 0.3 ? 'взгляд держит' : `взгляд уходит на ${f1(dl)} м`}`; }
    put(k.at, 0, `<b>К${k.i}</b> ${k.play ? 'игровая камера (позиция берётся из игры в момент ключа)' : `${k.shot ? `shot «${esc(k.shot)}» ` : ''}${pos3(k.pos)} → ${pos3(k.look)}`}${k.ease ? ' · ease (стоп)' : ''}${mv}`);
  });
  if (c.hero) { const h = c.hero; if (h.clip) put(h.at ?? 0, 1, `клип ${code(h.clip)}${h.keep ? ', остаётся на месте игрока (keep)' : ''}`); for (const p of h.path ?? []) put(p.at, 1, `герой ${pos3(p.pos)}${p.clip ? ` клип ${code(p.clip)}` : ''}${p.heading != null ? `, курс ${f2(p.heading)}` : ''}`); for (const p of h.pose ?? []) put(p.at, 1, `поза ${esc(JSON.stringify({ ...p, at: undefined }))}`); }
  (c.actors ?? []).forEach((a) => (a.path ?? []).forEach((p) => put(p.at, 1, `актёр ${esc(path.basename(a.glb ?? '', '.glb'))} ${pos3(p.pos)}${p.clip ? ` клип ${code(p.clip)}` : ''}`)));
  for (const l of c.lines ?? []) put(l.at, 2, `${l.who ? `<b>${esc(l.who.ru ?? l.who)}:</b> ` : ''}${ruen(l.text)} <small>(${l.dur} с${l.voice ? `, голос ${esc(l.voice)}` : ''})</small>`);
  for (const e of c.events ?? []) { if (e.cue) put(e.at, 3, `${code(e.cue)}${e.gain != null ? ` ×${e.gain}` : ''}`); else if (e.duck) put(e.at, 3, `приглушение ${e.duck.db} дБ на ${e.duck.seconds} с`); else put(e.at, 4, Object.entries(e).filter(([k]) => k !== 'at').map(([k, v]) => `${k}: ${code(typeof v === 'string' ? v : JSON.stringify(v))}`).join(', ')); }
  for (const r of c.rise ?? []) put(r.at, 4, `rise: ${r.nodes.map(code).join(', ')} поднимаются с −${r.drop} м (${r.dur} с, шаг ${r.stagger})`);
  if (c.ribbon) put(c.ribbon.at, 4, `ribbon: дорога ветра растёт${c.ribbon.grow ? ` ${c.ribbon.grow} с` : ''}`);
  put(c.dur, 0, 'конец');
  return tbl(['t, с', 'Камера', 'Герой / актёры', 'Реплика (RU / EN)', 'Звук', 'FX / события'], [...rows.entries()].sort((a, b) => a[0] - b[0]).map(([t, r]) => [f2(t), ...r]), 'tl');
}

// ---------- overlay SVG per level
const COL = { mid: '#1565c0', best: '#2e7d32', worst: '#d84315' }, CUTCOL = ['#c2185b', '#7b1fa2', '#00838f', '#5d4037'];
const DEFS = `<defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0,0L10,5L0,10z" fill="context-stroke"/></marker></defs>`;
let LB = []; // placed label boxes of the current map: a new label slides down until it is clear (greedy, max 14 rows)
function lab(x, z, s, cls = '') {
  const X = x + 1.6, w = [...String(s)].length * 0.82 + 0.4, hit = (y) => LB.some((b) => X < b[0] + b[2] && b[0] < X + w && Math.abs(b[1] - y) < 1.5);
  let y = z + 0.5; for (let i = 0; i < 14 && hit(y); i++) y += 1.5;
  LB.push([X, y, w]);
  return `${y > z + 1 ? `<line class="lead" x1="${f2(x)}" y1="${f2(z)}" x2="${f2(X - 0.1)}" y2="${f2(y - 0.45)}"/>` : ''}<text class="lb ${cls}" x="${f2(X)}" y="${f2(y)}">${esc(s)}</text>`;
}
const G = (layer, title, body, href) => `<g class="L-${layer}"><title>${esc(title)}</title>${href ? `<a href="${href}">${body}</a>` : body}</g>`;
function routePath(pts) { let d = '', prev = null; for (const p of pts) { const q = [p[1], p[3]]; d += `${!prev || d2(prev, q) > 10 ? 'M' : 'L'}${f1(q[0])},${f1(q[1])}`; prev = q; } return d; }

function overlay(id, L, D, B) {
  const { nodes, runs, beats } = D, o = [], mp = (m) => mechPos(L, m, nodes); LB = [];
  const zones = []; // legend table rows for every scripted zone
  // wind volumes
  for (const m of (L.mechanisms ?? []).filter((x) => x.kind === 'wind')) {
    const a = m.area, up = Math.abs(m.force[1]) > Math.hypot(m.force[0], m.force[2]), cx = (a.min[0] + a.max[0]) / 2, cz = (a.min[2] + a.max[2]) / 2, fl = Math.hypot(m.force[0], m.force[2]) || 1;
    const t = `ветер ${m.id}: сила [${m.force}]${up ? ' (восходящий поток)' : ''}${m.cycle ? `, цикл ${m.cycle.join('/')} с` : ''}${m.active === false ? ', выключен на старте' : ''}${m.after ? `, ждёт ${m.after}` : ''}; высота y ${a.min[1]}..${a.max[1]}`;
    o.push(G('wind', t, `<rect class="wind${m.active === false ? ' off' : ''}" x="${a.min[0]}" y="${a.min[2]}" width="${f2(a.max[0] - a.min[0])}" height="${f2(a.max[2] - a.min[2])}"/>${up ? `<text class="glyph" x="${cx}" y="${cz + 0.6}">⇡</text>` : `<line class="windv" x1="${f2(cx - (m.force[0] / fl) * 1.5)}" y1="${f2(cz - (m.force[2] / fl) * 1.5)}" x2="${f2(cx + (m.force[0] / fl) * 1.5)}" y2="${f2(cz + (m.force[2] / fl) * 1.5)}" marker-end="url(#arr)"/>`}${lab(a.max[0] - 1, a.min[2] + 0.6, m.id, 'c-wind')}`));
  }
  // trigger zones
  for (const t of L.triggers ?? []) {
    const pts = t.shape?.pts ?? [], cx = pts.reduce((a, p) => a + p[0], 0) / (pts.length || 1), tk = t.talk ? talkOf(L, t.talk) : null, known = new Set(['id', 'shape', 'teaches', 'ifFlag', 'once', 'talk', 'hint', 'ifNot']);
    const fires = [t.teaches && `флаг обучения ${code(t.teaches)}`, t.talk && `реплика ${code(t.talk)}${tk ? ` (${esc(tk.npc.name?.ru ?? tk.npc.id)}): ${linesOf(tk.t)}` : ''}`, t.hint && `подсказка HUD: ${ruen(t.hint)}`,
      ...Object.keys(t).filter((k) => !known.has(k)).map((k) => `<b>${esc(k)}</b>: ${code(JSON.stringify(t[k]))}`), `${code(`seen.${t.id}`)} + событие trigger`].filter(Boolean);
    const cond = [t.ifFlag && `если ${code(t.ifFlag)}`, t.ifNot && `если НЕТ ${code(t.ifNot)}`, 'герой внутри контура и не выше 3 м над землёй под ним'].filter(Boolean).join('; ');
    const plain = !t.teaches && !t.talk && !t.hint;
    zones.push([code(t.id), `контур ${pts.length} т.`, fires.join('<br>') + (plain ? '<br><span class="dim">видимого эффекта нет — только отметка seen.*</span>' : ''), cond, t.once === false ? 'каждый вход' : 'один раз']);
    let cam = ''; const c = t.cam ?? t.camera ?? t.shot; const cs = typeof c === 'string' ? shotOf(L, c) : c;
    if (cs?.pos && cs?.look) cam = `<line class="look" stroke="#c2185b" x1="${cs.pos[0]}" y1="${cs.pos[2]}" x2="${cs.look[0]}" y2="${cs.look[2]}" marker-end="url(#arr)"/>`;
    o.push(G('trig', `зона ${t.id}: ${fires.join('; ').replace(/<[^>]+>/g, ' ')} | ${cond.replace(/<[^>]+>/g, '')} | ${t.once === false ? 'каждый вход' : 'один раз'}`, `<polygon class="trig${plain ? ' plain' : ''}" points="${poly(pts)}"/>${cam}${lab(cx - 1.1, Math.min(...pts.map((p) => p[1])) - 0.9, t.id, 'c-trig')}`));
  }
  // checkpoints
  for (const c of L.checkpoints ?? []) { o.push(G('cp', `чекпоинт ${c.id}: сфера r ${c.r} м${c.wind ? ', ветряной каирн (пополняет дыхание)' : ''}; курс после респауна ${c.heading}`, `<circle class="cp${c.wind ? ' wind' : ''}" cx="${c.pos[0]}" cy="${c.pos[2]}" r="${c.r}"/>${lab(c.pos[0] + c.r - 0.8, c.pos[2] - c.r + 0.4, c.id.replace(/^c_/, '⚑'), 'c-cp')}`)); zones.push([code(c.id), `сфера r ${c.r}`, `чекпоинт${c.wind ? ' + ветряной каирн' : ''}`, 'герой в сфере', 'при входе']); }
  // routes
  for (const p of ['worst', 'best', 'mid']) if (runs[p]) o.push(G('route', `маршрут бота ${p}: ${f1(runs[p].t)} с, падений ${runs[p].falls}, конец ${runs[p].end}`, `<path class="route r-${p}" d="${routePath(runs[p].pts)}"/>`));
  for (const p of PROFILES) for (const e of runs[p]?.log ?? []) if (e.event === 'fall') { const q = at(runs[p].pts, e.t - 1.5); o.push(G('risk', `падение бота ${p} на ${f1(e.t)} с${e.detail?.enemy ? ` (сбил ${e.detail.enemy})` : ''}`, `<text class="glyph bad" x="${q[0]}" y="${q[2] + 0.7}">✕</text>`)); }
  // mechanisms
  const link = (a, b, cls) => (a && b ? `<line class="link ${cls}" x1="${f2(a[0])}" y1="${f2(a[1])}" x2="${f2(b[0])}" y2="${f2(b[1])}" marker-end="url(#arr)"/>` : '');
  for (const m of L.mechanisms ?? []) {
    const p = mp(m), b = mechBox(m, nodes);
    if (m.kind === 'switch') {
      if (!p) continue;
      const kind = switchKind(L, m), cls = m.gift ? 'gift' : m.lock ? 'lock' : m.toggle ? 'totem' : m.request ? 'req' : 'rune';
      const links = (m.targets ?? []).map((t) => { const tm = byId(L, t); return tm ? link(p, mp(tm), 'sw') : ''; }).join('');
      const vein = m.vein ? `<polyline class="vein" points="${poly(m.vein.map(xz))}"/>` : '';
      o.push(G('mech', `${kind} ${m.id}. ${switchHow(L, m).replace(/<[^>]+>/g, '')}`, `${vein}${links}<circle class="sing" cx="${p[0]}" cy="${p[1]}" r="${m.r}"/><path class="sw ${cls}" transform="translate(${p[0]},${p[1]})" d="M0,-1.1L1.1,0L0,1.1L-1.1,0z"/>${lab(p[0], p[1], m.id + (m.lock ? ' 🔒' : m.gift ? ` ♪${m.gift}` : m.seq ? ` №${m.order}` : ''), `c-${cls}`)}`));
      if (m.seq) o.push(G('risk', `R4: руна последовательности ${m.id} — неверный порядок = фальшивая нота`, `<text class="glyph bad" x="${p[0] - 1.8}" y="${p[1] - 0.6}">!</text>`));
      if (m.after) zones.push([code(m.id), `руна r ${m.r}`, switchKind(L, m), `ждёт флаг ${code(m.after)}`, m.once ? 'один раз' : 'повторно']);
    } else if (m.kind === 'breakable') {
      o.push(G('mech', `преграда ${m.id}: ${m.size.join('×')} м; ломается ударом посоха или рывком${m.targets ? `; освобождает ${m.targets.join(', ')}` : ''}`, `<rect class="brk" x="${-m.size[0] / 2}" y="-0.5" width="${m.size[0]}" height="1" transform="translate(${p[0]},${p[1]}) rotate(${f1((-m.rotY * 180) / Math.PI)})"/>${lab(p[0] + 0.4, p[1], m.id, 'c-brk')}${(m.targets ?? []).map((t) => link(p, mp(byId(L, t) ?? {}), 'sw')).join('')}`));
    } else if (b && m.kind !== 'wind') {
      const t = m.kind === 'bridge' ? `мост ${m.id}: поднимается из −${Math.abs(m.offset[1])} м за ${m.dur} с${m.hold ? `; держится ${m.hold} с (таймер)` : '; навсегда'}` : m.kind === 'crumble' ? `осыпь ${m.id}: рушится через ${m.delay} с после шага, возвращается через ${m.respawn} с${m.group ? `; группа ${m.group}` : ''}; Якорь (3) останавливает` : `платформа ${m.id}: путь ${JSON.stringify(m.path.map((q) => q.map(f1)))}, режим ${m.mode ?? '—'}, период ${m.period ?? '—'} с${m.after ? `, ждёт ${m.after}` : ''}`;
      const tiny = m.kind === 'platform' && Math.max(...m.path.map((q) => Math.hypot(...q))) < 1; // knot ropes etc.
      o.push(G('mech', t, `<rect class="${m.kind}" x="${f2(b[0])}" y="${f2(b[1])}" width="${f2(b[2] - b[0])}" height="${f2(b[3] - b[1])}"/>${m.kind === 'crumble' || tiny ? '' : lab(b[2] - 0.8, b[1] + 0.9, m.id + (m.hold ? ` ⏱${m.hold}с` : m.kind === 'platform' ? ' ⇅' : ''), `c-${m.kind}`)}`));
    } else if (m.kind !== 'wind') warn(`${id}: mechanism ${m.id} (${m.kind}) has no pos and its node was not found in the scene: not drawn`);
  }
  // trials
  for (const t of L.trials ?? []) {
    const p = xz(t.pos);
    if (t.kind === 'pillar') { o.push(G('mech', `столб ${t.id}: ${t.repair ? 'уже сломан — Имя у дальнего конца настила чинит' : 'удар/Порыв валит его, настил падает (R4: broken.' + t.id + ')'}`, `<line class="deck" x1="${t.deck.a[0]}" y1="${t.deck.a[2]}" x2="${t.deck.b[0]}" y2="${t.deck.b[2]}" stroke-width="${t.deck.w}"/><circle class="pillar" cx="${p[0]}" cy="${p[1]}" r="0.8"/>${lab(p[0], p[1], t.id, 'c-brk')}`)); if (!t.repair) o.push(G('risk', `R4: не бей столб ${t.id} — настил рухнет (−1 гармония)`, `<text class="glyph bad" x="${p[0] - 1.6}" y="${p[1] - 0.5}">!</text>`)); }
    else if (t.kind === 'slab') { o.push(G('mech', `плита ${t.id}: опускается, когда герой в ${t.r} м от ${JSON.stringify(t.near)}; Якорь держит ${t.hold} с; Якорь впустую — цепи рвутся (R4)`, `<rect class="slab" x="${f2(p[0] - t.size[0] / 2)}" y="${f2(p[1] - t.size[2] / 2)}" width="${t.size[0]}" height="${t.size[2]}"/>${lab(p[0], p[1], t.id, 'c-brk')}`)); o.push(G('risk', `R4: плита ${t.id} — Якорь мимо рвёт цепи`, `<text class="glyph bad" x="${p[0] - 1.6}" y="${p[1] - 0.5}">!</text>`)); }
    else o.push(G('mech', `${t.kind} ${t.id}${t.kind === 'bell' ? ': прыжок сверху звонит' : ''}`, `<circle class="pillar" cx="${p[0]}" cy="${p[1]}" r="0.7"/>${lab(p[0], p[1], t.id, 'c-brk')}`));
  }
  // locks (R6): switches + the dash lock from feasibility
  const locks = (L.mechanisms ?? []).filter((m) => m.lock).map((m) => ({ p: xz(m.pos), need: m.lock }));
  for (const f of L.feasibility?.blocked ?? []) if (f.lock && !/name|gust/.test(f.lock)) { const c = (L.checkpoints ?? []).find((x) => x.id.includes(f.to.replace(/_isl$/, ''))); if (c) { locks.push({ p: xz(c.pos), need: f.lock }); o.push(G('mech', `замок R6 без руны: ${f.needs} (разрыв ${f.dist} м)`, lab(c.pos[0] - 2, c.pos[2] + 3.2, `🔒 ${f.lock}`, 'c-lock'))); } }
  // echoes
  for (const e of L.echoSlots ?? []) {
    const locked = /lock/i.test(e.note ?? ''), lk = locked && locks.length ? locks.reduce((a, b) => (d2(b.p, xz(e.pos)) < d2(a.p, xz(e.pos)) ? b : a)) : null; // ponytail: nearest-lock heuristic, level.json has no echo -> lock link
    e._need = lk?.need;
    o.push(G('echo', `эхо ${e.id}${e.relic ? ` (реликвия ${e.relic})` : ''}: ${e.note ?? ''}${lk ? ` — за замком, нужно: ${LOCK[lk.need] ?? lk.need}` : ''}`, `<circle class="echo${e.relic ? ' relic' : ''}${locked ? ' locked' : ''}" cx="${e.pos[0]}" cy="${e.pos[2]}" r="0.75"/>${lab(e.pos[0] - 0.2, e.pos[2] + 1.6, e.id.replace(/^echo_/, 'э:'), 'c-echo')}`));
  }
  // NPCs + gifts
  for (const n of L.npcs ?? []) {
    if (!n.pos) continue; const p = xz(n.pos);
    const br = n.bark ? `<circle class="bark" cx="${p[0]}" cy="${p[1]}" r="${n.bark.r}"/>` : '';
    if (n.bark) zones.push([code(`${n.id}.bark`), `круг r ${n.bark.r} у NPC`, `реплика ${code(n.bark.talk)}: ${linesOf(talkOf(L, n.bark.talk)?.t)}`, n.bark.until ? `пока нет ${code(n.bark.until)}` : '—', `${n.bark.every ? `каждые ${n.bark.every} с` : 'повторяется (интервал по умолчанию)'}`]);
    o.push(G('npc', `NPC ${n.name?.ru ?? n.id} (${n.kind}); камни просьбы: ${(n.switches ?? []).join(', ')}${n.bark ? `; окликает в ${n.bark.r} м${n.bark.every ? ` каждые ${n.bark.every} с` : ''}` : ''}`, `${br}${(n.switches ?? []).map((s) => link(p, mp(byId(L, s) ?? {}), 'npcl')).join('')}<circle class="npc" cx="${p[0]}" cy="${p[1]}" r="1.1"/>${lab(p[0], p[1] - 1.2, n.name?.ru ?? n.id, 'c-npc')}`));
  }
  for (const g of L.gifts ?? []) o.push(G('npc', `дар ${GIFT[g.id] ?? g.id}: ${g.npc ? `от NPC ${g.npc}` : `святилище ${g.shrine}`}`, `<text class="glyph gift" x="${g.at[0]}" y="${g.at[2] - 1.4}">★</text>${lab(g.at[0] + 0.3, g.at[2] - 2, `дар: ${g.id}`, 'c-gift')}`));
  // enemies
  for (const e of L.enemies ?? []) {
    const p = xz(e.pos), ag = e.kind === 'boss' ? e.r : e.aggro ?? (e.variant === 'pull' ? K.PL.aggro : e.kind === 'warden' ? (e.guard ? K.GD.reach : K.WD.aggro) : K.SQ.aggro), leash = e.kind === 'squall' && e.variant !== 'pull' ? e.r ?? K.SQ.r : null;
    const kind = e.kind === 'boss' ? 'босс' : e.guard ? 'сторож' : e.kind === 'warden' ? 'страж' : e.variant === 'thief' ? 'вор' : e.variant === 'pull' ? 'втягиватель' : 'шквал';
    const pathSvg = e.path && d2(e.path[0], e.path[1]) > 0.1 ? `<polyline class="patrol" points="${poly(e.path)}"/>` : '';
    o.push(G('enemy', `${kind} ${e.id}: агро ${ag} м${leash ? `, поводок/арена ${leash} м` : ''}${e.boss ? `, миньон босса ${e.boss}` : ''}${e.guard ? `, сторожит руну ${e.guard}` : ''} — карточка боя ниже`, `${e.boss ? '' : `<circle class="aggro" cx="${p[0]}" cy="${p[1]}" r="${ag}"/>`}${leash && !e.boss ? `<circle class="leash" cx="${p[0]}" cy="${p[1]}" r="${leash}"/>` : ''}${pathSvg}${e.guard ? link(p, mp(byId(L, e.guard) ?? {}), 'en') : ''}<path class="enemy" transform="translate(${p[0]},${p[1]})" d="M0,-1.2L1.1,0.8L-1.1,0.8z"/>${e.boss ? '' : lab(p[0], p[1] + 1.4, `${e.id} ${kind}`, 'c-enemy')}`, `#${id}-f-${e.boss ?? e.id}`));
    if (!e.boss) zones.push([code(e.id), `круг r ${ag}${leash ? ` (поводок ${leash})` : ''}`, e.kind === 'boss' ? 'старт боя с боссом (фаза 1)' : `агро: ${kind} начинает телеграф`, e.behind ? `назвать можно после ${code(e.behind)}` : '—', 'пока не освобождён']);
    if (e.kind !== 'boss' && !e.guard) o.push(G('risk', `R4: три удара по оглушённому ${e.id} разбивают его (−1 гармония)`, `<text class="glyph bad" x="${p[0] - 2}" y="${p[1] - 0.6}">!</text>`));
  }
  // spawn / goal
  const sp = L.spawn.pos, h = L.spawn.heading ?? 0;
  o.push(G('cp', `старт: ${pos3(sp)}, курс ${h}`, `<circle class="spawn" cx="${sp[0]}" cy="${sp[2]}" r="1.2"/><line class="look" stroke="#000" x1="${sp[0]}" y1="${sp[2]}" x2="${f2(sp[0] + Math.sin(h) * 3)}" y2="${f2(sp[2] + Math.cos(h) * 3)}" marker-end="url(#arr)"/>${lab(sp[0], sp[2] + 2.2, 'СТАРТ', 'c-goal')}`));
  o.push(G('cp', `цель: круг r ${L.goal.r}${L.goal.after ? `, открыт после ${L.goal.after}` : ''}`, `<circle class="goal" cx="${L.goal.pos[0]}" cy="${L.goal.pos[2]}" r="${Math.max(L.goal.r, 1.2)}"/>${lab(L.goal.pos[0], L.goal.pos[2] - 2, 'ЦЕЛЬ', 'c-goal')}`));
  zones.push([code('goal'), `круг r ${L.goal.r}`, 'конец уровня → итоги → катсцена outro / finale', L.goal.after ? `ждёт флаг ${code(L.goal.after)}` : '—', 'один раз']);
  // cutscenes
  Object.entries(L.cutscenes ?? {}).forEach(([n, c], i) => {
    const g = cutGeom(L, c), lbl = `катсцена ${n} «${CUT_RU[`${id}.${n}`] ?? ''}»`;
    o.push(`<g class="L-cut cut-${n}">${cutSvg(g, CUTCOL[i % 4], lbl)}${g.cam[0] ? lab(g.cam[0].pos[0], g.cam[0].pos[2] - 1.6, `🎬 ${n}`, 'c-cut') : ''}</g>`);
    // wind road between levels: always visible (not only with the cutscene layer)
    const road = n === 'arrive' ? g.hero.map((p) => xz(p.pos)) : g.ribbon.map(xz);
    if (road.length > 1 && (n === 'arrive' || /outro/.test(n))) { const e = n === 'arrive' ? road[0] : road[road.length - 1], txt = n === 'arrive' ? '⇣ прилёт по дороге ветра' : `⇢ дорога ветра${L.next ? ` на ${L.next}` : ''}`;
      o.push(G('cp', n === 'arrive' ? `дорога ветра: прилёт с прошлого уровня (катсцена arrive), посадка ${pos3(g.hero[g.hero.length - 1].pos)}` : `дорога ветра: выход с уровня (катсцена ${n}) от ${pos3(g.ribbon[0])} до ${pos3(g.ribbon[g.ribbon.length - 1])}${L.next ? `, дальше ${L.next}` : ''}`, `<polyline class="ribbon" points="${poly(road)}" marker-end="url(#arr)"/>${lab(Math.min(Math.max(e[0], B[0] + 2), B[2] - 22), Math.min(Math.max(e[1], B[1] + 3), B[3] - 3), txt, 'c-cut')}`)); }
  });
  // beats on top
  beats.forEach((b, i) => o.push(G('beat', `шаг ${i + 1} (${f1(b.t)} с): ${beatTitle(L, b)}`, `<circle class="beat" cx="${f2(b.pos[0])}" cy="${f2(b.pos[2])}" r="1.25"/><text class="num" x="${f2(b.pos[0])}" y="${f2(b.pos[2] + 0.5)}">${i + 1}</text>`, `#${id}-b${i + 1}`)));
  return { svg: o.join('\n'), zones };
}
const mapSvg = (id, B, inner, attrs = '', vb = B) => `<svg xmlns="http://www.w3.org/2000/svg" class="mapsvg" viewBox="${vb[0]} ${vb[1]} ${vb[2] - vb[0]} ${vb[3] - vb[1]}" ${attrs}>${DEFS}<image href="img/${id}.map.jpg" x="${B[0]}" y="${B[1]}" width="${B[2] - B[0]}" height="${B[3] - B[1]}" preserveAspectRatio="none"/>${inner}</svg>`;

// ---------- CSS
const LAYERS = [['route', 'маршруты'], ['beat', 'шаги'], ['cp', 'чекпоинты'], ['mech', 'механизмы'], ['wind', 'ветры'], ['npc', 'NPC и дары'], ['enemy', 'враги'], ['echo', 'эхо'], ['trig', 'зоны-триггеры'], ['cut', 'катсцены'], ['risk', 'R4 / падения']];
const SVGCSS = `
.mapsvg text{font:1.45px/1 system-ui,sans-serif;paint-order:stroke;stroke:#fff;stroke-width:.4px;stroke-linejoin:round}
.mapsvg .lb{font-weight:600}.mapsvg .num{font-size:1.35px;font-weight:700;text-anchor:middle;fill:#fff;stroke:none}
.mapsvg .glyph{font-size:2.4px;text-anchor:middle;font-weight:700}.mapsvg .bad{fill:#c62828}.mapsvg .gift{fill:#8e24aa}
.route{fill:none;stroke-width:.5;stroke-linejoin:round;stroke-linecap:round;opacity:.9}.r-mid{stroke:#1565c0;stroke-width:.3}.r-best{stroke:#2e7d32;stroke-dasharray:1.6 1;stroke-width:.6}.r-worst{stroke:#d84315;stroke-dasharray:.1 1.1;stroke-width:.7}.lead{stroke:#333;stroke-width:.08}
.cp{fill:rgba(30,136,229,.12);stroke:#1e88e5;stroke-width:.2}.cp.wind{stroke-dasharray:.6 .4;fill:rgba(0,188,212,.2)}.c-cp{fill:#0d47a1}
.spawn{fill:#fff;stroke:#000;stroke-width:.3}.goal{fill:rgba(255,193,7,.35);stroke:#ff8f00;stroke-width:.4}.c-goal{fill:#000;font-size:1.7px!important}
.beat{fill:#212121;stroke:#fff;stroke-width:.2}
.sing{fill:none;stroke:#f9a825;stroke-width:.1;stroke-dasharray:.3 .3}.sw{stroke:#3e2723;stroke-width:.15}.sw.rune{fill:#fbc02d}.sw.totem{fill:#26a69a}.sw.gift{fill:#ab47bc}.sw.lock{fill:#424242}.sw.req{fill:#ec407a}
.c-rune{fill:#8d5a00}.c-totem{fill:#00695c}.c-gift{fill:#6a1b9a}.c-lock{fill:#212121}.c-req{fill:#ad1457}
.link{stroke-width:.18;fill:none}.link.sw{stroke:#f57f17;stroke-dasharray:.7 .4}.link.npcl{stroke:#2e7d32;stroke-dasharray:.3 .4}.link.en{stroke:#c62828;stroke-dasharray:.3 .3}
.vein{fill:none;stroke:#ffb300;stroke-width:.25;stroke-dasharray:.2 .5;stroke-linecap:round}
.brk{fill:#8d6e63;stroke:#3e2723;stroke-width:.15}.c-brk{fill:#4e342e}.bridge{fill:rgba(0,150,136,.25);stroke:#00796b;stroke-width:.2}.c-bridge{fill:#004d40}
.platform{fill:rgba(63,81,181,.25);stroke:#303f9f;stroke-width:.2}.c-platform{fill:#1a237e}.crumble{fill:rgba(255,112,67,.35);stroke:#e64a19;stroke-width:.15;stroke-dasharray:.3 .2}
.deck{stroke:rgba(141,110,99,.55)}.pillar{fill:#6d4c41;stroke:#fff;stroke-width:.15}.slab{fill:rgba(96,125,139,.4);stroke:#37474f;stroke-width:.2}
.wind{fill:rgba(0,188,212,.22);stroke:#0097a7;stroke-width:.15}.wind.off{stroke-dasharray:.5 .4;fill:rgba(0,188,212,.08)}.windv{stroke:#006064;stroke-width:.3}.c-wind{fill:#006064;font-weight:400!important;font-size:1.2px!important}.L-wind .glyph{fill:#006064}
.npc{fill:#43a047;stroke:#fff;stroke-width:.2}.c-npc{fill:#1b5e20}.bark{fill:rgba(67,160,71,.07);stroke:#43a047;stroke-width:.12;stroke-dasharray:.5 .5}
.enemy{fill:#e53935;stroke:#fff;stroke-width:.2}.aggro{fill:rgba(229,57,53,.1);stroke:#e53935;stroke-width:.14}.leash{fill:none;stroke:#e53935;stroke-width:.1;stroke-dasharray:.5 .5}.patrol{stroke:#b71c1c;stroke-width:.5;fill:none;stroke-linecap:round}.c-enemy{fill:#b71c1c}
.echo{fill:#e1f5fe;stroke:#0277bd;stroke-width:.2}.echo.relic{fill:#ffd54f}.echo.locked{stroke:#212121;stroke-dasharray:.3 .2;stroke-width:.3}.c-echo{fill:#01579b;font-weight:400!important;font-size:1.2px!important}
.trig{fill:rgba(123,31,162,.13);stroke:#7b1fa2;stroke-width:.16;stroke-dasharray:.6 .3}.trig.plain{fill:rgba(120,120,120,.1);stroke:#757575}.c-trig{fill:#4a148c;font-weight:400!important;font-size:1.2px!important}
.campath{fill:none;stroke-width:.3}.look{stroke-width:.2}.hero{fill:none;stroke:#000;stroke-width:.25;stroke-dasharray:.6 .4}.herop{fill:#000}.actor{fill:none;stroke:#6d4c41;stroke-width:.2;stroke-dasharray:.2 .3}
.ribbon{fill:none;stroke:rgba(255,202,40,.7);stroke-width:1.2;stroke-linecap:round;stroke-linejoin:round}.c-cut{fill:#880e4f}
.mapsvg a{cursor:pointer}`;
const CSS = `
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,-apple-system,sans-serif;color:#1c1c1c;background:#f4f1ea}
input[name=tab],.tg{position:absolute;opacity:0;pointer-events:none}
nav{position:sticky;top:0;z-index:5;background:#2b2a33;padding:6px 12px;display:flex;gap:6px;align-items:center;color:#ddd}
nav b{margin-right:12px;color:#fff}nav label{padding:5px 14px;border-radius:6px;cursor:pointer;background:#44424f;color:#eee}
.panel{display:none;padding:0 12px 60px}
${[...LEVELS, 'leg'].map((t) => `#tab-${t}:checked~main #p-${t}{display:block}#tab-${t}:checked~nav label[for=tab-${t}]{background:#f4c95d;color:#000}`).join('')}
.bar{position:sticky;top:38px;z-index:4;background:#f4f1ea;padding:6px 0;display:flex;flex-wrap:wrap;gap:4px;align-items:center;font-size:12px}
.bar label{padding:2px 8px;border:1px solid #999;border-radius:10px;cursor:pointer;background:#ddd;color:#777;user-select:none}
${LAYERS.map(([k]) => `.tg-${k}:checked~.bar label.for-${k}{background:#fff;color:#000;border-color:#333}.tg-${k}:not(:checked)~.cols .map .L-${k}{display:none}`).join('')}
.cols{display:flex;gap:16px;align-items:flex-start}.map{position:sticky;top:76px;height:calc(100vh - 84px);overflow:auto;flex:0 0 auto;border:1px solid #999;background:#cfd8e3;max-width:58vw}
.map svg{display:block}.txt{flex:1;min-width:0}
h2{margin:18px 0 6px;border-bottom:2px solid #c9b88a;padding-bottom:2px}h3{margin:16px 0 4px}h4{margin:0 0 4px}
table{border-collapse:collapse;margin:6px 0;width:100%;font-size:13px}th,td{border:1px solid #cdc6b4;padding:3px 6px;vertical-align:top;text-align:left}th{background:#e7e0cc}
table.kv td:first-child{white-space:nowrap;font-weight:600;width:1%}table.kv th{display:none}table.tl td:first-child{white-space:nowrap;font-weight:700}
code{background:#e9e4d6;padding:0 3px;border-radius:3px;font-size:12px}kbd{border:1px solid #888;border-bottom-width:2px;border-radius:3px;padding:0 4px;background:#fff;font:12px monospace}
.dim,.en{color:#777}.bad{color:#c62828;font-weight:600}small{color:#666;font-weight:400}
.step{display:flex;gap:10px;padding:8px;margin:6px 0;background:#fff;border:1px solid #d8d1bd;border-radius:6px}.step:target,.card:target{outline:3px solid #f4c95d}
.step img{width:240px;height:135px;flex:0 0 auto;border-radius:4px;background:#ccc}.step .n{display:inline-block;min-width:22px;text-align:center;background:#212121;color:#fff;border-radius:11px;padding:0 6px;margin-right:6px}
.step ul{margin:4px 0;padding-left:18px}.step li{margin:2px 0}
.card{background:#fff;border:1px solid #d8d1bd;border-left:4px solid #e53935;border-radius:6px;padding:8px 10px;margin:8px 0}
.cut{background:#fff;border:1px solid #d8d1bd;border-left:4px solid #c2185b;border-radius:6px;padding:8px 10px;margin:10px 0}.cut .mini{float:right;margin:0 0 8px 12px;border:1px solid #999}
.strip{display:flex;gap:4px;overflow-x:auto;padding:4px 0;clear:both}.strip figure{margin:0;flex:0 0 auto;font-size:11px;text-align:center}.strip img{display:block;width:192px;height:108px}
.sw-l{display:inline-block;width:28px;height:0;border-top:3px solid;vertical-align:middle;margin-right:4px}
${SVGCSS}`;

// ---------- sections
function stepsHtml(id, L, D) {
  return D.beats.map((b, i) => {
    const fr = D.thumbs[i], pre = preText(L, b.pre);
    return `<div class="step" id="${id}-b${i + 1}">${fr ? `<img loading="lazy" src="${fr}" alt="">` : ''}<div><span class="n">${i + 1}</span><b>${esc(beatTitle(L, b))}</b> <small>t ≈ ${f1(b.t)} с (бот mid) · ${pos3(b.pos)}</small>
<ul>${b.items.filter((e, j, a) => !(e.event === 'song' && a.some((x) => x.event === 'unbind' && x.detail === e.detail?.id))).map((e) => `<li>${itemText(L, id, e, b)}</li>`).join('')}</ul>${pre ? `<div class="dim">На подходе: ${pre}</div>` : ''}</div></div>`;
  }).join('\n');
}
function runsHtml(D) {
  const rows = PROFILES.filter((p) => D.runs[p]).map((p) => [`<span class="sw-l" style="border-color:${COL[p]};border-top-style:${{ mid: 'solid', best: 'dashed', worst: 'dotted' }[p]}"></span>${p}`, D.runs[p].end, f1(D.runs[p].t), D.runs[p].falls]);
  const sec = D.runs.mid?.log.find((e) => e.event === 'summary')?.detail?.sections ?? [];
  return tbl(['профиль (линия на карте)', 'конец', 'время, с', 'падений'], rows) + (sec.length ? `<details><summary>Участки между чекпоинтами (mid)</summary>${tbl(['от', 'до', 'с', 'падений', 'рун', 'фальшь', 'песен', 'впустую'], sec.map((s) => [code(s.from), code(s.to), s.s, s.falls, s.switches, s.wrong, s.songs, s.wasted]))}</details>` : '');
}
function officialHtml(id) {
  if (!BOTS) return '';
  const rows = [];
  for (const p of fs.existsSync(BOTS) ? fs.readdirSync(BOTS).sort() : []) { const f = path.join(BOTS, p, `${id}.json`); if (!fs.existsSync(f)) continue; try { const j = JSON.parse(fs.readFileSync(f, 'utf8')); rows.push([esc(p), j.end, j.gameSeconds, j.falls, (j.errors ?? []).length]); } catch { warn(`bad bot file ${f}`); } }
  return rows.length ? `<h3>Официальные прогоны (${esc(path.basename(BOTS))})</h3>${tbl(['профиль', 'конец', 'время, с', 'падений', 'ошибок'], rows)}` : '';
}
function cutsHtml(id, L, D, B, strips) {
  return Object.entries(L.cutscenes ?? {}).map(([n, c], i) => {
    const g = cutGeom(L, c), pts = [...g.cam.flatMap((k) => [xz(k.pos)]), ...g.hero.map((p) => xz(p.pos)), ...g.ribbon.slice(0, 3).map(xz), ...g.curve];
    const cl = (v, a, b) => Math.max(a, Math.min(b, v)), M = 9;
    let vb = pts.length ? [cl(Math.min(...pts.map((p) => p[0])) - M, B[0], B[2]), cl(Math.min(...pts.map((p) => p[1])) - M, B[1], B[3]), cl(Math.max(...pts.map((p) => p[0])) + M, B[0], B[2]), cl(Math.max(...pts.map((p) => p[1])) + M, B[1], B[3])] : B;
    const w = 380, hh = Math.round((w * (vb[3] - vb[1])) / (vb[2] - vb[0]));
    const st = strips[`${id}.${n}`] ?? [];
    return `<div class="cut" id="${id}-c-${n}"><h4>🎬 ${esc(n)} — «${esc(CUT_RU[`${id}.${n}`] ?? n)}» <small>${c.dur} с · цвет на карте <span class="sw-l" style="border-color:${CUTCOL[i % 4]}"></span></small></h4>
<div class="mini">${mapSvg(id, B, cutSvg(g, CUTCOL[i % 4], n), `width="${w}" height="${Math.min(hh, 520)}"`, vb)}</div>
<p>${CUT_WHEN[n] ?? ''}</p><p class="dim">На карте: линия — путь камеры (центростремительный Catmull-Rom через ключи), кружки — ключи по порядку, стрелка — куда смотрит; чёрный пунктир — путь героя; жёлтая лента — дорога ветра.${g.keys.some((k) => k.play) ? ' Ключи «play» берут позицию игровой камеры — на карте их нет.' : ''}</p>
${cutTable(L, c)}${st.length ? `<div class="strip">${st.map(([t, f]) => `<figure><img loading="lazy" src="${f}" alt="">${t.toFixed(1)} с</figure>`).join('')}</div>` : '<p class="dim">кадров нет (--strips)</p>'}</div>`;
  }).join('\n');
}
function npcHtml(L) {
  return (L.npcs ?? []).map((n) => `<h4>${esc(n.name?.ru ?? n.id)} <small>${code(n.id)} · ${esc(n.kind)} ${pos3(n.pos)}${n.switches ? ` · камни: ${n.switches.map(code).join(', ')}` : ''}${n.show ? ` · виден после ${code(n.show)}` : ''}</small></h4>` +
    tbl(['реплика', 'условие', 'ставит', 'текст RU / EN'], (n.talk ?? []).map((t) => [code(t.id), [t.on && `когда ${code(t.on)}`, t.if && `если ${code(t.if)}`, t.until && `пока нет ${code(t.until)}`, t.r && `в ${t.r} м`, t.once === false && 'повторяется'].filter(Boolean).join('; ') || '<span class="dim">по вызову (зона / оклик / событие)</span>',
      [...(t.set ?? []).map((f) => code(f) + (f.startsWith('gift.') ? ` — дар ${GIFT[f.slice(5)] ?? ''}` : '')), t.end && `${code(t.end)} (в конце)`, t.request && `просьба ${code(t.request)}`].filter(Boolean).join('<br>'), linesOf(t)]))).join('');
}
function flagsHtml(L) {
  const rows = [];
  for (const m of L.mechanisms ?? []) if (m.after) rows.push([code(m.after), `${m.kind} ${code(m.id)}`, m.kind === 'switch' ? 'руна оживает' : m.kind === 'wind' ? 'ветер включается' : 'платформа едет']);
  if (L.goal?.after) rows.push([code(L.goal.after), 'цель', 'круг цели открывается']);
  for (const n of L.npcs ?? []) { for (const t of n.talk ?? []) { if (t.on) rows.push([code(t.on), `реплика ${code(t.id)}`, `говорит ${esc(n.name?.ru ?? n.id)}${t.set ? `; ставит ${t.set.map(code).join(', ')}` : ''}${t.end ? `; в конце ${code(t.end)}` : ''}`]); if (t.if) rows.push([code(t.if), `реплика ${code(t.id)}`, 'условие']); } if (n.bark?.until) rows.push([code(n.bark.until), `оклик ${code(n.id)}`, 'оклики прекращаются']); if (n.show) rows.push([code(n.show), `NPC ${code(n.id)}`, 'становится виден']); }
  for (const t of L.triggers ?? []) { if (t.ifFlag) rows.push([code(t.ifFlag), `зона ${code(t.id)}`, 'зона активна только с флагом']); if (t.ifNot) rows.push([code(t.ifNot), `зона ${code(t.id)}`, 'зона активна только БЕЗ флага']); }
  for (const e of L.enemies ?? []) { if (e.guard) rows.push([code(`enemy.${e.id}.open`), `сторож ${code(e.id)}`, `ставится, когда сторож побеждён → руна ${code(e.guard)}`]); if (e.behind) rows.push([code(`(освобождён ${e.behind})`), `враг ${code(e.id)}`, 'можно назвать']); }
  return tbl(['флаг', 'кто ждёт / ставит', 'что происходит'], rows.sort((a, b) => a[0].localeCompare(b[0])));
}
function mechHtml(L, nodes) {
  return tbl(['id', 'тип', 'где', 'параметры'], (L.mechanisms ?? []).map((m) => { const p = mechPos(L, m, nodes), { id, kind, node, nodes: _n, pos, vein, area, ...rest } = m; return [code(id), kind === 'switch' ? switchKind(L, m) : kind, p ? `[${p.map(f1).join(', ')}]` : '?', esc(JSON.stringify(rest)).replace(/,&quot;/g, ', &quot;')]; })) +
    ((L.trials ?? []).length ? `<h4>Испытания (trials)</h4>${tbl(['id', 'тип', 'где', 'параметры'], L.trials.map(({ id, kind, pos, ...r }) => [code(id), kind, pos3(pos), esc(JSON.stringify(r)).replace(/,&quot;/g, ', &quot;')]))}` : '');
}
function levelHtml(id, L, D, B, strips) {
  const ov = overlay(id, L, D, B), W = Math.round((B[2] - B[0]) * 7);
  const enemies = (L.enemies ?? []).filter((e) => !e.boss);
  const html = `<section class="panel" id="p-${id}">
${LAYERS.map(([k]) => `<input type="checkbox" class="tg tg-${k}" id="${id}-tg-${k}" ${k === 'cut' ? '' : 'checked'}>`).join('')}
<div class="bar"><b>${id.toUpperCase()} · ${esc(L.title)}</b> слои: ${LAYERS.map(([k, n]) => `<label class="for-${k}" for="${id}-tg-${k}">${n}</label>`).join('')}
 масштаб <input type="range" min="3" max="16" step="0.5" value="7" oninput="this.closest('section').querySelector('.map svg').setAttribute('width',this.value*${B[2] - B[0]})"> <a href="${id}.png">${id}.png</a></div>
<div class="cols"><div class="map">${mapSvg(id, B, ov.svg, `width="${W}"`)}</div><div class="txt">
<h2>${id.toUpperCase()} — ${esc(L.title)}</h2>
<p>Старт ${pos3(L.spawn.pos)} → цель ${pos3(L.goal.pos)}${L.goal.after ? ` (открывается после ${code(L.goal.after)})` : ''}. Падение ниже y = ${L.killY}. Дары на старте: ${(L.startGifts ?? []).map((g) => GIFT[g] ?? g).join(', ') || 'нет'}. Наведи курсор на любой знак карты — всплывёт описание; номера шагов кликабельны.</p>
${runsHtml(D)}${officialHtml(id)}
<h3>Шаги (номера = кружки на карте)</h3>${stepsHtml(id, L, D)}
<h3>Бои</h3>${enemies.length ? enemies.map((e) => fightCard(L, id, e, L.enemies)).join('') : '<p class="dim">врагов нет</p>'}
<h3>Катсцены</h3>${cutsHtml(id, L, D, B, strips)}
<h3>NPC, просьбы, дары</h3>
${tbl(['дар', 'где', 'от кого'], (L.gifts ?? []).map((g) => [GIFT[g.id] ?? g.id, pos3(g.at), g.npc ? `NPC ${code(g.npc)}` : `святилище ${code(g.shrine)}`]))}${npcHtml(L)}
<h3>Эхо и реликвии</h3>${tbl(['id', 'где', 'реликвия', 'заметка', 'замок: что нужно'], (L.echoSlots ?? []).map((e) => [code(e.id), pos3(e.pos), e.relic ? code(e.relic) : '', esc(e.note), e._need ? esc(LOCK[e._need] ?? e._need) : '']))}
<h3>Зоны и триггеры (отладка)</h3><p class="dim">Всё, что срабатывает от положения героя. Фиолетовые контуры — зоны с эффектом, серые — только отметка seen.*; красные круги — агро врагов; зелёный пунктир — оклик NPC.</p>
${tbl(['id', 'зона', 'что срабатывает', 'условие', 'раз / повтор'], ov.zones)}
<h3>Флаги-ворота</h3>${flagsHtml(L)}
<h3>Преграды маршрута (feasibility.blocked)</h3>${tbl(['откуда → куда', 'что нужно', 'данные'], (L.feasibility?.blocked ?? []).map(({ from, to, needs, ...r }) => [`${esc(from)} → ${esc(to)}`, esc(needs), esc(JSON.stringify(r))]))}
<details><summary><b>Все механизмы (таблица)</b></summary>${mechHtml(L, D.nodes)}</details>
</div></div></section>`;
  return { html, svg: mapSvg(id, B, ov.svg, `width="${Math.round((B[2] - B[0]) * 10)}"`) };
}
function legendHtml(all) {
  const st = K.STAGE_T, stage = (a) => [0, 1, 2, 3].map((i) => a[i] ?? '?');
  const songUse = LEVELS.flatMap((id) => all[id].beats.flatMap((b, i) => b.items.filter((e) => e.event === 'song' || e.event === 'unbind').map((e) => [id, `<a href="#${id}-b${i + 1}" onclick="document.getElementById('tab-${id}').checked=true">шаг ${i + 1}</a>`, e.event === 'unbind' ? SONG.name : SONG[e.detail.song] ?? e.detail.song, code(e.event === 'unbind' ? e.detail : e.detail.id)])));
  const lockUse = LEVELS.flatMap((id) => (levels[id].mechanisms ?? []).filter((m) => m.lock || m.far || m.dust).map((m) => [id, 'вне маршрута бота / по желанию', [m.dust && SONG.gust, (m.far || m.lock) && SONG.name, m.lock && `замок: ${LOCK[m.lock]}`].filter(Boolean).join(' + '), code(m.id)]));
  const cnt = LEVELS.map((id) => { const L = levels[id]; return [id, (L.echoSlots ?? []).filter((e) => !e.relic).length, (L.echoSlots ?? []).filter((e) => /^tale/.test(e.relic ?? '')).length, (L.mechanisms ?? []).filter((m) => m.request).map((m) => code(m.id)).join(', '), [...(L.enemies ?? []).filter((e) => !e.guard && e.kind !== 'boss').map((e) => e.id), ...(L.trials ?? []).filter((t) => (t.kind === 'pillar' && !t.repair) || t.kind === 'slab').map((t) => t.id)].map(code).join(', ')]; });
  return `<section class="panel" id="p-leg"><div class="txt" style="max-width:1100px">
<h2>Легенда карты</h2>
${tbl(['знак', 'что это'], [['<span class="sw-l" style="border-color:#1565c0"></span> / <span class="sw-l" style="border-color:#2e7d32;border-top-style:dashed"></span> / <span class="sw-l" style="border-color:#d84315;border-top-style:dotted"></span>', 'маршруты ботов: mid (сплошная), best (штрих), worst (точки); записаны этим скриптом в тестовом режиме'],
    ['чёрный кружок с номером', 'шаг прохождения (клик → описание шага)'], ['синий круг ⚑', 'чекпоинт (радиус сферы); бирюзовый пунктир — ветряной каирн'], ['жёлтый ромб', 'руна; жёлтая пунктирная стрелка — что она включает; жёлтые точки — жила к спрятанной руне; тонкий круг — радиус пения'],
    ['бирюзовый / фиолетовый / чёрный / розовый ромб', 'тотем ветра / святилище песни / замок-руна R6 / камень-просьба'], ['коричневый брусок', 'ломаемая преграда'], ['зелёно-синий / синий / оранжевый прямоугольник', 'мост (⏱ = таймер) / подъёмник ⇅ / осыпающаяся плита'],
    ['голубая область', 'ветер: ⇡ восходящий поток, стрелка — боковой; пунктир — выключен на старте'], ['зелёный круг', 'NPC; зелёный пунктир — радиус оклика и связи с его камнями; ★ — дар'], ['красный треугольник', 'враг; красный круг — агро, пунктир — поводок, жирная линия — патруль'],
    ['голубая / жёлтая точка', 'эхо / реликвия-сказание; чёрный пунктир — за замком R6'], ['фиолетовый контур', 'зона-триггер (серый — без видимого эффекта)'], ['красный ! / ✕', 'место ошибки R4 (ломать нельзя) / здесь падал бот'], ['цветная линия с номерами (слой «катсцены»)', 'путь камеры катсцены, стрелки — направление взгляда; жёлтая лента — дорога ветра между уровнями']])}
<h2>Управление</h2>
${tbl(['действие', 'клавиатура / мышь'], [['движение', '<kbd>WASD</kbd> / стрелки'], ['бег (тратит дыхание)', '<kbd>Shift</kbd>'], ['прыжок (держать — выше)', '<kbd>Space</kbd>'], ['удар посохом (комбо из 3)', '<kbd>F</kbd> / ЛКМ'], ['рывок (после дара; в воздухе — после дара Пустельги)', '<kbd>Q</kbd> / ПКМ'], ['петь руне (держать рядом)', '<kbd>E</kbd>'], ['песни Порыв / Имя / Якорь (держать — сильнее)', '<kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd>']])}
<h3>Камера</h3>
${tbl(['настройка', 'значения', 'что делает'], [['Камера (cameraMode)', 'Помощь (assist) / Свободная (free)', 'assist: обзор перетаскиванием мыши; free: захват мыши, свободные рыскание и наклон. Колесо — дистанция 3–9 м.'],
    ['Доводка камеры (camAssist)', 'Выкл / Слабая / Обычная', 'через паузу после последнего ввода камеры вид плавно заходит за направление движения (на земле и в воздухе); сильнее на бегу от камеры, не разворачивается при беге на камеру; не работает 0.6 с после удара/рывка и пока набирается песня.'],
    ['Автоматика кадра', '—', 'камера ведёт героя с упреждением, не качается на прыжках, наклоняется вниз при быстром падении; в восходящем потоке опускается под героя и отъезжает, чтобы был виден уступ сверху.'],
    ['Помощь (вкладка assist)', 'скорость игры 70/85/100 %, бесконечный рывок, все дары, предел дыхания', 'любая включённая помощь помечает результат «Помощь вкл».']])}
<h2>Песни и дары</h2>
${tbl(['стадия', 'держать', 'Порыв: дальность, м', 'Имя: множитель радиуса', 'Якорь: держит, с'], [['касание', `< ${st[0]} с`, ...[0].flatMap(() => [stage(K.GUST_REACH)[0], stage(K.NAME_X)[0], stage(K.ANCHOR_HOLD)[0]])], ...[1, 2, 3].map((i) => [`волна ${i}`, `≥ ${st[i - 1]} с`, stage(K.GUST_REACH)[i], stage(K.NAME_X)[i], stage(K.ANCHOR_HOLD)[i]]), ['<span class="bad">передержал</span>', `> ${K.OVER} с`, 'песня срывается, дыхание потрачено', '', '']])}
<p>Имя: базовый радиус ${K.NAME_R} м (Имя II — ${K.NAME_R2} м); на полной волне развязывает всех оглушённых вокруг. Якорь: радиус ${K.ANCHOR_R} м. Порыв II: дальность ×${K.GUST_X2}. В воздухе песню можно держать не дольше ${K.AIR_MAX} с. Руны поются отдельно: <kbd>E</kbd>, радиус ${K.SING_R} м; удар посоха достаёт на ${K.STRIKE_R} м.</p>
${tbl(['уровень', 'дар / песня', 'где', 'от кого'], LEVELS.flatMap((id) => [...(levels[id].startGifts ?? []).map((g) => [id, GIFT[g] ?? g, 'на старте', '—']), ...(levels[id].gifts ?? []).map((g) => [id, GIFT[g.id] ?? g.id, pos3(g.at), g.npc ? `NPC ${g.npc}` : `святилище ${g.shrine}`]), ...(levels[id].npcs ?? []).flatMap((n) => (n.talk ?? []).flatMap((t) => (t.set ?? []).filter((f) => f.startsWith('gift.') && !(levels[id].gifts ?? []).some((g) => `gift.${g.id}` === f)).map((f) => [id, GIFT[f.slice(5)] ?? f, pos3(n.pos), `NPC ${n.id} (реплика ${t.id})`])))]))}
<h3>Где какая песня нужна</h3>${tbl(['уровень', 'шаг', 'песня', 'цель'], [...songUse, ...lockUse])}
<h2>Концовки</h2>
<p>Гармония = эхо + выполненные просьбы + сказания − сломанное (R4) − 1 за каждые 3 падения на уровне (берётся лучший забег). Максимум = ${K.ECHOES} эхо + 2 просьбы + ${K.TALES} сказаний.</p>
${tbl(['концовка', 'условие', 'катсцена'], [['истинная', `все ${K.TALES} сказаний и гармония ≥ 75 % максимума`, 'l3.finale_true «Оррен, названный»'], ['плохая', 'гармония < 4', 'l3.finale_bad «Серый рассвет»'], ['средняя', 'всё остальное', 'l3.finale «Узел развязан»']])}
${tbl(['уровень', 'эхо', 'сказаний', 'камни-просьбы', 'что нельзя ломать (R4)'], cnt)}
</div></section>`;
}

// ---------- main
const t0 = Date.now();
fs.mkdirSync(path.join(OUT, 'img/play'), { recursive: true });
const browser = await chromium.launch({ args: GPU });
let rec = REUSE && fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : null;
if (!rec) {
  rec = {};
  for (const id of LEVELS) {
    console.log(`recording ${id} @ ${URL0}`);
    const B = bounds(levels[id]), map = await renderMap(browser, id, levels[id], B);
    const runs = Object.fromEntries((await Promise.all(PROFILES.map((p) => runBot(browser, id, p).catch((e) => { warn(`${id} ${p}: bot run failed (${e.message.split('\n')[0]}): profile skipped`); return null; })))).filter(Boolean).map((r) => [r.profile, r]));
    rec[id] = { B, map: map.url, nodes: map.nodes, runs };
  }
  fs.writeFileSync(CACHE, JSON.stringify(rec));
}
const strips = await shrinkStrips(browser);
const all = {}, panels = [];
for (const id of LEVELS) {
  const R = rec[id], L = levels[id];
  fs.writeFileSync(path.join(OUT, 'img', `${id}.map.jpg`), Buffer.from(R.map.split(',')[1], 'base64'));
  const base = R.runs.mid ?? R.runs.best ?? R.runs.worst, beats = base ? beatsOf(base) : [];
  if (!R.runs.mid) warn(`${id}: no mid run: steps come from ${base?.profile ?? 'nothing'}, no play-camera thumbnails`);
  const thumbs = beats.map((b, i) => { const fr = (R.runs.mid?.frames ?? []).reduce((a, f) => (!a || Math.abs(f[0] - b.t1 - 0.3) < Math.abs(a[0] - b.t1 - 0.3) ? f : a), null); if (!fr) return null; const f = `img/play/${id}.b${i + 1}.jpg`; fs.writeFileSync(path.join(OUT, f), Buffer.from(fr[1].split(',')[1], 'base64')); return f; });
  all[id] = { nodes: R.nodes, runs: R.runs, beats, thumbs };
  panels.push(levelHtml(id, L, all[id], R.B, strips));
}
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Unknot — прохождение</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body>
${[...LEVELS, 'leg'].map((t, i) => `<input type="radio" name="tab" id="tab-${t}" ${i ? '' : 'checked'}>`).join('')}
<nav><b>Unknot — прохождение</b>${LEVELS.map((t) => `<label for="tab-${t}">${t.toUpperCase()} · ${esc(levels[t].title)}</label>`).join('')}<label for="tab-leg">Легенда · управление · песни · концовки</label><small style="margin-left:auto;color:#aaa">собрано ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · tools/walkthrough.mjs</small></nav>
<main>${panels.map((p) => p.html).join('\n')}${legendHtml(all)}</main>
<script>addEventListener('hashchange',()=>{const m=location.hash.match(/^#(l\\d+)-/);if(m){document.getElementById('tab-'+m[1]).checked=true;document.querySelector(location.hash)?.scrollIntoView({block:'center'})}})</script>
</body></html>`;
fs.writeFileSync(path.join(OUT, 'index.html'), html);
// lN.png: the map + overlay rasterised
const pg = await browser.newPage();
for (const [i, id] of LEVELS.entries()) {
  const f = path.join(OUT, `_${id}.html`);
  fs.writeFileSync(f, `<!doctype html><meta charset="utf-8"><style>body{margin:0}${SVGCSS}.L-cut{display:none}</style>${panels[i].svg}`);
  await pg.goto(pathToFileURL(f).href); await pg.waitForLoadState('networkidle');
  await pg.locator('svg').screenshot({ path: path.join(OUT, `${id}.png`) });
  fs.rmSync(f);
}
await browser.close();
console.log(`done in ${Math.round((Date.now() - t0) / 1000)} s -> ${path.join(OUT, 'index.html')} (${Math.round(html.length / 1024)} KB), ${LEVELS.map((l) => `${l}.png`).join(', ')}${warns.length ? `\n${warns.length} warnings:\n - ${[...new Set(warns)].join('\n - ')}` : ''}`);
