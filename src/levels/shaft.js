// Level 4, the last one. Four cores spread across a wide level, the creature awake from the start,
// and a long run to the lift in the far north-east corner once it knows where you are.

import {box, cyl, sph} from '../world/shapes.js';

export default {
  id: 'shaft',
  name: 'Lift Shaft',
  blurb: 'Four cores, then the lift. The long way up.',
  intro: {touch: 'Four cores. The lift is in the far corner.', mouse: 'Four cores. The lift is in the far corner.'},
  map: [
    '##########################',
    '#.....#..........#......##',
    '#.....,..........,......,#',
    '#.....#..........#......##',
    '###.######.#########.#####',
    '###.######.#########.#####',
    '###.######.#########.#####',
    '#:::::::#......#:::::::::#',
    '#:::::::;......#:::::::::#',
    '#:::::::#.####.,:::::::::#',
    '#:::::::,.####.#:::::::::#',
    '#:::::::#.####.#:::::::::#',
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
    // north-west room
    box(2.3, 5.0, 5.6, 6.2, 0, 1.2),
    // north gallery: columns
    cyl(18, 3, 0.35, 0, 3), cyl(26, 3, 0.35, 0, 3), cyl(30, 5, 0.35, 0, 3),
    // north-east room: lift machinery
    box(42.4, 2.3, 45.6, 3.4, 0, 2.6), box(36.4, 6.6, 38.6, 7.7, 0, 1.0),
    // west shaft: scaffold legs, crates, a hanging cage
    cyl(5, 17, 0.15, 0, 6), cyl(11, 17, 0.15, 0, 6), cyl(5, 23, 0.15, 0, 6), cyl(11, 23, 0.15, 0, 6),
    box(4.5, 16.5, 11.5, 23.5, 3.6, 3.8),
    box(2.3, 25.5, 4.6, 27.6, 0, 1.6), box(12.4, 14.4, 15.6, 15.6, 0, 0.8),
    // east hall: turbines
    cyl(38, 18, 1.4, 0, 1.0), sph(38, 2.2, 18, 1.2), cyl(44, 24, 1.4, 0, 1.0), sph(44, 2.2, 24, 1.2),
    box(46.2, 14.3, 49.6, 15.4, 0, 1.8),
    // south-west start room
    box(10.3, 32.3, 13.6, 33.6, 0, 1.0),
    // long room: benches and the statue's plinth
    box(17, 34.2, 21, 34.7, 0, 0.45), box(26, 38.3, 31, 38.8, 0, 0.45), box(23.6, 34, 24.4, 34.8, 0, 0.9),
    // south-east room: crates
    box(46.4, 32.3, 49.6, 33.4, 0, 1.4), box(38.4, 37, 40.6, 38.6, 0, 1.2),
  ],
  statue: {x: 24, z: 34.4, face: Math.PI, lift: 0.9},
  doors: [{id: 'gallery-west', box: [12.9, 4, 13.1, 6], h: 2.2, open: true}],
  notes: [
    {x: 9.5, z: 36.5, title: 'Operator log, day 9',
      text: 'The lift still works. I heard it run once, the whole cage rattling up the shaft. It is in the north-east corner, behind the amber door.\n\nThe door wants four cores.'},
    {x: 30.2, z: 25.7, title: 'Operator log, last',
      text: 'I could not get the fourth core. It was standing over it.\n\nIf you are reading this: it follows the hum. Let go of the trigger and let it walk past. If your steps sound doubled, it is behind you. Stand still until the clicking stops, or turn and give it the light.'},
  ],
  decals: [
    {x: 20, y: 1.6, z: 32, face: 's', w: 5.6, h: 1.1, text: 'THE LIFT STILL WORKS'},
    {x: 32, y: 3.0, z: 22.6, face: 'e', w: 4.6, h: 1.2, text: 'IT FOLLOWS THE HUM'},
  ],
  hides: [{x: 3.5, z: 24.4, r: 0.9}, {x: 48.6, z: 34.4, r: 0.9}, {x: 47.8, z: 16.4, r: 0.9}, {x: 3.5, z: 7.2, r: 0.8}],
  // long-room bench, south-east crate, east hall corner, west-shaft crate, lift-room machinery, middle room
  batteries: {spots: [[19, 34.45, 0.45], [39.5, 38.35, 1.2], [34.0, 27.4], [14, 15.35, 0.8], [37.5, 6.85, 1.0], [29.2, 14.8]]},
  ghosts: [[5, 34], [9, 29], [9, 22], [16, 17], [19, 15], [23, 15], [29, 15], [31, 18.5]],
  triggers: [
    {x: 19, z: 21, r: 1.5, cores: 2, actions: [['silence', 3], ['behind', 2.4]]},
    {x: 40, z: 20, r: 4, actions: [['whisper', 48, 26]]},
    {x: 24, z: 4, r: 3, actions: [['steps', 14, 1, 34, 1, 12]]},
    {x: 22, z: 4, r: 4, cores: 3, delay: 0.5, actions: [['slam', 'gallery-west'], ['say', 'The door behind you slams.', 3500]]},
    {x: 24, z: 30, r: 2, cores: 1, actions: [['statue', 15.2, 34.4, Math.PI / 2, 0]]},
  ],
  stalker: {
    spawn: [40, 20], wake: 'start',
    patrol: [[4, 4], [24, 4.5], [42, 5], [9, 20], [24, 16], [24, 26], [40, 26], [6, 36], [24, 36.5], [44, 36]],
  },
  ending: 'The lift climbs for a long time. Nothing follows. You keep the scanner off the whole way up.',
};
