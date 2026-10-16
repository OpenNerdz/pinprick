// Creature balance by difficulty: plays scripted players through the real Session (no browser) and
// prints how often each gets caught. Run after changing the creature or the numbers in config.js.
//   node tools/balance.mjs            every scenario
//   node tools/balance.mjs stalked    just one (still, lunge, escape, sonar, stalked, finale, wander)
import {LEVELS} from '../src/levels/index.js';
import {Session} from '../src/game/session.js';
import {Camera} from '../src/render/camera.js';
import {angleDiff, rng} from '../src/util/math.js';

const noop = () => {};
const sounds = () => new Proxy({e: {listener: {x: 0, z: 0, yaw: 0}}}, {get: (t, k) => (k in t ? t[k] : noop)});
const renderer = () => { const dots = {push: noop, total: 0, clear: noop}; return {setDots: () => dots, setGhosts: noop, setLevelMesh: noop, setActors: noop, addLine: noop, addFan: noop}; };
const intent = () => ({moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false});
const view = {w: 400, h: 800}, dt = 1 / 30, DIFFS = ['easy', 'normal', 'hard'], LV = LEVELS.slice(1);
const make = (def, seed, difficulty) => new Session(def, {difficulty, seed, renderer: renderer(), sounds: sounds(), ui: {say: noop, note: noop, caught: noop, won: noop, cores: noop}});
const which = process.argv[2] || 'all', on = k => which === 'all' || which === k;
const pct = (a, b) => String(Math.round(100 * a / b)).padStart(3) + '%';
const row = (label, diff, cells) => console.log(`${label.padEnd(44)} ${diff.padEnd(6)} ${cells.join('  ')}`);

/** Play `secs` of a session, `fn(t)` giving each frame's intent. */
function play(s, secs, fn = intent) { const cam = new Camera(); for (let t = 0; t < secs && s.state === 'play'; t += dt) s.update(dt, t, fn(t), cam, view); }

/** Fill `it` to walk toward (tx, tz) along the player's grid, crouching for crawls (or always, sneaking). */
function steer(s, it, tx, tz, memo) {
  const p = s.player, nav = s.playerNav;
  if (!memo.path || memo.i++ % 8 === 0) memo.path = nav.path(nav.field(p.x, p.z), tx, tz, 1.2);
  const path = memo.path;
  if (!path || path.length < 2) return false;
  const k = Math.min(path.length - 1, 3), wx = nav.cx(path[k]), wz = nav.cz(path[k]);
  it.lookX = angleDiff(p.yaw, Math.atan2(wx - p.x, -(wz - p.z))); it.moveY = 1;
  const low = path.slice(0, 6).some(c => s.world.heightAt(nav.cx(c), nav.cz(c)) < 1.75);
  if (!!(low || memo.sneak) !== p.crouched) it.crouch = true;
  return true;
}

function openSpot(s, r) {
  for (;;) {
    const x = r() * s.world.w * 2, z = r() * s.world.h * 2;
    if (s.playerNav.walkableAt(x, z) && s.nav.walkableAt(x, z) && !s.L.hides.some(h => Math.hypot(x - h.x, z - h.z) < h.r + 0.3)) return [x, z];
  }
}

/** Per level, how many of N seeded runs end caught. */
function rate(N, fn) { return LV.map(def => { let c = 0; for (let k = 0; k < N; k++) if (fn(def, k)) c++; return `${def.id} ${pct(c, N)}`; }); }

if (on('still')) for (const diff of DIFFS) row('standing still in the open, 90 s', diff, rate(12, (def, k) => {
  const s = make(def, 100 + k, diff);
  [s.player.x, s.player.z] = openSpot(s, rng(k * 7 + 1)); s.stalker.wake(s.player);
  play(s, 90); return s.state !== 'play';
}));

