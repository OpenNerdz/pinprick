// How every recorded sound in the game is made. The bank renders each recipe once per variant, with
// its own seed, so a footstep or a click never repeats exactly. Recipes return a Float32Array (mono)
// or [left, right]. `rate` renders at a fraction of the sample rate (for sounds with no top end),
// `n` is the number of variants, and `loop` marks a seamless loop.
//
// The models, roughly: struck things ring as a handful of decaying modes (a boot on concrete, a steel
// door, a pipe, a pebble); dragged things are stick-slip pulses through the same; the creature's voice
// is a throat (glottal pulses with jitter, period doubling and breath, through moving formants); the
// scanner is a motor turning a mirror over a fizz of dots landing.

import {Filter, Mode, Body, strike, burst, grit, mix, friction, throat, norm, edges, loopify, dcBlock, chain, TAU} from './dsp.js';

const buf = (sr, s) => new Float32Array(Math.floor(sr * s));
const done = (a, sr, outMs = 30) => edges(norm(dcBlock(a, sr, 30)), sr, 0.5, outMs);

// ---------------------------------------------------------------- the scanner

/**
 * The motor: 20 turns a second at full speed, so a 1 s loop of whole-hertz partials is seamless. Its
 * harmonics drift in and out a little, and the stator sings two notes that are not in the series.
 */
function motor(sr, r) {
  const n = sr, fade = Math.floor(sr * 0.06), a = new Float32Array(n), air = new Float32Array(n + fade);
  const parts = [[240, 1], [480, 0.34], [720, 0.16], [960, 0.08], [1440, 0.05], [1680, 0.035], [1913, 0.025], [3187, 0.012], [3360, 0.02]];
  const ph = parts.map(() => r() * TAU), drift = parts.map(() => [r.int(1, 4), r() * TAU, r.range(0.1, 0.3)]);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let y = 0;
    for (let k = 0; k < parts.length; k++) y += parts[k][1] * Math.sin(TAU * parts[k][0] * t + ph[k]) * (1 + drift[k][2] * Math.sin(TAU * drift[k][0] * t + drift[k][1]));
    a[i] = y * (1 + 0.1 * Math.sin(TAU * 20 * t)) * 0.5; // the mirror is not quite balanced: a wobble each turn
  }
  // the air it beats, a soft whoosh each turn
  const f1 = new Filter(sr, 'bp', 1800, 1.1), f2 = new Filter(sr, 'hp', 800, 0.7);
  for (let i = 0; i < n + fade; i++) air[i] = f2.run(f1.run(r.white())) * (0.45 + 0.55 * Math.max(0, Math.sin(TAU * 20 * i / sr + 1)) ** 2);
  mix(a, loopify(air, fade), 0, 0.7);
  return norm(a, 0.9);
}

/** The dots landing: a fine dry fizz of grains, like sand thrown on a sheet, over a breath of hiss. */
function spray(sr, r) {
  const n = Math.floor(sr * 1.5), fade = Math.floor(sr * 0.08), a = new Float32Array(n + fade);
  for (let t = 0; ;) {
    t += -Math.log(1 - r()) * sr / 1700;
    const i = Math.floor(t);
    if (i >= a.length - 40) break;
    const g = 0.15 + 0.85 * r() ** 3, w = 1 + r() * 4;
    for (let j = 0; j < w * 6; j++) a[i + j] += r.white() * g * Math.exp(-j / w);
  }
  for (let i = 0; i < a.length; i++) a[i] += r.white() * 0.05;
  chain(a, new Filter(sr, 'hp', 1100, 0.7), new Filter(sr, 'peak', 3200, 0.9, 4), new Filter(sr, 'lp', 8500, 0.7));
  return norm(loopify(a, fade), 0.9);
}

/** The trigger's switch: a hard plastic clack, and a softer one as the contact settles. */
function trigger(sr, r) {
  const a = buf(sr, 0.09);
  const body = () => new Body(sr, [[r.range(2900, 3400), 0.012, 1], [r.range(4800, 5600), 0.008, 0.6], [r.range(1150, 1400), 0.02, 0.45], [r.range(170, 210), 0.035, 0.7]]);
  strike(a, sr, r, body(), 0, 1, 0.6, 0.09);
  strike(a, sr, r, body(), Math.floor(r.range(0.016, 0.026) * sr), 0.35, 0.4, 0.06);
  return done(a, sr, 10);
}

/** Cutting out hot: a relay clunks, the vent spits and hisses, the casing ticks as it cools. */
function overheat(sr, r) {
  const a = buf(sr, 2.8);
  strike(a, sr, r, new Body(sr, [[r.range(130, 160), 0.09, 1], [r.range(380, 440), 0.05, 0.5], [r.range(1100, 1300), 0.02, 0.4], [3100, 0.008, 0.3]]), 0, 1, 1, 0.3);
  const hp = new Filter(sr, 'hp', 2200, 0.7), lp = new Filter(sr, 'lp', 9000, 0.7), pk = new Filter(sr, 'peak', 4300, 1.5, 5);
  let gate = 1, gt = 0;
  for (let i = Math.floor(0.03 * sr); i < a.length; i++) {
    const t = i / sr - 0.03;
    if (t < 0.45) { if (--gt <= 0) { gate = 0.3 + 0.7 * r(); gt = r.range(0.015, 0.05) * sr; } } else gate += (1 - gate) * 0.001;
    a[i] += pk.run(lp.run(hp.run(r.white()))) * Math.min(1, t / 0.02) * Math.exp(-t / 0.7) * gate * 0.5;
  }
  for (let k = 0; k < 9; k++) {
    strike(a, sr, r, new Body(sr, [[r.range(3800, 6500), 0.006, 1], [r.range(1500, 2200), 0.01, 0.3]]), Math.floor(r.range(0.6, 2.7) * sr), r.range(0.05, 0.14), 0.2, 0.05);
  }
  return done(a, sr, 60);
}

