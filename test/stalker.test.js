// The creature has to be fair: it only knows what it can hear or feel, a player who keeps still and
// quiet is never walked into, and it never camps a spot it cannot reach. It also has to stay
// dangerous, and get smarter with difficulty: it searches where it lost you, reads which way you were
// going, listens harder when it stops, and goes round to the far end of a crawl.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS} from '../src/levels/index.js';
import {Session} from '../src/game/session.js';
import {Camera} from '../src/render/camera.js';
import {rng} from '../src/util/math.js';

const noop = () => {};
const sounds = () => new Proxy({e: {listener: {x: 0, z: 0, yaw: 0}}}, {get: (t, k) => (k in t ? t[k] : noop)});
const renderer = () => { const dots = {push: noop, total: 0, clear: noop}; return {setDots: () => dots, setGhosts: noop, setLevelMesh: noop, setActors: noop, addLine: noop, addFan: noop}; };
const make = (def, difficulty = 'normal', seed = 3) => {
  const says = [];
  const s = new Session(def, {difficulty, seed, renderer: renderer(), sounds: sounds(), ui: {say: t => says.push(t), note: noop, caught: noop, won: noop, cores: noop}});
  return {s, says};
};
const intent = () => ({moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false});
const view = {w: 400, h: 800}, dt = 1 / 30;
const run = (s, from, secs, fn = intent) => { const cam = new Camera(); let t = from; for (; t < from + secs && s.state === 'play'; t += dt) s.update(dt, t, fn(t), cam, view); return t; };

/** A random open spot, away from hiding spots, that both the player and the creature can stand on. */
function openSpot(s, r) {
  for (;;) {
    const x = r() * s.world.w * 2, z = r() * s.world.h * 2;
    if (s.playerNav.walkableAt(x, z) && s.nav.walkableAt(x, z) && !s.L.hides.some(h => Math.hypot(x - h.x, z - h.z) < h.r + 0.3)) return [x, z];
  }
}

test('standing still with the scanner off, out in the open, it never walks into you', () => {
  for (const def of LEVELS.slice(1)) for (const diff of ['normal', 'hard']) for (let k = 0; k < 4; k++) {
    const {s} = make(def, diff, 40 + k), st = s.stalker;
    [s.player.x, s.player.z] = openSpot(s, rng(k * 7 + 1));
    st.wake(s.player);
    let hunted = false;
    run(s, 0, 60, () => { if (st.state === 'hunt' || st.state === 'alert') hunted = true; return intent(); });
    assert.equal(s.state, 'play', `${def.id} ${diff} seed ${k}: caught standing still`);
    assert.ok(!hunted, `${def.id} ${diff} seed ${k}: it hunted a player it could not hear`);
  }
});

test('coming up on a motionless player it stops, listens, then goes another way', () => {
  const {s, says} = make(LEVELS[2]), st = s.stalker;
  // north hall of the cistern (x 12..30, z 2..10): it walks west toward you along z = 3
  s.player.x = 18; s.player.z = 3; st.wake(); st.x = 28; st.z = 3; st.enter('patrol', 0); st.target = {x: 13, z: 3};
  run(s, 0, 1); // let it notice nothing
  const t = run(s, 1, 8, () => intent());
  assert.ok(says.includes("Don't move."), 'it stopped beside you');
  run(s, t, 20);
  assert.equal(s.state, 'play');
  assert.ok(Math.hypot(st.x - s.player.x, st.z - s.player.z) > 1.3, 'it never brushed past you');
});

test('make a sound while it lingers beside you and it has you', () => {
  const {s} = make(LEVELS[2]), st = s.stalker;
  s.player.x = 18; s.player.z = 3; st.wake(); st.x = 28; st.z = 3; st.enter('patrol', 0); st.target = {x: 13, z: 3};
  let t = 0;
  for (let k = 0; k < 200 && st.state !== 'linger'; k++) t = run(s, t, dt);
  assert.equal(st.state, 'linger');
  run(s, t, 4, () => { const it = intent(); it.moveY = -1; return it; }); // back away, on foot
  assert.ok(s.state === 'caught' || st.state === 'hunt', `state ${st.state}`);
});

test('a glance with the beam is safe; holding it on the creature gives you away', () => {
  for (const [diff, hold, want] of [['hard', 0.3, false], ['normal', 0.4, false], ['easy', 1.6, true], ['normal', 1.0, true]]) {
    const {s} = make(LEVELS[1], diff), st = s.stalker;
    st.wake(); st.hear = noop;
    st.x = 17; st.z = 16.5; st.enter('wait', 0); st.timer = 99;
    s.player.x = 17; s.player.z = 24.5; s.player.pitch = 0.05; s.player.yaw = Math.PI;
    const fire = () => { const it = intent(); it.firing = true; return it; };
    let t = run(s, 0, 2.6, fire);           // spin up facing away
    s.player.yaw = 0; t = run(s, t, hold, fire);
    s.player.yaw = Math.PI; run(s, t, 0.5, fire);
    const noticed = st.state === 'alert' || st.state === 'hunt' || s.state !== 'play';
    assert.equal(noticed, want, `${diff}: beam on it for ${hold}s`);
  }
});

