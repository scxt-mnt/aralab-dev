import test from 'node:test'
import assert from 'node:assert/strict'
import { wrapText, normalizeDiagrams, diagramHtml, diagramsHtml, DIAGRAM_KINDS } from '../../src/illustrations.js'

const THEME = { bg: '#fff', card: '#fff', ink: '#111', mute: '#777', acc: '#123456', line: '#ddd' }

test('wrapText: one short line stays as it is', () => {
  assert.deepEqual(wrapText('Photosynthesis', 48, 2), ['Photosynthesis'])
  assert.deepEqual(wrapText('   ', 48, 2), [''])
})

test('wrapText: long text wraps at the limit and ends in an ellipsis when cut', () => {
  const lines = wrapText('the quick brown fox jumps over the lazy dog again and again', 20, 2)
  assert.equal(lines.length, 2)
  assert.ok(lines.every(l => l.length <= 20))
  assert.match(lines[1], /…$/)
})

test('normalizeDiagrams: keeps only usable diagrams and neither invents nor crashes', () => {
  assert.deepEqual(normalizeDiagrams(null), [])
  assert.deepEqual(normalizeDiagrams([{ kind: 'flow', steps: ['only one'] }]), [])       // too short to draw
  assert.deepEqual(normalizeDiagrams([{ kind: 'bars', items: [{ label: 'a', value: 1 }] }]), [])
  assert.deepEqual(normalizeDiagrams([{ kind: 'symbols', items: [{ symbol: 'x' }] }]), [])  // no meaning
  const [d] = normalizeDiagrams([{ kind: 'mystery', title: 'T', steps: ['a', 'b'] }])
  assert.equal(d.kind, 'flow')                                                             // unknown kind falls back
  assert.equal(normalizeDiagrams(new Array(9).fill({ kind: 'flow', steps: ['a', 'b'] })).length, 4)  // at most 4
})

test('normalizeDiagrams: caps the lists and turns numbers into safe values', () => {
  const [bars] = normalizeDiagrams([{ kind: 'bars', unit: 'kg', items: Array.from({ length: 12 }, (_, i) => ({ label: `L${i}`, value: i === 0 ? 'nope' : i })) }])
  assert.equal(bars.items.length, 6)
  assert.equal(bars.items[0].value, 0)                                                     // junk value -> 0
  const [sym] = normalizeDiagrams([{ kind: 'symbols', items: Array.from({ length: 20 }, (_, i) => ({ symbol: `s${i}`, meaning: `m${i}` })) }])
  assert.equal(sym.items.length, 10)
})

test('diagramHtml: a flow is a figure with inline SVG and the theme colour', () => {
  const html = diagramHtml({ kind: 'flow', title: 'Mitosis', steps: ['Prophase', 'Metaphase', 'Anaphase'] }, THEME)
  assert.match(html, /^<figure class="dgwrap"><figcaption>Mitosis<\/figcaption><svg /)
  assert.match(html, /#123456/)
  assert.match(html, /Metaphase/)
})

test('diagramHtml: a cycle also prints the numbered list (readable without the picture)', () => {
  const html = diagramHtml({ kind: 'cycle', title: 'Krebs cycle', steps: ['A', 'B', 'C'] }, THEME)
  assert.match(html, /aria-label="Cycle diagram"/)
  assert.match(html, /class="dg-cycle"/)
  assert.equal((html.match(/<li>/g) || []).length, 3)
})

test('diagramHtml: bars show labels, values and the unit; symbols show a formula sheet', () => {
  const bars = diagramHtml({ kind: 'bars', title: 'Growth', unit: 'cm', items: [{ label: 'Year 1', value: 12 }, { label: 'Year 2', value: 1200 }] }, THEME)
  assert.match(bars, /aria-label="Bar chart"/)
  assert.match(bars, /Year 1/)
  assert.match(bars, /1,200 cm/)                                                           // big numbers get separators
  const sym = diagramHtml({ kind: 'symbols', items: [{ symbol: 'F', meaning: 'Force' }, { symbol: 'm', meaning: 'Mass' }] }, THEME)
  assert.match(sym, /class="dgsym"/)
  assert.match(sym, /<b>F<\/b><span>Force<\/span>/)
})

test('diagramHtml: nothing worth drawing renders an empty string', () => {
  assert.equal(diagramHtml(null), '')
  assert.equal(diagramHtml({ kind: 'flow', steps: ['one'] }), '')
  assert.equal(diagramHtml({ kind: 'bars', items: [{ label: 'a', value: 2 }] }), '')
})

test('diagramHtml: text from the AI is escaped (never injected as HTML)', () => {
  const html = diagramHtml({ kind: 'symbols', title: '<b>x</b>', items: [{ symbol: '<i>', meaning: '<script>alert(1)</script>' }, { symbol: 'b', meaning: 'ok' }] }, THEME)
  assert.equal(html.includes('<script>'), false)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/)
})

test('diagramHtml: a missing theme still draws with the fallback colours', () => {
  const html = diagramHtml({ kind: 'flow', steps: ['a', 'b'] }, null)
  assert.match(html, /<svg /)
  assert.match(html, /#6c7bf0/)
})

test('diagramsHtml: joins every diagram of a reviewer, in order', () => {
  const html = diagramsHtml({ diagrams: [
    { kind: 'flow', title: 'One', steps: ['a', 'b'] },
    { kind: 'symbols', title: 'Two', items: [{ symbol: 'F', meaning: 'Force' }, { symbol: 'm', meaning: 'Mass' }] },
  ] }, THEME)
  assert.ok(html.indexOf('One') < html.indexOf('Two'))
  assert.equal((html.match(/class="dgwrap"/g) || []).length, 2)
  assert.equal(diagramsHtml({}), '')
  assert.deepEqual(DIAGRAM_KINDS, ['flow', 'cycle', 'bars', 'symbols', 'map', 'compare', 'line', 'donut', 'timeline'])
})
