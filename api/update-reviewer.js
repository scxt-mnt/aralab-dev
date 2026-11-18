// v75: refresh an old reviewer with AI. Only its author or an admin, only after 5 days, and only ever ADDING material.
// Vercel serverless function (also served by `npm run dev` through the Vite plugin). Secrets live in env vars.
import { envProblem, makeDb } from '../server/db.js'
import { respond } from '../server/stream.js'
import { runUpdate } from '../server/updateFlow.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const problem = envProblem()
  if (problem) return res.status(500).json({ error: problem })
  return respond(req, res, onProgress => runUpdate({ db: makeDb(), authHeader: req.headers.authorization, body: req.body, onProgress }))
}
