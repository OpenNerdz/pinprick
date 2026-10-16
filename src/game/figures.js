// Shapes of the things that move: the creature, the figure that appears behind you, and the statue.
// They share one silhouette on purpose, so a glimpse of any of them reads as "it".
//
// It is built for listening. No eyes: a long smooth skull with a hanging jaw, and four flaps folded
// back along it that fan open round the mouth like a dish when it listens or clicks; that is its ear,
// and you can watch it open in the dots. A long neck jutting forward, a knobbly spine, a few ribs over
// a hollow chest, arms far too long ending in three splayed fingers, and legs that bend backwards like
// a starved animal's. Hunting it drops onto all fours, low and long, head out in front.
//
// The body is a skeleton of joints. Each pose is a table of joints (stand, crawl); a frame blends them,
// lays the gait, the head's jerks, the shield against your light or the rear over you on top, and then
// hangs the parts on the joints: capsules between two joints, spheres at one. Ribs, the knobs of the
// spine and the four flaps are worked out from the joints, so they follow any pose.

import {MAT} from '../config.js';
import {Actor} from '../world/world.js';
import {cap, sph} from '../world/shapes.js';

// joints; left ones are written once and mirrored for the right (local +x is its right, -z its front)
const NAMES = ['hip', 'sp1', 'sp2', 'chest', 'neck0', 'neck1', 'skullB', 'skullF', 'jaw',
  'shL', 'elL', 'wrL', 'f1L', 'f2L', 'f3L', 'hipL', 'knL', 'anL', 'toL',
  'shR', 'elR', 'wrR', 'f1R', 'f2R', 'f3R', 'hipR', 'knR', 'anR', 'toR'];
const J = Object.fromEntries(NAMES.map((n, i) => [n, i]));
const N = NAMES.length;

function pose(def) {
  const out = new Float32Array(N * 3);
  for (const [n, [x, y, z]] of Object.entries(def)) {
    out.set([x, y, z], J[n] * 3);
    if (n.endsWith('L')) out.set([-x, y, z], J[n.slice(0, -1) + 'R'] * 3);
  }
  return out;
}

// standing: hunched, about 2.3 m to the top of the skull, hands hanging past its knees
const STAND = pose({
  hip: [0, 1.05, 0.06], sp1: [0, 1.34, 0.09], sp2: [0, 1.6, 0.05], chest: [0, 1.84, -0.06],
  neck0: [0, 1.97, -0.18], neck1: [0, 2.06, -0.34], skullB: [0, 2.12, -0.46], skullF: [0, 2.0, -0.74], jaw: [0, 1.84, -0.64],
  shL: [-0.25, 1.83, -0.04], elL: [-0.37, 1.36, -0.15], wrL: [-0.39, 0.86, -0.3],
  f1L: [-0.46, 0.4, -0.4], f2L: [-0.38, 0.36, -0.47], f3L: [-0.3, 0.42, -0.41],
  hipL: [-0.12, 1.02, 0.06], knL: [-0.15, 0.6, -0.13], anL: [-0.16, 0.24, 0.15], toL: [-0.17, 0.0, -0.08],
});
// on all fours: spine level and low, the head reaching out in front, fingers splayed on the floor
const CRAWL = pose({
  hip: [0, 0.78, 0.46], sp1: [0, 0.86, 0.2], sp2: [0, 0.9, -0.08], chest: [0, 0.86, -0.36],
  neck0: [0, 0.8, -0.56], neck1: [0, 0.76, -0.76], skullB: [0, 0.74, -0.92], skullF: [0, 0.6, -1.17], jaw: [0, 0.49, -1.06],
  shL: [-0.26, 0.86, -0.4], elL: [-0.42, 0.62, -0.5], wrL: [-0.43, 0.12, -0.78],
  f1L: [-0.5, 0.0, -0.96], f2L: [-0.41, 0.0, -1.01], f3L: [-0.33, 0.0, -0.95],
  hipL: [-0.13, 0.76, 0.47], knL: [-0.21, 0.5, 0.16], anL: [-0.21, 0.27, 0.62], toL: [-0.21, 0.0, 0.42],
});

