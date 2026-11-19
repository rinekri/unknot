// The Keeper's Loom shrine and the dressing plinth (menus only; no default export: this is not a system).
// A small floating islet is added to the game scene 600 m above the hero while the loom / wardrobe panel is open, and meta.js
// (the last system's beforeRender) points the game camera at it: the shrine goes through the same look.js shading and post.js
// ink + painted sky as the game, with no second renderer. close() removes and disposes everything: gameplay draw calls are unchanged.
// The hero on the plinth is a SkeletonUtils clone of the live model (shared geometry + materials: the real cloak / staff shaders,
// previewed through 'cosmetic.equip'); its clips come from hero.glb. Time here is wall time (menu only, never the sim).
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { PAL } from './loom.js';

const HERO = 'assets/characters/hero/hero.glb', UP = 600, TH = 5; // TH: layer of the thumbnail camera (hero + lights only)
const LOOM_X = 1.0, FELL0 = 0.42, TAP_H = 1.75, HERO_P = [-0.85, 0.3, 1.5], SPIN_P = [2.5, 0, 1.2], NP = 140;
const EDGE = { common: '#b0895a', rare: '#4f83ad', legendary: '#e0a03a' }, RAR_COL = { common: '#f6e9c9', rare: '#6fa3cf', legendary: '#f0b63c' };
const CYCLE = ['#e9b85a', '#7d9a5b', '#5b86a8', '#c4553a', '#6b5a8e', '#dfe6ea', '#b07a52'].map((c) => new THREE.Color(c));
const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };
const _c = new THREE.Color(), _m = new THREE.Matrix4(), _v = V(), _q = new THREE.Quaternion(), _s = V();
let S = null, clipsP = null;
const thumbs = {}; // id -> data URL (session cache: the shaders do not change)

const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
const dotTex = () => canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,.75)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });

// the pity tapestry: woven bands, the gold band of the certain legendary at the top (the 15th row)
function tapestryTex() {
  return canvasTex(256, 480, (g, w, h) => {
    const rows = 15, rh = h / rows, cols = ['#b07a52', '#5b86a8', '#7d9a5b', '#c4553a', '#6b5a8e'];
    for (let r = 0; r < rows; r++) {
      const y = h - (r + 1) * rh, top = r === rows - 1, a = top ? '#e9b85a' : cols[r % cols.length], b = top ? '#fff3c4' : '#f3e6c8';
      g.fillStyle = a; g.fillRect(0, y, w, rh);
      g.fillStyle = b;
      for (let x = 0; x < w; x += 32) { // a motif per band: chevrons / diamonds / bars
        g.beginPath();
        if (r % 3 === 0) { g.moveTo(x, y + rh - 5); g.lineTo(x + 16, y + 5); g.lineTo(x + 32, y + rh - 5); g.lineTo(x + 26, y + rh - 5); g.lineTo(x + 16, y + 14); g.lineTo(x + 6, y + rh - 5); }
        else if (r % 3 === 1) { g.moveTo(x + 16, y + 4); g.lineTo(x + 27, y + rh / 2); g.lineTo(x + 16, y + rh - 4); g.lineTo(x + 5, y + rh / 2); }
        else g.rect(x + 4, y + rh / 2 - 3, 24, 6);
        g.fill();
      }
      g.fillStyle = 'rgba(52,45,36,.35)'; g.fillRect(0, y, w, 2);
    }
    g.fillStyle = 'rgba(52,45,36,.07)'; for (let x = 0; x < w; x += 4) g.fillRect(x, 0, 1, h); // the warp showing through
  });
}

