// Per-frame HUD and touch-pad updates. Each write is skipped when the value has not changed, so the
// DOM is only touched when something visible actually moves.

import {DEG} from '../util/math.js';
import {SCANNER} from '../config.js';

export class Hud {
  constructor($) {
    this.$ = $;
    this.el = {
      hud: $('hud'), cores: $('cores'), sig: $('sig'), sigLab: $('sig-lab'), sigNote: $('sig-note'), heat: $('heat'), heatFill: $('heat').firstElementChild,
      swp: $('swp'), staminaRow: $('stamina-row'), stamina: $('stamina').firstElementChild, hiddenRow: $('hidden-row'),
      fire: $('fire'), fireFill: $('firefill'), fireHeat: $('fireheat'), fireLab: $('firelab'),
      sweep: $('sweep'), sweepFill: $('sweepfill'), sweepLab: $('sweeplab'), crouch: $('crouch'),
      trkRow: $('trk-row'), trk: $('trk'), trkFill: $('trk').firstElementChild, trkNote: $('trk-note'),
      track: $('track'), trackFill: $('trackfill'), trackLab: $('tracklab'),
      stoneRow: $('stone-row'), stones: $('stones'), throwPad: $('throw'), throwCount: $('throwcount'),
      lungRow: $('lung-row'), lungs: $('lungs'), lungsFill: $('lungs').firstElementChild, breathPad: $('breath'), breathFill: $('breathfill'),
      reticle: $('reticle'), vignette: $('vignette'), blackout: $('blackout'),
    };
    this.sigEls = [...this.el.sig.children];
    this.cache = new Map();
    this.classes = new Map();
  }

