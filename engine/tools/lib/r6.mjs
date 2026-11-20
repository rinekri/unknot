// R6 backtracking, shared by gen_l1..3: locks (a rune on a floating stone out past the rim, or a gap too wide), the reward islets
// they open (echo / tale / thread pickups, a request stone), and the level's shortcut rune. All of it is built on its own seeded
// stream (K.own) after the level's world and collider, so the play layout keeps its draws. Every lock is checked both ways here:
// out of reach without its gift (sing radius / Name / Gust reach / dash reach from every island rim), in reach with it.
// Usage: const R = makeR6(K, { world, collider, level, salt }); R.nameLock(...); R.dashLock(...); R.shortcut(...); R.finish();
import * as THREE from 'three';
import { PROP_BOX, RUNE, NAME, MAX_FRAC, r2, r2v, facing, dashReach, dash2Reach } from './kit.mjs';
import { NAME_R, NAME_R2, GUST_X2, LOCK_GUST, GUST_REACH } from '../../src/systems/songs.js';

const SING_R = 3, SING_DY = 2.5; // level.js: a rune is sung within 3 m (2D) and 2.5 m of height
const GUST = LOCK_GUST, GUST2 = GUST * GUST_X2; // lock runes hear the uncharged reach whatever the charge stage (level.js, songs.js pick)
const PIECE = 3.6; // bridge slab length: few slabs, few draw calls

