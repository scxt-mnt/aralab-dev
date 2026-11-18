import { useEffect, useRef, useState } from 'react'
import { FIRST_TOKEN_S } from './aiProgress'

// Progress bar + ONE line that keeps updating while the AI works. p comes from callAi's onUpdate.
export default function AiBar({ p }) {
  const [, tick] = useState(0), shown = useRef(0)
  useEffect(() => { if (!p) { shown.current = 0; return } const t = setInterval(() => tick(x => x + 1), 500); return () => clearInterval(t) }, [!!p])
  if (!p) return null
  const secs = Math.max(0, Math.round((Date.now() - p.at) / 1000))
  const creep = p.state === 'wait' ? Math.min(22, (secs / FIRST_TOKEN_S) * 22) : 0
  const pct = Math.min(100, Math.max(shown.current, p.pct + creep)); shown.current = pct
  const showT = p.state === 'wait' || p.state === 'write'
  return (
    <div className="aibar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)}>
      <div className="track"><div className="fill" style={{ width: `${pct}%` }} /></div>
      <small className="mute" aria-live="polite">{Math.round(pct)}% · {p.line}{showT ? ` · ${secs}s` : ''}</small>
    </div>
  )
}
