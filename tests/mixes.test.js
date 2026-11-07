// Sélections (public/mixes.js) : classiques ★, playlists par style et par décennie, mosaïques.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMixes } from '../public/mixes.js';

// Petite bibliothèque : album(id, artiste, année, genre, nombre de titres, { hits, tags d'album, couverture })
function library(spec) {
  const albums = [], tracks = [], artists = new Map();
  for (const [id, artist, year, genre, n, opts = {}] of spec) {
    const artistId = 'ar-' + artist;
    if (!artists.has(artistId)) artists.set(artistId, { id: artistId, name: artist, albums: [], tags: opts.artistTags || [] });
    artists.get(artistId).albums.push(id);
    const ids = Array.from({ length: n }, (_, i) => `${id}-${i + 1}`);
    ids.forEach((tid, i) => tracks.push({ id: tid, title: opts.titles?.[i] || `${id} titre ${i + 1}`, artist, artistId, albumId: id, album: id, duration: 200, hit: opts.hits?.[i] || 0 }));
    albums.push({ id, title: id, artist, artistId, year, genre, genres: opts.genres || [], tracks: ids, hasCover: opts.cover !== false });
  }
  return { albums, tracks, artists: [...artists.values()] };
}

test('par style : au moins 2 albums et 20 titres', () => {
  const m = buildMixes(library([
    ['r1', 'Alpha', 1975, 'Rock', 12], ['r2', 'Beta', 1978, 'Rock', 10],
    ['j1', 'Gamma', 1960, 'Jazz', 30], // un seul album de jazz : pas de playlist
    ['b1', 'Delta', 1990, 'Blues', 5], ['b2', 'Epsilon', 1991, 'Blues', 5], // 2 albums mais 10 titres : pas de playlist
  ]));
  assert.ok(m.has('rock'));
  assert.equal(m.get('rock').ids.length, 22);
  assert.ok(!m.has('jazz'));
  assert.ok(!m.has('blues'));
});

test('« pop rock », « pop punk », « folk pop » ne comptent pas pour la Pop', () => {
  const m = buildMixes(library([
    ['p1', 'Alpha', 2001, 'Pop', 12], ['p2', 'Beta', 2002, null, 12, { genres: ['dance-pop'] }],
    ['x1', 'Gamma', 2003, 'Pop Rock', 12], ['x2', 'Delta', 2004, null, 12, { genres: ['pop punk'] }], ['x3', 'Eps', 2005, null, 12, { artistTags: ['folk pop'] }],
  ]));
  assert.deepEqual(m.get('pop').albums.map((a) => a.id).sort(), ['p1', 'p2']);
});

test('genres de l’album et principales étiquettes de l’artiste', () => {
  const m = buildMixes(library([
    ['a1', 'Alpha', 1984, null, 12, { artistTags: ['heavy metal', 'hard rock'] }],
    ['a2', 'Beta', 1986, null, 12, { genres: ['thrash metal'] }],
  ]));
  assert.deepEqual(m.get('metal').albums.map((a) => a.id), ['a1', 'a2']);
  assert.deepEqual(m.get('hard-rock')?.albums.map((a) => a.id) ?? [], [], 'un seul album hard rock : pas de playlist');
});

test('par décennie : au moins 2 albums, ordre chronologique, libellés', () => {
  const m = buildMixes(library([
    ['c', 'Gamma', 1989, 'Pop', 2], ['a', 'Alpha', 1981, 'Pop', 2], ['b', 'Beta', 1985, 'Pop', 2],
    ['d', 'Delta', 2004, 'Pop', 2], ['e', 'Eps', 2007, 'Pop', 2], ['f', 'Zeta', 1972, 'Pop', 2],
  ]));
  assert.deepEqual(m.get('annees-1980').albums.map((a) => a.id), ['a', 'b', 'c']);
  assert.equal(m.get('annees-1980').title, 'Années 80');
  assert.equal(m.get('annees-2000').title, 'Années 2000');
  assert.ok(!m.has('annees-1970'), 'un seul album dans les années 70');
});

test('classiques : du plus connu au moins connu, un tube présent sur deux albums une seule fois', () => {
  const m = buildMixes(library([
    ['studio', 'Alpha', 1991, 'Rock', 3, { titles: ['Tube', 'Autre', 'Moyen'], hits: [950000, 0, 820000] }],
    ['live', 'Alpha', 1995, 'Rock', 2, { titles: ['Tube (Live)', 'Rare'], hits: [900000, 0] }],
    ['b', 'Beta', 1999, 'Rock', 1, { titles: ['Énorme'], hits: [990000] }],
  ]));
  assert.deepEqual(m.get('classiques').ids, ['b-1', 'studio-1', 'studio-3']);
  assert.equal(buildMixes(library([['a', 'Alpha', 1990, 'Rock', 3]])).has('classiques'), false, 'pas de classiques sans titre ★');
});

