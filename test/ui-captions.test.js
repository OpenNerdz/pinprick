// Captions: wording, what counts as audible, the rate limits, and the hook in the real sound code.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {direction, whereWords, audible, captionText, CaptionLog} from '../src/ui/captions.js';
import {Sounds} from '../src/audio/sounds.js';

const at = (deg, dist) => ({pan: Math.sin(deg * Math.PI / 180), front: Math.cos(deg * Math.PI / 180), dist});

test('direction is rough, and right is right', () => {
  assert.equal(direction(0, 1), 'ahead');
  assert.equal(direction(1, 0), 'right');
  assert.equal(direction(-1, 0), 'left');
  assert.equal(direction(0, -1), 'behind you');
  assert.equal(direction(Math.sin(2.8), Math.cos(2.8)), 'behind you');
});

test('the wording matches what the design asked for', () => {
  assert.equal(captionText('clicks', at(180, 5)), '[clicking, behind you, close]');
  assert.equal(captionText('shriek', at(-90, 30)), '[shriek, far left]');
  assert.equal(captionText('groan', at(90, 12)), '[groan, right]');
  assert.equal(captionText('doubled', at(170, 12)), '[footsteps doubled, behind you]');
  assert.equal(captionText('steps', at(0, 1.5)), '[footsteps, ahead, very close]');
  assert.equal(captionText('clicks', at(0, 12), 0.6), '[muffled clicking, ahead]');
  assert.equal(captionText('sting', null), '[metal shrieking]');
  assert.equal(captionText('ping', {pan: -0.8}), '[signal ping, left]');
  assert.equal(captionText('mimic', at(90, 9), 0, 'tracker'), '[tracker tick, wrong, right]');
  assert.equal(whereWords(at(0, 40)), 'far ahead');
});

test('only what you could really hear: rock and distance count, your own devices always do', () => {
  assert.equal(audible('clicks', 0.05, 0), true);
  assert.equal(audible('clicks', 0.05, 0.85), true);
  assert.equal(audible('clicks', 0.012, 0), true);
  assert.equal(audible('clicks', 0.012, 0.85), false, 'just audible in the open, lost behind rock');
  assert.equal(audible('steps', 0.002, 0), false);
  assert.equal(audible('ping', 0.001), true);
});

test('rate limits: a family gets one line, which keeps up with the sound, and then a new one after its gap', () => {
  const log = new CaptionLog();
  assert.equal(log.hear('clicks', at(180, 5), 0.05, 0, undefined, 10), true);
  assert.equal(log.hear('quickclicks', at(90, 5), 0.05, 0, undefined, 10.5), false, 'same family, too soon');
  assert.equal(log.lines.length, 1);
  assert.equal(log.lines[0].text, '[quick clicks, right, close]', 'but the line up keeps up with where it is');
  log.tick(11);
  assert.equal(log.lines.length, 1);
  log.tick(20);
  assert.equal(log.lines.length, 0, 'lines expire');
  assert.equal(log.hear('clicks', at(0, 5), 0.05, 0, undefined, 20.1), true, 'after the gap, a new line');
});

test('a full screen keeps the warnings, and never spams', () => {
  const log = new CaptionLog();
  for (const [i, k] of ['drip', 'groan', 'breath'].entries()) log.hear(k, at(0, 9), 0.05, 0, undefined, i * 0.1);
  assert.equal(log.lines.length, 3);
  log.hear('clicks', at(0, 5), 0.05, 0, undefined, 1);
  assert.equal(log.lines.length, 3);
  assert.ok(log.lines.some(l => l.family === 'clicks'), 'the warning got in');
  assert.ok(!log.lines.some(l => l.family === 'tunnel'), 'the drip gave way');
  log.hear('wind', at(0, 30), 0.05, 0, undefined, 1.1);
  assert.ok(!log.lines.some(l => l.family === 'tunnel'), 'and a noise of the tunnels cannot push a warning out');

  let made = 0;
  const steady = new CaptionLog();
  for (let t = 0; t < 30; t += 0.25) if (steady.hear('steps', at(0, 9), 0.05, 0, undefined, t)) made++;
  assert.ok(made <= 9, 'footsteps four times a second for 30 s, ' + made + ' new lines');
});

