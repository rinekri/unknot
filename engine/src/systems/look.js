// NPR look: patches every MeshStandardMaterial at '#include <opaque_fragment>' to a banded tone ramp + object-anchored noise.
// Per material name: 'rock'/'stone' get Rock030 luminance as triplanar world detail that bends the ramp bands (painted
// strata, not a photo); 'grass'/'scatter' get world-anchored ochre patches; everything gets a warm backlit rim.
// Edge lines, grade and dither live in core/post.js (tune EDGES there).
import * as THREE from 'three';

const BANDS = 3, NOISE = 0.03, KEEP = 0.3, BLOTCH = 0.16; // band count, noise amplitude, share of smooth lighting kept, watercolor blotch depth
const DETAIL = { tex: 'assets/textures/Rock030/Rock030_detail.jpg', mean: 71 / 255, scale: 0.2, band: 0.45, tone: 0.35 }; // mean = measured average luminance
const OCHRE = 0.8, RIM = { color: '#f7d79c', k: 0.42 }; // ochre patch strength; warm rim (B6)
const detail = { value: null }, rimColor = { value: new THREE.Color(RIM.color) };
let detailLoad; // shared across levels
// Palette ramp (npr-look.md layer 1): 4-10 STYLE.md hexes, dark -> light. Each stop is the light color of one band,
// multiplied by the albedo. null = BANDS luminance bands with no palette.
const RAMP = ['#645d4f', '#d5c3a9', '#e9d2b4', '#f9f3ec']; // STYLE.md: stone shadow, stone light, dawn haze, paper

const ramp = RAMP && { value: RAMP.map((c) => new THREE.Color(c)) };
const rampGlsl = RAMP ? `
  float lookShade = clamp(lookLum / max(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114)), 1e-3) + lookN * ${NOISE.toFixed(3)} + (lookDet - 1.0) * ${DETAIL.band}, 0.0, 0.999);
  outgoingLight = mix(diffuseColor.rgb * lookRamp[int(lookShade * ${RAMP.length}.0)], outgoingLight, ${KEEP.toFixed(2)});` : `
  float lookBand = (floor(clamp(lookLum + lookN * ${NOISE.toFixed(3)} + (lookDet - 1.0) * ${DETAIL.band}, 0.0, 0.999) * ${BANDS.toFixed(1)}) + 0.5) / ${BANDS.toFixed(1)};
  outgoingLight *= mix(lookBand, lookLum, ${KEEP.toFixed(2)}) / max(lookLum, 1e-3);`;

const VN = `float lookH(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 45.164))) * 43758.5453); }
float lookVn(vec3 p) { // value noise, -1..1
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(lookH(i), lookH(i + vec3(1, 0, 0)), f.x), mix(lookH(i + vec3(0, 1, 0)), lookH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(lookH(i + vec3(0, 0, 1)), lookH(i + vec3(1, 0, 1)), f.x), mix(lookH(i + vec3(0, 1, 1)), lookH(i + 1.0), f.x), f.y), f.z) * 2.0 - 1.0;
}
`;

// Wind sway (render only, fx.js drives the uniforms): scatter tufts and trees lean in world space by aSway^2 (0 at the base, 1 at the
// tip, baked per geometry from its bounding box), a small breeze everywhere and more inside active wind boxes (lookWA = min.xyz + strength,
// lookWB = max.xyz). The per-material amplitude is baked into aSway too, so post.js's shared edge (normal) material sways the same way
// via swayEdges(); meshes without aSway read 0 there and stay put.
// world.js drives the rest: breeze (base sway, mood), gust (xyz centre + w age s, the l3 finale's radial push; w < 0 off) and
// wake[4] (xyz rune + w age s; w < 0 off): a warm wave running out over the grass from each woken rune.
// hero (xyz feet, fx.js): grass parts around the hero.
export const lookUniforms = { time: { value: 0 }, wa: { value: Array.from({ length: 4 }, () => new THREE.Vector4()) }, wb: { value: Array.from({ length: 4 }, () => new THREE.Vector3()) },
  breeze: { value: 1 }, gust: { value: new THREE.Vector4(0, 0, 0, -1) }, hero: { value: new THREE.Vector3(0, -1e4, 0) }, wake: { value: Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 0, -1)) },
  fade: { value: new THREE.Vector4(0, 0, 0, -1) }, fadeY: { value: 0 }, fadeCam: { value: new THREE.Vector3() } };
