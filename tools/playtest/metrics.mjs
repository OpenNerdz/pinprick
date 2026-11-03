// Watches a run from outside, with full knowledge (unlike the bots), and produces one summary: pacing,
// tension and everything stupid the creature did. Fed plain frames, so the detectors can be tested with
// made-up ones. Tolerates state names it has never seen: time is counted under whatever `state` says.

export const THRESH = {
  stuckAfter: 5, stuckMove: 0.4,
  oscFlips: 6, oscWindow: 15, targetJump: 2, targetCycles: 4, targetWindow: 20, ditherWindow: 12, ditherLen: 15, ditherBox: 4,
  campAfter: 25, campBox: 3, campFar: 15,
  stillFor: 1.5, noticedWindow: 5, warnWindow: 3, alertMin: 0.8,
  maxSpeed: 8, offGridFrames: 6, fleeShort: 15,
  encounterNear: 8, encounterMerge: 3, peakDrop: 6, peakUnder: 20, far: 25,
};

// walking on purpose, or at least not idling, when the game does not report a speed
const MOVING = new Set(['patrol', 'investigate', 'flee', 'finale']);
const CALM = new Set(['patrol', 'investigate', 'listen', 'wait']);
const DELIBERATE = new Set(['wait', 'linger', 'dormant']);          // standing still is the point of these
const ENGAGED = /hunt|alert|stalk|linger|search|chase|pounce|feint|intercept|ambush/;
const NOTICED = /hunt|alert|finale|chase|pounce|intercept/;

export const PATHOLOGIES = ['stuck', 'oscillation', 'camping', 'unfair', 'impossible', 'never', 'shortflee'];

export class Observer {
  constructor(meta = {}, {deliberate = []} = {}) {
    this.meta = meta;
    this.deliberate = new Set([...DELIBERATE, ...deliberate]);
    this.stateTime = {}; this.time = 0; this.activeTime = 0;
    this.prev = null; this.pathologies = []; this.counts = {};
    this.hunts = 0; this.escapes = 0; this.repels = 0; this.deaths = 0; this.inHunt = false;
    this.flips = []; this.oscEp = null; this.lastDist = Infinity;
    this.targets = []; this.curTarget = null; this.lastTargetFlag = -99;
    this.trail = []; this.trailNext = 0; this.lastDitherFlag = -99;
    this.stuckX = 0; this.stuckZ = 0; this.stuckT = 0; this.stuckGap = 0; this.stuckFlagged = false;
    this.campX = NaN; this.campZ = 0; this.campT = 0; this.campFlagged = false;
    this.offGrid = 0; this.offFlagged = false; this.teleportT = -99; this.fastFlagged = -99;
    this.lastNoticedT = -99; this.alertAt = -99; this.state = null;
    // pacing
    this.enc = null; this.encounters = 0; this.finaleEnc = 0; this.gaps = []; this.quietFrom = null; this.lastEnc = null;
    // tension
    this.t8 = 0; this.t25 = 0; this.distSum = 0; this.distT = 0; this.peaks = 0; this.pkMode = 'falling'; this.pkLo = Infinity; this.pkHi = -Infinity; this.dists = [];
    this.kills = {moving: 0, still: 0, stillNoticed: 0, hiddenFinale: 0, finale: 0, fast: 0};
    this.killStates = {};
  }

  flag(type, t, detail) {
    this.counts[type] = (this.counts[type] || 0) + 1;
    if (this.counts[type] <= 5) this.pathologies.push({type, t: Math.round(t * 10) / 10, ...this.meta, detail});
  }

  /** The game moved it on purpose (a respawn, the last chase starting): not a speed to worry about. */
  teleport(T) { this.teleportT = T; this.prev = null; this.campX = NaN; this.stuckT = 0; this.trail.length = 0; }

