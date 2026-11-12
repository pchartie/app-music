// Sélections : les classiques ★ (toutes styles confondus et par style), et des playlists toutes prêtes par style et par décennie.
// Module sans dépendance au navigateur (testé dans tests/mixes.test.js).

// Familles de styles (ordre d'affichage). Chaque album est rangé dans son style principal (et un second s'il pèse
// presque autant) : on ne se contente plus d'un mot trouvé dans une étiquette (« blues rock » n'est pas du blues).
export const MIX_STYLES = [
  ['rock', 'Rock'], ['hard-rock', 'Hard rock'], ['metal', 'Metal'], ['punk', 'Punk'], ['pop', 'Pop'], ['rap', 'Rap & hip-hop'],
  ['chanson', 'Chanson française'], ['soul', 'Soul, funk & R&B'], ['blues', 'Blues'], ['jazz', 'Jazz'], ['electro', 'Électro'],
  ['folk', 'Folk & acoustique'], ['classique', 'Classique & musiques de film'], ['reggae', 'Reggae'],
];
// titre des classiques ★ de chaque style
const CLASSIC_TITLES = {
  rock: 'Classiques du rock', 'hard-rock': 'Classiques du hard rock', metal: 'Classiques du metal', punk: 'Classiques du punk',
  pop: 'Classiques de la pop', rap: 'Classiques du rap', chanson: 'Classiques de la chanson', soul: 'Classiques soul & funk',
  blues: 'Classiques du blues', jazz: 'Classiques du jazz', electro: 'Classiques de l’électro', folk: 'Classiques folk',
  classique: 'Grands thèmes & musiques de film', reggae: 'Classiques du reggae',
};
export const CLASSICS_MIN = 8; // titres ★ (distincts) nécessaires pour une playlist de classiques par style
// étiquettes composées reconnues telles quelles (avant la règle du dernier mot)
const WHOLE = [
  [/\b(hip hop|hiphop|g funk)\b/, 'rap'], [/\btrip hop\b/, 'electro'], [/\b(r b|rnb|rhythm and blues)\b/, 'soul'],
  [/\b(hard rock|arena rock|glam( rock| metal)?|aor)\b/, 'hard-rock'], [/\brock opera\b/, 'rock'], [/\bfolk pop\b/, 'folk'], [/\bpower pop\b/, 'rock'],
  [/\b(chanson|variete francaise)\b/, 'chanson'], [/\b(singer songwriter|bossa nova)\b/, (t) => (/bossa/.test(t) ? 'jazz' : 'folk')],
  [/\b(soundtrack|score|films?|games|trailer|production music|musique de film)\b/, 'classique'], [/\bnew wave\b/, 'pop'], [/\bneue deutsche harte\b/, 'metal'],
];
// sinon le dernier mot connu décide : « blues rock » → rock, « funk metal » → metal, « pop soul » → soul, « dance pop » → pop
const WORD = {
  rock: 'rock', grunge: 'rock', garage: 'rock', indie: 'rock', alternative: 'rock', britpop: 'rock', psychedelic: 'rock',
  metal: 'metal', metalcore: 'metal', thrash: 'metal', doom: 'metal', djent: 'metal', grindcore: 'metal', nwobhm: 'metal',
  punk: 'punk', pop: 'pop', synthpop: 'pop', electropop: 'pop', variete: 'pop', latin: 'pop',
  rap: 'rap', trap: 'rap', grime: 'rap', soul: 'soul', funk: 'soul', motown: 'soul', disco: 'soul',
  blues: 'blues', jazz: 'jazz', swing: 'jazz', bebop: 'jazz',
  electro: 'electro', electronic: 'electro', electronica: 'electro', house: 'electro', techno: 'electro', trance: 'electro', edm: 'electro',
  ambient: 'electro', downtempo: 'electro', dubstep: 'electro', breakbeat: 'electro', dance: 'electro',
  folk: 'folk', acoustic: 'folk', celtic: 'folk', country: 'folk', americana: 'folk',
  classical: 'classique', classique: 'classique', orchestral: 'classique', opera: 'classique', baroque: 'classique', piano: 'classique', epic: 'classique',
  reggae: 'reggae', ska: 'reggae', dub: 'reggae', dancehall: 'reggae',
};
export function tagFamily(tag) {
  const t = ' ' + normTxt(tag).trim() + ' ';
  for (const [re, f] of WHOLE) if (re.test(t)) return typeof f === 'function' ? f(t) : f;
  const words = t.trim().split(' ');
  for (let i = words.length - 1; i >= 0; i--) if (WORD[words[i]]) return WORD[words[i]];
  return null;
}
// poids des styles d'un album : genre du tag (le plus fiable), genres trouvés en ligne, étiquettes de l'artiste ; les premiers comptent plus
function albumScores(a, artistTags) {
  const sc = new Map();
  const addTag = (tag, w) => { const f = tagFamily(tag); if (!f) return; sc.set(f, (sc.get(f) || 0) + w); if (f === 'hard-rock') sc.set('rock', (sc.get('rock') || 0) + w * 0.6); };
  String(a.genre || '').split(/[,;/]/).map((x) => x.trim()).filter((x) => x && !/^\d+$/.test(x)).forEach((g, i) => addTag(g, 3 / (i + 1)));
  (a.genres || []).slice(0, 5).forEach((g, i) => addTag(g, [2, 1.5, 1, 0.7, 0.5][i]));
  (artistTags || []).slice(0, 3).forEach((g, i) => addTag(g, [2, 1.3, 1][i]));
  return sc;
}
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
  const own = new Map(LIB.albums.map((a) => [a.id, albumScores(a, R2.get(a.artistId)?.tags)]));
  const fams = new Map();
  for (const a of LIB.albums) {
    // les autres albums de l'artiste corrigent une étiquette isolée et fausse (un album de rock étiqueté « jazz »)
    const sc = new Map(own.get(a.id));
    for (const b of LIB.albums) if (b !== a && b.artistId === a.artistId) for (const [f, w] of own.get(b.id)) sc.set(f, (sc.get(f) || 0) + w * 0.5);
    const top = Math.max(0, ...sc.values());
    const keep = new Set([...sc].filter(([, w]) => top > 0 && w >= top * 0.5).map(([f]) => f));
    // la chanson française prime : Renaud reste dans « Chanson française », pas aussi dans Pop et Rock
    fams.set(a.id, keep.has('chanson') ? new Set(['chanson']) : keep);
  }
  // classiques par style : les titres ★ des albums du style, du plus connu au moins connu
  for (const [key, title] of MIX_STYLES) {
    const pick = hits.filter((t) => fams.get(t.albumId)?.has(key));
    if (pick.length < CLASSICS_MIN || new Set(pick.map((t) => t.artistId)).size < 2) continue;
    const albums = [...new Set(pick.map((t) => t.albumId))].map((id) => A.get(id)).filter(Boolean);
    add(`classiques-${key}`, CLASSIC_TITLES[key] || `Classiques · ${title}`, 'classics-style', `Les titres les plus célèbres de votre bibliothèque en « ${title} », du plus connu au moins connu.`, albums, pick.map((t) => t.id));
  }
  for (const [key, title] of MIX_STYLES) {
    const albums = LIB.albums.filter((a) => fams.get(a.id).has(key)).sort(byArtistYear);
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
  const KINDS = ['classics', 'classics-style', 'style', 'decade'];
  const order = [...map.values()].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || (a.kind === 'style' || a.kind === 'classics-style' ? b.ids.length - a.ids.length : 0));
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
