// Bibliothèque factice pour les tests : de vrais fichiers FLAC et MP3 (silence de 1 à 3 s) avec tags et pochettes,
// générés en JavaScript pur (ni ffmpeg ni flac requis). Rien de personnel : artistes et albums inventés.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

// ---------- Outils binaires ----------
const CRC32 = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC32[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const crc8 = (buf) => { let c = 0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff; } return c; };
const crc16 = (buf) => { let c = 0; for (const b of buf) { c ^= b << 8; for (let k = 0; k < 8; k++) c = c & 0x8000 ? ((c << 1) ^ 0x8005) & 0xffff : (c << 1) & 0xffff; } return c; };
const u32be = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u32le = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };

// PNG uni (pochette)
export function png(w, h, [r, g, b]) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const chunk = (type, data) => { const td = Buffer.concat([Buffer.from(type), data]); return Buffer.concat([u32be(data.length), td, u32be(crc32(td))]); };
  const ihdr = Buffer.concat([u32be(w), u32be(h), Buffer.from([8, 2, 0, 0, 0])]);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(Buffer.concat(Array(h).fill(row)))), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- FLAC (stéréo, blocs de 4096 échantillons, sous-trames CONSTANT = silence) ----------
const RATE_CODE = { 44100: 0b1001, 48000: 0b1010, 96000: 0b1011 };
const BPS_CODE = { 16: 0b100, 24: 0b110 };
export function flac({ tags = {}, seconds = 1, rate = 44100, bits = 16, picture = null }) {
  const BLOCK = 4096;
  const frames = Math.max(1, Math.round((seconds * rate) / BLOCK));
  if (frames >= 0xd800) throw new Error('durée trop longue pour ce générateur');
  const block = (type, data, last) => Buffer.concat([Buffer.from([(last ? 0x80 : 0) | type, data.length >> 16, (data.length >> 8) & 0xff, data.length & 0xff]), data]);
  // STREAMINFO
  const si = Buffer.alloc(34);
  si.writeUInt16BE(BLOCK, 0); si.writeUInt16BE(BLOCK, 2);
  const total = frames * BLOCK;
  // 20 bits fréquence, 3 bits canaux-1, 5 bits bps-1, 36 bits nombre d'échantillons
  const hi = BigInt(rate) << 44n | 1n << 41n | BigInt(bits - 1) << 36n | BigInt(total);
  si.writeBigUInt64BE(hi, 10);
  const blocks = [block(0, si)];
  const entries = Object.entries(tags).filter(([, v]) => v != null).map(([k, v]) => Buffer.from(`${k}=${v}`));
  if (entries.length) {
    const vendor = Buffer.from('app-music-tests');
    blocks.push(block(4, Buffer.concat([u32le(vendor.length), vendor, u32le(entries.length), ...entries.flatMap((e) => [u32le(e.length), e])])));
  }
  if (picture) {
    const mime = Buffer.from('image/png');
    blocks.push(block(6, Buffer.concat([u32be(3), u32be(mime.length), mime, u32be(0), u32be(0), u32be(0), u32be(24), u32be(0), u32be(picture.length), picture])));
  }
  blocks[blocks.length - 1][0] |= 0x80; // dernier bloc de métadonnées
  const out = [Buffer.from('fLaC'), ...blocks];
  for (let n = 0; n < frames; n++) {
    // numéro de trame codé « façon UTF-8 » (même schéma de bits que l'UTF-8 pour n < 0xD800)
    const head = Buffer.concat([Buffer.from([0xff, 0xf8, (0b1100 << 4) | RATE_CODE[rate], (0b0001 << 4) | (BPS_CODE[bits] << 1)]), Buffer.from(String.fromCodePoint(n), 'utf8')]);
    const sub = Buffer.concat([Buffer.from([0]), Buffer.alloc(bits / 8), Buffer.from([0]), Buffer.alloc(bits / 8)]);
    const frame = Buffer.concat([head, Buffer.from([crc8(head)]), sub]);
    const c = crc16(frame);
    out.push(frame, Buffer.from([c >> 8, c & 0xff]));
  }
  return Buffer.concat(out);
}

// ---------- MP3 (MPEG-1 couche III, 128 kb/s, 44,1 kHz, trames silencieuses) + ID3v2.3 ----------
export function mp3({ tags = {}, seconds = 1 }) {
  const ID = { title: 'TIT2', artist: 'TPE1', album: 'TALB', albumartist: 'TPE2', track: 'TRCK', year: 'TYER', genre: 'TCON' };
  const frames = Object.entries(tags).filter(([k, v]) => ID[k] && v != null).map(([k, v]) => {
    const body = Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(String(v), 'utf16le')]);
    return Buffer.concat([Buffer.from(ID[k]), u32be(body.length), Buffer.alloc(2), body]);
  });
  const id3body = Buffer.concat(frames);
  const n = id3body.length; const size = Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
  const id3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([3, 0, 0]), size, id3body]);
  const frame = Buffer.alloc(417); frame.set([0xff, 0xfb, 0x90, 0x00]);
  return Buffer.concat([id3, ...Array(Math.round((seconds * 44100) / 1152)).fill(frame)]);
}

