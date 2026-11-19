// Menu art for hud.js / meta.js (no system: no default export). Inline SVG strings only: ink lines over flat watercolour fills, edges
// wobbled by the #hud-wob filter (DEFS, added to the page once by hud.js install()). Nothing here touches the GPU scene.
//   ico(name)                     24 px line icon for a menu entry or tab
//   wordmark(lang, state, cls)    the game's name: thread-outlined letters over a thread with a knot; 'live' = the letters are drawn
//                                 in and the knot loosens once the caller starts its <animate>s (hud.js showTitle), 'loose' = already loosened
//   island(id, ending)            a level's floating-island vignette (l3 = the Crown: dark, grey after an ending, gold after the true one)
//   shard / lock / knot / seal    small physical marks: echo found, lock opened, request done (a knot undone), challenge met (wax)
//   echoArt(key) / taleArt(n, on) journal drawings   pose(name) / glyph(song)  controls page
//   stamp(numeral)                the results card's wax stamp   badge(group, on, secret)  an embroidered achievement badge
import { GLYPH, SONG_COL } from './songs.js';

const INK = '#342d24', WOB = 'filter="url(#hud-wob)"';
export const NAME = { en: 'Unknot', ru: 'Распутать' };
export const DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><filter id="hud-wob" x="-5%" y="-5%" width="110%" height="110%"><feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="2.2"/></filter></svg>';

const ICO = {
  play: '<path d="M7 4.5v15l12-7.5z"/>',
  sprout: '<path d="M12 21v-9M12 12c0-4-3-6-7-6 0 4 3 6 7 6zM12 14c0-3 2.5-5 7-5 0 3.5-3 5-7 5z"/>',
  map: '<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  book: '<path d="M4 5c3-1.5 6-1.5 8 0 2-1.5 5-1.5 8 0v14c-3-1.5-6-1.5-8 0-2-1.5-5-1.5-8 0z"/><path d="M12 5v14"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2 2M16.7 16.7l2 2M5.3 18.7l2-2M16.7 7.3l2-2"/>',
  loom: '<path d="M5 3v18M19 3v18M3 6h18M5 16h14"/><path d="M8.5 6v10M12 6v10M15.5 6v10"/>',
  quill: '<path d="M20 3C12 4 7 9 5 19l3-3c5 0 9-4 12-13z"/><path d="M5 19l8-9"/>',
  back: '<path d="M10 6l-6 6 6 6M4 12h16"/>',
  loop: '<path d="M19 12a7 7 0 1 1-2.5-5.4"/><path d="M17 2.5V7h-4.5"/>',
  flag: '<path d="M6 21V4M6 5c4-2 6 2 11 0v8c-5 2-7-2-11 0"/>',
  door: '<path d="M14 4H6v16h8"/><path d="M11 12h10M17 8l4 4-4 4"/>',
  badge: '<circle cx="12" cy="9" r="5.5"/><path d="M8.5 13.5L7 21l5-2.5 5 2.5-1.5-7.5"/>',
  keys: '<rect x="3" y="7" width="18" height="11" rx="2"/><path d="M7 11h.01M11 11h.01M15 11h.01M8 14.5h8"/>',
  scene: '<rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M10 9.5v5l4.5-2.5z"/>',
  skip: '<path d="M5 6l6 6-6 6M13 6l6 6-6 6"/>',
  shard: '<path d="M12 2.5l5 7.5-5 11.5L7 10z"/><path d="M7 10h10"/>',
  knot: '<path d="M2 16c5 0 6-10 10-10s4 6 0 6-4-6 0-6 5 10 10 10"/>',
  scroll: '<path d="M7 4h11v13a3 3 0 0 1-3 3H6a2.5 2.5 0 0 1 0-5h9"/><path d="M7 4a2.5 2.5 0 0 0-2.500 2.500V15M10 8h5M10 11h5"/>',
  weave: '<path d="M4 4v16M9.300 4v16M14.700 4v16M20 4v16"/><path d="M2 8h20M2 12h20M2 16h20"/>',
  note: '<path d="M9 18V5l10-2v13"/><circle cx="6.500" cy="18" r="2.500"/><circle cx="16.500" cy="16" r="2.500"/>',
  eye: '<path d="M2.500 12q9.500-10 19 0q-9.500 10-19 0z"/><circle cx="12" cy="12" r="2.800"/>',
  hand: '<path d="M12 20.500C6 16 3.500 12.500 3.500 9a4.200 4.200 0 0 1 8.500-1 4.200 4.200 0 0 1 8.500 1c0 3.500-2.500 7-8.500 11.500z"/>',
  cloak: '<path d="M12 2.500c-2.300 0-3.700 1.800-3.700 4 0 1.300-.7 2.400-1.700 3.600C4.900 12.300 4.300 15.500 4.300 19.500c5 2.400 10.400 2.400 15.400 0 0-4-.6-7.200-2.300-9.400-1-1.200-1.700-2.300-1.700-3.600 0-2.200-1.400-4-3.700-4z"/><path d="M7.500 13.500c3 1.100 6 1.100 9 0"/>',
  check: '<path d="M5 12.500l4.500 4.500L19 7"/>',
};
export const ico = (k) => `<svg class="hud-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${ICO[k] ?? ''}</svg>`;

