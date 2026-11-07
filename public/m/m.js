// App Music sur le téléphone : télécommande de l'ordinateur (la musique sort de l'ordinateur).
// Association par QR code (#pair=…), bibliothèque, recherche, sélections, lecture en cours et « À suivre ».
import { buildIndex, search as runSearch } from '../search.js';
import { buildMixes } from '../mixes.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (s) => { s = Math.max(0, Math.floor(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const fmtLong = (s) => { const m = Math.round(s / 60); return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}` : `${m} min`; };
const cover = (id) => `/cover/${id}.jpg`;
const store = { get(k, d) { try { const v = localStorage.getItem('am.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('am.' + k, JSON.stringify(v)); } catch {} } };
const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z" fill="currentColor"/></svg>';
const SHUFFLE = '<svg viewBox="0 0 24 24"><path d="M3 7h3.5c3.5 0 4.5 10 8 10H20M3 17h3.5c1.4 0 2.4-1.6 3.3-3.6M14.5 7H20M17.5 4 20.5 7l-3 3M17.5 14l3 3-3 3M11.3 9.4C12.2 8 13.1 7 14.5 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ADD = '<svg viewBox="0 0 24 24"><path d="M4 7h11M4 12h11M4 17h7M18 14v7M14.5 17.5h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const PLUS = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';
const STAR = '<span class="hit" title="Titre très connu">★</span>';

let LIB = { albums: [], artists: [], tracks: [] };
const T = new Map(), A = new Map(), R = new Map();
let index = null, mixCache = null;
let computer = 'l’ordinateur';
const mixes = () => (mixCache ||= buildMixes(LIB));

function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200); }

// ---------- Association ----------
function deviceName() {
  const m = navigator.userAgent.match(/Android [\d.]+; ([^;)]+)/);
  const model = m && m[1].trim();
  if (model && model !== 'K' && !/^wv$/i.test(model)) return model;
  return /Android/.test(navigator.userAgent) ? 'Téléphone Android' : /iPhone/.test(navigator.userAgent) ? 'iPhone' : 'Téléphone';
}
function screen(html) {
  document.body.classList.add('screen-mode');
  $('#view').innerHTML = `<div class="screen">${html}</div>`;
}
const notPaired = (extra = '') => screen(`<div class="screen-ic">📱</div><h2>Ce téléphone n’est pas associé</h2>${extra}
  <p>Sur l’ordinateur, dans App Music, cliquez sur l’icône du téléphone (en bas à gauche, à côté de « Ma bibliothèque »), puis scannez le QR code avec l’appareil photo.</p>`);

async function pairIfAsked() {
  const m = location.hash.match(/^#pair=([\w-]+)$/);
  if (!m) return null;
  history.replaceState(null, '', location.pathname); // le code ne sert qu'une fois : on l'efface de l'adresse
  const r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: m[1], name: deviceName() }) })
    .then(async (x) => ({ status: x.status, ...(await x.json().catch(() => ({}))) })).catch(() => ({ error: 'Ordinateur injoignable.' }));
  if (r.ok) { store.set('installHint', true); return true; }
  return r.error || 'Association impossible.';
}

