// WebGL drawing. The level itself is never shown: its geometry only fills the depth buffer so dots
// behind walls stay hidden. Moving actors are drawn into depth too, so the creature blots out the
// dots behind it even before a single ray has landed on it.

import {DotBuffer, STRIDE} from './dots.js';
import {GunRenderer} from './gun.js';
import {TrackerRenderer} from './tracker.js';
import {PostFx} from './post.js';

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
const LN_FS = 'precision mediump float;uniform float uGain;varying vec4 vCol;void main(){gl_FragColor=vec4(vCol.rgb*vCol.a*uGain,1.0);}';

export const LINE_MAX = 28;
const FAN_MAX = 64;   // triangles in the sweep's sheet of light
const ACTOR_SEG = 8;  // how finely moving actors' round parts are cut

// quality: a frame this long, this often, two windows running, means the post pass goes
const SLOW_FRAME_MS = 25, SLOW_WINDOW = 90, SLOW_SHARE = 0.7;
const LOW_DPR = 1.5;  // and the drawing buffer stops at this many pixels per CSS pixel
// a context that keeps dying is not coming back; stop asking for it
const MAX_LOSSES = 4, LOSS_WINDOW_MS = 60000;

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

// The creature is re-cut every frame it moves, so its parts are written straight into a typed array from
// tables of unit shapes. Same vertices as primMesh(v, p, ACTOR_SEG), without a single array along the way.
const LA = Math.max(4, (ACTOR_SEG >> 1) + 1), RING = Math.max(6, ACTOR_SEG >> 1);
const SPHERE = (() => {
  const T = [];
  primMesh(T, {k: 2, x: 0, y: 0, z: 0, r: 1}, ACTOR_SEG);
  return new Float32Array(T);
})();
const CYL_C = new Float64Array(ACTOR_SEG + 1), CYL_S = new Float64Array(ACTOR_SEG + 1);
for (let i = 0; i <= ACTOR_SEG; i++) { CYL_C[i] = Math.cos(i / ACTOR_SEG * 6.2832); CYL_S[i] = Math.sin(i / ACTOR_SEG * 6.2832); }
const RING_C = new Float64Array(RING + 1), RING_S = new Float64Array(RING + 1);
for (let i = 0; i <= RING; i++) { RING_C[i] = Math.cos(i / RING * 6.2832); RING_S[i] = Math.sin(i / RING * 6.2832); }
const PART_FLOATS = [108, ACTOR_SEG * 36, SPHERE.length, RING * 36]; // the most a part of kind k can write

function tri(F, o, ax, ay, az, bx, by, bz, cx, cy, cz) {
  F[o] = ax; F[o + 1] = ay; F[o + 2] = az; F[o + 3] = bx; F[o + 4] = by; F[o + 5] = bz; F[o + 6] = cx; F[o + 7] = cy; F[o + 8] = cz;
  return o + 9;
}
function quad4(F, o, ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) {
  o = tri(F, o, ax, ay, az, bx, by, bz, cx, cy, cz);
  return tri(F, o, ax, ay, az, cx, cy, cz, dx, dy, dz);
}

