// How the creature thinks: the shape of a level, where it believes you are, what it learns about you and
// how it is paced, and the tricks that come out of all that. It has to be clever without cheating, so the
// first thing checked is that it only knows what it has sensed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS} from '../src/levels/index.js';
import {DIFFICULTY, NOISE, STALKER, LUNGS} from '../src/config.js';
import {Session} from '../src/game/session.js';
import {Belief} from '../src/game/belief.js';
import {Director} from '../src/game/director.js';
import {Memory} from '../src/game/memory.js';
import {Topology} from '../src/world/topology.js';
import {NavGrid} from '../src/world/nav.js';
import {compileLevel} from '../src/world/level.js';
import {Camera} from '../src/render/camera.js';
import {rng} from '../src/util/math.js';

const noop = () => {};
/** Sound stub that counts what the game played. */
function sounds() {
  const played = {};
  return new Proxy({e: {listener: {x: 0, z: 0, yaw: 0}}, played}, {get: (t, k) => (k in t ? t[k] : () => { played[k] = (played[k] || 0) + 1; })});
}
const renderer = () => { const dots = {push: noop, total: 0, clear: noop}; return {setDots: () => dots, setGhosts: noop, setLevelMesh: noop, setActors: noop, addLine: noop, addFan: noop}; };
const make = (def, difficulty = 'normal', seed = 3, memory = new Memory()) => {
  const says = [], caught = [];
  const s = new Session(def, {difficulty, seed, memory, renderer: renderer(), sounds: sounds(), ui: {say: t => says.push(t), note: noop, caught: i => caught.push(i), won: noop, cores: noop}});
  return {s, says, caught, st: s.stalker, p: s.player, played: s.sounds.played};
};
const intent = (o = {}) => ({moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false, ...o});
const view = {w: 400, h: 800}, dt = 1 / 30;
const run = (s, from, secs, fn = intent) => { const cam = new Camera(); let t = from; for (; t < from + secs && s.state === 'play'; t += dt) s.update(dt, t, fn(t), cam, view); return t; };
const cistern = LEVELS[2];

// ---------------------------------------------------------------- it only knows what it has sensed

test('what it believes does not depend on where you really are, unless it sensed you', () => {
  // the same creature, the same seed; you stand in two different far-off places, silent
  const a = make(cistern, 'normal', 11), b = make(cistern, 'normal', 11);
  for (const [{s, st, p}, x, z] of [[a, 6, 6], [b, 6, 34]]) { s.L.triggers.length = 0; p.x = x; p.z = z; st.wake(); st.x = 44; st.z = 5; st.enter('patrol', 0); }
  run(a.s, 0, 20); run(b.s, 0, 20);
  assert.ok(a.st.playerDist > 12 && b.st.playerDist > 12, 'it stayed away from both');
  assert.deepEqual([...a.st.belief.p], [...b.st.belief.p], 'identical maps: it has no idea where you are');
});

test('a sound does reach its map, and rough sounds sharpen with repetition', () => {
  const {st} = make(cistern);
  const B = st.belief, before = B.spread();
  st.hear([{x: 24, z: 20, loud: 40, exact: false, kind: 'step'}], 1);
  const one = B.spread(), peak = B.peakNear(24, 20, 8);
  assert.ok(one < before * 0.75, `one sound: unsure ${before.toFixed(1)} to ${one.toFixed(1)} m`);
  assert.ok(Math.hypot(peak.x - 24, peak.z - 20) < 8, 'and around the right place');
  // the same few sounds again, a little apart so they count as new readings
  for (let k = 1; k <= 3; k++) B.observe(24, 20, 2);
  assert.ok(B.spread() < one, 'several readings are surer than one');
});

// ---------------------------------------------------------------- the shape of a level

for (const def of LEVELS.slice(1)) {
  test(`${def.id}: rooms and chokepoints make sense`, () => {
    const L = compileLevel(def), nav = new NavGrid(L.world, {radius: 0.35, minH: 2.15});
    const t = new Topology(L.world, nav);
    assert.ok(t.rooms.length >= 2, 'more than one room');
    assert.ok(t.chokes.length >= 1, 'something joins them');
    for (const c of t.chokes) assert.ok(c.mouths.length === c.rooms.length, 'a mouth for every room it opens onto');
    for (const r of t.rooms) assert.ok(r.portals.length > 0 || t.rooms.length === 1, `room ${r.id} is not sealed off`);
    // every room connects to every other through its chokepoints
    const seen = new Set([0]), todo = [0];
    while (todo.length) for (const c of t.rooms[todo.pop()].portals) for (const o of t.chokes[c].rooms) if (!seen.has(o)) { seen.add(o); todo.push(o); }
    assert.equal(seen.size, t.rooms.length);
  });
}

test('a crawl counts as a crawl, and is no way through for the creature', () => {
  const L = compileLevel(cistern), nav = new NavGrid(L.world, {radius: 0.35, minH: 2.15}), t = new Topology(L.world, nav);
  const west = t.chokeAt(8, 21);
  assert.ok(west && west.crawl, 'the low west crawl');
  const hall = t.roomAt(24, 20);
  assert.ok(hall && t.exits(hall).every(e => !e.choke.crawl), 'exits() leaves crawls out');
  assert.ok(hall.portals.some(id => t.chokes[id].crawl), 'though the room does open onto them');
});

// ---------------------------------------------------------------- where it believes you are

