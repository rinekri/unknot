// Triangle-soup collision for levels without a physics lib: static tris hashed in a 2 m XZ grid,
// plus kinematic bodies (moving platforms) tested brute force.
import * as THREE from 'three';

const CELL = 2, AIR_LIFT = 0.05;
const _v = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3(), _p = new THREE.Vector3(), _q = new THREE.Vector3(), _s = new THREE.Vector3();

// meshes: [{mesh, kill}] -> tris with matrixOf(mesh) applied
function meshTris(meshes, matrixOf) {
  const out = [];
  for (const { mesh, kill } of meshes) {
    const pos = mesh.geometry.attributes.position, idx = mesh.geometry.index, M = matrixOf(mesh);
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const v = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(pos, idx ? idx.getX(i + j) : i + j).applyMatrix4(M));
      const n = new THREE.Vector3().subVectors(v[1], v[0]).cross(_v.subVectors(v[2], v[0]));
      if (n.lengthSq() < 1e-12) continue;
      out.push({ a: v[0], b: v[1], c: v[2], n: n.normalize(), kind: kill ? 'kill' : 'solid', body: null, name: mesh.name });
    }
  }
  return out;
}

// Collect meshes under root; skip(node) prunes a subtree; kill_* names mark kill surfaces.
function collect(root, skip = () => false) {
  const out = [];
  const walk = (n, kill) => {
    if (n !== root && skip(n)) return;
    kill ||= /^kill_/.test(n.name);
    if (n.isMesh) out.push({ mesh: n, kill });
    n.children.forEach((c) => walk(c, kill));
  };
  root.updateMatrixWorld(true);
  walk(root, false);
  return out;
}

// Ericson, Real-Time Collision Detection 5.1.5
function closestOnTri(p, t, out) {
  const { a, b, c } = t;
  const ab = _e1.subVectors(b, a), ac = _e2.subVectors(c, a), ap = _p.subVectors(p, a);
  const d1 = ab.dot(ap), d2 = ac.dot(ap);
  if (d1 <= 0 && d2 <= 0) return out.copy(a);
  const bp = _q.subVectors(p, b), d3 = ab.dot(bp), d4 = ac.dot(bp);
  if (d3 >= 0 && d4 <= d3) return out.copy(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) return out.copy(a).addScaledVector(ab, d1 / (d1 - d3));
  const cp = _s.subVectors(p, c), d5 = ab.dot(cp), d6 = ac.dot(cp);
  if (d6 >= 0 && d5 <= d6) return out.copy(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) return out.copy(a).addScaledVector(ac, d2 / (d2 - d6));
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) return out.copy(b).addScaledVector(_v.subVectors(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)));
  const den = 1 / (va + vb + vc);
  return out.copy(a).addScaledVector(ab, vb * den).addScaledVector(ac, vc * den);
}

// Möller–Trumbore, two-sided. Returns distance or -1.
function rayTri(o, d, t) {
  const e1 = _e1.subVectors(t.b, t.a), e2 = _e2.subVectors(t.c, t.a), p = _p.crossVectors(d, e2);
  const det = e1.dot(p);
  if (Math.abs(det) < 1e-9) return -1;
  const inv = 1 / det, s = _s.subVectors(o, t.a), u = s.dot(p) * inv;
  if (u < 0 || u > 1) return -1;
  const q = _q.crossVectors(s, e1), v = d.dot(q) * inv;
  if (v < 0 || u + v > 1) return -1;
  return e2.dot(q) * inv;
}

// Footstep surface: island tops grass; prop boxes (collider.glb 'wall_props': rubble, stairs, arches) rubble; mechanism bodies by
// node name: crumbling slabs rubble, wood/plank/stake wood, Kamen's back stone, other moving slabs (lifts, bridges) slab.
export const surfaceOf = (g) => {
  if (!g) return 'grass';
  if (!g.body) return g.name === 'wall_props' ? 'rubble' : 'grass';
  const n = g.body.node?.name ?? '';
  return /crumble/.test(n) ? 'rubble' : /wood|plank|stake/.test(n) ? 'wood' : /golem/.test(n) ? 'stone' : 'slab';
};

