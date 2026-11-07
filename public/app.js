// App Music — interface
import { buildIndex, search as runSearch } from './search.js';
import * as nav from './keynav.js';
import { listen, voiceAvailable } from './voice.js';
import { liquidGlass } from './glass.js';
import { buildMixes, byArtistYear } from './mixes.js';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtTime = (s) => { s = Math.max(0, Math.floor(s || 0)); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = String(s % 60).padStart(2, '0'); return h ? `${h}:${String(m).padStart(2, '0')}:${x}` : `${m}:${x}`; };
const fmtLong = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const cover = (id) => `/cover/${id}.jpg`;
const store = { get(k, d) { try { const v = localStorage.getItem('dq.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('dq.' + k, JSON.stringify(v)); } catch {} } };
const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>',
  shuffle: '<svg viewBox="0 0 24 24"><path d="M3 7h3.5c3.5 0 4.5 10 8 10H20M3 17h3.5c1.4 0 2.4-1.6 3.3-3.6M14.5 7H20M17.5 4 20.5 7l-3 3M17.5 14l3 3-3 3M11.3 9.4C12.2 8 13.1 7 14.5 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  eq: '<span class="eq"><i></i><i></i><i></i></span>',
  download: '<svg viewBox="0 0 24 24"><path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19.5h14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

let LIB = { albums: [], artists: [], tracks: [] };
let searchIndex = null;
const getIndex = () => (searchIndex ||= buildIndex(LIB));
const T = new Map(), A = new Map(), R = new Map();

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 2600); }

function metaState(m) {
  if (!m) return '—';
  const n = m.pendingArtists + m.pendingAlbums;
  if (!n) return '<span style="color:#30d158">● Prêtes hors ligne</span>';
  if (m.syncing) return `Téléchargement… (${n})`;
  return m.online === false ? `${n} en attente (réseau)` : `${n} en attente`;
}
async function loadLibrary() {
  const r = await fetch('/api/library').then((x) => x.json());
  LIB = r;
  T.clear(); A.clear(); R.clear(); searchIndex = null;
  r.tracks.forEach((t) => T.set(t.id, t));
  r.albums.forEach((a) => A.set(a.id, a));
  r.artists.forEach((a) => R.set(a.id, a));
  const total = r.albums.reduce((s, a) => s + a.duration, 0);
  const n = (x) => x.toLocaleString('fr-FR');
  $('#stats').innerHTML = [[r.albums.length, 'albums'], [r.artists.length, 'artistes'], [r.tracks.length, 'titres'], [Math.round(total / 3600) + ' h', 'd’écoute']]
    .map(([v, l]) => `<div><b>${typeof v === 'number' ? n(v) : v}</b><span>${l}</span></div>`).join('');
  const lossyN = r.albums.filter((a) => a.lossy).length;
  const lossless = !lossyN ? 'FLAC sans perte' : `<a href="#/mp3" class="lossy-link" title="Voir les albums avec perte et télécharger la liste">${WARN}${n(lossyN)} album${lossyN > 1 ? 's' : ''} en ${lossyN && r.albums.filter((a) => a.lossy).every((a) => a.lossyCodec === 'MP3') ? 'MP3' : 'avec perte'}</a>`;
  const when = r.scanning ? `Indexation ${r.scanProgress.done}/${r.scanProgress.total}` : r.scannedAt ? new Date(r.scannedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  $('#lib-meta').innerHTML = `<div><span>Taille</span><span>${(r.bytes / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go</span></div>
    <div><span>Qualité</span><span>${lossless}</span></div><div><span>Dossier</span><button class="folder-btn" data-change-folder title="Changer de dossier">${esc(r.folder || '—')}</button></div><div><span>Mise à jour</span><span>${when}</span></div>
    <div><span>Infos</span><span>${metaState(r.meta)}</span></div>`;
  return r;
}

// ---------- Deux couleurs vives d'une pochette (haut / bas), pour la barre de progression ----------
const gradCache = new Map();
function vivid([r, g, b]) {
  // garde la teinte, pousse saturation et luminosité pour rester visible sur le verre sombre
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  const k = l < 1 ? 1 : 1 + Math.max(0, 0.6 - (mx - mn) / Math.max(mx, 1));
  let c = [r, g, b].map((v) => l + (v - l) * k);
  const top = Math.max(...c); if (top < 190) c = c.map((v) => v * 190 / Math.max(top, 1));
  return c.map((v) => Math.max(0, Math.min(255, Math.round(v))));
}
function coverGradient(albumId) {
  if (gradCache.has(albumId)) return gradCache.get(albumId);
  const p = new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data;
      const half = (from, to) => {
        let r = 0, g = 0, b = 0, w = 0;
        for (let i = from * 96; i < to * 96; i += 4) {
          const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
          const wt = 0.05 + ((mx - mn) / 255) ** 2 * (mx > 40 ? 4 : 0.5);
          r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
        }
        return vivid([r / w, g / w, b / w]);
      };
      res([half(0, 12), half(12, 24)]);
    };
    img.onerror = () => res([[161, 161, 166], [161, 161, 166]]);
    img.src = cover(albumId);
  });
  gradCache.set(albumId, p);
  return p;
}

// ---------- Couleur dominante d'une pochette ----------
const colorCache = new Map();
function dominant(albumId) {
  if (colorCache.has(albumId)) return colorCache.get(albumId);
  const p = new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = c.height = 24;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, 24, 24);
      const d = x.getImageData(0, 0, 24, 24).data;
      let r = 0, g = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]);
        const wt = 0.15 + (mx - mn) / 255 * (mx > 30 && mx < 245 ? 1 : 0.2);
        r += d[i] * wt; g += d[i + 1] * wt; b += d[i + 2] * wt; w += wt;
      }
      res([r / w, g / w, b / w].map(Math.round));
    };
    img.onerror = () => res([120, 120, 130]);
    img.src = cover(albumId);
  });
  colorCache.set(albumId, p);
  return p;
}

// ---------- Inclinaison 3D au survol ----------
function attachTilt(root, max = 12) {
  root.addEventListener('pointermove', (e) => {
    const card = e.target.closest('.tilt-host'); if (!card) return;
    const el = card.querySelector('.tilt'); const r = el.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    el.style.transition = 'transform .12s linear, box-shadow .5s';
    el.style.transform = `rotateX(${(0.5 - py) * max}deg) rotateY(${(px - 0.5) * max}deg) translateZ(10px)`;
    el.style.setProperty('--gx', px * 100 + '%'); el.style.setProperty('--gy', py * 100 + '%');
  });
  root.addEventListener('pointerout', (e) => {
    const card = e.target.closest('.tilt-host'); if (!card || card.contains(e.relatedTarget)) return;
    const el = card.querySelector('.tilt'); el.style.transition = ''; el.style.transform = '';
  });
}
function onImgLoad(root) { $$('img[data-fade]', root).forEach((i) => { if (i.complete && i.naturalWidth) i.classList.add('loaded'); else i.addEventListener('load', () => i.classList.add('loaded'), { once: true }); }); }

// Petit triangle discret : album (ou partie d'album) dans un format avec perte (MP3, AAC…)
const WARN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6 15.2 14.2H.8z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 6.2v3.4" stroke="#141414" stroke-width="1.7" stroke-linecap="round"/><circle cx="8" cy="11.9" r="1" fill="#141414"/></svg>';
const lossyText = (a) => (a.lossy >= a.tracks.length ? `Album en ${a.lossyCodec} (avec perte)` : `${a.lossy} titre${a.lossy > 1 ? 's' : ''} sur ${a.tracks.length} en ${a.lossyCodec} (avec perte)`);
const lossyMark = (a) => (a.lossy ? `<span class="lossy" title="${esc(lossyText(a))}">${WARN}</span>` : '');
const lossyAlbums = () => LIB.albums.filter((a) => a.lossy);
const albumCard = (a) => `
  <div class="card tilt-host" data-album="${a.id}" draggable="true">
    <div class="tilt"><img data-fade loading="lazy" src="${cover(a.id)}" alt=""><div class="glare"></div>
      <button class="card-play" data-play-album="${a.id}" title="Lire">${ICON.play}</button></div>
    <div class="card-title">${esc(a.title)}</div>
    <div class="card-sub">${esc(a.artist)}${a.year ? ' · ' + a.year : ''}${lossyMark(a)}</div>
  </div>`;

// ---------- Infos en ligne ----------
const infoCache = new Map();
let inflight = 0; const waiting = [];
function getInfo(kind, id) {
  const key = kind + id;
  if (!infoCache.has(key)) {
    infoCache.set(key, new Promise((res) => {
      const run = () => { inflight++; fetch(`/api/${kind}/${id}`).then((r) => r.json()).catch(() => ({ pending: true })).then((d) => { inflight--; if (d.pending) infoCache.delete(key); res(d); waiting.shift()?.(); }); };
      inflight < 4 ? run() : waiting.push(run);
    }));
  }
  return infoCache.get(key);
}

