// The sound bank's recipes run in plain JS, so they can be checked without a browser: every sound
// renders, stays in range, is not silent, and comes out the same from the same seed.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RECIPES} from '../src/audio/recipes.js';
import {rand, Filter, Mode, throat, loopify} from '../src/audio/dsp.js';
import {Bank, seedOf, renderVariant} from '../src/audio/bank.js';
import {AudioEngine} from '../src/audio/engine.js';
import {Sounds} from '../src/audio/sounds.js';
import {build} from 'esbuild';

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
  for (const name of ['bed', 'pumpBeat', 'pumpDrone']) {
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
  assert.equal(b.all('drip'), b.all('drip'), 'rendered once');
  assert.equal(seedOf('drip', 2), seedOf('drip', 2));
  assert.notEqual(seedOf('drip', 2), seedOf('drip', 3));
});

// ---------------------------------------------------------------- the vocabulary, against a stand-in for Web Audio

/** Just enough of Web Audio to run Sounds and AudioEngine, keeping a list of every node made. */
function fakeAudio(listener) {
  const made = [];
  const param = v => {
    const p = {value: v, target: v, setValueAtTime(x) { p.target = x; }, linearRampToValueAtTime(x) { p.target = x; }, exponentialRampToValueAtTime(x) { p.target = x; }, cancelScheduledValues() { p.queued = []; }, queued: [],
      setTargetAtTime(x, t) { p.queued.push([x, t]); }};
    return p;
  };
  const node = (kind, extra = {}) => { const n = {kind, outs: [], connect(d) { n.outs.push(d); return d; }, disconnect() { n.outs = []; }, ...extra}; made.push(n); return n; };
  const source = kind => node(kind, {started: 0, playbackRate: param(1), frequency: param(440), start() { this.started++; }, stop() {}});
  class Ctx {
    constructor() {
      this.sampleRate = 24000; this.currentTime = 1; this.state = 'running'; this.calls = [];
      this.destination = node('dest');
      this.listener = listener || {positionX: param(0), positionY: param(0), positionZ: param(0), forwardX: param(0), forwardY: param(0), forwardZ: param(-1)};
    }
    suspend() { this.calls.push('suspend'); return Promise.resolve(); }
    resume() { this.calls.push('resume'); return Promise.resolve(); }
    createGain() { return node('gain', {gain: param(1)}); }
    createBiquadFilter() { return node('filter', {frequency: param(350), Q: param(1), gain: param(0)}); }
    createConvolver() { return node('convolver'); }
    createDelay() { return node('delay', {delayTime: param(0)}); }
    createWaveShaper() { return node('shaper'); }
    createDynamicsCompressor() { return node('comp', {threshold: param(0), ratio: param(0), attack: param(0)}); }
    createStereoPanner() { return node('stereo', {pan: param(0)}); }
    createPanner() { return node('panner', {positionX: param(0), positionY: param(0), positionZ: param(0)}); }
    createOscillator() { return source('osc'); }
    createBufferSource() { return source('src'); }
    createBuffer(nc, len, sr) { const ch = Array.from({length: nc}, () => new Float32Array(len)); return {numberOfChannels: nc, length: len, sampleRate: sr, getChannelData: k => ch[k]}; }
  }
  globalThis.window = {AudioContext: Ctx};
  const e = new AudioEngine(), s = new Sounds(e);
  e.init();
  return {e, s, c: e.ctx, made, started: () => made.filter(n => n.kind === 'src' && n.started).length};
}
const filled = listener => { const a = fakeAudio(listener); a.s.start(); a.s.bank.fillNow(); return a; };
const rmsOf = c => Math.sqrt(c.reduce((t, v) => t + v * v, 0) / c.length);
/** Where the energy of a sound sits, in Hz: from how fast it wiggles (zero crossings of its slope would do as well). */
const brightness = (c, sr) => { let d = 0, s = 0; for (let i = 1; i < c.length; i++) { d += (c[i] - c[i - 1]) ** 2; s += c[i] * c[i]; } return Math.sqrt(d / Math.max(s, 1e-12)) * sr / (2 * Math.PI); };

test('every new sound in the vocabulary starts a voice', () => {
  const {s, started} = filled();
  const calls = {
    throwStone: () => s.throwStone(), stoneHit: () => s.stoneHit(3, -4, 1), stoneTick: () => s.stoneHit(3, -4, 0.3), holdBreath: () => s.holdBreath(), releaseBreath: () => s.releaseBreath(), gasp: () => s.gasp(),
    chitter: () => s.chitter(2, -3, 0.2), sniff: () => s.sniff(0.5, 0.3, 0), stomp: () => s.stomp(-6, 2, 0.4),
  };
  for (const [name, fn] of Object.entries(calls)) { const n = started(); fn(); assert.equal(started(), n + 1, name); }
});

