// NPCs and dialogue. level.npcs = [{id, kind, name: {en, ru}, voice, pos, switches?, talk: [...]}]:
//   kind 'golem'   Kamen (kamen.glb): hung on platform node `node` (level.js moves it), its flat back 0.85 m up = the node (the
//                  collider top), head toward +Z (the way it walks). Clips sleep, twitch (each name struck), standup (all struck), then idle_awake /
//                  walk (while the node moves); rune + eyes light. Back glyph i (glyph_a/b/c) and the glyph on name stone `switches[i]`
//                  (name_stone.glb prop) go dim -> gold when that switch is struck.
//   kind 'wisp'    Sigh (sigh.glb, clip float): a wind wisp, shown once flag `show` is set (render-only, facing its motion). It leads
//                  to the non-obvious: the nearest unfound secret (an echo slot not yet caught, an unbroken breakable) within SEEK m
//                  of the hero, echoes heard on an earlier walk last. Further than NEAR + 5 m it beckons BECKON m out from the hero
//                  that way; nearer it circles the secret and chimes when the hero comes within NEAR m or looks its way. Found: a happy spiral, and (sim) its `found` talk is queued as a bark. Nothing near: it
//                  idles at the hero's shoulder.
//   kind 'kestrel' a paper bird (kestrel.glb, clips strain / flyoff / circle) on two ropes (rope_sag.glb) from the `tie` empty of the
//                  anchor stake props (`switches`) to its tether_l / tether_r: strains, jolts per cut; flag `free` -> flyoff, then
//                  circles over `rise`.
//   kind 'orren'   Orren's Remnant (orren.glb, ground origin 1.4 m under `center`, turned rotY): runes rune1..3 on its pillars and
//                  the figure's face pulse until switch i is struck, then stay gold; clips lift1..3 per rune, exhale once npc.<id>.free;
//                  debris rings (knot_chunk.glb, one InstancedMesh per chunk variant) round `center`, one unwinds per rune.
// One AnimationMixer per NPC: clip times and weights are set from sim state and game time each render (no rng).
//   kind 'voice'   no body (the narrator).
// Striking: an NPC's runes are ordinary level switches (level.js); every switch in `switches` seen on (flag switch.<id>) counts
// once and sets flag npc.<id>.<n> (n = 1, 2, ...). Its time drives the render (head lift, ring unwind).
// talk = [{id, on?, if?, once? (default true), set?: [flags], who?: npc id, lines: [{en, ru}]}]: starts when flag `on` is set (and
// `if`, when given) and sets `set` at once; its lines play now, cutting a bark short, or after the talk playing. A level.trigger
// with `talk: <id>` queues that talk as a bark (played, and its `set` applied, only when nothing else is). Each line lasts max(2, chars * 0.06) s of game time; a sing press skips to the next line.
// Publishes 'talk' {t, id, npc} at a talk's start (bot.js logs it) and 'talk.line' {npc, who, voice, text, dur} per line / null
// at the end (hud.js subtitles, audio.js babble). `set` flags apply at a talk's start; `end` flags when its last line ends (or is
// skipped by a sing press), in sim time, so a goal can wait for the words (l3: Orren's farewell opens the arch).
// npc.bark = {talk, r}: that talk is queued as a bark once the hero comes within r m (2D) of the NPC's data `center` or `pos`.
// npc.lure (golem/kestrel/orren): a gold mote column over the NPC, visible from afar until its first switch is struck (render only). The goal circle gets the same column while open.
// 'echo' {id, line} (echo.js): the Keeper (whisper voice) says the line at once, cutting into any talk (its line replays after);
// an echo waiting behind another for over ECHO_TTL s is dropped.
import * as THREE from 'three';
import { tr } from './hud.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const ECHO_TTL = 4; // s an echo line may wait (behind another echo) before it is dropped
const SEEK = 45, KNOWN_PEN = 25, NEAR = 15, BECKON = 8, CHIME_GAP = 6, SPIRAL = 1.6; // m, m, m, m, s, s (Sigh)
const KESTREL_LEAVE = 25, KESTREL_WAKE = 12; // KESTREL_WAKE: hero within this many m -> the perched kestrel takes off to strain // s of circling (~2 turns at 0.5 rad/s) before the kestrel leaves for the Crown
const GLB = { golem: 'kamen', wisp: 'sigh', kestrel: 'kestrel', orren: 'orren' }, KAMEN_BACK = 0.85, ORREN_DROP = 1.4;
const GOLD = new THREE.Color('#e9b85a'), DIM = new THREE.Color('#5b554b'), CREAM = new THREE.Color('#fff3d0');
export const lineDur = (text) => Math.max(2, text.length * 0.06);
const ease = (u) => u * u * (3 - 2 * u);
const clamp01 = (u) => Math.min(1, Math.max(0, u));
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _u = new THREE.Vector3();
const KEEPER = { d: { id: 'keeper', name: { en: 'Keeper', ru: 'Хранитель', pt: 'Zelador' }, voice: 'whisper' } };
let S, glowTex;

function makeGlowTex() { // soft round sprite
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}
export const glow = (color, size, opacity = 1) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex ??= makeGlowTex(), color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }));
  s.scale.setScalar(size); s.layers.set(1);
  return s;
};
const unlit = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity });

