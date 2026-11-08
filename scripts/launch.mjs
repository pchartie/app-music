// Lanceur d'App Music (macOS, Linux, Windows) : démarre le serveur s'il ne tourne pas, le redémarre s'il est plus
// ancien que son code (mise à jour par git pull…), puis ouvre l'interface dans le navigateur par défaut.
// npm run app ; --restart : redémarre le serveur dans tous les cas.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isStale } from './server-stale.mjs';
import { openUrl } from '../lib/system.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 4321);
const URL = `http://localhost:${PORT}`; // toujours la même adresse : le navigateur y garde la file d'attente et les réglages
const CACHE = process.env.APPMUSIC_CACHE || path.join(ROOT, 'cache');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function status() {
  try { return await (await fetch(`http://127.0.0.1:${PORT}/api/status`, { signal: AbortSignal.timeout(3000) })).json(); } catch { return null; }
}
async function until(cond, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (await cond()) return true;
  return false;
}

async function stop(st) {
  let pids = st.pid ? [st.pid] : [];
  // serveur d'avant cette version (pas de pid dans /api/status) : on le retrouve par son port
  if (!pids.length && process.platform !== 'win32') {
    try { pids = execFileSync('lsof', ['-tiTCP:' + PORT, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim().split('\n').filter(Boolean).map(Number); } catch {}
  }
  for (const pid of pids) try { process.kill(pid); } catch {}
  await until(async () => !(await status()), 10000);
}

function start() {
  fs.mkdirSync(CACHE, { recursive: true });
  const log = fs.openSync(path.join(CACHE, 'server.log'), 'a');
  // détaché : le serveur continue après la fin du lanceur (et la fermeture de sa fenêtre sous Windows)
  spawn(process.execPath, [path.join(ROOT, 'server.js')], { cwd: ROOT, detached: true, stdio: ['ignore', log, log], windowsHide: true }).unref();
  fs.closeSync(log);
}

let st = await status();
if (st && (process.argv.includes('--restart') || isStale(st))) { await stop(st); st = null; }
if (!st) {
  start();
  if (!(await until(status, 20000))) {
    console.error(`App Music n'a pas démarré : voir ${path.join(CACHE, 'server.log')}`);
    process.exit(1);
  }
}
if (!(await openUrl(URL))) console.log(`Ouvrez ${URL} dans votre navigateur.`);
process.exit(0);
