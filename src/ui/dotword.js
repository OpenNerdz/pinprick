// A heading painted by the scanner. The word is a cloud of dots that a wandering beam lights and lets
// fade, like everything else in this game. The dots are cooler as they age, and now and then a red
// wash goes through them, because something else down here has a scanner too. The heading's own text
// stays in the page for screen readers and for layout; this only draws over it.

const LIFE = 3.2;           // seconds a lit dot takes to fade
const FRAME = 1 / 30;       // no need for more than this behind a menu
const PAINT_IN = 1.3;       // the first pass across the word
const WASH_LIFE = 1.5;

export const PALETTES = {
  scan: {hot: '#fff3d6', cool: '#39d3c4', rest: 'rgba(212,233,228,.46)', wash: '#ff5240', washes: true},
  quiet: {hot: '#fff3d6', cool: '#39d3c4', rest: 'rgba(212,233,228,.46)', wash: '#ff5240', washes: false},
  danger: {hot: '#ffb8a8', cool: '#ff5240', rest: 'rgba(255,82,64,.5)', wash: '#ff5240', washes: false},
  exit: {hot: '#fff3d6', cool: '#ffc247', rest: 'rgba(255,194,71,.46)', wash: '#39d3c4', washes: false},
};

export class DotWord {
  constructor(reduceMotion) {
    this.reduceMotion = reduceMotion;
    this.h1 = null;
    this.lastDraw = -1;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dotword';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.ctx = this.canvas.getContext('2d');
    this.n = 0;
    this.lastDraw = -1;
    this.w = this.h = 0;
    document.fonts?.ready?.then(() => { if (this.h1) this.build(); });
  }

  setReduceMotion(on) {
    if (on === this.reduceMotion) return;
    this.reduceMotion = on;
    if (this.h1) this.build();
  }

  attach(h1, palette = PALETTES.scan) {
    if (!this.ctx) return;
    this.detach();
    this.h1 = h1; this.pal = palette;
    h1.classList.add('live');
    h1.append(this.canvas);
    this.t0 = -1;
    this.build();
  }

  detach() {
    if (!this.h1) return;
    this.h1.classList.remove('live');
    this.canvas.remove();
    this.h1 = null;
  }

  /** Sample the word's strokes into dots. */
  build() {
    const h1 = this.h1, cs = getComputedStyle(h1), W = h1.clientWidth, H = h1.clientHeight;
    this.w = W; this.h = H;
    if (!W || !H) { this.n = 0; return; }
    const ratio = Math.min(2, window.devicePixelRatio || 1), pad = 6;
    const size = parseFloat(cs.fontSize);
    this.canvas.width = (W + pad * 2) * ratio; this.canvas.height = (H + pad * 2) * ratio;
    this.canvas.style.cssText = `left:${-pad}px;top:${-pad}px;width:${W + pad * 2}px;height:${H + pad * 2}px`;
    // the word, drawn once, letter by letter (canvas letter spacing is too new to rely on)
    const off = document.createElement('canvas');
    off.width = W; off.height = H;
    const o = off.getContext('2d', {willReadFrequently: true});
    o.font = `${cs.fontWeight} ${size}px ${cs.fontFamily}`;
    o.textBaseline = 'middle'; o.fillStyle = o.strokeStyle = '#fff';
    o.lineWidth = size * 0.055; o.lineJoin = 'round'; // Michroma's strokes are thin: thicken them so the dots read as a word, not an outline
    const word = h1.textContent.trim().toUpperCase(), spacing = parseFloat(cs.letterSpacing) || 0;
    let x = 0;
    for (const ch of word) { o.fillText(ch, x, H / 2); o.strokeText(ch, x, H / 2); x += o.measureText(ch).width + spacing; }
    const a = o.getImageData(0, 0, W, H).data;
    const pitch = Math.max(1.6, Math.min(2.8, size / 24));
    const xs = [], ys = [];
    for (let py = 0; py < H; py += pitch) {
      for (let px = 0; px < W; px += pitch) {
        const jx = px + (Math.random() - 0.5) * pitch * 0.7, jy = py + (Math.random() - 0.5) * pitch * 0.7;
        const ix = Math.max(0, Math.min(W - 1, Math.round(jx))), iy = Math.max(0, Math.min(H - 1, Math.round(jy)));
        if (a[(iy * W + ix) * 4 + 3] > 120) { xs.push(jx + pad); ys.push(jy + pad); }
      }
    }
    // sorted across the word, so the beam can pick dots near where it is pointing
    const order = xs.map((_, i) => i).sort((i, j) => xs[i] - xs[j]);
    this.n = order.length;
    this.xs = Float32Array.from(order, i => xs[i]);
    this.ys = Float32Array.from(order, i => ys[i]);
    this.size = Float32Array.from(order, () => 0.8 + Math.random() * 0.75);
    this.born = new Float32Array(this.n).fill(-99);
    this.red = new Float32Array(this.n).fill(-99);
    this.nextWash = 9 + Math.random() * 9;
    this.wash = null;
    this.ratio = ratio; this.pad = pad;
    // the word at rest, so that it can always be read
    const base = this.base = document.createElement('canvas');
    base.width = this.canvas.width; base.height = this.canvas.height;
    const b = base.getContext('2d');
    b.scale(ratio, ratio); b.fillStyle = this.pal.rest;
    for (let i = 0; i < this.n; i++) b.fillRect(this.xs[i], this.ys[i], this.size[i], this.size[i]);
    this.lastDraw = -1;
    if (this.reduceMotion) this.still();
  }

