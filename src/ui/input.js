// Touch, mouse and keyboard turned into one per-frame intent. Gameplay reads `frame()` and never
// sees raw events. On touch screens every pointer lands on the stage and is assigned a role by where
// it starts: the thumbstick side, the scan button (hold and drag to aim), sweep, crouch, the motion
// tracker, or look.
// With a mouse the first click only captures the pointer (scanning makes noise, so a stray click must
// not fire). Where the page cannot capture the pointer (some embedded viewers), dragging looks and
// Space scans instead.

import {clamp} from '../util/math.js';

const STICK_R = 52;      // px of travel for full speed
const SPRINT_R = 1.35;   // drag this far past the ring to sprint

export class Input {
  constructor(stage, canvas, els, settings) {
    this.stage = stage; this.canvas = canvas; this.els = els; this.settings = settings;
    this.enabled = false;
    this.touch = matchMedia('(pointer: coarse)').matches;
    this.keys = Object.create(null);
    this.ptrs = new Map();
    this.fireCount = 0;
    this.stickId = null; this.stickX = 0; this.stickY = 0; this.stickFar = false;
    this.lookX = 0; this.lookY = 0;
    this.edges = {sweep: false, crouch: false, track: false};
    this.onPause = null;          // called with 'key' (Esc/P) or 'lock' (pointer lock lost)
    this.onTouchMode = null;      // called the first time a touch arrives on a mouse device
    this.onMouseMode = null;      // called when pointer capture turns out to be unavailable
    this.noLock = !canvas.requestPointerLock;
    this.unlockedAt = -1e9; this.lockFails = 0;
    this.out = {moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false, track: false};
    this.bind();
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  bind() {
    const st = this.stage;
    addEventListener('keydown', e => this.key(e, true));
    addEventListener('keyup', e => this.key(e, false));
    st.addEventListener('pointerdown', e => this.down(e));
    st.addEventListener('pointermove', e => this.move(e));
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) st.addEventListener(ev, e => this.release(e.pointerId));
    st.addEventListener('contextmenu', e => e.preventDefault());
    st.addEventListener('touchmove', e => { if (this.enabled) e.preventDefault(); }, {passive: false});
    document.addEventListener('pointerlockchange', () => {
      if (this.locked) { this.lockFails = 0; return; }
      this.unlockedAt = performance.now();
      if (this.enabled && !this.touch && this.onPause) this.onPause('lock');
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
    if (down && e.repeat) { if (this.enabled && e.code === 'Space') e.preventDefault(); return; }
    this.keys[e.code] = down;
    if (!down) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { this.onPause?.('key'); return; }
    if (!this.enabled) return;
    if (e.code === 'KeyF' || e.code === 'KeyE') this.edges.sweep = true;
    // not Ctrl: Ctrl+W closes the browser tab and no page can stop it
    if (e.code === 'KeyC') this.edges.crouch = true;
    if (e.code === 'KeyQ') this.edges.track = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  }

  /**
   * The touch pad under (x, y), or null. Each pad answers a little beyond its drawn edge, and where two
   * of those margins meet the nearer pad wins, so a thumb on the edge of SCAN never fires the sweep.
   */
  padAt(x, y) {
    let best = null, bd = 0.72;
    for (const name of ['fire', 'sweep', 'crouch', 'track']) {
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
    if (!this.enabled || e.target.closest('button')) return;
    e.preventDefault();
    try { this.stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    let role = 'look';
    if (e.pointerType === 'mouse') {
      // the click that captures the mouse does nothing else
      if (!this.locked && !this.noLock) { this.grab(); return; }
      if (e.button === 2) this.edges.sweep = true;
      else if (e.button === 1) this.edges.track = true; // middle click: the tracker
      else if (!this.noLock) { role = 'fire'; this.fireCount++; } // without capture, left-drag looks
    } else {
      if (!this.touch) { this.touch = true; this.onTouchMode?.(); }
      const s = this.stage.getBoundingClientRect(), x = e.clientX, y = e.clientY;
      const leftHanded = this.settings.swap;
      const inStickZone = leftHanded ? x - s.left > s.width * 0.55 : x - s.left < s.width * 0.45;
      const pad = this.padAt(x, y);
      if (pad === 'sweep') this.edges.sweep = true;
      else if (pad === 'crouch') this.edges.crouch = true;
      else if (pad === 'track') this.edges.track = true;
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
    if (e.pointerType === 'mouse' && this.locked) { this.look(e.movementX || 0, e.movementY || 0, 0.0024); return; }
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
    if (p.role === 'stick') {
      this.stickId = null; this.stickX = this.stickY = 0; this.stickFar = false;
      this.els.stick.hidden = true;
    }
  }

  /** Drop every held pointer and key, e.g. when pausing or when the app goes to the background. */
  releaseAll() {
    for (const id of [...this.ptrs.keys()]) this.release(id);
    this.fireCount = 0;
    for (const k in this.keys) this.keys[k] = false;
    this.lookX = this.lookY = 0;
    this.edges.sweep = this.edges.crouch = this.edges.track = false;
  }

  exitLock() { if (this.locked) document.exitPointerLock(); }

  /** The intent for this frame. Edge-triggered fields and look deltas reset after each call. */
  frame(dt) {
    const k = this.keys, o = this.out;
    let my = -this.stickY, mx = this.stickX;
    if (k.KeyW || k.ArrowUp) my += 1;
    if (k.KeyS || k.ArrowDown) my -= 1;
    if (k.KeyD) mx += 1;
    if (k.KeyA) mx -= 1;
    if (k.ArrowLeft) this.lookX -= 1.9 * dt;
    if (k.ArrowRight) this.lookX += 1.9 * dt;
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }
    o.moveX = mx; o.moveY = my;
    o.sprint = !!(k.ShiftLeft || k.ShiftRight) || this.stickFar;
    o.lookX = this.lookX; o.lookY = this.lookY; this.lookX = this.lookY = 0;
    o.firing = this.fireCount > 0 || !!k.Space;
    o.sweep = this.edges.sweep; o.crouch = this.edges.crouch; o.track = this.edges.track;
    this.edges.sweep = this.edges.crouch = this.edges.track = false;
    o.lookY = clamp(o.lookY, -1, 1);
    return o;
  }
}
