// E-mails a reviewer's owner when it reaches a visitor milestone (10, 25, 50 ... students). The database decides WHEN a milestone is reached
// (record_visit() writes a row to reviewer_milestones); this only sends the waiting rows, so a caller cannot make the server e-mail anyone.
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

export function milestoneEmail({ title, count, name, appUrl }) {
  const who = String(name || '').trim().split(/\s+/)[0] || 'there', t = String(title || 'your reviewer').slice(0, 120)
  const subject = `${count} students have studied “${t}”`
  const link = appUrl ? `\n\nOpen AraLab: ${appUrl}` : ''
  const text = `Hi ${who},\n\nGood news: “${t}” has now been opened by ${count} different students on AraLab. Thank you for sharing it!${link}\n\nYou can turn these emails off in your profile settings.`
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#1b2140"><h2 style="margin:0 0 8px">${count} students studied your reviewer</h2><p>Hi ${esc(who)},</p><p>Good news: <b>“${esc(t)}”</b> has now been opened by <b>${count}</b> different students on AraLab. Thank you for sharing it!</p>${appUrl ? `<p><a href="${esc(appUrl)}" style="display:inline-block;background:#3b55e6;color:#fff;padding:10px 16px;border-radius:10px;text-decoration:none;font-weight:bold">Open AraLab</a></p>` : ''}<p style="color:#6b7394;font-size:12px">You can turn these emails off in your profile settings.</p></div>`
  return { subject, text, html }
}

// -> { sent, skipped, failed }. Each row is claimed first (emailed_at set), so two calls never send the same e-mail twice; a failed send un-claims it for a retry.
export async function sendPending({ db, mailer, appUrl = '', limit = 20 }) {
  const out = { sent: 0, skipped: 0, failed: 0 }
  if (!mailer) return { ...out, note: 'E-mail is not set up on the server (set GMAIL_USER + GMAIL_APP_PASSWORD, or RESEND_API_KEY + MAIL_FROM).' }
  const { data: rows, error } = await db.from('reviewer_milestones').select('reviewer_id,milestone,owner_id,title').is('emailed_at', null).order('created_at').limit(limit)
  if (error) throw new Error(error.message)
  for (const r of rows || []) {
    const { data: got } = await db.from('reviewer_milestones').update({ emailed_at: new Date().toISOString() }).eq('reviewer_id', r.reviewer_id).eq('milestone', r.milestone).is('emailed_at', null).select('reviewer_id')
    if (!got?.length) continue
    const { data: prof } = await db.from('profiles').select('display_name,email_milestones').eq('user_id', r.owner_id).maybeSingle()
    if (prof && prof.email_milestones === false) { out.skipped++; continue }
    const { data: u } = await db.auth.admin.getUserById(r.owner_id)
    const to = u?.user?.email
    if (!to) { out.skipped++; continue }
    try { await mailer.send({ to, ...milestoneEmail({ title: r.title, count: r.milestone, name: prof?.display_name, appUrl }) }); out.sent++ }
    catch (e) { out.failed++; await db.from('reviewer_milestones').update({ emailed_at: null }).eq('reviewer_id', r.reviewer_id).eq('milestone', r.milestone) }
  }
  return out
}
