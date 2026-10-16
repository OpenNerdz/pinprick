// Renders the game's sounds to audio files so they can be listened to away from the game.
//   node tools/audition.mjs dry [names...]   every recipe in the bank, dry, one WAV each, with timings
//   node tools/audition.mjs [chrome] [scenes...]  scenes played through the real engine (reverb, 3D,
//                                             the device speaker) in headless Chrome's OfflineAudioContext
// Output goes to .tmp/audio; with ffmpeg on the path each scene is also written as an MP3.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {RECIPES} from '../src/audio/recipes.js';
import {rand, wav} from '../src/audio/dsp.js';
import {seedOf} from '../src/audio/bank.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.tmp/audio');
mkdirSync(join(out, 'dry'), {recursive: true});
const args = process.argv.slice(2);

const stats = ch => {
  let peak = 0, sum = 0, n = 0;
  for (const a of ch) for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > peak) peak = v; sum += a[i] * a[i]; n++; }
  return {peak, rms: Math.sqrt(sum / Math.max(1, n))};
};
const db = v => (20 * Math.log10(Math.max(v, 1e-9))).toFixed(1);

if (args[0] === 'dry') {
  const names = args.length > 1 ? args.slice(1) : Object.keys(RECIPES);
  const SR = 48000;
  let total = 0;
  for (const name of names) {
    const R = RECIPES[name], sr = Math.round(SR * (R.rate || 1)), t0 = performance.now(), parts = [];
    for (let i = 0; i < (R.n || 1); i++) {
      const d = R.make(sr, rand(seedOf(name, i)), i), ch = Array.isArray(d) ? d : [d];
      for (const c of ch) for (let j = 0; j < c.length; j++) if (!Number.isFinite(c[j])) throw new Error(`${name}: not a number at ${j}`);
      parts.push(ch);
    }
    const ms = performance.now() - t0;
    total += ms;
    // all variants back to back with a little silence between
    const gap = Math.floor(sr * 0.35), nc = parts[0].length, len = parts.reduce((s, p) => s + p[0].length + gap, 0);
    const joined = Array.from({length: nc}, () => new Float32Array(len));
    let o = 0;
    for (const p of parts) { p.forEach((c, k) => joined[k].set(c, o)); o += p[0].length + gap; }
    writeFileSync(join(out, 'dry', name + '.wav'), wav(joined, sr));
    const s = stats(parts.flat());
    console.log(`${name.padEnd(14)} ${String(R.n || 1).padStart(2)} x ${(parts[0][0].length / sr).toFixed(2)} s  ${ms.toFixed(1).padStart(6)} ms  peak ${db(s.peak)} dB  rms ${db(s.rms)} dB`);
  }
  console.log(`rendered in ${total.toFixed(0)} ms`);
} else {
  const {runScenes, measure} = await import('./audition-scenes.mjs');
  const exe = args[0] && args[0].startsWith('/') ? args.shift() : '/usr/bin/google-chrome';
  const results = await runScenes(exe, args);
  let ff = true;
  try { execFileSync('ffmpeg', ['-version'], {stdio: 'ignore'}); } catch { ff = false; }
  for (const {name, sr, channels, marks} of results) {
    const file = join(out, name + '.wav');
    writeFileSync(file, wav(channels, sr));
    if (ff) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-b:a', '192k', join(out, name + '.mp3')]);
    const s = stats(channels);
    console.log(`${name}: ${(channels[0].length / sr).toFixed(1)} s  peak ${db(s.peak)} dB  rms ${db(s.rms)} dB`);
    for (const m of marks) {
      const w = measure(channels, sr, m.t0, m.t1), f = v => v.toFixed(1).padStart(6);
      console.log(`  ${m.t0.toFixed(1).padStart(5)} s  ${m.label.slice(0, 40).padEnd(40)} peak ${f(w.peak)}  rms ${f(w.rms)}  heard ${f(w.heard)}`);
    }
  }
}
