# Changelog

All notable changes to Refute are listed here. The project follows [Semantic Versioning](https://semver.org).

## [1.0.0] - 2026-11-22

First public release.

### Added
- One installation per teacher: the first account becomes the teacher, and the teacher's name and institution are set in the app
- Students join by link with a student ID and email, with no account; the same ID continues an unfinished debate
- The teacher's AI provider (Google Gemini or Groq), model and key, set once in Settings and used by every student; the key is stored on the server and never sent to a browser
- The `refute-ai` server function (Supabase Edge Function), which runs every debate turn: prompts, AI calls, judging, scoring and feedback stay on the server
- Courses and debate tasks, with five ready-made scenarios
- An optional class list per course, and an on/off switch for every task link
- Scores, feedback, full transcripts and shareable result links
- Teacher dashboard with a class summary, a per-point breakdown, CSV download, and deleting an attempt so a student can start again
- Teacher preview showing the judge's decisions
- English, Bangla, or match-the-student conversation language
- Deployment configurations for Vercel, Netlify, GitHub Pages and Docker
- Unit tests for the server function, database security tests, and an end-to-end browser test that runs the real server function