test('its map spreads along corridors, never through rock', () => {
  const {s} = make(cistern), B = new Belief(s.playerNav, s.nav);
  // the far east end of the north-east room: the room next door is a metre of rock away, but a long walk
  B.place(44, 6, 1);
  for (let i = 0; i < 40; i++) B.step(0.25);
  const here = B.massNear(44, 6, 5);
  B.uniform(); // compare with an even spread: right next to you but through solid rock
  const inRock = B.index(47, 12);
  assert.equal(B.walk[inRock], 0, 'the probe really is in rock');
  B.place(44, 6, 1);
  for (let i = 0; i < 40; i++) B.step(0.25);
  assert.equal(B.p[inRock], 0, 'no belief inside rock');
  assert.ok(here > 0.4, `after 10 s it still favours round here: ${here.toFixed(2)}`);
});

test('its probabilities stay a proper distribution through everything it does', () => {
  const {s} = make(cistern), B = new Belief(s.playerNav, s.nav), r = rng(5);
  for (let i = 0; i < 300; i++) {
    const x = r() * 50, z = r() * 40, op = r();
    if (op < 0.4) B.step(0.25);
    else if (op < 0.7) B.observe(x, z, 1 + r() * 8, 0.5 + r() * 0.5);
    else B.touch(x, z, 1 + r() * 4, r() * 0.2);
    let sum = 0, bad = false;
    for (let k = 0; k < B.n; k++) { sum += B.p[k]; if (!(B.p[k] >= 0) || (!B.walk[k] && B.p[k] !== 0)) bad = true; }
    assert.ok(!bad, 'no negatives, nothing in rock');
    assert.ok(Math.abs(sum - 1) < 0.01, `sums to 1, got ${sum}`);
  }
});

test('having looked somewhere and found nothing, it looks elsewhere', () => {
  const {st} = make(cistern);
  st.wake(); st.x = 21; st.z = 6; st.repathT = 0; st.nav.field(st.x, st.z, st.field);
  const B = st.belief;
  B.uniform();
  B.observe(16, 6, 3, 0.9); B.observe(26, 6, 3, 0.5); // two likely spots, the first much likelier
  const first = B.best(st.field, {D: 40});
  assert.ok(Math.abs(first.x - 16) < 5, `goes to the likelier one first: ${first.x}`);
  B.touch(first.x, first.z, 5, 0.01);
  const next = B.best(st.field, {D: 40});
  assert.ok(Math.hypot(next.x - first.x, next.z - first.z) > 4, `then somewhere else: ${next.x},${next.z}`);
});

test('it sweeps the level on its rounds, rather than pacing back and forth', () => {
  for (const def of LEVELS.slice(1)) {
    const shares = [];
    for (const seed of [21, 22, 23]) { // one five-minute round varies a lot: on Pumphall, 50 to 83% of the big rooms
      const {s, st, p} = make(def, 'normal', seed);
      p.x = s.L.hides[0].x; p.z = s.L.hides[0].z; p.crouched = true; // out of the way, silent
      st.wake(); st.enter('patrol', 0);
      const big = st.topo.rooms.filter(r => r.area >= 16), seen = new Set();
      let last = null, repeats = 0, goals = 0;
      run(s, 0, 300, () => {
        const r = st.topo.roomAt(st.x, st.z);
        if (r) seen.add(r.id);
        if (st.target && st.target !== last) { if (last && Math.hypot(st.target.x - last.x, st.target.z - last.z) < 0.01) repeats++; last = st.target; goals++; }
        return intent();
      });
      shares.push(big.filter(r => seen.has(r.id)).length / big.length);
      assert.ok(goals >= 8, `${def.id}: only ${goals} goals in 5 minutes`);
      assert.equal(repeats, 0, `${def.id}: the same goal twice running`);
    }
    const median = shares.sort((a, b) => a - b)[1];
    assert.ok(median >= 0.6, `${def.id}: visited ${Math.round(median * 100)}% of its big rooms`);
  }
});

// ---------------------------------------------------------------- pacing

const fakeCreature = () => ({active: true, state: 'patrol', hunting: false, playerDist: 40, left: 0, hunches: [],
  leaveOff() { this.left++; }, hunch(x, z, r) { this.hunches.push({x, z, r}); }});

test('the director gives you a breather after long enough under pressure, not in the middle of a hunt', () => {
  const d = new Director(DIFFICULTY.normal, rng(1)), st = fakeCreature(), player = {x: 0, z: 0};
  Object.assign(st, {state: 'hunt', hunting: true, playerDist: 5});
  for (let t = 0; t < DIFFICULTY.normal.peakSpan + 5; t += dt) d.update(dt, st, player);
  assert.equal(d.phase, 'build', 'not while it is on you');
  assert.ok(d.menace >= 0.99, `the gauge is full: ${d.menace}`);
  Object.assign(st, {state: 'search', hunting: false, playerDist: 20});
  d.update(dt, st, player);
  assert.equal(d.phase, 'relax', 'once the hunt ends');
  assert.equal(st.left, 1, 'it leaves off');
  for (let t = 0; t < DIFFICULTY.normal.relax + DIFFICULTY.normal.peakSpan * 2; t += dt) { st.state = 'patrol'; st.playerDist = 40; d.update(dt, st, player); }
  assert.equal(d.phase, 'build', 'then it builds again');
});

test('long quiet gives it a vague hunch, never an exact one, and harder difficulties sooner', () => {
  const firstHunch = {};
  for (const k of ['easy', 'normal', 'hard']) {
    const d = new Director(DIFFICULTY[k], rng(2)), st = fakeCreature(), player = {x: 30, z: 20};
    let t = 0;
    for (; t < 400 && st.hunches.length < 12; t += dt) d.update(dt, st, player);
    firstHunch[k] = DIFFICULTY[k].hunchAfter;
    assert.ok(st.hunches.length > 0, `${k}: a hunch came`);
    for (const h of st.hunches) {
      assert.ok(h.r >= 8, `${k}: never narrower than a room or two, got ${h.r}`);
      assert.ok(Math.hypot(h.x - player.x, h.z - player.z) <= h.r, 'and thereabouts');
    }
    assert.ok(st.hunches.some(h => Math.hypot(h.x - player.x, h.z - player.z) > 1), `${k}: not pointing at you exactly`);
  }
  assert.ok(firstHunch.hard < firstHunch.normal && firstHunch.normal < firstHunch.easy);
});

