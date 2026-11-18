// v83: a small picture of the reviewer itself (not its images): a page with a coloured top bar, the summary and the first topics.
// Drawn from the `preview` the database keeps for every reviewer; old rows show grey placeholder lines instead.
import { color } from './lib'

export default function MiniReviewer({ item, compact = false }) {
  const pv = item.preview || {}, topics = (pv.t || []).slice(0, compact ? 3 : 3)
  return (
    <span className={`mini${compact ? ' sm' : ''}`} style={{ '--c': color(item.subject) }} aria-hidden="true">
      <span className="mini-bar"><i /><i /><i /><em>{item.subject}</em></span>
      {!compact && (pv.s ? <span className="mini-s">{pv.s}</span> : <span className="mini-sk"><i /><i style={{ width: '70%' }} /></span>)}
      <span className="mini-t">
        {topics.length ? topics.map((x, i) => <span key={x}><b>{i + 1}</b><em>{x}</em></span>) : [0, 1, 2].map(i => <span key={i} className="sk"><b>{i + 1}</b><em /></span>)}
      </span>
    </span>
  )
}
