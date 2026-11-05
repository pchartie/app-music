// Discothèque — interface
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
};

let LIB = { albums: [], artists: [], tracks: [] };
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
  T.clear(); A.clear(); R.clear();
  r.tracks.forEach((t) => T.set(t.id, t));
  r.albums.forEach((a) => A.set(a.id, a));
  r.artists.forEach((a) => R.set(a.id, a));
  const total = r.albums.reduce((s, a) => s + a.duration, 0);
  const n = (x) => x.toLocaleString('fr-FR');
  $('#stats').innerHTML = [[r.albums.length, 'albums'], [r.artists.length, 'artistes'], [r.tracks.length, 'titres'], [Math.round(total / 3600) + ' h', 'd’écoute']]
    .map(([v, l]) => `<div><b>${typeof v === 'number' ? n(v) : v}</b><span>${l}</span></div>`).join('');
  const lossless = r.tracks.length && r.tracks.every((t) => t.lossless) ? 'FLAC sans perte' : 'Mixte';
  const when = r.scanning ? `Indexation ${r.scanProgress.done}/${r.scanProgress.total}` : r.scannedAt ? new Date(r.scannedAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  $('#lib-meta').innerHTML = `<div><span>Taille</span><span>${(r.bytes / 1e9).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Go</span></div>
    <div><span>Qualité</span><span>${lossless}</span></div><div><span>Dossier</span><span>${esc(r.folder || '')}</span></div><div><span>Mise à jour</span><span>${when}</span></div>
    <div><span>Infos</span><span>${metaState(r.meta)}</span></div>`;
  return r;
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

const albumCard = (a) => `
  <div class="card tilt-host" data-album="${a.id}">
    <div class="tilt"><img data-fade loading="lazy" src="${cover(a.id)}" alt=""><div class="glare"></div>
      <button class="card-play" data-play-album="${a.id}" title="Lire">${ICON.play}</button></div>
    <div class="card-title">${esc(a.title)}</div>
    <div class="card-sub">${esc(a.artist)}${a.year ? ' · ' + a.year : ''}</div>
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
function route() {
  const h = location.hash.replace(/^#\/?/, '') || store.get('lastView', 'flow');
  const [name, arg] = h.split('/');
  if (cleanup) { cleanup(); cleanup = null; }
  $$('nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name || (name === 'album' && a.dataset.nav === 'albums') || (name === 'artist' && a.dataset.nav === 'artists')));
  view.classList.remove('view-enter'); void view.offsetWidth; view.classList.add('view-enter');
  view.scrollTop = 0;
  if (['flow', 'albums', 'artists', 'tracks'].includes(name)) store.set('lastView', name);
  ({ flow: viewFlow, albums: viewAlbums, album: viewAlbum, artists: viewArtists, artist: viewArtist, tracks: viewTracks, search: viewSearch }[name] || viewFlow)(arg && decodeURIComponent(arg));
}
window.addEventListener('hashchange', route);

// ---------- Cover Flow (boîtiers de CD en 3D) ----------
function viewFlow(startId) {
  const albums = LIB.albums;
  if (!albums.length) { view.innerHTML = '<div class="empty">Aucun album pour le moment.</div>'; return; }
  let cur = albums.findIndex((a) => a.id === (startId || store.get('flowAlbum')));
  if (cur < 0) cur = Math.floor(Math.random() * albums.length);
  view.innerHTML = `
    <div class="flow">
      <div class="flow-bg"><img alt=""><img alt=""></div>
      <div class="flow-stage" id="stage"></div>
      <div class="flow-caption"><div class="t"></div><div class="a"></div>
        <div class="flow-actions"><button class="btn glass primary" data-act="play">${ICON.play} Lecture</button><button class="btn glass" data-act="open">Ouvrir l'album</button></div>
      </div>
      <div class="flow-scrub"><input type="range" min="0" max="${albums.length - 1}" step="1" value="${cur}"></div>
    </div>`;
  const stage = $('#stage'), cap = $('.flow-caption'), scrub = $('.flow-scrub input');
  const bgs = $$('.flow-bg img'); let bgi = 0;
  const items = albums.map((a, i) => {
    const el = document.createElement('div');
    el.className = 'cf-item'; el.dataset.i = i;
    el.innerHTML = `<div class="cf-box">
        <div class="cf-shadow"></div>
        <div class="f front"><div class="hinge"></div><img draggable="false" src="${cover(a.id)}" loading="lazy" alt=""><div class="gloss"></div><div class="cf-shade"></div></div>
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
  const openAlbum = (i) => { location.hash = `#/album/${albums[i].id}`; };
  let capTimer;
  function updateCaption() {
    const a = albums[cur];
    scrub.value = cur; store.set('flowAlbum', a.id);
    $('.t', cap).textContent = a.title;
    $('.a', cap).innerHTML = `<a href="#/artist/${a.artistId}">${esc(a.artist)}</a>${a.year ? ' · ' + a.year : ''}`;
    clearTimeout(capTimer);
    capTimer = setTimeout(() => { const img = bgs[bgi ^= 1]; img.onload = () => { img.classList.add('on'); bgs[bgi ^ 1].classList.remove('on'); }; img.src = cover(a.id); }, 160);
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
    if (act === 'open') location.hash = `#/album/${a.id}`;
  });
  const onKey = (e) => {
    if (e.target.matches('input:not([type=range])')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); go(Math.round(target) + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(Math.round(target) - 1); }
    if (e.key === 'Enter') openAlbum(cur);
  };
  window.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(resize); ro.observe(stage);
  resize(); updateCaption();
  cleanup = () => { window.removeEventListener('keydown', onKey); ro.disconnect(); cancelAnimationFrame(raf); };
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
function trackRows(ids, { showArtist, albumArtist } = {}) {
  let disc = null; const multi = new Set(ids.map((id) => T.get(id).disc)).size > 1;
  return ids.map((id, n) => {
    const t = T.get(id); let head = '';
    if (multi && t.disc !== disc) { disc = t.disc; head = `<tr class="disc-head"><td colspan="3">Disque ${disc}</td></tr>`; }
    const feat = showArtist || (albumArtist && t.artist !== albumArtist);
    return `${head}<tr class="tr ${player.current === id ? 'playing' : ''}" data-track="${id}" data-n="${n}">
      <td><span class="num">${t.trackNo || n + 1}</span><span class="num-play">${ICON.play}</span>${ICON.eq}</td>
      <td><div class="tt">${esc(t.title)}</div>${feat ? `<div class="ta">${esc(t.artist)}</div>` : ''}</td>
      <td>${fmtTime(t.duration)}</td></tr>`;
  }).join('');
}

