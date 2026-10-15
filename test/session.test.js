// Gameplay without a browser: a bot plays levels through the real Session, and the creature's
// senses are checked directly. Rendering and sound are stubbed out.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS} from '../src/levels/index.js';
import {Session} from '../src/game/session.js';
import {Camera} from '../src/render/camera.js';
import {angleDiff} from '../src/util/math.js';

const noop = () => {};
function stubSounds() {
  const e = {listener: {x: 0, z: 0, yaw: 0}, place: () => ({pan: 0, dist: 1, front: 1}), now: 0};
  return new Proxy({e}, {get: (t, k) => (k in t ? t[k] : noop)});
}
function stubRenderer() {
  const dots = {push: noop, total: 0, clear: noop};
  return {setDots: () => dots, setGhosts: noop, setLevelMesh: noop, setActors: noop, addLine: noop, addFan: noop};
}
function makeSession(def, opts = {}) {
  const log = {says: [], notes: [], caught: 0, won: null};
  const ui = {say: t => log.says.push(t), note: n => log.notes.push(n), caught: () => log.caught++, won: s => { log.won = s; }, cores: noop};
  const s = new Session(def, {difficulty: 'normal', seed: 3, renderer: stubRenderer(), sounds: stubSounds(), ui, ...opts});
  return {s, log};
}
const intent = () => ({moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false});
const view = {w: 400, h: 800, lensX: 0.2, lensY: -0.6};

/** Walk the player to (tx, tz) along the walkable grid, crouching for crawls. Returns sim seconds used. */
function walkTo(s, tx, tz, cam, maxT = 120, quiet = false) {
  const p = s.player, nav = s.playerNav, dt = 1 / 30;
  let path = null, t = 0;
  for (let i = 0; t < maxT; i++, t += dt) {
    if (s.state !== 'play') return t;
    if (Math.hypot(p.x - tx, p.z - tz) < 0.6) return t;
    if (i % 8 === 0) path = nav.path(nav.field(p.x, p.z), tx, tz, 1.2);
    const it = intent();
    if (path && path.length > 1) {
      let k = Math.min(path.length - 1, 3);
      const wx = nav.cx(path[k]), wz = nav.cz(path[k]);
      it.lookX = angleDiff(p.yaw, Math.atan2(wx - p.x, -(wz - p.z)));
      it.moveY = 1;
      const low = path.slice(0, 6).some(c => s.world.heightAt(nav.cx(c), nav.cz(c)) < 1.75);
      if ((low || quiet) !== p.crouched) it.crouch = true;
    } else { it.moveY = 1; it.lookX = angleDiff(p.yaw, Math.atan2(tx - p.x, -(tz - p.z))); }
    s.update(dt, t, it, cam, view);
  }
  return t;
}

test('a bot can finish the tutorial: both cores, the door opens, the exit wins', () => {
  const {s, log} = makeSession(LEVELS[0]);
  const cam = new Camera();
  for (const c of s.cores) walkTo(s, c.x, c.z, cam);
  assert.equal(s.coresLeft, 0, 'collected every core');
  assert.equal(s.L.exitDoor.on, false, 'exit door opened');
  walkTo(s, s.exit.x, s.exit.z, cam);
  assert.equal(s.state, 'won');
  assert.ok(log.won && log.won.time > 0);
});

for (const def of LEVELS.slice(1)) {
  test(`${def.id}: with the creature asleep a bot reaches every core and the exit`, () => {
    const {s} = makeSession(def);
    s.stalker.sleep();
    s.stalker.wake = noop; s.stalker.enter = noop; // keep it out of the way for a pure route check
    const cam = new Camera();
    for (const c of s.cores) walkTo(s, c.x, c.z, cam, 200);
    assert.equal(s.coresLeft, 0, `collected every core, ${s.coresLeft} left`);
    walkTo(s, s.exit.x, s.exit.z, cam, 200);
    assert.equal(s.state, 'won');
  });
}

test('the creature hunts down a player who keeps scanning nearby', () => {
  const {s, log} = makeSession(LEVELS[2]);
  const st = s.stalker, cam = new Camera(), dt = 1 / 30;
  // stand 9 m of walking from it in the north hall, holding the trigger
  s.player.x = 34; s.player.z = 5; st.x = 42; st.z = 5; st.wake(); st.x = 43; st.z = 5;
  let t = 0;
  for (; t < 30 && s.state === 'play'; t += dt) {
    const it = intent(); it.firing = true;
    s.update(dt, t, it, cam, view);
  }
  assert.equal(s.state, 'caught', `still ${s.state} after ${t.toFixed(1)} s, creature ${st.state}`);
  assert.equal(s.deaths, 1);
  s.respawn();
  assert.equal(s.state, 'play');
  assert.ok(Math.hypot(st.x - s.player.x, st.z - s.player.z) > 8, 'respawned creature is far away');
  assert.ok(log.caught === 0, 'the caught screen only shows after the death animation');
});

