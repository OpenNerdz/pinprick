// Where the creature thinks you might be. It cannot see, so it keeps a map of probability over the level
// and reasons about it the way you would in the dark:
//   - time passes and you could have walked anywhere from where you were, so the map spreads along the
//     level's corridors (never through rock);
//   - a sound multiplies the map by how likely that sound was from each place, measured as walking
//     distance. Several sounds in a row sharpen one another, so one footstep gives it a rough idea and
//     three give it your position;
//   - coming up empty counts too. A clear echo, or simply having walked somewhere, lowers the odds there.
// Nothing here reads the player's true position; the map is only ever fed what the creature sensed. That
// is what makes its searching look deliberate: it stops going back to places it has already ruled out.

const STEP = 0.25;       // seconds per update of the spreading
const SPREAD = 0.6;      // share of each cell's probability that moves to its neighbours per update
const LEAK = 0.002;      // a little always leaks everywhere: it can never be completely sure of nothing
const WALK_METRE = 0.8;  // four-way walking overstates distance on a grid; this brings it back

export class Belief {
  /** `grid` is the player's walkable grid (crawls included); `creature`, the creature's own. */
  constructor(grid, creature = grid) {
    this.grid = grid; this.creature = creature;
    const r = this.sub = Math.max(1, Math.round(1 / grid.res));
    this.res = grid.res * r;
    this.w = Math.floor(grid.nw / r); this.h = Math.floor(grid.nh / r); this.n = this.w * this.h;
    this.p = new Float32Array(this.n); this.q = new Float32Array(this.n);
    this.walk = new Uint8Array(this.n); this.reach = new Uint8Array(this.n);
    this.adj = new Int32Array(this.n * 4);
    this.dist = new Float32Array(this.n); this.queue = new Int32Array(this.n);
    this.acc = 0; this.cells = 0;
    this.rebuild();
    this.uniform();
  }

