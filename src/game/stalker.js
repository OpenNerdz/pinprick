// The creature. It cannot see. It hears footsteps, the scanner hum and the sweep, measured as walking
// distance so sound reaches it round corners. It feels the scanner's light when you hold it on its
// body. It grabs anyone it bumps into, but it never walks into someone it has not noticed: a player
// who keeps still and quiet makes it stop short, listen, and go another way.
//
//   dormant ─wake─> patrol ⇄ listen / wait (silent, motionless)
//                     │  ▲
//            heard ───┘  │ nothing there (or it cannot get any closer)
//                     investigate
//                        │ heard you close / felt the light
//                        ▼
//                      alert (freezes, turns to you) ──> hunt (on all fours, one lunge at the end)
//                                                          │ lost you
//                                                          ▼
//                      search: where it reckons you went, then spots around it, stopping to listen.
//                              Any sound gives you away, and it can walk into you. Then back to patrol.
//   It hears more while it stands still listening (the clicking). How well it reads where you were
//   heading, how long it searches, and whether it waits at the far end of a crawl, go with difficulty.
//   linger: coming up on a hidden or motionless player it stops beside them and listens. Make a sound,
//           or stand up out of a hiding spot, and it has you. Wait it out and it leaves.
//   finale: after the last core it shrieks from far away and always knows roughly where you are.
//
// Three things make it this game's monster rather than any monster:
//   sonar   It has a scanner too. When it stops to listen it clicks, and a moment later the echo
//           splashes red dots over everything near it. Whatever is moving inside that red, it finds.
//           Stand still through it and you are just another wall.
//   light   Your beam pins it. Held on it, it knows where you are, but it can only drag itself toward
//           you until the light goes; then it surges. The scanner's heat decides how long you have.
//   stalk   Having lost you, it may follow your footsteps instead, a dozen metres back, stepping only
//           when you step so its feet hide in yours: your steps sound doubled. Each step it closes in,
//           and at arm's length it pounces. Stop, turn the beam on it, and it bolts into the dark.
// And it learns your motion tracker. It hears the tick up close. On Normal and Hard the first tick
// may make it go silent and still, which hides it from the tracker, and then it comes to look where
// the tick came from; keep ticking at it and it works out where you are. It may copy the tick, too.

import {NOISE, STALKER, TRACKER} from '../config.js';
import {clamp, angleDiff} from '../util/math.js';
import {cast, hit} from '../world/raycast.js';
import {makeCreature, animateCreature, headOf} from './figures.js';
import {buzz} from '../ui/haptics.js';

const MIMICS = ['trigger', 'ping', 'chime', 'steps'];
const MIMICS_TRACKER = [...MIMICS, 'tracker'];

export class Stalker {
  /** `pnav` is the player's walkability grid (same cells as `nav`), used to find the ends of crawls. */
  constructor(cfg, world, nav, diff, rand, sounds, pnav = null) {
    this.cfg = cfg;
    this.world = world; this.nav = nav; this.diff = diff; this.rand = rand; this.sounds = sounds; this.pnav = pnav;
    this.actor = makeCreature();
    world.actors.push(this.actor);
    this.field = new Float32Array(nav.n);
    this.tmpField = new Float32Array(nav.n);
    this.tmpField2 = new Float32Array(nav.n);
    this.state = 'dormant';
    this.x = cfg.spawn[0]; this.z = cfg.spawn[1]; this.face = 0;
    this.target = null; this.path = null; this.repathT = 0; this.repathed = false;
    this.lastKnown = {x: 0, z: 0}; this.sinceFix = 99;
    this.fixVel = {x: 0, z: 0}; this.fixT = -99; this.guessPt = {x: 0, z: 0};
    this.searchC = {x: 0, z: 0}; this.searchLeft = 0; this.ambushing = false; this.ears = false;
    this.timer = 0; this.stepAcc = 0; this.stepN = 0; this.lastScream = -99;
    this.patrolAt = -1; this.speed = 0;
    this.playerDist = Infinity; this.euclid = Infinity;
    this.light = 0; this.prevHits = 0; this.exposure = 0;
    this.lingerAfter = 0; this.lingerHid = false; this.heardYou = false;
    this.stuck = 0; this.lungeT = 0; this.stumbleT = 0; this.recoilT = 0; this.graceAfter = -99;
    this.player = null;
    this.mimicT = this.span(STALKER.mimicEvery); this.groanT = this.span(STALKER.groanEvery);
    this.rear = 0;
    this.dots = null;                     // the session's dot buffer, for the red sonar dots
    this.sonarT = this.span(STALKER.sonarWalking); this.pulseIn = -1;
    this.lastLit = -99; this.pinned = false; this.pinScream = -99; this.surgeT = 0; this.pinFor = 0;
    this.burnT = 0; this.burnNeed = diff.burn; // it gets used to the light, so this grows each time it runs
    this.followD = STALKER.followFar; this.stalkAfter = 0; this.echoT = -1; this.echoes = 0; this.tense = 0;
    this.graceFor = 0; this.avoid = null;  // after a respawn: keep away from where you came back
    this.pings = 0; this.pingAt = -99; this.pingX = 0; this.pingZ = 0; // your tracker's ticks it has heard
    this.heardPing = false; this.afterPing = false;
    this.echoRays = 0;                    // red sonar rays still to paint
    this.events = [];                     // for the session: 'windup', 'sonar', 'found', 'pinned', 'echo', 'flee'
  }

