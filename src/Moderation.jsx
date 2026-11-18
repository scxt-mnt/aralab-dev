// University Astra desk. Astra members are students the admin assigned to one school. They can:
//  - check flags on reviewers raised by students of their school. Approving a flag fixes the reviewer
//    with AI (missing topics + wrong information) using the flag's notes/files, or dismisses it.
//  - (v47) monitor how students of their school use AI generation (no approval step any more: the AI checks every request first),
//    pause a student's generation for 1 / 3 / 7 days, resume it, remove a reviewer, or report a student to the admin. Every action needs a written
//    reason and the student is notified with it. Admins can do the same for every school.
//  - file a ban report with evidence for bad words / harassment / unethical behaviour. ONLY the admin decides the ban.
// Admins use the same screen to review ban reports, unban, and assign Astra members. Rules are enforced in the database (supabase-setup.sql v12).
import { callAi } from './aiRun'
import AiBar from './AiBar'
import { useCallback, useEffect, useState } from 'react'
import SchoolInput from './SchoolInput'
import { sb } from './supabase'
import Icon from './Icons'
import { FLAG_REASONS, FlagPointsView } from './flagUi'
import { CompareModal } from './FlagCompare'
import CopyButton from './CopyButton'
import { useUniversities, loadUniversities, normSchool } from './schools'

const CATS = { bad_words: 'Bad words / profanity', harassment: 'Harassment / bullying', unethical: 'Unethical behaviour (cheating, scams…)', other: 'Other' }
const KINDS = { post: 'Post', comment: 'Comment', request: 'Reviewer request', other: 'Other' }
const esc = s => String(s).replace(/[%_\\]/g, '\\$&')
const day = d => new Date(d).toLocaleDateString()

function useProfiles(ids) {
  const [map, setMap] = useState({})
  const key = [...new Set(ids.filter(Boolean))].sort().join(',')
  useEffect(() => {
    if (!key) return
    sb.from('profiles').select('user_id,display_name,school,banned,student_no').in('user_id', key.split(',')).then(({ data }) => setMap(m => ({ ...m, ...Object.fromEntries((data || []).map(p => [p.user_id, p])) })))
  }, [key])
  return id => { const p = map[id]; return p ? `${p.display_name || 'Student'}${p.student_no ? ' · ' + p.student_no : ''}` : 'Student' }
}

export default function Moderation({ me, admin, school, toast, onChanged, onOpenProfile }) {
  const [tab, setTab] = useState(admin ? 'bans' : 'gen')
  const tabs = admin
    ? [['bans', 'Ban reports'], ['gen', 'Generation activity'], ['log', 'Staff actions'], ['posts', 'Removed posts'], ['apps', 'Astra applications'], ['members', 'Astra members'], ['unis', 'Universities']]
    : [['gen', 'Generation'], ['flags', 'Flags'], ['mine', 'My actions']]
  return (
    <div className="astra">
      <section className="clay astra-hero">
        <div className="astra-h">
          <small className="onb-step">{admin ? 'Admin' : 'University Astra desk'}</small>
          <h2>{admin ? 'Moderation' : school}</h2>
          <p className="mute">{admin ? 'Review temporary bans set by Astra members (keep, ban completely, or lift), and choose who is Astra for each school.' : 'You review flags and reviewer requests for students of your school, and can temporarily ban a student from one of their posts (use ⋯ on the post). The admin then reviews every temporary ban. Students generate reviewers on their own (AI checks every request), so you watch the Generation tab: pause, resume or report a student who misuses it, and remove a reviewer from the Library, always with a reason the student can read.'}</p>
        </div>
      </section>
      <div className="chips">{tabs.map(([k, label]) => <button key={k} className={tab === k ? 'chip on' : 'chip'} onClick={() => setTab(k)}>{label}</button>)}</div>
      {tab === 'flags' && <Flags me={me} toast={toast} onChanged={onChanged} />}
      {tab === 'gen' && <GenActivity admin={admin} toast={toast} onOpenProfile={onOpenProfile} />}
      {tab === 'log' && <StaffLog toast={toast} />}
      {tab === 'mine' && <><StaffLog toast={toast} /><h3 style={{ marginTop: 24 }}>Temporary bans I set</h3><Reports me={me} toast={toast} /><h3 style={{ marginTop: 24 }}>Posts I removed</h3><RemovedPosts toast={toast} /></>}
      {tab === 'bans' && <AdminBans toast={toast} />}
      {tab === 'posts' && <RemovedPosts admin toast={toast} />}
      {tab === 'apps' && <AstraApplications toast={toast} onOpenProfile={onOpenProfile} />}
      {tab === 'members' && <Members toast={toast} />}
      {tab === 'unis' && <Universities toast={toast} />}
    </div>
  )
}

