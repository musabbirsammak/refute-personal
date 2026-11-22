import {
  html, mount, $, navigate, toast, copyText, fmtDate, shareUrl, downloadFile, toCSV, slug, confirmDialog,
} from '../util.js';
import {
  listCourses, getCourse, createCourse, updateCourse, deleteCourse,
  listTasks, getTask, createTask, updateTask, deleteTask, listTaskAttempts, friendlyError,
} from '../db.js';
import { STATUS_TEXT, cleanCriteria, requiredIndices } from '../tutor.js';

const countOf = (rel) => (Array.isArray(rel) && rel[0]?.count) || 0;

// ── Courses list ─────────────────────────────────────────────────────

export async function teacherHomeView(root) {
  const courses = await listCourses();
  mount(root, html`
    <header class="page-head">
      <div>
        <h1>Your courses</h1>
        <p class="muted">Each course holds the debate tasks you share with one class.</p>
      </div>
      <button class="btn btn-primary" data-action="new">New course</button>
    </header>
    <form id="course-form" class="form inline-form" hidden>
      <h2>New course</h2>
      <div class="form-cols">
        <label>Course title <input name="title" required placeholder="Statistics 101"></label>
        <label>Course code <span class="opt">optional</span> <input name="code" placeholder="STA101"></label>
      </div>
      <label>Description <span class="opt">optional</span> <textarea name="description" rows="2" placeholder="Section, semester or anything that helps you tell courses apart"></textarea></label>
      <p class="form-error" hidden></p>
      <div class="row">
        <button class="btn btn-primary" type="submit">Create course</button>
        <button class="btn btn-quiet" type="button" data-action="cancel">Cancel</button>
      </div>
    </form>
    ${courses.length ? html`
      <ul class="list">
        ${courses.map((c) => html`
          <li><a class="list-row" href="#/teach/c/${c.id}">
            <span class="list-main"><strong>${c.title}</strong>${c.code ? html` <span class="code">${c.code}</span>` : ''}
              ${c.description ? html`<span class="muted list-sub">${c.description}</span>` : ''}</span>
            <span class="list-meta">${countOf(c.tasks)} ${countOf(c.tasks) === 1 ? 'task' : 'tasks'}</span>
          </a></li>`)}
      </ul>` : html`
      <div class="empty">
        <p>No courses yet. Create one for each class you teach, then add debate tasks to it.</p>
      </div>`}
  `);
  const form = $('#course-form', root);
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-action]')?.dataset.action;
    if (a === 'new') { form.hidden = false; form.title.focus(); }
    if (a === 'cancel') { form.hidden = true; form.reset(); }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = form.title.value.trim();
    if (!title) return;
    try {
      const c = await createCourse({ title, code: form.code.value.trim() || null, description: form.description.value.trim() || null });
      toast('Course created.');
      navigate(`/teach/c/${c.id}`);
    } catch (ex) {
      const err = $('.form-error', form);
      err.textContent = friendlyError(ex);
      err.hidden = false;
    }
  });
}

// ── One course ───────────────────────────────────────────────────────