// the parts, in order: [kind, joint a, joint b, radius]; kind 'c' capsule between joints, 's' sphere at a
// joint, 'rib' / 'knob' / 'petal' worked out from the joints (index into the rib, knob or petal list)
const LIMBS = [
  ['s', 'hip', null, 0.16], ['c', 'hip', 'sp1', 0.13], ['c', 'sp1', 'sp2', 0.12], ['c', 'sp2', 'chest', 0.16], ['c', 'chest', 'neck0', 0.09],
  ['c', 'neck0', 'neck1', 0.06], ['c', 'neck1', 'skullB', 0.055], ['c', 'skullB', 'skullF', 0.125], ['c', 'skullB', 'jaw', 0.06],
  ['c', 'chest', 'shL', 0.06], ['c', 'shL', 'elL', 0.06], ['c', 'elL', 'wrL', 0.048],
  ['c', 'wrL', 'f1L', 0.022], ['c', 'wrL', 'f2L', 0.022], ['c', 'wrL', 'f3L', 0.022],
  ['c', 'chest', 'shR', 0.06], ['c', 'shR', 'elR', 0.06], ['c', 'elR', 'wrR', 0.048],
  ['c', 'wrR', 'f1R', 0.022], ['c', 'wrR', 'f2R', 0.022], ['c', 'wrR', 'f3R', 0.022],
  ['c', 'hip', 'hipL', 0.08], ['c', 'hipL', 'knL', 0.08], ['c', 'knL', 'anL', 0.055], ['c', 'anL', 'toL', 0.04],
  ['c', 'hip', 'hipR', 0.08], ['c', 'hipR', 'knR', 0.08], ['c', 'knR', 'anR', 0.055], ['c', 'anR', 'toR', 0.04],
];
const RIBS = [0.25, 0.55, 0.85];              // along sp2 -> chest; a pair at each
const KNOBS = [['sp1', 0], ['sp2', 0], ['sp2', 0.5], ['chest', 0], ['neck0', 0]]; // knobs of the spine
const PETALS = 4;
const PARTS = [...LIMBS, ...RIBS.flatMap((_, i) => [['rib', i * 2], ['rib', i * 2 + 1]]),
  ...KNOBS.map((_, i) => ['knob', i]), ...Array.from({length: PETALS}, (_, i) => ['petal', i])];
export const SKULL = LIMBS.findIndex(p => p[1] === 'skullB' && p[2] === 'skullF');

function build(m) {
  const o = {m, solid: false};
  return PARTS.map(p => (p[0] === 's' || p[0] === 'knob' ? sph(0, 0, 0, p[3] ?? 0.045, o) : cap(0, 0, 0, 0, 1, 0, p[3] ?? 0.03, o)));
}

// ------------------------------------------------------------------------------------------ posing
const P = new Float32Array(N * 3);            // this frame's joints
const v3 = (i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
const add = (i, x, y, z) => { P[i * 3] += x; P[i * 3 + 1] += y; P[i * 3 + 2] += z; };
const set = (i, x, y, z, k) => { P[i * 3] += (x - P[i * 3]) * k; P[i * 3 + 1] += (y - P[i * 3 + 1]) * k; P[i * 3 + 2] += (z - P[i * 3 + 2]) * k; };
const norm = (x, y, z) => { const l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l]; };
const HEADS = [J.neck1, J.skullB, J.skullF, J.jaw];
const ARM = side => side < 0 ? [J.shL, J.elL, J.wrL, J.f1L, J.f2L, J.f3L] : [J.shR, J.elR, J.wrR, J.f1R, J.f2R, J.f3R];
const LEG = side => side < 0 ? [J.knL, J.anL, J.toL] : [J.knR, J.anR, J.toR];

