// Links (v63): the pure part (no network), shared by the browser and the server so it can be tested.
// A student pastes a link in "Create reviewer"; the SERVER downloads it (browsers are not allowed to read other sites) and the result
// becomes a normal file in the request. This file decides what kind of link it is and where to download it from.
export const MAX_LINK_CHARS = 2000

// "docs.google.com/..." or "https://..." -> a clean https URL, or null when it is not a web link
export function normalizeUrl(input) {
  let s = String(input || '').trim().replace(/^<|>$/g, '')
  if (!s || /\s/.test(s) || s.length > MAX_LINK_CHARS) return null
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) { if (/^[a-z0-9-]+(\.[a-z0-9-]+)+([/?#:]|$)/i.test(s)) s = 'https://' + s; else return null }
  let u; try { u = new URL(s) } catch { return null }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null
  if (!u.hostname.includes('.') && !u.hostname.startsWith('[')) return null
  return u.href
}

export const CANVA_MSG = 'Canva doesn’t let other apps read a design from its link, so AraLab can’t download this one. In Canva choose Share > Download > PDF Standard (or PNG), then add that file here.'
export const GOOGLE_SHARE_MSG = 'This Google file isn’t shared. Open it, choose Share > General access > “Anyone with the link” (Viewer), then paste the link again.'
export const NO_TEXT_MSG = 'This page has no readable text (it may need a login, or it loads its content with JavaScript). Save it as a PDF, or copy the text into a .txt file, and add that instead.'
export const VIDEO_MSG = 'Video and social-media links can’t be read. Add the slides or notes as a PDF, or paste the transcript into a .txt file.'

const VIDEO_HOSTS = ['youtube.com', 'youtu.be', 'vimeo.com', 'tiktok.com', 'facebook.com', 'fb.watch', 'instagram.com', 'twitter.com', 'x.com', 'twitch.tv', 'dailymotion.com']
const hostIs = (host, list) => list.some(h => host === h || host.endsWith('.' + h))
export const isGoogleKind = k => /^g/.test(k || '')

// -> { kind: 'gdoc'|'gslides'|'gsheet'|'gdrive'|'canva'|'web', fetchUrl } or { error }
export function linkPlan(href) {
  let u; try { u = new URL(href) } catch { return { error: 'That doesn’t look like a web link.' } }
  const host = u.hostname.toLowerCase().replace(/^www\./, ''), path = u.pathname
  if (host === 'docs.google.com') {
    if (/^\/(?:u\/\d+\/)?(document|presentation|spreadsheets)\/d\/e\//.test(path)) return { kind: 'web', fetchUrl: href }          // "published to the web" pages are plain web pages
    const m = path.match(/^\/(?:u\/\d+\/)?(document|presentation|spreadsheets)\/d\/([\w-]{10,})/)
    if (m) {
      const [, what, id] = m
      if (what === 'document') return { kind: 'gdoc', fetchUrl: `https://docs.google.com/document/d/${id}/export?format=pdf` }
      if (what === 'presentation') return { kind: 'gslides', fetchUrl: `https://docs.google.com/presentation/d/${id}/export/pdf` }
      return { kind: 'gsheet', fetchUrl: `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx` }
    }
    if (/^\/forms\b/.test(path)) return { error: 'Google Forms can’t be read from a link. Export the questions as a PDF and add that file.' }
  }
  if (host === 'drive.google.com') {
    if (/\/folders\//.test(path)) return { error: 'A Google Drive folder can’t be read. Open the file you want and paste its link.' }
    const id = path.match(/\/file\/d\/([\w-]{10,})/)?.[1] || (/^\/(open|uc)$/.test(path) ? u.searchParams.get('id') : '')
    if (id && /^[\w-]{10,}$/.test(id)) return { kind: 'gdrive', fetchUrl: `https://drive.google.com/uc?export=download&id=${id}` }
  }
  if (host === 'canva.link' || hostIs(host, ['canva.com'])) return { kind: 'canva', fetchUrl: href }
  if (hostIs(host, VIDEO_HOSTS)) return { error: VIDEO_MSG }
  return { kind: 'web', fetchUrl: href }
}
