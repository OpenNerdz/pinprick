// What is in your hands: the scanner in one, the motion tracker in the other. The tracker comes up and
// goes down on its own button and the scanner works the whole time. Sprinting puts the tracker away
// (you cannot read it at a run), and a dead one only lifts a little when you try it.

import {TRACKER} from '../config.js';

export class Hands {
  constructor() { this.out = {fire: false, sweep: false}; this.reset(); }

  reset() {
    this.want = 'gun';           // 'tracker' while the tracker is wanted up
    this.gun = 1; this.trk = 0;  // how far up each device is, 0..1 (the scanner never goes down)
    this.peek = 0;               // a dead tracker lifted a little and dropped again
    this.out.fire = false; this.out.sweep = false;
  }

  get trackerUp() { return this.want === 'tracker' && this.trk > 0.95; }

  /** Returns what the scanner may do this frame. `s` is the session (tracker, player, sounds). */
  update(dt, T, intent, s) {
    const tr = s.tracker, out = this.out;
    if (intent.track) {
      if (this.want === 'tracker') this.want = 'gun';
      else if (tr && tr.owned) {
        if (tr.battery > 0) this.want = 'tracker';
        else { s.sounds.trackerClick(); this.peek = 1; }
      }
    }
    if (this.want === 'tracker' && (s.player.sprinting || !tr || tr.battery <= 0)) this.want = 'gun';
    this.trk = this.want === 'tracker' ? Math.min(1, this.trk + dt / TRACKER.raise) : Math.max(0, this.trk - dt / TRACKER.lower);
    this.peek = Math.max(0, this.peek - dt * 2.5);
    out.fire = !!intent.firing; out.sweep = !!intent.sweep;
    return out;
  }
}
