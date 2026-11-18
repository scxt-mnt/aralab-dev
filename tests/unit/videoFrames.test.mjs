import test from 'node:test'
import assert from 'node:assert/strict'
import { sampleTimes, lumaDiff, pickKeyframes, sheetsFor, gridFor, fmtTime, toLuma, PER_SHEET, SHEETS_PER_VIDEO } from '../../src/videoFrames.js'
import { planFile, selectFiles } from '../../src/classroomLogic.js'
import { buildFileParts } from '../../server/aiFiles.js'

const flat = v => new Uint8Array(64 * 36).fill(v)
const S = (t, v) => ({ t, luma: flat(v) })

test('sampleTimes: about every 3 s, between 12 and 240 looks, inside the video', () => {
  assert.equal(sampleTimes(30).length, 12); assert.equal(sampleTimes(300).length, 100); assert.equal(sampleTimes(7200).length, 240)
  const t = sampleTimes(90); assert.ok(t[0] > 0 && t.at(-1) < 90); assert.deepEqual(t, [...t].sort((a, b) => a - b))
  assert.deepEqual(sampleTimes(0), []); assert.deepEqual(sampleTimes(NaN), [])
})
test('lumaDiff: same = 0, black vs white = 1', () => {
  assert.equal(lumaDiff(flat(10), flat(10)), 0); assert.equal(lumaDiff(flat(0), flat(255)), 1); assert.equal(lumaDiff([], flat(1)), 0)
})
test('pickKeyframes: keeps the first frame and one frame per scene change, ignores small noise', () => {
  // slide A (0-9 s, a little noise) -> slide B (10-19 s) -> slide C (20 s on)
  const s = [S(0, 200), S(3, 202), S(6, 199), S(10, 90), S(13, 91), S(16, 90), S(20, 20), S(23, 21)]
  assert.deepEqual(pickKeyframes(s).map(k => k.t), [0, 10, 20])
})
test('pickKeyframes: a static video gives one frame; changes closer than the gap are skipped', () => {
  assert.equal(pickKeyframes([S(0, 100), S(3, 100), S(6, 101)]).length, 1)
  assert.deepEqual(pickKeyframes([S(0, 0), S(1, 255), S(4, 0)], { minGap: 2 }).map(k => k.t), [0])         // a one-second flash is not a new scene
  assert.deepEqual(pickKeyframes([S(0, 0), S(1, 255), S(4, 255)], { minGap: 2 }).map(k => k.t), [0, 4])    // but the change is picked up as soon as it lasts
})
test('pickKeyframes: more changes than the limit -> the biggest changes win, still in time order', () => {
  const s = Array.from({ length: 30 }, (_, i) => S(i * 3, i % 2 ? 255 : 0))
  const k = pickKeyframes(s, { max: SHEETS_PER_VIDEO * PER_SHEET })
  assert.equal(k.length, 16); assert.equal(k[0].t, 0); assert.deepEqual(k.map(x => x.t), [...k.map(x => x.t)].sort((a, b) => a - b))
})
test('sheetsFor / gridFor / fmtTime / toLuma', () => {
  assert.deepEqual(sheetsFor(6), [[0, 1, 2, 3], [4, 5]]); assert.deepEqual(sheetsFor(0), [])
  assert.deepEqual(gridFor(1), { cols: 1, rows: 1 }); assert.deepEqual(gridFor(2), { cols: 2, rows: 1 }); assert.deepEqual(gridFor(4), { cols: 2, rows: 2 })
  assert.equal(fmtTime(65), '1:05'); assert.equal(fmtTime(3725), '1:02:05')
  assert.deepEqual([...toLuma([255, 255, 255, 255, 0, 0, 0, 255])], [255, 0])
})

test('classroom: mp4/webm/mov Drive videos are planned as pictures; other formats and audio are explained', () => {
  assert.deepEqual(planFile({ name: 'lec.mp4', mimeType: 'video/mp4' }), { how: 'video', type: 'image/jpeg', name: 'lec.mp4' })
  assert.match(planFile({ name: 'a.mkv', mimeType: 'video/x-matroska' }).reason, /MP4/)
  assert.match(planFile({ name: 'a.mp3', mimeType: 'audio/mpeg' }).reason, /audio/)
})
test('classroom: a video takes up to 4 picture sheets; many videos and images fit (the 40 MB total is the cap)', () => {
  const v = (n, size = 100e6) => ({ id: n, name: n + '.mp4', mimeType: 'video/mp4', size })
  const one = selectFiles([v('a')], { reserve: 1 })
  assert.equal(one.use.length, 1); assert.equal(one.use[0].plan.sheets, 4)                  // 100 MB video is fine (far above the 25 MB PDF cap)
  const two = selectFiles([v('a'), v('b')])
  assert.deepEqual(two.use.map(u => u.plan.sheets), [4, 4])
  const three = selectFiles([v('a'), v('b'), v('c')])
  assert.equal(three.use.length, 3); assert.equal(three.skipped.length, 0)
  assert.match(selectFiles([v('big', 400e6)]).skipped[0].why, /too big/)
  const mixed = selectFiles([{ name: 'p.png', mimeType: 'image/png', size: 10 }, v('a')])
  assert.deepEqual(mixed.use.map(u => u.plan.sheets || 0), [0, 4])
})

test('server: video picture sheets get a note telling the AI what they are (and that there is no sound)', async () => {
  const f = { name: 'Cell Biology (video frames 1).jpg', type: 'image/jpeg', path: 'x' }
  const { parts } = await buildFileParts({ files: [f], load: async () => ({ data: new Blob([new Uint8Array(100)]) }), key: 'k' })
  assert.equal(parts.length, 2); assert.match(parts[0].text, /Cell Biology/); assert.match(parts[0].text, /sound/); assert.ok(parts[1].inline_data)
  const plain = await buildFileParts({ files: [{ name: 'photo.jpg', type: 'image/jpeg' }], load: async () => ({ data: new Blob([new Uint8Array(10)]) }), key: 'k' })
  assert.equal(plain.parts.length, 1)
})
