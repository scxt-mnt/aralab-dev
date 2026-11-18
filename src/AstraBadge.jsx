// Who is a University Astra member (and for which university). Loaded once; every name in the app can show the badge.
import { createContext, useContext } from 'react'
import Icon from './Icons'

export const AstraCtx = createContext({})
export function AstraBadge({ userId, full = false }) {
  const school = useContext(AstraCtx)[userId]
  if (!school) return null
  return <span className="astra-badge" title={`University Astra · ${school}`}><Icon name="cap" size={11} /> Astra{full ? ` · ${school}` : ''}</span>
}
