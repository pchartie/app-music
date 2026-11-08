// Lance une instance isolée du serveur : dossier de musique factice, cache et config temporaires, hors ligne.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLibrary } from './fixtures.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer(); s.unref(); s.on('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Navigateur Chromium déjà installé (APPMUSIC_BROWSER pour en imposer un)
export function findBrowser() {
  return [
    process.env.APPMUSIC_BROWSER,
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/brave-browser', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
    ...[process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA].filter(Boolean).flatMap((d) => [
      path.join(d, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
      path.join(d, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      path.join(d, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    ]),
  ].filter(Boolean).find((p) => fs.existsSync(p));
}

// withMusic: false -> premier lancement, aucun dossier choisi.
// music / cache : dossiers fournis par l'appelant (gardés à l'arrêt) ; sinon tout est temporaire.
// env : variables d'environnement en plus (télécommande : faux réseau, port du réseau local…)
export async function startServer({ withMusic = true, music: givenMusic, cache: givenCache, env: extraEnv = {} } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-test-'));
  const music = givenMusic || (withMusic ? makeLibrary(path.join(tmp, 'music')) : null);
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), APPMUSIC_CACHE: givenCache || path.join(tmp, 'cache'), APPMUSIC_CONFIG: path.join(tmp, 'config.json'), APPMUSIC_OFFLINE: '1', ...extraEnv };
  delete env.MUSIC_DIR;
  if (music) env.MUSIC_DIR = music;
  const child = spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = '';
  child.stdout.on('data', (d) => (logs += d)); child.stderr.on('data', (d) => (logs += d));
  const url = `http://127.0.0.1:${port}`;
  const api = async (p, opts) => { const r = await fetch(url + p, opts); return { status: r.status, headers: r.headers, body: r.headers.get('content-type')?.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()) }; };
  const waitIndexed = async (min = 1) => {
    for (let i = 0; i < 200; i++) {
      try { const { body } = await api('/api/status'); if (body.needsSetup || (body.scannedAt && !body.scanning && body.albums >= min)) return body; } catch {}
      await sleep(50);
    }
    throw new Error('le serveur ne répond pas ou n’indexe pas :\n' + logs);
  };
  try { await waitIndexed(); } catch (e) { child.kill(); fs.rmSync(tmp, { recursive: true, force: true }); throw e; }
  return {
    url, port, tmp, music, cache: env.APPMUSIC_CACHE, api, waitIndexed, logs: () => logs,
    async stop() { child.kill(); await new Promise((r) => (child.exitCode !== null ? r() : child.once('exit', r))); fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 10 }); }, // Windows : fichiers libérés un instant après l'arrêt
  };
}
