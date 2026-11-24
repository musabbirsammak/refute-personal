import { html, mount, $, md, toast, navigate, autoGrow, confirmDialog } from '../util.js';
import {
  getTaskPublic, startAttempt, getAttemptPublic, getTask, getAttempt, startPreview, friendlyError,
} from '../db.js';
import { state } from '../state.js';
import { sendTurn, giveUp, ownKey, setOwnKey, PROVIDERS } from '../ai.js';
import { characterName, cleanCriteria } from '../tutor.js';
import { resultMarkup, studentResultActions } from './result.js';

const REMEMBER = 'refute.student.v1';
const remembered = () => { try { return JSON.parse(localStorage.getItem(REMEMBER) || '{}'); } catch { return {}; } };
const remember = (v) => { try { localStorage.setItem(REMEMBER, JSON.stringify(v)); } catch { /* private window */ } };

const START_ERRORS = {
  bad_code: 'Enter your student ID.',
  bad_email: 'Enter a valid email address.',
  not_found: "This task doesn't exist any more. Ask your teacher for a new link.",
  closed: 'Your teacher has switched this link off.',
  not_on_list: "That student ID isn't on this course's class list. Check it, or ask your teacher.",
};

// ── Student opens a task link ────────────────────────────────────────

export async function studentEntryView(root, { params: [taskId] }) {
  const task = await getTaskPublic(taskId);
  if (!task) {
    mount(root, html`<div class="empty"><p>This task link doesn't work. Check that you copied the whole link, or ask your teacher for a new one.</p></div>`);
    return;
  }
  const aiName = characterName(task.persona);
  const prev = remembered();
  const blocked = !task.is_open ? 'Your teacher has switched this link off.'
    : !state.site.ai_ready ? "Your teacher hasn't finished setting up the AI yet. Try again later." : '';

  mount(root, html`
    <section class="intro">
      <p class="muted">${task.course_title}${task.course_code ? ` (${task.course_code})` : ''}${task.teacher_name ? `, ${task.teacher_name}` : ''}</p>
      <h1>${task.title}</h1>
      <div class="intro-grid">
        <div class="intro-brief">
          ${task.brief ? html`<div class="prose">${md(task.brief)}</div>` : ''}
          <ul class="rules">
            <li>You'll argue with <strong>${task.persona || aiName}</strong>.</li>
            <li>You win when ${aiName} admits the claim is wrong. That happens only when you explain the key points with reasons.</li>
            <li>You can send up to <strong>${task.max_turns} messages</strong>. Your progress is saved after each one.</li>
            <li>Closed the page by accident? Open the link again and enter the same student ID to continue.</li>
            ${state.site.student_keys_required && PROVIDERS[state.site.ai_provider] ? html`<li>Your teacher asks you to use your own free <a href="${PROVIDERS[state.site.ai_provider].keyUrl}" target="_blank" rel="noopener">${PROVIDERS[state.site.ai_provider].label} key</a>. You'll paste it on the next page.</li>` : ''}
          </ul>
        </div>
        <div class="intro-start">
          ${blocked ? html`<div class="notice notice-warn"><p>${blocked}</p></div>` : html`
            <h2>Start the debate</h2>
            <form id="entry" class="form" novalidate>
              <label>Student ID <input name="code" autocomplete="off" spellcheck="false" value="${prev.code || ''}" required></label>
              <label>Email <input name="email" type="email" autocomplete="email" value="${prev.email || ''}" required></label>
              ${task.has_roster ? html`<p class="hint">Only students on this course's class list can join.</p>` : ''}
              <p class="form-error" hidden></p>
              <button class="btn btn-primary btn-wide" type="submit">Start the debate</button>
            </form>`}
        </div>
      </div>
    </section>`);
  if (blocked) return;

  const form = $('#entry', root);
  form.addEventListener('input', () => { $('.form-error', form).hidden = true; });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    const btn = $('button[type=submit]', form);
    const code = form.code.value.trim();
    const email = form.email.value.trim();
    const problem = !code ? START_ERRORS.bad_code : !/^\S+@\S+\.\S+$/.test(email) ? START_ERRORS.bad_email : '';
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Starting…';
    try {
      const r = await startAttempt(taskId, code, email);
      remember({ code, email });
      if (r.error === 'done') {
        mount($('.intro-start', root), html`
          <div class="notice notice-info"><p>You've already completed this task, and your teacher allows one attempt.</p>
          <a class="btn" href="#/a/${r.attempt_id}?k=${r.token}">See your result</a></div>`);
        return;
      }
      if (r.error) throw new Error(START_ERRORS[r.error] || 'Something went wrong. Try again.');
      if (r.resumed) toast('Welcome back. Your debate continues where you left off.');
      navigate(`/a/${r.attempt_id}?k=${r.token}`);
    } catch (ex) {
      err.textContent = friendlyError(ex);
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Start the debate';
    }
  });
}

