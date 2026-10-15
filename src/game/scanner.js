// The hand scanner. Holding the trigger sprays rays from the emitter tip in a cone aimed at whatever
// the crosshair is on; the cone tightens and densifies as it spins up. It heats while held and cuts
// out when it overheats. The sweep fans one even grid of rays from the emitter across the whole view,
// top to bottom, then needs a long recharge. Both make noise.

import {DEG, clamp} from '../util/math.js';
import {MAT, RANGE, SCANNER, NOISE} from '../config.js';
import {cast, hit} from '../world/raycast.js';
import {decalAt} from './decals.js';
import {buzz} from '../ui/haptics.js';

let cr = 0, cg = 0, cb = 0;

/** Dot colour for a hit: warm near, cold far, with per-material tweaks. Writes cr/cg/cb. */
function colorFor(m, t, nd, x, y, z, nx, nz, decals, tintFlesh) {
  if (m === MAT.CORE) { cr = 1; cg = 0.24; cb = 0.55; }
  else if (m === MAT.EXIT) { cr = 1; cg = 0.76; cb = 0.28; }
  else if (m === MAT.NOTE) { cr = 0.55; cg = 1; cb = 0.68; }
  else if (m === MAT.WALL && decals.length && decalAt(decals, x, y, z, nx, nz)) { cr = 1; cg = 0.16; cb = 0.1; }
  else {
    const u = clamp((t - 0.6) / 24, 0, 1);
    if (u < 0.3) { const k = u / 0.3; cr = 1 - 0.78 * k; cg = 0.95 - 0.12 * k; cb = 0.84 - 0.07 * k; }
    else { const k = (u - 0.3) / 0.7; cr = 0.22 + 0.11 * k; cg = 0.83 - 0.47 * k; cb = 0.77 + 0.23 * k; }
    if (m === MAT.FLOOR) { cr *= 0.72; cg *= 0.72; cb *= 0.72; }
    else if (m === MAT.PROP || m === MAT.FLESH) { cr = cr * 0.8 + 0.2; cg = cg * 0.8 + 0.2; cb = cb * 0.8 + 0.2; }
    if (m === MAT.FLESH) {
      if (tintFlesh) { cr = 1; cg *= 0.35; cb *= 0.3; }
      else { cr = cr * 0.45 + 0.5; cg = cg * 0.45 + 0.46; cb = cb * 0.45 + 0.42; } // bone-pale, a little wrong
    }
  }
  const s = (0.5 + 0.5 * nd) * (0.85 + Math.random() * 0.3);
  cr *= s; cg *= s; cb *= s;
}

export class Scanner {
  constructor() {
    this.charge = 0; this.heat = 0; this.overheated = false; this.coolWait = 0;
    this.firing = false; this.wasFiring = false;
    this.scanAcc = 0; this.blipAcc = 0; this.coreBell = 0; this.noiseT = 0; this.warnT = 0;
    this.sweepP = -1; this.sweepRow = 0; this.rows = 0; this.cols = 0; this.pitch = 4;
    this.cooldown = 0; this.sweepBlip = 0; this.sweepBell = 0;
    this.sonT = -1; this.sonCore = false;
  }

  get sweeping() { return this.sweepP >= 0; }
  get active() { return this.firing || this.sweeping; }

