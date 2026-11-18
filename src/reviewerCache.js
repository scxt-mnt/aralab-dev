// v80: opening a reviewer is instant the second time (and usually the first, thanks to prefetch on hover / touch).
//  1. a small in-memory cache of the last reviewers opened in this tab,
//  2. /api/reviewer (Redis behind it, row-level security in front of it),
//  3. a plain database read if that function is not deployed or fails.
import { sb } from './supabase'

const mem = new Map(), inflight = new Map(), MAX = 12
const remember = (id, rec) => { mem.delete(id); mem.set(id, rec); while (mem.size > MAX) mem.delete(mem.keys().next().value) }

export const peekReviewer = id => mem.get(id) || null
export const dropReviewer = id => { mem.delete(id) }
export const purgeReviewer = async id => {
  dropReviewer(id)
  try { const { data } = await sb.auth.getSession(); await fetch(`/api/reviewer?id=${encodeURIComponent(id)}&purge=1`, { headers: { Authorization: `Bearer ${data.session?.access_token}` } }) } catch { /* best effort */ }
}

async function fetchRec(id, fresh) {
  try {
    const { data: s } = await sb.auth.getSession()
    if (s.session?.access_token) {
      const r = await fetch(`/api/reviewer?id=${encodeURIComponent(id)}${fresh ? '&fresh=1' : ''}`, { headers: { Authorization: `Bearer ${s.session.access_token}` } })
      if (r.ok) return await r.json()
      if (r.status === 404) return { html: '' }
    }
  } catch { /* fall through to the database */ }
  let { data, error } = await sb.from('reviewers').select('content,template,theme,is_public').eq('id', id).maybeSingle()
  if (error) throw error
  if (data && !data.content) { const h = await sb.from('reviewers').select('html').eq('id', id).maybeSingle(); data = { ...data, html: h.data?.html || '' } }   // html only for hand-pasted pages
  return data || { html: '' }
}

export function loadReviewerRec(id, { fresh = false } = {}) {
  if (!fresh && mem.has(id)) return Promise.resolve(mem.get(id))
  const key = `${id}:${fresh ? 1 : 0}`
  if (!inflight.has(key)) inflight.set(key, fetchRec(id, fresh).then(rec => { remember(id, rec); return rec }).finally(() => inflight.delete(key)))
  return inflight.get(key)
}
export const prefetchReviewer = id => { if (id && !mem.has(id)) loadReviewerRec(id).catch(() => {}) }
