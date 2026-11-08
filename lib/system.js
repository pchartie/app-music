// Tout ce qui dépend du système d'exploitation (macOS, Linux, Windows) passe par ici : réseau local et box,
// empêcher la veille, ouvrir une page dans le navigateur, nom de l'ordinateur, choix d'un dossier, disques externes.
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAC = process.platform === 'darwin';
const WIN = process.platform === 'win32';

// Interfaces à ignorer : VPN, tunnels, conteneurs, machines virtuelles, liaisons internes d'Apple
// (noms courts de macOS et Linux ; sous Windows, noms lisibles comme « vEthernet (WSL) » ou « ProtonVPN »)
const VIRTUAL = /^(lo|utun|tun|tap|wg|ppp|ipsec|tailscale|zt|docker|br-|veth|virbr|vmnet|vboxnet|bridge|llw|awdl|anpi|gif|stf|proton|pvpn|nordlynx)|vethernet|virtualbox|vmware|hyper-v|loopback|vpn|wireguard|tailscale|zerotier|bluetooth/i;
export const isVirtualInterface = (name) => VIRTUAL.test(name);
const VPN = /^(utun|tun|wg|ppp|ipsec|proton|pvpn|nordlynx)|vpn|wireguard/i;
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
  const rank = (n) => (/^(en0|wlan|wlp|wl|wi-?fi)/i.test(n) ? 0 : /^(en|eth|enp|eno)/i.test(n) ? 1 : 2);
  return out.sort((a, b) => rank(a.iface) - rank(b.iface));
}

// Un VPN actif peut bloquer les connexions venant du réseau local (selon ses réglages)
export function vpnActive() {
  return Object.entries(os.networkInterfaces()).some(([name, addrs]) =>
    VPN.test(name) && (addrs || []).some((a) => a.family === 'IPv4' && !a.internal));
}

const pad = (mac) => mac.toLowerCase().split(':').map((x) => x.padStart(2, '0')).join(':');

// ---- lecture des tables du système (fonctions pures, testées avec des sorties types) ----
// Linux /proc/net/route : passerelle en hexadécimal, octets inversés
export function parseProcRoute(text, iface) {
  const row = text.trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/)).find((c) => c[0] === iface && c[1] === '00000000');
  return row ? row[2].match(/../g).reverse().map((h) => parseInt(h, 16)).join('.') : null;
}
export function parseProcArp(text, ip, iface) {
  const row = text.trim().split('\n').slice(1).map((l) => l.trim().split(/\s+/)).find((c) => c[0] === ip && (!iface || c[5] === iface));
  return row && row[3] !== '00:00:00:00:00:00' ? pad(row[3]) : null;
}
// Windows `route print -4` : « 0.0.0.0  0.0.0.0  passerelle  adresse-de-la-carte  métrique » (en-têtes traduits, ignorés)
export function parseWinRoute(text, address) {
  const rows = [...text.matchAll(/^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+)\s*$/gm)]
    .map((m) => ({ gw: m[1], address: m[2], metric: +m[3] })).filter((r) => r.address === address).sort((a, b) => a.metric - b.metric);
  return rows[0]?.gw || null;
}
// `arp -a <ip>` (Windows : aa-bb-cc-dd-ee-ff) ou `arp -n <ip>` (macOS : « ? (ip) at a:b:c:d:e:f »)
export function parseArp(text, ip) {
  const esc = ip.replace(/\./g, '\\.');
  const m = text.match(new RegExp(`(?:^|[\\s(])${esc}\\)?\\s+(?:at\\s+)?([0-9a-f]{1,2}(?:[:-][0-9a-f]{1,2}){5})\\b`, 'im'));
  return m && !/^(0{1,2}[:-]){5}0{1,2}$/.test(m[1]) && !/^(ff[:-]){5}ff$/i.test(m[1]) ? pad(m[1].replace(/-/g, ':')) : null;
}

