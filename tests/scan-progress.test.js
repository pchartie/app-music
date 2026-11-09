// Grande bibliothèque : lecture des fichiers en parallèle (même résultat qu'un par un) et barre de progression
// de la première indexation (lecture des fichiers, puis albums et pochettes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { chromium } from 'playwright-core';
import { startServer, sleep, findBrowser } from './helpers.js';
import { flac, mp3, png } from './fixtures.js';

const executablePath = findBrowser();

test('lecture en parallèle : la pochette intégrée retenue est toujours celle du premier titre', async () => {
  const music = fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-ordre-'));
  const dir = path.join(music, 'Couleurs - Trois Pochettes');
  fs.mkdirSync(dir);
  // le premier titre est le plus lourd : lu en parallèle, il finit après les autres
  const colors = [[220, 30, 30], [30, 220, 30], [30, 30, 220]];
  colors.forEach((c, i) => fs.writeFileSync(path.join(dir, `0${i + 1} Titre.flac`),
    flac({ seconds: i ? 1 : 30, picture: png(64, 64, c), tags: { TITLE: `Titre ${i + 1}`, ARTIST: 'Couleurs', ALBUM: 'Trois Pochettes', TRACKNUMBER: i + 1 } })));
  const srv = await startServer({ music });
  try {
    const lib = (await srv.api('/api/library')).body;
    const a = lib.albums.find((x) => x.title === 'Trois Pochettes');
    assert.deepEqual(a.tracks.map((id) => lib.tracks.find((t) => t.id === id).title), ['Titre 1', 'Titre 2', 'Titre 3']);
    const { data } = await sharp((await srv.api(`/cover/${a.id}.jpg`)).body).resize(1, 1).raw().toBuffer({ resolveWithObject: true });
    assert.ok(data[0] > 150 && data[1] < 100 && data[2] < 100, `pochette rouge (premier titre) attendue : ${[...data]}`);
  } finally { await srv.stop(); fs.rmSync(music, { recursive: true, force: true, maxRetries: 5 }); }
});

test('première indexation : barre de progression (fichiers puis pochettes), puis la bibliothèque', { skip: !executablePath && 'pas de navigateur' }, async () => {
  const music = fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-progression-'));
  for (let a = 1; a <= 10; a++) {
    const dir = path.join(music, `Groupe ${a} - Album ${a}`); fs.mkdirSync(dir);
    for (let t = 1; t <= 12; t++) fs.writeFileSync(path.join(dir, `${t} Titre.mp3`), mp3({ tags: { title: `Titre ${t}`, artist: `Groupe ${a}`, album: `Album ${a}`, track: t } }));
  }
  // 120 fichiers × 250 ms, 8 à la fois : ≈ 4 s de lecture, le temps de voir la barre avancer
  const srv = await startServer({ music, wait: false, env: { APPMUSIC_SCAN_DELAY: '250' } });
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    for (let i = 0; i < 100; i++) { try { await srv.api('/api/status'); break; } catch { await sleep(100); } }
    await page.goto(srv.url + '/');
    await page.waitForSelector('.scan-wait #scan-bar');
    await page.waitForFunction(() => /Lecture des fichiers… \d+ \/ 120/.test(document.querySelector('#scan-status').textContent));
    const w1 = await page.$eval('#scan-bar', (e) => parseFloat(e.style.width));
    await page.waitForFunction((w) => parseFloat(document.querySelector('#scan-bar').style.width) > w + 10, w1, { timeout: 10000 });
    assert.match(await page.textContent('.app'), /Indexation \d+ %/, 'pourcentage aussi dans « Ma bibliothèque »');
    const st = (await srv.api('/api/status')).body;
    assert.equal(st.scanProgress.phase, 'files'); assert.equal(st.scanProgress.total, 120);
    // une fois fini : la bibliothèque s'affiche d'elle-même
    await page.waitForFunction(() => !document.querySelector('.scan-wait'), null, { timeout: 20000 });
    assert.equal((await srv.api('/api/status')).body.albums, 10);
  } finally { await browser.close(); await srv.stop(); fs.rmSync(music, { recursive: true, force: true, maxRetries: 5 }); }
});