function viewAlbum(id) {
  const a = A.get(id); if (!a) return viewAlbums();
  const ar = R.get(a.artistId);
  const others = ar ? ar.albums.filter((x) => x !== id).map((x) => A.get(x)) : [];
  view.innerHTML = `
    <div class="album-hero">
      <div class="hero-cover tilt-host"><div class="tilt"><img data-fade src="${cover(a.id)}" alt=""><div class="glare"></div></div></div>
      <div class="hero-info">
        <div class="eyebrow">Album</div>
        <h1>${esc(a.title)}</h1>
        <a class="hero-artist" href="#/artist/${a.artistId}">${esc(a.artist)}</a>
        <div class="hero-facts">${[a.genre, a.year, `${a.tracks.length} titres`, fmtLong(a.duration)].filter(Boolean).map(esc).join(' · ')} <span class="badge">${esc(a.format)}</span></div>
        <div class="hero-actions"><button class="btn primary" data-act="play">${ICON.play} Lecture</button><button class="btn soft" data-act="shuffle">${ICON.shuffle} Aléatoire</button></div>
      </div>
    </div>
    <div class="album-body">
      <table class="tracklist"><tbody>${trackRows(a.tracks, { albumArtist: a.artist })}</tbody></table>
      <div class="about" id="about"><h3>À propos</h3><div class="skeleton" style="width:90%"></div><div class="skeleton"></div><div class="skeleton" style="width:70%"></div></div>
    </div>
    ${others.length ? `<div class="page" style="padding-top:0"><h2>Autres albums de ${esc(a.artist)}</h2><div class="shelf">${others.map(albumCard).join('')}</div></div>` : ''}`;
  onImgLoad(view);
  dominant(a.id).then((c) => view.style.setProperty('--tint', c.join(',')));
  $('.hero-actions').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'play') player.playList(a.tracks, 0, { shuffle: false });
    if (act === 'shuffle') player.playList(a.tracks, -1, { shuffle: true });
  });
  getInfo('album', a.id).then((info) => {
    const box = $('#about'); if (!box) return;
    const d = info.firstRelease; const date = d && (d.length === 10 ? new Date(d).toLocaleDateString('fr-FR', { year: 'numeric', month: 'long', day: 'numeric' }) : d.slice(0, 4));
    const facts = [['Première sortie', date], ['Label', info.label], ['Genres', info.genres?.join(', ')], ['Format', a.format], ['Durée', fmtLong(a.duration)]].filter((x) => x[1]);
    box.innerHTML = `<h3>À propos</h3>
      ${info.pending ? '<p class="muted">Infos pas encore téléchargées. Elles seront récupérées automatiquement dès que le Mac sera connecté à Internet.</p>' : info.wiki ? `<p>${esc(info.wiki.extract)}</p><a class="ext" href="${esc(info.wiki.url)}" target="_blank" rel="noopener">Lire la suite sur Wikipédia ↗</a>` : '<p>Aucune notice trouvée pour cet album.</p>'}
      <dl>${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  });
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
  view.innerHTML = `
    <div class="artist-hero"><img class="bgblur" src="${cover(last.id)}" alt=""><img class="bgimg" alt="">
      <div class="inner"><div><div class="eyebrow" style="color:rgba(255,255,255,.7)" id="ar-type">Artiste</div><h1>${esc(ar.name)}</h1></div>
        <div class="hero-actions" style="margin:0"><button class="btn glass primary" data-act="play">${ICON.play} Lecture</button><button class="btn glass" data-act="shuffle">${ICON.shuffle} Aléatoire</button></div></div></div>
    <div class="page" style="padding-top:8px">
      <div class="facts" id="facts">
        <div class="fact"><small>Dans la bibliothèque</small><b>${albums.length} album${albums.length > 1 ? 's' : ''} · ${allTracks.length} titres</b></div>
        <div class="fact"><small>Durée d'écoute</small><b>${fmtLong(total)}</b></div>
      </div>
      <h2>Discographie</h2>
      <div class="shelf">${albums.map(albumCard).join('')}</div>
      <div id="bio"><h2>Biographie</h2><div class="skeleton" style="max-width:800px"></div><div class="skeleton" style="max-width:700px"></div><div class="skeleton" style="max-width:760px"></div></div>
      <h2>Titres</h2>
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
    const tags = [...new Set([...(ar.genres || []), ...(info.tags || [])].map((t) => t.toLowerCase()))].slice(0, 8);
    $('#bio').innerHTML = `<h2>Biographie</h2>
      ${tags.length ? `<div class="chips" style="margin-bottom:14px">${tags.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}
      ${info.pending ? '<p class="muted">Infos pas encore téléchargées. Elles seront récupérées automatiquement dès que le Mac sera connecté à Internet.</p>' : info.wiki ? `<p class="bio">${esc(info.wiki.extract)}</p><a class="ext link-btn" href="${esc(info.wiki.url)}" target="_blank" rel="noopener">Lire la suite sur Wikipédia ↗</a>` : '<p class="bio">Aucune biographie trouvée.</p>'}`;
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
      <tbody>${list.map((t, n) => `<tr data-track="${t.id}" data-n="${n}" class="${player.current === t.id ? 'playing' : ''}">
        <td><div class="cell-title"><img loading="lazy" src="${cover(t.albumId)}" alt=""><span class="tt">${esc(t.title)}</span></div></td>
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
      const tr = e.target.closest('tr[data-track]'); if (tr && e.detail === 2) player.playList(ids, +tr.dataset.n);
    });
  };
  if (filtered) return render;
  render();
}

