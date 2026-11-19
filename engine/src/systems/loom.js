// R10 Keeper's Loom: a cosmetic-only gacha (no money, no gameplay effect; the bot never looks at it).
// Pool: 12 cloak patterns (one shader uniform set on the hero_cloak material: stripes / chevrons / stars / waves x palette),
// 6 staff tips (the top of the staff, R_Prop-skinned vertices of hero_body, tinted + glowing; same material, no new draw call),
// 6 dash trail colours (fx.js afterimages), a babble voice skin (audio.js reads VOICE), a title backdrop tint.
// Odds: common 70 %, rare 25 %, legendary 5 % per pull; pity: the 15th pull without a legendary is one.
// Duplicates become thread dust; DUST_COST dust buys a chosen common. RNG: its own mulberry32 stream per pull from the save's
// loom seed + pull count; never ctx.rng / Math.random in the sim.
// The 'loom' system (after player + cloth) applies the equipped set ('cosmetic.equip' {pattern, tip, trail, voice, backdrop} in the registry,
// meta.js publishes it from sw.meta.v1 on every level start) through uniforms only: draw calls are unchanged.
import * as THREE from 'three';
import { mulberry32 } from '../core/rng.js';

export const ODDS = { common: 0.7, rare: 0.25, legendary: 0.05 }, PITY = 15, DUST_COST = 5;
export const PAL = { // [cloak tint, pattern colour]
  dawn: ['#e9b85a', '#fbf0d6'], moss: ['#7d9a5b', '#e6edcf'], river: ['#5b86a8', '#e3eef4'], clay: ['#b07a52', '#f6e2c8'], snow: ['#dfe6ea', '#7d93a6'],
  ash: ['#8a8478', '#efe9dc'], ember: ['#c4553a', '#f6cd8c'], dusk: ['#6b5a8e', '#efd6ef'], night: ['#2f3a5a', '#f3dd8a'], sun: ['#e0a03a', '#7a3b1e'],
};
const PAT = { stripes: 1, chevrons: 2, stars: 3, waves: 4 };
const it = (id, slot, rarity, en, ru, extra) => ({ id, slot, rarity, name: { en, ru }, ...extra });
export const POOL = [
  it('p_dawn_stripes', 'pattern', 'common', 'Dawn stripes', 'Рассветные полосы', { pat: 'stripes', pal: 'dawn' }),
  it('p_moss_waves', 'pattern', 'common', 'Moss waves', 'Моховые волны', { pat: 'waves', pal: 'moss' }),
  it('p_river_stripes', 'pattern', 'common', 'River stripes', 'Речные полосы', { pat: 'stripes', pal: 'river' }),
  it('p_clay_chevrons', 'pattern', 'common', 'Clay chevrons', 'Глиняные шевроны', { pat: 'chevrons', pal: 'clay' }),
  it('p_snow_waves', 'pattern', 'common', 'Snow waves', 'Снежные волны', { pat: 'waves', pal: 'snow' }),
  it('p_ash_chevrons', 'pattern', 'common', 'Ash chevrons', 'Пепельные шевроны', { pat: 'chevrons', pal: 'ash' }),
  it('p_ember_chevrons', 'pattern', 'rare', 'Ember chevrons', 'Угольные шевроны', { pat: 'chevrons', pal: 'ember' }),
  it('p_river_stars', 'pattern', 'rare', 'River stars', 'Речные звёзды', { pat: 'stars', pal: 'river' }),
  it('p_dusk_waves', 'pattern', 'rare', 'Dusk waves', 'Сумеречные волны', { pat: 'waves', pal: 'dusk' }),
  it('p_moss_stars', 'pattern', 'rare', 'Moss stars', 'Моховые звёзды', { pat: 'stars', pal: 'moss' }),
  it('p_night_stars', 'pattern', 'legendary', 'Keeper\'s night', 'Ночь Хранителей', { pat: 'stars', pal: 'night' }),
  it('p_sun_stripes', 'pattern', 'legendary', 'Sunthread', 'Солнечная нить', { pat: 'stripes', pal: 'sun' }),
  it('t_flint', 'tip', 'common', 'Flint tip', 'Кремнёвое навершие', { col: '#8f8a80', glow: 0 }),
  it('t_moss', 'tip', 'common', 'Moss tip', 'Моховое навершие', { col: '#6f8f4e', glow: 0.15 }),
  it('t_bone', 'tip', 'common', 'Bone tip', 'Костяное навершие', { col: '#efe6d2', glow: 0.1 }),
  it('t_river', 'tip', 'rare', 'River glass', 'Речное стекло', { col: '#6fb3d8', glow: 0.45 }),
  it('t_ember', 'tip', 'rare', 'Ember coal', 'Тлеющий уголь', { col: '#e0663a', glow: 0.55 }),
  it('t_star', 'tip', 'legendary', 'Fallen star', 'Упавшая звезда', { col: '#ffd27a', glow: 1 }),
  it('r_sand', 'trail', 'common', 'Sand trail', 'Песчаный след', { col: '#e6cfa3' }),
  it('r_sage', 'trail', 'common', 'Sage trail', 'Шалфейный след', { col: '#b9cf9f' }),
  it('r_sky', 'trail', 'common', 'Sky trail', 'Небесный след', { col: '#b8d6ea' }),
  it('r_rose', 'trail', 'rare', 'Rose trail', 'Розовый след', { col: '#f0b4b0' }),
  it('r_dusk', 'trail', 'rare', 'Dusk trail', 'Сумеречный след', { col: '#bba6e0' }),
  it('r_gold', 'trail', 'legendary', 'Gold thread', 'Золотая нить', { col: '#ffcf6a' }),
  it('v_lark', 'voice', 'rare', 'Lark voices', 'Голоса жаворонков', { f0: 1.35, fmt: 1.12 }),
  it('b_dusk', 'backdrop', 'legendary', 'Dusk over the Crown', 'Сумерки над Короной', { sky: '#e8cfc4', fog: '#e6c9bd' }),
];
export const byId = (id) => POOL.find((i) => i.id === id);
export const SLOTS = ['pattern', 'tip', 'trail', 'voice', 'backdrop'];
export const VOICE = { f0: 1, fmt: 1 }; // audio.js babble multiplies its preset by these (the equipped voice skin)