  /**
   * ctx: {world, dots, renderer, cam, view: {w, h}, origin (emitter tip in the world, or null to fire
   *       from the eye), interference, sounds, noise, diff, decals, x, z}
   * Returns true on the frame the sweep starts.
   */
  update(dt, T, wantFire, wantSweep, ctx) {
    const {sounds, diff} = ctx;
    // heat
    const firing = wantFire && !this.overheated;
    if (firing) {
      this.heat = Math.min(1, this.heat + dt * (SCANNER.heatRate + SCANNER.heatRateCharge * this.charge) * diff.heat);
      this.coolWait = SCANNER.coolDelay;
      if (this.heat > 0.8 && (this.warnT -= dt) <= 0) { this.warnT = 0.28 - (this.heat - 0.8); sounds.heatWarn(); }
      if (this.heat >= 1) {
        this.overheated = true; sounds.overheat(); buzz([40, 30, 40]);
        ctx.noise(ctx.x, ctx.z, NOISE.overheat, false);
      }
    } else if ((this.coolWait -= dt) <= 0) {
      this.heat = Math.max(0, this.heat - SCANNER.coolRate * dt);
      if (this.overheated && this.heat < SCANNER.ventBelow) { this.overheated = false; sounds.cooled(); }
    }
    this.firing = firing && !this.overheated;

    this.charge = this.firing ? Math.min(1, this.charge + dt / SCANNER.chargeTime) : Math.max(0, this.charge - dt * 3);
    if (this.firing && !this.wasFiring) sounds.trigger();
    this.wasFiring = this.firing;
    sounds.updateHum(this.firing, this.charge, this.heat, ctx.interference || 0);

    if (this.firing) {
      this.spray(dt, T, ctx, this.charge, true, 0);
      this.blipAcc += (8 + 18 * this.charge) * dt;
      if (this.blipAcc >= 1 && this.sonT > 0) { this.blipAcc = 0; sounds.depth(this.sonT, (Math.random() - 0.5) * 0.5); }
      this.coreBell -= dt;
      if (this.sonCore && this.coreBell <= 0) { this.coreBell = 0.5; sounds.coreBell(); }
      if ((this.noiseT -= dt) <= 0) {
        this.noiseT = 0.5;
        ctx.noise(ctx.x, ctx.z, NOISE.scanMin + (NOISE.scanMax - NOISE.scanMin) * this.charge, false);
      }
    } else this.noiseT = 0;

    let started = false;
    if (wantSweep) started = this.startSweep(ctx);
    if (this.sweeping) this.runSweep(dt, T, ctx);
    if (this.cooldown > 0) {
      this.cooldown -= dt;
      if (this.cooldown <= 0) { this.cooldown = 0; sounds.sweepReady(); }
    }
    return started;
  }

  /** Random rays in a cone from the emitter toward the crosshair. `cone` overrides the angle (title demo). */
  spray(dt, T, ctx, c, beams, cone) {
    const {world, dots, renderer, cam, decals, diff} = ctx;
    this.scanAcc += (120 + 3080 * Math.pow(c, 1.5)) * dt;
    let n = Math.floor(this.scanAcc);
    this.scanAcc -= n;
    if (n > SCANNER.maxRaysPerFrame) n = SCANNER.maxRaysPerFrame;
    const tanH = Math.tan((cone || 10 + 14 * c) * DEG), size0 = 0.038 - 0.014 * c;
    const stride = Math.max(1, Math.floor(n / 14));
    const {fx, fy, fz, ex, ey, ez} = cam;
    // cone axis and basis: from the emitter to the point under the crosshair, so the rays converge there
    const o = ctx.origin;
    let ox = ex, oy = ey, oz = ez, ax = fx, ay = fy, az = fz;
    if (o) {
      ox = o[0]; oy = o[1]; oz = o[2];
      const aim = cast(world, ex, ey, ez, fx, fy, fz, RANGE) ? hit.t : RANGE;
      ax = ex + fx * aim - ox; ay = ey + fy * aim - oy; az = ez + fz * aim - oz;
      const al = Math.hypot(ax, ay, az); ax /= al; ay /= al; az /= al;
    }
    let rl = Math.hypot(az, ax);
    const rx = rl > 1e-4 ? -az / rl : cam.rx, rz = rl > 1e-4 ? ax / rl : cam.rz;
    const ux = -rz * ay, uy = rz * ax - rx * az, uz = rx * ay;
    const fxx = ax, fyy = ay, fzz = az;
    const jam = ctx.interference || 0, jit = 0.35 * jam;
    this.sonT = -1; this.sonCore = false;
    for (let i = 0; i < n; i++) {
      if (jam > 0 && Math.random() < jam * 0.3) continue; // dropouts: rays that never come back
      const a = Math.random() * 6.2832, r = Math.sqrt(Math.random()) * tanH, sa = Math.cos(a) * r, sb = Math.sin(a) * r;
      let dx = fxx + rx * sa + ux * sb, dy = fyy + uy * sb, dz = fzz + rz * sa + uz * sb;
      const il = 1 / Math.hypot(dx, dy, dz); dx *= il; dy *= il; dz *= il;
      if (!cast(world, ox, oy, oz, dx, dy, dz, RANGE)) continue;
      const px = ox + dx * hit.t + hit.nx * 0.02, py = oy + dy * hit.t + hit.ny * 0.02, pz = oz + dz * hit.t + hit.nz * 0.02;
      colorFor(hit.m, hit.t, Math.abs(dx * hit.nx + dy * hit.ny + dz * hit.nz), px, py, pz, hit.nx, hit.nz, decals, diff.tintFlesh);
      if (jam > 0) {
        // interference: the scanner misplaces points and some come back red
        const k = jit * Math.min(1, hit.t / 6);
        if (Math.random() < jam * 0.14) { cr = 0.9; cg = 0.08; cb = 0.06; }
        dots.push(px + (Math.random() - 0.5) * k, py + (Math.random() - 0.5) * k, pz + (Math.random() - 0.5) * k, T, cr, cg, cb, size0 * (0.8 + Math.random() * 0.5));
      } else dots.push(px, py, pz, T, cr, cg, cb, size0 * (0.8 + Math.random() * 0.5) * (hit.m >= MAT.CORE && hit.m <= MAT.NOTE ? 1.35 : 1));
      if (hit.actor) { hit.actor.lastHit = T; hit.actor.hits++; }
      if (beams && i % stride === 0) renderer.addLine(ox, oy, oz, px, py, pz, cr, cg, cb, 0.05, 0.22);
      if (hit.m === MAT.CORE) this.sonCore = true;
      if (this.sonT < 0 || Math.random() < 0.12) this.sonT = hit.t;
    }
  }

