// What is in your hands. The scanner and the motion tracker share them: raising one puts the other
// away. Pressing SCAN or SWEEP with the tracker up swaps back to the scanner, so those buttons always do
// something, and sprinting puts the tracker away too.

import {TRACKER} from '../config.js';

export class Hands {
  constructor() { this.out = {fire: false, sweep: false}; this.reset(); }

  reset() {
    this.want = 'gun';
    this.gun = 1; this.trk = 0;  // how far up each device is, 0..1
    this.peek = 0;               // a dead tracker lifted a little and dropped again
    this.pendingSweep = false;
    this.out.fire = false; this.out.sweep = false;
  }

  get trackerUp() { return this.want === 'tracker' && this.trk > 0.95; }
  get gunReady() { return this.want === 'gun' && this.gun > 0.9; }

  /** Returns what the scanner may do this frame. `s` is the session (tracker, scanner, player, sounds). */
  update(dt, T, intent, s) {
    const tr = s.tracker, sc = s.scanner, out = this.out;
    if (intent.track) {
      if (this.want === 'tracker') this.want = 'gun';
      else if (tr && tr.owned) {
        if (tr.battery > 0) this.want = 'tracker';
        else { s.sounds.trackerClick(); this.peek = 1; }
      }
    }
    if (this.want === 'tracker') {
      // the scanner always answers: the tracker goes down for it (unless it is too hot to fire anyway)
      if (intent.firing && !sc.overheated) this.want = 'gun';
      if (intent.sweep) {
        if (sc.cooldown > 0 || sc.sweeping) s.sounds.denied();
        else { this.want = 'gun'; this.pendingSweep = true; }
      }
      if (s.player.sprinting || !tr || tr.battery <= 0) this.want = 'gun';
    } else if (intent.sweep) this.pendingSweep = true;

    // one comes down before the other comes up
    if (this.want === 'tracker') {
      this.gun = Math.max(0, this.gun - dt / TRACKER.gunDown);
      if (this.gun < 0.5) this.trk = Math.min(1, this.trk + dt / TRACKER.raise);
    } else {
      this.trk = Math.max(0, this.trk - dt / TRACKER.lower);
      if (this.trk < 0.5) this.gun = Math.min(1, this.gun + dt / TRACKER.gunUp);
    }
    this.peek = Math.max(0, this.peek - dt * 2.5);

    out.fire = !!intent.firing && this.gunReady;
    out.sweep = this.pendingSweep && this.gunReady;
    if (out.sweep) this.pendingSweep = false;
    return out;
  }
}