test('mosaïques : 4 pochettes d’artistes différents, variées d’une sélection à l’autre, jamais d’album sans pochette', () => {
  const spec = [];
  for (let i = 0; i < 10; i++) spec.push([`al${i}`, `Artiste${i % 6}`, 1980 + i, 'Hard Rock', 6, { cover: i !== 3 }]);
  const m = buildMixes(library(spec));
  const rock = m.get('rock'), hard = m.get('hard-rock');
  assert.equal(rock.cover.length, 4);
  assert.equal(new Set(rock.cover.map((a) => a.artistId)).size, 4, 'artistes différents');
  assert.ok(rock.cover.every((a) => a.hasCover), 'pas d’album sans pochette');
  const overlap = rock.cover.filter((a) => hard.cover.includes(a));
  assert.equal(overlap.length, 0, 'pochettes différentes entre « Rock » et « Hard rock »');
});

test('bannière des classiques : toujours 6 pochettes, complétées par d’autres albums', () => {
  const spec = [['hit', 'Alpha', 1990, 'Rock', 2, { hits: [900000] }]];
  for (let i = 0; i < 7; i++) spec.push([`al${i}`, `Artiste${i}`, 2000 + i, 'Pop', 3]);
  const c = buildMixes(library(spec)).get('classiques');
  assert.equal(c.cover.length, 6);
  assert.equal(c.cover[0].id, 'hit', 'l’album du classique en premier');
});

test('style principal : le dernier mot d’une étiquette décide (« blues rock » est du rock)', () => {
  const twelve = (id, artist, genres, artistTags = []) => [id, artist, 1990, null, 12, { genres, artistTags }];
  const m = buildMixes(library([
    twelve('b1', 'Bluesman', ['blues', 'electric blues']), twelve('b2', 'Bluesette', ['blues']),
    twelve('br', 'Rockeur', ['blues rock', 'hard rock', 'rock']), // pas du blues
    twelve('fm', 'Fusion', ['funk metal', 'rap metal']), // pas de la soul
    twelve('ro', 'Opéra', ['rock opera']), // pas du classique
    twelve('c1', 'Orchestre', ['classical', 'orchestral']), twelve('c2', 'Bande originale', ['soundtrack']),
    twelve('ep', 'Chanteuse', ['electropop', 'dance-pop']), twelve('p2', 'Chanteur', ['pop']), // de la pop, pas de l'électro
    twelve('e1', 'DJ', ['house', 'edm']), twelve('e2', 'Ambiance', ['downtempo', 'trip hop']),
  ]));
  const ids = (k) => m.get(k)?.albums.map((a) => a.id).sort() ?? [];
  assert.deepEqual(ids('blues'), ['b1', 'b2']);
  assert.ok(!ids('soul').includes('fm'));
  assert.deepEqual(ids('classique'), ['c1', 'c2']);
  assert.deepEqual(ids('electro'), ['e1', 'e2']);
  assert.deepEqual(ids('pop'), ['ep', 'p2']);
});

test('une étiquette isolée et fausse est corrigée par les autres albums de l’artiste', () => {
  const m = buildMixes(library([
    ['x1', 'Groupe', 1996, null, 12, { genres: ['jazz'] }], // mal étiqueté
    ['x2', 'Groupe', 2000, 'Rock', 12, { genres: ['alternative rock', 'rock'] }], ['x3', 'Groupe', 2003, 'Rock', 12, { genres: ['alternative rock'] }],
    ['j1', 'Trio', 1960, 'Jazz', 12, { genres: ['jazz', 'bebop'] }],
  ]));
  assert.ok(!m.has('jazz'), 'un seul vrai album de jazz : pas de playlist « Jazz »');
  assert.deepEqual(m.get('rock').albums.map((a) => a.id), ['x1', 'x2', 'x3']);
});

test('chanson française : l’album y reste seul, pas aussi dans Pop et Rock', () => {
  const m = buildMixes(library([
    ['f1', 'Chanteur', 1980, 'Pop', 12, { genres: ['pop', 'rock'], artistTags: ['french', 'chanson française'] }],
    ['f2', 'Chanteur', 1983, 'Chanson', 12, { genres: ['chanson française', 'rock'], artistTags: ['french', 'chanson française'] }],
    ['p1', 'Popstar', 1990, 'Pop', 12], ['p2', 'Idole', 1991, 'Pop', 12], ['r1', 'Rockband', 1992, 'Rock', 12], ['r2', 'Garage', 1993, 'Rock', 12],
  ]));
  assert.deepEqual(m.get('chanson').albums.map((a) => a.id), ['f1', 'f2']);
  assert.ok(!m.get('pop').albums.some((a) => a.artist === 'Chanteur') && !m.get('rock').albums.some((a) => a.artist === 'Chanteur'));
});