/**
 * The sweep: a capacitor whines up, the shot thumps through the casing, then the mirror steps down the
 * view row by row (a stepper motor's buzz, falling as it goes, ratcheting each row) over a downpour of dots.
 */
function sweep(sr, r, i, dur = 2.6) {
  const a = buf(sr, dur + 0.4);
  let ph = 0;
  for (let j = 0; j < 0.2 * sr; j++) {
    const t = j / sr;
    ph += TAU * 1400 * Math.pow(5.5, t / 0.2) / sr;
    a[j] += Math.sin(ph) * 0.1 * Math.min(1, t / 0.05) * (1 - t / 0.2);
  }
  const t0 = Math.floor(0.19 * sr);
  strike(a, sr, r, new Body(sr, [[58, 0.4, 1], [121, 0.22, 0.5], [262, 0.1, 0.3], [740, 0.04, 0.2]]), t0, 1, 2, 0.7);
  burst(a, sr, r, 0.19, 0.5, 0.0005, 0.006, [new Filter(sr, 'hp', 1200, 0.7)]);
  const hous = new Body(sr, [[820, 0.012, 1], [2300, 0.006, 0.5], [4100, 0.004, 0.3]]);
  const hp = new Filter(sr, 'hp', 1500, 0.7), lp = new Filter(sr, 'lp', 7500, 0.7);
  let next = 0.22 * sr;
  for (let j = Math.floor(0.22 * sr); j < a.length; j++) {
    const t = j / sr, p = Math.min(1, (t - 0.22) / (dur - 0.22));
    const env = Math.min(1, (t - 0.22) / 0.05) * (t < dur ? 1 : Math.exp(-(t - dur) / 0.08));
    const row = 0.55 + 0.45 * Math.sqrt(Math.abs(Math.sin(Math.PI * 11.5 * t)));
    let x = 0;
    if (j >= next) { x = 1; next = j + sr / (190 - 70 * p); }
    a[j] += hous.run(x * env * row) * 0.3;
    const g = r() < 4500 / sr ? r.white() * (0.3 + r()) * 2 : 0;
    a[j] += lp.run(hp.run(g + r.white() * 0.08)) * env * row * 0.55;
  }
  return done(a, sr, 30);
}

/** The mirror swinging back to the top and parking: a quick whirr, then a clunk. */
function sweepEnd(sr, r) {
  const a = buf(sr, 0.5);
  let ph = 0;
  for (let j = 0; j < 0.14 * sr; j++) {
    const t = j / sr;
    ph += TAU * (300 + 900 * t / 0.14) / sr;
    a[j] += (Math.sin(ph) + 0.4 * Math.sin(ph * 3)) * 0.12 * Math.sin(Math.PI * t / 0.14);
  }
  strike(a, sr, r, new Body(sr, [[118, 0.12, 1], [265, 0.07, 0.5], [610, 0.04, 0.35], [1900, 0.012, 0.25]]), Math.floor(0.14 * sr), 1, 1, 0.35);
  return done(a, sr, 20);
}

// ---------------------------------------------------------------- you

/** A boot on gritty concrete: heel, grit crunching, the toe rolling down, now and then a buckle. */
function footstep(kind) {
  return (sr, r) => {
    const sprint = kind === 'sprint', crouch = kind === 'crouch', a = buf(sr, 0.34);
    const heel = crouch ? 0.3 : sprint ? 1 : 0.75;
    burst(a, sr, r, 0, heel, 0.0008, crouch ? 0.006 : 0.004, [new Filter(sr, 'lp', crouch ? 900 : 1500, 0.7), new Filter(sr, 'peak', r.range(500, 750), 1.2, 6)]);
    strike(a, sr, r, new Body(sr, [[r.range(85, 115), 0.06, 1], [r.range(220, 300), 0.035, 0.5]]), 0, heel * 0.5, 2, 0.15);
    grit(a, sr, r, 0.004, crouch ? 0.16 : 0.08, crouch ? 6 : sprint ? 16 : 10, crouch ? 0.05 : 0.12, 2500);
    const toe = sprint ? r.range(0.03, 0.045) : crouch ? r.range(0.1, 0.14) : r.range(0.06, 0.085);
    burst(a, sr, r, toe, crouch ? 0.2 : 0.35, 0.001, crouch ? 0.012 : 0.008, [new Filter(sr, 'bp', r.range(1300, 2300), 1)]);
    if (crouch) burst(a, sr, r, 0.03, 0.12, 0.04, 0.05, [new Filter(sr, 'bp', r.range(2500, 4000), 0.8)]);
    if (!crouch && r() < 0.55) {
      for (let k = r.int(1, 2); k > 0; k--) {
        strike(a, sr, r, new Body(sr, [[r.range(4200, 6800), r.range(0.006, 0.014), 1], [r.range(2400, 3200), 0.008, 0.4]]), Math.floor(r.range(0.012, 0.05) * sr), sprint ? 0.12 : 0.07, 0.2, 0.05);
      }
    }
    return done(a, sr, 30);
  };
}

