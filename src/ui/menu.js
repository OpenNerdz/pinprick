// Moving through a sheet without a pointer, for controllers and arrow keys. A sheet reads as rows: the
// buttons of one `.seg`, `.actions` or `.ctl-tabs` block are a row, anything else is a row by itself. Up and down
// change row, left and right move along one or adjust a slider.

export function menuRows(sheet) {
  const rows = [], groups = new Map();
  for (const el of sheet.querySelectorAll('button,input')) {
    if (el.disabled || el.hidden || !el.getClientRects().length) continue;
    const group = el.closest('.seg,.actions,.ctl-tabs');
    if (!group) { rows.push([el]); continue; }
    if (!groups.has(group)) { groups.set(group, []); rows.push(groups.get(group)); }
    groups.get(group).push(el);
  }
  return rows;
}

/** The button a sheet is mostly asking you to press. */
export function primaryOf(sheet) {
  for (const el of sheet.querySelectorAll('.cta')) if (!el.disabled && !el.hidden && el.getClientRects().length) return el;
  return menuRows(sheet)[0]?.[0] || null;
}

function focus(el) {
  if (!el) return;
  el.focus({preventScroll: true});
  el.scrollIntoView({block: 'nearest'});
}

export const focusPrimary = sheet => focus(primaryOf(sheet));

/** Move the focus in `dir` (up, down, left, right). Returns true if it did something. */
export function menuMove(sheet, dir) {
  const rows = menuRows(sheet), cur = document.activeElement;
  if (!rows.length) return false;
  const r = rows.findIndex(row => row.includes(cur));
  if (r < 0) { focusPrimary(sheet); return true; }
  const row = rows[r], c = row.indexOf(cur);
  if (dir === 'left' || dir === 'right') {
    const d = dir === 'left' ? -1 : 1;
    if (cur.type === 'range') {
      if (d < 0) cur.stepDown(); else cur.stepUp();
      cur.dispatchEvent(new Event('input', {bubbles: true}));
      return true;
    }
    if (row.length < 2) return false;
    const next = row[(c + d + row.length) % row.length];
    focus(next);
    if (next.getAttribute('role') === 'radio') next.click(); // a choice of one: moving is choosing
    return true;
  }
  const next = rows[(r + (dir === 'up' ? -1 : 1) + rows.length) % rows.length];
  focus(next.find(el => el.getAttribute('aria-checked') === 'true') || next[0]);
  return true;
}

/** Press whatever has the focus, or just show where the focus is if nothing does. */
export function menuAccept(sheet) {
  const cur = document.activeElement;
  if (!sheet.contains(cur) || cur === sheet) { focusPrimary(sheet); return; }
  if (cur.type !== 'range') cur.click();
}
