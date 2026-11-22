// Who is signed in, and what this installation is called.
import { auth, getSite, claimSite } from './db.js';
import { state } from './state.js';

/** Reload the site's name and status. The header and footer update on 'site-updated'. */
export async function refreshSite() {
  try {
    state.site = { ...state.site, ...(await getSite()) };
  } catch (e) {
    console.error(e);
  }
  document.dispatchEvent(new CustomEvent('site-updated'));
}

/** After signing in: claim an unclaimed installation, or refuse other accounts. */
export async function afterSignIn(session, nameHint = '') {
  state.session = session;
  await refreshSite();
  if (!state.site.has_owner) {
    const name = nameHint || session?.user?.user_metadata?.full_name || '';
    await claimSite(name);
    await refreshSite();
  }
  if (!state.site.is_owner) {
    await signOut();
    throw new Error("This account isn't the teacher of this site.");
  }
}

export async function signOut() {
  await auth.signOut();
  state.session = null;
  await refreshSite();
}
