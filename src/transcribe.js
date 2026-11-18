// v74: a video's audio -> a written transcript, without the student copying captions.
// The browser decodes the audio track (already at 16 kHz, so memory stays small), mixes it to mono, and sends it
// to our own AI in short pieces. Why pieces: a serverless request may only carry about 4.5 MB, so 90 s of 16 kHz
// mono WAV (2.8 MB) is one piece. The pieces come back in order and are joined, so a long lecture still works.
//
// Honest limits: decoding happens in the browser. Above MAX_MEDIA_SECONDS the student is asked to paste instead.
// YouTube links cannot be read at all (we never get their audio).

export const SAMPLE_RATE = 16000
export const CHUNK_SECONDS = 90
export const MAX_MEDIA_SECONDS = 30 * 60
export const MAX_MOBILE_SECONDS = 10 * 60
export const MAX_MEDIA_BYTES = 250 * 1024 * 1024
export const AUDIO_EXT = /\.(mp4|m4v|webm|mov|mkv|mp3|m4a|aac|wav|ogg|oga|opus|flac)$/i

export const isMediaName = name => AUDIO_EXT.test(String(name || ''))
export const maxMediaSeconds = () => (typeof navigator !== 'undefined' && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent) ? MAX_MOBILE_SECONDS : MAX_MEDIA_SECONDS)

const fail = (message, extra = {}) => Object.assign(new Error(message), extra)

// 0..n pieces of at most `chunkSeconds`, in order. Pure, so it is easy to test.
export function planChunks(totalSeconds, chunkSeconds = CHUNK_SECONDS) {
  const total = Math.max(0, +totalSeconds || 0), size = Math.max(1, +chunkSeconds || CHUNK_SECONDS)
  const n = Math.ceil(total / size)
  return Array.from({ length: n }, (_, i) => ({ index: i, start: i * size, end: Math.min(total, (i + 1) * size) }))
}

// Float samples -> signed 16-bit PCM, clipped so a loud recording cannot wrap around.
export function pcm16(samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, +samples[i] || 0))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

// A complete mono WAV file (44-byte header + PCM), ready to send.
export function wavBytes(samples, sampleRate = SAMPLE_RATE) {
  const pcm = pcm16(samples), bytes = new Uint8Array(44 + pcm.length * 2), v = new DataView(bytes.buffer)
  const str = (at, s) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i) }
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE')
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true)
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true)
  new Uint8Array(bytes.buffer, 44).set(new Uint8Array(pcm.buffer))
  return bytes
}

// base64 without blowing the call stack on a 3 MB buffer
export function b64(u8) {
  let s = ''
  const step = 0x8000
  for (let i = 0; i < u8.length; i += step) s += String.fromCharCode.apply(null, u8.subarray(i, i + step))
  return btoa(s)
}

// Pieces -> one transcript. Empty pieces (silence) are dropped; the rest keep their paragraph breaks.
export function mergeTranscripts(list) {
  return (Array.isArray(list) ? list : []).map(t => String(t || '').trim()).filter(Boolean).join('\n\n')
}

// Every channel -> one, for one window of the buffer (so a 30-minute lecture never needs a second full-size copy).
// Pure, and it accepts anything shaped like an AudioBuffer.
export function toMono(buffer, from = 0, to = buffer.length) {
  const a = Math.max(0, Math.min(buffer.length, Math.round(from)))
  const b = Math.max(a, Math.min(buffer.length, Math.round(to)))
  const n = b - a, ch = Math.max(1, buffer.numberOfChannels || 1), out = new Float32Array(n)
  if (!n) return out
  if (ch === 1) { out.set(buffer.getChannelData(0).subarray(a, b)); return out }
  for (let c = 0; c < ch; c++) {
    const data = buffer.getChannelData(c)
    for (let i = 0; i < n; i++) out[i] += (data[a + i] || 0) / ch
  }
  return out
}

// Linear resample, only used when the browser ignores the 16 kHz request.
export function resampleLinear(samples, from, to) {
  if (!samples || !samples.length || !from || !to || from === to) return samples
  const n = Math.max(1, Math.round(samples.length * to / from)), out = new Float32Array(n), step = from / to
  for (let i = 0; i < n; i++) {
    const x = i * step, a = Math.floor(x), b = Math.min(samples.length - 1, a + 1)
    out[i] = samples[a] + (samples[b] - samples[a]) * (x - a)
  }
  return out
}

// Decode the audio track once. The context asks for 16 kHz, so the browser resamples while decoding
// (much smaller than the original) and we only mix one 90-second window at a time.
async function decodeAudio(blob) {
  const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)
  if (!Ctx) throw fail('This browser cannot read audio from a video. Paste the transcript instead.', { media: true })
  let ctx
  try { ctx = new Ctx({ sampleRate: SAMPLE_RATE }) } catch { ctx = new Ctx() }
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer())
  } catch {
    throw fail('This video’s audio could not be read (some MP4s use a codec the browser cannot decode). Paste the transcript instead.', { media: true })
  } finally { try { ctx.close() } catch { /* ignore */ } }
}

async function postPiece(payload, token, fetchImpl, signal) {
  const res = await fetchImpl('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
    signal,
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = new Error(body.error || `The AI could not read this part of the audio (${res.status}).`)
    e.status = res.status
    e.api = true
    throw e
  }
  return body
}

// video/audio Blob -> transcript text. onStep(text) reports progress to the screen.
export async function transcribeMedia(blob, { token, onStep = () => {}, fetchImpl = fetch, signal, chunkSeconds = CHUNK_SECONDS } = {}) {
  if (!blob || !blob.size) throw fail('There is no audio to read.', { media: true })
  if (blob.size > MAX_MEDIA_BYTES) throw fail(`This video is over ${Math.round(MAX_MEDIA_BYTES / 1048576)} MB, too big to read in the browser. Paste the transcript instead.`, { media: true })
  if (!token) throw fail('Sign in again, then try transcribing.', { media: true })

  onStep('Listening to the video…')
  const audio = await decodeAudio(blob)
  const rate = audio.sampleRate || SAMPLE_RATE
  const duration = audio.duration || audio.length / rate
  const limit = maxMediaSeconds()
  if (duration > limit + 1) {
    throw fail(`This video is ${Math.round(duration / 60)} minutes long. AraLab can listen to the first ${Math.round(limit / 60)} minutes on this device; for longer ones paste the transcript.`, { media: true })
  }

  const chunks = planChunks(duration, chunkSeconds)
  const parts = []
  for (const c of chunks) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true })
    onStep(chunks.length > 1 ? `Writing down the audio (${c.index + 1}/${chunks.length})…` : 'Writing down the audio…', (c.index / chunks.length) * 100)
    // mix just this window to mono (a long lecture never needs one huge mono copy), then make sure it is 16 kHz
    let mono = toMono(audio, c.start * rate, c.end * rate)
    if (rate !== SAMPLE_RATE) mono = resampleLinear(mono, rate, SAMPLE_RATE)
    const payload = { mime: 'audio/wav', data: b64(wavBytes(mono)), seconds: Math.round(c.end - c.start) }
    let body
    try { body = await postPiece(payload, token, fetchImpl, signal) }
    catch (e) {
      if (e.name === 'AbortError' || e.status === 401) throw e
      // one retry: a long recording can hit a short rate limit between pieces
      await new Promise(r => setTimeout(r, 1500))
      body = await postPiece(payload, token, fetchImpl, signal)
    }
    parts.push(body.text || '')
  }
  return mergeTranscripts(parts)
}
