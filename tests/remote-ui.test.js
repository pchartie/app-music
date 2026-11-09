// Télécommande de bout en bout, dans un navigateur sans fenêtre : la page App Music de l'ordinateur et un
// téléphone (petit écran tactile, autre contexte, donc sans les cookies de l'ordinateur).
// Association en lisant le QR code affiché, puis pilotage : lecture, pause, suivant, volume, file d'attente,
// « Ouvrir sur l'ordinateur » quand la page est fermée, retrait du téléphone.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { startServer, findBrowser, freePort, sleep } from './helpers.js';
import { flac, png } from './fixtures.js';
import { decodeQrSvg } from './qr-read.js';

const executablePath = findBrowser();
let srv, browser, mac, macCtx, phone, phoneCtx, tmp, lanPort, openLog, lib;

// Petite bibliothèque aux titres longs (2 min) : la lecture ne s'arrête pas d'elle-même pendant le test
function longLibrary(root) {
  const albums = [['Orage Électrique', 'Les Voltigeurs', 1991, [210, 60, 60]], ['Marée Haute', 'Lune Bleue', 2004, [40, 90, 200]]];
  for (const [album, artist, year, color] of albums) {
    const dir = path.join(root, `${artist} - ${album}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'cover.png'), png(32, 32, color));
    ['Ouverture', 'Deuxième vague', 'Final'].forEach((t, i) => fs.writeFileSync(path.join(dir, `0${i + 1} - ${t}.flac`),
      flac({ seconds: 120, tags: { TITLE: `${t} (${album})`, ARTIST: artist, ALBUM: album, TRACKNUMBER: i + 1, DATE: year, GENRE: 'Rock' } })));
  }
  return root;
}
const macState = () => mac.evaluate(() => ({ title: document.querySelector('#p-title').textContent, paused: document.body.classList.contains('paused'), vol: getComputedStyle(document.querySelector('#volume')).getPropertyValue('--v').trim() }));
const waitMac = (fn, arg) => mac.waitForFunction(fn, arg, { timeout: 8000 });

before(async () => {
  if (!executablePath) return;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-remote-ui-'));
  const net = path.join(tmp, 'network.json'); fs.writeFileSync(net, JSON.stringify({ id: 'maison-ui', address: '127.0.0.1', subnet: '127.0.0.x' }));
  openLog = path.join(tmp, 'open.log');
  lanPort = await freePort();
  srv = await startServer({ music: longLibrary(path.join(tmp, 'music')), env: { APPMUSIC_FAKE_NETWORK: net, APPMUSIC_LAN_PORT: String(lanPort), APPMUSIC_OPEN_LOG: openLog, APPMUSIC_NET_INTERVAL: '200' } });
  await srv.waitIndexed(2);
  lib = (await srv.api('/api/library')).body;
  browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
  macCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  mac = await macCtx.newPage();
  await mac.goto(srv.url + '/#/albums');
  await mac.waitForSelector('.card');
  phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36' });
  phone = await phoneCtx.newPage();
  macCtx.setDefaultTimeout(8000); phoneCtx.setDefaultTimeout(8000);
});
after(async () => { await browser?.close(); await srv?.stop(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); });

test('un téléphone inconnu ne voit que les instructions d’association', { skip: !executablePath }, async () => {
  // rien n'écoute encore : on ouvre l'écoute en lançant une association, puis on l'annule
  await mac.click('#remote-btn');
  await mac.waitForSelector('#remote.open #rm-pair');
  await mac.click('#rm-pair');
  await mac.waitForSelector('.rm-qr svg');
  // le panneau se met à jour toutes les 2 s sans se redessiner (sinon il clignote)
  await mac.evaluate(() => { document.querySelector('.rm-panel').dataset.mark = '1'; document.querySelector('.rm-qr').dataset.mark = '1'; });
  const t0 = await mac.textContent('#rm-left');
  await sleep(2600);
  assert.ok(await mac.evaluate(() => document.querySelector('.rm-panel')?.dataset.mark === '1' && document.querySelector('.rm-qr')?.dataset.mark === '1'), 'panneau et QR code inchangés');
  assert.notEqual(await mac.textContent('#rm-left'), t0, 'le compte à rebours avance');
  await phone.goto(`http://127.0.0.1:${lanPort}/`);
  await phone.waitForSelector('.screen h2');
  assert.match(await phone.textContent('.screen h2'), /pas associé/);
  assert.equal(await phone.locator('.card').count(), 0, 'aucune pochette sans clé');
});

test('association en scannant le QR code affiché sur l’ordinateur', { skip: !executablePath }, async () => {
  const svg = await mac.$eval('.rm-qr', (el) => el.innerHTML);
  const url = decodeQrSvg(svg);
  assert.match(url, new RegExp(`^http://127\\.0\\.0\\.1:${lanPort}/m/#pair=`));
  await phone.goto(url);
  await phone.waitForSelector('.grid .card');
  assert.ok(!phone.url().includes('pair'), 'le code a été effacé de l’adresse');
  assert.equal(await phone.locator('.grid .card').count(), lib.albums.length);
  assert.match(await phone.textContent('.install'), /Ajouter à l’écran d’accueil/);
  // l'ordinateur confirme, avec le nom du téléphone, et le QR code disparaît
  await mac.waitForSelector('.rm-flash', { timeout: 5000 });
  assert.match(await mac.textContent('.rm-flash'), /« Pixel 8 » est associé/);
  assert.equal(await mac.locator('.rm-qr').count(), 0);
  assert.match(await mac.textContent('#rm-devices'), /Pixel 8/);
});

test('le panneau de l’ordinateur se parcourt aux flèches et se ferme avec Échap', { skip: !executablePath }, async () => {
  await mac.keyboard.press('ArrowUp');
  await mac.keyboard.press('ArrowDown');
  const focused = await mac.evaluate(() => document.activeElement.closest('#remote') && (document.activeElement.id || document.activeElement.textContent.trim()));
  assert.ok(focused, 'le focus reste dans le panneau');
  await mac.keyboard.press('Escape');
  await mac.waitForSelector('#remote:not(.open)');
  assert.ok(await mac.$eval('#remote-btn', (b) => b.classList.contains('connected')), 'pastille verte : un téléphone est connecté');
});

test('lire un album depuis le téléphone : le son part de l’ordinateur', { skip: !executablePath }, async () => {
  const album = lib.albums.find((a) => a.title === 'Orage Électrique');
  await phone.tap(`.card[data-album="${album.id}"]`);
  await phone.waitForSelector('.hero h2');
  assert.equal(await phone.textContent('#title'), 'Orage Électrique');
  await phone.tap('[data-act="play"]');
  await waitMac(() => document.querySelector('#p-title').textContent === 'Ouverture (Orage Électrique)' && document.body.classList.contains('is-playing'));
  // le téléphone affiche ce que joue l'ordinateur
  await phone.waitForFunction(() => document.querySelector('#mini-title').textContent === 'Ouverture (Orage Électrique)' && document.body.classList.contains('playing'));
});

test('pause, suivant, volume et position depuis le téléphone', { skip: !executablePath }, async () => {
  await phone.tap('#mini [data-cmd="toggle"]');
  await waitMac(() => document.body.classList.contains('paused'));
  await phone.waitForFunction(() => !document.body.classList.contains('playing'));
  await phone.tap('#mini [data-cmd="toggle"]');
  await waitMac(() => document.body.classList.contains('is-playing'));
  await phone.tap('#mini [data-cmd="next"]');
  await waitMac(() => document.querySelector('#p-title').textContent === 'Deuxième vague (Orage Électrique)');
  // plein écran : volume et position
  await phone.tap('#mini-open');
  await phone.waitForSelector('#np.open');
  await phone.waitForFunction(() => getComputedStyle(document.querySelector('#np')).transform === 'none'); // fin de la montée du panneau
  // volume : bascule − / + de l'écran de lecture (5 % par appui), appui long, puis ligne sous le mini-lecteur
  const macVol = () => mac.evaluate(() => +getComputedStyle(document.querySelector('#volume')).getPropertyValue('--v'));
  const start = await macVol();
  await phone.tap('.rocker [data-step="-1"]');
  await phone.tap('.rocker [data-step="-1"]');
  await waitMac((v) => Math.abs(+getComputedStyle(document.querySelector('#volume')).getPropertyValue('--v') - v) < 0.001, Math.round((start - 0.1) * 100) / 100);
  assert.match(await phone.textContent('#vol-flash'), new RegExp(`Volume ${Math.round((start - 0.1) * 100)} %`));
  assert.equal(await phone.textContent('.rocker .vol-pct'), `${Math.round((start - 0.1) * 100)} %`);
  const plus = await phone.$eval('.rocker [data-step="1"]', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  const before = await macVol();
  await phone.mouse.move(plus.x, plus.y); await phone.mouse.down(); await sleep(1100); await phone.mouse.up();
  await sleep(400);
  assert.ok(await macVol() >= before + 0.15, `appui long : le volume continue de monter (${before} → ${await macVol()})`);

  const box = await phone.$eval('#seek', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
  await phone.touchscreen.tap(box.x, box.y);
  await mac.waitForFunction(() => parseFloat(document.querySelector('#t-cur').textContent.split(':')[0]) * 60 + parseFloat(document.querySelector('#t-cur').textContent.split(':')[1]) >= 55, null, { timeout: 8000 });
});

test('« À suivre » : ajout depuis le téléphone, saut et retrait', { skip: !executablePath }, async () => {
  const other = lib.albums.find((a) => a.title === 'Marée Haute');
  const finalTitle = 'Final (Marée Haute)';
  await phone.tap('#np-close');
  await phone.waitForSelector('#np:not(.open)', { state: 'attached' });
  // ligne de volume sous le mini-lecteur : on touche la fine barre au quart
  await phone.waitForSelector('#minivol');
  const bar = await phone.$eval('#vol-drag', (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width * 0.25, y: r.top + r.height / 2 }; });
  await phone.touchscreen.tap(bar.x, bar.y);
  await waitMac(() => Math.abs(+getComputedStyle(document.querySelector('#volume')).getPropertyValue('--v') - 0.25) < 0.02);
  await phone.tap('#minivol [data-step="1"]');
  await waitMac(() => Math.abs(+getComputedStyle(document.querySelector('#volume')).getPropertyValue('--v') - 0.3) < 0.02);
  await phone.goto(`http://127.0.0.1:${lanPort}/m/#album/${other.id}`);
  await phone.waitForSelector('.tracks .tr');
  await phone.tap(`.tr[data-track="${other.tracks[2]}"] [data-add]`);
  await waitMac((t) => [...document.querySelectorAll('#queue-list .q-item b')].some((b) => b.textContent === t), finalTitle);
  // la file du téléphone suit (bouton « À suivre » du mini-lecteur), puis on saute directement à ce titre
  await phone.tap('#mini-queue');
  await phone.waitForSelector('#np.open');
  // l'écran défile jusqu'à la file : son titre est à l'écran (en haut si la file est longue)
  await phone.waitForFunction(() => { const r = document.querySelector('.q-head').getBoundingClientRect(); return document.querySelector('.np-scroll').scrollTop > 0 && r.top >= 0 && r.bottom < innerHeight - 100; }, null, { timeout: 5000 });
  await phone.waitForFunction((t) => [...document.querySelectorAll('#queue .row b')].some((b) => b.textContent.startsWith(t)), finalTitle, { timeout: 8000 });
  const before = await phone.$$eval('#queue .row[data-jump]', (rows) => rows.length);
  await phone.tap(`#queue .row:not(.current) [data-remove]`);
  await phone.waitForFunction((n) => document.querySelectorAll('#queue .row[data-jump]').length === n - 1, before, { timeout: 8000 });
  const target = await phone.$$eval('#queue .row[data-jump]', (rows, t) => rows.find((r) => r.querySelector('b').textContent.startsWith(t))?.dataset.jump, finalTitle);
  assert.ok(target, 'le titre ajouté est toujours dans la file');
  await phone.tap(`#queue .row[data-jump="${target}"]`);
  await waitMac((t) => document.querySelector('#p-title').textContent === t, finalTitle);
  await phone.tap('#np-close');
});

test('page fermée sur l’ordinateur : « Ouvrir sur le Mac », puis la commande en attente s’exécute', { skip: !executablePath }, async () => {
  await mac.close();
  await phone.waitForSelector('#banner:not([hidden]) #open-pc');
  assert.match(await phone.textContent('#banner'), /n’est pas ouverte sur (le Mac|.+)/);
  assert.ok(!(await phone.isVisible('#mini')), 'plus de lecture en cours affichée');
  // une demande de lecture pendant que la page est fermée…
  const album = lib.albums.find((a) => a.title === 'Marée Haute');
  await phone.goto(`http://127.0.0.1:${lanPort}/m/#album/${album.id}`);
  await phone.waitForSelector('[data-act="play"]');
  await phone.tap('[data-act="play"]');
  await phone.waitForSelector('#banner:not([hidden]) #open-pc');
  await phone.tap('#open-pc');
  await phone.waitForFunction(() => /Ouverture/.test(document.querySelector('#banner').textContent));
  // « Ouverture… » s'affiche dès le clic, avant la réponse du serveur : on attend que l'adresse soit notée
  const opened = () => { try { return fs.readFileSync(openLog, 'utf8').trim().split('\n').pop(); } catch { return ''; } };
  for (let i = 0; i < 100 && !opened(); i++) await sleep(50);
  assert.equal(opened(), `http://localhost:${srv.port}/`);
  // … l'ordinateur ouvre la page (ici, le test joue le rôle du navigateur) et la lecture démarre
  mac = await macCtx.newPage();
  await mac.goto(srv.url + '/');
  await waitMac(() => document.querySelector('#p-title').textContent === 'Ouverture (Marée Haute)' && document.body.classList.contains('is-playing'));
  await phone.waitForSelector('#banner[hidden]', { state: 'attached' });
});

test('retirer le téléphone depuis l’ordinateur : il revient à l’écran d’association', { skip: !executablePath }, async () => {
  await mac.click('#remote-btn');
  await mac.waitForSelector('[data-revoke]');
  await mac.click('[data-revoke]');
  await sleep(600);
  assert.match(await mac.textContent('[data-revoke]'), /Confirmer/, 'un seul clic ne retire rien');
  assert.equal((await srv.api('/api/remote/admin')).body.devices.length, 1);
  await mac.click('[data-revoke]');
  await mac.waitForFunction(() => !document.querySelector('[data-revoke]'));
  await phone.waitForSelector('.screen h2', { timeout: 10000 });
  assert.match(await phone.textContent('.screen'), /retiré/);
  await mac.keyboard.press('Escape');
});
