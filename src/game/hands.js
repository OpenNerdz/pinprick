// What is in your hands: the scanner in one, the motion tracker in the other. The tracker comes up and
// goes down on its own button and the scanner works the whole time. Sprinting puts the tracker away
// (you cannot read it at a run). When its cell gives out you are left holding it for a moment while the
// tube dies, and a dead one only lifts a little when you try it.

import {TRACKER} from '../config.js';

/** Seconds you are left looking at it after the cell gives out. */
export const DYING = 0.95;
// it is heavy: this much longer going down than TRACKER.lower, which only says when it stops working
const HEAVY = 1.9;

export class Hands {
  constructor() { this.out = {fire: false, sweep: false}; this.reset(); }

  reset() {
    this.want = 'gun';           // 'tracker' while the tracker is wanted up
    this.gun = 1; this.trk = 0;  // how far up each device is, 0..1 (the scanner never goes down)
    this.peek = 0;               // a dead tracker lifted a little and dropped again
    this.dying = 0;              // seconds left of holding one whose cell has just given out
    this.out.fire = false; this.out.sweep = false;
  }

  get trackerUp() { return this.want === 'tracker' && this.trk > 0.95; }

  /** Returns what the scanner may do this frame. `s` is the session (tracker, player, sounds). */
  update(dt, T, intent, s) {
    const tr = s.tracker, out = this.out, sprinting = s.player.sprinting;
    if (intent.track) {
      if (this.want === 'tracker') this.want = 'gun';
      else if (tr && tr.owned) {
        if (tr.battery > 0) this.want = 'tracker';
        else { s.sounds.trackerClick(); this.peek = 1; }
      }
    }
    if (this.want === 'tracker' && (sprinting || !tr || tr.battery <= 0)) {
      if (!sprinting && tr && this.trk > 0.5) this.dying = DYING;
      this.want = 'gun';
    }
    this.dying = sprinting || this.want === 'tracker' ? 0 : Math.max(0, this.dying - dt);
    if (this.want === 'tracker') this.trk = Math.min(1, this.trk + dt / TRACKER.raise);
    else if (this.dying <= 0) this.trk = Math.max(0, this.trk - dt / (TRACKER.lower * HEAVY));
    this.peek = Math.max(0, this.peek - dt * 1.7);
    out.fire = !!intent.firing; out.sweep = !!intent.sweep;
    return out;
  }
}
