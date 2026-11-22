import { html, mount, $, navigate, loading, toast } from './util.js';
import { configured, auth, friendlyError } from './db.js';
import { refreshSite, afterSignIn, signOut } from './session.js';
import { state } from './state.js';
import { CONFIG } from './site.js';
import { homeView, setupView, loginView, resetView, setupNeededView } from './views/auth.js';
import { teacherHomeView, courseView, taskDashboardView } from './views/teacher.js';
import { taskNewView, taskEditView } from './views/editor.js';
import { studentEntryView, debateView, taskPreviewView } from './views/student.js';
import { teacherResultView } from './views/result.js';
import { settingsView } from './views/settings.js';

const ID = '([0-9a-fA-F-]{36})';
const routes = [
  { re: /^\/$/, view: homeView, title: '' },
  { re: /^\/setup$/, view: setupView, title: 'Set up' },
  { re: /^\/login$/, view: loginView, title: 'Teacher sign in' },
  { re: /^\/reset$/, view: resetView, title: 'Reset password' },
  { re: /^\/settings$/, view: settingsView, teacher: true, title: 'Settings' },
  { re: /^\/teach$/, view: teacherHomeView, teacher: true, title: 'Courses' },
  { re: new RegExp(`^/teach/c/${ID}$`), view: courseView, teacher: true, title: 'Course' },
  { re: new RegExp(`^/teach/c/${ID}/new$`), view: taskNewView, teacher: true, title: 'New task' },
  { re: new RegExp(`^/teach/t/${ID}$`), view: taskDashboardView, teacher: true, title: 'Task' },
  { re: new RegExp(`^/teach/t/${ID}/edit$`), view: taskEditView, teacher: true, title: 'Edit task' },
  { re: new RegExp(`^/teach/t/${ID}/preview$`), view: taskPreviewView, teacher: true, title: 'Preview' },
  { re: new RegExp(`^/teach/r/${ID}$`), view: teacherResultView, teacher: true, title: 'Result' },
  { re: new RegExp(`^/t/${ID}$`), view: studentEntryView, title: 'Debate' },
  { re: new RegExp(`^/a/${ID}$`), view: debateView, title: 'Debate' },
];

const viewEl = () => document.getElementById('view');
let renderSeq = 0;

function siteTitle() {
  return state.site.teacher_name ? `${CONFIG.appName} | ${state.site.teacher_name}` : CONFIG.appName;
}

function renderBranding() {
  document.querySelectorAll('[data-app-name]').forEach((el) => { el.textContent = CONFIG.appName; });
  const who = document.querySelector('[data-teacher]');
  if (who) {
    who.textContent = state.site.teacher_name || '';
    who.hidden = !state.site.teacher_name;
  }
  const footer = document.getElementById('footer');
  if (footer) {
    const s = state.site;
    mount(footer, html`
      <div class="footer-inner">
        <p>${s.teacher_name ? `${CONFIG.appName} for ${s.teacher_name}${s.institution ? `, ${s.institution}` : ''}.` : `${CONFIG.appName}.`}</p>
        <p>Open-source software under the MIT License.${CONFIG.sourceUrl ? html` <a href="${CONFIG.sourceUrl}" rel="noopener">Source code</a>` : ''}</p>
      </div>`);
  }
}

function renderHeader() {
  const nav = document.getElementById('nav');
  const here = location.hash.slice(1).split('?')[0] || '/';
  const link = (href, label) => html`<a href="#${href}" ${here === href || here.startsWith(href + '/') ? html`aria-current="page"` : ''}>${label}</a>`;
  if (!state.isTeacher) {
    mount(nav, '');
    return;
  }
  mount(nav, html`
    ${link('/teach', 'Courses')}
    ${link('/settings', 'Settings')}
    <button class="btn btn-quiet btn-small" id="signout">Sign out</button>`);
  $('#signout', nav).addEventListener('click', async () => {
    await signOut();
    navigate('/');
  });
}

