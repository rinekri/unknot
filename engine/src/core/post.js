// Edge-line post pass (npr-look.md layers 5-7). Replaces renderer.render(scene, camera):
//   1. scene -> colorRT (MSAA, half float, linear)
//   2. scene with MeshNormalMaterial override -> normalRT + DepthTexture
//   3. fullscreen: depth (Laplacian of 1/z, flat planes cancel) + normal edges, width * refZ/z,
//      sample positions offset by a static noise lattice (wobble), fading out with distance; painted dawn sky (gradient,
//      sun disc + glow, cloud wisps) where depth is empty; then shoulder, sRGB, vignette, IGN dither.
// Layer 1 objects (scatter, glyph decals, wind streaks, sky castles) render in the color pass only: no ink edges, no depth.
// The color pass clears to alpha 0, so its alpha is coverage: the painted sky is composited under whatever is not opaque
// (soft streaks and castle sprites stay visible against the sky, MSAA silhouettes blend into it).
// ponytail: second scene pass instead of MRT (no material patching needed); move to MRT (count: 2) if draw calls get tight.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { swayEdges } from '../systems/look.js';

// enabled: false = STYLE.md "line: none" (skips the normal pass; grade, vignette and dither stay).
export const EDGES = { enabled: true, width: 1.1, refZ: 6, ink: 0x342d24, depthK: 0.05, normalK: 0.35, shoulder: 0.8, span: 0.2, vignette: 0.1, grain: 0.035, fadeNear: 25, fadeFar: 75 }; // grain: paper texture depth; fade*: edge fade-out distance (m)
// Painted sky (STYLE.md: pale cream sky, warm dawn). sun = direction of the disc, low in the haze band toward the 2 o'clock backlight;
// haze = dawn band behind the horizon; clouds = wisp coverage (0 = parted); bank / part = finale (0..1: the wisps thicken, then slide apart from under the sun, a warm flood + shaft through the gap). Read every frame: level.js writes the level mood into it.
export const SKY = { top: 0xf9f3ec, horizon: 0xf4eee6, sunGlow: 0xf7d79c, sunDisc: 0xfdf0c8, cloudLit: 0xf8e7c4, cloudShade: 0xe6d3d3, haze: 0xe9d2b4, sun: [-0.5, 0.09, 1], clouds: 1, sunK: 1, part: 0, bank: 0 };
const SKY_U = { top: 'skyTop', horizon: 'skyHorizon', sunGlow: 'sunGlow', sunDisc: 'sunDisc', cloudLit: 'cloudLit', cloudShade: 'cloudShade', haze: 'haze' };

