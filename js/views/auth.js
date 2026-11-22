import { html, mount, $, navigate, toast } from '../util.js';
import { auth, friendlyError } from '../db.js';
import { state } from '../state.js';
import { afterSignIn } from '../session.js';
import { CONFIG } from '../site.js';

const demo = html`
  <figure class="hero-demo" aria-label="Example debate">
    <div class="demo-msg demo-ai">
      <span class="who">Tanvir, market research analyst</span>
      <p>We polled 12,000 people on Facebook. With a sample that big the margin of error is under 1%, so <mark class="wrong">this is how the whole country will vote</mark>.</p>
    </div>
    <div class="demo-msg demo-student">
      <span class="who">Student</span>
      <p>A bigger sample shrinks random error, not bias. People without internet never had a chance to be in your sample.</p>
    </div>
    <div class="demo-msg demo-ai">
      <span class="who">Tanvir</span>
      <p>Fair, coverage isn't perfect. But surely the margin of error still tells us how precise we are?</p>
    </div>
    <figcaption class="demo-meter">
      <span>Points made</span>
      <span class="meter" aria-hidden="true"><i class="on"></i><i class="on"></i><i></i><i></i></span>
      <span>2 of 4</span>
    </figcaption>
  </figure>`;

export async function homeView(root) {
  if (state.isTeacher) { navigate('/teach'); return; }
  const s = state.site;
  if (!s.has_owner) {
    mount(root, html`
      <section class="hero">
        <div class="hero-copy">
          <h1>Students learn by arguing an AI out of its mistakes.</h1>
          <p class="lede">You write a flawed claim and the points that refute it. The AI defends the claim, politely and stubbornly, until a student explains properly why it's wrong.</p>
          <p>This copy of ${CONFIG.appName} has no teacher yet. If you installed it, create your teacher account now.</p>
          <div class="row"><a class="btn btn-primary" href="#/setup">Set up ${CONFIG.appName}</a></div>
        </div>
        ${demo}
      </section>`);
    return;
  }
  mount(root, html`
    <section class="hero">
      <div class="hero-copy">
        <h1>Argue the AI out of its mistake.</h1>
        <p class="lede">${s.teacher_name ? `${s.teacher_name} uses ${CONFIG.appName}` : `Your teacher uses ${CONFIG.appName}`} for debate exercises. The AI defends a flawed claim, and you win by explaining, with reasons, why it's wrong.</p>
        <p><strong>Students:</strong> open the task link your teacher shared with you. You'll enter your student ID and email, then the debate starts.</p>
        <p class="small"><a href="#/login">Teacher sign in</a></p>
      </div>
      ${demo}
    </section>`);
}

export async function setupView(root) {
  if (state.site.has_owner) { navigate(state.isTeacher ? '/teach' : '/login'); return; }
  mount(root, html`
    <section class="narrow">
      <h1>Set up ${CONFIG.appName}</h1>
      <p class="muted">Create your teacher account. Only this first account can manage courses and see results; students never need an account.</p>
      <form id="setup" class="form" novalidate>
        <label>Your name <input name="name" autocomplete="name" required>
          <span class="hint">Students see this, for example "Musabbir Hasan Sammak".</span></label>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Password <input name="password" type="password" autocomplete="new-password" minlength="8" required>
          <span class="hint">At least 8 characters.</span></label>
        <p class="form-error" hidden></p>
        <button class="btn btn-primary" type="submit">Create teacher account</button>
      </form>
      <p class="small">Already created your account and confirmed your email? <a href="#/login">Sign in</a></p>
    </section>`);
  const form = $('#setup', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    const btn = $('button', form);
    const v = { name: form.name.value.trim(), email: form.email.value.trim(), password: form.password.value };
    const problem = !v.name ? 'Enter your name.'
      : !/^\S+@\S+\.\S+$/.test(v.email) ? 'Enter a valid email address.'
        : v.password.length < 8 ? 'Use a password with at least 8 characters.' : '';
    if (problem) { err.textContent = problem; err.hidden = false; return; }
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Creating account…';
    try {
      const data = await auth.signUp(v);
      if (data.session) {
        await afterSignIn(data.session, v.name);
        toast('Your teacher account is ready.');
        navigate('/settings');
      } else {
        mount(root, html`
          <section class="narrow">
            <h1>Check your email</h1>
            <p>We sent a confirmation link to <strong>${v.email}</strong>. Open it to finish setting up.</p>
            <p class="small muted">No email after a few minutes? Check your spam folder, and see "Create your teacher account" in the README.</p>
          </section>`);
      }
    } catch (ex) {
      err.textContent = friendlyError(ex);
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Create teacher account';
    }
  });
}

