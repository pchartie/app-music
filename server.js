// App Music — serveur local : indexe la musique, sert l'audio, les pochettes et les métadonnées.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';
import { createRemote } from './lib/remote.js';
import { toJpeg } from './lib/images.js';
import { analyseInBackground, albumVerdict } from './lib/spectrum.js';
import { pickFolder, volumeDirs } from './lib/system.js';

const STARTED_AT = Date.now(); // le lanceur redémarre le serveur si son code est plus récent
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4321);
const CACHE = process.env.APPMUSIC_CACHE || path.join(ROOT, 'cache');
const COVERS = path.join(CACHE, 'covers');
const SCAN_DELAY = Number(process.env.APPMUSIC_SCAN_DELAY || 0); // tests : ralentit la lecture de chaque fichier (ms) pour voir la progression
const READER = 2; // version de la lecture des fichiers (2 : disque lu dans le nom « 101-… »)
const META = path.join(CACHE, 'meta');
const ARTIST_IMG = path.join(CACHE, 'artists');
const LIB_FILE = path.join(CACHE, 'library.json');
const LOSSY_LOG = path.join(CACHE, 'lossy-log.json'); // journal des albums avec perte (MP3…)
const QUALITY_FILE = path.join(CACHE, 'quality.json'); // qualité réelle des MP3 (faux 320), lib/spectrum.js
const ADDED_LOG = path.join(CACHE, 'added.json'); // date d'ajout de chaque album (« Récemment ajoutés »)
const DISLIKES_FILE = path.join(CACHE, 'dislikes.json'); // titres « pas pour moi », sautés à la lecture (« artiste|titre » -> true)
const STARS_FILE = path.join(CACHE, 'stars.json'); // étoiles ajoutées ou retirées à la main (« artiste|titre » -> true/false)
const AUDIO_EXT = new Set(['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.aiff', '.aif']);
const UA = 'AppMusic/1.0 (application musicale locale)';
const CONFIG_FILE = process.env.APPMUSIC_CONFIG || path.join(ROOT, 'config.json'); // propre à chaque machine, ignoré par Git
const expandHome = (p) => (p || '').trim().replace(/^~(?=$|[\\/])/, os.homedir());
// chemin affiché : ~ pour le dossier personnel (ni le nom d'utilisateur ni le disque)
const tilde = (p) => { const h = os.homedir(); return !p ? null : p === h ? '~' : p.startsWith(h + path.sep) ? '~' + p.slice(h.length) : p; };
function readConfig() { try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return {}; } }
function writeConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }
let MUSIC_DIR = process.env.MUSIC_DIR || readConfig().musicDir || null;

if (process.env.APPMUSIC_OFFLINE) globalThis.fetch = async () => { throw new TypeError('hors ligne (simulé)'); };
for (const d of [CACHE, COVERS, META, ARTIST_IMG]) fs.mkdirSync(d, { recursive: true });
// Installations antérieures à l'écran d'accueil : la musique était lue dans ~/Downloads
if (!MUSIC_DIR && fs.existsSync(LIB_FILE)) { MUSIC_DIR = path.join(os.homedir(), 'Downloads'); writeConfig({ musicDir: MUSIC_DIR }); }
// Analyse de la qualité réelle des MP3 : facultative (longue sur une grande bibliothèque), désactivée pour une nouvelle installation ;
// gardée pour une installation qui l'utilisait déjà (résultats présents)
if (readConfig().qualityCheck === undefined && fs.existsSync(QUALITY_FILE)) writeConfig({ ...readConfig(), qualityCheck: true });
let qualityEnabled = readConfig().qualityCheck === true;
const qualityOn = () => qualityEnabled;

// Premier lancement : crée le raccourci de l'app (bureau et menu des applications, selon le système), une seule fois
// (s'il est supprimé ensuite, il n'est pas recréé). Pas pour les instances de test (APPMUSIC_CONFIG).
async function firstRunShortcut() {
  if (process.env.APPMUSIC_CONFIG || readConfig().shortcut) return;
  try {
    const { makeShortcut } = await import('./scripts/make-app.mjs');
    console.log(await makeShortcut());
    writeConfig({ ...readConfig(), shortcut: true });
  } catch (e) { console.log('Raccourci non créé :', e.message); }
}

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

let library = { albums: [], artists: [], tracks: [], scannedAt: null };
let scanning = false;
let scanProgress = { phase: null, done: 0, total: 0 }; // phase : 'files' (lecture des fichiers) puis 'covers' (albums et pochettes)

// ---------- Indexation ----------
async function walk(dir, out = []) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) await walk(p, out);
    else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}

const cleanAlbum = (s) => s
  .replace(/\s*[\[(]?\s*(cd|disc|disque|disk)\s*\d+\s*[\])]?\s*$/i, '')
  .replace(/\s*-\s*$/, '').trim();

function fromFolder(file) {
  // Repli quand les tags sont absents : « 2000 - Artiste - Album » ou « Artiste - Album (Année) »
  let dir = path.basename(path.dirname(file));
  if (/^(cd|disc)\s*\d+$/i.test(dir)) dir = path.basename(path.dirname(path.dirname(file)));
  const parts = dir.replace(/[\[(].*?[\])]/g, '').split(' - ').map((s) => s.trim()).filter(Boolean);
  if (parts.length >= 3 && /^\d{4}$/.test(parts[0])) return { artist: parts[1], album: parts.slice(2).join(' - ') };
  if (parts.length >= 2) return { artist: parts[0], album: parts.slice(1).join(' - ') };
  return { artist: 'Artiste inconnu', album: dir };
}

