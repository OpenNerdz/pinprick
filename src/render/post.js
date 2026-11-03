// The picture after the scene. The dots land in an off-screen buffer that can hold more than white, and
// are brought back down here, so a held scan keeps its dot-by-dot texture and its colour instead of
// burning into a white disc:
//
//   scene ─> hdr ─┬─> bright + density, quarter size ─> blur H ─> blur V ─┐
//                 └────────────────────────────────────────────────> resolve ─> canvas
//   then the hand-held devices (antialiased by the canvas), then grain and vignette over everything.
//
// resolve: local exposure from the density around each pixel, a tight bloom from bright dots only, and
// a shoulder on the brightest channel, so that red stays red and lime stays lime however hot. A single
// dot passes through nearly untouched and is never filtered: the hdr buffer is read one to one.
//
// Fear shows here too, sparingly: the view closes in and the grain rises, scan rows tear when it is very
// close, and the red wave of its sonar passes through the picture. All of it moves whole pixels, because
// anything softer turns the dots to mush.
//
// Prefers half-float. Without it, plain 8-bit holding the scene at a quarter of its brightness still leaves
// room for the same resolve (see `sceneScale`). `lite` (low quality) is 8-bit, one copy to the canvas and
// nothing else: the dots still stay off the canvas, because its antialiasing samples multiply what blending
// them costs. When no off-screen buffer can be made at all, the renderer draws straight to the canvas.

const HEAD = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n';
const NOISE = 256; // grain tile, big enough that it does not read as a pattern
const FSQ_VS = 'attribute vec2 aP;varying vec2 vUv;void main(){vUv=aP*0.5+0.5;gl_Position=vec4(aP,0.0,1.0);}';

const DOWN_FS = HEAD + `
uniform sampler2D uT; uniform vec2 uPx; uniform float uIn, uOut;
varying vec2 vUv;
vec3 tap(vec2 o) { return min(texture2D(uT, vUv + o * uPx).rgb * uIn, vec3(32.0)); }
void main() {
  // four bilinear taps cover the 4 x 4 pixels under this one, so no dot falls between samples
  vec3 c = (tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0))) * 0.25;
  float L = max(c.r, max(c.g, c.b));
  gl_FragColor = vec4(min(c * smoothstep(0.75, 1.8, L), vec3(5.0)), dot(c, vec3(0.3, 0.59, 0.11))) * uOut;
}`;

const COPY_FS = HEAD + 'uniform sampler2D uT;varying vec2 vUv;void main(){gl_FragColor=texture2D(uT,vUv);}';

const BLUR_FS = HEAD + `
uniform sampler2D uT; uniform vec2 uDir;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uT, vUv) * 0.2270270
    + (texture2D(uT, vUv + uDir * 1.3846154) + texture2D(uT, vUv - uDir * 1.3846154)) * 0.3162162
    + (texture2D(uT, vUv + uDir * 3.2307692) + texture2D(uT, vUv - uDir * 3.2307692)) * 0.0702703;
}`;

const RESOLVE_FS = HEAD + `
uniform sampler2D uHdr, uBloom, uNoise;
uniform vec2 uRes, uLens;
uniform float uIn, uAspect, uLensGlow, uTear, uPing, uPingR, uPingPush, uSeed;
varying vec2 vUv;
const vec3 TEAL = vec3(0.22, 0.83, 0.77);
void main() {
  vec2 uv = vUv, q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = length(q);
  vec3 add = vec3(0.0);
  if (uPing > 0.001) { // its sonar washing over you, a red ring running outward
    float w = (r - uPingR) / 0.11, ring = exp(-w * w) * uPing;
    uv = (floor((uv - q / max(r, 0.001) * ring * uPingPush) * uRes) + 0.5) / uRes;
    add = vec3(1.0, 0.1, 0.06) * ring * 0.1;
  }
  if (uTear > 0.001) { // whole scan rows slip sideways
    float n = texture2D(uNoise, vec2(floor(gl_FragCoord.y / 7.0) * 0.00865, uSeed)).r;
    uv.x += floor(step(0.93, n) * (n - 0.965) * uTear * 2.0 + 0.5) / uRes.x;
  }
  vec3 c = texture2D(uHdr, uv).rgb * uIn;
  vec4 b = texture2D(uBloom, vUv) * uIn;
  // where dots pile up, the exposure drops, so the gaps between them still show
  float e = 1.0 / (1.0 + 1.7 * max(b.a - 0.7, 0.0));
  c = (c + b.rgb * 0.26) * e + add;
  if (uLensGlow > 0.002) {
    vec2 dl = (vUv - uLens) * vec2(uAspect, 1.0);
    c += TEAL * uLensGlow * exp(-dot(dl, dl) / 0.0028);
  }
  // a shoulder on the brightest channel: the hue survives, nothing clips to white
  float L = max(c.r, max(c.g, c.b));
  if (L > 0.8) c *= (0.8 + 0.2 * (1.0 - exp((0.8 - L) / 0.2))) / L;
  gl_FragColor = vec4(c, 1.0);
}`;

