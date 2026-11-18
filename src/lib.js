import { withDarkMode } from './render.js'
export const NONE = 'Unsorted'
// `text` (up to 30 KB per reviewer) is NOT loaded at login any more: it is fetched only when someone searches (see App.jsx).
export const META = 'id,title,subject,size,added,is_public,owner_id'
export const META_V80 = META + ',removed_at,removed_reason,thumb,preview'      // v81: a small cover picture per reviewer; App falls back until the v81 SQL is run
export const META_V47 = META + ',removed_at,removed_reason'     // v47 columns; App falls back to META until the v47 SQL is run
// Locks a reviewer page down: no network requests, no forms, no nested frames. Inline scripts/styles and images still work.
const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https:; img-src data: blob: https:; font-src data: https:; media-src data: blob:; form-action 'none'; base-uri 'none'"
export const withCsp = html => `<meta http-equiv="Content-Security-Policy" content="${CSP}">${html || ''}`
// What the reader puts in the frame: the CSP, plus dark mode. Pages made by AraLab (they carry the data-mode rule) are marked dark up front, so there is no
// light flash, and are switched live by a message afterwards. An old or pasted page that has no dark rule gets a safe colour inversion instead
// (pictures and video are turned back so they look normal).
const LEGACY_DARK = '<style>html{background:#fff;filter:invert(1) hue-rotate(180deg)}img,video,picture,canvas,svg image{filter:invert(1) hue-rotate(180deg)}</style>'
export const supportsDark = html => /html\[data-mode=dark\]/.test(html || '')
export const prepareReviewer = (html, { dark = false } = {}) => {
  let h = html || ''
  if (dark) h = supportsDark(h) ? withDarkMode(h) : LEGACY_DARK + h
  return withCsp(h)
}
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
const hue = s => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360; return h }
export const color = s => `hsl(${hue(s)} 70% 62%)`
export const fmtSize = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB'
export const fmtTime = s => s < 60 ? s + 's' : s < 3600 ? Math.round(s / 60) + 'm' : (s / 3600).toFixed(1) + 'h'
export function analyse(html, fallback) {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const title = (doc.title || '').trim() || (doc.querySelector('h1')?.textContent || '').trim() || fallback
  doc.querySelectorAll('script,style,noscript').forEach(n => n.remove())
  const text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30000).toLowerCase()
  return { title: title.slice(0, 160), text }
}
