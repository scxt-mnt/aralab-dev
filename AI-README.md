# AI-README: AraLab architecture (read this first)

> **For any AI assistant working on this repo.** Read this file before touching code. It is a map of the whole app so you do not have to open every file. Only open the specific files named here for the task at hand. **When you change architecture, add a table, route, env var or feature, update this file in the same change** (see "Keeping this file true" at the bottom).
>
> Snapshot: written from the `aralab-v69` archive and updated for **v77** (cancellable task toasts, dark-mode toast/bell fix, pictures on by default, concept-map/compare diagrams, topic icons). `package.json` says `4.8.0`, the human `CHANGELOG.md` goes up to **v77**. The zip has no wrapper folder: its root IS the project root.

---

## 1. What the app is

**AraLab** is a study-reviewer community app for Filipino college students.

- Students upload notes (PDF, Word, Excel, PowerPoint, images, text, links, Google Classroom lessons, even Drive videos).
- The server asks an AI to turn them into a structured **reviewer** (summary, sections, terms, flashcards, quiz, optional study aids) and renders it as a themed HTML page.
- Reviewers are published to a shared **Library**. Around that: a social **Feed**, per-university **Astra** guides and moderators, a **Ranking**, timed **Challenge** quizzes with leaderboards, stars/visitors/collections, share links with preview images, and email milestones.

Roles:
| Role | What they are |
|---|---|
| Student | any signed-in user with a completed profile (name, state university, program required) |
| **Astra member** | a student assigned to one school by an admin; monitors that school (flags, generation, reports). Row in `astra_members` |
| Admin | row in `admins`; full moderation, can generate/retry any request, sees authors of anonymous posts |

---

## 2. Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18 + Vite 5, plain JS/JSX (no TypeScript), plain CSS in `src/styles.css`, inline SVG icons (`src/Icons.jsx`). No router library, no state library |
| Backend | **Vercel serverless functions** in `api/*.js` (thin) calling logic in `server/*.js` (testable) |
| Database/Auth/Storage/Realtime | **Supabase** (Postgres + RLS + triggers + RPC functions). Entire schema lives in ONE file: `supabase-setup.sql` (~2700 lines, idempotent, safe to re-run) |
| AI | **Gemini** primary (auto model detection), **Groq** backup (v67) |
| Misc deps | `fflate` (unzip Office files in browser), `unpdf` (PDF text for Groq), `nodemailer` (email), `satori` + `@resvg/resvg-js` (share preview PNGs) |
| Tests | Node built-in runner: `npm test` (`node --test`), ~290 tests in `tests/unit/*.test.mjs` |

Scripts (`package.json`): `dev` (vite on port **3000**, strict), `build`, `preview`, `test`, `templates`. `predev` and `prebuild` both run `npm run templates` to regenerate `src/templates.generated.js`.

---

## 3. Repo map

```
reviewer-library/
  index.html, vite.config.js, vercel.json, package.json, .env.example
  supabase-setup.sql         <- the WHOLE database (tables, RLS, triggers, RPC, buckets). Re-run after every SQL-changing version
  fix-student-id.sql         <- one-off fix (v60), also folded into setup
  README.md                  <- human changelog (v3..v75) + setup notes
  AUDIT.md                   <- security/feature audit: holes fixed, holes open
  START-LOCAL.bat / START-TEST.bat / RUN-TESTS.bat   (Windows helpers)
  public/og.png              <- default share-preview image
  templates/*.html           <- reviewer layouts (+ templates/README.md = token reference)
  scripts/generate-templates.mjs  <- builds src/templates.generated.js from templates/
  api/                       <- Vercel function entry points (thin wrappers)
  server/                    <- server logic, dependency-injected, unit-tested
  src/                       <- React app (screens) + pure logic modules shared with server
  tests/unit/*.test.mjs, tests/fakeSupabase.js
```

**Key convention:** pure logic goes in `*.js` modules (`*Logic.js`, `render.js`, `limits.js`, `aids.js`...) with no browser/network access so they can be tested offline and **imported by both browser and server**. UI is in `*.jsx`. Server flows take `db` and the AI function as parameters so tests inject fakes.

---

## 4. Frontend architecture (`src/`)

### Entry and shell
- `main.jsx` mounts `App`; shows a clear message if `.env` Supabase vars are missing (`envMissing`).
- `supabase.js` exports the single client `sb`. In **test mode** it exports an in-memory fake (`testClient.js`) instead.
- `App.jsx` is the shell and the only router: a `tab` state string, no URL routing (exceptions: `/privacy`, `/terms` static pages, `/r/<id>` share links, `#post=<id>` hash for posts).
  - Gate order: no session -> `Login` -> profile load error -> `AppSkeleton` -> temp-banned screen -> banned screen -> `Onboarding` -> app.
  - Loads: `admins` (is admin), `astra_members` (is Astra + map of all Astra), `profiles` (self), and **all reviewers metadata** (`reviewers` select of `META` columns, paged by 1000, plus `reviewer_stats` for visitors/stars/faces). Reviewer **`text`** (search text) is lazy-loaded only when someone searches (`textsWanted`).
  - **Keep-alive tabs:** once opened a tab stays mounted (hidden). If you were away >5 min it remounts fresh (`tabMeta.gen`). Scroll is restored per tab.
  - Each screen is wrapped in `ErrorBoundary` (shows "Try again" instead of a blank app).
  - Realtime: subscribes to the student's own `reviewer_requests` updates to toast "published / rejected / failed".
  - Phones: bottom bar (Feed, Library, Astra, My). Bottom bar hides while typing (`body.kb-open`).

