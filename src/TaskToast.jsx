// v77: toast cards for running tasks. Each one shows what is happening, a progress bar, and a Cancel button.
import { cancelTask, dismissTask, useTasks } from './tasks'
import Icon from './Icons'

export default function TaskToast() {
  const tasks = useTasks()
  if (!tasks.length) return null
  return (
    <div className="ttoasts" role="region" aria-label="Running tasks" aria-live="polite">
      {tasks.map(t => {
        const running = t.status === 'running' || t.status === 'cancelling'
        const pct = typeof t.pct === 'number' ? t.pct : null
        return (
          <div key={t.id} className={`ttoast ${t.status}`}>
            <span className="tt-ic" aria-hidden="true">
              {running ? <i className="spin" /> : t.status === 'done' ? <Icon name="check" size={16} /> : <Icon name="x" size={16} />}
            </span>
            <div className="tt-body">
              <b className="tt-t">{t.label}</b>
              <small className="tt-l">{running ? (t.line || 'Starting…') : t.msg}</small>
              {running && <div className="tt-track"><div className={pct == null ? 'tt-fill ind' : 'tt-fill'} style={pct == null ? undefined : { width: `${pct}%` }} /></div>}
            </div>
            {t.status === 'running' && <button type="button" className="tt-btn" onClick={() => cancelTask(t.id)} aria-label={`Cancel: ${t.label}`}>Cancel</button>}
            {!running && <button type="button" className="tt-x" onClick={() => dismissTask(t.id)} aria-label="Dismiss"><Icon name="x" size={14} /></button>}
          </div>
        )
      })}
    </div>
  )
}
