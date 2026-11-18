// Any file -> something the AI can read (v62). The server only understands PDF, images and plain text, so every other kind of
// file is turned into plain text HERE, in the browser, before it is uploaded. Nothing new is sent to the server and the server's
// own type checks stay exactly as they were.
//
//   Word .docx/.docm/.dotx      -> headings, paragraphs, tables, footnotes
//   Excel .xlsx/.xlsm/.xltx     -> every sheet, row by row (dates are shown as dates)
//   PowerPoint .pptx/.pptm/.ppsx-> every slide + speaker notes
//   OpenDocument .odt/.ods/.odp -> same as the three above
//   .epub, .rtf, .html/.htm, .ipynb
//   .csv .tsv .json .xml .yaml .md .txt .log .srt .vtt and source code -> read as text
//   anything else that turns out to be text (checked by looking at the bytes) -> read as text
//   old binary .doc/.xls/.ppt, audio, archives, unknown binaries -> a clear message saying what to do
//
// Pure functions + fflate (a tiny unzip library): no DOM, so the same code runs in the browser and in the tests.
import { unzipSync } from 'fflate'
import { looksLikeFinishedReviewer, parseReviewerHtml, parseReviewerText } from './reviewerImport.js'

export const MAX_CONVERTED_CHARS = 60000          // the server reads at most this much of a text file (aiFiles.js), so cut here and SAY so
export const MAX_SHEET_ROWS = 5000
const MAX_ENTRY = 60 * 1024 * 1024                // one file inside a zip may unpack to at most this much (zip-bomb guard)

const WORD = /^(docx|docm|dotx|dotm)$/, SHEETS = /^(xlsx|xlsm|xltx|xltm)$/, SLIDES = /^(pptx|pptm|potx|potm|ppsx|ppsm)$/
const ODF = /^(odt|ods|odp|ott|ots|otp)$/
const TEXTY = /^(txt|md|markdown|csv|tsv|json|jsonl|xml|yaml|yml|toml|ini|cfg|conf|log|srt|vtt|tex|rst|sql|js|jsx|ts|tsx|py|java|c|cc|cpp|h|hpp|cs|go|rs|rb|php|swift|kt|r|m|sh|bat|ps1|css|scss|lua|pl|dart|gradle|properties|env\.example|bib)$/
const OLD = { doc: 'Word 97-2003 (.doc)', xls: 'Excel 97-2003 (.xls)', ppt: 'PowerPoint 97-2003 (.ppt)', pages: 'Apple Pages', numbers: 'Apple Numbers', key: 'Apple Keynote' }

export const extOf = name => (String(name || '').match(/\.([A-Za-z0-9]+)$/)?.[1] || '').toLowerCase()
const MIME_KIND = [
  [/wordprocessingml|macroenabled\.12.*word/, 'docx'], [/spreadsheetml/, 'xlsx'], [/presentationml/, 'pptx'],
  [/opendocument\.text/, 'odt'], [/opendocument\.spreadsheet/, 'ods'], [/opendocument\.presentation/, 'odp'],
  [/epub/, 'epub'], [/\/rtf|text\/richtext/, 'rtf'], [/text\/html|xhtml/, 'html'],
]

// 'docx' | 'xlsx' | 'pptx' | 'odf' | 'epub' | 'rtf' | 'html' | 'ipynb' | 'text' | 'old' | 'sniff'   ('sniff' = unknown, decide by the bytes)
export function kindOf(file) {
  const e = extOf(file?.name), m = String(file?.type || '')
  if (WORD.test(e)) return 'docx'
  if (SHEETS.test(e)) return 'xlsx'
  if (SLIDES.test(e)) return 'pptx'
  if (ODF.test(e)) return 'odf'
  if (e === 'epub') return 'epub'
  if (e === 'rtf') return 'rtf'
  if (e === 'html' || e === 'htm' || e === 'xhtml') return 'html'
  if (e === 'ipynb') return 'ipynb'
  if (OLD[e]) return 'old'
  if (TEXTY.test(e)) return 'text'
  for (const [re, k] of MIME_KIND) if (re.test(m)) return k === 'odt' || k === 'ods' || k === 'odp' ? 'odf' : k
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/xml') return 'text'
  return 'sniff'
}

