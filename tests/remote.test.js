// Télécommande : réseau de la maison, association par QR code, clés d'appareil, liste blanche,
// actions réservées à l'ordinateur, anti-veille, « Ouvrir sur l'ordinateur », retrait d'un appareil.
// Le réseau local est simulé : APPMUSIC_FAKE_NETWORK (fichier JSON) et un second port sur 127.0.0.1.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer, freePort, sleep } from './helpers.js';
import { qrMatrix } from '../lib/qr.js';
import { isPrivateIPv4 } from '../lib/system.js';
import { decodeQrSvg } from './qr-read.js';

let srv, lanPort, netFile, openLog, tmp;
const HOME = { id: 'maison-test', address: '127.0.0.1', subnet: '127.0.0.x' };
const setNetwork = (n) => fs.writeFileSync(netFile, JSON.stringify(n));
const lan = (p, opts = {}) => fetch(`http://127.0.0.1:${lanPort}${p}`, { redirect: 'manual', ...opts });
const lanUp = () => fetch(`http://127.0.0.1:${lanPort}/m/`).then(() => true, () => false);
async function until(fn, ms = 4000) { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await sleep(50); } return false; }
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body ?? {}) });
let key = null; // cookie de l'appareil associé

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-remote-'));
  netFile = path.join(tmp, 'network.json'); openLog = path.join(tmp, 'open.log');
  setNetwork(HOME);
  lanPort = await freePort();
  srv = await startServer({ env: { APPMUSIC_FAKE_NETWORK: netFile, APPMUSIC_LAN_PORT: String(lanPort), APPMUSIC_NET_INTERVAL: '150', APPMUSIC_OPEN_LOG: openLog } });
});
after(async () => { await srv?.stop(); fs.rmSync(tmp, { recursive: true, force: true }); });

test('QR code : encode l’adresse complète, lisible par un lecteur de QR code', () => {
  const url = 'http://192.168.1.20:4321/m/#pair=AbCdEfGhIjKlMnOpQrStUv';
  const m = qrMatrix(url);
  assert.ok(m.length >= 21 && m.every((row) => row.length === m.length));
  assert.equal(decodeQrSvg(`<svg viewBox="0 0 ${m.length + 8} ${m.length + 8}"><path d="${m.flatMap((row, r) => row.map((d, c) => (d ? `M${c + 4} ${r + 4}h1v1h-1z` : ''))).join('')}"/></svg>`), url);
});

test('adresses du réseau local seulement, jamais Internet', () => {
  for (const ip of ['192.168.1.20', '10.0.0.5', '172.16.3.4', '172.31.0.1', '::ffff:192.168.0.9', '127.0.0.1']) assert.ok(isPrivateIPv4(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '100.64.1.1', '2a01::1', '', undefined]) assert.ok(!isPrivateIPv4(ip), String(ip));
});

