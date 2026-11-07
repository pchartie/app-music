// Moteur de recherche tolérant : artistes, albums, titres, genres, pays, années, décennies.
// Fonctionne avec très peu d'informations : « metal allemand », « années 80 », « rhcp », « 86 », « rap »…

export const normalize = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' et ').replace(/[^a-z0-9]+/g, ' ').trim();

const STOP = new Set(('de du des la le les l d et a au aux en un une the of musique musiques album albums chanson chansons groupe groupes titre titres ' +
  'morceau morceaux par avec pour moi je veux voudrais ecouter cherche chercher trouve trouver recherche style genre artiste artistes son sons ' +
  'annee annees decennie periode epoque sorti sortie sortis entre depuis vers').split(' '));
const PLAY_WORDS = /^(joue|jouer|lance|lancer|mets|mettre|ecoute|ecouter|play)\b/;

// Synonymes de genres (français -> étiquettes MusicBrainz/Deezer)
const GENRES = {
  rap: ['rap', 'hip hop'], hiphop: ['hip hop', 'rap'], electro: ['electronic', 'electro', 'house', 'edm', 'dance', 'trance'],
  electronique: ['electronic', 'electro', 'edm'], classique: ['classical', 'piano', 'contemporary classical', 'neoclassical', 'modern classical'],
  piano: ['piano', 'classical'], variete: ['chanson', 'variete', 'pop'], chanson: ['chanson'], francaise: ['chanson'],
  soul: ['soul', 'r b', 'rnb'], rnb: ['r b', 'rnb', 'soul'], metal: ['metal'], hard: ['hard rock'], dance: ['dance', 'edm'],
  psychedelique: ['psychedelic'], progressif: ['progressive'], alternatif: ['alternative'], acoustique: ['acoustic'], live: ['live'],
};
// Pays : noms et adjectifs français -> nom MusicBrainz
const COUNTRIES = {
  'United States': 'americain americaine americains americaines usa amerique',
  'United Kingdom': 'anglais anglaise britannique britanniques angleterre england',
  England: 'anglais anglaise angleterre',
  France: 'francais francaise francaises france',
  Germany: 'allemand allemande allemands allemandes allemagne',
  Sweden: 'suedois suedoise suede',
  Greece: 'grec grecque grece',
  Canada: 'canadien canadienne canada quebecois quebec',
  Australia: 'australien australienne australie',
  Ireland: 'irlandais irlandaise irlande',
  Italy: 'italien italienne italie',
  Norway: 'norvegien norvegienne norvege',
  Finland: 'finlandais finlandaise finlande',
  Belgium: 'belge belgique',
  Spain: 'espagnol espagnole espagne',
  Netherlands: 'neerlandais hollandais',
  Jamaica: 'jamaicain jamaique',
};
const COUNTRY_OF = new Map();
for (const [c, words] of Object.entries(COUNTRIES)) for (const w of words.split(' ')) { if (!COUNTRY_OF.has(w)) COUNTRY_OF.set(w, []); COUNTRY_OF.get(w).push(c); }
const FR_NUM = { soixante: 60, soixantedix: 70, septante: 70, quatrevingt: 80, quatrevingts: 80, quatrevingtdix: 90, nonante: 90, deuxmille: 2000 };

function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Qualité de correspondance d'un mot de la requête avec un texte normalisé
function matchQuality(tok, f) {
  if (!f.text) return 0;
  if (f.words.includes(tok)) return 1;
  if (tok.length >= 2 && f.compact === tok) return 0.95; // « acdc », « gunsnroses »
  if (tok.length >= 2 && f.initials.length >= 2 && f.initials === tok) return 0.9; // « rhcp », « gnr »
  if (tok.length >= 2 && f.words.some((w) => w.startsWith(tok))) return tok.length >= 3 ? 0.8 : 0.55;
  if (tok.length >= 4 && f.text.includes(tok)) return 0.6;
  if (tok.length >= 4) {
    const max = tok.length >= 8 ? 2 : 1;
    if (f.words.some((w) => w.length >= 3 && lev(tok, w, max) <= max)) return 0.5;
    if (f.compact.length <= tok.length + 2 && lev(tok, f.compact, max) <= max) return 0.5;
  }
  return 0;
}
const field = (s, weight) => {
  const text = normalize(s); const words = text ? text.split(' ') : [];
  return { text, words, compact: words.join(''), initials: words.filter((w) => !['the', 'of', 'and', 'et'].includes(w) || words.length <= 2).map((w) => w[0]).join(''), weight };
};

