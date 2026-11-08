// Raccourcis « App Music » à double-cliquer, qui lancent l'app (scripts/launch.mjs) :
//   macOS    ~/Applications/App Music.app et sa copie sur le bureau (scripts/make-app.sh)
//   Linux    menu des applications (~/.local/share/applications) et bureau
//   Windows  menu Démarrer et bureau
// Créés une seule fois au premier lancement (server.js) ; npm run make-app pour les refaire.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Fichier .desktop (norme freedesktop) : chaque argument de Exec entre guillemets, avec \ " ` $ échappés
const quoteExec = (s) => `"${s.replace(/[\\"`$]/g, (c) => '\\' + c)}"`;
export function desktopEntry(root = ROOT) {
  return `[Desktop Entry]
Type=Application
Name=App Music
Comment=Votre musique, sur cet ordinateur
Exec=sh ${quoteExec(path.posix.join(root, 'scripts', 'launch.sh'))}
Icon=${path.posix.join(root, 'assets', 'AppIcon.png')}
Terminal=false
Categories=AudioVideo;Audio;Player;
StartupNotify=false
`;
}

// Windows : raccourcis .lnk créés par PowerShell (objet WScript.Shell), fenêtre de Node réduite le temps du lancement
const psq = (s) => `'${s.replace(/'/g, "''")}'`;
export function windowsShortcutScript(root = ROOT, node = process.execPath) {
  return `$sh = New-Object -ComObject WScript.Shell
foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
  if (-not $dir) { continue }
  $l = $sh.CreateShortcut((Join-Path $dir 'App Music.lnk'))
  $l.TargetPath = ${psq(node)}
  $l.Arguments = ${psq(`"${path.win32.join(root, 'scripts', 'launch.mjs')}"`)}
  $l.WorkingDirectory = ${psq(root)}
  $l.IconLocation = ${psq(path.win32.join(root, 'assets', 'AppIcon.ico') + ',0')}
  $l.Description = 'App Music'
  $l.WindowStyle = 7
  $l.Save()
  Write-Output "✓ $($l.FullName)"
}`;
}

async function linuxDesktopDir() {
  try { const { stdout } = await exec('xdg-user-dir', ['DESKTOP']); const d = stdout.trim(); if (d && d !== os.homedir() && fs.existsSync(d)) return d; } catch {}
  for (const d of ['Desktop', 'Bureau']) if (fs.existsSync(path.join(os.homedir(), d))) return path.join(os.homedir(), d);
  return null;
}

export async function makeShortcut(platform = process.platform) {
  if (platform === 'darwin') return (await exec('zsh', [path.join(ROOT, 'scripts', 'make-app.sh')])).stdout.trim();
  if (platform === 'win32') {
    const ps = `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n` + windowsShortcutScript();
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { windowsHide: true });
    return stdout.trim();
  }
  const out = [];
  const apps = path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'applications');
  fs.mkdirSync(apps, { recursive: true });
  const entry = desktopEntry();
  const menu = path.join(apps, 'app-music.desktop');
  fs.writeFileSync(menu, entry, { mode: 0o755 });
  out.push(`✓ ${menu}`);
  const desk = await linuxDesktopDir();
  if (desk) {
    const f = path.join(desk, 'app-music.desktop');
    fs.writeFileSync(f, entry, { mode: 0o755 });
    // GNOME : icône du bureau marquée « de confiance », sinon elle s'ouvre comme un fichier texte
    await exec('gio', ['set', f, 'metadata::trusted', 'true']).catch(() => {});
    out.push(`✓ ${f}`);
  }
  return out.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  makeShortcut().then((s) => console.log(s), (e) => { console.error('Raccourci non créé :', e.message); process.exit(1); });
}
