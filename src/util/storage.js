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