// ---------- Commandes envoyées à l'ordinateur ----------
let pending = null; // commande en attente de l'ouverture d'App Music sur l'ordinateur
async function cmd(action, extra = {}) {
  const body = { action, ...extra };
  optimistic(body);
  const r = await fetch('/api/remote/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  if (!r) return toast('Ordinateur injoignable');
  if (r.status === 401) return notPaired('<p class="warn">Ce téléphone a été retiré sur l’ordinateur.</p>');
  if (r.status === 409) { pending = { body, at: Date.now() }; showBanner(); return; }
  if (!r.ok) toast('Commande refusée');
}
const playList = (ids, start = 0, shuffle) => cmd('playList', { ids, start, ...(shuffle !== undefined ? { shuffle } : {}) });
const enqueue = (ids, label) => { cmd('enqueue', { ids }); toast(label || (ids.length > 1 ? `${ids.length} titres ajoutés à la file` : 'Ajouté à la file')); };

// ---------- État reçu de l'ordinateur ----------
let S = null, receivedAt = 0, hasPlayer = null, opening = false;
const position = () => (!S ? 0 : Math.min(S.duration || Infinity, S.position + (S.playing ? (Date.now() - receivedAt) / 1000 : 0)));
function optimistic(c) {
  if (!S) return;
  if (c.action === 'toggle') { S.position = position(); receivedAt = Date.now(); S.playing = !S.playing; renderPlayer(); }
  if (c.action === 'seek') { S.position = c.position; receivedAt = Date.now(); renderPlayer(); }
}
function setState(st) { S = st; receivedAt = Date.now(); renderPlayer(); }
function setPlayer(present) {
  hasPlayer = present;
  $('#conn').className = 'conn ' + (present ? 'on' : 'off');
  $('#conn').title = present ? `Connecté à App Music sur ${computer}` : `App Music n’est pas ouverte sur ${computer}`;
  if (present) {
    opening = false;
    if (pending && Date.now() - pending.at < 60000) { const { body } = pending; pending = null; cmd(body.action, Object.fromEntries(Object.entries(body).filter(([k]) => k !== 'action'))); }
  } else S = null;
  showBanner(); renderPlayer();
}
function showBanner() {
  const b = $('#banner');
  if (hasPlayer === false) {
    b.hidden = false;
    b.innerHTML = opening
      ? `<span>Ouverture d’App Music sur ${esc(computer)}…</span>`
      : `<span>App Music n’est pas ouverte sur ${esc(computer)}.</span><button class="pill" id="open-pc">Ouvrir sur ${esc(computer)}</button>`;
    $('#open-pc')?.addEventListener('click', openOnComputer);
  } else if (S?.blocked) {
    b.hidden = false;
    b.innerHTML = `<span>Sur ${esc(computer)}, cliquez une fois dans la page App Music : le navigateur attend ce clic pour lancer le son.</span>`;
  } else b.hidden = true;
  document.body.classList.toggle('with-banner', !b.hidden);
}
async function openOnComputer() {
  opening = true; showBanner();
  const r = await fetch('/api/remote/open', { method: 'POST' }).then((x) => x.json()).catch(() => ({}));
  if (!r.ok) { opening = false; showBanner(); toast(`Impossible d’ouvrir App Music sur ${computer}`); return; }
  // si rien n'arrive au bout de 20 s, on redonne la main
  setTimeout(() => { if (opening && !hasPlayer) { opening = false; showBanner(); } }, 20000);
}

let es = null;
function connect() {
  es?.close();
  es = new EventSource('/api/remote/events');
  es.onmessage = (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'status') { computer = m.computer || computer; setPlayer(m.player); if (m.state) setState(m.state); }
    if (m.type === 'state') setState(m.state);
    if (m.type === 'revoked') { es.close(); notPaired('<p class="warn">Ce téléphone a été retiré sur l’ordinateur.</p>'); }
  };
  es.onerror = async () => {
    $('#conn').className = 'conn off';
    if (es.readyState === EventSource.CLOSED) {
      // refus (appareil retiré) ou serveur arrêté : on vérifie, puis on réessaie
      const who = await fetch('/api/remote/whoami').then((r) => r.json()).catch(() => null);
      if (who && !who.paired) return notPaired('<p class="warn">Ce téléphone a été retiré sur l’ordinateur.</p>');
      setTimeout(connect, 3000);
    }
  };
}
// retour au premier plan (écran rallumé) : reconnexion immédiate
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && es && es.readyState !== EventSource.OPEN) connect(); });

