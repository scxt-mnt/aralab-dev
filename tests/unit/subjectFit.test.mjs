import test from 'node:test'
import assert from 'node:assert/strict'
import { createFake } from '../fakeSupabase.js'
import { runGenerate, importFromPdf } from '../../server/generateFlow.js'
import { parseVerdict, fitVerdict, hasSubject, MIN_SUBJECT_FIT, SCREEN_SYSTEM, resolveSubject } from '../../server/screen.js'

const SCHOOL = 'University of the Philippines Diliman'
const good = JSON.stringify({ title: 'T', summary: 's', sections: [{ heading: 'h', points: ['p'] }], flashcards: [], quiz: [], terms: [] })
const file = { path: 'stu/r1/a.txt', name: 'a.txt', type: 'text/plain', size: 5 }
const setup = over => createFake({
  tokens: { st: { id: 'stu' } },
  tables: { admins: [], profiles: [{ user_id: 'stu', school: SCHOOL }], astra_members: [], usage: [], reviewers: [], gen_log: [], notifications: [],
    reviewer_requests: [{ id: 'r1', user_id: 'stu', title: 'Cell Biology Midterm', subject: 'Biology', topic: 't', coverage: '', template: 'classic', theme: 'indigo', status: 'pending', files: [file], ...over }] },
  files: { 'notes/stu/r1/a.txt': { data: [104, 105] } },
})
const verdict = v => JSON.stringify({ verdict: 'ok', reason: '', duplicate_of: null, ...v })
const ai = scan => ({ generateJson: async ({ system }) => ({ text: /duplicate checker/.test(system) ? scan : good, tokens: 1, model: 'm' }) })
const run = (f, scan) => runGenerate({ db: f.client, authHeader: 'Bearer st', body: { requestId: 'r1' }, ai: ai(scan), key: 'k' })

