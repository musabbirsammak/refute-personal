import { html, mount, $, md, toast, fmtDate, fmtDuration, navigate, confirmDialog } from '../util.js';
import { getAttempt, getTask, deleteAttempt, friendlyError } from '../db.js';
import { characterName, requiredIndices } from '../tutor.js';

function headline(status, aiName, who) {
  const you = who || 'You';
  switch (status) {
    case 'conceded': return `${you} convinced ${aiName}.`;
    case 'gave_up': return `${you} stopped before convincing ${aiName}.`;
    case 'max_turns': return `${you} ran out of messages before convincing ${aiName}.`;
    default: return 'Still in progress.';
  }
}

function plain(text) {
  return html`${String(text || '').split('\n').map((line, i) => html`${i ? html`<br>` : ''}${line}`)}`;
}

export function transcriptMarkup(messages, { aiName, judgeLog = [], showJudge = false }) {
  let studentTurn = 0;
  return html`
    <ol class="transcript">
      ${messages.map((m) => {
        if (m.role === 'user') {
          studentTurn += 1;
          const j = showJudge ? judgeLog.find((x) => x.turn === studentTurn) : null;
          return html`<li class="t-msg t-student"><span class="who">Student</span><div class="t-body">${plain(m.content)}</div>
            ${j ? html`<p class="judge-note">${j.newly?.length ? html`<strong>New: ${j.newly.map((i) => `point ${i + 1}`).join(', ')}.</strong> ` : ''}${j.notes || ''}</p>` : ''}</li>`;
        }
        return html`<li class="t-msg t-ai"><span class="who">${aiName}</span><div class="t-body">${md(m.content)}</div></li>`;
      })}
    </ol>`;
}

/**
 * r: { status, score, turns, messages, debrief, started_at, finished_at, model,
 *      criteria (array, or null when hidden), criteria_met, met_count, criteria_count,
 *      judge_log?, title, course_title, persona }
 * viewer: 'student' | 'teacher' | 'preview'
 */
export function resultMarkup(r, { viewer = 'student', studentCode = '', studentEmail = '', actions = '' } = {}) {
  const aiName = characterName(r.persona);
  const isTeacher = viewer === 'teacher' || viewer === 'preview';
  const done = r.status !== 'in_progress';
  const criteria = r.criteria;
  const met = r.criteria_met || [];
  const req = new Set(criteria ? requiredIndices(criteria) : []);
  const who = viewer === 'teacher' ? (studentCode || 'The student') : '';

  return html`
    <article class="result">
      <header class="result-head">
        <div class="result-title">
          <p class="muted">${r.course_title ? `${r.course_title}: ` : ''}${r.title}</p>
          <h1>${headline(r.status, aiName, who)}</h1>
          <dl class="result-meta">
            ${studentCode && viewer !== 'preview' ? html`<div><dt>Student ID</dt><dd>${studentCode}</dd></div>` : ''}
            ${studentEmail ? html`<div><dt>Email</dt><dd>${studentEmail}</dd></div>` : ''}
            <div><dt>Messages sent</dt><dd>${r.turns}</dd></div>
            ${done && r.finished_at ? html`<div><dt>Finished</dt><dd>${fmtDate(r.finished_at)}</dd></div>` : html`<div><dt>Started</dt><dd>${fmtDate(r.started_at)}</dd></div>`}
            ${done && r.started_at ? html`<div><dt>Time taken</dt><dd>${fmtDuration(r.started_at, r.finished_at) || '–'}</dd></div>` : ''}
            ${r.model ? html`<div><dt>AI model</dt><dd>${r.model}</dd></div>` : ''}
          </dl>
        </div>
        ${done ? html`<div class="mark" role="img" aria-label="Score ${r.score} out of 100"><span class="mark-num">${r.score}</span><span class="mark-den">/ 100</span></div>` : ''}
      </header>

      ${actions}

      ${criteria ? html`
        <section class="result-section">
          <h2>Points to make</h2>
          <ul class="checklist">
            ${criteria.map((c, i) => html`
              <li class="${met.includes(i) ? 'is-met' : 'is-missed'}">
                <span class="check-icon" aria-hidden="true">${met.includes(i) ? '✓' : '✗'}</span>
                <span><span class="sr-only">${met.includes(i) ? 'Made: ' : 'Missed: '}</span>${c.text}
                  <span class="tag ${req.has(i) ? '' : 'tag-soft'}">${req.has(i) ? 'Required' : 'Bonus'}</span></span>
              </li>`)}
          </ul>
        </section>` : done ? html`
        <section class="result-section"><h2>Points to make</h2><p class="muted">You made ${r.met_count} of ${r.criteria_count} points. Your teacher has chosen not to show the list.</p></section>` : ''}

      ${r.debrief ? html`<section class="result-section feedback"><h2>Feedback</h2><div class="prose">${md(r.debrief)}</div></section>` : ''}

      <section class="result-section">
        <details class="transcript-wrap" ${done ? '' : 'open'}>
          <summary><h2>The full conversation</h2></summary>
          ${transcriptMarkup(r.messages || [], { aiName, judgeLog: r.judge_log || [], showJudge: isTeacher })}
        </details>
      </section>
    </article>`;
}

/** Buttons under a student's own result. */
export function studentResultActions(a, token) {
  return html`
    <div class="row result-actions no-print">
      <button class="btn btn-primary" data-action="copy">Copy result link</button>
      <button class="btn" data-action="print">Print or save as PDF</button>
      ${a.allow_retry && !a.is_preview ? html`<a class="btn" href="#/t/${a.task_id}">Try again</a>` : ''}
    </div>
    ${a.is_preview ? '' : html`<p class="hint no-print">Your teacher can already see this result. Keep the link if you want to look at it again.</p>`}`;
}

// ── Teacher opens one student's result ───────────────────────────────

export async function teacherResultView(root, { params: [id] }) {
  const { rowToResult } = await import('./student.js');
  const row = await getAttempt(id);
  if (!row) {
    mount(root, html`<div class="empty"><p>This result doesn't exist any more.</p><a class="btn" href="#/teach">Back to your courses</a></div>`);
    return;
  }
  const task = await getTask(row.task_id);
  mount(root, html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/teach">Courses</a>${task ? html`<a href="#/teach/c/${task.course_id}">${task.courses?.title || 'Course'}</a><a href="#/teach/t/${task.id}">${task.title}</a>` : ''}</nav>
    ${resultMarkup(rowToResult(row, task), {
      viewer: 'teacher',
      studentCode: row.student_code,
      studentEmail: row.student_email,
      actions: html`
        <div class="row result-actions no-print">
          <button class="btn" data-action="print">Print or save as PDF</button>
          <a class="btn btn-quiet" href="#/teach/t/${row.task_id}">All results for this task</a>
          <span class="spacer"></span>
          <button class="btn btn-danger-quiet" data-action="delete">Delete this attempt</button>
        </div>`,
    })}`);

  root.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (action === 'print') {
      const d = $('.transcript-wrap', root);
      if (d) d.open = true;
      window.print();
    }
    if (action === 'delete') {
      const ok = await confirmDialog(`Delete ${row.student_code}'s attempt? Their result is removed, and they can start the task again. This can't be undone.`, { confirmLabel: 'Delete attempt', danger: true });
      if (!ok) return;
      try {
        await deleteAttempt(row.id);
        toast('Attempt deleted.');
        navigate(`/teach/t/${row.task_id}`);
      } catch (ex) {
        toast(friendlyError(ex), 'error');
      }
    }
  });
}
