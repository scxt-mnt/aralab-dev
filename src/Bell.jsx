import { useCallback, useEffect, useState } from 'react'
import Icon from './Icons'
import { fetchNotifs, markRead, markAll, subscribeNotifs } from './notifyApi'

const ICON = { star: 'star', visits: 'user', follow: 'userplus', publish: 'library', field: 'sparkles', updated: 'edit', flag: 'flag', flag_fixed: 'check', post: 'feed', mention: 'at', comment: 'message', comment_reply: 'message', comment_reaction: 'thumb', task_request: 'sparkles', task_flag: 'flag', task_app: 'award', task_ban: 'alert', task_gen: 'alert', gen_pause: 'alert', gen_resume: 'check', reviewer_removed: 'flag', reviewer_restored: 'check' }
const ago = iso => { const s = Math.max(1, (Date.now() - new Date(iso)) / 1000); return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d` }

// Facebook-style bell: red unread badge, dropdown list, live updates.
export default function Bell({ me, toast, onGo }) {
  const [items, setItems] = useState([]), [open, setOpen] = useState(false)
  const load = useCallback(() => fetchNotifs().then(setItems).catch(() => {}), [])
  useEffect(() => { load(); return subscribeNotifs(me, n => { setItems(l => [n, ...l]); toast(n.text) }) }, [me, load, toast])
  const unread = items.filter(n => !n.read_at).length
  const click = n => { if (!n.read_at) { markRead([n.id]); setItems(l => l.map(x => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x))) } setOpen(false); onGo(n) }
  const all = async () => { await markAll(me); load() }
  return (
    <>
      <button type="button" className="bell-btn" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="bell" size={20} />{unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && <>
        <div className="scrim" style={{ background: 'transparent', zIndex: 59 }} onClick={() => setOpen(false)} />
        <div className="clay bell-panel" role="dialog" aria-label="Notifications">
          <div className="row spread"><b>Notifications</b>{unread > 0 && <button type="button" className="btn" onClick={all}>Mark all read</button>}</div>
          {!items.length && <p className="mute">Nothing yet. Follow students and open reviewers in your field to get updates.</p>}
          <ul>{items.map(n => <li key={n.id}><button type="button" className={n.read_at ? 'bell-item' : 'bell-item new'} onClick={() => click(n)}><Icon name={ICON[n.kind] || 'bell'} size={16} /><span>{n.text}</span><small>{ago(n.created_at)}</small></button></li>)}</ul>
        </div>
      </>}
    </>
  )
}
