// Touch, mouse, keyboard and controller turned into one per-frame intent. Gameplay reads `frame()` and
// never sees raw events. On touch screens every pointer lands on the stage and is assigned a role by
// where it starts: the thumbstick side, the scan button (hold and drag to aim), sweep, crouch, the motion
// tracker, throw, hold breath, or look. A controller is polled by `pollPad()` once a frame, and while no
// level is in play it drives the menus through `onMenu`.
// With a mouse the first click only captures the pointer (scanning makes noise, so a stray click must
// not fire). Where the page cannot capture the pointer (some embedded viewers), dragging looks and
// Space scans instead.

import {clamp} from '../util/math.js';
import {GamepadReader, DEAD_MOVE, lookRates, radial} from './gamepad.js';

const STICK_R = 52;      // px of travel for full speed
const SPRINT_R = 1.35;   // drag this far past the ring to sprint
const PADS = ['fire', 'sweep', 'crouch', 'track', 'throwStone', 'breath'];
const ARROWS = {ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right'};

export class Input {
  constructor(stage, canvas, els, settings) {
    this.stage = stage; this.canvas = canvas; this.els = els; this.settings = settings;
    this.enabled = false;
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.keys = Object.create(null);
    this.ptrs = new Map();
    this.fireCount = 0; this.breathCount = 0;
    this.btns = 0; this.mouseFire = false;
    this.stickId = null; this.stickX = 0; this.stickY = 0; this.stickFar = false;
    this.lookX = 0; this.lookY = 0;
    this.edges = {sweep: false, crouch: false, track: false, throwStone: false};
    this.onPause = null;          // called with 'key' (Esc/P) or 'lock' (pointer lock lost)
    this.onTouchMode = null;      // called the first time a touch arrives on a mouse device
    this.onMouseMode = null;      // called when pointer capture turns out to be unavailable
    this.onMenu = null;           // up/down/left/right (pad, arrow keys), accept/back/start (pad)
    this.onMute = null;           // M, which works whatever else is going on (pointer lock hides the button)
    this.onPadChange = null;      // called when the controller starts or stops being what you are using
    this.gamepad = new GamepadReader();
    this.padActive = false; this.padEnabled = false; this.padSprint = false;
    this.noLock = !canvas.requestPointerLock;
    this.unlockedAt = -1e9; this.lockFails = 0;
    this.out = {moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false, track: false, throwStone: false, holdBreath: false};
    this.bind();
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  bind() {
    const st = this.stage;
    addEventListener('keydown', e => this.key(e, true));
    addEventListener('keyup', e => this.key(e, false));
    st.addEventListener('pointerdown', e => this.down(e));
    st.addEventListener('pointermove', e => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      st.addEventListener(ev, e => { if (e.pointerType === 'mouse') this.chord(e); this.release(e.pointerId); });
    }
    st.addEventListener('contextmenu', e => e.preventDefault());
    st.addEventListener('touchmove', e => { if (this.enabled) e.preventDefault(); }, {passive: false});
    document.addEventListener('pointerlockchange', () => {
      if (this.locked) { this.lockFails = 0; return; }
      this.unlockedAt = performance.now();
      if (this.enabled && this.onPause) this.onPause('lock');
    });
    // refused twice, well clear of the browser's short re-lock cooldown: this page cannot capture it
    document.addEventListener('pointerlockerror', () => {
      if (this.noLock || performance.now() - this.unlockedAt < 1500 || ++this.lockFails < 2) return;
      this.noLock = true;
      this.onMouseMode?.();
    });
    // alt-tab and the like: keys released elsewhere never send keyup, so let go of everything
    addEventListener('blur', () => this.releaseAll());
  }

  /** Capture the mouse for looking. Only works inside a click or key press; harmless otherwise. */
  grab() {
    if (this.touch || this.noLock || this.locked) return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    try { const r = this.canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* reported by pointerlockerror */ }
  }

  key(e, down) {
    if (down) this.setPad(false);
    if (down && !this.enabled && ARROWS[e.code] && this.onMenu) { e.preventDefault(); this.onMenu(ARROWS[e.code]); return; }
    if (down && e.repeat) { if (this.enabled && e.code === 'Space') e.preventDefault(); return; }
    this.keys[e.code] = down;
    if (!down) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { this.onPause?.('key'); return; }
    if (e.code === 'KeyM') { this.onMute?.(); return; }
    if (!this.enabled) return;
    if (e.code === 'KeyF' || e.code === 'KeyE') this.edges.sweep = true;
    // not Ctrl: Ctrl+W closes the browser tab and no page can stop it
    if (e.code === 'KeyC') this.edges.crouch = true;
    if (e.code === 'KeyQ') this.edges.track = true;
    if (e.code === 'KeyG') this.edges.throwStone = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  }

  /**
   * The touch pad under (x, y), or null. Each pad answers a little beyond its drawn edge, and where two
   * of those margins meet the nearer pad wins, so a thumb on the edge of SCAN never fires the sweep.
   */
  padAt(x, y) {
    let best = null, bd = 0.72;
    for (const name of PADS) {
      const el = this.els[name];
      if (!el || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (!r.width) continue;
      const d = Math.hypot(x - r.left - r.width / 2, y - r.top - r.height / 2) / r.width;
      if (d < bd) { bd = d; best = name; }
    }
    return best;
  }

  down(e) {
    this.setPad(false);
    if (!this.enabled || e.target.closest('button')) return;
    e.preventDefault();
    try { this.stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    let role = 'look';
    if (e.pointerType === 'mouse') {
      this.useMouse();
      // the click that captures the mouse does nothing else
      if (!this.locked && !this.noLock) { this.btns = e.buttons; this.grab(); return; }
      this.chord(e); // without capture, left-drag looks
    } else {
      if (!this.touch) { this.touch = true; this.onTouchMode?.(true); }
      const s = this.stage.getBoundingClientRect(), x = e.clientX, y = e.clientY;
      const leftHanded = this.settings.swap;
      const inStickZone = leftHanded ? x - s.left > s.width * 0.55 : x - s.left < s.width * 0.45;
      const pad = this.padAt(x, y);
      if (pad === 'sweep') this.edges.sweep = true;
      else if (pad === 'crouch') this.edges.crouch = true;
      else if (pad === 'track') this.edges.track = true;
      else if (pad === 'throwStone') this.edges.throwStone = true;
      else if (pad === 'breath') { role = 'breath'; this.breathCount++; } // hold, and drag to look meanwhile
      else if (pad === 'fire') { role = 'fire'; this.fireCount++; }
      else if (inStickZone && this.stickId === null) {
        role = 'stick'; this.stickId = e.pointerId;
        const st = this.els.stick;
        st.style.left = (x - s.left) + 'px'; st.style.top = (y - s.top) + 'px';
        st.firstElementChild.style.transform = ''; st.hidden = false; st.classList.remove('far');
      }
    }
    this.ptrs.set(e.pointerId, {role, x: e.clientX, y: e.clientY, ox: e.clientX, oy: e.clientY});
  }

  move(e) {
    if (!this.enabled) return;
    if (e.pointerType === 'mouse') {
      if (e.movementX || e.movementY) this.useMouse();
      this.chord(e);
      if (this.locked) { this.look(e.movementX || 0, e.movementY || 0, 0.0024); return; }
    }
    const p = this.ptrs.get(e.pointerId);
    if (!p) return;
    if (p.role === 'stick') {
      let dx = e.clientX - p.ox, dy = e.clientY - p.oy;
      const d = Math.hypot(dx, dy);
      this.stickFar = d > STICK_R * SPRINT_R;
      if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
      this.stickX = dx / STICK_R; this.stickY = dy / STICK_R;
      const st = this.els.stick;
      st.firstElementChild.style.transform = 'translate(' + dx.toFixed(1) + 'px,' + dy.toFixed(1) + 'px)';
      st.classList.toggle('far', this.stickFar);
    } else {
      this.look(e.clientX - p.x, e.clientY - p.y, e.pointerType === 'mouse' ? 0.0035 : 0.0052);
    }
    p.x = e.clientX; p.y = e.clientY;
  }

  /** The controls follow whichever pointer you touched last: one tap on a laptop's screen must not lose the mouse. */
  useMouse() { if (this.touch) { this.touch = false; this.onTouchMode?.(false); } }

  /**
   * The mouse's buttons, worked out by difference. A browser sends pointerdown only for the first button
   * held and pointerup only for the last, so a right click during a scan, or letting go of the left one
   * with the right still down, only ever shows up in `buttons`.
   */
  chord(e) {
    const now = e.buttons || 0, pressed = now & ~this.btns;
    this.btns = now;
    if (!(now & 1)) this.mouseFire = false;
    if (!this.enabled || (!this.locked && !this.noLock)) return; // that press was the one that captures the mouse
    if (pressed & 1 && !this.noLock) this.mouseFire = true;
    if (pressed & 2) this.edges.sweep = true;
    if (pressed & 4) this.edges.track = true; // middle click: the tracker
  }

  look(dx, dy, k) {
    const s = this.settings.lookSpeed * k;
    this.lookX += dx * s;
    this.lookY += dy * s * (this.settings.invertY ? -1 : 1);
  }

  release(id) {
    const p = this.ptrs.get(id);
    if (!p) return;
    this.ptrs.delete(id);
    if (p.role === 'fire') this.fireCount = Math.max(0, this.fireCount - 1);
    if (p.role === 'breath') this.breathCount = Math.max(0, this.breathCount - 1);
    if (p.role === 'stick') {
      this.stickId = null; this.stickX = this.stickY = 0; this.stickFar = false;
      this.els.stick.hidden = true;
    }
  }

  /** Drop every held pointer and key, e.g. when pausing or when the app goes to the background. */
  releaseAll() {
    for (const id of [...this.ptrs.keys()]) this.release(id);
    this.fireCount = 0; this.breathCount = 0; this.padSprint = false; this.mouseFire = false; this.btns = 0;
    for (const k in this.keys) this.keys[k] = false;
    this.lookX = this.lookY = 0;
    this.edges.sweep = this.edges.crouch = this.edges.track = this.edges.throwStone = false;
  }

  exitLock() { if (this.locked) document.exitPointerLock(); }

  /** Whether the controller is what you are using: hints follow it, touch pads step aside for it. */
  setPad(on) {
    if (this.padActive === on) return;
    this.padActive = on;
    this.stage.classList.toggle('gamepad', on);
    this.onPadChange?.();
  }

  /** Read the controller. Runs every frame, whether or not a level is in play. */
  pollPad(dt) {
    const g = this.gamepad;
    g.poll(dt);
    if (this.padActive && !g.connected) { // unplugged, or its battery died, in the middle of something
      this.setPad(false);
      if (this.enabled) this.onPause?.('pad');
    }
    if (!g.connected) return;
    if (this.enabled !== this.padEnabled) { this.padEnabled = this.enabled; g.blockHeld(); }
    if (g.touched && !this.padActive) {
      this.setPad(true);
      if (!this.enabled) { g.blockHeld(); return; } // the press that wakes a menu only shows where the focus is
    }
    if (!this.enabled) {
      const dir = g.nav(dt);
      if (dir) this.onMenu?.(dir);
      if (g.just('a')) this.onMenu?.('accept');
      if (g.just('b')) this.onMenu?.('back');
      if (g.just('start')) this.onMenu?.('start');
      return;
    }
    if (g.just('start') || g.just('back')) { this.onPause?.('key'); return; }
    const e = this.edges;
    if (g.just('lt') || g.just('x')) e.sweep = true;
    if (g.just('b') || g.just('r3') || g.just('down')) e.crouch = true;
    if (g.just('y') || g.just('up')) e.track = true;
    if (g.just('rb')) e.throwStone = true;
    // clicking the stick starts a sprint that lasts until you stop walking
    if (g.just('l3')) this.padSprint = true;
    else if (Math.hypot(g.lx, g.ly) < 0.3) this.padSprint = false;
  }

  /** The intent for this frame. Edge-triggered fields and look deltas reset after each call. */
  frame(dt) {
    const k = this.keys, o = this.out, g = this.gamepad, pad = this.enabled && g.connected;
    let my = -this.stickY, mx = this.stickX;
    if (pad) {
      const [px, py] = radial(g.lx, g.ly, DEAD_MOVE);
      mx += px; my -= py;
      const [yaw, pitch] = lookRates(g.rx, g.ry, g.pinned);
      if (yaw || pitch) this.look(yaw * dt, pitch * dt, 1); // the same way the mouse looks: same speed setting, same invert
    }
    if (k.KeyW || k.ArrowUp) my += 1;
    if (k.KeyS || k.ArrowDown) my -= 1;
    if (k.KeyD) mx += 1;
    if (k.KeyA) mx -= 1;
    if (k.ArrowLeft) this.lookX -= 1.9 * dt;
    if (k.ArrowRight) this.lookX += 1.9 * dt;
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }
    o.moveX = mx; o.moveY = my;
    o.sprint = !!(k.ShiftLeft || k.ShiftRight) || this.stickFar || (pad && (g.held('a') || this.padSprint));
    o.lookX = this.lookX; o.lookY = this.lookY; this.lookX = this.lookY = 0;
    o.firing = this.fireCount > 0 || this.mouseFire || !!k.Space || (pad && g.held('rt'));
    o.holdBreath = this.breathCount > 0 || !!k.KeyB || (pad && g.held('lb'));
    o.sweep = this.edges.sweep; o.crouch = this.edges.crouch; o.track = this.edges.track; o.throwStone = this.edges.throwStone;
    this.edges.sweep = this.edges.crouch = this.edges.track = this.edges.throwStone = false;
    o.lookY = clamp(o.lookY, -1, 1);
    return o;
  }
}