/** Work out this frame's joints into P from the actor's state. */
function joints(a) {
  const b = a.crawl, amp = a.amp;
  for (let i = 0; i < P.length; i++) P[i] = STAND[i] + (CRAWL[i] - STAND[i]) * b;
  const ph = a.phase, s = Math.sin(ph), c = Math.cos(ph);
  // upright: a dragging walk, legs alternating, arms swinging against them, the body swaying
  const up = (1 - b) * amp;
  if (up > 0.001) {
    for (const side of [-1, 1]) {
      const k = side * s, [kn, an, to] = LEG(side);
      add(kn, 0, 0, -0.12 * k * up); add(an, 0, Math.max(0, k) * 0.05 * up, -0.16 * k * up);
      add(to, 0, side > 0 ? 0 : Math.max(0, k) * 0.07 * up, -0.18 * k * up); // the right foot drags
      const [, el, wr, f1, f2, f3] = ARM(side);
      add(el, 0, 0, 0.06 * k * up); for (const j of [wr, f1, f2, f3]) add(j, 0, 0, 0.13 * k * up);
    }
    for (const j of [J.chest, J.neck0, J.neck1, J.skullB, J.skullF, J.jaw]) add(j, s * 0.03 * up, 0, 0);
  }
  // all fours: limbs pump in diagonal pairs (left arm with right leg), the spine bobbing
  const lo = b * amp;
  if (lo > 0.001) {
    for (const side of [-1, 1]) {
      const g = side * s, lift = Math.max(0, -side * c) * 0.12 * lo;
      const [, el, wr, f1, f2, f3] = ARM(side), [kn, an, to] = LEG(-side);
      add(el, 0, lift * 0.5, -0.12 * g * lo);
      for (const j of [wr, f1, f2, f3]) add(j, 0, lift, -0.24 * g * lo);
      add(kn, 0, lift * 0.4, -0.14 * g * lo); add(an, 0, lift, -0.2 * g * lo); add(to, 0, lift, -0.22 * g * lo);
    }
    const bob = Math.abs(s) * 0.05 * lo;
    for (const j of [J.hip, J.sp1, J.sp2, J.chest]) add(j, 0, bob, 0);
  }
  // the head jerks to a new angle every so often instead of moving smoothly
  for (const j of HEADS) add(j, a.twitchX, a.twitchY, 0);
  // in your light: it rears up and back, crosses its arms over its face, and shudders
  const sh = a.shield;
  if (sh > 0.01) {
    for (const [j, y, z] of [[J.chest, 0.22, 0.06], [J.neck0, 0.28, 0.1], [J.neck1, 0.32, 0.16], [J.skullB, 0.34, 0.2], [J.skullF, 0.42, 0.24], [J.jaw, 0.36, 0.22]]) add(j, 0, y * sh, z * sh);
    const [hx, hy, hz] = v3(J.skullF);
    for (const side of [-1, 1]) {
      const [, el, wr, f1, f2, f3] = ARM(side), [cx, cy, cz] = v3(J.chest);
      set(el, side * 0.3, cy - 0.02, cz - 0.3, sh);
      set(wr, -side * 0.06, hy - 0.04, hz - 0.12, sh);
      set(f1, -side * 0.2, hy + 0.2, hz - 0.08, sh); set(f2, -side * 0.12, hy + 0.26, hz - 0.12, sh); set(f3, -side * 0.02, hy + 0.22, hz - 0.14, sh);
    }
    const q = 0.012 * sh;
    for (const j of [...HEADS, J.wrL, J.wrR, J.f1L, J.f2L, J.f3L, J.f1R, J.f2R, J.f3R]) add(j, (Math.random() - 0.5) * q, (Math.random() - 0.5) * q, (Math.random() - 0.5) * q);
  }
  // over you, the moment it catches you: to its full height, arms flung wide and high, face open
  const r = a.rear;
  if (r > 0.01) {
    for (const [j, y, z] of [[J.chest, 0.3, 0], [J.neck0, 0.36, -0.06], [J.neck1, 0.4, -0.12], [J.skullB, 0.42, -0.14], [J.skullF, 0.4, -0.2], [J.jaw, 0.2, -0.18]]) add(j, 0, y * r, z * r);
    const [, cy, cz] = v3(J.chest);
    for (const side of [-1, 1]) {
      const [, el, wr, f1, f2, f3] = ARM(side);
      set(el, side * 0.62, cy + 0.25, cz - 0.1, r); set(wr, side * 0.9, cy + 0.55, cz - 0.3, r);
      set(f1, side * 1.08, cy + 0.72, cz - 0.38, r); set(f2, side * 1.02, cy + 0.8, cz - 0.45, r); set(f3, side * 0.94, cy + 0.84, cz - 0.38, r);
    }
  }
}

