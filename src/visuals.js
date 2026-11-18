// v75: pictures in the reviewer. If the student asks for them, the pictures they already added (their own images and the
// slide pictures taken from a lesson video) are shrunk in the browser and travel with the generate call as data URIs.
// No new storage bucket, no expiring links: the reviewer stays one self-contained page that works forever.
import { visualMax } from './reviewSettings.js'
import { MAX_VISUALS } from './render.js'
import { documentPictures } from './docPictures.js'

export const VISUAL_EDGE = 900        // longest side of the stored picture (readable, still small)
export const VISUAL_QUALITY = 0.68
export const VISUAL_ONE_CHARS = 260_000  // one picture: about 190 KB after base64
export const VISUAL_TOTAL_CHARS = 1_100_000 // all pictures together: about 800 KB

const URI = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/
const isImage = f => /^image\/(jpeg|png|webp|gif|bmp|avif)$/i.test(String(f?.type || '')) || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(String(f?.name || ''))

// A short, human caption: "IMG_2043.jpg" -> "IMG 2043"; a contact sheet from a video -> "Video slide".
export function visualLabel(name, i = 0) {
  const s = String(name || '')
  if (/\(video frames \d+\)/i.test(s)) return 'Video slide'
  const base = s.replace(/\.[^.]+$/, '').replace(/[_\-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  return base || `Picture ${i + 1}`
}

// Which uploaded files can become pictures, in order (images only; video contact sheets are images already).
export function visualFiles(files) {
  return (Array.isArray(files) ? files : []).filter(isImage)
}

// How many pictures the chosen setting allows (0 / 4 / 8).
export function plannedVisuals(files, setting) {
  return visualFiles(files).slice(0, visualMax(setting))
}

// Keep the budget honest: skip a picture that would not fit instead of dropping the whole set.
export function fitVisualBudget(items, one = VISUAL_ONE_CHARS, total = VISUAL_TOTAL_CHARS) {
  const out = []
  let used = 0
  for (const it of Array.isArray(items) ? items : []) {
    const len = String(it?.url || '').length
    if (!len || len > one || used + len > total) continue
    used += len
    out.push(it)
  }
  return out
}

// The server trusts nothing: only real base64 images, inside the same caps the browser uses.
export function cleanVisualPayload(list, max = MAX_VISUALS) {
  const out = []
  let used = 0
  for (const v of Array.isArray(list) ? list : []) {
    const url = String(v?.url || '')
    if (!URI.test(url) || url.length > VISUAL_ONE_CHARS || used + url.length > VISUAL_TOTAL_CHARS) continue
    used += url.length
    out.push({ name: visualLabel(v?.name, out.length), url })
    if (out.length >= Math.min(MAX_VISUALS, max)) break
  }
  return out
}

// One picture -> a small JPEG data URI. Returns '' when the browser cannot read the format (e.g. some HEIC files).
export async function pictureDataUri(file, edge = VISUAL_EDGE, quality = VISUAL_QUALITY) {
  if (typeof document === 'undefined' || typeof createImageBitmap !== 'function') return ''
  let bmp
  try { bmp = await createImageBitmap(file) } catch { return '' }
  try {
    const k = Math.min(1, edge / Math.max(1, bmp.width, bmp.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(bmp.width * k))
    c.height = Math.max(1, Math.round(bmp.height * k))
    const g = c.getContext('2d')
    if (!g) return ''
    g.fillStyle = '#fff'                      // transparent PNGs get a readable background
    g.fillRect(0, 0, c.width, c.height)
    g.drawImage(bmp, 0, 0, c.width, c.height)
    return c.toDataURL('image/jpeg', quality)
  } catch { return '' } finally { try { bmp.close?.() } catch { /* ignore */ } }
}

// Build the pictures payload for a generation. Never throws: a picture that cannot be read is simply left out.
// v81: a tiny cover picture (360 px, ~15 KB) of the first picture, stored with the reviewer so Library cards show a preview.
export async function makeThumb(dataUri, edge = 360) {
  if (!dataUri || typeof document === 'undefined') return ''
  try {
    const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = dataUri })
    const k = Math.min(1, edge / Math.max(img.width, img.height)), c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k))
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height)
    const out = c.toDataURL('image/jpeg', 0.6)
    return out.length <= 40000 ? out : ''
  } catch { return '' }
}
export async function buildVisuals(files, setting, { onStep = () => {}, signal } = {}) {
  const max = visualMax(setting)
  if (!max) return []
  // the student's own images first, then pictures found inside their Word / PowerPoint / PDF files
  let list = plannedVisuals(files, setting)
  if (list.length < max) {
    try { list = [...list, ...await documentPictures(files, max - list.length, { onStep, signal })] } catch (e) { if (e?.cancelled) throw e }
  }
  if (!list.length) return []
  const made = []
  for (const [i, f] of list.entries()) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true })
    onStep(`Preparing picture ${i + 1} of ${list.length}…`)
    let uri = await pictureDataUri(f)
    if (uri && uri.length > VISUAL_ONE_CHARS) uri = await pictureDataUri(f, 760, 0.6)      // still too big: shrink harder once
    if (!uri) continue
    made.push({ name: visualLabel(f.name, i), url: uri })
  }
  return fitVisualBudget(made)
}