test('on a breather it wanders away from you, and only you making noise brings it back', () => {
  const {s, st, p} = make(cistern, 'normal', 8);
  p.x = 24; p.z = 20; st.wake(); st.x = 28; st.z = 20; st.enter('patrol', 0);
  st.director.rest(60);
  let near = 0, n = 0;
  run(s, 0, 40, () => { if (st.target && st.state === 'patrol') { near += Math.hypot(st.target.x - p.x, st.target.z - p.z); n++; } return intent(); });
  assert.ok(n > 0 && near / n > 10, `it heads off, on average ${(near / n).toFixed(1)} m from you`);
  assert.equal(s.state, 'play');
  // a sound still counts
  st.x = 34; st.z = 20; st.repathT = 0; st.field.fill(Infinity); st.nav.field(st.x, st.z, st.field);
  st.enter('patrol', 41);
  st.hear([{x: p.x, z: p.z, loud: NOISE.slam, exact: false, kind: 'slam'}], 41);
  assert.ok(st.state === 'investigate' || st.state === 'alert', `state ${st.state}`);
});

// ---------------------------------------------------------------- what it learns

test('memory: habits sink in, fade with time, and a new creature knows nothing', () => {
  const m = new Memory();
  assert.equal(m.weight('hide'), 0);
  let sank = false;
  for (let i = 0; i < 4; i++) if (m.note('hide')) sank = true;
  assert.ok(sank, 'told when it sinks in');
  const w = m.weight('hide');
  assert.ok(w > 0.5, `weight ${w}`);
  assert.ok(m.lessons().some(l => l.includes('hide')));
  for (let i = 0; i < 12; i++) m.enter('x', 4, 4);
  assert.ok(m.weight('hide') < 0.5, 'play differently for a while and it forgets');
  assert.equal(Memory.saved().weight('hide'), 0, 'outside a browser nothing is kept');
});

test('memory: it survives a save, and what it heard is kept per level', () => {
  const m = new Memory();
  m.enter('a', 8, 8); m.heard(10, 10, 5); m.hideUsed(1); m.hideUsed(1); m.note('beam', 9);
  const copy = new Memory(JSON.parse(JSON.stringify(m.data)));
  copy.enter('a', 8, 8);
  assert.equal(copy.hideCount(1), 2);
  assert.ok(copy.heatAt(10, 10) > 0.9 && copy.heatAt(30, 30) === 0);
  assert.ok(copy.weight('beam') > 0.5);
  copy.enter('b', 8, 8);
  assert.equal(copy.hideCount(1), 0, 'another level, another map');
  assert.equal(new Memory({v: 99, junk: true}).weight('hide'), 0, 'a save from another version is ignored, not trusted');
});

test('it goes to a hiding place it remembers you using, and it knows where it heard you', () => {
  const m = new Memory();
  m.enter('cistern', 13, 10);
  for (let i = 0; i < 3; i++) m.hideUsed(0);
  const {st} = make(cistern, 'normal', 3, m), h = cistern.hides[0];
  st.wake(); st.x = 22; st.z = 32; st.nav.field(st.x, st.z, st.field);
  st.lastKnown.x = 20; st.lastKnown.z = 33; st.sinceFix = 0;
  st.enter('search', 1);
  assert.ok(Math.hypot(st.target.x - h.x, st.target.z - h.z) < 3, `goes to the hide: ${st.target.x},${st.target.z}`);
  const fresh = make(cistern, 'normal', 3).st;
  fresh.wake(); fresh.x = 22; fresh.z = 32; fresh.nav.field(fresh.x, fresh.z, fresh.field);
  fresh.lastKnown.x = 20; fresh.lastKnown.z = 33; fresh.sinceFix = 0;
  fresh.enter('search', 1);
  assert.ok(Math.hypot(fresh.target.x - h.x, fresh.target.z - h.z) > 3, 'a creature that never saw you hide there does not');
});

test('caught at a remembered hiding place unless you hold your breath; held, it gives up sooner', () => {
  const setup = () => {
    const m = new Memory();
    m.enter('cistern', 13, 10);
    for (let i = 0; i < 3; i++) m.hideUsed(0);
    const g = make(cistern, 'normal', 3, m), h = cistern.hides[0];
    g.p.x = h.x; g.p.z = h.z; g.p.crouched = true;
    g.st.wake(); g.st.x = h.x + 3.5; g.st.z = h.z - 0.2; g.st.enter('patrol', 0); g.st.target = {x: h.x + 1.5, z: h.z - 0.2};
    g.st.lingerAfter = 0;
    return g;
  };
  const a = setup();
  let t = run(a.s, 0, 2);
  assert.equal(a.st.state, 'linger', `it stopped beside you (${a.st.state})`);
  assert.ok(a.st.lingerKnown, 'and it knows this place');
  run(a.s, t, 6);
  assert.equal(a.st.clue, 'breath', 'it heard you breathing');
  assert.equal(a.s.state, 'caught', `and the hiding place did not save you (${a.st.state})`);

  const b = setup();
  t = run(b.s, 0, 2);
  const start = b.st.state;
  run(b.s, t, 7, () => intent({holdBreath: true}));
  assert.equal(start, 'linger');
  assert.notEqual(b.st.state, 'linger', 'it decided it heard nothing');
  assert.equal(b.s.state, 'play');
  assert.ok(!(b.st.state === 'alert' || b.st.state === 'hunt'), `and left: ${b.st.state}`);
  assert.equal(b.s.lungs < 1, true, 'it cost you breath');
});

