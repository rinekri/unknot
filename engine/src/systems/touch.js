// Touch controls (phones / tablets). input.js merges what this module reads into the same registry 'input' fields keyboard and gamepad write
// ({move, jump, run, strike, dash, sing, song} + `pogo` (strike with the stick pulled down), which player.js already reads) and into 'input.look' / 'input.lookY'.
// Nothing here runs on a desktop without touch: the DOM is built on the first touch event, on a coarse pointer, or with ?touch=1 (settings.touchControls: auto / on / off).
// Layout (right-handed; settings.leftHanded mirrors it): left half = floating stick (appears under the thumb, pushed past 85 % = run), right half = drag to look,
// right-bottom cluster = Jump (big), Strike, Dash, Sing (hold) and one button per gift song owned (hold to charge), top-right = pause.
// Pause opens the menu with a synthetic 'P' key (hud.js owns the menus). During a cutscene a long press anywhere is a held Space (cutscene.js hold-to-skip).
// Portrait on a phone: a "rotate your device" card and a pause. Audio unlocks on the first touch (audio.js already listens to pointerdown / touchend).
const SIZE = { S: 52, M: 62, L: 74 }; // CSS px of a normal button (Jump = 1.4x); every size stays >= 52, thumb-sized
const STICK_R = 54, DEAD = 0.18, RUN_AT = 0.85, LOOK_GAIN = 1.3, POGO_AT = -0.6; // px radius (x size factor), fraction, fraction of the radius, x mouse px, stick y that turns a strike into down + strike
const SONGS = ['gust', 'name', 'anchor'];
const ICON = { // 24 x 24 strokes, one per button
  jump: 'M6 13l6-6 6 6M6 19l6-6 6 6', dash: 'M3 12h13M12 7l5 5-5 5M3 7h5M3 17h5', strike: 'M4 20L16 8M15 3v4M13 5h4M19 11v4M17 13h4',
  sing: 'M9 18V6l10-2v12M9 18m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M19 16m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  gust: 'M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7', name: 'M3 8q3-3 6 0t6 0 6 0M3 14q3-3 6 0t6 0 6 0M3 20q3-3 6 0t6 0 6 0',
  anchor: 'M12 3m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 5v16M7 10h10M5 14q1 7 7 7t7-7', pause: 'M8 5v14M16 5v14',
};
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
const CSS = `
body.touch { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent; touch-action: none; }
body.touch input, body.touch .hud-panel { -webkit-user-select: auto; user-select: auto; }
body.touch .hud-panel, body.touch .hud-page { touch-action: pan-y; }
.tc { position: fixed; inset: 0; z-index: 2; pointer-events: none; touch-action: none; display: none; --tb: 62px; }
.tc.on { display: block; }
.tc-zone { position: absolute; top: 0; bottom: 0; width: 50%; pointer-events: auto; touch-action: none; }
.tc-stick { left: 0; } .tc-look { right: 0; } .tc.lh .tc-stick { left: auto; right: 0; } .tc.lh .tc-look { right: auto; left: 0; }
.tc-base, .tc-knob { position: fixed; border-radius: 50%; pointer-events: none; display: none; transform: translate(-50%, -50%); }
.tc-base { width: calc(var(--tb) * 2.1); height: calc(var(--tb) * 2.1); border: 2px solid rgba(100,93,79,.7); background: rgba(249,243,236,.28); }
.tc-knob { width: calc(var(--tb) * .85); height: calc(var(--tb) * .85); border: 2px solid var(--ink); background: radial-gradient(circle at 35% 30%, #fff3cf, var(--gold) 70%); opacity: .92; }
.tc-b { position: absolute; display: grid; place-items: center; width: var(--s, var(--tb)); height: var(--s, var(--tb)); right: var(--x); bottom: var(--y); box-sizing: border-box; border-radius: 50%; padding: 0;
  border: 2px solid var(--line); background: rgba(249,243,236,.62); color: var(--ink); pointer-events: auto; touch-action: none; box-shadow: 0 2px 8px rgba(52,45,36,.25); }
.tc.lh .tc-b { right: auto; left: var(--x); } .tc.lh .tc-pause { left: auto; right: max(12px, env(safe-area-inset-right)); }
.tc-b svg { width: 52%; height: 52%; pointer-events: none; }
.tc-b.dn { background: var(--gold); border-color: var(--ink); transform: scale(.94); }
.tc-b[hidden] { display: none; }
.tc-b.j { --s: calc(var(--tb) * 1.4); }
.tc-cluster { position: absolute; right: max(14px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom)); width: 0; height: 0; }
.tc.lh .tc-cluster { right: auto; left: max(14px, env(safe-area-inset-left)); }
.tc .tc-pause { top: max(10px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); bottom: auto; width: 46px; height: 46px; border-radius: 12px; }
.tc-pause svg { width: 56%; height: 56%; }
.tc-rot { position: fixed; inset: 0; z-index: 9; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 18px; background: var(--cream); color: var(--ink); font: italic 22px Georgia, serif; text-align: center; padding: 24px; }
.tc-rot.on { display: flex; }
.tc-rot svg { width: 84px; height: 84px; color: #8a6a48; animation: tc-turn 2.4s ease-in-out infinite; }
@keyframes tc-turn { 0%, 25% { transform: rotate(0); } 60%, 100% { transform: rotate(-90deg); } }
body.touch .hud-timer { right: calc(max(12px, env(safe-area-inset-right)) + 58px); }
@media (prefers-reduced-motion: reduce) { .tc-rot svg { animation: none; } }`;