// ---------- Lecteur (mini barre et plein écran) ----------
function renderPlayer() {
  const t = S?.current && T.get(S.current);
  $('#mini').hidden = !t;
  document.body.classList.toggle('has-track', !!t);
  document.body.classList.toggle('playing', !!S?.playing);
  if (!t) { if ($('#np').classList.contains('open')) closeNP(); showBanner(); return; }
  if ($('#mini-cover').dataset.id !== t.albumId) { $('#mini-cover').src = $('#np-cover').src = cover(t.albumId); $('#mini-cover').dataset.id = t.albumId; }
  $('#mini-title').textContent = $('#np-title').textContent = t.title;
  $('#mini-sub').textContent = t.artist;
  $('#np-artist').textContent = t.artist; $('#np-artist').href = `#artist/${t.artistId}`;
  $('#np-shuffle').classList.toggle('on', !!S.shuffle);
  $('#np-repeat').classList.toggle('on', S.repeat !== 'off'); $('#np-repeat').classList.toggle('one', S.repeat === 'one');
  if (!volumeDragging) $('#volume').value = Math.round((S.volume ?? 1) * 100);
  tick(); renderQueue(); showBanner();
}
function tick() {
  if (!S?.current) return;
  const p = position(), d = S.duration || T.get(S.current)?.duration || 0;
  const v = d ? Math.min(1, p / d) : 0;
  $('#mini-fill').style.width = v * 100 + '%';
  if (!seeking) { $('#seek-fill').style.width = v * 100 + '%'; $('#t-cur').textContent = fmt(p); $('#t-dur').textContent = '-' + fmt(d - p); }
}
setInterval(tick, 500);

function renderQueue() {
  const box = $('#queue');
  if (!S?.queue?.length) { box.innerHTML = '<p class="muted">Rien en attente.</p>'; $('#q-clear').hidden = true; return; }
  const base = Math.max(0, S.pos);
  const rows = S.queue.map((id, k) => {
    const t = T.get(id); if (!t) return '';
    const i = base + k;
    return `<div class="row q ${k === 0 ? 'current' : ''}" data-jump="${i}"><img loading="lazy" src="${cover(t.albumId)}" alt=""><span class="txt"><b>${esc(t.title)}${t.hit ? STAR : ''}</b><small>${esc(t.artist)}</small></span>${k ? `<button class="icon small" data-remove="${i}" aria-label="Retirer de la file">${CROSS}</button>` : '<span class="now">En cours</span>'}</div>`;
  });
  $('#q-clear').hidden = S.queue.length < 2;
  box.innerHTML = rows[0] + (rows.length > 1 ? '<div class="q-label">Ensuite' + (S.shuffle ? ' · aléatoire' : '') + '</div>' + rows.slice(1).join('') : '<p class="muted">Fin de la file.</p>');
}
$('#queue').addEventListener('click', (e) => {
  const rm = e.target.closest('[data-remove]'); if (rm) { e.stopPropagation(); return cmd('remove', { index: +rm.dataset.remove }); }
  const j = e.target.closest('[data-jump]'); if (j && !j.classList.contains('current')) cmd('jump', { index: +j.dataset.jump });
});
$('#q-clear').onclick = () => cmd('clear');

const np = $('#np');
function openNP() { if (!S?.current) return; np.classList.add('open'); np.setAttribute('aria-hidden', 'false'); if (location.hash !== '#playing') history.pushState(null, '', '#playing'); }
function closeNP() { np.classList.remove('open'); np.setAttribute('aria-hidden', 'true'); }
$('#mini-open').onclick = openNP;
$('#np-close').onclick = () => (location.hash === '#playing' ? history.back() : closeNP());
$('#np-artist').onclick = () => closeNP();
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-cmd]'); if (!b) return;
  cmd(b.dataset.cmd);
});

