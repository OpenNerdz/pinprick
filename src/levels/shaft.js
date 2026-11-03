// Level 4. Four cores spread across a wide level, the creature awake from the start, and a long run
// to the lift in the far north-east corner once it knows where you are. The lift goes to level 5.
// The west hall is the old shaft, open 18 m up: stand under it and scan, and there is a cage hanging up there
// in its scaffold. The east hall is the winding engine that used to work it. The middle is a service ring
// round the dead lift's core, and the long room to the south is where the cages were loaded, its rails on the floor.

import {LEGEND} from '../world/world.js';
import {box, cyl, sph} from '../world/shapes.js';
import {deco, every, frameX, frameZ, ladder, lockers, pipe, rack, rod, round, run, wheel} from './kit.js';

// the old shaft's scaffold, centred on (8, 20): four legs, three decks with a hole in the middle you can see up
// through, a brace on each face, the guide rails, the counterweight and the cage hanging high in it
const scaffold = [
  ...[[5, 17], [11, 17], [5, 23], [11, 23]].map(([x, z]) => cyl(x, z, 0.15, 0, 15)),
  ...[3.6, 7.2, 10.8].flatMap(y => [
    box(4.5, 16.5, 11.5, 18, y, y + 0.16), box(4.5, 22, 11.5, 23.5, y, y + 0.16), box(4.5, 18, 6, 22, y, y + 0.16), box(10, 18, 11.5, 22, y, y + 0.16),
  ]),
  ...[[0.2, 3.6], [3.76, 7.2], [7.36, 10.8], [10.96, 14.4]].flatMap(([a, b], i) => {
    const f = i % 2, y0 = f ? b : a, y1 = f ? a : b;
    return [
      pipe(5, Math.max(y0, 1.9), 17, 11, Math.max(y1, 1.9), 17, 0.05), pipe(5, Math.max(y1, 1.9), 23, 11, Math.max(y0, 1.9), 23, 0.05),
      pipe(5, Math.max(y1, 1.9), 17, 5, Math.max(y0, 1.9), 23, 0.05), pipe(11, Math.max(y0, 1.9), 17, 11, Math.max(y1, 1.9), 23, 0.05),
    ];
  }),
  // guide rails, and the buffers on the floor they end at
  cyl(8, 18.1, 0.1, 0, 18), cyl(8, 21.9, 0.1, 0, 18), cyl(7.5, 20.6, 0.2, 0, 0.55), cyl(8.5, 20.6, 0.2, 0, 0.55),
  deco(6, 18, 10, 18.08, 0, 0.1), deco(6, 21.92, 10, 22, 0, 0.1), deco(6, 18, 6.08, 22, 0, 0.1), deco(9.92, 18, 10, 22, 0, 0.1),
  // the counterweight, partway up
  deco(9.1, 21.1, 9.8, 21.8, 4.6, 7), rod(9.45, 21.45, 0.05, 7, 17),
  // the cage: floor, roof, a bar every so often, a sling and cables up to the beams at the top
  deco(6.6, 18.6, 9.4, 21.4, 12.6, 12.76), deco(6.6, 18.6, 9.4, 21.4, 15, 15.12),
  ...every(6.6, 9.3, 0.7, x => [deco(x, 18.6, x + 0.1, 18.7, 12.76, 15), deco(x, 21.3, x + 0.1, 21.4, 12.76, 15)]),
  ...every(19.3, 20.7, 0.7, z => [deco(6.6, z, 6.7, z + 0.1, 12.76, 15), deco(9.3, z, 9.4, z + 0.1, 12.76, 15)]),
  rod(7.6, 20, 0.05, 15.12, 16.9), rod(8.4, 20, 0.05, 15.12, 16.9),
  deco(4, 19.7, 12, 20.3, 16.9, 17.3), deco(4, 16.9, 12, 17.3, 15.6, 16), deco(4, 22.7, 12, 23.1, 15.6, 16),
];

