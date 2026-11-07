// Télécommande depuis un téléphone : association par QR code, clés d'appareil, réseau de la maison,
// et canal en direct (SSE) entre le téléphone et la page App Music ouverte sur l'ordinateur, qui joue la musique.
//
// Sécurité :
// - le serveur principal n'écoute que l'ordinateur lui-même (127.0.0.1), comme avant ;
// - un second point d'écoute, sur l'adresse du réseau local, n'est ouvert que sur un réseau reconnu comme
//   celui de la maison, et seulement s'il y a un téléphone associé (ou une association en cours) ;
// - depuis le réseau, tout passe par une liste blanche ; hors de la page d'association, il faut une clé d'appareil
//   (cookie obtenu en scannant le QR code, code à usage unique valable 3 minutes) ;
// - l'administration (dossier de musique, réindexation, association, appareils) reste réservée à l'ordinateur.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { currentNetwork, keepAwake, awakeDeadline, openUrl, computerLabel, isPrivateIPv4 } from './system.js';
import { qrSvg } from './qr.js';

export const PAIR_TTL = Number(process.env.APPMUSIC_PAIR_TTL || 3 * 60 * 1000); // réglable pour les tests
export const AWAKE_MS = 60 * 60 * 1000; // l'ordinateur reste éveillé 1 h après la dernière action du téléphone
const COOKIE = 'am_key';
const COOKIE_AGE = 400 * 24 * 3600; // maximum accepté par Chrome ; renouvelé à chaque visite
const ACTIONS = new Set(['toggle', 'play', 'pause', 'next', 'prev', 'seek', 'volume', 'playList', 'enqueue', 'jump', 'remove', 'move', 'shuffle', 'repeat', 'clear']);

// Accès depuis le réseau : ce qui est permis sans clé, puis avec une clé d'appareil
const OPEN_PATHS = [/^\/m\/[\w.-]*$/, /^\/(search|mixes)\.js$/, /^\/icon\.svg$/, /^\/api\/pair$/, /^\/api\/remote\/whoami$/];
const KEY_PATHS = [/^\/api\/library$/, /^\/api\/(artist|album)\/\w+$/, /^\/api\/artist\/\w+\/(picture|fanart)$/, /^\/cover\/\w+\.jpg$/, /^\/api\/remote\/(events|command|open|status)$/];

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const token = (n) => crypto.randomBytes(n).toString('base64url');
const cookies = (req) => Object.fromEntries((req.headers.cookie || '').split(/;\s*/).filter(Boolean).map((c) => { const i = c.indexOf('='); return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))]; }));
const send = (res, data) => { try { res.write(`data: ${JSON.stringify(data)}\n\n`); } catch {} };
function json(res, data, code = 200, headers = {}) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}
const readJSON = (req, max = 2e5) => new Promise((resolve) => {
  let n = 0; const chunks = [];
  req.on('data', (c) => { n += c.length; if (n > max) req.destroy(); else chunks.push(c); });
  req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch { resolve({}); } });
  req.on('error', () => resolve({}));
});

