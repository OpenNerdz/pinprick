// One run: one bot, one level, one difficulty, one seed, through the real Session from the first frame
// to a win or giving up. Fully deterministic: the game's few Math.random calls (ray scatter) are seeded here.
import {resolve, join} from 'node:path';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {Perception, makeStubs} from './perception.mjs';
import {Observer} from './metrics.mjs';
import {makeBot, REACTION} from './bots.mjs';

export const DT = 1 / 30;
const VIEW = {w: 400, h: 800, lensX: 0.2, lensY: -0.6};
const STILL = {moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false};

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(str, h = 2166136261) { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

/** Accepts a source tree's `src` directory or the directory holding it. */
export function resolveSrc(dir) {
  const d = resolve(dir);
  if (existsSync(join(d, 'src/game/session.js'))) return join(d, 'src');
  if (existsSync(join(d, 'game/session.js'))) return d;
  throw new Error(`no game source under ${d}`);
}

export async function loadGame(srcDir) {
  const base = pathToFileURL(resolveSrc(srcDir) + '/').href;
  const [{LEVELS}, {Session}, {Camera}, mem] = await Promise.all([import(base + 'levels/index.js'), import(base + 'game/session.js'), import(base + 'render/camera.js'),
    import(base + 'game/memory.js').catch(() => ({}))]); // older trees have no memory of you
  return {LEVELS, Session, Camera, Memory: mem.Memory};
}

/**
 * task: {level, diff, persona, seed}; opts: {maxDeaths, maxTime, deliberate, trace: fn(line), traceFrom, traceTo}.
 * The seed picks the same level layout and creature dice whichever persona plays it.
 */
export function playRun(game, task, opts = {}) {
  const {level, diff, persona, seed} = task, {maxDeaths = 10, maxTime = 1200} = opts;
  const def = game.LEVELS.find(d => d.id === level);
  if (!def) throw new Error(`no level ${level}`);

  const realRandom = Math.random;
  Math.random = mulberry(hashStr(`${level}|${diff}|${persona}|${seed}`));

  try {
    const perc = new Perception(mulberry(seed * 2654435761 + 11), {reaction: opts.reaction ?? REACTION[persona]});
    const stubs = makeStubs(perc.input);
    // the creature's memory of you starts blank each run: within a run it learns across deaths, not across runs
    const memory = game.Memory ? {memory: new game.Memory()} : {};
    const s = new game.Session(def, {difficulty: diff, seed, renderer: stubs.renderer, sounds: stubs.sounds, ui: stubs.ui, ...memory});
    perc.attach(s);
    const bot = makeBot(persona, perc, mulberry(seed * 40503 + 7), {patience: opts.patience});
    const obs = new Observer({level, diff, persona, seed}, {deliberate: opts.deliberate || []});
    const st = s.stalker, p = s.player, cam = new game.Camera();
    if (st) {
      const wake = st.wake;
      st.wake = function (...a) { const r = wake.apply(this, a); obs.teleport(T); return r; };
    }
    let T = 0, nextTrace = 0, dist = Infinity, nextDist = 0, outcome = null, hasStones = s.stones !== undefined;
    const distField = new Float32Array(s.playerNav.n);
    const trace = opts.trace, tf = opts.traceFrom ?? 0, tt = opts.traceTo ?? Infinity;

    const sample = () => {
      if (T >= nextDist && st && st.active) {
        nextDist = T + 0.5;
        s.playerNav.field(p.x, p.z, distField);
        dist = s.playerNav.distAt(distField, st.x, st.z, 2.5);
      }
      if (!st) return null;
      return {T, dt: DT, state: st.state, x: st.x, z: st.z, speed: st.speed, pinned: !!st.pinned, deliberate: !!st.deliberate,
        target: st.target, walkable: !st.active || s.nav.walkableAt(st.x, st.z), dist, px: p.x, pz: p.z};
    };

    while (!outcome) {
      perc.refresh(T, DT);
      const it = bot.frame(T, DT);
      s.update(DT, T, it, cam, VIEW);
      T += DT;
      if (s.state === 'won') { outcome = 'won'; break; }
      if (s.state === 'caught') {
        obs.caught({T, state: st.state, pstill: p.still, scanning: s.scanner.active, hidden: p.hidden, warnT: perc.warnT});
        if (trace && T >= tf && T <= tt) trace(`${T.toFixed(1)} CAUGHT by ${st.state} at ${st.x.toFixed(1)},${st.z.toFixed(1)}; me ${p.x.toFixed(1)},${p.z.toFixed(1)} mode=${bot.mode}`);
        perc.input.caughtShown = false;
        for (let k = 0; k < 150 && !perc.input.caughtShown; k++) { s.update(DT, T, STILL, cam, VIEW); T += DT; }
        if (s.deaths >= maxDeaths) { outcome = 'gaveup'; break; }
        s.respawn(); perc.reset(); bot.onRespawn();
        continue;
      }
      if (T > maxTime) { outcome = 'timeout'; break; }
      const f = sample();
      if (f) obs.frame(f);
      if (trace && T >= nextTrace && T >= tf && T <= tt) {
        nextTrace = T + (opts.traceEvery ?? 1);
        const h = perc.heard.map(e => e.kind).join(',');
        trace(`${T.toFixed(1).padStart(6)} ${String(bot.mode).padEnd(13)} me ${p.x.toFixed(1).padStart(5)},${p.z.toFixed(1).padStart(5)} ${p.crouched ? 'C' : '-'}${p.sprinting ? 'S' : '-'}${s.scanner.firing ? 'F' : '-'}${s.hands.trackerUp ? 'T' : '-'}${p.hidden ? 'H' : '-'} still${p.still.toFixed(1).padStart(5)} cores${s.coresLeft} | it ${String(st?.state).padEnd(11)} ${st ? st.x.toFixed(1).padStart(5) + ',' + st.z.toFixed(1).padStart(5) : ''} d${isFinite(dist) ? dist.toFixed(0).padStart(3) : '  ?'} | ${h}`);
      }
    }

    const stats = bot.stats, frames = stats.frames || 1, pct = n => Math.round(1000 * n / frames) / 10;
    return obs.finish({outcome, won: outcome === 'won', T: Math.round(T * 10) / 10, time: Math.round(s.time * 10) / 10,
      coresGot: s.coresGot, coresTotal: s.cores.length, hasStones,
      bot: {sneak: pct(stats.sneak), sprint: pct(stats.sprint), walk: pct(stats.walk), still: pct(stats.still), scan: pct(stats.scan), tracker: pct(stats.tracker), hidden: pct(stats.hidden), throws: stats.throws,
        modes: Object.fromEntries(Object.entries(stats.modes).map(([k, v]) => [k, pct(v)]))}});
  } finally {
    Math.random = realRandom;
  }
}
