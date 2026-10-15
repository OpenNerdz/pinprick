// The hand scanner's geometry, built in code. Gun space is metres: +x right, +y up, -z forward
// (out of the emitter). Each vertex is 9 floats: position, normal, uv, material.
//
// It is meant to read at a glance from behind and above-left: a chamfered gunmetal body, a rail
// with cooling fins that glow when it heats, coils around the emitter barrel that light as it
// charges, a status screen on the back facing you, and a slanted grip.

export const GUN_STRIDE = 9;
export const GMAT = {BODY: 0, ACCENT: 1, GRIP: 2, LENS: 3, COIL: 4, FIN: 5, SCREEN: 6};

/** The emitter tip, where every dot comes from. */
export const MUZZLE = [0, 0.003, -0.278];

export function buildGunMesh() {
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

  const {BODY, ACCENT, GRIP, LENS, COIL, FIN, SCREEN} = GMAT;
  // body: long chamfered block
  extrudeX([[0.12, -0.038], [0.12, 0.028], [0.10, 0.046], [-0.11, 0.046], [-0.16, 0.024], [-0.16, -0.018], [-0.13, -0.038]], -0.034, 0.034, BODY);
  box(-0.022, -0.052, -0.13, 0.022, -0.038, -0.01, BODY);                // lower housing
  // top rail and the cooling fins on it
  box(-0.02, 0.046, -0.1, 0.02, 0.054, 0.09, ACCENT);
  for (let i = 0; i < 5; i++) { const z = -0.07 + i * 0.024; box(-0.024, 0.054, z, 0.024, 0.066, z + 0.005, FIN); }
  // side trim, and a status light on the left
  box(-0.0356, -0.004, -0.14, -0.0336, 0.01, 0.1, ACCENT);
  box(0.0336, -0.004, -0.14, 0.0356, 0.01, 0.1, ACCENT);
  box(-0.0364, 0.018, 0.05, -0.0352, 0.026, 0.07, LENS);
  // emitter: collar, barrel, three coils, muzzle ring, lens
  cylZ(0, 0.003, -0.16, -0.185, 0.031, BODY, 18, true, false);
  cylZ(0, 0.003, -0.185, -0.268, 0.021, ACCENT);
  for (const z of [-0.196, -0.216, -0.236]) cylZ(0, 0.003, z, z - 0.008, 0.028, COIL, 18, true, true);
  cylZ(0, 0.003, -0.262, -0.274, 0.027, BODY, 18, true, true);
  cylZ(0, 0.003, -0.271, -0.278, 0.019, LENS, 18, true, false);
  // grip, trigger and guard
  extrudeX([[0.105, -0.038], [0.055, -0.038], [0.075, -0.155], [0.125, -0.155]], -0.024, 0.024, GRIP);
  box(-0.006, -0.077, 0.014, 0.006, -0.07, 0.062, ACCENT);
  box(-0.006, -0.077, 0.014, 0.006, -0.038, 0.02, ACCENT);
  box(-0.004, -0.064, 0.042, 0.004, -0.04, 0.049, ACCENT);
  // the status screen on the back, facing you
  quad([-0.027, -0.027, 0.1206], [0.027, -0.027, 0.1206], [0.027, 0.023, 0.1206], [-0.027, 0.023, 0.1206], [0, 0, 1], SCREEN,
    [[0, 0], [1, 0], [1, 1], [0, 1]]);
  return new Float32Array(v);
}
