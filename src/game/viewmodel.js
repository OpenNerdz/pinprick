// How the devices sit in your hands. Every frame it works out the scanner's pose in view space from what
// you are doing, and from that the emitter tip in the world, which is where the scanner's rays start.
//
//   idle: slow breathing drift          walking: bob and sway in step
//   turning: the gun lags behind your view, then catches up
//   strafing: tilts into the turn       sprinting: lowered, turned in and pumping
//   charging: the barrel trembles       sweep: a kick back and up, that rings out
//   overheated: sags, shudders, vents   against a wall: pulled back and raised
//   winded: your arms heave             holding your breath: everything goes still, until your air runs out
//   throwing a stone: your whole body goes with it
//   caught: it falls out of your hands
//
// Almost everything moves on springs, so changes of state have weight instead of a snap, and impulses
// (recoil, the throw) just kick a spring's velocity. They run on numbers the session already keeps.
//
// The motion tracker has its own pose in your other hand, on the other side of the view from the
// scanner: it hauls up from below, the position leading and the tilt following after it, faces you
// (sized to the screen, so it reads on a phone, and on touch screens held higher so the thumb on the
// stick does not cover it), and knocks a little with each pulse. A hand-held tremble grows as whatever
// it found gets close. When the cell gives out you hold it while the tube dies; a dead one lifts a
// little when you try it, the power switch clicks up and falls back, and it drops again.

import {mat4, transformPoint} from '../util/mat4.js';
import {MUZZLE} from '../render/gunmesh.js';
import {TRACKER_SCREEN} from '../render/trackermesh.js';
import {TRACKER, SCANNER, LUNGS} from '../config.js';
import {DYING} from './hands.js';
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
  mouse: {ndcX: -0.58, ndcY: -0.5, fill: 0.25},
  touch: {ndcX: -0.55, ndcY: -0.2, fill: 0.25},
  portrait: {ndcX: -0.36, ndcY: -0.35, fill: 0.33},
};
const SCREEN_W = TRACKER_SCREEN.x1 - TRACKER_SCREEN.x0;
const TOP_OF_TRACKER = 0.09;           // of the drum, above the tracker's origin, in its own metres
const TAU = Math.PI * 2;
const SEG7 = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f], SEG_DASH = 0x40, SEG_ALL = 0x7f;

