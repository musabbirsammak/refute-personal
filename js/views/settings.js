import { html, mount, $, toast, fmtDate } from '../util.js';
import { updateSite, friendlyError } from '../db.js';
import { state } from '../state.js';
import { refreshSite } from '../session.js';
import { PROVIDERS, aiStatus, listModels, saveAi, testAi, setStudentKeys } from '../ai.js';

export async function settingsView(root) {
  const s = state.site;
  mount(root, html`
    <header class="page-head"><h1>Settings</h1></header>
    <section class="settings-grid">
      <div>
        <h2>AI for your students</h2>
        <p class="muted">Every student uses the provider, model and key you set here, so everyone argues with the same AI. The key stays on the server: no student's browser ever receives it.</p>
        <div id="ai"></div>
      </div>
      <div>
        <h2>Your details</h2>
        <form id="site" class="form">
          <label>Your name <input name="name" value="${s.teacher_name}" required>
            <span class="hint">Students see this on every task page.</span></label>
          <label>Institution <span class="opt">optional</span> <input name="institution" value="${s.institution}"></label>
          <p class="small muted">Signed in as ${state.session?.user?.email}</p>
          <button class="btn" type="submit">Save details</button>
        </form>
      </div>
    </section>`);

  $('#site', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await updateSite(f.name.value.trim(), f.institution.value.trim());
      await refreshSite();
      toast('Details saved.');
    } catch (ex) {
      toast(friendlyError(ex), 'error');
    }
  });

  renderAiPanel($('#ai', root));
}

