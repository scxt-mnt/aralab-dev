import test from 'node:test'
import assert from 'node:assert/strict'
import { filterItems, sortItems, words, activeCount, blankFilters } from '../../src/libraryFilter.js'
import { programsOf, filterPeople, sortPeople } from '../../src/campusLogic.js'
import { setupError, normProgram, normBio } from '../../src/programs.js'

const DAY = 864e5, NOW = 1_700_000_000_000
const items = [
  { id: 'a', title: 'Cell Biology', subject: 'Biology', text: 'membrane organelles nucleus', size: 100, added: NOW - 2 * DAY, owner_id: 'me' },
  { id: 'b', title: 'Child Development', subject: 'Education', text: 'piaget stages membrane', size: 900, added: NOW - 20 * DAY, owner_id: 'u2' },
  { id: 'c', title: 'Algebra', subject: 'Math', text: 'equations', size: 300, added: NOW - 400 * DAY, owner_id: null },
  { id: 'd', title: 'Zoology', subject: 'Biology', text: 'animals', size: 50, added: NOW - 1 * DAY, owner_id: 'u3' },
]
const ctx = { me: 'me', now: NOW, following: new Set(['u2']), mySchool: ' Bicol  University ', people: { u2: { school: 'bicol university' }, u3: { school: 'Other U' }, me: { school: 'Bicol University' } }, flagCount: { b: 1 } }
const ids = (f, c = ctx) => filterItems(items, { ...blankFilters(), ...f }, c).map(i => i.id)

test('search needs every word, in any order, anywhere by default', () => {
  assert.deepEqual(ids({ q: 'membrane cell' }), ['a'])
  assert.deepEqual(ids({ q: '  MEMBRANE ' }), ['a', 'b'])
  assert.deepEqual(ids({ q: 'nothing here' }), [])
  assert.deepEqual(words('  a   b  c '), ['a', 'b', 'c'])
})
test('search scope: titles only / subjects only', () => {
  assert.deepEqual(ids({ q: 'membrane', scope: 'title' }), [])
  assert.deepEqual(ids({ q: 'biology', scope: 'title' }), ['a'])
  assert.deepEqual(ids({ q: 'biology', scope: 'subject' }), ['a', 'd'])
})
test('contributor filters', () => {
  assert.deepEqual(ids({ who: 'mine' }), ['a'])
  assert.deepEqual(ids({ who: 'following' }), ['b'])
  assert.deepEqual(ids({ who: 'admin' }), ['c'])
  assert.deepEqual(ids({ who: 'school' }), ['a', 'b'])                 // same school, ignoring case and extra spaces
  assert.deepEqual(ids({ who: 'school' }, { ...ctx, mySchool: '' }), [])  // no school set: nothing matches, no crash
})
test('date ranges and the old subject chips still work', () => {
  assert.deepEqual(ids({ when: '7' }), ['a', 'd']); assert.deepEqual(ids({ when: '30' }), ['a', 'b', 'd']); assert.deepEqual(ids({ when: '365' }), ['a', 'b', 'd'])
  assert.deepEqual(ids({ subject: 'Biology' }), ['a', 'd']); assert.deepEqual(ids({ subject: '__mine' }), ['a']); assert.deepEqual(ids({ subject: '__flagged' }), ['b'])
})
test('filters combine, sorting does not mutate', () => {
  assert.deepEqual(ids({ subject: 'Biology', when: '7', q: 'zoo' }), ['d'])
  const copy = [...items]; sortItems(items, 'az'); assert.deepEqual(items, copy)
  assert.deepEqual(sortItems(items, 'az').map(i => i.id), ['c', 'a', 'b', 'd'])
  assert.deepEqual(sortItems(items, 'za').map(i => i.id), ['d', 'b', 'a', 'c'])
  assert.deepEqual(sortItems(items, 'big').map(i => i.id), ['b', 'c', 'a', 'd'])
  assert.deepEqual(sortItems(items, 'old').map(i => i.id), ['c', 'b', 'a', 'd'])
  assert.deepEqual(sortItems(items, 'subject').map(i => i.id), ['d', 'a', 'b', 'c'])
  assert.deepEqual(sortItems(items, 'whatever').map(i => i.id), ['d', 'a', 'b', 'c'])
  assert.equal(activeCount({ ...blankFilters(), who: 'mine', when: '7' }), 2)
})

const people = [
  { user_id: '1', display_name: 'Zed', student_no: 'S26-000001', program: 'BS Nursing', institute: 'College of Health' },
  { user_id: '2', display_name: 'amy', student_no: 'S26-000002', program: 'bs  nursing', institute: '' },
  { user_id: '3', display_name: 'Bo', student_no: 'S26-000003', program: 'BS Information Technology', institute: '' },
  { user_id: '4', display_name: 'Cy', student_no: 'S26-000004', program: '', institute: '' },
]
test('programs are grouped ignoring case and spacing, biggest first', () => {
  const p = programsOf(people)
  assert.equal(p.length, 2); assert.equal(p[0].key, 'bs nursing'); assert.equal(p[0].n, 2); assert.equal(p[1].n, 1)
})
test('people filters: text, program, follow modes', () => {
  const rel = { following: new Set(['1']), followers: new Set(['3']) }
  const n = o => filterPeople(people, o, rel).map(p => p.user_id)
  assert.deepEqual(n({ q: 'S26-000003' }), ['3']); assert.deepEqual(n({ q: 'health' }), ['1']); assert.deepEqual(n({ program: 'bs nursing' }), ['1', '2'])
  assert.deepEqual(n({ mode: 'following' }), ['1']); assert.deepEqual(n({ mode: 'new' }), ['2', '3', '4']); assert.deepEqual(n({ mode: 'followers' }), ['3'])
})
test('people sort: same program first, then A to Z (case-insensitive)', () => {
  assert.deepEqual(sortPeople(people, 'BS Information Technology').map(p => p.user_id), ['3', '2', '4', '1'])
  assert.deepEqual(sortPeople(people, '').map(p => p.user_id), ['2', '3', '4', '1'])
})
test('account setup rules: name, state university and program are required', () => {
  assert.match(setupError({ name: ' ', schoolOk: true, program: 'BS Nursing' }), /name/)
  assert.match(setupError({ name: 'A', schoolOk: false, program: 'BS Nursing' }), /university/)
  assert.match(setupError({ name: 'A', schoolOk: true, program: ' x ' }), /program/)
  assert.equal(setupError({ name: 'A', schoolOk: true, program: 'BS Nursing' }), '')
  assert.equal(normProgram('  BS   Nursing '), 'BS Nursing'); assert.equal(normBio('x'.repeat(500)).length, 200)
})

test('v48: sort by stars and visitors, ties fall back to newest', () => {
  const rows = [{ id: 'a', title: 'a', subject: 's', added: 1, stars: 2, visitors: 9 }, { id: 'b', title: 'b', subject: 's', added: 3, stars: 2, visitors: 1 }, { id: 'c', title: 'c', subject: 's', added: 2 }]
  assert.deepEqual(sortItems(rows, 'stars').map(i => i.id), ['b', 'a', 'c'])
  assert.deepEqual(sortItems(rows, 'visits').map(i => i.id), ['a', 'b', 'c'])
})
