// One play of one level: owns the compiled world, the player, the scanner, the creature and the
// scripted scares, and advances them together each frame. The UI talks to it through `ui` hooks
// and reads its public fields for the HUD.

import {CELL, DIFFICULTY, DOTS, NOISE, PLAYER_R, SCANNER, STALKER, TRACKER} from '../config.js';
import {rng, angleDiff, clamp} from '../util/math.js';
import {compileLevel, CORE_PICKUP, EXIT_RADIUS, NOTE_PICKUP} from '../world/level.js';
import {NavGrid} from '../world/nav.js';
import {levelMesh} from '../render/renderer.js';
import {Player} from './player.js';
import {Scanner} from './scanner.js';
import {Stalker} from './stalker.js';
import {Scares} from './scares.js';
import {Signal} from './signal.js';
import {Tracker} from './tracker.js';
import {Hands} from './hands.js';
import {ViewModel} from './viewmodel.js';
import {makeStatue, headOf} from './figures.js';
import {buildDecals} from './decals.js';
import {bakeGhosts} from './ghosts.js';
import {buzz} from '../ui/haptics.js';

const STILL = {moveX: 0, moveY: 0, lookX: 0, lookY: 0, sprint: false, firing: false, sweep: false, crouch: false};

export class Session {
  /**
   * opts: {difficulty, seed, renderer, sounds, ui, reduceMotion, demo}
   * ui hooks: say(text, ms), note(note), caught(), won(stats), cores(got, total)
   */
  constructor(def, opts) {
    this.def = def;
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.renderer = opts.renderer; this.sounds = opts.sounds; this.ui = opts.ui;
    this.reduceMotion = !!opts.reduceMotion;
    this.demo = !!opts.demo;
    this.seed = opts.seed ?? (Math.random() * 1e9) >>> 0;
    this.rand = rng(this.seed);

    const spots = def.batteries?.spots?.length || 0;
    this.L = compileLevel(def, this.seed, {batteries: spots && Math.max(1, Math.floor(spots * this.diff.trkCells))});
    this.world = this.L.world;
    this.cores = this.L.cores; this.exit = this.L.exit; this.notes = this.L.notes; this.batteries = this.L.batteries;
    this.nav = new NavGrid(this.world, {radius: 0.35, minH: 2.15});
    this.playerNav = new NavGrid(this.world, {radius: PLAYER_R, minH: 1.2});

    this.player = new Player(this.L.start);
    this.scanner = new Scanner();
    this.hands = new Hands();
    // the motion tracker: already yours, unless this level has it lying somewhere to find
    this.tracker = this.demo ? null : new Tracker(this.diff, this.seed, !this.L.tracker, this.L.tracker ? 0 : this.diff.trkStart);
    this.viewmodel = new ViewModel();
    this.lefty = !!opts.lefty;
    this.signal = new Signal();
    this.statue = null;
    if (this.L.statue) {
      const s = this.L.statue;
      this.statue = makeStatue();
      this.world.actors.push(this.statue);
      this.statue.place(s.x, s.z, s.face ?? 0, s.lift ?? 0);
    }
    this.stalker = this.L.stalker && !this.demo
      ? new Stalker(this.L.stalker, this.world, this.nav, this.diff, this.rand, this.sounds, this.playerNav) : null;
    this.scares = new Scares(this);
    this.decals = buildDecals(this.world.decals);

    this.time = 0; this.deaths = 0; this.state = 'play';
    this.caughtT = 0;
    this.fearBoost = 0; this.seenAt = -99; this.fearNow = 0; this.wasLinger = false;
    this.fx = {black: 0, ping: 0}; // read by the HUD: the blackout after it catches you, the red of its sonar on you
    this.hinted = new Set();
    this.noises = [];
    this.noiseFn = (x, z, loud, exact, kind) => this.noise(x, z, loud, exact, kind);
    this.coresGot = 0;
    this.meshVersion = -1;
    this.fullSaid = -99;
    this.markCheckpoint(this.L.start.x, this.L.start.z, this.L.start.yaw);

    const r = this.renderer;
    if (r) {
      this.dots = r.setDots(DOTS.capacity);
      r.setGhosts(bakeGhosts(this.world, this.L.ghosts, this.seed));
      this.syncMesh();
    }
    if (this.stalker) this.stalker.dots = this.dots || null;
    if (this.stalker && this.L.stalker.wake === 'start') this.stalker.wake();
  }

