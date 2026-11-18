import test from 'node:test'
import assert from 'node:assert/strict'
import { validId, originOf, loadShare, describe, sharePage, parseScore, parseLevel, imageUrl } from '../../server/share.js'
import { incomingId, stashIncoming, peekShared, takeShared, shareUrl, canShareReviewer } from '../../src/shareLink.js'

// minimal fake of the supabase calls loadShare makes
function fakeDb({ reviewer, profile, stats, noExtraCols = false }) {
  return {
    from(table) {
      const b = {
        select(cols) { b.cols = cols; return b }, eq() { return b },
        maybeSingle() {
          if (table === 'reviewers') {
            if (noExtraCols && /removed_at|hide_author/.test(b.cols)) return Promise.resolve({ data: null, error: { message: 'column reviewers.removed_at does not exist' } })
            return Promise.resolve({ data: reviewer || null, error: null })
          }
          if (table === 'profiles') return Promise.resolve({ data: profile || null, error: null })
          if (table === 'reviewer_stats') return Promise.resolve(stats ? { data: stats, error: null } : { data: null, error: { message: 'relation does not exist' } })
          return Promise.resolve({ data: null, error: null })
        },
      }
      return b
    },
  }
}
const rv = (o = {}) => ({ id: 'abc123', title: 'Cell Biology', subject: 'Biology', owner_id: 'u1', is_public: true, hide_author: false, removed_at: null, ...o })

test('ids: only letters, digits, - and _ are accepted', () => {
  assert.ok(validId('lq3k9x2ab')); assert.ok(validId('a-b_C9'))
  for (const bad of ['', 'a b', 'a/b', '../x', '<script>', 'x'.repeat(65), null, undefined, 5]) assert.equal(validId(bad), false, String(bad))
})

test('origin: APP_URL wins, otherwise the forwarded host, https except on localhost', () => {
  assert.equal(originOf({ host: 'x.com' }, 'https://aralab.app/'), 'https://aralab.app')
  assert.equal(originOf({ 'x-forwarded-host': 'aralab.vercel.app', host: 'internal' }, ''), 'https://aralab.vercel.app')
  assert.equal(originOf({ host: 'localhost:3000' }, ''), 'http://localhost:3000')
  assert.equal(originOf({ host: 'a.com' }, 'javascript:alert(1)'), 'https://a.com')
})

test('a public reviewer is found with its contributor and counts', async () => {
  const r = await loadShare(fakeDb({ reviewer: rv(), profile: { display_name: 'Ana Cruz' }, stats: { visitors: 24, stars: 5 } }), 'abc123')
  assert.deepEqual(r, { found: true, id: 'abc123', title: 'Cell Biology', subject: 'Biology', by: 'Ana Cruz', visitors: 24, stars: 5 })
  assert.equal(describe(r), 'Biology reviewer by Ana Cruz · 24 students have studied it · 5 stars')
})

test('private, removed, missing and badly-named reviewers get no preview', async () => {
  assert.equal((await loadShare(fakeDb({ reviewer: rv({ is_public: false }) }), 'abc123')).found, false)
  assert.equal((await loadShare(fakeDb({ reviewer: rv({ removed_at: '2026-11-01' }) }), 'abc123')).found, false)
  assert.equal((await loadShare(fakeDb({ reviewer: null }), 'abc123')).found, false)
  assert.equal((await loadShare(fakeDb({ reviewer: rv() }), '../etc')).found, false)
})

test('"Hide my name" is respected: the contributor is not named', async () => {
  const r = await loadShare(fakeDb({ reviewer: rv({ hide_author: true }), profile: { display_name: 'Ana Cruz' } }), 'abc123')
  assert.equal(r.found, true); assert.equal(r.by, null)
  assert.ok(!describe(r).includes('Ana'))
})

test('older databases (no removed_at / hide_author / stats yet) still work', async () => {
  const r = await loadShare(fakeDb({ reviewer: rv(), profile: { display_name: 'Ben' }, noExtraCols: true }), 'abc123')
  assert.equal(r.found, true); assert.equal(r.visitors, 0); assert.equal(r.stars, 0)
  assert.equal(describe(r), 'Biology reviewer by Ben')
})

test('preview page: Open Graph + Twitter tags, escaped text, and a safe redirect into the app', () => {
  const info = { found: true, id: 'abc123', title: 'A <b>"x"</b> & y', subject: 'Biology', by: 'Ana', visitors: 1, stars: 0 }
  const html = sharePage({ origin: 'https://aralab.app', id: 'abc123', info })
  assert.match(html, /<meta property="og:title" content="A &lt;b&gt;&quot;x&quot;&lt;\/b&gt; &amp; y">/)
  assert.match(html, /<meta property="og:url" content="https:\/\/aralab\.app\/r\/abc123">/)
  assert.match(html, /<meta property="og:image" content="https:\/\/aralab\.app\/api\/og\?id=abc123">/)     // v69: drawn per reviewer
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/)
  assert.match(html, /1 student has studied it/)
  assert.ok(!html.includes('<b>"x"</b>'))
  assert.match(html, /location\.replace\("\/\?r=abc123"\)/)
})