function Flags({ me, toast, onChanged }) {
  const [flags, setFlags] = useState(null), [titles, setTitles] = useState({}), [busy, setBusy] = useState(null), [cmp, setCmp] = useState(null)
  const load = useCallback(async () => {
    const q = c => sb.from('reviewer_flags').select('id,reviewer_id,user_id,reason,note,points,created_at,astra_verdict' + c).eq('resolved', false).is('astra_verdict', null).neq('user_id', me).order('created_at', { ascending: false }).limit(100)
    let { data, error } = await q(',original,proposed,fixed_by')
    if (error) ({ data, error } = await q(''))   // SQL v13 not run yet: still show flags
    if (error) { toast(error.message); return setFlags([]) }
    setFlags(data)
    const ids = [...new Set(data.map(f => f.reviewer_id))]
    if (ids.length) { const { data: r } = await sb.from('reviewers').select('id,title,subject').in('id', ids); setTitles(Object.fromEntries((r || []).map(x => [x.id, x]))) }
  }, [me, toast])
  useEffect(() => { load() }, [load])
  const [prog, setProg] = useState(null)
  const who = useProfiles((flags || []).map(f => f.user_id))
  const verdict = async (f, v) => {
    const row = v === 'valid' ? { astra_verdict: 'valid', astra_by: me } : { astra_verdict: 'dismissed', astra_by: me, resolved: true }
    const { error } = await sb.from('reviewer_flags').update(row).eq('id', f.id)
    if (error) return toast(error.message)
    toast(v === 'valid' ? 'Marked valid. The admin can now fix the reviewer.' : 'Flag dismissed.'); load()
  }
  // Approve the flag and let the AI correct / expand the reviewer using the points and attached files.
  const fix = async f => {
    setBusy(f.id)
    try {
      const { data: s } = await sb.auth.getSession()
      const { ok, status, body: j } = await callAi('/api/fix-reviewer', s.session.access_token, { flagId: f.id }, setProg)
      if (!ok) toast(j.error || `Could not fix the reviewer (${status}).`)
      else { toast(j.fixed > 1 ? `Approved. The reviewer was fixed using ${j.fixed} flags.` : 'Approved. The reviewer was fixed with AI.'); load(); onChanged?.() }
    } catch { toast('Could not reach the server. Locally, run "vercel dev" instead of "npm run dev".') }
    setBusy(null); setProg(null)
  }
  if (!flags) return <div className="clay tile empty">Loading…</div>
  if (!flags.length) return <div className="clay tile empty">No flags from your school waiting for you.</div>
  return <><div className="rlist">{flags.map(f => (
    <div className="clay tile rcard" key={f.id}>
      <div className="rtop"><b>{titles[f.reviewer_id]?.title || 'Reviewer'}</b><span className="pill" style={{ background: '#f2b872' }}>{FLAG_REASONS[f.reason] || f.reason}</span></div>
      <small className="mute">{titles[f.reviewer_id]?.subject} · flagged by {who(f.user_id)} · {day(f.created_at)}</small>
      <FlagPointsView flag={f} toast={toast} />
      <button type="button" className="btn" onClick={() => setCmp(f)}>{f.proposed ? `Compare edit (${f.fixed_by === 'ai' ? 'AI' : 'student'})` : 'Compare / draft fix'}</button>
      {busy === f.id && <AiBar p={prog} />}
      <div className="acts">
        <button className="btn pri" disabled={busy === f.id} onClick={() => fix(f)}><Icon name="sparkles" size={15} /> {busy === f.id ? 'Fixing…' : 'Approve & fix with AI'}</button>
        <button className="btn" disabled={busy === f.id} onClick={() => verdict(f, 'valid')}>Send to admin</button>
        <button className="btn dng" disabled={busy === f.id} onClick={() => verdict(f, 'dismissed')}>Dismiss</button>
      </div>
      <small className="mute">Approving fixes what is missing or wrong in the reviewer with AI, then updates it for everyone.</small>
    </div>))}</div>
    {cmp && <CompareModal item={{ id: cmp.reviewer_id, title: titles[cmp.reviewer_id]?.title || 'Reviewer' }} flag={cmp} canAct onClose={() => setCmp(null)} onDone={() => { setCmp(null); load(); onChanged?.() }} toast={toast} />}
  </>
}