let rescanAfter = false;
async function scan() {
  if (!MUSIC_DIR) return;
  if (scanning) { rescanAfter = true; return; }
  scanning = true;
  const t0 = Date.now();
  const previous = new Map(library.tracks.map((t) => [t.path, t]));
  // READER : version de la lecture des fichiers ; à augmenter quand elle change, pour relire toute la bibliothèque une fois
  const files = await walk(MUSIC_DIR);
  scanProgress = { phase: 'files', done: 0, total: files.length };
  const tracks = [];
  const pictures = new Map(); // albumId -> embedded picture

  // lecture de plusieurs fichiers à la fois (première indexation d'une grande bibliothèque bien plus rapide),
  // résultats rangés dans l'ordre des fichiers : même bibliothèque, mêmes pochettes qu'une lecture un par un
  const read = async (file) => {
    if (SCAN_DELAY) await new Promise((r) => setTimeout(r, SCAN_DELAY));
    let st;
    try { st = await fsp.stat(file); } catch { return null; }
    const prev = previous.get(file);
    if (prev && prev.mtime === st.mtimeMs && prev.reader === READER && fs.existsSync(path.join(COVERS, prev.albumId + '.jpg'))) return { track: prev };
    try {
      const m = await parseFile(file, { duration: true });
      const c = m.common;
      const fb = fromFolder(file);
      const hasTags = !!(c.album || c.artist);
      const artist = c.artist || c.albumartist || fb.artist;
      const album = cleanAlbum(c.album || fb.album);
      const dir = path.dirname(file);
      const albumDir = /^(cd|disc|disque|disk)\s*\d+$/i.test(path.basename(dir)) ? path.dirname(dir) : dir;
      let title = c.title || path.basename(file, path.extname(file)).replace(/^\d+[\s.\-_]+/, '');
      const prefix = new RegExp('^' + artist.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*-\\s*', 'i');
      title = title.replace(prefix, '');
      const discFromAlbum = (c.album || '').match(/(?:cd|disc|disque)\s*(\d+)/i);
      const discFromDir = path.basename(dir).match(/^(?:cd|disc|disque|disk)\s*(\d+)$/i);
      // nommage « 101-titre », « 201-titre » (disque puis numéro sur 2 chiffres), quand les étiquettes ne disent rien du disque
      const n = path.basename(file).match(/^([1-9])(\d\d)(?!\d)/);
      const discFromName = n && !c.disk?.no && Number(n[2]) === (c.track?.no || Number(n[2])) ? n[1] : null;
      var t = {
        id: hash(file),
        path: file,
        albumDir,
        hasTags,
        mtime: st.mtimeMs,
        size: st.size,
        title,
        artist,
        taggedAlbumArtist: c.albumartist || null,
        album,
        trackNo: c.track?.no || 0,
        disc: c.disk?.no || Number(discFromAlbum?.[1] || discFromDir?.[1] || discFromName || 1),
        year: c.year || null,
        genre: c.genre?.[0] || null,
        duration: m.format.duration || 0,
        reader: READER,
        codec: m.format.codec || path.extname(file).slice(1).toUpperCase(),
        bits: m.format.bitsPerSample || null,
        rate: m.format.sampleRate || null,
        bitrate: m.format.bitrate || null,
        lossless: !!m.format.lossless,
      };
      const pic = c.picture?.find((p) => /front/i.test(p.type || '')) || c.picture?.[0];
      return { track: t, pic, key: t.albumDir + '|' + norm(album) };
    } catch (e) {
      console.warn('Lecture impossible :', file, e.message);
      return null;
    }
  };
  const results = new Array(files.length);
  let nextFile = 0;
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (nextFile < files.length) { const i = nextFile++; results[i] = await read(files[i]); scanProgress.done++; }
  }));
  for (const r of results) {
    if (!r) continue;
    tracks.push(r.track);
    if (r.pic && !pictures.has(r.key)) pictures.set(r.key, r.pic);
  }

  assignAlbums(tracks, pictures);

  // Regroupement en albums
  const albums = new Map();
  for (const t of tracks) {
    let a = albums.get(t.albumId);
    if (!a) {
      a = { id: t.albumId, title: t.album, artist: t.albumArtist, artistId: t.artistId, year: t.year, genre: t.genre, tracks: [], dirs: new Set(), duration: 0 };
      albums.set(t.albumId, a);
    }
    a.tracks.push(t.id);
    a.dirs.add(path.dirname(t.path));
    a.duration += t.duration;
    a.year = a.year || t.year;
    a.genre = a.genre || t.genre;
  }
  const byId = new Map(tracks.map((t) => [t.id, t]));
  scanProgress = { phase: 'covers', done: 0, total: albums.size };
  // albums préparés quatre à la fois (pochettes : extraction et redimensionnement)
  const queue = [...albums.values()];
  const prepare = async (a) => {
    a.tracks.sort((x, y) => { const X = byId.get(x), Y = byId.get(y); return X.disc - Y.disc || X.trackNo - Y.trackNo || X.path.localeCompare(Y.path); });
    const first = byId.get(a.tracks[0]);
    a.format = first.lossless && first.bits ? `${first.codec} ${first.bits} bits · ${(first.rate / 1000).toLocaleString('fr-FR')} kHz` : `${codecName(first)}${first.bitrate ? ' · ' + Math.round(first.bitrate / 1000) + ' kb/s' : ''}`;
    // titres avec perte (MP3, AAC…) : signalés dans l'interface et tenus dans un journal
    const lossy = a.tracks.map((id) => byId.get(id)).filter((t) => !t.lossless);
    a.lossy = lossy.length;
    a.lossyCodec = lossy.length ? [...new Set(lossy.map(codecName))].join(', ') : null;
    a.discs = new Set(a.tracks.map((id) => byId.get(id).disc)).size;
    a.hasCover = await ensureCover(a, pictures.get(a.id));
    // date de création du dossier sur ce disque (sert seulement à dater les albums déjà là au premier passage)
    a.born = Math.min(...[...a.dirs].map((d) => { try { const st = fs.statSync(d); return st.birthtimeMs > 0 ? st.birthtimeMs : st.mtimeMs; } catch { return Date.now(); } }));
    a.dirs = undefined;
  };
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) { await prepare(queue.shift()); scanProgress.done++; } }));

  // Artistes
  const artists = new Map();
  for (const a of albums.values()) {
    let ar = artists.get(a.artistId);
    if (!ar) { ar = { id: a.artistId, name: a.artist, albums: [], genres: new Set() }; artists.set(a.artistId, ar); }
    ar.albums.push(a.id);
    if (a.genre) ar.genres.add(a.genre);
  }
  for (const ar of artists.values()) {
    ar.albums.sort((x, y) => (albums.get(x).year || 0) - (albums.get(y).year || 0));
    ar.genres = [...ar.genres];
  }

  const next = {
    albums: [...albums.values()].sort((x, y) => x.artist.localeCompare(y.artist, 'fr') || (x.year || 0) - (y.year || 0)),
    artists: [...artists.values()].sort((x, y) => x.name.localeCompare(y.name, 'fr')),
    tracks,
    scannedAt: new Date().toISOString(),
  };
  // la nouvelle bibliothèque n'est publiée qu'une fois complète (dates d'ajout comprises) : une requête
  // pendant la réindexation voit l'ancienne, jamais une version à moitié prête
  await updateAddedLog(next).catch((e) => console.warn('Journal des ajouts :', e.message));
  library = next;
  await fsp.writeFile(LIB_FILE, JSON.stringify(library));
  await updateLossyLog().catch((e) => console.warn('Journal MP3 :', e.message));
  scanning = false;
  hitIndex = null;
  if (rescanAfter) { rescanAfter = false; setTimeout(scan, 100); }
  setTimeout(syncMetadata, 1000);
  setTimeout(analyseQuality, 1500);
  console.log(`Indexation : ${tracks.length} titres, ${albums.size} albums, ${artists.size} artistes en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

// Nom lisible d'un format avec perte (« MPEG 1 Layer 3 » -> « MP3 »)
function codecName(t) {
  const c = t.codec || '';
  if (/layer\s*3|^mp3$/i.test(c)) return 'MP3';
  if (/aac|mp4a|alac/i.test(c)) return /alac/i.test(c) ? 'ALAC' : 'AAC';
  if (/vorbis|^ogg$/i.test(c)) return 'Ogg Vorbis';
  if (/opus/i.test(c)) return 'Opus';
  return c || path.extname(t.path || '').slice(1).toUpperCase();
}

// ---------- Journal des albums avec perte (cache/lossy-log.json) ----------
// albumId -> { artist, title, year, firstSeen, resolvedAt } ; resolvedAt est daté quand l'album
// n'est plus avec perte (remplacé par du FLAC, ou retiré du dossier).
async function readLossyLog() { try { return JSON.parse(await fsp.readFile(LOSSY_LOG, 'utf8')); } catch { return {}; } }
async function updateLossyLog() {
  const log = await readLossyLog();
  const now = new Date().toISOString();
  const current = new Set();
  for (const a of library.albums) {
    if (!a.lossy) continue;
    current.add(a.id);
    const e = log[a.id];
    log[a.id] = { artist: a.artist, title: a.title, year: a.year || null, codec: a.lossyCodec, firstSeen: e?.firstSeen || now, resolvedAt: null };
  }
  for (const [id, e] of Object.entries(log)) if (!current.has(id) && !e.resolvedAt) e.resolvedAt = now;
  await fsp.writeFile(LOSSY_LOG, JSON.stringify(log, null, 1));
}
// Date d'ajout : au tout premier passage, celle du dossier ; ensuite, le moment où l'app découvre l'album
// (un album recopié depuis une vieille sauvegarde garde sa date de dossier, mais il est bien « récent » ici).
async function updateAddedLog(lib) {
  let log = null;
  try { log = JSON.parse(await fsp.readFile(ADDED_LOG, 'utf8')); } catch {}
  const seeding = !log; log ||= {};
  const now = new Date().toISOString();
  let changed = seeding;
  for (const a of lib.albums) {
    if (!log[a.id]) { log[a.id] = seeding ? new Date(a.born).toISOString() : now; changed = true; }
    a.added = log[a.id];
    delete a.born;
  }
  if (changed) await fsp.writeFile(ADDED_LOG, JSON.stringify(log));
}
// ---------- Qualité réelle des MP3 (cache/quality.json) ----------
// trackId -> { sig, cut, drop, verdict } ; sig = taille + date du fichier : un MP3 remplacé est réanalysé.
// Hors connexion, en arrière-plan après chaque indexation ; les fichiers ne sont que lus.
let quality = null, qualityRun = null, qualityAgain = false, qualityStop = null;
const qualityProgress = { done: 0, total: 0 };
const isMp3 = (t) => codecName(t) === 'MP3';
const sigOf = (t) => `${t.size}:${t.mtime}`;
function loadQuality() {
  if (!quality) { try { quality = JSON.parse(fs.readFileSync(QUALITY_FILE, 'utf8')); } catch { quality = {}; } }
  return quality;
}
async function analyseQuality() {
  if (!qualityOn()) return;
  if (qualityRun) { qualityAgain = true; return qualityRun; }
  qualityRun = (async () => {
    const q = loadQuality();
    const tracks = library.tracks.filter(isMp3);
    const ids = new Set(tracks.map((t) => t.id));
    for (const id of Object.keys(q)) if (!ids.has(id)) delete q[id]; // titres disparus
    const jobs = tracks.filter((t) => q[t.id]?.sig !== sigOf(t)).map((t) => ({ id: t.id, file: t.path, kbps: Math.round((t.bitrate || 0) / 1000), sig: sigOf(t) }));
    Object.assign(qualityProgress, { done: 0, total: jobs.length });
    if (!jobs.length) return;
    console.log(`Qualité réelle : analyse de ${jobs.length} titre(s) MP3…`);
    const sig = new Map(jobs.map((j) => [j.id, j.sig]));
    let unsaved = 0;
    const save = () => fsp.writeFile(QUALITY_FILE, JSON.stringify(q)).catch(() => {});
    qualityStop = new AbortController();
    await analyseInBackground(jobs.map(({ sig: _, ...j }) => j), (id, r) => {
      q[id] = { sig: sig.get(id), ...r };
      qualityProgress.done++;
      if (++unsaved >= 25) { unsaved = 0; save(); }
    }, { signal: qualityStop.signal });
    await save();
    const faux = jobs.filter((j) => q[j.id]?.verdict === 'faux').length, gonfle = jobs.filter((j) => q[j.id]?.verdict === 'gonfle').length;
    console.log(`Qualité réelle : terminé (${faux} faux, ${gonfle} gonflé(s))`);
  })().finally(() => { qualityRun = null; qualityStop = null; if (qualityAgain) { qualityAgain = false; analyseQuality(); } });
  return qualityRun;
}
// Verdict d'un album (null : pas de MP3, ou pas encore analysé)
function albumQuality(a) {
  if (!qualityOn()) return null;
  const q = loadQuality(), byId = new Map(library.tracks.map((t) => [t.id, t]));
  const tracks = a.tracks.map((id) => byId.get(id)).filter((t) => t && isMp3(t));
  if (!tracks.length) return null;
  const v = albumVerdict(tracks.map((t) => (q[t.id]?.sig === sigOf(t) ? q[t.id] : null)));
  if (!v) return null;
  const kbps = tracks.map((t) => Math.round((t.bitrate || 0) / 1000)).sort((x, y) => x - y);
  return { ...v, kbps: kbps[Math.floor(kbps.length / 2)], tracks: tracks.length };
}
const qualityLabel = (r) => (!r?.verdict ? '' : r.verdict === 'ok' ? 'conforme' : `${r.verdict === 'faux' ? 'faux' : 'gonflé'} (coupure à ${(r.cut / 1000).toLocaleString('fr-FR')} kHz)`);

const csvCell = (v) => { const s = v == null ? '' : String(v); return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function lossyCsv() {
  const albums = new Map(library.albums.map((a) => [a.id, a]));
  const rows = library.tracks.filter((t) => !t.lossless)
    .sort((x, y) => x.albumArtist.localeCompare(y.albumArtist, 'fr') || x.album.localeCompare(y.album, 'fr') || x.disc - y.disc || x.trackNo - y.trackNo)
    .map((t) => {
      const q = qualityOn() && isMp3(t) && loadQuality()[t.id]?.sig === sigOf(t) ? loadQuality()[t.id] : null;
      return [t.albumArtist, albums.get(t.albumId)?.title || t.album, t.year, t.title, codecName(t), t.bitrate ? Math.round(t.bitrate / 1000) : '', qualityLabel(q), path.relative(MUSIC_DIR, t.path)];
    });
  // point-virgule + BOM : s'ouvre directement dans Numbers et dans Excel en français
  return '\ufeff' + [['Artiste', 'Album', 'Année', 'Titre', 'Format', 'Débit (kb/s)', 'Qualité réelle', 'Fichier (dans le dossier de musique)'], ...rows].map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

// Un album = un dossier (les sous-dossiers CD1/CD2 remontent au parent) + un titre.
// L'artiste de l'album = tag « album artist », sinon l'artiste principal le plus fréquent
// (« Eminem & Dido » -> « Eminem »). Rien n'est écrit dans les fichiers.
function assignAlbums(tracks, pictures) {
  const most = (arr) => { const c = new Map(); for (const x of arr) if (x) c.set(x, (c.get(x) || 0) + 1); return [...c].sort((a, b) => b[1] - a[1])[0]?.[0]; };
  const byDir = new Map();
  for (const t of tracks) { if (!byDir.has(t.albumDir)) byDir.set(t.albumDir, []); byDir.get(t.albumDir).push(t); }
  for (const list of byDir.values()) {
    const tagged = list.filter((t) => t.hasTags);
    if (tagged.length) for (const t of list) if (!t.hasTags) {
      t.album = most(tagged.map((x) => x.album)); t.artist = most(tagged.map((x) => x.artist));
      t.year = t.year || most(tagged.map((x) => x.year)); t.genre = t.genre || most(tagged.map((x) => x.genre));
    }
    const groups = new Map();
    for (const t of list) { const k = norm(t.album); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    for (const [k, g] of groups) {
      const main = (a) => a.split(/\s*(?:&|,|\bfeat\.?|\bft\.|\bvs\.?|\bet\b)\s*/i)[0].trim();
      const albumArtist = most(g.map((t) => t.taggedAlbumArtist)) || most(g.map((t) => main(t.artist)));
      const key = g[0].albumDir + '|' + k;
      const albumId = hash(norm(albumArtist) + '|' + k + '|' + g[0].albumDir);
      if (pictures.has(key)) pictures.set(albumId, pictures.get(key));
      for (const t of g) { t.albumArtist = albumArtist; t.albumId = albumId; t.artistId = hash(norm(albumArtist)); }
    }
  }
}

// ---------- Pochettes ----------
// Image illisible (fichier abîmé, format exotique) : on garde l'original tel quel, le navigateur saura souvent l'afficher
async function resize(src, dest) {
  try { await toJpeg(src, dest, { max: 1000, quality: 88 }); } catch { await fsp.copyFile(src, dest); }
}

async function ensureCover(album, picture) {
  const dest = path.join(COVERS, album.id + '.jpg');
  if (fs.existsSync(dest)) return true;
  const tmp = path.join(COVERS, album.id + '.src');
  try {
    if (picture) {
      await fsp.writeFile(tmp, picture.data);
    } else {
      // Image dans le dossier : cover/folder/front d'abord, jamais le verso ni le CD
      let best = null, bestScore = -1;
      for (const dir of album.dirs) {
        for (const d of [dir, path.dirname(dir)]) {
          let names = [];
          try { names = await fsp.readdir(d); } catch {}
          for (const n of names) {
            if (!/\.(jpe?g|png|webp)$/i.test(n)) continue;
            if (/back|verso|cd\d*\.|disc|inlay|tray|inside|booklet|rear/i.test(n)) continue;
            const score = /^(cover|folder|front|album)/i.test(n) ? 2 : 1;
            if (score > bestScore) { best = path.join(d, n); bestScore = score; }
          }
          if (best) break;
        }
      }
      if (best) await fsp.copyFile(best, tmp);
      else if (!(await downloadCover(album, tmp))) return false;
    }
    await resize(tmp, dest);
    return true;
  } catch (e) {
    console.warn('Pochette :', album.title, e.message);
    return false;
  } finally {
    fsp.rm(tmp, { force: true }).catch(() => {});
  }
}

async function downloadCover(album, dest) {
  try {
    const q = encodeURIComponent(`${album.artist} ${album.title}`);
    // un seul essai : l'indexation ne doit pas attendre le réseau (sans connexion, ~20 s par album sans pochette) ;
    // la pochette est retentée à la prochaine indexation
    const r = await fetchJSON(`https://itunes.apple.com/search?term=${q}&entity=album&limit=5`, 1);
    const hit = r.results?.find((x) => norm(x.artistName).includes(norm(album.artist).slice(0, 6))) || r.results?.[0];
    if (!hit) return false;
    const url = hit.artworkUrl100.replace('100x100bb', '1200x1200bb');
    const img = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (!img.ok) return false;
    await fsp.writeFile(dest, Buffer.from(await img.arrayBuffer()));
    return true;
  } catch { return false; }
}

