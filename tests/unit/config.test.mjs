import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from '../../scripts/env.mjs';
import { buildConfig, renderConfig, writeConfig } from '../../scripts/build-config.mjs';

// .env parsing
const env = parseEnv(`
# comment
REFUTE_APP_NAME="Refute Lab"
REFUTE_SOURCE_URL=https://github.com/x/refute   # inline comment
export SUPABASE_URL=https://abc.supabase.co/
SUPABASE_PUBLISHABLE_KEY='sb_publishable_123'
EMPTY=
`);
assert.equal(env.REFUTE_APP_NAME, 'Refute Lab');
assert.equal(env.REFUTE_SOURCE_URL, 'https://github.com/x/refute');
assert.equal(env.SUPABASE_URL, 'https://abc.supabase.co/');
assert.equal(env.SUPABASE_PUBLISHABLE_KEY, 'sb_publishable_123');
assert.equal(env.EMPTY, '');

// building the config
const ok = buildConfig(env);
assert.deepEqual(ok.errors, []);
assert.equal(ok.config.supabaseUrl, 'https://abc.supabase.co');
assert.equal(ok.config.appName, 'Refute Lab');

// legacy anon key is accepted
assert.equal(buildConfig({ SUPABASE_URL: 'https://a.supabase.co', SUPABASE_ANON_KEY: 'eyJ.anon.key' }).config.supabaseKey, 'eyJ.anon.key');

// secret keys are refused
assert.equal(buildConfig({ SUPABASE_URL: 'https://a.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' }).errors.length, 1);
const payload = Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url');
assert.equal(buildConfig({ SUPABASE_URL: 'https://a.supabase.co', SUPABASE_ANON_KEY: `x.${payload}.y` }).errors.length, 1);

// bad values are refused; local Supabase is allowed over http
assert.equal(buildConfig({ SUPABASE_URL: 'http://evil.example.com', SUPABASE_PUBLISHABLE_KEY: 'k' }).errors.length, 1);
assert.equal(buildConfig({ SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'k' }).errors.length, 0);
assert.equal(buildConfig({ REFUTE_SOURCE_URL: 'ftp://x' }).errors.length, 1);

// missing database values only warn
assert.equal(buildConfig({}).errors.length, 0);
assert.ok(buildConfig({}).warnings.length >= 1);

// rendered output is valid JS with escaped values
const tricky = buildConfig({ REFUTE_APP_NAME: 'O\'Brien "Lab" </script>' }).config;
const src = renderConfig(tricky);
const mod = await import('data:text/javascript,' + encodeURIComponent(src));
assert.equal(mod.CONFIG.appName, 'O\'Brien "Lab" </script>');

// writeConfig writes js/config.js and refuses secrets without writing
const root = mkdtempSync(join(tmpdir(), 'refute-'));
mkdirSync(join(root, 'js'));
writeFileSync(join(root, '.env'), 'SUPABASE_URL=https://x.supabase.co\nSUPABASE_PUBLISHABLE_KEY=sb_publishable_x\n');
assert.equal(writeConfig({ root, env: parseEnv(readFileSync(join(root, '.env'), 'utf8')), quiet: true }).ok, true);
assert.match(readFileSync(join(root, 'js', 'config.js'), 'utf8'), /sb_publishable_x/);
const root2 = mkdtempSync(join(tmpdir(), 'refute-'));
mkdirSync(join(root2, 'js'));
const origErr = console.error; console.error = () => {};
assert.equal(writeConfig({ root: root2, env: { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x' }, quiet: true }).ok, false);
console.error = origErr;
assert.equal(existsSync(join(root2, 'js', 'config.js')), false);

console.log('config tests passed');
