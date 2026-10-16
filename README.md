# Pinprick

A first-person horror game you only ever see through scanner dots. Hold the trigger and the dark fills
with points of light that fade after a few seconds. Something else is down there. It cannot see, but
it hears the scanner, your footsteps and the sweep.

Four levels: **Intake** (tutorial, nothing hunting you), **Sublevel** (the original map, the creature
wakes when you take the first core), **Cistern** and **Lift Shaft**.

The creature is built for listening. It has no eyes, just a long smooth skull with four flaps folded
back along it, which fan open round its mouth like a dish when it listens or clicks. Its neck is too
long, its spine is knobbly, a few ribs show over a hollow chest, its arms are far too long with three
splayed fingers, and its legs bend backwards. It is built from capsules on a jointed skeleton, so it
walks, gallops on all fours, cocks its head, shields its face from your light and rears over you.

It groans, drags a foot and breathes with a rattle, and it copies sounds it has heard you make. It only
knows what it hears or feels: keep still with the scanner off and it stops beside you to listen, then
goes another way. Once it has hunted you, though, it searches where it lost you, and then only a hiding
spot is safe. Three things make it this game's monster:

- **It has a scanner too, and it hunts with it.** When it listens it clicks, and a moment later the
  echo splashes red dots over everything around it. Whatever moves inside that red, it finds. Freeze
  on the first click.
  - **When it hunts, it moves in bursts.** It dashes on all fours toward where it last placed you,
    faster than you can sprint, then stops dead with its ear open and clicks. **Move while it runs,
    freeze when it clicks.**
  - **It gives up when its clicks come back empty:** a few empty clicks in a row, or a single one
    right where it thought you were, and it searches instead.
- **Light stops it.** Keep your beam on it (a glance is safe) and it knows where you are, but it cannot
  come on: it rears up in the light, and if you hold it there it shrieks and runs to the far side of
  the level. It gets used to the light, though, so each time it takes longer to break (on Hard soon
  longer than the scanner lasts), and if you let go or overheat first, it surges.
- **It walks in step with you.** Having lost you, it may follow your footsteps from a dozen metres back,
  stepping only when you step, so your steps sound doubled. Each step it closes in, and at arm's length
  it pounces. Stand still until it gives up the trail, or turn and touch it with the beam, and it bolts.

Difficulty changes its wits as well as its ears: how fast it reacts, how long its hunting dashes run
and how much warning its clicks give, how many empty clicks it takes to give up, how far its sonar reaches and how
long the clicks warn you, how long the light takes to break it, how often and how fast it stalks, whether it
reads which way you ran, how long it searches, and whether it goes round to wait at the far end of a
crawl. After you are caught it keeps away from where you come back for a while. `node
tools/balance.mjs` plays scripted players against it on every level and difficulty and prints how often
each gets caught.

The scanner in your hand is a real 3D model: every dot leaves its emitter, the coils light as it
charges, the fins glow as it heats, and the screen on its back shows charge, heat and sweep.

**The motion tracker** (Q or middle click; TRACK on touch) is held in your other hand, on the left
(the right when left-handed; on touch screens it sits higher, clear of the thumbstick). You find it in
Intake, and you can scan and sweep while it is up. Once a second it ticks and a wave sweeps across its screen. Anything that moved within reach
lights up as a blip, ahead of you and straight through rock. A return beep rises in pitch as the blip
gets closer. Its limits are what make it worth reading carefully:
- **Only motion.** A creature that listens, waits, lingers or is pinned in your beam is invisible to it.
  Each blip is where something was when the wave passed.
- **Behind you.** It only lights the edge of the screen, and on Hard it shows nothing at all.
- **Close range.** Inside 4 m the screen floods with static.
- **False contacts.** The scripted scares show up too: the footsteps, the figure, the statue.

Using it costs you, too:
- **Batteries.** It runs on them: every raise costs a little, and it drains while it is up. Spare
  batteries are lime-green dots, and only some spots hold one.
- **Sprinting.** You can't read it at a run: sprinting puts it away, and raising it again costs
  battery.
- **The tick.** The creature hears it up close. On Normal and Hard the first tick may make it go silent
  and still, so it vanishes from the screen, and then it comes to look where the tick came from. If you
  keep ticking at it, it works out where you are, and it can copy the tick. Difficulty also sets the
  tracker's reach, battery life, how many batteries there are, how much blips wobble and how long they
  last.

## Build and run

```sh
./build.sh          # tests, then dist/pinprick.html (phone/browser) and dist/artifact.html (claude.ai)
./build.sh apk      # also android/build/pinprick.apk (WebView wrapper, package app.pinprick)
./build.sh smoke    # also plays the build in headless Chromium, screenshots in .tmp/shots
npm test            # just the tests
```

Everything is plain ES modules bundled by esbuild into one HTML file of about 170 KB with the fonts
embedded, so it works offline. There is no framework and no runtime dependency.

