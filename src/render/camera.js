// First-person camera: yaw/pitch basis vectors and a combined view-projection matrix.
// yaw 0 looks toward -z; right is +x; y is up.

import {DEG} from '../util/math.js';

export class Camera {
  constructor() {
    this.fx = 0; this.fy = 0; this.fz = -1;
    this.rx = 1; this.rz = 0;
    this.ux = 0; this.uy = 1; this.uz = 0;
    this.ex = 0; this.ey = 1.6; this.ez = 0;
    this.vfov = 70 * DEG;
    this.aspect = 1;
    this.near = 0.06;
    this.far = 90;
    this.vp = new Float32Array(16);
    this.proj = new Float32Array(16);   // projection alone, for things drawn in view space (the gun)
  }

  resize(w, h) {
    this.aspect = w / h;
    // keep the horizontal view near 66 degrees in portrait, open up a little in landscape
    this.vfov = Math.max(62 * DEG, Math.min(100 * DEG, 2 * Math.atan(Math.tan(33 * DEG) / this.aspect)));
  }

  set(ex, ey, ez, yaw, pitch) {
    this.ex = ex; this.ey = ey; this.ez = ez;
    const cp = Math.cos(pitch);
    this.fx = Math.sin(yaw) * cp; this.fy = Math.sin(pitch); this.fz = -Math.cos(yaw) * cp;
    this.rx = Math.cos(yaw); this.rz = Math.sin(yaw);
    this.ux = -this.rz * this.fy; this.uy = this.rz * this.fx - this.rx * this.fz; this.uz = this.rx * this.fy;
    this.build();
  }

  build() {
    const {fx, fy, fz, rx, rz, ux, uy, uz, ex, ey, ez, vp} = this;
    const f = 1 / Math.tan(this.vfov / 2), nf = 1 / (this.near - this.far);
    const p0 = f / this.aspect, p5 = f, p10 = (this.far + this.near) * nf, p14 = 2 * this.far * this.near * nf;
    const re = rx * ex + rz * ez, ue = ux * ex + uy * ey + uz * ez, fe = fx * ex + fy * ey + fz * ez;
    vp[0] = p0 * rx; vp[1] = p5 * ux; vp[2] = -p10 * fx; vp[3] = fx;
    vp[4] = 0;       vp[5] = p5 * uy; vp[6] = -p10 * fy; vp[7] = fy;
    vp[8] = p0 * rz; vp[9] = p5 * uz; vp[10] = -p10 * fz; vp[11] = fz;
    vp[12] = -p0 * re; vp[13] = -p5 * ue; vp[14] = p10 * fe + p14; vp[15] = -fe;
    const P = this.proj, gn = 0.02, gnf = 1 / (gn - this.far);
    P.fill(0);
    P[0] = p0; P[5] = p5; P[10] = (this.far + gn) * gnf; P[11] = -1; P[14] = 2 * this.far * gn * gnf;
  }

  /** View-space point (x right, y up, -z ahead) to world space, written into out. */
  toWorld(x, y, z, out) {
    out[0] = this.ex + this.rx * x + this.ux * y - this.fx * z;
    out[1] = this.ey + this.uy * y - this.fy * z;
    out[2] = this.ez + this.rz * x + this.uz * y - this.fz * z;
    return out;
  }

  /** World point a short way in front of the lens, given the lens position in NDC (-1..1). */
  muzzle(nx, ny, out) {
    const dm = 0.5, th = Math.tan(this.vfov / 2), vx = nx * dm * th * this.aspect, vy = ny * dm * th;
    out[0] = this.ex + this.rx * vx + this.ux * vy + this.fx * dm;
    out[1] = this.ey + this.uy * vy + this.fy * dm;
    out[2] = this.ez + this.rz * vx + this.uz * vy + this.fz * dm;
    return out;
  }
}
