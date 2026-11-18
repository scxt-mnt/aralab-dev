import test from 'node:test'
import assert from 'node:assert/strict'
import { uploadChunked, downloadFile, pathsOf, partPath, CHUNK } from '../../src/chunkUpload.js'

const store = (failFirst = 0) => { const m = new Map(); let fails = failFirst; return { m, upload: async (p, b) => { if (fails-- > 0) return { error: { message: 'network' } }; if (m.has(p)) return { error: { message: 'The resource already exists' } }; m.set(p, b); return {} }, download: async p => (m.has(p) ? { data: m.get(p) } : { error: { message: 'nope' } }), remove: async ps => { ps.forEach(p => m.delete(p)); return {} } } }
const file = n => Object.assign(new Blob([new Uint8Array(n).fill(7)]), { name: 'a.pdf' })

test('splits into 1 MB pieces, retries a failed piece, and reassembles the same bytes', async () => {
  const b = store(2), f = file(CHUNK * 2 + 500)
  const { parts } = await uploadChunked(b, 'u/r/a.pdf', f, { sleep: async () => {} })
  assert.equal(parts, 3); assert.equal(b.m.size, 3)
  const { data } = await downloadFile(b, { path: 'u/r/a.pdf', parts, type: 'application/pdf' })
  assert.equal(data.size, f.size)
})
test('an already-uploaded piece counts as done; permanent failure cleans up every piece', async () => {
  const b = store(); b.m.set(partPath('p', 0), new Blob(['x']))
  assert.equal((await uploadChunked(b, 'p', file(10), { sleep: async () => {} })).parts, 1)
  const bad = store(99); await assert.rejects(uploadChunked(bad, 'q', file(CHUNK + 1), { retries: 1, sleep: async () => {} }), /failed at piece/)
  assert.equal(bad.m.size, 0)
})
test('old single-object files still work', async () => {
  const b = store(); b.m.set('old.pdf', new Blob(['hi']))
  assert.equal((await downloadFile(b, { path: 'old.pdf' })).data.size, 2); assert.deepEqual(pathsOf({ path: 'old.pdf' }), ['old.pdf'])
})