  span([a, b]) { return a + this.rand() * (b - a); }
  get active() { return this.state !== 'dormant'; }
  get hunting() { return this.state === 'hunt' || this.state === 'finale'; }
  get calm() { return this.state === 'patrol' || this.state === 'investigate' || this.state === 'listen' || this.state === 'wait'; }
  /** States in which it clicks: walking about, standing to listen, searching, lingering beside you. */
  get sonarOn() { return this.calm && this.state !== 'wait' || this.state === 'search' || this.state === 'linger'; }

  /**
   * Spawn. With `awayFrom`, appear at the patrol point that is the longest walk from that spot; with
   * `exit` as well, the one farthest from both, so a chase to the exit starts behind you.
   */
  wake(awayFrom = null, state = 'patrol', exit = null) {
    let [x, z] = this.cfg.spawn;
    if (awayFrom) [x, z] = exit ? this.finaleSpot(awayFrom, exit) : this.farthestPatrol(awayFrom.x, awayFrom.z);
    this.x = x; this.z = z;
    this.actor.on = true;
    this.state = state;
    this.target = null; this.path = null; this.repathT = 0; this.sinceFix = 99; this.light = 0; this.exposure = 0; this.rear = 0;
    this.stuck = 0; this.lungeT = 0; this.stumbleT = 0; this.timer = 0;
    this.pulseIn = -1; this.pinned = false; this.surgeT = 0; this.pinFor = 0; this.burnT = 0; this.echoT = -1; this.followD = STALKER.followFar;
    this.prevHits = this.actor.hits;
    this.nav.field(this.x, this.z, this.field);
    this.playerDist = awayFrom ? this.nav.distAt(this.field, awayFrom.x, awayFrom.z, 2.5) : Infinity;
    this.euclid = awayFrom ? Math.hypot(awayFrom.x - this.x, awayFrom.z - this.z) : Infinity;
    this.actor.place(this.x, this.z, this.face);
  }

  sleep() { this.state = 'dormant'; this.actor.on = false; this.sounds.setBreath(0, this.x, this.z); }

  farthestPatrol(x, z) {
    const f = this.nav.field(x, z, this.tmpField);
    let best = this.cfg.spawn, bd = -1;
    for (const p of [this.cfg.spawn, ...this.cfg.patrol]) {
      const d = this.nav.distAt(f, p[0], p[1]);
      if (isFinite(d) && d > bd) { bd = d; best = p; }
    }
    return best;
  }

  /**
   * Where it runs from you: the patrol point farthest from you among those it reaches well before you
   * could, so the way there never leads past you. Cornered, it takes the one most on its side.
   */
  fleeSpot(x, z) {
    const fp = this.nav.field(x, z, this.tmpField), fc = this.nav.field(this.x, this.z, this.tmpField2);
    let best = null, bd = -1, side = this.cfg.spawn, bs = -Infinity;
    for (const q of [this.cfg.spawn, ...this.cfg.patrol]) {
      const dp = this.nav.distAt(fp, q[0], q[1]), dc = this.nav.distAt(fc, q[0], q[1]);
      if (!isFinite(dp) || !isFinite(dc)) continue;
      if (dp - dc > 4 && dp > bd) { bd = dp; best = q; }
      if (dp - dc > bs) { bs = dp - dc; side = q; }
    }
    return best || side;
  }

  /** The patrol point farthest from both the player and the exit (the shorter of the two walks). */
  finaleSpot(p, e) {
    const fp = this.nav.field(p.x, p.z, this.tmpField), fe = this.nav.field(e.x, e.z, this.tmpField2);
    let best = this.cfg.spawn, bs = -1;
    for (const q of [this.cfg.spawn, ...this.cfg.patrol]) {
      const s = Math.min(this.nav.distAt(fp, q[0], q[1]), this.nav.distAt(fe, q[0], q[1]));
      if (isFinite(s) && s > bs) { bs = s; best = q; }
    }
    return best;
  }

