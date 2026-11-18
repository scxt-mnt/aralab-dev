// "Add a link" (v63): the server downloads a link the student pasted and hands the browser a FILE, which then goes through the normal
// upload + AI check + generate flow. Because the server is fetching an address a stranger typed, this file is careful:
//   - only http/https, ports 80/443, no passwords in the URL
//   - the address is checked when the connection is made (not only before), so a trick DNS name can't point at our own network
//   - private, loopback, link-local and cloud-metadata addresses are refused, on every redirect too
//   - 15 s and 25 MB limits; only signed-in students may use it
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import zlib from 'node:zlib'
import { requireUser } from './auth.js'
import { normalizeUrl, linkPlan, isGoogleKind, CANVA_MSG, GOOGLE_SHARE_MSG, NO_TEXT_MSG, VIDEO_MSG } from '../src/linkLogic.js'
import { htmlToText, unent, decodeText, extOf, MAX_CONVERTED_CHARS } from '../src/fileConvert.js'
import { MAX_PDF_BYTES } from '../src/limits.js'

export const MAX_LINK_BYTES = MAX_PDF_BYTES
const TIMEOUT_MS = 15000, MAX_REDIRECTS = 5
const UA = 'Mozilla/5.0 (compatible; AraLabBot/1.0; +study-reviewer)'
const err = (message, status = 422) => Object.assign(new Error(message), { status, link: true })

// ---------- addresses we must never connect to ----------
function expandV6(s) {
  let t = s; const m = t.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (m) { const n = m.slice(1).map(Number); t = t.slice(0, m.index) + ((n[0] << 8) | n[1]).toString(16) + ':' + ((n[2] << 8) | n[3]).toString(16) }
  const [l, r] = t.split('::'), L = l ? l.split(':') : [], R = r ? r.split(':') : []
  if (r === undefined ? L.length !== 8 : L.length + R.length > 7) return null
  const all = [...L, ...(r === undefined ? [] : Array(8 - L.length - R.length).fill('0')), ...R].map(x => parseInt(x, 16))
  return all.length === 8 && all.every(Number.isFinite) ? all : null
}
export function isBlockedIp(ip) {
  const s = String(ip).replace(/^\[|\]$/g, '').split('%')[0]
  if (net.isIPv4(s)) {
    const [a, b, c] = s.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) || (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113)
  }
  if (net.isIPv6(s)) {
    const h = expandV6(s); if (!h) return true
    const v4 = (x, y) => isBlockedIp(`${x >> 8}.${x & 255}.${y >> 8}.${y & 255}`)
    if (h.slice(0, 5).every(x => x === 0) && h[5] === 0xffff) return v4(h[6], h[7])      // ::ffff:1.2.3.4
    if (h.slice(0, 6).every(x => x === 0)) return true                                      // ::, ::1 and the old IPv4-compatible form
    if (h[0] === 0x64 && h[1] === 0xff9b) return v4(h[6], h[7])                             // NAT64
    return (h[0] & 0xfe00) === 0xfc00 || (h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xff00) === 0xff00 || (h[0] === 0x2001 && h[1] === 0x0db8) || h[0] === 0x2002
  }
  return true
}
const guardLookup = blocked => (host, opts, cb) => {
  if (typeof opts === 'function') { cb = opts; opts = {} }
  dns.lookup(host, { all: true, ...(opts?.family ? { family: opts.family } : {}) }, (e, list) => {
    if (e) return cb(e)
    if (!list.length || list.some(a => blocked(a.address))) return cb(Object.assign(new Error('blocked'), { code: 'EBLOCKED' }))
    if (opts?.all) return cb(null, list)
    cb(null, list[0].address, list[0].family)
  })
}

