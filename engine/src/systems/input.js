// Keyboard + mouse + gamepad -> registry 'input' = {move:[x,z] world space, jump, run, strike, dash, sing, song}. Bot owns 'input' when 'bot.enabled'.
// Also: 'input.look' / 'input.lookY' = look deltas (px), 'input.zoom' = wheel delta, 'input.axes' = raw [right, forward],
// 'input.unlock' = pointer lock was lost (hud opens the pause menu), 'input.device' = 'kb' | 'pad' | 'touch' (last used).
// Movement is relative to the camera yaw captured when the stick/key was first pressed (re-captured when input returns to zero or the
// camera snaps), plus whatever the player turns by hand meanwhile, so the camera's own auto-align can never bend a straight run.
// Sing = hold E / gamepad Y (player.js: 0.5 s wakes a rune). Strike = F / gamepad X, or an LMB click that did not drag. Dash = Q / RMB / gamepad B (player.js takes the rising edge). Free camera mode: click grabs the pointer, then clicks strike.
// Songs (R2 gifts, player.js casts on the press): 1 / 2 / 3 = gust / name / anchor; pad LB + X / Y / B (LB held: those face buttons
// cast instead of strike / sing / dash). input.song = the song held, or null.
// Touch (touch.js): the on-screen stick / look / buttons are merged in below the same way as the pad (+ `pogo`: strike with the stick pulled down).
// Listeners are installed once and key state survives level changes (systems are re-initialised per level).
import { touchInit, touchFrame, touchRead, touchActive } from './touch.js';
const AXES = { KeyW: ['y', 1], ArrowUp: ['y', 1], KeyS: ['y', -1], ArrowDown: ['y', -1], KeyD: ['x', 1], ArrowRight: ['x', 1], KeyA: ['x', -1], ArrowLeft: ['x', -1] };
const STRIKE_KEYS = ['KeyF'], SING_KEY = 'KeyE', SONG_KEYS = { Digit1: 'gust', Digit2: 'name', Digit3: 'anchor', Numpad1: 'gust', Numpad2: 'name', Numpad3: 'anchor' };
const PAD_SONGS = [[2, 'gust'], [3, 'name'], [1, 'anchor']]; // LB + X / Y / B
const DEADZONE = 0.15, DRAG_PX = 5;
const held = new Set(), strikeHeld = new Set();
let dashKey = false, rmb = false, rmbClick = false;
let songKey = null, order = [], jumpKey = false, runKey = false, singKey = false, clickStrike = false, lookDx = 0, lookDy = 0, zoom = 0;
let ctxRef = null, down = null, frame = null, installed = false, device = 'kb';

function axis(name) { // last pressed wins when opposite keys are both held
  for (let i = order.length - 1; i >= 0; i--) if (AXES[order[i]][0] === name) return AXES[order[i]][1];
  return 0;
}
const freeMode = () => !ctxRef.params.test && ctxRef.registry.get('settings')?.cameraMode === 'free';
const locked = (el) => document.pointerLockElement === el;