  startSweep(ctx) {
    if (this.sweeping) return false;
    if (this.cooldown > 0) { ctx.sounds.denied(); return false; }
    const {w, h} = ctx.view;
    const sp = Math.sqrt(w * h / 18000);
    this.pitch = sp;
    this.cols = Math.max(8, Math.ceil(w / sp)); this.rows = Math.max(8, Math.ceil(h / sp));
    this.sweepP = 0; this.sweepRow = 0; this.cooldown = SCANNER.sweepCooldown; this.sweepBlip = 0; this.sweepBell = 0;
    ctx.sounds.sweep(SCANNER.sweepTime);
    ctx.noise(ctx.x, ctx.z, NOISE.sweep, true);
    buzz(15);
    return true;
  }

  runSweep(dt, T, ctx) {
    const {world, dots, renderer, cam, view, decals, diff, sounds} = ctx;
    this.sweepP = Math.min(1, this.sweepP + dt / SCANNER.sweepTime);
    const target = Math.min(this.rows, Math.ceil(this.sweepP * this.rows), this.sweepRow + 6);
    const th = Math.tan(cam.vfov / 2), tw = th * cam.aspect;
    const lstride = Math.max(1, Math.floor(this.cols / 8)), fstride = Math.max(1, Math.floor(this.cols / 30));
    const mPerPx = 0.6 * this.pitch * th / (view.h * 0.5); // dot fills ~60% of the grid pitch at its distance
    const {fx, fy, fz, rx, rz, ux, uy, uz, ex, ey, ez} = cam;
    const o = ctx.origin, ox = o ? o[0] : ex, oy = o ? o[1] : ey, oz = o ? o[2] : ez;
    const fan = this.fan || (this.fan = []);
    let son = -1, core = false;
    for (; this.sweepRow < target; this.sweepRow++) {
      const row = this.sweepRow, ny = 1 - (row + 0.5) / this.rows * 2, off = (row & 1) ? 0.25 : -0.25, lastRow = row === target - 1;
      if (lastRow) fan.length = 0;
      for (let c = 0; c < this.cols; c++) {
        const a = (((c + 0.5 + off + (Math.random() - 0.5) * 0.5) / this.cols) * 2 - 1) * tw;
        const b = (ny + (Math.random() - 0.5) * 1.2 / this.rows) * th;
        let dx = fx + rx * a + ux * b, dy = fy + uy * b, dz = fz + rz * a + uz * b;
        const il = 1 / Math.hypot(dx, dy, dz); dx *= il; dy *= il; dz *= il;
        const fanCol = lastRow && c % fstride === 0;
        // the grid is laid out from your eye so it covers the whole view evenly...
        if (!cast(world, ex, ey, ez, dx, dy, dz, RANGE)) { if (fanCol) fan.push(null); continue; }
        const eyeT = hit.t;
        let tx = ex + dx * eyeT, ty = ey + dy * eyeT, tz = ez + dz * eyeT, t = eyeT;
        let nx = hit.nx, nyy = hit.ny, nz = hit.nz, m = hit.m, actor = hit.actor;
        // ...but the light comes from the gun: fire from the emitter at that spot. If something only the
        // gun can see is in the way, the dot lands on that instead (the gun's own shadow).
        if (o) {
          let gx = tx - ox, gy = ty - oy, gz = tz - oz;
          const gl = Math.hypot(gx, gy, gz); gx /= gl; gy /= gl; gz /= gl;
          if (cast(world, ox, oy, oz, gx, gy, gz, gl + 0.05)) {
            t = hit.t; dx = gx; dy = gy; dz = gz;
            tx = ox + gx * t; ty = oy + gy * t; tz = oz + gz * t;
            nx = hit.nx; nyy = hit.ny; nz = hit.nz; m = hit.m; actor = hit.actor;
          }
        }
        const px = tx + nx * 0.02, py = ty + nyy * 0.02, pz = tz + nz * 0.02;
        colorFor(m, t, Math.abs(dx * nx + dy * nyy + dz * nz), px, py, pz, nx, nz, decals, diff.tintFlesh);
        dots.push(px, py, pz, T, cr, cg, cb, clamp(eyeT * mPerPx, 0.007, 0.034) * (0.85 + Math.random() * 0.3) * (m >= MAT.CORE && m <= MAT.NOTE ? 1.5 : 1));
        if (actor) { actor.lastHit = T; actor.hits++; }
        if (fanCol) fan.push([px, py, pz, eyeT]);
        if (lastRow && c % lstride === 0) renderer.addLine(ox, oy, oz, px, py, pz, cr, cg, cb, 0.12, 0.35);
        if (m === MAT.CORE) core = true;
        if (son < 0 || Math.random() < 0.02) son = t;
      }
    }
    // the sheet of light from the emitter to the line it is painting
    renderer.addFan(ox, oy, oz, fan, 0.55, 0.95, 0.88);
    this.sweepBlip += 15 * dt; this.sweepBell -= dt;
    if (this.sweepBlip >= 1 && son > 0) { this.sweepBlip = 0; sounds.depth(son, (Math.random() - 0.5) * 0.8, 0.022); }
    if (core && this.sweepBell <= 0) { this.sweepBell = 0.6; sounds.coreBell(); }
    if (this.sweepRow >= this.rows) { this.sweepP = -1; sounds.sweepEnd(); }
  }

  /** Fraction of the view the sweep has covered so far, top to bottom (the gun follows it). */
  get beamY() { return this.rows ? this.sweepRow / this.rows : 0; }

  /** Red burst when caught: the scanner's last look at what got you. */
  burst(T, ctx, n = 1400) {
    if (ctx.interference) ctx = {...ctx, interference: 0};
    const {world, dots, cam} = ctx;
    const {fx, fy, fz, rx, rz, ux, uy, uz, ex, ey, ez} = cam, tanH = Math.tan(40 * DEG);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.2832, r = Math.sqrt(Math.random()) * tanH, sa = Math.cos(a) * r, sb = Math.sin(a) * r;
      let dx = fx + rx * sa + ux * sb, dy = fy + uy * sb, dz = fz + rz * sa + uz * sb;
      const il = 1 / Math.hypot(dx, dy, dz); dx *= il; dy *= il; dz *= il;
      if (!cast(world, ex, ey, ez, dx, dy, dz, RANGE)) continue;
      const k = hit.actor ? 1 : 0.35;
      dots.push(ex + dx * hit.t, ey + dy * hit.t, ez + dz * hit.t, T, k, 0.08 * k, 0.06 * k, 0.03);
    }
  }
}
