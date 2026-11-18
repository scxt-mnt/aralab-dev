import test from 'node:test'
import assert from 'node:assert/strict'
import { looksUniversity, syncUniversities } from '../../server/universities.js'

test('keeps state AND private schools, drops junk names', () => {
  for (const n of ['Bulacan State University', 'Ateneo de Manila University', 'De La Salle University', 'Colegio de San Juan de Letran']) assert.equal(looksUniversity(n), true, n)
  for (const n of ['', 'UP', 'x'.repeat(81)]) assert.equal(looksUniversity(n), false, n)
})

test('sync adds only new names (state or private) and never touches existing ones', async () => {
  const rows = [{ name: 'Bulacan State University' }]
  const inserted = []
  const db = { from: () => ({ select: async () => ({ data: rows }), insert: async r => { inserted.push(...r); return {} } }) }
  const fetchFn = async () => ({ ok: true, json: async () => [{ name: 'bulacan state university' }, { name: 'Sorsogon State University' }, { name: 'Ateneo de Manila University' }] })
  const r = await syncUniversities({ db, fetchFn })
  assert.deepEqual(r.added, ['Sorsogon State University', 'Ateneo de Manila University'])
  assert.equal(inserted.length, 2)
})
