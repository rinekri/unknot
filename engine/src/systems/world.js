// Living world (Phase F). Mood: level.json 'mood' sets the sky (core/post.js SKY), fog, hemisphere / sun light and the base breeze;
// the boot defaults are restored first, so a level without a mood looks as before. Sunrise: the sky's sun climbs, the fog
// thins and the light warms up with route progress (sim: 'world.progress', monotonic; render lerps).
// Ambient pieces from the level generator (kit.mjs), all layer 1 (no ink edges): the Crown beacon (unfogged spire, a slow
// debris ring, a faint gold beam), waterfall ribbons (streak shader) and one cloud-sea plane under killY with scrolling noise.
// Reactions: each woken rune / totem ('wakes', level.js) sends a warm wave over the grass (look.js wake) that leaves small flowers
// (scatter_flower copies among the tufts, one InstancedMesh, render only);
// l2's breeze comes back in steps, Kestrel freed then totem ('world.breeze'); in l3 the last Keeper freed ('goal.after' flag) is the finale: a
// radial gust through grass and trees, petals ('world.finale', fx.js) and the clouds part. A Keeper freed / woken = 'unbind' cue.
// Cutscenes (cutscene.js, render only): registry 'cut.world' {clock: s added to the render clock so water and clouds move under a
// paused sim, sun: 0..1 sunrise override, fin: s since the finale gust (plays it without the sim's finale)}.
import * as THREE from 'three';
import { SKY } from '../core/post.js';
import { lookUniforms } from './look.js';
import { mulberry32, hash } from '../core/rng.js';

const _grey = new THREE.Color(), _slate = new THREE.Color();
const C = (c) => new THREE.Color(c), lerp = THREE.MathUtils.lerp, sstep = THREE.MathUtils.smoothstep;
let D, S; // boot defaults (captured once), per-level state
const BLOOM = { n: 60, r: 10, grow: 0.7, speed: 9 }; // wake flowers: per rune, radius (m), scale-up (s), stagger (m/s = look.js wave speed)
const _bm = new THREE.Matrix4(), _bs = new THREE.Vector3();

// Wake flowers (render only): a woken rune's block is placed once from the level seed + rune id beside tufts within BLOOM.r on its
// island, then each flower scales up as the grass wave reaches it.
function bloom(wakes, now) {
  const im = S.bloom, src = im.userData.src, tufts = S.reg.get('level')?.tufts ?? [];
  for (let i = S.blooms.length; i < wakes.length; i++) {
    const w = wakes[i], rnd = mulberry32((S.data.seed ?? 1) ^ hash(w.id)), off = im.count, items = [];
    const near = tufts.filter((e) => { const d = Math.hypot(e[0] - w.pos.x, e[2] - w.pos.z); return d > 1.2 && d < BLOOM.r && Math.abs(e[1] - w.pos.y) < 1.5; });
    for (let k = 0; k < BLOOM.n && near.length && off + k < im.instanceMatrix.count; k++) {
      const e = near[Math.floor(rnd() * near.length)], a = rnd() * 6.283, o = 0.15 + 0.25 * rnd(), p = new THREE.Vector3(e[0] + Math.cos(a) * o, e[1], e[2] + Math.sin(a) * o);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.3, rnd() * 6.283, (rnd() - 0.5) * 0.3));
      items.push({ p, q, s: 0.9 + 0.5 * rnd(), at: Math.hypot(p.x - w.pos.x, p.z - w.pos.z) / BLOOM.speed });
      im.setMatrixAt(off + k, _bm.compose(p, q, _bs.setScalar(1.4)).multiply(src)); // full size first: the culling sphere covers the grown block
    }
    im.count = off + items.length; im.computeBoundingSphere();
    S.blooms.push({ w, off, items, done: false });
  }
  let dirty = false;
  for (const b of S.blooms) {
    if (b.done) continue;
    let all = true;
    b.items.forEach((f, k) => {
      const g = sstep(now - b.w.t - f.at, 0, BLOOM.grow); all &&= g >= 1;
      im.setMatrixAt(b.off + k, _bm.compose(f.p, f.q, _bs.setScalar(f.s * Math.max(g, 1e-3))).multiply(src));
    });
    b.done = all; dirty = true;
  }
  im.instanceMatrix.needsUpdate ||= dirty;
  im.visible = im.count > 0;
}

