// The controller, with a fake Gamepad API: curves, deadzones, edges, and menus against play.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {radial, lookCurve, lookRates, GamepadReader, DEAD_LOOK, YAW_RATE, PITCH_RATE} from '../src/ui/gamepad.js';

const BUTTONS = 17;
function fakePad(over = {}) {
  return {id: 'fake', connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({length: BUTTONS}, () => ({pressed: false, value: 0})), ...over};
}
const reader = pad => new GamepadReader(() => [pad.value]);
const press = (p, i, on = true) => { p.buttons[i] = {pressed: on, value: on ? 1 : 0}; };
const A = 0, B = 1, LT = 6, RT = 7, START = 9, UP = 12;

test('deadzone: nothing inside it, a smooth start outside it, still reaching full', () => {
  assert.deepEqual(radial(0.1, 0.05, 0.18), [0, 0]);
  const [x] = radial(0.2, 0, 0.18);
  assert.ok(x > 0 && x < 0.05, 'no jump at the edge of the deadzone');
  const [fx, fy] = radial(0.8, 0.8, 0.18);
  assert.ok(Math.abs(Math.hypot(fx, fy) - 1) < 1e-9, 'full deflection is full speed');
});

test('look curve: gentle in the middle, full at the rim, never backwards', () => {
  assert.equal(lookCurve(0), 0);
  assert.equal(lookCurve(1), 1);
  assert.ok(lookCurve(0.5) < 0.25, 'half the stick is well under half the speed');
  for (let m = 0.1; m <= 1; m += 0.1) assert.ok(lookCurve(m) > lookCurve(m - 0.1));
});

test('look rates: drift is ignored, full stick is the stated rate, and a held stick speeds up only sideways', () => {
  assert.deepEqual(lookRates(DEAD_LOOK * 0.8, 0), [0, 0]);
  assert.ok(Math.abs(lookRates(1, 0)[0] - YAW_RATE) < 1e-9);
  assert.ok(Math.abs(lookRates(0, -1)[1] + PITCH_RATE) < 1e-9, 'pushing forward looks up (negative, like the mouse)');
  assert.ok(lookRates(1, 0, 2)[0] > YAW_RATE * 1.4);
  assert.ok(Math.abs(lookRates(0, 1, 2)[1] - PITCH_RATE) < 1e-9);
});

test('edges fire for one poll only, and triggers have a press and a release depth', () => {
  const pad = {value: fakePad()}, g = reader(pad);
  g.poll(0.016);
  press(pad.value, A); g.poll(0.016);
  assert.equal(g.just('a'), true); assert.equal(g.held('a'), true); assert.equal(g.touched, true);
  g.poll(0.016);
  assert.equal(g.just('a'), false); assert.equal(g.held('a'), true); assert.equal(g.touched, false);

  pad.value.buttons[RT] = {pressed: false, value: 0.2}; g.poll(0.016);
  assert.equal(g.held('rt'), false, 'too shallow to press');
  pad.value.buttons[RT] = {pressed: false, value: 0.4}; g.poll(0.016);
  assert.equal(g.held('rt'), true);
  pad.value.buttons[RT] = {pressed: false, value: 0.2}; g.poll(0.016);
  assert.equal(g.held('rt'), true, 'still held at a depth that would not have pressed it');
  pad.value.buttons[RT] = {pressed: false, value: 0.1}; g.poll(0.016);
  assert.equal(g.held('rt'), false);
});

test('a button held across a switch between menu and play counts for nothing until let go', () => {
  const pad = {value: fakePad()}, g = reader(pad);
  press(pad.value, A); g.poll(0.016);
  g.blockHeld();
  g.poll(0.016);
  assert.equal(g.held('a'), false);
  press(pad.value, A, false); g.poll(0.016);
  press(pad.value, A); g.poll(0.016);
  assert.equal(g.held('a'), true);
  assert.equal(g.just('a'), true);
});

test('menu navigation repeats after a pause, and a stick already pushed over does not scroll', () => {
  const pad = {value: fakePad()}, g = reader(pad);
  g.poll(0.016);
  press(pad.value, UP); g.poll(0.016);
  assert.equal(g.nav(0.016), 'up');
  assert.equal(g.nav(0.1), null);
  let fired = 0;
  for (let i = 0; i < 20; i++) if (g.nav(0.05)) fired++;
  assert.ok(fired >= 3 && fired <= 8, 'repeats while held: ' + fired);
  press(pad.value, UP, false); g.poll(0.016); assert.equal(g.nav(0.016), null);

  pad.value.axes[1] = -1; g.poll(0.016); g.blockHeld();
  assert.equal(g.nav(0.016), null, 'walking forward into a sheet must not move its focus');
  pad.value.axes[1] = 0; g.poll(0.016); assert.equal(g.nav(0.016), null);
  pad.value.axes[1] = -1; g.poll(0.016); assert.equal(g.nav(0.016), 'up');
});

test('a pad that comes and goes, and one the browser has no layout for', () => {
  const pad = {value: null}, g = reader(pad);
  g.poll(0.016); assert.equal(g.connected, false);
  pad.value = fakePad(); g.poll(0.016); assert.equal(g.connected, true);
  pad.value = null; g.poll(0.016);
  assert.equal(g.connected, false);
  assert.equal(g.rx, 0);

  // triggers as axes at rest at -1, right stick on 3 and 4: the view must not spin by itself
  pad.value = fakePad({mapping: '', axes: [0, 0, -1, 0.5, 0.25, -1]});
  g.poll(0.016);
  assert.equal(g.rx, 0.5); assert.equal(g.ry, 0.25);
  assert.equal(g.held('lt'), false);
  pad.value.axes[5] = 1; g.poll(0.016);
  assert.equal(g.held('rt'), true);
});

test('a blocked or missing API reads as no pad at all', () => {
  const g = new GamepadReader(() => null);
  g.poll(0.016);
  assert.equal(g.connected, false);
  assert.ok(new GamepadReader().source, 'has a default source');
  void B; void LT; void START;
});