test('new recipes stay short, so they add little to start-up', () => {
  const limit = {swish: 0.3, stoneHit: 0.45, stoneTick: 0.12, breathCatch: 0.26, breathLet: 1.15, gasp: 1.35, crChitter: 0.9, crSniff: 2.4, crStomp: 0.9, pumpBeat: 5.3, pumpDrone: 4.1};
  for (const [name, secs] of Object.entries(limit)) for (let i = 0; i < (RECIPES[name].n || 1); i++) {
    const R = RECIPES[name], c = render(name, i)[0];
    assert.ok(c.length / (SR * (R.rate || 1)) <= secs, `${name}#${i}: ${c.length / (SR * (R.rate || 1))} s`);
  }
});

test('a stomp is unmistakably not its stalking step: longer, deeper, and put down harder', () => {
  const avg = (name, f) => { let t = 0; for (let i = 0; i < 4; i++) t += f(render(name, i)[0], Math.round(SR * (RECIPES[name].rate || 1))); return t / 4; };
  const tail = (c, sr) => rmsOf(c.subarray(Math.floor(0.2 * sr), Math.min(c.length, Math.floor(0.35 * sr))));
  assert.ok(avg('crStomp', brightness) < avg('crStep', brightness) * 0.75, 'deeper');
  assert.ok(avg('crStomp', tail) > avg('crStep', tail) * 3, 'rings on after the step has gone');
  assert.ok(render('crStomp')[0].length / (SR * 0.5) > 2 * render('crStep')[0].length / SR, 'longer');
});

test('the pump starts no nodes until it runs, then adds none per frame, and cannot be left playing', () => {
  const {e, s, c, made} = filled();
  const before = made.length;
  for (let i = 0; i < 100; i++) { c.currentTime += 1 / 60; s.pump(5, 5, 0); }
  assert.equal(made.length, before, 'nothing until level > 0');
  assert.equal(s.pumping, null);
  c.currentTime += 1 / 60; s.pump(5, 5, 0.5);
  const after = made.length, P = s.pumping, pos = P.pos;
  assert.ok(after > before);
  for (let i = 0; i < 300; i++) { c.currentTime += 1 / 60; s.pump(5 + i, 5, 1); }
  assert.equal(made.length, after, 'no nodes per frame');
  assert.equal(P.pos, pos, 'the same place object');
  // every update schedules its own end, in case the frames stop
  const [[v], [rest, at]] = P.out.gain.queued;
  assert.ok(v > 0, 'running');
  assert.equal(rest, 0);
  assert.ok(at > c.currentTime);
  // running hard it drowns the world, without drowning itself
  assert.ok(e.world.gain.queued[0][0] < 0.6);
  assert.equal(e.world.gain.queued[1][0], 1, 'and the world comes back on its own');
  assert.ok(P.pan.outs.includes(e.ears));
  c.currentTime += 1; s.pump(5, 5, 0);
  assert.equal(P.out.gain.queued[0][0], 0);
  assert.equal(e.world.gain.queued[0][0], 1);
});

test('panting: silent at 0, adds no nodes between breaths, and quicker the more winded you are', () => {
  const {s, c, made, started} = filled();
  const run = (level, secs) => { const n = started(); for (let i = 0; i < secs * 60; i++) { c.currentTime += 1 / 60; s.pant(level); } return started() - n; };
  const before = made.length;
  assert.equal(run(0, 2), 0);
  assert.equal(made.length, before, 'nothing made at 0');
  const hard = run(1, 12), light = run(0.2, 12);
  assert.ok(hard > light * 1.5, `${hard} breaths against ${light}`);
  assert.ok(hard >= 25 && hard <= 45, `${hard} breaths in 12 s`);
  const busMade = made.length;
  assert.equal(run(0, 3), 0, 'stops at 0');
  assert.equal(s.panting.bus.gain.queued.at(-1)[0], 0, 'and what is in flight fades');
  assert.equal(made.length, busMade);
});

