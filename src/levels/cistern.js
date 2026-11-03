// Level 3. A drained cistern: a vaulted hall of pillars in the middle, its roof stepping up to 9 m down the
// centre, rooms around it, corridors down both sides and two crawls into the hall. One pillar has come down,
// and a drain runs north to south past it: those two are how you tell where you are in a forest of the same
// shape. The creature is awake from the start, and after the second core a gate slams so the short way back
// is gone.

import {LEGEND} from '../world/world.js';
import {box, cyl, sph} from '../world/shapes.js';
import {deco, every, frameX, frameZ, ladder, lockers, pipe, rack, rod, round, run, wheel} from './kit.js';

const ROWS = [17, 21, 25], BROKEN = [28, 25];
const whole = (x, z) => !(x === BROKEN[0] && z === BROKEN[1]);
const pillars = [];
for (const x of [16, 20, 24, 28, 32]) for (const z of ROWS) {
  // a square foot whose corners only just reach where a body can stand beside the round shaft, so it never blocks
  pillars.push(deco(x - 0.53, z - 0.53, x + 0.53, z + 0.53, 0, 0.35));
  if (whole(x, z)) pillars.push(cyl(x, z, 0.45, 0, 6), cyl(x, z, 0.72, 4.7, 5.1));
  // arches to the next pillar along, and across to the next row; the roof over the middle is higher, so those climb further
  if (x < 32 && whole(x, z) && whole(x + 4, z)) pillars.push(...run(0.15, [x + 0.6, 5.05, z], [x + 2, 5.75, z], [x + 3.4, 5.05, z]));
  if (z < 25 && whole(x, z) && whole(x, z + 4)) pillars.push(...run(0.15, [x, 5.05, z + 0.6], [x, 6.5, z + 2], [x, 5.05, z + 3.4]));
}

