// The sound bank: renders recipes into AudioBuffers, each variant from its own seed, once, in the
// background, off the page's thread where it can. Anything asked for before it is ready plays nothing.

import {rand} from './dsp.js';

/** A stable seed for variant `i` of a sound. */
export function seedOf(name, i) {
  let h = 2166136261;
  for (let k = 0; k < name.length; k++) h = Math.imul(h ^ name.charCodeAt(k), 16777619);
  return (h ^ Math.imul(i + 1, 0x9e3779b1)) >>> 0;
}

/** One variant of a sound as plain arrays: pure, so it can run in the worker (worker.js) or right here. */
export function renderVariant(R, name, i, sr) {
  const d = R.make(sr, rand(seedOf(name, i)), i);
  return Array.isArray(d) ? d : [d];
}

const GAP = 30;      // ms between variants when rendering on the page's own thread
const PATIENCE = 4000; // ms to wait for a worker's answer before doing the work here instead

export class Bank {
  constructor(ctx, recipes) {
    this.ctx = ctx; this.recipes = recipes;
    this.cache = new Map();
    this.queue = null;   // names left for the background fill; null when no fill is running
    this.worker = null;
    this.timer = 0;
    this.waiting = new Map(); // name: callbacks for its first variant
  }

  /** The variants of a sound rendered so far; `want` is how many there will be. */
  slot(name) {
    let v = this.cache.get(name);
    if (!v) {
      const R = this.recipes[name];
      if (!R) throw new Error('no sound called ' + name);
      v = []; v.want = R.n || 1; v.last = -1;
      this.cache.set(name, v);
    }
    return v;
  }

  /** Every variant of a sound, right now. */
  all(name) {
    const v = this.slot(name);
    while (v.length < v.want) this.more(name, v);
    return v;
  }

  /**
   * One variant at random, never the same one twice running if there is a choice. During the background
   * fill this never renders: a sound that is not ready yet is null, which plays nothing, and moves up the
   * queue. Outside a fill it renders only the two variants this needs.
   */
  get(name) {
    const v = this.slot(name);
    if (this.queue) { if (v.length < v.want) this.hurry(name); }
    else while (v.length < Math.min(2, v.want)) this.more(name, v);
    if (v.length < 2) return v[0] || null;
    let k = Math.floor(Math.random() * (v.length - 1));
    if (k >= v.last) k++;
    v.last = k;
    return v[k];
  }

  /** Call `fn` with a variant of the sound as soon as there is one. */
  ready(name, fn) {
    const v = this.slot(name);
    if (!v.length && !this.queue) this.more(name, v);
    if (v.length) { fn(v[0]); return; }
    if (!this.waiting.has(name)) this.waiting.set(name, []);
    this.waiting.get(name).push(fn);
    this.hurry(name);
  }

  hurry(name) {
    const q = this.queue, k = q ? q.indexOf(name) : -1;
    if (k > 1) { q.splice(k, 1); q.splice(1, 0, name); } // [0] may be in the worker's hands already
  }

  /** The sample rate a sound is rendered at. */
  rateOf(name) { return Math.round(this.ctx.sampleRate * (this.recipes[name].rate || 1)); }

  /** Render the next variant of a sound here. */
  more(name, v) { this.store(name, v, renderVariant(this.recipes[name], name, v.length, this.rateOf(name))); }

  store(name, v, ch) {
    const b = this.ctx.createBuffer(ch.length, ch[0].length, this.rateOf(name));
    ch.forEach((c, k) => b.getChannelData(k).set(c));
    v.push(b);
    const w = this.waiting.get(name);
    if (w) { this.waiting.delete(name); for (const fn of w) fn(b); }
  }

  /** Several buffers mixed into one, so a burst of clicks or a stride costs one voice: [[buf, at, gain]]. Parts not ready yet are left out. */
  compose(parts) {
    const ok = parts.filter(p => p[0]);
    if (!ok.length) return null;
    const sr = ok[0][0].sampleRate;
    let len = 0;
    for (const [b, at] of ok) len = Math.max(len, Math.floor(at * sr) + b.length);
    const out = this.ctx.createBuffer(1, len, sr), d = out.getChannelData(0);
    for (const [b, at, g = 1] of ok) {
      const s = b.getChannelData(0), o = Math.floor(at * sr);
      for (let i = 0; i < s.length; i++) d[o + i] += s[i] * g;
    }
    return out;
  }

  /**
   * Render the rest in the background. With `workerSource` (the worker's code as text, so the game stays
   * one file) that happens off the page's thread; if a worker cannot start, fails or never answers, which
   * a locked-down viewer may do, it carries on here one variant per tick, so a phone only drops a frame
   * or two at a time.
   */
  prefill(names = Object.keys(this.recipes), workerSource = null) {
    this.queue = [...names];
    if (workerSource) this.spawn(workerSource);
    if (this.worker) this.next(); else this.timer = setTimeout(() => this.next(), GAP);
  }

  spawn(source) {
    try {
      const url = URL.createObjectURL(new Blob([source], {type: 'text/javascript'})), w = new Worker(url);
      w.onmessage = ({data: {name, i, ch}}) => {
        const v = this.slot(name);
        if (v.length === i) this.store(name, v, ch);
        if (this.worker === w) this.next();
      };
      w.onerror = () => this.dropWorker();
      w.url = url;
      this.worker = w;
    } catch (e) { this.worker = null; }
  }

  dropWorker() {
    const w = this.worker;
    clearTimeout(this.timer);
    if (!w) return;
    this.worker = null;
    w.terminate();
    URL.revokeObjectURL(w.url);
    if (this.queue) this.next();
  }

  next() {
    clearTimeout(this.timer);
    const q = this.queue;
    if (!q) return;
    while (q.length) {
      const name = q[0], v = this.slot(name);
      if (v.length >= v.want) { q.shift(); continue; }
      if (this.worker) {
        this.worker.postMessage({name, i: v.length, sr: this.rateOf(name)});
        this.timer = setTimeout(() => this.dropWorker(), PATIENCE);
      } else {
        this.more(name, v);
        this.timer = setTimeout(() => this.next(), GAP);
      }
      return;
    }
    this.queue = null;
    this.dropWorker();
  }

  /** Finish the fill right now, on this thread (for rendering scenes offline, where no time passes). */
  fillNow() {
    const q = this.queue;
    if (!q) return;
    this.queue = null;
    this.dropWorker();
    for (const name of q) this.all(name);
  }
}
