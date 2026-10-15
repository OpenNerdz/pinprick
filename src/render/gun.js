// Draws the hand scanner over the scene. It uses the camera's own projection, so the emitter tip on
// screen is exactly where the scanner's rays and beam lines start in the world. Depth is cleared
// first, so it never sinks into walls.
//
// Lighting is deliberately sparse for a dark game: a dim key light, a cold rim so the silhouette
// reads against black, the emitter's own glow on nearby metal when it fires, and emissive parts
// (lens, coils, heat fins, status screen) driven by the scanner's state.

import {buildGunMesh, GUN_STRIDE} from './gunmesh.js';

const VS = `
attribute vec3 aPos; attribute vec3 aNrm; attribute vec2 aUv; attribute float aMat;
uniform mat4 uProj, uModel;
varying vec3 vP, vN; varying vec2 vUv; varying float vMat;
void main(){
  vec4 p = uModel * vec4(aPos, 1.0);
  vP = p.xyz; vN = (uModel * vec4(aNrm, 0.0)).xyz; vUv = aUv; vMat = aMat;
  gl_Position = uProj * p;
}`;

const FS = `
precision mediump float;
varying vec3 vP, vN; varying vec2 vUv; varying float vMat;
uniform vec3 uLens;
uniform float uCharge, uFiring, uHeat, uOver, uSweep, uTime, uFlash;
const vec3 TEAL = vec3(0.22, 0.83, 0.77);
vec3 heatCol(float h){ return mix(vec3(1.0, 0.42, 0.08), vec3(1.0, 0.08, 0.04), h); }
float bar(vec2 uv, float y0, float y1, float fill){
  float inside = step(0.08, uv.x) * step(uv.x, 0.92) * step(y0, uv.y) * step(uv.y, y1);
  float lit = step((uv.x - 0.08) / 0.84, fill);
  return inside * (0.18 + 0.82 * lit);
}
void main(){
  float m = floor(vMat + 0.5);
  vec3 N = normalize(vN), V = normalize(-vP), L = normalize(vec3(-0.45, 0.85, 0.35));
  vec3 base = m < 0.5 ? vec3(0.07, 0.08, 0.085) : m < 1.5 ? vec3(0.15, 0.17, 0.18) : m < 2.5 ? vec3(0.03, 0.03, 0.035) : vec3(0.05, 0.06, 0.06);
  float dif = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, normalize(L + V)), 0.0), m < 2.5 && m > 1.5 ? 8.0 : 42.0) * (m > 1.5 && m < 2.5 ? 0.04 : 0.35);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 toLens = uLens - vP; float dl = length(toLens);
  float glow = (0.05 + uCharge * uFiring + uFlash) * max(dot(N, toLens / dl), 0.0) / (1.0 + dl * dl * 90.0);
  vec3 col = base * (0.10 + 0.55 * dif) + vec3(spec) * 0.6 + rim * vec3(0.10, 0.22, 0.22) + TEAL * glow * 1.6;
  float flick = 0.85 + 0.15 * sin(uTime * 53.0) * sin(uTime * 17.0);
  if (m > 2.5 && m < 3.5) col = TEAL * (0.35 + 1.6 * uCharge * uFiring * flick + 2.0 * uFlash);       // lens
  else if (m > 3.5 && m < 4.5) {                                                                    // coils
    float wave = 0.55 + 0.45 * sin(uTime * 26.0 + vP.z * 140.0);
    col = col * 0.6 + TEAL * (0.06 + uCharge * uFiring * wave * 1.1 + uFlash);
  } else if (m > 4.5 && m < 5.5) {                                                                  // fins
    float hot = smoothstep(0.5, 1.0, uHeat) * (uOver > 0.5 ? 0.7 + 0.3 * sin(uTime * 22.0) : 1.0);
    col = col + heatCol(uHeat) * hot * 0.85;
  } else if (m > 5.5) {                                                                             // screen
    vec2 uv = vUv;
    vec3 s = vec3(0.01, 0.035, 0.035);
    s += TEAL * bar(uv, 0.66, 0.84, uCharge);
    s += heatCol(uHeat) * bar(uv, 0.40, 0.58, uOver > 0.5 ? (sin(uTime * 14.0) > 0.0 ? 1.0 : 0.0) : uHeat);
    float cell = floor((uv.x - 0.08) / 0.168), inCell = fract((uv.x - 0.08) / 0.168);
    float led = step(0.08, uv.x) * step(uv.x, 0.92) * step(0.12, uv.y) * step(uv.y, 0.28) * step(0.18, inCell) * step(inCell, 0.82);
    s += vec3(1.0, 0.95, 0.84) * led * (cell < uSweep * 5.0 - 0.001 ? 0.9 : 0.12);
    float frame = 1.0 - step(0.03, uv.x) * step(uv.x, 0.97) * step(0.04, uv.y) * step(uv.y, 0.96);
    s += TEAL * frame * 0.35;
    s *= 0.86 + 0.14 * sin(uv.y * 160.0);
    col = s;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

export class GunRenderer {
  constructor(gl) {
    this.gl = gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, FS));
    ['aPos', 'aNrm', 'aUv', 'aMat'].forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) console.error(gl.getProgramInfoLog(p));
    this.p = p;
    this.u = {};
    for (const n of ['uProj', 'uModel', 'uLens', 'uCharge', 'uFiring', 'uHeat', 'uOver', 'uSweep', 'uTime', 'uFlash']) this.u[n] = gl.getUniformLocation(p, n);
    const mesh = buildGunMesh();
    this.count = mesh.length / GUN_STRIDE;
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, mesh, gl.STATIC_DRAW);
  }

  /** s: {proj, model, lens: [x,y,z] in view space, charge, firing, heat, over, sweep (0..1 ready), time, flash} */
  draw(s) {
    const gl = this.gl, u = this.u;
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.disable(gl.BLEND);
    gl.useProgram(this.p);
    gl.uniformMatrix4fv(u.uProj, false, s.proj); gl.uniformMatrix4fv(u.uModel, false, s.model);
    gl.uniform3f(u.uLens, s.lens[0], s.lens[1], s.lens[2]);
    gl.uniform1f(u.uCharge, s.charge); gl.uniform1f(u.uFiring, s.firing ? 1 : 0);
    gl.uniform1f(u.uHeat, s.heat); gl.uniform1f(u.uOver, s.over ? 1 : 0);
    gl.uniform1f(u.uSweep, s.sweep); gl.uniform1f(u.uTime, s.time); gl.uniform1f(u.uFlash, s.flash);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    for (let i = 0; i < 4; i++) gl.enableVertexAttribArray(i);
    const B = GUN_STRIDE * 4;
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, B, 0);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, B, 12);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, B, 24);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, B, 32);
    gl.drawArrays(gl.TRIANGLES, 0, this.count);
  }
}