const BSTAT = { pending: ['Waiting for admin', '#f2b872'], banned: ['Banned completely', '#e8788a'], confirmed: ['Temp ban confirmed', '#7fc8a0'], dismissed: ['Ban lifted', '#9aa3c7'] }
function Reports({ me, toast }) {
  const [rows, setRows] = useState(null), [tick, setTick] = useState(0), [busy, setBusy] = useState(null)
  useEffect(() => { sb.from('ban_reports').select('*').eq('reporter_id', me).order('created_at', { ascending: false }).limit(50).then(({ data, error }) => { if (error) toast(error.message); setRows(data || []) }) }, [me, toast, tick])
  const who = useProfiles((rows || []).map(r => r.target_id))
  const bringBack = async x => {
    if (!confirm(`Bring ${who(x.target_id)} back? Their ban is lifted and the post comes back.`)) return
    setBusy(x.id)
    const { error } = await sb.rpc('astra_lift_temp_ban', { _report: x.id })
    setBusy(null)
    if (error) return toast(error.message); toast('Student brought back.'); setTick(n => n + 1)
  }
  if (!rows) return <div className="clay tile empty">Loading…</div>
  if (!rows.length) return <div className="clay tile empty">You haven’t temp-banned anyone.</div>
  return <div className="rlist">{rows.map(r => { const [l, c] = BSTAT[r.status]; return (
    <div className="clay tile rcard" key={r.id}>
      <div className="rtop"><b>{who(r.target_id)}</b><span className="pill" style={{ background: c }}>{l}</span></div>
      <small className="mute">{r.temp_until ? `Temporary ban until ${day(r.temp_until)}` : CATS[r.category]} · {day(r.created_at)}</small>
      {r.temp_until && ['pending', 'confirmed'].includes(r.status) && new Date(r.temp_until) > new Date() && <div className="acts"><button className="btn pri" disabled={busy === r.id} onClick={() => bringBack(r)}>Bring back (lift ban)</button></div>}
      {r.admin_note && <p className="note">Admin note: {r.admin_note}</p>}
    </div>) })}</div>
}

function AdminBans({ toast }) {
  const [rows, setRows] = useState(null), [banned, setBanned] = useState([]), [tempB, setTempB] = useState([]), [notes, setNotes] = useState({}), [busy, setBusy] = useState(null)
  const load = useCallback(async () => {
    const [a, b, c] = await Promise.all([
      sb.from('ban_reports').select('*').eq('status', 'pending').order('created_at', { ascending: true }).limit(100),
      sb.from('profiles').select('user_id,display_name,school,ban_reason').eq('banned', true).limit(200),
      sb.from('profiles').select('user_id,display_name,school,temp_ban_until').gt('temp_ban_until', new Date().toISOString()).limit(200)])
    if (a.error) toast(a.error.message); setRows(a.data || []); setBanned(b.data || []); setTempB(c.data || [])
  }, [toast])
  useEffect(() => { load(); const ch = sb.channel('ban-q').on('postgres_changes', { event: '*', schema: 'public', table: 'ban_reports' }, load).subscribe(); return () => { sb.removeChannel(ch) } }, [load])
  const who = useProfiles((rows || []).flatMap(r => [r.target_id, r.reporter_id]))
  const decide = async (r, action) => {
    if (action === 'ban' && !confirm(`Ban ${who(r.target_id)} completely? They won’t be able to use the app.`)) return
    setBusy(r.id)
    const { error } = await sb.rpc('decide_temp_ban', { _id: r.id, _action: action, _note: notes[r.id] || '' })
    setBusy(null)
    if (error) return toast(error.message); toast({ keep: 'Temporary ban kept.', ban: 'Student banned completely.', lift: 'Ban lifted.' }[action]); load()
  }
  const unban = async p => { const { error } = await sb.rpc('unban_user', { _uid: p.user_id }); if (error) return toast(error.message); toast('Brought back.'); load() }
  if (!rows) return <div className="clay tile empty">Loading…</div>
  return (
    <>
      {!rows.length && <div className="clay tile empty">No ban reports waiting.</div>}
      <div className="rlist">{rows.map(r => (
        <div className="clay tile rcard" key={r.id}>
          <div className="rtop"><b>{who(r.target_id)}</b><span className="pill" style={{ background: '#e8788a' }}>{CATS[r.category]}</span></div>
          <small className="mute">{r.school} · reported by Astra {who(r.reporter_id)} · {day(r.created_at)}</small>
          {r.temp_until && <p><span className="pill" style={{ background: '#f2b872' }}>Temp ban until {day(r.temp_until)}</span> set by Astra, and the post was taken down. Is it right? Lifting the ban also restores the post.</p>}<p>{r.details}</p>
          <ul className="flag-list">{r.evidence.map((e, i) => <li key={i}><b>{KINDS[e.kind] || 'Evidence'}</b><p>{e.text}</p>{e.ref && <small className="mute">{e.ref}</small>}</li>)}</ul>
          <div className="acts">
            <input className="clay-in" style={{ flex: 1, minWidth: 140 }} placeholder="Note (shown to the student if banned)" maxLength={300} value={notes[r.id] || ''} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })} />
            {r.temp_until && <button className="btn pri" disabled={busy === r.id} onClick={() => decide(r, 'keep')}>Keep temp ban</button>}
            <button className="btn dng" disabled={busy === r.id} onClick={() => decide(r, 'ban')}>Ban completely</button>
            <button className="btn" disabled={busy === r.id} onClick={() => decide(r, 'lift')}>{r.temp_until ? 'Lift (wrong)' : 'Dismiss'}</button>
          </div>
        </div>))}</div>
      {tempB.length > 0 && <>
        <h3 style={{ marginTop: 24 }}>Temporarily banned</h3>
        <div className="rlist">{tempB.map(p => <div className="clay tile rcard" key={p.user_id}><div className="rtop"><b>{p.display_name || 'Student'}</b><button className="btn" onClick={() => unban(p)}>Bring back</button></div><small className="mute">{p.school} · until {day(p.temp_ban_until)}</small></div>)}</div></>}
      {banned.length > 0 && <>
        <h3 style={{ marginTop: 24 }}>Banned students</h3>
        <div className="rlist">{banned.map(p => <div className="clay tile rcard" key={p.user_id}><div className="rtop"><b>{p.display_name || 'Student'}</b><button className="btn" onClick={() => unban(p)}>Unban</button></div><small className="mute">{p.school} · {p.ban_reason}</small></div>)}</div></>}
    </>
  )
}