  /**
   * One frame of play. f: {T, dt, state, x, z, speed, pinned, deliberate, target, walkable,
   *   dist (creature's path distance to the player), px, pz}
   */
  frame(f) {
    const {T, dt, state} = f;
    this.time += dt;
    this.stateTime[state] = (this.stateTime[state] || 0) + dt;
    if (state === 'dormant') { this.prev = null; return; }
    this.activeTime += dt;
    this.lastDist = f.dist;
    if (this.state !== state) { this.transition(this.state, state, T); this.state = state; }
    if (NOTICED.test(state)) this.lastNoticedT = T;
    this.pacing(f);
    this.tension(f);
    this.detectStuck(f);
    this.detectOscillation(f);
    this.detectCamping(f);
    this.detectImpossible(f);
    this.prev = f;
  }

  transition(from, to, T) {
    if (from === 'flee' && this.lastDist < THRESH.fleeShort) this.flag('shortflee', T, `ran from the light and stopped ${this.lastDist.toFixed(0)}m from the player`);
    if (to === 'alert') this.alertAt = T;
    if (to === 'hunt' && !this.inHunt) { this.hunts++; this.inHunt = true; if (from !== 'alert') this.alertAt = T; }
    if (to === 'flee') { this.repels++; this.inHunt = false; }
    else if (this.inHunt && CALM.has(to)) { this.escapes++; this.inHunt = false; }
    else if (this.inHunt && to === 'finale') this.inHunt = false;
    if (from) {
      this.flips.push({T, a: from, b: to});
      const f = this.flips;
      while (f.length && T - f[0].T > THRESH.oscWindow) f.shift();
      if (f.length >= THRESH.oscFlips) {
        const tail = f.slice(-THRESH.oscFlips), set = new Set(tail.flatMap(x => [x.a, x.b]));
        if (set.size === 2) {
          // one long flip-flop is one episode; note how long it went on and how far it walked meanwhile
          const key = [...set].sort().join('<>'), ep = this.oscEp;
          if (ep && ep.key === key && T - ep.last < THRESH.oscWindow) { ep.last = T; if (ep.rec) ep.rec.detail = `states ${key} for ${(T - ep.start).toFixed(0)}s, player ${this.lastDist.toFixed(0)}m`; }
          else { const n = this.pathologies.length; this.flag('oscillation', T, `states ${key} x${tail.length} in ${THRESH.oscWindow}s, player ${this.lastDist.toFixed(0)}m`); this.oscEp = {key, start: T, last: T, rec: this.pathologies[n] || null}; }
        }
      }
    }
  }

  pacing(f) {
    const {T, state, dist} = f;
    const finale = state === 'finale';
    const engaged = ENGAGED.test(state) || finale || dist < THRESH.encounterNear;
    if (engaged) {
      if (!this.enc) {
        this.enc = {start: T, end: T, finale, hunted: false};
        if (finale) this.finaleEnc++; else this.encounters++;
        const q = this.lastEnc;
        const from = q ? q.end : this.quietFrom;
        if (from != null) this.gaps.push({len: T - from, after: q ? (q.died ? 'death' : q.hunted ? 'hunt' : 'contact') : 'start'});
        this.lastEnc = null;
      }
      this.enc.end = T;
      if (/hunt/.test(state)) this.enc.hunted = true;
      if (finale && !this.enc.finale) { this.enc.finale = true; this.finaleEnc++; }
    } else {
      if (this.quietFrom == null) this.quietFrom = T;
      if (this.enc && T - this.enc.end > THRESH.encounterMerge) { this.lastEnc = this.enc; this.enc = null; }
    }
  }

  tension({dt, dist}) {
    const d = isFinite(dist) ? dist : 60;
    if (d < THRESH.encounterNear) this.t8 += dt;
    if (d > THRESH.far) this.t25 += dt;
    this.distSum += d * dt; this.distT += dt;
    if (this.pkMode === 'falling') {
      if (d < this.pkLo) this.pkLo = d;
      if (d > this.pkLo + THRESH.peakDrop) { if (this.pkLo <= THRESH.peakUnder) this.peaks++; this.pkMode = 'rising'; this.pkHi = d; }
    } else {
      if (d > this.pkHi) this.pkHi = d;
      if (d < this.pkHi - THRESH.peakDrop) { this.pkMode = 'falling'; this.pkLo = d; }
    }
  }

