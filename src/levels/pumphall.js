// Level 5, the climax. The lift goes down, not up, and stops at the pumps. A huge pump in a round hall
// runs on a cycle: while it runs the level shakes and the creature hears much less, and when it stops
// everything you do is loud again. So the map is built in legs of 30 m or so, each a walk you can make
// in one run of the pump, from one place to stop (a hiding spot, a crawl) to the next. The hall has
// eight ways in, three of them crawls nothing big can follow you through, and the whole level rings
// round it, so a chase always has another way out.
// One map cell is 2 m: cell (cx, cz) covers x 2cx..2cx+2, z 2cz..2cz+2.

import {box, cyl, sph} from '../world/shapes.js';

const circle = (n, f) => { const out = []; for (let i = 0; i < n; i++) out.push(f(i / n * Math.PI * 2, i)); return out; };

// the fallen lift cage round where you start: bars on three sides, the east side torn open
const bars = [];
for (let k = 0; k <= 8; k++) {
  bars.push(cyl(4 + k * 0.5, 40, 0.04, 0, 2.6), cyl(4 + k * 0.5, 44, 0.04, 0, 2.6));
  if (k && k < 8) bars.push(cyl(4, 40 + k * 0.5, 0.04, 0, 2.6));
}

// the pump: a plinth, a body you could park a truck in, a head near the roof, tie rods, a flywheel
// taller than you on its east side, a catwalk round it and pipes as thick as a door out to the walls
const PX = 32, PZ = 25;
const pump = [
  cyl(PX, PZ, 4.6, 0, 0.5), cyl(PX, PZ, 3.7, 0.5, 3.3), cyl(PX, PZ, 4.1, 3.3, 3.6), sph(PX, 4.3, PZ, 1.6),
  ...circle(8, a => cyl(PX + Math.sin(a) * 4.25, PZ + Math.cos(a) * 4.25, 0.16, 0.5, 1.1)), // the bolts round its foot
  ...circle(4, a => cyl(PX + Math.sin(a + 0.8) * 2.7, PZ + Math.cos(a + 0.8) * 2.7, 0.14, 3.6, 6)), // tie rods up into the roof
  // flywheel: a ring of blocks standing on edge, spokes, an axle, and the motor that turns it
  ...circle(26, a => {
    const y = 3 + Math.cos(a) * 2.6, z = PZ + Math.sin(a) * 2.6;
    return box(37.1, z - 0.36, 37.6, z + 0.36, y - 0.36, y + 0.36);
  }),
  box(37.2, PZ - 2.5, 37.5, PZ + 2.5, 2.88, 3.12), box(37.2, PZ - 0.12, 37.5, PZ + 0.12, 0.5, 5.5),
  box(35.6, PZ - 0.2, 38.2, PZ + 0.2, 2.8, 3.2), box(38.2, PZ - 1.9, 40.4, PZ + 1.9, 0, 2.3), box(38.6, PZ - 1.4, 40, PZ + 1.4, 2.3, 3.1),
  // discharge pipes, overhead
  box(31, 14, 33, 21.6, 4.4, 5.2), box(31, 28.4, 33, 36, 4.4, 5.2), box(20, 24.2, 28.4, 25.8, 4.2, 5),
  // catwalk on four legs, with a rail and a bridge across to the head
  ...[[25.5, 18.5], [38.5, 18.5], [25.5, 31.5], [38.5, 31.5]].map(([x, z]) => cyl(x, z, 0.16, 0, 3.9)),
  box(25.2, 18.2, 38.8, 18.8, 3, 3.1), box(25.2, 31.2, 38.8, 31.8, 3, 3.1), box(25.2, 18.8, 25.8, 31.2, 3, 3.1), box(38.2, 18.8, 38.8, 31.2, 3, 3.1),
  box(25.2, 18.2, 38.8, 18.26, 3.9, 3.96), box(25.2, 31.74, 38.8, 31.8, 3.9, 3.96),
  box(25.2, 18.2, 25.26, 31.8, 3.9, 3.96), box(38.74, 18.2, 38.8, 31.8, 3.9, 3.96),
  box(31.7, 18.8, 32.3, 21.8, 3.5, 3.6), box(31.7, 28.2, 32.3, 31.2, 3.5, 3.6),
];

const motor = z => [
  box(53.6, z - 1.9, 57, z + 1.9, 0, 0.6), cyl(55.3, z, 1.4, 0.6, 2.8), sph(55.3, 3.2, z, 1.05),
  box(54.9, z - 0.2, 55.7, z + 0.2, 4, 6), // the cable going up
];

