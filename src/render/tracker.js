// Draws the motion tracker in your other hand. The body is lit like the scanner; the screen is drawn
// in the fragment shader from a few numbers: a fan of range rings ahead of you, the pulse sweeping out
// across it, blips that bloom where something moved and fade, the bottom corner pulsing amber when
// something is behind you, static when it is right on top of you, and a battery gauge.
//
// Only 9 vec4 uniforms for the screen (WebGL1 promises 16), loops with fixed bounds, and time passed
// in wrapped so phones with half-float shaders keep animating smoothly.

import {buildTrackerMesh, TRACKER_STRIDE} from './trackermesh.js';
import {DEVICE_VS} from './gun.js';

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vP, vN; varying vec2 vUv; varying float vMat;
uniform vec4 uA;    // pulse wave (0..1 of the way out, <0 none), flood, power, status light
uniform vec4 uB;    // behind left, behind right, battery, boot (1 just raised .. 0 ready)
uniform vec4 uC;    // reach now (fraction of full), noise seed, dead, time (wrapped)
uniform vec4 uK[6]; // blips: across (-1..1), ahead (0..1), brightness, freshness
const vec3 LIME = vec3(0.62, 1.0, 0.22);
const vec3 AMBER = vec3(1.0, 0.5, 0.12);
const float ASPECT = 1.657; // the screen is 116 x 70 mm

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float line(float d, float w) { return 1.0 - smoothstep(0.0, w, abs(d)); }

vec3 screen(vec2 uv) {
  float T = uC.w, reach = uC.x, bat = uB.z;
  float n = hash(floor(uv * vec2(150.0, 90.0)) + uC.y * 97.0);
  if (uC.z > 0.5) { // dead: dark glass and, when you try it, a red battery outline blinking
    vec2 q = abs(uv - vec2(0.5, 0.5)) - vec2(0.12, 0.14);
    float box = line(max(q.x, q.y), 0.012) + step(abs(uv.x - 0.5), 0.04) * line(uv.y - 0.66, 0.012);
    return vec3(0.003, 0.008, 0.005) + vec3(0.9, 0.12, 0.05) * box * uA.z * step(0.0, sin(T * 7.0));
  }
  vec2 p = (uv - vec2(0.5, 0.07)) * vec2(ASPECT, 1.0) / 0.84; // fan space: 1 is full reach
  float r = length(p), a = atan(p.x, max(p.y, 1e-4));
  float fan = step(0.0, p.y) * step(r, 1.0), live = step(r, reach);
  vec3 s = vec3(0.006, 0.02, 0.01);
  // range rings and bearing lines, dimmer beyond what it can reach now
  float grid = 0.0;
  for (int i = 1; i <= 3; i++) grid += line(r - float(i) / 3.0, 0.011) * 0.24;
  for (int i = -2; i <= 2; i++) grid += line(r * sin(a - float(i) * 0.5236), 0.008) * 0.07 * step(0.06, r);
  s += LIME * grid * fan * (0.3 + 0.7 * live) + LIME * 0.025 * fan * live;
  s += LIME * 0.2 * line(p.y, 0.012) * step(r, 1.0);
  // the pulse: a bright front sweeping outward, a faint wash behind it
  if (uA.x >= 0.0) {
    float w = uA.x * reach;
    s += LIME * fan * (exp(-pow((r - w) / 0.03, 2.0)) * 0.55 + step(r, w) * 0.035) * (1.0 - 0.5 * uA.x);
  }
  // blips: a hot core in a soft halo, bigger the closer, with a ring spreading from each new one
  for (int i = 0; i < 6; i++) {
    vec4 k = uK[i];
    if (k.z <= 0.0) continue;
    float d = length(p - k.xy), near = 1.0 - clamp(length(k.xy), 0.0, 1.0), sz = 0.035 + 0.035 * near;
    s += LIME * k.z * (exp(-d * d / (sz * sz)) * 1.5 + exp(-d * d / (sz * sz * 9.0)) * 0.25);
    s += LIME * k.w * line(d - sz - (1.0 - k.w) * 0.13, 0.01) * 0.6;
  }
  // behind you: the bottom corner on that side pulses amber
  float bl = uB.x * (1.0 - smoothstep(0.0, 0.34, length(uv * vec2(1.0, 1.6))));
  float br = uB.y * (1.0 - smoothstep(0.0, 0.34, length((uv - vec2(1.0, 0.0)) * vec2(1.0, 1.6))));
  s += AMBER * (bl + br) * (0.65 + 0.35 * sin(T * 18.0));
  // battery gauge, top right: four cells, red and blinking when low
  vec2 g = (uv - vec2(0.77, 0.885)) / vec2(0.19, 0.07);
  if (g.x > 0.0 && g.x < 1.0 && g.y > 0.0 && g.y < 1.0) {
    float cell = floor(g.x * 4.0), f = fract(g.x * 4.0);
    vec3 c = bat < 0.15 ? vec3(1.0, 0.25, 0.08) * step(0.0, sin(T * 9.0)) : LIME;
    s += c * step(0.14, f) * step(f, 0.86) * (cell < bat * 4.0 - 0.001 ? 0.75 : 0.08);
  }
  // right on top of you: the whole screen fills with static
  s += LIME * step(0.55, n) * uA.y * 0.9;
  s *= 1.0 - uA.y * 0.45 * step(n, 0.3);
  // booting: the picture rolls up from the bottom through snow
  float boot = uB.w, edge = 1.0 - boot;
  s *= step(uv.y, edge * 1.1);
  s += LIME * (line(uv.y - edge, 0.02) * 0.7 + step(0.6, n) * 0.4) * step(0.001, boot);
  // low battery: it gutters
  if (bat < 0.15) s *= 0.7 + 0.3 * step(0.25, hash(vec2(floor(T * 9.0), 3.0)));
  s *= uA.z;
  s *= 0.8 + 0.2 * sin(uv.y * 240.0);                       // scanlines
  s *= 1.0 - 0.45 * pow(length(uv - 0.5) * 1.25, 3.0);      // the glass darkens at its corners
  return s + vec3(0.012, 0.016, 0.014) * (1.0 - uv.y);      // and catches a little light
}

