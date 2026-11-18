import { useEffect, useState } from 'react'
import { inAppName, isAndroid, chromeIntentUrl } from './inapp'
import { sb } from './supabase'
import Icon, { Logo } from './Icons'
import { peekShared } from './shareLink'

// Official brand marks (Simple Icons paths) so the buttons are recognisable and not emoji.
const GoogleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.6 5.9c4.4-4.1 7-10.1 7-17.6z" />
    <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.1C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.1z" />
    <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.6-5.9c-2.1 1.4-4.9 2.3-8.3 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
  </svg>
)

const FacebookIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#1877F2" d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.24 2.69.24v2.97h-1.52c-1.49 0-1.96.93-1.96 1.88v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z" />
  </svg>
)

const Spinner = () => <span className="auth-spin" aria-hidden="true" />

// Turn Supabase's raw provider errors into something a student can act on.
function friendlyAuthError(message = '') {
  const m = String(message)
  if (/invalid login credentials/i.test(m)) return 'That email and password do not match. Try again or create an account.'
  if (/email not confirmed/i.test(m)) return 'Please confirm your email address, then sign in.'
  if (/over_email_send_rate_limit|email rate limit|too many emails/i.test(m)) return 'Too many confirmation emails were requested. Please wait before trying again.'
  if (/email_address_not_authorized|email address not authorized/i.test(m)) return 'Supabase is still using its test mailer, which can only email project-team addresses. Enable and save Custom SMTP in Supabase Authentication → Emails → SMTP Settings.'
  if (/535|username and password not accepted|authentication failed|invalid credentials.*smtp/i.test(m)) return 'AraLab could not sign in to Gmail SMTP. In Supabase, use the Gmail address as Username and a 16-character Google App Password—not the normal Gmail password.'
  if (/534|application-specific password required/i.test(m)) return 'Gmail needs an App Password. Create one in your Google Account after enabling 2-Step Verification, then update the SMTP Password in Supabase.'
  if (/smtp|mailer|send email|failed to send|connection refused|timeout/i.test(m)) return 'We could not send the confirmation email because the email service is not configured correctly. Check Supabase Auth Logs, then verify the Gmail SMTP host, port, username and App Password.'
  if (/already registered|user already registered/i.test(m)) return 'An account already exists for that email. Choose Sign in instead.'
  if (/password/i.test(m)) return 'Use a password with at least 8 characters.'
  if (/popup|window/i.test(m)) return 'The sign-in window could not open. Please allow pop-ups and try again.'
  if (/network|fetch|timeout/i.test(m)) return 'We could not reach the sign-in service. Check your connection and try again.'
  return m || 'Sign-in failed. Please try again.'
}

const POINTS = [
  { icon: 'library', title: 'Peer-reviewed reviewers', text: 'Find the notes that actually help, rated by students who took the course.' },
  { icon: 'chart', title: 'Progress you can see', text: 'Weekly goals, streaks and study stats that keep you moving.' },
  { icon: 'cap', title: 'Your university guide', text: 'Astra turns your school’s rules and dates into a clear plan.' },
]


// v79: scalloped "cloud" edge between the blue hero and the white form (the same idea as the reference, drawn for AraLab).
// vertical = desktop (edge on the right of the hero), horizontal = phones (edge at the bottom of the hero).
const rnd = i => { const x = Math.sin(i * 12.9898 + 4.1414) * 43758.5453; return x - Math.floor(x) }
function cloudPath(vertical, n, depth, base, seed) {
  const L = 600, step = L / n
  const pt = (a, b) => (vertical ? `${b.toFixed(1)} ${a.toFixed(1)}` : `${a.toFixed(1)} ${b.toFixed(1)}`)
  let d = `M${pt(0, 60)} L${pt(0, base)}`
  for (let i = 0; i < n; i++) d += ` Q${pt(i * step + step / 2, base - depth * (0.55 + 0.45 * rnd(seed + i)))} ${pt((i + 1) * step, base)}`
  return `${d} L${pt(L, 60)} Z`
}
const LAYERS = [{ n: 6, depth: 24, base: 30, op: 0.26, seed: 1 }, { n: 8, depth: 20, base: 40, op: 0.48, seed: 7 }, { n: 10, depth: 15, base: 50, op: 1, seed: 13 }]
const Cloud = ({ vertical }) => (
  <svg className={`lg-cloud ${vertical ? 'v' : 'h'}`} viewBox={vertical ? '0 0 60 600' : '0 0 600 60'} preserveAspectRatio="none" aria-hidden="true">
    {LAYERS.map(l => <path key={l.seed} d={cloudPath(vertical, l.n, l.depth, l.base, l.seed)} style={{ fill: 'var(--lg-card)', opacity: l.op }} />)}
  </svg>
)
function passwordStrength(pw) {
  if (!pw) return 0
  let n = 0
  if (pw.length >= 8) n++
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) n++
  if (/\d/.test(pw)) n++
  if (/[^A-Za-z0-9]/.test(pw) || pw.length >= 14) n++
  return n
}
const STRENGTH = ['', 'Too weak', 'Okay', 'Good', 'Strong']