/** Your breath, out of puff or scared: in sharply through the mouth, out with a little voice in it. */
const pantIn = (sr, r) => edges(throat(sr, r, {dur: r.range(0.26, 0.34), f0: 140, voice: 0, breath: 1, puff: 0, vowels: 'ha', scale: 1.15, bw: 2.2, env: p => Math.min(1, p / 0.12) * Math.pow(1 - p, 1.5)}), sr, 2, 20);
function pantOut(sr, r) {
  const f = r.range(105, 125);
  return edges(throat(sr, r, {dur: r.range(0.38, 0.5), f0: p => f * (1 - 0.15 * p), jitter: 0.03, shimmer: 0.1, voice: p => 0.1 * (1 - p), breath: 1, puff: 0.3, vowels: 'ao', scale: 1.05, bw: 2, env: p => Math.min(1, p / 0.08) * Math.pow(1 - p, 1.2)}), sr, 2, 20);
}
/** A scared breath in: it shakes. */
function fearIn(sr, r) {
  const dur = r.range(0.5, 0.7), shake = r.range(6, 8.5);
  return edges(throat(sr, r, {dur, f0: 140, voice: 0, breath: 1, puff: 0, vowels: 'hu', scale: 1.1, bw: 2.4, env: p => Math.min(1, p / 0.3) * Math.pow(1 - p, 0.8) * (0.65 + 0.35 * Math.sin(TAU * shake * p * dur))}), sr, 2, 30);
}

/** Your heart, from inside your own chest: lub (low, long) and dub (shorter, higher). */
function heart(low) {
  return (sr, r) => {
    const a = buf(sr, 0.32), push = Math.floor(0.025 * sr);
    const f = low ? r.range(44, 50) : r.range(58, 66);
    const b = new Body(sr, [[f, low ? 0.16 : 0.1, 1], [f * 2, low ? 0.09 : 0.06, 0.55], [f * 3.4, 0.05, 0.35]]);
    for (let j = 0; j < a.length; j++) a[j] = b.run(j < push ? Math.sin(Math.PI * j / push) * 0.05 : 0);
    burst(a, sr, r, 0, 0.25, 0.006, 0.02, [new Filter(sr, 'lp', 220, 0.7)]);
    return done(a, sr, 40);
  };
}

/** The core comes free of its clamp: a magnetic clunk, then its charge humming up as it seats. */
function core(sr, r) {
  const a = buf(sr, 1.3);
  strike(a, sr, r, new Body(sr, [[180, 0.12, 1], [520, 0.05, 0.5], [1500, 0.02, 0.3]]), 0, 1, 1, 0.4);
  let ph = 0, ph2 = 0;
  for (let j = Math.floor(0.05 * sr); j < a.length; j++) {
    const t = j / sr - 0.05, p = t / 1.2, f = 110 * Math.pow(2, p);
    ph += TAU * f / sr; ph2 += TAU * f * 8 / sr;
    const e = Math.sin(Math.PI * Math.min(1, p)) ** 1.5;
    a[j] += (Math.sin(ph) + 0.5 * Math.sin(ph * 2) + 0.3 * Math.sin(ph * 3)) * 0.18 * e + Math.sin(ph2) * 0.03 * e;
  }
  return done(a, sr, 40);
}

/** A sheet of paper picked up: crackles bunched into a few crumples, and the swish of it moving. */
function paper(sr, r) {
  const a = buf(sr, 0.6);
  for (let k = r.int(3, 5); k > 0; k--) { const t = r.range(0, 0.45); grit(a, sr, r, t, t + r.range(0.04, 0.1), r.int(20, 50), r.range(0.3, 0.8), 1800); }
  burst(a, sr, r, 0.02, 0.12, 0.06, 0.08, [new Filter(sr, 'bp', 3000, 0.6)]);
  chain(a, new Filter(sr, 'peak', 4500, 1, 4), new Filter(sr, 'lp', 10000, 0.7));
  return done(a, sr, 30);
}

/** A battery cell snapped home: two plastic clacks, and the charge whining up. */
function battery(sr, r) {
  const a = buf(sr, 0.7);
  const clack = () => new Body(sr, [[r.range(1700, 2100), 0.015, 1], [r.range(3200, 3800), 0.01, 0.6], [r.range(420, 480), 0.02, 0.5]]);
  strike(a, sr, r, clack(), 0, 1, 0.5, 0.08);
  strike(a, sr, r, clack(), Math.floor(0.085 * sr), 0.75, 0.5, 0.08);
  let ph = 0;
  for (let j = Math.floor(0.12 * sr); j < Math.floor(0.55 * sr); j++) {
    const p = (j / sr - 0.12) / 0.43;
    ph += TAU * 300 * Math.pow(1400 / 300, p) / sr;
    a[j] += Math.sin(ph) * 0.12 * Math.sin(Math.PI * p);
  }
  return done(a, sr, 30);
}

/** Static in the signal: a hiss that swells and spits. */
function crackle(sr, r) {
  const dur = r.range(0.18, 0.35), a = buf(sr, dur), f = new Filter(sr, 'bp', r.range(1800, 3200), 0.6);
  let g = 0, gt = 0;
  for (let j = 0; j < a.length; j++) {
    if (--gt <= 0) { g = r() < 0.6 ? r.range(0.1, 1) : 0; gt = r.range(0.008, 0.04) * sr; }
    a[j] = f.run(r.white()) * g * 0.4 + (r() < 0.004 ? r.white() * 1.5 : 0);
  }
  return done(a, sr, 15);
}

