// "Active now": everyone who has AraLab open and visible right now. Uses Supabase Realtime presence, so it needs no database change.
// A person drops off a few seconds after closing the tab, and while their tab is hidden/in the background.
import { createContext, useContext, useEffect, useState } from 'react'
import { sb } from './supabase'

export const PresenceCtx = createContext(new Set())

const HIDE_KEY = 'rl-hide-active'
export const activeHidden = () => { try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false } }
export const setActiveHidden = v => { try { localStorage.setItem(HIDE_KEY, v ? '1' : '0') } catch { /* private mode */ } window.dispatchEvent(new Event('rl-active-pref')) }

export function usePresence(me) {
  const [online, setOnline] = useState(() => new Set())
  useEffect(() => {
    if (!me) { setOnline(new Set()); return }
    const ch = sb.channel('aralab-online', { config: { presence: { key: me } } })
    let on = false
    // many people joining at once would redraw the whole app for every single join: batch them (at most one redraw per 2 s)
    let timer = null
    const sync = () => { if (timer) return; timer = setTimeout(() => { timer = null; setOnline(new Set(Object.keys(ch.presenceState()))) }, 2000) }
    const show = async () => { if (on || document.hidden || activeHidden()) return; on = true; try { await ch.track({ at: Date.now() }) } catch { on = false } }
    const hide = async () => { if (!on) return; on = false; try { await ch.untrack() } catch { /* channel already closed */ } }
    const vis = () => (document.hidden || activeHidden() ? hide() : show())
    ch.on('presence', { event: 'sync' }, sync).subscribe(status => { if (status === 'SUBSCRIBED') show() })
    document.addEventListener('visibilitychange', vis); window.addEventListener('rl-active-pref', vis)
    window.addEventListener('pagehide', hide)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', vis); window.removeEventListener('rl-active-pref', vis); window.removeEventListener('pagehide', hide); sb.removeChannel(ch) }
  }, [me])
  return online
}

export const useIsOnline = id => useContext(PresenceCtx).has(id)

export function ActiveLabel({ id }) {
  return useIsOnline(id) ? <span className="active-now"><i className="online-dot inline" aria-hidden="true" /> Active now</span> : null
}

export function OnlineDot({ id, className = '' }) {
  const on = useIsOnline(id)
  return on ? <i className={`online-dot ${className}`} title="Active now" role="img" aria-label="Active now" /> : null
}
