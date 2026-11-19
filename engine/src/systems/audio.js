// Audio bus. Files: assets/audio/<cat>/manifest.json + .ogg (music, ambience, sfx). Procedural WebAudio: jump, land (step samples + synth layer); fallback for strike, step.
// 'audio.cue' -> {name, at?, gain?, surface?, foot?, run?}   'audio.duck' -> {db, seconds} (ducks music)   'end' = 'goal' -> goal sting + stinger.
// Cues play a random file variant (step_grass_0..1, step_stone_0..3: surface from 'player.step'), never the same one twice in a row, at
// +-5 % pitch; footsteps also vary pitch +-8 % (L -3 %, R +3 %), gain, start offset, lowpass and timing, and run steps are cut short. Drawn from this
// system's own rng stream (never Math.random, never the sim stream). A cue without a file falls back to the synth below.
// Music: each level plays theme_<levelId> once, then stays silent for a random manifest `gap` seconds, then plays it again
// (the takes fade in/out on their own, no loop seam). stinger_intro opens the level, stinger_goal answers 'end' = 'goal'.
// Mix: ambience -14 dB, ducked a further 5 dB while a theme plays; sfx bus +4 dB; bus volumes follow registry 'settings' live.
// The AudioContext is created on the first user gesture (autoplay policy) and lives across levels.
// Voice (bus 'voice', settings volume.voice): NPC babble per 'talk.line' (npc.js) - formant syllables (two band-passes on a
// glottal saw / breath noise) seeded by a hash of the line, so a line always sounds the same; presets golem, wisp, kestrel,
// orren (a three-voice chord through a feedback delay), whisper (breath only: narrator). Hero efforts, quiet: jump 'hup',
// strike 'hah', hard landing 'uf', fall gasp, dash 'hm'. No speech synthesis: babble carries tone, subtitles carry words.
// World layer (beforeRender): the ambience wind runs through a lowpass that opens with height and the level's breeze
// ('world.breeze', world.js); a looped noise hiss swells near the nearest waterfall (level data 'falls').
// Wind volumes (level.js windState): the nearest WIND_N live ones within WIND_FAR m each hold one pooled loop (noise -> band-pass
// -> gain -> pan) on the ambience bus. Updraft: a band-pass that climbs with strength + a low hum; cross/tailwind: a broad hiss
// panned toward where the force points. Gain = strength x distance falloff x slow gust LFO, louder and brighter inside. A whoosh
// on enter / exit and when a wind starts near the hero (cycling updrafts), a swell of all wind when a totem frees one or a wall breaks.
// Test/bot mode (params.test) is silent: nothing is fetched, no context is made, the sim never waits on audio.
import { mulberry32 } from '../core/rng.js';
import { tr } from './hud.js';
import { windState, noteOf } from './level.js';
import { VOICE } from './loom.js'; // R10 voice skin (cosmetic): NPC babble pitch / formant scale

const CATS = ['music', 'ambience', 'sfx', 'voice'];
const AMBIENCE = { name: 'wind', db: -14, duckDb: -5 };
const SFX_DB = 4, HARD_LAND = 11; // m/s impact for an 'uf'
const ALIAS = { strike: 'staff_whoosh', dash: 'staff_whoosh' }; // cue name -> sfx file base name
const RATE = { dash: 2 ** (-4 / 12) }; // cue name -> playback rate: the dash is the whoosh 4 semitones down (+ the cloth layer), apart from the strike
const FILE_SURFACE = { grass: 'grass' }; // surfaces with their own step files; the rest play stone + a FLAVOR layer
const dbGain = (db) => 10 ** (db / 20);
let pantAt = 0, chimeAt = 0, actx, master, buses, musicDuck, ambDuck, ambLP, hiss, falls = [], frame = 0, files, loading, music, musicTimer, ambience, want, noise, rng, game, introDue, surface = 'stone', flavor = null, hitAt = -1, uiBound, grind = null, windBus, windSlots = [], windPrev = new Map();
const WIND_N = 3, WIND_FAR = 45, HUM_FAR = 45; // loops, m, m
const clamp1 = (v) => Math.max(-1, Math.min(1, v));
const raw = {}, bufs = {}, decoding = {}, variants = {}; // `${cat}/${name}` -> ArrayBuffer / AudioBuffer; `sfx/<base>` -> [keys]

function load(url) { // background fetches, untracked so game.start never waits on audio
  loading ??= Promise.all(CATS.map(async (cat) => {
    const r = await fetch(url(`assets/audio/${cat}/manifest.json`));
    if (!r.ok || (r.headers.get('content-type') || '').includes('text/html')) return;
    await Promise.all(Object.entries((await r.json()).tracks ?? {}).map(async ([name, tr]) => {
      files[`${cat}/${name}`] = tr;
      const f = await fetch(url(`assets/audio/${cat}/${tr.file}`));
      if (f.ok) raw[`${cat}/${name}`] = await f.arrayBuffer();
    }));
  })).then(() => decodeAll()).catch((e) => console.warn(`[audio] load failed: ${e.message}`)); // cached: one fetch + decode pass
  return loading;
}

async function decodeAll() {
  if (!actx) return;
  await Promise.all(Object.entries(raw).map(async ([k, b]) => {
    if (bufs[k]) return;
    try { bufs[k] = await (decoding[k] ??= actx.decodeAudioData(b.slice(0))); } catch (e) { console.warn(`[audio] ${k}: ${e.message}`); }
  }));
  for (const k of Object.keys(bufs)) if (k.startsWith('sfx/')) { const list = variants[k.replace(/_\d+$/, '')] ??= []; if (!list.includes(k)) list.push(k); }
  startLoops();
}

const fade = (v, to, sec) => { const now = actx.currentTime; v.g.gain.cancelScheduledValues(now); v.g.gain.setValueAtTime(v.g.gain.value, now); v.g.gain.linearRampToValueAtTime(to, now + sec); };
function voice(key, gainDb, dest, loop) { // file voice on its category bus, starts silent
  const tr = files[key], src = actx.createBufferSource(), g = actx.createGain();
  src.buffer = bufs[key];
  src.loop = loop;
  if (loop && tr.loopEnd) { src.loopStart = tr.loopStart ?? 0; src.loopEnd = tr.loopEnd; }
  g.gain.value = 0;
  src.connect(g).connect(dest);
  src.start();
  return { key, src, g, level: dbGain(gainDb + (tr.trimDb ?? 0)) };
}
const duckAmbience = (on) => ambDuck?.gain.setTargetAtTime(on ? dbGain(AMBIENCE.duckDb) : 1, actx.currentTime, 1.2);

function stinger(name) { // one-shot on the music bus (not under the duck node); returns its length in seconds
  const k = `music/${name}`;
  if (!bufs[k]) return 0;
  const src = actx.createBufferSource(), g = actx.createGain();
  src.buffer = bufs[k];
  g.gain.value = dbGain(files[k].trimDb ?? 0);
  src.connect(g).connect(buses.music);
  src.start();
  return bufs[k].duration;
}