test('it never camps the mouth of a crawl it cannot get into', () => {
  const {s} = make(LEVELS[1]), st = s.stalker;
  // the crawl from the north gallery down to the west store runs x 6..8, z 8..12
  s.player.x = 7; s.player.z = 10; s.player.crouched = true;
  st.wake(); st.x = 7; st.z = 13.6; st.notice(7, 10, 0); st.enter('hunt', 0);
  run(s, 0, 40);
  assert.equal(s.state, 'play');
  assert.ok(st.calm, `still ${st.state} after 40 s`);
  // from here on it goes about its patrol: it does not stand at either end of the crawl
  let atMouth = 0;
  run(s, 40, 20, () => { if (Math.min(Math.hypot(st.x - 7, st.z - 12.5), Math.hypot(st.x - 7, st.z - 7.5)) < 2) atMouth += dt; return intent(); });
  assert.ok(atMouth < 10, `spent ${atMouth.toFixed(1)} of 20 s at a mouth of the crawl`);
});

test('on Normal and Hard it goes round to the far end of the crawl you escaped into; on Easy it does not', () => {
  for (const [diff, want] of [['easy', false], ['normal', true], ['hard', true]]) {
    const {s} = make(LEVELS[1], diff), st = s.stalker;
    s.player.x = 7; s.player.z = 10; s.player.crouched = true;
    st.wake(); st.x = 7; st.z = 13.6; st.notice(7, 10, 0); st.enter('hunt', 0);
    let t = 0;
    for (; t < 10 && st.state !== 'search'; t += dt) run(s, t, dt);
    assert.equal(st.state, 'search');
    assert.equal(st.ambushing, want, diff);
    if (want) assert.ok(st.target.z < 9, `${diff}: waits at the north end, z ${st.target.z.toFixed(1)}`);
  }
});

test('when it loses you it reads ahead along the way you were running, more on Hard', () => {
  const ahead = {};
  for (const diff of ['easy', 'normal', 'hard']) {
    const {s} = make(LEVELS[2], diff), st = s.stalker;
    st.wake(); st.x = 13; st.z = 19; st.enter('hunt', 0);
    // fixes on you running east along the hall at 4 m/s, then nothing
    for (let i = 0; i <= 4; i++) st.fix(16 + i * 2, 19, i * 0.5);
    st.sinceFix = 2;
    ahead[diff] = st.guess().x - st.lastKnown.x;
  }
  assert.equal(ahead.easy, 0);
  assert.ok(ahead.normal > 2 && ahead.hard > ahead.normal, JSON.stringify(ahead));
});

test('after a chase it searches the area: on Hard, freezing in the open where it lost you is not safe', () => {
  const {s} = make(LEVELS[2], 'hard'), st = s.stalker;
  s.player.x = 30; s.player.z = 19;
  st.wake(); st.x = 20; st.z = 19; st.fix(29, 19, 0); st.fix(30, 19, 0.4); st.enter('hunt', 0.4);
  st.sinceFix = 0;
  run(s, 0.4, 30);
  assert.equal(s.state, 'caught', `it searched and found you (state ${st.state})`);
});

test('a well-timed sprint escapes its lunge; standing your ground does not', () => {
  for (const diff of ['easy', 'normal', 'hard']) for (const sprint of [true, false]) {
    const {s} = make(LEVELS[2], diff), st = s.stalker, p = s.player;
    p.x = 19; p.z = 19; p.yaw = Math.PI / 2; st.wake(); st.x = 15; st.z = 19; st.enter('patrol', 0);
    st.notice(p.x, p.z, 0);
    run(s, 0, 3.2, () => { const it = intent(); if (sprint) { it.moveY = 1; it.sprint = true; } return it; });
    assert.equal(s.state === 'caught', !sprint, `${diff}, ${sprint ? 'sprinting away' : 'standing still'}`);
  }
});

test('on Easy, blundering into it before it has noticed you gives you one chance to run', () => {
  for (const [diff, want] of [['easy', 'play'], ['normal', 'caught']]) {
    const {s} = make(LEVELS[2], diff), st = s.stalker, p = s.player;
    p.x = 19; p.z = 19; p.yaw = -Math.PI / 2; st.wake(); st.x = 18.3; st.z = 19; st.enter('wait', 0); st.timer = 99;
    run(s, 0, 0.2);
    assert.equal(s.state, want, diff);
  }
});

