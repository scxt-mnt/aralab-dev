// Reviewer share links (v65): https://<site>/r/<id>
// A visitor who is not signed in lands on the sign-in screen, signs in (Google sign-in leaves the page and comes back, and a
// confirmation e-mail opens a new tab), and the reviewer then opens by itself. So the id is kept in localStorage for 2 hours.

const KEY = 'rl-share', TTL = 2 * 3600 * 1000
export const validShareId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id)
export const shareUrl = (id, origin = location.origin) => `${origin}/r/${encodeURIComponent(id)}`
// A Challenge score link (v69): the same address plus the score and level, so the preview shows a score card. The app itself ignores them.
export const scoreUrl = (id, { score, level } = {}, origin = location.origin) => {
  const s = Math.min(100, Math.max(0, Math.round(Number(score)))), q = Number.isFinite(s) ? `?s=${s}${['easy', 'medium', 'hard'].includes(level) ? `&l=${level}` : ''}` : ''
  return `${shareUrl(id, origin)}${q}`
}
export const canShareReviewer = i => !!i && !i.removed_at && i.is_public !== false

// The id a page address carries: /r/<id> (what people share) or ?r=<id> (where the server preview page sends them).
export function incomingId(pathname = '', search = '') {
  const m = /^\/r\/([^/?#]+)\/?$/.exec(pathname)
  let id = ''
  try { id = m ? decodeURIComponent(m[1]) : new URLSearchParams(search).get('r') || '' } catch { id = '' }
  return validShareId(id) ? id : ''
}
export function stashIncoming(loc = location, hist = history) {
  const id = incomingId(loc.pathname, loc.search)
  if (!id) return ''
  try { localStorage.setItem(KEY, JSON.stringify({ id, t: Date.now() })) } catch { /* private mode: the link still opens if the student is already signed in, via the page address */ }
  try { hist.replaceState(null, '', '/' + (loc.hash || '')) } catch { /* ignore */ }        // tidy address bar: back to the plain app address
  return id
}
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); return v && validShareId(v.id) && Date.now() - v.t < TTL ? v.id : '' } catch { return '' } }
export const peekShared = () => read()                                                        // look without clearing (sign-in screen)
export const takeShared = () => { const id = read(); try { localStorage.removeItem(KEY) } catch { /* ignore */ } return id }   // read once, then forget (opens the reviewer)

// Phones: the system share sheet (WhatsApp, Messenger, Messages...). Computers: copy the link.
export async function shareReviewer(item, toast) {
  const url = shareUrl(item.id), text = `${item.title}${item.subject && item.subject !== 'Unsorted' ? ` · ${item.subject}` : ''} on AraLab`
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches
  if (touch && typeof navigator !== 'undefined' && navigator.share) {
    try { await navigator.share({ title: item.title, text, url }); return } catch (e) { if (e?.name === 'AbortError') return }   // any other failure: fall back to copying
  }
  const { copyText } = await import('./CopyButton')          // loaded when needed, so the helpers above stay plain JavaScript (the tests run them in Node)
  toast(await copyText(url) ? 'Link copied. Anyone you send it to sees a preview of this reviewer.' : `Copy this link: ${url}`)
}
