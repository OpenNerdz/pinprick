// Shared helpers for the hand-held devices' geometry. Space is metres: +x right, +y up, -z forward.
// Each vertex is 9 floats: position, normal, uv, material. On anything but a screen, uv.x says how worn
// that spot is: 1 on a chamfer, where paint rubs off and the edge catches the light, 0 on a flat.

export const MESH_STRIDE = 9;

// A cut-plate alphabet on a 3 x 5 grid: bars of [x, y, w, h]. Only the letters the devices wear.
const GLYPHS = {
  A: [[0, 0, 1, 5], [2, 0, 1, 5], [1, 4, 1, 1], [1, 2, 1, 1]],
  C: [[0, 0, 1, 5], [1, 4, 2, 1], [1, 0, 2, 1]],
  D: [[0, 0, 1, 5], [1, 4, 1, 1], [1, 0, 1, 1], [2, 1, 1, 3]],
  E: [[0, 0, 1, 5], [1, 4, 2, 1], [1, 2, 1, 1], [1, 0, 2, 1]],
  F: [[0, 0, 1, 5], [1, 4, 2, 1], [1, 2, 1, 1]],
  G: [[0, 0, 1, 5], [1, 4, 2, 1], [1, 0, 2, 1], [2, 1, 1, 2]],
  I: [[0, 0, 1, 5]],
  K: [[0, 0, 1, 5], [1, 2, 1, 1], [2, 3, 1, 2], [2, 0, 1, 2]],
  L: [[0, 0, 1, 5], [1, 0, 2, 1]],
  M: [[0, 0, 1, 5], [2, 0, 1, 5], [4, 0, 1, 5], [1, 4, 1, 1], [3, 4, 1, 1]],
  N: [[0, 0, 1, 5], [3, 0, 1, 5], [1, 3, 1, 1], [2, 2, 1, 1]],
  O: [[0, 0, 1, 5], [2, 0, 1, 5], [1, 4, 1, 1], [1, 0, 1, 1]],
  P: [[0, 0, 1, 5], [1, 4, 1, 1], [1, 2, 1, 1], [2, 2, 1, 3]],
  R: [[0, 0, 1, 5], [1, 4, 1, 1], [1, 2, 1, 1], [2, 3, 1, 2], [2, 0, 1, 2]],
  S: [[0, 2, 1, 3], [1, 4, 2, 1], [1, 2, 1, 1], [2, 0, 1, 2], [0, 0, 2, 1]],
  T: [[0, 4, 3, 1], [1, 0, 1, 4]],
  U: [[0, 0, 1, 5], [2, 0, 1, 5], [1, 0, 1, 1]],
  V: [[0, 1, 1, 4], [2, 1, 1, 4], [1, 0, 1, 1]],
  W: [[0, 0, 1, 5], [2, 0, 1, 5], [4, 0, 1, 5], [1, 0, 1, 1], [3, 0, 1, 1]],
  Y: [[0, 3, 1, 2], [2, 3, 1, 2], [1, 0, 1, 3]],
  0: [[0, 0, 1, 5], [2, 0, 1, 5], [1, 4, 1, 1], [1, 0, 1, 1]],
  1: [[0, 0, 1, 5]],
  2: [[0, 4, 3, 1], [2, 2, 1, 2], [0, 2, 2, 1], [0, 0, 1, 2], [1, 0, 2, 1]],
  3: [[0, 4, 2, 1], [0, 2, 2, 1], [0, 0, 2, 1], [2, 0, 1, 5]],
  4: [[0, 2, 1, 3], [1, 2, 1, 1], [2, 0, 1, 5]],
  6: [[0, 0, 1, 5], [1, 4, 2, 1], [1, 2, 1, 1], [1, 0, 1, 1], [2, 0, 1, 3]],
  7: [[0, 4, 2, 1], [2, 0, 1, 5]],
  9: [[0, 2, 1, 3], [1, 4, 1, 1], [1, 2, 1, 1], [2, 0, 1, 5], [0, 0, 2, 1]],
  '-': [[0, 2, 2, 1]],
  '/': [[0, 0, 1, 2], [1, 2, 1, 1], [2, 3, 1, 2]],
  '.': [[0, 0, 1, 1]],
};
const glyphW = ch => GLYPHS[ch].reduce((w, [a, , c]) => Math.max(w, a + c), 0);