export async function courseView(root, { params: [courseId] }) {
  const [course, tasks] = await Promise.all([getCourse(courseId), listTasks(courseId)]);
  if (!course) {
    mount(root, html`<div class="empty"><p>This course doesn't exist.</p><a class="btn" href="#/teach">Back to your courses</a></div>`);
    return;
  }
  const roster = course.roster || [];
  mount(root, html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/teach">Courses</a></nav>
    <header class="page-head">
      <div>
        <h1>${course.title}${course.code ? html` <span class="code">${course.code}</span>` : ''}</h1>
        ${course.description ? html`<p class="muted">${course.description}</p>` : ''}
      </div>
      <div class="row">
        <a class="btn btn-primary" href="#/teach/c/${course.id}/new">New task</a>
        <button class="btn btn-quiet" data-action="edit">Edit course</button>
      </div>
    </header>
    <form id="course-form" class="form inline-form" hidden>
      <h2>Edit course</h2>
      <div class="form-cols">
        <label>Course title <input name="title" required value="${course.title}"></label>
        <label>Course code <span class="opt">optional</span> <input name="code" value="${course.code || ''}"></label>
      </div>
      <label>Description <span class="opt">optional</span> <textarea name="description" rows="2">${course.description || ''}</textarea></label>
      <div class="row">
        <button class="btn btn-primary" type="submit">Save course</button>
        <button class="btn btn-quiet" type="button" data-action="cancel">Cancel</button>
        <span class="spacer"></span>
        <button class="btn btn-danger-quiet" type="button" data-action="delete">Delete course</button>
      </div>
    </form>
    <h2 class="section-title">Tasks</h2>
    ${tasks.length ? html`
      <ul class="list">
        ${tasks.map((t) => html`
          <li class="list-row-wrap">
            <a class="list-row" href="#/teach/t/${t.id}">
              <span class="list-main"><strong>${t.title}</strong></span>
              <span class="list-meta">
                <span class="tag ${t.is_open ? 'tag-open' : 'tag-closed'}">${t.is_open ? 'Link open' : 'Link off'}</span>
                ${countOf(t.attempts)} ${countOf(t.attempts) === 1 ? 'attempt' : 'attempts'}
              </span>
            </a>
            <button class="btn btn-quiet btn-small" data-copy="${t.id}">Copy student link</button>
          </li>`)}
      </ul>` : html`
      <div class="empty">
        <p>No tasks yet. A task is one flawed claim for students to argue against. Start from a ready-made statistics scenario or write your own.</p>
        <a class="btn btn-primary" href="#/teach/c/${course.id}/new">Create the first task</a>
      </div>`}

    <section class="roster">
      <h2 class="section-title">Class list</h2>
      <p class="muted">${roster.length
        ? `Only these ${roster.length} student IDs can start this course's tasks. Anyone else is refused, so made-up IDs can't use your AI key.`
        : 'Optional. Paste your students\' IDs and only those IDs can start this course\'s tasks. While the list is empty, anyone with a task link can join.'}</p>
      <form id="roster-form" class="form">
        <label><span class="sr-only">Student IDs</span>
          <textarea name="roster" rows="6" spellcheck="false" placeholder="One student ID per line, for example&#10;221-35-1042&#10;221-35-1043">${roster.join('\n')}</textarea>
          <span class="hint">One per line, or separated by commas or spaces. Letters are matched without regard to case.</span></label>
        <div class="row">
          <button class="btn" type="submit">Save class list</button>
          ${roster.length ? html`<button class="btn btn-quiet" type="button" data-action="clear-roster">Clear the list</button>` : ''}
        </div>
      </form>
    </section>
  `);
  const form = $('#course-form', root);
  const saveRoster = async (ids) => {
    try {
      const saved = await updateCourse(course.id, { roster: ids });
      toast(saved.roster.length ? `Class list saved: ${saved.roster.length} IDs.` : 'Class list cleared. Anyone with a link can join.');
      navigate(`/teach/c/${course.id}`);
    } catch (ex) { toast(friendlyError(ex), 'error'); }
  };
  $('#roster-form', root).addEventListener('submit', (e) => {
    e.preventDefault();
    saveRoster(e.target.roster.value.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean));
  });
  root.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-copy]');
    if (copy) {
      await copyText(shareUrl(`/t/${copy.dataset.copy}`));
      toast('Student link copied.');
      return;
    }
    const a = e.target.closest('[data-action]')?.dataset.action;
    if (a === 'edit') form.hidden = false;
    if (a === 'cancel') form.hidden = true;
    if (a === 'clear-roster') {
      const ok = await confirmDialog('Clear the class list? Anyone with a task link will be able to join.', { confirmLabel: 'Clear the list' });
      if (ok) saveRoster([]);
    }
    if (a === 'delete') {
      const ok = await confirmDialog(`Delete "${course.title}"? This also deletes its ${tasks.length} tasks and every student result in them. This can't be undone.`, { confirmLabel: 'Delete course', danger: true });
      if (!ok) return;
      try { await deleteCourse(course.id); toast('Course deleted.'); navigate('/teach'); } catch (ex) { toast(friendlyError(ex), 'error'); }
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await updateCourse(course.id, { title: form.title.value.trim(), code: form.code.value.trim() || null, description: form.description.value.trim() || null });
      toast('Course saved.');
      navigate(`/teach/c/${course.id}`);
    } catch (ex) { toast(friendlyError(ex), 'error'); }
  });
}

