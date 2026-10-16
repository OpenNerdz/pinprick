// The game's sound vocabulary. Gameplay code calls these by name and never touches Web Audio. Nearly
// every sound is a recording the bank makes at start-up from the recipes in recipes.js; this file
// decides where each one plays from and how loud. The creature and the tunnels play in 3D through the
// cave, so a sound behind you is behind you; your devices play through their own small speaker; your
// heart and the dread play inside your head.

import {clamp} from '../util/math.js';
import {Bank} from './bank.js';
import {RECIPES} from './recipes.js';

// how often each kind of distant noise turns up in each level's tunnels
const PLACES = {
  intake: {drip: 2, buzz: 2, knock: 1, creak: 1, debris: 1, wind: 1, thud: 0.5},
  sublevel: {drip: 1.5, creak: 1.5, knock: 1.5, thud: 1, debris: 1, buzz: 1, wind: 1},
  cistern: {drip: 4, wind: 1.5, knock: 1, creak: 1, debris: 1, thud: 0.5},
  shaft: {creak: 3, wind: 2, knock: 1.5, debris: 1.5, thud: 1, drip: 0.5, buzz: 0.5},
};
// and how loud each is, before distance
const AMB_GAIN = {drip: 0.07, buzz: 0.028, knock: 0.07, creak: 0.07, debris: 0.085, wind: 0.05, thud: 0.16};
const MIMIC = {trigger: 'mimicTrigger', ping: 'mimicPing', chime: 'mimicChime', tracker: 'mimicTracker'};

export class Sounds {
  constructor(engine) {
    this.e = engine;
    this.bank = null;
    this.hum = null;
    this.drone = null;
    this.dread = null;
    this.ambT = 4;
    this.ambLevel = 1;
    this.heartT = 0;
    this.scaredT = 2;
    this.duckUntil = 0;
    this.breath = {t: 0, at: 0, out: false};
    this.weights = PLACES.sublevel;
  }

  get ok() { return !!this.e.ctx; }

  /** Render the bank and start the continuous voices (the scanner's purr, room tone, dread). */
  start() {
    if (!this.ok || this.hum) return;
    const c = this.e.ctx, e = this.e, b = this.bank = new Bank(c, RECIPES);
    const loop = (name, rate = 1) => { const s = c.createBufferSource(); s.buffer = b.get(name); s.loop = true; s.playbackRate.value = rate; s.start(); return s; };
    const gain = v => { const g = c.createGain(); g.gain.value = v; return g; };
    // the scanner's purr (the game's original): two voices a fifth apart with a tremolo that speeds up
    // as it spins up
    const o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.value = 140;
    const o2 = c.createOscillator(); o2.type = 'sine'; o2.frequency.value = 210;
    const g2 = gain(0.5), f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 500; f.Q.value = 2;
    const trem = gain(0.62), lfo = c.createOscillator(); lfo.frequency.value = 11;
    const lg = gain(0.38), out = gain(0);
    o1.connect(f); o2.connect(g2); g2.connect(f); f.connect(trem); lfo.connect(lg); lg.connect(trem.gain);
    trem.connect(out); out.connect(e.sfx); out.connect(e.slap);
    o1.start(); o2.start(); lfo.start();
    this.hum = {o1, o2, f, lfo, out};
    // room tone: rock, plant and moving air
    const bed = loop('bed'), bg = gain(0);
    bed.connect(bg); bg.connect(e.amb);
    this.drone = bg;
    // dread: two sub tones beating, roughened so that small speakers carry their overtones, over a
    // rumble; and when it is right on you, a thin ringing
    const rg = gain(0), rough = e.shaper(1.6), rlp = c.createBiquadFilter();
    rlp.type = 'lowpass'; rlp.frequency.value = 400;
    for (const hz of [41, 43.6]) { const o = c.createOscillator(); o.frequency.value = hz; const og = gain(0.45); o.connect(og); og.connect(rough); o.start(); }
    rough.connect(rlp); rlp.connect(rg);
    const rn = c.createBufferSource(); rn.buffer = e.noiseBuf; rn.loop = true;
    const rnf = c.createBiquadFilter(); rnf.type = 'lowpass'; rnf.frequency.value = 90;
    const rng = gain(1.2);
    rn.connect(rnf); rnf.connect(rng); rng.connect(rg); rn.start();
    rg.connect(e.ui);
    const ring = c.createOscillator(); ring.frequency.value = 6200;
    const ringG = gain(0);
    ring.connect(ringG); ringG.connect(e.ui); ring.start();
    this.dread = {rumble: rg, ring: ringG};
    b.prefill();
  }

