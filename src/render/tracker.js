// Draws the motion tracker in your other hand. The casing is lit like the scanner, with paint worn off
// its edges; the screen is an old monochrome tube, drawn in the fragment shader from a few numbers: a
// fan of range arcs and ticks ahead of you, a pulse sweeping out across it and leaving phosphor glowing
// behind it, blips that bloom white-hot where something moved and fade slowly, the bottom corner flaring
// when something is behind you, the picture tearing and losing hold when it is right on top of you, and
// a raster that blooms up when you switch on and collapses to a dot when you switch off or the cell dies.
// The range window on the control strip has its own small branch.
//
// Only 12 uniform vectors for the screen (WebGL1 promises 16), loops with fixed bounds, and time passed
// in wrapped so phones with half-float shaders keep animating smoothly.

import {buildTrackerMesh, TRACKER_STRIDE, TMAT, DRUM_AXIS, TOGGLE_HINGE} from './trackermesh.js';
import {deviceProgram, bindDeviceMesh} from './gun.js';

const f = v => v.toFixed(4);

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv; attribute float aMat;
uniform mat4 uProj, uModel;
uniform vec4 uRig; // drum angle, power toggle angle, spare toggle angle, mirror (-1 mirrored)
varying vec3 vP, vN, vL; varying vec2 vUv; varying float vMat;
void main(){
  vec3 q = aPos, n = aNrm;
  float m = floor(aMat + 0.5);
  if (m == ${f(TMAT.DRUM)}) {
    float c = cos(uRig.x), s = sin(uRig.x), dy = q.y - ${f(DRUM_AXIS[0])}, dz = q.z - ${f(DRUM_AXIS[1])};
    q.y = ${f(DRUM_AXIS[0])} + c * dy - s * dz; q.z = ${f(DRUM_AXIS[1])} + s * dy + c * dz;
    n.yz = vec2(c * n.y - s * n.z, s * n.y + c * n.z);
  } else if (m == ${f(TMAT.TOGGLE)}) {
    float a = aUv.y > 0.5 ? uRig.z : uRig.y, c = cos(a), s = sin(a), dy = q.y - ${f(TOGGLE_HINGE[0])}, dz = q.z - ${f(TOGGLE_HINGE[1])};
    q.y = ${f(TOGGLE_HINGE[0])} + c * dy - s * dz; q.z = ${f(TOGGLE_HINGE[1])} + s * dy + c * dz;
    n.yz = vec2(c * n.y - s * n.z, s * n.y + c * n.z);
  } else if (m == ${f(TMAT.STENCIL)} && uRig.w < 0.0) q.x = 2.0 * aUv.x - q.x; // mirrored, the letters still read
  vec4 p = uModel * vec4(q, 1.0);
  vP = p.xyz; vN = (uModel * vec4(n, 0.0)).xyz; vL = aPos; vUv = aUv; vMat = m;
  gl_Position = uProj * p;
}`;

const FS = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec3 vP, vN, vL; varying vec2 vUv; varying float vMat;
uniform vec4 uA;    // time since the pulse in sweeps (<0 none), flood, power, status light
uniform vec4 uB;    // behind left, behind right, battery, boot (1 just raised .. 0 ready; when dead, how hard you are trying)
uniform vec4 uC;    // reach now (fraction of full), noise seed, dead, time (wrapped)
uniform vec4 uD;    // raster width, raster height, the scanner's light on the glass, mirrored
uniform vec4 uE;    // three digits' segments (7 bits each), brightness
uniform vec4 uK[6]; // blips: across (-1..1), ahead (0..1), brightness, freshness
uniform float uCalm; // reduced motion: 0 keeps the static but stills the tearing and rolling
const vec3 LIME = vec3(0.62, 1.0, 0.22);
const vec3 AMBER = vec3(1.0, 0.5, 0.12);
const vec3 TEAL = vec3(0.22, 0.83, 0.77);
const float ASPECT = 1.5758; // the screen is 104 x 66 mm
const float FAN = 0.76;      // the fan's radius, in screen heights

float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float line(float d, float w) { return 1.0 - smoothstep(0.0, w, abs(d)); }

vec3 screen(vec2 uv0) {
  float T = uC.w, reach = uC.x, bat = uB.z, flood = uA.y, pw = uA.z;
  vec2 c = (uv0 - 0.5) * vec2(ASPECT, 1.0);
  float tube = dot(c, c);
  vec2 cu = c * (1.0 + 0.085 * tube);  // the face of the tube bulges toward you
  vec2 qe = abs(cu) - vec2(0.5 * ASPECT - 0.1, 0.4);
  float face = 1.0 - smoothstep(-0.035, 0.0, length(max(qe, 0.0)) - 0.1);
  vec2 g0 = (cu / vec2(ASPECT, 1.0) + vec2(0.0, 0.5 - 0.06)) * vec2(ASPECT, 1.0) / FAN;
  // burn-in: years of the same picture, there even with the power off
  float ghost = 1.4 * step(0.0, g0.y) * (line(length(g0 + vec2(0.012, 0.008)) - 0.667, 0.014) + line(length(g0 + vec2(0.012, 0.008)) - 1.0, 0.014));
  vec3 glass = vec3(0.006, 0.011, 0.008) + LIME * 0.0065 * ghost;
  if (uC.z > 0.5) { // dead: dark glass and, while you try it, the last of the charge drawing an empty cell
    vec2 q = abs(uv0 - vec2(0.5, 0.5)) - vec2(0.12, 0.17);
    float box = line(max(q.x, q.y), 0.014) + step(abs(uv0.x - 0.5), 0.045) * line(uv0.y - 0.71, 0.014);
    return (glass + LIME * 0.5 * box * uB.w * step(0.0, sin(T * 19.0))) * face;
  }
  if (pw <= 0.001) return glass * face;

  // the raster: full size in normal use, collapsing to a line and a dot at switch-on and switch-off
  vec2 pc = cu / max(uD.xy, vec2(0.004));
  float raster = step(abs(pc.x), 0.5 * ASPECT + 0.015) * step(abs(pc.y), 0.515);
  float burn = min(3.0, 1.0 / max(uD.y, 0.3));  // a smaller raster burns brighter
  // breaking up: rows tear sideways, the picture loses its vertical hold and rolls, the beam wanders
  float roll = flood * flood * uCalm;
  float row = floor((pc.y + 0.5) * 50.0);
  pc.x += roll * 0.26 * (hash(vec2(row, floor(T * 22.0))) - 0.5) * step(0.45, hash(vec2(row * 0.37, floor(T * 8.0))));
  pc.x += flood * uCalm * 0.012 * sin(pc.y * 34.0 + T * 53.0);
  pc.y = pc.y + roll * (0.14 * sin(T * 37.0) + 0.5 * fract(T * 2.3));
  pc.y = pc.y - floor(pc.y + 0.5);

  vec2 uv = pc / vec2(ASPECT, 1.0) + 0.5;
  float n = hash(floor(uv0 * vec2(118.0, 74.0)) + uC.y * 97.0);
  vec2 p = (uv - vec2(0.5, 0.06)) * vec2(ASPECT, 1.0) / FAN; // fan space: 1 is full reach
  float r = length(p), a = atan(p.x, max(p.y, 1e-4));
  float fan = step(0.0, p.y) * step(r, 1.0), live = step(r, reach);
  vec3 s = vec3(0.004, 0.015, 0.007);
  // range arcs, bearing lines and tick marks round the rim, dimmer beyond what it can reach now
  float grid = 0.0;
  for (int i = 1; i <= 3; i++) grid += line(r - float(i) / 3.0, 0.011) * 0.34;
  for (int i = -2; i <= 2; i++) grid += line(r * sin(a - float(i) * 0.5236), 0.008) * 0.09 * step(0.06, r);
  float tick = abs(fract(a / 0.1309 + 0.5) - 0.5); // every 7.5 degrees; longer every 30
  float major = abs(fract(a / 0.5236 + 0.5) - 0.5);
  grid += (1.0 - smoothstep(0.1, 0.2, tick)) * step(0.955, r) * 0.32 + (1.0 - smoothstep(0.03, 0.05, major)) * step(0.905, r) * 0.42;
  s += LIME * grid * fan * (0.28 + 0.72 * live) + LIME * 0.03 * fan * live;
  s += LIME * 0.26 * line(p.y, 0.012) * step(r, 1.0);
  s += LIME * 0.9 * (1.0 - smoothstep(0.012, 0.03, r));    // you
  // the pulse: the front hits hard and the phosphor it woke glows on behind it, fading
  if (uA.x >= 0.0) {
    float age = uA.x - r / max(reach, 0.01);
    s += LIME * fan * step(0.0, age) * (exp(-age * 24.0) * 0.8 + exp(-age * 2.6) * 0.1);
  }
  // blips: white-hot and spreading when new, then a slow persistent glow, with a ring from each new one
  for (int i = 0; i < 6; i++) {
    vec4 k = uK[i];
    if (k.z <= 0.0) continue;
    float d = length(p - k.xy), near = 1.0 - clamp(length(k.xy), 0.0, 1.0), sz = (0.036 + 0.034 * near) * (1.0 + 0.7 * k.w);
    float dd = d * d / (sz * sz);
    s += LIME * k.z * (exp(-dd) * (1.7 + 2.6 * k.w * k.w) + exp(-dd * 0.09) * (0.2 + 0.5 * k.w));
    s += LIME * k.w * line(d - sz - (1.0 - k.w) * 0.15, 0.009) * 0.6;
  }
  // behind you: that bottom corner flares and crawls
  float bl = uB.x * (1.0 - smoothstep(0.0, 0.36, length(uv * vec2(1.0, 1.6))));
  float br = uB.y * (1.0 - smoothstep(0.0, 0.36, length((uv - vec2(1.0, 0.0)) * vec2(1.0, 1.6))));
  s += LIME * (bl + br) * (1.0 + 0.5 * sin(T * 18.0)) * (0.6 + 0.6 * step(0.5, fract((uv.x + uv.y) * 13.0 - T * 4.0)));
  // the cell gauge, top right: four bars, blinking when low
  vec2 g = (uv - vec2(0.76, 0.875)) / vec2(0.195, 0.07);
  if (g.x > 0.0 && g.x < 1.0 && g.y > 0.0 && g.y < 1.0) {
    float cell = floor(g.x * 4.0), f = fract(g.x * 4.0), low = bat < 0.15 ? step(0.0, sin(T * 9.0)) : 1.0;
    s += LIME * low * step(0.14, f) * step(f, 0.86) * (cell < bat * 4.0 - 0.001 ? 0.8 : 0.07);
  }
  // right on top of you: snow, dark bands, a hot bar rolling through
  float bar = line(fract(uv.y * 1.4 - T * 1.9) - 0.5, 0.09);
  s += LIME * step(0.56, n) * flood * (0.75 + 0.5 * bar);
  s *= 1.0 - flood * (0.5 * step(n, 0.3) + 0.35 * line(fract(uv.y * 3.1 + T * 5.3) - 0.5, 0.2));
  // warming up: snow and a brightness that has not settled
  s += LIME * step(0.62, n) * 0.45 * uB.w;
  // low charge: it gutters
  if (bat < 0.15) s *= 0.72 + 0.28 * step(0.25, hash(vec2(floor(T * 9.0), 3.0)));
  s += LIME * (1.0 - smoothstep(0.08, 0.6, uD.y)) * 0.8;  // squeezed small, all the beam's energy is on that line
  s *= raster * pw * burn;
  s *= 0.84 + 0.16 * sin(uv.y * 208.0);                     // scanlines
  s *= 1.0 + 0.035 * sin(uv.y * 5.0 - T * 1.9);             // and the slow bar of an unsteady supply
  s *= 1.0 - 0.62 * tube * tube;                            // soft at the corners
  return (s + glass) * face;
}

// seven-segment digits, three of them, with a point after the second
float seg(vec2 q, vec2 c, vec2 h) { vec2 d = abs(q - c) - h; return 1.0 - smoothstep(0.0, 0.035, max(d.x, d.y)); }
float bit(float code, float i) { return mod(floor(code / pow(2.0, i)), 2.0); }
vec3 digits(vec2 uv) {
  vec2 gg = uv * vec2(3.0, 1.0);
  float i = floor(gg.x), code = i < 0.5 ? uE.x : i < 1.5 ? uE.y : uE.z;
  vec2 q = (fract(gg) - vec2(0.17, 0.13)) / vec2(0.6, 0.74);
  q.x -= (q.y - 0.5) * 0.12;
  float t = 0.085, on = 0.0, off = 0.0, v;
  v = seg(q, vec2(0.5, 1.0), vec2(0.34, t)); off += v; on += v * bit(code, 0.0);
  v = seg(q, vec2(1.0, 0.75), vec2(t * 1.15, 0.18)); off += v; on += v * bit(code, 1.0);
  v = seg(q, vec2(1.0, 0.25), vec2(t * 1.15, 0.18)); off += v; on += v * bit(code, 2.0);
  v = seg(q, vec2(0.5, 0.0), vec2(0.34, t)); off += v; on += v * bit(code, 3.0);
  v = seg(q, vec2(0.0, 0.25), vec2(t * 1.15, 0.18)); off += v; on += v * bit(code, 4.0);
  v = seg(q, vec2(0.0, 0.75), vec2(t * 1.15, 0.18)); off += v; on += v * bit(code, 5.0);
  v = seg(q, vec2(0.5, 0.5), vec2(0.34, t)); off += v; on += v * bit(code, 6.0);
  if (i > 0.5 && i < 1.5) on += seg(q, vec2(1.33, 0.0), vec2(0.075, 0.075)) * step(0.5, uE.w);
  return vec3(0.002, 0.005, 0.003) + LIME * (min(off, 1.0) * 0.028 + min(on, 1.0) * uE.w * 0.82) * (0.9 + 0.1 * sin(uv.y * 40.0));
}

void main() {
  float m = floor(vMat + 0.5);
  vec3 N = normalize(vN), V = normalize(-vP), L = normalize(vec3(-0.45, 0.85, 0.35)), H = normalize(L + V);
  if (m > 5.5 && m < 6.5) {                                                    // the tube behind thick glass: no metal to light
    vec2 uv = vec2(mix(vUv.x, 1.0 - vUv.x, uD.w), vUv.y);
    vec3 cg = normalize(N + vec3((vUv.x - 0.5) * 0.5, (vUv.y - 0.5) * 0.35, 0.0));
    float brow = smoothstep(0.86, 1.0, vUv.y);                                 // the brow's shadow
    gl_FragColor = vec4(screen(uv) * (1.0 - 0.45 * brow) + (vec3(0.05, 0.07, 0.06) + TEAL * uD.z) * pow(max(dot(cg, H), 0.0), 34.0), 1.0);
    return;
  }
  if (m > 6.5 && m < 7.5) { gl_FragColor = vec4(digits(vec2(mix(vUv.x, 1.0 - vUv.x, uD.w), vUv.y)), 1.0); return; }
  bool rubber = m > 1.5 && m < 2.5;
  // worn paint: the casing's chamfers, and patches of bare casting where hands have been
  float mott = rubber ? 0.0 : sin(vL.x * 310.0 + sin(vL.y * 190.0) * 2.1) * sin(vL.y * 370.0 + sin(vL.x * 240.0 + vL.z * 260.0) * 2.3);
  float chip = smoothstep(0.62, 0.8, mott * (0.72 + 0.28 * sin(vL.x * 90.0 + vL.y * 70.0)));
  float painted = m < 0.5 ? 1.0 : 0.0;
  float worn = clamp(vUv.x * (0.5 + 0.5 * mott) * 1.4 + chip * 0.8 * painted, 0.0, 1.0);
  vec3 base = m < 0.5 ? vec3(0.15, 0.155, 0.11) : rubber ? vec3(0.05, 0.05, 0.052)
    : m > 2.5 && m < 3.5 ? vec3(0.012, 0.014, 0.014) : m > 7.5 && m < 8.5 ? vec3(0.13, 0.14, 0.125) : vec3(0.2, 0.21, 0.2);
  if (m < 0.5 || ((m < 1.5 || (m > 7.5 && m < 8.5)) && vUv.x > 0.0)) base = mix(base, vec3(0.36, 0.36, 0.34), worn);
  float dif = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, H), 0.0), rubber ? 9.0 : 40.0) * (rubber ? 0.05 : 0.14 + 0.2 * worn);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 col = base * (0.2 + 0.62 * dif) + vec3(spec) * 0.6 + rim * vec3(0.09, 0.19, 0.13);
  // the tube's light on what is around it
  float d2 = dot(vL.xy - vec2(0.0, 0.009), vL.xy - vec2(0.0, 0.009));
  float tubeLight = uA.z * (0.3 + 0.7 * uA.y + 0.4 * uA.w);
  col += LIME * tubeLight * exp(-d2 * 190.0) * (0.03 * max(N.z, 0.0) + 0.12 * max(-N.y, 0.0));
  if (m > 3.5 && m < 4.5) {                                                    // the status light
    float low = uB.z < 0.15 && uC.z < 0.5 ? step(0.0, sin(uC.w * 9.0)) : 0.0;
    col = mix(LIME * (0.1 + 1.8 * uA.w) * uA.z, AMBER * 1.3, low);
    if (uC.z > 0.5) col = vec3(0.9, 0.1, 0.04) * uB.w * step(0.0, sin(uC.w * 19.0)) + vec3(0.02, 0.006, 0.004);
  } else if (m > 4.5 && m < 5.5) {                                             // the funnel, lit from the bottom
    col = base * 0.08 * (0.3 + dif) + LIME * vUv.y * vUv.y * (0.018 + 0.2 * tubeLight);
  }
  else if (m > 9.5 && m < 10.5) col = vec3(0.72, 0.7, 0.56) * (0.2 + 0.62 * dif) * (1.0 - 0.75 * chip) + vec3(0.012);
  else if (m > 10.5) {                                                         // the behind-you lamps
    float on = mix(vUv.y, 1.0 - vUv.y, uD.w) < 0.5 ? uB.x : uB.y;
    col = AMBER * (0.03 + 1.6 * on * (0.65 + 0.35 * sin(uC.w * 18.0)));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class TrackerRenderer {
  constructor(gl) {
    this.gl = gl;
    this.p = deviceProgram(gl, VS, FS);
    this.u = {};
    for (const n of ['uProj', 'uModel', 'uRig', 'uA', 'uB', 'uC', 'uD', 'uE', 'uK', 'uCalm']) this.u[n] = gl.getUniformLocation(this.p, n);
    const mesh = buildTrackerMesh();
    this.count = mesh.length / TRACKER_STRIDE;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  }

  /** s: {proj, model, rig, a, b, c, d, e: 4 floats each (see the shaders), k: 24 floats of blips, calm} */
  draw(s) {
    const gl = this.gl, u = this.u;
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
    gl.useProgram(this.p);
    gl.uniformMatrix4fv(u.uProj, false, s.proj); gl.uniformMatrix4fv(u.uModel, false, s.model);
    gl.uniform4fv(u.uRig, s.rig);
    gl.uniform4fv(u.uA, s.a); gl.uniform4fv(u.uB, s.b); gl.uniform4fv(u.uC, s.c); gl.uniform4fv(u.uD, s.d); gl.uniform4fv(u.uE, s.e); gl.uniform4fv(u.uK, s.k); gl.uniform1f(u.uCalm, s.calm);
    bindDeviceMesh(gl, this.buf, TRACKER_STRIDE);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
}
