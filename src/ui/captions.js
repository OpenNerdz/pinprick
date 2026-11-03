// Sounds as words, for a player who cannot hear them. The game is led by sound, so these are its
// warnings: "[clicking, behind you, close]". sounds.js reports each sound with the level it is playing
// at, and only what you could really hear gets a line: rock dulls a sound and distance fades it.
// Lines are rate-limited by family; a repeat while a line is up refreshes that line in place.

const MIN_LEVEL = 0.01;        // loudness (after distance, and allowing for rock) you can make out
const ROCK = 0.75;             // how much fully muffled rock takes off that loudness
const MUFFLED_AT = 0.35;       // and from here on it sounds muffled
const LIFE = 2.8;              // seconds a line stays up
const MAX_LINES = 3;

// text; family shares a rate limit; gap is the seconds between new lines; pri decides who gets the
// screen when it is full; tone colours the line; inside means it has no place in the world
const KINDS = {
  clicks: {text: 'clicking', family: 'clicks', gap: 2, pri: 3, tone: 'danger'},
  quickclicks: {text: 'quick clicks', family: 'clicks', gap: 2, pri: 3, tone: 'danger'},
  shriek: {text: 'shriek', family: 'shriek', gap: 2, pri: 3, tone: 'danger'},
  pain: {text: 'pained shriek', family: 'shriek', gap: 2, pri: 3, tone: 'danger'},
  exhale: {text: 'breath let out', gap: 4, pri: 3, tone: 'danger'},
  chitter: {text: 'chittering', gap: 4, pri: 3, tone: 'danger'},
  sniff: {text: 'sniffing', gap: 4, pri: 3, tone: 'danger'},
  doubled: {text: 'footsteps doubled', gap: 4, pri: 3, tone: 'danger', bare: true},
  gallop: {text: 'claws, running', family: 'steps', gap: 2.5, pri: 3, tone: 'danger'},
  steps: {text: 'footsteps', family: 'steps', gap: 3.5, pri: 2},
  stomp: {text: 'heavy footfalls', family: 'steps', gap: 3.5, pri: 2},
  groan: {text: 'groan', gap: 5, pri: 2},
  breath: {text: 'rattling breath', gap: 7, pri: 2},
  whisper: {text: 'whispering', gap: 5, pri: 2},
  slam: {text: 'door slams', gap: 3, pri: 2},
  stone: {text: 'stone clatters', gap: 1.5, pri: 2},
  mimic: {text: 'your own sound, wrong', gap: 6, pri: 2},
  sting: {text: 'metal shrieking', gap: 5, pri: 2, inside: true},
  gasp: {text: 'you gasp out loud', gap: 3, pri: 3, inside: true, tone: 'danger'},
  pant: {text: 'you are panting', gap: 8, pri: 1, inside: true},
  pump: {text: 'pump running', family: 'pump', gap: 3, pri: 2, inside: true},
  pumpstop: {text: 'pump stops', family: 'pump', gap: 3, pri: 3, inside: true, tone: 'danger'},
  heart: {text: 'your heart pounding', gap: 12, pri: 1, inside: true},
  door: {text: 'heavy door opens', gap: 3, pri: 1, inside: true},
  tracker: {text: 'tracker screaming', gap: 5, pri: 2, inside: true},
  bell: {text: 'bell: a core in the beam', gap: 6, pri: 1, inside: true, tone: 'core'},
  ping: {text: 'signal ping', family: 'ping', gap: 5, pri: 0, inside: true, device: true},
  exitping: {text: 'exit signal', family: 'ping', gap: 5, pri: 0, inside: true, device: true},
  // the tunnels themselves, which is to say probably nothing
  drip: {text: 'drip', family: 'tunnel', gap: 8, pri: 0, tone: 'dim'},
  buzz: {text: 'something buzzing', family: 'tunnel', gap: 8, pri: 0, tone: 'dim'},
  knock: {text: 'knock', family: 'tunnel', gap: 8, pri: 0, tone: 'dim'},
  creak: {text: 'steel creaks', family: 'tunnel', gap: 8, pri: 0, tone: 'dim'},
  debris: {text: 'stones falling', family: 'tunnel', gap: 8, pri: 0, tone: 'dim'},
  wind: {text: 'air moving', family: 'tunnel', gap: 8, pri: 0, tone: 'dim'},
  thud: {text: 'heavy thud', family: 'tunnel', gap: 8, pri: 0, tone: 'dim'},
};

const MIMIC = {trigger: 'your trigger, wrong', ping: 'signal ping, wrong', chime: 'core chime, wrong', tracker: 'tracker tick, wrong', steps: 'your footsteps, wrong'};