  enter(state, T) {
    if (state === 'hunt' && !this.hunting && T - this.lastScream > 8) {
      this.lastScream = T;
      this.sounds.shriek(this.x, this.z, this.muffle());
      buzz([30, 40, 90]);
    }
    if (state === 'listen') { this.timer = this.span(STALKER.listenTime); this.sonarT = Math.min(this.sonarT, 0.4 + this.rand() * 0.6); }
    if (state === 'wait') this.timer = this.span(STALKER.waitTime);
    if (state === 'alert') this.timer = this.diff.alertTime;
    if (state === 'search') {
      const g = this.guess();
      this.searchC.x = g.x; this.searchC.z = g.z;
      this.searchLeft = this.diff.searchPoints;
      const amb = this.ambushSpot();
      this.ambushing = !!amb;
      this.target = amb || {x: g.x, z: g.z};
      this.timer = 0;
    }
    if (state === 'linger') { this.timer = this.span(STALKER.lingerTime); this.sonarT = 0.8; this.sounds.exhale(this.x, this.z); }
    if (state === 'finale') { this.timer = 0; this.sounds.shriek(this.x, this.z, this.muffle()); }
    if (state === 'stalk') { this.followD = Math.max(STALKER.followFar, Math.min(this.playerDist, 16)); this.echoes = 0; this.tense = 0; }
    if (state === 'flee') {
      // lit up while it was following you, or held in the light too long: it shrieks and bolts for the
      // far side of the level, away from you
      const p = this.player || this.lastKnown, [x, z] = this.fleeSpot(p.x, p.z);
      this.target = {x, z};
      this.stalkAfter = T + STALKER.stalkCooldown;
      this.sounds.shriek(this.x, this.z, Math.max(0.25, this.muffle()), 0.1);
      this.events.push('flee');
    }
    if (state !== 'wait' && state !== 'listen') this.afterPing = false; // anything else, and it has moved on
    // a click burst in progress is cut off by anything but more listening
    if (!(state === 'patrol' || state === 'investigate' || state === 'listen' || state === 'search' || state === 'linger')) this.pulseIn = -1;
    this.state = state;
    this.repathT = 0; this.stuck = 0;
  }

  /** A fresh fix on where you are. Successive fixes tell it which way you are heading. */
  fix(x, z, T) {
    const gap = T - this.fixT;
    if (gap > 0.15 && gap < 3) {
      let vx = (x - this.lastKnown.x) / gap, vz = (z - this.lastKnown.z) / gap;
      const v = Math.hypot(vx, vz);
      if (v > 6) { vx *= 6 / v; vz *= 6 / v; }
      const k = Math.min(1, gap);
      this.fixVel.x += (vx - this.fixVel.x) * k; this.fixVel.z += (vz - this.fixVel.z) * k;
    } else if (gap >= 3) { this.fixVel.x = 0; this.fixVel.z = 0; }
    if (gap > 0) this.fixT = T;
    this.lastKnown.x = x; this.lastKnown.z = z; this.sinceFix = 0;
  }

  /**
   * Where it reckons you are now: the last fix, carried on along the way you were heading for as long
   * as it has been without one (scaled by difficulty), stopping where the ground runs out.
   */
  guess() {
    const L = this.lastKnown, g = this.guessPt, grid = this.pnav || this.nav;
    const k = Math.min(this.sinceFix, 2.5) * this.diff.predict;
    g.x = L.x; g.z = L.z;
    const ex = this.fixVel.x * k, ez = this.fixVel.z * k, d = Math.hypot(ex, ez), n = Math.ceil(d / 0.5);
    for (let i = 1; i <= n; i++) {
      const x = L.x + ex * i / n, z = L.z + ez * i / n;
      if (!grid.walkableAt(x, z)) break;
      g.x = x; g.z = z;
    }
    return g;
  }

  /** It has noticed you: freeze, turn, then come. */
  notice(x, z, T) {
    this.fix(x, z, T);
    if (!this.hunting && this.state !== 'alert') this.enter('alert', T);
  }

  /** Whether, having lost you, it follows your footsteps this time (difficulty, and not right after a respawn). */
  wantsStalk(T) { return T > this.stalkAfter && this.graceFor <= 0 && this.rand() < this.diff.stalk; }

  /** Start a click burst: you hear it now; the echo (red dots, and whether it finds you) comes a moment later. */
  click(T) {
    this.pulseIn = this.diff.sonarWarn;
    this.sounds.clicks(this.x, this.z, this.muffle(), true);
    if (this.euclid < this.diff.sonar + 4) this.events.push('windup');
  }

