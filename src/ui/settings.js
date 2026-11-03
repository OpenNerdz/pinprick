// Player settings and progress, persisted per device. The settings form edits the live object;
// `apply` pushes changes into the systems that care (sound, input, haptics, layout).

import {load, save} from '../util/storage.js';
import {DIFFICULTY} from '../config.js';

export const DEFAULTS = {
  lookSpeed: 1, invertY: false, volume: 0.8, muted: false, swap: false, haptics: true, saver: false,
  captions: false, reduceMotion: false,
  quality: null, // 'high' or 'low' once chosen; until then the renderer decides
  difficulty: 'normal',
};

/** Stored values from an older build or a hand-edited browser must not be able to break the game. */
export function sanitize(s) {
  const num = (v, lo, hi, d) => (Number.isFinite(+v) && v !== null && v !== '' ? Math.min(hi, Math.max(lo, +v)) : d);
  s.lookSpeed = num(s.lookSpeed, 0.4, 2.2, DEFAULTS.lookSpeed);
  s.volume = num(s.volume, 0, 1, DEFAULTS.volume);
  for (const k of ['invertY', 'muted', 'swap', 'haptics', 'saver', 'captions', 'reduceMotion']) s[k] = !!s[k];
  if (s.quality !== 'high' && s.quality !== 'low') s.quality = null;
  if (!Object.hasOwn(DIFFICULTY, s.difficulty)) s.difficulty = DEFAULTS.difficulty;
  return s;
}

export const settings = sanitize(load('settings', DEFAULTS));
export const progress = load('progress', {cleared: {}, best: {}, notes: {}});

export function saveSettings() { save('settings', settings); }
export function saveProgress() { save('progress', progress); }

export function resetProgress() {
  progress.cleared = {}; progress.best = {}; progress.notes = {};
  saveProgress();
}

/** Wire the settings sheet's inputs to the settings object. */
export function bindSettingsForm($, apply) {
  const look = $('set-look'), vol = $('set-volume');
  const sync = () => {
    look.value = settings.lookSpeed; $('out-look').textContent = settings.lookSpeed.toFixed(1) + '×';
    vol.value = settings.volume; $('out-volume').textContent = Math.round(settings.volume * 100) + '%';
    $('set-invert').checked = settings.invertY;
    $('set-swap').checked = settings.swap;
    $('set-haptics').checked = settings.haptics;
    $('set-saver').checked = settings.saver;
    $('set-captions').checked = settings.captions;
    $('set-motion').checked = settings.reduceMotion;
  };
  const change = () => {
    settings.lookSpeed = +look.value; settings.volume = +vol.value;
    settings.invertY = $('set-invert').checked; settings.swap = $('set-swap').checked;
    settings.haptics = $('set-haptics').checked; settings.saver = $('set-saver').checked;
    settings.captions = $('set-captions').checked; settings.reduceMotion = $('set-motion').checked;
    sync(); saveSettings(); apply();
  };
  for (const id of ['set-look', 'set-volume']) $(id).addEventListener('input', change);
  for (const id of ['set-invert', 'set-swap', 'set-haptics', 'set-saver', 'set-captions', 'set-motion']) $(id).addEventListener('change', change);
  sync();
  return sync;
}
