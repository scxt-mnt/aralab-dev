import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SETTINGS, cleanSettings, cleanPrompt, visualMax, addPrompt, hasPrompt, settingsSummary,
  canRefresh, daysUntilRefresh, refreshedAt, refreshableAt, UPDATE_AFTER_MS, UPDATE_AFTER_DAYS, PROMPT_MAX,
} from '../../src/reviewSettings.js'

const DAY = 24 * 60 * 60 * 1000

test('cleanSettings: sane defaults and hard limits (one settings model for both create flows)', () => {
  assert.deepEqual(cleanSettings(), DEFAULT_SETTINGS)
  assert.equal(cleanSettings({ theme: 'neon' }).theme, 'indigo')
  assert.equal(cleanSettings({ visuals: 'everything' }).visuals, 'some')
  assert.deepEqual(cleanSettings({ aids: ['diagrams', 'nope', 'diagrams'] }).aids, ['diagrams'])
  assert.equal(cleanSettings({ subject: '  Biology   Honors  ' }).subject, 'Biology Honors')
  assert.equal(cleanSettings({ subject: 'x'.repeat(100) }).subject.length, 60)
  assert.equal(cleanSettings({ prompt: '  a\r\n\r\n\r\n\r\nb  ' }).prompt, 'a\n\nb')
  assert.equal(cleanPrompt('p'.repeat(PROMPT_MAX + 50)).length, PROMPT_MAX)
})

test('pictures: exactly 0, 4 or 8 images, never more', () => {
  assert.equal(visualMax('none'), 0)
  assert.equal(visualMax('some'), 4)
  assert.equal(visualMax('all'), 8)
  assert.equal(visualMax('bogus'), 4)
})

test('addPrompt: one-tap sentences append once, keep the student wording, and respect the limit', () => {
  const once = addPrompt('Focus on chapter 3.', 'Add diagrams or graphs for the main processes and numbers.')
  assert.match(once, /chapter 3/)
  assert.match(once, /diagrams/)
  assert.equal(addPrompt(once, 'Add diagrams or graphs for the main processes and numbers.'), once)   // never doubled
  assert.equal(hasPrompt(once, 'Add diagrams or graphs for the main processes and numbers.'), true)
  assert.equal(addPrompt('keep me', 'x'.repeat(PROMPT_MAX)), 'keep me')                              // too long: ignored
})

test('settingsSummary: a short line for a collapsed panel', () => {
  const s = cleanSettings({ subject: 'Biology', prompt: 'Be simple', aids: ['diagrams'], theme: 'forest', visuals: 'some' })
  assert.match(settingsSummary(s), /^Biology · Diagrams & graphs · your instructions · a few pictures · Forest$/)
  assert.equal(settingsSummary({}), 'a few pictures · Indigo')
})

test('update: only the author or an admin, only after 5 days', () => {
  const old = { id: 'r1', owner_id: 'stu', added: Date.now() - 6 * DAY }
  assert.equal(canRefresh(old, 'stu', false), true)
  assert.equal(canRefresh(old, 'other', false), false)
  assert.equal(canRefresh(old, 'other', true), true)          // an admin may update anyone's reviewer
  assert.equal(canRefresh(old, 'stu', false, old.added + UPDATE_AFTER_MS - 1000), false)
  assert.equal(canRefresh({ ...old, owner_id: null }, 'stu', true), true)
})

test('update: a refreshed reviewer waits another 5 days, and removed reviewers are locked', () => {
  const added = Date.now() - 30 * DAY
  const item = { id: 'r1', owner_id: 'stu', added, refreshedAt: new Date(Date.now() - 2 * DAY).toISOString() }
  assert.equal(refreshedAt(item), Date.parse(item.refreshedAt))
  assert.equal(canRefresh(item, 'stu', false), false)
  assert.equal(daysUntilRefresh(item, Date.now()), 3)
  assert.equal(canRefresh({ ...item, removed_at: new Date().toISOString() }, 'stu', true), false)
  assert.equal(UPDATE_AFTER_DAYS, 5)
  assert.equal(refreshableAt({ added }), added + UPDATE_AFTER_MS)
})

test('update: an ISO `added` (demo rows) is understood too; a missing date is treated as old (like the server)', () => {
  const iso = new Date(Date.now() - 6 * DAY).toISOString()
  assert.equal(canRefresh({ owner_id: 'stu', added: iso }, 'stu', false), true)
  assert.equal(canRefresh({ owner_id: 'stu', added: new Date().toISOString() }, 'stu', false), false)
  assert.equal(canRefresh({ owner_id: 'stu' }, 'stu', false), true)           // rows always carry `added`; the server allows it too
  assert.equal(refreshableAt({}), UPDATE_AFTER_MS)
})

import { refreshWait } from '../../src/reviewSettings.js'
test('refreshWait: tells the author how many days are left, and nothing to people who can never refresh', () => {
  const day = 24 * 60 * 60 * 1000, now = Date.now()
  const item = { owner_id: 'u1', added: now - 2 * day }
  assert.equal(refreshWait(item, 'u1', false, now), 3)
  assert.equal(refreshWait(item, 'u2', false, now), 0)          // not the author
  assert.equal(refreshWait(item, 'u2', true, now), 3)           // admin
  assert.equal(refreshWait({ ...item, added: now - 9 * day }, 'u1', false, now), 0)   // already available
  assert.equal(refreshWait({ ...item, removed_at: 'x' }, 'u1', false, now), 0)
})

test('canRefresh / refreshWait: the Astra member of the author’s school gets the same rights as the author', () => {
  const day = 24 * 60 * 60 * 1000, now = Date.now()
  const old = { owner_id: 'u1', added: now - 9 * day }, young = { owner_id: 'u1', added: now - 2 * day }
  assert.equal(canRefresh(old, 'astra', false, now, true), true)
  assert.equal(canRefresh(old, 'astra', false, now, false), false)
  assert.equal(canRefresh(young, 'astra', false, now, true), false)             // the 5-day rule still applies
  assert.equal(refreshWait(young, 'astra', false, now, true), 3)
  assert.equal(refreshWait(young, 'astra', false, now, false), 0)
})