  /** Play variant of a bank sound (or a composed buffer). */
  play(name, o) {
    if (!this.bank) return;
    this.e.play(typeof name === 'string' ? this.bank.get(name) : name, o);
  }

  /** Which level's tunnels these are, for the mix of distant noises. */
  setPlace(id) { this.weights = PLACES[id] || PLACES.sublevel; }

  /** Fade the room tone in or out (title screen, silence before a scare, the creature nearby). */
  ambience(level, time = 1.5) {
    if (!this.drone) return;
    this.ambLevel = level;
    this.drone.gain.setTargetAtTime(0.09 * level, this.e.now, time / 3);
  }

  duck(seconds) { this.duckUntil = this.e.now + seconds; this.ambience(0, 0.6); }

  /** Now and then a noise somewhere off in the tunnels, any direction; all of it thins out as `fear` rises. */
  updateAmbient(dt, fear = 0) {
    if (!this.bank) return;
    if (this.duckUntil && this.e.now > this.duckUntil) { this.duckUntil = 0; this.ambience(1, 3); }
    if (this.duckUntil) return;
    const want = 1 - 0.85 * clamp(fear * 1.4, 0, 1);
    if (Math.abs(want - this.ambLevel) > 0.05) this.ambience(want, 2);
    this.ambT -= dt;
    if (this.ambT > 0 || fear > 0.5) return;
    this.ambT = 12 + Math.random() * 22; // rare, so each one makes you stop
    const w = this.weights, kinds = Object.keys(w);
    let r = Math.random() * kinds.reduce((s, k) => s + w[k], 0), kind = kinds[0];
    for (const k of kinds) if ((r -= w[k]) < 0) { kind = k; break; }
    this.distant(kind, Math.random());
  }
  /** One noise of the tunnels (drip, creak, knock, thud, debris, buzz, wind), `far` 0..1 away, any direction. */
  distant(kind, far) {
    const a = Math.random() * Math.PI * 2, buf = this.bank.get(kind);
    const o = {pos: {pan: Math.sin(a), front: Math.cos(a)}, gain: AMB_GAIN[kind] * (1 - 0.6 * far), lp: 9000 - 7000 * far, rev: 0.5 + 0.5 * far, bus: this.e.amb, rate: 0.92 + Math.random() * 0.16};
    const n = kind === 'drip' && Math.random() < 0.5 ? 2 + Math.floor(Math.random() * 3) : 1; // a few drops from the same spot
    for (let i = 0, t = 0; i < n; i++, t += 0.6 + Math.random() * 0.9) this.e.play(buf, {...o, at: t});
  }

