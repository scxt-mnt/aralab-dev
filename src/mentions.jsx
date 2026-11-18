// @mention UI: a small search-as-you-type picker plus a renderer that highlights mentions in a body.
// The mention is stored as an id, so the notification reaches the right student even when two names match.
import { useEffect, useMemo, useState } from 'react'
import { sb } from './supabase'
import Avatar from './UserAvatar'
import { insertMention, liveMentions, mentionParts, mentionToken } from './mentionLogic'

export function useMentions({ text, setText, me, limit = 6 }) {
  const [list, setList] = useState([]), [index, setIndex] = useState(0), [picks, setPicks] = useState([])
  const token = mentionToken(text)
  const query = token ? token.query : null

  // search students only while the reader is typing "@…"
  useEffect(() => {
    if (query === null) { setList([]); return }
    let live = true
    const t = setTimeout(async () => {
      let q = sb.from('profiles').select('user_id,display_name,avatar_url,school')
        .ilike('display_name', `%${String(query).replace(/[%_\\]/g, '\\$&')}%`).limit(limit)
      if (me) q = q.neq('user_id', me)
      const { data } = await q
      if (live) { setList(data || []); setIndex(0) }
    }, 180)
    return () => { live = false; clearTimeout(t) }
  }, [query, me, limit])

  const pick = person => {
    if (!token || !person?.user_id) return
    const name = String(person.display_name || 'Student').trim().slice(0, 80)
    setText(insertMention(text, token, name))
    setPicks(p => [...p.filter(x => x.id !== person.user_id), { id: person.user_id, name }])
    setList([]); setIndex(0)
  }
  // used when replying: pre-add the person being replied to (so they are notified as a mention too)
  const seed = person => {
    if (!person?.id || !person?.name) return
    setPicks(p => [...p.filter(x => x.id !== person.id), { id: person.id, name: String(person.name).slice(0, 80) }])
  }
  const onKeyDown = e => {
    if (!list.length) return false
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => (i + 1) % list.length); return true }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => (i - 1 + list.length) % list.length); return true }
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(list[index]); return true }
    if (e.key === 'Escape') { e.preventDefault(); setList([]); return true }
    return false
  }
  const mentioned = useMemo(() => liveMentions(text, picks), [text, picks])
  const reset = () => { setPicks([]); setList([]); setIndex(0) }
  return { open: !!token && list.length > 0, list, index, pick, seed, onKeyDown, mentioned, reset }
}

export function MentionList({ list, index, onPick }) {
  if (!list?.length) return null
  return (
    <div className="mention-pop" role="listbox" aria-label="Mention a student">
      {list.map((p, i) => (
        <button type="button" key={p.user_id} role="option" aria-selected={i === index}
          className={i === index ? 'mention-item on' : 'mention-item'}
          onMouseDown={e => { e.preventDefault(); onPick(p) }}>
          <Avatar person={p} size={26} />
          <span className="mention-who"><b>{p.display_name || 'Student'}</b>{p.school && <small>{p.school}</small>}</span>
        </button>
      ))}
    </div>
  )
}

// Render a body with its @mentions highlighted. Anonymous people are never linked to their profile.
export function MentionText({ text, mentions, onOpenProfile }) {
  const parts = mentionParts(text, mentions)
  const ids = useMemo(() => Object.fromEntries((mentions || []).map(m => [m.name, m.id])), [mentions])
  return <>{parts.map((p, i) => {
    if (!p.mention) return <span key={i}>{p.text}</span>
    const id = ids[p.mention]
    return id && onOpenProfile
      ? <button key={i} type="button" className="mention" onClick={() => onOpenProfile(id)}>@{p.mention}</button>
      : <span key={i} className="mention static">@{p.mention}</span>
  })}</>
}