  get coresLeft() { return this.cores.length - this.coresGot; }

  /** Where you come back after being caught, and what the tracker had then (charge, batteries taken). */
  markCheckpoint(x, z, yaw) {
    const tr = this.tracker;
    this.checkpoint = {x, z, yaw, battery: tr ? tr.battery : 0, owned: tr ? tr.owned : false,
      taken: this.batteries.map(b => b.taken), trackerTaken: !!this.L.tracker?.taken};
  }

  /** Put the tracker, its charge and the batteries back as a checkpoint or snapshot had them. */
  restoreTracker(c) {
    const tr = this.tracker;
    if (!tr || c.battery == null) return;
    tr.owned = !!c.owned; tr.reset(c.battery);
    this.batteries.forEach((b, i) => { b.taken = !!c.taken?.[i]; b.prop.on = !b.taken; });
    const lt = this.L.tracker;
    if (lt) { lt.taken = !!c.trackerTaken; for (const q of lt.parts) q.on = !lt.taken; }
    this.world.touch();
  }

  /** A sound the creature may hear. `kind` is 'step' for footsteps (it can follow those), else anything. */
  noise(x, z, loud, exact, kind = 'other') { this.noises.push({x, z, loud, exact, kind}); }

  syncMesh() {
    if (this.meshVersion === this.world.version) return;
    this.meshVersion = this.world.version;
    this.renderer?.setLevelMesh(levelMesh(this.world, CELL));
  }

  /** Open or close a door by id. Slams are loud. */
  setDoor(id, open, loud) {
    const d = id === 'exit' ? {prop: this.L.exitDoor, open: !this.L.exitDoor?.on} : this.L.doors.get(id);
    if (!d || !d.prop || d.open === open) return;
    const p = d.prop, cx = (p.x0 + p.x1) / 2, cz = (p.z0 + p.z1) / 2;
    if (!open && Math.hypot(this.player.x - cx, this.player.z - cz) < 1.4) return; // never shut on the player
    d.open = open; p.on = !open;
    this.world.touch();
    this.nav.build(); this.playerNav.build();
    if (loud) {
      if (open) this.sounds.doorOpen(); else this.sounds.slam(cx, cz);
      this.noise(cx, cz, NOISE.slam, false);
      buzz(60);
    }
  }

  /** ctx shared with the scanner. */
  scanCtx(cam, view) {
    const c = this._ctx || (this._ctx = {});
    c.world = this.world; c.dots = this.dots; c.renderer = this.renderer; c.cam = cam; c.view = view;
    c.sounds = this.sounds; c.diff = this.diff; c.decals = this.decals;
    c.noise = this.noiseFn;
    c.interference = this.interference || 0;
    c.origin = !this.demo && this.viewmodel.muzzleClear ? this.viewmodel.muzzle : null;
    c.x = this.player.x; c.z = this.player.z;
    return c;
  }