export default {
  id: 'shaft',
  name: 'Lift Shaft',
  blurb: 'Four cores, then the lift. The long way up.',
  intro: {touch: 'Four cores. The lift is in the far corner.', mouse: 'Four cores. The lift is in the far corner.'},
  // '^' 18 m: the old shaft
  legend: {...LEGEND, '^': 18},
  map: [
    '##########################',
    '#.....#..........#......##',
    '#.....,..........,......,#',
    '#.....#..........#......##',
    '###.######.#########.#####',
    '###.######.#########.#####',
    '###.######.#########.#####',
    '#:::::::#......#:::::::::#',
    '#:^^^^::;......#:::::::::#',
    '#:^^^^::#.####.,:::::::::#',
    '#:^^^^::,.####.#:::::::::#',
    '#:^^^^::#.####.#:::::::::#',
    '#:::::::#......#:::::::::#',
    '#:::::::#......#:::::::::#',
    '####.#######.#########.###',
    '####.#######.#########.###',
    '#......#..........#......#',
    '#......,..........,......#',
    '#......#..........#......#',
    '#......#..........#......#',
    '##########################',
  ],
  start: {x: 5, z: 37, yaw: 0},
  exit: {x: 49.3, z: 5},
  exitDoor: {box: [48, 4, 48.25, 6], h: 2.2},
  exitMessage: 'Four cores. The lift door in the north-east corner is open.',
  finaleMessage: 'It knows where you are. Run for the lift.',
  cores: {count: 4, spots: [[4, 3.5], [24, 3.2], [40, 3.5], [6, 20], [24, 26], [40, 22], [46, 36], [22, 37]]},
  props: [
    // north-west room: a crate, shelving, a door frame
    box(2.3, 5.0, 5.6, 6.2, 0, 1.2), ...rack(7, 2.2, 11, 2.8, 2.3, 4), box(7.6, 2.3, 8.6, 2.7, 0.72, 1.1), ...frameX(11.7, 4, 6, 2.2),
    // north gallery: columns, two piers to get behind, cross beams, a bench, cable tray
    cyl(18, 3, 0.35, 0, 3), cyl(26, 3, 0.35, 0, 3), cyl(30, 5, 0.35, 0, 3),
    box(21, 2, 21.3, 3.5, 0, 3), box(29, 2, 29.3, 3.5, 0, 3),
    ...every(16, 32, 4, x => deco(x - 0.1, 2, x + 0.1, 8, 2.65, 2.9)), deco(14, 7.7, 34, 8, 2.4, 2.5), box(15, 2.2, 17, 2.7, 0, 0.45), ...frameX(33.5, 4, 6, 2.2),
    // north-east room: the lift lobby. Winding gear with its cables going up, a crate, a bench, a tray of cable to
    // the door, a floor dial above it, and the cage's bars past the door.
    box(42.4, 2.3, 45.6, 3.4, 0, 2.6), box(36.4, 6.6, 38.6, 7.7, 0, 1.0), rod(43.2, 2.85, 0.06, 2.6, 3), rod(44.8, 2.85, 0.06, 2.6, 3), ...wheel(42.32, 1.5, 2.85, 'x', 0.42, 10),
    deco(36, 3.6, 48, 3.9, 2.6, 2.7), box(39, 2.2, 41, 2.7, 0, 0.45), deco(47.74, 3.2, 48, 3.7, 1.1, 1.6),
    ...round(7, (a, i) => deco(47.76, 5 + Math.cos(i / 6 * Math.PI) * 0.75 - 0.05, 48, 5 + Math.cos(i / 6 * Math.PI) * 0.75 + 0.05, 2.45 + Math.sin(i / 6 * Math.PI) * 0.4, 2.55 + Math.sin(i / 6 * Math.PI) * 0.4)),
    ...every(48.4, 49.8, 0.35, x => [rod(x, 4.08, 0.035, 0, 2.2), rod(x, 5.92, 0.035, 0, 2.2)]), rod(49.92, 4.5, 0.035, 0, 2.2), rod(49.92, 5.5, 0.035, 0, 2.2),
    // the corridors between the floors
    ...[[6, 8], [20, 22], [40, 42]].flatMap(([a, b]) => [...frameZ(9.5, a, b, 3), ...frameZ(12, a, b, 3)]),
    ...[[8, 10], [24, 26], [44, 46]].flatMap(([a, b]) => frameZ(29.5, a, b, 3)),
    deco(7.84, 8, 8, 14, 2.3, 2.42), pipe(20.2, 2.6, 8, 20.2, 2.6, 14, 0.08), deco(41.84, 8, 42, 14, 2.3, 2.42), pipe(8.2, 2.6, 28, 8.2, 2.6, 32, 0.08), pipe(45.8, 2.6, 28, 45.8, 2.6, 32, 0.08),
    // the old shaft
    ...scaffold,
    box(2.3, 25.5, 4.6, 27.6, 0, 1.6), box(12.4, 14.4, 15.6, 15.6, 0, 0.8),
    ...ladder(2.12, 15.5, 'z', 0, 5.6), ...[14.8, 18.8, 22.8, 26.4].map(z => deco(15.72, z, 16, z + 0.4, 0, 6)), deco(2, 14.14, 16, 14.3, 5.3, 5.6), deco(2, 27.7, 16, 27.86, 5.3, 5.6),
    // the winding engine hall: turbines piped through the walls, the winding drum on its bed with its rope going off
    // north to the lift, a travelling crane overhead
    cyl(38, 18, 1.4, 0, 1.0), sph(38, 2.2, 18, 1.2), cyl(44, 24, 1.4, 0, 1.0), sph(44, 2.2, 24, 1.2),
    pipe(38, 3.1, 18, 32.35, 3.1, 18, 0.3), pipe(44, 3.1, 24, 49.9, 3.1, 24, 0.3), rod(38, 18, 0.14, 3.2, 6), rod(44, 24, 0.14, 3.2, 6),
    box(46.2, 14.3, 49.6, 15.4, 0, 1.8),
    box(47.1, 18.2, 49.6, 22, 0, 0.95), pipe(48.3, 2, 18.5, 48.3, 2, 21.7, 0.95), box(46.7, 18.6, 47.1, 19.2, 0, 2.6), box(46.7, 21, 47.1, 21.6, 0, 2.6),
    ...run(0.07, [48.3, 3, 19.6], [46, 3.9, 18], [43.7, 4.8, 16.2], [41, 5.7, 14.3]),
    deco(32, 14.1, 50, 14.4, 4.6, 4.9), deco(32, 27.6, 50, 27.9, 4.6, 4.9), deco(40.8, 14.1, 41.2, 27.9, 4.4, 4.9), box(40.7, 21.7, 41.3, 22.3, 2.6, 3.1), rod(41, 22, 0.03, 3.1, 4.4),
    // the service ring round the dead lift: its sealed doors, cable tray and pipe, junction boxes, a cart
    ...[[17.72, 18], [24, 24.28]].flatMap(([z0, z1]) => [deco(22, z0, 24, z1, 0, 2.5), deco(24.04, z0, 26, z1, 0, 2.5), deco(21.7, z0, 26.3, z1, 2.5, 2.8)]),
    ...every(0, 5, 1, i => deco(24.9 + i * 0.1, 17.68, 24.96 + i * 0.1, 17.72, 2.56 + (i % 3) * 0.04, 2.7)),
    ...run(0.08, [18.2, 2.65, 14.2], [29.8, 2.65, 14.2], [29.8, 2.65, 27.8], [18.2, 2.65, 27.8], [18.2, 2.65, 14.2]),
    deco(19.84, 18, 20, 24, 2.25, 2.35), deco(28, 18, 28.16, 24, 2.25, 2.35),
    deco(19.72, 19, 20, 19.9, 1, 1.9), deco(28, 22, 28.28, 22.9, 1, 1.9), deco(24.5, 14, 25.5, 14.28, 1, 1.9),
    box(21, 24.5, 22.4, 25.3, 0.25, 0.85), box(21.05, 24.55, 21.2, 24.7, 0, 0.25), box(22.2, 24.55, 22.35, 24.7, 0, 0.25), box(21.05, 25.1, 21.2, 25.25, 0, 0.25), box(22.2, 25.1, 22.35, 25.25, 0, 0.25),
    box(18.3, 14.3, 19.5, 15.3, 0, 1),
    // south-west start room: a crate, lockers, a bench
    box(10.3, 32.3, 13.6, 33.6, 0, 1.0), ...lockers(2.2, 38.2, 7, 38.8, 6, 2.1), box(3, 36, 5, 36.45, 0, 0.45), ...frameX(13.7, 34, 36, 2.2),
    // the loading bay: benches, the statue's plinth, rails let into the floor end to end, a trolley, a monorail with
    // two hoists overhead, piers, lockers, and crates to get behind
    box(17, 34.2, 21, 34.7, 0, 0.45), box(26, 38.3, 31, 38.8, 0, 0.45), box(23.6, 34, 24.4, 34.8, 0, 0.9),
    deco(16, 36.7, 36, 36.78, 0, 0.05), deco(16, 37.5, 36, 37.58, 0, 0.05), ...every(17, 35, 2, x => deco(x, 36.6, x + 0.16, 37.7, 0, 0.03)),
    box(31.6, 36.5, 33.8, 37.8, 0.3, 0.9), ...[[31.8, 36.7], [33.6, 36.7], [31.8, 37.6], [33.6, 37.6]].map(([x, z]) => cyl(x, z, 0.13, 0, 0.3)), box(32, 36.8, 33.2, 37.5, 0.9, 1.5),
    deco(16, 37.05, 36, 37.2, 2.6, 2.75), ...every(18, 34, 4, x => [deco(x - 0.05, 37.05, x + 0.05, 37.2, 2.75, 3), deco(x - 0.14, 39.72, x + 0.14, 40, 0, 3)]), ...every(26, 34, 4, x => deco(x - 0.14, 32, x + 0.14, 32.28, 0, 3)),
    box(21, 36.9, 21.5, 37.35, 2.15, 2.6), box(29, 36.9, 29.5, 37.35, 1.95, 2.4), rod(29.25, 37.12, 0.03, 2.4, 2.6),
    ...lockers(29, 32.2, 33, 32.8, 5, 2.1), box(17, 37.9, 18.6, 38.9, 0, 1.3), box(17.2, 38, 18.2, 38.8, 1.3, 1.8), ...frameX(35.5, 34, 36, 2.2),
    // south-east room: crates, a spare cage standing on end, pipe
    box(46.4, 32.3, 49.6, 33.4, 0, 1.4), box(38.4, 37, 40.6, 38.6, 0, 1.2),
    box(43, 37.2, 45.6, 39.6, 0, 0.14), box(43, 37.2, 45.6, 39.6, 2.5, 2.62), ...every(43, 45.4, 0.6, x => [box(x, 37.2, x + 0.1, 37.3, 0, 2.5), box(x, 39.5, x + 0.1, 39.6, 0, 2.5)]), ...every(37.8, 39, 0.6, z => [box(43, z, 43.1, z + 0.1, 0, 2.5), box(45.5, z, 45.6, z + 0.1, 0, 2.5)]),
    pipe(38.2, 2.6, 32.2, 49.8, 2.6, 32.2, 0.08),
  ],
  statue: {x: 24, z: 34.4, face: Math.PI, lift: 0.9},
  doors: [{id: 'gallery-west', box: [12.9, 4, 13.1, 6], h: 2.2, open: true}],
  notes: [
    {x: 9.5, z: 36.5, title: 'Operator log, day 9',
      text: 'The lift still works. I heard it run once, the whole cage rattling up the shaft. It is in the north-east corner, behind the amber door.\n\nThe door wants four cores.'},
    {x: 29.4, z: 25.7, title: 'Operator log, last',
      text: 'I could not get the fourth core. It was standing over it.\n\nIf you are reading this: it follows the hum. Let go of the trigger and let it walk past. If your steps sound doubled, it is behind you. Stand still until the clicking stops, or turn and give it the light.'},
    {x: 13.6, z: 16.8, title: 'Operator log, day 8',
      text: 'It goes to where a stone lands. I have got past it twice that way, throwing over its head.\n\nThe second time it stopped halfway and turned back toward me before it went. I do not think there is a third.'},
  ],
  decals: [
    {x: 20, y: 1.6, z: 32, face: 's', w: 5.6, h: 1.1, text: 'THE LIFT STILL WORKS'},
    {x: 32, y: 3.0, z: 22.6, face: 'e', w: 4.6, h: 1.2, text: 'IT FOLLOWS THE HUM'},
    {x: 2, y: 2.4, z: 20, face: 'e', w: 4.4, h: 0.9, text: 'NOT THIS CAGE'},
  ],
  hides: [{x: 3.5, z: 24.4, r: 0.9}, {x: 48.6, z: 34.4, r: 0.9}, {x: 47.8, z: 16.4, r: 0.9}, {x: 3.5, z: 7.2, r: 0.8}, {x: 30.1, z: 2.9, r: 0.8}, {x: 18, z: 39.3, r: 0.8}],
  // long-room bench, south-east crate, east hall corner, west-shaft crate, lift-room machinery, middle room
  batteries: {spots: [[19, 34.45, 0.45], [39.5, 38.35, 1.2], [34.0, 27.4], [14, 15.35, 0.8], [37.5, 6.85, 1.0], [29.2, 14.8]]},
  ghosts: [[5, 34], [9, 29], [9, 22], [16, 17], [19, 15], [23, 15], [29, 15], [31, 18.5]],
  triggers: [
    {x: 19, z: 21, r: 1.5, cores: 2, actions: [['silence', 3], ['behind', 2.4]]},
    {x: 40, z: 20, r: 4, actions: [['whisper', 48, 26]]},
    {x: 24, z: 4, r: 3, actions: [['steps', 14, 1, 34, 1, 12]]},
    {x: 22, z: 4, r: 4, cores: 3, delay: 0.5, actions: [['slam', 'gallery-west', 'At the end of the gallery, a door slams.', 3500]]},
    {x: 24, z: 30, r: 2, cores: 1, actions: [['statue', 15.2, 34.4, Math.PI / 2, 0]]},
    // the operator's colour, fresh, coming through the door from the next room. They left here long ago.
    {x: 33, z: 35, r: 1.8, cores: 3, look: [40, 35], actions: [['phantom', 46, 35, 41, 35, 2.6]]},
  ],
  tune: {hearing: 1.18, sonar: 1.12},
  stalker: {
    spawn: [40, 20], wake: 'start',
    patrol: [[4, 4], [24, 4.5], [42, 5], [9, 20], [24, 16], [26.5, 26.5], [40, 26], [6, 36], [24, 36.5], [44, 36]],
  },
  ending: 'The amber door shuts behind you and the cage starts to move. You keep the scanner off. It is a long time before you are sure: you are going down.',
};
