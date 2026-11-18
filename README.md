<div align="center">

# AraLab

**Turn any notes into a study reviewer, and share it with your school.**

Upload a PDF, Word file, slides, photos, a link, or a Google Classroom lesson. AraLab builds a reviewer with topics, flashcards, a quiz and drawn diagrams, then publishes it to a community Library.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![React](https://img.shields.io/badge/React-18-61dafb?logo=react&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5-646cff?logo=vite&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Postgres-3ecf8e?logo=supabase&logoColor=white)
![Deploy](https://img.shields.io/badge/Deploy-Vercel-000?logo=vercel)
![Tests](https://img.shields.io/badge/tests-373%20passing-brightgreen)

[Features](#features) · [Quick start](#quick-start) · [Configuration](#configuration) · [Deploy](#deploy) · [Architecture](#architecture) · [Contributing](#contributing) · [Changelog](CHANGELOG.md)

</div>

---

## Why AraLab

Students keep notes in many formats and rarely turn them into something they can actually study from. AraLab does that in one step, and lets classmates reuse each other's reviewers instead of starting from scratch. It is built for Filipino college students and their state universities, but nothing stops you from adapting it to your own school.

## Features

**Create reviewers**
- Upload up to 50 files of any type: PDF, Word, Excel, PowerPoint, images, text, e-books, notebooks and more. Office files are converted to text in the browser.
- Paste a link: Google Docs / Slides / Sheets / Drive, a web page, or a direct file link.
- Import from **Google Classroom** (read-only), one lesson or a whole batch, including Drive videos (slide pictures and an AI-written transcript).
- Tell the AI what you need, pick a study strategy (mnemonics, cheat sheet, compare tables, timeline...), a colour theme and how many of your pictures to include.
- Every reviewer gets a visual overview: a concept map, flows, cycles, bar charts, comparisons and symbol sheets drawn as inline SVG.
- Cancel any build, download or transcription from its toast at any time.
- Gemini first with automatic model fallback, Groq as a backup, plus an AI safety, subject-fit and duplicate check.

**Study**
- Reader with Study / Cards / Quiz, highlights and notes, text and theme controls, read-aloud, dark mode and print to PDF.
- Timed **Challenge** quizzes with Easy / Medium / Hard and daily, monthly and all-time leaderboards.
- Stars, collections, visitor counts, share links with preview images, and email milestones.

**Community**
- Feed with posts, anonymous aliases, @mentions, reactions and comments.
- Per-university **Astra** guides and moderators, ranking, follow system and notifications.
- Admin tools for moderation, generation monitoring and removals.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite 5, plain CSS |
| Backend | Vercel serverless functions (`api/`) calling testable logic in `server/` |
| Data | Supabase (Postgres, Row Level Security, Auth, Storage, Realtime) |
| AI | Google Gemini, Groq (backup and speech) |
| Extras | `satori` + `resvg` (share images), `nodemailer`, `fflate`, `unpdf` |
| Tests | Node built-in test runner |

## Quick start

**Requirements:** Node.js 18+ and a free [Supabase](https://supabase.com) project.

```bash
git clone <your-repo-url>
cd aralab
npm install
cp .env.example .env        # then add your keys (see Configuration)
```

1. In Supabase, open **SQL Editor** and run `supabase-setup.sql` (replace `YOUR_EMAIL` on the last line with your email to become admin). It is safe to re-run.
2. Create `.env.local` with your server secrets (see below).
3. Start the app:

```bash
npm run dev                 # http://localhost:3000, also serves /api/*
```

On Windows you can double-click `START-LOCAL.bat` instead.

### Try it without any keys

Double-click `START-TEST.bat` (or run with `VITE_TEST_MODE=1`). The app runs in **test mode**: you are signed in as a sample student, all data is sample data kept in the browser, and Supabase is never contacted. AI generation and email are switched off. This only works with `npm run dev`.

### Run the tests

```bash
npm test
```

## Configuration

**Public** (`.env`, safe for the browser):

| Variable | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase publishable (anon) key |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth client ID (Classroom) |
| `VITE_GOOGLE_API_KEY`, `VITE_GOOGLE_APP_ID` | Google Picker API key and project number |
| `VITE_CONTACT_EMAIL` | Contact address shown on `/privacy` and `/terms` |

**Secrets** (`.env.local` or your host's env vars; never prefix with `VITE_`):

| Variable | Purpose |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Server access to Supabase |
| `GEMINI_API_KEY` | Primary AI |
| `GROQ_API_KEY` | Optional backup AI and speech-to-text |
| `GMAIL_USER` + `GMAIL_APP_PASSWORD`, or `BREVO_API_KEY`, or `RESEND_API_KEY` (+ `MAIL_FROM`) | Optional milestone emails |
| `GEMINI_MODEL`, `GROQ_MODEL`, `GROQ_VISION_MODEL`, `GROQ_WHISPER_MODEL` | Optional model preferences |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`| Optional cache that makes opening reviewers fast |
| `DAILY_USER_LIMIT`, `DAILY_GLOBAL_LIMIT`, `GENERATE_BUDGET_MS`, `APP_URL`, `CRON_SECRET` | Optional limits and tuning |

<details>
<summary><b>Sign-in providers (Email, Google, Facebook)</b></summary>

1. **Email**: Supabase > Authentication > Providers > Email: enable it and leave *Confirm email* on.
2. **Google** (and **Facebook**, shown on the sign-in screen): enable each provider and add its client ID and secret.
3. **URL Configuration**: set the Site URL to your deployed origin and add it plus `http://localhost:3000/**` to Redirect URLs.
4. **Abuse protection**: keep the rate limits on, configure custom SMTP for production, and enable Cloudflare Turnstile or hCaptcha.

</details>

<details>
<summary><b>Google Classroom setup</b></summary>

1. Google Cloud Console: create a project and enable **Google Classroom API**, **Google Drive API** and **Google Picker API**.
2. Configure the OAuth consent screen and create an OAuth client (*Web application*). Add your site and `http://localhost:3000` as authorized JavaScript origins.
3. Create an API key restricted to the Picker API and your site.
4. Set `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY` and `VITE_GOOGLE_APP_ID` (your project *number*), then redeploy.

AraLab uses the non-restricted `drive.file` scope: students confirm each lesson's files in Google's picker. While the consent screen is in *Testing*, only test users can connect.

</details>

## Deploy

1. Push to GitHub and import the repo in [Vercel](https://vercel.com).
2. Add the environment variables above.
3. Keep `maxDuration` at 300 for `api/generate.js`, `api/fix-reviewer.js` and `api/update-reviewer.js` (already set in `vercel.json`; needs Fluid Compute).

## Architecture

```
api/         Vercel function entry points (thin)
server/      Server logic, dependency-injected and unit-tested
src/         React screens plus pure logic shared with the server
templates/   Reviewer layouts (Study Flow is the default)
tests/       Unit tests and a fake Supabase
supabase-setup.sql   The whole database, idempotent
```

For a full map of the code, read [`AI-README.md`](AI-README.md). Known security notes live in [`AUDIT.md`](AUDIT.md).

## Facebook sign-in: data deletion

Facebook requires a data-deletion link. In your Facebook app settings, set **Data Deletion Instructions URL** to `https://<your-site>/delete-account`. Students can also delete their account themselves under **My > Settings > Delete my account** (needs the `delete_my_account()` function from `supabase-setup.sql`).

## Contributing

Issues and pull requests are welcome.

1. Fork the repo and create a branch.
2. Make your change and add or update tests in `tests/unit/`.
3. Run `npm test` and `npm run build`.
4. Open a pull request describing what changed and why.

Please never commit `.env` or `.env.local` files or any API key.

## License

Released under the [MIT License](LICENSE).
