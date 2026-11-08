// Icônes de l'app, dessinées d'après public/icon.svg (favicon et logo) :
//   assets/AppIcon.icns  app macOS (grille Apple : dessin de 824 px dans 1024, ombre douce) — seulement sur un Mac (iconutil)
//   assets/AppIcon.ico   raccourcis Windows (bureau, menu Démarrer)
//   assets/AppIcon.png   raccourcis Linux (fichier .desktop)
// npm run make-icon ; nécessite un navigateur Chromium (rendu du SVG). Les fichiers produits sont versionnés.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { chromium } from 'playwright-core';
import { findBrowser, ROOT } from '../tests/helpers.js';

const svg = fs.readFileSync(path.join(ROOT, 'public', 'icon.svg'), 'utf8').replace('<svg ', '<svg width="100%" height="100%" ');
const ASSETS = path.join(ROOT, 'assets');

// Fichier .ico : un en-tête, puis chaque taille en PNG (accepté par Windows depuis Vista)
export function ico(pngs) {
  const head = Buffer.alloc(6 + 16 * pngs.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
  let offset = head.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    head.writeUInt8(size >= 256 ? 0 : size, e); head.writeUInt8(size >= 256 ? 0 : size, e + 1); // 0 = 256 px
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(data.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([head, ...pngs.map((p) => p.data)]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-icon-'));
  fs.mkdirSync(ASSETS, { recursive: true });
  const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  let mac, plain;
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
    const shot = async (style) => {
      await page.setContent(`<html><body style="margin:0;background:transparent"><div style="position:absolute;${style}">${svg}</div></body></html>`);
      return page.screenshot({ omitBackground: true });
    };
    mac = await shot('left:100px;top:90px;width:824px;height:824px;filter:drop-shadow(0 12px 20px rgba(0,0,0,.3))');
    plain = await shot('left:32px;top:32px;width:960px;height:960px'); // Windows et Linux : presque bord à bord, sans ombre
  } finally { await browser.close(); }
  const png = (src, px) => sharp(src).resize(px, px).png().toBuffer();

  if (process.platform === 'darwin') {
    const set = path.join(tmp, 'AppIcon.iconset');
    fs.mkdirSync(set);
    for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
      fs.writeFileSync(path.join(set, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), await png(mac, size * scale));
    }
    execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(ASSETS, 'AppIcon.icns')]);
    console.log('✓ assets/AppIcon.icns');
  } else console.log('(assets/AppIcon.icns ne se fabrique que sur un Mac : fichier existant conservé)');

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  fs.writeFileSync(path.join(ASSETS, 'AppIcon.ico'), ico(await Promise.all(sizes.map(async (size) => ({ size, data: await png(plain, size) })))));
  console.log('✓ assets/AppIcon.ico');
  fs.writeFileSync(path.join(ASSETS, 'AppIcon.png'), await png(plain, 256));
  console.log('✓ assets/AppIcon.png');
  fs.rmSync(tmp, { recursive: true, force: true });
}
