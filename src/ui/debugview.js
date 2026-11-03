// F3 in #debug mode: the creature's reasoning, as text and a heat map of where it believes you are.
// Only ever created in #debug, and it asks the session for nothing it might not have.

const EVERY = 0.12; // seconds between redraws: fast enough to watch, and it never costs a frame

/** A value on one short line: floats to two places, nested things as tight JSON. */
export function brainValue(v) {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (v && typeof v === 'object') return JSON.stringify(v, (k, x) => (typeof x === 'number' && !Number.isInteger(x) ? +x.toFixed(2) : x));
  return String(v);
}

/** brainDebug()'s object as lines of text. */
export function brainText(obj) {
  if (obj == null) return 'brain: nothing to report';
  if (typeof obj !== 'object') return String(obj);
  return Object.entries(obj).map(([k, v]) => k + ': ' + brainValue(v)).join('\n');
}

/**
 * Belief 0..1 to a colour: one hue, the scanner's teal, dark to bright, so more belief always reads as
 * more light. Written into `data` at byte offset `o`.
 */
export function heatPixel(v, data, o) {
  const t = v > 0 ? (v < 1 ? v : 1) : 0;
  const k = t < 0.7 ? t / 0.7 : 1, w = t < 0.7 ? 0 : (t - 0.7) / 0.3;
  data[o] = 4 + (57 - 4) * k + (214 - 57) * w;
  data[o + 1] = 16 + (211 - 16) * k + (255 - 211) * w;
  data[o + 2] = 15 + (196 - 15) * k + (248 - 196) * w;
  data[o + 3] = 255;
}

export class BrainView {
  constructor(stage) {
    this.on = false;
    this.t = 0;
    const box = this.box = document.createElement('div');
    box.id = 'brain';
    box.hidden = true;
    this.text = document.createElement('pre');
    this.map = document.createElement('canvas');
    this.map.hidden = true;
    box.append(this.map, this.text);
    stage.append(box);
    addEventListener('keydown', e => {
      if (e.code !== 'F3') return;
      e.preventDefault(); // otherwise the browser's find bar opens
      if (!e.repeat) this.toggle();
    });
  }

  toggle() {
    this.on = !this.on;
    this.box.hidden = !this.on;
    this.t = 0;
  }

  update(session, dt) {
    if (!this.on || (this.t -= dt) > 0) return;
    this.t = EVERY;
    let text;
    try {
      text = !session ? 'brain: no session'
        : typeof session.brainDebug !== 'function' ? 'brain: session.brainDebug() is not there yet'
          : brainText(session.brainDebug());
      this.drawMap(typeof session?.beliefMap === 'function' ? session.beliefMap() : null);
    } catch (e) {
      text = 'brain: ' + e.message; // a slip in the thing being watched must not stop the game
    }
    if (text !== this.last) { this.last = text; this.text.textContent = text; }
  }

  drawMap(m) {
    const c = this.map;
    if (!m || !(m.w > 0) || !(m.h > 0) || !m.cells) { c.hidden = true; return; }
    c.hidden = false;
    if (c.width !== m.w || c.height !== m.h) {
      c.width = m.w; c.height = m.h;
      const k = Math.max(1, Math.min(4, Math.floor(180 / Math.max(m.w, m.h))));
      c.style.width = m.w * k + 'px'; c.style.height = m.h * k + 'px';
      this.img = c.getContext('2d').createImageData(m.w, m.h);
    }
    const d = this.img.data, n = m.w * m.h;
    for (let i = 0; i < n; i++) heatPixel(m.cells[i], d, i * 4);
    c.getContext('2d').putImageData(this.img, 0, 0);
  }
}
