// The signal meter: five bars and a panned ping that lead to the nearest core, then to the exit.
// On Normal and Hard it only reads while you stand still, and it fills with static when the creature
// is near, so it doubles as a warning.

import {clamp} from '../util/math.js';

export class Signal {
  constructor() {
    this.bars = 0; this.reading = false; this.static = false; this.exit = false;
    this.pingT = 0; this.crackleT = 0;
  }

  update(dt, s) {
    const p = s.player, diff = s.diff;
    let tx = s.exit.x, tz = s.exit.z, best = Infinity;
    this.exit = s.coresLeft === 0;
    if (!this.exit) {
      for (const c of s.cores) {
        if (c.got) continue;
        const d = Math.hypot(p.x - c.x, p.z - c.z);
        if (d < best) { best = d; tx = c.x; tz = c.z; }
      }
    } else best = Math.hypot(p.x - tx, p.z - tz);

    const st = s.stalker;
    this.static = !!(st && st.active && st.playerDist < diff.staticRange);
    this.reading = !this.static && p.still >= diff.signalStill;

    if (this.static) {
      this.bars = Math.floor(Math.random() * 6);
      if ((this.crackleT -= dt) <= 0) { this.crackleT = 0.18 + Math.random() * 0.25; s.sounds.crackle(); }
      return;
    }
    if (!this.reading) return;
    this.bars = Math.ceil((1 - clamp(best / 30, 0, 1)) * 5);
    if ((this.pingT -= dt) <= 0) {
      this.pingT = clamp(0.3 + best * 0.07, 0.35, 2.4);
      const ddx = (tx - p.x) / (best || 1), ddz = (tz - p.z) / (best || 1);
      const pan = ddx * Math.cos(p.yaw) + ddz * Math.sin(p.yaw), front = ddx * Math.sin(p.yaw) - ddz * Math.cos(p.yaw);
      const g = (0.014 + 0.05 * (1 - clamp(best / 30, 0, 1))) * (0.6 + 0.4 * Math.max(0, front));
      s.sounds.ping(this.exit, g, pan);
    }
  }
}
