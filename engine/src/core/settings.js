// Player settings: persisted in localStorage (every access guarded: private windows / blocked storage just fall back to defaults).
// Published as registry 'settings' by core/engine.js; systems read it live (volumes for audio, cameraMode/sensitivity/invertY/fov
// for camera + input, scatterDensity for level scatter). scatterDensity/pixelRatio are derived from `quality`.
const KEY = 'skywanderer.settings.v1';
export const QUALITY = { low: { pixelRatio: 1, scatterDensity: 0.5 }, medium: { pixelRatio: 1.5, scatterDensity: 0.75 }, high: { pixelRatio: 2, scatterDensity: 1 } };
export const DEFAULTS = {
  volume: { master: 1, music: 0.8, sfx: 1, ambience: 0.8, voice: 1 }, // 0..1 linear
  cameraMode: 'assist', // 'free' (pointer lock) | 'assist' (drag look)
  camAssist: 'normal', // off / low / normal: the view eases behind the run when the camera input rests (camera.js)
  sensitivity: 1, invertY: false, fov: 50, quality: 'high',
  // accessibility: reduceMotion scales camera shake / FOV punch / hit-stop (fx.js); gameSpeed scales the real-time clock
  // (engine.js loop); infiniteAirDash refills the air dash (player.js). The bot ignores gameSpeed and infiniteAirDash.
  reduceMotion: false, gameSpeed: 1, infiniteAirDash: false, allGifts: false, timer: false, // allGifts: every NPC gift from the start (level.js)
  // timer: the speedrun clock (hud.js)
  breath: true, // false = endless breath (assist, player.js; never the bot)
  textSize: 'M', // S / M / L: menus, subtitles, hints, cards (hud.js --ts)
  touchControls: 'auto', touchSize: 'M', leftHanded: false, // touch.js: auto = shown once a touch happens / on a coarse pointer; button size S / M / L; swap sides
};
// first-run defaults from the browser: reduced motion from the OS, language from navigator (ru* -> ru, pt* -> pt, else en)
const sysReduce = () => { try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
const sysLang = () => (/^(ru|pt)/i.exec(globalThis.navigator?.language ?? '')?.[1].toLowerCase() ?? 'en');
// phones / tablets start on medium (pixel ratio cap 1.5, scatter 0.75)
const sysCoarse = () => { try { return !!globalThis.matchMedia?.('(pointer: coarse)').matches; } catch { return false; } };
const SPEEDS = [0.7, 0.85, 1];
const clamp = (v, a, b, d) => (typeof v === 'number' || (typeof v === 'string' && v.trim() !== '') ? (Number.isFinite(+v) ? Math.min(b, Math.max(a, +v)) : d) : d); // null, '', [] are not numbers

export function normalize(s = {}) {
  const v = s.volume ?? {}, d = DEFAULTS;
  const quality = s.quality in QUALITY ? s.quality : sysCoarse() ? 'medium' : d.quality, speed = clamp(s.gameSpeed, 0.7, 1, d.gameSpeed);
  return {
    volume: Object.fromEntries(Object.keys(d.volume).map((k) => [k, clamp(v[k], 0, 1, d.volume[k])])),
    cameraMode: s.cameraMode === 'free' ? 'free' : s.cameraMode === 'assist' ? 'assist' : d.cameraMode,
    camAssist: ['off', 'low', 'normal'].includes(s.camAssist) ? s.camAssist : d.camAssist,
    sensitivity: clamp(s.sensitivity, 0.3, 3, d.sensitivity), invertY: !!s.invertY, fov: clamp(s.fov, 40, 90, d.fov),
    quality, ...QUALITY[quality],
    reduceMotion: s.reduceMotion == null ? sysReduce() : !!s.reduceMotion, infiniteAirDash: !!s.infiniteAirDash, allGifts: !!s.allGifts, timer: !!s.timer,
    breath: s.breath !== false, textSize: ['S', 'M', 'L'].includes(s.textSize) ? s.textSize : d.textSize, lang: ['en', 'ru', 'pt'].includes(s.lang) ? s.lang : sysLang(),
    touchControls: ['auto', 'on', 'off'].includes(s.touchControls) ? s.touchControls : d.touchControls, touchSize: ['S', 'M', 'L'].includes(s.touchSize) ? s.touchSize : d.touchSize, leftHanded: !!s.leftHanded,
    gameSpeed: SPEEDS.reduce((a, b) => (Math.abs(b - speed) < Math.abs(a - speed) ? b : a)), // snap to 70/85/100%
  };
}
// URL overrides: ?reduceMotion=1, ?speed=0.7|0.85|1, ?airdash=inf, ?lang=ru|en|pt. Returns the fields to merge; engine.js never saves
// them (a key keeps its stored value until the player changes it in the menu).
export function urlOverrides(get) {
  const o = {};
  if (get('reduceMotion') != null) o.reduceMotion = get('reduceMotion') === '1';
  if (get('speed') != null) o.gameSpeed = +get('speed');
  if (get('airdash') != null) o.infiniteAirDash = get('airdash') === 'inf';
  if (get('gifts') === 'all') o.allGifts = true; // U25: a ?gifts=a,b list (tests, engine.js) leaves the setting alone
  if (get('lang') != null) o.lang = /^(ru|pt)/i.exec(get('lang'))?.[1].toLowerCase() ?? 'en'; // U25: pt-PT -> pt, as hud.js LANG
  return o;
}
export function loadSettings() {
  try { return normalize(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch { return normalize(); }
}
export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable: settings last for this session only */ }
}
