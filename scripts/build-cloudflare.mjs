import { cp, copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, 'dist');
if (path.dirname(output) !== root || path.basename(output) !== 'dist') {
  throw new Error('The static build output must stay in the portfolio dist folder.');
}

// Keep the Cloudflare build aligned with the files published by GitHub Pages.
// The old root-level preview images are not tracked in this repository.
const files = [
  'index.html', 'styles.css', 'app.js', 'config.js', 'favicon.svg', '.nojekyll',
  'admin/login.html', 'admin/index.html', 'admin/create-account.html',
  'admin/admin.css', 'admin/email.css', 'admin/login.js', 'admin/create-account.js', 'admin/admin.js', 'admin/gmail-bridge.gs',
  'projects/tempo/index.html', 'projects/tempo/tempo.css',
  'projects/tempo/tempo-redesign.css', 'projects/tempo/tempo.js',
  'projects/atelier-oree/index.html', 'projects/atelier-oree/oree.css',
  'projects/atelier-oree/oree.js',
  'projects/escale/index.html', 'projects/escale/escale.css',
  'projects/escale/escale.js'
];
const directories = [
  'projects/tempo/images',
  'projects/atelier-oree/images',
  'projects/escale/images'
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of files) {
  const destination = path.join(output, file);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(path.join(root, file), destination);
}
for (const directory of directories) {
  await cp(path.join(root, directory), path.join(output, directory), { recursive: true });
}
console.log('Cloudflare Pages static assets prepared in dist/; server-only files and local data excluded.');

