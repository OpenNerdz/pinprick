// The end-of-level debrief: a grade, and what the creature found out. Everything is optional, because
// older callers and saved games may pass nothing at all.

// Rough time to clear each level without dawdling. These are estimates from the size of the maps; a
// level can set `par` (seconds) on its definition instead.
const PAR = {intake: 240, sublevel: 420, cistern: 360, shaft: 420, pumphall: 600}; // about 2.5x a careful bot that knows the map
const DEFAULT_PAR = 480;
const DIFF_BONUS = {easy: -6, normal: 0, hard: 6};

const GRADES = [
  [94, 'S', 'It never knew you were there'],
  [80, 'A', 'A rumour in the dark'],
  [64, 'B', 'It knows your footsteps'],
  [46, 'C', 'It knows your name'],
  [-Infinity, 'D', 'It let you leave'],
];

const count = v => (Number.isFinite(v) && v > 0 ? v : 0);

export function parFor(def) { return count(def?.par) || PAR[def?.id] || DEFAULT_PAR; }

/**
 * 0..100 from time against par, how often it caught you and how many close calls you had. Finishing
 * under par earns only a little: a careful, slow run should beat a lucky, fast one.
 */
export function gradeRun({time, par = DEFAULT_PAR, deaths, closeCalls, difficulty} = {}) {
  let score = 100;
  if (Number.isFinite(time) && par > 0) {
    const over = time / par - 1;
    score -= over > 0 ? Math.min(30, over * 30) : Math.max(-4, over * 10);
  }
  score -= Math.min(54, count(deaths) * 16);
  score -= Math.min(18, count(closeCalls) * 3);
  score += DIFF_BONUS[difficulty] || 0;
  score = Math.max(0, Math.min(100, score));
  const [, letter, word] = GRADES.find(g => score >= g[0]);
  return {score: Math.round(score), letter, word};
}

/** The optional stats that this run actually reports, as [label, value]. */
export function debriefRows(stats) {
  const rows = [];
  const add = (label, v) => { if (Number.isFinite(v)) rows.push([label, String(Math.max(0, Math.round(v)))]); };
  add('It heard you', stats?.heard);
  add('Close calls', stats?.closeCalls);
  add('Hid', stats?.hides);
  return rows;
}

/** What it learned from you, cleaned up for the list: short strings only, no repeats. */
export function learnedLines(stats, max = 6) {
  const out = [];
  for (const s of Array.isArray(stats?.learned) ? stats.learned : []) {
    if (typeof s === 'string' && s.trim() && !out.includes(s.trim())) out.push(s.trim());
  }
  return out.slice(0, max);
}