// ---- bodies (render-only; built once per level) ----
function rig(n, gltf) { // every clip playing at weight 0, frozen: beforeRender sets time + weight, then mixer.update(0)
  const mixer = new THREE.AnimationMixer(gltf.scene);
  n.acts = Object.fromEntries(gltf.animations.map((c) => { const a = mixer.clipAction(c); a.play(); a.timeScale = 0; a.setEffectiveWeight(0); return [c.name, a]; }));
  n.mixer = mixer;
}
function pose(n, w) { // w = {clip: [weight, time]}
  for (const [k, a] of Object.entries(n.acts)) { const x = w[k]; a.setEffectiveWeight(x ? x[0] : 0); if (x) a.time = x[1]; }
  n.mixer.update(0);
}
function swapMats(root, fn) { // material name -> replacement (or undefined to keep); shared by every mesh using it
  const done = {};
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (o.isSkinnedMesh) o.frustumCulled = false;
    const name = o.material.name;
    if (!(name in done)) done[name] = fn(name);
    if (done[name]) o.material = done[name];
  });
  return done;
}

// ---- bodies (render-only; built once per level) ----
function golemBody(n, ctx, gltf) {
  const parent = ctx.scene.getObjectByName(n.d.node);
  if (!parent) return console.warn(`[npc] ${n.d.id}: node '${n.d.node}' missing`);
  const g = gltf.scene;
  g.position.set(0, -KAMEN_BACK, 0); // back on the collider top, head toward +Z: the way he walks (U22: he lay along X and crabbed sideways to C)
  parent.add(g);
  const m = swapMats(g, (name) => (name === 'rune' || name === 'eyes' || /^glyph_[abc]$/.test(name) ? unlit(DIM.clone()) : undefined));
  rig(n, gltf);
  const glyphs = (n.d.switches ?? []).map((sw, i) => { // switch i: glyph 'abc'[i] on its back + the glyph on its name stone
    const mats = [m[`glyph_${'abc'[i]}`]], stone = ctx.scene.getObjectByName(sw);
    if (stone) mats.push(...Object.values(swapMats(stone, (name) => (/^glyph_/.test(name) ? unlit(DIM.clone()) : undefined))).filter(Boolean));
    return { sw, mats: mats.filter(Boolean) };
  });
  Object.assign(n, { g, runeM: m.rune, eyeM: m.eyes, last: null, speed: 0, glyphs });
}