// ---------- Routeur ----------
const view = $('#view');
let cleanup = null;
let currentHash = location.hash;
let arriving = null; // album ouvert depuis le Cover Flow (transition animée)
function route() {
  const h = location.hash.replace(/^#\/?/, '') || store.get('lastView', 'flow');
  let [name, arg] = h.split('/');
  if (name === 'tracks') name = 'selections'; // ancienne page « Titres »
  if (cleanup) { cleanup(); cleanup = null; }
  $$('nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name || (name === 'album' && a.dataset.nav === 'albums') || (name === 'artist' && a.dataset.nav === 'artists') || (name === 'selection' && a.dataset.nav === 'selections')));
  document.body.classList.toggle('flow-mode', name === 'flow' || !name);
  document.body.classList.toggle('tinted', name === 'album');
  view.classList.remove('view-enter'); void view.offsetWidth; view.classList.add('view-enter');
  view.scrollTop = 0;
  if (['flow', 'albums', 'artists', 'selections'].includes(name)) store.set('lastView', name);
  ({ flow: viewFlow, albums: viewAlbums, album: viewAlbum, artists: viewArtists, artist: viewArtist, selections: viewSelections, selection: viewSelection, search: viewSearch, mp3: viewLossy }[name] || viewFlow)(arg && decodeURIComponent(arg));
  nav.makeFocusable(view);
  if (name !== 'search' || document.activeElement !== $('#search')) nav.restore(location.hash);
  currentHash = location.hash;
}
window.addEventListener('hashchange', () => { nav.remember(currentHash); route(); });

// Fond d'ambiance partagé avec la colonne de gauche (fondu enchaîné entre deux images)
let ambientIdx = 0;
function setAmbient(albumId) {
  const imgs = $$('#ambient img'); const img = imgs[ambientIdx ^= 1];
  if (img.dataset.id === albumId) return;
  img.dataset.id = albumId;
  img.onload = () => { img.classList.add('on'); imgs[ambientIdx ^ 1].classList.remove('on'); };
  img.src = cover(albumId);
}

// ---------- Cover Flow (boîtiers de CD en 3D) ----------
function viewFlow(startId) {
  const albums = LIB.albums;
  if (!albums.length) { view.innerHTML = '<div class="empty">Aucun album pour le moment.</div>'; return; }
  let cur = albums.findIndex((a) => a.id === (startId || store.get('flowAlbum')));
  if (cur < 0) cur = Math.floor(Math.random() * albums.length);
  view.innerHTML = `
    <div class="flow">
      <div class="flow-stage" id="stage" tabindex="0" aria-label="Cover Flow : flèches gauche et droite pour parcourir, OK pour ouvrir"></div>
      <div class="flow-caption"><div class="t"></div><div class="a"></div>
        <div class="flow-actions"><button class="btn glass primary" data-act="play">${ICON.play} Lecture</button><button class="btn glass" data-act="open">Ouvrir l'album</button></div>
      </div>
      <div class="flow-scrub"><input type="range" min="0" max="${albums.length - 1}" step="1" value="${cur}"></div>
    </div>`;
  const stage = $('#stage'), cap = $('.flow-caption'), scrub = $('.flow-scrub input');
  const items = albums.map((a, i) => {
    const el = document.createElement('div');
    el.className = 'cf-item'; el.dataset.i = i;
    el.innerHTML = `<div class="cf-box">
        <div class="cf-shadow"></div>
        <div class="lid"><div class="f front"><div class="hinge"></div><img draggable="false" src="${cover(a.id)}" loading="lazy" alt=""><div class="gloss"></div><div class="cf-shade"></div></div><div class="f lid-in"></div></div>
        <div class="f back"></div>
        <div class="f left"><span>${esc(a.artist)} · ${esc(a.title)}</span></div>
        <div class="f right"></div><div class="f top"></div><div class="f bottom"></div>
        <div class="f refl"><div class="hinge"></div><img draggable="false" src="${cover(a.id)}" loading="lazy" alt=""></div>
      </div>`;
    el._shade = el.querySelector('.cf-shade');
    stage.appendChild(el);
    return el;
  });
  let S = 300, W = 324, pos = cur, target = cur, raf = null;
  const colored = new Set();

  const resize = () => {
    S = Math.round(Math.min(stage.clientHeight * 0.56, stage.clientWidth * 0.27, 360));
    W = Math.round(S * 1.08);
    stage.style.setProperty('--S', S + 'px'); stage.style.setProperty('--W', W + 'px'); stage.style.setProperty('--D', Math.max(12, Math.round(S * 0.075)) + 'px');
    render();
  };
  function render() {
    for (let i = 0; i < items.length; i++) {
      const d = i - pos, a = Math.abs(d), el = items[i];
      if (a > 9) { if (el.style.display !== 'none') el.style.display = 'none'; continue; }
      el.style.display = '';
      if (!colored.has(i)) { colored.add(i); dominant(albums[i].id).then((c) => el.style.setProperty('--sc', c.map((v) => Math.round(v * 0.75)).join(','))); }
      const s = Math.sign(d), c = Math.min(a, 1);
      const x = s * (c * W * 0.62 + Math.max(0, a - 1) * W * 0.22);
      el.style.transform = `translate3d(${x}px,0,${-c * S * 0.55}px) rotateY(${-s * c * 64}deg)`;
      el.style.zIndex = 1000 - Math.round(a * 10);
      el._shade.style.opacity = Math.min(0.6, a * 0.13);
    }
  }
  function animate() {
    const diff = target - pos;
    pos += diff * 0.15;
    if (Math.abs(diff) < 0.0008) pos = target;
    render();
    const i = Math.round(pos);
    if (i !== cur) { cur = i; updateCaption(); }
    raf = pos !== target ? requestAnimationFrame(animate) : null;
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(animate); };
  const go = (t) => { target = Math.max(0, Math.min(albums.length - 1, t)); kick(); };
  let opening = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  // Ouverture d'un album : le boîtier avance, le couvercle pivote sur sa charnière, le CD sort en tournant,
  // le couvercle se referme, puis pochette et CD glissent vers leur place sur la page de l'album.
  async function openAlbum(i) {
    const a = albums[i];
    if (opening) return;
    if (!document.startViewTransition || matchMedia('(prefers-reduced-motion: reduce)').matches) { location.hash = `#/album/${a.id}`; return; }
    opening = true;
    if (Math.round(pos) !== i || pos !== target) { go(i); while (pos !== target) await wait(30); }
    const el = items[i], flow = $('.flow');
    const box = el.querySelector('.cf-box');
    if (!el.querySelector('.tray')) box.insertAdjacentHTML('afterbegin', `<div class="f tray"><div class="disc-wrap"><div class="disc" style="--art:url('${cover(a.id)}')"></div></div></div>`);
    flow.classList.add('opening'); el.classList.add('focus');
    await wait(420);
    el.classList.add('lid-open');
    await wait(380);
    el.classList.add('disc-out');
    await wait(720);
    el.classList.remove('lid-open');
    await wait(520);
    el.querySelector('.f.front').style.viewTransitionName = 'album-cover';
    el.querySelector('.disc').style.viewTransitionName = 'album-disc';
    arriving = a.id;
    const vt = document.startViewTransition(() => {
      nav.remember(currentHash);
      history.pushState(null, '', `#/album/${a.id}`);
      route();
    });
    vt.finished.finally(() => { arriving = null; $$('[style*="view-transition-name"]').forEach((n) => (n.style.viewTransitionName = '')); });
  }
  let capTimer;
  function updateCaption() {
    const a = albums[cur];
    scrub.value = cur; store.set('flowAlbum', a.id);
    $('.t', cap).textContent = a.title;
    $('.a', cap).innerHTML = `<a href="#/artist/${a.artistId}">${esc(a.artist)}</a>${a.year ? ' · ' + a.year : ''}${lossyMark(a)}`;
    clearTimeout(capTimer);
    capTimer = setTimeout(() => setAmbient(a.id), 160);
  }

  // Glisser, molette, clic
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, start: target, moved: false, t: performance.now(), lastX: e.clientX, v: 0 };
    stage.setPointerCapture(e.pointerId); stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    if (Math.abs(dx) > 4) drag.moved = true;
    const now = performance.now(); drag.v = (e.clientX - drag.lastX) / Math.max(1, now - drag.t); drag.t = now; drag.lastX = e.clientX;
    if (drag.moved) go(drag.start - dx / (W * 0.3));
  });
  stage.addEventListener('pointerup', (e) => {
    stage.classList.remove('dragging');
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved) { go(Math.round(target - d.v * 4)); return; }
    const item = document.elementsFromPoint(e.clientX, e.clientY).map((n) => n.closest?.('.cf-item')).find(Boolean);
    if (!item) return;
    const i = +item.dataset.i;
    if (i === Math.round(pos)) openAlbum(i); else go(i);
  });
  let wheelSnap;
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    go(target + d / 110);
    clearTimeout(wheelSnap); wheelSnap = setTimeout(() => go(Math.round(target)), 140);
  }, { passive: false });
  scrub.addEventListener('input', () => go(+scrub.value));
  cap.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act; const a = albums[cur];
    if (act === 'play') player.playList(a.tracks, 0);
    if (act === 'open') openAlbum(cur);
  });
  const onKey = (e) => {
    if (document.activeElement !== stage && document.activeElement !== document.body) return;
    if (nav.topOverlay()) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); e.stopImmediatePropagation(); go(Math.round(target) + 1); stage.focus({ preventScroll: true }); }
    if (e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopImmediatePropagation();
      if (Math.round(target) === 0) { nav.focusEl($('nav a.active') || $('nav a')); return; } // premier album : on rejoint la colonne
      go(Math.round(target) - 1); stage.focus({ preventScroll: true });
    }
    if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); openAlbum(cur); }
  };
  window.addEventListener('keydown', onKey, true);
  const ro = new ResizeObserver(resize); ro.observe(stage);
  resize(); updateCaption();
  cleanup = () => { window.removeEventListener('keydown', onKey, true); ro.disconnect(); cancelAnimationFrame(raf); };
}

// ---------- Sélections : classiques, récemment ajoutés, playlists par style et par décennie ----------
let mixCache = null;
function mixes() {
  if (mixCache?.lib !== LIB) mixCache = { lib: LIB, map: buildMixes(LIB) };
  return mixCache.map;
}
const mosaicAlbums = (m, n = 4) => m.cover.slice(0, n);
// mosaïque de pochettes (une seule s'il n'y a pas de quoi remplir la grille)
const mosaic = (m, n = 4) => { const list = mosaicAlbums(m, n); const k = list.length >= n ? n : 1;
  return `<div class="mosaic n${k}">${list.slice(0, k).map((a) => `<img loading="lazy" src="${cover(a.id)}" alt="">`).join('')}</div>`; };
const mixDuration = (m) => fmtLong(m.ids.reduce((s, id) => s + (T.get(id)?.duration || 0), 0));
const mixCard = (m) => `<div class="mix-card" data-mix="${m.key}">
    <div class="mix-art">${mosaic(m)}<div class="mix-shade"></div><div class="mix-name">${esc(m.title)}${m.kind === 'classics' ? ' <span class="mix-star">★</span>' : ''}</div>
      <button class="card-play" data-play-mix="${m.key}" title="Lecture aléatoire">${ICON.play}</button></div>
    <div class="card-sub">${m.ids.length} titres · ${mixDuration(m)}</div></div>`;

