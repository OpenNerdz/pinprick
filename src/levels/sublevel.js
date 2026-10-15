// Level 2. The original Pinprick map, now with a loop through the gallery, a crawl from the store to
// the gallery, and the creature. It wakes when you lift the first core.

import {box, cyl, sph} from '../world/shapes.js';

export default {
  id: 'sublevel',
  name: 'Sublevel',
  blurb: 'Three cores somewhere in the dark. Something wakes when you take the first.',
  intro: {touch: 'Three cores this time. Move quietly.', mouse: 'Three cores this time. Move quietly.'},
  map: [
    '###################',
    '##...........######',
    '##...........######',
    '##...........,....#',
    '###;#####.####....#',
    '###;#####.####....#',
    '#....#:::::::#....#',
    '#....#:::::::##,###',
    '#....#:::::::##,###',
    '#....,:::::::,,,###',
    '#....#:::::::######',
    '#....#:::::::######',
    '#....#:::::::######',
    '#########.#########',
    '#########.#..######',
    '#########....######',
    '#########.#..######',
    '########...########',
    '########...########',
    '########...########',
    '###################',
  ],
  start: {x: 19, z: 37, yaw: 0},
  exit: {x: 24.4, z: 31},
  exitDoor: {box: [20, 30, 20.25, 32], h: 3},
  cores: {count: 3, spots: [[3, 24.6], [30, 7.4], [5.2, 5], [21, 3.2], [13.2, 13.2], [35, 13]]},
  props: [
    // start room
    box(16.3, 34.3, 17.3, 35.3, 0, 0.9), box(21.4, 34.2, 21.9, 35.6, 0, 2.0), cyl(21.3, 39.3, 0.35, 0, 1.0),
    // hall: four pillars, two beams, a tank on a plinth, crates in the far corner
    cyl(15.5, 15.5, 0.5, 0, 6), cyl(22.5, 15.5, 0.5, 0, 6), cyl(15.5, 22.5, 0.5, 0, 6), cyl(22.5, 22.5, 0.5, 0, 6),
    box(12, 15.3, 26, 15.7, 5.0, 5.4), box(12, 22.3, 26, 22.7, 5.0, 5.4),
    cyl(19, 19, 1.0, 0, 0.65), sph(19, 1.9, 19, 1.25),
    box(23.6, 24.4, 25.8, 25.8, 0, 1.5), box(24.0, 24.6, 25.4, 25.5, 1.5, 2.2),
    // west store: shelving, crates, barrels
    box(4.6, 13.5, 5.2, 18.5, 0, 2.4), box(7.2, 16.2, 8.8, 17.8, 0, 1.6),
    box(7.6, 20.4, 8.6, 21.4, 0, 1.0), box(7.8, 20.6, 8.4, 21.2, 1.0, 1.6),
    box(2.2, 19.0, 3.4, 20.2, 0, 1.2), box(4.5, 22.0, 6.5, 23.0, 0, 1.8), box(2.2, 14.0, 3.0, 15.6, 0, 0.9),
    cyl(6.2, 25.0, 0.35, 0, 1.0), cyl(7.0, 25.3, 0.35, 0, 1.0), cyl(6.6, 24.3, 0.35, 0, 1.0),
    // east pump room: tanks and pipes
    cyl(34.2, 8.0, 0.5, 0, 0.5), sph(34.2, 1.55, 8.0, 1.15),
    cyl(34.2, 11.4, 0.5, 0, 0.5), sph(34.2, 1.55, 11.4, 1.15),
    cyl(29.2, 11.8, 0.4, 0, 0.5), sph(29.2, 1.3, 11.8, 0.9),
    cyl(28.3, 7.0, 0.12, 0, 3), cyl(28.3, 7.5, 0.12, 0, 3), cyl(28.3, 8.0, 0.12, 0, 3),
    box(28, 9.6, 36, 9.8, 2.45, 2.65), box(31.5, 6.1, 32.3, 6.6, 0, 1.1),
    // north gallery: columns, benches, the statue's pedestal
    cyl(7.5, 3.4, 0.3, 0, 3), cyl(7.5, 6.6, 0.3, 0, 3), cyl(11.5, 3.4, 0.3, 0, 3), cyl(11.5, 6.6, 0.3, 0, 3),
    cyl(15.5, 3.4, 0.3, 0, 3), cyl(15.5, 6.6, 0.3, 0, 3), cyl(22.5, 3.4, 0.3, 0, 3), cyl(22.5, 6.6, 0.3, 0, 3),
    box(9, 2.1, 11, 2.6, 0, 0.45), box(13, 7.4, 15, 7.9, 0, 0.45),
    box(24.2, 4.6, 25.0, 5.4, 0, 0.9),
  ],
  statue: {x: 24.6, z: 5.0, face: Math.PI, lift: 0.9},
  notes: [
    {x: 13.4, z: 24.6, title: 'Operator log, day 3',
      text: 'It does not see. I am sure of that now. It came down the hall while I stood still with the scanner off, and it walked straight past me.\n\nIt was listening.'},
    {x: 16.8, z: 7.2, title: 'Operator log, day 4',
      text: 'Do not hold the trigger for long. The hum carries. The sweep is worse: it hears that from anywhere on the level.\n\nWhen the signal fills with static, it is close. Stop, crouch, wait.'},
  ],
  decals: [
    {x: 12, y: 2.1, z: 14.6, face: 'e', w: 3.2, h: 0.9, text: "DON'T RUN"},
    {x: 4, y: 1.6, z: 12, face: 's', w: 3.2, h: 1.0, text: "IT WON'T FIT\nIN THE CRAWL"},
  ],
  hides: [{x: 3.4, z: 16.6, r: 1.0}, {x: 35.3, z: 9.7, r: 0.8}, {x: 25.2, z: 23.6, r: 0.9}],
  ghosts: [[19, 33], [19, 27], [16.5, 25], [12, 19], [7, 19], [3.6, 13], [7, 10], [7, 6.8], [4.2, 3.4]],
  triggers: [
    {x: 19, z: 24, r: 3, actions: [['steps', 11, 14, 11, 24, 9]]},
    {x: 19, z: 9.8, r: 1.3, actions: [['statue', 19, 6.6, Math.PI, 0]]},
    {x: 19, z: 13.5, r: 2.5, cores: 2, actions: [['statue', 19, 12.8, Math.PI, 0]]},
    {x: 6, z: 21, r: 2, cores: 1, delay: 0.6, actions: [['silence', 4], ['behind', 2.4]]},
    {x: 10, z: 4.5, r: 2, actions: [['whisper', 2.6, 3]]},
  ],
  stalker: {
    spawn: [31, 12], wake: 'core:1',
    patrol: [[31, 10], [20, 4.5], [8, 4.5], [6, 20], [14, 13.6], [24.5, 21], [19, 28.5], [33, 6.8]],
  },
};
