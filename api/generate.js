// Vercel serverless function (also served by `npm run dev` through the Vite plugin).
// Admins and the Astra member of the student's school can generate a request; the server checks the school.
// Secrets live in env vars, never in the browser.
import { envProblem, makeDb } from '../server/db.js'
import { respond } from '../server/stream.js'
import { runGenerate } from '../server/generateFlow.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const problem = envProblem()
  if (problem) return res.status(500).json({ error: problem })
  return respond(req, res, onProgress => runGenerate({ db: makeDb(), authHeader: req.headers.authorization, body: req.body, onProgress }))
}
