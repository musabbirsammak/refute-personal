// Tests for the server function (supabase/functions/refute-ai/index.ts).
// The file is plain JavaScript, so it is copied to a .mjs file and imported.
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TEMPLATES } from '../../js/templates.js';

const root = new URL('../../', import.meta.url).pathname;
const tmp = join(mkdtempSync(join(tmpdir(), 'refute-fn-')), 'refute-ai.mjs');
copyFileSync(join(root, 'supabase/functions/refute-ai/index.ts'), tmp);
const F = await import(pathToFileURL(tmp).href);

// ── Pure logic ───────────────────────────────────────────────────────
assert.deepEqual(F.parseJudge('{"met":[1,3],"notes":"ok"}', 4).met, [0, 2]);
assert.deepEqual(F.parseJudge('Sure!\n```json\n{"met": ["2", 9, 0]}\n```', 4).met, [1]);
assert.deepEqual(F.parseJudge('x {"criteria_met":[{"number":4}]} y', 4).met, [3]);
assert.equal(F.parseJudge('not json', 4).ok, false);
const crit = F.cleanCriteria(TEMPLATES[0].task.criteria);
assert.equal(F.computeScore(crit, [0, 1, 2, 3]), 100);
assert.equal(F.computeScore(crit, [0]), 35);
assert.equal(F.shouldConcede(crit, [0, 1]), false);
assert.equal(F.shouldConcede(crit, [0, 1, 2]), true);
assert.equal(F.characterName('Tanvir, a market analyst'), 'Tanvir');
assert.equal(F.stripThink('<think>hm</think> Hi'), 'Hi');
assert.deepEqual(F.normalizeTurns([{ role: 'assistant', content: 'a' }, { role: 'user', content: 'b' }]).map((m) => m.role), ['user', 'assistant', 'user']);
assert.equal(F.pickDefaultModel('groq', ['gemma2-9b-it', 'llama-3.3-70b-versatile']), 'llama-3.3-70b-versatile');
const task0 = { ...TEMPLATES[0].task, course_title: 'Statistics 101' };
assert.ok(F.defenderSystem(task0).includes(task0.claim));
assert.ok(!F.defenderSystem(task0).includes(crit[0].text), 'the defender does not see unmet points');
assert.ok(F.defenderSystem(task0, { met: [0, 1, 2], concede: true }).includes('concede sincerely'));
assert.ok(F.judgePrompt(task0, [{ role: 'assistant', content: 'hi' }]).system.includes('1. Explains'));

