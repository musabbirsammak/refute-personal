#!/usr/bin/env node
// Minimal static file server for local use and Docker. No dependencies.
// Usage: node scripts/serve.mjs [folder]   (default: the project folder)
// HOST and PORT come from the environment or .env (defaults 127.0.0.1:8000).

import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { ROOT, loadEnv } from './env.mjs';

const env = loadEnv();
const HOST = env.HOST || '127.0.0.1';
const PORT = Number(env.PORT) || 8000;
const base = resolve(process.argv[2] ? resolve(process.argv[2]) : ROOT);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

// Only the website itself is served. Dotfiles (like .env) and tooling folders never are.
const BLOCKED = new Set(['scripts', 'tests', 'supabase', 'node_modules', 'docs', 'dist']);

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(body);
}

const server = createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, 'Bad request');
  }
  const parts = pathname.split('/').filter(Boolean);
  if (parts.some((p) => p.startsWith('.')) || (base === ROOT && BLOCKED.has(parts[0]))) {
    return send(res, 404, 'Not found');
  }
  let file = normalize(join(base, ...parts));
  if (file !== base && !file.startsWith(base + sep)) return send(res, 404, 'Not found');
  try {
    if (statSync(file).isDirectory()) file = join(file, 'index.html');
    const st = statSync(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'Not found');
  }
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Refute is running at http://${shown}:${PORT}  (serving ${base})`);
});
