// Fil d'analyse des MP3 (lib/spectrum.js) : un titre après l'autre, un résultat envoyé au serveur pour chacun.
import { parentPort, workerData } from 'node:worker_threads';
import { MPEGDecoder } from 'mpg123-decoder';
import { analyseMp3, verdict } from './spectrum.js';

// mpg123 signale chaque trame abîmée dans la console : inutile dans le journal du serveur
const err = console.error;
console.error = (...a) => { if (!String(a[0]).startsWith('mpg123-decoder')) err(...a); };

for (const { id, file, kbps } of workerData) {
  let result;
  const decoder = new MPEGDecoder(); // un par fichier : reset() de mpg123-decoder boucle sans fin
  try {
    await decoder.ready;
    const m = await analyseMp3(file, decoder);
    result = { cut: m.cut, drop: m.drop, verdict: m.silent ? null : verdict(kbps, m) };
  } catch (e) { result = { error: e.message }; } finally { decoder.free(); }
  parentPort.postMessage({ id, result });
}
