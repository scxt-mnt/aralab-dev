import test from 'node:test'
import assert from 'node:assert/strict'
import { createFake } from '../fakeSupabase.js'
import { runUpdate, checkUpdate, aidsOf, UPDATE_SYSTEM } from '../../server/updateFlow.js'
import { UPDATE_AFTER_DAYS, UPDATE_AFTER_MS } from '../../src/reviewSettings.js'

const ADMIN = { id: 'admin' }, STUDENT = { id: 'stu' }, OTHER = { id: 'other' }
const DAY = 24 * 60 * 60 * 1000
const VISUAL = { name: 'membrane', url: 'data:image/jpeg;base64,AAAA' }

const baseContent = () => ({
  title: 'Cell Biology',
  summary: 'A short summary.',
  sections: [{ heading: 'Chapter 3', points: ['The cell is the unit of life.', 'Mitochondria make ATP.'] }],
  terms: [{ term: 'ATP', definition: 'Energy currency of the cell.' }],
  flashcards: [{ q: 'What is a cell?', a: 'The basic unit of life.' }],
  quiz: [{ q: 'Which organelle makes ATP?', choices: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'], answer: 1, why: 'Mitochondria.' }],
})

const newContent = (over = {}) => ({
  ...baseContent(),
  sections: [{ heading: 'Chapter 4', points: ['Cellular respiration releases energy from glucose.'] }],
  ...over,
})

function setup(over = {}) {
  const reviewer = {
    id: 'rv1', title: 'Cell Biology', subject: 'Biology', text: 'old text', html: '<html>old</html>',
    content: baseContent(), template: 'studyflow', theme: 'indigo', owner_id: 'stu',
    added: Date.now() - 6 * DAY, is_public: true, ...over.reviewer,
  }
  const f = createFake({
    tokens: { adm: ADMIN, st: STUDENT, other: OTHER },
    tables: {
      admins: [{ user_id: 'admin' }],
      reviewers: [reviewer],
      reviewer_requests: [{ subject: 'Biology' }, { subject: 'Chemistry' }],
      usage: [],
    },
  })
  return f
}
const ai = (text = JSON.stringify(newContent())) => ({ generateJson: async () => ({ text, tokens: 9, model: 'gemini-3.8-flash' }) })
const run = (f, o = {}) => runUpdate({ db: f.client, authHeader: 'Bearer st', body: { reviewerId: 'rv1' }, ai: ai(), key: 'k', ...o })
const row = f => f.db.tables.reviewers[0]

test('update: missing reviewerId 400, unknown reviewer 404, anonymous 401', async () => {
  const f = setup()
  assert.equal((await run(f, { body: {} })).status, 400)
  assert.equal((await run(f, { body: { reviewerId: 'zzz' } })).status, 404)
  assert.equal((await run(f, { authHeader: '' })).status, 401)
})

test('update: the author refreshes it, old material is kept and the new chapter is added', async () => {
  const f = setup(), r = await run(f)
  assert.equal(r.status, 200); assert.equal(r.body.model, 'gemini-3.8-flash')
  const rv = row(f)
  const headings = rv.content.sections.map(s => s.heading)
  assert.ok(headings.includes('Chapter 3'), 'the old chapter must stay')
  assert.ok(headings.includes('Chapter 4'), 'the new chapter must be added')
  assert.equal(rv.title, 'Cell Biology')
  assert.match(rv.html, /Cellular respiration/)
  assert.match(rv.html, /Mitochondria make ATP/)                     // old content is in the rendered page too
  assert.equal(rv.template, 'studyflow')
  assert.equal(rv.text, rv.text.toLowerCase())                       // the searchable text mirrors the new reviewer
  assert.match(rv.text, /cellular respiration/)
  assert.equal(rv.size, Buffer.byteLength(rv.html))
  assert.ok(rv.content.refreshedAt, 'a refresh time is stored inside the content JSON')
  assert.equal(f.db.tables.usage[0].user_id, 'stu')
  assert.equal(f.db.tables.usage[0].tokens, 9)
  assert.equal(r.body.added.points, 1)
})

test('update: another student cannot refresh it, an admin can', async () => {
  const f = setup()
  assert.equal((await run(f, { authHeader: 'Bearer other' })).status, 403)
  assert.equal(f.db.tables.usage.length, 0)
  const r = await run(f, { authHeader: 'Bearer adm' })
  assert.equal(r.status, 200)
  assert.equal(f.db.tables.usage[0].user_id, 'admin')
})

test('update: locked for the first 5 days, then available (author or admin only)', () => {
  const now = Date.now()
  const young = { owner_id: 'stu', added: now - 2 * DAY }
  assert.equal(checkUpdate(young, STUDENT, false, now).status, 422)
  assert.match(checkUpdate(young, STUDENT, false, now).error, /3 days/)
  assert.equal(checkUpdate(young, STUDENT, false, now + 3 * DAY).ok, true)
  assert.equal(checkUpdate(young, OTHER, false, now + 3 * DAY).status, 403)
  assert.equal(checkUpdate(young, OTHER, true, now + 3 * DAY).ok, true)   // admins skip the owner rule, not the 5-day rule
  assert.equal(checkUpdate(null, STUDENT, false, now).status, 404)
  assert.equal(checkUpdate({ ...young, removed_at: new Date().toISOString() }, STUDENT, false, now + 3 * DAY).status, 422)
})

test('update: the 5-day clock restarts after a refresh', async () => {
  const f = setup(), first = await run(f)
  assert.equal(first.status, 200)
  const again = checkUpdate(row(f), STUDENT, false, Date.now() + DAY)
  assert.equal(again.status, 422)
  assert.match(again.error, /4 days/)
  // and the helper used by the UI agrees
  assert.equal(row(f).content.refreshedAt !== undefined, true)
  assert.ok(UPDATE_AFTER_MS === UPDATE_AFTER_DAYS * DAY)
})

test('update: a refresh that finds nothing new fails with 422 instead of saving the same reviewer', async () => {
  const f = setup()
  const r = await run(f, { ai: ai(JSON.stringify(baseContent())) })
  assert.equal(r.status, 422)
  assert.match(r.body.error, /nothing new/i)
  assert.equal(row(f).content.refreshedAt, undefined)
})

test('update: a reviewer in the old (unstructured) format explains that it cannot be refreshed', async () => {
  const f = setup({ reviewer: { content: null } })
  const r = await run(f)
  assert.equal(r.status, 422)
  assert.match(r.body.error, /older than AraLab/)
  assert.equal(f.db.tables.usage.length, 0)
})

test('update: the student\'s own instructions reach the AI, but can never override its rules', async () => {
  let seen = null
  const spy = { generateJson: async ({ system, parts }) => { seen = { system, parts }; return { text: JSON.stringify(newContent()), tokens: 1, model: 'm' } } }
  const f = setup()
  await run(f, { ai: spy, body: { reviewerId: 'rv1', prompt: '  Add cellular respiration,\r\nand a diagram.\r\n' } })
  const text = seen.parts[0].text
  assert.match(text, /What the student wants refreshed: Add cellular respiration,\nand a diagram\./)
  assert.match(seen.system, /untrusted data/)          // prompt injection is called out in the system rules
  assert.ok(seen.system.startsWith(UPDATE_SYSTEM))     // always the base rules, plus (at most) a study-aid block
  assert.match(text, /Current reviewer JSON/)
})

test('update: pictures already in the reviewer survive the refresh', async () => {
  const f = setup({ reviewer: { content: { ...baseContent(), visuals: [VISUAL] } } })
  const r = await run(f, { ai: ai(JSON.stringify(newContent())) })
  assert.equal(r.status, 200)
  assert.deepEqual(row(f).content.visuals, [{ name: 'membrane', url: VISUAL.url }])
})

test('update: an "Unsorted" reviewer finally gets the subject that fits', async () => {
  const f = setup({ reviewer: { subject: 'Unsorted' } })
  const r = await run(f, { ai: ai(JSON.stringify({ ...newContent(), subject: 'biology' })) })
  assert.equal(r.status, 200)
  assert.equal(r.body.subject, 'Biology')                 // the existing spelling wins over "biology"
  assert.equal(row(f).subject, 'Biology')
})

test('update: an AI failure is reported, and the reviewer is left untouched', async () => {
  const f = setup()
  const r = await run(f, { ai: { generateJson: async () => { throw Object.assign(new Error('The AI is busy.'), { status: 503 }) } } })
  assert.equal(r.status, 503)
  assert.equal(r.body.error, 'The AI is busy.')
  assert.equal(row(f).html, '<html>old</html>')
  assert.equal(row(f).content.refreshedAt, undefined)
})

test('aidsOf: the study aids a reviewer already uses are read back from its content', () => {
  assert.deepEqual(aidsOf({ abbreviations: [{ abbr: 'ATP', meaning: 'x' }], diagrams: [{ kind: 'flow', steps: ['a', 'b'] }] }), ['abbreviations', 'diagrams'])
  assert.deepEqual(aidsOf(null), [])
  assert.deepEqual(aidsOf({ sections: [] }), [])
})

test('checkUpdate: an Astra member of the author’s school may update, others still may not', () => {
  const DAY = 24 * 60 * 60 * 1000, now = Date.now()
  const old = { id: 'r', owner_id: 'owner', added: now - 9 * DAY }
  assert.equal(checkUpdate(old, { id: 'astra' }, false, now, true).ok, true)
  assert.equal(checkUpdate(old, { id: 'astra' }, false, now, false).status, 403)
  assert.equal(checkUpdate({ ...old, added: now - 1 * DAY }, { id: 'astra' }, false, now, true).status, 422)
})
