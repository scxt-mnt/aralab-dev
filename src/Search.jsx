// Facebook-style search: one box, results grouped into Students, Posts, University Astra guides, Reviewers and Universities.
import { useEffect, useMemo, useState } from 'react'
import { sb } from './supabase'
import Avatar from './UserAvatar'
import PostCard from './PostCard'
import LivePreview from './LivePreview'
import Icon from './Icons'
import { RowsSkeleton } from './Skeleton'
import { AstraBadge } from './AstraBadge'
import CopyButton from './CopyButton'
import { fetchFeed } from './feedApi'
import { useUniversities } from './schools'
import { CATEGORIES } from './Astra'

const TABS = [['all', 'All'], ['students', 'Students'], ['posts', 'Posts'], ['guides', 'Astra guides'], ['reviewers', 'Reviewers']]
const clean = s => s.replace(/[,()*"\\]/g, ' ').replace(/[%_]/g, m => '\\' + m).trim()

export default function Search({ q, me, admin, items, toast, onOpenProfile, onOpenGuide, onOpenLibrary }) {
  const all = useUniversities()
  const [tab, setTab] = useState('all'), [res, setRes] = useState(null)
  const term = q.trim()

  useEffect(() => {
    if (term.length < 2) { setRes(null); return }
    let live = true
    const t = setTimeout(async () => {
      const c = clean(term)
      const [stu, posts, guides] = await Promise.allSettled([
        sb.from('profiles').select('user_id,display_name,avatar_url,school,student_no').or(`display_name.ilike.%${c}%,student_no.ilike.%${c}%,school.ilike.%${c}%`).order('display_name').limit(30).then(r => { if (r.error) throw r.error; return r.data }),
        fetchFeed({ me, q: term }).then(r => r.posts),
        sb.from('astra_guides').select('*').or(`title.ilike.%${c}%,body.ilike.%${c}%`).order('updated_at', { ascending: false }).limit(20).then(r => { if (r.error) throw r.error; return r.data }),
      ])
      if (!live) return
      const ok = r => (r.status === 'fulfilled' ? r.value : [])
      if ([stu, posts, guides].some(r => r.status === 'rejected')) toast('Some results could not be loaded.')
      setRes({ students: ok(stu), posts: ok(posts), guides: ok(guides) })
    }, 300)
    return () => { live = false; clearTimeout(t) }
  }, [term, me, toast])

  const s = term.toLowerCase()
  const reviewers = useMemo(() => (term.length < 2 ? [] : items.filter(i => (i.title + ' ' + i.subject + ' ' + (i.text || '')).toLowerCase().includes(s)).slice(0, 30)), [items, s, term.length])
  const unis = useMemo(() => (term.length < 2 ? [] : all.filter(u => u.toLowerCase().includes(s)).slice(0, 6)), [s, term.length, all])

  if (term.length < 2) return <div className="clay tile empty"><Icon name="search" size={30} /><p>Type at least 2 letters to search students (name or ID), posts, University Astra guides and reviewers.</p></div>
  if (!res) return <RowsSkeleton count={4} label="Searching" />

  const lim = (arr, n) => (tab === 'all' ? arr.slice(0, n) : arr)
  const show = k => tab === 'all' || tab === k
  const more = (k, n) => tab === 'all' && n > (k === 'posts' ? 3 : k === 'students' ? 5 : 3) && <button className="btn" onClick={() => setTab(k)}>See all {n}</button>
  const total = res.students.length + res.posts.length + res.guides.length + reviewers.length
  const common = { me, admin, toast, onOpenProfile, onUpdate: p => setRes(r => ({ ...r, posts: r.posts.map(x => (x.id === p.id ? p : x)) })), onRemove: id => setRes(r => ({ ...r, posts: r.posts.filter(x => x.id !== id) })) }

  return (
    <div className="sres">
      <div className="chips">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'chip on' : 'chip'} onClick={() => setTab(k)}>{l}</button>)}</div>
      {total === 0 && unis.length === 0 && <div className="clay tile empty"><p>No results for “{term}”.</p></div>}

      {show('all') && tab === 'all' && unis.length > 0 && <section><h3>Universities</h3><div className="chips">{unis.map(u => <button key={u} className="chip" onClick={() => onOpenGuide(u)}><Icon name="school" size={14} /> {u}</button>)}</div></section>}

      {show('students') && res.students.length > 0 && (
        <section><h3>Students</h3>
          <div className="rlist">{lim(res.students, 5).map(p => (
            <div className="person-row" key={p.user_id}>
              <button className="clay tile person" onClick={() => onOpenProfile(p.user_id)}>
                <Avatar person={p} size={44} />
                <div><b>{p.display_name || 'Student'} <AstraBadge userId={p.user_id} /></b>
                  <small className="mute">{p.school || 'No school yet'}{p.student_no && <> · <span className="sid">ID {p.student_no}</span></>}</small></div>
              </button>
              {p.student_no && <CopyButton value={p.student_no} label="Student ID" toast={toast} className="copy-btn person-copy" />}
            </div>))}</div>{more('students', res.students.length)}</section>
      )}

      {show('posts') && res.posts.length > 0 && (
        <section><h3>Posts</h3>{lim(res.posts, 3).map(p => <PostCard key={p.id} post={p} {...common} />)}{more('posts', res.posts.length)}</section>
      )}

      {show('guides') && res.guides.length > 0 && (
        <section><h3>University Astra guides</h3>
          <div className="rlist">{lim(res.guides, 3).map(g => { const c = CATEGORIES[g.category] || CATEGORIES.tips; return (
            <button key={g.id} className="clay tile person" onClick={() => onOpenGuide(g.school)}>
              <div className="g-ic" style={{ background: c.color + '22', color: c.color }}><Icon name={c.icon} size={20} /></div>
              <div><b>{g.title}</b><small className="mute">{g.school} · {c.label}</small>{g.body && <p className="snip">{g.body.slice(0, 140)}{g.body.length > 140 ? '…' : ''}</p>}</div>
            </button>) })}</div>{more('guides', res.guides.length)}</section>
      )}

      {show('reviewers') && reviewers.length > 0 && (
        <section><h3>Reviewers</h3>
          <div className="rlist">{lim(reviewers, 3).map(i => (
            <button key={i.id} className="clay tile person srch-rv" onClick={onOpenLibrary}><div className="srch-lp"><LivePreview item={i} ratio={0.8} /></div><div><b>{i.title}</b><small className="mute">{i.subject} · open in Library</small></div></button>))}</div>{more('reviewers', reviewers.length)}</section>
      )}
    </div>
  )
}
