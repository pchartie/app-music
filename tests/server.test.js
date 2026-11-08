// Serveur : indexation, regroupements, API, pochettes, audio, hors ligne, fichiers de musique intacts.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer } from './helpers.js';
import { EXPECTED, fingerprint, flac, mp3 } from './fixtures.js';

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
    assert.deepEqual([...r.body.subarray(0, 3)], [0xff, 0xd8, 0xff], `${title} : PNG converti en vrai JPEG`);
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

test('albums avec perte : repérés, format lisible', () => {
  const a = album('Café Serré');
  assert.equal(a.lossy, 3);
  assert.equal(a.lossyCodec, 'MP3');
  assert.match(a.format, /^MP3 · \d+ kb\/s$/);
  for (const x of lib.albums.filter((x) => x !== a)) assert.equal(x.lossy, 0, `${x.title} est sans perte`);
});

test('albums avec perte : liste et fichier CSV à télécharger', async () => {
  const { body } = await srv.api('/api/lossy');
  assert.deepEqual(body.albums.map((x) => x.id), [album('Café Serré').id]);
  assert.ok(body.albums[0].firstSeen, 'date de repérage');
  assert.equal(body.files, 3);
  const csv = await srv.api('/api/lossy.csv');
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-disposition'), /attachment; filename="albums-avec-perte-\d{4}-\d\d-\d\d\.csv"/);
  const text = csv.body.toString('utf8');
  assert.ok(text.startsWith('\ufeff'), 'BOM pour Excel');
  const lines = text.slice(1).trim().split('\r\n');
  assert.equal(lines.length, 4, 'en-tête + 3 fichiers MP3');
  assert.equal(lines[0], 'Artiste;Album;Année;Titre;Format;Débit (kb/s);Fichier (dans le dossier de musique)');
  // chemin à la façon du système (\ sous Windows), pour le retrouver dans l'explorateur de fichiers
  assert.match(lines[1], new RegExp(`^Moka;Café Serré;2003;Expresso;MP3;\\d+;Moka - Café Serré\\${path.sep}01 Expresso\\.mp3$`));
  assert.ok(!text.includes(srv.music), 'chemins relatifs au dossier de musique');
});

test('journal : date de repérage conservée, historique après remplacement par du FLAC', async () => {
  const dir = path.join(srv.music, 'Brouillon - Maquettes');
  const lossyIds = async () => (await srv.api('/api/lossy')).body;
  const rescan = async () => { const before = (await srv.api('/api/status')).body.scannedAt; await srv.api('/api/rescan', { method: 'POST' });
    for (let i = 0; i < 100; i++) { const st = (await srv.api('/api/status')).body; if (st.scannedAt !== before && !st.scanning) return; await new Promise((r) => setTimeout(r, 50)); } };
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '01 Essai.mp3'), mp3({ tags: { title: 'Essai', artist: 'Brouillon', album: 'Maquettes', track: 1 } }));
  await rescan();
  let l = await lossyIds();
  assert.equal(l.albums.length, 2);
  const first = l.albums.find((x) => x.id !== album('Café Serré').id);
  await rescan();
  l = await lossyIds();
  assert.equal(l.albums.find((x) => x.id === first.id)?.firstSeen, first.firstSeen, 'date inchangée à la réindexation');
  // remplacé par du FLAC : sort de la liste, entre dans l'historique
  fs.rmSync(path.join(dir, '01 Essai.mp3'));
  fs.writeFileSync(path.join(dir, '01 Essai.flac'), flac({ tags: { TITLE: 'Essai', ARTIST: 'Brouillon', ALBUM: 'Maquettes', TRACKNUMBER: 1 } }));
  await rescan();
  l = await lossyIds();
  assert.deepEqual(l.albums.map((x) => x.id), [album('Café Serré').id]);
  assert.equal(l.history.length, 1);
  assert.deepEqual([l.history[0].title, l.history[0].artist, l.history[0].codec, l.history[0].firstSeen], ['Maquettes', 'Brouillon', 'MP3', first.firstSeen]);
  assert.ok(l.history[0].resolvedAt >= first.firstSeen);
  fs.rmSync(dir, { recursive: true });
  await rescan();
});

test('récemment ajoutés : date d’ajout de chaque album, conservée, et datée à la découverte pour un nouvel album', async () => {
  assert.ok(lib.albums.every((a) => /^\d{4}-\d\d-\d\dT/.test(a.added)), 'chaque album a une date d’ajout');
  assert.ok(lib.albums.every((a) => a.born === undefined), 'champ interne non exposé');
  const before = Object.fromEntries(lib.albums.map((a) => [a.id, a.added]));
  const t0 = new Date().toISOString();
  const dir = path.join(srv.music, 'Tout Neuf - Arrivage');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '01 - Nouveau.flac'), flac({ tags: { TITLE: 'Nouveau', ARTIST: 'Tout Neuf', ALBUM: 'Arrivage', TRACKNUMBER: 1 } }));
  await srv.api('/api/rescan', { method: 'POST' });
  await srv.waitIndexed(EXPECTED.albums + 1);
  const now = (await srv.api('/api/library')).body;
  const fresh = now.albums.find((a) => a.title === 'Arrivage');
  assert.ok(fresh.added >= t0, 'daté au moment où l’app le découvre');
  for (const a of now.albums) if (before[a.id]) assert.equal(a.added, before[a.id], `${a.title} garde sa date`);
  assert.ok(JSON.parse(fs.readFileSync(path.join(srv.cache, 'added.json'), 'utf8'))[fresh.id]);
  fs.rmSync(dir, { recursive: true });
  await srv.api('/api/rescan', { method: 'POST' });
  for (let i = 0; i < 100; i++) { const l = (await srv.api('/api/library')).body; if (!l.albums.some((a) => a.title === 'Arrivage') && !l.scanning) break; await new Promise((r) => setTimeout(r, 50)); }
  lib = (await srv.api('/api/library')).body;
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
