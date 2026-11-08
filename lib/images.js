// Pochettes et photos d'artistes : conversion en JPEG réduit, identique sur macOS, Linux et Windows (sharp).
// Si sharp manque (plateforme sans binaire précompilé), repli sur sips (macOS) puis sur une simple copie.
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
let sharpLib;
async function loadSharp() {
  if (sharpLib === undefined) {
    try { sharpLib = (await import('sharp')).default; sharpLib.cache(false); } catch { sharpLib = null; }
  }
  return sharpLib;
}

// src -> dest en JPEG, plus grand côté ≤ max (jamais agrandie), orientation EXIF appliquée, transparence sur blanc.
// Renvoie 'sharp', 'sips' ou 'copy' selon la méthode utilisée ; lève une erreur si la source est illisible.
export async function toJpeg(src, dest, { max = 1000, quality = 88 } = {}) {
  const sharp = await loadSharp();
  if (sharp) {
    // lecture en mémoire d'abord : sous Windows, un fichier ouvert par sharp ne pourrait pas être supprimé aussitôt
    const input = await fs.readFile(src);
    const out = await sharp(input, { failOn: 'none' }).rotate()
      .resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality, mozjpeg: true }).toBuffer();
    await fs.writeFile(dest, out);
    return 'sharp';
  }
  if (process.platform === 'darwin') {
    try {
      await exec('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', String(quality), '-Z', String(max), src, '--out', dest]);
      return 'sips';
    } catch {}
  }
  await fs.copyFile(src, dest);
  return 'copy';
}
