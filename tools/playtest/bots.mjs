// The personas. A bot sees only a Perception (tools/playtest/perception.mjs) and answers with an intent,
// the same object the input layer gives the real game. It has no way to reach the game itself.

const TAU = Math.PI * 2;
const angleDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };
const yawTo = (me, x, z) => Math.atan2(x - me.x, -(z - me.z));
const TURN = 7;               // rad/s: a fast mouse flick
const CLICK_HOLD = {click: 1.55, clickShort: 0.95}; // seconds from the sound to the far side of its echo (longest of any difficulty)

const blank = () => ({moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false});

/** What the bot has worked out about the creature, from what reached it. Never its true position. */
class Threat {
  constructor() { this.reset(); }
  reset() {
    this.x = NaN; this.z = NaN; this.t = -99; this.dist = Infinity;
    this.clickT = -99; this.clickHold = 0; this.clickDist = Infinity; this.echoT = -99;
    this.shriekT = -99; this.gallopT = -99; this.fastGallopT = -99; this.stingT = -99;
    this.lingerT = -99; this.litT = -99; this.lit = null; this.blipT = -99; this.flash = -99;
    this.doubled = 0; this.doubledT = -99;
  }
  note(e, T) { if (isFinite(e.x)) { this.x = e.x; this.z = e.z; this.t = T; this.dist = e.dist; } }
  update(p, T) {
    for (const e of p.heard) {
      if (e.kind === 'sting') { this.stingT = T; continue; }
      if (e.kind !== 'mimic') this.note(e, T); // a mimic is where it is too, but it is meant to fool you
      switch (e.kind) {
        case 'click': case 'clickShort': this.clickT = e.t; this.clickHold = CLICK_HOLD[e.kind]; this.clickDist = e.dist; break;
        case 'gallop': if (e.t - this.gallopT < 0.45) this.fastGallopT = T; this.gallopT = e.t; break;
        case 'shriek': this.shriekT = T; break;
        case 'exhale': if (e.dist < 6) this.lingerT = T; break;
        case 'step': // following you, the only steps it makes land just after yours; any other step and it is just walking
          if (e.afterOwnStep >= 0.08 && e.afterOwnStep < 0.17) { this.doubled++; this.doubledT = T; } else this.doubled = 0;
          break;
      }
    }
    for (const s of p.says) {
      if (/Don't move/.test(s)) this.lingerT = T;
      if (/sound doubled/.test(s)) { this.doubled = 3; this.doubledT = T; }
    }
    if (p.me.redFlash) this.flash = T;
    if (p.echo) this.echoT = p.echo.t;
    if (p.lit) { this.lit = p.lit; this.litT = T; this.x = p.lit.x; this.z = p.lit.z; this.t = T; this.dist = Math.hypot(p.lit.x - p.me.x, p.lit.z - p.me.z); }
    if (p.tracker.blips.length) { // the freshest blip: where something moved a moment ago
      const b = p.tracker.blips[p.tracker.blips.length - 1];
      if (b.t >= this.blipT) { this.blipT = b.t; this.x = b.x; this.z = b.z; this.t = T; this.dist = Math.hypot(b.x - p.me.x, b.z - p.me.z); }
    }
  }
  /** Inside the click-to-echo window: stay still. Within `range` metres by ear. */
  holding(T, range = 18) {
    if (this.clickDist > range) return false;
    const until = this.clickT + this.clickHold;
    return T < until && !(this.echoT > this.clickT && T > this.echoT + 0.2);
  }
  running(T) { return T - this.fastGallopT < 0.6; }
  hunted(T) { return T - this.shriekT < 6 || T - this.fastGallopT < 3 || T - this.stingT < 3 || (T - this.clickT < 3 && this.clickHold === CLICK_HOLD.clickShort); }
  lingering(T) { return T - this.lingerT < 6.5; }
  stalked(T) { return this.doubled >= 3 && T - this.doubledT < 5; }
  near(T, metres, secs) { return T - this.t < secs && this.dist < metres; }
  lastPos(T, secs) { return T - this.t < secs && isFinite(this.x) ? this : null; }
}

class Bot {
  sneak = false;
  constructor(perc, rand) {
    this.p = perc; this.rand = rand;
    this.th = new Threat();
    this.mode = 'start'; this.it = null; this.T = 0; this.dt = 0;
    this.fields = new Map(); this.fieldVer = -1;
    this.cells = []; this.wx = NaN; this.wz = NaN; this.repathIn = 0; this.goalKey = null;
    this.wantCrouch = false; this.crouchCool = 0; this.trackCool = 0;
    this.lastX = 0; this.lastZ = 0; this.progT = 0; this.stuckT = 0; this.wiggleUntil = 0; this.wiggle = 1;
    this.burstT = 0; this.nextLight = 0; this.trust = 0;
    this.probe = null; this.probeAt = -99; this.sigT = -99; this.bars = 0; this.readStart = null; this.lookUntil = 0; this.lookTime = 2.1; this.lookedAt = null; this.lookedT = -99;
    this.stats = {frames: 0, sneak: 0, sprint: 0, walk: 0, still: 0, scan: 0, tracker: 0, hidden: 0, throws: 0, breath: 0, modes: {}};
  }