// the woven piece that comes off the loom: a cloth square with the item drawn on it
export function drawItem(g, s, it) {
  const k = s / 128; g.save(); g.scale(k, k);
  g.fillStyle = '#f1e2c4'; g.fillRect(0, 0, 128, 128);
  g.lineWidth = 6; g.strokeStyle = EDGE[it.rarity]; g.strokeRect(7, 7, 114, 114);
  g.lineWidth = 1.5; g.strokeStyle = '#342d24'; g.strokeRect(11.5, 11.5, 105, 105);
  g.lineCap = g.lineJoin = 'round';
  if (it.slot === 'pattern') {
    const [a, b] = PAL[it.pal];
    g.save(); g.beginPath(); g.moveTo(64, 20); g.bezierCurveTo(42, 22, 46, 46, 34, 60); g.bezierCurveTo(24, 76, 22, 92, 22, 106); g.bezierCurveTo(50, 116, 78, 116, 106, 106); g.bezierCurveTo(106, 92, 104, 76, 94, 60); g.bezierCurveTo(82, 46, 86, 22, 64, 20); g.closePath();
    g.fillStyle = a; g.fill(); g.clip(); g.strokeStyle = b; g.fillStyle = b; g.lineWidth = 4;
    for (let y = 44; y < 120; y += 16) {
      g.beginPath();
      if (it.pat === 'stripes') { g.moveTo(10, y); g.lineTo(118, y); g.stroke(); }
      else if (it.pat === 'chevrons') { for (let x = 10; x <= 118; x += 18) g.lineTo(x, y + ((x - 10) / 18 % 2 ? -7 : 5)); g.stroke(); }
      else if (it.pat === 'waves') { for (let x = 10; x <= 118; x += 4) g.lineTo(x, y + Math.sin(x * 0.2) * 5); g.stroke(); }
      else for (let x = 22 + (y % 32 ? 0 : 12); x < 118; x += 24) { g.moveTo(x, y - 7); g.lineTo(x + 2.5, y - 2.5); g.lineTo(x + 7, y); g.lineTo(x + 2.5, y + 2.5); g.lineTo(x, y + 7); g.lineTo(x - 2.5, y + 2.5); g.lineTo(x - 7, y); g.lineTo(x - 2.5, y - 2.5); g.closePath(); g.fill(); }
    }
    g.restore(); g.lineWidth = 2.5; g.strokeStyle = '#342d24'; g.stroke();
  } else if (it.slot === 'tip') {
    g.strokeStyle = '#342d24'; g.lineWidth = 9; g.beginPath(); g.moveTo(64, 60); g.lineTo(64, 112); g.stroke();
    g.strokeStyle = '#a8845c'; g.lineWidth = 5; g.stroke();
    if (it.glow) { const r = g.createRadialGradient(64, 42, 4, 64, 42, 40); r.addColorStop(0, it.col); r.addColorStop(1, 'rgba(255,255,255,0)'); g.globalAlpha = Math.min(1, 0.35 + it.glow); g.fillStyle = r; g.fillRect(14, 0, 100, 90); g.globalAlpha = 1; }
    g.beginPath(); g.moveTo(64, 16); g.lineTo(84, 42); g.lineTo(64, 68); g.lineTo(44, 42); g.closePath(); g.fillStyle = it.col; g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#342d24'; g.stroke();
  } else if (it.slot === 'trail') {
    for (const [w, c] of [[17, '#342d24'], [12, it.col]]) { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); g.moveTo(22, 96); g.bezierCurveTo(46, 40, 70, 110, 106, 34); g.stroke(); }
    g.fillStyle = it.col; for (const [x, y, r] of [[30, 54, 4], [92, 80, 5], [58, 30, 3]]) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }
  } else if (it.slot === 'voice') {
    g.strokeStyle = '#5b86a8'; g.lineWidth = 6;
    for (const r of [16, 30, 44]) { g.beginPath(); g.arc(40, 64, r, -0.8, 0.8); g.stroke(); }
    g.fillStyle = '#e9b85a'; g.beginPath(); g.arc(34, 64, 9, 0, 7); g.fill(); g.lineWidth = 2.5; g.strokeStyle = '#342d24'; g.stroke();
  } else {
    const r = g.createLinearGradient(0, 18, 0, 110); r.addColorStop(0, '#b9a3c9'); r.addColorStop(0.6, it.sky ?? '#e8cfc4'); r.addColorStop(1, '#f4c98f'); g.fillStyle = r; g.fillRect(18, 18, 92, 92);
    g.fillStyle = '#fdf0c8'; g.beginPath(); g.arc(64, 88, 15, 0, 7); g.fill();
    g.fillStyle = '#8a7a8e'; g.beginPath(); g.moveTo(18, 110); g.lineTo(18, 96); g.lineTo(44, 84); g.lineTo(60, 98); g.lineTo(82, 80); g.lineTo(110, 100); g.lineTo(110, 110); g.fill();
  }
  g.restore();
}

