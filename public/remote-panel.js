// Panneau « Télécommande » de l'ordinateur : associer un téléphone (QR code), voir et retirer les appareils,
// oublier un réseau. Tout est servi par l'ordinateur lui-même (routes /api/remote/* réservées à la machine locale).
import * as nav from './keynav.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const post = (url) => fetch(url, { method: 'POST' }).then((r) => r.json()).catch(() => ({ error: 'Serveur injoignable.' }));
const PHONE = '<svg viewBox="0 0 24 24"><rect x="6.5" y="2.5" width="11" height="19" rx="2.6" fill="none" stroke="currentColor" stroke-width="1.9"/><path d="M10.5 18.2h3" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>';
const HOUSE = '<svg viewBox="0 0 24 24"><path d="M4 11.2 12 4.5l8 6.7V20h-5.2v-5.4H9.2V20H4z" fill="currentColor"/></svg>';

export function ago(ts, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 90) return 'à l’instant';
  const m = Math.round(s / 60); if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60); if (h < 24) return `il y a ${h} h`;
  return new Date(ts).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
}

let poll = null;
export function openRemotePanel({ onClose } = {}) {
  const box = $('#remote');
  let qr = null; // { svg, url, expiresAt, devices }
  let flash = ''; // message affiché après une association réussie
  let lastFocus = document.activeElement;

  const close = () => {
    clearInterval(poll); poll = null;
    if (qr) post('/api/remote/pair/cancel');
    box.classList.remove('open'); box.setAttribute('aria-hidden', 'true');
    setTimeout(() => { if (!box.classList.contains('open')) box.innerHTML = ''; }, 500);
    onClose?.();
    if (lastFocus?.isConnected) nav.focusEl(lastFocus);
  };

  function note(st) {
    const n = st.network;
    const lines = [];
    if (!n) lines.push('Aucun réseau local détecté : connectez cet ordinateur au Wi-Fi de la maison.');
    else if (n.home) lines.push(`${HOUSE} Réseau de la maison (${esc(n.subnet)}) : ${st.devices.length ? 'la télécommande est active.' : 'associez un téléphone pour commencer.'}`);
    else if (st.homes.length) lines.push(`Vous n’êtes pas sur le réseau de la maison : la télécommande est désactivée ici. Associer un téléphone ajoutera ce réseau (${esc(n.subnet)}).`);
    else lines.push(`Ce réseau (${esc(n.subnet)}) deviendra celui de la maison : App Music ne sera visible des téléphones que sur ce réseau, et seulement des téléphones associés.`);
    if (n?.vpn) lines.push('Un VPN est actif sur cet ordinateur : si le téléphone n’arrive pas à se connecter, autorisez les connexions au réseau local dans les réglages du VPN.');
    return lines.map((l) => `<p>${l}</p>`).join('');
  }

  function render(st) {
    const left = qr ? Math.max(0, Math.round((qr.expiresAt - Date.now()) / 1000)) : 0;
    if (qr && !left) qr = null;
    const pairArea = qr
      ? `<div class="rm-qr">${qr.svg}</div>
         <p class="rm-hint">Ouvrez l’appareil photo du téléphone et visez ce code.<br>Le téléphone doit être sur le même Wi-Fi.</p>
         <p class="rm-timer">Valable encore <b id="rm-left"></b> · <button class="link-btn" id="rm-new">Nouveau code</button></p>`
      : `${flash ? `<p class="rm-flash">${flash}</p>` : ''}
         <button class="btn primary setup-pick" id="rm-pair"${st.network ? '' : ' disabled'}>${PHONE} ${st.devices.length ? 'Associer un autre téléphone' : 'Associer un téléphone'}</button>`;
    const devices = st.devices.map((d) => `<div class="setup-cand rm-row"><span class="ic">${PHONE}</span><span class="name">${esc(d.name)}</span>
        <span class="count">${d.online ? '<span class="rm-on">● connecté</span>' : `vu ${ago(d.lastSeen)}`}</span>
        <button class="btn soft" data-revoke="${esc(d.id)}" title="Ce téléphone ne pourra plus piloter App Music">Retirer</button></div>`).join('');
    const homes = st.homes.map((h) => `<div class="setup-cand rm-row"><span class="ic home">${HOUSE}</span><span class="name">Réseau ${esc(h.subnet)}</span>
        <span class="count">${h.current ? 'actuel' : ''}</span>
        <button class="btn soft" data-forget="${esc(h.id)}" title="La télécommande ne s’ouvrira plus sur ce réseau">Oublier</button></div>`).join('');
    const focusedId = document.activeElement?.closest?.('#remote') ? document.activeElement.id || document.activeElement.dataset.revoke || document.activeElement.dataset.forget : null;
    // le cadre n'est construit qu'une fois ; ensuite, seules les zones dont le contenu a changé sont remplacées
    // (sinon l'animation d'apparition se rejoue à chaque rafraîchissement et le panneau clignote)
    if (!box.querySelector('.rm-panel')) {
      box.innerHTML = `<div class="setup-panel rm-panel">
        <div class="setup-logo rm-logo">${PHONE}</div>
        <h1>Télécommande</h1>
        <p class="setup-lead">Pilotez App Music depuis votre téléphone, sur le Wi-Fi de la maison. La musique continue de sortir de cet ordinateur.</p>
        <div class="rm-pair-area"></div><div class="rm-note"></div><div class="rm-lists"></div>
        <button class="link-btn setup-cancel" id="rm-close">Fermer</button>
      </div>`;
    }
    const lists = (devices ? `<div class="setup-sugg"><div class="setup-sugg-title">Téléphones associés</div><div class="setup-list" id="rm-devices">${devices}</div></div>` : '')
      + (homes ? `<div class="setup-sugg"><div class="setup-sugg-title">Réseau de la maison</div><div class="setup-list">${homes}</div></div>` : '');
    for (const [sel, html] of [['.rm-pair-area', pairArea], ['.rm-note', note(st)], ['.rm-lists', lists]]) {
      const el = box.querySelector(sel);
      if (el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; }
    }
    tickTimer();
    // garder le focus clavier au même endroit si sa zone a été redessinée
    if (focusedId && !box.contains(document.activeElement)) {
      const again = box.querySelector('#' + CSS.escape(focusedId)) || box.querySelector(`[data-revoke="${CSS.escape(focusedId)}"], [data-forget="${CSS.escape(focusedId)}"]`);
      if (again) again.focus({ preventScroll: true });
    }
  }
  function tickTimer() {
    const el = $('#rm-left'); if (!el || !qr) return;
    const left = Math.max(0, Math.round((qr.expiresAt - Date.now()) / 1000));
    el.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    if (!left) { qr = null; render(state); }
  }

  let state = null, known = null;
  async function refresh() {
    const st = await fetch('/api/remote/admin').then((r) => r.json()).catch(() => null);
    if (!st || !box.classList.contains('open')) return;
    // un nouveau téléphone vient de s'associer : le QR code a servi
    if (known && st.devices.length > known.size) {
      const fresh = st.devices.find((d) => !known.has(d.id));
      qr = null; flash = `✓ « ${esc(fresh?.name || 'Téléphone')} » est associé. Vous pouvez fermer ce panneau.`;
      setTimeout(() => nav.focusEl($('#rm-close')), 30);
    }
    known = new Set(st.devices.map((d) => d.id));
    state = st; render(st);
  }
  async function pair() {
    flash = '';
    const r = await post('/api/remote/pair');
    if (r.error) { flash = r.error === 'no-network' ? 'Aucun réseau local détecté.' : 'Impossible d’ouvrir App Music sur le réseau local (pare-feu ?).'; await refresh(); return; }
    qr = r; await refresh();
    nav.focusEl($('#rm-new') || $('#rm-close'));
  }

  box.onclick = async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'rm-close') return close();
    if (t.id === 'rm-pair' || t.id === 'rm-new') return pair();
    // retirer / oublier : il faut confirmer d'un second clic (un clic égaré ne coupe plus la télécommande)
    if ((t.dataset.revoke || t.dataset.forget) && !t.classList.contains('confirm')) {
      t.classList.add('confirm'); t.dataset.label = t.textContent; t.textContent = 'Confirmer ?';
      clearTimeout(t._undo); t._undo = setTimeout(() => { t.classList.remove('confirm'); t.textContent = t.dataset.label; }, 4000);
      return;
    }
    if (t.dataset.revoke) { await post(`/api/remote/devices/${encodeURIComponent(t.dataset.revoke)}/revoke`); flash = ''; return refresh(); }
    if (t.dataset.forget) { await post(`/api/remote/homes/${encodeURIComponent(t.dataset.forget)}/forget`); return refresh(); }
  };
  box.onkeydown = (e) => { if (e.key === 'Escape' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); close(); } };

  box.classList.add('open'); box.setAttribute('aria-hidden', 'false');
  refresh().then(() => nav.focusEl($('#rm-pair') || $('#rm-close')));
  clearInterval(poll);
  poll = setInterval(tickTimer, 1000); // compte à rebours sans rien redessiner
  const slow = setInterval(() => { if (!box.classList.contains('open')) return clearInterval(slow); refresh(); }, 2000);
  return { close };
}