function scheduleTheme(sec) {
  clearTimeout(musicTimer);
  musicTimer = setTimeout(playTheme, sec * 1000);
}
function playTheme() {
  musicTimer = null;
  const key = `music/${want}`;
  if (!actx || !bufs[key] || music) return;
  const v = music = voice(key, 0, musicDuck, false), gap = files[key].gap ?? [20, 40];
  fade(v, v.level, 0.05);
  duckAmbience(true);
  v.src.onended = () => {
    if (music !== v) return; // disposed or replaced
    music = null;
    duckAmbience(false);
    scheduleTheme(gap[0] + rng() * (gap[1] - gap[0]));
  };
}

function startLoops() {
  const amb = `ambience/${AMBIENCE.name}`;
  if (!ambience && bufs[amb]) { ambience = voice(amb, AMBIENCE.db, ambDuck, true); fade(ambience, ambience.level, 3); }
  let lead = 0.3;
  if (introDue && bufs[`music/${want}`]) {
    introDue = false;
    if (game.t < 15) lead = stinger('stinger_intro') + 0.5; // a gesture long after the level began gets no fanfare
  }
  if (!music && musicTimer == null && bufs[`music/${want}`]) scheduleTheme(lead);
}

function applyVolumes(S) {
  if (!actx || !S?.volume) return;
  const v = S.volume, now = actx.currentTime;
  master.gain.setTargetAtTime(v.master, now, 0.05);
  buses.music.gain.setTargetAtTime(v.music, now, 0.05);
  buses.ambience.gain.setTargetAtTime(v.ambience, now, 0.05);
  buses.sfx.gain.setTargetAtTime(v.sfx * dbGain(SFX_DB), now, 0.05);
  buses.voice.gain.setTargetAtTime(v.voice ?? 1, now, 0.05);
}

function unlock(url) {
  if (!actx) {
    actx = new AudioContext();
    master = actx.createGain();
    const comp = actx.createDynamicsCompressor(); // glue: stacked cues (gift + unbind + chime + voice) never clip
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 4; comp.attack.value = 0.005; comp.release.value = 0.2;
    master.connect(comp).connect(actx.destination);
    buses = Object.fromEntries(CATS.map((c) => { const g = actx.createGain(); g.connect(master); return [c, g]; }));
    musicDuck = actx.createGain(); musicDuck.connect(buses.music);
    ambLP = actx.createBiquadFilter(); ambLP.type = 'lowpass'; ambLP.frequency.value = 1500; ambLP.connect(buses.ambience);
    ambDuck = actx.createGain(); ambDuck.connect(ambLP);
    windBus = actx.createGain(); windBus.connect(buses.ambience);
    const rnd = mulberry32(7), n = actx.createBuffer(1, actx.sampleRate, actx.sampleRate), d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = rnd() * 2 - 1;
    noise = n;
    for (let i = 0; i < WIND_N; i++) windSlots.push(windSlot());
    applyVolumes(game.settings);
    load(url).then(decodeAll); // decode of a file already in flight is shared via `decoding`
  }
  return actx.resume().catch((e) => console.warn(`[audio] resume: ${e.message}`));
}

