// v75: small, hand-drawn diagrams for the ideas that are easier to SEE than to read.
// The AI returns a tiny structured object (steps, numbers, symbols) and this file turns it into real inline SVG,
// so a reviewer can show a process, a cycle, a bar graph or a formula sheet without any image service.
// Pure (no DOM, no network), shared by the server render and the browser preview.
// No import from render.js: render.js imports this file, and a cycle would be fragile.
const FALLBACK_THEME = { bg: '#f5f6fa', card: '#ffffff', ink: '#1f2740', mute: '#6f7995', acc: '#6c7bf0', line: '#e6e9f2' }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const arr = x => (Array.isArray(x) ? x : [])
const num = (n, max = 1e9) => { const v = Number(n); return Number.isFinite(v) ? Math.max(0, Math.min(max, v)) : 0 }
export const DIAGRAM_KINDS = ['flow', 'cycle', 'bars', 'symbols', 'map', 'compare', 'line', 'donut', 'timeline']

// Break a line into at most `maxLines` short lines, ending in "…" when it had to be cut.
export function wrapText(text, maxChars = 48, maxLines = 2) {
  const src = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (!src) return ['']
  const words = src.split(' '), lines = []
  let line = ''
  for (const w of words) {
    if (!line) line = w
    else if (line.length + 1 + w.length <= maxChars) line += ` ${w}`
    else { lines.push(line); line = w; if (lines.length >= maxLines) break }
  }
  if (line && lines.length < maxLines) lines.push(line)
  const kept = lines.slice(0, maxLines)
  const shown = kept.join(' ')
  if (shown.length < src.length) kept[kept.length - 1] = `${kept[kept.length - 1].replace(/[.\s]+$/, '')}…`
  return kept
}

const themeOf = t => (t && t.acc ? t : FALLBACK_THEME)
const caption = title => (title ? `<figcaption>${esc(title)}</figcaption>` : '')

