// v71: a file that is ALREADY a reviewer should not be fed back to the AI.
// The AI would summarise the reviewer again, so the result is shorter and loses detail. These pure helpers read the
// reviewer's own structure (sections, terms, flashcards, quiz) and the server then only applies the Study Flow layout.
// Works in the browser and in Node tests: no DOM APIs, only regexes.

// Imported reviewers may be longer than AI-generated ones: keep more of what the student already made.
const CAP = { sections: 40, points: 30, terms: 60, cards: 60, quiz: 40 }

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' }
export const decodeEntities = s => String(s ?? '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => { try { return String.fromCodePoint(parseInt(h, 16)) } catch { return '' } })
  .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(Number(n)) } catch { return '' } })
  .replace(/&([a-z]+);/gi, (m, k) => ENT[k.toLowerCase()] ?? m)

const stripTags = html => decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim()
const attr = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(String(tag || ''))
  return m ? decodeEntities(m[1] ?? m[2] ?? '') : ''
}
const first = (re, s) => { const m = re.exec(String(s || '')); return m ? stripTags(m[1]) : '' }
const push = (list, item, max) => { if (item && list.length < max) list.push(item) }

// ---------- exact read of a reviewer made by AraLab (Study Flow and older templates) ----------
export function parseAraLabHtml(html) {
  const s = String(html || '')
  if (!/qa-data|fc-data|q-data|rv-topics|rv-print/i.test(s)) return null
  const content = { title: '', summary: '', sections: [], terms: [], flashcards: [], quiz: [] }
  content.title = first(/<h1[^>]*>([\s\S]*?)<\/h1>/i, s) || first(/<title[^>]*>([\s\S]*?)<\/title>/i, s)
  content.summary = first(/<p[^>]*class="[^"]*\bsum\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i, s)

  // Study view topics: heading + bullet points
  for (const m of s.matchAll(/<section[^>]*class="[^"]*\btc\b[^"]*"[^>]*>([\s\S]*?)<\/section>/gi)) {
    const block = m[1]
    const heading = first(/<span[^>]*class="[^"]*\bht\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i, block) || first(/<h3[^>]*>([\s\S]*?)<\/h3>/i, block)
    const points = [...block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(x => stripTags(x[1])).filter(Boolean)
    push(content.sections, { heading, points }, CAP.sections)
  }
  // Print view (a printed / exported reviewer has no Study view)
  if (!content.sections.length) {
    for (const m of s.matchAll(/<section[^>]*class="[^"]*\bp-topic\b[^"]*"[^>]*>([\s\S]*?)<\/section>/gi)) {
      const block = m[1]
      const heading = first(/<h3[^>]*>([\s\S]*?)<\/h3>/i, block)
      const points = [...block.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(x => stripTags(x[1])).filter(Boolean)
      push(content.sections, { heading, points }, CAP.sections)
    }
  }

  // Data spans: exact terms, flashcards and quiz (the template stores them for the cards and quiz views)
  for (const m of s.matchAll(/<span[^>]*class="[^"]*\bqa-data\b[^"]*"[^>]*>/gi)) {
    const term = attr(m[0], 'data-q'), definition = attr(m[0], 'data-a')
    if (term && definition) push(content.terms, { term, definition }, CAP.terms)
  }
  for (const m of s.matchAll(/<span[^>]*class="[^"]*\bfc-data\b[^"]*"[^>]*>/gi)) {
    const q = attr(m[0], 'data-q'), a = attr(m[0], 'data-a')
    if (q && a) push(content.flashcards, { q, a }, CAP.cards)
  }
  const quizRe = /<span[^>]*class="[^"]*\bq-data\b[^"]*"[^>]*>([\s\S]*?)(?=<span[^>]*class="[^"]*\bq-data\b|<\/div>)/gi
  for (const m of s.matchAll(quizRe)) {
    const start = /^<span[^>]*>/i.exec(m[0])?.[0] || ''
    const q = attr(start, 'data-q'), why = attr(start, 'data-why')
    const choices = [...m[1].matchAll(/<span[^>]*class="[^"]*\bc-data\b[^"]*"[^>]*>/gi)].map(x => attr(x[0], 'data-c')).filter(Boolean)
    const answer = Number(attr(start, 'data-a'))
    if (q && choices.length >= 2) push(content.quiz, { q, choices: choices.slice(0, 4), answer: Number.isInteger(answer) && answer >= 0 && answer < choices.length ? answer : 0, why }, CAP.quiz)
  }
  return hasAny(content) ? Object.assign(content, { source: 'aralab' }) : null
}

