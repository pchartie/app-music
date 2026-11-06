// Interface, dans un vrai navigateur sans fenêtre (Brave, Chrome ou Chromium déjà installé ; DISCO_BROWSER pour en imposer un).
// Ignoré si aucun navigateur n'est trouvé.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { startServer, sleep } from './helpers.js';

const BROWSERS = [
  process.env.DISCO_BROWSER,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/brave-browser', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = BROWSERS.find((p) => fs.existsSync(p));

describe('interface', { skip: !executablePath && 'aucun navigateur Chromium trouvé (DISCO_BROWSER=…)' }, () => {
  let srv, browser, page, lib;
  const errors = [], external = [];

  before(async () => {
    srv = await startServer();
    lib = (await srv.api('/api/library')).body;
    browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error' && !/404|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('request', (r) => { if (!r.url().startsWith(srv.url) && !/^(data|blob):/.test(r.url())) external.push(r.url()); });
    await page.goto(srv.url + '/#/albums');
    await page.waitForSelector('.card[data-album]');
  });
  after(async () => { await browser?.close(); await srv?.stop(); });

  const album = (title) => lib.albums.find((a) => a.title === title);
  const go = async (hash, sel) => { await page.evaluate((h) => (location.hash = h), hash); if (sel) await page.waitForSelector(sel); await sleep(400); };
  const queue = () => page.$$eval('#queue-list .q-item b', (els) => els.map((e) => e.textContent));
  // glisser-déposer à la souris (HTML5) ; la cible est calculée une fois le panneau « À suivre » ouvert
  async function drag(sel, target) {
    await page.$eval(sel, (e) => e.scrollIntoView({ block: 'center' })); await sleep(200);
    const s = await (await page.$(sel)).boundingBox();
    const x = s.x + Math.min(40, s.width / 2), y = s.y + s.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(x + i * 15, y + i * 3); await sleep(30); }
    await sleep(700);
    const [tx, ty] = await target();
    await page.mouse.move(tx, ty, { steps: 12 }); await sleep(200);
    await page.mouse.up(); await sleep(400);
    await page.mouse.click(5, 5); // remet à zéro l'état de la souris simulée entre deux glisser
  }
  const queueBottom = async () => { const r = await (await page.$('#queue')).boundingBox(); return [r.x + 100, r.y + r.height - 12]; };
  const queueItem = async (i) => { const r = await (await page.$$('#queue-list .q-item'))[i].boundingBox(); return [r.x + 80, r.y + 4]; };

  test('toutes les pages s’affichent sans erreur', async () => {
    const pages = [['#/flow', '#view'], ['#/albums', '.card[data-album]'], ['#/artists', '[data-artist]'], ['#/tracks', 'tr[data-track]'],
      [`#/album/${album('Aurora').id}`, '.tracklist tr[data-track]'], [`#/artist/${album('Nuit Blanche').artistId}`, '[data-album]'], ['#/search/aurora', '[data-album]']];
    for (const [hash, sel] of pages) await go(hash, sel);
    assert.deepEqual(errors, []);
  });

  test('l’album double affiche ses deux disques', async () => {
    await go(`#/album/${album('Aurora').id}`, '.tracklist');
    assert.equal(await page.$$eval('.tracklist .disc-head', (e) => e.length), 2);
    assert.deepEqual(await page.$$eval('.tracklist tr[data-track] .tt', (e) => e.map((x) => x.textContent)), ['Polar Night', 'Solar Wind', 'Magnetic Field', 'Dawn Chorus']);
  });

  test('lecture : clic sur un titre, enchaînement automatique, suivant et précédent', async () => {
    await go(`#/album/${album('Nuit Blanche').id}`, '.tracklist tr[data-track]');
    await page.click('.tracklist tr[data-track]');
    await page.waitForFunction(() => document.querySelector('#p-title').textContent === 'Minuit pile');
    await page.waitForFunction(() => document.body.classList.contains('is-playing'), null, { timeout: 5000 });
    // le premier titre dure ~1 s : le suivant démarre tout seul
    await page.waitForFunction(() => document.querySelector('#p-title').textContent === 'Boulevard désert', null, { timeout: 8000 });
    await page.click('#b-next');
    await page.waitForFunction(() => document.querySelector('#p-title').textContent === 'Néons');
    await page.click('#b-prev');
    await page.waitForFunction(() => ['Boulevard désert', 'Néons'].includes(document.querySelector('#p-title').textContent));
    assert.match(await page.textContent('#p-sub'), /Les Étoiles Filantes — Nuit Blanche/);
    await page.click('#b-play'); // pause
    await page.waitForFunction(() => document.body.classList.contains('paused'));
  });

  test('« À suivre » : glisser un titre, un album, réorganiser, vider, garder au rechargement', async () => {
    await go(`#/album/${album('Nuit Blanche').id}`, '.tracklist tr[data-track]');
    await page.click('.tracklist tr[data-track]'); await sleep(300); await page.click('#b-play');
    if (!(await page.$eval('#queue', (e) => e.classList.contains('open')))) await page.click('#b-queue');
    await sleep(500);
    assert.deepEqual(await queue(), ['Minuit pile', 'Boulevard désert', 'Néons', 'Aube']);

    // un titre, inséré avant « Néons »
    await go(`#/album/${album('Aurora').id}`, '.tracklist tr[data-track]');
    await drag('.tracklist tr[data-track]', () => queueItem(2));
    assert.deepEqual(await queue(), ['Minuit pile', 'Boulevard désert', 'Polar Night', 'Néons', 'Aube']);

    // la grande pochette : tout l'album en fin de file
    await go(`#/album/${album('Café Serré').id}`, '.hero-cover');
    await drag('.hero-cover', queueBottom);
    assert.deepEqual((await queue()).slice(-3), ['Expresso', 'Allongé', 'Noisette']);

    // une carte de la grille, panneau fermé : il s'ouvre tout seul pendant le glisser
    await page.click('#q-close'); await sleep(500);
    await go('#/albums', '.card[data-album]');
    await drag(`.card[data-album="${album('Album Fantôme').id}"]`, queueBottom);
    assert.deepEqual((await queue()).slice(-2), ['Premier', 'Second']);

    // réorganiser : « Aube » remonte en tête des titres à venir
    const i = (await queue()).indexOf('Aube');
    await drag(`#queue-list .q-item[data-q="${i}"]`, () => queueItem(1));
    assert.deepEqual((await queue()).slice(0, 3), ['Minuit pile', 'Aube', 'Boulevard désert']);

    // le titre en cours ne se déplace pas
    assert.equal(await page.$eval('#queue-list .q-item.current', (e) => e.hasAttribute('draggable')), false);

    // rechargement : la file modifiée est conservée
    const before = await queue();
    await page.reload(); await page.waitForSelector('#b-queue'); await sleep(500);
    await page.click('#b-queue'); await sleep(500);
    assert.deepEqual(await queue(), before);

    // vider : seul le titre en cours reste, et le bouton disparaît
    await page.click('#q-clear'); await sleep(300);
    assert.deepEqual(await queue(), ['Minuit pile']);
    assert.equal(await page.isVisible('#q-clear'), false);
    await page.click('#q-close');
  });

  test('recherche : en tapant, sans accents', async () => {
    await go('#/albums', '.card[data-album]');
    await page.click('#search'); await page.keyboard.type('etoiles filantes', { delay: 20 }); await sleep(600);
    assert.match(location(await page.url()), /#\/search/);
    const text = await page.textContent('#view');
    assert.match(text, /Les Étoiles Filantes/);
    assert.match(text, /Nuit Blanche/);
    await page.fill('#search', ''); await page.keyboard.press('Escape');
  });

  test('clavier : les flèches déplacent le focus, Entrée ouvre l’album', async () => {
    await page.goto(srv.url + '/?clavier#/albums'); await page.waitForSelector('.card[data-album]'); await sleep(400); // vrai rechargement
    await page.keyboard.press('ArrowDown'); await sleep(150); // premier appui : focus sur la première carte
    const first = await page.evaluate(() => document.activeElement?.dataset?.album || null);
    assert.equal(first, lib.albums[0].id, 'la première carte a le focus');
    await page.keyboard.press('ArrowRight'); await sleep(150);
    const focused = await page.evaluate(() => document.activeElement?.dataset?.album || null);
    assert.equal(focused, lib.albums[1].id, 'flèche droite : carte suivante');
    await page.keyboard.press('Enter'); await sleep(900);
    assert.equal(await page.evaluate(() => location.hash), `#/album/${focused}`);
  });

  test('hors ligne : aucune ressource externe chargée, aucune erreur JavaScript', () => {
    assert.deepEqual(external, []);
    assert.deepEqual(errors, []);
  });

  test('premier lancement : l’écran de choix du dossier s’affiche', async () => {
    const first = await startServer({ withMusic: false });
    const p = await browser.newPage();
    try {
      await p.goto(first.url);
      await p.waitForSelector('#setup.open', { timeout: 5000 });
    } finally { await p.close(); await first.stop(); }
  });
});

const location = (url) => new URL(url).hash;