// ---------- Métadonnées en ligne (mises en cache) ----------
async function fetchJSON(url, tries = 4) {
  for (let i = 1; ; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (r.status === 429 || r.status >= 500) throw Object.assign(new Error(`${r.status} ${url}`), { retry: true });
      if (!r.ok) throw new Error(`${r.status} ${url}`);
      return await r.json();
    } catch (e) {
      const retry = e.retry || e.name === 'TimeoutError' || e.name === 'TypeError';
      if (!retry || i >= tries) throw e;
      await new Promise((res) => setTimeout(res, 1500 * i * i));
    }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mbQueue = Promise.resolve();
// MusicBrainz impose ~1 requête/s : on les met en file.
function musicbrainz(url) {
  const p = mbQueue.then(() => fetchJSON(url));
  mbQueue = p.catch(() => {}).then(() => sleep(1100));
  return p;
}
const luc = (s) => s.replace(/[\\+\-!(){}\[\]^"“”~*?:\/&|…]/g, ' ').replace(/\s+/g, ' ').trim();
const baseTitle = (t) => t.replace(/\s*[\[(].*?[\])]/g, '').replace(/[“”"]/g, '').trim() || t;
const MUSIC_WORDS = /(groupe|chanteu|musicien|rappeu|compositeu|guitariste|pianiste|auteur-compositeur|band|singer|musician|rapper|guitarist|pianist|songwriter|composer|DJ)/i;

async function wikiSummary(lang, title) {
  const p = await fetchJSON(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title.replace(/ /g, '_'))}`);
  if (p.type === 'disambiguation' || !p.extract) return null;
  return { title: p.title, extract: p.extract, url: p.content_urls?.desktop?.page, image: p.originalimage?.source || p.thumbnail?.source, lang };
}
async function wikiFromRelations(relations = []) {
  const wd = relations.find((r) => r.type === 'wikidata')?.url?.resource?.match(/Q\d+/)?.[0];
  if (!wd) return null;
  const d = await fetchJSON(`https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${wd}&props=sitelinks&sitefilter=frwiki|enwiki&format=json`);
  const links = d.entities?.[wd]?.sitelinks || {};
  for (const lang of ['fr', 'en']) {
    const t = links[lang + 'wiki']?.title;
    if (t) { const w = await wikiSummary(lang, t).catch(() => null); if (w) return w; }
  }
  return null;
}
// Repli : recherche plein texte, avec contrôle que la page parle bien de musique / de l'artiste
async function wikiSearch(query, mustContain, check) {
  for (const lang of ['fr', 'en']) {
    try {
      const s = await fetchJSON(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=6&srsearch=${encodeURIComponent(query)}`);
      for (const h of s.query?.search || []) {
        if (!norm(h.title).includes(norm(mustContain))) continue;
        const w = await wikiSummary(lang, h.title).catch(() => null);
        if (w && check(w.extract)) return w;
      }
    } catch {}
  }
  return null;
}

async function findReleaseGroup(al) {
  const q = `releasegroup:(${luc(baseTitle(al.title))}) AND artist:(${luc(al.artist)})`;
  const r = await musicbrainz(`https://musicbrainz.org/ws/2/release-group/?query=${encodeURIComponent(q)}&fmt=json&limit=8`);
  const rgs = (r['release-groups'] || []).filter((g) => (g['artist-credit'] || []).some((c) => norm(c.name).includes(norm(al.artist)) || norm(al.artist).includes(norm(c.name))));
  const t = norm(baseTitle(al.title));
  return rgs.find((g) => norm(g.title) === t && g['primary-type'] === 'Album') || rgs.find((g) => norm(g.title) === t) || rgs.find((g) => g.score >= 90) || null;
}

const metaMem = new Map(); // clé -> contenu des fichiers cache/meta/*.json
for (const f of fs.readdirSync(META)) if (f.endsWith('.json')) { try { metaMem.set(f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(META, f), 'utf8'))); } catch {} }
async function saveMeta(key, data) { metaMem.set(key, data); await fsp.writeFile(path.join(META, key + '.json'), JSON.stringify(data)); }
async function cached(key, fn) {
  if (metaMem.has(key)) return metaMem.get(key);
  const { data, complete } = await fn();
  if (complete) await saveMeta(key, data); // on ne fige pas un résultat incomplet (réseau coupé)
  return data;
}

