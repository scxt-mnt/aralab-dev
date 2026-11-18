import test from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { convertBytes, convertFile, kindOf, needsConversion, convertedName, MAX_CONVERTED_CHARS, htmlToText, rtfToText } from '../../src/fileConvert.js'

const zip = files => zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])))
const conv = (u8, name, type = '') => convertBytes(u8, { name, type })

test('kinds are found by extension or mime type', () => {
  assert.equal(kindOf({ name: 'a.XLSX' }), 'xlsx'); assert.equal(kindOf({ name: 'a.pptx' }), 'pptx'); assert.equal(kindOf({ name: 'a.docx' }), 'docx')
  assert.equal(kindOf({ name: 'x', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), 'xlsx')
  assert.equal(kindOf({ name: 'a.doc' }), 'old'); assert.equal(kindOf({ name: 'a.csv' }), 'text'); assert.equal(kindOf({ name: 'noext' }), 'sniff')
})
test('PDFs, images and plain .txt/.md pass through; the rest is converted', () => {
  assert.equal(needsConversion({ name: 'a.pdf', type: 'application/pdf' }), false)
  assert.equal(needsConversion({ name: 'a.png', type: 'image/png' }), false)
  assert.equal(needsConversion({ name: 'a.txt', type: 'text/plain' }), false)
  assert.equal(needsConversion({ name: 'a.md', type: '' }), false)
  for (const n of ['a.csv', 'a.docx', 'a.xlsx', 'a.html', 'a.json']) assert.equal(needsConversion({ name: n, type: 'text/plain' }), true, n)
})

test('docx: headings, paragraphs, tables, tabs, escaped characters', () => {
  const w = x => `<w:document><w:body>${x}</w:body></w:document>`
  const p = (t, style) => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`
  const xml = w(p('Cell Biology', 'Heading1') + p('Mitochondria &amp; ribosomes: a &lt; b') +
    '<w:tbl><w:tr><w:tc>' + p('Organelle') + '</w:tc><w:tc>' + p('Job') + '</w:tc></w:tr><w:tr><w:tc>' + p('Nucleus') + '</w:tc><w:tc>' + p('DNA') + p('storage') + '</w:tc></w:tr></w:tbl>' + p('After the table'))
  const { text, kind } = conv(zip({ 'word/document.xml': xml }), 'notes.docx')
  assert.equal(kind, 'docx')
  assert.match(text, /^# Cell Biology\nMitochondria & ribosomes: a < b\n/)
  assert.match(text, /Organelle \| Job\nNucleus \| DNA storage\nAfter the table/)
})

const SHEET_XML = rows => `<worksheet><sheetData>${rows}</sheetData></worksheet>`
test('xlsx: every sheet, shared strings, numbers, booleans, dates, gaps, hidden sheets skipped', () => {
  const files = {
    'xl/workbook.xml': '<workbook><sheets><sheet name="Grades" sheetId="1" r:id="rId1"/><sheet name="Secret" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Schedule &amp; Dates" sheetId="3" r:id="rId3"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Target="worksheets/sheet3.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>Name</t></si><si><t>Score</t></si><si><r><t>Ana </t></r><r><t>Cruz</t></r></si></sst>',
    'xl/styles.xml': '<styleSheet><numFmts><numFmt numFmtId="170" formatCode="dd/mm/yyyy"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="170"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': SHEET_XML('<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Pass</t></is></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>93.5</v></c><c r="D2" t="b"><v>1</v></c></row><row r="3"><c r="A3" t="str"><f>A2</f><v>Ana Cruz</v></c><c r="B3"><v>0.30000000000000004</v></c></row>'),
    'xl/worksheets/sheet2.xml': SHEET_XML('<row><c r="A1" t="inlineStr"><is><t>hidden</t></is></c></row>'),
    'xl/worksheets/sheet3.xml': SHEET_XML('<row r="1"><c r="A1" s="1"><v>46000</v></c><c r="B1" s="2"><v>46000.5</v></c><c r="C1"><v>46000</v></c></row>'),
  }
  const { text } = conv(zip(files), 'grades.xlsx')
  assert.match(text, /## Sheet: Grades\nName\tScore\t\tPass\nAna Cruz\t93.5\t\tTRUE\nAna Cruz\t0\.3000/)
  assert.ok(!text.includes('hidden'))
  assert.match(text, /## Sheet: Schedule & Dates\n2025-12-09\t2025-12-09 12:00\t46000/)
})
test('xlsx: a file with no data, and a file that is not an xlsx, give clear errors', () => {
  const base = { 'xl/workbook.xml': '<workbook><sheets><sheet name="A" r:id="rId1"/></sheets></workbook>', 'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>', 'xl/worksheets/sheet1.xml': SHEET_XML('') }
  assert.throws(() => conv(zip(base), 'e.xlsx'), /no data/)
  assert.throws(() => conv(zip({ 'a.txt': 'x' }), 'e.xlsx'), /does not look like an Excel/)
  assert.throws(() => conv(new Uint8Array([1, 2, 3, 4]), 'e.xlsx'), /damaged|password/)
})

test('pptx: slides in numeric order with speaker notes', () => {
  const sl = t => `<p:sld><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:sld>`
  const files = { 'ppt/slides/slide10.xml': sl('Ten'), 'ppt/slides/slide2.xml': sl('Two') + '<a:p><a:r><a:t>second line</a:t></a:r></a:p>', 'ppt/slides/slide1.xml': sl('One'), 'ppt/notesSlides/notesSlide2.xml': '<p:notes><a:p><a:r><a:t>say hi</a:t></a:r></a:p><a:p><a:r><a:t>2</a:t></a:r></a:p></p:notes>' }
  const { text } = conv(zip(files), 'deck.pptx')
  assert.equal(text, '## Slide 1\nOne\n\n## Slide 2\nTwo\nsecond line\nSpeaker notes: say hi\n\n## Slide 3\nTen')
})

test('OpenDocument: text, spreadsheet (repeated empty cells), presentation', () => {
  const odt = zip({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<office:document-content><office:body><office:text><text:h text:outline-level="2">Photosynthesis</text:h><text:p>Light<text:s text:c="2"/>reactions &amp; Calvin<text:tab/>cycle</text:p><table:table><table:table-row><table:table-cell><text:p>A</text:p></table:table-cell><table:table-cell><text:p>B</text:p></table:table-cell></table:table-row></table:table></office:text></office:body></office:document-content>' })
  assert.equal(conv(odt, 'a.odt').text, '## Photosynthesis\nLight  reactions & Calvin\tcycle\nA | B')
  const ods = zip({ mimetype: 'application/vnd.oasis.opendocument.spreadsheet', 'content.xml': '<office:document-content><office:spreadsheet><table:table table:name="S1"><table:table-row><table:table-cell office:value-type="string"><text:p>x</text:p></table:table-cell><table:table-cell table:number-columns-repeated="1000"/></table:table-row><table:table-row table:number-rows-repeated="900"><table:table-cell table:number-columns-repeated="1024"/></table:table-row><table:table-row><table:table-cell office:value="5"><text:p>5</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet></office:document-content>' })
  assert.equal(conv(ods, 'a.ods').text, '## Sheet: S1\nx\n5')
  const odp = zip({ mimetype: 'application/vnd.oasis.opendocument.presentation', 'content.xml': '<office:document-content><office:presentation><draw:page><text:p>First</text:p></draw:page><draw:page><text:p>Second</text:p></draw:page></office:presentation></office:document-content>' })
  assert.equal(conv(odp, 'a.odp').text, '## Slide 1\nFirst\n\n## Slide 2\nSecond')
})

test('epub follows the reading order; html, rtf and ipynb become text', () => {
  const epub = zip({
    'META-INF/container.xml': '<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>',
    'OEBPS/content.opf': '<package><manifest><item id="b" href="b.xhtml"/><item id="a" href="a.xhtml"/></manifest><spine><itemref idref="a"/><itemref idref="b"/></spine></package>',
    'OEBPS/a.xhtml': '<html><body><h1>One</h1><p>First chapter.</p></body></html>', 'OEBPS/b.xhtml': '<html><body><p>Second chapter.</p></body></html>',
  })
  assert.equal(conv(epub, 'book.epub').text, '# One\nFirst chapter.\n\nSecond chapter.')
  assert.equal(htmlToText('<style>p{}</style><h2>Hi</h2><ul><li>a</li><li>b &amp; c</li></ul><table><tr><td>1</td><td>2</td></tr></table><script>x()</script>'), '## Hi\n\n- a\n- b & c\n\n1 | 2')
  assert.equal(rtfToText('{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}\\f0 Hello \\b world\\b0\\par Caf\\\'e9 \\u8364? ok}'), 'Hello world\nCafé € ok')
  const nb = JSON.stringify({ cells: [{ cell_type: 'markdown', source: ['# T'] }, { cell_type: 'code', source: ['print(1)'] }] })
  assert.equal(conv(strToU8(nb), 'n.ipynb').text, '# T\n\n```\nprint(1)\n```')
})

test('text files: CSV in Excel\'s encoding, utf-16, unknown extensions that are really text', () => {
  assert.equal(conv(new Uint8Array([78, 97, 109, 101, 44, 99, 97, 102, 233]), 'a.csv', 'text/csv').text, 'Name,café')
  const u16 = new Uint8Array([0xff, 0xfe, ...[...'hi'].flatMap(c => [c.charCodeAt(0), 0])])
  assert.equal(conv(u16, 'a.txt.bak').text, 'hi')
  assert.equal(conv(strToU8('{"a":1}'), 'data.json', 'application/json').text, '{"a":1}')
  assert.equal(conv(strToU8('plain words'), 'README').text, 'plain words')
})
test('what cannot be read says why and what to do', () => {
  assert.throws(() => conv(new Uint8Array(50), 'a.doc'), /Save as > Word Document \(\.docx\)/)
  assert.throws(() => conv(new Uint8Array(50), 'a.xls'), /\.xlsx/)
  assert.throws(() => conv(new Uint8Array([0, 1, 2, 3, 0, 0]), 'song.mp3'), /can’t read/)
  assert.throws(() => conv(zip({ 'x.png': 'x' }), 'bundle.zip'), /Unzip it/)
  assert.throws(() => conv(strToU8('   \n '), 'blank.csv'), /No readable text/)
  assert.throws(() => conv(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0]), 'mystery.bin'), /old Office file/)
})
test('a renamed Office file is still recognised by what is inside it', () => {
  const docx = zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>' })
  assert.equal(conv(docx, 'upload.dat').text, 'Hello')
})
test('long output is cut at the limit the server reads, and says so', () => {
  const r = conv(strToU8('x'.repeat(MAX_CONVERTED_CHARS + 5000)), 'big.csv')
  assert.ok(r.text.startsWith('x'.repeat(100))); assert.match(r.text, /The rest of this file was cut/)
  assert.ok(r.text.length < MAX_CONVERTED_CHARS + 200)
})
test('an HTML page whose content lives only in a script still gives the AI its text', () => {
  const html = '<html><head><title>Abbreviations</title></head><body><h1>Abbreviations</h1><script>const T=[["e.g.","for example"]];</script></body></html>'
  const r = conv(strToU8(html), 'Abbreviations.html')
  assert.match(r.text, /Abbreviations/)
  assert.match(r.text, /for example/)
})
test('convertFile gives back a text/plain File and leaves PDFs alone', async () => {
  const pdf = new File([new Uint8Array([37, 80, 68, 70])], 'a.pdf', { type: 'application/pdf' })
  assert.equal(await convertFile(pdf), pdf)
  const x = new File([zip({ 'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hi</w:t></w:r></w:p></w:body></w:document>' })], 'My Notes.docx')
  const out = await convertFile(x)
  assert.equal(out.type, 'text/plain'); assert.equal(out.name, 'My Notes (from docx).txt'); assert.equal(await out.text(), 'Hi')
  assert.equal(convertedName('a.b.xlsx'), 'a.b (from xlsx).txt')
})
