// Search for a Philippine university while typing. Pure functions (unit tested), no React.
// Nothing is listed until at least 2 letters are typed, and only the best few matches are shown, so the long list never fills the screen.
// Students also type short names, so "PUP", "UST", "DLSU", "FEU" or "PLM" work too (first letters of the words, skipping "of", "the", "ng"...).
import { fkey, distance } from './fuzzy.js'

const SKIP = new Set(['of', 'the', 'and', 'ng', 'at', 'for', 'sa'])
export const acronym = name => fkey(name).split(' ').filter(w => w && !SKIP.has(w)).map(w => w[0]).join('')

function rank(name, k, kc) {
  const nk = fkey(name)
  if (nk === k) return 0
  if (nk.startsWith(k)) return 1
  const ac = acronym(name)
  if (kc.length >= 2 && ac === kc) return 1
  if (kc.length >= 2 && ac.startsWith(kc)) return 2
  if ((' ' + nk).includes(' ' + k)) return 3
  if (nk.includes(k)) return 4
  if (k.length >= 5) {
    const allowed = k.length >= 8 ? 2 : 1
    if (distance(k, nk.slice(0, k.length)) <= allowed) return 5
    if (nk.split(' ').some(w => w.length >= 4 && distance(k, w) <= allowed)) return 5
  }
  return 9
}

export function findUniversities(query, list, max = 8) {
  const k = fkey(query)
  if (k.length < 2) return []
  const kc = k.replace(/ /g, '')
  const seen = new Set(), out = []
  for (const name of list || []) {
    const nk = fkey(name)
    if (!nk || seen.has(nk)) continue
    seen.add(nk)
    const r = rank(name, k, kc)
    if (r < 9) out.push([name, r])
  }
  return out.sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])).slice(0, max).map(([n]) => n)
}

// the exact spelling used in the list for something typed in any case or without accents, or null
export const canonicalUniversity = (value, list) => {
  const k = fkey(value)
  return k ? (list || []).find(n => fkey(n) === k) || null : null
}
