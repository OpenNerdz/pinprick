// The story, the last level's shape and the scripted scares. test/levels.test.js proves every level can
// be finished; this proves the last one plays as a chase with ways out, that its pump is sane, that
// every note can actually be found by scanning, and that each scare does what a level asks of it.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS} from '../src/levels/index.js';
import {compileLevel} from '../src/world/level.js';
import {collide} from '../src/world/collision.js';
import {NavGrid} from '../src/world/nav.js';
import {Session} from '../src/game/session.js';
import {Camera} from '../src/render/camera.js';
import {cast, hit} from '../src/world/raycast.js';
import {MAT, PLAYER_R} from '../src/config.js';

const last = LEVELS[LEVELS.length - 1];
const noop = () => {};
const view = {w: 400, h: 800, lensX: 0.2, lensY: -0.6};
const intent = () => ({moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false});

function make(def, opts = {}) {
  const calls = [], says = [], dots = [];
  const e = {listener: {x: 0, z: 0, yaw: 0}, place: () => ({pan: 0, dist: 1, front: 1}), now: 0};
  const sounds = new Proxy({e}, {get: (t, k) => (k in t ? t[k] : (...a) => { calls.push([k, ...a]); })});
  const d = {push: (...a) => dots.push(a), total: 0, clear: noop};
  const renderer = {setDots: () => d, setGhosts: noop, setLevelMesh: noop, setActors: noop, addLine: noop, addFan: noop};
  const s = new Session(def, {difficulty: 'normal', seed: 3, renderer, sounds, ui: {say: t => says.push(t), note: noop, caught: noop, won: noop, cores: noop}, ...opts});
  s.stalker?.sleep();
  if (s.stalker) { s.stalker.wake = noop; s.stalker.enter = noop; }
  return {s, calls, says, dots};
}

/** Run the scares alone for `secs`, handing each frame's time to `fn`. */
function run(s, from, secs, fn = noop) {
  const dt = 1 / 30;
  for (let T = from; T < from + secs; T += dt) { fn(T); s.scares.update(dt, T); }
  return from + secs;
}

const takeCores = (s, n) => { s.coresGot = n; };

// ---------------------------------------------------------------- the story

test('the game ends on the last level, and the arc carries through its notes', () => {
  for (const k of ['ending', 'exitMessage', 'finaleMessage']) assert.ok(last[k]?.length > 20, `the last level has ${k}`);
  assert.ok(last.notes.length >= 5, 'enough of the operator left to read');
  const titles = LEVELS.flatMap(l => (l.notes || []).map(n => n.title));
  assert.equal(new Set(titles).size, titles.length, 'no two notes share a title');
});

test('every note can be found by scanning, not only by brushing against it', () => {
  for (const def of LEVELS) {
    const L = compileLevel(def, 1), w = L.world, nav = new NavGrid(w, {radius: PLAYER_R, minH: 1.2}), f = nav.field(L.start.x, L.start.z);
    for (const n of L.notes) {
      for (const [u, v] of [[-0.2, -0.14], [0.2, -0.14], [-0.2, 0.14], [0.2, 0.14]]) assert.ok(w.heightAt(n.x + u, n.z + v) > 0.9, `${def.id} "${n.title}": its slate is in rock`);
      let rays = 0, hits = 0;
      for (const d of [1.5, 2.5, 3.5]) for (let a = 0; a < 16; a++) {
        const x = n.x + Math.sin(a / 16 * Math.PI * 2) * d, z = n.z + Math.cos(a / 16 * Math.PI * 2) * d;
        if (!isFinite(nav.distAt(f, x, z, 0.3))) continue;
        for (let u = -0.16; u <= 0.161; u += 0.08) for (let v = -0.1; v <= 0.101; v += 0.05) {
          const dx = n.x + u - x, dy = 0.88 - 1.6, dz = n.z + v - z, l = Math.hypot(dx, dy, dz);
          rays++;
          if (cast(w, x, 1.6, z, dx / l, dy / l, dz / l, l + 0.5, false) && hit.m === MAT.NOTE) hits++;
        }
      }
      assert.ok(rays > 0 && hits / rays > 0.5, `${def.id} "${n.title}": ${hits} of ${rays} rays from around it reach its slate`);
    }
  }
});

// ---------------------------------------------------------------- the last level