// ---- procedural cues: short envelopes on oscillators / filtered noise; each carries a 1-3 kHz component for laptop speakers ----
const pitch = mulberry32(11); // small per-hit variation, never Math.random (seeded in test mode)
function env(g, t, peak, attack, decay) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.exponentialRampToValueAtTime(1e-4, t + attack + decay); }
function burst(t, dur, type, f0, f1, q, peak, out) {
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noise; f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, peak, 0.005, dur);
  s.connect(f).connect(g).connect(out);
  s.start(t, pitch() * 0.8, dur + 0.05);
}
function tone(t, dur, type, f0, f1, peak, out) {
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  env(g, t, peak, 0.004, dur);
  o.connect(g).connect(out);
  o.start(t); o.stop(t + dur + 0.05);
}
const SYNTH = {
  // U8 / U9 Knot Shards, one voice per kind. hit_squall: a wind thud and a flutter; hit_warden: a stone crack and a grunt; hit_boss: a
  // deep chord. counter: the hit that lands in the telegraph (bright). dull: a blow or song that takes nothing (two close low notes).
  // stun: a slow wobble while the knot hangs open. shatter: a glass / stone crash under a tritone. disperse: wind torn away. pickup: a drop taken.
  hit_squall: (t, out) => { tone(t, 0.14, 'sine', 150, 70, 0.5, out); burst(t, 0.12, 'lowpass', 1400, 300, 0.8, 0.4, out); for (let i = 0; i < 4; i++) burst(t + 0.06 + i * 0.045, 0.05, 'bandpass', 1500 + i * 250, 900, 2, 0.16 - i * 0.03, out); },
  hit_warden: (t, out) => { tone(t, 0.18, 'sine', 110, 48, 0.7, out); burst(t, 0.3, 'bandpass', 2400, 700, 1.6, 0.45, out); burst(t + 0.02, 0.08, 'highpass', 4200, 3000, 0.8, 0.2, out); tone(t + 0.05, 0.22, 'sawtooth', 92, 70, 0.1, out); },
  hit_boss: (t, out) => { [55, 82.4, 110, 130.8].forEach((f, i) => tone(t, 0.9, i ? 'triangle' : 'sine', f, f * 0.97, 0.3 / (i + 1), out)); burst(t, 0.3, 'lowpass', 900, 150, 0.7, 0.5, out); },
  counter: (t, out) => { tone(t, 0.1, 'sine', 180, 60, 0.6, out); burst(t, 0.1, 'highpass', 5000, 2500, 0.8, 0.35, out); [1318, 1976, 2637].forEach((f, i) => tone(t + 0.02 * i, 0.7, 'sine', f, f, 0.08, out)); },
  dull: (t, out) => { tone(t, 0.35, 'triangle', 147, 139, 0.22, out); tone(t, 0.35, 'triangle', 156, 147, 0.2, out); burst(t, 0.08, 'lowpass', 500, 200, 0.7, 0.25, out); },
  stun: (t, out) => { const o = actx.createOscillator(), l = actx.createOscillator(), lg = actx.createGain(), g = actx.createGain(); o.type = 'sine'; o.frequency.setValueAtTime(660, t); o.frequency.exponentialRampToValueAtTime(440, t + 2.6); l.frequency.setValueAtTime(7, t); l.frequency.linearRampToValueAtTime(2.5, t + 2.6); lg.gain.value = 40; l.connect(lg).connect(o.frequency); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.1); g.gain.linearRampToValueAtTime(0, t + 2.8); o.connect(g).connect(out); o.start(t); l.start(t); o.stop(t + 2.9); l.stop(t + 2.9); },
  shatter: (t, out) => { burst(t, 0.5, 'highpass', 6000, 1800, 0.8, 0.5, out); burst(t, 0.7, 'lowpass', 1600, 200, 0.8, 0.5, out); for (let i = 0; i < 7; i++) tone(t + 0.03 * i + pitch() * 0.02, 0.25, 'triangle', 2200 + pitch() * 2400, 1800, 0.05, out); tone(t, 1.1, 'sawtooth', 196, 185, 0.07, out); tone(t, 1.1, 'sawtooth', 277, 262, 0.07, out); },
  disperse: (t, out) => { burst(t, 0.8, 'bandpass', 700, 3200, 0.9, 0.4, out); tone(t, 0.5, 'sine', 520, 180, 0.06, out); },
  pickup: (t, out) => { [1568, 2093].forEach((f, i) => tone(t + i * 0.06, 0.4, 'sine', f, f, 0.08, out)); },
  // U7: land_hard = the thump of a long drop (gain by height, player.js); stage = the charge chime of a song stage (rate by stage)
  land_hard: (t, out) => { tone(t, 0.3, 'sine', 90, 38, 0.9, out); burst(t, 0.25, 'lowpass', 700, 120, 0.7, 0.5, out); burst(t + 0.04, 0.2, 'bandpass', 2200, 900, 1.5, 0.2, out); },
  // R3 song motifs (songs.js 'song.done' with a target): gust a whoosh under an open fifth chord; name a warm 3-note call (rising
  // minor third, then the fourth); anchor a low bell with a metal clink. song_fizzle: a song with no target / a failed skill check:
  // a dry puff and a dissonant tick (no breath was spent). Knot Shards (enemies.js): telegraph whine, charge rush, knock thump, ring.
  song_gust: (t, out) => { burst(t, 0.6, 'bandpass', 500, 2600, 0.8, 0.4, out); [392, 587, 784].forEach((f, i) => tone(t + 0.05 + i * 0.03, 0.9, 'triangle', f, f, 0.05, out)); },
  song_name: (t, out) => { [[440, 0], [523, 0.16], [587, 0.32]].forEach(([f, d]) => { tone(t + d, 0.55, 'sine', f, f, 0.1, out); tone(t + d, 0.4, 'triangle', f * 2, f * 2, 0.025, out); }); },
  song_anchor: (t, out) => { [[110, 0.3], [277, 0.12], [415, 0.06]].forEach(([f, a]) => tone(t, 2.2, 'sine', f, f * 0.995, a, out)); burst(t + 0.18, 0.06, 'bandpass', 5200, 4800, 8, 0.3, out); tone(t + 0.18, 0.12, 'triangle', 3100, 3000, 0.05, out); },
  song_fizzle: (t, out) => { burst(t, 0.25, 'lowpass', 900, 200, 0.7, 0.25, out); tone(t + 0.05, 0.12, 'square', 1480, 1480, 0.03, out); tone(t + 0.05, 0.12, 'square', 1568, 1568, 0.03, out); },
  enemy_tele: (t, out) => { tone(t, 0.6, 'sawtooth', 300, 620, 0.035, out); burst(t, 0.6, 'bandpass', 900, 2600, 3, 0.15, out); },
  enemy_charge: (t, out) => { burst(t, 0.45, 'bandpass', 2400, 500, 0.9, 0.4, out); },
  enemy_knock: (t, out) => { tone(t, 0.2, 'sine', 120, 50, 0.6, out); burst(t, 0.15, 'lowpass', 1200, 200, 0.8, 0.4, out); },
  enemy_ring: (t, out) => { tone(t, 1.2, 'sine', 196, 185, 0.12, out); burst(t, 0.9, 'bandpass', 700, 300, 1, 0.3, out); },
  // the thief wisp: a quick glassy chirp, a plucked thread going (falling), coming back (rising); the pull squall: a long low indrawn
  // breath, then a hollow roar; a blow on the guard's ring shield: a dull bell
  thief_tele: (t, out) => { tone(t, 0.12, 'sine', 1760, 2640, 0.06, out); tone(t + 0.14, 0.12, 'sine', 2093, 3136, 0.06, out); },
  thief_take: (t, out) => { tone(t, 0.35, 'triangle', 880, 330, 0.12, out); burst(t, 0.2, 'bandpass', 3000, 1200, 2, 0.2, out); },
  thief_back: (t, out) => { tone(t, 0.3, 'triangle', 440, 988, 0.12, out); tone(t + 0.12, 0.5, 'sine', 1319, 1319, 0.06, out); },
  pull_tele: (t, out) => { tone(t, 1.1, 'sine', 160, 70, 0.3, out); burst(t, 1.1, 'lowpass', 300, 1400, 0.7, 0.3, out); },
  pull_on: (t, out) => { burst(t, 2.8, 'bandpass', 420, 260, 0.6, 0.45, out); tone(t, 2.8, 'sine', 62, 55, 0.3, out); },
  enemy_block: (t, out) => { tone(t, 0.5, 'sine', 233, 220, 0.3, out); tone(t, 0.25, 'triangle', 699, 660, 0.08, out); burst(t, 0.05, 'bandpass', 2600, 2000, 4, 0.3, out); },
  fizzle: (t, out) => { tone(t, 0.12, 'triangle', 392, 370, 0.07, out); tone(t + 0.08, 0.35, 'sawtooth', 380, 140, 0.04, out); }, // a gift song without breath: the note cracks and falls
  deny: (t, out) => { tone(t, 0.16, 'sine', 330, 247, 0.12, out); tone(t + 0.12, 0.22, 'sine', 247, 196, 0.1, out); }, // two soft falling notes
  chime: (t, out) => { [784, 1175, 1568].forEach((f, i) => tone(t + i * 0.09, 1.1, 'sine', f, f, 0.07, out)); tone(t, 0.3, 'triangle', 392, 392, 0.05, out); },
  rattle: (t, out) => { for (let i = 0; i < 10; i++) burst(t + i * 0.05 + pitch() * 0.02, 0.04, 'bandpass', 1800 + pitch() * 1600, 1100, 2.5, 0.22, out); },
  thud: (t, out) => { tone(t, 0.25, 'sine', 70, 42, 0.7, out); burst(t, 0.18, 'lowpass', 500, 120, 0.7, 0.35, out); },
  cloth: (t, out) => { burst(t, 0.22, 'bandpass', 700, 2400, 1.2, 0.3, out); burst(t + 0.03, 0.16, 'highpass', 3000, 5000, 0.7, 0.12, out); },
  hover: (t, out) => { tone(t, 0.03, 'triangle', 2200, 2000, 0.05, out); },
  step: (t, out) => { const v = 0.85 + pitch() * 0.3; burst(t, 0.07, 'bandpass', 1300 * v, 500 * v, 1.2, 0.45, out); burst(t, 0.05, 'bandpass', 2400 * v, 1500, 2, 0.3, out); tone(t, 0.05, 'sine', 140 * v, 80, 0.15, out); },
  // jump/land: built from the surface's step samples (synth step without them) + a short synth layer
  jump: (t, out) => { foot(t, out); burst(t, 0.15, 'bandpass', 900, 2200, 1.5, 0.25, out); }, // push-off + cloth flutter
  land: (t, out) => { foot(t, out); foot(t + 0.035, out); tone(t, 0.12, 'sine', 120, 60, 0.6, out); }, // both feet + thump
  // breath (player.js): empty = a breathy falling sigh; refill = a soft two-note chime (louder when full)
  pant: (t, out) => { burst(t, 0.18, 'bandpass', 1700, 1100, 1.4, 0.16, out); burst(t + 0.26, 0.22, 'bandpass', 1200, 700, 1.2, 0.2, out); }, // player.js empty breath: in / out
  breath_out: (t, out) => { burst(t, 0.5, 'bandpass', 1400, 500, 1.2, 0.35, out); burst(t + 0.05, 0.35, 'lowpass', 900, 300, 0.7, 0.25, out); tone(t, 0.4, 'sine', 330, 220, 0.12, out); },
  breath_in: (t, out) => { tone(t, 0.5, 'sine', 1318, 1318, 0.12, out); tone(t + 0.07, 0.6, 'sine', 1976, 1976, 0.09, out); tone(t, 0.25, 'triangle', 2637, 2637, 0.03, out); },
  // level.js: a wall breaking (low crack + rubble hiss); a timed bridge's last seconds (dry wooden tick)
  crack: (t, out) => { tone(t, 0.25, 'sine', 160, 55, 0.7, out); burst(t, 0.6, 'lowpass', 1800, 300, 0.8, 0.5, out); burst(t + 0.05, 0.35, 'bandpass', 2600, 900, 1.5, 0.3, out); },
  // echo.js: a shard caught (soft rising triad) / counted (the triad again, an octave up, with a low hum)
  echo: (t, out) => { [1046, 1318, 1568].forEach((f, i) => tone(t + i * 0.06, 0.5, 'sine', f, f, 0.08, out)); },
  echo_got: (t, out) => { [2093, 2637, 3136].forEach((f, i) => tone(t + i * 0.08, 0.8, 'sine', f, f, 0.06, out)); tone(t, 1.2, 'sine', 262, 262, 0.1, out); },
  tick: (t, out) => { burst(t, 0.04, 'bandpass', 3400, 3000, 6, 0.4, out); tone(t, 0.05, 'triangle', 1500, 1400, 0.15, out); },
  // fx.js: perched birds take off (wing claps + two chirps); level.js: a rune wakes (a low open chord swelling in);
  // world.js: a Keeper unbound (a falling shimmer of noise over a rising triad)
  birds: (t, out) => { for (let i = 0; i < 9; i++) burst(t + i * 0.045 + pitch() * 0.03, 0.05, 'bandpass', 1700 + pitch() * 900, 900, 1.4, 0.3, out); [3400, 4100].forEach((f, i) => tone(t + 0.1 + i * 0.13, 0.08, 'sine', f, f * 1.25, 0.06, out)); },
  hum: (t, out) => { [110, 165, 220, 330].forEach((f, i) => { const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12 / (i + 1), t + 0.6); g.gain.exponentialRampToValueAtTime(1e-4, t + 3); o.connect(g).connect(out); o.start(t); o.stop(t + 3.1); }); },
  unbind: (t, out) => { burst(t, 1.4, 'bandpass', 4200, 700, 2, 0.25, out); [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.12, 1.1, 'sine', f, f, 0.07, out)); tone(t, 0.6, 'sine', 98, 70, 0.3, out); },
  // npc.js: a gift (Kamen's dash, the totem's breath, Kestrel's wind): a slow gold arpeggio over a low drone, threads hissing in
  gift: (t, out) => { [392, 523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.11, 1.2, 'sine', f, f, 0.08, out)); tone(t, 1.8, 'sine', 131, 131, 0.18, out); burst(t + 0.2, 1.2, 'bandpass', 3000, 6000, 1.5, 0.12, out); },
  // wind (beforeRender): entering (rising) / leaving (falling) a wind volume; a wind starting or freed: a slow broad swell
  whoosh_in: (t, out) => { burst(t, 0.45, 'bandpass', 500, 2400, 0.9, 0.35, out); },
  whoosh_out: (t, out) => { burst(t, 0.5, 'bandpass', 2000, 450, 0.9, 0.28, out); },
  gust: (t, out) => { const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain(); s.buffer = noise; s.loop = true; f.type = 'bandpass'; f.Q.value = 0.7;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(1800, t + 0.9); f.frequency.exponentialRampToValueAtTime(600, t + 2.4);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.4, t + 0.8); g.gain.exponentialRampToValueAtTime(1e-4, t + 2.5);
    s.connect(f).connect(g).connect(out); s.start(t, pitch() * 0.5); s.stop(t + 2.6); },
  strike: (t, out) => { burst(t, 0.2, 'bandpass', 3200, 900, 2.5, 0.45, out); burst(t, 0.16, 'bandpass', 1800, 1200, 2, 0.3, out); tone(t + 0.06, 0.09, 'triangle', 2000, 1300, 0.25, out); tone(t + 0.06, 0.07, 'triangle', 420, 300, 0.2, out); },
};

