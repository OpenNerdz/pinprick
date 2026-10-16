// The hand-held devices' geometry: built in code, so a refactor must not move a single vertex.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildGunMesh} from '../src/render/gunmesh.js';

const checksum = m => { let h = 0; for (let i = 0; i < m.length; i++) h = (h * 31 + Math.round(m[i] * 1e5)) | 0; return h; };

test('the gun mesh is exactly the one it has always been', () => {
  const m = buildGunMesh();
  assert.equal(m.length, 16902);
  assert.equal(checksum(m), 1615661600);
});
