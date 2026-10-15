// Web Audio plumbing: buses, a shared echo, a cavern reverb, a voice cap, and two one-shot
// primitives (tone, noise) that every game sound is built from. Everything is synthesised; there are
// no audio files. The reverb's impulse response is generated noise, so it costs no download either.
//
//   sfx ─┐                                  echo (short slap) ──┐
//   amb ─┼─> master ─> limiter ─> speakers  reverb (2.8 s tail) ─┴─> master
//   ui  ─┘

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
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.amb = c.createGain(); this.amb.connect(this.master);
    this.ui = c.createGain(); this.ui.connect(this.master);
    // shared echo so blips have a tail in the tunnels
    const dl = c.createDelay(1); dl.delayTime.value = 0.23;
    const fb = c.createGain(); fb.gain.value = 0.36;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1700;
    this.echo = c.createGain(); this.echo.gain.value = 0.32;
    this.echo.connect(dl); dl.connect(lp); lp.connect(fb); fb.connect(dl); lp.connect(this.master);
    // cavern reverb: decaying stereo noise as the impulse response, darker toward the tail
    const len = Math.floor(c.sampleRate * 2.8), ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp1 = 0;
      for (let i = 0; i < len; i++) {
        const k = i / len, dark = 0.15 + 0.8 * k;
        lp1 += ((Math.random() * 2 - 1) - lp1) * (1 - dark);
        d[i] = lp1 * Math.pow(1 - k, 3) * (i < c.sampleRate * 0.012 ? 0 : 1);
      }
    }
    this.rev = c.createConvolver(); this.rev.buffer = ir;
    this.revIn = c.createGain(); this.revIn.gain.value = 1;
    const revOut = c.createGain(); revOut.gain.value = 0.8;
    this.revIn.connect(this.rev); this.rev.connect(revOut); revOut.connect(this.master);
    this.curves = new Map();
    this.noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return true;
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

  /** Pan (-1..1), straight distance and facing (1 ahead, -1 behind) of a world point from the listener. */
  place(x, z) {
    const L = this.listener, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz) || 0.001;
    const rx = Math.cos(L.yaw), rz = Math.sin(L.yaw), fx = Math.sin(L.yaw), fz = -Math.cos(L.yaw);
    return {pan: clamp((dx * rx + dz * rz) / d, -1, 1), dist: d, front: (dx * fx + dz * fz) / d};
  }

  out(node, o) {
    let n = node;
    if (o.pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = clamp(o.pan, -1, 1);
      n.connect(p); n = p;
    }
    n.connect(o.bus || this.sfx);
    if (o.echo) n.connect(this.echo);
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
