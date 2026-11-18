import test from 'node:test'
import assert from 'node:assert/strict'
import { renderReviewer, renderHtmlTemplate, normalizeContent, SAMPLE_CONTENT, sampleFor, TEMPLATES, TEMPLATE_INFO, THEMES } from '../../src/render.js'

const C = normalizeContent
const evil = C({ title: '<img src=x onerror=alert(1)>', summary: '"><script>alert(2)</script>', sections: [{ heading: '<b>h</b>', points: ['<script>x</script>'] }], flashcards: [{ q: '<i>q', a: 'a' }], quiz: [{ q: 'q', choices: ['<a>', 'b'], answer: 1, why: '<w>' }] })

test('every built-in template renders for every theme, with all blocks', () => {
  for (const t of Object.keys(TEMPLATES)) for (const th of Object.keys(THEMES)) {
    const h = renderReviewer(SAMPLE_CONTENT, t, th)
    assert.match(h, /<!doctype html>/); assert.match(h, /Sample: The Cell/); assert.ok(/class="fc"|class="fc-data"/.test(h)); assert.ok(/class="card q"|class="q-data"/.test(h)); assert.match(h, /<script>/)
  }
})
test('rendering keeps every section of a large imported or merged reviewer', () => {
  const big = { title: 'Big', sections: Array.from({ length: 22 }, (_, i) => ({ heading: `Topic ${i + 1}`, points: ['p'] })) }
  const h = renderReviewer(big, 'studyflow')
  for (const n of [1, 12, 22]) assert.match(h, new RegExp(`Topic ${n}\\b`))
})
test('templates really differ in layout', () => {
  const a = renderReviewer(SAMPLE_CONTENT, 'classic'), b = renderReviewer(SAMPLE_CONTENT, 'guide'), c = renderReviewer(SAMPLE_CONTENT, 'cards')
  assert.ok(b.includes('class="two"') && !a.includes('class="two"'))
  const pos = (h, k) => h.indexOf(`data-pane="${k}"`)
  assert.ok(pos(c, 'cards') < pos(c, 'notes')); assert.ok(pos(a, 'notes') < pos(a, 'cards'))
})
test('unknown / hostile template names fall back to classic', () => {
  for (const t of ['nope', '__proto__', 'constructor', 'toString', undefined]) assert.match(renderReviewer(SAMPLE_CONTENT, t), /Cell basics/)
})
test('built-in output escapes everything from the AI/notes (no XSS)', () => {
  for (const t of Object.keys(TEMPLATES)) { const h = renderReviewer(evil, t); assert.ok(!/<img src=x/.test(h) && !h.includes('<script>alert') && !h.includes('<b>h</b>'), t) }
})
test('picker metadata exists for every template', () => { for (const [k, v] of Object.entries(TEMPLATE_INFO)) assert.ok(v.label && v.description, k); assert.equal(TEMPLATES.classic, 'Classic') })

