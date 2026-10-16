// WebGL drawing. The level itself is never shown: its geometry only fills the depth buffer so dots
// behind walls stay hidden. Moving actors are drawn into depth too, so the creature blots out the
// dots behind it even before a single ray has landed on it.

import {DotBuffer, STRIDE} from './dots.js';
import {GunRenderer} from './gun.js';
import {TrackerRenderer} from './tracker.js';

const OCC_VS = 'attribute vec3 aPos;uniform mat4 uVP;void main(){gl_Position=uVP*vec4(aPos,1.0);}';
const OCC_FS = 'precision mediump float;void main(){gl_FragColor=vec4(0.0,0.0,0.0,1.0);}';

const PT_VS = `
attribute vec3 aPos; attribute float aBirth; attribute vec3 aCol; attribute float aSize;
uniform mat4 uVP; uniform vec3 uEye; uniform float uTime,uLife,uPx,uMin,uMax,uGain;
varying vec3 vCol;
void main(){
  float age=uTime-aBirth; float k=1.0-age/uLife;
  if(k<=0.0){ gl_Position=vec4(2.0,2.0,2.0,1.0); gl_PointSize=1.0; vCol=vec3(0.0); return; }
  vec3 toEye=uEye-aPos; float d=max(length(toEye),0.001);
  vec3 p=aPos+toEye/d*min(0.05,0.01+0.004*d);
  gl_Position=uVP*vec4(p,1.0);
  float raw=uPx*aSize/max(gl_Position.w,0.05);
  float flash=exp(-age*6.0);
  gl_PointSize=clamp(raw*(1.0+flash*0.8),uMin,uMax);
  float fade=k*(2.0-k);
  float thin=clamp(raw/uMin,0.3,1.0);
  vCol=(aCol+vec3(flash*0.55))*fade*thin*0.9*uGain;
}`;
const PT_FS = `
precision mediump float; varying vec3 vCol;
void main(){ vec2 c=gl_PointCoord-0.5; float d=dot(c,c)*4.0; float a=1.0-smoothstep(0.3,1.0,d); gl_FragColor=vec4(vCol*a,1.0); }`;

const LN_VS = 'attribute vec3 aPos;attribute vec4 aCol;uniform mat4 uVP;varying vec4 vCol;void main(){vCol=aCol;gl_Position=uVP*vec4(aPos,1.0);}';
const LN_FS = 'precision mediump float;varying vec4 vCol;void main(){gl_FragColor=vec4(vCol.rgb*vCol.a,1.0);}';

export const LINE_MAX = 28;
const FAN_MAX = 64;   // triangles in the sweep's sheet of light

