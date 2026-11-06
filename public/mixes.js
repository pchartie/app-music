// Sélections : les classiques ★, et des playlists toutes prêtes par style et par décennie.
// Module sans dépendance au navigateur (testé dans tests/mixes.test.js).

// Familles de styles : repérées dans les genres de l'album (tag, MusicBrainz, Deezer) et les principales étiquettes de l'artiste.
export const MIX_STYLES = [
  ['rock', 'Rock', /\b(rock|grunge|garage|indie|alternati\w*|britpop|post punk)\b/],
  ['hard-rock', 'Hard rock', /\b(hard rock|glam|arena rock|aor)\b/],
  ['metal', 'Metal', /\b(metal\w*|nwobhm|harte|djent|thrash|doom|grindcore)\b/],
  ['punk', 'Punk', /\bpunk\b/],
  ['pop', 'Pop', /\b(pop|variete\w*|dance|synth pop|synthpop|new wave)\b/, /\b(pop (rock|punk|rap|metal)|(folk|power) pop)\b/g],
  ['rap', 'Rap & hip-hop', /\b(rap|hip hop|hiphop|trap|grime)\b/],
  ['chanson', 'Chanson française', /\bchanson\b/],
  ['soul', 'Soul, funk & R&B', /\b(soul|funk|r b|rnb|rhythm and blues|motown|disco)\b/],
  ['blues', 'Blues', /\bblues\b/],
  ['jazz', 'Jazz', /\b(jazz|swing|bebop|bossa nova)\b/],
  ['electro', 'Électro', /\b(electro\w*|house|techno|trance|edm|ambient|downtempo|trip hop)\b/],
  ['folk', 'Folk & acoustique', /\b(folk|acoustic|celtic|singer songwriter|country|americana)\b/],
  ['classique', 'Classique & musiques de film', /\b(classical|classique|orchestral|opera|soundtrack|score|films?|games|epic|baroque|piano)\b/],
  ['reggae', 'Reggae', /\b(reggae|ska|dub|dancehall)\b/],
];
const normTxt = (x) => String(x ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ');
export const yearOf = (a) => a.year || (a.firstRelease ? +a.firstRelease.slice(0, 4) : null);
export const byArtistYear = (a, b) => a.artist.localeCompare(b.artist, 'fr') || (yearOf(a) || 0) - (yearOf(b) || 0);
// Construit toutes les sélections d'une bibliothèque (même forme que /api/library).
export function buildMixes(LIB) {
  const T = new Map(LIB.tracks.map((t) => [t.id, t]));
  const A = new Map(LIB.albums.map((a) => [a.id, a]));
  const map = new Map();
  const add = (key, title, kind, note, albums, ids) => { if (ids.length) map.set(key, { key, title, kind, note, albums, ids }); };
  // les grands classiques ★ (un tube présent sur plusieurs albums n'apparaît qu'une fois)
  const seen = new Set();
  const hits = LIB.tracks.filter((t) => t.hit).sort((x, y) => y.hit - x.hit)
    .filter((t) => { const k = t.artistId + '|' + t.title.toLowerCase().replace(/\s*[\[(-].*$/, '').trim(); if (seen.has(k)) return false; seen.add(k); return true; });
  const hitAlbums = [...new Set(hits.map((t) => t.albumId))].map((id) => A.get(id)).filter(Boolean);
  add('classiques', 'Les classiques', 'classics', 'Les titres les plus célèbres de votre bibliothèque, du plus connu au moins connu.', hitAlbums, hits.map((t) => t.id));
  // par style : au moins 2 albums et 20 titres
  const R2 = new Map(LIB.artists.map((a) => [a.id, a]));
  const text = new Map(LIB.albums.map((a) => [a.id, ' ' + normTxt([a.genre, ...(a.genres || []), ...(R2.get(a.artistId)?.tags || []).slice(0, 3)].join(' ')) + ' ']));
  for (const [key, title, re, not] of MIX_STYLES) {
    // « not » : étiquettes composées qui ne comptent pas pour ce style (« pop rock » n'est pas de la pop)
    const albums = LIB.albums.filter((a) => re.test(not ? text.get(a.id).replace(not, ' ') : text.get(a.id))).sort(byArtistYear);
    const ids = albums.flatMap((a) => a.tracks);
    if (albums.length >= 2 && ids.length >= 20) add(key, title, 'style', `Tous les albums ${title.toLowerCase().startsWith('chanson') ? 'de chanson française' : `« ${title} »`} de votre bibliothèque.`, albums, ids);
  }
  // par décennie : au moins 2 albums
  const decades = new Map();
  for (const a of LIB.albums) { const y = yearOf(a); if (!y) continue; const d = Math.floor(y / 10) * 10; if (!decades.has(d)) decades.set(d, []); decades.get(d).push(a); }
  for (const d of [...decades.keys()].sort()) {
    const albums = decades.get(d).sort((a, b) => (yearOf(a) || 0) - (yearOf(b) || 0) || a.artist.localeCompare(b.artist, 'fr'));
    if (albums.length < 2) continue;
    const label = d < 2000 ? `Années ${String(d).slice(2)}` : `Années ${d}`;
    add(`annees-${d}`, label, 'decade', `Votre musique de ${d} à ${d + 9}, dans l’ordre chronologique.`, albums, albums.flatMap((a) => a.tracks));
  }
  // pochettes des mosaïques : albums les plus « classiques » d'abord, un seul album par artiste,
  // en évitant celles déjà montrées par les sélections précédentes (dans l'ordre d'affichage)
  const score = (a) => a.tracks.reduce((s, id) => s + (T.get(id)?.hit ? 1 : 0), 0);
  const used = new Set();
  const order = [...map.values()].sort((a, b) => ['classics', 'style', 'decade'].indexOf(a.kind) - ['classics', 'style', 'decade'].indexOf(b.kind) || (a.kind === 'style' ? b.ids.length - a.ids.length : 0));
  for (const m of order) {
    let cands = m.albums.filter((a) => a.hasCover !== false).sort((a, b) => score(b) - score(a));
    // la bannière des classiques a besoin de 6 pochettes : complétée par d'autres albums si besoin
    if (m.kind === 'classics') cands = [...cands, ...LIB.albums.filter((a) => a.hasCover !== false && !cands.includes(a)).sort((a, b) => score(b) - score(a))];
    const pick = [], artists = new Set(), n = m.kind === 'classics' ? 6 : 4;
    for (const pass of [(a) => !used.has(a.id) && !artists.has(a.artistId), (a) => !artists.has(a.artistId), () => true])
      for (const a of cands) if (pick.length < n && !pick.includes(a) && pass(a)) { pick.push(a); artists.add(a.artistId); }
    pick.forEach((a) => used.add(a.id));
    m.cover = pick;
  }
  return map;
}
