// The motion tracker: it shows what moves and nothing else, it runs down and needs batteries, it
// shares your hands with the scanner, and the creature can hear it tick.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS} from '../src/levels/index.js';
import {Session} from '../src/game/session.js';
import {Camera} from '../src/render/camera.js';
import {DIFFICULTY, TRACKER} from '../src/config.js';

const noop = () => {};
const renderer = () => { const dots = {push: noop, total: 0, clear: noop}; return {setDots: () => dots, setGhosts: noop, setLevelMesh: noop, setActors: noop, addLine: noop, addFan: noop}; };
/** A session whose sounds are recorded as [name, ...args]. */
const make = (def, difficulty = 'normal', seed = 3, opts = {}) => {
  const says = [], calls = [];
  const sounds = new Proxy({e: {listener: {x: 0, z: 0, yaw: 0}}}, {get: (t, k) => (k in t ? t[k] : (...a) => calls.push([k, ...a]))});
  const s = new Session(def, {difficulty, seed, renderer: renderer(), sounds, ui: {say: t => says.push(t), note: noop, caught: noop, won: noop, cores: noop}, ...opts});
  return {s, says, calls};
};
const intent = () => ({moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false, track: false});
const view = {w: 400, h: 800}, dt = 1 / 30;
const run = (s, from, secs, fn = intent) => { const cam = new Camera(); let t = from; for (; t < from + secs && s.state === 'play'; t += dt) s.update(dt, t, fn(t), cam, view); return t; };
const press = (k) => () => ({...intent(), [k]: true});
/** Raise the tracker and wait until it is fully up and booted. */
const raise = (s, t) => run(s, run(s, t, dt, press('track')), 0.8);
const count = (calls, name) => calls.filter(c => c[0] === name).length;

/** Keep the creature walking back and forth between two points on a line of constant z. */
function pace(st, ax, bx, z, T) {
  if (st.state !== 'investigate' || !st.target) { st.enter('investigate', T); st.target = {x: bx, z}; }
  if (Math.hypot(st.x - st.target.x, st.z - st.target.z) < 0.6) st.target = {x: st.target.x === ax ? bx : ax, z};
}

/** Cistern, with the creature deaf and walking (or standing) where we put it. */
function scene(difficulty, px, pz, yaw, cx, cz, walk) {
  const {s, says, calls} = make(LEVELS[2], difficulty), st = s.stalker, p = s.player;
  p.x = px; p.z = pz; p.yaw = yaw;
  st.wake(); st.x = cx; st.z = cz; st.hear = noop;
  if (!walk) { st.enter('wait', 0); st.timer = 999; }
  s.tracker.battery = 1;
  return {s, st, p, says, calls, step: walk ? T => { pace(st, walk[0], walk[1], cz, T); return intent(); } : intent};
}

test('it shows a creature that moves, ahead of you, even through rock; not one that stands still', () => {
  for (const [what, px, cx, walk, want] of [['walking ahead', 14, 24, [22, 28], true], ['standing ahead', 14, 24, null, false], ['walking beyond the wall', 6, 16, [14, 20], true]]) {
    const {s, step, calls} = scene('normal', px, px === 6 ? 4 : 3, Math.PI / 2, cx, 3, walk);
    let t = raise(s, 0);
    let blips = 0;
    t = run(s, t, 4, T => { blips = Math.max(blips, s.tracker.blips.length); return step(T); });
    assert.equal(blips > 0, want, `${what}: ${blips} blips`);
    assert.equal(count(calls, 'trackerReturn') > 0, want, `${what}: return beeps`);
    assert.ok(count(calls, 'trackerPulse') >= 3, 'it ticks every second');
  }
});

