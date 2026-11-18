// v74: write down a piece of audio with our own AI (Gemini first, Groq as the safety net).
// The browser sends 90-second mono WAV pieces, because a serverless request is limited to about 4.5 MB.
// The prompt asks for JSON (the AI client always answers in JSON), and only the words are kept.
import { generateJson } from './ai.js'
import { parseJsonLoose } from './gemini.js'
import { groqKey } from './groq.js'

export const MAX_AUDIO_B64 = 4_200_000          // ~3.1 MB of WAV: under the 4.5 MB request limit once JSON/base64 is added
export const AUDIO_MIME = /^audio\/(wav|x-wav|mpeg|mp3|mp4|aac|ogg|webm|flac)$/i
export const GROQ_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'
export const groqModel = () => String(process.env.GROQ_WHISPER_MODEL || 'whisper-large-v3-turbo')

export const SYSTEM = [
  'You transcribe class recordings for students.',
  'Return ONLY JSON shaped like {"transcript":"..."} with the words that are actually spoken.',
  'Write them in the language spoken, with normal punctuation and sentence breaks.',
  'Do not summarise, translate, shorten, add headings, timestamps or commentary.',
  'Ignore music, noise, silence and non-speech sounds.',
  'If there is no speech at all, return {"transcript":""}.',
].join(' ')

const fail = (message, status = 400) => Object.assign(new Error(message), { status })

// Groq Whisper can listen to audio (its chat models cannot). Used when Gemini fails or when only GROQ_API_KEY is set.
export async function groqTranscribe({ audio, mime = 'audio/wav', key = groqKey(), fetchImpl = fetch, budgetMs = 45000 } = {}) {
  if (!key) throw fail('Transcription is not switched on yet (no AI key).', 503)
  const form = new FormData()
  form.append('file', new Blob([Buffer.from(audio, 'base64')], { type: mime }), 'audio.wav')
  form.append('model', groqModel())
  form.append('response_format', 'json')
  form.append('temperature', '0')
  let r
  try {
    r = await fetchImpl(GROQ_URL, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(budgetMs) })
  } catch (e) {
    throw fail(`The backup AI could not be reached (${e?.message || 'network error'}).`, 503)
  }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    const msg = j?.error?.message || `HTTP ${r.status}`
    throw fail(/api key|invalid|unauthor/i.test(msg) ? 'The Groq API key was rejected.' : `The backup AI could not read this audio (${msg.slice(0, 120)}).`, r.status === 429 ? 429 : 502)
  }
  if (typeof j.text !== 'string') throw fail('The backup AI did not return a transcript.', 502)
  return { text: tidy(j.text), model: `groq:${groqModel()}` }
}

// One piece of audio -> { text, model }. `ai` / `groq` are injected so tests never call a real model.
export async function transcribeChunk({
  audio, mime = 'audio/wav', key = process.env.GEMINI_API_KEY,
  ai = generateJson, groq = groqTranscribe, budgetMs = 50000, onProgress,
} = {}) {
  if (typeof audio !== 'string' || !audio) throw fail('No audio was sent.', 400)
  if (audio.length > MAX_AUDIO_B64) throw fail('That piece of audio is too big.', 413)
  if (!AUDIO_MIME.test(String(mime || ''))) throw fail('That is not an audio format AraLab can read.', 415)
  const gk = groqKey()
  if (!key && !gk) throw fail('Transcription is not switched on yet (no AI key).', 503)

  const parts = [
    { inlineData: { mimeType: mime, data: audio } },
    { text: 'Transcribe this recording.' },
  ]
  const readAnswer = text => {
    const o = parseJsonLoose(text)
    if (typeof o?.transcript !== 'string') throw new Error('The AI did not return a transcript.')
    return o
  }
  let firstErr = null
  if (key) {
    try {
      const out = await ai({
        key, system: SYSTEM, parts, budgetMs, maxOutputTokens: 4096, onProgress,
        validate: readAnswer,
      })
      let parsed
      try { parsed = readAnswer(out.text) } catch (e) { throw fail(e.message, 502) }
      return { text: tidy(parsed.transcript), model: out.model || '' }
    } catch (e) {
      firstErr = e
      if (!gk) throw e
    }
  }
  try {
    return await groq({ audio, mime, key: gk, budgetMs })
  } catch (e) {
    throw fail(firstErr ? `${firstErr.message} Backup AI: ${e.message}` : e.message, e.status || firstErr?.status || 502)
  }
}

// Keep the words, drop stray spaces; empty (silence) is allowed.
function tidy(text) {
  return String(text || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