// Admin: students who applied to become Astra. Approving re-checks the requirements on the server.
function AstraApplications({ toast, onOpenProfile }) {
  const [rows, setRows] = useState(null), [notes, setNotes] = useState({}), [busy, setBusy] = useState(null)
  const load = useCallback(async () => {
    const { data, error } = await sb.from('astra_applications').select('*').eq('status', 'pending').order('created_at')
    if (error) toast(error.message); setRows(data || [])
  }, [toast])
  useEffect(() => { load() }, [load])
  const who = useProfiles((rows || []).map(r => r.user_id))
  const decide = async (r, approve) => {
    setBusy(r.id)
    const { error } = await sb.rpc('decide_astra_application', { _id: r.id, _approve: approve, _note: notes[r.id] || '' })
    setBusy(null)
    if (error) return toast(error.message)
    toast(approve ? `${who(r.user_id)} is now Astra for ${r.school}.` : 'Application rejected.'); load()
  }
  if (!rows) return <div className="clay tile empty">Loading…</div>
  if (!rows.length) return <div className="clay tile empty">No Astra applications waiting.</div>
  return <div className="rlist">{rows.map(r => { const s = r.snapshot || {}, mine = s.mine || {}, req = s.requirements || {}; return (
    <div className="clay tile rcard" key={r.id}>
      <div className="rtop"><b>{who(r.user_id)}</b><button className="btn" onClick={() => onOpenProfile?.(r.user_id)}>Open profile</button></div>
      <small className="mute">{r.school} · applied {day(r.created_at)} · {req.astra_count ?? '?'} Astra at the time</small>
      <p className="note">{mine.days} days · {mine.points} points · {mine.reviewers} reviewers · {mine.flags} accepted flags <span className="mute">(needed {req.days} / {req.points} / {req.reviewers} / {req.flags})</span></p>
      <blockquote className="mute" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.message}</blockquote>
      <div className="acts">
        <input className="clay-in" style={{ flex: 1, minWidth: 140 }} placeholder="Note to the student (optional)" maxLength={300} value={notes[r.id] || ''} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })} />
        <button className="btn pri" disabled={busy === r.id} onClick={() => decide(r, true)}>Approve as Astra</button>
        <button className="btn dng" disabled={busy === r.id} onClick={() => decide(r, false)}>Reject</button>
      </div>
    </div>) })}</div>
}

