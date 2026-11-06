// Icône de l'app : public/icon.svg (favicon et logo) -> assets/AppIcon.icns (app macOS, raccourci du bureau).
// npm run make-icon ; nécessite un navigateur Chromium (rendu du SVG) et iconutil (fourni avec macOS).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { findBrowser, ROOT } from '../tests/helpers.js';

const svg = fs.readFileSync(path.join(ROOT, 'public', 'icon.svg'), 'utf8').replace('<svg ', '<svg width="100%" height="100%" ');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-icon-'));
const set = path.join(tmp, 'AppIcon.iconset');
fs.mkdirSync(set);
const browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
try {
  // grille des icônes macOS : dessin de 824 px dans un carré de 1024, avec une ombre douce ;
  // rendu une seule fois en 1024 px, puis réduit par sips (fourni avec macOS)
  const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
  await page.setContent(`<html><body style="margin:0;background:transparent">
    <div style="position:absolute;left:100px;top:90px;width:824px;height:824px;filter:drop-shadow(0 12px 20px rgba(0,0,0,.3))">${svg}</div></body></html>`);
  const big = path.join(tmp, 'icon-1024.png');
  await page.screenshot({ path: big, omitBackground: true });
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) {
    const px = size * scale, out = path.join(set, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`);
    if (px === 1024) fs.copyFileSync(big, out); else execFileSync('sips', ['-z', String(px), String(px), big, '--out', out], { stdio: 'ignore' });
  }
} finally { await browser.close(); }
fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true });
execFileSync('iconutil', ['-c', 'icns', set, '-o', path.join(ROOT, 'assets', 'AppIcon.icns')]);
fs.rmSync(tmp, { recursive: true, force: true });
console.log('✓ assets/AppIcon.icns');
