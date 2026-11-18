// Quiz Challenge (v64): pure functions. No React, no browser APIs, so they are unit-tested and the SQL (submit_quiz_attempt) mirrors them.
//
// Score (0-100) = accuracy x (80 + 20 x speed)
//   speed = 1 when the student averages 3 s per question or faster, 0 at 20 s (the time limit), linear in between.
// Profile points come ONLY from improvement: 1 point per 5 score points above the student's previous best on that reviewer,
//   at most 20 per reviewer and 60 per day. Replaying without beating your best earns nothing, so it cannot be farmed.

export const SECONDS_PER_Q = 20
export const FAST_AVG = 3
export const MIN_Q = 4
export const MAX_Q = 20
export const POINTS_PER = 5            // score points of improvement per profile point
export const MAX_POINTS_PER_REVIEWER = 20
export const MAX_POINTS_PER_DAY = 60
export const PERIODS = [['today', 'Today'], ['month', 'Month'], ['all', 'All time']]

// Difficulty (v69). It shapes the RUN only (how many questions, seconds per question, how many choices); the score formula and the
// submit_quiz_attempt() SQL stay exactly as they were, so nothing has to be migrated. Every time limit stays <= SECONDS_PER_Q because the
// SQL treats 20 s per question as "no speed bonus".
export const DIFFICULTIES = {
  easy:   { key: 'easy',   label: 'Easy',   hint: '3 choices',  max: 10, secs: 20, choices: 3 },
  medium: { key: 'medium', label: 'Medium', hint: 'All choices', max: 15, secs: 15, choices: 0 },
  hard:   { key: 'hard',   label: 'Hard',   hint: 'All choices',  max: 20, secs: 10, choices: 0 },
}
export const LEVELS = ['easy', 'medium', 'hard']
export const DEFAULT_LEVEL = 'medium'
export const levelOf = k => DIFFICULTIES[k] || DIFFICULTIES[DEFAULT_LEVEL]

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n))
const text = x => String(x ?? '').trim()
const same = (a, b) => text(a).toLowerCase() === text(b).toLowerCase()

export function shuffle(list, rnd = Math.random) {
  const a = [...list]
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1));[a[i], a[j]] = [a[j], a[i]] }
  return a
}

// Every question a reviewer can offer: its own quiz, plus flashcards and key terms turned into multiple choice.
export function questionPool(content) {
  const c = content && typeof content === 'object' ? content : {}
  const out = [], seen = new Set()
  const add = (q, choices, answerText, why) => {
    const key = text(q).toLowerCase()
    if (!key || seen.has(key) || choices.length < 3) return
    seen.add(key); out.push({ q: text(q), choices, answerText, why: text(why) })
  }
  for (const q of Array.isArray(c.quiz) ? c.quiz : []) {
    const ch = (q?.choices || []).map(text).filter(Boolean)
    const right = ch[Number.isInteger(q?.answer) ? q.answer : 0]
    if (ch.length >= 2 && right) { const key = text(q.q).toLowerCase(); if (key && !seen.has(key)) { seen.add(key); out.push({ q: text(q.q), choices: ch, answerText: right, why: text(q.why) }) } }
  }
  const pick = (items, i, field, n = 3) => {
    const own = text(items[i][field]), others = []
    for (let k = 1; k < items.length && others.length < n; k++) { const v = text(items[(i + k) % items.length][field]); if (v && !same(v, own) && !others.some(o => same(o, v))) others.push(v) }
    return others
  }
  const cards = (Array.isArray(c.flashcards) ? c.flashcards : []).filter(f => text(f?.q) && text(f?.a))
  cards.forEach((f, i) => { const d = pick(cards, i, 'a'); if (d.length >= 2) add(f.q, [text(f.a), ...d], text(f.a), '') })
  const terms = (Array.isArray(c.terms) ? c.terms : []).filter(t => text(t?.term) && text(t?.definition))
  terms.forEach((t, i) => { const d = pick(terms, i, 'term'); if (d.length >= 2) add(`Which term matches this? ${text(t.definition)}`, [text(t.term), ...d], text(t.term), '') })
  return out
}

