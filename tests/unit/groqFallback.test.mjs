import test from 'node:test'
import assert from 'node:assert/strict'
import { partsToChat, groqJson, MAX_CHARS } from '../../server/groq.js'
import { generateJson } from '../../server/ai.js'

const ok = content => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }], usage: { total_tokens: 42 } }) })
const bad = status => ({ ok: false, status, json: async () => ({ error: { message: 'x' } }) })
const b64 = s => Buffer.from(s).toString('base64')

test('parts: text stays, PDF text is extracted, images go to vision, Google-uploaded files are skipped', async () => {
  const r = await partsToChat([{ text: 'Hello' }, { inline_data: { mime_type: 'application/pdf', data: 'x' } }, { inline_data: { mime_type: 'image/png', data: 'AAAA' } }, { file_data: { mime_type: 'application/pdf', file_uri: 'u' } }], { pdf: async () => 'Cells divide' })
  assert.match(r.text, /Hello/); assert.match(r.text, /Cells divide/); assert.equal(r.images.length, 1); assert.equal(r.skipped.length, 1)
})
test('parts: long notes are cut and a PDF with no text is reported', async () => {
  const r = await partsToChat([{ text: 'a'.repeat(MAX_CHARS + 500) }, { inline_data: { mime_type: 'application/pdf', data: 'x' } }], { pdf: async () => '' })
  assert.ok(r.text.length < MAX_CHARS + 100); assert.match(r.skipped[0], /no readable text/)
})
test('groq: answers, and moves to the next model when one is rate limited', async () => {
  const seen = []
  const f = async (_u, o) => { const m = JSON.parse(o.body).model; seen.push(m); return seen.length === 1 ? bad(429) : ok('{"title":"T"}') }
  const r = await groqJson({ key: 'k', system: 's', parts: [{ text: 'notes' }], fetchImpl: f })
  assert.equal(r.text, '{"title":"T"}'); assert.equal(seen.length, 2); assert.match(r.model, /^groq:/)
})
test('groq: a rejected key stops at once, and unreadable notes say why', async () => {
  await assert.rejects(groqJson({ key: 'k', system: 's', parts: [{ text: 'n' }], fetchImpl: async () => bad(401) }), /key was rejected/)
  await assert.rejects(groqJson({ key: 'k', system: 's', parts: [{ file_data: {} }], fetchImpl: async () => ok('{}') }), /cannot read/)
})
test('groq: images use the vision model', async () => {
  let body; await groqJson({ key: 'k', system: 's', parts: [{ inline_data: { mime_type: 'image/png', data: b64('i') } }], fetchImpl: async (_u, o) => { body = JSON.parse(o.body); return ok('{}') } })
  assert.match(body.model, /llama-4-scout/); assert.equal(body.messages[1].content[1].type, 'image_url')
})

test('ai: no Groq key = Gemini only (unchanged behaviour)', async () => {
  const r = await generateJson({ key: 'g', groqKey: '', gemini: async () => ({ text: 'G', model: 'gem' }), groq: async () => { throw new Error('no') } })
  assert.equal(r.text, 'G')
})
test('ai: Gemini fails -> Groq answers, and Gemini gets less of the time budget', async () => {
  let gBudget; const events = []
  const r = await generateJson({ key: 'g', groqKey: 'k', budgetMs: 55000, onProgress: e => events.push(e), gemini: async o => { gBudget = o.budgetMs; throw Object.assign(new Error('quota'), { status: 429 }) }, groq: async () => ({ text: 'Q', model: 'groq:x' }) })
  assert.equal(r.model, 'groq:x'); assert.ok(gBudget <= 37000); assert.equal(events[0].next, 'groq')
})
test('ai: unusable notes (422) are not retried on Groq; both failing explains both', async () => {
  let called = false
  await assert.rejects(generateJson({ key: 'g', groqKey: 'k', gemini: async () => { throw Object.assign(new Error('thin'), { status: 422 }) }, groq: async () => { called = true } }), /thin/)
  assert.equal(called, false)
  await assert.rejects(generateJson({ key: 'g', groqKey: 'k', gemini: async () => { throw Object.assign(new Error('Gemini down.'), { status: 503 }) }, groq: async () => { throw new Error('Groq down.') } }), /Gemini down\. Backup AI: Groq down\./)
})
test('ai: no Gemini key but a Groq key = Groq only', async () => {
  const r = await generateJson({ key: undefined, groqKey: 'k', gemini: async () => { throw new Error('no') }, groq: async () => ({ text: 'Q', model: 'groq:x' }) })
  assert.equal(r.text, 'Q')
})

import { splitText, mergeReviewers } from '../../server/groq.js'
test('slicing: long notes split at paragraph breaks into parts that fit', () => {
  const t = Array.from({ length: 12 }, (_, i) => `Para ${i} ` + 'x'.repeat(4000)).join('\n\n')
  const p = splitText(t, 28000); assert.ok(p.length >= 2); assert.ok(p.every(x => x.length <= 28000)); assert.ok(p.join('\n\n').includes('Para 11'))
  assert.equal(splitText('short', 28000).length, 1)
})
test('merge: parts become one reviewer, later parts are not crowded out, duplicates dropped', () => {
  const part = (n, heads) => ({ title: 'T', summary: `S${n}`, sections: heads.map(h => ({ heading: h, points: ['p', 'p'] })), terms: [{ term: 'Cell', definition: 'd' }, { term: 'T' + n, definition: 'd' }], flashcards: [{ q: 'q' + n, a: 'a' }], quiz: [{ q: 'z' + n, choices: ['a', 'b', 'c', 'd'], answer: 0, why: 'w' }] })
  const m = mergeReviewers([part(1, Array.from({ length: 10 }, (_, i) => 'A' + i)), part(2, Array.from({ length: 10 }, (_, i) => 'B' + i))])
  assert.equal(m.sections.length, 12); assert.ok(m.sections.some(s => s.heading === 'B0')); assert.equal(m.terms.filter(t => t.term === 'Cell').length, 1)
  assert.deepEqual(m.sections[0].points, ['p'])
})
test('groq slicing: parts are asked one after another and merged; parts past the time budget are left out', async () => {
  const notes = Array.from({ length: 3 }, (_, i) => `Part ${i} ` + 'y'.repeat(27000)).join('\n\n')
  const calls = []
  const f = async (_u, o) => { calls.push(JSON.parse(o.body).messages[0].content.match(/part (\d) of/)?.[1]); return ok(JSON.stringify({ title: 'T', sections: [{ heading: 'H' + calls.length, points: ['a'] }], terms: [], flashcards: [], quiz: [] })) }
  const r = await groqJson({ key: 'k', system: 's', parts: [{ text: notes }], fetchImpl: f, slice: true, budgetMs: 60000 })
  assert.deepEqual(calls, ['1', '2', '3']); assert.equal(JSON.parse(r.text).sections.length, 3); assert.equal(r.parts, '3 of 3')
  const r2 = await groqJson({ key: 'k', system: 's', parts: [{ text: notes }], fetchImpl: f, slice: true, budgetMs: 11000 })
  assert.equal(r2.parts, '1 of 3')
})
