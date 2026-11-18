import { color, fmtTime } from './lib'
import Donut from './Donut'
import Ring from './Ring'
import { VBars } from './Bars'
import Icon from './Icons'

const weekdays = days => (days || []).map(d => ({
  label: new Date(d.day + 'T00:00').toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3),
  value: d.secs, text: fmtTime(d.secs), color: '#8b9bff',
}))

const Streak = ({ n }) => <span className="streak"><Icon name="flame" size={16} />{n}</span>
const subjectsData = stats => (stats.subjects || []).map(s => ({ label: s.subject, value: s.secs, text: fmtTime(s.secs), color: color(s.subject) }))

// Card shown inside a post that shares stats. `layout` is what the student chose when posting: compact | rings | weekly | subjects
export function StatsCard({ stats, layout = 'compact' }) {
  if (!stats) return null
  const goalSec = (stats.goal || 5) * 3600, pct = Math.min(100, Math.round((stats.week / goalSec) * 100))
  const head = <div className="sc-head"><Icon name="chart" size={16} /> Study stats<span className="sc-streak"><Streak n={stats.streak} /> day streak</span></div>
  if (layout === 'rings') return (
    <div className="stats-card" data-testid="stats-card" data-layout="rings">
      {head}
      <div className="sc-rings">
        <Ring value={stats.week / 3600} max={stats.goal || 5} label="Weekly goal" sub={`${fmtTime(stats.week)} of ${stats.goal}h`} color="#6c7bf0" size={104} />
        <div className="sc-side"><div><b>{fmtTime(stats.total)}</b><small>all time</small></div><div><b>{stats.opened}</b><small>reviewers opened</small></div>{stats.top_subject && <div><b style={{ color: color(stats.top_subject) }}>{stats.top_subject}</b><small>top subject</small></div>}</div>
      </div>
    </div>
  )
  if (layout === 'weekly') return (
    <div className="stats-card" data-testid="stats-card" data-layout="weekly">
      {head}
      <div className="sc-big"><b>{fmtTime(stats.week)}</b><small>studied in the last 7 days · {pct}% of your {stats.goal}h goal</small></div>
      <VBars data={weekdays(stats.days)} height={92} />
    </div>
  )
  if (layout === 'subjects') return (
    <div className="stats-card" data-testid="stats-card" data-layout="subjects">
      {head}
      {stats.subjects?.length ? <Donut size={108} center={fmtTime(stats.total)} data={subjectsData(stats)} /> : <small className="mute">No study time yet.</small>}
    </div>
  )
  return (
    <div className="stats-card" data-testid="stats-card" data-layout="compact">
      {head}
      <div className="sc-grid">
        <div><b>{stats.streak}</b><small>day streak</small></div>
        <div><b>{fmtTime(stats.week)}</b><small>this week</small></div>
        <div><b>{fmtTime(stats.total)}</b><small>all time</small></div>
      </div>
      <div className="meter" role="img" aria-label={`Weekly goal ${pct}%`}><i style={{ width: pct + '%' }} /></div>
      <small className="mute">{fmtTime(stats.week)} of {stats.goal}h weekly goal · {pct}%</small>
      {stats.top_subject && <small className="mute">Top subject: <b style={{ color: color(stats.top_subject) }}>{stats.top_subject}</b></small>}
      <VBars data={weekdays(stats.days)} height={64} />
    </div>
  )
}

// full version for the profile panel
export default function StatsView({ stats }) {  if (!stats) return null
  return (
    <div className="stats-full" data-testid="stats-full">
      <div className="pstats">
        <div><b className="streak"><Icon name="flame" size={18} />{stats.streak}</b><small>day streak</small></div>
        <div><b>{fmtTime(stats.week)}</b><small>this week</small></div>
        <div><b>{fmtTime(stats.total)}</b><small>all time</small></div>
      </div>
      <div className="rings sm">
        <Ring value={stats.week / 3600} max={stats.goal || 5} label="Weekly goal" sub={`${fmtTime(stats.week)} of ${stats.goal}h`} color="#8b9bff" size={96} />
        <div className="ring"><b className="big-n">{stats.opened}</b><b>Reviewers opened</b></div>
      </div>
      <h4>Last 7 days</h4>
      <VBars data={weekdays(stats.days)} height={110} />
      <h4>Time per subject</h4>
      {stats.subjects?.length
        ? <Donut size={120} center={fmtTime(stats.total)} data={stats.subjects.map(s => ({ label: s.subject, value: s.secs, text: fmtTime(s.secs), color: color(s.subject) }))} />
        : <p className="mute">No study time yet.</p>}
    </div>
  )
}

// Contribution score: reviewers + study time + accepted flags, summed into points.
export function ContributionsView({ c }) {
  const hours = Math.floor(c.seconds / 3600), mins = Math.round((c.seconds % 3600) / 60)
  const time = hours ? `${hours}h ${mins}m` : `${mins}m`
  return (
    <div className="contrib-card" data-testid="contributions">
      <div className="contrib-total"><b>{Number(c.points).toLocaleString()}</b><small>total points</small></div>
      <ul className="contrib-list">
        <li><span><Icon name="library" size={15} /> Reviewers contributed</span><b>{c.reviewers}</b><small>{c.reviewer_points} pts</small></li>
        <li><span><Icon name="chart" size={15} /> Study time</span><b>{time}</b><small>{c.study_points} pts</small></li>
        <li><span><Icon name="flag" size={15} /> Accepted flags</span><b>{c.flags}</b><small>{c.flag_points} pts</small></li>
        {c.quiz_points !== undefined && <li><span><Icon name="zap" size={15} /> Challenge improvement</span><b>{c.quiz_attempts}</b><small>{c.quiz_points} pts</small></li>}
      </ul>
      <small className="mute">50 pts per reviewer · 10 pts per study hour · 25 pts per accepted flag · up to 20 pts per reviewer for beating your Challenge best</small>
    </div>
  )
}
