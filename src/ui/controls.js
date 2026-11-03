// Every control, for every way of playing. ACTIONS says what each one does, once; a set only says how to do
// it. The Controls sheet draws a set as a map of the device beside a list, grouped by what you are trying to
// do. The pause and title sheets show the short list.

import {NOISE, DIFFICULTY} from '../config.js';

export const GROUPS = [['move', 'Move'], ['see', 'See'], ['survive', 'Survive'], ['game', 'Game']];

/** How far it hears you, as 0..4 bars, from the game's real numbers (metres of path). */
export const bars = m => (m <= 0 ? 0 : m <= 4 ? 1 : m <= 8 ? 2 : m <= 15 ? 3 : 4);

export const ACTIONS = {
  walk: {group: 'move', name: 'Walk', what: 'Every step can be heard.', hears: bars(NOISE.step)},
  sprint: {group: 'move', name: 'Sprint', what: 'Fast and loud. Leaves you panting.', hears: bars(NOISE.sprintStep)},
  crouch: {group: 'move', name: 'Crouch', what: 'Near silent. Fits crawls. Hides you in the dark.', hears: bars(NOISE.crouchStep)},
  look: {group: 'move', name: 'Look', what: 'Look around.', hears: 0},
  scan: {group: 'see', name: 'Scan', what: 'Paints the dark with dots. Its light stops the creature.', hears: bars(NOISE.scanMax)},
  sweep: {group: 'see', name: 'Sweep', what: 'One full picture of the room. Very loud.', hears: bars(NOISE.sweep)},
  track: {group: 'see', name: 'Tracker', what: 'Shows what moves, through rock. Uses battery.', hears: bars(DIFFICULTY.normal.trkNoise)},
  throw: {group: 'survive', name: 'Throw stone', what: 'It goes to where it lands. You only have a few.', hears: bars(NOISE.throw)},
  breath: {group: 'survive', name: 'Hold breath', what: 'Silent while it listens. Your lungs run out.', hears: 0},
  pause: {group: 'game', name: 'Pause'},
  sound: {group: 'game', name: 'Sound', what: 'On or off.'},
  menus: {group: 'game', name: 'Menus', what: 'D-pad or left stick moves. A chooses. B goes back.'},
};

// a binding: `|` between alternatives, spaces between keys pressed as one, `_` for a space on a cap,
// `hold ` in front when you keep it held. mouse: draws a mouse, pad: a round face button.
const SETS = {
  keys: {
    id: 'keys', label: 'Keyboard + mouse',
    binds: {walk: 'W A S D', sprint: 'hold Shift', crouch: 'C', look: 'mouse:Move', scan: 'hold mouse:Left | Space', sweep: 'F | E | mouse:Right', track: 'Q | mouse:Middle', throw: 'G', breath: 'hold B', pause: 'Esc | P', sound: 'M'},
    what: {look: 'Click the game first. Left and right arrows turn too.', walk: 'Every step can be heard. Up and down arrows too.'},
  },
  drag: { // where the page cannot capture the mouse (some embedded viewers)
    id: 'drag', label: 'Keyboard + mouse',
    binds: {walk: 'W A S D', sprint: 'hold Shift', crouch: 'C', look: 'mouse:Drag', scan: 'hold Space', sweep: 'F | E | mouse:Right', track: 'Q', throw: 'G', breath: 'hold B', pause: 'Esc | P', sound: 'M'},
    what: {look: 'Drag to look. The arrow keys walk and turn too.'},
  },
  pad: {
    id: 'pad', label: 'Controller',
    binds: {walk: 'L_stick', sprint: 'hold pad:A | Click_L_stick', crouch: 'pad:B | Click_R_stick', look: 'R_stick', scan: 'hold RT', sweep: 'LT | pad:X', track: 'pad:Y | D-pad_up', throw: 'RB', breath: 'hold LB', pause: 'Start', menus: 'D-pad'},
  },
  touch: {
    id: 'touch', label: 'Touch',
    binds: {walk: 'Thumb_stick', sprint: 'Push_past_ring', crouch: 'CROUCH', look: 'Drag', scan: 'hold SCAN', sweep: 'SWEEP', track: 'TRACK', throw: 'THROW', breath: 'hold BREATH', pause: 'Top_corner', sound: 'Top_corner'},
  },
};