test('behind you only the edge of the screen lights, and on Hard nothing does', () => {
  for (const [diff, want] of [['normal', true], ['hard', false]]) {
    const {s, step} = scene(diff, 28, 3, Math.PI / 2, 16, 3, [14, 20]);
    let t = raise(s, 0), edge = 0;
    run(s, t, 4, T => { edge = Math.max(edge, s.tracker.behindL, s.tracker.behindR); return step(T); });
    assert.equal(s.tracker.blips.length, 0, `${diff}: no blips for something behind you`);
    assert.equal(edge > 0, want, `${diff}: edge glow ${edge}`);
  }
});

test('beyond its reach it shows nothing, and low on charge its reach shrinks', () => {
  const far = scene('normal', 13, 3, Math.PI / 2, 40, 5, [38, 44]);
  run(far.s, raise(far.s, 0), 4, far.step);
  assert.equal(far.s.tracker.blips.length, 0, 'nothing 25 m away');
  const tr = far.s.tracker;
  tr.battery = 1; const full = tr.range; tr.battery = TRACKER.lowAt / 2;
  assert.ok(tr.range < full * 0.8, `range ${tr.range.toFixed(1)} of ${full}`);
});

test('the battery: a cost for every raise, a drain while it is up, and dead at zero', () => {
  const {s, says, calls} = make(LEVELS[1]), tr = s.tracker, h = s.hands, d = DIFFICULTY.normal;
  assert.ok(tr.owned, 'you start the level with it');
  assert.equal(tr.battery, d.trkStart);
  let t = raise(s, 0);
  t = run(s, t, 4);
  const used = d.trkStart - tr.battery, upFor = 4.8 - TRACKER.raise;
  assert.ok(Math.abs(used - (TRACKER.bootCost + upFor) / d.trkBattery) < 0.015, `used ${used.toFixed(3)}`);
  // flicking it up and down saves nothing: each full raise costs the boot
  t = run(s, t, dt, press('track')); t = run(s, t, 0.5);
  const b0 = tr.battery;
  for (let k = 0; k < 5; k++) { t = raise(s, t); t = run(s, t, dt, press('track')); t = run(s, t, 0.4); }
  assert.ok(b0 - tr.battery > 5 * TRACKER.bootCost / d.trkBattery, `5 quick looks cost ${(b0 - tr.battery).toFixed(3)}`);
  // run it flat: it dies, goes down, and will not come up again
  tr.battery = 0.01;
  t = raise(s, t); t = run(s, t, 2);
  assert.equal(tr.battery, 0); assert.equal(tr.on, false); assert.equal(h.want, 'gun');
  assert.ok(says.some(x => /tracker is dead/.test(x)), 'it says so');
  assert.ok(count(calls, 'trackerDead') === 1, 'it died with a whine');
  t = run(s, t, dt, press('track')); t = run(s, t, 1);
  assert.ok(h.trk < 0.01 && !tr.on, 'a dead tracker stays down');
  assert.ok(count(calls, 'trackerClick') === 1, 'with a dead click');
});

test('batteries: picked up when you need one, left when you are full, and put back when you die', () => {
  const {s, says} = make(LEVELS[1]), tr = s.tracker, p = s.player;
  assert.equal(s.batteries.length, Math.floor(4 * DIFFICULTY.normal.trkCells), 'three of the four spots on Normal');
  const [b1, b2] = s.batteries;
  p.x = b1.x; p.z = b1.z + 0.5; let t = run(s, 0, 0.2);
  assert.ok(b1.taken && !b1.prop.on, 'taken');
  assert.ok(Math.abs(tr.battery - (DIFFICULTY.normal.trkStart + DIFFICULTY.normal.trkRefill)) < 1e-6, `charge ${tr.battery}`);
  assert.ok(says.some(x => /Battery\. Tracker at 90%/.test(x)), says.join(' | '));
  tr.battery = 0.97;
  p.x = b2.x; p.z = b2.z + 0.5; t = run(s, t, 0.2);
  assert.ok(!b2.taken, 'left for later when the tracker is full');
  // caught: back to the last checkpoint (the start), and so are the charge and the battery
  const snap = s.snapshot();
  s.respawn();
  assert.equal(tr.battery, DIFFICULTY.normal.trkStart);
  assert.ok(!b1.taken && b1.prop.on, 'the battery is back where it was');
  // a hot reload keeps what you had
  const {s: s2} = make(LEVELS[1]);
  s2.restore(snap);
  assert.equal(s2.tracker.battery, 0.97);
  assert.ok(s2.batteries[0].taken && !s2.batteries[0].prop.on);
});

