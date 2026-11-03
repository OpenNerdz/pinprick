// Full-level playtests: bot personas play every level after the tutorial, start to win or give-up, through
// the real Session with real intents. They only know what a person could perceive (playtest/perception.mjs),
// and an outside observer measures pacing and flags anything stupid the creature does (playtest/metrics.mjs).
//   node tools/playtest.mjs                                 every persona, level, difficulty; 20 seeds
//   node tools/playtest.mjs --levels cistern --diff hard --persona careful,fighter --seeds 40
//   node tools/playtest.mjs --src /some/tree --out old.json run another copy of the game (its src/, or the dir itself)
//   node tools/playtest.mjs --compare old.json new.json     what changed, and whether it is more than noise
//   node tools/playtest.mjs --levels sublevel --diff hard --persona careful --seed-list 3 --trace [--trace-from 40 --trace-to 60]
// Other options: --out f.json, --label txt, --commit sha, --states (time in each creature state),
//   --jobs N, --max-deaths 10, --max-time 1200, --reaction 0.35 (seconds from a sound to acting on it, every persona),
//   --patience 10 (seconds careful stands off with it before creeping away), --deliberate state,state (states
//   that may stand still on purpose, for the camping check)
// The same options and code give the same numbers, whichever --jobs.
import {Worker} from 'node:worker_threads';
import {availableParallelism} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync, readdirSync, statSync, writeFileSync, mkdirSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGame, playRun, resolveSrc, DT} from './playtest/run.mjs';
import {PERSONAS} from './playtest/bots.mjs';
import {aggregate, printCompare, printPathologies, printStates, printTable} from './playtest/report.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const argv = process.argv.slice(2), opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) { (opt._ ||= []).push(a); continue; }
  const k = a.slice(2);
  if (k === 'compare') { opt.compare = [argv[++i], argv[++i]]; continue; }
  if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) opt[k] = argv[++i]; else opt[k] = true;
}
const list = (v, all) => (v && v !== true ? String(v).split(',').map(x => x.trim()).filter(Boolean) : all);

if (opt.compare) {
  const [a, b] = opt.compare.map(f => JSON.parse(readFileSync(f, 'utf8')));
  printCompare(a, b);
  process.exit(0);
}

const srcArg = opt.src && opt.src !== true ? opt.src : join(repo, 'src'), src = resolveSrc(srcArg);
const game = await loadGame(src);
const levels = list(opt.levels, game.LEVELS.slice(1).map(d => d.id));
const diffs = list(opt.diff, ['easy', 'normal', 'hard']);
const personas = list(opt.persona, PERSONAS);
for (const l of levels) if (!game.LEVELS.some(d => d.id === l)) { console.error(`no level ${l}: ${game.LEVELS.map(d => d.id).join(', ')}`); process.exit(2); }
for (const p of personas) if (!PERSONAS.includes(p)) { console.error(`no persona ${p}: ${PERSONAS.join(', ')}`); process.exit(2); }
const seeds = opt['seed-list'] && opt['seed-list'] !== true ? String(opt['seed-list']).split(',').map(Number)
  : Array.from({length: Math.max(1, +opt.seeds || 20)}, (_, i) => (+opt.seed0 || 1) + i);
const runOpts = {maxDeaths: +opt['max-deaths'] || 10, maxTime: +opt['max-time'] || 1200, deliberate: list(opt.deliberate, [])};
if (opt.reaction && opt.reaction !== true) runOpts.reaction = +opt.reaction;
if (opt.patience && opt.patience !== true) runOpts.patience = +opt.patience;

// a trace plays one run here and prints it tick by tick
if (opt.trace) {
  for (const l of levels) for (const d of diffs) for (const p of personas) for (const seed of seeds) {
    console.log(`# ${l} ${d} ${p} seed ${seed}   columns: t mode me x,z flags(Crouch Sprint Fire Tracker Hidden) still cores | true creature state x,z pathdist | heard this tick`);
    const r = playRun(game, {level: l, diff: d, persona: p, seed}, {...runOpts, trace: line => console.log(line),
      traceFrom: +opt['trace-from'] || 0, traceTo: +opt['trace-to'] || Infinity, traceEvery: +opt['trace-every'] || 1});
    console.log(`# ${r.outcome} t=${r.time} deaths=${r.deaths} hunts=${r.hunts} escapes=${r.escapes} repels=${r.repels} enc=${r.encounters} modes ${JSON.stringify(r.bot.modes)}`);
    for (const q of r.pathologies) console.log(`# ${q.type} t=${q.t}: ${q.detail}`);
  }
  process.exit(0);
}

