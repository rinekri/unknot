import * as THREE from 'three';
// URL params + window.__game (see references/contracts.md "Test contract").
export function readParams() {
  const q = new URLSearchParams(location.search);
  const test = q.get('test') === '1';
  if (!test) for (const k of ['only', 'bot', 'perf', 'timeout', 'hero', 'cloth', 'shot', 'cut', 'cutT']) q.delete(k); // test hooks are inert in production
  return {
    test,
    seed: parseInt(q.get('seed') ?? '1', 10) || 1,
    level: q.get('level') || 'l1',
    only: q.get('only'),
    bot: q.get('bot') === '1',
    perf: q.get('perf') === '1',
    timeout: +(q.get('timeout') ?? 240),
    get: (k) => q.get(k), // raw access for game-specific params (e.g. hero=)
  };
}

const r4 = (v) => Math.round(v * 1e4) / 1e4;

export function installTestApi(game) {
  window.__game = {
    advance: (seconds) => game.advance(seconds),
    state() {
      const reg = game.registry, p = reg.get('player');
      return {
        level: game.levelId, t: r4(game.t),
        player: p ? { pos: p.pos.toArray().map(r4), vel: p.vel.toArray().map(r4), grounded: p.grounded, state: p.state, breath: r4(p.breath), breathMax: p.breathMax } : null,
        falls: reg.get('falls') ?? 0, end: reg.get('end') ?? null, flags: { ...(reg.get('flags') ?? {}) },
        errors: [...game.errors], perf: { ...game.perf },
      };
    },
    png() { game.render(1); return game.renderer.domElement.toDataURL('image/png'); },
    start: (levelId) => game.start(levelId),
    enableBot() { game.registry.set('bot.enabled', true); },
    botLog: () => [...(game.registry.get('bot.log') ?? [])],
    registry: () => game.registry,
    cutscenes: () => Object.entries(game.registry.get('level')?.data.cutscenes ?? {}).map(([name, c]) => ({ name, id: `${game.levelId}.${name}`, dur: c.dur, lines: c.lines?.length ?? 0 })), // this level's; ?cut=<name>&cutT=<s> renders one
    scene: () => game.scene, THREE, // probes raycast the visual decor
    step: (n = 1) => { for (let i = 0; i < n; i++) game.step(); }, // sim only, no render (probes) // probes (tools/probe_collision.mjs) drive the real player through 'input' and 'player'
  };
}