test('the last chase starts far from you and from the exit, and a careful run to the door makes it', () => {
  for (const def of LEVELS.slice(1)) {
    const {s} = make(def), st = s.stalker, p = s.player;
    if (!st.active) st.wake();
    s.cores.forEach((c, i) => { if (i) { c.got = true; c.orb.on = false; s.coresGot++; } });
    p.x = s.cores[0].x; p.z = s.cores[0].z + 0.3;
    run(s, 0, 0.1);
    assert.equal(st.state, 'finale');
    const fromYou = s.nav.distAt(s.nav.field(p.x, p.z), st.x, st.z), fromExit = s.nav.distAt(s.nav.field(s.exit.x, s.exit.z), st.x, st.z);
    assert.ok(fromYou > 15 && fromExit > 10, `${def.id}: starts ${fromYou.toFixed(0)} m from you, ${fromExit.toFixed(0)} m from the exit`);
  }
});

// ---------------------------------------------------------------- its own tricks: sonar, light, stalking

/** Steer the player along the walkable grid toward (tx, tz) for one frame. */
function steer(s, it, tx, tz, memo) {
  const p = s.player, nav = s.playerNav;
  if (!memo.path || memo.i++ % 8 === 0) memo.path = nav.path(nav.field(p.x, p.z), tx, tz, 1.2);
  if (!memo.path || memo.path.length < 2) return it;
  const k = Math.min(memo.path.length - 1, 3), wx = nav.cx(memo.path[k]), wz = nav.cz(memo.path[k]);
  let d = Math.atan2(wx - p.x, -(wz - p.z)) - p.yaw;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  it.lookX = d; it.moveY = 1;
  return it;
}

test('its sonar: moving inside the red echo gives you away; keeping still does not', () => {
  // [difficulty, crouched, moving, found]
  for (const [diff, crouch, move, want] of [['normal', true, true, true], ['normal', false, false, false], ['hard', false, false, false], ['easy', true, true, false], ['easy', false, true, true]]) {
    const {s} = make(LEVELS[2], diff), st = s.stalker, p = s.player;
    // north hall of the cistern, 6 m apart with nothing between
    p.x = 20; p.z = 3; p.crouched = crouch;
    st.wake(); st.x = 26; st.z = 3; st.enter('listen', 0); st.timer = 99; st.hear = noop; // only the sonar
    st.sonarT = 0.05;
    let pinged = false;
    run(s, 0, 2.5, t => { const it = intent(); if (move) it.moveX = Math.sin(t * 6) > 0 ? 0.35 : -0.35; if (s.fx.ping > 0) pinged = true; return it; });
    const found = st.state === 'alert' || st.state === 'hunt' || s.state !== 'play';
    assert.ok(pinged, `${diff}: the echo washed over you`);
    assert.equal(found, want, `${diff}, ${crouch ? 'crouched' : 'standing'}, ${move ? 'moving' : 'still'}`);
  }
});

test('its sonar paints red dots where it listens', () => {
  const {s} = make(LEVELS[2]), st = s.stalker, red = [];
  st.dots = {push: (x, y, z, t, r, g, b) => { if (r > g * 4) red.push([x, y, z]); }};
  s.player.x = 20; s.player.z = 3;
  st.wake(); st.x = 26; st.z = 3; st.enter('listen', 0); st.timer = 99; st.sonarT = 0.05;
  run(s, 0, 2);
  assert.ok(red.length > 60, `${red.length} red dots`);
  assert.ok(red.every(([x, , z]) => Math.hypot(x - 26, z - 3) < s.diff.sonar + 0.5), 'all within its reach');
});

test('the beam stops it dead; hold it there and it breaks and runs, a little later each time', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    const {s} = make(LEVELS[1], diff), st = s.stalker, p = s.player, held = [];
    // the scanner kept cool, so only the creature decides how long this takes
    const fire = () => { const it = intent(); it.firing = true; s.scanner.heat = 0; return it; };
    let t = 0;
    for (let round = 0; round < 2; round++) {
      st.wake(); st.hear = noop; st.x = 17; st.z = 16.5; st.notice(17, 24.5, t); st.enter('hunt', t);
      p.x = 17; p.z = 24.5; p.yaw = 0; p.pitch = 0.05;
      let pinnedAt = null, z0 = 0, crept = 0;
      for (const end = t + 12; t < end && st.state !== 'flee' && s.state === 'play';) {
        t = run(s, t, dt, fire);
        if (st.pinned && pinnedAt === null) { pinnedAt = t; z0 = st.z; }
        if (pinnedAt !== null) crept = Math.max(crept, st.z - z0);
      }
      assert.equal(s.state, 'play', `${diff} round ${round}: caught while holding the beam on it`);
      assert.equal(st.state, 'flee', `${diff} round ${round}: still ${st.state} after 12 s of light`);
      // (a step at most while the scanner spins up and the beam still flickers over it)
      assert.ok(crept < 0.3, `${diff} round ${round}: crept ${crept.toFixed(2)} m in the light`);
      held.push(t - pinnedAt);
      // it runs away from you, never through you
      const d0 = st.euclid;
      t = run(s, t, 3);
      assert.equal(s.state, 'play', `${diff} round ${round}: caught by it running off`);
      assert.ok(st.euclid > d0 + 4, `${diff} round ${round}: ran from ${d0.toFixed(1)} m to ${st.euclid.toFixed(1)} m`);
    }
    if (diff === 'easy') assert.ok(Math.abs(held[1] - held[0]) < 0.2, `easy: ${held.map(h => h.toFixed(1))}`);
    else assert.ok(held[1] > held[0] + 0.8, `${diff}: it should take longer the second time (${held.map(h => h.toFixed(1))} s)`);
  }
});

