// Tout ce qui dépend du système d'exploitation (macOS aujourd'hui, Linux demain) passe par ici :
// réseau local et box, empêcher la veille, ouvrir une page dans le navigateur, nom de l'ordinateur.
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAC = process.platform === 'darwin';

// Interfaces à ignorer : VPN, tunnels, conteneurs, liaisons internes d'Apple
const VIRTUAL = /^(lo|utun|tun|tap|wg|ppp|ipsec|tailscale|zt|docker|br-|veth|virbr|vmnet|vboxnet|bridge|llw|awdl|anpi|gif|stf)/;
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|127\.)/; // + la machine elle-même
export const isPrivateIPv4 = (ip) => PRIVATE.test(String(ip || '').replace(/^::ffff:/, ''));

// Adresses IPv4 privées des cartes réseau physiques (Wi-Fi, Ethernet)
function lanInterfaces() {
  const out = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (VIRTUAL.test(name)) continue;
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' || a.internal || a.netmask === '255.255.255.255' || !isPrivateIPv4(a.address) || a.address.startsWith('169.254.')) continue;
      out.push({ iface: name, address: a.address, netmask: a.netmask });
    }
  }
  // Wi-Fi/Ethernet habituels d'abord
  const rank = (n) => (/^(en0|wlan|wlp|wl)/.test(n) ? 0 : /^(en|eth|enp|eno)/.test(n) ? 1 : 2);
  return out.sort((a, b) => rank(a.iface) - rank(b.iface));
}

// Un VPN actif peut bloquer les connexions venant du réseau local (selon ses réglages)
export function vpnActive() {
  return Object.entries(os.networkInterfaces()).some(([name, addrs]) =>
    /^(utun|tun|wg|ppp|ipsec)/.test(name) && (addrs || []).some((a) => a.family === 'IPv4' && !a.internal));
}

const pad = (mac) => mac.toLowerCase().split(':').map((x) => x.padStart(2, '0')).join(':');

async function gatewayOf(iface) {
  if (MAC) {
    const { stdout } = await exec('ipconfig', ['getoption', iface, 'router'], { timeout: 3000 });
    return stdout.trim() || null;
  }
  // Linux : /proc/net/route (passerelle en hexadécimal, octets inversés)
  const lines = fs.readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/));
  const row = lines.find((c) => c[0] === iface && c[1] === '00000000');
  if (!row) return null;
  return row[2].match(/../g).reverse().map((h) => parseInt(h, 16)).join('.');
}
const MAC_RE = '([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5})';
async function macOf(ip, iface) {
  if (MAC) {
    // 1. table ARP (macOS la masque parfois aux programmes sans autorisation « réseau local »)
    try {
      const { stdout } = await exec('arp', ['-n', ip], { timeout: 3000 });
      const m = stdout.match(new RegExp(' at ' + MAC_RE, 'i'));
      if (m) return pad(m[1]);
    } catch {}
    // 2. résumé de la carte réseau : annonces IPv6 de la box (adresse matérielle de l'émetteur)
    try {
      const { stdout } = await exec('ipconfig', ['getsummary', iface], { timeout: 3000 });
      const m = stdout.match(new RegExp('source link-address option[^\\n]*?: ' + MAC_RE, 'i')) || stdout.match(new RegExp('SERVERID[^\\n]*DUID LL[^\\n]*Addr ' + MAC_RE, 'i'));
      if (m) return pad(m[1]);
    } catch {}
    return null;
  }
  const row = fs.readFileSync('/proc/net/arp', 'utf8').trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/))
    .find((c) => c[0] === ip && (!iface || c[5] === iface));
  return row && row[3] !== '00:00:00:00:00:00' ? pad(row[3]) : null;
}

// Réseau local actuel : adresse de l'ordinateur et empreinte de la box (adresse matérielle de la passerelle).
// L'empreinte ne change pas d'un jour à l'autre, contrairement aux adresses IP, et diffère d'un café à l'autre.
// APPMUSIC_FAKE_NETWORK (tests) : fichier JSON { id, address } ou {} pour « aucun réseau ».
export async function currentNetwork() {
  if (process.env.APPMUSIC_FAKE_NETWORK) {
    try { const n = JSON.parse(fs.readFileSync(process.env.APPMUSIC_FAKE_NETWORK, 'utf8')); return n.id ? { ...n, vpn: !!n.vpn } : null; } catch { return null; }
  }
  for (const it of lanInterfaces()) {
    try {
      const gw = await gatewayOf(it.iface);
      if (!gw) continue;
      // sans adresse matérielle, repli moins précis : passerelle + sous-réseau
      const mac = await macOf(gw, it.iface);
      const id = crypto.createHash('sha256').update('app-music:' + (mac || `${gw}/${it.netmask}`)).digest('hex').slice(0, 16);
      const subnet = it.address.split('.').slice(0, 3).join('.') + '.x';
      return { id, address: it.address, subnet, iface: it.iface, vpn: vpnActive(), precise: !!mac };
    } catch {}
  }
  return null;
}

// Empêcher la mise en veille (l'écran peut s'éteindre) pendant `ms` ; chaque appel repousse l'échéance.
// macOS : caffeinate (s'arrête aussi avec le serveur grâce à -w) ; Linux : systemd-inhibit.
let awakeChild = null, awakeUntil = 0, awakeStarted = 0;
export function keepAwake(ms) {
  const now = Date.now();
  awakeUntil = now + ms;
  // inutile de relancer la commande à chaque appui sur le téléphone : au plus une fois par minute
  if (awakeChild && now - awakeStarted < 60000) return awakeUntil;
  stopKeepAwake(false);
  const secs = String(Math.ceil(ms / 1000));
  const [cmd, args] = MAC ? ['caffeinate', ['-i', '-t', secs, '-w', String(process.pid)]]
    : ['systemd-inhibit', ['--what=idle:sleep', '--who=App Music', '--why=Télécommande depuis un téléphone', '--mode=block', 'sleep', secs]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore' });
    const gone = () => { if (awakeChild === child) awakeChild = null; };
    child.on('error', gone); child.on('exit', gone);
    awakeChild = child; awakeStarted = now;
  } catch { awakeChild = null; }
  return awakeUntil;
}
export function stopKeepAwake(reset = true) {
  if (awakeChild) { try { awakeChild.kill(); } catch {} awakeChild = null; }
  if (reset) awakeUntil = 0;
}
export const awakeDeadline = () => (awakeUntil > Date.now() ? awakeUntil : 0);
process.on('exit', () => stopKeepAwake());
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { stopKeepAwake(); process.exit(0); });

// Ouvrir une adresse dans le navigateur par défaut (APPMUSIC_OPEN_LOG : les tests notent l'adresse au lieu de l'ouvrir)
export async function openUrl(url) {
  if (process.env.APPMUSIC_OPEN_LOG) { fs.appendFileSync(process.env.APPMUSIC_OPEN_LOG, url + '\n'); return true; }
  try { await exec(MAC ? 'open' : 'xdg-open', [url], { timeout: 10000 }); return true; } catch { return false; }
}

// « le Mac » sur macOS, sinon le nom de la machine (« Ouvrir sur le Mac », « Ouvrir sur mon-portable »)
export function computerLabel() {
  if (MAC) return 'le Mac';
  return os.hostname().replace(/\.local$/, '') || 'l’ordinateur';
}
