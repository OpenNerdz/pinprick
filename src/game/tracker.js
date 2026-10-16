// The motion tracker. Raised, it sends out a pulse every second and shows whatever moved within its
// reach, in a fan ahead of you, straight through rock. Only movement shows: a creature that stands
// listening, waits in the dark or is held in your beam is not on it, and every blip is where something
// was when the pulse passed, not where it is now. Something behind you only lights the edge of the
// screen (on Hard, not even that). It runs on a battery, every raise costs a little, and its tick can
// be heard up close.

import {TRACKER} from '../config.js';
import {rng, angleDiff, clamp} from '../util/math.js';
import {buzz} from '../ui/haptics.js';

export class Tracker {
  /** `owned` false when the level has it lying somewhere to be picked up. */
  constructor(diff, seed, owned, battery) {
    this.diff = diff;
    this.rand = rng((seed ^ 0x51ed) >>> 0); // its own stream, so using it never changes the creature's dice
    this.owned = owned; this.battery = battery;
    this.events = [];            // for the session: 'contact', 'low', 'dead', 'close'
    this.blips = [];             // {x, z, t}: where something was, and when the pulse found it
    this.pending = [];           // what this pulse caught, waiting for the wave to reach it: {x, z, d}
    this.motions = [];           // scripted movement from the scares: {x, z, until}
    this.prev = {x: 0, z: 0, ok: false};
    this.creatureSpeed = 0;
    this.seen = false; this.lowSaid = false;
    this.reset(battery);
  }

  reset(battery = this.battery) {
    this.battery = battery;
    this.on = false; this.bootT = 0; this.pulseT = 0; this.waveT = -1; this.pulseRange = this.diff.trkRange;
    this.blips.length = 0; this.pending.length = 0; this.motions.length = 0;
    this.behindL = 0; this.behindR = 0; this.flood = 0; this.glow = 0;
    this.prev.ok = false; this.creatureSpeed = 0;
  }

  /** Its reach now: low on charge, it shrinks. */
  get range() {
    const b = this.battery, k = b >= TRACKER.lowAt ? 1 : TRACKER.lowRange + (1 - TRACKER.lowRange) * b / TRACKER.lowAt;
    return this.diff.trkRange * k;
  }

  /** Something scripted moved here (fake footsteps, the figure behind you, the statue). */
  motion(x, z, T, dur) { this.motions.push({x, z, until: T + dur}); }

  /** `raised` is whether it is fully up in your hand this frame. */
  update(dt, T, s, raised) {
    const p = s.player, st = s.stalker, prev = this.prev;
    // how fast the creature really moved since the last frame: it can be trying to walk into a shut door
    if (st && st.active && st.actor.on) {
      if (prev.ok && dt > 0) {
        const d = Math.hypot(st.x - prev.x, st.z - prev.z);
        this.creatureSpeed += ((d > TRACKER.teleport ? 0 : d / dt) - this.creatureSpeed) * Math.min(1, dt * 8);
      }
      prev.x = st.x; prev.z = st.z; prev.ok = true;
    } else { prev.ok = false; this.creatureSpeed = 0; }
    for (let i = this.motions.length - 1; i >= 0; i--) if (this.motions[i].until <= T) this.motions.splice(i, 1);

    // power: every raise boots it and costs a little; it drains for as long as it is up
    if (raised && !this.on && this.owned && this.battery > 0) {
      this.on = true; this.bootT = TRACKER.boot; this.pulseT = TRACKER.boot;
      this.battery = Math.max(0, this.battery - TRACKER.bootCost / this.diff.trkBattery);
      s.sounds.trackerBoot();
    } else if (!raised && this.on) this.powerOff(s, true);
    if (this.on) {
      this.battery = Math.max(0, this.battery - dt / this.diff.trkBattery);
      if (this.battery < TRACKER.lowAt && !this.lowSaid) { this.lowSaid = true; this.events.push('low'); s.sounds.trackerLow(); }
      if (this.battery <= 0) { this.powerOff(s, false); this.events.push('dead'); s.sounds.trackerDead(); }
    }
    if (this.battery >= TRACKER.lowAt) this.lowSaid = false;
    if (this.bootT > 0) this.bootT = Math.max(0, this.bootT - dt);
    if (this.on && (this.pulseT -= dt) <= 0) { this.pulseT += TRACKER.pulseEvery; this.pulse(T, s); }

    // the wave sweeps outward; whatever the pulse caught lights up as the wave gets there
    if (this.waveT >= 0) {
      this.waveT += dt;
      const r = this.waveT / TRACKER.waveTime * this.pulseRange;
      for (let i = this.pending.length - 1; i >= 0; i--) {
        if (this.pending[i].d > r) continue;
        this.reveal(this.pending[i], T, s);
        this.pending.splice(i, 1);
      }
      if (this.waveT > TRACKER.waveTime) this.waveT = -1;
    }
    for (let i = this.blips.length - 1; i >= 0; i--) if (T - this.blips[i].t > this.diff.trkFade) this.blips.splice(i, 1);
    this.behindL = Math.max(0, this.behindL - dt * 1.1); this.behindR = Math.max(0, this.behindR - dt * 1.1);
    this.flood = Math.max(0, this.flood - dt * 1.4); this.glow = Math.max(0, this.glow - dt * 5);
  }