test('the pump is where the level says, and its cycle leaves time to move and to stop', () => {
  const {pump} = last, L = compileLevel(last, 1);
  assert.ok(pump, 'the last level has a pump');
  assert.ok(L.world.heightAt(pump.x, pump.z) > 0, 'in open space');
  for (const k of ['every', 'lasts']) assert.ok(pump[k].length === 2 && pump[k][0] > 0 && pump[k][0] <= pump[k][1], `${k} is [min, max]`);
  // the shortest run of the pump still walks you most of the way across a leg of the map
  assert.ok(pump.lasts[0] * 3.2 > 30, 'a run lasts long enough to walk 30 m');
});

/** Map cells an agent can stand in, and which of them it can step between. */
function cellGraph(world, nav) {
  const W = world.w, H = world.h, id = (x, z) => z * W + x, adj = new Map(), sub = Math.round(2 / nav.res);
  const at = (cx, cz, a, b) => nav.walk[(cz * sub + a) * nav.nw + cx * sub + b];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    let any = false;
    for (let a = 0; a < sub && !any; a++) for (let b = 0; b < sub && !any; b++) any = !!at(x, z, a, b);
    if (any) adj.set(id(x, z), []);
  }
  for (const k of [...adj.keys()]) {
    const x = k % W, z = (k - x) / W;
    let right = false, down = false;
    for (let a = 0; a < sub; a++) {
      if (x + 1 < W && at(x, z, a, sub - 1) && at(x + 1, z, a, 0)) right = true;
      if (z + 1 < H && at(x, z, sub - 1, a) && at(x, z + 1, 0, a)) down = true;
    }
    if (right) { adj.get(k).push(id(x + 1, z)); adj.get(id(x + 1, z)).push(k); }
    if (down) { adj.get(k).push(id(x, z + 1)); adj.get(id(x, z + 1)).push(k); }
  }
  return {adj, W};
}

/** The biggest piece of the map that hangs off the rest by a single map cell: a place with one way out. */
function biggestPocket({adj, W}, root) {
  const reach = new Set([root]), todo = [root];
  while (todo.length) for (const v of adj.get(todo.pop())) if (!reach.has(v)) { reach.add(v); todo.push(v); }
  let worst = 0, where = null;
  for (const cut of reach) {
    const seen = new Set([cut]), sizes = [];
    for (const start of adj.get(cut)) {
      if (seen.has(start)) continue;
      let n = 0;
      const st = [start];
      seen.add(start);
      while (st.length) { const u = st.pop(); n++; for (const v of adj.get(u)) if (!seen.has(v)) { seen.add(v); st.push(v); } }
      sizes.push(n);
    }
    sizes.sort((a, b) => b - a);
    const cutOff = sizes.slice(1).reduce((a, b) => a + b, 0);
    if (cutOff > worst) { worst = cutOff; where = `${cut % W},${(cut - cut % W) / W}`; }
  }
  return {worst, where, reach};
}

test('a chase in the last level is never a single-route dead end, doors open or slammed', () => {
  for (const open of [true, false]) {
    const L = compileLevel(last, 1), w = L.world;
    L.exitDoor.on = false;
    for (const d of L.doors.values()) { d.prop.on = !open; d.open = open; }
    const [sx, sz] = last.stalker.spawn, root = Math.floor(sz / 2) * w.w + Math.floor(sx / 2);
    const creature = biggestPocket(cellGraph(w, new NavGrid(w, {radius: 0.35, minH: 2.15})), root);
    assert.ok(creature.worst <= 3, `doors ${open ? 'open' : 'shut'}: ${creature.worst} cells hang off ${creature.where}`);
    for (const c of last.cores.spots) assert.ok(creature.reach.has(Math.floor(c[1] / 2) * w.w + Math.floor(c[0] / 2)) || w.heightAt(c[0], c[1]) < 2.15, `core at ${c} is on the creature's map`);
  }
});