let game, root, built = false, seen = false, rotated = false, lastShow = false;
const forced = /[?&]touch=1\b/.test(globalThis.location?.search ?? '');
const coarse = () => { try { return !!globalThis.matchMedia?.('(pointer: coarse)').matches; } catch { return false; } };
const st = { stick: null, look: null, x: 0, y: 0, run: false, lookDx: 0, lookDy: 0, song: null, held: {}, latch: {}, skipIds: new Set() };
const el = {};
const L = (en, ru) => (game?.settings.lang === 'ru' ? ru : en);
const want = () => { const m = game?.settings.touchControls; return m === 'on' || (m !== 'off' && (seen || forced || coarse())); };
const key = (type, code) => dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true, cancelable: true }));

export const touchActive = () => built && lastShow;
export const touchWanted = () => want();

function build() {
  built = true;
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }));
  const mk = (cls, tag = 'div', parent = document.body) => { const e = Object.assign(document.createElement(tag), { className: cls }); parent.append(e); return e; };
  root = mk('tc');
  el.stick = mk('tc-zone tc-stick', 'div', root); el.look = mk('tc-zone tc-look', 'div', root);
  el.base = mk('tc-base', 'div', root); el.knob = mk('tc-knob', 'div', root);
  const cluster = mk('tc-cluster', 'div', root);
  const btn = (name, x, y, parent, extra = '') => { // x / y: offsets from the cluster corner in button units
    const b = mk(`tc-b ${extra}`, 'button', parent);
    b.innerHTML = svg(ICON[name]); b.dataset.n = name; b.setAttribute('aria-label', name);
    b.style.setProperty('--x', `calc(var(--tb) * ${x})`); b.style.setProperty('--y', `calc(var(--tb) * ${y})`);
    el[name] = b; hold(b, name);
    return b;
  };
  btn('jump', 0, 0, cluster, 'j'); btn('strike', 1.55, 0.1, cluster); btn('dash', 1.15, 1.6, cluster); btn('sing', 0.1, 1.75, cluster);
  SONGS.forEach((s, i) => { btn(s, 0.1 + i * 1.12, 3.0, cluster).hidden = true; }); // shown once the gift is held
  el.pause = mk('tc-b tc-pause', 'button', root); el.pause.innerHTML = svg(ICON.pause); el.pause.setAttribute('aria-label', 'pause');
  el.pause.onpointerdown = (e) => { e.preventDefault(); e.stopPropagation(); key('keydown', 'KeyP'); key('keyup', 'KeyP'); };
  el.rot = mk('tc-rot');
  el.rot.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg><span></span>`;
  zone(el.stick, (e) => stickDown(e), stickMove, stickUp); zone(el.look, lookDown, lookMove, lookUp);
  const stop = (e) => e.preventDefault();
  for (const t of ['gesturestart', 'gesturechange', 'gestureend', 'contextmenu', 'dblclick']) addEventListener(t, stop, { passive: false });
  addEventListener('touchmove', (e) => { if (!e.target.closest?.('.hud-panel')) e.preventDefault(); }, { passive: false });
  addEventListener('pointerdown', skipDown, true); addEventListener('pointerup', skipUp, true); addEventListener('pointercancel', skipUp, true);
}

// a held button: pointer down = pressed (latched so a tap shorter than one sim step still counts), up / cancel = released
function hold(b, name) {
  const set = (on) => { b.classList.toggle('dn', on); if (SONGS.includes(name)) st.song = on ? name : st.song === name ? null : st.song; else st.held[name] = on; if (on) st.latch[name] = true; };
  b.onpointerdown = (e) => { if (e.pointerType !== 'touch' && e.button) return; e.preventDefault(); e.stopPropagation(); try { b.setPointerCapture(e.pointerId); } catch { /* synthetic */ } set(true); };
  b.onpointerup = b.onpointercancel = b.onlostpointercapture = () => set(false);
}
function zone(z, down, move, up) {
  z.onpointerdown = (e) => { if (e.pointerType === 'mouse') return; e.preventDefault(); try { z.setPointerCapture(e.pointerId); } catch { /* synthetic */ } down(e); };
  z.onpointermove = move; z.onpointerup = z.onpointercancel = up;
}
const scale = () => SIZE[game.settings.touchSize] / SIZE.M;
function stickDown(e) {
  if (st.stick) return;
  st.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
  for (const n of ['base', 'knob']) Object.assign(el[n].style, { display: 'block', left: `${e.clientX}px`, top: `${e.clientY}px` });
}
function stickMove(e) {
  const s = st.stick;
  if (!s || s.id !== e.pointerId) return;
  const R = STICK_R * scale(), dx = e.clientX - s.ox, dy = e.clientY - s.oy, d = Math.hypot(dx, dy);
  if (d > R) { s.ox += (dx / d) * (d - R); s.oy += (dy / d) * (d - R); el.base.style.left = `${s.ox}px`; el.base.style.top = `${s.oy}px`; } // the base follows a thumb that overshoots
  const k = Math.min(1, d / R), raw = k;
  el.knob.style.left = `${s.ox + (d ? (dx / d) * Math.min(d, R) : 0)}px`; el.knob.style.top = `${s.oy + (d ? (dy / d) * Math.min(d, R) : 0)}px`;
  const m = raw < DEAD ? 0 : (raw - DEAD) / (1 - DEAD);
  st.x = d ? (dx / d) * m : 0; st.y = d ? (-dy / d) * m : 0; st.run = raw > RUN_AT;
}
function stickUp(e) {
  if (st.stick?.id !== e.pointerId) return;
  st.stick = null; st.x = st.y = 0; st.run = false;
  el.base.style.display = el.knob.style.display = 'none';
}
const lookDown = (e) => { if (!st.look) st.look = { id: e.pointerId, x: e.clientX, y: e.clientY }; };
function lookMove(e) {
  const l = st.look;
  if (!l || l.id !== e.pointerId) return;
  st.lookDx += (e.clientX - l.x) * LOOK_GAIN; st.lookDy += (e.clientY - l.y) * LOOK_GAIN; l.x = e.clientX; l.y = e.clientY;
}
const lookUp = (e) => { if (st.look?.id === e.pointerId) st.look = null; };
// cutscene: any touch held = Space held (cutscene.js fills its ring and skips)
function skipDown(e) {
  if (e.pointerType !== 'touch' || !document.body.classList.contains('cut')) return;
  if (!st.skipIds.size) key('keydown', 'Space');
  st.skipIds.add(e.pointerId);
}
function skipUp(e) { if (st.skipIds.delete(e.pointerId) && !st.skipIds.size) key('keyup', 'Space'); }
function releaseAll() {
  st.stick = st.look = null; st.x = st.y = 0; st.run = false; st.song = null; st.held = {}; st.latch = {}; st.lookDx = st.lookDy = 0;
  if (!built) return;
  el.base.style.display = el.knob.style.display = 'none';
  root.querySelectorAll('.tc-b.dn').forEach((b) => b.classList.remove('dn'));
}

export function touchInit(g) {
  game = g;
  const first = (e) => { if (e.pointerType === 'touch') { seen = true; removeEventListener('pointerdown', first, true); } };
  addEventListener('pointerdown', first, true);
}

// once per sim step (input.js, also while paused): visibility, layout, owned songs, portrait card
export function touchFrame(reg) {
  if (!game) return;
  const on = want();
  if (!on && !built) return;
  if (!built) build();
  const S = game.settings, paused = !!reg.get('paused'), flags = reg.get('flags') ?? {};
  document.body.classList.toggle('touch', on);
  const card = on && innerHeight > innerWidth && innerWidth < 700; // a phone held upright
  if (card !== rotated) {
    rotated = card;
    el.rot.classList.toggle('on', card);
    if (card) { el.rot.lastChild.textContent = L('Turn your device sideways', 'Поверните устройство горизонтально'); if (!paused) { key('keydown', 'KeyP'); key('keyup', 'KeyP'); } }
  }
  const show = on && !card && !paused && !document.body.classList.contains('cut') && !reg.get('end');
  if (show !== lastShow) { lastShow = show; root.classList.toggle('on', show); if (!show) releaseAll(); }
  root.classList.toggle('lh', !!S.leftHanded);
  root.style.setProperty('--tb', `${SIZE[S.touchSize]}px`);
    for (const s of SONGS) el[s].hidden = !flags[`gift.${s}`];
}

// the held state for this sim step, or null when the touch UI is not up
export function touchRead() {
  if (!touchActive()) return null;
  const h = st.held, l = st.latch, out = {
    x: st.x, y: st.y, run: st.run, jump: !!h.jump || !!l.jump, dash: !!h.dash || !!l.dash, strike: !!h.strike || !!l.strike, sing: !!h.sing || !!l.sing, song: st.song,
    down: (!!h.strike || !!l.strike) && st.y < POGO_AT, lookDx: st.lookDx, lookDy: st.lookDy,
  };
  st.latch = {}; st.lookDx = st.lookDy = 0;
  return out;
}

// first tap of a journey: fullscreen + landscape lock where the browser allows it (hud.js goTo, inside the click's gesture)
export function touchEnter() {
  if (!want() || !built) return;
  try { const d = document.documentElement; (d.requestFullscreen ?? d.webkitRequestFullscreen)?.call(d)?.catch?.(() => {}); } catch { /* not allowed */ }
  try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* not allowed */ }
}