// blended over everything with (ONE, SRC_ALPHA): rgb adds, alpha multiplies
const FINISH_FS = HEAD + `
uniform sampler2D uNoise;
uniform vec2 uScale, uOff;
uniform float uVig, uGrain, uLift;
varying vec2 vUv;
void main() {
  vec2 q = (vUv - 0.5) * 2.0;
  float r2 = dot(q, q) * 0.5;
  vec4 n = texture2D(uNoise, vUv * uScale + uOff);
  gl_FragColor = vec4(vec3(n.g * n.g * uLift), (1.0 - uVig * smoothstep(0.3, 1.0, r2)) * (1.0 - uGrain * n.r));
}`;

export class PostFx {
  constructor(gl, lite = false) {
    this.gl = gl;
    this.lite = lite;
    this.ok = false;
    this.w = 0; this.h = 0;
    this.frame = 0;
    this.seed = 0; this.offX = 0; this.offY = 0;
    this.hdr = null; this.hdrFbo = null; this.depth = null;
    this.bloomA = null; this.bloomB = null; this.fboA = null; this.fboB = null;
    this.tier = 'none';
    this.down = this.blur = this.resolver = this.finisher = this.copy = this.noise = this.tri = null;
    this.sceneScale = 1;       // what the scene multiplies its light by; the 8-bit tier trades precision for room
    this.depthBits = 0;
    this.tri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    if (lite) {
      this.halfFloat = 0;
      this.copy = this.program(COPY_FS, ['uT']);
      this.ok = !!this.copy;
      return;
    }
    const hf = gl.getExtension('OES_texture_half_float');
    const linear = gl.getExtension('OES_texture_half_float_linear');
    const color = gl.getExtension('EXT_color_buffer_half_float');
    // bloom needs bilinear reads and additive dots need blending, so half-float takes all three
    this.halfFloat = hf && linear && color ? hf.HALF_FLOAT_OES : 0;

    this.down = this.program(DOWN_FS, ['uT', 'uPx', 'uIn', 'uOut']);
    this.blur = this.program(BLUR_FS, ['uT', 'uDir']);
    this.resolver = this.program(RESOLVE_FS, ['uHdr', 'uBloom', 'uNoise', 'uRes', 'uLens', 'uIn', 'uAspect', 'uLensGlow', 'uTear', 'uPing', 'uPingR', 'uPingPush', 'uSeed']);
    this.finisher = this.program(FINISH_FS, ['uNoise', 'uScale', 'uOff', 'uVig', 'uGrain', 'uLift']);
    this.noise = gl.createTexture();
    const px = new Uint8Array(NOISE * NOISE * 4);
    for (let i = 0; i < px.length; i++) px[i] = Math.random() * 256;
    gl.bindTexture(gl.TEXTURE_2D, this.noise);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, NOISE, NOISE, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    this.ok = !!(this.down && this.blur && this.resolver && this.finisher);
  }