// ---- voice: formant babble and hero efforts ----
const VOWELS = { a: [800, 1200], e: [500, 1900], i: [300, 2300], o: [500, 900], u: [330, 800], y: [400, 1600] }, VKEYS = Object.keys(VOWELS);
const PRESET = { // f0 Hz, formant scale, syllables/s, peak, breath (noise share), chord (f0 multiples), delay s, wave
  golem: { f0: 68, fmt: 0.72, rate: 4.5, peak: 0.55, breath: 0.15, wave: 'sawtooth' },
  wisp: { f0: 340, fmt: 1.3, rate: 8, peak: 0.22, breath: 0.6, wave: 'triangle' },
  kestrel: { f0: 880, fmt: 1.7, rate: 10, peak: 0.16, breath: 0.2, wave: 'square', chirp: 1.6 },
  orren: { f0: 98, fmt: 0.9, rate: 3.5, peak: 0.3, breath: 0.25, wave: 'sawtooth', chord: [1, 1.5, 2.02], delay: 0.31 },
  whisper: { f0: 0, fmt: 1.05, rate: 7, peak: 0.5, breath: 1 },
  hero: { f0: 175, fmt: 1.05, peak: 0.16, breath: 0.35, wave: 'sawtooth' },
};
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
function syllable(t, len, vowel, f0, f1, P, out) { // glottal source(s) + breath -> two formant band-passes -> envelope
  const g = actx.createGain(), mix = actx.createGain(), [F1, F2] = VOWELS[vowel].map((f) => f * P.fmt);
  env(g, t, P.peak, Math.min(0.04, len * 0.3), len);
  for (const [F, q, k] of [[F1, 6, 1], [F2, 9, 0.6]]) { const b = actx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = F; b.Q.value = q; const bg = actx.createGain(); bg.gain.value = k * 3; mix.connect(b).connect(bg).connect(g); }
  g.connect(out);
  if (P.f0) for (const m of P.chord ?? [1]) {
    const o = actx.createOscillator(), og = actx.createGain();
    o.type = P.wave; o.frequency.setValueAtTime(f0 * m, t); o.frequency.exponentialRampToValueAtTime(f1 * m, t + len);
    og.gain.value = (1 - P.breath) / (P.chord?.length ?? 1);
    o.connect(og).connect(mix); o.start(t); o.stop(t + len + 0.1);
  }
  if (P.breath) { const s = actx.createBufferSource(), ng = actx.createGain(); s.buffer = noise; ng.gain.value = P.breath * 0.8; s.connect(ng).connect(mix); s.start(t, pitch() * 0.8, len + 0.1); }
}
function voiceOut(P) { // voice bus, through a feedback delay for orren
  const out = actx.createGain();
  out.connect(buses.voice);
  if (P.delay) { const d = actx.createDelay(1), fb = actx.createGain(), wet = actx.createGain(); d.delayTime.value = P.delay; fb.gain.value = 0.38; wet.gain.value = 0.5; out.connect(d).connect(fb).connect(d); d.connect(wet).connect(buses.voice); }
  return out;
}
function babble(text, preset, dur) { // syllables over ~85 % of the line's time, contour seeded by the text
  if (!actx || !text) return;
  const P0 = PRESET[preset] ?? PRESET.whisper, P = VOICE.f0 === 1 ? P0 : { ...P0, f0: P0.f0 * VOICE.f0, fmt: P0.fmt * VOICE.fmt }, rnd = mulberry32(hash(text) ^ hash(preset)), out = voiceOut(P);
  const n = Math.max(2, Math.min(Math.round(dur * 0.85 * P.rate), Math.ceil(text.length / 2.6))), step = (dur * 0.85) / n, now = actx.currentTime + 0.05;
  for (let i = 0; i < n; i++) {
    if (rnd() < 0.12 && i && i < n - 1) continue; // small gaps read as words
    const f0 = P.f0 * (1 + 0.18 * (rnd() - 0.5)) * (i === n - 1 ? 0.88 : 1), f1 = f0 * (P.chirp ? P.chirp * (0.8 + 0.4 * rnd()) : 0.94 + 0.1 * rnd());
    syllable(now + i * step, step * (0.55 + 0.35 * rnd()), VKEYS[Math.floor(rnd() * VKEYS.length)], f0 || 1, f1 || 1, P, out);
  }
}
const EFFORT = { // vowel, length s, f0 start/end scale, gain (quiet: under the sfx)
  jump: ['u', 0.14, 1.0, 1.25, 0.8], strike: ['a', 0.16, 1.15, 0.85, 1], land: ['u', 0.12, 0.9, 0.75, 0.9], dash: ['y', 0.13, 1.0, 0.9, 0.7],
};
function effort(kind) {
  if (!actx) return;
  const P = PRESET.hero, t = actx.currentTime, out = voiceOut(P), v = 0.94 + 0.12 * pitch();
  if (kind === 'fall') { burst(t, 0.35, 'bandpass', 900, 2200, 2.5, 0.18, out); syllable(t + 0.05, 0.3, 'a', 210 * v, 300 * v, { ...P, peak: 0.12, breath: 0.7 }, out); return; } // gasp
  const [vowel, len, a, b, k] = EFFORT[kind];
  syllable(t, len, vowel, P.f0 * a * v, P.f0 * b * v, { ...P, peak: P.peak * k }, out);
}

