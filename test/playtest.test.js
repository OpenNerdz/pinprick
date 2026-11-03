// The playtest harness (tools/playtest.mjs): the fairness gate really gates, the detectors really detect,
// runs replay exactly, and every persona can drive the current game. It says nothing about balance: that
// is what running the harness is for, and these tests must keep passing while the creature's AI changes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadGame, playRun, resolveSrc} from '../tools/playtest/run.mjs';
import {Perception, makeStubs, AUDIBLE, loudness} from '../tools/playtest/perception.mjs';
import {Observer} from '../tools/playtest/metrics.mjs';
import {PERSONAS} from '../tools/playtest/bots.mjs';
import {aggregate, printCompare} from '../tools/playtest/report.mjs';

const root = new URL('..', import.meta.url).pathname;
const game = await loadGame(join(root, 'src'));
const LEVEL = game.LEVELS[1].id;

/** A real session behind a real gate. */
function gated(difficulty = 'normal', reaction = 0.25) {
  const perc = new Perception(() => 0.5, {reaction});
  const stubs = makeStubs(perc.input);
  const s = new game.Session(game.LEVELS[1], {difficulty, seed: 3, renderer: stubs.renderer, sounds: stubs.sounds, ui: stubs.ui});
  perc.attach(s);
  return {perc, s, stubs};
}
const still = () => ({moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false});

test('gate: a sound arrives only if it is loud enough, and only after the reaction delay', () => {
  const {perc, s, stubs} = gated();
  const p = s.player;
  stubs.sounds.clicks(p.x + 5, p.z, 0, true);          // close, clear
  perc.refresh(0.1, 0.1);
  assert.equal(perc.heard.length, 0, 'not before the reaction delay');
  perc.refresh(0.3, 0.2);
  assert.equal(perc.heard.length, 1);
  assert.equal(perc.heard[0].kind, 'click');
  assert.ok(Math.abs(perc.heard[0].dist - 5) < 3, 'distance by ear is rough, not wild');

  assert.ok(loudness(0.1, 200, 0.85) < AUDIBLE);
  stubs.sounds.clicks(p.x + 200, p.z, 0.85, true);     // far off, through rock
  stubs.sounds.gallop(p.x + 200, p.z, 0.85);
  perc.refresh(5, 0.1);
  perc.refresh(6, 1);
  assert.equal(perc.heard.length, 0, 'too far to hear');
});

test('gate: the tracker shows nothing unless it is up, and nothing behind you', () => {
  const {perc, s} = gated();
  const tr = s.tracker, p = s.player;
  tr.owned = true; tr.blips.push({x: p.x + Math.sin(p.yaw) * 5, z: p.z - Math.cos(p.yaw) * 5, t: 0});
  perc.refresh(0, 0);
  assert.equal(perc.tracker.blips.length, 0, 'lowered: blank');
  tr.on = true; s.hands.want = 'tracker'; s.hands.trk = 1;
  perc.refresh(0, 0);
  assert.equal(perc.tracker.blips.length, 1, 'raised: the blip');
  tr.blips[0].x = p.x - Math.sin(p.yaw) * 5; tr.blips[0].z = p.z + Math.cos(p.yaw) * 5;
  perc.refresh(0, 0);
  assert.equal(perc.tracker.blips.length, 0, 'behind you: not on the fan');
});

test('gate: a bot cannot name the creature, and a core is unknown until a ray lands on it', () => {
  const {perc, s, stubs} = gated();
  const seen = new Set(), walk = o => { for (const k of Object.keys(o)) { seen.add(k); if (o[k] && typeof o[k] === 'object' && !ArrayBuffer.isView(o[k]) && !seen.has(o[k])) { seen.add(o[k]); if (k !== 'input') walk(o[k]); } } };
  walk(perc);
  for (const k of ['stalker', 'session', 'nav', 'playerNav', 'player', 'world']) assert.ok(!seen.has(k), `perception exposes ${k}`);
  const src = readFileSync(join(root, 'tools/playtest/bots.mjs'), 'utf8').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
  assert.ok(!/stalker|session|\.state\b|import /.test(src), 'bots.mjs touches nothing but its perception');

  assert.equal(perc.cores.length, 0);
  const c = s.cores[0];
  stubs.renderer.setDots().push(c.x + 0.2, 1.2, c.z, 0, 1, 0.24, 0.55, 0.03);
  perc.refresh(0, 0);
  assert.equal(perc.cores.length, 1);
});