test('the first level hands it to you on a bench', () => {
  const {s, says} = make(LEVELS[0]), tr = s.tracker, lt = s.L.tracker, p = s.player;
  assert.equal(tr.owned, false);
  let t = run(s, 0, dt, press('track')); t = run(s, t, 0.6);
  assert.ok(s.hands.trk < 0.01, 'nothing to raise yet');
  p.x = lt.x; p.z = lt.z - 0.65; t = run(s, t, 0.2);
  assert.ok(tr.owned && lt.taken && tr.battery === 0.5, 'picked up, half charged');
  assert.ok(says.some(x => typeof x === 'object' && /Press Q/.test(x.mouse) && /Tap TRACK/.test(x.touch)), 'and told how to use it');
});

test('it is in your other hand: you scan and sweep with it up, and sprinting puts it away', () => {
  const {s} = make(LEVELS[1]), h = s.hands, sc = s.scanner;
  let t = raise(s, 0);
  assert.ok(h.trackerUp && s.tracker.on && s.gunState(t), 'tracker up, scanner still in hand');
  t = run(s, t, 0.5, press('firing'));
  assert.ok(sc.firing && s.tracker.on, 'scanning with the tracker up');
  t = run(s, t, dt, press('sweep')); t = run(s, t, 0.3);
  assert.ok(sc.sweeping && s.tracker.on, 'and sweeping');
  t = run(s, t, 3);
  t = run(s, t, 0.6, () => ({...intent(), moveY: 1, sprint: true}));
  assert.equal(h.want, 'gun', 'sprinting put it away');
});

test('hiding means the tracker is down too', () => {
  const {s} = make(LEVELS[1]), p = s.player, hd = s.L.hides[0];
  p.x = hd.x; p.z = hd.z;
  let t = run(s, 0, dt, press('crouch'));
  t = run(s, t, 0.8);
  assert.ok(p.hidden, 'hidden');
  t = raise(s, t);
  assert.ok(!p.hidden, 'not with the tracker ticking');
});

test('the fake footsteps show up on it, through the wall', () => {
  const {s} = make(LEVELS[0]), tr = s.tracker, p = s.player;
  tr.owned = true; tr.battery = 1;
  p.x = 9; p.z = 24.5; p.yaw = -Math.PI / 2 + 0.6; // in the hall, facing west along it
  let t = raise(s, 0);
  s.scares.run(['steps', 16, 21, 3, 21, 11], t);
  let blips = 0;
  run(s, t, 6, () => { blips = Math.max(blips, tr.blips.length); return intent(); });
  assert.ok(blips >= 2, `${blips} blips from the footsteps`);
});

test('the return beep rises as something closes in', () => {
  const {s, calls} = make(LEVELS[2]), st = s.stalker, p = s.player;
  p.x = 13; p.z = 3; p.yaw = Math.PI / 2;
  st.wake(); st.x = 29; st.z = 3; st.hear = noop; s.tracker.battery = 1;
  let t = raise(s, 0);
  st.notice(p.x, p.z, t); st.enter('hunt', t);
  run(s, t, 8);
  const close = calls.filter(c => c[0] === 'trackerReturn').map(c => c[1]);
  assert.ok(close.length >= 3, `${close.length} beeps`);
  assert.ok(close[close.length - 1] > close[0] + 0.3, `closeness ${close.map(c => c.toFixed(2)).join(' ')}`);
});