  onRespawn() { this.th.reset(); this.probe = null; this.readStart = null; this.lookUntil = 0; this.settleUntil = 0; this.wantCrouch = false; this.burstT = 0; this.nextLight = 0; this.fields.clear(); }

  /** This frame's intent. */
  frame(T, dt) {
    const me = this.p.me, it = this.it = blank();
    this.T = T; this.dt = dt;
    this.th.update(this.p, T);
    this.mode = this.decide();
    if (this.wantCrouch !== me.crouched && !it.sprint && T >= this.crouchCool) { it.crouch = true; this.crouchCool = T + 0.25; }
    this.tally(me, it);
    return it;
  }

  tally(me, it) {
    const s = this.stats;
    s.frames++; s.modes[this.mode] = (s.modes[this.mode] || 0) + 1;
    if (me.firing) s.scan++;
    if (this.p.tracker.up) s.tracker++;
    if (me.hidden) s.hidden++;
    if (!it.moveX && !it.moveY) s.still++;
    else if (me.sprinting) s.sprint++;
    else if (me.crouched) s.sneak++;
    else s.walk++;
    if (it.holdBreath) s.breath++;
  }

  // ------------------------------------------------------------------------- moving about

  fieldTo(x, z) {
    const m = this.p.map;
    if (m.version !== this.fieldVer) { this.fields.clear(); this.fieldVer = m.version; }
    const key = `${Math.round(x * 2)},${Math.round(z * 2)}`;
    let f = this.fields.get(key);
    if (!f) {
      if (this.fields.size > 8) this.fields.delete(this.fields.keys().next().value);
      f = m.field(x, z);
      this.fields.set(key, f);
    }
    return f;
  }

  /** Turn toward a yaw at a human rate. */
  turnTo(yaw) { const d = angleDiff(this.p.me.yaw, yaw), m = TURN * this.dt; this.it.lookX = Math.max(-m, Math.min(m, d)); return Math.abs(d); }
  pitchTo(want) { const d = this.p.me.pitch - want, m = TURN * this.dt; this.it.lookY = Math.max(-m, Math.min(m, d)); }
  /** Look at a point on the ground, `y` metres up. Returns how far off the view is, radians. */
  aimAt(x, z, y = 0.9) {
    const me = this.p.me;
    this.pitchTo(Math.atan2(y - me.eye, Math.max(0.5, Math.hypot(x - me.x, z - me.z))));
    return this.turnTo(yawTo(me, x, z));
  }

  /** Work out the next waypoint on the way to a spot (this.wx, this.wz). Returns whether the way ahead is low. */
  steer(x, z) {
    const me = this.p.me, m = this.p.map;
    const key = `${Math.round(x * 2)},${Math.round(z * 2)},${m.version}`;
    if (key !== this.goalKey || --this.repathIn <= 0 || !isFinite(this.wx)) {
      this.goalKey = key; this.repathIn = 5;
      if (!m.descend(this.fieldTo(x, z), me.x, me.z, 16, this.cells) || !this.cells.length) {
        this.wx = x; this.wz = z;
      } else {
        const c = this.cells;
        let k = Math.min(c.length - 1, 1);
        for (let j = Math.min(c.length - 1, 12); j > 1; j--) if (m.lineClear(me.x, me.z, m.cx(c[j]), m.cz(c[j]))) { k = j; break; }
        this.wx = m.cx(c[k]); this.wz = m.cz(c[k]);
        if (c.length <= 2) { this.wx = x; this.wz = z; }
      }
    }
    let low = m.ceiling(me.x, me.z) < 1.8;
    for (let i = 0; i < this.cells.length && i < 6 && !low; i++) if (m.ceiling(m.cx(this.cells[i]), m.cz(this.cells[i])) < 1.8) low = true;
    return low;
  }

