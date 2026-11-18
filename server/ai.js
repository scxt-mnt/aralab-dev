// The AI entry point every flow uses (generate, fix, screen, lesson titles): Gemini first, Groq as the safety net (v67).
// Groq is only tried when GROQ_API_KEY is set AND Gemini failed for a reason another AI could fix (quota, overload, timeout, bad key).
// Notes that are simply unusable (status 422: too thin, too big, blocked) are not retried on Groq.
import { generateJson as gemini } from './gemini.js'
import { groqJson, groqKey } from './groq.js'

const RESERVE_MS = 18000            // kept back for Groq so a slow Gemini round cannot eat the whole time budget
export const shouldFallback = e => e?.status !== 422
// v74: Groq's chat models cannot listen to audio. Transcription has its own Whisper fallback (server/transcribe.js),
// so an audio request must never be retried as text on Groq (that would produce invented words).
const hasAudio = parts => (parts || []).some(p => /^audio\//i.test(p?.inlineData?.mimeType || p?.inline_data?.mime_type || ''))

export async function generateJson(opts) {
  const { key, budgetMs = 55000, onProgress } = opts, run = opts.gemini || gemini, backup = opts.groq || groqJson, gk = opts.groqKey ?? groqKey()
  if (!gk || hasAudio(opts.parts)) return run(opts)
  const t0 = Date.now()
  if (!key) return backup({ ...opts, key: gk })                                    // no Gemini key at all: Groq only
  try { return await run({ ...opts, budgetMs: Math.max(12000, budgetMs - RESERVE_MS) }) }
  catch (e) {
    if (!shouldFallback(e)) throw e
    try { onProgress?.({ stage: 'ai', state: 'switch', model: 'gemini', reason: 'using the backup AI', next: 'groq' }) } catch { /* progress must never break generation */ }
    try { return await backup({ ...opts, key: gk, budgetMs: Math.max(10000, budgetMs - (Date.now() - t0)) }) }
    catch (g) { throw Object.assign(new Error(`${e.message} Backup AI: ${g.message}`), { status: g.status === 422 ? 422 : e.status || g.status || 503 }) }
  }
}