function lureBody(n, ctx, w = 1) { // thin soft gold column + rising motes (narrower and fainter than the level beacon, fogged with distance)
  const goal = w > 1, H = goal ? 14 : 9; // the goal's column: w x wider, taller, additive and unfogged, so it reads from the previous island
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.11 * w, 0.25 * w, H, 16, 1, true).translate(0, H / 2, 0), new THREE.MeshBasicMaterial({
    map: lureTex(), color: GOLD, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, fog: !goal,
    // the goal's: additive colour only, alpha untouched (as the motes below: alpha is sky coverage in post.js, it cut a hard slab out of the sky)
    ...(goal ? { blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor } : {}) }));
  beam.material.onBeforeCompile = (s) => { // soft sides: alpha falls to 0 at the silhouette instead of a hard-edged slab
    s.vertexShader = 'varying float vLureF;\n' + s.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vLureF = abs(normalize(normalMatrix * normal).z);');
    s.fragmentShader = 'varying float vLureF;\n' + s.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.a *= vLureF * vLureF;');
  };
  beam.layers.set(1);
  const g = new THREE.Group(); g.add(beam);
  // motes: one Points draw (was a sprite each: ~46 draws). The update loops below move plain {position, material.opacity}
  // stand-ins; onBeforeRender copies them in (additive: colour x opacity). Point size = sprite size / tan(fov/2) at the same depth.
  const count = goal ? 28 : 14, motes = Array.from({ length: count }, (_, i) => ({ position: new THREE.Vector3(), material: { opacity: 0 }, userData: { k: i / count } }));
  const pg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3)).setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({ map: glowTex ??= makeGlowTex(), color: GOLD, vertexColors: true, size: (0.22 * Math.sqrt(w)) / Math.tan(((ctx.camera?.fov ?? 50) * Math.PI) / 360),
    // additive colour only, alpha untouched: opacity rides in the vertex colour, so AdditiveBlending's alpha (full texture alpha even at
    // opacity 0) read as sky coverage in post.js and cut dark discs out of the sky
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor, fog: !goal }));
  pts.layers.set(1); pts.frustumCulled = false;
  pts.onBeforeRender = () => {
    const P = pg.attributes.position, C = pg.attributes.color;
    motes.forEach((m, i) => { P.setXYZ(i, m.position.x, m.position.y, m.position.z); C.setXYZ(i, m.material.opacity, m.material.opacity, m.material.opacity); });
    P.needsUpdate = C.needsUpdate = true;
  };
  g.add(pts);
  ctx.add(g);
  n.lure = { g, beam, motes, H, r: 0.3 * w };
}
let lureTexC;
function lureTex() { // vertical fade: soft at the foot, brightest low, gone at the top
  if (lureTexC) return lureTexC;
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d'), r = g.createLinearGradient(0, 0, 0, 128);
  r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(0.6, 'rgba(255,255,255,0.4)'); r.addColorStop(0.88, 'rgba(255,255,255,0.9)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 4, 128);
  return (lureTexC = new THREE.CanvasTexture(c));
}
const anchor = (ctx, d, out) => (d.node ? ctx.scene.getObjectByName(d.node)?.getWorldPosition(out) : null) ?? out.fromArray(d.center ?? d.pos);

function wispBody(n, ctx, gltf) {
  const g = new THREE.Group(), body = gltf.scene; // tails trail -Z: g faces its motion
  swapMats(body, (name) => unlit(CREAM, name === 'wisp_core' ? 0.85 : 0.5));
  body.traverse((o) => o.layers.set(1));
  rig(n, gltf);
  g.add(body, glow(CREAM, 1.1, 0.9));
  const trail = Array.from({ length: 6 }, (_, i) => { const s = glow(CREAM, 0.5 - i * 0.06, 0.5 - i * 0.07); ctx.add(s); return s; });
  g.visible = false; trail.forEach((s) => (s.visible = false));
  ctx.add(g);
  Object.assign(n, { g, trail, hist: [], at: null, lastT: null });
}

function kestrelBody(n, ctx, gltf, rope) {
  const g = gltf.scene; // nose along +Z
  swapMats(g, () => undefined);
  rig(n, gltf);
  g.position.fromArray(n.d.pos); g.rotation.set(0, n.d.rotY ?? 0, 0);
  ctx.add(g);
  const ends = ['tether_l', 'tether_r'].map((k) => g.getObjectByName(k));
  const ropes = (n.d.switches ?? []).map((sw) => { // stake `tie` -> tether empty; the stake rune glows until cut
    const stake = ctx.scene.getObjectByName(sw);
    if (!stake) return console.warn(`[npc] ${n.d.id}: stake '${sw}' missing`);
    stake.updateMatrixWorld(true);
    const runeM = swapMats(stake, (name) => (name === 'rune' ? unlit(GOLD.clone()) : undefined)).rune;
    stake.traverse((o) => { if (o.material === runeM) o.layers.set(1); }); // glowing inlay: colour pass only (draw budget)
    const r = rope.scene.clone(), snap = glow(CREAM, 0.9, 0); // r: 1 m along +Z, sagging 0.12 m
    snap.position.copy(stake.getObjectByName('tie')?.getWorldPosition(new THREE.Vector3()) ?? stake.position);
    r.position.copy(snap.position);
    ctx.add(r, snap);
    return { sw, r, snap, runeM };
  }).filter(Boolean);
  Object.assign(n, { g, ends, ropes, base: g.position.clone() });
}

const flat = (a) => new THREE.BufferAttribute(Float32Array.from({ length: a.count * 3 }, (_, i) => [a.getX, a.getY, a.getZ][i % 3].call(a, Math.floor(i / 3))), 3);
function chunkGeos(gltf) { // knot_chunk.glb chunk_a..d (stone + rune_glow prims): each merged to one vertex-coloured geometry (gold rune) = one draw per variant
  gltf.scene.updateMatrixWorld(true);
  let stone = null;
  const geos = ['chunk_a', 'chunk_b', 'chunk_c', 'chunk_d'].map((name) => {
    const parts = [];
    gltf.scene.getObjectByName(name)?.traverse((o) => {
      if (!o.isMesh) return;
      if (o.material.name === 'stone') stone ??= o.material;
      const src = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, geo = new THREE.BufferGeometry(); // float copies (meshopt quantizes)
      geo.setAttribute('position', flat(src.attributes.position)); geo.setAttribute('normal', flat(src.attributes.normal));
      geo.applyMatrix4(o.matrixWorld); // the chunks sit at the GLB origin (their centre); this also undoes meshopt's dequantize transform
      if (o.material.name === 'rune_glow') { const cs = new Float32Array(geo.attributes.position.count * 3); for (let i = 0; i < cs.length; i += 3) GOLD.toArray(cs, i); geo.setAttribute('color', new THREE.BufferAttribute(cs, 3)); }
      else geo.setAttribute('color', flat(src.attributes.color)); // the stone's own painted vertex colours
      parts.push(geo);
    });
    return parts.length ? mergeGeometries(parts) : null;
  }).filter(Boolean);
  const mat = stone ? stone.clone() : new THREE.MeshStandardMaterial({ name: 'stone' }); // named 'stone': look.js gives it the rock shading
  mat.vertexColors = true;
  return { geos, mat };
}
function orrenBody(n, ctx, gltf, chunkGltf) {
  const c = new THREE.Vector3().fromArray(n.d.center);
  const body = gltf.scene;
  body.position.copy(c).y -= ORREN_DROP; body.rotation.set(0, n.d.rotY ?? 0, 0);
  const m = swapMats(body, (name) => (/^rune\d$/.test(name) ? unlit(DIM.clone()) : undefined));
  rig(n, gltf);
  ctx.add(body);
  body.traverse((o) => { if (o.isMesh) o.geometry.setAttribute('aFade', new THREE.BufferAttribute(new Uint8Array(o.geometry.attributes.position.count).fill(1), 1)); }); // look.js: 4 m of stone dithers when it stands between the lens and the hero
  const { geos, mat } = chunkGeos(chunkGltf), slots = geos.map(() => 0);
  const rings = (n.d.rings ?? [1.9, 2.3, 2.7]).map((r, k) => {
    const N = 14 + 4 * k, vi = Array.from({ length: N }, (_, i) => (i + k) % geos.length); // chunk i: variant vi[i], instance slot at[i]
    const at = vi.map((v) => slots[v]++);
    const tilt = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.35 + 0.5 * k, (n.d.rotY ?? 0) + 1.1 * k, 0.25 * k));
    const sz = Array.from({ length: N }, (_, i) => 1 + ((i * 7919 + k * 31) % 13) / 12); // 1..2x the ~0.36 m chunk
    return { r, N, vi, at, tilt, sz, w: (k % 2 ? -1 : 1) * (0.5 - 0.1 * k) };
  });
  const ims = geos.map((geo, v) => { geo.setAttribute('aFade', new THREE.BufferAttribute(new Uint8Array(geo.attributes.position.count).fill(1), 1)); const im = new THREE.InstancedMesh(geo, mat, slots[v]); im.frustumCulled = false; ctx.add(im); return im; });
  const core = glow(CREAM, 1.2, 0.35); core.position.copy(c); ctx.add(core);
  const runes = (n.d.switches ?? []).map((sw, i) => ({ sw, mat: m[`rune${i + 1}`] })).filter((r) => r.mat);
  Object.assign(n, { c, rings, ims, core, runes });
}