/** Steel slamming home: the crack of the hit, the plate ringing, the door rattling in its frame. */
function slam(sr, r) {
  const a = buf(sr, 2.0), base = r.range(78, 95);
  const plate = [1, 1.62, 2.33, 3.1, 4.43, 5.9, 7.7, 10.4, 13.6].map((k, q) => [base * k * (1 + r.gauss() * 0.01), r.range(0.5, 1.4) / (1 + q * 0.15), 1 / (1 + q * 0.5)]);
  strike(a, sr, r, new Body(sr, plate), 0, 1, 4, 2.0);
  burst(a, sr, r, 0, 1.2, 0.0003, 0.012, [new Filter(sr, 'lp', 5000, 0.7)]);
  strike(a, sr, r, new Body(sr, [[48, 0.35, 1], [96, 0.2, 0.4]]), 0, 1.5, 6, 0.8);
  for (let k = 0; k < 4; k++) {
    strike(a, sr, r, new Body(sr, plate.slice(2, 6).map(([f, t, am]) => [f * 1.1, t * 0.3, am])), Math.floor((0.07 + k * 0.045 + r() * 0.02) * sr), 0.3 / (k + 1), 2, 0.5);
  }
  return done(a, sr, 80);
}

/** A heavy door opening: the locks let go, the hydraulics hiss, a motor hauls it along its track. */
function door(sr, r) {
  const dur = 2.5, a = buf(sr, dur);
  const lock = () => new Body(sr, [[r.range(150, 180), 0.1, 1], [r.range(420, 470), 0.06, 0.5], [r.range(1250, 1450), 0.03, 0.3], [2900, 0.01, 0.2]]);
  strike(a, sr, r, lock(), 0, 1, 1, 0.4);
  strike(a, sr, r, lock(), Math.floor(0.16 * sr), 0.8, 1, 0.4);
  burst(a, sr, r, 0.22, 0.3, 0.05, 0.25, [new Filter(sr, 'hp', 1500, 0.7), new Filter(sr, 'lp', 7000, 0.7)]);
  const grind = friction(sr, r, {dur: 1.7, rate: p => 40 + 30 * p, slip: 0.003, jitter: 0.5, hiss: 0.2});
  chain(grind, new Filter(sr, 'bp', 900, 0.7), new Filter(sr, 'peak', 1700, 2, 6));
  const body = new Filter(sr, 'bp', 380, 1.5);
  let ph = 0;
  for (let j = 0; j < grind.length; j++) {
    const p = j / grind.length, e = Math.min(1, p / 0.1) * Math.min(1, (1 - p) / 0.15);
    ph += TAU * (70 + 40 * p) / sr;
    const m = Math.sin(ph) + 0.6 * Math.sin(ph * 2) + 0.4 * Math.sin(ph * 3) + 0.25 * Math.sin(ph * 5);
    grind[j] = (grind[j] * 0.35 + body.run(m) * 0.5) * e;
  }
  mix(a, grind, Math.floor(0.35 * sr));
  strike(a, sr, r, lock(), Math.floor(2.08 * sr), 0.9, 2, 0.4);
  return done(a, sr, 60);
}

// ---------------------------------------------------------------- the creature

/** Its tongue snapping off the roof of its mouth, into the hollow behind; spit crackling after. */
function crClick(sr, r) {
  const a = buf(sr, 0.07);
  strike(a, sr, r, new Body(sr, [[r.range(2300, 3600), 0.006, 0.6], [r.range(650, 1100), r.range(0.02, 0.035), 1], [r.range(230, 330), 0.03, 0.35]]), 0, 1, 0.5, 0.07);
  for (let k = r() < 0.75 ? r.int(1, 3) : 0; k > 0; k--) burst(a, sr, r, r.range(0.004, 0.02), r.range(0.08, 0.2), 0.0002, 0.0006, [new Filter(sr, 'hp', 2800, 0.7)]);
  return done(a, sr, 8);
}

/** Its throat creaking: slow, uneven pulses, like a door on a dry hinge. */
function crCroak(sr, r) {
  const f = r.range(26, 40);
  return done(throat(sr, r, {dur: r.range(0.35, 0.7), f0: p => f * (1 + 0.3 * Math.sin(Math.PI * p)), jitter: 0.22, shimmer: 0.35, oq: 0.28, voice: 1, breath: 0.15, vowels: r() < 0.5 ? 'oa' : 'ao', scale: 0.72, drive: 1.5, env: p => Math.min(1, p / 0.15) * Math.min(1, (1 - p) / 0.3)}), sr, 30);
}

/** A low wet groan, its voice breaking into a creak as it runs out of breath. */
function crGroan(sr, r) {
  const dur = r.range(1.9, 2.8), f = r.range(58, 78), a = buf(sr, dur);
  mix(a, throat(sr, r, {dur: dur * 0.85, f0: p => f * (1 + 0.22 * Math.sin(Math.PI * Math.min(1, p * 1.3))) * (1 - 0.12 * p), jitter: 0.035, shimmer: 0.12, sub: p => 0.1 + 0.6 * Math.max(0, p - 0.5), voice: 1, breath: 0.35, vowels: r.pick(['uoa', 'oau', 'ouo']), scale: 0.78, drive: 1.6, env: p => Math.min(1, p / 0.18) * Math.min(1, (1 - p) / 0.35)}));
  mix(a, throat(sr, r, {dur: dur * 0.4, f0: p => 34 - 10 * p, jitter: 0.25, shimmer: 0.4, oq: 0.25, voice: 1, breath: 0.2, vowels: 'oa', scale: 0.74, drive: 1.5, env: p => Math.min(1, p / 0.3) * (1 - p)}), Math.floor(dur * 0.6 * sr), 0.55);
  return done(a, sr, 40);
}

