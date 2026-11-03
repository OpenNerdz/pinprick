// Removing a stored key, with and without working storage, and Input's intent contract with a fake DOM.
import {test} from 'node:test';
import assert from 'node:assert/strict';

function fakeStorage() {
  const m = new Map();
  return {m, getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k)};
}

test('forget removes a key from storage and from the in-memory fallback', async () => {
  const ls = fakeStorage();
  Object.defineProperty(globalThis, 'localStorage', {value: ls, configurable: true});
  const {save, has, forget, load} = await import('../src/util/storage.js');
  save('memory', {v: 1});
  assert.equal(has('memory'), true);
  assert.ok(ls.m.has('pinprick.v2.memory'), 'under the key the creature\'s memory uses');
  forget('memory');
  assert.equal(has('memory'), false);
  assert.equal(ls.m.has('pinprick.v2.memory'), false);
  assert.deepEqual(load('memory', {blank: true}), {blank: true});
  Object.defineProperty(globalThis, 'localStorage', {get() { throw new Error('blocked'); }, configurable: true});
  save('memory', {v: 2});
  assert.equal(has('memory'), true, 'kept in memory where storage is blocked');
  forget('memory');
  assert.equal(has('memory'), false);
  delete globalThis.localStorage;
});

// just enough of a browser for ui/input.js
function fakeInput(Input, pads) {
  const on = {};
  const el = () => ({hidden: false, style: {}, firstElementChild: {style: {}}, classList: {toggle() {}, remove() {}}, getBoundingClientRect: () => ({left: 0, top: 0, width: 0, height: 0}), addEventListener: (t, f) => { (on[t] ||= []).push(f); }, setPointerCapture() {}});
  const stage = el();
  stage.getBoundingClientRect = () => ({left: 0, top: 0, width: 400, height: 800});
  globalThis.document = {addEventListener() {}, pointerLockElement: null, hidden: false};
  globalThis.matchMedia = () => ({matches: false});
  globalThis.addEventListener = (t, f) => { (on[t] ||= []).push(f); };
  globalThis.performance ??= {now: () => 0};
  const input = new Input(stage, {requestPointerLock() {}}, {fire: el(), sweep: el(), crouch: el(), track: el(), throwStone: el(), breath: el(), stick: el()}, {lookSpeed: 1, invertY: false, swap: false});
  input.gamepad.source = () => [pads.value];
  const key = (code, down, extra = {}) => on[down ? 'keydown' : 'keyup'].forEach(f => f({code, repeat: false, preventDefault() {}, ...extra}));
  return {input, key, on};
}

function pad() {
  return {id: 'fake', connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: Array.from({length: 17}, () => ({pressed: false, value: 0}))};
}
const press = (p, i, on = true) => { p.buttons[i] = {pressed: on, value: on ? 1 : 0}; };

test('intent: throwStone is one frame per press, holdBreath is while held, from keys and from the pad', async () => {
  const {Input} = await import('../src/ui/input.js');
  const pads = {value: null}, {input, key} = fakeInput(Input, pads);
  input.enabled = true;
  key('KeyG', true);
  assert.equal(input.frame(0.016).throwStone, true);
  assert.equal(input.frame(0.016).throwStone, false);
  key('KeyG', false); assert.equal(input.frame(0.016).throwStone, false);
  key('KeyB', true);
  assert.equal(input.frame(0.016).holdBreath, true);
  assert.equal(input.frame(0.016).holdBreath, true);
  key('KeyB', false);
  assert.equal(input.frame(0.016).holdBreath, false);

  const p = pads.value = pad();
  input.pollPad(0.016); input.frame(0.016);
  press(p, 5); input.pollPad(0.016);
  assert.equal(input.frame(0.016).throwStone, true);
  input.pollPad(0.016);
  assert.equal(input.frame(0.016).throwStone, false, 'RB held is still one throw');
  press(p, 4); input.pollPad(0.016);
  assert.equal(input.frame(0.016).holdBreath, true);
  press(p, 4, false); input.pollPad(0.016);
  assert.equal(input.frame(0.016).holdBreath, false);
});