export function createRemote({ cacheDir, port, lanPort = port, handler, getLibrary, log = console.log }) {
  const FILE = path.join(cacheDir, 'remote.json');
  let store = { homes: [], devices: [] };
  try { store = { homes: [], devices: [], ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch {}
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = null; fs.writeFileSync(FILE, JSON.stringify(store, null, 2)); };
  const saveSoon = () => { saveTimer ||= setTimeout(save, 60000); saveTimer.unref?.(); };

  let network = null; // réseau actuel
  let pairing = null; // { code, expiresAt }
  const failures = []; // essais de code invalides (limite contre les essais en rafale)

  // ---------- Point d'écoute sur le réseau local ----------
  let lan = null; // { server, address, sockets }
  const atHome = () => !!network && store.homes.some((h) => h.id === network.id);
  const lanUrl = () => (lan ? `http://${lan.address}:${lanPort}` : null);
  function closeLan() {
    if (!lan) return;
    const { server, sockets } = lan; lan = null;
    for (const r of [...remotes]) if (r.lan) { remotes.delete(r); try { r.res.end(); } catch {} }
    server.close(); for (const s of sockets) s.destroy();
    log('Télécommande : réseau local fermé');
    notifyPlayers();
  }
  function openLan(address) {
    return new Promise((resolve) => {
      const server = http.createServer((req, res) => handler(req, res, true));
      const sockets = new Set();
      server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
      server.once('error', (e) => { log('Télécommande : écoute impossible sur le réseau local :', e.message); resolve(false); });
      server.listen(lanPort, address, () => { lan = { server, address, sockets }; log(`Télécommande : ${lanUrl()}`); resolve(true); });
    });
  }
  // une seule mise à jour à la fois (minuterie, panneau et association peuvent la demander en même temps)
  let chain = Promise.resolve(false);
  const refresh = () => (chain = chain.then(update, update));
  async function update() {
    network = await currentNetwork();
    if (pairing && pairing.expiresAt < Date.now()) pairing = null;
    const want = atHome() && (store.devices.length > 0 || !!pairing);
    if (lan && (!want || lan.address !== network.address)) closeLan();
    if (want && !lan) await openLan(network.address);
    return !!lan;
  }
  const timer = setInterval(() => refresh().catch(() => {}), Number(process.env.APPMUSIC_NET_INTERVAL || 20000));
  timer.unref?.();

  // ---------- Appareils ----------
  function deviceOf(req) {
    const key = cookies(req)[COOKIE];
    return key ? store.devices.find((d) => d.keyHash === sha(key)) || null : null;
  }
  const keyCookie = (key) => `${COOKIE}=${key}; Path=/; Max-Age=${COOKIE_AGE}; HttpOnly; SameSite=Strict`;
  function seen(dev) {
    const now = Date.now();
    if (now - (dev.lastSeen || 0) > 60000) { dev.lastSeen = now; saveSoon(); }
  }
  function redeem(code, name) {
    const now = Date.now();
    while (failures.length && failures[0] < now - 10 * 60000) failures.shift();
    if (failures.length >= 10) return { error: 'Trop d’essais : réessayez dans quelques minutes.', code: 429 };
    const given = Buffer.from(typeof code === 'string' ? code : ''), expected = pairing && Buffer.from(pairing.code);
    const ok = !!pairing && pairing.expiresAt > now && given.length === expected.length && crypto.timingSafeEqual(given, expected);
    if (!ok) { failures.push(now); return { error: 'Ce code a expiré ou a déjà servi : affichez un nouveau QR code sur l’ordinateur.', code: 403 }; }
    pairing = null; // usage unique
    const key = token(32);
    const dev = { id: token(9), name: String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 40) || 'Téléphone', keyHash: sha(key), addedAt: now, lastSeen: now };
    store.devices.push(dev); save();
    log(`Télécommande : « ${dev.name} » associé`);
    return { key, device: dev };
  }
  const publicDevice = (d) => ({ id: d.id, name: d.name, addedAt: d.addedAt, lastSeen: d.lastSeen, online: [...remotes].some((r) => r.deviceId === d.id) });

  // ---------- Canal en direct ----------
  const players = []; // pages App Music de l'ordinateur ; la plus récente joue
  const remotes = new Set(); // téléphones connectés
  let lastState = null;
  const activePlayer = () => players[players.length - 1] || null;
  const hello = () => ({ type: 'status', player: !!activePlayer(), computer: computerLabel(), state: activePlayer() ? lastState : null });
  const notifyRemotes = (data) => { for (const r of remotes) send(r.res, data); };
  const notifyPlayers = () => { for (const p of players) send(p.res, { type: 'remotes', count: remotes.size }); };
  function sse(req, res) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 2000\n\n');
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch {} }, 25000);
    req.on('close', () => clearInterval(ping));
  }

  // ---------- Routes ----------
  // Filtre des requêtes arrivées par le réseau local. Renvoie false si la requête a déjà reçu une réponse.
  const lastLogged = new Map(); // journal : une ligne par appareil et par quart d'heure, pour diagnostiquer
  function gate(req, res, p) {
    const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
    if (Date.now() - (lastLogged.get(ip) || 0) > 15 * 60000) { lastLogged.set(ip, Date.now()); log(`Télécommande : connexion de ${ip} (${p})`); }
    if (!isPrivateIPv4(req.socket.remoteAddress)) { res.writeHead(403); res.end(); return false; }
    if (p === '/' || p === '/m') { res.writeHead(302, { Location: '/m/' }); res.end(); return false; }
    if (OPEN_PATHS.some((r) => r.test(p))) return true;
    if (!KEY_PATHS.some((r) => r.test(p))) { res.writeHead(403); res.end(); return false; }
    const dev = deviceOf(req);
    if (!dev) { json(res, { error: 'not-paired' }, 401); return false; }
    req.device = dev; seen(dev);
    return true;
  }

  // Routes /api/pair et /api/remote/* ; renvoie true si la requête a été traitée.
  async function route(req, res, p, url, fromLan) {
    if (p === '/api/pair' && req.method === 'POST') {
      const body = await readJSON(req, 4000);
      const r = redeem(body.code, body.name);
      if (r.error) return json(res, { error: r.error }, r.code), true;
      return json(res, { ok: true, name: r.device.name }, 200, { 'Set-Cookie': keyCookie(r.key) }), true;
    }
    if (!p.startsWith('/api/remote/')) return false;
    // sur l'ordinateur : seulement la page App Music elle-même (pas un autre site ouvert dans le navigateur,
    // ni une adresse détournée vers 127.0.0.1)
    if (!fromLan) {
      const host = String(req.headers.host || '').replace(/:\d+$/, '');
      if (req.headers['sec-fetch-site'] === 'cross-site' || !['localhost', '127.0.0.1', '[::1]'].includes(host)) { res.writeHead(403); res.end(); return true; }
    }
    const what = p.slice('/api/remote/'.length);
    const dev = req.device || deviceOf(req);

    if (what === 'whoami') {
      if (dev) { seen(dev); res.setHeader('Set-Cookie', keyCookie(cookies(req)[COOKIE])); }
      return json(res, { paired: !!dev || !fromLan, name: dev?.name || null, computer: computerLabel() }), true;
    }
    if (what === 'status') return json(res, { player: !!activePlayer(), computer: computerLabel(), awakeUntil: awakeDeadline() || null }), true;
    if (what === 'events' && url.searchParams.get('role') !== 'player') {
      sse(req, res);
      const r = { res, deviceId: dev?.id || null, lan: fromLan };
      remotes.add(r); send(res, hello()); notifyPlayers();
      req.on('close', () => { remotes.delete(r); notifyPlayers(); });
      return true;
    }
    if (what === 'command' && req.method === 'POST') {
      const cmd = await readJSON(req, 1e6);
      if (!ACTIONS.has(cmd.action)) return json(res, { error: 'Commande inconnue.' }, 400), true;
      const lib = getLibrary();
      if (cmd.ids !== undefined) {
        if (!Array.isArray(cmd.ids) || !cmd.ids.length || cmd.ids.length > 20000) return json(res, { error: 'Titres invalides.' }, 400), true;
        const known = new Set(lib.tracks.map((t) => t.id));
        if (!cmd.ids.every((id) => typeof id === 'string' && known.has(id))) return json(res, { error: 'Titres inconnus.' }, 400), true;
      }
      for (const k of ['position', 'value', 'start', 'index', 'from', 'to']) if (cmd[k] !== undefined && !Number.isFinite(cmd[k])) return json(res, { error: 'Valeur invalide.' }, 400), true;
      if (fromLan) keepAwake(AWAKE_MS);
      const pl = activePlayer();
      if (!pl) return json(res, { error: 'no-player', computer: computerLabel() }, 409), true;
      const clean = Object.fromEntries(Object.entries(cmd).filter(([k]) => ['action', 'ids', 'position', 'value', 'start', 'index', 'from', 'to', 'shuffle', 'next'].includes(k)));
      send(pl.res, { type: 'command', cmd: clean });
      return json(res, { ok: true }), true;
    }
    if (what === 'open' && req.method === 'POST') {
      if (fromLan) keepAwake(AWAKE_MS);
      if (activePlayer()) return json(res, { ok: true, already: true }), true;
      const ok = await openUrl(`http://localhost:${port}/`);
      return json(res, { ok }), true;
    }

    // ----- réservé à l'ordinateur -----
    if (fromLan) { res.writeHead(403); res.end(); return true; }
    if (what === 'events') {
      sse(req, res);
      const pl = { res, id: String(url.searchParams.get('id') || token(6)).slice(0, 40) };
      players.push(pl); send(res, { type: 'remotes', count: remotes.size });
      notifyRemotes(hello());
      req.on('close', () => {
        const wasActive = activePlayer() === pl;
        const i = players.indexOf(pl); if (i >= 0) players.splice(i, 1);
        // la page précédente reprend la main : elle renverra son état en recevant le nombre de téléphones
        if (wasActive) { lastState = null; notifyPlayers(); }
        notifyRemotes(hello());
      });
      return true;
    }
    if (what === 'state' && req.method === 'POST') {
      const body = await readJSON(req, 1e6);
      const pl = activePlayer();
      if (!pl || body.id !== pl.id) return json(res, { ok: false, active: false }), true;
      lastState = body.state || null;
      notifyRemotes({ type: 'state', state: lastState });
      return json(res, { ok: true, active: true }), true;
    }
    if (what === 'admin') {
      await refresh();
      return json(res, {
        network: network && { subnet: network.subnet, home: atHome(), vpn: network.vpn, precise: network.precise !== false },
        homes: store.homes.map((h) => ({ id: h.id, subnet: h.subnet, addedAt: h.addedAt, current: h.id === network?.id })),
        devices: store.devices.map(publicDevice),
        listening: lanUrl(),
        pairing: pairing && pairing.expiresAt > Date.now() ? { expiresAt: pairing.expiresAt } : null,
        computer: computerLabel(),
      }), true;
    }
    if (what === 'pair' && req.method === 'POST') {
      network = await currentNetwork();
      if (!network) return json(res, { error: 'no-network' }, 409), true;
      if (!atHome()) { store.homes.push({ id: network.id, subnet: network.subnet, addedAt: Date.now() }); save(); }
      pairing = { code: token(16), expiresAt: Date.now() + PAIR_TTL };
      if (!(await refresh())) { pairing = null; return json(res, { error: 'listen-failed' }, 500), true; }
      const link = `${lanUrl()}/m/#pair=${pairing.code}`;
      return json(res, { url: link, svg: qrSvg(link), expiresAt: pairing.expiresAt, vpn: network.vpn }), true;
    }
    if (what === 'pair/cancel' && req.method === 'POST') { pairing = null; await refresh(); return json(res, { ok: true }), true; }
    let m;
    if ((m = what.match(/^devices\/([\w-]+)\/revoke$/)) && req.method === 'POST') {
      const dev2 = store.devices.find((d) => d.id === m[1]);
      if (!dev2) return json(res, { error: 'Appareil inconnu.' }, 404), true;
      store.devices = store.devices.filter((d) => d !== dev2); save();
      // prévenir le téléphone avant de couper (sans téléphone associé, l'écoute se ferme aussitôt)
      for (const r of [...remotes]) if (r.deviceId === dev2.id) { remotes.delete(r); send(r.res, { type: 'revoked' }); try { r.res.end(); } catch {} }
      log(`Télécommande : « ${dev2.name} » retiré`);
      await refresh(); notifyPlayers();
      return json(res, { ok: true }), true;
    }
    if ((m = what.match(/^homes\/([\w-]+)\/forget$/)) && req.method === 'POST') {
      store.homes = store.homes.filter((h) => h.id !== m[1]); save();
      log('Télécommande : réseau de la maison oublié');
      await refresh();
      return json(res, { ok: true }), true;
    }
    return json(res, { error: 'not-found' }, 404), true;
  }

  return { gate, route, refresh, close() { clearInterval(timer); if (saveTimer) save(); closeLan(); } };
}
