// Chunked uploads: a file is cut into 1 MB pieces (name.part000, name.part001 ...), uploaded 3 at a time, each piece retried
// with back-off. A flaky connection only repeats the small piece that failed, not the whole file. Pure helpers: they take
// the Supabase storage bucket API, so the browser and the server (generate flow) share them.
export const CHUNK = 1024 * 1024
export const MAX_PARTS = 30                                  // 25 MB files / 1 MB pieces, with headroom
export const partPath = (path, i) => `${path}.part${String(i).padStart(3, '0')}`
export const pathsOf = f => (f.parts ? Array.from({ length: f.parts }, (_, i) => partPath(f.path, i)) : [f.path])   // every storage object of a file (for deleting)
const wait = ms => new Promise(r => setTimeout(r, ms))
const exists = e => /already exists|duplicate|resource already/i.test(String(e?.message || e)) || e?.statusCode === '409' || e?.status === 409

// bucket = sb.storage.from('notes'). onPiece(bytes) fires after each finished piece. Returns { parts }.
export async function uploadChunked(bucket, path, file, { onPiece = () => {}, concurrency = 3, retries = 3, sleep = wait } = {}) {
  const parts = Math.max(1, Math.ceil(file.size / CHUNK)), done = []
  let next = 0, failed = null
  const send = async i => {
    const blob = file.slice(i * CHUNK, (i + 1) * CHUNK)
    for (let a = 0; ; a++) {
      const { error } = await bucket.upload(partPath(path, i), blob, { contentType: 'application/octet-stream' })
      if (!error || exists(error)) break                      // a piece that already exists was uploaded completely earlier: keep it
      if (a >= retries) throw new Error(`Upload of “${file.name}” failed at piece ${i + 1}/${parts}: ${error.message}`)
      await sleep(600 * 2 ** a)                               // 0.6s, 1.2s, 2.4s
    }
    done.push(i); onPiece(blob.size)
  }
  const worker = async () => { while (!failed) { const i = next++; if (i >= parts) return; try { await send(i) } catch (e) { failed = e } } }
  await Promise.all(Array.from({ length: Math.min(concurrency, parts) }, worker))
  if (failed) { await bucket.remove(pathsOf({ path, parts })).catch(() => {}); throw failed }   // never leave half a file behind
  return { parts }
}

// Whole file as a Blob (joins the pieces; also works for old single-object uploads). Same { data, error } shape as storage.download.
export async function downloadFile(bucket, f) {
  if (!f.parts) return bucket.download(f.path)
  const list = []
  for (const p of pathsOf(f)) { const { data, error } = await bucket.download(p); if (error || !data) return { data: null, error: error || new Error('missing piece') }; list.push(data) }
  return { data: new Blob(list, { type: f.type || 'application/octet-stream' }), error: null }
}

// URL the browser can open for a stored file (signed link, or a temporary blob URL when the file is in pieces)
export async function openUrl(bucket, f) {
  if (!f.parts) { const { data, error } = await bucket.createSignedUrl(f.path, 300); if (error) throw error; return data.signedUrl }
  const { data, error } = await downloadFile(bucket, f); if (error) throw error
  return URL.createObjectURL(data)
}
