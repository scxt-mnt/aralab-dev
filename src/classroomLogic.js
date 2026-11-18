// Google Classroom: the pure part (no network, no React), so it can be tested.
// A "lesson" is anything a teacher posted that a student can learn from: a Materials post, an assignment with attachments,
// or an announcement with attachments. Only lessons with something readable (a Drive file or a real text) are listed.
import { MAX_FILES as MAX_FILES_LIMIT, MAX_REQUEST_BYTES, maxBytesFor } from './limits.js'
import { MAX_LESSON_VIDEO, SHEETS_PER_VIDEO } from './videoFrames.js'
import { kindOf } from './fileConvert.js'

export const GC_PREFIX = 'gc:'
export const topicKey = (courseId, lessonId) => `${GC_PREFIX}${courseId}:${lessonId}`
export const isGcTopic = t => String(t || '').startsWith(GC_PREFIX)

const DOC = 'application/vnd.google-apps.document', SLIDES = 'application/vnd.google-apps.presentation', SHEET = 'application/vnd.google-apps.spreadsheet'
export const MIN_TEXT = 40          // a post with no files is worth a reviewer only if its own text is at least this long
export const MAX_FILES = MAX_FILES_LIMIT
export const MAX_CONVERT_BYTES = 25 * 1024 * 1024      // v62: Word / Excel / PowerPoint files are turned into text in the browser; the original may be this big
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const CONVERTED_SIZE = 200 * 1024                           // what such a file counts as in the request (its text is cut at 60,000 characters)

const KINDS = { m: 'Material', w: 'Assignment', a: 'Announcement' }
export const kindLabel = lesson => KINDS[lesson.id[0]] || 'Post'

// attachments of a post -> { files:[{id,title}], links, videos }
export function attachmentsOf(materials) {
  const files = [], out = { files, links: 0, videos: 0 }
  for (const m of Array.isArray(materials) ? materials : []) {
    const f = m?.driveFile?.driveFile
    if (f?.id) files.push({ id: String(f.id), title: String(f.title || 'Untitled') })
    else if (m?.youtubeVideo) out.videos++
    else if (m?.link || m?.form) out.links++
  }
  return out
}

const firstLine = t => String(t || '').split('\n').map(x => x.trim()).find(Boolean) || ''
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t)

function toLesson(kind, course, post) {
  if (!post?.id || ['DRAFT', 'DELETED'].includes(post.state)) return null
  const description = String(post.description || post.text || '').trim()
  const att = attachmentsOf(post.materials)
  const title = String(post.title || '').trim() || clip(firstLine(description), 80) || 'Untitled post'
  return { id: `${kind}-${post.id}`, courseId: course.id, courseName: course.name, title, description, kind, files: att.files, links: att.links, videos: att.videos,
    created: post.updateTime || post.creationTime || '', url: post.alternateLink || '' }
}
// v57: only LEARNING MATERIAL is listed. Plain announcements ("class is cancelled", reminders) and assignment instructions with no files are left out.
// Learning material = at least one attached file, or a Materials post that carries real text of its own.
// v73: a video lesson is listed too, because the student can paste its transcript and build a reviewer from that.
export const readable = l => l.files.length > 0 || l.videos > 0 || (l.kind === 'm' && l.description.length >= MIN_TEXT)

// lessons -> [{ name, lessons (newest first), courseIds }] one group per SUBJECT, the group with the newest lesson first.
// nameOf maps a class name to a subject name (so "Biology 1A" and "biology 1b" can share one group).
export function groupBySubject(lessons, nameOf = x => x) {
  const m = new Map()
  for (const l of lessons || []) {
    const name = String(nameOf(l.courseName) || l.courseName || 'Other').trim() || 'Other'
    const k = name.toLowerCase()
    if (!m.has(k)) m.set(k, { name, lessons: [], courseIds: new Set() })
    const g = m.get(k); g.lessons.push(l); g.courseIds.add(l.courseId)
  }
  return [...m.values()].map(g => ({ ...g, courseIds: [...g.courseIds], lessons: g.lessons.sort((a, b) => String(b.created).localeCompare(String(a.created))) }))
    .sort((a, b) => String(b.lessons[0]?.created).localeCompare(String(a.lessons[0]?.created)) || a.name.localeCompare(b.name))
}
export const titleKey = l => `${l.courseId}:${l.id}`