  powerOff(s, sound) {
    this.on = false; this.waveT = -1; this.pending.length = 0;
    if (sound) s.sounds.trackerOff();
  }

  /** One pulse: the tick, and a note of everything moving within reach right now. */
  pulse(T, s) {
    const p = s.player, st = s.stalker, R = this.range;
    this.waveT = 0; this.pulseRange = R; this.glow = 1;
    s.sounds.trackerPulse();
    s.noise(p.x, p.z, this.diff.trkNoise, false, 'tracker');
    this.pending.length = 0;
    const add = (x, z) => { const d = Math.hypot(x - p.x, z - p.z); if (d <= R) this.pending.push({x, z, d}); };
    if (st && st.active && st.actor.on && this.creatureSpeed > TRACKER.minSpeed) add(st.x, st.z);
    for (const m of this.motions) add(m.x, m.z);
  }

  /** The wave has reached something that moved: a blip ahead, a glow on the edge behind, a beep. */
  reveal(m, T, s) {
    const p = s.player, rel = angleDiff(p.yaw, Math.atan2(m.x - p.x, -(m.z - p.z)));
    const close = 1 - clamp(m.d / this.pulseRange, 0, 1);
    if (Math.abs(rel) <= Math.PI / 2) {
      const j = this.diff.trkJitter * (p.moveAmt > 0.15 ? 1.5 : 1);
      this.blips.push({x: m.x + (this.rand() * 2 - 1) * j, z: m.z + (this.rand() * 2 - 1) * j, t: T});
      if (this.blips.length > TRACKER.maxBlips) this.blips.shift();
      s.sounds.trackerReturn(close, Math.sin(rel) * 0.6);
      buzz(Math.round(6 + close * 30), 150);
      if (!this.seen) { this.seen = true; this.events.push('contact'); }
    } else if (this.diff.trkBehind) {
      if (rel > 0) this.behindR = 1; else this.behindL = 1;
      s.sounds.trackerReturn(close * 0.6, rel > 0 ? 0.7 : -0.7);
    }
    // right on top of you: the screen floods and the beeps go frantic, wherever it is
    if (m.d < TRACKER.close) { this.flood = 1; s.sounds.trackerFrantic(); this.events.push('close'); }
  }

  /**
   * Blips in screen space for the shader, 4 floats each: x across the fan (-1..1), y ahead (0..1),
   * brightness, and how fresh (1 just found, falling to 0). Turning turns them, like the real thing.
   */
  pack(T, p, out) {
    out.fill(0);
    const R = this.diff.trkRange;
    for (let i = 0; i < this.blips.length && i < TRACKER.maxBlips; i++) {
      const b = this.blips[i], dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz);
      const rel = angleDiff(p.yaw, Math.atan2(dx, -dz)), age = (T - b.t) / this.diff.trkFade;
      const y = Math.cos(rel) * d / R;
      if (y < -0.02) continue;
      out[i * 4] = Math.sin(rel) * d / R; out[i * 4 + 1] = Math.max(0, y);
      out[i * 4 + 2] = clamp(1 - age, 0, 1) ** 1.5; out[i * 4 + 3] = clamp(1 - age * 3, 0, 1);
    }
    return out;
  }
}