test('the last level has crawls it cannot follow you through, and more than one way to the exit door', () => {
  const L = compileLevel(last, 1), w = L.world;
  const creature = new NavGrid(w, {radius: 0.35, minH: 2.15}), player = new NavGrid(w, {radius: PLAYER_R, minH: 1.2});
  const crawls = last.map.join('').split(';').length - 1;
  assert.ok(crawls >= 4, `${crawls} crawl cells`);
  let only = 0;
  for (let i = 0; i < player.n; i++) if (player.walk[i] && !creature.walk[i] && w.heightAt(player.cx(i), player.cz(i)) < 2.15) only++;
  assert.ok(only > 20, `the player has ${only} grid squares it cannot enter`);
  assert.ok(L.hides.length >= 3, 'hiding spots');
  // shut the room's west door and the way through the crawl is still there; block the crawl's far side and the motors still lead in
  const f = player.field(L.exit.x - 2, L.exit.z);
  for (const [x, z, what] of [[45, 5, 'west door'], [46.5, 9, 'crawl'], [53, 13, 'south corridor']]) assert.ok(isFinite(player.distAt(f, x, z, 0.5)), what);
  assert.ok(new Set(last.map.join('')).has(':') && new Set(last.map.join('')).has(','), 'halls and ducts both');
});

test('the last level has no gaps the grid thinks you fit through but your body does not', () => {
  // a row of bars half a metre apart looks open to a half-metre grid; a bot walked into one for two minutes
  const L = compileLevel(last, 1), w = L.world, nav = new NavGrid(w, {radius: PLAYER_R, minH: 1.2});
  L.exitDoor.on = false;
  nav.build();
  for (let i = 0; i < nav.n; i++) {
    if (!nav.walk[i]) continue;
    for (const step of [1, nav.nw]) {
      if (!nav.walk[i + step]) continue;
      const x = (nav.cx(i) + nav.cx(i + step)) / 2, z = (nav.cz(i) + nav.cz(i + step)) / 2, pos = {x, z};
      collide(w, pos, PLAYER_R, 0.95);
      assert.ok(Math.hypot(pos.x - x, pos.z - z) < 0.12, `the step through ${x},${z} is blocked`);
    }
  }
});

test('from anywhere in the last level, a place to stop is within one run of the pump', () => {
  const L = compileLevel(last, 1), nav = new NavGrid(L.world, {radius: PLAYER_R, minH: 1.2});
  const crawlCells = [];
  last.map.forEach((row, z) => [...row].forEach((c, x) => { if (c === ';') crawlCells.push([x * 2 + 1, z * 2 + 1]); }));
  const near = new Float32Array(nav.n).fill(Infinity);
  for (const [x, z] of [...last.hides.map(h => [h.x, h.z]), ...crawlCells]) {
    const f = nav.field(x, z);
    for (let i = 0; i < nav.n; i++) if (f[i] < near[i]) near[i] = f[i];
  }
  const reach = last.pump.lasts[0] * 3.2 * 0.7; // a walk, leaving time to hear it stop
  for (let i = 0; i < nav.n; i++) if (nav.walk[i] && isFinite(near[i])) assert.ok(near[i] < reach, `${nav.cx(i)},${nav.cz(i)} is ${near[i].toFixed(0)} m from anywhere to stop`);
});

// ---------------------------------------------------------------- the scares

test('no trigger in any level names a scare that does not exist', () => {
  const warn = console.warn;
  const unknown = [];
  console.warn = (...a) => unknown.push(a.join(' '));
  try {
    for (const def of LEVELS) {
      const {s} = make(def);
      for (const t of s.L.triggers) for (const a of t.actions) s.scares.run(a, 1);
      run(s, 1, 8);
    }
  } finally { console.warn = warn; }
  assert.deepEqual(unknown, []);
});

test('the new scares are in use, and each one is rare', () => {
  for (const kind of ['handprints', 'crossing', 'phantom', 'hush']) {
    const uses = LEVELS.flatMap(l => (l.triggers || []).flatMap(t => t.actions.filter(a => a[0] === kind)));
    assert.ok(uses.length >= 1 && uses.length <= 4, `${kind} is used ${uses.length} times`);
  }
  for (const def of LEVELS) for (const t of def.triggers || []) assert.ok(t.once !== false || t.every, 'nothing repeats without a pause');
});

