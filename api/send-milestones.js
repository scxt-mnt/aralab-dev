// POST from the app right after a visit reaches a milestone (any signed-in student), or GET from the daily Vercel cron (CRON_SECRET).
// Sends the milestone e-mails that are waiting in the database. Safe to call any time: it only sends rows the database created, once each.
import { makeDb, supabaseUrl } from '../server/db.js'
import { pickMailer } from '../server/mailer.js'
import { sendPending } from '../server/milestones.js'

export default async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'GET or POST only.' })
  if (!supabaseUrl() || !process.env.SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Server is missing SUPABASE_SERVICE_ROLE_KEY.' })
  const db = makeDb()
  const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const cron = !!process.env.CRON_SECRET && bearer === process.env.CRON_SECRET
  if (!cron) {
    if (!bearer) return res.status(401).json({ error: 'Not signed in.' })
    const { data: u } = await db.auth.getUser(bearer)
    if (!u?.user) return res.status(401).json({ error: 'Not signed in.' })
  }
  try { return res.status(200).json(await sendPending({ db, mailer: pickMailer(), appUrl: process.env.APP_URL || '' })) }
  catch (e) { return res.status(502).json({ error: e.message }) }
}