async function render() {
  // A fresh element for every page, so click handlers from earlier pages
  // (attached to the page element) can't pile up and fire on this one.
  const old = viewEl();
  const root = old.cloneNode(false);
  old.replaceWith(root);
  const hash = location.hash.slice(1) || '/';
  if (/error_description=/.test(hash)) {
    const p = new URLSearchParams(hash.replace(/^.*?(error)/, '$1'));
    mount(root, html`<div class="notice notice-error" role="alert"><p>That link didn't work: ${p.get('error_description') || 'it may have expired'}.</p><a class="btn" href="#/login">Go to sign in</a></div>`);
    return;
  }
  if (/access_token=|type=recovery|type=signup/.test(hash)) {
    if (state.session && !/type=recovery/.test(hash)) { navigate('/'); return; }
    mount(root, loading('Signing you in…'));
    return;
  }
  const [path, qs = ''] = hash.split('?');
  const query = new URLSearchParams(qs);
  const route = routes.find((r) => r.re.test(path));
  const seq = ++renderSeq;
  renderHeader();
  window.scrollTo(0, 0);

  if (!route) {
    mount(root, html`<div class="empty"><p>There's nothing at this address.</p><a class="btn" href="#/">Go to the start page</a></div>`);
    return;
  }
  document.title = route.title ? `${route.title} – ${siteTitle()}` : siteTitle();

  if (route.teacher && !state.isTeacher) {
    navigate(`/login?next=${encodeURIComponent(hash)}`);
    return;
  }

  mount(root, loading());
  try {
    const params = path.match(route.re).slice(1);
    await route.view(root, { params, query, isCurrent: () => seq === renderSeq });
  } catch (e) {
    console.error(e);
    if (seq !== renderSeq) return;
    mount(root, html`<div class="notice notice-error" role="alert"><p>${friendlyError(e)}</p><button class="btn" id="retry">Try again</button></div>`);
    $('#retry', root).addEventListener('click', render);
  }
}

document.addEventListener('site-updated', () => {
  renderBranding();
  renderHeader();
});

/** Finish signing in: claim the site if it has no teacher, then open Settings. */
let finishing = null;
function finishSignIn(session) {
  finishing ||= (async () => {
    try {
      await afterSignIn(session);
      toast('Your teacher account is ready.');
      navigate(state.site.ai_ready ? '/teach' : '/settings');
    } catch (e) {
      toast(friendlyError(e), 'error');
      navigate('/');
    } finally {
      finishing = null;
    }
  })();
  return finishing;
}

async function boot() {
  renderBranding();
  if (!configured) {
    setupNeededView(viewEl());
    return;
  }
  const recovering = /type=recovery/.test(location.hash);

  auth.onChange((event, session) => {
    if (event === 'INITIAL_SESSION') return;
    setTimeout(async () => {
      const before = state.uid;
      state.session = session;
      if (event === 'PASSWORD_RECOVERY') {
        await refreshSite();
        navigate('/reset?mode=new');
        return;
      }
      if (state.uid !== before || (session && !state.site.has_owner)) {
        await refreshSite();
        const hash = location.hash.slice(1);
        // The setup and sign-in pages finish signing in themselves.
        const ownPage = /^\/(setup|login)\b/.test(hash);
        if (session && !ownPage && (!state.site.has_owner || /access_token=|type=signup/.test(hash))) {
          await finishSignIn(session);
        } else {
          render();
        }
      }
    }, 0);
  });

  try {
    state.session = await auth.session();
  } catch (e) {
    console.error(e);
  }
  await refreshSite();
  if (recovering && state.session) location.hash = '#/reset?mode=new';
  // Signed in (for example from the confirmation email) but the site has no
  // teacher yet: this account becomes the teacher.
  else if (state.session && !state.site.has_owner) await finishSignIn(state.session);

  window.addEventListener('hashchange', render);
  render();
}

boot();
