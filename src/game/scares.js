// Scripted moments. A level lists triggers: a circle on the floor, optional conditions, and actions.
//   {x, z, r, cores: 1, delay: 0.5, once: true, actions: [['say', 'text'], ['behind'], ...]}
// Conditions, besides being inside the circle:
//   cores: n               at least this many cores taken
//   tracker: true          only while the tracker is up (for what only the tracker can show)
//   look: [x, z]           only while you are facing that spot (in the dark, a thing you are not facing never happened)
//   shut: id               only once that door is shut
// Actions:
//   say text [ms]          message on screen
//   behind [dist]          a figure stands behind you until your scanner finds it, then it is gone
//   slam id [text] [ms]    a door slams, and then the text shows; it never shuts on you, so it waits until you are clear
//   open id                open a door
//   statue x z [face] [lift]  the statue moves the next time nobody is looking at it
//   silence seconds        the ambience drops out
//   steps x0 z0 x1 z1 [n]  footsteps walk past on the other side of a wall (the tracker sees them too)
//   whisper x z            something whispers from there
//   clicks x z             its clicking, from there
//   noise x z loud         a sound the creature will come to investigate
//   wake                   the creature starts moving
//   handprints x0 z0 x1 z1 face [n]  red three-fingered prints come up one by one where nobody scanned, on the
//                          surface that way from each point on the line (face as for wall writing, or 'floor')
//   crossing x0 z0 x1 z1 [secs]      it goes across without a sound: the tracker shows it, or your beam, if it is on it
//   phantom x0 z0 x1 z1 [secs]       fresh rust-coloured dots: a scanner that is not yours, walking along the line
//   hush [secs]            a false all clear: the level (and its pump) goes quiet, then something breathes out behind your head

import {NOISE} from '../config.js';
import {cast, hit} from '../world/raycast.js';
import {angleDiff} from '../util/math.js';
import {animateCreature, makeFigure} from './figures.js';
import {buzz} from '../ui/haptics.js';

const FACES = {n: [0, 0, -1], s: [0, 0, 1], e: [1, 0, 0], w: [-1, 0, 0], floor: [0, 1, 0]};
const LOOK_WITHIN = 0.6; // radians either side of straight ahead that count as facing something
const SLAM_RETRY = 0.25; // seconds between tries at a door you are standing in
const PRINT_REACH = 1.8; // a print lands on a surface at most this far from its point on the line
const PRINT_RED = [0.95, 0.13, 0.09], RUST = [0.62, 0.26, 0.14];
const PHANTOM_RATE = 1500; // its dots a second: about what a real scanner lays down

/** Where a hand's dots go, in hand space (u across, v along the fingers), metres. A palm and three long fingers. */
function handShape() {
  const out = [];
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 0.085;
    out.push([Math.cos(a) * r, Math.sin(a) * r * 1.15]);
  }
  for (const splay of [-0.5, 0.05, 0.6]) {
    const dx = Math.sin(splay), dy = Math.cos(splay);
    for (let i = 0; i < 26; i++) {
      const t = 0.07 + Math.random() * 0.3, w = (Math.random() - 0.5) * 0.024;
      out.push([dx * t - dy * w, dy * t + dx * w]);
    }
  }
  return out;
}

export class Scares {
  constructor(session) {
    this.s = session;
    this.pending = [];      // [{at, action}]
    this.figure = makeFigure();
    session.world.actors.push(this.figure);
    this.figureT = 0; this.figureSeen = -1;
    this.statueMove = null;
    this.cross = null;      // the figure going across a doorway
    this.phantoms = [];     // scanners that are not yours
  }

