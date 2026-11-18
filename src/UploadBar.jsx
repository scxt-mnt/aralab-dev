// Status bar at the top of the screen for background uploads.
import { dismissJob, useJobs } from './uploads'
import Icon from './Icons'

export default function UploadBar() {
  const jobs = useJobs()
  if (!jobs.length) return null
  return (
    <div className="upbar" role="status" aria-live="polite">
      {jobs.map(j => {
        const pct = Math.round((j.done / j.total) * 100)
        return (
          <div key={j.id} className={`up ${j.status}`}>
            <div className="up-row">
              <span className="up-ic">{j.status === 'done' ? <Icon name="check" size={15} /> : j.status === 'error' ? <Icon name="x" size={15} /> : <i className="spin" />}</span>
              <span className="up-t">{j.status === 'error' ? `Failed: ${j.label}` : j.status === 'done' ? `Done: ${j.label}` : j.label}</span>
              <small>{j.status === 'running' ? `${j.done}/${j.total}` : j.status === 'error' ? j.error : ''}</small>
              {j.status !== 'running' && <button className="icon-btn" aria-label="Dismiss" onClick={() => dismissJob(j.id)}><Icon name="x" size={14} /></button>}
            </div>
            <div className="up-track"><div className={j.status === 'running' && !j.done ? 'up-fill ind' : 'up-fill'} style={{ width: j.status === 'running' && !j.done ? '35%' : pct + '%' }} /></div>
          </div>)
      })}
    </div>
  )
}