// ---------------------------------------------------------------- what the creature makes of it

/** Calm creature in the cistern's north hall, the player a few metres off with the tracker up. */
function pingScene(diff, seed, gap) {
  const {s, says} = make(LEVELS[2], diff, seed), st = s.stalker, p = s.player;
  p.x = 14; p.z = 3; p.yaw = Math.PI / 2;
  st.wake(); st.x = 14 + gap; st.z = 3; st.enter('patrol', 0); st.target = {x: 29, z: 3};
  s.tracker.battery = 1;
  return {s, st, says};
}

test('it hears the tick up close, not from across the room', () => {
  for (const [gap, want] of [[3, true], [12, false]]) {
    const {s, st} = pingScene('normal', 5, gap);
    let reacted = false;
    const t = raise(s, 0);
    run(s, t, 1.6, () => { if (st.heardPing) reacted = true; return intent(); });
    assert.equal(reacted, want, `${gap} m away`);
  }
});

test('on Hard the first tick often makes it go still (which the tracker cannot see); on Easy never', () => {
  const froze = {easy: 0, hard: 0}, N = 20;
  for (const diff of ['easy', 'hard']) for (let k = 0; k < N; k++) {
    const {s, st} = pingScene(diff, 100 + k, diff === 'easy' ? 1.4 : 3);
    let f = false;
    run(s, raise(s, 0), 1.4, () => { if (st.state === 'wait' && st.afterPing) f = true; return intent(); });
    if (f) froze[diff]++;
  }
  assert.equal(froze.easy, 0);
  assert.ok(froze.hard >= 5 && froze.hard <= 17, `Hard froze ${froze.hard} of ${N} times`);
});

test('having gone still at the tick, it then comes to look where the tick came from', () => {
  for (let k = 0; k < 20; k++) {
    const {s, st} = pingScene('hard', 100 + k, 5);
    let t = raise(s, 0);
    t = run(s, t, 1.2);
    if (!(st.state === 'wait' && st.afterPing)) continue;
    t = run(s, t, dt, press('track')); // put it away before the ticks add up
    st.timer = 0.1;
    run(s, t, 0.5);
    assert.equal(st.state, 'investigate');
    assert.ok(Math.hypot(st.target.x - 14, st.target.z - 3) < 2.5, `looking at ${st.target.x.toFixed(1)},${st.target.z.toFixed(1)}`);
    return;
  }
  assert.fail('never froze');
});

test('keep ticking at it and it works out where you are; a stalker pounces on the tick', () => {
  const {s, st} = pingScene('hard', 7, 4);
  run(s, raise(s, 0), 5);
  assert.ok(st.state === 'alert' || st.state === 'hunt' || s.state !== 'play', `Hard after 5 s of ticking: ${st.state}`);
  const b = make(LEVELS[2], 'normal'), st2 = b.s.stalker, p = b.s.player;
  p.x = 14; p.z = 35; st2.wake(); st2.x = 9; st2.z = 35; st2.fix(p.x, p.z, 0); st2.enter('stalk', 0); b.s.tracker.battery = 1;
  run(b.s, raise(b.s, 0), 3);
  assert.ok(st2.state === 'hunt' || b.s.state !== 'play', `stalker after a tick: ${st2.state}`);
});

test('the title-screen demo has no tracker', () => {
  const {s} = make(LEVELS[1], 'normal', 3, {demo: true});
  assert.equal(s.tracker, null);
  assert.equal(s.trackerState(0), null);
});

test('when the cell gives out the tube dies in your hand, and only then does it go down', () => {
  const {s} = make(LEVELS[1]), h = s.hands, tr = s.tracker;
  let t = raise(s, 0);
  tr.battery = 0.001;
  t = run(s, t, 0.5);
  assert.equal(tr.battery, 0); assert.equal(tr.on, false);
  assert.equal(h.want, 'gun', 'it has stopped being up, for every rule that asks');
  assert.equal(h.trackerUp, false);
  assert.ok(h.trk > 0.9 && h.dying > 0, 'but it is still in your hand');
  assert.ok(s.trackerState(t), 'and you can see it');
  t = run(s, t, 1.2);
  assert.ok(h.trk < 0.01, 'then it drops');
});

