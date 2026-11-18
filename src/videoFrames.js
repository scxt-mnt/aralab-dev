// Video lessons -> pictures (v61). Pure logic (no DOM) so it can be unit tested; the browser part is videoToSheets.js.
// Idea: look at the video every few seconds, compare each picture with the last KEPT one, and keep a frame only when the scene
// changed (a new slide, a new diagram, a new page of notes). The kept frames are tiled into a few "contact sheets" (2x2 frames per
// image) so a whole lecture still fits the 5-images-per-request limit. Only the pictures are read: the sound is not.

export const THUMB_W = 64, THUMB_H = 36                  // size of the tiny grey picture used to compare frames
export const PER_SHEET = 4                                // frames per contact sheet (2 x 2)
export const SHEETS_PER_VIDEO = 4                         // at most this many sheets (= 16 frames) per video
export const SCENE_THRESHOLD = 0.06                       // mean grey difference (0..1) that counts as "the scene changed"
export const MIN_GAP_S = 2                                // two kept frames are at least this far apart
export const MAX_LESSON_VIDEO = 300 * 1024 * 1024         // the browser downloads the whole video to read it: keep phones safe
export const MAX_VIDEO_SECONDS = 3 * 3600

// when to look: about every 3 s, but never fewer than 12 or more than 240 looks, spread evenly over the video
export function sampleTimes(duration, { every = 3, min = 12, max = 240 } = {}) {
  if (!Number.isFinite(duration) || duration <= 0) return []
  const n = Math.max(1, Math.min(max, Math.max(min, Math.ceil(duration / every))))
  const k = duration < 1 ? 1 : n
  return Array.from({ length: k }, (_, i) => +(Math.min(duration - 0.05, (i + 0.5) * duration / k)).toFixed(3)).map(t => Math.max(0, t))
}

// mean absolute difference of two equal-length grey pictures, 0 (same) .. 1 (opposite)
export function lumaDiff(a, b) {
  const n = Math.min(a?.length || 0, b?.length || 0)
  if (!n) return 0
  let s = 0
  for (let i = 0; i < n; i++) s += Math.abs(a[i] - b[i])
  return s / n / 255
}

// samples: [{ t, luma }] in time order -> [{ t, score }] the frames to keep, in time order.
// The first frame is always kept. If more scene changes are found than `max`, the biggest changes win.
export function pickKeyframes(samples, { threshold = SCENE_THRESHOLD, max = SHEETS_PER_VIDEO * PER_SHEET, minGap = MIN_GAP_S } = {}) {
  if (!samples?.length) return []
  const kept = [{ t: samples[0].t, score: 1, first: true }]
  let ref = samples[0].luma
  for (let i = 1; i < samples.length; i++) {
    const s = samples[i], d = lumaDiff(ref, s.luma)
    if (d > threshold && s.t - kept[kept.length - 1].t >= minGap) { kept.push({ t: s.t, score: d }); ref = s.luma }
  }
  if (kept.length <= max) return kept.map(({ t, score }) => ({ t, score }))
  const best = kept.slice(1).sort((a, b) => b.score - a.score).slice(0, max - 1)
  return [kept[0], ...best].sort((a, b) => a.t - b.t).map(({ t, score }) => ({ t, score }))
}

// n frames -> sheets of indices: [[0,1,2,3],[4,5,6,7],...]. When the last sheet would hold a single frame it is shared with the one before.
export function sheetsFor(n, perSheet = PER_SHEET) {
  const out = []
  for (let i = 0; i < n; i += perSheet) out.push(Array.from({ length: Math.min(perSheet, n - i) }, (_, k) => i + k))
  return out
}
export const gridFor = k => (k <= 1 ? { cols: 1, rows: 1 } : k === 2 ? { cols: 2, rows: 1 } : { cols: 2, rows: 2 })

export function fmtTime(s) {
  const t = Math.max(0, Math.round(Number(s) || 0)), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`
}
// RGBA pixels -> grey values (one per pixel)
export function toLuma(rgba) {
  const out = new Uint8Array(Math.floor(rgba.length / 4))
  for (let i = 0, j = 0; j < out.length; i += 4, j++) out[j] = (rgba[i] * 299 + rgba[i + 1] * 587 + rgba[i + 2] * 114) / 1000
  return out
}
