// Qualité réelle des MP3 : repère les « faux 320 » (un MP3 de moindre qualité réencodé à un débit plus élevé).
// Un encodeur MP3 coupe les aigus selon son débit (≈16 kHz à 128 kb/s, ≈19 kHz à 192, ≈20 kHz et plus à 320) ;
// un fichier réencodé garde la coupure de sa source, quel que soit le débit affiché.
// Les fichiers ne sont que lus. Décodage par mpg123 compilé en WebAssembly : identique sur macOS, Linux et Windows.
import fs from 'node:fs';
import { Worker } from 'node:worker_threads';

const N = 4096; // taille de la FFT (≈10,8 Hz par case à 44,1 kHz)
const HANN = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));

function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < half; k++) {
        const a = i + k, b = a + half;
        const vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// Spectre moyen d'un signal (mono) puis fréquence de coupure : la plus forte chute entre deux tranches de 250 Hz
// voisines au-dessus de 14 kHz (niveaux relatifs à la tranche 10–14 kHz).
// { cut: Hz, drop: dB } ; null si le signal est trop faible pour juger (silence, morceau sans aigus).
export function cutoff(samples, sampleRate) {
  const power = new Float64Array(N / 2), re = new Float64Array(N), im = new Float64Array(N);
  let frames = 0;
  for (let s = 0; s + N <= samples.length; s += N) {
    for (let i = 0; i < N; i++) { re[i] = samples[s + i] * HANN[i]; im[i] = 0; }
    fft(re, im);
    for (let k = 0; k < N / 2; k++) power[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (frames < 20) return null;
  const hz = sampleRate / N;
  const band = (f1, f2) => {
    let s = 0, c = 0;
    for (let k = Math.ceil(f1 / hz); k <= Math.floor(f2 / hz) && k < N / 2; k++) { s += power[k]; c++; }
    return 10 * Math.log10(s / c / frames + 1e-30);
  };
  const ref = band(10000, 14000);
  if (ref < band(200, 4000) - 70 || ref < -100) return null; // pas assez d'aigus pour mesurer quoi que ce soit
  const steps = [];
  for (let f = 12000; f + 250 <= Math.min(21500, sampleRate / 2); f += 250) steps.push({ f, db: band(f, f + 250) - ref });
  // coupure = la plus basse chute nette (≥ 8 dB en 500 Hz) suivie d'un palier qui reste bas jusqu'à 19,5 kHz.
  // Un faux 320 en a deux : celle de sa vraie source (≈16 kHz) et celle du réencodage (≈20 kHz) ; c'est la première qui compte.
  const at = (i) => steps[i]?.db ?? -200;
  const top = Math.max(...steps.map((x, i) => (x.f <= 19500 ? i : 0)));
  let cut = null, drop = 0, best = null, bestDrop = 0;
  for (let i = 2; i < steps.length - 1; i++) {
    if (steps[i].f < 14000) continue;
    const before = (at(i - 1) + at(i - 2)) / 2, sharp = before - (at(i) + at(i + 1)) / 2;
    if (sharp > bestDrop) { bestDrop = sharp; best = steps[i].f; }
    const rest = steps.slice(i, Math.max(i + 2, top + 1)).map((x) => x.db);
    const shelf = before - rest.reduce((a, c) => a + c, 0) / rest.length;
    if (cut === null && sharp >= 8 && shelf >= 12) { cut = steps[i].f; drop = shelf; }
  }
  if (cut === null) { cut = best; drop = bestDrop; } // pas de palier : la chute la plus nette (coupure de l'encodeur, souvent ≥ 20 kHz)
  return { cut, drop: Math.round(drop) };
}

// Coupure attendue d'un encodeur honnête, selon le débit affiché
// (marges larges sous 256 kb/s : selon l'encodeur, un vrai 128 coupe entre 15 et 17 kHz, un vrai 192 entre 17,5 et 19 kHz)
const expected = (kbps) => (kbps >= 256 ? 19750 : kbps >= 192 ? 17750 : kbps >= 160 ? 16250 : kbps >= 128 ? 14750 : 0);
// Débit de la vraie source, d'après la coupure mesurée
export const sourceOf = (cut) => (cut >= 19750 ? 320 : cut >= 18500 ? 192 : cut >= 17000 ? 160 : cut >= 15500 ? 128 : 96);

// 'ok' : conforme au débit affiché ; 'gonfle' : source un peu moins bonne (≈192 pour un 320) ; 'faux' : source ≤ 160 kb/s
export function verdict(kbps, m) {
  if (!m) return null;
  if (m.drop < 10 || m.cut >= expected(kbps) - 250) return 'ok'; // pas de coupure franche : spectre complet
  return m.cut >= 17500 ? 'gonfle' : 'faux';
}

// Verdict d'un album d'après ceux de ses titres
export function albumVerdict(results) {
  const r = results.filter((x) => x?.verdict);
  if (!r.length) return null;
  const n = (v) => r.filter((x) => x.verdict === v).length;
  const counts = { ok: n('ok'), gonfle: n('gonfle'), faux: n('faux') };
  const verdict = counts.faux * 2 >= r.length ? 'faux' : (counts.faux + counts.gonfle) * 2 >= r.length ? 'gonfle' : 'ok';
  // source estimée d'après les titres qui portent le verdict de l'album (un album mélangé garde son « pire » côté)
  const cuts = r.filter((x) => x.verdict === verdict && x.cut && x.drop >= 10).map((x) => x.cut).sort((a, b) => a - b);
  const median = cuts.length ? cuts[Math.floor(cuts.length / 2)] : null;
  return { verdict, counts, analysed: r.length, source: median ? sourceOf(median) : null };
}

// Analyse d'un fichier MP3 : le milieu du morceau (de 30 à 70 %, au plus ≈3 Mo), ni intro silencieuse ni fondu de fin.
// Pas depuis le début : l'étiquette ID3 (souvent avec la pochette) précède le son.
// Début d'une trame MP3 à partir de `from` : en-tête valide, et la trame suivante commence bien là où il l'annonce
// (le décodeur ne retrouve pas toujours seul le fil s'il démarre au milieu d'une trame).
const KBPS = { 1: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320], 2: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160] };
const RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };
function frameAt(buf, i) {
  if (i + 4 > buf.length || buf[i] !== 0xff || (buf[i + 1] & 0xe0) !== 0xe0) return 0;
  const ver = (buf[i + 1] >> 3) & 3, layer = (buf[i + 1] >> 1) & 3, br = buf[i + 2] >> 4, sr = (buf[i + 2] >> 2) & 3, pad = (buf[i + 2] >> 1) & 1;
  if (ver === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) return 0; // Layer III seulement
  const kbps = KBPS[ver === 3 ? 1 : 2][br], rate = RATES[ver][sr];
  return Math.floor(((ver === 3 ? 144 : 72) * kbps * 1000) / rate) + pad;
}
export function findFrame(buf, from) {
  for (let i = from; i < buf.length - 4; i++) {
    const len = frameAt(buf, i);
    if (len && frameAt(buf, i + len) && frameAt(buf, i + len + frameAt(buf, i + len))) return i;
  }
  return -1;
}