  // ---------------------------------------------------------------- scanner
  updateHum(firing, charge, heat, interference = 0) {
    if (!this.hum) return;
    const h = this.hum, t = this.e.now;
    // hot, it wobbles; near the creature, interference shakes it
    const wobble = (heat > 0.8 ? (heat - 0.8) * 60 : 0) + interference * (Math.random() - 0.5) * 120;
    h.out.gain.setTargetAtTime(firing ? 0.03 + 0.03 * charge : 0, t, firing ? 0.04 : 0.09);
    h.o1.frequency.setTargetAtTime(140 + 250 * charge - wobble, t, 0.06);
    h.o2.frequency.setTargetAtTime((140 + 250 * charge) * 1.5 + wobble, t, 0.06);
    h.f.frequency.setTargetAtTime(480 + 1700 * charge, t, 0.06);
    h.lfo.frequency.setTargetAtTime(11 + 33 * charge + interference * 20, t, 0.06);
  }
  trigger() { this.e.tone(330, 0.025, 0.07, {echo: false}); }
  coreBell() { const dev = this.e.dev; this.e.tone(1318.5, 0.03, 0.6, {bus: dev, echo: false}); this.e.tone(1975.5, 0.015, 0.5, {at: 0.04, bus: dev, echo: false}); }
  heatWarn() { this.e.tone(3150, 0.008, 0.05, {type: 'square', bus: this.e.dev, echo: false}); }
  overheat() { this.play('overheat', {gain: 0.25, rev: 0.25}); }
  cooled() {
    this.play('switch', {gain: 0.035, rate: 0.8});
    this.e.tone(1046.5, 0.016, 0.12, {type: 'square', at: 0.1, bus: this.e.dev, echo: false});
    this.e.tone(1568, 0.016, 0.16, {type: 'square', at: 0.22, bus: this.e.dev, echo: false});
  }
  denied() { this.e.tone(380, 0.014, 0.1, {type: 'square', bus: this.e.dev, echo: false}); }

