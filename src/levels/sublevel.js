// Level 2. The original Pinprick map, now with a loop through the gallery, a crawl from the store to
// the gallery, and the creature. It wakes when you lift the first core.

import {box, cyl, sph} from '../world/shapes.js';
import {deco, every, frameX, frameZ, ladder, pipe, rack, rod, run, wheel} from './kit.js';

// the main: from the dead generator in the first room, up the corridor, along the hall's south wall and over to the tank
const main = run(0.09,
  [17.2, 2.7, 38.8], [16.3, 2.7, 39.8], [21.8, 2.7, 39.8], [21.8, 2.7, 34.2], [19.85, 2.7, 34.2], [19.85, 2.7, 26],
  [25.85, 2.7, 25.85], [25.85, 4.5, 25.85], [25.85, 4.5, 19]);

export default {
  id: 'sublevel',
  name: 'Sublevel',
  blurb: 'Three cores somewhere in the dark. Something wakes when you take the first.',
  intro: {touch: 'Three cores this time. Move quietly. If the walls turn red, freeze.', mouse: 'Three cores this time. Move quietly. If the walls turn red, freeze.'},
  map: [
    '###################',
    '##...........######',
    '##...........######',
    '##...........,....#',
    '###;#..##.####....#',
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
    ...main,
    // start room: a crate, shelving, a drum, the dead generator with its exhaust going up into the main
    box(16.3, 34.3, 17.3, 35.3, 0, 0.9), ...rack(21.4, 34.2, 21.9, 35.6, 2.0, 3), cyl(21.3, 39.3, 0.35, 0, 1.0),
    box(16.3, 37.9, 18.1, 39.7, 0, 0.8), cyl(17.2, 38.8, 0.55, 0.8, 1.5), rod(17.2, 38.8, 0.09, 1.5, 2.7),
    // the corridor north, and the amber door's room: shelving, the hatch the exit goes down, its ladder rails
    ...frameZ(27.4, 18, 20, 3), ...frameZ(29.3, 18, 20, 3), ...frameZ(33, 18, 20, 3),
    ...rack(25.3, 28.2, 25.85, 30, 2.3, 4), ...rack(25.3, 32, 25.85, 33.8, 2.3, 4),
    deco(23.4, 30, 25.4, 30.1, 0, 0.1), deco(23.4, 31.9, 25.4, 32, 0, 0.1), deco(23.4, 30, 23.5, 32, 0, 0.1), deco(25.3, 30, 25.4, 32, 0, 0.1),
    cyl(25.2, 30.6, 0.04, 0, 1.0), cyl(25.2, 31.4, 0.04, 0, 1.0),
    // hall: four pillars and a square of beams, a tank on a plinth piped into the main, its valve, crates in the far
    // corner, risers on the east wall, and a catwalk you can't reach down the west side
    cyl(15.5, 15.5, 0.5, 0, 6), cyl(22.5, 15.5, 0.5, 0, 6), cyl(15.5, 22.5, 0.5, 0, 6), cyl(22.5, 22.5, 0.5, 0, 6),
    box(12, 15.3, 26, 15.7, 5.0, 5.4), box(12, 22.3, 26, 22.7, 5.0, 5.4), box(15.3, 12, 15.7, 26, 5.0, 5.4), box(22.3, 12, 22.7, 26, 5.0, 5.4),
    cyl(19, 19, 1.0, 0, 0.65), sph(19, 1.9, 19, 1.25), ...run(0.14, [19, 3.1, 19], [19, 4.5, 19], [25.85, 4.5, 19]),
    cyl(21.2, 21, 0.06, 0, 1.1), box(20.9, 20.97, 21.5, 21.03, 1.1, 1.14), box(21.17, 20.7, 21.23, 21.3, 1.1, 1.14),
    box(23.6, 24.4, 25.8, 25.8, 0, 1.5), box(24.0, 24.6, 25.4, 25.5, 1.5, 2.2),
    box(23.9, 12.3, 24.9, 13.1, 0, 0.9),
    ...[14, 16.2, 23.4].map(z => rod(25.85, z, 0.11, 0, 6)),
    deco(12, 12, 13.2, 26, 3.2, 3.3), deco(13.17, 12, 13.2, 26, 4.2, 4.25), ...every(14, 26, 3, z => rod(13.18, z, 0.03, 3.3, 4.2)),
    ...every(14, 26, 4, z => pipe(12, 2.5, z, 13.1, 3.2, z, 0.04)), ...ladder(12.12, 25.2, 'z', 0, 3.3),
    // west store: shelving, crates, barrels, beams across the roof, the main's branch along the east wall
    ...rack(4.6, 13.5, 5.2, 18.5, 2.4, 5), box(4.7, 14, 5.1, 15, 0.17, 0.6), box(4.7, 16.5, 5.1, 17.4, 1.05, 1.5), box(7.2, 16.2, 8.8, 17.8, 0, 1.6),
    box(7.6, 20.4, 8.6, 21.4, 0, 1.0), box(7.8, 20.6, 8.4, 21.2, 1.0, 1.6),
    box(2.2, 19.0, 3.4, 20.2, 0, 1.2), box(4.5, 22.0, 6.5, 23.0, 0, 1.8), box(2.2, 14.0, 3.0, 15.6, 0, 0.9),
    cyl(6.2, 25.0, 0.35, 0, 1.0), cyl(7.0, 25.3, 0.35, 0, 1.0), cyl(6.6, 24.3, 0.35, 0, 1.0),
    ...every(15, 24, 4.5, z => deco(2, z, 10, z + 0.2, 2.65, 2.9)), pipe(9.85, 2.5, 12, 9.85, 2.5, 26, 0.07),
    // the corridor up from the hall, and the crawl
    ...frameZ(10, 18, 20, 3), rod(18.14, 9, 0.07, 0, 3), ...frameZ(9, 6, 8, 1.6), ...frameZ(10.6, 6, 8, 1.6),
    // the east duct
    ...frameX(28, 18, 20, 2.2), ...frameZ(16, 30, 32, 2.2),
    // east pump room: tanks, pipes and valves. The risers stand clear of the gallery door.
    cyl(34.2, 8.0, 0.5, 0, 0.5), sph(34.2, 1.55, 8.0, 1.15),
    cyl(34.2, 11.4, 0.5, 0, 0.5), sph(34.2, 1.55, 11.4, 1.15),
    cyl(29.2, 11.8, 0.4, 0, 0.5), sph(29.2, 1.3, 11.8, 0.9),
    rod(28.3, 8.7, 0.12, 0, 3), rod(28.3, 9.2, 0.12, 0, 3), rod(28.3, 9.7, 0.12, 0, 3),
    box(28, 9.6, 36, 9.8, 2.45, 2.65), box(31.5, 6.1, 32.3, 6.6, 0, 1.1),
    ...run(0.09, [34.2, 2.7, 8], [34.2, 2.7, 9.7]), ...run(0.09, [34.2, 2.7, 11.4], [34.2, 2.7, 9.7]), ...run(0.07, [29.2, 2.2, 11.8], [29.2, 2.55, 9.8]),
    deco(28, 12.4, 28.28, 13.7, 1, 2), ...wheel(35.85, 1.3, 13, 'x'), deco(35.72, 6.2, 36, 7.8, 0.8, 2),
    // north gallery: columns with feet, a beam along each row and an arch across each pair, benches, the statue's
    // pedestal, piers on the north wall, a bay on the south side with crates to get behind
    ...[[7.5, 3.4], [7.5, 6.6], [11.5, 3.4], [11.5, 6.6], [15.5, 3.4], [15.5, 6.6], [22.5, 3.4], [22.5, 6.6]].flatMap(([x, z]) => [cyl(x, z, 0.3, 0, 3), box(x - 0.42, z - 0.42, x + 0.42, z + 0.42, 0, 0.28)]),
    ...[7.5, 11.5, 15.5, 22.5].map(x => deco(x - 0.14, 3.4, x + 0.14, 6.6, 2.65, 3)),
    deco(4, 3.3, 26, 3.5, 2.75, 3), deco(4, 6.5, 26, 6.7, 2.75, 3),
    ...every(5.5, 25.5, 4, x => deco(x - 0.2, 2, x + 0.2, 2.28, 0, 3)),
    box(9, 2.1, 11, 2.6, 0, 0.45), box(13, 7.4, 15, 7.9, 0, 0.45),
    box(24.2, 4.6, 25.0, 5.4, 0, 0.9),
    box(12.6, 8.5, 13.9, 9.8, 0, 1.2), box(12.8, 8.7, 13.7, 9.5, 1.2, 1.7),
    ...frameX(26.4, 6, 8, 2.2),
  ],
  statue: {x: 24.6, z: 5.0, face: Math.PI, lift: 0.9},
  notes: [
    {x: 13.4, z: 24.6, title: 'Operator log, day 3',
      text: 'It does not see. I am sure of that now. It came down the hall while I stood still with the scanner off, and it walked straight past me.\n\nIt was listening. When it listens it clicks, and a moment later the walls light up red around it, like it has a scanner of its own. Whatever moves in that red, it finds. Freeze on the first click.\n\nWhen it hunts it does the same, only faster: a rush on all fours, then dead still, that thing on its head opening like a flower, and the clicks. Move while it runs. Freeze when it clicks.'},
    {x: 16.8, z: 7.2, title: 'Operator log, day 4',
      text: 'Do not hold the trigger for long. The hum carries. The sweep is worse: it hears that from anywhere on the level.\n\nBut it hates the light. Hold the beam on it and it cannot move, and if you keep it there it screams and runs. It knows where you are, though, it takes longer to break every time, and the scanner always overheats in the end. Do not let the heat run out with it in front of you.'},
    {x: 31.6, z: 11, title: 'Operator log, day 5',
      text: 'When the signal fills with static, it is close. Stop, crouch, wait.\n\nThe tracker only sees what moves. When the dot stops it has not gone; it is listening. Up close it hears the tick.'},
  ],
  decals: [
    {x: 12, y: 2.1, z: 14.6, face: 'e', w: 3.2, h: 0.9, text: "DON'T RUN"},
    {x: 4, y: 1.6, z: 12, face: 's', w: 3.2, h: 1.0, text: "IT WON'T FIT\nIN THE CRAWL"},
  ],
  hides: [{x: 3.4, z: 16.6, r: 1.0}, {x: 35.3, z: 9.7, r: 0.8}, {x: 25.2, z: 23.6, r: 0.9}, {x: 11.4, z: 9.2, r: 0.9}],
  // store floor, pump-room crate, gallery bench, the hall's far corner
  batteries: {spots: [[9.4, 17.0], [31.9, 6.4, 1.1], [10, 2.4, 0.45], [25.3, 12.6]]},
  ghosts: [[19, 33], [19, 27], [16.5, 25], [12, 19], [7, 19], [3.6, 13], [7, 10], [7, 6.8], [4.2, 3.4]],
  triggers: [
    {x: 19, z: 24, r: 3, actions: [['steps', 11, 14, 11, 24, 9]]},
    {x: 19, z: 9.8, r: 1.3, actions: [['statue', 19, 6.6, Math.PI, 0]]},
    {x: 19, z: 13.5, r: 2.5, cores: 2, actions: [['statue', 19, 12.8, Math.PI, 0]]},
    {x: 6, z: 21, r: 2, cores: 1, delay: 0.6, actions: [['silence', 4], ['behind', 2.4]]},
    {x: 10, z: 4.5, r: 2, actions: [['whisper', 2.6, 3]]},
    // on the tracker, something goes across the store beyond the west door. There is nothing to hear.
    {x: 22, z: 19, r: 3, cores: 1, tracker: true, look: [11, 19], actions: [['crossing', 9.4, 15.5, 9.4, 23, 1.5]]},
  ],
  // narrow, with a hub most routes cross: a slightly gentler creature, or this would be the hardest level in the game
  tune: {hearing: 0.97, sonar: 0.92},
  stalker: {
    spawn: [31, 12], wake: 'core:1',
    patrol: [[31, 10], [20, 4.5], [8, 4.5], [6, 20], [14, 13.6], [24.5, 21], [19, 28.5], [33, 6.8]],
  },
};
