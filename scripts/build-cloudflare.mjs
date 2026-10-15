import { cp, copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
  throw new Error('The static build output must stay in the portfolio dist folder.');
}

await mkdir(output, { recursive: true });
for (const file of [
  'index.html', 'styles.css', 'app.js', 'config.js', 'favicon.svg', '.nojekyll',
  'atelier-oree-apercu.jpg', 'escale-apercu.jpg', 'portfolio-projets-apercu.jpg', 'portfolio-projets-final.png'
]) {
  await copyFile(path.join(root, file), path.join(output, file));
}
await cp(path.join(root, 'admin'), path.join(output, 'admin'), { recursive: true });
await cp(path.join(root, 'projects'), path.join(output, 'projects'), { recursive: true });
console.log('Cloudflare Pages assets prepared in dist/ (Node server files and local data excluded).');
