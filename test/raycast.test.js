// The indexed ray caster must return exactly what a brute-force caster (test every prop) returns.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {World, Actor} from '../src/world/world.js';
import {box, cyl, sph, cap} from '../src/world/shapes.js';
import {cast, hit, rayPrim, lastNormal} from '../src/world/raycast.js';
import {CELL, MAT} from '../src/config.js';
import {rng} from '../src/util/math.js';

const MAP = [
  '############',
  '#....:::...#',
  '#....:::...#',
  '##,###:#####',
  '#....:::,,.#',
  '#....:::...#',
  '############',
];

function bruteCast(world, ox, oy, oz, dx, dy, dz, maxT) {
  // grid walk with no props, then every prop and actor part
  let best = maxT, m = -1;
  let ix = Math.floor(ox / CELL), iz = Math.floor(oz / CELL);
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
  let tmx = dx !== 0 ? ((dx > 0 ? (ix + 1) * CELL : ix * CELL) - ox) / dx : Infinity;
  let tmz = dz !== 0 ? ((dz > 0 ? (iz + 1) * CELL : iz * CELL) - oz) / dz : Infinity;
  let t = 0;
  for (let i = 0; i < 128; i++) {
    const h = world.height(ix, iz);
    if (h === 0 || oy + dy * t > h) { if (t < best) { best = t; m = MAT.WALL; } break; }
    const te = Math.min(tmx, tmz);
    if (dy > 0) { const tc = (h - oy) / dy; if (tc <= te) { if (tc < best) { best = tc; m = MAT.WALL; } break; } }
    else if (dy < 0) { const tf = -oy / dy; if (tf <= te) { if (tf < best) { best = tf; m = MAT.FLOOR; } break; } }
    if (te > best) break;
    if (tmx < tmz) { t = tmx; tmx += tdx; ix += sx; } else { t = tmz; tmz += tdz; iz += sz; }
  }
  const all = [...world.props.filter(p => p.on), ...world.actors.filter(a => a.on).flatMap(a => a.parts)];
  for (const p of all) {
    const tt = rayPrim(p, ox, oy, oz, dx, dy, dz, best);
    if (tt > 0 && tt < best) { best = tt; m = p.m; }
  }
  return {t: best, m};
}

function makeWorld(seed) {
  const r = rng(seed), w = new World(MAP);
  for (let i = 0; i < 60; i++) {
    const x = 2.2 + r() * 19.6, z = 2.2 + r() * 9.6, k = Math.floor(r() * 4);
    if (k === 0) w.add(box(x, z, x + 0.2 + r() * 3, z + 0.2 + r() * 2, r() * 2, 0.5 + r() * 4));
    else if (k === 1) w.add(cyl(x, z, 0.1 + r() * 0.8, r() * 1.5, 1 + r() * 4));
    else if (k === 2) w.add(sph(x, r() * 4, z, 0.1 + r() * 1.2));
    else w.add(cap(x, r() * 3, z, x + (r() - 0.5) * 3, r() * 3, z + (r() - 0.5) * 3, 0.05 + r() * 0.5));
  }
  w.props[3].on = false;
  w.index();
  const a = new Actor([cyl(0, 0, 0.2, 0, 1.8), sph(0, 2.0, -0.05, 0.18), cap(0.2, 1.6, 0, 0.7, 1.1, -0.4, 0.06)], {radius: 0.95});
  a.place(9, 3, 0.4);
  w.actors.push(a);
  return w;
}

test('indexed cast matches brute force on 20k random rays', () => {
  const w = makeWorld(7), r = rng(99);
  let hits = 0;
  for (let i = 0; i < 20000; i++) {
    let ox, oz;
    do { ox = 2 + r() * 20; oz = 2 + r() * 10; } while (w.heightAt(ox, oz) === 0);
    const oy = 0.2 + r() * Math.min(2.5, w.heightAt(ox, oz) - 0.3);
    let dx = r() * 2 - 1, dy = r() * 2 - 1, dz = r() * 2 - 1;
    const l = Math.hypot(dx, dy, dz); dx /= l; dy /= l; dz /= l;
    const ok = cast(w, ox, oy, oz, dx, dy, dz, 44);
    const ref = bruteCast(w, ox, oy, oz, dx, dy, dz, 44);
    assert.equal(ok, ref.m >= 0);
    assert.ok(Math.abs(hit.t - ref.t) < 1e-9, `ray ${i}: indexed t=${hit.t} brute t=${ref.t}`);
    assert.equal(hit.m, ref.m, `ray ${i}: material`);
    if (ok) hits++;
  }
  assert.ok(hits > 19000);
});

test('capsules: the side, the round ends, a slanted one, a miss, and a ray down the axis', () => {
  const close = (a, b, what) => assert.ok(Math.abs(a - b) < 1e-9, `${what}: ${a} vs ${b}`);
  const n = (...want) => lastNormal().forEach((v, i) => close(v, want[i], 'normal ' + i));
  const up = cap(0, 0, 0, 0, 2, 0, 0.5);
  close(rayPrim(up, -3, 1, 0, 1, 0, 0, 99), 2.5, 'side'); n(-1, 0, 0);
  close(rayPrim(up, 0, 5, 0, 0, -1, 0, 99), 2.5, 'down the axis onto the top'); n(0, 1, 0);
  close(rayPrim(up, -3, 2.3, 0, 1, 0, 0, 99), 2.6, 'the round top'); n(-0.8, 0.6, 0);
  close(rayPrim(up, -3, -0.3, 0, 1, 0, 0, 99), 2.6, 'the round bottom'); n(-0.8, -0.6, 0);
  assert.equal(rayPrim(up, -3, 3, 0, 1, 0, 0, 99), -1, 'over the top');
  assert.equal(rayPrim(up, -3, 1, 0, 1, 0, 0, 2), -1, 'beyond best');
  const slant = cap(0, 0, 0, 2, 2, 0, 0.3);
  close(rayPrim(slant, 1, 1, -3, 0, 0, 1, 99), 2.7, 'slanted'); n(0, 0, -1);
  assert.equal(rayPrim(slant, 3, 0, -3, 0, 0, 1, 99), -1, 'past its side');
});

test('actor hits are reported with the actor', () => {
  const w = makeWorld(3);
  w.props.length = 0; w.index();
  const ok = cast(w, 9, 1.2, 5.5, 0, 0, -1, 44);
  assert.ok(ok);
  assert.equal(hit.actor, w.actors[0]);
  assert.ok(Math.abs(hit.t - (2.5 - 0.2)) < 1e-6);
});