/** Write one primitive at offset o of F; returns the new offset. */
function writePart(F, o, p) {
  if (p.k === 0) {
    const x0 = p.x0, y0 = p.y0, z0 = p.z0, x1 = p.x1, y1 = p.y1, z1 = p.z1;
    o = quad4(F, o, x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0); o = quad4(F, o, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1);
    o = quad4(F, o, x0, y0, z0, x0, y0, z1, x0, y1, z1, x0, y1, z0); o = quad4(F, o, x1, y0, z0, x1, y0, z1, x1, y1, z1, x1, y1, z0);
    o = quad4(F, o, x0, y1, z0, x1, y1, z0, x1, y1, z1, x0, y1, z1);
    return quad4(F, o, x0, y0, z0, x1, y0, z0, x1, y0, z1, x0, y0, z1);
  }
  if (p.k === 1) {
    const x = p.x, z = p.z, r = p.r, y0 = p.y0, y1 = p.y1;
    for (let i = 0; i < ACTOR_SEG; i++) {
      const ax = x + CYL_C[i] * r, az = z + CYL_S[i] * r, bx = x + CYL_C[i + 1] * r, bz = z + CYL_S[i + 1] * r;
      o = quad4(F, o, ax, y0, az, bx, y0, bz, bx, y1, bz, ax, y1, az);
      o = tri(F, o, x, y1, z, ax, y1, az, bx, y1, bz);
      if (y0 > 0) o = tri(F, o, x, y0, z, ax, y0, az, bx, y0, bz);
    }
    return o;
  }
  if (p.k === 3) {
    const r = p.r, ax = p.ax, ay = p.ay, az = p.az, bx = p.bx, by = p.by, bz = p.bz;
    let ex = bx - ax, ey = by - ay, ez = bz - az;
    const len = Math.hypot(ex, ey, ez) || 1; ex /= len; ey /= len; ez /= len;
    let ux = -ez, uz = ex;
    if (Math.abs(ey) > 0.9) { ux = 1; uz = 0; }
    const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
    const wx = ey * uz, wy = ez * ux - ex * uz, wz = -ey * ux;
    const tax = ax - ex * r, tay = ay - ey * r, taz = az - ez * r, tbx = bx + ex * r, tby = by + ey * r, tbz = bz + ez * r;
    for (let j = 0; j < RING; j++) {
      const c0 = RING_C[j] * r, s0 = RING_S[j] * r, c1 = RING_C[j + 1] * r, s1 = RING_S[j + 1] * r;
      const dx0 = ux * c0 + wx * s0, dy0 = wy * s0, dz0 = uz * c0 + wz * s0, dx1 = ux * c1 + wx * s1, dy1 = wy * s1, dz1 = uz * c1 + wz * s1;
      o = quad4(F, o, ax + dx0, ay + dy0, az + dz0, ax + dx1, ay + dy1, az + dz1, bx + dx1, by + dy1, bz + dz1, bx + dx0, by + dy0, bz + dz0);
      o = tri(F, o, tax, tay, taz, ax + dx1, ay + dy1, az + dz1, ax + dx0, ay + dy0, az + dz0);
      o = tri(F, o, tbx, tby, tbz, bx + dx0, by + dy0, bz + dz0, bx + dx1, by + dy1, bz + dz1);
    }
    return o;
  }
  const x = p.x, y = p.y, z = p.z, r = p.r;
  for (let i = 0; i < SPHERE.length; i += 3) {
    F[o] = x + SPHERE[i] * r; F[o + 1] = y + SPHERE[i + 1] * r; F[o + 2] = z + SPHERE[i + 2] * r;
    o += 3;
  }
  return o;
}

/** Store eight numbers in the signature at n. True when they were all already there. */
function same8(S, n, a, b, c, d, e, f, g, h) {
  const same = S[n] === a && S[n + 1] === b && S[n + 2] === c && S[n + 3] === d && S[n + 4] === e && S[n + 5] === f && S[n + 6] === g && S[n + 7] === h;
  if (!same) { S[n] = a; S[n + 1] = b; S[n + 2] = c; S[n + 3] = d; S[n + 4] = e; S[n + 5] = f; S[n + 6] = g; S[n + 7] = h; }
  return same;
}

