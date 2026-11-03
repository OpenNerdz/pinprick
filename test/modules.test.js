// Modules the other tests stub out (sound) still have to load: a slip there only shows in the browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync, readFileSync} from 'node:fs';

test('the sound modules load', async () => {
  const {Sounds} = await import('../src/audio/sounds.js');
  const {AudioEngine} = await import('../src/audio/engine.js');
  assert.equal(typeof Sounds, 'function');
  assert.equal(typeof AudioEngine, 'function');
});

// The other tests stub sound with a Proxy that answers to anything, so calling a sound that does not exist
// would pass every test here and then crash the game in the browser.
test('every sound the game calls exists in the real sound vocabulary', async () => {
  const {Sounds} = await import('../src/audio/sounds.js');
  const called = new Set();
  for (const dir of ['game', 'levels']) for (const f of readdirSync(new URL(`../src/${dir}/`, import.meta.url))) {
    const src = readFileSync(new URL(`../src/${dir}/${f}`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/\bsounds\.(\w+)\(/g)) called.add(m[1]);
  }
  assert.ok(called.size > 20, `found ${called.size} sounds`);
  const missing = [...called].filter(k => typeof Sounds.prototype[k] !== 'function');
  assert.deepEqual(missing, []);
});
