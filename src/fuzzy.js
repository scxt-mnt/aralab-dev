// Typo-tolerant matching for free-text fields (subject, program, school, institute).
// Goal: one wrong letter must never create a second "Biology" / "Biolgy" / "biology " entry.

// lowercase, strip accents, collapse spaces/punctuation -> "bs information technology"
export const fkey = s => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
export const tidy = s => (s || '').replace(/\s+/g, ' ').trim()

// Damerau-Levenshtein (counts a swapped pair like "Phyiscs" as 1 edit)
export function distance(a, b) {
  if (a === b) return 0
  const n = a.length, m = b.length
  if (!n) return m
  if (!m) return n
  const d = Array.from({ length: n + 1 }, (_, i) => [i, ...Array(m).fill(0)])
  for (let j = 0; j <= m; j++) d[0][j] = j
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c)
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
  }
  return d[n][m]
}

const digits = s => s.replace(/\D/g, '')
// how many wrong letters we forgive, by length (short words must match exactly: "Math" vs "Mats" is risky)
const allowed = len => (len >= 12 ? 2 : len >= 5 ? 1 : 0)

// Is `a` a typo of `b`? Different numbers ("Math 1" vs "Math 2") are never a typo.
export function isTypo(a, b) {
  const x = fkey(a), y = fkey(b)
  if (!x || !y || x === y || digits(x) !== digits(y)) return false
  return distance(x, y) <= allowed(Math.max(x.length, y.length))
}

// Unique options (case/spacing-insensitive). Given [name, count] pairs, the most used spelling is shown.
export function uniqueOptions(list) {
  const seen = new Map()
  for (const o of list) {
    const [name, n = 1] = Array.isArray(o) ? o : [o, 1], t = tidy(name), k = fkey(t)
    if (!k) continue
    const e = seen.get(k) || { name: t, n: 0, best: -1 }
    e.n += n
    if (n > e.best) { e.name = t; e.best = n }
    seen.set(k, e)
  }
  return [...seen.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map(e => e.name)
}

// Everything the field should react to for what has been typed so far.
const MAX_OPTIONS = 500
export function suggest(value, options) {
  if (options.length > MAX_OPTIONS) options = options.slice(0, MAX_OPTIONS)   // lists are sorted most-used first
  const v = tidy(value), k = fkey(v)
  if (!k) return { exact: null, near: null, matches: options.slice(0, 6) }
  const exact = options.find(o => fkey(o) === k) || null
  const near = exact ? null : options.filter(o => isTypo(v, o)).sort((a, b) => distance(fkey(v), fkey(a)) - distance(fkey(v), fkey(b)))[0] || null
  const rank = o => { const ok = fkey(o); return ok === k ? 0 : ok.startsWith(k) ? 1 : ok.split(' ').some(w => w.startsWith(k)) ? 2 : ok.includes(k) ? 3 : isTypo(v, o) ? 4 : 9 }
  const matches = options.map(o => [o, rank(o)]).filter(([, r]) => r < 9).sort((a, b) => a[1] - b[1]).map(([o]) => o).slice(0, 6)
  return { exact, near, matches }
}

// What to save: the existing spelling when it is the same word typed differently, otherwise the tidy text.
export const canonical = (value, options) => { const { exact } = suggest(value, options); return exact || tidy(value) }