/** Its scream: two throats at once a ragged interval apart, rough and broken, over a roar. */
function scream(short) {
  return (sr, r) => {
    const dur = short ? r.range(0.6, 0.8) : r.range(1.35, 1.6), n = Math.floor(dur * sr), a = new Float32Array(n);
    const pk = r.range(560, 680) * (short ? 0.85 : 1), lo = r.range(180, 220), fr = r.range(58, 70), rough = r.range(65, 85);
    const contour = p => (p < 0.3 ? lo + (pk - lo) * Math.sin(p / 0.3 * Math.PI / 2) : pk - (pk - lo * 1.5) * (p - 0.3) / 0.7);
    const env = p => Math.min(1, p / 0.06) * Math.min(1, (1 - p) / 0.4);
    mix(a, throat(sr, r, {dur, f0: contour, jitter: 0.04, shimmer: 0.2, sub: 0.45, voice: 1, breath: short ? 0.9 : 0.6, vowels: 'aiea', scale: 1.12, drive: 4, env}));
    mix(a, throat(sr, r, {dur, f0: p => contour(p) * 1.41, jitter: 0.05, shimmer: 0.25, sub: 0.3, voice: 1, breath: 0.4, vowels: 'aei', scale: 1.2, drive: 4, env}), 0, 0.45);
    mix(a, throat(sr, r, {dur, f0: p => fr * (1 + 0.2 * Math.sin(Math.PI * p)), jitter: 0.08, shimmer: 0.3, sub: 0.5, voice: 1, breath: 0.5, vowels: 'oau', scale: 0.7, drive: 3, env}), 0, short ? 0.5 : 0.8);
    for (let j = 0; j < n; j++) a[j] *= 1 - 0.35 * (0.5 + 0.5 * Math.sin(TAU * rough * j / sr)); // it shudders: roughness
    return done(a, sr, 40);
  };
}

/** Breathing through a wet, narrow throat: in with a wheeze, out lower with the rattle louder. */
function crBreath(kind) {
  return (sr, r) => {
    const out = kind !== 'in', long = kind === 'exhale';
    const dur = long ? r.range(1.6, 2.1) : out ? r.range(0.9, 1.3) : r.range(0.65, 0.9), f = r.range(20, 32);
    const a = throat(sr, r, {
      dur, f0: p => f * (1 - (out ? 0.3 : 0) * p), jitter: 0.3, shimmer: 0.45, oq: 0.35,
      voice: out ? p => (long ? 0.6 : 0.45) * Math.sin(Math.PI * p) : 0.2, breath: 1, puff: out ? 2 : 1.5,
      vowels: out ? 'oa' : 'uh', scale: out ? 0.72 : 0.8, bw: out ? 1.4 : 0.8,
      env: out ? p => Math.min(1, p / 0.12) * Math.pow(1 - p, 1.3) : p => Math.pow(Math.min(1, p / 0.55), 1.5) * Math.min(1, (1 - p) / 0.3),
    });
    if (out) grit(a, sr, r, 0.1, dur * 0.8, r.int(4, 10), 0.1, 2500); // spit crackling in its mouth
    if (long) strike(a, sr, r, new Body(sr, [[r.range(700, 1000), 0.025, 1], [r.range(2400, 3200), 0.006, 0.5]]), Math.floor(dur * 0.92 * sr), 0.25, 0.4, 0.05); // its jaw
    return done(a, sr, 40);
  };
}

/** A heavy bare foot: the thud of its weight, skin slapping concrete, claws touching down after. */
function crStep(light) {
  return (sr, r) => {
    const a = buf(sr, light ? 0.22 : 0.4), k = light ? 0.6 : 1;
    strike(a, sr, r, new Body(sr, [[r.range(58, 72) / k, 0.13 * k, 1], [r.range(120, 150) / k, 0.07, 0.5], [r.range(260, 320), 0.04, 0.25]]), 0, 1, 6, 0.35);
    burst(a, sr, r, 0.002, 0.45, 0.002, 0.012 * k, [new Filter(sr, 'lp', 600, 0.7)]);
    burst(a, sr, r, 0.004, 0.3, 0.0008, 0.005, [new Filter(sr, 'bp', r.range(900, 1500), 1.2)]);
    for (let c = r.int(light ? 1 : 2, light ? 2 : 3); c > 0; c--) {
      strike(a, sr, r, new Body(sr, [[r.range(3000, 5200), r.range(0.004, 0.009), 1], [r.range(1600, 2200), 0.006, 0.3]]), Math.floor(r.range(0.008, 0.045) * sr), r.range(0.12, 0.25) / k, 0.15, 0.04);
    }
    grit(a, sr, r, 0.02, light ? 0.1 : 0.14, r.int(4, 9), 0.06, 1800);
    return done(a, sr, 30);
  };
}

/** A foot dragged across the floor, its claws scraping and squealing on the concrete. */
function crDrag(sr, r) {
  const dur = r.range(0.45, 0.65), a = friction(sr, r, {dur, rate: p => 35 + 40 * Math.sin(Math.PI * p), slip: 0.003, jitter: 0.5, hiss: 0.25});
  const b1 = new Filter(sr, 'bp', r.range(700, 1100), 0.9), b2 = new Filter(sr, 'bp', r.range(1900, 2600), 1.2), sq = new Mode(sr, r.range(3400, 4200), 0.03, 0.5);
  for (let j = 0; j < a.length; j++) {
    const p = j / a.length, x = a[j];
    a[j] = (b1.run(x) + b2.run(x) * 0.5 + sq.run(x) * 0.25) * Math.min(1, p / 0.2) * Math.min(1, (1 - p) / 0.3);
  }
  return done(a, sr, 30);
}

