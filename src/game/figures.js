// Shapes of the things that move: the creature, the figures that appear behind you, and the statue.
// They share one silhouette on purpose: too tall, neck jutting forward, crooked arms that end in long
// fingers near the floor, a lump on the skull. The creature also has a second pose: when it hunts it
// drops onto all fours, spine level, head low and forward.
//
// Only vertical cylinders and spheres exist, so a pose is a list of those, part for part, and the
// two poses blend smoothly because every part has the same kind in both.

import {MAT} from '../config.js';
import {Actor} from '../world/world.js';
import {cyl, sph} from '../world/shapes.js';

// local space: +x is its right, -z is where it faces, y is up
//            kind  x      z      r      y0 / y   y1
const STAND = [
  ['c', -0.14,  0.00, 0.075, 0.00, 1.02],  // 0 left leg
  ['c',  0.14,  0.00, 0.075, 0.00, 1.02],  // 1 right leg
  ['c',  0.00,  0.03, 0.17,  0.95, 1.58],  // 2 torso
  ['s',  0.00,  0.06, 0.20,  1.66],        // 3 lower back
  ['s',  0.00, -0.02, 0.18,  1.90],        // 4 shoulders, hunched
  ['s',  0.00, -0.14, 0.13,  2.08],        // 5 upper spine
  ['s',  0.00, -0.27, 0.09,  2.16],        // 6 neck
  ['s',  0.00, -0.40, 0.15,  2.22],        // 7 head, pushed far forward
  ['s',  0.00, -0.47, 0.09,  2.06],        // 8 jaw, hanging open
  ['s',  0.10, -0.36, 0.08,  2.33],        // 9 lump on the skull
  ['c', -0.33, -0.05, 0.055, 1.18, 1.86],  // 10 left upper arm
  ['c',  0.33, -0.05, 0.055, 1.18, 1.86],  // 11 right upper arm
  ['c', -0.37, -0.13, 0.045, 0.48, 1.20],  // 12 left forearm, bent forward
  ['c',  0.37, -0.13, 0.045, 0.48, 1.20],  // 13 right forearm
  ['c', -0.39, -0.18, 0.026, 0.06, 0.50],  // 14 left fingers, nearly on the floor
  ['c',  0.39, -0.18, 0.026, 0.06, 0.50],  // 15 right fingers
];
const CRAWL = [
  ['c', -0.17,  0.48, 0.075, 0.00, 0.62],
  ['c',  0.17,  0.48, 0.075, 0.00, 0.62],
  ['c',  0.00,  0.36, 0.19,  0.55, 0.86],
  ['s',  0.00,  0.14, 0.21,  0.92],
  ['s',  0.00, -0.18, 0.20,  0.98],
  ['s',  0.00, -0.47, 0.16,  0.95],
  ['s',  0.00, -0.70, 0.10,  0.88],
  ['s',  0.00, -0.90, 0.15,  0.80],
  ['s',  0.00, -0.98, 0.09,  0.66],
  ['s',  0.09, -0.86, 0.08,  0.93],
  ['c', -0.27, -0.52, 0.055, 0.46, 0.92],
  ['c',  0.27, -0.52, 0.055, 0.46, 0.92],
  ['c', -0.31, -0.62, 0.045, 0.10, 0.50],
  ['c',  0.31, -0.62, 0.045, 0.10, 0.50],
  ['c', -0.34, -0.78, 0.026, 0.00, 0.12],
  ['c',  0.34, -0.78, 0.026, 0.00, 0.12],
];
export const HEAD = 7;

function build(pose, m) {
  const o = {m, solid: false};
  return pose.map(([k, x, z, r, a, b]) => (k === 'c' ? cyl(x, z, r, a, b, o) : sph(x, a, z, r, o)));
}

export function makeCreature() {
  const a = new Actor(build(STAND, MAT.FLESH), {on: false, radius: 1.15});
  a.phase = 0; a.crawl = 0; a.twitch = 0; a.twitchX = 0; a.twitchY = 0; a.rear = 0;
  return a;
}

/**
 * Pose and animate the creature for this frame.
 * speed: m/s, crawl: target 0 (upright) .. 1 (all fours), listening: head cocks and twitches,
 * rear: 0..1 rises up with arms spread (the moment it catches you).
 */
export function animateCreature(a, dt, speed, crawl, listening, rear = 0) {
  a.crawl += (crawl - a.crawl) * Math.min(1, dt * 4);
  a.rear += (rear - a.rear) * Math.min(1, dt * 10);
  a.phase += dt * (1.1 + speed * (a.crawl > 0.5 ? 3.4 : 2.0));
  const b = a.crawl, L = a.local;
  for (let i = 0; i < L.length; i++) {
    const s = STAND[i], c = CRAWL[i], p = L[i];
    p.x = s[1] + (c[1] - s[1]) * b;
    p.z = s[2] + (c[2] - s[2]) * b;
    p.r = s[3] + (c[3] - s[3]) * b;
    if (p.k === 1) { p.y0 = s[4] + (c[4] - s[4]) * b; p.y1 = s[5] + (c[5] - s[5]) * b; }
    else p.y = s[4] + (c[4] - s[4]) * b;
  }
  // gait: upright it sways and drags; on all fours the limbs pump in diagonal pairs
  const ph = a.phase, amp = Math.min(1, speed / 2.5);
  const swing = Math.sin(ph) * (0.18 + 0.1 * b) * amp, lift = Math.max(0, Math.sin(ph)) * 0.12 * b * amp;
  L[0].z += swing; L[1].z -= swing;
  L[12].z -= swing * 0.9; L[13].z += swing * 0.9; L[14].z -= swing; L[15].z += swing;
  L[12].y0 += lift; L[15].y1 += lift;
  for (const i of [3, 4, 5]) L[i].y += Math.abs(Math.sin(ph)) * 0.05 * amp * b;
  // the head: jerks to a new angle every so often instead of moving smoothly
  if ((a.twitch -= dt) <= 0) {
    a.twitch = listening ? 0.12 + Math.random() * 0.5 : 0.6 + Math.random() * 2.2;
    a.twitchX = (Math.random() - 0.5) * (listening ? 0.22 : 0.08);
    a.twitchY = (Math.random() - 0.5) * (listening ? 0.12 : 0.05) - (listening ? 0.06 : 0);
  }
  for (const i of [7, 8, 9]) { L[i].x += a.twitchX; L[i].y += a.twitchY; }
  // rearing up: rise to full height, arms thrown wide and high
  if (a.rear > 0.01) {
    const r = a.rear;
    for (const i of [10, 12, 14]) L[i].x -= 0.35 * r;
    for (const i of [11, 13, 15]) L[i].x += 0.35 * r;
    for (const i of [10, 11, 12, 13, 14, 15]) { L[i].y0 += 0.9 * r; L[i].y1 += 0.9 * r; L[i].z -= 0.2 * r; }
    for (const i of [7, 8, 9]) { L[i].y += 0.15 * r; L[i].z -= 0.1 * r; }
    L[8].y -= 0.12 * r; // the jaw drops
  }
}

/** World position of its head, for aiming the camera at it. */
export function headOf(a) { const h = a.parts[HEAD]; return [h.x, h.y, h.z]; }

export function makeFigure() {
  const a = new Actor(build(STAND, MAT.FLESH), {on: false, radius: 1.15});
  return a;
}

export function makeStatue() {
  return new Actor(build(STAND, MAT.PROP), {on: true, solid: true, radius: 1.15});
}