export default {
  id: 'pumphall',
  name: 'Pump Hall',
  blurb: 'The lift went down. Walk when the pump runs. Stop when it stops.',
  intro: {touch: 'The lift went down, not up. When the pump runs, walk. When it stops, stop.', mouse: 'The lift went down, not up. When the pump runs, walk. When it stops, stop.'},
  map: [
    '##############################',
    '#=====#....#,,,,,,,,,,#.....##',
    '#=====,....,,,,,,,,,,,,.....,#',
    '#=====#....#,###;###,##.....##',
    '#=====##.###,##....#,;;.....##',
    '####.###.###,##....#,##.....##',
    '#::::::#.###,####;##,#####.###',
    '#::::::#.###::::::::,###:::::#',
    '#::::::#.##::::::::::###:::::#',
    '#:::::##.#::::::::::::##:::::#',
    '#::::::,,,::::::::::::##:::::#',
    '#::::::###::::::::::::##:::::#',
    '#::::::###::::::::::::,,:::::#',
    '#::::::###::::::::::::##:::::#',
    '#::::::;;;::::::::::::##:::::#',
    '#::::#####::::::::::::##:::::#',
    '#::::######::::::::::###:::::#',
    '###.########::::::::######,###',
    '###.###########,###;######,###',
    '#.....##.............#,,,,,..#',
    '#.....,,..##..##..##.,,##,#..#',
    '#.....##..##..##..##.#,,,,,..#',
    '#.....##.............######..#',
    '##############################',
  ],
  start: {x: 6.2, z: 42, yaw: Math.PI / 2},
  exit: {x: 57.3, z: 5},
  exitDoor: {box: [56, 4, 56.25, 6], h: 2.2},
  exitMessage: 'Five cores. The amber door in the north-east is open, and the stair is behind it.',
  finaleMessage: 'The gallery door has shut. Take the crawl, or go round by the motors. It knows where you are.',
  // Runs for `lasts` seconds, then is still for `every`. While it runs the creature hears much less.
  pump: {x: PX, z: PZ, every: [22, 34], lasts: [11, 16]},
  cores: {count: 5, spots: [
    [9.6, 7.4], [13.2, 23.4], [18.6, 3.4], [41.6, 43], [27.5, 16.6], [36, 33.8],
    [26, 42], [51.6, 33], [44.7, 38.7], [56, 44.5],
  ]},
  props: [
    // the landing: the cage you came down in, its cable, what fell with it
    ...bars, box(4, 40, 8, 44, 2.55, 2.62), box(4, 39.97, 8, 40.03, 0, 0.22), box(4, 43.97, 8, 44.03, 0, 0.22), box(3.97, 40, 4.03, 44, 0, 0.22), cyl(6.2, 41.4, 0.06, 2.62, 3), cyl(4.6, 38.25, 0.07, 0, 3),
    box(9.6, 38.4, 11.6, 40, 0, 1.3), box(10, 38.7, 11.2, 39.7, 1.3, 1.9), box(10, 44.6, 11.6, 45.7, 0, 1), cyl(9.3, 45.4, 0.3, 0, 0.9),

    // settling gallery: low pipe along the south wall, sluice frames between the tanks, a crate and some buckets
    box(16, 45.6, 42, 46, 0, 0.5), box(24, 41.9, 28, 42.1, 2.3, 2.5), box(32, 41.9, 36, 42.1, 2.3, 2.5),
    box(16, 41.9, 20, 42.1, 2.3, 2.5), cyl(24.4, 40.4, 0.05, 1.7, 3), cyl(27.6, 43.6, 0.05, 1.7, 3), cyl(34, 39, 0.05, 1.7, 3),
    box(32.8, 41, 35, 42.4, 0, 1.2), box(33.2, 41.2, 34.4, 42.2, 1.2, 1.8), cyl(27.4, 41, 0.25, 0, 0.5), cyl(27.5, 41.7, 0.25, 0, 0.5),
    box(16.3, 39, 17.5, 40.2, 0, 0.9), box(41, 45, 42, 46, 0, 0.9),

    // the round hall
    ...pump,
    // crates, a clump of risers, drums, a cable spool, a pedestal
    box(22.4, 19.6, 24.6, 21.4, 0, 1.5), box(22.9, 20, 24.2, 21, 1.5, 2.2),
    cyl(40.2, 18.4, 0.45, 0, 6), cyl(41.3, 19.2, 0.3, 0, 6), cyl(39.4, 17.4, 0.3, 0, 6), box(38.6, 16.9, 41.8, 19.6, 3.4, 3.7),
    cyl(23.5, 30.5, 0.4, 0, 1), cyl(24.4, 31, 0.4, 0, 1), cyl(23.6, 31.5, 0.4, 0, 1),
    cyl(40, 31.6, 1, 0, 0.8), cyl(40, 31.6, 0.35, 0.8, 1.2), box(30.6, 32.4, 31.8, 33.2, 0, 1.1),

    // sump hall: three tanks, overhead pipes, a railed well with chains going down
    ...[15.5, 22, 28.5].flatMap(z => [cyl(5.5, z, 1.4, 0, 0.5), sph(5.5, 1.9, z, 1.5), box(7, z - 0.3, 14, z + 0.3, 3.4, 4)]),
    box(8.6, 23, 12, 23.1, 0, 1), box(8.6, 27, 12, 27.1, 0, 1), box(8.6, 23, 8.7, 27, 0, 1), box(11.9, 23, 12, 27, 0, 1),
    box(8.7, 23.1, 11.9, 26.9, 0, 0.06), cyl(9.6, 24.2, 0.05, 0, 6), cyl(10.8, 25.8, 0.05, 0, 6), cyl(10.4, 24.6, 0.05, 0, 6),
    box(2.4, 31, 4.2, 32.2, 0, 1.4), box(11.5, 13, 13.6, 14, 0, 1.1),

    // filter room: canisters taller than you, a pipe across their tops, a bench
    ...[[4.8, 4.6], [7.6, 4.6], [4.8, 7.4], [7.6, 7.4]].map(([x, z]) => cyl(x, z, 0.85, 0, 3.3)),
    box(4.6, 4.4, 7.8, 4.8, 3.5, 3.9), box(4.6, 7.2, 7.8, 7.6, 3.5, 3.9), box(4.6, 4.8, 5, 7.2, 3.5, 3.9),
    box(9.6, 2.2, 11.6, 2.7, 0, 0.45),

    // vestibule: lockers, a bench; the long corridor south with a pipe up by the roof
    box(14.4, 2.2, 18.4, 2.8, 0, 2.1), box(20.4, 2.2, 21.8, 3.4, 0, 1), box(14.6, 7.2, 15.8, 7.8, 0, 0.45),
    box(16, 8, 16.25, 20, 2.4, 2.65), box(17.75, 8, 18, 20, 2.1, 2.2),

    // the manifold: a long low gallery full of pipes
    box(24, 2, 44, 2.35, 0, 0.9), box(26.2, 5.7, 31.6, 6, 1.6, 1.9), box(34.4, 5.7, 40, 6, 1.6, 1.9),
    ...[[27, 3.8], [29.2, 4.7], [31, 3.7], [35.2, 3.7], [37, 4.6], [39, 3.7], [42.8, 4.2]].map(([x, z]) => cyl(x, z, 0.22, 0, 2.2)),
    box(28.5, 5.84, 29.3, 5.98, 0.9, 1.6), box(37.3, 5.84, 38.1, 5.98, 0.9, 1.6),

    // breaker room: the panel with one lever down, a cabinet, a chair someone sat in for a long time
    box(34.4, 8, 37.6, 8.35, 0.4, 2.4), box(36, 8.35, 36.14, 8.6, 1.1, 1.7), box(30.2, 8.2, 31.2, 9.2, 0, 1.6),
    box(33.2, 9.4, 33.8, 10, 0, 0.48), box(33.2, 9.4, 33.8, 9.46, 0.48, 1),
    box(35, 10.2, 36.6, 11.6, 0, 0.04, {solid: false}), box(35.7, 10.1, 35.9, 10.2, 0.02, 0.14, {solid: false}),

    // control room: consoles, a desk, racks, and the stair behind the door
    box(46.4, 2.3, 52.6, 3, 0, 1.1), box(46.6, 2.35, 52.4, 2.55, 1.1, 1.7), box(48.5, 6.5, 51, 7.5, 0, 0.85),
    box(46.4, 10.6, 50.6, 11.6, 0, 2.4), box(54.4, 2.3, 55.6, 3.1, 0, 1.8),
    box(57.65, 4.1, 58, 5.9, 0, 0.3, {solid: false}), box(57.8, 4.1, 58, 5.9, 0.3, 0.6, {solid: false}),

    // motor hall: three motors down the east side, transformers with their fins, cable trays
    ...motor(18), ...motor(24), ...motor(30),
    box(48.4, 15.6, 50.6, 19, 0, 2.6), box(48.4, 29, 50.4, 32.4, 0, 2),
    ...circle(5, (a, i) => box(50.6, 16 + i * 0.6, 50.8, 16.2 + i * 0.6, 0.2, 2.4)),
    box(48, 20.9, 54, 21.2, 4, 4.1), box(48, 27, 54, 27.3, 4, 4.1), box(48, 33.6, 58, 33.9, 3.2, 3.4),

    // the south-east room past the ducts: drums and a crate; baffle plates in the ducts
    box(55.2, 40.2, 56.6, 41.6, 0, 1.3), box(55.5, 40.5, 56.3, 41.3, 1.3, 1.9), cyl(55, 45.2, 0.35, 0, 1), cyl(55.8, 45.4, 0.35, 0, 1),
    box(47, 38, 47.1, 40, 1.75, 2.1), box(47, 42, 47.1, 44, 1.75, 2.1), box(51, 38, 51.1, 40, 1.75, 2.1),
  ],
  statue: {x: 52.4, z: 25, face: -Math.PI / 2, lift: 0},
  doors: [
    {id: 'manifold-east', box: [45, 4, 45.25, 6], h: 2.2, open: true},
    {id: 'hall-south', box: [30, 36.75, 32, 37], h: 2.2, open: true},
  ],
  notes: [
    {x: 9.4, z: 42.8, title: 'Operator log, day 10',
      text: 'I wrote "last" too soon. There is a ladder down the shaft, and down was the one way it was not standing.\n\nThe cage I heard was coming down, not going up. The lift only ever carried pump parts. The stair out is in the north-east, behind one more amber door, and that door wants five cores.\n\nYou will feel the big pump before you find it. While it runs it cannot hear much of anything. When it stops, stop.'},
    {x: 26, z: 44.7, title: 'Operator log, day 11',
      text: 'I threw a stone to send it the other way. It went. The second stone, it went.\n\nThe third time it stood with its head on one side and did not go to where the stone landed. It came to where I threw it from.'},
    {x: 3.4, z: 13.2, title: 'Operator log, day 12',
      text: 'It walked off today, loud, dragging that foot, all the way down the gallery. I counted to sixty and stepped out and it was there. It had come back without a sound.\n\nIf it leaves noisily, it wants you to hear it leave.\n\nWhen it loses me now it goes to a doorway and waits. Not where I am. Where I have to go. Keep two ways out.'},
    {x: 49.2, z: 27.6, title: 'Operator log, day 13',
      text: 'I have three places I go when it comes. It checks them now, in the order I use them. A week ago it walked past those crates. Today it put its hand in behind them before I got there.\n\nIt is learning me. Do not hide in the same place twice. Do not run the same way twice. Whatever you did last time, it has that now.'},
    {x: 41.2, z: 3.2, title: 'Operator log, day 14',
      text: 'It stopped so close I could feel the air move off it. That thing on its head opened and turned toward my chest.\n\nI stopped breathing. I do not know for how long. It stayed, and then it lost interest.\n\nIt has been listening to that too, all this time. When it is close enough to touch, hold your breath.'},
    {x: 32.6, z: 10.8, title: 'Operator log, end',
      text: 'The pump has no timer. The relay burned out years ago. It runs while someone holds the breaker down, and it stops when they have to let go.\n\nIt has had my leg since the motor hall. I will not make the stair. I can do this. There is a second panel under the hatch, where it cannot reach.\n\nIf you are reading this you have been walking in my noise. Do not come looking. If you hear me calling, that is not me: it does my voice now.\n\nI cannot hold it for long at a time. Go when it runs. Do not wait for me.'},
  ],
  decals: [
    {x: 12, y: 1.7, z: 44, face: 'w', w: 3.4, h: 1.0, text: 'WALK WHEN IT RUNS\nSTOP WHEN IT STOPS'},
    {x: 16, y: 1.5, z: 14, face: 'e', w: 3.4, h: 0.8, text: 'IT WAITS AT DOORS'},
    {x: 29, y: 3.2, z: 14, face: 's', w: 5, h: 1.3, text: "IT CAN'T HEAR\nOVER THIS"},
    {x: 50, y: 2.6, z: 14, face: 's', w: 3.6, h: 1.0, text: 'NOT THE SAME\nPLACE TWICE'},
    {x: 56, y: 1.5, z: 8.2, face: 'w', w: 3.2, h: 0.8, text: "DON'T WAIT FOR ME"},
  ],
  hides: [{x: 3.2, z: 33.2, r: 0.9}, {x: 33.8, z: 43.4, r: 0.9}, {x: 57.3, z: 21, r: 0.8}, {x: 2.9, z: 9, r: 0.9}, {x: 57.3, z: 40.9, r: 0.8}, {x: 47.2, z: 9.6, r: 0.8}, {x: 22.9, z: 32.6, r: 0.8}],
  // filter bench, sump crate, hall crate, breaker room, settling crate, transformer, console, south-east crate, duct
  batteries: {spots: [[10.6, 2.45, 0.45], [3.3, 31.95, 1.4], [24.4, 20.5, 1.5], [37.2, 11.2], [34.6, 42.1, 1.2], [50.1, 30.7, 2], [51.5, 2.85, 1.1], [55.4, 41.45, 1.3], [45, 41]]},
  // the operator's way here: off the landing, along the gallery, up into the hall, through the crawl to the breaker
  ghosts: [[6.2, 42], [13.8, 41], [18, 39], [30.6, 39], [31, 36.5], [24, 34.5], [22, 26], [24.5, 17.6], [33, 15.8], [35, 13], [34.6, 10.4]],
  triggers: [
    // someone else's scanner, walking away from you along the gallery, up into the hall
    {x: 15, z: 41, r: 1.4, actions: [['phantom', 25, 39, 31, 38.6, 3.2], ['say', 'Rust-coloured dots. Fresh ones. You are not scanning.', 4500]]},
    {x: 10, z: 20, r: 2.2, actions: [['whisper', 10.2, 25]]},
    {x: 27, z: 16, r: 3.5, cores: 1, actions: [['steps', 24, 18.5, 40, 18.5, 12]]},
    // only the tracker sees it go across the far door
    {x: 38, z: 27, r: 4.5, cores: 2, tracker: true, look: [47, 25], actions: [['crossing', 49.5, 22, 49.5, 28, 1.6]]},
    // hands along the wall, coming toward you. There is a gap where the crawl is: it does not fit.
    {x: 25.5, z: 4, r: 2, cores: 2, look: [38, 5], actions: [['handprints', 39.5, 5, 26.5, 5, 'n', 7]]},
    {x: 49.4, z: 22, r: 2.2, cores: 1, actions: [['statue', 52.6, 16.4, Math.PI, 0]]},
    {x: 55.5, z: 42, r: 1.5, cores: 2, actions: [['silence', 3], ['behind', 2.2]]},
    {x: 44.8, z: 41, r: 1.2, actions: [['whisper', 56, 40]]},
    // the safest room in the level, and it is quiet, and it stays quiet, and then it breathes on you
    {x: 34, z: 10.2, r: 2.4, delay: 1.5, actions: [['hush', 9]]},
    {x: 38, z: 4.2, r: 3, cores: 3, delay: 0.4, actions: [['slam', 'manifold-east', 'Ahead of you a door slams. There is a crawl, or the long way round by the motors.', 5000]]},
    {x: 34.5, z: 39, r: 2.6, cores: 4, delay: 0.4, actions: [['slam', 'hall-south', 'The door up into the hall slams. Round through the ducts, or the crawl.', 5000]]},
    // the last run: the short way shuts wherever you are, which leaves a slow crawl it will go round to meet,
    // or the long way by the motors. The statue has got to the room with the door before you...
    {x: 30, z: 25, r: 200, cores: 5, delay: 0.6, actions: [['slam', 'manifold-east'], ['statue', 54.4, 8.6, -Math.PI / 2, 0]]},
    // ...and if you come by the motors, someone is lighting your way
    {x: 44, z: 25, r: 7, cores: 5, actions: [['phantom', 53, 22, 53, 12, 3]]},
  ],
  tune: {hearing: 1.15, sonar: 1.15},
  stalker: {
    spawn: [50.6, 25], wake: 'start',
    patrol: [[52, 8], [34, 4], [18, 5], [6, 8], [10, 19], [8, 31], [8, 39], [20, 39], [34, 45], [41, 39], [50, 43], [55.2, 43.5], [52, 24], [42, 25], [32, 34.5], [22, 25], [30, 16]],
  },
  ending: 'The stair climbs for a long time. Below you the pump thumps, stops, thumps. You keep the scanner off the whole way up. Near the top it stops and does not start again. You wait for it, one hand on the rail, longer than you should. Then the door, and cold air, and grey light that stays when you let go of the trigger. You walk out across the yard without looking back. Your footsteps come back to you a beat late.',
};