  update(dt, T, intent, cam, view) {
    const p = this.player;
    this.noises.length = 0;

    if (this.state === 'caught') { this.caughtFrame(dt, T, cam, view); return; }
    if (this.state !== 'play') return;

    this.time += dt;
    const msg = p.update(dt, intent, this.world, this.noiseFn, this.sounds, this.reduceMotion);
    if (msg) this.ui.say(msg, 2200);
    cam.set(p.x, p.eye, p.z, p.yaw, p.pitch);
    const hand = this.hands.update(dt, T, intent, this); // which device is up decides what the scanner may do
    this.viewmodel.update(dt, T, this, intent, cam, this.lefty, this.reduceMotion);
    this.sounds.e.listener.x = p.x; this.sounds.e.listener.z = p.z; this.sounds.e.listener.yaw = p.yaw;

    const wasOver = this.scanner.overheated;
    this.scanner.update(dt, T, hand.fire, hand.sweep, this.scanCtx(cam, view));
    if (this.scanner.overheated && !wasOver) this.ui.say('The scanner is too hot. Let go and let it cool.', 3000);

    // hiding: crouched, quiet and inside a hiding spot, with nothing ticking or humming in your hands.
    // Quiet anywhere: not moving and not scanning, which the creature cannot hear, so it will not walk
    // into you (but a hunt still finds you).
    const tr = this.tracker;
    p.quiet = p.still > 0.3 && !this.scanner.active;
    p.hidden = p.crouched && !this.scanner.active && !(tr && tr.on) && this.L.hides.some(h => Math.hypot(p.x - h.x, p.z - h.z) < h.r);

    this.pickups(T);
    this.scares.update(dt, T);
    if (tr) { // before the creature listens, so it hears this frame's tick
      tr.update(dt, T, this, this.hands.trackerUp);
      for (const e of tr.events) this.trackerEvent(e);
      tr.events.length = 0;
    }

    if (this.stalker) {
      const st = this.stalker, w = st.cfg.wake;
      if (!st.active && typeof w === 'string' && w.startsWith('core:') && this.coresGot >= +w.slice(5)) st.wake(p);
      st.hear(this.noises, T);
      if (st.update(dt, T, p)) { this.caught(T, cam, view); return; }
      // first sight of it in a while: a stab of sound and the heart jumps
      if (st.active && st.light > 6 && st.euclid < 18 && T - this.seenAt > 25) {
        this.seenAt = T; this.fearBoost = 1;
        this.sounds.sting(); buzz([20, 30, 60]);
      }
      const linger = st.state === 'linger';
      if (linger && !this.wasLinger) this.ui.say("Don't move.", 2600);
      this.wasLinger = linger;
      for (const e of st.events) this.creatureEvent(e);
      st.events.length = 0;
    }
    this.fearBoost = Math.max(0, this.fearBoost - dt * 0.2);
    this.fx.ping = Math.max(0, this.fx.ping - dt * 1.6);
    this.fearNow = Math.max(this.stalker ? this.stalker.fear() : 0, this.fearBoost * 0.8);
    this.interference = clamp((this.fearNow - 0.4) / 0.6, 0, 1);
    this.signal.update(dt, this);
    this.sounds.heart(dt, this.fearNow);
    this.sounds.setDread(this.stalker && this.stalker.active ? this.fearNow : 0);
    this.sounds.updateAmbient(dt, this.fearNow);
    this.syncMesh();
    this.syncActors();

    if (this.coresLeft === 0 && Math.hypot(p.x - this.exit.x, p.z - this.exit.z) < EXIT_RADIUS) this.win();
  }

  syncActors() { this.renderer?.setActors(this.world.actors); }

  /** Something the creature did that the player should feel, plus a one-time hint the first time. */
  creatureEvent(e) {
    if (e === 'windup') buzz([6, 50, 6, 50, 6]);
    else if (e === 'sonar') {
      this.fx.ping = 1; this.fearBoost = Math.max(this.fearBoost, 0.6);
      this.hint('sonar', 'Red on the walls: it is listening. Do not move until it stops.');
    } else if (e === 'found') this.sounds.sting();
    else if (e === 'pinned') this.hint('pinned', 'The light stops it. Hold it there.');
    else if (e === 'echo') this.hint('echo', 'Your footsteps sound doubled.');
    else if (e === 'flee') this.hint('flee', 'It ran from the light. It will be back.');
    else if (e === 'ping') this.hint('ping', 'It heard the tracker. Up close, it can.');
  }

  /** The tracker's own news. Battery news is said on every difficulty; it is not a hint, you need it. */
  trackerEvent(e) {
    if (e === 'contact') this.hint('contact', 'The tracker only shows what moves. When a dot stops, it has not gone.');
    else if (e === 'low') this.ui.say('Tracker battery low.', 2400);
    else if (e === 'dead') this.ui.say('The tracker is dead. Find a battery: lime-green dots.', 3600);
    else if (e === 'close') this.fearBoost = Math.max(this.fearBoost, 0.5);
  }

  hint(key, text) {
    if (!this.diff.hints || this.hinted.has(key) || this.demo) return;
    this.hinted.add(key);
    this.ui.say(text, 3800);
  }

  /** The gun to draw this frame, or null when it should not be on screen. */
  gunState(T) {
    if (this.demo || this.state === 'won' || this.hands.gun < 0.01) return null;
    return this.viewmodel.drawState(this.scanner, SCANNER.sweepCooldown, T);
  }