const frag = /* glsl */ `
#include <packing>
uniform sampler2D tColor, tNormal, tDepth;
uniform vec2 res;
uniform float edges, near, far, width, refZ, depthK, normalK, shoulder, span, vignette, fadeNear, fadeFar;
uniform vec3 ink, haze, skyTop, skyHorizon, sunGlow, sunDisc, cloudLit, cloudShade, sunDir;
uniform float grain, clouds, sunK, part, bank;
uniform mat4 camWorld, invProj;
varying vec2 vUv;

float invZ(vec2 uv) { return -1.0 / perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far); }
vec3 nrm(vec2 uv) { return texture2D(tNormal, uv).xyz * 2.0 - 1.0; }
float h(vec2 c) { return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.0), f.x), f.y) * 2.0 - 1.0;
}
vec2 wobble(vec2 px) { // static lattice: 48/24/12 px cells, 2.6/0.9/0.18 px amplitude
  return 2.6 * vec2(vn(px / 48.0), vn(px / 48.0 + 31.7))
       + 0.9 * vec2(vn(px / 24.0 + 7.1), vn(px / 24.0 + 53.3))
       + 0.18 * vec2(vn(px / 12.0 + 3.9), vn(px / 12.0 + 91.2));
}

void main() {
  vec2 px = vUv * res, uv = (px + wobble(px)) / res;
  float a = invZ(uv), z = 1.0 / a;
  float e = 0.0;
  if (edges > 0.5 && texture2D(tDepth, uv).x < 1.0) { // background gets no lines of its own
    vec2 o = vec2(max(1.0, width * clamp(refZ / z, 0.35, 1.6)), 0.0) / res;
    vec2 p = o.yx * res.x / res.y;
    // Laplacian of 1/z is ~0 on planes; negative only on the near side of a silhouette
    float lap = min(invZ(uv + o) + invZ(uv - o), invZ(uv + p) + invZ(uv - p)) - 2.0 * a;
    float de = max(0.0, -lap) * z;
    vec3 n = nrm(uv);
    float ne = max(max(1.0 - dot(n, nrm(uv + o)), 1.0 - dot(n, nrm(uv - o))), max(1.0 - dot(n, nrm(uv + p)), 1.0 - dot(n, nrm(uv - p))));
    e = max(smoothstep(depthK, depthK * 2.5, de), smoothstep(normalK, normalK * 1.6, ne)) * (1.0 - smoothstep(fadeNear, fadeFar, z));
  }
  vec4 c4 = texture2D(tColor, vUv);
  vec3 c = c4.rgb;
  if (c4.a < 0.999) { // sky shows through: color pass cleared to 0, so c = src * a; add the sky under (1 - a)
    vec4 v = invProj * vec4(vUv * 2.0 - 1.0, 1.0, 1.0);
    vec3 d = normalize((camWorld * vec4(v.xyz / v.w, 0.0)).xyz);
    float up = d.y, ca = dot(d, sunDir);
    float toSun = pow(max(dot(normalize(d.xz + 1e-5), normalize(sunDir.xz)), 0.0), 3.0);
    vec3 sky = mix(skyHorizon, skyTop, smoothstep(0.0, 0.45, up - 0.08 * toSun));
    sky = mix(sky, haze, (1.0 - smoothstep(-0.15, 0.08, up)) * (0.06 + 0.7 * toSun * toSun)); // peach dawn band only toward the sun
    // cloud wisps: long horizontal streaks in a band above the horizon; azimuth measured from the sun (seam behind)
    float az = atan(d.x * sunDir.z - d.z * sunDir.x, dot(d.xz, sunDir.xz));
    // part (finale, 0..1): the wisps slide apart sideways from under the sun, a clear gap opens there
    float azp = az / (1.0 + 2.5 * part), cn = 0.6 * vn(vec2(azp * 4.0, up * 34.0)) + 0.4 * vn(vec2(azp * 11.0 + 5.0, up * 70.0));
    float band = smoothstep(0.0, 0.05, up) * (1.0 - smoothstep(0.12, 0.26, up)) * smoothstep(0.2, 0.9, toSun);
    float cm = min(1.0, smoothstep(0.0, 0.45, cn) * band * clouds * (1.0 + 1.6 * bank)) * mix(1.0, smoothstep(0.08, 0.4, abs(az)), part); // bank: the finale's winds thicken them first
    sky = mix(sky, mix(cloudShade, cloudLit, clamp(toSun * 1.4 + cn * 0.3 - 0.6 * bank, 0.0, 1.0)) * (1.0 - 0.1 * bank), cm * (0.75 + 0.2 * bank));
    // sunK (1 = play): the finale's sun, sunK x wider disc and a broader warm glow
    sky = mix(sky, sunGlow, min(1.0, 0.6 * pow(max(ca, 0.0), 30.0 / sunK) + 0.3 * pow(max(ca, 0.0), 10.0 / sunK) * (1.0 - smoothstep(0.0, 0.4, up)) + 0.25 * (sunK - 1.0) * pow(max(ca, 0.0), 80.0)));
    // through the gap: warm light floods up from the horizon under the sun, a soft shaft rising from it toward the disc
    float flood = part * exp(-az * az * 2.5) * (1.0 - smoothstep(-0.04, 0.34, up)), shaft = part * exp(-az * az * 40.0) * smoothstep(-0.08, 0.0, up) * (1.0 - smoothstep(0.0, max(sunDir.y, 0.1) + 0.05, up));
    sky = mix(sky, vec3(1.0, 0.66, 0.34), min(1.0, 0.95 * flood + 0.7 * shaft));
    sky = mix(sky, sunDisc, smoothstep(1.0 - 0.00065 * sunK * sunK, 1.0 - 0.00045 * sunK * sunK, ca) * (1.0 - cm * 0.6));
    c += (1.0 - clamp(c4.a, 0.0, 1.0)) * sky;
  }
  c = mix(c, ink, e * 0.85);
  c = min(c, shoulder) + span * (1.0 - exp(-max(c - shoulder, 0.0) / span));
  c = linearToOutputTexel(vec4(c, 1.0)).rgb;
  c *= 1.0 - vignette * smoothstep(0.35, 0.85, length(vUv - 0.5));
  // paper grain: fibrous mid noise + fine tooth, screen-anchored like the sheet the frame is painted on
  float paper = 0.55 * vn(px / vec2(9.0, 3.0)) + 0.3 * vn(px / 2.2 + 13.0) + 0.15 * (h(floor(px)) * 2.0 - 1.0);
  c *= 1.0 + grain * paper;
  c += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

export function createPost(renderer) {
  const colorRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const normalRT = new THREE.WebGLRenderTarget(1, 1, { depthTexture: new THREE.DepthTexture(1, 1) });
  const normalMat = new THREE.MeshNormalMaterial();
  swayEdges(normalMat);
  const uniforms = {
    tColor: { value: colorRT.texture }, tNormal: { value: normalRT.texture }, tDepth: { value: normalRT.depthTexture },
    res: { value: new THREE.Vector2() }, edges: { value: 1 }, clouds: { value: 1 }, sunK: { value: 1 }, part: { value: 0 }, bank: { value: 0 },
    ...Object.fromEntries(Object.values(SKY_U).map((u) => [u, { value: new THREE.Color() }])),
    sunDir: { value: new THREE.Vector3() }, camWorld: { value: new THREE.Matrix4() }, invProj: { value: new THREE.Matrix4() }, near: { value: 0.1 }, far: { value: 500 }, ink: { value: new THREE.Color(EDGES.ink) },
    ...Object.fromEntries(['width', 'refZ', 'depthK', 'normalK', 'shoulder', 'span', 'vignette', 'grain', 'fadeNear', 'fadeFar'].map((k) => [k, { value: EDGES[k] }])),
  };
  const quad = new FullScreenQuad(new THREE.ShaderMaterial({
    uniforms, fragmentShader: frag, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  }));
  const clear = new THREE.Color();
  renderer.info.autoReset = false; // two scene passes per frame; perf reads the sum

  function setSize() {
    const s = renderer.getDrawingBufferSize(uniforms.res.value);
    colorRT.setSize(s.x, s.y);
    normalRT.setSize(s.x, s.y);
    uniforms.width.value = EDGES.width * renderer.getPixelRatio();
  }
  setSize();

  return {
    setSize,
    render(scene, camera) {
      renderer.info.reset();
      renderer.setRenderTarget(colorRT);
      const bg0 = scene.background, alpha0 = renderer.getClearAlpha();
      renderer.getClearColor(clear);
      scene.background = null;
      renderer.setClearColor(0x000000, 0); // alpha 0 = sky (see header)
      camera.layers.enable(1);
      renderer.render(scene, camera);
      camera.layers.disable(1);
      scene.background = bg0;
      renderer.setClearColor(clear, alpha0);
      uniforms.edges.value = EDGES.enabled ? 1 : 0;
      if (EDGES.enabled) {
        const bg = scene.background, alpha = renderer.getClearAlpha();
        renderer.getClearColor(clear);
        scene.background = null; scene.overrideMaterial = normalMat;
        renderer.setClearColor(0x000000, 0);
        renderer.setRenderTarget(normalRT);
        renderer.render(scene, camera);
        scene.background = bg; scene.overrideMaterial = null;
        renderer.setClearColor(clear, alpha);
      }
      renderer.setRenderTarget(null);
      for (const k in SKY_U) uniforms[SKY_U[k]].value.set(SKY[k]);
      uniforms.sunDir.value.set(...SKY.sun).normalize(); uniforms.clouds.value = SKY.clouds; uniforms.sunK.value = SKY.sunK; uniforms.part.value = SKY.part; uniforms.bank.value = SKY.bank;
      uniforms.near.value = camera.near; uniforms.far.value = camera.far;
      uniforms.camWorld.value.copy(camera.matrixWorld); uniforms.invProj.value.copy(camera.projectionMatrixInverse);
      quad.render(renderer);
    },
  };
}