test('a sound not rendered yet plays nothing, and moves up the queue', () => {
  const {e, s, made} = fakeAudio();
  s.start();
  for (const fn of [() => s.stoneHit(1, 1, 1), () => s.clicks(1, 1, 0, true), () => s.clicks(1, 1, 0, 'short'), () => s.gallop(1, 1, 0), () => s.mimic('steps', 1, 1, 0), () => s.mimic('ping', 1, 1, 0), () => s.throwStone(), () => s.gasp(), () => s.caught(), () => s.distant('drip', 0.5)]) fn();
  for (let i = 0; i < 20; i++) { s.pant(1); s.pump(1, 1, 1); s.heart(1, 1); s.setBreath(1, 1, 1); }
  assert.equal(made.filter(n => n.kind === 'src' && n.started && n.buffer !== e.noiseBuf).length, 0, 'nothing from the bank playing yet');
  s.stoneHit(1, 1, 1);
  assert.ok(s.bank.queue.indexOf('stoneHit') === 1, 'what was asked for moves up');
  s.bank.fillNow();
  assert.ok(s.pumping.beat && s.pumping.drone, 'the pump picks its loops up when they arrive');
  assert.ok(s.bank.queue === null);
});

test('the bank renders in a worker, and carries on by itself if the worker fails', async t => {
  const ctx = {sampleRate: SR, createBuffer: (nc, len, sr) => { const ch = Array.from({length: nc}, () => new Float32Array(len)); return {numberOfChannels: nc, length: len, sampleRate: sr, getChannelData: k => ch[k]}; }};
  const until = async f => { for (let i = 0; i < 2000 && !f(); i++) await new Promise(r => setTimeout(r, 2)); assert.ok(f(), 'never got there'); };
  const names = ['drip', 'stoneTick'], done = b => b.queue === null && names.every(n => b.cache.get(n)?.length === RECIPES[n].n);
  t.after(() => { delete globalThis.Worker; });
  // a good worker
  let jobs = 0;
  globalThis.Worker = class { postMessage({name, i, sr}) { jobs++; setImmediate(() => this.onmessage({data: {name, i, ch: renderVariant(RECIPES[name], name, i, sr)}})); } terminate() { this.gone = true; } };
  const good = new Bank(ctx, RECIPES);
  good.prefill(names, 'source');
  const w = good.worker;
  assert.ok(w);
  await until(() => done(good));
  assert.equal(jobs, RECIPES.drip.n + RECIPES.stoneTick.n);
  assert.ok(w.gone, 'and is let go when it is done');
  const here = new Bank(ctx, RECIPES).all('drip')[1].getChannelData(0);
  assert.deepEqual(good.cache.get('drip')[1].getChannelData(0), here, 'it makes the same sounds');
  // one that cannot be made
  globalThis.Worker = class { constructor() { throw new Error('blocked'); } };
  const blocked = new Bank(ctx, RECIPES);
  blocked.prefill(names, 'source');
  assert.equal(blocked.worker, null);
  await until(() => done(blocked));
  // one that errors after it has started
  globalThis.Worker = class { postMessage() { setImmediate(() => this.onerror(new Event('error'))); } terminate() {} };
  const broken = new Bank(ctx, RECIPES);
  broken.prefill(names, 'source');
  await until(() => done(broken));
  // and one that never answers
  t.mock.timers.enable({apis: ['setTimeout']});
  globalThis.Worker = class { postMessage() {} terminate() { this.gone = true; } };
  const mute = new Bank(ctx, RECIPES);
  mute.prefill(names, 'source');
  const m = mute.worker;
  t.mock.timers.tick(5000);
  assert.ok(m.gone && mute.worker === null, 'gives up on it');
  for (let i = 0; i < 40 && !done(mute); i++) t.mock.timers.tick(100);
  assert.ok(done(mute));
  t.mock.timers.reset();
});

test('the worker bundles on its own, with nothing from the page in it', async () => {
  const {outputFiles} = await build({entryPoints: ['src/audio/worker.js'], bundle: true, format: 'iife', write: false, minify: true, target: ['es2020', 'chrome90', 'safari14']});
  const self = {postMessage(m, transfer) { self.sent = m; self.transfer = transfer; }};
  new Function('self', outputFiles[0].text)(self);
  self.onmessage({data: {name: 'drip', i: 2, sr: SR}});
  assert.equal(self.sent.name, 'drip');
  assert.deepEqual(self.sent.ch[0], render('drip', 2)[0]);
  assert.equal(self.transfer[0], self.sent.ch[0].buffer);
});

test('round a corner a sound is lower and dull, but the room still rings', () => {
  const {s} = fakeAudio();
  const open = s.at(0, -5, 0, 1), corner = s.at(0, -5, 0.85, 1), part = s.at(0, -5, 0.4, 1);
  assert.ok(Math.abs(20 * Math.log10(corner.g / open.g) + 6) < 0.5, 'about 6 dB down');
  assert.equal(open.occ, 0);
  assert.ok(corner.occ < 800 && part.occ > corner.occ && part.occ < 4000, `${part.occ} then ${corner.occ} Hz`);
  assert.ok(corner.g * corner.rev >= open.g * open.rev, 'as much of it in the room');
  assert.ok(s.at(0, -5, 0.9, 1).occ === corner.occ, 'unreachable (0.9) is the same as the most');
});