// ---- dialogue ----
function start(ctx, n, talk, bark) { // flags + 'talk' now; lines now or queued behind an NPC talk
  const reg = ctx.registry, flags = reg.get('flags'), gs = (talk.set ?? []).filter((f) => f.startsWith('gift.'));
  if (talk.once !== false) S.played.add(talk.id);
  const had = gs.length && gs.every((f) => flags[f]); // replay with the gifts already carried: no hand-over, no gift lines
  if (had) talk = { ...talk, set: talk.set.filter((f) => !f.startsWith('gift.')), lines: talk.lines.filter((l) => !l?.gift) };
  if (talk.set?.length) { for (const f of talk.set) flags[f] = true; reg.set('flags', flags); }
  const who = S.byId[talk.who] ?? n;
  n.barkT = who.barkT = ctx.game.t; // any talk restarts that NPC's bark clock (no re-ask right after a progress line)
  giftOut(ctx, talk, n); // the gift lands when earned, not when its (maybe queued) line plays
  reg.set('talk', { t: +ctx.game.t.toFixed(3), id: talk.id, npc: who.d.id });
  if (S.cur && !S.cur.bark) return S.lines.push({ talk, n: who, owner: n });
  S.cur = { talk, n: who, owner: n, i: -1, bark };
  next(ctx);
}
// a gift: 'gift' {t, id, npc, from} (fx.js threads, hud.js hint + save, bot.js log) + its cue, at talk start (when earned; flags
// are set then too). t = when the threads fly: a second gift waits GIFT_GAP s after the first (fx.js uses the same gap); the cue
// lands a beat after so it never stacks on the strike
const GIFT_GAP = 2.8;
function giftOut(ctx, talk, n) {
  for (const f of talk.set ?? []) if (f.startsWith('gift.')) {
    const wait = Math.max(0, S.giftT + GIFT_GAP - ctx.game.t); S.giftT = ctx.game.t + wait;
    ctx.registry.set('gift', { t: S.giftT, id: f.slice(5), npc: n.d.id, from: anchor(ctx, n.d, new THREE.Vector3()).toArray() });
    ctx.registry.set('audio.cue', { name: 'gift', at: 0.35 + wait });
  }
}
function next(ctx) {
  const c = S.cur, reg = ctx.registry;
  if (++c.i >= c.talk.lines.length) {
    if (c.talk.end?.length) { const flags = reg.get('flags'); for (const f of c.talk.end) flags[f] = true; reg.set('flags', flags); }
    S.cur = S.lines.length ? { i: -1, ...S.lines.shift() } : null; // i: a talk an echo cut into resumes at its line
    return S.cur ? next(ctx) : reg.set('talk.line', null);
  }
  const line = c.talk.lines[c.i];
  c.t0 = ctx.game.t; c.dur = Math.min(c.talk.cap ?? Infinity, Math.max(c.talk.min ?? 0, lineDur(tr(line)))); // talk.min / cap: Keeper echo lines hold 6 s
  reg.set('talk.line', { npc: c.n.d.id, who: c.n.d.name ?? null, voice: c.n.d.voice ?? 'whisper', text: line, dur: c.dur, pos: c.n.d.node || c.n.d.center || c.n.d.pos ? anchor(ctx, c.n.d, new THREE.Vector3()).toArray() : null }); // pos: hero head-look, gift framing (render)
}

