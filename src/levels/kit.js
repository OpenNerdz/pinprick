// Parts levels are dressed with. A level is only ever seen as dots landing on it, so what makes a room
// read as a place is shape: pipes that go somewhere, frames, shelves you can see through.
//
// Dressing stays out of the game's way by being out of reach. Nothing can walk into what is overhead or
// hard against a wall (a body stays PLAYER_R, 0.3 m, from it), so those parts are not solid: no collision,
// no change to the walkable grid, and so no change to where sound travels or the creature walks. Anything
// out in the open at body height has to be solid; test/content.test.js checks that.
//
// A thin plate flat on a wall does not show. Dots read depth, from the dark edge the gun's own shadow leaves,
// so what is on a wall should stand off it by the most it can without reaching a body: about a quarter metre.

import {box, cyl, cap} from '../world/shapes.js';

const LOOSE = {solid: false};

/** A box that blocks nothing. Keep it overhead, on a wall, or flat on the floor. */
export const deco = (x0, z0, x1, z1, y0, y1) => box(x0, z0, x1, z1, y0, y1, LOOSE);

/** A rod that blocks nothing, for the same places. */
export const rod = (x, z, r, y0, y1) => cyl(x, z, r, y0, y1, LOOSE);

/** A round pipe between two points. It blocks nothing, so keep it overhead or on a wall. */
export const pipe = (ax, ay, az, bx, by, bz, r = 0.08) => cap(ax, ay, az, bx, by, bz, r, LOOSE);

/** A pipe with bends: `run(radius, [x, y, z], [x, y, z], ...)`. */
export const run = (r, ...pts) => pts.slice(1).map((p, i) => pipe(...pts[i], ...p, r));

/** `f(v)` for v from a to b in steps, flattened: the same part again and again along a wall. */
export function every(a, b, step, f) {
  const out = [];
  for (let v = a; v <= b + 1e-6; v += step) out.push(...[].concat(f(v)));
  return out;
}

/** `f(angle, i)` for n angles round a circle, flattened. */
export function round(n, f) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(...[].concat(f(i / n * Math.PI * 2, i)));
  return out;
}

/** A frame round a corridor that runs along x: two posts on its walls and a lintel, at this x. */
export const frameX = (x, z0, z1, h, t = 0.1) => [deco(x, z0, x + t, z0 + t, 0, h), deco(x, z1 - t, x + t, z1, 0, h), deco(x, z0, x + t, z1, h - 0.16, h)];

/** A frame round a corridor that runs along z: two posts on its walls and a lintel, at this z. */
export const frameZ = (z, x0, x1, h, t = 0.1) => [deco(x0, z, x0 + t, z + t, 0, h), deco(x1 - t, z, x1, z + t, 0, h), deco(x0, z, x1, z + t, h - 0.16, h)];

/** Shelving you can see through: four uprights and n shelves. Solid over its whole footprint. */
export function rack(x0, z0, x1, z1, h = 2.2, n = 4) {
  const t = 0.05, out = [];
  for (const [x, z] of [[x0, z0], [x1 - t, z0], [x0, z1 - t], [x1 - t, z1 - t]]) out.push(box(x, z, x + t, z + t, 0, h));
  for (let i = 0; i < n; i++) {
    const y = 0.12 + i * (h - 0.2) / n;
    out.push(box(x0, z0, x1, z1, y, y + 0.05));
  }
  return out;
}

/** A row of cabinets or lockers with a slit between each, split along the longer side. */
export function lockers(x0, z0, x1, z1, n, h = 2.1) {
  const out = [], alongX = x1 - x0 >= z1 - z0, gap = 0.05;
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n;
    if (alongX) out.push(box(x0 + (x1 - x0) * a, z0, x0 + (x1 - x0) * b - gap, z1, 0, h));
    else out.push(box(x0, z0 + (z1 - z0) * a, x1, z0 + (z1 - z0) * b - gap, 0, h));
  }
  return out;
}

/** A ladder on a wall. `axis` is the way its rungs run ('x' on a wall facing north or south). */
export function ladder(x, z, axis, y0, y1, w = 0.22, step = 0.42) {
  const dx = axis === 'x' ? w : 0, dz = axis === 'x' ? 0 : w, out = [rod(x - dx, z - dz, 0.03, y0, y1), rod(x + dx, z + dz, 0.03, y0, y1)];
  for (let y = y0 + step; y < y1; y += step) out.push(deco(x - dx - 0.02, z - dz - 0.02, x + dx + 0.02, z + dz + 0.02, y, y + 0.04));
  return out;
}

/** A hand wheel on a wall: a ring of n blocks. `axis` is the way its face looks ('x' on a wall facing east or west). */
export function wheel(x, y, z, axis, r = 0.3, n = 8) {
  const t = 0.12, s = Math.PI * r / n;
  return round(n, a => {
    const u = Math.cos(a) * r, v = Math.sin(a) * r;
    return axis === 'x' ? deco(x - t, z + u - s, x + t, z + u + s, y + v - s, y + v + s) : deco(x + u - s, z - t, x + u + s, z + t, y + v - s, y + v + s);
  });
}
