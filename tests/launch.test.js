// Lanceur : un serveur démarré avant une mise à jour du code doit être redémarré (scripts/server-stale.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isStale, codeTime } from '../scripts/server-stale.mjs';
import { startServer } from './helpers.js';

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