const touchSet = lefty => {
  const walkSide = lefty ? 'right' : 'left', lookSide = lefty ? 'left' : 'right';
  return {...SETS.touch, what: {
    walk: `Touch anywhere on the ${walkSide} side. Every step can be heard.`,
    look: `Drag on the ${lookSide} side.`,
    scan: 'Paints the dark with dots. Drag to aim while you hold.',
  }};
};

/** Every way of playing there is: `pointer` is 'keys', or 'drag' where the mouse cannot be captured. */
export const controlSets = ({noLock = false, lefty = false} = {}) => [noLock ? SETS.drag : SETS.keys, SETS.pad, touchSet(lefty)];

/** One way of doing an action, as caps. */
function capHtml(token, set) {
  const text = s => s.replace(/_/g, ' ');
  if (token.startsWith('mouse:')) {
    const b = token.slice(6), label = {Left: 'Left click', Right: 'Right click', Middle: 'Middle click', Move: 'Move mouse', Drag: 'Drag'}[b];
    return `<kbd class="cap mouse" data-b="${b.toLowerCase()}"><svg viewBox="0 0 10 14" aria-hidden="true"><rect x=".5" y=".5" width="9" height="13" rx="4.5"/><path class="m-l" d="M5 .5A4.5 4.5 0 0 0 .5 5V6H5Z"/><path class="m-r" d="M5 .5A4.5 4.5 0 0 1 9.5 5V6H5Z"/><rect class="m-m" x="4" y="2" width="2" height="3" rx="1"/></svg>${label}</kbd>`;
  }
  if (token.startsWith('pad:')) return `<kbd class="cap round">${token.slice(4)}</kbd>`;
  return `<kbd class="cap${set === 'touch' ? ' pill' : ''}">${text(token)}</kbd>`;
}

/** A binding as caps, with "hold" and "or" where they apply. */
export function bindHtml(bind, set) {
  const hold = bind.startsWith('hold ');
  const ways = (hold ? bind.slice(5) : bind).split(' | ').map(way => way.split(' ').map(t => capHtml(t, set)).join(''));
  return (hold ? '<span class="cap-word">hold</span>' : '') + ways.join('<span class="cap-word">or</span>');
}

const whatFor = (set, act) => set.what?.[act] ?? ACTIONS[act].what ?? '';

const noiseHtml = n => `<span class="ctl-noise" data-n="${n}" title="How far it can hear this" role="img" aria-label="It hears this: ${n} of 4">${[1, 2, 3, 4].map(i => `<i class="${i <= n ? 'on' : ''}"></i>`).join('')}</span>`;

/** The grouped list for one set. */
function listHtml(set) {
  return GROUPS.map(([g, title]) => {
    const acts = Object.keys(ACTIONS).filter(a => ACTIONS[a].group === g && set.binds[a]);
    if (!acts.length) return '';
    const heard = g !== 'game';
    return `<section class="ctl-group" data-g="${g}"><header class="ctl-head"><h2>${title}</h2>${heard ? '<span>It hears</span>' : ''}</header>` + acts.map(a =>
      `<div class="ctl-row" data-act="${a}"><b>${ACTIONS[a].name}</b><span class="ctl-bind">${bindHtml(set.binds[a], set.id)}</span><span class="ctl-what">${whatFor(set, a)}</span>${heard ? noiseHtml(ACTIONS[a].hears) : ''}</div>`).join('') + '</section>';
  }).join('');
}

// ------------------------------------------------------------ the maps

const gOf = a => ACTIONS[a]?.group || '';