// Occluder fade (camera.js writes lookFade = xyz look point at the hero's head, w = overhang amount 0..1; w < 0 off; lookFadeY = top
// of the overhang). Level geometry (aFade = 1, tagged by level.js; other meshes read 0) is dithered out to ~25% coverage where it sits
// within ~4 m of the lens, between the camera and the hero (a narrow cone along the arm, feathered ~1.5 m, before the hero) or overhead (head clearance up to the overhang's top,
// within ~9 m of a point 3 m ahead of the hero in view) while camera.js finds an overhang above the hero.
// Screen-space IGN dither on a smoothly moving region: holes show the painted sky (post.js colour alpha). The edge pass cuts the
// same region outright (a dithered depth would ink every hole).
const FADE_GLSL = `uniform vec4 lookFade;
uniform float lookFadeY;
uniform vec3 lookFadeCam;
float lookFadeK(vec3 p) {
  if (lookFade.w < 0.0 || distance(cameraPosition, lookFadeCam) > 0.5) return 0.0; // only through the play camera (not cutscenes, title orbit, debug shots)
  vec3 h = lookFade.xyz; float feet = h.y - 1.4;
  if (p.y < feet + 0.4) return 0.0; // the ground under the hero stays
  vec3 v = h - cameraPosition, q = p - cameraPosition; float L = max(length(v), 1e-3); v /= L;
  float t = dot(q, v), rad = mix(0.2, 0.9, clamp(t / L, 0.0, 1.0)); // narrow core: the arm already pulls in past walls (camera.js armFree)
  // feathered ~1.5 m past the core: the dither thins out instead of a hard band
  float a = step(0.0, t) * (1.0 - smoothstep(L - 1.2, L - 0.6, t)) * (1.0 - smoothstep(rad * 0.5, rad + 1.5, length(q - v * t)));
  vec2 c = h.xz + normalize(h.xz - cameraPosition.xz + 1e-4) * 3.0;
  float b = lookFade.w * smoothstep(feet + 2.0, feet + 3.5, p.y) * (1.0 - smoothstep(lookFadeY + 0.3, lookFadeY + 1.8, p.y)) * (1.0 - smoothstep(6.5, 10.0, length(p.xz - c)));
  float n = (1.0 - smoothstep(1.2, 4.0, length(q))) * step(0.0, dot(q, v)); // rock right in front of the lens
  return max(max(a, b), n);
}
`;
const SWAY_U = { lookTime: lookUniforms.time, lookWA: lookUniforms.wa, lookWB: lookUniforms.wb, lookBreeze: lookUniforms.breeze, lookGust: lookUniforms.gust, lookHero: lookUniforms.hero };
const swayAmp = (mat) => (mat.name === 'scatter' ? 0.07 : mat.userData.sway ? 0.04 : 0); // m at the tip in a breeze; level.js tags tree materials (all props are tripo_*, the stones must not sway)
const AMP0 = 0.07; // aSway = h * sqrt(amp / AMP0): lookS = aSway^2 carries the amplitude
function bakeSway(geo, amp) {
  if (geo.attributes.aSway) return;
  const k = Math.sqrt(amp / AMP0);
  geo.computeBoundingBox();
  const { min, max } = geo.boundingBox, pos = geo.attributes.position, a = new Float32Array(pos.count), span = Math.max(max.y - min.y, 1e-6);
  for (let i = 0; i < a.length; i++) a[i] = k * (pos.getY(i) - min.y) / span;
  geo.setAttribute('aSway', new THREE.BufferAttribute(a, 1));
}
const swayGlsl = `
  {
    float lookS = aSway * aSway, lookK = 0.0;
    for (int i = 0; i < 4; i++) {
      vec3 lo = lookWA[i].xyz, hi = lookWB[i];
      if (all(greaterThanEqual(vLookPos, lo - 1.0)) && all(lessThanEqual(vLookPos, hi + 1.0))) lookK = max(lookK, lookWA[i].w);
    }
    float lookPh = dot(vLookPos.xz, vec2(0.8, 0.6)) * 0.5, lookF = 1.0 + 2.5 * lookK;
    vec2 lookD = vec2(sin(lookTime * 1.3 * lookF + lookPh) + 0.5 * sin(lookTime * 2.9 + lookPh * 2.3), cos(lookTime * 1.1 * lookF + lookPh * 1.3));
    vec3 lookOff = vec3(lookD.x, -0.15 * abs(lookD.x), lookD.y) * lookS * ${AMP0.toFixed(3)} * (lookBreeze + 3.0 * lookK);
    if (lookGust.w >= 0.0) { // a ring of wind running outward (18 m/s), fading over 4 s
      vec2 lookGd = vLookPos.xz - lookGust.xz; float lookGl = length(lookGd) + 1e-3, lookGa = lookGl - lookGust.w * 18.0;
      lookOff.xz += lookGd / lookGl * exp(-lookGa * lookGa / 18.0) * max(0.0, 1.0 - lookGust.w / 4.0) * lookS * ${(AMP0 * 9).toFixed(3)};
    }
    vec3 lookHd = vLookPos - lookHero; float lookHl = length(lookHd.xz) + 1e-3; // grass parts around the hero's feet (scatter only: trees are taller than 1.6 m)
    lookOff.xz += lookHd.xz / lookHl * smoothstep(0.9, 0.25, lookHl) * step(abs(lookHd.y), 1.6) * lookS * ${(AMP0 * 4).toFixed(3)};
    mvPosition.xyz += (viewMatrix * vec4(lookOff, 0.0)).xyz;
    gl_Position = projectionMatrix * mvPosition;
  }`;

