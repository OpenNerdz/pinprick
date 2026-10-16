// Every level must be finishable: start, cores, notes and exit reachable on foot (with every
// slammable door shut), the creature able to reach its patrol route, and the exit pad close enough
// to stand on. The original game shipped with an exit pad you could never step onto; this catches that.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS} from '../src/levels/index.js';
import {compileLevel, CORE_PICKUP, EXIT_RADIUS, NOTE_PICKUP} from '../src/world/level.js';
import {NavGrid} from '../src/world/nav.js';
import {collide} from '../src/world/collision.js';
import {CELL, PLAYER_R, TRACKER} from '../src/config.js';

const FACES = {n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0]};

function reachableWithin(nav, field, x, z, r) {
  const R = Math.ceil(r / nav.res) + 1, ix = Math.floor(x / nav.res), iz = Math.floor(z / nav.res);
  for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
    const jx = ix + dx, jz = iz + dz;
    if (jx < 0 || jz < 0 || jx >= nav.nw || jz >= nav.nh) continue;
    const j = jz * nav.nw + jx;
    if (isFinite(field[j]) && Math.hypot(nav.cx(j) - x, nav.cz(j) - z) <= r) return true;
  }
  return false;
}

function setDoors(L, open) {
  for (const d of L.doors.values()) { d.prop.on = !open; d.open = open; }
}