function keyboardMap(set) {
  const key = (label, act, sub, w = 1) => act
    ? `<span class="kk on" data-act="${act}" data-g="${gOf(act)}" style="--w:${w}"><em>${label}</em><small>${sub}</small></span>`
    : `<span class="kk" style="--w:${w}"><em>${label}</em></span>`;
  const rows = [
    [key('Esc', 'pause', 'Pause')],
    [key('Tab', null, '', 1.5), key('Q', 'track', 'Track'), key('W', 'walk', 'Ahead'), key('E', 'sweep', 'Sweep'), key('R'), key('T')],
    [key('Caps', null, '', 1.75), key('A', 'walk', 'Left'), key('S', 'walk', 'Back'), key('D', 'walk', 'Right'), key('F', 'sweep', 'Sweep'), key('G', 'throw', 'Stone')],
    [key('Shift', 'sprint', 'Sprint', 2.25), key('Z'), key('X'), key('C', 'crouch', 'Crouch'), key('V'), key('B', 'breath', 'Breath')],
    [key('Ctrl', null, '', 1.25), key('Alt', null, '', 1.25), key('Space', 'scan', 'Scan', 4.75)],
  ];
  const keys = set.id === 'keys';
  const leftAct = keys ? 'scan' : 'look';
  return `<figure class="ctl-map" aria-hidden="true"><div class="kb">${rows.map(r => `<div class="kb-row">${r.join('')}</div>`).join('')}</div>
    <svg class="map-svg mouse-map" viewBox="0 0 344 150" text-anchor="middle">
      <path class="dots-line" d="M172 22C146 22 130 40 130 68V112C130 132 148 146 172 146C196 146 214 132 214 112V68C214 40 198 22 172 22Z"/>
      <g data-act="${leftAct}" data-g="${gOf(leftAct)}" class="on"><path class="btn" d="M171 23C147 24 131 41 131 68V78H171Z"/><path class="lead" d="M131 56H100"/><text x="94" y="53" text-anchor="end">${keys ? 'SCAN' : 'LOOK'}</text><text class="sm" x="94" y="67" text-anchor="end">${keys ? 'hold left click' : 'drag'}</text></g>
      <g data-act="sweep" data-g="see" class="on"><path class="btn" d="M173 23C197 24 213 41 213 68V78H173Z"/><path class="lead" d="M213 56H244"/><text x="250" y="53" text-anchor="start">SWEEP</text><text class="sm" x="250" y="67" text-anchor="start">right click</text></g>
      ${keys ? '<g data-act="track" data-g="see" class="on"><rect class="btn" x="167" y="34" width="10" height="24" rx="5"/><path class="lead" d="M172 34V15"/><text x="172" y="10">TRACK <tspan class="dimmed">middle click</tspan></text></g>' : '<rect class="off" x="167" y="34" width="10" height="24" rx="5"/>'}
      ${keys ? '<g data-act="look" data-g="move" class="on"><text x="172" y="106">LOOK</text><text class="sm" x="172" y="120">move</text></g>' : ''}
    </svg></figure>`;
}