function viewSelections() {
  const all = [...mixes().values()];
  const classics = all.find((m) => m.kind === 'classics');
  const recent = [...LIB.albums].filter((a) => a.added).sort((a, b) => b.added.localeCompare(a.added) || byArtistYear(a, b)).slice(0, 14);
  const styles = all.filter((m) => m.kind === 'style').sort((a, b) => b.ids.length - a.ids.length);
  const decades = all.filter((m) => m.kind === 'decade');
  view.innerHTML = `<div class="page selections">
    <div class="page-head"><h1>Sélections</h1></div>
    ${classics ? `<div class="mix-hero" data-mix="classiques">${mosaic(classics, 6)}<div class="mix-hero-shade"></div>
      <div class="mix-hero-info"><div class="eyebrow">Sélection</div><h2>Les classiques <span class="mix-star">★</span></h2>
        <p>${classics.ids.length} grands titres de votre bibliothèque · ${mixDuration(classics)}</p>
        <div class="hero-actions"><button class="btn primary" data-play-mix="classiques" data-autofocus>${ICON.shuffle} Lecture aléatoire</button></div></div></div>` : ''}
    ${recent.length ? `<h2>Récemment ajoutés</h2><div class="shelf">${recent.map(albumCard).join('')}</div>` : ''}
    ${styles.length ? `<h2>Par style</h2><div class="mix-grid">${styles.map(mixCard).join('')}</div>` : ''}
    ${decades.length ? `<h2>Par décennie</h2><div class="mix-grid">${decades.map(mixCard).join('')}</div>` : ''}
  </div>`;
  onImgLoad(view);
}

function viewSelection(key) {
  const m = mixes().get(key); if (!m) return viewSelections();
  const first = mosaicAlbums(m, 1)[0];
  view.innerHTML = `
    <div class="album-hero mix-page">
      <div class="mix-cover">${mosaic(m)}</div>
      <div class="hero-info">
        <div class="eyebrow">Sélection</div>
        <h1>${esc(m.title)}${m.kind === 'classics' ? ' <span class="mix-star">★</span>' : ''}</h1>
        <p class="hero-note on">${esc(m.note)}</p>
        <div class="hero-facts">${m.ids.length} titres · ${m.albums.length} album${m.albums.length > 1 ? 's' : ''} · ${mixDuration(m)}</div>
        <div class="hero-actions"><button class="btn primary" data-act="play" data-autofocus>${ICON.play} Lecture</button><button class="btn soft" data-act="shuffle">${ICON.shuffle} Aléatoire</button></div>
      </div>
    </div>
    <div class="album-body"><table class="tracklist"><tbody>${trackRows(m.ids.slice(0, 600), { showArtist: true, showAlbum: true, rank: true, discs: false })}</tbody></table></div>`;
  if (first) setAmbient(first.id);
  $('.hero-actions', view).addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') player.playList(m.ids, 0, { shuffle: false });
    if (act === 'shuffle') player.playList(m.ids, -1, { shuffle: true });
  });
}

// ---------- Albums avec perte (MP3…) : journal et liste à télécharger ----------
const fmtDay = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
function viewLossy() {
  const list = lossyAlbums().sort((a, b) => a.artist.localeCompare(b.artist, 'fr') || (a.year || 0) - (b.year || 0));
  const allMp3 = list.every((a) => a.lossyCodec === 'MP3');
  const files = list.reduce((n, a) => n + a.lossy, 0);
  view.innerHTML = `<div class="page lossy-page">
    <div class="page-head"><h1>${allMp3 ? 'Albums en MP3' : 'Albums avec perte'}</h1><span class="muted">${list.length ? `${list.length} album${list.length > 1 ? 's' : ''} · ${files} fichier${files > 1 ? 's' : ''}` : ''}</span></div>
    ${list.length ? `<p class="lossy-intro">Ces albums ne sont pas en qualité sans perte${allMp3 ? '' : ' (MP3, AAC…)'}. L’app note la date où chacun a été repéré ;
      remplacé par du FLAC, il passe dans l’historique.</p>
      <div class="hero-actions"><a class="btn primary" href="/api/lossy.csv" download data-autofocus>${ICON.download} Télécharger la liste des fichiers</a></div>
      <div class="grid">${list.map(albumCard).join('')}</div>`
    : '<div class="empty">Toute la bibliothèque est sans perte. ✨</div>'}
    <div id="lossy-history"></div></div>`;
  onImgLoad(view);
  fetch('/api/lossy').then((r) => r.json()).then(({ albums, history }) => {
    const seen = new Map(albums.map((x) => [x.id, x.firstSeen]));
    for (const card of $$('.grid .card[data-album]', view)) {
      const d = seen.get(card.dataset.album);
      if (d) card.insertAdjacentHTML('beforeend', `<div class="card-sub lossy-seen">Repéré le ${fmtDay(d)}</div>`);
    }
    const box = $('#lossy-history'); if (!box || !history.length) return;
    box.innerHTML = `<h2>Historique</h2><p class="lossy-intro">Albums qui ne sont plus avec perte (remplacés ou retirés du dossier).</p>
      <table class="lossy-log"><tbody>${history.map((e) => `<tr><td><b>${esc(e.title)}</b><span>${esc(e.artist)}${e.year ? ' · ' + e.year : ''}</span></td>
        <td>${esc(e.codec || '')}</td><td>Repéré le ${fmtDay(e.firstSeen)}</td><td>Réglé le ${fmtDay(e.resolvedAt)}</td></tr>`).join('')}</tbody></table>`;
  }).catch(() => {});
}

// ---------- Albums ----------
function viewAlbums() {
  const sort = store.get('albumSort', 'artist');
  const sorters = {
    artist: (a, b) => a.artist.localeCompare(b.artist, 'fr') || (a.year || 0) - (b.year || 0),
    title: (a, b) => a.title.replace(/^[^\p{L}\p{N}]+/u, '').localeCompare(b.title.replace(/^[^\p{L}\p{N}]+/u, ''), 'fr'),
    year: (a, b) => (b.year || 0) - (a.year || 0),
  };
  const list = [...LIB.albums].sort(sorters[sort]);
  view.innerHTML = `<div class="page">
    <div class="page-head"><h1>Albums</h1>
      <div class="segmented">${[['artist', 'Artiste'], ['title', 'Titre'], ['year', 'Année']].map(([k, l]) => `<button data-sort="${k}" class="${k === sort ? 'on' : ''}">${l}</button>`).join('')}</div></div>
    <div class="grid">${list.map(albumCard).join('')}</div></div>`;
  $('.segmented').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { store.set('albumSort', b.dataset.sort); viewAlbums(); } });
  onImgLoad(view);
}

// ---------- Album ----------
const STAR = '<span class="hit" title="Titre très connu">★</span>';
// titre affiché sans les mentions techniques (« - Remastered 2021 », « (Remaster) »)
const showTitle = (t) => t.replace(/\s*[-–]\s*(\d{4}\s*)?(remaster(ed)?|digital remaster|mono|stereo)(\s+(version|\d{4}))*\s*$/i, '').replace(/\s*[(\[](\d{4}\s*)?(remaster(ed)?|digitally remastered|remastered \d{4}|\d{4} remaster(ed)?)[^)\]]*[)\]]/i, '').trim() || t;
function trackRows(ids, { showArtist, albumArtist, showAlbum, rank, discs = true } = {}) {
  let disc = null; const multi = discs && new Set(ids.map((id) => T.get(id).disc)).size > 1;
  return ids.map((id, n) => {
    const t = T.get(id); let head = '';
    if (multi && t.disc !== disc) { disc = t.disc; head = `<tr class="disc-head"><td colspan="3">Disque ${disc}</td></tr>`; }
    const feat = showArtist || (albumArtist && t.artist !== albumArtist);
    return `${head}<tr class="tr ${player.current === id ? 'playing' : ''}" data-track="${id}" data-n="${n}" draggable="true">
      <td><span class="num">${rank ? n + 1 : t.trackNo || n + 1}</span><span class="num-play">${ICON.play}</span>${ICON.eq}</td>
      <td><div class="tt">${esc(showTitle(t.title))}${t.hit ? STAR : ''}</div>${showAlbum && showArtist ? `<div class="ta">${esc(t.artist)} · ${esc(t.album)}</div>` : showAlbum ? `<div class="ta">${esc(t.album)}</div>` : feat ? `<div class="ta">${esc(t.artist)}</div>` : ''}</td>
      <td>${fmtTime(t.duration)}</td></tr>`;
  }).join('');
}

function viewAlbum(id) {
  const a = A.get(id); if (!a) return viewAlbums();
  const ar = R.get(a.artistId);
  const others = ar ? ar.albums.filter((x) => x !== id).map((x) => A.get(x)) : [];
  view.innerHTML = `
    <div class="album-hero">
      <div class="hero-cover tilt-host" draggable="true"><div class="hero-disc ${player.current && T.get(player.current)?.albumId === a.id ? 'playing' : ''}" data-album="${a.id}" data-disc><div class="disc" style="--art:url('${cover(a.id)}')"></div></div><div class="tilt"><img data-fade src="${cover(a.id)}" alt=""><div class="glare"></div></div></div>
      <div class="hero-info">
        <div class="eyebrow">Album</div>
        <h1>${esc(a.title)}</h1>
        <a class="hero-artist" href="#/artist/${a.artistId}">${esc(a.artist)}</a>
        <p class="hero-note" id="hero-note"></p>
        <div class="hero-facts">${[a.genre, a.year, `${a.tracks.length} titres`, fmtLong(a.duration)].filter(Boolean).map(esc).join(' · ')} <span class="badge${a.lossy ? ' warn' : ''}"${a.lossy ? ` title="${esc(lossyText(a))}"` : ''}>${a.lossy ? WARN : ''}${esc(a.format)}</span></div>
        <div class="hero-actions"><button class="btn primary" data-act="play" data-autofocus>${ICON.play} Lecture</button><button class="btn soft" data-act="shuffle">${ICON.shuffle} Aléatoire</button></div>
      </div>
    </div>
    <div class="album-body">
      <table class="tracklist"><tbody>${trackRows(a.tracks, { albumArtist: a.artist })}</tbody></table>
    </div>
    ${others.length ? `<div class="page" style="padding-top:0"><h2>Autres albums de ${esc(a.artist)}</h2><div class="shelf">${others.map(albumCard).join('')}</div></div>` : ''}`;
  onImgLoad(view);
  if (arriving === a.id) {
    $('.hero-cover .tilt').style.viewTransitionName = 'album-cover';
    $('.hero-disc .disc').style.viewTransitionName = 'album-disc';
    view.classList.add('arrive');
    $$('.hero-info > *, .tracklist .tr', view).slice(0, 18).forEach((n, k) => n.style.setProperty('--k', k));
    setTimeout(() => view.classList.remove('arrive'), 2000);
  }
  dominant(a.id).then((c) => view.style.setProperty('--tint', c.join(',')));
  setAmbient(a.id);
  $('.hero-actions').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') player.playList(a.tracks, 0, { shuffle: false });
    if (act === 'shuffle') player.playList(a.tracks, -1, { shuffle: true });
  });
  getInfo('album', a.id).then((info) => {
    const note = $('#hero-note'); if (!note || !info.wiki) return;
    note.textContent = firstSentence(info.wiki.extract); note.classList.add('on');
  });
}

