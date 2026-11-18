// "My university": the students who go to the same university as you, with Follow / Following buttons.
// "Other universities": every other school with how many students it has. Type to find any university, follow a school,
// or open one to see its students (and follow them too).
// Everyone is loaded once (names and programs only) and filtered in the browser, so search and filters feel instant.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { sb } from './supabase'
import { follow, unfollow } from './notifyApi'
import { filterPeople, programsOf, sortPeople } from './campusLogic'
import { AstraBadge } from './AstraBadge'
import Avatar from './UserAvatar'
import Icon from './Icons'
import { RowsSkeleton } from './Skeleton'
import { fetchSchoolDirectory, followSchool, unfollowSchool, otherSchools, schoolDbHint } from './schoolApi'

const PAGE = 30, MAX = 3000
const FULL = 'user_id,display_name,avatar_url,student_no,program,institute,bio', BASE = 'user_id,display_name,avatar_url,student_no'
const MODES = [['all', 'Everyone'], ['new', 'Not following yet'], ['following', 'Following'], ['followers', 'Follow me']]

async function loadClassmates(school, me) {
  const out = []
  for (let from = 0; from < MAX; from += 1000) {
    const q = cols => sb.from('profiles').select(cols).ilike('school', school.replace(/[%_]/g, m => '\\' + m)).eq('onboarded', true).eq('banned', false).neq('user_id', me).order('display_name').range(from, from + 999)
    let r = await q(FULL)
    if (r.error) r = await q(BASE)                      // database not upgraded yet: still list people, without program and bio
    if (r.error) throw r.error
    out.push(...r.data); if (r.data.length < 1000) break
  }
  return out.map(p => ({ ...p, program: p.program || '', institute: p.institute || '', bio: p.bio || '' }))
}