// ---------- a self-contained reviewer whose content lives in JS arrays (S / T / C / Q) ----------
// Some exported reviewers keep their data in `const T=[...]` instead of the page. Read those arrays directly.
// A tolerant literal reader: these files often use single quotes, trailing commas or comments, which JSON.parse rejects.
// It only reads values (strings, numbers, booleans, nested arrays) and never executes the file.
function readLiteral(s, start) {
  let i = start
  const skip = () => {
    for (;;) {
      while (i < s.length && /\s/.test(s[i])) i++
      if (s[i] === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue }
      if (s[i] === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue }
      break
    }
  }
  skip()
  const ch = s[i]
  if (ch === '[') {
    i++
    const arr = []
    for (;;) {
      skip()
      if (i >= s.length) return { value: arr, i }
      if (s[i] === ']') { i++; return { value: arr, i } }
      const v = readLiteral(s, i)
      arr.push(v.value)
      i = v.i
      skip()
      if (s[i] === ',') { i++; continue }
      if (s[i] === ']') { i++; return { value: arr, i } }
      // tolerate junk between items instead of giving up on the whole reviewer
      while (i < s.length && s[i] !== ',' && s[i] !== ']') i++
      if (s[i] === ',') { i++; continue }
      if (s[i] === ']') { i++; return { value: arr, i } }
      return { value: arr, i }
    }
  }
  if (ch === '"' || ch === "'" || ch === '`') {
    const quote = ch
    i++
    let out = ''
    while (i < s.length) {
      const c = s[i]
      if (c === '\\') {
        const n = s[i + 1]
        if (n === 'n') out += '\n'
        else if (n === 't') out += '\t'
        else if (n === 'r') out += '\r'
        else if (n === 'u') { const code = parseInt(s.slice(i + 2, i + 6), 16); if (Number.isFinite(code)) out += String.fromCharCode(code); i += 4 }
        else if (n === 'x') { const code = parseInt(s.slice(i + 2, i + 4), 16); if (Number.isFinite(code)) out += String.fromCharCode(code); i += 2 }
        else out += n ?? ''
        i += 2
        continue
      }
      if (c === quote) { i++; return { value: out, i } }
      out += c
      i++
    }
    return { value: out, i }
  }
  const m = /^(?:-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|undefined|[A-Za-z_$][\w$]*)/.exec(s.slice(i))
  if (m) {
    i += m[0].length
    if (m[0] === 'true') return { value: true, i }
    if (m[0] === 'false') return { value: false, i }
    if (m[0] === 'null' || m[0] === 'undefined') return { value: null, i }
    if (/^-?\d/.test(m[0])) return { value: Number(m[0]), i }
    return { value: m[0], i }
  }
  i++
  return { value: null, i }
}
function arrayLiteral(src, name) {
  const m = new RegExp(`(?:const|let|var)\\s+${name}\\s*=\\s*\\[`).exec(String(src || ''))
  if (!m) return null
  const start = m.index + m[0].length - 1
  const v = readLiteral(src, start)
  return Array.isArray(v.value) ? v.value : null
}
export function parseReviewerDataHtml(html) {
  const s = String(html || '')
  const T = arrayLiteral(s, 'T'), C = arrayLiteral(s, 'C'), Q = arrayLiteral(s, 'Q')
  if (![T, C, Q].some(a => Array.isArray(a) && a.length)) return null
  const content = { title: '', summary: '', sections: [], terms: [], flashcards: [], quiz: [] }
  content.title = first(/<h1[^>]*>([\s\S]*?)<\/h1>/i, s) || first(/<title[^>]*>([\s\S]*?)<\/title>/i, s)
  content.summary = first(/<p[^>]*class="[^"]*\bsub\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i, s)
  for (const t of T || []) {
    if (!Array.isArray(t)) continue
    const heading = clean(t[1]), points = Array.isArray(t[3]) ? t[3].map(clean).filter(Boolean) : []
    if (heading || points.length) push(content.sections, { heading, points }, CAP.sections)
  }
  for (const c of C || []) if (Array.isArray(c) && c[0] && c[1]) push(content.flashcards, { q: clean(c[0]), a: clean(c[1]) }, CAP.cards)
  for (const [i, q] of (Q || []).entries()) {
    if (!Array.isArray(q) || !q[0] || !q[1]) continue
    const choices = [clean(q[1]), ...q.slice(2).filter(x => typeof x === 'string' && x.trim()).map(clean)].slice(0, 4)
    if (choices.length < 2) continue
    // q[1] is the correct answer; move it to a rotating position so the answer is not always first
    const pos = i % choices.length
    ;[choices[0], choices[pos]] = [choices[pos], choices[0]]
    push(content.quiz, { q: clean(q[0]), choices, answer: pos, why: '' }, CAP.quiz)
  }
  return hasAny(content) ? Object.assign(content, { source: 'data' }) : null
}