// Première phrase d'un résumé Wikipédia (sans prononciation ni parenthèses encombrantes)
function firstSentence(text) {
  if (!text) return '';
  const t = text.replace(/\s*\[[^\]]*[ˈˌːæɪəɛʊʃʒθðŋɔɑʁ][^\]]*\]/g, '').replace(/\s*\((?:[^()]*?(?:écouter|prononc|\/|ˈ|API)[^()]*?)\)/g, '').replace(/\(\s*\)/g, '').replace(/\s+/g, ' ').trim();
  const re = /[.!?](?=\s+[A-ZÀ-ÖØ-Þ«"“])/g; let m;
  while ((m = re.exec(t))) {
    const before = t.slice(Math.max(0, m.index - 4), m.index);
    if (/(^|[\s.(-])[A-Z]$/.test(before) || /\b(St|Dr|Mr|Jr|av|J\.-C|etc|cf|vol|no)$/i.test(before)) continue; // initiales, abréviations
    return t.slice(0, m.index + 1);
  }
  return t;
}

// ---------- Artistes ----------
const PAYS = { 'United States': 'États-Unis', 'United Kingdom': 'Royaume-Uni', England: 'Angleterre', Scotland: 'Écosse', Germany: 'Allemagne', Sweden: 'Suède', Greece: 'Grèce', Australia: 'Australie', Ireland: 'Irlande', Italy: 'Italie', Norway: 'Norvège', Finland: 'Finlande', Netherlands: 'Pays-Bas', Spain: 'Espagne', Belgium: 'Belgique', Switzerland: 'Suisse', Brazil: 'Brésil', Japan: 'Japon', Denmark: 'Danemark', Austria: 'Autriche', Poland: 'Pologne', 'New Zealand': 'Nouvelle-Zélande', Jamaica: 'Jamaïque', Mexico: 'Mexique', Russia: 'Russie' };
const fr = (x) => PAYS[x] || x;
const initials = (n) => n.replace(/^the\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
function artistCard(ar) {
  return `<div class="artist-card" data-artist="${ar.id}"><div class="avatar" data-avatar="${ar.id}"><span>${esc(initials(ar.name))}</span><img alt=""></div>
    <div class="card-title">${esc(ar.name)}</div><div class="card-sub">${ar.albums.length} album${ar.albums.length > 1 ? 's' : ''}</div></div>`;
}
function hydrateAvatars(root) {
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const el = e.target, ar = R.get(el.dataset.avatar);
      dominant(ar.albums[ar.albums.length - 1]).then((c) => el.style.setProperty('--c', c.join(',')));
      const img = $('img', el); img.onload = () => img.classList.add('loaded'); img.src = `/api/artist/${ar.id}/picture`;
    }
  }, { root: view, rootMargin: '300px' });
  $$('[data-avatar]', root).forEach((el) => io.observe(el));
  return () => io.disconnect();
}
function viewArtists() {
  view.innerHTML = `<div class="page"><div class="page-head"><h1>Artistes</h1><span class="muted">${LIB.artists.length} artistes</span></div>
    <div class="artist-grid">${LIB.artists.map(artistCard).join('')}</div></div>`;
  cleanup = hydrateAvatars(view);
}

function viewArtist(id) {
  const ar = R.get(id); if (!ar) return viewArtists();
  const albums = ar.albums.map((x) => A.get(x));
  const allTracks = albums.flatMap((a) => a.tracks);
  const total = albums.reduce((s, a) => s + a.duration, 0);
  const last = albums[albums.length - 1];
  // un tube présent sur plusieurs albums (studio, live, best of) n'est listé qu'une fois
  const seen = new Set();
  const popular = allTracks.map((id) => T.get(id)).filter((t) => t.hit).sort((x, y) => y.hit - x.hit)
    .filter((t) => { const k = t.title.toLowerCase().replace(/\s*[\[(-].*$/, '').trim(); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8).map((t) => t.id);
  view.innerHTML = `
    <div class="artist-hero"><img class="bgblur" src="${cover(last.id)}" alt=""><img class="bgimg" alt="">
      <div class="inner"><div><div class="eyebrow" style="color:rgba(255,255,255,.7)" id="ar-type">Artiste</div><h1>${esc(ar.name)}</h1></div>
        <div class="hero-actions" style="margin:0"><button class="btn glass primary" data-act="play" data-autofocus>${ICON.play} Lecture</button><button class="btn glass" data-act="shuffle">${ICON.shuffle} Aléatoire</button></div></div></div>
    <div class="page" style="padding-top:8px">
      <div class="facts" id="facts">
        <div class="fact"><small>Dans la bibliothèque</small><b>${albums.length} album${albums.length > 1 ? 's' : ''} · ${allTracks.length} titres</b></div>
        <div class="fact"><small>Durée d'écoute</small><b>${fmtLong(total)}</b></div>
      </div>
      <p class="lead" id="bio"></p>
      ${popular.length ? `<h2>Titres populaires</h2><table class="tracklist popular"><tbody>${trackRows(popular, { showAlbum: true, rank: true })}</tbody></table>` : ''}
      <h2>Discographie</h2>
      <div class="shelf">${albums.map(albumCard).join('')}</div>
      <h2>Tous les titres</h2>
      <table class="tracklist"><tbody>${trackRows(allTracks.slice(0, 400), { showArtist: false })}</tbody></table>
    </div>`;
  onImgLoad(view);
  const heroImg = $('.artist-hero .bgimg');
  heroImg.onload = () => heroImg.classList.add('loaded');
  heroImg.onerror = () => { if (!heroImg.src.endsWith('/picture')) heroImg.src = `/api/artist/${ar.id}/picture`; };
  heroImg.src = `/api/artist/${ar.id}/fanart`;
  $('.artist-hero .hero-actions').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act) player.playList(allTracks, act === 'shuffle' ? -1 : 0, { shuffle: act === 'shuffle' });
  });
  getInfo('artist', ar.id).then((info) => {
    if (!$('#bio')) return;
    if (info.type) $('#ar-type').textContent = info.type;
    const year = (d) => d && d.slice(0, 4);
    const facts = [
      ['Origine', info.beginArea && info.country && info.beginArea !== info.country ? `${fr(info.beginArea)}, ${fr(info.country)}` : fr(info.country || info.beginArea)],
      [info.type === 'Groupe' ? 'Formation' : 'Début', year(info.begin)],
      [info.type === 'Groupe' ? 'Séparation' : 'Fin', year(info.end)],
      ['Fans Deezer', info.fans && info.fans.toLocaleString('fr-FR')],
    ].filter((f) => f[1]);
    $('#facts').insertAdjacentHTML('beforeend', facts.map(([k, v]) => `<div class="fact"><small>${k}</small><b>${esc(v)}</b></div>`).join(''));
    if (info.wiki) $('#bio').textContent = firstSentence(info.wiki.extract);
  });
}

