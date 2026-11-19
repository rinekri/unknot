// Registry, system loader, fixed-step loop, chapters, perf budgets, warm-up.
import * as THREE from 'three';
import { mulberry32, hash, installTestMode } from './rng.js';
import { assets } from './assets.js';
import { readParams, installTestApi } from './testapi.js';
import { createPost } from './post.js';
import { normalize, loadSettings, saveSettings, urlOverrides } from './settings.js';
import { getSave } from './save.js';

export const DT = 1 / 60;
const MAX_FRAME_DT = 0.1, MAX_STEPS = 5, INIT_TIMEOUT_MS = 120000;
const BUDGET = { simMs: 4, systemMs: 1.5, drawCalls: 400, tris: 1.5e6 };
const CORE = ['input', 'camera']; // always on, even with only=<system>

export function createRegistry() {
  const vals = new Map(), subs = new Map();
  return {
    get: (k) => vals.get(k),
    set(k, v) { vals.set(k, v); subs.get(k)?.forEach((f) => f(v)); },
    on(k, f) { if (!subs.has(k)) subs.set(k, new Set()); subs.get(k).add(f); return () => subs.get(k)?.delete(f); },
    delete(k) { vals.delete(k); },
  };
}

const defs = Object.values(import.meta.glob('../systems/*.js', { eager: true }))
  .map((m) => m.default).filter(Boolean).sort((a, b) => a.order - b.order);