// A fresh random run: shuffled questions AND shuffled choices; `answer` is the index of the right choice after shuffling.
// `level` (easy / medium / hard) caps the number of questions and, on easy, trims a question to 3 choices (the right one plus two random wrong ones).
// Without `level` the run is the classic one: up to `max` (MAX_Q) questions with every choice.
export function buildQuestions(content, { max = MAX_Q, rnd = Math.random, level = null } = {}) {
  const cfg = level ? levelOf(level) : null, cap = cfg ? Math.min(max, cfg.max) : max
  return shuffle(questionPool(content), rnd).slice(0, cap).map((p, i) => {
    let pool = p.choices
    if (cfg?.choices && pool.length > cfg.choices) {
      const wrong = shuffle(pool.filter(x => x !== p.answerText), rnd).slice(0, cfg.choices - 1)
      pool = [p.answerText, ...wrong]
    }
    const choices = shuffle(pool, rnd)
    return { id: 'c' + i, q: p.q, choices, answer: choices.findIndex(x => x === p.answerText), why: p.why }
  })
}
export const canChallenge = content => questionPool(content).length >= MIN_Q

export function computeScore({ correct, total, seconds }) {
  const t = Math.max(1, Math.floor(total)), c = clamp(Math.floor(correct), 0, t)
  const secs = clamp(seconds, Math.ceil(t * 1.5), t * SECONDS_PER_Q)   // nobody answers faster than 1.5 s each: a lower number counts as 1.5
  const speed = clamp((SECONDS_PER_Q - secs / t) / (SECONDS_PER_Q - FAST_AVG), 0, 1)
  return Math.round((c / t) * (80 + 20 * speed))
}
export function profilePoints({ score, best = 0, awarded = 0, today = 0 }) {
  return Math.max(0, Math.min(Math.floor((score - best) / POINTS_PER), MAX_POINTS_PER_REVIEWER - awarded, MAX_POINTS_PER_DAY - today))
}
export const fmtClock = s => { const n = Math.max(0, Math.round(s)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}` }
export const shareText = (title, score, level = null) => `I scored ${score} pt${level ? ` (${levelOf(level).label})` : ''} on “${title}” in the AraLab Challenge. Can you beat it?`
// The numbers a shared score link may carry: /r/<id>?s=87&l=hard. Anyone can type a URL, so the server only ever clamps and prints them as a picture caption.
export const cleanScore = v => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : null }
export const cleanLevel = v => (LEVELS.includes(v) ? v : '')

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

// A printable "answer sheet" (the Generate PDF button prints this page). Everything is escaped.
// rows: [{ q, picked (text or ''), right (text), ok (bool), why }]
export function answerSheetHtml({ title, score, correct, total, seconds, rows, date = new Date() }) {
  const list = (rows || []).map((r, i) => `<li class="${r.ok ? 'ok' : 'no'}"><b>${i + 1}. ${esc(r.q)}</b>
<p>Your answer: <span>${esc(r.picked || 'No answer (time ran out)')}</span> ${r.ok ? '&#10003;' : '&#10005;'}</p>${r.ok ? '' : `<p>Correct answer: <span>${esc(r.right)}</span></p>`}${r.why ? `<p class="why">${esc(r.why)}</p>` : ''}</li>`).join('')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)} – Challenge result</title><style>
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2740;margin:0;padding:28px;max-width:760px}
h1{font-size:22px;margin:0 0 4px}.sub{color:#6f7995;margin:0 0 18px}.stats{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 20px}
.stats div{border:1px solid #e6e9f2;border-radius:12px;padding:10px 16px;min-width:96px}.stats b{display:block;font-size:22px}.stats small{color:#6f7995}
ol{padding:0;list-style:none;margin:0}li{border:1px solid #e6e9f2;border-left:5px solid #2f9e6b;border-radius:10px;padding:10px 14px;margin:0 0 10px;break-inside:avoid}
li.no{border-left-color:#d9566a}li p{margin:3px 0}li span{font-weight:700}.why{color:#6f7995}
</style></head><body><h1>${esc(title)}</h1><p class="sub">AraLab Challenge · ${esc(date.toLocaleDateString())}</p>
<div class="stats"><div><b>${esc(score)} pt</b><small>Score</small></div><div><b>${esc(correct)}/${esc(total)}</b><small>Correct</small></div><div><b>${esc(fmtClock(seconds))}</b><small>Time</small></div></div><ol>${list}</ol></body></html>`
}
