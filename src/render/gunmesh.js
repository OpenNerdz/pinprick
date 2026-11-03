// The hand scanner's geometry, built in code. Gun space is metres: +x right, +y up, -z forward
// (out of the emitter). Each vertex is 9 floats: position, normal, uv, material.
//
// It reads from behind and above-left, so that is where the work is: a lofted receiver whose shoulders
// and flanks catch different light, worn chamfers on the edges, louvred cooling fins on a rail that open
// when it vents, a capacitor block that slams back on a sweep and creeps forward as it recharges, a
// light slit down the flank that fills as it charges, coils and a spinning rotor in an open cage on the
// barrel, and a status screen sunk in a hood on the back facing you.

import {MESH_STRIDE, meshBuilder} from './meshkit.js';

export const GUN_STRIDE = MESH_STRIDE;
export const GMAT = {BODY: 0, ACCENT: 1, GRIP: 2, LENS: 3, COIL: 4, FIN: 5, SCREEN: 6, ROTOR: 7, BLOCK: 8, SLIT: 9, HOT: 10, SEAM: 11};

/** The emitter tip, where every dot comes from. */
export const MUZZLE = [0, 0.003, -0.278];

/** The barrel's axis (x, y), which the rotor spins about, and the height of the fins' hinges. */
export const GUN_AXIS = [0, 0.003];
export const FIN_HINGE_Y = 0.054;

/** A cross-section of the receiver: flanks, a chamfered shoulder and a narrower deck. */
function section(z, w, top, bot) {
  const sh = top - 0.016;
  return [
    [-w * 0.8, bot], [-w, bot + 0.008], [-w, sh], [-w * 0.74, top - 0.003], [-w * 0.6, top],
    [w * 0.6, top], [w * 0.74, top - 0.003], [w, sh], [w, bot + 0.008], [w * 0.8, bot],
  ].map(([x, y]) => [x, y, z]);
}

