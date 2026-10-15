// Walkability grid at half-metre resolution plus Dijkstra distance fields. The creature uses one field
// rooted at itself for two jobs: how far a sound travelled to reach it (path distance, so sound goes
// round corners) and which way to walk to reach a target (follow the field back downhill).
// Level validation uses the same grid with the player's size to prove every goal is reachable.

import {CELL} from '../config.js';

const SQRT2 = Math.SQRT2;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

export class NavGrid {
  constructor(world, {radius = 0.35, minH = 2.2, res = 0.5} = {}) {
    this.world = world;
    this.radius = radius;
    this.minH = minH;
    this.res = res;
    this.nw = Math.round(world.w * CELL / res);
    this.nh = Math.round(world.h * CELL / res);
    this.n = this.nw * this.nh;
    this.walk = new Uint8Array(this.n);
    this.heapD = new Float32Array(this.n * 8);
    this.heapI = new Int32Array(this.n * 8);
    this.build();
  }

  /** Recompute walkability. Call after doors open or close. */
  build() {
    const {world, radius: r, minH, res, nw, nh, walk} = this;
    for (let iz = 0; iz < nh; iz++) for (let ix = 0; ix < nw; ix++) {
      const x = (ix + 0.5) * res, z = (iz + 0.5) * res;
      const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
      let ok = world.height(cx, cz) >= minH;
      // keep clear of low or solid neighbouring cells by the agent radius
      for (let dz = -1; ok && dz <= 1; dz++) for (let dx = -1; ok && dx <= 1; dx++) {
        if (!dx && !dz) continue;
        if (world.height(cx + dx, cz + dz) >= minH) continue;
        const x0 = (cx + dx) * CELL, z0 = (cz + dz) * CELL;
        const qx = Math.max(x0, Math.min(x, x0 + CELL)), qz = Math.max(z0, Math.min(z, z0 + CELL));
        if ((x - qx) ** 2 + (z - qz) ** 2 < r * r) ok = false;
      }
      walk[iz * nw + ix] = ok ? 1 : 0;
    }
    for (const p of world.props) {
      if (!p.on || !p.solid) continue;
      const x0 = p.k === 0 ? p.x0 : p.x - p.r, x1 = p.k === 0 ? p.x1 : p.x + p.r;
      const z0 = p.k === 0 ? p.z0 : p.z - p.r, z1 = p.k === 0 ? p.z1 : p.z + p.r;
      const a = Math.max(0, Math.floor((x0 - r) / res)), b = Math.min(nw - 1, Math.floor((x1 + r) / res));
      const c = Math.max(0, Math.floor((z0 - r) / res)), d = Math.min(nh - 1, Math.floor((z1 + r) / res));
      for (let iz = c; iz <= d; iz++) for (let ix = a; ix <= b; ix++) {
        const x = (ix + 0.5) * res, z = (iz + 0.5) * res;
        let d2;
        if (p.k === 0) {
          const qx = Math.max(p.x0, Math.min(x, p.x1)), qz = Math.max(p.z0, Math.min(z, p.z1));
          d2 = (x - qx) ** 2 + (z - qz) ** 2;
          if (d2 < r * r) walk[iz * nw + ix] = 0;
        } else {
          const R = p.r + r;
          d2 = (x - p.x) ** 2 + (z - p.z) ** 2;
          if (d2 < R * R) walk[iz * nw + ix] = 0;
        }
      }
    }
  }

  index(x, z) {
    const ix = Math.floor(x / this.res), iz = Math.floor(z / this.res);
    return ix < 0 || iz < 0 || ix >= this.nw || iz >= this.nh ? -1 : iz * this.nw + ix;
  }

  cx(i) { return ((i % this.nw) + 0.5) * this.res; }
  cz(i) { return (Math.floor(i / this.nw) + 0.5) * this.res; }

  walkableAt(x, z) { const i = this.index(x, z); return i >= 0 && this.walk[i] === 1; }

