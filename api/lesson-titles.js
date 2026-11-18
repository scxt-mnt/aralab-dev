// Vercel serverless function (also served by `npm run dev`): the AI names Google Classroom lessons.
import { envProblem, makeDb } from '../server/db.js'
import { runTitles } from '../server/lessonTitles.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  const problem = envProblem()
  if (problem) return res.status(500).json({ error: problem })
  const r = await runTitles({ db: makeDb(), authHeader: req.headers.authorization, body: req.body })
  return res.status(r.status).json(r.body)
}