// ---- wordmark ----
export function wordmark(lang = 'en', state = null, cls = '') { // state: 'live' (drawn in, the knot loosens), 'loose' (after it), else tied
  const live = state === 'live', k = state === 'loose' ? 1 : 0;
  const ru = lang === 'ru', W = ru ? 372 : 262, c = W / 2;
  const d = (l) => `M9 62C3 76 28 86 ${c - 44} 84C${l ? `${c - 28} 82 ${c - 16} 78 ${c - 6} 80C${c} 82 ${c + 6} 88 ${c + 14} 86` : `${c - 12} 82 ${c + 20} 66 ${c + 4} 61C${c - 12} 56 ${c - 20} 78 ${c + 6} 87`}C${c + 22} ${l ? 82 : 92} ${c + 34} 82 ${c + 48} 84C${c + 84} 88 ${W - 34} 78 ${W - 8} 88`;
  const anim = live ? `<animate attributeName="d" begin="indefinite" dur="2.4s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".5 0 .3 1" values="${d(0)};${d(1)}"/>` : '';
  return `<svg class="hud-wm ${live ? 'live' : ''} ${cls}" style="--w:${W}px" viewBox="0 0 ${W} 100" role="img" aria-label="${NAME[lang] ?? NAME.en}">
    <path d="${d(k)}" fill="none" stroke="#8a6427" stroke-width="5.200" stroke-linecap="round" opacity=".35" transform="translate(0 2)">${anim}</path>
    <path d="${d(k)}" fill="none" stroke="#e0a83f" stroke-width="3.400" stroke-linecap="round">${anim}</path>
    <path d="${d(k)}" fill="none" stroke="#fff3cf" stroke-width="1" stroke-linecap="round" stroke-dasharray="5 7" opacity=".8">${anim}</path>
    <text x="${c}" y="66" text-anchor="middle">${NAME[lang] ?? NAME.en}</text></svg>`;
}

// ---- islands ----
const ROCK = `<ellipse cx="70" cy="105" rx="30" ry="3.500" fill="${INK}" opacity=".1"/>
  <path d="M16 54Q30 66 37 82Q45 101 60 104Q69 95 77 106Q95 94 104 79Q112 64 124 54Z" fill="#c4a683" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
  <path d="M42 60Q52 80 62 100Q68 92 76 100Q84 80 82 60Z" fill="#b08f6c" opacity=".55"/>
  <path d="M30 62l9 20M52 62l6 34M78 62l1 36M98 60l-7 24M112 58l-7 13" stroke="#8f7455" stroke-width="1.3" fill="none" stroke-linecap="round" opacity=".75"/>`;
