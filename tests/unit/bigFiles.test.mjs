import test from 'node:test'
import assert from 'node:assert/strict'
import { createFake } from '../fakeSupabase.js'
import { runGenerate } from '../../server/generateFlow.js'
import { buildFileParts, INLINE_ONE } from '../../server/aiFiles.js'
import { uploadFile, deleteFile } from '../../server/gemini.js'
import { MB, maxBytesFor, countPdfPages, MAX_PDF_BYTES, MAX_REQUEST_BYTES } from '../../src/limits.js'

const blob = size => ({ data: { size, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }, error: null })
const load = sizes => async f => (sizes[f.name] === undefined ? { data: null, error: new Error('nf') } : blob(sizes[f.name]))
const pdf = name => ({ name, type: 'application/pdf', path: 'u/' + name })

test('limits: PDFs may be big, images smaller, text smallest', () => {
  assert.equal(maxBytesFor('application/pdf'), 25 * MB); assert.equal(maxBytesFor('image/png'), 10 * MB); assert.equal(maxBytesFor('text/plain'), 5 * MB)
})
test('page counter uses page objects or the page tree count, whichever is bigger', () => {
  assert.equal(countPdfPages('<< /Type /Page >> << /Type /Page >> << /Type /Pages /Kids [] /Count 2 >>'), 2)
  assert.equal(countPdfPages('<< /Type /Pages /Kids [1 0 R] /Count 140 >>'), 140)
  assert.equal(countPdfPages('<< /Count 77 /Kids [] /Type /Pages >>'), 77)
  assert.equal(countPdfPages('no pdf here'), 0)
})

test('small PDFs go inline; a big one uses the Files API; the inline budget is respected', async () => {
  const ups = [], removed = []
  const upload = async o => { ups.push(o.name); return { name: 'files/' + o.name, uri: 'https://g/' + o.name, mime: o.mime } }
  const remove = async o => { removed.push(o.name) }
  const sizes = { a: 1 * MB, b: 3 * MB, c: 3 * MB, d: 4 * MB, big: 12 * MB }
  const { parts, cleanup } = await buildFileParts({ files: ['a', 'b', 'big', 'c', 'd'].map(pdf), load: load(sizes), key: 'k', upload, remove })
  assert.equal(parts.filter(p => p.inline_data).length, 3)          // a + b + c = 7 MB
  assert.deepEqual(ups, ['big', 'd'])                                // big (over 4 MB) and d (would pass 10 MB budget) are uploaded
  assert.ok(parts.some(p => p.file_data?.file_uri === 'https://g/big'))
  assert.ok(sizes.big > INLINE_ONE)
  await cleanup(); assert.deepEqual(removed.sort(), ['files/big', 'files/d'])
})
test('real size limits are enforced against the downloaded file', async () => {
  const run = (sizes, files) => buildFileParts({ files, load: load(sizes), key: 'k', upload: async () => ({ name: 'n', uri: 'u' }), remove: async () => {} })
  await assert.rejects(run({ x: MAX_PDF_BYTES + 1 }, [pdf('x')]), /over 25 MB/)
  await assert.rejects(run({ x: 11 * MB }, [{ name: 'x', type: 'image/png', path: 'u/x' }]), /over 10 MB/)
  await assert.rejects(run({ x: 6 * MB }, [{ name: 'x', type: 'text/plain', path: 'u/x' }]), /over 5 MB/)
  await assert.rejects(run({ a: 20 * MB, b: 20 * MB, c: 2 * MB }, ['a', 'b', 'c'].map(pdf)), /add up to more than 40 MB/)
  assert.ok(MAX_REQUEST_BYTES > MAX_PDF_BYTES)
})
test('if something fails midway, files already sent to the AI are deleted', async () => {
  const removed = []
  await assert.rejects(buildFileParts({ files: [pdf('big'), pdf('gone')], load: load({ big: 12 * MB }), key: 'k', upload: async () => ({ name: 'files/big', uri: 'u' }), remove: async o => { removed.push(o.name) } }), /Could not read gone/)
  assert.deepEqual(removed, ['files/big'])
})

