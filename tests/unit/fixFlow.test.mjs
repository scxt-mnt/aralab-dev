import test from 'node:test'
import assert from 'node:assert/strict'
import { createFake } from '../fakeSupabase.js'
import { runFix } from '../../server/fixFlow.js'

const ADMIN = { id: 'admin' }, ASTRA = { id: 'astra1' }, OTHER = { id: 'astra2' }, STUDENT = { id: 'stu' }
const SCHOOL = 'University of the Philippines Diliman'
const good = JSON.stringify({ title: 'AI title', summary: 's', sections: [{ heading: 'Chapter 4', points: ['new point'] }], flashcards: [], quiz: [], terms: [] })

function setup(over = {}) {
  const flag = {
    id: 'f1', reviewer_id: 'rv1', user_id: 'stu', reason: 'missing_topics', note: 'Chapter 4 is missing',
    points: [{ reason: 'missing_topics', note: 'Chapter 4 is missing', files: [{ path: 'stu/flags/rv1/a.txt', name: 'a.txt', type: 'text/plain', size: 5 }] }],
    resolved: false, astra_verdict: null, ...over.flag,
  }
  const reviewer = {
    id: 'rv1', title: 'Cell Biology', subject: 'Biology', text: 'old text', html: '<html>old</html>',
    content: { title: 'Cell Biology', summary: '', sections: [{ heading: 'Chapter 3', points: ['x'] }], terms: [], flashcards: [], quiz: [] },
    template: 'classic', theme: 'indigo', owner_id: 'stu', is_public: true, ...over.reviewer,
  }
  const f = createFake({
    tokens: { adm: ADMIN, astra: ASTRA, other: OTHER, st: STUDENT },
    tables: {
      admins: [{ user_id: 'admin' }],
      profiles: [{ user_id: 'stu', school: SCHOOL }, { user_id: 'stu2', school: SCHOOL }, { user_id: 'astra1', school: SCHOOL }, { user_id: 'astra2', school: 'Another University' }],
      astra_members: [{ user_id: 'astra1', school: SCHOOL }, { user_id: 'astra2', school: 'Another University' }],
      reviewers: [reviewer],
      reviewer_flags: [flag, ...(over.flags || [])],
      usage: over.usage || [],
    },
    files: { 'notes/stu/flags/rv1/a.txt': { data: [104, 105] }, 'notes/other/x.txt': { data: [1] }, 'notes/stu/flags/rv1/big.txt': { data: [1], size: 6 * 1048576 } },
  })
  return f
}
const ai = (text = good) => ({ generateJson: async () => ({ text, tokens: 11, model: 'gemini-3.8-flash' }) })
const run = (f, o = {}) => runFix({ db: f.client, authHeader: 'Bearer adm', body: { flagId: 'f1' }, ai: ai(), key: 'k', ...o })
const flagRow = f => f.db.tables.reviewer_flags[0]