async function deezerArtist(name) {
  const r = await fetchJSON(`https://api.deezer.com/search/artist?q=${encodeURIComponent(name)}&limit=10`);
  const exact = (r.data || []).filter((d) => norm(d.name) === norm(name)).sort((a, b) => b.nb_fan - a.nb_fan);
  return exact[0] || null;
}

async function artistPicture(ar) {
  return cached('pic-' + ar.id, async () => {
    try { const d = await deezerArtist(ar.name); return { data: { picture: d?.picture_xl || null, fans: d?.nb_fan }, complete: true }; }
    catch { return { data: {}, complete: false }; }
  });
}

// Photos d'artistes : TheAudioDB (portrait + grand visuel), repli sur l'image Wikipédia.
let adbQueue = Promise.resolve();
function audiodbFetch(url) { const p = adbQueue.then(() => fetchJSON(url)); adbQueue = p.catch(() => {}).then(() => sleep(400)); return p; }
async function audiodb(ar) {
  return cached('adb-' + ar.id, async () => {
    try {
      const r = await audiodbFetch(`https://www.theaudiodb.com/api/v1/json/123/search.php?s=${encodeURIComponent(ar.name)}`);
      const a = (r.artists || []).find((x) => norm(x.strArtist) === norm(ar.name)) || r.artists?.[0];
      return { data: { thumb: a?.strArtistThumb || null, fanart: a?.strArtistFanart || a?.strArtistFanart2 || a?.strArtistWideThumb || null }, complete: true };
    } catch { return { data: { failed: true }, complete: false }; }
  });
}
const imgJobs = new Map();
function artistImage(ar, kind) {
  const dest = path.join(ARTIST_IMG, `${ar.id}-${kind}.jpg`);
  if (fs.existsSync(dest)) return Promise.resolve(dest);
  if (fs.existsSync(dest + '.none')) return Promise.resolve(null);
  const key = ar.id + kind;
  if (!imgJobs.has(key)) imgJobs.set(key, (async () => {
    const adb = await audiodb(ar);
    if (adb.failed) { imgJobs.delete(key); return null; } // hors ligne : on réessaiera
    let url = kind === 'thumb' ? adb.thumb : adb.fanart;
    if (!url && kind === 'thumb') {
      const info = await readMeta('artist-' + ar.id);
      if (!info) { imgJobs.delete(key); return null; } // fiche pas encore récupérée
      url = info.wiki?.image;
    }
    if (!url) { await fsp.writeFile(dest + '.none', ''); imgJobs.delete(key); return null; }
    const tmp = dest + '.src';
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(r.status);
      await fsp.writeFile(tmp, Buffer.from(await r.arrayBuffer()));
      await toJpeg(tmp, dest, { max: kind === 'thumb' ? 600 : 1920, quality: 85 });
      return dest;
    } catch { return null; } finally { fsp.rm(tmp, { force: true }).catch(() => {}); imgJobs.delete(key); }
  })());
  return imgJobs.get(key);
}

