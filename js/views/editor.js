import { html, mount, $, $$, navigate, toast, autoGrow } from '../util.js';
import { getCourse, getTask, createTask, updateTask, friendlyError } from '../db.js';
import { TEMPLATES, blankTask } from '../templates.js';
import { STUBBORNNESS, LANGUAGES } from '../tutor.js';

const FIELDS = ['title', 'brief', 'persona', 'opening', 'claim', 'defenses', 'explanation', 'stubbornness', 'language', 'max_turns', 'is_open', 'reveal_criteria', 'allow_retry'];

export async function taskNewView(root, { params: [courseId] }) {
  const course = await getCourse(courseId);
  if (!course) {
    mount(root, html`<div class="empty"><p>This course doesn't exist.</p><a class="btn" href="#/teach">Back to your courses</a></div>`);
    return;
  }
  renderEditor(root, { course, task: { ...blankTask(), ...TEMPLATES[0].task }, isNew: true, templateKey: TEMPLATES[0].key });
}

export async function taskEditView(root, { params: [taskId] }) {
  const task = await getTask(taskId);
  if (!task) {
    mount(root, html`<div class="empty"><p>This task doesn't exist.</p><a class="btn" href="#/teach">Back to your courses</a></div>`);
    return;
  }
  renderEditor(root, { course: task.courses, task, isNew: false });
}

function criterionRow(c, i) {
  return html`
    <li class="criterion" data-index="${i}">
      <span class="criterion-num" aria-hidden="true">${i + 1}</span>
      <div class="criterion-body">
        <label class="criterion-text"><span class="sr-only">Point ${i + 1}</span>
          <textarea name="c-text" rows="2" placeholder="What the student must explain, and why it applies here">${c.text}</textarea></label>
        <div class="row criterion-controls">
          <label class="check"><input type="checkbox" name="c-required" ${c.required ? 'checked' : ''}> Required for the AI to give in</label>
          <label class="criterion-weight">Weight <input type="number" name="c-weight" min="1" max="100" value="${c.weight}"></label>
          <span class="spacer"></span>
          <button type="button" class="btn btn-quiet btn-small" data-remove aria-label="Remove point ${i + 1}">Remove</button>
        </div>
      </div>
    </li>`;
}