const SWAY_DECL = 'attribute float aSway;\nuniform float lookTime, lookBreeze;\nuniform vec4 lookWA[4], lookGust;\nuniform vec3 lookWB[4], lookHero;\n';
// Edge pass: the same sway on post.js's MeshNormalMaterial override (ink lines follow the swaying trees).
export function swayEdges(mat) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, SWAY_U, { lookFade: lookUniforms.fade, lookFadeY: lookUniforms.fadeY, lookFadeCam: lookUniforms.fadeCam });
    sh.vertexShader = SWAY_DECL + 'attribute float aFade;\nvarying vec3 vFadePos;\nvarying float vFadeOn;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  vec4 lookW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    lookW = instanceMatrix * lookW;
  #endif
  vec3 vLookPos = (modelMatrix * lookW).xyz;
  vFadePos = vLookPos; vFadeOn = aFade;${swayGlsl}`);
    sh.fragmentShader = 'varying vec3 vFadePos;\nvarying float vFadeOn;\n' + FADE_GLSL + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (vFadeOn > 0.5 && lookFadeK(vFadePos) > 0.05) discard;`); // no ink anywhere in the feather either
  };
}

const KIND = { rock: 'rock', stone: 'rock', grass: 'grass', scatter: 'grass' };
// B1: triplanar luminance of Rock030 on object position/normal (vLookTex: instance space x the model scale, so density matches
// world units but the pattern rides with a moving mesh: platforms, slabs, Kamen), normalised to ~1 around its mean.
const detailGlsl = `
  vec3 lookTw = pow(abs(normalize(vLookNrm)), vec3(4.0)); lookTw /= lookTw.x + lookTw.y + lookTw.z;
  vec3 lookTp = vLookTex * ${DETAIL.scale};
  lookDet = texture2D(lookDetail, lookTp.zy).r * lookTw.x + texture2D(lookDetail, lookTp.xz).r * lookTw.y + texture2D(lookDetail, lookTp.xy).r * lookTw.z;
  lookDet = clamp(lookDet / ${DETAIL.mean.toFixed(3)}, 0.35, 1.8);`;
// B2: large world-anchored ochre patches (dry grass) plus a finer broken edge.
const ochreGlsl = `
  float lookO = smoothstep(-0.05, 0.3, lookVn(vLookTex * 0.11 + 3.0) * 0.7 + lookVn(vLookTex * 0.45 + 9.0) * 0.3);
  outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.32, 1.06, 0.6), lookO * ${OCHRE});
  for (int i = 0; i < 4; i++) { // rune wake: a warm wave runs out over the grass (9 m/s) and fades (no flower dots: flat discs read as white blobs)
    float lookA = lookWake[i].w;
    if (lookA < 0.0) continue;
    float lookR = length(vLookPos.xz - lookWake[i].xz), lookF = lookR - lookA * 9.0;
    float lookUp = step(abs(vLookPos.y - lookWake[i].y), 6.0);
    outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.3, 1.12, 0.72), exp(-lookF * lookF / 6.0) * clamp(1.0 - lookA / 3.0, 0.0, 1.0) * lookUp * 0.85);
  }`;
// B6: warm rim, strongest when the sun is behind the surface (backlit), a faint sliver otherwise.
const rimGlsl = `
  #if NUM_DIR_LIGHTS > 0
    vec3 lookV = normalize(vViewPosition);
    float lookRim = pow(1.0 - clamp(dot(normal, lookV), 0.0, 1.0), 3.0);
    float lookBack = clamp(-dot(lookV, directionalLights[0].direction), 0.0, 1.0);
    outgoingLight += lookRimColor * lookRim * (0.2 + 0.8 * lookBack) * ${RIM.k};
  #endif`;

