// In-browser fake of the parts of Supabase the app uses: teacher auth, tables
// with the owner-only rules, the public functions (RPCs) from the migration,
// and the refute-ai Edge Function, which runs the REAL function code
// (supabase/functions/refute-ai/index.ts) against this fake database.
// Data lives in localStorage.

const KEY = 'mockdb.v2';
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || null; } catch { return null; } };
const db = load() || {
  users: [], session: null,
  app_settings: { owner_id: null, teacher_name: '', institution: '' },
  ai_settings: null, courses: [], tasks: [], attempts: [],
};
const persist = () => localStorage.setItem(KEY, JSON.stringify(db));
const uuid = () => crypto.randomUUID();
const now = () => new Date().toISOString();
const listeners = [];
const emit = (ev, s) => listeners.forEach((cb) => setTimeout(() => cb(ev, s), 0));
const uid = () => db.session?.user?.id || null;
const isOwner = () => Boolean(uid() && db.app_settings.owner_id === uid());
const clone = (x) => JSON.parse(JSON.stringify(x));

const TASK_DEFAULTS = { brief: '', persona: '', opening: '', claim: '', defenses: '', explanation: '', criteria: [], stubbornness: 'firm', language: 'en', max_turns: 15, is_open: true, reveal_criteria: true, allow_retry: true };
const normRoster = (r) => [...new Set((r || []).map((x) => String(x).trim().toUpperCase()).filter(Boolean))].sort();

function applyDefaults(table, row) {
  const r = { id: uuid(), created_at: now(), ...row };
  if (table === 'courses') { r.roster = normRoster(r.roster); }
  if (table === 'tasks') Object.assign(r, { ...TASK_DEFAULTS, ...r, updated_at: now() });
  return r;
}

function embed(table, row, cols, embedFilters) {
  const out = { ...row };
  for (const [, rel, inner] of cols.matchAll(/(\w+)\(([^)]*)\)/g)) {
    if (inner.trim() === 'count') {
      const fk = table === 'courses' ? 'course_id' : 'task_id';
      const f = embedFilters[rel] || [];
      out[rel] = [{ count: db[rel].filter((x) => x[fk] === row.id && f.every(([c, v]) => x[c] === v)).length }];
    } else if (rel === 'courses') {
      out.courses = db.courses.find((c) => c.id === row.course_id) || null;
    }
  }
  return out;
}

class Query {
  constructor(table) { this.table = table; this.filters = []; this.embedFilters = {}; this.op = 'select'; this.cols = '*'; }
  select(cols = '*') { if (this.op === 'select') this.cols = cols; else { this.returning = true; this.cols = cols; } return this; }
  insert(rows) { this.op = 'insert'; this.payload = rows; return this; }
  update(patch) { this.op = 'update'; this.payload = patch; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(c, v) { if (c.includes('.')) { const [rel, col] = c.split('.'); (this.embedFilters[rel] ||= []).push([col, v]); } else this.filters.push([c, v]); return this; }
  order(c, { ascending = true } = {}) { this.sort = [c, ascending]; return this; }
  single() { this.one = 'single'; return this; }
  maybeSingle() { this.one = 'maybe'; return this; }
  match(r) { return this.filters.every(([c, v]) => r[c] === v); }
  run() {
    if (!['courses', 'tasks', 'attempts'].includes(this.table)) return { data: null, error: { message: `permission denied for table ${this.table}` } };
    if (!isOwner()) {
      if (this.op === 'select') return { data: this.one ? null : [], error: null };
      return { data: null, error: { message: `new row violates row-level security policy for table "${this.table}"` } };
    }
    const T = db[this.table];
    let rows;
    if (this.op === 'insert') {
      rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((r) => applyDefaults(this.table, r));
      T.push(...rows);
    } else if (this.op === 'update') {
      rows = T.filter((r) => this.match(r));
      rows.forEach((r) => {
        Object.assign(r, this.payload);
        if (this.table === 'courses' && 'roster' in this.payload) r.roster = normRoster(r.roster);
        if (this.table === 'tasks') r.updated_at = now();
      });
    } else if (this.op === 'delete') {
      rows = T.filter((r) => this.match(r));
      db[this.table] = T.filter((r) => !rows.includes(r));
      if (this.table === 'courses') { const ids = db.tasks.filter((t) => rows.some((c) => c.id === t.course_id)).map((t) => t.id); db.tasks = db.tasks.filter((t) => !ids.includes(t.id)); db.attempts = db.attempts.filter((a) => !ids.includes(a.task_id)); }
      if (this.table === 'tasks') { const ids = rows.map((r) => r.id); db.attempts = db.attempts.filter((a) => !ids.includes(a.task_id)); }
    } else {
      rows = T.filter((r) => this.match(r));
      if (this.sort) { const [c, asc] = this.sort; rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : -1) * (asc ? 1 : -1)); }
    }
    persist();
    let data = (this.op === 'select' || this.returning) ? rows.map((r) => embed(this.table, clone(r), this.cols, this.embedFilters)) : null;
    if (this.one) {
      if (this.one === 'single' && (!data || data.length !== 1)) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned' } };
      data = data?.[0] ?? null;
    }
    return { data, error: null };
  }
  then(res, rej) { return new Promise((r) => setTimeout(() => r(this.run()), 15)).then(res, rej); }
}

