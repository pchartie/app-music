// Serveur : indexation, regroupements, API, pochettes, audio, hors ligne, fichiers de musique intacts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.js';
import { EXPECTED, fingerprint, flac } from './fixtures.js';

let srv, lib, printBefore;
const album = (title) => lib.albums.find((a) => a.title === title);
const tracksOf = (a) => a.tracks.map((id) => lib.tracks.find((t) => t.id === id));

before(async () => {
  srv = await startServer();
  printBefore = fingerprint(srv.music);
  lib = (await srv.api('/api/library')).body;
});
after(() => srv?.stop());

test('indexe toute la bibliothèque factice', () => {
  assert.equal(lib.albums.length, EXPECTED.albums);
  assert.equal(lib.artists.length, EXPECTED.artists);
  assert.equal(lib.tracks.length, EXPECTED.tracks, 'fichiers cachés et non audio ignorés');
  assert.equal(lib.needsSetup, false);
});

test('albums triés par artiste puis par année', () => {
  const etoiles = lib.albums.filter((a) => a.artist === 'Les Étoiles Filantes').map((a) => a.title);
  assert.deepEqual(etoiles, ['Nuit Blanche', 'Retour de flamme']);
  const artist = lib.artists.find((a) => a.name === 'Les Étoiles Filantes');
  assert.equal(artist.albums.length, 2);
});

test('double album : CD1 et CD2 forment un seul album, dans l’ordre des disques', () => {
  const a = album('Aurora');
  assert.ok(a, 'album Aurora');
  assert.equal(a.discs, 2);
  assert.deepEqual(tracksOf(a).map((t) => [t.disc, t.title]), [[1, 'Polar Night'], [1, 'Solar Wind'], [2, 'Magnetic Field'], [2, 'Dawn Chorus']]);
});

test('sans tags : artiste, album, année et titres tirés des noms de dossier et de fichier', () => {
  const a = album('Album Fantôme');
  assert.ok(a, 'album lu depuis « 1999 - Sans Tags - Album Fantôme »');
  assert.equal(a.artist, 'Sans Tags');
  assert.deepEqual(tracksOf(a).map((t) => t.title), ['Premier', 'Second']);
});

test('« feat. » et « & » : l’album revient à l’artiste principal', () => {
  const a = album('Café Serré');
  assert.equal(a.artist, 'Moka');
  assert.ok(!lib.artists.some((x) => /Bisou|Sucre/.test(x.name)), 'pas d’artiste « Moka & Bisou » séparé');
  assert.deepEqual(tracksOf(a).map((t) => t.artist), ['Moka & Bisou', 'Moka & Bisou', 'Moka feat. Sucre'], 'le titre garde son artiste réel');
});

test('formats : FLAC 16/44,1, FLAC 24/96, MP3', () => {
  const t16 = tracksOf(album('Nuit Blanche'))[0], t24 = tracksOf(album('Retour de flamme'))[0], tmp3 = tracksOf(album('Café Serré'))[0];
  assert.deepEqual([t16.lossless, t16.bits, t16.rate], [true, 16, 44100]);
  assert.deepEqual([t24.lossless, t24.bits, t24.rate], [true, 24, 96000]);
  assert.equal(tmp3.lossless, false);
  assert.ok(t16.duration > 0.9 && t16.duration < 1.1, `durée lue (${t16.duration})`);
  assert.match(album('Retour de flamme').format, /24 bits · 96 kHz/);
});

test('l’API ne divulgue pas les chemins des fichiers', () => {
  for (const t of lib.tracks) for (const k of ['path', 'albumDir', 'mtime']) assert.equal(t[k], undefined, `champ ${k}`);
  const raw = JSON.stringify({ albums: lib.albums, artists: lib.artists, tracks: lib.tracks });
  assert.ok(!raw.includes(srv.music), 'aucun chemin absolu dans les albums, artistes et titres');
});

