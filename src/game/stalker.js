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
//                      alert (freezes, turns to you) ──> hunt: in bursts. It dashes on all fours toward
//                                                          where it last placed you, faster than you
//                                                          can sprint, then stops dead, ear open, and
//                                                          clicks; anything moving in the echo, it has.
//                                                          Move while it runs, freeze when it clicks.
//                                                          │ clicks that find nothing, a few in a row
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
// Behind all that, it thinks. It keeps a map of where you might be (belief.js) that sounds sharpen and empty
// echoes wear away, chooses where to go next by weighing that map against what it has already checked
// (planner.js), remembers your habits between runs (memory.js), and is paced by a director that knows
// where you are but never tells it (director.js). From that come its other tricks:
//   cut off  seeing which way you are running, it goes for the door you are running to
//   flank    having been pinned in your light, it comes in through the other way
//   feint    giving up a search, it walks away loudly, then comes back in silence and waits
//   waylay   it stands silent in a chokepoint, where the tracker cannot see it, for your steps to come near
//   recheck  an empty click may be followed by a second one, for those who move again too soon
//   lean in  beside you it leans closer. Hold your breath and it decides sooner that it heard nothing
// And it learns your motion tracker. It hears the tick up close. On Normal and Hard the first tick
// may make it go silent and still, which hides it from the tracker, and then it comes to look where
// the tick came from; keep ticking at it and it works out where you are. It may copy the tick, too.

import {NOISE, STALKER, TRACKER, LUNGS} from '../config.js';
import {clamp, angleDiff} from '../util/math.js';
import {cast, hit} from '../world/raycast.js';
import {Topology} from '../world/topology.js';
import {makeCreature, animateCreature, headOf} from './figures.js';
import {Belief} from './belief.js';
import {Memory} from './memory.js';
import {Director} from './director.js';
import {Planner} from './planner.js';
import {buzz} from '../ui/haptics.js';

const MIMICS = ['trigger', 'ping', 'chime', 'steps'];
const MIMICS_TRACKER = [...MIMICS, 'tracker'];

export class Stalker {
  /**
   * `pnav` is the player's walkability grid (same cells as `nav`), used to find the ends of crawls.
   * `brain`: {memory (what it knows about you), rand (its own random stream), hides (the level's hiding spots),
   *          exit (where the level's way out is)}.
   */
  constructor(cfg, world, nav, diff, rand, sounds, pnav = null, brain = {}) {
    this.cfg = cfg;
    this.world = world; this.nav = nav; this.diff = diff; this.rand = rand; this.sounds = sounds; this.pnav = pnav;
    this.brainRand = brain.rand || rand;
    this.memory = brain.memory || new Memory();
    this.hides = brain.hides || []; this.exit = brain.exit || null;
    this.topo = new Topology(world, nav);
    this.belief = new Belief(pnav || nav, nav);
    this.director = new Director(diff, this.brainRand);
    // every creature is a little different: how long it dashes, how long it keeps at something, how it wanders
    const r = this.brainRand;
    this.temper = {bold: 0.88 + r() * 0.24, patient: 0.8 + r() * 0.4, curious: r()};
    this.arousal = 0;                     // 0 calm .. 1 it has just been chasing you
    this.goal = null;                     // what sort of place it is walking to: patrol, room, choke, hide
    this.waylaying = false;               // standing silent somewhere on purpose
    this.clue = null; this.heardKind = 'walk'; // what gave you away, for the Caught screen
    this.absorbT = -99;
    this.stoneAt = -99; this.decoys = 0;  // thrown stones it has heard, and fallen for
    // how many it will fall for: fewer if it has met your stones before
    this.stoneTrust = Math.max(0, diff.stoneTrust - Math.round(this.memory.weight('stone') * diff.adapt * 2));
    this.exposed = false;                 // it has heard your breath right beside it: a hiding spot will not save you
    this.cutoff = null;                   // the door it is running to, ahead of you
    this.doubled = false;                 // has it clicked twice this time?
    this.pinnedAt = -999;                 // when it last felt your light hold it
    this.feintPhase = 'away'; this.feintBack = {x: 0, z: 0}; this.feintAfter = 0;
    this.lingerFor = 0; this.lingerKnown = false; this.breathT = 0; this.sniffed = false;
    this.stoodAt = null;                  // where it last stood over someone it could not quite find
    this.guessing = false;                // searching on a hunch, not because it ever had you
    this.fixAt = -99;                     // when it last truly placed you
    this.blocked = 0;                     // times in a row every way on has led past you
    this.hideNoted = false; this.closeAt = -99;
    this.masking = 0;                     // 0..1: how much a machine nearby is drowning out what it hears
    this.now = 0;
    this.planner = null;                  // needs the fields below, so it is made at the end
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
    this.burst = 'dash'; this.burstT = 0; this.emptyClicks = 0; this.fixAtClick = -99; // the hunt's rhythm
    this.fixFrom = {x: 0, z: 0};
    this.player = null;
    this.mimicT = this.span(STALKER.mimicEvery); this.groanT = this.span(STALKER.groanEvery);
    this.dots = null;                     // the session's dot buffer, for the red sonar dots
    this.sonarT = this.span(STALKER.sonarWalking); this.pulseIn = -1;
    this.lastLit = -99; this.pinned = false; this.pinScream = -99; this.surgeT = 0; this.pinFor = 0;
    // it gets used to the light, so this grows each time it runs, and with what it remembers of your light
    this.burnT = 0; this.burnNeed = diff.burn + diff.burnLearn * this.memory.weight('beam') * diff.adapt;
    this.followD = STALKER.followFar; this.stalkAfter = 0; this.echoT = -1; this.echoes = 0; this.tense = 0;
    this.graceFor = 0; this.avoid = null;  // after a respawn: keep away from where you came back
    this.pings = 0; this.pingAt = -99; this.pingX = 0; this.pingZ = 0; // your tracker's ticks it has heard
    this.heardPing = false; this.afterPing = false;
    this.echoRays = 0;                    // red sonar rays still to paint
    this.events = [];                     // for the session: 'windup', 'sonar', 'found', 'pinned', 'echo', 'flee', ...
    this.planner = new Planner(this);
  }

