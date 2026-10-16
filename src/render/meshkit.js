// Shared helpers for the hand-held devices' geometry. Space is metres: +x right, +y up, -z forward.
// Each vertex is 9 floats: position, normal, uv, material.

export const MESH_STRIDE = 9;

/** A triangle soup builder. `done()` returns the vertices as one Float32Array. */
export function meshBuilder() {
  const v = [];
  const vert = (p, n, uv, m) => v.push(p[0], p[1], p[2], n[0], n[1], n[2], uv[0], uv[1], m);
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

  return {vert, tri, quad, box, cylZ, extrudeX, done: () => new Float32Array(v)};
}