test('gate: the beam reveals the creature only while a ray is on it', () => {
  const {perc, s} = gated();
  const st = s.stalker;
  if (!st.active) st.wake(s.player);
  perc.refresh(0, 0);
  assert.equal(perc.lit, null);
  st.actor.hits++;
  perc.refresh(0, 0);
  assert.equal(perc.lit.x, st.x);
  perc.refresh(0, 0);
  assert.equal(perc.lit, null, 'the moment the light leaves, you do not know');
});

// detectors, on made-up frames
const frames = (obs, secs, fn, T0 = 0) => { const dt = 1 / 30; let T = T0; for (; T < T0 + secs; T += dt) obs.frame({T, dt, state: 'patrol', x: 0, z: 0, speed: 0, dist: 30, walkable: true, target: null, ...fn(T)}); return T; };
const flagged = (o, type) => o.finish({outcome: 'won', T: 100}).counts[type] || 0;

test('detector: stuck', () => {
  const a = new Observer(); frames(a, 7, () => ({speed: 1.3}));
  assert.equal(flagged(a, 'stuck'), 1, 'walking on the spot');
  const b = new Observer(); frames(b, 7, T => ({speed: 1.3, x: T * 1.3}));
  assert.equal(flagged(b, 'stuck'), 0, 'walking');
  const c = new Observer(); frames(c, 7, () => ({speed: 0, state: 'listen'}));
  assert.equal(flagged(c, 'stuck'), 0, 'standing on purpose');
  const d = new Observer(); frames(d, 7, () => ({speed: 1.3, pinned: true}));
  assert.equal(flagged(d, 'stuck'), 0, 'held in the beam');
});

test('detector: oscillation of states, targets and position', () => {
  const a = new Observer(); frames(a, 14, T => ({state: Math.floor(T) % 2 ? 'listen' : 'patrol'}));
  assert.equal(flagged(a, 'oscillation'), 1, 'two states, over and over: one episode');
  const b = new Observer(); frames(b, 14, T => ({target: Math.floor(T) % 2 ? {x: 10, z: 0} : {x: 0, z: 0}}));
  assert.ok(flagged(b, 'oscillation') >= 1, 'target flipping');
  const c = new Observer(); frames(c, 14, T => ({x: Math.abs(((T * 3) % 6) - 3)}));
  assert.ok(flagged(c, 'oscillation') >= 1, 'pacing in a tiny box');
  const d = new Observer(); frames(d, 14, T => ({x: T * 3, target: {x: T * 3 + 5, z: 0}}));
  assert.equal(flagged(d, 'oscillation'), 0, 'going somewhere');
});

test('detector: camping, but not a deliberate wait and not next to the player', () => {
  const a = new Observer(); frames(a, 30, () => ({state: 'listen'}));
  assert.equal(flagged(a, 'camping'), 1);
  const b = new Observer(); frames(b, 30, () => ({state: 'wait'}));
  assert.equal(flagged(b, 'camping'), 0, 'waiting on purpose');
  const c = new Observer(); frames(c, 30, () => ({state: 'listen', dist: 5}));
  assert.equal(flagged(c, 'camping'), 0, 'the player is right there');
  const d = new Observer({}, {deliberate: ['lurk']}); frames(d, 30, () => ({state: 'lurk'}));
  assert.equal(flagged(d, 'camping'), 0, 'a state you declare deliberate');
  const e = new Observer(); frames(e, 30, () => ({state: 'lurk', deliberate: true}));
  assert.equal(flagged(e, 'camping'), 0, 'or the creature says so itself');
});

