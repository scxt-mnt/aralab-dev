// Philippine universities, state and private. The live list comes from the database (table state_universities, the name is historic), which the
// server refreshes from a public API (see server/universities.js) and the admin can edit. The built-in list below is only a fallback if the database can't be reached.
// The list is long, so screens never show all of it: they search it while the student types (see schoolSearch.js and SchoolInput.jsx).
import { useEffect, useState } from 'react'
import { sb } from './supabase'

const FALLBACK = [
  'University of the Philippines Diliman', 'University of the Philippines Manila', 'University of the Philippines Los Baños',
  'University of the Philippines Visayas', 'University of the Philippines Cebu', 'University of the Philippines Mindanao', 'University of the Philippines Baguio',
  'Polytechnic University of the Philippines', 'Polytechnic University of the Philippines Taguig', 'Technological University of the Philippines',
  'Pamantasan ng Lungsod ng Maynila', 'Pamantasan ng Lungsod ng Taguig', 'Rizal Technological University', 'Philippine Normal University',
  'Bulacan State University', 'Cavite State University', 'Batangas State University', 'Laguna State Polytechnic University', 'Bicol University',
  'Central Luzon State University', 'Pampanga State Agricultural University', 'Tarlac State University', 'Pangasinan State University', 'Mariano Marcos State University',
  'Benguet State University', 'Isabela State University', 'Cagayan State University', 'Mindanao State University', 'Mindoro State University',
  'Palawan State University', 'West Visayas State University', 'Iloilo Science and Technology University', 'Cebu Technological University', 'Eastern Visayas State University',
  'Leyte Normal University', 'Visayas State University', 'University of Southeastern Philippines', 'Caraga State University', 'Central Mindanao University', 'Davao del Norte State College',
]
let list = FALLBACK, loading = null
const subs = new Set()
export async function loadUniversities(force = false) {
  if (loading && !force) return loading
  loading = sb.from('state_universities').select('name').eq('active', true).order('name').limit(2000).then(({ data, error }) => {
    if (!error && data?.length) { list = data.map(r => r.name); subs.forEach(f => f(list)) }
  }).catch(() => {})
  return loading
}
export function useUniversities() {
  const [l, setL] = useState(list)
  useEffect(() => { subs.add(setL); setL(list); loadUniversities(); return () => { subs.delete(setL) } }, [])
  return l
}
export const normSchool = s => (s || '').replace(/\s+/g, ' ').trim().slice(0, 80)
export const sameSchool = (a, b) => normSchool(a).toLowerCase() === normSchool(b).toLowerCase() && !!normSchool(a)
export const isUniversity = s => list.some(u => sameSchool(u, s))
export const PICK_UNI = 'Choose your university from the suggestions (start typing its name).'