// barre de position : toucher ou glisser
let seeking = false;
const seekEl = $('#seek');
const frac = (e) => { const r = seekEl.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
seekEl.addEventListener('pointerdown', (e) => {
  if (!S?.current) return;
  seeking = true; seekEl.setPointerCapture(e.pointerId); seekEl.classList.add('drag');
  const d = S.duration || T.get(S.current)?.duration || 0;
  const show = (v) => { $('#seek-fill').style.width = v * 100 + '%'; $('#t-cur').textContent = fmt(v * d); $('#t-dur').textContent = '-' + fmt(d - v * d); };
  show(frac(e));
  const mv = (ev) => show(frac(ev));
  const up = (ev) => { seekEl.removeEventListener('pointermove', mv); seekEl.removeEventListener('pointerup', up); seekEl.removeEventListener('pointercancel', up); seekEl.classList.remove('drag'); seeking = false; if (d) cmd('seek', { position: frac(ev) * d }); };
  seekEl.addEventListener('pointermove', mv); seekEl.addEventListener('pointerup', up); seekEl.addEventListener('pointercancel', up);
});
// volume : envoi régulier pendant le glissement
let volumeDragging = false, volTimer = null;
$('#volume').addEventListener('input', (e) => {
  volumeDragging = true;
  if (!volTimer) volTimer = setTimeout(() => { volTimer = null; cmd('volume', { value: +$('#volume').value / 100 }); }, 120);
});
$('#volume').addEventListener('change', () => { clearTimeout(volTimer); volTimer = null; volumeDragging = false; cmd('volume', { value: +$('#volume').value / 100 }); });

// ---------- Pages ----------
const view = $('#view');
const albumCard = (a) => `<button class="card" data-album="${a.id}"><img loading="lazy" src="${cover(a.id)}" alt=""><b>${esc(a.title)}</b><small>${esc(a.artist)}${a.year ? ' · ' + a.year : ''}</small></button>`;
const initials = (n) => n.replace(/^the\s+/i, '').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
const avatar = (ar) => `<span class="avatar"><span>${esc(initials(ar.name))}</span><img loading="lazy" src="/api/artist/${ar.id}/picture" alt=""></span>`;
// comme sur l'ordinateur : 4 pochettes si possible, sinon une seule en grand
const mosaic = (m, cls = '') => { const list = m.cover.length >= 4 ? m.cover.slice(0, 4) : m.cover.slice(0, 1); return `<span class="mosaic ${cls} ${list.length === 1 ? 'one' : ''}">${list.map((a) => `<img loading="lazy" src="${cover(a.id)}" alt="">`).join('')}</span>`; };
// image absente : l'icône de l'app pour un album sans pochette, les initiales pour un artiste sans photo
document.addEventListener('error', (e) => {
  const img = e.target; if (img.tagName !== 'IMG') return;
  if (img.closest('.avatar') || img.dataset.fallback) img.classList.add('noimg');
  else { img.dataset.fallback = '1'; img.src = '/icon.svg'; }
}, true);
function trackRows(ids, { artist = false, number = true } = {}) {
  return ids.map((id, i) => {
    const t = T.get(id); if (!t) return '';
    return `<div class="row tr${S?.current === id ? ' playing' : ''}" data-i="${i}" data-track="${id}">${number ? `<span class="n">${t.trackNo || i + 1}</span>` : `<img loading="lazy" src="${cover(t.albumId)}" alt="">`}
      <span class="txt"><b>${esc(t.title)}${t.hit ? STAR : ''}</b>${artist ? `<small>${esc(t.artist)}</small>` : ''}</span>
      <span class="dur">${fmt(t.duration)}</span><button class="icon small" data-add="${id}" aria-label="Ajouter à la file">${PLUS}</button></div>`;
  }).join('');
}
const actions = () => `<div class="actions"><button class="pill primary" data-act="play">${PLAY} Lire</button><button class="pill" data-act="shuffle">${SHUFFLE} Aléatoire</button><button class="pill" data-act="queue">${ADD} À la suite</button></div>`;
let currentIds = []; // titres de la page affichée (boutons Lire / Aléatoire / À la suite et lignes)

function viewAlbums() {
  view.innerHTML = `<div class="grid">${LIB.albums.map(albumCard).join('')}</div>`;
}
function viewArtists() {
  const list = [...LIB.artists].sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
  view.innerHTML = `<div class="list">${list.map((ar) => `<button class="row artist" data-artist="${ar.id}">${avatar(ar)}<span class="txt"><b>${esc(ar.name)}</b><small>${ar.albums.length} album${ar.albums.length > 1 ? 's' : ''}</small></span></button>`).join('')}</div>`;
}
function viewSelections() {
  const list = [...mixes().values()];
  if (!list.length) { view.innerHTML = '<p class="muted pad">Aucune sélection pour le moment.</p>'; return; }
  view.innerHTML = `<div class="grid">${list.map((m) => `<button class="card mix" data-mix="${m.key}">${mosaic(m)}<b>${esc(m.title)}</b><small>${m.ids.length} titres</small></button>`).join('')}</div>`;
}
function viewAlbum(id) {
  const a = A.get(id); if (!a) return viewAlbums();
  currentIds = a.tracks;
  const dur = a.tracks.reduce((s, x) => s + (T.get(x)?.duration || 0), 0);
  view.innerHTML = `<div class="hero"><img src="${cover(a.id)}" alt=""><h2>${esc(a.title)}</h2><a class="hero-artist" href="#artist/${a.artistId}">${esc(a.artist)}</a>
    <p class="muted">${[a.year, `${a.tracks.length} titres`, fmtLong(dur)].filter(Boolean).join(' · ')}</p>${actions()}</div>
    <div class="list tracks">${trackRows(a.tracks)}</div>`;
  return a.title;
}
function viewArtist(id) {
  const ar = R.get(id); if (!ar) return viewArtists();
  const albums = ar.albums.map((x) => A.get(x)).filter(Boolean);
  currentIds = albums.flatMap((a) => a.tracks);
  view.innerHTML = `<div class="hero artist-hero">${avatar(ar)}<h2>${esc(ar.name)}</h2><p class="muted">${albums.length} album${albums.length > 1 ? 's' : ''} · ${currentIds.length} titres</p>${actions()}</div>
    <div class="grid">${albums.map(albumCard).join('')}</div>`;
  return ar.name;
}
function viewMix(key) {
  const m = mixes().get(key); if (!m) return viewSelections();
  currentIds = m.ids;
  view.innerHTML = `<div class="hero">${mosaic(m, 'big')}<h2>${esc(m.title)}</h2>
    <p class="muted">${m.ids.length} titres</p>${actions()}</div><div class="list tracks">${trackRows(m.ids.slice(0, 600), { artist: true, number: false })}</div>`;
  return m.title;
}
let lastQuery = '';
function viewSearch() {
  view.innerHTML = `<div class="search"><input id="q" type="search" placeholder="Artiste, album, titre, genre, année…" autocomplete="off" spellcheck="false" enterkeyhint="search"></div><div id="results"></div>`;
  const input = $('#q'); input.value = lastQuery;
  const run = () => {
    lastQuery = input.value;
    const q = input.value.trim();
    if (!q) { $('#results').innerHTML = '<p class="muted pad">Par exemple « rock des années 80 », « metal allemand » ou un nom d’artiste.</p>'; return; }
    const r = runSearch(index ||= buildIndex(LIB), q);
    currentIds = r.tracks.slice(0, 50).map((t) => t.id);
    $('#results').innerHTML = (r.artists.length ? `<h3>Artistes</h3><div class="list">${r.artists.slice(0, 6).map((ar) => `<button class="row artist" data-artist="${ar.id}">${avatar(ar)}<span class="txt"><b>${esc(ar.name)}</b></span></button>`).join('')}</div>` : '')
      + (r.albums.length ? `<h3>Albums</h3><div class="grid">${r.albums.slice(0, 12).map(albumCard).join('')}</div>` : '')
      + (r.tracks.length ? `<h3>Titres</h3><div class="list tracks">${trackRows(currentIds, { artist: true, number: false })}</div>` : '')
      || '<p class="muted pad">Aucun résultat.</p>';
  };
  let timer; input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 150); });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
  run();
  if (!lastQuery) setTimeout(() => input.focus(), 50);
}