test('every scripted figure and phantom walks through open space, and every handprint line has a surface', () => {
  for (const def of LEVELS) {
    const {s} = make(def);
    for (const t of s.L.triggers) for (const [kind, x0, z0, x1, z1, face, n] of t.actions) {
      if (kind === 'crossing' || kind === 'phantom') {
        for (let k = 0; k <= 1.001; k += 0.05) assert.ok(s.world.heightAt(x0 + (x1 - x0) * k, z0 + (z1 - z0) * k) >= 2.2, `${def.id} ${kind} at k=${k.toFixed(2)} is in rock`);
      }
      if (kind === 'handprints') {
        s.L.doors.forEach(d => { d.open = false; d.prop.on = true; });
        let landed = 0;
        for (let i = 0; i < n; i++) if (s.scares.print(x0 + (x1 - x0) * i / (n - 1), z0 + (z1 - z0) * i / (n - 1), face, i, 0, 1)) landed++;
        assert.ok(landed >= Math.min(2, n), `${def.id}: ${landed} of ${n} prints landed`);
      }
    }
  }
});

test('handprints come up one by one on a real surface, with nobody scanning', () => {
  const {s, dots, calls} = make(last);
  s.scares.run(['handprints', 39.5, 5, 35, 5, 'n', 4], 1);
  const early = run(s, 1, 0.1);
  const first = dots.length;
  assert.ok(first > 40, `a print has ${first} dots`);
  run(s, early, 4);
  assert.ok(dots.length > first * 3.5, 'more follow');
  for (const d of dots) {
    assert.ok(d[2] > 5.6 && d[2] < 6.05, `on the manifold's south wall or what is bolted to it, got z ${d[2]}`);
    assert.ok(d[1] > 0.5 && d[1] < 2, `at hand height, got ${d[1]}`);
    assert.equal(d[3] >= 1, true, 'stamped with the time it appeared');
  }
  assert.ok(dots.some(d => d[0] > 39) && dots.some(d => d[0] < 36), 'along the line');
  assert.ok(calls.some(c => c[0] === 'creatureStep'), 'a soft touch to turn you round');
  const floor = make(last);
  floor.s.scares.run(['handprints', 34, 34, 28, 34, 'floor', 3], 1);
  run(floor.s, 1, 2);
  assert.ok(floor.dots.length > 100 && floor.dots.every(d => d[1] < 0.1), 'on the floor');
});

test('a print with no surface in reach makes nothing, rather than floating in the air', () => {
  const {s, dots} = make(last);
  s.scares.run(['handprints', 32, 41, 32, 41, 'floor', 1], 1); // the floor is right there
  run(s, 1, 0.2);
  assert.ok(dots.length > 0);
  const hall = make(last);
  hall.s.scares.run(['handprints', 22, 25, 22, 25, 'w', 1], 1); // the far wall of the hall is well out of reach
  run(hall.s, 1, 0.2);
  assert.equal(hall.dots.length, 0);
});

test('what crosses the door is silent, shows on the tracker, is solid to a beam, and then is gone', () => {
  const {s, calls} = make(last), f = s.scares.figure;
  s.tracker.owned = true;
  const motion = [];
  s.tracker.motion = (x, z) => motion.push([x, z]);
  const before = calls.length;
  s.scares.run(['crossing', 49.5, 22, 49.5, 28, 1.5], 1);
  assert.equal(f.on, true);
  let T = run(s, 1, 0.8);
  assert.ok(f.z > 23 && f.z < 27 && Math.abs(f.x - 49.5) < 0.01, `it is partway across at ${f.x},${f.z}`);
  assert.ok(f.crawl > 0.9, 'on all fours');
  T = run(s, T, 1);
  assert.equal(f.on, false, 'gone');
  assert.ok(motion.length >= 4 && motion[motion.length - 1][1] > motion[0][1], 'the tracker saw it go');
  assert.equal(calls.slice(before).filter(c => /step|gallop|shriek|clicks|whisper|groan|exhale/.test(c[0])).length, 0, 'without a sound');
  assert.equal(f.crawl, 0, 'stood back up for the figure behind you');
});