// ---------- the download ----------
// -> { status, headers, body: Buffer, url }.
// `allowPrivate`, `isBlocked` and `anyPort` exist ONLY so the tests can use a local server; the API never sets them.
export function safeGet(rawUrl, { allowPrivate = false, isBlocked, anyPort = false, maxBytes = MAX_LINK_BYTES, timeoutMs = TIMEOUT_MS } = {}) {
  const blocked = isBlocked || (allowPrivate ? () => false : isBlockedIp), portsFree = anyPort || allowPrivate, deadline = Date.now() + timeoutMs
  const once = (url, hops) => new Promise((resolve, reject) => {
    let u; try { u = new URL(url) } catch { return reject(err('That link isn’t valid.')) }
    if (!/^https?:$/.test(u.protocol)) return reject(err('Only http and https links work.'))
    if (u.username || u.password) return reject(err('Links with a password in them aren’t allowed.'))
    if (!portsFree && u.port && !['80', '443'].includes(u.port)) return reject(err('That link uses an unusual port, which isn’t allowed.'))
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (net.isIP(host) && blocked(host)) return reject(err('That address isn’t allowed.'))
    const lib = u.protocol === 'https:' ? https : http
    let timer, settled = false
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v) }          // the first outcome wins; later events (a destroyed socket) are ignored
    const req = lib.request(u, { method: 'GET', lookup: guardLookup(blocked), headers: { 'User-Agent': UA, Accept: '*/*', 'Accept-Language': 'en', 'Accept-Encoding': 'gzip, deflate, br' } }, res => {
      const code = res.statusCode
      res.on('error', () => finish(reject, err('The download failed half-way. Try again.', 502)))
      const stop = e => { finish(reject, e); res.destroy(); req.destroy() }
      if ([301, 302, 303, 307, 308].includes(code) && res.headers.location) {
        res.resume()
        if (hops >= MAX_REDIRECTS) return stop(err('That link redirects too many times.'))
        let next; try { next = new URL(res.headers.location, u).href } catch { return stop(err('That link redirects somewhere invalid.')) }
        finish(() => once(next, hops + 1).then(resolve, reject))
        return
      }
      const tooBig = () => err(`That file is bigger than ${Math.round(maxBytes / 1048576)} MB.`, 413)
      if (Number(res.headers['content-length']) > maxBytes) return stop(tooBig())
      const enc = String(res.headers['content-encoding'] || '').toLowerCase()
      const stream = enc === 'gzip' || enc === 'x-gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res
      const chunks = []; let n = 0
      stream.on('data', c => { if (settled) return; n += c.length; if (n > maxBytes) return stop(tooBig()); chunks.push(c) })
      stream.on('end', () => finish(resolve, { status: code, headers: res.headers, body: Buffer.concat(chunks), url: u.href }))
      stream.on('error', () => finish(reject, err('The download failed half-way. Try again.', 502)))
    })
    timer = setTimeout(() => { finish(reject, err('That site took too long to answer.', 504)); req.destroy() }, Math.max(1000, deadline - Date.now()))
    req.on('error', e => finish(reject, e.link ? e : e.code === 'EBLOCKED' ? err('That address isn’t allowed.') : err('Could not open that link. Check that it is correct and public.', 502)))
    req.end()
  })
  return once(rawUrl, 0)
}

