import test from 'node:test'
import assert from 'node:assert/strict'
import { suggestReviewers, programWords } from '../../src/suggest.js'

const R = (id, title, subject, owner, extra = {}) => ({ id, title, subject, owner_id: owner, added: 1e12, stars: 0, ...extra })
const people = { a: { program: 'BS Nursing', school: 'PUP' }, b: { program: 'BS Information Technology', school: 'PUP' }, c: { program: 'BS Nursing', school: 'UP' } }
const base = { me: 'me', program: 'BS Nursing', school: 'PUP', people, now: 1e12 }

test('programWords drops filler words', () => {
  assert.deepEqual(programWords('Bachelor of Science in Nursing'), ['nursing'])
  assert.deepEqual(programWords('BS Information Technology'), ['information', 'technology'])
})
test('same program author and program words are suggested, unrelated reviewers are not', () => {
  const items = [R('1', 'Anatomy midterm', 'Anatomy', 'a'), R('2', 'Intro to Python', 'Programming', 'b', { stars: 50 }), R('3', 'Nursing fundamentals', 'NCM', 'c')]
  const s = suggestReviewers(items, base)
  assert.deepEqual(s.map(x => x.item.id).sort(), ['1', '3'])         // popular IT reviewer is NOT shown to a nursing student
  assert.equal(s.find(x => x.item.id === '1').reason, 'Same program')
})
test('based on my own and starred reviewers (subject interest)', () => {
  const items = [R('m', 'My bio', 'Biology', 'me'), R('x', 'Cells', 'Biology', 'b'), R('y', 'Genetics', 'Biology', 'b'), R('z', 'Algebra', 'Math', 'b'), R('s', 'Calculus', 'Math', 'b')]
  const s = suggestReviewers(items, { ...base, program: '', starred: new Set(['s']) })
  assert.deepEqual(s.map(x => x.item.id).sort(), ['x', 'y', 'z'])      // Biology via mine; Math via the starred one; the starred one itself is not repeated
  assert.match(s.find(x => x.item.id === 'x').reason, /Like your Biology/)
})
test('never suggests my own, removed, private or already starred reviewers; max 4 and max 2 per subject', () => {
  const items = [R('1', 'a', 'S', 'me'), R('2', 'b', 'S', 'a', { removed_at: 1 }), R('3', 'c', 'S', 'a', { is_public: false }),
    ...['4', '5', '6', '7', '8', '9'].map(id => R(id, 'Nursing ' + id, id < '7' ? 'Same' : 'Other' + id, 'a'))]
  const s = suggestReviewers(items, base)
  assert.ok(s.length <= 4); assert.ok(!s.some(x => ['1', '2', '3'].includes(x.item.id)))
  assert.ok(s.filter(x => x.item.subject === 'Same').length <= 2)
})
test('no profile info and no history -> nothing to suggest', () => {
  assert.deepEqual(suggestReviewers([R('1', 'x', 'S', 'a')], { me: 'me', people }), [])
  assert.deepEqual(suggestReviewers(undefined), [])
})