test('at a hiding place it does not know, keeping still is enough', () => {
  const {s, st, p} = make(cistern, 'normal', 3), h = cistern.hides[0];
  p.x = h.x; p.z = h.z; p.crouched = true;
  st.wake(); st.x = h.x + 3.5; st.z = h.z - 0.2; st.enter('patrol', 0); st.target = {x: h.x + 1.5, z: h.z - 0.2};
  run(s, 0, 2);
  assert.equal(st.state, 'linger');
  assert.ok(!st.lingerKnown);
  run(s, 2, 10);
  assert.equal(s.state, 'play');
  assert.ok(!(st.state === 'alert' || st.state === 'hunt'), st.state);
});

// ---------------------------------------------------------------- the tricks

test('cut off: it goes for the door you are running to, if it can get there first; on Easy never', () => {
  const scene = diff => {
    const {st} = make(cistern, diff);
    st.wake(); st.x = 6; st.z = 6; st.nav.field(st.x, st.z, st.field); // west room, by the door you are running for
    for (let i = 0; i <= 4; i++) st.fix(24 - i * 1.6, 7, i * 0.5);   // running west along the north room
    st.sinceFix = 0;
    return st;
  };
  const hard = scene('hard');
  let got = 0;
  for (let k = 0; k < 30; k++) {
    const c = hard.cutoffSpot();
    if (c) { got++; assert.ok(Math.abs(c.x - 12) < 3 && Math.abs(c.z - 7) < 3, `the west door: ${c.x},${c.z}`); }
  }
  assert.ok(got > 5 && got < 30, `on Hard it often does (${got} of 30)`);
  const easy = scene('easy');
  for (let k = 0; k < 10; k++) assert.equal(easy.cutoffSpot(), null);
  // not a door it cannot reach in time
  const far = make(cistern, 'hard').st;
  far.wake(); far.x = 44; far.z = 34; far.nav.field(far.x, far.z, far.field);
  for (let i = 0; i <= 4; i++) far.fix(24 - i * 1.6, 7, i * 0.5);
  far.sinceFix = 0;
  for (let k = 0; k < 20; k++) assert.equal(far.cutoffSpot(), null);
});

test('flank: pinned in your light, it comes back another way, and never past you', () => {
  let found = 0;
  for (const def of LEVELS.slice(1)) {
    const {st} = make(def, 'hard');
    st.wake();
    for (const q of [...def.stalker.patrol, def.stalker.spawn]) for (const r of st.topo.rooms) {
      if (!r.standable || st.topo.exits(r).length < 2) continue;
      st.x = q[0]; st.z = q[1]; st.nav.field(st.x, st.z, st.field);
      st.lastKnown.x = r.x; st.lastKnown.z = r.z;
      if (Math.hypot(r.x - st.x, r.z - st.z) < 12) continue;
      const spot = st.flankSpot();
      if (!spot) continue;
      found++;
      const ways = st.topo.exits(r).map(e => st.nav.distAt(st.field, e.x, e.z, 1.5)).sort((a, b) => a - b);
      assert.ok(st.nav.distAt(st.field, spot.x, spot.z, 1.5) > ways[0], 'not simply the nearest way in');
      for (const c of st.nav.path(st.field, spot.x, spot.z, 4)) assert.ok(Math.hypot(st.nav.cx(c) - r.x, st.nav.cz(c) - r.z) > 4.5, 'its route keeps clear of you');
    }
  }
  assert.ok(found >= 3, `found a flanking route ${found} times`);
});

test('flank: having been pinned lately, it may take that route once it hears you; on Easy never', () => {
  const scene = diff => {
    const g = make(cistern, diff, 5), {st, p} = g;
    p.x = 21; p.z = 6;           // north room, three ways in
    st.wake(); st.x = 12; st.z = 34; st.nav.field(st.x, st.z, st.field); st.playerDist = 40;
    st.lastKnown.x = 21; st.lastKnown.z = 6; st.pinnedAt = 0;
    return st;
  };
  const hard = scene('hard'), easy = scene('easy');
  let took = 0;
  for (let k = 0; k < 30; k++) if (hard.wantsFlank(5)) took++;
  assert.ok(took > 3 && took < 30, `Hard took it ${took} of 30 times`);
  for (let k = 0; k < 10; k++) assert.equal(easy.wantsFlank(5), false);
  const old = scene('hard');
  old.pinnedAt = -1000;
  assert.equal(old.wantsFlank(5), false, 'it has forgotten after a while');
});

test('feint: it walks away loudly, comes back silently, and waits', () => {
  const {s, st, p, played} = make(cistern, 'hard', 4);
  p.x = 24; p.z = 34; p.crouched = true;
  st.wake(); st.x = 22; st.z = 32; st.searchC.x = 24; st.searchC.z = 33; st.nav.field(st.x, st.z, st.field);
  st.enter('feint', 1);
  const away0 = Math.hypot(st.x - st.feintBack.x, st.z - st.feintBack.z);
  let far = away0, t = 1;
  for (; t < 30 && st.state === 'feint' && st.feintPhase === 'away'; t += dt) { run(s, t, dt); far = Math.max(far, Math.hypot(st.x - st.feintBack.x, st.z - st.feintBack.z)); }
  assert.equal(st.feintPhase, 'back');
  assert.ok(far > away0 + 6, `really went off, ${far.toFixed(1)} m away`);
  assert.ok(played.stomp >= 3, `and you heard it go: ${played.stomp} stomps`);
  const stomps = played.stomp, steps = played.creatureStep || 0, gallops = played.gallop || 0, groans = played.groan || 0, clicks = played.clicks || 0;
  for (; t < 60 && st.state === 'feint'; t += dt) run(s, t, dt);
  assert.equal(played.stomp, stomps, 'not a sound on the way back');
  assert.equal(played.creatureStep || 0, steps);
  assert.equal(played.gallop || 0, gallops);
  assert.equal(played.groan || 0, groans);
  assert.equal(played.clicks || 0, clicks);
  assert.equal(s.state, 'play', 'you kept still, and it did not walk into you');
});

