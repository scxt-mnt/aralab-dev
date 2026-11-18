import test from 'node:test'
import assert from 'node:assert/strict'
import { rankModels, parseModel, resolveModels, generateJson, parseJsonLoose, _resetForTests, FALLBACK } from '../../server/gemini.js'

const gc = ['generateContent', 'countTokens']
const M = (name, methods = gc) => ({ name: 'models/' + name, supportedGenerationMethods: methods })
const LIST = [
  M('gemini-2.5-flash'), M('gemini-2.5-flash-lite'), M('gemini-2.5-pro'), M('gemini-3-flash-preview'), M('gemini-3.5-flash-lite'),
  M('gemini-3.6-flash'), M('gemini-3.8-flash'), M('gemini-3.1-pro-preview'), M('gemini-4-argon'), M('gemini-flash-latest'), M('gemini-flash-lite-latest'),
  M('gemini-embedding-001', ['embedContent']), M('gemini-2.5-flash-preview-tts'), M('gemini-2.5-flash-image'), M('gemini-live-2.5-flash'), M('gemma-3-27b-it'),
  M('gemini-2.0-flash-exp'), M('gemini-3.8-flash-8b'), M('gemini-2.5-flash-native-audio-preview'),
]
const ids = (l, o) => rankModels(l, o).map(m => m.id)

test('picks the newest Flash automatically (3.8 beats 3.6, 3.5-lite, 3-preview, 2.5)', () => {
  const r = ids(LIST)
  assert.equal(r[0], 'gemini-3.8-flash')
  assert.ok(r.indexOf('gemini-3.6-flash') < r.indexOf('gemini-3-flash-preview'))
  assert.ok(r.indexOf('gemini-3-flash-preview') < r.indexOf('gemini-2.5-flash'))
})
test('flash comes before flash-lite; aliases are last-resort', () => {
  const r = ids(LIST)
  assert.ok(r.indexOf('gemini-2.5-flash') < r.indexOf('gemini-3.5-flash-lite'))
  assert.ok(r.indexOf('gemini-3.5-flash-lite') < r.indexOf('gemini-flash-latest'))
})
test('never offers non-text or paid models by default', () => {
  const r = ids(LIST)
  for (const bad of ['gemini-embedding-001', 'gemini-2.5-flash-preview-tts', 'gemini-2.5-flash-image', 'gemini-live-2.5-flash', 'gemma-3-27b-it', 'gemini-2.0-flash-exp', 'gemini-4-argon', 'gemini-2.5-pro', 'gemini-3.1-pro-preview', 'gemini-3.8-flash-8b', 'gemini-2.5-flash-native-audio-preview'])
    assert.ok(!r.includes(bad), bad)
})
test('premium models only when explicitly allowed, and still after flash', () => {
  const r = ids(LIST, { allowPremium: true })
  assert.ok(r.includes('gemini-4-argon') && r.includes('gemini-3.1-pro-preview'))
  assert.equal(r[0], 'gemini-3.8-flash')
})
test('numeric version compare: 3.10 is newer than 3.9', () => {
  assert.equal(ids([M('gemini-3.9-flash'), M('gemini-3.10-flash')])[0], 'gemini-3.10-flash')
})
test('stable beats preview of the same version', () => {
  assert.equal(ids([M('gemini-3.8-flash-preview'), M('gemini-3.8-flash')])[0], 'gemini-3.8-flash')
})
test('future model is picked up with zero code change', () => {
  assert.equal(ids([...LIST, M('gemini-3.9-flash')])[0], 'gemini-3.9-flash')
})
test('models without generateContent are skipped', () => {
  assert.deepEqual(ids([M('gemini-3.8-flash', ['embedContent'])]), [])
})
test('parseModel', () => { assert.equal(parseModel('models/gemini-3.8-flash').family, 'flash'); assert.equal(parseModel('text-bison'), null) })

