// v75: the choices a student makes before a reviewer is built. ONE list, used by "Create reviewer" and by
// Google Classroom, so both offer exactly the same control instead of Classroom being a one-click black box.
//
//  subject  -> the reviewer_requests.subject column
//  prompt   -> the reviewer_requests.coverage column (already read by the AI as "What to cover")
//  aids     -> the reviewer_requests.aids column (study aids / strategies)
//  theme    -> the reviewer_requests.theme column
//  visuals  -> sent with the generate call: include the student's pictures / video slides in the reviewer
import { cleanAids, AIDS } from './aids.js'
import { THEMES } from './render.js'

export const PROMPT_MAX = 1200
export const PROMPT_HINT = 'e.g. “Focus on chapters 3–5, explain the formulas step by step, and add a drawing of the water cycle.”'

// Pictures the student already uploaded can become part of the reviewer (their own photos, slide pictures, and the
// contact sheets taken from a lesson video). Data URIs, so the reviewer stays one self-contained page.
export const VISUALS = {
  none: { label: 'Text only', hint: 'No pictures in the reviewer', max: 0 },
  some: { label: 'A few pictures', hint: 'Up to 4 of your images and video slides', max: 4 },
  all: { label: 'All pictures', hint: 'Up to 8 of your images and video slides', max: 8 },
}
export const VISUAL_ORDER = ['none', 'some', 'all']

// One-tap sentences that make the prompt box useful without typing. They APPEND, so several can be combined.
export const PROMPTS = [
  { key: 'simple', label: 'Explain simply', text: 'Explain each idea in plain words, as if I am new to this subject.' },
  { key: 'examples', label: 'More examples', text: 'Give a short real-life example for the most important ideas.' },
  { key: 'exam', label: 'Exam focus', text: 'Highlight the facts, names and formulas most likely to be asked in an exam.' },
  { key: 'short', label: 'Keep it short', text: 'Keep it short: only what I must memorise.' },
  { key: 'deep', label: 'Go deeper', text: 'Go deeper on the hardest ideas and explain why they work.' },
  { key: 'diagrams', label: 'Add diagrams', text: 'Add diagrams or graphs for the main processes and numbers.' },
]

export const DEFAULT_SETTINGS = { subject: '', prompt: '', aids: [], theme: 'indigo', visuals: 'some' }

const DEFAULT_VISUALS = 'some'
export const cleanVisuals = v => (Object.prototype.hasOwnProperty.call(VISUALS, v) ? v : DEFAULT_VISUALS)
export const visualMax = v => VISUALS[cleanVisuals(v)].max
export const cleanPrompt = s => String(s ?? '').replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, PROMPT_MAX)
export const cleanSubject = s => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)

export function cleanSettings(x = {}) {
  const src = x && typeof x === 'object' ? x : {}
  return {
    subject: cleanSubject(src.subject),
    prompt: cleanPrompt(src.prompt),
    aids: cleanAids(src.aids),
    theme: Object.prototype.hasOwnProperty.call(THEMES, src.theme) ? src.theme : 'indigo',
    visuals: cleanVisuals(src.visuals),
  }
}

// Add a preset sentence without typing it twice. Respects PROMPT_MAX and keeps the student's own words.
export function addPrompt(text, phrase, max = PROMPT_MAX) {
  const base = cleanPrompt(text)
  const add = cleanPrompt(phrase)
  if (!add) return base
  if (base.toLowerCase().includes(add.toLowerCase())) return base
  const next = base ? `${base}\n${add}` : add
  return next.length <= max ? next : base
}

export const hasPrompt = (text, phrase) => cleanPrompt(text).toLowerCase().includes(cleanPrompt(phrase).toLowerCase())

// A short line for a collapsed panel: "Biology · Exam ready · 4 pictures".
export function settingsSummary(s) {
  const v = cleanSettings(s)
  const out = []
  if (v.subject) out.push(v.subject)
  if (v.aids.length) out.push(v.aids.length === 1 ? AIDS[v.aids[0]].label : `${v.aids.length} study aids`)
  if (v.prompt) out.push('your instructions')
  if (v.visuals !== 'none') out.push(VISUALS[v.visuals].label.toLowerCase())
  out.push(THEMES[v.theme] ? v.theme[0].toUpperCase() + v.theme.slice(1) : 'Indigo')
  return out.filter(Boolean).join(' · ')
}

// One line the reviewer request row can show (and the AI reads through briefOf as "What to cover").
export const promptForRow = s => cleanPrompt(s?.prompt)

// Last-used settings, so the next reviewer starts where the student left off (and Classroom remembers its own).
export const settingsKey = (who, scope = 'create') => `rl-set:${who}:${scope}`
export function readSettings(who, scope = 'create') {
  try { return cleanSettings(JSON.parse(localStorage.getItem(settingsKey(who, scope)) || '{}')) } catch { return { ...DEFAULT_SETTINGS } }
}
export function writeSettings(who, s, scope = 'create') {
  try { localStorage.setItem(settingsKey(who, scope), JSON.stringify(cleanSettings(s))) } catch { /* private mode: defaults are fine */ }
}

// ---- v75: refreshing an old reviewer -------------------------------------------------------------------------------
// A reviewer gets better with the material a student has now. After this many days the author (or an admin) may ask the
// AI to refresh it; the refresh is ADD-ONLY, so nothing a classmate already studied can disappear.
export const UPDATE_AFTER_DAYS = 5
export const UPDATE_AFTER_MS = UPDATE_AFTER_DAYS * 24 * 60 * 60 * 1000

// When the reviewer last changed (it was added, or last refreshed). A refresh time lives inside the content JSON, so no
// database change is needed. Bad / missing values fall back to the creation time.
export function refreshedAt(item) {
  if (!item) return 0
  const t = Date.parse(item.refreshedAt || item.content?.refreshedAt || '')
  return Number.isFinite(t) ? t : 0
}
export const addedAt = item => {
  const v = item?.added
  const n = Number(v)
  if (Number.isFinite(n) && n > 0) return n
  const t = Date.parse(v || '')          // demo/older rows may store an ISO string instead of epoch ms
  return Number.isFinite(t) ? t : 0
}
export const refreshableAt = item => Math.max(addedAt(item), refreshedAt(item)) + UPDATE_AFTER_MS

// Only the author, admins and the Astra member of the author's school (`astra`) may refresh, only a reviewer that is still
// in the Library, and only after 5 days.
export function canRefresh(item, me, admin, now = Date.now(), astra = false) {
  if (!item || item.removed_at) return false
  if (!admin && !astra && (!me || item.owner_id !== me)) return false
  return now >= refreshableAt(item)
}
// Whole days left before the button appears (0 when it is already available).
export const daysUntilRefresh = (item, now = Date.now()) => Math.max(0, Math.ceil((refreshableAt(item) - now) / (24 * 60 * 60 * 1000)))

// Days the author/admin still has to wait before "Update reviewer" unlocks (0 when it is available now, or when this
// person may never refresh it). Lets the menus show "available in 3 days" instead of silently hiding the action.
export function refreshWait(item, me, admin, now = Date.now(), astra = false) {
  if (!item || item.removed_at) return 0
  if (!admin && !astra && (!me || item.owner_id !== me)) return 0
  return daysUntilRefresh(item, now)
}