/** Hang the parts on this frame's joints, writing into the actor's local parts. */
function hang(a) {
  const L = a.local, open = a.open;
  // a frame for the chest (up its spine, out of its belly) and for the skull (along it, round it)
  const [hx, hy, hz] = v3(J.sp2), [cx, cy, cz] = v3(J.chest);
  const [ux, uy, uz] = norm(cx - hx, cy - hy, cz - hz);
  const fd = -uz; let [bx, by, bz] = norm(-ux * fd, -uy * fd, -1 - uz * fd); // belly: its front, square to the spine
  const [sbx, sby, sbz] = v3(J.skullB), [sfx, sfy, sfz] = v3(J.skullF);
  const [dx, dy, dz] = norm(sfx - sbx, sfy - sby, sfz - sbz);
  const [rx, ry, rz] = norm(-dz, 0, dx);        // across the skull (its right)
  const tx = dy * rz - dz * ry, ty = dz * rx - dx * rz, tz = dx * ry - dy * rx; // over the skull
  for (let i = 0; i < PARTS.length; i++) {
    const p = PARTS[i], q = L[i];
    if (p[0] === 'c') {
      const A = J[p[1]] * 3, B = J[p[2]] * 3;
      q.ax = P[A]; q.ay = P[A + 1]; q.az = P[A + 2]; q.bx = P[B]; q.by = P[B + 1]; q.bz = P[B + 2];
    } else if (p[0] === 's') {
      const A = J[p[1]] * 3; q.x = P[A]; q.y = P[A + 1]; q.z = P[A + 2];
    } else if (p[0] === 'rib') { // from the spine round to the front of the chest, curving down
      const k = RIBS[p[1] >> 1], side = p[1] & 1 ? 1 : -1, w = 0.17 - 0.03 * Math.abs(k - 0.55) * 2;
      const ax = hx + (cx - hx) * k, ay = hy + (cy - hy) * k, az = hz + (cz - hz) * k;
      q.ax = ax - bx * 0.05; q.ay = ay - by * 0.05; q.az = az - bz * 0.05;
      q.bx = ax + side * w + bx * 0.1 - ux * 0.08; q.by = ay + by * 0.1 - uy * 0.08; q.bz = az + bz * 0.1 - uz * 0.08;
      q.r = 0.026;
    } else if (p[0] === 'knob') { // knuckles of the spine, standing out of its back
      const [j, t] = KNOBS[p[1]], A = J[j] * 3, B = J[NAMES[J[j] + 1]] * 3;
      q.x = P[A] + (P[B] - P[A]) * t - bx * 0.09; q.y = P[A + 1] + (P[B + 1] - P[A + 1]) * t - by * 0.09; q.z = P[A + 2] + (P[B + 2] - P[A + 2]) * t - bz * 0.09;
      q.r = 0.05;
    } else { // a flap of the ear: folded back along the skull, or fanned out round the mouth
      const th = (p[1] + 0.5) / PETALS * Math.PI * 2, ex = Math.cos(th) * rx + Math.sin(th) * tx, ey = Math.cos(th) * ry + Math.sin(th) * ty, ez = Math.cos(th) * rz + Math.sin(th) * tz;
      const ax = sfx - dx * 0.08 + ex * 0.09, ay = sfy - dy * 0.08 + ey * 0.09, az = sfz - dz * 0.08 + ez * 0.09;
      const shut = [ax - dx * 0.3 + ex * 0.035, ay - dy * 0.3 + ey * 0.035, az - dz * 0.3 + ez * 0.035];
      const wide = [ax + ex * 0.3 + dx * 0.08, ay + ey * 0.3 + dy * 0.08, az + ez * 0.3 + dz * 0.08];
      q.ax = ax; q.ay = ay; q.az = az;
      q.bx = shut[0] + (wide[0] - shut[0]) * open; q.by = shut[1] + (wide[1] - shut[1]) * open; q.bz = shut[2] + (wide[2] - shut[2]) * open;
      q.r = 0.042;
    }
  }
}

function makeBody(m, o) {
  const a = new Actor(build(m), {radius: 1.45, ...o});
  a.phase = 0; a.crawl = 0; a.amp = 0; a.twitch = 0; a.twitchX = 0; a.twitchY = 0;
  a.open = 0; a.flare = 0; a.shield = 0; a.rear = 0;
  joints(a); hang(a);
  return a;
}

export function makeCreature() { return makeBody(MAT.FLESH, {on: false}); }

/**
 * Pose and animate the creature for this frame. o: {speed (m/s), crawl (target 0 upright .. 1 all
 * fours), listening (head jerks, the ear half open), shield (in your light), rear (over you)}.
 * `a.flare = 1` from outside fans the ear wide for a click.
 */
export function animateCreature(a, dt, o) {
  const k = Math.min(1, dt * 4);
  a.crawl += ((o.crawl || 0) - a.crawl) * k;
  a.shield += ((o.shield || 0) - a.shield) * Math.min(1, dt * 8);
  a.rear += ((o.rear || 0) - a.rear) * Math.min(1, dt * 10);
  a.amp += (Math.min(1, (o.speed || 0) / 2.5) - a.amp) * Math.min(1, dt * 6);
  a.phase += dt * (1.1 + (o.speed || 0) * (a.crawl > 0.5 ? 3.4 : 2.0));
  a.flare = Math.max(0, a.flare - dt * 2.2);
  const want = Math.max(o.listening ? 0.55 : 0, a.flare, a.rear) * (1 - a.shield);
  a.open += (want - a.open) * Math.min(1, dt * 9);
  if ((a.twitch -= dt) <= 0) {
    a.twitch = o.listening ? 0.12 + Math.random() * 0.5 : 0.6 + Math.random() * 2.2;
    a.twitchX = (Math.random() - 0.5) * (o.listening ? 0.22 : 0.08);
    a.twitchY = (Math.random() - 0.5) * (o.listening ? 0.12 : 0.05) - (o.listening ? 0.06 : 0);
  }
  joints(a); hang(a);
}

/** World position of the middle of its skull: where its clicks come from, and what the catch looks at. */
export function headOf(a) { const h = a.parts[SKULL]; return [(h.ax + h.bx) / 2, (h.ay + h.by) / 2, (h.az + h.bz) / 2]; }

export function makeFigure() { return makeBody(MAT.FLESH, {on: false}); }

export function makeStatue() { return makeBody(MAT.PROP, {on: true, solid: true}); }
