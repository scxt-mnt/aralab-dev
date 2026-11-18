// Shareable reviewer links (v65). A student copies https://<site>/r/<id>; this builds what other people see first:
//  - link previews in Messenger / WhatsApp / Telegram / Discord / Slack / X (they read the <meta> tags, they never run JavaScript), and
//  - the small "Shared with you" card on the sign-in screen (JSON).
// Only PUBLIC, not-removed reviewers get a real preview, and only the title, subject, contributor name and counts are shown.
// The notes themselves stay behind sign-in (the database rules are unchanged). A contributor who chose "Hide my name" is never named.
// v69: the picture in the preview is drawn per reviewer by /api/og (title, subject, counts), and a shared Challenge score link
// (/r/<id>?s=87&l=hard) gets a score card. The score is only a caption typed into a URL, so it is clamped and never trusted for anything else.
import { cleanScore, cleanLevel } from '../src/challengeLogic.js'
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t }

export const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)

// ?s=<0-100>&l=<easy|medium|hard> from a shared score link. Anything else is ignored.
export const parseScore = v => (v == null || String(v).trim() === '' ? null : cleanScore(v))
export const parseLevel = v => cleanLevel(String(v))
const LEVELS = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

// Address of the picture for a preview: the per-reviewer card, or the plain logo card when the reviewer is unknown / private.
export function imageUrl({ origin, id, info, score = null, level = '' }) {
  if (!info?.found || !validId(id)) return `${origin}/og.png`
  const q = [`id=${encodeURIComponent(id)}`]
  if (score != null) q.push(`s=${score}`)
  if (score != null && level) q.push(`l=${level}`)
  return `${origin}/api/og?${q.join('&')}`
}

// Absolute address of this site: APP_URL if set, otherwise the host the request came to.
export function originOf(headers = {}, appUrl = '') {
  const fixed = String(appUrl || '').trim().replace(/\/+$/, '')
  if (/^https?:\/\/[^\s/]+$/i.test(fixed)) return fixed
  const first = v => String(Array.isArray(v) ? v[0] : v || '').split(',')[0].trim()
  const host = first(headers['x-forwarded-host']) || first(headers.host) || 'localhost:3000'
  const proto = first(headers['x-forwarded-proto']) || (/^(localhost|127\.|192\.168\.|10\.)/.test(host) ? 'http' : 'https')
  return `${proto}://${host}`
}

// -> { found: false } | { found: true, id, title, subject, by, visitors, stars }
export async function loadShare(db, id) {
  if (!validId(id)) return { found: false }
  try {
    let r = await db.from('reviewers').select('id,title,subject,owner_id,is_public,hide_author,removed_at').eq('id', id).maybeSingle()
    if (r.error) r = await db.from('reviewers').select('id,title,subject,owner_id,is_public').eq('id', id).maybeSingle()   // older database: no hide_author / removed_at yet
    const row = r.data
    if (r.error || !row || row.is_public === false || row.removed_at) return { found: false }
    let by = null
    if (row.owner_id && !row.hide_author) {
      const p = await db.from('profiles').select('display_name').eq('user_id', row.owner_id).maybeSingle()
      by = clip(p.data?.display_name, 60) || null
    }
    const st = await db.from('reviewer_stats').select('visitors,stars').eq('reviewer_id', id).maybeSingle()     // missing before v48: just no numbers
    return { found: true, id: row.id, title: clip(row.title, 120) || 'Reviewer', subject: clip(row.subject, 60), by, visitors: +st.data?.visitors || 0, stars: +st.data?.stars || 0 }
  } catch { return { found: false } }
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// One line under the title, shared by the link preview and the sign-in card.
export function describe(info) {
  if (!info?.found) return 'Reviewers, study stats and your university guide in one calm place.'
  const bits = []
  if (info.subject && info.subject !== 'Unsorted') bits.push(`${info.subject} reviewer`)
  else bits.push('Study reviewer')
  if (info.by) bits[0] += ` by ${info.by}`
  if (info.visitors > 0) bits.push(`${plural(info.visitors, 'student has', 'students have')} studied it`)
  if (info.stars > 0) bits.push(plural(info.stars, 'star', 'stars'))
  return bits.join(' · ')
}

export function sharePage({ origin, id, info, score = null, level = '' }) {
  const found = !!info?.found
  const scored = found && score != null
  const title = scored ? `I scored ${score} pt on “${info.title}”` : found ? info.title : 'AraLab'
  const desc = scored ? `AraLab Challenge${LEVELS[level] ? ` · ${LEVELS[level]}` : ''} · Can you beat it?` : describe(info)
  const url = `${origin}/r/${encodeURIComponent(id)}${scored ? `?s=${score}${LEVELS[level] ? `&l=${level}` : ''}` : ''}`
  const image = imageUrl({ origin, id, info, score: scored ? score : null, level })
  const alt = scored ? `AraLab Challenge score: ${score} points on ${info.title}` : found ? `AraLab reviewer: ${info.title}` : 'AraLab'
  const go = `/?r=${encodeURIComponent(id)}`
  const meta = [
    ['name', 'description', desc],
    ['property', 'og:type', 'website'], ['property', 'og:site_name', 'AraLab'],
    ['property', 'og:title', title], ['property', 'og:description', desc], ['property', 'og:url', url],
    ['property', 'og:image', image], ['property', 'og:image:width', '1200'], ['property', 'og:image:height', '630'], ['property', 'og:image:alt', alt], ['property', 'og:image:type', 'image/png'],
    ['name', 'twitter:card', 'summary_large_image'], ['name', 'twitter:title', title], ['name', 'twitter:description', desc], ['name', 'twitter:image', image], ['name', 'twitter:image:alt', alt],
  ].map(([k, n, v]) => `<meta ${k}="${n}" content="${esc(v)}">`).join('\n')
  // People get sent on to the app by script; link-preview robots do not run scripts, so they stop here and read the tags above.
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · AraLab</title>
<meta name="robots" content="noindex">
${meta}
<script>location.replace(${JSON.stringify(go).replace(/</g, '\\u003c')})</script>
</head><body style="font:16px system-ui,sans-serif;padding:32px;color:#2a3350"><p>Opening <a href="${esc(go)}">${esc(title)}</a> in AraLab…</p></body></html>`
}