async function gatewayOf(iface, address) {
  if (MAC) {
    const { stdout } = await exec('ipconfig', ['getoption', iface, 'router'], { timeout: 3000 });
    return stdout.trim() || null;
  }
  if (WIN) return parseWinRoute((await exec('route', ['print', '-4'], { timeout: 5000, windowsHide: true })).stdout, address);
  return parseProcRoute(fs.readFileSync('/proc/net/route', 'utf8'), iface);
}
const MAC_RE = '([0-9a-f]{1,2}(?::[0-9a-f]{1,2}){5})';
async function macOf(ip, iface) {
  if (WIN) {
    try { return parseArp((await exec('arp', ['-a', ip], { timeout: 5000, windowsHide: true })).stdout, ip); } catch { return null; }
  }
  if (MAC) {
    // 1. table ARP (macOS la masque parfois aux programmes sans autorisation « réseau local »)
    try {
      const mac = parseArp((await exec('arp', ['-n', ip], { timeout: 3000 })).stdout, ip);
      if (mac) return mac;
    } catch {}
    // 2. résumé de la carte réseau : annonces IPv6 de la box (adresse matérielle de l'émetteur)
    try {
      const { stdout } = await exec('ipconfig', ['getsummary', iface], { timeout: 3000 });
      const m = stdout.match(new RegExp('source link-address option[^\\n]*?: ' + MAC_RE, 'i')) || stdout.match(new RegExp('SERVERID[^\\n]*DUID LL[^\\n]*Addr ' + MAC_RE, 'i'));
      if (m) return pad(m[1]);
    } catch {}
    return null;
  }
  return parseProcArp(fs.readFileSync('/proc/net/arp', 'utf8'), ip, iface);
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
      const gw = await gatewayOf(it.iface, it.address);
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
// macOS : caffeinate ; Linux : systemd-inhibit ; Windows : SetThreadExecutionState via PowerShell.
// Dans les trois cas, la commande s'arrête d'elle-même si le serveur disparaît (même brutalement).
export function awakeCommand(platform, secs, pid) {
  if (platform === 'darwin') return ['caffeinate', ['-i', '-t', String(secs), '-w', String(pid)]];
  if (platform === 'win32') {
    const ps = `$k = Add-Type -Name Awake -Namespace AppMusic -PassThru -MemberDefinition '[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);'
$null = $k::SetThreadExecutionState([uint32]2147483649)
$end = (Get-Date).AddSeconds(${secs})
while ((Get-Date) -lt $end -and (Get-Process -Id ${pid} -ErrorAction SilentlyContinue)) { Start-Sleep -Seconds 5 }`;
    return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')]];
  }
  return ['systemd-inhibit', ['--what=idle:sleep', '--who=App Music', '--why=Télécommande depuis un téléphone', '--mode=block',
    'sh', '-c', `i=0; while [ $i -lt ${secs} ] && kill -0 ${pid} 2>/dev/null; do sleep 5; i=$((i+5)); done`]];
}
let awakeChild = null, awakeUntil = 0, awakeStarted = 0;
export function keepAwake(ms) {
  const now = Date.now();
  awakeUntil = now + ms;
  // inutile de relancer la commande à chaque appui sur le téléphone : au plus une fois par minute
  if (awakeChild && now - awakeStarted < 60000) return awakeUntil;
  stopKeepAwake(false);
  const [cmd, args] = awakeCommand(process.platform, Math.ceil(ms / 1000), process.pid);
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', windowsHide: true });
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
  const [cmd, args] = openCommand(process.platform, url);
  try { await exec(cmd, args, { timeout: 10000, windowsHide: true }); return true; } catch { return false; }
}
// Windows : rundll32 plutôt que « start », qui passerait par l'interpréteur de commandes (caractères spéciaux de l'adresse)
export const openCommand = (platform, url) => (platform === 'darwin' ? ['open', [url]] : platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]]);

// « le Mac » sur macOS, sinon le nom de la machine (« Ouvrir sur le Mac », « Ouvrir sur mon-portable »)
export function computerLabel() {
  if (MAC) return 'le Mac';
  return os.hostname().replace(/\.local$/, '') || 'l’ordinateur';
}

// ---------- Dossiers ----------
const PICK_PROMPT = 'Choisissez le dossier qui contient votre musique';
// Lance une commande ; renvoie { out } ou { missing } (programme absent) ou { failed } (annulé, erreur)
const runCmd = (cmd, args) => exec(cmd, args, { timeout: 300000, windowsHide: true, encoding: 'utf8' })
  .then(({ stdout }) => ({ out: stdout }), (e) => (e.code === 'ENOENT' ? { missing: true } : { failed: true }));

// Fenêtres natives de choix de dossier, par ordre de préférence
export function pickerCommands(platform = process.platform) {
  if (platform === 'darwin') return [['osascript', ['-e', `POSIX path of (choose folder with prompt "${PICK_PROMPT}")`]]];
  if (platform === 'win32') {
    // script passé encodé (UTF-16) : pas de souci de guillemets ni d'accents ; sortie forcée en UTF-8
    const ps = `[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms
$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false }
$d = New-Object System.Windows.Forms.FolderBrowserDialog
$d.Description = '${PICK_PROMPT}'
$d.ShowNewFolderButton = $false
if ($d.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { $d.SelectedPath }`;
    return [['powershell.exe', ['-NoProfile', '-STA', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')]]];
  }
  return [
    ['zenity', ['--file-selection', '--directory', `--title=${PICK_PROMPT}`]], // GNOME et la plupart des bureaux
    ['kdialog', ['--getexistingdirectory', os.homedir(), '--title', PICK_PROMPT]], // KDE
  ];
}

// Ouvre la fenêtre de choix de dossier du système (le serveur tourne sur la même machine que l'utilisateur).
// { path } | { cancelled: true } | { unavailable: true } (aucune fenêtre disponible : saisir le chemin)
export async function pickFolder({ platform = process.platform, run = runCmd } = {}) {
  for (const [cmd, args] of pickerCommands(platform)) {
    const r = await run(cmd, args);
    if (r.missing) continue;
    const p = (r.out || '').trim();
    if (r.failed || !p) return { cancelled: true };
    return { path: p.length > 1 ? p.replace(/[\\/]$/, '') : p };
  }
  return { unavailable: true };
}

// Disques externes et clés USB, là où chaque système les monte
export function volumeDirs({ platform = process.platform, user = os.userInfo().username, list = listDir, exists = fs.existsSync, real = realOr } = {}) {
  const sub = (d) => list(d).map((n) => `${d}/${n}`);
  if (platform === 'darwin') return sub('/Volumes').filter((v) => real(v) !== '/'); // le disque du Mac est un lien vers /
  if (platform === 'win32') {
    const sys = (process.env.SystemDrive || 'C:').toUpperCase()[0];
    return [...'DEFGHIJKLMNOPQRSTUVWXYZ'].filter((l) => l !== sys).map((l) => `${l}:\\`).filter(exists);
  }
  const out = [...sub(`/media/${user}`), ...sub(`/run/media/${user}`), ...sub('/mnt')];
  for (const v of sub('/media')) if (v !== `/media/${user}`) out.push(v); // montages directement dans /media
  return [...new Set(out)];
}
function listDir(d) {
  try { return fs.readdirSync(d, { withFileTypes: true }).filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !e.name.startsWith('.')).map((e) => e.name); } catch { return []; }
}
function realOr(p) { try { return fs.realpathSync(p); } catch { return p; } }