export function newLoom(seed) { return { seed: seed >>> 0, n: 0, pity: 0, dust: 0 }; }
// One pull: mutates L ({seed, n, pity, dust}) and owned ({id: count}). Returns {item, rarity, dupe, pity}.
export function pull(L, owned) {
  const r = mulberry32((L.seed ^ Math.imul(L.n + 1, 0x9e3779b1)) >>> 0); // own stream per pull: replayable from the save alone
  L.n++;
  const roll = r(), forced = L.pity >= PITY - 1;
  const rarity = forced || roll < ODDS.legendary ? 'legendary' : roll < ODDS.legendary + ODDS.rare ? 'rare' : 'common';
  L.pity = rarity === 'legendary' ? 0 : L.pity + 1;
  const items = POOL.filter((i) => i.rarity === rarity), item = items[Math.floor(r() * items.length)];
  const dupe = !!owned[item.id];
  owned[item.id] = (owned[item.id] ?? 0) + 1;
  if (dupe) L.dust++;
  return { item, rarity, dupe, pity: forced && roll >= ODDS.legendary };
}

// ---- applying the equipped set to the live hero (render only) ----
const U = { pat: { value: 0 }, a: { value: new THREE.Color() }, b: { value: new THREE.Color() }, tip: { value: new THREE.Color() }, tipOn: { value: 0 }, glow: { value: 0 }, t: { value: 0 } };
let ghosts, eq, scene, sky0, fog0, orbit;

