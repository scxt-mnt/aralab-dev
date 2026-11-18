// Groq backup for AI generation (v67). Used only when every Gemini model failed (see server/ai.js).
// Groq speaks the OpenAI chat format and cannot read PDFs or files uploaded to Google, so:
//   - text files            -> sent as text
//   - PDFs                  -> their text is extracted here (package `unpdf`); a scanned PDF with no text layer is skipped
//   - images                -> sent to a Groq vision model (max 5, each under ~3.5 MB)
//   - files uploaded to Google's Files API (very big PDFs) -> cannot be read by Groq, skipped
// Free Groq plans have small per-minute token limits, so the notes are cut at MAX_CHARS characters (a note is added when that happens).
// Optional env: GROQ_API_KEY (required for the backup), GROQ_MODEL / GROQ_VISION_MODEL = a model to try FIRST.
import { parseJsonLoose } from './gemini.js'
const URL_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
export const TEXT_MODELS = ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'llama-3.1-8b-instant']
export const VISION_MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct']
export const MAX_CHARS = 28000, MAX_IMAGE_B64 = 4.6e6 * 0.76 | 0           // ~3.5 MB of image once base64-encoded
const fail = (message, status, extra = {}) => Object.assign(new Error(message), { status, ...extra })

export const groqKey = () => String(process.env.GROQ_API_KEY || '').trim()

async function pdfText(b64) {
  try {
    const { extractText, getDocumentProxy } = await import('unpdf')
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(b64, 'base64')))
    const { text } = await extractText(pdf, { mergePages: true })
    return String(text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  } catch { return '' }
}

// Gemini-style parts -> { text, images:[dataUrl], skipped:[reason] }
export async function partsToChat(parts, { pdf = pdfText, cut = true } = {}) {
  const chunks = [], images = [], skipped = []
  for (const p of parts || []) {
    const inl = p?.inline_data || p?.inlineData, fd = p?.file_data || p?.fileData
    if (typeof p?.text === 'string') chunks.push(p.text)
    else if (inl?.data) {
      const mime = inl.mime_type || inl.mimeType || ''
      if (mime === 'application/pdf') { const t = await pdf(inl.data); if (t) chunks.push(`PDF text:\n${t}`); else skipped.push('a PDF with no readable text') }
      else if (mime.startsWith('image/')) { if (inl.data.length <= MAX_IMAGE_B64 && images.length < 5) images.push(`data:${mime};base64,${inl.data}`); else skipped.push('an image that is too big') }
      else chunks.push(Buffer.from(inl.data, 'base64').toString('utf8'))
    } else if (fd) skipped.push('a very big file')
  }
  let text = chunks.join('\n\n')
  if (cut && text.length > MAX_CHARS) text = text.slice(0, MAX_CHARS) + '\n\n[The notes were cut here because they are long.]'
  return { text, images, skipped }
}

// Long notes: cut into slices of about MAX_CHARS at paragraph breaks.
export function splitText(text, size = MAX_CHARS) {
  const out = []; let cur = ''
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = '' }
  for (const para of String(text).split(/\n{2,}/)) {
    for (let k = 0; k < para.length || k === 0; k += size) {
      const piece = para.slice(k, k + size)
      if (cur.length + piece.length + 2 > size) push()
      cur += (cur ? '\n\n' : '') + piece
    }
  }
  push(); return out
}

// Several partial reviewers -> one. Round-robin, so the end of long notes is as visible as the start; duplicates dropped.
export function mergeReviewers(list) {
  const a = list.filter(o => o && typeof o === 'object')
  const take = (lists, cap, key) => {
    const seen = new Set(), out = []
    for (let i = 0; out.length < cap; i++) {
      let any = false
      for (const l of lists) if (i < l.length) { any = true; const k = String(key(l[i]) || '').toLowerCase().trim(); if (k && !seen.has(k) && out.length < cap) { seen.add(k); out.push(l[i]) } }
      if (!any) break
    }
    return out
  }
  const arr = x => (Array.isArray(x) ? x : [])
  const sections = take(a.map(o => arr(o.sections)), 12, x => x?.heading).map(x => ({ ...x, points: [...new Set(arr(x.points))].slice(0, 14) }))
  return {
    title: a[0]?.title || '', summary: a.map(o => o.summary).filter(Boolean).slice(0, 2).join(' '),
    sections, terms: take(a.map(o => arr(o.terms)), 25, x => x?.term), flashcards: take(a.map(o => arr(o.flashcards)), 20, x => x?.q), quiz: take(a.map(o => arr(o.quiz)), 15, x => x?.q),
  }
}