// ── Task dashboard ───────────────────────────────────────────────────

function summarize(task, attempts) {
  const criteria = cleanCriteria(task.criteria);
  const finished = attempts.filter((a) => a.status !== 'in_progress');
  const students = new Set(attempts.map((a) => a.student_code)).size;
  const convinced = finished.filter((a) => a.status === 'conceded').length;
  const avg = finished.length ? Math.round(finished.reduce((s, a) => s + (a.score || 0), 0) / finished.length) : null;
  const turns = finished.map((a) => a.turns || 0).sort((x, y) => x - y);
  const median = turns.length ? turns[Math.floor((turns.length - 1) / 2)] : null;
  const perCriterion = criteria.map((c, i) => ({
    ...c,
    rate: finished.length ? Math.round((finished.filter((a) => (a.criteria_met || []).includes(i)).length / finished.length) * 100) : 0,
  }));
  return { criteria, finished, students, convinced, avg, median, perCriterion };
}

export async function taskDashboardView(root, { params: [taskId] }) {
  const [task, attempts] = await Promise.all([getTask(taskId), listTaskAttempts(taskId)]);
  if (!task) {
    mount(root, html`<div class="empty"><p>This task doesn't exist.</p><a class="btn" href="#/teach">Back to your courses</a></div>`);
    return;
  }
  const course = task.courses || {};
  const link = shareUrl(`/t/${task.id}`);
  const st = summarize(task, attempts);
  const req = new Set(requiredIndices(st.criteria));

  mount(root, html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/teach">Courses</a><a href="#/teach/c/${course.id}">${course.title}</a></nav>
    <header class="page-head">
      <div>
        <h1>${task.title}</h1>
        <p class="muted">${task.persona}</p>
      </div>
      <div class="row">
        <a class="btn" href="#/teach/t/${task.id}/edit">Edit task</a>
        <a class="btn" href="#/teach/t/${task.id}/preview">Try it yourself</a>
        <details class="menu">
          <summary class="btn btn-quiet" aria-label="More actions">More</summary>
          <div class="menu-items">
            <button data-action="duplicate">Duplicate task</button>
            <button data-action="delete" class="danger">Delete task</button>
          </div>
        </details>
      </div>
    </header>

    <section class="share">
      <label for="share-link">Student link</label>
      <div class="row">
        <input id="share-link" value="${link}" readonly>
        <button class="btn btn-primary" data-action="copy">Copy link</button>
      </div>
      <label class="switch"><input type="checkbox" role="switch" data-action="open" ${task.is_open ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span>
        <span class="switch-label">${task.is_open ? 'Link is open: students can start and continue' : 'Link is off: nobody can start or continue'}</span></label>
      <p class="hint">Share the link in Google Classroom, your LMS or a group chat. Students enter their student ID and email, argue, and their results appear below. Switch the link off when the class is done so it can't use up your AI key.</p>
    </section>

    <section>
      <h2 class="section-title">Class summary</h2>
      <dl class="figures">
        <div><dt>Students</dt><dd>${st.students}</dd></div>
        <div><dt>Finished attempts</dt><dd>${st.finished.length}</dd></div>
        <div><dt>Convinced the AI</dt><dd>${st.finished.length ? `${Math.round((st.convinced / st.finished.length) * 100)}%` : '–'}</dd></div>
        <div><dt>Average score</dt><dd>${st.avg ?? '–'}</dd></div>
        <div><dt>Typical messages used</dt><dd>${st.median ?? '–'}</dd></div>
      </dl>
    </section>

    <section>
      <h2 class="section-title">Which points students made</h2>
      ${st.finished.length ? '' : html`<p class="muted">This fills in as students finish the task.</p>`}
      <ul class="criteria-bars">
        ${st.perCriterion.map((c, i) => html`
          <li>
            <div class="bar-label"><span>${c.text}</span>${req.has(i) ? html`<span class="tag">Required</span>` : html`<span class="tag tag-soft">Bonus</span>`}</div>
            <div class="bar" role="img" aria-label="${c.rate}% of finished attempts"><span style="width:${c.rate}%"></span></div>
            <span class="bar-value">${st.finished.length ? `${c.rate}%` : ''}</span>
          </li>`)}
      </ul>
    </section>

    <section>
      <div class="section-head">
        <h2 class="section-title">Results</h2>
        <div class="row">
          <button class="btn btn-quiet" data-action="refresh">Refresh</button>
          <button class="btn btn-quiet" data-action="csv" ${attempts.length ? '' : 'disabled'}>Download CSV</button>
        </div>
      </div>
      ${attempts.length ? html`
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>Student ID</th><th>Email</th><th>Outcome</th><th class="num">Score</th><th class="num">Messages</th><th>Last activity</th><th><span class="sr-only">Open</span></th></tr></thead>
            <tbody>
              ${attempts.map((a) => html`
                <tr>
                  <td>${a.student_code}</td>
                  <td>${a.student_email}</td>
                  <td><span class="outcome outcome-${a.status}">${STATUS_TEXT[a.status]}</span></td>
                  <td class="num">${a.status === 'in_progress' ? '' : a.score}</td>
                  <td class="num">${a.turns}</td>
                  <td>${fmtDate(a.updated_at)}</td>
                  <td><a href="#/teach/r/${a.id}">View</a></td>
                </tr>`)}
            </tbody>
          </table>
        </div>` : html`<div class="empty"><p>No attempts yet. Copy the student link above and share it with your class.</p></div>`}
    </section>
  `);

  root.addEventListener('click', async (e) => {
    const a = e.target.closest('[data-action]')?.dataset.action;
    if (!a || a === 'open') return;
    if (a === 'copy') { await copyText(link); toast('Student link copied.'); }
    if (a === 'refresh') navigate(`/teach/t/${task.id}`);
    if (a === 'csv') {
      const rows = [['Student ID', 'Email', 'Outcome', 'Score', 'Messages', ...st.criteria.map((_, i) => `Point ${i + 1}`), 'Model', 'Started', 'Finished']];
      for (const t of attempts) {
        rows.push([
          t.student_code, t.student_email, STATUS_TEXT[t.status],
          t.status === 'in_progress' ? '' : t.score, t.turns,
          ...st.criteria.map((_, i) => ((t.criteria_met || []).includes(i) ? 'yes' : 'no')),
          t.model, t.started_at, t.finished_at,
        ]);
      }
      downloadFile(`${slug(task.title)}-results.csv`, toCSV(rows), 'text/csv');
    }
    if (a === 'duplicate') {
      const {
        id, courses, created_at, updated_at, teacher_id, ...rest
      } = task;
      try {
        const copy = await createTask({ ...rest, title: `${task.title} (copy)` });
        toast('Task duplicated.');
        navigate(`/teach/t/${copy.id}/edit`);
      } catch (ex) { toast(friendlyError(ex), 'error'); }
    }
    if (a === 'delete') {
      const ok = await confirmDialog(`Delete "${task.title}" and its ${attempts.length} student results? This can't be undone.`, { confirmLabel: 'Delete task', danger: true });
      if (!ok) return;
      try { await deleteTask(task.id); toast('Task deleted.'); navigate(`/teach/c/${course.id}`); } catch (ex) { toast(friendlyError(ex), 'error'); }
    }
  });
  $('[data-action="open"]', root).addEventListener('change', async (e) => {
    try {
      await updateTask(task.id, { is_open: e.target.checked });
      $('.switch-label', root).textContent = e.target.checked ? 'Link is open: students can start and continue' : 'Link is off: nobody can start or continue';
      toast(e.target.checked ? 'Link switched on.' : 'Link switched off. Nobody can start or continue this task.');
    } catch (ex) {
      e.target.checked = !e.target.checked;
      toast(friendlyError(ex), 'error');
    }
  });
}

