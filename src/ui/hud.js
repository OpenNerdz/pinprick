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
      reticle: $('reticle'), vignette: $('vignette'), blackout: $('blackout'),
    };
    this.sigEls = [...this.el.sig.children];
    this.cache = new Map();
  }

  set(key, el, prop, value) {
    if (this.cache.get(key) === value) return;
    this.cache.set(key, value);
    if (prop === 'text') el.textContent = value;
    else if (prop === 'hidden') el.hidden = value;
    else el.style[prop] = value;
  }

  toggle(key, el, cls, on) {
    const k = key + '.' + cls;
    if (this.cache.get(k) === on) return;
    this.cache.set(k, on);
    el.classList.toggle(cls, on);
  }

  setCores(total) {
    this.el.cores.innerHTML = '<i></i>'.repeat(total);
    this.coreEls = [...this.el.cores.children];
    this.cache.clear();
  }

  update(s, cam, view, reduceMotion) {
    const E = this.el, sc = s.scanner, p = s.player, sig = s.signal;
    this.coreEls?.forEach((el, i) => this.toggle('core' + i, el, 'on', i < s.coresGot));

    // signal
    const lit = sig.bars;
    this.sigEls.forEach((el, i) => this.toggle('sig' + i, el, 'on', i < lit));
    this.toggle('sig', E.sig, 'exit', sig.exit);
    this.toggle('sig', E.sig, 'static', sig.static);
    this.toggle('sig', E.sig, 'idle', !sig.reading && !sig.static);
    this.toggle('siglab', E.sigLab, 'static', sig.static);
    this.toggle('signote', E.sigNote, 'static', sig.static);
    this.set('signote', E.sigNote, 'text', sig.static ? 'static' : sig.reading ? '' : 'stand still');

    // heat
    const heat = Math.round(sc.heat * 40) / 40;
    this.set('heat', E.heatFill, 'width', (heat * 100).toFixed(0) + '%');
    this.toggle('heat', E.heat, 'warm', heat > 0.55 && heat <= 0.8);
    this.toggle('heat', E.heat, 'hot', heat > 0.8 || sc.overheated);

    // sweep
    const cd = sc.cooldown, lab = cd > 0 ? Math.ceil(cd) + 's' : 'Ready';
    this.set('swp', E.swp, 'text', lab);
    this.toggle('swp', E.swp, 'cool', cd > 0);
    this.set('sweeplab', E.sweepLab, 'text', cd > 0 ? String(Math.ceil(cd)) : 'SWEEP');
    this.toggle('sweep', E.sweep, 'cool', cd > 0);
    this.set('sweepfill', E.sweepFill, 'strokeDashoffset', (182.2 * cd / SCANNER.sweepCooldown).toFixed(1));

    // stamina and hiding
    this.set('starow', E.staminaRow, 'hidden', p.stamina >= 0.999);
    this.set('sta', E.stamina, 'width', (p.stamina * 100).toFixed(0) + '%');
    this.set('hid', E.hiddenRow, 'hidden', !p.hidden);
    this.toggle('crouch', E.crouch, 'on', p.crouched);

    // scan pad and reticle
    const c = sc.charge;
    this.set('ff', E.fireFill, 'strokeDashoffset', (251.3 * (1 - c)).toFixed(1));
    this.set('fh', E.fireHeat, 'strokeDashoffset', (219.9 * (1 - heat)).toFixed(1));
    this.toggle('fire', E.fire, 'held', sc.firing);
    this.toggle('fire', E.fire, 'hot', heat > 0.8);
    this.toggle('fire', E.fire, 'over', sc.overheated);
    this.set('firelab', E.fireLab, 'text', sc.overheated ? 'HOT' : 'SCAN');
    const cone = Math.tan((10 + 14 * c) * DEG) / Math.tan(cam.vfov / 2) * view.h;
    this.set('ret', E.reticle, 'width', cone.toFixed(0) + 'px');
    this.set('reth', E.reticle, 'height', cone.toFixed(0) + 'px');
    this.toggle('ret', E.reticle, 'hot', sc.overheated);


    // red edges when it is close, and a flash of red when its sonar washes over you
    const fear = Math.max(s.fearNow || 0, (s.fx.ping || 0) * 1.1);
    this.set('vig', E.vignette, 'opacity', (Math.round(Math.min(1, fear) * 20) / 20 * 0.9).toFixed(2));
    this.set('black', E.blackout, 'opacity', String(s.fx.black));
  }
}
