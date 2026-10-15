// Circle-vs-level collision for the player. Only the 3x3 block of cells around the body is checked,
// using the same per-cell prop index as the ray caster.

import {CELL} from '../config.js';

function pushRect(pos, r, x0, z0, x1, z1) {
  const qx = pos.x < x0 ? x0 : pos.x > x1 ? x1 : pos.x;
  const qz = pos.z < z0 ? z0 : pos.z > z1 ? z1 : pos.z;
  const ex = pos.x - qx, ez = pos.z - qz, d2 = ex * ex + ez * ez;
  if (d2 >= r * r) return;
  if (d2 > 1e-8) { const d = Math.sqrt(d2); pos.x = qx + ex / d * r; pos.z = qz + ez / d * r; return; }
  // centre is inside the rectangle: leave by the nearest side
  const l = pos.x - x0, rr = x1 - pos.x, t = pos.z - z0, b = z1 - pos.z, m = Math.min(l, rr, t, b);
  if (m === l) pos.x = x0 - r; else if (m === rr) pos.x = x1 + r; else if (m === t) pos.z = z0 - r; else pos.z = z1 + r;
}

function pushCircle(pos, r, cx, cz, cr) {
  const ex = pos.x - cx, ez = pos.z - cz, d2 = ex * ex + ez * ez, R = cr + r;
  if (d2 >= R * R) return;
  const d = Math.sqrt(d2) || 0.001;
  pos.x = cx + ex / d * R; pos.z = cz + ez / d * R;
}

/**
 * Push `pos` ({x, z}) out of walls, solid props and solid actors. Two passes settle corners.
 * Cells lower than `minH` count as walls, which is how crawlspaces only admit a crouching player.
 */
export function collide(world, pos, r, minH = 0.01) {
  const W = world.w, H = world.h, props = world.props, start = world.cellStart, items = world.cellItems;
  for (let it = 0; it < 2; it++) {
    const cx = Math.floor(pos.x / CELL), cz = Math.floor(pos.z / CELL);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gz = cz + dz;
      if (gx < 0 || gz < 0 || gx >= W || gz >= H) continue;
      const c = gz * W + gx;
      for (let k = start[c], e = start[c + 1]; k < e; k++) {
        const p = props[items[k]];
        if (!p.on || !p.solid) continue;
        if (p.k === 0) pushRect(pos, r, p.x0, p.z0, p.x1, p.z1); else pushCircle(pos, r, p.x, p.z, p.r);
      }
    }
    for (const a of world.actors) if (a.on && a.solid) pushCircle(pos, r, a.x, a.z, a.bodyR);
    // walls last so they always win
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const gx = cx + dx, gz = cz + dz;
      if (gx < 0 || gz < 0 || gx >= W || gz >= H || world.cellH[gz * W + gx] < minH) {
        pushRect(pos, r, gx * CELL, gz * CELL, gx * CELL + CELL, gz * CELL + CELL);
      }
    }
  }
}
