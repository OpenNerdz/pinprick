// Stones you throw. Each flies on a real arc through the real geometry, and every bounce makes a sound the
// creature can hear and throws up a small ripple of dots, so you can see where it landed. It falls for
// this for a while. Then it works out what the stones mean.

import {NOISE, STONES} from '../config.js';
import {cast, hit} from '../world/raycast.js';

export class Stones {
  constructor(world, sounds, noise) {
    this.world = world; this.sounds = sounds; this.noise = noise;
    this.flying = [];
  }

  /** Throw one from (x, y, z) along the unit direction (dx, dy, dz). */
  toss(x, y, z, dx, dy, dz) {
    const s = STONES.speed;
    this.flying.push({x, y, z, vx: dx * s, vy: (dy + STONES.lift) * s, vz: dz * s, hits: 0, age: 0});
  }

  update(dt, T, dots) {
    const {flying} = this;
    for (let i = flying.length - 1; i >= 0; i--) {
      const q = flying[i];
      q.age += dt;
      q.vy -= STONES.gravity * dt;
      const sp = Math.hypot(q.vx, q.vy, q.vz), step = sp * dt;
      if (sp < 0.5 || q.age > 6) { flying.splice(i, 1); continue; }
      const dx = q.vx / sp, dy = q.vy / sp, dz = q.vz / sp;
      if (cast(this.world, q.x, q.y, q.z, dx, dy, dz, step, false)) {
        const nx = hit.nx, ny = hit.ny, nz = hit.nz;
        q.x += dx * hit.t + nx * 0.02; q.y += dy * hit.t + ny * 0.02; q.z += dz * hit.t + nz * 0.02;
        this.land(q, nx, ny, nz, T, dots);
        // bounce off whatever it hit, losing most of its speed
        const vn = q.vx * nx + q.vy * ny + q.vz * nz;
        q.vx = (q.vx - 2 * vn * nx) * STONES.bounce;
        q.vy = (q.vy - 2 * vn * ny) * STONES.bounce;
        q.vz = (q.vz - 2 * vn * nz) * STONES.bounce;
        if (++q.hits >= STONES.bounces) flying.splice(i, 1);
      } else { q.x += dx * step; q.y += dy * step; q.z += dz * step; }
    }
  }

  /** A clack: for your ears, for its ears, and a ripple of dots around the spot. */
  land(q, nx, ny, nz, T, dots) {
    const gain = STONES.falloff ** q.hits;
    this.sounds.stoneHit(q.x, q.z, gain);
    this.noise(q.x, q.z, NOISE.stone * gain, false, 'stone');
    if (!dots) return;
    const n = Math.round(STONES.ripple * gain);
    for (let k = 0; k < n; k++) {
      // a random direction in the half of the world the surface faces
      const a = Math.random() * 6.2832, y = Math.random() * 2 - 1, c = Math.sqrt(1 - y * y);
      let rx = Math.cos(a) * c, ry = y, rz = Math.sin(a) * c;
      if (rx * nx + ry * ny + rz * nz < 0) { rx = -rx; ry = -ry; rz = -rz; }
      if (!cast(this.world, q.x, q.y, q.z, rx, ry, rz, STONES.rippleR, false)) continue;
      const f = 0.55 + 0.45 * (1 - hit.t / STONES.rippleR), b = f * (0.7 + Math.random() * 0.3);
      dots.push(q.x + rx * hit.t + hit.nx * 0.02, q.y + ry * hit.t + hit.ny * 0.02, q.z + rz * hit.t + hit.nz * 0.02,
        T, 0.62 * b, 0.78 * b, 0.9 * b, 0.018 + Math.random() * 0.008);
    }
  }
}