function build(ctx) {
  const g = new THREE.Group(), own = new THREE.Group(); g.add(own); g.name = 'loomscene';
  const std = (color, extra) => new THREE.MeshStandardMaterial({ color, roughness: 1, metalness: 0, ...extra });
  const stone = std('#cdbfa8', { flatShading: true }), wood = std('#9a6a42'), dark = std('#6d4a30'), thread = std('#ffffff'), gold = std('#e9b85a');
  stone.name = 'rock'; // look.js: rock detail
  const add = (geo, mat, x, y, z, rx = 0, rz = 0, parent = own) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, 0, rz); parent.add(m); return m; };
  // the islet: a slab of the mountain, a rim of standing stones behind the loom
  add(new THREE.CylinderGeometry(4.4, 3.7, 0.6, 11), stone, 0.4, -0.3, 0.2);
  add(new THREE.ConeGeometry(3.7, 3.4, 11), stone, 0.4, -2.3, 0.2, Math.PI);
  for (const [x, z, h, r] of [[-2.6, -1.9, 1.9, 0.42], [-1.2, -2.7, 2.9, 0.5], [3.1, -2.2, 2.4, 0.46], [4.0, -0.9, 1.4, 0.36]]) add(new THREE.CylinderGeometry(r * 0.55, r, h, 5), stone, x, h / 2, z, 0, (x * 7 % 1) * 0.12);
  add(new THREE.CylinderGeometry(0.8, 0.92, 0.3, 14), stone, HERO_P[0], 0.15, HERO_P[2]);
  const ring = add(new THREE.TorusGeometry(0.8, 0.035, 6, 28), gold, HERO_P[0], 0.3, HERO_P[2], Math.PI / 2);
  // the loom
  const loom = new THREE.Group(); loom.position.set(LOOM_X, 0, 0); own.add(loom);
  const cyl = (r, len) => new THREE.CylinderGeometry(r, r, len, 8);
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.17, 2.75, 0.17), wood, sx * 1.12, 1.375, 0, 0, 0, loom);
    add(new THREE.BoxGeometry(0.24, 0.16, 1.15), dark, sx * 1.12, 0.08, 0.1, 0, 0, loom);
    add(new THREE.BoxGeometry(0.1, 1.3, 0.1), dark, sx * 1.12, 0.62, 0.42, -0.62, 0, loom); // brace
    add(new THREE.SphereGeometry(0.13, 8, 6), gold, sx * 1.12, 2.82, 0, 0, 0, loom); // finial
  }
  add(cyl(0.085, 2.6), wood, 0, 2.55, 0, 0, Math.PI / 2, loom);
  add(cyl(0.1, 2.5), wood, 0, FELL0 - 0.1, 0, 0, Math.PI / 2, loom); // cloth beam
  const heddle = add(new THREE.BoxGeometry(2.2, 0.07, 0.07), dark, 0, 1.6, 0.09, 0, 0, loom);
  const NW = 44, warp = new THREE.InstancedMesh(new THREE.BoxGeometry(0.02, 2.15, 0.02), thread, NW); warp.layers.set(1); // layer 1: colour pass only, no ink lines over the threads
  for (let i = 0; i < NW; i++) { warp.setMatrixAt(i, _m.makeTranslation(-0.98 + 1.96 * i / (NW - 1), 1.47, 0)); warp.setColorAt(i, _c.set('#f3e6c8')); }
  loom.add(warp);
  const NF = 26, weft = new THREE.InstancedMesh(new THREE.BoxGeometry(1.96, 0.026, 0.03), thread, NF); weft.count = 0; weft.frustumCulled = false; weft.layers.set(1); weft.setColorAt(0, _c.set('#fff')); loom.add(weft);
  const tex = tapestryTex(); tex.wrapT = THREE.ClampToEdgeWrapping;
  const tap = new THREE.Mesh(new THREE.PlaneGeometry(1.96, TAP_H).translate(0, TAP_H / 2, 0), std('#ffffff', { map: tex, side: THREE.DoubleSide })); tap.position.set(0, FELL0, 0.022); loom.add(tap);
  const shuttle = add(new THREE.CylinderGeometry(0.012, 0.055, 0.42, 6), dark, 0, FELL0, 0.08, 0, Math.PI / 2, loom);
  // the spindle the thread dust gathers on
  const spin = new THREE.Group(); spin.position.set(...SPIN_P); own.add(spin);
  add(new THREE.CylinderGeometry(0.26, 0.3, 0.1, 10), dark, 0, 0.05, 0, 0, 0, spin);
  add(cyl(0.03, 1.45), wood, 0, 0.75, 0, 0, 0, spin);
  add(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 12), dark, 0, 0.42, 0, 0, 0, spin);
  const bob = add(new THREE.SphereGeometry(1, 12, 8), std('#f3e6c8'), 0, 0.84, 0, 0, 0, spin);
  // the woven piece, its glow, the motes
  const piece = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.74), std('#ffffff', { side: THREE.DoubleSide })); piece.visible = false; own.add(piece);
  const dot = dotTex(), glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, transparent: true, depthWrite: false, opacity: 0 })); glow.layers.set(1); own.add(glow);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot, transparent: true, depthWrite: false, opacity: 0, color: '#f0b63c' })); halo.layers.set(1); halo.position.set(LOOM_X, 1.5, -0.3); own.add(halo);
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NP * 3).fill(-1e4), 3)); pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(NP * 3), 3));
  const pts = new THREE.Points(pg, new THREE.PointsMaterial({ map: dot, size: 0.2, vertexColors: true, transparent: true, depthWrite: false })); pts.layers.set(1); pts.frustumCulled = false; own.add(pts);
  return { g, own, wood, warp, weft, tap, tex, shuttle, heddle, bob, piece, glow, halo, pts, ring, NW, NF, parts: Array.from({ length: NP }, () => ({ t1: 0 })), pi: 0 };
}