export function buildIndex(LIB) {
  const artistsById = new Map(LIB.artists.map((a) => [a.id, a]));
  const albums = LIB.albums.map((a) => {
    const ar = artistsById.get(a.artistId) || {};
    const genres = [a.genre, ...(a.genres || []), ...(ar.tags || [])].filter(Boolean);
    return {
      kind: 'album', item: a, year: a.year || (a.firstRelease ? +a.firstRelease.slice(0, 4) : null),
      years: [a.year, a.firstRelease && +a.firstRelease.slice(0, 4)].filter(Boolean),
      country: ar.country, area: ar.area,
      fields: [field(a.title, 2.5), field(a.artist, 2), field([a.genre, ...(a.genres || []).slice(0, 2), ...(ar.tags || []).slice(0, 2)].filter(Boolean).join(' '), 1.5), field(genres.join(' '), 1.1), field(a.label, 0.7)],
    };
  });
  const albumsByArtist = new Map();
  for (const e of albums) { const k = e.item.artistId; if (!albumsByArtist.has(k)) albumsByArtist.set(k, []); albumsByArtist.get(k).push(e); }
  const artists = LIB.artists.map((a) => {
    const own = albumsByArtist.get(a.id) || [];
    return {
      kind: 'artist', item: a, country: a.country, area: a.area,
      years: own.flatMap((e) => e.years),
      // genres principaux (les premiers) plus importants que les secondaires
      fields: [field(a.name, 3), field([...(a.genres || []), ...(a.tags || []).slice(0, 2)].join(' '), 1.6), field((a.tags || []).slice(2).join(' '), 1.1)],
    };
  });
  const albumIdx = new Map(albums.map((e) => [e.item.id, e]));
  const tracks = LIB.tracks.map((t) => {
    const al = albumIdx.get(t.albumId);
    return {
      kind: 'track', item: t, years: [t.year, ...(al?.years || [])].filter(Boolean), country: al?.country, area: al?.area,
      fields: [field(t.title, 2.2), field(t.artist, 1.6), field(t.album, 1), field(t.genre, 1)],
    };
  });
  // Genres présents, pour les suggestions
  const genreCount = new Map();
  for (const e of albums) for (const g of new Set([e.item.genre, ...(e.item.genres || [])].filter(Boolean).map((g) => g.toLowerCase()))) genreCount.set(g, (genreCount.get(g) || 0) + 1);
  const decades = [...new Set(albums.flatMap((e) => e.years).map((y) => Math.floor(y / 10) * 10))].sort();
  const countries = [...new Set(LIB.artists.map((a) => a.country).filter((c) => c in COUNTRIES))];
  return { albums, artists, tracks, genres: [...genreCount].sort((a, b) => b[1] - a[1]).map(([g]) => g), decades, countries };
}

