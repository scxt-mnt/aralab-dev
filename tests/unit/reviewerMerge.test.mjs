import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeContent, addedCounts, itemCounts, sameContent, MERGE_CAPS } from '../../src/reviewerMerge.js'

const base = {
  title: 'Cell Biology',
  summary: 'Cells and what they do',
  sections: [{ heading: 'Cell parts', points: ['Nucleus stores DNA', 'Ribosomes build proteins'] }],
  terms: [{ term: 'DNA', definition: 'Genetic material' }],
  flashcards: [{ q: 'Powerhouse of the cell?', a: 'Mitochondria' }],
  quiz: [{ q: 'Which organelle makes ATP?', choices: ['Nucleus', 'Mitochondria'], answer: 1, why: 'Respiration happens there.' }],
}

test('a newer upload adds what is missing and never overwrites what the Library already has', () => {
  const next = {
    ...base,
    sections: [{ heading: 'Cell parts', points: ['Nucleus stores DNA', 'Ribosomes build proteins', 'Mitochondria make ATP'] }, { heading: 'Respiration', points: ['Glycolysis splits glucose'] }],
    terms: [{ term: 'DNA', definition: 'Carrier of genes' }, { term: 'ATP', definition: 'Energy currency' }],
  }
  const merged = mergeContent(base, next)
  assert.equal(merged.sections.length, 2)
  assert.deepEqual(merged.sections[0].points, ['Nucleus stores DNA', 'Ribosomes build proteins', 'Mitochondria make ATP'])
  assert.deepEqual(merged.sections[1].points, ['Glycolysis splits glucose'])
  assert.equal(merged.terms.length, 2)
  assert.equal(merged.terms.find(t => t.term === 'DNA').definition, 'Genetic material')  // add-only: the old wording stays
  assert.deepEqual(addedCounts(base, merged), { sections: 1, points: 2, terms: 1, flashcards: 0, quiz: 0, total: 4 })
})

test('a longer version of an existing point replaces the short one (the detail is new)', () => {
  const next = { ...base, sections: [{ heading: 'Cell parts', points: ['Nucleus stores DNA and controls the cell'] }] }
  const merged = mergeContent(base, next)
  assert.deepEqual(merged.sections[0].points, ['Nucleus stores DNA and controls the cell', 'Ribosomes build proteins'])
})

test('an AI fix keeps every item the AI left out (a fix can only grow the reviewer)', () => {
  const ai = { title: 'Cell Biology', summary: 'Cells', sections: [{ heading: 'Cell parts', points: ['Nucleus stores DNA', 'Cell membrane controls entry'] }] }
  const merged = mergeContent(base, ai, { overwrite: true })
  assert.equal(merged.sections[0].heading, 'Cell parts')
  assert.ok(merged.sections[0].points.includes('Cell membrane controls entry'))
  assert.ok(merged.sections[0].points.includes('Nucleus stores DNA'))
  assert.ok(merged.sections[0].points.includes('Ribosomes build proteins'))       // AI dropped it; it is taken back
  assert.equal(merged.terms.length, 1)                                             // AI dropped them; the old aids stay
  assert.equal(merged.flashcards.length, 1)
  assert.equal(merged.quiz.length, 1)
})

test('an AI fix may correct a matched item but keeps sections it did not touch', () => {
  const ai = { title: 'Cell Biology', sections: [{ heading: 'Cell parts', points: ['Nucleus stores DNA', 'Ribosomes build proteins'] }, { heading: 'Respiration', points: ['Mitochondria make ATP'] }] }
  const merged = mergeContent({ ...base, sections: [...base.sections, { heading: 'Old topic', points: ['Old point'] }] }, ai, { overwrite: true })
  assert.equal(merged.sections[0].heading, 'Cell parts')
  assert.equal(merged.sections[1].heading, 'Respiration')
  assert.equal(merged.sections[2].heading, 'Old topic')                            // existing-only section is kept
  assert.ok(merged.sections[2].points.includes('Old point'))
})