async function artistInfo(ar) {
  return cached('artist-' + ar.id, async () => {
    const out = { name: ar.name };
    let ok = true;
    const pic = await artistPicture(ar);
    Object.assign(out, pic);
    try {
      // 1) identifier l'artiste via un de ses albums (évite les homonymes)
      let mbid = null;
      for (const albumId of ar.albums.slice(0, 3)) {
        const al = library.albums.find((a) => a.id === albumId);
        const rg = al && await findReleaseGroup(al);
        const credit = rg?.['artist-credit']?.find((c) => norm(c.name).includes(norm(ar.name)) || norm(ar.name).includes(norm(c.name)));
        if (credit) { mbid = credit.artist.id; break; }
      }
      if (!mbid) {
        const r = await musicbrainz(`https://musicbrainz.org/ws/2/artist/?query=${encodeURIComponent(`artist:"${luc(ar.name)}"`)}&fmt=json&limit=5`);
        mbid = r.artists?.find((a) => norm(a.name) === norm(ar.name))?.id;
      }
      if (mbid) {
        const m = await musicbrainz(`https://musicbrainz.org/ws/2/artist/${mbid}?inc=url-rels+genres+tags&fmt=json`);
        out.mbid = mbid;
        out.type = m.type === 'Group' ? 'Groupe' : m.type === 'Person' ? 'Artiste' : m.type;
        out.country = m.area?.name;
        out.beginArea = m['begin-area']?.name;
        out.begin = m['life-span']?.begin;
        out.end = m['life-span']?.ended ? m['life-span']?.end : null;
        out.tags = [...(m.genres || []), ...(m.tags || [])].sort((a, b) => b.count - a.count).map((t) => t.name).filter((v, i, a) => a.indexOf(v) === i).slice(0, 6);
        out.wiki = await wikiFromRelations(m.relations);
      }
    } catch (e) { ok = false; console.warn('MusicBrainz artiste', ar.name, e.message); }
    if (!out.wiki) out.wiki = await wikiSearch(`${ar.name} musique`, ar.name, (x) => MUSIC_WORDS.test(x));
    if (!out.wiki && !out.mbid && !ok) return { data: out, complete: false };
    return { data: out, complete: ok };
  });
}

