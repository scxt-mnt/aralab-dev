// Public (no sign-in) on purpose: link-preview robots and signed-out visitors call it. It is read-only and only ever returns
// the title, subject, contributor name and counts of a PUBLIC reviewer (see server/share.js).
//   /r/<id>                      (rewritten here by vercel.json) -> small HTML page with the preview tags, then sends people into the app
//   /api/share?id=<id>&format=json -> { found, title, subject, by, visitors, stars } for the sign-in screen
//   /r/<id>?s=87&l=hard            -> the same page, but the preview is a Challenge score card (v69)
import { makeDb, supabaseUrl } from '../server/db.js'
import { loadShare, sharePage, validId, originOf, parseScore, parseLevel } from '../server/share.js'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); return res.end() }
  const url = new URL(req.url || '/', 'http://local')
  let id = req.query?.id ?? url.searchParams.get('id') ?? (url.pathname.match(/^\/r\/([^/]+)/) || [])[1] ?? ''
  if (Array.isArray(id)) id = id[0]
  id = String(id || '')
  const json = url.searchParams.get('format') === 'json'
  const one = k => { const v = req.query?.[k] ?? url.searchParams.get(k); return Array.isArray(v) ? v[0] : v }
  const score = parseScore(one('s')), level = parseLevel(one('l'))
  const info = validId(id) && supabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY ? await loadShare(makeDb(), id) : { found: false }
  // previews change slowly (counts): let the edge keep them for 5 minutes. A reviewer made private or removed disappears within that time.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600')
  if (json) {
    res.statusCode = info.found ? 200 : 404
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.end(JSON.stringify(info))
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(req.method === 'HEAD' ? undefined : sharePage({ origin: originOf(req.headers, process.env.APP_URL), id: validId(id) ? id : '', info, score, level }))
}
