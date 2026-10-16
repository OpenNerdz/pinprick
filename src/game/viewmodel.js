// How the scanner sits in your hands. Every frame it works out the gun's pose in view space from what
// you are doing, and from that the emitter tip in the world, which is where the scanner's rays start.
//
//   idle: slow breathing drift          walking: bob and sway in step
//   turning: the gun lags behind your view, then catches up
//   strafing: tilts into the turn       sprinting: lowered and turned in
//   charging: the barrel trembles       sweep: a kick back and up
//   overheated: dips and shakes         against a wall: pulled back and raised
//   caught: it falls out of your hands
//
// The motion tracker has its own pose in your other hand, on the other side of the view from the
// scanner: it comes up from below with a little overshoot, faces you (sized to the screen, so it reads
// on a phone, and on touch screens held higher so the thumb on the stick does not cover it), nods with
// each pulse, shakes when something is right on top of you, and falls when you are caught. A dead one
// lifts a little when you try it, and drops again.

import {mat4, identity, translate, rotateX, rotateY, rotateZ, scale, transformPoint} from '../util/mat4.js';
import {MUZZLE} from '../render/gunmesh.js';
import {TRACKER_SCREEN} from '../render/trackermesh.js';
import {TRACKER} from '../config.js';
import {cast, hit} from '../world/raycast.js';
import {clamp} from '../util/math.js';

// where the gun sits: a fixed spot on screen (so it looks the same in portrait and landscape),
// this far ahead, at this size, with the barrel aimed at a point this far down the view
const SPOT = {ndcX: 0.44, ndcY: -0.6, z: -0.46, size: 0.8, aim: 6};
// the tracker: in the other hand, on the left (the right when left-handed), its screen this share of the
// view's height (landscape) or width (portrait). On touch screens the thumbstick is down in that corner,
// so it is held higher, clear of the thumb.
const TSPOT = {
  z: -0.3,
  mouse: {ndcX: -0.56, ndcY: -0.5, fill: 0.27},
  touch: {ndcX: -0.6, ndcY: -0.02, fill: 0.27},
  portrait: {ndcX: -0.4, ndcY: -0.08, fill: 0.36},
};
const SCREEN_W = TRACKER_SCREEN.x1 - TRACKER_SCREEN.x0;
const backOut = t => { const c = 1.6, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };

export class ViewModel {
  constructor() {
    this.model = mat4();
    this.lens = [0, 0, 0];               // emitter tip, view space
    this.muzzle = new Float32Array(3);   // emitter tip, world space
    this.muzzleClear = true;             // false when the tip is inside a wall
    this.lagYaw = 0; this.lagPitch = 0; this.roll = 0;
    this.lower = 0; this.retract = 0; this.kick = 0; this.drop = 0; this.flash = 0; this.sweepAim = 0;
    this.wasFiring = false; this.wasSweeping = false;
    this.tModel = mat4();                // the tracker's pose, view space
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

    if (s.hands && s.tracker) this.trackerPose(dt, T, s, cam, lefty, calm);
  }

  /** The tracker in your other hand: see the header. */
  trackerPose(dt, T, s, cam, lefty, calm) {
    const p = s.player, h = s.hands, tr = s.tracker, portrait = cam.aspect < 1;
    const P = portrait ? TSPOT.portrait : s.touch ? TSPOT.touch : TSPOT.mouse;
    const th = Math.tan(cam.vfov / 2), zz = TSPOT.z;
    const bx = P.ndcX * th * cam.aspect * -zz, by = P.ndcY * th * -zz;
    const size = P.fill * 2 * th * -zz * (portrait ? cam.aspect : 1) / SCREEN_W;
    // up: eased in with a little overshoot; a dead one only lifts a little when you try it
    const up = Math.max(h.trk > 0 ? backOut(h.trk) : 0, Math.sin(h.peek * Math.PI) * 0.3), down = 1 - up;
    const m = p.moveAmt, b = p.bob + 1.4;
    const shake = (tr.flood * 0.005 + (tr.on && tr.battery < TRACKER.lowAt ? 0.001 : 0)) * calm;
    const jx = (Math.random() - 0.5) * shake, jy = (Math.random() - 0.5) * shake;
    let x = bx + Math.cos(b) * 0.008 * m * calm + jx - 0.05 * down - 0.4 * this.lagYaw * -zz;
    let y = by - Math.abs(Math.sin(b)) * 0.01 * m * calm + Math.sin(T * 1.2 + 1) * 0.002 * calm + jy
      - 0.3 * down - 0.5 * this.drop + 0.004 * tr.glow * calm + 0.01 * p.crouchT;
    const z = zz + 0.003 * tr.glow;
    // facing you straight on wherever it sits, tipped back a touch as if held up to read
    let yaw = Math.atan2(-bx, -zz) + 0.5 * this.lagYaw - 0.25 * down;
    let pitch = Math.atan2(by, -zz) + 0.08 + 0.6 * this.lagPitch - 0.9 * down - 1.0 * this.drop;
    let roll = 0.05 + this.roll * 0.6 + 0.25 * down + 0.6 * this.drop;
    if (lefty) { x = -x; yaw = -yaw; roll = -roll; } // into the other hand; the mesh is symmetric enough
    const M = identity(this.tModel);
    translate(M, x, y, z);
    rotateY(M, yaw); rotateX(M, pitch); rotateZ(M, roll);
    scale(M, size, size, size);
  }

  /** What the tracker renderer needs this frame. */
  trackerDraw(tr, h, T, p) {
    const st = this._ts || (this._ts = {model: this.tModel, a: new Float32Array(4), b: new Float32Array(4), c: new Float32Array(4), k: new Float32Array(24)});
    const dead = tr.battery <= 0;
    st.a[0] = tr.waveT >= 0 ? Math.min(1, tr.waveT / TRACKER.waveTime) : -1;
    st.a[1] = tr.flood;
    st.a[2] = dead ? h.peek : tr.on ? 1 : 0; // a dead one blinks its empty battery only while you try it
    st.a[3] = tr.glow;
    st.b[0] = tr.behindL; st.b[1] = tr.behindR; st.b[2] = tr.battery; st.b[3] = tr.on ? tr.bootT / TRACKER.boot : 1;
    st.c[0] = tr.range / tr.diff.trkRange; st.c[1] = Math.random(); st.c[2] = dead ? 1 : 0; st.c[3] = T % 60;
    tr.pack(T, p, st.k);
    return st;
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