async function albumInfo(al) {
  return cached('album-' + al.id, async () => {
    const out = {};
    let ok = true;
    try {
      const rg = await findReleaseGroup(al);
      if (rg) {
        out.firstRelease = rg['first-release-date'];
        out.type = rg['primary-type'];
        const full = await musicbrainz(`https://musicbrainz.org/ws/2/release-group/${rg.id}?inc=url-rels+genres&fmt=json`);
        out.genres = (full.genres || []).sort((a, b) => b.count - a.count).slice(0, 4).map((g) => g.name);
        out.wiki = await wikiFromRelations(full.relations);
      }
    } catch (e) { ok = false; console.warn('MusicBrainz album', al.title, e.message); }
    try {
      const r = await fetchJSON(`https://api.deezer.com/search/album?q=${encodeURIComponent(`artist:"${al.artist}" album:"${baseTitle(al.title)}"`)}&limit=5`);
      const dz = (r.data || []).find((d) => norm(baseTitle(d.title)) === norm(baseTitle(al.title))) || r.data?.[0];
      if (dz) {
        const full = await fetchJSON(`https://api.deezer.com/album/${dz.id}`);
        out.label = full.label;
        if (!out.genres?.length) out.genres = full.genres?.data?.map((g) => g.name);
      }
    } catch { ok = false; }
    if (!out.wiki) {
      const t = baseTitle(al.title);
      out.wiki = await wikiSearch(`${t} album ${al.artist}`, t, (x) => norm(x).includes(norm(al.artist)) && /album|disque|compilation|live/i.test(x));
    }
    return { data: out, complete: ok };
  });
}

// ---------- Synchronisation des métadonnées (seul endroit qui touche Internet) ----------
// L'interface ne lit que le cache local : l'app fonctionne entièrement hors ligne.
// Quand un album/artiste n'a pas encore ses infos, elles sont rapatriées ici, une seule fois.
async function readMeta(key) { return metaMem.get(key) || null; }
const hasMeta = (key) => metaMem.has(key);
const hasImg = (ar, kind) => fs.existsSync(path.join(ARTIST_IMG, `${ar.id}-${kind}.jpg`)) || fs.existsSync(path.join(ARTIST_IMG, `${ar.id}-${kind}.jpg.none`));
// Titres très connus : classement de popularité Deezer des morceaux de chaque artiste
const HIT_RANK = 800000; // au-delà : les grands classiques (Nothing Else Matters, Seven Nation Army…)
const baseSong = (t) => norm(String(t).replace(/\s*[\[(].*?[\])]/g, '').replace(/\s+-\s+.*(remaster|live|version|edit|mix|mono|stereo).*$/i, '')).replace(/[^a-z0-9]+/g, ' ').trim();
async function fetchTopTracks(ar) {
  try {
    const dz = await deezerArtist(ar.name);
    if (!dz) { await saveMeta('top-' + ar.id, { tracks: [] }); return; }
    const r = await fetchJSON(`https://api.deezer.com/artist/${dz.id}/top?limit=30`);
    await saveMeta('top-' + ar.id, { tracks: (r.data || []).map((t) => ({ title: t.title, rank: t.rank })) });
  } catch (e) { console.warn('Popularité', ar.name, e.message); }
}
let hitIndex = null; // artistId -> Map(titre normalisé -> rang)
function hitRank(t) {
  if (!hitIndex) {
    hitIndex = new Map();
    for (const ar of library.artists) {
      const m = new Map();
      for (const x of metaMem.get('top-' + ar.id)?.tracks || []) { const k = baseSong(x.title); m.set(k, Math.max(m.get(k) || 0, x.rank)); }
      hitIndex.set(ar.id, m);
    }
  }
  const r = /instrumental|karaok|a ?cappella|remix|demo\b/i.test(t.title) ? 0 : hitIndex.get(t.artistId)?.get(baseSong(t.title)) || 0;
  const auto = r >= HIT_RANK ? r : 0;
  const s = stars[starKey(t)];
  return s === undefined ? auto : s ? auto || HIT_RANK : 0; // étoile ajoutée à la main : rang le plus bas des classiques
}
// Étoiles choisies à la main : par artiste et titre (toutes les versions d'un même morceau, comme le classement Deezer)
let stars = {};
try { stars = JSON.parse(fs.readFileSync(STARS_FILE, 'utf8')); } catch {}
const starKey = (t) => t.artistId + '|' + baseSong(t.title);
function setStar(t, on) {
  const key = starKey(t);
  delete stars[key];
  if (!!hitRank(t) !== on) stars[key] = on; // seulement si différent du classement automatique
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(STARS_FILE, JSON.stringify(stars, null, 1));
  return Object.fromEntries(library.tracks.filter((x) => starKey(x) === key).map((x) => [x.id, hitRank(x)]));
}
// Titres « pas pour moi » : même clé que les étoiles (toutes les versions d'un morceau), sautés par le lecteur
let dislikes = {};
try { dislikes = JSON.parse(fs.readFileSync(DISLIKES_FILE, 'utf8')); } catch {}
function setDislike(t, on) {
  const key = starKey(t);
  if (on) dislikes[key] = true; else delete dislikes[key];
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(DISLIKES_FILE, JSON.stringify(dislikes, null, 1));
  return library.tracks.filter((x) => starKey(x) === key).map((x) => x.id);
}
// Nettoyage : les articles complets ne sont plus conservés (seule la première phrase est affichée)
for (const [key, m] of metaMem) if (m?.wiki?.full !== undefined) { delete m.wiki.full; saveMeta(key, m); }

