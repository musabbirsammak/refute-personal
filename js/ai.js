// Calls to the refute-ai server function. The AI key lives on the server;
// the browser only sends the student's message (or the teacher's settings).

import { CONFIG, functionUrl } from './site.js';
import { auth } from './db.js';

export class AiError extends Error {
  constructor(message, kind = 'other', status = 0) {
    super(message);
    this.kind = kind; // quota | auth | own_key | need_key | config | model | closed | finished | conflict | network | other
    this.status = status;
  }
}

export const PROVIDERS = {
  gemini: { label: 'Google Gemini', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'starts with AIza' },
  groq: { label: 'Groq', keyUrl: 'https://console.groq.com/keys', keyHint: 'starts with gsk_' },
};

async function call(action, payload = {}, { asTeacher = false } = {}) {
  const token = asTeacher ? await auth.accessToken() : null;
  if (asTeacher && !token) throw new AiError('Sign in again to change these settings.', 'auth');
  let res;
  try {
    res = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: CONFIG.supabaseKey,
        Authorization: `Bearer ${token || CONFIG.supabaseKey}`,
      },
      body: JSON.stringify({ action, ...payload }),
    });
  } catch {
    throw new AiError("Couldn't reach the server. Check your internet connection and press Retry.", 'network');
  }
  let data = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !data || data.error) {
    if (res.status === 404 && !data?.error) {
      throw new AiError("The AI function isn't deployed yet. See \"Deploy the AI function\" in the README.", 'config', 404);
    }
    if ((res.status === 401 || res.status === 403) && !data?.error) {
      throw new AiError('The AI function refused the request. Make sure JWT verification is switched off for it (see the README).', 'config', res.status);
    }
    throw new AiError(data?.error || `The server returned an error (${res.status}).`, data?.kind || 'other', res.status);
  }
  return data;
}

// A student's own key (optional, or required by the teacher). It stays in the
// student's browser and is sent with each message; the server never stores it.
const OWN_KEY = 'refute.ownkey.v1';
export function ownKey(provider) {
  try {
    const v = JSON.parse(localStorage.getItem(OWN_KEY) || 'null');
    return v && v.provider === provider ? String(v.key || '') : '';
  } catch { return ''; }
}
export function setOwnKey(provider, key) {
  try {
    if (key) localStorage.setItem(OWN_KEY, JSON.stringify({ provider, key }));
    else localStorage.removeItem(OWN_KEY);
  } catch { /* private window */ }
}

// Students
export const sendTurn = (attemptId, token, message, apiKey = '') => call('turn', { attempt_id: attemptId, token, message, ...(apiKey ? { api_key: apiKey } : {}) }).then((d) => d.attempt);
export const giveUp = (attemptId, token, apiKey = '') => call('give_up', { attempt_id: attemptId, token, ...(apiKey ? { api_key: apiKey } : {}) }).then((d) => d.attempt);

// Teacher
export const aiStatus = () => call('ai_status', {}, { asTeacher: true });
export const listModels = (provider, apiKey) => call('list_models', { provider, api_key: apiKey }, { asTeacher: true });
export const saveAi = ({ provider, model, apiKey }) => call('save_ai', { provider, model, api_key: apiKey }, { asTeacher: true });
export const testAi = () => call('test_ai', {}, { asTeacher: true });
export const setStudentKeys = (required) => call('student_keys', { required }, { asTeacher: true });