// ---------- generic HTML: keep the meaning of headings, bullets and bold terms ----------
export function htmlToReviewerText(html) {
  let s = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|head|svg|noscript)\b[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, body) => `\n${'#'.repeat(Number(n))} ${stripTags(body)}\n`)
  s = s.replace(/<li[^>]*>/gi, '\n- ')
  s = s.replace(/<\/(li|p|div|section|article|blockquote|tr|dd|dt)>/gi, '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  s = s.replace(/<\/?(b|strong)[^>]*>/gi, '**')
  s = s.replace(/<[^>]+>/g, ' ')
  return decodeEntities(s).replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ---------- generic text / markdown / converted Word ----------
const MODE = [
  [/^(key\s*terms?|terms?|definitions?|glossary|vocabulary|important terms)\b/i, 'terms'],
  [/^(flash\s*cards?|cards?|q\s*&\s*a|quick\s*q)/i, 'cards'],
  [/^(quiz|practice\s+questions?|multiple\s+choice|test\s+yourself|exercises?)\b/i, 'quiz'],
  [/^(answer\s*key|answers?)\b/i, 'answers'],
  [/^(notes?|sections?|topics?|lessons?|reviewer|summary|outline|content|discussion)\b/i, 'notes'],
]
const modeOf = line => MODE.find(([re]) => re.test(line))?.[1] || ''
const clean = s => String(s || '').replace(/^[*_`\s]+|[*_`\s]+$/g, '').replace(/\s+/g, ' ').trim()
const isQuestion = s => /\?\s*$/.test(s) || /^(q|question)\s*[:.)]/i.test(s)