  set(key, el, prop, value) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    if (prop === 'text') el.textContent = value;
    else if (prop === 'hidden') el.hidden = value;
    else el.style[prop] = value;
  }

  toggle(el, cls, on) {
    let seen = this.classes.get(el);
    if (!seen) this.classes.set(el, seen = Object.create(null));
    if (seen[cls] === on) return;
    seen[cls] = on;
    el.classList.toggle(cls, on);
  }

  /** Forget what has been written, so the next update writes everything again. */
  reset() { this.cache.clear(); this.classes.clear(); }

  setCores(total) {
    this.el.cores.innerHTML = '<i></i>'.repeat(total);
    this.coreEls = [...this.el.cores.children];
    this.reset();
    this.hadStones = false;
  }

  update(s, cam, view, reduceMotion) {
    const E = this.el, sc = s.scanner, p = s.player, sig = s.signal;
    this.coreEls?.forEach((el, i) => this.toggle(el, 'on', i < s.coresGot));

    // signal
    const lit = sig.bars;
    this.sigEls.forEach((el, i) => this.toggle(el, 'on', i < lit));
    this.toggle(E.sig, 'exit', sig.exit);
    this.toggle(E.sig, 'static', sig.static);
    this.toggle(E.sig, 'idle', !sig.reading && !sig.static);
    this.toggle(E.sigLab, 'static', sig.static);
    this.toggle(E.sigNote, 'static', sig.static);
    this.set('signote', E.sigNote, 'text', sig.static ? 'static' : sig.reading ? '' : 'stand still');

    // heat
    const heat = Math.round(sc.heat * 40) / 40;
    this.set('heat', E.heatFill, 'width', (heat * 100).toFixed(0) + '%');
    this.toggle(E.heat, 'warm', heat > 0.55 && heat <= 0.8);
    this.toggle(E.heat, 'hot', heat > 0.8 || sc.overheated);

    // sweep
    const cd = sc.cooldown, lab = cd > 0 ? Math.ceil(cd) + 's' : 'Ready';
    this.set('swp', E.swp, 'text', lab);
    this.toggle(E.swp, 'cool', cd > 0);
    this.set('sweeplab', E.sweepLab, 'text', cd > 0 ? String(Math.ceil(cd)) : 'SWEEP');
    this.toggle(E.sweep, 'cool', cd > 0);
    this.set('sweepfill', E.sweepFill, 'strokeDashoffset', (182.2 * cd / SCANNER.sweepCooldown).toFixed(1));

    // the motion tracker: nothing to show until you have one; its pad's ring is the battery
    const tr = s.tracker, has = !!(tr && tr.owned);
    this.set('trkrow', E.trkRow, 'hidden', !has);
    this.set('trkpad', E.track, 'hidden', !has);
    if (has) {
      const b = Math.round(tr.battery * 40) / 40, low = b < 0.15, dead = b <= 0;
      this.set('trk', E.trkFill, 'width', (b * 100).toFixed(0) + '%');
      this.toggle(E.trk, 'low', low);
      this.set('trknote', E.trkNote, 'text', dead ? 'dead' : low ? 'low' : tr.on ? 'on' : '');
      this.toggle(E.trkNote, 'on', tr.on && !low);
      this.toggle(E.trkNote, 'low', low);
      this.set('trackfill', E.trackFill, 'strokeDashoffset', (157.1 * (1 - b)).toFixed(1));
      this.toggle(E.track, 'on', s.hands.want === 'tracker');
      this.toggle(E.track, 'low', low && !dead);
      this.toggle(E.track, 'dead', dead);
      this.set('tracklab', E.trackLab, 'text', dead ? 'DEAD' : low ? 'LOW' : 'TRACK');
    }

    // stones: nothing to show until you have held one
    const stones = s.stones;
    if (stones > 0) this.hadStones = true;
    const showStones = Number.isFinite(stones) && this.hadStones;
    this.set('stonerow', E.stoneRow, 'hidden', !showStones);
    this.set('throwpad', E.throwPad, 'hidden', !showStones);
    if (showStones) {
      this.set('stones', E.stones, 'text', String(stones));
      this.set('throwcount', E.throwCount, 'text', String(stones));
      this.toggle(E.stones, 'none', stones <= 0);
      this.toggle(E.throwPad, 'none', stones <= 0);
    }

    // held breath: its meter only shows while you are holding it or getting it back
    const hasLungs = Number.isFinite(s.lungs), lungs = hasLungs ? Math.round(Math.min(1, Math.max(0, s.lungs)) * 40) / 40 : 1;
    this.set('breathpad', E.breathPad, 'hidden', !hasLungs);
    this.set('lungrow', E.lungRow, 'hidden', !hasLungs || !(s.holdingBreath || lungs < 1));
    if (hasLungs) {
      const low = lungs < 0.25;
      this.set('lungs', E.lungsFill, 'width', (lungs * 100).toFixed(0) + '%');
      this.toggle(E.lungs, 'low', low);
      this.set('breathfill', E.breathFill, 'strokeDashoffset', (157.1 * (1 - lungs)).toFixed(1));
      this.toggle(E.breathPad, 'on', !!s.holdingBreath);
      this.toggle(E.breathPad, 'low', low);
    }

    // stamina and hiding
    this.set('starow', E.staminaRow, 'hidden', p.stamina >= 0.999);
    this.set('sta', E.stamina, 'width', (p.stamina * 100).toFixed(0) + '%');
    this.set('hid', E.hiddenRow, 'hidden', !p.hidden);
    this.toggle(E.crouch, 'on', p.crouched);

    // scan pad and reticle
    const c = sc.charge;
    this.set('ff', E.fireFill, 'strokeDashoffset', (251.3 * (1 - c)).toFixed(1));
    this.set('fh', E.fireHeat, 'strokeDashoffset', (219.9 * (1 - heat)).toFixed(1));
    this.toggle(E.fire, 'held', sc.firing);
    this.toggle(E.fire, 'hot', heat > 0.8);
    this.toggle(E.fire, 'over', sc.overheated);
    this.set('firelab', E.fireLab, 'text', sc.overheated ? 'HOT' : 'SCAN');
    const cone = Math.tan((10 + 14 * c) * DEG) / Math.tan(cam.vfov / 2) * view.h;
    this.set('ret', E.reticle, 'width', cone.toFixed(0) + 'px');
    this.set('reth', E.reticle, 'height', cone.toFixed(0) + 'px');
    this.toggle(E.reticle, 'hot', sc.overheated);


    // red edges when it is close, and a flash of red when its sonar washes over you
    const fear = Math.max(s.fearNow || 0, (s.fx.ping || 0) * 1.1);
    this.set('vig', E.vignette, 'opacity', (Math.round(Math.min(1, fear) * 20) / 20 * 0.9).toFixed(2));
    this.set('black', E.blackout, 'opacity', String(s.fx.black));
  }
}