// One model after another for ONE request. Returns { text, tokens, model } or throws.
async function ask({ key, system, text, images, fetchImpl, left, maxOutputTokens, validate, onProgress }) {
  const pref = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean)
  const models = [...new Set(images.length ? [...pref(process.env.GROQ_VISION_MODEL), ...VISION_MODELS] : [...pref(process.env.GROQ_MODEL), ...TEXT_MODELS])]
  const user = images.length ? [{ type: 'text', text: text || 'Notes are in the images.' }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] : text
  const tried = []
  for (const model of models) {
    if (left() < 4000) break
    onProgress?.({ stage: 'ai', state: 'wait', model: `groq:${model}`, n: tried.length + 1, of: models.length, round: 1 })
    let r, j
    try {
      r = await fetchImpl(URL_CHAT, { method: 'POST', signal: AbortSignal.timeout(Math.min(left(), 45000)), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, temperature: 0.3, max_tokens: maxOutputTokens, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: `${system}\nRespond with one JSON object and nothing else.` }, { role: 'user', content: user }] }) })
      j = await r.json().catch(() => ({}))
    } catch { tried.push(`${model}: timed out`); continue }
    if (r.status === 401) throw fail('The Groq API key was rejected. Check GROQ_API_KEY.', 502)
    if (!r.ok) { tried.push(`${model}: ${r.status === 429 ? 'rate limit' : r.status === 413 ? 'notes too big' : `error ${r.status}`}`); continue }   // wrong/retired model, limit or overload: next model
    const out = j.choices?.[0]?.message?.content || ''
    if (!out.trim()) { tried.push(`${model}: empty answer`); continue }
    if (validate) { try { validate(out) } catch (e) { tried.push(`${model}: unusable answer`); if (e?.status === 422) throw e; continue } }
    return { text: out, tokens: j.usage?.total_tokens || 0, model: `groq:${model}` }
  }
  throw fail(`The backup AI (Groq) could not answer either. Tried: ${tried.join('; ') || 'nothing (time ran out)'}.`, 503)
}

const SLICE_RULE = (i, n) => `\nThese notes are long, so they are handled in ${n} parts. This is part ${i} of ${n}: cover ONLY this part, and keep it compact (3-4 sections, 4-5 terms, 4-5 flashcards, 3-4 quiz questions). Use the same title for every part.`

// One JSON answer from Groq. Returns { text, tokens, model }. Same shape as gemini.generateJson.
// slice:true (reviewer-shaped answers only): notes longer than MAX_CHARS are cut into parts, queued one after another, and merged into ONE reviewer.
// Parts that do not fit in the time budget are left out (set GENERATE_BUDGET_MS higher and maxDuration to 300 for more room).
export async function groqJson({ key = groqKey(), system, parts, fetchImpl = fetch, budgetMs = 20000, maxOutputTokens = 6000, validate, pdf, onProgress, slice = false, maxSlices = 6 }) {
  if (!key) throw fail('Groq is not set up (GROQ_API_KEY).', 503)
  const t0 = Date.now(), left = () => budgetMs - (Date.now() - t0)
  const { text, images, skipped } = await partsToChat(parts, { pdf, cut: !slice })
  if (!text.trim() && !images.length) throw fail(skipped.length ? `The backup AI cannot read these notes (${skipped[0]}).` : 'There is nothing to read.', 422)
  const pieces = slice && text.length > MAX_CHARS ? splitText(text).slice(0, maxSlices) : [text]
  if (pieces.length === 1) return ask({ key, system, text: pieces[0], images, fetchImpl, left, maxOutputTokens, validate, onProgress })
  const done = [], n = pieces.length; let tokens = 0, model = ''
  for (const [i, piece] of pieces.entries()) {
    if (i > 0 && left() < 12000) break                                    // out of time: the rest is left out
    onProgress?.({ stage: 'ai', state: 'wait', model: `groq: part ${i + 1} of ${n}`, n: i + 1, of: n, round: 1 })
    try {
      const r = await ask({ key, system: system + SLICE_RULE(i + 1, n), text: piece, images: i === 0 ? images : [], fetchImpl, left, maxOutputTokens, onProgress: undefined })
      done.push(parseJsonLoose(r.text)); tokens += r.tokens; model = r.model
    } catch (e) { if (e?.status === 401 || e?.status === 422 && !done.length && i === n - 1) throw e }   // a part that fails is skipped; the others still make a reviewer
  }
  if (!done.length) throw fail('The backup AI (Groq) could not answer any part of these notes.', 503)
  const merged = JSON.stringify(mergeReviewers(done))
  if (validate) validate(merged)
  return { text: merged, tokens, model, parts: `${done.length} of ${n}` }
}
