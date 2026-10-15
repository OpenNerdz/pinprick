// Minimal column-major 4x4 matrix helpers (WebGL layout), allocation-free where it matters.

export const mat4 = () => { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };

export function identity(m) { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; return m; }

/** out = a * b */
export function multiply(out, a, b) {
  const r = mat4.tmp || (mat4.tmp = new Float32Array(16));
  for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) {
    r[c * 4 + rr] = a[rr] * b[c * 4] + a[4 + rr] * b[c * 4 + 1] + a[8 + rr] * b[c * 4 + 2] + a[12 + rr] * b[c * 4 + 3];
  }
  out.set(r);
  return out;
}

const T = new Float32Array(16);
function apply(m, fill) { identity(T); fill(T); return multiply(m, m, T); }

export const translate = (m, x, y, z) => apply(m, t => { t[12] = x; t[13] = y; t[14] = z; });
export const scale = (m, x, y, z) => apply(m, t => { t[0] = x; t[5] = y; t[10] = z; });
export const rotateX = (m, a) => apply(m, t => { const c = Math.cos(a), s = Math.sin(a); t[5] = c; t[6] = s; t[9] = -s; t[10] = c; });
export const rotateY = (m, a) => apply(m, t => { const c = Math.cos(a), s = Math.sin(a); t[0] = c; t[2] = -s; t[8] = s; t[10] = c; });
export const rotateZ = (m, a) => apply(m, t => { const c = Math.cos(a), s = Math.sin(a); t[0] = c; t[1] = s; t[4] = -s; t[5] = c; });

/** Transform a point by m, writing into out ([x, y, z]). */
export function transformPoint(out, m, x, y, z) {
  out[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
  out[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
  out[2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  return out;
}