test('detector: impossible movement, but not the game moving it on purpose', () => {
  const a = new Observer(); frames(a, 2, T => ({x: T * 9}));
  assert.equal(flagged(a, 'impossible'), 1, 'too fast');
  const b = new Observer(); const T = frames(b, 1, () => ({})); b.teleport(T); frames(b, 1, () => ({x: 30}), T);
  assert.equal(flagged(b, 'impossible'), 0, 'teleported by the game');
  const c = new Observer(); frames(c, 1, () => ({walkable: false}));
  assert.equal(flagged(c, 'impossible'), 1, 'off the grid');
});

test('detector: unfair kills', () => {
  const kill = (obs, T, k) => obs.caught({T, state: 'patrol', pstill: 0, scanning: false, hidden: false, warnT: T - 0.5, ...k});
  const a = new Observer(); frames(a, 2, () => ({})); kill(a, 2, {pstill: 3});
  assert.equal(flagged(a, 'unfair'), 1, 'still and quiet, never noticed');
  const b = new Observer(); frames(b, 2, () => ({state: 'hunt'})); kill(b, 2, {state: 'hunt', pstill: 3, warnT: 1.5});
  assert.equal(flagged(b, 'unfair'), 0, 'it was hunting you');
  const c = new Observer(); frames(c, 2, () => ({})); kill(c, 2, {pstill: 0, warnT: -99});
  assert.equal(flagged(c, 'unfair'), 1, 'walked into something that gave no warning');
  const d = new Observer(); frames(d, 2, () => ({})); kill(d, 2, {pstill: 0, warnT: 1});
  assert.equal(flagged(d, 'unfair'), 0, 'walked into something you could hear');
  const e = new Observer(); frames(e, 2, () => ({state: 'finale'})); kill(e, 2, {state: 'finale', pstill: 3, warnT: -99});
  assert.equal(flagged(e, 'unfair'), 0, 'the last chase announces itself');
});

test('detector: never engages; pacing and tension numbers', () => {
  const a = new Observer(); frames(a, 60, () => ({dist: 30}));
  assert.equal(flagged(a, 'never'), 1);
  const b = new Observer();
  let T = frames(b, 10, () => ({dist: 30}));          // quiet
  T = frames(b, 5, () => ({state: 'hunt', dist: 4}), T);
  T = frames(b, 20, () => ({dist: 40}), T);           // a breather
  T = frames(b, 5, () => ({state: 'alert', dist: 6}), T);
  const r = b.finish({outcome: 'won', T});
  assert.equal(r.hunts, 1); assert.equal(r.escapes, 1); assert.equal(r.encounters, 2);
  assert.equal(r.counts.never, undefined);
  assert.ok(Math.abs(r.minBreather - 20) < 4, `breather ${r.minBreather}`);
  assert.ok(r.longestQuiet >= 16, `quiet ${r.longestQuiet}`);
  assert.ok(Math.abs(r.pct8 - 25) < 2 && Math.abs(r.pct25 - 75) < 2, `${r.pct8} ${r.pct25}`);
  assert.equal(r.peaks, 1, 'one complete dip in distance so far');
});

test('a run replays exactly from its seed', () => {
  const task = {level: LEVEL, diff: 'hard', persona: 'noisy', seed: 5}, o = {maxTime: 45};
  const first = playRun(game, task, o);
  playRun(game, {...task, persona: 'careful', seed: 9}, o); // nothing may carry over from run to run
  assert.deepEqual(playRun(game, task, o), first);
  assert.notDeepEqual(playRun(game, {...task, seed: 6}, o), first);
});

test('a run leaves Math.random as it found it', () => {
  const r = Math.random;
  playRun(game, {level: LEVEL, diff: 'easy', persona: 'runner', seed: 1}, {maxTime: 2});
  assert.equal(Math.random, r);
});

test('every persona drives the game: it moves, it acts like itself, it ends cleanly', () => {
  for (const persona of PERSONAS) {
    const r = playRun(game, {level: LEVEL, diff: 'normal', persona, seed: 2}, {maxTime: 60, maxDeaths: 3});
    assert.ok(['won', 'gaveup', 'timeout'].includes(r.outcome), persona);
    assert.ok(r.bot.still < 95, `${persona} barely moved: ${JSON.stringify(r.bot)}`);
    if (persona === 'careful') assert.ok(r.bot.sneak > r.bot.walk + r.bot.sprint, 'careful sneaks');
    if (persona === 'runner') assert.ok(r.bot.sprint > 10, 'runner sprints');
    if (persona === 'noisy') assert.ok(r.bot.scan > 40, 'noisy scans');
    if (persona === 'reader') assert.ok(r.bot.tracker > 10, 'reader reads');
  }
});

