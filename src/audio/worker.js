// The sound bank's background renderer: one job at a time, so the bank can reorder what is left. A build
// inlines this as text (__SYNTH_WORKER__, see sounds.js), so the game stays one file; without it the
// bank renders on the page's own thread instead.
import {RECIPES} from './recipes.js';
import {renderVariant} from './bank.js';

self.onmessage = ({data: {name, i, sr}}) => {
  const ch = renderVariant(RECIPES[name], name, i, sr);
  self.postMessage({name, i, ch}, ch.map(c => c.buffer));
};