test('auth: anonymous 401, student 403, Astra of another school 403', async () => {
  const f = setup()
  assert.equal((await run(f, { authHeader: '' })).status, 401)
  assert.equal((await run(f, { authHeader: 'Bearer st' })).status, 403)
  assert.equal((await run(f, { authHeader: 'Bearer other' })).status, 403)
  assert.equal(flagRow(f).resolved, false)
})
test('admin fixes the reviewer in place and resolves the flag', async () => {
  const f = setup(), r = await run(f)
  assert.equal(r.status, 200); assert.equal(r.body.fixed, 1)
  const rv = f.db.tables.reviewers[0]
  assert.equal(rv.content.sections[0].heading, 'Chapter 4')
  assert.ok(rv.content.sections.some(s => s.heading === 'Chapter 3'))   // nothing the old reviewer had is dropped
  assert.equal(rv.title, 'Cell Biology')                    // the original title is kept
  assert.match(rv.html, /Chapter 4/)
  assert.equal(flagRow(f).resolved, true); assert.equal(flagRow(f).astra_verdict, 'valid')
  assert.equal(f.db.tables.usage[0].user_id, 'admin'); assert.equal(f.db.tables.usage[0].model, 'gemini-3.8-flash')
})
test('Astra of the same school can approve and fix a flag', async () => {
  const f = setup(), r = await run(f, { authHeader: 'Bearer astra' })
  assert.equal(r.status, 200); assert.equal(flagRow(f).resolved, true); assert.equal(flagRow(f).astra_verdict, 'valid')
})
test('admin fixes all open flags on the reviewer in one pass', async () => {
  const f = setup({ flags: [{ id: 'f2', reviewer_id: 'rv1', user_id: 'other', reason: 'wrong_info', note: 'Wrong date', points: [{ reason: 'wrong_info', note: 'Wrong date', files: [] }], resolved: false, astra_verdict: null }] })
  const r = await run(f)
  assert.equal(r.status, 200); assert.equal(r.body.fixed, 2)
  assert.equal(f.db.tables.reviewer_flags.every(x => x.resolved), true)
})
test('validation: missing flagId 400, unknown flag 404', async () => {
  const f = setup()
  assert.equal((await run(f, { body: {} })).status, 400)
  assert.equal((await run(f, { body: { flagId: 'zzz' } })).status, 404)
})
test('SECURITY: a file path pointing at another student is refused before any download', async () => {
  const f = setup({ flag: { points: [{ reason: 'missing_topics', note: 'x', files: [{ path: 'other/x.txt', name: 'x.txt', type: 'text/plain', size: 1 }] }] } })
  const r = await run(f)
  assert.equal(r.status, 422); assert.equal(flagRow(f).resolved, false); assert.equal(f.db.tables.reviewers[0].html, '<html>old</html>')
})
test('SECURITY: oversize flag file is refused server-side', async () => {
  const f = setup({ flag: { points: [{ reason: 'missing_topics', note: 'x', files: [{ path: 'stu/flags/rv1/big.txt', name: 'big.txt', type: 'text/plain', size: 1 }] }] } })
  assert.equal((await run(f)).status, 422)
})
test('AI failure leaves the reviewer and the flag untouched', async () => {
  const f = setup(), r = await run(f, { ai: { generateJson: async () => { throw Object.assign(new Error('No Gemini model could answer'), { status: 503 }) } } })
  assert.equal(r.status, 503)
  assert.equal(flagRow(f).resolved, false)
  assert.equal(f.db.tables.reviewers[0].html, '<html>old</html>')
})
test('a reviewer with no structured content falls back to its stored text', async () => {
  const f = setup({ reviewer: { content: null, text: 'chapter three notes' } })
  const r = await run(f)
  assert.equal(r.status, 200); assert.equal(f.db.tables.reviewers[0].content.sections[0].heading, 'Chapter 4')
})
test('daily AI budget blocks the fix and leaves the flag open', async () => {
  const at = new Date().toISOString()
  const f = setup({ usage: Array.from({ length: 30 }, (_, i) => ({ id: i + 1, user_id: 'x', at })) })
  assert.equal((await run(f)).status, 429); assert.equal(flagRow(f).resolved, false)
})
test('a fix that adds nothing new says so instead of silently resolving the flag', async () => {
  const same = JSON.stringify({ title: 'Cell Biology', summary: '', sections: [{ heading: 'Chapter 3', points: ['x'] }], terms: [], flashcards: [], quiz: [] })
  const f = setup(), r = await run(f, { ai: ai(same) })
  assert.equal(r.status, 422)
  assert.match(r.body.error, /nothing new/)
  assert.equal(flagRow(f).resolved, false)
  assert.equal(f.db.tables.reviewers[0].html, '<html>old</html>')
})
test('an "Add subject" flag fills an Unsorted subject from the fix answer', async () => {
  const text = JSON.stringify({ subject: 'Marketing', title: 'Cell Biology', summary: '', sections: [{ heading: 'Chapter 3', points: ['x'] }], terms: [], flashcards: [], quiz: [] })
  const f = setup({ reviewer: { subject: 'Unsorted' } })
  const r = await run(f, { ai: ai(text) })
  assert.equal(r.status, 200)
  assert.equal(f.db.tables.reviewers[0].subject, 'Marketing')
  assert.equal(flagRow(f).resolved, true)
})
test('an AI draft keeps the existing reviewer content and adds the new section', async () => {
  const f = setup(), r = await run(f, { body: { flagId: 'f1', mode: 'draft' } })
  assert.equal(r.status, 200); assert.equal(r.body.drafted, true)
  const p = flagRow(f).proposed
  assert.ok(p.sections.some(s => s.heading === 'Chapter 4'))
  assert.ok(p.sections.some(s => s.heading === 'Chapter 3'))
  assert.equal(flagRow(f).resolved, false)
})
