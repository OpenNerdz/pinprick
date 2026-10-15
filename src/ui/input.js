// Touch, mouse and keyboard turned into one per-frame intent. Gameplay reads `frame()` and never
// sees raw events. On touch screens every pointer lands on the stage and is assigned a role by where
// it starts: the thumbstick side, the scan button (hold and drag to aim), sweep, crouch, or look.

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
    this.edges = {sweep: false, crouch: false};
    this.onPause = null;          // called with 'key' (Esc/P) or 'lock' (pointer lock lost)
    this.onTouchMode = null;      // called the first time a touch arrives on a mouse device
    this.out = {moveX: 0, moveY: 0, sprint: false, lookX: 0, lookY: 0, firing: false, sweep: false, crouch: false};
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
      if (!this.locked && this.enabled && !this.touch && this.onPause) this.onPause('lock');
    });
  }

  key(e, down) {
    if (down && e.repeat) { if (this.enabled && e.code === 'Space') e.preventDefault(); return; }
    this.keys[e.code] = down;
    if (!down) return;
    if (e.code === 'Escape' || e.code === 'KeyP') { this.onPause?.('key'); return; }
    if (!this.enabled) return;
    if (e.code === 'KeyF' || e.code === 'KeyE') this.edges.sweep = true;
    if (e.code === 'KeyC' || e.code === 'ControlLeft') this.edges.crouch = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  }

  hitButton(el, x, y, scale = 0.72) {
    if (!el || el.hidden) return false;
    const r = el.getBoundingClientRect();
    if (!r.width) return false;
    return Math.hypot(x - r.left - r.width / 2, y - r.top - r.height / 2) < r.width * scale;
  }

  down(e) {
    if (!this.enabled || e.target.closest('button')) return;
    e.preventDefault();
    try { this.stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    let role = 'look';
    if (e.pointerType === 'mouse') {
      if (e.button === 2) this.edges.sweep = true; else { role = 'fire'; this.fireCount++; }
      if (!this.locked) {
        try { const r = this.canvas.requestPointerLock?.(); if (r && r.catch) r.catch(() => {}); } catch (err) { /* optional */ }
      }
    } else {
      if (!this.touch) { this.touch = true; this.onTouchMode?.(); }
      const s = this.stage.getBoundingClientRect(), x = e.clientX, y = e.clientY;
      const leftHanded = this.settings.swap;
      const inStickZone = leftHanded ? x - s.left > s.width * 0.55 : x - s.left < s.width * 0.45;
      if (this.hitButton(this.els.sweep, x, y)) this.edges.sweep = true;
      else if (this.hitButton(this.els.crouch, x, y)) this.edges.crouch = true;
      else if (this.hitButton(this.els.fire, x, y)) { role = 'fire'; this.fireCount++; }
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
    this.edges.sweep = this.edges.crouch = false;
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
    o.sweep = this.edges.sweep; o.crouch = this.edges.crouch;
    this.edges.sweep = this.edges.crouch = false;
    o.lookY = clamp(o.lookY, -1, 1);
    return o;
  }
}