const last = new WeakMap(); // variant list -> key played last: never the same file twice in a row
function sample(list, t, out, step, rate = 1) {
  let k = list[Math.floor(rng() * list.length)];
  if (k === last.get(list) && list.length > 1) k = list[(list.indexOf(k) + 1 + Math.floor(rng() * (list.length - 1))) % list.length];
  last.set(list, k);
  const src = actx.createBufferSource(), g = actx.createGain();
  src.buffer = bufs[k];
  let gain = dbGain(files[k].trimDb ?? 0), node = src, off = 0;
  if (step) { // footstep: per-hit pitch/foot/gain/start/tone so the same few files never read as a loop
    src.playbackRate.value = 1 + (rng() * 2 - 1) * 0.08 + (step.foot === 'l' ? -0.03 : step.foot === 'r' ? 0.03 : 0);
    gain *= dbGain(-3 * rng());
    off = rng() * 0.015;
    const f = actx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 2500 + rng() * 3500;
    node = src.connect(f);
  } else src.playbackRate.value = rate * (1 + (rng() * 2 - 1) * 0.05);
  g.gain.setValueAtTime(gain, t);
  if (step?.run) { g.gain.setValueAtTime(gain, t + 0.08); g.gain.linearRampToValueAtTime(0, t + 0.16); } // short tail: run steps never overlap
  node.connect(g).connect(out);
  src.start(t, off);
}
function foot(t, out) { const l = variants[`sfx/step_${surface}`]; if (l) sample(l, t, out, {}); else SYNTH.step(t, out); FLAVOR[flavor]?.(t, out); }
// per-surface layer over the stone step: slab = a hard click, wood = a hollow knock, rubble = loose gravel
const FLAVOR = {
  slab: (t, out) => { tone(t, 0.04, 'triangle', 2600, 2200, 0.08, out); tone(t, 0.06, 'sine', 420, 300, 0.12, out); },
  wood: (t, out) => { tone(t, 0.09, 'triangle', 240, 180, 0.3, out); burst(t, 0.06, 'bandpass', 800, 600, 3, 0.25, out); },
  rubble: (t, out) => { for (let i = 0; i < 4; i++) burst(t + i * 0.018 + pitch() * 0.01, 0.035, 'bandpass', 2600 + pitch() * 1800, 1500, 2, 0.18, out); },
};
const setSurface = (s) => { surface = FILE_SURFACE[s] ?? 'stone'; flavor = s === 'grass' || s === 'stone' ? null : s; };

// singing (level.js 'sing.target' / 'sing.done', player.js 'player.singEnd'): the hero's held tone on the switch's note (a soft
// open hum when nothing is in reach), the rune answering with a chord on its note, or two clashing notes (a wrong note in a sequence)
const hz = (n) => 220 * 2 ** (n / 12);
const SONG_NOTE = { gust: 7, name: 3, anchor: -5 }; // gift songs (player.js 'player.songStart'): semitones over A3
let song = null, bound = null; // the held tone {o: [osc], g}; the nearest bound hidden switch's hum {o, g, pan}
const resWas = [0, 0, 0], resAt = []; // marks.res rising edges (render)
const humPts = new WeakMap(); // level data -> switch id -> [[x, y, z]] the switch and its targets (static: lifts hum at their stop)
function humAt(lv, m) {
  let by = humPts.get(lv.data); if (!by) humPts.set(lv.data, by = {});
  if (by[m.id]) return by[m.id];
  const ms = lv.data.mechanisms, pts = [m.pos];
  const ids = m.targets?.length ? m.targets : ms.filter((x) => x.seq && x.seq === m.seq).flatMap((x) => x.targets ?? []);
  for (const id of ids) {
    const t = ms.find((x) => x.id === id); if (!t) continue;
    if (t.kind === 'wind') pts.push(t.area.min.map((v, i) => (v + t.area.max[i]) / 2));
    else if (t.kind === 'bridge') { const k = lv.targets.bridges[id]?.pieces[0]; if (k) pts.push(k.base.toArray()); }
    else { const k = lv.targets.mechs.find((x) => x.m === t); if (k) pts.push(k.base.toArray()); }
  }
  return (by[m.id] = pts);
}
function singOn(note) {
  singOff();
  const t = actx.currentTime, g = actx.createGain(), f = hz(note ?? -5), lfo = actx.createOscillator(), lg = actx.createGain();
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(note == null ? 0.06 : 0.11, t + 0.25);
  lfo.frequency.value = 5.2; lg.gain.value = f * 0.012; lfo.connect(lg);
  const o = [['triangle', 1, 1], ['sine', 2, 0.35]].map(([type, k, a]) => { const x = actx.createOscillator(), xg = actx.createGain(); x.type = type; x.frequency.value = f * k; lg.connect(x.frequency); xg.gain.value = a; x.connect(xg).connect(g); x.start(t); return x; });
  lfo.start(t); o.push(lfo); g.connect(buses.sfx);
  song = { o, g };
}
function singOff() {
  if (!song) return;
  const t = actx.currentTime; song.g.gain.cancelScheduledValues(t); song.g.gain.setTargetAtTime(0, t, 0.08);
  for (const x of song.o) x.stop(t + 0.5);
  song = null;
}
function answer(note, wrong) {
  const t = actx.currentTime + 0.05, out = actx.createGain(), f = hz(note ?? 0);
  out.connect(buses.sfx);
  if (wrong) { tone(t, 0.5, 'sawtooth', f, f * 0.94, 0.05, out); tone(t, 0.5, 'sawtooth', f * 2 ** (1 / 12), f * 0.97, 0.05, out); return; }
  [1, 1.5, 2, 3].forEach((k, i) => tone(t + i * 0.07, 1.6, 'sine', f * k, f * k, 0.09 / (i + 1), out)); // root, fifth, octave, twelfth
}

