import test from 'node:test'
import assert from 'node:assert/strict'
import { findUniversities, canonicalUniversity, acronym } from '../../src/schoolSearch.js'

const LIST = [
  'University of the Philippines Diliman', 'University of the Philippines Manila', 'Polytechnic University of the Philippines',
  'Pamantasan ng Lungsod ng Maynila', 'Far Eastern University', 'University of Santo Tomas', 'De La Salle University', 'Ateneo de Manila University',
  'Mapúa University', 'Bulacan State University', 'Silliman University',
]

test('shows nothing until two letters are typed', () => {
  assert.deepEqual(findUniversities('', LIST), [])
  assert.deepEqual(findUniversities('u', LIST), [])
  assert.ok(findUniversities('ul', LIST).length >= 0)
})

test('never lists more than the limit, even for a broad search', () => {
  const big = Array.from({ length: 500 }, (_, i) => `Sample University ${i}`)
  assert.equal(findUniversities('sample', big).length, 8)
  assert.equal(findUniversities('sample', big, 3).length, 3)
})

test('finds by any part of the name', () => {
  assert.equal(findUniversities('bulacan', LIST)[0], 'Bulacan State University')
  assert.ok(findUniversities('state univ', LIST).includes('Bulacan State University'))
  assert.equal(findUniversities('diliman', LIST)[0], 'University of the Philippines Diliman')
})

test('short names work (PUP, UST, DLSU, FEU, PLM, ADMU)', () => {
  assert.equal(findUniversities('pup', LIST)[0], 'Polytechnic University of the Philippines')
  assert.equal(findUniversities('ust', LIST)[0], 'University of Santo Tomas')
  assert.equal(findUniversities('dlsu', LIST)[0], 'De La Salle University')
  assert.equal(findUniversities('feu', LIST)[0], 'Far Eastern University')
  assert.equal(findUniversities('plm', LIST)[0], 'Pamantasan ng Lungsod ng Maynila')
  assert.equal(findUniversities('admu', LIST)[0], 'Ateneo de Manila University')
  assert.equal(acronym('Polytechnic University of the Philippines'), 'pup')
})

test('"UP" lists the UP campuses', () => {
  const r = findUniversities('up', LIST)
  assert.deepEqual(r.slice(0, 2).sort(), ['University of the Philippines Diliman', 'University of the Philippines Manila'])
})

test('forgives accents, case and one wrong letter', () => {
  assert.equal(findUniversities('MAPUA', LIST)[0], 'Mapúa University')
  assert.equal(findUniversities('Sillimen', LIST)[0], 'Silliman University')
})

test('canonicalUniversity returns the list spelling', () => {
  assert.equal(canonicalUniversity('mapua university', LIST), 'Mapúa University')
  assert.equal(canonicalUniversity('BULACAN STATE UNIVERSITY', LIST), 'Bulacan State University')
  assert.equal(canonicalUniversity('Nowhere University', LIST), null)
  assert.equal(canonicalUniversity('', LIST), null)
})
