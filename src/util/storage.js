// localStorage wrapper. Storage can be missing or throw (private windows, previews, cleared data),
// so every call falls back to in-memory values and the game runs the same without it.

const PREFIX = 'pinprick.v2.';
const memory = new Map();

export function load(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw != null) return {...fallback, ...JSON.parse(raw)};
  } catch (e) { /* fall through */ }
  return memory.has(key) ? {...fallback, ...memory.get(key)} : {...fallback};
}

export function save(key, value) {
  memory.set(key, value);
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch (e) { /* memory only */ }
}

/** Whether anything is stored under `key`, in storage or in the in-memory fallback. */
export function has(key) {
  if (memory.has(key)) return true;
  try { return localStorage.getItem(PREFIX + key) != null; } catch (e) { return false; }
}

/** Remove `key` for good. */
export function forget(key) {
  memory.delete(key);
  try { localStorage.removeItem(PREFIX + key); } catch (e) { /* nothing stored, then */ }
}
