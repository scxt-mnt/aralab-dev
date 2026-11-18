// Gemini client with AUTOMATIC model detection. No model name is hard-wired:
//   1. ask Google which models this API key can use (models.list)
//   2. keep only text models that support generateContent, in the Flash family (cheap + free-tier friendly)
//   3. rank them: newest version first (3.8 > 3.6 > 3.5 > ...), stable before preview, flash before flash-lite
//   4. try the best one; if Google says "no longer available / no quota / not found", fall through to the next
// So when Google ships a newer Flash model it is picked up automatically, and when one is retired nothing breaks.
// Optional env: GEMINI_MODEL = a name (or comma list) to try FIRST. It is only a preference: auto-detect is still the safety net.
//               GEMINI_ALLOW_PREMIUM=1 = also consider Pro / Argon style models (paid, not on the free tier).

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const UPLOAD = 'https://generativelanguage.googleapis.com/upload/v1beta'
const TTL = 30 * 60 * 1000
const MAX_TRIES = 8

// Used ONLY when the model list cannot be fetched at all. Order = best guess, newest first.
export const FALLBACK = ['gemini-3.8-flash', 'gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-latest']

// things that are not plain text generators
const NOT_TEXT = /(embed|tts|image|live|audio|robotics|computer-use|aqa|learnlm|gemma|imagen|veo|omni|lyria|customtools|deep-research|antigravity|vision|-8b|exp)/i

const ver = s => String(s).split('.').map(n => parseInt(n, 10) || 0)
const cmpVer = (a, b) => { for (let i = 0; i < Math.max(a.length, b.length); i++) { const d = (a[i] || 0) - (b[i] || 0); if (d) return d } return 0 }

