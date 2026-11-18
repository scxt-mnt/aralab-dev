import { useState } from 'react'
import Icon from './Icons'

// A soft "what next?" card at the end of each screen, so the app feels like one connected path:
//   Feed -> Library -> Create -> University Astra -> My -> (back to Feed)
// It never blocks anything: it is a suggestion, it can be dismissed with the X, and it stays dismissed.
const STEPS = {
  feed: { icon: 'library', title: 'Ready to study?', text: 'Open a reviewer from the Library and keep your streak going.', cta: 'Browse the Library', to: 'library' },
  library: { icon: 'sparkles', title: 'Can’t find your topic?', text: 'Create a reviewer from your own files in a few taps.', cta: 'Create a reviewer', to: 'requests' },
  requests: { icon: 'cap', title: 'While it builds…', text: 'Check your school’s guide and see how your university ranks.', cta: 'Open University Astra', to: 'astra' },
  astra: { icon: 'user', title: 'See how you’re doing', text: 'Your points, streak and reviewers are in My.', cta: 'Open My', to: 'my' },
  rank: { icon: 'user', title: 'Climb the ranking', text: 'Your points come from reviewers you share and time you study.', cta: 'See my points', to: 'my' },
  campus: { icon: 'feed', title: 'Say hi to classmates', text: 'Share what you’re studying in the Feed.', cta: 'Go to the Feed', to: 'feed' },
}
const KEY = 'rl-flow-off'
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }

export default function FlowNext({ tab, go, openMy }) {
  const [off, setOff] = useState(read)
  const s = STEPS[tab]
  if (!s || off.includes(tab)) return null
  const hide = () => { const n = [...off, tab]; setOff(n); try { localStorage.setItem(KEY, JSON.stringify(n)) } catch {} }
  return (
    <aside className="flow-next" aria-label="Suggested next step">
      <span className="fn-ic"><Icon name={s.icon} size={20} /></span>
      <div className="fn-tx"><b>{s.title}</b><small>{s.text}</small></div>
      <button type="button" className="btn pri fn-go" onClick={() => (s.to === 'my' ? openMy() : go(s.to))}>{s.cta}</button>
      <button type="button" className="icon-btn fn-x" aria-label="Hide this suggestion" onClick={hide}><Icon name="x" size={16} /></button>
    </aside>
  )
}
