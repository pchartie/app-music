// QR code fabriqué localement (aucun service en ligne), rendu en SVG net.
import qrcode from 'qrcode-generator';

export function qrMatrix(text) {
  const q = qrcode(0, 'M');
  q.addData(text, 'Byte');
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

// marge blanche de 4 modules, exigée par la norme pour que les téléphones lisent le code
export function qrSvg(text) {
  const m = qrMatrix(text), n = m.length, q = 4, size = n + 2 * q;
  let d = '';
  m.forEach((row, r) => row.forEach((dark, c) => { if (dark) d += `M${c + q} ${r + q}h1v1h-1z`; }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" role="img" aria-label="QR code d’association"><rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}
