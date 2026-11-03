// The motion tracker's geometry, built in code. Tracker space is metres: +x right, +y up, -z forward;
// the screen is on the back (+z), facing you. Each vertex is 9 floats: position, normal, uv, material.
//
// A survey set from the waterworks, heavy and well used: a cast housing wider at the shoulders with rubber
// corner bumpers, a small tube sunk deep behind thick glass under a brow, a ribbed transducer drum
// slung across the top that ratchets round with every pulse, a control strip below (segmented range
// window, power toggle, a spare toggle, a gain knob), a battery brick hung off one lower corner and a
// ribbed rubber handle raked out from the other. Lettering is stencilled on, and every edge is worn.

import {MESH_STRIDE, meshBuilder} from './meshkit.js';

export const TRACKER_STRIDE = MESH_STRIDE;
export const TMAT = {BODY: 0, ACCENT: 1, GRIP: 2, DARK: 3, LED: 4, FUNNEL: 5, SCREEN: 6, DIGITS: 7, DRUM: 8, TOGGLE: 9, STENCIL: 10, LAMP: 11};

/** The screen rectangle on the back, in tracker space: x0, y0, x1, y1 at depth z. */
export const TRACKER_SCREEN = {x0: -0.052, y0: -0.024, x1: 0.052, y1: 0.042, z: 0.0115};

/** What the moving parts turn about: the drum's axis (y, z), the toggles' hinge (y, z). */
export const DRUM_AXIS = [0.0715, -0.008];
export const TOGGLE_HINGE = [-0.0455, 0.026];

// the outline of the casing seen from the back: broad at the shoulders, drawn in toward the foot
const OUTLINE = [[-0.058, 0.058], [0.058, 0.058], [0.068, 0.05], [0.0705, 0.03], [0.066, -0.046], [0.056, -0.064], [0.047, -0.07], [-0.047, -0.07], [-0.056, -0.064], [-0.066, -0.046], [-0.0705, 0.03], [-0.068, 0.05]];
const shrink = (o, d) => o.map(([x, y]) => [x * (1 - d / 0.07), y * (1 - d / 0.064)]);
const at = (o, z) => o.map(([x, y]) => [x, y, z]);
// a rectangle with its corners cut, for the tube's mouth
const cutRect = (x0, y0, x1, y1, c) => [[x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c], [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c]];

