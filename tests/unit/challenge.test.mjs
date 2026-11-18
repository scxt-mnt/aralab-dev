import test from 'node:test'
import assert from 'node:assert/strict'
import { questionPool, buildQuestions, canChallenge, computeScore, profilePoints, answerSheetHtml, fmtClock, shuffle, MIN_Q, MAX_Q, SECONDS_PER_Q } from '../../src/challengeLogic.js'
import { SAMPLE_CONTENT, normalizeContent } from '../../src/render.js'

const seeded = (seed = 7) => () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646 }

test('score: accuracy x (80 + 20 x speed), 0-100', () => {
  assert.equal(computeScore({ correct: 10, total: 10, seconds: 30 }), 100)            // 3 s average = full speed bonus
  assert.equal(computeScore({ correct: 10, total: 10, seconds: 10 * SECONDS_PER_Q }), 80)   // right answers but always at the limit
  assert.equal(computeScore({ correct: 0, total: 10, seconds: 30 }), 0)
  assert.equal(computeScore({ correct: 5, total: 10, seconds: 30 }), 50)
  assert.ok(computeScore({ correct: 8, total: 10, seconds: 60 }) > computeScore({ correct: 8, total: 10, seconds: 150 }), 'faster scores higher')
  assert.ok(computeScore({ correct: 9, total: 10, seconds: 30 }) > computeScore({ correct: 8, total: 10, seconds: 30 }), 'more correct scores higher')
})
test('score: impossible speeds and junk cannot beat the maximum', () => {
  assert.equal(computeScore({ correct: 10, total: 10, seconds: 0 }), 100)
  assert.equal(computeScore({ correct: 99, total: 10, seconds: 0 }), 100)
  assert.equal(computeScore({ correct: -5, total: 10, seconds: 999999 }), 0)
  assert.equal(computeScore({ correct: 1, total: 0, seconds: 1 }) <= 100, true)
})
test('points: only improvement pays, 1 per 5, capped per reviewer and per day', () => {
  assert.equal(profilePoints({ score: 60, best: 0 }), 12)
  assert.equal(profilePoints({ score: 60, best: 60 }), 0)
  assert.equal(profilePoints({ score: 50, best: 60 }), 0)
  assert.equal(profilePoints({ score: 84, best: 60, awarded: 12 }), 4)
  assert.equal(profilePoints({ score: 100, best: 0 }), 20)
  assert.equal(profilePoints({ score: 100, best: 0, awarded: 18 }), 2)
  assert.equal(profilePoints({ score: 100, best: 0, today: 58 }), 2)
  assert.equal(profilePoints({ score: 100, best: 0, today: 60 }), 0)
  assert.equal(profilePoints({ score: 62, best: 60 }), 0)   // under 5 points of improvement is not worth a point
})
test('lifetime: replaying the same run forever never exceeds the per-reviewer cap', () => {
  let best = 0, awarded = 0
  for (const s of [40, 55, 55, 70, 70, 90, 100, 100, 100]) { const p = profilePoints({ score: s, best, awarded }); awarded += p; best = Math.max(best, s) }
  assert.equal(best, 100); assert.equal(awarded, 20)
})
test('pool: quiz questions, flashcards and terms all become multiple choice with the right answer inside', () => {
  const pool = questionPool(SAMPLE_CONTENT)
  assert.ok(pool.length >= SAMPLE_CONTENT.quiz.length + 4)
  for (const p of pool) { assert.ok(p.choices.length >= 3 && p.choices.includes(p.answerText), p.q); assert.equal(new Set(p.choices.map(x => x.toLowerCase())).size, p.choices.length, 'no duplicate choices: ' + p.q) }
  assert.ok(pool.some(p => /^Which term matches this\?/.test(p.q)))
})
test('buildQuestions: the answer index always points at the right text, runs differ, capped at MAX_Q', () => {
  const big = normalizeContent({ title: 't', flashcards: Array.from({ length: 20 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` })), terms: Array.from({ length: 25 }, (_, i) => ({ term: `T${i}`, definition: `D${i}` })) })
  const a = buildQuestions(big, { rnd: seeded(1) }), b = buildQuestions(big, { rnd: seeded(2) })
  assert.equal(a.length, MAX_Q)
  for (const q of a) { assert.ok(q.answer >= 0 && q.answer < q.choices.length); const m = /^Q(\d+)$/.exec(q.q); if (m) assert.equal(q.choices[q.answer], `A${m[1]}`) }
  assert.notDeepEqual(a.map(q => q.q), b.map(q => q.q))
})
test('canChallenge needs at least MIN_Q usable questions', () => {
  assert.equal(canChallenge(null), false); assert.equal(canChallenge({}), false)
  assert.equal(canChallenge(normalizeContent({ title: 't', flashcards: [{ q: 'a', a: 'b' }, { q: 'c', a: 'd' }] })), false)
  assert.equal(canChallenge(SAMPLE_CONTENT), true); assert.ok(MIN_Q >= 3)
})
test('duplicates and blanks never produce a question', () => {
  const c = { quiz: [{ q: 'Same?', choices: ['a', 'b', 'c'], answer: 0 }, { q: 'same?', choices: ['a', 'b', 'c'], answer: 1 }, { q: '', choices: ['a', 'b'], answer: 0 }], flashcards: [{ q: 'x', a: 'one' }, { q: 'y', a: 'one' }, { q: 'z', a: 'one' }] }
  const pool = questionPool(c)
  assert.equal(pool.filter(p => p.q.toLowerCase() === 'same?').length, 1); assert.ok(!pool.some(p => !p.q))
  assert.ok(!pool.some(p => ['x', 'y', 'z'].includes(p.q)), 'flashcards with identical answers cannot make 3 distinct choices')
})
test('shuffle keeps every item', () => { assert.deepEqual([...shuffle([1, 2, 3, 4, 5], seeded(3))].sort(), [1, 2, 3, 4, 5]) })
test('answer sheet escapes everything and reports right/wrong', () => {
  const h = answerSheetHtml({ title: '<img src=x onerror=1>', score: 80, correct: 1, total: 2, seconds: 75, rows: [{ q: '<b>q1</b>', picked: 'a', right: 'a', ok: true, why: '' }, { q: 'q2', picked: '', right: '<i>r</i>', ok: false, why: '<script>x</script>' }] })
  assert.ok(!h.includes('<img src=x') && !h.includes('<b>q1') && !h.includes('<i>r') && !h.includes('<script>x'))
  assert.match(h, /No answer \(time ran out\)/); assert.match(h, /1:15/); assert.match(h, /class="ok"/); assert.match(h, /class="no"/)
})
test('clock format', () => { assert.equal(fmtClock(0), '0:00'); assert.equal(fmtClock(65), '1:05'); assert.equal(fmtClock(-4), '0:00') })

import { DIFFICULTIES, LEVELS, levelOf, shareText, cleanScore, cleanLevel } from '../../src/challengeLogic.js'
test('difficulty: caps the number of questions, easy trims to 3 choices, every time limit stays within the SQL ceiling', () => {
  const big = normalizeContent({ title: 't', flashcards: Array.from({ length: 30 }, (_, i) => ({ q: `Q${i}`, a: `A${i}` })) })
  for (const k of LEVELS) {
    const qs = buildQuestions(big, { level: k, rnd: seeded(3) })
    assert.equal(qs.length, DIFFICULTIES[k].max)
    assert.ok(DIFFICULTIES[k].secs <= SECONDS_PER_Q)
    for (const q of qs) assert.equal(q.choices[q.answer], `A${/^Q(\d+)$/.exec(q.q)[1]}`)
  }
  assert.ok(buildQuestions(big, { level: 'easy' }).every(q => q.choices.length === 3))
  assert.ok(buildQuestions(big, { level: 'hard' }).every(q => q.choices.length === 4))
  assert.equal(levelOf('nope').key, 'medium')
})
test('share text and score-link helpers', () => {
  assert.match(shareText('Bio', 87, 'hard'), /87 pt \(Hard\) on “Bio”/)
  assert.equal(cleanScore('999'), 100); assert.equal(cleanScore('x'), null); assert.equal(cleanLevel('hard'), 'hard'); assert.equal(cleanLevel('zzz'), '')
})