// ── Handler with a fake database and a scripted AI ───────────────────
const ATTEMPT_ID = '30000000-0000-0000-0000-000000000001';
function setup({ ai = { provider: 'groq', model: 'llama-3.3-70b-versatile', api_key: 'gsk_secret_1234' }, task = {}, attempt = {} } = {}) {
  const store = {
    owner: 'owner-1',
    users: { 'teacher-jwt': { id: 'owner-1' }, 'other-jwt': { id: 'user-2' } },
    ai,
    task: { id: 'task-1', is_open: true, ...task0, ...task },
    attempt: {
      id: ATTEMPT_ID, task_id: 'task-1', token: 'tok', status: 'in_progress', is_preview: false, turns: 0,
      messages: [{ role: 'assistant', content: task0.opening }], criteria_met: [], judge_log: [],
      task_snapshot: { criteria: task0.criteria, persona: task0.persona, max_turns: 4, language: 'en', course_title: 'Statistics 101' },
      ...attempt,
    },
    saves: 0,
  };
  const db = {
    async getUser(jwt) { return store.users[jwt] || null; },
    async ownerId() { return store.owner; },
    async getAttempt(id) { return id === store.attempt.id ? structuredClone(store.attempt) : null; },
    async getTask(id) { return id === store.task.id ? structuredClone(store.task) : null; },
    async getAi() { return store.ai ? { ...store.ai } : null; },
    async saveAi(row) { store.ai = { ...row }; },
    async updateAttempt(id, expected, patch) {
      if (store.attempt.status !== expected.status || store.attempt.turns !== expected.turns) return null;
      Object.assign(store.attempt, patch); store.saves += 1; return { ...store.attempt };
    },
    async publicAttempt(id, token) {
      const a = store.attempt;
      return token === a.token ? { id, status: a.status, turns: a.turns, score: a.status === 'in_progress' ? null : a.score, messages: a.messages, met_count: a.criteria_met.length } : null;
    },
  };
  const script = { judge: [], fail: null, calls: [] };
  const providers = {
    async chat(conf, opts) {
      script.calls.push({ conf, opts });
      if (script.fail) { const e = script.fail; script.fail = null; throw e; }
      if (opts.json) return script.judge.shift() || '{"met":[]}';
      if (opts.system.includes('connection test')) return 'ready';
      if (opts.system.includes('supportive university tutor')) return '### Why the claim was wrong\nBecause.';
      return opts.system.includes('concede sincerely') ? 'You are right.' : 'Not convinced.';
    },
    async listModels(provider, key) { if (key !== 'gsk_secret_1234' && key !== 'gsk_new_5678') throw new F.AiError('Groq didn\'t accept the API key.', 'auth'); return ['whisper', 'llama-3.3-70b-versatile']; },
  };
  const handle = F.createHandler({ db, providers });
  const call = async (body, jwt) => {
    const res = await handle(new Request('http://x/refute-ai', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return { store, script, call };
}

{
  const { call } = setup();
  assert.equal((await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'wrong', message: 'x' })).status, 404, 'a wrong token is refused');
  assert.equal((await call({ action: 'turn', attempt_id: 'not-a-uuid', token: 'tok', message: 'x' })).status, 404);
  assert.equal((await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: '   ' })).status, 400, 'an empty message is refused');
  assert.equal((await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: 'x'.repeat(2001) })).status, 400, 'a very long message is refused');
  assert.equal((await call({ action: 'nope' })).status, 400);
}
{
  const { call } = setup({ ai: null });
  const r = await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: 'hi' });
  assert.equal(r.status, 409); assert.equal(r.body.kind, 'config');
}
{
  const { call } = setup({ task: { is_open: false } });
  assert.equal((await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: 'hi' })).body.kind, 'closed', 'a closed task stops the debate');
}
{
  const { call } = setup({ task: { is_open: false }, attempt: { is_preview: true } });
  assert.equal((await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: 'hi' })).status, 200, 'the teacher can preview a closed task');
}
{
  // A full debate that ends with the AI conceding
  const { store, script, call } = setup();
  script.judge.push('{"met":[],"notes":"no"}', '{"met":[1]}', '{"met":[1,2,3]}');
  let r = await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: 'You are wrong' });
  assert.equal(r.status, 200); assert.equal(r.body.attempt.turns, 1); assert.equal(r.body.attempt.status, 'in_progress');
  assert.equal(store.attempt.model, 'llama-3.3-70b-versatile');
  assert.equal(script.calls[0].conf.api_key, 'gsk_secret_1234', 'the saved key is used');
  // the AI is unavailable: nothing is saved, the student can retry
  script.fail = new F.AiError("The AI's limit was reached for now.", 'quota', 429);
  r = await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: 'Selection bias' });
  assert.equal(r.status, 429); assert.equal(r.body.kind, 'quota'); assert.equal(store.attempt.turns, 1);
  r = await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: 'Selection bias' });
  assert.equal(r.body.attempt.met_count, 1);
  r = await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: 'Missing people and margin of error' });
  assert.equal(r.body.attempt.status, 'conceded'); assert.equal(r.body.attempt.score, 85);
  assert.ok(store.attempt.debrief.startsWith('### Why'));
  assert.equal(store.attempt.messages.at(-1).content, 'You are right.');
  assert.equal(store.attempt.judge_log.length, 3);
  r = await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: 'more' });
  assert.equal(r.status, 409, 'a finished debate takes no more messages');
}
{
  // Running out of messages (snapshot max_turns = 4)
  const { store, call } = setup();
  for (let i = 0; i < 4; i++) await call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: `m${i}` });
  assert.equal(store.attempt.status, 'max_turns'); assert.equal(store.attempt.score, 0);
}
{
  // Giving up with no messages uses built-in feedback without calling the AI
  const { store, script, call } = setup();
  const r = await call({ action: 'give_up', attempt_id: ATTEMPT_ID, token: 'tok' });
  assert.equal(r.body.attempt.status, 'gave_up'); assert.equal(script.calls.length, 0);
  assert.ok(store.attempt.debrief.includes('What you missed'));
}
{
  // Two tabs sending at once: the second is refused instead of overwriting
  const { store, call } = setup();
  const realUpdate = store.attempt;
  const [a, b] = await Promise.all([
    call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: 'one' }),
    call({ action: 'turn', attempt_id: ATTEMPT_ID, token: 'tok', message: 'two' }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  assert.equal(realUpdate.turns, 1);
}
{
  // Teacher settings
  const { store, call } = setup({ ai: null });
  assert.equal((await call({ action: 'ai_status' })).status, 401, 'teacher actions need the teacher');
  assert.equal((await call({ action: 'ai_status' }, 'other-jwt')).status, 401, 'other accounts are refused');
  assert.equal((await call({ action: 'ai_status' }, 'sb_publishable_x')).status, 401);
  assert.equal((await call({ action: 'ai_status' }, 'teacher-jwt')).body.configured, false);
  assert.equal((await call({ action: 'list_models', provider: 'groq' }, 'teacher-jwt')).status, 400, 'a key is needed first');
  const lm = await call({ action: 'list_models', provider: 'groq', api_key: 'gsk_secret_1234' }, 'teacher-jwt');
  assert.equal(lm.body.suggested, 'llama-3.3-70b-versatile');
  assert.equal((await call({ action: 'list_models', provider: 'groq', api_key: 'bad-key-0000' }, 'teacher-jwt')).body.kind, 'auth');
  const saved = await call({ action: 'save_ai', provider: 'groq', model: 'llama-3.3-70b-versatile', api_key: 'gsk_secret_1234' }, 'teacher-jwt');
  assert.equal(saved.body.key_hint, '1234'); assert.equal(store.ai.api_key, 'gsk_secret_1234');
  assert.ok(!JSON.stringify(saved.body).includes('gsk_secret'), 'the key is never sent back');
  // change only the model: the saved key is kept
  await call({ action: 'save_ai', provider: 'groq', model: 'openai/gpt-oss-20b' }, 'teacher-jwt');
  assert.equal(store.ai.api_key, 'gsk_secret_1234'); assert.equal(store.ai.model, 'openai/gpt-oss-20b');
  // switching provider needs that provider's key
  assert.equal((await call({ action: 'save_ai', provider: 'gemini', model: 'gemini-2.5-flash' }, 'teacher-jwt')).status, 400);
  assert.equal((await call({ action: 'test_ai' }, 'teacher-jwt')).body.ok, true);
  assert.ok(!JSON.stringify((await call({ action: 'ai_status' }, 'teacher-jwt')).body).includes('gsk_secret'));
}
{
  const { call } = setup();
  const res = await F.createHandler({ db: {}, providers: {} })(new Request('http://x', { method: 'OPTIONS' }));
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await call({ action: 'turn' })).status, 404);
}
console.log('server function tests passed');
