// Level 1. Teaches scanning, the sweep, crouching through a crawl, notes and the old operator's dots.
// Nothing hunts you here yet; the level ends with footsteps that are not yours.
// One map cell is 2 m: cell (cx, cz) covers x 2cx..2cx+2, z 2cz..2cz+2.

import {box, cyl} from '../world/shapes.js';

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
    // start room: lockers, a desk, a drum
    box(2.2, 2.2, 6.2, 2.8, 0, 2.1), box(9.5, 6.4, 11.5, 7.6, 0, 0.8), cyl(12.8, 3.2, 0.35, 0, 0.95),
    // room B before the crawl: crates
    box(28.3, 4.3, 29.6, 5.6, 0, 1.2), box(28.4, 4.4, 29.5, 5.5, 1.2, 2.0), box(24.4, 8.4, 25.8, 9.6, 0, 0.9),
    // the room past the crawl
    box(28.4, 16.6, 29.6, 17.6, 0, 1.4),
    // room C: shelving and a bench
    box(2.2, 16, 2.8, 19.5, 0, 2.2), box(6, 18.8, 9, 19.4, 0, 0.45),
    // hall: girders and a tank
    box(2, 22.2, 18, 22.5, 4.6, 5.0), cyl(12, 24.2, 0.9, 0, 0.6), cyl(12, 24.2, 0.75, 0.6, 2.4),
  ],
  notes: [
    {x: 12.5, z: 15.6, title: 'Operator log, day 1',
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
    {x: 9, z: 24, r: 7, cores: 2, delay: 1.2, actions: [['silence', 7], ['steps', 16, 21, 3, 21, 11], ['say', 'Footsteps. Not yours.', 4000]]},
  ],
  hides: [],
  stalker: null,
};
