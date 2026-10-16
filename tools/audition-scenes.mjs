// Scenes for tools/audition.mjs: short scripted moments played through the game's real sound code
// (engine, bank, reverb, 3D, device speaker) in headless Chrome, rendered offline to arrays.
import {chromium} from 'playwright-core';
import {build} from 'esbuild';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Filter} from '../src/audio/dsp.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Every scene is a list of [time, label, (s, e, at) => {...}] cues, plus `every` for per-frame calls.
 * s is Sounds, e the engine; the listener stands at the origin facing -z (north).
 */
function scenes() {
  const frames = (t0, t1, fn) => ({t0, t1, fn}); // fn(s, e, t, dt) every 1/30 s
  // one sound at a time in silence, 3 s each, to compare loudness between versions
  const LEVELS = [
    ['scanner held, full charge', s => {}], ['trigger', s => s.trigger()], ['overheat', s => s.overheat()], ['sweep', s => s.sweep(2.6)],
    ['step walk', s => s.step('walk')], ['step sprint', s => s.step('sprint')], ['step crouch', s => s.step('crouch')], ['winded', s => s.breathe()],
    ['groan at 8 m', s => s.groan(0, -8, 0)], ['shriek at 6 m', s => s.shriek(0, -6, 0)], ['pain at 4 m', s => s.shriek(0, -4, 0, 0.07)],
    ['clicks at 5 m', s => s.clicks(0, -5, 0, true)], ['short clicks at 5 m', s => s.clicks(0, -5, 0, 'short')],
    ['creature step at 5 m', s => s.creatureStep(0, -5, 0, 1, true)], ['gallop at 5 m', s => s.gallop(0, -5, 0)],
    ['breath at 2 m', s => {}], ['exhale beside you', s => s.exhale(0.8, 0)], ['mimic steps at 8 m', s => s.mimic('steps', 0, -8, 0)],
    ['mimic ping at 8 m', s => s.mimic('ping', 0, -8, 0)], ['sting', s => s.sting()], ['slam at 6 m', s => s.slam(0, -6)],
    ['whisper at 3 m', s => s.whisper(0, -3)], ['door', s => s.doorOpen()], ['core', s => s.core()], ['note', s => s.note()],
    ['battery', s => s.battery()], ['tracker pulse + return', s => { s.trackerPulse(); s.trackerReturn(0.5, 0); }], ['ping', s => s.ping(false, 0.03, 0)],
    ['crackle', s => s.crackle()], ['heart at fear 0.6', s => {}], ['caught', s => s.caught()],
  ];
  return {
    levels: {
      dur: LEVELS.length * 3, quiet: true,
      cues: LEVELS.map(([label, fn], i) => [i * 3 + 0.2, label, fn]),
      every: [
        frames(0.2, 3, (s, e, t, dt) => s.updateHum(true, 1, 0.3, 0)), frames(3, 3.1, s => s.updateHum(false, 0, 0, 0)),
        frames(15 * 3, 16 * 3, s => s.setBreath(0.8, 0, -2, 0)), frames(16 * 3, 16 * 3 + 0.1, s => s.setBreath(0, 0, 0)),
        frames(29 * 3, 30 * 3, (s, e, t, dt) => s.heart(dt, 0.6)),
      ],
    },
    scanner: {
      dur: 30,
      cues: [
        [0.5, 'trigger, spin up, hold 4 s, let go', s => { s.trigger(); }],
        [7, 'three short bursts', s => s.trigger()],
        [7.9, '', s => s.trigger()], [8.8, '', s => s.trigger()],
        [11, 'hold until it overheats', s => s.trigger()],
        [17.5, '', s => s.overheat()],
        [21, 'cooled', s => s.cooled()],
        [22.5, 'the sweep', s => s.sweep(2.6)],
        [25.1, '', s => s.sweepEnd()],
        [27, 'sweep ready, denied', s => s.sweepReady()],
        [28.4, '', s => s.denied()],
      ],
      every: [
        frames(0, 30, (s, e, t, dt, st) => {
          const on = (t > 0.5 && t < 4.5) || (t > 7 && t < 7.5) || (t > 7.9 && t < 8.4) || (t > 8.8 && t < 9.3) || (t > 11 && t < 17.5);
          st.charge = on ? Math.min(1, (st.charge || 0) + dt / 2.4) : Math.max(0, (st.charge || 0) - dt * 3);
          const heat = t > 11 && t < 17.5 ? 0.5 + (t - 11) / 13 : 0.2;
          s.updateHum(on, st.charge, heat, 0);
          if (t > 11 && t < 17.5 && heat > 0.8 && (st.warn = (st.warn ?? 0) - dt) <= 0) { st.warn = 0.7 - (heat - 0.8) * 1.5; s.heatWarn(); }
        }),
      ],
    },
    steps: {
      dur: 22,
      cues: [
        [0.3, 'walking', (s, e, at) => { for (let i = 0; i < 10; i++) at(i * 0.46, () => s.step('walk')); }],
        [6, 'sprinting', (s, e, at) => { for (let i = 0; i < 12; i++) at(i * 0.29, () => s.step('sprint')); }],
        [9.8, 'out of puff', s => s.breathe()],
        [14, 'crouched, creeping', (s, e, at) => { for (let i = 0; i < 8; i++) at(i * 0.65, () => s.step('crouch')); }],
        [20, 'picking up a note', s => s.note()],
      ],
      every: [frames(0, 22, s => s.updateAmbient(0, 0))],
    },
    creature: {
      dur: 48,
      cues: [
        [0.5, 'a groan far off, behind rock', s => s.groan(-14, -10, 0.6)],
        [4, 'it walks past, left to right, behind you', (s, e, at) => {
          for (let i = 0; i < 14; i++) at(i * 0.62, () => s.creatureStep(-8 + i * 1.2, 4 - Math.abs(i - 7) * 0.3, 0, 1, i % 2 === 0));
        }],
        [13.5, 'it stops to listen and clicks: sonar', s => s.clicks(4, -6, 0, true)],
        [17.5, 'it hunts: a dash on all fours, then a quick click', (s, e, at) => {
          for (let i = 0; i < 4; i++) at(i * 0.3, () => s.gallop(6 - i * 1.4, -8 + i * 1.5, 0));
          at(1.3, () => s.clicks(1, -3, 0, 'short'));
        }],
        [20, 'it screams: it has found you', s => s.shriek(2, -6, 0)],
        [22.5, 'in your light: a pained scream', s => s.shriek(1, -4, 0, 0.07)],
        [24.5, 'beside you, breathing', () => {}],
        [32, 'and lets a breath out next to you', s => s.exhale(-0.8, 0.6)],
        [35.5, 'it copies you: your steps, the ping, the chime, the tracker', (s, e, at) => {
          s.mimic('steps', 10, -8, 0.3);
          at(2.5, () => s.mimic('ping', 10, -8, 0.3));
          at(4, () => s.mimic('chime', 10, -8, 0.3));
          at(6, () => s.mimic('trigger', 10, -8, 0.3));
          at(7.5, () => s.mimic('tracker', 10, -8, 0.3));
        }],
      ],
      every: [
        frames(24.5, 32, (s, e, t) => s.setBreath(0.8, 1.2, 0.4, 0)),
        frames(32, 33, s => s.setBreath(0, 0, 0)),
        frames(0, 48, (s, e, t) => { const f = t > 24 && t < 35 ? 0.9 : t > 13 && t < 24 ? 0.6 : 0.1; s.heart(1 / 30, f); s.setDread(f); }),
      ],
    },
    tunnels: {
      dur: 64,
      cues: [
        [0.2, 'room tone; a distant noise every few seconds', s => { s.ambience(1, 0.5); }],
        ...['drip', 'creak', 'knock', 'thud', 'debris', 'buzz', 'wind', 'drip', 'creak', 'knock', 'debris', 'thud', 'creak'].map((k, i) => [3 + i * 4.6, k, s => s.distant(k, Math.random() * 0.6)]),
      ],
      every: [],
    },
    scares: {
      dur: 44,
      cues: [
        [0.5, 'first sight of it: the sting', s => s.sting()],
        [5, 'a door slams', s => s.slam(6, -3)],
        [8.5, 'whispering', s => s.whisper(-3, -2)],
        [12, 'the exit door opens', s => s.doorOpen()],
        [15.5, 'a core', s => s.core()],
        [18, 'a battery', s => s.battery()],
        [19.5, 'the tracker: pulses, a contact closing in', (s, e, at) => {
          for (let i = 0; i < 5; i++) { at(i, () => s.trackerPulse()); at(i + 0.3, () => s.trackerReturn(i / 4, 0.3)); }
          at(5, () => s.trackerFrantic());
        }],
        [26, 'the signal ping, then static', (s, e, at) => {
          s.ping(false, 0.03, 0.4); at(1.5, () => s.ping(false, 0.035, 0.2)); at(3, () => s.ping(true, 0.03, 0));
          for (let i = 0; i < 5; i++) at(4.5 + i * 0.6, () => s.crackle());
        }],
        [34, 'caught', s => s.caught()],
        [36.2, 'after', s => s.aftermath()],
      ],
      every: [frames(0, 44, (s, e, t) => { const f = t > 30 && t < 36 ? 0.9 : 0; s.heart(1 / 30, f); s.setDread(f); })],
    },
  };
}