// ---- network behaviour with a scripted fetch ----
const json = (status, body) => ({ ok: status < 300, status, json: async () => body })
const okAnswer = text => json(200, { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { totalTokenCount: 42 } })
const scripted = (handler) => { const calls = []; const f = async (url, init) => { calls.push({ url, body: init?.body ? JSON.parse(init.body) : null }); return handler(url, init, calls) }; f.calls = calls; return f }
const listOk = () => json(200, { models: LIST })
const noSleep = async () => {}
const args = f => ({ key: 'k', system: 's', parts: [{ text: 'hi' }], fetchImpl: f, sleep: noSleep })

test.beforeEach(() => { _resetForTests(); delete process.env.GEMINI_MODEL })

test('generateJson uses the detected best model and sends no sampling params', async () => {
  const f = scripted(url => (url.includes('GenerateContent') ? okAnswer('{"a":1}') : listOk()))
  const r = await generateJson(args(f))
  assert.equal(r.model, 'gemini-3.8-flash'); assert.equal(r.tokens, 42)
  const body = f.calls.find(c => c.url.includes('GenerateContent')).body
  assert.ok(!('temperature' in body.generationConfig) && !('topP' in body.generationConfig) && !('topK' in body.generationConfig))
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, 'low')
  assert.equal(body.generationConfig.responseMimeType, 'application/json')
})
test('the exact error from the bug report (2.5-flash retired) falls through to the next model', async () => {
  process.env.GEMINI_MODEL = 'gemini-2.5-flash'                 // someone pinned the retired model
  const f = scripted(url => {
    if (!url.includes('GenerateContent')) return listOk()
    if (url.includes('gemini-2.5-flash:')) return json(404, { error: { message: 'This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash' } })
    return okAnswer('{"ok":true}')
  })
  const r = await generateJson(args(f))
  assert.equal(r.model, 'gemini-3.8-flash')
})
test('retired model detected via 400 wording too, and remembered (not retried next time)', async () => {
  const f = scripted(url => {
    if (!url.includes('GenerateContent')) return listOk()
    if (url.includes('gemini-3.8-flash:')) return json(400, { error: { message: 'model is no longer available' } })
    return okAnswer('{}')
  })
  assert.equal((await generateJson(args(f))).model, 'gemini-3.6-flash')
  const before = f.calls.filter(c => c.url.includes('gemini-3.8-flash:')).length
  await generateJson(args(f))
  assert.equal(f.calls.filter(c => c.url.includes('gemini-3.8-flash:')).length, before)
})
test('free-tier "limit: 0" skips to another model immediately, no waiting', async () => {
  let slept = 0
  const f = scripted(url => {
    if (!url.includes('GenerateContent')) return listOk()
    if (url.includes('gemini-3.8-flash:')) return json(429, { error: { message: 'Quota exceeded ... limit: 0' } })
    return okAnswer('{}')
  })
  const r = await generateJson({ ...args(f), sleep: async () => { slept++ } })
  assert.equal(r.model, 'gemini-3.6-flash'); assert.equal(slept, 0)
})
test('thinkingLevel rejected -> retried once without it on the same model', async () => {
  const f = scripted((url, _i, calls) => {
    if (!url.includes('GenerateContent')) return listOk()
    const gen = calls.filter(c => c.url.includes('GenerateContent'))
    return gen.length === 1 ? json(400, { error: { message: 'Unknown field thinkingLevel in thinkingConfig' } }) : okAnswer('{}')
  })
  const r = await generateJson(args(f))
  assert.equal(r.model, 'gemini-3.8-flash')
  const gens = f.calls.filter(c => c.url.includes('GenerateContent'))
  assert.ok(gens[0].body.generationConfig.thinkingConfig && !gens[1].body.generationConfig.thinkingConfig)
})
test('model list unreachable -> built-in fallback list still works', async () => {
  const f = scripted(url => (url.includes('GenerateContent') ? okAnswer('{}') : json(503, { error: { message: 'down' } })))
  const r = await generateJson(args(f))
  assert.equal(r.model, FALLBACK[0])
})
test('bad API key gives a clear message and does not loop through every model', async () => {
  const f = scripted(() => json(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }))
  await assert.rejects(generateJson(args(f)), /API key was rejected/)
  assert.equal(f.calls.length, 1)
})
test('truncated output is reported, not parsed', async () => {
  const f = scripted(url => (url.includes('GenerateContent') ? json(200, { candidates: [{ content: { parts: [{ text: '{"a":[1,' }] }, finishReason: 'MAX_TOKENS' }] }) : listOk()))
  await assert.rejects(generateJson(args(f)), /too big/)
})
test('everything failing yields one readable error', async () => {
  const f = scripted(url => (url.includes('GenerateContent') ? json(404, { error: { message: 'not found' } }) : listOk()))
  await assert.rejects(generateJson(args(f)), /No Gemini model could answer/)
})
test('thought parts are not mixed into the JSON', async () => {
  const f = scripted(url => (url.includes('GenerateContent') ? json(200, { candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: '{"x":1}' }] }, finishReason: 'STOP' }] }) : listOk()))
  assert.equal((await generateJson(args(f))).text, '{"x":1}')
})
test('list is cached between calls', async () => {
  const f = scripted(url => (url.includes('GenerateContent') ? okAnswer('{}') : listOk()))
  await generateJson(args(f)); await generateJson(args(f))
  assert.equal(f.calls.filter(c => !c.url.includes('GenerateContent')).length, 1)
})
test('resolveModels: pinned name goes first but detection is still the safety net', async () => {
  const f = scripted(listOk)
  const r = await resolveModels({ key: 'k', pinned: 'gemini-3.6-flash', fetchImpl: f })
  assert.equal(r.ids[0], 'gemini-3.6-flash'); assert.ok(r.ids.includes('gemini-3.8-flash'))
})
test('parseJsonLoose handles fences and chatter', () => {
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(parseJsonLoose('Sure! {"a":2} hope that helps'), { a: 2 })
  assert.throws(() => parseJsonLoose('nope'))
})

