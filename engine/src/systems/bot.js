// Bot: follows level.route (Catmull-Rom Hermite), steers 1.5 m ahead, jogs, runs up to edges, jumps gaps within reach.
// Writes registry 'input' while 'bot.enabled'. Log: 'bot.log' = [{t, event, detail}] (breath: every whole segment gained/lost).
// level.actions = [{at:[x,z], r, do:'strike', switch, until}]: at the spot, stop, face the switch, strike until flag `until`.
// {at:[x,z], r, do:'dash', air?, minY?}: within r of the spot, dash along the route once (air: jump the gap ahead with dash reach and
// dash at the apex; air 2: a second burst once the cooldown is over; minY: no jump, the first burst at the apex once airborne at
// y >= minY, e.g. lifted by an updraft; inside r it steers by the route). Actions run in list order; a dash action is done once fired (re-armed by a fall
// before the next checkpoint). A strike action may name a breakable (level.js)
// with until 'switch.<id>' (set when it breaks). {at, r, do:'wait', until, ride}: stand still at the spot until flag `until` (or until: 'breath': breath full, at a wind spring) (a lift
// docked: bottom.<id> / top.<id>, level.js); {.., wind: id, lead}: stand there until that cycling wind
// has been on for less than lead s (default 0.3). A strike or wait action is done once its flag is seen (later flips do not re-arm it). Log events: fall, trigger, checkpoint, wind, breath, stuck,
// hit (what a strike press reached, null = miss), dash, break, talk, gift (npc.js), sing (sing.done: id, ok, wrong), goal/timeout, and a final
// 'summary' (per-section time, falls, lowest breath (99: none logged), switches woken, wrong notes; totals).
// {at, r, do:'sing', switch, until}: at the spot, stop, face the switch, hold sing until level.js answers ('sing.done' for it) or `until`
// is set; done on its answer (a wrong note too). {at:[x,z], r, do:'go', drop?, leap?, home?, y?}: walk to the spot (a wander, or a walk off the edge with
// drop: no jumps), done within r or on a fall. Profiles (?profile=worst|mid|best, default mid): an action with `profiles: [...]` runs only
// for those; the level data decides what each profile does extra (best: echoes; worst: wrong notes, early optional switches, wanders,
// void falls). {at, r, do:'song', song:'gust'|'name'|'anchor', face?:[x,z], y?}: at the spot, grounded, stop, face `face` (or the switch, or
// along the route) and play the song as a hold-to-charge cast (songs.js, songSpans below): held act.hold s, else gust 1.55 (stage 3),
// anchor 0.95 (stage 2), name a tap; worst holds its first gust past OVER (it tears). 'song.fail' retries; done on 'song.done' for it or
// a fizzle (no breath). Logs 'song' {song, id, wasted}, 'songfail' {song, why} and 'fizzle' {song}; the summary counts them.
// {at, r, do:'fight', enemy, stun?, y?}: inside r, the scripted counter for that shard (enemies.js): a squall is Gusted on its
// telegraph (worst: too early first), a warden / the boss's ram phase is struck (3 hits), the boss's rings are jumped; unbindable:
// Name it. Done when the shard is free (stun: once stunned when Name is not gifted yet). Logs 'knock' / 'unbind'; the summary
// counts knocks and deaths (a fall within 3 s of a knock) per enemy.
// R4/R5/R9: {.., do:'fight', shatter: true}: strike the stunned shard 3x instead of Naming it (a mistake: broken.<id>).
// {at, r, do:'airstrike', face?, until?}: grounded inside r, jump in place and strike at the apex (retried on landing until `until`).
// {at, r, do:'airsong', song, face, charge?}: grounded inside r, jump and play the song at the apex (gust: an air recoil away from face).
// {at, r, do:'pogo', n}: over the gap ahead: jump the edge anyway, then down+strike over each bell / shard below; done after n bounces
// or a landing. {.., do:'song', song:'anchor', slab: id}: wait for the slab to lower, press as its top passes slab.stop (trials.js).
// Every profile but worst rolls a >= 7 m drop (a strike press just before touchdown). Log: landing {h, kind}, fray, bounce, bell.
// R6: profile 'revisit' runs best's actions plus its own (the locks, with every gift: ?gifts=all&save=all); a dash may carry `to: [x, z]`.
import * as THREE from 'three';
import { jumpReach, dashReach, dash2Reach } from './player.js';
import { pick, OVER } from './songs.js';

