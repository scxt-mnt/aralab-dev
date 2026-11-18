// POST (admin button) or GET (Vercel cron, weekly): pull the latest state universities from the public API into the database.
import { makeDb, supabaseUrl } from '../server/db.js'
import { requireAdmin } from '../server/auth.js'
import { syncUniversities } from '../server/universities.js'

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'GET or POST only.' })
  if (!supabaseUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' })
  const db = makeDb()
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const cron = !!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET     // Vercel cron sends this header
  if (!cron) { const auth = await requireAdmin(db, req.headers.authorization); if (auth.error) return res.status(auth.error.status).json({ error: auth.error.message }) }
  try { return res.status(200).json(await syncUniversities({ db })) }
  catch (e) { return res.status(502).json({ error: e.message }) }
}
