// Serves menufactory/ as plain files, the way GitHub Pages will.
//
//   npm run serve            then open the address it prints
//
// Its own tiny server rather than `python -m http.server`, which on Windows serves .js as
// text/plain and the browser then refuses to load the modules.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.lottie': 'application/zip',
  '.riv': 'application/octet-stream',
};

// Never serve the working material, even locally: the same folders the publish step leaves out.
const PRIVATE = ['requirements', 'designs', 'looks-src', 'node_modules', 'tests', 'tools'];

export function startServer(port = 0) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (PRIVATE.includes(rel.split('/')[0])) {
      res.writeHead(404).end('not found');
      return;
    }
    let file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        res.writeHead(301, { Location: url.pathname + '/' }).end();
        return;
      }
      file = path.join(file, 'index.html');
    }
    if (!fs.existsSync(file)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = await startServer(Number(process.env.PORT ?? 8040));
  const { port } = server.address();
  console.log(`menufactory served at http://localhost:${port}/`);
  for (const venue of fs.readdirSync(path.join(ROOT, 'venues'))) {
    console.log(`  http://localhost:${port}/venues/${venue}/`);
  }
  console.log('Ctrl+C to stop.');
}
