import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOg } from '../../server/ogImage.js'

const isPng = b => b.length > 2000 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
const size = b => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) })

test('og card: a reviewer card and a score card are real 1200x630 PNGs', async () => {
  const a = await renderOg({ title: 'Cell Biology', subject: 'Biology', by: 'Ana', visitors: 3, stars: 1 })
  const b = await renderOg({ title: 'Cell Biology', subject: 'Biology', score: 87, level: 'hard' })
  for (const png of [a, b]) { assert.ok(isPng(png)); assert.deepEqual(size(png), { w: 1200, h: 630 }) }
  assert.notDeepEqual(a, b)
})
test('og card: odd input (empty, huge, emoji, markup, out-of-range score) still renders', async () => {
  for (const d of [{}, { title: 'x'.repeat(500), subject: 'y'.repeat(200), by: 'z'.repeat(200) }, { title: 'Quiz 😀 日本語 <b>x</b>', score: 150, level: 'nope' }, { title: 'T', score: -9 }, { title: 'T', score: 'abc' }]) {
    const png = await renderOg(d); assert.ok(isPng(png)); assert.deepEqual(size(png), { w: 1200, h: 630 })
  }
})