  /** The tracker to draw this frame, or null when it is not in your hand. */
  trackerState(T) {
    const tr = this.tracker, h = this.hands;
    if (!tr || !tr.owned || this.state === 'won' || (h.trk < 0.01 && h.peek < 0.01)) return null;
    return this.viewmodel.trackerDraw(tr, h, T, this.player);
  }

  pickups(T) {
    const p = this.player;
    for (const c of this.cores) {
      if (c.got || Math.hypot(p.x - c.x, p.z - c.z) >= CORE_PICKUP) continue;
      c.got = true; c.orb.on = false; this.coresGot++;
      this.world.touch();
      this.sounds.core(); buzz(30);
      this.noise(c.x, c.z, NOISE.core, false);
      this.markCheckpoint(p.x, p.z, p.yaw);
      this.ui.cores(this.coresGot, this.cores.length);
      if (this.coresLeft === 0) this.allCores(T);
      else this.ui.say(`Core ${this.coresGot} of ${this.cores.length} recovered.`, 3500);
    }
    for (const n of this.notes) {
      if (n.read || Math.hypot(p.x - n.x, p.z - n.z) >= NOTE_PICKUP) continue;
      n.read = true;
      this.sounds.note();
      this.ui.note(n);
    }
    const tr = this.tracker, lt = this.L.tracker;
    if (!tr) return;
    if (lt && !lt.taken && Math.hypot(p.x - lt.x, p.z - lt.z) < TRACKER.pickupR + 0.4) {
      lt.taken = true; for (const q of lt.parts) q.on = false;
      this.world.touch();
      tr.owned = true; tr.battery = lt.battery ?? this.diff.trkStart;
      this.sounds.battery(); buzz(30);
      this.ui.say({touch: 'A motion tracker. Tap TRACK to raise it: it shows what moves, not what stands still. Lime-green dots are its batteries.',
        mouse: 'A motion tracker. Press Q to raise it: it shows what moves, not what stands still. Lime-green dots are its batteries.'}, 7000);
    }
    for (const b of this.batteries) {
      if (b.taken || !tr.owned || Math.hypot(p.x - b.x, p.z - b.z) >= TRACKER.pickupR) continue;
      if (tr.battery >= TRACKER.full) { // leave it for later
        if (T - this.fullSaid > 8) { this.fullSaid = T; this.ui.say('The tracker is full. Leave the battery for later.', 2400); }
        continue;
      }
      b.taken = true; b.prop.on = false;
      this.world.touch();
      tr.battery = Math.min(1, tr.battery + this.diff.trkRefill);
      this.sounds.battery(); buzz(25);
      this.ui.say(`Battery. Tracker at ${Math.round(tr.battery * 100)}%.`, 2400);
    }
  }

  allCores() {
    if (this.L.exitDoor) this.setDoor('exit', true, true);
    else this.sounds.doorOpen();
    let msg = this.def.exitMessage || 'All cores in. The amber door has opened.';
    if (this.stalker && this.def.finale !== false) {
      const st = this.stalker;
      // unless it is already on you, the chase starts far from you and the exit, with a shriek
      if (!st.active || !(st.state === 'hunt' || st.state === 'alert') || st.playerDist > 12) st.wake(this.player, 'finale', this.exit);
      st.enter('finale', this.time);
      msg += ' ' + (this.def.finaleMessage || 'It knows where you are now. Get to the door.');
    }
    this.ui.say(msg, 8000);
  }

  caught(T, cam, view) {
    this.state = 'caught'; this.caughtT = 0; this.caughtShown = false; this.blacked = false;
    this.deaths++;
    this.fearBoost = 1; this.fearNow = 1; this.interference = 0;
    if (this.tracker) { this.tracker.on = false; this.tracker.flood = 1; }
    this.sounds.caught(); this.sounds.updateHum(false, 0, 0); this.sounds.setBreath(0, 0, 0); this.sounds.setDread(1);
    buzz([80, 40, 260, 60, 120]);
  }

