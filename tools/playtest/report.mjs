// Turning runs into numbers people can read, and two result files into a table of differences.
import {PATHOLOGIES} from './metrics.mjs';

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
const median = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const sd = a => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
const r1 = v => (v == null ? null : Math.round(v * 10) / 10);
const pctile = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

/** One row per level/difficulty/persona. Everything needed by --compare is in here. */
export function aggregate(runs) {
  const groups = new Map();
  for (const r of runs) {
    const k = `${r.level}/${r.diff}/${r.persona}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  const rows = [];
  for (const [key, rs] of groups) {
    const {level, diff, persona} = rs[0], n = rs.length;
    const wins = rs.filter(r => r.won), active = rs.reduce((a, r) => a + r.activeTime, 0) || 1;
    const stateTime = {};
    for (const r of rs) for (const [k, v] of Object.entries(r.stateTime)) if (k !== 'dormant') stateTime[k] = (stateTime[k] || 0) + v;
    const statePct = Object.fromEntries(Object.entries(stateTime).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r1(100 * v / active)]));
    const counts = Object.fromEntries(PATHOLOGIES.map(p => [p, rs.reduce((a, r) => a + (r.counts[p] || 0), 0)]));
    const deaths = rs.map(r => r.deaths), gaps = rs.flatMap(r => r.gaps), breathers = rs.map(r => r.minBreather).filter(v => v != null);
    const kills = {moving: 0, still: 0, stillNoticed: 0, finale: 0, fast: 0};
    for (const r of rs) for (const k of Object.keys(kills)) kills[k] += r.kills[k] || 0;
    const killStates = {};
    for (const r of rs) for (const [k, v] of Object.entries(r.killStates)) killStates[k] = (killStates[k] || 0) + v;
    rows.push({key, level, diff, persona, n,
      wins: wins.length, winPct: r1(100 * wins.length / n), flawless: rs.filter(r => r.won && !r.deaths).length,
      timeouts: rs.filter(r => r.outcome === 'timeout').length, gaveup: rs.filter(r => r.outcome === 'gaveup').length,
      deaths: r1(mean(deaths)), deathsSd: r1(sd(deaths)), maxDeaths: Math.max(...deaths),
      time: r1(median(rs.map(r => r.time))), winTime: r1(median(wins.map(r => r.time))), timeSd: r1(sd(rs.map(r => r.time))),
      hunts: r1(mean(rs.map(r => r.hunts))), huntsSd: r1(sd(rs.map(r => r.hunts))), escapes: r1(mean(rs.map(r => r.escapes))), repels: r1(mean(rs.map(r => r.repels))),
      encounters: r1(mean(rs.map(r => r.encounters))),
      quiet: r1(median(rs.map(r => r.longestQuiet).filter(v => v != null))), quietMax: r1(Math.max(0, ...rs.map(r => r.longestQuiet ?? 0))),
      breather: r1(median(breathers)), breatherMin: breathers.length ? r1(Math.min(...breathers)) : null,
      gapP10: r1(pctile(gaps, 0.1)), gapP50: r1(pctile(gaps, 0.5)), gapP90: r1(pctile(gaps, 0.9)),
      peaks: r1(mean(rs.map(r => r.peaksPerMin))), peaksSd: r1(sd(rs.map(r => r.peaksPerMin))), pct8: r1(mean(rs.map(r => r.pct8))), pct25: r1(mean(rs.map(r => r.pct25))),
      statePct, counts, kills, killStates,
      bot: {sneak: r1(mean(rs.map(r => r.bot.sneak))), sprint: r1(mean(rs.map(r => r.bot.sprint))), still: r1(mean(rs.map(r => r.bot.still))), scan: r1(mean(rs.map(r => r.bot.scan))), tracker: r1(mean(rs.map(r => r.bot.tracker))), hidden: r1(mean(rs.map(r => r.bot.hidden))), throws: r1(mean(rs.map(r => r.bot.throws)))},
    });
  }
  return rows;
}

const pad = (v, n) => String(v ?? '-').padStart(n);
const padr = (v, n) => String(v ?? '-').padEnd(n);
const pathCell = c => { const s = [['st', c.stuck], ['os', c.oscillation], ['ca', c.camping], ['uf', c.unfair], ['im', c.impossible], ['ne', c.never], ['sf', c.shortflee]].filter(x => x[1]).map(([k, v]) => k + v).join(' '); return s || '.'; };

export function printTable(rows, out = console.log) {
  out(`${padr('level', 9)}${padr('diff', 7)}${padr('persona', 8)}${pad('n', 4)}${pad('win%', 6)}${pad('0dth', 5)}${pad('dth', 6)}${pad('t(s)', 6)}${pad('hunt', 5)}${pad('esc', 5)}${pad('rep', 5)}${pad('enc', 5)}${pad('quiet', 6)}${pad('brth', 6)}${pad('pk/m', 5)}${pad('<8m', 5)}${pad('>25m', 5)}  pathologies`);
  for (const r of rows) out(`${padr(r.level, 9)}${padr(r.diff, 7)}${padr(r.persona, 8)}${pad(r.n, 4)}${pad(r.winPct, 6)}${pad(r.flawless, 5)}${pad(r.deaths, 6)}${pad(Math.round(r.time), 6)}${pad(r.hunts, 5)}${pad(r.escapes, 5)}${pad(r.repels, 5)}${pad(r.encounters, 5)}${pad(r.quiet == null ? null : Math.round(r.quiet), 6)}${pad(r.breather == null ? null : Math.round(r.breather), 6)}${pad(r.peaks, 5)}${pad(Math.round(r.pct8), 5)}${pad(Math.round(r.pct25), 5)}  ${pathCell(r.counts)}`);
}

export function printStates(rows, out = console.log) {
  for (const r of rows) {
    const b = r.bot, k = r.kills;
    out(`${padr(r.level, 9)}${padr(r.diff, 7)}${padr(r.persona, 8)}${Object.entries(r.statePct).map(([s, v]) => `${s} ${Math.round(v)}`).join(' ')} | bot sneak ${Math.round(b.sneak)} sprint ${Math.round(b.sprint)} still ${Math.round(b.still)} scan ${Math.round(b.scan)} trk ${Math.round(b.tracker)} hid ${Math.round(b.hidden)} | kills moving ${k.moving} still ${k.still} stillHunted ${k.stillNoticed} finale ${k.finale} fast ${k.fast}`);
  }
}

/** Totals across rows: how many of each thing, and a few to repro. */
export function printPathologies(runs, out = console.log, top = 3) {
  const tot = {}, list = {};
  for (const r of runs) {
    for (const [k, v] of Object.entries(r.counts)) tot[k] = (tot[k] || 0) + v;
    for (const p of r.pathologies) (list[p.type] ||= []).push(p);
  }
  for (const k of PATHOLOGIES) {
    if (!tot[k]) { out(`${padr(k, 12)} 0`); continue; }
    out(`${padr(k, 12)} ${tot[k]} in ${runs.filter(r => r.counts[k]).length}/${runs.length} runs`);
    for (const p of (list[k] || []).slice(0, top)) out(`  ${p.level} ${p.diff} ${p.persona} seed ${p.seed} t=${p.t}: ${p.detail}`);
  }
}

/** A difference of two proportions, 95%: is it bigger than the noise? */
function propDiff(a, na, b, nb) {
  const p = a / na, q = b / nb, se = Math.sqrt(p * (1 - p) / na + q * (1 - q) / nb) || 1 / Math.sqrt(Math.min(na, nb));
  return {d: 100 * (q - p), sig: Math.abs(q - p) > 1.96 * se};
}
function meanDiff(a, sa, na, b, sb, nb) {
  const se = Math.sqrt((sa ** 2) / Math.max(1, na) + (sb ** 2) / Math.max(1, nb));
  return {d: b - a, sig: se > 0 ? Math.abs(b - a) > 1.96 * se : b !== a};
}
const cell = (o, digits = 1, n = 8) => pad(`${o.d >= 0 ? '+' : ''}${o.d.toFixed(digits)}${o.sig ? '*' : ''}`, n);

/** Print what changed from a to b. `*` marks a difference outside the 95% interval; the rest is noise. */
export function printCompare(A, B, out = console.log) {
  const ma = new Map(A.rows.map(r => [r.key, r]));
  const lab = j => j.meta?.label || j.meta?.commit?.slice(0, 7) || '?';
  out(`a: ${lab(A)}  n/row=${A.meta?.seeds}   b: ${lab(B)}  n/row=${B.meta?.seeds}   * = outside 95% interval; unmarked differences are within noise`);
  out(`${padr('level', 9)}${padr('diff', 7)}${padr('persona', 8)}${pad('n', 4)}${pad('win a>b', 10)}${pad('dwin', 8)}${pad('dth a>b', 11)}${pad('ddth', 8)}${pad('dt(s)', 7)}${pad('dhunt', 8)}${pad('dpk/m', 8)}${pad('d<8m', 6)}${pad('d>25m', 7)}  dpathologies`);
  const groups = new Map();
  for (const b of B.rows) {
    const a = ma.get(b.key);
    if (!a) continue;
    const w = propDiff(a.wins, a.n, b.wins, b.n), dd = meanDiff(a.deaths, a.deathsSd, a.n, b.deaths, b.deathsSd, b.n);
    const hh = meanDiff(a.hunts, a.huntsSd, a.n, b.hunts, b.huntsSd, b.n), pk = meanDiff(a.peaks, a.peaksSd, a.n, b.peaks, b.peaksSd, b.n);
    const path = Object.keys(b.counts).map(k => [k, (b.counts[k] || 0) - (a.counts[k] || 0)]).filter(x => x[1]).map(([k, v]) => `${k.slice(0, 2)}${v > 0 ? '+' : ''}${v}`).join(' ') || '.';
    out(`${padr(b.level, 9)}${padr(b.diff, 7)}${padr(b.persona, 8)}${pad(Math.min(a.n, b.n), 4)}${pad(`${Math.round(a.winPct)}>${Math.round(b.winPct)}`, 10)}${cell(w, 0)}${pad(`${a.deaths}>${b.deaths}`, 11)}${cell(dd)}${pad(Math.round(b.time - a.time), 7)}${cell(hh)}${cell(pk)}${pad(Math.round(b.pct8 - a.pct8), 6)}${pad(Math.round(b.pct25 - a.pct25), 7)}  ${path}`);
    const g = groups.get(b.diff) || groups.set(b.diff, {aw: 0, an: 0, bw: 0, bn: 0, ad: 0, bd: 0}).get(b.diff);
    g.aw += a.wins; g.an += a.n; g.bw += b.wins; g.bn += b.n; g.ad += a.deaths * a.n; g.bd += b.deaths * b.n;
  }
  for (const [diff, g] of groups) {
    const w = propDiff(g.aw, g.an, g.bw, g.bn);
    out(`all ${padr(diff, 7)} n=${g.an}/${g.bn}  win ${Math.round(100 * g.aw / g.an)}% > ${Math.round(100 * g.bw / g.bn)}% (${cell(w, 0, 0)})  deaths/run ${(g.ad / g.an).toFixed(2)} > ${(g.bd / g.bn).toFixed(2)}`);
  }
}
