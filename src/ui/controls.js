// What every control does, for each way of playing. The pause sheet shows the set in use and the
// controls sheet shows them all, so the wording lives here once.

const SCAN = 'paint the dark. It heats up';
const SWEEP = 'one full picture of the room. Loud';
const CROUCH = 'quiet, fits the crawls, hides you in dark corners';
const TRACK = 'the motion tracker: what moves, through rock. Runs on batteries; ticks';
const THROW = 'toss a stone: it goes to the noise';
const BREATH = 'hold your breath while it is close. Your lungs run out';

export const keyboardRows = () => [
  ['W A S D', 'walk (up and down arrows too)'],
  ['Shift', 'sprint'],
  ['Mouse', 'look around (click to capture it; left and right arrows turn)'],
  ['Hold click', SCAN + ' (Space works too)'],
  ['F, E or right click', SWEEP],
  ['C', CROUCH],
  ['Q or middle click', TRACK],
  ['G', THROW],
  ['Hold B', BREATH],
  ['M', 'sound on and off'],
  ['Esc or P', 'pause'],
];

// where the page cannot capture the mouse (some embedded viewers)
export const dragRows = () => [
  ['W A S D', 'walk'],
  ['Shift', 'sprint'],
  ['Drag', 'look around (arrow keys walk and turn too)'],
  ['Hold Space', SCAN],
  ['F, E or right click', SWEEP],
  ['C', CROUCH],
  ['Q', TRACK],
  ['G', THROW],
  ['Hold B', BREATH],
  ['M', 'sound on and off'],
  ['Esc or P', 'pause'],
];

export const touchRows = lefty => [
  [lefty ? 'Right thumb' : 'Left thumb', 'walk, push past the ring to sprint'],
  [lefty ? 'Left thumb' : 'Right thumb', 'look around'],
  ['Hold scan', SCAN + '. Drag to aim'],
  ['Sweep', SWEEP],
  ['Crouch', CROUCH],
  ['Track', TRACK],
  ['Throw', THROW],
  ['Breath', 'hold: ' + BREATH],
  ['Top corner', 'pause, sound on and off'],
];

export const padRows = () => [
  ['Left stick', 'walk'],
  ['A or left stick click', 'sprint'],
  ['Right stick', 'look around'],
  ['RT', SCAN],
  ['LT or X', SWEEP],
  ['B or right stick click', CROUCH],
  ['Y', TRACK],
  ['RB', THROW],
  ['Hold LB', BREATH],
  ['Start', 'pause'],
  ['In menus', 'D-pad or left stick moves, A chooses, B goes back'],
];

/** Rows as list items; the text is ours, so plain HTML is safe. */
export function rowsHtml(rows) {
  return rows.map(([k, v]) => `<li style="display:contents"><b>${k}</b><span>${v}</span></li>`).join('');
}