test('feint: it cannot walk through a still player, even on its silent way back', () => {
  const {s, st, p} = make(cistern, 'hard', 4);
  p.x = 24; p.z = 34; // in the way, standing still, out in the open
  st.wake(); st.x = 36; st.z = 34; st.feintBack.x = 20; st.feintBack.z = 34; st.enter('search', 0);
  st.enter('feint', 1); st.feintPhase = 'back'; st.target = {x: 20, z: 34};
  run(s, 1, 25);
  assert.equal(s.state, 'play');
  assert.ok(Math.hypot(st.x - p.x, st.z - p.z) > 1.3, 'never brushed past you');
});

test('searching, it walks into you where it last placed you; move first and it stops and leans in (not on Hard)', () => {
  const scene = (diff, moved) => {
    const g = make(cistern, diff, 3), {s, st, p} = g;
    p.x = 30; p.z = 19; p.still = 1;
    st.wake(); st.x = 22; st.z = 19; st.nav.field(st.x, st.z, st.field); st.lingerAfter = 0;
    st.fix(moved ? 26 : 30, 19, 0); st.enter('search', 0);
    st.target = {x: 30, z: 19}; // this time its map has it right: it is coming straight to you
    let lingered = false;
    run(s, 0, 7, () => { if (st.state === 'linger') lingered = true; return intent(); });
    return {caught: s.state === 'caught', lingered, st};
  };
  assert.ok(scene('normal', false).caught, 'you never moved from where it placed you');
  const n = scene('normal', true);
  assert.ok(!n.caught && n.lingered, 'you had moved: it stops beside you');
  assert.ok(Math.hypot(n.st.x - 30, n.st.z - 19) >= 1.3, 'and never quite touches you');
  assert.ok(scene('hard', true).caught, 'on Hard it does not stop');
});

test('coming back to where it stood over you, it suspects: stay put and it hears you breathe (not on Easy)', () => {
  const again = (diff, hold) => {
    const {s, st, p} = make(cistern, diff, 3);
    p.x = 24; p.z = 20; p.still = 1;
    st.wake(); st.x = 28; st.z = 20; st.nav.field(st.x, st.z, st.field);
    st.stoodAt = {x: 24, z: 20, T: 0};   // it was here a moment ago, and left
    st.enter('patrol', 1); st.target = {x: 25.5, z: 20};
    run(s, 1, 8, () => intent({holdBreath: hold && st.state === 'linger'}));
    return {s, st};
  };
  const normal = again('normal', false);
  assert.equal(normal.st.clue, 'breath', 'it heard you');
  assert.ok(normal.s.state === 'caught' || normal.st.state === 'alert' || normal.st.state === 'hunt', normal.st.state);
  const held = again('normal', true);
  assert.equal(held.s.state, 'play');
  assert.notEqual(held.st.clue, 'breath', 'held breath: it hears nothing');
  assert.notEqual(again('easy', false).st.clue, 'breath', 'Easy never does this');
});

test('a stand-off does not last for ever: blocked with you in the way, it comes and listens', () => {
  const {s, st, p} = make(cistern, 'normal', 3);
  // the corridor south of the north room: you stand in the only way on
  p.x = 21; p.z = 12; p.still = 1;
  st.wake(); st.x = 21; st.z = 16; st.nav.field(st.x, st.z, st.field); st.lingerAfter = 15;
  st.nextPatrol = () => null; // every way on passes you
  st.enter('patrol', 0);
  let lingered = false;
  run(s, 0, 20, () => { if (st.state === 'linger') lingered = true; return intent(); });
  assert.ok(lingered, `state ${st.state}`);
});

test('the last chase may head you off on your way to the door, and on Easy never', () => {
  for (const def of LEVELS.slice(1)) {
    const {st, s, p} = make(def, 'hard', 3);
    st.wake(); [st.x, st.z] = st.finaleSpot(p, s.exit); st.nav.field(st.x, st.z, st.field);
    const c = st.headOff(p);
    if (!c) continue; // it may simply be too far behind
    const fromYou = s.playerNav.distAt(s.playerNav.field(p.x, p.z), c.x, c.z);
    assert.ok(fromYou >= 5, `${def.id}: not on top of you (${fromYou.toFixed(1)} m)`);
    assert.ok(isFinite(s.nav.distAt(st.field, c.x, c.z)), `${def.id}: somewhere it can reach`);
    const toExit = s.playerNav.distAt(s.playerNav.field(s.exit.x, s.exit.z), c.x, c.z), direct = s.playerNav.distAt(s.playerNav.field(s.exit.x, s.exit.z), p.x, p.z);
    assert.ok(toExit < direct, `${def.id}: on your way to the door`);
  }
  assert.equal(DIFFICULTY.easy.finaleCut, 0);
});

test('nothing it does takes it faster than its limit', () => {
  const {s, st, p} = make(cistern, 'hard', 3);
  p.x = 14; p.z = 18; st.wake(); st.x = 30; st.z = 18; st.notice(p.x, p.z, 0); st.enter('hunt', 0);
  st.surgeT = 5; st.burst = 'dash'; st.burstT = 5;
  let top = 0;
  run(s, 0, 1, () => { top = Math.max(top, st.speed); return intent(); });
  assert.ok(top > 5 && top <= STALKER.maxSpeed, `top speed ${top}`);
});