// ---- a numbered process, top to bottom -------------------------------------------------------------
function flowSvg(steps, t) {
  const W = 640, boxW = 560, x = (W - boxW) / 2, rowH = 56, gap = 30, pad = 10
  const lines = steps.map(s => wrapText(s, 56, 2))
  const heights = lines.map(l => (l.length > 1 ? 44 : rowH))
  const H = pad * 2 + heights.reduce((a, b) => a + b, 0) + gap * (steps.length - 1)
  let y = pad, out = ''
  steps.forEach((_, i) => {
    const h = heights[i], cy = y + h / 2
    out += `<rect x="${x}" y="${y}" width="${boxW}" height="${h}" rx="14" fill="${t.card}" stroke="${t.line}" stroke-width="1.5"/>`
    out += `<circle cx="${x + 30}" cy="${cy}" r="15" fill="${t.acc}"/>`
    out += `<text x="${x + 30}" y="${cy + 5}" text-anchor="middle" font-size="15" font-weight="700" fill="#fff">${i + 1}</text>`
    const l = lines[i], startY = l.length > 1 ? cy - 8 : cy + 5
    l.forEach((part, k) => { out += `<text x="${x + 58}" y="${startY + k * 19}" font-size="15" fill="${t.ink}">${esc(part)}</text>` })
    if (i < steps.length - 1) {
      const y0 = y + h + 4, y1 = y + h + gap - 6
      out += `<path d="M${W / 2} ${y0} L${W / 2} ${y1}" stroke="${t.acc}" stroke-width="2" stroke-linecap="round"/>`
      out += `<path d="M${W / 2 - 5} ${y1 - 5} L${W / 2} ${y1} L${W / 2 + 5} ${y1 - 5}" fill="none" stroke="${t.acc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    }
    y += h + gap
  })
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Process diagram">${out}</svg>`
}

// ---- a cycle of stages around a ring ---------------------------------------------------------------
function cycleSvg(steps, t) {
  const n = steps.length, W = 320, H = 300, cx = W / 2, cy = H / 2, R = 100, r = 28
  const at = a => [cx + R * Math.cos(a), cy + R * Math.sin(a)]
  let out = `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${t.line}" stroke-width="1.5" stroke-dasharray="4 6"/>`
  for (let i = 0; i < n; i++) {
    const a0 = -Math.PI / 2 + (i * 2 * Math.PI) / n, a1 = -Math.PI / 2 + ((i + 1) * 2 * Math.PI) / n
    const d = Math.asin(Math.min(0.6, r / R))
    const [x0, y0] = at(a0 + d), [x1, y1] = at(a1 - d)
    out += `<path d="M${x0.toFixed(1)} ${y0.toFixed(1)} A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" fill="none" stroke="${t.acc}" stroke-width="2"/>`
    const [ax, ay] = at(a1 - d), [bx, by] = at(a1 - d - 0.09)
    out += `<path d="M${(ax + (ay - cy) * 0.035).toFixed(1)} ${(ay - (ax - cx) * 0.035).toFixed(1)} L${ax.toFixed(1)} ${ay.toFixed(1)} L${(ax - (ay - cy) * 0.035).toFixed(1)} ${(ay + (ax - cx) * 0.035).toFixed(1)}" fill="none" stroke="${t.acc}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
    const [px, py] = at(a0)
    out += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${r}" fill="${t.card}" stroke="${t.acc}" stroke-width="2"/>`
    out += `<text x="${px.toFixed(1)}" y="${(py + 6).toFixed(1)}" text-anchor="middle" font-size="17" font-weight="800" fill="${t.acc}">${i + 1}</text>`
  }
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cycle diagram">${out}</svg>`
}

// ---- horizontal bars for numbers that compare ------------------------------------------------------
function barsSvg(items, unit, t) {
  const W = 640, labelW = 170, valueW = 64, area = W - labelW - valueW - 8, barH = 24, gap = 16, pad = 8
  const max = Math.max(1, ...items.map(i => i.value))
  const H = pad * 2 + items.length * (barH + gap) - gap
  let out = ''
  items.forEach((it, i) => {
    const y = pad + i * (barH + gap), w = Math.max(3, (it.value / max) * area)
    out += `<text x="0" y="${y + barH / 2 + 5}" font-size="14" fill="${t.ink}">${esc(wrapText(it.label, 22, 1)[0])}</text>`
    out += `<rect x="${labelW}" y="${y}" width="${area}" height="${barH}" rx="8" fill="${t.line}" opacity=".45"/>`
    out += `<rect x="${labelW}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="8" fill="${t.acc}"><animate attributeName="width" from="0" to="${w.toFixed(1)}" dur=".5s" fill="freeze"/></rect>`
    out += `<text x="${W}" y="${y + barH / 2 + 5}" text-anchor="end" font-size="14" font-weight="700" fill="${t.ink}">${esc(fmtNum(it.value))}${unit ? ` ${esc(unit)}` : ''}</text>`
  })
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Bar chart">${out}</svg>`
}
const fmtNum = n => (Math.abs(n) >= 1000 ? n.toLocaleString('en-US') : String(Math.round(n * 100) / 100))

// ---- graphs: line chart, donut, timeline (v78). Numbers come from the notes; nothing is invented. -----
const PALETTE = ['#6c7bf0', '#f0a14a', '#3fb97a', '#e0527a', '#4ab8d8', '#a76cf0', '#8f9bb3']
function lineSvg(items, unit, t) {
  const W = 640, H = 250, L = 46, R = 16, T = 26, B = 46, iw = W - L - R, ih = H - T - B
  const max = Math.max(1, ...items.map(i => i.value)), n = items.length
  const X = i => L + (n === 1 ? iw / 2 : (i * iw) / (n - 1)), Y = v => T + ih - (v / max) * ih
  let out = ''
  for (let g = 0; g <= 3; g++) { const y = T + (ih * g) / 3; out += `<line x1="${L}" y1="${y}" x2="${W - R}" y2="${y}" stroke="${t.line}" stroke-width="1"/><text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${t.mute}">${esc(fmtNum((max * (3 - g)) / 3))}</text>` }
  const pts = items.map((it, i) => `${X(i).toFixed(1)},${Y(it.value).toFixed(1)}`).join(' ')
  out += `<polygon points="${X(0)},${T + ih} ${pts} ${X(n - 1)},${T + ih}" fill="${t.acc}" opacity=".14"/><polyline points="${pts}" fill="none" stroke="${t.acc}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>`
  items.forEach((it, i) => {
    out += `<circle cx="${X(i)}" cy="${Y(it.value)}" r="5" fill="${t.card}" stroke="${t.acc}" stroke-width="3"/>`
    out += `<text x="${X(i)}" y="${Y(it.value) - 11}" text-anchor="middle" font-size="12" font-weight="700" fill="${t.ink}">${esc(fmtNum(it.value))}</text>`
    out += `<text x="${X(i)}" y="${H - 22}" text-anchor="middle" font-size="11.5" fill="${t.mute}">${esc(wrapText(it.label, n > 7 ? 7 : 11, 1)[0])}</text>`
  })
  if (unit) out += `<text x="${L}" y="12" font-size="11.5" fill="${t.mute}">${esc(unit)}</text>`
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Line chart">${out}</svg>`
}
function donutSvg(items, unit, t) {
  const W = 640, H = 230, cx = 130, cy = 115, r = 72, sw = 30, C = 2 * Math.PI * r
  const total = items.reduce((s, i) => s + i.value, 0) || 1
  let out = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${t.line}" stroke-width="${sw}" opacity=".5"/>`, off = 0
  items.forEach((it, i) => {
    const len = (it.value / total) * C, col = i === 0 ? t.acc : PALETTE[i % PALETTE.length]
    out += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${col}" stroke-width="${sw}" stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${(C - Math.max(0, len - 2)).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`
    off += len
    const y = 30 + i * 28
    out += `<rect x="290" y="${y - 12}" width="16" height="16" rx="5" fill="${col}"/><text x="316" y="${y + 1}" font-size="14" fill="${t.ink}">${esc(wrapText(it.label, 30, 1)[0])}</text><text x="${W}" y="${y + 1}" text-anchor="end" font-size="14" font-weight="700" fill="${t.ink}">${esc(fmtNum(it.value))}${unit ? ` ${esc(unit)}` : ''} · ${Math.round((it.value / total) * 100)}%</text>`
  })
  out += `<text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="800" fill="${t.ink}">${esc(fmtNum(total))}</text><text x="${cx}" y="${cy + 17}" text-anchor="middle" font-size="12" fill="${t.mute}">${unit ? esc(unit) : 'total'}</text>`
  return `<svg viewBox="0 0 ${W} ${Math.max(H, 30 + items.length * 28 + 10)}" role="img" aria-label="Donut chart">${out}</svg>`
}
const timelineHtml2 = items => `<ol class="dgtl">${items.map((x, i) => `<li style="--h:${(i * 47 + 215) % 360}"><b>${esc(x.label)}</b>${x.note ? `<span>${esc(x.note)}</span>` : ''}</li>`).join('')}</ol>`

// ---- a concept map: the topic in the middle, its parts around it (v77) -----------------------------
function mapSvg(center, branches, t) {
  const W = 640, rowH = 70, bh = 54, boxW = 232, pad = 10
  const left = branches.filter((_, i) => i % 2 === 0), right = branches.filter((_, i) => i % 2 === 1)
  const rows = Math.max(left.length, right.length), H = pad * 2 + rows * rowH, cx = W / 2, cy = H / 2
  let out = ''
  const side = (list, isLeft) => list.forEach((b, k) => {
    const off = ((rows - list.length) * rowH) / 2, y = pad + off + k * rowH + (rowH - bh) / 2, x = isLeft ? pad : W - pad - boxW
    const midY = y + bh / 2, ex = isLeft ? x + boxW : x, sx = cx + (isLeft ? -50 : 50), dir = isLeft ? -1 : 1
    out += `<path d="M${sx} ${cy} C${sx + dir * 70} ${cy},${ex - dir * 70} ${midY},${ex} ${midY}" fill="none" stroke="${t.acc}" stroke-width="2" stroke-linecap="round" opacity=".6"/>`
    out += `<rect x="${x}" y="${y}" width="${boxW}" height="${bh}" rx="14" fill="${t.card}" stroke="${t.acc}" stroke-width="1.6"/>`
    out += `<rect x="${isLeft ? x : x + boxW - 8}" y="${y + 10}" width="8" height="${bh - 20}" rx="4" fill="${t.acc}"/>`
    const lab = wrapText(b.label, 26, 2), tx = x + 20
    const base = lab.length > 1 ? y + 21 : b.note ? y + 23 : y + 32
    lab.forEach((part, i) => { out += `<text x="${tx}" y="${base + i * 17}" font-size="14" font-weight="700" fill="${t.ink}">${esc(part)}</text>` })
    if (lab.length === 1 && b.note) out += `<text x="${tx}" y="${y + 41}" font-size="12" fill="${t.mute}">${esc(wrapText(b.note, 32, 1)[0])}</text>`
  })
  side(left, true); side(right, false)
  const c = wrapText(center, 13, 3), cr = 52
  out += `<circle cx="${cx}" cy="${cy}" r="${cr + 7}" fill="${t.acc}" opacity=".16"/><circle cx="${cx}" cy="${cy}" r="${cr}" fill="${t.acc}"/>`
  c.forEach((part, i) => { out += `<text x="${cx}" y="${cy + 5 + (i - (c.length - 1) / 2) * 17}" text-anchor="middle" font-size="14" font-weight="800" fill="#fff">${esc(part)}</text>` })
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Concept map">${out}</svg>`
}

// ---- two things side by side (v77) -------------------------------------------------------------------
const compareHtml2 = d => `<div class="dgcmp">${[d.left, d.right].map((s, i) => `<div class="dgc c${i}"><h4>${esc(s.name)}</h4><ul>${s.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>`).join('<span class="dgvs">VS</span>')}</div>`

// ---- a formula / symbol sheet ----------------------------------------------------------------------
const symbolsHtml = items => `<div class="dgsym">${items.map((x, i) => `<div class="dgs" style="--h:${(i * 47 + 215) % 360}"><b>${esc(x.symbol)}</b><span>${esc(x.meaning)}</span></div>`).join('')}</div>`

// One normalized diagram -> HTML (figure with inline SVG). '' when there is nothing worth drawing.
export function diagramHtml(d, theme) {
  const t = themeOf(theme)
  if (!d || typeof d !== 'object') return ''
  const kind = DIAGRAM_KINDS.includes(d.kind) ? d.kind : 'flow'
  if (kind === 'map') {
    if (arr(d.branches).length < 2) return ''
    return `<figure class="dgwrap">${caption(d.title)}${mapSvg(d.center || d.title || 'Topic', d.branches, t)}</figure>`
  }
  if (kind === 'compare') {
    if (!d.left || !d.right || !d.left.points.length || !d.right.points.length) return ''
    return `<figure class="dgwrap">${caption(d.title)}${compareHtml2(d)}</figure>`
  }
  if (kind === 'symbols') {
    if (arr(d.items).length < 2) return ''
    return `<figure class="dgwrap">${caption(d.title)}${symbolsHtml(d.items)}</figure>`
  }
  if (kind === 'line' || kind === 'donut' || kind === 'timeline') {
    if (arr(d.items).length < 2) return ''
    const body = kind === 'line' ? lineSvg(d.items, d.unit, t) : kind === 'donut' ? donutSvg(d.items, d.unit, t) : timelineHtml2(d.items)
    return `<figure class="dgwrap">${caption(d.title)}${body}</figure>`
  }
  if (kind === 'bars') {
    if (arr(d.items).length < 2) return ''
    return `<figure class="dgwrap">${caption(d.title)}${barsSvg(d.items, d.unit, t)}</figure>`
  }
  const steps = arr(d.steps).filter(Boolean).slice(0, 8)
  if (steps.length < 2) return ''
  return `<figure class="dgwrap">${caption(d.title)}${kind === 'cycle' ? cycleSvg(steps, t) : flowSvg(steps, t)}${kind === 'cycle'
    ? `<ol class="dg-cycle">${steps.map((s, i) => `<li><b>${i + 1}</b><span>${esc(s)}</span></li>`).join('')}</ol>` : ''}</figure>`
}

// All diagrams of a reviewer (already normalized by render.js).
export const diagramsHtml = (c, theme) => arr(c?.diagrams).map(d => diagramHtml(d, theme)).join('')

// Normalize what the AI returned. Anything unusable is dropped instead of drawn empty.
export function normalizeDiagrams(raw) {
  return arr(raw).slice(0, 4).map(d => {
    const kind = DIAGRAM_KINDS.includes(d?.kind) ? d.kind : 'flow'
    const title = String(d?.title ?? '').slice(0, 120)
    if (kind === 'map') return { kind, title, center: String(d?.center ?? title).slice(0, 60), branches: arr(d?.branches).slice(0, 8).map(x => ({ label: String(x?.label ?? '').slice(0, 70), note: String(x?.note ?? '').slice(0, 90) })).filter(x => x.label) }
    if (kind === 'compare') { const side = s => ({ name: String(s?.name ?? '').slice(0, 50), points: arr(s?.points).slice(0, 5).map(x => String(x ?? '').slice(0, 120)).filter(Boolean) }); return { kind, title, left: side(d?.left), right: side(d?.right) } }
    if (kind === 'symbols') return { kind, title, items: arr(d?.items).slice(0, 10).map(x => ({ symbol: String(x?.symbol ?? '').slice(0, 24), meaning: String(x?.meaning ?? '').slice(0, 140) })).filter(x => x.symbol && x.meaning) }
    if (kind === 'line' || kind === 'donut') return { kind, title, unit: String(d?.unit ?? '').slice(0, 16), items: arr(d?.items).slice(0, kind === 'line' ? 12 : 7).map(x => ({ label: String(x?.label ?? '').slice(0, 40), value: num(x?.value) })).filter(x => x.label) }
    if (kind === 'timeline') return { kind, title, items: arr(d?.items).slice(0, 8).map(x => ({ label: String(x?.label ?? x?.when ?? '').slice(0, 40), note: String(x?.note ?? x?.what ?? '').slice(0, 140) })).filter(x => x.label) }
    if (kind === 'bars') return { kind, title, unit: String(d?.unit ?? '').slice(0, 16), items: arr(d?.items).slice(0, 6).map(x => ({ label: String(x?.label ?? '').slice(0, 60), value: num(x?.value) })).filter(x => x.label) }
    return { kind, title, steps: arr(d?.steps).slice(0, 8).map(x => String(x ?? '').slice(0, 140)).filter(Boolean) }
  }).filter(d => (d.kind === 'map' ? d.branches.length >= 2 : d.kind === 'compare' ? d.left.name && d.right.name && d.left.points.length && d.right.points.length : d.items ? d.items.length >= 2 : d.steps.length >= 2))
}

// v77: a reviewer is never plain text. When the AI drew no concept map, one is built from the topics themselves
// (headings + the first point of each). Nothing is invented: every word comes from the reviewer.
export function autoDiagrams(c) {
  const secs = arr(c?.sections).filter(s => s && String(s.heading || '').trim())
  if (secs.length < 2) return []
  return [{ kind: 'map', title: 'Topic map', center: String(c.title || 'Topics').slice(0, 60), branches: secs.slice(0, 8).map(s => ({ label: String(s.heading).slice(0, 70), note: String(arr(s.points)[0] || '').slice(0, 90) })) }]
}

// A keyword for the little icon on a topic card (drawn by the template's CSS).
const ICON_WORDS = [
  ['flask', /science|chemi|physic|biolog|cell|atom|lab|experiment|energy|matter|organism|molecul/i],
  ['heart', /health|nurs|medic|disease|body|care|anatomy|nutrition|patient|wellness/i],
  ['globe', /geograph|world|global|country|nation|map|climate|earth|environment|region|economy of/i],
  ['code', /program|software|code|algorithm|computer|data|network|system|database|web|technolog/i],
  ['coin', /money|financ|account|econom|market|business|trade|tax|invest|profit|cost|price|budget/i],
  ['bulb', /idea|innovat|creativ|strateg|problem|solution|design|think|critical|learning/i],
  ['chart', /statistic|data analysis|graph|trend|growth|rate|percent|survey|research/i],
  ['leaf', /nature|plant|ecolog|animal|forest|agricultur|sustainab|habitat/i],
  ['calc', /formula|equation|calculat|comput|number|math|ratio|interest|\d{2,}/i],
  ['time', /history|timeline|era|century|year|period|date|origin|evolution|ancient|colonial|war/i],
  ['people', /people|society|social|human|group|culture|leader|learner|student|teacher|family|community|behavio/i],
  ['steps', /step|process|procedure|method|cycle|phase|how to|technique|workflow/i],
  ['law', /law|rule|policy|act\b|legal|principle|right|ethic|code of|standard|regulation/i],
  ['compare', /versus|\bvs\b|differ|compar|types? of|kinds? of|classif|categor/i],
  ['book', /definition|concept|meaning|introduction|overview|basics|theory|nature of|what is/i],
]
export const topicIcon = heading => { const h = String(heading || ''); const hit = ICON_WORDS.find(([, re]) => re.test(h)); return hit ? hit[0] : 'spark' }
