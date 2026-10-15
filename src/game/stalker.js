// The creature. It cannot see. It hears footsteps, the scanner hum and the sweep, measured as walking
// distance so sound reaches it round corners. It feels the scanner's light when you hold it on its
// body, and it feels anyone who comes within arm's reach.
//
//   dormant ─wake─> patrol ⇄ listen / wait (silent, motionless)
//                     │  ▲
//            heard ───┘  │ nothing there
//                     investigate
//                        │ heard you close / felt the light
//                        ▼
//                      alert (freezes, turns to you) ──> hunt (on all fours, lunges at the end)
//   linger: passing a hidden player it stops beside them and listens; move and it has you.
//   finale: after the last core it always knows roughly where you are.

import {STALKER} from '../config.js';
import {clamp, angleDiff} from '../util/math.js';
import {makeCreature, animateCreature} from './figures.js';
import {buzz} from '../ui/haptics.js';

const MIMICS = ['trigger', 'ping', 'chime', 'steps'];

export class Stalker {
  constructor(cfg, world, nav, diff, rand, sounds) {
    this.cfg = cfg;
    this.world = world; this.nav = nav; this.diff = diff; this.rand = rand; this.sounds = sounds;
    this.actor = makeCreature();
    world.actors.push(this.actor);
    this.field = new Float32Array(nav.n);
    this.tmpField = new Float32Array(nav.n);
    this.state = 'dormant';
    this.x = cfg.spawn[0]; this.z = cfg.spawn[1]; this.face = 0;
    this.target = null; this.path = null; this.repathT = 0; this.repathed = false;
    this.lastKnown = {x: 0, z: 0}; this.sinceFix = 99;
    this.timer = 0; this.clickT = 2; this.stepAcc = 0; this.stepN = 0; this.lastScream = -99;
    this.patrolAt = -1; this.speed = 0;
    this.playerDist = Infinity; this.euclid = Infinity;
    this.light = 0; this.prevHits = 0;
    this.lingerAfter = 0; this.heardYou = false;
    this.mimicT = this.span(STALKER.mimicEvery); this.groanT = this.span(STALKER.groanEvery);
    this.rear = 0;
  }

  span([a, b]) { return a + this.rand() * (b - a); }
  get active() { return this.state !== 'dormant'; }
  get hunting() { return this.state === 'hunt' || this.state === 'finale'; }