test('driven off by your light, it runs a long way, and leaves you a breather', () => {
  const far = [];
  for (const def of LEVELS.slice(1)) {
    const {st, p} = make(def, 'normal', 3);
    const big = st.topo.rooms.filter(r => r.standable && r.area >= 32);
    for (const r of big) {
      p.x = r.x; p.z = r.z; st.wake(); st.x = r.x + 3; st.z = r.z; st.nav.field(st.x, st.z, st.field);
      st.player = p;
      st.enter('flee', 1);
      far.push(Math.hypot(st.target.x - p.x, st.target.z - p.z));
      assert.ok(st.director.relaxing, 'a breather');
    }
  }
  far.sort((a, b) => a - b);
  assert.ok(far[far.length >> 1] > 15, `median flee target ${far[far.length >> 1].toFixed(1)} m away`);
});

test('a level can lean harder or softer on the difficulty it was given', () => {
  const plain = make(cistern, 'normal', 3).s.diff, tuned = make({...cistern, tune: {hearing: 0.5, sonar: 2}}, 'normal', 3).s.diff;
  assert.equal(tuned.hearing, DIFFICULTY.normal.hearing * 0.5);
  assert.equal(tuned.sonar, DIFFICULTY.normal.sonar * 2);
  assert.equal(plain.hearing, DIFFICULTY.normal.hearing * (cistern.tune?.hearing ?? 1));
  assert.ok(DIFFICULTY.normal.sonar === 10, 'the shared presets are never changed');
});

test('however long it listens, a breath held from the start can be let go quietly', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    const {st} = make(LEVELS[2], diff, 3);
    const air = st.diff.lungs * (1 - LUNGS.shaky);
    assert.ok(st.holdable / STALKER.holdRate < air, `${diff}: ${(st.holdable / STALKER.holdRate).toFixed(1)} s against ${air.toFixed(1)} s of air`);
  }
});

test('seeing through a stone, it comes looking, but it does not know: keep still and it will not walk into you', () => {
  for (const diff of ['normal', 'hard']) {
    const def = LEVELS.find(l => l.id === 'cistern');
    const {s, st, p} = make(def, diff, 3);
    p.x = 21; p.z = 5; p.still = 5; s.scares.pending = []; s.scares.triggers = [];
    st.x = 26; st.z = 5; st.nav.field(st.x, st.z, st.field);
    st.decoys = st.stoneTrust;
    st.belief.uniform(); st.belief.place(p.x, p.z, 1); // the worst luck: its guess lands right on you
    st.hearStone({x: 30, z: 5, loud: 17}, 1);
    assert.equal(st.state, 'search');
    assert.ok(st.guessing && st.unaware, 'a guess, not knowledge');
    run(s, 1, 25, () => ({...intent(), holdBreath: st.state === 'linger'}));
    assert.equal(s.state, 'play', `${diff}: caught standing still after a guess, clue ${st.clue}`);
  }
});

test('every patrol point and spawn is somewhere it can stand', () => {
  for (const def of LEVELS) {
    if (!def.stalker) continue;
    const {s} = make(def, 'normal', 3);
    for (const q of [def.stalker.spawn, ...def.stalker.patrol]) assert.ok(s.nav.walkableAt(q[0], q[1]), `${def.id} ${q}`);
  }
});

test('a door slammed on it leaves it beside the door, not inside it', () => {
  const def = LEVELS.find(l => l.id === 'shaft');
  const {s, st} = make(def, 'normal', 3);
  st.x = 13; st.z = 5;
  assert.ok(s.setDoor('gallery-west', false, false), 'the door shut');
  assert.ok(s.nav.walkableAt(st.x, st.z), `it stands at ${st.x},${st.z}`);
  assert.ok(Math.hypot(st.x - 13, st.z - 5) < 2.5, 'beside it');
});

test('coming back, you do not find it standing in the room you are heading for', () => {
  for (const def of LEVELS.slice(1)) for (let seed = 1; seed <= 6; seed++) {
    const {s, st, p} = make(def, 'normal', seed);
    if (!st.active) st.wake();
    s.respawn();
    const nearest = Math.min(...s.goalsLeft().map(c => Math.hypot(c.x - st.x, c.z - st.z)));
    const fromYou = s.nav.distAt(s.nav.field(p.x, p.z), st.x, st.z);
    assert.ok(nearest > 8, `${def.id} seed ${seed}: it is ${nearest.toFixed(1)} m from a core you still need`);
    assert.ok(fromYou > 12, `${def.id} seed ${seed}: it is ${fromYou.toFixed(1)} m from you`);
  }
});

test('and it does not always come back in the same place', () => {
  const {s, st} = make(LEVELS[3], 'normal', 2);
  if (!st.active) st.wake();
  const seen = new Set();
  for (let k = 0; k < 20; k++) { s.respawn(); seen.add(`${st.x},${st.z}`); }
  assert.ok(seen.size >= 2, `${seen.size} place(s)`);
});

test('waylay: standing silent, it lets you come until you are close', () => {
  const {st} = make(cistern, 'hard', 9);
  st.wake(); st.x = 21; st.z = 12; st.nav.field(st.x, st.z, st.field);
  st.enter('wait', 1); st.timer = 30; st.waylaying = true; st.ears = true;
  st.hear([{x: 21, z: 20, loud: NOISE.step, exact: false, kind: 'step'}], 1.2);
  assert.equal(st.state, 'wait', 'heard you 8 m off, and did not stir');
  assert.ok(st.waylaying);
  assert.ok(!st.sonarOn, 'and it is not clicking');
  st.hear([{x: 21, z: 15, loud: NOISE.step, exact: false, kind: 'step'}], 1.5);
  assert.equal(st.state, 'alert', 'three metres: it has you');
  assert.ok(!st.waylaying);
});

