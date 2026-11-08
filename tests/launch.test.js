// Lanceur (scripts/launch.mjs) et raccourcis (scripts/make-app.mjs). Un serveur démarré avant une mise à jour du code doit être redémarré (scripts/server-stale.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isStale, codeTime } from '../scripts/server-stale.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startServer, sleep, freePort, ROOT } from './helpers.js';
import { makeLibrary } from './fixtures.js';
import { desktopEntry, windowsShortcutScript } from '../scripts/make-app.mjs';

test('serveur plus ancien que son code : à redémarrer ; à jour : on le garde', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-stale-'));
  try {
    fs.mkdirSync(path.join(root, 'lib'));
    fs.writeFileSync(path.join(root, 'server.js'), '');
    fs.writeFileSync(path.join(root, 'lib', 'remote.js'), '');
    const t = codeTime(root);
    assert.equal(isStale({ startedAt: t + 1000 }, root), false);
    assert.equal(isStale({ startedAt: t - 1000 }, root), true);
    assert.equal(isStale({ scannedAt: 'x' }, root), true, 'serveur d’avant cette vérification');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(root, 'lib', 'remote.js'), later, later);
    assert.equal(isStale({ startedAt: t + 1000 }, root), true, 'un fichier de lib/ modifié compte aussi');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('/api/status donne l’heure de démarrage du serveur', async () => {
  const srv = await startServer();
  try {
    const { body } = await srv.api('/api/status');
    assert.ok(body.startedAt > Date.now() - 60000 && body.startedAt <= Date.now());
    assert.equal(isStale(body), false, 'le serveur qui vient de démarrer est à jour');
  } finally { await srv.stop(); }
});

// Lanceur : instance isolée, l'ouverture du navigateur est notée au lieu d'être faite

const run = promisify(execFile);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('lanceur : démarre le serveur et ouvre la page ; relancé, réutilise le même ; --restart le remplace', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-launch-'));
  const port = await freePort();
  const openLog = path.join(tmp, 'open.log');
  const env = { ...process.env, PORT: String(port), MUSIC_DIR: makeLibrary(path.join(tmp, 'music')), APPMUSIC_CACHE: path.join(tmp, 'cache'),
    APPMUSIC_CONFIG: path.join(tmp, 'config.json'), APPMUSIC_OFFLINE: '1', APPMUSIC_OPEN_LOG: openLog };
  const launch = (...args) => run(process.execPath, [path.join(ROOT, 'scripts', 'launch.mjs'), ...args], { env, timeout: 30000 });
  const status = async () => (await fetch(`http://127.0.0.1:${port}/api/status`)).json();
  const pids = [];
  try {
    await launch();
    const first = (await status()).pid;
    pids.push(first);
    assert.ok(alive(first), 'serveur lancé, et toujours là après la fin du lanceur');
    assert.equal(fs.readFileSync(openLog, 'utf8'), `http://localhost:${port}\n`);
    await launch();
    assert.equal((await status()).pid, first, 'pas de second serveur');
    await launch('--restart');
    const second = (await status()).pid;
    pids.push(second);
    assert.notEqual(second, first);
    assert.equal(alive(first), false, 'l’ancien serveur est arrêté');
    assert.equal(fs.readFileSync(openLog, 'utf8').trim().split('\n').length, 3, 'page ouverte à chaque lancement');
    assert.ok(fs.existsSync(path.join(tmp, 'cache', 'server.log')), 'journal du serveur');
  } finally {
    for (const pid of pids) try { process.kill(pid); } catch {}
    await sleep(500);
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
});

test('raccourci Linux : fichier .desktop valide, chemins avec espaces et caractères spéciaux', () => {
  const e = desktopEntry('/home/moi/Mes "apps"/App $Music');
  assert.match(e, /^\[Desktop Entry\]\nType=Application\nName=App Music\n/);
  assert.match(e, /^Exec=sh "\/home\/moi\/Mes \\"apps\\"\/App \\\$Music\/scripts\/launch\.sh"$/m);
  assert.match(e, /^Icon=\/home\/moi\/Mes "apps"\/App \$Music\/assets\/AppIcon\.png$/m);
  assert.match(e, /^Terminal=false$/m);
});

test('raccourci Windows : menu Démarrer et bureau, Node lance launch.mjs, icône .ico', () => {
  const ps = windowsShortcutScript('C:\\Users\\moi\\L\'App Music', 'C:\\Program Files\\nodejs\\node.exe');
  assert.match(ps, /GetFolderPath\('Programs'\).*GetFolderPath\('Desktop'\)/);
  assert.match(ps, /TargetPath = 'C:\\Program Files\\nodejs\\node\.exe'/);
  assert.match(ps, /Arguments = '"C:\\Users\\moi\\L''App Music\\scripts\\launch\.mjs"'/, 'apostrophe doublée, chemin entre guillemets');
  assert.match(ps, /IconLocation = 'C:\\Users\\moi\\L''App Music\\assets\\AppIcon\.ico,0'/);
  assert.ok(fs.existsSync(path.join(ROOT, 'assets', 'AppIcon.ico')) && fs.existsSync(path.join(ROOT, 'assets', 'AppIcon.png')), 'icônes versionnées');
});