// ---------- Recherche ----------
function viewSearch(q) {
  q = q || ''; const n = norm(q).trim();
  if ($('#search').value !== q) $('#search').value = q;
  if (!n) { view.innerHTML = '<div class="page"><h1>Recherche</h1><p class="muted">Tapez un nom d’artiste, d’album ou de titre.</p></div>'; return; }
  const words = n.split(/\s+/);
  const match = (...f) => { const s = norm(f.join(' ')); return words.every((w) => s.includes(w)); };
  const artists = LIB.artists.filter((a) => match(a.name));
  const albums = LIB.albums.filter((a) => match(a.title, a.artist, a.year));
  const tracks = LIB.tracks.filter((t) => match(t.title, t.artist, t.album));
  view.innerHTML = `<div class="page"><h1>Résultats pour « ${esc(q)} »</h1>
    ${artists.length ? `<h2>Artistes</h2><div class="artist-grid">${artists.map(artistCard).join('')}</div>` : ''}
    ${albums.length ? `<h2>Albums</h2><div class="grid">${albums.map(albumCard).join('')}</div>` : ''}
    ${tracks.length ? `<h2>Titres <span class="muted" style="font-size:13px;font-weight:400">— double-clic pour lire</span></h2><div id="songs-box"></div>` : ''}
    ${!artists.length && !albums.length && !tracks.length ? '<div class="empty">Aucun résultat.</div>' : ''}</div>`;
  if (tracks.length) viewTracks(null, tracks.slice(0, 300))();
  onImgLoad(view);
  cleanup = hydrateAvatars(view);
}
let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    const q = e.target.value.trim();
    if (q) history.replaceState(null, '', `#/search/${encodeURIComponent(q)}`), route();
    else location.hash = '#/' + store.get('lastView', 'albums');
  }, 180);
});