view.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add]'); if (add) { e.stopPropagation(); return enqueue([add.dataset.add]); }
  const act = e.target.closest('[data-act]');
  if (act) {
    if (!currentIds.length) return;
    if (act.dataset.act === 'play') return playList(currentIds, 0, false);
    if (act.dataset.act === 'shuffle') return playList(currentIds, -1, true);
    if (act.dataset.act === 'queue') return enqueue(currentIds, `${currentIds.length} titres ajoutés à la file`);
  }
  const tr = e.target.closest('.tr[data-track]');
  if (tr) { const ids = $$('.tr[data-track]', tr.parentElement).map((x) => x.dataset.track); return playList(ids, ids.indexOf(tr.dataset.track)); }
  const al = e.target.closest('[data-album]'); if (al) return go(`#album/${al.dataset.album}`);
  const ar = e.target.closest('[data-artist]'); if (ar) return go(`#artist/${ar.dataset.artist}`);
  const mx = e.target.closest('[data-mix]'); if (mx) return go(`#mix/${mx.dataset.mix}`);
});
const go = (hash) => { location.hash = hash; };

const TABS = { albums: 'Albums', artists: 'Artistes', selections: 'Sélections', search: 'Recherche' };
const scrollMem = new Map();
let shown = null;
function route() {
  // nouveau QR code scanné alors que la page était déjà ouverte : on recommence l'association
  if (/^#pair=/.test(location.hash)) return location.reload();
  if (document.body.classList.contains('screen-mode')) return;
  const h = location.hash.replace(/^#/, '');
  if (h === 'playing') { if (!np.classList.contains('open')) openNP(); return; }
  if (np.classList.contains('open')) closeNP();
  if (shown && TABS[shown]) scrollMem.set(shown, scrollY);
  const [first, arg] = (h || store.get('tab', 'albums')).split('/');
  const isPage = ['album', 'artist', 'mix'].includes(first);
  const name = TABS[first] || isPage ? first : 'albums';
  if (!isPage) store.set('tab', name);
  currentIds = [];
  const title = { albums: viewAlbums, artists: viewArtists, selections: viewSelections, search: viewSearch, album: viewAlbum, artist: viewArtist, mix: viewMix }[name](arg && decodeURIComponent(arg));
  $('#title').textContent = title || TABS[name] || 'App Music';
  $('#back').hidden = !isPage;
  $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === (isPage ? store.get('tab', 'albums') : name)));
  shown = name;
  window.scrollTo(0, !isPage && scrollMem.has(name) ? scrollMem.get(name) : 0);
}
window.addEventListener('hashchange', route);
$('#back').onclick = () => history.back();

