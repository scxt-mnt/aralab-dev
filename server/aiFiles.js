// Turns stored student files into Gemini "parts", for both generating a reviewer and fixing one.
//  - text files           -> plain text
//  - small PDFs / images  -> inline (base64), up to INLINE_BUDGET bytes per request
//  - big PDFs / images    -> uploaded to Google's Files API and referenced by link (no 20 MB request limit)
// The size limits are enforced here against the REAL downloaded size, never against what the browser claimed.
import { maxBytesFor, mbText, MAX_REQUEST_BYTES } from '../src/limits.js'
import { uploadFile, deleteFile } from './gemini.js'

export const INLINE_ONE = 4 * 1024 * 1024         // a single file above this goes through the Files API
export const INLINE_BUDGET = 10 * 1024 * 1024     // all inline files together (base64 adds a third, the whole request must stay under 20 MB)
const fail = (message, status = 422) => Object.assign(new Error(message), { status })

export async function buildFileParts({ files, load, key, upload = uploadFile, remove = deleteFile, onProgress = () => {} }) {
  const parts = [], uploaded = []
  let inline = 0, total = 0
  const cleanup = async () => { await Promise.all(uploaded.map(name => Promise.resolve(remove({ key, name })).catch(() => {}))); uploaded.length = 0 }
  try {
    for (const [i, f] of files.entries()) {
      onProgress({ stage: 'files', i: i + 1, n: files.length })
      const { data: blob, error } = await load(f)
      if (error || !blob) throw fail(`Could not read ${f.name}.`)
      const cap = maxBytesFor(f.type)
      if (blob.size > cap) throw fail(`${f.name} is over ${mbText(cap)}.`)
      total += blob.size
      if (total > MAX_REQUEST_BYTES) throw fail(`Your files add up to more than ${mbText(MAX_REQUEST_BYTES)}. Remove some.`)
      const buf = Buffer.from(await blob.arrayBuffer())
      if (/\(video frames \d+\)/i.test(f.name)) parts.push({ text: `The next image is a contact sheet of frames taken from a lesson video (${f.name.replace(/\s*\(video frames \d+\)\.\w+$/i, '')}) each time the scene changed, in time order, with the time shown in each corner. Read the slides, text and diagrams in it. The sound of the video is not available, so do not guess what was said.` })
      if (f.type !== 'application/pdf' && !f.type.startsWith('image/')) { parts.push({ text: `File ${f.name}:\n${buf.toString('utf8').slice(0, 60000)}` }); continue }
      if (blob.size <= INLINE_ONE && inline + blob.size <= INLINE_BUDGET) {
        inline += blob.size
        parts.push({ inline_data: { mime_type: f.type, data: buf.toString('base64') } })
        continue
      }
      onProgress({ stage: 'upload', i: i + 1, n: files.length, name: f.name })
      const up = await upload({ key, bytes: buf, mime: f.type, name: f.name })
      uploaded.push(up.name)
      parts.push({ file_data: { mime_type: up.mime || f.type, file_uri: up.uri } })
    }
  } catch (e) { await cleanup(); throw e }
  return { parts, cleanup }
}