On GitHub, `.github/workflows/pages.yml` runs the tests and the build on every pull request, and on
`main` publishes the game to GitHub Pages (https://opennerdz.github.io/pinprick/) once Pages is switched on
with "GitHub Actions" as its source.

Ready-built copies are checked in: `dist/pinprick.html` (open it in any browser), `dist/artifact.html`
(the claude.ai version) and `android/build/pinprick.apk`. Run `./build.sh` / `./build.sh apk` after a
change to refresh them. The APK is signed with a key that lives outside the repo
(`~/.android/pinprick.keystore`).

`docs/` holds the first single-file version of the game (`original-v1.html`), screenshots from the
smoke run (`screenshots/`, drawn on a 2D canvas, see Notes) and the development chat log.

## Layout

```
src/
  config.js        every tunable number: speeds, noise ranges, heat, difficulty presets
  main.js          app shell: screens, frame loop, title demo, hand-off to a level
  world/           level geometry, no game rules
    world.js       height grid + props + per-cell prop index; Actor (things that move)
    shapes.js      box / cylinder / sphere primitives
    raycast.js     DDA grid walk that only tests props in the cells it crosses
    collision.js   player circle vs walls and props (3x3 cells around you)
    nav.js         half-metre walkability grid, Dijkstra fields, paths, line-of-walk
    level.js       turns a level file into a World plus cores, doors, notes, triggers
  game/            the rules
    session.js     one play of one level: ties everything together, checkpoints, win/death
    player.js      walk, sprint on stamina, crouch, footsteps and their noise
    scanner.js     trigger, heat and overheat, sweep, dot colours; rays leave the gun's emitter
    viewmodel.js   how the gun sits in your hands: sway, lag, recoil, sprint, wall pull-back
    stalker.js     the creature: hearing by path distance, patrol/investigate/hunt/search/finale
    tracker.js     the motion tracker: battery, pulses, what moved, blips; hands.js raises and lowers it
    scares.js      scripted triggers: figure behind you, slams, moving statue, footsteps
    signal.js      the signal bars and ping; static when the creature is near
    figures.js     creature / figure / statue shapes
    decals.js      wall writing that shows up in dots
    ghosts.js      the previous operator's rust-coloured dots
  render/          WebGL: depth-only level mesh, live-range dot ring buffer, beams, the gun
    gunmesh.js     the scanner's geometry, built in code
    gun.js         its shader: key and rim light, emitter glow, glowing coils, fins and screen
    trackermesh.js, tracker.js   the motion tracker's geometry, and its screen drawn in the shader
    meshkit.js     box / cylinder / extrusion helpers both devices are built from
  audio/           Web Audio engine (buses, voice cap) and the synthesised sound vocabulary
  ui/              input (touch/mouse/keys -> intent), HUD, settings, haptics
  levels/          one file per level + index.js for the order
test/              node:test suites (no browser needed)
tools/             build.mjs, smoke.mjs
android/           WebView wrapper for the APK
```

## Adding a level

Copy a file in `src/levels/`, edit the ASCII map (`#` rock, `.` 3 m room, `:` 6 m hall, `,` 2.2 m
duct or doorway, `;` 1.6 m crawl only a crouching player fits through; one character is 2 m), then add
it to `src/levels/index.js` (with `batteries: {spots: [[x, z], [x, z, onTopOfThisHigh], ...]}` for the
tracker). `npm test` checks that every core, note, battery, hiding spot and the exit can be
reached on foot (also with every slammable door shut), that the exit pad can actually be stood on,
that wall writing sits on a real wall, and that the creature can walk its whole patrol route. A bot
then plays the level through the real game code, and `test/stalker.test.js` checks the creature stays
fair there (never walks into a still player, never camps a crawl, gives a careful finale run a chance).

## Notes

- Headless Chromium on Android loses its WebGL context on the first draw call of any kind (a single
  triangle in a ten-line test page does it too), so `tools/smoke.mjs` opens the game with
  `#debug-nopoints` and redraws the frame on a 2D canvas: the dots projected through the game's own
  camera, and the gun's real triangles through its real view-model matrix with the shader's lighting
  maths. Logic, HUD and screens in those screenshots are the real game; the final GPU pixels are not.
- On a desktop, `node tools/smoke.mjs /usr/bin/google-chrome` runs the same smoke test with any Chrome.
- Controls: on a computer the click that captures the mouse never fires the scanner, and where the page
  cannot capture it (some embedded viewers) dragging looks and Space scans. Crouch is C only, because
  Ctrl+W closes the tab. On touch, CROUCH sits beside SCAN so the thumbstick's corner stays free.
- Progress, settings and best times live in localStorage under `pinprick.v2.*`.
- Open the page with `#debug` for a `window.__pinprick` test hook.
