// The game's sound vocabulary, built from AudioEngine primitives. Gameplay code calls these by name
// and never touches Web Audio directly.

import {clamp} from '../util/math.js';

// vowel formants (Hz) for the creature's throat
const VOWELS = {u: [300, 870, 2240], o: [450, 800, 2830], a: [730, 1090, 2440], e: [530, 1840, 2480], i: [270, 2290, 3010]};

export class Sounds {
  constructor(engine) {
    this.e = engine;
    this.hum = null;
    this.breath = null;
    this.drone = null;
    this.dread = null;
    this.ambT = 4;
    this.ambLevel = 1;
    this.heartT = 0;
    this.duckUntil = 0;
  }

  get ok() { return !!this.e.ctx; }

  /** Continuous voices (scanner hum, creature breath, ambient drone, dread rumble). Built once. */
  start() {
    if (!this.ok || this.hum) return;
    const c = this.e.ctx, e = this.e;
    // the scanner firing: a rain of tiny ticks, one for each dot as it lands, thickening and brightening
    // as it spins up, over a faint motor and a breath of air. A loop of randomly spaced clicks played
    // faster is more ticks a second.
    const sr = c.sampleRate, len = Math.floor(sr * 1.5), dotBuf = c.createBuffer(1, len, sr), d = dotBuf.getChannelData(0);
    for (let n = 0; n < 150; n++) {
      const at = Math.floor(Math.random() * (len - 200)), amp = 0.25 + Math.random() * 0.75, w = 40 + Math.random() * 110;
      const f0 = (1800 + Math.random() * 3500) / sr * Math.PI * 2;
      for (let i = 0; i < w; i++) d[at + i] += Math.sin(i * f0) * amp * Math.exp(-i / (w * 0.25)); // a glassy pinprick
    }
    const rain = c.createBufferSource(); rain.buffer = dotBuf; rain.loop = true;
    const rbp = c.createBiquadFilter(); rbp.type = 'bandpass'; rbp.frequency.value = 2600; rbp.Q.value = 0.7;
    const motor = c.createOscillator(); motor.frequency.value = 95;
    const mg = c.createGain(); mg.gain.value = 0.22;
    const hiss = c.createBufferSource(); hiss.buffer = e.noiseBuf; hiss.loop = true;
    const hhp = c.createBiquadFilter(); hhp.type = 'highpass'; hhp.frequency.value = 5200;
    const hg = c.createGain(); hg.gain.value = 0.12;
    const out = c.createGain(); out.gain.value = 0;
    const wet = c.createGain(); wet.gain.value = 0.35; // only a little of it in the cave's echo
    rain.connect(rbp); rbp.connect(out); motor.connect(mg); mg.connect(out); hiss.connect(hhp); hhp.connect(hg); hg.connect(out);
    out.connect(e.sfx); out.connect(wet); wet.connect(e.echo);
    rain.start(); motor.start(); hiss.start();
    this.hum = {rain, rbp, motor, out};

    // the creature's breath: a slow wet swell with a rattle in it, muffled by distance and rock
    const bs = c.createBufferSource(); bs.buffer = e.noiseBuf; bs.loop = true;
    const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 430; bf.Q.value = 1.8;
    const swell = c.createGain(); swell.gain.value = 0.5;           // 0.5 ± 0.5 from the slow LFO
    const sl = c.createOscillator(); sl.frequency.value = 0.32;
    const slg = c.createGain(); slg.gain.value = 0.5;
    sl.connect(slg); slg.connect(swell.gain);
    const rattle = c.createGain(); rattle.gain.value = 0.6;          // fast flutter: the rattle
    const rl = c.createOscillator(); rl.type = 'triangle'; rl.frequency.value = 11;
    const rlg = c.createGain(); rlg.gain.value = 0.4;
    rl.connect(rlg); rlg.connect(rattle.gain);
    const blp = c.createBiquadFilter(); blp.type = 'lowpass'; blp.frequency.value = 2000;
    const bAmp = c.createGain(); bAmp.gain.value = 0;
    const bp = c.createStereoPanner ? c.createStereoPanner() : null;
    bs.connect(bf); bf.connect(swell); swell.connect(rattle); rattle.connect(blp); blp.connect(bAmp);
    const bOut = bp || bAmp;
    if (bp) bAmp.connect(bp);
    bOut.connect(e.sfx);
    const bRev = c.createGain(); bRev.gain.value = 0.35; bOut.connect(bRev); bRev.connect(e.revIn);
    bs.start(); sl.start(); rl.start();
    this.breath = {amp: bAmp, pan: bp, lp: blp, rattle: rl};

    // ambient drone: a minor second and a tritone over A, beating slowly; never resolves
    const dg = c.createGain(); dg.gain.value = 0.0;
    const dlp = c.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 320; dlp.Q.value = 3;
    const dmod = c.createOscillator(); dmod.frequency.value = 0.05;
    const dmg = c.createGain(); dmg.gain.value = 140;
    dmod.connect(dmg); dmg.connect(dlp.frequency); dmod.start();
    for (const [hz, type, g] of [[55, 'sawtooth', 0.5], [58.27, 'sawtooth', 0.35], [77.78, 'triangle', 0.6], [110.4, 'sine', 0.25]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = hz;
      const og = c.createGain(); og.gain.value = g;
      o.connect(og); og.connect(dlp); o.start();
    }
    const air = c.createBufferSource(); air.buffer = e.noiseBuf; air.loop = true;
    const af = c.createBiquadFilter(); af.type = 'bandpass'; af.frequency.value = 280; af.Q.value = 0.8;
    const ag = c.createGain(); ag.gain.value = 0.25;
    air.connect(af); af.connect(ag); ag.connect(dlp); air.start();
    dlp.connect(dg); dg.connect(e.amb);
    const dRev = c.createGain(); dRev.gain.value = 0.3; dg.connect(dRev); dRev.connect(e.revIn);
    this.drone = dg;

    // dread: two sub tones beating against each other, felt more than heard, plus a thin ringing
    // that only comes in when it is almost on top of you
    const rg = c.createGain(); rg.gain.value = 0;
    for (const hz of [31, 33.6]) { const o = c.createOscillator(); o.frequency.value = hz; o.connect(rg); o.start(); }
    const rn = c.createBufferSource(); rn.buffer = e.noiseBuf; rn.loop = true;
    const rnf = c.createBiquadFilter(); rnf.type = 'lowpass'; rnf.frequency.value = 70;
    const rng = c.createGain(); rng.gain.value = 0.9;
    rn.connect(rnf); rnf.connect(rng); rng.connect(rg); rn.start();
    rg.connect(e.ui);
    const ring = c.createOscillator(); ring.frequency.value = 7900;
    const ringG = c.createGain(); ringG.gain.value = 0;
    ring.connect(ringG); ringG.connect(e.ui); ring.start();
    this.dread = {rumble: rg, ring: ringG};
  }

  /** Fade the ambience in or out (title screen, silence before a scare, the creature nearby). */
  ambience(level, time = 1.5) {
    if (!this.drone) return;
    this.ambLevel = level;
    this.drone.gain.setTargetAtTime(0.05 * level, this.e.now, time / 3);
  }

  duck(seconds) { this.duckUntil = this.e.now + seconds; this.ambience(0, 0.6); }

  /** Random distant noises of the tunnels; the whole bed thins out as `fear` rises. */
  updateAmbient(dt, fear = 0) {
    if (!this.ok) return;
    if (this.duckUntil && this.e.now > this.duckUntil) { this.duckUntil = 0; this.ambience(1, 3); }
    if (this.duckUntil) return;
    const want = 1 - 0.85 * clamp(fear * 1.4, 0, 1);
    if (Math.abs(want - this.ambLevel) > 0.05) this.ambience(want, 2);
    this.ambT -= dt;
    if (this.ambT > 0 || fear > 0.5) return;
    this.ambT = 14 + Math.random() * 22; // rare, so each one makes you stop
    const pan = Math.random() * 1.6 - 0.8, r = Math.random(), e = this.e;
    if (r < 0.3) { // metal creak: resonant band sweeping down
      e.noise(0.06, 1.6, {filter: 'bandpass', freq: 340 + Math.random() * 200, to: 160, q: 22, pan, attack: 0.3, echo: true, rev: 0.6, bus: e.amb});
    } else if (r < 0.55) { // drip
      e.tone(1500 + Math.random() * 900, 0.02, 0.09, {to: 700, pan, echo: true, rev: 0.7, bus: e.amb});
    } else if (r < 0.75) { // something heavy, far off
      e.noise(0.08, 0.9, {freq: 110, pan, rev: 0.8, bus: e.amb});
    } else if (r < 0.9) { // a pipe ticking as it cools
      for (let i = 0; i < 3; i++) e.tone(2600 + i * 40, 0.008, 0.6, {type: 'triangle', at: i * 0.35, pan, echo: true, rev: 0.5, bus: e.amb});
    } else { // air moving through a duct
      e.noise(0.03, 3.5, {filter: 'bandpass', freq: 900, to: 400, q: 1.5, attack: 1.2, pan, rev: 0.4, bus: e.amb});
    }
  }

  // ---------------------------------------------------------------- scanner
  updateHum(firing, charge, heat, interference = 0) {
    if (!this.hum) return;
    const h = this.hum, t = this.e.now;
    // hot, the motor strains; near the creature, the rain stutters and smears
    const strain = heat > 0.8 ? (heat - 0.8) * 120 : 0, jam = interference * (Math.random() - 0.5);
    h.out.gain.setTargetAtTime(firing ? 0.02 + 0.016 * charge : 0, t, firing ? 0.05 : 0.1);
    h.rain.playbackRate.setTargetAtTime(Math.max(0.2, 0.6 + 1.7 * charge + jam * 1.4), t, 0.05);
    h.rbp.frequency.setTargetAtTime(2000 + 2800 * charge + jam * 1500, t, 0.06);
    h.motor.frequency.setTargetAtTime(90 + 70 * charge + strain * (Math.random() - 0.3), t, 0.06);
  }
  trigger() { this.e.noise(0.018, 0.012, {filter: 'highpass', freq: 3000, echo: false}); this.e.tone(330, 0.012, 0.05, {echo: false}); }
  coreBell() { this.e.tone(1318.5, 0.035, 0.8); this.e.tone(1975.5, 0.015, 0.6, {at: 0.04}); }
  heatWarn() { this.e.tone(1760, 0.012, 0.05, {type: 'square', echo: false}); }
  overheat() {
    this.e.noise(0.09, 1.6, {filter: 'highpass', freq: 2500, to: 5000, echo: true});
    this.e.tone(220, 0.05, 0.5, {type: 'sawtooth', to: 70});
  }
  cooled() { this.e.tone(523.25, 0.02, 0.2); this.e.tone(783.99, 0.02, 0.3, {at: 0.08}); }
  denied() { this.e.tone(180, 0.02, 0.08, {echo: false}); }

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
    env.connect(e.sfx); env.connect(e.echo);
    o1.start(t); o2.start(t); n.start(t);
    o1.stop(t + dur + 0.5); o2.stop(t + dur + 0.5); n.stop(t + dur + 0.5);
  }
  sweepEnd() { this.e.noise(0.045, 0.25, {freq: 260}); }
  sweepReady() { this.e.tone(783.99, 0.03, 0.4); this.e.tone(1174.66, 0.025, 0.5, {at: 0.09}); }