function padMap() {
  const tag = (x, y, anchor, btn, name, sub = '') => `<text x="${x}" y="${y}" text-anchor="${anchor}"><tspan class="dimmed">${btn} </tspan>${name}</text>`
    + (sub ? `<text class="sm" x="${x}" y="${y + 13}" text-anchor="${anchor}">${sub}</text>` : '');
  const call = (act, shape, line, label) => `<g data-act="${act}" data-g="${gOf(act)}" class="on">${shape}<path class="lead" d="${line}"/>${label}</g>`;
  return `<figure class="ctl-map" aria-hidden="true"><svg class="map-svg pad-map" viewBox="0 0 600 262" text-anchor="middle">
    <path class="dots-line" d="M215 66C185 66 165 72 155 104L122 216C112 256 150 270 176 242L222 196H378L424 242C450 270 488 256 478 216L445 104C435 72 415 66 385 66Z"/>
    <path class="off" d="M250 158h6v-10h8v10h6v8h-6v10h-8v-10h-6Z" transform="translate(-4 -6)"/>
    <rect class="off" x="270" y="92" width="16" height="9" rx="4.5"/>
    ${call('sweep', '<rect class="btn" x="182" y="16" width="44" height="20" rx="6"/>', 'M182 26H128', tag(122, 30, 'end', 'LT', 'SWEEP'))}
    ${call('breath', '<rect class="btn" x="176" y="42" width="56" height="16" rx="8"/>', 'M176 50H128', tag(122, 54, 'end', 'LB', 'HOLD BREATH'))}
    ${call('walk', '<circle class="btn" cx="222" cy="112" r="20"/><circle class="off" cx="222" cy="112" r="11"/>', 'M202 112H128', tag(122, 112, 'end', 'L STICK', 'WALK', 'click: sprint'))}
    ${call('track', '', 'M260 160V168L128 168', tag(122, 172, 'end', 'D-PAD', 'UP: TRACK', 'down: crouch'))}
    ${call('scan', '<rect class="btn" x="374" y="16" width="44" height="20" rx="6"/>', 'M418 26H472', tag(478, 30, 'start', 'RT', 'SCAN'))}
    ${call('throw', '<rect class="btn" x="368" y="42" width="56" height="16" rx="8"/>', 'M424 50H472', tag(478, 54, 'start', 'RB', 'THROW'))}
    ${call('sweep', '<circle class="btn" cx="360" cy="112" r="10"/><text x="360" y="116">X</text>', 'M360 102V78H472', tag(478, 82, 'start', 'X', 'SWEEP'))}
    ${call('track', '<circle class="btn" cx="382" cy="90" r="10"/><text x="382" y="94">Y</text>', 'M392 90L472 104', tag(478, 108, 'start', 'Y', 'TRACK'))}
    ${call('crouch', '<circle class="btn" cx="404" cy="112" r="10"/><text x="404" y="116">B</text>', 'M414 112L472 128', tag(478, 132, 'start', 'B', 'CROUCH'))}
    ${call('sprint', '<circle class="btn" cx="382" cy="134" r="10"/><text x="382" y="138">A</text>', 'M392 134L472 152', tag(478, 156, 'start', 'A', 'SPRINT'))}
    ${call('look', '<circle class="btn" cx="344" cy="162" r="20"/><circle class="off" cx="344" cy="162" r="11"/>', 'M360 174L472 190', tag(478, 194, 'start', 'R STICK', 'LOOK', 'click: crouch'))}
    ${call('pause', '<rect class="btn" x="314" y="92" width="16" height="9" rx="4.5"/>', 'M322 101V222', tag(322, 238, 'middle', 'START', 'PAUSE'))}
  </svg></figure>`;
}

