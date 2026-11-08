// Outil ponctuel (pas utilisé par l'app) : copie un dossier de FLAC haute résolution en FLAC 16 bits « qualité CD ».
//
//   node scripts/flac-16bit.mjs "<dossier source>" ["<dossier de destination>"]
//
// - les originaux ne sont jamais modifiés : tout est écrit dans la destination (par défaut « <source> [16 bits] », à côté) ;
// - 24 bits -> 16 bits avec dither (bruit de quantification mis en forme, inaudible) ;
// - 88,2 / 176,4 kHz -> 44,1 kHz ; 96 / 192 kHz -> 48 kHz (rééchantillonnage sox de très haute qualité) ;
// - fichiers déjà en 16 bits ≤ 48 kHz, images, .cue, .log… : recopiés tels quels ;
// - étiquettes et pochettes intégrées recopiées à l'identique ; chaque fichier produit est vérifié (décodage complet, durée).
// Nécessite sox et flac (metaflac) : brew install sox flac · apt install sox flac · winget install sox / flac.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const [srcArg, destArg] = process.argv.slice(2);
if (!srcArg) { console.log('Usage : node scripts/flac-16bit.mjs "<dossier source>" ["<dossier de destination>"]'); process.exit(1); }
const SRC = path.resolve(srcArg);
const DEST = path.resolve(destArg || `${SRC} [16 bits]`);
if (!fs.statSync(SRC, { throwIfNoEntry: false })?.isDirectory()) { console.error('Dossier introuvable :', SRC); process.exit(1); }
if (DEST === SRC || DEST.startsWith(SRC + path.sep)) { console.error('La destination doit être en dehors du dossier source.'); process.exit(1); }
for (const tool of ['sox', 'metaflac', 'flac']) {
  try { await exec(tool, ['--version']); } catch { console.error(`${tool} est introuvable (brew install sox flac).`); process.exit(1); }
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else files.push(p);
  }
})(SRC);

const info = async (f) => {
  const { stdout } = await exec('metaflac', ['--show-bps', '--show-sample-rate', '--show-total-samples', f]);
  const [bps, rate, samples] = stdout.trim().split(/\s+/).map(Number);
  return { bps, rate, samples };
};
const targetRate = (r) => (r <= 48000 ? r : r % 44100 === 0 ? 44100 : 48000);
// recopie les étiquettes (VORBIS_COMMENT) et les images (PICTURE) de src vers dst, telles quelles
function copyMeta(src, dst) {
  return new Promise((resolve, reject) => {
    const list = spawn('metaflac', ['--list', '--data-format=binary', '--block-type=VORBIS_COMMENT,PICTURE', src]);
    const add = spawn('metaflac', ['--append', dst]);
    list.stdout.pipe(add.stdin);
    let err = '';
    for (const p of [list, add]) p.stderr.on('data', (d) => (err += d));
    add.on('close', (code) => (code ? reject(new Error(err.trim() || 'metaflac --append')) : resolve()));
    list.on('error', reject); add.on('error', reject);
  });
}

let converted = 0, copied = 0, before = 0, after = 0;
const failures = [];
async function handle(f) {
  const rel = path.relative(SRC, f), out = path.join(DEST, rel);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const size = fs.statSync(f).size;
  before += size;
  if (path.extname(f).toLowerCase() !== '.flac') { fs.copyFileSync(f, out); after += size; copied++; return; }
  const a = await info(f);
  if (a.bps <= 16 && a.rate <= 48000) { fs.copyFileSync(f, out); after += size; copied++; return; }
  const rate = targetRate(a.rate), tmp = out + '.part.flac';
  try {
    // -G : marge automatique contre l'écrêtage du rééchantillonnage ; dither -s : dither mis en forme (Shibata)
    const effects = rate !== a.rate ? ['rate', '-v', '-L', String(rate)] : [];
    await exec('sox', ['-G', f, '-b', '16', '-C', '8', tmp, ...effects, 'dither', '-s']);
    await exec('metaflac', ['--remove', '--block-type=VORBIS_COMMENT,PICTURE', tmp]); // ce que sox a pu écrire
    await copyMeta(f, tmp);
    await exec('flac', ['-t', '-s', tmp]); // décodage complet : fichier intact
    const b = await info(tmp);
    const drift = Math.abs(b.samples / b.rate - a.samples / a.rate);
    if (b.bps !== 16 || b.rate !== rate || drift > 0.05) throw new Error(`vérification : ${b.bps} bits, ${b.rate} Hz, écart ${drift.toFixed(3)} s`);
    fs.renameSync(tmp, out);
    after += fs.statSync(out).size; converted++;
    console.log(`✓ ${rel}  (${a.bps} bits ${a.rate / 1000} kHz -> 16 bits ${rate / 1000} kHz)`);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    failures.push(`${rel} : ${e.message}`);
    console.log(`✗ ${rel} : ${e.message}`);
  }
}

console.log(`${files.length} fichier(s) : ${SRC}\n -> ${DEST}\n`);
const queue = [...files];
await Promise.all(Array.from({ length: Math.max(1, Math.min(4, os.cpus().length - 1)) }, async () => { while (queue.length) await handle(queue.shift()); }));
const mo = (n) => (n / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 0 }) + ' Mo';
console.log(`\n${converted} converti(s), ${copied} recopié(s) tel(s) quel(s), ${failures.length} échec(s)`);
console.log(`Taille : ${mo(before)} -> ${mo(after)}${before ? ` (${Math.round((1 - after / before) * 100)} % de moins)` : ''}`);
if (failures.length) { console.log(failures.map((x) => '  ' + x).join('\n')); process.exit(1); }