  // ---------------------------------------------------------------- player
  step(kind) {
    const g = kind === 'sprint' ? 0.08 : kind === 'crouch' ? 0.02 : 0.05;
    this.e.noise(g, 0.09, {freq: 210 + Math.random() * 60});
  }
  breathe() { this.e.noise(0.025, 0.7, {filter: 'bandpass', freq: 900, q: 1.2, attack: 0.25}); }
  core() { [523.25, 659.25, 783.99, 1046.5].forEach((f, j) => this.e.tone(f, 0.055, 0.7, {at: j * 0.075})); }
  doorOpen() {
    this.e.noise(0.07, 0.9, {freq: 320, rev: 0.5});
    this.e.tone(196, 0.05, 1.4, {at: 0.35, type: 'triangle'});
    this.e.tone(293.66, 0.04, 1.4, {at: 0.5, type: 'triangle'});
  }
  note() { this.e.tone(880, 0.02, 0.25, {type: 'triangle'}); this.e.tone(1318.5, 0.015, 0.4, {at: 0.06}); }
  win() { [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.e.tone(f, 0.05, 1.4, {at: i * 0.11, bus: this.e.ui})); }
  click() { this.e.tone(660, 0.015, 0.05, {echo: false, bus: this.e.ui}); }

  // ---------------------------------------------------------------- signal
  ping(isExit, gain, pan) {
    if (isExit) { this.e.tone(659.25, gain, 0.6, {pan}); this.e.tone(880, gain * 0.6, 0.6, {pan, at: 0.09}); }
    else { this.e.tone(987.77, gain, 0.5, {pan}); this.e.tone(1975.5, gain * 0.25, 0.3, {pan}); }
  }
  crackle() {
    for (let i = 0; i < 4; i++) this.e.noise(0.012, 0.03, {filter: 'highpass', freq: 3000, at: Math.random() * 0.2, echo: false});
  }