/** Append triangles for one primitive to `v`. `seg` controls tessellation of round shapes. */
export function primMesh(v, p, seg = 14) {
  const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) =>
    v.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
  if (p.k === 0) {
    const {x0, y0, z0, x1, y1, z1} = p;
    quad(x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0); quad(x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1);
    quad(x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0); quad(x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0);
    quad(x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1); quad(x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1);
  } else if (p.k === 1) {
    for (let i = 0; i < seg; i++) {
      const a0 = i / seg * 6.2832, a1 = (i + 1) / seg * 6.2832;
      const ax = p.x + Math.cos(a0) * p.r, az = p.z + Math.sin(a0) * p.r, bx = p.x + Math.cos(a1) * p.r, bz = p.z + Math.sin(a1) * p.r;
      quad(ax, p.y0, az, bx, p.y0, bz, bx, p.y1, bz, ax, p.y1, az);
      v.push(p.x, p.y1, p.z, ax, p.y1, az, bx, p.y1, bz);
      if (p.y0 > 0) v.push(p.x, p.y0, p.z, ax, p.y0, az, bx, p.y0, bz);
    }
  } else if (p.k === 3) { // capsule: a tube with a little cone at each end standing in for the round caps
    const n = Math.max(6, seg >> 1);
    let ex = p.bx - p.ax, ey = p.by - p.ay, ez = p.bz - p.az;
    const len = Math.hypot(ex, ey, ez) || 1; ex /= len; ey /= len; ez /= len;
    // two directions square to the axis
    let ux = -ez, uy = 0, uz = ex;
    if (Math.abs(ey) > 0.9) { ux = 1; uy = 0; uz = 0; }
    const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
    const wx = ey * uz - ez * uy, wy = ez * ux - ex * uz, wz = ex * uy - ey * ux;
    const ring = (cx, cy, cz, j) => { const a = j / n * 6.2832, c = Math.cos(a) * p.r, s = Math.sin(a) * p.r;
      return [cx + ux * c + wx * s, cy + uy * c + wy * s, cz + uz * c + wz * s]; };
    const ta = [p.ax - ex * p.r, p.ay - ey * p.r, p.az - ez * p.r], tb = [p.bx + ex * p.r, p.by + ey * p.r, p.bz + ez * p.r];
    for (let j = 0; j < n; j++) {
      const a0 = ring(p.ax, p.ay, p.az, j), a1 = ring(p.ax, p.ay, p.az, j + 1), b0 = ring(p.bx, p.by, p.bz, j), b1 = ring(p.bx, p.by, p.bz, j + 1);
      quad(...a0, ...a1, ...b1, ...b0);
      v.push(...ta, ...a1, ...a0, ...tb, ...b0, ...b1);
    }
  } else {
    const LA = Math.max(4, (seg >> 1) + 1), LO = seg;
    const pt = (i, j) => {
      const th = i / LA * Math.PI, ph = j / LO * 6.2832, s = Math.sin(th);
      return [p.x + p.r * s * Math.cos(ph), p.y + p.r * Math.cos(th), p.z + p.r * s * Math.sin(ph)];
    };
    for (let i = 0; i < LA; i++) for (let j = 0; j < LO; j++) {
      const a = pt(i, j), b = pt(i, j + 1), c = pt(i + 1, j + 1), d = pt(i + 1, j);
      quad(...a, ...b, ...c, ...d);
    }
  }
}

