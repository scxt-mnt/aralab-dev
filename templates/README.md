# Adding a template

1. Put an `.html` file in this folder, e.g. `templates/poster.html`.
2. (Optional) first line: `<!-- label: Poster | description: Big bold cards -->`
3. Run `npm run templates` (or just start the app: `npm run dev` / `START-LOCAL.bat` does it for you).
4. It is compiled into `src/templates.generated.js` and can be passed to `renderReviewer(content, 'poster')`. **v70:** the layout chooser was removed from Create reviewer; the app now always uses `studyflow`. The other templates are kept for future layouts and internal previews.

Files starting with `_` are ignored (see `_example.html` for a working sample you can copy).

## Tokens

| Token | What it gives |
|---|---|
| `{{title}}` `{{summary}}` | text (always HTML-escaped) |
| `{{theme.bg}}` `{{theme.card}}` `{{theme.ink}}` `{{theme.mute}}` `{{theme.acc}}` `{{theme.line}}` | the colour of the theme the student picked |
| `{{#sections}} {{heading}} {{#points}}{{.}}{{/points}} {{/sections}}` | loop over notes |
| `{{#terms}} {{term}} {{definition}} {{/terms}}` | loop over key terms |
| `{{#flashcards}} {{q}} {{a}} {{/flashcards}}` | loop over flashcards |
| `{{#quiz}} {{q}} {{why}} {{answer}} {{#choices}}{{.}}{{/choices}} {{/quiz}}` | loop over quiz questions |
| `{{@index}}` `{{@number}}` | 0-based / 1-based position inside a loop |
| `{{#hasSummary}}...{{/hasSummary}}` | only if there is a summary |
| `{{^sections}}...{{/sections}}` | only if the list is empty |
| `{{>header}}` `{{>sections}}` `{{>terms}}` `{{>flashcards}}` `{{>quiz}}` | ready-made blocks (working flip cards / quiz) |
| `{{>style}}` | base styles + theme colours (add your own `<style>` after it) |
| `{{>script}}` | makes flashcards and quiz clickable (added automatically if you forget it) |

Everything inserted with `{{...}}` is escaped, so notes can't inject HTML. No `<script>` of your own is needed.
For a working quiz in custom markup keep these attributes: question wrapper `class="q" data-a="{{answer}}"`, each choice `<button data-j="{{@index}}">`, and `<p class="why" hidden>`. Flashcards: `<button class="fc"><span class="f">front</span><span class="b">back</span></button>`.

## Study aids (reviewer strategy)

Students can tick extra study aids when they create a reviewer (abbreviations, memory tricks, cheat sheet, comparison tables, timeline, common mistakes, examples). Each aid only exists when the student asked for it and the AI had material for it.

| Token | What it gives |
|---|---|
| `{{>extras}}` | every study aid the reviewer has, in one go |
| `{{>abbreviations}}` `{{>mnemonics}}` `{{>keyfacts}}` `{{>comparisons}}` `{{>timeline}}` `{{>traps}}` `{{>examples}}` | one aid, ready made (empty when the reviewer does not have it) |
| `{{#has.extras}}...{{/has.extras}}` | only if the reviewer has at least one aid (also `has.abbreviations`, `has.keyFacts`, ...) |
| `{{#abbreviations}}{{abbr}} {{meaning}} {{note}}{{/abbreviations}}` | loop with your own markup (same for `mnemonics`: `topic` `trick` `explain`; `timeline`: `label` `detail`; `traps`: `mistake` `correct`; `examples`: `scenario` `answer`; `keyFacts`: `{{.}}`) |

If a template never mentions any of them, the aids are added at the end of the page automatically, so a student's choice is never dropped. Name templates after their *look* (Notebook, Cheat Sheet), never after a subject.