const NATIVE = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp']
// PDFs, images and plain .txt/.md go to the server as they are; EVERYTHING else is converted (or explained) first.
export const needsConversion = f => {
  if (NATIVE.includes(f?.type) || /\.pdf$/i.test(f?.name || '')) return false
  const e = extOf(f?.name)
  return !((e === 'txt' || e === 'md') && ['', 'text/plain', 'text/markdown'].includes(f?.type || ''))
}
// for the <input accept>: the types that work. Other files can still be dropped in and get a clear message.
export const ACCEPT = '.pdf,.txt,.md,.csv,.tsv,.json,.docx,.xlsx,.pptx,.docm,.xlsm,.pptm,.odt,.ods,.odp,.epub,.rtf,.html,.htm,.ipynb,.doc,.xls,.ppt,image/png,image/jpeg,image/webp'

// ---------- small helpers ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
export const unent = s => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n) } catch { return '' } }
  return ENT[e.toLowerCase()] ?? m
})
const dec = u8 => new TextDecoder('utf-8').decode(u8)
const tidy = s => String(s).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
const fail = (message) => Object.assign(new Error(message), { convert: true })
const attr = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]

// unzip only the entries we want (the rest, e.g. pictures and video, are never unpacked)
function unzip(u8, want) {
  try { return unzipSync(u8, { filter: e => e.originalSize <= MAX_ENTRY && want(e.name) }) }
  catch { throw fail('This file looks damaged or password-protected, so it could not be opened.') }
}
const textOf = (z, name) => (z[name] ? dec(z[name]) : '')
const byNum = (a, b) => (Number(a.match(/(\d+)\.xml$/)?.[1]) || 0) - (Number(b.match(/(\d+)\.xml$/)?.[1]) || 0)

