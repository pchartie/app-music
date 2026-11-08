// Couche système (lib/system.js) : chaque fonction a sa version macOS, Linux et Windows.
// Les sorties des commandes sont simulées : ces tests passent sur n'importe quel système.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseProcRoute, parseProcArp, parseWinRoute, parseArp, pickFolder, pickerCommands,
  volumeDirs, awakeCommand, openCommand, isVirtualInterface,
} from '../lib/system.js';

const decodePs = (args) => Buffer.from(args[args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');

test('cartes réseau : Wi-Fi et Ethernet retenus ; VPN, machines virtuelles et tunnels ignorés', () => {
  for (const n of ['en0', 'en7', 'wlp2s0', 'wlan0', 'eth0', 'enp3s0', 'Wi-Fi', 'Ethernet', 'Ethernet 2']) assert.equal(isVirtualInterface(n), false, n);
  for (const n of ['lo0', 'utun3', 'awdl0', 'docker0', 'tailscale0', 'wg0', 'proton0', 'vEthernet (WSL)', 'VirtualBox Host-Only Network',
    'VMware Network Adapter VMnet8', 'ProtonVPN', 'Loopback Pseudo-Interface 1', 'Connexion réseau Bluetooth']) assert.equal(isVirtualInterface(n), true, n);
});

test('box de la maison sous Linux : passerelle et adresse matérielle lues dans /proc', () => {
  const route = `Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT
wlp2s0\t00000000\t0101A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0
wlp2s0\t0001A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0`;
  assert.equal(parseProcRoute(route, 'wlp2s0'), '192.168.1.1');
  assert.equal(parseProcRoute(route, 'eth0'), null);
  const arp = `IP address       HW type     Flags       HW address            Mask     Device
192.168.1.1      0x1         0x2         a4:3e:51:0b:c2:7f     *        wlp2s0
192.168.1.40     0x1         0x0         00:00:00:00:00:00     *        wlp2s0`;
  assert.equal(parseProcArp(arp, '192.168.1.1', 'wlp2s0'), 'a4:3e:51:0b:c2:7f');
  assert.equal(parseProcArp(arp, '192.168.1.40', 'wlp2s0'), null, 'entrée incomplète');
});

test('box de la maison sous Windows : route print et arp -a, quelle que soit la langue', () => {
  const route = `===========================================================================
Itinéraires actifs :
Destination réseau    Masque réseau  Adr. passerelle   Adr. interface Métrique
          0.0.0.0          0.0.0.0     192.168.1.254    192.168.1.20     35
          0.0.0.0          0.0.0.0         10.2.0.1        10.2.0.2      2
        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331
===========================================================================
Itinéraires persistants :
  Adresse réseau    Masque réseau  Adresse passerelle Métrique
          0.0.0.0          0.0.0.0     192.168.1.254  Par défaut`;
  assert.equal(parseWinRoute(route, '192.168.1.20'), '192.168.1.254');
  assert.equal(parseWinRoute(route, '192.168.1.99'), null);
  const arp = `
Interface : 192.168.1.20 --- 0xb
  Adresse Internet      Adresse physique      Type
  192.168.1.254         a4-3e-51-0b-c2-7f     dynamique
  192.168.1.255         ff-ff-ff-ff-ff-ff     statique`;
  assert.equal(parseArp(arp, '192.168.1.254'), 'a4:3e:51:0b:c2:7f');
  assert.equal(parseArp(arp, '192.168.1.255'), null, 'adresse de diffusion ignorée');
  assert.equal(parseArp(arp, '192.168.1.25'), null, 'pas de confusion avec 192.168.1.254');
});

test('box de la maison sous macOS : arp -n (zéros de tête omis)', () => {
  assert.equal(parseArp('? (192.168.1.1) at a4:3e:51:b:c2:7f on en0 ifscope [ethernet]', '192.168.1.1'), 'a4:3e:51:0b:c2:7f');
  assert.equal(parseArp('? (192.168.1.1) -- no entry', '192.168.1.1'), null);
});

test('choix du dossier : fenêtre native de chaque système', async () => {
  assert.equal(pickerCommands('darwin')[0][0], 'osascript');
  const [cmd, args] = pickerCommands('win32')[0];
  assert.equal(cmd, 'powershell.exe');
  assert.ok(args.includes('-STA'), 'les fenêtres Windows exigent ce mode');
  const ps = decodePs(args);
  assert.match(ps, /FolderBrowserDialog/);
  assert.match(ps, /Choisissez le dossier qui contient votre musique/, 'accents intacts');
  assert.match(ps, /OutputEncoding.*UTF8/, 'chemins accentués lus correctement');
  assert.deepEqual(pickerCommands('linux').map((c) => c[0]), ['zenity', 'kdialog']);

  const fake = (answers) => { const calls = []; return { calls, run: async (c) => { calls.push(c); return answers[c] || { missing: true }; } }; };
  let f = fake({ kdialog: { out: '/home/moi/Musique\n' } });
  assert.deepEqual(await pickFolder({ platform: 'linux', run: f.run }), { path: '/home/moi/Musique' }, 'KDE sans zenity');
  assert.deepEqual(f.calls, ['zenity', 'kdialog']);
  f = fake({ zenity: { failed: true } });
  assert.deepEqual(await pickFolder({ platform: 'linux', run: f.run }), { cancelled: true }, 'annulé : on ne propose pas l’autre fenêtre');
  assert.deepEqual(await pickFolder({ platform: 'linux', run: fake({}).run }), { unavailable: true }, 'aucune fenêtre : saisir le chemin');
  assert.deepEqual(await pickFolder({ platform: 'win32', run: fake({ 'powershell.exe': { out: 'D:\\Musique\\\r\n' } }).run }), { path: 'D:\\Musique' });
  assert.deepEqual(await pickFolder({ platform: 'win32', run: fake({ 'powershell.exe': { out: 'E:\\\r\n' } }).run }), { path: 'E:' }, 'racine d’un disque');
  assert.deepEqual(await pickFolder({ platform: 'win32', run: fake({ 'powershell.exe': { out: '' } }).run }), { cancelled: true });
  assert.deepEqual(await pickFolder({ platform: 'darwin', run: fake({ osascript: { out: '/Volumes/FLAC/\n' } }).run }), { path: '/Volumes/FLAC' });
});

test('disques externes et clés USB : là où chaque système les monte', () => {
  const tree = { '/Volumes': ['Macintosh HD', 'FLAC'], '/media': ['moi', 'CLE'], '/media/moi': ['FLAC'], '/run/media/moi': ['Disque'], '/mnt': [] };
  const list = (d) => tree[d] || [];
  assert.deepEqual(volumeDirs({ platform: 'darwin', list, real: (p) => (p.endsWith('Macintosh HD') ? '/' : p) }), ['/Volumes/FLAC'], 'pas le disque du Mac');
  assert.deepEqual(volumeDirs({ platform: 'linux', user: 'moi', list }), ['/media/moi/FLAC', '/run/media/moi/Disque', '/media/CLE']);
  const drives = new Set(['C:\\', 'D:\\', 'F:\\']);
  const old = process.env.SystemDrive; process.env.SystemDrive = 'C:';
  try { assert.deepEqual(volumeDirs({ platform: 'win32', exists: (p) => drives.has(p) }), ['D:\\', 'F:\\'], 'lettres de lecteurs, sauf celui de Windows'); }
  finally { if (old === undefined) delete process.env.SystemDrive; else process.env.SystemDrive = old; }
});

test('rester éveillé pendant le pilotage : une commande par système, arrêtée si le serveur disparaît', () => {
  assert.deepEqual(awakeCommand('darwin', 3600, 42), ['caffeinate', ['-i', '-t', '3600', '-w', '42']]);
  const [lc, la] = awakeCommand('linux', 3600, 42);
  assert.equal(lc, 'systemd-inhibit');
  assert.ok(la.includes('--what=idle:sleep'));
  assert.match(la.at(-1), /kill -0 42/);
  assert.match(la.at(-1), /-lt 3600/);
  const [wc, wa] = awakeCommand('win32', 3600, 42);
  assert.equal(wc, 'powershell.exe');
  const ps = decodePs(wa);
  assert.match(ps, /SetThreadExecutionState\(\[uint32\]2147483649\)/, 'ES_CONTINUOUS | ES_SYSTEM_REQUIRED');
  assert.match(ps, /AddSeconds\(3600\)/);
  assert.match(ps, /Get-Process -Id 42/);
});

test('ouvrir App Music dans le navigateur par défaut', () => {
  const url = 'http://localhost:4321/#/album/abc?x=1&y=2';
  assert.deepEqual(openCommand('darwin', url), ['open', [url]]);
  assert.deepEqual(openCommand('linux', url), ['xdg-open', [url]]);
  assert.deepEqual(openCommand('win32', url), ['rundll32', ['url.dll,FileProtocolHandler', url]], 'sans cmd.exe : le & de l’adresse reste intact');
});
