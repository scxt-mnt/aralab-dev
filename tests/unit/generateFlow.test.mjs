import test from 'node:test'
import assert from 'node:assert/strict'
import { createFake } from '../fakeSupabase.js'
import { runGenerate, checkFileList } from '../../server/generateFlow.js'

const ADMIN = { id: 'admin' }, STUDENT = { id: 'stu' }, ASTRA = { id: 'astra1' }, OTHER = { id: 'astra2' }
const SCHOOL = 'University of the Philippines Diliman'
const good = JSON.stringify({ title: 'T', summary: 's', sections: [{ heading: 'h', points: ['p'] }], flashcards: [], quiz: [], terms: [] })
function setup(over = {}, file = { path: 'stu/r1/a.txt', name: 'a.txt', type: 'text/plain', size: 5 }) {
  const f = createFake({
    tokens: { adm: ADMIN, st: STUDENT, astra: ASTRA, other: OTHER },
    tables: {
      admins: [{ user_id: 'admin' }],
      profiles: [{ user_id: 'stu', school: SCHOOL }, { user_id: 'astra1', school: SCHOOL }, { user_id: 'astra2', school: 'Another University' }],
      astra_members: [{ user_id: 'astra1', school: SCHOOL }, { user_id: 'astra2', school: 'Another University' }],
      usage: [], reviewers: [], gen_log: [], notifications: [],
      reviewer_requests: [{ id: 'r1', user_id: 'stu', title: 'T', subject: 'S', topic: 't', coverage: 'c', template: 'classic', theme: 'indigo', status: 'pending', files: [file], ...over }],
    },
    files: { 'notes/stu/r1/a.txt': { data: [104, 105] }, 'notes/other/x.txt': { data: [1] }, 'notes/stu/r1/big.txt': { data: [1], size: 6 * 1048576 } },
  })
  return f
}
// one fake AI for both calls: the check (system prompt mentions "duplicate checker") and the reviewer itself
const verdict = (v = {}) => JSON.stringify({ verdict: 'ok', reason: '', duplicate_of: null, ...v })
const ai = (text = good, scan = verdict()) => ({ generateJson: async ({ system }) => ({ text: /duplicate checker/.test(system) ? scan : text, tokens: 7, model: 'gemini-3.8-flash' }) })
const run = (f, o = {}) => runGenerate({ db: f.client, authHeader: 'Bearer st', body: { requestId: 'r1' }, ai: ai(), key: 'k', ...o })
const row = f => f.db.tables.reviewer_requests[0]
const lastLog = f => f.db.tables.gen_log?.at(-1)