for (const def of LEVELS) {
  test(`${def.id}: every goal reachable with doors open or slammed`, () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const L = compileLevel(def, seed);
      for (const open of [true, false]) {
        setDoors(L, open);
        if (L.exitDoor) L.exitDoor.on = true;
        const nav = new NavGrid(L.world, {radius: PLAYER_R, minH: 1.2});
        const f = nav.field(L.start.x, L.start.z);
        assert.ok(isFinite(f[nav.index(L.start.x, L.start.z)]), 'start is walkable');
        for (const c of L.cores) assert.ok(reachableWithin(nav, f, c.x, c.z, CORE_PICKUP - 0.05), `core at ${c.x},${c.z} (seed ${seed}, doors ${open ? 'open' : 'shut'})`);
        for (const n of L.notes) assert.ok(reachableWithin(nav, f, n.x, n.z, NOTE_PICKUP - 0.05), `note "${n.title}"`);
        // every battery spot (compiled with no count, so all of them are placed) and the tracker itself
        for (const b of L.batteries) assert.ok(reachableWithin(nav, f, b.x, b.z, TRACKER.pickupR - 0.05), `battery at ${b.x},${b.z} (doors ${open ? 'open' : 'shut'})`);
        if (L.tracker) assert.ok(reachableWithin(nav, f, L.tracker.x, L.tracker.z, TRACKER.pickupR - 0.05), 'the tracker');
        if (L.exitDoor) {
          L.exitDoor.on = false;
          const nav2 = new NavGrid(L.world, {radius: PLAYER_R, minH: 1.2});
          const f2 = nav2.field(L.start.x, L.start.z);
          assert.ok(reachableWithin(nav2, f2, L.exit.x, L.exit.z, EXIT_RADIUS - 0.1), 'exit reachable once open');
        }
      }
    }
  });

  test(`${def.id}: standing on the exit pad counts as reaching it`, () => {
    const L = compileLevel(def, 1);
    if (L.exitDoor) L.exitDoor.on = false;
    const pos = {x: L.exit.x, z: L.exit.z};
    collide(L.world, pos, PLAYER_R, 1.75);
    assert.ok(Math.hypot(pos.x - L.exit.x, pos.z - L.exit.z) < EXIT_RADIUS, 'player can stand within the exit radius');
  });

  test(`${def.id}: start is clear and every marker sits in open space`, () => {
    const L = compileLevel(def, 1), w = L.world;
    const pos = {x: L.start.x, z: L.start.z};
    collide(w, pos, PLAYER_R, 1.75);
    assert.ok(Math.hypot(pos.x - L.start.x, pos.z - L.start.z) < 1e-6, 'start is not inside a wall or prop');
    const open = (x, z, what) => assert.ok(w.heightAt(x, z) > 0, `${what} at ${x},${z} is inside rock`);
    for (const t of L.triggers) open(t.x, t.z, 'trigger');
    for (const g of L.ghosts) open(g[0], g[1], 'ghost trail point');
    for (const [x, z] of def.cores.spots) {
      open(x, z, 'core spot');
      for (const p of w.props) {
        if (!p.solid || !p.on || (p.k === 1 && p.x === x && p.z === z)) continue;
        const qx = p.k === 0 ? Math.max(p.x0, Math.min(x, p.x1)) : p.x, qz = p.k === 0 ? Math.max(p.z0, Math.min(z, p.z1)) : p.z;
        const d = Math.hypot(x - qx, z - qz) - (p.k === 0 ? 0 : p.r);
        assert.ok(d > 0.3, `core spot ${x},${z} overlaps a prop`);
      }
    }
    if (L.statue) open(L.statue.x, L.statue.z, 'statue');
    // a battery lies on the floor or on top of something, never inside it
    for (const b of [...L.batteries, ...(L.tracker ? [L.tracker] : [])]) {
      assert.ok(w.heightAt(b.x, b.z) > b.y + 0.5, `battery at ${b.x},${b.z} is inside rock`);
      for (const p of w.props) {
        if (!p.solid || !p.on || p.k !== 0) continue;
        const inside = b.x > p.x0 && b.x < p.x1 && b.z > p.z0 && b.z < p.z1 && b.y < p.y1 - 0.01 && b.y + 0.1 > p.y0;
        assert.ok(!inside, `battery at ${b.x},${b.z} is buried in a prop`);
      }
      if (b.y > 0) assert.ok(w.props.some(p => p.solid && p.k === 0 && Math.abs(p.y1 - b.y) < 0.01
        && b.x > p.x0 && b.x < p.x1 && b.z > p.z0 && b.z < p.z1), `battery at ${b.x},${b.z} floats at ${b.y} m`);
    }
    assert.equal(!!L.tracker, def.id === 'intake', 'only the first level hands you the tracker');
    assert.ok(L.batteries.length >= (def.stalker ? 4 : 1), `${L.batteries.length} battery spots`);
    const pnav = new NavGrid(w, {radius: PLAYER_R, minH: 1.2});
    const f = pnav.field(L.start.x, L.start.z);
    for (const h of L.hides) assert.ok(reachableWithin(pnav, f, h.x, h.z, h.r - 0.1), `hiding spot ${h.x},${h.z} reachable`);
  });

  test(`${def.id}: wall writing sits on a rock face`, () => {
    const L = compileLevel(def, 1), w = L.world;
    for (const d of L.world.decals) {
      const [nx, nz] = FACES[d.face], rx = nz, rz = -nx;
      for (let u = -0.45; u <= 0.45; u += 0.15) {
        const x = d.x + rx * u * d.w, z = d.z + rz * u * d.w;
        assert.equal(w.heightAt(x - nx * 0.1, z - nz * 0.1), 0, `"${d.text}": rock behind`);
        const h = w.heightAt(x + nx * 0.1, z + nz * 0.1);
        assert.ok(h > d.y + d.h / 2, `"${d.text}": open space in front, tall enough`);
      }
    }
  });

  if (def.stalker) {
    test(`${def.id}: the creature can walk its whole route`, () => {
      const L = compileLevel(def, 1);
      for (const open of [true, false]) {
        setDoors(L, open);
        const nav = new NavGrid(L.world, {radius: 0.35, minH: 2.15});
        const [sx, sz] = def.stalker.spawn;
        assert.ok(nav.nearest(sx, sz, 0.5) >= 0, 'spawn is walkable');
        const f = nav.field(sx, sz);
        for (const [x, z] of def.stalker.patrol) {
          assert.ok(nav.nearest(x, z, 0.5) >= 0, `patrol point ${x},${z} walkable`);
          assert.ok(isFinite(nav.distAt(f, x, z, 0.5)), `patrol point ${x},${z} reachable from spawn (doors ${open ? 'open' : 'shut'})`);
        }
      }
    });
  }
}

test('nav distance in an open room matches straight-line distance closely', () => {
  const L = compileLevel(LEVELS[1], 1);
  const nav = new NavGrid(L.world, {radius: 0.3, minH: 1.2});
  const f = nav.field(14, 14);
  const d = nav.distAt(f, 14, 24);
  assert.ok(d >= 10 - 0.5 && d < 10 * 1.12, `got ${d}`);
  assert.ok(CELL === 2);
});