// { materials, work, announcements } (raw API lists) -> { lessons (newest first), hidden (posts with nothing readable) }
export function buildLessons(course, { materials = [], work = [], announcements = [] } = {}) {
  const all = [...materials.map(p => toLesson('m', course, p)), ...work.map(p => toLesson('w', course, p)), ...announcements.map(p => toLesson('a', course, p))].filter(Boolean)
  const lessons = all.filter(readable).sort((a, b) => String(b.created).localeCompare(String(a.created)))
  return { lessons, hidden: all.length - lessons.length }
}

// How to read one Drive file. null + reason when we can't.
// v62: Word / Excel / PowerPoint / OpenDocument / CSV / HTML / RTF / EPUB and any other readable file are downloaded and CONVERTED TO TEXT
// in the browser (fileConvert.js). Google Sheets are exported as .xlsx (all tabs, not only the first one) and converted the same way.
export function planFile(meta) {
  const m = meta?.mimeType || '', name = meta?.name || 'file'
  if (m === DOC || m === SLIDES) return { how: 'export', exportMime: 'application/pdf', type: 'application/pdf', name: /\.pdf$/i.test(name) ? name : `${name}.pdf` }
  if (m === SHEET) return { how: 'export-convert', exportMime: XLSX, type: 'text/plain', name: `${name.replace(/\.[^.]+$/, '')}.xlsx` }
  if (['application/pdf', 'image/png', 'image/jpeg', 'image/webp'].includes(m)) return { how: 'download', type: m, name }
  if ((m === 'text/plain' || m === 'text/markdown' || /\.(txt|md)$/i.test(name)) && !/\.(csv|tsv|json|html?|rtf)$/i.test(name)) return { how: 'download', type: 'text/plain', name }
  if (m === 'application/vnd.google-apps.shortcut') return { reason: 'is a shortcut' }
  if (m.startsWith('application/vnd.google-apps.')) return { reason: 'is a Google file type the AI can’t read (use a Doc, Slides, Sheet or PDF)' }
  // v61: a video is read as pictures: one frame for every change of scene, tiled into a few images (see videoFrames.js)
  if (['video/mp4', 'video/webm', 'video/quicktime'].includes(m)) return { how: 'video', type: 'image/jpeg', name }
  if (m.startsWith('video/')) return { reason: 'is a video format the browser can’t play. Use an MP4 video' }
  if (m.startsWith('audio/')) return { reason: 'is an audio file' }
  if (m.startsWith('image/')) return { reason: 'is an image format the AI can’t read. Use PNG, JPG or WEBP' }
  const kind = kindOf({ name, type: m })
  if (kind === 'old') return { reason: 'is an old Office format (.doc / .xls / .ppt) the browser can’t read. In Google Drive choose File > Save as Google Docs/Sheets/Slides, then try again' }
  if (/zip|compressed|tar|rar|7z/.test(m) && !/officedocument|opendocument|epub/.test(m)) return { reason: 'is a compressed archive. Unzip it and share the files inside' }
  return { how: 'convert', type: 'text/plain', name }        // docx, xlsx, pptx, odf, csv, json, html, rtf, epub, code... or unknown: the converter decides by looking inside, and says why if it can't
}