function Field({ id, label, type = 'text', value, onChange, ok, children, ...rest }) {
  return (
    <div className={`lg-f${ok ? ' ok' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="lg-inw">
        <input id={id} type={type} value={value} onChange={onChange} {...rest} />
        {children}
        <span className="lg-tick" aria-hidden="true"><Icon name="check" size={16} /></span>
      </div>
    </div>
  )
}

export default function Login({ ready }) {
  const [busy, setBusy] = useState(''), [err, setErr] = useState(''), [notice, setNotice] = useState('')
  const [mode, setMode] = useState('signin'), [email, setEmail] = useState(() => { try { return localStorage.getItem('rl-login-email') || '' } catch { return '' } }), [password, setPassword] = useState('')
  const [showPw, setShowPw] = useState(false), [agree, setAgree] = useState(false)
  const [confirmPassword, setConfirmPassword] = useState(''), [cooldownUntil, setCooldownUntil] = useState(0), [sent, setSent] = useState(false), [, setTick] = useState(0)

  useEffect(() => {
    if (!cooldownUntil) return
    const t = setInterval(() => { setTick(x => x + 1); if (Date.now() >= cooldownUntil) setCooldownUntil(0) }, 1000)
    return () => clearInterval(t)
  }, [cooldownUntil])

  // v65: someone opened a shared reviewer link before signing in: show what was shared with them (title, subject, who made it)
  const [sharedId] = useState(() => peekShared()), [shared, setShared] = useState(null)
  useEffect(() => {
    if (!sharedId) return
    let live = true
    fetch(`/api/share?id=${encodeURIComponent(sharedId)}&format=json`).then(r => r.ok ? r.json() : null).then(j => { if (live) setShared(j?.found ? j : false) }).catch(() => { if (live) setShared(false) })
    return () => { live = false }
  }, [sharedId])

  const goOAuth = async provider => {
    if (!ready || busy) return
    setBusy(provider); setErr(''); setNotice('')
    try {
      // Build the provider URL without leaving the page, so a provider that is not enabled shows a friendly
      // message here instead of sending the student to a raw JSON error page.
      const { data, error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin, skipBrowserRedirect: true } })
      if (error) throw error
      if (!data?.url) throw new Error('Could not start sign-in. Please try again.')
      try {
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 6000)
        try {
          const check = await fetch(data.url, { method: 'GET', redirect: 'manual', credentials: 'omit', signal: ctl.signal })
          if (check.type !== 'opaqueredirect' && !check.ok) {
            let detail = ''
            try { detail = (await check.json())?.msg || '' } catch { /* not JSON */ }
            throw new Error(detail || `Sign-in failed (${check.status}).`)
          }
        } finally { clearTimeout(timer) }
      } catch (e) {
        if (e?.name === 'AbortError') { location.assign(data.url); return }   // slow check: just go to the provider
        if (e?.name === 'TypeError') { location.assign(data.url); return }    // browser cannot preflight: let the provider decide
        throw e
      }
      // the provider is ready: hand the browser over to it
      location.assign(data.url)
    } catch (e) { setErr(friendlyAuthError(e?.message)); setBusy('') }
  }

  const submitEmail = async e => {
    e.preventDefault()
    if (!ready || busy) return
    if (!email.trim() || !password) return setErr('Enter your email address and password.')
    if (mode === 'signup' && password.length < 8) return setErr('Use a password with at least 8 characters.')
    if (mode === 'signup' && password !== confirmPassword) return setErr('Your passwords do not match.')
    if (mode === 'signup' && !agree) return setErr('Please agree to the Terms and Privacy Policy to create an account.')
    if (mode === 'signup' && cooldownUntil > Date.now()) return setNotice('Please wait one minute before requesting another confirmation email.')
    setBusy('email'); setErr(''); setNotice('')
    try {
      const result = mode === 'signup'
        ? await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: location.origin } })
        : await sb.auth.signInWithPassword({ email: email.trim(), password })
      if (result.error) throw result.error
      try { localStorage.setItem('rl-login-email', email.trim()) } catch { /* private mode */ }
      if (mode === 'signup' && !result.data?.session) {
        setCooldownUntil(Date.now() + 60 * 1000); setSent(true)
      }
    } catch (e) { setErr(friendlyAuthError(e?.message)) }
    finally { setBusy('') }
  }

  const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
  const resend = async () => {
    if (busy || left > 0) return
    setBusy('resend'); setErr(''); setNotice('')
    try {
      const { error } = await sb.auth.resend({ type: 'signup', email: email.trim(), options: { emailRedirectTo: location.origin } })
      if (error) throw error
      setCooldownUntil(Date.now() + 60 * 1000); setNotice('Sent again. Check your inbox and your Spam folder.')
    } catch (e) { setErr(friendlyAuthError(e?.message)) } finally { setBusy('') }
  }
  const changeMode = next => { setMode(next); setErr(''); setNotice(''); setShowPw(false); if (next === 'signin') setConfirmPassword('') }
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()), pwOk = password.length >= (mode === 'signup' ? 8 : 1), strength = passwordStrength(password), signup = mode === 'signup'

  return (
    <div className="lg">
      <div className="lg-card">
        <section className="lg-hero" aria-labelledby="lg-hero-title">
          <i className="lg-bub b1" /><i className="lg-bub b2" /><i className="lg-bub b3" /><i className="lg-bub b4" />
          <div className="lg-hero-in">
            <p className="lg-welcome" id="lg-hero-title">Welcome to</p>
            <div className="lg-logo"><Logo size={58} /></div>
            <h1 className="lg-name">AraLab</h1>
            <p className="lg-tag">Turn your notes into reviewers.<br />Study together, rank up, graduate smarter.</p>
            <ul className="lg-points">
              {POINTS.map(p => <li key={p.title}><span className="lp-ic"><Icon name={p.icon} size={17} /></span><span><b>{p.title}</b><small>{p.text}</small></span></li>)}
            </ul>
          </div>
          <p className="lg-foot"><Icon name="check" size={14} /> Free for students</p>
          <Cloud vertical /><Cloud />
        </section>

        <section className="lg-panel" aria-labelledby="login-title">
          {sent ? (
            <div className="lg-sent" role="status">
              <span className="lg-sent-ic"><Icon name="mail" size={30} /></span>
              <h2 id="login-title">Check your email</h2>
              <p>We sent a confirmation link to <b>{email.trim()}</b>. Open it to finish creating your account.</p>
              <button type="button" className="lg-btn pri" onClick={resend} disabled={busy === 'resend' || left > 0} aria-busy={busy === 'resend'}>{busy === 'resend' ? <Spinner /> : null}<span>{left > 0 ? `Resend email in ${left}s` : 'Resend email'}</span></button>
              {err && <div className="login-err" role="alert">{err}</div>}
              {notice && <div className="login-notice" role="status">{notice}</div>}
              <small className="lg-fine">Not there? Look in Spam or Junk, and make sure the address is right.</small>
              <div className="lg-links"><button type="button" className="lg-link" onClick={() => { setSent(false); setNotice(''); setErr('') }}>Use a different email</button><button type="button" className="lg-link" onClick={() => { setSent(false); changeMode('signin'); setNotice('') }}>Back to sign in</button></div>
            </div>
          ) : (<>
            <h2 id="login-title">{sharedId ? 'Sign in to open it' : signup ? 'Create your account' : 'Welcome back'}</h2>
            <p className="lg-sub">{sharedId ? 'Your reviewer opens right after you sign in.' : signup ? 'Join AraLab in under a minute.' : 'Sign in to pick up where you left off.'}</p>
            {sharedId && (
              <div className="share-pre" role="note" aria-label="Shared reviewer">
                <span className="sp-ic"><Icon name="library" size={20} /></span>
                <span className="sp-txt">
                  <small>Shared with you</small>
                  <b>{shared ? shared.title : 'A reviewer on AraLab'}</b>
                  {shared && <small>{[shared.subject && shared.subject !== 'Unsorted' ? shared.subject : '', shared.by ? `by ${shared.by}` : '', shared.visitors ? `${shared.visitors} ${shared.visitors === 1 ? 'student has' : 'students have'} studied it` : ''].filter(Boolean).join(' · ')}</small>}
                  {shared === null && <small className="mute">Loading preview…</small>}
                </span>
              </div>)}

            {inAppName() && (
              <div className="inapp-banner" role="note">
                <span aria-hidden="true">⚠️</span>
                <div><b>You are inside the {inAppName()} browser</b>Google sign-in does not work here. Open AraLab in {isAndroid() ? 'Chrome' : 'Safari'}, or sign in with your email and password.
                  <br /><button type="button" onClick={() => { if (isAndroid()) { location.href = chromeIntentUrl() } else { try { navigator.clipboard.writeText(location.href) } catch { /* ignore */ } alert('Link copied. Open Safari and paste it, or tap the ••• menu and choose "Open in Browser".') } }}>{isAndroid() ? 'Open in Chrome' : 'Copy link'}</button></div>
              </div>)}
            <div className="lg-oauth">
              <button type="button" className="lg-soc" onClick={() => goOAuth('google')} disabled={!ready || !!busy} aria-busy={busy === 'google'}>{busy === 'google' ? <Spinner /> : <GoogleIcon />}<span>Continue with Google</span></button>
              <button type="button" className="lg-soc" onClick={() => goOAuth('facebook')} disabled={!ready || !!busy} aria-busy={busy === 'facebook'}>{busy === 'facebook' ? <Spinner /> : <FacebookIcon />}<span>Continue with Facebook</span></button>
            </div>
            <div className="lg-or"><span>or use your email</span></div>

            <form className="lg-form" onSubmit={submitEmail} noValidate>
              <Field id="lg-email" label="Email" type="email" autoComplete="email" inputMode="email" placeholder="you@school.edu.ph" value={email} onChange={e => setEmail(e.target.value)} ok={emailOk} disabled={!!busy} required />
              <Field id="lg-pw" label="Password" type={showPw ? 'text' : 'password'} autoComplete={signup ? 'new-password' : 'current-password'} placeholder={signup ? 'At least 8 characters' : 'Your password'} value={password} onChange={e => setPassword(e.target.value)} ok={signup && pwOk} disabled={!!busy} required>
                <button type="button" className="lg-eye" onClick={() => setShowPw(v => !v)} aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={showPw}>{showPw ? 'Hide' : 'Show'}</button>
              </Field>
              {signup && <>
                <div className="lg-meter" aria-live="polite"><span className={`s${strength}`}><i /><i /><i /><i /></span><small>{password ? STRENGTH[strength] : 'Mix letters and numbers'}</small></div>
                <Field id="lg-pw2" label="Confirm password" type={showPw ? 'text' : 'password'} autoComplete="new-password" placeholder="Type it again" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} ok={!!confirmPassword && confirmPassword === password} disabled={!!busy} required />
                <label className="lg-agree"><input type="checkbox" checked={agree} onChange={e => setAgree(e.target.checked)} /><span>I agree to the <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> and <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a></span></label>
              </>}
              {err && <div className="login-err" role="alert" aria-live="assertive">{err}</div>}
              {notice && <div className="login-notice" role="status">{notice}</div>}
              <button className="lg-btn pri" type="submit" disabled={!ready || !!busy} aria-busy={busy === 'email'}>{busy === 'email' ? <Spinner /> : null}<span>{busy === 'email' ? 'Please wait…' : signup ? 'Create account' : 'Sign in'}</span></button>
            </form>
            <p className="lg-switch">{signup ? 'Already have an account?' : 'New to AraLab?'} <button type="button" className="lg-link" onClick={() => changeMode(signup ? 'signin' : 'signup')} disabled={!!busy}>{signup ? 'Sign in' : 'Create an account'}</button></p>
            <p className="login-legal"><a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy</a> · <a href="/terms" target="_blank" rel="noopener noreferrer">Terms</a> · <a href="/delete-account" target="_blank" rel="noopener noreferrer">Delete account</a></p>
          </>)}
        </section>
      </div>
    </div>
  )
}