const SEA_V = `varying vec3 vW; void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const SEA_F = `
uniform float uTime, uPart; uniform vec3 uLit, uShade, uHaze; uniform vec2 uHole;
varying vec3 vW;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.0), f.x), f.y); }
void main() {
  vec2 p = vW.xz * 0.018;
  float n = vn(p + uTime * vec2(0.012, 0.005)) * 0.55 + vn(p * 2.3 - uTime * vec2(0.008, 0.016)) * 0.3 + vn(p * 6.1 + uTime * 0.02) * 0.15;
  float d = distance(cameraPosition.xz, vW.xz);
  vec3 c = mix(mix(uShade, uLit, smoothstep(0.35, 0.75, n)), uHaze, smoothstep(120.0, 480.0, d));
  float above = cameraPosition.y - vW.y, base = mix(0.8, 0.97, smoothstep(10.0, 45.0, above)); // well above it: a near-solid sea, nothing below shows through (no mirror look)
  float a = (base + (1.0 - base) * smoothstep(0.3, 0.6, n)) * smoothstep(4.0, 30.0, above) * (1.0 - smoothstep(520.0, 700.0, d));
  // finale: a ragged hole opens under the crown onto the blue below, a sunlit lip round it
  float r = (distance(vW.xz, uHole) + 60.0 * n) / (1.0 + 600.0 * uPart), hole = 1.0 - smoothstep(0.55, 0.9, r);
  c = mix(c, mix(vec3(0.42, 0.54, 0.64), uHaze, 0.6 * smoothstep(150.0, 600.0, d)), hole) + uLit * 0.25 * uPart * smoothstep(0.5, 0.8, r) * (1.0 - smoothstep(0.8, 1.1, r));
  gl_FragColor = vec4(c, a);
}`;
const FALL_V = `attribute vec3 color; varying vec2 vUv; varying float vF, vD;
void main() { vUv = uv; vF = color.r; vec4 mv = modelViewMatrix * vec4(position, 1.0); vD = -mv.z; gl_Position = projectionMatrix * mv; }`;
const FALL_F = `
uniform float uTime; uniform vec3 uLit, uShade, uFog; uniform vec2 uFogNF;
varying vec2 vUv; varying float vF, vD;
float h(float x) { return fract(sin(x * 91.17) * 43758.5453); }
float n1(float x) { float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h(i), h(i + 1.0), f); }
void main() { // soft lanes: each streak column fades at its sides, a noise sheet breaks the gaps up; soft lip and end (vF fades the end)
  float x = vUv.x * 7.0 + 0.6 * n1(vUv.y * 9.0 - uTime * 0.7), y = vUv.y * 30.0, streak = 0.0;
  for (int k = -1; k <= 1; k++) {
    float lane = floor(x) + float(k), lx = x - lane - 0.5;
    float s = fract(y * 0.3 - uTime * (1.4 + 0.8 * h(lane)) + h(lane + 7.0));
    float body = smoothstep(0.0, 0.18, s) * smoothstep(1.0, 0.5, s);
    streak = max(streak, body * smoothstep(0.55, 0.1, abs(lx)));
  }
  float sheet = n1(vUv.x * 13.0 + 3.0 * n1(y * 0.4)) * n1(y * 0.9 - uTime * 2.2);
  streak = clamp(streak * (0.75 + 0.5 * sheet) + 0.25 * sheet, 0.0, 1.0);
  float edge = smoothstep(0.0, 0.22, vUv.x) * smoothstep(1.0, 0.78, vUv.x) * smoothstep(0.0, 0.012, vUv.y);
  vec3 c = mix(mix(uShade, uLit, streak), uFog, smoothstep(uFogNF.x, uFogNF.y, vD));
  gl_FragColor = vec4(c, vF * edge * (0.22 + 0.58 * streak));
}`;
const BEAM_V = `varying float vY; void main() { vY = uv.y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const BEAM_F = `uniform float uA; varying float vY; void main() { gl_FragColor = vec4(1.0, 0.82, 0.48, uA * pow(1.0 - vY, 1.5) * smoothstep(0.0, 0.03, vY)); }`;

function layer1(o) { o.traverse((c) => c.layers.set(1)); return o; }

export default {
  name: 'world', order: 13, deps: ['level'],
  init(ctx) {
    const { scene, registry: reg } = ctx, data = reg.get('level')?.data ?? {}, mood = data.mood;
    const hemi = scene.children.find((o) => o.isHemisphereLight), sun = scene.children.find((o) => o.isDirectionalLight);
    D ??= { sky: { ...SKY, sun: [...SKY.sun] }, fog: { color: scene.fog.color.clone(), near: scene.fog.near, far: scene.fog.far },
      hemi: { sky: hemi.color.clone(), ground: hemi.groundColor.clone(), i: hemi.intensity }, sun: { color: sun.color.clone(), i: sun.intensity, y: sun.position.y } };
    Object.assign(SKY, D.sky, { sun: [...D.sky.sun], clouds: 1, sunK: 1, part: 0, bank: 0 });
    for (const k in mood?.sky ?? {}) SKY[k] = C(mood.sky[k]).getHex();
    const two = (v, d) => (Array.isArray(v) ? v : [v ?? d, v ?? d]);
    S = {
      reg, hemi, sun, data, progress: 0, prevFlags: null, finale: null, breeze: mood?.breeze ?? 1, breezeNow: null,
      sunDir: mood?.sun ? [new THREE.Vector3(...mood.sun[0]), new THREE.Vector3(...mood.sun[1])] : [new THREE.Vector3(...D.sky.sun), new THREE.Vector3(...D.sky.sun)],
      fogFar: two(mood?.fog?.far, D.fog.far), lightI: two(mood?.light?.i, D.sun.i), lightY: two(mood?.light?.y, D.sun.y),
      route: (data.route ?? []).map((p) => new THREE.Vector3(p[0], p[1], p[2])), totems: (data.mechanisms ?? []).filter((m) => m.kind === 'switch' && /totem/i.test(m.id)).map((m) => m.id),
    };
    scene.fog.color.copy(mood?.fog?.color ? C(mood.fog.color) : D.fog.color); scene.fog.near = mood?.fog?.near ?? D.fog.near;
    hemi.color.copy(mood?.hemi ? C(mood.hemi.sky) : D.hemi.sky); hemi.groundColor.copy(mood?.hemi ? C(mood.hemi.ground) : D.hemi.ground); hemi.intensity = mood?.hemi?.i ?? D.hemi.i;
    sun.color.copy(mood?.light?.color ? C(mood.light.color) : D.sun.color);
    lookUniforms.breeze.value = S.breeze; lookUniforms.gust.value.w = -1;
    for (const w of lookUniforms.wake.value) w.w = -1;

    // Crown beacon: no fog on the spire, the debris ring turns, a faint gold beam stands on the crown
    const spire = scene.getObjectByName('landmark');
    if (spire) {
      layer1(spire).traverse((o) => { if (o.material) o.material.fog = false; });
      S.ring = scene.getObjectByName('landmark_ring');
      const top = data.beacon?.pos ?? spire.position.toArray(), beam = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 260, 12, 1, true).translate(0, 130, 0),
        new THREE.ShaderMaterial({ vertexShader: BEAM_V, fragmentShader: BEAM_F, uniforms: { uA: { value: 0.22 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      beam.position.set(top[0], top[1] - 6, top[2]); beam.name = 'world__beam'; S.beam = beam;
      ctx.add(layer1(beam));
    }
    // waterfalls: the ribbons' plain material swapped for the streak shader
    const falls = scene.getObjectByName('waterfalls');
    if (falls?.isMesh) {
      falls.material.dispose();
      falls.material = S.fallMat = new THREE.ShaderMaterial({ vertexShader: FALL_V, fragmentShader: FALL_F, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        uniforms: { uTime: { value: 0 }, uLit: { value: C('#fbf8f2') }, uShade: { value: C('#c9d3d8') }, uFog: { value: scene.fog.color }, uFogNF: { value: new THREE.Vector2() } } });
      layer1(falls);
    }
    // l3 finale: the distant islands nearest the crown (kit.mjs distantRing drift) drift ~15 m in toward it over ~22 s (render only)
    const crown = new THREE.Vector3(...(data.goal?.pos ?? [0, 0, 0]));
    S.drift = [];
    scene.traverse((o) => { if (/^distant__drift/.test(o.name)) S.drift.push({ o, base: o.position.clone(), dir: crown.clone().sub(o.getWorldPosition(new THREE.Vector3())).normalize() }); });
    // bad ending (cut fx 'grey', render only): the sky and light sink to slate, the far islands drift apart, and the hero stands on as
    // a weathered stone totem with a frayed cord where the hero stood (the totem rises around the hero, then the hero is gone)
    S.skyBase = Object.fromEntries(['top', 'horizon', 'sunGlow', 'sunDisc', 'cloudLit', 'cloudShade', 'haze'].map((k) => [k, C(SKY[k])]));
    S.fogBase = scene.fog.color.clone();
    {
      // the hero's own silhouette in stone: a cloak flaring to the ground, the hood, the staff beside it
      const prof = [[0.4, 0], [0.37, 0.25], [0.29, 0.75], [0.25, 1.1], [0.27, 1.3], [0.2, 1.42], [0.19, 1.6], [0.13, 1.76], [0.04, 1.84], [0, 1.85]].map(([r, y]) => new THREE.Vector2(r, y));
      const g = new THREE.LatheGeometry(prof, 10), v = g.attributes.position, rnd = mulberry32(77);
      for (let i = 0; i < v.count; i++) { const k = 1 + (rnd() - 0.5) * 0.12; v.setX(i, v.getX(i) * k); v.setZ(i, v.getZ(i) * k * (v.getY(i) < 1.35 ? 0.8 : 1)); }
      g.computeVertexNormals();
      const totem = new THREE.Group(), stone = new THREE.MeshLambertMaterial({ color: 0xa39d90 }), cord = new THREE.MeshLambertMaterial({ color: 0x7a5a3a });
      totem.add(new THREE.Mesh(g, stone));
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.06, 2.0, 6).translate(0, 1.0, 0), stone); staff.position.set(0.42, 0, 0.05); staff.rotation.z = -0.06; totem.add(staff);
      const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 0), stone); head.position.set(0.48, 2.02, 0.05); totem.add(head);
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.05, 6, 16), cord); band.rotation.x = Math.PI / 2; band.position.y = 1.12; band.scale.set(1, 0.8, 1); totem.add(band);
      const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.6, 5).translate(0, -0.3, 0), cord); tail.position.set(0.26, 1.1, 0); tail.rotation.z = 0.25; totem.add(tail);
      totem.visible = false; totem.name = 'world__badTotem'; S.badTotem = totem;
      ctx.add(totem);
    }
    // cloud sea under the islands: one plane, scrolling noise, fades into the haze and away as the camera nears it
    const mid = S.route.length ? S.route[Math.floor(S.route.length / 2)] : new THREE.Vector3();
    const sea = S.sea = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({ vertexShader: SEA_V, fragmentShader: SEA_F, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uLit: { value: C(SKY.cloudLit) }, uShade: { value: C(SKY.cloudShade) }, uHaze: { value: C(SKY.haze) }, uPart: { value: 0 }, uHole: { value: new THREE.Vector2(crown.x, crown.z) } } }));
    sea.position.set(mid.x, (data.killY ?? -12) - 6, mid.z); sea.name = 'world__sea'; sea.renderOrder = -1; sea.frustumCulled = false;
    ctx.add(layer1(sea));
    const fl = scene.getObjectByName('scatter_flower__instances'); // wake flowers: same geometry and material as the scatter flowers
    if (fl) {
      const im = S.bloom = new THREE.InstancedMesh(fl.geometry, fl.material, (data.mechanisms ?? []).filter((m) => m.kind === 'switch').length * BLOOM.n);
      im.layers.mask = fl.layers.mask; im.count = 0; im.visible = false; im.name = 'world__bloom'; im.userData.src = fl.userData.src;
      S.blooms = [];
      ctx.add(im);
    }
  },
  dispose() {
    for (const m of [S?.sea, S?.beam]) { m?.geometry.dispose(); m?.material.dispose(); }
    S?.fallMat?.dispose();
    S = null;
  },
  update(ctx) { // sim: route progress, the l2 breeze target, the l3 finale, Keepers freed
    if (!S) return;
    const reg = ctx.registry, pl = reg.get('player'), flags = reg.get('flags') ?? {}, t = ctx.game.t;
    if (pl && S.route.length > 1) {
      let best = 0, bd = Infinity;
      S.route.forEach((p, i) => { const d = p.distanceToSquared(pl.pos); if (d < bd) { bd = d; best = i; } });
      const pr = best / (S.route.length - 1);
      if (pr > S.progress) reg.set('world.progress', S.progress = pr);
    }
    const mood = S.data.mood;
    if (mood?.breezeFree !== undefined && S.totems.length) {
      const woke = (reg.get('wakes') ?? []).filter((w) => S.totems.includes(w.id)).length; // in steps: part way once mood.breezeAfter is set (l2: the Kestrel freed), all of it with every totem
      S.breeze = lerp(mood.breeze, mood.breezeFree, Math.max(woke / S.totems.length, mood.breezeAfter && flags[mood.breezeAfter] ? 0.4 : 0));
    }
    const after = S.data.goal?.after;
    if (after && !S.finale && flags[after]) { S.finale = { t, pos: S.data.goal.pos }; reg.set('world.finale', S.finale); }
    const keep = Object.keys(flags).filter((k) => /^npc\.[^.]+\.(free|awake)$/.test(k) && flags[k]);
    if (S.prevFlags && keep.some((k) => !S.prevFlags.includes(k))) reg.set('audio.cue', { name: 'unbind', at: 0.6 });
    S.prevFlags = keep;
  },
  beforeRender(ctx, alpha) {
    if (!S) return;
    const cw = S.reg.get('cut.world'), now = ctx.game.t - (1 - alpha) / 60 + (cw?.clock ?? 0), p = sstep(S.progress, 0, 1), { scene } = ctx;
    S.pShow = S.pShow === undefined ? p : S.pShow + (p - S.pShow) * 0.02; // the sky drifts, never jumps
    const k = cw?.sun ?? S.pShow, fin = cw?.fin ?? (S.finale ? now - S.finale.t : -1), gustAt = S.finale?.pos ?? S.data.goal?.pos ?? [0, 0, 0];
    const sd = S.sunDir[0].clone().lerp(S.sunDir[1], k);
    SKY.sun[0] = sd.x; SKY.sun[1] = sd.y; SKY.sun[2] = sd.z;
    const part = fin >= 0 ? sstep(fin, 2, 14) : 0; // the clouds part over ~12 s, through the sunrise line (cut t 12.6 = fin 10.6)
    SKY.clouds = 1 - 0.4 * part; SKY.sunK = 1 + 1.6 * (fin >= 0 ? sstep(fin, 4, 16) : 0); // the sun swells and warms
    SKY.bank = fin >= 0 ? sstep(fin, 0, 3) : 0; SKY.part = fin >= 0 ? sstep(fin, 3, 20) : 0; // horizon: the gap opens under the sun through the sun-facing shots (cut t 12..22)
    S.sea.material.uniforms.uPart.value = part;
    scene.fog.far = lerp(S.fogFar[0], S.fogFar[1], k) + 80 * part;
    S.sun.intensity = lerp(S.lightI[0], S.lightI[1], k); S.sun.position.y = lerp(S.lightY[0], S.lightY[1], k);
    S.breezeNow = S.breezeNow === null ? S.breeze : S.breezeNow + (S.breeze - S.breezeNow) * 0.01;
    lookUniforms.breeze.value = S.breezeNow;
    S.reg.set('world.breeze', S.breezeNow);
    const wakes = S.reg.get('wakes') ?? [];
    lookUniforms.wake.value.forEach((w, i) => { const e = wakes[wakes.length - 1 - i]; if (e) w.set(e.pos.x, e.pos.y, e.pos.z, Math.max(0, now - e.t)); else w.w = -1; });
    if (S.bloom) bloom(wakes, now);
    if (fin >= 0) lookUniforms.gust.value.set(gustAt[0], gustAt[1], gustAt[2], fin); else lookUniforms.gust.value.w = -1;
    if (S.ring) S.ring.rotation.y = now * 0.025;
    const grey = cw?.grey ?? -1;
    for (const d of S.drift) d.o.position.copy(d.base).addScaledVector(d.dir, fin >= 0 ? 15 * sstep(fin, 0, 22) : grey >= 0 ? -22 * sstep(grey, 0, 20) : 0);
    if (grey >= 0) {
      const g = sstep(grey, 0, 7);
      for (const k in S.skyBase) SKY[k] = _grey.copy(S.skyBase[k]).lerp(_slate.set(k === 'sunDisc' || k === 'sunGlow' ? 0xa8a49a : 0x7f8790), 0.7 * g).getHex();
      SKY.clouds = 1 + 0.6 * g; SKY.sunK = 1 - 0.6 * g;
      scene.fog.color.copy(S.fogBase).lerp(_slate.set(0x8a9097), 0.7 * g); scene.fog.far *= 1 - 0.35 * g;
      S.sun.intensity *= 1 - 0.5 * g; S.hemi.intensity = lerp(S.hemiI ??= S.hemi.intensity, S.hemiI * 0.6, g);
      const mk = cw.mark, model = S.reg.get('player.model'), k = sstep(grey, 14, 17.5);
      if (mk && model) {
        S.badTotem.visible = k > 0; S.badTotem.position.set(mk.x, S.reg.get('level')?.collide?.groundAt(mk.x, mk.z, model.position.y + 40)?.y ?? model.position.y, mk.z); S.badTotem.rotation.y = model.rotation.y;
        S.badTotem.scale.set(1, Math.max(0.01, k), 1); model.visible = k < 0.75;
      }
    } else if (S.badTotem?.visible) { S.badTotem.visible = false; S.reg.get('player.model').visible = true; }
    S.sea.material.uniforms.uTime.value = now;
    if (S.fallMat) { S.fallMat.uniforms.uTime.value = now; S.fallMat.uniforms.uFogNF.value.set(scene.fog.near, scene.fog.far); }
  },
};