if (on('lunge')) for (const diff of DIFFS) {
  let c = 0; const N = 12;
  for (let k = 0; k < N; k++) {
    const s = make(LEVELS[2], 500 + k, diff), st = s.stalker, p = s.player;
    p.x = 19; p.z = 19; p.yaw = Math.PI / 2; st.wake(); st.x = 15 + k * 0.01; st.z = 19; st.enter('patrol', 0); st.notice(p.x, p.z, 0);
    play(s, 3.2, () => ({...intent(), moveY: 1, sprint: true}));
    if (s.state !== 'play') c++;
  }
  row('noticed at 4 m, sprinting the moment it freezes', diff, [pct(c, N)]);
}

if (on('escape')) for (const plan of ['freeze', 'sneak', 'hide']) for (const diff of DIFFS) row(`hunted from 9 m, run 5 s, then ${plan}`, diff, rate(8, (def, k) => {
  const s = make(def, 900 + k, diff), st = s.stalker, p = s.player;
  [p.x, p.z] = openSpot(s, rng(k * 3 + 11)); st.wake(p);
  const f = s.nav.field(p.x, p.z);
  let bi = -1, bd = 1e9;
  for (let i = 0; i < s.nav.n; i++) if (s.nav.walk[i] && Math.abs(f[i] - 9) < bd) { bd = Math.abs(f[i] - 9); bi = i; }
  st.x = s.nav.cx(bi); st.z = s.nav.cz(bi); st.notice(p.x, p.z, 0);
  const away = s.nav.field(st.x, st.z);
  let gx = p.x, gz = p.z, gd = -1;
  for (let i = 0; i < s.playerNav.n; i++) if (s.playerNav.walk[i] && isFinite(away[i]) && away[i] > gd && Math.hypot(s.nav.cx(i) - p.x, s.nav.cz(i) - p.z) < 25) { gd = away[i]; gx = s.nav.cx(i); gz = s.nav.cz(i); }
  if (plan === 'hide') { const h = s.L.hides.slice().sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z))[0]; gx = h.x; gz = h.z; }
  const memo = {i: 0};
  play(s, 45, t => {
    const it = intent(), run = t < 5, there = Math.hypot(p.x - gx, p.z - gz) < 0.5;
    if (plan === 'hide') { memo.sneak = !run; if (!there) steer(s, it, gx, gz, memo); else if (!p.crouched) it.crouch = true; it.sprint = run; }
    else if (run) { steer(s, it, gx, gz, memo); it.sprint = true; }
    else if (plan === 'sneak' && !there) { memo.sneak = true; steer(s, it, gx, gz, memo); }
    return it;
  });
  return s.state !== 'play';
}));

// crouch-walking past it while it stands listening 8 m away; one player freezes whenever it clicks
if (on('sonar')) for (const react of [false, true]) for (const diff of DIFFS) row(`sneaking past it as it listens${react ? ', freezing at clicks' : ''}`, diff, rate(8, (def, k) => {
  const s = make(def, 1300 + k, diff), st = s.stalker, p = s.player, r = rng(k * 5 + 2);
  [p.x, p.z] = openSpot(s, r); st.wake(p);
  const f = s.nav.field(p.x, p.z);
  let bi = -1, bd = 1e9;
  for (let i = 0; i < s.nav.n; i++) if (s.nav.walk[i] && Math.abs(f[i] - 8) < bd) { bd = Math.abs(f[i] - 8); bi = i; }
  st.x = s.nav.cx(bi); st.z = s.nav.cz(bi); st.enter('listen', 0); st.timer = 12; st.sonarT = 1;
  const [gx, gz] = openSpot(s, r), memo = {i: 0, sneak: true};
  let frozen = 0;
  play(s, 15, () => {
    const it = intent();
    if (react && st.pulseIn >= 0) frozen = 1.2; // heard the clicks: hold still until the echo has passed
    if ((frozen -= dt) > 0) { if (!p.crouched) it.crouch = true; return it; }
    steer(s, it, gx, gz, memo); return it;
  });
  return s.state !== 'play';
}));

