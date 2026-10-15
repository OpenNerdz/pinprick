// Ray casting against the level. The grid is walked cell by cell (DDA); each cell tests only the
// props indexed into it, and the walk stops as soon as a hit lies inside the current cell. That makes
// a cast cost roughly the number of cells crossed instead of the number of props in the level.
//
// Results go into the shared `hit` object so the hot loop allocates nothing.

import {CELL, MAT} from '../config.js';

export const hit = {t: 0, nx: 0, ny: 0, nz: 0, m: -1, actor: null};
let tnx = 0, tny = 0, tnz = 0;

export function rayBox(p, ox, oy, oz, dx, dy, dz, best) {
  let t0 = 0, t1 = best, ax = -1, a, b, q;
  if (dx !== 0) { a = (p.x0 - ox) / dx; b = (p.x1 - ox) / dx; if (a > b) { q = a; a = b; b = q; } if (a > t0) { t0 = a; ax = 0; } if (b < t1) t1 = b; if (t0 > t1) return -1; }
  else if (ox < p.x0 || ox > p.x1) return -1;
  if (dy !== 0) { a = (p.y0 - oy) / dy; b = (p.y1 - oy) / dy; if (a > b) { q = a; a = b; b = q; } if (a > t0) { t0 = a; ax = 1; } if (b < t1) t1 = b; if (t0 > t1) return -1; }
  else if (oy < p.y0 || oy > p.y1) return -1;
  if (dz !== 0) { a = (p.z0 - oz) / dz; b = (p.z1 - oz) / dz; if (a > b) { q = a; a = b; b = q; } if (a > t0) { t0 = a; ax = 2; } if (b < t1) t1 = b; if (t0 > t1) return -1; }
  else if (oz < p.z0 || oz > p.z1) return -1;
  if (ax < 0) return -1;
  tnx = ax === 0 ? (dx > 0 ? -1 : 1) : 0;
  tny = ax === 1 ? (dy > 0 ? -1 : 1) : 0;
  tnz = ax === 2 ? (dz > 0 ? -1 : 1) : 0;
  return t0;
}

export function rayCyl(p, ox, oy, oz, dx, dy, dz, best) {
  const lx = ox - p.x, lz = oz - p.z, a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = lx * dx + lz * dz, c = lx * lx + lz * lz - p.r * p.r, disc = b * b - a * c;
    if (disc < 0) return -1;
    const tt = (-b - Math.sqrt(disc)) / a;
    if (tt > 0 && tt < best) {
      const y = oy + dy * tt;
      if (y >= p.y0 && y <= p.y1) { tnx = (lx + dx * tt) / p.r; tny = 0; tnz = (lz + dz * tt) / p.r; return tt; }
    }
  }
  if (dy < 0 && oy > p.y1) {
    const tt = (p.y1 - oy) / dy;
    if (tt < best) { const hx = lx + dx * tt, hz = lz + dz * tt; if (hx * hx + hz * hz <= p.r * p.r) { tnx = 0; tny = 1; tnz = 0; return tt; } }
  } else if (dy > 0 && oy < p.y0) {
    const tt = (p.y0 - oy) / dy;
    if (tt < best) { const hx = lx + dx * tt, hz = lz + dz * tt; if (hx * hx + hz * hz <= p.r * p.r) { tnx = 0; tny = -1; tnz = 0; return tt; } }
  }
  return -1;
}

export function raySph(p, ox, oy, oz, dx, dy, dz, best) {
  const lx = ox - p.x, ly = oy - p.y, lz = oz - p.z;
  const b = lx * dx + ly * dy + lz * dz, c = lx * lx + ly * ly + lz * lz - p.r * p.r, disc = b * b - c;
  if (disc < 0) return -1;
  const tt = -b - Math.sqrt(disc);
  if (tt <= 0 || tt >= best) return -1;
  tnx = (lx + dx * tt) / p.r; tny = (ly + dy * tt) / p.r; tnz = (lz + dz * tt) / p.r;
  return tt;
}

export function rayPrim(p, ox, oy, oz, dx, dy, dz, best) {
  return p.k === 0 ? rayBox(p, ox, oy, oz, dx, dy, dz, best)
    : p.k === 1 ? rayCyl(p, ox, oy, oz, dx, dy, dz, best)
    : raySph(p, ox, oy, oz, dx, dy, dz, best);
}

/** Last normal produced by a primitive test (for tests and tools). */
export const lastNormal = () => [tnx, tny, tnz];

