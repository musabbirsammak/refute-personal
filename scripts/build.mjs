#!/usr/bin/env node
// Production build: generates js/config.js, then copies only the files the
// website needs into dist/. Hosting platforms publish the dist/ folder.

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './env.mjs';
import { writeConfig } from './build-config.mjs';

const { ok } = writeConfig();
if (!ok) process.exit(1);

const dist = join(ROOT, 'dist');
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const item of ['index.html', 'css', 'js', 'LICENSE']) {
  const src = join(ROOT, item);
  if (existsSync(src)) cpSync(src, join(dist, item), { recursive: true });
}
console.log('Built the site into dist/.');