### Navigation (tabs and hubs)
| Nav button | Tabs inside (`tab` values) | Component |
|---|---|---|
| Feed | `feed` | `Feed.jsx` (+ `PostCard.jsx`, `mentions.jsx`, `feedApi.js`, `feedLogic.js`) |
| Library hub | `library` (Browse), `requests` (Create reviewer; admins see the request queue), `classroom` | `Library.jsx`, `Requests.jsx`, `Classroom.jsx` |
| University Astra hub | `astra` (School guide), `rank` (Ranking), `campus` (My university / Other universities) | `Astra.jsx`, `Ranking.jsx`, `Campus.jsx` |
| Mod / Astra desk (only admin or Astra) | `mod` | `Moderation.jsx` |
| My | opens `Profile.jsx` as overlay (`profileId`) | `Profile.jsx`, `StatsView.jsx` |
| (global) | `search` | `Search.jsx` (students, posts, Astra guides, reviewers, universities) |

Onboarding help (three layers, all optional and dismissible): `SpeedDial.jsx` + `speedDialLogic.js` (v70: floating **+ Quick start** button in the corner of every screen; shortcuts to Create, Classroom, Library, Feed, Astra and the tour, each with a one-line explanation; hides the current screen's item; on the Create screen offers "How to create a reviewer"), `Welcome.jsx` (3-step guide; `start` prop picks the step; opened from the dial, the sidebar "How it works" button and after onboarding via `openGuide(n)` in `App.jsx`), `FlowNext.jsx` / `StartCards.jsx` (soft "next step" cards).

Also: `Bell.jsx` (notifications), `UploadBar.jsx` + `uploads.js` (background upload jobs with a progress bar).

### Reviewer creation pipeline (browser side)
1. `Requests.jsx` form: files + **Add link** + the shared **Shape your reviewer** panel (v75: `ReviewSettingsPanel.jsx` — prompt, subject, study strategy via `aids.js`, pictures, colour theme). The layout chooser was removed in v70: the request always stores `template: 'studyflow'`. The same panel opens in Classroom before a single/batch build; settings are remembered per browser (`reviewSettings.js` `readSettings`/`writeSettings`, keys `rl-rs:<user>:create` and `rl-rs:<user>:classroom`). The prompt is stored in the existing `reviewer_requests.coverage` (“What to cover”), so there is no SQL change.
2. `fileConvert.js`: converts Word/Excel/PowerPoint/ODF/epub/rtf/html/ipynb/csv/json/code to plain text **in the browser**. Text capped at 60,000 chars. The server only ever receives **PDF, PNG/JPEG/WebP, text/plain**.
3. `linkApi.js` + `linkLogic.js` -> `api/fetch-link.js` for pasted links (Google Docs/Slides/Sheets/Drive, web pages, direct file links).
4. `makeReviewer.js`: `checkFiles`, `sendRequest` (insert `reviewer_requests` row + upload files to the `notes` bucket), `generateNow` (calls the API). `chunkUpload.js` splits big files into parts. `limits.js` holds the size limits: **v71 removed the 5-image cap** — up to `MAX_FILES` (50) files, with `MAX_REQUEST_BYTES` (40 MB total) as the real safety cap; per file PDF 25 MB, image 10 MB, text 5 MB. The server re-checks the same numbers in `server/generateFlow.js`.
5. `aiRun.js` `callAi()` -> POST to `/api/generate` (or `/api/fix-reviewer`) with `Accept: application/x-ndjson` and reads a **progress stream**; `aiProgress.js` reduces progress events; `AiBar.jsx` displays them.
6. Google Classroom path: `googleClassroom.js` (Google Identity Services + Picker, token kept in `sessionStorage`, never sent to our server), `classroomLogic.js` (`selectFiles`), `lessonTitles.js` (AI-named lessons via `/api/lesson-titles`), video lessons: `videoFrames.js` (pure scene selection) + `videoToSheets.js` (browser) -> contact-sheet images. **v71**: `Classroom.jsx` lets the student tick many lessons, calls `pickFiles` **once** for all their Drive files, then runs a sequential queue (`prepare()` per lesson). **v73**: the audio is never read, so a video-only lesson is listed (`readable()` includes `l.videos > 0`) and the student pastes its transcript: `cleanTranscript()` strips timestamps/entities/repeated caption lines and `transcriptInfo()` measures words/minutes (both in `classroomLogic.js`); `Classroom.jsx` stores it per browser in `rl-gc-tr:<user>` (30 lessons, 60k chars each), shows a row **Paste** chip and a detail box, and `prepare(l, allowed, step, trText)` appends it as a `<lesson> (transcript).txt` file to every Generate/batch build. **v74**: when the lesson has a Drive video/audio file, the student can press **Transcribe** (or just **Generate**, which transcribes first): `src/transcribe.js` decodes the audio at 16 kHz, mixes it to mono, cuts it into 90-second WAV pieces and posts each to `/api/transcribe` (`server/transcribe.js`), then joins the text into the same transcript slot. Caps: 30 min on desktop / 10 min on phones / 250 MB, because decoding happens in the browser. YouTube links still cannot be read (no audio access), so those keep the paste dialog. When a video was transcribed, `prepare()` drops that file so it is not downloaded a second time for slide frames.
7. Subject auto-fill (v71): `server/screen.js` `resolveSubject()` maps the AI's `detected_subject` onto an existing subject spelling (exact or `suggest()` near match); `runScreen` passes all known reviewer/request subjects. `server/generateFlow.js` writes the resolved subject to both the request and the reviewer when the request's subject was blank or `Unsorted`; the generation `SYSTEM` prompt also returns `subject` for admins (who skip the check).
8. Finished-reviewer import (v71): `src/reviewerImport.js` reads an uploaded reviewer's own structure. `parseAraLabHtml()` uses the `qa-data` / `fc-data` / `q-data` spans and the Study/print sections (lossless); `parseReviewerDataHtml()` reads the self-contained `const S/T/C/Q=[...]` reviewers (sections, cards, quiz) with a tolerant literal reader (single quotes, trailing commas, comments; never executes the file); `parseReviewerHtml()` / `parseReviewerText()` handle generic HTML, Word-converted text and Markdown with conservative heuristics. A reviewer-like **PDF** (file or request title contains “reviewer / study guide / midterm / exam / summary …”) is read on the server: `importFromPdf()` downloads it, `server/pdfText.js` extracts page-separated text, `pdfToReviewerText()` recovers headings (labels, ALL-CAPS, short title lines, page-header removal, wrapped-line joining) and `parseReviewerPdfText()` accepts it when it has ≥2 sections and ≥6 points. Ordinary notes PDFs are never intercepted. `looksLikeFinishedReviewer()` only accepts files that clearly have reviewer structure (quiz/terms/cards, a data array, or a file named like a reviewer). `fileConvert.js` attaches `importContent` to the converted File; `Requests.jsx` sends it with `generateNow()`; `server/generateFlow.js` `importContentFrom()` validates it, skips `runScreen` entirely (an import is already a reviewer: no AI check, no generation), then publishes `normalizeContent(importContent)` and records `model: 'import'`. Normal notes are unchanged.
9. Newer copy of a reviewer already in the Library (v71): `src/reviewerMerge.js` `mergeContent(base, next, { overwrite })` unions two reviewers without duplicates (sections matched by a fuzzy heading, points by text similarity, terms/cards/quiz by their key, study aids by content). With `overwrite: false` (uploads) the Library copy wins and only missing items are added — a longer version of an existing point replaces the short one so new detail is kept. `server/generateFlow.js` merges the upload into the existing reviewer, updates it in place (no duplicate copy), returns `model: 'merge'` with an `added` count, and — when the uploader is not the owner — inserts a resolved `reviewer_flags` row with `astra_verdict: 'valid'` so `reviewer_helpers()` shows them under **“Improved by”** (`creditImprover()`, best-effort; the false “flagged” notification the insert trigger creates is removed again). Nothing new → 409 “nothing new”, so a re-upload never silently does nothing.
10. Fix a flagged reviewer (v71): `server/fixFlow.js` uses `FIX_CAPS` (40 sections / 40 points / 60 terms / 60 cards / 40 quiz) instead of the old 8-section cap, instructs the AI to keep every existing item and to put the real content of attached notes/files into the reviewer, merges the answer over the old reviewer with `mergeContent(..., { overwrite: true })` (corrections win, but nothing the AI dropped is lost), fills a blank/`Unsorted` subject from the answer via `resolveSubject()` (an “Add subject” flag used to do nothing), and returns **422 “nothing new”** instead of resolving a flag when the content did not change.
11. Pictures in the reviewer (v75): `src/visuals.js` picks the images from the uploaded files (and video contact sheets) — 0 / 4 / 8 according to the `visuals` setting (`none|some|all`) — shrinks each to a ≤1000 px JPEG in the browser (`pictureDataUri`) and returns `{name, url}` data URIs within `VISUAL_ONE_CHARS` (~260k) and `VISUAL_TOTAL_CHARS` (~1.1M). `Requests.jsx` / `Classroom.jsx` send them as `visuals` in the `/api/generate` **body** (never in the request row); `server/generateFlow.js` re-validates with `cleanVisualPayload()` (base64 images only, same caps) and puts them in `content.visuals`. No bucket, no expiring links: the reviewer page stays self-contained. `render.js` keeps up to `MAX_VISUALS` (8) and `templates/studyflow.html` adds a **Pictures** view + nav tab + tap-to-enlarge (one view, guarded by `has.visuals`).
12. Drawn diagrams (v75): the generation `SYSTEM` prompt proactively asks for up to 2 diagrams (`kind`: `flow | cycle | bars | symbols`, capped steps/items, facts from the notes only). `src/illustrations.js` `normalizeDiagrams()` cleans the AI JSON and `diagramHtml()` draws inline SVG in the reviewer’s theme (`render.js` puts them in the **study aids**); Update may add up to 3. `illustrations.js` deliberately does not import `render.js` (it has its own `FALLBACK_THEME`).
13. Update an old reviewer (v75): **Update reviewer with AI** in the Library card sheet and the reader (author or admin, and only after `UPDATE_AFTER_DAYS` = 5 days since `added` or `content.refreshedAt`; helper `canRefresh` in `src/reviewSettings.js`; an ISO `added` from demo rows is understood). `src/Library.jsx` `UpdateSheet` posts `{reviewerId, prompt}` to `/api/update-reviewer`; `server/updateFlow.js` re-checks ownership/admin and the 5-day rule, builds the prompt from the reviewer’s own `content` + the optional note, then **merges add-only** (`mergeContent(base, updated, { overwrite: false })`) and re-renders in place. Nothing new → **422**. The refresh time is stored as `content.refreshedAt` (no column/migration) and the clock restarts. Pictures already in the reviewer are preserved through every merge (`reviewerMerge.js`).

### Reader / rendering
- `render.js` (**shared browser+server**): `normalizeContent()` (hard caps/clean of AI JSON, `visuals` limited to real base64 data URIs), `renderReviewer()` (fills a template), `THEMES` (indigo/forest/sunset/slate, each with a dark twin), dark-mode support, progress bar / Challenge / Leaderboard / Save PDF shell. v75: `extrasHtml(c, theme)` renders diagrams; `has.visuals` and `has.extras` drive the studyflow Pictures tab / study-aid block.
- `illustrations.js` (v75, pure): `flow / cycle / bars / symbols` diagrams -> inline SVG; `visuals.js` (v75, browser part + pure helpers) -> picture picking, shrinking and `cleanVisualPayload` (used by the server).
- `templates.generated.js` is **generated** (do not hand-edit). Built-in layouts: `classic`, `guide`, `cards`; from `templates/`: `studydeck`, `cheatsheet`, `notebook`, `studyflow`. `studyflow` is the default and is forced in the reader for every content-based reviewer (old reviewers included); the layout picker is gone.
- `lib.js`: `META` / `META_V47` column lists, `prepareReviewer()`, `withCsp()`. Reviewer HTML is shown in a **sandboxed iframe with a strict CSP** (no network, no forms, no popups; inline scripts/styles and https images/fonts allowed).
- `Library.jsx` (largest screen): filters (`libraryFilter.js`), **Suggested for you** (`suggest.js`, rules based, no ML), reader, Share (`shareLink.js`), stars, visits, **My collection**, flag/remove/restore, Fix with AI, Challenge (`Challenge.jsx` + `challengeLogic.js`), `FlagCompare.jsx`. **v72**: a card row is **Read / star / More**; secondary actions live in the reusable bottom `Sheet` (`sheet-scrim` z-index 36). **Reviewer mode** = the fixed `.viewer` plus a `focus` class: the app chrome hides, a slim `.focus-top` bar shows the title/back/star/flag/focus/More and a `.focus-bar` progress line. Reader data crosses the iframe boundary by `postMessage` (`{rv:1, type:'init'|'highlights'|'prefs'|'pos'|'escape', …}` both ways), because the iframe is sandboxed without same-origin. The parent stores: `rl-hl:<user>:<reviewer>` (highlights, offsets into the original study-point `textContent`), `rl-rp:<user>` (global reading prefs: size 14–26, serif, line height, width, theme `auto|light|sepia|night`), `rl-pos:<user>:<reviewer>` (view + scroll), plus `rl-prog:<user>:<reviewer>`. `templates/studyflow.html` renders marks and owns the Aa tools panel (search, read-aloud, highlight list), selection popup (4 colours, note, copy, remove) and the animations; `prefers-reduced-motion` is respected. Escape closes the tools/popup first, then leaves focus mode, then closes the viewer.

### Other UI helpers
`SchoolInput.jsx`/`schoolSearch.js`/`schools.js` (type-to-search universities, fallback list), `AstraApply.jsx` (apply requirements), `AstraBadge.jsx`, `presence.jsx` (active-now, batched), `UserAvatar.jsx`/`avatar.js`, `fuzzy.js`, `SuggestInput.jsx`, `Skeleton.jsx`, `Ring.jsx`/`Donut.jsx`/`Bars.jsx`/`Widgets.jsx` (charts/stats), `Legal.jsx` (`/privacy`, `/terms`), `useAppDark.js`, `images.js`, `programs.js`, `fieldOptions.js`.

---

## 5. Backend architecture

### API routes (`api/*.js`, Vercel functions; also served locally by the Vite plugin `devApi` in `vite.config.js`)
| Route | Auth | Purpose | maxDuration |
|---|---|---|---|
| `POST /api/generate` | JWT; owner or admin | Build a reviewer from a request (`server/generateFlow.js`); v75 bodies may carry `visuals` (pictures) | 300 |
| `POST /api/update-reviewer` | JWT; reviewer owner or admin, 5 days after added/last update | Refresh an old reviewer **add-only** from its own content + an optional prompt (`server/updateFlow.js`) | 300 |
| `POST /api/fix-reviewer` | JWT; admin or Astra of the school | Fix a flagged reviewer with AI (`server/fixFlow.js`) | 300 |
| `POST /api/lesson-titles` | any signed-in user | AI names Classroom lessons | 30 |
| `POST /api/fetch-link` | signed-in | Download a pasted link safely (`server/linkFetch.js`) | 30 |
| `POST /api/transcribe` | signed-in | One 90-second WAV piece -> transcript text (`server/transcribe.js`, Gemini first, Groq fallback) | 60 |
| `GET /api/models` | admin | Shows active Gemini model + `outOfQuota` | - |
| `GET /api/universities` | cron (`CRON_SECRET`) or admin | Weekly sync of PH universities (Hipo Labs dataset), cron `0 3 * * 1` | 30 |
| `GET/POST /api/send-milestones` | signed-in or cron | Send waiting milestone emails, cron `0 4 * * *` | 30 |
| `GET /api/share` (`/r/:id` rewrite) | **public** | HTML page with Open Graph tags for a public reviewer; `?s=87&l=hard` makes a score card | 10 |
| `GET /api/og` | public | Draws the preview PNG (satori + resvg; fonts in `server/fonts`, included via `includeFiles`) | 15 |

`vercel.json` also: rewrites `/privacy`, `/terms` -> `index.html`; no-cache on `/` and `index.html`; immutable cache on `/assets/*`.

### Server modules (`server/`)
| File | Role |
|---|---|
| `db.js` | `makeDb()` = Supabase **service-role** client (bypasses RLS: use only after verifying the caller). `envProblem()` |
| `auth.js` | `requireUser`, `requireAdmin`, `requireApprover`, `requireGenerator` (students may generate **their own** requests; admins any) |
| `stream.js` | `respond()`: if `Accept: application/x-ndjson`, streams `{"type":"progress"...}` lines then one `{"type":"done",status,body}`; otherwise plain JSON |
| `generateFlow.js` | The whole generate flow: validate file list (paths must start with owner id), limits, pause/rate checks, AI screen, build file parts, call AI, validate, render, insert `reviewers`, log to `gen_log`. Contains the reviewer `SYSTEM` prompt. Budget `GENERATE_BUDGET_MS` (default 280000). A row left `generating` longer than `max(2 min, budget + 45 s)` is treated as dead and can be claimed again; fresh rows still block double starts |
| `screen.js` | AI check **before** generating: verdict `ok / not_study / inappropriate / private / spam`, duplicate detection, `subject_fit` 0-10 (below `MIN_SUBJECT_FIT`=6 the request is stopped, logged as `failed` not `blocked`). Admins skip it; Classroom requests are not subject-checked |
| `fixFlow.js` | Fix a reviewer from flag notes/files, update in place, mark flag resolved |
| `updateFlow.js` | v75: **Update reviewer**. Re-checks owner/admin + the 5-day rule (`checkUpdate`), builds the prompt from the reviewer’s own content + optional note, asks the AI for the full reviewer, merges **add-only** (`mergeContent(base, updated, {overwrite:false})`), re-renders in place, stores `content.refreshedAt`, fills an `Unsorted` subject; 422 when nothing new |
| `reviewerMerge.js` | Pure merge of two copies of a reviewer: add-only for uploads/updates, overwrite-without-loss for AI fixes; keeps `visuals` and merges `diagrams` add-only |
| `ai.js` | **Single AI entry point**: Gemini first, Groq as safety net (keeps 18 s reserve; not used for status 422) |
| `gemini.js` | Auto-detects models via `models.list` (newest Flash first, stable before preview), per-model 429 cooldown memory (30 min for daily limit), validates each answer (`validate`) and **moves to the next model on broken JSON/empty result**, up to 8 models, 2 rounds. Files API for big PDFs (>4 MB or >10 MB total), deleted after use |
| `groq.js` | Backup AI. Cannot read PDFs (text extracted with `unpdf`), vision model for photos (max 5), notes cut at ~28k chars, **big notes split into parts at paragraph breaks and merged into ONE reviewer** (v68) |
| `transcribe.js` | v74: one 90 s audio piece -> `{text, model}`. Asks the AI for `{"transcript":"..."}`, keeps only the words (no summary/translation), accepts silence as an empty transcript, caps the piece at `MAX_AUDIO_B64` |
| `aiFiles.js` | Builds AI file parts; includes the "video = pictures only, no sound" note |
| `lessonTitles.js`, `linkFetch.js` (SSRF-hardened: http/https 80/443, no private/loopback/metadata IPs, checked on connect and every redirect, 15 s / 25 MB), `share.js`, `ogImage.js`, `milestones.js`, `mailer.js` (Gmail / Brevo / Resend), `universities.js` |

### Generate flow in one picture
```
Browser (Requests.jsx / Classroom.jsx)
  -> upload files to storage bucket `notes` (path = <userId>/...)
  -> insert row in reviewer_requests
  -> POST /api/generate (Bearer JWT, ndjson progress stream)
        requireGenerator -> checkFileList -> pause/rate checks
        -> runScreen (AI check, duplicate, subject_fit)   [skipped for admins]
        -> download files, build parts (Files API for big PDFs)
        -> ai.generateJson  (Gemini models in order -> Groq fallback)
        -> normalizeContent + renderReviewer (templates, theme, aids)
        -> insert `reviewers` (public), update request status (done/failed/blocked), write gen_log
  <- realtime UPDATE on reviewer_requests triggers toast + library reload
```

---

## 6. Database (Supabase) - what exists

**All of it is in `supabase-setup.sql`. Re-run the whole file after any version that says "re-run SQL".** The `profiles_guard()` function is intentionally defined several times (later definitions replace earlier ones); student IDs have their own trigger `profiles_student_no_trg` so a later guard cannot disable them (there is a test for this).

**Tables:** `admins`, `profiles`, `reviewers`, `reviewer_requests`, `reviewer_flags`, `reviewer_visits`, `reviewer_stars`, `reviewer_collection`, `reviewer_milestones`, `quiz_attempts`, `usage`, `gen_log`, `posts`, `post_comments`, `post_reactions`, `comment_reactions`, `anon_aliases` (locked down), `announcements`, `events` (old, unused), `personal_events`, `follows`, `school_follows`, `notifications`, `study_log`, `astra_members`, `astra_guides`, `astra_applications`, `ban_reports`, `post_removals`, `mod_actions`, `state_universities`.

**Views:** `posts_feed`, `post_comments_feed`, `reviewer_stats` (visitors, stars, `visitor_faces`).

**Storage buckets:** `avatars` (public), `post-images` (public), `post-videos` (public, 50 MB), `notes` (private, 25 MB), `astra-files` (private).

**RPC / security-definer functions worth knowing:** `record_visit`, `toggle_star`, `submit_quiz_attempt` (server recomputes score), `quiz_leaderboard`, `compute_contributions`, `compute_stats`, `get_user_stats`, `get_user_contributions`, `school_directory`, `school_leaderboard`, `astra_requirements` / `astra_eligibility` / `astra_apply` / `decide_astra_application`, `astra_remove_post`, `astra_temp_ban`, `decide_post_removal`, `decide_ban`, `decide_temp_ban`, `unban_user`, `remove_reviewer` / `restore_reviewer`, `pause_generation` / `resume_generation` / `report_generation`, `gen_monitor`, `notify_many`, `notify_staff`, `is_admin()`, `is_astra_for()`, `is_banned()`, `is_onboarded()`, `is_state_uni()`.

**Triggers/guards (the real security layer):** `profiles_*_guard`, `posts_guard`, `comments_guard`, `reaction_guard`, `flags_guard`, `follow_guard`, `study_log_guard`, `pevents_guard`, `rr_guard`, `school_guard`, `reviewers_removed_guard`, plus notification triggers `trg_*_notify`, `trg_task_*`. They enforce: onboarding required before writing, ban checks, rate limits (20 posts/h, 60 comments/h), length limits, avatar must be in own `avatars` folder, study-time caps, owner-only edits, school must be in `state_universities`.

**Last line of the SQL file:** `notify pgrst, 'reload schema';` and an admin line where `YOUR_EMAIL` must be replaced the first time.

**Defensive loading pattern in the frontend:** many selects try the newest column list, and on error fall back to an older list (`META_V47` -> `META`, `reviewer_stats` with/without `visitor_faces`, profiles `FULL` -> `BASE` with a toast "Database is out of date. Re-run supabase-setup.sql"). Keep this pattern when adding columns.

---

## 7. Feature -> where it lives (quick lookup)

| Feature | Frontend | Server / DB |
|---|---|---|
| Sign-in (email+password, Google) | `Login.jsx` | Supabase Auth (Facebook removed) |
| Account setup (name, university, program required) | `Onboarding.jsx` | `profiles_setup_guard`, `state_universities` |
| Feed posts, photos, video announcements, reposts, stats share | `Feed.jsx`, `PostCard.jsx`, `feedApi.js` | `posts`, `posts_feed`, `post-images`, `post-videos` |
| Anonymous posts/comments + aliases | `PostCard.jsx` | RLS hides author; `anon_aliases`, `make_anon_alias` |
| @mentions, replies, comment reactions | `mentions.jsx`, `mentionLogic.js` | `mention_ids`, `trg_*_mention_notify` |
| Create reviewer (files, links) | `Requests.jsx`, `makeReviewer.js`, `fileConvert.js`, `ReviewSettingsPanel.jsx` (v75) | `api/generate`, `generateFlow.js` |
| Reviewer settings (prompt, strategy, pictures, colour) | `ReviewSettingsPanel.jsx`, `reviewSettings.js` (v75, shared by Create + Classroom; `rl-rs:<user>:create|classroom`) | prompt travels in `reviewer_requests.coverage` |
| Pictures in a reviewer | `visuals.js` (v75), `templates/studyflow.html` Pictures view | `generateFlow.js` `cleanVisualPayload`; stored in `reviewers.content.visuals` |
| Drawn diagrams (flow/cycle/bars/symbols) | `illustrations.js` (v75), `render.js` study aids, `aids.js` `diagrams` | AI JSON in `reviewers.content.diagrams` |
| Update an old reviewer | `Library.jsx` (`UpdateSheet`, `canRefresh`), `reviewSettings.js` (v75) | `api/update-reviewer`, `updateFlow.js`; time in `content.refreshedAt` |
| Google Classroom (incl. Drive videos) | `Classroom.jsx`, `googleClassroom.js`, `videoToSheets.js`, `classroomLogic.js` (`cleanTranscript`), `transcribe.js` (v74) | `api/lesson-titles`, `api/transcribe`; marker in `reviewer_requests.topic` as `gc:course:lesson` |
| Library, filters, suggestions, collection | `Library.jsx`, `libraryFilter.js`, `suggest.js` | `reviewers`, `reviewer_collection`, `reviewer_stats` |
| Reviewer mode + reading tools (highlights, themes, search, read-aloud) | `Library.jsx` (`Viewer`, `Sheet`), `templates/studyflow.html` | none (per-browser `rl-hl:*`, `rl-rp:*`, `rl-pos:*`) |
| Stars, visitors, milestone emails | `Library.jsx` | `toggle_star`, `record_visit`, `reviewer_milestones`, `api/send-milestones` |
| Flags + Fix with AI | `Library.jsx`, `Moderation.jsx`, `FlagCompare.jsx` | `reviewer_flags`, `api/fix-reviewer`, `fixFlow.js` |
| Challenge + leaderboard | `Challenge.jsx`, `challengeLogic.js` | `quiz_attempts`, `submit_quiz_attempt`, `quiz_leaderboard`. Points only from improving your best (1 per 5 score points, max 20/reviewer, 60/day) |
| Share link + preview image | `shareLink.js`, `Login.jsx` ("Shared with you") | `api/share`, `api/og`, `server/share.js`, `server/ogImage.js` |
| Astra guides / apply / desk / ban reports | `Astra.jsx`, `AstraApply.jsx`, `Moderation.jsx` | `astra_*` tables and RPCs, `astra-files` bucket |
| Generation monitoring (pause/resume/report) | `Moderation.jsx` | `gen_log`, `gen_monitor`, `pause_generation`... |
| Ranking, My university, school follows | `Ranking.jsx`, `Campus.jsx` | `school_leaderboard`, `school_directory`, `school_follows` |
| Notifications | `Bell.jsx`, `notifyApi.js` | `notifications`, `trg_*` |
| Profile, points, stats, settings | `Profile.jsx`, `StatsView.jsx` | `compute_contributions`: 50/reviewer, 10/study hour, 25/accepted flag, + challenge points |
| Quick start / onboarding help | `SpeedDial.jsx`, `speedDialLogic.js`, `Welcome.jsx`, `FlowNext.jsx`, `StartCards.jsx` | none (UI only; `localStorage` keys `rl-dial-seen`, `rl-flow-off`, `rl-start-hide`) |
| Test mode | `testClient.js`, `START-TEST.bat` | none (Supabase never contacted; `/api` returns 503 in test mode) |

---

## 8. Environment variables

**Public (`.env`, exposed to browser, `VITE_` prefix):** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_GOOGLE_CLIENT_ID`, `VITE_GOOGLE_API_KEY`, `VITE_GOOGLE_APP_ID`, `VITE_CONTACT_EMAIL`, `VITE_TEST_MODE` (dev only).

**Secret (`.env.local` locally, Vercel env vars in production; never `VITE_`):**
| Var | Meaning |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | required by all server routes |
| `GEMINI_API_KEY` | primary AI (or only `GROQ_API_KEY` to run Groq-only) |
| `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_VISION_MODEL` | backup AI |
| `GROQ_WHISPER_MODEL` | v74: Groq speech model used when Gemini cannot listen to a video, default `whisper-large-v3-turbo` |
| `GEMINI_MODEL`, `GEMINI_ALLOW_PREMIUM` | model preference / allow paid models |
| `GENERATE_BUDGET_MS` | AI time budget, default 280000. Keep `maxDuration` 300 in `vercel.json` for `api/generate.js` and `api/fix-reviewer.js` |
| `DAILY_USER_LIMIT`, `DAILY_GLOBAL_LIMIT`, `MAX_RUNNING_PER_USER` (default 3), `DAILY_APPROVER_LIMIT` (10) | optional brakes (off by default; generation is unlimited by design) |
| `CRON_SECRET` | protects cron routes |
| `APP_URL` | real domain for share/preview/email links |
| `GMAIL_USER`+`GMAIL_APP_PASSWORD`, or `BREVO_API_KEY`+`MAIL_FROM`, or `RESEND_API_KEY`+`MAIL_FROM`, `MAIL_FROM_NAME` | milestone emails (app works without them) |
| `SUPABASE_URL` | optional server-side override of `VITE_SUPABASE_URL` |

> Note: `.env.example` currently contains a real-looking Supabase URL and publishable (anon) key. These are public by design, but never put service-role, Gemini, Groq or mail keys in `.env.example`.

---

## 9. Run, test, deploy

- **Local:** `npm install`, copy `.env.example` -> `.env`, put secrets in `.env.local`, run `supabase-setup.sql` in Supabase SQL Editor, `npm run dev` -> http://localhost:3000. `/api/*` is served by the Vite `devApi` plugin (no `vercel dev` needed). `START-LOCAL.bat` does this on Windows.
- **Test mode (no live data):** `START-TEST.bat` -> sample signed-in student, in-memory data, Supabase never contacted, server features off. Works only with `npm run dev`.
- **Tests:** `npm test` (or `RUN-TESTS.bat`). Tests use `tests/fakeSupabase.js` (does **not** simulate RLS) and injected AI fakes.
- **Deploy:** push to GitHub -> Vercel; add env vars; Supabase > Auth > URL Configuration must contain the site and `http://localhost:3000/**`. Re-run `supabase-setup.sql` when the changelog says so.

---

## 10. Rules and gotchas for changes (do not break these)

1. **Never use the service-role client (`makeDb`) before verifying the caller** with `server/auth.js`.
2. **Server never trusts the request row's file list**: paths must start with the owner's id (`checkFileList`). Keep file limits checked on both browser and server (`src/limits.js`).
3. **Security lives in the database** (RLS + guards). Do not rely on UI hiding. Anonymous posts must never leak `user_id` to non-admins.
4. **All AI calls go through `server/ai.js` `generateJson`** with a `validate` callback so a bad answer moves to the next model/Groq. Do not call Gemini/Groq directly from a flow.
5. **AI content is untrusted:** keep `normalizeContent` caps; keep templates escaping (`{{...}}` is HTML-escaped); keep the reviewer iframe sandbox + CSP.
6. **Pure logic stays pure** (`render.js`, `*Logic.js`, `limits.js`...): browser and server import them, so no DOM, no `window`, no Node-only APIs there.
7. **Do not hand-edit `src/templates.generated.js`**; edit `templates/*.html` and run `npm run templates`. Template filenames starting with `_` are ignored; built-in ids `classic`, `guide`, `cards` are reserved. Template note blocks need `data-rv` to count toward progress.
8. **SQL changes:** append idempotent blocks to the end of `supabase-setup.sql` (`create ... if not exists`, `create or replace`, `drop policy if exists`), keep `notify pgrst, 'reload schema';` last, and add a frontend fallback if old databases lack the column.
9. **Do not add a second `profiles_guard` that drops student-number assignment**; that bug (v60) left new accounts with no ID.
10. **Challenge scoring** is duplicated in `src/challengeLogic.js` and the SQL `submit_quiz_attempt`; change both together (server value wins).
11. **Windows-friendly filenames:** avoid names that differ only by case (an old `Avatar.jsx` vs `avatar.js` clash caused the rename to `UserAvatar.jsx`).
12. **Per-screen error boundaries and keep-alive tabs** are intentional; a new screen should be added to `KEPT` and `pane()` in `App.jsx`.
    - When you add a screen or a main feature, also add a shortcut to `DIAL_ITEMS` in `src/speedDialLogic.js` (and a line in `Welcome.jsx` if it is a main feature) so new students can discover it. The dial uses z-index 26: above the phone bottom bar (25), below the reader (28), dialogs (30), panels (35), toasts (40) and Challenge (60). Keep new floating UI out of its corner (bottom-right).
13. Share preview shows only **public, not-removed** reviewers and never names a contributor who chose *Hide my name*.
14. New env vars and routes must be added to section 5 / 8 here and to `.env.example`.

---

## 11. Known open items (from `AUDIT.md` and the changelog)

- Owners can still edit their reviewer's HTML via the content editor (contained by CSP + sandbox, but a student can show arbitrary content).
- Orphan-file cleanup in storage is not done.
- Anonymous posts refresh on a 60 s timer for others (realtime cannot see RLS-hidden rows).
- Admins can see authors of anonymous posts (needed for moderation).
- Streak uses the browser's timezone.
- SQL and some UI flows were not executed in the original audit environment; verify in a real Supabase project after changes. Real Google API calls were only mocked in tests.
- Old binary `.doc/.xls/.ppt`, audio and archives are not supported by `fileConvert.js` (clear message shown).
- Canva links cannot be downloaded (message tells the student to export a PDF); YouTube video links cannot be read.

---

## 12. Version history pointer

The detailed per-version changelog is the human `CHANGELOG.md` (v3 -> v77, newest first at the top, with some older entries lower down). Use it for the "why" behind a feature. This file is the "where and how".

---

## Keeping this file true

When you finish a task, check whether it changed: a route (section 5), a table/RPC/bucket (6), an env var (8), a screen or nav item (4), a rule (10). If yes, edit this file in the same change and bump the snapshot line at the top. Do not let this file drift from the code.


## v77 additions
- `src/tasks.js` + `src/TaskToast.jsx`: cancellable toast tasks (`startTask`, `cancelTask`, `isCancel`). `signal` is threaded through `googleClassroom.js`, `videoToSheets.js`, `transcribe.js`, `visuals.js`, `makeReviewer.js` (`sendRequest`, `generateNow`, `discardRequest`) and `aiRun.js`.
- `server/generateFlow.js`: `body.cancel === true` marks a running build failed (`CANCELLED`); `stillOn()` re-checks before the AI call and before publishing.
- `src/illustrations.js`: kinds `map` and `compare`, `autoDiagrams()`, `topicIcon()`; `render.js` adds an automatic topic map and `extrasNoDg`; `templates/studyflow.html` shows the Visual overview, picture strip and topic icons.

## v84 additions
- `src/LivePreview.jsx`: Library cards, Search reviewer rows show the REAL reviewer in a scaled, sandboxed iframe (lazy via IntersectionObserver, max 3 loads at once, one animation at a time). Desktop: auto-scrolls on hover; touch: when the card is mid-screen. Scroll is a CSS transform on the frame. Falls back to `MiniReviewer` until loaded and with reduced motion. Profile tiles are text-only; "My collection" is a Library filter so it uses the same cards.
- In-app browsers (Facebook/Messenger/Instagram): `src/safeStorage.js` (in-memory stand-in when localStorage throws; imported first in `main.jsx`), `src/inapp.js` (detect, `html.inapp`, Android Chrome intent), banner on `Login.jsx`, `vite.config.js` `build.target` es2018/chrome64/safari12 + `cssTarget`, CSS fallbacks at the end of `styles.css` (`@supports not (aspect-ratio / inset)`), avatar is now a clipped wrapper `.av-round` with the `<img>` filling it (+ one retry without referrer), template `studyflow.html` got `inset` and `color-mix` fallbacks.
- v84.1: the Library cover is a `div` (not a `button`: Messenger's WebView shifted a block inside a button); no in-app warning banner on Login (`inapp.js` still adds `html.inapp`).
- v85: Feed composer has a header with a close **X** (+ Escape, discard confirm) and goes full-screen on phones; calmer collapsed pill, 44px tools/actions (CSS at the end of `styles.css`). The repo now carries `.claude/skills/` (ui-ux-pro-max, design, design-system, ui-styling, brand, banner-design, slides): read `ui-ux-pro-max/SKILL.md` before UI work.
