// Phone vibration and controller rumble. Silently does nothing where the API is missing or blocked
// (desktop, the artifact viewer); the Android app build grants it.

let enabled = true;
let lastAt = 0;
let rumblePad = () => null; // the controller in use, if any

export function setHaptics(on) { enabled = on; }
export function setRumbleSource(fn) { rumblePad = fn; }

export function buzz(pattern, minGapMs = 0) {
  if (!enabled || typeof navigator === 'undefined') return;
  const now = performance.now();
  if (now - lastAt < minGapMs) return;
  lastAt = now;
  const act = rumblePad()?.vibrationActuator;
  if (act?.playEffect) {
    const ms = Array.isArray(pattern) ? pattern.reduce((a, b) => a + b, 0) : pattern;
    try { act.playEffect('dual-rumble', {duration: Math.min(600, ms), strongMagnitude: 0.5, weakMagnitude: 0.4})?.catch?.(() => {}); } catch (e) { /* blocked */ }
    return;
  }
  if (!navigator.vibrate) return;
  try { navigator.vibrate(pattern); } catch (e) { /* blocked */ }
}
