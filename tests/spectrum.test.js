// Qualité réelle des MP3 (lib/spectrum.js) : de vrais MP3 encodés pour l'occasion (lamejs), à partir de bruit filtré :
// vrai 320, faux 320 (source coupée à 16 kHz, comme un MP3 128 kb/s réencodé), 320 « gonflé » (source à 19 kHz),
// vrais 128 et 192. Puis le serveur (analyse en arrière-plan, liste, fichier CSV) et la page « Albums en MP3 ».
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Mp3Encoder } from '@breezystack/lamejs';
import { chromium } from 'playwright-core';
import { cutoff, verdict, albumVerdict, analyseInBackground, findFrame } from '../lib/spectrum.js';
import { startServer, sleep, findBrowser } from './helpers.js';

const R = 44100;
// bruit blanc filtré par un passe-bas (réponse impulsionnelle finie, fenêtre de Blackman : ≈ -74 dB au-delà de la coupure)
function noise(maxHz, seconds = 8, seed = 7) {
  const S = Math.round(R * seconds);
  let x = seed; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5);
  const T = 255, h = new Float64Array(T), fc = Math.min(maxHz, R / 2 - 1) / R;
  for (let n = 0; n < T; n++) {
    const m = n - (T - 1) / 2;
    h[n] = (m ? Math.sin(2 * Math.PI * fc * m) / (Math.PI * m) : 2 * fc) * (0.42 - 0.5 * Math.cos((2 * Math.PI * n) / (T - 1)) + 0.08 * Math.cos((4 * Math.PI * n) / (T - 1)));
  }
  const w = Float64Array.from({ length: S + T }, rnd), out = new Float32Array(S);
  let peak = 0;
  for (let i = 0; i < S; i++) { let a = 0; for (let n = 0; n < T; n++) a += w[i + n] * h[n]; out[i] = a; peak = Math.max(peak, Math.abs(a)); }
  return out.map((v) => (v / peak) * 0.7);
}
function mp3(signal, kbps) {
  const enc = new Mp3Encoder(2, R, kbps), pcm = Int16Array.from(signal, (v) => v * 32767), parts = [];
  for (let i = 0; i < pcm.length; i += 1152 * 20) { const c = pcm.subarray(i, i + 1152 * 20); parts.push(enc.encodeBuffer(c, c)); }
  parts.push(enc.flush());
  return Buffer.concat(parts.map((p) => Buffer.from(p)));
}
// étiquette ID3 avec une fausse pochette devant le son, comme dans les vrais fichiers
const withId3 = (audio) => {
  const size = 5000, tag = Buffer.alloc(10 + size); // en-tête ID3v2.3, puis du remplissage (taille en octets « synchsafe »)
  tag.write('ID3', 0); tag[3] = 3; tag[8] = size >> 7; tag[9] = size & 0x7f;
  for (let i = 10; i < 10 + size; i += 7) tag[i] = 0xff; // des octets 0xFF : de faux débuts de trame à ignorer
  tag.fill(0, 10, 20); // premier cadre vide : le lecteur d'étiquettes s'arrête là
  return Buffer.concat([tag, audio]);
};

const full = noise(21500), cut16 = noise(16000, 8, 11), cut19 = noise(19000, 8, 13);
const FILES = {
  vrai320: [full, 320], faux320: [cut16, 320], gonfle320: [cut19, 320], vrai128: [full, 128], vrai192: [full, 192],
};
let tmp;
before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-spectre-'));
  for (const [name, [sig, kbps]] of Object.entries(FILES)) fs.writeFileSync(path.join(tmp, name + '.mp3'), withId3(mp3(sig, kbps)));
});
after(() => fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 }));

test('spectre : coupure mesurée sur un signal non compressé', () => {
  assert.ok(Math.abs(cutoff(cut16, R).cut - 16000) <= 250, 'coupure à 16 kHz retrouvée');
  assert.ok(Math.abs(cutoff(cut19, R).cut - 19000) <= 250, 'coupure à 19 kHz retrouvée');
  assert.equal(cutoff(new Float32Array(R * 4), R), null, 'silence : rien à juger');
});

test('verdict selon le débit affiché', () => {
  assert.equal(verdict(320, { cut: 20000, drop: 30 }), 'ok');
  assert.equal(verdict(320, { cut: 19000, drop: 30 }), 'gonfle');
  assert.equal(verdict(320, { cut: 16000, drop: 30 }), 'faux');
  assert.equal(verdict(128, { cut: 16000, drop: 30 }), 'ok', 'un vrai 128 coupe là');
  assert.equal(verdict(320, { cut: 16000, drop: 4 }), 'ok', 'pas de chute franche : spectre complet');
  assert.equal(verdict(320, null), null);
  const a = albumVerdict([{ verdict: 'faux', cut: 16000, drop: 40 }, { verdict: 'faux', cut: 15750, drop: 40 }, { verdict: 'ok', cut: 20000, drop: 20 }, null]);
  assert.deepEqual(a, { verdict: 'faux', counts: { ok: 1, gonfle: 0, faux: 2 }, analysed: 3, source: 128 });
  assert.equal(albumVerdict([null, { error: 'x' }]), null);
});

