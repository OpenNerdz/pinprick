// Phone vibration. Silently does nothing where the API is missing or blocked (desktop, the artifact
// viewer); the Android app build grants it.

let enabled = true;
let lastAt = 0;

export function setHaptics(on) { enabled = on; }

export function buzz(pattern, minGapMs = 0) {
  if (!enabled || !navigator.vibrate) return;
  const now = performance.now();
  if (now - lastAt < minGapMs) return;
  lastAt = now;
  try { navigator.vibrate(pattern); } catch (e) { /* blocked */ }
}
