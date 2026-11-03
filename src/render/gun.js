// Draws the hand scanner over the scene. It uses the camera's own projection, so the emitter tip on
// screen is exactly where the scanner's rays and beam lines start in the world. The renderer clears
// depth before the hand-held devices, so they never sink into walls (but can pass in front of each
// other while you swap them).
//
// Lighting is deliberately sparse for a dark game: a dim key light, a cold rim so the silhouette
// reads against black, the emitter's own glow on nearby metal when it fires, and emissive parts
// (lens, coils, heat fins, status screen) driven by the scanner's state. Moving parts are moved in the
// vertex shader, so nothing is rebuilt: the rotor spins, the fins hinge open, the capacitor block slides.

import {buildGunMesh, GUN_STRIDE, GUN_AXIS, FIN_HINGE_Y, GMAT} from './gunmesh.js';

const f = v => v.toFixed(4);

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv; attribute float aMat;
uniform mat4 uProj, uModel;
uniform vec3 uRig; // rotor angle, fin hinge angle, block travel
varying vec3 vP, vN; varying vec2 vUv; varying float vMat;
void main(){
  vec3 q = aPos, n = aNrm;
  float m = floor(aMat + 0.5);
  if (m == ${f(GMAT.ROTOR)}) {
    float c = cos(uRig.x), s = sin(uRig.x);
    vec2 o = vec2(${f(GUN_AXIS[0])}, ${f(GUN_AXIS[1])}), d = q.xy - o;
    q.xy = o + vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    n.xy = vec2(c * n.x - s * n.y, s * n.x + c * n.y);
  } else if (m == ${f(GMAT.FIN)}) {
    float c = cos(uRig.y), s = sin(uRig.y), dy = q.y - ${f(FIN_HINGE_Y)}, dz = q.z - aUv.x;
    q.y = ${f(FIN_HINGE_Y)} + c * dy + s * dz; q.z = aUv.x - s * dy + c * dz;
    n.yz = vec2(c * n.y + s * n.z, -s * n.y + c * n.z);
  } else if (m == ${f(GMAT.BLOCK)}) q.z += uRig.z;
  vec4 p = uModel * vec4(q, 1.0);
  vP = p.xyz; vN = (uModel * vec4(n, 0.0)).xyz; vUv = aUv; vMat = m;
  gl_Position = uProj * p;
}`;

const FS = `
precision mediump float;
varying vec3 vP, vN; varying vec2 vUv; varying float vMat;
uniform vec3 uLens;
uniform float uCharge, uHeat, uOver, uSweep, uTime, uFlash, uPhase, uBeam, uReady, uFlip;
const vec3 TEAL = vec3(0.22, 0.83, 0.77);
const vec3 BONE = vec3(1.0, 0.95, 0.84);
// metal heating up: dull red, then orange, then nearly yellow at the very top
vec3 ember(float h) { return vec3(1.0, 0.16, 0.03) * h * h + vec3(0.9, 0.42, 0.08) * h * h * h * h; }
float win(float a, float b, float x) { return smoothstep(a - 0.008, a + 0.008, x) * (1.0 - smoothstep(b - 0.008, b + 0.008, x)); }
// a row of n cells across the screen, lit up to fill; the cell being filled lights in proportion
float cells(vec2 uv, float y0, float y1, float n, float fill) {
  float x = (uv.x - 0.1) / 0.8, k = x * n, c = fract(k);
  float lit = clamp(fill * n - floor(k), 0.0, 1.0);
  return win(0.0, 1.0, x) * win(y0, y1, uv.y) * smoothstep(0.03, 0.09, c) * (1.0 - smoothstep(0.91, 0.97, c)) * (0.1 + 0.9 * lit);
}
vec3 screen(vec2 uv) {
  float T = uTime, over = uOver, h = uHeat;
  vec3 s = vec3(0.012, 0.04, 0.04);
  if (over > 0.5) {
    // vent: hazard bars crawl across where the charge was, and the heat row counts down, blinking
    float slash = step(0.5, fract((uv.x * 3.4 + uv.y * 2.0) - T * 1.6));
    s += vec3(1.0, 0.3, 0.06) * win(0.1, 0.9, uv.x) * win(0.68, 0.87, uv.y) * (0.14 + 0.8 * slash);
    s += ember(0.65 + 0.35 * h) * 1.5 * cells(uv, 0.41, 0.6, 8.0, h) * (sin(T * 14.0) > -0.3 ? 1.0 : 0.45);
  } else {
    s += TEAL * 1.15 * cells(uv, 0.68, 0.87, 8.0, uCharge);
    vec3 hc = mix(vec3(0.95, 0.62, 0.2), vec3(1.0, 0.16, 0.05), smoothstep(0.55, 0.85, h));
    s += hc * cells(uv, 0.41, 0.6, 8.0, h);
    s += vec3(1.0, 0.2, 0.08) * 0.8 * win(0.1, 0.9, uv.x) * step(0.8, (uv.x - 0.1) / 0.8) * win(0.615, 0.635, uv.y); // past here it cuts out
  }
  // the sweep's five cells, lit in turn as it recharges; they all flare when it is ready again
  s += BONE * (0.85 + uReady * 1.2) * cells(uv, 0.12, 0.31, 5.0, uSweep);
  // firing the sweep: the sheet of light runs down the glass with the beam
  if (uBeam >= 0.0) s += BONE * (1.0 - smoothstep(0.0, 0.07, abs(uv.y - 1.0 + uBeam))) * 0.9;
  s += BONE * uFlash * 0.16;
  // a thin lit frame, soft scanlines, the corners falling off
  float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
  s += TEAL * 0.22 * (1.0 - smoothstep(0.012, 0.03, e));
  s *= 0.9 + 0.1 * sin(uv.y * 120.0);
  return s * (1.0 - 0.3 * smoothstep(0.1, 0.0, e));
}
void main(){
  float m = floor(vMat + 0.5);
  // what glows on its own needs none of the lighting below
  if (m > 5.5 && m < 6.5) { gl_FragColor = vec4(screen(vec2(mix(vUv.x, 1.0 - vUv.x, uFlip), vUv.y)), 1.0); return; }
  if (m > 2.5 && m < 3.5) { gl_FragColor = vec4(TEAL * (0.35 + 1.6 * uCharge * (0.85 + 0.15 * sin(uTime * 53.0) * sin(uTime * 17.0)) + 2.0 * uFlash), 1.0); return; }
  vec3 N = normalize(vN), V = normalize(-vP), L = normalize(vec3(-0.45, 0.85, 0.35));
  bool rubber = m > 1.5 && m < 2.5;
  vec3 base = m < 0.5 ? vec3(0.07, 0.08, 0.085) : rubber ? vec3(0.03, 0.03, 0.035)
    : m > 10.5 ? vec3(0.008, 0.009, 0.01) : m > 3.5 && m < 4.5 ? vec3(0.05, 0.06, 0.06) : vec3(0.15, 0.17, 0.18);
  float wear = m < 3.5 || (m > 6.5 && m < 8.5) ? vUv.x : 0.0;
  float dif = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), rubber ? 8.0 : 42.0) * (rubber ? 0.04 : 0.35 + 0.4 * wear);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 toLens = uLens - vP; float dl = length(toLens);
  float glow = (0.05 + uCharge + uFlash) * max(dot(N, toLens / dl), 0.0) / (1.0 + dl * dl * 90.0);
  vec3 col = (base + wear * vec3(0.11, 0.12, 0.125)) * (0.10 + 0.55 * dif) + vec3(spec) * 0.6 + rim * vec3(0.10, 0.22, 0.22) + TEAL * glow * 1.6;
  col += wear * vec3(0.007, 0.012, 0.012);                                                          // edges read even in the dark
  if (m > 3.5 && m < 4.5) {                                                                    // coils: charge runs up them to the muzzle
    float ramp = smoothstep(vUv.y - 0.3, vUv.y + 0.3, uCharge * 1.6 - 0.3);
    float wave = 0.5 + 0.5 * sin(uPhase - vUv.y * 5.0);
    col = col * 0.6 + TEAL * (0.05 + ramp * (0.25 + 1.2 * wave * wave) * uCharge + uFlash * 1.6);
  } else if (m > 4.5 && m < 5.5) {                                                                  // fins: hottest at the root
    float hot = smoothstep(0.42, 1.0, uHeat * (1.05 - 0.35 * vUv.y));
    if (uOver > 0.5) hot *= 0.9 + 0.1 * sin(uTime * 22.0);
    col = col * (1.0 - hot) + ember(hot) * 1.35;
  } else if (m > 6.5 && m < 7.5) col += TEAL * (0.02 + 0.5 * uCharge * uCharge);                      // rotor
  else if (m > 7.5 && m < 8.5) col += BONE * vUv.y * (uSweep >= 1.0 ? 0.45 + uReady : 0.02 + 0.06 * uSweep); // block lamp
  else if (m > 8.5 && m < 9.5) {                                                                    // flank slit: fills from you toward the barrel
    float lit = smoothstep(vUv.y - 0.04, vUv.y + 0.04, uCharge * 1.04);
    float run = 0.65 + 0.35 * sin(uPhase * 0.7 - vUv.y * 9.0);
    col = uOver > 0.5 ? vec3(1.0, 0.2, 0.05) * (0.12 + 0.5 * step(0.0, sin(uTime * 14.0)))
      : TEAL * (0.06 + 1.4 * lit * run * uCharge + uFlash) + ember(smoothstep(0.75, 1.0, uHeat)) * 0.3;
  } else if (m > 9.5 && m < 10.5) col = ember(smoothstep(0.3, 1.0, uHeat)) * 1.9;                   // vent well
  gl_FragColor = vec4(col, 1.0);
}`;

/** Compiles and links a device's shaders, with the attribute slots both devices share. */
export function deviceProgram(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) console.error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  ['aPos', 'aNrm', 'aUv', 'aMat'].forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) console.error(gl.getProgramInfoLog(p));
  return p;
}

/** Points the shared attribute slots at a device's vertex buffer. */
export function bindDeviceMesh(gl, buf, stride) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  for (let i = 0; i < 4; i++) gl.enableVertexAttribArray(i);
  const B = stride * 4;
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, B, 12);
  gl.vertexAttribPointer(2, 2, gl.FLOAT, false, B, 24);
  gl.vertexAttribPointer(3, 1, gl.FLOAT, false, B, 32);
}

export class GunRenderer {
  constructor(gl) {
    this.gl = gl;
    this.p = deviceProgram(gl, VS, FS);
    this.u = {};
    for (const n of ['uProj', 'uModel', 'uLens', 'uRig', 'uCharge', 'uHeat', 'uOver', 'uSweep', 'uTime', 'uFlash', 'uPhase', 'uBeam', 'uReady', 'uFlip']) this.u[n] = gl.getUniformLocation(this.p, n);
    const mesh = buildGunMesh();
    this.count = mesh.length / GUN_STRIDE;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  }

  /** s: see ViewModel.drawState. */
  draw(s) {
    const gl = this.gl, u = this.u;
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
    gl.useProgram(this.p);
    gl.uniformMatrix4fv(u.uProj, false, s.proj); gl.uniformMatrix4fv(u.uModel, false, s.model);
    gl.uniform3f(u.uLens, s.lens[0], s.lens[1], s.lens[2]);
    gl.uniform3f(u.uRig, s.rotor, s.fins, s.block);
    gl.uniform1f(u.uCharge, s.charge);
    gl.uniform1f(u.uHeat, s.heat); gl.uniform1f(u.uOver, s.over ? 1 : 0);
    gl.uniform1f(u.uSweep, s.sweep); gl.uniform1f(u.uTime, s.time % 600); gl.uniform1f(u.uFlash, s.flash); // wrapped: mediump time loses precision
    gl.uniform1f(u.uPhase, s.phase); gl.uniform1f(u.uBeam, s.beam); gl.uniform1f(u.uReady, s.ready); gl.uniform1f(u.uFlip, s.mirrored ? 1 : 0);
    bindDeviceMesh(gl, this.buf, GUN_STRIDE);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
}
