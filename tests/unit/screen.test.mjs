import test from 'node:test'
import assert from 'node:assert/strict'
import { exactDuplicate, shortlist, parseVerdict } from '../../server/screen.js'

const lib = [
  { id: 'a', title: 'Cell Biology Midterm', subject: 'Biology' },
  { id: 'b', title: 'Intro to Accounting', subject: 'Accounting' },
  { id: 'c', title: 'Biology: Cell organelles', subject: 'Biology' },
]
test('exactDuplicate: same title+subject ignoring case/spacing; different subject is not a duplicate', () => {
  assert.equal(exactDuplicate(lib, { title: ' cell biology  midterm ', subject: 'biology' }).id, 'a')
  assert.equal(exactDuplicate(lib, { title: 'Cell Biology Midterm', subject: 'Chemistry' }), null)
  assert.equal(exactDuplicate(lib, { title: 'Cell Biology Midterm', subject: 'Unsorted' }).id, 'a')
})
test('shortlist: most similar first, unrelated left out, capped', () => {
  const r = shortlist(lib, { title: 'Cell organelles review', subject: 'Biology', topic: 'cell' })
  assert.deepEqual(r.map(x => x.id).sort(), ['a', 'c']); assert.equal(shortlist(lib, { title: 'x', subject: '', topic: '' }).length, 0)
  assert.equal(shortlist(Array(30).fill({ id: 'z', title: 'Biology cell', subject: 'Biology' }), { title: 'Biology cell', subject: '', topic: '' }, 5).length, 5)
})
test('parseVerdict: only known verdicts; duplicate_of only if it was offered; blocked verdicts never carry a duplicate', () => {
  assert.equal(parseVerdict('{"verdict":"ok","duplicate_of":"a"}', ['a']).duplicateOf, 'a')
  assert.equal(parseVerdict('{"verdict":"ok","duplicate_of":"zzz"}', ['a']).duplicateOf, null)
  assert.equal(parseVerdict('{"verdict":"spam","duplicate_of":"a"}', ['a']).duplicateOf, null)
  assert.throws(() => parseVerdict('{"verdict":"maybe"}', []), /unreadable/)
  assert.throws(() => parseVerdict('nope', []), /unreadable/)
})
