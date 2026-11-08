// Pochettes : conversion en JPEG réduit, identique sur macOS, Linux et Windows (lib/images.js, sharp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { toJpeg } from '../lib/images.js';
import { png } from './fixtures.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-img-'));

test('grande image PNG : convertie en JPEG, plus grand côté ramené à la limite, proportions gardées', async () => {
  const d = tmp();
  try {
    const src = path.join(d, 'cover.png'), dest = path.join(d, 'out.jpg');
    fs.writeFileSync(src, png(1600, 800, [200, 40, 60]));
    assert.equal(await toJpeg(src, dest, { max: 1000 }), 'sharp');
    const m = await sharp(fs.readFileSync(dest)).metadata();
    assert.deepEqual([m.format, m.width, m.height], ['jpeg', 1000, 500]);
    fs.rmSync(src); // Windows : la source ne doit pas rester verrouillée
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('petite image : jamais agrandie', async () => {
  const d = tmp();
  try {
    const src = path.join(d, 'a.png'), dest = path.join(d, 'a.jpg');
    fs.writeFileSync(src, png(64, 48, [0, 0, 255]));
    await toJpeg(src, dest, { max: 600 });
    const m = await sharp(fs.readFileSync(dest)).metadata();
    assert.deepEqual([m.width, m.height], [64, 48]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test('fichier qui n’est pas une image : erreur (le serveur garde alors l’original)', async () => {
  const d = tmp();
  try {
    const src = path.join(d, 'x.jpg');
    fs.writeFileSync(src, 'pas une image');
    await assert.rejects(toJpeg(src, path.join(d, 'y.jpg')));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});