function patch(mat) {
  if (!mat?.isMeshStandardMaterial || mat.userData.look) return;
  mat.userData.look = true;
  const kind = KIND[mat.name] ?? 'base', amp = swayAmp(mat), prev = mat.onBeforeCompile; // prev: a material's own patch (player.js cloak threads) runs first
  mat.onBeforeCompile = (sh, r) => {
    prev.call(mat, sh, r);
    sh.vertexShader = `varying vec3 vLookPos;\nvarying vec3 vLookTex;\nvarying vec3 vLookNrm;\nattribute float aFade;\nvarying float vFadeOn;\n${amp ? SWAY_DECL : ''}` + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  vFadeOn = aFade;
  vec4 lookW = vec4(transformed, 1.0);
  vec3 lookNo = objectNormal;
  #ifdef USE_INSTANCING
    lookW = instanceMatrix * lookW;
    lookNo = mat3(instanceMatrix) * lookNo;
  #endif
  vLookPos = (modelMatrix * lookW).xyz;
  vLookTex = lookW.xyz * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz)); // object space, world-sized
  vLookNrm = lookNo;${amp ? swayGlsl : ''}`);
    if (amp) Object.assign(sh.uniforms, SWAY_U);
    if (kind === 'grass') sh.uniforms.lookWake = lookUniforms.wake;
    if (ramp) sh.uniforms.lookRamp = ramp;
    sh.uniforms.lookRimColor = rimColor;
    sh.uniforms.lookFade = lookUniforms.fade; sh.uniforms.lookFadeY = lookUniforms.fadeY; sh.uniforms.lookFadeCam = lookUniforms.fadeCam;
    if (kind === 'rock') sh.uniforms.lookDetail = detail;
    sh.fragmentShader = `varying vec3 vLookPos;\nvarying vec3 vLookTex;\nvarying vec3 vLookNrm;\nuniform vec3 lookRimColor;\n${kind === 'rock' ? 'uniform sampler2D lookDetail;\n' : ''}${kind === 'grass' ? 'uniform vec4 lookWake[4];\n' : ''}${VN}${RAMP ? `uniform vec3 lookRamp[${RAMP.length}];\n` : ''}` + sh.fragmentShader.replace('#include <opaque_fragment>', `
  float lookDet = 1.0;${kind === 'rock' ? detailGlsl : ''}
  float lookLum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
  float lookN = fract(sin(dot(floor(vLookTex * 6.0), vec3(12.9898, 78.233, 45.164))) * 43758.5453) - 0.5;${rampGlsl}
  outgoingLight *= mix(1.0, lookDet, ${DETAIL.tone});${kind === 'grass' ? ochreGlsl : ''}${rimGlsl}
  #ifdef USE_COLOR
    // watercolor blotches on vertex-coloured level geometry (rock, grass), anchored in object space (see vLookTex)
    float lookB = lookVn(vLookTex * 0.35) * 0.65 + lookVn(vLookTex * 1.1 + 17.0) * 0.35;
    outgoingLight *= 1.0 + ${BLOTCH.toFixed(2)} * lookB;
    outgoingLight = mix(outgoingLight, outgoingLight * vec3(1.05, 0.98, 0.9), smoothstep(0.2, 0.6, lookB)); // warm pooled pigment
  #endif
#include <opaque_fragment>`);
    sh.fragmentShader = 'varying float vFadeOn;\n' + FADE_GLSL + sh.fragmentShader.replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
  if (vFadeOn > 0.5 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) >= 1.0 - 0.75 * lookFadeK(vLookPos)) discard; // ~25% coverage at full fade`);
  };
  mat.customProgramCacheKey = () => `look5-${kind}-${amp}${mat.userData.cacheKey ?? ''}`;
  mat.needsUpdate = true;
}

export default {
  name: 'look', order: 50,
  async init(ctx) { // runs after level/player loaded; objects added later need ctx.registry.set('look.refresh')
    detailLoad ??= ctx.assets.arrayBuffer(DETAIL.tex).then(async (buf) => { // tracked: game.start waits, shots stay deterministic
      const t = new THREE.Texture(await createImageBitmap(new Blob([buf]), { imageOrientation: 'flipY' }));
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.flipY = false; t.anisotropy = 4; t.needsUpdate = true;
      detail.value = t;
    });
    await detailLoad;
    const all = () => ctx.scene.traverse((o) => {
      [o.material].flat().forEach(patch);
      const m = o.isMesh && [o.material].flat().find((q) => q && swayAmp(q)); if (m) bakeSway(o.geometry, swayAmp(m));
    });
    all();
    ctx.registry.on('look.refresh', all);
  },
};
