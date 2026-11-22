// All database access (Supabase). Security is enforced by the rules and
// functions in supabase/migrations/, not by this file.

import { createClient } from 'supabase';
import { CONFIG, isConfigured } from './site.js';

export const configured = isConfigured;

export const sb = configured
  ? createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' },
  })
  : null;

export function friendlyError(e) {
  const m = String(e?.message || e || 'Something went wrong.');
  if (/row-level security|permission denied|violates row-level/i.test(m)) return "You don't have permission to do that.";
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Couldn't reach the server. Check your internet connection and try again.";
  if (/Invalid login credentials/i.test(m)) return 'Wrong email or password.';
  if (/Email not confirmed/i.test(m)) return 'Confirm your email first: open the link we sent to your inbox.';
  if (/already registered|already been registered/i.test(m)) return 'An account with this email already exists. Sign in instead.';
  if (/Password should be at least/i.test(m)) return 'Use a password with at least 8 characters.';
  if (/rate limit/i.test(m)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/invalid input syntax for type uuid/i.test(m)) return 'That link is not valid. Check that you copied all of it.';
  return m;
}

function check({ data, error }) {
  if (error) throw new Error(friendlyError(error));
  return data;
}

const redirectUrl = () => `${location.origin}${location.pathname}`;

// ── Teacher sign-in ──────────────────────────────────────────────────

export const auth = {
  async session() {
    const { data } = await sb.auth.getSession();
    return data.session;
  },
  async accessToken() {
    const { data } = await sb.auth.getSession();
    return data.session?.access_token || null;
  },
  onChange(cb) {
    return sb.auth.onAuthStateChange((event, session) => cb(event, session));
  },
  async signUp({ email, password, name }) {
    return check(await sb.auth.signUp({
      email, password, options: { data: { full_name: name }, emailRedirectTo: redirectUrl() },
    }));
  },
  async signIn(email, password) {
    return check(await sb.auth.signInWithPassword({ email, password }));
  },
  async signOut() {
    await sb.auth.signOut();
  },
  async sendReset(email) {
    return check(await sb.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl() }));
  },
  async setPassword(password) {
    return check(await sb.auth.updateUser({ password }));
  },
};

// ── This installation ────────────────────────────────────────────────

export async function getSite() {
  return check(await sb.rpc('get_site'));
}

export async function claimSite(name) {
  return check(await sb.rpc('claim_site', { p_name: name }));
}

export async function updateSite(name, institution) {
  return check(await sb.rpc('update_site', { p_name: name, p_institution: institution }));
}

// ── Courses (teacher) ────────────────────────────────────────────────

export async function listCourses() {
  return check(await sb.from('courses').select('*, tasks(count)').order('created_at', { ascending: false }));
}

export async function getCourse(id) {
  return check(await sb.from('courses').select('*').eq('id', id).maybeSingle());
}

export async function createCourse(row) {
  return check(await sb.from('courses').insert(row).select().single());
}

export async function updateCourse(id, patch) {
  return check(await sb.from('courses').update(patch).eq('id', id).select().single());
}

export async function deleteCourse(id) {
  check(await sb.from('courses').delete().eq('id', id));
}

// ── Tasks (teacher) ──────────────────────────────────────────────────

export async function listTasks(courseId) {
  return check(await sb.from('tasks')
    .select('id, title, is_open, created_at, updated_at, attempts(count)')
    .eq('course_id', courseId)
    .eq('attempts.is_preview', false)
    .order('created_at', { ascending: true }));
}

export async function getTask(id) {
  return check(await sb.from('tasks').select('*, courses(id, title, code)').eq('id', id).maybeSingle());
}

export async function createTask(row) {
  return check(await sb.from('tasks').insert(row).select().single());
}

export async function updateTask(id, patch) {
  return check(await sb.from('tasks').update(patch).eq('id', id).select().single());
}

export async function deleteTask(id) {
  check(await sb.from('tasks').delete().eq('id', id));
}

// ── Attempts (teacher) ───────────────────────────────────────────────

export async function listTaskAttempts(taskId) {
  return check(await sb.from('attempts')
    .select('id, student_code, student_email, status, score, turns, criteria_met, model, started_at, finished_at, updated_at')
    .eq('task_id', taskId)
    .eq('is_preview', false)
    .order('updated_at', { ascending: false }));
}

export async function getAttempt(id) {
  return check(await sb.from('attempts').select('*').eq('id', id).maybeSingle());
}

export async function deleteAttempt(id) {
  check(await sb.from('attempts').delete().eq('id', id));
}

export async function startPreview(taskId) {
  return check(await sb.rpc('start_preview', { p_task: taskId }));
}

// ── Students (no account) ────────────────────────────────────────────

export async function getTaskPublic(id) {
  return check(await sb.rpc('get_task_public', { p_task: id }));
}

export async function startAttempt(taskId, code, email) {
  return check(await sb.rpc('start_attempt', { p_task: taskId, p_code: code, p_email: email }));
}

export async function getAttemptPublic(id, token) {
  return check(await sb.rpc('get_attempt_public', { p_id: id, p_token: token }));
}
