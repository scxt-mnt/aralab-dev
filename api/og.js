// The picture behind a shared link (v69): GET /api/og?id=<reviewerId>[&s=<score>&l=<level>] -> a 1200x630 PNG.
// Public on purpose (link-preview robots call it, and they never sign in), so it follows the same rule as /api/share: only a PUBLIC,
// not-removed reviewer is drawn, and only its title, subject, contributor name and counts. Anything else gets the plain logo card.
import { makeDb, supabaseUrl } from '../server/db.js'
import { loadShare, validId, parseScore, parseLevel } from '../server/share.js'
import { renderOg } from '../server/ogImage.js'

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.setHeader('Allow', 'GET, HEAD'); return res.end() }
  const url = new URL(req.url || '/', 'http://local')
  const one = k => { const v = req.query?.[k] ?? url.searchParams.get(k); return Array.isArray(v) ? v[0] : v }
  const id = String(one('id') || '')
  const info = validId(id) && supabaseUrl() && process.env.SUPABASE_SERVICE_ROLE_KEY ? await loadShare(makeDb(), id) : { found: false }
  if (!info.found) {                                       // unknown or private: the static card, and do not cache the miss for long
    res.statusCode = 302; res.setHeader('Location', '/og.png'); res.setHeader('Cache-Control', 'public, s-maxage=60'); return res.end()
  }
  const score = parseScore(one('s')), level = parseLevel(one('l'))
  try {
    const png = await renderOg({ ...info, ...(score != null ? { score, level } : {}) })
    res.statusCode = 200
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Length', String(png.length))
    // pictures change slowly (counts): the edge keeps one for an hour; a reviewer made private falls back to the logo card within that time
    res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400')
    res.end(req.method === 'HEAD' ? undefined : png)
  } catch {
    res.statusCode = 302; res.setHeader('Location', '/og.png'); res.setHeader('Cache-Control', 'public, s-maxage=60'); res.end()
  }
}