test('after the last core the beam still stops it, but it no longer runs', () => {
  const {s} = make(LEVELS[1]), st = s.stalker, p = s.player;
  st.wake(); st.hear = noop; st.x = 17; st.z = 16.5; st.enter('finale', 0);
  p.x = 17; p.z = 24.5; p.yaw = 0; p.pitch = 0.05;
  let z0 = null;
  run(s, 0, 8, () => { if (st.pinned && z0 === null) z0 = st.z; const it = intent(); it.firing = true; s.scanner.heat = 0; return it; });
  assert.equal(s.state, 'play');
  assert.equal(st.state, 'finale');
  assert.ok(st.pinned && st.z - z0 < 0.3, `pinned ${st.pinned}, crept ${(st.z - z0).toFixed(2)} m`);
});

test('stalking: it follows your footsteps, your steps sound doubled, and if you never look back it pounces', () => {
  const {s, says} = make(LEVELS[2]), st = s.stalker, p = s.player, memo = {};
  // south-west room, heading east along the south rooms with it twelve metres behind
  p.x = 14; p.z = 35; st.wake(); st.x = 4; st.z = 35; st.fix(p.x, p.z, 0); st.enter('stalk', 0);
  let stalked = 0;
  run(s, 0, 40, () => { if (st.state === 'stalk') stalked += dt; return steer(s, intent(), 44, 36, memo); });
  assert.ok(says.includes('Your footsteps sound doubled.'), 'the doubled-steps hint');
  assert.ok(stalked > 4, `followed you for ${stalked.toFixed(1)} s`);
  assert.equal(s.state, 'caught', `it pounced (state ${st.state})`);
});

test('stalking: stop, turn the beam on it, and it bolts into the dark', () => {
  const {s} = make(LEVELS[2]), st = s.stalker, p = s.player, memo = {};
  p.x = 14; p.z = 35; st.wake(); st.x = 4; st.z = 35; st.fix(p.x, p.z, 0); st.enter('stalk', 0);
  let t = run(s, 0, 6, () => steer(s, intent(), 44, 36, memo));
  assert.equal(st.state, 'stalk');
  p.yaw = Math.atan2(st.x - p.x, -(st.z - p.z)); p.pitch = -0.05;
  run(s, t, 3, () => { const it = intent(); it.firing = true; return it; });
  assert.equal(s.state, 'play');
  assert.ok(st.state === 'flee' || st.state === 'listen', `state ${st.state}`);
  assert.ok(st.stalkAfter > t, 'and leaves you alone for a while');
});

test('stalking: switch the scanner on facing the wrong way and it comes for you', () => {
  const {s} = make(LEVELS[2]), st = s.stalker, p = s.player, memo = {};
  p.x = 14; p.z = 35; st.wake(); st.x = 4; st.z = 35; st.fix(p.x, p.z, 0); st.enter('stalk', 0);
  let t = run(s, 0, 6, () => steer(s, intent(), 44, 36, memo));
  assert.equal(st.state, 'stalk');
  p.yaw = Math.atan2(p.x - st.x, -(p.z - st.z)); // away from it
  run(s, t, 4, () => { const it = intent(); it.firing = true; return it; });
  assert.ok(s.state === 'caught' || st.state === 'hunt', `state ${st.state}`);
});

test('after a respawn it keeps away from where you came back', () => {
  const {s} = make(LEVELS[2]), st = s.stalker;
  const c = s.checkpoint;
  for (let k = 0; k < 6; k++) {
    s.respawn();
    let nearest = 1e9;
    run(s, k * 30, 24, () => { if (st.target && st.state === 'patrol') nearest = Math.min(nearest, Math.hypot(st.target.x - c.x, st.target.z - c.z)); return intent(); });
    assert.ok(nearest >= 16, `round ${k}: headed for a spot ${nearest.toFixed(1)} m from your respawn`);
    assert.equal(s.state, 'play');
  }
});
