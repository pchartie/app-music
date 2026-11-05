// Verre « liquide » pour le lecteur : réfraction sur les bords + dispersion chromatique (diffraction).
// Une carte de déplacement est calculée à la taille exacte de l'élément : près des bords, le fond est
// prélevé plus vers l'intérieur, comme à travers l'épaisseur d'un verre bombé. Les canaux rouge, vert et
// bleu sont déviés d'intensités légèrement différentes, ce qui produit les franges irisées.
// Rendu par les navigateurs Chromium (backdrop-filter avec filtre SVG) ; ailleurs, verre dépoli classique.

const SVG_NS = 'http://www.w3.org/2000/svg';
const supported = !!navigator.userAgentData?.brands?.some((b) => /Chromium|Google Chrome|Brave|Microsoft Edge/.test(b.brand));

function displacementMap(w, h, radius, bezel) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); const img = ctx.createImageData(w, h); const d = img.data;
  const hw = w / 2, hh = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // distance signée au bord d'un rectangle arrondi (négative à l'intérieur)
      const px = x + 0.5 - hw, py = y + 0.5 - hh;
      const qx = Math.abs(px) - (hw - radius), qy = Math.abs(py) - (hh - radius);
      const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
      const sdf = Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - radius;
      const inside = -sdf; // distance au bord, vers l'intérieur
      // normale sortante
      let nx, ny;
      if (qx > 0 && qy > 0) { const l = Math.hypot(qx, qy) || 1; nx = (qx / l) * Math.sign(px); ny = (qy / l) * Math.sign(py); }
      else if (qx > qy) { nx = Math.sign(px); ny = 0; } else { nx = 0; ny = Math.sign(py); }
      // profil d'un bord bombé : fort tout près du bord, nul au-delà de la « lunette »
      const t = Math.max(0, 1 - inside / bezel);
      const mag = inside > 0 ? t * t * (3 - 2 * t) : 0;
      const i = (y * w + x) * 4;
      d[i] = 128 - nx * mag * 127; // prélève vers l'intérieur
      d[i + 1] = 128 - ny * mag * 127;
      d[i + 2] = 128; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL();
}

function buildFilter(id) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  // un canal de couleur, dévié d'une intensité donnée
  const ONLY = ['1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'];
  const channel = (scale, row, name) => `
    <feDisplacementMap in="soft" in2="map" scale="${scale}" xChannelSelector="R" yChannelSelector="G" result="d${name}"/>
    <feColorMatrix in="d${name}" type="matrix" values="${ONLY[row]}" result="${name}"/>`;
  svg.innerHTML = `<filter id="${id}" filterUnits="userSpaceOnUse" x="0" y="0" width="100" height="100" color-interpolation-filters="sRGB">
    <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="soft"/>
    <feImage href="" x="0" y="0" width="100" height="100" preserveAspectRatio="none" result="map"/>
    ${channel(46, 0, 'r')}${channel(52, 1, 'g')}${channel(58, 2, 'b')}
    <feComposite in="r" in2="g" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="rg"/>
    <feComposite in="rg" in2="b" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
  </filter>`;
  document.body.appendChild(svg);
  return svg.querySelector('filter');
}

export function liquidGlass(el, { radius = 16, bezel = 22 } = {}) {
  // reflet qui suit la souris (tous navigateurs)
  el.addEventListener('pointermove', (e) => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  });
  if (!supported) return;
  const id = 'glass-' + Math.random().toString(36).slice(2, 8);
  const filter = buildFilter(id);
  const image = filter.querySelector('feImage');
  let last = '';
  const update = () => {
    const w = Math.round(el.offsetWidth), h = Math.round(el.offsetHeight);
    if (!w || !h || `${w}x${h}` === last) return;
    last = `${w}x${h}`;
    for (const n of [filter, image]) { n.setAttribute('width', w); n.setAttribute('height', h); }
    image.setAttribute('href', displacementMap(w, h, radius, bezel));
    el.style.setProperty('--glass-filter', `url(#${id})`);
    document.body.classList.add('liquid');
  };
  new ResizeObserver(update).observe(el);
  update();
}