test('merge caps are generous enough to keep a large uploaded reviewer', () => {
  const big = { ...base, sections: [...base.sections, ...Array.from({ length: 30 }, (_, i) => ({ heading: `Topic ${i + 1}`, points: Array.from({ length: 25 }, (_, k) => `Point ${i}-${k}`) }))] }
  const merged = mergeContent(base, big)
  assert.equal(merged.sections.length, 31)
  assert.equal(merged.sections.slice(1).every(s => s.points.length === 25), true)
  assert.ok(MERGE_CAPS.sections >= 40 && MERGE_CAPS.points >= 30)
})

test('extras (abbreviations, mnemonics, key facts …) survive a merge from either side', () => {
  const a = { ...base, abbreviations: [{ abbr: 'DNA', meaning: 'Deoxyribonucleic acid' }], keyFacts: ['Cells are the unit of life'] }
  const b = { ...base, abbreviations: [{ abbr: 'ATP', meaning: 'Adenosine triphosphate' }], traps: [{ mistake: 'DNA is a protein', correct: 'DNA is a nucleic acid' }] }
  const merged = mergeContent(a, b)
  assert.deepEqual(merged.abbreviations.map(x => x.abbr), ['DNA', 'ATP'])
  assert.deepEqual(merged.keyFacts, ['Cells are the unit of life'])
  assert.deepEqual(merged.traps.map(x => x.mistake), ['DNA is a protein'])
})

test('the same content is detected, so nothing new can be refused instead of silently doing nothing', () => {
  assert.equal(sameContent(base, mergeContent(base, base)), true)
  assert.equal(sameContent(base, mergeContent(base, { ...base, sections: [{ heading: 'Cell parts', points: ['Nucleus stores DNA', 'Brand new point'] }] })), false)
  assert.deepEqual(addedCounts(base, mergeContent(base, base)), { sections: 0, points: 0, terms: 0, flashcards: 0, quiz: 0, total: 0 })
  assert.equal(itemCounts(base).total, 1 + 2 + 1 + 1 + 1)
})

// ---- v75 ---------------------------------------------------------------------------------------------------------
const PICS = [
  { name: 'Cell membrane', url: 'data:image/jpeg;base64,AAAA' },
  { name: 'Video slide', url: 'data:image/png;base64,BBBB' },
]

test('v75: the pictures of a reviewer survive every merge (an update never drops a student\'s own images)', () => {
  const withPics = { ...base, visuals: PICS }
  assert.deepEqual(mergeContent(withPics, base).visuals, PICS)                 // add-only merge keeps them
  assert.deepEqual(mergeContent(base, withPics).visuals, PICS)                 // they also travel from the new copy
  assert.deepEqual(mergeContent(withPics, withPics, { overwrite: true }).visuals, PICS)
  assert.deepEqual(mergeContent({ ...withPics, visuals: [] }, base).visuals, [])
  assert.equal(mergeContent(base, { ...base, visuals: [{ name: 'x', url: 'https://example.com/x.jpg' }] }).visuals.length, 0)  // only real data URIs
})

test('v75: diagrams merge add-only — a refresh can add a drawing but never lose one', () => {
  const flow = { kind: 'flow', title: 'Mitosis', steps: ['Prophase', 'Metaphase', 'Anaphase'] }
  const bars = { kind: 'bars', title: 'Cell sizes', unit: 'µm', items: [{ label: 'Bacterium', value: 2 }, { label: 'Human egg', value: 100 }] }
  const merged = mergeContent({ ...base, diagrams: [flow] }, { ...base, diagrams: [bars] })
  assert.deepEqual(merged.diagrams.map(d => d.title), ['Mitosis', 'Cell sizes'])
  // the same diagram on both sides is not duplicated
  const twice = mergeContent({ ...base, diagrams: [flow] }, { ...base, diagrams: [flow] })
  assert.equal(twice.diagrams.length, 1)
  // an unusable diagram (one step) is ignored instead of breaking the merge
  assert.equal(mergeContent({ ...base, diagrams: [flow] }, { ...base, diagrams: [{ kind: 'flow', title: 'Bad', steps: ['only'] }] }).diagrams.length, 1)
  // diagrams are not counted as content, so "nothing new" stays about what students actually study
  assert.equal(itemCounts({ ...base, diagrams: [flow] }).total, itemCounts(base).total)
  assert.equal(addedCounts({ ...base, diagrams: [flow] }, { ...base, diagrams: [flow, bars] }).total, 0)
})