// st: {pity 0..1, dust 0..1}; cb: {cue(name, gain), thumb(id, url)}
export function open(ctx, mode, st, cb = {}) {
  if (S && S.ctx !== ctx) close();
  if (S) { S.mode = mode; S.cb = cb; return S; }
  const p = ctx.registry.get('player')?.pos, b = build(ctx), model = ctx.registry.get('player.model');
  b.g.position.set(p?.x ?? 0, (p?.y ?? 0) + UP, p?.z ?? 0);
  S = { ...b, ctx, mode, cb, now: performance.now() / 1000, t: 0, pity: st.pity, dust: st.dust, pityTo: st.pity, dustTo: st.dust, cam: null, turn: 0.5, turnTo: 0.5, drag: null, dragT: -9, flourish: -9, pull: null, trail: null, zoom: null, queue: [], eq: {}, lights: ctx.scene.children.filter((o) => o.isLight), fov0: ctx.camera.fov, bones: [], base: [] };
  if (model?.getObjectByName('hero_cloak')) {
    const hero = S.hero = cloneSkinned(model);
    hero.visible = true; hero.position.set(...HERO_P); hero.rotation.set(0, 0, 0);
    hero.traverse((o) => { o.layers.enable(TH); if (/^Cloak_(B|L|R|FL|FR)\d/.test(o.name)) S.bones.push(o); });
    b.g.add(hero);
    S.mixer = new THREE.AnimationMixer(hero);
    clipsP ??= ctx.assets.gltf(ctx.params?.get?.('hero') || HERO, true).then((gl) => gl?.animations ?? []).catch(() => []);
    const me = S;
    clipsP.then((clips) => {
      if (S !== me) return;
      const act = (n) => { const c = clips.find((x) => x.name === n); return c && S.mixer.clipAction(c); };
      S.idle = act('idle'); S.sing = act('sing');
      S.idle?.play(); S.ready = S.t;
    });
  }
  for (const l of S.lights) l.layers.enable(TH);
  ctx.scene.add(b.g);
  ctx.registry.set('look.refresh', performance.now());
  const el = ctx.renderer.domElement;
  S.down = (e) => { if (e.target === el && S.mode === 'wardrobe') S.drag = e.clientX; };
  S.move = (e) => { if (S.drag != null) { S.turnTo += (e.clientX - S.drag) * 0.012; S.drag = e.clientX; S.dragT = S.t; } };
  S.up = () => { S.drag = null; };
  addEventListener('pointerdown', S.down); addEventListener('pointermove', S.move); addEventListener('pointerup', S.up);
  document.body.classList.add('loom-on');
  return S;
}

export function close() {
  if (!S) return;
  const { ctx, g, own } = S;
  removeEventListener('pointerdown', S.down); removeEventListener('pointermove', S.move); removeEventListener('pointerup', S.up);
  S.mixer?.stopAllAction(); S.mixer?.uncacheRoot(S.hero);
  S.hero?.traverse((o) => o.skeleton?.dispose()); // the clone's own bone textures
  g.removeFromParent();
  own.traverse((o) => { o.geometry?.dispose(); for (const m of [o.material].flat()) { m?.map?.dispose(); m?.dispose(); } if (o.isInstancedMesh) o.dispose(); }); // the hero clone shares the live model's geometry / materials: left alone
  S.rt?.dispose();
  for (const l of S.lights) l.layers.disable(TH);
  ctx.camera.clearViewOffset(); ctx.camera.fov = S.fov0; ctx.camera.updateProjectionMatrix();
  document.body.classList.remove('loom-on');
  S = null;
}
export const isOpen = () => !!S;
export const thumb = (id) => thumbs[id];

// preview a set on the plinth hero (the real shaders): eq = {pattern, tip, ...}
export function preview(eq, opt = {}) {
  if (!S) return;
  S.eq = { ...eq }; S.ctx.registry.set('cosmetic.equip', S.eq);
  S.trail = opt.trail ?? null; S.zoom = opt.zoom ?? null;
}
export function flourish() { if (S) { S.flourish = S.t; burst(V(HERO_P[0], 1.0, HERO_P[2]), 26, '#e9b85a', 1.5); } }
export function setState(st) { if (S) { S.pityTo = st.pity; S.dustTo = st.dust; } }
export function wantThumbs(items) { if (S) S.queue.push(...items.filter((i) => !thumbs[i.key] && !S.queue.some((q) => q.key === i.key))); } // [{key, eq, kind: 'pattern' | 'tip'}]