  // ---------------------------------------------------------------- the motion tracker (in your hand)
  /** The pulse, once a second: a dry tick and a short falling tone, quiet, so the room stays quiet. */
  trackerPulse() {
    const e = this.e, ui = e.ui;
    e.noise(0.012, 0.01, {filter: 'highpass', freq: 4000, echo: false, bus: ui});
    e.tone(1150, 0.011, 0.12, {to: 980, bus: ui, echo: false});
  }
  /** Something moved: the nearer (0 far .. 1 on you), the higher and louder; very near, a double beep. */
  trackerReturn(close, pan = 0) {
    const e = this.e, f = 600 * Math.pow(2, 1.2 * clamp(close, 0, 1)), g = 0.02 + 0.022 * close;
    e.tone(f, g, 0.09, {type: 'triangle', pan, bus: e.ui, echo: false});
    e.tone(f * 2, g * 0.35, 0.07, {pan, bus: e.ui, echo: false});
    if (close > 0.8) e.tone(f * 1.06, g, 0.08, {type: 'triangle', pan, at: 0.12, bus: e.ui, echo: false});
  }
  /** Right on top of you: frantic beeps through static. */
  trackerFrantic() {
    for (let i = 0; i < 3; i++) this.e.tone(1600, 0.012, 0.045, {type: 'square', at: i * 0.07, bus: this.e.ui, echo: false});
    this.crackle();
  }
  trackerBoot() { this.e.tone(660, 0.01, 0.06, {bus: this.e.ui, echo: false}); this.e.tone(1320, 0.008, 0.06, {at: 0.07, bus: this.e.ui, echo: false}); }
  trackerOff() { this.e.tone(700, 0.007, 0.1, {to: 300, bus: this.e.ui, echo: false}); }
  trackerLow() {
    this.e.tone(1200, 0.015, 0.06, {type: 'square', bus: this.e.ui, echo: false});
    this.e.tone(900, 0.015, 0.06, {type: 'square', at: 0.12, bus: this.e.ui, echo: false});
  }
  /** Running flat: the screen dies with a falling whine. */
  trackerDead() {
    this.e.tone(400, 0.02, 0.35, {type: 'sawtooth', to: 60, bus: this.e.ui, echo: false});
    this.e.noise(0.03, 0.02, {freq: 1200, at: 0.3, bus: this.e.ui, echo: false});
  }
  /** Raising a dead one: just the switch. */
  trackerClick() { this.e.noise(0.035, 0.02, {freq: 1400, bus: this.e.ui, echo: false}); this.e.tone(140, 0.015, 0.05, {bus: this.e.ui, echo: false}); }
  /** A battery snapped in: two clacks and the charge whining up. */
  battery() {
    const e = this.e;
    e.noise(0.05, 0.02, {freq: 1800, bus: e.ui, echo: false}); e.noise(0.04, 0.02, {freq: 1500, at: 0.09, bus: e.ui, echo: false});
    e.tone(300, 0.015, 0.4, {to: 1400, at: 0.12, bus: e.ui, echo: false});
  }