const TOP = (c) => `<path d="M8 50Q36 37 70 39Q106 37 132 50Q108 62 70 61Q32 62 8 50Z" fill="${c}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/><path d="M22 51Q46 57 70 56Q98 57 118 51" stroke="#fff8e6" stroke-width="2.200" fill="none" opacity=".6" stroke-linecap="round"/>`;
const menhir = (x, h, w, rune) => `<path d="M${x - w} 51L${x - w * 0.72} ${50 - h}Q${x} ${43 - h} ${x + w * 0.72} ${50 - h}L${x + w} 51Z" fill="#dccaa9" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/><path d="M${x + w * 0.2} ${48 - h}L${x + w * 0.5} 50" stroke="#a88d6b" stroke-width="2" opacity=".6"/>${rune ? `<path d="M${x - 2} ${50 - h * 0.72}h4M${x} ${50 - h * 0.72}v${h * 0.3}" stroke="#e0a83f" stroke-width="1.6" stroke-linecap="round"/>` : ''}`;
const totem = (x, h) => `<path d="M${x - 4} 51V${51 - h}h8V51Z" fill="#b98a5c" stroke="${INK}" stroke-width="1.4" stroke-linejoin="round"/>${[0.2, 0.5, 0.8].map((k, i) => `<path d="M${x - 4} ${51 - h * k}h8" stroke="${['#b5452f', '#6fa3cf', '#e0a83f'][i]}" stroke-width="3"/>`).join('')}<path d="M${x - 11} ${53 - h}q11-7 22 0" fill="none" stroke="${INK}" stroke-width="2.200" stroke-linecap="round"/><path d="M${x + 9} ${44 - h}q8-7 13 0t-7 7" fill="none" stroke="#6fa3cf" stroke-width="1.600" stroke-linecap="round"/>`;
const CROWN = { true: ['#e0a83f', '#fff3cf'], none: ['#3d3833', '#5a544c'] };
export function island(id, ending = null) {
  const [cc, ch] = CROWN[ending === 'true' ? 'true' : 'none'], grey = ending && ending !== 'true';
  const body = {
    l1: `${ROCK}${TOP('#ead9b8')}${menhir(40, 24, 6, 1)}${menhir(66, 36, 7.500, 1)}${menhir(94, 20, 6, 1)}<path d="M108 49h9v-6h-9zM17 50q4-6 8 0" fill="#d3bf9e" stroke="${INK}" stroke-width="1.2"/><ellipse cx="54" cy="52" rx="6" ry="2" fill="#9aa878"/><ellipse cx="82" cy="53" rx="7" ry="2" fill="#9aa878"/>`,
    l2: `${ROCK}${TOP('#dfe2c2')}${totem(46, 34)}${totem(92, 25)}<path d="M50 20Q70 34 88 28" fill="none" stroke="#8a6a48" stroke-width="1.2" stroke-dasharray="3 2"/><path d="M66 31v6M72 31.500v5" stroke="#b5452f" stroke-width="2" stroke-linecap="round"/><ellipse cx="70" cy="53" rx="9" ry="2.200" fill="#9aa878"/><ellipse cx="26" cy="50" rx="6" ry="1.800" fill="#9aa878"/>`,
    l3: `${ROCK}${TOP('#e8d5c4')}${ending === 'true' ? '<circle cx="70" cy="24" r="30" fill="#ffe9a8" opacity=".55"/><path d="M70-8v10M36 0l6 9M104 0l-6 9M20 22l10 3M120 22l-10 3" stroke="#e0a83f" stroke-width="2" stroke-linecap="round"/>' : ''}
      <path d="M38 14Q24 26 16 46M102 14Q116 26 124 46" fill="none" stroke="#8a6a48" stroke-width="1.3" stroke-dasharray="${ending ? '1 4' : '4 2'}"/>
      <path d="M44 51L38 14L56 32L70 5L84 32L102 14L96 51Z" fill="${grey ? '#8f897e' : cc}" stroke="${INK}" stroke-width="1.6" stroke-linejoin="round"/>
      <path d="M43 44h54" stroke="${grey ? '#b5afa3' : ch}" stroke-width="3"/><path d="M52 30l4 14M70 12v32M88 30l-4 14" stroke="${grey ? '#b5afa3' : ch}" stroke-width="1.2" opacity=".7"/>
      <circle cx="38" cy="13" r="2.800" fill="${grey ? '#b5afa3' : ch}" stroke="${INK}"/><circle cx="70" cy="5" r="3.400" fill="${ending === 'true' ? '#fff3cf' : grey ? '#b5afa3' : '#b5452f'}" stroke="${INK}"/><circle cx="102" cy="13" r="2.800" fill="${grey ? '#b5afa3' : ch}" stroke="${INK}"/>`,
  }[id] ?? `${ROCK}${TOP('#ead9b8')}`;
  return `<svg class="isle" viewBox="0 -10 140 122" aria-hidden="true"><g ${WOB}>${body}</g></svg>`;
}