// ---- motes ----
function emit(o) { const p = S.parts[S.pi = (S.pi + 1) % NP]; Object.assign(p, { arc: null, vel: null, drop: 0, ...o, t0: S.t + (o.delay ?? 0) }); p.t1 = p.t0 + o.dur; }
function burst(at, n, col, sp = 1.2) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, u = Math.random() * 2 - 1, r = Math.sqrt(1 - u * u), k = sp * (0.4 + Math.random() * 0.6); emit({ from: at.clone(), vel: V(Math.cos(a) * r * k, u * k + 0.5, Math.sin(a) * r * k * 0.5), col, dur: 0.7 + Math.random() * 0.6, drop: 1.2 }); } }
function motes() {
  const P = S.pts.geometry.attributes.position, C = S.pts.geometry.attributes.color;
  S.parts.forEach((p, i) => {
    if (S.t >= p.t1 || S.t < p.t0 || !p.from) { P.setXYZ(i, 0, -1e4, 0); return; }
    const t = S.t - p.t0, k = t / (p.t1 - p.t0);
    if (p.arc) { const e = ease(k); _v.lerpVectors(p.from, p.arc, e); _v.y += Math.sin(e * Math.PI) * p.lift; _v.x += Math.sin(k * 9 + i) * 0.05 * (1 - k); } else _v.copy(p.from).addScaledVector(p.vel ?? _s.set(0, 0, 0), t).setY(p.from.y + (p.vel?.y ?? 0) * t - p.drop * t * t);
    P.setXYZ(i, _v.x, _v.y, _v.z);
    _c.set(p.col); C.setXYZ(i, _c.r, _c.g, _c.b);
  });
  P.needsUpdate = C.needsUpdate = true;
}

// ---- the pull ritual: r = loom.js pull() result; to = {pity, dust} fractions after it; done() when the piece is revealed ----
export function pull(r, to, done) {
  if (!S) return done?.();
  const leg = r.rarity === 'legendary', rare = r.rarity === 'rare';
  const tw = leg ? 3.0 : 2.5, dur = tw + (leg ? 1.7 : 0.9);
  S.piece.material.map?.dispose();
  S.piece.material.map = canvasTex(256, 256, (g, s) => drawItem(g, s, r.item)); S.piece.material.needsUpdate = true;
  S.pull = { r, to, done, t: 0, tw, dur, rows: leg ? S.NF : rare ? 17 : 9, col: new THREE.Color(RAR_COL[r.rarity]), fell: FELL0 + S.pity * TAP_H, fired: {}, pity0: S.pity, dusted: false };
  if (S.sing) { S.sing.reset().setLoop(THREE.LoopRepeat).fadeIn(0.25).play(); S.idle?.fadeOut(0.25); }
}
export function skip() { if (S?.pull && S.pull.t < S.pull.dur) { S.pull.skipped = true; S.pull.t = S.pull.dur; } }
export function endPull() { if (S?.pull) { S.pull = null; S.piece.visible = false; S.weft.count = 0; S.glow.material.opacity = 0; } }

