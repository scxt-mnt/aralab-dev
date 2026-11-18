// Sends a plain e-mail. Pick ONE provider with environment variables (secrets: .env.local or Vercel):
//  - Gmail:  GMAIL_USER (the Gmail address) + GMAIL_APP_PASSWORD (a 16-character Google "App password"; needs 2-step verification)
//  - Brevo:  BREVO_API_KEY + MAIL_FROM (any email address you verified in Brevo as a sender; no domain and no app password needed)
//  - Resend: RESEND_API_KEY + MAIL_FROM (an address on a domain you verified at resend.com)
// Optional: MAIL_FROM_NAME (default "AraLab"). Returns null when no provider is set, so the app keeps working without e-mail.
export function pickMailer(env = process.env, deps = {}) {
  const name = env.MAIL_FROM_NAME || 'AraLab'
  if (env.GMAIL_USER && env.GMAIL_APP_PASSWORD) {
    return {
      provider: 'gmail',
      async send({ to, subject, text, html }) {
        const nodemailer = deps.nodemailer || (await import('nodemailer')).default
        const tx = nodemailer.createTransport({ service: 'gmail', auth: { user: env.GMAIL_USER, pass: env.GMAIL_APP_PASSWORD } })
        await tx.sendMail({ from: `"${name}" <${env.GMAIL_USER}>`, to, subject, text, html })
      },
    }
  }
  if (env.RESEND_API_KEY && env.MAIL_FROM) {
    return {
      provider: 'resend',
      async send({ to, subject, text, html }) {
        const r = await (deps.fetch || fetch)('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: `${name} <${env.MAIL_FROM}>`, to: [to], subject, text, html }),
        })
        if (!r.ok) throw new Error(`Resend ${r.status}: ${(await r.text()).slice(0, 200)}`)
      },
    }
  }
  if (env.BREVO_API_KEY && env.MAIL_FROM) {
    return {
      provider: 'brevo',
      async send({ to, subject, text, html }) {
        const r = await (deps.fetch || fetch)('https://api.brevo.com/v3/smtp/email', {
          method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({ sender: { name, email: env.MAIL_FROM }, to: [{ email: to }], subject, textContent: text, htmlContent: html }),
        })
        if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`)
      },
    }
  }
  return null
}