export function createCollision({ maxSlopeDeg = 50 } = {}) {
  const cells = new Map();
  const bodies = [];
  const walkCos = Math.cos((maxSlopeDeg * Math.PI) / 180);

  function candidates(x0, z0, x1, z1) {
    const set = new Set();
    for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++)
      for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++)
        cells.get(`${ix},${iz}`)?.forEach((t) => set.add(t));
    for (const b of bodies) if (b.enabled) b.tris.forEach((t) => set.add(t));
    return set;
  }

  function raycast(o, d, max, skip) { // skip: a mesh name the ray passes through (camera.js: decor boxes)
    const end = _v.copy(o).addScaledVector(d, max);
    let best = null;
    for (const t of candidates(Math.min(o.x, end.x), Math.min(o.z, end.z), Math.max(o.x, end.x), Math.max(o.z, end.z))) {
      if (skip && t.name === skip) continue;
      const dist = rayTri(o, d, t);
      if (dist >= 0 && dist <= max && (!best || dist < best.dist)) best = { dist, tri: t };
    }
    return best && { dist: best.dist, point: o.clone().addScaledVector(d, best.dist), normal: best.tri.n, kind: best.tri.kind, body: best.tri.body };
  }

  const down = new THREE.Vector3(0, -1, 0), _o = new THREE.Vector3();
  // Highest upward-facing surface below (x, yHint, z).
  function groundAt(x, z, yHint) {
    _o.set(x, yHint, z);
    let best = null;
    for (const t of candidates(x, z, x, z)) {
      if (t.n.y <= 0) continue;
      const d = rayTri(_o, down, t);
      if (d >= 0 && (!best || d < best.d)) best = { d, t };
    }
    return best && { y: yHint - best.d, normal: best.t.n, kind: best.t.kind, body: best.t.body, name: best.t.name };
  }

  return {
    walkCos,
    addStatic(root, skip) {
      const tris = meshTris(collect(root, skip), (m) => m.matrixWorld);
      for (const t of tris) {
        const x0 = Math.min(t.a.x, t.b.x, t.c.x), x1 = Math.max(t.a.x, t.b.x, t.c.x), z0 = Math.min(t.a.z, t.b.z, t.c.z), z1 = Math.max(t.a.z, t.b.z, t.c.z);
        for (let ix = Math.floor(x0 / CELL); ix <= Math.floor(x1 / CELL); ix++)
          for (let iz = Math.floor(z0 / CELL); iz <= Math.floor(z1 / CELL); iz++) {
            const k = `${ix},${iz}`;
            if (!cells.has(k)) cells.set(k, []);
            cells.get(k).push(t);
          }
      }
      return tris.length;
    },
    // Kinematic body: move `node`, then call update(); riders call carry(p) to follow.
    addBody(node) {
      const meshes = collect(node);
      const inv = node.matrixWorld.clone().invert();
      const local = meshTris(meshes, (m) => inv.clone().multiply(m.matrixWorld));
      const body = {
        node, enabled: true, tris: [], prev: node.matrixWorld.clone(), delta: new THREE.Matrix4(),
        update() {
          node.updateMatrixWorld(true);
          body.delta.copy(node.matrixWorld).multiply(body.prev.clone().invert());
          body.prev.copy(node.matrixWorld);
          body.tris = local.map((t) => ({ a: t.a.clone().applyMatrix4(node.matrixWorld), b: t.b.clone().applyMatrix4(node.matrixWorld), c: t.c.clone().applyMatrix4(node.matrixWorld), n: t.n.clone().transformDirection(node.matrixWorld), kind: t.kind, name: t.name, body }));
        },
        carry(p) { return p.applyMatrix4(body.delta); },
      };
      body.update();
      body.delta.identity();
      bodies.push(body);
      return body;
    },
    raycast,
    groundAt,
    // Spheres at lift+r, mid, h-r; walkable tris are left to groundAt. `lift` is the step-up height and only applies while
    // grounded (ground within 8 cm of the feet): airborne, the lowest sphere sits at AIR_LIFT so low props block instead of
    // being climbed. Up to 3 contact planes are resolved per sub-step; `vel` (optional) is projected against each plane
    // (x/z, plus y on a ceiling). Returns {pos, hitNormal (last plane), hitNormals}.
    sweepCapsule(from, to, r, h, lift = 0, vel = null) {
      const g0 = groundAt(from.x, from.z, from.y + 0.1);
      if (!(g0 && g0.y >= from.y - 0.08)) lift = Math.min(lift, AIR_LIFT);
      const pos = from.clone(), step = _o.subVectors(to, from), n = Math.max(1, Math.ceil(step.length() / (r * 0.6)));
      step.divideScalar(n);
      const lo = lift + r, hi = Math.max(lo, h - r), cp = new THREE.Vector3(), c = new THREE.Vector3();
      const hitNormals = [];
      for (let i = 0; i < n; i++) {
        pos.add(step);
        for (let iter = 0; iter < 3; iter++) {
          let hit = false;
          for (const hy of [lo, (lo + hi) / 2, hi]) {
            c.set(pos.x, pos.y + hy, pos.z);
            for (const t of candidates(c.x - r, c.z - r, c.x + r, c.z + r)) {
              if (t.n.y > walkCos) continue;
              const d = closestOnTri(c, t, cp).distanceTo(c);
              if (d >= r) continue;
              const nrm = d > 1e-6 ? cp.subVectors(c, cp).divideScalar(d) : cp.copy(t.n);
              // Edge contacts on a ledge just above the step height give a near-vertical push that the ground snap undoes each
              // step (the player wedges on the edge). Walls push sideways only; floors are groundAt's job, ceilings keep y.
              if (nrm.y > 0) { const hl = Math.hypot(nrm.x, nrm.z); if (hl < 1e-3) continue; nrm.set(nrm.x / hl, 0, nrm.z / hl); }
              pos.addScaledVector(nrm, r - d);
              c.addScaledVector(nrm, r - d);
              hit = true;
              if (!hitNormals.some((q) => q.dot(nrm) > 0.98)) hitNormals.push(nrm.clone());
            }
          }
          if (!hit) break;
        }
      }
      if (vel) for (const q of hitNormals) {
        const into = vel.x * q.x + vel.z * q.z;
        if (into < 0) { vel.x -= q.x * into; vel.z -= q.z * into; }
        if (q.y < -0.5 && vel.y > 0) vel.y = 0;
      }
      return { pos, hitNormal: hitNormals.at(-1) ?? null, hitNormals };
    },
  };
}