test('sprinting does not wait for a tube to die', () => {
  const {s} = make(LEVELS[1]), h = s.hands, tr = s.tracker;
  let t = raise(s, 0);
  tr.battery = 0.001;
  t = run(s, t, 0.3, () => ({...intent(), moveY: 1, sprint: true}));
  assert.equal(h.dying, 0);
});

test('the tube follows the switch: blooming up, full, and collapsing when it goes off', () => {
  const {s} = make(LEVELS[1]), h = s.hands, tr = s.tracker, vm = s.viewmodel;
  let t = run(s, 0, dt, press('track'));
  while (!tr.on) t = run(s, t, dt);
  t = run(s, t, dt);
  assert.ok(vm.crtH < 0.1, `a line at first (${vm.crtH})`);
  t = run(s, t, TRACKER.boot + 0.5);
  assert.equal(vm.crtH, 1); assert.equal(vm.crtW, 1);
  assert.ok(vm.crtPower > 0.99, 'and settled');
  t = run(s, t, dt, press('track')); t = run(s, t, dt);
  assert.ok(vm.crtH < 1 && vm.crtPower > 0, 'squeezing down');
  t = run(s, t, 0.5);
  assert.equal(vm.crtPower, 0, 'dark');
  assert.ok(h.trk < 0.5);
});

test('its hands shake harder as what it found gets closer', () => {
  const {s} = make(LEVELS[1]), tr = s.tracker, vm = s.viewmodel;
  const settle = gap => {
    let t = raise(s, 0);
    tr.blips.length = 0;
    const p = s.player, R = tr.diff.trkRange;
    for (let i = 0; i < 40; i++) { tr.blips[0] = {x: p.x + Math.sin(p.yaw) * gap * R, z: p.z - Math.cos(p.yaw) * gap * R, t}; t = run(s, t, dt); }
    return vm.tremble;
  };
  const far = settle(0.9), near = settle(0.2);
  assert.ok(near > far * 3, `${far} far, ${near} near`);
});

test('the range window reads the nearest blip still glowing, and dashes with none', () => {
  const {s} = make(LEVELS[1]), tr = s.tracker;
  let t = raise(s, 0); t = run(s, t, 0.6);
  const window = () => [...s.trackerState(t).e].slice(0, 3);
  assert.deepEqual(window(), [0x40, 0x40, 0x40], 'dashes');
  const p = s.player;
  tr.flood = 0;
  tr.blips.push({x: p.x + Math.sin(p.yaw) * 12.3, z: p.z - Math.cos(p.yaw) * 12.3, t}, {x: p.x + Math.sin(p.yaw) * 19, z: p.z - Math.cos(p.yaw) * 19, t});
  assert.deepEqual(window(), [0x06, 0x5b, 0x4f], '12.3 m');
});

test('with an empty battery, trying it flips the switch and it lifts into view', () => {
  const {s, calls} = make(LEVELS[1]), h = s.hands, tr = s.tracker;
  tr.battery = 0;
  let t = run(s, 0, dt, press('track'));
  assert.equal(count(calls, 'trackerClick'), 1);
  assert.ok(h.peek > 0.9 && s.trackerState(t), 'it is drawn');
  t = run(s, t, 0.25);
  assert.ok(s.viewmodel.tUp.x > 0.3, `lifted ${s.viewmodel.tUp.x}`);
  assert.ok(s.viewmodel.tToggle.x < 0, 'switch up');
  t = run(s, t, 1.2);
  assert.ok(s.viewmodel.tToggle.x > 0, 'and fallen back');
  assert.equal(s.trackerState(t), null);
});

