// Admin-only: shows which Gemini model the app auto-detected (and the fallbacks it would try next).
import { envProblem, makeDb } from '../server/db.js'
import { requireAdmin } from '../server/auth.js'
import { describeModels } from '../server/gemini.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' })
  const problem = envProblem()
  if (problem) return res.status(500).json({ error: problem })
  const auth = await requireAdmin(makeDb(), req.headers.authorization)
  if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message })
  try { return res.status(200).json(await describeModels(process.env.GEMINI_API_KEY)) }
  catch (e) { return res.status(e.status || 500).json({ error: e.message }) }
}
