// Captures d'écran du README (npm run screenshots) : bibliothèque de démonstration générée,
// instance isolée hors ligne, navigateur sans fenêtre. Résultat dans docs/screenshots/.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-core';
import { flac } from '../tests/fixtures.js';
import { startServer, findBrowser, sleep, ROOT } from '../tests/helpers.js';
import { ARTISTS, ALBUMS } from './demo-library.js';

const OUT = path.join(ROOT, 'docs', 'screenshots');
const executablePath = findBrowser();
if (!executablePath) { console.error('Aucun navigateur Chromium trouvé (APPMUSIC_BROWSER=…)'); process.exit(1); }

// ---------- Dessins (pochettes et photos d'artistes) ----------
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
function art(style, [a, b, dark], artist, title, w = 1000, h = 1000) {
  const font = `-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  const caption = `<div style="position:absolute;left:7%;bottom:7%;right:7%;color:#fff;font:600 ${w * 0.034}px/1.25 ${font};letter-spacing:.02em;text-shadow:0 2px 12px rgba(0,0,0,.35)">
    <div style="opacity:.75;font-weight:500;text-transform:uppercase;letter-spacing:.18em;font-size:${w * 0.026}px">${esc(artist)}</div><div style="font-size:${w * 0.05}px;margin-top:.2em">${esc(title)}</div></div>`;
  const grain = `<div style="position:absolute;inset:0;opacity:.18;mix-blend-mode:overlay;background-image:url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22200%22 height=%22200%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%22.9%22 numOctaves=%222%22/></filter><rect width=%22200%22 height=%22200%22 filter=%22url(%23n)%22/></svg>')"></div>`;
  const S = {
    sunset: `background:linear-gradient(180deg,${dark} 0%,${b} 55%,${a} 100%)">
      <div style="position:absolute;left:50%;top:44%;width:52%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:linear-gradient(180deg,#ffe29a,${a});
        -webkit-mask:repeating-linear-gradient(180deg,#000 0 7%,transparent 7% 8.5%);box-shadow:0 0 120px ${a}"></div>
      <div style="position:absolute;left:-20%;right:-20%;bottom:0;height:34%;background:repeating-linear-gradient(90deg,rgba(255,255,255,.35) 0 2px,transparent 2px 8%),repeating-linear-gradient(180deg,rgba(255,255,255,.35) 0 2px,transparent 2px 18%);transform:perspective(300px) rotateX(60deg);transform-origin:bottom"></div>`,
    neon: `background:radial-gradient(circle at 50% 40%,${b}55,${dark} 70%)">
      <div style="position:absolute;inset:0;display:grid;place-items:center;font:800 ${w * 0.2}px/0.9 ${font};color:transparent;-webkit-text-stroke:3px ${a};text-shadow:0 0 18px ${a},0 0 60px ${a};text-align:center;letter-spacing:-.02em">MINUIT<br>ÉLEC</div>`,
    waves: `background:linear-gradient(160deg,${a},${b} 60%,${dark})">
      ${[0, 1, 2, 3, 4].map((i) => `<div style="position:absolute;left:-30%;width:160%;height:60%;top:${30 + i * 12}%;border-radius:50%;border-top:${w * 0.012}px solid rgba(255,255,255,${0.5 - i * 0.08})"></div>`).join('')}`,
    waves2: `background:linear-gradient(180deg,${a},${b} 50%,${dark})">
      ${[0, 1, 2, 3, 4, 5].map((i) => `<div style="position:absolute;left:-10%;right:-10%;top:${48 + i * 8}%;height:16%;background:radial-gradient(ellipse at 50% 0,rgba(255,255,255,${0.35 - i * 0.05}),transparent 70%)"></div>`).join('')}
      <div style="position:absolute;left:50%;top:22%;width:14%;aspect-ratio:1;border-radius:50%;background:#fff;opacity:.9;transform:translateX(-50%)"></div>`,
    blobs: `background:${dark}">
      <div style="position:absolute;inset:-10%;filter:blur(${w * 0.07}px)">
        <div style="position:absolute;left:5%;top:10%;width:60%;height:60%;border-radius:50%;background:${a}"></div>
        <div style="position:absolute;right:0;top:35%;width:55%;height:55%;border-radius:50%;background:${b}"></div>
        <div style="position:absolute;left:25%;bottom:0;width:40%;height:40%;border-radius:50%;background:#ffb3c1"></div></div>`,
    sun: `background:linear-gradient(180deg,${a},${b})">
      <div style="position:absolute;left:50%;top:38%;width:46%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:#fff6e0;box-shadow:0 0 0 ${w * 0.04}px rgba(255,255,255,.18),0 0 0 ${w * 0.09}px rgba(255,255,255,.1)"></div>
      <div style="position:absolute;left:0;right:0;bottom:0;height:38%;background:${dark};clip-path:polygon(0 30%,20% 10%,45% 35%,70% 5%,100% 25%,100% 100%,0 100%)"></div>`,
    chrome: `background:radial-gradient(circle at 50% 120%,${a},${dark} 65%)">
      <div style="position:absolute;inset:0;display:grid;place-items:center;font:900 italic ${w * 0.16}px/0.9 ${font};text-align:center;letter-spacing:-.03em;
        background:linear-gradient(180deg,#fff 0%,#9aa4b1 45%,#2b2f36 50%,#e6ebf0 60%,#fff 100%);-webkit-background-clip:text;color:transparent;filter:drop-shadow(0 6px 0 ${b})">HIGHWAY<br>THUNDER</div>`,
    stripes: `background:repeating-linear-gradient(-45deg,${a} 0 6%,${dark} 6% 12%,${b} 12% 18%,${dark} 18% 24%)">
      <div style="position:absolute;inset:18%;background:${dark};display:grid;place-items:center;font:900 ${w * 0.11}px/1 ${font};color:#fff;letter-spacing:-.02em">S&amp;C</div>`,
    aurora: `background:${dark}">
      <div style="position:absolute;inset:0;filter:blur(${w * 0.05}px)">
        <div style="position:absolute;left:-10%;top:15%;width:120%;height:18%;background:${a};transform:rotate(-12deg) skewX(-20deg);opacity:.9"></div>
        <div style="position:absolute;left:-10%;top:32%;width:120%;height:12%;background:${b};transform:rotate(-6deg);opacity:.8"></div></div>
      ${Array.from({ length: 60 }, (_, i) => `<div style="position:absolute;left:${(i * 37) % 100}%;top:${(i * 53) % 60}%;width:2px;height:2px;border-radius:50%;background:#fff;opacity:${0.3 + (i % 5) / 8}"></div>`).join('')}
      <div style="position:absolute;left:0;right:0;bottom:0;height:22%;background:#000;clip-path:polygon(0 60%,15% 20%,30% 55%,48% 0,66% 50%,82% 25%,100% 55%,100% 100%,0 100%)"></div>`,
    type: `background:${a}">
      <div style="position:absolute;left:6%;top:4%;font:900 ${w * 0.3}px/0.82 ${font};color:${dark};letter-spacing:-.05em">RUE<br>PARA<br>DIS</div>
      <div style="position:absolute;right:7%;top:7%;width:18%;aspect-ratio:1;border-radius:50%;background:${dark}"></div>`,
    grid: `background:linear-gradient(180deg,${dark},#6a3093 60%,${a})">
      <div style="position:absolute;left:50%;top:42%;width:40%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:linear-gradient(180deg,${b},${a})"></div>
      <div style="position:absolute;left:12%;right:12%;bottom:30%;display:flex;align-items:flex-end;gap:2%">${[38, 62, 45, 80, 55, 70, 40, 90, 50].map((x) => `<div style="flex:1;height:${x * 2.4}px;background:${dark};opacity:.92"></div>`).join('')}</div>
      <div style="position:absolute;left:0;right:0;bottom:0;height:30%;background:linear-gradient(180deg,${a}80,${dark})"></div>`,
    rings: `background:${dark}">
      ${[0, 1, 2, 3, 4, 5].map((i) => `<div style="position:absolute;left:50%;top:45%;width:${20 + i * 14}%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;border:2px solid ${i % 2 ? a : b};opacity:${1 - i * 0.12}"></div>`).join('')}
      <div style="position:absolute;left:50%;top:45%;width:12%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:linear-gradient(135deg,${a},${b})"></div>
      <div style="position:absolute;left:73%;top:22%;width:4%;aspect-ratio:1;border-radius:50%;background:#fff"></div>`,
    mono: `background:linear-gradient(180deg,#f4f1ea,#e6e1d6)">
      <div style="position:absolute;left:50%;top:40%;width:44%;aspect-ratio:1;transform:translate(-50%,-50%);border-radius:50%;background:radial-gradient(circle at 35% 35%,#fff,${b} 60%,${dark})"></div>
      <div style="position:absolute;left:7%;bottom:7%;right:7%;font:300 ${w * 0.075}px/1 Georgia,serif;color:${dark}">Nocturnes</div>`,
  };
  const body = S[style] || S.blobs;
  return `<div id="art" style="position:relative;overflow:hidden;width:${w}px;height:${h}px;${body}${grain}${style === 'mono' || style === 'type' ? '' : caption}</div>`;
}

async function render(page, html, file, w, h) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<html><body style="margin:0;background:#000">${html}</body></html>`);
  await page.locator('#art').screenshot({ path: file, type: file.endsWith('.jpg') ? 'jpeg' : 'png', quality: file.endsWith('.jpg') ? 90 : undefined });
}

// ---------- Bibliothèque ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'app-music-demo-'));
const music = path.join(tmp, 'music'), cache = path.join(tmp, 'cache');
const browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const painter = await browser.newPage();
const artistOf = (name) => ARTISTS.find((a) => a.name === name);
try {
  console.log('Bibliothèque de démonstration…');
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const al of ALBUMS) {
    const dir = path.join(music, `${al.artist} - ${al.title} (${al.year})`);
    fs.mkdirSync(dir, { recursive: true });
    await render(painter, art(al.style, artistOf(al.artist).palette, al.artist, al.title), path.join(dir, 'cover.png'), 1000, 1000);
    al.tracks.forEach((t, i) => fs.writeFileSync(path.join(dir, `${String(i + 1).padStart(2, '0')} - ${t.replace(/[\/:]/g, '-')}.flac`),
      flac({ seconds: 150 + Math.round(rnd() * 170), tags: { TITLE: t, ARTIST: al.artist, ALBUM: al.title, TRACKNUMBER: i + 1, DATE: al.year, GENRE: al.genre } })));
  }

  // 1er passage : indexation (identifiants), puis fiches et photos d'artistes dans le cache
  let srv = await startServer({ music, cache });
  const lib = (await srv.api('/api/library')).body;
  await srv.stop();
  const META = path.join(cache, 'meta'), IMG = path.join(cache, 'artists');
  for (const a of lib.albums) {
    const d = ALBUMS.find((x) => x.title === a.title);
    fs.writeFileSync(path.join(META, `album-${a.id}.json`), JSON.stringify({ firstRelease: String(d.year), type: 'Album', genres: [d.genre.toLowerCase()], label: d.label, wiki: { title: d.title, extract: d.note, lang: 'fr' } }));
  }
  for (const ar of lib.artists) {
    const d = artistOf(ar.name);
    fs.writeFileSync(path.join(META, `artist-${ar.id}.json`), JSON.stringify({ name: d.name, type: d.type, country: d.country, beginArea: d.beginArea, begin: d.begin, end: d.end || null, tags: d.tags, wiki: { title: d.name, extract: d.bio, lang: 'fr' } }));
    fs.writeFileSync(path.join(META, `top-${ar.id}.json`), JSON.stringify({ tracks: Object.entries(d.hits || {}).map(([title, rank]) => ({ title, rank })) }));
    const style = ALBUMS.find((x) => x.artist === d.name).style;
    await render(painter, art(style, d.palette, '', '', 1000, 1000).replace(/<div style="position:absolute;left:7%;bottom:7%[\s\S]*?<\/div><\/div>/, ''), path.join(IMG, `${ar.id}-thumb.jpg`), 1000, 1000);
    await render(painter, art('blobs', d.palette, '', '', 1920, 1080).replace(/<div style="position:absolute;left:7%;bottom:7%[\s\S]*?<\/div><\/div>/, ''), path.join(IMG, `${ar.id}-fanart.jpg`), 1920, 1080);
  }

  // 2e passage : l'app telle qu'un utilisateur la voit
  srv = await startServer({ music, cache });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  const album = (t) => lib.albums.find((a) => a.title === t);
  const artist = (n) => lib.artists.find((a) => a.name === n);
  const go = async (hash, wait = 1200) => { await page.evaluate((h) => (location.hash = h), hash); await sleep(wait); };
  // colonne de gauche : taille et dossier d'une vraie bibliothèque (la démo pèse quelques Mo dans un dossier temporaire)
  const dress = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('#lib-meta > div')];
    const set = (label, v) => { const r = rows.find((x) => x.firstElementChild?.textContent === label); if (r) r.lastElementChild.textContent = v; };
    set('Taille', '41,8 Go'); set('Dossier', '~/Musique');
  });
  const shot = async (name) => { await dress(); await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 88 }); console.log('  ✓', name); };
  fs.mkdirSync(OUT, { recursive: true });
  await page.goto(srv.url + '/#/albums'); await page.waitForSelector('.card[data-album]');
  await page.evaluate(() => localStorage.clear());

  // lecture en cours (barre du bas renseignée), à 1:24
  await go(`#/album/${album('Néons sur la Seine').id}`);
  await page.click('.tracklist tr[data-track]');
  await sleep(800);
  const seek = await (await page.$('#seek')).boundingBox();
  await page.mouse.click(seek.x + seek.width * 0.36, seek.y + seek.height / 2);
  await sleep(600);

  await go(`#/flow/${album('Orbite basse').id}`, 2600); await shot('cover-flow');
  await go(`#/album/${album('Néons sur la Seine').id}`, 1200); await page.$eval('.shelf', (e) => e.scrollIntoView()); await sleep(900); await page.evaluate(() => document.querySelector('#view').scrollTo(0, 0)); await sleep(1200); await page.mouse.move(1300, 850); await shot('album');
  await go('#/albums', 1600); await page.click('#b-queue'); await sleep(900); await page.mouse.move(700, 850); await shot('albums-queue');
  await page.click('#q-close'); await sleep(500);
  await go(`#/artist/${artist('Kodiak Drive').id}`, 2200); await shot('artist');
  await go('#/search/années 80', 1600); await shot('search');
  await page.evaluate(() => { document.querySelector('#search').value = ''; document.activeElement?.blur(); });
  await go('#/selections', 2200); await page.mouse.move(1300, 120); await shot('selections');
  if (errors.length) console.warn('Erreurs JavaScript :', errors);
  await srv.stop();
  console.log(`Captures dans ${path.relative(ROOT, OUT)}/`);
} finally {
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
}