test('placed voices sit at world points and the listener follows your head', () => {
  const {e, s, c, made} = filled();
  const L = e.listener;
  L.x = 10; L.z = 20; L.yaw = Math.PI / 2;
  s.groan(10, 12, 0); // 8 m to the left of you, facing +x
  const p = made.filter(n => n.kind === 'panner').at(-1);
  assert.ok(Math.abs(p.positionX.value - 10) < 1e-6 && Math.abs(p.positionZ.value - 12) < 1e-6, 'at the world point');
  s.updateAmbient(0, 0);
  const A = c.listener;
  assert.equal(A.positionX.value, 10); assert.equal(A.positionZ.value, 20);
  assert.ok(Math.abs(A.forwardX.value - 1) < 1e-9 && Math.abs(A.forwardZ.value) < 1e-9);
  // older browsers have only the setter methods
  const said = [], old = filled({setPosition: (...a) => said.push(a), setOrientation: (...a) => said.push(a)});
  old.e.listener.x = 3; old.e.listener.yaw = 0.5;
  old.s.updateAmbient(0, 0);
  assert.deepEqual(said[0], [3, 0, 0]);
  assert.ok(Math.abs(said[1][0] - Math.sin(0.5)) < 1e-9 && said[1][4] === 1);
  old.s.updateAmbient(0, 0);
  assert.equal(said.length, 2, 'and is not told again if you have not moved');
});

test('each level has its own room, made once', () => {
  const {e, s} = fakeAudio();
  e.applyRoom();
  const irOf = id => { s.setPlace(id); e.applyRoom(); return e.rev.buffer; };
  const sub = e.rev.buffer;
  assert.equal(sub.length, Math.floor(SR * 3.2), 'the tunnels by default');
  const rooms = ['intake', 'cistern', 'shaft', 'pumphall'].map(irOf);
  assert.equal(new Set([sub, ...rooms]).size, 5);
  assert.ok(rooms[0].length < sub.length && rooms[1].length > sub.length && rooms[3].length > rooms[1].length);
  for (const ir of rooms) for (let k = 0; k < 2; k++) assert.ok(ir.getChannelData(k).every(Number.isFinite));
  assert.equal(irOf('intake'), rooms[0], 'kept');
  assert.equal(irOf('no such place'), sub, 'an unknown level sounds like the tunnels');
});

test('pausing always asks, because `state` lags a request still in flight', () => {
  const {e, c} = fakeAudio();
  e.suspend(true); e.suspend(false); // still `running` as far as the context has said
  assert.deepEqual(c.calls, ['suspend', 'resume']);
  c.state = 'interrupted'; e.init();
  assert.equal(c.calls.at(-1), 'resume');
});

test('the dread cannot be left playing when the frames stop', () => {
  const {s} = filled();
  s.setDread(1);
  const q = s.dread.rumble.gain.queued;
  assert.ok(q[0][0] > 0.2);
  assert.deepEqual([q[1][0], q[1][1] > 1], [0, true]);
});

test('the tracker: a dry tick and a short tail on its ping, and rising, quickening returns', () => {
  const tickDur = render('trkTick')[0].length / SR, pingDur = render('trkPing')[0].length / SR;
  assert.ok(tickDur <= 0.06, `tick ${tickDur}`); assert.ok(pingDur <= 0.36, `ping ${pingDur}`);
  const {s, made} = filled();
  const pings = close => { const before = made.length; s.trackerReturn(close, 0); return made.slice(before).filter(n => n.kind === 'src'); };
  const [far, mid, near] = [pings(0), pings(0.5), pings(1)];
  assert.ok(far.length < mid.length && mid.length < near.length, `${far.length}, ${mid.length}, ${near.length} before the next pulse`);
  const rate = n => n[0].playbackRate.value;
  assert.ok(rate(far) < rate(mid) && rate(mid) < rate(near), 'pitch climbs');
});

test('the tracker keeps the names and caption the game knows it by', () => {
  const {s, started} = filled(), told = [];
  s.onSound = k => told.push(k);
  for (const fn of ['trackerPulse', 'trackerBoot', 'trackerDead']) { const n = started(); s[fn](); assert.equal(started(), n + 1, fn); }
  s.trackerFrantic();
  assert.ok(told.includes('tracker'), 'the caption still fires');
});

