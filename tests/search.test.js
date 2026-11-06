// Recherche tolérante (public/search.js) : fautes, sigles, décennies, années, pays, genres, intention de lecture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex, parseQuery, search, normalize } from '../public/search.js';

const LIB = {
  artists: [
    { id: 'met', name: 'Metallica', genres: ['Heavy Metal'], tags: ['thrash metal', 'metal'], country: 'United States' },
    { id: 'rhcp', name: 'Red Hot Chili Peppers', genres: ['Rock'], tags: ['funk rock', 'alternative rock'], country: 'United States' },
    { id: 'acc', name: 'Accept', genres: ['Heavy Metal'], tags: ['heavy metal', 'metal'], country: 'Germany' },
    { id: 'ren', name: 'Renaud', genres: ['Chanson'], tags: ['chanson', 'chanson francaise'], country: 'France' },
    { id: 'mok', name: 'Moka', genres: ['Hip Hop'], tags: ['hip hop', 'rap'], country: 'France' },
  ],
  albums: [
    { id: 'a1', title: 'Master of Puppets', artist: 'Metallica', artistId: 'met', year: 1986, genre: 'Heavy Metal' },
    { id: 'a2', title: 'Californication', artist: 'Red Hot Chili Peppers', artistId: 'rhcp', year: 1999, genre: 'Rock' },
    { id: 'a3', title: 'Russian Roulette', artist: 'Accept', artistId: 'acc', year: 1986, genre: 'Heavy Metal' },
    { id: 'a4', title: 'Morgane de toi', artist: 'Renaud', artistId: 'ren', year: 1983, genre: 'Chanson' },
    { id: 'a5', title: 'Café Serré', artist: 'Moka', artistId: 'mok', year: 2003, genre: 'Hip Hop' },
  ],
  tracks: [
    { id: 't1', title: 'Battery', artist: 'Metallica', album: 'Master of Puppets', albumId: 'a1', year: 1986, genre: 'Heavy Metal' },
    { id: 't2', title: 'Otherside', artist: 'Red Hot Chili Peppers', album: 'Californication', albumId: 'a2', year: 1999, genre: 'Rock' },
    { id: 't3', title: 'TV War', artist: 'Accept', album: 'Russian Roulette', albumId: 'a3', year: 1986, genre: 'Heavy Metal' },
    { id: 't4', title: 'Dès que le vent soufflera', artist: 'Renaud', album: 'Morgane de toi', albumId: 'a4', year: 1983, genre: 'Chanson' },
    { id: 't5', title: 'Expresso', artist: 'Moka', album: 'Café Serré', albumId: 'a5', year: 2003, genre: 'Hip Hop' },
  ],
};
const index = buildIndex(LIB);
const top = (q) => { const r = search(index, q); return r.top && (r.top.item.name || r.top.item.title); };
const albums = (q) => search(index, q).albums.map((a) => a.title);

test('normalisation : accents, casse, ponctuation', () => {
  assert.equal(normalize('Dès Que le Vent—Soufflera !'), 'des que le vent soufflera');
  assert.equal(normalize('AC/DC & co'), 'ac dc et co');
});

test('fautes de frappe et sans accents', () => {
  assert.equal(top('metalica'), 'Metallica');
  assert.equal(top('renaud morgane'), 'Morgane de toi');
  assert.equal(top('cafe serre'), 'Café Serré');
});

test('sigles : rhcp', () => assert.equal(top('rhcp'), 'Red Hot Chili Peppers'));

test('décennies et années', () => {
  for (const q of ['années 80', '80s', '80']) assert.deepEqual(parseQuery(q).years, [1980, 1989], q);
  assert.deepEqual(parseQuery('86').years, [1986, 1986]);
  assert.deepEqual(parseQuery('entre 1975 et 1985').years, [1975, 1985]);
  assert.deepEqual(parseQuery('années 2000').years, [2000, 2009]);
  assert.deepEqual(albums('86').sort(), ['Master of Puppets', 'Russian Roulette']);
  assert.deepEqual(albums('années 90'), ['Californication']);
});

test('pays et genre combinés : « metal allemand »', () => {
  assert.deepEqual(albums('metal allemand'), ['Russian Roulette']);
  assert.ok(parseQuery('groupe suédois').countries.includes('Sweden'));
});

test('synonymes de genres : « rap » trouve le hip-hop', () => {
  assert.deepEqual(albums('rap'), ['Café Serré']);
  assert.deepEqual(albums('hip hop'), ['Café Serré']);
});

test('« chanson française » : filtre sur les artistes français (« chanson » est un mot vide)', () => {
  assert.deepEqual(albums('chanson française').sort(), ['Café Serré', 'Morgane de toi']);
});

test('« joue … » : intention de lecture', () => {
  const r = search(index, 'joue battery');
  assert.equal(r.play, true);
  assert.equal(r.tracks[0].title, 'Battery');
});

test('mots inconnus ignorés, requête vide sans résultat', () => {
  const r = search(index, 'metallica xyzzyq');
  assert.ok(r.ignored.includes('xyzzyq'));
  assert.equal(r.top.item.name, 'Metallica');
  const empty = search(index, '   ');
  assert.equal(empty.top, null);
  assert.equal(empty.albums.length, 0);
});
