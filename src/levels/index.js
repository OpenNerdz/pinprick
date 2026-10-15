// Level order. Add a level by writing a file next to this one and listing it here;
// `npm test` then checks that everything in it can be reached.

import intake from './intake.js';
import sublevel from './sublevel.js';
import cistern from './cistern.js';
import shaft from './shaft.js';

export const LEVELS = [intake, sublevel, cistern, shaft];

/** Where the title screen's background demo stands and looks. */
export const ATTRACT = {level: sublevel, pose: {x: 19, z: 24.6, yaw: 0, pitch: 0.13}};