test('the check asks the AI for subject_fit and the strictness is a visible constant', () => {
  assert.match(SCREEN_SYSTEM, /subject_fit/); assert.match(SCREEN_SYSTEM, /detected_subject/); assert.match(SCREEN_SYSTEM, /duplicate checker/)
  assert.equal(MIN_SUBJECT_FIT, 6)
})
test('parseVerdict reads subject_fit (0-10, rounded, clamped) and tolerates a missing one', () => {
  assert.equal(parseVerdict('{"verdict":"ok","subject_fit":8.4,"detected_subject":" Accounting "}', []).fit, 8)
  assert.equal(parseVerdict('{"verdict":"ok","subject_fit":99}', []).fit, 10)
  assert.equal(parseVerdict('{"verdict":"ok","subject_fit":-3}', []).fit, 0)
  assert.equal(parseVerdict('{"verdict":"ok","subject_fit":"7"}', []).fit, 7)
  assert.equal(parseVerdict('{"verdict":"ok"}', []).fit, null)
  assert.equal(parseVerdict('{"verdict":"ok","subject_fit":"high"}', []).fit, null)
  assert.equal(parseVerdict('{"verdict":"ok","subject_fit":3,"detected_subject":"Accounting"}', []).detected, 'Accounting')
})
test('fitVerdict: below the line is off_subject, at the line passes, no score or a non-ok verdict is left alone, Classroom is exempt', () => {
  const req = { title: 'Cell Biology Midterm', subject: 'Biology', topic: 't' }
  const low = fitVerdict({ verdict: 'ok', fit: 5, detected: 'Accounting', reason: 'fine', duplicateOf: 'x' }, req)
  assert.equal(low.verdict, 'off_subject'); assert.equal(low.duplicateOf, null)
  assert.match(low.reason, /don’t match the subject “Biology”\. They look like Accounting notes/)
  assert.equal(fitVerdict({ verdict: 'ok', fit: 6 }, req).verdict, 'ok')
  assert.equal(fitVerdict({ verdict: 'ok', fit: null }, req).verdict, 'ok')
  assert.equal(fitVerdict({ verdict: 'spam', fit: 0 }, req).verdict, 'spam')
  assert.equal(fitVerdict({ verdict: 'ok', fit: 1 }, { ...req, topic: 'gc:1:m-2' }).verdict, 'ok')
  assert.match(fitVerdict({ verdict: 'ok', fit: 2 }, { title: 'Cell Biology Midterm', subject: 'Unsorted', topic: '' }).reason, /the title “Cell Biology Midterm”/)
  assert.equal(hasSubject({ subject: ' unsorted ' }), false); assert.equal(hasSubject({ subject: '' }), false); assert.equal(hasSubject({ subject: 'Biology' }), true)
})
test('resolveSubject: an existing spelling wins, a typo is matched, a new name is kept, Unsorted is ignored', () => {
  assert.equal(resolveSubject('purposive communication', ['Purposive Communication', 'Biology']), 'Purposive Communication')
  assert.equal(resolveSubject('Biolgy', ['Purposive Communication', 'Biology']), 'Biology')
  assert.equal(resolveSubject('Brand Management', ['Biology']), 'Brand Management')
  assert.equal(resolveSubject(' Unsorted ', ['Biology']), '')
  assert.equal(resolveSubject('', ['Biology']), '')
})
test('generate: a blank/Unsorted subject is filled from the AI check with the existing spelling', async () => {
  const f = setup({ subject: 'Unsorted', title: 'Week 2 notes' })
  f.db.tables.reviewers.push({ id: 'old', title: 'Something else', subject: 'Purposive Communication', is_public: true })
  const r = await run(f, verdict({ detected_subject: 'purposive communication', subject_fit: 10 }))
  assert.equal(r.status, 200)
  assert.equal(f.db.tables.reviewer_requests[0].subject, 'Purposive Communication')
  assert.equal(f.db.tables.reviewers.find(x => x.id !== 'old').subject, 'Purposive Communication')
})
test('generate: the admin path also names a blank subject from the reviewer answer', async () => {
  const f = createFake({
    tokens: { adm: { id: 'admin' } },
    tables: { admins: [{ user_id: 'admin' }], profiles: [], astra_members: [], usage: [], reviewers: [], gen_log: [], notifications: [],
      reviewer_requests: [{ id: 'r1', user_id: 'stu', title: 'Week 2', subject: 'Unsorted', topic: 't', coverage: '', template: 'classic', theme: 'indigo', status: 'pending', files: [file] }] },
    files: { 'notes/stu/r1/a.txt': { data: [104, 105] } },
  })
  const text = JSON.stringify({ subject: 'marketing', title: 'T', summary: 's', sections: [{ heading: 'h', points: ['p'] }], flashcards: [], quiz: [], terms: [] })
  const r = await runGenerate({ db: f.client, authHeader: 'Bearer adm', body: { requestId: 'r1' }, ai: { generateJson: async () => ({ text, tokens: 1, model: 'm' }) }, key: 'k' })
  assert.equal(r.status, 200)
  assert.equal(f.db.tables.reviewer_requests[0].subject, 'marketing')
  assert.equal(f.db.tables.reviewers[0].subject, 'marketing')
})
test('generate: notes that do not match the subject are stopped, with a reason, and nothing is published', async () => {
  const f = setup(), r = await run(f, verdict({ subject_fit: 2, detected_subject: 'Accounting' }))
  assert.equal(r.status, 422); assert.equal(r.body.category, 'off_subject'); assert.equal(r.body.blocked, true)
  assert.match(r.body.error, /^These notes don’t match the subject “Biology”\. They look like Accounting notes\./)
  assert.equal(f.db.tables.reviewers.length, 0)
  const row = f.db.tables.reviewer_requests[0]; assert.equal(row.status, 'rejected'); assert.match(row.admin_note, /Subject check/)
  const log = f.db.tables.gen_log.at(-1); assert.equal(log.outcome, 'failed'); assert.equal(log.category, 'off_subject')      // a mistake, not misuse: never counted as "blocked" and never alerts staff
  assert.equal(f.db.tables.notifications.length, 0)
})
test('generate: repeated mismatches never alert staff', async () => {
  const f = setup()
  for (let i = 0; i < 4; i++) { f.db.tables.reviewer_requests[0].status = 'pending'; await run(f, verdict({ subject_fit: 1 })) }
  assert.equal(f.db.tables.notifications.length, 0); assert.ok(f.db.tables.gen_log.every(l => l.outcome === 'failed'))
})
test('generate: a good match, a borderline match and an old-style answer without a score all go through', async () => {
  for (const scan of [verdict({ subject_fit: 9 }), verdict({ subject_fit: 6 }), verdict({})]) {
    const f = setup(), r = await run(f, scan)
    assert.equal(r.status, 200, scan); assert.equal(f.db.tables.reviewers.length, 1)
  }
})
test('generate: a Google Classroom request is not subject-checked', async () => {
  const f = setup({ topic: 'gc:1:m-2' }), r = await run(f, verdict({ subject_fit: 0 }))
  assert.equal(r.status, 200)
})
test('generate: other verdicts still win (not study material is blocked as before, and counted)', async () => {
  const f = setup(), r = await run(f, verdict({ verdict: 'not_study', subject_fit: 0, reason: 'chat log' }))
  assert.equal(r.body.category, 'not_study'); assert.equal(f.db.tables.gen_log.at(-1).outcome, 'blocked')
})
test('generate: an uploaded finished reviewer is published as-is and the AI is never called', async () => {
  const f = setup({ subject: 'Unsorted', title: 'Biology Reviewer' })
  f.db.tables.reviewers.push({ id: 'old', title: 'Cell basics', subject: 'Biology', is_public: true })
  let calls = 0
  const imported = {
    title: 'Biology Reviewer', summary: 'Cell basics', subject: 'biology',
    sections: [{ heading: 'Cell parts', points: ['Nucleus stores DNA', 'Mitochondria make ATP'] }],
    terms: [{ term: 'ATP', definition: 'Energy currency' }],
    flashcards: [{ q: 'Powerhouse of the cell?', a: 'Mitochondria' }],
    quiz: [{ q: 'Which organelle makes ATP?', choices: ['Nucleus', 'Mitochondria'], answer: 1, why: 'Respiration happens there.' }],
  }
  const r = await runGenerate({
    db: f.client, authHeader: 'Bearer st', body: { requestId: 'r1', importContent: imported }, key: 'k',
    ai: { generateJson: async ({ system }) => { calls++; return { text: /duplicate checker/.test(system) ? verdict({ subject_fit: 10 }) : good, tokens: 1, model: 'm' } } },
  })
  assert.equal(r.status, 200)
  assert.equal(calls, 0)                                   // no AI at all: the file is already a reviewer
  assert.equal(r.body.model, 'import')
  const saved = f.db.tables.reviewers.find(x => x.id !== 'old')
  assert.deepEqual(saved.content.sections, imported.sections)
  assert.deepEqual(saved.content.quiz, imported.quiz)
  assert.equal(f.db.tables.reviewer_requests[0].status, 'done')
  assert.equal(f.db.tables.reviewer_requests[0].subject, 'Biology')   // existing spelling wins
})
test('generate: importing a finished reviewer replaces the student’s own shortened copy', async () => {
  const f = setup({ subject: 'Biology', title: 'Cell Biology Midterm' })
  f.db.tables.reviewers.push({ id: 'old', title: 'Cell Biology Midterm', subject: 'Biology', is_public: true, owner_id: 'stu', content: { title: 'old' }, html: 'old' })
  const imported = { title: 'Cell Biology Midterm', sections: [{ heading: 'Cell parts', points: ['Nucleus stores DNA'] }], flashcards: [], quiz: [], terms: [] }
  const r = await runGenerate({ db: f.client, authHeader: 'Bearer st', body: { requestId: 'r1', importContent: imported }, ai: ai(verdict({ subject_fit: 10 })), key: 'k' })
  assert.equal(r.status, 200)
  assert.equal(r.body.reviewerId, 'old')
  const saved = f.db.tables.reviewers.find(x => x.id === 'old')
  assert.equal(saved.content.sections[0].points[0], 'Nucleus stores DNA')
  assert.match(saved.html, /Nucleus stores DNA/)
  assert.equal(f.db.tables.reviewer_requests[0].status, 'done')
})
test('generate: a reviewer PDF is read on the server and imported, not rewritten', async () => {
  const pdf = { path: 'stu/r1/r.pdf', name: 'ProfEd Reviewer - Child Development.pdf', type: 'application/pdf', size: 10 }
  const f = setup({ title: 'ProfEd Reviewer', files: [pdf] })
  f.db.files['notes/stu/r1/r.pdf'] = { data: [1, 2, 3] }
  const c = await importFromPdf({
    db: f.client, reqRow: f.db.tables.reviewer_requests[0],
    extract: async () => `ProfEd Reviewer: Child Development
UNIT 1: FOUNDATIONS OF HUMAN GROWTH
Growth and Development
Growth is measurable change in the body; development is wider.
Development: changes in abilities, thinking and emotions.
Domains: physical, cognitive, emotional, social, moral.
UNIT 2: PHYSICAL AND MOTOR DEVELOPMENT
Gross Motor Skills
Gross motor uses large muscles and whole-body movement.
Fine motor uses small muscles and precise hand movement.`,
  })
  assert.ok(c)
  assert.equal(c.title, 'ProfEd Reviewer: Child Development')
  assert.ok(c.sections.length >= 2)
})
test('generate: an ordinary PDF of notes is never read as a reviewer', async () => {
  const pdf = { path: 'stu/r1/n.pdf', name: 'lecture 3 notes.pdf', type: 'application/pdf', size: 10 }
  const f = setup({ title: 'Lecture 3', files: [pdf] })
  let called = false
  const c = await importFromPdf({ db: f.client, reqRow: f.db.tables.reviewer_requests[0], extract: async () => { called = true; return 'x' } })
  assert.equal(c, null)
  assert.equal(called, false)
})
test('generate: an import finds the student’s existing copy by the reviewer title, not the request title', async () => {
  const f = setup({ subject: 'Unsorted', title: 'Lesson 3-4 upload' })
  f.db.tables.reviewers.push({ id: 'old', title: 'Abbreviation Reviewer', subject: 'General Studies', is_public: true, owner_id: 'stu', content: {}, html: 'old' })
  const imported = { title: 'Abbreviation Reviewer', subject: 'General Studies', sections: [{ heading: 'Terms', points: ['e.g. = for example'] }], flashcards: [], quiz: [], terms: [] }
  const r = await runGenerate({ db: f.client, authHeader: 'Bearer st', body: { requestId: 'r1', importContent: imported }, ai: ai(verdict({ subject_fit: 10 })), key: 'k' })
  assert.equal(r.status, 200)
  assert.equal(r.body.reviewerId, 'old')
  assert.equal(f.db.tables.reviewers.length, 1)                       // no second copy
  assert.match(f.db.tables.reviewers[0].html, /for example/)
})
test('generate: a newer upload merges into the existing Library reviewer and credits the uploader', async () => {
  const f = setup({ subject: 'Biology', title: 'Cell Biology Midterm' })
  f.db.tables.reviewers.push({
    id: 'old', title: 'Cell Biology Midterm', subject: 'Biology', is_public: true, owner_id: 'other', html: 'old',
    content: { title: 'Cell Biology Midterm', summary: '', sections: [{ heading: 'Cell parts', points: ['Nucleus stores DNA'] }], terms: [{ term: 'DNA', definition: 'Genetic material' }], flashcards: [], quiz: [] },
  })
  const imported = {
    title: 'Cell Biology Midterm',
    sections: [{ heading: 'Cell parts', points: ['Nucleus stores DNA', 'Mitochondria make ATP'] }, { heading: 'Respiration', points: ['Glycolysis splits glucose'] }],
    terms: [{ term: 'DNA', definition: 'Genetic material' }, { term: 'ATP', definition: 'Energy currency' }],
    flashcards: [], quiz: [],
  }
  const r = await runGenerate({ db: f.client, authHeader: 'Bearer st', body: { requestId: 'r1', importContent: imported }, ai: ai(verdict({ subject_fit: 10 })), key: 'k' })
  assert.equal(r.status, 200)
  assert.equal(r.body.model, 'merge')
  assert.equal(r.body.added.points, 2)
  assert.equal(r.body.added.sections, 1)
  const saved = f.db.tables.reviewers.find(x => x.id === 'old')
  assert.equal(saved.content.sections.length, 2)
  assert.deepEqual(saved.content.sections[0].points, ['Nucleus stores DNA', 'Mitochondria make ATP'])
  assert.ok(saved.content.terms.some(t => t.term === 'ATP'))
  assert.equal(f.db.tables.reviewers.length, 1)                       // no second copy
  const credit = f.db.tables.reviewer_flags.find(x => x.reviewer_id === 'old' && x.user_id === 'stu')
  assert.ok(credit)                                                   // shows under "Improved by"
  assert.equal(credit.resolved, true); assert.equal(credit.astra_verdict, 'valid')
  assert.equal(f.db.tables.reviewer_requests[0].status, 'done')
})
test('generate: re-uploading the same reviewer with nothing new is refused instead of silently doing nothing', async () => {
  const f = setup({ subject: 'Biology', title: 'Cell Biology Midterm' })
  const content = { title: 'Cell Biology Midterm', summary: '', sections: [{ heading: 'Cell parts', points: ['Nucleus stores DNA'] }], terms: [], flashcards: [], quiz: [] }
  f.db.tables.reviewers.push({ id: 'old', title: 'Cell Biology Midterm', subject: 'Biology', is_public: true, owner_id: 'stu', content, html: 'old' })
  const r = await runGenerate({ db: f.client, authHeader: 'Bearer st', body: { requestId: 'r1', importContent: content }, ai: ai(verdict({ subject_fit: 10 })), key: 'k' })
  assert.equal(r.status, 409)
  assert.match(r.body.error, /nothing new/)
  assert.equal(f.db.tables.reviewers[0].html, 'old')
  assert.equal((f.db.tables.reviewer_flags || []).length, 0)
})
test('generate: importContent must be a real reviewer and is size-capped', async () => {
  const f = setup({ subject: 'Biology' })
  const r = await runGenerate({ db: f.client, authHeader: 'Bearer st', body: { requestId: 'r1', importContent: { sections: [] } }, ai: ai(verdict({ subject_fit: 10 })), key: 'k' })
  assert.equal(r.status, 200)
  assert.notEqual(r.body.model, 'import')                  // empty import -> normal generation
})
