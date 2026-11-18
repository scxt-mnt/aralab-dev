// v84: tiny spaced-review memory (Leitner boxes) kept on this device. A missed question or card comes back tomorrow, a known one in 3 / 7 / 14 days.
const DAY = 86400000, GAPS = [1, 3, 7, 14]
const key = user => `rl-sr:${user}`
export const itemId = (rid, text) => `${rid}:${String(text || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 80)}`
export function loadSR(user) { try { const m = JSON.parse(localStorage.getItem(key(user)) || '{}'); return m && typeof m === 'object' ? m : {} } catch { return {} } }
export function saveSR(user, m) { try { const keep = Object.entries(m).sort((a, b) => b[1].due - a[1].due).slice(0, 1500); localStorage.setItem(key(user), JSON.stringify(Object.fromEntries(keep))) } catch { /* storage full or private mode */ } }
export function grade(m, id, ok, now = Date.now()) {
  const box = ok ? Math.min((m[id]?.box ?? -1) + 1, GAPS.length - 1) : 0
  return { ...m, [id]: { box, due: now + GAPS[box] * DAY, miss: ok ? (m[id]?.miss || 0) : (m[id]?.miss || 0) + 1 } }
}
// due ones that were seen before come first (that is the review), then ones never seen; items not due yet are left for later
export function pick(list, m, rid, textOf, n, now = Date.now()) {
  const state = x => { const e = m[itemId(rid, textOf(x))]; return !e ? 'new' : e.due <= now ? 'due' : 'later' }
  const due = list.filter(x => state(x) === 'due'), fresh = list.filter(x => state(x) === 'new'), later = list.filter(x => state(x) === 'later')
  return [...due, ...fresh, ...later].slice(0, n)
}
export const dueCount = (list, m, rid, textOf, now = Date.now()) => list.filter(x => { const e = m[itemId(rid, textOf(x))]; return e && e.due <= now }).length