// ── The debate (and its result) ──────────────────────────────────────

export async function debateView(root, { params: [attemptId], query }) {
  const token = query.get('k') || '';
  const attempt = token ? await getAttemptPublic(attemptId, token) : null;
  if (!attempt) {
    mount(root, html`<div class="empty"><p>This debate link doesn't work. Open your teacher's task link and enter your student ID to continue.</p></div>`);
    return;
  }
  if (attempt.status !== 'in_progress') {
    showStudentResult(root, attempt, token);
    return;
  }
  renderDebate(root, {
    attempt,
    token,
    onFinished: (a) => showStudentResult(root, a, token),
  });
}

function showStudentResult(root, a, token) {
  mount(root, resultMarkup(publicToResult(a), {
    viewer: a.is_preview ? 'preview' : 'student',
    studentCode: a.student_code,
    actions: studentResultActions(a, token),
  }));
  root.querySelector('[data-action="copy"]')?.addEventListener('click', async () => {
    const { copyText } = await import('../util.js');
    await copyText(location.href);
    toast('Result link copied.');
  });
  root.querySelector('[data-action="print"]')?.addEventListener('click', () => {
    const d = root.querySelector('.transcript-wrap');
    if (d) d.open = true;
    window.print();
  });
}

/** Shape a get_attempt_public row for resultMarkup. */
function publicToResult(a) {
  return {
    status: a.status,
    score: a.score,
    turns: a.turns,
    messages: a.messages || [],
    debrief: a.debrief,
    started_at: a.started_at,
    finished_at: a.finished_at,
    model: a.model,
    criteria: a.criteria ? cleanCriteria(a.criteria) : null,
    criteria_met: a.criteria_met || [],
    met_count: a.met_count,
    criteria_count: a.criteria_count,
    title: a.task.title,
    course_title: a.task.course_title,
    persona: a.task.persona,
  };
}

/**
 * The chat screen. State comes from the server after every turn.
 * preview: the teacher's own test run, with the judge's decisions shown.
 */
