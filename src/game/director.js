// The creature's pacing. A horror game is not scary if the monster is always on you, or never is, so as
// in Alien: Isolation there are two minds. The creature only knows what it hears and feels. This director
// knows where you really are, and it never tells the creature that. It does two things, by turns:
//
//   build   It has been too long since anything happened. It gives the creature a vague hunch which part of
//           the level to wander toward: tens of metres wide at first, narrowing only slowly. The creature
//           still has to find you by ear.
//   relax   You have been under pressure long enough. It lets the creature lose interest: it wanders off,
//           stops following footsteps and stops setting traps, for a breather before the next peak.
//           A hunt already under way is not called off, and making noise still brings it. A breather is
//           earned by surviving, never by being loud.
//
// How much pressure counts as enough, and how long the breathers are, go with difficulty.

import {clamp} from '../util/math.js';

export class Director {
  constructor(diff, rand) {
    this.diff = diff; this.rand = rand;
    this.phase = 'build';
    this.menace = 0;         // 0 nothing is happening .. 1 you have had all you can take
    this.relaxLeft = 0;
    this.quiet = 0;          // seconds since you and it were last anywhere near each other
    this.hunchT = 0;
    this.relaxes = 0;
  }

  get relaxing() { return this.phase === 'relax'; }

  /** A breather starting now: after a respawn, say. */
  rest(seconds) {
    this.phase = 'relax'; this.relaxLeft = Math.max(this.relaxLeft, seconds); this.menace = Math.min(this.menace, 0.5);
    this.quiet = 0;
  }

  /** Advance one frame. `st` is the creature; `player` is where you really are. */
  update(dt, st, player) {
    const {diff} = this;
    if (st.state === 'finale' || !st.active) return;
    const close = clamp(1 - st.playerDist / 18, 0, 1);
    const heat = st.state === 'hunt' || st.state === 'alert' ? 1
      : st.state === 'linger' ? 0.9
        : st.state === 'stalk' || st.state === 'flank' ? 0.7
          : st.state === 'search' || st.state === 'feint' ? 0.45
            : close * close * 0.5;
    this.menace = clamp(this.menace + (heat > 0.08 ? heat * dt / diff.peakSpan : -dt / (diff.peakSpan * 1.6)), 0, 1);
    this.quiet = st.playerDist < 12 || heat >= 0.45 ? 0 : this.quiet + dt;

    if (this.phase === 'build') {
      if (this.menace >= 1 && !st.hunting && st.state !== 'alert') {
        this.phase = 'relax'; this.relaxLeft = diff.relax; this.relaxes++;
        st.leaveOff();
      } else if (this.quiet > diff.hunchAfter && (this.hunchT -= dt) <= 0) {
        this.hunchT = 7 + this.rand() * 5;
        // the longer the quiet, the less vague the hunch; never less than a room or two
        const over = this.quiet - diff.hunchAfter, sigma = clamp(13 - over * 0.12, 8, 13);
        const jx = (this.rand() - 0.5) * sigma, jz = (this.rand() - 0.5) * sigma;
        st.hunch(player.x + jx, player.z + jz, sigma);
      }
    } else if ((this.relaxLeft -= dt) <= 0 && this.menace < 0.6) {
      this.phase = 'build'; this.menace = Math.min(this.menace, 0.3); this.quiet = 0;
    }
  }
}
