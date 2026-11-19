// Spring-bone cloth from <name>.cloth.json (architecture.md "Cloth"). No file or no rig -> no-op.
// Solved in beforeRender, after player.js has posed the skeleton for this frame, with the render-time dt (sim time
// interpolated by alpha), so head velocity/inertia come from what is on screen. Render-only: never touches the sim.
// json: params{group:{hz,damp,taper,sag,wind,inertia,drag,radius,hang,windRad}} (hang 0..1: rest dir bias to world down), chains{group:[[bone|{bone,tail}...]...]},
// colliders[{bone,to?,radius,length?}] (capsule from bone head to `to` head, or along bone +Y for `length` m).
// A chain entry given by name takes its tail from its child bone (the rig's *_end leaves).
// player.dash: one backward kick to every link's swing velocity (x link inertia) on the first frame at/after the dash, so the
// cloak whips back at once instead of waiting for the clamped head acceleration.
// Air: relative wind = level wind ('wind' x/z push, y updraft x UPDRAFT) + breeze x wind - the hero's own velocity (head velocity
// minus the wind push it rides on). Each link is pulled along it by windRad rad per m/s (equilibrium swing, capped AIR_MAX),
// with a per-link flutter so the hem ripples instead of sitting still (run ~6.5 m/s x 0.05 = ~19 deg; l2 crosswind 7.5 = ~0.37 rad).
// Out of breath (player.breath 0): the cloak goes limp, eased over ~0.3 s: hang -> LIMP.hang, air pull x (1 - LIMP.wind).
// Body motion reaches each link through its anchor: the link's rest tip carried rigidly by the chain root's parent (Spine02).
// Its velocity drives the air term and its acceleration the inertia term, so torso turns, strike twists, flips, rolls and the
// stride bob swing the hem (the bone head alone sits on the spine axis and barely moves when the body rotates).
// Updraft: the air under the hem rises at least lw.y x UPDRAFT, whatever the hero's own climb (it rides the same column).
// player.respawn: every link snaps back to rest (as on a > 2 m teleport).
import * as THREE from 'three';
import { DT } from '../core/engine.js';

const CLOTH = 'assets/characters/hero/hero.cloth.json'; // optional; ?cloth=<path> overrides
const DASH_KICK = 9; // rad/s per unit inertia, against the dash direction
const UPDRAFT = 0.3, AIR_MAX = 0.7, FLUTTER = 0.25; // m/s of air per m/s^2 updraft; rad; flutter depth (x swing)
const LEVEL_WIND = 0.55; // share of the level crosswind felt as air (7.5 m/s l2 lane -> ~0.37 rad swing at cloak windRad)
const LIMP = { hang: 0.6, wind: 0.7, rate: 3 }; // limp target hang, share of air pull removed, 1/s ease
const DOWN = new THREE.Vector3(0, -1, 0), SUB = 1 / 120, GRAV = new THREE.Vector3(0, -9.81, 0), ACC_MAX = 80, MAX_DEV = 0.75; // m/s^2 head accel clamp (landing/turn spikes); rad, max swing off rest
let links, capsules, model, renderT, dash, reg, limp;
const _air = new THREE.Vector3(), _q = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _a = new THREE.Vector3(), _b = new THREE.Vector3(), _v = new THREE.Vector3(), _w = new THREE.Vector3(), _f = new THREE.Vector3(), _s = new THREE.Vector3(), _acc = new THREE.Vector3(), _t = new THREE.Vector3(), _c = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3();