  /** Nearest walkable cell to (x, z) within `reach` metres, or -1. */
  nearest(x, z, reach = 2) {
    const i0 = this.index(x, z);
    if (i0 >= 0 && this.walk[i0]) return i0;
    const ix = Math.floor(x / this.res), iz = Math.floor(z / this.res), R = Math.ceil(reach / this.res);
    let best = -1, bd = Infinity;
    for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
      const jx = ix + dx, jz = iz + dz;
      if (jx < 0 || jz < 0 || jx >= this.nw || jz >= this.nh) continue;
      const j = jz * this.nw + jx;
      if (!this.walk[j]) continue;
      const d = (this.cx(j) - x) ** 2 + (this.cz(j) - z) ** 2;
      if (d < bd) { bd = d; best = j; }
    }
    return bd <= reach * reach ? best : -1;
  }

  /** Dijkstra distances (metres) from (sx, sz) to every cell; Infinity where unreachable. */
  field(sx, sz, out = new Float32Array(this.n)) {
    out.fill(Infinity);
    const s = this.nearest(sx, sz);
    if (s < 0) return out;
    const {nw, nh, walk, heapD, heapI, res} = this;
    let size = 0;
    const push = (d, i) => {
      let k = size++;
      while (k > 0) {
        const p = (k - 1) >> 1;
        if (heapD[p] <= d) break;
        heapD[k] = heapD[p]; heapI[k] = heapI[p]; k = p;
      }
      heapD[k] = d; heapI[k] = i;
    };
    out[s] = 0; push(0, s);
    while (size > 0) {
      const d = heapD[0], i = heapI[0];
      const ld = heapD[--size], li = heapI[size];
      let k = 0;
      while (true) {
        let c = 2 * k + 1;
        if (c >= size) break;
        if (c + 1 < size && heapD[c + 1] < heapD[c]) c++;
        if (heapD[c] >= ld) break;
        heapD[k] = heapD[c]; heapI[k] = heapI[c]; k = c;
      }
      heapD[k] = ld; heapI[k] = li;
      if (d > out[i]) continue;
      const ix = i % nw, iz = (i - ix) / nw;
      for (let q = 0; q < 8; q++) {
        const ddx = DIRS[q][0], ddz = DIRS[q][1], jx = ix + ddx, jz = iz + ddz;
        if (jx < 0 || jz < 0 || jx >= nw || jz >= nh) continue;
        const j = jz * nw + jx;
        if (!walk[j]) continue;
        if (q >= 4 && (!walk[iz * nw + jx] || !walk[jz * nw + ix])) continue; // no corner cutting
        const nd = d + (q >= 4 ? res * SQRT2 : res);
        if (nd < out[j] && size < heapD.length) { out[j] = nd; push(nd, j); }
      }
    }
    return out;
  }

  /** Path distance stored in `field` at (x, z), looking a little around unwalkable spots. */
  distAt(field, x, z, reach = 1.5) {
    const i = this.nearest(x, z, reach);
    return i < 0 ? Infinity : field[i];
  }

  /**
   * Cells from the field's source to (tx, tz), found by walking downhill from the target.
   * Returns null when the target is unreachable.
   */
  path(field, tx, tz, reach = 2) {
    let cur = this.nearest(tx, tz, reach);
    if (cur < 0 || !isFinite(field[cur])) return null;
    const out = [cur], {nw, nh, walk} = this;
    for (let guard = 0; guard < 4000 && field[cur] > 0; guard++) {
      const ix = cur % nw, iz = (cur - ix) / nw;
      let next = -1, nd = field[cur];
      for (let q = 0; q < 8; q++) {
        const jx = ix + DIRS[q][0], jz = iz + DIRS[q][1];
        if (jx < 0 || jz < 0 || jx >= nw || jz >= nh) continue;
        const j = jz * nw + jx;
        if (!walk[j]) continue;
        if (q >= 4 && (!walk[iz * nw + jx] || !walk[jz * nw + ix])) continue;
        if (field[j] < nd) { nd = field[j]; next = j; }
      }
      if (next < 0) break;
      cur = next; out.push(cur);
    }
    return out.reverse();
  }

  /** True when a straight walk from a to b stays on walkable cells. */
  lineClear(x0, z0, x1, z1) {
    const d = Math.hypot(x1 - x0, z1 - z0), steps = Math.ceil(d / (this.res * 0.5));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (!this.walkableAt(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t)) return false;
    }
    return true;
  }
}