// Which of a lesson's Drive files to download, within the same limits as a normal request. metas = Drive metadata ({id,name,mimeType,size}).
export function selectFiles(metas, { reserve = 0 } = {}) {
  const use = [], skipped = []
  let total = 0, made = reserve                 // made = how many files the request will hold (a video becomes several pictures)
  for (const meta of metas) {
    const plan = planFile(meta)
    if (plan.reason) { skipped.push({ name: meta.name, why: plan.reason }); continue }
    const size = Number(meta.size) || 0
    if (plan.how === 'video') {                              // v61: judged by the pictures it will become, not by its own size (it is never uploaded)
      if (size > MAX_LESSON_VIDEO) { skipped.push({ name: meta.name, why: `is over ${Math.round(MAX_LESSON_VIDEO / 1048576)} MB, too big to read in the browser` }); continue }
      const sheets = Math.min(SHEETS_PER_VIDEO, MAX_FILES - made)
      if (sheets < 1) { skipped.push({ name: meta.name, why: `would be over the limit of ${MAX_FILES} files` }); continue }
      made += sheets
      use.push({ meta, plan: { ...plan, sheets } }); continue
    }
    if (made >= MAX_FILES) { skipped.push({ name: meta.name, why: `is over the limit of ${MAX_FILES} files` }); continue }
    const converts = plan.how === 'convert' || plan.how === 'export-convert'
    if (size > (converts ? MAX_CONVERT_BYTES : maxBytesFor(plan.type))) { skipped.push({ name: meta.name, why: 'is too big' }); continue }
    if (!converts && total + size > MAX_REQUEST_BYTES) { skipped.push({ name: meta.name, why: 'would make the lesson too big' }); continue }
    total += converts ? CONVERTED_SIZE : size; made++
    use.push({ meta, plan })
  }
  return { use, skipped }
}

// A lesson's own text becomes a small text file next to its attachments.
export const lessonText = l => (l.description.length >= 20 ? `${l.title}\n\n${l.description}` : '')
export const safeName = s => String(s || 'lesson').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'lesson'

// v73: a transcript pasted from YouTube ("Show transcript"), Meet captions or a .txt file arrives with timestamps,
// HTML entities and repeated caption lines. Clean it so the reviewer reads like notes instead of a caption dump.
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&nbsp;': ' ' }
export function cleanTranscript(raw) {
  const text = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/&(amp|lt|gt|quot|#39|#x27|nbsp);/gi, m => ENTITIES[m.toLowerCase()] ?? m)
  const out = []
  let prev = ''
  for (const rawLine of text.split('\n')) {
    const rawTrim = rawLine.trim()
    if (!rawTrim) { if (out.length && out[out.length - 1] !== '') out.push(''); continue }
    const line = rawTrim
      .replace(/^(?:\[|\()?\d{1,2}(?::\d{2}){1,2}(?:\]|\))?\s*[-–—:.]?\s*/, '')          // a leading 0:12 / 1:02:03
      .replace(/[\[(]\s*\d{1,2}(?::\d{2}){1,2}\s*[\])]/g, '')                             // [00:12] anywhere on the line
      .replace(/\s+/g, ' ')
      .trim()
    if (!line) continue                                                                     // the line was only a timestamp
    if (/^\d{1,2}(?::\d{2}){1,2}$/.test(line)) continue                                      // a bare timestamp line
    const key = line.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
    if (key && key === prev) continue                                                        // the same caption line twice in a row
    prev = key
    out.push(line)
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
// What the student pasted, measured: the AI needs a real paragraph, not one stray word.
export function transcriptInfo(raw) {
  const text = cleanTranscript(raw)
  const words = text ? text.split(/\s+/).filter(Boolean).length : 0
  return { text, words, chars: text.length, minutes: Math.max(1, Math.round(words / 180)), ok: words >= 15 }
}

// status of the request that belongs to a lesson -> what the button should do
export function lessonState(row) {
  if (!row) return 'new'
  if (row.status === 'done') return 'done'
  if (['pending', 'approved', 'generating'].includes(row.status)) return 'busy'
  if (row.status === 'rejected') return row.reviewer_id ? 'duplicate' : 'rejected'
  return 'failed'
}
// newest request per lesson marker
export function byLesson(rows) {
  const m = {}
  for (const r of rows || []) if (isGcTopic(r.topic) && (!m[r.topic] || String(r.created_at) > String(m[r.topic].created_at))) m[r.topic] = r
  return m
}