  /** Walk toward a spot along the player's grid. Returns false when already there or no way there. */
  go(x, z, {sprint = false, sneak = this.sneak, near = 0.5} = {}) {
    const me = this.p.me, it = this.it;
    if (Math.hypot(me.x - x, me.z - z) < near) return false;
    const low = this.steer(x, z);
    const err = this.turnTo(yawTo(me, this.wx, this.wz));
    this.pitchTo(this.lightWanted ? -0.14 : 0);
    this.wantCrouch = low || sneak;
    if (err < 1) it.moveY = 1;
    if (sprint && !low && !me.winded && err < 0.6) { it.sprint = true; this.wantCrouch = false; }
    this.unstick(it, x, z);
    return true;
  }

  /** Walking and getting nowhere: duck, or sidestep. */
  unstick(it) {
    const me = this.p.me, T = this.T;
    if (T < this.wiggleUntil) { it.moveX = this.wiggle; this.wantCrouch = true; return; }
    if (Math.hypot(me.x - this.lastX, me.z - this.lastZ) > 0.15) { this.lastX = me.x; this.lastZ = me.z; this.stuckT = 0; return; }
    if (it.moveY && (this.stuckT += this.dt) > 1.2) { this.stuckT = 0; this.wiggleUntil = T + 0.6; this.wiggle = this.rand() < 0.5 ? -1 : 1; this.repathIn = 0; }
  }

  /** Do the next few metres on the way need lighting? Only ground you could see from here. */
  needsLight() {
    const m = this.p.map, me = this.p.me, c = this.cells;
    if (this.T < this.trust) return false;
    for (const i of [3, 7, 11]) {
      if (i >= c.length) break;
      const x = m.cx(c[i]), z = m.cz(c[i]);
      if (m.litAge(x, z, this.T) > me.dotLife && m.lineClear(me.x, me.z, x, z)) return true;
    }
    return false;
  }

  /** Scan the way ahead while walking, or stopped for a burst (`stop`). Returns true if it took over this frame. */
  light({stop = false, maxBurst = 0.8} = {}) {
    const me = this.p.me, it = this.it;
    this.lightWanted = false;
    if (me.overheated || this.T < this.nextLight) return false;
    if (!this.needsLight()) { this.burstT = 0; return false; }
    if ((this.burstT += this.dt) > maxBurst) { this.burstT = 0; this.nextLight = this.T + 0.3; this.trust = this.T + 4; return false; } // no more to see from here
    this.lightWanted = true;
    if (Math.abs(angleDiff(me.yaw, yawTo(me, this.wx, this.wz))) < 0.5) it.firing = true;
    if (stop) { this.turnTo(yawTo(me, this.wx, this.wz)); this.pitchTo(-0.14); return true; }
    return false;
  }

  /**
   * Where to go next: a core you have seen; failing that, where the signal says the nearest one lies. Like a
   * person you stand still for a reading, walk to about where it points, look round, and read again.
   * Returns null while standing to read or looking round.
   */
  goal() {
    const me = this.p.me, T = this.T, sig = this.p.signal, p = this.p;
    if (me.coresLeft === 0) return p.map.exit;
    if (p.cores.length) { this.probe = null; return p.cores.reduce((a, b) => Math.hypot(a.x - me.x, a.z - me.z) <= Math.hypot(b.x - me.x, b.z - me.z) ? a : b); }
    for (const a of p.map.anchors) if (!a.seenAt && Math.hypot(a.x - me.x, a.z - me.z) < 3) a.seenAt = T;
    if (sig && sig.t > this.sigT && !sig.exit && (!this.probe || T - this.probeAt > 6)) { // a fresh ping
      this.sigT = sig.t; this.readStart = null;
      this.probe = this.probeFrom(sig); this.probeAt = T; this.bars = sig.bars;
    }
    if (T < this.lookUntil) return null;
    const there = this.probe && Math.hypot(this.probe.x - me.x, this.probe.z - me.z) < 1.5;
    if (this.probe && !there && T - this.probeAt < 30) return this.probe;
    if (there && this.bars >= 3 && (this.lookedAt !== this.probe || T - this.lookedT > 12)) { this.lookedAt = this.probe; this.lookedT = T; this.lookUntil = T + this.lookTime; return null; }
    // stand still for the next reading; static (or no ping for a good while) and you just try somewhere new
    if (this.readStart == null) this.readStart = T;
    if (T - this.readStart < 6) return null;
    this.readStart = null;
    this.probe = this.probeFrom(null); this.probeAt = T;
    return this.probe;
  }