export function buildTrackerMesh() {
  const {quad, box, bevelBox, cylZ, lathe, loft, capRing, ringFace, bolt, stencil, withUv, done} = meshBuilder();
  const {BODY, ACCENT, GRIP, DARK, LED, FUNNEL, SCREEN, DIGITS, DRUM, TOGGLE, STENCIL, LAMP} = TMAT;
  const S = TRACKER_SCREEN, zBack = 0.0245, zFront = -0.036;
  const scy = (S.y0 + S.y1) / 2;
  const mouth = cutRect(S.x0 - 0.0055, S.y0 - 0.0055, S.x1 + 0.0055, S.y1 + 0.0055, 0.0075);
  const neck = cutRect(S.x0, S.y0, S.x1, S.y1, 0.0055);

  // Near parts first: with the depth test on, whatever they cover is never shaded, and the casing is
  // behind almost everything else.
  // the tube itself
  quad([S.x0, S.y0, S.z], [S.x1, S.y0, S.z], [S.x1, S.y1, S.z], [S.x0, S.y1, S.z], [0, 0, 1], SCREEN, [[0, 0], [1, 0], [1, 1], [0, 1]]);

  // lettering, stencilled on by somebody long ago
  stencil('SURVEY 4', S.x0 - 0.002, S.y1 + 0.0088, zBack + 0.0106, 0.0042, STENCIL);
  stencil('WORKS', 0.02, S.y1 + 0.0088, zBack + 0.0106, 0.0042, STENCIL);
  stencil('RANGE M', -0.0535, -0.0675, zBack + 0.0002, 0.0036, STENCIL);
  stencil('PWR', -0.0072, -0.0605, zBack + 0.0002, 0.0034, STENCIL);
  stencil('GAIN', 0.0345, -0.0645, zBack + 0.0002, 0.0034, STENCIL);
  // the control strip. The range window: a raised plate and a dark pane of segments
  bevelBox(-0.0535, -0.0615, zBack - 0.001, -0.0115, -0.0345, zBack + 0.0038, 0.0014, ACCENT);
  quad([-0.051, -0.059, zBack + 0.004], [-0.014, -0.059, zBack + 0.004], [-0.014, -0.037, zBack + 0.004], [-0.051, -0.037, zBack + 0.004], [0, 0, 1], DIGITS, [[0, 0], [1, 0], [1, 1], [0, 1]]);
  // toggles: a nut and a lever each. uv.y 0 is the power switch, which moves; 1 stays where it was left
  const [hy, hz] = TOGGLE_HINGE;
  [[-0.0015, 0], [0.0165, 1]].forEach(([x, which]) => {
    lathe('z', x, hy, [[zBack, 0.0058], [zBack + 0.0016, 0.0058], [zBack + 0.0028, 0.0038], [zBack + 0.0028, 0]], ACCENT, 6);
    withUv((q, uv) => [uv[0], which], () => bevelBox(x - 0.0018, hy - 0.0018, hz, x + 0.0018, hy + 0.0018, hz + 0.0135, 0.0007, TOGGLE));
  });
  // the status lamp between them, in a little well
  lathe('z', 0.0075, -0.0338, [[zBack, 0.0042], [zBack + 0.0012, 0.0042], [zBack + 0.0012, 0.003]], ACCENT, 10);
  cylZ(0.0075, -0.0338, zBack + 0.0006, zBack + 0.0014, 0.003, LED, 10, false, true);
  // a gain knob, with its pointer
  const kx = 0.045, ky = -0.0465;
  lathe('z', kx, ky, [[zBack, 0.0132], [zBack + 0.0014, 0.0132], [zBack + 0.0026, 0.0104], [zBack + 0.0085, 0.0098], [zBack + 0.0102, 0.0082], [zBack + 0.0102, 0]], ACCENT, 12);
  const pa = 2.15, pc = Math.cos(pa), ps = Math.sin(pa), pw = 0.0009;
  const pp = (r, t) => [kx + pc * r - ps * t, ky + ps * r + pc * t, zBack + 0.0104];
  withUv(() => [kx, 0], () => quad(pp(0.0016, -pw), pp(0.0086, -pw), pp(0.0086, pw), pp(0.0016, pw), [0, 0, 1], STENCIL));

  // two lamps beside the tube's lower corners, that come on when something is behind you on that side
  for (const s of [-1, 1]) {
    const x0 = Math.min(s * 0.0598, s * 0.0654), x1 = Math.max(s * 0.0598, s * 0.0654);
    box(x0 - 0.0008, -0.0322, zBack - 0.0005, x1 + 0.0008, -0.0178, zBack + 0.0008, DARK);
    withUv(() => [0, s < 0 ? 0 : 1], () => quad([x0, -0.0314, zBack + 0.001], [x1, -0.0314, zBack + 0.001], [x1, -0.0186, zBack + 0.001], [x0, -0.0186, zBack + 0.001], [0, 0, 1], LAMP));
  }

  // bolts through the back, where it is cast thickest
  for (const [x, y] of [[-0.0632, 0.0165], [0.0632, 0.0165], [-0.058, -0.0565], [0.058, -0.0565]]) bolt(x, y, zBack, 0.0027, ACCENT);

  // the brow over the tube, and rubber bumpers on the shoulders
  bevelBox(S.x0 - 0.0115, S.y1 + 0.0072, zBack - 0.002, S.x1 + 0.0115, S.y1 + 0.0145, zBack + 0.0105, 0.002, BODY);
  for (const s of [-1, 1]) {
    const a = s * 0.0635, b = s * 0.0752;
    bevelBox(Math.min(a, b), 0.022, zFront - 0.002, Math.max(a, b), 0.0615, zBack + 0.0045, 0.0034, GRIP);
    const c = s * 0.052, d = s * 0.0675; // the stub of bumper over the corner
    bevelBox(Math.min(c, d), 0.0525, zFront - 0.002, Math.max(c, d), 0.0628, zBack + 0.0045, 0.003, GRIP);
  }

  // the casing: a chamfer, the long sides, a chamfer, and a back face with a hole in it for the tube
  const outer = OUTLINE, inner = shrink(OUTLINE, 0.0035);
  const front = shrink(OUTLINE, 0.004);
  // the funnel down to the glass: uv.y is 0 at the mouth, 1 at the glass, where the phosphor lights it
  for (let i = 0; i < 8; i++) {
    const j = (i + 1) % 8, a = mouth[i], b = mouth[j], c = neck[j], d = neck[i];
    const ex = b[0] - a[0], ey = b[1] - a[1], fx = d[0] - a[0], fy = d[1] - a[1], fz = S.z - zBack;
    let nx = ey * fz, ny = -ex * fz, nz = ex * fy - ey * fx;
    const l = Math.hypot(nx, ny, nz); nx /= l; ny /= l; nz /= l;
    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    quad([a[0], a[1], zBack], [b[0], b[1], zBack], [c[0], c[1], S.z], [d[0], d[1], S.z], [nx, ny, nz], FUNNEL, [[0, 0], [0, 0], [0, 1], [0, 1]]);
  }
  // the transducer drum on top: it turns (material DRUM), between two cast saddles
  const [dy, dz] = DRUM_AXIS, R = 0.0132;
  lathe('x', dy, dz, [[-0.0445, 0], [-0.0445, 0.0098], [-0.0415, R], [0.0415, R], [0.0445, 0.0098], [0.0445, 0]], DRUM, 14);
  for (let i = 0; i < 8; i++) { // ribs along it, so you can see it move
    const a = i / 8 * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), w = 0.0016, h = 0.0018;
    const P = (x, r, t) => [x, dy + ca * r - sa * t, dz + sa * r + ca * t];
    const x0 = -0.0395, x1 = 0.0395, r0 = R - 0.0004, r1 = R + h;
    const N = (r, t) => [0, ca * r - sa * t, sa * r + ca * t];
    quad(P(x0, r1, -w), P(x1, r1, -w), P(x1, r1, w), P(x0, r1, w), N(1, 0), DRUM, [[1, 0], [1, 0], [1, 0], [1, 0]]);
    quad(P(x0, r0, -w), P(x1, r0, -w), P(x1, r1, -w), P(x0, r1, -w), N(0, -1), DRUM);
    quad(P(x0, r0, w), P(x1, r0, w), P(x1, r1, w), P(x0, r1, w), N(0, 1), DRUM);
  }
  for (const s of [-1, 1]) {
    const a = s * 0.0448, b = s * 0.0582;
    bevelBox(Math.min(a, b), 0.05, dz - 0.0125, Math.max(a, b), dy + 0.0085, dz + 0.0125, 0.0026, ACCENT);
    bolt(s * 0.0515, dy, dz + 0.0125, 0.0031, DARK);
  }

  withUv(() => [1, 0], () => loft([at(front, zFront), at(outer, zFront + 0.004)], BODY));
  loft([at(outer, zFront + 0.004), at(outer, zBack - 0.0035)], BODY);
  withUv(() => [1, 0], () => loft([at(outer, zBack - 0.0035), at(inner, zBack)], BODY));
  capRing(at(front, zFront), [0, 0, -1], BODY);
  ringFace(inner, mouth, 0, scy, zBack, [0, 0, 1], BODY);

  // the battery brick, hung off the lower corner, with its strap and latch
  bevelBox(0.0135, -0.0955, -0.0315, 0.0655, -0.0675, 0.0135, 0.0032, BODY);
  bevelBox(0.0345, -0.0985, -0.0275, 0.0445, -0.0645, 0.0165, 0.0012, ACCENT);
  for (const x of [0.0195, 0.024, 0.0285]) quad([x, -0.091, 0.0136], [x + 0.0013, -0.091, 0.0136], [x + 0.0013, -0.0725, 0.0136], [x, -0.0725, 0.0136], [0, 0, 1], DARK);

  // the handle, raked out from the other corner: rubber rings for your fingers, a steel collar on top
  const P0 = [-0.0295, -0.0645, -0.005], P1 = [-0.0605, -0.172, 0.004];
  const ring = (t, k, n = 10) => {
    const cx = P0[0] + (P1[0] - P0[0]) * t, cy = P0[1] + (P1[1] - P0[1]) * t, cz = P0[2] + (P1[2] - P0[2]) * t;
    const dl = Math.hypot(P1[0] - P0[0], P1[1] - P0[1]), ax = -(P1[1] - P0[1]) / dl, ay = (P1[0] - P0[0]) / dl;
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * Math.PI * 2, c = Math.cos(a) * 0.0168 * k, z = Math.sin(a) * 0.0205 * k;
      out.push([cx + ax * c, cy + ay * c, cz + z]);
    }
    return out;
  };
  loft([ring(0.0, 1.12), ring(0.052, 1.12), ring(0.07, 1.04), ring(0.1, 1.04)], ACCENT);
  const rings = [ring(0.1, 0.98)];
  for (let i = 0; i < 4; i++) {
    const t = 0.13 + i * 0.2;
    rings.push(ring(t, 0.98), ring(t + 0.04, 1.08), ring(t + 0.1, 1.08), ring(t + 0.14, 0.98));
  }
  rings.push(ring(0.94, 1.0), ring(1.0, 1.14));
  loft(rings, GRIP, true);
  const foot = ring(1.0, 1.14);
  capRing(foot, [0, -1, 0], GRIP);

  return done();
}