export default {
  id: 'cistern',
  name: 'Cistern',
  blurb: 'It is already awake. Use the crawls.',
  intro: {touch: 'It is already moving. Listen before you scan.', mouse: 'It is already moving. Listen before you scan.'},
  // '"' 7.5 m and '^' 9 m: the vault over the hall
  legend: {...LEGEND, '"': 7.5, '^': 9},
  map: [
    '#########################',
    '#....#=========#.......##',
    '#....#=========#.......,#',
    '#....,=========,.......##',
    '#....#=========#.......##',
    '##.#######.#########.####',
    '##.#######.#########..###',
    '##.##:::::::::::::##..###',
    '##.##:""""""""""""##.####',
    '##.###^^^^^^^^^^^^;;.####',
    '##.;;;^^^^^^^^^^^^##.####',
    '##.###^^^^^^^^^^^^:#.####',
    '#..###"""""""""""":#.####',
    '#..###::::::::::::##.####',
    '##.########,########.####',
    '#........#....#........##',
    '#........,....,........##',
    '#........#....#........##',
    '#........#....#........##',
    '#########################',
  ],
  start: {x: 8, z: 35.5, yaw: 0},
  exit: {x: 47.3, z: 5},
  exitDoor: {box: [46, 4, 46.25, 6], h: 2.2},
  exitMessage: 'All cores in. The amber gate in the north-east room is open.',
  cores: {count: 3, spots: [[4, 3.5], [27, 3.5], [44, 8.5], [22, 23], [44, 36.5], [24, 36.5]]},
  props: [
    ...pillars,
    // what is left of the broken pillar: a stump, its fallen drum (a box you bump, a round shape you see), its capital, rubble
    cyl(28, 25, 0.45, 0, 2.1), cyl(28.1, 25.05, 0.3, 2.1, 2.6),
    box(28.7, 26.9, 31.3, 27.5, 0.15, 0.7), pipe(28.7, 0.45, 27.2, 31.3, 0.45, 27.2, 0.45), cyl(26.2, 23.4, 0.72, 0, 0.3), sph(28.7, -0.25, 22.9, 0.5),
    // the drain down the middle of the hall, a sump at its south end, silt banked up in two corners, and a stopped inlet on the west wall
    deco(21.5, 14, 21.6, 26.9, 0, 0.12), deco(22.4, 14, 22.5, 26.9, 0, 0.12), ...every(15.5, 25.5, 2, z => deco(21.6, z, 22.4, z + 0.08, 0, 0.1)),
    deco(21.2, 26.9, 22.8, 27, 0, 0.14), deco(21.2, 27.8, 22.8, 27.9, 0, 0.14), deco(21.2, 26.9, 21.3, 27.9, 0, 0.14), deco(22.7, 26.9, 22.8, 27.9, 0, 0.14),
    sph(13.2, -0.45, 27, 1.05), sph(14.6, -0.45, 27.3, 0.8), sph(13.4, -0.45, 15.2, 1), sph(14.6, -0.5, 14.6, 0.9),
    ...round(12, a => deco(10, 16 + Math.sin(a) * 1.25 - 0.22, 10.28, 16 + Math.sin(a) * 1.25 + 0.22, 1.7 + Math.cos(a) * 1.25 - 0.22, 1.7 + Math.cos(a) * 1.25 + 0.22)),
    deco(10, 15.9, 10.2, 16.1, 0.5, 2.9), deco(10, 14.5, 10.2, 17.5, 1.62, 1.78), ...wheel(10.15, 1.1, 14.6, 'x', 0.28),
    // the bay on the east side: rungs up to a hatch, and the rubble that came down through it
    ...ladder(37.88, 24, 'z', 0, 5.6), deco(36.6, 23.3, 37.9, 24.7, 5.82, 6), sph(36.9, -0.4, 22.8, 0.85),
    // the corridors. West carries the big main, east the cables, so you can tell them apart by what is on the wall.
    pipe(4.28, 2.5, 10, 4.28, 2.5, 30, 0.2), ...every(12, 28, 4, z => frameZ(z, 4, 6, 3)),
    ...every(13, 29, 4, z => rod(4.28, z, 0.05, 2.7, 3)),
    deco(41.72, 10, 42, 30, 2.3, 2.4), deco(41.72, 10, 42, 30, 2.62, 2.72), ...every(12, 28, 4, z => frameZ(z, 40, 42, 3)), ...every(11, 29, 6, z => deco(41.74, z, 42, z + 0.5, 1.1, 1.8)),
    // the two side chambers off the corridors, each somewhere to get out of the way
    box(2.3, 27, 3.4, 27.8, 0, 1.3), box(2.4, 24.2, 3.8, 24.9, 0, 0.9), ...wheel(2.15, 1.5, 26, 'x'),
    box(42.6, 15, 43.8, 15.8, 0, 1.3), box(42.3, 12.2, 43.6, 12.9, 0, 0.9), deco(43.72, 13.4, 44, 14.6, 0.8, 2),
    // the short way north out of the hall: a frame and a pipe, and the drain's feeder going down its wall
    ...frameZ(12, 20, 22, 3), pipe(21.8, 2.6, 10, 21.8, 2.6, 13.8, 0.08), pipe(21.8, 2.6, 13.8, 21.8, 0.1, 14.2, 0.08),
    // the crawls
    ...frameX(8, 20, 22, 1.6), ...frameX(10, 20, 22, 1.6), ...frameX(38, 18, 20, 1.6),
    // west room: racks, a filter tank, a crate
    ...rack(8.2, 2.2, 9.6, 6.5, 2.4, 4), box(8.4, 3, 9.4, 3.9, 0.17, 0.7), box(8.4, 4.8, 9.4, 5.8, 1.27, 1.7),
    box(2.4, 8.4, 3.8, 9.6, 0, 1.0), cyl(6.9, 3.2, 0.6, 0, 2.2), ...run(0.09, [6.9, 2.2, 3.2], [6.9, 2.75, 3.2], [2, 2.75, 3.2]), ...frameX(10.2, 6, 8, 2.2),
    // north hall, higher than the rest: pumps on plinths with a header across their heads, a catwalk with a ladder up, crane beams
    cyl(16, 6, 0.8, 0, 0.5), cyl(16, 6, 0.55, 0.5, 2.2), cyl(26, 6, 0.8, 0, 0.5), cyl(26, 6, 0.55, 0.5, 2.2),
    rod(16, 6, 0.16, 2.2, 3.4), rod(26, 6, 0.16, 2.2, 3.4), pipe(16, 3.4, 5.5, 26, 3.4, 5.5, 0.17), pipe(16, 3.4, 6, 16, 3.4, 5.5, 0.14), pipe(26, 3.4, 6, 26, 3.4, 5.5, 0.14), pipe(26, 3.4, 5.5, 29.8, 3.4, 5.5, 0.17), pipe(16, 3.4, 5.5, 12.2, 3.4, 5.5, 0.17),
    deco(12, 8.4, 30, 10, 2.6, 2.72), deco(12, 8.38, 30, 8.42, 3.55, 3.6), ...every(13, 29, 4, x => rod(x, 8.4, 0.03, 2.72, 3.55)), ...ladder(29.88, 9.2, 'z', 0, 2.6),
    deco(17.9, 2, 18.1, 10, 4, 4.3), deco(23.9, 2, 24.1, 10, 4, 4.3), box(20.7, 4.7, 21.3, 5.3, 2.75, 3.4), rod(21, 5, 0.03, 3.4, 4),
    // east room: switchgear with its conduit going up, a transformer with fins, crates to get behind, cable tray over to the gate
    ...lockers(32.3, 2.3, 35.5, 3.1, 4, 2.2), ...every(32.8, 35, 1.1, x => rod(x, 2.5, 0.05, 2.2, 3)),
    box(38, 6.8, 40.2, 9.2, 0, 1.3), ...every(7.1, 8.9, 0.45, z => deco(40.2, z, 40.34, z + 0.1, 0.15, 1.2)),
    box(34.4, 7.2, 35.8, 8.6, 0, 1.2), box(34.6, 7.4, 35.5, 8.3, 1.2, 1.7),
    deco(35.4, 2.4, 46, 2.7, 2.6, 2.7), deco(45.7, 2.4, 46, 3.9, 2.6, 2.7), ...frameX(31.8, 6, 8, 2.2),
    // south-west room (start): crates, the long outflow pipe along its north wall, risers, shelving
    box(13.2, 30.4, 15.6, 31.8, 0, 1.4), box(2.3, 36.2, 4.2, 37.7, 0, 1.0),
    pipe(2, 2.45, 30.35, 13, 2.45, 30.35, 0.22), ...[4, 8.5, 12].map(x => rod(x, 30.2, 0.09, 0, 2.3)), ...rack(6, 37.3, 9.4, 37.85, 2.3, 4), ...frameX(17.8, 32, 34, 2.2),
    // middle room: the gate's frame and its chain, a fallen grate, the sluice wheel on the south wall
    box(21.2, 31.2, 23.4, 31.5, 0, 0.9), ...every(21.4, 23.2, 0.45, x => deco(x, 31.14, x + 0.06, 31.2, 0.9, 1.8)),
    box(22.6, 37.45, 25.4, 38, 0, 0.3), ...wheel(24, 1.7, 37.62, 'z', 1.1, 16), deco(23.88, 37.55, 24.12, 37.7, 0.6, 2.8), deco(22.9, 37.55, 25.1, 37.7, 1.58, 1.82), box(23.7, 37.55, 24.3, 38, 0.3, 0.6),
    // south-east room: tanks domed and joined up, a ladder, a crate
    cyl(34, 34, 1.0, 0, 2.2), sph(34, 2.2, 34, 0.7), cyl(38, 34, 1.0, 0, 2.2), sph(38, 2.2, 34, 0.7), box(42.6, 30.4, 45.6, 31.6, 0, 1.6),
    ...run(0.1, [34, 2.75, 34], [38, 2.75, 34]), ...run(0.1, [38, 2.75, 34], [45.85, 2.75, 34], [45.85, 0, 34]), ...frameX(29.8, 32, 34, 2.2),
    ...ladder(30.12, 36, 'z', 0, 3),
  ],
  doors: [{id: 'gate', box: [22, 29.75, 24, 30], h: 2.2, open: true}],
  notes: [
    {x: 12.8, z: 37, title: 'Operator log, day 6',
      text: 'The cistern is where it sleeps, I think. The pillars throw the hum around, so it cannot tell where you are. Neither can you.\n\nThe crawls on both sides go straight into the hall. It cannot follow you in there.'},
    {x: 36.8, z: 3.6, title: 'Operator log, day 7',
      text: 'Something shut the south gate behind me. I did not hear it walk. The long way round is down the east corridor.\n\nTwice today my footsteps came back to me a beat late. I stopped, and they stopped. When I turned the scanner round, it was there, and it ran. It does not like being seen.'},
  ],
  decals: [
    {x: 28, y: 3.2, z: 14, face: 's', w: 6, h: 1.4, text: 'COUNT TO TEN\nBEFORE YOU SCAN'},
    {x: 12, y: 1.2, z: 24.8, face: 'e', w: 3.2, h: 0.8, text: 'QUIET IS SAFE'},
    {x: 18, y: 1.5, z: 36, face: 'w', w: 2.8, h: 0.9, text: 'IT LEFT LOUD\nIT CAME BACK QUIET'},
  ],
  hides: [{x: 14.4, z: 33.2, r: 0.9}, {x: 44.6, z: 33.2, r: 0.9}, {x: 9, z: 8.2, r: 0.9}, {x: 33.3, z: 8.6, r: 0.9}, {x: 3, z: 26, r: 0.8}, {x: 43, z: 14, r: 0.8}],
  // west-room crate, east-room switchgear, the fallen grate, south-east corner, pillared hall's far corner
  batteries: {spots: [[3.5, 9.0, 1.0], [39.1, 7.1, 1.3], [22.3, 31.35, 0.9], [45.3, 37.3], [35.4, 14.6]]},
  ghosts: [[6, 8], [5, 14], [5, 21], [9, 21], [14, 21], [18, 23], [22, 26.6]],
  triggers: [
    {x: 13, z: 21, r: 2, actions: [['whisper', 34, 26]]},
    {x: 22, z: 6, r: 3, actions: [['steps', 14, 1, 28, 1, 10]]},
    {x: 41, z: 20, r: 1.5, cores: 1, actions: [['silence', 3], ['behind', 2.2]]},
    {x: 24, z: 34, r: 3, cores: 2, delay: 0.8, actions: [['slam', 'gate', 'Close by, a gate slams shut.', 4000]]},
    // you turn round to look at the gate, and there is a hand on it
    {x: 24, z: 34, r: 9, cores: 2, shut: 'gate', delay: 1.8, actions: [['handprints', 22.6, 31, 23.6, 31, 's', 2]]},
  ],
  tune: {hearing: 1.1},
  stalker: {
    spawn: [44, 5], wake: 'start',
    patrol: [[6, 4], [21, 5], [42, 5], [18, 19], [30, 23], [24, 34], [41, 34], [5, 22], [41, 22], [10, 34]],
  },
};