function install(el) {
  const on = (t, ev, f, o) => t.addEventListener(ev, f, o);
  on(window, 'keydown', (e) => {
    if (e.target.closest?.('.hud-panel')) return; // menus own the keyboard
    device = 'kb';
    if (AXES[e.code] && !held.has(e.code)) { held.add(e.code); order.push(e.code); }
    if (e.code === 'Space') jumpKey = true;
    if (e.code.startsWith('Shift')) runKey = true;
    if (e.code === 'KeyQ') dashKey = true;
    if (STRIKE_KEYS.includes(e.code)) strikeHeld.add(e.code);
    if (e.code === SING_KEY) singKey = true;
    if (SONG_KEYS[e.code]) songKey = SONG_KEYS[e.code];
  });
  on(window, 'keyup', (e) => {
    held.delete(e.code); order = order.filter((c) => c !== e.code); strikeHeld.delete(e.code); if (e.code === SING_KEY) singKey = false;
    if (SONG_KEYS[e.code] === songKey) songKey = null;
    if (e.code === 'Space') jumpKey = false;
    if (e.code.startsWith('Shift')) runKey = false;
    if (e.code === 'KeyQ') dashKey = false;
  });
  on(window, 'blur', () => { held.clear(); order = []; strikeHeld.clear(); jumpKey = runKey = singKey = dashKey = rmb = false; songKey = null; down = null; });
  on(el, 'contextmenu', (e) => e.preventDefault());
  // RMB via mouse events: a second button pressed while LMB drags fires no pointerdown (chorded), but always a mousedown
  on(el, 'mousedown', (e) => { if (e.button === 2) rmb = rmbClick = true; }); // rmbClick: a click shorter than one sim step still counts
  on(window, 'mouseup', (e) => { if (e.button === 2) rmb = false; });
  on(el, 'pointerdown', (e) => {
    if (e.button !== 0 || !ctxRef || ctxRef.registry.get('paused') || (e.pointerType === 'touch' && touchActive())) return; // touch.js owns touches
    if (freeMode()) {
      if (!locked(el)) { try { el.requestPointerLock()?.catch?.(() => {}); } catch { /* no pointer lock here: assist mode still works */ } } else clickStrike = true;
      return;
    }
    down = { x: e.clientX, y: e.clientY, drag: false, dx: 0, dy: 0 };
    try { el.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
  });
  on(el, 'pointermove', (e) => {
    if (locked(el)) { lookDx += e.movementX; lookDy += e.movementY; return; }
    if (!down || !(e.buttons & 1) || e.pointerType === 'touch') return;
    down.dx += e.movementX; down.dy += e.movementY;
    if (!down.drag && Math.hypot(e.clientX - down.x, e.clientY - down.y) > DRAG_PX) down.drag = true;
    if (down.drag) { lookDx += down.dx; lookDy += down.dy; down.dx = down.dy = 0; }
  });
  const up = (e) => { if (e.button === 0 && down) { if (!down.drag && e.type === 'pointerup') clickStrike = true; down = null; } };
  on(window, 'pointerup', up);
  on(window, 'pointercancel', () => { down = null; });
  on(el, 'wheel', (e) => { zoom += e.deltaY; e.preventDefault(); }, { passive: false });
  on(document, 'pointerlockchange', () => { if (!locked(el)) ctxRef?.registry.set('input.unlock', performance.now()); });
}

export default {
  name: 'input', order: 0, whilePaused: true,
  init(ctx) {
    ctxRef = ctx;
    if (!installed) { installed = true; install(ctx.renderer.domElement); touchInit(ctx.game); }
    ctx.registry.set('input', { move: [0, 0], jump: false, run: false });
  },
  update(ctx) {
    const reg = ctx.registry;
    ctxRef = ctx;
    if (ctx.params.test || reg.get('bot.enabled')) return; // muted outside play
    touchFrame(reg);
    if (reg.get('paused')) { // the camera runs while paused: publish zeros so the last look/zoom does not keep spinning it
      clickStrike = rmbClick = false; lookDx = lookDy = zoom = 0;
      reg.set('input.look', 0); reg.set('input.lookY', 0); reg.set('input.zoom', 0); reg.set('input.axes', [0, 0]);
      return;
    }
    let x = axis('x'), y = axis('y'), jump = jumpKey, run = runKey, strike = strikeHeld.size > 0 || clickStrike;
    let dash = dashKey || rmb || rmbClick, sing = singKey, song = songKey;
    clickStrike = rmbClick = false; // a click is a one-frame press
    const pad = navigator.getGamepads?.().find(Boolean);
    if (pad) {
      const dz = (v) => (Math.abs(v) < DEADZONE ? 0 : v);
      x ||= dz(pad.axes[0]); y ||= -dz(pad.axes[1]);
      jump ||= pad.buttons[0]?.pressed; run ||= pad.buttons[5]?.pressed;
      if (pad.buttons[4]?.pressed) song ||= PAD_SONGS.find(([b]) => pad.buttons[b]?.pressed)?.[1] ?? null;
      else { strike ||= pad.buttons[2]?.pressed; dash ||= pad.buttons[1]?.pressed; sing ||= pad.buttons[3]?.pressed; }
      lookDx += dz(pad.axes[2] ?? 0) * 8; lookDy += dz(pad.axes[3] ?? 0) * 8;
      if (pad.buttons.some((b) => b?.pressed) || pad.axes.some((v) => dz(v))) device = 'pad';
    }
    const tc = touchRead();
    let pogo = false;
    if (tc) {
      x ||= tc.x; y ||= tc.y; run ||= tc.run; jump ||= tc.jump; strike ||= tc.strike; dash ||= tc.dash; sing ||= tc.sing; song ||= tc.song; pogo = tc.down;
      lookDx += tc.lookDx; lookDy += tc.lookDy;
      if (tc.x || tc.y || tc.jump || tc.strike || tc.dash || tc.sing || tc.song) device = 'touch';
    }
    if (reg.get('input.device') !== device) reg.set('input.device', device);
    const len = Math.hypot(x, y);
    if (len > 1) { x /= len; y /= len; }
    const live = reg.get('camera.yaw') ?? 0, user = reg.get('camera.userYaw') ?? 0, epoch = reg.get('camera.epoch');
    if (!len) frame = null;
    else if (!frame || frame.epoch !== epoch) frame = { yaw: live, user, epoch };
    const yaw = frame ? frame.yaw + (user - frame.user) : live; // forward = (sin yaw, cos yaw), right = (-cos yaw, sin yaw)
    if (reg.get('end')) { reg.set('input', { move: [0, 0], jump: false, run: false, strike: false, dash: false }); return; } // goal reached: the hero stands for the results beat (hud.js)
    reg.set('input', { move: [Math.sin(yaw) * y - Math.cos(yaw) * x, Math.cos(yaw) * y + Math.sin(yaw) * x], jump, run, strike, dash, sing, song, ...(pogo ? { pogo } : {}) });
    reg.set('input.axes', [x, y]);
    reg.set('input.look', lookDx); reg.set('input.lookY', lookDy); reg.set('input.zoom', zoom);
    lookDx = lookDy = zoom = 0;
  },
};
