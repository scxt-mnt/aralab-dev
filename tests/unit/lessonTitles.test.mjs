import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanLessons, parseTitles, runTitles, MAX } from '../../server/lessonTitles.js'
import { buildLessons, groupBySubject, readable } from '../../src/classroomLogic.js'

const db = ok => ({ auth: { getUser: async () => ({ data: { user: ok ? { id: 'u' } : null } }) } })

test('cleanLessons: caps the list and trims long text, drops entries without an id', () => {
  const l = cleanLessons(Array.from({ length: 40 }, (_, i) => ({ id: String(i), title: 'x'.repeat(500), text: 'y'.repeat(900), files: ['a.pdf'] })).concat([{ title: 'no id' }]))
  assert.equal(l.length, MAX); assert.equal(l[0].title.length, 120); assert.equal(l[0].text.length, 300)
})
test('parseTitles: only asked ids, quotes stripped, nothing usable -> error', () => {
  assert.deepEqual(parseTitles('{"titles":{"0":"“Cell Division”","1":"x","9":"Not asked"}}', ['0', '1']), { 0: 'Cell Division' })
  assert.throws(() => parseTitles('{"titles":{}}', ['0']))
})
test('runTitles: needs a signed-in user, names lessons, passes validate to the AI client', async () => {
  assert.equal((await runTitles({ db: db(false), authHeader: '', body: { lessons: [{ id: '0', title: 't' }] } })).status, 401)
  assert.equal((await runTitles({ db: db(true), authHeader: 'Bearer x', body: { lessons: [] } })).status, 400)
  let seen
  const ai = { generateJson: async o => { seen = o; return { text: '{"titles":{"0":"Photosynthesis Basics"}}' } } }
  const r = await runTitles({ db: db(true), authHeader: 'Bearer x', body: { lessons: [{ id: '0', title: 'week 3', files: ['photo.pdf'] }] }, ai, key: 'k' })
  assert.deepEqual(r.body, { titles: { 0: 'Photosynthesis Basics' } }); assert.equal(typeof seen.validate, 'function')
  const bad = await runTitles({ db: db(true), authHeader: 'Bearer x', body: { lessons: [{ id: '0', title: 't' }] }, ai: { generateJson: async () => { throw Object.assign(new Error('No model'), { status: 503 }) } } })
  assert.equal(bad.status, 503)
})
test('classroom: announcements and instruction-only assignments without files are not learning material', () => {
  const c = { id: 'c', name: 'Bio' }, long = 'Please read chapter 3 on photosynthesis and the light reactions before Friday.'
  const { lessons } = buildLessons(c, {
    materials: [{ id: '1', title: 'Notes', description: long }],
    work: [{ id: '2', title: 'HW', description: long }, { id: '3', title: 'HW file', materials: [{ driveFile: { driveFile: { id: 'f', title: 'a.pdf' } } }] }],
    announcements: [{ id: '4', text: long }, { id: '5', text: 'see file', materials: [{ driveFile: { driveFile: { id: 'g', title: 'b.pdf' } } }] }],
  })
  assert.deepEqual(lessons.map(l => l.id).sort(), ['a-5', 'm-1', 'w-3'])
  assert.equal(readable({ files: [], description: long, kind: 'a' }), false)
})
test('groupBySubject: merges sections of one subject, newest group first', () => {
  const L = (id, courseId, courseName, created) => ({ id, courseId, courseName, created })
  const g = groupBySubject([L('1', 'a', 'Biology 1A', '2026-01-01'), L('2', 'b', 'biology 1b', '2026-03-01'), L('3', 'c', 'Math', '2026-02-01')], n => n.replace(/\s*1[ab]$/i, ''))
  assert.deepEqual(g.map(x => [x.name, x.lessons.length]), [['Biology', 2], ['Math', 1]])
  assert.deepEqual(g[0].lessons.map(l => l.id), ['2', '1'])
})