function SchoolPeople({ me, school, myProgram, toast, onOpenProfile, onSetSchool, others = false, head = null }) {
  const [people, setPeople] = useState(null), [following, setFollowing] = useState(() => new Set()), [followers, setFollowers] = useState(() => new Set())
  const [q, setQ] = useState(''), [program, setProgram] = useState(''), [mode, setMode] = useState('all'), [limit, setLimit] = useState(PAGE), [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    if (!school) return setPeople([])
    try {
      const [list, rel] = await Promise.all([loadClassmates(school, me), sb.from('follows').select('follower,followee').or(`follower.eq.${me},followee.eq.${me}`)])
      setPeople(list)
      const rows = rel.data || []
      setFollowing(new Set(rows.filter(r => r.follower === me).map(r => r.followee)))
      setFollowers(new Set(rows.filter(r => r.followee === me).map(r => r.follower)))
    } catch (e) { toast(e.message); setPeople([]) }
  }, [school, me, toast])
  useEffect(() => { setPeople(null); load() }, [load])
  useEffect(() => { setLimit(PAGE) }, [q, program, mode])

  const programs = useMemo(() => programsOf(people || []), [people])
  const rows = useMemo(() => sortPeople(filterPeople(people || [], { q, program, mode }, { following, followers }), myProgram), [people, q, program, mode, following, followers, myProgram])

  const toggle = async p => {
    const on = following.has(p.user_id)
    setBusy(p.user_id)
    const { error } = await (on ? unfollow(me, p.user_id) : follow(me, p.user_id))
    setBusy(null)
    if (error) return toast(/relation|schema cache|setup first|row-level/i.test(error.message) ? 'Finish your account setup (or re-run supabase-setup.sql) first.' : error.message)
    setFollowing(s => { const n = new Set(s); on ? n.delete(p.user_id) : n.add(p.user_id); return n })
    toast(on ? `Unfollowed ${p.display_name || 'student'}.` : `Following ${p.display_name || 'student'}. You will be notified when they publish.`)
  }

  if (!school) return (
    <div className="clay tile empty"><Icon name="school" size={30} /><p>Add your university to see the students who go there.</p><button className="btn pri" onClick={onSetSchool}>Add my university</button></div>
  )
  const mineCount = people ? people.filter(p => following.has(p.user_id)).length : 0
  const filtered = q || program || mode !== 'all'
  return (
    <>
      <section className="clay tile campus-hero">
        {head}
        <h2 className="h-ic"><Icon name="school" size={22} /> {others ? school : 'My university'}</h2>
        {!others && <p className="mute">{school}</p>}
        <p className="campus-sub">{people === null ? (others ? 'Loading students…' : 'Loading classmates…') : <><b>{people.length}</b> {others ? '' : 'other '}student{people.length === 1 ? '' : 's'} here · you follow <b>{mineCount}</b></>}</p>
        <div className="bar">
          <div className="search grow"><Icon name="search" size={17} /><input className="clay-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, student ID or program…" aria-label="Search students at your university" /></div>
          {programs.length > 0 && <select className="clay-in" value={program} onChange={e => setProgram(e.target.value)} aria-label="Filter by program"><option value="">All programs</option>{programs.map(p => <option key={p.key} value={p.key}>{p.label} ({p.n})</option>)}</select>}
        </div>
        <div className="chips">{MODES.map(([k, label]) => <button key={k} className={mode === k ? 'chip on' : 'chip'} onClick={() => setMode(k)}>{label}{k === 'followers' && followers.size > 0 && <b>{followers.size}</b>}</button>)}
          {filtered && <button className="chip" onClick={() => { setQ(''); setProgram(''); setMode('all') }}><Icon name="x" size={13} /> Clear</button>}</div>
      </section>

      {people !== null && rows.length === 0 && <div className="clay tile empty">{people.length ? 'Nobody matches these filters.' : others ? 'Nobody from this university has joined yet.' : 'No other students from your university have joined yet. Share the app with your classmates!'}</div>}
      {people === null && <RowsSkeleton label={others ? 'Loading students' : 'Loading classmates'} />}
      <ul className="people">
        {rows.slice(0, limit).map(p => (
          <li className="clay tile pp" key={p.user_id}>
            <button type="button" className="pp-main" onClick={() => onOpenProfile(p.user_id)}>
              <Avatar person={p} size={48} />
              <span className="pp-t">
                <b>{p.display_name || 'Student'} <AstraBadge userId={p.user_id} />{followers.has(p.user_id) && <em className="pp-tag">Follows you</em>}</b>
                <small className="mute">{p.program ? `${p.program}${p.institute ? ` · ${p.institute}` : ''}` : 'No program yet'}</small>
                {p.bio && <span className="pp-bio">{p.bio}</span>}
              </span>
            </button>
            <button type="button" className={following.has(p.user_id) ? 'btn' : 'btn pri'} disabled={busy === p.user_id} onClick={() => toggle(p)} aria-pressed={following.has(p.user_id)}>
              <Icon name={following.has(p.user_id) ? 'check' : 'userplus'} size={15} /> {following.has(p.user_id) ? 'Following' : followers.has(p.user_id) ? 'Follow back' : 'Follow'}
            </button>
          </li>))}
      </ul>
      {rows.length > limit && <button className="btn" onClick={() => setLimit(l => l + PAGE)}>Show more ({rows.length - limit} left)</button>}
    </>
  )
}

// Follow / Following for a whole school (you are told when a student of that school publishes a reviewer)
function FollowSchool({ me, row, toast, size = 15 }) {
  const [on, setOn] = useState(row.i_follow), [n, setN] = useState(row.followers), [busy, setBusy] = useState(false)
  const toggle = async () => {
    setBusy(true)
    const { error } = await (on ? unfollowSchool(me, row.school) : followSchool(me, row.school))
    setBusy(false)
    if (error) return toast(/setup first|row-level/i.test(error.message) ? 'Finish your account setup first.' : schoolDbHint(error))
    setOn(!on); setN(c => c + (on ? -1 : 1))
    toast(on ? `Unfollowed ${row.school}.` : `Following ${row.school}. You will be notified when a student there publishes a reviewer.`)
  }
  return (
    <span className="fs">
      <small className="mute">{n} follower{n === 1 ? '' : 's'}</small>
      <button type="button" className={on ? 'btn' : 'btn pri'} disabled={busy} onClick={toggle} aria-pressed={on}><Icon name={on ? 'check' : 'userplus'} size={size} /> {on ? 'Following' : 'Follow'}</button>
    </span>
  )
}

