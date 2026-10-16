// Modules the other tests stub out (sound) still have to load: a slip there only shows in the browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';

test('the sound modules load', async () => {
  const {Sounds} = await import('../src/audio/sounds.js');
  const {AudioEngine} = await import('../src/audio/engine.js');
  assert.equal(typeof Sounds, 'function');
  assert.equal(typeof AudioEngine, 'function');
});
