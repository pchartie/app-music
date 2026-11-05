// Discothèque — serveur local : indexe la musique, sert l'audio, les pochettes et les métadonnées.
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { parseFile } from 'music-metadata';

const exec = promisify(execFile);
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(os.homedir(), 'Downloads');
const PORT = Number(process.env.PORT || 4321);
const CACHE = path.join(ROOT, 'cache');
const COVERS = path.join(CACHE, 'covers');
const META = path.join(CACHE, 'meta');
const ARTIST_IMG = path.join(CACHE, 'artists');
const LIB_FILE = path.join(CACHE, 'library.json');
const AUDIO_EXT = new Set(['.flac', '.mp3', '.m4a', '.aac', '.ogg', '.opus', '.wav', '.aiff', '.aif']);
const UA = 'Discotheque/1.0 (application musicale locale)';

for (const d of [CACHE, COVERS, META, ARTIST_IMG]) fs.mkdirSync(d, { recursive: true });

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();

let library = { albums: [], artists: [], tracks: [], scannedAt: null };
let scanning = false;
let scanProgress = { done: 0, total: 0 };

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

async function scan() {
  if (scanning) return;
  scanning = true;
  const t0 = Date.now();
  const previous = new Map(library.tracks.map((t) => [t.path, t]));
  const files = await walk(MUSIC_DIR);
  scanProgress = { done: 0, total: files.length };
  const tracks = [];
  const pictures = new Map(); // albumId -> embedded picture

  for (const file of files) {
    scanProgress.done++;
    let st;
    try { st = await fsp.stat(file); } catch { continue; }
    const prev = previous.get(file);
    if (prev && prev.mtime === st.mtimeMs && prev.size !== undefined && fs.existsSync(path.join(COVERS, prev.albumId + '.jpg'))) { tracks.push(prev); continue; }
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
        disc: c.disk?.no || Number(discFromAlbum?.[1] || discFromDir?.[1] || 1),
        year: c.year || null,
        genre: c.genre?.[0] || null,
        duration: m.format.duration || 0,
        codec: m.format.codec || path.extname(file).slice(1).toUpperCase(),
        bits: m.format.bitsPerSample || null,
        rate: m.format.sampleRate || null,
        bitrate: m.format.bitrate || null,
        lossless: !!m.format.lossless,
      };
      tracks.push(t);
      const pic = c.picture?.find((p) => /front/i.test(p.type || '')) || c.picture?.[0];
      if (pic && !pictures.has(t.albumDir + '|' + norm(album))) pictures.set(t.albumDir + '|' + norm(album), pic);
    } catch (e) {
      console.warn('Lecture impossible :', file, e.message);
    }
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
  for (const a of albums.values()) {
    a.tracks.sort((x, y) => { const X = byId.get(x), Y = byId.get(y); return X.disc - Y.disc || X.trackNo - Y.trackNo || X.path.localeCompare(Y.path); });
    const first = byId.get(a.tracks[0]);
    a.format = first.lossless && first.bits ? `${first.codec} ${first.bits} bits · ${(first.rate / 1000).toLocaleString('fr-FR')} kHz` : `${first.codec}${first.bitrate ? ' · ' + Math.round(first.bitrate / 1000) + ' kb/s' : ''}`;
    a.discs = new Set(a.tracks.map((id) => byId.get(id).disc)).size;
    a.hasCover = await ensureCover(a, pictures.get(a.id));
    a.dirs = undefined;
  }

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

  library = {
    albums: [...albums.values()].sort((x, y) => x.artist.localeCompare(y.artist, 'fr') || (x.year || 0) - (y.year || 0)),
    artists: [...artists.values()].sort((x, y) => x.name.localeCompare(y.name, 'fr')),
    tracks,
    scannedAt: new Date().toISOString(),
  };
  await fsp.writeFile(LIB_FILE, JSON.stringify(library));
  scanning = false;
  setTimeout(prewarm, 2000);
  console.log(`Indexation : ${tracks.length} titres, ${albums.size} albums, ${artists.size} artistes en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
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
async function resize(src, dest) {
  // sips est fourni avec macOS
  try {
    await exec('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '88', '-Z', '1000', src, '--out', dest]);
  } catch {
    await fsp.copyFile(src, dest);
  }
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
    const r = await fetchJSON(`https://itunes.apple.com/search?term=${q}&entity=album&limit=5`);
    const hit = r.results?.find((x) => norm(x.artistName).includes(norm(album.artist).slice(0, 6))) || r.results?.[0];
    if (!hit) return false;
    const url = hit.artworkUrl100.replace('100x100bb', '1200x1200bb');
    const img = await fetch(url, { headers: { 'User-Agent': UA } });
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

async function cached(key, fn) {
  const f = path.join(META, key + '.json');
  try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch {}
  const { data, complete } = await fn();
  if (complete) await fsp.writeFile(f, JSON.stringify(data)); // on ne fige pas un résultat incomplet (réseau coupé)
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
    } catch { return { data: {}, complete: false }; }
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
    let url = kind === 'thumb' ? adb.thumb : adb.fanart;
    if (!url && kind === 'thumb') {
      try { url = JSON.parse(await fsp.readFile(path.join(META, 'artist-' + ar.id + '.json'), 'utf8')).wiki?.image; } catch {}
      if (!url) url = (await artistInfo(ar)).wiki?.image;
    }
    if (!url) { await fsp.writeFile(dest + '.none', ''); return null; }
    const tmp = dest + '.src';
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(r.status);
      await fsp.writeFile(tmp, Buffer.from(await r.arrayBuffer()));
      await exec('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '85', '-Z', kind === 'thumb' ? '600' : '1920', tmp, '--out', dest]);
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

// Préchargement discret des métadonnées après l'indexation
let prewarming = false;
let lastUserRequest = 0;
const yieldToUser = async () => { while (Date.now() - lastUserRequest < 5000) await sleep(500); };
async function prewarm() {
  if (prewarming) return;
  prewarming = true;
  for (const ar of library.artists) { try { await yieldToUser(); await artistInfo(ar); await artistImage(ar, 'thumb'); await artistImage(ar, 'fanart'); } catch {} }
  for (const al of library.albums) { try { await yieldToUser(); await albumInfo(al); } catch {} }
  prewarming = false;
  console.log('Métadonnées en ligne : à jour');
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.flac': 'audio/flac', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.wav': 'audio/wav', '.aiff': 'audio/aiff', '.aif': 'audio/aiff' };

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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(url.pathname);
  if (p.startsWith('/api/artist') || p.startsWith('/api/album')) lastUserRequest = Date.now();
  try {
    if (p === '/api/library') {
      return json(res, {
        albums: library.albums,
        artists: library.artists,
        tracks: library.tracks.map(({ path: _p, mtime: _m, albumDir: _d, ...t }) => t),
        scannedAt: library.scannedAt,
        scanning, scanProgress,
        bytes: library.tracks.reduce((s, t) => s + (t.size || 0), 0),
        folder: MUSIC_DIR.replace(os.homedir(), '~'),
      });
    }
    if (p === '/api/rescan' && req.method === 'POST') { scan(); return json(res, { ok: true }); }
    let m;
    if ((m = p.match(/^\/api\/artist\/([\w]+)$/))) {
      const ar = library.artists.find((a) => a.id === m[1]);
      return ar ? json(res, await artistInfo(ar)) : json(res, {}, 404);
    }
    if ((m = p.match(/^\/api\/artist\/([\w]+)\/(picture|fanart)$/))) {
      const ar = library.artists.find((a) => a.id === m[1]);
      const file = ar && await artistImage(ar, m[2] === 'picture' ? 'thumb' : 'fanart');
      if (!file) { res.writeHead(404, { 'Cache-Control': 'max-age=3600' }); return res.end(); }
      return sendFile(req, res, file, { 'Cache-Control': 'public, max-age=86400' });
    }
    if ((m = p.match(/^\/api\/album\/([\w]+)$/))) {
      const al = library.albums.find((a) => a.id === m[1]);
      return al ? json(res, await albumInfo(al)) : json(res, {}, 404);
    }
    if ((m = p.match(/^\/cover\/([\w]+)\.jpg$/))) {
      return sendFile(req, res, path.join(COVERS, m[1] + '.jpg'), { 'Cache-Control': 'public, max-age=86400' });
    }
    if ((m = p.match(/^\/audio\/([\w]+)$/))) {
      const t = library.tracks.find((x) => x.id === m[1]);
      return t ? sendFile(req, res, t.path) : (res.writeHead(404), res.end());
    }
    const file = path.join(ROOT, 'public', p === '/' ? 'index.html' : p);
    if (!file.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); return res.end(); }
    return sendFile(req, res, file, { 'Cache-Control': 'no-cache' });
  } catch (e) {
    console.error(e);
    json(res, { error: e.message }, 500);
  }
});

try { library = JSON.parse(fs.readFileSync(LIB_FILE, 'utf8')); } catch {}
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Discothèque : http://localhost:${PORT}  (musique : ${MUSIC_DIR})`);
  scan();
});