  /** Red dots from the echo washing outward: `n` rays from its head, out to its sonar's reach. */
  paintEcho(T, n) {
    const R = this.diff.sonar, [hx, hy, hz] = headOf(this.actor), dots = this.dots;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.2832, y = (Math.random() * 2 - 1) * 0.7, c = Math.sqrt(1 - y * y);
      const dx = Math.cos(a) * c, dz = Math.sin(a) * c;
      if (!cast(this.world, hx, hy, hz, dx, y, dz, R, false)) continue;
      const k = 0.6 + 0.4 * (1 - hit.t / R);
      dots.push(hx + dx * hit.t + hit.nx * 0.02, hy + y * hit.t + hit.ny * 0.02, hz + dz * hit.t + hit.nz * 0.02,
        T, k, 0.12 * k, 0.08 * k, 0.03 * (0.8 + Math.random() * 0.4));
    }
  }

  /** The echo of a click burst: the red starts washing over everything within reach, and anyone moving in it is found. */
  echo(T, player) {
    const R = this.diff.sonar, [hx, hy, hz] = headOf(this.actor);
    if (this.dots && this.euclid < 32) this.echoRays = STALKER.sonarRays;
    // you, inside the echo: in reach and nothing solid between you
    const dx = player.x - hx, dy = player.eye - 0.35 - hy, dz = player.z - hz, d = Math.hypot(dx, dy, dz);
    if (d > R || cast(this.world, hx, hy, hz, dx / d, dy / d, dz / d, Math.max(0, d - 0.2), false)) return;
    this.events.push('sonar');
    const moving = player.still < 0.25 && !(this.diff.sonarCrouch && player.crouched);
    if (moving && !player.hidden) { this.events.push('found'); this.notice(player.x, player.z, T); }
  }

  /** Report noises made this frame: [{x, z, loud, exact, kind}]. */
  hear(noises, T) {
    if (!this.active || this.state === 'finale' || this.state === 'flee') return;
    // standing still and listening, it hears further; following your footsteps, further still
    const ears = this.diff.hearing * (this.ears ? this.diff.listen : 1) * (this.state === 'stalk' ? 2 : 1);
    for (const n of noises) {
      const loud = n.loud * ears, d = this.nav.distAt(this.field, n.x, n.z, 2.5);
      if (!(d <= loud)) continue;
      this.heardYou = true;
      if (this.state === 'stalk') {
        // a footstep: it steps with you and closes in. The sweep or a core: it pounces. The scanner's
        // hum: it freezes to listen for a moment, and if the beam finds it in that moment it bolts.
        if (n.exact || n.loud > NOISE.sprintStep) { this.notice(n.x, n.z, T); continue; }
        if (n.kind !== 'step') { this.fix(n.x, n.z, T); if (this.tense <= 0) this.tense = this.diff.alertTime + 0.4; continue; }
        this.fix(n.x, n.z, T);
        this.followD = Math.max(STALKER.followNear, this.followD - this.diff.stalkClose);
        this.echoT = 0.11;
      } else if (this.state === 'hunt' || this.state === 'alert') {
        if (n.exact || d < loud * 0.6) this.fix(n.x, n.z, T);
      } else if (n.exact || d < loud * 0.35 || this.state === 'linger' || this.state === 'search') {
        this.notice(n.x, n.z, T);
      } else if (n.kind === 'tracker' && this.calm) {
        this.hearPing(n, d, T);
      } else if (this.calm && n.kind === 'step' && d > loud * 0.5 && this.rand() < 0.5 && this.wantsStalk(T)) {
        // a distant footstep: rather than come and look, it starts to follow
        this.fix(n.x, n.z, T);
        this.enter('stalk', T);
      } else {
        const j = d * 0.12;
        this.target = {x: n.x + (this.rand() * 2 - 1) * j, z: n.z + (this.rand() * 2 - 1) * j};
        this.enter('investigate', T);
      }
    }
  }

  /**
   * Your tracker's tick, heard while it is calm. The first in a while may make it go silent and still
   * (it has learned your tracker sees what moves) or stop to listen; either way it then comes to look
   * where the tick came from. Otherwise it comes straight away. Keep ticking and it works out where you are.
   */
  hearPing(n, d, T) {
    if (T - this.pingAt > TRACKER.pingWindow) this.pings = 0;
    this.pings++; this.pingAt = T; this.pingX = n.x; this.pingZ = n.z;
    if (!this.heardPing) { this.heardPing = true; this.events.push('ping'); }
    if (this.diff.trkNotice && this.pings >= this.diff.trkNotice) { this.notice(n.x, n.z, T); return; }
    if (this.pings === 1) {
      const r = this.rand();
      if (r < this.diff.trkFreeze) { this.enter('wait', T); this.timer = 4 + this.rand() * 3; this.afterPing = true; return; }
      if (r < this.diff.trkFreeze + this.diff.trkListen) {
        this.enter('listen', T); this.face = Math.atan2(n.x - this.x, -(n.z - this.z)); this.afterPing = true; return;
      }
    }
    if (this.afterPing && (this.state === 'wait' || this.state === 'listen')) return; // still holding still for it
    const j = d * 0.08;
    this.target = {x: n.x + (this.rand() * 2 - 1) * j, z: n.z + (this.rand() * 2 - 1) * j};
    this.enter('investigate', T);
  }

  /** Done standing still: if it was your tick it stopped for, it comes to look where that came from. */
  resume(T) {
    if (this.afterPing && T - this.pingAt < 20) {
      this.target = {x: this.pingX + (this.rand() * 2 - 1) * 1.5, z: this.pingZ + (this.rand() * 2 - 1) * 1.5};
      this.enter('investigate', T);
    } else this.enter('patrol', T);
  }

  /** Advance one frame. Returns true when it has caught the player. */
  update(dt, T, player) {
    if (!this.active) return false;
    const nav = this.nav, A = this.actor;
    this.player = player;

    this.repathed = (this.repathT -= dt) <= 0;
    if (this.repathed) {
      this.repathT = STALKER.repathEvery;
      nav.field(this.x, this.z, this.field);
    }
    this.playerDist = nav.distAt(this.field, player.x, player.z, 2.5);
    this.euclid = Math.hypot(player.x - this.x, player.z - this.z);

    // the scanner's light on its skin: hold the beam on it and it knows where the beam comes from
    const fresh = A.hits - this.prevHits;
    this.prevHits = A.hits;
    this.light = this.light * Math.exp(-dt / STALKER.lightWindow) + fresh;
    // it is the time the beam stays on it that counts, not how dense the beam is: a glance is safe
    this.exposure = fresh > 0 ? this.exposure + dt : Math.max(0, this.exposure - dt * 0.35);
    if (fresh > 0) this.lastLit = T;
    // the beam stops it where it stands; when the light goes it surges
    const wasPinned = this.pinned, heldFor = this.pinFor;
    this.pinned = this.exposure > STALKER.pinAfter && T - this.lastLit < STALKER.pinLinger && this.state !== 'flee';
    this.pinFor = this.pinned ? this.pinFor + dt : 0;
    if (this.pinned && !wasPinned && T - this.pinScream > 4) {
      this.pinScream = T;
      this.sounds.shriek(this.x, this.z, this.muffle(), 0.07);
      this.events.push('pinned');
    }
    if (wasPinned && !this.pinned && heldFor > STALKER.surgeAfter
        && (this.hunting || this.state === 'search' || this.state === 'alert')) this.surgeT = STALKER.surge;
    // once it knows you are there, hold it in the light long enough and it breaks and runs; each time it
    // takes longer to break. After the last core it does not run: the light only holds it.
    this.burnT = this.pinned && !this.calm && this.state !== 'finale' ? this.burnT + dt : Math.max(0, this.burnT - dt * 0.5);
    if (this.burnT > this.burnNeed) {
      this.burnT = 0; this.burnNeed += this.diff.burnLearn; this.pinned = false; this.pinFor = 0; this.exposure = 0;
      this.enter('flee', T);
    }
    // following you, it wants not to be seen: the first touch of the beam and it is gone
    else if (this.state === 'stalk' && fresh > 0) this.enter('flee', T);
    else if (this.exposure > this.diff.lightHold && this.playerDist < 16 && this.state !== 'finale' && this.state !== 'flee') this.notice(player.x, player.z, T);
    if (this.graceFor > 0) this.graceFor -= dt;

    // sonar: a click burst now and then while it walks or listens; the echo follows a moment later
    if (this.pulseIn >= 0 && (this.pulseIn -= dt) < 0) this.echo(T, player);
    if (this.echoRays > 0) { // the red spreads over about half a second
      const n = Math.min(this.echoRays, Math.ceil(STALKER.sonarRays * dt / STALKER.echoTime));
      this.echoRays -= n;
      this.paintEcho(T, n);
    }
    if (this.sonarOn && this.pulseIn < 0 && (this.sonarT -= dt) <= 0) {
      this.sonarT = this.span(this.state === 'patrol' || this.state === 'investigate' ? STALKER.sonarWalking : STALKER.sonarEvery);
      this.click(T);
    }

    // coming up on someone hidden or keeping still: it stops right there and listens. While it is
    // searching for you, only a hiding spot does that; out in the open it may walk right into you.
    if ((player.hidden || (player.quiet && this.calm)) && (this.calm || this.state === 'search') && T > this.lingerAfter
        && this.playerDist < STALKER.lingerDist && this.euclid < STALKER.lingerDist) {
      this.lingerAfter = T + 15;
      this.lingerHid = player.hidden;
      this.enter('linger', T);
    }

    const reach = A.crawl > 0.5 ? STALKER.catchCrawl : STALKER.catchDist;
    if (this.recoilT > 0) this.recoilT -= dt;
    else if (this.euclid < reach && this.state !== 'flee' && (!player.hidden || this.state === 'finale')) {
      // on Easy, blundering into it before it knows you are there gives you one chance to run
      if (!(this.diff.bumpGrace && this.calm && T > this.graceAfter)) return true;
      this.graceAfter = T + 20; this.recoilT = this.diff.alertTime + 0.3;
      this.notice(player.x, player.z, T);
    }

    let speed = 0, listening = false, breath = 1;
    const facePlayer = () => {
      const want = Math.atan2(player.x - this.x, -(player.z - this.z));
      this.face += clamp(angleDiff(this.face, want), -5 * dt, 5 * dt);
    };
    switch (this.state) {
      case 'patrol': {
        if (!this.target) this.target = this.nextPatrol(this.unnoticedNear());
        if (!this.target) { this.enter('listen', T); break; } // every way on passes you: it stays and listens
        speed = STALKER.patrol;
        if (this.arrived()) { this.target = null; this.enter(this.rand() < STALKER.waitChance ? 'wait' : 'listen', T); }
        break;
      }
      case 'listen': {
        listening = true;
        this.face += Math.sin(T * 0.9) * dt * 0.8;
        if ((this.timer -= dt) <= 0 && this.pulseIn < 0) this.resume(T);
        break;
      }
      case 'wait': { // standing in the dark, silent, not even breathing much
        breath = 0.1;
        if ((this.timer -= dt) <= 0) this.resume(T);
        break;
      }
      case 'investigate': {
        speed = STALKER.investigate;
        if (this.arrived()) { this.target = null; this.enter('listen', T); this.timer += 2; }
        break;
      }
      case 'alert': { // frozen mid-step, head turning toward you, holding its breath
        listening = true; breath = 0;
        const want = Math.atan2(this.lastKnown.x - this.x, -(this.lastKnown.z - this.z));
        this.face += clamp(angleDiff(this.face, want), -4 * dt, 4 * dt);
        if ((this.timer -= dt) <= 0) this.enter('hunt', T);
        break;
      }
      case 'hunt': {
        this.sinceFix += dt;
        // with no fresh sound it heads where it reckons you are going, not where you were
        this.target = this.sinceFix > 0.5 ? this.guess() : this.lastKnown;
        speed = STALKER.hunt;
        if (this.sinceFix > STALKER.loseAfter || (this.arrived() && this.sinceFix > 0.8)) this.enter('search', T);
        break;
      }
      case 'search': {
        if (this.timer > 0) { // stopped at a spot, listening hard
          listening = true;
          if ((this.timer -= dt) <= 0 && this.pulseIn < 0) {
            if (--this.searchLeft <= 0) {
              this.target = null;
              // nothing: it goes quiet, or it waits for your footsteps and follows them
              if (this.wantsStalk(T)) this.enter('stalk', T); else this.enter('listen', T);
            } else { this.target = this.searchSpot(); this.ambushing = false; }
          }
        } else {
          speed = STALKER.investigate;
          if (this.arrived()) {
            this.timer = STALKER.searchListen * (this.ambushing ? 3 : 1); this.stuck = 0;
            this.sonarT = Math.min(this.sonarT, 0.15);
          }
        }
        break;
      }
      case 'stalk': { // a dozen metres behind you in the dark, moving only when you move
        breath = 0.06;
        this.sinceFix += dt;
        if (this.sinceFix > STALKER.stalkPatience) { this.target = null; this.enter('listen', T); break; }
        if (this.tense > 0) { // it heard the scanner start: frozen, listening; then it comes
          listening = true;
          if ((this.tense -= dt) <= 0) { this.fix(player.x, player.z, T); this.enter('hunt', T); }
          break;
        }
        const moving = player.still < 0.25 && !player.hidden;
        const want = Math.atan2(this.lastKnown.x - this.x, -(this.lastKnown.z - this.z));
        this.face += clamp(angleDiff(this.face, want), -3 * dt, 3 * dt);
        if (moving && this.playerDist > this.followD) { this.target = this.lastKnown; speed = STALKER.hunt; }
        // close enough: it pounces
        if (moving && this.followD <= STALKER.followNear && this.playerDist < STALKER.followNear + 0.8) {
          this.fix(player.x, player.z, T);
          this.enter('hunt', T);
        }
        break;
      }
      case 'flee': {
        speed = STALKER.hunt;
        if (this.arrived()) { this.target = null; this.enter('listen', T); }
        break;
      }
      case 'linger': { // right beside you, listening hard
        listening = true; breath = 1.4;
        facePlayer();
        // standing up out of a hiding spot, or lighting the scanner in it, right beside it
        if (this.lingerHid && !player.hidden) this.notice(player.x, player.z, T);
        else if ((this.timer -= dt) <= 0) { this.target = null; this.enter('patrol', T); }
        break;
      }
      case 'finale': {
        // it knows roughly where you are: a fresh guess every so often, exact once it is close
        if (this.arrived()) this.timer = Math.min(this.timer, 0.3);
        const near = this.playerDist < this.diff.finaleNear;
        if ((this.timer -= dt) <= 0 || (near && this.repathed)) {
          this.timer = this.diff.finaleGuess;
          const j = near ? 0 : Math.min(4, this.playerDist * this.diff.finaleJitter);
          this.target = {x: player.x + (this.rand() * 2 - 1) * j, z: player.z + (this.rand() * 2 - 1) * j};
        }
        speed = STALKER.finale;
        break;
      }
    }

    // it repeats sounds it has learned from you, and groans to itself while it wanders
    if (this.heardYou && !this.hunting && this.calm && this.state !== 'wait' && this.playerDist < 30) {
      if ((this.mimicT -= dt) <= 0) {
        this.mimicT = this.span(STALKER.mimicEvery);
        // once it has heard your tracker it can copy that too, if it is clever enough (Normal and Hard)
        const pool = this.heardPing && this.diff.trkFreeze > 0 ? MIMICS_TRACKER : MIMICS;
        this.sounds.mimic(pool[Math.floor(this.rand() * pool.length)], this.x, this.z, this.muffle());
      }
    }
    if ((this.state === 'patrol' || this.state === 'investigate') && (this.groanT -= dt) <= 0) {
      this.groanT = this.span(STALKER.groanEvery);
      this.sounds.groan(this.x, this.z, this.muffle());
    }

    speed *= this.diff.speed;
    if (this.pinned && this.state !== 'flee') {
      // in the beam it cannot come on: it rears up and shudders where it stands
      speed = 0; listening = true; this.lungeT = 0;
    } else if (this.surgeT > 0) { this.surgeT -= dt; speed *= 1.35; this.lungeT = 0; } // a surge, but no lunge on top
    // the last few metres come at you in one lunge; if it misses, it stumbles and you can get away
    else if (this.stumbleT > 0) { this.stumbleT -= dt; speed *= 0.5; }
    else if (this.hunting && this.euclid < STALKER.lungeDist && nav.lineClear(this.x, this.z, player.x, player.z)) {
      speed *= STALKER.lunge;
      if ((this.lungeT += dt) > this.diff.lungeMax) { this.lungeT = 0; this.stumbleT = STALKER.stumble; }
    } else this.lungeT = Math.max(0, this.lungeT - dt);
    this.speed = speed;
    if (speed > 0 && this.target) {
      const x0 = this.x, z0 = this.z;
      this.walk(dt, speed);
      // no progress (a crawl mouth, a shut door, a corner it cannot round): it gives up on the spot
      this.stuck = Math.hypot(this.x - x0, this.z - z0) < speed * dt * 0.3 ? this.stuck + dt : 0;
    }

    this.ears = listening || this.state === 'wait';
    const low = this.world.heightAt(this.x, this.z) < STALKER.crawlBelow;
    this.rear += ((this.pinned ? 0.55 : 0) - this.rear) * Math.min(1, dt * 6); // it rears up in the light
    animateCreature(A, dt, speed, (this.hunting || low) && !this.pinned ? 1 : 0, listening, this.rear);
    A.place(this.x, this.z, this.face);

    // the sound of it. Stalking, its feet land just after yours, so you hear your own steps twice.
    const muffle = this.muffle();
    if (this.echoT > 0 && (this.echoT -= dt) <= 0) {
      this.sounds.creatureStep(this.x, this.z, Math.max(0.45, muffle), 0.7, false);
      if (++this.echoes === 4) this.events.push('echo');
    }
    if (speed > 0 && this.state !== 'stalk') {
      const crawling = A.crawl > 0.5;
      this.stepAcc += dt * speed;
      if (this.stepAcc > (crawling ? 1.25 : 0.78)) {
        this.stepAcc = 0; this.stepN++;
        if (crawling) this.sounds.gallop(this.x, this.z, muffle);
        else this.sounds.creatureStep(this.x, this.z, muffle, speed > 2 ? 1.2 : 1, this.stepN % 2 === 0);
        if (this.euclid < 8) buzz(Math.round(8 + (8 - this.euclid) * 5), 110);
      }
    }
    this.sounds.setBreath(clamp((1 - this.euclid / 9) * breath, 0, 1) * (1 - muffle * 0.6), this.x, this.z, muffle);
    return false;
  }

  /** The moment it catches you: it turns on you and rears up. */
  strike(dt, player) {
    // stand off at arm's length so it rears up in front of you, not on top of you
    const dx = this.x - player.x, dz = this.z - player.z, d = Math.hypot(dx, dz) || 0.001;
    if (d < 1.1) { this.x = player.x + dx / d * 1.1; this.z = player.z + dz / d * 1.1; }
    const want = Math.atan2(player.x - this.x, -(player.z - this.z));
    this.face += clamp(angleDiff(this.face, want), -12 * dt, 12 * dt);
    animateCreature(this.actor, dt, 0, 0, true, 1);
    this.actor.place(this.x, this.z, this.face);
    this.sounds.setBreath(0, this.x, this.z);
  }

  arrived() {
    return !this.target || this.stuck > STALKER.stuckAfter || Math.hypot(this.target.x - this.x, this.target.z - this.z) < 0.7;
  }

  /** A spot to search near where it lost you, more often ahead of the way you were heading. */
  searchSpot() {
    const c = this.searchC, R = this.diff.searchRadius, v = this.fixVel, heading = Math.hypot(v.x, v.z) > 0.5;
    for (let k = 0; k < 16; k++) {
      let a = this.rand() * Math.PI * 2;
      if (heading && this.rand() < this.diff.predict) a = Math.atan2(v.z, v.x) + (this.rand() - 0.5) * 2;
      const r = 1.5 + this.rand() * (R - 1.5), x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
      // a short walk from here: not the far side of a wall or the other end of a crawl
      if (this.nav.walkableAt(x, z) && this.nav.distAt(this.field, x, z, 0.5) < R * 1.8) return {x, z};
    }
    return {x: this.x, z: this.z};
  }

  /**
   * Lost you in a crawl it cannot enter: the opening of that crawl farthest from it, where you will
   * come out. Null when you were not in a crawl, on difficulties where it does not think of it, or
   * when the way round is too long.
   */
  ambushSpot() {
    const P = this.pnav, L = this.lastKnown, w = this.world, minH = this.nav.minH;
    if (!this.diff.ambush || !P || P.n !== this.nav.n) return null;
    const low = i => P.walk[i] && w.heightAt(P.cx(i), P.cz(i)) < minH;
    const s = P.nearest(L.x, L.z, 1);
    if (s < 0 || !low(s)) return null;
    const seen = new Uint8Array(P.n), q = [s];
    seen[s] = 1;
    let best = null, bd = -1;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], ix = i % P.nw, iz = (i - ix) / P.nw;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= P.nw || jz >= P.nh) continue;
        const j = jz * P.nw + jx;
        if (seen[j] || !P.walk[j]) continue;
        seen[j] = 1;
        if (low(j)) { q.push(j); continue; }
        const d = this.nav.distAt(this.field, P.cx(j), P.cz(j), 2); // an opening: how far it is to walk round
        if (isFinite(d) && d > bd) { bd = d; best = {x: P.cx(j), z: P.cz(j)}; }
      }
    }
    return best && bd < 50 ? best : null;
  }

  /** The player, when they are close, out in the open and keeping still and quiet; otherwise null. */
  unnoticedNear() {
    const p = this.player;
    return p && p.quiet && !p.hidden && this.euclid < 8 ? p : null;
  }

  /**
   * A random patrol point other than the last one. With `avoid`, only one it can reach without brushing
   * past it. Just after a respawn it keeps clear of where you came back, if it can.
   */
  nextPatrol(avoid = null) {
    const pts = this.cfg.patrol, n = pts.length, i0 = Math.floor(this.rand() * n), g = this.graceFor > 0 && this.avoid;
    for (const grace of g ? [true, false] : [false]) {
      for (let k = 0; k < n; k++) {
        const i = (i0 + k) % n;
        if (i === this.patrolAt && n > 1) continue;
        if (grace && Math.hypot(pts[i][0] - this.avoid.x, pts[i][1] - this.avoid.z) < STALKER.respawnClear) continue;
        if (avoid && !this.routeClear(pts[i], avoid)) continue;
        this.patrolAt = i;
        return {x: pts[i][0], z: pts[i][1]};
      }
    }
    return avoid ? null : {x: pts[i0][0], z: pts[i0][1]};
  }

  /** True when the walk to `pt` never comes closer to `a` than the clearance (or than it already is). */
  routeClear(pt, a) {
    const nav = this.nav, path = nav.path(this.field, pt[0], pt[1], 4);
    if (!path) return false;
    const lim = Math.min(STALKER.clearance + 0.3, Math.hypot(a.x - this.x, a.z - this.z) - 0.4);
    for (const c of path) if (Math.hypot(nav.cx(c) - a.x, nav.cz(c) - a.z) < lim) return false;
    return true;
  }

  /** 0 when there's a clear line between you, toward 1 when the sound has to go a long way round. */
  muffle() {
    if (!isFinite(this.playerDist)) return 0.9;
    return clamp((this.playerDist / Math.max(0.5, this.euclid) - 1) / 1.5, 0, 0.85);
  }

  walk(dt, speed) {
    const nav = this.nav, tx = this.target.x, tz = this.target.z;
    if (this.repathed || !this.path) this.path = nav.path(this.field, tx, tz, 4);
    let gx = tx, gz = tz;
    const path = this.path;
    if (path && path.length > 1) {
      // aim for the farthest path cell we can walk to in a straight line
      gx = nav.cx(path[1]); gz = nav.cz(path[1]);
      for (let k = Math.min(path.length - 1, 14); k > 1; k--) {
        const x = nav.cx(path[k]), z = nav.cz(path[k]);
        if (nav.lineClear(this.x, this.z, x, z)) { gx = x; gz = z; break; }
      }
      if (path.length <= 2 && nav.lineClear(this.x, this.z, tx, tz)) { gx = tx; gz = tz; }
    } else if (!path) {
      // target unreachable (crawlspace, behind a door): stop and listen
      if (this.state !== 'finale') { this.target = null; this.enter('listen', 0); }
      return;
    }
    const dx = gx - this.x, dz = gz - this.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const step = Math.min(d, speed * dt), nx = this.x + dx / d * step, nz = this.z + dz / d * step;
    // it does not know you are there, so it must not blunder into you: it stops short and listens
    const p = this.unnoticedNear();
    if (p && this.calm && Math.hypot(p.x - nx, p.z - nz) < Math.min(STALKER.clearance, this.euclid)) {
      this.target = null; this.enter('listen', 0);
      return;
    }
    // (if it is standing somewhere it should not be, say a door shut on it, any step out is fine)
    if (nav.walkableAt(nx, nz) || !nav.walkableAt(this.x, this.z)) { this.x = nx; this.z = nz; }
    else if (nav.walkableAt(nx, this.z)) this.x = nx;
    else if (nav.walkableAt(this.x, nz)) this.z = nz;
    const want = Math.atan2(dx, -dz);
    this.face += clamp(angleDiff(this.face, want), -6 * dt, 6 * dt);
  }

  /** How scared the player should feel: 0 calm .. 1 it is right there. */
  fear() {
    if (!this.active) return 0;
    if (this.state === 'linger') return 1;
    const base = clamp(1 - this.playerDist / 16, 0, 1);
    return clamp(base * (this.hunting || this.state === 'alert' || this.state === 'search' ? 1.25 : 0.8), 0, 1);
  }
}