test('a careful bot makes progress on every level', () => {
  for (const def of game.LEVELS.slice(1)) {
    const r = playRun(game, {level: def.id, diff: 'easy', persona: 'careful', seed: 4}, {maxTime: 240});
    assert.ok(r.coresGot >= 1, `${def.id}: ${r.outcome} ${r.coresGot}/${r.coresTotal}`);
  }
});

test('optional features: stones get thrown and breath gets held where the game has them', () => {
  // the persona only ever looks at session.stones / session.lungs and sets intent.throwStone / holdBreath
  let thrown = 0, held = 0;
  class WithStones extends game.Session {
    constructor(d, o) { super(d, o); this.native = this.stones !== undefined; if (!this.native) { this.stones = 5; this.lungs = 1; } }
    update(dt, T, it, ...r) {
      if (it.throwStone) { thrown++; if (!this.native) this.stones--; }
      if (it.holdBreath) { held++; if (!this.native) this.lungs = Math.max(0, this.lungs - dt / 8); }
      return super.update(dt, T, it, ...r);
    }
  }
  const g = {...game, Session: WithStones};
  for (let seed = 1; seed < 12 && !(thrown && held); seed++) playRun(g, {level: LEVEL, diff: 'normal', persona: 'stoner', seed}, {maxTime: 200});
  assert.ok(thrown > 0, 'threw a stone');
  assert.ok(held > 0, 'held its breath');
});

test('--src finds a tree either way, --out records the commit, --compare marks only real differences', () => {
  assert.equal(resolveSrc(root), join(root, 'src'));
  assert.equal(resolveSrc(join(root, 'src')), join(root, 'src'));
  assert.throws(() => resolveSrc(tmpdir()));
  const dir = mkdtempSync(join(tmpdir(), 'playtest-'));
  try {
    const out = join(dir, 'r.json');
    const text = execFileSync(process.execPath, [join(root, 'tools/playtest.mjs'), '--src', root, '--levels', LEVEL, '--diff', 'easy', '--persona', 'runner', '--seeds', '2', '--jobs', '2', '--commit', 'abc1234', '--max-time', '30', '--out', out], {encoding: 'utf8'});
    assert.ok(text.includes(`${LEVEL}`) && text.includes('runner'));
    const j = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(j.meta.commit, 'abc1234');
    assert.equal(j.runs.length, 2);
    assert.equal(j.rows.length, 1);
  } finally { rmSync(dir, {recursive: true}); }

  const run = (won, deaths) => ({level: 'l', diff: 'easy', persona: 'careful', seed: 1, won, outcome: won ? 'won' : 'gaveup', deaths, time: 60, activeTime: 60, stateTime: {}, hunts: 1, escapes: 0, repels: 0, encounters: 1, gaps: [], longestQuiet: 1, minBreather: null, peaksPerMin: 1, pct8: 1, pct25: 1, kills: {}, killStates: {}, counts: {}, pathologies: [], bot: {}});
  const rows = rs => ({meta: {seeds: rs.length}, rows: aggregate(rs)});
  const many = (wins, n) => Array.from({length: n}, (_, i) => run(i < wins, i < wins ? 0 : 5));
  const lines = [];
  printCompare(rows(many(10, 40)), rows(many(38, 40)), l => lines.push(l));
  assert.ok(lines.some(l => /\+70\*/.test(l)), `a big change is marked: ${lines.join('\n')}`);
  lines.length = 0;
  printCompare(rows(many(4, 8)), rows(many(5, 8)), l => lines.push(l));
  assert.ok(!lines.some(l => /\+13\*/.test(l)), `a small change on few runs is not: ${lines.join('\n')}`);
});
