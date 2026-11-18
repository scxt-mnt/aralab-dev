// Keeps the list of Philippine universities (state AND private) up to date from a public API (Hipo Labs "universities" dataset, no key needed).
// The admin can switch any school on/off or add one by hand (Moderation > Universities). Nothing the admin turned off is ever turned back on here.
export const SOURCES = ['https://universities.hipolabs.com/search?country=Philippines', 'http://universities.hipolabs.com/search?country=Philippines']
const clean = s => String(s || '').replace(/\s+/g, ' ').trim()

// the database keeps names between 3 and 80 characters (see state_uni_len); anything else would make the whole insert fail
export const looksUniversity = n => n.length >= 4 && n.length <= 80

export async function fetchRemote(fetchFn = fetch) {
  let last
  for (const url of SOURCES) {
    try {
      const r = await fetchFn(url, { signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      if (!Array.isArray(j)) throw new Error('Unexpected response')
      return j.map(x => clean(x?.name)).filter(Boolean)
    } catch (e) { last = e }
  }
  throw new Error(`University API unreachable (${last?.message || 'unknown'})`)
}

export async function syncUniversities({ db, fetchFn = fetch }) {
  const remote = await fetchRemote(fetchFn)
  const found = [...new Set(remote.filter(looksUniversity))]
  const { data: have, error } = await db.from('state_universities').select('name')
  if (error) throw new Error(error.message)
  const known = new Set((have || []).map(r => r.name.toLowerCase()))
  const fresh = found.filter(n => !known.has(n.toLowerCase()))
  if (fresh.length) {
    const { error: e2 } = await db.from('state_universities').insert(fresh.map(name => ({ name, source: 'api', active: true })))
    if (e2) throw new Error(e2.message)
  }
  return { checked: remote.length, matched: found.length, added: fresh, total: known.size + fresh.length }
}