// ---------- Word ----------
export function docxToText(u8) {
  const z = unzip(u8, n => /^word\/(document|footnotes|endnotes)\.xml$/.test(n))
  const xml = textOf(z, 'word/document.xml')
  if (!xml) throw fail('This does not look like a Word document.')
  // text is kept escaped (&lt; etc.) until the very end, so a "<" in the text is never mistaken for a tag
  const paraOf = p => {
    const h = p.match(/<w:pStyle\b[^>]*w:val="(?:Heading|heading|Title)\s*(\d?)"/)
    const t = [...p.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(m => m[1]).join('')
    return (h ? '#'.repeat(Math.min(6, Number(h[1]) || 1)) + ' ' : (/<w:numPr>/.test(p) || /<w:pStyle\b[^>]*w:val="List/.test(p)) ? '- ' : '') + t
  }
  const paras = x => [...x.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map(m => paraOf(m[1]))
  const body = part => {
    const s = part.replace(/<w:tab\b[^>]*\/>/g, '<w:t>\t</w:t>').replace(/<w:(br|cr)\b[^>]*\/>/g, '<w:t> </w:t>')
      .replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, tbl => '\n' + [...tbl.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)]
        .map(r => [...r[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map(c => paras(c[1]).join(' ').trim()).join(' | ')).join('\n') + '\n')
      .replace(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g, (_, p) => paraOf(p) + '\n')
    return unent(s.replace(/<[^>]*>/g, ''))
  }
  let out = body(xml)
  for (const n of ['word/footnotes.xml', 'word/endnotes.xml']) {
    const t = body(textOf(z, n)).trim()
    if (t) out += `\n\n## ${n.includes('foot') ? 'Footnotes' : 'Endnotes'}\n${t}`
  }
  return tidy(out)
}

// ---------- PowerPoint ----------
export function pptxToText(u8) {
  const z = unzip(u8, n => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(n))
  const slides = Object.keys(z).filter(n => n.startsWith('ppt/slides/')).sort(byNum)
  if (!slides.length) throw fail('This does not look like a PowerPoint file.')
  const para = xml => [...xml.matchAll(/<a:p\b[^>]*>([\s\S]*?)<\/a:p>/g)].map(p => unent([...p[1].matchAll(/<a:t\b[^>]*>([\s\S]*?)<\/a:t>/g)].map(m => m[1]).join(''))).filter(s => s.trim()).join('\n')
  const out = slides.map((n, i) => {
    const num = Number(n.match(/(\d+)\.xml$/)?.[1]) || i + 1
    const notes = z[`ppt/notesSlides/notesSlide${num}.xml`] ? para(textOf(z, `ppt/notesSlides/notesSlide${num}.xml`)).replace(/^\d+\s*$/gm, '').trim() : ''
    return `## Slide ${i + 1}\n${para(textOf(z, n))}${notes ? `\nSpeaker notes: ${notes}` : ''}`
  })
  return tidy(out.join('\n\n'))
}

// ---------- Excel ----------
const colNum = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1 }
const DATE_IDS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58])
const isDateFmt = code => /[dmyhs]/i.test(String(code).replace(/"[^"]*"|\\.|\[[^\]]*\]|_.|\*./g, '')) && !/^general$/i.test(code)
function serialToText(n) {
  if (!Number.isFinite(n) || n < 1 || n > 2958465) return String(n)
  const ms = Math.round((n - 25569) * 86400000), d = new Date(ms), iso = d.toISOString()
  return n % 1 === 0 ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ')
}
const cell = v => { const s = String(v ?? ''); return /[\t\n]/.test(s) ? s.replace(/[\t\n\r]+/g, ' ') : s }

export function xlsxToText(u8) {
  const z = unzip(u8, n => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|styles\.xml|worksheets\/[^/]+\.xml)$/.test(n))
  const wb = textOf(z, 'xl/workbook.xml')
  if (!wb) throw fail('This does not look like an Excel file.')
  const rels = Object.fromEntries([...textOf(z, 'xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b[^>]*>/g)].map(m => [attr(m[0], 'Id'), attr(m[0], 'Target')]))
  const shared = [...textOf(z, 'xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)]
    .map(m => unent([...m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')))
  // which cell styles are dates
  const styles = textOf(z, 'xl/styles.xml'), custom = {}
  for (const m of styles.matchAll(/<numFmt\b[^>]*>/g)) custom[attr(m[0], 'numFmtId')] = unent(attr(m[0], 'formatCode') || '')
  const xfs = styles.match(/<cellXfs\b[\s\S]*?<\/cellXfs>/)?.[0] || ''
  const dateStyle = [...xfs.matchAll(/<xf\b[^>]*>/g)].map(m => { const id = attr(m[0], 'numFmtId'); return DATE_IDS.has(Number(id)) || (custom[id] !== undefined && isDateFmt(custom[id])) })
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].map(m => ({ name: unent(attr(m[0], 'name') || 'Sheet'), hidden: /hidden/i.test(attr(m[0], 'state') || ''), target: rels[attr(m[0], 'r:id')] }))
  const out = []
  sheets.forEach((s, si) => {
    if (s.hidden) return
    const path = s.target ? (s.target.startsWith('/') ? s.target.slice(1) : `xl/${s.target}`) : `xl/worksheets/sheet${si + 1}.xml`
    const xml = textOf(z, path); if (!xml) return
    const rows = []
    for (const r of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      if (rows.length >= MAX_SHEET_ROWS) { rows.push(`… (more than ${MAX_SHEET_ROWS} rows, the rest is not shown)`); break }
      const vals = []; let next = 0
      for (const c of (r[1] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = attr(c[1], 'r'), t = attr(c[1], 't'), st = Number(attr(c[1], 's')) || 0, inner = c[2] || ''
        const idx = ref ? colNum(ref) : next; next = idx + 1
        let v = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/)?.[1]
        if (t === 'inlineStr') v = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => unent(m[1])).join('')
        else if (v === undefined || v === '') continue                 // a formula that was never calculated has an empty value
        else if (t === 's') v = shared[Number(v)] ?? ''
        else if (t === 'b') v = v === '1' ? 'TRUE' : 'FALSE'
        else if (t === 'str' || t === 'e') v = unent(v)
        else if (dateStyle[st]) v = serialToText(Number(v))
        else v = String(Number(v) === Number(v) && !/e/i.test(v) ? Number(v) : v)       // 0.10000000000000001 -> 0.1
        if (String(v).trim() === '') continue
        vals[idx] = cell(v)
      }
      if (vals.length) rows.push(Array.from(vals, x => x ?? '').join('\t'))
    }
    if (rows.length) out.push(`## Sheet: ${s.name}\n${rows.join('\n')}`)
  })
  if (!out.length) throw fail('This spreadsheet has no data in it.')
  return out.join('\n\n')
}

// ---------- OpenDocument (.odt .ods .odp) ----------
export function odfToText(u8) {
  const z = unzip(u8, n => n === 'content.xml' || n === 'mimetype')
  const xml = textOf(z, 'content.xml')
  if (!xml) throw fail('This does not look like an OpenDocument file.')
  const inline = s => unent(s.replace(/<text:tab\s*\/>/g, '\t').replace(/<text:line-break\s*\/>/g, '\n').replace(/<text:s(?:\s+text:c="(\d+)")?\s*\/>/g, (_, n) => ' '.repeat(Math.min(Number(n) || 1, 20))).replace(/<[^>]*>/g, ''))
  const paras = s => [...s.matchAll(/<text:(h|p)\b([^>]*)>([\s\S]*?)<\/text:\1>/g)].map(m => (m[1] === 'h' ? '#'.repeat(Math.min(6, Number(attr(m[2], 'text:outline-level')) || 1)) + ' ' : '') + inline(m[3])).filter(x => x.trim()).join('\n')
  const mime = textOf(z, 'mimetype')
  if (/spreadsheet/.test(mime) || /<office:spreadsheet\b/.test(xml)) {
    const out = []
    for (const t of xml.matchAll(/<table:table\b([^>]*)>([\s\S]*?)<\/table:table>/g)) {
      const rows = []
      for (const r of t[2].matchAll(/<table:table-row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:table-row>)/g)) {
        if (rows.length >= MAX_SHEET_ROWS) break
        const vals = []
        for (const c of (r[2] || '').matchAll(/<table:(?:covered-)?table-cell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/table:(?:covered-)?table-cell>)/g)) {
          const rep = Math.min(Number(attr(c[1], 'table:number-columns-repeated')) || 1, 30)
          let v = paras(c[2] || '').replace(/\n/g, ' ')
          if (!v && attr(c[1], 'office:value')) v = attr(c[1], 'office:value')
          if (!v && attr(c[1], 'office:date-value')) v = attr(c[1], 'office:date-value')
          for (let i = 0; i < (v ? rep : 1); i++) vals.push(v)
        }
        while (vals.length && !vals[vals.length - 1]) vals.pop()
        if (vals.length) rows.push(vals.map(cell).join('\t'))
      }
      if (rows.length) out.push(`## Sheet: ${unent(attr(t[1], 'table:name') || 'Sheet')}\n${rows.join('\n')}`)
    }
    if (!out.length) throw fail('This spreadsheet has no data in it.')
    return out.join('\n\n')
  }
  if (/presentation/.test(mime) || /<office:presentation\b/.test(xml)) {
    const pages = [...xml.matchAll(/<draw:page\b[^>]*>([\s\S]*?)<\/draw:page>/g)]
    return tidy(pages.map((p, i) => `## Slide ${i + 1}\n${paras(p[1])}`).join('\n\n'))
  }
  // text document: tables become " | " rows
  const withTables = xml.replace(/<table:table-row\b[^>]*>([\s\S]*?)<\/table:table-row>/g, (_, r) => '\n' + [...r.matchAll(/<table:table-cell\b[^>]*>([\s\S]*?)<\/table:table-cell>/g)].map(c => paras(c[1]).replace(/\n/g, ' ')).join(' | ') + '\n')
  const body = withTables.match(/<office:text\b[^>]*>([\s\S]*)<\/office:text>/)?.[1] || withTables
  const lines = []
  for (const piece of body.split(/(\n[^\n]*?\|[^\n]*\n)/)) lines.push(piece.startsWith('\n') && piece.includes(' | ') ? piece.trim() : paras(piece))
  return tidy(lines.filter(Boolean).join('\n'))
}

// ---------- HTML ----------
export function htmlToText(html) {
  let s = String(html).replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|head|svg|noscript)\b[\s\S]*?<\/\1>/gi, '')
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n, t) => `\n\n${'#'.repeat(Number(n))} ${t.replace(/<[^>]*>/g, '')}\n`)
    .replace(/<li\b[^>]*>/gi, '\n- ').replace(/<\/t[dh]>/gi, ' | ').replace(/<\/tr>/gi, '\n').replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|ul|ol|table|blockquote|pre|figure)>/gi, '\n\n')
  return tidy(unent(s.replace(/<[^>]*>/g, '')).replace(/ \| \n/g, '\n').replace(/[ \t]{2,}/g, ' '))
}

