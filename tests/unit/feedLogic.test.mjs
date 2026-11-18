import test from 'node:test'
import assert from 'node:assert/strict'
import { authorFor, STAT_LAYOUTS, applyReaction, topReactions, canEditPost, canDeletePost, canEditComment, canDeleteComment, parsePostHash, mergeFirstPage, REACTIONS } from '../../src/feedLogic.js'

const R = (counts = {}, mine = null) => ({ counts, mine, total: Object.values(counts).reduce((a, b) => a + b, 0) })

test('react: first reaction adds', () => assert.deepEqual(applyReaction(R(), 'like'), R({ like: 1 }, 'like')))
test('react: same emoji again removes it', () => assert.deepEqual(applyReaction(R({ like: 1 }, 'like'), 'like'), R({}, null)))
test('react: different emoji switches, totals stay right', () => assert.deepEqual(applyReaction(R({ like: 2, fire: 1 }, 'like'), 'fire'), R({ like: 1, fire: 2 }, 'fire')))
test('react: never goes negative / does not mutate input', () => {
  const before = R({ like: 1 }, 'like'); const snap = JSON.stringify(before)
  applyReaction(before, 'love'); assert.equal(JSON.stringify(before), snap)
  assert.deepEqual(applyReaction(R({}, 'like'), 'like').counts, {})
})
test('topReactions sorts and ignores unknown keys', () => assert.deepEqual(topReactions(R({ like: 1, fire: 3, bogus: 9 })), [['fire', 3], ['like', 1]]))
test('permissions: only the author edits; author/admin delete a post', () => {
  const p = { user_id: 'a' }
  assert.ok(canEditPost(p, 'a')); assert.ok(!canEditPost(p, 'b')); assert.ok(!canEditPost(p, null))
  assert.ok(canDeletePost(p, 'a', false)); assert.ok(canDeletePost(p, 'b', true)); assert.ok(!canDeletePost(p, 'b', false))
})
test('permissions: comments are deletable by author, post owner or admin, editable only by author', () => {
  const post = { user_id: 'owner' }, c = { user_id: 'writer' }
  assert.ok(canEditComment(c, 'writer')); assert.ok(!canEditComment(c, 'owner'))
  assert.ok(canDeleteComment(c, post, 'writer', false)); assert.ok(canDeleteComment(c, post, 'owner', false)); assert.ok(canDeleteComment(c, post, 'x', true)); assert.ok(!canDeleteComment(c, post, 'x', false))
})
test('parsePostHash accepts only a real uuid', () => {
  assert.equal(parsePostHash('#post=123e4567-e89b-12d3-a456-426614174000'), '123e4567-e89b-12d3-a456-426614174000')
  for (const h of ['#post=1', '#post=../../x', '#/post=123e4567-e89b-12d3-a456-426614174000', '', '#post=123e4567-e89b-12d3-a456-426614174000&x=1']) assert.equal(parsePostHash(h), null)
})
test('mergeFirstPage: keeps scrolled-to older posts, drops deleted newer ones', () => {
  const p = (id, t) => ({ id, created_at: t })
  const prev = [p('e', '5'), p('d', '4'), p('c', '3'), p('b', '2'), p('a', '1')]
  const fresh = [p('f', '6'), p('e', '5'), p('c', '3')]          // page size 3: d was deleted, f is new
  assert.deepEqual(mergeFirstPage(prev, fresh, 3).map(x => x.id), ['f', 'e', 'c', 'b', 'a'])
  assert.deepEqual(mergeFirstPage(prev, [p('e', '5')], 3).map(x => x.id), ['e'])   // short page = that's everything
  assert.deepEqual(mergeFirstPage(null, fresh, 3), fresh)
})

test('anonymous rows never expose a name, and the writer / admin get a private hint', () => {
  const people = { u1: { user_id: 'u1', display_name: 'Ana', avatar_url: 'x', school: 'UP' } }
  const anon = { user_id: null, is_anonymous: true, is_mine: false }
  assert.equal(authorFor(people, anon).display_name, 'Anonymous student'); assert.equal(authorFor(people, anon).avatar_url, null); assert.equal(authorFor(people, anon).hint, '')
  assert.equal(authorFor(people, { ...anon, user_id: 'u1', is_mine: true }).hint, 'You')
  assert.match(authorFor(people, { ...anon, user_id: 'u1' }).hint, /Ana/)          // admin view
  assert.equal(authorFor(people, { user_id: 'u1', is_anonymous: false }).display_name, 'Ana')
  assert.equal(authorFor(people, { user_id: 'gone', is_anonymous: false }).display_name, 'Former student')
})
test('is_mine lets a writer manage an anonymous post even though user_id is hidden', () => {
  const p = { user_id: null, is_mine: true }
  assert.ok(canEditPost(p, 'me')); assert.ok(canDeletePost(p, 'me', false)); assert.ok(!canEditPost({ user_id: null, is_mine: false }, 'me'))
  assert.ok(canDeleteComment({ user_id: null, is_mine: false }, p, 'me', false))   // post owner moderates comments
})
test('stat layouts are the four the database allows', () => assert.deepEqual(Object.keys(STAT_LAYOUTS), ['compact', 'rings', 'weekly', 'subjects']))

test('authorFor: an announcement shows as the official account and never exposes the admin', () => {
  const people = { adm: { user_id: 'adm', display_name: 'Ms Admin', avatar_url: 'x', school: 'S' } }
  const seen = authorFor(people, { id: 1, user_id: null, is_announcement: true, is_anonymous: true })
  assert.equal(seen.official, true); assert.equal(seen.display_name, 'AraLab'); assert.equal(seen.user_id, null); assert.equal(seen.avatar_url, null); assert.equal(seen.hint, ''); assert.ok(!('school' in seen))
  assert.equal(seen.anonymous, undefined)   // it is NOT shown as "Anonymous student"
  assert.equal(authorFor(people, { user_id: 'adm', is_announcement: true, is_mine: true }).hint, 'You')
  assert.equal(authorFor(people, { user_id: 'adm', is_announcement: true }).hint, 'Admin view: Ms Admin')   // other admins can see who, for moderation
  assert.equal(authorFor(people, { user_id: null, is_anonymous: true }).display_name, 'Anonymous student')   // normal anonymous posts are unchanged
})
