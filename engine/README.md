# Three.js template

Vite + three 0.187.0, plain JS ES modules. Copied into a game's `engine/` and extended there.

## Run
```
npm install            # also copies the Draco decoder to public/draco
npm run dev            # play: WASD/arrows, Space jump (hold = higher), Shift run, drag to look
npm run build && npm run preview          # http://localhost:4173
npm run sync-assets    # copy the repo's ../assets into public/assets (skips .blend .kra raw/ src/; never deletes)
npm run playtest       # bot run (preview must be up), seeds 1,2,3 -> ../playtest/l1.s<seed>.json, l1.json = seed 1, shots
npm run demo-level     # regenerates public/assets/levels/l1 from tools/make_demo_level.mjs
```

## Smoke test
From the template copy (`engine/`; outputs go to `../playtest/`). Takes about 2 minutes on first install.
```sh
npm install
npm i -D playwright && npx playwright install chromium
npm run build                                   # expect: "✓ built in ..." and exit 0
npx vite preview --port 4173 --strictPort &        # leave running; kill it after
npm run playtest                                # bot, seeds 1,2,3
node $HOME/.claude/skills/video-to-game/scripts/playtest_web.mjs --url http://localhost:4173 --levels l1 --determinism
node $HOME/.claude/skills/video-to-game/scripts/playtest_web.mjs --url http://localhost:4173 --levels l1 --shot vista
```
Expected output (exit 0 for each command):
```
l1: seed=1 end=goal t=5s falls=0 errors=0 shots=2 -> playtest/l1.s1.json
l1: seed=2 end=goal t=5s falls=0 errors=0 shots=2 -> playtest/l1.s2.json
l1: seed=3 end=goal t=5s falls=0 errors=0 shots=2 -> playtest/l1.s3.json
l1: determinism seed=1 t=10 identical
l1: shot=vista -> playtest/l1_vista.png errors=0
```
Then look at `../playtest/l1_vista.png` (the demo course from behind the start, with ink outlines). Any `end=timeout`, `errors>0` or `DIFFERENT` is a template bug.

## Layout
- `src/core/engine.js`: registry, system loader (every `src/systems/*.js`), 60 Hz fixed step, chapters, perf budgets.
- `src/core/testapi.js`: `window.__game` = `advance(s)`, `state()`, `png()`, `start(id)`, `enableBot()`, `botLog()`.
- `src/core/collide.js`: triangle collision (capsule sweep with step-up, ground probe, raycast, moving bodies).
- `src/core/post.js`: edge-line post pass (depth + normal edges, width x `refZ/z`, static wobble), shoulder grade, vignette, IGN dither. Tune `EDGES`.
- `src/systems/`: input, level, bot, player, cloth, camera, audio, look, hud. One file per system.

## Mechanisms
`platform`, `crumble`, `wind` (box area; the force is a push velocity in m/s added to the player's movement, scaled by `cycle`; the bot logs `{event: "wind", detail: {id, pushed}}` on exit).

## Adding a system
Drop `src/systems/foo.js` exporting `{name, order, deps?, chapter?, init(ctx), update(ctx, dt), beforeRender(ctx, alpha), dispose(ctx)}`.
Talk to other systems only through `ctx.registry` (`get/set/on`). Add scene objects with `ctx.add(obj)` so they are removed on dispose.
Use `ctx.rng()`, never `Math.random`, for anything that affects the sim. An init that throws or takes over 120 s disables only that system.

## URL params
`test=1` (no real-time loop, seeded `Math.random`/`Date.now`), `seed=N`, `level=id`, `bot=1`, `only=<system>` (plus its deps, input and camera),
`perf=1` (per-system ms table every second), `timeout=s`, `shot=<name>` (camera at `level.shots` entry, no bot), `hero=<glb path>`, `cloth=<cloth.json path>`.

## Assets
Loaded from `public/` with the paths in `references/contracts.md`. A missing hero GLB falls back to a capsule; a missing cloth or audio manifest is skipped.
The demo level is made of real GLBs (world, collider, placement) so the same loader path runs with generated art.
It exercises a moving lift, wind (`cycle`), a checkpoint, a step-up ledge and solid placed instances (`placement.json` `"solid"`).
`look.js` does the tone ramp (`RAMP` = STYLE.md palette hexes, or `null` for luminance bands); `core/post.js` draws the edge lines and grade in `render()` (`EDGES.enabled = false` for STYLE.md `line: none`).
Cloth lengths and radii in `cloth.json` are meters at model scale 1; they are multiplied by the model's world scale (`extras.scale`).