// it is stalking you 12 m back while you walk somewhere. 'walk' never reacts; 'look' stops every 8 s
// and turns the scanner on behind; 'wait' stands still for 10 s once its steps sound doubled.
const STALKED = {walk: 'stalked while walking', look: '..., stopping to scan behind every 8 s', wait: '..., standing still when steps sound doubled'};
if (on('stalked')) for (const plan of ['walk', 'look', 'wait']) for (const diff of DIFFS) row(STALKED[plan], diff, rate(8, (def, k) => {
  const s = make(def, 1700 + k, diff), st = s.stalker, p = s.player, r = rng(k * 9 + 4);
  [p.x, p.z] = openSpot(s, r);
  const f = s.nav.field(p.x, p.z);
  let bi = -1, bd = 1e9;
  for (let i = 0; i < s.nav.n; i++) if (s.nav.walk[i] && Math.abs(f[i] - 12) < bd) { bd = Math.abs(f[i] - 12); bi = i; }
  st.wake(); st.x = s.nav.cx(bi); st.z = s.nav.cz(bi); st.fix(p.x, p.z, 0); st.enter('stalk', 0);
  // you are heading somewhere away from it (of a few spots, the one with the most of you between)
  const away = () => { const fc = s.nav.field(st.x, st.z), fp = s.nav.field(p.x, p.z); let best = null, bs = -1e9;
    for (let n = 0; n < 12; n++) { const q = openSpot(s, r), sc = s.nav.distAt(fc, q[0], q[1]) - s.nav.distAt(fp, q[0], q[1]); if (isFinite(sc) && sc > bs) { bs = sc; best = q; } }
    return best || openSpot(s, r); };
  let goal = away(), waitUntil = -1, waited = false;
  const memo = {i: 0};
  play(s, 45, t => {
    const it = intent();
    if (plan === 'look' && t % 8 > 6.5) { // stop, turn round, light it up
      it.lookX = angleDiff(p.yaw, Math.atan2(st.x - p.x, -(st.z - p.z))); it.firing = true; return it;
    }
    if (plan === 'wait' && !waited && st.echoes >= 4) { waited = true; waitUntil = t + 10; }
    if (t < waitUntil) return it;
    if (Math.hypot(p.x - goal[0], p.z - goal[1]) < 1 || !steer(s, it, goal[0], goal[1], memo)) { goal = away(); memo.path = null; }
    return it;
  });
  return s.state !== 'play';
}));

if (on('finale')) for (const diff of DIFFS) row('final run to the door, stopping 2 s in every 6', diff, rate(8, (def, k) => {
  const s = make(def, 400 + k, diff), st = s.stalker, p = s.player, r = rng(k + 3);
  if (!st.active) st.wake(); else { const q = st.cfg.patrol[Math.floor(r() * st.cfg.patrol.length)]; st.x = q[0]; st.z = q[1]; }
  s.cores.forEach((c, i) => { if (i < s.cores.length - 1) { c.got = true; c.orb.on = false; s.coresGot++; } });
  const last = s.cores[s.cores.length - 1];
  p.x = last.x; p.z = last.z + 0.3;
  const memo = {i: 0};
  play(s, 240, t => { const it = intent(); if (s.coresLeft === 0 && (t % 6) < 4) { steer(s, it, s.exit.x, s.exit.z, memo); it.sprint = st.euclid < 7 && !p.crouched; } return it; });
  return s.state === 'caught';
}));

if (on('wander')) for (const diff of DIFFS) row('sneaking about ignoring every warning, 120 s', diff, rate(8, (def, k) => {
  const s = make(def, 700 + k, diff), st = s.stalker, p = s.player, r = rng(k * 13 + 5);
  if (!st.active) st.wake(p);
  const memo = {i: 0, sneak: true};
  let goal = null;
  play(s, 120, () => {
    const it = intent();
    if (!goal || Math.hypot(p.x - goal[0], p.z - goal[1]) < 0.8) { goal = openSpot(s, r); memo.path = null; }
    if (!steer(s, it, goal[0], goal[1], memo)) goal = null;
    return it;
  });
  return s.state !== 'play';
}));