function Members({ toast }) {
  const unis = useUniversities()
  const [rows, setRows] = useState(null), [q, setQ] = useState(''), [found, setFound] = useState([]), [pick, setPick] = useState(null), [school, setSchool] = useState('')
  const load = useCallback(async () => { const { data, error } = await sb.from('astra_members').select('user_id,school,created_at').order('school'); if (error) toast(error.message); setRows(data || []) }, [toast])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (q.trim().length < 2) return setFound([])
    const t = setTimeout(() => sb.from('profiles').select('user_id,display_name,school,student_no').or(`display_name.ilike.%${esc(q.trim()).replace(/[,()*"]/g, ' ')}%,student_no.ilike.%${esc(q.trim()).replace(/[,()*"]/g, ' ')}%`).limit(8).then(({ data }) => setFound(data || [])), 250)
    return () => clearTimeout(t)
  }, [q])
  const who = useProfiles((rows || []).map(r => r.user_id))
  const add = async e => {
    e.preventDefault()
    const { error } = await sb.from('astra_members').upsert({ user_id: pick.user_id, school: normSchool(school) })
    if (error) return toast(error.message)
    toast(`${pick.display_name} is now Astra for ${normSchool(school)}.`); setPick(null); setQ(''); setSchool(''); load()
  }
  const remove = async m => { if (!confirm(`Remove ${who(m.user_id)} as Astra?`)) return; const { error } = await sb.from('astra_members').delete().eq('user_id', m.user_id); if (error) return toast(error.message); load() }
  return (
    <>
      <form className="clay tile rform" onSubmit={add}>
        <h3>Assign an Astra member</h3>
        {pick ? <div className="row spread"><b>{pick.display_name} {pick.student_no && <span className="sid">ID {pick.student_no} <CopyButton value={pick.student_no} label="Student ID" toast={toast} /></span>}</b><button type="button" className="btn" onClick={() => setPick(null)}>Change</button></div> : (
          <label>Student name or student ID<input className="clay-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Type a name or an ID like S26-000123…" />
            {found.length > 0 && <div className="chips">{found.map(s => <button type="button" key={s.user_id} className="chip" onClick={() => { setPick(s); setSchool(s.school || '') }}>{s.display_name} <em className="you">{s.student_no}</em> {s.school && <small className="mute">{s.school}</small>}</button>)}</div>}</label>)}
        <label>University<SchoolInput required maxLength={80} value={school} options={unis} onChange={setSchool} placeholder="Type a university, e.g. PUP" /></label>
        <button className="btn pri" disabled={!pick || !school.trim()}>Assign</button>
      </form>
      {rows && !rows.length && <div className="clay tile empty">No Astra members yet.</div>}
      <div className="rlist">{(rows || []).map(m => <div className="clay tile rcard" key={m.user_id}><div className="rtop"><b>{who(m.user_id)}</b><button className="btn dng" onClick={() => remove(m)}>Remove</button></div><small className="mute">Astra for {m.school} · since {day(m.created_at)}</small></div>)}</div>
    </>
  )
}

// Admin: the list of state universities. The server refreshes it from a public API weekly; here you can sync now, switch a school off, or add one by hand.
function Universities({ toast }) {
  const [rows, setRows] = useState(null), [busy, setBusy] = useState(false), [name, setName] = useState(''), [q, setQ] = useState('')
  const load = useCallback(async () => { const { data, error } = await sb.from('state_universities').select('name,active,source,added_at').order('name').limit(2000); if (error) toast(error.message); setRows(data || []) }, [toast])
  useEffect(() => { load() }, [load])
  const sync = async () => {
    setBusy(true)
    try {
      const { data: s } = await sb.auth.getSession()
      const res = await fetch('/api/universities', { method: 'POST', headers: { Authorization: `Bearer ${s.session.access_token}` } })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) toast(j.error || `Sync failed (${res.status}).`)
      else { toast(j.added.length ? `Added ${j.added.length} new: ${j.added.slice(0, 3).join(', ')}${j.added.length > 3 ? '…' : ''}` : `Up to date (${j.matched} universities found).`); load(); loadUniversities(true) }
    } catch { toast('Could not reach the server.') }
    setBusy(false)
  }
  const toggle = async r => { const { error } = await sb.from('state_universities').update({ active: !r.active }).eq('name', r.name); if (error) return toast(error.message); load(); loadUniversities(true) }
  const add = async e => {
    e.preventDefault()
    const { error } = await sb.from('state_universities').insert({ name: normSchool(name), source: 'admin', active: true })
    if (error) return toast(/duplicate/i.test(error.message) ? 'Already in the list.' : error.message)
    setName(''); load(); loadUniversities(true)
  }
  const shown = (rows || []).filter(r => r.name.toLowerCase().includes(q.toLowerCase()))
  return (
    <>
      <div className="clay tile rform">
        <div className="row spread"><h3>Universities ({(rows || []).filter(r => r.active).length} active)</h3><button className="btn pri" disabled={busy} onClick={sync}>{busy ? 'Syncing…' : 'Sync from API now'}</button></div>
        <p className="mute">Every Philippine university, state and private. Refreshed automatically every Monday from a public API; if a school is missing, add it by hand. Students never see this whole list: they type and pick from suggestions. Switch off any name that is wrong.</p>
        <form className="row" onSubmit={add}><input className="clay-in grow" required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="Add one by hand…" /><button className="btn">Add</button></form>
        <input className="clay-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter the list…" />
      </div>
      <div className="rlist">{shown.map(r => <div className="clay tile rcard" key={r.name}><div className="rtop"><b style={{ opacity: r.active ? 1 : .5 }}>{r.name}</b><button className={r.active ? 'btn' : 'btn pri'} onClick={() => toggle(r)}>{r.active ? 'Switch off' : 'Switch on'}</button></div><small className="mute">{r.source}</small></div>)}</div>
    </>
  )
}

