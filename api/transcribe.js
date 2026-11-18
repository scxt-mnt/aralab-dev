// Vercel serverless function (also served by `npm run dev`): one 90-second piece of audio -> transcript text.
// Signed-in students only; the body is capped so a big upload cannot reach the AI.
import { envProblem, makeDb } from '../server/db.js'
import { requireUser } from '../server/auth.js'
import { MAX_AUDIO_B64, transcribeChunk } from '../server/transcribe.js'

export const config = { api: { bodyParser: { sizeLimit: '4.5mb' } } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const problem = envProblem()
  if (problem) return res.status(500).json({ error: problem })

  const who = await requireUser(makeDb(), req.headers.authorization)
  if (who.error) return res.status(who.error.status).json({ error: who.error.message })

  const { mime, data } = req.body || {}
  if (typeof data !== 'string' || !data) return res.status(400).json({ error: 'No audio was sent.' })
  if (data.length > MAX_AUDIO_B64) return res.status(413).json({ error: 'That piece of audio is too big.' })

  try {
    const out = await transcribeChunk({ audio: data, mime })
    return res.status(200).json({ text: out.text, model: out.model })
  } catch (e) {
    return res.status(e.status || 502).json({ error: e.message || 'The AI could not read this audio.' })
  }
}