test('sur l’ordinateur, un autre site ouvert dans le navigateur ne peut pas piloter la télécommande', async () => {
  assert.equal((await fetch(srv.url + '/api/remote/pair', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  // nom de domaine détourné vers 127.0.0.1 (fetch interdit de changer l'en-tête Host : requête à la main)
  const status = await new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port: srv.port, path: '/api/remote/admin', headers: { Host: 'pirate.example' } }, (r) => { r.resume(); resolve(r.statusCode); }).on('error', reject));
  assert.equal(status, 403);
  assert.equal((await fetch(srv.url + '/api/remote/admin', { headers: { 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
});

test('sans téléphone associé, rien n’écoute sur le réseau local', async () => {
  assert.equal(await lanUp(), false);
  const st = (await srv.api('/api/remote/admin')).body;
  assert.deepEqual(st.devices, []);
  assert.equal(st.listening, null);
  assert.equal(st.network.home, false, 'aucun réseau de la maison au départ');
});

let pairUrl;
test('« Associer un téléphone » : QR code, réseau de la maison retenu, écoute ouverte', async () => {
  const r = await fetch(srv.url + '/api/remote/pair', { method: 'POST' }).then((x) => x.json());
  assert.match(r.url, new RegExp(`^http://127\\.0\\.0\\.1:${lanPort}/m/#pair=[\\w-]{20,}$`));
  assert.equal(decodeQrSvg(r.svg), r.url, 'le QR code contient l’adresse');
  assert.ok(r.expiresAt > Date.now() + 2 * 60000 && r.expiresAt <= Date.now() + 3 * 60000 + 1000, 'valable 3 minutes');
  pairUrl = r.url;
  assert.equal(await lanUp(), true);
  const st = (await srv.api('/api/remote/admin')).body;
  assert.equal(st.network.home, true);
  assert.deepEqual(st.homes.map((h) => h.subnet), ['127.0.0.x']);
});

test('depuis le réseau, sans clé : seulement la page d’association', async () => {
  assert.equal((await lan('/m/')).status, 200);
  assert.equal((await lan('/m/m.js')).status, 200);
  assert.equal((await lan('/m/manifest.webmanifest')).headers.get('content-type'), 'application/manifest+json');
  assert.equal((await lan('/search.js')).status, 200);
  const home = await lan('/');
  assert.equal(home.status, 302); assert.equal(home.headers.get('location'), '/m/');
  assert.equal((await lan('/api/library')).status, 401);
  assert.equal((await lan('/api/remote/events')).status, 401);
  assert.deepEqual(await lan('/api/remote/whoami').then((r) => r.json()).then((w) => w.paired), false);
  for (const p of ['/index.html', '/app.js', '/api/setup', '/api/status', '/api/lossy.csv', '/api/remote/admin', '/audio/abc']) assert.equal((await lan(p)).status, 403, p);
});

test('code faux refusé, bon code accepté une seule fois, clé d’appareil en cookie', async () => {
  const code = pairUrl.split('#pair=')[1];
  const bad = await post(`http://127.0.0.1:${lanPort}/api/pair`, { code: code.slice(0, -1) + (code.endsWith('A') ? 'B' : 'A'), name: 'Pirate' });
  assert.equal(bad.status, 403);
  const ok = await post(`http://127.0.0.1:${lanPort}/api/pair`, { code, name: 'Pixel <b>8</b>' });
  assert.equal(ok.status, 200);
  const cookie = ok.headers.get('set-cookie');
  assert.match(cookie, /^am_key=[\w-]{40,}; Path=\/; Max-Age=\d+; HttpOnly; SameSite=Strict$/);
  key = cookie.split(';')[0];
  assert.equal((await post(`http://127.0.0.1:${lanPort}/api/pair`, { code, name: 'Deuxième' })).status, 403, 'code à usage unique');
  const st = (await srv.api('/api/remote/admin')).body;
  assert.deepEqual(st.devices.map((d) => d.name), ['Pixel b8/b'], 'nom nettoyé (ni balises ni caractères de contrôle)');
});

test('avec la clé : bibliothèque et pochettes, mais toujours pas l’administration', async () => {
  const h = { headers: { Cookie: key } };
  const libRes = await lan('/api/library', h);
  assert.equal(libRes.status, 200);
  const lib = await libRes.json();
  assert.ok(lib.albums.length > 3);
  assert.equal((await lan(`/cover/${lib.albums[0].id}.jpg`, h)).status, 200);
  assert.equal((await lan('/api/remote/whoami', h).then((r) => r.json())).paired, true);
  for (const [p, m] of [['/api/setup', 'GET'], ['/api/rescan', 'POST'], ['/api/sync', 'POST'], ['/api/remote/pair', 'POST'], ['/api/remote/admin', 'GET'], ['/api/setup/pick', 'POST'], [`/audio/${lib.tracks[0].id}`, 'GET']]) {
    assert.equal((await lan(p, { ...h, method: m })).status, 403, `${m} ${p}`);
  }
  // une clé inventée ne vaut rien
  assert.equal((await lan('/api/library', { headers: { Cookie: 'am_key=inventee' } })).status, 401);
});

test('commandes : vérifiées, refusées tant qu’App Music n’est pas ouverte, et l’ordinateur reste éveillé 1 h', async () => {
  const lib = (await srv.api('/api/library')).body;
  const c = (body) => post(`http://127.0.0.1:${lanPort}/api/remote/command`, body, { Cookie: key });
  assert.equal((await c({ action: 'rm -rf' })).status, 400);
  assert.equal((await c({ action: 'playList', ids: ['inconnu'] })).status, 400);
  assert.equal((await c({ action: 'seek', position: 'abc' })).status, 400);
  const r = await c({ action: 'playList', ids: lib.albums[0].tracks, start: 0 });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error, 'no-player');
  const st = await lan('/api/remote/status', { headers: { Cookie: key } }).then((x) => x.json());
  assert.equal(st.player, false);
  assert.ok(st.awakeUntil > Date.now() + 59 * 60000 && st.awakeUntil <= Date.now() + 60 * 60000 + 1000, 'éveillé pendant 1 h');
});

test('« Ouvrir sur l’ordinateur » lance la page App Music locale', async () => {
  const r = await post(`http://127.0.0.1:${lanPort}/api/remote/open`, {}, { Cookie: key }).then((x) => x.json());
  assert.equal(r.ok, true);
  assert.equal(fs.readFileSync(openLog, 'utf8').trim(), `http://localhost:${srv.port}/`);
});

test('hors de la maison, l’écoute se ferme ; de retour, elle se rouvre', async () => {
  setNetwork({ id: 'cafe', address: '127.0.0.1', subnet: '127.0.0.x' });
  assert.ok(await until(async () => !(await lanUp())), 'fermée sur un autre réseau');
  setNetwork({});
  await sleep(400);
  assert.equal(await lanUp(), false, 'fermée sans réseau');
  setNetwork(HOME);
  assert.ok(await until(lanUp), 'rouverte à la maison (un téléphone est associé)');
});

test('retirer le téléphone : sa clé ne marche plus, l’écoute se ferme', async () => {
  const dev = (await srv.api('/api/remote/admin')).body.devices[0];
  assert.equal((await fetch(`${srv.url}/api/remote/devices/${dev.id}/revoke`, { method: 'POST' })).status, 200);
  assert.ok(await until(async () => !(await lanUp())), 'plus aucun appareil : plus d’écoute');
  // de nouveau à l'écoute pour une autre association : l'ancienne clé est refusée
  await fetch(srv.url + '/api/remote/pair', { method: 'POST' });
  assert.equal((await lan('/api/library', { headers: { Cookie: key } })).status, 401);
  await fetch(srv.url + '/api/remote/pair/cancel', { method: 'POST' });
});

test('oublier le réseau de la maison', async () => {
  const home = (await srv.api('/api/remote/admin')).body.homes[0];
  await fetch(`${srv.url}/api/remote/homes/${home.id}/forget`, { method: 'POST' });
  const st = (await srv.api('/api/remote/admin')).body;
  assert.deepEqual(st.homes, []);
  assert.equal(st.network.home, false);
});

test('code expiré, puis essais en rafale bloqués', async () => {
  const net = path.join(tmp, 'net2.json'); fs.writeFileSync(net, JSON.stringify(HOME));
  const port2 = await freePort();
  const s2 = await startServer({ env: { APPMUSIC_FAKE_NETWORK: net, APPMUSIC_LAN_PORT: String(port2), APPMUSIC_PAIR_TTL: '400', APPMUSIC_NET_INTERVAL: '100' } });
  try {
    const r = await fetch(s2.url + '/api/remote/pair', { method: 'POST' }).then((x) => x.json());
    const code = r.url.split('#pair=')[1];
    await sleep(500);
    const late = await post(`http://127.0.0.1:${port2}/api/pair`, { code }).catch(() => null);
    assert.ok(!late || late.status === 403, 'code expiré refusé (ou écoute déjà refermée)');
    const r2 = await fetch(s2.url + '/api/remote/pair', { method: 'POST' }).then((x) => x.json());
    const good = r2.url.split('#pair=')[1];
    for (let i = 0; i < 10; i++) await post(`http://127.0.0.1:${port2}/api/pair`, { code: 'x'.repeat(good.length) });
    const blocked = await post(`http://127.0.0.1:${port2}/api/pair`, { code: good });
    assert.equal(blocked.status, 429, 'trop d’essais : même le bon code attend');
  } finally { await s2.stop(); }
});
