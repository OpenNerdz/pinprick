// The fairness gate: everything a bot may know passes through here. The session sits in a private field,
// so bot code cannot reach the creature; it gets what a person at the controls gets.
//   sounds   only what the game actually plays (the stubbed sound API is the tap), and only when loud
//            enough over the tunnels and your own noise, with a human error on bearing and distance,
//            after a reaction delay
//   sight    dots the real scanner lands: which ground is lit, and the creature only while a ray is on it;
//            the red of its echo only when in view; batteries only once lit
//   devices  the tracker's blips only while it is up and on; HUD static and the heart, coarsely
//   signal   the meter's ping, when the game plays one: which way the nearest core lies, roughly, and its bars
//   memory   the map's layout and the exit, like someone who has played the level before. Not which spots
//            this seed put the cores in (a core is known only once a ray lands on it), nor the creature.

const TAU = Math.PI * 2;
export const AUDIBLE = 0.012;        // effective gain below which a creature sound is lost in the hum
const BREATH_AUDIBLE = 0.05;         // its breath: the game's own level, distance already counted
const SAY_DELAY = 0.4;               // reading a line on screen
// Creature sounds are recognised by name below; add a new one there or the bots stay deaf to it.
const noop = () => {};

const angleDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU; return d; };

/** Effective loudness of a creature sound: the game's falloff, dulled by rock. */
export const loudness = (base, dist, muffle) => base / (1 + dist / 4) * (1 - 0.55 * muffle);

/** session.stones / session.lungs may be a number, a list or a small object, or absent: a number or null. */
function amount(v) {
  if (typeof v === 'number') return v;
  if (Array.isArray(v)) return v.length;
  if (v && typeof v === 'object') for (const k of ['count', 'n', 'left', 'held', 'level', 'air', 'value']) if (typeof v[k] === 'number') return v[k];
  return null;
}

/** The stubs the session runs on: no rendering, no audio, but every sound and dot reaches `tap`. */
export function makeStubs(tap) {
  const e = {listener: {x: 0, z: 0, yaw: 0}, now: 0,
    place(x, z) { const L = this.listener, dx = x - L.x, dz = z - L.z, d = Math.hypot(dx, dz) || 0.001; return {pan: (dx * Math.cos(L.yaw) + dz * Math.sin(L.yaw)) / d, dist: d, front: (dx * Math.sin(L.yaw) - dz * Math.cos(L.yaw)) / d}; }};
  const voiced = {e,
    clicks(x, z, muffle = 0, intense = false) { tap.sound(intense === 'short' ? 'clickShort' : 'click', x, z, muffle, intense ? 0.1 : 0.07); },
    creatureStep(x, z, muffle = 0, heavy = 1) { tap.sound('step', x, z, muffle, 0.17 * heavy); },
    gallop(x, z, muffle = 0) { tap.sound('gallop', x, z, muffle, 0.09); },
    groan(x, z, muffle = 0) { tap.sound('groan', x, z, muffle, 0.085); },
    shriek(x, z, muffle = 0, gain = 0.16) { const pain = gain < 0.09; tap.sound(pain ? 'pain' : 'shriek', x, z, muffle, gain * (pain ? 2.5 : 1.6)); },
    exhale(x, z) { tap.sound('exhale', x, z, 0, 0.09); },
    chitter(x, z, muffle = 0) { tap.sound('chitter', x, z, muffle, 0.085); },
    sniff(x, z, muffle = 0) { tap.sound('sniff', x, z, muffle, 0.07); },
    stomp(x, z, muffle = 0) { tap.sound('stomp', x, z, muffle, 0.34); },
    mimic(kind, x, z, muffle = 0) { tap.sound('mimic', x, z, muffle, 0.07); },
    setBreath(level, x, z, muffle = 0) { tap.breath(level, x, z, muffle); },
    heart(dt, fear) { tap.fear = fear; },
    step(kind) { tap.ownStep(kind); },
    sting() { tap.sting(); },
    ping(isExit) { tap.ping(isExit); },
  };
  const sounds = new Proxy(voiced, {get: (t, k) => (k in t ? t[k] : noop)});
  const dots = {total: 0, push(x, y, z, t, r, g, b) { this.total++; tap.dot(x, y, z, t, r, g, b); }, clear() { tap.dotsCleared(); }};
  const renderer = {setDots: () => dots, setGhosts: noop, setLevelMesh: noop, setActors: noop, addLine: noop, addFan: noop};
  const ui = {say: t => tap.say(t), note: noop, caught: () => { tap.caughtShown = true; }, won: noop, cores: noop};
  return {sounds, renderer, ui};
}

