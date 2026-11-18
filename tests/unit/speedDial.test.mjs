import test from 'node:test'
import assert from 'node:assert/strict'
import { dialItems, DIAL_ITEMS, HOWTO } from '../../src/speedDialLogic.js'

const ids = tab => dialItems(tab).map(i => i.id)

test('every item either opens a screen or a guide step, never both or neither', () => {
  for (const i of [...DIAL_ITEMS, HOWTO]) assert.ok((i.tab !== undefined) !== (i.guide !== undefined), i.id)
  assert.equal(new Set([...DIAL_ITEMS, HOWTO].map(i => i.id)).size, DIAL_ITEMS.length + 1, 'ids are unique')
})

test('create comes first on a normal screen and the tour is always last', () => {
  assert.equal(ids('feed')[0], 'create')
  assert.equal(ids('feed').at(-1), 'tour')
})

test('the screen you are on is left out', () => {
  assert.ok(!ids('feed').includes('feed'))
  assert.ok(!ids('library').includes('library'))
  assert.ok(!ids('classroom').includes('classroom'))
})

test('Ranking and My university count as University Astra', () => {
  assert.ok(!ids('rank').includes('astra'))
  assert.ok(!ids('campus').includes('astra'))
  assert.ok(ids('feed').includes('astra'))
})

test('on the Create screen the first item is the step-by-step guide, opening step 3', () => {
  const list = dialItems('requests')
  assert.equal(list[0].id, 'howto')
  assert.equal(list[0].guide, 2)
  assert.ok(!list.some(i => i.id === 'create'))
})

test('search, Moderation and an empty tab show every shortcut', () => {
  for (const t of ['', 'search', 'mod', undefined]) assert.deepEqual(ids(t), DIAL_ITEMS.map(i => i.id))
})
