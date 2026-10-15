// Every tunable number in one place. Gameplay code reads these instead of hard-coding values,
// so balancing the game means editing this file only.

export const CELL = 2;            // metres per map cell
export const EYE = 1.6;           // standing eye height
export const EYE_CROUCH = 0.95;
export const PLAYER_R = 0.3;      // player collision radius
export const RANGE = 44;          // scanner reach in metres

// Surface materials a scanner ray can report.
export const MAT = {WALL: 0, FLOOR: 1, PROP: 2, CORE: 3, EXIT: 4, NOTE: 5, FLESH: 6};

export const PLAYER = {
  walk: 3.2, sprint: 5.2, crouch: 1.45,
  staminaDrain: 1 / 4.5,         // full bar lasts 4.5 s of sprinting
  staminaRegen: 1 / 7,
  staminaDelay: 1.0,             // seconds before stamina starts to refill
  stepEvery: 0.46,               // seconds per footstep at full walk speed
};

// How far each sound carries, in metres of walkable path (sound goes round corners, not through rock).
export const NOISE = {
  step: 7, sprintStep: 15, crouchStep: 2.2,
  scanMin: 4, scanMax: 12,       // the scanner hum, scaled by charge
  sweep: 32, core: 18, overheat: 10, slam: 22,
};

export const SCANNER = {
  chargeTime: 2.4,               // seconds to spin up to full density
  heatRate: 0.08, heatRateCharge: 0.1, // heat per second while scanning: ~9 s at full charge
  coolRate: 0.24, coolDelay: 0.4,
  ventBelow: 0.35,               // overheated scanner restarts below this heat
  sweepTime: 2.6, sweepCooldown: 30,
  maxRaysPerFrame: 170,
};

export const DOTS = {capacity: 100000, life: 20};

export const STALKER = {
  patrol: 1.3, investigate: 2.4, hunt: 3.45, finale: 3.0,
  lunge: 1.9, lungeDist: 3.2,    // the last few metres of a hunt come at you this much faster
  catchDist: 0.85, catchCrawl: 1.15, // on all fours its head reaches further ahead of its body
  alertTime: 0.85,               // it freezes this long, turning toward you, before it charges
  lightWindow: 1.2,              // scanner hits on its body add up over about this many seconds
  lingerDist: 3.2, lingerTime: [3.5, 5.5], // stops beside a hidden player and listens
  waitChance: 0.3, waitTime: [8, 14],      // sometimes stands silent and still instead of listening
  mimicEvery: [16, 34], groanEvery: [9, 20],
  crawlBelow: 2.6,               // ceilings lower than this put it on all fours
  senseDist: 2.6,                // it notices anyone this close who isn't hidden
  loseAfter: 4.5,                // seconds without a fix before a hunt turns into a search
  listenTime: [2.5, 5],
  repathEvery: 0.25,
};

/** Difficulty presets. Each value multiplies or replaces the base number it names. */
export const DIFFICULTY = {
  easy: {
    label: 'Easy', blurb: 'Signal reads while you move. It hears less and moves slower.',
    hearing: 0.7, speed: 0.85, heat: 0.75, dotLife: 24, signalStill: 0, tintFlesh: true, staticRange: 10, lightNotice: 60,
  },
  normal: {
    label: 'Normal', blurb: 'Stand still to read the signal. It hunts by sound.',
    hearing: 1, speed: 1, heat: 1, dotLife: 20, signalStill: 0.5, tintFlesh: false, staticRange: 10, lightNotice: 30,
  },
  hard: {
    label: 'Hard', blurb: 'Dots fade faster, the signal needs longer to settle, and it is quicker.',
    hearing: 1.25, speed: 1.1, heat: 1.2, dotLife: 14, signalStill: 1.2, tintFlesh: false, staticRange: 14, lightNotice: 18,
  },
};