/** Is WebGL running on the CPU? Antialiasing is fixed when a context is made, so this asks a throwaway one. */
function softwareGL() {
  try {
    const g = document.createElement('canvas').getContext('webgl');
    if (!g) return false;
    const info = g.getExtension('WEBGL_debug_renderer_info');
    const name = info ? String(g.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    g.getExtension('WEBGL_lose_context')?.loseContext();
    return /swiftshader|llvmpipe|lavapipe|software|basic render/i.test(name);
  } catch (e) { return false; }
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    // antialias: the canvas's own samples smooth the devices' edges; the dots go through the off-screen
    // buffer, and the resolve is a single triangle, so this costs little more than the memory
    this.software = softwareGL(); // no usable GPU: every sample costs the CPU, so no antialiasing, and start low
    const gl = canvas.getContext('webgl', {antialias: !this.software, alpha: false, depth: true, powerPreference: 'high-performance'});
    this.gl = gl;
    if (!gl) return;
    this.dots = null;
    this.occVerts = null; this.occCount = 0; this.occVersion = -1;
    this.ghostData = null; this.ghostCount = 0;
    this.dynData = new Float32Array(16384); this.dynView = this.dynData.subarray(0, 0); this.dynCount = 0; this.dynCap = 0;
    this.actorSig = new Float64Array(1024); this.actorSigN = 0;
    this.lines = new Float32Array(LINE_MAX * 14); this.lineN = 0;
    this.fan = new Float32Array(FAN_MAX * 3 * 7); this.fanN = 0; this.fanLast = 0;
    this.dpr = 1; this.w = 0; this.h = 0;
    this.skipPoints = false;   // test hook: headless Chromium on Android cannot draw points

    this.post = null; this.postTried = false;
    this.postTier = 'none';    // what the picture is going through: 'hdr' | 'ldr' | 'lite' | 'none' (straight to the canvas)
    this.q = this.software ? 'low' : 'high'; // see `quality`
    this.autoQuality = true;
    this.lastFrame = 0; this.frameN = 0; this.slowN = 0; this.slowWindows = 0;
    this.fear = 0; this.ping = 0;
    this.reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    this.lost = false;         // the GPU context is gone; everything here is kept for when it returns
    this.losses = [];
    this.onContextLost = null; this.onContextRestored = null;
    canvas.addEventListener('webglcontextlost', e => this.contextLost(e));
    canvas.addEventListener('webglcontextrestored', () => this.contextRestored());
    this.initGL();
  }

  /** Every object on the GPU, made from what is kept here. Runs at the start and after a lost context. */
  initGL() {
    const gl = this.gl;
    this.occ = this.program(OCC_VS, OCC_FS, ['aPos'], ['uVP']);
    this.pt = this.program(PT_VS, PT_FS, ['aPos', 'aBirth', 'aCol', 'aSize'], ['uVP', 'uEye', 'uTime', 'uLife', 'uPx', 'uMin', 'uMax', 'uGain']);
    this.ln = this.program(LN_VS, LN_FS, ['aPos', 'aCol'], ['uVP', 'uGain']);
    this.occBuf = gl.createBuffer();
    this.dynBuf = gl.createBuffer(); this.dynCap = 0;
    this.ghostBuf = gl.createBuffer();
    this.dotBuf = gl.createBuffer();
    this.lnBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lnBuf); gl.bufferData(gl.ARRAY_BUFFER, this.lines, gl.DYNAMIC_DRAW);
    this.fanBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fanBuf); gl.bufferData(gl.ARRAY_BUFFER, this.fan, gl.DYNAMIC_DRAW);
    this.gun = new GunRenderer(gl);
    this.tracker = new TrackerRenderer(gl);
    this.post = null; this.postTried = false;
    if (this.occVerts) { gl.bindBuffer(gl.ARRAY_BUFFER, this.occBuf); gl.bufferData(gl.ARRAY_BUFFER, this.occVerts, gl.STATIC_DRAW); }
    if (this.ghostData) { gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostBuf); gl.bufferData(gl.ARRAY_BUFFER, this.ghostData, gl.STATIC_DRAW); }
    if (this.dots) { // the whole ring, in place: the dots on screen when it went are still on screen
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dotBuf); gl.bufferData(gl.ARRAY_BUFFER, this.dots.data, gl.DYNAMIC_DRAW);
      this.dots.flushed = this.dots.written;
    }
    if (this.dynCount) this.uploadActors();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  contextLost(e) {
    if (this.skipPoints) return; // headless Chromium on Android loses it on every draw; the smoke test carries on without
    const now = performance.now();
    this.losses = this.losses.filter(t => now - t < LOSS_WINDOW_MS);
    this.losses.push(now);
    if (this.losses.length <= MAX_LOSSES) e.preventDefault(); // without this the browser never gives it back
    this.lost = true;
    this.post = null;
    this.onContextLost?.();
  }

  contextRestored() {
    this.lost = false;
    this.initGL();
    this.onContextRestored?.();
  }

  /**
   * 'high' is the full post pass; 'low' drops it and caps the resolution. Setting either turns the automatic
   * drop off; 'auto' puts it back, starting from what this machine would have started on.
   */
  get quality() { return this.q; }
  set quality(v) {
    this.autoQuality = v === 'auto';
    this.setQuality(v === 'auto' ? (this.software ? 'low' : 'high') : v);
  }

  setQuality(v) {
    if (v !== 'high' && v !== 'low') return;
    this.q = v;
    this.frameN = this.slowN = this.slowWindows = 0;
    if (this.post && !this.lost) this.post.dispose();
    this.post = null; this.postTried = false; this.postTier = 'none';
    this.w = 0; // the resolution cap changes with it; the next resize() applies it
  }

  /** Watch the time between frames; when it stays long, give the time back. */
  watchFrames() {
    const now = performance.now(), dt = now - this.lastFrame;
    this.lastFrame = now;
    if (!this.autoQuality || this.q !== 'high') return;
    if (dt > 250) { this.frameN = this.slowN = 0; return; } // a hidden tab or a one-off stall says nothing about the GPU
    this.frameN++;
    if (dt > SLOW_FRAME_MS) this.slowN++;
    if (this.frameN < SLOW_WINDOW) return;
    this.slowWindows = this.slowN >= SLOW_WINDOW * SLOW_SHARE ? this.slowWindows + 1 : 0;
    this.frameN = this.slowN = 0;
    if (this.slowWindows >= 2) this.setQuality('low');
  }

  /** The post pass to draw through this frame, made on first need, or null to draw straight to the canvas. */
  postFor() {
    if (this.skipPoints) return null;
    if (!this.post && !this.postTried) {
      this.postTried = true;
      const p = new PostFx(this.gl, this.q === 'low');
      if (p.ok) this.post = p; else p.dispose();
    }
    if (this.post && this.post.resize(this.canvas.width, this.canvas.height)) {
      this.postTier = this.post.tier;
      return this.post;
    }
    if (this.post) { this.post.dispose(); this.post = null; }
    this.postTier = 'none';
    if (this.q === 'high') { this.setQuality('low'); return this.postFor(); } // nothing to bloom with; try plainer
    return null;
  }

  /** How frightened the picture should look. fear 0..1, ping 0..1 as its sonar washes over you, falling. */
  setFx(fear, ping) { this.fear = fear; this.ping = ping; }

  program(vs, fs, attribs, uniforms) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) console.error(gl.getProgramInfoLog(p));
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
    const dpr = Math.min(maxDpr, this.q === 'low' ? LOW_DPR : maxDpr, window.devicePixelRatio || 1);
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
    this.dots.reset();
    return this.dots;
  }

  setLevelMesh(verts) {
    const gl = this.gl;
    this.occVerts = verts; // kept: a lost context takes the GPU's copy with it
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

  /**
   * The depth mesh of moving actors. One pass over their numbers says whether anything moved; if nothing
   * did, the buffer is already right. Nothing here allocates unless the actors outgrow the arrays.
   */
  setActors(actors) {
    let S = this.actorSig, n = 0, moved = false;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (!a.on) continue;
      const parts = a.parts;
      for (let j = 0; j < parts.length; j++, n += 8) {
        if (n + 8 > S.length) { const T = new Float64Array(S.length * 2); T.set(S); S = this.actorSig = T; }
        const p = parts[j], k = p.k;
        const same = k === 0 ? same8(S, n, 0, p.x0, p.y0, p.z0, p.x1, p.y1, p.z1, 0)
          : k === 1 ? same8(S, n, 1, p.x, p.z, p.r, p.y0, p.y1, 0, 0)
          : k === 3 ? same8(S, n, 3, p.ax, p.ay, p.az, p.bx, p.by, p.bz, p.r)
          : same8(S, n, 2, p.x, p.y, p.z, p.r, 0, 0, 0);
        if (!same) moved = true;
      }
    }
    if (n !== this.actorSigN) moved = true;
    this.actorSigN = n;
    if (!moved) return;

    let F = this.dynData, o = 0;
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i];
      if (!a.on) continue;
      const parts = a.parts;
      for (let j = 0; j < parts.length; j++) {
        const p = parts[j], k = p.k, most = PART_FLOATS[k === 0 ? 0 : k === 1 ? 1 : k === 3 ? 3 : 2];
        if (o + most > F.length) { const T = new Float32Array(F.length * 2); T.set(F); F = this.dynData = T; this.dynCap = 0; this.dynView = F.subarray(0, 0); }
        o = writePart(F, o, p);
      }
    }
    this.dynCount = o / 3;
    if (this.dynView.length !== o) this.dynView = F.subarray(0, o);
    if (o && !this.lost) this.uploadActors();
  }

  uploadActors() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynBuf);
    if (this.dynCap !== this.dynData.length) { gl.bufferData(gl.ARRAY_BUFFER, this.dynData.byteLength, gl.DYNAMIC_DRAW); this.dynCap = this.dynData.length; }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.dynView);
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
    for (let i = 0; i + 1 < pts.length && this.fanN + 3 <= FAN_MAX * 3; i++) {
      const p = pts[i], q = pts[i + 1];
      if (!p || !q || Math.max(p[3], q[3]) > Math.min(p[3], q[3]) * 1.4) continue;
      this.fanVert(ox, oy, oz, r, g, b, 0.2); this.fanVert(p[0], p[1], p[2], r, g, b, 0.035); this.fanVert(q[0], q[1], q[2], r, g, b, 0.035);
    }
  }

  fanVert(x, y, z, r, g, b, a) {
    const F = this.fan, q = this.fanN * 7;
    F[q] = x; F[q + 1] = y; F[q + 2] = z; F[q + 3] = r; F[q + 4] = g; F[q + 5] = b; F[q + 6] = a;
    this.fanN++;
  }

  uploadDots(t) {
    const d = this.dots, gl = this.gl;
    const range = d.endFrame(t), from = range[0], to = range[1];
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
    this.watchFrames();
    if (this.lost) { // nothing can be drawn, but time goes on: the ring is uploaded whole when the context returns
      const d = this.dots;
      if (d) { d.endFrame(t); d.oldestLive(t, life); }
      this.fanLast = this.fanN; this.lineN = 0; this.fanN = 0;
      return;
    }
    const gl = this.gl, post = this.postFor(), full = !!post && !post.lite, light = post ? post.sceneScale : 1;
    this.uploadDots(t);
    if (post) post.bindScene();
    else gl.viewport(0, 0, this.canvas.width, this.canvas.height);
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

    // dots, added together so dense areas glow; in 8 bits with nothing to bring them down again, blended
    // so that they ease up to white rather than clip
    gl.depthMask(false); gl.enable(gl.BLEND);
    if (full) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
    const P = this.pt;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(P.u.uVP, false, cam.vp); gl.uniform3f(P.u.uEye, cam.ex, cam.ey, cam.ez);
    gl.uniform1f(P.u.uPx, this.canvas.height * 0.5 / Math.tan(cam.vfov / 2));
    gl.uniform1f(P.u.uMin, 1.6 * this.dpr); gl.uniform1f(P.u.uMax, 13 * this.dpr);

    if (this.ghostCount && ghostGain > 0 && !this.skipPoints) {
      // old operator's dots: birth far in the past and a huge lifetime keeps them steady and dim
      gl.uniform1f(P.u.uTime, 0); gl.uniform1f(P.u.uLife, 1e9); gl.uniform1f(P.u.uGain, ghostGain * light);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.ghostBuf); this.pointAttribs();
      gl.drawArrays(gl.POINTS, 0, this.ghostCount);
    }

    const d = this.dots;
    const oldest = d.oldestLive(t, life), count = d.written - oldest;
    if (count > 0 && !this.skipPoints) {
      gl.uniform1f(P.u.uTime, t); gl.uniform1f(P.u.uLife, life); gl.uniform1f(P.u.uGain, light);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dotBuf); this.pointAttribs();
      const a = oldest % d.cap;
      if (a + count <= d.cap) gl.drawArrays(gl.POINTS, a, count);
      else { gl.drawArrays(gl.POINTS, a, d.cap - a); gl.drawArrays(gl.POINTS, 0, a + count - d.cap); }
    }

    if (this.lineN > 0) {
      gl.useProgram(this.ln.p); gl.uniformMatrix4fv(this.ln.u.uVP, false, cam.vp); gl.uniform1f(this.ln.u.uGain, light);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lnBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.lines.subarray(0, this.lineN * 14));
      this.attribs(2); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.drawArrays(gl.LINES, 0, this.lineN * 2);
    }
    if (this.fanN > 0) {
      gl.useProgram(this.ln.p); gl.uniformMatrix4fv(this.ln.u.uVP, false, cam.vp); gl.uniform1f(this.ln.u.uGain, light);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fanBuf); gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.fan.subarray(0, this.fanN * 7));
      this.attribs(2); gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 28, 0); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 28, 12);
      gl.drawArrays(gl.TRIANGLES, 0, this.fanN);
    }
    this.fanLast = this.fanN; // kept for the smoke test's 2D redraw
    this.lineN = 0; this.fanN = 0;
    // the emitter's light, for the bloom the devices themselves are not part of
    let lensU = 0, lensV = 0, glow = 0;
    if (post) {
      if (gun && full) {
        const L = gun.lens, P5 = cam.proj, z = Math.max(0.01, -L[2]);
        lensU = (P5[0] * L[0] / z + 1) * 0.5; lensV = (P5[5] * L[1] / z + 1) * 0.5;
        glow = 0.05 + 0.3 * gun.charge * (gun.firing ? 1 : 0) + 0.45 * gun.flash;
      }
      post.resolve(this.fear, this.ping, lensU, lensV, glow, this.reduceMotion);
    }
    // the hand-held devices: depth cleared once, so neither sinks into a wall but they overlap properly
    if (!post && (gun || trk)) { gl.depthMask(true); gl.clear(gl.DEPTH_BUFFER_BIT); } // clear obeys the mask the dots left off
    if (gun) { gun.proj = cam.proj; this.gun.draw(gun); }
    if (trk) { trk.proj = cam.proj; this.tracker.draw(trk); }
    if (full) post.finish(this.fear);
  }
}
