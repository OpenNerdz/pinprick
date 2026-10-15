// How the scanner sits in your hands. Every frame it works out the gun's pose in view space from what
// you are doing, and from that the emitter tip in the world, which is where the scanner's rays start.
//
//   idle: slow breathing drift          walking: bob and sway in step
//   turning: the gun lags behind your view, then catches up
//   strafing: tilts into the turn       sprinting: lowered and turned in
//   charging: the barrel trembles       sweep: a kick back and up
//   overheated: dips and shakes         against a wall: pulled back and raised
//   caught: it falls out of your hands

import {mat4, identity, translate, rotateX, rotateY, rotateZ, scale, transformPoint} from '../util/mat4.js';
import {MUZZLE} from '../render/gunmesh.js';
import {cast, hit} from '../world/raycast.js';
import {clamp} from '../util/math.js';

// where the gun sits: a fixed spot on screen (so it looks the same in portrait and landscape),
// this far ahead, at this size, with the barrel aimed at a point this far down the view
const SPOT = {ndcX: 0.44, ndcY: -0.6, z: -0.46, size: 0.8, aim: 6};

export class ViewModel {
  constructor() {
    this.model = mat4();
    this.lens = [0, 0, 0];               // emitter tip, view space
    this.muzzle = new Float32Array(3);   // emitter tip, world space
    this.muzzleClear = true;             // false when the tip is inside a wall
    this.lagYaw = 0; this.lagPitch = 0; this.roll = 0;
    this.lower = 0; this.retract = 0; this.kick = 0; this.drop = 0; this.flash = 0; this.sweepAim = 0;
    this.wasFiring = false; this.wasSweeping = false;
  }

  /**
   * s: the session (player, scanner, world, state); intent: this frame's input; cam: already placed.
   */
  update(dt, T, s, intent, cam, lefty, reduceMotion) {
    const p = s.player, sc = s.scanner, k = Math.min(1, dt * 10);
    const calm = reduceMotion ? 0.3 : 1;

    // turning: lag behind the view by an amount tied to how fast you turn
    const ty = clamp(intent.lookX / Math.max(dt, 1e-3) * 0.018, -0.14, 0.14);
    const tp = clamp(intent.lookY / Math.max(dt, 1e-3) * 0.014, -0.1, 0.1);
    this.lagYaw += (ty - this.lagYaw) * Math.min(1, dt * 8);
    this.lagPitch += (tp - this.lagPitch) * Math.min(1, dt * 8);
    this.roll += (-intent.moveX * 0.09 - this.roll) * Math.min(1, dt * 6);
    this.lower += ((p.sprinting ? 1 : 0) - this.lower) * Math.min(1, dt * 7);
    this.drop += ((s.state === 'caught' ? 1 : 0) - this.drop) * Math.min(1, dt * 5);
    // during a sweep the barrel tracks the sheet of light from the top of the view to the bottom
    this.sweepAim += ((sc.sweeping ? 0.42 - 0.95 * sc.beamY : 0) - this.sweepAim) * Math.min(1, dt * 12);

    // pull back when the barrel would poke into a wall in front of you
    const wall = cast(s.world, cam.ex, cam.ey, cam.ez, cam.fx, cam.fy, cam.fz, 1.2, false) ? hit.t : 1.2;
    this.retract += (clamp((0.85 - wall) / 0.55, 0, 1) - this.retract) * k;

    // shots: a flash and a little shove when the trigger goes down, a big kick for the sweep
    if (sc.firing && !this.wasFiring) { this.flash = Math.max(this.flash, 0.5); this.kick = Math.max(this.kick, 0.25); }
    if (sc.sweeping && !this.wasSweeping) { this.flash = 1; this.kick = 1; }
    this.wasFiring = sc.firing; this.wasSweeping = sc.sweeping;
    this.flash = Math.max(0, this.flash - dt * 3);
    this.kick = Math.max(0, this.kick - dt * 3.5);

    const m = p.moveAmt, b = p.bob;
    const shake = (sc.firing ? 0.0028 * sc.charge : 0) + (sc.overheated ? 0.004 : 0) + (sc.heat > 0.8 ? 0.0015 : 0);
    const jx = (Math.random() - 0.5) * shake * calm, jy = (Math.random() - 0.5) * shake * calm;
    // portrait screens: a little further in, so the scan and sweep buttons don't cover it
    const ndcX = cam.aspect < 1 ? 0.3 : SPOT.ndcX, ndcY = cam.aspect < 1 ? -0.56 : SPOT.ndcY;
    const th = Math.tan(cam.vfov / 2), bx = ndcX * th * cam.aspect * -SPOT.z, by = ndcY * th * -SPOT.z;
    const byaw = Math.atan2(bx, SPOT.aim + SPOT.z), bpitch = Math.atan2(-by, SPOT.aim + SPOT.z);
    let x = bx + Math.cos(b) * 0.011 * m * calm + jx + 0.03 * this.lower;
    let y = by - Math.abs(Math.sin(b)) * 0.013 * m * calm + Math.sin(T * 1.3) * 0.003 * calm + jy
      - 0.09 * this.lower - 0.03 * this.retract - 0.45 * this.drop + 0.012 * p.crouchT;
    let z = SPOT.z + 0.04 * this.kick + 0.13 * this.retract - (sc.firing ? 0.008 * sc.charge : 0);
    let yaw = byaw + this.lagYaw + 0.4 * this.lower;
    let pitch = bpitch + this.sweepAim + this.lagPitch + 0.16 * this.kick + 0.55 * this.retract - 0.5 * this.lower
      - (sc.overheated ? 0.18 : 0) + Math.sin(T * 1.1) * 0.006 * calm - 1.1 * this.drop;
    let roll = this.roll + Math.cos(b) * 0.02 * m * calm + 0.05 * p.crouchT + (sc.overheated ? 0.12 : 0) + 0.7 * this.drop;
    if (lefty) { x = -x; yaw = -yaw; roll = -roll; }

    const M = identity(this.model);
    translate(M, x, y, z);
    rotateY(M, yaw); rotateX(M, pitch); rotateZ(M, roll);
    scale(M, lefty ? -SPOT.size : SPOT.size, SPOT.size, SPOT.size);

    transformPoint(this.lens, M, MUZZLE[0], MUZZLE[1], MUZZLE[2]);
    cam.toWorld(this.lens[0], this.lens[1], this.lens[2], this.muzzle);
    // if the tip is inside geometry, fire from the eye instead
    const dx = this.muzzle[0] - cam.ex, dy = this.muzzle[1] - cam.ey, dz = this.muzzle[2] - cam.ez, d = Math.hypot(dx, dy, dz);
    this.muzzleClear = !cast(s.world, cam.ex, cam.ey, cam.ez, dx / d, dy / d, dz / d, d + 0.02, false);
  }

  /** What the gun renderer needs this frame. */
  drawState(sc, cooldownTotal, T) {
    const st = this._ds || (this._ds = {});
    st.model = this.model; st.lens = this.lens;
    st.charge = sc.charge; st.firing = sc.firing; st.heat = sc.heat; st.over = sc.overheated;
    st.sweep = sc.cooldown > 0 ? 1 - sc.cooldown / cooldownTotal : 1;
    st.time = T; st.flash = this.flash;
    return st;
  }
}
