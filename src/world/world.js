// Static geometry of one level: the height grid, the props, and a per-cell index of props so rays
// and collision only look at what is nearby. Moving things (the creature, scare figures, the
// statue) are Actors, kept in a short list that is checked separately.

import {CELL} from '../config.js';
import {bounds} from './shapes.js';

// '#' rock   '.' room (3 m)   ':' hall (6 m)   ',' duct or doorway (2.2 m)   ';' low crawl (1.6 m)
export const LEGEND = {'#': 0, '.': 3, ':': 6, ',': 2.2, ';': 1.6, '=': 4.5};

export class World {
  constructor(map, legend = LEGEND) {
    this.w = map[0].length;
    this.h = map.length;
    this.cellH = new Float32Array(this.w * this.h);
    for (let z = 0; z < this.h; z++) {
      if (map[z].length !== this.w) throw new Error(`map row ${z} is ${map[z].length} wide, expected ${this.w}`);
      for (let x = 0; x < this.w; x++) {
        const c = map[z][x];
        if (!(c in legend)) throw new Error(`unknown map symbol "${c}" at ${x},${z}`);
        this.cellH[z * this.w + x] = legend[c];
      }
    }
    this.props = [];
    this.actors = [];
    this.decals = [];
    this.cellStart = null;
    this.cellItems = null;
    this.stamp = null;
    this.castId = 0;
    this.version = 0; // bumped whenever something visible to the occluder mesh changes
  }

  add(p) { this.props.push(p); return p; }

  height(ix, iz) {
    return ix < 0 || iz < 0 || ix >= this.w || iz >= this.h ? 0 : this.cellH[iz * this.w + ix];
  }

  heightAt(x, z) { return this.height(Math.floor(x / CELL), Math.floor(z / CELL)); }

  /** Build the cell → prop index. Call once after all props are added. */
  index() {
    const n = this.w * this.h, counts = new Int32Array(n + 1);
    const cells = this.props.map(p => {
      const [x0, z0, x1, z1] = bounds(p);
      const a = Math.max(0, Math.floor(x0 / CELL)), b = Math.min(this.w - 1, Math.floor(x1 / CELL));
      const c = Math.max(0, Math.floor(z0 / CELL)), d = Math.min(this.h - 1, Math.floor(z1 / CELL));
      const list = [];
      for (let z = c; z <= d; z++) for (let x = a; x <= b; x++) list.push(z * this.w + x);
      return list;
    });
    for (const list of cells) for (const c of list) counts[c + 1]++;
    for (let i = 0; i < n; i++) counts[i + 1] += counts[i];
    const items = new Int32Array(counts[n]), fill = counts.slice(0, n);
    cells.forEach((list, pi) => { for (const c of list) items[fill[c]++] = pi; });
    this.cellStart = counts;
    this.cellItems = items;
    this.stamp = new Uint32Array(this.props.length);
    this.version++;
  }

  touch() { this.version++; }
}

/**
 * An Actor is a group of primitives that moves as one (the creature, a scare figure, the statue).
 * Parts are defined relative to the actor origin and re-placed whenever it moves.
 */
export class Actor {
  constructor(parts, o = {}) {
    this.local = parts;                       // relative primitives
    this.parts = parts.map(p => ({...p}));    // world-space copies
    this.x = 0; this.z = 0; this.face = 0; this.lift = 0;
    this.on = o.on ?? true;
    this.solid = o.solid ?? false;
    this.radius = o.radius ?? 0.45;           // bounding cylinder for quick ray rejection
    this.bodyR = o.bodyR ?? 0.3;              // what the player bumps into when it is solid
    this.height = o.height ?? 2.3;
    this.lastHit = -1e9;                      // game time a scanner ray last landed on it
    this.hits = 0;
  }

  /** Move the actor. `lift` raises it (a figure standing on a pedestal). Boxes do not rotate; capsules turn both ends. */
  place(x, z, face = this.face, lift = this.lift) {
    this.x = x; this.z = z; this.face = face; this.lift = lift;
    const s = Math.sin(face), c = Math.cos(face);
    for (let i = 0; i < this.local.length; i++) {
      const l = this.local[i], p = this.parts[i];
      if (l.k === 0) {
        p.x0 = x + l.x0; p.x1 = x + l.x1; p.z0 = z + l.z0; p.z1 = z + l.z1;
        p.y0 = l.y0 + lift; p.y1 = l.y1 + lift;
        continue;
      }
      // local +x is the actor's right, local -z its forward; rotate by its facing
      if (l.k === 3) { // a capsule: both ends
        p.ax = x + l.ax * c - l.az * s; p.az = z + l.ax * s + l.az * c; p.ay = l.ay + lift;
        p.bx = x + l.bx * c - l.bz * s; p.bz = z + l.bx * s + l.bz * c; p.by = l.by + lift;
        p.x = (p.ax + p.bx) / 2; p.z = (p.az + p.bz) / 2; p.r = l.r;
        continue;
      }
      p.x = x + l.x * c - l.z * s; p.z = z + l.x * s + l.z * c; p.r = l.r;
      if (l.k === 1) { p.y0 = l.y0 + lift; p.y1 = l.y1 + lift; } else p.y = l.y + lift;
    }
  }
}