// ---------- La bibliothèque ----------
// Chaque cas couvre une règle de l'indexation (voir server.js : scan, fromFolder, assignAlbums, ensureCover).
export const LIBRARY = [
  { dir: 'Les Étoiles Filantes - Nuit Blanche (1986)', cover: 'cover.png', color: [200, 40, 60], format: 'flac',
    album: 'Nuit Blanche', artist: 'Les Étoiles Filantes', year: 1986, genre: 'Rock',
    tracks: ['Minuit pile', 'Boulevard désert', 'Néons', 'Aube'] },
  { dir: 'Les Étoiles Filantes - Retour de flamme', embedded: true, color: [40, 120, 200], format: 'flac', bits: 24, rate: 96000,
    album: 'Retour de flamme', artist: 'Les Étoiles Filantes', year: 1991, genre: 'Rock',
    tracks: ['Étincelle', 'Braises', 'Cendres'] },
  // double album : sous-dossiers CD1/CD2 regroupés en un seul album
  { dir: 'Northern Lights Orchestra - Aurora', discs: { CD1: ['Polar Night', 'Solar Wind'], CD2: ['Magnetic Field', 'Dawn Chorus'] },
    cover: 'folder.png', color: [30, 160, 90], format: 'flac', album: 'Aurora', artist: 'Northern Lights Orchestra', year: 2009, genre: 'Classical' },
  // MP3, artistes « feat. » : l'artiste de l'album est l'artiste principal ; pas de pochette (hors ligne : aucune)
  { dir: 'Moka - Café Serré', format: 'mp3', album: 'Café Serré', year: 2003, genre: 'Hip Hop',
    tracks: [['Expresso', 'Moka & Bisou'], ['Allongé', 'Moka & Bisou'], ['Noisette', 'Moka feat. Sucre']], artist: 'Moka' },
  // sans aucun tag : tout vient du nom du dossier et des fichiers
  { dir: '1999 - Sans Tags - Album Fantôme', format: 'flac', untagged: true, cover: 'front.png', color: [120, 120, 120],
    tracks: ['01 - Premier', '02 - Second'] },
];

export function makeLibrary(root) {
  fs.mkdirSync(root, { recursive: true });
  for (const a of LIBRARY) {
    const base = path.join(root, a.dir);
    fs.mkdirSync(base, { recursive: true });
    const pic = a.color && png(64, 64, a.color);
    if (a.cover) fs.writeFileSync(path.join(base, a.cover), pic);
    const lists = a.discs ? Object.entries(a.discs) : [[null, a.tracks]];
    lists.forEach(([disc, list], d) => list.forEach((entry, i) => {
      const [title, artist] = Array.isArray(entry) ? entry : [entry, a.artist];
      const dir = disc ? path.join(base, disc) : base;
      fs.mkdirSync(dir, { recursive: true });
      const seconds = 1 + ((i + d) % 3) * 0.5;
      const tags = a.untagged ? {} : { TITLE: title, ARTIST: artist, ALBUM: a.album, TRACKNUMBER: i + 1, DISCNUMBER: disc ? d + 1 : null, DATE: a.year, GENRE: a.genre };
      if (a.format === 'mp3') {
        fs.writeFileSync(path.join(dir, `${String(i + 1).padStart(2, '0')} ${title}.mp3`), mp3({ seconds, tags: { title, artist, album: a.album, track: i + 1, year: a.year, genre: a.genre } }));
      } else {
        const name = a.untagged ? `${title}.flac` : `${String(i + 1).padStart(2, '0')} - ${title}.flac`;
        fs.writeFileSync(path.join(dir, name), flac({ seconds, tags, bits: a.bits || 16, rate: a.rate || 44100, picture: a.embedded ? pic : null }));
      }
    }));
  }
  // à ignorer : fichiers cachés, non audio, images de verso
  fs.writeFileSync(path.join(root, '.cache.flac'), 'pas un vrai fichier');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'bonjour');
  fs.writeFileSync(path.join(root, LIBRARY[0].dir, 'back.png'), png(8, 8, [0, 0, 0]));
  return root;
}

// Empreinte de tous les fichiers (contenu + date de modification) : la musique ne doit jamais être modifiée
export function fingerprint(root) {
  const out = {};
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const st = fs.statSync(p); out[path.relative(root, p)] = crypto.createHash('sha1').update(fs.readFileSync(p)).digest('hex') + ':' + st.mtimeMs; } } };
  walk(root);
  return out;
}

export const EXPECTED = {
  albums: LIBRARY.length,
  artists: new Set(LIBRARY.map((a) => a.artist || 'Sans Tags')).size,
  tracks: LIBRARY.reduce((n, a) => n + (a.discs ? Object.values(a.discs).flat().length : a.tracks.length), 0),
};