  program(fs, uniforms) {
    const gl = this.gl;
    const mk = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) console.error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, mk(gl.VERTEX_SHADER, FSQ_VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aP');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      if (!gl.isContextLost()) console.error(gl.getProgramInfoLog(p));
      return null;
    }
    const u = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(p, name);
    return {p, u};
  }

  target(w, h, type) {
    const gl = this.gl, t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return {t, f};
  }

  freeTargets() {
    const gl = this.gl;
    for (const t of [this.hdr, this.bloomA, this.bloomB]) if (t) gl.deleteTexture(t);
    for (const f of [this.hdrFbo, this.fboA, this.fboB]) if (f) gl.deleteFramebuffer(f);
    if (this.depth) gl.deleteRenderbuffer(this.depth);
    this.hdr = this.bloomA = this.bloomB = this.hdrFbo = this.fboA = this.fboB = this.depth = null;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  alloc(w, h, type) {
    const gl = this.gl;
    while (gl.getError()) { /* only errors from here on count */ }
    const a = this.target(w, h, type);
    this.hdr = a.t; this.hdrFbo = a.f;
    // the level's depth lives here while the scene is drawn, and sixteen bits would let far dots sink into
    // their walls; a combined depth-stencil buffer is the way to more of it in WebGL 1
    this.depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_STENCIL, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.depth);
    this.depthBits = gl.getRenderbufferParameter(gl.RENDERBUFFER, gl.RENDERBUFFER_DEPTH_SIZE);
    let ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    const bw = Math.max(1, Math.ceil(w / 4)), bh = Math.max(1, Math.ceil(h / 4));
    if (ok && !this.lite) {
      const b0 = this.target(bw, bh, type);
      this.bloomA = b0.t; this.fboA = b0.f;
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      const b1 = this.target(bw, bh, type);
      this.bloomB = b1.t; this.fboB = b1.f;
      ok = ok && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
    if (gl.getError()) ok = false; // out of memory, most likely
    if (!ok) this.freeTargets();
    return ok;
  }

  /** Match the drawing buffer. False when no off-screen buffer can be made at all. */
  resize(w, h) {
    if (w === this.w && h === this.h && this.hdr) return true;
    const gl = this.gl;
    this.freeTargets();
    this.w = w; this.h = h;
    if (this.halfFloat && this.alloc(w, h, this.halfFloat)) { this.tier = 'hdr'; this.sceneScale = 1; }
    else if (this.alloc(w, h, gl.UNSIGNED_BYTE)) { this.tier = this.lite ? 'lite' : 'ldr'; this.sceneScale = this.lite ? 1 : 0.25; }
    else { this.tier = 'none'; gl.bindFramebuffer(gl.FRAMEBUFFER, null); return false; }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return true;
  }

  /** Point drawing at the scene buffer. */
  bindScene() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.hdrFbo);
    gl.viewport(0, 0, this.w, this.h);
  }

  useTriangle() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.tri);
    gl.enableVertexAttribArray(0);
    for (let i = 1; i < 4; i++) gl.disableVertexAttribArray(i);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  /**
   * Bloom, then the scene brought down onto the canvas, which is left bound and cleared of depth, ready
   * for the devices. fear and ping are 0..1; the lens is where the emitter sits on screen (0..1), and how
   * brightly it is lit. `still` drops what moves the picture, for players who ask for less motion.
   */
  resolve(fear, ping, lensU, lensV, lensGlow, still) {
    const gl = this.gl, w = this.w, h = this.h, bw = Math.max(1, Math.ceil(w / 4)), bh = Math.max(1, Math.ceil(h / 4));
    const inv = 1 / this.sceneScale;
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(false);
    this.useTriangle();
    gl.activeTexture(gl.TEXTURE0);
    if (this.lite) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
      gl.depthMask(true);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.copy.p);
      gl.bindTexture(gl.TEXTURE_2D, this.hdr);
      gl.uniform1i(this.copy.u.uT, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return;
    }

    // bright dots and density, a quarter of the size
    const D = this.down;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA); gl.viewport(0, 0, bw, bh);
    gl.useProgram(D.p);
    gl.bindTexture(gl.TEXTURE_2D, this.hdr);
    gl.uniform1i(D.u.uT, 0); gl.uniform2f(D.u.uPx, 1 / w, 1 / h);
    gl.uniform1f(D.u.uIn, inv); gl.uniform1f(D.u.uOut, this.sceneScale);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const B = this.blur;
    gl.useProgram(B.p); gl.uniform1i(B.u.uT, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboB);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomA);
    gl.uniform2f(B.u.uDir, 1 / bw, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboA);
    gl.bindTexture(gl.TEXTURE_2D, this.bloomB);
    gl.uniform2f(B.u.uDir, 0, 1 / bh);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // down onto the canvas
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, w, h);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.depthMask(false);
    const R = this.resolver, u = R.u;
    gl.useProgram(R.p);
    gl.bindTexture(gl.TEXTURE_2D, this.hdr);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.bloomA);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.noise);
    gl.uniform1i(u.uHdr, 0); gl.uniform1i(u.uBloom, 1); gl.uniform1i(u.uNoise, 2);
    gl.uniform2f(u.uRes, w, h); gl.uniform1f(u.uAspect, w / h); gl.uniform1f(u.uIn, inv);
    gl.uniform2f(u.uLens, lensU, lensV); gl.uniform1f(u.uLensGlow, lensGlow);
    this.frame++;
    if (!still && (this.frame & 1)) { this.seed = Math.random(); this.offX = Math.random(); this.offY = Math.random(); }
    gl.uniform1f(u.uSeed, this.seed);
    const close = Math.max(0, (fear - 0.72) / 0.28);
    gl.uniform1f(u.uTear, still ? 0 : 90 * close * (h / 720)); // a torn row slips up to about six pixels at 720p
    gl.uniform1f(u.uPing, ping); gl.uniform1f(u.uPingR, (1 - ping) * 1.15); gl.uniform1f(u.uPingPush, still ? 0 : 0.004);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Grain and vignette over the finished picture. */
  finish(fear) {
    const gl = this.gl, F = this.finisher, u = F.u;
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.SRC_ALPHA);
    this.useTriangle();
    gl.useProgram(F.p);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.noise);
    gl.uniform1i(u.uNoise, 2);
    gl.uniform2f(u.uScale, this.w / NOISE, this.h / NOISE); gl.uniform2f(u.uOff, this.offX, this.offY);
    gl.uniform1f(u.uVig, 0.3 + 0.3 * fear);
    gl.uniform1f(u.uGrain, 0.045 + 0.035 * fear);
    gl.uniform1f(u.uLift, 0.012 + 0.012 * fear);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);
    gl.disable(gl.BLEND); gl.depthMask(true);
  }

  dispose() {
    const gl = this.gl;
    this.freeTargets();
    for (const P of [this.down, this.blur, this.resolver, this.finisher, this.copy]) if (P) gl.deleteProgram(P.p);
    if (this.tri) gl.deleteBuffer(this.tri);
    if (this.noise) gl.deleteTexture(this.noise);
  }
}