export function renderDebate(root, { attempt, token, onFinished, preview = null }) {
  let a = attempt;
  let busy = '';            // '' | 'sending' | 'giving-up'
  let pending = '';         // the student's message while it is being sent
  let error = null;         // AiError
  const task = a.task;
  const aiName = characterName(task.persona);

  mount(root, html`
    <div class="debate ${preview ? 'is-preview' : ''}">
      <aside class="case">
        ${preview ? html`<p class="preview-flag">Preview: your test run is not counted</p>` : ''}
        <p class="muted case-course">${task.course_title || ''}</p>
        <h1 class="case-title">${task.title}</h1>
        ${task.brief ? html`<details class="case-brief"><summary>Instructions</summary><div class="prose">${md(task.brief)}</div></details>` : ''}
        <div class="case-progress" id="progress"></div>
        ${preview ? '' : html`<p class="case-engine">Student ID: ${a.student_code}</p>`}
        <button class="btn btn-quiet btn-small" id="giveup">Give up and see feedback</button>
        ${preview ? html`<div class="judge-panel" id="judge"></div>` : ''}
      </aside>
      <section class="chat" aria-label="Debate">
        <div class="chat-log" id="log"></div>
        <div class="chat-status" id="status" aria-live="polite"></div>
        <form class="composer" id="composer">
          <label for="msg" class="sr-only">Your argument</label>
          <textarea id="msg" rows="2" placeholder="Explain why ${aiName} is wrong…" maxlength="2000"></textarea>
          <button class="btn btn-primary" type="submit" id="send">Send</button>
        </form>
        <p class="composer-hint">Enter sends. Shift + Enter starts a new line.</p>
        ${preview ? '' : html`<div class="own-key" id="ownkey"></div>`}
      </section>
    </div>`);

  const log = $('#log', root);
  const status = $('#status', root);
  const input = $('#msg', root);
  autoGrow(input);

  // The student's own AI key (not used in the teacher's preview).
  const provider = state.site.ai_provider;
  const providerInfo = PROVIDERS[provider];
  const keyRequired = !preview && Boolean(state.site.student_keys_required);
  const myKey = () => (preview || !providerInfo ? '' : ownKey(provider));
  function drawKey() {
    const box = $('#ownkey', root);
    if (!box || !providerInfo) return;
    const key = myKey();
    if (key) {
      mount(box, html`
        <p class="small">Using your own ${providerInfo.label} key ending in ${key.slice(-4)}.
          <button type="button" class="btn-link" data-key="remove">Remove it</button></p>`);
      return;
    }
    mount(box, html`
      <details ${keyRequired ? 'open' : ''}>
        <summary>${keyRequired ? `Add your own ${providerInfo.label} key to start` : `Use your own ${providerInfo.label} key (optional)`}</summary>
        <p class="small">Get a free key at <a href="${providerInfo.keyUrl}" target="_blank" rel="noopener">${providerInfo.keyUrl.replace('https://', '')}</a> (it ${providerInfo.keyHint}). It stays in this browser and is sent only with your messages. On a shared computer, remove it when you finish.</p>
        <div class="row">
          <label class="sr-only" for="ownkey-input">Your ${providerInfo.label} API key</label>
          <input id="ownkey-input" type="password" autocomplete="off" placeholder="Paste your key">
          <button type="button" class="btn" data-key="save">Save key</button>
        </div>
      </details>`);
  }
  $('#ownkey', root)?.addEventListener('click', (e) => {
    const action = e.target.closest('[data-key]')?.dataset.key;
    if (action === 'save') {
      const value = $('#ownkey-input', root).value.replace(/[\s\u200B-\u200D\uFEFF]+/g, '');
      if (value.length < 10) { toast("That doesn't look like a complete key.", 'error'); return; }
      setOwnKey(provider, value);
      if (['need_key', 'own_key'].includes(error?.kind)) error = null;
    } else if (action === 'remove') {
      setOwnKey(provider, '');
    } else {
      return;
    }
    drawKey();
    draw();
  });

  const bubble = (m) => (m.role === 'user'
    ? html`<div class="msg msg-student"><span class="who">You</span><div class="bubble">${String(m.content).split('\n').map((l, i) => html`${i ? html`<br>` : ''}${l}`)}</div></div>`
    : html`<div class="msg msg-ai"><span class="who">${aiName}</span><div class="bubble">${md(m.content)}</div></div>`);

  function draw() {
    mount(log, html`
      ${(a.messages || []).map(bubble)}
      ${pending ? bubble({ role: 'user', content: pending }) : ''}`);
    log.scrollTop = log.scrollHeight;

    const left = Math.max(0, (a.max_turns || 0) - (a.turns || 0));
    mount($('#progress', root), html`
      <div class="meter-row">
        <span>Points made</span>
        <span class="meter" aria-hidden="true">${Array.from({ length: a.criteria_count || 0 }, (_, i) => html`<i class="${i < a.met_count ? 'on' : ''}"></i>`)}</span>
        <span>${a.met_count} of ${a.criteria_count}</span>
      </div>
      <p class="turns ${left <= 3 ? 'is-low' : ''}">${left} of ${a.max_turns} messages left</p>`);

    if (busy === 'sending') {
      mount(status, html`<p class="phase"><span class="dots" aria-hidden="true"></span>${aiName} is reading your argument and replying…</p>`);
    } else if (busy === 'giving-up') {
      mount(status, html`<p class="phase"><span class="dots" aria-hidden="true"></span>Writing your feedback…</p>`);
    } else if (error) {
      const stop = ['closed', 'finished'].includes(error.kind);
      mount(status, html`
        <div class="notice notice-error" role="alert">
          <p>${error.message}</p>
          <div class="row">
            ${stop ? '' : error.kind === 'conflict' ? html`<button class="btn" data-action="reload">Reload</button>` : html`<button class="btn" data-action="retry">Retry</button>`}
          </div>
          ${stop ? '' : html`<p class="hint">Your message is back in the box below, and nothing was lost.</p>`}
        </div>`);
    } else {
      mount(status, '');
    }
    const off = Boolean(busy) || ['closed', 'finished'].includes(error?.kind) || (keyRequired && !myKey());
    input.disabled = off;
    $('#send', root).disabled = off;
    $('#giveup', root).disabled = off;
  }

  async function drawJudge() {
    if (!preview) return;
    try {
      const row = await getAttempt(a.id);
      const criteria = cleanCriteria(row?.task_snapshot?.criteria);
      const met = row?.criteria_met || [];
      const last = (row?.judge_log || []).at(-1);
      mount($('#judge', root), html`
        <h2>What the judge sees</h2>
        <ul class="checklist small">
          ${criteria.map((c, i) => html`<li class="${met.includes(i) ? 'is-met' : 'is-missed'}"><span class="check-icon" aria-hidden="true">${met.includes(i) ? '✓' : '○'}</span><span>${c.text}</span></li>`)}
        </ul>
        ${last ? html`<p class="judge-note">Last turn: ${last.notes || 'no note'}${last.parsed === false ? ' (the judge reply could not be read)' : ''}</p>` : ''}`);
    } catch { /* the panel is a convenience */ }
  }

  async function send(text) {
    busy = 'sending';
    pending = text;
    error = null;
    input.value = '';
    input.dispatchEvent(new Event('input'));
    draw();
    try {
      a = await sendTurn(a.id, token, text, myKey());
      pending = '';
      busy = '';
      if (a.status !== 'in_progress') { onFinished(a); return; }
      draw();
      drawJudge();
      input.focus();
    } catch (ex) {
      pending = '';
      busy = '';
      error = ex;
      if (!['closed', 'finished'].includes(ex.kind)) {
        input.value = text;
        input.dispatchEvent(new Event('input'));
      }
      draw();
    }
  }

  $('#composer', root).addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (text && !busy) send(text);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      $('#composer', root).requestSubmit();
    }
  });
  status.addEventListener('click', (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'retry' && input.value.trim()) send(input.value.trim());
    if (action === 'reload') location.reload();
  });
  $('#giveup', root).addEventListener('click', async () => {
    const ok = await confirmDialog(`Stop now? ${aiName} will not be convinced, and you'll get feedback on the points you made and missed.`, { confirmLabel: 'Stop and see feedback' });
    if (!ok) return;
    busy = 'giving-up';
    error = null;
    draw();
    try {
      a = await giveUp(a.id, token, myKey());
      busy = '';
      onFinished(a);
    } catch (ex) {
      busy = '';
      error = ex;
      draw();
    }
  });

  drawKey();
  draw();
  drawJudge();
  input.focus();
}