test('it clicks twice when it has learned you freeze, catching whoever moves too soon', () => {
  const m = new Memory();
  const {s, st, p, played} = make(cistern, 'hard', 12, m);
  st.diff = {...st.diff, doubleClick: 10}; // always, for the test
  p.x = 24; p.z = 20; p.still = 1; st.wake(); st.x = 18; st.z = 20; st.notice(p.x, p.z, 0); st.enter('hunt', 0);
  st.burst = 'click'; st.pulseIn = 0.05; st.fixAtClick = st.fixT;
  run(s, 0, 0.1);
  assert.ok(st.doubled, 'an empty click, and it clicks again at once');
  assert.ok(st.pulseIn > 0 && st.burst === 'click');
  assert.ok((played.clicks || 0) >= 1);
  // you start moving the moment the first echo has passed
  run(s, 0.1, 1, () => intent({moveY: 1, moveX: 0.2}));
  assert.ok(st.fixT > 0, 'the second echo found you');
});

// ---------------------------------------------------------------- stones, breath and machines

const aimAt = (p, x, z) => { p.yaw = Math.atan2(x - p.x, -(z - p.z)); p.pitch = 0; };

test('a thrown stone flies, lands, makes a noise it can hear, and uses up a stone', () => {
  const {s, st, p, played} = make(cistern);
  p.x = 14; p.z = 18; st.wake(); st.x = 34; st.z = 18; st.enter('patrol', 0); st.target = {x: 34, z: 26};
  aimAt(p, 34, 18);
  const had = s.stones;
  let t = run(s, 0, dt, () => intent({throwStone: true}));
  assert.equal(s.stones, had - 1);
  assert.ok(played.throwStone === 1);
  const landed = [];
  const heard = s.noise.bind(s);
  s.noise = (x, z, loud, exact, kind) => { if (kind === 'stone') landed.push({x, z, loud}); heard(x, z, loud, exact, kind); };
  s.thrown.noise = s.noise;
  t = run(s, t, 4);
  assert.ok(played.stoneHit >= 1, 'you heard it');
  assert.ok(landed.length >= 1 && landed[0].loud === NOISE.stone);
  assert.ok(Math.hypot(landed[0].x - p.x, landed[0].z - p.z) > 5, `it flew: landed at ${landed[0].x.toFixed(1)},${landed[0].z.toFixed(1)}`);
  assert.ok(landed.every((n, i) => i === 0 || n.loud < landed[i - 1].loud), 'each bounce quieter');
});

test('no stones left: nothing is thrown', () => {
  const {s, says, played} = make(cistern);
  s.stones = 0;
  run(s, 0, dt, () => intent({throwStone: true}));
  assert.equal(s.stones, 0);
  assert.ok(!played.throwStone);
  assert.ok(says.some(l => /stones/i.test(l)));
});

test('it falls for stones, then works them out and comes looking for who threw them', () => {
  const {s, st, p, played} = make(cistern, 'normal', 2);
  p.x = 44; p.z = 6; st.wake(); st.x = 24; st.z = 20; st.enter('patrol', 0); st.nav.field(st.x, st.z, st.field);
  const landing = {x: 28, z: 18, loud: NOISE.stone, exact: false, kind: 'stone'};
  // Normal: the first couple work
  for (let k = 0; k < DIFFICULTY.normal.stoneTrust; k++) {
    st.enter('patrol', k * 3);
    st.hear([landing], 2 + k * 3);
    assert.equal(st.state, 'investigate', `stone ${k + 1}: it goes to look`);
    assert.ok(Math.hypot(st.target.x - landing.x, st.target.z - landing.z) < 2);
  }
  // then it does not
  st.enter('patrol', 20);
  const chitters = played.chitter || 0;
  st.hear([landing], 21);
  assert.notEqual(st.state, 'investigate', 'that one it ignored');
  assert.ok((played.chitter || 0) > chitters, 'and you heard it work that out');
  assert.equal(st.state, 'search', 'it goes looking for who threw it');
  assert.ok(Math.hypot(st.target.x - landing.x, st.target.z - landing.z) > 1.5, 'and not at the stone');
  assert.equal(s.state, 'play');
});

test('a stone can break a hunt, once; after it has learned, not at all', () => {
  const {st} = make(cistern, 'hard', 2);
  st.wake(); st.x = 20; st.z = 20; st.fix(24, 20, 0); st.enter('hunt', 0); st.nav.field(st.x, st.z, st.field);
  st.burst = 'dash';
  st.hear([{x: 30, z: 26, loud: NOISE.stone, exact: false, kind: 'stone'}], 2);
  assert.ok(Math.hypot(st.lastKnown.x - 30, st.lastKnown.z - 26) < 0.01, 'off it runs after the stone');
  st.hear([{x: 14, z: 16, loud: NOISE.stone, exact: false, kind: 'stone'}], 5);
  assert.ok(Math.hypot(st.lastKnown.x - 30, st.lastKnown.z - 26) < 0.01, 'the next it ignores');
  assert.equal(st.state, 'hunt');
});

test('your stones come back to what you had when you respawn', () => {
  const {s} = make(cistern);
  const had = s.stones;
  run(s, 0, dt, () => intent({throwStone: true}));
  assert.equal(s.stones, had - 1);
  s.respawn();
  assert.equal(s.stones, had);
  assert.equal(s.thrown.flying.length, 0, 'and none left in the air');
});