const RSTAT = { pending: ['Waiting for admin', '#f2b872'], confirmed: ['Removal kept', '#7fc8a0'], restored: ['Restored by admin', '#9aa3c7'], deleted: ['Deleted for good', '#e8788a'] }
// admin: decide pending removals. Astra: see the posts they removed and what the admin decided.
function RemovedPosts({ admin, toast }) {
  const [rows, setRows] = useState(null), [notes, setNotes] = useState({}), [busy, setBusy] = useState(null)
  const load = useCallback(async () => {
    let q = sb.from('post_removals').select('*').order('created_at', { ascending: false }).limit(100)
    if (admin) q = q.in('status', ['pending', 'confirmed'])
    const { data, error } = await q
    if (error) toast(error.message); setRows(data || [])
  }, [admin, toast])
  useEffect(() => { load() }, [load])
  const who = useProfiles((rows || []).flatMap(r => [r.author_id, r.remover_id]))
  const decide = async (r, action) => {
    if (action === 'delete' && !confirm('Delete this post for good? This cannot be undone.')) return
    setBusy(r.id)
    const { error } = await sb.rpc('decide_post_removal', { _id: r.id, _action: action, _note: notes[r.id] || '' })
    setBusy(null)
    if (error) return toast(error.message); toast({ keep: 'Removal kept.', restore: 'Post restored.', delete: 'Post deleted.' }[action]); load()
  }
  if (!rows) return <div className="clay tile empty">Loading…</div>
  if (!rows.length) return <div className="clay tile empty">{admin ? 'No removed posts.' : 'You have not removed any posts.'}</div>
  return <div className="rlist">{rows.map(r => { const [l, c] = RSTAT[r.status] || ['', '#ccc']; return (
    <div className="clay tile rcard" key={r.id}>
      <div className="rtop"><b>{who(r.author_id)}</b><span className="pill" style={{ background: c }}>{l}</span></div>
      <small className="mute">{r.school} · removed by {r.admin_note === 'Removed by admin' ? 'admin' : 'Astra'} {who(r.remover_id)} · {day(r.created_at)}</small>
      <p className="note"><b>Reason:</b> {r.reason}</p>
      {r.body && <blockquote className="mute" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{r.body}</blockquote>}
      {r.admin_note && <p className="note">Admin note: {r.admin_note}</p>}
      {admin && (r.status === 'pending' || r.status === 'confirmed') && <div className="acts">
        <input className="clay-in" style={{ flex: 1, minWidth: 140 }} placeholder="Note (optional)" maxLength={300} value={notes[r.id] || ''} onChange={e => setNotes({ ...notes, [r.id]: e.target.value })} />
        {r.status === 'pending' && <button className="btn pri" disabled={busy === r.id} onClick={() => decide(r, 'keep')}>Keep removed</button>}
        <button className="btn" disabled={busy === r.id} onClick={() => decide(r, 'restore')}>Restore (wrong)</button>
        <button className="btn dng" disabled={busy === r.id} onClick={() => decide(r, 'delete')}>Delete forever</button>
      </div>}
    </div>) })}</div>
}


