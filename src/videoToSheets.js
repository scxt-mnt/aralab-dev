// Browser part of video lessons (v61): plays the video silently in a hidden <video>, finds the scene changes (videoFrames.js),
// and draws the kept frames onto a few JPEG contact sheets. Everything happens on the student's device; nothing is uploaded until the sheets exist.
import { THUMB_H, THUMB_W, MAX_VIDEO_SECONDS, PER_SHEET, fmtTime, gridFor, pickKeyframes, sampleTimes, sheetsFor, toLuma } from './videoFrames'

const SHEET_W = 1600, SHEET_H = 900
const fail = m => Object.assign(new Error(m), { video: true })

const once = (el, ok, ms, what) => new Promise((res, rej) => {
  const t = setTimeout(() => { cleanup(); rej(fail(what)) }, ms)
  const good = () => { cleanup(); res() }, bad = () => { cleanup(); rej(fail('This video can’t be played by your browser. Use an MP4 (H.264) video.')) }
  const cleanup = () => { clearTimeout(t); el.removeEventListener(ok, good); el.removeEventListener('error', bad) }
  el.addEventListener(ok, good); el.addEventListener('error', bad)
})
const seek = (v, t) => { const p = once(v, 'seeked', 10000, 'The video stopped responding while it was being read.'); v.currentTime = t; return p }
const jpeg = (canvas, q) => new Promise(res => canvas.toBlob(res, 'image/jpeg', q))

// blob (the video) -> { files: File[], frames, seconds }. onStep(text) reports progress. Throws an Error with a sentence the student can act on.
export async function videoToSheets(blob, { name = 'video', maxSheets = 4, onStep = () => {}, signal } = {}) {
  const stop = () => { if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true }) }
  const url = URL.createObjectURL(blob), v = document.createElement('video')
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url
  try {
    await once(v, 'loadedmetadata', 25000, 'The video took too long to open.')
    const dur = v.duration
    if (!Number.isFinite(dur) || dur <= 0 || !v.videoWidth) throw fail('This video can’t be played by your browser. Use an MP4 (H.264) video.')
    if (dur > MAX_VIDEO_SECONDS) throw fail(`This video is longer than ${MAX_VIDEO_SECONDS / 3600} hours.`)

    // 1) look every few seconds at a tiny grey picture
    const small = document.createElement('canvas'); small.width = THUMB_W; small.height = THUMB_H
    const sx = small.getContext('2d', { willReadFrequently: true })
    const times = sampleTimes(dur), samples = []
    for (let i = 0; i < times.length; i++) {
      stop()
      await seek(v, times[i])
      sx.drawImage(v, 0, 0, THUMB_W, THUMB_H)
      samples.push({ t: times[i], luma: toLuma(sx.getImageData(0, 0, THUMB_W, THUMB_H).data) })
      if (i % 4 === 0) onStep(`Looking for slide changes in ${name} (${i + 1}/${times.length})…`, (i / times.length) * 60)
    }
    const keys = pickKeyframes(samples, { max: Math.max(1, maxSheets) * PER_SHEET })

    // 2) draw the kept frames sharply, 4 per sheet, with their time in the corner
    const groups = sheetsFor(keys.length), base = String(name).replace(/\.[^.]+$/, '').slice(0, 60) || 'video'
    const files = []
    for (const [gi, group] of groups.entries()) {
      stop()
      onStep(`Building picture ${gi + 1}/${groups.length} from ${name}…`, 60 + (30 * gi) / groups.length)
      const { cols, rows } = gridFor(group.length), cw = SHEET_W / cols, ch = SHEET_H / rows
      const c = document.createElement('canvas'); c.width = group.length === 1 ? 1280 : SHEET_W; c.height = group.length === 1 ? 720 : group.length === 2 ? SHEET_H / 2 : SHEET_H
      const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height)
      const tw = c.width / cols, th = c.height / rows
      for (const [k, idx] of group.entries()) {
        const t = keys[idx].t
        await seek(v, idx === 0 ? 0 : Math.min(dur - 0.05, t + 0.3))        // a moment after the change, so a fade has finished
        const r = Math.min(tw / v.videoWidth, th / v.videoHeight), w = v.videoWidth * r, h = v.videoHeight * r
        const x = (k % cols) * tw + (tw - w) / 2, y = Math.floor(k / cols) * th + (th - h) / 2
        cx.drawImage(v, x, y, w, h)
        const label = fmtTime(t); cx.font = 'bold 22px sans-serif'
        const lw = cx.measureText(label).width + 14
        cx.fillStyle = 'rgba(0,0,0,.65)'; cx.fillRect(x + 6, y + 6, lw, 30); cx.fillStyle = '#fff'; cx.fillText(label, x + 13, y + 28)
        cx.strokeStyle = '#999'; cx.lineWidth = 1; cx.strokeRect((k % cols) * tw, Math.floor(k / cols) * th, tw, th)
      }
      let q = 0.85, out = await jpeg(c, q)
      while (out && out.size > 3.5 * 1024 * 1024 && q > 0.45) { q -= 0.15; out = await jpeg(c, q) }       // each sheet must stay small enough to send inline
      if (!out) throw fail('Could not build pictures from this video.')
      files.push(new File([out], `${base} (video frames ${gi + 1}).jpg`, { type: 'image/jpeg' }))
    }
    return { files, frames: keys.length, seconds: dur }
  } finally {
    URL.revokeObjectURL(url); v.removeAttribute('src'); try { v.load() } catch { /* ignore */ }
  }
}
