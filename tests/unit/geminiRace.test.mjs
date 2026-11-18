import test from 'node:test'
import assert from 'node:assert/strict'
import { generateJson, _resetForTests, cooldownFor } from '../../server/gemini.js'

const sse = text => new Response(new ReadableStream({ start(c) {
  c.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 7 } })}\n\n`)); c.close() } }),
  { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

// behaviours: 'ok' | '503' | 'hang' | '400'
function fakeFetch(models, behave, log = []) {
  return async (url, opts = {}) => {
    if (/\/models\?pageSize/.test(url)) return json(200, { models: models.map(m => ({ name: 'models/' + m, supportedGenerationMethods: ['generateContent'] })) })
    const id = /models\/([^:]+):stream/.exec(url)[1]
    log.push({ id, signal: opts.signal })
    const b = behave[id]
    if (b === 'ok') return sse('{"title":"x"}')
    if (b === '503') return json(503, { error: { message: 'overloaded' } })
    if (b === '400') return json(400, { error: { message: 'bad request body' } })
    return new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))   // hang
  }
}
const run = (f, extra = {}) => generateJson({ key: 'k', system: 's', parts: [{ text: 'hi' }], fetchImpl: f, hedgeMs: 40, firstTokenMs: 5000, budgetMs: 20000, sleep: () => Promise.resolve(), ...extra })

test('overloaded + silent models: the next model is raced, the silent one is cancelled', async () => {
  _resetForTests()
  const log = [], M = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']
  const t0 = Date.now()
  const out = await run(fakeFetch(M, { 'gemini-3.8-flash': '503', 'gemini-3.7-flash': 'hang', 'gemini-3.6-flash': 'ok' }, log))
  assert.equal(out.model, 'gemini-3.6-flash'); assert.ok(Date.now() - t0 < 2000, 'must not wait for the 5 s first-word limit')
  assert.equal(log.find(x => x.id === 'gemini-3.7-flash').signal.aborted, true)
})

test('the model that worked last time goes first next time', async () => {
  const log = [], M = ['gemini-3.8-flash', 'gemini-3.7-flash', 'gemini-3.6-flash']
  await run(fakeFetch(M, { 'gemini-3.8-flash': 'ok', 'gemini-3.7-flash': 'ok', 'gemini-3.6-flash': 'ok' }, log))
  assert.equal(log[0].id, 'gemini-3.6-flash')
})

test('everything failing gives the friendly 503 listing what happened', async () => {
  _resetForTests()
  await assert.rejects(run(fakeFetch(['gemini-3.8-flash', 'gemini-3.7-flash'], { 'gemini-3.8-flash': '503', 'gemini-3.7-flash': '503' }), { budgetMs: 12000 }),
    e => e.status === 503 && /overloaded/.test(e.message) && /Try again/.test(e.message))
})

test('a model that rejects the request is skipped (v56): the next model answers', async () => {
  _resetForTests()
  const out = await run(fakeFetch(['gemini-3.8-flash', 'gemini-3.7-flash'], { 'gemini-3.8-flash': '400', 'gemini-3.7-flash': 'ok' }))
  assert.equal(out.model, 'gemini-3.7-flash')
})

test('if EVERY model rejects the request, the real reason is shown (502)', async () => {
  _resetForTests()
  await assert.rejects(run(fakeFetch(['gemini-3.8-flash', 'gemini-3.7-flash'], { 'gemini-3.8-flash': '400', 'gemini-3.7-flash': '400' })), e => e.status === 502 && /rejected/.test(e.message))
})

// ---- v56: a broken answer switches to the next model instead of failing ----
const sseOf = text => () => sse(text)
function scripted(models, answers, log = []) {
  return async (url, opts = {}) => {
    if (/\/models\?pageSize/.test(url)) return json(200, { models: models.map(m => ({ name: 'models/' + m, supportedGenerationMethods: ['generateContent'] })) })
    const id = /models\/([^:]+):stream/.exec(url)[1]; log.push(id)
    const a = answers[id]
    return typeof a === 'function' ? a() : json(500, { error: { message: 'x' } })
  }
}
const needJson = t => { let j; try { j = JSON.parse(t) } catch { j = {} } if (!j.sections) throw Object.assign(new Error('The AI did not return valid JSON.'), { status: 502 }) }

test('v56: invalid JSON from the first model -> next model is used automatically', async () => {
  _resetForTests()
  const log = [], M = ['gemini-3.8-flash', 'gemini-3.7-flash']
  const out = await run(scripted(M, { 'gemini-3.8-flash': sseOf('not json at all'), 'gemini-3.7-flash': sseOf('{"sections":[1]}') }, log), { validate: needJson, hedgeMs: 5000 })
  assert.equal(out.model, 'gemini-3.7-flash'); assert.deepEqual(log, ['gemini-3.8-flash', 'gemini-3.7-flash'])
})

test('v56: a model that answers 400 no longer kills the request: the next model answers', async () => {
  _resetForTests()
  const M = ['gemini-3.8-flash', 'gemini-3.7-flash']
  const out = await run(scripted(M, { 'gemini-3.8-flash': () => json(400, { error: { message: 'Invalid argument' } }), 'gemini-3.7-flash': sseOf('{"sections":[1]}') }), { validate: needJson, hedgeMs: 5000 })
  assert.equal(out.model, 'gemini-3.7-flash')
})

test('v56: if EVERY model gives unusable output, the student sees the specific reason', async () => {
  _resetForTests()
  const M = ['gemini-3.8-flash', 'gemini-3.7-flash']
  await assert.rejects(run(scripted(M, { 'gemini-3.8-flash': sseOf('nope'), 'gemini-3.7-flash': sseOf('still nope') }), { validate: needJson, hedgeMs: 5000 }), /did not return valid JSON/)
})

// ---- v57: quota fallback ----
const quota429 = msg => () => json(429, { error: { message: msg } })
test('v57: a model out of quota -> next model answers, and the next request skips the empty model', async () => {
  _resetForTests()
  const M = ['gemini-3.8-flash', 'gemini-3.7-flash']
  const log1 = []
  const a = await run(scripted(M, { 'gemini-3.8-flash': quota429('You exceeded your current quota. Quota exceeded for metric ... PerDay'), 'gemini-3.7-flash': sseOf('{"x":1}') }, log1), { hedgeMs: 5000 })
  assert.equal(a.model, 'gemini-3.7-flash'); assert.deepEqual(log1, ['gemini-3.8-flash', 'gemini-3.7-flash'])
  const log2 = []
  await run(scripted(M, { 'gemini-3.8-flash': quota429('x'), 'gemini-3.7-flash': sseOf('{"x":1}') }, log2), { hedgeMs: 5000 })
  assert.deepEqual(log2, ['gemini-3.7-flash'], 'the model without quota is not asked again')
})

test('v57: every model out of quota -> clear 429 message, not a vague error', async () => {
  _resetForTests()
  const M = ['gemini-3.8-flash', 'gemini-3.7-flash']
  await assert.rejects(run(scripted(M, { 'gemini-3.8-flash': quota429('quota'), 'gemini-3.7-flash': quota429('quota') }), { hedgeMs: 5000 }), e => e.status === 429 && /usage limit/.test(e.message))
})

test('v57: cooldown follows what Google says', () => {
  assert.equal(cooldownFor('Please retry in 23.4s.'), 26000)
  assert.equal(cooldownFor('Quota exceeded ... PerDay'), 30 * 60 * 1000)
  assert.equal(cooldownFor('limit: 0'), 60 * 60 * 1000)
})