// ── Teacher preview ──────────────────────────────────────────────────

export async function taskPreviewView(root, { params: [taskId] }) {
  const task = await getTask(taskId);
  if (!task) {
    mount(root, html`<div class="empty"><p>This task doesn't exist.</p></div>`);
    return;
  }
  const begin = async () => {
    if (!state.site.ai_ready) {
      mount(root, html`
        <nav class="crumbs"><a href="#/teach/t/${task.id}">${task.title}</a></nav>
        <div class="empty"><p>Set up your AI key and model first. Students and previews both use it.</p><a class="btn btn-primary" href="#/settings">Open settings</a></div>`);
      return;
    }
    const r = await startPreview(task.id);
    const attempt = await getAttemptPublic(r.attempt_id, r.token);
    renderDebate(root, {
      attempt,
      token: r.token,
      preview: true,
      onFinished: async (a) => {
        const row = await getAttempt(a.id);
        mount(root, html`
          <nav class="crumbs"><a href="#/teach/t/${task.id}">${task.title}</a></nav>
          ${resultMarkup(rowToResult(row, task), {
            viewer: 'preview',
            actions: html`<div class="row result-actions"><button class="btn btn-primary" id="again">Try again</button><a class="btn" href="#/teach/t/${task.id}/edit">Edit task</a><a class="btn btn-quiet" href="#/teach/t/${task.id}">Back to the task</a></div>`,
          })}`);
        $('#again', root).addEventListener('click', begin);
      },
    });
  };
  await begin();
}

/** Shape a teacher-readable attempt row for resultMarkup. */
export function rowToResult(row, task) {
  const snap = row.task_snapshot || {};
  const criteria = cleanCriteria(snap.criteria ?? task?.criteria);
  return {
    status: row.status,
    score: row.score,
    turns: row.turns,
    messages: row.messages || [],
    debrief: row.debrief,
    started_at: row.started_at,
    finished_at: row.finished_at,
    model: row.model,
    criteria,
    criteria_met: row.criteria_met || [],
    met_count: (row.criteria_met || []).length,
    criteria_count: criteria.length,
    judge_log: row.judge_log || [],
    title: snap.title ?? task?.title,
    course_title: snap.course_title ?? task?.courses?.title,
    persona: snap.persona ?? task?.persona,
  };
}