// ---------- Titres ----------
function viewTracks(_, filtered) {
  let sort = store.get('trackSort', { k: 'artist', d: 1 });
  const base = filtered || LIB.tracks;
  const get = { title: (t) => t.title, artist: (t) => t.artist, album: (t) => t.album, year: (t) => t.year || 0, duration: (t) => t.duration };
  const draw = () => {
    const list = [...base].sort((a, b) => {
      const x = get[sort.k](a), y = get[sort.k](b);
      const c = typeof x === 'number' ? x - y : x.localeCompare(y, 'fr');
      return (c || a.album.localeCompare(b.album) || a.disc - b.disc || a.trackNo - b.trackNo) * sort.d;
    });
    const ids = list.map((t) => t.id);
    const th = (k, l, cls = '') => `<th data-k="${k}" class="${cls}">${l}${sort.k === k ? (sort.d > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    const html = `<table class="songs"><colgroup><col style="width:38%"><col style="width:22%"><col style="width:26%"><col style="width:7%"><col style="width:7%"></colgroup>
      <thead><tr>${th('title', 'Titre')}${th('artist', 'Artiste')}${th('album', 'Album')}${th('year', 'Année', 'r')}${th('duration', 'Durée', 'r')}</tr></thead>
      <tbody>${list.map((t, n) => `<tr data-track="${t.id}" data-n="${n}" draggable="true" class="${player.current === t.id ? 'playing' : ''}">
        <td><div class="cell-title"><img loading="lazy" src="${cover(t.albumId)}" alt=""><span class="tt">${esc(showTitle(t.title))}</span>${t.hit ? STAR : ''}</div></td>
        <td><a href="#/artist/${t.artistId}">${esc(t.artist)}</a></td><td><a href="#/album/${t.albumId}">${esc(t.album)}</a></td>
        <td class="r">${t.year || ''}</td><td class="r">${fmtTime(t.duration)}</td></tr>`).join('')}</tbody></table>`;
    return { html, ids };
  };
  const render = () => {
    const { html, ids } = draw();
    const box = filtered ? $('#songs-box') : view;
    if (filtered) box.innerHTML = html;
    else view.innerHTML = `<div class="page"><div class="page-head"><h1>Titres</h1><span class="muted">${base.length} titres</span></div>${html}</div>`;
    const table = $('.songs', box);
    table.addEventListener('click', (e) => {
      const hd = e.target.closest('th'); if (hd) { sort = { k: hd.dataset.k, d: sort.k === hd.dataset.k ? -sort.d : 1 }; store.set('trackSort', sort); render(); return; }
      if (e.target.closest('a')) return;
      const tr = e.target.closest('tr[data-track]'); if (tr && e.detail !== 1) player.playList(ids, +tr.dataset.n); // double-clic, ou OK au clavier
    });
  };
  if (filtered) return render;
  render();
}

// ---------- Recherche ----------
function setSearch(q) {
  $('#search').value = q;
  history.replaceState(null, '', `#/search/${encodeURIComponent(q)}`);
  route();
}
// Page « Rechercher » : grandes tuiles illustrées (décennies, styles), comme dans Apple Music
const STYLES = [
  ['Rock', 'rock'], ['Metal', 'metal'], ['Hard rock', 'hard rock'], ['Pop', 'pop'], ['Blues', 'blues'], ['Rap & hip‑hop', 'rap'],
  ['Électro', 'electro'], ['Chanson française', 'chanson'], ['Soul', 'soul'], ['Piano & classique', 'piano'], ['Punk', 'punk'], ['Grunge', 'grunge'],
];
function browseHTML() {
  const idx = getIndex();
  const tile = (q, label, sub, covers, cls = '') => `<button class="tile ${cls}" data-chip="${esc(q)}" data-tint="${covers[0] || ''}">
      <span class="tile-label">${label}</span><span class="tile-sub">${sub}</span>
      <span class="tile-art">${covers.slice(0, 3).map((id, i) => `<img src="${cover(id)}" alt="" style="--i:${i}">`).join('')}</span></button>`;
  const decades = idx.decades.map((d) => {
    const albums = LIB.albums.filter((a) => a.year >= d && a.year < d + 10);
    const picks = []; for (const a of albums) if (!picks.some((x) => A.get(x).artistId === a.artistId)) picks.push(a.id); // artistes variés
    const label = d < 2000 ? `Années ${String(d).slice(2)}` : `Années ${d}`;
    return albums.length ? tile(label.toLowerCase(), label, `${albums.length} album${albums.length > 1 ? 's' : ''}`, picks.sort(() => 0.5 - Math.random())) : '';
  }).join('');
  const styles = STYLES.map(([label, q]) => {
    const r = runSearch(idx, q);
    return r.albums.length >= 2 ? { label, q, n: r.albums.length, covers: r.albums.slice(0, 3).map((a) => a.id) } : null;
  }).filter(Boolean).sort((a, b) => b.n - a.n).slice(0, 10)
    .map((x) => tile(x.q, x.label, `${x.n} albums`, x.covers, 'style')).join('');
  return `<section><h2>Décennies</h2><div class="tiles">${decades}</div></section>
    <section><h2>Styles</h2><div class="tiles">${styles}</div></section>`;
}
function tintTiles() {
  for (const t of $$('.tile[data-tint]', view)) if (t.dataset.tint) dominant(t.dataset.tint).then((c) => t.style.setProperty('--c', c.join(',')));
}
function viewSearch(q) {
  q = q || '';
  if ($('#search').value !== q && document.activeElement !== $('#search')) $('#search').value = q;
  if (!q.trim()) {
    view.innerHTML = `<div class="page search-page"><div class="page-head"><div><h1>Rechercher</h1>
      <p class="muted search-tip">Un artiste, un style, une année, une décennie… quelques lettres suffisent.</p></div>
      <button class="btn soft voice-cta" data-voice>${MIC} Recherche vocale</button></div>${browseHTML()}</div>`;
    tintTiles();
    return;
  }
  const r = runSearch(getIndex(), q);
  const facets = [r.labels.join(' · '), r.ignored.length ? `sans tenir compte de « ${r.ignored.join(' ')} »` : ''].filter(Boolean).map(esc).join(' — ');
  let top = '';
  if (r.top) {
    const it = r.top.item;
    top = r.top.kind === 'artist'
      ? `<div class="top-hit artist" data-artist="${it.id}" tabindex="0"><img src="/api/artist/${it.id}/picture" onerror="this.src='${cover(it.albums[it.albums.length - 1])}'" alt=""><div><small>Artiste</small><b>${esc(it.name)}</b><span>${it.albums.length} album${it.albums.length > 1 ? 's' : ''}</span></div></div>`
      : r.top.kind === 'album'
        ? `<div class="top-hit" data-album="${it.id}" tabindex="0"><img src="${cover(it.id)}" alt=""><div><small>Album</small><b>${esc(it.title)}</b><span>${esc(it.artist)}${it.year ? ' · ' + it.year : ''}</span></div></div>`
        : '';
  }
  const nothing = !r.artists.length && !r.albums.length && !r.tracks.length;
  view.innerHTML = `<div class="page">
    <div class="search-head"><h1>${nothing ? 'Aucun résultat' : 'Résultats'}</h1><span class="muted">« ${esc(q)} »</span></div>
    ${facets ? `<p class="search-sub">${facets}</p>` : ''}
    ${top ? `<h2>Meilleur résultat</h2>${top}` : ''}
    ${r.artists.length ? `<h2>Artistes</h2><div class="artist-grid">${r.artists.slice(0, 24).map(artistCard).join('')}</div>` : ''}
    ${r.albums.length ? `<h2>Albums <span class="muted" style="font-size:14px;font-weight:400">${r.albums.length}</span></h2><div class="grid">${r.albums.map(albumCard).join('')}</div>` : ''}
    ${r.tracks.length ? `<h2>Titres <span class="muted" style="font-size:14px;font-weight:400">${r.tracks.length}</span></h2><div id="songs-box"></div>` : ''}
    ${nothing ? `<p class="muted">Essayez un autre mot, ou parcourez :</p>${browseHTML()}` : ''}</div>`;
  if (nothing) tintTiles();
  if (r.tracks.length) viewTracks(null, r.tracks.slice(0, 300))();
  onImgLoad(view);
  if (r.top) dominant(r.top.kind === 'album' ? r.top.item.id : r.top.item.albums?.at(-1) || r.top.item.albumId).then((c) => view.style.setProperty('--tint', c.join(',')));
  cleanup = hydrateAvatars(view);
  // « joue … » : lance directement le meilleur résultat
  if (r.play && pendingPlay) {
    pendingPlay = false;
    const it = r.top?.item;
    const ids = r.top?.kind === 'artist' ? it.albums.flatMap((x) => A.get(x).tracks) : r.top?.kind === 'album' ? it.tracks : r.tracks.map((t) => t.id);
    if (ids?.length) { player.playList(ids, r.top?.kind === 'artist' ? -1 : 0, { shuffle: r.top?.kind === 'artist' }); toast(`Lecture : ${it?.name || it?.title || q}`); }
  }
}
let pendingPlay = false;
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = e.target.value.trim();
    history.replaceState(null, '', `#/search/${encodeURIComponent(q)}`); route();
  }, 160);
});
$('#search').addEventListener('focus', () => { if (!location.hash.startsWith('#/search')) { history.pushState(null, '', '#/search/'); nav.remember(currentHash); route(); } });
$('#search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); pendingPlay = /^(joue|lance|mets|ecoute|écoute)\b/i.test(e.target.value.trim()); if (pendingPlay) route(); const first = $('#view [tabindex="0"], #view [data-album], #view [data-artist], #view button'); first && nav.focusEl(first); }
  if (e.key === 'ArrowDown') { e.preventDefault(); nav.defaultFocus(); }
});

// ---------- Commande vocale ----------
const MIC = '<svg viewBox="0 0 24 24" width="15" height="15"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v3.5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
let voiceReady = false, voiceCtl = null;
voiceAvailable().then((ok) => { voiceReady = ok; $('#mic').classList.toggle('off', !ok); if (!ok) $('#mic').title = 'Recherche vocale : à installer (npm run install-voice)'; });
async function startVoice() {
  if (voiceCtl) return;
  if (!voiceReady) { toast('Recherche vocale non installée : lancez « npm run install-voice » dans ~/AppMusic'); return; }
  const box = $('#voice'), state = $('#voice-state'), orb = $('#voice-orb');
  box.classList.add('open'); box.classList.remove('thinking'); box.setAttribute('aria-hidden', 'false');
  state.textContent = 'Je vous écoute…'; $('#voice-hint').style.visibility = '';
  nav.focusEl($('#voice-cancel'));
  voiceCtl = new AbortController();
  try {
    const text = await listen({
      signal: voiceCtl.signal,
      onLevel: (l) => orb.style.setProperty('--l', l.toFixed(2)),
      onState: (s) => { if (s === 'thinking') { box.classList.add('thinking'); state.textContent = 'Un instant…'; orb.style.setProperty('--l', 0); } },
    });
    if (!text) throw new Error('Je n’ai pas compris');
    state.textContent = `« ${text} »`; $('#voice-hint').style.visibility = 'hidden';
    await new Promise((r) => setTimeout(r, 650));
    stopVoice();
    const intent = voiceIntent(text);
    pendingPlay = intent.play;
    setSearch(intent.q);
  } catch (err) {
    if (err.name === 'AbortError') return stopVoice();
    box.classList.remove('thinking');
    state.textContent = err.message === 'not-installed' ? 'Recherche vocale non installée' : err.name === 'NotAllowedError' ? 'Micro non autorisé' : err.message;
    setTimeout(stopVoice, 1800);
  } finally { voiceCtl = null; }
}
// « joue Renaud » est parfois entendu « jo Renaud » : on reconnaît l'intention de lecture avec tolérance,
// sauf si le début de la phrase est un vrai nom d'artiste (« Joe Bonamassa »).
function voiceIntent(text) {
  const t = text.trim();
  const strict = /^(jou(e|es|ez|er)|lance[rz]?|mets|mettre|met|[ée]coute[rz]?|play)\s+/i;
  if (strict.test(t)) return { play: true, q: 'joue ' + t.replace(strict, '') };
  const loose = /^(jo|joe|jou|joué|jouet|joues)\s+/i;
  if (loose.test(t)) {
    const n = norm(t).split(/\s+/).slice(0, 2).join(' ');
    if (!LIB.artists.some((a) => norm(a.name).startsWith(n))) return { play: true, q: 'joue ' + t.replace(loose, '') };
  }
  return { play: false, q: t };
}
function stopVoice() { voiceCtl?.abort(); voiceCtl = null; const box = $('#voice'); box.classList.remove('open', 'thinking'); box.setAttribute('aria-hidden', 'true'); }
$('#mic').addEventListener('click', (e) => { e.preventDefault(); startVoice(); });
$('#voice-cancel').onclick = stopVoice;
view.addEventListener('click', (e) => { if (e.target.closest('[data-voice]')) startVoice(); });