// ---- Google Files API client ----
function fakeFetch(script) {
  const calls = []
  const f = async (url, opts = {}) => { calls.push({ url: String(url), opts }); return script(String(url), opts, calls.length) }
  f.calls = calls; return f
}
const res = (body, { ok = true, status = 200, headers = {} } = {}) => ({ ok, status, headers: { get: k => headers[k.toLowerCase()] ?? null }, json: async () => body })
test('uploadFile: starts, uploads, waits for PROCESSING to finish, returns the link', async () => {
  const f = fakeFetch((url, o, n) => {
    if (n === 1) return res({}, { headers: { 'x-goog-upload-url': 'https://up/session1' } })
    if (n === 2) return res({ file: { name: 'files/abc', uri: 'https://g/files/abc', state: 'PROCESSING', mimeType: 'application/pdf' } })
    return res({ name: 'files/abc', uri: 'https://g/files/abc', state: 'ACTIVE', mimeType: 'application/pdf' })
  })
  const r = await uploadFile({ key: 'K', bytes: Buffer.from('abc'), mime: 'application/pdf', name: 'n.pdf', fetchImpl: f, sleep: async () => {} })
  assert.deepEqual(r, { uri: 'https://g/files/abc', name: 'files/abc', mime: 'application/pdf' })
  assert.match(f.calls[0].url, /upload\/v1beta\/files$/); assert.equal(f.calls[0].opts.headers['X-Goog-Upload-Header-Content-Length'], '3')
  assert.equal(f.calls[1].url, 'https://up/session1'); assert.equal(f.calls[1].opts.headers['X-Goog-Upload-Command'], 'upload, finalize')
  assert.match(f.calls[2].url, /v1beta\/files\/abc$/)
})
test('uploadFile: clear errors for a refusal and for a file Google cannot read', async () => {
  const refuse = fakeFetch(() => res({ error: { message: 'quota' } }, { ok: false, status: 429 }))
  await assert.rejects(uploadFile({ key: 'K', bytes: Buffer.from('a'), mime: 'application/pdf', name: 'n.pdf', fetchImpl: refuse }), e => e.status === 429 && /would not take n\.pdf/.test(e.message))
  const bad = fakeFetch((u, o, n) => (n === 1 ? res({}, { headers: { 'x-goog-upload-url': 'https://up/s' } }) : res({ file: { name: 'files/x', uri: 'u', state: 'FAILED' } })))
  await assert.rejects(uploadFile({ key: 'K', bytes: Buffer.from('a'), mime: 'application/pdf', name: 'n.pdf', fetchImpl: bad }), e => e.status === 422 && /damaged or password protected/.test(e.message))
})
test('deleteFile never throws', async () => { await deleteFile({ key: 'K', name: 'files/x', fetchImpl: async () => { throw new Error('offline') } }) })

// ---- the whole generate flow with a big PDF ----
function setup(size) {
  return createFake({
    tokens: { adm: { id: 'admin' } },
    tables: { admins: [{ user_id: 'admin' }], profiles: [{ user_id: 'stu', school: 'S' }], astra_members: [], usage: [], reviewers: [],
      reviewer_requests: [{ id: 'r1', user_id: 'stu', title: 'T', subject: 'S', topic: 't', coverage: 'c', template: 'classic', theme: 'indigo', status: 'pending', files: [{ path: 'stu/r1/big.pdf', name: 'big.pdf', type: 'application/pdf', size }] }] },
    files: { 'notes/stu/r1/big.pdf': { data: [1, 2, 3], size } },
  })
}
const good = JSON.stringify({ title: 'T', summary: 's', sections: [{ heading: 'h', points: ['p'] }] })
test('generate: a 12 MB PDF is accepted, sent through the Files API, and deleted from Google afterwards', async () => {
  const f = setup(12 * MB), seen = { parts: null, budget: 0, removed: [] }
  const ai = {
    uploadFile: async o => ({ name: 'files/big', uri: 'https://g/big', mime: o.mime }), deleteFile: async o => { seen.removed.push(o.name) },
    generateJson: async o => { seen.parts = o.parts; seen.budget = o.budgetMs; return { text: good, tokens: 1, model: 'm' } },
  }
  const r = await runGenerate({ db: f.client, authHeader: 'Bearer adm', body: { requestId: 'r1' }, key: 'k', ai })
  assert.equal(r.status, 200)
  assert.ok(seen.parts.some(p => p.file_data?.file_uri === 'https://g/big')); assert.ok(!seen.parts.some(p => p.inline_data))
  assert.deepEqual(seen.removed, ['files/big']); assert.ok(seen.budget > 0 && seen.budget <= 280000)
})
test('generate: a 26 MB PDF is refused with a clear message, nothing is uploaded', async () => {
  const f = setup(26 * MB); let uploaded = 0
  const r = await runGenerate({ db: f.client, authHeader: 'Bearer adm', body: { requestId: 'r1' }, key: 'k', ai: { uploadFile: async () => { uploaded++ }, generateJson: async () => ({ text: good, tokens: 1, model: 'm' }) } })
  assert.equal(r.status, 422); assert.match(r.body.error, /over 25 MB/); assert.equal(uploaded, 0)
  assert.equal(f.db.tables.reviewer_requests[0].status, 'failed')
})