function missing() {
  return {
    texts: library.artists.filter((ar) => !metaMem.has('top-' + ar.id)),
    artists: library.artists.filter((ar) => !hasMeta('artist-' + ar.id) || !hasImg(ar, 'thumb') || !hasImg(ar, 'fanart')),
    albums: library.albums.filter((al) => !hasMeta('album-' + al.id)),
  };
}
async function isOnline() {
  try { await fetch('https://musicbrainz.org/', { method: 'HEAD', signal: AbortSignal.timeout(5000) }); return true; } catch { return false; }
}
let syncing = false, lastSync = null, online = null;
async function syncMetadata() {
  if (syncing) return;
  const todo = missing();
  if (!todo.artists.length && !todo.albums.length && !todo.texts.length) return;
  syncing = true;
  try {
    online = await isOnline();
    if (!online) { console.log(`Hors ligne : ${todo.artists.length} artiste(s) et ${todo.albums.length} album(s) en attente de métadonnées`); return; }
    console.log(`Synchronisation : ${todo.artists.length} artiste(s), ${todo.albums.length} album(s), ${todo.texts.length} classement(s) de titres`);
    for (const ar of todo.artists) { await artistInfo(ar).catch(() => {}); await artistImage(ar, 'thumb'); await artistImage(ar, 'fanart'); }
    for (const al of todo.albums) await albumInfo(al).catch(() => {});
    for (const ar of todo.texts) { await fetchTopTracks(ar); await sleep(300); }
    hitIndex = null;
    lastSync = new Date().toISOString();
    const left = missing();
    console.log(`Synchronisation terminée (${left.artists.length + left.albums.length + left.texts.length} élément(s) restant(s))`);
  } finally { syncing = false; }
}
// Réessaie régulièrement s'il reste des éléments (ex. connexion revenue)
setInterval(syncMetadata, 15 * 60 * 1000).unref();

// ---------- Surveillance du dossier de musique ----------
let rescanTimer = null;
function scheduleRescan(delay = 20000) { clearTimeout(rescanTimer); rescanTimer = setTimeout(() => scan(), delay); }
let watcher = null;
function watchMusic() {
  watcher?.close(); watcher = null;
  if (!MUSIC_DIR) return;
  try {
    watcher = fs.watch(MUSIC_DIR, { recursive: true }, (_ev, file) => {
      if (!file) return;
      const ext = path.extname(file).toLowerCase();
      // nouveaux fichiers audio, images de pochette ou dossiers : on réindexe une fois la copie terminée
      if (AUDIO_EXT.has(ext) || /\.(jpe?g|png)$/i.test(ext) || !ext) scheduleRescan();
    });
    console.log('Surveillance de', MUSIC_DIR);
  } catch (e) { console.warn('Surveillance impossible :', e.message); }
}

// ---------- Premier lancement : choix du dossier de musique ----------
// Compte rapidement les fichiers audio d'un dossier (profondeur et nombre d'entrées limités)
async function countAudio(dir, { maxDepth = 6, maxEntries = 40000 } = {}) {
  let audio = 0, seen = 0;
  async function visit(d, depth) {
    if (depth > maxDepth || seen > maxEntries) return;
    let entries; try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (++seen > maxEntries) return;
      if (e.name.startsWith('.') || e.name.startsWith('$') || e.name === 'node_modules' || e.name.endsWith('.app') || e.name === 'Library' || e.name === 'AppData' || e.name === 'System Volume Information') continue;
      if (e.isDirectory()) await visit(path.join(d, e.name), depth + 1);
      else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) audio++;
    }
  }
  await visit(dir, 0);
  return { audio, partial: seen > maxEntries };
}
async function candidates() {
  const home = os.homedir();
  // dossiers personnels (noms anglais, et français des bureaux Linux), puis disques externes et clés USB
  const dirs = ['Music', 'Musique', 'Downloads', 'Téléchargements', 'Desktop', 'Bureau', 'Documents'].map((d) => path.join(home, d));
  const volumes = new Set(volumeDirs());
  const out = [], seen = new Set();
  for (const d of [...dirs, ...volumes]) {
    if (!fs.existsSync(d)) continue;
    let real = d; try { real = fs.realpathSync(d); } catch {}
    if (seen.has(real)) continue; // ex. Musique, lien vers Music
    seen.add(real);
    const { audio, partial } = await countAudio(d, { maxDepth: 5, maxEntries: 15000 });
    if (audio) out.push({ path: d, label: tilde(d), audio, partial, volume: volumes.has(d) });
  }
  return out.sort((a, b) => b.audio - a.audio);
}
async function setMusicDir(dir) {
  const full = path.resolve(expandHome(dir));
  let st; try { st = await fsp.stat(full); } catch { return { error: 'Ce dossier est introuvable.' }; }
  if (!st.isDirectory()) return { error: 'Ce chemin n’est pas un dossier.' };
  try { await fsp.access(full, fs.constants.R_OK); } catch { return { error: process.platform === 'darwin' ? 'Ce dossier n’est pas lisible (autorisations macOS ?).' : 'Ce dossier n’est pas lisible (autorisations ?).' }; }
  const { audio } = await countAudio(full, { maxDepth: 12, maxEntries: 400000 });
  if (!audio) return { error: 'Aucun fichier audio (FLAC, MP3, M4A…) trouvé dans ce dossier.' };
  MUSIC_DIR = full;
  writeConfig({ ...readConfig(), musicDir: full });
  console.log('Dossier de musique :', full);
  watchMusic();
  scan();
  return { ok: true, path: full, label: tilde(full), audio };
}
const readBody = (req, max = 10e6) => new Promise((res, rej) => { const chunks = []; let n = 0; req.on('data', (c) => { n += c.length; if (n > max) { rej(new Error('trop gros')); req.destroy(); } else chunks.push(c); }); req.on('end', () => res(Buffer.concat(chunks))); req.on('error', rej); });

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.aiff': 'audio/aiff', '.aif': 'audio/aiff' };

function json(res, data, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sendFile(req, res, file, extraHeaders = {}) {
  fs.stat(file, (err, st) => {
    if (err) { res.writeHead(404); return res.end(); }
    const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
    if (range) {
      const start = range[1] ? Number(range[1]) : st.size - Number(range[2]);
      const end = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start >= st.size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', ...extraHeaders });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', ...extraHeaders });
      fs.createReadStream(file).pipe(res);
    }
  });
}