// Analyse de la requête : années, décennies, pays, genres, intention de lecture
export function parseQuery(q) {
  let s = normalize(q);
  const out = { play: false, years: null, labels: [], tokens: [], countries: [] };
  if (PLAY_WORDS.test(s)) { out.play = true; s = s.replace(PLAY_WORDS, '').trim(); }
  s = s.replace(/quatre vingt dix/g, 'quatrevingtdix').replace(/quatre vingts?/g, 'quatrevingt').replace(/soixante dix/g, 'soixantedix').replace(/deux mille/g, 'deuxmille');
  let words = s.split(' ').filter(Boolean).map((w) => (FR_NUM[w] ? String(FR_NUM[w]) : w));
  const range = (a, b, label) => { out.years = [a, b]; out.labels.push(label); };
  const decade = (d) => range(d, d + 9, d < 2000 ? `Années ${String(d).slice(2)}` : `Années ${d}`);
  const twoDigits = (n) => (n >= 30 ? 1900 + n : 2000 + n);
  const saysDecade = /\b(annees?|decennie|eighties|seventies|nineties|sixties)\b/.test(s);
  for (const [w, d] of [['sixties', 1960], ['seventies', 1970], ['eighties', 1980], ['nineties', 1990]]) if (words.includes(w)) { decade(d); words = words.filter((x) => x !== w); }
  // « entre 1980 et 1990 », « 1980 1990 »
  const four = words.filter((w) => /^(19|20)\d\d$/.test(w)).map(Number);
  if (!out.years && four.length >= 2) { const [a, b] = [Math.min(...four), Math.max(...four)]; range(a, b, `De ${a} à ${b}`); words = words.filter((w) => !/^(19|20)\d\d$/.test(w)); }
  words = words.filter((w, i) => {
    if (out.years) return true;
    let m;
    if ((m = w.match(/^((?:19|20)?)(\d)0s$/)) || ((m = w.match(/^()(\d)0$/)) && (saysDecade || words[i + 1] === 's'))) {
      decade(m[1] ? +(m[1] + m[2] + '0') : twoDigits(+m[2] * 10)); return false; // 80s, 80's, années 80
    }
    if ((m = w.match(/^(19|20)\d0$/)) && saysDecade) { decade(+w); return false; } // années 2000, années 1970
    if (/^(19|20)\d\d$/.test(w)) { range(+w, +w, `Année ${w}`); return false; }
    if (/^\d0$/.test(w)) { decade(twoDigits(+w)); return false; } // « 80 » seul : la décennie
    if (/^\d\d$/.test(w)) { const y = twoDigits(+w); range(y, y, `Année ${y}`); return false; } // « 86 »
    return true;
  }).filter((w) => w !== 's');
  for (const w of words) if (COUNTRY_OF.has(w)) { out.countries.push(...COUNTRY_OF.get(w)); out.labels.push(`Pays : ${w}`); }
  words = words.filter((w) => !COUNTRY_OF.has(w));
  out.tokens = words.filter((w) => !STOP.has(w) && w.length > 0);
  return out;
}

const expand = (tok) => [tok, ...(GENRES[tok] || [])].map(normalize);

export function search(index, q) {
  const pq = parseQuery(q);
  const inYears = (years) => !pq.years || years.some((y) => y >= pq.years[0] && y <= pq.years[1]);
  const inCountry = (e) => !pq.countries.length || pq.countries.includes(e.country);

  const scoreEntity = (e, tokens) => {
    let total = 0;
    for (const alts of tokens) {
      let best = 0;
      for (const alt of alts) {
        const parts = alt.split(' ');
        for (const f of e.fields) {
          // les synonymes à plusieurs mots (« hip hop ») doivent tous correspondre
          const qy = parts.length > 1 ? Math.min(...parts.map((p) => matchQuality(p, f))) : matchQuality(alt, f);
          best = Math.max(best, qy * f.weight * (alt === alts[0] ? 1 : 0.9));
        }
      }
      if (!best) return 0;
      // départage : plus le mot revient (genres, étiquettes), plus l'élément est pertinent
      const occ = e.fields.reduce((n, f) => n + f.words.filter((w) => w === alts[0]).length, 0);
      total += best + 0.08 * Math.min(occ, 5);
    }
    return total || 0.001;
  };

  // Les mots qui ne correspondent à rien dans toute la bibliothèque sont ignorés (fautes de frappe)
  let tokens = pq.tokens.map(expand);
  const all = [...index.artists, ...index.albums, ...index.tracks];
  const ignored = [];
  tokens = tokens.filter((alts) => {
    const ok = all.some((e) => scoreEntity(e, [alts]) > 0.001);
    if (!ok) ignored.push(alts[0]);
    return ok;
  });
  const filters = !!(pq.years || pq.countries.length);
  if (!tokens.length && !filters) return { ...pq, ignored, artists: [], albums: [], tracks: [], top: null };

  const run = (list) => list
    .filter((e) => inYears(e.years) && inCountry(e))
    .map((e) => ({ e, s: tokens.length ? scoreEntity(e, tokens) : 1 }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (a.e.year || a.e.item.year || 0) - (b.e.year || b.e.item.year || 0));
  const artists = run(index.artists), albums = run(index.albums), tracks = run(index.tracks);
  if (!tokens.length) albums.sort((a, b) => (a.e.year || 0) - (b.e.year || 0));
  const top = [artists[0], albums[0]].filter(Boolean).sort((a, b) => b.s - a.s)[0] || tracks[0] || null;
  return {
    ...pq, ignored,
    artists: artists.map((x) => x.e.item), albums: albums.map((x) => x.e.item), tracks: tracks.map((x) => x.e.item),
    top: top && tokens.length ? { kind: top.e.kind, item: top.e.item } : null,
  };
}
