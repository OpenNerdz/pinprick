// The hand scanner's geometry, built in code. Gun space is metres: +x right, +y up, -z forward
// (out of the emitter). Each vertex is 9 floats: position, normal, uv, material.
//
// It is meant to read at a glance from behind and above-left: a chamfered gunmetal body, a rail
// with cooling fins that glow when it heats, coils around the emitter barrel that light as it
// charges, a status screen on the back facing you, and a slanted grip.

import {MESH_STRIDE, meshBuilder} from './meshkit.js';

export const GUN_STRIDE = MESH_STRIDE;
export const GMAT = {BODY: 0, ACCENT: 1, GRIP: 2, LENS: 3, COIL: 4, FIN: 5, SCREEN: 6};

/** The emitter tip, where every dot comes from. */
export const MUZZLE = [0, 0.003, -0.278];

export function buildGunMesh() {
  const {quad, box, cylZ, extrudeX, done} = meshBuilder();
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
  return done();
}