export function buildGunMesh() {
  const {quad, box, bevelBox, cylZ, extrudeX, lathe, arcZ, loft, capRing, ringFace, withUv, done} = meshBuilder();
  const {BODY, ACCENT, GRIP, LENS, COIL, FIN, SCREEN, ROTOR, BLOCK, SLIT, HOT, SEAM} = GMAT;
  const ax = GUN_AXIS[0], ay = GUN_AXIS[1];
  const rear = section(0.12, 0.0315, 0.033, -0.036);
  const Hx = 0.0298, Hb = -0.0312, Ht = 0.0268, Hz = 0.1235, Sz = 0.118;

  // Near parts first: with the depth test on, whatever they cover is never shaded, and the big hull is
  // behind almost everything else.
  // the status screen, facing you
  quad([-0.027, -0.028, Sz], [0.027, -0.028, Sz], [0.027, 0.024, Sz], [-0.027, 0.024, Sz], [0, 0, 1], SCREEN,
    [[0, 0], [1, 0], [1, 1], [0, 1]]);

  // the hood around it, proud of the plate, with a deep inner wall
  bevelBox(-Hx, Ht - 0.0032, 0.117, Hx, Ht + 0.003, Hz + 0.004, 0.0012, ACCENT); // a brow, deeper at the top
  bevelBox(-Hx, Hb, 0.117, Hx, Hb + 0.0032, Hz, 0.001, ACCENT);
  bevelBox(-Hx, Hb, 0.117, -Hx + 0.0032, Ht, Hz, 0.001, ACCENT);
  bevelBox(Hx - 0.0032, Hb, 0.117, Hx, Ht, Hz, 0.001, ACCENT);
  const wall = (a, b, n) => quad([a[0], a[1], Sz], [b[0], b[1], Sz], [b[0], b[1], 0.1205], [a[0], a[1], 0.1205], n, SEAM);
  wall([-0.027, 0.024], [0.027, 0.024], [0, -1, 0]); wall([-0.027, -0.028], [0.027, -0.028], [0, 1, 0]);
  wall([-0.027, -0.028], [-0.027, 0.024], [1, 0, 0]); wall([0.027, -0.028], [0.027, 0.024], [-1, 0, 0]);

  // the rail, and its vent well: what glows when the fins lift
  bevelBox(-0.0215, 0.0455, -0.092, 0.0215, 0.0535, 0.106, 0.0016, ACCENT);
  box(-0.0165, 0.0536, -0.086, 0.0165, 0.0538, 0.064, HOT);
  // fins, each hinged on its own front edge: uv.x carries its hinge, uv.y runs base (0) to tip (1)
  const FINS = 7;
  for (let i = 0; i < FINS; i++) {
    const z0 = -0.084 + i * 0.0208, z1 = z0 + 0.0068, hinge = z0;
    withUv(q => [hinge, (q[1] - FIN_HINGE_Y) / 0.0125], () => bevelBox(-0.0235, FIN_HINGE_Y, z0, 0.0235, FIN_HINGE_Y + 0.0125, z1, 0.0011, FIN));
  }

  // the capacitor block on the rail behind the fins, and its ready lamp (uv.y 1)
  bevelBox(-0.0175, 0.0535, 0.0665, 0.0175, 0.0645, 0.0935, 0.0018, BLOCK);
  withUv(() => [0, 1], () => quad([-0.0075, 0.0648, 0.0875], [0.0075, 0.0648, 0.0875], [0.0075, 0.0648, 0.0815], [-0.0075, 0.0648, 0.0815], [0, 1, 0], BLOCK));

  // panel seams and flank trim: a little machining, drawn a hair off the surface
  for (const s of [-1, 1]) {
    const x = s * 0.0342;
    bevelBox(s < 0 ? x - 0.0016 : x, -0.006, -0.096, s < 0 ? x : x + 0.0016, 0.012, 0.102, 0.0006, ACCENT); // trim
    const xs = s * 0.0361;
    // the light slit along the flank: uv.y runs from the back (0) to the barrel (1)
    withUv(q => [0, (0.096 - q[2]) / 0.186], () => quad([xs, 0.0005, 0.096], [xs, 0.0005, -0.09], [xs, 0.0055, -0.09], [xs, 0.0055, 0.096], [s, 0, 0], SLIT));
    const xb = s * 0.0342;
    for (const z of [-0.07, 0.03]) quad([xb, -0.034, z], [xb, -0.034, z + 0.0012], [xb, -0.0065, z + 0.0012], [xb, -0.0065, z], [s, 0, 0], SEAM);
    quad([xb, -0.0125, -0.094], [xb, -0.0125, 0.102], [xb, -0.0115, 0.102], [xb, -0.0115, -0.094], [s, 0, 0], SEAM);
  }
  // deck seam and a pair of hold-down bolts on the shoulders
  for (const z of [-0.088, 0.1]) quad([-0.0205, 0.0463, z], [0.0205, 0.0463, z], [0.0205, 0.0463, z + 0.0012], [-0.0205, 0.0463, z + 0.0012], [0, 1, 0], SEAM);
  for (const z of [-0.092, 0.1]) {
    for (const s of [-1, 1]) {
      const x = s * 0.0272, y = 0.0402;
      bevelBox(x - 0.0025, y - 0.0012, z - 0.0025, x + 0.0025, y + 0.0028, z + 0.0025, 0.0009, ACCENT);
    }
  }

  // emitter: a stepped collar, the barrel in its cage, coils, a rotor, the muzzle and the lens
  lathe('z', ax, ay, [[-0.157, 0.0235], [-0.161, 0.0305], [-0.180, 0.0312], [-0.1835, 0.0285], [-0.189, 0.0285], [-0.189, 0.018]], BODY, 18);
  cylZ(ax, ay, -0.186, -0.262, 0.0165, ACCENT, 12);
  // coils: uv.y says which along the barrel, 0 nearest you to 1 at the muzzle
  const COILS = [-0.1965, -0.2125, -0.2345, -0.2505];
  COILS.forEach((z, i) => withUv(() => [0, i / (COILS.length - 1)], () =>
    lathe('z', ax, ay, [[z, 0.018], [z - 0.0012, 0.0255], [z - 0.0058, 0.0255], [z - 0.007, 0.018]], COIL, 14)));
  // the rotor between the second and third coil: three tabs that spin up with the charge
  lathe('z', ax, ay, [[-0.2212, 0.0185], [-0.2262, 0.0185]], ROTOR, 10);
  for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2; arcZ(ax, ay, -0.2262, -0.2212, 0.018, 0.0288, a, a + 1.1, ROTOR, 3); }
  // the cage around them: three bars from collar to muzzle
  bevelBox(-0.0028, 0.0295, -0.2605, 0.0028, 0.0345, -0.1865, 0.0009, ACCENT);
  bevelBox(-0.0345, -0.0035, -0.2605, -0.0295, 0.0035, -0.1865, 0.0009, ACCENT);
  bevelBox(0.0295, -0.0035, -0.2605, 0.0345, 0.0035, -0.1865, 0.0009, ACCENT);
  lathe('z', ax, ay, [[-0.2585, 0.0185], [-0.2615, 0.0272], [-0.2715, 0.0272], [-0.2745, 0.0235], [-0.2775, 0.0195]], BODY, 18);
  // a ring of the lens' own light, on the back of the muzzle where you can see it from behind
  lathe('z', ax, ay, [[-0.2584, 0.0192], [-0.2584, 0.0248]], LENS, 18);
  cylZ(ax, ay, -0.2745, -0.278, 0.0195, LENS, 18, true, false);

  // the rear plate has a hole: the screen sits down inside it
  const hole = [[-0.027, -0.028], [0.027, -0.028], [0.027, 0.024], [-0.027, 0.024]];
  ringFace(rear.map(q => [q[0], q[1]]), hole, 0, -0.002, 0.12, [0, 0, 1], BODY);
  // receiver: rear plate, the long hull, tapering down into the emitter collar
  const hull = [rear, section(0.108, 0.034, 0.045, -0.038), section(-0.098, 0.034, 0.046, -0.038), section(-0.13, 0.03, 0.038, -0.03), section(-0.16, 0.024, 0.026, -0.018)];
  loft(hull, BODY);
  capRing(hull[4], [0, 0, -1], BODY);
  // grip, trigger and guard
  extrudeX([[0.105, -0.038], [0.055, -0.038], [0.075, -0.155], [0.125, -0.155]], -0.024, 0.024, GRIP);
  bevelBox(-0.022, -0.052, -0.13, 0.022, -0.038, -0.01, 0.002, BODY);    // lower housing
  bevelBox(-0.006, -0.077, 0.014, 0.006, -0.07, 0.062, 0.001, ACCENT);
  box(-0.006, -0.077, 0.014, 0.006, -0.038, 0.02, ACCENT);
  box(-0.004, -0.064, 0.042, 0.004, -0.04, 0.049, ACCENT);

  return done();
}
