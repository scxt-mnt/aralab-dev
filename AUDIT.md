# Feature audit: holes found, and status

Legend: FIXED = changed in this version · OPEN = known, your call · UNTESTED = needs a run against your real Supabase

## Fixed
| Hole | Fix |
|---|---|
| Model `gemini-2.5-flash` retired -> every generation failed | Auto-detects models via `models.list`, ranks newest Flash first, falls through on "no longer available / no quota". Picks `gemini-3.8-flash` today; a future 3.9 needs no code change |
| Code sent `temperature`, which new Gemini models drop | Removed |
| Student could write another student's file path into a request, then admin approval made the AI read it | Server checks every path starts with the owner's id |
| File size / count / type limits only checked in the browser | Re-checked on the server; DB constraint on the request row too |
| Saving your profile reset `onboarded` -> welcome screen again | State is now merged, not replaced |
| Anyone could fake study time (shared stats would be cheating-prone) | Max 4h per entry, 16h per rolling day, timestamp set by the DB; shared stats are computed by the DB, never taken from the browser |
| Avatar URL could point at a tracking site that every student's browser loads | DB check: avatar must live in your Supabase `avatars` bucket and carry the owner's id |
| Spam posting | DB limits: 20 posts/hour, 60 comments/hour per student |
| Editing a post could change its owner/stats/date | Trigger locks everything except the text |
| Empty or newline-only posts | Rejected in the DB |
| Deleting an original post would break reposts | Reposts stay and show "original was deleted" |
| Reposting a repost builds chains | Always points at the original |
| Share links with junk in the hash | Only a real UUID is accepted |
| New file `Avatar.jsx` clashed with your `avatar.js` on Windows | Renamed `UserAvatar.jsx` |

## Open (recommended next, in this order)
1. **Notifications**: "X commented on your post" / reacted. Realtime plumbing is already there.
2. **Report button** so students can flag a post for admins (admins can already delete any post/comment).
3. **Owner-edited reviewer HTML**: a student who owns a generated reviewer can overwrite its `html` through the API and then "Publish" it. It runs in a sandboxed iframe (no access to your site), but it can show arbitrary content to others. Fix: only admins may publish, or re-render from `content` on publish.
4. **Images in posts** and **@mentions** (not built).
5. **Free-tier reality check**: if `gemini-3.8-flash` is not free on your key, the app falls to the next model automatically; watch `AI model:` shown to admins on the Requests screen. Gemini 4 Argon is paid-only, so it is excluded unless `GEMINI_ALLOW_PREMIUM=1`.
6. Reactions list shows counts only, not who reacted.
7. Streak uses the student's browser timezone at the moment they look.

## Tested here
- 54 automated tests (`npm test`): model ranking, every fallback path, templates incl. XSS, feed logic, server flow incl. the security cases. Deliberately breaking the ranking made 9 fail, so they do catch regressions.
- Whole React app compiles/bundles.

## NOT tested here (be honest)
- **`supabase-setup.sql` was not executed** (no Postgres in my sandbox). Run it and check there are no red errors.
- **Browser click-through of the new feed UI was not run** (couldn't install packages offline). Please do the checklist below.
- Google API calls were mocked; I could not hit the real API.

## 5-minute manual checklist
1. Run `supabase-setup.sql` (put your email on the last line). 2. `START-LOCAL.bat`.
3. Post text. Post with **Share my stats** ticked: card appears with real numbers.
4. React (change it, remove it), comment, edit comment, delete comment.
5. Edit your post (shows "edited"), delete it (confirm). Try deleting a classmate's post as a non-admin: no menu.
6. Share to feed / Copy link -> open link in a new tab: single post view.
7. Click a classmate's name: their profile + stats. Turn off "Let other students see my stats": they see "keeps stats private".
8. Create reviewer: template previews show; approve one as admin; note the model name in the toast.

## v4 notes
- **Not compiled or clicked through here** (no Vite or browser in my sandbox, no network). JSX was parse-checked with TypeScript, undefined names were checked, and all 57 unit tests pass. Run the checklist below.
- **SQL v4 was not executed.** Run `supabase-setup.sql` and watch for red errors.
- Anonymous posts are hidden by row-level security; because of that, other students' screens refresh them on a 60 s timer instead of instantly (realtime cannot see rows RLS hides).
- Admins can see who wrote an anonymous post (needed for moderation). If you do not want that, remove `or public.is_admin()` from the two "read" policies and the two views.
- Anonymous posts never appear on the author's public profile; the author sees them under "My posts".

### v4 checklist
1. Sign in with a new account: school is required. Existing account: banner "Add your school".
2. Post with **Anonymous** on: others see "Anonymous student" with no photo or school; you see a "You" tag. Do the same with a comment.
3. Share stats and try all 4 layouts. Attach 1, 2, 3 and 4 photos; click one to open the viewer.
4. Library: flag a reviewer as a student, then as admin open the flag list and "Mark as fixed".
5. University Astra: as admin add a guide for your school, then check a student account sees it.

## v38 hardening (what changed and what you must do)
- **Run `supabase-setup.sql` again** (new block at the end, "v38"): length limits, 25 MB cap on the notes bucket, follow/reaction/event rate limits, `usage.approver_id`.
- Reviewer pages now run with a Content-Security-Policy (no network, no forms) and a sandbox without popups. Pasted HTML that loads external **scripts** from a CDN will no longer run; inline scripts, https images, styles and fonts still work.
- Login no longer downloads every reviewer's search text; it loads once, the first time someone searches.
- An Astra member can generate at most 10 reviewers/day (`DAILY_APPROVER_LIMIT`); admins are not limited.
- "Active now": updates are batched (one redraw per 2 s) and each student can hide their status in Profile > Settings.
- Not changed on purpose: owners can still edit their reviewer's HTML through the content editor (it is how editing works); the CSP and sandbox are what contain it. Orphan-file cleanup is still open.

## v40 mobile pass
- Reader (viewer): was hidden under the phone's top bar (z-index 24 vs 20), so Back could not be tapped. Now z-index 28, Back is pinned left, the other buttons scroll beside it with a fade hint, Esc also closes it.
- Comment box: anonymous toggle is icon-only, the box grows up to 4 lines, Enter sends.
- Feed composer: Photo / Video / Pin / Share stats / Announcement / name-vs-anonymous show icons only on phones (tooltip + screen-reader label keep the name).
- Bottom tabs hide while a text box is focused. Tap targets are 36-40 px. Suggestion lists open in the page flow inside sheets.
- Not done: moving Mod/Requests into a "More" tab for admins (7 tabs still fit at 360 px).