export default {
  name: 'npc', order: 12, deps: ['level'], // after level (flags, platform nodes), before player (a sing press skips a line)
  async init(ctx) {
    const reg = ctx.registry, data = reg.get('level')?.data;
    S = { npcs: [], byId: {}, talks: {}, played: new Set(), queue: [], lines: [], cur: null, echoes: [], giftT: -1e9 }; // queue: bark ids; lines: NPC talks waiting; echoes: Keeper lines waiting
    reg.on('echo', (e) => { const id = `echo.${e.id}`; S.talks[id] = { talk: { id, min: 6, cap: 6, lines: [e.line] }, n: KEEPER }; S.echoes.push({ id, t: ctx.game.t }); });
    reg.on('player.singStart', ({ t }) => { if (S.cur && t > S.cur.t0) next(ctx); }); // a song (E pressed) skips to the next line
    if (data?.goal) { S.goal = { d: { pos: data.goal.pos } }; lureBody(S.goal, ctx, 3); } // the goal circle's mote column, shown once it is open
    if (!data?.npcs?.length) return;
    const kinds = new Set(data.npcs.map((d) => d.kind));
    const models = {};
    await Promise.all([...kinds].filter((k) => GLB[k]).map(async (k) => (models[k] = await ctx.assets.gltf(k === 'kestrel' ? 'assets/characters/kestrel/kestrel.glb' : `assets/characters/npc/${GLB[k]}.glb`)))); // v2 kestrel: + perch clips
    if (kinds.has('kestrel')) models.rope = await ctx.assets.gltf('assets/props/rope_sag.glb');
    if (kinds.has('orren')) models.chunk = await ctx.assets.gltf('assets/props/knot_chunk.glb');
    for (const d of data.npcs) {
      const n = { d, count: 0, hit: new Set(), hitT: [], hitAt: {} }; // hitAt: switch id -> sim time struck
      S.npcs.push(n); S.byId[d.id] = n;
      for (const talk of d.talk ?? []) S.talks[talk.id] = { talk, n };
      if (d.kind === 'golem') golemBody(n, ctx, models.golem);
      else if (d.kind === 'wisp') {
        wispBody(n, ctx, models.wisp);
        const known = new Set(reg.get('echoes.known') ?? []);
        n.secrets = [...(data.echoSlots ?? []).map((e) => ({ flag: `echo.${e.id}`, pos: e.pos, pen: known.has(`${data.id}.${e.id}`) ? KNOWN_PEN : 0 })),
          ...(data.mechanisms ?? []).filter((m) => m.kind === 'breakable').map((m) => ({ flag: `broken.${m.id}`, pos: m.pos, pen: 0 })),
          ...(data.mechanisms ?? []).filter((m) => m.far).map((m) => ({ flag: `switch.${m.id}`, pos: m.pos, pen: 0 }))]; // R2: a far rune (Name song)
      }
      else if (d.kind === 'kestrel') kestrelBody(n, ctx, models.kestrel, models.rope);
      else if (d.kind === 'orren') orrenBody(n, ctx, models.orren, models.chunk);
      if (d.lure) lureBody(n, ctx);
      const first = d.lure && (data.mechanisms ?? []).find((m) => m.id === d.switches?.[0]); // the same column, thinner, on the NPC's first stone (l1: name1 stands an island before Kamen, who stays silent until met): on until it is sung
      if (first) { S.call = { d: { pos: first.pos }, flag: `switch.${first.id}` }; lureBody(S.call, ctx, 0.6); }
    }
    reg.on('trigger', ({ id }) => { const tg = data.triggers?.find((x) => x.id === id); if (tg?.talk && S.talks[tg.talk]) S.queue.push(tg.talk); });
  },
  update(ctx) {
    const reg = ctx.registry, flags = reg.get('flags'), t = ctx.game.t;
    if (!flags) return;
    const player = reg.get('player');
    for (const n of S.npcs) { // proximity bark (sim: data positions only)
      const at = n.d.center ?? n.d.pos;
      const b = n.d.bark; // b.until: re-asked every b.every s while near and the flag is unset (its talk once: false)
      if (!b || !player || !at || Math.hypot(at[0] - player.pos.x, at[2] - player.pos.z) > b.r) continue;
      if (b.until ? flags[b.until] || t < (n.barkT ?? -1e9) + (b.every ?? 20) || S.queue.includes(b.talk) || S.cur?.talk.id === b.talk : n.barked) continue;
      n.barked = true; n.barkT = t; S.queue.push(b.talk);
    }
    for (const n of S.npcs) for (const sw of n.d.switches ?? []) {
      if (!flags[`switch.${sw}`] || n.hit.has(sw)) continue;
      n.hit.add(sw); n.hitT.push(t); n.hitAt[sw] = t;
      flags[`npc.${n.d.id}.${++n.count}`] = true;
      reg.set('flags', flags);
      if (n.d.kind === 'golem' && n.count === n.d.switches.length) reg.set('npc.standup', { t, pos: (n.g?.getWorldPosition(new THREE.Vector3()).toArray() ?? n.d.pos) }); // fx.js: dust as it heaves up
    }
    for (const n of S.npcs) { // Sigh: a secret found while it is free -> its `found` bark (sim: flags only)
      if (!n.secrets || !n.d.found || !flags[n.d.show]) continue;
      const got = n.secrets.filter((x) => flags[x.flag]).length;
      if (n.got !== undefined && got > n.got && !S.queue.includes(n.d.found)) S.queue.push(n.d.found);
      n.got = got;
    }
    for (const n of S.npcs) for (const talk of n.d.talk ?? []) {
      if (!talk.on || S.played.has(talk.id) || !flags[talk.on] || (talk.if && !flags[talk.if])) continue;
      const at = n.d.center ?? n.d.pos;
      if (talk.r && player && at && Math.hypot(at[0] - player.pos.x, at[2] - player.pos.z) > talk.r) continue; // talk.r: an earned line waits until the hero is within r m (Kamen answered name1 from 23 m off, behind the wall)
      start(ctx, n, talk);
    }
    S.echoes = S.echoes.filter((e) => t - e.t <= ECHO_TTL); // a Keeper echo cuts in at once (the cut line replays after it); stale ones are dropped
    if (S.echoes.length && !S.cur?.echo) {
      if (S.cur) S.lines.unshift({ ...S.cur, i: S.cur.i - (t - S.cur.t0 < S.cur.dur / 2 ? 1 : 0) }); // a line cut in its first half is said again after the echo; one mostly heard is not doubled
      S.cur = null; start(ctx, KEEPER, S.talks[S.echoes.shift().id].talk); S.cur.echo = true;
    }
    while (!S.cur && S.queue.length) {
      const { talk, n } = S.talks[S.queue.shift()];
      if (!S.played.has(talk.id) && (!talk.if || flags[talk.if]) && !flags[talk.until]) start(ctx, n, talk, true); // talk.until: a queued bark that came too late is dropped (Kamen's call after he woke)
    }
    if (S.cur && t >= S.cur.t0 + S.cur.dur) next(ctx);
  },
  beforeRender(ctx) {
    const t = ctx.game.t, flags = ctx.registry.get('flags') ?? {}, player = ctx.registry.get('player');
    for (const G of [S.goal, S.call]) if (G) { // same column as an NPC lure, on the goal circle (on while open, gone once reached) and on an NPC's first stone (until sung)
      const L = G.lure, after = ctx.registry.get('level')?.data?.goal?.after, on = G.flag ? !flags[G.flag] : (!after || flags[after]) && !ctx.registry.get('end');
      G.k = Math.min(1, Math.max(0, (G.k ?? 0) + (on ? 0.01 : -0.03)));
      L.g.visible = G.k > 0;
      if (L.g.visible) {
        L.g.position.fromArray(G.d.pos);
        L.beam.material.opacity = G.k * (0.32 + 0.06 * Math.sin(t * 1.7));
        for (const m of L.motes) { const u = (m.userData.k + t * 0.06) % 1, a = m.userData.k * 37 + t * 0.4; m.position.set(L.r * Math.sin(a), 0.3 + u * (L.H - 1), L.r * Math.cos(a)); m.material.opacity = G.k * 0.9 * Math.sin(Math.PI * u); }
      }
    }
    for (const n of S.npcs) {
      const d = n.d;
      if (n.lure) {
        const L = n.lure, fade = n.count ? Math.max(0, 1 - (t - n.hitT[0]) / 1.2) : 1;
        L.g.visible = fade > 0;
        if (L.g.visible) {
          anchor(ctx, d, L.g.position);
          L.beam.material.opacity = fade * (0.22 + 0.05 * Math.sin(t * 1.7));
          for (const m of L.motes) { // rising, looping, swirling
            const u = (m.userData.k + t * 0.12) % 1, a = m.userData.k * 37 + t * 0.8;
            m.position.set(0.35 * Math.sin(a), 0.4 + u * 7, 0.35 * Math.cos(a));
            m.material.opacity = fade * 0.9 * Math.sin(Math.PI * u);
          }
        }
      }
      if (d.kind === 'golem' && n.g) {
        const awake = flags[`npc.${d.id}.awake`], since = n.count ? t - n.hitT[0] : -1;
        const wp = n.g.parent.getWorldPosition(_v); // walking while the platform node moves (render-side speed, smoothed)
        if (n.last && t > n.lastT) {
          const mx = wp.x - n.last.x, mz = wp.z - n.last.z, dt = t - n.lastT, sp = Math.hypot(mx, mz) / dt;
          n.speed += (sp - n.speed) * 0.2;
          if (sp > 0.05) { const dy = Math.atan2(mx, mz) - n.g.parent.rotation.y - n.g.rotation.y, turn = Math.atan2(Math.sin(dy), Math.cos(dy)); n.g.rotation.y += Math.sign(turn) * Math.min(Math.abs(turn), 6 * dt); } // U22: the body faces the way it walks (6 rad/s)
          // ponytail: standing he keeps his last facing (the back is the collider, a long box: turning to the hero would slide it off the stone); only 0 / pi fit, which is all a straight path asks
        }
        (n.last ??= new THREE.Vector3()).copy(wp); n.lastT = t;
        const all = n.count > 0 && n.count >= n.glyphs.length, up = all ? t - n.hitT[n.count - 1] : -1; // up: s since the last name
        if (!all) { // asleep; each name struck: a twitch (0.1 s in, 0.15 s out)
          const tw = n.count ? t - n.hitT[n.count - 1] : -1, w = tw >= 0 && tw < 0.58 ? clamp01(Math.min(tw / 0.1, (0.58 - tw) / 0.15)) : 0;
          pose(n, { sleep: [1 - w, t % 4], twitch: [w, Math.max(0, tw)] });
        } else if (up < 2) pose(n, { standup: [1, up] }); // ends on walk frame 0
        else { const walk = clamp01(n.speed / 0.3); pose(n, { idle_awake: [1 - walk, (up - 2) % 3], walk: [walk, t % 1] }); }
        // the gift shown once (render only): on his feet, Kamen dashes a stride ahead and settles back, dust and streaks as the hero's dash
        const dk = (up - 2.3) / 0.9, lunge = dk > 0 && dk < 1 && !(player && Math.hypot(player.pos.x - wp.x, player.pos.z - wp.z) < 1.8 && !n.dashed) ? (dk < 0.15 ? ease(dk / 0.15) : 1 - ease((dk - 0.15) / 0.85)) : 0;
        n.g.position.z = 1.3 * lunge;
        if (lunge > 0 && !n.dashed) { n.dashed = true; const dir = _u.set(0, 0, 1).transformDirection(n.g.parent.matrixWorld); ctx.registry.set('npc.dash', { t, pos: [wp.x, wp.y - KAMEN_BACK, wp.z], dir: [dir.x, dir.z], air: true }); }
        if (n.runeM) n.runeM.color.copy(DIM).lerp(GOLD, awake ? 1 : 0.45 + 0.4 * Math.sin(t * 2.5));
        for (const gl of n.glyphs) { // dim, faintly breathing until struck; then a cream flash easing into gold
          const at = n.hitAt[gl.sw], k = at === undefined ? 0 : ease(clamp01((t - at) / 0.5));
          for (const m of gl.mats) m.color.copy(DIM).lerp(GOLD, at === undefined ? 0.12 + 0.1 * Math.sin(t * 2) : k).lerp(CREAM, at === undefined ? 0 : 0.6 * (1 - k) * k * 4);
        }
        if (n.eyeM) n.eyeM.color.copy(DIM).lerp(GOLD, since < 0 ? 0 : ease(clamp01(since / 1.5)));
      } else if (d.kind === 'wisp' && n.g) {
        const show = flags[d.show];
        n.g.visible = !!show; n.trail.forEach((s) => (s.visible = !!show));
        if (!show || !player) continue;
        const dt = n.lastT === null ? 0 : Math.max(0, t - n.lastT); n.lastT = t;
        if (n.lead && flags[n.lead.flag]) { n.joy = { pos: n.lead.pos, t }; n.lead = null; } // found: spiral up over it
        if (n.joy && t - n.joy.t > SPIRAL) n.joy = null;
        const P = player.pos, score = (x) => Math.hypot(x.pos[0] - P.x, x.pos[1] - P.y, x.pos[2] - P.z) + x.pen;
        if (!n.joy && (!n.lead || score(n.lead) > SEEK + 10)) { // keep a lead until found or left behind
          n.lead = null;
          for (const x of n.secrets ?? []) if (!flags[x.flag] && score(x) < SEEK && (!n.lead || score(x) < score(n.lead))) n.lead = x;
        }
        const h = n.joy ?? n.lead, want = new THREE.Vector3();
        if (n.joy) { const u = (t - n.joy.t) / SPIRAL, a = u * 14; want.set(n.joy.pos[0] + Math.cos(a) * (1.4 - u), n.joy.pos[1] + 1.2 + 2.5 * u, n.joy.pos[2] + Math.sin(a) * (1.4 - u)); }
        else if (h && Math.hypot(h.pos[0] - P.x, h.pos[1] - P.y, h.pos[2] - P.z) > NEAR + 5) want.set(h.pos[0], h.pos[1] + 1.5, h.pos[2]).sub(P).setLength(BECKON).add(P).y += 2.2 + 0.3 * Math.sin(t * 2.3);
        else if (h) want.set(h.pos[0] + Math.cos(t * 1.6) * 1.3, h.pos[1] + 1.5 + 0.3 * Math.sin(t * 2.3), h.pos[2] + Math.sin(t * 1.6) * 1.3);
        else want.set(Math.sin(player.heading + 2.3) * 1.1, 1.9 + 0.2 * Math.sin(t * 1.7), Math.cos(player.heading + 2.3) * 1.1).add(P);
        n.at ??= new THREE.Vector3().fromArray(d.pos);
        n.at.lerp(want, 1 - Math.exp(-(n.joy ? 8 : h ? 1.6 : 3) * dt));
        if (n.lead && n.at.distanceTo(want) < 2.5) { // circling it: a soft chime while the hero is near or looks its way
          const near = Math.hypot(h.pos[0] - P.x, h.pos[1] - P.y, h.pos[2] - P.z) < NEAR, cam = ctx.camera;
          const look = cam && _w.subVectors(n.at, cam.position).normalize().dot(cam.getWorldDirection(_u)) > 0.97;
          if ((near || look) && t - (n.chimeT ?? -1e9) > CHIME_GAP) { n.chimeT = t; ctx.registry.set('audio.cue', { name: 'chime', gain: 0.35 }); }
        }
        const prev = _v.copy(n.g.position);
        n.g.position.copy(n.at).add(new THREE.Vector3(0.12 * Math.sin(t * 3.1), 0.08 * Math.sin(t * 4.3), 0.12 * Math.cos(t * 2.7)));
        if (prev.distanceToSquared(n.g.position) > 1e-6) n.g.lookAt(prev.sub(n.g.position).negate().add(n.g.position)); // +Z along the motion
        pose(n, { float: [1, t % 2] });
        n.hist.unshift(n.g.position.clone()); n.hist.length = Math.min(n.hist.length, 13);
        n.trail.forEach((s, i) => s.position.copy(n.hist[Math.min(n.hist.length - 1, 2 * i + 2)]));
      } else if (d.kind === 'kestrel' && n.g) {
        const freeT = flags[d.free] ? n.ft ??= t : null, u = freeT === null ? 0 : t - freeT, base = n.base, yaw = d.rotY ?? 0;
        if (freeT === null) { // perched on the ground while the hero is away; hero near (or a rope cut): takes off and strains at its ropes; each cut: a jolt away from that stake
          const up = !n.acts.perch || Object.keys(n.hitAt).length > 0 || (player && player.pos.distanceTo(base) < KESTREL_WAKE), k = t - (n.pk?.up === up ? n.pk.t0 : (n.pk = { up, t0: n.pk ? t : -9 }).t0);
          const tr = up ? 'perch_takeoff' : 'perch_land', loop = up ? 'strain' : 'perch';
          pose(n, n.acts[tr] && k < n.acts[tr].getClip().duration ? { [tr]: [1, k] } : { [loop]: [1, t % n.acts[loop].getClip().duration] });
          n.g.position.copy(base); n.g.rotation.set(0, yaw, 0);
          for (const r of n.ropes) {
            const j = t - (n.hitAt[r.sw] ?? -9);
            if (j < 0 || j > 0.5) continue;
            const k = Math.sin(Math.PI * j / 0.5) * (1 - j / 0.5);
            n.g.position.addScaledVector(_w.subVectors(base, r.r.position).setY(0).normalize(), 0.5 * k).y += 0.25 * k;
            n.g.rotation.z += 0.5 * k;
          }
        } else if (u < 3) { // flyoff: the body bone carries it ~9 m forward and 5 m up
          pose(n, { flyoff: [1, u] });
          n.g.position.copy(base); n.g.rotation.set(0, yaw, 0);
        } else { // circle (no root motion) round the updraft, from where flyoff left it; after ~2 circles it flies off to the Crown
          const w = u - 3 - KESTREL_LEAVE, v = Math.min(u - 3, KESTREL_LEAVE), rise = d.rise ?? base.toArray(), e = _w.set(9 * Math.sin(yaw), 5, 9 * Math.cos(yaw)).add(base);
          const a0 = Math.atan2(e.x - rise[0], e.z - rise[2]), R0 = Math.hypot(e.x - rise[0], e.z - rise[2]);
          const dir = Math.sign(Math.cos(a0) * Math.sin(yaw) - Math.sin(a0) * Math.cos(yaw)) || 1; // keep flying the way flyoff faced
          // the gift shown once (render only): two pushes off the air as it starts to circle, each a dart ahead and up with the airdash's streaks
          const push = ease(clamp01((v - 0.5) / 0.2)) + ease(clamp01((v - 1.3) / 0.2));
          const a = a0 + dir * (0.5 * v + 0.14 * push), R = THREE.MathUtils.lerp(R0, 4, ease(clamp01(v / 4))), y = e.y + 1.5 * ease(clamp01(v / 6)) + 0.9 * push + 0.3 * Math.sin(v * 0.9);
          for (const [i, at] of [0.5, 1.3].entries()) if (v >= at && v < at + 0.5 && (n.pushed ?? 0) <= i) { n.pushed = i + 1; ctx.registry.set('npc.dash', { t, pos: [rise[0] + R * Math.sin(a), y - 0.8, rise[2] + R * Math.cos(a)], dir: [dir * Math.cos(a), -dir * Math.sin(a)], air: true }); }
          pose(n, { circle: [1, v % n.acts.circle.getClip().duration] });
          n.g.position.set(rise[0] + R * Math.sin(a), y, rise[2] + R * Math.cos(a));
          const head = a + dir * Math.PI / 2, dy = Math.atan2(Math.sin(head - yaw), Math.cos(head - yaw)); // nose along the path (eased in)
          n.g.rotation.set(0, yaw + dy * ease(clamp01(v / 1.2)), -0.35 * dir * ease(clamp01(v / 1.2)));
          if (w > 0) { // leaving: banks toward the Crown spire, climbs, shrinks into the distance, then gone
            n.crown ??= ctx.scene.getObjectByName('landmark')?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3(rise[0], 0, rise[2] + 500);
            const to = Math.atan2(n.crown.x - n.g.position.x, n.crown.z - n.g.position.z), k = ease(clamp01(w / 1.5)), turn = Math.atan2(Math.sin(to - n.g.rotation.y), Math.cos(to - n.g.rotation.y));
            n.g.rotation.y += turn * k; n.g.rotation.z *= 1 - k;
            const d = 3 * w + 0.9 * w * w;
            n.g.position.x += Math.sin(n.g.rotation.y) * d; n.g.position.z += Math.cos(n.g.rotation.y) * d; n.g.position.y += 1.2 * w;
            n.g.scale.setScalar(1 - 0.6 * clamp01(w / 8));
            n.g.visible = w < 8;
          }
        }
        n.g.updateMatrixWorld(true);
        n.ropes.forEach((r, ci) => { // tie -> tether empty; cut (its stake struck, or the bird freed): snaps back to the stake with a flash
          const cutT = n.hitAt[r.sw] ?? freeT, c = cutT == null ? -1 : t - cutT;
          r.r.visible = c < 0.3;
          if (r.r.visible) {
            const tie = n.ends[ci % 2]?.getWorldPosition(_v) ?? n.g.position;
            r.r.lookAt(tie); r.r.scale.set(1, 1, Math.max(0.01, r.r.position.distanceTo(tie) * (c < 0 ? 1 : 1 - ease(c / 0.3))));
          }
          r.snap.visible = c >= 0 && c < 0.5;
          if (r.snap.visible) { r.snap.material.opacity = 1 - c / 0.5; r.snap.scale.setScalar(0.6 + 1.6 * c); }
          if (r.runeM) r.runeM.color.copy(DIM).lerp(GOLD, c < 0 ? 0.75 + 0.25 * Math.sin(t * 2.5) : 1 - clamp01(c / 0.6));
        });
      } else if (d.kind === 'orren' && n.rings) {
        const fin = ctx.registry.get('cut.world')?.fin, fired = (d.switches ?? []).filter((sw) => flags[`switch.${sw}`]).length; // cutscene-fired runes (sim paused: no hitT)
        const free = flags[`npc.${d.id}.free`], lift = Math.max(n.count, fired), fx = free ? n.fx ??= t : null; // fx: exhale start (render capture)
        pose(n, fx !== null ? { exhale: [1, Math.min(t - fx, 2.999)] } // lift<k> per rune (cumulative, holds its end), exhale after the farewell
          : lift ? { [`lift${lift}`]: [1, Math.min(n.hitT[lift - 1] !== undefined ? t - n.hitT[lift - 1] : 1, 0.999)] } : { lift1: [1, 0] });
        let live = 0;
        n.rings.forEach((rg, k) => {
          const u = n.hitT[k] !== undefined ? clamp01((t - n.hitT[k]) / 1.8) : k < fired ? (fin === undefined ? 1 : clamp01((fin + 1) / 1.8)) : 0;
          const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
          if (u >= 1) { for (let i = 0; i < rg.N; i++) n.ims[rg.vi[i]].setMatrixAt(rg.at[i], m.makeScale(0, 0, 0)); return; }
          live++;
          for (let i = 0; i < rg.N; i++) {
            const a = (i / rg.N) * Math.PI * 2 + t * rg.w * (1 - u) + Math.sin(i * 2.1) * 0.12;
            p.set(Math.cos(a) * rg.r * (1 + 1.4 * u), 0.12 * Math.sin(i * 1.3 + t), Math.sin(a) * rg.r * (1 + 1.4 * u)).applyQuaternion(rg.tilt).add(n.c);
            p.y -= 5 * u * u;
            q.setFromEuler(new THREE.Euler(t * 0.7 + i, t * 0.5 + i * 2, 0));
            m.compose(p, q, s.setScalar(rg.sz[i] * (1 - u)));
            n.ims[rg.vi[i]].setMatrixAt(rg.at[i], m);
          }
        });
        for (const im of n.ims) { im.visible = live > 0; im.instanceMatrix.needsUpdate = true; }
        n.core.material.opacity = 0.3 + 0.2 * n.count + (free ? 0.2 : 0) + 0.08 * Math.sin(t * 2);
        n.core.scale.setScalar(1.2 + 0.5 * n.count + (free ? 1 : 0));
        for (const r of n.runes) { // pulse until struck, a white-gold flash, then steady gold
          const at = n.hitAt[r.sw];
          if (at === undefined) r.mat.color.copy(DIM).lerp(GOLD, 0.6 + 0.3 * Math.sin(t * 2.5 + r.sw.length));
          else r.mat.color.copy(GOLD).lerp(CREAM, Math.max(0, 1 - (t - at) / 0.6));
        }
      }
    }
  },
};