// lan : requête arrivée par le réseau local (téléphone), filtrée par la télécommande
async function handle(req, res, lan = false) {
  const url = new URL(req.url, 'http://localhost');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  try {
    if (lan && !remote.gate(req, res, p)) return;
    if ((p === '/api/pair' || p.startsWith('/api/remote/')) && (await remote.route(req, res, p, url, lan))) return;
    if (p === '/api/library') {
      return json(res, {
        albums: library.albums.map((a) => { const m = metaMem.get('album-' + a.id) || {}; return { ...a, genres: m.genres || [], label: m.label || null, firstRelease: m.firstRelease || null }; }),
        artists: library.artists.map((a) => { const m = metaMem.get('artist-' + a.id) || {}; return { ...a, tags: m.tags || [], country: m.country || null, area: m.beginArea || null, kind: m.type || null, begin: m.begin || null }; }),
        tracks: library.tracks.map(({ path: _p, mtime: _m, albumDir: _d, ...t }) => ({ ...t, hit: hitRank(t), ...(dislikes[starKey(t)] ? { dislike: true } : {}) })),
        scannedAt: library.scannedAt,
        scanning, scanProgress,
        bytes: library.tracks.reduce((s, t) => s + (t.size || 0), 0),
        folder: tilde(MUSIC_DIR),
        needsSetup: !MUSIC_DIR,
        meta: (() => { const m = missing(); return { pendingArtists: m.artists.length, pendingAlbums: m.albums.length + m.texts.length, syncing, online, lastSync }; })(),
      });
    }
    if (p === '/api/status') {
      const m = missing();
      return json(res, { startedAt: STARTED_AT, pid: process.pid, scannedAt: library.scannedAt, scanning, scanProgress, needsSetup: !MUSIC_DIR, albums: library.albums.length, meta: { pendingArtists: m.artists.length, pendingAlbums: m.albums.length + m.texts.length, syncing, online, lastSync } });
    }
    if (p === '/api/lossy') {
      const log = await readLossyLog();
      return json(res, {
        albums: library.albums.filter((a) => a.lossy).map((a) => ({ id: a.id, firstSeen: log[a.id]?.firstSeen || null, quality: albumQuality(a) })),
        analysis: { ...qualityProgress, running: !!qualityRun, enabled: qualityOn(), mp3: library.tracks.filter(isMp3).length },
        history: Object.entries(log).filter(([, e]) => e.resolvedAt).map(([id, e]) => ({ id, ...e })).sort((x, y) => y.resolvedAt.localeCompare(x.resolvedAt)),
        files: library.tracks.filter((t) => !t.lossless).length,
      });
    }
    if (p === '/api/lossy.csv') {
      const day = new Date().toISOString().slice(0, 10);
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="albums-avec-perte-${day}.csv"`, 'Cache-Control': 'no-store' });
      return res.end(lossyCsv());
    }
    // analyse de la qualité réelle : { enabled: true } la lance, { enabled: false } l'arrête (résultats déjà obtenus gardés en cache)
    if (p === '/api/quality' && req.method === 'POST') {
      const { enabled } = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
      writeConfig({ ...readConfig(), qualityCheck: !!enabled });
      qualityEnabled = !!enabled;
      if (enabled) analyseQuality(); else { qualityAgain = false; qualityStop?.abort(); }
      return json(res, { enabled: !!enabled });
    }
    // étoile d'un titre : { id, star: true|false } ; renvoie { hits: { id du titre: rang } } pour toutes ses versions
    if (p === '/api/star' && req.method === 'POST') {
      const { id, star } = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
      const t = library.tracks.find((x) => x.id === id);
      if (!t) return json(res, { error: 'titre introuvable' }, 404);
      return json(res, { hits: setStar(t, !!star) });
    }
    // « pas pour moi » : { id, dislike: true|false } ; renvoie { ids, dislike } pour toutes les versions du morceau
    if (p === '/api/dislike' && req.method === 'POST') {
      const { id, dislike } = JSON.parse((await readBody(req, 1e4)).toString() || '{}');
      const t = library.tracks.find((x) => x.id === id);
      if (!t) return json(res, { error: 'titre introuvable' }, 404);
      return json(res, { ids: setDislike(t, !!dislike), dislike: !!dislike });
    }
    if (p === '/api/rescan' && req.method === 'POST') { scan(); return json(res, { ok: true }); }
    if (p === '/api/setup' && req.method === 'GET') return json(res, { musicDir: MUSIC_DIR, label: tilde(MUSIC_DIR), fromEnv: !!process.env.MUSIC_DIR, candidates: await candidates() });
    if (p === '/api/setup' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 1e5)).toString() || '{}');
      const r = await setMusicDir(body.musicDir);
      return json(res, r, r.error ? 400 : 200);
    }
    if (p === '/api/setup/pick' && req.method === 'POST') return json(res, await pickFolder());
    if (p === '/api/sync' && req.method === 'POST') { syncMetadata(); return json(res, { ok: true }); }
    let m;
    if ((m = p.match(/^\/api\/artist\/([\w]+)$/))) {
      const ar = library.artists.find((a) => a.id === m[1]);
      if (!ar) return json(res, {}, 404);
      const info = await readMeta('artist-' + ar.id);
      if (!info) syncMetadata();
      return json(res, info || { pending: true });
    }
    if ((m = p.match(/^\/api\/artist\/([\w]+)\/(picture|fanart)$/))) {
      const ar = library.artists.find((a) => a.id === m[1]);
      const file = ar && path.join(ARTIST_IMG, `${ar.id}-${m[2] === 'picture' ? 'thumb' : 'fanart'}.jpg`);
      if (!file || !fs.existsSync(file)) { res.writeHead(404, { 'Cache-Control': 'no-store' }); return res.end(); }
      return sendFile(req, res, file, { 'Cache-Control': 'public, max-age=86400' });
    }
    if ((m = p.match(/^\/api\/album\/([\w]+)$/))) {
      const al = library.albums.find((a) => a.id === m[1]);
      if (!al) return json(res, {}, 404);
      const info = await readMeta('album-' + al.id);
      if (!info) syncMetadata();
      return json(res, info || { pending: true });
    }
    if ((m = p.match(/^\/cover\/([\w]+)\.jpg$/))) {
      return sendFile(req, res, path.join(COVERS, m[1] + '.jpg'), { 'Cache-Control': 'public, max-age=86400' });
    }
    if ((m = p.match(/^\/audio\/([\w]+)$/))) {
      const t = library.tracks.find((x) => x.id === m[1]);
      return t ? sendFile(req, res, t.path) : (res.writeHead(404), res.end());
    }
    const file = path.join(ROOT, 'public', p.endsWith('/') ? p + 'index.html' : p);
    if (!file.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
    return sendFile(req, res, file, { 'Cache-Control': 'no-cache' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, { error: e.message }, 500); else res.end();
  }
}
const server = http.createServer((req, res) => handle(req, res, false));
const remote = createRemote({ cacheDir: CACHE, port: PORT, lanPort: Number(process.env.APPMUSIC_LAN_PORT || PORT), handler: handle, getLibrary: () => library });

try { library = JSON.parse(fs.readFileSync(LIB_FILE, 'utf8')); } catch {}

if (process.argv.includes('--sync')) {
  if (!MUSIC_DIR) { console.log('Aucun dossier de musique configuré : lancez l’app une première fois (npm start).'); process.exit(1); }
  // npm run sync : indexe la musique, rapatrie toutes les métadonnées manquantes, puis s'arrête
  await scan();
  await syncMetadata();
  const left = missing();
  console.log(left.artists.length + left.albums.length + left.texts.length ? `Il reste ${left.artists.length} artiste(s), ${left.albums.length} album(s) et ${left.texts.length} classement(s) à récupérer (connexion ?).` : 'Tout est disponible hors ligne.');
  process.exit(0);
} else {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`App Music : http://localhost:${PORT}  (musique : ${MUSIC_DIR || 'à choisir au premier lancement'})`);
    scan();
    watchMusic();
    firstRunShortcut();
    remote.refresh().catch(() => {});
  });
}
