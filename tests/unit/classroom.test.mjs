import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLessons, cleanTranscript, selectFiles, planFile, topicKey, byLesson, lessonState, attachmentsOf, transcriptInfo } from '../../src/classroomLogic.js'

const course = { id: 'c1', name: 'Biology' }
test('lessons: files, a video (for its transcript) or enough text only; drafts dropped, newest first', () => {
  const { lessons, hidden } = buildLessons(course, {
    materials: [
      { id: '1', title: 'Cells', updateTime: '2026-01-02', materials: [{ driveFile: { driveFile: { id: 'f1', title: 'cells.pdf' } } }] },
      { id: '2', title: 'Only a video', materials: [{ youtubeVideo: { id: 'x' } }] },
      { id: '3', title: 'Draft', state: 'DRAFT', materials: [{ driveFile: { driveFile: { id: 'f9' } } }] },
    ],
    announcements: [{ id: '4', text: 'Read chapter 3 on photosynthesis and the light reactions before Friday please.', updateTime: '2026-02-01' }],
  })
  // v57: the text-only announcement ('a-4') is not listed: it has no learning material
  // v73: a video lesson is listed, because its transcript can be pasted and turned into a reviewer
  assert.deepEqual(lessons.map(l => l.id), ['m-1', 'm-2']); assert.equal(hidden, 1)
  assert.equal(lessons[1].videos, 1)
})
test('v73: a pasted transcript is cleaned of timestamps, entities and repeated caption lines', () => {
  const raw = `0:00
Hello &amp; welcome to the lesson.
0:12 Hello & welcome to the lesson.
1:02:03 [00:15] The cell is the basic unit of life.

2:30 The cell is the basic unit of life.
3:00
So remember: 3:1 ratio.`
  assert.equal(cleanTranscript(raw), 'Hello & welcome to the lesson.\nThe cell is the basic unit of life.\n\nSo remember: 3:1 ratio.')
  assert.doesNotMatch(cleanTranscript(raw), /\d{1,2}:\d{2}/)
  assert.equal(cleanTranscript('  \n\n '), '')
  assert.equal(cleanTranscript('Line one\r\nLine two'), 'Line one\nLine two')
})
test('v73: transcriptInfo measures the cleaned text and rejects one stray line', () => {
  const good = transcriptInfo(Array.from({ length: 20 }, (_, i) => `Sentence ${i} explains a real idea.`).join('\n'))
  assert.equal(good.ok, true); assert.ok(good.words >= 15); assert.ok(good.minutes >= 1)
  assert.equal(transcriptInfo('0:01\nhello').ok, false)
  assert.equal(transcriptInfo('   ').text, '')
})
test('planFile: Google docs export, Office files explain, pdf downloads', () => {
  assert.equal(planFile({ name: 'N', mimeType: 'application/vnd.google-apps.document' }).exportMime, 'application/pdf')
  assert.equal(planFile({ name: 'a.pdf', mimeType: 'application/pdf' }).how, 'download')
  // v62: Office files are converted to text in the browser instead of being skipped
  const docx = planFile({ name: 'a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
  assert.equal(docx.how, 'convert'); assert.equal(docx.type, 'text/plain')
  assert.equal(planFile({ name: 'a.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }).how, 'convert')
  assert.equal(planFile({ name: 'b.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }).how, 'convert')
  assert.equal(planFile({ name: 'a.csv', mimeType: 'text/csv' }).how, 'convert')
  assert.equal(planFile({ name: 'a.ods', mimeType: 'application/vnd.oasis.opendocument.spreadsheet' }).how, 'convert')
  // a Google Sheet is exported as .xlsx so that EVERY tab is read, not only the first
  const sheet = planFile({ name: 'Grades', mimeType: 'application/vnd.google-apps.spreadsheet' })
  assert.equal(sheet.how, 'export-convert'); assert.match(sheet.exportMime, /spreadsheetml/); assert.equal(sheet.name, 'Grades.xlsx')
  assert.match(planFile({ name: 'old.xls', mimeType: 'application/vnd.ms-excel' }).reason, /old Office format/)
  assert.match(planFile({ name: 'a.zip', mimeType: 'application/zip' }).reason, /compressed/)
  assert.match(planFile({ name: 'a.mp3', mimeType: 'audio/mpeg' }).reason, /audio/)
})
test('selectFiles: a big PowerPoint is allowed (it becomes a little text) and many files fit (the 40 MB total is the cap)', () => {
  const pptx = { id: 'p', name: 'deck.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', size: 20 * 1048576 }
  assert.equal(selectFiles([pptx]).use.length, 1)
  assert.equal(selectFiles([{ ...pptx, size: 30 * 1048576 }]).use.length, 0)
  const many = Array.from({ length: 60 }, (_, i) => ({ ...pptx, id: 'p' + i, name: i + '.pptx', size: 1000 }))
  assert.equal(selectFiles(many).use.length, 50)
})
test('selectFiles respects limits', () => {
  const metas = Array.from({ length: 20 }, (_, i) => ({ id: 'i' + i, name: i + '.png', mimeType: 'image/png', size: 100 }))
  const r = selectFiles(metas)
  assert.equal(r.use.length, 20); assert.equal(r.skipped.length, 0)       // v71: no image count limit
  assert.equal(selectFiles([{ name: 'big.pdf', mimeType: 'application/pdf', size: 99e6 }]).use.length, 0)
  assert.equal(selectFiles([{ name: 'a.png', mimeType: 'image/png', size: 11 * 1048576 }]).use.length, 0)
})
test('lesson state from requests', () => {
  const k = topicKey('c', 'm-1')
  const m = byLesson([{ topic: k, status: 'failed', created_at: '1' }, { topic: k, status: 'done', created_at: '2' }, { topic: 'x', status: 'done' }])
  assert.equal(lessonState(m[k]), 'done'); assert.equal(lessonState(undefined), 'new'); assert.equal(lessonState({ status: 'rejected', reviewer_id: 'r' }), 'duplicate')
  assert.equal(attachmentsOf([{ link: {} }]).links, 1)
})
