// The sweep must paint the whole view, in portrait and landscape, and its light must come from the gun.
// (It once fired the eye's grid from the gun tip 0.7 m ahead, which squeezed the picture toward the
// middle and left the screen edges empty.)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {LEVELS} from '../src/levels/index.js';
import {Session} from '../src/game/session.js';
import {Camera} from '../src/render/camera.js';

const noop = () => {};
const sounds = new Proxy({e: {listener: {x: 0, z: 0, yaw: 0}, place: () => ({pan: 0, dist: 1, front: 1}), now: 0}}, {get: (t, k) => (k in t ? t[k] : noop)});
const idle = () => ({moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false});

function sweepFrom(W, H, place) {
  const pts = [], fans = [];
  let s = null;
  const dots = {push: (x, y, z) => pts.push([x, y, z]), total: 0, clear: noop};
  const renderer = {setDots: () => dots, setGhosts: noop, setLevelMesh: noop, setActors: noop, addLine: noop,
    addFan: (ox, oy, oz, row) => fans.push({o: [ox, oy, oz], m: [...s.viewmodel.muzzle], n: row.filter(Boolean).length})};
  s = new Session(LEVELS[1], {difficulty: 'normal', seed: 3, renderer, sounds, ui: {say: noop, note: noop, caught: noop, won: noop, cores: noop}});
  const cam = new Camera(); cam.resize(W, H);
  const view = {w: W, h: H};
  Object.assign(s.player, place);
  let t = 0; const dt = 1 / 60;
  s.update(dt, t, idle(), cam, view);
  pts.length = 0;
  const go = idle(); go.sweep = true;
  s.update(dt, t += dt, go, cam, view);
  while (s.scanner.sweeping) s.update(dt, t += dt, idle(), cam, view);
  // which cells of a 16 x 9 screen grid got at least one dot
  const vp = cam.vp, G = 16, R = 9, hitCells = new Set();
  for (const [x, y, z] of pts) {
    const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (w < 0.05) continue;
    const nx = (vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w, ny = (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w;
    const gx = Math.floor((nx + 1) / 2 * G), gy = Math.floor((1 - ny) / 2 * R);
    if (gx >= 0 && gx < G && gy >= 0 && gy < R) hitCells.add(gy * G + gx);
  }
  return {covered: hitCells.size / (G * R), fans, muzzle: [...s.viewmodel.muzzle], clear: s.viewmodel.muzzleClear};
}

for (const [W, H, label] of [[1280, 720, 'landscape'], [412, 915, 'portrait']]) {
  test(`a sweep covers the whole ${label} view`, () => {
    for (const place of [{x: 17, z: 24.6, yaw: 0, pitch: 0.12}, {x: 6, z: 20, yaw: -0.8, pitch: -0.1}, {x: 19, z: 36, yaw: 0, pitch: 0}]) {
      const r = sweepFrom(W, H, place);
      assert.ok(r.covered >= 0.97, `only ${(r.covered * 100).toFixed(0)}% of the screen got dots from ${JSON.stringify(place)}`);
    }
  });
}

test("the sweep's sheet of light starts at the gun's emitter", () => {
  const r = sweepFrom(1280, 720, {x: 17, z: 24.6, yaw: 0, pitch: 0.12});
  assert.ok(r.clear, 'emitter is in open air');
  assert.ok(r.fans.length > 50, `${r.fans.length} sheet frames`);
  assert.ok(r.fans.every(f => Math.hypot(f.o[0] - f.m[0], f.o[1] - f.m[1], f.o[2] - f.m[2]) < 1e-6), 'every sheet starts at the emitter');
  assert.ok(r.fans.some(f => f.n > 20), 'sheets span the view');
});