test('début de trame MP3 retrouvé au milieu du fichier (l’étiquette ID3 et la pochette sont ignorées)', () => {
  const buf = fs.readFileSync(path.join(tmp, 'vrai320.mp3'));
  const i = findFrame(buf, Math.floor(buf.length * 0.3));
  assert.ok(i > 0 && buf[i] === 0xff && (buf[i + 1] & 0xe0) === 0xe0);
  assert.equal(findFrame(Buffer.alloc(5000, 0x41), 0), -1);
});

test('vrais MP3 : vrai 320, faux 320, 320 gonflé, vrais 128 et 192 (fil séparé)', async () => {
  const jobs = Object.entries(FILES).map(([name, [, kbps]]) => ({ id: name, file: path.join(tmp, name + '.mp3'), kbps }));
  jobs.push({ id: 'abime', file: path.join(tmp, 'abime.mp3'), kbps: 320 });
  fs.writeFileSync(path.join(tmp, 'abime.mp3'), Buffer.alloc(20000, 0x41));
  const res = {};
  await analyseInBackground(jobs, (id, r) => (res[id] = r));
  assert.equal(res.vrai320.verdict, 'ok', JSON.stringify(res.vrai320));
  assert.equal(res.faux320.verdict, 'faux', JSON.stringify(res.faux320));
  assert.ok(Math.abs(res.faux320.cut - 16000) <= 500);
  assert.equal(res.gonfle320.verdict, 'gonfle', JSON.stringify(res.gonfle320));
  assert.equal(res.vrai128.verdict, 'ok', JSON.stringify(res.vrai128));
  assert.equal(res.vrai192.verdict, 'ok', JSON.stringify(res.vrai192));
  assert.ok(res.abime.error, 'fichier illisible : erreur, pas de plantage');
});

test('App Music : analyse après l’indexation, verdict par album, CSV, page « Albums en MP3 »', async () => {
  const music = path.join(tmp, 'music');
  const album = (dir, name, n) => { fs.mkdirSync(path.join(music, dir), { recursive: true }); for (let i = 1; i <= 2; i++) fs.copyFileSync(path.join(tmp, name + '.mp3'), path.join(music, dir, `0${i} Titre ${i} ${n}.mp3`)); };
  album('Bruit Rose - Vrai Album (2020)', 'vrai320', 'a');
  album('Bruit Rose - Faux Album (2021)', 'faux320', 'b');
  const srv = await startServer({ music });
  let browser;
  try {
    let data;
    for (let i = 0; i < 100; i++) { data = (await srv.api('/api/lossy')).body; if (!data.analysis.running && data.albums.every((a) => a.quality)) break; await sleep(100); }
    const lib = (await srv.api('/api/library')).body;
    const q = (title) => data.albums.find((a) => a.id === lib.albums.find((x) => x.title === title).id).quality;
    assert.equal(q('Vrai Album').verdict, 'ok');
    assert.deepEqual([q('Faux Album').verdict, q('Faux Album').kbps, q('Faux Album').source, q('Faux Album').analysed], ['faux', 320, 128, 2]);
    const cache = JSON.parse(fs.readFileSync(path.join(srv.cache, 'quality.json'), 'utf8'));
    assert.equal(Object.keys(cache).length, 4, 'résultats gardés dans le cache');
    const csv = (await srv.api('/api/lossy.csv')).body.toString('utf8');
    assert.match(csv, /;Qualité réelle;/);
    assert.match(csv, /Faux Album;\d*;Titre 1 b;MP3;320;faux \(coupure à 16 kHz\);/);
    assert.match(csv, /Vrai Album;\d*;Titre 1 a;MP3;320;conforme;/);

    // fichiers inchangés : rien n'est réanalysé ; un fichier remplacé l'est
    const before = fs.statSync(path.join(srv.cache, 'quality.json')).mtimeMs;
    await srv.api('/api/rescan', { method: 'POST' }); await sleep(300); await srv.waitIndexed(); await sleep(2000);
    assert.equal(fs.statSync(path.join(srv.cache, 'quality.json')).mtimeMs, before, 'pas de nouvelle analyse');

    const executablePath = findBrowser();
    if (!executablePath) return; // pas de navigateur : la partie interface est couverte ailleurs
    browser = await chromium.launch({ executablePath, headless: true });
    const page = await browser.newPage();
    await page.goto(srv.url + '/#/mp3');
    await page.waitForSelector('.lossy-quality');
    const cards = await page.$$eval('.lossy-page .card', (cs) => cs.map((c) => [c.querySelector('.card-title').textContent, c.querySelector('.lossy-quality')?.textContent]));
    assert.deepEqual(cards, [['Faux Album', 'Faux 320 kb/s : source ≈ 128 kb/s'], ['Vrai Album', 'Qualité conforme à 320 kb/s']], 'à remplacer en premier');
    assert.match(await page.textContent('#lossy-quality-sum'), /Qualité réelle : 1 faux, 1 conforme\./);
  } finally { await browser?.close(); await srv.stop(); }
});