// ---------- Démarrage ----------
(async () => {
  const paired = await pairIfAsked();
  if (typeof paired === 'string') return notPaired(`<p class="warn">${esc(paired)}</p>`);
  const who = await fetch('/api/remote/whoami').then((r) => r.json()).catch(() => null);
  if (!who) return screen(`<h2>Ordinateur injoignable</h2><p>Vérifiez que le téléphone est sur le Wi-Fi de la maison et que l’ordinateur est allumé.</p><button class="pill primary" onclick="location.reload()">Réessayer</button>`);
  computer = who.computer || computer;
  if (!who.paired) return notPaired();
  const r = await fetch('/api/library').then((x) => (x.ok ? x.json() : null)).catch(() => null);
  if (!r) return notPaired();
  LIB = r;
  r.tracks.forEach((t) => T.set(t.id, t)); r.albums.forEach((a) => A.set(a.id, a)); r.artists.forEach((a) => R.set(a.id, a));
  route();
  connect();
  if (store.get('installHint', false)) {
    // HTTP : Chrome ne propose pas l'installation complète ; le raccourci se crée depuis son menu
    const hint = document.createElement('div');
    hint.className = 'install';
    hint.innerHTML = `<b>✓ Téléphone associé</b><p>Pour retrouver App Music comme une app : menu <b>⋮</b> de Chrome → <b>Ajouter à l’écran d’accueil</b>.</p><button class="pill" id="hint-ok">OK</button>`;
    view.prepend(hint);
    $('#hint-ok').onclick = () => { hint.remove(); store.set('installHint', false); };
  }
})();