// ---- small physical marks ----
const mark = (body, cls) => `<svg class="mk ${cls}" viewBox="0 0 16 20" aria-hidden="true">${body}</svg>`;
export const shard = (on) => mark(on ? `<path d="M8 1.500l5 7-5 10-5-10z" fill="#8fd3e6" stroke="${INK}" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 1.500v17M3 8.500h10" stroke="#fff" stroke-width=".8" opacity=".85"/>` : '<path d="M8 1.500l5 7-5 10-5-10z" fill="none" stroke="#a79c88" stroke-width="1.1" stroke-dasharray="2 2"/>', on ? 'shard on' : 'shard');
export const lock = (open) => mark(`<path d="${open ? 'M11 9.500V5a3 3 0 0 0-6 0v1.500' : 'M5 9.500V6.500a3 3 0 0 1 6 0v3'}" fill="none" stroke="${open ? INK : '#8d8576'}" stroke-width="1.5" stroke-linecap="round"/><rect x="3" y="9.500" width="10" height="8.500" rx="1.600" fill="${open ? '#e9b85a' : '#d5ccbb'}" stroke="${open ? INK : '#8d8576'}" stroke-width="1.2"/><path d="M8 12.500v2.500" stroke="${open ? INK : '#8d8576'}" stroke-width="1.5" stroke-linecap="round"/>`, 'lock');
export const knot = (done) => mark(done ? '<path d="M1 12c3-5 5 5 7 0s4-5 7 0" fill="none" stroke="#e0a83f" stroke-width="2" stroke-linecap="round"/><path d="M8 2.500v3M6.500 4h3" stroke="#e0a83f" stroke-width="1.2" stroke-linecap="round"/>' : '<path d="M1 15c4 0 4-10 7-10s3.500 6 0 6-3.500-6 0-6 3 10 7 10" fill="none" stroke="#7a5a3a" stroke-width="1.8" stroke-linecap="round"/>', 'knot');
const SEAL_COL = { silver: ['#c3c6c9', '#eef0f1'], gold: ['#dcae45', '#fff0c0'] }, SEAL_GLYPH = {
  silver: 'M9 8h6l-6 8h6z', gold: 'M9 8h6l-6 8h6z', breath: 'M7 12q2.500-3.500 5 0t5 0', untouched: 'M12 7l3.500 5-3.500 5-3.500-5z', light: 'M8 14l4-5 4 5',
};
export function seal(id, on, fresh = false) {
  const [c, hi] = SEAL_COL[id] ?? ['#b5452f', '#e58b73'], g = SEAL_GLYPH[id] ?? 'M12 8.500a3.500 3.500 0 1 0 .01 0';
  return `<svg class="mk seal${on ? ' on' : ''}${fresh ? ' fresh' : ''}" viewBox="0 0 24 24" aria-hidden="true">${on
    ? `<g ${WOB}><circle cx="12" cy="12" r="10" fill="${c}" stroke="${INK}" stroke-width="1.1"/><circle cx="12" cy="12" r="6.800" fill="none" stroke="${hi}" stroke-width="1" opacity=".8"/></g><path d="${g}" fill="none" stroke="${hi}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle cx="12" cy="12" r="9.500" fill="none" stroke="#a79c88" stroke-width="1.1" stroke-dasharray="2.500 2.500"/><path d="${g}" fill="none" stroke="#a79c88" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round" opacity=".6"/>`}</svg>`;
}

