import { useEffect, useState } from 'react'
import { sb } from './supabase'
import { OnlineDot } from './presence'

// Self-healing avatar: if a list gave us a person without a picture (or the picture hasn't loaded into that list yet),
// look the picture up by user id (batched + cached) instead of showing the first letter until the profile is opened.
const cache = new Map()            // user id -> url ('' = checked, none)
let queue = new Set(), waiters = new Map(), timer = null
function lookup(id) {
  if (cache.has(id)) return Promise.resolve(cache.get(id))
  return new Promise(res => {
    ;(waiters.get(id) || waiters.set(id, []).get(id)).push(res); queue.add(id)
    if (timer) return
    timer = setTimeout(async () => {
      const ids = [...queue]; queue = new Set(); timer = null
      const { data, error } = await sb.from('profiles').select('user_id,avatar_url').in('user_id', ids)
      for (const id2 of ids) {
        const url = (data || []).find(p => p.user_id === id2)?.avatar_url || ''
        if (!error) cache.set(id2, url)
        for (const r of waiters.get(id2) || []) r(url)
        waiters.delete(id2)
      }
    }, 40)
  })
}

export default function Avatar({ person, size = 40, onClick }) {
  const name = person?.display_name || '?', id = person?.user_id, given = person?.avatar_url || ''
  const [url, setUrl] = useState(given || (id && cache.get(id)) || ''), [bad, setBad] = useState(false), [retry, setRetry] = useState(false)
  useEffect(() => {
    setBad(false); setRetry(false)
    if (given) { setUrl(given); if (id) cache.set(id, given); return }
    if (!id || person?.anonymous) { setUrl(''); return }
    let live = true
    lookup(id).then(u => live && setUrl(u))
    return () => { live = false }
  }, [id, given, person?.anonymous])
  // v84: wrapper sized + clipped in CSS (.av-round), the picture simply fills it: works in old WebViews (Facebook / Messenger) too.
  // If the picture fails once, retry without the referrer header before falling back to the first letter.
  const inner = url && !bad
    ? <span className="av av-round" style={{ width: size, height: size }}><img src={retry ? url + (url.includes('?') ? '&' : '?') + 'r=1' : url} alt="" decoding="async" {...(retry ? {} : { referrerPolicy: 'no-referrer' })} onError={() => (retry ? setBad(true) : setRetry(true))} /></span>
    : <div className="av" style={{ width: size, height: size, fontSize: size * 0.42 }}>{name[0]?.toUpperCase()}</div>
  const dot = id && !person?.anonymous ? <OnlineDot id={id} className={size < 34 ? 'sm' : ''} /> : null
  return <span className="av-wrap">{onClick ? <button type="button" className="av-btn" onClick={onClick} aria-label={`Open ${name}'s profile`}>{inner}</button> : inner}{dot}</span>
}
