// "My university": list, filter and sort the students of your school. Pure functions (unit tested).
import { programKey } from './programs.js'

// distinct programs with how many students have each (most common first); the most common spelling is shown
export function programsOf(list) {
  const m = new Map()
  for (const p of list) {
    const k = programKey(p.program); if (!k) continue
    const e = m.get(k) || { key: k, n: 0, spell: new Map() }
    e.n++; e.spell.set(p.program.trim(), (e.spell.get(p.program.trim()) || 0) + 1); m.set(k, e)
  }
  return [...m.values()].map(e => ({ key: e.key, n: e.n, label: [...e.spell.entries()].sort((a, b) => b[1] - a[1])[0][0] })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
}

const clean = q => String(q || '').toLowerCase().replace(/\s+/g, ' ').trim()
export function filterPeople(list, { q = '', program = '', mode = 'all' }, { following = new Set(), followers = new Set() } = {}) {
  const t = clean(q)
  return list.filter(p => {
    if (program && programKey(p.program) !== program) return false
    if (mode === 'new' && following.has(p.user_id)) return false
    if (mode === 'following' && !following.has(p.user_id)) return false
    if (mode === 'followers' && !followers.has(p.user_id)) return false
    if (!t) return true
    return clean(`${p.display_name} ${p.student_no} ${p.program} ${p.institute}`).includes(t)
  })
}

// same program as you first, then A to Z
export function sortPeople(list, myProgram, sort = 'program') {
  const mine = programKey(myProgram), name = p => clean(p.display_name) || 'zzz'
  return [...list].sort((a, b) => {
    if (sort === 'program' && mine) { const d = (programKey(b.program) === mine) - (programKey(a.program) === mine); if (d) return d }
    return name(a).localeCompare(name(b))
  })
}
