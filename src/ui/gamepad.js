// The Gamepad API turned into named buttons and shaped sticks. The API has no events worth using, so
// this is polled once a frame, in menus too. Nothing here touches the DOM or the game: input.js maps
// it to the same intent the mouse and keys feed.

export const DEAD_MOVE = 0.18;    // radial deadzones: wide enough for a worn stick's drift
export const DEAD_LOOK = 0.14;
export const YAW_RATE = 2.7;      // radians a second at full deflection, at look speed 1
export const PITCH_RATE = 1.7;    // slower: the view has less room to travel up and down
const BOOST = 0.55;               // a stick held hard over speeds up by this much, for turning round
const BOOST_AFTER = 0.2;          // ...after this many seconds pinned
const BOOST_RAMP = 0.45;          // ...over this many seconds
const PINNED_AT = 0.92;
const TRIGGER_ON = 0.3;           // triggers press and release at different depths, so they cannot chatter
const TRIGGER_OFF = 0.15;
const WOKEN_AT = 0.35;            // a stick past this means someone is holding the pad
const NAV_AT = 0.55;              // menu navigation with the stick
const NAV_FIRST = 0.36;           // seconds before a held direction starts repeating
const NAV_REPEAT = 0.13;

// the "standard" layout: https://w3c.github.io/gamepad/#remapping
const BUTTONS = {a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, l3: 10, r3: 11, up: 12, down: 13, left: 14, right: 15};
const NAMES = Object.keys(BUTTONS);

/** Radial deadzone, rescaled so that output still starts at 0 and reaches 1. */
export function radial(x, y, dead) {
  const m = Math.hypot(x, y);
  if (m <= dead || !(m > 0)) return [0, 0];
  const k = Math.min(1, (m - dead) / (1 - dead)) / m;
  return [x * k, y * k];
}

/** Stick travel to turn speed, 0..1: nearly flat near the middle for fine aim, full speed at the rim. */
export function lookCurve(m) { return 0.25 * m + 0.75 * m * m * m; }

/**
 * Turn rates (radians a second) from raw right stick values. `pinned` is how long the stick has been
 * held hard over; the extra speed only applies to turning, never to looking up and down.
 */
export function lookRates(x, y, pinned = 0) {
  const [dx, dy] = radial(x, y, DEAD_LOOK), m = Math.hypot(dx, dy);
  if (m === 0) return [0, 0];
  const k = lookCurve(m) / m;
  const ramp = Math.max(0, Math.min(1, (pinned - BOOST_AFTER) / BOOST_RAMP));
  return [dx * k * YAW_RATE * (1 + BOOST * ramp), dy * k * PITCH_RATE];
}

function realPads() {
  try { return navigator.getGamepads ? navigator.getGamepads() : []; } catch (e) { return []; } // blocked by a viewer's permissions policy
}

export class GamepadReader {
  constructor(source = realPads) {
    this.source = source;
    this.index = -1;
    this.connected = false;
    this.pad = null;
    this.down = Object.create(null);
    this.prev = Object.create(null);
    this.blocked = new Set();
    this.lx = this.ly = this.rx = this.ry = 0;
    this.pinned = 0;
    this.touched = false;  // someone used it this frame
    this.axisGuess = null;
    this.navLast = null; this.navT = 0; this.navLatch = false;
  }

  /** Keep the pad in use while it stays plugged in; otherwise prefer one the browser could map. */
  pick(list) {
    const cur = list[this.index];
    if (cur && cur.connected) return cur;
    let best = null;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!p || !p.connected || p.axes.length < 2 || p.buttons.length < 4) continue;
      if (p.mapping === 'standard') { this.index = i; return p; }
      if (!best) { best = p; this.index = i; }
    }
    return best;
  }

  /** Where the right stick and triggers are. A pad without the standard layout gets a best guess. */
  readAxes(p) {
    const a = p.axes;
    this.lx = a[0] || 0; this.ly = a[1] || 0;
    if (p.mapping === 'standard' || a.length < 5) { this.rx = a[2] || 0; this.ry = a[3] || 0; return null; }
    // many unmapped pads report triggers as axes resting at -1: never take one of those for the look
    // stick, or the view would spin by itself
    if (!this.axisGuess || this.axisGuess.id !== p.id) this.axisGuess = {id: p.id, trig: a.map(v => v < -0.5)};
    const g = this.axisGuess, free = [], trig = [];
    for (let i = 2; i < a.length; i++) (g.trig[i] ? trig : free).push(i);
    this.rx = a[free[0]] || 0; this.ry = a[free[1]] || 0;
    return trig;
  }

  poll(dt, hidden = typeof document !== 'undefined' && document.hidden) {
    const list = hidden ? [] : this.source() || [];
    const p = this.pad = this.pick(list);
    const was = this.down;
    this.prev = was; this.down = Object.create(null);
    this.touched = false;
    if (!p) {
      this.connected = false; this.index = -1;
      this.lx = this.ly = this.rx = this.ry = this.pinned = 0;
      this.blocked.clear();
      return;
    }
    this.connected = true;
    const trig = this.readAxes(p);
    for (const name of NAMES) {
      const b = p.buttons[BUTTONS[name]];
      let on = false;
      if (name === 'lt' || name === 'rt') {
        let v = b ? (typeof b === 'object' ? b.value : b) : 0;
        if (trig && trig.length > (name === 'lt' ? 0 : 1) && !v) v = (p.axes[trig[name === 'lt' ? 0 : 1]] + 1) / 2;
        on = v >= (was[name] ? TRIGGER_OFF : TRIGGER_ON);
      } else if (b) on = typeof b === 'object' ? b.pressed : b >= 0.5;
      this.down[name] = on;
      if (!on) this.blocked.delete(name);
      else if (!was[name]) this.touched = true;
    }
    if (Math.hypot(this.lx, this.ly) > WOKEN_AT || Math.hypot(this.rx, this.ry) > WOKEN_AT) this.touched = true;
    this.pinned = Math.hypot(this.rx, this.ry) > PINNED_AT ? this.pinned + dt : 0;
  }

  /** Held right now, and not left over from before the last switch between menus and play. */
  held(name) { return !!this.down[name] && !this.blocked.has(name); }
  /** Went down this frame. */
  just(name) { return !!this.down[name] && !this.prev[name] && !this.blocked.has(name); }

  /** Everything held now must be let go before it counts: a menu's A must not also sprint, or a dying player's A retry. */
  blockHeld() {
    for (const name of NAMES) if (this.down[name]) this.blocked.add(name);
    this.navLatch = true;
  }

  /** The direction to move in a menu this frame, if any; a held direction repeats after a pause. */
  nav(dt) {
    let dir = null;
    const ax = Math.abs(this.lx), ay = Math.abs(this.ly);
    if (this.held('up')) dir = 'up';
    else if (this.held('down')) dir = 'down';
    else if (this.held('left')) dir = 'left';
    else if (this.held('right')) dir = 'right';
    else if (ay >= NAV_AT && ay >= ax) dir = this.ly < 0 ? 'up' : 'down';
    else if (ax >= NAV_AT) dir = this.lx < 0 ? 'left' : 'right';
    if (!dir) { this.navLast = null; this.navLatch = false; return null; }
    if (this.navLatch) return null;
    if (dir !== this.navLast) { this.navLast = dir; this.navT = NAV_FIRST; return dir; }
    if ((this.navT -= dt) <= 0) { this.navT = NAV_REPEAT; return dir; }
    return null;
  }
}