  span([a, b]) { return a + this.rand() * (b - a); }
  get active() { return this.state !== 'dormant'; }
  get hunting() { return this.state === 'hunt' || this.state === 'finale'; }
  get calm() { return this.state === 'patrol' || this.state === 'investigate' || this.state === 'listen' || this.state === 'wait'; }
  /** States in which it clicks: walking about, standing to listen, searching, lingering beside you. */
  get sonarOn() { return this.calm && this.state !== 'wait' || this.state === 'search' || this.state === 'linger'; }
  /**
   * States in which it must not blunder into someone keeping still: it does not know you are there. Searching,
   * that depends. Still standing where it last placed you, it walks right into you; moved since then and gone
   * still, it stops beside you and leans in (on Hard it just keeps walking).
   */
  get unaware() {
    if (this.calm || (this.state === 'feint' && this.feintPhase === 'back')) return true;
    if (this.state !== 'search') return false;
    if (this.guessing) return true; // it has no idea, it is only looking
    if (this.diff.searchBump || !this.player) return false;
    return Math.hypot(this.player.x - this.lastKnown.x, this.player.z - this.lastKnown.z) > STALKER.movedAway;
  }
  get dashLen() { return this.diff.dashTime * this.temper.bold; }

  /**
   * Spawn. With `awayFrom`, appear somewhere that is a long walk from that spot and from the `goals` you are
   * likely to head for next; with `exit` as well, the patrol point farthest from both, so a chase to the
   * exit starts behind you.
   */
  wake(awayFrom = null, state = 'patrol', exit = null, goals = []) {
    let [x, z] = this.cfg.spawn;
    if (awayFrom) [x, z] = exit ? this.finaleSpot(awayFrom, exit) : this.farthestPatrol(awayFrom.x, awayFrom.z, goals);
    this.x = x; this.z = z;
    this.actor.on = true;
    this.state = state;
    this.target = null; this.path = null; this.repathT = 0; this.sinceFix = 99; this.light = 0; this.exposure = 0;
    this.stuck = 0; this.lungeT = 0; this.stumbleT = 0; this.timer = 0; this.recoilT = 0; this.tense = 0;
    this.pulseIn = -1; this.pinned = false; this.surgeT = 0; this.pinFor = 0; this.burnT = 0; this.echoT = -1; this.followD = STALKER.followFar;
    this.echoRays = 0; this.afterPing = false; this.waylaying = false; this.cutoff = null; this.doubled = false; this.arousal = 0;
    this.exposed = false; this.guessing = false; this.fixAt = -99; this.clue = null; this.lingerKnown = false; this.feintPhase = 'away';
    this.belief.uniform();
    this.prevHits = this.actor.hits;
    this.nav.field(this.x, this.z, this.field);
    this.playerDist = awayFrom ? this.nav.distAt(this.field, awayFrom.x, awayFrom.z, 2.5) : Infinity;
    this.euclid = awayFrom ? Math.hypot(awayFrom.x - this.x, awayFrom.z - this.z) : Infinity;
    this.actor.place(this.x, this.z, this.face);
  }

  sleep() { this.state = 'dormant'; this.actor.on = false; this.sounds.setBreath(0, this.x, this.z); }

  /**
   * A place to appear: as far as possible from you and from wherever you are off to next, so that coming back
   * does not simply put it in the room you are heading for. Not always the same place, either.
   */
  farthestPatrol(x, z, goals = []) {
    const f = this.nav.field(x, z, this.tmpField);
    const scored = [];
    let top = -1;
    const rooms = this.planner.spots.filter(q => q.kind === 'room').map(q => [q.x, q.z]);
    for (const p of [this.cfg.spawn, ...this.cfg.patrol, ...rooms]) {
      let d = this.nav.distAt(f, p[0], p[1]);
      if (!isFinite(d) || !this.nav.walkableAt(p[0], p[1])) continue;
      for (const g of goals) d = Math.min(d, Math.hypot(p[0] - g.x, p[1] - g.z) * 1.3);
      scored.push([d, p]);
      if (d > top) top = d;
    }
    const good = scored.filter(q => q[0] >= top * 0.7);
    return good.length ? good[Math.floor(this.brainRand() * good.length)][1] : this.cfg.spawn;
  }

  /**
   * Where it runs from you: the patrol point farthest from you among those it reaches well before you
   * could, so the way there never leads past you. Cornered, it takes the one most on its side.
   */
  fleeSpot(x, z) {
    const fp = this.nav.field(x, z, this.tmpField), fc = this.nav.field(this.x, this.z, this.tmpField2);
    let best = null, bd = -1, side = this.cfg.spawn, bs = -Infinity;
    const places = [this.cfg.spawn, ...this.cfg.patrol, ...this.planner.spots.map(s => [s.x, s.z])];
    for (const q of places) {
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
    if (state === 'hunt') { this.burst = 'dash'; this.burstT = this.dashLen; this.emptyClicks = 0; this.doubled = false; this.cutoff = this.cutoffSpot(); }
    if (state === 'search') {
      const g = this.guess();
      this.searchC.x = g.x; this.searchC.z = g.z;
      this.belief.observe(g.x, g.z, 2 + Math.min(6, this.sinceFix), 0.8);
      this.searchLeft = Math.max(1, Math.round(this.diff.searchPoints * this.temper.patient));
      if (this.director.relaxing) this.searchLeft = 1;
      const amb = this.ambushSpot();
      this.ambushing = !!amb;
      this.target = amb || this.rememberedHide(g) || {x: g.x, z: g.z};
      this.timer = 0;
    }
    if (state === 'linger') {
      this.timer = this.span(STALKER.lingerTime); this.sonarT = 0.8; this.sounds.exhale(this.x, this.z);
      this.lingerFor = 0; this.breathT = 0; this.sniffed = false;
    }
    if (state === 'flank') this.timer = STALKER.flankTimeout;
    if (state === 'feint') {
      // off it goes, making sure you hear it: the far end of the level from where it lost you
      this.feintPhase = 'away'; this.feintAfter = T + STALKER.feintEvery; this.timer = this.span(STALKER.feintAway);
      this.feintBack.x = this.searchC.x; this.feintBack.z = this.searchC.z;
      this.target = this.farSpot(this.feintBack);
      this.events.push('feint');
    }
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
      this.director.rest(STALKER.fleeRest);
      this.pinnedAt = T;
    }
    if (state !== 'wait' && state !== 'listen') this.afterPing = false; // anything else, and it has moved on
    if (state !== 'wait') this.waylaying = false;
    if (state !== 'alert' && state !== 'hunt') this.exposed = false;
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
    this.lastKnown.x = x; this.lastKnown.z = z; this.sinceFix = 0; this.guessing = false; this.fixAt = T;
    this.arousal = Math.min(1, this.arousal + 0.25);
    this.fixFrom.x = this.x; this.fixFrom.z = this.z; // where it stood: the near side of wherever you went
  }