const LOOKAHEAD = 1.5, STUCK_S = 3, RUNUP = 2.5; // m of run-up before an edge: jog -> run takes ~0.7 m; longer burns breath (player.js) for nothing
let pts, idx, log, best, bestT, bestY, holding, rescan, actions, struck, cpT, doneT, profile, knockAt, rolled;

export default {
  name: 'bot', order: 15, deps: ['level', 'player'], // after level (route), before player (reads input)
  init(ctx) {
    const reg = ctx.registry, route = reg.get('level')?.data.route ?? [];
    log = []; idx = 0; best = 0; bestT = 0; bestY = -Infinity; holding = false; rescan = true; struck = false; cpT = 0; doneT = -1e9; knockAt = null;
    const lvl = reg.get('level')?.data;
    profile = ctx.params.get('profile') ?? 'mid';
    reg.set('bot.profile', profile);
    actions = (lvl?.actions ?? []).filter((a) => !a.profiles || a.profiles.includes(profile) || (profile === 'revisit' && a.profiles.includes('best'))).map((a) => ({ ...a, target: lvl.mechanisms?.find((m) => m.id === a.switch)?.pos ?? a.target, cyc: lvl.mechanisms?.find((m) => m.id === a.wind)?.cycle })); // R6 revisit: best's detours + the lock actions
    reg.set('bot.log', log);
    const curve = route.length > 1 ? new THREE.CatmullRomCurve3(route.map((w) => new THREE.Vector3(w[0], w[1], w[2])), false, 'catmullrom', 0.5) : null;
    pts = curve ? curve.getSpacedPoints(Math.ceil(curve.getLength() / 0.25)) : [];
    const add = (event, detail) => log.push({ t: +ctx.game.t.toFixed(3), event, detail });
    reg.on('player.fall', (f) => { // a dash fired since the last checkpoint is retried from it
      add('fall', { ...f, enemy: knockAt && ctx.game.t - knockAt.t < 3 ? knockAt.id : undefined }); knockAt = null;
      for (const a of actions) a.seq = null; rescan = true; best = 0; bestY = -Infinity; bestT = ctx.game.t;
      for (const a of actions) if (a.do === 'go' && !a.done && Math.hypot(f.pos?.[0] - a.at[0], f.pos?.[2] - a.at[1]) < 20) a.done = true; // a wander / drop ends in the void
      for (const a of actions) if (a.do === 'dash' && (a.armed || a.aim || a.firedT > cpT)) { a.done = false; a.armed = false; a.aim = false; a.shots = 0; }
      for (const a of actions) if (a.do === 'sing' && a.until && a.doneAt > cpT) a.done = false; // a timed bridge sinks on respawn: sing it again
      for (const a of actions) if (a.do === 'song' && a.song === 'anchor' && a.doneAt > cpT) { a.done = false; a.pressedT = undefined; } // the hold was spent on the fall: sing it again
    });
    reg.on('trigger', (tr) => add('trigger', tr.id));
    reg.on('checkpoint', (c) => { add('checkpoint', c.id); cpT = ctx.game.t; });
    reg.on('wind.exit', (w) => add('wind', w));
    reg.on('strike.target', (h) => add('hit', h.id)); // after each strike press: the switch/wall it reached, null = miss
    reg.on('song.reject', (d) => { add('reject', { id: d.id }); for (const x of actions) if (x.do === 'sing' && x.switch === d.id && !x.until) x.done = rescan = true; }); // a rune still bound by its order: the whirl shoved him back, move on
    reg.on('drop.pick', (d) => add('drop', { kind: d.kind, id: d.id }));
    reg.on('sing.done', (d) => { add('sing', { id: d.id, ok: d.ok, wrong: d.wrong }); doneT = ctx.game.t; for (const a of actions) if (a.do === 'sing' && a.switch === d.id && (d.ok || d.wrong) && !a.until) a.done = true; });
    const songDone = (s) => { const a = actions.find((x) => !x.done); if (a?.do === 'fight') a.seq = null; else if ((a?.do === 'song' || a?.do === 'airsong') && a.song === s) { a.done = true; a.doneAt = ctx.game.t; a.seq = null; } };
    reg.on('song.done', (d) => { add('song', { song: d.song, id: d.id, wasted: !d.id }); songDone(d.song); });
    reg.on('song.fail', (d) => { add('songfail', { song: d.song, why: d.why }); const a = actions.find((x) => !x.done); if (a?.seq) { a.seq = null; a.tries = (a.tries ?? 0) + 1; a.pressedT = ctx.game.t; } });
    reg.on('enemy.knock', (k) => { add('knock', k.id); knockAt = { t: ctx.game.t, id: k.id }; });
    reg.on('enemy.unbind', (u) => add('unbind', u.id));
    reg.on('player.puff', (e) => { if (e.song) { add('fizzle', { song: e.song }); songDone(e.song); } });
    reg.on('break', (b) => add('break', { id: b.id, by: b.by }));
    reg.on('talk', (k) => add('talk', { id: k.id, npc: k.npc })); // npc.js: a dialogue started
    reg.on('echo', (e) => add('echo', e.id)); // echo.js: an echo counted
    reg.on('gift', (g) => add('gift', { id: g.id, npc: g.npc })); // npc.js: an NPC gift (dash / windbreath / airdash)
    reg.on('end', (e) => { // + 'summary': per-section times (spawn -> checkpoint -> ... -> end) with their falls, totals
      add(e, null);
      const n = (ev, f = () => true) => log.filter((l) => l.event === ev && f(l)).length, sections = [];
      let from = { id: 'spawn', t: 0 };
      for (const c of [...log.filter((l) => l.event === 'checkpoint'), { t: +ctx.game.t.toFixed(3), detail: e }]) {
        const inS = (l) => l.t > from.t && l.t <= c.t;
        sections.push({ from: from.id, to: c.detail, s: +(c.t - from.t).toFixed(2), falls: n('fall', inS), breath: Math.min(...log.filter((l) => l.event === 'breath' && inS(l)).map((l) => l.detail.b), 99),
          switches: n('sing', (l) => inS(l) && l.detail.ok), wrong: n('sing', (l) => inS(l) && l.detail.wrong), songs: n('song', inS), wasted: n('song', (l) => inS(l) && l.detail.wasted), fizzles: n('fizzle', inS) });
        from = { id: c.detail, t: c.t };
      }
      add('summary', { profile: reg.get('bot.profile'), sections, landings: Object.fromEntries(['hard', 'stagger', 'roll', 'fray'].map((k) => [k, n('landing', (l) => l.detail.kind === k)])), frays: n('fray'), broken: Object.keys(reg.get('flags') ?? {}).filter((k) => k.startsWith('broken.') && reg.get('flags')[k]), falls: n('fall'), switches: n('sing', (l) => l.detail.ok), wrong: n('sing', (l) => l.detail.wrong), echoes: n('echo'), songs: n('song'), wasted: n('song', (l) => l.detail.wasted), fizzles: n('fizzle'), dashes: n('dash'), strikes: { hit: n('hit', (l) => l.detail), miss: n('hit', (l) => !l.detail) }, breaks: n('break'), stuck: n('stuck'), songfails: n('songfail'),
        enemies: Object.fromEntries((reg.get('enemies') ?? []).map((x) => [x.id, { knocks: n('knock', (l) => l.detail === x.id), deaths: n('fall', (l) => l.detail?.enemy === x.id), freed: n('unbind', (l) => l.detail === x.id) }])) });
    });
    reg.on('player.breath', (b) => add('breath', { b: b.b, why: b.why }));
    reg.on('player.landing', (l) => add('landing', { h: l.h, kind: l.kind }));
    reg.on('player.fray', (f) => add('fray', { max: f.max }));
    reg.on('player.bounce', (b) => { add('bounce', b.hit); const a = actions.find((x) => !x.done); if (a?.do === 'pogo') a.bounces = (a.bounces ?? 0) + 1; });
    reg.on('trial.bell', (b) => add('bell', b.id));
    reg.on('break', (e) => { if (e.by === 'shatter') add('shatter', e.id); });
    rolled = false;
  },
  update(ctx) {
    const reg = ctx.registry, p = reg.get('player'), collide = reg.get('level')?.collide;
    if (!reg.get('bot.enabled') || !p || !collide || !pts.length) return;
    if (reg.get('end')) return reg.set('input', { move: [0, 0], jump: false, run: false });

    // progress = nearest route sample, searched forward from the last one
    let bestD = Infinity;
    const prev = idx, [i0, i1] = rescan ? [0, pts.length] : [Math.max(0, idx - 4), Math.min(pts.length, idx + 40)];
    const dy = rescan ? 1 : 0, dist = (i) => Math.hypot(pts[i].x - p.pos.x, pts[i].z - p.pos.z, (pts[i].y - p.pos.y) * dy); // a full rescan (spawn, respawn) also weighs height: stacked islands share x/z
    for (let i = i0; i < i1; i++) { const d = dist(i); if (d < bestD) { bestD = d; idx = i; } }
    // out-and-back detours pass a spot twice: on a respawn keep the earlier (outbound) leg on near-ties; otherwise a 2+ m skip
    // (onto the other leg) loses to a near-tie within 2 m of the last sample (steady creep is left alone: it would lag the target)
    if (rescan) { for (let i = 0; i < idx; i++) if (dist(i) <= bestD + 1) { idx = i; break; } }
    else if (Math.abs(idx - prev) > 8) { let bd = bestD + 0.3; for (let i = Math.max(0, prev - 8); i <= Math.min(pts.length - 1, prev + 8); i++) if (dist(i) <= bd) { bd = dist(i); idx = i; } }
    rescan = false;
    if (idx > best + 2 || p.pos.y > bestY + 1) { best = Math.max(best, idx); bestY = p.pos.y; bestT = ctx.game.t; } // climbing (an updraft ride) is progress too
    else if (ctx.game.t - bestT > STUCK_S) { log.push({ t: +ctx.game.t.toFixed(3), event: 'stuck', detail: { idx, pos: p.pos.toArray() } }); bestT = ctx.game.t; }

    // R9 roll: every profile but worst presses strike just before a >= 7 m touchdown (player.js turns it into a roll)
    if (p.grounded) rolled = false;
    else if (!rolled && profile !== 'worst' && p.vel.y < 0) {
      const g = collide.groundAt(p.pos.x, p.pos.z, p.pos.y);
      if (g && p.apex - g.y >= p.tuning.fall.stagger && (p.pos.y - g.y) / -p.vel.y <= p.tuning.fall.roll - 0.04) { rolled = true; return reg.set('input', { ...(reg.get('input') ?? { move: [0, 0] }), strike: true, dash: false, jump: false }); }
    }
    const flags = reg.get('flags') ?? {};
    for (const a of actions) if (!a.done && a.until && (flags[a.until] || a.until === 'breath' && p.breath >= p.breathMax - 0.01) && (a.do !== 'wait' && a.do !== 'sing' || a.ride || Math.hypot(p.pos.x - a.at[0], p.pos.z - a.at[1]) <= a.r)) { a.done = true; a.doneAt = ctx.game.t; }
    else if (a.cyc && !a.done && p.grounded && Math.hypot(p.pos.x - a.at[0], p.pos.z - a.at[1]) <= a.r && ctx.game.t % (a.cyc[0] + a.cyc[1] + a.cyc[2]) < (a.lead ?? 0.3)) a.done = true; // wind: a cycling wind just came on
    const act = actions.find((a) => !a.done);
    const tgt = pts[Math.min(pts.length - 1, idx + Math.round(LOOKAHEAD / 0.25))];
    const homing = act?.do === 'go' && (act.home == null || Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) < act.home && (act.y == null || Math.abs(p.pos.y - act.y) < (p.grounded ? 1 : 1.6))) || act && !act.armed && !(act.do === 'dash' && Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r) && Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) < (act.home ?? 3) && (act.y == null || Math.abs(p.pos.y - act.y) < (p.grounded ? 1 : 1.6)); // close to an action spot (act.home m, default 3; on its level act.y when given): steer straight at it
    // a freed squall's updraft between the hero and a rune he walks straight at: wait it out (it threw the revisit bot off E on l1)
    if (homing && act.do === 'sing' && p.grounded && (reg.get('enemies') ?? []).some((e) => e.state === 'puff' && Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < 3)) { bestT = ctx.game.t; return reg.set('input', { move: [0, 0], jump: false, run: false }); }
    if (act?.do === 'dash' && act.to && Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r) act.aim = true; // R6: an off-route dash, once at its spot, runs at `to` until fired
    const to = (act?.do === 'dash' || act?.do === 'pogo') && act.to && (act.armed || act.leapt || act.aim) ? act.to : null;
    let dx = (to ? to[0] : homing ? act.at[0] : tgt.x) - p.pos.x, dz = (to ? to[1] : homing ? act.at[1] : tgt.z) - p.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;

    const atDash = act?.do === 'dash' && (act.armed || act.aim || Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r); // armed: jumped from the spot
    const ready = !(ctx.game.t - act?.firedT < p.tuning.dashCooldown - 0.05), lifted = act?.minY != null && !act.shots; // minY: an updraft lifted us, no jump armed it
    if (atDash && ready && (act.air ? (act.armed || lifted) && !p.grounded && p.vel.y <= 0 && !(lifted && p.pos.y < act.minY) : p.grounded)) { // fire: one rising edge, player.js buffers it
      act.shots = (act.shots ?? 0) + 1; act.done = act.shots >= (act.air === 2 ? 2 : 1); act.armed = !!act.air && !act.done; act.firedT = ctx.game.t; // air 2: the second burst once the cooldown is over
      log.push({ t: +ctx.game.t.toFixed(3), event: 'dash', detail: { air: !!act.air, pos: p.pos.toArray().map((v) => +v.toFixed(2)) } });
      return reg.set('input', { move: [dx, dz], jump: false, run: true, dash: true });
    }
    if (act?.do === 'wait' && p.grounded && (Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r || (act.ride && p.groundBody))) { // ride: stay put while the body carries us // hold still (a lift carries us)
      bestT = ctx.game.t;
      return reg.set('input', { move: [0, 0], jump: false, run: false });
    }
    if (act?.do === 'go' && Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r && (act.y == null || Math.abs(p.pos.y - act.y) < 1)) act.done = rescan = true; // off the route: find it again
    if (act?.do === 'sing' && p.grounded && Math.abs(p.pos.y - act.target[1]) <= 2.5 && Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r) { // stop, face, hold the song
      const face = [act.target[0] - p.pos.x, act.target[2] - p.pos.z];
      bestT = ctx.game.t;
      return reg.set('input', { move: [0, 0], jump: false, run: false, face, sing: ctx.game.t - doneT > 0.3 && !flags[`switch.${act.switch}`] });
    }
    if ((act?.do === 'airstrike' || act?.do === 'airsong') && (act.fired || p.grounded && Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r)) { // R5: jump, act at the apex
      bestT = ctx.game.t;
      const face = act.face ? [act.face[0] - p.pos.x, act.face[1] - p.pos.z] : [dx, dz];
      if (p.grounded) {
        if (act.fired && act.landT == null) { act.landT = ctx.game.t; if (act.do === 'airstrike' && !act.until) act.done = true; }
        if (act.fired && ctx.game.t - act.landT < 0.5) return reg.set('input', { move: [0, 0], jump: false, run: false, face });
        const off = Math.atan2(Math.sin(Math.atan2(face[0], face[1]) - p.heading), Math.cos(Math.atan2(face[0], face[1]) - p.heading));
        if (Math.abs(off) > 0.15 || Math.hypot(p.vel.x, p.vel.z) > 0.3) return reg.set('input', { move: [0, 0], jump: false, run: false, face });
        act.fired = true; act.landT = null; act.seq = null; act.songT = null; act.struckAir = false;
        return reg.set('input', { move: [0, 0], jump: true, run: false });
      }
      const apex = p.vel.y <= 0.4;
      if (act.do === 'airstrike') { const s = apex && !act.struckAir; if (s) act.struckAir = true; return reg.set('input', { move: [0, 0], jump: p.vel.y > 0, run: false, strike: s }); }
      if (apex && act.songT == null) act.songT = ctx.game.t;
      const u = act.songT == null ? -1 : ctx.game.t - act.songT, len = act.song === 'gust' ? act.charge ?? 0.4 : 0.1;
      return reg.set('input', { move: [0, 0], jump: p.vel.y > 0, run: false, face, song: u >= 0 && u < len ? act.song : null });
    }
    if (act?.do === 'pogo' && !p.grounded && act.leapt) { // R5: down + strike over a bell / shard below
      bestT = ctx.game.t;
      const below = [...(reg.get('trials') ?? []).filter((o) => o.kind === 'bell').map((o) => o.d.pos), ...(reg.get('enemies') ?? []).filter((e) => !['gone', 'off', 'puff', 'free'].includes(e.state)).map((e) => e.pos.toArray())]
        .some((q) => Math.hypot(q[0] - p.pos.x, q[2] - p.pos.z) < 1.0 && p.pos.y - q[1] > 0 && p.pos.y - q[1] < 1.3);
      const s = below && p.vel.y < 0 && !struck && p.state !== 'strike'; struck = s;
      return reg.set('input', { move: [dx, dz], jump: p.vel.y > 0 && !act.bounces, run: true, strike: s, down: below }); // hold the take-off jump to its apex
    }
    if (act?.do === 'pogo' && p.grounded && act.leapt) { act.done = rescan = true; }
    if (act?.do === 'song' && act.slab && !act.seq) { const o = (reg.get('trials') ?? []).find((x) => x.id === act.slab); if (o?.state !== 'lower' && Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r) { bestT = ctx.game.t; return reg.set('input', { move: [0, 0], jump: false, run: false, face: act.face ? [act.face[0] - p.pos.x, act.face[1] - p.pos.z] : undefined }); } }
    if (act?.do === 'song' && (act.seq || p.grounded && (act.y == null || Math.abs(p.pos.y - act.y) < 1) && Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r)) { // stop, face, play the song
      const f = act.face ?? (act.target ? [act.target[0], act.target[2]] : [p.pos.x + dx, p.pos.z + dz]), face = [f[0] - p.pos.x, f[1] - p.pos.z];
      const off = Math.atan2(Math.sin(Math.atan2(face[0], face[1]) - p.heading), Math.cos(Math.atan2(face[0], face[1]) - p.heading));
      if (!act.seq && !(ctx.game.t - act.pressedT < 0.6) && p.state !== 'sing' && Math.abs(off) < 0.15 && Math.hypot(p.vel.x, p.vel.z) < 0.3) { act.seq = plan(reg, act.song, act, p); act.pressedT = ctx.game.t; }
      bestT = ctx.game.t;
      return reg.set('input', { move: [0, 0], jump: false, run: false, face, song: held(act, ctx.game.t) });
    }
    if (act?.do === 'fight' && (act.seq || (act.y == null || Math.abs(p.pos.y - act.y) < 1.5) && Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r)) {
      bestT = ctx.game.t;
      const inp = fight(reg, act, p, ctx.game.t, flags);
      if (inp.strike) { inp.strike = !struck && p.state !== 'strike'; struck = inp.strike; }
      return reg.set('input', inp);
    }
    if (act?.do === 'strike' && p.grounded && Math.abs(p.pos.y - act.target[1]) <= 2.5 && Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r) { // stop, face, strike, wait
      const face = act.target ? [act.target[0] - p.pos.x, act.target[2] - p.pos.z] : [dx, dz];
      const off = Math.atan2(Math.sin(Math.atan2(face[0], face[1]) - p.heading), Math.cos(Math.atan2(face[0], face[1]) - p.heading));
      const strike = act.do === 'strike' && !struck && p.state !== 'strike' && !flags[`switch.${act.switch}`] && Math.abs(off) < 0.15 && Math.hypot(p.vel.x, p.vel.z) < 0.3;
      struck = strike; bestT = ctx.game.t; // waiting is not stuck
      return reg.set('input', { move: [0, 0], jump: false, run: false, strike, face });
    }

    if (reg.get('spring') && p.grounded && p.breath < p.breathMax) { bestT = ctx.game.t; return reg.set('input', { move: [0, 0], jump: false, run: false }); } // a wind cairn: breathe in until full (kit.mjs counts it as a refill)
    let jump = false, run = false;
    if (p.grounded && !(act?.do === 'go' && act.drop)) {
      const T = p.tuning, probeY = p.pos.y + T.jumpHeight;
      for (let d = 0.5; d <= RUNUP && !run; d += 0.5) { // edge ahead: run so the jump gets full reach
        const g = collide.groundAt(p.pos.x + dx * d, p.pos.z + dz * d, p.pos.y + T.stepUp);
        run = !g || g.y < p.pos.y - T.stepDown;
      }
      const wind = reg.get('wind'), tail = Math.max(0, (wind?.x ?? 0) * dx + (wind?.z ?? 0) * dz); // wind at the take-off spot carries the jump
      const reach = (rise) => (atDash && act.air ? (act.air === 2 ? dash2Reach : dashReach)(rise, T) : jumpReach(rise, T, T.run + tail)); // dash: no wind credit
      const ahead = collide.groundAt(p.pos.x + dx * (T.radius + 0.1), p.pos.z + dz * (T.radius + 0.1), probeY);
      if (!ahead || ahead.y < p.pos.y - T.stepDown || ahead.y > p.pos.y + T.stepUp) {
        for (let d = 1; d <= reach(0); d += 0.25) { // landing within reach?
          const g = collide.groundAt(p.pos.x + dx * d, p.pos.z + dz * d, probeY);
          if (g && g.y > p.pos.y - 2 && d <= reach(Math.max(0, g.y - p.pos.y))) { jump = true; break; }
        }
        if ((act?.do === 'go' && act.leap) || (act?.do === 'pogo' && Math.hypot(p.pos.x - act.at[0], p.pos.z - act.at[1]) <= act.r)) { jump = true; if (act.do === 'pogo') act.leapt = true; } // leap: jump the edge anyway, a wind past the rim carries it (pogo: the bells do)
      }
    }
    if (jump && atDash && act.air) act.armed = true;
    holding = jump || (holding && !p.grounded && p.vel.y > 0); // hold to apex for full height
    reg.set('input', { move: [dx, dz], jump: holding, run: run || !p.grounded });
  },
};

