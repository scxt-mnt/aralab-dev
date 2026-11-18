// v80: fast path for opening a reviewer. The row is checked with the STUDENT's own sign-in (so database rules still decide who may see it),
// but the heavy part (content with pictures) is served from Redis when available.
//   GET /api/reviewer?id=<uuid>[&fresh=1]  -> { content, template, theme, is_public, html? }   (header X-Cache: HIT | MISS)
//   GET /api/reviewer?id=<uuid>&purge=1    -> drops the cached copy (after an edit)
import { createClient } from '@supabase/supabase-js'
import { supabaseUrl } from '../server/db.js'
import { cacheGet, cacheSet, cacheDel, reviewerKey } from '../server/cache.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const send = (res, status, body, extra = {}) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json'); for (const [k, v] of Object.entries(extra)) res.setHeader(k, v); res.end(JSON.stringify(body)) }

export default async function handler(req, res) {
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'GET only.' }) }
  const url = new URL(req.url || '/', 'http://local')
  const id = String(req.query?.id ?? url.searchParams.get('id') ?? '')
  const jwt = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  const anon = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!UUID.test(id)) return send(res, 400, { error: 'Bad id.' })
  if (!jwt) return send(res, 401, { error: 'Not signed in.' })
  if (!supabaseUrl() || !anon) return send(res, 503, { error: 'Server is not configured.' })
  const db = createClient(supabaseUrl(), anon, { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${jwt}` } } })
  try {
    // 1) may this student see it? (small query, row-level security applies)
    const { data: vis, error: visErr } = await db.from('reviewers').select('id').eq('id', id).maybeSingle()
    if (visErr) return send(res, 502, { error: visErr.message })
    if (!vis) return send(res, 404, { error: 'Not found.' })
    if (url.searchParams.get('purge') === '1') { await cacheDel(reviewerKey(id)); return send(res, 200, { ok: true }) }
    // 2) the heavy part: Redis first
    if (url.searchParams.get('fresh') !== '1') {
      const hit = await cacheGet(reviewerKey(id))
      if (hit) { res.setHeader('X-Cache', 'HIT'); res.setHeader('Cache-Control', 'private, max-age=30'); res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); return res.end(hit) }
    }
    let { data, error } = await db.from('reviewers').select('content,template,theme,is_public').eq('id', id).maybeSingle()
    if (error) return send(res, 502, { error: error.message })
    if (!data) return send(res, 404, { error: 'Not found.' })
    // only a hand-pasted page (no structured content) needs the stored html; everything else is drawn from `content`
    if (!data.content) { const h = await db.from('reviewers').select('html').eq('id', id).maybeSingle(); data = { ...data, html: h.data?.html || '' } }
    const body = JSON.stringify(data)
    await cacheSet(reviewerKey(id), body, 120)
    return send(res, 200, data, { 'X-Cache': 'MISS', 'Cache-Control': 'private, max-age=30' })
  } catch (e) { return send(res, 500, { error: String(e?.message || e) }) }
}
