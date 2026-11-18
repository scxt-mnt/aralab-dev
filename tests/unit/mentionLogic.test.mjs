import test from 'node:test'
import assert from 'node:assert/strict'
import { cleanMentions, commentTree, insertMention, liveMentions, mentionParts, mentionToken } from '../../src/mentionLogic.js'

test('mentionToken: finds the @word being typed', () => {
  assert.deepEqual(mentionToken('hello @sc'), { start: 6, query: 'sc' })
  assert.deepEqual(mentionToken('@sc'), { start: 0, query: 'sc' })
  assert.deepEqual(mentionToken('hi (@'), { start: 4, query: '' })          // empty query = show everyone
  assert.deepEqual(mentionToken('hi @scott.'), { start: 3, query: 'scott.' })
  assert.equal(mentionToken('hi @scott smith'), null)                       // a space ends the mention
  assert.equal(mentionToken('email me at a@b'), null)                       // not the start of a word
  assert.equal(mentionToken(''), null)
})

test('insertMention: swaps the token for the picked name and keeps the rest', () => {
  assert.equal(insertMention('hello @sc', { start: 6, query: 'sc' }, 'Scott Lee'), 'hello @Scott Lee ')
  assert.equal(insertMention('hi @sc there', { start: 3, query: 'sc' }, 'Scott'), 'hi @Scott there')
  assert.equal(insertMention('@', { start: 0, query: '' }, 'Ana'), '@Ana ')
})

test('cleanMentions: keeps only valid, unique { id, name } pairs and caps at 20', () => {
  assert.deepEqual(cleanMentions([{ id: 'a', name: ' Ana ' }, { id: 'a', name: 'Ana again' }, { id: '', name: 'x' }, { id: 'b' }]), [{ id: 'a', name: 'Ana' }])
  assert.deepEqual(cleanMentions([{ id: 'a', name: 'A' }]), [{ id: 'a', name: 'A' }])
  assert.deepEqual(cleanMentions(null), [])
  assert.equal(cleanMentions(Array.from({ length: 30 }, (_, i) => ({ id: 'id' + i, name: 'N' + i }))).length, 20)
})

test('liveMentions: drops a mention once its @name is removed from the text', () => {
  const picks = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Ben' }]
  assert.deepEqual(liveMentions('hi @Ana and @Ben', picks), picks)
  assert.deepEqual(liveMentions('hi @Ben', picks), [{ id: 'b', name: 'Ben' }])
  assert.deepEqual(liveMentions('nothing here', picks), [])
})

test('commentTree: nests replies under their root and flattens deep chains', () => {
  const rows = [
    { id: '1', parent_id: null, created_at: '2026-01-01T00:00:00Z' },
    { id: '2', parent_id: '1', created_at: '2026-01-01T00:01:00Z' },
    { id: '3', parent_id: '2', created_at: '2026-01-01T00:02:00Z' },   // reply to a reply
    { id: '4', parent_id: null, created_at: '2026-01-01T00:03:00Z' },
    { id: '5', parent_id: 'missing', created_at: '2026-01-01T00:04:00Z' }, // orphan: becomes its own thread
  ]
  const tree = commentTree(rows)
  assert.deepEqual(tree.map(c => c.id), ['1', '4', '5'])
  assert.deepEqual(tree[0].replies.map(c => c.id), ['2', '3'])
  assert.deepEqual(tree[1].replies, [])
  assert.equal(tree[2].id, '5')
})

test('mentionParts: highlights only known mentions, longest name first, and escapes regex characters', () => {
  assert.deepEqual(mentionParts('hi @Ana!', [{ name: 'Ana' }]), [{ text: 'hi ' }, { mention: 'Ana' }, { text: '!' }])
  assert.deepEqual(mentionParts('@A.B and @A', [{ name: 'A' }, { name: 'A.B' }]), [{ mention: 'A.B' }, { text: ' and ' }, { mention: 'A' }])
  assert.deepEqual(mentionParts('plain text', [{ name: 'Ana' }]), [{ text: 'plain text' }])
  assert.deepEqual(mentionParts('@C++', [{ name: 'C++' }]), [{ mention: 'C++' }])
})