void main() {
  float m = floor(vMat + 0.5);
  vec3 N = normalize(vN), V = normalize(-vP), L = normalize(vec3(-0.45, 0.85, 0.35));
  vec3 base = m < 0.5 ? vec3(0.075, 0.085, 0.08) : m < 1.5 ? vec3(0.15, 0.17, 0.16) : m < 2.5 ? vec3(0.03, 0.03, 0.035) : vec3(0.02, 0.03, 0.03);
  float dif = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), m > 1.5 && m < 2.5 ? 8.0 : 42.0) * (m > 1.5 && m < 2.5 ? 0.04 : 0.35);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col = base * (0.10 + 0.55 * dif) + vec3(spec) * 0.6 + rim * vec3(0.10, 0.22, 0.16);
  col += LIME * 0.03 * uA.z * max(N.z, 0.0);                                   // the screen's light on the metal
  if (m > 2.5 && m < 3.5) col += LIME * 0.06 * uA.z;                           // the sensor glass
  else if (m > 3.5 && m < 4.5) {                                               // the status light
    float low = uB.z < 0.15 && uC.z < 0.5 ? step(0.0, sin(uC.w * 9.0)) : 0.0;
    col = mix(LIME * (0.12 + 1.6 * uA.w) * uA.z, AMBER * 1.2, low);
  } else if (m > 5.5) col = screen(vUv);
  gl_FragColor = vec4(col, 1.0);
}`;

export class TrackerRenderer {
  constructor(gl) {
    this.gl = gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, DEVICE_VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS));
    ['aPos', 'aNrm', 'aUv', 'aMat'].forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    this.p = p;
    this.u = {};
    for (const n of ['uProj', 'uModel', 'uA', 'uB', 'uC', 'uK']) this.u[n] = gl.getUniformLocation(p, n);
    const mesh = buildTrackerMesh();
    this.count = mesh.length / TRACKER_STRIDE;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  }

  /** s: {proj, model, a, b, c: 4 floats each (see the shader), k: 24 floats of blips} */
  draw(s) {
    const gl = this.gl, u = this.u;
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
    gl.useProgram(this.p);
    gl.uniformMatrix4fv(u.uProj, false, s.proj); gl.uniformMatrix4fv(u.uModel, false, s.model);
    gl.uniform4fv(u.uA, s.a); gl.uniform4fv(u.uB, s.b); gl.uniform4fv(u.uC, s.c); gl.uniform4fv(u.uK, s.k);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    for (let i = 0; i < 4; i++) gl.enableVertexAttribArray(i);
    const B = TRACKER_STRIDE * 4;
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, B, 12);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, B, 24);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, B, 32);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
}