  /**
   * Where it reckons you are now: the last fix, carried on along the way you were heading for as long
   * as it has been without one (scaled by difficulty), stopping where the ground runs out.
   */
  guess(ahead = 2.5) {
    const L = this.lastKnown, g = this.guessPt, grid = this.pnav || this.nav;
    const k = Math.min(this.sinceFix, ahead) * this.diff.predict;
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
  notice(x, z, T, why = null) {
    this.fix(x, z, T);
    this.belief.place(x, z, 1.5);
    this.clue = why || this.heardKind;
    if (!this.hunting && this.state !== 'alert' && this.state !== 'flank') this.enter('alert', T); // already on its way round: it keeps going
  }

  /** Whether, having lost you, it follows your footsteps this time (difficulty, and not right after a respawn). */
  wantsStalk(T) { return T > this.stalkAfter && this.graceFor <= 0 && !this.director.relaxing && this.rand() < this.diff.stalk; }

  /**
   * A door has come down, or the ground has changed: if it was standing there, it is now just to one side.
   * Of the two sides of a door, the one away from you: a slam never shoves it through at you.
   */
  regrid() {
    if (!this.active || this.nav.walkableAt(this.x, this.z)) return;
    const {nav, player: p} = this, at = nav.nearest(this.x, this.z, 4);
    if (at < 0) return;
    let x = nav.cx(at), z = nav.cz(at);
    const ox = 2 * this.x - x, oz = 2 * this.z - z; // the same step the other way
    if (p && nav.walkableAt(ox, oz) && Math.hypot(ox - p.x, oz - p.z) > Math.hypot(x - p.x, z - p.z)) { x = ox; z = oz; }
    this.x = x; this.z = z; this.repathT = 0;
  }

  /** The longest it listens when it means it: a breath held from the start can always be let go quietly afterwards. */
  get holdable() { return this.diff.lungs * STALKER.holdRate * (1 - LUNGS.shaky) * 0.85; }

  /** Has it stood over this very spot not long ago? Then it suspects, and listens for your breath. */
  suspects(player, T) {
    const s = this.stoodAt;
    return !!(this.diff.suspect && s && T - s.T < STALKER.suspectFor && Math.hypot(player.x - s.x, player.z - s.z) < STALKER.suspectR);
  }

  /** Whether, giving up a search, it pretends to leave. */
  wantsFeint(T) {
    return T > this.feintAfter && this.graceFor <= 0 && !this.director.relaxing && this.brainRand() < this.diff.feint;
  }

  /** The director says you have had enough for now: it loses interest in whatever it was doing. */
  leaveOff() {
    if (this.state === 'stalk') { this.target = null; this.enter('patrol', this.now); }
    if (this.state === 'search') this.searchLeft = 1;
    if (this.waylaying) this.timer = Math.min(this.timer, 1);
  }

  /** The director's vague nudge: it has a feeling about that part of the level. Never exact. */
  hunch(x, z, sigma) { this.belief.observe(x, z, sigma, 0.75); }

  /** Having been pinned in your light lately and now coming back: whether to come in by another way. */
  wantsFlank(T) {
    if (!this.diff.flank || T - this.pinnedAt > STALKER.flankMemory || this.playerDist < 10) return false;
    if (this.brainRand() > this.diff.flank * (0.6 + 0.8 * this.memory.weight('beam') * this.diff.adapt)) return false;
    const spot = this.flankSpot();
    if (!spot) return false;
    this.target = spot;
    return true;
  }

  /** The way into your room that is not the obvious one, so long as the walk there does not pass you. */
  flankSpot() {
    const L = this.lastKnown, room = this.topo.roomAt(L.x, L.z);
    if (!room) return null;
    const ways = [];
    for (const e of this.topo.exits(room)) {
      const d = this.nav.distAt(this.field, e.x, e.z, 1.5);
      if (isFinite(d)) ways.push({x: e.x, z: e.z, d});
    }
    if (ways.length < 2) return null;
    ways.sort((a, b) => a.d - b.d);
    for (let i = 1; i < ways.length; i++) {
      if (ways[i].d < ways[0].d + 40 && this.routeClear([ways[i].x, ways[i].z], L, 5)) return {x: ways[i].x, z: ways[i].z};
    }
    return null;
  }

  /** If you are running for a door it can reach before you, that door. Asked at the start of each dash. */
  cutoffSpot() {
    const {diff} = this;
    if (!diff.intercept || this.sinceFix > 1.5) return null;
    if (this.brainRand() > diff.intercept * (0.6 + 0.8 * this.memory.weight('run') * diff.adapt)) return null;
    const L = this.lastKnown, v = this.fixVel, sp = Math.hypot(v.x, v.z), room = this.topo.roomAt(L.x, L.z);
    if (sp < 1.8 || !room) return null;
    let best = null, soonest = Infinity;
    for (const e of this.topo.exits(room)) {
      const ex = e.x - L.x, ez = e.z - L.z, d = Math.hypot(ex, ez);
      if (d < 2 || (ex * v.x + ez * v.z) / (d * sp) < 0.75) continue; // not the way you are heading
      const you = d / sp, it = this.nav.distAt(this.field, e.x, e.z, 1.5) / (STALKER.dash * diff.speed);
      if (it < you + 0.4 && you < soonest) { soonest = you; best = {x: e.x, z: e.z}; }
    }
    return best;
  }

  /**
   * On your way to the exit, the first place it can reach before you do, as {x, z}; null if there is none.
   * A loop or a crawl is how you get round it.
   */
  headOff(player) {
    const P = this.pnav, E = this.exit;
    if (!P || !E || P.n !== this.nav.n) return null;
    const path = P.path(P.field(E.x, E.z, this.tmpField), player.x, player.z, 2);
    if (!path) return null;
    const pace = STALKER.finale * this.diff.speed, you = 3.2;
    // the path runs from the exit to you, so walk it backwards: half a metre a cell, and a little for corners
    for (let i = path.length - 1, walked = 0; i >= 0; i -= 4, walked += 2.2) {
      if (walked < 6) continue;  // not right on top of you: that is what following is for
      const it = this.field[path[i]];
      if (isFinite(it) && it / pace < walked / you) return {x: P.cx(path[i]), z: P.cz(path[i])};
    }
    return null;
  }

  /** The place farthest from `from` that it can walk to from here. `from` may be in a crawl it cannot enter. */
  farSpot(from) {
    let best = null, bd = -1;
    for (const s of this.planner.spots) {
      const d = Math.hypot(s.x - from.x, s.z - from.z), here = this.nav.distAt(this.field, s.x, s.z, 0.6);
      if (isFinite(here) && here > 4 && d > bd) { bd = d; best = s; }
    }
    return best ? {x: best.x, z: best.z} : {x: this.x, z: this.z};
  }

  /** A hiding place near (g) that it has caught you using before: it goes there first. */
  rememberedHide(g) {
    let best = null, most = 0;
    for (const s of this.planner.spots) {
      if (s.kind !== 'hide') continue;
      const n = this.memory.hideCount(s.i);
      if (n < this.diff.hideMemory || n <= most || Math.hypot(s.x - g.x, s.z - g.z) > 18) continue;
      if (isFinite(this.nav.distAt(this.field, s.x, s.z, 0.6))) { most = n; best = {x: s.x, z: s.z}; }
    }
    return best;
  }

  /** You have just gone to ground with it after you: it takes note of where. */
  noteHiding(player) {
    if (!player.hidden) { this.hideNoted = false; return; }
    if (this.hideNoted || !(this.hunting || this.state === 'alert' || (this.state === 'search' && !this.guessing) || this.state === 'linger' || this.now - this.fixAt < 6)) return;
    this.hideNoted = true;
    let at = -1, bd = Infinity;
    this.hides.forEach((h, i) => { const d = Math.hypot(player.x - h.x, player.z - h.z); if (d < bd) { bd = d; at = i; } });
    if (at >= 0 && this.memory.hideUsed(at)) this.learned('hide');
    this.events.push('hid');
  }

  /** It has just worked something out about you. */
  learned(habit) {
    this.events.push('learned:' + habit);
    if (this.playerDist < 30) this.sounds.chitter(this.x, this.z, this.muffle());
  }

  /** A sound reaches it: what it does to the map of where you might be, and to its memory of you. */
  absorb(n, d, T) {
    const run = n.kind === 'step' && n.loud >= NOISE.sprintStep;
    this.heardKind = run ? 'run' : n.kind === 'step' ? (n.loud <= NOISE.crouchStep ? 'creep' : 'walk') : n.kind;
    this.memory.heard(n.x, n.z, n.kind === 'step' ? 1 : 2);
    if (run && (this.state === 'hunt' || this.state === 'alert') && this.memory.note('run', 0.3)) this.learned('run');
    if (T - this.absorbT < 0.12 && !n.exact) return; // the scanner's hum is continuous; one reading will do
    this.absorbT = T;
    // it hears where a sound is only roughly, worse from further away; several readings average that out
    const r = this.brainRand, err = Math.max(0.4, d * 0.1);
    this.belief.observe(n.x + (r() + r() - 1) * err, n.z + (r() + r() - 1) * err, Math.max(1, d * 0.14), n.exact ? 0.995 : 0.97);
  }

  /**
   * A stone landing. For a while it comes running. Then it has fallen for that too often: it knows nobody is
   * there, and that whoever threw it cannot be far, and it goes looking for them instead.
   */
  hearStone(n, T) {
    if (T - this.stoneAt < 1.5) return; // the later bounces of the same stone
    this.stoneAt = T;
    const fights = this.state === 'hunt' || this.state === 'alert' || this.state === 'flank';
    if (this.decoys < this.stoneTrust) {
      this.decoys++;
      if (this.memory.note('stone')) this.learned('stone');
      this.belief.observe(n.x, n.z, 2, 0.9);
      this.heardKind = 'stone';
      if (fights) { this.fix(n.x, n.z, T); this.fixVel.x = 0; this.fixVel.z = 0; this.cutoff = null; return; }
      const r = this.brainRand;
      this.target = {x: n.x + (r() - 0.5) * 2, z: n.z + (r() - 0.5) * 2};
      this.enter('investigate', T);
      return;
    }
    this.memory.note('stone', 0.5);
    this.events.push('wise');
    this.sounds.chitter(this.x, this.z, this.muffle());
    if (fights) return; // it does not even turn its head
    this.belief.touch(n.x, n.z, 3, 0.1);
    this.belief.observe(n.x, n.z, 11, 0.7);
    const b = this.belief.best(this.field, {min: 2, D: 25});
    if (b) {
      this.lastKnown.x = b.x; this.lastKnown.z = b.z; this.fixVel.x = 0; this.fixVel.z = 0; this.sinceFix = 3;
      this.guessing = true;
      this.enter('search', T);
    }
  }

  /** Start a click burst: you hear it now; the echo (red dots, and whether it finds you) comes a moment later. */
  click(T) {
    this.pulseIn = this.diff.sonarWarn;
    this.actor.flare = 1; // the ear fans wide
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
    this.actor.flare = 1;
    if (this.dots && this.euclid < 32) this.echoRays = STALKER.sonarRays;
    // you, inside the echo: in reach and nothing solid between you
    const dx = player.x - hx, dy = player.eye - 0.35 - hy, dz = player.z - hz, d = Math.hypot(dx, dy, dz);
    const inside = d <= R && !cast(this.world, hx, hy, hz, dx / d, dy / d, dz / d, Math.max(0, d - 0.2), false);
    if (inside) {
      this.events.push('sonar');
      const moving = player.still < 0.25 && !(this.diff.sonarCrouch && player.crouched);
      if (moving && !player.hidden) { this.events.push('found'); this.notice(player.x, player.z, T, 'echo'); return; }
      // it sees you do it, in a way: something was here a moment ago, and now nothing moves
      if (this.state === 'hunt' && this.memory.note('freeze', 0.5)) this.learned('freeze');
    }
    // nothing moved in the echo. You may be keeping still, so that only lowers the odds around it
    // (measured from its body, not its head: what it concludes must not hang on how its head happens to be cocked)
    const ox = this.x, oz = this.z;
    this.belief.scan(ox, 1.4, oz, R, 0.55, (ex, ey, ez, far) => cast(this.world, ox, 1.4, oz, ex, ey, ez, Math.max(0, far - 0.2), false));
  }

  /** Report noises made this frame: [{x, z, loud, exact, kind}]. */
  hear(noises, T) {
    if (!this.active || this.state === 'finale' || this.state === 'flee') return;
    // standing still and listening, it hears further; following your footsteps, further still; flat out,
    // its own feet cover some of it. A machine running nearby drowns out everything but the loudest sounds.
    const ears = this.diff.hearing * (this.ears ? this.diff.listen : 1) * (this.state === 'stalk' ? 2 : 1)
      * (this.state === 'hunt' && this.burst === 'dash' ? STALKER.dashDeaf : 1);
    for (const n of noises) {
      const loud = n.loud * ears * (n.exact ? 1 : 1 - STALKER.maskDrop * this.masking), d = this.nav.distAt(this.field, n.x, n.z, 2.5);
      if (!(d <= loud)) continue;
      this.heardYou = true;
      if (n.kind === 'stone') { this.hearStone(n, T); continue; }
      this.absorb(n, d, T);
      // your breath, right beside it: it knows exactly where you are, hiding or not
      if (n.kind === 'breath' && this.state === 'linger') this.exposed = true;
      if (this.waylaying) {
        // standing silent on purpose: it lets you come, and lets you come
        if (d < STALKER.waylayPounce * this.diff.hearing || n.exact) this.notice(n.x, n.z, T);
        continue;
      }
      if (this.state === 'stalk') {
        // a footstep: it steps with you and closes in. The sweep or a core: it pounces. The scanner's
        // hum: it freezes to listen for a moment, and if the beam finds it in that moment it bolts.
        if (n.exact || n.loud > NOISE.sprintStep) { this.notice(n.x, n.z, T); continue; }
        if (n.kind !== 'step') { this.fix(n.x, n.z, T); if (this.tense <= 0) this.tense = this.diff.alertTime + 0.4; continue; }
        this.fix(n.x, n.z, T);
        this.followD = Math.max(STALKER.followNear, this.followD - this.diff.stalkClose);
        this.echoT = 0.11;
      } else if (this.state === 'hunt' || this.state === 'alert' || this.state === 'flank') {
        if (n.exact || d < loud * 0.6) this.fix(n.x, n.z, T);
      } else if (n.exact || d < loud * 0.35 || this.state === 'linger' || this.state === 'search' || this.state === 'feint') {
        this.notice(n.x, n.z, T);
      } else if (n.kind === 'tracker' && this.calm) {
        this.hearPing(n, d, T);
      } else if (this.calm && n.kind === 'step' && d > loud * 0.5 && this.rand() < 0.5 && this.wantsStalk(T)) {
        // a distant footstep: rather than come and look, it starts to follow
        this.fix(n.x, n.z, T);
        this.enter('stalk', T);
      } else {
        // the likeliest spot around that sound: rough the first time, sharper with every sound after it
        this.target = this.belief.peakNear(n.x, n.z, Math.max(2, d * 0.2));
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
    if (this.memory.note('tracker', 0.4)) this.learned('tracker');
    if (this.diff.trkNotice && this.pings >= this.diff.trkNotice) { this.notice(n.x, n.z, T, 'tracker'); return; }
    if (this.pings === 1) {
      const r = this.rand();
      // the more it knows your tracker, the likelier it is to stand still for it
      const freeze = this.diff.trkFreeze && this.diff.trkFreeze + 0.25 * this.memory.weight('tracker') * this.diff.adapt;
      if (r < freeze) { this.enter('wait', T); this.timer = 4 + this.rand() * 3; this.afterPing = true; return; }
      if (r < freeze + this.diff.trkListen) {
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
    this.player = player; this.now = T;

    this.repathed = (this.repathT -= dt) <= 0;
    if (this.repathed) {
      this.repathT = STALKER.repathEvery;
      nav.field(this.x, this.z, this.field);
    }
    this.playerDist = nav.distAt(this.field, player.x, player.z, 2.5);
    this.euclid = Math.hypot(player.x - this.x, player.z - this.z);

    // its reasoning: the map spreads with time, and wherever it stands you evidently are not
    this.arousal = Math.max(0, this.arousal - dt / STALKER.arousalFade);
    if (this.state !== 'finale') {
      this.belief.step(dt);
      if (this.repathed) { this.belief.touch(this.x, this.z); this.planner.markSeen(T); }
      this.director.update(dt, this, player);
      this.noteHiding(player);
    }
    if ((this.hunting || this.state === 'alert' || this.state === 'linger') && this.euclid < 2.6 && T - this.closeAt > 12) {
      this.closeAt = T; this.events.push('closecall');
    }

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
      this.pinnedAt = T;
      if (this.memory.note('beam')) this.learned('beam');
    }
    if (wasPinned && !this.pinned && heldFor > STALKER.surgeAfter) {
      // let go, it comes at once: hunting, a fresh dash straight at you; otherwise a burst of speed
      if (this.state === 'hunt') { this.fix(player.x, player.z, T); this.burst = 'dash'; this.burstT = this.dashLen; this.pulseIn = -1; this.cutoff = null; }
      else if (this.hunting || this.state === 'search' || this.state === 'alert') this.surgeT = STALKER.surge;
    }
    // once it knows you are there, hold it in the light long enough and it breaks and runs; each time it
    // takes longer to break. After the last core it does not run: the light only holds it.
    this.burnT = this.pinned && !this.calm && this.state !== 'finale' ? this.burnT + dt : Math.max(0, this.burnT - dt * 0.5);
    if (this.burnT > this.burnNeed) {
      this.burnT = 0; this.burnNeed += this.diff.burnLearn; this.pinned = false; this.pinFor = 0; this.exposure = 0;
      this.enter('flee', T);
    }
    // following you, it wants not to be seen: the first touch of the beam and it is gone
    else if (this.state === 'stalk' && fresh > 0) this.enter('flee', T);
    else if (this.exposure > this.diff.lightHold && this.playerDist < 16 && this.state !== 'finale' && this.state !== 'flee') this.notice(player.x, player.z, T, 'light');
    if (this.graceFor > 0) this.graceFor -= dt;

    // sonar: a click burst now and then while it walks or listens; the echo follows a moment later
    if (this.pulseIn >= 0 && (this.pulseIn -= dt) < 0) this.echo(T, player);
    if (this.echoRays > 0) { // the red spreads over about half a second
      const n = Math.min(this.echoRays, Math.ceil(STALKER.sonarRays * dt / STALKER.echoTime));
      this.echoRays -= n;
      this.paintEcho(T, n);
    }
    if (this.sonarOn && this.pulseIn < 0 && (this.sonarT -= dt) <= 0) {
      // worked up, it clicks more often; off the boil, less
      this.sonarT = this.span(this.state === 'patrol' || this.state === 'investigate' ? STALKER.sonarWalking : STALKER.sonarEvery)
        * (1 - 0.35 * this.arousal) * (this.director.relaxing ? 1.4 : 1);
      this.click(T);
    }

    // coming up on someone hidden or keeping still: it stops right there, and listens, and leans in. On Hard,
    // while it is searching for you, only a hiding spot does that; out in the open it walks right into you.
    if ((player.hidden || (player.quiet && this.unaware)) && (this.unaware || this.state === 'search') && T > this.lingerAfter
        && this.playerDist < STALKER.lingerDist && this.euclid < STALKER.lingerDist) {
      this.lingerAfter = T + 15;
      this.lingerHid = player.hidden;
      // a hiding place it remembers you using: it stays longer, and your breathing can give you away
      let known = false;
      if (player.hidden) this.hides.forEach((h, i) => { if (Math.hypot(player.x - h.x, player.z - h.z) < h.r && this.memory.hideCount(i) >= this.diff.hideMemory) known = true; });
      // or out in the open, it has stood right here before, not long ago, and something has brought it back.
      // (A hiding spot muffles your breathing, until it has learned that spot.)
      if (!player.hidden && this.suspects(player, T)) known = true;
      this.enter('linger', T);
      this.lingerKnown = known;
      if (known) { this.timer = Math.min(this.timer * 1.5, this.holdable); this.events.push('knownhide'); }
    }

    const reach = A.crawl > 0.5 ? STALKER.catchCrawl : STALKER.catchDist;
    if (this.recoilT > 0) this.recoilT -= dt;
    else if (this.euclid < reach && this.state !== 'flee' && (!player.hidden || this.state === 'finale' || this.exposed)) {
      // on Easy, blundering into it before it knows you are there gives you one chance to run
      if (!(this.diff.bumpGrace && this.calm && T > this.graceAfter)) {
        if (this.calm) this.clue = 'bump';
        return true;
      }
      this.graceAfter = T + 20; this.recoilT = this.diff.alertTime + 0.3;
      this.notice(player.x, player.z, T, 'bump');
    }

    let speed = 0, listening = false, breath = 1;
    const facePlayer = () => {
      const want = Math.atan2(player.x - this.x, -(player.z - this.z));
      this.face += clamp(angleDiff(this.face, want), -5 * dt, 5 * dt);
    };
    switch (this.state) {
      case 'patrol': {
        if (!this.target) this.target = this.nextPatrol(this.unnoticedNear());
        if (!this.target) { // every way on passes you. It waits; but it will not wait for ever
          if (++this.blocked >= 2 && this.diff.suspect && T > this.lingerAfter) {
            this.blocked = 0; this.lingerAfter = T + 15;
            this.enter('linger', T);
            this.lingerHid = player.hidden; this.lingerKnown = !player.hidden; this.timer = Math.min(this.timer + 4, this.holdable);
            if (this.lingerKnown) this.events.push('knownhide');
          } else this.enter('listen', T);
          break;
        }
        this.blocked = 0;
        speed = STALKER.patrol * (1 + 0.5 * this.arousal);
        if (this.arrived()) {
          this.target = null;
          if (this.goal === 'choke' && !this.director.relaxing && this.brainRand() < this.diff.waylay) {
            // a good place to wait: silent, still, invisible to your tracker, ears wide open
            this.enter('wait', T); this.timer = this.span(STALKER.waylayTime) * this.temper.patient; this.waylaying = true;
          } else this.enter(this.rand() < STALKER.waitChance ? 'wait' : 'listen', T);
        }
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
        speed = STALKER.investigate * (1 + 0.25 * this.arousal);
        if (this.arrived()) { this.target = null; this.enter('listen', T); this.timer += 2; }
        break;
      }
      case 'alert': { // frozen mid-step, head turning toward you, holding its breath
        listening = true; breath = 0;
        const want = Math.atan2(this.lastKnown.x - this.x, -(this.lastKnown.z - this.z));
        this.face += clamp(angleDiff(this.face, want), -4 * dt, 4 * dt);
        if ((this.timer -= dt) <= 0) this.enter(this.wantsFlank(T) ? 'flank' : 'hunt', T);
        break;
      }
      case 'flank': { // the long way round, to the door you are not watching, quietly
        this.sinceFix += dt;
        speed = STALKER.hunt; breath = 0.3;
        if (this.arrived() || (this.timer -= dt) <= 0) this.enter('hunt', T);
        break;
      }
      case 'hunt': {
        this.sinceFix += dt;
        if (this.burst === 'dash') {
          // with no fresh sound it heads a little way along where it reckons you were going, and pulls up
          // just short of there to listen rather than charging blindly through. If it saw which door you
          // were running for and can get there first, it runs for the door instead.
          const cut = this.cutoff && this.sinceFix < 3 ? this.cutoff : null;
          this.target = cut || (this.sinceFix > 0.5 ? this.guess(1) : this.lastKnown);
          speed = STALKER.dash;
          const short = !cut && this.sinceFix > 0.5 && Math.hypot(this.target.x - this.x, this.target.z - this.z) < 1.3;
          if ((this.burstT -= dt) <= 0 || short || (this.arrived() && this.sinceFix > 0.3)) {
            // stop dead, ear open, and click: the echo comes a moment later
            this.burst = 'click'; this.target = null; this.fixAtClick = this.fixT;
            this.pulseIn = this.diff.huntWarn; this.actor.flare = 1;
            this.sounds.clicks(this.x, this.z, this.muffle(), 'short');
            if (this.euclid < this.diff.sonar + 4) { this.events.push('windup'); this.events.push('huntclick'); }
          }
        } else { // standing, head up, listening, until its echo has gone out
          listening = true; breath = 0.2;
          const want = Math.atan2(this.lastKnown.x - this.x, -(this.lastKnown.z - this.z));
          this.face += clamp(angleDiff(this.face, want), -4 * dt, 4 * dt);
          if (this.pulseIn < 0) {
            // an empty click, and it knows the trick: a second, right behind it, for anyone who starts moving again
            const empty = !(this.fixT > this.fixAtClick);
            if (empty && !this.doubled && this.brainRand() < this.diff.doubleClick * (0.6 + 0.8 * this.memory.weight('freeze') * this.diff.adapt)) {
              this.doubled = true;
              this.pulseIn = this.diff.huntWarn * 0.85; this.actor.flare = 1;
              this.sounds.clicks(this.x, this.z, this.muffle(), 'short');
              if (this.euclid < this.diff.sonar + 4) this.events.push('windup');
              break;
            }
            this.doubled = false;
            // nothing moved in the echo and nothing heard since the click: an empty one. Empty right where
            // it last placed you, you are not there: it searches the area (a few in a row, anywhere, too)
            this.emptyClicks = this.fixT > this.fixAtClick ? 0 : this.emptyClicks + 1;
            const there = Math.hypot(this.lastKnown.x - this.x, this.lastKnown.z - this.z) < 2.5;
            if (this.emptyClicks >= this.diff.huntCycles || (this.emptyClicks > 0 && there)) { this.enter('search', T); break; }
            this.burst = 'dash'; this.burstT = this.dashLen; this.cutoff = this.cutoffSpot();
          }
        }
        break;
      }
      case 'search': {
        if (this.timer > 0) { // stopped at a spot, listening hard
          listening = true;
          if ((this.timer -= dt) <= 0 && this.pulseIn < 0) {
            if (--this.searchLeft <= 0) {
              this.target = null;
              // nothing: it goes quiet, or it waits for your footsteps and follows them, or it pretends to leave
              if (this.wantsStalk(T)) this.enter('stalk', T);
              else if (this.wantsFeint(T)) this.enter('feint', T);
              else this.enter('listen', T);
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
          if ((this.tense -= dt) <= 0) this.enter('hunt', T); // for where it heard you, not where you have got to
          break;
        }
        const moving = player.still < 0.25 && !player.hidden;
        const want = Math.atan2(this.lastKnown.x - this.x, -(this.lastKnown.z - this.z));
        this.face += clamp(angleDiff(this.face, want), -3 * dt, 3 * dt);
        if (moving && this.playerDist > this.followD) { this.target = this.lastKnown; speed = STALKER.hunt; }
        // close enough: it pounces
        if (moving && this.followD <= STALKER.followNear && this.playerDist < STALKER.followNear + 0.8) {
          this.fix(player.x, player.z, T);
          this.clue = 'stalk';
          this.enter('hunt', T);
        }
        break;
      }
      case 'feint': { // off with a heavy tread, making sure you hear it; then back, without a sound
        if (this.feintPhase === 'away') {
          speed = STALKER.investigate * 0.8;
          if ((this.timer -= dt) <= 0 || this.arrived()) {
            this.feintPhase = 'back';
            this.target = this.belief.peakNear(this.feintBack.x, this.feintBack.z, 8);
          }
        } else {
          speed = STALKER.investigate; breath = 0;
          if (this.arrived() || (player.quiet && this.euclid < 2)) {
            this.target = null;
            this.enter('wait', T); this.timer = this.span(STALKER.feintWait) * this.temper.patient; this.waylaying = true;
          }
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
        // it leans closer, drawing the air in
        this.lingerFor += dt;
        if (this.lingerFor > STALKER.leanAfter) {
          if (!this.sniffed) { this.sniffed = true; this.sounds.sniff(this.x, this.z, this.muffle()); }
          const d = this.euclid;
          if (d > STALKER.leanStop && !this.pinned && nav.lineClear(this.x, this.z, player.x, player.z)) {
            const step = Math.min(d - STALKER.leanStop, STALKER.leanSpeed * dt);
            const nx = this.x + (player.x - this.x) / d * step, nz = this.z + (player.z - this.z) / d * step;
            if (nav.walkableAt(nx, nz)) { this.x = nx; this.z = nz; }
          }
        }
        // standing up out of a hiding spot, or lighting the scanner in it, right beside it
        if (this.lingerHid && !player.hidden) { this.notice(player.x, player.z, T, 'stood'); break; }
        // at a hiding place it knows, it can hear you breathing, unless you hold your breath
        if (this.lingerKnown && !player.holdingBreath && this.euclid < 2.4 && (this.breathT += dt) > STALKER.knownBreath) {
          this.exposed = true;
          this.notice(player.x, player.z, T, 'breath');
          break;
        }
        if ((this.timer -= dt * (player.holdingBreath ? STALKER.holdRate : 1)) <= 0) {
          this.stoodAt = {x: player.x, z: player.z, T}; // nothing, this time
          this.target = null; this.enter('patrol', T);
        }
        break;
      }
      case 'finale': {
        // it knows roughly where you are: a fresh guess every so often, exact once it is close
        if (this.arrived()) this.timer = Math.min(this.timer, 0.3);
        const near = this.playerDist < this.diff.finaleNear;
        if ((this.timer -= dt) <= 0 || (near && this.repathed)) {
          this.timer = this.diff.finaleGuess;
          const j = near ? 0 : Math.min(4, this.playerDist * this.diff.finaleJitter);
          // it knows you want the door. Now and then it stops following and goes to meet you on the way
          const cut = !near && this.brainRand() < this.diff.finaleCut ? this.headOff(player) : null;
          this.target = cut || {x: player.x + (this.rand() * 2 - 1) * j, z: player.z + (this.rand() * 2 - 1) * j};
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
        // sometimes it is bait: it goes silent, to hear whether you come to look
        if (this.state === 'patrol' && !this.director.relaxing && this.brainRand() < this.diff.waylay) {
          this.target = null;
          this.enter('wait', T); this.timer = this.span(STALKER.lureWait); this.waylaying = true;
        }
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
    else if (this.state === 'finale' && this.euclid < STALKER.lungeDist && nav.lineClear(this.x, this.z, player.x, player.z)) {
      speed *= STALKER.lunge;
      if ((this.lungeT += dt) > this.diff.lungeMax) { this.lungeT = 0; this.stumbleT = STALKER.stumble; }
    } else this.lungeT = Math.max(0, this.lungeT - dt);
    speed = Math.min(speed, STALKER.maxSpeed);
    this.speed = speed;
    if (speed > 0 && this.target) {
      const x0 = this.x, z0 = this.z;
      this.walk(dt, speed);
      // no progress (a crawl mouth, a shut door, a corner it cannot round): it gives up on the spot
      this.stuck = Math.hypot(this.x - x0, this.z - z0) < speed * dt * 0.3 ? this.stuck + dt : 0;
    }

    this.ears = listening || this.state === 'wait';
    const low = this.world.heightAt(this.x, this.z) < STALKER.crawlBelow;
    // in the light it rears back and covers its face; listening, its ear opens
    // hunting it runs on all fours and rises onto its haunches, head up, to click
    const crawl = this.pinned ? 0 : this.state === 'hunt' && this.burst === 'click' ? (low ? 1 : 0.45) : this.hunting || low ? 1 : 0;
    animateCreature(A, dt, {speed, crawl, listening, shield: this.pinned ? 1 : 0});
    A.place(this.x, this.z, this.face);

    // the sound of it. Stalking, its feet land just after yours, so you hear your own steps twice.
    const muffle = this.muffle();
    if (this.echoT > 0 && (this.echoT -= dt) <= 0) {
      this.sounds.creatureStep(this.x, this.z, Math.max(0.45, muffle), 0.7, false);
      if (++this.echoes === 4) this.events.push('echo');
    }
    const silent = this.state === 'stalk' || (this.state === 'feint' && this.feintPhase === 'back');
    if (speed > 0 && !silent) {
      const crawling = A.crawl > 0.5;
      this.stepAcc += dt * speed;
      if (this.stepAcc > (crawling ? 1.25 : 0.78)) {
        this.stepAcc = 0; this.stepN++;
        if (this.state === 'feint') this.sounds.stomp(this.x, this.z, muffle);
        else if (this.state === 'flank') this.sounds.creatureStep(this.x, this.z, Math.max(0.6, muffle), 0.7, false);
        else if (crawling) this.sounds.gallop(this.x, this.z, muffle);
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
    animateCreature(this.actor, dt, {listening: true, rear: 1}); // over you, its face open
    this.actor.place(this.x, this.z, this.face);
    this.sounds.setBreath(0, this.x, this.z);
  }

  arrived() {
    return !this.target || this.stuck > STALKER.stuckAfter || Math.hypot(this.target.x - this.x, this.target.z - this.z) < 0.7;
  }

  /**
   * A spot to search near where it lost you: wherever its map says you are likeliest, within reach, so it
   * never checks the same corner twice while somewhere better is left. Now and then it goes by instinct:
   * near where it lost you, more often ahead of the way you were heading.
   */
  searchSpot() {
    const c = this.searchC, R = this.diff.searchRadius, v = this.fixVel, heading = Math.hypot(v.x, v.z) > 0.5;
    if (this.brainRand() < 0.8) {
      const b = this.belief.best(this.field, {min: 1.5, max: R * 1.8, D: R * 1.6});
      if (b) return {x: b.x, z: b.z};
    }
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
    // (a creature that has not thought of it on its own can still learn it, if you always use the crawls)
    if ((!this.diff.ambush && this.memory.weight('crawl') * this.diff.adapt < 0.5) || !P || P.n !== this.nav.n) return null;
    const low = i => P.walk[i] && w.heightAt(P.cx(i), P.cz(i)) < minH;
    const s = P.nearest(L.x, L.z, 1);
    if (s < 0 || !low(s)) return null;
    const seen = new Uint8Array(P.n), q = [s];
    seen[s] = 1;
    // far from the side it was on when it last placed you (where it is now may be halfway round already)
    const from = this.nav.field(this.fixFrom.x, this.fixFrom.z, this.tmpField);
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
        const d = this.nav.distAt(from, P.cx(j), P.cz(j), 2); // an opening: how far it is to walk round
        if (isFinite(d) && d > bd) { bd = d; best = {x: P.cx(j), z: P.cz(j)}; }
      }
    }
    if (!(best && bd < 50)) return null;
    if (this.memory.note('crawl')) this.learned('crawl');
    return best;
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
    const s = this.planner.next(this.now, avoid);
    if (s) {
      this.goal = s.kind;
      if (s.kind === 'patrol') this.patrolAt = s.i;
      return {x: s.x, z: s.z};
    }
    if (avoid) return null;
    const p = this.cfg.patrol[Math.floor(this.rand() * this.cfg.patrol.length)];
    this.goal = 'patrol';
    return {x: p[0], z: p[1]};
  }

  /** True when the walk to `pt` never comes closer to `a` than `keep` (or than it already is). */
  routeClear(pt, a, keep = STALKER.clearance + 0.3) {
    const nav = this.nav, path = nav.path(this.field, pt[0], pt[1], 4);
    if (!path) return false;
    const lim = Math.min(keep, Math.hypot(a.x - this.x, a.z - this.z) - 0.4);
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
      if (this.state !== 'finale') { this.target = null; this.enter('listen', this.now); }
      return;
    }
    const dx = gx - this.x, dz = gz - this.z, d = Math.hypot(dx, dz);
    if (d < 1e-4) return;
    const step = Math.min(d, speed * dt), nx = this.x + dx / d * step, nz = this.z + dz / d * step;
    // it does not know you are there, so it must not blunder into you: it stops short and listens
    const p = this.unnoticedNear();
    if (p && this.unaware && Math.hypot(p.x - nx, p.z - nz) < Math.min(STALKER.clearance, this.euclid)) {
      this.target = null; this.enter('listen', this.now);
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

  /** A compact account of what it is thinking, for the debug overlay. */
  thinking() {
    const b = this.belief;
    return {state: this.state + (this.state === 'feint' ? ':' + this.feintPhase : this.waylaying ? ':waylay' : this.state === 'hunt' ? ':' + this.burst : ''),
      goal: this.goal, phase: this.director.phase, menace: +this.director.menace.toFixed(2), arousal: +this.arousal.toFixed(2),
      unsure: +b.spread().toFixed(1), quiet: Math.round(this.director.quiet), cutoff: !!this.cutoff, decoys: this.decoys,
      dist: +this.playerDist.toFixed(1), temper: this.temper,
      knows: Object.fromEntries(['hide', 'beam', 'run', 'crawl', 'tracker', 'stone', 'freeze'].map(k => [k, +this.memory.weight(k).toFixed(2)]))};
  }
}