  isMoving(f) {
    if (f.pinned) return false;
    return f.speed !== undefined ? f.speed > 0 : MOVING.has(f.state);
  }

  detectStuck(f) {
    if (this.isMoving(f)) {
      this.stuckGap = 0;
      if (Math.hypot(f.x - this.stuckX, f.z - this.stuckZ) < THRESH.stuckMove) {
        this.stuckT += f.dt;
        if (this.stuckT > THRESH.stuckAfter && !this.stuckFlagged) { this.stuckFlagged = true; this.flag('stuck', f.T, `state ${f.state} at ${f.x.toFixed(1)},${f.z.toFixed(1)} player ${f.dist.toFixed(0)}m`); }
      } else { this.stuckX = f.x; this.stuckZ = f.z; this.stuckT = 0; this.stuckFlagged = false; }
    } else if ((this.stuckGap += f.dt) > 1) { this.stuckT = 0; this.stuckFlagged = false; this.stuckX = f.x; this.stuckZ = f.z; }
  }

  detectOscillation(f) {
    const {T, target} = f;
    // target flip-flop: jumping between the same two spots
    if (target && isFinite(target.x)) {
      const c = this.curTarget;
      if (!c || Math.hypot(c.x - target.x, c.z - target.z) > THRESH.targetJump) {
        this.curTarget = {x: target.x, z: target.z};
        const q = this.targets;
        q.push({T, x: target.x, z: target.z});
        while (q.length && T - q[0].T > THRESH.targetWindow) q.shift();
        let run = 0;
        for (let i = q.length - 1; i >= 2; i--) { if (Math.hypot(q[i].x - q[i - 2].x, q[i].z - q[i - 2].z) < 1 && Math.hypot(q[i].x - q[i - 1].x, q[i].z - q[i - 1].z) > THRESH.targetJump) run++; else break; }
        if (run >= THRESH.targetCycles * 2 - 2 && T - this.lastTargetFlag > THRESH.targetWindow) { this.lastTargetFlag = T; this.flag('oscillation', T, `target flipping (${f.state}) ${target.x.toFixed(0)},${target.z.toFixed(0)} x${run}`); }
      }
    }
    // dithering: a lot of walking and nowhere gone
    if (T >= this.trailNext) {
      this.trailNext = T + 0.5;
      const q = this.trail;
      q.push({T, x: f.x, z: f.z});
      while (q.length && T - q[0].T > THRESH.ditherWindow) q.shift();
      if (q.length > 4 && T - q[0].T > THRESH.ditherWindow - 1 && T - this.lastDitherFlag > THRESH.ditherWindow) {
        let len = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < q.length; i++) { if (i) len += Math.hypot(q[i].x - q[i - 1].x, q[i].z - q[i - 1].z); x0 = Math.min(x0, q[i].x); x1 = Math.max(x1, q[i].x); z0 = Math.min(z0, q[i].z); z1 = Math.max(z1, q[i].z); }
        if (len > THRESH.ditherLen && x1 - x0 < THRESH.ditherBox && z1 - z0 < THRESH.ditherBox) { this.lastDitherFlag = T; this.flag('oscillation', T, `dither ${len.toFixed(0)}m in a ${THRESH.ditherBox}m box (${f.state})`); }
      }
    }
  }

  detectCamping(f) {
    if (!(Math.hypot(f.x - this.campX, f.z - this.campZ) <= THRESH.campBox)) { this.campX = f.x; this.campZ = f.z; this.campT = 0; this.campFlagged = false; return; }
    if (this.deliberate.has(f.state) || f.deliberate) return; // doesn't count, doesn't reset
    if (f.dist < THRESH.campFar) { this.campT = 0; return; }
    this.campT += f.dt;
    if (this.campT > THRESH.campAfter && !this.campFlagged) { this.campFlagged = true; this.flag('camping', f.T, `${f.state} at ${f.x.toFixed(1)},${f.z.toFixed(1)}, player ${isFinite(f.dist) ? f.dist.toFixed(0) : '?'}m`); }
  }

  detectImpossible(f) {
    const p = this.prev;
    if (p && f.dt > 0 && f.T - this.teleportT > 0.1) {
      const v = Math.hypot(f.x - p.x, f.z - p.z) / f.dt;
      if (v > THRESH.maxSpeed && f.T - this.fastFlagged > 2) { this.fastFlagged = f.T; this.flag('impossible', f.T, `${v.toFixed(1)} m/s in ${f.state} at ${f.x.toFixed(1)},${f.z.toFixed(1)}`); }
    }
    if (f.walkable === false) {
      if (++this.offGrid >= THRESH.offGridFrames && !this.offFlagged) { this.offFlagged = true; this.flag('impossible', f.T, `off the walkable grid in ${f.state} at ${f.x.toFixed(1)},${f.z.toFixed(1)}`); }
    } else { this.offGrid = 0; this.offFlagged = false; }
  }

  /** It got you. k: {T, state, pstill, scanning, hidden, warnT, moving, distAtCatch}. */
  caught(k) {
    const {T, state} = k;
    this.deaths++;
    this.killStates[state] = (this.killStates[state] || 0) + 1;
    const stillQuiet = k.pstill >= THRESH.stillFor && !k.scanning;
    const noticed = T - this.lastNoticedT < THRESH.noticedWindow;
    if (state === 'finale') { this.kills.finale++; if (k.hidden) this.kills.hiddenFinale++; }
    else if (stillQuiet && noticed) this.kills.stillNoticed++;
    else if (stillQuiet) this.kills.still++;
    else this.kills.moving++;
    if (stillQuiet && !noticed && state !== 'finale') this.flag('unfair', T, `still ${k.pstill.toFixed(1)}s and quiet, unnoticed, taken in ${state}`);
    if (state !== 'finale') {
      const since = T - this.alertAt, fresh = since > 20 ? 0 : since;
      if (fresh < THRESH.alertMin) this.kills.fast++;
      const silent = (since > 20 ? T : this.alertAt) - k.warnT;
      if (fresh < THRESH.alertMin && silent > THRESH.warnWindow) this.flag('unfair', T, `no warning: ${fresh.toFixed(2)}s after alert, nothing to hear or see for ${silent.toFixed(1)}s before, in ${state}`);
    }
    this.inHunt = false;
    if (this.enc) { this.enc.died = true; this.lastEnc = this.enc; this.enc = null; }
    this.prev = null; this.campX = NaN; this.stuckT = 0; this.state = null;
  }

  /** Summary of the run. `end` is {outcome, time, coresGot, coresTotal, T}. */
  finish(end) {
    if (this.encounters === 0) this.flag('never', end.T ?? this.time, `no encounter in ${this.time.toFixed(0)}s before ${this.finaleEnc ? 'the last chase' : 'the end'}`);
    if (this.enc) this.lastEnc = this.enc;
    const gaps = this.gaps.map(g => g.len);
    const last = this.lastEnc ? (end.T ?? 0) - this.lastEnc.end : this.quietFrom != null && !this.encounters ? (end.T ?? 0) - this.quietFrom : 0;
    if (last > 0) gaps.push(last);
    const after = what => this.gaps.filter(g => g.after === what).map(g => g.len);
    const min = a => a.length ? Math.min(...a) : null;
    const T = this.activeTime || 1;
    return {
      ...end,
      deaths: this.deaths, activeTime: round(this.activeTime),
      stateTime: Object.fromEntries(Object.entries(this.stateTime).map(([k, v]) => [k, round(v)])),
      hunts: this.hunts, escapes: this.escapes, repels: this.repels, encounters: this.encounters,
      gaps: gaps.map(round),
      longestQuiet: gaps.length ? round(Math.max(...gaps)) : null,
      minBreather: round(min(after('hunt'))), minAfterDeath: round(min(after('death'))),
      peaks: this.peaks, peaksPerMin: round(this.peaks / (T / 60)),
      pct8: round(100 * this.t8 / T), pct25: round(100 * this.t25 / T), distMean: round(this.distSum / T),
      kills: this.kills, killStates: this.killStates,
      counts: this.counts, pathologies: this.pathologies,
    };
  }
}

const round = v => (v == null ? null : Math.round(v * 10) / 10);
