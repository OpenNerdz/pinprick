// Sample-level synthesis for the sound bank. Every sound the game plays is rendered once, into plain
// arrays, from a few physical models: noise and grit, filters, ringing modes (struck metal, a boot on
// concrete, a pipe), friction, and a throat (pulses from vocal folds through a vowel-shaped tract).
// Nothing here touches Web Audio, so the same code renders WAV files in Node.

export const TAU = Math.PI * 2;

/** Seeded random numbers 0..1 (mulberry32), with a few helpers. */
export function rand(seed) {
  let s = seed >>> 0;
  const r = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (a, b) => a + (b - a) * r();
  r.int = (a, b) => Math.floor(a + (b - a + 1) * r());
  r.gauss = () => (r() + r() + r() + r() - 2) * 1.732; // roughly normal, unit spread
  r.white = () => r() * 2 - 1;
  r.pick = a => a[Math.floor(r() * a.length)];
  return r;
}

/** A number, or a function of progress 0..1. */
const at = (v, p) => (typeof v === 'function' ? v(p) : v);

/** Biquad filter (RBJ cookbook): lp, hp, bp (0 dB peak) or peak (gain in dB). */
export class Filter {
  constructor(sr, type, f, q = 0.707, gain = 0) { this.sr = sr; this.z1 = 0; this.z2 = 0; this.set(type, f, q, gain); }
  set(type, f, q = this.q, gain = this.gain) {
    this.type = type; this.q = q; this.gain = gain;
    const w = TAU * Math.min(Math.max(f, 10), this.sr * 0.47) / this.sr, cs = Math.cos(w), al = Math.sin(w) / (2 * q), A = Math.pow(10, gain / 40);
    let b0, b1, b2, a0, a1, a2;
    if (type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  apply(a) { for (let i = 0; i < a.length; i++) a[i] = this.run(a[i]); return a; }
}

/** Run an array through a chain of filters, in place. */
export function chain(a, ...filters) { for (const f of filters) f.apply(a); return a; }

/** One ringing mode: struck, it rings at `f` and dies away in `t60` seconds (to -60 dB). */
export class Mode {
  constructor(sr, f, t60, amp = 1) { this.sr = sr; this.amp = amp; this.y1 = 0; this.y2 = 0; this.tune(f, t60); }
  tune(f, t60 = this.t60) {
    this.t60 = t60;
    const r = Math.exp(-6.9078 / (t60 * this.sr)), w = TAU * Math.min(f, this.sr * 0.45) / this.sr;
    this.c1 = 2 * r * Math.cos(w); this.c2 = -r * r; this.g = Math.sin(w) * this.amp;
    return this;
  }
  run(x) { const y = this.g * x + this.c1 * this.y1 + this.c2 * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}

/** A body of modes struck together: [[f, t60, amp], ...]. */
export class Body {
  constructor(sr, modes) { this.modes = modes.map(([f, t, a]) => new Mode(sr, f, t, a)); }
  run(x) { let y = 0; for (const m of this.modes) y += m.run(x); return y; }
}

/** Strike `body` at sample `i0` of `a`, with an impulse plus a short burst of noise `ms` long. */
export function strike(a, sr, r, body, i0, amp = 1, ms = 1.5, tail = 0.6) {
  const n = Math.min(a.length, i0 + Math.floor(tail * sr)), burst = Math.max(1, ms * sr / 1000);
  for (let i = Math.max(0, i0); i < n; i++) {
    const j = i - i0, x = j === 0 ? 1 : j < burst * 4 ? r.white() * Math.exp(-j / burst) * 0.5 : 0;
    a[i] += body.run(x * amp);
  }
}

/** Add a burst of filtered noise: attack and decay in seconds, an optional filter run on the burst. */
export function burst(a, sr, r, t0, amp, attack, decay, filters = []) {
  const i0 = Math.floor(t0 * sr), na = Math.max(1, attack * sr), nd = decay * sr, n = Math.min(a.length, i0 + Math.floor(na + nd * 7));
  for (let i = Math.max(0, i0); i < n; i++) {
    const j = i - i0, e = j < na ? j / na : Math.exp(-(j - na) / nd);
    let x = r.white() * e * amp;
    for (const f of filters) x = f.run(x);
    a[i] += x;
  }
}

/** Grit: `count` tiny clicks scattered over [t0, t1], each a few samples of noise. */
export function grit(a, sr, r, t0, t1, count, amp, hp = 2000) {
  const f = new Filter(sr, 'hp', hp, 0.7), tmp = new Float32Array(Math.floor((t1 - t0 + 0.01) * sr) + 1);
  for (let k = 0; k < count; k++) {
    const i = Math.floor(r() * (tmp.length - 40)), g = amp * (0.2 + 0.8 * r() ** 2), w = 1 + r() * 4;
    for (let j = 0; j < w * 5; j++) tmp[i + j] += r.white() * g * Math.exp(-j / w);
  }
  f.apply(tmp);
  mix(a, tmp, Math.floor(t0 * sr));
}

/** Add `src` into `dst` starting at sample `i0`, scaled by `gain`. */
export function mix(dst, src, i0 = 0, gain = 1) {
  const n = Math.min(src.length, dst.length - i0);
  for (let i = Math.max(0, -i0); i < n; i++) dst[i0 + i] += src[i] * gain;
  return dst;
}

/**
 * Friction: something dragged. Stick-slip pulses at `rate(p)` per second (with jitter), each a short
 * scrape of noise, through the band of the surface and the ringing of anything it rubs.
 */
export function friction(sr, r, o) {
  const n = Math.floor(o.dur * sr), a = new Float32Array(n);
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (i >= next) {
      const p = i / n, rate = at(o.rate, p);
      const w = (o.slip || 0.004) * sr, g = 0.4 + 0.6 * r();
      for (let j = 0; j < w * 4 && i + j < n; j++) a[i + j] += r.white() * g * Math.exp(-j / w);
      next = i + Math.max(2, sr / rate * (1 + (o.jitter ?? 0.4) * r.gauss() * 0.5));
    }
    a[i] += r.white() * (o.hiss ?? 0.15);
  }
  return a;
}

/**
 * A throat. Glottal pulses with jitter (pitch wavering pulse to pulse), shimmer (loudness wavering) and
 * period doubling (`sub`: every other pulse weaker, a rough, broken voice), plus breath that puffs with
 * each opening, through formants walking between vowels. Slow, irregular pulses (vocal fry) are a creak.
 * o: {dur, f0, jitter, shimmer, sub, oq (open share of each period), voice, breath, puff (how much the
 *     breath pulses with the folds: 0 steady, 2 a rattle), vowels, scale, bw (formant bandwidth scale),
 *     env(p), drive}; f0, sub, voice and breath may be functions of 0..1.
 */
export function throat(sr, r, o) {
  const n = Math.floor(o.dur * sr), flow = new Float32Array(n);
  let i = 0, k = 0;
  while (i < n) {
    const p = i / n, f = Math.max(8, at(o.f0, p)), T = Math.max(6, sr / f * (1 + (o.jitter || 0) * r.gauss()));
    let amp = Math.max(0.05, 1 + (o.shimmer || 0) * r.gauss());
    if (k % 2) amp *= 1 - clamp01(at(o.sub || 0, p));
    const oq = o.oq ?? 0.6, tp = Math.max(2, T * oq * 0.72), tn = Math.max(1, T * oq * 0.28);
    for (let j = 0; j < tp + tn && i + j < n; j++) {
      flow[i + j] += amp * (j < tp ? 0.5 * (1 - Math.cos(Math.PI * j / tp)) : Math.cos(Math.PI / 2 * (j - tp) / tn));
    }
    i += Math.round(T); k++;
  }
  // excitation: the flow's slope (the snap of each closure) plus breath, louder while the folds are open
  const ex = new Float32Array(n);
  let prev = 0;
  for (let j = 0; j < n; j++) {
    const p = j / n, v = flow[j];
    ex[j] = (v - prev) * 8 * at(o.voice ?? 1, p) + r.white() * (0.25 + v * (o.puff ?? 1)) * at(o.breath ?? 0.2, p);
    prev = v;
  }
  // the tract: three or four formants, re-tuned every 32 samples as the vowel moves
  const vs = (o.vowels || 'a').split(''), sc = o.scale || 1, bw = o.bw || 1;
  const fs = [0, 1, 2, 3].map(q => new Filter(sr, 'bp', 500, 5));
  const amps = [1, 0.7, 0.35, 0.18], out = new Float32Array(n);
  for (let j = 0; j < n; j++) {
    if ((j & 31) === 0) {
      const p = j / n, pos = p * (vs.length - 1), a0 = Math.floor(pos), t = pos - a0;
      const A = VOWELS[vs[a0]], B = VOWELS[vs[Math.min(vs.length - 1, a0 + 1)]];
      for (let q = 0; q < 4; q++) {
        const fq = (A[q] + (B[q] - A[q]) * t) * sc;
        fs[q].set('bp', fq, fq / (BW[q] * bw));
      }
    }
    let y = 0;
    for (let q = 0; q < 4; q++) y += fs[q].run(ex[j]) * amps[q];
    out[j] = y;
  }
  const drive = o.drive || 0;
  const env = o.env || (p => Math.min(1, p * 12) * Math.min(1, (1 - p) * 6));
  norm(out, 1);
  for (let j = 0; j < n; j++) {
    const y = drive ? Math.tanh(out[j] * drive) / Math.tanh(drive) : out[j];
    out[j] = y * env(j / n);
  }
  return out;
}

// formant centres (Hz) and bandwidths for a human-sized tract; `scale` stretches it larger or smaller
const VOWELS = {
  u: [300, 870, 2240, 3300], o: [450, 800, 2830, 3500], a: [730, 1090, 2440, 3400],
  e: [530, 1840, 2480, 3500], i: [270, 2290, 3010, 3700], h: [600, 1500, 2600, 3600],
};
const BW = [90, 110, 160, 220];
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Scale so the loudest sample is `peak`. */
export function norm(a, peak = 0.9) {
  let m = 0;
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; }
  if (m > 0) { const g = peak / m; for (let i = 0; i < a.length; i++) a[i] *= g; }
  return a;
}

/** Fade the first and last `ms` milliseconds so a sound never starts or stops with a click. */
export function edges(a, sr, inMs = 1, outMs = 20) {
  const ni = Math.min(a.length, Math.floor(inMs * sr / 1000)), no = Math.min(a.length, Math.floor(outMs * sr / 1000));
  for (let i = 0; i < ni; i++) a[i] *= i / ni;
  for (let i = 0; i < no; i++) a[a.length - 1 - i] *= i / no;
  return a;
}

/** Make a loop seamless: `a` has `fade` extra samples at the end, crossfaded into its start. */
export function loopify(a, fade) {
  const n = a.length - fade, out = a.slice(0, n);
  for (let i = 0; i < fade; i++) { const g = i / fade; out[i] = a[i] * Math.sqrt(g) + a[n + i] * Math.sqrt(1 - g); }
  return out;
}

/** Remove DC and rumble below `f` Hz. */
export function dcBlock(a, sr, f = 25) { return new Filter(sr, 'hp', f, 0.6).apply(a); }

/** Encode mono or stereo float arrays as a 16-bit WAV file (for the audition tool and tests). */
export function wav(channels, sr) {
  const ch = Array.isArray(channels) ? channels : [channels], n = ch[0].length, nc = ch.length;
  const buf = new ArrayBuffer(44 + n * nc * 2), v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n * nc * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true); v.setUint32(24, sr, true);
  v.setUint32(28, sr * nc * 2, true); v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, n * nc * 2, true);
  for (let i = 0, o = 44; i < n; i++) for (let c = 0; c < nc; c++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, ch[c][i])) * 32767, true);
  return new Uint8Array(buf);
}