// ---- slow-model protection ----
const hang = init => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
test('a model that never answers is abandoned fast and the next model is used', async () => {
  const f = scripted((url, init) => (!url.includes('GenerateContent') ? listOk() : url.includes('gemini-3.8-flash:') ? hang(init) : okAnswer('{"ok":1}')))
  const events = []
  const r = await generateJson({ ...args(f), firstTokenMs: 30, onProgress: e => events.push(e) })
  assert.equal(r.model, 'gemini-3.6-flash')
  assert.ok(events.some(e => e.state === 'switch' && e.reason === 'timed out' && e.next === 'gemini-3.6-flash'))
  const gens = f.calls.filter(c => c.url.includes('GenerateContent'))
  assert.equal(gens[1].body.generationConfig.thinkingConfig.thinkingLevel, 'minimal')
})
test('overloaded (503) switches immediately and the sick model goes last next time', async () => {
  const f = scripted(url => (!url.includes('GenerateContent') ? listOk() : url.includes('gemini-3.8-flash:') ? json(503, { error: { message: 'overloaded' } }) : okAnswer('{}')))
  assert.equal((await generateJson(args(f))).model, 'gemini-3.6-flash')
  const first = () => f.calls.filter(c => c.url.includes('GenerateContent')).at(-1).url
  await generateJson(args(f)); assert.ok(first().includes('gemini-3.6-flash:'))
})
test('real SSE stream is assembled and reports progress', async () => {
  const enc = new TextEncoder(), chunks = ['data: {"candidates":[{"content":{"parts":[{"text":"{\\"a\\":"}]}}]}\r\n\r\n', 'data: {"candidates":[{"content":{"parts":[{"text":"1}"}]},"finishReason":"STOP"}],"usageMetadata":{"totalTokenCount":9}}\n\n']
  const body = new ReadableStream({ start(c) { chunks.forEach(x => c.enqueue(enc.encode(x))); c.close() } })
  const f = scripted(url => (url.includes('GenerateContent') ? { ok: true, status: 200, body } : listOk()))
  const ev = []; const r = await generateJson({ ...args(f), onProgress: e => ev.push(e) })
  assert.equal(r.text, '{"a":1}'); assert.equal(r.tokens, 9); assert.ok(ev.some(e => e.state === 'write'))
})