// Depuis une grille : la pochette cliquée se transforme en grande pochette de la page album
function openFromCard(card) {
  const id = card.dataset.album;
  const img = card.querySelector('.tilt') || card.querySelector('img');
  if (!document.startViewTransition || !img || matchMedia('(prefers-reduced-motion: reduce)').matches) { location.hash = `#/album/${id}`; return; }
  img.style.viewTransitionName = 'album-cover';
  arriving = null;
  const vt = document.startViewTransition(() => {
    img.style.viewTransitionName = '';
    nav.remember(currentHash);
    history.pushState(null, '', `#/album/${id}`);
    route();
    const hero = $('.hero-cover .tilt'); if (hero) hero.style.viewTransitionName = 'album-cover';
  });
  vt.finished.finally(() => { const hero = $('.hero-cover .tilt'); if (hero) hero.style.viewTransitionName = ''; });
}

// ---------- Clics globaux dans les vues ----------
view.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-chip]'); if (chip) { setSearch(chip.dataset.chip); return; }
  const mixPlay = e.target.closest('[data-play-mix]');
  if (mixPlay) { e.stopPropagation(); const m = mixes().get(mixPlay.dataset.playMix); if (m) player.playList(m.ids, -1, { shuffle: true }); return; }
  const mixCard = e.target.closest('[data-mix]'); if (mixCard) { location.hash = `#/selection/${mixCard.dataset.mix}`; return; }
  const playBtn = e.target.closest('[data-play-album]');
  if (playBtn) { e.stopPropagation(); player.playList(A.get(playBtn.dataset.playAlbum).tracks, 0); return; }
  const card = e.target.closest('[data-album]:not([data-disc])'); if (card) { openFromCard(card); return; }
  const art = e.target.closest('[data-artist]'); if (art) { location.hash = `#/artist/${art.dataset.artist}`; return; }
  const tr = e.target.closest('.tracklist .tr');
  if (tr) { const ids = $$('.tr', tr.closest('tbody')).map((x) => x.dataset.track); player.playList(ids, ids.indexOf(tr.dataset.track)); }
});
attachTilt(view);

// ---------- Lecteur ----------
const audio = new Audio();
audio.preload = 'auto';
const player = {
  queue: [], order: [], pos: -1, current: null,
  shuffle: store.get('shuffle', false), repeat: store.get('repeat', 'off'),
  playList(ids, start = 0, opts = {}) {
    if (!ids.length) return;
    if (opts.shuffle !== undefined) this.shuffle = opts.shuffle;
    this.queue = [...ids];
    const first = start < 0 ? Math.floor(Math.random() * ids.length) : start;
    this.order = this.queue.map((_, i) => i);
    if (this.shuffle) { this.order.splice(first, 1); shuffleArr(this.order); this.order.unshift(first); this.pos = 0; } else this.pos = first;
    this.load(true); syncButtons();
  },
  load(autoplay) {
    const id = this.queue[this.order[this.pos]]; if (!id) return;
    this.current = id; const t = T.get(id);
    audio.src = `/audio/${id}`;
    if (autoplay) audio.play().catch(() => {});
    updateNowPlaying(t);
    store.set('session', { queue: this.queue, order: this.order, pos: this.pos });
  },
  next(auto) {
    if (auto && this.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
    if (this.pos < this.order.length - 1) this.pos++;
    else if (this.repeat === 'all' || !auto) this.pos = 0;
    else { audio.pause(); return; }
    this.load(true);
  },
  prev() { if (audio.currentTime > 3 || this.pos === 0) { audio.currentTime = 0; return; } this.pos--; this.load(true); },
  toggle() { if (!this.current) { const a = LIB.albums[0]; if (a) this.playList(a.tracks); return; } audio.paused ? audio.play() : audio.pause(); },
  jump(i) { this.pos = i; this.load(true); },
  // Ajout et réorganisation de la file (positions = rangs dans l'ordre de lecture, toujours après le titre en cours)
  insert(ids, at) {
    if (!this.queue.length) return this.playList(ids, 0);
    const base = this.queue.length; this.queue.push(...ids);
    this.order.splice(at, 0, ...ids.map((_, k) => base + k)); this.settle();
  },
  // vide « Ensuite » en gardant le titre en cours
  clearUpcoming() { if (this.pos < 0) return; this.queue = [this.current]; this.order = [0]; this.pos = 0; this.settle(); },
  remove(i) { if (i <= this.pos || i >= this.order.length) return; this.order.splice(i, 1); this.settle(); },
  move(from, to) { const [x] = this.order.splice(from, 1); this.order.splice(to > from ? to - 1 : to, 0, x); this.settle(); },
  settle() {
    // hors aléatoire, la file reste dans l'ordre affiché (désactiver l'aléatoire plus tard ne défait pas les ajouts)
    if (!this.shuffle) { this.queue = this.order.map((i) => this.queue[i]); this.order = this.queue.map((_, i) => i); }
    store.set('session', { queue: this.queue, order: this.order, pos: this.pos });
    renderQueue();
  },
};
function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

audio.addEventListener('ended', () => player.next(true));
audio.addEventListener('play', () => { document.body.classList.add('is-playing'); $('#np').classList.add('is-playing'); document.body.classList.remove('paused'); });
audio.addEventListener('pause', () => { document.body.classList.remove('is-playing'); $('#np').classList.remove('is-playing'); document.body.classList.add('paused'); });
audio.addEventListener('error', () => { if (player.current) toast('Lecture impossible de ce fichier'); });
document.body.classList.add('paused');

function setSlider(el, v) { el.style.setProperty('--v', Math.max(0, Math.min(1, v))); }
let seeking = false;
audio.addEventListener('timeupdate', () => {
  if (seeking) return;
  const d = audio.duration || T.get(player.current)?.duration || 0;
  for (const [s, c, t] of [['#seek', '#t-cur', '#t-dur'], ['#np-seek', '#np-cur', '#np-dur']]) {
    setSlider($(s), d ? audio.currentTime / d : 0); $(c).textContent = fmtTime(audio.currentTime); $(t).textContent = '-' + fmtTime(d - audio.currentTime);
  }
  if ('setPositionState' in navigator.mediaSession && d) try { navigator.mediaSession.setPositionState({ duration: d, position: Math.min(audio.currentTime, d), playbackRate: 1 }); } catch {}
});
function bindSlider(el, onChange, onEnd) {
  const val = (e) => { const r = el.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  el.addEventListener('pointerdown', (e) => {
    el.setPointerCapture(e.pointerId); el.classList.add('drag'); onChange(val(e));
    const mv = (ev) => onChange(val(ev));
    const up = (ev) => { el.classList.remove('drag'); el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); onEnd?.(val(ev)); };
    el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
  });
}
for (const s of ['#seek', '#np-seek']) {
  bindSlider($(s), (v) => { seeking = true; setSlider($('#seek'), v); setSlider($('#np-seek'), v); const t = fmtTime(v * (audio.duration || 0)); $('#t-cur').textContent = $('#np-cur').textContent = t; },
    (v) => { if (audio.duration) audio.currentTime = v * audio.duration; seeking = false; });
}
audio.volume = store.get('volume', 0.8);
setSlider($('#volume'), audio.volume);
bindSlider($('#volume'), (v) => { audio.volume = v; setSlider($('#volume'), v); store.set('volume', v); });

$('#b-play').onclick = () => player.toggle();
$('#b-next').onclick = () => player.next(false);
$('#b-prev').onclick = () => player.prev();
$('#b-shuffle').onclick = () => {
  player.shuffle = !player.shuffle; store.set('shuffle', player.shuffle);
  if (player.queue.length) {
    const cur = player.order[player.pos];
    if (player.shuffle) { const rest = player.order.filter((i) => i !== cur); player.order = [cur, ...shuffleArr(rest)]; player.pos = 0; }
    else { player.order = player.queue.map((_, i) => i); player.pos = cur; }
  }
  syncButtons(); renderQueue();
};
$('#b-repeat').onclick = () => { player.repeat = { off: 'all', all: 'one', one: 'off' }[player.repeat]; store.set('repeat', player.repeat); syncButtons(); renderNext(); };
function syncButtons() {
  $('#b-shuffle').classList.toggle('on', player.shuffle);
  const r = $('#b-repeat'); r.classList.toggle('on', player.repeat !== 'off'); r.classList.toggle('one', player.repeat === 'one');
}
syncButtons();

let npBg = 0;
function updateNowPlaying(t) {
  const a = A.get(t.albumId);
  $('#p-cover').src = cover(t.albumId);
  document.body.classList.add('has-track');
  coverGradient(t.albumId).then(([c1, c2]) => { if (player.current !== t.id) return; const pl = $('#player'); pl.style.setProperty('--pc1', c1.join(' ')); pl.style.setProperty('--pc2', c2.join(' ')); });
  $('#p-title').textContent = t.title;
  $('#p-sub').textContent = `${t.artist} — ${t.album}`;
  const fmt = t.lossless && t.bits ? `Lossless · ${t.bits} bits/${(t.rate / 1000).toLocaleString('fr-FR')} kHz` : t.codec;
  $('#p-format').textContent = t.lossless ? 'Lossless' : '';
  $('#p-format').title = fmt;
  $('#np-img').src = cover(t.albumId);
  const bg = $$('.np-bg img')[npBg ^= 1]; bg.onload = () => { bg.classList.add('on'); $$('.np-bg img')[npBg ^ 1].classList.remove('on'); }; bg.src = cover(t.albumId);
  $('#np-title').textContent = t.title;
  $('#np-artist').textContent = t.artist; $('#np-artist').href = `#/artist/${t.artistId}`;
  $('#np-album').textContent = `${t.album}${t.year ? ' · ' + t.year : ''}`;
  $('#np-format').textContent = fmt;
  document.title = `${t.title} — ${t.artist}`;
  $$('[data-track]').forEach((el) => el.classList.toggle('playing', el.dataset.track === t.id));
  $$('.hero-disc').forEach((d) => d.classList.toggle('playing', d.dataset.album === t.albumId));
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: a?.title || t.album, artwork: [{ src: location.origin + cover(t.albumId), sizes: '1000x1000', type: 'image/jpeg' }] });
  }
  renderQueue();
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => audio.play());
  ms.setActionHandler('pause', () => audio.pause());
  ms.setActionHandler('previoustrack', () => player.prev());
  ms.setActionHandler('nexttrack', () => player.next(false));
  try { ms.setActionHandler('seekto', (d) => { audio.currentTime = d.seekTime; }); } catch {}
}