function renderAiPanel(container) {
  let status = null;       // { configured, provider, model, key_hint, updated_at }
  let provider = 'groq';
  let models = [];
  let model = '';
  let busy = '';
  let message = null;      // { kind, text }

  const keyInput = () => $('input[name=apikey]', container);
  const typedKey = () => (keyInput()?.value || '').trim();
  const savedKeyApplies = () => status?.configured && status.provider === provider;

  function draw() {
    const p = PROVIDERS[provider];
    mount(container, html`
      <div class="ai-panel">
        <div class="ai-status ${status?.configured ? 'is-ready' : ''}">
          ${status === null ? html`<p class="muted">Checking your AI settings…</p>`
            : status.configured ? html`
              <p><strong>Ready.</strong> Students use ${PROVIDERS[status.provider]?.label || status.provider}, model <code>${status.model}</code>, ${status.require_student_keys ? html`with <strong>their own keys</strong>. Your key (ending in <code>${status.key_hint}</code>) is used only for your previews.` : html`with your key ending in <code>${status.key_hint}</code>. Students may use their own key instead.`}</p>
              ${status.updated_at ? html`<p class="small muted">Last changed ${fmtDate(status.updated_at)}</p>` : ''}`
              : html`<p><strong>Not set up yet.</strong> Students can't start a debate until you save a key and model below.</p>`}
        </div>

        <fieldset class="engine-choices">
          <legend>Provider</legend>
          ${Object.entries(PROVIDERS).map(([k, v]) => html`
            <label class="engine-choice ${provider === k ? 'is-selected' : ''}">
              <input type="radio" name="provider" value="${k}" ${provider === k ? 'checked' : ''}>
              <span><strong>${v.label}</strong><span class="hint">${k === 'groq' ? 'Fast open models. Free key, no card.' : 'Strong reasoning. Free key with a Google account (18+).'}</span></span>
            </label>`)}
        </fieldset>

        <div class="engine-config">
          <label>${p.label} API key
            <span class="row">
              <input type="password" name="apikey" autocomplete="off" spellcheck="false"
                placeholder="${savedKeyApplies() ? `Saved key ending in ${status.key_hint}: leave empty to keep it` : `Paste your key (${p.keyHint})`}">
              <button type="button" class="btn btn-quiet" data-action="reveal">Show</button>
            </span>
            <span class="hint">No key yet? <a href="${p.keyUrl}" target="_blank" rel="noopener">Get a free ${p.label} key</a>.</span>
          </label>
          <label>Model
            <span class="row">
              <select name="model" ${models.length ? '' : 'disabled'}>
                ${models.length
                  ? models.map((m) => html`<option value="${m}" ${m === model ? 'selected' : ''}>${m}</option>`)
                  : html`<option>${savedKeyApplies() ? status.model : 'Load the model list first'}</option>`}
              </select>
              <button type="button" class="btn btn-quiet" data-action="models" ${busy ? 'disabled' : ''}>${busy === 'models' ? 'Loading…' : (models.length ? 'Refresh' : 'Load models')}</button>
            </span>
          </label>
        </div>

        ${message ? html`<p class="status status-${message.kind}" role="status">${message.text}</p>` : ''}
        <div class="row">
          <button type="button" class="btn btn-primary" data-action="save" ${busy || !models.length ? 'disabled' : ''}>${busy === 'save' ? 'Checking and saving…' : 'Save AI settings'}</button>
          ${status?.configured ? html`<button type="button" class="btn btn-quiet" data-action="test" ${busy ? 'disabled' : ''}>${busy === 'test' ? 'Testing…' : 'Test saved settings'}</button>` : ''}
        </div>
        ${status?.configured ? html`
          <label class="check">
            <input type="checkbox" name="student_keys" ${status.require_student_keys ? 'checked' : ''} ${busy ? 'disabled' : ''}>
            <span>Students must use their own ${PROVIDERS[status.provider]?.label || ''} key <span class="hint">Each student pastes a free key on the debate page, with the same model you chose. Your key is then used only for your previews, so your limits aren't shared.</span></span>
          </label>` : ''}
        <p class="hint">Unless students use their own keys, they all share this key's limits. Free keys allow a limited number of requests per minute and per day, and each student message uses two. For a whole class at once, check your provider's limits or use a paid key. You can switch any task's link off at any time.</p>
      </div>`);
  }

  async function loadStatus() {
    try {
      status = await aiStatus();
      if (status.configured) { provider = status.provider; model = status.model; }
    } catch (e) {
      status = { configured: false };
      message = { kind: 'error', text: e.message };
    }
    draw();
  }

  container.addEventListener('change', (e) => {
    if (e.target.name === 'provider') {
      const key = typedKey();
      provider = e.target.value;
      models = [];
      model = savedKeyApplies() ? status.model : '';
      message = null;
      draw();
      if (key) keyInput().value = '';
    }
    if (e.target.name === 'model') model = e.target.value;
    if (e.target.name === 'student_keys') {
      const required = e.target.checked;
      busy = 'keys';
      draw();
      setStudentKeys(required)
        .then(async (r) => {
          status = r;
          await refreshSite();
          toast(required ? 'Students now use their own keys.' : "Students now use your key (or their own, if they add one).");
        })
        .catch((ex) => { message = { kind: 'error', text: ex.message }; })
        .finally(() => { busy = ''; draw(); });
    }
  });

  container.addEventListener('click', async (e) => {
    const action = e.target.closest('[data-action]')?.dataset.action;
    if (!action) return;
    if (action === 'reveal') {
      const input = keyInput();
      input.type = input.type === 'password' ? 'text' : 'password';
      e.target.textContent = input.type === 'password' ? 'Show' : 'Hide';
      return;
    }
    const key = typedKey();
    busy = action;
    message = action === 'save' ? { kind: 'info', text: 'Checking that the key and model work…' } : null;
    draw();
    if (key) keyInput().value = key;
    try {
      if (action === 'models') {
        const r = await listModels(provider, key);
        models = r.models;
        model = models.includes(model) ? model : r.suggested;
        message = { kind: 'ok', text: `Key works. ${models.length} models available.` };
      } else if (action === 'save') {
        status = await saveAi({ provider, model, apiKey: key });
        await refreshSite();
        message = { kind: 'ok', text: 'Saved. Students now use this model.' };
        toast('AI settings saved.');
      } else if (action === 'test') {
        await testAi();
        message = { kind: 'ok', text: 'The saved settings work.' };
      }
    } catch (ex) {
      message = { kind: 'error', text: ex.message };
    }
    busy = '';
    draw();
    if (key && action !== 'save') keyInput().value = key;
  });

  draw();
  loadStatus();
}
