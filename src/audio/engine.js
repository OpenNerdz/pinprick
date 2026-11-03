// Web Audio plumbing: buses, the cave's reverb, your devices' small speaker, 3D placement, a voice
// cap, and the primitives every game sound is built from: play (a recorded buffer from the bank),
// tone and noise. There are no audio files; the bank renders its sounds at start-up and the reverb's
// impulse response is generated too.
//
//   sfx ─┐                                                 ┌─ revIn ─> reverb (early reflections,
//   amb ─┼─> world ─> ears ─┬─> master ─> limiter ─> out   │           then a 3 s tail) ─> world
//   dev ─┘  (muffled after  │                              │
//            a scare)       ui (your heart, the dread: inside your head, never muffled)
//   dev is your devices' small speaker: no bass, a honk in the upper mids.
//
// Placed voices sit at world points and ctx.listener follows your head, so they stay put as you turn.

import {clamp} from '../util/math.js';

const MAX_VOICES = 40;
// a placed sound with no distance of its own is this far off, so walking does not swing it about
const FAR = 30;

// Each level's reverb, by what its walls are like: t60 of the low, middle and top of the sound (s), how
// long the response runs (s), where the first reflections start and how far they spread (s), how hard
// they are, how long the diffuse tail takes to build (s), and a flutter between hard parallel walls.
// `wet` evens out the loudness, because the convolver normalises each response by its own power.
const ROOMS = {
  sublevel: {t: [2.6, 1.9, 0.8], len: 3.2, early: [0.007, 0.085], hard: 0.5, build: 0.04, wet: 1}, // bare tunnels
  intake: {t: [1.5, 1.1, 0.45], len: 2.2, early: [0.004, 0.04], hard: 0.55, build: 0.02, wet: 1.2}, // small concrete rooms
  cistern: {t: [3.6, 3.0, 1.3], len: 4, early: [0.016, 0.15], hard: 0.4, build: 0.09, wet: 1}, // a huge flooded tank
  shaft: {t: [3.0, 2.2, 0.7], len: 3.4, early: [0.006, 0.07], hard: 0.45, build: 0.05, wet: 1.3, flutter: {every: 0.041, n: 18, g: 0.4}}, // steel and a long drop
  pumphall: {t: [4.2, 3.2, 1.1], len: 4.4, early: [0.022, 0.2], hard: 0.35, build: 0.12, wet: 1}, // a vast round hall
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
    this.voices = 0;
    this.listener = {x: 0, z: 0, yaw: 0};
    this.told = {x: 0, z: 0, yaw: 0}; // what ctx.listener was last told
    this.roomId = 'sublevel';
    this.roomNow = null;
    this.irs = new Map();
  }

  /** Must run from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return true; } // iOS can also say `interrupted`
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return false;
    try { this.ctx = new A({latencyHint: 'interactive'}); } catch (e) { this.ctx = null; return false; }
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : this.volume;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -20; comp.ratio.value = 6; comp.attack.value = 0.004;
    this.master.connect(comp); comp.connect(c.destination);
    this.world = c.createGain();
    this.ears = c.createBiquadFilter(); this.ears.type = 'lowpass'; this.ears.frequency.value = 20000; this.ears.Q.value = 0.5;
    this.world.connect(this.ears); this.ears.connect(this.master);
    this.sfx = c.createGain(); this.sfx.connect(this.world);
    this.amb = c.createGain(); this.amb.connect(this.world);
    this.ui = c.createGain(); this.ui.connect(this.master);
    // the cave
    this.rev = c.createConvolver();
    this.revIn = c.createGain();
    this.revOut = c.createGain(); this.revOut.gain.value = 0.8;
    this.revIn.connect(this.rev); this.rev.connect(this.revOut); this.revOut.connect(this.world);
    this.roomSoon();
    // `echo` is a little of the room on sounds that ask for it
    this.echo = c.createGain(); this.echo.gain.value = 0.3; this.echo.connect(this.revIn);
    // `slap`: the game's original short repeating echo, which the scanner's purr and sweep keep
    const dl = c.createDelay(1); dl.delayTime.value = 0.23;
    const fb = c.createGain(); fb.gain.value = 0.36;
    const slp = c.createBiquadFilter(); slp.type = 'lowpass'; slp.frequency.value = 1700;
    this.slap = c.createGain(); this.slap.gain.value = 0.32;
    this.slap.connect(dl); dl.connect(slp); slp.connect(fb); fb.connect(dl); slp.connect(this.world);
    // your devices' speaker: tinny, a resonance in the upper mids, breaking up a little when pushed
    this.dev = c.createGain(); this.dev.gain.value = 0.6;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 420; hp.Q.value = 0.8;
    const honk = c.createBiquadFilter(); honk.type = 'peaking'; honk.frequency.value = 2600; honk.Q.value = 1.1; honk.gain.value = 5;
    const ring = c.createBiquadFilter(); ring.type = 'peaking'; ring.frequency.value = 5200; ring.Q.value = 2; ring.gain.value = 2;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000;
    this.curves = new Map();
    const cone = this.shaper(1.4);
    this.dev.connect(hp); hp.connect(honk); honk.connect(ring); ring.connect(lp); lp.connect(cone); cone.connect(this.world);
    const devRoom = c.createGain(); devRoom.gain.value = 0.06; cone.connect(devRoom); devRoom.connect(this.revIn);
    this.hrtf = typeof c.createPanner === 'function';
    // the first HRTF panner sets the browser loading its ear data on another thread: do that now, not on
    // the creature's first sound (made mid-render, it stalled the offline scenes in tools/audition)
    if (this.hrtf) { this.earData = c.createPanner(); this.earData.panningModel = 'HRTF'; }
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return true;
  }

  /**
   * A room's impulse response: a scatter of hard early reflections off the nearest walls, then a diffuse
   * tail building up. Lows ring longest; air and rock soak up the highs first.
   */
  cave(room) {
    const c = this.ctx, sr = c.sampleRate, len = Math.floor(sr * room.len), ir = c.createBuffer(2, len, sr);
    const kl = 1 - Math.exp(-6.283 * 500 / sr), kh = 1 - Math.exp(-6.283 * 3000 / sr);
    const fl = Math.exp(-6.9 / (room.t[0] * sr)), fm = Math.exp(-6.9 / (room.t[1] * sr)), fh = Math.exp(-6.9 / (room.t[2] * sr));
    const b0 = 0.01 * sr, bn = room.build * sr;
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lo = 0, hi = 0, el = 0.56, em = 0.35, eh = 0.175;
      for (let i = 0; i < len; i++) {
        const n = Math.random() * 2 - 1;
        lo += (n - lo) * kl; hi += (n - hi) * kh;
        const build = i < b0 ? 0 : i < b0 + bn ? (i - b0) / bn : 1;
        d[i] = build * (lo * el + (hi - lo) * em + (n - hi) * eh);
        el *= fl; em *= fm; eh *= fh;
      }
      const sign = () => (Math.random() < 0.5 ? -1 : 1);
      for (let k = 0; k < 14; k++) {
        const t = room.early[0] + Math.pow(k / 14, 1.3) * room.early[1] + Math.random() * 0.004;
        d[Math.floor(t * sr)] += sign() * room.hard * (1 - k / 16) * (0.6 + 0.4 * Math.random());
      }
      const flutter = room.flutter;
      if (flutter) for (let k = 1; k <= flutter.n; k++) d[Math.floor((k * flutter.every + Math.random() * 0.001) * sr)] += sign() * flutter.g * (1 - k / (flutter.n + 1));
    }
    return ir;
  }

  /** Which level's walls these are. Unknown levels sound like the tunnels. */
  setRoom(id) {
    this.roomId = ROOMS[id] ? id : 'sublevel';
    if (this.ctx) this.roomSoon();
  }

  /**
   * Change rooms once the tap that started the level is over, when its id is final, so the response is
   * only made once: make it in one task and install it in the next, because each is a stall on a phone.
   */
  roomSoon() {
    clearTimeout(this.roomT);
    this.roomT = setTimeout(() => {
      if (this.roomId === this.roomNow) return;
      this.response(this.roomId);
      this.roomT = setTimeout(() => this.applyRoom(), 0);
    }, 0);
  }

  response(id) {
    let ir = this.irs.get(id);
    if (!ir) { ir = this.cave(ROOMS[id]); this.irs.set(id, ir); }
    return ir;
  }

  /** Change rooms now. */
  applyRoom() {
    const id = this.roomId;
    if (!this.ctx || id === this.roomNow) return;
    this.roomNow = id;
    const room = ROOMS[id], ir = this.response(id);
    // the old tail stops as the buffer changes, so dip the return across it rather than click
    const g = this.revOut.gain, t = this.now;
    g.cancelScheduledValues(t); g.setValueAtTime(0, t); g.setTargetAtTime(0.8 * room.wet, t + 0.03, 0.04);
    this.rev.buffer = ir;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  setVolume(v) { this.volume = v; this.applyGain(); }
  setMuted(m) { this.muted = m; this.applyGain(); }
  applyGain() { if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.now, 0.03); }

  /**
   * Suspend sound while paused or backgrounded. Always asks: `state` lags a request still in flight, so
   * going by it, a quick pause and resume can leave the game silent.
   */
  suspend(on) {
    if (!this.ctx) return;
    const r = on ? this.ctx.suspend() : this.ctx.resume();
    r?.catch?.(() => {});
  }

  /** Muffle everything, as if your ears were ringing, and let it come back over `secs`. */
  deafen(secs) {
    if (!this.ctx) return;
    const f = this.ears.frequency, t = this.now;
    f.cancelScheduledValues(t); f.setValueAtTime(450, t); f.setTargetAtTime(20000, t + 0.3, secs / 3);
  }

  /**
   * Pan (-1..1), straight distance and facing (1 ahead, -1 behind) of a world point from the listener.
   * Per-frame callers pass their own `out` so that nothing is allocated.
   */
  place(x, z, out = {}) {
    const L = this.listener, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz) || 0.001;
    const rx = Math.cos(L.yaw), rz = Math.sin(L.yaw), fx = Math.sin(L.yaw), fz = -Math.cos(L.yaw);
    out.pan = clamp((dx * rx + dz * rz) / d, -1, 1); out.dist = d; out.front = (dx * fx + dz * fz) / d;
    return out;
  }

  /**
   * Tell Web Audio where your head is, so that placed voices stay where they are in the world as you
   * turn and walk. Call every frame; allocates nothing. Firefox and older Safari and WebViews have only
   * the setter methods.
   */
  syncListener() {
    const c = this.ctx, L = this.listener, H = this.told;
    if (!c || (L.x === H.x && L.z === H.z && L.yaw === H.yaw)) return;
    H.x = L.x; H.z = L.z; H.yaw = L.yaw;
    const A = c.listener, fx = Math.sin(L.yaw), fz = -Math.cos(L.yaw);
    if (A.positionX && A.forwardX) { A.positionX.value = L.x; A.positionZ.value = L.z; A.forwardX.value = fx; A.forwardZ.value = fz; }
    else { A.setPosition(L.x, 0, L.z); A.setOrientation(fx, 0, fz, 0, 1, 0); }
  }

  /**
   * Route a voice out. o: {bus, pos ({pan, front, dist} from place(): placed in 3D round your head, so
   * behind sounds behind), pan (simple left/right), occ (Hz: rock in the way, dulling the sound that
   * comes straight at you but not what it sets ringing in the room), echo, slap, rev (reverb send)}.
   */
  out(node, o) {
    let n = node;
    if (o.occ) {
      const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.occ; f.Q.value = 0.6;
      n.connect(f); n = f;
    }
    if (o.pos && this.hrtf) {
      this.syncListener();
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'linear'; p.rolloffFactor = 0;
      // back from head-relative to a point in the world (rolloff 0: its distance only sets how fast it swings as you walk)
      const L = this.listener, d = o.pos.dist || FAR, rx = Math.cos(L.yaw), rz = Math.sin(L.yaw), fx = Math.sin(L.yaw), fz = -Math.cos(L.yaw);
      const x = L.x + d * (o.pos.pan * rx + o.pos.front * fx), y = o.pos.up || 0, z = L.z + d * (o.pos.pan * rz + o.pos.front * fz);
      if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
      n.connect(p); n = p;
    } else if ((o.pan || o.pos) && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = clamp(o.pan ?? o.pos.pan, -1, 1);
      n.connect(p); n = p;
    }
    n.connect(o.bus || this.sfx);
    if (o.echo) n.connect(this.echo);
    if (o.slap) n.connect(this.slap);
    if (o.rev) { const s = this.ctx.createGain(); s.gain.value = o.rev; (o.occ ? node : n).connect(s); s.connect(this.revIn); }
  }

  /** A soft-clipping waveshaper; `drive` 1 is gentle, 8 is torn. Curves are cached per drive. */
  shaper(drive) {
    let curve = this.curves.get(drive);
    if (!curve) {
      curve = new Float32Array(1024);
      for (let i = 0; i < 1024; i++) { const x = i / 511.5 - 1; curve[i] = Math.tanh(x * drive) / Math.tanh(drive); }
      this.curves.set(drive, curve);
    }
    const w = this.ctx.createWaveShaper(); w.curve = curve; w.oversample = '2x';
    return w;
  }

  claim() {
    if (!this.ctx || this.voices >= MAX_VOICES) return false;
    this.voices++;
    return true;
  }

  /**
   * Play a buffer; no buffer yet (still rendering) just plays nothing. o: {gain, rate, at, lp (Hz, a
   * muffling low-pass), plus out()'s options}. Behind you it dulls further, the shadow of your ears:
   * the panner alone leaves front and back only a few dB apart.
   */
  play(buf, o = {}) {
    if (!buf || !this.claim()) return null;
    const c = this.ctx, t = c.currentTime + (o.at || 0);
    const s = c.createBufferSource(); s.buffer = buf;
    if (o.rate) s.playbackRate.value = o.rate;
    let n = s;
    const lp = o.pos && o.pos.front < 0 ? (o.lp || 16000) * (1 + 0.5 * o.pos.front) : o.lp;
    if (lp && lp < 16000) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.max(80, lp); f.Q.value = 0.5;
      n.connect(f); n = f;
    }
    const g = c.createGain(); g.gain.value = o.gain ?? 1;
    n.connect(g);
    this.out(g, o);
    s.onended = () => { this.voices--; };
    s.start(t);
    return s;
  }

  /** Oscillator one-shot. o: {type, at, pan, echo, bus, to (glide target), attack} */
  tone(freq, gain, dur, o = {}) {
    if (!this.claim()) return;
    const c = this.ctx, t = c.currentTime + (o.at || 0);
    const osc = c.createOscillator(); osc.type = o.type || 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + (o.attack || 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    this.out(g, {echo: true, ...o});
    osc.onended = () => { this.voices--; };
    osc.start(t); osc.stop(t + dur + 0.05);
  }

  /** Filtered noise one-shot. o: {filter, freq, to, q, at, pan, echo, bus, attack} */
  noise(gain, dur, o = {}) {
    if (!this.claim()) return;
    const c = this.ctx, t = c.currentTime + (o.at || 0);
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const f = c.createBiquadFilter(); f.type = o.filter || 'lowpass';
    f.frequency.setValueAtTime(o.freq || 800, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    f.Q.value = o.q ?? 0.7;
    const g = c.createGain();
    g.gain.setValueAtTime(o.attack ? 0.0001 : gain, t);
    if (o.attack) g.gain.linearRampToValueAtTime(gain, t + o.attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g);
    this.out(g, o);
    s.onended = () => { this.voices--; };
    s.start(t, Math.random() * 1.5, dur + 0.05);
  }
}