export async function loginView(root, { query }) {
  const next = query.get('next') || '';
  if (state.isTeacher) { navigate(next || '/teach'); return; }
  mount(root, html`
    <section class="narrow">
      <h1>Teacher sign in</h1>
      <p class="muted">Students don't sign in. They open the task link from their teacher.</p>
      <form id="login" class="form" novalidate>
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <label>Password <input name="password" type="password" autocomplete="current-password" required></label>
        <p class="form-error" hidden></p>
        <button class="btn btn-primary" type="submit">Sign in</button>
      </form>
      <p class="small"><a href="#/reset">Forgot your password?</a></p>
    </section>`);
  const form = $('#login', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    const btn = $('button', form);
    err.hidden = true;
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    try {
      const data = await auth.signIn(form.email.value.trim(), form.password.value);
      await afterSignIn(data.session);
      navigate(next && next.startsWith('/teach') || next === '/settings' ? next : '/teach');
    } catch (ex) {
      err.textContent = friendlyError(ex);
      err.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Sign in';
    }
  });
}

export async function resetView(root, { query }) {
  if (query.get('mode') === 'new') {
    mount(root, html`
      <section class="narrow">
        <h1>Choose a new password</h1>
        <form id="newpw" class="form">
          <label>New password <input name="password" type="password" minlength="8" autocomplete="new-password" required></label>
          <p class="form-error" hidden></p>
          <button class="btn btn-primary" type="submit">Save password</button>
        </form>
      </section>`);
    const form = $('#newpw', root);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = $('.form-error', form);
      try {
        await auth.setPassword(form.password.value);
        toast('Password saved.');
        navigate('/teach');
      } catch (ex) {
        err.textContent = friendlyError(ex);
        err.hidden = false;
      }
    });
    return;
  }
  mount(root, html`
    <section class="narrow">
      <h1>Reset your password</h1>
      <p>Enter your teacher account email and we'll send you a link to choose a new password.</p>
      <form id="reset" class="form">
        <label>Email <input name="email" type="email" autocomplete="email" required></label>
        <p class="form-error" hidden></p>
        <button class="btn btn-primary" type="submit">Send reset link</button>
      </form>
      <p class="small"><a href="#/login">Back to sign in</a></p>
    </section>`);
  const form = $('#reset', root);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('.form-error', form);
    try {
      await auth.sendReset(form.email.value.trim());
      mount(root, html`<section class="narrow"><h1>Reset link sent</h1><p>If that email belongs to the teacher account, a link is on its way. It can take a few minutes.</p><a class="btn" href="#/login">Back to sign in</a></section>`);
    } catch (ex) {
      err.textContent = friendlyError(ex);
      err.hidden = false;
    }
  });
}

export function setupNeededView(root) {
  mount(root, html`
    <section class="narrow">
      <h1>${CONFIG.appName} needs one more step</h1>
      <p>This copy isn't connected to a database yet.</p>
      <ol>
        <li>Copy <code>.env.example</code> to <code>.env</code>.</li>
        <li>Fill in <code>SUPABASE_URL</code> and <code>SUPABASE_PUBLISHABLE_KEY</code>.</li>
        <li>Run <code>npm run config</code> (or <code>npm run dev</code>), then reload this page.</li>
      </ol>
      <p>On a hosting platform, set the same values as environment variables and redeploy. The README explains every step.</p>
    </section>`);
}
