# Contributing to Refute

Thank you for helping. Refute is used by teachers, so changes should keep it simple to host, free to run and easy for students to use.

## Good first contributions

- **New scenarios** in `js/templates.js`, for any subject. A good scenario has a claim that sounds convincing, three or four points that refute it, and points that each require reasoning rather than vocabulary.
- **Better prompts** in `supabase/functions/refute-ai/index.ts`.
- **Translations** of the interface text.
- **Accessibility fixes**: keyboard use, screen readers, contrast.
- **Bug reports** with clear steps to reproduce.

## Ground rules

- **No npm dependencies in the app.** The site must run as plain files with no build step except generating `js/config.js`. Third-party libraries load from a CDN through the import map in `index.html`.
- **No paid services.** Every feature must work with free tiers.
- **The AI key, the points and the correct explanation stay on the server.** Anything that needs them belongs in the `refute-ai` server function, never in the browser.
- **The server function stays one self-contained file** with no imports, so teachers can paste it into the Supabase dashboard.
- **Security lives in the database.** Anything that limits who can see or change data must be a row-level security rule in `supabase/migrations/`, with a check in `supabase/tests/rls_test.sql`. Checks in the browser are only for convenience.
- **Never commit secrets** or personal data, including `.env`, real API keys or student transcripts.

## Development setup

```bash
cp .env.example .env     # point it at a Supabase project you use for development
npm run dev              # http://127.0.0.1:8000
```

Use a separate Supabase project for development, not the one your students use.

## Tests

**Unit tests** (the server function's debate logic and handler, with a fake database and a scripted AI, and the config generator) need only Node:

```bash
npm test
```

**Database security tests** run against any throwaway Postgres 15+:

```bash
psql -v ON_ERROR_STOP=1 -f supabase/tests/supabase_shim.sql
psql -v ON_ERROR_STOP=1 -f supabase/migrations/20261122000000_initial_schema.sql
psql -v ON_ERROR_STOP=1 -f supabase/tests/rls_test.sql
```

**The browser test** runs the real app in Chrome against a fake database and a fake AI provider, covering sign-up, task creation, preview, a full student debate (including a simulated rate-limit error and a page reload), the dashboard and the CSV download.

```bash
pip install playwright
python -m playwright install chromium
python tests/e2e/e2e.py
```

CI runs the unit tests and the database tests on every pull request.

## Database changes

Add a new file in `supabase/migrations/` named `YYYYMMDDHHMMSS_short_description.sql`, safe to run twice (`if not exists`, `create or replace`, `drop policy if exists`), and add checks to `supabase/tests/rls_test.sql`. Never edit a migration that has been released, because existing installations have already run it.

## Pull requests

- Keep each pull request to one change.
- Describe what you checked, and add screenshots for interface changes.
- Use clear commit messages, for example `feat: add Bangla interface text` or `fix: keep message text after a failed send`.

By contributing, you agree that your contributions are licensed under the MIT License.
