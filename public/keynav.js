// Navigation au clavier / à la télécommande (flèches, OK/Entrée, Retour/Échap).
// Les flèches déplacent le focus vers l'élément le plus proche dans la direction choisie,
// d'abord dans la zone courante (barre latérale, contenu, lecteur), puis dans les zones voisines.

const ITEM = '[data-album]:not([data-disc]), [data-artist], [data-mix], tr[data-track], .q-item, [data-q], [data-chip]';
const SEL = `a[href], button:not([disabled]), input:not([type=range]), [tabindex="0"], ${ITEM}`;
const ZONES = ['.sidebar', '#view', '.player'];
const OVERLAYS = ['#setup.open', '#voice.open', '#reader.open', '#queue.open', '#np.open'];

export let usingKeys = false;
const memory = new Map(); // position du focus mémorisée par page, pour le retour arrière

const visible = (el) => {
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none';
};
export const topOverlay = () => OVERLAYS.map((s) => document.querySelector(s)).find(Boolean) || null;

function focusables(root) {
  const all = [...root.querySelectorAll(SEL)].filter(visible);
  // un bouton à l'intérieur d'une carte ou d'une ligne n'est pas une étape de navigation à part
  return all.filter((el) => { const host = el.parentElement?.closest(ITEM); return !host || host === el; });
}
export function makeFocusable(root = document) {
  for (const el of root.querySelectorAll(ITEM)) if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
}

function zoneOf(el) { return ZONES.map((z) => document.querySelector(z)).find((z) => z?.contains(el)) || null; }

function pick(from, cands, dir) {
  const r = from.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let best = null, bestScore = Infinity;
  for (const el of cands) {
    if (el === from || el.contains(from) || from.contains(el)) continue;
    const c = el.getBoundingClientRect();
    const ex = c.left + c.width / 2, ey = c.top + c.height / 2;
    let primary, ortho;
    if (dir === 'right') { if (ex <= cx + 2 || c.left < r.left + 2) continue; primary = Math.max(0, c.left - r.right); ortho = Math.max(0, Math.max(c.top, r.top) - Math.min(c.bottom, r.bottom)) > 0 ? Math.abs(ey - cy) : 0; }
    if (dir === 'left') { if (ex >= cx - 2 || c.right > r.right - 2) continue; primary = Math.max(0, r.left - c.right); ortho = Math.max(0, Math.max(c.top, r.top) - Math.min(c.bottom, r.bottom)) > 0 ? Math.abs(ey - cy) : 0; }
    if (dir === 'down') { if (ey <= cy + 2 || c.top < r.top + 2) continue; primary = Math.max(0, c.top - r.bottom); ortho = Math.max(0, Math.max(c.left, r.left) - Math.min(c.right, r.right)) > 0 ? Math.abs(ex - cx) : 0; }
    if (dir === 'up') { if (ey >= cy - 2 || c.bottom > r.bottom - 2) continue; primary = Math.max(0, r.top - c.bottom); ortho = Math.max(0, Math.max(c.left, r.left) - Math.min(c.right, r.right)) > 0 ? Math.abs(ex - cx) : 0; }
    const score = primary + ortho * 2.2;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

export function focusEl(el) {
  if (!el) return;
  el.focus({ preventScroll: true });
  const inMain = el.closest('#view');
  if (el.closest('.shelf')) el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  if (inMain) el.scrollIntoView({ block: el.matches('tr') ? 'center' : 'nearest', inline: 'nearest', behavior: 'smooth' });
  else el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

export function defaultFocus() {
  const view = document.querySelector('#view');
  const el = view.querySelector('#stage') || view.querySelector('[data-autofocus]') || focusables(view).find((x) => x.matches(ITEM)) || focusables(view)[0] || document.querySelector('nav a.active');
  focusEl(el);
}

export function move(dir) {
  const ov = topOverlay();
  const active = document.activeElement;
  const scope = ov || document;
  if (!active || active === document.body || !scope.contains(active)) {
    if (ov) focusEl(focusables(ov)[0]); else defaultFocus();
    return;
  }
  if (ov) { focusEl(pick(active, focusables(ov), dir)); return; }
  const zone = zoneOf(active);
  let target = zone && pick(active, focusables(zone), dir);
  if (!target) {
    const others = ZONES.map((z) => document.querySelector(z)).filter((z) => z && z !== zone);
    target = pick(active, others.flatMap(focusables), dir);
    // en revenant dans le contenu depuis la barre latérale, on retrouve l'élément quitté
    if (target && target.closest('#view') && zone?.matches('.sidebar') && lastInView?.isConnected && visible(lastInView)) target = lastInView;
  }
  if (target) focusEl(target);
}

let lastInView = null;
document.addEventListener('focusin', (e) => { if (e.target.closest?.('#view')) lastInView = e.target; });

// Mémoriser / restaurer la position du focus quand on change de page
export function remember(hash) {
  const view = document.querySelector('#view');
  const list = focusables(view);
  const i = list.indexOf(document.activeElement);
  if (i >= 0) memory.set(hash, i);
}
export function restore(hash) {
  if (!usingKeys) return;
  const view = document.querySelector('#view');
  requestAnimationFrame(() => {
    makeFocusable(view);
    const list = focusables(view);
    const i = memory.get(hash);
    if (i !== undefined && list[i]) focusEl(list[i]); else defaultFocus();
  });
}

document.addEventListener('keydown', (e) => { if (e.key.startsWith('Arrow') || e.key === 'Enter' || e.key === 'Tab') { usingKeys = true; document.body.classList.add('keys'); } }, true);
document.addEventListener('pointerdown', () => { usingKeys = false; document.body.classList.remove('keys'); }, true);