/**
 * Cast a ray. The direction must be normalised. Fills `hit` and returns true when something was hit
 * within maxT. `withActors` lets the caller skip moving actors (the nav and sight checks do).
 */
export function cast(world, ox, oy, oz, dx, dy, dz, maxT, withActors = true) {
  const W = world.w, H = world.h, cellH = world.cellH, props = world.props;
  const start = world.cellStart, items = world.cellItems, stamp = world.stamp;
  const id = ++world.castId;
  if (id === 0xffffffff) { stamp.fill(0); world.castId = 1; }

  let best = maxT, nx = 0, ny = 0, nz = 0, m = -1;
  let ix = Math.floor(ox / CELL), iz = Math.floor(oz / CELL);
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(CELL / dx) : Infinity, tdz = dz !== 0 ? Math.abs(CELL / dz) : Infinity;
  let tmx = dx !== 0 ? ((dx > 0 ? (ix + 1) * CELL : ix * CELL) - ox) / dx : Infinity;
  let tmz = dz !== 0 ? ((dz > 0 ? (iz + 1) * CELL : iz * CELL) - oz) / dz : Infinity;
  let t = 0, axis = -1;

  for (let i = 0; i < 128; i++) {
    const inside = ix >= 0 && iz >= 0 && ix < W && iz < H;
    const h = inside ? cellH[iz * W + ix] : 0;
    // entering rock, or entering a cell whose ceiling is below the ray: the wall face is the hit
    if (h === 0 || oy + dy * t > h) {
      if (t < best) { best = t; m = MAT.WALL; nx = axis === 0 ? -sx : 0; ny = 0; nz = axis === 1 ? -sz : 0; }
      break;
    }
    const te = tmx < tmz ? tmx : tmz;
    // props overlapping this cell (each prop tested once per cast even if it spans several cells)
    const c = iz * W + ix;
    for (let k = start[c], e = start[c + 1]; k < e; k++) {
      const pi = items[k];
      if (stamp[pi] === id) continue;
      stamp[pi] = id;
      const p = props[pi];
      if (!p.on) continue;
      const tt = p.k === 0 ? rayBox(p, ox, oy, oz, dx, dy, dz, best)
        : p.k === 1 ? rayCyl(p, ox, oy, oz, dx, dy, dz, best)
        : raySph(p, ox, oy, oz, dx, dy, dz, best);
      if (tt > 0 && tt < best) { best = tt; nx = tnx; ny = tny; nz = tnz; m = p.m; }
    }
    // ceiling or floor inside this cell
    if (dy > 0) { const tc = (h - oy) / dy; if (tc <= te) { if (tc < best) { best = tc; m = MAT.WALL; nx = 0; ny = -1; nz = 0; } break; } }
    else if (dy < 0) { const tf = -oy / dy; if (tf <= te) { if (tf < best) { best = tf; m = MAT.FLOOR; nx = 0; ny = 1; nz = 0; } break; } }
    if (best <= te) break; // a prop hit lies inside this cell; nothing further can be closer
    if (tmx < tmz) { t = tmx; tmx += tdx; ix += sx; axis = 0; } else { t = tmz; tmz += tdz; iz += sz; axis = 1; }
  }

  let actor = null;
  if (withActors) {
    const actors = world.actors;
    for (let a = 0; a < actors.length; a++) {
      const A = actors[a];
      if (!A.on) continue;
      // bounding cylinder first: most rays miss the actor entirely
      const lx = ox - A.x, lz = oz - A.z, qa = dx * dx + dz * dz;
      if (qa > 1e-9) {
        const qb = lx * dx + lz * dz, qc = lx * lx + lz * lz - A.radius * A.radius;
        if (qc > 0 && (qb > 0 || qb * qb - qa * qc < 0)) continue;
      }
      const parts = A.parts;
      for (let k = 0; k < parts.length; k++) {
        const p = parts[k];
        const tt = p.k === 0 ? rayBox(p, ox, oy, oz, dx, dy, dz, best)
          : p.k === 1 ? rayCyl(p, ox, oy, oz, dx, dy, dz, best)
          : raySph(p, ox, oy, oz, dx, dy, dz, best);
        if (tt > 0 && tt < best) { best = tt; nx = tnx; ny = tny; nz = tnz; m = p.m; actor = A; }
      }
    }
  }

  hit.t = best; hit.nx = nx; hit.ny = ny; hit.nz = nz; hit.m = m; hit.actor = actor;
  return m >= 0;
}
