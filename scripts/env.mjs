// Tiny .env reader with no dependencies.
// Real environment variables always win over values in the .env file,
// so hosting platforms (Vercel, Netlify, GitHub Actions, Docker) can override them.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function parseEnv(text) {
  const out = {};
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const [, key, rest] = m;
    let value = rest;
    if (value.startsWith('"')) {
      const end = value.indexOf('"', 1);
      value = (end > 0 ? value.slice(1, end) : value.slice(1))
        .replace(/\\n/g, '\n').replace(/\\"/g, '"');
    } else if (value.startsWith("'")) {
      const end = value.indexOf("'", 1);
      value = end > 0 ? value.slice(1, end) : value.slice(1);
    } else {
      value = value.replace(/\s+#.*$/, '').trim();
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(root = ROOT) {
  const file = join(root, '.env');
  const fromFile = existsSync(file) ? parseEnv(readFileSync(file, 'utf8')) : {};
  const merged = { ...fromFile };
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && v !== '') merged[k] = v;
  }
  return merged;
}