function ritual(dt) {
  const P = S.pull, r = P.r, leg = r.rarity === 'legendary', rare = r.rarity === 'rare', t0 = P.t;
  P.t += dt;
  const t = P.t, k = Math.min(1, t / P.tw), fire = (id, at, name, gain, always) => { if (!P.fired[id] && t >= at) { P.fired[id] = 1; if (!P.skipped || always) S.cb.cue?.(name, gain); } };
  fire('hum', 0, 'hum', 0.55); fire('rune', 0.25, 'rune', 0.35);
  for (let i = 1; i < 8; i++) fire(`s${i}`, P.tw * (1 - Math.pow(1 - i / 8, 1.6)) * 0.96, 'cloth', 0.22);
  fire('snap', P.tw, 'tick', 0.9); fire('snap2', P.tw, 'wood', 0.7);
  fire('chord', P.tw + 0.12, leg ? 'gift' : rare ? 'echo_got' : 'chime', leg ? 0.8 : 0.6, true);
  // warp: colours run across the threads, then settle on the rarity's
  const settle = ease((k - 0.55) / 0.45), run = Math.floor(t * (6 + 14 * k));
  for (let i = 0; i < S.NW; i++) {
    _c.copy(CYCLE[(i + run) % CYCLE.length]).lerp(rare && i % 2 ? CYCLE[0] : P.col, settle * 0.8);
    if (t >= P.dur) _c.set('#f3e6c8').lerp(P.col, 0.25);
    S.warp.setColorAt(i, _c);
    S.warp.setMatrixAt(i, _m.makeTranslation(-0.98 + 1.96 * i / (S.NW - 1), 1.47, t < P.tw ? Math.sin(t * 22 + i * 1.7) * 0.012 * (i % 2 ? 1 : -1) : 0)); // the shed opening and closing
  }
  S.warp.instanceColor.needsUpdate = S.warp.instanceMatrix.needsUpdate = true;
  // weft rows laid by the shuttle, one pass each, faster and faster
  const prog = 1 - Math.pow(1 - k, 1.6), rowsF = prog * P.rows, n = Math.min(P.rows, Math.ceil(rowsF)), gone = ease((t - P.tw) / 0.35);
  S.weft.count = gone >= 1 ? 0 : n;
  for (let j = 0; j < n; j++) {
    const f = Math.min(1, rowsF - j), dir = j % 2 ? 1 : -1, y = P.fell + 0.02 + j * 0.034;
    S.weft.setMatrixAt(j, _m.compose(_v.set(dir * (1 - f) * -0.98, y, 0.03), _q.identity(), _s.set(f * (1 - gone), 1, 1)));
    S.weft.setColorAt(j, _c.copy(CYCLE[(j * 3 + (rare || leg ? run : 0)) % CYCLE.length]).lerp(P.col, (leg ? 0.75 : 0.45) * settle));
  }
  S.weft.instanceMatrix.needsUpdate = true; if (S.weft.instanceColor) S.weft.instanceColor.needsUpdate = true;
  const row = Math.min(P.rows - 1, Math.floor(rowsF)), ph = rowsF % 1;
  S.shuttle.position.set(t < P.tw ? (row % 2 ? 1 : -1) * (ph * 2 - 1) * -1.25 : 1.3, t < P.tw ? P.fell + 0.03 + row * 0.034 : FELL0 - 0.02, 0.09);
  S.heddle.position.y = 1.6 + (t < P.tw ? Math.sin(t * 22) * 0.05 : 0);
  // the frame: legendary gold from the wood itself
  S.wood.emissive.set('#f0b63c'); S.wood.emissiveIntensity = leg ? 0.75 * ease(k * 1.4) * (1 - 0.6 * ease((t - P.dur) / 1.5)) : rare ? 0.12 * settle * (1 - ease((t - P.dur) / 0.8)) : 0;
  S.halo.material.opacity = leg ? 0.75 * ease((k - 0.3) / 0.7) * (1 - 0.5 * ease((t - P.dur) / 1.5)) : 0; S.halo.scale.setScalar(5.5 + Math.sin(t * 3) * 0.3);
  // the snap: the piece leaves the loom
  if (t0 < P.tw && t >= P.tw) {
    const at = V(LOOM_X, P.fell + 0.2, 0.3);
    burst(at, leg ? 70 : rare ? 34 : 14, RAR_COL[r.rarity], leg ? 2.6 : 1.5);
    if (rare) burst(at, 16, '#e9b85a', 1.2);
    if (S.sing) { S.sing.fadeOut(0.5); S.idle?.reset().fadeIn(0.5).play(); }
    S.pityTo = leg ? 0 : P.to.pity;
  }
  if (t < P.tw && leg) S.pityTo = P.pity0 + (1 - P.pity0) * ease(k * 1.2); // the tapestry finishes itself in gold
  const rv = ease((t - P.tw) / (P.dur - P.tw - 0.15)), show = t >= P.tw && !P.gone;
  S.piece.visible = show;
  if (show) {
    const bobY = Math.sin(S.t * 1.8) * 0.03;
    S.piece.position.set(LOOM_X, P.fell + 0.2 + (1.7 - P.fell - 0.2) * rv + bobY, 0.12 + 1.5 * rv);
    S.piece.rotation.set(-0.06, (1 - rv) * (leg ? 12.566 : 6.283) + Math.sin(S.t * 1.1) * 0.12 - 0.12, 0);
    S.piece.scale.setScalar((0.25 + 1.3 * rv) * (P.dust != null ? 1 - ease((S.t - P.dust) / 0.9) : 1));
    S.glow.position.copy(S.piece.position).z -= 0.15;
    S.glow.material.color.set(RAR_COL[r.rarity]); S.glow.material.opacity = (leg ? 0.95 : rare ? 0.8 : 0.55) * rv * (P.dust != null ? 1 - ease((S.t - P.dust) / 0.9) : 1);
    S.glow.scale.setScalar((leg ? 4.2 : rare ? 3.2 : 2.6) * (0.6 + 0.4 * rv) + Math.sin(S.t * 4) * (leg ? 0.25 : 0.08));
    if ((leg || rare) && Math.random() < (leg ? 0.5 : 0.2)) emit({ from: S.piece.position.clone().add(_v.set((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.9, 0.05)), vel: V(0, 0.35, 0), col: leg ? '#fff1b8' : Math.random() < 0.5 ? '#f0b63c' : '#6fa3cf', dur: 0.8 });
  }
  if (t >= P.dur && !P.fired.done) {
    P.fired.done = 1; P.done?.();
    if (r.dupe) P.dust = S.t + 0.7; // a duplicate unravels into thread dust for the spindle
  }
  if (P.dust != null && S.t >= P.dust && !P.dusted) {
    P.dusted = true; S.cb.cue?.('rattle', 0.5);
    const to = V(SPIN_P[0], 0.9, SPIN_P[2]);
    for (let i = 0; i < 46; i++) emit({ from: S.piece.position.clone().add(_v.set((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.7, 0)), arc: to.clone().add(_v.set(0, (Math.random() - 0.5) * 0.3, 0)), lift: 0.5 + Math.random() * 0.5, col: ['#d9973a', EDGE[r.rarity], '#c2603e'][i % 3], delay: Math.random() * 0.9, dur: 1.0 + Math.random() * 0.4 });
  }
  if (P.dusted && S.t >= P.dust + 1.6 && !P.gone) { P.gone = true; S.dustTo = P.to.dust; S.cb.cue?.('tick', 0.5); }
}

// ---- thumbnails: the plinth hero through the real cloak / staff shaders, hero + lights only (layer TH), read back once per item ----
function shoot(q) {
  const { ctx, hero } = S, r = ctx.renderer, N = 128, scene = ctx.scene;
  S.rt ??= new THREE.WebGLRenderTarget(N, N, { samples: 4 });
  S.tcam ??= new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  const cam = S.tcam; cam.layers.set(TH);
  ctx.registry.set('cosmetic.equip', q.eq);
  const yaw0 = hero.rotation.y; hero.rotation.y = 0; hero.updateMatrixWorld(true);
  const base = hero.getWorldPosition(V());
  if (q.kind === 'tip') { const tip = staffTip(); cam.position.copy(tip).add(_v.set(0.05, 0.02, 0.62)); cam.lookAt(tip.x, tip.y - 0.045, tip.z); } else { cam.position.copy(base).add(_v.set(0.75, 0.95, -2.35)); cam.lookAt(base.x, base.y + 0.62, base.z); }
  const bg = scene.background, a = r.getClearAlpha(), col = r.getClearColor(new THREE.Color());
  scene.background = null; r.setClearColor(0x000000, 0); r.setRenderTarget(S.rt);
  r.render(scene, cam);
  const px = new Uint8Array(N * N * 4); r.readRenderTargetPixels(S.rt, 0, 0, N, N, px);
  r.setRenderTarget(null); scene.background = bg; r.setClearColor(col, a);
  hero.rotation.y = yaw0; ctx.registry.set('cosmetic.equip', S.eq);
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'), im = g.createImageData(N, N), lut = Array.from({ length: 256 }, (_, i) => Math.round(255 * Math.pow(i / 255, 1 / 2.2)));
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { // flip, un-premultiply, linear -> sRGB
    const s = ((N - 1 - y) * N + x) * 4, d = (y * N + x) * 4, al = px[s + 3] || 1;
    for (let k = 0; k < 3; k++) im.data[d + k] = lut[Math.min(255, Math.round(px[s + k] * 255 / al))];
    im.data[d + 3] = px[s + 3];
  }
  g.putImageData(im, 0, 0);
  thumbs[q.key] = c.toDataURL();
  S.cb.thumb?.(q.key, thumbs[q.key]);
}
function staffTip() { // world position of the staff's top (the R_Prop-skinned vertex furthest along the staff)
  const body = S.hero.getObjectByName('hero_body'), bone = body.skeleton.bones.findIndex((b) => /R_Prop/i.test(b.name)), g = body.geometry, P = g.attributes.position, I = g.attributes.skinIndex, W = g.attributes.skinWeight;
  if (S.tipI == null) {
    const bb = new THREE.Box3(), ids = [];
    for (let i = 0; i < P.count; i++) for (let c = 0; c < 4; c++) if (I.getComponent(i, c) === bone && W.getComponent(i, c) > 0.5) { bb.expandByPoint(_v.fromBufferAttribute(P, i)); ids.push(i); }
    const size = bb.getSize(V()), ax = size.x > size.y ? (size.x > size.z ? 'x' : 'z') : size.y > size.z ? 'y' : 'z';
    S.tipI = ids.reduce((best, i) => (P[`get${ax.toUpperCase()}`](i) > P[`get${ax.toUpperCase()}`](best) ? i : best), ids[0]);
  }
  body.skeleton.update();
  return body.getVertexPosition(S.tipI, V()).applyMatrix4(body.matrixWorld);
}

// ---- every rendered frame while open (meta.js beforeRender, after every other system wrote the camera) ----
export function frame() {
  if (!S) return;
  const { ctx, g } = S, now = performance.now() / 1000, dt = Math.min(0.05, now - S.now), cam = ctx.camera, ward = S.mode === 'wardrobe';
  S.now = now; S.t += dt;
  // hero: idle (or sing), the plinth turning; cloak flutter after an equip
  S.bones.forEach((b, i) => S.base[i] && b.quaternion.copy(S.base[i]));
  S.mixer?.update(dt);
  S.bones.forEach((b, i) => { (S.base[i] ??= new THREE.Quaternion()).copy(b.quaternion); });
  const fl = S.t - S.flourish;
  if (fl < 1.1) S.bones.forEach((b, i) => { b.rotateX(Math.sin(fl * 17 + i * 0.9) * 0.4 * (1 - fl / 1.1)); b.rotateZ(Math.cos(fl * 13 + i) * 0.22 * (1 - fl / 1.1)); });
  if (ward && S.drag == null && S.t - S.dragT > 2.5 && !S.zoom) S.turnTo += dt * 0.35;
  const want = ward ? S.turnTo : 0.95;
  S.turn += (want - S.turn) * Math.min(1, dt * 8);
  if (S.hero) { S.hero.rotation.y = S.turn; S.hero.position.y = HERO_P[1] + (fl < 0.5 ? Math.sin(fl / 0.5 * Math.PI) * 0.12 : 0); }
  S.ring.rotation.z = S.turn;
  // tapestry + spindle follow the save
  S.pity += (S.pityTo - S.pity) * Math.min(1, dt * 5); S.dust += (S.dustTo - S.dust) * Math.min(1, dt * 4);
  const f = Math.max(0.001, Math.min(1, S.pity));
  S.tap.scale.y = f; S.tap.visible = f > 0.01; S.tex.repeat.y = f;
  const d = Math.min(1, S.dust), w = 0.07 + 0.2 * d;
  S.bob.scale.set(w, 0.12 + 0.24 * d, w); S.bob.visible = d > 0.01; S.bob.material.color.set('#f3e6c8').lerp(_c.set('#e9b85a'), d >= 0.99 ? 0.8 + 0.2 * Math.sin(S.t * 4) : d * 0.3);
  if (S.pull) ritual(dt);
  else { S.shuttle.position.set(1.3, FELL0 - 0.02, 0.09); S.wood.emissiveIntensity = 0; S.halo.material.opacity = 0; }
  if (S.trail && Math.random() < 0.9) { const a = S.t * 3.2; emit({ from: V(HERO_P[0] + Math.cos(a) * 0.95, 0.75 + Math.sin(a * 0.5) * 0.35, HERO_P[2] + Math.sin(a) * 0.95), vel: V(0, 0.05, 0), col: S.trail, dur: 0.75 }); }
  motes();
  // camera: one shot per mode, eased; the principal point shifted right of the menu panel
  const shot = ward ? (S.zoom === 'tip' ? [[HERO_P[0] + 0.3, 1.9, HERO_P[2] + 3.0], [HERO_P[0] + 0.1, 1.55, HERO_P[2]]] : [[HERO_P[0], 1.25, HERO_P[2] + 4.3], [HERO_P[0], 0.98, HERO_P[2]]]) : [[0.8, 1.75, 8.6], [0.8, 1.3, 0]];
  S.cam ??= shot.map((p) => V(...p));
  S.cam.forEach((v, i) => v.lerp(_v.set(...shot[i]), Math.min(1, dt * 3.5)));
  g.updateMatrixWorld(true);
  cam.position.copy(S.cam[0]).applyMatrix4(g.matrixWorld); cam.lookAt(_v.copy(S.cam[1]).applyMatrix4(g.matrixWorld));
  const right = document.querySelector('.hud-panel')?.getBoundingClientRect().right ?? 0, W = innerWidth, H = innerHeight;
  if (cam.fov !== 42) cam.fov = 42;
  cam.setViewOffset(W, H, right < W * 0.62 ? -right / 2 : 0, 0, W, H);
  cam.updateMatrixWorld();
  if (S.queue.length && S.hero && S.ready != null && S.t - S.ready > 0.15) shoot(S.queue.shift());
}