// File d'attente
// carte « Ensuite » du lecteur : le prochain titre de la file
function renderNext() {
  const nextPos = player.pos + 1 < player.order.length ? player.pos + 1 : player.repeat === 'all' && player.order.length > 1 ? 0 : -1;
  const t = nextPos >= 0 ? T.get(player.queue[player.order[nextPos]]) : null;
  $('#p-next').classList.toggle('is-end', !t);
  $('#p-next-title').textContent = t ? t.title : player.queue.length ? 'Fin de la file' : 'Rien en attente';
  $('#p-next-title').title = t ? `${t.title} — ${t.artist}` : '';
  const img = $('#p-next-cover'); if (t) img.src = cover(t.albumId); else img.removeAttribute('src');
}
function renderQueue() {
  renderNext();
  const box = $('#queue-list'); if (!player.queue.length) { $('#q-clear').hidden = true; box.innerHTML = '<div class="empty">Rien en attente.<br><small>Glissez des titres ou des albums ici.</small></div>'; return; }
  const item = (i) => { const t = T.get(player.queue[player.order[i]]); return `<div class="q-item ${i === player.pos ? 'current' : ''}" data-q="${i}" tabindex="0"${i > player.pos ? ' draggable="true"' : ''}><img loading="lazy" src="${cover(t.albumId)}" alt=""><div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div>${i > player.pos ? `<button class="q-remove" data-remove="${i}" title="Retirer de la file (Suppr)" aria-label="Retirer de la file"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>` : ''}</div>`; };
  const upcoming = player.order.slice(player.pos + 1, player.pos + 101).map((_, k) => item(player.pos + 1 + k)).join('');
  $('#q-clear').hidden = player.pos >= player.order.length - 1;
  const top = box.scrollTop;
  box.innerHTML = `<div class="q-label">En cours</div>${item(player.pos)}<div class="q-label">Ensuite${player.shuffle ? ' · aléatoire' : ''}</div>${upcoming || '<div class="empty" style="padding:20px">Fin de la file</div>'}`;
  box.scrollTop = top;
}

// Glisser-déposer vers « À suivre » : titres, albums entiers, et réorganisation de la file
let drag = null;
document.addEventListener('dragstart', (e) => {
  const q = e.target.closest?.('#queue-list .q-item[draggable]');
  const tr = !q && e.target.closest?.('tr[data-track]');
  const card = !q && !tr && (e.target.closest?.('[data-album]') || e.target.closest?.('.hero-cover')?.querySelector('[data-album]'));
  if (!q && !tr && !card) return;
  const ids = q ? [player.queue[player.order[+q.dataset.q]]] : tr ? [tr.dataset.track] : A.get(card.dataset.album)?.tracks || [];
  if (!ids.length) return;
  const t = T.get(ids[0]), al = card && A.get(card.dataset.album);
  drag = { ids, from: q ? +q.dataset.q : null, opened: false, dropped: false };
  e.dataTransfer.effectAllowed = q ? 'move' : 'copy';
  e.dataTransfer.setData('text/plain', al ? `${al.title} — ${al.artist}` : `${t.title} — ${t.artist}`);
  // vignette qui suit le pointeur
  const ghost = document.createElement('div'); ghost.className = 'drag-ghost';
  ghost.innerHTML = `<img src="${cover(t.albumId)}" alt=""><div><b>${esc(al ? al.title : showTitle(t.title))}</b><span>${esc(al ? `${al.tracks.length} titres` : t.artist)}</span></div>`;
  document.body.append(ghost); e.dataTransfer.setDragImage(ghost, 24, 24); setTimeout(() => ghost.remove());
  if (q) q.classList.add('dragging');
  document.body.classList.add('dragging-music');
  if (!$('#queue').classList.contains('open')) { drag.opened = true; setTimeout(() => $('#b-queue').click()); }
});
document.addEventListener('dragend', () => {
  if (!drag) return;
  if (drag.opened && !drag.dropped) $('#q-close').click();
  drag = null; clearDrop(); document.body.classList.remove('dragging-music');
  $$('#queue-list .dragging').forEach((el) => el.classList.remove('dragging'));
});
function clearDrop() { $$('#queue-list .drop-before').forEach((el) => el.classList.remove('drop-before')); $('#queue-list').classList.remove('drop-end'); $('#queue').classList.remove('drop-over'); }
// rang d'insertion sous le pointeur (jamais avant le titre en cours)
function dropIndex(y) {
  const items = $$('#queue-list .q-item').filter((el) => +el.dataset.q > player.pos);
  const hit = items.find((el) => { const r = el.getBoundingClientRect(); return y < r.top + r.height / 2; });
  return { at: hit ? +hit.dataset.q : player.pos + 1 + items.length, el: hit };
}
const qPanel = $('#queue');
qPanel.addEventListener('dragover', (e) => {
  if (!drag) return; e.preventDefault();
  e.dataTransfer.dropEffect = drag.from === null ? 'copy' : 'move';
  const { el } = dropIndex(e.clientY); clearDrop(); qPanel.classList.add('drop-over');
  if (!player.queue.length) return;
  if (el) el.classList.add('drop-before'); else $('#queue-list').classList.add('drop-end');
});
qPanel.addEventListener('dragleave', (e) => { if (!qPanel.contains(e.relatedTarget)) clearDrop(); });
qPanel.addEventListener('drop', (e) => {
  if (!drag) return; e.preventDefault();
  const { at } = dropIndex(e.clientY); drag.dropped = true; clearDrop();
  if (drag.from !== null) return player.move(drag.from, at);
  const n = drag.ids.length; player.insert(drag.ids, at);
  toast(n > 1 ? `${n} titres ajoutés à la file` : 'Ajouté à la file');
});
$('#queue-list').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]'); if (rm) { e.stopPropagation(); return removeFromQueue(+rm.dataset.remove); }
  const q = e.target.closest('[data-q]'); if (q) player.jump(+q.dataset.q);
});
// retire un titre à venir ; au clavier, le focus passe au titre suivant (ou précédent en fin de file)
function removeFromQueue(i) {
  const hadFocus = document.activeElement?.closest?.('#queue-list');
  player.remove(i);
  if (hadFocus || nav.usingKeys) { const next = $(`#queue-list .q-item[data-q="${i}"]`) || $(`#queue-list .q-item[data-q="${i - 1}"]`); if (next) nav.focusEl(next); }
}
$('#b-queue').onclick = () => { const open = $('#queue').classList.toggle('open'); $('#b-queue').classList.toggle('on'); if (open && nav.usingKeys) setTimeout(() => { nav.makeFocusable($('#queue')); nav.focusEl($('#queue .q-item.current') || $('#q-close')); }, 50); };
$('#q-clear').onclick = () => player.clearUpcoming();
$('#p-next').onclick = (e) => { if (!e.target.closest('#b-queue')) $('#b-queue').click(); };
$('#q-close').onclick = () => { $('#queue').classList.remove('open'); $('#b-queue').classList.remove('on'); };

// Plein écran « À l'écoute »
const np = $('#np');
const openNP = () => { if (!player.current) return; np.classList.add('open'); np.setAttribute('aria-hidden', 'false'); setTimeout(() => nav.focusEl($('#np [data-act="toggle"]')), 50); };
const closeNP = () => { np.classList.remove('open'); np.setAttribute('aria-hidden', 'true'); };
$('#p-now').onclick = openNP;
$('#np-close').onclick = closeNP;
$('#np-artist').addEventListener('click', closeNP);
np.addEventListener('click', (e) => { const act = e.target.closest('[data-act]')?.dataset.act; if (act === 'prev') player.prev(); if (act === 'next') player.next(false); if (act === 'toggle') player.toggle(); });
np.addEventListener('pointermove', (e) => {
  if (!np.classList.contains('is-playing')) return;
  const c = $('#np-cover'), r = c.getBoundingClientRect();
  const px = (e.clientX - (r.left + r.width / 2)) / innerWidth, py = (e.clientY - (r.top + r.height / 2)) / innerHeight;
  c.style.transform = `rotateY(${px * 22}deg) rotateX(${-py * 22}deg)`;
  c.style.setProperty('--gx', 50 + px * 120 + '%'); c.style.setProperty('--gy', 50 + py * 120 + '%');
});