  /** Re-read what can be walked on. Call after doors open or close. */
  rebuild() {
    const {w, h, sub: r, grid, creature, walk, reach, adj} = this;
    let cells = 0;
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      let a = 0, b = 0;
      for (let dz = 0; dz < r; dz++) for (let dx = 0; dx < r; dx++) {
        const g = (z * r + dz) * grid.nw + x * r + dx;
        if (grid.walk[g]) a = 1;
        if (creature.walk[g]) b = 1;
      }
      walk[z * w + x] = a; reach[z * w + x] = b;
      cells += a;
    }
    this.cells = Math.max(1, cells);
    for (let z = 0; z < h; z++) for (let x = 0; x < w; x++) {
      const i = z * w + x;
      adj[i * 4] = x + 1 < w && walk[i + 1] ? i + 1 : -1;
      adj[i * 4 + 1] = x > 0 && walk[i - 1] ? i - 1 : -1;
      adj[i * 4 + 2] = z + 1 < h && walk[i + w] ? i + w : -1;
      adj[i * 4 + 3] = z > 0 && walk[i - w] ? i - w : -1;
      if (!walk[i]) this.p[i] = 0;
    }
    this.normalise();
  }

  index(x, z) {
    const ix = Math.floor(x / this.res), iz = Math.floor(z / this.res);
    return ix < 0 || iz < 0 || ix >= this.w || iz >= this.h ? -1 : iz * this.w + ix;
  }
  cx(i) { return (i % this.w + 0.5) * this.res; }
  cz(i) { return (Math.floor(i / this.w) + 0.5) * this.res; }

  /** The cell at (x, z), or the closest one you could stand in within a couple of metres, or -1. */
  cellNear(x, z) {
    const i = this.index(x, z);
    if (i >= 0 && this.walk[i]) return i;
    const ix = Math.floor(x / this.res), iz = Math.floor(z / this.res);
    let best = -1, bd = 1e9;
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= this.w || jz >= this.h) continue;
      const j = jz * this.w + jx;
      if (this.walk[j] && dx * dx + dz * dz < bd) { bd = dx * dx + dz * dz; best = j; }
    }
    return best;
  }

  normalise() {
    const {p, n} = this;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += p[i];
    if (sum < 1e-9) { this.uniform(); return; }
    const k = 1 / sum;
    for (let i = 0; i < n; i++) p[i] *= k;
  }

  /** It has no idea. */
  uniform() {
    const {p, walk, n} = this, k = 1 / this.cells;
    for (let i = 0; i < n; i++) p[i] = walk[i] ? k : 0;
  }

  /** Let time pass: you may have moved. */
  step(dt) {
    this.acc += dt;
    for (let guard = 0; this.acc >= STEP && guard < 8; guard++) {
      this.acc -= STEP;
      const {p, q, n, adj, walk} = this, leak = LEAK / this.cells;
      q.fill(0);
      for (let i = 0; i < n; i++) {
        const m = p[i];
        if (m <= 0) continue;
        const share = m * SPREAD / 4;
        let keep = m - m * SPREAD;
        for (let d = 0; d < 4; d++) {
          const j = adj[i * 4 + d];
          if (j >= 0) q[j] += share; else keep += share;
        }
        q[i] += keep;
      }
      for (let i = 0; i < n; i++) p[i] = walk[i] ? q[i] * (1 - LEAK) + leak : 0;
    }
    if (this.acc > STEP * 8) this.acc = 0; // back from a long pause: do not try to catch up
  }

  /** Walking distances (metres) from a cell to every cell within `reach`; everything else stays -1. */
  walkFrom(start, reach) {
    const {dist, queue, adj, res} = this;
    dist.fill(-1);
    if (start < 0) return dist;
    let head = 0, tail = 0;
    dist[start] = 0; queue[tail++] = start;
    while (head < tail) {
      const i = queue[head++], d = dist[i] + res * WALK_METRE;
      if (d > reach) continue;
      for (let q = 0; q < 4; q++) {
        const j = adj[i * 4 + q];
        if (j >= 0 && dist[j] < 0) { dist[j] = d; queue[tail++] = j; }
      }
    }
    return dist;
  }

  /**
   * A sound (or a hunch) from about (x, z), give or take `sigma` metres of walking. `trust` is how sure
   * it is that this was you and not nothing: at 1 everything elsewhere is ruled out.
   */
  observe(x, z, sigma, trust = 0.97) {
    const {p, n, walk} = this;
    const dist = this.walkFrom(this.cellNear(x, z), sigma * 4);
    const floor = 1 - trust, prior = 0.2 / this.cells, s2 = 2 * sigma * sigma;
    for (let i = 0; i < n; i++) {
      if (!walk[i]) continue;
      const d = dist[i];
      p[i] = (p[i] + prior) * (floor + (d < 0 ? 0 : trust * Math.exp(-d * d / s2)));
    }
    this.normalise();
  }

  /** It knows, about this exactly. */
  place(x, z, sigma = 1.5) {
    this.uniform();
    this.observe(x, z, sigma, 1);
  }

  /** It stood here (or reached in) and you were not there: the odds around (x, z) fall to `keep`. */
  touch(x, z, r = 1.4, keep = 0.03) {
    const {p, walk, res, w, h} = this, R = Math.ceil(r / res);
    const ix = Math.floor(x / res), iz = Math.floor(z / res);
    let changed = false;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= w || jz >= h || (dx * dx + dz * dz) * res * res > r * r) continue;
      const j = jz * w + jx;
      if (walk[j] && p[j] > 0) { p[j] *= keep; changed = true; }
    }
    if (changed) this.normalise();
  }

  /**
   * An echo that found nothing moving, from a head at (x, y, z) reaching `R` metres. `blocked(dx, dy, dz, d)`
   * says whether rock stops the echo on the way to a cell. You might simply be keeping still, so this only
   * lowers the odds to `keep`, rather than ruling you out.
   */
  scan(x, y, z, R, keep, blocked) {
    const {p, walk, res, w, h} = this, N = Math.ceil(R / res);
    const ix = Math.floor(x / res), iz = Math.floor(z / res);
    for (let dz = -N; dz <= N; dz++) for (let dx = -N; dx <= N; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= w || jz >= h) continue;
      const j = jz * w + jx;
      if (!walk[j]) continue;
      const ex = (jx + 0.5) * res - x, ez = (jz + 0.5) * res - z, ey = 1 - y, d = Math.hypot(ex, ey, ez);
      if (d > R || d < 1e-3 || blocked(ex / d, ey / d, ez / d, d)) continue;
      p[j] *= keep;
    }
    this.normalise();
  }

  /** How much of the probability lies within `r` metres of (x, z), counting only ground the creature can reach. */
  massNear(x, z, r = 4) {
    const {p, reach, res, w, h} = this, R = Math.ceil(r / res);
    const ix = Math.floor(x / res), iz = Math.floor(z / res);
    let sum = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= w || jz >= h) continue;
      const j = jz * w + jx;
      if (reach[j]) sum += p[j];
    }
    return sum;
  }

  /** `massNear` compared with knowing nothing: 1 is what an even spread would give, 5 is five times as likely. */
  oddsNear(x, z, r = 4) {
    const R = Math.ceil(r / this.res);
    return this.massNear(x, z, r) * this.cells / ((2 * R + 1) * (2 * R + 1));
  }

  /** The likeliest cell within `r` metres of (x, z), as {x, z}; (x, z) itself when there is nothing to go on. */
  peakNear(x, z, r = 6) {
    const {p, walk, res, w, h} = this, R = Math.ceil(r / res);
    const ix = Math.floor(x / res), iz = Math.floor(z / res);
    let bi = -1, bp = 0;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= w || jz >= h) continue;
      const j = jz * w + jx;
      if (walk[j] && p[j] > bp) { bp = p[j]; bi = j; }
    }
    return bi < 0 ? {x, z} : {x: this.cx(bi), z: this.cz(bi)};
  }

  /**
   * The best place to go and look: likely, and not too far to walk. `field` is the creature's walking
   * distance from where it stands; only spots between `min` and `max` metres away are considered, and every
   * `D` metres of walking counts a factor of e against a spot. Returns {x, z, odds}, or null.
   */
  best(field, {min = 1.5, max = Infinity, D = 18} = {}) {
    const {p, reach, w, h, creature} = this;
    let bi = -1, bs = 0, bm = 0;
    for (let z = 1; z < h - 1; z++) for (let x = 1; x < w - 1; x++) {
      const i = z * w + x;
      if (!reach[i]) continue;
      const g = creature.nearest(this.cx(i), this.cz(i), 0.9);
      if (g < 0) continue;
      const d = field[g];
      if (!(d >= min && d <= max)) continue;
      let m = 0;
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const j = i + dz * w + dx;
        if (reach[j]) m += p[j];
      }
      const s = m * Math.exp(-d / D);
      if (s > bs) { bs = s; bi = i; bm = m; }
    }
    return bi < 0 ? null : {x: this.cx(bi), z: this.cz(bi), odds: bm * this.cells / 9};
  }

  /** How unsure it is, in metres: the spread of the map around its centre. Small means it nearly has you. */
  spread() {
    const {p, n} = this;
    let mx = 0, mz = 0, v = 0;
    for (let i = 0; i < n; i++) if (p[i] > 0) { mx += p[i] * this.cx(i); mz += p[i] * this.cz(i); }
    for (let i = 0; i < n; i++) if (p[i] > 0) v += p[i] * ((this.cx(i) - mx) ** 2 + (this.cz(i) - mz) ** 2);
    return Math.sqrt(v);
  }

  /** For the debug overlay: {w, h, cells} with values scaled to 0..1. */
  map() {
    let top = 1e-9;
    const {p, n, q} = this;
    for (let i = 0; i < n; i++) if (p[i] > top) top = p[i];
    const cells = q.slice();
    for (let i = 0; i < n; i++) cells[i] = p[i] / top;
    return {w: this.w, h: this.h, cells};
  }
}
