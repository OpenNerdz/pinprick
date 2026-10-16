// The motion tracker's geometry, built in code. Tracker space is metres: +x right, +y up, -z forward;
// the screen is on the back (+z), facing you. Each vertex is 9 floats: position, normal, uv, material.
//
// A chunky slab you hold up in front of you by its grip: chamfered edges, a wide screen in a raised
// bezel, a round motion sensor staring forward out of the front, two stub antennae and a status light
// on top that blinks with every pulse.

import {MESH_STRIDE, meshBuilder} from './meshkit.js';

export const TRACKER_STRIDE = MESH_STRIDE;
export const TMAT = {BODY: 0, ACCENT: 1, GRIP: 2, SENSOR: 3, LED: 4, SCREEN: 6};

/** The screen rectangle on the back, in tracker space: x0, y0, x1, y1 at depth z. */
export const TRACKER_SCREEN = {x0: -0.058, y0: -0.034, x1: 0.058, y1: 0.036, z: 0.0172};

export function buildTrackerMesh() {
  const {quad, box, cylZ, extrudeX, done} = meshBuilder();
  const {BODY, ACCENT, GRIP, SENSOR, LED, SCREEN} = TMAT;
  // body: a slab with chamfered top and bottom edges, seen from the side as an octagon
  extrudeX([[0.016, -0.04], [0.016, 0.04], [0.008, 0.05], [-0.018, 0.05], [-0.026, 0.04], [-0.026, -0.04], [-0.018, -0.05], [0.008, -0.05]], -0.068, 0.068, BODY);
  // side rails, and a battery hatch on the right
  box(-0.072, -0.036, -0.02, -0.068, 0.036, 0.012, ACCENT);
  box(0.068, -0.036, -0.02, 0.072, 0.036, 0.012, ACCENT);
  box(0.072, -0.02, -0.014, 0.077, 0.014, 0.006, ACCENT);
  // the bezel around the screen
  const S = TRACKER_SCREEN, b = 0.005, zb = 0.016, zf = 0.0205;
  box(S.x0 - b, S.y1, zb, S.x1 + b, S.y1 + b, zf, ACCENT);
  box(S.x0 - b, S.y0 - b - 0.004, zb, S.x1 + b, S.y0, zf, ACCENT);
  box(S.x0 - b, S.y0, zb, S.x0, S.y1, zf, ACCENT);
  box(S.x1, S.y0, zb, S.x1 + b, S.y1, zf, ACCENT);
  // the motion sensor: a ring and a dark glass eye looking forward, with a slot either side
  cylZ(0, 0.004, -0.026, -0.032, 0.026, ACCENT, 20, true, false);
  cylZ(0, 0.004, -0.032, -0.036, 0.019, SENSOR, 20, true, false);
  box(-0.06, -0.02, -0.03, -0.034, -0.012, -0.026, SENSOR);
  box(0.034, -0.02, -0.03, 0.06, -0.012, -0.026, SENSOR);
  // antennae and the status light on top
  box(-0.058, 0.05, -0.012, -0.05, 0.072, -0.004, ACCENT);
  box(-0.042, 0.05, -0.012, -0.036, 0.064, -0.006, ACCENT);
  box(0.042, 0.05, 0.0, 0.056, 0.055, 0.01, LED);
  // the grip underneath, angled a little toward you
  extrudeX([[0.012, -0.05], [-0.014, -0.05], [-0.008, -0.13], [0.02, -0.13]], -0.017, 0.017, GRIP);
  box(-0.02, -0.136, -0.012, 0.02, -0.128, 0.024, ACCENT);
  // the screen itself, facing you
  quad([S.x0, S.y0, S.z], [S.x1, S.y0, S.z], [S.x1, S.y1, S.z], [S.x0, S.y1, S.z], [0, 0, 1], SCREEN,
    [[0, 0], [1, 0], [1, 1], [0, 1]]);
  return done();
}