export function parseReviewerText(text, name = '', opts = {}) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim())
  const dashTerms = opts.dashTerms ?? /review|term|definition|glossary/i.test(name)
  const content = { title: '', summary: '', sections: [], terms: [], flashcards: [], quiz: [] }
  let mode = 'notes', section = null, pendingQ = '', pendingChoices = [], pendingAnswer = -1, pendingWhy = '', summaryDone = false

  const finishQuiz = () => {
    if (!pendingQ || pendingChoices.length < 2) { pendingQ = ''; pendingChoices = []; pendingAnswer = -1; pendingWhy = ''; return }
    push(content.quiz, { q: pendingQ, choices: pendingChoices.slice(0, 4), answer: pendingAnswer >= 0 && pendingAnswer < pendingChoices.length ? pendingAnswer : 0, why: pendingWhy }, CAP.quiz)
    pendingQ = ''; pendingChoices = []; pendingAnswer = -1; pendingWhy = ''
  }
  const addPoint = point => {
    if (!point) return
    if (!section) { section = { heading: 'Notes', points: [] }; content.sections.push(section) }
    if (section.points.length < CAP.points) section.points.push(point)
  }

  for (const raw of lines) {
    const line = raw.trim()
    if (!line) continue
    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      const level = heading[1].length, title = clean(heading[2])
      if (level === 1 && !content.title) { content.title = title; continue }
      const m = modeOf(title)
      if (m) { mode = m; if (m === 'notes') section = { heading: title, points: [] }; continue }
      finishQuiz(); section = { heading: title, points: [] }
      if (content.sections.length < CAP.sections) content.sections.push(section); else section = content.sections[content.sections.length - 1]
      continue
    }
    // a line that is only a section label ("KEY TERMS", "Flashcards", ...)
    const label = clean(line.replace(/^[-*•]\s*/, ''))
    const m = modeOf(label)
    if (m && label.length <= 42 && !/[.!?:]/.test(label) && !/\d/.test(label)) {
      finishQuiz(); mode = m
      if (m === 'notes') { section = { heading: label, points: [] }; if (content.sections.length < CAP.sections) content.sections.push(section) }
      continue
    }
    // "Q: ..." / "A: ..." pairs (also **Q:** ...)
    const qa = /^\**\s*(q|question|front)\s*\**\s*[:.)-]\s*(.+)$/i.exec(line)
    if (qa) { pendingQ = clean(qa[2]); continue }
    // a quiz answer ("Answer: B") when the question already has choices
    const ans = /^(answer|correct answer|ans)\s*[:.)-]\s*\(?([A-Da-d])\b(.*)$/i.exec(line)
    if (ans && pendingQ && pendingChoices.length) { pendingAnswer = 'abcd'.indexOf(ans[2].toLowerCase()); pendingWhy = clean(ans[3] || ''); finishQuiz(); continue }
    // a flashcard answer ("A: ..." / "Answer: ...") when it is not a multiple-choice answer
    const aa = /^\**\s*(a|answer|back)\s*\**\s*:\s*(.+)$/i.exec(line)
    if (aa && pendingQ && !pendingChoices.length) { push(content.flashcards, { q: pendingQ, a: clean(aa[2]) }, CAP.cards); pendingQ = ''; continue }
    // "**Term** — definition" (used by the print view and many reviewers)
    const term = /^\**\s*([^*—–:]{2,120}?)\s*\**\s*[—–]\s*(.+)$/.exec(line)
    if (term && (mode === 'terms' || dashTerms)) { push(content.terms, { term: clean(term[1]), definition: clean(term[2]) }, CAP.terms); continue }
    const colon = /^\**\s*([^*:]{2,60}?)\s*\**\s*:\s+(.+)$/.exec(line)
    if (colon && mode === 'terms' && !isQuestion(line)) { push(content.terms, { term: clean(colon[1]), definition: clean(colon[2]) }, CAP.terms); continue }
    // quiz option lines
    const opt = /^[-*•]?\s*\(?([A-Da-d])[).:]\s+(.+)$/.exec(line)
    if (mode === 'quiz' && opt && pendingQ) { pendingChoices.push(clean(opt[2])); continue }
    // a numbered/lettered answer key: "1. B" / "1. B — because ..."
    const key = /^(\d+)[.)]\s*\(?([A-Da-d])\b(.*)$/.exec(line)
    if (mode === 'answers' && key) {
      const i = Number(key[1]) - 1
      if (content.quiz[i]) { content.quiz[i].answer = 'abcd'.indexOf(key[2].toLowerCase()); if (clean(key[3])) content.quiz[i].why = clean(key[3]) }
      continue
    }
    // a question starts (a numbered question in a quiz block, or a line ending with ?)
    const qnum = /^(?:\d+[.)]|q\d*[.:)])\s*(.+)$/i.exec(line)
    if (mode === 'quiz' && (qnum || isQuestion(line))) {
      finishQuiz(); pendingQ = clean(qnum ? qnum[1] : line); continue
    }
    if (mode === 'quiz' && pendingQ) { if (pendingChoices.length) pendingChoices.push(clean(line.replace(/^[-*•]\s*/, ''))); continue }
    // bullets and paragraphs become points
    const bullet = /^[-*•]\s+(.+)$/.exec(line)
    if (bullet) { addPoint(clean(bullet[1])); continue }
    if (mode === 'terms') {
      const pair = /^(.{2,80}?)\s+[—–]\s+(.+)$/.exec(line) || /^(.{2,80}?)\s*:\s*(.+)$/.exec(line)
      if (pair) { push(content.terms, { term: clean(pair[1]), definition: clean(pair[2]) }, CAP.terms); continue }
    }
    if (mode === 'cards') {
      const pair = /^(.{2,120}?)\s+[—–]\s+(.+)$/.exec(line)
      if (pair) { push(content.flashcards, { q: clean(pair[1]), a: clean(pair[2]) }, CAP.cards); continue }
    }
    if (!content.title && !summaryDone && line.length >= 3 && line.length <= 160 && !/^[-*•]/.test(line) && !/\d+[.)]/.test(line)) { content.title = clean(line); continue }
    if (!content.summary && !section && !summaryDone && line.length >= 20 && !/^[-*•]/.test(line)) { content.summary = clean(line); summaryDone = true; continue }
    addPoint(clean(line))
  }
  finishQuiz()
  content.title = content.title || clean(name.replace(/\.[^.]+$/, '')) || 'Imported reviewer'
  return hasAny(content) ? content : null
}