  /** The place on the map nearest where this reading points, not one you have just been to. */
  probeFrom(sig) {
    const me = this.p.me, m = this.p.map;
    const d = sig ? Math.max(3, (1 - sig.bars / 5) * 30 + 3) : 12;
    const px = sig ? me.x + Math.sin(sig.bearing) * d : me.x + Math.sin(me.yaw) * d, pz = sig ? me.z - Math.cos(sig.bearing) * d : me.z - Math.cos(me.yaw) * d;
    const f = this.fieldTo(me.x, me.z);
    let best = null, bs = Infinity;
    for (const a of m.anchors) {
      if (!isFinite(m.dist(f, a.x, a.z))) continue;
      const s = Math.hypot(a.x - px, a.z - pz) + (a.seenAt != null && this.T - a.seenAt < 90 ? 14 : 0) + (sig ? 0 : this.rand() * 4);
      if (s < bs) { bs = s; best = a; }
    }
    return best;
  }

  /** On toward the goal. */
  route(opts = {}) {
    const g = this.goal(), me = this.p.me, it = this.it;
    if (!g) { // reading the signal, or scanning round for a core the bars say is close
      this.wantCrouch = opts.sneak ?? this.sneak;
      if (this.T < this.lookUntil && !me.overheated) { it.lookX = 3 * this.dt; this.pitchTo(0.2 * Math.sin(this.T * 5) - 0.02); it.firing = true; }
      return;
    }
    const light = opts.light ?? {stop: false};
    if (light && light !== 'none') { this.go(g.x, g.z, opts); if (this.light(light)) { it.moveY = 0; it.moveX = 0; } }
    else this.go(g.x, g.z, opts);
  }

  /** The last core is in: it knows where you are, so speed is all that matters. */
  finaleRun({beam = false} = {}) {
    const me = this.p.me, th = this.th, ex = this.p.map.exit, T = this.T;
    const close = th.near(T, 12, 2.5), a = th.lastPos(T, 1.5);
    const range = a ? Math.hypot(a.x - me.x, a.z - me.z) : Infinity;
    if (beam && range < 10 && !me.overheated && me.heat < 0.93) {
      // the light holds it: keep the beam on it and sidle on past, facing it
      const it = this.it, low = this.steer(ex.x, ex.z), off = this.aimAt(a.x, a.z);
      if (off < 0.5) it.firing = true;
      this.wantCrouch = low;
      let dx = this.wx - me.x, dz = this.wz - me.z;
      const d = Math.hypot(dx, dz) || 1, cx = (a.x - me.x) / (range || 1), cz = (a.z - me.z) / (range || 1);
      dx /= d; dz /= d;
      if (!(range < 2.5 && dx * cx + dz * cz > 0.6)) { // not straight into it
        const sy = Math.sin(me.yaw), cy = Math.cos(me.yaw);
        it.moveY = dx * sy - dz * cy; it.moveX = dx * cy + dz * sy;
      }
      return 'finale-pin';
    }
    this.go(ex.x, ex.z, {sprint: close || me.stamina > 0.7, sneak: false});
    this.light({stop: false});
    return 'finale-run';
  }

  /** Stop dead, nothing in your hands making noise. */
  freeze({tracker = true} = {}) {
    if (tracker) this.lowerTracker();
    this.wantCrouch = this.wantCrouch || this.p.me.crouched;
  }

