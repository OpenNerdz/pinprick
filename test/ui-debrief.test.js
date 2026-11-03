// The end-of-level grade and debrief, the stored settings, and the keys the shell removes.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gradeRun, parFor, debriefRows, learnedLines} from '../src/ui/debrief.js';
import {sanitize, DEFAULTS} from '../src/ui/settings.js';
import {keyboardRows, dragRows, touchRows, padRows, rowsHtml} from '../src/ui/controls.js';
import {brainText, brainValue, heatPixel} from '../src/ui/debugview.js';
import {LEVELS} from '../src/levels/index.js';

test('grade: clean and quick beats slow and caught, and nothing passed at all still grades', () => {
  const par = 400;
  const top = gradeRun({time: 300, par, deaths: 0, closeCalls: 0});
  assert.equal(top.letter, 'S');
  assert.equal(gradeRun({time: 1000, par, deaths: 0, closeCalls: 0}).letter, 'B');
  assert.equal(gradeRun({time: 400, par, deaths: 2, closeCalls: 3}).letter, 'C');
  assert.equal(gradeRun({time: 2000, par, deaths: 6, closeCalls: 20}).letter, 'D');
  assert.ok(gradeRun({time: 400, par, closeCalls: 4}).score < gradeRun({time: 400, par, closeCalls: 0}).score);
  assert.ok(gradeRun({time: 400, par, deaths: 1, difficulty: 'hard'}).score > gradeRun({time: 400, par, deaths: 1, difficulty: 'easy'}).score);
  assert.equal(typeof gradeRun().letter, 'string');
  assert.equal(typeof gradeRun({time: NaN, deaths: 'x', closeCalls: null}).letter, 'string');
});

test('every level has a par time', () => {
  for (const def of LEVELS) assert.ok(parFor(def) >= 60, def.id);
  assert.equal(parFor({par: 123}), 123);
  assert.ok(parFor(undefined) > 0);
});

test('debrief rows and lessons cope with whatever they are handed', () => {
  assert.deepEqual(debriefRows(undefined), []);
  assert.deepEqual(debriefRows({}), []);
  assert.deepEqual(debriefRows({heard: 4, closeCalls: 0, hides: 2.2}), [['It heard you', '4'], ['Close calls', '0'], ['Hid', '2']]);
  assert.deepEqual(learnedLines(undefined), []);
  assert.deepEqual(learnedLines({learned: 'nope'}), []);
  assert.deepEqual(learnedLines({learned: ['It learned you hide here.', ' ', null, 'It learned you hide here.', 'Another']}), ['It learned you hide here.', 'Another']);
  assert.equal(learnedLines({learned: Array.from({length: 20}, (_, i) => 'n' + i)}).length, 6);
});

test('stored settings cannot break the game', () => {
  const bad = sanitize({...DEFAULTS, lookSpeed: 'fast', volume: 9, difficulty: 'nightmare', captions: 'yes', quality: 'ultra', invertY: 1});
  assert.equal(bad.lookSpeed, DEFAULTS.lookSpeed);
  assert.equal(bad.volume, 1);
  assert.equal(bad.difficulty, DEFAULTS.difficulty);
  assert.equal(bad.captions, true);
  assert.equal(bad.invertY, true);
  assert.equal(bad.quality, null);
  assert.equal(sanitize({...DEFAULTS, difficulty: 'constructor'}).difficulty, DEFAULTS.difficulty);
  assert.equal(sanitize({...DEFAULTS, volume: null}).volume, DEFAULTS.volume);
});

test('every way of playing documents every action', () => {
  for (const [name, rows] of [['keys', keyboardRows()], ['drag', dragRows()], ['touch', touchRows(false)], ['touch left', touchRows(true)], ['pad', padRows()]]) {
    const text = JSON.stringify(rows).toLowerCase();
    for (const word of ['walk', 'look around', 'paint the dark', 'one full picture', 'hides you', 'motion tracker', 'stone', 'breath', 'pause']) {
      assert.ok(text.includes(word), `${name} lacks ${word}`);
    }
    assert.ok(rowsHtml(rows).includes('<b>'));
  }
  assert.ok(JSON.stringify(keyboardRows()).includes('F, E or right click'));
});

test('the brain overlay formats anything, and its heat map brightens with belief', () => {
  assert.equal(brainText(null), 'brain: nothing to report');
  assert.equal(brainText({state: 'hunt', x: 1.2345, n: 3, at: {x: 1.2345, list: [0.126]}}), 'state: hunt\nx: 1.23\nn: 3\nat: {"x":1.23,"list":[0.13]}');
  assert.equal(brainValue(undefined), 'undefined');
  const d = new Uint8ClampedArray(12);
  heatPixel(0, d, 0); heatPixel(0.5, d, 4); heatPixel(1, d, 8);
  assert.ok(d[1] < d[5] && d[5] < d[9], 'more belief, more light');
  heatPixel(NaN, d, 0);
  assert.equal(d[3], 255);
});
