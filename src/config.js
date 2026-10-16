// Every tunable number in one place. Gameplay code reads these instead of hard-coding values,
// so balancing the game means editing this file only.

export const CELL = 2;            // metres per map cell
export const EYE = 1.6;           // standing eye height
export const EYE_CROUCH = 0.95;
export const PLAYER_R = 0.3;      // player collision radius
export const RANGE = 44;          // scanner reach in metres

// Surface materials a scanner ray can report.
export const MAT = {WALL: 0, FLOOR: 1, PROP: 2, CORE: 3, EXIT: 4, NOTE: 5, FLESH: 6, BATTERY: 7};

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

// The motion tracker in your other hand. Each pulse shows what moved, ahead of you, through rock.
export const TRACKER = {
  pulseEvery: 1.0,               // seconds between pulses
  waveTime: 0.55,                // seconds for a pulse to sweep out to full range
  boot: 0.35, bootCost: 1.5,     // the screen warming up after a raise; seconds of battery each raise costs
  raise: 0.3, lower: 0.18,       // bringing it up into view, putting it away
  minSpeed: 0.35,                // m/s: anything slower is invisible to it
  close: 4,                      // a moving contact this close floods the screen
  maxBlips: 6,
  lowAt: 0.15, lowRange: 0.5,    // below this charge it flickers, and its reach shrinks to this fraction
  pickupR: 1.0, full: 0.95,      // battery pickup radius; at or above this charge you leave batteries be
  teleport: 1.5,                 // metres in one frame: a jump, not movement
  pingWindow: 8,                 // pings it hears within this many seconds add up
};

export const DOTS = {capacity: 100000, life: 20};

export const STALKER = {
  patrol: 1.3, investigate: 2.4, hunt: 3.45, finale: 3.0,
  dash: 5.5,                     // hunting it runs in dashes, faster than you can sprint, then stops to click
  lunge: 1.9, lungeDist: 3.2,    // the last few metres of the final chase come at you this much faster
  catchDist: 0.85, catchCrawl: 1.15, // on all fours its head reaches further ahead of its body
  stumble: 1.0,                  // after a lunge that misses, it stumbles at half speed this long
  lightWindow: 1.2,              // scanner hits on its body add up over about this many seconds
  lingerDist: 3.2, lingerTime: [3.5, 5.5], // stops beside a hidden or motionless player and listens
  clearance: 1.4,                // it never walks closer than this to a player it has not noticed
  waitChance: 0.3, waitTime: [8, 14],      // sometimes stands silent and still instead of listening
  mimicEvery: [30, 60], groanEvery: [18, 38], // rare enough that each one lands
  crawlBelow: 2.6,               // ceilings lower than this put it on all fours
  loseAfter: 4.5,                // seconds without a fix before a hunt turns into a search
  listenTime: [2.5, 5],
  stuckAfter: 1.2,               // seconds without progress (a crawl mouth, a shut door) before it gives up on a spot
  searchListen: 1.4,             // it stops this long at each spot it searches
  // sonar: its clicks splash red dots on everything near it, and find whatever moves in that light
  sonarEvery: [2.2, 3.6],        // seconds between bursts while it stands listening
  sonarWalking: [7, 12],         // ... and while it walks
  sonarRays: 1600, echoTime: 0.45, // red dots in one echo, and how long it takes to wash over the room
  // light: a beam held on it stops it where it stands; hold it there long enough and it breaks and runs
  pinAfter: 0.2,                 // seconds of beam before it is pinned
  pinLinger: 0.35,               // seconds after the light leaves before it moves freely again
  surge: 1.0,                    // seconds of extra speed when the light lets it go
  surgeAfter: 0.6,               // ... but only after it has stood in the light this long; a flicker does not count
  // stalking: it follows your footsteps, stepping when you step
  followFar: 12, followNear: 3.4, // starts this far behind you; pounces from this close
  stalkPatience: 8,              // seconds without hearing you before it gives up the trail
  stalkCooldown: 45,             // after your beam touches it while it stalks, it leaves you alone this long
  respawnGrace: 25, respawnClear: 16, // after a respawn it keeps this far from where you came back
  repathEvery: 0.25,
};