/** A tone whistled through its throat: it wavers, and breath hisses round it. */
function whistle(a, sr, r, t0, f0, f1, dur, amp) {
  const n = Math.floor(dur * sr), i0 = Math.floor(t0 * sr), bp = new Filter(sr, 'bp', f0, 6), vib = r.range(4.5, 6.5);
  let ph = 0, wander = 0;
  for (let j = 0; j < n && i0 + j < a.length; j++) {
    const p = j / n, t = j / sr;
    wander += (r.white() * 0.02 - wander) * 0.002;
    const f = (f0 + (f1 - f0) * p) * (1 + 0.012 * Math.sin(TAU * vib * t) + wander);
    ph += TAU * f / sr;
    if ((j & 63) === 0) bp.set('bp', f, 6);
    const e = Math.min(1, t / 0.03) * Math.pow(1 - p, 1.4);
    a[i0 + j] += (Math.sin(ph) + bp.run(r.white()) * 0.6) * e * amp;
  }
}

/** It copies your sounds with its throat, slightly wrong: the tracker's tick, a ping, the core chime, the trigger. */
function mimic(kind) {
  return (sr, r) => {
    if (kind === 'trigger') {
      const a = buf(sr, 0.5);
      for (const t of [0, 0.23]) strike(a, sr, r, new Body(sr, [[r.range(1800, 2400), 0.008, 0.6], [r.range(500, 700), 0.03, 1], [220, 0.03, 0.4]]), Math.floor(t * sr), 1, 0.6, 0.1);
      mix(a, throat(sr, r, {dur: 0.2, f0: 30, jitter: 0.25, shimmer: 0.4, oq: 0.3, voice: 1, breath: 0.2, vowels: 'oa', scale: 0.72}), Math.floor(0.3 * sr), 0.4);
      return done(a, sr, 30);
    }
    if (kind === 'ping') { const a = buf(sr, 0.8); whistle(a, sr, r, 0, 958, 900, 0.6, 1); whistle(a, sr, r, 0, 1877, 1700, 0.4, 0.2); return done(a, sr, 40); }
    if (kind === 'chime') { const a = buf(sr, 1.6); [1046.5, 783.99, 659.25, 523.25].forEach((f, j) => whistle(a, sr, r, j * 0.16, f * 0.94, f * 0.9, 0.9, 0.6)); return done(a, sr, 60); }
    const a = buf(sr, 2.4); // the tracker
    for (let j = 0; j < 3; j++) whistle(a, sr, r, j * 1.02, 1104, 930, 0.16, 1);
    return done(a, sr, 30);
  };
}

// ---------------------------------------------------------------- scares

/** A bowed sheet of metal sliding as it rings (the waterphone of a horror score), over a deep boom. */
function sting(sr, r) {
  const dur = 3.2, n = Math.floor(dur * sr), a = new Float32Array(n), hit = new Float32Array(n);
  const base = r.range(520, 640), ratios = [1, 1.004, 1.47, 2.09, 2.095, 2.56, 3.23, 4.17, 5.43, 6.9];
  const modes = ratios.map((k, q) => new Mode(sr, base * k * (1 + r.gauss() * 0.003), r.range(1.2, 2.6), 1 / (1 + q * 0.4)));
  const fs = modes.map((m, q) => base * ratios[q]);
  for (let j = 0; j < n; j++) {
    const t = j / sr;
    if ((j & 63) === 0) {
      const glide = 1 - 0.035 * t / dur + 0.006 * Math.sin(TAU * 0.9 * t);
      modes.forEach((m, q) => m.tune(fs[q] * glide));
    }
    const bow = Math.min(1, t / 0.04) * (t < 0.9 ? 1 : Math.exp(-(t - 0.9) / 0.25));
    const x = r.white() * bow * (1 + 0.3 * r.white()) * 0.02;
    let y = 0;
    for (const m of modes) y += m.run(x);
    a[j] = y;
  }
  norm(a, 1);
  strike(hit, sr, r, new Body(sr, [[42, 1.0, 1], [84, 0.6, 0.5], [127, 0.35, 0.3], [260, 0.15, 0.2]]), 0, 1, 3, 1.5);
  burst(hit, sr, r, 0, 0.6, 0.0005, 0.02, [new Filter(sr, 'hp', 1500, 0.7)]);
  mix(a, norm(hit, 1), 0, 0.8);
  return done(a, sr, 200);
}

/** Whispering: noise shaped into vowels and hissed consonants, words that are almost words. */
function whisper(sr, r) {
  const dur = r.range(1.4, 1.9), a = buf(sr, dur), segs = [];
  let t = r.range(0.02, 0.08), prev = 'a';
  while (t < dur - 0.2) {
    if (r() < 0.6) { const c = r.pick(['s', 'sh', 'f', 't', 'k', 'h', 's']), d = c === 't' || c === 'k' ? 0.025 : r.range(0.06, 0.14); segs.push({c, t, d}); t += d * 0.8; }
    const v = r.pick(['a', 'e', 'i', 'o', 'u']), d = r.range(0.09, 0.2);
    segs.push({v, from: prev, t, d}); prev = v; t += d * 0.85;
    if (r() < 0.25) t += r.range(0.05, 0.18);
  }
  const F = {u: [300, 870, 2240], o: [450, 800, 2830], a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010]};
  for (const s of segs) {
    const n = Math.floor(s.d * sr), i0 = Math.floor(s.t * sr), seg = new Float32Array(n);
    if (s.v) {
      const fl = [0, 1, 2].map(q => new Filter(sr, 'bp', F[s.from][q], 6));
      for (let j = 0; j < n; j++) {
        const p = j / n;
        if ((j & 31) === 0) { const k = Math.min(1, p / 0.35); fl.forEach((f, q) => f.set('bp', F[s.from][q] + (F[s.v][q] - F[s.from][q]) * k, 6 - q)); }
        const x = r.white();
        seg[j] = (fl[0].run(x) + fl[1].run(x) * 0.7 + fl[2].run(x) * 0.4) * Math.pow(Math.sin(Math.PI * p), 0.7);
      }
    } else {
      const f = {s: ['bp', 6200, 2.5], sh: ['bp', 3000, 1.6], f: ['hp', 1800, 0.7], h: ['bp', 1400, 0.6], t: ['bp', 4200, 1], k: ['bp', 2000, 1]}[s.c];
      const fl = new Filter(sr, f[0], f[1], f[2]), amp = s.c === 'f' ? 0.25 : s.c === 'h' ? 0.4 : 0.55;
      for (let j = 0; j < n; j++) { const p = j / n; seg[j] = fl.run(r.white()) * amp * (s.c === 't' || s.c === 'k' ? Math.exp(-p * 6) : Math.sin(Math.PI * p)); }
    }
    mix(a, seg, i0);
  }
  chain(a, new Filter(sr, 'lp', 9000, 0.7));
  return done(a, sr, 40);
}