  raiseTracker() { const t = this.p.tracker; if (t.owned && t.battery > 0 && !t.want && this.T >= this.trackCool) { this.it.track = true; this.trackCool = this.T + 0.35; } }
  lowerTracker() { const t = this.p.tracker; if (t.want && this.T >= this.trackCool) { this.it.track = true; this.trackCool = this.T + 0.35; } }

  /** Somewhere to get away to: a hiding spot if there is one close, else a crawl or a far room. */
  escapeSpot(hideReach = 16) {
    const m = this.p.map, me = this.p.me, th = this.th;
    const fMe = m.field(me.x, me.z);
    const fTh = isFinite(th.x) ? m.field(th.x, th.z) : null;
    let best = null, bs = -Infinity;
    for (const h of m.hides) {
      const d = m.dist(fMe, h.x, h.z), dt = fTh ? m.dist(fTh, h.x, h.z) : 99;
      if (d > hideReach || !isFinite(d) || d > dt + 2) continue;
      const s = 40 - d;
      if (s > bs) { bs = s; best = {x: h.x, z: h.z, hide: true}; }
    }
    if (best) return best;
    for (const a of m.anchors) {
      const d = m.dist(fMe, a.x, a.z);
      if (!isFinite(d) || d > 26 || d < 3) continue;
      const dt = fTh ? m.dist(fTh, a.x, a.z) : 20;
      const s = (isFinite(dt) ? dt : 40) - d + (a.crawl ? 6 : 0);
      if (s > bs) { bs = s; best = a; }
    }
    return best;
  }
}

/**
 * The way README teaches it. Sneak. Freeze on the first click, move while it runs. Stand still when your
 * steps sound doubled. Read the tracker now and then. Light only what you need, in short bursts, stopped.
 * With a hunt on: get to a hiding spot or a crawl, and if it arrives anyway, hold the beam on it.
 */
class Careful extends Bot {
  sneak = true;
  constructor(p, r, opts = {}) { super(p, r); this.nextRead = 18; this.readUntil = 0; this.escape = null; this.escapeAt = -99; this.settleUntil = 0; this.stalkUntil = 0; this.standoff = 0; this.patience = opts.patience ?? 10; this.backOff = null; this.backOffUntil = 0; }

  decide() {
    const me = this.p.me, th = this.th, T = this.T, it = this.it;
    if (me.coresLeft === 0) return this.finaleRun({beam: true});

    if (th.lingering(T)) { // right beside you: not a sound, not a breath
      this.freeze();
      if (me.lungs == null || me.lungs > 0.32) it.holdBreath = true; // and lets go while it can still do so quietly
      return 'hold-linger';
    }
    // on you and you cannot get away: the beam stops it
    if (this.beamIfClose()) return 'beam';
    if (th.holding(T)) { this.freeze(); return 'freeze-click'; }
    if (T - th.litT < 1.5) { this.freeze(); return 'saw-it'; } // the light landed on it, off guard: a glance is safe, so let go at once

    if (th.stalked(T) || T < this.stalkUntil) { // your steps sound doubled: stop until it gives up the trail
      if (T >= this.stalkUntil) { this.stalkUntil = T + 9.5; th.doubled = 0; }
      this.freeze();
      return 'hold-stalk';
    }

    if (th.hunted(T)) return this.evade();
    if (T < this.settleUntil) { // got away: stay put until it has gone quiet
      if (th.near(T, 14, 3)) this.settleUntil = Math.max(this.settleUntil, T + 4);
      this.freeze();
      return 'settle';
    }
    this.escape = null;
    // it will not walk past someone standing still, so a standoff can last for ever: after a while, creep away
    if (T < this.backOffUntil && this.backOff) {
      if (this.go(this.backOff.x, this.backOff.z, {sneak: true, near: 1})) return 'back-off';
      this.backOffUntil = 0;
    }
    if (th.near(T, 7, 2.5)) {
      if ((this.standoff += this.dt) > this.patience) { this.standoff = 0; this.backOff = this.escapeSpot(0); this.backOffUntil = T + 12; }
      this.freeze();
      return 'let-pass';
    }
    this.standoff = Math.max(0, this.standoff - this.dt * 0.25);
    if (this.readTracker()) return 'read';
    this.route({sneak: true, light: {stop: true, maxBurst: 0.7}});
    return 'route';
  }