const TH = THEMES.indigo
test('custom template: values, loops, index, theme, inverse, partials', () => {
  const tpl = '<body style="color:{{theme.acc}}"><h1>{{title}}</h1>{{#sections}}<h2>{{@number}}. {{heading}}</h2>{{#points}}<i>{{.}}</i>{{/points}}{{/sections}}{{^terms}}NOTERMS{{/terms}}{{#quiz}}<div class="q" data-a="{{answer}}">{{#choices}}<button data-j="{{@index}}">{{.}}</button>{{/choices}}<p class="why" hidden>{{why}}</p></div>{{/quiz}}{{>flashcards}}{{>script}}</body>'
  const h = renderHtmlTemplate(tpl, SAMPLE_CONTENT, TH)
  assert.match(h, /color:#6c7bf0/); assert.match(h, /<h2>1\. Cell basics<\/h2>/); assert.match(h, /<h2>3\. Membrane transport<\/h2>/)
  assert.match(h, /<i>All living things are made of cells\.<\/i>/); assert.ok(!h.includes('NOTERMS'))
  assert.match(h, /data-a="1"/); assert.match(h, /<button data-j="1">Mitochondria<\/button>/); assert.match(h, /class="fc"/)
})
test('custom template: inverse section shows when list empty; unknown tokens vanish', () => {
  const h = renderHtmlTemplate('{{^terms}}EMPTY{{/terms}}{{nothing}}{{#nothing}}X{{/nothing}}|', C({ title: 't' }), TH)
  assert.equal(h.replace(/<script>[\s\S]*<\/script>/, ''), 'EMPTY|')
})
test('custom template: content is escaped even with triple braces, and cannot inject', () => {
  const h = renderHtmlTemplate('{{title}}|{{{title}}}|{{#sections}}{{heading}}{{/sections}}', evil, TH)
  assert.ok(!h.includes('<img') && !h.includes('<b>h</b>'))
})
test('custom template: script auto-added when forgotten; not duplicated when present', () => {
  const a = renderHtmlTemplate('<html><body>{{>flashcards}}</body></html>', SAMPLE_CONTENT, TH)
  assert.equal((a.match(/<script>/g) || []).length, 1); assert.ok(a.indexOf('<script>') < a.indexOf('</body>'))
  const b = renderHtmlTemplate('<body>{{>flashcards}}{{>script}}</body>', SAMPLE_CONTENT, TH)
  assert.equal((b.match(/<script>/g) || []).length, 1)
})
test('custom template: the script is always present (dark mode, progress and print need it) and never duplicated', () => {
  const h = renderHtmlTemplate('<body>{{title}}</body>', C({ title: 'x', sections: [{ heading: 'h', points: ['p'] }] }), TH)
  assert.equal((h.match(/<script>/g) || []).length, 1)
})
test('custom template: unclosed section does not crash', () => { assert.doesNotThrow(() => renderHtmlTemplate('{{#sections}}{{heading}}', SAMPLE_CONTENT, TH)) })
test('nested loops can still read the parent scope', () => {
  assert.match(renderHtmlTemplate('{{#sections}}{{#points}}{{heading}}:{{.}};{{/points}}{{/sections}}', SAMPLE_CONTENT, TH), /Cell basics:All living things are made of cells\.;/)
})
test('normalizeContent clamps junk from the AI', () => {
  const c = C({ title: 'x'.repeat(999), sections: 'no', quiz: [{ q: 'q', choices: ['a'], answer: 9 }, { q: 'ok', choices: ['a', 'b'], answer: 7 }], flashcards: new Array(99).fill({ q: 'q', a: 'a' }) })
  assert.equal(c.title.length, 160); assert.deepEqual(c.sections, []); assert.equal(c.quiz.length, 1); assert.equal(c.quiz[0].answer, 0); assert.equal(c.flashcards.length, 20)
  assert.equal(C(null).title, 'Untitled reviewer')
})

// ---------- v64: one consistent reviewer shell ----------
test('v64: every design carries a dark twin of its theme, switched by data-mode', () => {
  for (const t of Object.keys(TEMPLATES)) for (const th of Object.keys(THEMES)) {
    const h = renderReviewer(SAMPLE_CONTENT, t, th)
    assert.match(h, /html\[data-mode=dark\]\{color-scheme:dark;--bg:/, `${t}/${th}`)
    assert.ok(!/data-mode="dark"/.test(h.slice(0, 200)), 'light by default')
  }
  assert.match(renderReviewer(SAMPLE_CONTENT, 'classic', 'indigo'), /html\[data-mode=dark\]\{color-scheme:dark;--bg:#12151f/)
  assert.deepEqual(Object.keys(THEMES.indigo), ['bg', 'card', 'ink', 'mute', 'acc', 'line'])   // the dark twin is hidden from template loops
})
test('v64: dark flag marks the <html> tag for script-less previews, once', () => {
  for (const t of Object.keys(TEMPLATES)) {
    const h = renderReviewer(SAMPLE_CONTENT, t, 'forest', { dark: true })
    assert.equal((h.match(/<html data-mode="dark"/g) || []).length, 1, t)
  }
  assert.ok(!renderReviewer(SAMPLE_CONTENT, 'classic', 'forest', { dark: false }).includes('<html data-mode'))
})
test('v64: every design marks its notes, terms and study aids as reviewable parts, and quiz/flashcards stay trackable', () => {
  const c = sampleFor(['abbreviations', 'timeline', 'keyfacts'])
  for (const t of Object.keys(TEMPLATES)) {
    const h = renderReviewer(c, t)
    const n = (h.replace(/<script>[\s\S]*<\/script>/, '').match(/data-rv/g) || []).length
    assert.ok(n >= c.sections.length + 1, `${t}: ${n} reviewable parts`)
    assert.ok(/class="fc"|class="fc-data"/.test(h), `${t}: flashcards`); assert.ok(/class="card q"|class="q-data"/.test(h), `${t}: quiz`)
  }
})
test('v64: the page reports progress and obeys the app (theme, init, print) only from its parent', () => {
  const h = renderReviewer(SAMPLE_CONTENT, 'classic')
  for (const needle of ["type:'progress'", "type:'ready'", "m.type==='theme'", "m.type==='print'", 'e.source!==P', 'beforeprint']) assert.ok(h.includes(needle), needle)
  assert.equal((h.match(/<script>/g) || []).length, 1)
})
test('v64: printing shows every tab, both sides of flashcards, and no tab bar', () => {
  const h = renderReviewer(SAMPLE_CONTENT, 'classic')
  assert.match(h, /@media print\{[^}]*\}/); assert.ok(h.includes('.tabs{display:none!important}') && h.includes('.js .pane{display:block!important}'))
})

// ---- v75: pictures and diagrams -----------------------------------------------------------------------------------
const PIC = { name: 'Cell membrane', url: 'data:image/png;base64,iVBORw0KGgo=' }

test('v75: studyflow has ONE Pictures view and ONE nav tab, with one figure per picture', () => {
  const h = renderReviewer({ ...SAMPLE_CONTENT, visuals: [PIC, { ...PIC, name: 'Video slide' }] }, 'studyflow')
  assert.equal((h.match(/id="view-pics"/g) || []).length, 1)
  assert.equal((h.match(/data-view="pics"/g) || []).length, 1)
  assert.equal((h.match(/class="rv-pic"/g) || []).length, 2)
  assert.match(h, /2 picture\(s\) from your files/)
})
test('v75: no pictures means no Pictures view and no tab', () => {
  const h = renderReviewer(SAMPLE_CONTENT, 'studyflow')
  assert.equal(h.includes('view-pics'), false)
  assert.equal(h.includes('data-view="pics"'), false)
})
test('v75: diagrams are drawn inside the study aids, with a caption and inline SVG', () => {
  const h = renderReviewer({ ...SAMPLE_CONTENT, diagrams: [{ kind: 'bars', title: 'ATP yield', unit: 'ATP', items: [{ label: 'Krebs', value: 2 }, { label: 'Transport', value: 32 }] }] }, 'studyflow')
  assert.match(h, /class="dgwrap"/)
  assert.match(h, /<figcaption>ATP yield<\/figcaption>/)
  assert.match(h, /<svg /)
  assert.match(h, /32 ATP/)
})
