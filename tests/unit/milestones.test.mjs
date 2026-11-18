import test from 'node:test'
import assert from 'node:assert/strict'
import { milestoneEmail, sendPending } from '../../server/milestones.js'
import { pickMailer } from '../../server/mailer.js'

// tiny fake of the supabase calls sendPending makes
function fakeDb({ rows, profiles = {}, emails = {} }) {
  const calls = []
  const q = (table) => {
    const st = { table, filters: {}, op: 'select' }
    const b = {
      select() { return b }, order() { return b }, limit() { return b },
      update(v) { st.op = 'update'; st.patch = v; return b },
      is(k, v) { st.filters[k] = v; return b }, eq(k, v) { st.filters[k] = v; return b },
      maybeSingle() { return Promise.resolve({ data: table === 'profiles' ? profiles[st.filters.user_id] || null : null }) },
      then(res, rej) {
        let data = []
        if (table === 'reviewer_milestones' && st.op === 'select') data = rows.filter(r => r.emailed_at == null)
        if (table === 'reviewer_milestones' && st.op === 'update') {
          const hit = rows.filter(r => r.reviewer_id === st.filters.reviewer_id && r.milestone === st.filters.milestone && (st.filters.emailed_at !== null || r.emailed_at == null))
          hit.forEach(r => { r.emailed_at = st.patch.emailed_at }); data = hit.map(r => ({ reviewer_id: r.reviewer_id }))
        }
        calls.push([table, st.op]); return Promise.resolve({ data, error: null }).then(res, rej)
      },
    }
    return b
  }
  return { from: q, auth: { admin: { getUserById: async id => ({ data: { user: emails[id] ? { email: emails[id] } : null } }) } }, calls }
}
const row = (o = {}) => ({ reviewer_id: 'r1', milestone: 10, owner_id: 'u1', title: 'Cell Biology', emailed_at: null, created_at: '2026-11-03', ...o })

test('email text names the reviewer and the count, and escapes html', () => {
  const m = milestoneEmail({ title: 'A <b>x</b>', count: 25, name: 'Ana Cruz', appUrl: 'https://aralab.app' })
  assert.match(m.subject, /^25 students have studied/)
  assert.match(m.text, /Hi Ana,/); assert.ok(!m.html.includes('<b>x</b>')); assert.match(m.html, /&lt;b&gt;x&lt;\/b&gt;/)
})
test('no mailer configured: nothing is claimed or sent', async () => {
  const rows = [row()], r = await sendPending({ db: fakeDb({ rows }), mailer: null })
  assert.equal(r.sent, 0); assert.equal(rows[0].emailed_at, null); assert.ok(r.note)
})
test('sends once, then the row is claimed', async () => {
  const sent = [], rows = [row()], db = fakeDb({ rows, emails: { u1: 'ana@gmail.com' } }), mailer = { send: async m => { sent.push(m) } }
  assert.deepEqual(await sendPending({ db, mailer }), { sent: 1, skipped: 0, failed: 0 })
  assert.equal(sent[0].to, 'ana@gmail.com'); assert.ok(rows[0].emailed_at)
  assert.deepEqual(await sendPending({ db, mailer }), { sent: 0, skipped: 0, failed: 0 })
  assert.equal(sent.length, 1)
})
test('owner who turned e-mails off is skipped', async () => {
  const sent = [], rows = [row()], db = fakeDb({ rows, profiles: { u1: { email_milestones: false } }, emails: { u1: 'ana@gmail.com' } })
  const r = await sendPending({ db, mailer: { send: async m => { sent.push(m) } } })
  assert.equal(r.skipped, 1); assert.equal(sent.length, 0)
})
test('a failed send is released so it is retried later', async () => {
  const rows = [row()], db = fakeDb({ rows, emails: { u1: 'ana@gmail.com' } })
  const r = await sendPending({ db, mailer: { send: async () => { throw new Error('smtp down') } } })
  assert.equal(r.failed, 1); assert.equal(rows[0].emailed_at, null)
})
test('mailer choice: Gmail first, then Resend, else none', async () => {
  assert.equal(pickMailer({}), null)
  assert.equal(pickMailer({ GMAIL_USER: 'a@gmail.com', GMAIL_APP_PASSWORD: 'x' }).provider, 'gmail')
  assert.equal(pickMailer({ RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.c' }).provider, 'resend')
  assert.equal(pickMailer({ RESEND_API_KEY: 'k' }), null)
  assert.equal(pickMailer({ BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.c' }).provider, 'brevo')
  let sent; await pickMailer({ BREVO_API_KEY: 'k', MAIL_FROM: 'a@b.c' }, { fetch: async (u, o) => { sent = [u, JSON.parse(o.body)]; return { ok: true } } }).send({ to: 'x@y.z', subject: 's', text: 't', html: 'h' })
  assert.equal(sent[0], 'https://api.brevo.com/v3/smtp/email'); assert.equal(sent[1].to[0].email, 'x@y.z')
  let seen; const m = pickMailer({ GMAIL_USER: 'a@gmail.com', GMAIL_APP_PASSWORD: 'x', MAIL_FROM_NAME: 'Ara' }, { nodemailer: { createTransport: () => ({ sendMail: async o => { seen = o } }) } })
  await m.send({ to: 'b@c.d', subject: 's', text: 't', html: 'h' }); assert.equal(seen.from, '"Ara" <a@gmail.com>')
})