test('the real sound code reports what plays, at the loudness it plays', () => {
  const heard = [];
  const engine = {
    listener: {x: 0, z: 0, yaw: 0}, ctx: null, now: 0,
    place(x, z) { const d = Math.hypot(x, z) || 0.001; return {pan: x / d, dist: d, front: -z / d}; },
    tone() {}, noise() {}, play() {},
  };
  const s = new Sounds(engine);
  s.clicks(0, 5, 0, true); // behind: the listener faces -z
  s.onSound = (kind, place, level, muffle) => heard.push({kind, level, muffle, dist: place?.dist});
  s.clicks(0, 5, 0, true);
  s.clicks(0, 200, 0.8);
  s.creatureStep(-4, 0, 0.6, 0.7, false); // a light step with none of yours to double: flanking
  s.step('walk');
  s.creatureStep(-4, 0, 0.5, 0.7, false);
  s.creatureStep(-4, 0, 0, 1, false);
  s.shriek(30, 0, 0);
  s.shriek(30, 0, 0, 0.07);
  s.gallop(3, 0, 0);
  s.groan(3, 0, 0);
  s.mimic('tracker', 3, 0, 0);
  s.slam(0, -3); s.whisper(0, -3); s.exhale(0, 1); s.sting(); s.coreBell(); s.doorOpen(); s.ping(false, 0.02, -0.7); s.trackerFrantic();
  const kinds = heard.map(h => h.kind);
  assert.deepEqual(kinds, ['clicks', 'clicks', 'steps', 'doubled', 'steps', 'shriek', 'pain', 'gallop', 'groan', 'mimic', 'slam', 'whisper', 'exhale', 'sting', 'bell', 'door', 'ping', 'tracker']);
  assert.ok(Math.abs(heard[0].level - 0.1 / (1 + 5 / 4)) < 1e-9, 'level is the falloff at() plays it at');
  assert.equal(audible('clicks', heard[1].level, heard[1].muffle), false, 'a click 200 m away through rock makes no line');
  assert.equal(heard[0].dist, 5);

  // the pump: its line says whether it is running, and while it does the rest of the world is quieter
  heard.length = 0;
  s.pump(0, 5, 0.2); s.pump(0, 5, 1);
  s.clicks(0, 5, 0, true);
  s.pump(0, 5, 0.3); s.pump(0, 5, 0.2);
  assert.deepEqual(heard.map(h => h.kind), ['pump', 'clicks', 'pumpstop']);
  assert.ok(Math.abs(heard[1].level - 0.05 / (1 + 5 / 4)) < 1e-9, 'half as loud under the pump');

  heard.length = 0;
  s.stoneHit(2, 0, 1); s.chitter(2, 0, 0); s.sniff(2, 0, 0); s.stomp(2, 0, 0); s.gasp(); s.pant(0.1); s.pant(0.8);
  assert.deepEqual(heard.map(h => h.kind), ['stone', 'chitter', 'sniff', 'stomp', 'gasp', 'pant']);
});

test('the pump line stays up while it runs and turns into its stopping', () => {
  const log = new CaptionLog();
  for (let t = 0; t < 12; t += 0.05) log.hear('pump', null, 1, 0, undefined, t);
  log.tick(12);
  assert.deepEqual(log.lines.map(l => l.text), ['[pump running]']);
  log.hear('pumpstop', null, 1, 0, undefined, 12.05);
  assert.deepEqual(log.lines.map(l => l.text), ['[pump stops]']);
  log.tick(13); assert.equal(log.lines.length, 1);
  log.tick(16); assert.equal(log.lines.length, 0);
});
