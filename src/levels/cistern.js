// Level 3. A flooded-out cistern: a pillared hall in the middle, rooms around it, corridors down
// both sides and two crawls into the hall. The creature is awake from the start, and after the second
// core a gate slams so the short way back is gone.

import {box, cyl} from '../world/shapes.js';

const pillars = [];
for (const x of [16, 20, 24, 28, 32]) for (const z of [17, 21, 25]) pillars.push(cyl(x, z, 0.45, 0, 6));

export default {
  id: 'cistern',
  name: 'Cistern',
  blurb: 'It is already awake. Use the crawls.',
  intro: {touch: 'It is already moving. Listen before you scan.', mouse: 'It is already moving. Listen before you scan.'},
  map: [
    '#########################',
    '#....#.........#.......##',
    '#....#.........#.......,#',
    '#....,.........,.......##',
    '#....#.........#.......##',
    '##.#######.#########.####',
    '##.#######.#########.####',
    '##.###::::::::::::##.####',
    '##.###::::::::::::##.####',
    '##.###::::::::::::;;.####',
    '##.;;;::::::::::::##.####',
    '##.###::::::::::::##.####',
    '##.###::::::::::::##.####',
    '##.###::::::::::::##.####',
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
    // west room: racks
    box(8.2, 2.2, 9.6, 6.5, 0, 2.4), box(2.4, 8.4, 3.8, 9.6, 0, 1.0),
    // north hall: pumps on plinths, a catwalk overhead
    cyl(16, 6, 0.8, 0, 0.5), cyl(16, 6, 0.55, 0.5, 2.2), cyl(26, 6, 0.8, 0, 0.5), cyl(26, 6, 0.55, 0.5, 2.2),
    box(12, 8.6, 30, 9.0, 2.6, 2.75),
    // east room: switchgear
    box(32.3, 2.3, 35.5, 3.1, 0, 2.2), box(38, 6.8, 40.2, 9.2, 0, 1.3),
    // south-west room (start): crates
    box(13.2, 30.4, 15.6, 31.8, 0, 1.4), box(2.3, 36.2, 4.2, 37.7, 0, 1.0),
    // middle room: a fallen grate
    box(21.2, 31.2, 23.4, 31.5, 0, 0.9),
    // south-east room: tanks
    cyl(34, 34, 1.0, 0, 2.4), cyl(38, 34, 1.0, 0, 2.4), box(42.6, 30.4, 45.6, 31.6, 0, 1.6),
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
  ],
  hides: [{x: 14.4, z: 33.2, r: 0.9}, {x: 44.6, z: 33.2, r: 0.9}, {x: 9, z: 8.2, r: 0.9}],
  // west-room crate, east-room switchgear, the fallen grate, south-east corner, pillared hall's far corner
  batteries: {spots: [[3.5, 9.0, 1.0], [39.1, 7.1, 1.3], [22.3, 31.35, 0.9], [45.3, 37.3], [35.4, 14.6]]},
  ghosts: [[6, 8], [5, 14], [5, 21], [9, 21], [14, 21], [18, 23], [22, 26.6]],
  triggers: [
    {x: 13, z: 21, r: 2, actions: [['whisper', 34, 26]]},
    {x: 22, z: 6, r: 3, actions: [['steps', 14, 1, 28, 1, 10]]},
    {x: 41, z: 20, r: 1.5, cores: 1, actions: [['silence', 3], ['behind', 2.2]]},
    {x: 24, z: 34, r: 3, cores: 2, delay: 0.8, actions: [['slam', 'gate'], ['say', 'Behind you, a gate slams shut.', 4000]]},
  ],
  stalker: {
    spawn: [44, 5], wake: 'start',
    patrol: [[6, 4], [21, 5], [42, 5], [18, 19], [30, 23], [24, 34], [41, 34], [5, 22], [41, 22], [10, 34]],
  },
};
