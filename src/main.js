// App shell: screens, the frame loop, and the hand-off between the title demo and a level.
// Everything game-specific lives in game/; this file only routes input, time and UI.

import {Renderer} from './render/renderer.js';
import {buildGunMesh} from './render/gunmesh.js';
import {buildTrackerMesh, TRACKER_SCREEN} from './render/trackermesh.js';
import {Camera} from './render/camera.js';
import {AudioEngine} from './audio/engine.js';
import {Sounds} from './audio/sounds.js';
import {Input} from './ui/input.js';
import {Hud} from './ui/hud.js';
import {settings, progress, saveSettings, saveProgress, resetProgress, bindSettingsForm} from './ui/settings.js';
import {setHaptics} from './ui/haptics.js';
import {Session} from './game/session.js';
import {LEVELS, ATTRACT} from './levels/index.js';
import {DIFFICULTY, DOTS} from './config.js';
import {formatTime} from './util/math.js';

const $ = id => document.getElementById(id);

function boot(hotData) {
  const stage = $('stage'), canvas = $('gl');
  const renderer = new Renderer(canvas);
  if (!renderer.gl) {
    $('note').textContent = 'This browser cannot start WebGL, so the scanner has nothing to draw with.';
    $('go').disabled = true;
    return;
  }
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const engine = new AudioEngine(), sounds = new Sounds(engine);
  const cam = new Camera(), hud = new Hud($);
  const view = {w: 0, h: 0};
  const input = new Input(stage, canvas, {fire: $('fire'), sweep: $('sweep'), crouch: $('crouch'), track: $('track'), stick: $('stick')}, settings);

  let app = 'title';          // title | play | paused | settings | note | caught | won
  let settingsFrom = 'title';
  let session = null, levelIndex = 0, attract = null;
  let clock = 0, last = 0;
  let msgTimer = 0;
  let lockHint = false;

  const sheets = ['title', 'paused', 'settings', 'note-sheet', 'caught', 'won'];
  const playEls = ['hud', 'reticle', 'fire', 'sweep', 'crouch', 'track', 'pause']; // the HUD hides TRACK until you have one
  function show(sheet) {
    for (const id of sheets) $(id).hidden = id !== sheet;
    if (sheet) { clearTimeout(msgTimer); $('msg').classList.remove('on'); }
  }
  function playUi(on) {
    for (const id of playEls) $(id).hidden = !on;
    if (!on) { $('stick').hidden = true; $('lockhint').hidden = true; lockHint = false; $('vignette').style.opacity = 0; $('blackout').style.opacity = 0; }
    if (on) hud.cache.clear();
  }

  /** On-screen message. `text` may be {touch, mouse} when the wording depends on the controls. */
  function say(text, ms) {
    if (text && typeof text === 'object') text = input.touch ? text.touch : text.mouse;
    const m = $('msg');
    m.textContent = text; m.classList.add('on');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => m.classList.remove('on'), ms || 4500);
  }

  // ------------------------------------------------------------ settings
  function applySettings() {
    engine.setVolume(settings.volume);
    engine.setMuted(settings.muted);
    $('snd').textContent = settings.muted ? 'Sound off' : 'Sound on';
    setHaptics(settings.haptics);
    stage.classList.toggle('lefty', settings.swap);
    renderer.w = 0; // force a resize so battery saver takes effect
    if (session) session.lefty = settings.swap;
    renderHow();
  }
  const syncForm = bindSettingsForm($, applySettings);

  function renderHow() {
    const lefty = settings.swap;
    const rows = input.touch ? [
      [lefty ? 'Right thumb' : 'Left thumb', 'walk, push past the ring to sprint'],
      [lefty ? 'Left thumb' : 'Right thumb', 'look around'],
      ['Hold scan', 'paint the dark, drag to aim. It heats up'],
      ['Sweep', 'one full picture of the room. Loud'],
      ['Crouch', 'beside scan: quiet, fits the crawls, hides you in dark corners'],
      ['Track', 'the motion tracker: what moves, through rock. Runs on batteries; ticks'],
    ] : input.noLock ? [
      ['W A S D', 'walk, Shift to sprint'],
      ['Drag', 'look around (arrow keys turn too)'],
      ['Hold Space', 'paint the dark. It heats up'],
      ['F or right click', 'one full picture of the room. Loud'],
      ['C', 'crouch: quiet, fits the crawls, hides you'],
      ['Q', 'the motion tracker: what moves, through rock. Runs on batteries; ticks'],
      ['Esc or P', 'pause'],
    ] : [
      ['W A S D', 'walk, Shift to sprint'],
      ['Mouse', 'look around (click to capture it)'],
      ['Hold click', 'paint the dark (Space works too). It heats up'],
      ['F or right click', 'one full picture of the room. Loud'],
      ['C', 'crouch: quiet, fits the crawls, hides you'],
      ['Q or middle click', 'the motion tracker: what moves, through rock. Runs on batteries; ticks'],
      ['Esc or P', 'pause'],
    ];
    const html = rows.map(([k, v]) => `<li style="display:contents"><b>${k}</b><span>${v}</span></li>`).join('');
    $('how').innerHTML = html;
    $('pause-how').innerHTML = html;
  }

  // ------------------------------------------------------------ title
  const unlocked = i => i === 0 || !!progress.cleared[LEVELS[i - 1].id];
  let selected = LEVELS.findIndex((l, i) => unlocked(i) && !progress.cleared[l.id]);
  if (selected < 0) selected = 0;

  function renderLevels() {
    const diff = settings.difficulty;
    $('levels').innerHTML = LEVELS.map((l, i) => {
      const best = progress.best[l.id + ':' + diff];
      const open = unlocked(i);
      const right = !open ? 'Locked' : best != null ? 'Best ' + formatTime(best) : progress.cleared[l.id] ? 'Cleared' : '';
      return `<li><button type="button" data-i="${i}" aria-pressed="${i === selected}"${open ? '' : ' disabled'}>` +
        `<span class="num">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="name"><b>${l.name}</b><small>${open ? l.blurb : 'Clear the level before it'}</small></span>` +
        `<span class="best">${right}</span></button></li>`;
    }).join('');
    $('difficulty').innerHTML = Object.entries(DIFFICULTY).map(([k, d]) =>
      `<button type="button" role="radio" data-d="${k}" aria-checked="${k === diff}">${d.label}</button>`).join('');
    $('diff-blurb').textContent = DIFFICULTY[diff].blurb;
    $('go').textContent = 'Start ' + LEVELS[selected].name;
  }
  $('levels').addEventListener('click', e => {
    const b = e.target.closest('button[data-i]');
    if (!b || b.disabled) return;
    selected = +b.dataset.i; renderLevels();
  });
  $('difficulty').addEventListener('click', e => {
    const b = e.target.closest('button[data-d]');
    if (!b) return;
    settings.difficulty = b.dataset.d; saveSettings(); renderLevels();
  });

  function toTitle() {
    session = null;
    app = 'title'; input.enabled = false; input.releaseAll(); input.exitLock();
    engine.suspend(false);
    sounds.updateHum(false, 0, 0); sounds.setBreath(0, 0, 0); sounds.ambience(0.4);
    playUi(false);
    startAttract();
    renderLevels();
    show('title');
  }

  function startAttract() {
    attract = new Session(ATTRACT.level, {demo: true, seed: 7, renderer, sounds, ui: {say() {}, note() {}, caught() {}, won() {}, cores() {}}, reduceMotion});
  }

  // ------------------------------------------------------------ levels
  function startLevel(i, snap) {
    engine.init(); sounds.start(); sounds.ambience(1, 4);
    try { navigator.wakeLock?.request('screen').catch(() => {}); } catch (e) { /* optional */ }
    levelIndex = i;
    const def = LEVELS[i];
    const ui = {
      say, note: openNote, caught: showCaught, won: showWon,
      cores: () => {},
    };
    session = new Session(def, {difficulty: settings.difficulty, renderer, sounds, ui, reduceMotion, seed: snap?.seed, lefty: settings.swap});
    if (snap) session.restore(snap);
    attract = null;
    clock = 0;
    hud.setCores(session.cores.length);
    show(null);
    playUi(true);
    enterPlay();
    say(def.intro || '', 6000);
  }

  /** Back into the game from a sheet: take the mouse (we are inside the button's click) and drop focus. */
  function enterPlay() {
    app = 'play'; input.enabled = true;
    document.activeElement?.blur?.();
    input.grab();
  }

  function pause() {
    if (app !== 'play') return;
    app = 'paused';
    input.enabled = false; input.releaseAll(); input.exitLock();
    sounds.updateHum(false, 0, 0);
    engine.suspend(true);
    const def = LEVELS[levelIndex];
    $('pause-level').textContent = String(levelIndex + 1).padStart(2, '0') + '  ' + def.name;
    $('pause-goal').textContent = session.coresLeft > 0
      ? `${session.coresGot} of ${session.cores.length} cores recovered. ${formatTime(session.time)} in.`
      : `Every core is in. Get to the amber door. ${formatTime(session.time)} in.`;
    for (const id of ['fire', 'sweep', 'crouch', 'track']) $(id).hidden = true;
    show('paused');
  }

  function resume() {
    if (!session) return;
    engine.init(); engine.suspend(false);
    show(null);
    playUi(true);
    enterPlay();
  }

  function openNote(n) {
    app = 'note';
    input.enabled = false; input.releaseAll(); input.exitLock();
    sounds.updateHum(false, 0, 0);
    $('note-title').textContent = n.title;
    $('note-text').textContent = n.text;
    const id = LEVELS[levelIndex].id, found = new Set(progress.notes[id] || []);
    found.add(n.i); progress.notes[id] = [...found]; saveProgress();
    show('note-sheet');
    $('note-close').focus({preventScroll: true});
  }

  function showCaught() {
    app = 'caught';
    input.enabled = false; input.releaseAll(); input.exitLock();
    const d = session.deaths;
    $('caught-text').textContent = d === 1 ? 'It found you.' : `It found you. That is ${d} times on this level.`;
    $('retry').textContent = session.coresGot ? 'Back to the last core' : 'Back to the start';
    playUi(false);
    show('caught');
  }

  function showWon(stats) {
    app = 'won';
    input.enabled = false; input.releaseAll(); input.exitLock();
    const def = LEVELS[levelIndex], key = def.id + ':' + settings.difficulty;
    const prev = progress.best[key], isBest = prev == null || stats.time < prev;
    if (isBest) progress.best[key] = stats.time;
    progress.cleared[def.id] = true;
    saveProgress();
    const last = levelIndex === LEVELS.length - 1;
    $('won-level').textContent = String(levelIndex + 1).padStart(2, '0') + '  ' + def.name + '  ·  ' + DIFFICULTY[settings.difficulty].label;
    $('won-text').textContent = last ? def.ending
      : stats.deaths ? `Out, after it caught you ${stats.deaths === 1 ? 'once' : stats.deaths + ' times'}.` : 'Out, and it never touched you.';
    $('st-time').textContent = formatTime(stats.time);
    $('st-best').textContent = formatTime(progress.best[key]);
    $('st-best').classList.toggle('new', isBest);
    $('st-deaths').textContent = stats.deaths;
    $('st-notes').textContent = stats.notes + ' / ' + stats.notesTotal;
    $('st-dots').textContent = stats.dots.toLocaleString();
    $('next').hidden = last;
    playUi(false);
    show('won');
    if (!last) selected = levelIndex + 1;
  }

  // ------------------------------------------------------------ buttons
  const click = (id, fn) => $(id).addEventListener('click', () => { sounds.click(); fn(); });
  click('go', () => startLevel(selected));
  click('resume', resume);
  click('restart', () => startLevel(levelIndex));
  click('quit', toTitle);
  click('caught-quit', toTitle);
  click('won-quit', toTitle);
  click('retry', () => { session.respawn(); show(null); playUi(true); enterPlay(); });
  click('next', () => startLevel(levelIndex + 1));
  click('again', () => startLevel(levelIndex));
  click('note-close', () => { show(null); enterPlay(); });
  click('pause', pause);
  const openSettings = from => { settingsFrom = from; app = 'settings'; syncForm(); $('reset-note').hidden = true; show('settings'); };
  click('open-settings', () => openSettings('title'));
  click('pause-settings', () => openSettings('paused'));
  click('settings-back', () => {
    if (settingsFrom === 'paused') { app = 'paused'; show('paused'); }
    else { app = 'title'; renderLevels(); show('title'); }
  });
  let resetArmed = false;
  click('reset-progress', () => {
    if (!resetArmed) {
      resetArmed = true;
      $('reset-progress').textContent = 'Tap again to erase';
      $('reset-note').hidden = false;
      $('reset-note').textContent = 'This clears every cleared level, best time and found note on this device.';
      return;
    }
    resetArmed = false;
    resetProgress(); selected = 0;
    $('reset-progress').textContent = 'Reset progress';
    $('reset-note').textContent = 'Progress cleared.';
  });
  $('snd').addEventListener('click', () => {
    settings.muted = !settings.muted; saveSettings(); applySettings();
  });

  input.onPause = why => {
    if (app === 'play') pause();
    else if (app === 'paused' && why === 'key') resume();
  };
  input.onTouchMode = () => { stage.classList.add('touch'); renderHow(); };
  input.onMouseMode = () => renderHow();
  if (input.touch) stage.classList.add('touch');
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (app === 'play') pause(); input.releaseAll(); }
  });
  // on a computer, clicking into another window must not leave the game running unattended
  addEventListener('blur', () => { if (app === 'play' && !input.touch) pause(); });
  // Android app: going to the background pauses; the system back button pauses, resumes or
  // closes a sheet, and returns false on the title screen so the app can exit
  window.pinprickPause = () => pause();
  window.pinprickBack = () => {
    if (app === 'play') pause();
    else if (app === 'paused') resume();
    else if (app === 'settings') $('settings-back').click();
    else if (app === 'note') $('note-close').click();
    else if (app === 'caught' || app === 'won') toTitle();
    else return false;
    return true;
  };

  // ------------------------------------------------------------ frame loop
  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return false;
    if (renderer.resize(w, h, settings.saver ? 1 : 2)) {
      view.w = w; view.h = h;
      cam.resize(w, h);
    }
    return true;
  }

  function frame(ms) {
    requestAnimationFrame(frame);
    const T = ms / 1000;
    let dt = T - last; last = T;
    if (!(dt > 0)) dt = 0.016;
    if (dt > 0.05) dt = 0.05;
    if (!resize()) return;

    if (session) {
      const live = app === 'play' || session.state === 'caught';
      const hint = app === 'play' && !input.touch && !input.noLock && !input.locked;
      if (hint !== lockHint) { lockHint = hint; $('lockhint').hidden = !hint; }
      if (live) {
        clock += dt;
        const intent = input.frame(dt);
        session.update(dt, clock, intent, cam, view);
        if (app === 'play') hud.update(session, cam, view, reduceMotion);
      }
      renderer.draw(cam, clock, session.diff.dotLife, 0.4, session.gunState(clock), session.trackerState(clock));
    } else if (attract) {
      attract.attract(dt, T, cam, view, ATTRACT.pose);
      renderer.draw(cam, T, DOTS.life, 0.4);
    }
  }

  // ------------------------------------------------------------ start
  applySettings();
  renderLevels();
  startAttract();
  show('title');
  requestAnimationFrame(frame);

  // test hook for tools/smoke.mjs, only with #debug in the address; #debug-nopoints also stops point
  // drawing from the first frame (headless Chromium on Android loses its GL context on any draw)
  if (location.hash.startsWith('#debug')) renderer.skipPoints = location.hash === '#debug-nopoints';
  if (location.hash.startsWith('#debug')) window.__pinprick = {get app() { return app; }, get session() { return session; }, startLevel, cam, renderer, buildGunMesh, buildTrackerMesh, TRACKER_SCREEN, get clock() { return session ? clock : last; }};

  const hot = window.claude?.hot;
  try {
    hot?.snapshot?.(() => (session && (app === 'play' || app === 'paused'))
      ? {level: levelIndex, difficulty: settings.difficulty, snap: session.snapshot()} : null);
  } catch (e) { /* not in a viewer */ }
  if (hotData && hotData.snap && LEVELS[hotData.level]) {
    if (hotData.difficulty) settings.difficulty = hotData.difficulty;
    startLevel(hotData.level, hotData.snap);
    pause();
  }
}

const hot = window.claude?.hot;
if (hot?.ready) hot.ready(boot); else boot(hot?.data ?? null);
