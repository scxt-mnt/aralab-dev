// Shared by "Create reviewer" and "Google Classroom": check the files, upload them in the background, save the request, start the AI.
import { sb } from './supabase'
import { callAi } from './aiRun'
import { CHUNK, uploadChunked, pathsOf } from './chunkUpload'
import { uid } from './lib'
import { runJob } from './uploads'
import { convertFile } from './fileConvert'
import { MAX_FILES, MAX_PDF_PAGES, MAX_REQUEST_BYTES, maxBytesFor, mbText, countPdfPages } from './limits'

export const typeOf = f => f.type || (/\.(md|txt)$/i.test(f.name) ? 'text/plain' : '')
// what the server takes after conversion. v62: the picker accepts any file and `convertFile` (fileConvert.js) turns Word, Excel, PowerPoint, CSV, ... into text first
export const okType = f => ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain'].includes(typeOf(f))
export const anyFile = () => true
export { convertFile }
const pdfPages = async f => countPdfPages(new TextDecoder('latin1').decode(await f.arrayBuffer()))

// '' when the files are fine, otherwise a sentence the student can act on
export async function checkFiles(files) {
  if (!files.length) return 'Add at least one file.'
  if (files.length > MAX_FILES) return `Up to ${MAX_FILES} files per request.`
  if (files.reduce((n, f) => n + f.size, 0) > MAX_REQUEST_BYTES) return `Your files add up to more than ${mbText(MAX_REQUEST_BYTES)}. Remove some or split them into two requests.`
  for (const f of files) {
    if (!okType(f)) return `${f.name}: use PDF, Word, Excel, PowerPoint, image (PNG/JPG/WEBP) or text files.`
    if (f.size > maxBytesFor(typeOf(f))) return `${f.name} is over ${mbText(maxBytesFor(typeOf(f)))}.`
    if (typeOf(f) === 'application/pdf' && (await pdfPages(f)) > MAX_PDF_PAGES) return `${f.name} has more than ${MAX_PDF_PAGES} pages. Split it into two files.`
  }
  return ''
}

// "cell_biology-midterm.pdf" -> "cell biology midterm"
export const titleFromFile = name => String(name || '').replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120)

// Uploads in the background (progress bar at the top) and saves the request row. Resolves with the new request id.
export function sendRequest({ me, label, files, body, signal }) {
  const rid = crypto.randomUUID()
  return runJob(label, async job => {
    const up = []
    job.total(files.reduce((n, f) => n + Math.max(1, Math.ceil(f.size / CHUNK)), 0) + 1)       // one step per 1 MB piece + the final save
    try {
      for (const f of files) {
        if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true })
        const path = `${me}/${rid}/${uid()}-${f.name.replace(/[^\w.\-]/g, '_')}`
        const { parts } = await uploadChunked(sb.storage.from('notes'), path, f, { onPiece: () => { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true }); job.step() } })
        up.push({ path, name: f.name, type: typeOf(f), size: f.size, parts })
      }
      const row = { id: rid, ...body, files: up }
      if (!row.aids?.length) delete row.aids          // keeps working even if the database was not upgraded yet
      const { error } = await sb.from('reviewer_requests').insert(row)
      if (error) throw /row-level security/i.test(error.message) ? new Error('Too many requests are still starting. Wait a moment and try again.') : error
      job.step()
    } catch (err) { if (up.length) await sb.storage.from('notes').remove(up.flatMap(pathsOf)); throw err }
  }).then(() => rid)
}

// Starts the AI for a saved request. { ok, status, body } (body.error explains a refusal, e.g. "already in the Library").
// v75: `opts` can carry the pictures the student wants inside the reviewer ({ visuals: [{name,url}] }).
export async function generateNow(rid, fallbackToken, onProgress, importContent, opts) {
  const { data: s } = await sb.auth.getSession()
  const body = { requestId: rid }
  if (importContent) body.importContent = importContent
  if (Array.isArray(opts?.visuals) && opts.visuals.length) body.visuals = opts.visuals
  if (typeof opts?.thumb === 'string' && opts.thumb) body.thumb = opts.thumb
  return callAi('/api/generate', s.session?.access_token || fallbackToken, body, onProgress, opts?.signal)
}

// v77: Cancel. Tells the server to stop (it checks before it spends the AI call and before it publishes), then removes the
// half-made request and its uploaded files so nothing is left behind. Best-effort: every step swallows its own errors.
export async function discardRequest(rid, fallbackToken) {
  if (!rid) return
  try {
    const { data: s } = await sb.auth.getSession()
    await fetch('/api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${s.session?.access_token || fallbackToken}` }, body: JSON.stringify({ requestId: rid, cancel: true }) })
  } catch { /* offline: the row is removed below if the database allows it */ }
  try {
    const { data } = await sb.from('reviewer_requests').select('files').eq('id', rid).maybeSingle()
    const { error } = await sb.from('reviewer_requests').delete().eq('id', rid)
    if (!error && data?.files?.length) await sb.storage.from('notes').remove(data.files.flatMap(pathsOf))
  } catch { /* ignore */ }
}
