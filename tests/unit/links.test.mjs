import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import zlib from 'node:zlib'
import { normalizeUrl, linkPlan, CANVA_MSG, GOOGLE_SHARE_MSG } from '../../src/linkLogic.js'
import { isBlockedIp, safeGet, htmlMainText, interpret, fileNameFrom, runLink } from '../../server/linkFetch.js'

test('normalizeUrl: adds https, trims, refuses anything that is not a plain web link', () => {
  assert.equal(normalizeUrl(' docs.google.com/document/d/abcdefghij1234/edit '), 'https://docs.google.com/document/d/abcdefghij1234/edit')
  assert.equal(normalizeUrl('<https://example.com/a b>'), null)
  for (const bad of ['', 'hello', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.com/a', 'https://user:pw@example.com/', 'https://localhost/', 'two words.com']) assert.equal(normalizeUrl(bad), null, bad)
  assert.equal(normalizeUrl('https://example.com/' + 'a'.repeat(2100)), null)
})
test('linkPlan: Google files are exported, Canva is its own kind, video is refused', () => {
  const id = 'abcdefghij1234567'
  assert.equal(linkPlan(`https://docs.google.com/document/d/${id}/edit?usp=sharing`).fetchUrl, `https://docs.google.com/document/d/${id}/export?format=pdf`)
  assert.equal(linkPlan(`https://docs.google.com/u/0/document/d/${id}/edit`).kind, 'gdoc')
  assert.equal(linkPlan(`https://docs.google.com/presentation/d/${id}/edit`).fetchUrl, `https://docs.google.com/presentation/d/${id}/export/pdf`)
  assert.equal(linkPlan(`https://docs.google.com/spreadsheets/d/${id}/edit#gid=0`).fetchUrl, `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`)
  assert.equal(linkPlan(`https://drive.google.com/file/d/${id}/view`).fetchUrl, `https://drive.google.com/uc?export=download&id=${id}`)
  assert.equal(linkPlan(`https://drive.google.com/open?id=${id}`).kind, 'gdrive')
  assert.match(linkPlan(`https://drive.google.com/drive/folders/${id}`).error, /folder/)
  assert.match(linkPlan('https://docs.google.com/forms/d/e/abc/viewform').error, /Forms/)
  assert.equal(linkPlan(`https://docs.google.com/document/d/e/2PACX-${id}/pub`).kind, 'web')
  assert.equal(linkPlan('https://www.canva.com/design/DAF123/abc/view?utm_content=x').kind, 'canva')
  assert.equal(linkPlan('https://canva.link/xyz').kind, 'canva')
  assert.equal(linkPlan('https://my-notes.my.canva.site/bio').kind, 'web')       // a published Canva website is an ordinary web page
  assert.match(linkPlan('https://www.youtube.com/watch?v=1').error, /Video/)
  assert.match(linkPlan('https://youtu.be/1').error, /Video/)
  assert.equal(linkPlan('https://example.com/notes.pdf').kind, 'web')
})

test('isBlockedIp: private, loopback, link-local, metadata and mapped addresses are blocked; public ones are not', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', 'ff02::1', '2002:7f00:1::', 'garbage'])
    assert.equal(isBlockedIp(ip), true, ip)
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '172.15.0.1', '203.0.114.1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '2a00:1450:4001::200e']) assert.equal(isBlockedIp(ip), false, ip)
})

// a tiny local web server (loopback is allowed ONLY through the test-only allowPrivate option)
function serve(handler) { return new Promise(ok => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => ok({ s, url: `http://127.0.0.1:${s.address().port}` })) }) }
test('safeGet: refuses loopback and private addresses by default, even through a redirect', async () => {
  const { s, url } = await serve((q, r) => { r.writeHead(302, { Location: 'http://169.254.169.254/latest/meta-data' }); r.end() })
  try {
    await assert.rejects(safeGet(url), /isn’t allowed/)                       // 127.0.0.1 itself
    await assert.rejects(safeGet('http://169.254.169.254/'), /isn’t allowed/)
    await assert.rejects(safeGet('http://[::1]/'), /isn’t allowed/)
    await assert.rejects(safeGet('http://localhost/'), /isn’t allowed|Could not open/)
    await assert.rejects(safeGet('https://example.com:8443/'), /port/)
    await assert.rejects(safeGet('file:///etc/passwd'), /http/)
    await assert.rejects(safeGet(url.replace('http://', 'http://u:p@'), { allowPrivate: true }), /password/)
    // a redirect to a private address is refused: the first hop (our local server) is let in by the test-only switch, the second is not
    await assert.rejects(safeGet(url, { anyPort: true, isBlocked: ip => ip !== '127.0.0.1' }), /isn’t allowed/)
  } finally { s.close() }
})
test('safeGet: follows redirects, unzips gzip, enforces the size limit and the redirect limit', async () => {
  const body = Buffer.from('hello '.repeat(50))
  const { s, url } = await serve((q, r) => {
    if (q.url === '/a') { r.writeHead(301, { Location: '/b' }); return r.end() }
    if (q.url === '/b') { r.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' }); return r.end(zlib.gzipSync(body)) }
    if (q.url === '/loop') { r.writeHead(302, { Location: '/loop' }); return r.end() }
    if (q.url === '/big') { r.writeHead(200); return r.end(Buffer.alloc(5000)) }
    r.writeHead(404); r.end('nope')
  })
  const o = { allowPrivate: true }
  try {
    const r = await safeGet(url + '/a', o); assert.equal(r.status, 200); assert.equal(r.body.toString(), body.toString()); assert.ok(r.url.endsWith('/b'))
    await assert.rejects(safeGet(url + '/loop', o), /too many times/)
    await assert.rejects(safeGet(url + '/big', { ...o, maxBytes: 1000 }), /bigger than/)
    assert.equal((await safeGet(url + '/zzz', o)).status, 404)
  } finally { s.close() }
})
test('safeGet: a slow site is cut off', async () => {
  const { s, url } = await serve(() => { /* never answers */ })
  try { await assert.rejects(safeGet(url, { allowPrivate: true, timeoutMs: 1200 }), /took too long/) } finally { s.closeAllConnections?.(); s.close() }
})

const page = (body, head = '') => `<!doctype html><html><head><title>Cell Biology Notes</title>${head}<style>p{}</style></head><body><nav>Home | About | Login</nav><header>Site banner</header><main><h1>Organelles</h1><p>The nucleus holds DNA &amp; controls the cell.</p><ul><li>Ribosomes make protein</li></ul></main><footer>Copyright</footer><script>track()</script></body></html>`
test('htmlMainText: title + main content, menus / footers / scripts left out', () => {
  const t = htmlMainText(page('', '<meta name="description" content="Short intro to cells">'))
  assert.match(t, /^# Cell Biology Notes\n\nShort intro to cells\n\n# Organelles/)
  assert.match(t, /nucleus holds DNA & controls the cell\./); assert.match(t, /- Ribosomes make protein/)
  for (const x of ['Home | About', 'Site banner', 'Copyright', 'track()']) assert.ok(!t.includes(x), x)
})
test('interpret: web page -> text file; private Google file and Canva give the right advice; files keep their name and type', () => {
  const ok = (type, body, extra = {}) => ({ status: 200, headers: { 'content-type': type, ...extra }, body: Buffer.from(body), url: 'https://example.com/x/notes' })
  const web = interpret(ok('text/html; charset=utf-8', page('') + 'x'.repeat(0)), { kind: 'web' })
  assert.equal(web.file.type, 'text/plain'); assert.equal(web.file.name, 'Cell Biology Notes.txt'); assert.match(web.file.bytes.toString(), /Organelles/)
  assert.equal(interpret(ok('text/html', '<html><body>Please sign in</body></html>'), { kind: 'gdoc' }).error, GOOGLE_SHARE_MSG)
  assert.equal(interpret({ status: 403, headers: {}, body: Buffer.from('x'), url: 'https://www.canva.com/design/x/view' }, { kind: 'canva' }).error, CANVA_MSG)
  assert.equal(interpret(ok('text/html', '<html><head><title>My design - Canva</title></head><body><div id=root></div></body></html>'), { kind: 'canva' }).error, CANVA_MSG)
  assert.match(interpret(ok('text/html', '<html><body>tiny</body></html>'), { kind: 'web' }).error, /no readable text/)
  const pdf = interpret(ok('application/pdf', '%PDF-1.4', { 'content-disposition': 'attachment; filename*=UTF-8\'\'Cell%20Notes.pdf' }), { kind: 'gdoc' })
  assert.equal(pdf.file.name, 'Cell Notes.pdf'); assert.equal(pdf.file.type, 'application/pdf')
  assert.equal(fileNameFrom({}, 'https://x.com/files/Biology%20Ch3', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'), 'Biology Ch3.xlsx')
  assert.match(interpret(ok('video/mp4', 'x'), { kind: 'web' }).error, /Video/)
  assert.match(interpret({ status: 404, headers: {}, body: Buffer.alloc(0), url: 'https://x.com' }, { kind: 'web' }).error, /wasn’t found/)
  assert.match(interpret({ status: 500, headers: {}, body: Buffer.alloc(0), url: 'https://x.com' }, { kind: 'web' }).error, /error \(500\)/)
})
test('runLink: needs a signed-in user and a real link; downloads through the injected getter', async () => {
  const db = { auth: { getUser: async jwt => ({ data: { user: jwt === 'good' ? { id: 'u' } : null } }) } }
  const get = async url => ({ status: 200, headers: { 'content-type': 'application/pdf' }, body: Buffer.from('%PDF'), url })
  assert.equal((await runLink({ db, authHeader: '', body: { url: 'https://a.com/x.pdf' }, get })).status, 401)
  assert.equal((await runLink({ db, authHeader: 'Bearer good', body: { url: 'nonsense' }, get })).status, 400)
  assert.match((await runLink({ db, authHeader: 'Bearer good', body: { url: 'https://youtu.be/abc' }, get })).error, /Video/)
  const r = await runLink({ db, authHeader: 'Bearer good', body: { url: 'https://a.com/x.pdf' }, get })
  assert.equal(r.file.name, 'x.pdf'); assert.equal(r.file.type, 'application/pdf')
  const asked = []; await runLink({ db, authHeader: 'Bearer good', body: { url: 'https://docs.google.com/document/d/abcdefghij1234/edit' }, get: async u => (asked.push(u), get(u)) })
  assert.deepEqual(asked, ['https://docs.google.com/document/d/abcdefghij1234/export?format=pdf'])
  const boom = await runLink({ db, authHeader: 'Bearer good', body: { url: 'https://a.com/x' }, get: async () => { throw Object.assign(new Error('That site took too long to answer.'), { link: true, status: 504 }) } })
  assert.equal(boom.status, 504)
  assert.equal((await runLink({ db, authHeader: 'Bearer good', body: { url: 'https://a.com/x' }, get: async () => { throw new Error('secret internals') } })).error, 'Could not open that link.')
})
