// The sound bank's recipes run in plain JS, so they can be checked without a browser: every sound
// renders, stays in range, is not silent, and comes out the same from the same seed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES} from '../src/audio/recipes.js';
import {rand, Filter, Mode, throat, loopify} from '../src/audio/dsp.js';
import {Bank, seedOf} from '../src/audio/bank.js';

const SR = 24000;
const render = (name, i = 0) => {
  const R = RECIPES[name], d = R.make(Math.round(SR * (R.rate || 1)), rand(seedOf(name, i)), i);
  return Array.isArray(d) ? d : [d];
};

test('every sound renders in range, audible, and the same from the same seed', () => {
  for (const name of Object.keys(RECIPES)) {
    const ch = render(name);
    let peak = 0, sum = 0;
    for (const c of ch) for (let i = 0; i < c.length; i++) {
      assert.ok(Number.isFinite(c[i]), `${name}: sample ${i} is ${c[i]}`);
      peak = Math.max(peak, Math.abs(c[i])); sum += c[i] * c[i];
    }
    assert.ok(peak <= 1, `${name}: peak ${peak}`);
    assert.ok(Math.sqrt(sum / ch[0].length) > 1e-3, `${name}: silent`);
    assert.deepEqual(render(name)[0].slice(0, 2000), ch[0].slice(0, 2000), `${name}: not repeatable`);
  }
});

test('variants of a sound differ', () => {
  for (const name of ['stepWalk', 'crClick', 'crGroan', 'drip']) {
    const a = render(name, 0)[0], b = render(name, 1)[0];
    assert.notDeepEqual(a.slice(0, 500), b.slice(0, 500), name);
  }
});

test('loops join without a jump', () => {
  for (const name of ['motor', 'spray', 'bed']) {
    for (const c of render(name)) {
      const jump = Math.abs(c[c.length - 1] - c[0]), typical = c.reduce((s, v, i) => i ? s + Math.abs(v - c[i - 1]) : 0, 0) / c.length;
      assert.ok(jump < typical * 12 + 0.02, `${name}: seam jumps ${jump} (typical step ${typical})`);
    }
  }
  const a = loopify(Float32Array.from({length: 120}, (_, i) => i), 20);
  assert.equal(a.length, 100);
});

test('a filter passes its band and a mode rings at its pitch', () => {
  const sr = 48000, tone = f => Float32Array.from({length: sr / 4}, (_, i) => Math.sin(2 * Math.PI * f * i / sr));
  const rms = a => Math.sqrt(a.slice(a.length / 2).reduce((s, v) => s + v * v, 0) / (a.length / 2));
  const bp = f => new Filter(sr, 'bp', 1000, 4).apply(tone(f));
  assert.ok(rms(bp(1000)) > 0.6 && rms(bp(250)) < 0.1 && rms(bp(4000)) < 0.1);
  const m = new Mode(sr, 440, 0.5), out = new Float32Array(sr / 2);
  for (let i = 0; i < out.length; i++) out[i] = m.run(i === 0 ? 1 : 0);
  let zc = 0;
  for (let i = 1; i < sr / 10; i++) if (out[i - 1] < 0 && out[i] >= 0) zc++;
  assert.ok(Math.abs(zc * 10 - 440) < 15, `rings at ${zc * 10} Hz`);
  assert.ok(Math.abs(out[Math.floor(sr * 0.5) - 100]) < 0.002, 'dies away within its t60');
});

test('a throat holds the pitch it is asked for', () => {
  const sr = 24000, v = throat(sr, rand(1), {dur: 0.5, f0: 100, jitter: 0, shimmer: 0, voice: 1, breath: 0, vowels: 'a'});
  // autocorrelation peak at the 10 ms period
  let best = 0, lag = 0;
  for (let k = 120; k < 480; k++) { let s = 0; for (let i = 2000; i < 10000; i++) s += v[i] * v[i + k]; if (s > best) { best = s; lag = k; } }
  assert.ok(Math.abs(lag - 240) <= 2, `period ${lag} samples`);
});

test('the bank renders on demand, never plays the same variant twice running, and mixes parts', () => {
  const ctx = {sampleRate: SR, createBuffer: (nc, len, sr) => { const ch = Array.from({length: nc}, () => new Float32Array(len)); return {numberOfChannels: nc, length: len, sampleRate: sr, getChannelData: k => ch[k]}; }};
  const b = new Bank(ctx, RECIPES);
  assert.equal(b.all('crClick').length, RECIPES.crClick.n);
  let last = null;
  for (let i = 0; i < 40; i++) { const v = b.get('crClick'); assert.notEqual(v, last); last = v; }
  const one = b.get('drip'), two = b.compose([[one, 0, 1], [one, 0.5, 0.5]]);
  assert.equal(two.length, Math.floor(0.5 * one.sampleRate) + one.length);
  assert.equal(two.getChannelData(0)[10], one.getChannelData(0)[10]);
  assert.equal(b.all('sweep', 2.6), b.all('sweep', 2.6));
  assert.notEqual(b.all('sweep', 2.6), b.all('sweep', 1.5));
  assert.equal(seedOf('drip', 2), seedOf('drip', 2));
  assert.notEqual(seedOf('drip', 2), seedOf('drip', 3));
});