test('triggers can wait for the tracker to be up, for you to face a spot, or for a door to be shut', () => {
  const {s} = make(LEVELS[1]), p = s.player, fired = [];
  s.scares.run = a => fired.push(a[0]);
  s.L.triggers = [{x: 20, z: 20, r: 5, tracker: true, actions: [['a']]}, {x: 20, z: 20, r: 5, look: [20, 10], actions: [['b']]}];
  p.x = 20; p.z = 20; p.yaw = Math.PI; // facing south, away from the spot
  run(s, 1, 0.1);
  assert.deepEqual(fired, []);
  p.yaw = 0;
  run(s, 2, 0.1);
  assert.deepEqual(fired, ['b']);
  s.tracker.on = true;
  run(s, 3, 0.1);
  assert.deepEqual(fired, ['b', 'a']);
  const cis = make(LEVELS[2]), d = cis.s.L.doors.get('gate'), got = [];
  cis.s.scares.run = a => got.push(a[0]);
  cis.s.L.triggers = [{x: 24, z: 34, r: 3, shut: 'gate', actions: [['c']]}];
  cis.s.player.x = 24; cis.s.player.z = 34;
  run(cis.s, 1, 0.1);
  assert.deepEqual(got, []);
  d.open = false;
  run(cis.s, 2, 0.1);
  assert.deepEqual(got, ['c']);
});

test('fresh rust dots from a scanner that is not yours land on real surfaces, and the tracker sees it walk', () => {
  const {s, dots} = make(last);
  const motion = [];
  s.tracker.motion = (x, z) => motion.push([x, z]);
  s.scares.run(['phantom', 25, 39, 31, 38.6, 2], 1);
  run(s, 1, 2.2);
  assert.ok(dots.length > 1000, `${dots.length} dots`);
  assert.equal(s.scares.phantoms.length, 0, 'and it stops');
  for (const d of dots) {
    assert.ok(d[4] > d[5] && d[5] > d[6], 'rust');
    assert.ok(s.world.heightAt(d[0], d[2]) > 0, `dot at ${d[0]},${d[2]} is in open space`);
  }
  assert.ok(motion.length >= 2 && motion[1][0] > motion[0][0], 'walking the way the level says');
});

test('the false all clear: the level goes quiet, stays quiet, then breathes out behind your head', () => {
  const {s, calls} = make(last), p = s.player;
  p.x = 34; p.z = 10; p.yaw = 0; // facing north
  s.scares.run(['hush', 8], 1);
  assert.ok(calls.some(c => c[0] === 'duck' && c[1] === 8));
  assert.ok(s.pump && !s.pump.on && s.pump.t >= 8, 'the pump has stopped too, and stays stopped');
  let T = run(s, 1, 5);
  assert.ok(!calls.some(c => c[0] === 'exhale'), 'nothing yet');
  T = run(s, T, 3);
  const ex = calls.find(c => c[0] === 'exhale');
  assert.ok(ex, 'there it is');
  assert.ok(Math.hypot(ex[1] - p.x, ex[2] - p.z) < 1.5 && ex[2] > p.z, `behind you, at ${ex[1]},${ex[2]}`);
});

test('a slam waits until you are clear of the door, and only then says so', () => {
  const {s, says} = make(LEVELS[2]), p = s.player, gate = s.L.doors.get('gate');
  takeCores(s, 2);
  p.x = 23.7; p.z = 31.02; // inside the trigger, too close for the gate to shut
  let T = run(s, 1, 2);
  assert.equal(gate.open, true, 'never on the player');
  assert.deepEqual(says, [], 'nothing said about a door that did not shut');
  p.x = 24; p.z = 35;
  T = run(s, T, 0.5);
  assert.equal(gate.open, false, 'shut as soon as you are clear');
  assert.deepEqual(says, ['Behind you, a gate slams shut.'], 'said once');
  run(s, T, 3);
  assert.equal(says.length, 1, 'and only once');
});

test('with the gate shut a hand comes up on it, and it stops at the gate', () => {
  const {s, dots} = make(LEVELS[2]);
  takeCores(s, 2);
  s.player.x = 24; s.player.z = 34;
  run(s, 1, 5);
  assert.equal(s.L.doors.get('gate').open, false);
  const onGate = dots.filter(d => Math.abs(d[2] - 30) < 0.1 && d[0] > 21.5 && d[0] < 24.5);
  assert.ok(onGate.length > 100, `${onGate.length} dots on the gate`);
});

test('the scares keep working inside a real frame of the game', () => {
  const {s} = make(last), cam = new Camera();
  s.player.x = 15; s.player.z = 41;
  for (let i = 0, T = 0; i < 90; i++, T += 1 / 30) s.update(1 / 30, T, intent(), cam, view);
  assert.equal(s.state, 'play');
});