test('preview page for an unavailable reviewer is a plain AraLab card, never the reviewer data', () => {
  const html = sharePage({ origin: 'https://aralab.app', id: 'abc123', info: { found: false } })
  assert.match(html, /<meta property="og:title" content="AraLab">/)
  assert.match(html, /<meta property="og:image" content="https:\/\/aralab\.app\/og\.png">/)          // no per-reviewer picture for an unknown / private one
  assert.ok(!/Cell Biology/.test(html))
})

test('score links: s and l are clamped, junk is ignored, and the card is drawn for that score', () => {
  assert.equal(parseScore('87'), 87); assert.equal(parseScore('187'), 100); assert.equal(parseScore('-4'), 0); assert.equal(parseScore('86.6'), 87)
  assert.equal(parseScore('abc'), null); assert.equal(parseScore(''), null); assert.equal(parseScore(null), null); assert.equal(parseScore(undefined), null)
  assert.equal(parseLevel('hard'), 'hard'); assert.equal(parseLevel('<script>'), ''); assert.equal(parseLevel(undefined), '')
  const info = { found: true, id: 'abc123', title: 'Cell Biology', subject: 'Biology', by: null, visitors: 0, stars: 0 }
  assert.equal(imageUrl({ origin: 'https://aralab.app', id: 'abc123', info, score: 87, level: 'hard' }), 'https://aralab.app/api/og?id=abc123&s=87&l=hard')
  assert.equal(imageUrl({ origin: 'https://aralab.app', id: 'abc123', info: { found: false }, score: 87 }), 'https://aralab.app/og.png')
  const html = sharePage({ origin: 'https://aralab.app', id: 'abc123', info, score: 87, level: 'hard' })
  assert.match(html, /<meta property="og:title" content="I scored 87 pt on “Cell Biology”">/)
  assert.match(html, /Hard · Can you beat it\?/)
  assert.match(html, /<meta property="og:url" content="https:\/\/aralab\.app\/r\/abc123\?s=87&amp;l=hard">/)
  assert.match(html, /<meta property="og:image" content="https:\/\/aralab\.app\/api\/og\?id=abc123&amp;s=87&amp;l=hard">/)
  assert.match(html, /location\.replace\("\/\?r=abc123"\)/)             // people still land in the app on the reviewer, not on a score
  const none = sharePage({ origin: 'https://aralab.app', id: 'abc123', info: { found: false }, score: 99 })
  assert.ok(!/99/.test(none), 'an unavailable reviewer never shows a score caption')
})

// --- browser side: the incoming id and what is remembered across sign-in ---
test('incoming ids: /r/<id> and ?r=<id> are read, anything odd is ignored', () => {
  assert.equal(incomingId('/r/abc123', ''), 'abc123')
  assert.equal(incomingId('/r/abc123/', ''), 'abc123')
  assert.equal(incomingId('/', '?r=abc123'), 'abc123')
  assert.equal(incomingId('/', '?r=<script>'), '')
  assert.equal(incomingId('/privacy', ''), '')
  assert.equal(incomingId('/r/%E0%A4%A', ''), '')
  assert.equal(incomingId('/', ''), '')
})

test('the id is kept for sign-in, read once, and expires after 2 hours', () => {
  const store = {}
  globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v) }, removeItem: k => { delete store[k] } }
  const replaced = []
  assert.equal(stashIncoming({ pathname: '/r/abc123', search: '', hash: '#x' }, { replaceState: (...a) => replaced.push(a) }), 'abc123')
  assert.equal(replaced[0][2], '/#x')                       // address bar is tidied, hash kept
  assert.equal(peekShared(), 'abc123'); assert.equal(peekShared(), 'abc123')   // sign-in screen can look more than once
  assert.equal(takeShared(), 'abc123'); assert.equal(takeShared(), '')         // opening it uses it up
  store['rl-share'] = JSON.stringify({ id: 'old1', t: Date.now() - 3 * 3600 * 1000 })
  assert.equal(peekShared(), '')
  assert.equal(stashIncoming({ pathname: '/', search: '', hash: '' }, { replaceState() { throw new Error('should not touch history') } }), '')
  delete globalThis.localStorage
})

test('share URL and who can be shared', () => {
  assert.equal(shareUrl('abc123', 'https://aralab.app'), 'https://aralab.app/r/abc123')
  assert.equal(canShareReviewer({ id: 'a', is_public: true }), true)
  assert.equal(canShareReviewer({ id: 'a' }), true)                       // older rows have no is_public in the list view
  assert.equal(canShareReviewer({ id: 'a', is_public: false }), false)
  assert.equal(canShareReviewer({ id: 'a', is_public: true, removed_at: '2026-11-01' }), false)
})
