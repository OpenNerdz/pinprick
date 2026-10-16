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

import {clamp} from '../util/math.js';

const MAX_VOICES = 40;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this.muted = false;
    this.voices = 0;
    this.listener = {x: 0, z: 0, yaw: 0};
  }

  /** Must run from a user gesture. Safe to call repeatedly. */
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
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
    this.rev = c.createConvolver(); this.rev.buffer = this.cave();
    this.revIn = c.createGain();
    const revOut = c.createGain(); revOut.gain.value = 0.8;
    this.revIn.connect(this.rev); this.rev.connect(revOut); revOut.connect(this.world);
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
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return true;
  }

  /**
   * The cave's impulse response: a scatter of hard early reflections off the nearest walls, then a
   * diffuse tail building up over 40 ms. Lows ring longest; air and rock soak up the highs first.
   */
  cave() {
    const c = this.ctx, sr = c.sampleRate, len = Math.floor(sr * 3.2), ir = c.createBuffer(2, len, sr);
    const kl = 1 - Math.exp(-6.283 * 500 / sr), kh = 1 - Math.exp(-6.283 * 3000 / sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lo = 0, hi = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr, n = Math.random() * 2 - 1;
        lo += (n - lo) * kl; hi += (n - hi) * kh;
        const build = Math.min(1, Math.max(0, (t - 0.01) / 0.04));
        d[i] = build * (lo * Math.exp(-6.9 * t / 2.6) * 1.6 + (hi - lo) * Math.exp(-6.9 * t / 1.9) + (n - hi) * Math.exp(-6.9 * t / 0.8) * 0.5) * 0.35;
      }
      for (let k = 0; k < 14; k++) {
        const t = 0.007 + Math.pow(k / 14, 1.3) * 0.085 + Math.random() * 0.004;
        d[Math.floor(t * sr)] += (Math.random() < 0.5 ? -1 : 1) * 0.5 * (1 - k / 16) * (0.6 + 0.4 * Math.random());
      }
    }
    return ir;
  }

  get now() { return this.ctx ? this.ctx.currentTime : 0; }

  setVolume(v) { this.volume = v; this.applyGain(); }
  setMuted(m) { this.muted = m; this.applyGain(); }
  applyGain() { if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.now, 0.03); }

  /** Suspend sound while paused or backgrounded. */
  suspend(on) {
    if (!this.ctx) return;
    if (on && this.ctx.state === 'running') this.ctx.suspend();
    else if (!on && this.ctx.state === 'suspended') this.ctx.resume();
  }

  /** Muffle everything, as if your ears were ringing, and let it come back over `secs`. */
  deafen(secs) {
    if (!this.ctx) return;
    const f = this.ears.frequency, t = this.now;
    f.cancelScheduledValues(t); f.setValueAtTime(450, t); f.setTargetAtTime(20000, t + 0.3, secs / 3);
  }

  /** Pan (-1..1), straight distance and facing (1 ahead, -1 behind) of a world point from the listener. */
  place(x, z) {
    const L = this.listener, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz) || 0.001;
    const rx = Math.cos(L.yaw), rz = Math.sin(L.yaw), fx = Math.sin(L.yaw), fz = -Math.cos(L.yaw);
    return {pan: clamp((dx * rx + dz * rz) / d, -1, 1), dist: d, front: (dx * fx + dz * fz) / d};
  }

  /**
   * Route a voice out. o: {bus, pos ({pan, front} from place(): placed in 3D round your head, so behind
   * sounds behind), pan (simple left/right), echo, slap, rev (reverb send)}.
   */
  out(node, o) {
    let n = node;
    if (o.pos && this.hrtf) {
      const p = this.ctx.createPanner();
      p.panningModel = 'HRTF'; p.distanceModel = 'linear'; p.rolloffFactor = 0;
      const x = o.pos.pan, y = o.pos.up || 0, z = -o.pos.front;
      if (p.positionX) { p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z; } else p.setPosition(x, y, z);
      n.connect(p); n = p;
    } else if ((o.pan || o.pos) && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = clamp(o.pan ?? o.pos.pan, -1, 1);
      n.connect(p); n = p;
    }
    n.connect(o.bus || this.sfx);
    if (o.echo) n.connect(this.echo);
    if (o.slap) n.connect(this.slap);
    if (o.rev) { const s = this.ctx.createGain(); s.gain.value = o.rev; n.connect(s); s.connect(this.revIn); }
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

  /** Play a buffer. o: {gain, rate, at, lp (Hz, a muffling low-pass), loop, plus out()'s options}. */
  play(buf, o = {}) {
    if (!buf || !this.claim()) return null;
    const c = this.ctx, t = c.currentTime + (o.at || 0);
    const s = c.createBufferSource(); s.buffer = buf;
    if (o.rate) s.playbackRate.value = o.rate;
    let n = s;
    if (o.lp && o.lp < 16000) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = Math.max(80, o.lp); f.Q.value = 0.5;
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
