// "Apply as Astra": shown in the University Astra tab to students who are not Astra (and are not admins).
// The requirements come from the database (astra_requirements) and rise with every Astra member the school has.
// A student can apply only when every requirement is met; the admin then approves or rejects (Moderation > Astra applications).
import { useCallback, useEffect, useState } from 'react'
import { sb } from './supabase'
import Icon from './Icons'

const ROWS = [
  ['days', 'Account age', n => `${n} day${n === 1 ? '' : 's'}`],
  ['points', 'Points', n => Number(n).toLocaleString()],
  ['reviewers', 'Published reviewers', n => n],
  ['flags', 'Accepted flags', n => n],
]
const when = d => new Date(d).toLocaleDateString()
const MIN = 50

export default function AstraApply({ toast }) {
  const [st, setSt] = useState(null), [msg, setMsg] = useState(''), [busy, setBusy] = useState(false)
  const load = useCallback(async () => {
    const { data, error } = await sb.rpc('astra_eligibility')
    setSt(error || !data ? false : data)      // hide quietly if the SQL has not been run yet
  }, [])
  useEffect(() => { load() }, [load])
  if (!st || st.hidden) return null

  const req = st.requirements, mine = st.mine
  const apply = async e => {
    e.preventDefault(); if (busy) return
    setBusy(true)
    const { error } = await sb.rpc('astra_apply', { _message: msg })
    setBusy(false)
    if (error) return toast(error.message)
    toast('Application sent. The admin will review it.'); setMsg(''); load()
  }
  const withdraw = async () => {
    const { error } = await sb.rpc('astra_withdraw', { _id: st.pending.id })
    if (error) return toast(error.message); toast('Application withdrawn.'); load()
  }

  return (
    <section className="clay tile apply-astra" data-testid="apply-astra">
      <div className="row spread">
        <h3 className="h-ic"><Icon name="award" size={18} /> Apply as Astra</h3>
        <small className="mute">{st.school || 'No school yet'} · {req.astra_count} Astra now</small>
      </div>
      <p className="mute">Astra members moderate their school. Every new Astra raises the bar for the next one, so this is earned over days and months of real contributions.</p>
      {ROWS.map(([k, label, fmt]) => {
        const done = st.met[k], pct = Math.min(100, Math.round((mine[k] / Math.max(1, req[k])) * 100))
        return (
          <div className="ap-row" key={k}>
            <b>{label}{done && <span className="ap-ok"> · met</span>}</b>
            <span className="mute">{fmt(mine[k])} / {fmt(req[k])}</span>
            <div className="meter ap-meter"><i style={{ width: `${pct}%`, opacity: done ? 1 : .6 }} /></div>
          </div>)
      })}
      <small className="mute">Points = 50 per reviewer + 25 per accepted flag + study time (up to 3 study hours a day count).</small>

      {st.last?.status === 'rejected' && <p className="note">Your last application was declined{st.last.admin_note ? `: ${st.last.admin_note}` : '.'}</p>}
      {st.blockers.map(b => <p className="note" key={b}>{b}</p>)}

      {st.pending ? (
        <div className="row spread">
          <span>Application sent on {when(st.pending.created_at)}. Waiting for the admin.</span>
          <button className="btn" onClick={withdraw}>Withdraw</button>
        </div>
      ) : st.can_apply ? (
        <form className="rform" onSubmit={apply}>
          <label>Why should you be Astra for {st.school}?
            <textarea className="clay-in" rows="4" required minLength={MIN} maxLength={1000} value={msg} onChange={e => setMsg(e.target.value)} placeholder="Tell the admin how you would help students of your school (at least 50 characters)." />
          </label>
          <button className="btn pri" disabled={busy || msg.trim().length < MIN}>{busy ? 'Sending…' : 'Send application'}</button>
        </form>
      ) : !st.all_met && <p className="mute">Keep contributing. You can apply as soon as every bar above is met.</p>}
    </section>
  )
}