// ===== v47: generation monitor =====
const OUTCOME = { generated: ['Built', '#6fcf97'], blocked: ['Blocked by AI', '#e8788a'], duplicate: ['Already existed', '#9aa3c7'], failed: ['Failed', '#f2b872'] }
const KIND = { pause: 'Paused generation', resume: 'Resumed generation', remove_reviewer: 'Removed a reviewer', restore_reviewer: 'Restored a reviewer', report: 'Reported to admin' }
const longPause = iso => new Date(iso).getFullYear() - new Date().getFullYear() > 1
const when = iso => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function GenActivity({ admin, toast, onOpenProfile }) {
  const [rows, setRows] = useState(null), [q, setQ] = useState(''), [f, setF] = useState('all'), [panel, setPanel] = useState(null), [logs, setLogs] = useState({}), [tick, setTick] = useState(0)
  useEffect(() => {
    let live = true
    sb.rpc('gen_monitor').then(({ data, error }) => {
      if (!live) return
      if (error) { toast(/gen_monitor/.test(error.message) ? 'Run the latest supabase-setup.sql first.' : error.message); return setRows([]) }
      setRows(data || [])
    })
    return () => { live = false }
  }, [tick, toast])
  const showLog = async uid => {
    if (logs[uid]) return setLogs(l => { const n = { ...l }; delete n[uid]; return n })
    const { data } = await sb.from('gen_log').select('id,title,outcome,reason,created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(12)
    setLogs(l => ({ ...l, [uid]: data || [] }))
  }
  const shown = (rows || []).filter(r => (f === 'all' || (f === 'paused' && r.paused_until) || (f === 'blocked' && r.blocked_week > 0)) &&
    (!q.trim() || `${r.display_name} ${r.student_no}`.toLowerCase().includes(q.trim().toLowerCase())))
  if (!rows) return <div className="clay tile empty">Loading…</div>
  return (
    <>
      <div className="bar">
        <div className="search grow"><Icon name="search" size={17} /><input className="clay-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Search a student by name or ID…" aria-label="Search students" /></div>
        {[['all', 'All'], ['blocked', 'Blocked this week'], ['paused', 'Paused']].map(([k, label]) => <button key={k} className={f === k ? 'chip on' : 'chip'} onClick={() => setF(k)}>{label}</button>)}
      </div>
      <p className="mute" style={{ margin: '0 0 4px' }}>Students who generated (or tried to) in the last 30 days. “Blocked” means the AI check refused the notes: not study material, inappropriate, private or spam. Duplicates are shown but are not misuse by themselves.</p>
      {!shown.length && <div className="clay tile empty">{rows.length ? 'Nothing matches.' : 'No generation activity yet.'}</div>}
      <div className="rlist">{shown.map(r => (
        <div className="clay tile rcard gen-row" key={r.user_id}>
          <div className="rtop">
            <button type="button" className="who rt-main" onClick={() => onOpenProfile?.(r.user_id)} title="Open this student's profile"><b>{r.display_name || 'Student'}</b><small className="mute">{r.student_no}{admin && r.school ? ` · ${r.school}` : ''}</small></button>
            {r.paused_until && <span className="pill" style={{ background: '#e8788a' }}>Paused until {longPause(r.paused_until) ? 'lifted' : when(r.paused_until)}</span>}
            {!r.paused_until && r.blocked_week >= 3 && <span className="pill" style={{ background: '#f2b872' }}>Check this student</span>}
          </div>
          <div className="gen-stats">
            <span><b>{r.attempts_today}</b> today</span><span><b>{r.attempts_week}</b> this week</span><span><b>{r.generated_week}</b> built</span><span className={r.blocked_week ? 'bad' : ''}><b>{r.blocked_week}</b> blocked/duplicate</span>
            {r.last_at && <span className="mute">last {when(r.last_at)}</span>}
          </div>
          {r.paused_until && r.pause_reason && <p className="note">Reason given: {r.pause_reason}</p>}
          <div className="acts">
            <button className="btn" onClick={() => showLog(r.user_id)}>{logs[r.user_id] ? 'Hide history' : 'See history'}</button>
            {r.paused_until
              ? <button className="btn pri" onClick={() => setPanel({ kind: 'resume', r })}>Resume</button>
              : <button className="btn dng" onClick={() => setPanel({ kind: 'pause', r })}>Pause generation…</button>}
            {!admin && <button className="btn" onClick={() => setPanel({ kind: 'report', r })}>Report to admin…</button>}
          </div>
          {logs[r.user_id] && <ul className="flag-list">{logs[r.user_id].length ? logs[r.user_id].map(l => { const [lab, col] = OUTCOME[l.outcome] || [l.outcome, '#999']; return <li key={l.id}><span className="pill" style={{ background: col }}>{lab}</span> <b>{l.title || 'Untitled'}</b>{l.reason && <p className="mute">{l.reason}</p>}<small className="mute">{when(l.created_at)}</small></li> }) : <li className="mute">No history.</li>}</ul>}
        </div>))}</div>
      {panel && <ActionModal admin={admin} {...panel} toast={toast} onClose={() => setPanel(null)} onDone={() => { setPanel(null); setTick(n => n + 1) }} />}
    </>
  )
}

// pause / resume / report: always with a written reason; the student is notified by the database function
function ActionModal({ kind, r, admin, toast, onClose, onDone }) {
  const [days, setDays] = useState(1), [reason, setReason] = useState(''), [busy, setBusy] = useState(false)
  const min = kind === 'report' ? 20 : kind === 'pause' ? 10 : 0, ok = reason.trim().length >= min
  const name = r.display_name || 'this student'
  const go = async () => {
    setBusy(true)
    const call = kind === 'pause' ? sb.rpc('pause_generation', { _uid: r.user_id, _days: Number(days), _reason: reason.trim() })
      : kind === 'resume' ? sb.rpc('resume_generation', { _uid: r.user_id, _note: reason.trim() })
      : sb.rpc('report_generation', { _uid: r.user_id, _reason: reason.trim() })
    const { error } = await call
    setBusy(false)
    if (error) return toast(/function/.test(error.message) && /(pause_generation|resume_generation|report_generation)/.test(error.message) ? 'Run the latest supabase-setup.sql first.' : error.message)
    toast(kind === 'pause' ? `${name}’s generation is paused. They were told why.` : kind === 'resume' ? `${name} can generate again.` : 'Reported to the admin.')
    onDone()
  }
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label={kind} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="clay modal">
        <h3>{kind === 'pause' ? `Pause ${name}’s generation` : kind === 'resume' ? `Let ${name} generate again` : `Report ${name} to the admin`}</h3>
        {kind === 'pause' && <label>For how long
          <select className="clay-in" value={days} onChange={e => setDays(e.target.value)}>
            <option value={1}>1 day</option><option value={3}>3 days</option><option value={7}>7 days</option>
            {admin && <><option value={30}>30 days</option><option value={0}>Until I lift it</option></>}
          </select></label>}
        <label>{kind === 'resume' ? 'Note (optional)' : 'Why?'} <small className="mute">{kind === 'pause' ? '(the student will read this)' : kind === 'report' ? '(only the admin reads this; the last blocked attempts are attached automatically)' : ''}</small>
          <textarea className="clay-in" rows="3" maxLength={kind === 'report' ? 1500 : 300} autoFocus={kind !== 'resume'} value={reason} onChange={e => setReason(e.target.value)}
            placeholder={kind === 'pause' ? 'e.g. Uploaded the same unrelated file 5 times. Please upload real study notes.' : kind === 'report' ? 'Describe what the student did and why it needs the admin.' : 'Optional'} /></label>
        <div className="row"><button className="btn" onClick={onClose}>Cancel</button>
          <button className={kind === 'resume' ? 'btn pri' : 'btn dng'} disabled={!ok || busy} onClick={go}>{busy ? 'Saving…' : kind === 'pause' ? 'Pause' : kind === 'resume' ? 'Resume' : 'Send report'}</button></div>
        {!ok && reason.length > 0 && <small className="mute">At least {min} characters.</small>}
      </div>
    </div>
  )
}

// what staff did (admins see everyone's actions, Astra their own)
function StaffLog({ toast }) {
  const [rows, setRows] = useState(null)
  useEffect(() => { sb.from('mod_actions').select('*').order('created_at', { ascending: false }).limit(100).then(({ data, error }) => { if (error) toast(/mod_actions/.test(error.message) ? 'Run the latest supabase-setup.sql first.' : error.message); setRows(data || []) }) }, [toast])
  const who = useProfiles((rows || []).flatMap(r => [r.actor_id, r.target_id]))
  if (!rows) return <div className="clay tile empty">Loading…</div>
  if (!rows.length) return <div className="clay tile empty">No actions yet.</div>
  return <div className="rlist">{rows.map(r => (
    <div className="clay tile rcard" key={r.id}>
      <div className="rtop"><b>{KIND[r.kind] || r.kind}</b><small className="mute">{when(r.created_at)}</small></div>
      <small className="mute">{r.target_id ? `Student: ${who(r.target_id)} · ` : ''}by {who(r.actor_id)}{r.school ? ` · ${r.school}` : ''}</small>
      {r.reason && <p className="note"><b>Reason:</b> {r.reason}</p>}
    </div>))}</div>
}
