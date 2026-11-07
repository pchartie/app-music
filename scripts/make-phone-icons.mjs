// Icônes de l'écran d'accueil du téléphone (public/m/icon-*.png), dessinées depuis public/icon.svg.
// npm run make-phone-icons ; nécessite un navigateur Chromium (macOS ou Linux).
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { findBrowser, ROOT } from '../tests/helpers.js';

const svg = fs.readFileSync(path.join(ROOT, 'public', 'icon.svg'), 'utf8').replace('<svg ', '<svg width="100%" height="100%" ');
const out = path.join(ROOT, 'public', 'm');
const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
try {
  for (const [file, size, maskable] of [['icon-192.png', 192, false], ['icon-512.png', 512, false], ['icon-maskable-512.png', 512, true]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    // « maskable » : fond plein, dessin dans la zone sûre centrale (80 %) que les lanceurs Android découpent
    // (le disque occupe déjà moins de 70 % du dessin : il suffit d'ôter les coins arrondis)
    const inner = `<div style="position:absolute;inset:0">${maskable ? svg.replace(/rx="[\d.]+"/, 'rx="0"') : svg}</div>`;
    await page.setContent(`<html><body style="margin:0;background:transparent">${inner}</body></html>`);
    await page.screenshot({ path: path.join(out, file), omitBackground: !maskable });
    await page.close();
    console.log('✓ public/m/' + file);
  }
} finally { await browser.close(); }