test('a hidden player is not found even when it walks right past', () => {
  const {s} = makeSession(LEVELS[1]);
  const st = s.stalker, cam = new Camera(), dt = 1 / 30, h = s.L.hides[0];
  s.player.x = h.x; s.player.z = h.z; s.player.crouched = true;
  st.wake();
  st.x = h.x + 1.0; st.z = h.z + 1.6;
  st.state = 'patrol'; st.target = {x: h.x + 1.0, z: h.z - 2.5};
  for (let t = 0; t < 6; t += dt) s.update(dt, t, intent(), cam, view);
  assert.equal(s.player.hidden, true);
  assert.equal(s.state, 'play', 'not caught');
  assert.notEqual(st.state, 'hunt', 'never started hunting');
});

test('overheating cuts the scanner out until it cools', () => {
  const {s} = makeSession(LEVELS[0]);
  const cam = new Camera(), dt = 1 / 30;
  let t = 0, cut = -1;
  for (; t < 20; t += dt) {
    const it = intent(); it.firing = true;
    s.update(dt, t, it, cam, view);
    if (s.scanner.overheated) { cut = t; break; }
  }
  assert.ok(cut > 6 && cut < 13, `overheated after ${cut.toFixed(1)} s`);
  for (let k = 0; k < 30; k++) { const it = intent(); it.firing = true; s.update(dt, t += dt, it, cam, view); }
  assert.equal(s.scanner.firing, false, 'no scanning while overheated');
  for (let k = 0; k < 300 && s.scanner.overheated; k++) s.update(dt, t += dt, intent(), cam, view);
  assert.equal(s.scanner.overheated, false, 'recovers after cooling');
});

test('holding the scanner on it makes it freeze, turn, then charge on all fours', () => {
  const {s} = makeSession(LEVELS[1]);
  const st = s.stalker, cam = new Camera(), dt = 1 / 30;
  st.wake(); st.hear = () => {};           // deaf, so only the light can give you away
  st.x = 17; st.z = 16.5; st.enter('wait', 0); st.timer = 99;
  s.player.x = 17; s.player.z = 24.5; s.player.yaw = 0; s.player.pitch = 0.05;
  const seen = [];
  for (let t = 0; t < 6 && s.state === 'play'; t += dt) {
    const it = intent(); it.firing = true;
    s.update(dt, t, it, cam, view);
    if (seen[seen.length - 1] !== st.state) seen.push(st.state);
  }
  assert.deepEqual(seen.slice(0, 3), ['wait', 'alert', 'hunt'], `went ${seen.join(' > ')}`);
  assert.ok(st.actor.crawl > 0.5 || s.state === 'caught', 'drops to all fours to hunt');
});

test('it stops beside a hidden player, and finds them the moment they stand', () => {
  const {s, log} = makeSession(LEVELS[1]);
  const st = s.stalker, cam = new Camera(), dt = 1 / 30, h = s.L.hides[0];
  s.player.x = h.x; s.player.z = h.z; s.player.crouched = true;
  st.wake(); st.x = h.x + 1.0; st.z = h.z + 1.6; st.enter('patrol', 0); st.target = {x: h.x + 1.0, z: h.z - 2.5};
  let t = 0;
  for (; t < 1.5; t += dt) s.update(dt, t, intent(), cam, view);
  assert.equal(st.state, 'linger');
  assert.ok(log.says.includes("Don't move."));
  const it = intent(); it.crouch = true;   // stand up
  s.update(dt, t += dt, it, cam, view);
  for (let k = 0; k < 3; k++) s.update(dt, t += dt, intent(), cam, view);
  assert.ok(st.state === 'alert' || st.state === 'hunt' || s.state === 'caught', `state ${st.state}`);
  for (; t < 4 && s.state === 'play'; t += dt) s.update(dt, t, intent(), cam, view);
  assert.equal(s.state, 'caught', 'standing next to it, out of the hiding spot, it has you');
});

test('being caught: view snaps to it, then black, then the Caught screen', () => {
  const {s, log} = makeSession(LEVELS[2]);
  const st = s.stalker, cam = new Camera(), dt = 1 / 30;
  st.wake(); st.x = s.player.x + 0.8; st.z = s.player.z; st.enter('hunt', 0);
  s.player.yaw = Math.PI; // looking away from it
  let t = 0;
  s.update(dt, t, intent(), cam, view);
  assert.equal(s.state, 'caught');
  for (; t < 0.6; t += dt) s.update(dt, t, intent(), cam, view);
  assert.ok(Math.abs(Math.cos(s.player.yaw - Math.PI / 2)) > 0.9, 'turned to face it');
  assert.equal(s.fx.black, 0);
  for (; t < 1.5; t += dt) s.update(dt, t, intent(), cam, view);
  assert.equal(s.fx.black, 1);
  assert.equal(log.caught, 0);
  for (; t < 2.3; t += dt) s.update(dt, t, intent(), cam, view);
  assert.equal(log.caught, 1);
  s.respawn();
  assert.equal(s.fx.black, 0);
});