export async function boot() {
  const params = readParams();
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: params.test });
  renderer.setPixelRatio(1); // non-test runs set the real ratio from settings below
  renderer.setSize(innerWidth, innerHeight);
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  // STYLE.md: paper sky, cream distance fog, low warm dawn backlight at 2 o'clock (the level runs toward +Z), cool bright fill
  scene.background = new THREE.Color(0xf9f3ec);
  scene.fog = new THREE.Fog(0xf6eadb, 40, 360); // between paper and the horizon haze so far islands melt into the sky band
  scene.add(new THREE.HemisphereLight(0xe6edf2, 0xaaa4b6, 2.3));
  const sun = new THREE.DirectionalLight(0xffd29a, 1.6);
  sun.position.set(-6, 4.5, 10);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 500);
  const post = createPost(renderer); // edge lines + grade (core/post.js)
  const resize = () => { renderer.setSize(innerWidth, innerHeight); post.setSize(); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
  addEventListener('resize', resize);

  const over = urlOverrides(params.get), urlSet = normalize({ ...(params.test ? {} : loadSettings()), ...over });
  const game = { params, renderer, scene, camera, registry: null, settings: normalize(urlSet), levelId: params.level, chapter: null, t: 0, errors: [], active: [], perf: { simMs: 0, drawCalls: 0, tris: 0 } };
  // Settings: test runs always use the defaults (never read or write storage), so state() stays independent of the player's config.
  // Mutate game.settings, then call applySettings(): re-derives quality, applies the pixel ratio, persists and notifies 'settings'.
  game.applySettings = () => {
    Object.assign(game.settings, normalize(game.settings)); // in place: menus and systems keep their reference
    if (!params.test) {
      const save = { ...game.settings }, stored = loadSettings();
      for (const k of Object.keys(over)) { // a URL override is never saved: the stored value stays until the player changes that setting
        if (save[k] === urlSet[k]) save[k] = stored[k]; else delete over[k];
      }
      saveSettings(save);
      renderer.setPixelRatio(Math.min(devicePixelRatio, game.settings.pixelRatio));
      resize();
    }
    game.registry?.set('settings', game.settings);
  };
  if (!params.test) { renderer.setPixelRatio(Math.min(devicePixelRatio, game.settings.pixelRatio)); resize(); }
  addEventListener('error', (e) => game.errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => game.errors.push(String(e.reason?.message ?? e.reason)));
  const onlyDeps = params.only ? [params.only, ...(defs.find((d) => d.name === params.only)?.deps ?? [])] : null;
  const wanted = (d) => (!d.chapter || d.chapter === game.chapter) && (!onlyDeps || CORE.includes(d.name) || onlyDeps.includes(d.name));

  async function initSystem(def) {
    const reg = game.registry, owned = [], offs = [];
    const ctx = {
      game, scene, camera, renderer, assets, params, levelId: game.levelId,
      registry: { ...reg, on(k, f) { const off = reg.on(k, f); offs.push(off); return off; } },
      rng: mulberry32(params.seed ^ hash(def.name)),
      add(o) { scene.add(o); owned.push(o); return o; }, // tracked so chapter changes can remove it
    };
    const s = { def, ctx, owned, offs, ms: 0 };
    let timer;
    try {
      await Promise.race([def.init?.(ctx), new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('init timeout')), def.timeoutMs ?? INIT_TIMEOUT_MS); })]);
      game.active.push(s);
    } catch (e) {
      disable(s, e);
    } finally { clearTimeout(timer); }
  }
  function dispose(s) {
    try { s.def.dispose?.(s.ctx); } catch (e) { game.errors.push(`${s.def.name}.dispose: ${e.message}`); }
    s.offs.forEach((off) => off());
    s.owned.forEach((o) => o.removeFromParent());
    game.active = game.active.filter((a) => a !== s);
  }
  function disable(s, e) {
    game.errors.push(`${s.def.name}: ${e?.message ?? e}`);
    console.warn(`[engine] system ${s.def.name} disabled:`, e);
    dispose(s);
  }

  game.setChapter = async (id) => {
    game.chapter = id;
    for (const s of [...game.active].reverse()) if (s.def.chapter && s.def.chapter !== id) dispose(s);
    for (const d of defs) if (d.chapter === id && wanted(d)) await initSystem(d);
  };

  // opts.checkpoint seeds the respawn point before any system initialises (player.js spawns from it); opts.echoes = known echo keys.
  game.start = async (levelId = game.levelId, opts = {}) => {
    game.loading = true; // the real-time loop idles while systems are swapped
    for (const s of [...game.active].reverse()) dispose(s);
    game.levelId = levelId;
    game.chapter = levelId;
    game.t = 0;
    game.registry = createRegistry();
    game.registry.set('settings', game.settings);
    if (opts.checkpoint) game.registry.set('checkpoint', opts.checkpoint);
    opts = { gifts: getSave().gifts, echoes: getSave().echoes, ...opts }; // R6: the save (core/save.js) unless the caller hands its own
    if (opts.gifts) game.registry.set('gifts.known', opts.gifts); // hud.js: gifts received on earlier walks (level.js seeds flags)
    if (opts.echoes) game.registry.set('echoes.known', opts.echoes); // hud.js: echoes found on earlier walks (echo.js)
    if (params.test) installTestMode(params.seed, () => game.t);
    if (params.bot) game.registry.set('bot.enabled', true);
    for (const d of defs) if (wanted(d)) await initSystem(d);
    await assets.whenIdle();
    await warmUp();
    render(1);
    game.loading = false;
  };

  async function warmUp() {
    const saved = [];
    scene.traverse((o) => { saved.push([o, o.visible, o.frustumCulled]); o.visible = true; o.frustumCulled = false; });
    await renderer.compileAsync(scene, camera);
    saved.forEach(([o, v, f]) => { o.visible = v; o.frustumCulled = f; });
  }

  let simAcc = 0, simSteps = 0;
  game.step = () => {
    const paused = game.registry.get('paused');
    const t0 = performance.now(); // perf timing only, never fed into the sim
    for (const s of [...game.active]) {
      if (paused && !s.def.whilePaused) continue;
      const ts = performance.now();
      try { s.def.update?.(s.ctx, DT); } catch (e) { disable(s, e); }
      s.ms += performance.now() - ts;
    }
    if (!paused) game.t += DT; // sim time stands still under a menu: platforms, bridges, wind and particles resume where they were
    if (params.test && game.t >= params.timeout && !game.registry.get('end')) game.registry.set('end', 'timeout');
    simAcc += performance.now() - t0;
    if (++simSteps === 60) reportPerf();
  };

  function reportPerf() {
    const info = renderer.info.render;
    game.perf = { simMs: +(simAcc / simSteps).toFixed(3), drawCalls: info.calls, tris: info.triangles };
    const rows = { sim: { ms: game.perf.simMs, budget: BUDGET.simMs } };
    for (const s of game.active) { rows[s.def.name] = { ms: +(s.ms / simSteps).toFixed(3), budget: s.def.budgetMs ?? BUDGET.systemMs }; s.ms = 0; }
    rows.drawCalls = { ms: info.calls, budget: BUDGET.drawCalls };
    rows.tris = { ms: info.triangles, budget: BUDGET.tris };
    if (params.perf) {
      console.table(rows);
      const over = Object.entries(rows).filter(([, r]) => r.ms > r.budget).map(([k]) => k);
      if (over.length) console.warn('[perf] over budget:', over.join(', '));
    }
    simAcc = 0; simSteps = 0;
  }

  function render(alpha) {
    const paused = game.registry.get('paused');
    for (const s of game.active) { // a system the pause stops draws its last state: alpha on a frozen sim swings the render clock back and forth (pose / cloth jitter)
      try { s.def.beforeRender?.(s.ctx, paused && !s.def.whilePaused ? 1 : alpha); } catch (e) { disable(s, e); }
    }
    post.render(scene, camera);
  }
  game.render = render;

  game.advance = async (seconds) => {
    for (let i = 0, n = Math.round(seconds * 60); i < n; i++) game.step();
    render(1);
  };

  await game.start(params.level);
  if (params.test) installTestApi(game); // window.__game appears only once the first level is playable (test=1 only)
  if (import.meta.env.DEV) window.__dev = game; // dev server only: lets Playwright probe a real (non-test) run
  document.getElementById('boot')?.remove();
  if (params.test) return; // test mode: only advance() moves time

  let last = performance.now(), acc = 0;
  renderer.setAnimationLoop((now) => {
    if (game.loading) { last = now; return; }
    acc += Math.min((now - last) / 1000, MAX_FRAME_DT) * (game.registry.get('bot.enabled') ? 1 : game.settings.gameSpeed); // assist: slower world clock
    last = now;
    for (let n = 0; acc >= DT && n < MAX_STEPS; n++) { game.step(); acc -= DT; }
    acc = Math.min(acc, DT); // drop backlog instead of spiralling
    render(acc / DT);
  });
}
