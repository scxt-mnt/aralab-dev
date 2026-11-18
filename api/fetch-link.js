// Vercel serverless function (also served by `npm run dev`): downloads a link a student pasted and returns it as a file.
// Success -> the file's bytes (Content-Type = its type, X-File-Name = its name). Failure -> JSON { error }.
import { makeDb, supabaseUrl } from '../server/db.js'
import { runLink } from '../server/linkFetch.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' })
  if (!supabaseUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Server is missing environment variables (SUPABASE_SERVICE_ROLE_KEY).' })
  const r = await runLink({ db: makeDb(), authHeader: req.headers.authorization, body: req.body })
  if (r.error) return res.status(r.status).json({ error: r.error })
  const { name, type, bytes } = r.file
  res.statusCode = 200
  res.setHeader('Content-Type', type); res.setHeader('X-File-Name', encodeURIComponent(name)); res.setHeader('Cache-Control', 'no-store')
  for (let i = 0; i < bytes.length; i += 65536) res.write(bytes.subarray(i, i + 65536))      // written in pieces: a streamed answer is not held to the 4.5 MB limit of a single Vercel response
  res.end()
}