/**
 * Difficulty presets. Each value multiplies or replaces the base number it names. The creature's wits:
 *   lightHold     seconds the beam must stay on its body before it knows where the light comes from
 *   alertTime     how long it freezes, turning toward you, before it charges
 *   lungeMax      how long its lunge at the end of the final chase lasts before it stumbles
 *   dashTime      seconds each dash of a hunt lasts; huntWarn, seconds from its click to the echo that
 *                 finds you if you move; huntCycles, clicks in a row that find nothing before it searches
 *   listen        hearing multiplier while it stands still listening (you hear it clicking)
 *   predict       0..1, how far it reads ahead along the way you were heading when it loses you
 *   searchPoints  spots it checks around where it lost you; searchRadius, how far around
 *   ambush        when you escape into a crawl, it goes round to wait at the other end
 *   bumpGrace     walking into it while it has not noticed you makes it recoil and freeze instead of grabbing
 *   sonar         how far its click-sonar reaches; sonarWarn, seconds from the first click to the echo
 *                 that finds anything moving; sonarCrouch, crouched movement is safe from it
 *   burn          seconds your beam must hold it before it breaks and runs; burnLearn, seconds it adds
 *                 each time it has been driven off (it gets used to your light)
 *   stalk         chance that, having lost you, it follows your footsteps instead of giving up;
 *                 stalkClose, metres it closes in for each of your steps it hears
 *   hints         short on-screen hints the first time each of its tricks shows up
 *   finaleGuess   seconds between its guesses at where you are after the last core; finaleJitter, how
 *                 rough each guess is (fraction of the distance); finaleNear, the range where it is exact
 * The motion tracker:
 *   trkRange      metres it sees, in a straight line through rock
 *   trkBattery    seconds a full battery lasts; trkStart, charge at the start of a level; trkRefill, what
 *                 one battery adds; trkCells, the share of a level's battery spots that hold one
 *   trkNoise      metres of path its tick carries (before the creature's hearing)
 *   trkFreeze     chance a calm creature hearing its first tick goes silent and still; trkListen, chance
 *                 it stops to listen instead (otherwise it comes to look)
 *   trkNotice     ticks heard within a few seconds that give you away (0: never)
 *   trkBehind     whether a contact behind you lights the edge of the screen
 *   trkJitter     metres of wobble on each blip (more while you move); trkFade, seconds a blip lasts
 */
export const DIFFICULTY = {
  easy: {
    label: 'Easy', blurb: 'Signal reads while you move. It hears less, reacts slower and gives up sooner.',
    hearing: 0.7, speed: 0.85, heat: 0.75, dotLife: 24, signalStill: 0, tintFlesh: true, staticRange: 10,
    dashTime: 0.9, huntWarn: 0.7, huntCycles: 2,
    lightHold: 1.2, alertTime: 1.15, lungeMax: 1.0, listen: 1, predict: 0, searchPoints: 1, searchRadius: 5, ambush: false, bumpGrace: true,
    sonar: 7, sonarWarn: 1.2, sonarCrouch: true, burn: 1.5, burnLearn: 0, stalk: 0.2, stalkClose: 0.12, hints: true,
    finaleGuess: 2.5, finaleJitter: 0.2, finaleNear: 6,
    trkRange: 26, trkBattery: 110, trkStart: 0.8, trkRefill: 0.5, trkCells: 1, trkNoise: 2.5,
    trkFreeze: 0, trkListen: 0.3, trkNotice: 0, trkBehind: true, trkJitter: 0.3, trkFade: 2.4,
  },
  normal: {
    label: 'Normal', blurb: 'Stand still to read the signal. It hunts by sound and searches where it lost you.',
    hearing: 1, speed: 1, heat: 1, dotLife: 20, signalStill: 0.5, tintFlesh: false, staticRange: 10,
    dashTime: 1.0, huntWarn: 0.55, huntCycles: 3,
    lightHold: 0.7, alertTime: 0.85, lungeMax: 1.2, listen: 1.3, predict: 0.6, searchPoints: 3, searchRadius: 7, ambush: true,
    sonar: 10, sonarWarn: 0.9, sonarCrouch: false, burn: 2.5, burnLearn: 1, stalk: 0.45, stalkClose: 0.25, hints: true,
    finaleGuess: 1.5, finaleJitter: 0.12, finaleNear: 8,
    trkRange: 20, trkBattery: 72, trkStart: 0.5, trkRefill: 0.4, trkCells: 0.75, trkNoise: 3.5,
    trkFreeze: 0.3, trkListen: 0.3, trkNotice: 4, trkBehind: true, trkJitter: 0.6, trkFade: 2.0,
  },
  hard: {
    label: 'Hard', blurb: 'Dots fade faster and the signal settles slower. It reacts fast, listens hard and cuts you off.',
    hearing: 1.25, speed: 1.1, heat: 1.2, dotLife: 14, signalStill: 1.2, tintFlesh: false, staticRange: 14,
    dashTime: 1.0, huntWarn: 0.5, huntCycles: 3,
    lightHold: 0.45, alertTime: 0.6, lungeMax: 1.5, listen: 1.6, predict: 1, searchPoints: 5, searchRadius: 9, ambush: true,
    sonar: 13, sonarWarn: 0.65, sonarCrouch: false, burn: 3.5, burnLearn: 1, stalk: 0.7, stalkClose: 0.35, hints: false,
    finaleGuess: 1, finaleJitter: 0.06, finaleNear: 12,
    trkRange: 16, trkBattery: 56, trkStart: 0.35, trkRefill: 0.35, trkCells: 0.5, trkNoise: 4.5,
    trkFreeze: 0.55, trkListen: 0.25, trkNotice: 3, trkBehind: false, trkJitter: 1.0, trkFade: 1.3,
  },
};