// ---------------------------------------------------------------- the tunnels

/** Room tone: the deep rumble of rock and plant, and air moving through the tunnels, rising and falling. */
function bed(sr, r) {
  const n = Math.floor(sr * 12), fade = Math.floor(sr * 1), out = [];
  for (let c = 0; c < 2; c++) {
    const a = new Float32Array(n + fade), lp = new Filter(sr, 'lp', 90, 0.7), m1 = new Mode(sr, 43, 1.5, 0.4), m2 = new Mode(sr, 67, 1.2, 0.3);
    const air = new Filter(sr, 'bp', 320, 0.6), air2 = new Filter(sr, 'lp', 900, 0.7), hi = new Filter(sr, 'bp', 2200, 0.8);
    let br = 0;
    for (let j = 0; j < a.length; j++) {
      const t = j / sr;
      br = br * 0.997 + r.white() * 0.05;
      const swell = 0.6 + 0.25 * Math.sin(TAU * t / 12 + c) + 0.15 * Math.sin(TAU * 3 * t / 12 + 2 * c);
      a[j] = lp.run(br) * 2 + (m1.run(r.white()) + m2.run(r.white())) * 0.02 + air2.run(air.run(r.white())) * 0.5 * swell + hi.run(r.white()) * 0.025 * swell;
    }
    out.push(loopify(a, fade));
  }
  let m = 0;
  for (const a of out) for (let j = 0; j < a.length; j++) m = Math.max(m, Math.abs(a[j]));
  for (const a of out) for (let j = 0; j < a.length; j++) a[j] *= 0.9 / m;
  return out;
}

/** A drop into a puddle: the bubble it traps rings and rises in pitch as it shrinks. */
function drip(sr, r) {
  const a = buf(sr, 0.14), f0 = r.range(700, 2200), d = r.range(45, 90), rise = r.range(4, 12);
  let ph = 0;
  for (let j = 0; j < a.length; j++) { const t = j / sr; ph += TAU * f0 * (1 + rise * t) / sr; a[j] = Math.sin(ph) * Math.exp(-d * t) * Math.min(1, t / 0.0015); }
  burst(a, sr, r, 0, 0.25, 0.0002, 0.0005, [new Filter(sr, 'hp', 3000, 0.7)]);
  return done(a, sr, 15);
}

/** Steel under strain somewhere: stick-slip shudders through a girder's modes, slowing and speeding. */
function creak(sr, r) {
  const dur = r.range(1.4, 2.8), base = r.range(110, 210), w = r.range(1.2, 2.2);
  const ex = friction(sr, r, {dur, rate: p => 6 + 38 * Math.sin(Math.PI * p) ** 2 * (0.7 + 0.3 * Math.sin(TAU * w * p)), slip: 0.0015, jitter: 0.3, hiss: 0.01});
  const beam = new Body(sr, [...[1, 2.76, 5.4, 8.93, 13.34].map((k, q) => [base * k, r.range(0.3, 0.9) / (1 + q * 0.3), 1 / (1 + q * 0.3)]), [r.range(700, 1300), 0.15, 0.5]]);
  for (let j = 0; j < ex.length; j++) { const p = j / ex.length; ex[j] = beam.run(ex[j]) * Math.min(1, p / 0.3) * Math.min(1, (1 - p) / 0.3); }
  return done(ex, sr, 60);
}

/** A pipe somewhere knocking as water hammers through it. */
function knock(sr, r) {
  const a = buf(sr, 2.2), base = r.range(210, 330);
  let t = 0, g = 1;
  for (let k = r.int(2, 4); k > 0 && t < 1.5; k--) {
    strike(a, sr, r, new Body(sr, [[base, r.range(0.3, 0.5), 1], [base * 2.71, 0.25, 0.5], [base * 4.93, 0.15, 0.3], [base * 7.6, 0.08, 0.15]]), Math.floor(t * sr), g, 1, 0.8);
    burst(a, sr, r, t, g * 0.4, 0.0005, 0.006, [new Filter(sr, 'lp', 1500, 0.7)]);
    t += r.range(0.12, 0.45); g *= r.range(0.55, 0.9);
  }
  return done(a, sr, 60);
}

/** Something heavy falling far off in the rock, and grit trickling down after it. */
function thud(sr, r) {
  const a = buf(sr, 2.0);
  strike(a, sr, r, new Body(sr, [[r.range(38, 52), 0.5, 1], [r.range(90, 120), 0.3, 0.5], [r.range(200, 260), 0.15, 0.3]]), 0, 1, 8, 1.2);
  burst(a, sr, r, 0, 0.5, 0.002, 0.03, [new Filter(sr, 'lp', 400, 0.7)]);
  grit(a, sr, r, r.range(0.25, 0.5), r.range(0.9, 1.6), r.int(8, 18), 0.15, 1500);
  return done(a, sr, 60);
}