// ---- journal drawings ----
const S = `stroke="${INK}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"`;
const ECHO = {
  wall: `<path d="M5 40h38" ${S}/><path d="M6 30h14v10H6zM20 30h12v10H20zM32 30h10v10H32zM12 20h14v10H12zM26 20h12v10H26z" fill="#dccaa9" ${S}/><path d="M18 12l3 8M30 10v10" stroke="#9aa878" stroke-width="2" stroke-linecap="round"/>`,
  dash: `<path d="M5 18h20M3 26h24M8 34h16" fill="none" stroke="#6fa3cf" stroke-width="2" stroke-linecap="round"/><path d="M28 38c9-2 14-11 14-24-9 3-14 11-14 24z" fill="#f3e6c8" ${S}/><path d="M29 37l10-18" fill="none" ${S}/>`,
  branch: `<path d="M10 43c6-10 10-17 14-36M18 28c6-2 10-6 14-12M21 18c-4-2-8-6-10-10" fill="none" stroke="#7a5a3a" stroke-width="2.200" stroke-linecap="round"/><ellipse cx="34" cy="14" rx="5" ry="3" fill="#9aa878" ${S}/><ellipse cx="9" cy="7" rx="4" ry="2.500" fill="#9aa878" ${S}/><ellipse cx="25" cy="6" rx="3" ry="4" fill="#b9c48f" ${S}/>`,
  shrine: `<path d="M11 42V21q13-15 26 0v21z" fill="#dccaa9" ${S}/><path d="M19 42V27q5-6 10 0v15z" fill="#6b5a48" ${S}/><circle cx="24" cy="15" r="3" fill="#e9b85a" ${S}/><path d="M7 42h34" ${S}/>`,
  far: `<circle cx="34" cy="14" r="6" fill="#e9b85a" ${S}/><path d="M8 30q16-9 32 0-8 12-16 12T8 30z" fill="#c4a683" ${S}/><path d="M8 30q16 5 32 0" fill="none" stroke="#fff8e6" stroke-width="1.5"/><path d="M8 14q3-3 5 0 3-3 5 0M16 20q2-2 4 0 2-2 4 0" fill="none" ${S}/>`,
  gap: `<path d="M2 44V24h13l3 20zM46 44V28H33l-3 16z" fill="#c4a683" ${S}/><path d="M15 21q9-14 18 4" fill="none" stroke="#e0a83f" stroke-width="2" stroke-dasharray="1 4" stroke-linecap="round"/><path d="M30 20l3 5 4-4" fill="none" stroke="#e0a83f" stroke-width="1.6" stroke-linecap="round"/>`,
  dust: `<path d="M24 25a3 3 0 1 1 3-3 7 7 0 1 1-11-3 12 12 0 1 1 20 12" fill="none" stroke="#b79a78" stroke-width="2.400" stroke-linecap="round"/><path d="M8 38h.01M14 42h.01M38 40h.01M42 34h.01M6 30h.01" stroke="#b79a78" stroke-width="2.600" stroke-linecap="round"/>`,
  bridge: `<path d="M6 14v28M42 14v28" stroke="#7a5a3a" stroke-width="2.600" stroke-linecap="round"/><path d="M6 18q18 14 36 0M6 27q18 12 36 0" fill="none" ${S}/><path d="M12 22v9M18 25v8M24 26v8M30 25v8M36 22v9" stroke="#b98a5c" stroke-width="2.400" stroke-linecap="round"/>`,
};
export const echoArt = (key) => `<svg class="echo" viewBox="0 0 48 48" aria-hidden="true"><g ${WOB}>${ECHO[key.split('echo_')[1]] ?? ECHO.shrine}</g></svg>`;
export const taleArt = (n, on) => `<svg class="tale" viewBox="0 0 48 48" aria-hidden="true"><g ${WOB}><rect x="4" y="4" width="40" height="40" rx="3" fill="${on ? '#8c3b2e' : 'none'}" stroke="${on ? INK : '#a79c88'}" stroke-width="1.4" ${on ? '' : 'stroke-dasharray="3 3"'}/>${on ? '<rect x="7.500" y="7.500" width="33" height="33" rx="2" fill="none" stroke="#e9b85a" stroke-width="1.6"/><path d="M8 16q6-2 6-8M40 32q-6 2-6 8M40 16q-6-2-6-8M8 32q6 2 6 8" fill="none" stroke="#e9b85a" stroke-width="1.2"/>' : ''}</g><text x="24" y="31" text-anchor="middle" font-family="Georgia, serif" font-size="19" font-style="italic" fill="${on ? '#fff3cf' : '#a79c88'}">${['I', 'II', 'III', 'IV', 'V'][n] ?? n + 1}</text></svg>`;
export const glyph = (id, w = 1.8) => `<path d="${GLYPH[id].map((l) => 'M' + l.map(([x, y]) => `${(x * 10 + 12).toFixed(1)} ${(12 - y * 10).toFixed(1)}`).join('L')).join('')}" fill="none" stroke="${SONG_COL[id]}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;
export const songArt = (id) => `<svg class="echo" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="#3d3833"/>${glyph(id, 1.5)}</svg>`;

// ---- controls page: the wanderer in a pose per action ----
const fig = (x, y, r = 0, staff = 0) => `<g transform="translate(${x} ${y}) rotate(${r})"><path d="M-3 9l-1.500 7M3 9l1.500 7" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
  <path d="M0-8C-5-6-7 2-7.500 10Q0 12.500 7.500 10C7 2 5-6 0-8Z" fill="#c9954f" stroke="${INK}" stroke-width="1.2"/><path d="M-5.500 3q5.500 2 11 0M-6.500 7q6.500 2 13 0" stroke="#f3e2c0" stroke-width="1" fill="none"/>
  <circle cy="-11" r="4.200" fill="#f1dcc0" stroke="${INK}" stroke-width="1.2"/><path d="M-4.600-10.500a4.600 4.600 0 0 1 9.200 0q-4.600-3.500-9.200 0z" fill="#c9954f" stroke="${INK}" stroke-width="1"/>
  <g transform="rotate(${staff} 6 2)"><path d="M6 11V-15" stroke="#7a5a3a" stroke-width="1.6" stroke-linecap="round"/><path d="M6-20l2.300 3.200L6-13.600l-2.300-3.200z" fill="#7fc4dc" stroke="${INK}" stroke-width=".8"/></g></g>`;
const wind = (d) => `<path d="${d}" fill="none" stroke="#6fa3cf" stroke-width="1.8" stroke-linecap="round"/>`;
const POSE = {
  move: `${fig(24, 25)}<path d="M9 44h.01M15 41h.01M33 44h.01M39 41h.01" stroke="${INK}" stroke-width="3" stroke-linecap="round" opacity=".5"/>`,
  run: `<g class="a-lean">${fig(27, 25, 14)}</g>${wind('M3 16h9M1 25h10M4 34h8')}`,
  jump: `<path d="M9 45q15-9 30 0" fill="none" stroke="${INK}" stroke-width="1.2" stroke-dasharray="2 3"/><g class="a-jump">${fig(24, 21)}</g>`,
  dash: `${wind('M1 18h17M0 26h19M3 34h15')}<g class="a-dash">${fig(32, 26, 32)}</g>`,
  sing: `${fig(17, 27, 0, -12)}<g class="a-wave" fill="none" stroke="#e0a83f" stroke-width="1.8" stroke-linecap="round"><path d="M30 15a9 9 0 0 1 0 12"/><path d="M35 11a15 15 0 0 1 0 20"/><path d="M40 7a21 21 0 0 1 0 28"/></g>`,
  strike: `${fig(17, 28, 0, 72)}<path d="M31 6a22 22 0 0 1 12 24" fill="none" stroke="${INK}" stroke-width="1.3" stroke-dasharray="3 3"/><path d="M40 33l2 5M43 30l5 1M37 36l-1 5" stroke="#e0a83f" stroke-width="1.8" stroke-linecap="round"/>`,
  look: `<path d="M6 24q18-17 36 0-18 17-36 0z" fill="#f9f3ec" ${S}/><circle cx="24" cy="24" r="6" fill="#6fa3cf" ${S}/><circle cx="24" cy="24" r="2.200" fill="${INK}"/><path d="M24 4v6M21 7l3-3 3 3M24 44v-6M21 41l3 3 3-3" fill="none" ${S}/>`,
  zoom: `<circle cx="21" cy="21" r="12" fill="#f9f3ec" ${S}/><path d="M30 30l12 12" stroke="${INK}" stroke-width="3.400" stroke-linecap="round"/><path d="M15 21h12M21 15v12" fill="none" ${S}/>`,
  restart: `<path d="M38 24a14 14 0 1 1-5-10.800" fill="none" stroke="${INK}" stroke-width="2.400" stroke-linecap="round"/><path d="M34 4v10H24" fill="none" stroke="${INK}" stroke-width="2.400" stroke-linecap="round" stroke-linejoin="round"/>`,
  pause: `<circle cx="24" cy="24" r="16" fill="#f9f3ec" ${S}/><path d="M19 16v16M29 16v16" stroke="${INK}" stroke-width="3.400" stroke-linecap="round"/>`,
  skip: `<path d="M10 12l12 12-12 12M26 12l12 12-12 12" fill="none" stroke="${INK}" stroke-width="2.800" stroke-linecap="round" stroke-linejoin="round"/>`,
};
const songPose = (id) => `${fig(13, 28, 0, -10)}<circle cx="34" cy="20" r="13" fill="#3d3833" ${S}/><g transform="translate(22 8)">${glyph(id, 1.6)}</g>`;
export const pose = (k) => `<svg class="pose" viewBox="0 0 48 48" aria-hidden="true">${POSE[k] ?? songPose(k)}</svg>`;

// ---- results stamp, achievement badges ----
export const stamp = (n) => `<svg class="stamp" viewBox="0 0 48 48" aria-hidden="true"><g ${WOB}><path d="M24 3c4-1 6 2 9 3s7 1 9 5-1 6 0 10 4 6 2 10-6 3-8 6-2 7-6 8-6-2-10-2-7 2-10-1-1-7-4-10-6-4-5-9 4-5 5-9 0-7 4-9 6 0 9-1 3-1 5-1z" fill="#b5452f" stroke="${INK}" stroke-width="1.2"/><circle cx="24" cy="24.500" r="13.500" fill="none" stroke="#e58b73" stroke-width="1.2"/></g><text x="24" y="31" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-size="${String(n).length > 2 ? 15 : 19}" fill="#ffe3d6">${n}</text></svg>`;
const BADGE = { story: ['#8c3b2e', 'book'], mastery: ['#3f6f96', 'badge'], explore: ['#5f7f4a', 'map'], secret: ['#5a4a78', 'eye'], speed: ['#b7791f', 'skip'], loom: ['#8a5a3a', 'loom'] };
export function badge(g, on = true, secret = false) { // a stitched round patch in its group's colour; not yet earned = bare cloth, a secret = '?'
  const [c, i] = BADGE[g] ?? BADGE.story, line = on ? '#fff3cf' : '#a79c88';
  return `<svg class="badge${on ? ' on' : ''}" viewBox="0 0 40 40" aria-hidden="true"><g ${WOB}><circle cx="20" cy="20" r="18" fill="${on ? c : '#e9dfcc'}" stroke="${on ? INK : '#a79c88'}" stroke-width="1.2"/></g><circle cx="20" cy="20" r="14.500" fill="none" stroke="${on ? '#f3d58a' : '#a79c88'}" stroke-width="1.4" stroke-dasharray="3 2.400"/><g transform="translate(10 10) scale(.84)" fill="none" stroke="${line}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${secret && !on ? '<path d="M9 9.500a3 3 0 1 1 4.500 2.600c-1 .6-1.500 1.200-1.500 2.400M12 18h.01"/>' : ICO[i]}</g></svg>`;
}