// ---------- Clavier et télécommande ----------
// Flèches : se déplacer · OK/Entrée : valider · Retour/Échap : revenir · Espace/⏯ : lecture/pause
// Lettres : commencer une recherche · Ctrl+M : recherche vocale
const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
function goBack() {
  if ($('#voice').classList.contains('open')) return stopVoice();
  if ($('#queue').classList.contains('open')) { $('#q-close').click(); return nav.focusEl($('#b-queue')); }
  if (np.classList.contains('open')) { closeNP(); return nav.focusEl($('#p-now')); }
  if (/^#\/?(album|artist|search)/.test(location.hash) && history.length > 1) return history.back();
}
function adjustSlider(el, dir) {
  const step = dir === 'right' ? 1 : -1;
  if (el.id === 'volume') { const v = Math.max(0, Math.min(1, audio.volume + step * 0.05)); audio.volume = v; setSlider(el, v); store.set('volume', v); }
  else if (audio.duration) audio.currentTime = Math.max(0, Math.min(audio.duration - 1, audio.currentTime + step * 10));
}
window.addEventListener('keydown', (e) => {
  const inInput = e.target.matches('input, textarea');
  const k = e.key;
  // touches multimédia (télécommandes, claviers)
  if (k === 'MediaPlayPause') { e.preventDefault(); return player.toggle(); }
  if (k === 'MediaTrackNext') return player.next(false);
  if (k === 'MediaTrackPrevious') return player.prev();
  if (k === 'MediaStop') return audio.pause();
  if (e.ctrlKey && k.toLowerCase() === 'm') { e.preventDefault(); return startVoice(); }
  if ((e.metaKey || e.ctrlKey) && k === 'f') { e.preventDefault(); return $('#search').focus(); }
  if ((e.metaKey || e.ctrlKey) && k === 'ArrowRight') return player.next(false);
  if ((e.metaKey || e.ctrlKey) && k === 'ArrowLeft') return player.prev();
  if (inInput) {
    if (k === 'Escape') { e.preventDefault(); if (e.target.value) { e.target.value = ''; e.target.dispatchEvent(new Event('input')); } else { e.target.blur(); nav.defaultFocus(); } }
    if (k === 'ArrowUp' || (k === 'ArrowLeft' && e.target.selectionStart === 0 && !e.target.value)) { e.preventDefault(); nav.move(k === 'ArrowUp' ? 'up' : 'left'); }
    return;
  }
  // Suppr (ou retour arrière) sur un titre à venir de « À suivre » : le retirer de la file
  const qItem = document.activeElement?.closest?.('#queue-list .q-item[draggable]');
  if (qItem && (k === 'Delete' || k === 'Backspace')) { e.preventDefault(); return removeFromQueue(+qItem.dataset.q); }
  if (k === 'Escape' || k === 'Backspace' || k === 'BrowserBack' || k === 'GoBack') { e.preventDefault(); return goBack(); }
  if (e.code === 'Space') { e.preventDefault(); return player.toggle(); }
  if (ARROWS[k]) {
    e.preventDefault();
    const a = document.activeElement;
    if (a?.matches('.slider') && (k === 'ArrowLeft' || k === 'ArrowRight')) return adjustSlider(a, ARROWS[k]);
    return nav.move(ARROWS[k]);
  }
  if (k === 'Enter') {
    const a = document.activeElement;
    if (a && a !== document.body && !a.matches('button, a')) { e.preventDefault(); a.click(); }
    return;
  }
  // une lettre ou un chiffre tapé n'importe où commence une recherche
  if (k.length === 1 && /[\p{L}\p{N}]/u.test(k) && !e.metaKey && !e.ctrlKey && !e.altKey && !nav.topOverlay()) {
    e.preventDefault();
    const input = $('#search'); input.focus(); input.value = k; input.dispatchEvent(new Event('input'));
  }
});

$('#rescan').onclick = async () => {
  $('#rescan').classList.add('spin');
  await fetch('/api/rescan', { method: 'POST' });
  toast('Actualisation de la bibliothèque…');
  const poll = setInterval(async () => { const r = await loadLibrary(); if (!r.scanning) { clearInterval(poll); $('#rescan').classList.remove('spin'); toast('Bibliothèque à jour'); route(); } }, 1500);
};

// Nouveaux albums détectés pendant que la page est ouverte
setInterval(async () => {
  try {
    const st = await fetch('/api/status').then((r) => r.json());
    const before = LIB.albums.length;
    if (st.scannedAt !== LIB.scannedAt && !st.scanning) {
      await loadLibrary();
      const added = LIB.albums.length - before;
      if (added > 0) toast(added > 1 ? `${added} nouveaux albums ajoutés` : 'Nouvel album ajouté');
      if (!/^#\/?(album|artist)\//.test(location.hash) && !document.querySelector('.flow')) route();
    } else if (JSON.stringify(st.meta) !== JSON.stringify(LIB.meta)) { LIB.meta = st.meta; $('#lib-meta').lastElementChild.lastElementChild.innerHTML = metaState(st.meta); }
  } catch {}
}, 10000);

liquidGlass($('#player'));

// ---------- Premier lancement : choix du dossier de musique ----------
const LOGO = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="12" cy="12" r="1.8" fill="currentColor"/></svg>';
const FOLDER = '<svg viewBox="0 0 24 24"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.4l2 2h8.6A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="currentColor"/></svg>';
const DISK = '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="10" rx="2.5" fill="currentColor"/><circle cx="17" cy="12" r="1.2" fill="#000" opacity=".5"/></svg>';
function showSetup({ change = false } = {}) {
  return new Promise((done) => {
    const box = $('#setup');
    const close = () => { box.classList.remove('open'); box.setAttribute('aria-hidden', 'true'); setTimeout(() => { box.innerHTML = ''; }, 500); done(); };
    box.innerHTML = `<div class="setup-panel">
      <div class="setup-logo">${LOGO}</div>
      <h1>${change ? 'Dossier de musique' : 'Bienvenue dans App Music'}</h1>
      <p class="setup-lead">${change ? 'Choisissez un autre dossier à lire.' : 'Pour commencer, indiquez le dossier qui contient votre musique (FLAC, MP3, M4A…).'}
        Vos fichiers ne seront ni modifiés ni déplacés&nbsp;: App Music se contente de les lire.</p>
      <div class="setup-step" id="setup-choose">
        <button class="btn primary setup-pick" id="setup-pick">${FOLDER} Choisir un dossier…</button>
        <div class="setup-or"><span>ou saisissez son chemin</span></div>
        <form class="setup-path" id="setup-form"><input id="setup-input" spellcheck="false" autocomplete="off" placeholder="~/Musique"><button class="btn soft" type="submit">Valider</button></form>
        <div class="setup-error" id="setup-error"></div>
        <div class="setup-sugg"><div class="setup-sugg-title">Dossiers contenant de la musique sur ce Mac</div><div id="setup-list" class="setup-list"><div class="setup-searching">Recherche…</div></div></div>
        ${change ? '<button class="link-btn setup-cancel" id="setup-cancel">Annuler</button>' : ''}
      </div>
      <div class="setup-step hidden" id="setup-progress">
        <div class="setup-bar"><i id="setup-bar"></i></div>
        <p class="setup-status" id="setup-status">Lecture des fichiers…</p>
      </div>
    </div>`;
    box.classList.add('open'); box.setAttribute('aria-hidden', 'false');
    const err = (m) => { $('#setup-error').textContent = m || ''; };
    const busy = (on) => $$('#setup-choose button, #setup-input').forEach((b) => (b.disabled = on));
    async function choose(dir) {
      if (!dir) return;
      err(''); busy(true);
      $('#setup-input').value = dir;
      const r = await fetch('/api/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ musicDir: dir }) }).then((x) => x.json()).catch(() => ({ error: 'Serveur injoignable.' }));
      busy(false);
      if (r.error) return err(r.error);
      // Indexation : barre de progression jusqu'à ce que la bibliothèque soit prête
      $('#setup-choose').classList.add('hidden'); $('#setup-progress').classList.remove('hidden');
      $('.setup-lead').textContent = `${r.audio.toLocaleString('fr-FR')} morceaux trouvés dans ${r.label}.`;
      await new Promise((s) => setTimeout(s, 400));
      for (;;) {
        const st = await fetch('/api/status').then((x) => x.json()).catch(() => null);
        if (st?.scanning) {
          const { done: d, total } = st.scanProgress;
          $('#setup-bar').style.width = `${total ? Math.round((d / total) * 100) : 5}%`;
          $('#setup-status').textContent = d < total ? `Lecture des fichiers… ${d.toLocaleString('fr-FR')} / ${total.toLocaleString('fr-FR')}` : 'Préparation des pochettes…';
        } else if (st && !st.needsSetup) {
          $('#setup-bar').style.width = '100%';
          $('#setup-status').textContent = `Prêt : ${st.albums.toLocaleString('fr-FR')} albums.`;
          await new Promise((s) => setTimeout(s, 700));
          return close();
        }
        await new Promise((s) => setTimeout(s, 600));
      }
    }
    $('#setup-pick').onclick = async () => {
      err(''); $('#setup-pick').classList.add('waiting');
      const r = await fetch('/api/setup/pick', { method: 'POST' }).then((x) => x.json()).catch(() => ({}));
      $('#setup-pick').classList.remove('waiting');
      if (r.path) choose(r.path);
    };
    $('#setup-form').onsubmit = (e) => { e.preventDefault(); choose($('#setup-input').value.trim()); };
    $('#setup-cancel')?.addEventListener('click', close);
    box.onkeydown = (e) => { if (e.key === 'Escape' && change) { e.stopPropagation(); close(); } };
    fetch('/api/setup').then((x) => x.json()).then((st) => {
      if (st.label && change) $('#setup-input').value = st.label;
      $('#setup-list').innerHTML = st.candidates.length
        ? st.candidates.map((c) => `<button class="setup-cand" data-path="${esc(c.path)}"><span class="ic">${c.volume ? DISK : FOLDER}</span><span class="name">${esc(c.label)}</span><span class="count">${c.partial ? 'plus de ' : ''}${c.audio.toLocaleString('fr-FR')} morceaux</span></button>`).join('')
        : '<div class="setup-searching">Aucun dossier évident : choisissez-le ou saisissez son chemin.</div>';
      $$('.setup-cand').forEach((b) => (b.onclick = () => choose(b.dataset.path)));
      nav.focusEl($('#setup-pick'));
    });
  });
}
$('#lib-meta').addEventListener('click', async (e) => {
  if (!e.target.closest('[data-change-folder]')) return;
  await showSetup({ change: true });
  await loadLibrary(); route();
});

// ---------- Démarrage ----------
(async () => {
  let r = await loadLibrary();
  if (r.needsSetup) { await showSetup(); r = await loadLibrary(); }
  while (r.scanning && !r.albums.length) { view.innerHTML = `<div class="empty">Indexation de la musique… ${r.scanProgress.done}/${r.scanProgress.total}</div>`; await new Promise((s) => setTimeout(s, 1000)); r = await loadLibrary(); }
  const s = store.get('session');
  if (s?.queue?.every((id) => T.has(id))) { Object.assign(player, { queue: s.queue, order: s.order, pos: s.pos }); player.load(false); }
  route();
})();
