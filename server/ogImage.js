// Share-card pictures (v69): the 1200x630 image that Messenger / WhatsApp / Telegram / Discord / X show under a shared link.
//   renderOg({ title, subject, by, visitors, stars })           -> a reviewer card
//   renderOg({ title, subject, score, level })                   -> a Challenge score card ("I scored 87 pt ... Can you beat it?")
// Drawn with satori (HTML-ish -> SVG) and resvg (SVG -> PNG): no browser, no network, the font files ship in server/fonts.
// Colours and chunky edges follow the app (purple stage, white card with a lavender ring and a pressable bottom edge).
import { readFileSync } from 'node:fs'
import satori from 'satori'
import { Resvg } from '@resvg/resvg-js'

const C = { acc: '#6b5ce0', edge: '#4a3dbb', ring: '#e0dbf9', soft: '#efecfd', ink: '#1d1838', mute: '#5f5a80', ok: '#2fa77f', warn: '#d98a1c', white: '#ffffff' }
const W = 1200, H = 630

let fonts = null
function loadFonts() {
  if (fonts) return fonts
  const f = w => readFileSync(new URL(`./fonts/plus-jakarta-sans-latin-${w}-normal.woff`, import.meta.url))
  fonts = [{ name: 'Jakarta', data: f(500), weight: 500, style: 'normal' }, { name: 'Jakarta', data: f(700), weight: 700, style: 'normal' }, { name: 'Jakarta', data: f(800), weight: 800, style: 'normal' }]
  return fonts
}

