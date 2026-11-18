// "Suggested for you" (v59): a SHORT strip above the Library. It does not re-sort or filter the Library itself.
// With a small student population we keep the rules simple and explainable (no machine learning):
//   * same program as the reviewer's author                    (+3)  "Same program"
//   * program words appear in the title/subject ("nursing")    (+2)  "Fits your program"
//   * same subject as a reviewer you made or starred           (+2 / +1.5)  "Like your <subject> reviewer"
//   * same university                                          (+0.5)
//   * a little for stars and for being recent, only to break ties
// A reviewer needs at least one of the first four to be suggested at all, so a popular but unrelated reviewer never shows up.
import { programKey } from './programs.js'

const SKIP = new Set(['bachelor', 'science', 'sciences', 'arts', 'studies', 'major', 'program', 'doctor', 'degree', 'master', 'with', 'and', 'the', 'for', 'of', 'in'])
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9ñ ]+/gi, ' ').replace(/\s+/g, ' ').trim()
export const programWords = p => [...new Set(norm(programKey(p)).split(' ').filter(w => w.length > 3 && !SKIP.has(w)))]

export const MAX_SUGGESTIONS = 4, PER_SUBJECT = 2

// items: reviewers; ctx: { me, program, school, starred:Set, people:{id:{program,school}}, now }
// -> [{ item, score, reason }] best first, at most MAX_SUGGESTIONS
export function suggestReviewers(items, ctx = {}) {
  const { me, program = '', school = '', starred = new Set(), people = {}, now = Date.now() } = ctx
  const pKey = programKey(program), pWords = programWords(program), mySchool = norm(school)
  const mine = (items || []).filter(i => i.owner_id && i.owner_id === me)
  const interest = new Map()                                    // subject -> weight
  const bump = (s, w) => { if (s && s !== 'Unsorted') interest.set(s, Math.max(interest.get(s) || 0, w)) }
  mine.forEach(i => bump(i.subject, 2))
  ;(items || []).forEach(i => { if (starred.has(i.id)) bump(i.subject, 1.5) })

  const scored = []
  for (const i of items || []) {
    if (!i || i.removed_at || i.is_public === false || i.owner_id === me || starred.has(i.id)) continue
    const owner = people[i.owner_id] || {}
    let score = 0, reason = '', rel = 0
    const hit = (pts, why) => { rel += pts; score += pts; if (!reason) reason = why }
    if (pKey && owner.program && programKey(owner.program) === pKey) hit(3, 'Same program')
    const hay = norm(`${i.title} ${i.subject}`)
    if (pWords.some(w => hay.includes(w))) hit(2, 'Fits your program')
    const w = interest.get(i.subject)
    if (w) hit(w, `Like your ${i.subject} reviewer`)
    if (mySchool && norm(owner.school) === mySchool) score += 0.5
    if (!rel) continue
    score += Math.min(1, (i.stars || 0) * 0.2)
    if (i.added && now - i.added < 30 * 864e5) score += 0.5
    scored.push({ item: i, score, reason })
  }
  scored.sort((a, b) => b.score - a.score || (b.item.added || 0) - (a.item.added || 0))
  const out = [], per = {}
  for (const s of scored) {
    if ((per[s.item.subject] || 0) >= PER_SUBJECT) continue       // keep the strip varied
    per[s.item.subject] = (per[s.item.subject] || 0) + 1
    out.push(s); if (out.length >= MAX_SUGGESTIONS) break
  }
  return out
}
