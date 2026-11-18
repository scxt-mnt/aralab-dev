// Suggestions for free-text profile fields, taken from what classmates already typed (so everyone ends up spelling "BS Information Technology" the same way).
import { useEffect, useState } from 'react'
import { sb } from './supabase'
import { PROGRAM_SUGGESTIONS } from './programs'
import { uniqueOptions } from './fuzzy'

let cache = null, pending = null
const count = rows => { const m = {}; rows.forEach(v => { const t = (v || '').replace(/\s+/g, ' ').trim(); if (t) m[t] = (m[t] || 0) + 1 }); return Object.entries(m) }
function load() {
  if (cache) return Promise.resolve(cache)
  pending = pending || sb.from('profiles').select('program,institute').limit(3000).then(({ data, error }) => {
    const rows = error ? [] : data || []
    cache = { programs: uniqueOptions([...count(rows.map(r => r.program)), ...PROGRAM_SUGGESTIONS.map(p => [p, 0])]), institutes: uniqueOptions(count(rows.map(r => r.institute))) }
    return cache
  }).catch(() => ({ programs: PROGRAM_SUGGESTIONS, institutes: [] }))
  return pending
}
export function useProfileOptions() {
  const [o, setO] = useState(cache || { programs: PROGRAM_SUGGESTIONS, institutes: [] })
  useEffect(() => { let live = true; load().then(r => live && setO(r)); return () => { live = false } }, [])
  return o
}