  /** The word fully lit and not moving, for prefers-reduced-motion. */
  still() {
    const c = this.ctx;
    c.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    c.clearRect(0, 0, this.w + this.pad * 2, this.h + this.pad * 2);
    c.fillStyle = this.pal.hot; c.globalAlpha = 0.85;
    for (let i = 0; i < this.n; i++) c.fillRect(this.xs[i], this.ys[i], this.size[i], this.size[i]);
    c.globalAlpha = 1;
  }

  frame(T) {
    const h1 = this.h1;
    if (!h1 || this.reduceMotion) return;
    if (h1.clientWidth !== this.w || h1.clientHeight !== this.h) this.build();
    if (!this.n || T - this.lastDraw < FRAME) return;
    const dt = this.lastDraw < 0 ? 0 : Math.min(0.1, T - this.lastDraw);
    this.lastDraw = T;
    if (this.t0 < 0) this.t0 = T;
    const t = T - this.t0, n = this.n;

    // the beam: one pass across to start with, then a slow wander back and forth
    const u = t < PAINT_IN ? t / PAINT_IN : 0.5 + 0.48 * Math.sin((t - PAINT_IN) * 0.43 - Math.PI / 2 + 1.5) * Math.cos(t * 0.13);
    const spawn = Math.ceil(n * (t < PAINT_IN ? 2.6 : 0.8) * dt);
    const spread = t < PAINT_IN ? 0.05 : 0.11;
    for (let k = 0; k < spawn; k++) {
      const g = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5; // near enough to a bell
      const i = Math.floor((u + g * spread * 2) * n);
      if (i >= 0 && i < n) this.born[i] = t;
    }

    // its answer: rarely, a ring of red going through the word
    if (this.pal.washes && !this.wash && t > this.nextWash) {
      const i = Math.floor(Math.random() * n);
      this.wash = {x: this.xs[i], y: this.ys[i], t, reach: this.w * (0.35 + Math.random() * 0.5)};
    }
    if (this.wash) {
      const f = (t - this.wash.t) / 1.1, r = f * this.wash.reach;
      if (f >= 1) { this.wash = null; this.nextWash = t + 14 + Math.random() * 18; }
      else for (let i = 0; i < n; i++) {
        const d = Math.hypot(this.xs[i] - this.wash.x, this.ys[i] - this.wash.y);
        if (d < r && d > r - 16 && Math.random() < 0.4) this.red[i] = t;
      }
    }

    const c = this.ctx, p = this.pal;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, this.canvas.width, this.canvas.height);
    c.drawImage(this.base, 0, 0);
    c.setTransform(this.ratio, 0, 0, this.ratio, 0, 0);
    let fill = '';
    for (let i = 0; i < n; i++) {
      const lit = t - this.born[i], red = t - this.red[i];
      let want, alpha;
      if (red < WASH_LIFE && red < lit) { want = p.wash; alpha = 1 - red / WASH_LIFE; }
      else if (lit < LIFE) { want = lit < 0.5 ? p.hot : p.cool; alpha = Math.pow(1 - lit / LIFE, 1.3); }
      else continue;
      if (want !== fill) { fill = want; c.fillStyle = want; }
      c.globalAlpha = alpha;
      c.fillRect(this.xs[i], this.ys[i], this.size[i], this.size[i]);
    }
    c.globalAlpha = 1;
  }
}