// ── The public functions, mirroring supabase/migrations ──────────────

function site() {
  const s = db.app_settings;
  return { teacher_name: s.teacher_name, institution: s.institution, has_owner: Boolean(s.owner_id), is_owner: isOwner(), ai_ready: Boolean(db.ai_settings) };
}
function snapshotOf(t, c, preview) {
  return { title: t.title, course_title: c.title, persona: t.persona, criteria: t.criteria, reveal_criteria: preview ? true : t.reveal_criteria, max_turns: t.max_turns, language: t.language, allow_retry: preview ? true : t.allow_retry };
}
function newAttempt(t, c, code, email, preview) {
  const a = {
    id: uuid(), task_id: t.id, student_code: code, student_email: email, token: uuid().replace(/-/g, ''), is_preview: preview,
    status: 'in_progress', messages: [{ role: 'assistant', content: (t.opening || '').trim() || t.claim, at: now() }],
    criteria_met: [], judge_log: [], score: null, turns: 0, model: null, debrief: null, task_snapshot: snapshotOf(t, c, preview),
    started_at: now(), finished_at: null, updated_at: now(),
  };
  db.attempts.push(a); persist();
  return a;
}
function publicAttempt(id, token) {
  const a = db.attempts.find((x) => x.id === id && x.token === token);
  if (!a) return null;
  const t = db.tasks.find((x) => x.id === a.task_id);
  const c = db.courses.find((x) => x.id === t.course_id);
  const done = a.status !== 'in_progress';
  const reveal = a.task_snapshot.reveal_criteria !== false;
  return clone({
    id: a.id, task_id: a.task_id, status: a.status, student_code: a.student_code, is_preview: a.is_preview,
    messages: a.messages, turns: a.turns, max_turns: a.task_snapshot.max_turns ?? t.max_turns,
    met_count: a.criteria_met.length, criteria_count: (a.task_snapshot.criteria || []).length,
    score: done ? a.score : null, debrief: done ? a.debrief : null,
    criteria: done && reveal ? a.task_snapshot.criteria : null, criteria_met: done && reveal ? a.criteria_met : null,
    allow_retry: (a.task_snapshot.allow_retry ?? t.allow_retry) && t.is_open, model: a.model,
    started_at: a.started_at, finished_at: a.finished_at,
    task: { id: t.id, title: t.title, brief: t.brief, persona: t.persona, course_title: c.title, teacher_name: db.app_settings.teacher_name },
  });
}
const RPC = {
  get_site: () => site(),
  claim_site: ({ p_name }) => {
    if (!uid()) throw new Error('Sign in first.');
    if (!db.app_settings.owner_id) { db.app_settings.owner_id = uid(); db.app_settings.teacher_name = String(p_name || '').trim(); persist(); return true; }
    return isOwner();
  },
  update_site: ({ p_name, p_institution }) => {
    if (!isOwner()) throw new Error('Only the teacher can change these settings.');
    Object.assign(db.app_settings, { teacher_name: p_name.trim(), institution: p_institution.trim() }); persist();
    return site();
  },
  get_task_public: ({ p_task }) => {
    const t = db.tasks.find((x) => x.id === p_task);
    if (!t) return null;
    const c = db.courses.find((x) => x.id === t.course_id);
    return { id: t.id, title: t.title, brief: t.brief, persona: t.persona, max_turns: t.max_turns, is_open: t.is_open, course_title: c.title, course_code: c.code, has_roster: c.roster.length > 0, teacher_name: db.app_settings.teacher_name };
  },
  start_attempt: ({ p_task, p_code, p_email }) => {
    const code = String(p_code || '').trim().toUpperCase();
    const email = String(p_email || '').trim().toLowerCase();
    if (!code) return { error: 'bad_code' };
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: 'bad_email' };
    const t = db.tasks.find((x) => x.id === p_task);
    if (!t) return { error: 'not_found' };
    const c = db.courses.find((x) => x.id === t.course_id);
    const open = db.attempts.find((a) => a.task_id === t.id && a.student_code === code && a.status === 'in_progress' && !a.is_preview);
    if (open) return t.is_open ? { attempt_id: open.id, token: open.token, resumed: true } : { error: 'closed' };
    if (!t.is_open) return { error: 'closed' };
    if (c.roster.length && !c.roster.includes(code)) return { error: 'not_on_list' };
    if (!t.allow_retry) {
      const done = db.attempts.filter((a) => a.task_id === t.id && a.student_code === code && a.status !== 'in_progress' && !a.is_preview).at(-1);
      if (done) return { error: 'done', attempt_id: done.id, token: done.token };
    }
    const a = newAttempt(t, c, code, email, false);
    return { attempt_id: a.id, token: a.token, resumed: false };
  },
  start_preview: ({ p_task }) => {
    if (!isOwner()) throw new Error('Only the teacher can preview tasks.');
    const t = db.tasks.find((x) => x.id === p_task);
    const c = db.courses.find((x) => x.id === t.course_id);
    db.attempts = db.attempts.filter((a) => !(a.task_id === t.id && a.is_preview));
    const a = newAttempt(t, c, 'PREVIEW', '', true);
    return { attempt_id: a.id, token: a.token, resumed: false };
  },
  get_attempt_public: ({ p_id, p_token }) => publicAttempt(p_id, p_token),
};