export function makeR6(K, { world, collider, level, salt }) {
  const islets = [], floats = [], props = [];
  const rimPt = (s, th) => [s.x + Math.cos(th) * s.rim(th), s.z + Math.sin(th) * s.rim(th)];
  const play = () => Object.values(K.isl);
  // 2D distance from (x, z) to the walkable top of island s (0 inside)
  const rimDist = (s, x, z) => {
    const th = Math.atan2(z - s.z, x - s.x);
    if (Math.hypot(x - s.x, z - s.z) <= s.rim(th)) return 0;
    let d = Infinity;
    for (let i = 0; i < 180; i++) { const [px, pz] = rimPt(s, (i / 180) * Math.PI * 2); d = Math.min(d, Math.hypot(px - x, pz - z)); }
    return d;
  };
  const nearest = (x, z, skip = []) => Math.min(...play().filter((s) => !skip.includes(s.id)).map((s) => rimDist(s, x, z)), ...islets.filter((s) => !skip.includes(s.id)).map((s) => rimDist(s, x, z)));
  const lockOut = (id, msg) => { throw new Error(`R6 lock ${id}: ${msg}`); };

  // a bridge of slabs from island a's rim point (angle th) straight out over `len` m (rises from 7 m below, stays up)
  function bridge(id, a, th, len, rise = 0) {
    const [px, pz] = rimPt(a, th), ux = Math.cos(th), uz = Math.sin(th), n = Math.max(2, Math.ceil((len + 1.2) / PIECE)), L = (len + 1.2) / n;
    const pcs = Array.from({ length: n }, (_, i) => {
      const d = -0.6 + L * (i + 0.5), cx = px + ux * d, cz = pz + uz * d;
      return { name: `mech_${id}_${i}`, x: cx, z0: cz - L / 2 - 0.03, z1: cz + L / 2 + 0.03, w: 1.7, top: a.y + 0.03 + (rise * (i + 0.5)) / n, rotY: Math.atan2(ux, uz) };
    });
    K.pieces(world, collider, pcs, 0.6, 80 + islets.length * 5);
    return { id, kind: 'bridge', nodes: pcs.map((p) => p.name), offset: [0, -7, 0], dur: 1.0, stagger: 0.25 };
  }
  // the reward islet, gap m out from a's rim along th; pickups round its centre (echo slots; `relic` ones are tales / threads)
  function islet(id, a, th, gap, R, dy = 0) {
    const [px, pz] = rimPt(a, th);
    const s = K.island(id, 0, 0, a.y + dy, R, { depth: R * 1.4 });
    const back = s.rim(th + Math.PI);
    s.x = px + Math.cos(th) * (gap + back); s.z = pz + Math.sin(th) * (gap + back);
    islets.push(s);
    return s;
  }
  const pickups = (s, th, list) => list.map((p, i) => {
    const a = th + Math.PI / 2 + (i - (list.length - 1) / 2) * 1.6, rr = list.length > 1 ? 1.3 : 0;
    return { ...p, pos: r2v([s.x + Math.cos(a) * rr, s.y, s.z + Math.sin(a) * rr]) };
  });
  // a rune on a floating stone: off a's rim along th by `out` m, `side` m to the left, `up` m over a's top
  function floatRune(id, a, th, out, side, up) {
    const [px, pz] = rimPt(a, th), x = px + Math.cos(th) * out - Math.sin(th) * side, z = pz + Math.sin(th) * out + Math.cos(th) * side;
    floats.push(K.island(`${id}_stone`, x, z, a.y + up, 0.85, { depth: 1.1, wallDown: 0.6 }));
    const prop = { id, glb: RUNE, pos: [x, a.y + up, z], rotY: Math.atan2(px - x, pz - z) };
    props.push(prop);
    return prop;
  }
  const standAt = (a, th, inset) => { const [px, pz] = rimPt(a, th); return [px - Math.cos(th) * inset, pz - Math.sin(th) * inset]; };

  return {
    rimDist, standAt,
    // Name lock: the rune is out past every rim beyond the sing radius (and over the jump), within Name (or Name II) of the stand spot.
    // kind 'name' | 'name2' | 'gust2' (a dusty rune: Gust II bares it, then Name wakes it). Returns { mechanisms, stand, islet, rune, bridge }.
    nameLock({ id, from, th, out, side, up, gap, R = 3.2, kind = 'name', rewards = [] }) {
      const rune = floatRune(id, from, th, out, side, up), s = islet(`${id}_isl`, from, th, gap, R), br = bridge(`${id}_br`, from, th, gap);
      const stand = standAt(from, th, kind === 'gust2' ? 0.25 : 0.6), dStand = Math.hypot(rune.pos[0] - stand[0], rune.pos[2] - stand[1]);
      const free = nearest(rune.pos[0], rune.pos[2], [`${id}_isl`]), isletFree = nearest(s.x, s.z, [s.id]) - s.R;
      const reachName = kind === 'name2' ? NAME_R2 : NAME_R;
      if (free <= SING_R + 0.3 && up < SING_DY + 0.3) lockOut(id, `rune ${free.toFixed(2)} m from a rim: sung without a gift`);
      if (up <= 1.6 + 0.3 && free < 1.5) lockOut(id, 'rune stone in jump reach');
      if (kind === 'name2' && free <= NAME_R + 0.3) lockOut(id, `rune ${free.toFixed(2)} m: plain Name reaches it`);
      if (kind === 'gust2' && free <= GUST + 0.2) lockOut(id, `rune ${free.toFixed(2)} m: plain Gust (${GUST}) bares it`);
      if (kind === 'gust2' && dStand > GUST2 - 0.3) lockOut(id, `Gust II (${GUST2}) short of the rune (${dStand.toFixed(2)})`);
      if (dStand > reachName - 0.25) lockOut(id, `Name (${reachName}) short from the stand spot (${dStand.toFixed(2)})`);
      if (isletFree < 9.8) lockOut(id, `islet ${isletFree.toFixed(2)} m off: dash reach`);
      K.blocked.push({ from: from.id, to: s.id, lock: kind, rune: +free.toFixed(2), stand: +dStand.toFixed(2), gap: +isletFree.toFixed(2), needs: `${kind === 'gust2' ? 'Gust II + Name' : kind === 'name2' ? 'Name II' : 'Name'} -> ${br.id}` });
      return {
        stand: stand.map(r2), islet: s, rune, bridge: br, rewards: pickups(s, th, rewards),
        mechanisms: [{ id, kind: 'switch', node: id, pos: r2v(rune.pos), r: 2.0, targets: [br.id], once: true, far: true, ...(kind === 'gust2' ? { dust: true } : {}), lock: kind }, br],
      };
    },
    // Air-dash lock: an islet past one dash, inside two (both ways); a wind cairn on it for the way back.
    // dy < 0: the islet sits lower (at the same height the second burst comes as the fall reaches the top: no margin); the way back
    // is then a drop onward (the caller routes it). Locked = no island's rim within one dash (rise-aware), from's within two.
    dashLock({ id, from, th, gap, R = 3, dy = 0, rewards = [] }) {
      const s = islet(id, from, th, gap, R, dy);
      if (gap <= dashReach(dy) || gap > MAX_FRAC * dash2Reach(dy)) lockOut(id, `${gap} m vs one dash ${dashReach(dy).toFixed(2)} / two ${dash2Reach(dy).toFixed(2)}`); // off the route: not in the kit's gift order
      for (const o of [...play(), ...islets]) {
        const d = o === s ? Infinity : rimDist(o, s.x, s.z) - s.R + 0.3; // rimDist is to the islet's center; R is its noisy mean
        if (d < dashReach(s.y - o.y) + 0.3) lockOut(id, `${o.id} is ${d.toFixed(2)} m off: one dash (${dashReach(s.y - o.y).toFixed(2)}) reaches it`);
      }
      K.blocked.push({ from: from.id, to: s.id, lock: 'airdash', dist: +gap.toFixed(2), rise: dy, needs: 'airdash (two bursts)', frac: +(gap / dash2Reach(dy)).toFixed(2) });
      return { islet: s, rewards: pickups(s, th, rewards) };
    },
    // U25 Anchor lock: a row of crumble slabs off a's rim along th, gap m to a reward islet (beyond two dashes); each slab drops at a
    // touch (delay), the Anchor holds the whole row (level.js group freeze) for the run across. Returns { islet, stand, rewards, mechanisms }.
    anchorLock({ id, from, th, gap, R = 3, delay = 0.05, rewards = [] }) {
      const s = islet(`${id}_isl`, from, th, gap, R), isletFree = nearest(s.x, s.z, [s.id]) - s.R;
      if (isletFree < dash2Reach(0) + 0.3) lockOut(id, `islet ${isletFree.toFixed(2)} m off: two dashes reach it`);
      const [px, pz] = rimPt(from, th), ux = Math.cos(th), uz = Math.sin(th), n = Math.max(2, Math.ceil((gap + 1.2) / PIECE)), L = (gap + 1.2) / n;
      const pcs = Array.from({ length: n }, (_, i) => { const d = -0.6 + L * (i + 0.5), cx = px + ux * d, cz = pz + uz * d; return { name: `mech_${id}_${i}`, x: cx, z0: cz - L / 2, z1: cz + L / 2, w: 1.7, top: from.y + 0.03, rotY: Math.atan2(ux, uz) }; });
      K.pieces(world, collider, pcs, 0.5, 80 + islets.length * 5);
      K.blocked.push({ from: from.id, to: s.id, lock: 'anchor', gap: +isletFree.toFixed(2), needs: `Anchor (holds the ${id} crumble row, ${delay} s at a touch)` });
      return { islet: s, stand: standAt(from, th, 0.6).map(r2), rewards: pickups(s, th, rewards), mechanisms: pcs.map((p, i) => ({ id: `${id}_${i}`, kind: 'crumble', node: p.name, delay, respawn: 3, group: id })) };
    },
    // U25 gate rune (main path): a far rune on a floating stone off a's rim, out of the sing radius, within Name (dusty: and the
    // charged Gust, songs.js GUST_REACH[3]) of the rim spot facing it; its flag opens the way. Returns { rune, stand, mechanism }.
    gateRune({ id, from, th, out, side = 0, up = 2.4, dust = false, targets = [], after }) {
      const rune = floatRune(id, from, th, out, side, up), free = nearest(rune.pos[0], rune.pos[2]);
      const stand = standAt(from, Math.atan2(rune.pos[2] - from.z, rune.pos[0] - from.x), 0.5), d = Math.hypot(rune.pos[0] - stand[0], rune.pos[2] - stand[1]);
      if (free <= SING_R + 0.3) lockOut(id, `gate rune ${free.toFixed(2)} m from a rim: sung without Name`);
      if (d > NAME_R - 0.25) lockOut(id, `Name (${NAME_R}) short from the stand spot (${d.toFixed(2)})`);
      if (dust && d > GUST_REACH[3] - 0.3) lockOut(id, `the charged Gust (${GUST_REACH[3]}) short from the stand spot (${d.toFixed(2)})`);
      return { rune, stand: stand.map(r2), mechanism: { id, kind: 'switch', node: id, pos: r2v(rune.pos), r: 2.0, targets, once: true, far: true, ...(dust && { dust: true }), ...(after && { after }) } };
    },
    // a plain stepping stone (a way back down from a lock islet)
    stone(id, x, z, y, R = 1.6) { const s = K.island(id, x, z, y, R, { depth: R * 1.4 }); islets.push(s); return s; },
    // a stone (NAME mesh) on an islet, sung awake: a request answered (progress.js reads m.request)
    requestStone(id, s, th, request, mesh = 'name_b') {
      const x = s.x + Math.cos(th) * (s.R - 1.1), z = s.z + Math.sin(th) * (s.R - 1.1);
      const prop = { id, glb: NAME, mesh, pos: [x, s.y, z], rotY: Math.atan2(s.x - x, s.z - z), scale: 0.85 };
      props.push(prop);
      const spot = [x + (s.x - x) * 0.45, z + (s.z - z) * 0.45];
      return { prop, spot: spot.map(r2), mechanism: { id, kind: 'switch', node: id, pos: r2v(prop.pos), r: 2.0, targets: [], once: true, request } };
    },
    // Shortcut (U14): a rune on `upper`, out of singing reach from below, that keeps `targets` for good (level.js: a ride lift is
    // woken and called up to the singer, a timed bridge is pinned up). progress.js re-fires it on every later visit. Default spot:
    // beside the head of `lift` (a piece of the level, running along +z); `at` = [x, z] overrides it.
    shortcut({ lift, lower, upper, rise, side = 1, targets, once = true, at }) {
      let [rx, rz] = at ?? [];
      if (!at) {
        if (rise <= SING_DY) throw new Error('R6 shortcut: rune can be sung from below');
        const x = lift.x + side * (lift.w + 0.6); let z = upper.z; while (rimDist(upper, x, z - 0.05) === 0) z -= 0.05;
        rx = x + side * 1.9; rz = z + 1.9; // beside the lift's top end, on the upper island
        if (rimDist(upper, rx, rz) > 0) { rx = x + side * 0.6; rz = z + 2.9; }
      }
      if (rimDist(upper, rx, rz) > 0) throw new Error('R6 shortcut: rune spot off the upper island');
      if (lower && Math.max(0, rimDist(lower, rx, rz)) <= SING_R && upper.y - lower.y <= SING_DY) throw new Error('R6 shortcut: rune can be sung from the near side');
      const face = at ? [upper.x, upper.z] : [lift.x, rz - 3];
      const prop = { id: 'sc', glb: RUNE, pos: [rx, upper.y, rz], rotY: Math.atan2(face[0] - rx, face[1] - rz) };
      props.push(prop);
      const L = Math.hypot(face[0] - rx, face[1] - rz) || 1, spot = at ? [rx + ((face[0] - rx) / L) * 1.3, rz + ((face[1] - rz) / L) * 1.3] : [rx - side * 1.2, rz + 0.4];
      return { prop, spot: spot.map(r2), mechanisms: [{ id: 'sc', kind: 'switch', node: 'sc', pos: r2v(prop.pos), r: 2.0, targets, once, shortcut: true }] };
    },
    // meshes + colliders for the islets (walkable) and the rune stones (out of reach: no collider); props join level.props with a
    // collision box each (colliderBase already ran)
    finish() {
      K.islandMeshes(world, [...islets, ...floats], [], level.route); // middle-distance islets: off every island and route view
      for (const s of islets) for (const [i, g] of K.topAndWall(s).entries()) collider.add(K.mesh(i ? `r6_wall_${s.id}` : `r6_top_${s.id}`, g));
      for (const p of props) {
        const b = PROP_BOX[p.mesh ? `${p.glb}#${p.mesh}` : p.glb] ?? [0.6, 1, 0.6], k = p.scale ?? 1;
        collider.add(K.mesh(`r6_prop_${p.id}`, new THREE.BoxGeometry(b[0] * k, b[1] * k, b[2] * k).translate((b[3] ?? 0) * k, (b[1] * k) / 2, (b[4] ?? 0) * k).rotateY(p.rotY).translate(...p.pos)));
        level.props.push({ ...p, pos: p.pos.map(r2), rotY: +p.rotY.toFixed(4) });
      }
    },
    facing,
  };
}