/** Geometry a returning player remembers. No creature in here. */
class MapView {
  #s; #lit; #w;
  constructor(session) {
    this.#s = session;
    this.#w = session.world.w;
    this.#lit = new Float32Array(session.world.w * session.world.h).fill(-1e9);
    const nav = session.playerNav, creature = session.nav;
    this.res = nav.res;
    this.exit = {x: session.exit.x, z: session.exit.z};
    this.hides = session.L.hides.map(h => ({x: h.x, z: h.z, r: h.r}));
    // a thin sprinkling of places to run to; `crawl` ones are too low for the creature to follow
    this.anchors = [];
    for (let z = 1; z < session.world.h * 2; z += 4) for (let x = 1; x < session.world.w * 2; x += 4) {
      const i = nav.nearest(x, z, 1.4);
      if (i >= 0) this.anchors.push({x: nav.cx(i), z: nav.cz(i), crawl: !creature.walkableAt(nav.cx(i), nav.cz(i))});
    }
  }
  get version() { return this.#s.world.version; }
  field(x, z, out) { return this.#s.playerNav.field(x, z, out); }
  dist(field, x, z) { return this.#s.playerNav.distAt(field, x, z, 2); }
  lineClear(x0, z0, x1, z1) { return this.#s.playerNav.lineClear(x0, z0, x1, z1); }
  walkable(x, z) { return this.#s.playerNav.walkableAt(x, z); }
  ceiling(x, z) { return this.#s.world.heightAt(x, z); }
  creatureFits(x, z) { return this.#s.nav.walkableAt(x, z); }
  cx(i) { return this.#s.playerNav.cx(i); }
  cz(i) { return this.#s.playerNav.cz(i); }
  /** Up to `n` cells downhill from (x, z) along `field` (a field rooted at where you are going). */
  descend(field, x, z, n, out) {
    const nav = this.#s.playerNav, {nw, nh, walk} = nav;
    out.length = 0;
    let cur = nav.nearest(x, z, 2);
    if (cur < 0 || !isFinite(field[cur])) return false;
    for (let k = 0; k < n && field[cur] > 0; k++) {
      const ix = cur % nw, iz = (cur - ix) / nw;
      let next = -1, nd = field[cur];
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const jx = ix + dx, jz = iz + dz;
        if (jx < 0 || jz < 0 || jx >= nw || jz >= nh) continue;
        const j = jz * nw + jx;
        if (!walk[j] || field[j] >= nd) continue;
        if (dx && dz && (!walk[iz * nw + jx] || !walk[jz * nw + ix])) continue;
        nd = field[j]; next = j;
      }
      if (next < 0) break;
      cur = next; out.push(cur);
    }
    return true;
  }
  /** Seconds since a scanner ray last crossed this spot. Infinity if never. */
  litAge(x, z, T) { const t = this.#lit[this.#cell(x, z)]; return t === undefined || t < -1e8 ? Infinity : T - t; }
  #cell(x, z) { return Math.floor(z / 2) * this.#w + Math.floor(x / 2); }
  /** The scanner lit a dot at (x, z) from (ex, ez): the air between is known open too. */
  light(ex, ez, x, z, T) {
    const d = Math.hypot(x - ex, z - ez), n = Math.min(24, Math.ceil(d));
    for (let i = 0; i <= n; i++) { const k = n ? i / n : 1, c = this.#cell(ex + (x - ex) * k, ez + (z - ez) * k); if (c >= 0 && c < this.#lit.length) this.#lit[c] = T; }
  }
  forgetLight() { this.#lit.fill(-1e9); }
}

export class Perception {
  #s = null; #rand; #pending = []; #prevHits = 0; #batterySeen = new Set(); #coreSeen = new Set(); #T = 0; #echo = null; #ownStepAt = -99; #dotN = 0; #breathNext = 0;
  constructor(rand, {reaction = 0.25} = {}) {
    this.#rand = rand;
    this.reaction = reaction;
    this.map = null;
    this.me = {};                      // you: everything on your own body and HUD
    this.tracker = {owned: false, want: false, up: false, battery: 0, blips: [], behindL: 0, behindR: 0, flood: 0};
    this.heard = [];                   // creature sounds reaching you this frame: {kind, t, x, z, dist, bearing, muffled}
    this.says = [];                    // lines shown on screen this frame
    this.lit = null;                   // where the beam is on it right now: {t, x, z}
    this.echo = null;                  // red dots in view: {t, x, z, n}
    this.batteries = [];               // batteries you have seen and not taken: {x, z}
    this.cores = [];                   // cores a ray has landed on and you have not taken: {x, z}
    this.signal = null;                // the last ping heard: {t, bearing, bars, exit}
    this.warnT = -99;                  // when it last gave any warning at all (for the metrics, not persona-dependent)
    const self = this;
    this.input = {                     // what the stubs call
      fear: 0, caughtShown: false,
      sound(kind, x, z, muffle, base) { self.#sound(kind, x, z, muffle, base); },
      breath(level, x, z, muffle) { self.#breath(level, x, z, muffle); },
      ownStep() { self.#ownStepAt = self.#T; },
      sting() { self.#pending.push({at: self.#T + self.reaction, kind: 'sting', t: self.#T, x: NaN, z: NaN, dist: Infinity, bearing: 0, muffled: false}); },
      say(text) { self.#pending.push({at: self.#T + SAY_DELAY, say: text}); },
      ping(isExit) { self.#ping(isExit); },
      dot(x, y, z, t, r, g, b) { self.#dot(x, y, z, t, r, g, b); },
      dotsCleared() { self.map?.forgetLight(); },
    };
  }

  attach(session) { this.#s = session; this.map = new MapView(session); this.refresh(0, 0); }

  #gaussian() { const u = Math.max(1e-9, this.#rand()), v = this.#rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v); }

  #sound(kind, x, z, muffle, base) {
    const s = this.#s;
    if (!s || !isFinite(x)) return;
    const p = s.player, T = this.#T, d = Math.hypot(x - p.x, z - p.z), g = loudness(base, d, muffle);
    if (g >= AUDIBLE) this.warnT = T;
    // your own noise covers it: boots, sprinting, the scanner's hum
    const mask = 1 + (p.sprinting ? 1 : p.moveAmt > 0.15 && !p.crouched ? 0.35 : 0) + (s.scanner.firing ? 0.6 : 0);
    if (g < AUDIBLE * mask) return;
    const b = Math.atan2(x - p.x, -(z - p.z)) + this.#gaussian() * (10 + 30 * muffle) * Math.PI / 180;
    const de = d * Math.exp(this.#gaussian() * (0.2 + 0.25 * muffle));
    this.#pending.push({at: T + this.reaction, kind, t: T, x: p.x + Math.sin(b) * de, z: p.z - Math.cos(b) * de, dist: de, bearing: b, muffled: muffle > 0.3, afterOwnStep: T - this.#ownStepAt});
  }

  /** The signal meter pinged: left or right of you, and how many bars. A person turns until it sits ahead. */
  #ping(isExit) {
    const s = this.#s, p = s?.player;
    if (!p) return;
    let tx = s.exit.x, tz = s.exit.z, best = Infinity;
    if (!isExit) for (const c of s.cores) { if (c.got) continue; const d = Math.hypot(p.x - c.x, p.z - c.z); if (d < best) { best = d; tx = c.x; tz = c.z; } }
    this.#pending.push({at: this.#T + this.reaction, ping: {t: this.#T, exit: !!isExit, bars: s.signal.bars,
      bearing: Math.atan2(tx - p.x, -(tz - p.z)) + this.#gaussian() * 18 * Math.PI / 180}});
  }

  #breath(level, x, z, muffle) {
    if (level < BREATH_AUDIBLE || this.#T < this.#breathNext) return;
    this.#breathNext = this.#T + 0.5; // a breath at a time
    this.#sound('breath', x, z, muffle, 0.6); // base high: the level test above has already judged it audible
  }

  #dot(x, y, z, t, r, g, b) {
    const s = this.#s;
    if (!s) return;
    const p = s.player;
    // the creature's echo: this exact red, on the walls around it
    if (r > 0.2 && Math.abs(g / r - 0.12) < 0.004 && Math.abs(b / r - 0.08) < 0.004) {
      if ((this.#dotN++ & 15) || Math.hypot(x - p.x, z - p.z) > 20) return;
      const rel = angleDiff(p.yaw, Math.atan2(x - p.x, -(z - p.z)));
      if (Math.abs(rel) > 1.05) return;                                 // out of your view
      const k = Math.max(0, 1 - 0.75 / Math.max(0.75, Math.hypot(x - p.x, z - p.z)));
      if (!s.playerNav.lineClear(p.x, p.z, p.x + (x - p.x) * k, p.z + (z - p.z) * k)) return; // behind rock
      const e = this.#echo || (this.#echo = {t, x: 0, z: 0, n: 0});
      e.x += x; e.z += z; e.n++;
      return;
    }
    // a ray landed on a core or a battery: you see its colour
    for (const c of s.cores) if (!c.got && Math.abs(y - 1.2) < 0.4 && Math.hypot(c.x - x, c.z - z) < 0.4) this.#coreSeen.add(c);
    for (const q of s.batteries) if (!q.taken && Math.hypot(q.x - x, q.z - z) < 0.3) this.#batterySeen.add(q);
    if (!(this.#dotN++ & 1)) this.map?.light(p.x, p.z, x, z, this.#T);
  }

  /** Read the world for this frame, through the gate. Call before asking the bot for its intent. */
  refresh(T, dt) {
    const s = this.#s, p = s.player, sc = s.scanner, tr = s.tracker, me = this.me, st = s.stalker;
    this.#T = T;
    me.x = p.x; me.z = p.z; me.yaw = p.yaw; me.pitch = p.pitch; me.eye = p.eye;
    me.crouched = p.crouched; me.still = p.still; me.stamina = p.stamina; me.winded = p.winded; me.sprinting = p.sprinting;
    me.hidden = p.hidden; me.quiet = p.quiet;
    me.heat = sc.heat; me.overheated = sc.overheated; me.firing = sc.firing; me.sweepReady = sc.cooldown <= 0 && !sc.sweeping;
    me.coresLeft = s.coresLeft; me.coresGot = s.coresGot;
    me.dotLife = s.diff.dotLife;
    me.static = !!s.signal.static;
    me.fear = Math.round((this.input.fear || 0) * 4) / 4; // your heart, coarsely
    me.redFlash = s.fx.ping > 0.9;
    me.stones = amount(s.stones);
    me.lungs = amount(s.lungs);

    // what has reached you by now
    this.heard.length = 0; this.says.length = 0;
    const q = this.#pending;
    for (let i = 0; i < q.length;) {
      const e = q[i];
      if (e.at > T) { i++; continue; }
      q.splice(i, 1);
      if (e.say) this.says.push(e.say); else if (e.ping) this.signal = e.ping; else this.heard.push(e);
    }

    // the beam on its body: dots land on it, so you see where it is
    this.lit = null;
    const hits = st?.actor?.hits ?? 0;
    if (st && hits > this.#prevHits) { this.lit = {t: T, x: st.x, z: st.z}; this.warnT = T; }
    this.#prevHits = hits;

    this.echo = null;
    if (this.#echo) { const e = this.#echo; this.#echo = null; if (T - e.t < 0.2) this.echo = {t: e.t, x: e.x / e.n, z: e.z / e.n, n: e.n}; }

    // the tracker: nothing on the screen unless it is up, on, and the blip is in the fan ahead
    const t = this.tracker;
    t.owned = !!tr?.owned; t.battery = tr?.battery ?? 0; t.want = s.hands.want === 'tracker';
    t.up = !!(tr && s.hands.trackerUp && tr.on);
    t.blips.length = 0; t.behindL = t.behindR = t.flood = 0;
    if (t.up) {
      for (const b of tr.blips) if (Math.abs(angleDiff(p.yaw, Math.atan2(b.x - p.x, -(b.z - p.z)))) <= Math.PI / 2) { t.blips.push({x: b.x, z: b.z, t: b.t}); if (T - b.t < 0.1) this.warnT = T; }
      t.behindL = tr.behindL; t.behindR = tr.behindR; t.flood = tr.flood;
    }

    this.batteries.length = 0;
    for (const b of this.#batterySeen) if (!b.taken) this.batteries.push({x: b.x, z: b.z});
    this.cores.length = 0;
    for (const c of this.#coreSeen) if (!c.got) this.cores.push({x: c.x, z: c.z});
  }

  /** Back at the checkpoint: nothing still in flight. Your memory of the map stays. */
  reset() { this.#pending.length = 0; this.#echo = null; this.heard.length = 0; this.says.length = 0; this.input.fear = 0; this.#prevHits = this.#s.stalker?.actor?.hits ?? 0; }
}