  // ---------------------------------------------------------------- the creature
  /** Where a creature sound sits: pan, loudness falloff, how much rock dulls it, how much cave. */
  at(x, z, muffle, base) {
    const s = this.e.place(x, z);
    return {
      pan: s.pan * 0.9, dist: s.dist,
      g: clamp(base / (1 + s.dist / 4), 0, base),
      lp: (7000 - 5600 * muffle) / (1 + s.dist / 18),
      rev: clamp(0.25 + s.dist / 14 + muffle * 0.4, 0.25, 1.1),
    };
  }

  /**
   * Its throat: two buzzing sources a little out of tune, warbling and rough, torn by distortion and
   * shaped by vowel formants, so it sounds almost like a voice and never quite.
   * o: {f0, peak, f1, dur, vowels: 'uoa', gain, drive, scale (formant size), at, muffle}
   */
  voice(x, z, o) {
    const e = this.e;
    if (!this.ok || !e.claim()) return;
    const c = e.ctx, t = c.currentTime + (o.at || 0), d = o.dur;
    const p = this.at(x, z, o.muffle || 0, o.gain);
    if (p.g < 0.002) { e.voices--; return; }
    const s1 = c.createOscillator(); s1.type = 'sawtooth';
    const s2 = c.createOscillator(); s2.type = 'square'; s2.detune.value = 38;
    for (const s of [s1, s2]) {
      s.frequency.setValueAtTime(o.f0, t);
      s.frequency.exponentialRampToValueAtTime(o.peak ?? o.f0, t + d * 0.35);
      s.frequency.exponentialRampToValueAtTime(o.f1 ?? o.f0, t + d);
    }
    // wobble: a slow sick vibrato plus a fast rough flutter
    const v1 = c.createOscillator(); v1.frequency.value = 4.5 + Math.random() * 2.5;
    const v1g = c.createGain(); v1g.gain.value = o.f0 * 0.05;
    const v2 = c.createOscillator(); v2.type = 'square'; v2.frequency.value = 23 + Math.random() * 14;
    const v2g = c.createGain(); v2g.gain.value = o.f0 * 0.03;
    v1.connect(v1g); v2.connect(v2g);
    for (const s of [s1, s2]) { v1g.connect(s.frequency); v2g.connect(s.frequency); }
    const mix = c.createGain(); mix.gain.value = 0.5;
    s1.connect(mix); s2.connect(mix);
    const drive = e.shaper(o.drive || 3);
    mix.connect(drive);
    // breath through the same throat
    const n = c.createBufferSource(); n.buffer = e.noiseBuf; n.loop = true;
    const ng = c.createGain(); ng.gain.value = 0.35;
    n.connect(ng);
    // formants walking through the vowels
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(p.g, t + Math.min(0.12, d * 0.2));
    env.gain.setValueAtTime(p.g, t + d * 0.75);
    env.gain.exponentialRampToValueAtTime(0.0001, t + d);
    const vs = (o.vowels || 'uoa').split(''), sc = o.scale || 1;
    [1, 0.6, 0.28].forEach((amp, k) => {
      const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 7 + k * 3;
      vs.forEach((v, j) => {
        const at = t + d * (j / Math.max(1, vs.length - 1)) * 0.9;
        bp.frequency[j ? 'linearRampToValueAtTime' : 'setValueAtTime'](VOWELS[v][k] * sc, at);
      });
      const g = c.createGain(); g.gain.value = amp;
      drive.connect(bp); ng.connect(bp); bp.connect(g); g.connect(env);
    });
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = p.lp;
    env.connect(lp);
    e.out(lp, {pan: p.pan, rev: p.rev});
    s1.onended = () => { e.voices--; };
    for (const node of [s1, s2, v1, v2]) { node.start(t); node.stop(t + d + 0.1); }
    n.start(t, Math.random(), d + 0.1);
  }