// U7 the hero's cry on a certain fall into the void (player.js 'scream' cue): an open "aaah" on the voice bus, pitch falling, the
// formants closing and the level dropping as he falls away; three seeded variants (length, pitch, a break in the voice).
function scream() {
  if (!actx) return;
  const P = PRESET.hero, t = actx.currentTime + 0.02, v = Math.floor(rng() * 3), len = [1.5, 1.25, 1.7][v], f0 = P.f0 * [2.3, 2.6, 2.1][v] * (0.97 + 0.06 * rng());
  const out = actx.createGain(), lp = actx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(700, t + len);
  out.gain.setValueAtTime(1, t); out.gain.exponentialRampToValueAtTime(0.08, t + len);
  out.connect(lp).connect(buses.voice);
  syllable(t, len, 'a', f0, f0 * 0.55, { ...P, peak: 0.3, breath: 0.25 }, out);
  if (v === 2) syllable(t + 0.5, 0.25, 'a', f0 * 1.12, f0 * 0.9, { ...P, peak: 0.12, breath: 0.4 }, out); // the voice breaks
}
// U7 wind roar: one noise loop on the sfx bus, heard only while airborne and falling, louder and brighter with the fall speed
let roar = null;
function roarAt(pl, now, paused) {
  if (!roar) { const src = actx.createBufferSource(), bp = actx.createBiquadFilter(), g = actx.createGain(); src.buffer = noise; src.loop = true; bp.type = 'bandpass'; bp.Q.value = 0.5; g.gain.value = 0; src.connect(bp).connect(g).connect(buses.sfx); src.start(); roar = { bp, g }; }
  const k = pl.grounded || paused ? 0 : Math.min(1, Math.max(0, (-pl.vel.y - 7) / 18));
  roar.g.gain.setTargetAtTime(0.5 * k * k, now, k ? 0.15 : 0.05); roar.bp.frequency.setTargetAtTime(400 + 1400 * k, now, 0.2);
}
function play(name, at = 0, gain = 1, step) {
  if (!actx) return;
  const t = actx.currentTime + at + (step ? rng() * 0.016 : 0), out = actx.createGain();
  out.connect(buses.sfx);
  out.gain.value = gain;
  const list = variants[name === 'step' ? `sfx/step_${surface}` : `sfx/${ALIAS[name] ?? name}`];
  if (list) sample(list, t, out, step, RATE[name]);
  else SYNTH[name]?.(t, out); // cues without a sound are fine
  if (name === 'step') FLAVOR[flavor]?.(t, out);
}

function grindLoop(on) { // stone grinding under a moving lift / rising bridge: looped low noise, faded in and out
  if (!actx) return;
  const now = actx.currentTime;
  if (on && !grind) {
    const src = actx.createBufferSource(), lp = actx.createBiquadFilter(), bp = actx.createBiquadFilter(), g = actx.createGain();
    src.buffer = noise; src.loop = true; src.playbackRate.value = 0.5; lp.type = 'lowpass'; lp.frequency.value = 380; bp.type = 'peaking'; bp.frequency.value = 1400; bp.gain.value = 6;
    g.gain.value = 0; g.gain.setTargetAtTime(0.32, now, 0.15);
    src.connect(lp).connect(bp).connect(g).connect(buses.sfx); src.start();
    grind = { src, g };
  } else if (!on && grind) { grind.g.gain.setTargetAtTime(0, now, 0.2); grind.src.stop(now + 1); grind = null; }
}

function windSlot() { // one pooled loop: noise -> band-pass -> gain -> pan, + a hum (sine) for updrafts; runs silent when unused
  const src = actx.createBufferSource(), bp = actx.createBiquadFilter(), g = actx.createGain(), pan = actx.createStereoPanner(), hum = actx.createOscillator(), hg = actx.createGain();
  src.buffer = noise; src.loop = true; bp.type = 'bandpass'; bp.frequency.value = 800; bp.Q.value = 0.8; g.gain.value = 0;
  hum.type = 'sine'; hum.frequency.value = 62; hg.gain.value = 0;
  src.connect(bp).connect(g).connect(pan).connect(windBus); hum.connect(hg).connect(pan);
  src.start(0, windSlots.length * 0.31); hum.start();
  return { id: null, src, bp, g, pan, hum, hg, ph: windSlots.length * 2.1 };
}
function windSwell() { if (!windBus) return; const now = actx.currentTime; windBus.gain.cancelScheduledValues(now); windBus.gain.setTargetAtTime(2.2, now, 0.25); windBus.gain.setTargetAtTime(1, now + 1.6, 0.9); play('gust', 0, 0.8); }
const _c = [0, 0, 0];
function windLoops(ctx, pl, now) { // beforeRender, 10 Hz
  const cam = ctx.camera, e = cam.matrixWorld.elements, rx = e[0], rz = e[2], t = ctx.game.t; // camera right (x, z)
  const live = [];
  for (const w of windState()) {
    const a = Math.abs(w.k ?? 0), p = windPrev.get(w.m.id) ?? { a, inside: w.inside }; // first sight: no whoosh
    for (let i = 0; i < 3; i++) _c[i] = Math.min(w.max[i], Math.max(w.min[i], pl.pos.getComponent(i) + (i === 1 ? 0.5 : 0)));
    const d = Math.hypot(_c[0] - pl.pos.x, _c[1] - pl.pos.y - 0.5, _c[2] - pl.pos.z);
    if (w.inside && !p.inside && a > 0.05) play('whoosh_in', 0, 0.5 + 0.5 * a);
    if (!w.inside && p.inside) play('whoosh_out', 0, 0.6);
    if (a > 0.05 && p.a <= 0.05 && d < 20 && !w.inside) play('gust', 0, 0.5 * (1 - d / 20)); // a cycling wind starting up nearby
    windPrev.set(w.m.id, { a, inside: w.inside });
    if (a > 0.01 && d < WIND_FAR) live.push({ w, a, d });
  }
  live.sort((x, y) => x.d - y.d).length = Math.min(live.length, WIND_N);
  for (const s of windSlots) if (!live.some((l) => l.w.m.id === s.id)) s.id = null;
  for (const l of live) { const s = windSlots.find((x) => x.id === l.w.m.id) ?? windSlots.find((x) => x.id === null); if (s) s.id = l.w.m.id; }
  for (const s of windSlots) {
    const l = live.find((x) => x.w.m.id === s.id);
    if (!l) { s.g.gain.setTargetAtTime(0, now, 0.4); s.hg.gain.setTargetAtTime(0, now, 0.4); continue; }
    const { w, a, d } = l, f = w.m.force, fl = Math.hypot(...f) || 1, up = f[1] / fl > 0.7, inn = w.inside ? 1 : 0;
    const gust = 0.75 + 0.25 * Math.sin(t * 0.53 + s.ph) * Math.sin(t * 1.37 + s.ph * 1.7);
    const fall = Math.max(0, 1 - d / WIND_FAR) ** 2, gain = (inn ? 0.55 : 0.3 * fall) * a * gust;
    if (up) { // rising band: climbs with strength and gust, an octave higher inside
      s.bp.Q.setTargetAtTime(1.6, now, 0.3); s.bp.frequency.setTargetAtTime((350 + 550 * a * gust) * (1 + inn), now, 0.25);
      s.hg.gain.setTargetAtTime((inn ? 0.12 : 0.05 * fall) * a, now, 0.3);
      const cx = (w.min[0] + w.max[0]) / 2 - pl.pos.x, cz = (w.min[2] + w.max[2]) / 2 - pl.pos.z, cl = Math.hypot(cx, cz) || 1;
      s.pan.pan.setTargetAtTime(inn ? 0 : 0.7 * (cx * rx + cz * rz) / cl, now, 0.3);
    } else { // broad hiss toward where the wind blows
      s.bp.Q.setTargetAtTime(0.5, now, 0.3); s.bp.frequency.setTargetAtTime((900 + 600 * gust) * (1 + 0.8 * inn), now, 0.25);
      s.hg.gain.setTargetAtTime(0, now, 0.3);
      s.pan.pan.setTargetAtTime(0.8 * Math.sign(w.k) * (f[0] * rx + f[2] * rz) / fl, now, 0.3);
    }
    s.g.gain.setTargetAtTime(gain, now, 0.15);
  }
  if (import.meta.env.DEV) window.__windBus = windBus, window.__windAudio = windSlots.map((s) => ({ id: s.id, gain: +s.g.gain.value.toFixed(3), hum: +s.hg.gain.value.toFixed(3), f: Math.round(s.bp.frequency.value), pan: +s.pan.pan.value.toFixed(2) }));
}

