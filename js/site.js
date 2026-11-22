// Site configuration. The values come from js/config.js, which is generated
// from your .env file by `npm run config` (or `npm run build` / `npm run dev`).
// Never edit js/config.js by hand: edit .env and regenerate it.
// The teacher's name and institution are set inside the app (Settings).

const DEFAULTS = {
  appName: 'Refute',
  sourceUrl: '',
  supabaseUrl: '',
  supabaseKey: '',
};

let generated = null;
try {
  generated = (await import('./config.js')).CONFIG || {};
} catch {
  generated = null; // config.js has not been generated yet
}

export const CONFIG = Object.freeze({ ...DEFAULTS, ...(generated || {}) });

/** True once js/config.js exists and holds a database URL and key. */
export const isConfigured = Boolean(generated && CONFIG.supabaseUrl && CONFIG.supabaseKey);

/** Address of the refute-ai server function. */
export const functionUrl = `${CONFIG.supabaseUrl}/functions/v1/refute-ai`;