/** Runs in the page: plays one scene into an OfflineAudioContext and returns its channels as Int16. */
async function play(name, sceneSrc) {
  const SR = 44100, sc = eval('(' + sceneSrc + ')')()[name], ctx = new OfflineAudioContext(2, Math.ceil(SR * sc.dur), SR);
  window.AudioContext = function () { return ctx; };
  const {AudioEngine, Sounds} = window.Audio2;
  const e = new AudioEngine(), s = new Sounds(e);
  e.init(); s.start();
  s.ambience(sc.quiet ? 0 : 0.6, 0.05);
  const marks = [], st = {};
  const cueTimes = [];
  const at0 = t0 => (dt, fn) => cueTimes.push([t0 + dt, fn]);
  for (const [t, label, fn] of sc.cues) { cueTimes.push([t, () => fn(s, e, at0(t))]); if (label) marks.push({t0: t, label}); }
  for (let i = 0; i < marks.length; i++) marks[i].t1 = i + 1 < marks.length ? marks[i + 1].t0 : sc.dur;
  // every 1/30 s: due cues, then per-frame calls
  const step = 1 / 30;
  let frame = 0;
  const tick = async () => {
    const t = frame * step;
    for (let i = 0; i < cueTimes.length; i++) if (cueTimes[i][0] <= t + 1e-6) { const [, fn] = cueTimes.splice(i--, 1)[0]; fn(); }
    for (const f of sc.every) if (t >= f.t0 && t < f.t1) f.fn(s, e, t, step, st);
    frame++;
    const nt = frame * step;
    if (nt < sc.dur - 0.05) ctx.suspend(nt).then(tick);
    ctx.resume();
  };
  ctx.suspend(0).then(tick);
  const buf = await ctx.startRendering();
  const out = [];
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c), i16 = new Int16Array(d.length);
    for (let i = 0; i < d.length; i++) i16[i] = Math.max(-1, Math.min(1, d[i])) * 32767;
    const u8 = new Uint8Array(i16.buffer);
    let str = '';
    for (let i = 0; i < u8.length; i += 0x8000) str += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    out.push(btoa(str));
  }
  return {sr: SR, channels: out, marks};
}

