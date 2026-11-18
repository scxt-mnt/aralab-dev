import test from 'node:test'
import assert from 'node:assert/strict'
import { distance, isTypo, uniqueOptions, suggest, canonical, tidy } from '../../src/fuzzy.js'

test('distance counts a swapped pair as one edit', () => { assert.equal(distance('physics', 'phyiscs'), 1); assert.equal(distance('biology', 'biolgy'), 1) })
test('one wrong letter is a typo; short words and different numbers are not', () => {
  assert.ok(isTypo('Biolgy', 'Biology')); assert.ok(isTypo('Chemestry', 'Chemistry')); assert.ok(isTypo('Phyiscs', 'Physics'))
  assert.ok(!isTypo('Math', 'Mats')); assert.ok(!isTypo('Math 1', 'Math 2')); assert.ok(!isTypo('Biology', 'Biology')); assert.ok(!isTypo('History', 'Geography'))
})
test('exact match ignores case, spaces and punctuation and returns the existing spelling', () => {
  const o = ['Biology', 'Chemistry']
  assert.equal(canonical('  biology ', o), 'Biology'); assert.equal(canonical('CHEMISTRY', o), 'Chemistry'); assert.equal(canonical('  Earth   Science ', o), 'Earth Science')
})
test('a near match is suggested but never silently applied', () => {
  const o = ['Biology', 'Chemistry'], r = suggest('Biolgy', o)
  assert.equal(r.near, 'Biology'); assert.equal(r.exact, null); assert.equal(canonical('Biolgy', o), 'Biolgy')
})
test('suggestions rank prefix first and handle empty input', () => {
  const o = ['Organic Chemistry', 'Chemistry', 'Biology']
  assert.deepEqual(suggest('chem', o).matches.slice(0, 2), ['Chemistry', 'Organic Chemistry']); assert.equal(suggest('', o).matches.length, 3)
})
test('uniqueOptions merges spellings and keeps the most used one first', () => {
  assert.deepEqual(uniqueOptions([['biology', 1], ['Biology', 5], ['Chemistry', 2], [' ', 3]]), ['Biology', 'Chemistry'])
  assert.equal(tidy('  a   b '), 'a b')
})

import { withCsp, META } from '../../src/lib.js'
test('reviewer pages get a CSP that blocks network and forms; login no longer loads the heavy text column', () => {
  const h = withCsp('<p>hi</p>')
  assert.ok(h.startsWith('<meta http-equiv="Content-Security-Policy"')); assert.ok(h.includes("default-src 'none'")); assert.ok(h.includes("form-action 'none'")); assert.ok(h.endsWith('<p>hi</p>'))
  assert.ok(!META.split(',').includes('text'))
})
test('suggest stays fast and correct with a huge option list', () => {
  const o = Array.from({ length: 5000 }, (_, i) => `Subject ${i}`), t = Date.now()
  assert.ok(suggest('subj', o).matches.length > 0); assert.ok(Date.now() - t < 500)
})

import { runGenerate } from '../../server/generateFlow.js'
test('a database error is reported as such, not as "Request not found"', async () => {
  const db = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'Invalid API key' } }) }) }) }) }
  const r = await runGenerate({ db, authHeader: 'Bearer x', body: { requestId: 'abc' } })
  assert.equal(r.status, 500); assert.match(r.body.error, /Invalid API key/); assert.match(r.body.error, /SERVICE_ROLE_KEY/)
})