  /** It is within a few metres and coming: turn and hold the beam on it until it breaks. */
  beamIfClose() {
    const me = this.p.me, th = this.th, T = this.T, it = this.it;
    if (me.overheated || me.heat > 0.92) return false;
    const litNow = T - th.litT < 0.4, hunted = th.hunted(T);
    if (!(hunted && (litNow || th.near(T, 6, 1.5))) && !(litNow && th.dist < 4)) return false;
    const a = th.lastPos(T, 1.5);
    if (!a) return false;
    this.lowerTracker();
    if (this.aimAt(a.x, a.z) < 0.5) it.firing = true;
    return true;
  }

  evade() {
    const me = this.p.me, th = this.th, T = this.T;
    if (!this.escape || T - this.escapeAt > 2) { this.escape = this.escapeSpot() || this.escape; this.escapeAt = T; }
    const e = this.escape;
    this.settleUntil = T + 5;
    if (!e) { this.freeze(); return 'evade-freeze'; }
    // walking is quiet enough at a distance; close by, creep
    const creep = th.near(T, 5, 2);
    if (!this.go(e.x, e.z, {sneak: creep || !!e.hide, near: e.hide ? 0.45 : 0.8})) { this.wantCrouch = true; this.lowerTracker(); return 'evade-there'; }
    return 'evade';
  }