  /** A low wet groan, heard from a distance while it wanders. */
  groan(x, z, muffle) {
    const f = 62 + Math.random() * 22;
    this.voice(x, z, {f0: f, peak: f * 1.25, f1: f * 0.8, dur: 1.8 + Math.random() * 1.2, vowels: Math.random() < 0.5 ? 'uoa' : 'oau', gain: 0.11, drive: 2.5, scale: 0.85, muffle});
  }
  /** The sound it makes when it has found you: a rising tearing wail over a roar. */
  shriek(x, z, muffle = 0, gain = 0.16) {
    this.voice(x, z, {f0: 190, peak: 560, f1: 300, dur: 1.5, vowels: 'aie', gain, drive: 7, scale: 1.15, muffle});
    this.voice(x, z, {f0: 205, peak: 600, f1: 290, dur: 1.4, vowels: 'aei', gain: gain * 0.7, drive: 7, scale: 1.2, at: 0.05, muffle});
    this.voice(x, z, {f0: 58, peak: 74, f1: 46, dur: 1.7, vowels: 'oau', gain: gain * 0.9, drive: 4, scale: 0.7, muffle});
    const p = this.at(x, z, muffle, 0.12);
    this.e.noise(p.g, 0.9, {filter: 'bandpass', freq: 2600, to: 900, q: 1.5, pan: p.pan, rev: p.rev});
  }
  /** Breath let out right next to you. */
  exhale(x, z) {
    const p = this.at(x, z, 0, 0.16);
    this.e.noise(p.g, 1.3, {filter: 'bandpass', freq: 650, to: 380, q: 2.5, attack: 0.35, pan: p.pan, rev: 0.3});
    this.e.noise(p.g * 0.4, 1.1, {filter: 'bandpass', freq: 2400, to: 1500, q: 4, attack: 0.3, pan: p.pan});
  }

