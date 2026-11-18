// Vercel serverless function (also served by `npm run dev` through the Vite plugin).
// Admins and the Astra member of the flagging student's school may approve a flag and fix the reviewer with AI.
// Secrets live in env vars, never in the browser.
import { envProblem, makeDb } from '../server/db.js'
import { respond } from '../server/stream.js'
import { runFix } from '../server/fixFlow.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const problem = envProblem()
  if (problem) return res.status(500).json({ error: problem })
  return respond(req, res, onProgress => runFix({ db: makeDb(), authHeader: req.headers.authorization, body: req.body, onProgress }))
}
