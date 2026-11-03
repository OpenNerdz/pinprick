// The shape of a level as the creature understands it: rooms, and the narrow places between them. Read
// off the height grid once when the level loads, so props can never turn the gap between two crates
// into a "doorway". Used to sweep rooms in a sensible order, wait at chokepoints, cut you off at the
// door you are running for, and come at you through the other way in.

import {CELL} from '../config.js';

const DUCT_BELOW = 2.6; // ceilings lower than this are ducts, doorways and crawls, however wide they look

export class Topology {
  /** `nav` is the creature's walkable grid: it decides where a room's centre can actually be stood on. */
  constructor(world, nav) {
    this.world = world; this.nav = nav;
    const W = this.w = world.w, H = this.h = world.h;
    const open = (x, z) => world.height(x, z) > 0;
    const narrow = (x, z) => world.height(x, z) < DUCT_BELOW
      || (!open(x - 1, z) && !open(x + 1, z)) || (!open(x, z - 1) && !open(x, z + 1));
    // >= 0 a room, -1 rock, <= -2 a chokepoint (id = -2 - value)
    const label = this.label = new Int16Array(W * H).fill(-1);
    this.rooms = []; this.chokes = [];
    const fill = (x0, z0, same, mark) => {
      const cells = [], stack = [z0 * W + x0];
      label[z0 * W + x0] = mark;
      while (stack.length) {
        const i = stack.pop(), x = i % W, z = (i - x) / W;
        cells.push(i);
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const jx = x + dx, jz = z + dz;
          if (jx < 0 || jz < 0 || jx >= W || jz >= H) continue;
          const j = jz * W + jx;
          if (label[j] === -1 && open(jx, jz) && same(jx, jz)) { label[j] = mark; stack.push(j); }
        }
      }
      return cells;
    };
    for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
      if (label[z * W + x] !== -1 || !open(x, z)) continue;
      if (narrow(x, z)) {
        const id = this.chokes.length;
        this.chokes.push({id, cells: fill(x, z, narrow, -2 - id), rooms: [], mouths: [], crawl: false, x: 0, z: 0});
      } else {
        const id = this.rooms.length;
        this.rooms.push({id, cells: fill(x, z, (a, b) => !narrow(a, b), id), portals: [], deadEnd: false, x: 0, z: 0, area: 0});
      }
    }
    for (const r of this.rooms) {
      r.area = r.cells.length * CELL * CELL;
      this.centre(r);
    }
    for (const c of this.chokes) {
      c.crawl = c.cells.some(i => world.height(i % W, Math.floor(i / W)) < nav.minH);
      this.centre(c);
      // where this choke opens into each room
      const seen = new Map();
      for (const i of c.cells) {
        const x = i % W, z = (i - x) / W;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const jx = x + dx, jz = z + dz;
          if (jx < 0 || jz < 0 || jx >= W || jz >= H) continue;
          const room = label[jz * W + jx];
          if (room < 0) continue;
          const m = seen.get(room) || {room, x: 0, z: 0, n: 0};
          m.x += (x + dx * 0.5 + 0.5) * CELL; m.z += (z + dz * 0.5 + 0.5) * CELL; m.n++;
          seen.set(room, m);
        }
      }
      for (const m of seen.values()) {
        const at = this.snap(m.x / m.n, m.z / m.n, 2.5);
        c.mouths.push({room: m.room, x: at ? at[0] : m.x / m.n, z: at ? at[1] : m.z / m.n});
        c.rooms.push(m.room);
        this.rooms[m.room].portals.push(c.id);
      }
    }
    for (const r of this.rooms) r.deadEnd = r.portals.length <= 1;
  }

  /** The middle of a run of grid cells, moved onto ground the creature can stand on. */
  centre(o) {
    const W = this.w;
    let sx = 0, sz = 0;
    for (const i of o.cells) { sx += (i % W + 0.5) * CELL; sz += (Math.floor(i / W) + 0.5) * CELL; }
    sx /= o.cells.length; sz /= o.cells.length;
    const at = this.snap(sx, sz, 5);
    o.x = at ? at[0] : sx; o.z = at ? at[1] : sz;
    o.standable = !!at;
  }

  snap(x, z, reach) {
    const i = this.nav.nearest(x, z, reach);
    return i < 0 ? null : [this.nav.cx(i), this.nav.cz(i)];
  }

  labelAt(x, z) {
    const cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    return cx < 0 || cz < 0 || cx >= this.w || cz >= this.h ? -1 : this.label[cz * this.w + cx];
  }

  /** The room containing (x, z), or null when that is a chokepoint or rock. */
  roomAt(x, z) { const l = this.labelAt(x, z); return l >= 0 ? this.rooms[l] : null; }

  /** The chokepoint containing (x, z), or null. */
  chokeAt(x, z) { const l = this.labelAt(x, z); return l <= -2 ? this.chokes[-2 - l] : null; }

  /** Ways in and out of a room the creature can use: [{choke, x, z}], at the mouths on this room's side. */
  exits(room) {
    const out = [];
    for (const id of room.portals) {
      const c = this.chokes[id];
      if (c.crawl) continue;
      const m = c.mouths.find(q => q.room === room.id);
      if (m) out.push({choke: c, x: m.x, z: m.z});
    }
    return out;
  }
}