// ---------- Clics globaux dans les vues ----------
view.addEventListener('click', (e) => {
  const playBtn = e.target.closest('[data-play-album]');
  if (playBtn) { e.stopPropagation(); player.playList(A.get(playBtn.dataset.playAlbum).tracks, 0); return; }
  const card = e.target.closest('[data-album]'); if (card) { location.hash = `#/album/${card.dataset.album}`; return; }
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
$('#b-repeat').onclick = () => { player.repeat = { off: 'all', all: 'one', one: 'off' }[player.repeat]; store.set('repeat', player.repeat); syncButtons(); };
function syncButtons() {
  $('#b-shuffle').classList.toggle('on', player.shuffle);
  const r = $('#b-repeat'); r.classList.toggle('on', player.repeat !== 'off'); r.classList.toggle('one', player.repeat === 'one');
}
syncButtons();

let npBg = 0;
function updateNowPlaying(t) {
  const a = A.get(t.albumId);
  $('#p-cover').src = cover(t.albumId);
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
function renderQueue() {
  const box = $('#queue-list'); if (!player.queue.length) { box.innerHTML = '<div class="empty">Rien en attente.</div>'; return; }
  const item = (i) => { const t = T.get(player.queue[player.order[i]]); return `<div class="q-item ${i === player.pos ? 'current' : ''}" data-q="${i}"><img loading="lazy" src="${cover(t.albumId)}" alt=""><div><b>${esc(t.title)}</b><span>${esc(t.artist)}</span></div></div>`; };
  const upcoming = player.order.slice(player.pos + 1, player.pos + 101).map((_, k) => item(player.pos + 1 + k)).join('');
  box.innerHTML = `<div class="q-label">En cours</div>${item(player.pos)}<div class="q-label">Ensuite${player.shuffle ? ' · aléatoire' : ''}</div>${upcoming || '<div class="empty" style="padding:20px">Fin de la file</div>'}`;
}
$('#queue-list').addEventListener('click', (e) => { const q = e.target.closest('[data-q]'); if (q) player.jump(+q.dataset.q); });
$('#b-queue').onclick = () => { $('#queue').classList.toggle('open'); $('#b-queue').classList.toggle('on'); };
$('#q-close').onclick = () => { $('#queue').classList.remove('open'); $('#b-queue').classList.remove('on'); };

// Plein écran « À l'écoute »
const np = $('#np');
const openNP = () => { if (!player.current) return; np.classList.add('open'); np.setAttribute('aria-hidden', 'false'); };
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

// Raccourcis clavier
window.addEventListener('keydown', (e) => {
  if (e.target.matches('input')) { if (e.key === 'Escape') e.target.blur(); return; }
  if (e.code === 'Space') { e.preventDefault(); player.toggle(); }
  if (e.key === 'Escape') { closeNP(); $('#queue').classList.remove('open'); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'f') { e.preventDefault(); $('#search').focus(); }
  if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowRight') player.next(false);
  if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowLeft') player.prev();
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

// ---------- Démarrage ----------
(async () => {
  let r = await loadLibrary();
  while (r.scanning && !r.albums.length) { view.innerHTML = `<div class="empty">Indexation de la musique… ${r.scanProgress.done}/${r.scanProgress.total}</div>`; await new Promise((s) => setTimeout(s, 1000)); r = await loadLibrary(); }
  const s = store.get('session');
  if (s?.queue?.every((id) => T.has(id))) { Object.assign(player, { queue: s.queue, order: s.order, pos: s.pos }); player.load(false); }
  route();
})();