/** A damped spring on one number. `freq` in Hz; `damp` 1 settles without overshoot, lower rings. */
class Spring {
  constructor(freq, damp, x = 0) { this.w = TAU * freq; this.z = damp; this.x = x; this.v = 0; }
  to(target, dt) {
    const n = dt > 0.018 ? 3 : 1, h = dt / n, w = this.w, z = this.z;
    for (let i = 0; i < n; i++) { this.v += (w * w * (target - this.x) - 2 * z * w * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
  /** Give it a shove that carries it about `peak` away from rest before it comes back. */
  kick(peak) { this.v += peak * this.w * 1.6; }
}

/**
 * M = translate * rotateY * rotateX * rotateZ * scale, written straight in: it runs twice a frame, and
 * the general matrix helpers would make ten closures and five full multiplies to get here.
 */
export function pose(M, x, y, z, yaw, pitch, roll, sx, sy, sz) {
  const cy = Math.cos(yaw), ny = Math.sin(yaw), cp = Math.cos(pitch), np = Math.sin(pitch), cr = Math.cos(roll), nr = Math.sin(roll);
  const a = ny * np, c = cy * np;
  M[0] = (cy * cr + a * nr) * sx; M[1] = cp * nr * sx; M[2] = (c * nr - ny * cr) * sx; M[3] = 0;
  M[4] = (a * cr - cy * nr) * sy; M[5] = cp * cr * sy; M[6] = (ny * nr + c * cr) * sy; M[7] = 0;
  M[8] = ny * cp * sz; M[9] = -np * sz; M[10] = cy * cp * sz; M[11] = 0;
  M[12] = x; M[13] = y; M[14] = z; M[15] = 1;
  return M;
}

/** Smooth noise, -1..1, from a few unrelated sines: a hand's shake rather than a per-frame buzz. */
const wob = (t, s) => (Math.sin(t * 29.3 + s) + 0.7 * Math.sin(t * 47.1 + s * 2.3) + 0.4 * Math.sin(t * 73.7 + s * 3.1)) / 2.1;
const stutter = T => { const v = Math.sin(Math.floor(T * 31) * 12.9898) * 43758.5453; return v - Math.floor(v); };

export class ViewModel {
  constructor() {
    this.model = mat4();
    this.lens = [0, 0, 0];               // emitter tip, view space
    this.muzzle = new Float32Array(3);   // emitter tip, world space
    this.muzzleClear = true;             // false when the tip is inside a wall
    this.lagYaw = 0; this.lagPitch = 0; this.roll = 0;
    this.flash = 0;
    this.wasFiring = false; this.wasSweeping = false; this.wasRecharging = false; this.wasLocked = false;
    this.lefty = false;
    // the scanner's moving parts and its pose
    this.sLower = new Spring(2.3, 0.8); this.sRetract = new Spring(3, 0.92); this.sDrop = new Spring(1.1, 0.9);
    this.sAim = new Spring(3.6, 0.82); this.sKickZ = new Spring(6.5, 0.42); this.sKickP = new Spring(4.2, 0.48);
    this.sOver = new Spring(1.5, 0.5); this.sStill = new Spring(1, 1); this.sThrow = new Spring(2.2, 0.55); this.sHeave = new Spring(1.3, 0.5);
    this.sFins = new Spring(4, 0.38); this.sBlock = new Spring(9, 0.5);
    this.rotor = 0; this.phase = 0; this.ready = 0; this.swayT = 0; this.throwing = false;
    // the tracker
    this.tModel = mat4();                // the tracker's pose, view space
    this.tUp = new Spring(2.9, 0.72); this.tTilt = new Spring(2.2, 0.56);
    this.tToggle = new Spring(14, 0.5, 0.5); this.tDrum = new Spring(11, 0.42); this.drumTo = 0;
    this.tremble = 0;
    this.sincePulse = -1; this.lastWave = -1;
    this.crtOff = 0; this.crtWasOn = false; this.crtWarm = 0; this.crtW = 1; this.crtH = 1; this.crtPower = 0; this.crtCalm = 1;
    this.fins = 0; this.block = 0; this.scannerLight = 0;
    this.bodyStill = 0; this.bodyThrow = 0; this.bodyAir = 0; this.bodyGasp = 0; this.bodyT = 0; this.bodySway = 1; this.bodyDrop = 0;
  }

  /**
   * s: the session (player, scanner, world, state); intent: this frame's input; cam: already placed.
   */
  update(dt, T, s, intent, cam, lefty, reduceMotion) {
    const p = s.player, sc = s.scanner;
    const calm = reduceMotion ? 0.3 : 1;
    this.lefty = lefty;

    // turning: lag behind the view by an amount tied to how fast you turn
    const ty = clamp(intent.lookX / Math.max(dt, 1e-3) * 0.018, -0.14, 0.14) * calm;
    const tp = clamp(intent.lookY / Math.max(dt, 1e-3) * 0.014, -0.1, 0.1) * calm;
    this.lagYaw += (ty - this.lagYaw) * Math.min(1, dt * 8);
    this.lagPitch += (tp - this.lagPitch) * Math.min(1, dt * 8);
    this.roll += (-intent.moveX * 0.09 * calm - this.roll) * Math.min(1, dt * 6);
    const lower = this.sLower.to(p.sprinting ? 1 : 0, dt);
    const drop = this.sDrop.to(s.state === 'caught' ? 1 : 0, dt);
    // during a sweep the barrel tracks the sheet of light from the top of the view to the bottom
    const sweepAim = this.sAim.to(sc.sweeping ? (0.42 - 0.95 * sc.beamY) * (reduceMotion ? 0.5 : 1) : 0, dt);

    // pull back when the barrel would poke into a wall in front of you
    const wall = cast(s.world, cam.ex, cam.ey, cam.ez, cam.fx, cam.fy, cam.fz, 1.2, false) ? hit.t : 1.2;
    const retract = this.sRetract.to(clamp((0.85 - wall) / 0.55, 0, 1), dt);

    // shots: a flash and a little shove when the trigger goes down, a big kick for the sweep
    if (sc.firing && !this.wasFiring) { this.flash = Math.max(this.flash, 0.5); this.sKickZ.kick(0.01 * calm); this.sKickP.kick(0.035 * calm); }
    if (sc.sweeping && !this.wasSweeping) { this.flash = 1; this.sKickZ.kick(0.042 * calm); this.sKickP.kick(0.15 * calm); this.sBlock.v += 1.4; }
    this.wasFiring = sc.firing; this.wasSweeping = sc.sweeping;
    this.flash = Math.max(0, this.flash * Math.exp(-dt * 5) - dt * 0.2);
    // recharged: the block seats itself and the gun takes the knock
    const charging = sc.cooldown > 0;
    if (this.wasRecharging && !charging) { this.ready = 1; this.sKickZ.kick(0.003 * calm); this.sKickP.kick(0.01 * calm); }
    this.wasRecharging = charging;
    this.ready = Math.max(0, this.ready - dt * 1.4);
    const kz = this.sKickZ.to(0, dt), kp = this.sKickP.to(0, dt);

    // your body: a stone thrown, your wind, your breath held and running out
    const throwing = !!intent.throwStone && s.stones > 0;
    if (throwing && !this.throwing) this.sThrow.kick(1 * calm);
    this.throwing = throwing;
    const thr = this.sThrow.to(0, dt);
    const locked = (s.breathLock || 0) > 0;
    if (locked && !this.wasLocked) this.sHeave.kick(0.8 * calm);
    this.wasLocked = locked;
    const gasp = this.sHeave.to(0, dt);
    const still = this.sStill.to(s.holdingBreath ? 1 : 0, dt), wind = p.wind || 0;
    const airLow = s.holdingBreath ? clamp(1 - s.lungs / LUNGS.shaky, 0, 1) : 0;
    this.swayT += dt * (1 + 0.9 * wind);
    const sT = this.swayT, sway = calm * (1 - 0.9 * still) * (1 + 1.3 * wind);
    this.bodyStill = still; this.bodyThrow = thr; this.bodyAir = airLow; this.bodyGasp = gasp; this.bodyT = sT; this.bodySway = sway; this.bodyDrop = drop;

    // moving parts
    const ch = sc.charge;
    this.rotor = (this.rotor + dt * (0.35 + 60 * ch * ch) * (reduceMotion ? 0.5 : 1)) % TAU;
    this.phase = (this.phase + dt * (2.5 + 34 * ch)) % (TAU * 10);
    const fins = !sc.overheated ? (sc.heat > 0.8 ? (sc.heat - 0.8) * 0.9 : 0) : 0.42 + 0.56 * clamp((sc.heat - SCANNER.ventBelow) / 0.5, 0, 1);
    this.fins = this.sFins.to(fins * (reduceMotion ? 0.6 : 1), dt);
    const missing = sc.cooldown > 0 ? sc.cooldown / SCANNER.sweepCooldown : 0;
    this.block = this.sBlock.to(0.0185 * missing, dt);

    const m = p.moveAmt, b = p.bob;
    const heatShudder = sc.overheated ? 0.0028 * clamp(sc.heat / 0.8, 0, 1) : (sc.heat > 0.8 ? 0.0012 * (sc.heat - 0.8) / 0.2 : 0);
    const shake = (0.002 * ch * ch + heatShudder + airLow * 0.0016) * calm;
    const jx = wob(T, 0.3) * shake, jy = wob(T * 1.17, 2.1) * shake;
    // portrait screens: a little further in, so the scan and sweep buttons don't cover it
    const ndcX = cam.aspect < 1 ? 0.3 : SPOT.ndcX, ndcY = cam.aspect < 1 ? -0.56 : SPOT.ndcY;
    const th = Math.tan(cam.vfov / 2), bx = ndcX * th * cam.aspect * -SPOT.z, by = ndcY * th * -SPOT.z;
    const byaw = Math.atan2(bx, SPOT.aim + SPOT.z), bpitch = Math.atan2(-by, SPOT.aim + SPOT.z);
    const over = this.sOver.to(sc.overheated ? (reduceMotion ? 0.5 : 1) : 0, dt);
    const pump = Math.sin(b) * lower * calm;
    let x = bx + Math.cos(b) * 0.011 * m * calm + jx + 0.03 * lower + 0.012 * pump
      + Math.sin(sT * 0.83 + 0.5) * 0.0016 * sway - 0.024 * thr;
    let y = by - Math.abs(Math.sin(b)) * 0.013 * m * calm * (1 - 0.3 * still) + Math.sin(sT * 1.3) * 0.003 * sway + Math.sin(sT * 0.47) * 0.0012 * sway + jy
      + Math.sin(sT * 2.7) * 0.0026 * wind * calm + 0.012 * gasp
      - 0.09 * lower - 0.03 * retract - 0.45 * drop + 0.012 * p.crouchT - 0.002 * still - 0.006 * over - 0.026 * thr;
    let z = SPOT.z + kz + 0.13 * retract - 0.008 * ch - 0.022 * thr;
    let yaw = byaw + this.lagYaw + 0.4 * lower + 0.09 * pump + Math.sin(sT * 0.71 + 2) * 0.004 * sway - 0.16 * thr;
    let pitch = bpitch + sweepAim + this.lagPitch + kp + 0.55 * retract - 0.5 * lower
      - 0.18 * over + Math.sin(sT * 1.1) * 0.006 * sway + Math.sin(sT * 2.7 + 0.6) * 0.005 * wind * calm - 0.1 * gasp - 1.1 * drop - 0.11 * thr;
    let roll = this.roll + this.lagYaw * 0.3 + Math.cos(b) * 0.02 * m * calm + 0.05 * p.crouchT + 0.12 * over + 0.7 * drop
      + Math.sin(sT * 0.59 + 1) * 0.004 * sway + 0.1 * pump + 0.2 * thr;
    if (lefty) { x = -x; yaw = -yaw; roll = -roll; }

    const M = pose(this.model, x, y, z, yaw, pitch, roll, lefty ? -SPOT.size : SPOT.size, SPOT.size, SPOT.size);

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
    const th = Math.tan(cam.vfov / 2), zz = TSPOT.z, reach = -zz;
    const bx = P.ndcX * th * cam.aspect * reach, by = P.ndcY * th * reach;
    const size = P.fill * 2 * th * reach * (portrait ? cam.aspect : 1) / SCREEN_W;
    // how far up: it takes a moment to get going and settles past its mark, the tilt following later
    const t = h.trk, peek = Math.sin(Math.min(1, h.peek) * Math.PI), lift = t * t * (3 - 2 * t);
    const target = Math.max(lift, peek * 0.86);
    const up = this.tUp.to(target, dt), tilt = this.tTilt.to(target, dt);
    const down = 1 - up, tdown = 1 - tilt;
    const sink = th * reach + by + TOP_OF_TRACKER * size + 0.012;   // all the way below the bottom of the view
    const m = p.moveAmt, b = p.bob + 1.4;
    // the tremble: small always, growing with how near what it last found is, and when the air is going
    let close = tr.flood;
    if (tr.blips.length) {
      const R = tr.diff.trkRange;
      for (let i = 0; i < tr.blips.length; i++) {
        const q = tr.blips[i], fresh = 1 - (T - q.t) / tr.diff.trkFade;
        const ex = q.x - p.x, ez = q.z - p.z, c = (1 - Math.sqrt(ex * ex + ez * ez) / R) * clamp(fresh * 1.6, 0, 1);
        if (c > close) close = c;
      }
    }
    this.tremble += (close * close - this.tremble) * Math.min(1, dt * (close * close > this.tremble ? 9 : 2.5));
    const shake = (0.00035 + 0.0052 * this.tremble + (tr.on && tr.battery < TRACKER.lowAt ? 0.0007 : 0) + this.bodyAir * 0.0014) * calm;
    const jx = wob(T, 4.1) * shake, jy = wob(T * 1.21, 5.3) * shake;
    const sT = this.bodyT, sway = this.bodySway, thr = this.bodyThrow, drop = this.bodyDrop, knock = tr.glow * calm;
    let x = bx + Math.cos(b) * 0.008 * m * calm + jx - 0.06 * down - 0.4 * this.lagYaw * reach
      + Math.sin(sT * 0.61 + 1.9) * 0.0022 * sway - 0.012 * thr;
    let y = by - Math.abs(Math.sin(b)) * 0.01 * m * calm + Math.sin(sT * 1.2 + 1) * 0.0028 * sway + jy
      - sink * down - 0.5 * drop + 0.01 * p.crouchT - 0.0007 * knock + 0.008 * this.bodyGasp - 0.002 * this.bodyStill - 0.05 * thr;
    const z = zz + 0.028 * Math.sin(clamp(up, 0, 1) * Math.PI) * calm;   // it swings in on its way up
    // facing you wherever it sits, turned a little off square so you can see how thick it is
    let yaw = Math.atan2(-bx, reach) + 0.1 + 0.5 * this.lagYaw - 0.34 * tdown + Math.sin(sT * 0.53) * 0.006 * sway;
    let pitch = Math.atan2(by, reach) + 0.1 + 0.6 * this.lagPitch - 1.15 * tdown - 1.0 * drop + 0.008 * knock
      + Math.sin(sT * 0.97 + 0.4) * 0.006 * sway + wob(T * 0.8, 1.7) * shake * 2 - 0.42 * thr - 0.06 * this.bodyGasp;
    let roll = -0.04 + this.roll * 0.6 + 0.4 * tdown + 0.6 * drop + wob(T * 0.93, 3.7) * shake * 2.2 + Math.sin(sT * 0.71 + 0.8) * 0.006 * sway;
    if (lefty) { x = -x; yaw = -yaw; roll = -roll; }
    pose(this.tModel, x, y, z, yaw, pitch, roll, lefty ? -size : size, size, size);

    // moving parts: the drum ratchets a notch with every pulse; the power switch follows your thumb
    if (tr.waveT >= 0 && (this.lastWave < 0 || tr.waveT < this.lastWave)) { this.sincePulse = 0; this.drumTo += TAU / 8; }
    this.lastWave = tr.waveT;
    if (this.sincePulse >= 0) this.sincePulse = tr.on ? this.sincePulse + dt : -1;
    if (this.drumTo > TAU * 16) { this.drumTo -= TAU * 16; this.tDrum.x -= TAU * 16; }
    this.tDrum.to(this.drumTo, dt);
    this.tToggle.to(h.want === 'tracker' || h.peek > 0.3 ? -0.52 : 0.52, dt);

    // the tube: blooms up from a line when it boots, collapses when it goes off, sags as the cell dies
    const on = tr.on, boot = on ? tr.bootT / TRACKER.boot : 0, hash = calm < 1 ? 1 : stutter(T); // no flicker when asked for calm
    if (!on && this.crtWasOn && h.dying <= 0 && tr.battery > 0) this.crtOff = 1;
    this.crtWasOn = on;
    this.crtOff = on ? 0 : Math.max(0, this.crtOff - dt / 0.17);
    this.crtWarm = on && boot <= 0 ? Math.min(1, this.crtWarm + dt / 0.32) : 0;
    let W = 1, H = 1, pw = 0;
    if (on) {
      if (boot > 0) {
        const b1 = 1 - boot, u = clamp((b1 - 0.24) / 0.76, 0, 1), o = 1 - (1 - u) * (1 - u);
        W = Math.min(1, 0.2 + b1 * 4.5); H = b1 < 0.24 ? 0.012 : Math.max(0.012, o * (1 + 0.06 * Math.sin(u * Math.PI)));
        pw = b1 < 0.24 ? 0.85 : hash > 0.32 ? 0.82 : 0.28;
      } else pw = 1 - (1 - this.crtWarm) * 0.55 * (hash > 0.45 ? 1 : 0.2);
    } else if (this.crtOff > 0) {
      const o = this.crtOff;
      H = Math.max(0.01, o * o * o); W = o > 0.32 ? 1 : Math.max(0.018, o / 0.32); pw = Math.min(1, 0.45 + o);
    } else if (h.dying > 0) {
      const d = h.dying / DYING, sag = 0.2 + 0.8 * d;
      H = Math.max(0.012, Math.min(1, d / 0.55)) * (1 + 0.025 * Math.sin(T * 31));
      W = (d > 0.22 ? 0.9 + 0.1 * d : Math.max(0.018, d / 0.22 * 0.9)) * (1 + 0.02 * Math.sin(T * 23));
      pw = sag * (hash > 0.28 + 0.4 * (1 - d) ? 1 : 0.35) * Math.min(1, d / 0.1);
    }
    this.crtW = W; this.crtH = H; this.crtPower = pw; this.crtCalm = calm < 1 ? 0 : 1;
  }

  /** What the tracker renderer needs this frame. */
  trackerDraw(tr, h, T, p) {
    const st = this._ts || (this._ts = {model: this.tModel, rig: new Float32Array(4), a: new Float32Array(4), b: new Float32Array(4), c: new Float32Array(4), d: new Float32Array(4), e: new Float32Array(4), k: new Float32Array(24), calm: 1});
    const dead = tr.battery <= 0 && h.dying <= 0, lit = this.crtPower;
    st.calm = this.crtCalm;
    st.rig[0] = this.tDrum.x; st.rig[1] = this.tToggle.x; st.rig[2] = 0.46; st.rig[3] = this.lefty ? -1 : 1;
    st.a[0] = this.sincePulse >= 0 ? this.sincePulse / TRACKER.waveTime : -1;
    st.a[1] = tr.flood;
    st.a[2] = lit;
    st.a[3] = tr.glow;
    st.b[0] = tr.behindL; st.b[1] = tr.behindR; st.b[2] = tr.battery;
    st.b[3] = dead ? h.peek : tr.on ? tr.bootT / TRACKER.boot : 0;
    st.c[0] = tr.range / tr.diff.trkRange; st.c[1] = Math.random(); st.c[2] = dead ? 1 : 0; st.c[3] = T % 60;
    st.d[0] = this.crtW; st.d[1] = this.crtH; st.d[3] = this.lefty ? 1 : 0;
    st.d[2] = this.scannerLight;
    tr.pack(T, p, st.k);
    // the range window: the nearest thing still glowing on the tube, in metres; dashes for nothing,
    // all segments while it boots, garbage while the picture is breaking up, dark with no power
    const K = st.k, R = tr.diff.trkRange;
    let near = -1;
    for (let i = 0; i < 24; i += 4) {
      if (K[i + 2] < 0.04) continue;
      const q = Math.sqrt(K[i] * K[i] + K[i + 1] * K[i + 1]) * R;
      if (near < 0 || q < near) near = q;
    }
    const E = st.e;
    if (lit <= 0) { E[0] = E[1] = E[2] = E[3] = 0; return st; }
    E[3] = lit;
    if (st.b[3] > 0) E[0] = E[1] = E[2] = SEG_ALL;
    else if (tr.flood > 0.3) {
      const n = Math.floor(T * 13);
      E[0] = Math.floor(stutter(n * 0.031) * 128); E[1] = Math.floor(stutter(n * 0.047) * 128); E[2] = Math.floor(stutter(n * 0.071) * 128);
    } else if (near < 0) E[0] = E[1] = E[2] = SEG_DASH;
    else {
      const tenths = Math.round(Math.min(99.9, near) * 10);
      E[0] = tenths >= 100 ? SEG7[Math.floor(tenths / 100)] : 0;
      E[1] = SEG7[Math.floor(tenths / 10) % 10];
      E[2] = SEG7[tenths % 10];
    }
    return st;
  }

  /** What the gun renderer needs this frame. */
  drawState(sc, cooldownTotal, T) {
    const st = this._ds || (this._ds = {model: this.model, lens: this.lens, proj: null, charge: 0.5, firing: false, heat: 0.5, over: false, sweep: 0.5, time: 0.5, flash: 0.5, rotor: 0.5, fins: 0.5, block: 0.5, phase: 0.5, beam: 0.5, ready: 0.5, mirrored: false});
    // `firing` only sets the bloom now; going by the charge lets it die away with the coils
    st.charge = sc.charge; st.firing = sc.charge > 0.001; st.heat = sc.heat; st.over = sc.overheated;
    st.sweep = sc.cooldown > 0 ? 1 - sc.cooldown / cooldownTotal : 1;
    st.time = T; st.flash = this.flash;
    st.rotor = this.rotor; st.fins = this.fins; st.block = this.block; st.phase = this.phase;
    st.beam = sc.sweeping ? sc.beamY : -1; st.ready = this.ready; st.mirrored = this.lefty;
    this.scannerLight = Math.min(0.5, 0.45 * sc.charge + 0.5 * this.flash);
    return st;
  }
}