/** A triangle soup builder. `done()` returns the vertices as one Float32Array. */
export function meshBuilder() {
  const v = [];
  let paintUv = null; // withUv: lets a part say what its vertices carry instead of wear
  const vert = (p, n, uv, m) => {
    const q = paintUv ? paintUv(p, uv) : uv;
    v.push(p[0], p[1], p[2], n[0], n[1], n[2], q[0], q[1], m);
  };
  const tri = (a, b, c, n, m, ua = [0, 0], ub = [0, 0], uc = [0, 0]) => { vert(a, n, ua, m); vert(b, n, ub, m); vert(c, n, uc, m); };
  const quad = (a, b, c, d, n, m, uv) => {
    const [ua, ub, uc, ud] = uv || [[0, 0], [0, 0], [0, 0], [0, 0]];
    tri(a, b, c, n, m, ua, ub, uc); tri(a, c, d, n, m, ua, uc, ud);
  };

  function box(x0, y0, z0, x1, y1, z1, m) {
    quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], m);
    quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], m);
    quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], m);
    quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], m);
    quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], m);
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], m);
  }

  /** Cylinder along z with smooth sides; caps optional. */
  function cylZ(cx, cy, z0, z1, r, m, seg = 18, capFront = false, capBack = false) {
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      const p00 = [cx + c0 * r, cy + s0 * r, z0], p01 = [cx + c0 * r, cy + s0 * r, z1];
      const p10 = [cx + c1 * r, cy + s1 * r, z0], p11 = [cx + c1 * r, cy + s1 * r, z1];
      vert(p00, [c0, s0, 0], [0, 0], m); vert(p10, [c1, s1, 0], [0, 0], m); vert(p11, [c1, s1, 0], [0, 0], m);
      vert(p00, [c0, s0, 0], [0, 0], m); vert(p11, [c1, s1, 0], [0, 0], m); vert(p01, [c0, s0, 0], [0, 0], m);
      const zf = Math.min(z0, z1), zb = Math.max(z0, z1);
      if (capFront) tri([cx, cy, zf], [cx + c1 * r, cy + s1 * r, zf], [cx + c0 * r, cy + s0 * r, zf], [0, 0, -1], m);
      if (capBack) tri([cx, cy, zb], [cx + c0 * r, cy + s0 * r, zb], [cx + c1 * r, cy + s1 * r, zb], [0, 0, 1], m);
    }
  }

  /** A convex side profile (points [z, y]) extruded across x0..x1, with flat-shaded faces. */
  function extrudeX(profile, x0, x1, m) {
    const n = profile.length;
    const cz = profile.reduce((s, p) => s + p[0], 0) / n, cy = profile.reduce((s, p) => s + p[1], 0) / n;
    for (let i = 0; i < n; i++) {
      const [za, ya] = profile[i], [zb, yb] = profile[(i + 1) % n];
      let ny = -(zb - za), nz = yb - ya;
      const l = Math.hypot(ny, nz); ny /= l; nz /= l;
      if (((za + zb) / 2 - cz) * nz + ((ya + yb) / 2 - cy) * ny < 0) { ny = -ny; nz = -nz; }
      quad([x0, ya, za], [x1, ya, za], [x1, yb, zb], [x0, yb, zb], [0, ny, nz], m);
    }
    for (let i = 1; i < n - 1; i++) {
      const a = profile[0], b = profile[i], c = profile[i + 1];
      tri([x0, a[1], a[0]], [x0, b[1], b[0]], [x0, c[1], c[0]], [-1, 0, 0], m);
      tri([x1, a[1], a[0]], [x1, c[1], c[0]], [x1, b[1], b[0]], [1, 0, 0], m);
    }
  }

  const nrm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
  const WORN = [[1, 0], [1, 0], [1, 0], [1, 0]];

  /** Build a part with its uv worked out per vertex: fn(position, uv) => [u, v]. */
  function withUv(fn, build) { paintUv = fn; build(); paintUv = null; }

  /** A box with every edge chamfered by `b`: flats for the faces, worn strips for the edges. */
  function bevelBox(x0, y0, z0, x1, y1, z1, b, m) {
    const X0 = x0 + b, X1 = x1 - b, Y0 = y0 + b, Y1 = y1 - b, Z0 = z0 + b, Z1 = z1 - b;
    quad([X0, Y0, z1], [X1, Y0, z1], [X1, Y1, z1], [X0, Y1, z1], [0, 0, 1], m);
    quad([X1, Y0, z0], [X0, Y0, z0], [X0, Y1, z0], [X1, Y1, z0], [0, 0, -1], m);
    quad([x0, Y0, Z0], [x0, Y0, Z1], [x0, Y1, Z1], [x0, Y1, Z0], [-1, 0, 0], m);
    quad([x1, Y0, Z1], [x1, Y0, Z0], [x1, Y1, Z0], [x1, Y1, Z1], [1, 0, 0], m);
    quad([X0, y1, Z1], [X1, y1, Z1], [X1, y1, Z0], [X0, y1, Z0], [0, 1, 0], m);
    quad([X0, y0, Z0], [X1, y0, Z0], [X1, y0, Z1], [X0, y0, Z1], [0, -1, 0], m);
    const e = (a, c, d, f, n) => quad(a, c, d, f, n, m, WORN);
    const s = 0.7071;
    e([X0, Y1, z1], [X1, Y1, z1], [X1, y1, Z1], [X0, y1, Z1], [0, s, s]);   // top back
    e([X0, y1, Z0], [X1, y1, Z0], [X1, Y1, z0], [X0, Y1, z0], [0, s, -s]);  // top front
    e([X0, Y0, z1], [X0, y0, Z1], [X1, y0, Z1], [X1, Y0, z1], [0, -s, s]);  // bottom back
    e([X0, Y0, z0], [X1, Y0, z0], [X1, y0, Z0], [X0, y0, Z0], [0, -s, -s]); // bottom front
    e([x0, Y0, Z1], [X0, Y0, z1], [X0, Y1, z1], [x0, Y1, Z1], [-s, 0, s]);  // left back
    e([X0, Y0, z0], [x0, Y0, Z0], [x0, Y1, Z0], [X0, Y1, z0], [-s, 0, -s]); // left front
    e([X1, Y0, z1], [x1, Y0, Z1], [x1, Y1, Z1], [X1, Y1, z1], [s, 0, s]);   // right back
    e([x1, Y0, Z0], [X1, Y0, z0], [X1, Y1, z0], [x1, Y1, Z0], [s, 0, -s]);  // right front
    e([x0, Y1, Z0], [x0, Y1, Z1], [X0, y1, Z1], [X0, y1, Z0], [-s, s, 0]);  // top left
    e([x1, Y1, Z1], [x1, Y1, Z0], [X1, y1, Z0], [X1, y1, Z1], [s, s, 0]);   // top right
    e([x0, Y0, Z1], [x0, Y0, Z0], [X0, y0, Z0], [X0, y0, Z1], [-s, -s, 0]); // bottom left
    e([x1, Y0, Z0], [x1, Y0, Z1], [X1, y0, Z1], [X1, y0, Z0], [s, -s, 0]);  // bottom right
    const c = 0.5774;
    for (const sx of [0, 1]) for (const sy of [0, 1]) for (const sz of [0, 1]) {
      const ax = sx ? x1 : x0, ay = sy ? y1 : y0, az = sz ? z1 : z0, bx = sx ? X1 : X0, by = sy ? Y1 : Y0, bz = sz ? Z1 : Z0;
      tri([ax, by, bz], [bx, ay, bz], [bx, by, az], [sx ? c : -c, sy ? c : -c, sz ? c : -c], m, [1, 0], [1, 0], [1, 0]);
    }
  }

  /** A ring of points around an axis, swept through radii: smooth around, faceted along. axis: 'x' or 'z'. */
  function lathe(axis, c0, c1, profile, m, seg = 16) {
    const at = (s, r, a) => axis === 'z'
      ? [c0 + Math.cos(a) * r, c1 + Math.sin(a) * r, s]
      : [s, c0 + Math.cos(a) * r, c1 + Math.sin(a) * r];
    const around = (ns, nr, a) => axis === 'z' ? [Math.cos(a) * nr, Math.sin(a) * nr, ns] : [ns, Math.cos(a) * nr, Math.sin(a) * nr];
    for (let k = 0; k < profile.length - 1; k++) {
      const [s0, r0] = profile[k], [s1, r1] = profile[k + 1];
      // the slope of this band of the profile: a band whose radius changes faces along the axis a bit
      let ds = s1 - s0, dr = r1 - r0, l = Math.hypot(ds, dr) || 1; ds /= l; dr /= l;
      const ns = -dr, nr = ds >= 0 ? ds : -ds, flip = ds < 0 ? -1 : 1, worn = Math.abs(dr) > 0.3 ? [1, 0] : [0, 0];
      for (let i = 0; i < seg; i++) {
        const a0 = i / seg * Math.PI * 2, a1 = (i + 1) / seg * Math.PI * 2;
        const n0 = around(ns * flip, nr, a0), n1 = around(ns * flip, nr, a1);
        const p00 = at(s0, r0, a0), p01 = at(s1, r1, a0), p10 = at(s0, r0, a1), p11 = at(s1, r1, a1);
        vert(p00, n0, worn, m); vert(p10, n1, worn, m); vert(p11, n1, worn, m);
        vert(p00, n0, worn, m); vert(p11, n1, worn, m); vert(p01, n0, worn, m);
      }
    }
  }

  /** A curved block between two radii and two angles about z: a tab of a rotor. */
  function arcZ(cx, cy, z0, z1, r0, r1, a0, a1, m, seg = 4) {
    const p = (r, a, z) => [cx + Math.cos(a) * r, cy + Math.sin(a) * r, z];
    for (let i = 0; i < seg; i++) {
      const u0 = a0 + (a1 - a0) * i / seg, u1 = a0 + (a1 - a0) * (i + 1) / seg;
      const n0 = [Math.cos(u0), Math.sin(u0), 0], n1 = [Math.cos(u1), Math.sin(u1), 0];
      const a = p(r1, u0, z0), b = p(r1, u1, z0), c = p(r1, u1, z1), d = p(r1, u0, z1);
      vert(a, n0, [0, 0], m); vert(b, n1, [0, 0], m); vert(c, n1, [0, 0], m);
      vert(a, n0, [0, 0], m); vert(c, n1, [0, 0], m); vert(d, n0, [0, 0], m);
      quad(p(r0, u0, z1), p(r0, u1, z1), c, d, [0, 0, 1], m, WORN);
    }
    const s = [Math.sin(a0), -Math.cos(a0), 0], e = [-Math.sin(a1), Math.cos(a1), 0];
    quad(p(r0, a0, z0), p(r0, a0, z1), p(r1, a0, z1), p(r1, a0, z0), s, m);
    quad(p(r0, a1, z0), p(r0, a1, z1), p(r1, a1, z1), p(r1, a1, z0), e, m);
  }

  /**
   * Rings of points joined into a hull. Each ring is a list of [x, y, z], all the same length, in the
   * same order. smooth: normals point away from the ring's centre (rubber); otherwise flat facets (cast).
   */
  function loft(rings, m, smooth = false) {
    const centre = r => r.reduce((c, q) => [c[0] + q[0] / r.length, c[1] + q[1] / r.length, c[2] + q[2] / r.length], [0, 0, 0]);
    for (let k = 0; k < rings.length - 1; k++) {
      const A = rings[k], B = rings[k + 1], ca = centre(A), cb = centre(B), n = A.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a = A[i], b = A[j], c = B[j], d = B[i];
        if (smooth) {
          const out = (q, o) => nrm(q[0] - o[0], q[1] - o[1], q[2] - o[2]);
          vert(a, out(a, ca), [0, 0], m); vert(b, out(b, ca), [0, 0], m); vert(c, out(c, cb), [0, 0], m);
          vert(a, out(a, ca), [0, 0], m); vert(c, out(c, cb), [0, 0], m); vert(d, out(d, cb), [0, 0], m);
          continue;
        }
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
        let N = nrm(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
        const mx = (a[0] + c[0]) / 2 - (ca[0] + cb[0]) / 2, my = (a[1] + c[1]) / 2 - (ca[1] + cb[1]) / 2, mz = (a[2] + c[2]) / 2 - (ca[2] + cb[2]) / 2;
        if (N[0] * mx + N[1] * my + N[2] * mz < 0) N = [-N[0], -N[1], -N[2]];
        quad(a, b, c, d, N, m);
      }
    }
  }

  /** Closes a ring with one flat face (the ring must be convex). */
  function capRing(ring, n, m, worn = false) {
    const uv = worn ? [1, 0] : [0, 0];
    for (let i = 1; i < ring.length - 1; i++) tri(ring[0], ring[i], ring[i + 1], n, m, uv, uv, uv);
  }

  /**
   * A flat face at depth z between an outer outline and a hole, both star-shaped about the origin of
   * their (x, y): this is how a screen gets to sit down inside a thick casing.
   */
  function ringFace(outer, inner, cx, cy, z, n, m) {
    const ang = q => Math.atan2(q[1] - cy, q[0] - cx);
    const angles = [...new Set([...outer, ...inner].map(ang))].sort((a, b) => a - b);
    const onto = (poly, a) => { // where the ray at angle a leaves the polygon
      const dx = Math.cos(a), dy = Math.sin(a);
      let best = 0;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i], q = poly[(i + 1) % poly.length];
        const ex = q[0] - p[0], ey = q[1] - p[1], den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const t = ((p[0] - cx) * ey - (p[1] - cy) * ex) / den, u = ((p[0] - cx) * dy - (p[1] - cy) * dx) / den;
        if (t > 0 && u >= -1e-9 && u <= 1 + 1e-9) best = Math.max(best, t);
      }
      return [cx + dx * best, cy + dy * best, z];
    };
    for (let i = 0; i < angles.length; i++) {
      const a = angles[i], b = angles[(i + 1) % angles.length];
      quad(onto(inner, a), onto(outer, a), onto(outer, b), onto(inner, b), n, m);
    }
  }

  /** A hexagonal bolt head with its axis along +z, seen from behind. */
  function bolt(x, y, z, r, m) {
    const h = 0.0016;
    for (let i = 0; i < 6; i++) {
      const a0 = i / 6 * Math.PI * 2 + 0.3, a1 = (i + 1) / 6 * Math.PI * 2 + 0.3;
      const p0 = [x + Math.cos(a0) * r, y + Math.sin(a0) * r], p1 = [x + Math.cos(a1) * r, y + Math.sin(a1) * r];
      const mid = (a0 + a1) / 2, n = [Math.cos(mid), Math.sin(mid), 0.2];
      quad([p0[0], p0[1], z], [p1[0], p1[1], z], [p1[0], p1[1], z + h], [p0[0], p0[1], z + h], n, m, WORN);
      tri([x, y, z + h], [p0[0], p0[1], z + h], [p1[0], p1[1], z + h], [0, 0, 1], m);
    }
  }

  /**
   * Stencil lettering on a face looking along +z: each stroke a separate bar with a gap at the joints,
   * as if sprayed through a cut plate. h is the letter height. Returns the width it took. `flip` is
   * the x the letters mirror about when the whole device is mirrored, so they still read (see the
   * vertex shader); it is carried in uv.x.
   */
  function stencil(text, x, y, z, h, m) {
    const u = h / 5, gap = u * 0.16;
    let width = 0;
    for (const ch of text) width += ch === ' ' ? 2.4 * u : (GLYPHS[ch] ? glyphW(ch) : 3) * u + u;
    width -= u;
    const flip = x + width / 2;
    let cx = x;
    for (const ch of text) {
      if (ch === ' ') { cx += 2.4 * u; continue; }
      for (const [a, b, c, d] of GLYPHS[ch] || []) {
        const x0 = cx + a * u + gap, y0 = y + b * u + gap, x1 = cx + (a + c) * u - gap, y1 = y + (b + d) * u - gap;
        quad([x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z], [0, 0, 1], m,
          [[flip, 0], [flip, 0], [flip, 0], [flip, 0]]);
      }
      cx += (GLYPHS[ch] ? glyphW(ch) : 3) * u + u;
    }
    return width;
  }

  return {vert, tri, quad, box, bevelBox, cylZ, extrudeX, lathe, arcZ, loft, capRing, ringFace, bolt, stencil, withUv, done: () => new Float32Array(v)};
}