test('auth: anonymous 401; another student 403; Astra can no longer generate for someone else', async () => {
  const f = setup()
  assert.equal((await run(f, { authHeader: '' })).status, 401)
  assert.equal((await run(f, { authHeader: 'Bearer other' })).status, 403)
  assert.equal((await run(f, { authHeader: 'Bearer astra' })).status, 403)
  assert.equal(row(f).status, 'pending')
})
test('validation: missing id 400, unknown 404', async () => {
  const f = setup()
  assert.equal((await run(f, { body: {} })).status, 400)
  assert.equal((await run(f, { body: { requestId: 'zzz' } })).status, 404)
})
test('a student generates their OWN request straight away: published, owned by them, usage + log written', async () => {
  const f = setup(), r = await run(f)
  assert.equal(r.status, 200); assert.equal(r.body.model, 'gemini-3.8-flash')
  const rv = f.db.tables.reviewers[0]
  assert.equal(rv.owner_id, 'stu'); assert.equal(rv.is_public, true)
  assert.equal(f.db.tables.usage[0].tokens, 14)                  // the check + the reviewer
  assert.equal(row(f).status, 'done'); assert.equal(lastLog(f).outcome, 'generated')
})
test('v75: the pictures the student chose are attached to the generated reviewer; junk is dropped', async () => {
  const pic = { name: 'IMG_2043.jpg', url: 'data:image/jpeg;base64,AAAA' }
  const f = setup(), r = await run(f, { body: { requestId: 'r1', visuals: [pic, { name: 'remote', url: 'https://example.com/a.jpg' }, { name: 'fake', url: 'data:text/html;base64,AAA' }] } })
  assert.equal(r.status, 200)
  const rv = f.db.tables.reviewers[0]
  assert.deepEqual(rv.content.visuals, [{ name: 'IMG 2043', url: pic.url }])
  assert.match(rv.html, /data:image\/jpeg;base64,AAAA/)      // the Pictures tab is part of the page
  assert.match(rv.html, /id="view-pics"/)
})
test('v75: a reviewer without pictures has no Pictures tab', async () => {
  const f = setup(), r = await run(f)
  assert.equal(r.status, 200)
  assert.deepEqual(f.db.tables.reviewers[0].content.visuals, [])
  assert.equal(f.db.tables.reviewers[0].html.includes('view-pics'), false)
})
test('admins may still generate any request, and skip the AI check', async () => {
  let scans = 0
  const spy = { generateJson: async ({ system }) => { if (/duplicate checker/.test(system)) scans++; return { text: good, tokens: 1, model: 'm' } } }
  const f = setup(), r = await run(f, { authHeader: 'Bearer adm', ai: spy })
  assert.equal(r.status, 200); assert.equal(scans, 0)
})
test('double click: second call gets 409 and nothing is duplicated', async () => {
  const f = setup(); await run(f)
  assert.equal((await run(f)).status, 409); assert.equal(f.db.tables.reviewers.length, 1)
})
test('UNLIMITED: a student can generate many reviewers in one day (old limit was 3)', async () => {
  const at = new Date().toISOString(), f = setup()
  f.db.tables.usage.push(...Array.from({ length: 40 }, (_, i) => ({ id: i, user_id: 'stu', at })))
  assert.equal((await run(f)).status, 200)
})
test('optional emergency brake still works when the env var is set', async () => {
  process.env.DAILY_USER_LIMIT = '2'
  try {
    const f = setup(), at = new Date().toISOString(); f.db.tables.usage.push(...[1, 2].map(i => ({ id: i, user_id: 'stu', at })))
    assert.equal((await run(f)).status, 429); assert.equal(row(f).status, 'pending')
  } finally { delete process.env.DAILY_USER_LIMIT }
})
test('AI check: not study material is blocked, logged, and the request is rejected with a reason', async () => {
  const f = setup(), r = await run(f, { ai: ai(good, verdict({ verdict: 'not_study', reason: 'It is a chat log.' })) })
  assert.equal(r.status, 422); assert.equal(r.body.blocked, true); assert.equal(r.body.category, 'not_study')
  assert.match(r.body.error, /study material/); assert.equal(f.db.tables.reviewers.length, 0)
  assert.equal(row(f).status, 'rejected'); assert.match(row(f).admin_note, /Blocked by the AI check/)
  assert.equal(lastLog(f).outcome, 'blocked'); assert.equal(lastLog(f).category, 'not_study')
})
test('AI check: inappropriate, private and spam are all blocked', async () => {
  for (const v of ['inappropriate', 'private', 'spam']) {
    const f = setup(), r = await run(f, { ai: ai(good, verdict({ verdict: v })) })
    assert.equal(r.status, 422, v); assert.equal(f.db.tables.reviewers.length, 0)
  }
})
test('AI check: an unreadable answer fails closed (nothing is published)', async () => {
  const f = setup(), r = await run(f, { ai: ai(good, 'sorry I cannot') })
  assert.equal(r.status, 502); assert.equal(f.db.tables.reviewers.length, 0); assert.equal(row(f).status, 'failed')
})
test('duplicate: same title + subject already public is refused WITHOUT calling the AI', async () => {
  let calls = 0
  const f = setup(); f.db.tables.reviewers.push({ id: 'old1', title: 'T', subject: 'S', is_public: true })
  const r = await run(f, { ai: { generateJson: async () => { calls++; return { text: good, tokens: 1, model: 'm' } } } })
  assert.equal(r.status, 409); assert.equal(r.body.duplicate.id, 'old1'); assert.equal(calls, 0)
  assert.equal(row(f).status, 'rejected'); assert.equal(row(f).reviewer_id, 'old1'); assert.equal(lastLog(f).outcome, 'duplicate')
})
test('duplicate: the AI finds a similar reviewer with another title and points to it', async () => {
  const f = setup({ title: 'Cell Biology Midterm', subject: 'Biology', topic: 'cell organelles' })
  f.db.tables.reviewers.push({ id: 'old2', title: 'Biology: cell parts', subject: 'Biology', is_public: true, content: { summary: 'Cell organelles', sections: [{ heading: 'Nucleus' }] } })
  const r = await run(f, { ai: ai(good, verdict({ duplicate_of: 'old2' })) })
  assert.equal(r.status, 409); assert.equal(r.body.duplicate.id, 'old2'); assert.equal(f.db.tables.reviewers.length, 1)
})
test('duplicate: the AI cannot point to an id that was not offered; a removed (private) reviewer never counts', async () => {
  const f = setup({ title: 'Cell Biology Midterm', subject: 'Biology' })
  f.db.tables.reviewers.push({ id: 'gone', title: 'Cell Biology Midterm notes', subject: 'Biology', is_public: false })
  const r = await run(f, { ai: ai(good, verdict({ duplicate_of: 'made-up' })) })
  assert.equal(r.status, 200)
})
test('a paused student cannot generate, sees the reason, and the request stays untouched', async () => {
  const f = setup(); f.db.tables.profiles.find(p => p.user_id === 'stu').gen_paused_until = new Date(Date.now() + 86400000).toISOString()
  f.db.tables.profiles.find(p => p.user_id === 'stu').gen_pause_reason = 'Uploading unrelated files'
  const r = await run(f)
  assert.equal(r.status, 403); assert.equal(r.body.paused, true); assert.match(r.body.error, /Uploading unrelated files/)
  assert.equal(row(f).status, 'pending'); assert.equal(f.db.tables.reviewers.length, 0)
})
test('a pause that has ended no longer blocks', async () => {
  const f = setup(); f.db.tables.profiles.find(p => p.user_id === 'stu').gen_paused_until = new Date(Date.now() - 1000).toISOString()
  assert.equal((await run(f)).status, 200)
})
test('a banned student cannot generate', async () => {
  const f = setup(); f.db.tables.profiles.find(p => p.user_id === 'stu').banned = true
  assert.equal((await run(f)).status, 403)
})
test('at most 3 builds of one student at once (not a quota, only a flood guard)', async () => {
  const f = setup(), fresh = new Date().toISOString()
  for (const id of ['a', 'b', 'c']) f.db.tables.reviewer_requests.push({ id, user_id: 'stu', status: 'generating', reviewed_at: fresh, files: [] })
  assert.equal((await run(f)).status, 429); assert.equal(row(f).status, 'pending')
})
test('a FRESH generating row still blocks a double start', async () => {
  const f = setup({ status: 'generating', reviewed_at: new Date().toISOString() })
  assert.equal((await run(f)).status, 409); assert.equal(row(f).status, 'generating')
})
test('a STALE generating row can be claimed again instead of being stuck forever', async () => {
  const f = setup({ status: 'generating', reviewed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
  const r = await run(f)
  assert.equal(r.status, 200); assert.equal(row(f).status, 'done'); assert.equal(f.db.tables.reviewers.length, 1)
})
test('stale generating rows do not count toward the running limit', async () => {
  const f = setup(), old = new Date(Date.now() - 10 * 60 * 1000).toISOString()
  for (const id of ['a', 'b', 'c']) f.db.tables.reviewer_requests.push({ id, user_id: 'stu', status: 'generating', reviewed_at: old, files: [] })
  assert.equal((await run(f)).status, 200)
})
test('a stale row with no reviewed_at can be claimed again', async () => {
  const f = setup({ status: 'generating', reviewed_at: null })
  const r = await run(f)
  assert.equal(r.status, 200); assert.equal(row(f).status, 'done')
})
test('a stale row with Postgres fractional seconds (+00:00) is reclaimed', async () => {
  const f = setup({ status: 'generating', reviewed_at: '2026-11-04T15:18:01.97+00:00' })
  assert.equal((await run(f)).status, 200)
})
test('repeated blocked attempts alert the admin and the Astra of that school (every 3rd)', async () => {
  const f = setup()
  for (let i = 0; i < 3; i++) { f.db.tables.reviewer_requests[0].status = 'pending'; await run(f, { ai: ai(good, verdict({ verdict: 'not_study' })) }) }
  const n = f.db.tables.notifications || []
  assert.deepEqual(n.map(x => x.user_id).sort(), ['admin', 'astra1']); assert.ok(n.every(x => x.kind === 'task_gen' && x.ref === 'stu'))
})
test('works before the v47 SQL is run: a missing gen_log table never blocks a generation', async () => {
  const f = setup(); f.db.failNext = { table: 'gen_log', message: 'relation does not exist' }
  assert.equal((await run(f)).status, 200)
})
test('SECURITY: file path pointing at another student is refused before any download', async () => {
  const f = setup({}, { path: 'other/x.txt', name: 'x.txt', type: 'text/plain', size: 1 })
  const r = await run(f)
  assert.equal(r.status, 422); assert.equal(row(f).status, 'failed'); assert.equal(f.db.tables.reviewers.length, 0)
})
test('SECURITY: path traversal, bad type, too many files (images have no count limit)', () => {
  assert.match(checkFileList([{ path: 'stu/../other/x', name: 'x', type: 'text/plain' }], 'stu'), /does not belong/)
  assert.match(checkFileList([{ path: 'stu/a', name: 'a', type: 'application/x-msdownload' }], 'stu'), /unsupported/)
  assert.match(checkFileList(Array(51).fill({ path: 'stu/a', name: 'a', type: 'text/plain' }), 'stu'), /Too many files/)
  assert.equal(checkFileList(Array(40).fill({ path: 'stu/a', name: 'a', type: 'image/png' }), 'stu'), '')
  assert.equal(checkFileList([{ path: 'stu/a', name: 'a', type: 'application/pdf' }], 'stu'), '')
})
test('SECURITY: oversize file is refused server-side even if the browser check was bypassed', async () => {
  const f = setup({}, { path: 'stu/r1/big.txt', name: 'big.txt', type: 'text/plain', size: 1 })
  assert.equal((await run(f)).status, 422)
})
test('AI failure marks the request failed with a readable error; the student can retry it', async () => {
  const f = setup(), r = await run(f, { ai: { generateJson: async ({ system }) => { if (/duplicate checker/.test(system)) return { text: verdict(), tokens: 1, model: 'm' }; throw Object.assign(new Error('No Gemini model could answer'), { status: 503 }) } } })
  assert.equal(r.status, 503); assert.equal(row(f).status, 'failed'); assert.match(row(f).error, /No Gemini/)
  assert.equal((await run(f)).status, 200)
})
test('too-thin notes produce a failure, not an empty reviewer', async () => {
  const f = setup(); const r = await run(f, { ai: ai('{"title":"x"}') })
  assert.equal(r.status, 422); assert.equal(f.db.tables.reviewers.length, 0)
})
