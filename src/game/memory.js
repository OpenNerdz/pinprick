// What the creature has learned about you, kept between levels and between runs. It watches how you
// survive and counters it: hide in the same place twice and it remembers the place; pin it with your light
// and it starts coming through the other door; freeze every time it clicks and it starts clicking twice.
//
// Habits are scores that go up when it sees you do something and fade a little each level, so if you change
// how you play it forgets the old you. In the browser they are saved under `pinprick.v2.memory`; elsewhere
// (tests, tools) a Memory starts blank and is never written anywhere.

import {load, save} from '../util/storage.js';

const KEY = 'memory';
const FADE = 0.85;      // habits kept from one level to the next
const HEAT_FADE = 0.7;  // ... and the map of where it has heard you, from one play of a level to the next
const HEAT_CELL = 4;    // metres per square of that map

/** How fast each habit sinks in (higher: takes longer), and what the player is told once it has. */
const HABITS = {
  hide:    {scale: 3, lesson: 'It has learned that you hide.'},
  beam:    {scale: 4, lesson: 'It is getting used to your light. It comes the other way now.'},
  run:     {scale: 5, lesson: 'It has learned that you run. It cuts you off now.'},
  crawl:   {scale: 2, lesson: 'It knows where the crawls come out.'},
  tracker: {scale: 4, lesson: 'It has learned to stand still for your tracker.'},
  stone:   {scale: 2, lesson: 'It no longer falls for thrown stones.'},
  freeze:  {scale: 5, lesson: 'It knows you freeze when it clicks. It clicks twice now.'},
};

const blank = () => ({v: 1, habits: {}, levels: {}});

export class Memory {
  /** `data` is a saved memory, or nothing for a creature that has never met you. */
  constructor(data = null, persist = false) {
    this.data = data && data.v === 1 ? data : blank();
    this.persist = persist;
    this.told = new Set();   // lessons already shown in this session
    this.fresh = [];         // habits that have newly sunk in, most recent last
    this.level = null; this.lv = null; this.cols = 0; this.rows = 0;
  }

  /** The memory saved in this browser. Outside a browser, a blank one that saves nothing. */
  static saved() {
    if (typeof document === 'undefined') return new Memory();
    return new Memory(load(KEY, blank()), true);
  }

  /** Start a level: habits fade a little, and the map of where it has heard you here comes back. */
  /** `fade` is for a new visit: picking a saved run back up is the same visit, so nothing is forgotten. */
  enter(levelId, cols, rows, fade = true) {
    this.level = levelId; this.cols = cols; this.rows = rows;
    const {data} = this;
    if (fade) for (const k of Object.keys(data.habits)) data.habits[k] *= FADE;
    const lv = this.lv = data.levels[levelId] || (data.levels[levelId] = {heat: [], hides: {}});
    if (lv.heat.length !== cols * rows) lv.heat = new Array(cols * rows).fill(0);
    if (fade) for (let i = 0; i < lv.heat.length; i++) lv.heat[i] *= HEAT_FADE;
  }

  /** 0 (it has never seen you do this) .. 1 (it knows this about you). */
  weight(k) { return 1 - Math.exp(-(this.data.habits[k] || 0) / (HABITS[k]?.scale ?? 4)); }

  /** It saw you do this. Returns true at the moment the habit sinks in. */
  note(k, amount = 1) {
    const before = this.weight(k);
    this.data.habits[k] = (this.data.habits[k] || 0) + amount;
    if (before < 0.5 && this.weight(k) >= 0.5) { this.fresh.push(k); return true; }
    return false;
  }

  /** It heard you here. */
  heard(x, z, amount = 1) {
    const {lv, cols, rows} = this;
    if (!lv) return;
    const cx = Math.floor(x / HEAT_CELL), cz = Math.floor(z / HEAT_CELL);
    if (cx >= 0 && cz >= 0 && cx < cols && cz < rows) lv.heat[cz * cols + cx] = Math.min(999, lv.heat[cz * cols + cx] + amount);
  }

  /** 0..1, how often it has heard you around here compared with the rest of the level. */
  heatAt(x, z) {
    const {lv, cols, rows} = this;
    if (!lv) return 0;
    const cx = Math.floor(x / HEAT_CELL), cz = Math.floor(z / HEAT_CELL);
    if (cx < 0 || cz < 0 || cx >= cols || cz >= rows) return 0;
    let top = 1;
    for (const v of lv.heat) if (v > top) top = v;
    return lv.heat[cz * cols + cx] / top;
  }

  /** You used this level's hiding spot number `i` with it on your trail. */
  hideUsed(i) {
    const {lv} = this;
    if (!lv) return false;
    lv.hides[i] = (lv.hides[i] || 0) + 1;
    return this.note('hide');
  }

  hideCount(i) { return this.lv?.hides[i] || 0; }

  /** Everything it has learned, as lines for the end of a level. */
  lessons() {
    const out = [];
    for (const k of Object.keys(HABITS)) if (this.weight(k) >= 0.5) out.push(HABITS[k].lesson);
    return out;
  }

  /** The newest thing it has learned that has not been shown yet, or null. */
  newLesson() {
    while (this.fresh.length) {
      const k = this.fresh.pop();
      if (!this.told.has(k)) { this.told.add(k); return HABITS[k].lesson; }
    }
    return null;
  }

  lessonFor(k) { return HABITS[k]?.lesson ?? null; }

  save() { if (this.persist) save(KEY, this.data); }
}
