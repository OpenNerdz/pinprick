// Scripted moments. A level lists triggers: a circle on the floor, optional conditions, and actions.
//   {x, z, r, cores: 1, delay: 0.5, once: true, actions: [['say', 'text'], ['behind'], ...]}
// Actions:
//   say text [ms]          message on screen
//   behind [dist]          a figure stands behind you until your scanner finds it, then it is gone
//   slam id / open id      close or open a door
//   statue x z [face] [lift]  the statue moves the next time nobody is looking at it
//   silence seconds        the ambience drops out
//   steps x0 z0 x1 z1 [n]  footsteps walk past on the other side of a wall
//   whisper x z            something whispers from there
//   clicks x z             its clicking, from there
//   noise x z loud         a sound the creature will come to investigate
//   wake                   the creature starts moving

import {NOISE} from '../config.js';
import {makeFigure} from './figures.js';
import {buzz} from '../ui/haptics.js';

export class Scares {
  constructor(session) {
    this.s = session;
    this.pending = [];      // [{at, action}]
    this.figure = makeFigure();
    session.world.actors.push(this.figure);
    this.figureT = 0; this.figureSeen = -1;
    this.statueMove = null;
  }

  update(dt, T) {
    const s = this.s, p = s.player;
    for (const t of s.L.triggers) {
      if (t.fired && t.once !== false) continue;
      if (t.cores != null && s.coresGot < t.cores) continue;
      if (Math.hypot(p.x - t.x, p.z - t.z) > (t.r ?? 1.5)) continue;
      if (t.fired && T - t.firedAt < (t.every ?? 20)) continue;
      t.fired = true; t.firedAt = T;
      for (const a of t.actions) this.pending.push({at: T + (t.delay ?? 0) + (a.at ?? 0), a});
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      if (this.pending[i].at > T) continue;
      const {a} = this.pending[i];
      this.pending.splice(i, 1);
      this.run(a, T);
    }

    // the figure behind you: once the scanner lands on it, it lingers a moment and is gone
    const f = this.figure;
    if (f.on) {
      if (f.hits > 0 && this.figureSeen < 0) { this.figureSeen = T; s.sounds.sting(); buzz([20, 30, 60]); }
      if ((this.figureSeen >= 0 && T - this.figureSeen > 1.1) || T - this.figureT > 9) f.on = false;
    }

    // the statue only moves while no ray has touched it for a while
    const st = s.statue, m = this.statueMove;
    if (st && m && T - st.lastHit > 1.5 && Math.hypot(p.x - m.x, p.z - m.z) > 3) {
      st.place(m.x, m.z, m.face ?? st.face, m.lift ?? 0);
      this.statueMove = null;
    }
  }

  run(a, T) {
    const s = this.s, p = s.player, [kind, ...args] = a;
    switch (kind) {
      case 'say': s.ui.say(args[0], args[1]); break;
      case 'behind': this.behind(args[0] ?? 2.4, T); break;
      case 'slam': s.setDoor(args[0], false, true); break;
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
      case 'step': s.sounds.creatureStep(args[0], args[1], 0.7, 1.2); break;
      case 'whisper': s.sounds.whisper(args[0], args[1]); break;
      case 'clicks': s.sounds.clicks(args[0], args[1], 0.4); break;
      case 'noise': s.noise(args[0], args[1], args[2] ?? NOISE.slam, true); break;
      case 'wake': if (s.stalker && !s.stalker.active) s.stalker.wake(p); break;
      default: console.warn('unknown scare action', kind);
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
      return;
    }
  }
}