  /** One wet click: a bright snap with a hollow knock under it. */
  clickAt(p, at, bright) {
    this.e.noise(p.g, 0.02, {filter: 'bandpass', freq: (2400 + 2000 * bright) * Math.min(1, p.lp / 4000 + 0.3), q: 9, at, pan: p.pan, rev: p.rev * 0.8});
    this.e.tone(320 + Math.random() * 180, p.g * 0.6, 0.03, {at, pan: p.pan, echo: false});
  }
  /** Echolocation: a burst of clicks that speeds up, ending in a creak from its throat. */
  clicks(x, z, muffle, intense = false) { // intense: true, a long sonar burst; 'short', a hunt's quick one
    const p = this.at(x, z, muffle, intense ? 0.09 : 0.06);
    if (p.g < 0.003) return;
    if (intense === 'short') {
      let t = 0;
      for (let i = 0; i < 5 + Math.floor(Math.random() * 3); i++) { this.clickAt(p, t, 0.6 + Math.random() * 0.4); t += 0.045 + Math.random() * 0.02; }
      return;
    }
    const n = intense ? 14 + Math.floor(Math.random() * 8) : 5 + Math.floor(Math.random() * 5);
    let t = 0, gap = intense ? 0.07 : 0.17;
    for (let i = 0; i < n; i++) { this.clickAt(p, t, Math.random()); t += gap * (0.8 + Math.random() * 0.4); gap *= intense ? 0.97 : 0.86; }
    if (Math.random() < 0.6) {
      this.e.tone(70 + Math.random() * 30, p.g * 0.7, 0.45, {type: 'sawtooth', to: 48, at: t + 0.05, pan: p.pan, rev: p.rev});
    }
  }
  /** Upright step: heavy footfall; every other step the other foot drags. */
  creatureStep(x, z, muffle, heavy = 1, drag = false) {
    const p = this.at(x, z, muffle, 0.17 * heavy);
    if (p.g < 0.003) return;
    this.e.noise(p.g, 0.18, {freq: Math.min(p.lp, 380) * (0.85 + Math.random() * 0.3), pan: p.pan, rev: p.rev});
    this.e.tone(48 + Math.random() * 10, p.g * 0.9, 0.2, {pan: p.pan * 0.5, echo: false});
    if (drag) this.e.noise(p.g * 0.35, 0.42, {filter: 'bandpass', freq: Math.min(p.lp, 1500), to: 500, q: 2, attack: 0.08, at: 0.12, pan: p.pan, rev: p.rev});
  }
  /** On all fours: four quick claw-and-knuckle hits per stride. */
  gallop(x, z, muffle) {
    const p = this.at(x, z, muffle, 0.15);
    if (p.g < 0.003) return;
    for (const at of [0, 0.07, 0.19, 0.25]) {
      this.e.noise(p.g * 0.7, 0.06, {filter: 'bandpass', freq: Math.min(p.lp, 3200), q: 3, at, pan: p.pan, rev: p.rev * 0.7});
      this.e.noise(p.g, 0.1, {freq: 260, at, pan: p.pan});
    }
  }
  /** Set breath loudness 0..1 and its direction. */
  setBreath(level, x, z, muffle = 0) {
    if (!this.breath) return;
    const t = this.e.now, s = this.e.place(x, z);
    this.breath.amp.gain.setTargetAtTime(0.16 * level, t, 0.25);
    this.breath.lp.frequency.setTargetAtTime(500 + 3500 * level * (1 - muffle), t, 0.2);
    this.breath.rattle.frequency.setTargetAtTime(9 + 6 * level, t, 0.5);
    if (this.breath.pan) this.breath.pan.pan.setTargetAtTime(s.pan, t, 0.1);
  }
  /** Sub rumble and ringing that build as it closes in. 0 calm .. 1 it is touching you. */
  setDread(level) {
    if (!this.dread) return;
    const t = this.e.now;
    this.dread.rumble.gain.setTargetAtTime(0.28 * level * level, t, 0.4);
    this.dread.ring.gain.setTargetAtTime(level > 0.8 ? (level - 0.8) * 0.03 : 0, t, 0.3);
  }
  /**
   * It repeats sounds it has heard you make, from where it stands, slightly wrong:
   * your scanner's trigger, the signal ping, the core chime played backwards, your footsteps.
   */
  mimic(kind, x, z, muffle) {
    const p = this.at(x, z, muffle, 0.07), e = this.e, o = {pan: p.pan, rev: p.rev};
    if (p.g < 0.003) return;
    if (kind === 'trigger') {
      e.tone(318, p.g * 0.7, 0.09, {...o, type: 'square'}); e.tone(305, p.g * 0.5, 0.09, {...o, type: 'square', at: 0.23});
    } else if (kind === 'ping') {
      e.tone(987.77 * 0.97, p.g * 0.6, 0.6, {...o, to: 900}); e.tone(1975.5 * 0.95, p.g * 0.2, 0.4, {...o, to: 1700});
    } else if (kind === 'chime') {
      [1046.5, 783.99, 659.25, 523.25].forEach((f, j) => e.tone(f * 0.94, p.g * 0.6, 0.9, {...o, at: j * 0.16, to: f * 0.9}));
    } else if (kind === 'tracker') { // your tracker's tick, from somewhere it is not
      for (let i = 0; i < 3; i++) e.tone(1150 * 0.96, p.g * 0.5, 0.16, {...o, at: i * 1.02, to: 930});
    } else {
      for (let i = 0; i < 3; i++) e.noise(p.g * 0.8, 0.09, {freq: 240, at: i * 0.47, pan: p.pan, rev: p.rev});
    }
  }
  /** Heartbeat speeds up as the creature closes in. Call every frame with 0 (calm) .. 1 (on top of you). */
  heart(dt, fear) {
    if (!this.ok || fear <= 0.02) { this.heartT = 0; return; }
    this.heartT -= dt;
    if (this.heartT > 0) return;
    const bpm = 58 + 100 * fear;
    this.heartT = 60 / bpm;
    const g = 0.04 + 0.1 * fear;
    this.e.tone(55, g, 0.14, {echo: false, bus: this.e.ui});
    this.e.tone(50, g * 0.7, 0.14, {at: 0.17, echo: false, bus: this.e.ui});
  }
  /** First sight of it: a dissonant stab with a boom under it. */
  sting() {
    const e = this.e;
    for (const f of [1661, 1760, 1864.7, 830.6]) e.tone(f, 0.035, 2.2, {type: 'sawtooth', attack: 0.008, rev: 0.6});
    e.tone(44, 0.2, 1.6, {echo: false, rev: 0.4});
    e.noise(0.1, 0.5, {filter: 'highpass', freq: 2000, rev: 0.5});
  }
  /** Caught: its shriek in your face, then the roar. */
  caught() {
    const e = this.e, L = e.listener;
    const fx = L.x + Math.sin(L.yaw) * 0.6, fz = L.z - Math.cos(L.yaw) * 0.6;
    this.shriek(fx, fz, 0, 0.3);
    e.noise(0.4, 1.4, {filter: 'lowpass', freq: 4000, to: 120, bus: e.ui, rev: 0.4});
    e.tone(90, 0.3, 1.6, {type: 'sawtooth', to: 30, bus: e.ui});
  }
  /** The ringing in your ears after. */
  aftermath() {
    this.e.tone(7900, 0.02, 2.8, {attack: 0.02, echo: false, bus: this.e.ui});
    this.e.tone(52, 0.12, 1.8, {echo: false, bus: this.e.ui});
  }
  slam(x, z) {
    const s = this.e.place(x, z);
    this.e.noise(0.35, 1.2, {freq: 600, to: 90, pan: s.pan, echo: true, rev: 0.8});
    this.e.tone(70, 0.2, 0.6, {pan: s.pan});
  }
  whisper(x, z) {
    const s = this.e.place(x, z);
    for (let i = 0; i < 6; i++) {
      this.e.noise(0.03, 0.25 + Math.random() * 0.2, {filter: 'bandpass', freq: 2200 + Math.random() * 1600, q: 6, at: i * 0.22, attack: 0.08, pan: s.pan, echo: true, rev: 0.7});
    }
  }
}