test('pochettes : dossier (cover, folder, front), intégrée au FLAC, et absence hors ligne', async () => {
  for (const title of ['Nuit Blanche', 'Retour de flamme', 'Aurora', 'Album Fantôme']) {
    const a = album(title);
    assert.equal(a.hasCover, true, `${title} a une pochette`);
    const r = await srv.api(`/cover/${a.id}.jpg`);
    assert.equal(r.status, 200);
    assert.ok(r.body.length > 50, 'image non vide');
  }
  assert.equal(album('Café Serré').hasCover, false, 'pas de pochette ni de téléchargement hors ligne');
  assert.equal((await srv.api('/cover/000000000000.jpg')).status, 404);
});

test('audio : fichier complet, plages d’octets (lecture et avance rapide), 404', async () => {
  const t = lib.tracks[0];
  const full = await srv.api(`/audio/${t.id}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  const size = full.body.length;
  const part = await srv.api(`/audio/${t.id}`, { headers: { Range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 10-19/${size}`);
  assert.deepEqual(part.body, full.body.subarray(10, 20));
  const tail = await srv.api(`/audio/${t.id}`, { headers: { Range: 'bytes=-8' } });
  assert.deepEqual(tail.body, full.body.subarray(size - 8));
  assert.equal((await srv.api(`/audio/${t.id}`, { headers: { Range: `bytes=${size + 5}-` } })).status, 416);
  assert.equal((await srv.api('/audio/000000000000')).status, 404);
  assert.match(full.headers.get('content-type'), /flac|audio/);
});

test('fichiers statiques : page servie, pas d’accès hors de public/', async () => {
  const home = await srv.api('/');
  assert.equal(home.status, 200);
  assert.match(home.body.toString(), /<html/i);
  for (const p of ['/../server.js', '/..%2fserver.js', '/%2e%2e/config.json']) {
    const r = await srv.api(p);
    assert.ok(r.status === 403 || r.status === 404, `${p} → ${r.status}`);
    assert.ok(!String(r.body).includes('createServer'), `${p} ne renvoie pas le code du serveur`);
  }
});

test('hors ligne : fiches artiste et album en attente, sans erreur', async () => {
  const ar = lib.artists[0], al = lib.albums[0];
  assert.deepEqual((await srv.api(`/api/artist/${ar.id}`)).body, { pending: true });
  assert.deepEqual((await srv.api(`/api/album/${al.id}`)).body, { pending: true });
  assert.equal((await srv.api('/api/artist/inconnu')).status, 404);
  assert.equal((await srv.api(`/api/artist/${ar.id}/picture`)).status, 404);
  const st = (await srv.api('/api/status')).body;
  assert.equal(st.meta.online, false);
});

test('nouvel album ajouté puis réindexation', async () => {
  const dir = path.join(srv.music, 'Nouveau Venu - Premier Pas');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '01 - Bonjour.flac'), flac({ tags: { TITLE: 'Bonjour', ARTIST: 'Nouveau Venu', ALBUM: 'Premier Pas', TRACKNUMBER: 1 } }));
  await srv.api('/api/rescan', { method: 'POST' });
  await srv.waitIndexed(EXPECTED.albums + 1);
  lib = (await srv.api('/api/library')).body;
  assert.ok(album('Premier Pas'), 'nouvel album indexé');
  fs.rmSync(dir, { recursive: true });
  await srv.api('/api/rescan', { method: 'POST' });
  for (let i = 0; i < 100 && album('Premier Pas'); i++) { await new Promise((r) => setTimeout(r, 50)); lib = (await srv.api('/api/library')).body; }
  assert.equal(album('Premier Pas'), undefined, 'album retiré');
});

test('règle absolue : les fichiers de musique ne sont jamais modifiés, déplacés ni ajoutés', () => {
  assert.deepEqual(fingerprint(srv.music), printBefore);
  assert.ok(fs.existsSync(path.join(srv.cache, 'library.json')), 'le dérivé va dans le cache');
});

test('premier lancement : aucun dossier choisi', async () => {
  const first = await startServer({ withMusic: false });
  try {
    const l = (await first.api('/api/library')).body;
    assert.equal(l.needsSetup, true);
    assert.equal(l.albums.length, 0);
    const bad = await first.api('/api/setup', { method: 'POST', body: JSON.stringify({ musicDir: path.join(first.tmp, 'n-existe-pas') }) });
    assert.equal(bad.status, 400);
  } finally { await first.stop(); }
});