export const hasAny = c => !!(c && (c.sections?.length || c.terms?.length || c.flashcards?.length || c.quiz?.length))

// ---------- PDF text ----------
// A PDF has no tags: `unpdf` returns one line per visual line, with no marker for headings. These heuristics add the
// "## " markers that parseReviewerText() understands, so a printed reviewer keeps its topics instead of becoming one blob.
const PDF_LABEL = /^(unit|chapter|module|lesson|part|section)\s+[\dIVXLC]+\b/i
const isPdfHeading = (line, next) => {
  if (line.length < 3 || line.length > 80) return false
  if (/^[-*•\d]/.test(line) || /[.;,]$/.test(line)) return false
  if (/[→=]/.test(line)) return false
  const words = line.split(/\s+/)
  if (words.length > 12) return false
  if (PDF_LABEL.test(line)) return true
  if (/^[A-Z0-9 &:'’()\-–—]+$/.test(line) && line.length >= 4) return true          // ALL CAPS title
  const caps = words.filter(w => /^[A-Z0-9]/.test(w)).length
  if (caps / words.length >= 0.6 && next && (next.length > 60 || /^[-*•]/.test(next))) return true
  return false
}
export function pdfToReviewerText(text) {
  const raw = String(text || '').replace(/\r/g, '').split('\n').map(l => l.replace(/[ \t]+/g, ' ').trim())
  const count = new Map()
  for (const l of raw) if (l) count.set(l, (count.get(l) || 0) + 1)
  // drop empty lines and the page headers/footers that repeat on every page
  const lines = raw.filter(l => l && !(count.get(l) >= 3 && l.length < 90)
    && !/^page\s+\d+(\s+of\s+\d+)?$/i.test(l) && !/\bpage\s+\d+\s+of\s+\d+\s*$/i.test(l))
  // re-join lines that were only wrapped in the PDF ("…for physical" + "development.")
  const joined = []
  for (const l of lines) {
    const prev = joined[joined.length - 1]
    if (prev && prev.length > 20 && !/[.!?;:)\]"”’]$/.test(prev) && /^[a-z(“'"]/.test(l)) joined[joined.length - 1] = `${prev} ${l}`
    else joined.push(l)
  }
  const out = []
  joined.forEach((l, i) => {
    if (!i) { out.push('# ' + l); return }                                          // the first line is the reviewer's title
    out.push(isPdfHeading(l, joined[i + 1] || '') ? '## ' + l : l)
  })
  return out.join('\n')
}

