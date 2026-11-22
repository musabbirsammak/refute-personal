# Security policy

## Reporting a vulnerability

Please **don't** open a public issue for security problems. Report them privately through GitHub's **Security → Report a vulnerability** on this repository. Include what you found, how to reproduce it, and what an attacker could do with it.

You'll get a reply within a week. Once a fix is ready, it will be released with a note on what changed and whether existing copies need to act, for example by running a new migration or redeploying the server function.

## What counts as a vulnerability

- Reading the teacher's AI key, or getting the server function to call the AI for anything other than a real debate turn
- Reading a task's points or correct explanation before finishing the debate
- Reading or changing data you shouldn't: other students' results, courses, tasks, the teacher's settings
- Changing a score, or continuing a debate after it has finished or after its link was switched off
- Taking over an installation that already has a teacher
- Script injection through task text, student messages or AI replies

## Known limitations (by design)

- **Students have no accounts.** Anyone who types a student's ID can continue that student's unfinished debate, and anyone with a result link can open that result. Refute is meant for class use, where the teacher can see who is doing what.
- **The first account becomes the teacher.** Set up your copy as soon as it's online, before sharing its address.
- **All students share the teacher's AI limits.** Class lists, the link switch and per-attempt message limits keep usage bounded, but a class can still reach a free key's daily limit.

Reports that only restate these limitations aren't treated as vulnerabilities, but ideas for reducing them are welcome as feature requests.

## For teachers running Refute

- Only ever put the Supabase **publishable** (or legacy anon) key in `.env`. The build refuses secret keys.
- Serve your site over HTTPS.
- Keep your copy up to date: run new migrations in `supabase/migrations/` and redeploy `supabase/functions/refute-ai/` when they change.
