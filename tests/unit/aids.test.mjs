import test from 'node:test'
import assert from 'node:assert/strict'
import { createFake } from '../fakeSupabase.js'
import { runGenerate } from '../../server/generateFlow.js'
import { AID_IDS, STRATEGIES, cleanAids, aidsPrompt } from '../../src/aids.js'
import { normalizeContent, renderReviewer, sampleFor, plainText, TEMPLATE_INFO, THEMES } from '../../src/render.js'

test('cleanAids drops unknown ids, duplicates and non-arrays', () => {
  assert.deepEqual(cleanAids(['traps', 'nope', 'traps', 'timeline']), ['traps', 'timeline'])
  assert.deepEqual(cleanAids('abbreviations'), []); assert.deepEqual(cleanAids(null), [])
  assert.ok(cleanAids(AID_IDS).length <= 8)
})
test('every strategy preset only uses real aids', () => { for (const s of Object.values(STRATEGIES)) assert.deepEqual(cleanAids(s.aids), s.aids) })
test('aidsPrompt is empty without aids and lists shape + rule per chosen aid', () => {
  assert.equal(aidsPrompt([]), '')
  const p = aidsPrompt(['abbreviations', 'comparisons'])
  assert.match(p, /"abbreviations":\[/); assert.match(p, /"comparisons":\[/); assert.doesNotMatch(p, /"traps":\[/)
})
test('normalizeContent keeps clean extras, drops junk, pads comparison rows, adds no keys when unused', () => {
  assert.equal(Object.keys(normalizeContent({ title: 't' })).includes('abbreviations'), false)
  const c = normalizeContent({
    abbreviations: [{ abbr: 'ATP', meaning: 'Adenosine triphosphate' }, { abbr: 'x' }, 7],
    comparisons: [{ title: 'A vs B', headers: ['', 'A', 'B'], rows: [['r1', 'a'], 'junk'] }, { title: 'bad', headers: ['only one'], rows: [['x']] }],
    traps: [{ mistake: 'm' }], keyFacts: ['f', '', 3], timeline: [{ label: '1', detail: 'd' }],
  })
  assert.equal(c.abbreviations.length, 1); assert.equal(c.comparisons.length, 1)
  assert.deepEqual(c.comparisons[0].rows[0], ['r1', 'a', '']); assert.equal(c.comparisons[0].rows[1].length, 3)
  assert.equal(c.traps, undefined); assert.deepEqual(c.keyFacts, ['f', '3']); assert.equal(c.timeline.length, 1)
})
test('study aids are escaped, searchable, and shown by every template and theme', () => {
  const evil = normalizeContent({ title: 't', sections: [{ heading: 'h', points: ['p'] }], abbreviations: [{ abbr: '<img src=x onerror=1>', meaning: '<b>bold</b>' }] })
  for (const t of Object.keys(TEMPLATE_INFO)) { const h = renderReviewer(evil, t); assert.ok(!h.includes('<img src=x') && !h.includes('<b>bold</b>'), t) }
  const full = sampleFor(AID_IDS)
  assert.match(plainText(normalizeContent(full)), /Adenosine/)
  for (const t of Object.keys(TEMPLATE_INFO)) for (const th of Object.keys(THEMES)) {
    const h = renderReviewer(full, t, th)
    for (const w of ['Abbreviations', 'Prokaryote vs eukaryote', 'Common mistakes', 'Timeline', 'Memory tricks', 'Must-know facts', 'Apply it']) assert.ok(h.includes(w), `${t}/${th} is missing ${w}`)
    assert.ok(!/\{\{/.test(h), `${t}/${th} has an unresolved token`)
  }
})
test('no template is named after a subject', () => { for (const v of Object.values(TEMPLATE_INFO)) assert.doesNotMatch(v.label + v.description, /profed|prof ed/i) })
test('generation: chosen aids reach the AI prompt and the extras are saved in the reviewer', async () => {
  let system = ''
  const body = JSON.stringify({ title: 'T', summary: 's', sections: [{ heading: 'h', points: ['p'] }], abbreviations: [{ abbr: 'ATP', meaning: 'Adenosine triphosphate' }] })
  const f = createFake({
    tokens: { adm: { id: 'admin' } },
    tables: { admins: [{ user_id: 'admin' }], profiles: [{ user_id: 'stu', school: 'S' }], astra_members: [], usage: [], reviewers: [],
      reviewer_requests: [{ id: 'r1', user_id: 'stu', title: 'T', subject: 'S', topic: 't', coverage: 'c', template: 'studydeck', theme: 'indigo', aids: ['abbreviations', 'bogus'], status: 'pending', files: [{ path: 'stu/r1/a.txt', name: 'a.txt', type: 'text/plain', size: 5 }] }] },
    files: { 'notes/stu/r1/a.txt': { data: [104, 105] } },
  })
  const r = await runGenerate({ db: f.client, authHeader: 'Bearer adm', body: { requestId: 'r1' }, key: 'k', ai: { generateJson: async o => { system = o.system; return { text: body, tokens: 1, model: 'm' } } } })
  assert.equal(r.status, 200)
  assert.match(system, /"abbreviations":\[/); assert.doesNotMatch(system, /bogus/)
  const rv = f.db.tables.reviewers[0]
  assert.equal(rv.content.abbreviations[0].abbr, 'ATP'); assert.ok(rv.html.includes('Adenosine'))
})
