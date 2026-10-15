// The last operator's dots. Their scanner never fully faded: a dim rust-coloured trail marks where
// they walked, and it ends in a dense cluster where they stopped. Baked once per level.

import {cast, hit} from '../world/raycast.js';
import {rng} from '../util/math.js';

export function bakeGhosts(world, trail, seed) {
  if (!trail.length) return new Float32Array(0);
  const r = rng(seed ^ 0x9e3779b9), out = [];
  const push = (ox, oy, oz, dx, dy, dz, col, size) => {
    const l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
    if (!cast(world, ox, oy, oz, dx, dy, dz, 14, false)) return;
    const k = 0.5 + r() * 0.5;
    out.push(ox + dx * hit.t + hit.nx * 0.02, oy + dy * hit.t + hit.ny * 0.02, oz + dz * hit.t + hit.nz * 0.02, -1000,
      col[0] * k, col[1] * k, col[2] * k, size * (0.8 + r() * 0.4));
  };
  trail.forEach(([x, z], i) => {
    const last = i === trail.length - 1;
    if (!last) {
      for (let n = 0; n < 220; n++) {
        const a = r() * Math.PI * 2, p = (r() - 0.6) * 1.1;
        push(x, 1.5, z, Math.sin(a), Math.sin(p), -Math.cos(a), [0.62, 0.26, 0.14], 0.03);
      }
    } else {
      // where they stopped: a frantic close scan of the floor and the nearest wall
      for (let n = 0; n < 900; n++) {
        const a = r() * Math.PI * 2;
        push(x, 0.5, z, Math.sin(a), -0.15 - r() * 0.9, -Math.cos(a), [0.85, 0.16, 0.1], 0.026);
      }
    }
  });
  return new Float32Array(out);
}
