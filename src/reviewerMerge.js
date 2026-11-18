// Merging two copies of the same reviewer (pure, shared by the server and tests).
//
// Two jobs use this:
//  - an upload that is a newer copy of a reviewer already in the Library: keep everything the Library copy has and
//    add only what is new (no item is ever overwritten, so nothing a student already studied disappears);
//  - an AI fix of a flagged reviewer: the corrected copy wins for the parts it returns, but every item that only the
//    old reviewer had is kept, so the AI can never shrink a reviewer by accident.
import { normalizeContent, FULL_CAPS } from './render.js'

// Generous caps: a merge must never be the reason content is cut. These are larger than the AI generation caps and the
// same order of magnitude as the finished-reviewer import caps.
export const MERGE_CAPS = FULL_CAPS

const STOP = new Set('a an the of and or to in on for with is are was were be been being by as at from that this it its into than then so such'.split(' '))
const norm = s => String(s ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const wordsOf = s => new Set(norm(s).split(' ').filter(w => w && !STOP.has(w)))

// "the same idea, possibly reworded". Used to avoid adding a duplicate of something that is already there.
export function similarText(a, b) {
  const x = norm(a), y = norm(b)
  if (!x || !y) return false
  if (x === y) return true
  if (x.length >= 8 && y.length >= 8 && (x.includes(y) || y.includes(x))) return true
  const A = wordsOf(a), B = wordsOf(b)
  if (!A.size || !B.size) return false
  let hit = 0
  for (const w of A) if (B.has(w)) hit++
  return hit / (A.size + B.size - hit) >= 0.6
}

const samePoint = similarText
const sameHeading = similarText
// "this text already contains the other one" (used when a newer copy adds detail to an existing point)
const containsText = (a, b) => {
  const x = norm(a), y = norm(b)
  return x.length >= 8 && y.length >= 8 && x !== y && (x.includes(y) || y.includes(x))
}

// Every point of both sides, without duplicates. `upgrade` lets a longer version of an existing point replace the
// shorter one (the newer upload adds detail to a point the Library already had).
function mergePoints(primary, secondary, { upgrade = false } = {}) {
  const out = [...primary]
  for (const p of secondary) {
    if (!p) continue
    const hit = out.findIndex(x => samePoint(x, p))
    if (hit >= 0) {
      // the newer copy added detail to a point the Library already had: keep the richer wording
      if (upgrade && out[hit].length < p.length && containsText(p, out[hit])) out[hit] = p
      continue
    }
    out.push(p)
  }
  return out
}

function mergeSections(primary, secondary, overwrite) {
  const out = primary.map(s => ({ heading: s.heading, points: [...s.points] }))
  for (const s of secondary) {
    if (!s.heading && !s.points.length) continue
    const hit = out.find(x => sameHeading(x.heading, s.heading))
    if (!hit) { out.push({ heading: s.heading, points: [...s.points] }); continue }
    if (!hit.heading && s.heading) hit.heading = s.heading
    // overwrite: the corrected copy is primary, so the old copy only contributes items the correction lost
    hit.points = mergePoints(hit.points, s.points, { upgrade: !overwrite })
  }
  return out
}

// terms / flashcards / quiz: matched by their key (term, question), never duplicated.
function mergeBy(primary, secondary, keyOf) {
  const out = [...primary]
  for (const item of secondary) {
    const key = keyOf(item)
    if (!key) continue
    if (out.some(x => similarText(keyOf(x), key))) continue
    out.push(item)
  }
  return out
}

const EXTRA_KEY = {
  abbreviations: x => x?.abbr,
  mnemonics: x => x?.topic || x?.trick,
  keyFacts: x => x,
  comparisons: x => x?.title,
  timeline: x => x?.label,
  traps: x => x?.mistake,
  examples: x => x?.scenario,
  diagrams: x => `${x?.kind || ''}:${x?.title || x?.steps?.[0] || x?.items?.[0]?.label || x?.items?.[0]?.symbol || ''}`,
}

export function mergeContent(baseRaw, nextRaw, { overwrite = false } = {}) {
  const base = normalizeContent(baseRaw, MERGE_CAPS)
  const next = normalizeContent(nextRaw, MERGE_CAPS)
  // `primary` is the side that wins when both have the same item; `secondary` only contributes what is missing.
  const primary = overwrite ? next : base
  const secondary = overwrite ? base : next
  const title = base.title && base.title !== 'Untitled reviewer' ? base.title : next.title
  const merged = {
    title,
    summary: overwrite ? (next.summary || base.summary) : (base.summary || next.summary),
    sections: mergeSections(primary.sections, secondary.sections, overwrite),
    terms: mergeBy(primary.terms, secondary.terms, t => t.term),
    flashcards: mergeBy(primary.flashcards, secondary.flashcards, f => f.q),
    quiz: mergeBy(primary.quiz, secondary.quiz, q => q.q),
    // v75: pictures belong to the reviewer itself (they are the student's own images), so a merge never drops them.
    visuals: base.visuals?.length ? base.visuals : next.visuals,
  }
  for (const [key, keyOf] of Object.entries(EXTRA_KEY)) {
    const a = primary[key] || [], b = secondary[key] || []
    if (!a.length && !b.length) continue
    merged[key] = mergeBy(a, b, keyOf)
  }
  return normalizeContent(merged, MERGE_CAPS)
}

// How much of each part a reviewer has; used to tell the student what a merge added, and to spot "nothing new".
export function itemCounts(raw) {
  const c = normalizeContent(raw, MERGE_CAPS)
  const sections = c.sections.length
  const points = c.sections.reduce((n, s) => n + s.points.length, 0)
  return { sections, points, terms: c.terms.length, flashcards: c.flashcards.length, quiz: c.quiz.length, total: sections + points + c.terms.length + c.flashcards.length + c.quiz.length }
}

// What `next` adds on top of `base` (never negative).
export function addedCounts(baseRaw, nextRaw) {
  const a = itemCounts(baseRaw), b = itemCounts(nextRaw)
  const out = {}
  for (const k of ['sections', 'points', 'terms', 'flashcards', 'quiz', 'total']) out[k] = Math.max(0, b[k] - a[k])
  return out
}

export function sameContent(a, b) {
  return JSON.stringify(normalizeContent(a, MERGE_CAPS)) === JSON.stringify(normalizeContent(b, MERGE_CAPS))
}
