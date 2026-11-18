// v78: real pictures from the student's own documents, so the reviewer is not plain text.
//  - Word / PowerPoint / Excel / OpenDocument files: the embedded images are unpacked (biggest first, tiny icons skipped).
//  - PDFs: the pages that really contain a picture are drawn (pdf.js is loaded only when a PDF needs it).
// Everything runs in the browser; the originals never leave the device through this code.
import { unzipSync } from 'fflate'

const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
const OFFICE = /\.(docx|pptx|xlsx|odt|odp|ods)$/i
const MEDIA = /(^|\/)(media|Pictures)\/[^/]+\.(jpe?g|png|webp|gif)$/i
const MIN_BYTES = 8000                 // logos, bullets and icons are smaller than this
const stop = signal => { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true }) }

export async function officeImages(file, max = 4) {
  try {
    const u8 = new Uint8Array(await file.arrayBuffer())
    const got = unzipSync(u8, { filter: e => MEDIA.test(e.name) && e.originalSize >= MIN_BYTES && e.originalSize < 8_000_000 })
    return Object.entries(got)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, max)
      .map(([name, bytes], i) => new File([bytes], `${(file.name || 'file').replace(/\.[^.]+$/, '')} picture ${i + 1}.${name.split('.').pop().toLowerCase()}`, { type: MIME[name.split('.').pop().toLowerCase()] || 'image/jpeg' }))
  } catch { return [] }
}

export async function pdfPictures(file, max = 4, { signal, onStep = () => {} } = {}) {
  if (typeof document === 'undefined') return []
  try {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
    const out = [], last = Math.min(doc.numPages, 60), base = (file.name || 'notes').replace(/\.[^.]+$/, '')
    for (let n = 1; n <= last && out.length < max; n++) {
      stop(signal)
      onStep(`Looking for pictures in ${file.name} (page ${n}/${last})…`)
      const page = await doc.getPage(n)
      const ops = await page.getOperatorList()
      const hasImage = ops.fnArray.some(f => f === pdfjs.OPS.paintImageXObject || f === pdfjs.OPS.paintInlineImageXObject)
      if (!hasImage) continue
      const vp0 = page.getViewport({ scale: 1 }), vp = page.getViewport({ scale: Math.min(2, 1000 / Math.max(vp0.width, vp0.height)) })
      const c = document.createElement('canvas')
      c.width = Math.round(vp.width); c.height = Math.round(vp.height)
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise
      const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.8))
      if (blob) out.push(new File([blob], `${base} page ${n}.jpg`, { type: 'image/jpeg' }))
    }
    try { await doc.destroy() } catch { /* ignore */ }
    return out
  } catch (e) { if (e?.cancelled) throw e; return [] }
}

// Pictures found inside the given files (uses the pre-conversion original when a file was turned into text).
export async function documentPictures(files, max, opts = {}) {
  const out = []
  for (const f of Array.isArray(files) ? files : []) {
    if (out.length >= max) break
    stop(opts.signal)
    const src = f?.original || f
    const room = max - out.length
    if (OFFICE.test(src?.name || '')) out.push(...await officeImages(src, room))
    else if (/\.pdf$/i.test(src?.name || '') || src?.type === 'application/pdf') out.push(...await pdfPictures(src, room, opts))
  }
  return out.slice(0, max)
}