export default {
  name: 'cloth', order: 25, deps: ['player'],
  async init(ctx) {
    links = []; capsules = []; renderT = null; dash = null; reg = ctx.registry; limp = 0;
    ctx.registry.on('player.respawn', () => { for (const L of links) L.first = true; });
    ctx.registry.on('player.dash', ({ t, dir }) => { dash = { t, dir: new THREE.Vector3(dir[0], 0, dir[1]) }; });
    model = ctx.registry.get('player.model');
    const file = model && (await ctx.assets.json(ctx.params.get('cloth') || CLOTH, true));
    if (!file) return;
    model.updateMatrixWorld(true);
    const bone = (n) => model.getObjectByName(n) ?? (() => { throw new Error(`cloth bone '${n}' missing`); })();
    const k = model.getWorldScale(new THREE.Vector3()).x;
    let nChain = 0;
    for (const [name, chains] of Object.entries(file.chains)) {
      const P = file.params[name];
      for (const chain of chains) { const ci = nChain++, root = bone(chain[0].bone ?? chain[0]).parent; chain.forEach((l, i) => {
        const b = bone(l.bone ?? l), child = l.tail ? null : b.children.find((c) => c.isBone);
        const tail = l.tail ? new THREE.Vector3().fromArray(l.tail).divideScalar(b.getWorldScale(_s).x / k) : child.position.clone(); // bone-local
        const len = tail.length() * b.getWorldScale(_s).x;
        const w = 2 * Math.PI * P.hz * P.taper ** i;
        links.push({
          b, tail: tail.normalize(), len, restLocal: b.quaternion.clone(), radius: (P.radius ?? 0) * k,
          k: w * w, c: 2 * P.damp * w, first: true, sag: P.sag ?? 0, wind: P.wind ?? 0, inertia: P.inertia ?? 0, drag: P.drag ?? 0, hang: P.hang ?? 0, windRad: P.windRad ?? 0, cloak: name === 'cloak', phase: 0.9 * i + 1.3 * ci,
          dir: tail.clone().applyQuaternion(b.getWorldQuaternion(_q)), vel: new THREE.Vector3(),
          head: b.getWorldPosition(new THREE.Vector3()), headVel: new THREE.Vector3(),
          root, anchor: root.worldToLocal(b.localToWorld(tail.clone().multiplyScalar(len / b.getWorldScale(_s).x))), aPos: new THREE.Vector3(),
        });
      }); }
    }
    capsules = (file.colliders ?? []).map((c) => ({ b: bone(c.bone), to: c.to ? bone(c.to) : null, radius: c.radius * k, length: (c.length ?? 0) * k }));
  },
  beforeRender(ctx, alpha) {
    if (!links.length) return;
    const now = ctx.game.t - (1 - alpha) * DT, dt = renderT === null ? 0 : Math.min(now - renderT, 0.1);
    renderT = now;
    model.updateMatrixWorld(true);
    const windVec = _w.set(Math.sin(now * 1.3), 0, 0.5 * Math.cos(now * 0.7)); // breeze, m/s
    const lw = reg.get('wind');
    const kick = dt > 0 && dash && now >= dash.t ? dash.dir : null; // dt 0 integrates nothing: keep it for the next frame
    if (kick) dash = null;
    const floor = (reg.get('level')?.collide?.groundAt(model.position.x, model.position.z, model.position.y + 0.5)?.y ?? -Infinity) + 0.02; // one probe under the hero: the hem never sinks below it (crumple kneel)
    limp += ((reg.get('player')?.breath <= 0 ? 1 : 0) - limp) * (1 - Math.exp(-LIMP.rate * dt));
    for (const L of links) {
      const head = L.b.getWorldPosition(_a);
      L.b.parent.getWorldQuaternion(_pq);
      const target = _t.copy(L.tail).applyQuaternion(L.restLocal).applyQuaternion(_pq); // rest dir under parent's current rotation
      const hang = L.cloak ? L.hang + (LIMP.hang - L.hang) * limp : L.hang, windRad = L.cloak ? L.windRad * (1 - LIMP.wind * limp) : L.windRad;
      if (hang) target.lerp(DOWN, hang).normalize(); // hem hangs: torso lean must not lift it horizontal
      if (L.first || head.distanceTo(L.head) > 2) { // first frame or teleport (respawn): snap to rest
        L.first = false; L.dir.copy(target); L.vel.set(0, 0, 0); L.headVel.set(0, 0, 0); L.head.copy(head); L.root.localToWorld(L.aPos.copy(L.anchor));
      } else if (dt > 0) { // dt 0 (paused, re-render at same time): hold the current dir
        const ap = L.root.localToWorld(_e.copy(L.anchor)), newVel = _v.subVectors(ap, L.aPos).divideScalar(dt); // body-carried rest tip
        const accel = _acc.subVectors(newVel, L.headVel).divideScalar(dt).clampLength(0, ACC_MAX);
        L.headVel.copy(newVel); L.head.copy(head); L.aPos.copy(ap);
        if (kick) L.vel.addScaledVector(kick, -DASH_KICK * L.inertia);
        if (windRad) { // air pull: k x swing angle along the relative air
          _air.copy(windVec).multiplyScalar(L.wind).sub(L.headVel);
          if (lw) { _air.x += (1 + LEVEL_WIND) * lw.x; _air.z += (1 + LEVEL_WIND) * lw.z; if (lw.y > 0) _air.y = Math.max(_air.y, lw.y * UPDRAFT); } // wind (scaled) as air, once to cancel the push in headVel
          const m = _air.length(), th = THREE.MathUtils.clamp(m * windRad * (1 + FLUTTER * Math.sin(7 * now + L.phase)), 0, AIR_MAX);
          _air.multiplyScalar(m > 1e-6 ? (L.k * th) / m : 0);
        } else _air.copy(windVec).multiplyScalar(L.wind);
        for (let s = 0, n = Math.max(1, Math.round(dt / SUB)), h = dt / n; s < n; s++) {
          _f.subVectors(target, L.dir).multiplyScalar(L.k).addScaledVector(L.vel, -L.c)
            .addScaledVector(GRAV, L.sag).add(_air).addScaledVector(accel, -L.inertia).addScaledVector(L.headVel, -L.drag);
          L.vel.addScaledVector(_f, h);
          L.dir.addScaledVector(L.vel, h).normalize();
        }
        const ang = L.dir.angleTo(target); // cone limit: adjacent chains (one skin) tear if they diverge too far
        if (ang > MAX_DEV) { L.dir.lerp(target, 1 - MAX_DEV / ang).normalize(); L.vel.multiplyScalar(0.5); }
      }
      const tip = _b.copy(head).addScaledVector(L.dir, L.len);
      for (const C of capsules) { // push tip out of capsules
        const a = C.b.getWorldPosition(_c);
        let len = C.length;
        const axis = C.to ? C.to.getWorldPosition(_d).sub(a) : _d.set(0, 1, 0).applyQuaternion(C.b.getWorldQuaternion(_q)).multiplyScalar(len);
        len = axis.length(); axis.divideScalar(len || 1);
        const cp = a.addScaledVector(axis, THREE.MathUtils.clamp(_s.subVectors(tip, a).dot(axis), 0, len));
        const d = tip.distanceTo(cp), R = C.radius + L.radius;
        if (d < R && d > 1e-6) { tip.sub(cp).multiplyScalar(R / d).add(cp); L.dir.subVectors(tip, head).normalize(); L.vel.multiplyScalar(0.5); }
      }
      if (tip.y < floor && head.y > floor) { // ground clamp: swing the tip out along its heading until it rests on the floor
        const y = Math.max(-1, (floor - head.y) / L.len), hz = Math.hypot(L.dir.x, L.dir.z), w = Math.sqrt(1 - y * y);
        if (hz > 1e-6) L.dir.set(L.dir.x * w / hz, y, L.dir.z * w / hz); else L.dir.set(w, y, 0); if (L.vel.y < 0) L.vel.y = 0;
      }
      // rotate bone so its tail points along dir
      const worldQ = L.b.getWorldQuaternion(_q);
      const delta = new THREE.Quaternion().setFromUnitVectors(_s.copy(L.tail).applyQuaternion(worldQ), L.dir);
      L.b.quaternion.copy(_pq.invert().multiply(delta.multiply(worldQ)));
      L.b.updateMatrixWorld(true);
    }
  },
};