// ── The refute-ai Edge Function, running the real code ───────────────

const realFetch = window.fetch.bind(window);
let handlerPromise = null;
function handler() {
  handlerPromise ||= import('/__fn/refute-ai.js').then((F) => F.createHandler({
    providers: F.makeProviders(realFetch),
    db: {
      async getUser(jwt) { const u = db.users.find((x) => `token-${x.id}` === jwt); return u ? { id: u.id } : null; },
      async ownerId() { return db.app_settings.owner_id; },
      async getAttempt(id) { const a = db.attempts.find((x) => x.id === id); return a ? clone(a) : null; },
      async getTask(id) { const t = db.tasks.find((x) => x.id === id); return t ? clone(t) : null; },
      async getAi() { return db.ai_settings ? clone(db.ai_settings) : null; },
      async saveAi(row) { db.ai_settings = { ...row, updated_at: now() }; persist(); },
      async updateAttempt(id, expected, patch) {
        const a = db.attempts.find((x) => x.id === id);
        if (!a || a.status !== expected.status || a.turns !== expected.turns) return null;
        Object.assign(a, patch, { updated_at: now() }); persist();
        return clone(a);
      },
      async publicAttempt(id, token) { return publicAttempt(id, token); },
    },
  }));
  return handlerPromise;
}
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input.url;
  if (url.includes('/functions/v1/refute-ai')) {
    const h = await handler();
    return h(new Request(url, init));
  }
  return realFetch(input, init);
};

// ── The client ───────────────────────────────────────────────────────

export function createClient() {
  return {
    auth: {
      async getSession() { return { data: { session: db.session } }; },
      onAuthStateChange(cb) { listeners.push(cb); setTimeout(() => cb('INITIAL_SESSION', db.session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      async signUp({ email, password, options }) {
        if (db.users.find((u) => u.email === email)) return { data: null, error: { message: 'User already registered' } };
        const user = { id: uuid(), email, password, user_metadata: options?.data || {} };
        db.users.push(user);
        db.session = { user: { id: user.id, email, user_metadata: user.user_metadata }, access_token: `token-${user.id}` };
        persist(); emit('SIGNED_IN', db.session);
        return { data: { user: db.session.user, session: db.session }, error: null };
      },
      async signInWithPassword({ email, password }) {
        const u = db.users.find((x) => x.email === email && x.password === password);
        if (!u) return { data: null, error: { message: 'Invalid login credentials' } };
        db.session = { user: { id: u.id, email, user_metadata: u.user_metadata }, access_token: `token-${u.id}` };
        persist(); emit('SIGNED_IN', db.session);
        return { data: { user: db.session.user, session: db.session }, error: null };
      },
      async signOut() { db.session = null; persist(); emit('SIGNED_OUT', null); return { error: null }; },
      async resetPasswordForEmail() { return { data: {}, error: null }; },
      async updateUser() { return { data: {}, error: null }; },
    },
    from: (t) => new Query(t),
    async rpc(name, args) {
      await new Promise((r) => setTimeout(r, 15));
      try {
        return { data: RPC[name](args || {}), error: null };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
  };
}