test('the pad feeds the same intent as the mouse, including look speed and invert', async () => {
  const {Input} = await import('../src/ui/input.js');
  const pads = {value: null}, {input} = fakeInput(Input, pads);
  input.enabled = true;
  const p = pads.value = pad();
  input.pollPad(0.016); input.frame(0.016);
  p.axes[1] = -1; p.axes[2] = 0.5;
  input.pollPad(0.016);
  const o = input.frame(0.016);
  assert.ok(o.moveY > 0.99, 'stick forward walks forward');
  assert.ok(o.lookX > 0, 'stick right turns right');
  const base = o.lookX;
  input.settings.lookSpeed = 2;
  input.pollPad(0.016);
  assert.ok(Math.abs(input.frame(0.016).lookX - base * 2) < 1e-6, 'the look speed setting applies');
  p.axes[2] = 0; p.axes[3] = -1;
  input.settings.lookSpeed = 1;
  input.pollPad(0.016);
  const up = input.frame(0.016).lookY;
  assert.ok(up < 0);
  input.settings.invertY = true;
  input.pollPad(0.016);
  assert.ok(input.frame(0.016).lookY > 0, 'invert applies');
  p.axes[3] = 0;
  press(p, 7); input.pollPad(0.016);
  assert.equal(input.frame(0.016).firing, true);
  press(p, 0); input.pollPad(0.016); p.axes[1] = -1;
  assert.equal(input.frame(0.016).sprint, true);
});

test('menu presses do not leak into play, and an unplugged pad pauses', async () => {
  const {Input} = await import('../src/ui/input.js');
  const pads = {value: null}, {input} = fakeInput(Input, pads);
  const menu = [], pauses = [];
  input.onMenu = a => menu.push(a);
  input.onPause = w => pauses.push(w);
  const p = pads.value = pad();
  input.pollPad(0.016);
  press(p, 0); input.pollPad(0.016);
  assert.deepEqual(menu, [], 'the press that wakes a menu chooses nothing');
  press(p, 0, false); input.pollPad(0.016);
  press(p, 0); input.pollPad(0.016);
  assert.deepEqual(menu, ['accept']);
  input.enabled = true; // Start pressed: A is still down as the level begins
  input.pollPad(0.016);
  p.axes[1] = -1;
  assert.equal(input.frame(0.016).sprint, false, 'A held over from the menu does not sprint');
  pads.value = null;
  input.pollPad(0.016);
  assert.deepEqual(pauses, ['pad']);
  assert.equal(input.padActive, false);
});

test('mouse buttons are worked out from `buttons`: a chord cannot stick the scanner on', async () => {
  const {Input} = await import('../src/ui/input.js');
  const pads = {value: null}, {input} = fakeInput(Input, pads);
  input.enabled = true; input.noLock = false;
  globalThis.document.pointerLockElement = input.canvas;
  input.chord({buttons: 1});
  assert.equal(input.frame(0.016).firing, true);
  input.chord({buttons: 3}); // right pressed during the scan: no pointerdown for this one
  const o = input.frame(0.016);
  assert.equal(o.sweep, true); assert.equal(o.firing, true);
  input.chord({buttons: 2}); // left let go with right still down: no pointerup either
  assert.equal(input.frame(0.016).firing, false);
  input.chord({buttons: 6});
  assert.equal(input.frame(0.016).track, true);
  input.chord({buttons: 0});
  // the click that captures the mouse does not fire
  globalThis.document.pointerLockElement = null;
  input.btns = 1;
  globalThis.document.pointerLockElement = input.canvas;
  input.chord({buttons: 1});
  assert.equal(input.frame(0.016).firing, false);
  delete globalThis.document; delete globalThis.matchMedia; delete globalThis.addEventListener;
});
