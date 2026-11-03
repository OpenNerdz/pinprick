// One worker thread: plays the runs it is sent, one at a time.
import {parentPort, workerData} from 'node:worker_threads';
import {loadGame, playRun} from './run.mjs';

const game = await loadGame(workerData.src);
parentPort.on('message', task => {
  try {
    const r = playRun(game, task, workerData.opts);
    parentPort.postMessage({...r, level: task.level, diff: task.diff, persona: task.persona, seed: task.seed});
  } catch (e) {
    parentPort.postMessage({error: String(e && e.stack || e), level: task.level, diff: task.diff, persona: task.persona, seed: task.seed});
  }
});
parentPort.postMessage({ready: true});
