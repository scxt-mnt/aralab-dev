// Right-hand rail of the feed: each student's OWN upcoming exams/quizzes/deadlines (private, stored in personal_events)
// and announcements (only admins can post/delete those).
import { useEffect, useRef, useState } from 'react'
import { sb } from './supabase'
import { ago } from './feedLogic'
import Icon from './Icons'

export const KINDS = { exam: { label: 'Exam', icon: 'exam', color: '#e8788a' }, quiz: { label: 'Quiz', icon: 'help', color: '#f2b872' }, deadline: { label: 'Deadline', icon: 'clock', color: '#a893f0' }, event: { label: 'Event', icon: 'calendar', color: '#7fd4ba' } }
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = () => iso(new Date())
const daysUntil = day => Math.round((new Date(day + 'T00:00') - new Date(today() + 'T00:00')) / 864e5)
const fmtDay = day => { const n = daysUntil(day); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : new Date(day + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) }
const countdown = day => { const n = daysUntil(day); return n === 0 ? 'today' : n === 1 ? 'in 1 day' : `in ${n} days` }

export default function Widgets({ admin, toast }) {
  const [events, setEvents] = useState([]), [anns, setAnns] = useState([])
  const [ev, setEv] = useState({ title: '', day: today(), kind: 'exam' })
  const welcomed = useRef(false)

  const load = async () => {
    const [e, a] = await Promise.all([
      sb.from('personal_events').select('*').gte('day', today()).order('day'),
      sb.from('announcements').select('*').order('created_at', { ascending: false }).limit(4)])
    if (e.error) toast(`Upcoming: ${e.error.message}`); else setEvents(e.data)
    if (!a.error) setAnns(a.data)
    return e.data || []
  }

  useEffect(() => {
    load().then(list => {
      if (welcomed.current) return; welcomed.current = true
      const soon = list.filter(x => daysUntil(x.day) <= 3)
      if (soon.length) toast(`${(KINDS[soon[0].kind] || KINDS.event).label}: ${soon[0].title} · ${fmtDay(soon[0].day)}${soon.length > 1 ? ` (+${soon.length - 1} more)` : ''}`)
    })
    const ch = sb.channel('live-widgets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, p => { if (p.eventType === 'INSERT') toast(`Announcement: ${p.new.title || p.new.message}`); load() })
      .subscribe()
    return () => { sb.removeChannel(ch) }
  }, [])

  const addEvent = async () => {
    if (!ev.title.trim()) return
    const { error } = await sb.from('personal_events').insert({ title: ev.title.trim(), day: ev.day, kind: ev.kind, color: KINDS[ev.kind].color })
    if (error) return toast(error.message)
    setEv({ ...ev, title: '' }); load()
  }
  const delEvent = async id => { const { error } = await sb.from('personal_events').delete().eq('id', id); if (error) toast(error.message); else load() }
  const delAnn = async id => { const { error } = await sb.from('announcements').delete().eq('id', id); if (error) toast(error.message) }

  return (
    <>
      <div className="clay tile timeline" data-testid="upcoming">
        <h3>My upcoming</h3>
        {events.length === 0 && <p className="mute">Nothing yet. Add your own exam, quiz or deadline below.</p>}
        <ol className="tl">
          {events.slice(0, 6).map(e => { const k = KINDS[e.kind] || KINDS.event; return (
            <li key={e.id}><i style={{ background: k.color }} />
              <div><small>{fmtDay(e.day)} · {countdown(e.day)}</small><b className="ev-t"><Icon name={k.icon} size={15} /> {e.title}</b></div>
              <span className="pill" style={{ background: k.color }}>{k.label}</span>
              <button className="x" onClick={() => delEvent(e.id)} aria-label="Delete"><Icon name="x" size={16} /></button>
            </li>) })}
        </ol>
        <div className="form">
          <input className="clay-in" value={ev.title} onChange={e => setEv({ ...ev, title: e.target.value })} onKeyDown={e => e.key === 'Enter' && addEvent()} placeholder="e.g. ProfEd 1 Midterm" />
          <div className="add-ev">
            <select className="clay-in" value={ev.kind} onChange={e => setEv({ ...ev, kind: e.target.value })}>{Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select>
            <input className="clay-in" type="date" value={ev.day} min={today()} onChange={e => setEv({ ...ev, day: e.target.value })} />
            <button className="btn pri" onClick={addEvent}>Add</button>
          </div>
        </div>
      </div>

      <div className="clay tile anns" data-testid="announcements">
        <h3 className="h-ic"><Icon name="megaphone" size={17} /> Announcements</h3>
        {anns.length === 0 && <p className="mute">Nothing new right now.</p>}
        {anns.map((a, i) => (
          <div key={a.id} className={i === 0 ? 'an new' : 'an'}>
            <div className="an-head"><b>{a.title || 'Announcement'}</b><small>{ago(a.created_at)}</small>{admin && <button className="x" onClick={() => delAnn(a.id)} aria-label="Delete"><Icon name="x" size={16} /></button>}</div>
            <p>{a.message}</p>
          </div>))}
        {admin && <small className="mute">New announcements are posted from the Feed (tap <b>Announcement</b> in the composer). They support video and photos, and can be pinned.</small>}
      </div>
    </>
  )
}
