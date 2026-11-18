// v80: optional Redis cache (Upstash / Vercel KV REST API: plain HTTPS, so it works in serverless functions).
// Set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or Vercel KV's KV_REST_API_URL + KV_REST_API_TOKEN). Without them every call is a no-op
// and the app simply reads from the database as before.
const url = () => (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').replace(/\/$/, '')
const token = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || ''
export const cacheOn = () => !!(url() && token())
export const MAX_CACHE_CHARS = 900_000          // Upstash's free plan accepts about 1 MB per request
export const reviewerKey = id => `rv:v1:${id}`

export async function cacheGet(key) {
  if (!cacheOn()) return null
  try {
    const r = await fetch(`${url()}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(1500) })
    if (!r.ok) return null
    const { result } = await r.json()
    return typeof result === 'string' ? result : null
  } catch { return null }
}
export async function cacheSet(key, value, ttl = 120) {
  if (!cacheOn() || typeof value !== 'string' || value.length > MAX_CACHE_CHARS) return false
  try {
    const r = await fetch(`${url()}/set/${encodeURIComponent(key)}?EX=${Math.max(1, ttl | 0)}`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: value, signal: AbortSignal.timeout(2500) })
    return r.ok
  } catch { return false }
}
export async function cacheDel(key) {
  if (!cacheOn()) return false
  try { return (await fetch(`${url()}/del/${encodeURIComponent(key)}`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, signal: AbortSignal.timeout(1500) })).ok } catch { return false }
}