// ---------- turning the answer into a file ----------
const meta = (h, key) => { for (const re of [new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*?content=["']([^"']*)`, 'i'), new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:property|name)=["']${key}["']`, 'i')]) { const m = h.match(re); if (m) return unent(m[1]).replace(/\s+/g, ' ').trim() } return '' }

// the readable text of a web page: title, description and the main content (menus, footers and forms left out)
export function htmlMainText(html) {
  const h = String(html)
  const title = meta(h, 'og:title') || unent(h.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim()
  const desc = meta(h, 'og:description') || meta(h, 'description')
  let body = h.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|noscript|svg|template|iframe)\b[\s\S]*?<\/\1>/gi, '').replace(/<(nav|header|footer|aside|form|button|select)\b[\s\S]*?<\/\1>/gi, '')
  const main = body.match(/<main\b[\s\S]*?<\/main>/i)?.[0] || [...body.matchAll(/<article\b[\s\S]*?<\/article>/gi)].map(m => m[0]).join('\n') || body.match(/<body\b[\s\S]*<\/body>/i)?.[0] || body
  const text = htmlToText(main)
  return [title && `# ${title}`, desc && !text.includes(desc.slice(0, 60)) ? desc : '', text].filter(Boolean).join('\n\n').trim()
}

const EXT = { 'application/pdf': 'pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx', 'text/plain': 'txt', 'text/csv': 'csv', 'application/json': 'json', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/epub+zip': 'epub', 'application/rtf': 'rtf', 'application/vnd.oasis.opendocument.text': 'odt', 'application/vnd.oasis.opendocument.spreadsheet': 'ods', 'application/vnd.oasis.opendocument.presentation': 'odp' }
const cleanName = s => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100)
export function fileNameFrom(headers, url, type) {
  const cd = String(headers['content-disposition'] || '')
  let name = ''
  try { name = decodeURIComponent(cd.match(/filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i)?.[1] || '') } catch { /* ignore */ }
  name = cleanName(name || cd.match(/filename\s*=\s*"?([^";]+)"?/i)?.[1] || '')
  if (!name) { try { const u = new URL(url); name = cleanName(decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '')) || cleanName(u.hostname.replace(/^www\./, '')) } catch { name = 'link' } }
  if (!extOf(name) && EXT[type]) name += '.' + EXT[type]
  return name || 'link'
}

// one download answer + what kind of link it was -> { file: { name, type, bytes } } or { status, error }
export function interpret({ status, headers, body, url }, plan) {
  const type = String(headers['content-type'] || '').split(';')[0].trim().toLowerCase()
  const google = isGoogleKind(plan.kind), canva = plan.kind === 'canva'
  if (status === 401 || status === 403) return { status: 422, error: google ? GOOGLE_SHARE_MSG : canva ? CANVA_MSG : 'That page is private or blocks downloads. Make it public, or save it as a PDF and add the file.' }
  if (status === 404 || status === 410) return { status: 422, error: google ? GOOGLE_SHARE_MSG : 'That link wasn’t found. Check that it is correct.' }
  if (status === 429) return { status: 429, error: 'That site is limiting requests right now. Try again in a few minutes.' }
  if (status >= 400) return { status: 422, error: canva ? CANVA_MSG : `That site answered with an error (${status}).` }
  if (!body.length) return { status: 422, error: 'That link is empty.' }
  if (/^(video|audio)\//.test(type)) return { status: 422, error: VIDEO_MSG }
  if (/html/.test(type) || (!type && /^\s*(<!doctype html|<html)/i.test(body.subarray(0, 200).toString('latin1')))) {
    if (google) return { status: 422, error: GOOGLE_SHARE_MSG }                       // a sign-in page instead of the file
    const html = decodeText(new Uint8Array(body)), text = htmlMainText(html)
    if (text.length < (canva ? 400 : 80)) return { status: 422, error: canva ? CANVA_MSG : NO_TEXT_MSG }
    const title = cleanName(meta(html, 'og:title') || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || new URL(url).hostname.replace(/^www\./, '')) || 'web page'
    const cut = text.length > MAX_CONVERTED_CHARS ? text.slice(0, MAX_CONVERTED_CHARS).trimEnd() + `\n\n[The rest of this page was cut: only the first ${MAX_CONVERTED_CHARS.toLocaleString('en')} characters can be read.]` : text
    return { file: { name: `${title}.txt`, type: 'text/plain', bytes: Buffer.from(cut, 'utf8') } }
  }
  return { file: { name: fileNameFrom(headers, url, type), type: type || 'application/octet-stream', bytes: body } }
}

export async function runLink({ db, authHeader, body, get = safeGet }) {
  const auth = await requireUser(db, authHeader)
  if (auth.error) return { status: auth.error.status, error: auth.error.message }
  const url = normalizeUrl(body?.url)
  if (!url) return { status: 400, error: 'Paste the full link, starting with https://' }
  const plan = linkPlan(url)
  if (plan.error) return { status: 422, error: plan.error }
  try { return interpret(await get(plan.fetchUrl), plan) }
  catch (e) { return e?.link ? { status: e.status || 422, error: e.message } : { status: 502, error: 'Could not open that link.' } }
}