  /**
   * The catch, about two seconds: your view is wrenched round to its face, it rears up over you and the
   * scanner floods it red, then everything goes black and your ears ring. Then the Caught screen.
   */
  caughtFrame(dt, T, cam, view) {
    const p = this.player, st = this.stalker;
    this.caughtT += dt;
    const t = this.caughtT;
    if (st) {
      st.strike(dt, p);
      const [hx, hy, hz] = headOf(st.actor);
      const wantYaw = Math.atan2(hx - p.x, -(hz - p.z)), wantPitch = Math.atan2(hy - p.eye, Math.hypot(hx - p.x, hz - p.z));
      const k = Math.min(1, dt * 14);
      p.yaw += angleDiff(p.yaw, wantYaw) * k;
      p.pitch += (clamp(wantPitch, -1.2, 1.2) - p.pitch) * k;
    }
    const shake = t < 1.05 && !this.reduceMotion ? 0.07 * (1 - t / 1.05) : 0;
    cam.set(p.x, p.eye, p.z, p.yaw + (Math.random() - 0.5) * shake, p.pitch + (Math.random() - 0.5) * shake);
    this.viewmodel.update(dt, T, this, STILL, cam, this.lefty, this.reduceMotion);
    if (t < 1.05) this.scanner.burst(T, this.scanCtx(cam, view), 320);
    else if (!this.blacked) {
      this.blacked = true;
      this.dots?.clear();
      this.sounds.setDread(0); this.sounds.aftermath();
    }
    this.fx.black = t < 1.05 ? 0 : 1;
    if (t > 2.0 && !this.caughtShown) { this.caughtShown = true; this.ui.caught(); }
    this.syncActors();
  }

  /** Back to the last core you picked up, with the creature sent somewhere far away. */
  respawn() {
    const p = this.player, c = this.checkpoint;
    p.x = c.x; p.z = c.z; p.yaw = c.yaw; p.pitch = 0; p.crouched = false; p.stamina = 1; p.winded = false;
    this.scanner.heat = 0; this.scanner.overheated = false; this.scanner.charge = 0;
    this.hands.reset(); this.restoreTracker(c);
    this.fx.black = 0; this.fearBoost = 0; this.sounds.setDread(0);
    if (this.stalker) {
      const st = this.stalker, finale = st.state === 'finale';
      st.wake(p, finale ? 'finale' : 'patrol', finale ? this.exit : null);
      if (finale) st.enter('finale', this.time);
      else { st.graceFor = STALKER.respawnGrace; st.avoid = {x: c.x, z: c.z}; }
    }
    this.state = 'play';
  }

  win() {
    this.state = 'won';
    this.sounds.updateHum(false, 0, 0); this.sounds.setBreath(0, 0, 0); this.sounds.setDread(0);
    this.sounds.win();
    this.ui.won({time: this.time, dots: this.dots ? this.dots.total : 0, deaths: this.deaths, notes: this.notes.filter(n => n.read).length, notesTotal: this.notes.length});
  }

  /** Title-screen demo: the scanner sweeps a fixed spot on its own. */
  attract(dt, T, cam, view, pose) {
    const t = this.reduceMotion ? 0 : T;
    cam.set(pose.x, pose.y ?? 1.6, pose.z, (pose.yaw ?? 0) + Math.sin(t * 0.35) * 0.55, (pose.pitch ?? 0.13) + Math.sin(t * 0.23) * 0.1);
    this.scanner.spray(dt, T, this.scanCtx(cam, view), 0.7, false, 34);
    this.syncActors();
  }

  snapshot() {
    const p = this.player, tr = this.tracker;
    return {x: p.x, z: p.z, yaw: p.yaw, pitch: p.pitch, time: this.time, deaths: this.deaths,
      got: this.cores.map(c => c.got), seed: this.seed, checkpoint: this.checkpoint,
      tracker: tr ? {battery: tr.battery, owned: tr.owned, taken: this.batteries.map(b => b.taken), trackerTaken: !!this.L.tracker?.taken} : null};
  }

  restore(d) {
    if (!d) return;
    const p = this.player;
    if (isFinite(d.x) && isFinite(d.z)) { p.x = d.x; p.z = d.z; p.yaw = d.yaw || 0; p.pitch = d.pitch || 0; }
    this.time = d.time || 0; this.deaths = d.deaths || 0;
    if (d.checkpoint) this.checkpoint = d.checkpoint;
    (d.got || []).forEach((g, i) => {
      const c = this.cores[i];
      if (g && c && !c.got) { c.got = true; c.orb.on = false; this.coresGot++; }
    });
    if (d.tracker) this.restoreTracker(d.tracker);
    this.world.touch();
    if (this.coresLeft === 0 && this.cores.length) this.allCores();
  }
}
