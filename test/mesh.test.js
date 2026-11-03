// The hand-held devices' geometry: built in code, so a slip must show up here rather than on screen.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildGunMesh, GUN_STRIDE, GMAT, MUZZLE} from '../src/render/gunmesh.js';
import {buildTrackerMesh, TRACKER_STRIDE, TMAT, TRACKER_SCREEN} from '../src/render/trackermesh.js';
import {pose} from '../src/game/viewmodel.js';
import {mat4, translate, rotateX, rotateY, rotateZ, scale} from '../src/util/mat4.js';

const vertices = (m, stride) => { const out = []; for (let i = 0; i < m.length; i += stride) out.push(m.subarray(i, i + stride)); return out; };
const finite = (name, m) => assert.ok(m.every(Number.isFinite), `${name}: not a number in the mesh`);
const unit = (name, vs) => { for (const v of vs) assert.ok(Math.abs(Math.hypot(v[3], v[4], v[5]) - 1) < 0.02 || Math.hypot(v[3], v[4], v[5]) > 0.2, `${name}: a bad normal`); };

test('the gun mesh: whole, within budget, and nothing past the emitter tip', () => {
  const m = buildGunMesh(), vs = vertices(m, GUN_STRIDE);
  finite('gun', m); unit('gun', vs);
  assert.ok(vs.length / 3 < 2400, `${vs.length / 3} triangles`);
  assert.equal(vs.length % 3, 0);
  // every dot leaves the emitter: the tip is where it has always been, and nothing is further forward
  assert.deepEqual(MUZZLE, [0, 0.003, -0.278]);
  assert.ok(Math.min(...vs.map(v => v[2])) >= MUZZLE[2] - 1e-6, 'nothing sticks out past the lens');
  const lens = vs.filter(v => v[8] === GMAT.LENS);
  assert.ok(lens.some(v => Math.abs(v[2] - MUZZLE[2]) < 1e-6 && Math.abs(v[0] - MUZZLE[0]) < 1e-6 && Math.abs(v[1] - MUZZLE[1]) < 1e-6), 'the lens is centred on the tip');
});

test('the gun has one screen, and it faces you', () => {
  const vs = vertices(buildGunMesh(), GUN_STRIDE).filter(v => v[8] === GMAT.SCREEN);
  assert.equal(vs.length, 6);
  assert.ok(vs.every(v => v[5] === 1), 'it looks back at you');
  assert.deepEqual([...new Set(vs.map(v => v[6]))].sort(), [0, 1]);
});

test('the tracker mesh: whole, within budget, with its tube sunk behind the casing', () => {
  const m = buildTrackerMesh(), vs = vertices(m, TRACKER_STRIDE);
  finite('tracker', m); unit('tracker', vs);
  assert.ok(vs.length / 3 < 2200, `${vs.length / 3} triangles`);
  const S = TRACKER_SCREEN, tube = vs.filter(v => v[8] === TMAT.SCREEN), digits = vs.filter(v => v[8] === TMAT.DIGITS);
  assert.equal(tube.length, 6); assert.equal(digits.length, 6);
  assert.ok(tube.every(v => v[2] === +S.z.toFixed(6) || Math.abs(v[2] - S.z) < 1e-6), 'the tube at its depth');
  const mouth = Math.max(...vs.filter(v => v[8] === TMAT.FUNNEL).map(v => v[2]));
  assert.ok(mouth - S.z > 0.01, `sunk ${mouth - S.z} m`);
  // the fan needs width: about 3:2 or wider, or its sides would be cut off
  assert.ok((S.x1 - S.x0) / (S.y1 - S.y0) > 1.5);
});

test('stencilled letters remember what to mirror about, so a left-handed tracker still reads', () => {
  const vs = vertices(buildTrackerMesh(), TRACKER_STRIDE).filter(v => v[8] === TMAT.STENCIL);
  assert.ok(vs.length > 60, 'it has lettering');
  for (const v of vs) assert.ok(Math.abs(v[6] - v[0]) < 0.07, 'its own mirror line is nearby');
});

test('the pose shortcut is exactly the matrix the helpers would make', () => {
  for (const [x, y, z, yw, pt, rl, s] of [[0.2, -0.1, -0.46, 0.04, 0.05, 0.02, 0.8], [-0.2, 0.1, -0.3, -0.5, 1.1, -0.7, 1.1], [0, 0, 0, 2, -2, 3, -0.8]]) {
    const a = mat4(); translate(a, x, y, z); rotateY(a, yw); rotateX(a, pt); rotateZ(a, rl); scale(a, s, Math.abs(s), Math.abs(s));
    const b = pose(mat4(), x, y, z, yw, pt, rl, s, Math.abs(s), Math.abs(s));
    a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 1e-5, `element ${i}: ${v} vs ${b[i]}`));
  }
});
