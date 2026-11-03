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
import {setHaptics, setRumbleSource} from './ui/haptics.js';
import {Captions} from './ui/captions.js';
import {DotWord, PALETTES} from './ui/dotword.js';
import {BrainView} from './ui/debugview.js';
import {menuMove, menuAccept, focusPrimary, primaryOf} from './ui/menu.js';
import {controlSets, tabsHtml, panelsHtml, shortHtml, linkControls} from './ui/controls.js';
import {gradeRun, parFor, debriefRows, learnedLines} from './ui/debrief.js';
import {Session} from './game/session.js';
import {LEVELS, ATTRACT} from './levels/index.js';
import {DIFFICULTY, DOTS} from './config.js';
import {formatTime} from './util/math.js';
import {load, save, has, forget} from './util/storage.js';

const $ = id => document.getElementById(id);

const RUN = 'run';              // the run in progress, kept so that a reload does not lose it
const MEMORY = 'memory';        // what the creature has learned across runs (game/memory.js)
const WORTH_ASKING = 60;        // seconds into a run before Restart asks you to press twice
const MENU_GUARD = 280;         // ms a new sheet ignores the controller's A: a press meant for the game must not choose

function boot(hotData) {
  const stage = $('stage'), canvas = $('gl');
  const renderer = new Renderer(canvas);
  if (!renderer.gl) {
    $('note').textContent = 'This browser cannot start WebGL, so the scanner has nothing to draw with.';
    $('note').style.display = 'block'; // short screens hide this line otherwise
    $('go').disabled = true;
    return;
  }
  const motionOS = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let reduceMotion = motionOS || settings.reduceMotion;
  const engine = new AudioEngine(), sounds = new Sounds(engine);
  const cam = new Camera(), hud = new Hud($);
  const view = {w: 0, h: 0};
  const input = new Input(stage, canvas, {fire: $('fire'), sweep: $('sweep'), crouch: $('crouch'), track: $('track'), throwStone: $('throw'), breath: $('breath'), stick: $('stick')}, settings);
  const captions = new Captions($('captions'));
  sounds.onSound = captions.hear;
  const dotWord = new DotWord(reduceMotion);
  const brain = location.hash.startsWith('#debug') ? new BrainView(stage) : null;
  setRumbleSource(() => (input.padActive ? input.gamepad.pad : null));

  let app = 'title';          // title | play | paused | settings | controls | note | caught | won
  let settingsFrom = 'title', controlsFrom = 'title';
  let session = null, levelIndex = 0, attract = null;
  let clock = 0, last = 0;
  let msgTimer = 0;
  let lockHint = false;
  let sheetNow = null, menuGuard = 0;
  let wake = null;
  let lastSaver = settings.saver;

  const sheets = ['title', 'paused', 'settings', 'controls', 'note-sheet', 'caught', 'won'];
  const dotWords = {title: PALETTES.scan, paused: PALETTES.quiet, settings: PALETTES.quiet, controls: PALETTES.quiet, caught: PALETTES.danger, won: PALETTES.exit}; // headings the scanner paints
  const playEls = ['hud', 'reticle', 'fire', 'sweep', 'crouch', 'track', 'throw', 'breath', 'pause']; // the HUD hides what you do not have yet
  function show(sheet) {
    for (const id of sheets) $(id).hidden = id !== sheet;
    sheetNow = sheet;
    stage.dataset.sheet = sheet || '';
    if (sheet) {
      clearTimeout(msgTimer); $('msg').classList.remove('on');
      captions.clear();
      for (const id of playEls) $(id).hidden = true; // playUi(true) brings them back
      $('stick').hidden = true; $('lockhint').hidden = true; lockHint = false;
      menuGuard = performance.now() + MENU_GUARD;
      if (input.padActive) focusPrimary($(sheet));
      if (!reduceMotion) { const fx = $('sheetfx'); fx.classList.remove('go'); void fx.offsetWidth; fx.classList.add('go'); }
    }
    syncCaptions();
    if (dotWords[sheet]) dotWord.attach($(sheet).querySelector('h1'), dotWords[sheet]);
    else dotWord.detach();
  }
  function playUi(on) {
    for (const id of playEls) $(id).hidden = !on;
    if (!on) { $('stick').hidden = true; $('lockhint').hidden = true; lockHint = false; $('vignette').style.opacity = 0; $('blackout').style.opacity = 0; }
    if (on) hud.reset();
  }
  function syncCaptions() { captions.enabled = settings.captions && !sheetNow && !!session; }

  /** On-screen message. `text` may be {touch, mouse} when the wording depends on the controls. */
  function say(text, ms) {
    if (text && typeof text === 'object') text = input.touch ? text.touch : text.mouse;
    const m = $('msg');
    $('msg-text').textContent = text; m.classList.add('on');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => m.classList.remove('on'), ms || 4500);
  }

  // ------------------------------------------------------------ the run in progress
  function saveRun() {
    if (!session || (session.state !== 'play' && session.state !== 'caught')) return; // out: nothing worth coming back to
    try {
      save(RUN, {v: 1, id: LEVELS[levelIndex].id, level: levelIndex, difficulty: settings.difficulty, snap: session.snapshot()});
    } catch (e) { /* better no save than a broken pause */ }
  }
  function savedRun() {
    const r = load(RUN, {});
    return r.v === 1 && r.snap && LEVELS[r.level]?.id === r.id ? r : null;
  }

  // ------------------------------------------------------------ sound and the screen
  /** Sound can only start from a gesture, so the room tone begins with the first press of anything. */
  function wakeSound() {
    if (app === 'paused' || document.hidden) return;
    if (!engine.ctx) {
      if (!engine.init()) return;
      sounds.start();
      if (!session) sounds.ambience(0.4);
    } else if (engine.ctx.state === 'suspended') engine.ctx.resume();
  }
  addEventListener('pointerdown', wakeSound, true);
  addEventListener('keydown', wakeSound, true);

  /** Keep the phone awake while you stand very still. Browsers drop this whenever the page is hidden. */
  function keepAwake(on) {
    if (!on) {
      const w = wake; wake = null;
      w?.release?.().catch?.(() => {});
      return;
    }
    if (wake || !navigator.wakeLock || document.hidden) return;
    try {
      navigator.wakeLock.request('screen').then(l => {
        if (app !== 'play') { l.release().catch(() => {}); return; }
        wake = l;
        l.addEventListener('release', () => { if (wake === l) wake = null; });
      }).catch(() => {});
    } catch (e) { /* optional */ }
  }

  function toggleMute() {
    settings.muted = !settings.muted; saveSettings(); applySettings();
    if (app === 'play' && settings.muted && !settings.captions) say('Sound off. Settings has captions for what you would have heard.', 4000);
  }

  // ------------------------------------------------------------ settings
  function applySettings() {
    engine.setVolume(settings.volume);
    engine.setMuted(settings.muted);
    $('snd').textContent = settings.muted ? 'Sound off' : 'Sound on';
    setHaptics(settings.haptics);
    stage.classList.toggle('lefty', settings.swap);
    if (settings.saver !== lastSaver) { lastSaver = settings.saver; renderer.w = 0; } // force a resize so battery saver takes effect
    if (session) session.lefty = settings.swap;
    reduceMotion = motionOS || settings.reduceMotion;
    stage.classList.toggle('calm', reduceMotion);
    renderer.reduceMotion = reduceMotion;
    if (session) session.reduceMotion = reduceMotion;
    if (attract) attract.reduceMotion = reduceMotion;
    dotWord.setReduceMotion(reduceMotion);
    syncCaptions();
    renderHow();
  }
  const syncForm = bindSettingsForm($, applySettings);
  $('set-volume').addEventListener('change', () => { engine.init(); sounds.click(); }); // so you can hear what you just set

  // optional: only where the renderer has a quality setting
  const hasQuality = renderer.quality !== undefined;
  $('set-quality-row').hidden = !hasQuality;
  if (hasQuality && settings.quality) renderer.quality = settings.quality;
  $('set-quality').addEventListener('change', e => {
    settings.quality = e.target.checked ? 'low' : null; saveSettings(); // unticked: leave it to the frame watcher
    renderer.quality = settings.quality ?? 'auto';
  });

  // full screen is not worth saving: it can only be entered from a gesture
  const fsRoot = document.documentElement;
  $('set-fullscreen-row').hidden = !(document.fullscreenEnabled && fsRoot.requestFullscreen);
  const syncFullscreen = () => { $('set-fullscreen').checked = !!document.fullscreenElement; };
  document.addEventListener('fullscreenchange', syncFullscreen);
  $('set-fullscreen').addEventListener('change', e => {
    const go = e.target.checked ? fsRoot.requestFullscreen() : document.exitFullscreen();
    go?.catch?.(syncFullscreen);
  });

  function syncSettingsSheet() {
    syncForm();
    $('set-motion').checked = reduceMotion;
    $('set-motion').disabled = motionOS; // the system already asks for this
    $('set-quality').checked = (settings.quality ?? renderer.quality) === 'low';
    syncFullscreen();
    disarmReset(); disarmForget();
    $('reset-note').hidden = true;
  }

  let controlsTab = null, controlsDrawn = '';
  /** Which way of playing is in use right now. */
  const usingSet = () => (input.padActive ? 'pad' : input.touch ? 'touch' : input.noLock ? 'drag' : 'keys');
  function renderHow() {
    const sets = controlSets({noLock: input.noLock, lefty: settings.swap}), using = usingSet();
    const html = shortHtml(sets.find(q => q.id === using));
    $('how').innerHTML = html;
    $('pause-how').innerHTML = html;
    // picking up a controller while the sheet is open shows you the controller
    if (!sets.some(q => q.id === controlsTab) || (app === 'controls' && controlsDrawn && !controlsDrawn.startsWith(using + '|'))) controlsTab = using;
    const portrait = innerHeight > innerWidth, key = [using, controlsTab, input.noLock, settings.swap, portrait].join('|');
    if (key === controlsDrawn) return;
    controlsDrawn = key;
    const focused = document.activeElement?.id;
    $('ctl-tabs').innerHTML = tabsHtml(sets, controlsTab, using);
    $('control-sets').innerHTML = panelsHtml(sets, controlsTab, {lefty: settings.swap, portrait});
    if (focused?.startsWith('ctl-tab-')) $(focused)?.focus();
  }
  $('ctl-tabs').addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (!tab || tab.dataset.tab === controlsTab) return;
    sounds.click();
    controlsTab = tab.dataset.tab;
    renderHow();
  });
  linkControls($('control-sets'));

  // ------------------------------------------------------------ title
  const unlocked = i => i === 0 || !!progress.cleared[LEVELS[i - 1].id];
  let selected = LEVELS.findIndex((l, i) => unlocked(i) && !progress.cleared[l.id]);
  if (selected < 0) selected = 0;

  function renderLevels() {
    const diff = settings.difficulty;
    if (!unlocked(selected)) selected = 0;
    const focused = document.activeElement?.dataset || {};
    $('levels').innerHTML = LEVELS.map((l, i) => {
      const best = progress.best[l.id + ':' + diff];
      const open = unlocked(i);
      const right = !open ? 'Locked' : best != null ? 'Best ' + formatTime(best) : progress.cleared[l.id] ? 'Cleared' : '';
      // the best times on the other difficulties, where there are any
      const others = !open ? '' : Object.entries(DIFFICULTY).filter(([k]) => k !== diff && progress.best[l.id + ':' + k] != null)
        .map(([k, d]) => `<i>${d.label} ${formatTime(progress.best[l.id + ':' + k])}</i>`).join('');
      return `<li><button type="button" data-i="${i}" aria-pressed="${i === selected}"${open ? '' : ' disabled'}>` +
        `<span class="num">${String(i + 1).padStart(2, '0')}</span>` +
        `<span class="name"><b>${l.name}</b><small>${open ? l.blurb : 'Clear the level before it'}</small>${others ? `<small class="times">${others}</small>` : ''}</span>` +
        `<span class="best">${right}</span></button></li>`;
    }).join('');
    $('difficulty').innerHTML = Object.entries(DIFFICULTY).map(([k, d]) =>
      `<button type="button" role="radio" data-d="${k}" aria-checked="${k === diff}">${d.label}</button>`).join('');
    $('diff-blurb').textContent = DIFFICULTY[diff].blurb;
    $('go').textContent = 'Start ' + LEVELS[selected].name;
    const run = savedRun();
    $('continue').hidden = !run;
    if (run) {
      const b = $('continue'), more = document.createElement('span');
      more.className = 'more'; // dropped on the shortest screens, so the buttons fit
      more.textContent = ` ${LEVELS[run.level].name}, ${formatTime(run.snap.time || 0)}`;
      b.replaceChildren('Continue', more);
    }
    $('go').className = run ? 'ghost' : 'cta';
    // those buttons were just replaced: keep the focus on the same one
    if (focused.i != null) $('levels').querySelector(`[data-i="${focused.i}"]`)?.focus({preventScroll: true});
    if (focused.d != null) $('difficulty').querySelector(`[data-d="${focused.d}"]`)?.focus({preventScroll: true});
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

  function toTitle(keepRun = false) {
    if (!keepRun) forget(RUN);
    session = null;
    app = 'title'; input.enabled = false; input.releaseAll(); input.exitLock();
    keepAwake(false);
    engine.suspend(false);
    sounds.updateHum(false, 0, 0); sounds.setBreath(0, 0, 0); sounds.setDread(0); sounds.ambience(0.4);
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
    levelIndex = i;
    const def = LEVELS[i];
    const ui = {
      say, note: openNote, caught: showCaught, won: showWon,
      cores: () => {},
    };
    const make = (seed, resume = false) => new Session(def, {difficulty: settings.difficulty, renderer, sounds, ui, reduceMotion, seed, resume, lefty: settings.swap, touch: input.touch});
    session = make(snap?.seed, !!snap);
    if (snap) {
      try { session.restore(snap); } catch (e) { forget(RUN); session = make(); snap = null; } // a save from another build: start over rather than crash
    }
    attract = null;
    clock = 0;
    hud.setCores(session.cores.length);
    show(null);
    playUi(true);
    enterPlay();
    if (!snap) say(def.intro || '', 6000);
    // a controller's button does not count as a gesture in every browser, so sound may still be blocked
    if (input.padActive) setTimeout(() => { if (app === 'play' && engine.ctx?.state === 'suspended') say('Press any key or tap the screen to turn the sound on.', 5000); }, 900);
  }

  /** Back into the game from a sheet: take the mouse (we are inside the button's click) and drop focus. */
  function enterPlay() {
    app = 'play'; input.enabled = true;
    engine.suspend(false);
    document.activeElement?.blur?.();
    input.grab();
    keepAwake(true);
  }

  function pause() {
    if (app !== 'play' || !session || session.state !== 'play') return; // not while it has you: that plays out
    saveRun();
    app = 'paused';
    input.enabled = false; input.releaseAll(); input.exitLock();
    keepAwake(false);
    sounds.updateHum(false, 0, 0);
    engine.suspend(true);
    const def = LEVELS[levelIndex];
    $('pause-level').textContent = String(levelIndex + 1).padStart(2, '0') + '  ' + def.name;
    $('pause-goal').textContent = session.coresLeft > 0
      ? `${session.coresGot} of ${session.cores.length} cores recovered. ${formatTime(session.time)} in.`
      : `Every core is in. Get to the amber door. ${formatTime(session.time)} in.`;
    disarmPause();
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

  function showCaught(info) {
    saveRun(); // a reload from here still counts this, and comes back at the last core
    app = 'caught';
    input.enabled = false; input.releaseAll(); input.exitLock();
    const d = session.deaths;
    $('caught-text').textContent = d === 1 ? 'It found you.' : `It found you. That is ${d} times on this level.`;
    const lesson = typeof info?.lesson === 'string' ? info.lesson.trim() : '';
    $('caught-lesson').hidden = !lesson;
    $('caught-lesson-text').textContent = lesson;
    $('retry').textContent = session.coresGot ? 'Back to the last core' : 'Back to the start';
    playUi(false);
    show('caught');
  }

  function showWon(stats) {
    stats = stats || {};
    app = 'won';
    input.enabled = false; input.releaseAll(); input.exitLock();
    keepAwake(false);
    forget(RUN);
    const def = LEVELS[levelIndex], key = def.id + ':' + settings.difficulty;
    const time = Number.isFinite(stats.time) ? stats.time : session?.time || 0;
    const deaths = Number.isFinite(stats.deaths) ? stats.deaths : session?.deaths || 0;
    const prev = progress.best[key], isBest = prev == null || time < prev;
    if (isBest) progress.best[key] = time;
    progress.cleared[def.id] = true;
    saveProgress();
    const last = levelIndex === LEVELS.length - 1;
    $('won-level').textContent = String(levelIndex + 1).padStart(2, '0') + '  ' + def.name + '  ·  ' + DIFFICULTY[settings.difficulty].label;
    $('won-text').textContent = def.ending
      || (deaths ? `Out, after it caught you ${deaths === 1 ? 'once' : deaths + ' times'}.` : 'Out, and it never touched you.');
    $('st-time').textContent = formatTime(time);
    $('st-best').textContent = formatTime(progress.best[key]);
    $('st-best').classList.toggle('new', isBest);
    $('st-deaths').textContent = deaths;
    $('st-notes').textContent = (stats.notes ?? 0) + ' / ' + (stats.notesTotal ?? 0);
    $('st-dots').textContent = (stats.dots ?? 0).toLocaleString();
    // the debrief
    const grade = gradeRun({time, par: parFor(def), deaths, closeCalls: stats.closeCalls, difficulty: settings.difficulty});
    $('grade').hidden = false;
    $('grade-letter').textContent = grade.letter;
    $('grade-word').textContent = grade.word;
    const rows = debriefRows(stats);
    $('debrief').hidden = !rows.length;
    $('debrief').replaceChildren(...rows.map(([label, value]) => {
      const box = document.createElement('div'), a = document.createElement('span'), b = document.createElement('b');
      a.textContent = label; b.textContent = value;
      box.append(a, b);
      return box;
    }));
    const learned = learnedLines(stats);
    $('won-learned').hidden = !learned.length;
    $('won-learned-list').replaceChildren(...learned.map(line => { const li = document.createElement('li'); li.textContent = line; return li; }));
    $('next').hidden = last;
    playUi(false);
    show('won');
    if (!last) selected = levelIndex + 1;
  }

  // ------------------------------------------------------------ buttons
  // only while sound is running: a tone scheduled in a suspended context waits, and they all go off at once on resume
  const click = (id, fn) => $(id).addEventListener('click', () => { if (engine.ctx?.state === 'running') sounds.click(); fn(); });

  /** A button that wants pressing twice when `risky()`; the first press only says so. */
  function pressTwice(id, again, risky, act) {
    const b = $(id), label = b.textContent;
    let armed = false, timer = 0;
    const disarm = () => { armed = false; b.textContent = label; clearTimeout(timer); };
    click(id, () => {
      if (armed || !risky()) { disarm(); act(); return; }
      armed = true; b.textContent = again;
      clearTimeout(timer); timer = setTimeout(disarm, 4000);
    });
    return disarm;
  }
  const inDeep = () => !!session && session.time > WORTH_ASKING;
  const disarmPause = pressTwice('restart', 'Press again to restart', inDeep, () => { forget(RUN); startLevel(levelIndex); });
  click('quit', () => { saveRun(); toTitle(true); }); // nothing lost: the title offers to continue

  click('go', () => { forget(RUN); startLevel(selected); });
  click('continue', () => {
    const run = savedRun();
    if (!run) { renderLevels(); return; }
    if (DIFFICULTY[run.difficulty]) { settings.difficulty = run.difficulty; saveSettings(); }
    startLevel(run.level, run.snap);
  });
  click('resume', resume);
  click('caught-quit', () => toTitle());
  click('won-quit', () => toTitle());
  click('retry', () => { session.respawn(); show(null); playUi(true); enterPlay(); });
  click('next', () => startLevel(levelIndex + 1));
  click('again', () => startLevel(levelIndex));
  click('note-close', () => { show(null); playUi(true); enterPlay(); });
  click('pause', pause);
  const openSettings = from => { settingsFrom = from; app = 'settings'; syncSettingsSheet(); show('settings'); };
  click('open-settings', () => openSettings('title'));
  click('pause-settings', () => openSettings('paused'));
  click('settings-back', () => {
    if (settingsFrom === 'paused') { app = 'paused'; engine.suspend(true); disarmPause(); show('paused'); }
    else { app = 'title'; renderLevels(); show('title'); }
  });
  const openControls = from => { controlsFrom = from; controlsTab = usingSet(); app = 'controls'; renderHow(); show('controls'); $('controls').scrollTop = 0; };
  click('open-controls', () => openControls('title'));
  click('pause-controls', () => openControls('paused'));
  click('controls-back', () => {
    if (controlsFrom === 'paused') { app = 'paused'; disarmPause(); show('paused'); }
    else { app = 'title'; show('title'); }
  });

  /** Reset and forget share the note under the buttons and the same press-twice manner. */
  function eraser(id, armedText, warning, done, act, empty) {
    const b = $(id), label = b.textContent, note = $('reset-note');
    let armed = false;
    const disarm = () => { armed = false; b.textContent = label; };
    click(id, () => {
      note.hidden = false;
      const nothing = empty?.();
      if (nothing) { disarm(); note.textContent = nothing; return; }
      if (!armed) { disarmReset(); disarmForget(); armed = true; b.textContent = armedText; note.textContent = warning; return; }
      disarm(); act(); note.textContent = done;
    });
    return disarm;
  }
  const disarmReset = eraser('reset-progress', 'Tap again to erase', 'This clears every cleared level, best time and found note on this device.', 'Progress cleared.',
    () => { resetProgress(); forget(RUN); selected = 0; });
  const disarmForget = eraser('forget', 'Tap again: it forgets', 'It keeps what it learned about how you play from one run to the next. This wipes it, and it starts again from nothing.', 'It has forgotten you. For now.',
    () => {
      forget(MEMORY);
      // a level in progress holds its own copy, and must not save it straight back
      const m = session?.memory;
      if (m) { if (m.forget) m.forget(); else m.persist = false; }
    },
    () => (has(MEMORY) ? '' : 'It has not learned anything about you yet.'));
  $('snd').addEventListener('click', toggleMute);
  input.onMute = toggleMute;

  // ------------------------------------------------------------ pausing, backing out, the controller
  /** Whatever "back" means on the sheet you are on. False if it means nothing there. */
  function menuBack() {
    if (app === 'paused') $('resume').click();
    else if (app === 'settings') $('settings-back').click();
    else if (app === 'controls') $('controls-back').click();
    else if (app === 'note') $('note-close').click();
    else return false;
    return true;
  }
  input.onPause = why => {
    if (app === 'play') pause();
    else if (why === 'key') menuBack();
  };
  input.onMenu = action => {
    if (!sheetNow) return;
    const sheet = $(sheetNow), ready = performance.now() >= menuGuard;
    if (action === 'accept') { if (ready) menuAccept(sheet); }
    else if (action === 'start') { if (ready) primaryOf(sheet)?.click(); }
    else if (action === 'back') menuBack();
    else menuMove(sheet, action);
  };
  input.onPadChange = () => {
    renderHow();
    $('pad-note').hidden = !input.padActive;
    if (input.padActive && sheetNow) focusPrimary($(sheetNow));
  };
  input.onTouchMode = on => { stage.classList.toggle('touch', on); renderHow(); if (session) session.touch = on; };
  input.onMouseMode = () => renderHow();
  if (input.touch) stage.classList.add('touch');
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      saveRun();
      if (app === 'play') pause();
      input.releaseAll();
      engine.suspend(true); // every screen, not only a paused level
    } else {
      if (app !== 'paused') engine.suspend(false);
      if (app === 'play') keepAwake(true);
    }
  });
  addEventListener('pagehide', saveRun);
  // clicking into another window must not leave the game running unattended. Touch screens get a moment
  // for the focus to come back, as some of them drop it briefly for system overlays
  let blurTimer = 0;
  addEventListener('blur', () => {
    if (app !== 'play') return;
    if (!input.touch) { pause(); return; }
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => { if (app === 'play' && !document.hasFocus()) pause(); }, 300);
  });
  // Android app: going to the background pauses; the system back button pauses, resumes or
  // closes a sheet, and returns false on the title screen so the app can exit
  window.pinprickPause = () => pause();
  renderer.onContextLost = () => pause(); // the picture is gone: nobody should be hunted blind while it comes back
  window.pinprickBack = () => {
    if (app === 'play') pause();
    else if (menuBack()) { /* done */ }
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
    input.pollPad(dt);
    captions.tick();
    dotWord.frame(T);
    brain?.update(session, dt);

    if (session) {
      const live = app === 'play'; // a sheet stops the clock, the Caught sheet too
      const hint = live && !input.touch && !input.noLock && !input.locked && !input.padActive;
      if (hint !== lockHint) { lockHint = hint; $('lockhint').hidden = !hint; }
      if (live) {
        clock += dt;
        const intent = input.frame(dt);
        session.update(dt, clock, intent, cam, view);
        if (app === 'play') hud.update(session, cam, view, reduceMotion);
      }
      if (session) {
        renderer.setFx(session.fearNow, session.fx.ping);
        renderer.draw(cam, clock, session.diff.dotLife, 0.4, session.gunState(clock), session.trackerState(clock));
      }
    } else if (attract) {
      attract.attract(dt, T, cam, view, ATTRACT.pose);
      renderer.setFx(0, 0);
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
  if (location.hash.startsWith('#debug')) window.__pinprick = {get app() { return app; }, get session() { return session; }, startLevel, cam, renderer, buildGunMesh, buildTrackerMesh, TRACKER_SCREEN, get clock() { return session ? clock : last; }, input, hud, captions, sounds, engine, settings, progress, brain, won: showWon, caught: showCaught};

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
