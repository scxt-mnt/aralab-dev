// Google Classroom: sign-in and the network calls. The student signs in with Google in a small pop-up (Google Identity Services),
// and AraLab only READS: course names, lesson posts and the Drive files attached to them. The token lives in this browser tab
// (sessionStorage, about 1 hour) and is never sent to our server; the files are downloaded by the browser and then go through
// the same upload + AI check + generate flow as any other reviewer.
import { buildLessons, lessonText, safeName, selectFiles } from './classroomLogic'
import { videoToSheets } from './videoToSheets'
import { convertBytes, convertedName } from './fileConvert'

export const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''
export const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY || '', APP_ID = import.meta.env.VITE_GOOGLE_APP_ID || ''
export const SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.courseworkmaterials.readonly',
  'https://www.googleapis.com/auth/classroom.announcements.readonly',
  'https://www.googleapis.com/auth/drive.file',      // not restricted: only files the student confirms in the Google file picker
]
const KEY = 'aralab-gc'
const CR = 'https://classroom.googleapis.com/v1', DRIVE = 'https://www.googleapis.com/drive/v3'

export const saved = () => { try { const t = JSON.parse(sessionStorage.getItem(KEY) || 'null'); return t && t.expires > Date.now() ? t : null } catch { return null } }
const keep = t => { try { sessionStorage.setItem(KEY, JSON.stringify(t)) } catch { /* private mode: stays connected until reload */ } }
export const forget = () => { try { sessionStorage.removeItem(KEY) } catch { /* ignore */ } }

let gis = null
const loadGis = () => (gis ||= new Promise((ok, no) => {
  if (window.google?.accounts?.oauth2) return ok()
  const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true
  s.onload = ok; s.onerror = () => { gis = null; no(new Error('Could not load Google sign-in. Check your connection and try again.')) }
  document.head.appendChild(s)
}))

// Opens Google's consent pop-up. Must be called from a click. Resolves { token, expires }.
export async function connect() {
  if (!CLIENT_ID) throw new Error('Google Classroom is not set up yet.')
  await loadGis()
  return new Promise((ok, no) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPES.join(' '),
      callback: r => {
        if (r.error) return no(new Error(r.error_description || r.error))
        if (!window.google.accounts.oauth2.hasGrantedAllScopes(r, ...SCOPES)) return no(new Error('Please tick every permission on the Google screen so AraLab can read your lessons and their files.'))
        const t = { token: r.access_token, expires: Date.now() + Math.max(60, Number(r.expires_in) - 60) * 1000 }; keep(t); ok(t)
      },
      error_callback: e => no(new Error(e?.type === 'popup_closed' ? 'The Google window was closed before you finished.' : e?.type === 'popup_failed_to_open' ? 'The Google window was blocked. Allow pop-ups for this site and try again.' : (e?.message || 'Google sign-in failed.'))),
    })
    client.requestAccessToken({ prompt: '' })
  })
}
export function disconnect(t) { forget(); try { if (t?.token) window.google?.accounts?.oauth2?.revoke(t.token, () => {}) } catch { /* ignore */ } }