/** Depth-only mesh for the whole level: floor, ceilings, wall faces where heights change, props. */
export function levelMesh(world, CELL) {
  const v = [];
  const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) =>
    v.push(ax, ay, az, bx, by, bz, cx, cy, cz, ax, ay, az, cx, cy, cz, dx, dy, dz);
  const W = world.w, H = world.h;
  quad(0, 0, 0, W * CELL, 0, 0, W * CELL, 0, H * CELL, 0, 0, H * CELL);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const h = world.height(x, z); if (!h) continue;
    const x0 = x * CELL, x1 = x0 + CELL, z0 = z * CELL, z1 = z0 + CELL;
    quad(x0, h, z0, x1, h, z0, x1, h, z1, x0, h, z1);
    let n;
    n = world.height(x - 1, z); if (n < h) quad(x0, n, z0, x0, n, z1, x0, h, z1, x0, h, z0);
    n = world.height(x + 1, z); if (n < h) quad(x1, n, z0, x1, n, z1, x1, h, z1, x1, h, z0);
    n = world.height(x, z - 1); if (n < h) quad(x0, n, z0, x1, n, z0, x1, h, z0, x0, h, z0);
    n = world.height(x, z + 1); if (n < h) quad(x0, n, z1, x1, n, z1, x1, h, z1, x0, h, z1);
  }
  for (const p of world.props) if (p.on) primMesh(v, p);
  return new Float32Array(v);
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', {antialias: false, alpha: false, depth: true, powerPreference: 'high-performance'});
    this.gl = gl;
    if (!gl) return;
    this.occ = this.program(OCC_VS, OCC_FS, ['aPos'], ['uVP']);
    this.pt = this.program(PT_VS, PT_FS, ['aPos', 'aBirth', 'aCol', 'aSize'], ['uVP', 'uEye', 'uTime', 'uLife', 'uPx', 'uMin', 'uMax', 'uGain']);
    this.ln = this.program(LN_VS, LN_FS, ['aPos', 'aCol'], ['uVP']);
    this.occBuf = gl.createBuffer(); this.occCount = 0; this.occVersion = -1;
    this.dynBuf = gl.createBuffer(); this.dynCount = 0;
    this.ghostBuf = gl.createBuffer(); this.ghostCount = 0;
    this.dots = null; this.dotBuf = gl.createBuffer();
    this.lines = new Float32Array(LINE_MAX * 14); this.lineN = 0;
    this.lnBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lnBuf); gl.bufferData(gl.ARRAY_BUFFER, this.lines, gl.DYNAMIC_DRAW);
    this.fan = new Float32Array(FAN_MAX * 3 * 7); this.fanN = 0;
    this.fanBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fanBuf); gl.bufferData(gl.ARRAY_BUFFER, this.fan, gl.DYNAMIC_DRAW);
    this.dpr = 1; this.w = 0; this.h = 0;
    this.dynVerts = [];
    this.gun = new GunRenderer(gl);
    this.tracker = new TrackerRenderer(gl);
    this.skipPoints = false;   // test hook: headless Chromium on Android cannot draw points
  }

  program(vs, fs, attribs, uniforms) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    const u = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(p, name);
    return {p, u};
  }

  attribs(n) {
    const gl = this.gl;
    for (let i = 0; i < 4; i++) { if (i < n) gl.enableVertexAttribArray(i); else gl.disableVertexAttribArray(i); }
  }

  /** Match the drawing buffer to the element size. Returns true when the size changed. */
  resize(w, h, maxDpr) {
    const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return false;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    return true;
  }

  setDots(capacity) {
    const gl = this.gl;
    if (!this.dots || this.dots.cap !== capacity) {
      this.dots = new DotBuffer(capacity);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dotBuf);
      gl.bufferData(gl.ARRAY_BUFFER, this.dots.data.byteLength, gl.DYNAMIC_DRAW);
    }
    this.dots.clear();
    return this.dots;
  }

  setLevelMesh(verts) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.occBuf);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    this.occCount = verts.length / 3;
  }

  setGhosts(data) {
    const gl = this.gl;
    this.ghostData = data;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostBuf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.ghostCount = data.length / STRIDE;
  }

  /** Rebuild the depth mesh of moving actors (a few hundred triangles, cheap to redo every frame). */
  setActors(actors) {
    const v = this.dynVerts; v.length = 0;
    for (const a of actors) if (a.on) for (const p of a.parts) primMesh(v, p, 8);
    this.dynCount = v.length / 3;
    if (!v.length) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.DYNAMIC_DRAW);
  }

  addLine(ax, ay, az, bx, by, bz, r, g, b, a0, a1) {
    if (this.lineN >= LINE_MAX) return;
    const q = this.lineN * 14, L = this.lines;
    L[q] = ax; L[q + 1] = ay; L[q + 2] = az; L[q + 3] = r; L[q + 4] = g; L[q + 5] = b; L[q + 6] = a0;
    L[q + 7] = bx; L[q + 8] = by; L[q + 9] = bz; L[q + 10] = r; L[q + 11] = g; L[q + 12] = b; L[q + 13] = a1;
    this.lineN++;
  }

  /**
   * A translucent sheet from the emitter (ox, oy, oz) through a row of hit points ([x, y, z, dist] or
   * null). Neighbours at very different depths are not joined, so the sheet never bridges a gap.
   */
  addFan(ox, oy, oz, pts, r, g, b) {
    const F = this.fan;
    const put = (x, y, z, a) => { const q = this.fanN * 7; F[q] = x; F[q + 1] = y; F[q + 2] = z; F[q + 3] = r; F[q + 4] = g; F[q + 5] = b; F[q + 6] = a; this.fanN++; };
    for (let i = 0; i + 1 < pts.length && this.fanN + 3 <= FAN_MAX * 3; i++) {
      const p = pts[i], q = pts[i + 1];
      if (!p || !q || Math.max(p[3], q[3]) > Math.min(p[3], q[3]) * 1.4) continue;
      put(ox, oy, oz, 0.2); put(p[0], p[1], p[2], 0.035); put(q[0], q[1], q[2], 0.035);
    }
  }

  uploadDots(t) {
    const d = this.dots, gl = this.gl;
    const [from, to] = d.endFrame(t);
    if (to <= from) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dotBuf);
    const a = from % d.cap, n = to - from, data = d.data;
    if (a + n <= d.cap) gl.bufferSubData(gl.ARRAY_BUFFER, a * STRIDE * 4, data.subarray(a * STRIDE, (a + n) * STRIDE));
    else {
      gl.bufferSubData(gl.ARRAY_BUFFER, a * STRIDE * 4, data.subarray(a * STRIDE));
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, (a + n - d.cap) * STRIDE));
    }
  }

  pointAttribs() {
    const gl = this.gl;
    this.attribs(4);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 32, 12);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 32, 16); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 32, 28);
  }

  draw(cam, t, life, ghostGain, gun = null, trk = null) {
    const gl = this.gl;
    this.uploadDots(t);
    gl.clearColor(0, 0, 0, 1); gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.disable(gl.BLEND);

    // depth only: level, then actors
    gl.useProgram(this.occ.p); gl.uniformMatrix4fv(this.occ.u.uVP, false, cam.vp);
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 2);
    gl.colorMask(false, false, false, false);
    this.attribs(1);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.occBuf); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, this.occCount);
    if (this.dynCount) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, this.dynCount);
    }
    gl.colorMask(true, true, true, true); gl.disable(gl.POLYGON_OFFSET_FILL);

    // dots, added together so dense areas glow
    gl.depthMask(false); gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
    const P = this.pt;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, cam.vp); gl.uniform3f(P.u.uEye, cam.ex, cam.ey, cam.ez);
    gl.uniform1f(P.u.uPx, this.canvas.height * 0.5 / Math.tan(cam.vfov / 2));
    gl.uniform1f(P.u.uMin, 1.6 * this.dpr); gl.uniform1f(P.u.uMax, 13 * this.dpr);

    if (this.ghostCount && ghostGain > 0 && !this.skipPoints) {
      // old operator's dots: birth far in the past and a huge lifetime keeps them steady and dim
      gl.uniform1f(P.u.uTime, 0); gl.uniform1f(P.u.uLife, 1e9); gl.uniform1f(P.u.uGain, ghostGain);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostBuf); this.pointAttribs();
      gl.drawArrays(gl.POINTS, 0, this.ghostCount);
    }

    const d = this.dots;
    const oldest = d.oldestLive(t, life), count = d.written - oldest;
    if (count > 0 && !this.skipPoints) {
      gl.uniform1f(P.u.uTime, t); gl.uniform1f(P.u.uLife, life); gl.uniform1f(P.u.uGain, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dotBuf); this.pointAttribs();
      const a = oldest % d.cap;
      if (a + count <= d.cap) gl.drawArrays(gl.POINTS, a, count);
      else { gl.drawArrays(gl.POINTS, a, d.cap - a); gl.drawArrays(gl.POINTS, 0, a + count - d.cap); }
    }

    if (this.lineN > 0) {
      gl.useProgram(this.ln.p); gl.uniformMatrix4fv(this.ln.u.uVP, false, cam.vp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lnBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lines.subarray(0, this.lineN * 14));
      this.attribs(2); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.drawArrays(gl.LINES, 0, this.lineN * 2);
    }
    if (this.fanN > 0) {
      gl.useProgram(this.ln.p); gl.uniformMatrix4fv(this.ln.u.uVP, false, cam.vp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fanBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.fan.subarray(0, this.fanN * 7));
      this.attribs(2); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.drawArrays(gl.TRIANGLES, 0, this.fanN);
    }
    this.fanLast = this.fanN; // kept for the smoke test's 2D redraw
    this.lineN = 0; this.fanN = 0;
    // the hand-held devices: depth cleared once, so neither sinks into a wall but they overlap properly
    if (gun || trk) { gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); } // clear obeys the mask the dots left off
    if (gun) { gun.proj = cam.proj; this.gun.draw(gun); }
    if (trk) { trk.proj = cam.proj; this.tracker.draw(trk); }
  }
}