/** Rough direction from pan (+right) and front (+ahead), as sine and cosine of the bearing. */
export function direction(pan, front) {
  const a = Math.atan2(pan, front) * 180 / Math.PI, abs = Math.abs(a);
  if (abs < 40) return 'ahead';
  if (abs > 140) return 'behind you';
  return a > 0 ? 'right' : 'left';
}

/** "behind you, close", "far left", or just "left" at middling range. */
export function whereWords(place) {
  const dir = direction(place.pan, place.front), d = place.dist;
  if (d >= 20) return 'far ' + dir;
  if (d < 3) return dir + ', very close';
  if (d < 8) return dir + ', close';
  return dir;
}

/** Could you make this out at all? Sounds in your hands and your head always reach you. */
export function audible(kind, level, muffle = 0) {
  const k = KINDS[kind];
  if (k && (k.inside || k.device)) return true;
  return (level ?? 1) * (1 - ROCK * (muffle || 0)) >= MIN_LEVEL;
}

/** The whole line. `place` is {pan, front, dist} from engine.place(), or null for no direction. */
export function captionText(kind, place, muffle = 0, detail) {
  const k = KINDS[kind] || {text: String(kind)};
  let what = kind === 'mimic' ? MIMIC[detail] || MIMIC.steps : k.text;
  if (muffle >= MUFFLED_AT) what = 'muffled ' + what;
  if (k.device) return `[${what}${sideWords(place)}]`;
  if (!place || k.inside) return `[${what}]`;
  // doubled footsteps are about you, so they do not say how far, only which way to turn
  const where = k.bare ? direction(place.pan, place.front) : whereWords(place);
  return `[${what}, ${where}]`;
}

function sideWords(place) {
  const pan = place?.pan;
  if (!Number.isFinite(pan)) return '';
  return Math.abs(pan) < 0.3 ? ', centred' : pan < 0 ? ', left' : ', right';
}

/** The rate limits and the lines on screen, with no DOM, in seconds of whatever clock you pass. */
export class CaptionLog {
  constructor() {
    this.lines = [];
    this.last = Object.create(null);
    this.version = 0;
  }

  hear(kind, place, level, muffle, detail, now) {
    if (!audible(kind, level, muffle)) return false;
    const k = KINDS[kind] || {gap: 3, pri: 1};
    const family = k.family || kind, text = captionText(kind, place, muffle, detail);
    const up = this.lines.find(l => l.family === family);
    const since = now - (this.last[family] ?? -Infinity);
    if (since < (k.gap ?? 3)) {
      // too soon for a new line, but a continuing sound keeps its line up to date
      if (up && k.pri > 0) {
        if (up.text !== text) { up.text = text; up.tone = k.tone || ''; this.version++; }
        up.until = now + LIFE;
      }
      return false;
    }
    this.last[family] = now;
    if (up) {
      up.text = text; up.tone = k.tone || ''; up.until = now + LIFE; up.pri = k.pri ?? 1;
      this.version++;
      return true;
    }
    if (this.lines.length >= MAX_LINES) {
      let low = 0;
      this.lines.forEach((l, i) => { if (l.pri < this.lines[low].pri) low = i; });
      if (this.lines[low].pri > (k.pri ?? 1)) return false;
      this.lines.splice(low, 1);
    }
    this.lines.push({family, text, tone: k.tone || '', pri: k.pri ?? 1, until: now + LIFE});
    this.version++;
    return true;
  }

  tick(now) {
    const n = this.lines.length;
    this.lines = this.lines.filter(l => l.until > now);
    if (this.lines.length !== n) this.version++;
  }

  clear() {
    if (this.lines.length) this.version++;
    this.lines = [];
  }
}

/** The log drawn into a list element. Silent unless both the setting is on and a level is in play. */
export class Captions {
  constructor(el) {
    this.el = el;
    this.log = new CaptionLog();
    this.enabled = false;
    this.drawn = -1;
  }

  /** The signature sounds.js calls. */
  hear = (kind, place, level, muffle, detail) => {
    if (this.enabled) this.log.hear(kind, place, level, muffle, detail, performance.now() / 1000);
  };

  tick() {
    this.log.tick(performance.now() / 1000);
    if (this.drawn === this.log.version) return;
    this.drawn = this.log.version;
    this.el.textContent = '';
    for (const l of this.log.lines) {
      const li = document.createElement('li');
      li.textContent = l.text;
      if (l.tone) li.className = l.tone;
      this.el.append(li);
    }
  }

  clear() { this.log.clear(); this.tick(); }
}