// ---------- EPUB ----------
export function epubToText(u8) {
  const z = unzip(u8, n => /\.(x?html?|opf|xml)$/i.test(n))
  const opfPath = attr(textOf(z, 'META-INF/container.xml').match(/<rootfile\b[^>]*>/)?.[0] || '', 'full-path') || Object.keys(z).find(n => n.endsWith('.opf'))
  const opf = opfPath ? textOf(z, opfPath) : ''
  const dir = opfPath && opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
  const manifest = Object.fromEntries([...opf.matchAll(/<item\b[^>]*>/g)].map(m => [attr(m[0], 'id'), attr(m[0], 'href')]))
  let order = [...opf.matchAll(/<itemref\b[^>]*>/g)].map(m => manifest[attr(m[0], 'idref')]).filter(Boolean).map(h => dir + decodeURI(h))
  if (!order.length) order = Object.keys(z).filter(n => /\.x?html?$/i.test(n)).sort()
  const out = order.map(n => z[n] ? htmlToText(dec(z[n])) : '').filter(Boolean)
  if (!out.length) throw fail('Could not find any text in this book.')
  return out.join('\n\n')
}

// ---------- RTF ----------
export function rtfToText(rtf) {
  const s = String(rtf); let out = '', depth = 0, skipAt = -1, i = 0
  const SKIP = /^(fonttbl|colortbl|stylesheet|info|pict|header|footer|\*)/
  while (i < s.length) {
    const ch = s[i]
    if (ch === '{') { depth++; if (skipAt < 0 && SKIP.test(s.slice(i + 1).replace(/^\\/, '')) ) skipAt = depth; i++ }
    else if (ch === '}') { if (depth === skipAt) skipAt = -1; depth--; i++ }
    else if (ch === '\\') {
      const m = s.slice(i).match(/^\\([a-zA-Z]+)(-?\d+)? ?|^\\'([0-9a-fA-F]{2})|^\\([\\{}])|^\\(.)/)
      if (!m) { i++; continue }
      i += m[0].length
      if (skipAt >= 0) continue
      if (m[3]) out += String.fromCharCode(parseInt(m[3], 16))
      else if (m[4]) out += m[4]
      else if (m[1] === 'par' || m[1] === 'line' || m[1] === 'row') out += '\n'
      else if (m[1] === 'tab' || m[1] === 'cell') out += '\t'
      else if (m[1] === 'u' && m[2]) { out += String.fromCharCode(Number(m[2]) < 0 ? Number(m[2]) + 65536 : Number(m[2])); i += s[i] === '?' ? 1 : 0 }
    } else { if (skipAt < 0 && ch !== '\r' && ch !== '\n') out += ch; i++ }
  }
  return tidy(out)
}

// ---------- Jupyter ----------
export function ipynbToText(json) {
  let nb; try { nb = JSON.parse(json) } catch { throw fail('This notebook could not be read.') }
  const src = c => (Array.isArray(c.source) ? c.source.join('') : String(c.source || ''))
  return tidy((nb.cells || []).map(c => (c.cell_type === 'code' ? '```\n' + src(c) + '\n```' : src(c))).join('\n\n'))
}

// ---------- plain text, whatever its encoding ----------
export function decodeText(u8) {
  if (u8[0] === 0xff && u8[1] === 0xfe) return new TextDecoder('utf-16le').decode(u8.subarray(2))
  if (u8[0] === 0xfe && u8[1] === 0xff) return new TextDecoder('utf-16be').decode(u8.subarray(2))
  try { return new TextDecoder('utf-8', { fatal: true }).decode(u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf ? u8.subarray(3) : u8) }
  catch { return new TextDecoder('windows-1252').decode(u8) }        // Excel's "CSV" and old Notepad files
}
// does this look like text? (no NUL bytes, almost no control characters)
export function looksLikeText(u8) {
  const n = Math.min(u8.length, 8192); if (!n) return false
  if ((u8[0] === 0xff && u8[1] === 0xfe) || (u8[0] === 0xfe && u8[1] === 0xff)) return true
  let bad = 0
  for (let i = 0; i < n; i++) { const b = u8[i]; if (b === 0) return false; if (b < 9 || (b > 13 && b < 32)) bad++ }
  return bad / n < 0.02
}

// ---------- the one entry point ----------
// bytes (Uint8Array) + name/type -> { text, kind }. Throws an Error (with .convert = true) that a student can act on.
export function convertBytes(u8, { name = 'file', type = '' } = {}) {
  const f = { name, type }, kind = kindOf(f), e = extOf(name)
  let text
  switch (kind) {
    case 'old': throw fail(`${name} is ${OLD[e]}, an old format that can’t be read in the browser. Open it and use File > Save as > ${e === 'doc' ? 'Word Document (.docx)' : e === 'xls' ? 'Excel Workbook (.xlsx)' : e === 'ppt' ? 'PowerPoint (.pptx)' : 'PDF'}, then add that.`)
    case 'docx': text = docxToText(u8); break
    case 'xlsx': text = xlsxToText(u8); break
    case 'pptx': text = pptxToText(u8); break
    case 'odf': text = odfToText(u8); break
    case 'epub': text = epubToText(u8); break
    case 'rtf': text = rtfToText(decodeText(u8)); break
    case 'html': {
      text = htmlToText(decodeText(u8))
      // a self-contained reviewer keeps its data in <script>; htmlToText removes scripts, so if almost nothing is left
      // the AI would be given an empty file. Keep the script text as a fallback (the reviewer importer handles the
      // common S/T/C/Q format before this point).
      if (text.length < 200) {
        const scripts = [...decodeText(u8).matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).join('\n').trim()
        if (scripts) text = `${text}\n\n${scripts.slice(0, 20000)}`.trim()
      }
      break
    }
    case 'ipynb': text = ipynbToText(decodeText(u8)); break
    case 'text': text = decodeText(u8); break
    default:
      if (u8[0] === 0x50 && u8[1] === 0x4b) {                          // a zip with an unknown name: maybe a renamed Office file
        const names = Object.keys(unzip(u8, () => true))
        if (names.includes('word/document.xml')) { text = docxToText(u8); break }
        if (names.includes('xl/workbook.xml')) { text = xlsxToText(u8); break }
        if (names.some(n => n.startsWith('ppt/slides/'))) { text = pptxToText(u8); break }
        throw fail(`${name} is a compressed archive. Unzip it and add the files inside.`)
      }
      if (u8[0] === 0xd0 && u8[1] === 0xcf) throw fail(`${name} is an old Office file (.doc/.xls/.ppt). Save it as .docx/.xlsx/.pptx or PDF and add that.`)
      if (!looksLikeText(u8)) throw fail(`${name} is a file type the AI can’t read (${e ? '.' + e : 'unknown type'}). Use PDF, Word, Excel, PowerPoint, an image or a text file.`)
      text = decodeText(u8)
  }
  text = String(text).replace(/\r\n?/g, '\n').replace(/\u0000/g, '')
  if (!text.trim()) throw fail(`No readable text was found in ${name}. If it is a scan or a picture of text, add it as a PDF or an image instead.`)
  if (text.length > MAX_CONVERTED_CHARS) text = text.slice(0, MAX_CONVERTED_CHARS).trimEnd() + `\n\n[The rest of this file was cut: only the first ${MAX_CONVERTED_CHARS.toLocaleString('en')} characters can be read.]`
  return { text, kind }
}

export const convertedName = name => `${String(name).replace(/\.[^.]+$/, '')} (from ${extOf(name) || 'file'}).txt`

// File -> File. PDFs, images and plain text pass through untouched; everything else becomes a text/plain File.
export async function convertFile(file) {
  if (!needsConversion(file)) return file
  const u8 = new Uint8Array(await file.arrayBuffer())
  const kind = kindOf(file)
  const { text } = convertBytes(u8, { name: file.name, type: file.type })
  const out = new File([text], convertedName(file.name), { type: 'text/plain' })
  out.original = file          // v78: kept so the pictures inside a Word / PowerPoint file can still be used
  // v71: if this file is ALREADY a reviewer, remember its structure. The request then applies the Study Flow
  // layout to it instead of asking the AI to rewrite (and shorten) the reviewer again.
  try {
    const content = kind === 'html' ? parseReviewerHtml(decodeText(u8)) : parseReviewerText(text, file.name)
    if (content && looksLikeFinishedReviewer(content, file.name, { html: kind === 'html' })) out.importContent = content
  } catch { /* a normal notes file: generation is unchanged */ }
  return out
}
