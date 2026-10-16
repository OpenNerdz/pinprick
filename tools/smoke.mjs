// Plays the built game in headless Chromium and saves screenshots to .tmp/shots. Fails on any
// console error. Usage: node tools/smoke.mjs [path-to-chromium]
//
// Headless Chromium on Android (SwiftShader) loses its WebGL context on the first draw call of any
// kind, so the frame is redrawn on a 2D canvas laid over it: the dot cloud, and the gun's and the motion
// tracker's real triangles projected through the game's own camera and view-model matrices, lit with
// the shaders' formulas (the tracker's screen reduced to its rings and blips).
// Game logic, HUD and screens are the real thing; only the final pixels are substituted.
import {chromium} from 'playwright-core';
import {mkdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.tmp/shots');
mkdirSync(out, {recursive: true});
const url = 'file://' + join(root, 'dist/pinprick.html') + '#debug-nopoints';
const exe = process.argv[2] || '/data/data/com.termux/files/usr/bin/chromium-browser';

const browser = await chromium.launch({
  executablePath: exe, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader-webgl', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});
const errors = [];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function overlay() {
  const g = window.__pinprick, stage = document.getElementById('stage');
  const c = document.createElement('canvas');
  c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
  document.getElementById('gl').after(c);
  const ctx = c.getContext('2d');
  function plot(data, i, T, life, gain, H, W, k0, vp) {
    const o = i * 8, x = data[o], y = data[o + 1], z = data[o + 2], age = T - data[o + 3];
    if (age < 0 || age > life) return;
    const w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
    if (w < 0.05) return;
    const sx = ((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w + 1) * W / 2;
    const sy = (1 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w) * H / 2;
    if (sx < -10 || sy < -10 || sx > W + 10 || sy > H + 10) return;
    const k = 1 - age / life, fade = k * (2 - k), flash = Math.exp(-age * 6) * 0.55;
    const sz = Math.min(13, Math.max(1.6, k0 * data[o + 7] / w));
    const m = fade * 0.9 * gain * 255;
    ctx.fillStyle = `rgb(${Math.min(255, (data[o + 4] + flash) * m) | 0},${Math.min(255, (data[o + 5] + flash) * m) | 0},${Math.min(255, (data[o + 6] + flash) * m) | 0})`;
    ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
  }
  (function draw() {
    requestAnimationFrame(draw);
    const W = stage.clientWidth, H = stage.clientHeight;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    ctx.globalCompositeOperation = 'source-over'; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    const r = g.renderer, D = r.dots, vp = g.cam.vp, k0 = H * 0.5 / Math.tan(g.cam.vfov / 2);
    if (!D) return;
    const T = g.clock, life = g.session ? g.session.diff.dotLife : 20;
    if (r.ghostData) for (let i = 0; i < r.ghostData.length / 8; i++) plot(r.ghostData, i, 0, 1e9, 0.4, H, W, k0, vp);
    for (let n = D.written - 1, end = Math.max(0, D.written - D.cap); n >= end; n--) plot(D.data, n % D.cap, T, life, 1, H, W, k0, vp);
    // the sweep's sheet of light, as translucent triangles
    const F = r.fan, proj = (o) => { const x = F[o], y = F[o + 1], z = F[o + 2], w = vp[3] * x + vp[7] * y + vp[11] * z + vp[15];
      return w < 0.05 ? null : [((vp[0] * x + vp[4] * y + vp[8] * z + vp[12]) / w + 1) * W / 2, (1 - (vp[1] * x + vp[5] * y + vp[9] * z + vp[13]) / w) * H / 2]; };
    for (let t3 = 0; t3 < (r.fanLast || 0); t3 += 3) {
      const a = proj(t3 * 7), b = proj((t3 + 1) * 7), c = proj((t3 + 2) * 7);
      if (!a || !b || !c) continue;
      ctx.fillStyle = 'rgba(140,240,225,0.10)';
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.closePath(); ctx.fill();
    }
    const gs = g.session && g.session.gunState(T);
    if (gs) drawMesh(mesh, gs.model, W, H, (m, col) => gunShade(m, col, gs));
    const ts = g.session && g.session.trackerState(T);
    if (ts) drawTracker(ts, W, H);
  })();

  const teal = [0.22, 0.83, 0.77], lime = [0.62, 1, 0.22];
  function gunShade(m, col, s) {
    const heat = [1, 0.42 - 0.34 * s.heat, 0.08], glow = s.charge * (s.firing ? 1 : 0);
    if (m === 3) return teal.map(v => v * (0.35 + 1.6 * glow + 2 * s.flash));
    if (m === 4) return col.map((v, k) => v * 0.6 + teal[k] * (0.06 + glow * 0.8 + s.flash));
    if (m === 5) { const h0 = Math.max(0, Math.min(1, (s.heat - 0.5) / 0.5)), h = h0 * h0 * (3 - 2 * h0); return col.map((v, k) => v + heat[k] * h * 0.85); }
    if (m === 6) return [0.03, 0.2 + 0.4 * s.charge, 0.2 + 0.35 * s.charge];
    return col;
  }

  // the tracker: its body like the gun's, its screen dark phosphor with the rings and blips drawn on top
  const tmesh = g.buildTrackerMesh(), S = g.TRACKER_SCREEN;
  function drawTracker(s, W, H) {
    const power = s.a[2];
    drawMesh(tmesh, s.model, W, H, (m, col) => m === 3 ? col.map((v, k) => v + lime[k] * 0.06 * power)
      : m === 4 ? lime.map(v => v * (0.12 + 1.6 * s.a[3]) * power) : m === 6 ? [0.006, 0.02 + 0.03 * power, 0.01] : col);
    if (power <= 0 || s.c[2] > 0.5) return;
    const M = s.model, P = g.cam.proj;
    const at = (fx, fy) => { // fan space (1 = full reach) to the screen's pixels
      const u = fx * 0.84 / 1.657 + 0.5, v = fy * 0.84 + 0.07;
      const x = S.x0 + u * (S.x1 - S.x0), y = S.y0 + v * (S.y1 - S.y0), z = S.z + 0.0005;
      const q = [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
      return [(P[0] * q[0] / -q[2] + 1) * W / 2, (1 - P[5] * q[1] / -q[2]) * H / 2];
    };
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(158,255,56,0.35)'; ctx.lineWidth = 1;
    for (const r of [1 / 3, 2 / 3, 1]) {
      ctx.beginPath();
      for (let i = 0; i <= 24; i++) { const a = -Math.PI / 2 + Math.PI * i / 24, q = at(Math.sin(a) * r * s.c[0], Math.cos(a) * r * s.c[0]); i ? ctx.lineTo(...q) : ctx.moveTo(...q); }
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const b = s.k[i * 4 + 2];
      if (b <= 0) continue;
      const q = at(s.k[i * 4], s.k[i * 4 + 1]);
      ctx.fillStyle = `rgba(158,255,56,${b.toFixed(2)})`;
      ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, Math.PI * 2); ctx.fill();
    }
  }

  // a device: software-projected triangles, painter's order, the shader's lighting per face
  const mesh = g.buildGunMesh(), tris = [];
  function drawMesh(mesh, M, W, H, shade) {
    const P = g.cam.proj, L = [-0.45, 0.85, 0.35], ll = Math.hypot(...L);
    const tv = (i) => {
      const o = i * 9, x = mesh[o], y = mesh[o + 1], z = mesh[o + 2];
      return [M[0] * x + M[4] * y + M[8] * z + M[12], M[1] * x + M[5] * y + M[9] * z + M[13], M[2] * x + M[6] * y + M[10] * z + M[14]];
    };
    tris.length = 0;
    for (let t = 0; t < mesh.length / 27; t++) {
      const a = tv(t * 3), b = tv(t * 3 + 1), c = tv(t * 3 + 2), o = t * 27;
      let nx = M[0] * mesh[o + 3] + M[4] * mesh[o + 4] + M[8] * mesh[o + 5], ny = M[1] * mesh[o + 3] + M[5] * mesh[o + 4] + M[9] * mesh[o + 5], nz = M[2] * mesh[o + 3] + M[6] * mesh[o + 4] + M[10] * mesh[o + 5];
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl; // the model matrix scales
      const cx = (a[0] + b[0] + c[0]) / 3, cy = (a[1] + b[1] + c[1]) / 3, cz = (a[2] + b[2] + c[2]) / 3;
      const vl = Math.hypot(cx, cy, cz), vx = -cx / vl, vy = -cy / vl, vz = -cz / vl;
      if (nx * vx + ny * vy + nz * vz < -0.05) continue; // back faces
      const m = Math.round(mesh[o + 8]);
      const base = m === 0 ? [0.07, 0.08, 0.085] : m === 1 ? [0.15, 0.17, 0.18] : m === 2 ? [0.03, 0.03, 0.035] : [0.05, 0.06, 0.06];
      const dif = Math.max(0, (nx * L[0] + ny * L[1] + nz * L[2]) / ll), rim = Math.pow(1 - Math.max(0, nx * vx + ny * vy + nz * vz), 3);
      const hx = L[0] / ll + vx, hy = L[1] / ll + vy, hz = L[2] / ll + vz, hl = Math.hypot(hx, hy, hz);
      const spec = Math.pow(Math.max(0, (nx * hx + ny * hy + nz * hz) / hl), 42) * 0.35 * 0.6;
      const col = shade(m, base.map((v, k) => v * (0.1 + 0.55 * dif) + spec + rim * [0.1, 0.22, 0.22][k]));
      const pr = q => { const w = -q[2]; return [(P[0] * q[0] / w + 1) * W / 2, (1 - P[5] * q[1] / w) * H / 2]; };
      tris.push({z: cz, pts: [pr(a), pr(b), pr(c)], col});
    }
    tris.sort((p, q) => p.z - q.z);
    ctx.globalCompositeOperation = 'source-over';
    for (const t of tris) {
      const c = 'rgb(' + t.col.map(v => Math.min(255, Math.round(v * 255))).join(',') + ')';
      ctx.fillStyle = c; ctx.strokeStyle = c; ctx.lineWidth = 0.6;
      ctx.beginPath(); ctx.moveTo(...t.pts[0]); ctx.lineTo(...t.pts[1]); ctx.lineTo(...t.pts[2]); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  }
}

async function open(opts, unlockAll) {
  const ctx = await browser.newContext(opts);
  if (unlockAll) {
    await ctx.addInitScript(() => localStorage.setItem('pinprick.v2.progress',
      JSON.stringify({cleared: {intake: true, sublevel: true, cistern: true}, best: {}, notes: {}})));
  }
  const p = await ctx.newPage();
  p.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  p.on('pageerror', e => errors.push(String(e)));
  await p.goto(url);
  await p.evaluate(overlay);
  await sleep(1800);
  return p;
}
const shot = (p, name) => p.screenshot({path: join(out, name + '.png')});
const state = p => p.evaluate(() => {
  const g = window.__pinprick, s = g.session;
  return s ? {app: g.app, state: s.state, cores: s.coresGot, heat: +s.scanner.heat.toFixed(2), over: s.scanner.overheated, firing: s.scanner.firing,
    creature: s.stalker?.state, dist: s.stalker ? +s.stalker.playerDist.toFixed(1) : null, x: +s.player.x.toFixed(1), z: +s.player.z.toFixed(1), crouched: s.player.crouched}
    : {app: g.app};
});
const fps = p => p.evaluate(() => new Promise(r => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / 2); }; requestAnimationFrame(f); }));
const place = (p, x, z, yaw, pitch = 0) => p.evaluate(([x, z, yaw, pitch]) => {
  const pl = window.__pinprick.session.player; pl.x = x; pl.z = z; pl.yaw = yaw; pl.pitch = pitch;
}, [x, z, yaw, pitch]);

// ---------------- desktop, keyboard and mouse
{
  const p = await open({viewport: {width: 1280, height: 720}}, true);
  await shot(p, 'd01-title');
  await p.click('#levels button[data-i="0"]');
  await p.click('#go');
  await sleep(300);
  await p.keyboard.down('Space');
  await sleep(2500);
  console.log('desktop scanning fps', await fps(p));
  await shot(p, 'd02-scanning');
  await p.keyboard.up('Space');
  await p.keyboard.press('KeyF');
  await sleep(1300);
  await shot(p, 'd03-sweep-running');
  await sleep(1800);
  await shot(p, 'd04-sweep-done');
  // the wall writing in room C of the tutorial, shown by a sweep
  await p.evaluate(() => { const g = window.__pinprick; g.renderer.dots.clear(); g.session.scanner.cooldown = 0; });
  await place(p, 10, 18.2, 0, 0.12);
  await p.keyboard.press('KeyF'); await sleep(3200);
  await shot(p, 'd05-wall-writing');
  // walk onto the note
  await place(p, 12.5, 16.6, 0);
  await sleep(500);
  console.log('note', await state(p));
  await shot(p, 'd06-note');
  await p.click('#note-close');
  await p.keyboard.press('Escape');
  await sleep(300);
  await shot(p, 'd07-paused');
  await p.click('#pause-settings'); await sleep(200);
  await shot(p, 'd08-settings');
  await p.click('#settings-back'); await p.click('#quit'); await sleep(300);

  // level 2: the creature standing in the hall, then on all fours, each shown by a sweep
  await p.click('#levels button[data-i="1"]');
  await p.click('#go'); await sleep(300);
  await p.evaluate(() => { const g = window.__pinprick, s = g.session, st = s.stalker; g.renderer.dots.clear(); st.wake(); st.x = 17; st.z = 20.2; st.face = Math.PI; st.enter('wait', 0); st.timer = 99; st.hear = () => {}; st.diff = {...st.diff, lightHold: 1e9}; s.scanner.cooldown = 0; });
  await place(p, 17, 24.6, 0, 0.12);
  await p.keyboard.press('KeyF'); await sleep(3200);
  await shot(p, 'd09-creature-standing');
  await p.evaluate(() => { const g = window.__pinprick, s = g.session, st = s.stalker; g.renderer.dots.clear(); st.diff = {...st.diff, speed: 0}; st.x = 17; st.z = 20.6; st.enter('finale', 99); s.scanner.cooldown = 0; });
  await sleep(1200);
  await p.keyboard.press('KeyF'); await sleep(3000);
  await shot(p, 'd10-creature-crawling');
  console.log('creature', await state(p));
  // and the catch, half a second in
  await p.evaluate(() => { const g = window.__pinprick, s = g.session, st = s.stalker; st.diff = {...st.diff, speed: 1}; st.x = s.player.x + 0.3; st.z = s.player.z - 0.8; });
  await sleep(550);
  await shot(p, 'd10b-caught-moment');
  await sleep(2200);
  await p.click('#caught-quit'); await sleep(300);

  // level 3: the motion tracker on the creature crossing the start room; then overheat, then let it find us
  await p.click('#levels button[data-i="2"]');
  await p.click('#go'); await sleep(400);
  await p.evaluate(() => { const s = window.__pinprick.session, st = s.stalker; st._hear = st.hear; st.hear = () => {}; st.x = 15; st.z = 31.5; st.enter('investigate', 0); st.target = {x: 3, z: 31.5}; });
  await place(p, 8, 37, 0);
  await p.keyboard.press('KeyQ'); await sleep(2200);
  console.log('tracker', await p.evaluate(() => { const t = window.__pinprick.session.tracker; return {on: t.on, battery: +t.battery.toFixed(2), blips: t.blips.length}; }));
  await shot(p, 'd11a-tracker');
  await p.keyboard.press('KeyQ'); await sleep(400);
  await p.evaluate(() => { const st = window.__pinprick.session.stalker; st.hear = st._hear; });
  await p.keyboard.down('Space');
  for (let i = 0; i < 14; i++) { await sleep(700); const s = await state(p); if (s.over) break; }
  console.log('overheat', await state(p));
  await shot(p, 'd11-overheated');
  await p.keyboard.up('Space');
  await p.evaluate(() => { const s = window.__pinprick.session, st = s.stalker; st.x = s.player.x; st.z = s.player.z - 5; st.lastKnown.x = s.player.x; st.lastKnown.z = s.player.z; st.enter('hunt', 0); });
  for (let i = 0; i < 20; i++) { await sleep(300); const s = await state(p); if (s.app === 'caught') break; if (i === 3) await shot(p, 'd12-closing-in'); }
  await sleep(300);
  console.log('caught', await state(p));
  await shot(p, 'd13-caught');
  await p.click('#retry'); await sleep(500);
  console.log('respawned', await state(p));
  // finish the level: teleport through the cores and onto the exit
  await p.evaluate(() => { const s = window.__pinprick.session; s.stalker.sleep(); });
  for (let i = 0; i < 3; i++) {
    await p.evaluate(i => { const s = window.__pinprick.session, c = s.cores[i], pl = s.player; pl.x = c.x + 0.6; pl.z = c.z; }, i);
    await sleep(250);
  }
  await p.evaluate(() => { const s = window.__pinprick.session, pl = s.player; pl.x = s.exit.x; pl.z = s.exit.z; });
  await sleep(600);
  console.log('won', await state(p));
  await shot(p, 'd14-won');
  await p.close();
}

// ---------------- phone, touch
{
  const p = await open({viewport: {width: 412, height: 915}, deviceScaleFactor: 2, isMobile: true, hasTouch: true}, false);
  await shot(p, 'm01-title');
  await p.tap('#go'); await sleep(500);
  const cdp = await p.context().newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', {type, touchPoints: pts});
  // hold SCAN with the right thumb while pushing the stick forward with the left
  const fire = await p.locator('#fire').boundingBox();
  const fx = fire.x + fire.width / 2, fy = fire.y + fire.height / 2;
  await touch('touchStart', [{x: fx, y: fy, id: 1}]);
  await touch('touchStart', [{x: fx, y: fy, id: 1}, {x: 90, y: 700, id: 2}]);
  for (let i = 1; i <= 8; i++) { await touch('touchMove', [{x: fx - i * 4, y: fy, id: 1}, {x: 90, y: 700 - i * 7, id: 2}]); await sleep(60); }
  await sleep(1800);
  console.log('touch held', await state(p));
  console.log('phone scanning fps', await fps(p));
  await shot(p, 'm02-touch-play');
  await touch('touchEnd', []);
  await sleep(400);
  console.log('touch released', await state(p));
  const cr = await p.locator('#crouch').boundingBox();
  await touch('touchStart', [{x: cr.x + cr.width / 2, y: cr.y + cr.height / 2, id: 3}]); await touch('touchEnd', []);
  await sleep(300);
  console.log('after crouch tap', await state(p));
  // pick up the tutorial's tracker and tap TRACK
  await place(p, 11, 18.4, Math.PI); await sleep(300);
  const tk = await p.locator('#track').boundingBox();
  await touch('touchStart', [{x: tk.x + tk.width / 2, y: tk.y + tk.height / 2, id: 4}]); await touch('touchEnd', []);
  await sleep(1500);
  console.log('tracker tapped', await p.evaluate(() => { const s = window.__pinprick.session; return {owned: s.tracker.owned, on: s.tracker.on, up: s.hands.trk}; }));
  await shot(p, 'm02b-tracker');
  await p.tap('#pause'); await sleep(300);
  await shot(p, 'm03-paused');
  await p.tap('#quit'); await sleep(300);
  await p.tap('#open-settings'); await sleep(200);
  await shot(p, 'm04-settings');
  await p.close();
}

await browser.close();
if (errors.length) { console.error('console errors:\n' + errors.join('\n')); process.exit(1); }
console.log('smoke ok, screenshots in .tmp/shots');