// Every other university with how many students joined. Nothing is listed until you either look at schools that have students
// (top 40) or type 2+ letters, which searches all universities.
function Directory({ me, mySchool, toast, onOpen }) {
  const [q, setQ] = useState(''), [only, setOnly] = useState(false), [rows, setRows] = useState(null)
  useEffect(() => {
    let live = true
    setRows(null)
    const term = q.trim().length >= 2 ? q.trim() : ''
    const t = setTimeout(() => fetchSchoolDirectory({ q: term, following: only }).then(r => live && setRows(r)).catch(e => { if (live) { toast(schoolDbHint(e)); setRows([]) } }), term ? 250 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [q, only, toast])
  const list = useMemo(() => otherSchools(rows, mySchool), [rows, mySchool])
  const searching = q.trim().length >= 2
  return (
    <>
      <section className="clay tile campus-hero">
        <h2 className="h-ic"><Icon name="school" size={22} /> Other universities</h2>
        <p className="mute">See how many students joined each university, follow a school, or open it to meet its students.</p>
        <div className="bar"><div className="search grow"><Icon name="search" size={17} /><input className="clay-in" value={q} onChange={e => setQ(e.target.value)} placeholder="Type a university to find it, e.g. UST or Bulacan…" aria-label="Search universities" /></div></div>
        <div className="chips">
          <button className={!only ? 'chip on' : 'chip'} onClick={() => setOnly(false)}>{searching ? 'Search results' : 'With students'}</button>
          <button className={only ? 'chip on' : 'chip'} onClick={() => setOnly(true)}>Following</button>
          {(q || only) && <button className="chip" onClick={() => { setQ(''); setOnly(false) }}><Icon name="x" size={13} /> Clear</button>}
        </div>
      </section>
      {rows === null && <RowsSkeleton label="Loading universities" />}
      {rows !== null && list.length === 0 && <div className="clay tile empty">{only ? 'You are not following any university yet.' : searching ? 'No university matches. Check the spelling, or try a short name like PUP.' : 'No other university has students yet.'}</div>}
      <ul className="people">
        {list.map(r => (
          <li className="clay tile pp" key={r.school}>
            <button type="button" className="pp-main" onClick={() => onOpen(r)}>
              <span className="pp-ico"><Icon name="school" size={22} /></span>
              <span className="pp-t"><b>{r.school}</b><small className="mute"><b>{r.users}</b> student{r.users === 1 ? '' : 's'} on AraLab</small></span>
            </button>
            <FollowSchool me={me} row={r} toast={toast} />
          </li>))}
      </ul>
    </>
  )
}

export default function Campus({ me, school, myProgram, toast, onOpenProfile, onSetSchool }) {
  const [view, setView] = useState('mine'), [open, setOpen] = useState(null)
  const go = v => { setView(v); setOpen(null) }
  return (
    <div className="campus">
      <div className="chips campus-tabs" role="tablist" aria-label="University views">
        <button role="tab" aria-selected={view === 'mine'} className={view === 'mine' ? 'chip on' : 'chip'} onClick={() => go('mine')}><Icon name="school" size={14} /> My university</button>
        <button role="tab" aria-selected={view === 'others'} className={view === 'others' ? 'chip on' : 'chip'} onClick={() => go('others')}><Icon name="search" size={14} /> Other universities</button>
      </div>
      {view === 'mine' && <SchoolPeople me={me} school={school} myProgram={myProgram} toast={toast} onOpenProfile={onOpenProfile} onSetSchool={onSetSchool} />}
      {view === 'others' && !open && <Directory me={me} mySchool={school} toast={toast} onOpen={setOpen} />}
      {view === 'others' && open && <SchoolPeople key={open.school} others me={me} school={open.school} myProgram={myProgram} toast={toast} onOpenProfile={onOpenProfile}
        head={<div className="row spread"><button type="button" className="btn" onClick={() => setOpen(null)}><Icon name="back" size={15} /> All universities</button><FollowSchool me={me} row={open} toast={toast} /></div>} />}
    </div>
  )
}
