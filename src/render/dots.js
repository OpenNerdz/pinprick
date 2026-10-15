// The dot cloud: a fixed-size ring buffer of scanner hits. Each dot is 8 floats
// (x, y, z, birth time, r, g, b, size). New dots are uploaded once per frame as one or two
// contiguous ranges, and only the still-visible span is drawn: a small queue of per-frame marks
// records where each frame's dots begin, so expired frames drop off the front.

export const STRIDE = 8;

export class DotBuffer {
  constructor(capacity) {
    this.cap = capacity;
    this.data = new Float32Array(capacity * STRIDE);
    this.written = 0;          // total dots ever written (monotonic)
    this.flushed = 0;          // dots already uploaded to the GPU
    this.total = 0;            // dots thrown this run, for the end screen
    this.markT = new Float64Array(8192);
    this.markW = new Float64Array(8192);
    this.markHead = 0; this.markTail = 0;
  }

  clear() {
    this.written = 0; this.flushed = 0; this.total = 0;
    this.markHead = this.markTail = 0;
  }

  push(x, y, z, t, r, g, b, size) {
    const o = (this.written % this.cap) * STRIDE, d = this.data;
    d[o] = x; d[o + 1] = y; d[o + 2] = z; d[o + 3] = t;
    d[o + 4] = r; d[o + 5] = g; d[o + 6] = b; d[o + 7] = size;
    this.written++; this.total++;
  }

  /** Close the current frame: remember where its dots start. Returns the range needing upload. */
  endFrame(t) {
    const from = this.flushed, to = this.written;
    if (to > from) {
      const n = this.markT.length, last = (this.markHead - 1 + n) % n;
      if (this.markHead !== this.markTail && this.markT[last] === t) { /* same frame, already marked */ }
      else {
        this.markT[this.markHead] = t; this.markW[this.markHead] = from;
        this.markHead = (this.markHead + 1) % n;
        if (this.markHead === this.markTail) this.markTail = (this.markTail + 1) % n; // drop oldest mark
      }
    }
    this.flushed = to;
    return [Math.max(from, to - this.cap), to];
  }

  /** First still-visible dot (as a monotonic index) for dots that live `life` seconds. */
  oldestLive(t, life) {
    const n = this.markT.length;
    while (this.markTail !== this.markHead) {
      const next = (this.markTail + 1) % n;
      // the tail frame is dead once its time is past; its dots end where the next frame starts
      if (this.markT[this.markTail] <= t - life) {
        if (next === this.markHead) { this.markTail = next; break; }
        this.markTail = next;
      } else break;
    }
    if (this.markTail === this.markHead) return this.written;
    return Math.max(this.markW[this.markTail], this.written - this.cap);
  }
}