// The bundled font is the Latin subset: anything else would draw as an empty box, so it is dropped rather than shown broken.
const keep = s => String(s ?? '').replace(/[^\u0020-\u007E\u00A0-\u00FF\u0131\u0152\u0153\u2010-\u2027\u20AC\u2122]/g, '').replace(/\s+/g, ' ').trim()
const clip = (s, n) => { const t = keep(s); return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

// Tiny element builder: satori takes plain { type, props } objects, so no React is needed on the server.
const h = (type, style, ...kids) => ({ type, props: { style, children: kids.length <= 1 ? kids[0] : kids } })
const row = (style, ...kids) => h('div', { display: 'flex', flexDirection: 'row', alignItems: 'center', ...style }, ...kids)
const col = (style, ...kids) => h('div', { display: 'flex', flexDirection: 'column', ...style }, ...kids)
const text = (style, s) => h('div', { display: 'flex', ...style }, s)

const logo = size => ({
  type: 'svg',
  props: {
    width: size, height: size, viewBox: '0 0 48 48',
    children: [
      { type: 'rect', props: { width: 48, height: 48, rx: 14, fill: '#ffffff' } },
      { type: 'path', props: { d: 'M10 20.5c4-1.6 9-1.2 14 1.8 5-3 10-3.4 14-1.8V35c-4-1.6-9-1.2-14 1.8C19 33.8 14 33.4 10 35z', fill: C.acc } },
      { type: 'path', props: { d: 'M24 7l1.9 4.6 4.6 1.9-4.6 1.9L24 20l-1.9-4.6-4.6-1.9 4.6-1.9z', fill: '#ffb703' } },
    ],
  },
})

const pill = (label, bg, fg) => row({ background: bg, color: fg, borderRadius: 999, padding: '8px 22px', fontSize: 26, fontWeight: 800 }, label)

function titleSize(t) { const n = t.length; return n <= 22 ? 92 : n <= 40 ? 76 : n <= 64 ? 62 : n <= 96 ? 52 : 44 }

function stage(inner) {
  // purple stage with a few soft bubbles, the app's header colour
  const bub = (w, x, y) => h('div', { position: 'absolute', width: w, height: w, borderRadius: 999, background: 'rgba(255,255,255,0.10)', left: x, top: y }, '')
  return col({ width: W, height: H, background: C.acc, padding: '44px 56px', position: 'relative', fontFamily: 'Jakarta', boxSizing: 'border-box' },
    bub(260, 900, -90), bub(150, 1040, 360), bub(300, -110, 420),
    inner)
}

function header(tag) {
  return row({ justifyContent: 'space-between' },
    row({ gap: 16 }, logo(60), text({ color: C.white, fontSize: 38, fontWeight: 800 }, 'AraLab')),
    pill(tag, 'rgba(255,255,255,0.20)', C.white))
}

function reviewerCard(d) {
  const title = clip(d.title, 110) || 'Reviewer'
  const subject = d.subject && d.subject !== 'Unsorted' ? clip(d.subject, 28) : ''
  const bits = []
  if (d.by) bits.push(`by ${clip(d.by, 28)}`)
  if (d.visitors > 0) bits.push(`${plural(d.visitors, 'student has', 'students have')} studied it`)
  if (d.stars > 0) bits.push(plural(d.stars, 'star', 'stars'))
  return stage(col({ flex: 1 },
    header('Shared reviewer'),
    col({ flex: 1, justifyContent: 'center', marginTop: 26 },
      col({ background: C.white, border: `4px solid ${C.ring}`, borderRadius: 44, padding: '40px 52px', gap: 20, boxShadow: `0 12px 0 ${C.edge}` },
        subject ? row({}, pill(subject, C.soft, C.acc)) : text({ height: 0 }, ''),
        text({ fontSize: titleSize(title), fontWeight: 800, color: C.ink, lineHeight: 1.12, letterSpacing: -1.5, lineClamp: 3 }, title),
        bits.length ? text({ fontSize: 30, fontWeight: 500, color: C.mute }, bits.join('  ·  ')) : text({ height: 0 }, ''))),
    text({ color: 'rgba(255,255,255,0.88)', fontSize: 28, fontWeight: 700, marginTop: 18 }, 'Open in AraLab to study this reviewer')))
}

const LEVEL_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

function scoreCard(d) {
  const score = Math.max(0, Math.min(100, Math.round(Number(d.score) || 0)))
  const title = clip(d.title, 90) || 'Reviewer'
  const tone = score >= 80 ? C.ok : score >= 50 ? C.acc : C.warn
  const level = LEVEL_LABEL[d.level] || ''
  return stage(col({ flex: 1 },
    header('Challenge score'),
    col({ flex: 1, justifyContent: 'center', marginTop: 26 },
      row({ background: C.white, border: `4px solid ${C.ring}`, borderRadius: 44, padding: '36px 48px', gap: 40, boxShadow: `0 12px 0 ${C.edge}`, justifyContent: 'space-between' },
        col({ flex: 1, gap: 18 },
          row({ gap: 12 }, pill('AraLab Challenge', C.soft, C.acc), level ? pill(level, tone, C.white) : text({ height: 0 }, '')),
          text({ fontSize: titleSize(title) - 14, fontWeight: 800, color: C.ink, lineHeight: 1.14, letterSpacing: -1, lineClamp: 3 }, title),
          text({ fontSize: 36, fontWeight: 800, color: C.acc }, 'Can you beat it?')),
        col({ width: 300, height: 300, boxSizing: 'border-box', borderRadius: 999, border: `16px solid ${tone}`, alignItems: 'center', justifyContent: 'center', background: C.white },
          text({ fontSize: 124, fontWeight: 800, color: C.ink, lineHeight: 1, letterSpacing: -4 }, String(score)),
          text({ fontSize: 34, fontWeight: 800, color: C.mute, marginTop: 2 }, 'points')))),
    text({ color: 'rgba(255,255,255,0.88)', fontSize: 28, fontWeight: 700, marginTop: 18 }, 'Open in AraLab to take the challenge')))
}

// -> Buffer (PNG, 1200x630)
export async function renderOg(data = {}) {
  const tree = data.score != null ? scoreCard(data) : reviewerCard(data)
  const svg = await satori(tree, { width: W, height: H, fonts: loadFonts() })
  return new Resvg(svg, { fitTo: { mode: 'width', value: W } }).render().asPng()
}