const expired = () => Object.assign(new Error('Your Google session ended. Connect again.'), { status: 401 })
async function call(t, url, { raw = false, signal } = {}) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${t.token}` }, signal })
  if (r.status === 401) { forget(); throw expired() }
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw Object.assign(new Error(j.error?.message || `Google said ${r.status}.`), { status: r.status }) }
  return raw ? r : r.json()
}
// every page of a list endpoint; a missing permission (403) or an unknown resource (404) is just an empty list
async function list(t, url, key) {
  const out = []
  let page = ''
  for (let i = 0; i < 6; i++) {
    let j
    try { j = await call(t, `${url}${url.includes('?') ? '&' : '?'}pageSize=100${page ? `&pageToken=${encodeURIComponent(page)}` : ''}`) }
    catch (e) { if (e.status === 403 || e.status === 404) break; throw e }
    out.push(...(j[key] || [])); if (!(page = j.nextPageToken)) break
  }
  return out
}

export const loadCourses = t => list(t, `${CR}/courses?courseStates=ACTIVE`, 'courses').then(l => l.map(c => ({ id: c.id, name: c.name || 'Untitled course', section: c.section || '' })))
export async function loadLessons(t, course) {
  const [materials, work, announcements] = await Promise.all([
    list(t, `${CR}/courses/${course.id}/courseWorkMaterials`, 'courseWorkMaterial'),
    list(t, `${CR}/courses/${course.id}/courseWork`, 'courseWork'),
    list(t, `${CR}/courses/${course.id}/announcements`, 'announcements'),
  ])
  return buildLessons(course, { materials, work, announcements })
}

let gapiP = null
const loadPicker = () => (gapiP ||= new Promise((ok, no) => {
  const fail = () => { gapiP = null; no(new Error('Could not load the Google file picker. Check your connection and try again.')) }
  const done = () => window.gapi.load('picker', { callback: ok, onerror: fail })
  if (window.gapi?.load) return done()
  const s = document.createElement('script'); s.src = 'https://apis.google.com/js/api.js'; s.async = true; s.onload = done; s.onerror = fail; document.head.appendChild(s)
}))
// Google's file picker, limited to the lesson's own files. Picking them is what lets AraLab read them (drive.file scope).
// -> array of picked file ids, or null when the student cancels.
export async function pickFiles(t, ids) {
  await loadPicker()
  const g = window.google.picker
  return new Promise(ok => {
    const view = new g.DocsView().setIncludeFolders(false).setFileIds(ids.join(','))
    const b = new g.PickerBuilder().addView(view).setOAuthToken(t.token).setDeveloperKey(API_KEY).enableFeature(g.Feature.MULTISELECT_ENABLED).setTitle('Select the lesson files')
      .setCallback(d => { if (d.action === g.Action.PICKED) ok(d.docs.map(x => x.id)); else if (d.action === g.Action.CANCEL) ok(null) })
    if (APP_ID) b.setAppId(APP_ID)
    b.build().setVisible(true)
  })
}

// v77: read a download in pieces so the screen can show a percentage and Cancel can stop it half-way.
const mb = n => `${Math.round(n / 104857.6) / 10} MB`
export async function readBlob(res, { signal, size = 0, onPct = () => {} } = {}) {
  const total = Number(res.headers.get('content-length')) || Number(size) || 0
  if (!res.body || !res.body.getReader) return res.blob()
  const reader = res.body.getReader(), parts = []
  let got = 0
  for (;;) {
    if (signal?.aborted) { try { await reader.cancel() } catch { /* ignore */ } throw Object.assign(new Error('Cancelled'), { cancelled: true }) }
    const { done, value } = await reader.read()
    if (done) break
    parts.push(value); got += value.length
    onPct(total ? Math.min(99, (got / total) * 100) : null, `${mb(got)}${total ? ` of ${mb(total)}` : ''}`)
  }
  return new Blob(parts, { type: res.headers.get('content-type') || '' })
}

// Downloads one Drive file the student confirmed in the picker (v74: used to listen to a lesson's video).
export async function downloadDriveFile(t, fileId, { signal, onProgress = () => {} } = {}) {
  const meta = await call(t, `${DRIVE}/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size&supportsAllDrives=true`, { signal })
  const res = await call(t, `${DRIVE}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, { raw: true, signal })
  const blob = await readBlob(res, { signal, size: meta.size, onPct: (p, txt) => onProgress(`Downloading ${meta.name || 'the video'} · ${txt}`, p) })
  return { meta, blob }
}

// Downloads what the AI can read from a lesson as File objects: the lesson's own text + its Drive files.
// -> { files, skipped:[{name,why}] }
export async function fetchLessonFiles(t, lesson, onStep = () => {}, signal) {
  const metas = [], skipped = []
  for (const f of lesson.files) {
    try { metas.push(await call(t, `${DRIVE}/files/${encodeURIComponent(f.id)}?fields=id,name,mimeType,size&supportsAllDrives=true`, { signal })) }
    catch (e) { if (e.status === 401 || e.cancelled || e.name === 'AbortError') throw e; skipped.push({ name: f.title, why: e.status === 403 || e.status === 404 ? 'could not be opened (ask your teacher to share it)' : 'could not be read' }) }
  }
  const text = lessonText(lesson)
  const { use, skipped: more } = selectFiles(metas, { reserve: text ? 1 : 0 })
  skipped.push(...more)
  const files = []
  if (text) files.push(new File([text], `${safeName(lesson.title)} (lesson text).txt`, { type: 'text/plain' }))
  for (const { meta, plan } of use) {
    if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { cancelled: true })
    onStep(`Downloading ${meta.name}…`)
    const url = plan.how === 'export' || plan.how === 'export-convert' ? `${DRIVE}/files/${encodeURIComponent(meta.id)}/export?mimeType=${encodeURIComponent(plan.exportMime)}` : `${DRIVE}/files/${encodeURIComponent(meta.id)}?alt=media&supportsAllDrives=true`
    try {
      const blob = await readBlob(await call(t, url, { raw: true, signal }), { signal, size: meta.size, onPct: (p, txt) => onStep(`Downloading ${meta.name} · ${txt}`, p) })
      if (plan.how === 'video') { const r = await videoToSheets(blob, { name: meta.name, maxSheets: plan.sheets, onStep, signal }); files.push(...r.files); continue }   // v61: video -> pictures of every scene change
      if (plan.how === 'convert' || plan.how === 'export-convert') {        // v62: Word / Excel / PowerPoint / CSV / ... -> plain text
        const { text } = convertBytes(new Uint8Array(await blob.arrayBuffer()), { name: plan.name, type: plan.how === 'convert' ? meta.mimeType : '' })
        files.push(new File([text], safeName(convertedName(plan.name)), { type: 'text/plain' })); continue
      }
      files.push(new File([blob], safeName(plan.name), { type: plan.type }))
    }
    catch (e) { if (e.status === 401 || e.cancelled || e.name === 'AbortError') throw e; if (e.video) { skipped.push({ name: meta.name, why: e.message.replace(/^This video /, '').replace(/\.$/, '') }); continue }; if (e.convert) { skipped.push({ name: meta.name, why: `could not be read (${e.message.replace(/\.$/, '')})` }); continue }; skipped.push({ name: meta.name, why: e.status === 403 ? 'is too big for Google to convert or can’t be shared' : 'could not be downloaded' }) }
  }
  return { files, skipped }
}
