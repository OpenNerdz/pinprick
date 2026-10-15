// Turns a level definition (plain data in src/levels/) into a playable World plus the game objects
// that live in it. Compiling copies every prop, so restarting a level always starts clean.

import {MAT} from '../config.js';
import {rng} from '../util/math.js';
import {World} from './world.js';
import {box, cyl, sph} from './shapes.js';

export const CORE_PICKUP = 1.0;
export const EXIT_RADIUS = 0.95;
export const NOTE_PICKUP = 1.15;

export function compileLevel(def, seed = 1) {
  const world = new World(def.map, def.legend);
  for (const p of def.props || []) world.add({...p});

  const rand = rng(seed);
  const spots = rand.shuffle((def.cores?.spots || []).slice()).slice(0, def.cores?.count ?? 0);
  const cores = spots.map(([x, z]) => ({
    x, z, got: false,
    stand: world.add(cyl(x, z, 0.18, 0, 0.75)),
    orb: world.add(sph(x, 1.2, z, 0.26, {m: MAT.CORE, solid: false})),
  }));

  const exit = {x: def.exit.x, z: def.exit.z};
  world.add(cyl(exit.x, exit.z, 0.7, 0, 0.06, {m: MAT.EXIT, solid: false}));
  world.add(sph(exit.x, 1.3, exit.z, 0.3, {m: MAT.EXIT, solid: false}));
  const exitDoor = def.exitDoor
    ? world.add(box(...def.exitDoor.box, 0, def.exitDoor.h ?? 3, {m: MAT.EXIT, id: 'exit'}))
    : null;

  const doors = new Map();
  for (const d of def.doors || []) {
    doors.set(d.id, {id: d.id, open: !!d.open, prop: world.add(box(...d.box, 0, d.h ?? 3, {on: !d.open, id: d.id}))});
  }

  const notes = (def.notes || []).map((n, i) => {
    world.add(cyl(n.x, n.z, 0.1, 0, 0.82));
    return {...n, i, read: false, slate: world.add(box(n.x - 0.2, n.z - 0.14, n.x + 0.2, n.z + 0.14, 0.82, 0.88, {m: MAT.NOTE, solid: false}))};
  });

  world.decals = (def.decals || []).map(d => ({...d}));
  world.index();

  return {
    def, world, cores, exit, exitDoor, doors, notes,
    start: {x: def.start.x, z: def.start.z, yaw: def.start.yaw ?? 0},
    hides: (def.hides || []).map(h => ({...h})),
    triggers: (def.triggers || []).map(t => ({...t, fired: false})),
    ghosts: def.ghosts || [],
    statue: def.statue ? {...def.statue} : null,
    stalker: def.stalker ? {...def.stalker} : null,
    seed,
  };
}
