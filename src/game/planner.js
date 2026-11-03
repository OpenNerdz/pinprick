// Where the creature goes next when nothing in particular is calling it. Instead of picking a patrol point
// at random, it weighs up every place worth going against what it believes: how long since it checked there,
// how likely you are to be there right now, where it has heard you before, hiding places it knows you use,
// and chokepoints worth waiting at, against how far it has to walk. A little randomness keeps it from being
// predictable, and its temperament decides how much.

import {STALKER} from '../config.js';

const SEEN_R = 3.5;      // passing this close counts as having checked a spot
const STALE_AFTER = 90;  // seconds until a spot is fully due another look

export class Planner {
  constructor(st) {
    this.st = st;
    const spots = this.spots = [], {cfg, topo, nav} = st;
    const add = (x, z, kind, extra) => {
      if (!nav.walkableAt(x, z)) return;
      if (spots.some(q => q.kind === kind && Math.hypot(q.x - x, q.z - z) < 2)) return;
      spots.push({x, z, kind, seen: -STALE_AFTER * st.brainRand(), ...extra});
    };
    for (const [i, p] of cfg.patrol.entries()) add(p[0], p[1], 'patrol', {i});
    for (const r of topo.rooms) if (r.standable && r.area >= 16) add(r.x, r.z, 'room');
    for (const c of topo.chokes) if (!c.crawl && c.standable && c.rooms.length >= 2) add(c.x, c.z, 'choke', {choke: c});
    for (const [i, h] of st.hides.entries()) {
      const at = nav.nearest(h.x, h.z, 2.6);
      if (at >= 0) add(nav.cx(at), nav.cz(at), 'hide', {i});
    }
    this.last = null;
  }

  /** Anywhere it passes counts as checked. */
  markSeen(T) {
    const {x, z} = this.st;
    for (const s of this.spots) if (Math.hypot(s.x - x, s.z - z) < SEEN_R) s.seen = T;
  }

  /** How much it wants to go to `s` right now. */
  score(s, T, d) {
    const {st} = this, {belief, memory, diff, temper, director} = st, p = st.player;
    const stale = Math.min(1, (T - s.seen) / STALE_AFTER);
    const odds = Math.min(1, belief.oddsNear(s.x, s.z, 4) / 4);
    const adapt = diff.adapt;
    let v = stale * 1.2 + odds * 2.4 + memory.heatAt(s.x, s.z) * 0.7 * adapt - d / 45;
    if (s.kind === 'hide') {
      // its reason to go and stand by a hiding place: it has caught you using this one
      const n = memory.hideCount(s.i);
      v += (n > 0 ? Math.min(1, n / 3) * 1.6 * adapt : -0.6) + memory.weight('hide') * 0.5 * adapt;
    }
    if (s.kind === 'choke') v -= 0.35; // worth it only if it has good reason to be near
    if (director.relaxing && p) v -= 2.2 * Math.max(0, 1 - Math.hypot(s.x - p.x, s.z - p.z) / 22); // it has wandered off you
    return v + st.brainRand() * (0.55 + temper.curious * 0.6);
  }

  /**
   * The next place to go, or null when `avoid` (a player out in the open it must not blunder into) blocks
   * every way on. Just after a respawn it keeps clear of where you came back, if it can.
   */
  next(T, avoid = null) {
    const {st} = this, {nav} = st, f = st.field, g = st.graceFor > 0 && st.avoid;
    const scored = [];
    for (const s of this.spots) {
      if (s === this.last) continue;
      const d = nav.distAt(f, s.x, s.z, 0.6);
      if (!isFinite(d) || d < 2) continue;
      scored.push({s, v: this.score(s, T, d), far: !g || Math.hypot(s.x - st.avoid.x, s.z - st.avoid.z) >= STALKER.respawnClear});
    }
    scored.sort((a, b) => b.v - a.v);
    for (const pass of g ? [true, false] : [false]) for (const c of scored) {
      if (pass && !c.far) continue;
      if (avoid && !st.routeClear([c.s.x, c.s.z], avoid)) continue;
      this.last = c.s;
      return c.s;
    }
    return null;
  }
}