  /** The sweep (the game's original): two tones and a band of noise falling with it down the view. */
  sweep(dur) {
    if (!this.ok) return;
    const e = this.e, c = e.ctx, t = c.currentTime;
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t); env.gain.linearRampToValueAtTime(1, t + 0.08);
    env.gain.setValueAtTime(1, t + dur - 0.1); env.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
    const o1 = c.createOscillator(); o1.type = 'triangle'; o1.frequency.setValueAtTime(1046.5, t); o1.frequency.exponentialRampToValueAtTime(130.8, t + dur);
    const o2 = c.createOscillator(); o2.frequency.setValueAtTime(1568, t); o2.frequency.exponentialRampToValueAtTime(196, t + dur);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(2000, t); f.frequency.exponentialRampToValueAtTime(600, t + dur);
    const g1 = c.createGain(); g1.gain.value = 0.042; const g2 = c.createGain(); g2.gain.value = 0.018;
    o1.connect(g1); o2.connect(g2); g1.connect(f); g2.connect(f); f.connect(env);
    const n = c.createBufferSource(); n.buffer = e.noiseBuf; n.loop = true;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.3;
    bp.frequency.setValueAtTime(4200, t); bp.frequency.exponentialRampToValueAtTime(500, t + dur);
    const gn = c.createGain(); gn.gain.value = 0.022;
    n.connect(bp); bp.connect(gn); gn.connect(env);
    env.connect(e.sfx); env.connect(e.slap);
    o1.start(t); o2.start(t); n.start(t);
    o1.stop(t + dur + 0.5); o2.stop(t + dur + 0.5); n.stop(t + dur + 0.5);
  }
  sweepEnd() { this.e.noise(0.045, 0.25, {freq: 260}); }
  sweepReady() { this.e.tone(783.99, 0.03, 0.4, {echo: false, slap: true}); this.e.tone(1174.66, 0.025, 0.5, {at: 0.09, echo: false, slap: true}); }

  // ---------------------------------------------------------------- you
  step(kind) {
    const name = kind === 'sprint' ? 'stepSprint' : kind === 'crouch' ? 'stepCrouch' : 'stepWalk';
    const g = kind === 'sprint' ? 0.05 : kind === 'crouch' ? 0.014 : 0.03;
    this.play(name, {gain: g * (0.85 + Math.random() * 0.3), rate: 0.94 + Math.random() * 0.12, rev: 0.1});
  }
  /** Out of puff: a few ragged breaths, settling. */
  breathe() {
    for (let k = 0; k < 4; k++) {
      const g = 0.028 * (1 - k * 0.18), t = k * 0.78;
      this.play('pantIn', {gain: g * 0.6, at: t, rev: 0.04});
      this.play('pantOut', {gain: g, at: t + 0.32, rev: 0.04});
    }
  }
  core() {
    this.play('core', {gain: 0.12, rev: 0.1});
    this.e.tone(659.25, 0.018, 0.18, {type: 'square', at: 0.5, bus: this.e.dev, echo: false});
    this.e.tone(987.77, 0.018, 0.3, {type: 'square', at: 0.62, bus: this.e.dev, echo: false});
  }
  doorOpen() { this.play('door', {gain: 0.13, rev: 0.5}); }
  note() { this.play('paper', {gain: 0.07, rev: 0.05}); }
  win() { [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.e.tone(f, 0.035, 1.4, {at: i * 0.11, bus: this.e.ui})); }
  click() { this.e.tone(660, 0.015, 0.05, {echo: false, bus: this.e.ui}); }

  // ---------------------------------------------------------------- signal
  ping(isExit, gain, pan) {
    const o = {pan, bus: this.e.dev, echo: false};
    if (isExit) { this.e.tone(659.25, gain, 0.6, o); this.e.tone(880, gain * 0.6, 0.6, {...o, at: 0.09}); }
    else { this.e.tone(987.77, gain, 0.5, o); this.e.tone(1975.5, gain * 0.25, 0.3, o); }
  }
  crackle() { this.play('crackle', {gain: 0.035, bus: this.e.dev}); }

  // ---------------------------------------------------------------- the motion tracker (in your hand)
  /** The pulse, once a second: a dry tick and a short falling tone, quiet, so the room stays quiet. */
  trackerPulse() {
    const e = this.e, dev = e.dev;
    e.noise(0.012, 0.01, {filter: 'highpass', freq: 4000, echo: false, bus: dev});
    e.tone(1150, 0.011, 0.12, {to: 980, bus: dev, echo: false});
  }
  /** Something moved: the nearer (0 far .. 1 on you), the higher and louder; very near, a double beep. */
  trackerReturn(close, pan = 0) {
    const e = this.e, f = 600 * Math.pow(2, 1.2 * clamp(close, 0, 1)), g = 0.02 + 0.022 * close, o = {pan, bus: e.dev, echo: false};
    e.tone(f, g, 0.09, {...o, type: 'triangle'});
    e.tone(f * 2, g * 0.35, 0.07, o);
    if (close > 0.8) e.tone(f * 1.06, g, 0.08, {...o, type: 'triangle', at: 0.12});
  }
  /** Right on top of you: frantic beeps through static. */
  trackerFrantic() {
    for (let i = 0; i < 3; i++) this.e.tone(1600, 0.012, 0.045, {type: 'square', at: i * 0.07, bus: this.e.dev, echo: false});
    this.crackle();
  }
  trackerBoot() { const dev = this.e.dev; this.e.tone(660, 0.01, 0.06, {bus: dev, echo: false}); this.e.tone(1320, 0.008, 0.06, {at: 0.07, bus: dev, echo: false}); }
  trackerOff() { this.e.tone(700, 0.007, 0.1, {to: 300, bus: this.e.dev, echo: false}); }
  trackerLow() {
    this.e.tone(1200, 0.015, 0.06, {type: 'square', bus: this.e.dev, echo: false});
    this.e.tone(900, 0.015, 0.06, {type: 'square', at: 0.12, bus: this.e.dev, echo: false});
  }
  /** Running flat: the screen dies with a falling whine. */
  trackerDead() {
    this.e.tone(400, 0.02, 0.35, {type: 'sawtooth', to: 60, bus: this.e.dev, echo: false});
    this.e.noise(0.03, 0.02, {freq: 1200, at: 0.3, bus: this.e.dev, echo: false});
  }
  /** Raising a dead one: just the switch. */
  trackerClick() { this.play('switch', {gain: 0.04, rate: 0.7}); }
  /** A battery snapped in: two clacks and the charge whining up. */
  battery() { this.play('battery', {gain: 0.06, bus: this.e.dev}); }

  // ---------------------------------------------------------------- the creature
  /** Where a creature sound sits: direction, loudness falloff, how much rock dulls it, how much cave. */
  at(x, z, muffle, base) {
    const s = this.e.place(x, z);
    return {
      pos: s, dist: s.dist,
      g: clamp(base / (1 + s.dist / 4), 0, base),
      lp: (9000 - 7400 * muffle) / (1 + s.dist / 16),
      rev: clamp(0.25 + s.dist / 14 + muffle * 0.4, 0.25, 1.1),
    };
  }
  /** One of its sounds from where `at()` placed it, `gain` times the loudness there. */
  from(p, name, gain = 1, o = {}) {
    if (p.g * gain < 0.002) return;
    this.play(name, {gain: p.g * gain, pos: p.pos, lp: p.lp, rev: p.rev, ...o});
  }

  /** A low wet groan, heard from a distance while it wanders. */
  groan(x, z, muffle) { this.from(this.at(x, z, muffle, 0.085), 'crGroan', 1, {rate: 0.9 + Math.random() * 0.2}); }
  /** It has found you: a scream. Quietly (in the light) it is a short pained one. */
  shriek(x, z, muffle = 0, gain = 0.16) {
    const pain = gain < 0.09;
    this.from(this.at(x, z, muffle, gain), pain ? 'crPain' : 'crShriek', pain ? 2.5 : 1.6, {rate: 0.95 + Math.random() * 0.1});
  }
  /** Breath let out right next to you. */
  exhale(x, z) { this.from(this.at(x, z, 0, 0.09), 'crExhale', 1, {rev: 0.3}); }

  /** Echolocation: a burst of wet clicks that speeds up, often ending in a creak from its throat. */
  clicks(x, z, muffle, intense = false) { // intense: true, a long sonar burst; 'short', a hunt's quick one
    const p = this.at(x, z, muffle, intense ? 0.1 : 0.07), b = this.bank;
    if (!b || p.g < 0.003) return;
    const parts = [];
    let t = 0;
    if (intense === 'short') {
      for (let i = 5 + Math.floor(Math.random() * 3); i > 0; i--) { parts.push([b.get('crClick'), t, 0.95 + Math.random() * 0.35]); t += 0.045 + Math.random() * 0.02; }
    } else {
      let gap = intense ? 0.07 : 0.17;
      for (let i = intense ? 14 + Math.floor(Math.random() * 8) : 5 + Math.floor(Math.random() * 5); i > 0; i--) {
        parts.push([b.get('crClick'), t, 0.6 + Math.random() * 0.4]);
        t += gap * (0.8 + Math.random() * 0.4); gap *= intense ? 0.97 : 0.86;
      }
      if (Math.random() < 0.6) parts.push([b.get('crCroak'), t + 0.05, 0.8]);
    }
    this.from(p, b.compose(parts));
  }
  /** Upright step: a heavy bare foot; every other step the other foot drags. */
  creatureStep(x, z, muffle, heavy = 1, drag = false) {
    const p = this.at(x, z, muffle, 0.17 * heavy);
    if (p.g < 0.003) return;
    this.from(p, 'crStep', 1, {rate: 0.9 + Math.random() * 0.2});
    if (drag) this.from(p, 'crDrag', 0.45, {at: 0.12});
  }
  /** On all fours: four quick knuckle-and-claw hits per stride. */
  gallop(x, z, muffle) {
    const p = this.at(x, z, muffle, 0.09), b = this.bank;
    if (!b || p.g < 0.003) return;
    this.from(p, b.compose([[b.get('crHit'), 0, 0.8], [b.get('crHit'), 0.07, 1], [b.get('crHit'), 0.19, 0.75], [b.get('crHit'), 0.25, 0.95]]));
  }
  /**
   * Its breathing, 0..1 (distance already counted) from where it stands: called every frame, it breathes
   * one breath at a time, in with a wheeze, out with a rattle, then a pause.
   */
  setBreath(level, x, z, muffle = 0) {
    if (!this.bank) return;
    const b = this.breath, t = this.e.now, dt = clamp(t - b.at, 0, 0.1);
    b.at = t;
    if (level < 0.03) { b.t = Math.min(b.t, 0.3 + Math.random() * 0.5); return; }
    if ((b.t -= dt) > 0) return;
    const p = this.at(x, z, muffle, 1);
    this.play(b.out ? 'crOut' : 'crIn', {gain: 0.1 * level * (b.out ? 1 : 0.75), pos: p.pos, lp: Math.min(p.lp, 600 + 6000 * level), rev: 0.3});
    b.t = b.out ? 1.2 + Math.random() * 0.8 - 0.4 * clamp(level, 0, 1) : 0.8 + Math.random() * 0.15;
    b.out = !b.out;
  }
  /** Sub rumble and ringing that build as it closes in. 0 calm .. 1 it is touching you. */
  setDread(level) {
    if (!this.dread) return;
    const t = this.e.now;
    this.dread.rumble.gain.setTargetAtTime(0.28 * level * level, t, 0.4);
    this.dread.ring.gain.setTargetAtTime(level > 0.8 ? (level - 0.8) * 0.02 : 0, t, 0.3);
  }
  /**
   * It repeats sounds it has heard you make, from where it stands, slightly wrong, with its own throat:
   * your trigger's clack, the signal ping, the core chime, the tracker's tick, your footsteps.
   */
  mimic(kind, x, z, muffle) {
    const p = this.at(x, z, muffle, 0.07), b = this.bank;
    if (!b || p.g < 0.003) return;
    if (MIMIC[kind]) { this.from(p, MIMIC[kind]); return; }
    this.from(p, b.compose([[b.get('stepWalk'), 0, 1], [b.get('stepWalk'), 0.47, 0.85], [b.get('stepWalk'), 0.94, 1]]), 0.5, {rate: 0.86});
  }
  /** Your heart speeds up as it closes in, and close, your own breath shakes. 0 (calm) .. 1 (on top of you). */
  heart(dt, fear) {
    if (!this.bank || fear <= 0.02) { this.heartT = 0; return; }
    if (fear < 0.6) this.scaredT = Math.max(this.scaredT, 2);
    else if ((this.scaredT -= dt) <= 0) {
      this.scaredT = 3.5 + Math.random() * 3 - fear * 1.2;
      this.play('fearIn', {gain: 0.024 * fear, bus: this.e.ui});
      this.play('pantOut', {gain: 0.018 * fear, at: 0.75 + Math.random() * 0.4, bus: this.e.ui});
    }
    if ((this.heartT -= dt) > 0) return;
    const bpm = 58 + 100 * fear, g = 0.05 + 0.12 * fear;
    this.heartT = 60 / bpm;
    this.play('lub', {gain: g, bus: this.e.ui});
    this.play('dub', {gain: g * 0.7, at: 0.17 * (1 - fear * 0.3), bus: this.e.ui});
  }
  /** First sight of it: bowed metal sliding as it rings, over a deep boom. */
  sting() { this.play('sting', {gain: 0.13, rev: 0.5}); }
  /** Caught: its scream in your face, its weight landing on you, the rush of it. */
  caught() {
    const e = this.e, L = e.listener;
    this.shriek(L.x + Math.sin(L.yaw) * 0.6, L.z - Math.cos(L.yaw) * 0.6, 0, 0.3);
    this.play('crStep', {gain: 0.5, rate: 0.6, bus: e.ui});
    e.noise(0.25, 1.2, {filter: 'lowpass', freq: 3000, to: 100, bus: e.ui, rev: 0.4});
  }
  /** After: your ears ringing and the world muffled, one heavy beat of your heart. */
  aftermath() {
    this.e.deafen(3);
    this.e.tone(6200, 0.014, 3.2, {attack: 0.02, echo: false, bus: this.e.ui});
    this.play('lub', {gain: 0.2, bus: this.e.ui});
  }
  slam(x, z) { this.play('slam', {gain: 0.22, pos: this.e.place(x, z), rev: 0.7}); }
  /** Whispering, and a second voice a moment behind it from somewhere else. */
  whisper(x, z) {
    const s = this.e.place(x, z);
    this.play('whisper', {gain: 0.03, pos: s, rev: 0.6});
    this.play('whisper', {gain: 0.018, pos: {pan: -s.pan * 0.6, front: s.front}, rev: 0.7, at: 0.35 + Math.random() * 0.3});
  }
}