function duck(db, seconds) {
  if (!actx) return;
  const g = musicDuck.gain, now = actx.currentTime;
  g.cancelScheduledValues(now);
  g.setTargetAtTime(dbGain(db), now, 0.05);
  g.setTargetAtTime(1, now + seconds, 0.3);
}

export default {
  name: 'audio', order: 40, whilePaused: true,
  init(ctx) {
    if (ctx.params.test) return;
    files ??= {};
    game = ctx.game; rng = ctx.rng;
    want = `theme_${ctx.levelId}`;
    falls = ctx.registry.get('level')?.data?.falls ?? [];
    introDue = true;
    const url = ctx.assets.url;
    load(url);
    if (actx) startLoops();
    else {
      const evs = ['pointerdown', 'click', 'touchend', 'keydown']; // touchend/click: Safari only unlocks on those
      const go = () => unlock(url).then(() => { if (actx.state === 'running') evs.forEach((e) => removeEventListener(e, go)); });
      evs.forEach((e) => addEventListener(e, go));
    }
    if (!uiBound) { // menus live in hud.js: any button press clicks
      uiBound = true;
      addEventListener('click', (e) => { if (e.target.closest?.('button, [role=button]')) play('ui_click'); }, true);
    }
    const reg = ctx.registry;
    reg.on('audio.cue', ({ name, at = 0, gain = 1, surface: s, foot: f, run }) => {
      if (s) setSurface(s);
      if (name === 'rune' || name === 'wind') hitAt = ctx.game.t; // a switch was struck: the staff connects when the swing lands
      if (name === 'wind') windSwell(); // a totem freed / toggled a wind
      if (name === 'scream') return scream();
      play(name, at, gain, name === 'step' ? { foot: f, run } : undefined);
    });
    reg.on('player.step', (e) => setSurface(e.surface)); // published just before the 'step' cue
    reg.on('checkpoint', () => play('chime', 0.25, 0.8)); // level.js: a new respawn point (the cairn lights), after the breath_in refill
    reg.on('player.puff', (e) => play(e.song ? 'fizzle' : 'deny', 0, 0.7)); // dash before the gift: a soft refusal; a song without breath: a failed note
    reg.on('player.songStart', ({ song: s }) => actx && singOn(SONG_NOTE[s])); // a gift song: the held tone on the song's own note
    let cast = null; // Phase S: each stage reached rings a step up the song's own chord; the release is louder and longer with the stage
    reg.on('song.stage', ({ song: s, stage }) => { if (!actx) return; const out = actx.createGain(), f = hz(SONG_NOTE[s] + [0, 7, 12, 19][stage]); out.connect(buses.sfx); tone(actx.currentTime, 0.5, 'sine', f, f, 0.1, out); tone(actx.currentTime, 0.3, 'triangle', f * 2, f * 2, 0.04, out); });
    reg.on('song.cast', (c) => { cast = c; if (actx) singOff(); });
    reg.on('song.reject', () => { play('dull', 0, 0.9); play('disperse', 0, 0.4); });
    reg.on('rune.unlock', ({ from }) => { play('disperse', from ? 0.7 : 0, 0.8); play('pickup', from ? 0.75 : 0.05, 0.6); }); // the thread arrives, the whirl blows away // a rune still bound by its order
    for (const k of ['flinch', 'hit']) reg.on(`enemy.${k}`, ({ kind }) => play(`hit_${kind === 'squall' || kind === 'minion' ? 'squall' : kind === 'boss' ? 'boss' : 'warden'}`, 0, 0.9));
    reg.on('enemy.counter', () => { play('counter'); play('stun', 0.1); });
    reg.on('enemy.stun', () => play('stun', 0.1, 0.8)); reg.on('enemy.stagger', () => play('stun', 0.1, 0.8));
    reg.on('enemy.shrug', () => play('dull', 0, 0.8));
    reg.on('enemy.rebind', () => play('enemy_block', 0, 0.8));
    reg.on('enemy.unbind', () => play('unbind', 0.3, 0.9)); // the rising chord; the whispered "...I remember" comes with its 'talk.line'
    reg.on('enemy.shatter', () => play('shatter'));
    reg.on('enemy.disperse', () => play('disperse'));
    reg.on('drop.pick', () => play('pickup', 0, 0.8));
    reg.on('song.done', ({ id, song: s, stage = 1 }) => { if (!actx) return; if (id || s === 'gust') { if (id) answer(SONG_NOTE[s], false); play(`song_${s}`, 0, 0.6 + 0.15 * stage); if (stage > 1) play(s === 'gust' ? 'whoosh_in' : `song_${s}`, 0.12, 0.25 * stage); if (id && s === 'anchor' && cast) for (let i = 0; i < 4; i++) play('tick', cast.hold - 0.5 + i * 0.125, 0.8); } else play('dull', 0, 0.8); }); // it took: the chord + the song's motif; no target: a fizzle
    reg.on('song.fail', () => play('song_fizzle', 0, 0.8));
    reg.on('shrine.answer', ({ song }) => { if (actx) { play(`song_${song}`, 0.15, 0.9); play(`song_${song}`, 0.75, 0.6); } }); reg.on('enemy.demo', ({ song }) => { if (actx) play(`song_${song}`, 0, 0.8); }); // level.js: a song-shrine sings its song back (twice, the echo softer) // songs.js: over-charged gust / wrong rhythm / slipped anchor (free)
    reg.on('player.dash', () => play('cloth', 0, 0.8)); // cloak snaps with the burst
    reg.on('mech.grind', (on) => grindLoop(on)); // level.js: a lift or bridge slab is moving
    reg.on('crumble.warn', () => play('rattle', 0, 0.8)); // level.js: first touch of a crumbling slab
    reg.on('golem.step', () => play('thud', 0, 0.9)); // level.js: Kamen's footfall while he carries you
    reg.on('break', () => windSwell()); // level.js: a dam / wall broken, the held wind rushes through
    reg.on('mech.dock', () => play('thud', 0, 0.5));
    reg.on('player.strikeHit', () => { if (ctx.game.t - hitAt < 1.5) play('staff_hit'); });
    reg.on('talk.line', (l) => l && babble(tr(l.text), l.voice, l.dur));
    reg.on('player.jump', () => effort('jump'));
    reg.on('player.strike', () => effort('strike'));
    reg.on('sing.target', ({ note }) => actx && singOn(note));
    reg.on('player.singEnd', () => actx && singOff());
    reg.on('sing.done', ({ id, ok, wrong, note }) => { if (actx && id) { singOff(); answer(note, wrong && !ok); } });
    reg.on('player.dash', () => effort('dash'));
    reg.on('player.fall', () => effort('fall'));
    reg.on('player.land', ({ impact }) => impact >= HARD_LAND && effort('land'));
    reg.on('end', (v) => {
      if (v !== 'goal' || !actx) return;
      play('goal');
      stinger('stinger_goal');
      duck(-12, 4);
    });
    reg.on('audio.duck', ({ db, seconds }) => duck(db, seconds));
    reg.on('settings', applyVolumes);
  },
  beforeRender(ctx) {
    if (!actx || ctx.params.test || frame++ % 6) return; // ten updates a second are plenty for slow swells
    const reg = ctx.registry, pl = reg.get('player'), now = actx.currentTime;
    if (!pl) return;
    const base = reg.get('level')?.data?.spawn?.pos?.[1] ?? 0, h = Math.min(1, Math.max(0, (pl.pos.y - base) / 30)), breeze = reg.get('world.breeze') ?? 1;
    ambLP.frequency.setTargetAtTime(500 + (900 + 4200 * h) * (0.35 + 0.65 * breeze), now, 0.5);
    let d = Infinity;
    for (const f of falls) d = Math.min(d, Math.hypot(pl.pos.x - f.pos[0], pl.pos.y - f.pos[1], pl.pos.z - f.pos[2]));
    if (!hiss && falls.length) {
      const src = actx.createBufferSource(), bp = actx.createBiquadFilter(), g = actx.createGain();
      src.buffer = noise; src.loop = true; bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.6; g.gain.value = 0;
      src.connect(bp).connect(g).connect(buses.ambience); src.start();
      hiss = { src, g };
    }
    // out of breath: a soft pant loop (breathy in/out pairs) while the bar is empty
    const empty = pl.breath <= 0 && !reg.get('paused');
    if (empty && now >= pantAt) { const out = actx.createGain(); out.connect(buses.sfx); out.gain.value = 0.55; SYNTH.pant(now + 0.02, out); pantAt = now + 0.62; }
    if (!empty) pantAt = 0;
    roarAt(pl, now, reg.get('paused'));
    if (hiss) hiss.g.gain.setTargetAtTime(0.35 * Math.max(0, 1 - Math.max(0, d - 6) / 40) ** 2, now, 0.4);
    if (windSlots.length) windLoops(ctx, pl, now);
    // wind cairn spring: a soft chime every ~1.6 s, only while the hero is breathing it in (a full cloak hears nothing: the chime means refill)
    if (reg.get('spring') && pl.breath < pl.breathMax && now >= chimeAt && !reg.get('paused')) { play('chime', 0, 0.5); chimeAt = now + 1.4 + 0.4 * Math.random(); }
    // R3: a song target turned resonant (marks.js, in reach of an owned song): a faint echo of that song's motif, at most every 6 s
    const res = reg.get('marks.res');
    if (res && !reg.get('paused')) ['gust', 'name', 'anchor'].forEach((k, i) => { if (res[i] && !resWas[i] && now >= (resAt[i] ?? 0)) { play(`song_${k}`, 0, 0.22); resAt[i] = now + 6; } resWas[i] = res[i]; });
    // a bound hidden switch hums on its note an octave down, heard up to HUM_FAR m and panned: the ear finds the detour
    const flags = reg.get('flags') ?? {}, e = ctx.camera.matrixWorld.elements;
    let near = null, nd = HUM_FAR;
    const lv = reg.get('level');
    for (const m of lv?.data?.mechanisms ?? []) {
      if (m.kind !== 'switch' || !(m.hidden || m.gift) || flags[`switch.${m.id}`]) continue; // U19: an unsung song-shrine hums too
      for (const q of humAt(lv, m)) { // R3: the switch and its targets hum the same note (marks.js: the same carved mark)
        const dd = Math.hypot(q[0] - pl.pos.x, q[1] - pl.pos.y, q[2] - pl.pos.z);
        if (dd < nd) { nd = dd; near = { id: m.id, pos: q }; }
      }
    }
    if (near && !bound) {
      const g = actx.createGain(), pan = actx.createStereoPanner(), o = actx.createOscillator(), o2 = actx.createOscillator();
      g.gain.value = 0; o.type = 'sine'; o2.type = 'sine'; o.connect(g); o2.connect(g); g.connect(pan).connect(buses.ambience); o.start(); o2.start();
      bound = { g, pan, o, o2 };
    }
    if (bound) {
      if (near) { const f = hz(noteOf(near.id) - 12); bound.o.frequency.setTargetAtTime(f, now, 0.1); bound.o2.frequency.setTargetAtTime(f * 1.006, now, 0.1); // a slow beat
        const dx = near.pos[0] - pl.pos.x, dz = near.pos[2] - pl.pos.z; bound.pan.pan.setTargetAtTime(clamp1((dx * e[0] + dz * e[2]) / (Math.hypot(dx, dz) || 1)), now, 0.3); }
      bound.g.gain.setTargetAtTime(near && !reg.get('paused') ? (lv.targets?.switches.find((w) => w.m.id === near.id)?.lock ? 0.025 : 0.07) * (1 - nd / HUM_FAR) ** 2 : 0, now, 0.4);
    }
  },
  dispose() { // level change: the theme fades out and its schedule is dropped; the next level's init starts its own
    clearTimeout(musicTimer); musicTimer = null;
    grindLoop(false);
    if (actx) for (const s of windSlots) { s.id = null; s.g.gain.setTargetAtTime(0, actx.currentTime, 0.3); s.hg.gain.setTargetAtTime(0, actx.currentTime, 0.3); } // pooled loops idle silent across levels
    windPrev.clear();
    roar?.g.gain.setTargetAtTime(0, actx.currentTime, 0.1);
    singOff(); if (bound) { bound.g.gain.setTargetAtTime(0, actx.currentTime, 0.3); bound.o.stop(actx.currentTime + 1.5); bound.o2.stop(actx.currentTime + 1.5); bound = null; }
    if (actx && hiss) { hiss.g.gain.setTargetAtTime(0, actx.currentTime, 0.3); hiss.src.stop(actx.currentTime + 1.5); hiss = null; }
    if (actx && music) { const old = music; music = null; fade(old, 0, 1.5); old.src.stop(actx.currentTime + 1.6); duckAmbience(false); }
  },
};