// decoder : un MPEGDecoder neuf et prêt (sa méthode reset() boucle sans fin : un décodeur par fichier).
export async function analyseMp3(file, decoder) {
  const buf = fs.readFileSync(file);
  const start = findFrame(buf, Math.floor(buf.length * 0.3));
  if (start < 0) throw new Error('aucune trame MP3 trouvée');
  const end = Math.min(Math.floor(buf.length * 0.7), start + 3e6);
  const parts = []; let rate = 0, errors = 0, total = 0;
  for (let o = start; o < end; o += 16384) {
    const d = decoder.decode(new Uint8Array(buf.subarray(o, Math.min(o + 16384, end))));
    errors += d.errors?.length || 0;
    if (errors > 50) throw new Error('fichier MP3 illisible');
    if (!d.samplesDecoded) continue;
    rate = d.sampleRate;
    const L = d.channelData[0], R = d.channelData[1] || L, mono = new Float32Array(L.length);
    for (let i = 0; i < L.length; i++) mono[i] = (L[i] + R[i]) / 2;
    parts.push(mono); total += mono.length;
  }
  const samples = new Float32Array(total);
  let i = 0; for (const p of parts) { samples.set(p, i); i += p.length; }
  return { rate, ...(cutoff(samples, rate) || { cut: null, drop: null, silent: true }) };
}

// Analyse une liste de titres dans un fil séparé (le serveur continue de servir la musique pendant ce temps).
// jobs : [{ id, file, kbps }] ; onResult(id, { cut, drop, verdict } | { error }) ; renvoie une promesse terminée à la fin.
export function analyseInBackground(jobs, onResult) {
  return new Promise((resolve) => {
    if (!jobs.length) return resolve();
    const w = new Worker(new URL('./spectrum-worker.js', import.meta.url), { workerData: jobs });
    w.on('message', ({ id, result }) => onResult(id, result));
    w.on('error', (e) => { console.warn('Analyse des MP3 :', e.message); resolve(); });
    w.on('exit', () => resolve());
  });
}
