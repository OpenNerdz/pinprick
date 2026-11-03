// Level 1. Teaches scanning, the sweep, crouching through a crawl, notes, the old operator's dots and
// the motion tracker. Nothing hunts you here yet; the level ends with footsteps that are not yours,
// which the tracker shows walking past behind the wall.
// One map cell is 2 m: cell (cx, cz) covers x 2cx..2cx+2, z 2cz..2cz+2.

import {box, cyl, sph} from '../world/shapes.js';
import {deco, every, frameX, frameZ, ladder, lockers, pipe, rack, rod, run, wheel} from './kit.js';

// One pipe runs the whole way from the first room to the first core: up by the roof, down along the duct,
// low through the crawl. Follow it and you are going the right way, which is most of what this level teaches.
const feed = run(0.07,
  [2, 2.7, 4.2], [13.5, 2.7, 4.2], [13.8, 2.02, 4.2], [24.2, 2.02, 4.2], [24.6, 2.7, 4.2], [29.8, 2.7, 4.2],
  [29.8, 2.7, 9.3], [29.8, 1.42, 9.8], [29.8, 1.42, 14.1], [29.8, 2.6, 14.5], [25.2, 2.6, 14.5], [24.8, 2.2, 14.9]);

export default {
  id: 'intake',
  name: 'Intake',
  blurb: 'The way in. Learn the scanner while it is still quiet.',
  intro: {touch: 'Hold SCAN to see. Let go and it fades.', mouse: 'Hold click or Space to see. Let go and it fades.'},
  map: [
    '################',
    '#......#########',
    '#......,,,,,...#',
    '#......#####...#',
    '###.########...#',
    '###.##########;#',
    '###.##########;#',
    '#......#####...#',
    '#......#####...#',
    '#......#########',
    '#####,##########',
    '#::::::::#######',
    '#::::::::......#',
    '################',
  ],
  start: {x: 5, z: 5.5, yaw: Math.PI / 2},
  exit: {x: 27.2, z: 25},
  exitDoor: {box: [18, 24, 18.25, 26], h: 3},
  exitMessage: 'Both cores in. The amber door at the end of the hall has opened.',
  cores: {count: 2, spots: [[26, 16.5], [4, 24]]},
  props: [
    ...feed,
    // start room: lockers, one hanging open, a desk with a dead terminal and a chair pushed back, a drum, strip lights
    ...lockers(2.2, 2.2, 6.2, 2.8, 5, 2.1), box(6.25, 2.8, 6.3, 3.4, 0, 2.0),
    box(9.5, 6.4, 11.5, 7.6, 0.72, 0.8), box(9.5, 6.4, 9.6, 7.6, 0, 0.72), box(11.4, 6.4, 11.5, 7.6, 0, 0.72), box(10.1, 6.9, 10.9, 7.4, 0.8, 1.25),
    box(10.25, 5.6, 10.75, 6.1, 0.42, 0.5), cyl(10.5, 5.85, 0.05, 0, 0.42), box(10.25, 5.54, 10.75, 5.6, 0.5, 1.0),
    cyl(12.8, 3.2, 0.35, 0, 0.95),
    ...every(4, 12, 4, x => deco(x - 0.6, 5.9, x + 0.6, 6.1, 2.82, 3)),
    ...frameZ(7.9, 6, 8, 3),
    // the duct: a frame every 2 m, so its length shows
    ...every(16, 22, 2, x => frameX(x, 4, 6, 2.2)),
    // corridor south: a cable tray and two frames
    deco(7.8, 8, 8, 14, 2.3, 2.42), ...frameZ(10, 6, 8, 3), ...frameZ(12, 6, 8, 3),
    // room B before the crawl: crates, shelving, a fuse cabinet
    box(28.3, 4.3, 29.6, 5.6, 0, 1.2), box(28.4, 4.4, 29.5, 5.5, 1.2, 2.0), box(24.4, 8.4, 25.8, 9.6, 0, 0.9),
    ...rack(24.15, 6.2, 24.7, 8.3, 2.4, 4), box(24.25, 6.5, 24.6, 7.2, 0.72, 1.1), box(24.25, 7.5, 24.6, 8.1, 1.27, 1.7),
    deco(29.72, 7, 30, 8.2, 1.1, 2.2),
    // the crawl: its frames are low, so you see it is low before you reach it
    ...frameZ(9.86, 28, 30, 1.6), ...frameZ(11.5, 28, 30, 1.6), ...frameZ(13, 28, 30, 1.6),
    // the room past the crawl: a crate, the tank the pipe was going to, more shelving
    box(28.4, 16.6, 29.6, 17.6, 0, 1.4),
    cyl(24.75, 15, 0.5, 0, 1.9), sph(24.75, 1.9, 15, 0.5), ...rack(24.4, 17.25, 27.4, 17.85, 2.3, 4), ...wheel(24.15, 1.2, 16.3, 'x'),
    // room C: a column, shelving, a bench, a workbench with a vice and a tool board, a drum, a big duct overhead
    box(5.6, 16.1, 6.1, 16.6, 0, 3),
    ...rack(2.2, 16, 2.8, 19.5, 2.2, 4), box(2.3, 16.4, 2.7, 17.2, 0.17, 0.7), box(2.3, 18, 2.7, 19, 1.17, 1.6),
    box(6, 18.8, 9, 19.4, 0, 0.45),
    box(13.1, 15.2, 13.95, 18.2, 0.82, 0.9), box(13.1, 15.2, 13.95, 15.3, 0, 0.82), box(13.1, 18.1, 13.95, 18.2, 0, 0.82), box(13.2, 16.4, 13.5, 16.7, 0.9, 1.1), deco(13.92, 15.4, 14, 18, 1.2, 2.0),
    cyl(12.9, 19.2, 0.35, 0, 0.95),
    deco(2, 15, 14, 15.7, 2.35, 2.85), ...every(3, 13, 2.5, x => deco(x, 14.94, x + 0.08, 15.76, 2.29, 2.91)),
    // hall: a frame of girders with piers under them, a tank piped into the roof, a hoist, crates, a ladder at the core's end
    box(2, 22.2, 18, 22.5, 4.6, 5.0), box(2, 25.5, 18, 25.8, 4.6, 5.0),
    ...every(4, 16, 4, x => [box(x - 0.12, 22, x + 0.12, 26, 4.6, 5), deco(x - 0.2, 22, x + 0.2, 22.2, 0, 4.6), deco(x - 0.2, 25.8, x + 0.2, 26, 0, 4.6)]),
    cyl(12, 24.2, 0.9, 0, 0.6), cyl(12, 24.2, 0.75, 0.6, 2.4), sph(12, 2.4, 24.2, 0.75), ...run(0.1, [12, 3.1, 24.2], [12, 4.4, 24.2], [12, 4.4, 22.3]),
    box(6.7, 23.7, 7.3, 24.3, 2, 2.4), rod(7, 24, 0.03, 2.4, 4.6), box(6.9, 22, 7.1, 26, 4.45, 4.6),
    box(15.2, 22.4, 16.4, 23.4, 0, 1.2), box(15.4, 22.5, 16.2, 23.2, 1.2, 1.8),
    ...ladder(2.12, 25, 'z', 0, 4.6),
    // the way out: frames, a pipe, spare crates at the end
    ...frameX(21, 24, 26, 3), ...frameX(24, 24, 26, 3), pipe(18.2, 2.6, 24.15, 29.8, 2.6, 24.15, 0.06), box(29, 24.2, 29.8, 25, 0, 0.9),
  ],
  notes: [
    {x: 8.7, z: 6.7, title: 'Operator log, day 1',
      text: 'Sublevel 2 has no lights and no plans. Two cores are still down here. The scanner is all I have: hold it and the dots come, let go and they fade.\n\nIf you see rust-coloured dots, those are mine. They never fully go out.'},
    {x: 27, z: 6.6, title: 'Operator log, day 2',
      text: 'There is a draught from somewhere low. The crawlways are tight, but they are quiet, and nothing big fits in them.'},
  ],
  decals: [
    {x: 10.9, y: 1.6, z: 14, face: 's', w: 5.4, h: 1.1, text: 'IT HEARS THE SCANNER'},
  ],
  ghosts: [[8, 16], [11, 19], [11, 21.5], [14, 23.8], [17, 24.8]],
  triggers: [
    {x: 15, z: 5, r: 1.6, actions: [['say', {touch: 'Tap SWEEP for one full picture of the room. It needs 30 s to recharge.', mouse: 'Press F or right click for one full picture of the room. It needs 30 s to recharge.'}, 6000]]},
    {x: 27, z: 7, r: 2.2, actions: [['say', {touch: 'The way on is low. Tap CROUCH to fit through.', mouse: 'The way on is low. Press C to crouch and fit through.'}, 5000]]},
    {x: 6, z: 15.5, r: 2.5, actions: [['say', 'Rust-coloured dots are old. Someone was here before you.', 5000]]},
    {x: 9, z: 24, r: 7, cores: 2, delay: 1.2, actions: [['silence', 7], ['steps', 16, 21, 3, 21, 11],
      ['say', {touch: 'Footsteps. Not yours. Tap TRACK and watch.', mouse: 'Footsteps. Not yours. Press Q and watch.'}, 5000]]},
  ],
  hides: [],
  // the motion tracker lies on the floor by the way into the hall, half charged; a battery waits in it
  tracker: {x: 11, z: 19.2, battery: 0.5},
  batteries: {spots: [[16.8, 22.8]]},
  stalker: null,
};
