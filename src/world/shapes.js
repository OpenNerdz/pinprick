// Primitive solids that level files and actors are built from. All coordinates are metres.
// k: 0 box, 1 vertical cylinder, 2 sphere, 3 capsule (a rod between two points with round ends: the
// creature's limbs; only actors use it). `solid` decides whether the player bumps into it; by default
// anything that starts above head height is walk-under.

import {MAT} from '../config.js';

const HEAD = 1.7;

export function box(x0, z0, x1, z1, y0, y1, o = {}) {
  return {
    k: 0, x0: Math.min(x0, x1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), z1: Math.max(z0, z1),
    y0, y1, m: o.m ?? MAT.PROP, on: o.on ?? true, solid: o.solid ?? y0 < HEAD, id: o.id ?? null,
  };
}

export function cyl(x, z, r, y0, y1, o = {}) {
  return {k: 1, x, z, r, y0, y1, m: o.m ?? MAT.PROP, on: o.on ?? true, solid: o.solid ?? y0 < HEAD, id: o.id ?? null};
}

export function sph(x, y, z, r, o = {}) {
  return {k: 2, x, y, z, r, m: o.m ?? MAT.PROP, on: o.on ?? true, solid: o.solid ?? y - r < HEAD, id: o.id ?? null};
}

/** A capsule from (ax, ay, az) to (bx, by, bz). x and z are its middle, so code that only knows circles still gets a place. */
export function cap(ax, ay, az, bx, by, bz, r, o = {}) {
  return {k: 3, ax, ay, az, bx, by, bz, r, x: (ax + bx) / 2, z: (az + bz) / 2,
    m: o.m ?? MAT.PROP, on: o.on ?? true, solid: o.solid ?? Math.min(ay, by) - r < HEAD, id: o.id ?? null};
}

/** Footprint bounds in the xz plane, used for spatial indexing. */
export function bounds(p) {
  if (p.k === 0) return [p.x0, p.z0, p.x1, p.z1];
  if (p.k === 3) return [Math.min(p.ax, p.bx) - p.r, Math.min(p.az, p.bz) - p.r, Math.max(p.ax, p.bx) + p.r, Math.max(p.az, p.bz) + p.r];
  return [p.x - p.r, p.z - p.r, p.x + p.r, p.z + p.r];
}

/** Translate a primitive in place. */
export function moveBy(p, dx, dz) {
  if (p.k === 0) { p.x0 += dx; p.x1 += dx; p.z0 += dz; p.z1 += dz; }
  else if (p.k === 3) { p.ax += dx; p.bx += dx; p.az += dz; p.bz += dz; p.x += dx; p.z += dz; }
  else { p.x += dx; p.z += dz; }
}
