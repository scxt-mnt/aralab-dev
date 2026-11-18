import test from 'node:test'
import assert from 'node:assert/strict'
import {
  visualLabel, visualFiles, plannedVisuals, fitVisualBudget, cleanVisualPayload, buildVisuals,
  VISUAL_ONE_CHARS, VISUAL_TOTAL_CHARS,
} from '../../src/visuals.js'
import { MAX_VISUALS } from '../../src/render.js'

// a real-looking (but tiny) image data URI the server accepts
const uri = (n = 40) => `data:image/jpeg;base64,${'A'.repeat(n)}`
const img = (name, type = 'image/jpeg') => ({ name, type, size: 10 })

test('visualLabel: a readable caption from a file name, and a video sheet gets its own name', () => {
  assert.equal(visualLabel('IMG_2043.jpg'), 'IMG 2043')
  assert.equal(visualLabel('cell-membrane diagram.png'), 'cell membrane diagram')
  assert.equal(visualLabel('', 2), 'Picture 3')
  assert.equal(visualLabel('lesson (video frames 2).jpg'), 'Video slide')
  assert.equal(visualLabel('x'.repeat(200)).length, 60)
})

test('visualFiles: only images count, by mime type or by extension', () => {
  const files = [img('a.jpg'), img('b', 'image/png'), { name: 'notes.pdf', type: 'application/pdf' }, { name: 'c.WEBP', type: '' }, { name: 'd.txt', type: 'text/plain' }]
  assert.deepEqual(visualFiles(files).map(f => f.name), ['a.jpg', 'b', 'c.WEBP'])
  assert.deepEqual(visualFiles(null), [])
})

test('plannedVisuals: the setting decides how many pictures are used (0, 4 or 8)', () => {
  const files = Array.from({ length: 12 }, (_, i) => img(`p${i}.png`, 'image/png'))
  assert.equal(plannedVisuals(files, 'none').length, 0)
  assert.equal(plannedVisuals(files, 'some').length, 4)
  assert.equal(plannedVisuals(files, 'all').length, 8)
  assert.equal(plannedVisuals(files.slice(0, 2), 'all').length, 2)
})

test('fitVisualBudget: a picture that would not fit is skipped, not the whole set', () => {
  const small = uri(100), huge = uri(VISUAL_TOTAL_CHARS + 10)
  const kept = fitVisualBudget([{ name: 'a', url: small }, { name: 'b', url: huge }, { name: 'c', url: small }])
  assert.deepEqual(kept.map(x => x.name), ['a', 'c'])
  assert.deepEqual(fitVisualBudget([{ name: 'x', url: uri(VISUAL_ONE_CHARS + 1) }]), [])
  assert.deepEqual(fitVisualBudget(null), [])
})

test('cleanVisualPayload: the server accepts only real base64 images inside the browser caps', () => {
  assert.deepEqual(cleanVisualPayload(null), [])
  assert.deepEqual(cleanVisualPayload([{ name: 'a', url: 'https://example.com/a.jpg' }]), [])       // never a remote link
  assert.deepEqual(cleanVisualPayload([{ name: 'a', url: 'data:image/svg+xml;base64,AAA' }]), [])   // not an allowed format
  assert.deepEqual(cleanVisualPayload([{ name: 'a', url: uri(VISUAL_ONE_CHARS + 5) }]), [])          // too heavy
  const out = cleanVisualPayload([{ name: 'IMG_1.jpg', url: uri() }])
  assert.deepEqual(out, [{ name: 'IMG 1', url: uri() }])
})

test('cleanVisualPayload: at most MAX_VISUALS pictures, and the total budget is respected', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ name: `p${i}`, url: uri(1000) }))
  assert.equal(cleanVisualPayload(many).length, MAX_VISUALS)
  const fat = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}`, url: uri(VISUAL_ONE_CHARS - 1) }))
  const out = cleanVisualPayload(fat)
  assert.ok(out.length < 8)                                                                          // 8 x ~1.1M would exceed the total
  const total = out.reduce((n, v) => n + v.url.length, 0)
  assert.ok(total <= VISUAL_TOTAL_CHARS)
  assert.equal(cleanVisualPayload(many, 3).length, 3)                                                // an explicit smaller cap
})

test('buildVisuals: without a browser it returns no pictures instead of throwing', async () => {
  assert.deepEqual(await buildVisuals([img('a.jpg')], 'some'), [])
  assert.deepEqual(await buildVisuals([img('a.jpg')], 'none'), [])
  assert.deepEqual(await buildVisuals(null, 'all'), [])
})

test('buildVisuals: reports progress only for the pictures it is going to use', async () => {
  const steps = []
  const files = [img('a.jpg'), img('b.jpg'), { name: 'c.pdf', type: 'application/pdf' }]
  await buildVisuals(files, 'some', { onStep: s => steps.push(s) })
  assert.deepEqual(steps, ['Preparing picture 1 of 2…', 'Preparing picture 2 of 2…'])
})
