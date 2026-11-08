// Lit /api/status sur l'entrée standard ; code de sortie 0 si le serveur en cours est plus ancien que son code
// (server.js ou lib/*.js modifiés depuis son démarrage), 1 sinon. Utilisé par scripts/launch.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function codeTime(root = ROOT) {
  const files = ['server.js', ...fs.readdirSync(path.join(root, 'lib')).map((f) => path.join('lib', f))];
  return Math.max(...files.map((f) => fs.statSync(path.join(root, f)).mtimeMs));
}
export const isStale = (status, root = ROOT) => !status?.startedAt || codeTime(root) > status.startedAt;

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let input = '';
  process.stdin.on('data', (c) => (input += c)).on('end', () => {
    let status = null; try { status = JSON.parse(input); } catch {}
    process.exit(status && isStale(status) ? 0 : 1);
  });
}