test('your lungs: holding drains them, running out makes you gasp aloud and you cannot hold again at once', () => {
  const {s, st, played} = make(cistern);
  st.sleep();
  const hold = () => intent({holdBreath: true});
  let t = run(s, 0, 1, hold);
  assert.ok(s.holdingBreath && s.lungs < 1);
  assert.equal(played.holdBreath, 1);
  const noises = [];
  const orig = s.noise.bind(s);
  s.noise = (x, z, loud, exact, kind) => { noises.push({loud, kind}); orig(x, z, loud, exact, kind); };
  for (let k = 0; k < 400 && !played.gasp; k++) t = run(s, t, dt, hold);
  assert.equal(played.gasp, 1, 'out of air');
  assert.ok(noises.some(n => n.kind === 'breath' && n.loud === NOISE.gasp), 'it can hear that');
  t = run(s, t, 0.5, hold);
  assert.ok(!s.holdingBreath, 'locked out for a moment');
  t = run(s, t, 8);
  assert.equal(s.lungs, 1, 'and it comes back');
});

test('letting go early is quiet; it costs no gasp', () => {
  const {s, st, played} = make(cistern);
  st.sleep();
  let t = run(s, 0, 2, () => intent({holdBreath: true}));
  run(s, t, 0.2);
  assert.equal(played.releaseBreath, 1);
  assert.ok(!played.gasp);
  assert.ok(!s.holdingBreath);
});

test('run hard and you pant; it can hear that up close; held breath hides it', () => {
  const scene = hold => {
    const {s, st, p} = make(cistern, 'normal', 6);
    p.x = 14; p.z = 18; p.wind = 1;
    st.wake(); st.x = 17; st.z = 18; st.enter('listen', 0); st.timer = 30; st.lingerAfter = 1e9; st.ears = true;
    st.sonarT = 1e9; st.nav.field(st.x, st.z, st.field);
    let reacted = false;
    run(s, 0, 2.5, () => { if (st.state !== 'listen') reacted = true; return intent(hold ? {holdBreath: true} : {}); });
    return reacted;
  };
  assert.ok(scene(false), 'it heard you panting 3 m away, and came to look');
  assert.ok(!scene(true), 'not while you hold your breath');
});

test('sprinting winds you, and walking it off takes a while', () => {
  const {s, p} = make(cistern);
  p.x = 14; p.z = 18; p.yaw = Math.PI / 2;
  let t = run(s, 0, 3, () => intent({moveY: 1, sprint: true}));
  const w = p.wind;
  assert.ok(w > 0.4, `wind ${w}`);
  run(s, t, 3);
  assert.ok(p.wind < w && p.wind > 0, `eases off: ${p.wind}`);
  s.respawn();
  assert.equal(p.wind, 0);
});

test('a running pump drowns out your footsteps, but not the sweep', () => {
  const heard = (masking, n) => {
    const {st} = make(cistern, 'normal', 6);
    st.wake(); st.x = 24; st.z = 20; st.enter('patrol', 0); st.nav.field(st.x, st.z, st.field);
    st.masking = masking;
    st.heardYou = false;
    st.hear([n], 1);
    return st.heardYou;
  };
  const step = {x: 24, z: 25, loud: NOISE.step, exact: false, kind: 'step'}, sweep = {x: 24, z: 25, loud: NOISE.sweep, exact: true, kind: 'sweep'};
  assert.equal(heard(0, step), true);
  assert.equal(heard(1, step), false);
  assert.equal(heard(1, sweep), true);
});

test('a level with a pump runs it on a cycle, and tells the creature', () => {
  const def = {...cistern, pump: {x: 24, z: 20, every: [1, 1], lasts: [1, 1]}};
  const {s, st, played} = make(def, 'normal', 6);
  s.player.x = 6; s.player.z = 6;
  let peak = 0, low = 1;
  run(s, 0, 8, () => { peak = Math.max(peak, st.masking); low = Math.min(low, st.masking); return intent(); });
  assert.ok(peak > 0.5 && low < 0.5, `masking moved between ${low.toFixed(2)} and ${peak.toFixed(2)}`);
  assert.ok(played.pump > 100, 'and you could hear it');
});

// ---------------------------------------------------------------- telling you what happened

test('the Caught screen says what gave you away', () => {
  const {s, st, p, caught} = make(cistern, 'normal', 3);
  p.x = 24; p.z = 20; st.wake(); st.x = 24.5; st.z = 20; st.enter('hunt', 0); st.clue = 'run'; st.pulseIn = -1;
  const t = run(s, 0, 4);
  assert.equal(s.state, 'caught');
  const cam = new Camera();
  for (let f = 0; f < 80; f++) s.update(dt, t + f * dt, intent(), cam, view); // the catch itself plays out
  assert.equal(caught.length, 1);
  assert.match(caught[0].lesson, /run/i);
});

test('what it learned reaches the end-of-level report, along with how close it came', () => {
  const m = new Memory();
  const {s} = make(LEVELS[0], 'normal', 3, m);
  let won = null;
  s.ui.won = w => { won = w; };
  s.stats.closeCalls = 2; s.stats.heard = 7; s.stats.hides = 1;
  s.win();
  assert.equal(won.heard, 7); assert.equal(won.closeCalls, 2); assert.equal(won.hides, 1);
  assert.deepEqual(won.learned, [], 'nothing hunting you in the tutorial, so nothing learned');
});

test('the debug view can see what it thinks, and is quiet without a creature', () => {
  const {s, st} = make(cistern);
  assert.ok(s.brainDebug());
  assert.equal(s.brainDebug().state.split(':')[0], st.state);
  assert.equal(typeof s.brainDebug().unsure, 'number');
  const map = s.beliefMap();
  assert.equal(map.cells.length, map.w * map.h);
  assert.ok(Math.max(...map.cells) <= 1);
  assert.equal(make(LEVELS[0]).s.brainDebug(), null);
});

test('door changes reach its map: a shut door is no way through for what it reasons', () => {
  const {s, st} = make(cistern);
  const n0 = st.belief.cells;
  st.belief.rebuild();
  assert.equal(st.belief.cells, n0, 'rebuilding changes nothing while nothing has changed');
});