/** The touch layout, placed as the pads really are (see .pad in styles.css). */
function touchMap(lefty, portrait) {
  const W = portrait ? 412 : 740, H = portrait ? 360 : 330, s = portrait ? 1 : 0.92;
  const pad = (r, b, size, label, act) => {
    const fromEdge = (16 + r + size / 2) * s, y = H - (b + size / 2) * s, x = lefty ? fromEdge : W - fromEdge;
    return `<g data-act="${act}" data-g="${gOf(act)}" class="on"><circle class="btn" cx="${x}" cy="${y}" r="${size / 2 * s}"/><text x="${x}" y="${y + 3.5}" class="pad-t">${label}</text></g>`;
  };
  const walkX = lefty ? W - 112 * s : 112 * s, walkY = H - 96 * s, midX = W / 2;
  const frame = portrait
    ? `M2 0V${H - 24}Q2 ${H - 2} 24 ${H - 2}H${W - 24}Q${W - 2} ${H - 2} ${W - 2} ${H - 24}V0`
    : `M24 2H${W - 24}Q${W - 2} 2 ${W - 2} 24V${H - 24}Q${W - 2} ${H - 2} ${W - 24} ${H - 2}H24Q2 ${H - 2} 2 ${H - 24}V24Q2 2 24 2Z`;
  const corner = portrait ? '' : `<g data-act="pause" data-g="game" class="on"><text class="sm" x="${lefty ? 16 : W - 16}" y="20" text-anchor="${lefty ? 'start' : 'end'}">top corner: pause, sound</text></g>`;
  return `<figure class="ctl-map" aria-hidden="true"><svg class="map-svg touch-map" viewBox="0 0 ${W} ${H}" text-anchor="middle">
    <path class="dots-line" d="${frame}"/>
    <path class="lead divide" d="M${midX} 12V${H - 12}"/>
    <g data-act="walk" data-g="move" class="on"><circle class="btn" cx="${walkX}" cy="${walkY}" r="${50 * s}"/><circle class="off" cx="${walkX}" cy="${walkY}" r="${20 * s}"/><text x="${walkX}" y="${walkY - 58 * s}">WALK</text></g>
    <g data-act="sprint" data-g="move" class="on"><text class="sm" x="${walkX}" y="${walkY + 68 * s}">past the ring: sprint</text></g>
    <g data-act="look" data-g="move" class="on"><text x="${lefty ? midX * 0.5 : midX * 1.5}" y="${portrait ? 26 : 44}">DRAG: LOOK</text></g>
    ${corner}
    ${pad(4, 24, 88, 'SCAN', 'scan')}${pad(16, 130, 64, 'SWEEP', 'sweep')}${pad(106, 37, 62, 'CROUCH', 'crouch')}${pad(100, 118, 56, 'TRACK', 'track')}${pad(20, 206, 56, 'THROW', 'throw')}${pad(100, 190, 56, 'BREATH', 'breath')}
  </svg></figure>`;
}

const mapFor = (set, lefty, portrait) => (set.id === 'pad' ? padMap() : set.id === 'touch' ? touchMap(lefty, portrait) : keyboardMap(set));

/** The sheet's tabs: the set you are playing with is marked. */
export function tabsHtml(sets, current, using) {
  return sets.map(s => `<button type="button" class="ctl-tab" role="tab" id="ctl-tab-${s.id}" data-tab="${s.id}" aria-selected="${s.id === current}">${s.label}${s.id === using ? '<i class="ctl-now">in use</i>' : ''}</button>`).join('');
}

/** Every set as a panel, only `current` showing. */
export function panelsHtml(sets, current, {lefty = false, portrait = false} = {}) {
  return sets.map(s => `<div class="ctl-panel" role="tabpanel" data-set="${s.id}"${s.id === current ? '' : ' hidden'}>${mapFor(s, lefty, portrait)}<div class="ctl-list">${listHtml(s)}</div></div>`).join('');
}

/** The short list for the pause and title sheets. */
export function shortHtml(set) {
  return Object.keys(ACTIONS).filter(a => set.binds[a] && a !== 'menus')
    .map(a => `<li style="display:contents"><b>${bindHtml(set.binds[a].split(' | ')[0], set.id)}</b><span>${ACTIONS[a].name}</span></li>`).join('');
}

/** Pointing at a row lights its keys on the map, and the other way round. Tapping does the same. */
export function linkControls(root) {
  const light = (act, panel) => {
    panel.querySelectorAll('.lit').forEach(el => el.classList.remove('lit'));
    if (act) panel.querySelectorAll(`[data-act="${act}"]`).forEach(el => el.classList.add('lit'));
  };
  const at = e => { const el = e.target.closest?.('[data-act]'); return {act: el?.dataset.act || null, panel: e.target.closest?.('.ctl-panel')}; };
  root.addEventListener('pointerover', e => { const {act, panel} = at(e); if (panel) light(act, panel); });
  root.addEventListener('pointerleave', () => root.querySelectorAll('.lit').forEach(el => el.classList.remove('lit')));
  root.addEventListener('click', e => { const {act, panel} = at(e); if (panel) light(act, panel); });
}