function patchCloak(mesh) { // pattern under the breath threads (diffuse, before lighting); bind-space coords: height 0..1, angle round the body
  const m = mesh.material, g = mesh.geometry, prev = m.onBeforeCompile;
  g.computeBoundingBox();
  const bb = g.boundingBox, f = (v) => v.toFixed(4), cx = (bb.min.x + bb.max.x) / 2, cz = (bb.min.z + bb.max.z) / 2;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, { lmPat: U.pat, lmA: U.a, lmB: U.b });
    sh.vertexShader = 'varying vec3 vLm;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vLm = vec3(atan(position.x - ${f(cx)}, position.z - ${f(cz)}) / 6.2832 + 0.5, (position.y - ${f(bb.min.y)}) / ${f(bb.max.y - bb.min.y)}, 0.0);`);
    sh.fragmentShader = 'varying vec3 vLm;\nuniform float lmPat;\nuniform vec3 lmA, lmB;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  if (lmPat > 0.5) {
    float lmL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
    diffuseColor.rgb = mix(diffuseColor.rgb, lmA * (0.55 + 0.9 * lmL), 0.7); // dyed cloth keeps the weave's shading
    float u = vLm.x * 24.0, v = vLm.y * 24.0, k = 0.0, aa = 0.0;
    if (lmPat < 1.5) k = abs(fract(v * 0.5) - 0.5) * 4.0 - 1.4; // stripes round the hem
    else if (lmPat < 2.5) k = abs(fract(v * 0.5 + abs(fract(u * 0.25) - 0.5)) - 0.5) * 4.0 - 1.4; // chevrons
    else if (lmPat < 3.5) { vec2 c = fract(vec2(u * 0.5 + floor(v * 0.5) * 0.5, v * 0.5)) - 0.5; vec2 q = abs(c); k = 0.28 - (q.x + q.y + 1.6 * min(q.x, q.y)); k *= 6.0; } // four-point stars
    else k = abs(fract(v * 0.5 + 0.18 * sin(u * 1.2)) - 0.5) * 4.0 - 1.4; // waves
    aa = fwidth(k) + 1e-4;
    diffuseColor.rgb = mix(diffuseColor.rgb, lmB * (0.75 + 0.35 * lmL), smoothstep(-aa, aa, k) * 0.85);
  }`);
  };
  m.userData.cacheKey = `${m.userData.cacheKey ?? ''}-loom`;
  m.customProgramCacheKey = () => `loom${m.userData.cacheKey}`; // look.js replaces this with its own key (it keeps userData.cacheKey)
  m.needsUpdate = true;
}

function patchStaff(body) { // the staff lives in hero_body (100 % on the R_Prop bone): its top TIP of the length takes the tip colour (+ a pulse glow)
  const bone = body.skeleton?.bones.findIndex((b) => /R_Prop/i.test(b.name)) ?? -1, g = body.geometry, P = g.attributes.position, I = g.attributes.skinIndex, W = g.attributes.skinWeight;
  if (bone < 0 || !I || !W) return;
  const bb = new THREE.Box3(), v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) for (let c = 0; c < 4; c++) if (I.getComponent(i, c) === bone && W.getComponent(i, c) > 0.5) bb.expandByPoint(v.fromBufferAttribute(P, i));
  if (bb.isEmpty()) return;
  const size = bb.getSize(v), ax = size.x > size.y ? (size.x > size.z ? 'x' : 'z') : size.y > size.z ? 'y' : 'z';
  const lo = bb.min[ax], len = size[ax], f = (x) => x.toFixed(4), m = body.material, prev = m.onBeforeCompile; // bind pose: the staff stands tip up (+axis)
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    Object.assign(sh.uniforms, { lmTip: U.tip, lmTipOn: U.tipOn, lmGlow: U.glow, lmT: U.t });
    sh.vertexShader = 'varying float vLmS;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
  vLmS = dot(skinWeight, vec4(equal(skinIndex, vec4(${bone}.0)))) > 0.5 ? (position.${ax} - ${f(lo)}) / ${f(len)} : -1.0;`);
    sh.fragmentShader = 'varying float vLmS;\nuniform vec3 lmTip;\nuniform float lmTipOn, lmGlow, lmT;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  float lmK = smoothstep(0.84, 0.87, vLmS) * lmTipOn;
  diffuseColor.rgb = mix(diffuseColor.rgb, lmTip * (0.75 + 0.45 * dot(diffuseColor.rgb, vec3(0.333))), lmK);`).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  totalEmissiveRadiance += lmTip * lmGlow * lmK * (0.5 + 0.25 * sin(lmT * 2.4));`);
  };
  m.userData.cacheKey = `${m.userData.cacheKey ?? ''}-loomtip`;
  m.customProgramCacheKey = () => `loom${m.userData.cacheKey}`;
  m.needsUpdate = true;
}

function apply(e) {
  eq = e ?? {};
  const p = byId(eq.pattern), t = byId(eq.tip), v = byId(eq.voice);
  U.pat.value = p ? PAT[p.pat] : 0;
  if (p) { U.a.value.set(PAL[p.pal][0]); U.b.value.set(PAL[p.pal][1]); }
  U.tipOn.value = t ? 1 : 0; U.glow.value = t?.glow ?? 0;
  if (t) U.tip.value.set(t.col);
  VOICE.f0 = v?.f0 ?? 1; VOICE.fmt = v?.fmt ?? 1;
  ghosts = null; // re-tint the dash afterimages on the next frame
}

export default {
  name: 'loom', order: 26, deps: ['player'], // after player (the hero model), before look (order 50, chains our shader patch)
  init(ctx) {
    scene = ctx.scene; sky0 = scene.background?.clone?.(); fog0 = scene.fog?.color.clone(); orbit = false; ghosts = null;
    const model = ctx.registry.get('player.model'), cloak = model?.getObjectByName('hero_cloak'), body = model?.getObjectByName('hero_body');
    if (cloak?.material) patchCloak(cloak);
    if (body?.isSkinnedMesh) patchStaff(body);
    apply(ctx.registry.get('cosmetic.equip'));
    ctx.registry.on('cosmetic.equip', apply);
    ctx.registry.on('menu.orbit', (on) => { orbit = !!on; });
  },
  beforeRender(ctx) {
    U.t.value = ctx.game.t;
    if (!ghosts) { // fx.js afterimages ('fx__ghost', one material each)
      ghosts = [];
      ctx.scene.traverse((o) => { if (o.name === 'fx__ghost') o.traverse((q) => { if (q.isMesh && !ghosts.includes(q.material)) ghosts.push(q.material); }); });
      const c = byId(eq.trail)?.col ?? '#fff3d0'; // fx.js CREAM
      for (const m of ghosts) m.color.set(c);
    }
    const b = byId(eq.backdrop); // title only; nothing equipped = never touched (the endings may own the backdrop)
    if (!b) return;
    const on = orbit || !!ctx.registry.get('menu.orbit');
    if (sky0?.isColor && scene.background?.isColor) scene.background.set(on ? b.sky : sky0);
    if (fog0 && scene.fog) scene.fog.color.set(on ? b.fog : fog0);
  },
  dispose(ctx) { if (!byId(eq?.backdrop)) return; if (sky0?.isColor && ctx.scene.background?.isColor) ctx.scene.background.copy(sky0); if (fog0) ctx.scene.fog?.color.copy(fog0); },
};
