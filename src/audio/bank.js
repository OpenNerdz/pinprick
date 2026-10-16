// The sound bank: renders recipes into AudioBuffers, each variant from its own seed, once. Anything
// asked for before the background fill reaches it is rendered on the spot.

import {rand} from './dsp.js';

/** A stable seed for variant `i` of a sound. */
export function seedOf(name, i) {
  let h = 2166136261;
  for (let k = 0; k < name.length; k++) h = Math.imul(h ^ name.charCodeAt(k), 16777619);
  return (h ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
}

export class Bank {
  constructor(ctx, recipes) {
    this.ctx = ctx; this.recipes = recipes;
    this.cache = new Map();
  }

  /** Every variant of a sound. */
  all(name) {
    let v = this.cache.get(name);
    if (!v) { v = this.render(name); this.cache.set(name, v); }
    return v;
  }

  /** One variant at random, never the same one twice running. */
  get(name) {
    const v = this.all(name);
    if (v.length < 2) return v[0];
    let k = Math.floor(Math.random() * (v.length - 1));
    if (k >= v.last) k++;
    v.last = k;
    return v[k];
  }

  render(name) {
    const R = this.recipes[name];
    if (!R) throw new Error('no sound called ' + name);
    const sr = Math.round(this.ctx.sampleRate * (R.rate || 1)), out = [];
    for (let i = 0; i < (R.n || 1); i++) {
      const d = R.make(sr, rand(seedOf(name, i)), i), ch = Array.isArray(d) ? d : [d];
      const b = this.ctx.createBuffer(ch.length, ch[0].length, sr);
      ch.forEach((c, k) => b.getChannelData(k).set(c));
      out.push(b);
    }
    out.last = -1;
    return out;
  }

  /** Several buffers mixed into one, so a burst of clicks or a stride costs one voice: [[buf, at, gain]]. */
  compose(parts) {
    const sr = parts[0][0].sampleRate;
    let len = 0;
    for (const [b, at] of parts) len = Math.max(len, Math.floor(at * sr) + b.length);
    const out = this.ctx.createBuffer(1, len, sr), d = out.getChannelData(0);
    for (const [b, at, g = 1] of parts) {
      const s = b.getChannelData(0), o = Math.floor(at * sr);
      for (let i = 0; i < s.length; i++) d[o + i] += s[i] * g;
    }
    return out;
  }

  /** Render the rest in the background, one sound per tick, so first uses rarely stall a frame. */
  prefill(names = Object.keys(this.recipes)) {
    const left = names.filter(n => !this.cache.has(n));
    const next = () => {
      const n = left.shift();
      if (n === undefined) return;
      if (!this.cache.has(n)) this.all(n);
      setTimeout(next, 30);
    };
    setTimeout(next, 30);
  }
}