// "models/gemini-3.8-flash" -> { id, version:[3,8], family:'flash', preview:false, tier:0 } | null (not a candidate)
export function parseModel(name, { allowPremium = false } = {}) {
  const id = String(name || '').replace(/^models\//, '')
  if (!id.startsWith('gemini-') || NOT_TEXT.test(id)) return null
  let m = /^gemini-(\d+(?:\.\d+)?)-(flash-lite|flash)(?:-(.+))?$/.exec(id)
  if (m) {
    const suffix = m[3] || ''
    return { id, version: ver(m[1]), family: m[2], preview: /preview|beta/.test(suffix), alias: false, tier: m[2] === 'flash' ? 0 : 1, suffixLen: suffix.length }
  }
  m = /^gemini-(flash-lite|flash)-latest$/.exec(id)          // rolling alias, kept as a late fallback
  if (m) return { id, version: [-1], family: m[1], preview: false, alias: true, tier: m[1] === 'flash' ? 0 : 1, suffixLen: 99 }
  if (allowPremium) {
    m = /^gemini-(\d+(?:\.\d+)?)-pro(?:-(.+))?$/.exec(id)
    if (m) return { id, version: ver(m[1]), family: 'pro', preview: /preview|beta/.test(m[2] || ''), alias: false, tier: 2, suffixLen: (m[2] || '').length }
    m = /^gemini-(\d+(?:\.\d+)?)-([a-z]+)$/.exec(id)         // e.g. gemini-4-argon
    if (m) return { id, version: ver(m[1]), family: m[2], preview: false, alias: false, tier: 2, suffixLen: 0 }
  }
  return null
}

// best first
export function rankModels(apiModels, opts = {}) {
  const seen = new Set(), out = []
  for (const m of apiModels || []) {
    const methods = m.supportedGenerationMethods
    if (Array.isArray(methods) && !methods.includes('generateContent')) continue
    const p = parseModel(m.name, opts)
    if (!p || seen.has(p.id)) continue
    seen.add(p.id); out.push(p)
  }
  out.sort((a, b) =>
    (a.alias - b.alias) || (a.tier - b.tier) || cmpVer(b.version, a.version) || (a.preview - b.preview) || (a.suffixLen - b.suffixLen) || a.id.localeCompare(b.id))
  return out
}

const fail = (message, status, extra = {}) => Object.assign(new Error(message), { status, ...extra })

let cache = { at: 0, models: null, source: 'none' }
const dead = new Map()                                       // model id -> time it failed with "gone"; skipped for 10 min
const isDead = id => (dead.get(id) || 0) > Date.now() - 10 * 60 * 1000
// v57: models whose QUOTA is used up. id -> time (ms) until which we skip it. A model with no quota left is not retried for the
// cooldown (Google tells us how long for per-minute limits; a daily limit sits out 30 min), so the NEXT request goes straight to a model that still has quota.
const exhausted = new Map()
const isExhausted = id => (exhausted.get(id) || 0) > Date.now()
export function cooldownFor(msg) {
  const m = /retry in ([\d.]+)\s*s/i.exec(msg) || /retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i.exec(msg)
  if (/limit:\s*0|free tier|not available on the free|billing/i.test(msg)) return 60 * 60 * 1000          // this model is simply not in the plan
  if (/per\s?day|daily|PerDay/i.test(msg)) return 30 * 60 * 1000
  if (m) return Math.min(15 * 60 * 1000, Math.ceil(Number(m[1]) + 2) * 1000)
  return 2 * 60 * 1000
}
export const _resetForTests = () => { cache = { at: 0, models: null, source: 'none' }; dead.clear(); slow.clear(); exhausted.clear(); good = '' }

export async function listModels(key, f = fetch) {
  let token = '', all = []
  for (let i = 0; i < 10; i++) {
    const r = await f(`${BASE}/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`, { headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10000) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { const e = new Error(j.error?.message || `models.list failed (${r.status})`); e.status = r.status; throw e }
    all = all.concat(j.models || [])
    if (!(token = j.nextPageToken)) break
  }
  return all
}

// ordered list of model ids to try
export async function resolveModels({ key, pinned = process.env.GEMINI_MODEL, allowPremium = process.env.GEMINI_ALLOW_PREMIUM === '1', fetchImpl = fetch, force = false } = {}) {
  let ranked = null, source = 'api'
  if (!force && cache.models && Date.now() - cache.at < TTL) { ranked = cache.models; source = cache.source }
  else {
    try { ranked = rankModels(await listModels(key, fetchImpl), { allowPremium }).map(m => m.id) }
    catch (e) {
      if (e.status === 400 || e.status === 401 || e.status === 403) throw fail('The Gemini API key was rejected. Check GEMINI_API_KEY. (' + String(e.message).slice(0, 140) + ')', 502)   // bad key: say so, don't pretend
      ranked = null                                              // Google unreachable / hiccup: use the built-in fallback list
    }
    if (!ranked || !ranked.length) { ranked = [...FALLBACK]; source = 'fallback' } else source = 'api'
    cache = { at: Date.now(), models: ranked, source }
  }
  const pins = String(pinned || '').split(',').map(s => s.trim().replace(/^models\//, '')).filter(Boolean)
  const ids = [...new Set([...pins, ...ranked])].filter(id => !isDead(id))
  return { ids: ids.length ? ids : [...ranked], source, pinned: pins }
}

const GONE = /no longer available|not found|is not supported|deprecated|retired|discontinued|not available|unsupported model/i
const sleepDefault = ms => new Promise(r => setTimeout(r, ms))

// ---------------------------------------------------------------------------------------------
// One JSON answer from the best working model. Returns { text, tokens, model }
//
// How it avoids "No Gemini model could answer / timed out":
//   * STREAMING: we read the answer as it is written. A model that is writing is never cut off;
//     a model that says nothing for FIRST_TOKEN_MS (or goes quiet for STALL_MS) is abandoned fast
//     instead of burning the whole time budget (the old bug: one slow model ate all 50 seconds).
//   * NEXT MODEL, NOT SAME MODEL: timeout, overload (5xx), rate limit, retired or no-quota all
//     switch to the next-best model straight away. Each model has its own quota and its own load.
//   * MEMORY: a model that just timed out / overloaded is tried last for the next 3 minutes, so the
//     next click does not wait on the same sick model again.
//   * FASTER RETRIES: after a timeout the fallback models are asked to think less ("minimal").
//   * SECOND ROUND: if every model failed for a temporary reason (timeout / overload / rate limit)
//     and there is still time, the temporary failures are tried once more.
//   * RACING: if a model has not started answering after HEDGE_MS, the next model is asked too; the first one that starts writing wins and
//     the others are cancelled. So one slow or overloaded model no longer costs 18 s before the next one gets a chance.
//   * LAST WINNER FIRST: the model that answered last time goes first, so the newest (usually busiest) model is not hammered every time.
//   * BIG FILES: the 'no first word' limit grows with the size of the notes, so a large PDF is not abandoned while the model is still reading it.
//   * PROGRESS: onProgress({stage:'ai', state:'detect'|'wait'|'write'|'switch', ...}) for a progress bar.
// ---------------------------------------------------------------------------------------------
const FIRST_TOKEN_MS = 18000          // no first word from the model after this long -> next model
const STALL_MS = 15000                // went silent in the middle of the answer -> next model
const HEDGE_MS = 7000                 // nobody has started writing after this long -> also ask the next model, first to start wins
const SLOW_MS = 3 * 60 * 1000
let good = ''                         // model that answered last: tried first next time
const slow = new Map()                // model id -> when it last timed out / was overloaded
const isSlow = id => (slow.get(id) || 0) > Date.now() - SLOW_MS

// Calls one model with streaming. Resolves { r:{ok,status}, j } in the same shape as a normal response,
// or throws an Error with .timeout = 'idle' | 'budget' when the model was too slow.
async function callModel({ id, key, body, fetchImpl, firstMs, stallMs, hardMs, onText, onFirst, signal }) {
  const ac = new AbortController()
  let why = ''
  const stop = w => { why = w; ac.abort() }
  if (signal) { if (signal.aborted) throw Object.assign(new Error('cancelled'), { cancelled: true }); signal.addEventListener('abort', () => stop('cancelled'), { once: true }) }
  const hard = setTimeout(() => stop('budget'), hardMs)
  let idle = setTimeout(() => stop('idle'), Math.min(firstMs, hardMs))
  const bump = ms => { clearTimeout(idle); idle = setTimeout(() => stop('idle'), ms) }
  try {
    const r = await fetchImpl(`${BASE}/models/${id}:streamGenerateContent?alt=sse`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key }, signal: ac.signal, body })
    if (!r.ok || !r.body?.getReader) return { r, j: await r.json().catch(() => ({})) }     // errors arrive as plain JSON

    const reader = r.body.getReader(), dec = new TextDecoder()
    let buf = '', text = '', tokens = 0, finish = '', block = '', err = null, began = false
    const handle = evt => {
      const data = evt.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n')
      if (!data || data === '[DONE]') return
      let j; try { j = JSON.parse(data) } catch { return }
      if (j.error) { err = j.error; return }
      const cand = j.candidates?.[0]
      for (const p of cand?.content?.parts || []) if (!p.thought && p.text) text += p.text
      if (cand?.finishReason) finish = cand.finishReason
      if (j.usageMetadata?.totalTokenCount) tokens = j.usageMetadata.totalTokenCount
      if (j.promptFeedback?.blockReason) block = j.promptFeedback.blockReason
      if (text && !began) { began = true; onFirst?.() }
      onText?.(text.length)
    }
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n')
      let i
      while ((i = buf.indexOf('\n\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2) }
      bump(stallMs)
    }
    if (buf.trim()) handle(buf)
    if (err) return { r: { ok: false, status: Number(err.code) || 500 }, j: { error: err } }
    return { r: { ok: true, status: 200 }, j: { candidates: [{ content: { parts: [{ text }] }, finishReason: finish }], usageMetadata: { totalTokenCount: tokens }, promptFeedback: block ? { blockReason: block } : undefined } }
  } catch (e) {
    if (why === 'cancelled') throw Object.assign(new Error('cancelled'), { cancelled: true })
    if (why) throw Object.assign(new Error('timeout'), { timeout: why })
    throw e
  } finally { clearTimeout(hard); clearTimeout(idle) }
}

// Order to try: last winner first, recently-slow models last.
function orderModels(all) {
  const usable = all.filter(id => !isExhausted(id))
  if (usable.length) all = [...usable]                               // v57: skip models with no quota left (if ALL are out, try them anyway: a limit may have reset)
  let ids = [...all.filter(id => !isSlow(id)), ...all.filter(isSlow)]
  if (good && ids.includes(good) && !isSlow(good)) ids = [good, ...ids.filter(i => i !== good)]
  return ids.slice(0, MAX_TRIES)
}
// Big notes need longer before the first word: ~2.5 s per MB of inline data, +4 s per uploaded file, capped.
const firstTokenFor = (parts, base) => {
  let bytes = 0, files = 0
  for (const p of parts || []) { bytes += p?.inlineData?.data?.length || 0; if (p?.fileData) files++ }
  return Math.min(32000, base + Math.floor(bytes / 1.4e6) * 2500 + files * 4000)
}

// One model, start to finish. Returns { ok, text, tokens, model } | { why, temp, slowSignal } | { cancelled }. Throws for errors another model cannot fix.
async function runOne({ id, key, system, parts, fetchImpl, sleep, maxOutputTokens, firstMs, stallMs, left, isFast, signal, onFirst, emit, where, validate }) {
  const v = ver((/gemini-(\d+(?:\.\d+)?)/.exec(id) || [])[1] || 0)
  let thinking = v[0] >= 3                                     // Gemini 3+ takes thinkingLevel; keep it LOW: this is summarising, not proving theorems
  for (let attempt = 0; attempt < 3; attempt++) {
    if (left() < 3000) return { why: 'ran out of time', temp: true }
    emit({ state: 'wait', ...where })
    // NOTE: no temperature/top_p/top_k: Google removed them for current models and may reject or ignore them.
    const generationConfig = { responseMimeType: 'application/json', maxOutputTokens, ...(thinking ? { thinkingConfig: { thinkingLevel: isFast() ? 'minimal' : 'low' } } : {}) }
    let r, j
    try {
      ({ r, j } = await callModel({
        id, key, fetchImpl, firstMs, stallMs, hardMs: left(), signal, onFirst,
        body: JSON.stringify({ systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts }], generationConfig }),
        onText: (() => { let last = 0; return chars => { const t = Date.now(); if (t - last > 400) { last = t; emit({ state: 'write', ...where, chars }) } } })(),
      }))
    } catch (e) {
      if (e.cancelled) return { cancelled: true }
      if (e.timeout) return { why: e.timeout === 'idle' ? 'timed out' : 'ran out of time', temp: true, slowSignal: true }
      if (attempt === 0 && left() > 6000) { await sleep(1000); continue }
      return { why: 'network error', temp: true }
    }

    if (r.ok) {
      const cand = j.candidates?.[0]
      const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('')
      if (j.promptFeedback?.blockReason) throw fail('Google blocked this content. Try different notes.', 422)
      if (cand?.finishReason === 'MAX_TOKENS' && !text.trim().endsWith('}')) return { why: 'answer cut off', temp: true, soft: true }   // another model may be more concise: switch, don't give up
      if (!text.trim()) return { why: 'empty answer', temp: true, soft: true }
      // v56: the caller can check the answer (valid JSON? enough content?). A broken answer = try the NEXT model instead of failing the student.
      if (validate) { try { validate(text) } catch (e) { return { why: 'unusable answer', temp: true, soft: true, detail: e } } }
      dead.delete(id); slow.delete(id); good = id
      return { ok: true, text, tokens: j.usageMetadata?.totalTokenCount || 0, model: id }
    }

    const msg = j.error?.message || `HTTP ${r.status}`
    if (r.status === 400 && thinking && /thinking/i.test(msg)) { thinking = false; continue }          // this model doesn't take thinkingLevel: retry without it
    if (r.status === 401 || (r.status === 403 && /api key|permission denied|invalid|leaked|disabled/i.test(msg) && !GONE.test(msg)))
      throw fail('The Gemini API key was rejected. Check GEMINI_API_KEY. (' + msg.slice(0, 140) + ')', 502)
    if (r.status === 404 || ((r.status === 400 || r.status === 403) && GONE.test(msg))) { dead.set(id, Date.now()); return { why: 'not available' } }
    if (r.status === 429) {                                      // out of quota / rate limited. Each model has its OWN quota: remember it and switch to the next one now, no waiting
      const cool = cooldownFor(msg)
      exhausted.set(id, Date.now() + cool)
      return { why: 'quota reached', temp: cool <= 20000, soft: true }   // only a very short limit is worth one more try in round 2
    }
    if (r.status >= 500) return { why: r.status === 503 ? 'overloaded' : `Google error ${r.status}`, temp: true }  // sick model: switch now, no waiting
    return { why: `rejected (${msg.slice(0, 90)})`, temp: false, detail: fail(`Gemini rejected the request: ${msg.slice(0, 200)}`, 502) }   // v56: this model refuses it; another model may accept
  }
  return { why: 'network error', temp: true }
}

export async function generateJson({ key, system, parts, fetchImpl = fetch, sleep = sleepDefault, budgetMs = 55000, maxOutputTokens = 24576, firstTokenMs = FIRST_TOKEN_MS, stallMs = STALL_MS, hedgeMs = HEDGE_MS, onProgress, validate }) {
  const t0 = Date.now(), left = () => budgetMs - (Date.now() - t0)
  const emit = e => { try { onProgress?.({ stage: 'ai', ...e }) } catch { /* progress must never break generation */ } }
  emit({ state: 'detect' })
  const { ids: all } = await resolveModels({ key, fetchImpl })
  const ids = orderModels(all), firstMs = firstTokenFor(parts, firstTokenMs)
  const tried = [], retryable = new Set()
  let badAnswer = null, lastRejected = null                  // remembered so the final error can be specific
  let fast = false                                             // after a timeout, ask for less thinking = faster answers
  const HEDGE = Symbol('hedge')

  // Start the best model; if nobody is writing after hedgeMs (or one failed), start the next. First model to start writing wins, the rest are cancelled.
  async function raceRound(order, round) {
    const ctls = new Map(), pending = new Map()
    let next = 0, started = null
    const launch = () => {
      const id = order[next], where = { model: id, n: ++next, of: order.length, round }
      const ctl = new AbortController(); ctls.set(id, ctl)
      pending.set(id, runOne({
        id, key, system, parts, fetchImpl, sleep, maxOutputTokens, firstMs, stallMs, left, isFast: () => fast, signal: ctl.signal, emit, where, validate,
        onFirst: () => { if (started === null) { started = id; for (const [o, c] of ctls) if (o !== id) c.abort() } },
      }).then(res => ({ id, res }), err => ({ id, err })))
    }
    const canLaunch = () => started === null && next < order.length && pending.size < 3 && left() >= 4000
    launch()
    try {
      while (pending.size) {
        let timer, hedge = null
        if (canLaunch() && left() > 8000) hedge = new Promise(r => { timer = setTimeout(() => r(HEDGE), hedgeMs) })
        const got = await Promise.race(hedge ? [...pending.values(), hedge] : [...pending.values()])
        clearTimeout(timer)
        if (got === HEDGE) { launch(); continue }
        pending.delete(got.id)
        if (got.err) throw got.err
        const res = got.res
        if (res.ok) return res
        if (res.cancelled) continue
        tried.push(`${got.id}: ${res.why}`)
        if (res.detail) { if (res.why === 'unusable answer') badAnswer = res.detail; else lastRejected = res.detail }
        if (res.temp) { retryable.add(got.id); if (!res.soft) slow.set(got.id, Date.now()) }   // a bad answer is not a sick model: no 3-minute penalty
        if (res.slowSignal) fast = true
        if (started === got.id) started = null                 // the one that was writing died: allow the next to start
        emit({ state: 'switch', model: got.id, round, reason: res.why, next: order[next] || null })
        if (canLaunch()) launch()                              // failed fast (overloaded etc.): don't wait for the hedge timer
      }
      return null
    } finally { for (const c of ctls.values()) c.abort() }
  }

  for (let round = 0; round < 2; round++) {
    let order = ids
    if (round === 1) { order = ids.filter(id => retryable.has(id)); if (!order.length || left() < 12000) break }
    const out = await raceRound(order, round + 1)
    if (out) return { text: out.text, tokens: out.tokens, model: out.model }
  }
  // every model failed for the SAME reason: say that reason instead of a vague message
  if (tried.length && tried.every(t => /quota reached/.test(t))) throw fail('The AI has reached its usage limit on every available model. Try again in a few minutes, or ask the admin to raise the Gemini quota.', 429)
  if (tried.length && tried.every(t => /answer cut off/.test(t))) throw fail('The notes were too big for one reviewer. Use fewer or shorter files.', 422)
  if (tried.length && tried.every(t => /unusable answer/.test(t)) && badAnswer) throw fail(badAnswer.message, badAnswer.status || 502)
  if (tried.length && tried.every(t => /rejected \(/.test(t)) && lastRejected) throw lastRejected
  throw fail('No Gemini model could answer right now. Tried: ' + (tried.join('; ') || 'nothing (time ran out)') + '. Try again in a minute.', 503)
}

export async function describeModels(key, opts = {}) {
  const { ids, source, pinned } = await resolveModels({ key, force: true, ...opts })
  const out = ids.filter(isExhausted)
  const ready = ids.filter(id => !isExhausted(id))
  return { chosen: ready[0] || ids[0], candidates: ready.slice(0, 8), outOfQuota: out, source, pinned }
}

// lenient JSON parse for model output (code fences, stray text around the object)
export function parseJsonLoose(text) {
  const t = String(text || '').replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, '').trim()
  try { return JSON.parse(t) } catch { /* fall through */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1))
  throw new Error('The AI did not return valid JSON.')
}

// ---- Files API: for PDFs/images too big to send inline (Gemini limits a whole inline request to about 20 MB) ----
// Uploads the bytes (resumable protocol, one request), waits until Google has processed them, returns { uri, name, mime }.
// Files are deleted again after the reviewer is built (deleteFile); Google also removes them by itself after 48 hours.
export async function uploadFile({ key, bytes, mime, name, fetchImpl = fetch, sleep = sleepDefault, timeoutMs = 40000 }) {
  const signal = () => AbortSignal.timeout(timeoutMs)
  // v71: many images make bigger requests. The start call is quick; the body upload gets time in proportion to its size
  // (about 1 s per 150 KB, at least 60 s, at most 150 s) and is retried once on a network error.
  const uploadMs = Math.min(150000, Math.max(60000, Math.round(bytes.length / 150000) * 1000))
  let start
  try {
    start = await fetchImpl(`${UPLOAD}/files`, {
      method: 'POST', signal: signal(),
      headers: { 'x-goog-api-key': key, 'X-Goog-Upload-Protocol': 'resumable', 'X-Goog-Upload-Command': 'start', 'X-Goog-Upload-Header-Content-Length': String(bytes.length), 'X-Goog-Upload-Header-Content-Type': mime, 'Content-Type': 'application/json' },
      body: JSON.stringify({ file: { display_name: String(name || 'notes').slice(0, 100) } }) })
  } catch { throw fail(`Could not send ${name} to the AI. Try again.`, 502) }
  if (!start.ok) { const j = await start.json().catch(() => ({})); throw fail(`The AI would not take ${name}: ${(j.error?.message || `HTTP ${start.status}`).slice(0, 160)}`, start.status === 429 ? 429 : 502) }
  const url = start.headers.get('x-goog-upload-url')
  if (!url) throw fail('The AI upload service did not answer correctly. Try again.', 502)
  let up
  const send = () => fetchImpl(url, { method: 'POST', signal: AbortSignal.timeout(uploadMs), headers: { 'Content-Length': String(bytes.length), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' }, body: bytes })
  try { up = await send() }
  catch {
    try { up = await send() }                                     // one retry: a big body on a slow link can time out once
    catch { throw fail(`Could not send ${name} to the AI. Try again.`, 502) }
  }
  let j = await up.json().catch(() => ({}))
  if (!up.ok || !j.file) throw fail(`The AI could not take ${name}: ${(j.error?.message || `HTTP ${up.status}`).slice(0, 160)}`, 502)
  let file = j.file
  for (let i = 0; i < 20 && file.state === 'PROCESSING'; i++) {                  // PDFs are usually ready at once; give slow ones a few seconds
    await sleep(1000)
    const r = await fetchImpl(`${BASE}/${file.name}`, { headers: { 'x-goog-api-key': key }, signal: signal() }).catch(() => null)
    const g = r && (await r.json().catch(() => null))
    if (g?.name) file = g
  }
  if (file.state === 'FAILED') throw fail(`The AI could not read ${name}. Is the file damaged or password protected?`, 422)
  if (file.state === 'PROCESSING') throw fail(`The AI is still processing ${name}. Try again in a minute.`, 503)
  return { uri: file.uri, name: file.name, mime: file.mimeType || mime }
}
export const deleteFile = ({ key, name, fetchImpl = fetch }) => fetchImpl(`${BASE}/${name}`, { method: 'DELETE', headers: { 'x-goog-api-key': key }, signal: AbortSignal.timeout(10000) }).catch(() => null)
