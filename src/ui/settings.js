// Player settings and progress, persisted per device. The settings form edits the live object;
// `apply` pushes changes into the systems that care (sound, input, haptics, layout).

import {load, save} from '../util/storage.js';

export const DEFAULTS = {
  lookSpeed: 1, invertY: false, volume: 0.8, muted: false, swap: false, haptics: true, saver: false,
  difficulty: 'normal',
};

export const settings = load('settings', DEFAULTS);
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
  };
  const change = () => {
    settings.lookSpeed = +look.value; settings.volume = +vol.value;
    settings.invertY = $('set-invert').checked; settings.swap = $('set-swap').checked;
    settings.haptics = $('set-haptics').checked; settings.saver = $('set-saver').checked;
    sync(); saveSettings(); apply();
  };
  for (const id of ['set-look', 'set-volume']) $(id).addEventListener('input', change);
  for (const id of ['set-invert', 'set-swap', 'set-haptics', 'set-saver']) $(id).addEventListener('change', change);
  sync();
  return sync;
}