/** A stone falling and bouncing to rest. */
function debris(sr, r) {
  const a = buf(sr, 1.6);
  let t = r.range(0, 0.05), gap = r.range(0.2, 0.32), g = 1;
  for (let k = r.int(6, 10); k > 0 && t < 1.4; k--) {
    strike(a, sr, r, new Body(sr, [[r.range(2200, 4200), r.range(0.01, 0.025), 1], [r.range(900, 1400), 0.02, 0.4], [r.range(5000, 7000), 0.006, 0.4]]), Math.floor(t * sr), g, 0.3, 0.1);
    t += gap; gap *= r.range(0.6, 0.78); g *= r.range(0.65, 0.85);
  }
  grit(a, sr, r, 0.02, 0.6, r.int(5, 12), 0.1, 2500);
  return done(a, sr, 40);
}

/** A dead light's ballast trying to strike: a mains buzz stuttering on and off, spitting as it catches. */
function buzz(sr, r) {
  const dur = r.range(1.2, 2), a = buf(sr, dur), bp = new Filter(sr, 'bp', 900, 0.5);
  let on = 0, g = 0, next = 0, ph = 0;
  for (let j = 0; j < a.length; j++) {
    if (j >= next) { on = r() < 0.55 ? r.range(0.4, 1) : 0; next = j + r.range(0.02, 0.25) * sr; if (on) burst(a, sr, r, j / sr, 0.6, 0.0002, 0.002, [new Filter(sr, 'hp', 2500, 0.7)]); }
    g += (on - g) * 0.01;
    ph += 100 / sr;
    const saw = 2 * (ph - Math.floor(ph)) - 1, s = Math.sin(TAU * ph);
    a[j] += bp.run(saw * 0.6 + Math.sign(s) * Math.abs(s) ** 0.3 * 0.4) * g;
  }
  return done(a, sr, 40);
}

/** Air moaning across the mouth of a duct. */
function wind(sr, r) {
  const dur = r.range(3.5, 5), n = Math.floor(dur * sr), a = new Float32Array(n), f = r.range(200, 360), wob = r.range(0.25, 0.45);
  const m1 = new Filter(sr, 'bp', f, 30), m2 = new Filter(sr, 'bp', f * 1.5, 25), m3 = new Filter(sr, 'bp', f * 2.02, 30), br = new Filter(sr, 'bp', 600, 0.5);
  for (let j = 0; j < n; j++) {
    const t = j / sr, p = j / n;
    if ((j & 63) === 0) { const g = 1 + 0.06 * Math.sin(TAU * wob * t); m1.set('bp', f * g, 30); m2.set('bp', f * 1.5 * g, 25); m3.set('bp', f * 2.02 * g, 30); }
    const x = r.white(), e = Math.pow(Math.sin(Math.PI * p), 1.5) * (0.7 + 0.3 * Math.sin(TAU * 0.8 * t));
    a[j] = (m1.run(x) * 4 + m2.run(x) * 2 + m3.run(x) + br.run(x) * 0.15) * e;
  }
  return done(a, sr, 100);
}

export const RECIPES = {
  motor: {loop: true, make: motor},
  spray: {loop: true, make: spray},
  trigger: {n: 3, make: trigger},
  overheat: {n: 2, make: overheat},
  sweep: {make: sweep},
  sweepEnd: {make: sweepEnd},
  stepWalk: {n: 8, make: footstep('walk')},
  stepSprint: {n: 8, make: footstep('sprint')},
  stepCrouch: {n: 6, make: footstep('crouch')},
  pantIn: {n: 3, rate: 0.5, make: pantIn},
  pantOut: {n: 3, rate: 0.5, make: pantOut},
  fearIn: {n: 3, rate: 0.5, make: fearIn},
  lub: {n: 2, rate: 0.5, make: heart(true)},
  dub: {n: 2, rate: 0.5, make: heart(false)},
  core: {make: core},
  paper: {n: 3, make: paper},
  battery: {n: 2, make: battery},
  crackle: {n: 6, make: crackle},
  slam: {n: 2, make: slam},
  door: {make: door},
  crClick: {n: 10, make: crClick},
  crCroak: {n: 4, make: crCroak},
  crGroan: {n: 4, rate: 0.5, make: crGroan},
  crShriek: {n: 3, rate: 0.5, make: scream(false)},
  crPain: {n: 3, rate: 0.5, make: scream(true)},
  crIn: {n: 3, rate: 0.5, make: crBreath('in')},
  crOut: {n: 3, rate: 0.5, make: crBreath('out')},
  crExhale: {n: 3, rate: 0.5, make: crBreath('exhale')},
  crStep: {n: 8, make: crStep(false)},
  crHit: {n: 8, make: crStep(true)},
  crDrag: {n: 4, make: crDrag},
  mimicTrigger: {n: 2, make: mimic('trigger')},
  mimicPing: {n: 2, rate: 0.5, make: mimic('ping')},
  mimicChime: {rate: 0.5, make: mimic('chime')},
  mimicTracker: {make: mimic('tracker')},
  sting: {n: 2, rate: 0.5, make: sting},
  whisper: {n: 4, rate: 0.5, make: whisper},
  bed: {loop: true, rate: 0.5, make: bed},
  drip: {n: 6, make: drip},
  creak: {n: 4, make: creak},
  knock: {n: 3, make: knock},
  thud: {n: 3, make: thud},
  debris: {n: 3, make: debris},
  buzz: {n: 2, make: buzz},
  wind: {n: 2, rate: 0.5, make: wind},
};