export function parseReviewerHtml(html) {
  const exact = parseAraLabHtml(html) || parseReviewerDataHtml(html)
  if (exact) return exact
  return parseReviewerText(htmlToReviewerText(html))
}

// Conservative: only treat a file as a finished reviewer when it clearly has reviewer structure.
// Normal notes must keep going through the AI.
export const REVIEWER_FILE_NAME = /\b(review(?:er)?s?|study(?:\s*(?:guide|notes))?|midterms?|finals?|exams?|summar(?:y|ies)|handouts?|cheat\s*sheet)\b/i
export function looksLikeFinishedReviewer(content, name = '', { html = false, pdf = false } = {}) {
  if (!hasAny(content)) return false
  // content read from a reviewer's own data arrays (AraLab / Study Flow, S/T/C/Q) is a reviewer by construction
  if (content.source === 'aralab' || content.source === 'data') return true
  const named = REVIEWER_FILE_NAME.test(String(name || ''))
  const extra = content.terms.length + content.flashcards.length + content.quiz.length
  const points = (content.sections || []).reduce((n, s) => n + (s.points?.length || 0), 0)
  if (content.quiz.length >= 3) return true
  if (content.flashcards.length >= 5) return true
  if (content.terms.length >= 5) return true
  if (named && content.sections.length >= 1 && extra >= 1) return true
  // A printed reviewer has topics but no cards/quiz: accept it when the file is clearly a reviewer with real content.
  if (pdf && named && content.sections.length >= 2 && points >= 6) return true
  if (html && content.sections.length >= 2 && extra >= 2) return true
  if (html && named && content.sections.length >= 2) return true
  return false
}

// PDF text -> reviewer content, or null when it is just notes.
export function parseReviewerPdfText(text, name = '') {
  const content = parseReviewerText(pdfToReviewerText(text), name, { dashTerms: false })
  if (!content) return null
  // a printed reviewer has heading-only lines (unit titles, table headers): they carry no points, so do not make empty cards
  content.sections = content.sections.filter(s => s.points.length)
  return looksLikeFinishedReviewer(content, name, { pdf: true }) ? content : null
}

// v71: a printed reviewer (PDF) is read on the server; the form uses this to say so before uploading.
export const isReviewerPdf = f => !!f && (/\.pdf$/i.test(f.name || '') || f.type === 'application/pdf') && REVIEWER_FILE_NAME.test(f.name || '')

// Read a File (HTML or text) and return its reviewer content, or null.
export async function readReviewerFile(file) {
  if (!file) return null
  const name = String(file.name || ''), type = String(file.type || '')
  const html = /html|xhtml/i.test(type) || /\.(html?|xhtml)$/i.test(name)
  const texty = html || /^text\//i.test(type) || /\.(txt|md|markdown)$/i.test(name)
  if (!texty || Number(file.size) > 3 * 1024 * 1024) return null
  let raw = ''
  try { raw = await file.text() } catch { return null }
  const content = html ? parseReviewerHtml(raw) : parseReviewerText(raw, name)
  return content && looksLikeFinishedReviewer(content, name, { html }) ? content : null
}

// What the form shows: the import content attached by convertFile (HTML / Word ...) or read from a text file.
export async function findImportContent(files = []) {
  for (const f of files) {
    if (f?.importContent) return f.importContent
  }
  for (const f of files) {
    const c = await readReviewerFile(f)
    if (c) return c
  }
  return null
}