/**
 * Loudness of a stretch of a render: peak, RMS, and RMS above 120 Hz (roughly what a phone or laptop
 * speaker can play, and closer to how loud it sounds than RMS with the sub-bass in it), all in dB.
 */
export function measure(channels, sr, t0, t1) {
  const a = Math.floor(t0 * sr), b = Math.min(channels[0].length, Math.floor(t1 * sr));
  let peak = 0, sum = 0, hsum = 0, n = 0;
  for (const ch of channels) {
    const hp = new Filter(sr, 'hp', 120, 0.7);
    for (let i = a; i < b; i++) {
      const v = ch[i], h = hp.run(v);
      peak = Math.max(peak, Math.abs(v)); sum += v * v; hsum += h * h; n++;
    }
  }
  const db = v => 20 * Math.log10(Math.max(v, 1e-9));
  return {peak: db(peak), rms: db(Math.sqrt(sum / Math.max(1, n))), heard: db(Math.sqrt(hsum / Math.max(1, n)))};
}

/** `from` is the directory whose src/audio is played (the working tree, or an older copy to compare). */
export async function runScenes(exe, names, from = root) {
  const {outputFiles} = await build({
    stdin: {contents: "import {AudioEngine} from './src/audio/engine.js'; import {Sounds} from './src/audio/sounds.js'; window.Audio2 = {AudioEngine, Sounds};", resolveDir: from},
    bundle: true, write: false, format: 'iife',
  });
  const browser = await chromium.launch({executablePath: exe, headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage();
  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.setContent('<html><body></body></html>');
  await page.addScriptTag({content: outputFiles[0].text});
  const all = scenes(), list = names.length ? names : Object.keys(all), results = [];
  for (const name of list) {
    const r = await page.evaluate(([n, src, fn]) => eval('(' + fn + ')')(n, src), [name, scenes.toString(), play.toString()]);
    const channels = r.channels.map(b64 => {
      const bin = Buffer.from(b64, 'base64'), i16 = new Int16Array(bin.buffer, bin.byteOffset, bin.length / 2), f = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32767;
      return f;
    });
    results.push({name, sr: r.sr, channels, marks: r.marks});
  }
  await browser.close();
  if (errors.length) throw new Error('page errors:\n' + errors.join('\n'));
  return results;
}
