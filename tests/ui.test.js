// Interface, dans un vrai navigateur sans fenêtre (Brave, Chrome ou Chromium déjà installé ; APPMUSIC_BROWSER pour en imposer un).
// Ignoré si aucun navigateur n'est trouvé.
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startServer, sleep, findBrowser } from './helpers.js';

const executablePath = findBrowser();

describe('interface', { skip: !executablePath && 'aucun navigateur Chromium trouvé (APPMUSIC_BROWSER=…)' }, () => {
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
    const pages = [['#/flow', '#view'], ['#/albums', '.card[data-album]'], ['#/artists', '[data-artist]'], ['#/selections', '.mix-card'], ['#/selection/annees-2000', '.tracklist tr[data-track]'],
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

    // retirer un titre : bouton × au survol (pas sur le titre en cours), puis touche Suppr au clavier
    assert.equal(await page.$('#queue-list .q-item.current .q-remove'), null, 'le titre en cours ne se retire pas');
    const q0 = await queue();
    await page.hover('#queue-list .q-item[data-q="2"]'); await page.click('#queue-list .q-item[data-q="2"] .q-remove'); await sleep(300);
    assert.deepEqual(await queue(), q0.filter((_, k) => k !== 2), 'retiré au clic');
    const q1 = await queue();
    await page.focus('#queue-list .q-item[data-q="1"]'); await page.keyboard.press('Delete'); await sleep(300);
    assert.deepEqual(await queue(), q1.filter((_, k) => k !== 1), 'retiré avec Suppr');
    assert.equal(await page.evaluate(() => document.activeElement?.dataset?.q), '1', 'le focus passe au titre suivant');

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

  test('icône : favicon et logo partagent le même dessin, recherche lisible', async () => {
    const icon = await srv.api('/icon.svg');
    assert.equal(icon.status, 200);
    assert.match(icon.body.toString(), /<svg[\s\S]*<ellipse/, 'la note de musique');
    assert.equal(await page.getAttribute('link[rel="icon"]', 'href'), 'icon.svg');
    assert.equal(await page.$eval('.brand-mark', (img) => [img.getAttribute('src'), img.naturalWidth > 0]).then(([src, ok]) => src === 'icon.svg' && ok), true);
    const fs = await page.$eval('#search', (e) => parseFloat(getComputedStyle(e).fontSize));
    assert.ok(fs >= 14, `taille du texte de recherche : ${fs}px`);
  });

  test('Sélections : récemment ajoutés, playlist par décennie, lecture en un clic', async () => {
    await page.goto(srv.url + '/?sel#/tracks'); await page.waitForSelector('.selections'); await sleep(400);
    assert.equal(await page.evaluate(() => location.hash), '#/tracks', 'l’ancienne adresse « Titres » mène aux Sélections');
    assert.equal((await page.textContent('nav a[data-nav="selections"]')).trim(), 'Sélections');
    assert.equal(await page.$('table.songs'), null, 'plus de grand tableau');
    assert.equal(await page.$$eval('.selections .shelf .card[data-album]', (e) => e.length), lib.albums.length, 'récemment ajoutés');
    // bibliothèque factice : seule la décennie 2000 a 2 albums (Café Serré 2003, Aurora 2009) ; trop petite pour un style ou des classiques
    assert.deepEqual(await page.$$eval('.mix-card .mix-name', (e) => e.map((x) => x.textContent.trim())), ['Années 2000']);
    assert.equal(await page.textContent('.mix-card .card-sub'), '7 titres · 0 min');
    await page.click('.mix-card'); await page.waitForSelector('.mix-page'); await sleep(300);
    assert.equal(await page.evaluate(() => location.hash), '#/selection/annees-2000');
    assert.equal(await page.textContent('.mix-page h1'), 'Années 2000');
    const rows = await page.$$eval('.tracklist tr[data-track]', (e) => e.map((x) => [x.querySelector('.tt').textContent, x.querySelector('.ta').textContent]));
    assert.equal(rows.length, 7);
    assert.deepEqual(rows[0], ['Expresso', 'Moka & Bisou · Café Serré'], 'ordre chronologique, artiste · album');
    assert.equal(await page.$$eval('.tracklist .disc-head', (e) => e.length), 0, 'pas d’en-têtes de disque');
    await page.click('.hero-actions [data-act="play"]');
    await page.waitForFunction(() => document.querySelector('#p-title').textContent === 'Expresso');
    await page.click('#b-play');
    // un clic sur le bouton lecture d'une carte lance la playlist en aléatoire
    await go('#/selections', '.mix-card'); await page.hover('.mix-card .mix-art'); await page.click('.mix-card [data-play-mix]'); await sleep(400);
    assert.equal(await page.evaluate(() => location.hash), '#/selections', 'reste sur la page');
    const titles = ['Expresso', 'Allongé', 'Noisette', 'Polar Night', 'Solar Wind', 'Magnetic Field', 'Dawn Chorus'];
    assert.ok(titles.includes(await page.textContent('#p-title')));
    assert.equal(await page.$eval('#b-shuffle', (e) => e.classList.contains('on')), true, 'aléatoire activé');
    await page.click('#b-shuffle'); await page.click('#b-play');
    // clavier : la carte est atteignable aux flèches
    assert.ok(await page.$eval('.mix-card', (e) => e.tabIndex === 0), 'carte focalisable');
  });

  test('albums MP3 : triangle discret, lien dans « Ma bibliothèque », page et liste à télécharger', async () => {
    await page.goto(srv.url + '/?mp3#/albums'); await page.waitForSelector('.card[data-album]'); await sleep(400);
    const marked = await page.$$eval('.card[data-album]', (els) => els.filter((e) => e.querySelector('.lossy')).map((e) => e.querySelector('.card-title').textContent));
    assert.deepEqual(marked, ['Café Serré'], 'seul l’album MP3 porte le triangle');
    assert.equal(await page.getAttribute('.card .lossy', 'title'), 'Album en MP3 (avec perte)');
    await go(`#/album/${album('Café Serré').id}`, '.hero-facts');
    assert.equal(await page.$eval('.hero-facts .badge', (e) => e.classList.contains('warn')), true);
    await go(`#/album/${album('Nuit Blanche').id}`, '.hero-facts');
    assert.equal(await page.$eval('.hero-facts .badge', (e) => e.classList.contains('warn')), false);
    assert.match(await page.textContent('#lib-meta .lossy-link'), /1 album en MP3/);
    await page.click('#lib-meta .lossy-link');
    await page.waitForSelector('.lossy-page .card[data-album]'); await sleep(500);
    assert.equal(await page.textContent('.lossy-page h1'), 'Albums en MP3');
    assert.deepEqual(await page.$$eval('.lossy-page .card .card-title', (e) => e.map((x) => x.textContent)), ['Café Serré']);
    assert.match(await page.textContent('.lossy-page .lossy-seen'), /^Repéré le \d{1,2} \S+ \d{4}$/);
    const link = await page.$('.lossy-page a[download]');
    assert.equal(await link.getAttribute('href'), '/api/lossy.csv');
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    assert.match(download.suggestedFilename(), /^albums-avec-perte-\d{4}-\d\d-\d\d\.csv$/);
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