// A song as a held key (Phase S, songs.js reads the key and casts on release): seq = {t0, spans: [[0, hold s]], slab?}. hold: the
// action's `hold` (s), else gust 1.55 (stage 3), anchor 0.95 (stage 2), name a tap. The first gust of a worst profile is held past
// OVER (it tears, the breath is gone) when there is breath to spare.
function plan(reg, song, act, p, hold) {
  const err = profile === 'worst' && !act.tries && song === 'gust' && hold == null && act.hold == null && p.breath >= 3;
  const s = { spans: [[0, err ? OVER + 0.1 : hold ?? act.hold ?? act.charge ?? { gust: 1.55, name: 0.12, anchor: 0.95 }[song]]] };
  if (song === 'anchor') { const tgt = pick(reg, 'anchor', p.pos.toArray()); if (tgt?.m?.free) { s.slab = tgt.o; s.spans = [[0, 0.05]]; } }
  return s;
}
function held(act, t) {
  const s = act.seq;
  if (!s) return null;
  if (s.t0 == null) {
    if (s.slab && Math.abs(s.slab.cur.y - s.slab.d.stop) > 0.06) return null; // a lowering slab: tap as it passes the walkway
    s.t0 = t;
  }
  const u = t - s.t0;
  if (u > s.spans.at(-1)[1] + 1.6) { act.seq = null; return null; } // no answer (the press was not taken): try again
  return s.spans.some(([a, b]) => u >= a && u < b) ? act.song ?? 'name' : null;
}
// The scripted counter for one shard (see the header). Returns the input.
function fight(reg, act, p, t, flags) {
  const all = reg.get('enemies') ?? [], e = all.find((x) => x.id === act.enemy), idle = { move: [0, 0], jump: false, run: false };
  const at = (o) => [o.pos.x - p.pos.x, o.pos.z - p.pos.z];
  if (!e || flags[`enemy.${e.id}.free`] || e.state === 'gone') { act.done = true; return idle; }
  if (act.seq?.song === 'anchor' && e.unbindable) act.seq = null; // the pull squall choked: on to the Name
  if (act.seq) { act.song = act.seq.song; return { ...idle, face: act.seq.face?.() ?? at(e), song: held(act, t) }; }
  if (act.stun && (e.unbindable || e.state === 'stun') && !flags['gift.name'] && !act.shatter) { act.done = true; return idle; }
  const free = p.grounded && p.state !== 'sing' && p.state !== 'strike';
  if (act.shatter && e.unbindable && e.kind !== 'boss') { // R4 worst: keeps hitting the stunned shard until it shatters
    const f = at(e), dd = Math.hypot(...f);
    return dd > 1.4 ? { ...idle, move: [f[0] / dd, f[1] / dd] } : { ...idle, face: f, strike: free };
  }
  if (e.unbindable && flags['gift.name'] && free && !(t - act.pressedT < 0.4)) { // Name it
    act.seq = { ...plan(reg, 'name', act, p), song: 'name' }; act.pressedT = t;
    return { ...idle, face: at(e) };
  }
  let foe = e;
  if (e.kind === 'boss' && e.state === 'waves') {
    const mine = all.filter((m) => e.d.minions?.includes(m.id)), ms = mine.filter((m) => !m.stunned);
    foe = mine.find((m) => m.state === 'tele') ?? ms.sort((a, b) => Math.hypot(...at(a)) - Math.hypot(...at(b)))[0] ?? e;
  }
  if (e.kind === 'boss' && e.state === 'rings') { // jump each shock ring as it reaches us (worst: late on the first)
    const hd = Math.hypot(p.pos.x - e.home.x, p.pos.z - e.home.z), lead = profile === 'worst' && !act.ringLate ? 0.2 : 0.75;
    const jump = p.grounded && e.rings.some((r) => r.r < hd && hd - r.r < lead && hd - r.r > lead - 0.3);
    if (jump && lead < 0.5) act.ringLate = true;
    return { ...idle, jump, face: at(e) };
  }
  const face = at(foe), dist = Math.hypot(...face);
  const over = Math.hypot(foe.pos.x - act.at[0], foe.pos.z - act.at[1]) < act.r - 0.6; // the shard is over the fight's ground (never chased past a rim)
  const go = (f, run = false) => { const L = Math.hypot(...f) || 1; return over || run ? { ...idle, run, move: [f[0] / L, f[1] / L] } : { ...idle, face: f }; };
  if (foe.d.variant === 'thief') { // walk into it and strike (worst: only once it has taken a thread; the blow brings it back)
    if (profile === 'worst' && !act.early) { if (foe.loot || p.breath < 1) act.early = true; else return foe.state === 'hover' && dist > 4 ? go(face) : { ...idle, face }; } // still hovering out of its aggro: step in to be robbed
    return dist > 1.7 ? go(face) : { ...idle, face, strike: free };
  }
  if (foe.d.variant === 'pull') { // Anchor against the inhale (worst: swallowed once first); no Anchor or no breath: go in and strike it
    if (profile === 'worst' && !act.early) { if (foe.bit) act.early = true; else return foe.state === 'pull' ? { ...idle, face } : dist > 3.5 ? go(face) : { ...idle, face }; }
    if (flags['gift.anchor'] && p.breath >= p.tuning.breath.song) {
      if (foe.state === 'pull' && free && !(t - act.pressedT < 0.6)) { act.seq = { spans: [[0, 0.1]], t0: t, song: 'anchor' }; act.pressedT = t; return { ...idle, face }; }
      return dist > 4 ? go(face) : { ...idle, face };
    }
    return dist > 1.7 ? go(face) : { ...idle, face, strike: free };
  }
  if (foe.d.guard && ['patrol', 'tele', 'ram'].includes(foe.state)) { // bait its shove, step back out of it, then the generic close-in-and-strike while it recovers (worst: takes the first shove)
    if (foe.state === 'ram') act.early = true;
    if (!act.posted) { const f = [act.at[0] - p.pos.x, act.at[1] - p.pos.z]; const L = Math.hypot(...f); if (L < 0.5) act.posted = true; else return { ...idle, move: [f[0] / L, f[1] / L] }; } // first to the fight's spot: a clear line to the guard
    if (foe.state === 'patrol') return dist > 2.3 ? go(face) : { ...idle, face };
    if (profile === 'worst' && !act.early) return { ...idle, face };
    return dist > 3.5 ? { ...idle, face } : go([act.at[0] - p.pos.x, act.at[1] - p.pos.z], true);
  }
  if (foe.kind === 'squall') {
    const early = profile === 'worst' && !act.early && foe.state === 'near' && dist < 3.3; // worst: Gusts before the telegraph (only pushes it)
    if (p.breath < p.tuning.breath.song && foe.state === 'tele') { // no breath for a Gust: step in and strike it on its telegraph
      return dist > 1.8 ? { ...idle, move: [face[0] / dist, face[1] / dist] } : { ...idle, face, strike: free };
    }
    if (p.breath < p.tuning.breath.song) return { ...idle, face };
    if (free && (early || foe.state === 'tele' && foe.st < 0.2)) {
      if (early) act.early = true;
      act.seq = { ...plan(reg, 'gust', act, p, 0.36), song: 'gust', face: () => at(foe) };
    }
    return { ...idle, face };
  }
  if (['patrol', 'tele', 'recover', 'flinch', 'chase'].includes(foe.state)) { // warden / the boss's ram phase: close in and strike
    if (dist > (foe.kind === 'boss' ? 2.2 : 1.6)) return { ...idle, move: [face[0] / dist, face[1] / dist] };
    return { ...idle, face, strike: true };
  }
  return { ...idle, face };
}