function renderEditor(root, { course, task, isNew, templateKey }) {
  let criteria = (task.criteria || []).map((c) => ({ text: c.text || '', required: c.required !== false, weight: c.weight || 10 }));

  mount(root, html`
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/teach">Courses</a><a href="#/teach/c/${course.id}">${course.title}</a>${isNew ? '' : html`<a href="#/teach/t/${task.id}">${task.title}</a>`}</nav>
    <header class="page-head"><h1>${isNew ? 'New task' : 'Edit task'}</h1></header>

    ${isNew ? html`
      <section class="templates">
        <h2 class="section-title">Start from</h2>
        <div class="chips" role="radiogroup" aria-label="Starting point">
          ${TEMPLATES.map((t) => html`<button type="button" class="chip ${t.key === templateKey ? 'is-active' : ''}" role="radio" aria-checked="${t.key === templateKey}" data-template="${t.key}">${t.name}</button>`)}
          <button type="button" class="chip" role="radio" aria-checked="false" data-template="blank">Blank task</button>
        </div>
      </section>` : ''}

    <form id="task-form" class="form task-form" novalidate>
      <fieldset>
        <legend>What students see</legend>
        <label>Task title <input name="title" required></label>
        <label>Instructions for students <textarea name="brief" rows="3"></textarea>
          <span class="hint">Shown before they start. Describe the situation, not the flaw.</span></label>
        <label>The AI's character <input name="persona">
          <span class="hint">Start with a name, for example "Tanvir, a confident market research analyst".</span></label>
        <label>The AI's first message <textarea name="opening" rows="4"></textarea>
          <span class="hint">The character states the wrong claim in their own words.</span></label>
      </fieldset>

      <fieldset>
        <legend>Hidden from students</legend>
        <label>The wrong claim the AI defends <textarea name="claim" rows="3" required></textarea></label>
        <label>Arguments the AI may use <textarea name="defenses" rows="5"></textarea>
          <span class="hint">One per line. Plausible-sounding reasons a believer would give.</span></label>
        <label>The correct explanation <textarea name="explanation" rows="4"></textarea>
          <span class="hint">Used by the judge and in the feedback each student gets at the end.</span></label>
      </fieldset>

      <fieldset>
        <legend>Points the student must make</legend>
        <p class="hint">The AI gives in only when every required point has been explained with reasoning. Weights decide the score out of 100.</p>
        <ol class="criteria" id="criteria"></ol>
        <button type="button" class="btn btn-quiet" data-add>Add a point</button>
      </fieldset>

      <fieldset>
        <legend>Settings</legend>
        <div class="form-cols">
          <label>How stubborn the AI is
            <select name="stubbornness">${Object.entries(STUBBORNNESS).map(([k, v]) => html`<option value="${k}">${v.label}</option>`)}</select>
            <span class="hint">${Object.values(STUBBORNNESS).map((v) => `${v.label}: ${v.hint}`).join(' ')}</span></label>
          <label>Conversation language
            <select name="language">${Object.entries(LANGUAGES).map(([k, v]) => html`<option value="${k}">${v.label}</option>`)}</select></label>
          <label>Messages each student may send <input type="number" name="max_turns" min="3" max="60"></label>
        </div>
        <label class="check"><input type="checkbox" name="is_open"> Open for new attempts</label>
        <label class="check"><input type="checkbox" name="reveal_criteria"> Show the points to students after they finish</label>
        <label class="check"><input type="checkbox" name="allow_retry"> Let students try again after finishing</label>
      </fieldset>

      <p class="form-error" hidden></p>
      <div class="row form-actions">
        <button class="btn btn-primary" type="submit" name="go" value="dash">${isNew ? 'Create task' : 'Save changes'}</button>
        <button class="btn" type="submit" name="go" value="preview">${isNew ? 'Create and try it' : 'Save and try it'}</button>
        <a class="btn btn-quiet" href="${isNew ? `#/teach/c/${course.id}` : `#/teach/t/${task.id}`}">Cancel</a>
      </div>
    </form>
  `);

  const form = $('#task-form', root);
  const list = $('#criteria', root);

  function fill(t) {
    for (const f of FIELDS) {
      const el = form.elements[f];
      if (!el) continue;
      if (el.type === 'checkbox') el.checked = t[f] !== false;
      else el.value = t[f] ?? '';
    }
    criteria = (t.criteria || []).map((c) => ({ text: c.text || '', required: c.required !== false, weight: c.weight || 10 }));
    drawCriteria();
  }

  function readCriteria() {
    criteria = $$('.criterion', list).map((li) => ({
      text: li.querySelector('[name=c-text]').value,
      required: li.querySelector('[name=c-required]').checked,
      weight: Math.max(1, Math.min(100, parseInt(li.querySelector('[name=c-weight]').value, 10) || 10)),
    }));
  }

  function drawCriteria() {
    mount(list, html`${criteria.map(criterionRow)}`);
    $$('textarea', list).forEach((t) => autoGrow(t, 400));
  }

  list.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-remove]');
    if (!rm) return;
    readCriteria();
    criteria.splice(+rm.closest('.criterion').dataset.index, 1);
    drawCriteria();
  });
  $('[data-add]', root).addEventListener('click', () => {
    readCriteria();
    criteria.push({ text: '', required: true, weight: 10 });
    drawCriteria();
    $$('.criterion textarea', list).pop()?.focus();
  });

  root.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-template]');
    if (!chip) return;
    const t = chip.dataset.template === 'blank' ? blankTask() : { ...blankTask(), ...TEMPLATES.find((x) => x.key === chip.dataset.template).task };
    fill(t);
    $$('.chip', root).forEach((c) => { c.classList.toggle('is-active', c === chip); c.setAttribute('aria-checked', String(c === chip)); });
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const go = e.submitter?.value || 'dash';
    readCriteria();
    const err = $('.form-error', form);
    const row = {};
    for (const f of FIELDS) {
      const el = form.elements[f];
      row[f] = el.type === 'checkbox' ? el.checked : (el.type === 'number' ? parseInt(el.value, 10) : el.value.trim());
    }
    row.max_turns = Math.max(3, Math.min(60, row.max_turns || 15));
    row.criteria = criteria.map((c) => ({ ...c, text: c.text.trim() })).filter((c) => c.text);

    const problem = !row.title ? 'Give the task a title.'
      : !row.claim ? 'Write the wrong claim the AI should defend.'
        : !row.criteria.length ? 'Add at least one point the student must make.' : '';
    if (problem) { err.textContent = problem; err.hidden = false; err.scrollIntoView({ block: 'center' }); return; }
    if (!row.opening) row.opening = row.claim;
    err.hidden = true;

    const buttons = $$('button[type=submit]', form);
    buttons.forEach((b) => { b.disabled = true; });
    try {
      const saved = isNew ? await createTask({ ...row, course_id: course.id }) : await updateTask(task.id, row);
      toast(isNew ? 'Task created.' : 'Changes saved.');
      navigate(go === 'preview' ? `/teach/t/${saved.id}/preview` : `/teach/t/${saved.id}`);
    } catch (ex) {
      err.textContent = friendlyError(ex);
      err.hidden = false;
      buttons.forEach((b) => { b.disabled = false; });
    }
  });

  fill(task);
}