  /** Spawn. With `awayFrom`, appear at the patrol point that is the longest walk from that spot. */
  wake(awayFrom = null, state = 'patrol') {
    let [x, z] = this.cfg.spawn;
    if (awayFrom) [x, z] = this.farthestPatrol(awayFrom.x, awayFrom.z);
    this.x = x; this.z = z;
    this.actor.on = true;
    this.state = state;
    this.target = null; this.path = null; this.repathT = 0; this.sinceFix = 99; this.light = 0; this.rear = 0;
    this.prevHits = this.actor.hits;
    this.nav.field(this.x, this.z, this.field);
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

  enter(state, T) {
    if (state === 'hunt' && !this.hunting && T - this.lastScream > 8) {
      this.lastScream = T;
      this.sounds.shriek(this.x, this.z, this.muffle());
      buzz([30, 40, 90]);
    }
    if (state === 'listen') { this.timer = this.span(STALKER.listenTime); this.clickT = 0.3; }
    if (state === 'wait') this.timer = this.span(STALKER.waitTime);
    if (state === 'alert') this.timer = STALKER.alertTime;
    if (state === 'linger') { this.timer = this.span(STALKER.lingerTime); this.clickT = 0.6; this.sounds.exhale(this.x, this.z); }
    this.state = state;
    this.repathT = 0;
  }

  /** It has noticed you: freeze, turn, then come. */
  notice(x, z, T) {
    this.lastKnown.x = x; this.lastKnown.z = z; this.sinceFix = 0;
    if (!this.hunting && this.state !== 'alert') this.enter('alert', T);
  }

  /** Report noises made this frame: [{x, z, loud, exact}]. */
  hear(noises, T) {
    if (!this.active || this.state === 'finale') return;
    for (const n of noises) {
      const loud = n.loud * this.diff.hearing, d = this.nav.distAt(this.field, n.x, n.z, 2.5);
      if (!(d <= loud)) continue;
      this.heardYou = true;
      if (this.state === 'hunt' || this.state === 'alert') {
        if (n.exact || d < loud * 0.6) { this.lastKnown.x = n.x; this.lastKnown.z = n.z; this.sinceFix = 0; }
      } else if (n.exact || d < loud * 0.35 || this.state === 'linger') {
        this.notice(n.x, n.z, T);
      } else {
        const j = d * 0.12;
        this.target = {x: n.x + (this.rand() * 2 - 1) * j, z: n.z + (this.rand() * 2 - 1) * j};
        this.enter('investigate', T);
      }
    }
  }

  /** Advance one frame. Returns true when it has caught the player. */
  update(dt, T, player) {
    if (!this.active) return false;
    const nav = this.nav, A = this.actor;

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
    if (this.light > this.diff.lightNotice && this.playerDist < 16 && this.state !== 'finale') this.notice(player.x, player.z, T);

    // touch: anyone close who isn't hidden is found at once
    if (!player.hidden && (this.playerDist < STALKER.senseDist || this.euclid < 1.4) && this.state !== 'finale') {
      this.lastKnown.x = player.x; this.lastKnown.z = player.z; this.sinceFix = 0;
      if (this.state !== 'hunt') this.enter('hunt', T);
    }

    // passing someone hidden: it stops right there and listens
    const calm = this.state === 'patrol' || this.state === 'investigate' || this.state === 'listen' || this.state === 'wait';
    if (player.hidden && calm && this.euclid < STALKER.lingerDist && T > this.lingerAfter) {
      this.lingerAfter = T + 15;
      this.enter('linger', T);
    }

    const reach = A.crawl > 0.5 ? STALKER.catchCrawl : STALKER.catchDist;
    if (this.euclid < reach && (!player.hidden || this.state === 'finale')) return true;

    let speed = 0, listening = false, breath = 1;
    const facePlayer = () => {
      const want = Math.atan2(player.x - this.x, -(player.z - this.z));
      this.face += clamp(angleDiff(this.face, want), -5 * dt, 5 * dt);
    };
    switch (this.state) {
      case 'patrol': {
        if (!this.target) this.target = this.nextPatrol();
        speed = STALKER.patrol;
        if (this.arrived()) { this.target = null; this.enter(this.rand() < STALKER.waitChance ? 'wait' : 'listen', T); }
        if ((this.clickT -= dt) <= 0) { this.clickT = 6 + this.rand() * 6; this.sounds.clicks(this.x, this.z, this.muffle()); }
        break;
      }
      case 'listen': {
        listening = true;
        this.face += Math.sin(T * 0.9) * dt * 0.8;
        if ((this.clickT -= dt) <= 0) { this.clickT = 1.1 + this.rand() * 0.8; this.sounds.clicks(this.x, this.z, this.muffle()); }
        if ((this.timer -= dt) <= 0) this.enter('patrol', T);
        break;
      }
      case 'wait': { // standing in the dark, silent, not even breathing much
        breath = 0.1;
        if ((this.timer -= dt) <= 0) this.enter('patrol', T);
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
        this.target = this.lastKnown;
        speed = STALKER.hunt;
        if (this.sinceFix > STALKER.loseAfter || (this.arrived() && this.sinceFix > 0.8)) {
          this.target = {x: this.lastKnown.x, z: this.lastKnown.z};
          this.enter('investigate', T);
        }
        break;
      }
      case 'linger': { // right beside you, listening hard
        listening = true; breath = 1.4;
        facePlayer();
        if ((this.clickT -= dt) <= 0) { this.clickT = 0.8 + this.rand() * 0.6; this.sounds.clicks(this.x, this.z, 0, true); }
        if (!player.hidden) { this.notice(player.x, player.z, T); this.enter('hunt', T); }
        else if ((this.timer -= dt) <= 0) { this.target = this.nextPatrol(); this.enter('patrol', T); }
        break;
      }
      case 'finale': {
        if (this.repathed || !this.target) this.target = {x: player.x, z: player.z};
        speed = STALKER.finale;
        break;
      }
    }

    // it repeats sounds it has learned from you, and groans to itself while it wanders
    if (this.heardYou && !this.hunting && this.state !== 'wait' && this.state !== 'linger' && this.playerDist < 30) {
      if ((this.mimicT -= dt) <= 0) {
        this.mimicT = this.span(STALKER.mimicEvery);
        this.sounds.mimic(MIMICS[Math.floor(this.rand() * MIMICS.length)], this.x, this.z, this.muffle());
      }
    }
    if ((this.state === 'patrol' || this.state === 'investigate') && (this.groanT -= dt) <= 0) {
      this.groanT = this.span(STALKER.groanEvery);
      this.sounds.groan(this.x, this.z, this.muffle());
    }

    speed *= this.diff.speed;
    if (this.hunting && this.euclid < STALKER.lungeDist && nav.lineClear(this.x, this.z, player.x, player.z)) speed *= STALKER.lunge;
    this.speed = speed;
    if (speed > 0 && this.target) this.walk(dt, speed);

    const low = this.world.heightAt(this.x, this.z) < STALKER.crawlBelow;
    animateCreature(A, dt, speed, this.hunting || low ? 1 : 0, listening);
    A.place(this.x, this.z, this.face);

    // the sound of it
    const muffle = this.muffle();
    if (speed > 0) {
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

  arrived() { return !this.target || Math.hypot(this.target.x - this.x, this.target.z - this.z) < 0.7; }

  nextPatrol() {
    const pts = this.cfg.patrol;
    let i = Math.floor(this.rand() * pts.length);
    if (i === this.patrolAt && pts.length > 1) i = (i + 1) % pts.length;
    this.patrolAt = i;
    return {x: pts[i][0], z: pts[i][1]};
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
    if (nav.walkableAt(nx, nz)) { this.x = nx; this.z = nz; }
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
    return clamp(base * (this.hunting || this.state === 'alert' ? 1.25 : 0.8), 0, 1);
  }
}