const tasks = [];
for (const level of levels) for (const diff of diffs) for (const persona of personas) for (const seed of seeds) tasks.push({level, diff, persona, seed});
const jobs = Math.min(tasks.length, Math.max(1, +opt.jobs || Math.max(1, availableParallelism() - 2)));
const started = Date.now(), results = [], errors = [];

await new Promise(done => {
  let next = 0, live = jobs;
  for (let w = 0; w < jobs; w++) {
    const worker = new Worker(join(here, 'playtest/worker.mjs'), {workerData: {src, opts: runOpts}});
    const feed = () => { if (next < tasks.length) worker.postMessage(tasks[next++]); else { worker.terminate(); if (--live === 0) done(); } };
    worker.on('message', m => {
      if (m.error) errors.push(m); else if (!m.ready) results.push(m);
      feed();
    });
    worker.on('error', e => { errors.push({error: String(e && e.stack || e)}); if (next < tasks.length) next++; if (--live === 0) done(); });
  }
});
const wall = (Date.now() - started) / 1000;

// keep rows in a stable order regardless of which worker finished first
const order = t => levels.indexOf(t.level) * 1e8 + diffs.indexOf(t.diff) * 1e6 + personas.indexOf(t.persona) * 1e4 + seeds.indexOf(t.seed);
results.sort((a, b) => order(a) - order(b));
const rows = aggregate(results);

printTable(rows);
if (opt.states) { console.log('\ntime in each creature state, % of its active time'); printStates(rows); }
console.log('\npathologies (st stuck, os oscillation, ca camping, uf unfair kill, im impossible move, ne never engaged, sf short flee)');
printPathologies(results);
const simulated = results.reduce((a, r) => a + r.T, 0);
console.log(`\n${results.length} runs, ${seeds.length} seeds per row, ${Math.round(simulated / 60)} sim-minutes in ${wall.toFixed(1)} s on ${jobs} threads`);
if (errors.length) { console.log(`${errors.length} RUNS CRASHED. First: ${errors[0].level} ${errors[0].diff} ${errors[0].persona} seed ${errors[0].seed}\n${String(errors[0].error).split('\n').slice(0, 4).join('\n')}`); process.exitCode = 1; }

if (opt.out && opt.out !== true) {
  const hash = createHash('sha1');
  const walk = d => { for (const f of readdirSync(d).sort()) { const q = join(d, f); if (statSync(q).isDirectory()) walk(q); else if (f.endsWith('.js')) hash.update(readFileSync(q)); } };
  walk(src);
  let commit = opt.commit && opt.commit !== true ? String(opt.commit) : null, dirty = null;
  if (!commit) {
    const marker = join(src, '..', 'COMMIT');
    if (existsSync(marker)) commit = readFileSync(marker, 'utf8').trim();
    else if (src === join(repo, 'src')) {
      try { commit = execFileSync('git', ['rev-parse', 'HEAD'], {cwd: repo, encoding: 'utf8'}).trim(); dirty = !!execFileSync('git', ['status', '--porcelain', 'src'], {cwd: repo, encoding: 'utf8'}).trim(); } catch {}
    }
  }
  const meta = {label: opt.label && opt.label !== true ? String(opt.label) : null, commit, dirtySrc: dirty, srcHash: hash.digest('hex').slice(0, 12), src, node: process.version,
    seeds: seeds.length, seedList: seeds, levels, diffs, personas, dt: DT, ...runOpts, wallSeconds: Math.round(wall * 10) / 10, simMinutes: Math.round(simulated / 60), jobs, errors: errors.length, date: new Date().toISOString()};
  mkdirSync(dirname(resolve(opt.out)), {recursive: true});
  writeFileSync(opt.out, JSON.stringify({meta, rows, runs: results.map(({pathologies, gaps, ...r}) => ({...r, gaps, pathologies}))}));
  console.log(`wrote ${opt.out}`);
}
process.exit(process.exitCode || 0);
