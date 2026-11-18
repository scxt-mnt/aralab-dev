// Ranking: top students by contribution points (50 per reviewer, 10 per study hour, 25 per accepted flag).
// Only students who keep "Show my contributions" on appear here.
import { useEffect, useState } from 'react'
import { sb } from './supabase'
import Avatar from './UserAvatar'
import Icon from './Icons'
import { RowsSkeleton } from './Skeleton'

const MEDAL = ['#f4c542', '#b8c0cc', '#d9915b']

export default function Ranking({ me, school, onOpenProfile, toast }) {
  const [scope, setScope] = useState(school ? 'school' : 'all'), [rows, setRows] = useState(null)
  useEffect(() => {
    let live = true; setRows(null)
    sb.rpc('school_leaderboard', { _school: scope === 'school' ? school : null, _limit: 30 }).then(({ data, error }) => {
      if (!live) return
      if (error) { toast(/school_leaderboard/.test(error.message) ? 'Run the latest supabase-setup.sql first.' : error.message); return setRows([]) }
      setRows((data || []).filter(r => r.points > 0))
    })
    return () => { live = false }
  }, [scope, school, toast])
  const mineAt = rows?.findIndex(r => r.user_id === me)
  const top = rows?.slice(0, 3) || [], rest = rows?.slice(3) || []
  return (
    <div className="ranking">
      <section className="clay tile rk-hero">
        <h2 className="h-ic"><Icon name="award" size={22} /> Ranking</h2>
        <p className="mute">Top students by points. 50 per contributed reviewer, 10 per study hour, 25 per accepted flag.</p>
        <div className="chips">
          {school && <button className={scope === 'school' ? 'chip on' : 'chip'} onClick={() => setScope('school')}>{school}</button>}
          <button className={scope === 'all' ? 'chip on' : 'chip'} onClick={() => setScope('all')}>All schools</button>
        </div>
      </section>
      {rows === null && <RowsSkeleton label="Loading the ranking" />}
      {rows && !rows.length && <div className="clay tile empty">No ranked students yet. Contribute a reviewer, study, or get a flag accepted to earn points.</div>}
      {top.length > 0 && <div className="podium">{[1, 0, 2].filter(i => top[i]).map(i => (
        <button type="button" key={top[i].user_id} className={`pod p${i + 1}`} onClick={() => onOpenProfile?.(top[i].user_id)}>
          <span className="medal" style={{ background: MEDAL[i] }}>{i + 1}</span>
          <Avatar person={top[i]} size={i === 0 ? 64 : 52} />
          <b>{top[i].display_name || 'Student'}</b>
          <small className="mute">{scope === 'all' ? top[i].school : ''}</small>
          <span className="pts">{top[i].points} pts</span>
        </button>))}</div>}
      {rest.length > 0 && <ol className="clay tile rk-list" start={4}>{rest.map((r, i) => (
        <li key={r.user_id} className={r.user_id === me ? 'me' : ''}>
          <button type="button" onClick={() => onOpenProfile?.(r.user_id)}>
            <span className="rk-n">{i + 4}</span><Avatar person={r} size={36} />
            <span className="rk-name"><b>{r.display_name || 'Student'}</b>{scope === 'all' && <small className="mute">{r.school}</small>}</span>
            <span className="pts">{r.points} pts</span>
          </button>
        </li>))}</ol>}
      {rows && rows.length > 0 && mineAt === -1 && <p className="mute" style={{ textAlign: 'center' }}>You are not in the top 30 yet. Keep contributing!</p>}
    </div>
  )
}