  /** Every so often stop and hold it up for two or three pulses. */
  readTracker() {
    const t = this.p.tracker, T = this.T, th = this.th;
    if (T < this.readUntil) {
      this.raiseTracker();
      if (t.blips.length && t.up) {
        const b = t.blips[t.blips.length - 1], me = this.p.me;
        if (Math.hypot(b.x - me.x, b.z - me.z) < 8) { this.readUntil = T; this.settleUntil = T + 4; this.lowerTracker(); } // moving close: put it away, wait
      }
      return true;
    }
    if (t.want) this.lowerTracker();
    if (T >= this.nextRead && t.owned && t.battery > 0.05 && !th.near(T, 8, 4)) { this.nextRead = T + 22 + this.rand() * 10; this.readUntil = T + 2.8; return true; }
    return false;
  }
}

/** Sprints everywhere, walks only when winded, reacts to nothing. */
class Runner extends Bot {
  decide() {
    const me = this.p.me;
    if (me.coresLeft === 0) return this.finaleRun();
    this.route({sprint: me.stamina > 0.05, sneak: false, light: {stop: false, maxBurst: 0.6}});
    return me.sprinting ? 'sprint' : 'winded';
  }
}

/** Runs to the nearest hiding spot when threatened and waits it out. */
class Hider extends Bot {
  constructor(p, r) { super(p, r); this.hide = null; this.calmSince = 0; this.hideStart = null; this.braveUntil = 0; }
  threatened() {
    const me = this.p.me, th = this.th, T = this.T;
    if (T < this.braveUntil) return false; // waited long enough, it is still about: get on with it for a while
    return th.hunted(T) || th.near(T, 14, 3) || me.static || me.fear >= 0.5 || T - th.flash < 2;
  }
  decide() {
    const me = this.p.me, th = this.th, T = this.T;
    if (me.coresLeft === 0) return this.finaleRun();
    if (th.lingering(T)) { // beside you: too late to run, and not a breath
      this.calmSince = T; this.freeze();
      if (me.lungs == null || me.lungs > 0.32) this.it.holdBreath = true;
      return 'hold-linger';
    }
    if (this.threatened()) { this.calmSince = T; if (!this.hide) this.pickHide(); }
    if (this.hide) {
      const inside = Math.hypot(me.x - this.hide.x, me.z - this.hide.z) < this.hide.r * 0.8;
      if (inside) {
        this.wantCrouch = true; this.lowerTracker();
        if (this.hideStart == null) this.hideStart = T;
        // calm for a while, or it has been long enough: out again
        const longEnough = T - this.hideStart > 45 && !th.near(T, 8, 3); // never stand up with it beside you
        if (T - this.calmSince > 8 || longEnough) { if (longEnough) this.braveUntil = T + 20; this.hide = null; this.hideStart = null; }
        return 'hiding';
      }
      if (T - this.calmSince > 8) { this.hide = null; return 'hide-off'; }
      this.go(this.hide.x, this.hide.z, {sprint: th.hunted(T), sneak: false, near: 0.25});
      return 'to-hide';
    }
    this.route({sneak: th.near(T, 18, 6), light: {stop: false}});
    return 'route';
  }
  pickHide() {
    const m = this.p.map, me = this.p.me, f = m.field(me.x, me.z);
    let best = null, bd = 30; // too far, and you would never get there: stand still instead
    for (const h of m.hides) { const d = m.dist(f, h.x, h.z); if (d < bd) { bd = d; best = h; } }
    this.hide = best;
  }
}

/** Holds the beam on it when it comes; when it runs, or the scanner is hot, backs off and gets on with it. */
class Fighter extends Bot {
  pressOn = 0;
  decide() {
    const me = this.p.me, th = this.th, T = this.T, it = this.it;
    if (me.coresLeft === 0) return this.finaleRun({beam: true});
    if (th.shriekT === T && T - th.litT < 1) this.pressOn = T + 8;
    // it screamed and broke while in your light: it is running, so make ground until it is back on top of you
    if (T < this.pressOn && !th.near(T, 5, 1)) { this.route({sneak: false, light: {stop: false}}); return 'press-on'; }
    const coming = (th.hunted(T) && th.dist < 18) || th.near(T, 10, 2) || (T - th.litT < 0.5 && th.dist < 14);
    const a = th.lastPos(T, 2.5);
    if (coming && a) {
      if (me.overheated) { // nothing to hold it with: back away from it, facing it
        this.aimAt(a.x, a.z); it.moveY = -1; return 'retreat-hot';
      }
      const off = this.aimAt(a.x, a.z);
      if (off < 0.5) it.firing = true;
      if (T - th.litT < 0.4) return 'hold-beam';           // got it: stand and hold
      if (th.running(T) && a.dist > 3) { it.moveY = -1; return 'retreat-aim'; } // it is running: give ground while finding it
      return 'seek-beam';
    }
    this.route({sneak: false, light: {stop: false}});
    return 'route';
  }
}

/** Trusts the tracker: keeps it up, watches the blips, moves off when they come close, checks behind. */
class Reader extends Bot {
  constructor(p, r) { super(p, r); this.goAway = null; this.goAwayAt = -99; this.nextCheck = 8; this.checkUntil = 0; this.checkYaw = 0; this.holdUntil = 0; this.standoff = 0; this.braveUntil = 0; }
  decide() {
    const me = this.p.me, th = this.th, T = this.T, t = this.p.tracker, m = this.p.map;
    if (me.coresLeft === 0) { this.lowerTracker(); return this.finaleRun(); }
    if (th.lingering(T)) { this.freeze(); return 'hold-linger'; }
    const hasIt = t.owned && t.battery > 0;
    if (!hasIt) { // dead: the only warning left is the ear
      if (th.holding(T, 12)) { this.freeze(); return 'freeze-click'; }
      this.route({sneak: true, light: {stop: true}});
      return 'route-blind';
    }
    let near = null, nd = Infinity;
    for (const b of t.blips) { const d = Math.hypot(b.x - me.x, b.z - me.z); if (d < nd) { nd = d; near = b; } }
    // inside its static a contact tells you nothing and the tick gives you away
    if (T >= this.braveUntil && (nd < 5 || t.flood > 0.3 || th.near(T, 4, 2))) {
      if ((this.standoff += this.dt) > 12) { this.standoff = 0; this.braveUntil = T + 8; }
      this.freeze();
      return 'still-close';
    }
    this.standoff = Math.max(0, this.standoff - this.dt * 0.25);
    this.raiseTracker();
    if (T < this.holdUntil) return 'hold-read';
    if (near && nd < 12) {
      if (!this.goAway || T - this.goAwayAt > 3) { this.goAway = this.escapeSpot(0) || this.goAway; this.goAwayAt = T; }
      if (this.goAway) { this.go(this.goAway.x, this.goAway.z, {sneak: true, near: 1}); return 'move-off'; }
      this.holdUntil = T + 2; return 'hold-read';
    }
    this.goAway = null;
    // the edge of the screen lit: it is behind you; look
    if (T > this.checkUntil + 2 && (t.behindL > 0.5 || t.behindR > 0.5)) { this.checkUntil = T + 1; this.checkYaw = me.yaw + (t.behindR > t.behindL ? 1 : -1) * Math.PI * 0.75; }
    if (T >= this.nextCheck && T > this.checkUntil) { this.nextCheck = T + 12 + this.rand() * 6; this.checkUntil = T + 1.6; this.checkYaw = me.yaw + Math.PI; }
    if (T < this.checkUntil) { this.turnTo(this.checkYaw); return 'look-behind'; }
    // a battery you have seen, when low
    const bat = t.battery < 0.45 && this.p.batteries.length ? this.closest(this.p.batteries) : null;
    if (bat) { this.go(bat.x, bat.z, {sneak: false, near: 0.4}); return 'battery'; }
    this.route({sneak: nd < 16 || me.fear > 0.3, light: {stop: false}});
    return 'route';
  }
  closest(list) { const me = this.p.me; return list.reduce((a, b) => Math.hypot(a.x - me.x, a.z - me.z) <= Math.hypot(b.x - me.x, b.z - me.z) ? a : b); }
}

/** Holds the trigger down the whole time, sweeps whenever it can, and walks. */
class Noisy extends Bot {
  decide() {
    const me = this.p.me, it = this.it;
    if (me.coresLeft === 0) { this.finaleRun(); it.firing = !me.overheated; return 'finale-scan'; }
    this.route({sneak: false, light: 'none'});
    it.firing = !me.overheated;
    if (me.sweepReady) it.sweep = true;
    return 'scan-walk';
  }
}

/** Careful, plus stones: throws one off the way ahead when it is near, to draw it off. Careful without them. */
class Stoner extends Careful {
  constructor(p, r, opts) { super(p, r, opts); this.nextThrow = 0; this.aiming = null; this.aimUntil = 0; }
  decide() {
    const me = this.p.me, th = this.th, T = this.T, it = this.it;
    const have = me.stones != null && me.stones > 0;
    if (have && me.coresLeft > 0) {
      if (this.aiming && T < this.aimUntil) {
        this.turnTo(this.aiming.yaw); this.pitchTo(0.3);
        if (Math.abs(angleDiff(me.yaw, this.aiming.yaw)) < 0.15) { it.throwStone = true; this.aiming = null; this.nextThrow = T + 6; this.stats.throws++; this.settleUntil = 0; }
        return 'throw';
      }
      this.aiming = null;
      if (T >= this.nextThrow && th.near(T, 16, 4) && !th.lingering(T) && !th.holding(T) && !(T - th.litT < 0.4)) {
        const yaw = this.throwYaw();
        if (yaw != null) { this.aiming = {yaw}; this.aimUntil = T + 0.8; return 'throw'; }
      }
    }
    return super.decide();
  }
  /** The longest clear throw away from where you are headed. */
  throwYaw() {
    const m = this.p.map, me = this.p.me, g = this.probe || this.p.cores[0] || m.exit, ahead = yawTo(me, g.x, g.z);
    let best = null, bs = 3;
    for (let k = 0; k < 16; k++) {
      const yaw = k / 16 * TAU;
      let reach = 0;
      for (let d = 1; d <= 14 && m.walkable(me.x + Math.sin(yaw) * d, me.z - Math.cos(yaw) * d); d++) reach = d;
      const s = reach * (1 + 0.5 * Math.abs(angleDiff(ahead, yaw)) / Math.PI);
      if (reach >= 5 && s > bs) { bs = s; best = yaw; }
    }
    return best;
  }
}

const CLASSES = {careful: Careful, runner: Runner, hider: Hider, fighter: Fighter, reader: Reader, noisy: Noisy, stoner: Stoner};
export const PERSONAS = Object.keys(CLASSES);
/** Seconds from a sound to acting on it: a skilled player expecting it, and everyone else. */
export const REACTION = {careful: 0.22, runner: 0.3, hider: 0.3, fighter: 0.3, reader: 0.3, noisy: 0.3, stoner: 0.22};
export const makeBot = (name, perc, rand, opts = {}) => new CLASSES[name](perc, rand, opts);
