// Lit un QR code SVG (celui de lib/qr.js) comme le ferait un téléphone : pixels noirs et blancs, puis décodage.
import jsQR from 'jsqr';

export function decodeQrSvg(svg) {
  const size = +svg.match(/viewBox="0 0 (\d+) \d+"/)[1], scale = 6, w = size * scale;
  const dark = new Set([...svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)].map((m) => `${m[1]},${m[2]}`));
  const px = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) {
    const v = dark.has(`${Math.floor(x / scale)},${Math.floor(y / scale)}`) ? 0 : 255, i = (y * w + x) * 4;
    px[i] = px[i + 1] = px[i + 2] = v; px[i + 3] = 255;
  }
  return jsQR(px, w, w)?.data ?? null;
}