  update(dt, T) {
    const s = this.s, p = s.player;
    for (const t of s.L.triggers) {
      if (t.fired && t.once !== false) continue;
      if (t.cores != null && s.coresGot < t.cores) continue;
      if (Math.hypot(p.x - t.x, p.z - t.z) > (t.r ?? 1.5)) continue;
      if (t.fired && T - t.firedAt < (t.every ?? 20)) continue;
      if (t.tracker && !s.tracker?.on) continue;
      if (t.shut && s.L.doors.get(t.shut)?.open !== false) continue;
      if (t.look && Math.abs(angleDiff(p.yaw, Math.atan2(t.look[0] - p.x, -(t.look[1] - p.z)))) > LOOK_WITHIN) continue;
      t.fired = true; t.firedAt = T;
      for (const a of t.actions) this.pending.push({at: T + (t.delay ?? 0), a, src: t});
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].at > T) continue;
      const {a, src} = this.pending[i];
      this.pending.splice(i, 1);
      this.src = src;
      this.run(a, T);
      this.src = null;
    }

    const f = this.figure;
    if (this.cross) this.updateCrossing(dt, T);
    if (this.phantoms.length) this.updatePhantoms(dt, T);

    // the figure behind you: once the scanner lands on it, it lingers a moment and is gone
    if (f.on) {
      if (f.hits > 0 && this.figureSeen < 0) { this.figureSeen = T; s.sounds.sting(); buzz([20, 30, 60]); }
      if ((this.figureSeen >= 0 && T - this.figureSeen > 1.1) || T - this.figureT > 9) {
        f.on = false;
        s.tracker?.motion(f.x, f.z, T, 0.8); // going, it moves
      }
    }

    // the statue only moves while no ray has touched it for a while (the tracker sees it go)
    const st = s.statue, m = this.statueMove;
    if (st && m && T - st.lastHit > 1.5 && Math.hypot(p.x - m.x, p.z - m.z) > 3) {
      st.place(m.x, m.z, m.face ?? st.face, m.lift ?? 0);
      this.statueMove = null;
      s.tracker?.motion(m.x, m.z, T, 0.8);
    }
  }

  run(a, T) {
    const s = this.s, p = s.player, [kind, ...args] = a;
    switch (kind) {
      case 'say': s.ui.say(args[0], args[1]); break;
      case 'behind': this.behind(args[0] ?? 2.4, T); break;
      case 'slam': this.slam(a, T); break;
      case 'open': s.setDoor(args[0], true, true); break;
      case 'statue': this.statueMove = {x: args[0], z: args[1], face: args[2], lift: args[3]}; break;
      case 'silence': s.sounds.duck(args[0] ?? 5); break;
      case 'steps': {
        const [x0, z0, x1, z1, n = 8] = args;
        for (let i = 0; i < n; i++) {
          const k = i / (n - 1);
          this.pending.push({at: T + i * 0.62, a: ['step', x0 + (x1 - x0) * k, z0 + (z1 - z0) * k]});
        }
        break;
      }
      case 'step': // the tracker sees whatever is walking there, too
        s.sounds.creatureStep(args[0], args[1], 0.7, 1.2);
        s.tracker?.motion(args[0], args[1], T, 0.7);
        break;
      case 'whisper': s.sounds.whisper(args[0], args[1]); break;
      case 'clicks': s.sounds.clicks(args[0], args[1], 0.4); break;
      case 'noise': s.noise(args[0], args[1], args[2] ?? NOISE.slam, true); break;
      case 'wake': if (s.stalker && !s.stalker.active) s.stalker.wake(p); break;
      case 'handprints': {
        const [x0, z0, x1, z1, face = 'floor', n = 5] = args;
        for (let i = 0; i < n; i++) {
          const k = n > 1 ? i / (n - 1) : 0;
          this.pending.push({at: T + i * 0.55, a: ['print', x0 + (x1 - x0) * k, z0 + (z1 - z0) * k, face, i, Math.atan2(x1 - x0, -(z1 - z0))]});
        }
        break;
      }
      case 'print': this.print(args[0], args[1], args[2], args[3], args[4], T); break;
      case 'crossing': {
        const [x0, z0, x1, z1, secs = 1.5] = args;
        const f = this.figure;
        if (f.on) break;
        f.hits = 0; f.on = true; f.crawl = 1; this.figureT = T; this.figureSeen = -1;
        this.cross = {x0, z0, x1, z1, at: T, secs, tick: 0};
        break;
      }
      case 'phantom': {
        const [x0, z0, x1, z1, secs = 3] = args;
        this.phantoms.push({x0, z0, x1, z1, at: T, secs, acc: 0, aim: Math.atan2(x1 - x0, -(z1 - z0))});
        s.sounds.mimic('trigger', x0, z0, 0.3);
        break;
      }
      case 'hush': {
        const secs = args[0] ?? 8;
        s.sounds.duck(secs);
        if (s.pump) { s.pump.on = false; s.pump.t = Math.max(s.pump.t, secs + 2); } // nothing left to hide behind
        this.pending.push({at: T + secs * 0.85, a: ['breath']});
        break;
      }
      case 'breath': {
        const bx = p.x - Math.sin(p.yaw) * 0.9, bz = p.z + Math.cos(p.yaw) * 0.9;
        s.sounds.exhale(bx, bz);
        s.tracker?.motion(bx, bz, T, 0.5);
        buzz([10, 60, 10]);
        break;
      }
      default: console.warn('unknown scare action', kind);
    }
  }

  /** Has this trigger set off something that has not happened yet? */
  waiting(t) { return this.pending.some(q => q.src === t); }

  /** Forget what has not happened yet. The trigger can fire again, or a door about to slam never would. */
  dropPending() {
    for (const q of this.pending) if (q.src) q.src.fired = false;
    this.pending.length = 0;
  }

  /** Tries again every moment until the door has really shut; only then is anything said about it. */
  slam(a, T) {
    const s = this.s, [, id, text, ms] = a, d = s.L.doors.get(id);
    if (!d?.open) return;
    s.setDoor(id, false, true);
    if (d.open) this.pending.push({at: T + SLAM_RETRY, a, src: this.src});
    else if (text) s.ui.say(text, ms);
  }

  /**
   * One print where nobody scanned. It is only dots, so it fades like yours do. Wall prints climb a little
   * and alternate like hands going along it; on the floor they point the way it went.
   */
  print(x, z, face, i, heading, T) {
    const s = this.s, n = FACES[face] || FACES.floor, floor = face === 'floor';
    const oy = floor ? 1 : 0.95 + (i % 2) * 0.35;
    if (!cast(s.world, x, oy, z, -n[0], -n[1], -n[2], PRINT_REACH, false)) return false;
    const t = hit.t, px = x - n[0] * t, py = oy - n[1] * t, pz = z - n[2] * t;
    // hand space on that surface: fingers up a wall, or along the way it was going on a floor
    const tilt = (i % 2 ? 0.28 : -0.28) + (Math.random() - 0.5) * 0.2;
    const fa = floor ? heading + tilt : tilt, sa = Math.sin(fa), ca = Math.cos(fa);
    for (const [u, v] of handShape()) {
      let wx, wy, wz;
      if (floor) { wx = px + ca * u + sa * v; wy = py + 0.015; wz = pz + sa * u - ca * v; }
      else { const side = ca * u + sa * v; wx = px - n[2] * side + n[0] * 0.02; wy = py + ca * v - sa * u; wz = pz + n[0] * side + n[2] * 0.02; }
      const k = 0.7 + Math.random() * 0.3;
      s.dots?.push(wx, wy, wz, T, PRINT_RED[0] * k, PRINT_RED[1] * k, PRINT_RED[2] * k, 0.015 + Math.random() * 0.008);
    }
    s.sounds.creatureStep(px, pz, 0.5, 0.3);
    s.tracker?.motion(px, pz, T, 0.5);
    return true;
  }

  /** The figure goes across, silent, on all fours. Nothing to hear; a tracker or a beam are all that can tell. */
  updateCrossing(dt, T) {
    const s = this.s, f = this.figure, c = this.cross, k = (T - c.at) / c.secs;
    if (k >= 1 || !f.on) { // gone: stand it back up for the next time it is needed
      f.on = false; f.crawl = 0; f.amp = 0;
      animateCreature(f, 0, {});
      this.cross = null;
      return;
    }
    const len = Math.hypot(c.x1 - c.x0, c.z1 - c.z0), x = c.x0 + (c.x1 - c.x0) * k, z = c.z0 + (c.z1 - c.z0) * k;
    animateCreature(f, dt, {speed: len / c.secs, crawl: 1});
    f.place(x, z, Math.atan2(c.x1 - c.x0, -(c.z1 - c.z0)));
    if (T >= c.tick) { c.tick = T + 0.2; s.tracker?.motion(x, z, T, 0.3); }
  }

  /** Someone else's scanner: a cone of rust-coloured dots swinging about as whoever holds it walks. */
  updatePhantoms(dt, T) {
    const s = this.s, w = s.world;
    for (let i = this.phantoms.length - 1; i >= 0; i--) {
      const ph = this.phantoms[i], k = (T - ph.at) / ph.secs;
      if (k >= 1) { this.phantoms.splice(i, 1); continue; }
      const x = ph.x0 + (ph.x1 - ph.x0) * k, z = ph.z0 + (ph.z1 - ph.z0) * k;
      if ((ph.step = (ph.step ?? 0) - dt) <= 0) { ph.step = 0.7; s.tracker?.motion(x, z, T, 0.4); }
      ph.acc += PHANTOM_RATE * dt;
      const swing = ph.aim + Math.sin(T * 1.7) * 0.8, n = Math.floor(ph.acc);
      ph.acc -= n;
      for (let j = 0; j < n; j++) {
        const a = swing + (Math.random() - 0.5) * 0.9, pitch = (Math.random() - 0.55) * 0.7;
        const dx = Math.sin(a) * Math.cos(pitch), dy = Math.sin(pitch), dz = -Math.cos(a) * Math.cos(pitch);
        if (!cast(w, x, 1.45, z, dx, dy, dz, 22, false)) continue;
        const b = 0.6 + Math.random() * 0.4;
        s.dots?.push(x + dx * hit.t + hit.nx * 0.02, 1.45 + dy * hit.t + hit.ny * 0.02, z + dz * hit.t + hit.nz * 0.02, T,
          RUST[0] * b, RUST[1] * b, RUST[2] * b, 0.024 + Math.random() * 0.012);
      }
    }
  }

  behind(dist, T) {
    const s = this.s, p = s.player, f = this.figure;
    if (f.on) return;
    const bx = -Math.sin(p.yaw), bz = Math.cos(p.yaw);
    for (const d of [dist, dist * 0.8, dist * 0.6]) {
      const x = p.x + bx * d, z = p.z + bz * d;
      if (!s.playerNav.walkableAt(x, z)) continue;
      f.hits = 0; f.on = true; this.figureT = T; this.figureSeen = -1;
      f.place(x, z, p.yaw);
      s.tracker?.motion(x, z, T, 1.2); // stepping in behind you
      return;
    }
  }
}
